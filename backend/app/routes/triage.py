"""
Triage API routes - Email classification and prioritization
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, AsyncGenerator
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, timezone
import json
import asyncio
from jose import JWTError, jwt
from sqlalchemy.dialects.postgresql import insert
from app.config import settings
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.services.triage_rules import classify_metadata
from app.models import TriageResult, User, UserEmail
from sqlalchemy import select

router = APIRouter()


class TriageRequest(BaseModel):
    """Request model for triage"""
    max_results: Optional[int] = 5  # Small batch for testing
    days: Optional[int] = 7
    email: Optional[str] = None
    cursor: Optional[str] = Field(default=None, max_length=4096)
    review_unclear: bool = False


class TriageResponse(BaseModel):
    """Response model for triage results"""
    success: bool
    processed_count: int
    results: List[dict]
    message: str


def _triage_event(kind, **fields):
    return f"data: {json.dumps({'type': kind, **fields})}\n\n"


def _triage_cursor(value, user_id, email):
    data = jwt.decode(value, settings.SESSION_SECRET, algorithms=["HS256"], options={"require_exp": True})
    if data.get("kind") != "triage" or data.get("user_id") != user_id or data.get("email") != email:
        raise JWTError("Invalid mailbox cursor")
    return data


async def stream_triage_progress(
    triage_request: TriageRequest, request: Request, db: AsyncSession, user_id: int
) -> AsyncGenerator[str, None]:
    """Process and commit a bounded Gmail page before advertising its continuation."""
    try:
        credentials = await get_user_credentials(request, triage_request.email, db)
        email = triage_request.email or await db.scalar(
            select(UserEmail.email).where(UserEmail.user_id == user_id, UserEmail.is_primary.is_(True))
        )
        days = max(1, min(triage_request.days or 7, 30))
        page_size = max(1, min(triage_request.max_results or 25, 25))
        now = datetime.now(timezone.utc)
        start = int((now - timedelta(days=days)).timestamp())
        query = f"after:{start} before:{int(now.timestamp())}"
        page_token = None
        if triage_request.cursor:
            try:
                saved = _triage_cursor(triage_request.cursor, user_id, email)
                query, page_token, page_size = saved["query"], saved["page_token"], saved["page_size"]
            except (JWTError, KeyError, TypeError):
                yield _triage_event("error", code="cursor_expired", error="This scan expired. Start a fresh scan.")
                return

        yield _triage_event("status", message="Checking recent email subjects and previews…")
        service = GmailService(credentials)
        raw, next_token = await asyncio.to_thread(
            service.get_thread_page, page_size, days, query=query, page_token=page_token, strict=True
        )
        threads = [thread for item in raw if (thread := service.normalize_thread(item, message_limit=3))]
        counts = {thread["thread_id"]: thread["message_count"] for thread in threads}
        existing = {row.thread_id: row for row in (await db.execute(
            select(TriageResult.thread_id, TriageResult.message_count, TriageResult.label).where(
                TriageResult.user_id == user_id, TriageResult.thread_id.in_(counts)
            )
        )).all()} if counts else {}
        await db.commit()

        results = []
        uncertain = []
        for thread in threads:
            thread_id = thread["thread_id"]
            previous = existing.get(thread_id)
            changed = previous is None or previous.message_count is None or counts[thread_id] > previous.message_count
            if changed:
                result = classify_metadata(thread)
                results.append(result)
                if result["label"] == "REVIEW":
                    uncertain.append(thread)
            elif previous.label == "REVIEW":
                uncertain.append(thread)

        skipped = len(threads) - len(results)
        ai_calls = 0
        ai_reviewed = 0
        ai_unavailable = False
        if triage_request.review_unclear and uncertain:
            yield _triage_event("status", message=f"AI reviewing {len(uncertain)} unclear conversations in one batch…")
            ai_calls = 1
            try:
                from app.agents.batch_triage import review_batch

                reviewed = await asyncio.to_thread(review_batch, uncertain)
                ai_reviewed = len(reviewed)
                results = [row for row in results if row["thread_id"] not in reviewed] + list(reviewed.values())
            except Exception as exc:
                print(f"Triage batch review unavailable: {type(exc).__name__}")
                ai_unavailable = True

        yield _triage_event("progress", current=len(threads), total=len(threads), progress=100)

        saved_rows = [{
            "user_id": user_id, "thread_id": row["thread_id"], "email": email,
            "label": row["label"], "priority": row["priority"], "summary": row["summary"],
            "key_points": row.get("key_points", []), "message_count": counts[row["thread_id"]],
        } for row in results if row.get("thread_id") in counts and not row.get("classification_failed")]

        if saved_rows:
            statement = insert(TriageResult).values(saved_rows)
            statement = statement.on_conflict_do_update(
                constraint="unique_user_thread_triage",
                set_={field: getattr(statement.excluded, field) for field in (
                    "email", "label", "priority", "summary", "key_points", "message_count"
                )} | {"updated_at": datetime.now(timezone.utc)},
                where=(TriageResult.message_count.is_(None) |
                       (TriageResult.message_count < statement.excluded.message_count) |
                       ((TriageResult.message_count == statement.excluded.message_count) &
                        (TriageResult.label == "REVIEW") & (statement.excluded.label != "REVIEW"))),
            )
            await db.execute(statement)
            await db.commit()
        cursor = jwt.encode({
            "kind": "triage", "user_id": user_id, "email": email, "query": query,
            "page_token": next_token, "page_size": page_size, "exp": now + timedelta(hours=8),
        }, settings.SESSION_SECRET, algorithm="HS256") if next_token else None
        yield _triage_event("complete", success=True, scanned_count=len(threads), skipped_count=skipped,
                            processed_count=len(saved_rows), next_cursor=cursor,
                            ai_calls=ai_calls, ai_reviewed=ai_reviewed, ai_unavailable=ai_unavailable,
                            results=[{key: value for key, value in row.items() if key != "user_id"} for row in saved_rows])
    except Exception as exc:
        print(f"Triage page failed: {type(exc).__name__}")
        yield _triage_event("error", error="Could not scan this page. Try again to continue.")


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
    user_id = await get_current_user_id(request, db)
    return StreamingResponse(
        stream_triage_progress(triage_request, request, db, user_id),
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
        raw_threads = await asyncio.to_thread(gmail_service.get_threads, max_results=max_results, days=days)
        
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
        from app.agents.triage_agent import TriageAgent

        triage_agent = TriageAgent()
        # Use concurrent processing with 4 workers
        triage_results = triage_agent.triage_batch(threads_to_triage, max_workers=4)
        
        # Save to database
        saved_results = []
        for result in triage_results:
            thread_id = result.get("thread_id")
            if not thread_id or result.get("classification_failed"):
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
    email: Optional[str] = None,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get stats about pending triage items
    """
    try:
        user_id = await get_current_user_id(request, db)
        
        async def _pending_for_email(target_email: str) -> int:
            credentials = await get_user_credentials(request, target_email, db)
            gmail_service = GmailService(credentials)
            ids = await asyncio.to_thread(gmail_service.get_recent_thread_ids, 50, days)
            if not ids:
                return 0
            known = set(await db.scalars(select(TriageResult.thread_id).where(
                TriageResult.user_id == user_id, TriageResult.thread_id.in_(ids)
            )))
            return len(set(ids) - known)

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
