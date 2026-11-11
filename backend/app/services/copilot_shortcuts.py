"""Read-only Copilot shortcuts with predictable cost and no model call."""
import asyncio
import re

from app.services.calendar_service import upcoming_calendar_events
from app.services.follow_ups import follow_up_timezone, list_follow_up_records
from app.services.mail_search import summarize_threads
from app.services.priority_lookup import lookup_priority


SEARCHES = {
    "unread": ("is:unread newer_than:7d", "Unread conversations from the last seven days"),
    "attachments": ("has:attachment filename:pdf newer_than:30d", "Recent conversations with PDF attachments"),
}


def _markdown(value):
    return re.sub(r"([\\`*_[\]<>])", r"\\\1", str(value or "").replace("\n", " "))


async def run_quick_action(action, db, user_id, services, account, credentials, report, *, local_timezone=None):
    if action == "reply_queue":
        name = "get_important_emails"
        heading = "High-priority conversations marked for reply"
    elif action == "follow_ups":
        name, heading = "list_follow_ups", "Open follow-ups"
    elif action == "agenda":
        name, args, heading = "list_upcoming_events", {"days": 7, "limit": 8}, "Calendar for the next seven days"
    else:
        query, heading = SEARCHES[action]
        name, args = "search_mailbox", {"query": query, "limit": 8}

    report({"type": "tool_call", "tool": name, "status": "calling"})
    if action == "reply_queue":
        result = await lookup_priority(db, user_id, label="NEEDS_REPLY", priority_min=0.5, days=7, limit=8)
        if not result["success"]:
            return {"success": False, "error": "Could not read the list of emails that need a reply."}
        rows = result["results"]
    elif action == "follow_ups":
        if account is None:
            return {"success": False, "error": "Select a connected mailbox to see its follow-ups."}
        result = await list_follow_up_records(db, user_id, email=account, limit=8)
        rows = result["items"]
    elif action == "agenda":
        if credentials is None:
            return {"success": False, "error": "Connect the selected mailbox to view its calendar."}
        rows = await asyncio.to_thread(upcoming_calendar_events, credentials, **args)
    else:
        service = services.get(account)
        if service is None:
            return {"success": False, "error": "Connect the selected mailbox to search its emails."}
        rows = await asyncio.to_thread(summarize_threads, service, args["query"], args["limit"])
    report({"type": "tool_result", "tool": name, "status": "success", "summary": f"{len(rows)} result(s)"})

    sources = []
    lines = []
    for row in rows:
        if action == "agenda":
            start = row.get("start") or {}
            when = start.get("dateTime") or start.get("date") or ""
            lines.append(f'- **{_markdown(row["title"])}** · {_markdown(when)}')
        else:
            title = row.get("subject") or ""
            label = title or row.get("summary") or "Conversation"
            detail = ""
            if action == "follow_ups":
                status = {"reply": "I need to reply", "waiting": "Waiting for reply", "later": "Handle later"}[row["status"]]
                due = row.get("due_at")
                detail = f" · {status}"
                if due:
                    when = due.astimezone(follow_up_timezone(local_timezone)).strftime("%b %d, %H:%M")
                    detail += f" · Due {_markdown(when)}"
            lines.append(f'- {_markdown(label)} ({row["thread_id"]}){detail}')
            sources.append({
                "thread_id": row["thread_id"], "subject": title[:160],
                "email": row.get("email_account") or row.get("email") or account,
            })

    empty = {
        "reply_queue": "No matching priority results.",
        "follow_ups": "No open follow-ups in the selected mailbox.",
    }.get(action, "No matches in this time range.")
    return {
        "success": True,
        "answer": f"**{heading}**\n\n" + ("\n".join(lines) if lines else empty),
        "citations": [f'Thread {item["thread_id"]}' for item in sources],
        "sources": sources,
        "tool_calls": [{"tool": name, "result": {"success": True}}],
        "thinking_steps": [],
        "mode": "direct",
    }
