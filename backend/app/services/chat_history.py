"""Read recent Copilot messages with a backward-compatible legacy prefix."""
from sqlalchemy import func, select, text

from app.models import AssistChatMessage, AssistChatSession


def _message_dict(message):
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "sources": message.sources or [],
        "used_web_search": message.used_web_search,
        "timestamp": message.created_at.isoformat(),
    }


async def load_history(db, session_pk, limit, offset=0):
    """Read from newest to oldest, then return the requested page in chat order."""
    records = (await db.scalars(
        select(AssistChatMessage).where(AssistChatMessage.session_id == session_pk)
        .order_by(AssistChatMessage.id.desc()).offset(offset).limit(limit + 1)
    )).all()
    newest = [_message_dict(message) for message in records]
    if len(newest) <= limit:
        appended_count = offset + len(newest)
        if not newest and offset:
            appended_count = await db.scalar(select(func.count()).select_from(AssistChatMessage)
                                             .where(AssistChatMessage.session_id == session_pk))
        legacy = await db.scalar(select(AssistChatSession.conversation_history)
                                 .where(AssistChatSession.id == session_pk))
        if isinstance(legacy, list):
            end = max(0, len(legacy) - max(0, offset - appended_count))
            size = limit + 1 - len(newest)
            newest.extend(reversed(legacy[max(0, end - size):end]))
    return list(reversed(newest[:limit])), offset + limit if len(newest) > limit else None


def list_history_statement(user_id, limit, offset):
    legacy = AssistChatSession.conversation_history
    path = text("""'$[*] ? (@.role == "user").content'::jsonpath""")
    legacy_title = func.jsonb_path_query_first(legacy, path).op("#>>")(text("'{}'"))
    first_message = (
        select(AssistChatMessage.content)
        .where(AssistChatMessage.session_id == AssistChatSession.id, AssistChatMessage.role == "user")
        .order_by(AssistChatMessage.id).limit(1).scalar_subquery()
    )
    title = func.left(func.coalesce(legacy_title, first_message, "New conversation"), 110)
    return (
        select(AssistChatSession.session_id, AssistChatSession.created_at, AssistChatSession.updated_at,
               title.label("preview"))
        .where(AssistChatSession.user_id == user_id)
        .order_by(AssistChatSession.updated_at.desc(), AssistChatSession.id.desc()).limit(limit + 1).offset(offset)
    )
