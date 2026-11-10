"""Bounded read-only Gmail and Calendar tools for Inbox Copilot."""
from typing import Optional

from langchain_core.tools import tool

from app.services.calendar_service import upcoming_calendar_events
from app.services.mail_search import fuzzy_search, summarize_threads


def create_mailbox_tools(gmail_services, selected_email, calendar_credentials=None):
    @tool
    def search_mailbox(query: str, mailbox: Optional[str] = None, limit: int = 8) -> dict:
        """Search live Gmail, including mail outside the semantic index. Use Gmail syntax such as from:, subject:, is:unread, newer_than:, has:attachment, or filename:. Defaults to the selected mailbox."""
        account = mailbox or selected_email
        service = gmail_services.get(account)
        if service is None:
            return {"success": False, "error": "That mailbox is unavailable."}
        if not query.strip() or len(query) > 500:
            return {"success": False, "error": "Provide a Gmail search query up to 500 characters."}
        results = summarize_threads(service, query.strip(), max(1, min(limit, 12)))
        for item in results:
            item["email_account"] = account
        return {"success": True, "email_account": account, "results": results, "count": len(results)}

    @tool
    def search_mailbox_fuzzy(query: str, days: int = 14, limit: int = 8) -> dict:
        """Find recent conversations despite misspelled names or keywords. Ranks up to 30 recent thread subjects, senders, and snippets in the selected mailbox."""
        if not query.strip() or len(query) > 200:
            return {"success": False, "error": "Provide a short keyword or name."}
        results, scanned = fuzzy_search(gmail_services[selected_email], query, days, limit)
        return {
            "success": True, "email_account": selected_email,
            "results": results, "count": len(results), "scanned": scanned,
        }

    @tool
    def list_thread_attachments(thread_id: str, mailbox: Optional[str] = None) -> dict:
        """List filenames, file types and sizes in a Gmail conversation. Pass the thread ID and mailbox from search results. File contents are not read."""
        account = mailbox or selected_email
        service = gmail_services.get(account)
        if service is None:
            return {"success": False, "error": "That mailbox is unavailable."}
        thread = service.get_thread_full(thread_id)
        attachments = []
        for message in reversed(thread.get("messages", [])):
            parts = [message.get("payload", {})]
            while parts and len(attachments) < 25:
                part = parts.pop()
                parts.extend(reversed(part.get("parts", [])))
                disposition = next((
                    header.get("value", "").lower() for header in part.get("headers", [])
                    if header.get("name", "").lower() == "content-disposition"
                ), "")
                if part.get("filename") and not disposition.startswith("inline"):
                    attachments.append({
                        "filename": part["filename"][:250],
                        "mime_type": part.get("mimeType"),
                        "size_bytes": part.get("body", {}).get("size"),
                    })
            if len(attachments) == 25:
                break
        return {"success": True, "thread_id": thread_id, "email_account": account, "attachments": attachments, "count": len(attachments)}

    @tool
    def list_upcoming_events(days: int = 7, limit: int = 10) -> dict:
        """List upcoming events on the selected mailbox's primary Google Calendar. Use for an agenda or to check scheduled meetings. Dates include timezone offsets when available."""
        return {
            "success": True,
            "email_account": selected_email,
            "events": upcoming_calendar_events(calendar_credentials, days, limit),
        }

    tools = [search_mailbox, search_mailbox_fuzzy, list_thread_attachments] if selected_email in gmail_services else []
    if calendar_credentials is not None:
        tools.append(list_upcoming_events)
    return tools
