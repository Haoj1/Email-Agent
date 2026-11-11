"""Read a user's follow-ups and prepare reviewable changes for the workspace."""
from datetime import date, datetime, time
from typing import Literal

from langchain_core.tools import tool
from sqlalchemy import select

from app.models import FollowUp, UserEmail
from app.services.follow_ups import FollowUpStatus, list_follow_up_records


def create_follow_up_tools(db, user_id, selected_email, mailboxes, local_zone, sources):
    @tool
    async def list_follow_ups(
        status: Literal["open", "reply", "waiting", "later", "done"] = "open",
        overdue: bool = False, mailbox: str | None = None, all_mailboxes: bool = False, limit: int = 10,
    ) -> dict:
        """Read saved Follow-ups. Use waiting for replies owed by others, reply for replies the user owes, and overdue for passed due dates. Defaults to the selected mailbox; use all_mailboxes when asked for all connected accounts."""
        account = mailbox or selected_email
        if mailbox and mailbox not in mailboxes:
            return {"success": False, "error": "That mailbox is unavailable."}
        if not account and not all_mailboxes:
            return {"success": False, "error": "Select a connected mailbox."}
        result = await list_follow_up_records(
            db, user_id, email=account if mailbox or not all_mailboxes else None,
            status=None if status == "open" else status, overdue=overdue, limit=max(1, min(limit, 20)),
        )
        rows = [{**row, "subject": row["subject"][:160]} for row in result["items"]]
        return {"success": True, "count": len(rows), "results": rows, "has_more": result["has_more"]}

    @tool
    async def prepare_follow_up(
        thread_id: str, mailbox: str | None = None, status: FollowUpStatus | None = None,
        due: str | None = None, clear_due: bool = False,
    ) -> dict:
        """Prepare a card for an explicitly requested follow-up change. Use a conversation from mailbox or follow-up results. For dates pass YYYY-MM-DD or an ISO local date and time. Omit due to keep the current date. The user saves the card in the workspace."""
        matches = [source for (key, address), source in sources.items()
                   if key == thread_id and address in mailboxes and (not mailbox or mailbox == address)]
        if len(matches) != 1:
            return {"success": False, "error": "Identify the conversation and its connected mailbox first."}
        source = matches[0]
        email = source["email"]
        item = await db.scalar(select(FollowUp).join(UserEmail, UserEmail.id == FollowUp.user_email_id).where(
            UserEmail.user_id == user_id, UserEmail.email == email, FollowUp.thread_id == thread_id,
        ))
        if status == "done" and item is None:
            return {"success": False, "error": "This conversation has no follow-up to complete."}
        due_at = item.due_at if item else None
        if clear_due:
            due_at = None
        elif due:
            try:
                due_at = (datetime.combine(date.fromisoformat(due), time(23, 59), tzinfo=local_zone)
                          if len(due) == 10 else datetime.fromisoformat(due))
                if due_at.tzinfo is None:
                    due_at = due_at.replace(tzinfo=local_zone)
            except ValueError:
                return {"success": False, "error": "Use a calendar date or a local date and time for the deadline."}
        subject = (item.subject if item else None) or source["subject"] or "Email conversation"
        action = {
            "thread_id": thread_id, "email": email, "subject": subject[:160],
            "status": status or (item.status if item else "reply"),
            "due_at": due_at.isoformat() if due_at else None,
            "expected_updated_at": item.updated_at.isoformat() if item else None,
        }
        return {
            "success": True, "thread_id": thread_id, "email": email, "subject": subject[:160],
            "message": "Action prepared. The user can save it using the card in the workspace.",
            "follow_up_action": action,
        }

    return [list_follow_ups, prepare_follow_up]
