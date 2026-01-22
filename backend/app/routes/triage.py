"""
Triage API routes - Email classification and prioritization
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.agents.triage_agent import TriageAgent
from app.models import TriageResult, User
from sqlalchemy import select

router = APIRouter()


class TriageRequest(BaseModel):
    """Request model for triage"""
    max_results: Optional[int] = 5  # Small batch for testing
    days: Optional[int] = 7
    email: Optional[str] = None


class TriageResponse(BaseModel):
    """Response model for triage results"""
    success: bool
    processed_count: int
    results: List[dict]
    message: str


@router.post("/triage/run", response_model=TriageResponse)
async def run_triage(
    request: Request,
    triage_request: TriageRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Run triage on email threads (small batch, synchronous for testing)
    
    This endpoint:
    1. Fetches normalized threads from Gmail API
    2. Runs Triage Agent on each thread
    3. Saves results to database
    4. Returns triage results
    
    Note: This is a synchronous version for MVP testing.
    For production, use async triage_tasks.
    """
    try:
        # Get user ID
        user_id = await get_current_user_id(request, db)
        
        # Get user
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get credentials
        credentials = await get_user_credentials(request, triage_request.email, db)
        gmail_service = GmailService(credentials)
        
        # Get normalized threads
        max_results = triage_request.max_results or 20
        days = triage_request.days or 7
        
        print(f"Fetching threads: max_results={max_results}, days={days}")
        raw_threads = gmail_service.get_threads(max_results=max_results, days=days)
        
        if not raw_threads:
            return TriageResponse(
                success=True,
                processed_count=0,
                results=[],
                message="No threads found to triage"
            )
        
        # Normalize threads
        normalized_threads = []
        for raw_thread in raw_threads:
            normalized = gmail_service.normalize_thread(raw_thread)
            if normalized:
                normalized_threads.append(normalized)
        
        if not normalized_threads:
            return TriageResponse(
                success=True,
                processed_count=0,
                results=[],
                message="No valid threads to triage"
            )
        
        # Run Triage Agent
        print(f"Running triage on {len(normalized_threads)} threads...")
        triage_agent = TriageAgent()
        triage_results = triage_agent.triage_batch(normalized_threads)
        
        # Save to database
        saved_results = []
        for result in triage_results:
            thread_id = result.get("thread_id")
            if not thread_id:
                continue
            
            # Check if result already exists
            existing = await db.execute(
                select(TriageResult).where(
                    TriageResult.user_id == user_id,
                    TriageResult.thread_id == thread_id
                )
            )
            existing_result = existing.scalar_one_or_none()
            
            if existing_result:
                # Update existing
                existing_result.label = result["label"]
                existing_result.priority = result["priority"]
                existing_result.summary = result["summary"]
                existing_result.key_points = result.get("key_points", [])
                existing_result.updated_at = datetime.utcnow()
                db_result = existing_result
            else:
                # Create new
                db_result = TriageResult(
                    user_id=user_id,
                    thread_id=thread_id,
                    label=result["label"],
                    priority=result["priority"],
                    summary=result["summary"],
                    key_points=result.get("key_points", [])
                )
                db.add(db_result)
            
            saved_results.append({
                "thread_id": thread_id,
                "label": result["label"],
                "priority": result["priority"],
                "summary": result["summary"],
                "key_points": result.get("key_points", [])
            })
        
        await db.commit()
        
        return TriageResponse(
            success=True,
            processed_count=len(saved_results),
            results=saved_results,
            message=f"Successfully triaged {len(saved_results)} threads"
        )
        
    except Exception as e:
        await db.rollback()
        error_str = str(e)
        print(f"Error running triage: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to run triage: {error_str}"
        )


@router.get("/triage/results")
async def get_triage_results(
    request: Request,
    email: Optional[str] = None,  # Kept for backward compatibility, but not used for filtering
    label: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get triage results for the current user
    
    Note: Triage results are stored per user_id, not per email account.
    All triage results for a user are accessible regardless of which email account is active.
    
    Query parameters:
    - email: Ignored (kept for backward compatibility)
    - label: Filter by label (NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE)
    - limit: Maximum number of results
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        # Build query - only filter by user_id, not email
        # This allows access to all triage results for the user across all email accounts
        query = select(TriageResult).where(TriageResult.user_id == user_id)
        
        if label:
            query = query.where(TriageResult.label == label)
        
        query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc())
        query = query.limit(limit)
        
        result = await db.execute(query)
        triage_results = result.scalars().all()
        
        results = []
        for tr in triage_results:
            results.append({
                "id": tr.id,
                "thread_id": tr.thread_id,
                "label": tr.label,
                "priority": tr.priority,
                "summary": tr.summary,
                "key_points": tr.key_points or [],
                "created_at": tr.created_at.isoformat() if tr.created_at else None,
                "updated_at": tr.updated_at.isoformat() if tr.updated_at else None
            })
        
        return {
            "success": True,
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        error_str = str(e)
        print(f"Error getting triage results: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get triage results: {error_str}"
        )


@router.delete("/triage/results/{thread_id}")
async def delete_triage_result(
    thread_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Delete triage result for a specific thread"""
    try:
        user_id = await get_current_user_id(request, db)
        
        result = await db.execute(
            select(TriageResult).where(
                TriageResult.user_id == user_id,
                TriageResult.thread_id == thread_id
            )
        )
        triage_result = result.scalar_one_or_none()
        
        if not triage_result:
            raise HTTPException(status_code=404, detail="Triage result not found")
        
        await db.delete(triage_result)
        await db.commit()
        
        return {"success": True, "message": "Triage result deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        error_str = str(e)
        print(f"Error deleting triage result: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete triage result: {error_str}"
        )
