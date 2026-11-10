"""Conservative inbox routing from Gmail metadata and short excerpts."""
import re
from html import unescape

REQUEST = re.compile(
    r"\b(?:please (?:reply|respond|confirm|approve|sign|review|send)|"
    r"could you|would you|can you confirm|action required|response requested)\b"
    r"|请(?:回复|确认|审批|签字|审阅)|麻烦(?:回复|确认|提供)", re.I,
)
URGENT = re.compile(r"\b(?:urgent|asap|due today|overdue|deadline today)\b|紧急|今天截止", re.I)
AUTOMATED = re.compile(r"(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)@", re.I)
RECEIPT = re.compile(r"\b(?:payment received|receipt for|order confirmation|shipped your order)\b|付款成功|订单确认", re.I)


def triage_excerpt(thread):
    subject = unescape(thread.get("subject") or "(No subject)").strip()[:160]
    sender = (thread.get("participants", {}).get("from") or "")[:110]
    messages = thread.get("messages") or []
    snippet = unescape((messages[-1].get("snippet") or "") if messages else "").strip()[:220]
    return subject, sender, snippet


def classify_metadata(thread):
    subject, sender, snippet = triage_excerpt(thread)
    labels = set(thread.get("labels") or [])
    evidence = f"{subject}\n{snippet}"
    if "SPAM" in labels:
        label, priority, reason = "SPAM_LIKE", 0.05, "Gmail marked this as spam."
    elif REQUEST.search(evidence) and not AUTOMATED.search(sender):
        label, priority, reason = "NEEDS_REPLY", (0.86 if URGENT.search(evidence) else 0.68), "The subject or excerpt asks for a response or action."
    elif "CATEGORY_PROMOTIONS" in labels or "CATEGORY_SOCIAL" in labels:
        label, priority, reason = "FYI", 0.18, "Gmail categorized this as promotions or social."
    elif AUTOMATED.search(sender) and RECEIPT.search(evidence):
        label, priority, reason = "FYI", 0.30, "The excerpt resembles an automated receipt or confirmation."
    else:
        label, priority, reason = "REVIEW", 0.45, "The subject and excerpt do not establish the next action."
    return {
        "thread_id": thread["thread_id"], "label": label, "priority": priority,
        "summary": (f"{subject} — {snippet}" if snippet else subject)[:320], "key_points": [reason],
    }
