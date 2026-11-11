"""Write metadata triage from either the mailbox worker or browser fallback."""
from sqlalchemy import case, func
from sqlalchemy.dialects.postgresql import insert

from app.models import TriageResult


async def write_triage_results(db, rows):
    if not rows:
        return
    statement = insert(TriageResult).values(rows)
    incoming = statement.excluded
    same_mailbox = TriageResult.email.is_not_distinct_from(incoming.email)
    newer_inbound = same_mailbox & (TriageResult.last_inbound_at_ms < incoming.last_inbound_at_ms)
    replace_result = (
        TriageResult.message_count.is_(None) |
        (TriageResult.message_count < incoming.message_count) |
        ((TriageResult.message_count == incoming.message_count) &
         (TriageResult.ai_reviewed_through_ms < incoming.ai_reviewed_through_ms)) |
        (newer_inbound & (TriageResult.last_inbound_at_ms > 0))
    )
    mailbox_changed = replace_result & TriageResult.email.is_distinct_from(incoming.email)
    reopen = newer_inbound & (
        (TriageResult.last_inbound_at_ms > 0) |
        (func.to_timestamp(incoming.last_inbound_at_ms / 1000.0) > TriageResult.reviewed_at)
    )

    await db.execute(statement.on_conflict_do_update(
        constraint="unique_user_thread_triage",
        set_={field: case((replace_result, getattr(incoming, field)), else_=getattr(TriageResult, field))
              for field in ("email", "label", "priority", "summary", "key_points", "message_count", "ai_reviewed")} | {
            "ai_reviewed_through_ms": case(
                (mailbox_changed, incoming.ai_reviewed_through_ms),
                else_=func.greatest(TriageResult.ai_reviewed_through_ms, incoming.ai_reviewed_through_ms),
            ),
            "last_inbound_at_ms": case(
                (mailbox_changed, incoming.last_inbound_at_ms),
                else_=func.greatest(TriageResult.last_inbound_at_ms, incoming.last_inbound_at_ms),
            ),
            "reviewed_at": case((mailbox_changed | reopen, None), else_=TriageResult.reviewed_at),
            "updated_at": case((replace_result, func.now()), else_=TriageResult.updated_at),
        },
        where=replace_result | newer_inbound,
    ))
