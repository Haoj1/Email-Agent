"""
Triage API routes - Email classification and prioritization
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, AsyncGenerator, Literal
from pydantic import BaseModel, Field, StrictBool
from googleapiclient.errors import HttpError
from datetime import datetime, timedelta, timezone
import json
import asyncio
from jose import JWTError, jwt
from app.config import settings
from app.database import get_db
from app.routes.auth import get_user_credentials, get_current_user_id
from app.services.gmail_service import GmailService
from app.services.follow_ups import latest_inbound_at, reopen_follow_ups
from app.services.triage_rules import classify_metadata
from app.services.triage_store import write_triage_results
from app.models import TriageResult, User, UserEmail
from sqlalchemy import func, or_, select, update

router = APIRouter()


class TriageRequest(BaseModel):
    """Request model for triage"""
    max_results: Optional[int] = 5  # Small batch for testing
    days: Optional[int] = 7
    email: Optional[str] = None
    cursor: Optional[str] = Field(default=None, max_length=4096)
    automatic: bool = False
    checkpoint: Optional[str] = Field(default=None, max_length=4096)


class TriageResponse(BaseModel):
    """Response model for triage results"""
    success: bool
    processed_count: int
    results: List[dict]
    message: str


def _triage_event(kind, **fields):
    return f"data: {json.dumps({'type': kind, **fields})}\n\n"


def _triage_token(value, user_id, email, kind):
    data = jwt.decode(value, settings.SESSION_SECRET, algorithms=["HS256"], options={"require_exp": True})
    if data.get("kind") != kind or data.get("user_id") != user_id or data.get("email") != email:
        raise JWTError("Invalid mailbox cursor")
    return data


NON_PRIMARY_LABELS = {"CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"}
NON_INBOUND_LABELS = {"SENT", "DRAFT", "SPAM", "TRASH", "CHAT"}


def _review_candidates(messages, mode, cutoff_ms, rule_label):
    if mode == "unclear":
        messages = messages[-1:] if rule_label == "REVIEW" else ()
    candidates = []
    for message in messages:
        stamp = int(message.get("internalDate") or 0)
        labels = set(message.get("labelIds") or ())
        if stamp <= cutoff_ms or labels & NON_INBOUND_LABELS:
            continue
        if mode == "primary_important" and not (
            "IMPORTANT" in labels or "CATEGORY_PERSONAL" in labels or
            ("INBOX" in labels and not labels & NON_PRIMARY_LABELS)
        ):
            continue
        candidates.append((stamp, message))
    return candidates


async def _review_messages(service, candidates, mode, request):
    from app.agents.batch_triage import review_batch

    reviewed = {}
    calls = 0
    unavailable = False
    for offset in range(0, len(candidates), 25):
        if await request.is_disconnected():
            break
        page = candidates[offset:offset + 25]
        calls += 1
        try:
            batch = await asyncio.to_thread(review_batch, page)
        except Exception as exc:
            print(f"Triage preview review unavailable: {type(exc).__name__}")
            unavailable = True
            continue
        reviewed.update(batch)
        unavailable |= len(batch) != len(page)
        if mode != "primary_important":
            continue
        follow_up = [item for item in page if batch.get(item["thread_id"], {}).get("label") == "REVIEW"]
        for start in range(0, len(follow_up), 10):
            if await request.is_disconnected():
                return reviewed, calls, unavailable
            bodies = {}
            body_items = []
            for item in follow_up[start:start + 10]:
                message_id = item["thread_id"]
                try:
                    body = await asyncio.to_thread(service.get_message_text, message_id)
                except HttpError as exc:
                    if exc.resp.status != 404:
                        print(f"Triage body unavailable: {type(exc).__name__}")
                        reviewed.pop(message_id, None)
                        unavailable = True
                    continue
                if body:
                    bodies[message_id] = body[:1600]
                    body_items.append(item)
            if body_items and not await request.is_disconnected():
                calls += 1
                try:
                    refined = await asyncio.to_thread(review_batch, body_items, bodies=bodies)
                except Exception as exc:
                    print(f"Triage body review unavailable: {type(exc).__name__}")
                    refined = {}
                for item in body_items:
                    reviewed.pop(item["thread_id"], None)
                reviewed.update(refined)
                unavailable |= len(refined) != len(body_items)
    return reviewed, calls, unavailable


async def stream_triage_progress(
    triage_request: TriageRequest, request: Request, db: AsyncSession, user_id: int
) -> AsyncGenerator[str, None]:
    """Process and commit a bounded Gmail page before advertising its continuation."""
    page_token = None
    try:
        credentials = await get_user_credentials(request, triage_request.email, db)
        email = triage_request.email or await db.scalar(
            select(UserEmail.email).where(UserEmail.user_id == user_id, UserEmail.is_primary.is_(True))
        )
        mode, review_since = (await db.execute(
            select(User.ai_review_mode, User.ai_review_since).where(User.id == user_id)
        )).one()
        if not review_since:
            mode = "off"
        cutoff_ms = int(review_since.timestamp() * 1000) if review_since else 0
        days = max(1, min(triage_request.days or 7, 30))
        page_size = max(1, min(triage_request.max_results or 25, 25))
        now = datetime.now(timezone.utc)
        through = int(now.timestamp())
        start = int((now - timedelta(days=days)).timestamp())
        if cutoff_ms and settings.MAILBOX_SYNC_ENABLED:
            start = cutoff_ms // 1000
        elif cutoff_ms:
            start = min(start, cutoff_ms // 1000)
        review_scope = [mode, cutoff_ms]
        retry_from = None
        if triage_request.checkpoint:
            try:
                checkpoint = _triage_token(triage_request.checkpoint, user_id, email, "triage-checkpoint")
                # An overlapping checkpoint is safe only within the same preference scope.
                if checkpoint.get("review_scope") == review_scope or (mode == "off" and "review_scope" not in checkpoint):
                    start = max(start, min(int(checkpoint["through"]), through) - 600)
            except (JWTError, KeyError, TypeError, ValueError):
                pass
        query = f"after:{start} before:{through}"
        if triage_request.cursor:
            try:
                saved = _triage_token(triage_request.cursor, user_id, email, "triage")
                if saved.get("review_scope") != review_scope and (mode != "off" or "review_scope" in saved):
                    raise JWTError("Review scope changed")
                query, page_token, page_size = saved["query"], saved["page_token"], saved["page_size"]
                retry_from = saved.get("retry_from")
                through = int(query.rsplit("before:", 1)[1])
            except (JWTError, KeyError, TypeError, ValueError, IndexError):
                yield _triage_event("error", code="cursor_expired", error="This scan expired. A fresh scan can continue.")
                return

        yield _triage_event("status", message="Checking recent email subjects and previews…")
        service = GmailService(credentials)
        raw, next_token = await asyncio.to_thread(
            service.get_thread_page, page_size, days, query=query, page_token=page_token, strict=True
        )
        reopened = await reopen_follow_ups(db, user_id, email, raw)
        raw_threads = {item["id"]: item for item in raw}
        inbound = {thread_id: latest_inbound_at(item, email) if email else 0
                   for thread_id, item in raw_threads.items()}
        threads = [thread for item in raw if (thread := service.normalize_thread(item, message_limit=3))]
        counts = {thread["thread_id"]: thread["message_count"] for thread in threads}
        existing = {row.thread_id: row for row in (await db.execute(
            select(TriageResult.thread_id, TriageResult.message_count, TriageResult.ai_reviewed_through_ms,
                   TriageResult.last_inbound_at_ms).where(
                TriageResult.user_id == user_id, TriageResult.email == email, TriageResult.thread_id.in_(counts)
            )
        )).all()} if counts else {}
        await db.commit()

        results = {}
        candidates = {}
        previews = []
        for thread in threads:
            thread_id = thread["thread_id"]
            previous = existing.get(thread_id)
            rule = classify_metadata(thread)
            if (previous is None or previous.message_count is None or counts[thread_id] > previous.message_count
                    or inbound[thread_id] > previous.last_inbound_at_ms):
                results[thread_id] = rule
            if mode == "off":
                continue
            reviewed_through = previous.ai_reviewed_through_ms if previous else 0
            eligible = _review_candidates(raw_threads[thread_id]["messages"], mode,
                                          max(cutoff_ms, reviewed_through), rule["label"])
            if eligible:
                candidates[thread_id] = sorted(eligible, key=lambda candidate: candidate[0])
                previews.extend(service.normalize_thread({"id": message["id"], "messages": [message]})
                                for _, message in eligible)

        skipped = len(threads) - len(results)
        ai_calls = 0
        ai_reviewed = 0
        ai_unavailable = False
        reviewed_through = {}
        if previews:
            yield _triage_event("status", message=f"AI reviewing {len(previews)} new email previews…")
            reviewed, ai_calls, ai_unavailable = await _review_messages(service, previews, mode, request)
            for thread_id, entries in candidates.items():
                if not all(message["id"] in reviewed for _, message in entries):
                    first = entries[0][0] // 1000
                    retry_from = first if retry_from is None else min(first, retry_from)
                    continue
                decisions = [reviewed[message["id"]] for _, message in entries]
                # Keep the most actionable decision and retain the rest as key points.
                lead = max(reversed(decisions), key=lambda decision: decision["priority"])
                results[thread_id] = {
                    **lead, "thread_id": thread_id,
                    "key_points": [decision["summary"] for decision in decisions if decision is not lead][-5:],
                }
                reviewed_through[thread_id] = entries[-1][0]
                ai_reviewed += len(decisions)

        yield _triage_event("progress", current=len(threads), total=len(threads), progress=100)

        saved_rows = [{
            "user_id": user_id, "thread_id": row["thread_id"], "email": email,
            "label": row["label"], "priority": row["priority"], "summary": row["summary"],
            "key_points": row.get("key_points", []), "message_count": counts[row["thread_id"]],
            "ai_reviewed": row["thread_id"] in reviewed_through,
            "ai_reviewed_through_ms": reviewed_through.get(row["thread_id"], 0),
            "last_inbound_at_ms": inbound[row["thread_id"]],
        } for row in results.values()]

        await write_triage_results(db, saved_rows)
        await db.commit()
        cursor = jwt.encode({
            "kind": "triage", "user_id": user_id, "email": email, "query": query,
            "page_token": next_token, "page_size": page_size, "review_scope": review_scope,
            "retry_from": retry_from, "exp": now + timedelta(hours=8),
        }, settings.SESSION_SECRET, algorithm="HS256") if next_token else None
        checkpoint = jwt.encode({
            "kind": "triage-checkpoint", "user_id": user_id, "email": email,
            "through": min(through, retry_from) if retry_from is not None else through,
            "review_scope": review_scope, "exp": now + timedelta(days=7),
        }, settings.SESSION_SECRET, algorithm="HS256") if not next_token else None
        yield _triage_event("complete", success=True, scanned_count=len(threads), skipped_count=skipped,
                            processed_count=len(saved_rows), next_cursor=cursor, checkpoint=checkpoint,
                            follow_ups_reopened=reopened,
                            ai_calls=ai_calls, ai_reviewed=ai_reviewed, ai_unavailable=ai_unavailable,
                            results=[{key: value for key, value in row.items() if key != "user_id"} for row in saved_rows])
    except HttpError as exc:
        if page_token and exc.resp.status in (400, 404):
            yield _triage_event("error", code="cursor_expired", error="This scan expired. A fresh scan can continue.")
        else:
            yield _triage_event("error", error="Gmail could not be checked. Try again shortly.")
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
    review_status: Literal["all", "pending", "reviewed"] = "all",
    limit: int = 50,
    skip: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """List the authenticated user's triage results and optionally filter by review status."""
    user_id = await get_current_user_id(request, db)
    filters = [TriageResult.user_id == user_id]
    if email:
        filters.append(TriageResult.email == email)
    if label:
        filters.append(TriageResult.label == label)
    if review_status == "pending":
        filters.append(TriageResult.reviewed_at.is_(None))
    elif review_status == "reviewed":
        filters.append(TriageResult.reviewed_at.is_not(None))

    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        if review_status == "reviewed":
            filters.append(TriageResult.reviewed_at >= cutoff)
        elif review_status == "pending":
            filters.append(or_(TriageResult.created_at >= cutoff,
                               TriageResult.last_inbound_at_ms >= int(cutoff.timestamp() * 1000)))
        else:
            filters.append(TriageResult.created_at >= cutoff)

    query = select(TriageResult).where(*filters)
    query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc(), TriageResult.id.desc())
    results = (await db.scalars(query.offset(skip).limit(limit))).all()
    total_count = await db.scalar(select(func.count()).select_from(TriageResult).where(*filters))
    return {
        "success": True,
        "count": len(results),
        "total_count": total_count,
        "results": [{
            "id": result.id,
            "thread_id": result.thread_id,
            "email": result.email,
            "label": result.label,
            "priority": result.priority,
            "summary": result.summary,
            "key_points": result.key_points or [],
            "created_at": result.created_at.isoformat() if result.created_at else None,
            "updated_at": result.updated_at.isoformat() if result.updated_at else None,
            "reviewed_at": result.reviewed_at.isoformat() if result.reviewed_at else None,
            "last_inbound_at_ms": result.last_inbound_at_ms,
        } for result in results],
    }


class TriageReviewUpdate(BaseModel):
    reviewed: StrictBool
    email: str | None
    last_inbound_at_ms: int = Field(ge=0)


@router.patch("/triage/results/{result_id}/review")
async def set_triage_review(
    result_id: int, body: TriageReviewUpdate, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = await get_current_user_id(request, db)
    owner_filter = (TriageResult.id == result_id, TriageResult.user_id == user_id)
    reviewed_at = func.coalesce(TriageResult.reviewed_at, func.now()) if body.reviewed else None
    result = (await db.execute(
        update(TriageResult).where(
            *owner_filter, TriageResult.email.is_not_distinct_from(body.email),
            TriageResult.last_inbound_at_ms == body.last_inbound_at_ms,
        ).values(reviewed_at=reviewed_at, updated_at=TriageResult.updated_at).returning(TriageResult.reviewed_at)
    )).one_or_none()
    if result is None:
        if await db.scalar(select(TriageResult.id).where(*owner_filter)) is None:
            raise HTTPException(404, "Triage result not found")
        raise HTTPException(409, "This conversation changed. Open the latest version to review it.")
    await db.commit()
    return {"reviewed_at": result.reviewed_at.isoformat() if result.reviewed_at else None}


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
