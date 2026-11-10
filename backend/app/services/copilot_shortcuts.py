"""Read-only Copilot shortcuts with predictable cost and no model call."""
import asyncio
import re

from app.services.calendar_service import upcoming_calendar_events
from app.services.mail_search import summarize_threads
from app.services.priority_lookup import lookup_priority


SEARCHES = {
    "unread": ("is:unread newer_than:7d", "Unread conversations from the last seven days"),
    "attachments": ("has:attachment filename:pdf newer_than:30d", "Recent conversations with PDF attachments"),
}


def _markdown(value):
    return re.sub(r"([\\`*_[\]<>])", r"\\\1", str(value or "").replace("\n", " "))


async def run_quick_action(action, db, user_id, services, account, credentials, report):
    if action == "reply_queue":
        name = "get_important_emails"
        heading = "High-priority conversations marked for reply"
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
            lines.append(f'- {_markdown(label)} ({row["thread_id"]})')
            sources.append({
                "thread_id": row["thread_id"], "subject": title[:160],
                "email": row.get("email_account") or row.get("email") or account,
            })

    empty = ("No matching priority results. Select Check emails to check for new messages."
             if action == "reply_queue" else "No matches in this time range.")
    return {
        "success": True,
        "answer": f"**{heading}**\n\n" + ("\n".join(lines) if lines else empty),
        "citations": [f'Thread {item["thread_id"]}' for item in sources],
        "sources": sources,
        "tool_calls": [{"tool": name, "result": {"success": True}}],
        "thinking_steps": [],
        "mode": "direct",
    }
