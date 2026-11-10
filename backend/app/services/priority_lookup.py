"""Read bounded priority records for both shortcuts and model tools."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TriageResult


async def lookup_priority(
    db: AsyncSession,
    user_id: int,
    label: Optional[str] = None,
    priority_min: Optional[float] = None,
    days: Optional[int] = None,
    limit: int = 10
) -> Dict[str, Any]:
    """Execute the query_triage_results tool asynchronously"""
    try:
        query = select(TriageResult).where(TriageResult.user_id == user_id)

        if label:
            query = query.where(TriageResult.label == label)

        if priority_min is not None:
            query = query.where(TriageResult.priority >= priority_min)

        if days:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
            query = query.where(TriageResult.created_at >= cutoff_date)

        query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc())
        query = query.limit(max(1, min(limit, 20)))

        result = await db.execute(query)
        triage_results = result.scalars().all()

        results = []
        for tr in triage_results:
            results.append({
                "thread_id": tr.thread_id,
                "email": tr.email,
                "label": tr.label,
                "priority": tr.priority,
                "summary": tr.summary,
                "key_points": tr.key_points or [],
                "created_at": tr.created_at.isoformat() if tr.created_at else None,
            })

        return {
            "success": True,
            "count": len(results),
            "results": results
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
