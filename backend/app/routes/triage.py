"""
Triage API routes - Email classification and prioritization
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, AsyncGenerator
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import asyncio
import threading
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.services.background_tasks import sync_and_embed_emails
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


async def stream_triage_progress(
    triage_request: TriageRequest,
    request: Request,
    db: AsyncSession
) -> AsyncGenerator[str, None]:
    """Stream triage progress with SSE"""
    try:
        # Get user ID
        user_id = await get_current_user_id(request, db)
        
        # Get user
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            yield f"data: {json.dumps({'type': 'error', 'error': 'User not found'})}\n\n"
            return
        
        # Get credentials
        credentials = await get_user_credentials(request, triage_request.email, db)
        
        # Determine which email is being triaged to store with results
        active_email = triage_request.email
        if not active_email:
            from app.models import UserEmail
            primary_res = await db.execute(
                select(UserEmail).where(
                    UserEmail.user_id == user_id, 
                    UserEmail.is_primary == True
                )
            )
            primary_email_obj = primary_res.scalar_one_or_none()
            active_email = primary_email_obj.email if primary_email_obj else None
            
        gmail_service = GmailService(credentials)
        
        # Get normalized threads
        max_results = triage_request.max_results or 100
        days = triage_request.days or 7
        
        yield f"data: {json.dumps({'type': 'status', 'message': f'Fetching threads (max {max_results}, last {days} days)...'})}\n\n"
        await asyncio.sleep(0.1)
        
        raw_threads = gmail_service.get_threads(max_results=max_results, days=days)
        
        if not raw_threads:
            yield f"data: {json.dumps({'type': 'complete', 'success': True, 'processed_count': 0, 'results': [], 'message': 'No threads found to triage'})}\n\n"
            return
        
        # Normalize threads
        yield f"data: {json.dumps({'type': 'status', 'message': 'Normalizing threads...'})}\n\n"
        await asyncio.sleep(0.1)
        
        normalized_threads = []
        for raw_thread in raw_threads:
            normalized = gmail_service.normalize_thread(raw_thread)
            if normalized:
                normalized_threads.append(normalized)
        
        if not normalized_threads:
            yield f"data: {json.dumps({'type': 'complete', 'success': True, 'processed_count': 0, 'results': [], 'message': 'No valid threads to triage'})}\n\n"
            return
        
        # Smart filtering
        thread_ids = [t.get('thread_id') for t in normalized_threads if t.get('thread_id')]
        
        yield f"data: {json.dumps({'type': 'status', 'message': 'Checking existing triage results...'})}\n\n"
        await asyncio.sleep(0.1)
        
        # Batch query existing triage results
        if thread_ids:
            existing_triage_query = await db.execute(
                select(TriageResult)
                .where(
                    TriageResult.user_id == user_id,
                    TriageResult.thread_id.in_(thread_ids)
                )
            )
            existing_triage_results = existing_triage_query.scalars().all()
            existing_triage_map = {r.thread_id: r.message_count for r in existing_triage_results}
        else:
            existing_triage_map = {}
        
        # Filter threads that need triage
        threads_to_triage = []
        skipped_count = 0
        
        for thread in normalized_threads:
            thread_id = thread.get('thread_id')
            if not thread_id:
                continue
            
            current_message_count = thread.get('message_count', 0)
            existing_message_count = existing_triage_map.get(thread_id)
            
            if existing_message_count is None:
                threads_to_triage.append(thread)
            elif current_message_count > existing_message_count:
                threads_to_triage.append(thread)
            else:
                skipped_count += 1
        
        total_to_triage = len(threads_to_triage)
        
        if not threads_to_triage:
            yield f"data: {json.dumps({'type': 'complete', 'success': True, 'processed_count': 0, 'results': [], 'message': f'No new threads to triage. {skipped_count} threads already triaged with no new messages.'})}\n\n"
            return
        
        yield f"data: {json.dumps({'type': 'status', 'message': f'Found {total_to_triage} threads to triage ({skipped_count} skipped)'})}\n\n"
        await asyncio.sleep(0.1)
        
        # Progress tracking
        progress_steps = []
        lock = threading.Lock()
        
        def progress_callback(current: int, total: int, result: dict):
            with lock:
                progress_steps.append({
                    'current': current,
                    'total': total,
                    'progress': int((current / total) * 100) if total > 0 else 0
                })
        
        # Run triage in a separate thread to avoid blocking
        triage_results = []
        error_occurred = [False]
        error_message = [None]
        
        def run_triage():
            try:
                triage_agent = TriageAgent()
                # Use concurrent processing with 4 workers
                results = triage_agent.triage_batch(
                    threads_to_triage, 
                    progress_callback=progress_callback,
                    max_workers=4
                )
                triage_results.extend(results)
            except Exception as e:
                error_occurred[0] = True
                error_message[0] = str(e)
        
        # Start triage in background thread
        triage_thread = threading.Thread(target=run_triage)
        triage_thread.start()
        
        # Stream progress updates
        last_progress = -1
        while triage_thread.is_alive():
            await asyncio.sleep(0.3)  # Check every 300ms
            
            with lock:
                if progress_steps:
                    latest = progress_steps[-1]
                    if latest['progress'] != last_progress:
                        yield f"data: {json.dumps({'type': 'progress', 'current': latest['current'], 'total': latest['total'], 'progress': latest['progress']})}\n\n"
                        last_progress = latest['progress']
        
        # Wait for thread to complete
        triage_thread.join()
        
        if error_occurred[0]:
            yield f"data: {json.dumps({'type': 'error', 'error': error_message[0]})}\n\n"
            return
        
        # Save to database
        yield f"data: {json.dumps({'type': 'status', 'message': 'Saving results to database...'})}\n\n"
        await asyncio.sleep(0.1)
        
        saved_results = []
        for result in triage_results:
            thread_id = result.get("thread_id")
            if not thread_id:
                continue
            
            # Find the corresponding thread to get message_count
            thread_message_count = None
            for thread in threads_to_triage:
                if thread.get('thread_id') == thread_id:
                    thread_message_count = thread.get('message_count', 0)
                    break
            
            # Check if result already exists
            existing = await db.execute(
                select(TriageResult).where(
                    TriageResult.user_id == user_id,
                    TriageResult.thread_id == thread_id
                )
            )
            existing_result = existing.scalar_one_or_none()
            
            if existing_result:
                existing_result.label = result["label"]
                existing_result.priority = result["priority"]
                existing_result.summary = result["summary"]
                existing_result.key_points = result.get("key_points", [])
                existing_result.message_count = thread_message_count
                existing_result.email = active_email  # Update email in case it changed or was missing
                existing_result.updated_at = datetime.utcnow()
                db_result = existing_result
            else:
                db_result = TriageResult(
                    user_id=user_id,
                    thread_id=thread_id,
                    email=active_email,
                    label=result["label"],
                    priority=result["priority"],
                    summary=result["summary"],
                    key_points=result.get("key_points", []),
                    message_count=thread_message_count
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
        
        # Send final result
        yield f"data: {json.dumps({'type': 'complete', 'success': True, 'processed_count': len(saved_results), 'results': saved_results, 'message': f'Successfully triaged {len(saved_results)} threads'})}\n\n"
        
    except Exception as e:
        error_str = str(e)
        print(f"Error in stream_triage_progress: {e}")
        yield f"data: {json.dumps({'type': 'error', 'error': error_str})}\n\n"


@router.post("/triage/run")
async def run_triage(
    request: Request,
    triage_request: TriageRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Run triage on email threads with progress streaming (SSE)
    
    This endpoint streams progress updates via Server-Sent Events:
    1. Fetches normalized threads from Gmail API
    2. Runs Triage Agent on each thread (with progress updates)
    3. Saves results to database
    4. Returns triage results
    
    Progress events:
    - type: 'status' - Status message
    - type: 'progress' - Progress update (current, total, progress %)
    - type: 'complete' - Final result
    - type: 'error' - Error occurred
    """
    return StreamingResponse(
        stream_triage_progress(triage_request, request, db),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/triage/run-sync", response_model=TriageResponse)
async def run_triage_sync(
    request: Request,
    triage_request: TriageRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Run triage on email threads (synchronous version, kept for backward compatibility)
    
    This endpoint:
    1. Fetches normalized threads from Gmail API
    2. Runs Triage Agent on each thread
    3. Saves results to database
    4. Returns triage results
    
    Note: Use /triage/run for progress streaming instead.
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
        
        # Determine which email is being triaged to store with results
        active_email = triage_request.email
        if not active_email:
            from app.models import UserEmail
            primary_res = await db.execute(
                select(UserEmail).where(
                    UserEmail.user_id == user_id, 
                    UserEmail.is_primary == True
                )
            )
            primary_email_obj = primary_res.scalar_one_or_none()
            active_email = primary_email_obj.email if primary_email_obj else None
            
        gmail_service = GmailService(credentials)
        
        # Get normalized threads
        max_results = triage_request.max_results or 100  # Default to 100 for better coverage
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
        
        # Smart filtering: Only triage threads that are new or have new messages
        thread_ids = [t.get('thread_id') for t in normalized_threads if t.get('thread_id')]
        
        # Batch query existing triage results
        if thread_ids:
            existing_triage_query = await db.execute(
                select(TriageResult)
                .where(
                    TriageResult.user_id == user_id,
                    TriageResult.thread_id.in_(thread_ids)
                )
            )
            existing_triage_results = existing_triage_query.scalars().all()
            existing_triage_map = {r.thread_id: r.message_count for r in existing_triage_results}
        else:
            existing_triage_map = {}
        
        # Filter threads that need triage
        threads_to_triage = []
        skipped_count = 0
        
        for thread in normalized_threads:
            thread_id = thread.get('thread_id')
            if not thread_id:
                continue
            
            current_message_count = thread.get('message_count', 0)
            existing_message_count = existing_triage_map.get(thread_id)
            
            if existing_message_count is None:
                # New thread, needs triage
                threads_to_triage.append(thread)
            elif current_message_count > existing_message_count:
                # Thread has new messages, needs update
                threads_to_triage.append(thread)
            else:
                # Thread exists and has no new messages, skip
                skipped_count += 1
        
        print(f"Smart filtering: {len(threads_to_triage)} threads need triage, {skipped_count} threads skipped (no new messages)")
        
        if not threads_to_triage:
            return TriageResponse(
                success=True,
                processed_count=0,
                results=[],
                message=f"No new threads to triage. {skipped_count} threads already triaged with no new messages."
            )
        
        # Run Triage Agent only on threads that need triage
        print(f"Running triage on {len(threads_to_triage)} threads (skipped {skipped_count} with no new messages)...")
        triage_agent = TriageAgent()
        # Use concurrent processing with 4 workers
        triage_results = triage_agent.triage_batch(threads_to_triage, max_workers=4)
        
        # Save to database
        saved_results = []
        for result in triage_results:
            thread_id = result.get("thread_id")
            if not thread_id:
                continue
            
            # Find the corresponding thread to get message_count
            thread_message_count = None
            for thread in threads_to_triage:
                if thread.get('thread_id') == thread_id:
                    thread_message_count = thread.get('message_count', 0)
                    break
            
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
                existing_result.message_count = thread_message_count  # Update message count
                existing_result.email = active_email  # Update email
                existing_result.updated_at = datetime.utcnow()
                db_result = existing_result
            else:
                # Create new
                db_result = TriageResult(
                    user_id=user_id,
                    thread_id=thread_id,
                    email=active_email,
                    label=result["label"],
                    priority=result["priority"],
                    summary=result["summary"],
                    key_points=result.get("key_points", []),
                    message_count=thread_message_count  # Save message count
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


@router.get("/triage/stats")
async def get_triage_stats(
    request: Request,
    background_tasks: BackgroundTasks,
    email: Optional[str] = None,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get stats about pending triage items
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        # Trigger background sync and embedding whenever stats are checked
        # Use force=False to respect the 1-hour cooldown period
        background_tasks.add_task(sync_and_embed_emails, user_id, email, days, False)

        async def _pending_for_email(target_email: str) -> int:
            """Compute pending triage count for a single email account."""
            # 1. Get credentials and Gmail service
            credentials = await get_user_credentials(request, target_email, db)
            gmail_service = GmailService(credentials)
            
            # 2. Get recent threads from Gmail
            raw_threads = gmail_service.get_threads(max_results=50, days=days)
            if not raw_threads:
                return 0
                
            # 3. Normalize and get thread IDs
            thread_ids = []
            thread_message_counts = {}
            for raw in raw_threads:
                normalized = gmail_service.normalize_thread(raw)
                if normalized and normalized.get('thread_id'):
                    tid = normalized['thread_id']
                    thread_ids.append(tid)
                    thread_message_counts[tid] = normalized.get('message_count', 0)
            
            if not thread_ids:
                return 0
                
            # 4. Check database for existing triage results
            query = select(TriageResult).where(
                TriageResult.user_id == user_id,
                TriageResult.thread_id.in_(thread_ids)
            )
            result = await db.execute(query)
            existing_results = result.scalars().all()
            existing_map = {r.thread_id: r.message_count for r in existing_results}
            
            # 5. Count how many need triage (new or updated)
            pending = 0
            for tid in thread_ids:
                existing_count = existing_map.get(tid)
                current_count = thread_message_counts.get(tid, 0)
                
                if existing_count is None or current_count > existing_count:
                    pending += 1
            return pending

        # If email is provided, compute stats for that account only (backward compatible)
        if email:
            pending_count = await _pending_for_email(email)
            return {
                "success": True,
                "pending_count": pending_count
            }

        # Otherwise, aggregate pending counts across all user's verified email accounts
        from app.models import UserEmail
        result = await db.execute(
            select(UserEmail).where(UserEmail.user_id == user_id)
        )
        user_emails = result.scalars().all()

        if not user_emails:
            return {"success": True, "pending_count": 0}

        total_pending = 0
        for ue in user_emails:
            try:
                total_pending += await _pending_for_email(ue.email)
            except Exception as e:
                # Log but continue with other accounts
                print(f"Error computing triage stats for {ue.email}: {e}")

        return {
            "success": True,
            "pending_count": total_pending
        }
    except Exception as e:
        print(f"Error getting triage stats: {e}")
        return {"success": False, "pending_count": 0, "error": str(e)}


@router.get("/triage/results")
async def get_triage_results(
    request: Request,
    email: Optional[str] = None,  # Can now be used for filtering
    label: Optional[str] = None,
    days: Optional[int] = Query(None, ge=1, le=90),
    limit: int = 50,
    skip: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get triage results for the current user
    
    Query parameters:
    - email: Filter by source email
    - label: Filter by label (NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE)
    - days: Filter by number of days (created_at)
    - limit: Maximum number of results
    - skip: Number of results to skip (for pagination)
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        # Build query
        query = select(TriageResult).where(TriageResult.user_id == user_id)
        
        if email:
            query = query.where(TriageResult.email == email)
            
        if label:
            query = query.where(TriageResult.label == label)

        if days:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            query = query.where(TriageResult.created_at >= cutoff_date)
        
        query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc())
        query = query.offset(skip).limit(limit)
        
        result = await db.execute(query)
        triage_results = result.scalars().all()
        
        # Get total count for pagination info
        from sqlalchemy import func
        count_query = select(func.count()).select_from(TriageResult).where(TriageResult.user_id == user_id)
        if email:
            count_query = count_query.where(TriageResult.email == email)
        if label:
            count_query = count_query.where(TriageResult.label == label)
        if days:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            count_query = count_query.where(TriageResult.created_at >= cutoff_date)
            
        count_result = await db.execute(count_query)
        total_count = count_result.scalar()
        
        results = []
        for tr in triage_results:
            results.append({
                "id": tr.id,
                "thread_id": tr.thread_id,
                "email": tr.email,
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
            "total_count": total_count,
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
