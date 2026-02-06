from __future__ import annotations

from datetime import datetime, timedelta, time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import TriageResult
from app.routes.auth import get_current_user_id, get_user_credentials
from app.services.calendar_service import CalendarService


router = APIRouter()


class SuggestionParams(BaseModel):
    days: int = Field(7, ge=1, le=30, description="How many days ahead to schedule")
    triage_days: int = Field(3, ge=1, le=30, description="Lookback window for priority inbox results")
    email: Optional[str] = Field(None, description="Selected email account (optional)")
    max_items: int = Field(15, ge=1, le=50, description="Max suggestions to schedule")


class ConfirmRequest(BaseModel):
    email: Optional[str] = None
    suggestions: List[Dict[str, Any]]


def _parse_google_dt(dt_obj: Dict[str, Any]) -> Optional[datetime]:
    """
    Google Calendar can return either:
    - dateTime: "2026-02-06T10:00:00-08:00"
    - date: "2026-02-06" (all-day)
    """
    if not dt_obj:
        return None
    if dt_obj.get("dateTime"):
        return datetime.fromisoformat(dt_obj["dateTime"])
    if dt_obj.get("date"):
        # all-day: treat as midnight in local tz (naive date)
        return datetime.fromisoformat(dt_obj["date"])
    return None


def _merge_intervals(intervals: List[Tuple[datetime, datetime]]) -> List[Tuple[datetime, datetime]]:
    if not intervals:
        return []
    intervals = sorted(intervals, key=lambda x: x[0])
    merged: List[Tuple[datetime, datetime]] = [intervals[0]]
    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _subtract_busy(
    free: List[Tuple[datetime, datetime]],
    busy: List[Tuple[datetime, datetime]],
) -> List[Tuple[datetime, datetime]]:
    if not free:
        return []
    if not busy:
        return free
    busy = _merge_intervals(busy)
    out: List[Tuple[datetime, datetime]] = []
    for f_start, f_end in free:
        cursor = f_start
        for b_start, b_end in busy:
            if b_end <= cursor:
                continue
            if b_start >= f_end:
                break
            if b_start > cursor:
                out.append((cursor, min(b_start, f_end)))
            cursor = max(cursor, b_end)
            if cursor >= f_end:
                break
        if cursor < f_end:
            out.append((cursor, f_end))
    return out


def _round_up_to_minutes(dt: datetime, minutes: int) -> datetime:
    # Keep tzinfo
    tz = dt.tzinfo
    discard = timedelta(minutes=dt.minute % minutes, seconds=dt.second, microseconds=dt.microsecond)
    dt2 = dt - discard
    if discard:
        dt2 = dt2 + timedelta(minutes=minutes)
    return dt2.replace(tzinfo=tz)


def _default_duration_minutes(priority: float) -> int:
    if priority >= 0.8:
        return 45
    if priority >= 0.6:
        return 30
    if priority >= 0.4:
        return 20
    return 15


