"""Write metadata triage from either the mailbox worker or browser fallback."""
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app.models import TriageResult


async def write_triage_results(db, rows):
    if not rows:
        return
    statement = insert(TriageResult).values(rows)
    await db.execute(statement.on_conflict_do_update(
        constraint="unique_user_thread_triage",
        set_={field: getattr(statement.excluded, field) for field in (
            "email", "label", "priority", "summary", "key_points", "message_count", "ai_reviewed"
        )} | {"updated_at": func.now()},
        where=(TriageResult.message_count.is_(None) |
               (TriageResult.message_count < statement.excluded.message_count) |
               ((TriageResult.message_count == statement.excluded.message_count) &
                (TriageResult.label == "REVIEW") & ~TriageResult.ai_reviewed & statement.excluded.ai_reviewed)),
    ))