@router.get("/calendar/suggestions")
async def get_calendar_suggestions(
    request: Request,
    days: int = 7,
    triage_days: int = 3,
    email: Optional[str] = None,
    max_items: int = 15,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a suggested schedule from Priority Inbox results and current Calendar availability.

    Returns:
      - suggestions: list of proposed calendar events (NOT created yet)
      - busy: existing busy blocks (for UI preview)
    """
    user_id = await get_current_user_id(request, db)

    # Query priority inbox items (triage results)
    now = datetime.now().astimezone()
    lookback = now - timedelta(days=int(triage_days))

    stmt = select(TriageResult).where(
        TriageResult.user_id == user_id,
        TriageResult.updated_at >= lookback,
    )
    if email:
        stmt = stmt.where(TriageResult.email == email)

    result = await db.execute(stmt)
    rows: List[TriageResult] = list(result.scalars().all())

    # Heuristic: focus on NEEDS_REPLY or high priority
    candidates = [
        r for r in rows
        if (r.label == "NEEDS_REPLY") or (r.priority is not None and r.priority >= 0.6)
    ]
    candidates.sort(key=lambda r: (r.priority or 0.0), reverse=True)
    candidates = candidates[: int(max_items)]

    # Calendar availability
    try:
        credentials = await get_user_credentials(request, email, db)
        cal = CalendarService(credentials)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to init Calendar service: {e}")

    # Schedule window: today -> today+days
    start_window = now
    end_window = now + timedelta(days=int(days))

    # Work hours (local tz)
    work_start = time(9, 30)
    work_end = time(18, 30)
    lunch_start = time(12, 0)
    lunch_end = time(13, 0)

    # Pull existing events (busy blocks)
    try:
        events = cal.list_events(start_window.isoformat(), end_window.isoformat())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list calendar events: {e}")

    busy_blocks: List[Dict[str, Any]] = []
    busy_by_day: Dict[str, List[Tuple[datetime, datetime]]] = {}

    for ev in events:
        sdt = _parse_google_dt(ev.get("start", {}))
        edt = _parse_google_dt(ev.get("end", {}))
        if not sdt or not edt:
            continue

        # If all-day (date), treat as day-block
        day_key = sdt.astimezone().date().isoformat()
        busy_by_day.setdefault(day_key, []).append((sdt.astimezone(), edt.astimezone()))

        busy_blocks.append({
            "id": ev.get("id"),
            "summary": ev.get("summary") or "(Busy)",
            "start": ev.get("start"),
            "end": ev.get("end"),
        })

    # Pre-compute free blocks per day in window
    free_by_day: Dict[str, List[Tuple[datetime, datetime]]] = {}
    for i in range(int(days)):
        day = (now.date() + timedelta(days=i))
        tz = now.tzinfo
        day_start_dt = datetime.combine(day, work_start).replace(tzinfo=tz)
        day_end_dt = datetime.combine(day, work_end).replace(tzinfo=tz)

        # Skip time earlier than now on day 0
        if i == 0:
            day_start_dt = max(day_start_dt, _round_up_to_minutes(now, 15))

        # Lunch break
        lunch_start_dt = datetime.combine(day, lunch_start).replace(tzinfo=tz)
        lunch_end_dt = datetime.combine(day, lunch_end).replace(tzinfo=tz)

        free = [(day_start_dt, day_end_dt)]
        free = _subtract_busy(free, [(lunch_start_dt, lunch_end_dt)])

        # Subtract busy events
        day_key = day.isoformat()
        free = _subtract_busy(free, busy_by_day.get(day_key, []))
        free_by_day[day_key] = [(a, b) for a, b in free if b > a]

    # Greedy schedule
    suggestions: List[Dict[str, Any]] = []
    for item in candidates:
        priority = float(item.priority or 0.0)
        duration_min = _default_duration_minutes(priority)
        duration = timedelta(minutes=duration_min)

        # Title from summary (short) or thread id
        base = (item.summary or "").strip()
        if base:
            base = base.replace("\n", " ").strip()
            if len(base) > 60:
                base = base[:57] + "..."
            title = f"Follow up: {base}"
        else:
            title = f"Follow up: Conversation {item.thread_id}"

        placed = False
        for day_key, free_blocks in free_by_day.items():
            for idx, (f_start, f_end) in enumerate(list(free_blocks)):
                if f_end - f_start >= duration:
                    start_dt = f_start
                    end_dt = f_start + duration

                    # Update free block (consume from front)
                    new_blocks = []
                    if end_dt < f_end:
                        new_blocks.append((end_dt, f_end))
                    # keep other blocks
                    free_by_day[day_key] = new_blocks + free_blocks[idx + 1 :]

                    suggestions.append({
                        "thread_id": item.thread_id,
                        "email": item.email,
                        "label": item.label,
                        "priority": priority,
                        "title": title,
                        "duration_minutes": duration_min,
                        "start_iso": start_dt.isoformat(),
                        "end_iso": end_dt.isoformat(),
                        "source": "priority_inbox",
                    })
                    placed = True
                    break
            if placed:
                break

        # If not placed, skip (could return unscheduled in v2)

    return {
        "success": True,
        "generated_at": now.isoformat(),
        "range": {"start": start_window.isoformat(), "end": end_window.isoformat()},
        "suggestions": suggestions,
        "busy": busy_blocks,
    }


@router.post("/calendar/confirm")
async def confirm_calendar_suggestions(
    request: Request,
    payload: ConfirmRequest = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Create Google Calendar events for selected suggestions.
    """
    user_id = await get_current_user_id(request, db)
    email = payload.email

    try:
        credentials = await get_user_credentials(request, email, db)
        cal = CalendarService(credentials)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to init Calendar service: {e}")

    created: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for s in payload.suggestions:
        try:
            title = s.get("title") or "Email follow-up"
            thread_id = s.get("thread_id")
            priority = s.get("priority")
            start_iso = s.get("start_iso")
            end_iso = s.get("end_iso")
            if not start_iso or not end_iso:
                raise ValueError("Missing start/end time")

            description_lines = []
            if thread_id:
                description_lines.append(f"Conversation: {thread_id}")
            if priority is not None:
                try:
                    description_lines.append(f"Priority: {int(float(priority) * 100)}%")
                except Exception:
                    pass
            description = "\n".join(description_lines)

            event = cal.create_event({
                "summary": title,
                "description": description,
                "start": {"dateTime": start_iso},
                "end": {"dateTime": end_iso},
            })
            created.append({
                "thread_id": thread_id,
                "event_id": event.get("id"),
                "htmlLink": event.get("htmlLink"),
                "start": event.get("start"),
                "end": event.get("end"),
                "summary": event.get("summary"),
            })
        except Exception as e:
            errors.append({
                "thread_id": s.get("thread_id"),
                "error": str(e),
            })

    return {
        "success": True,
        "created_count": len(created),
        "error_count": len(errors),
        "created": created,
        "errors": errors,
    }

