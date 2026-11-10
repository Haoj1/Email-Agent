"""Metadata-only Gmail search helpers shared by the inbox and AI tools."""
import re
import unicodedata
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from email.utils import parseaddr


def summarize_threads(service, query: str, max_results: int) -> list[dict]:
    results = []
    for thread in service.get_threads(max_results=max_results, query=query):
        messages = thread.get("messages", [])
        if not messages:
            continue
        latest = messages[-1]
        headers = {
            header["name"].lower(): header.get("value", "")
            for header in latest.get("payload", {}).get("headers", [])
        }
        results.append({
            "thread_id": thread["id"],
            "subject": headers.get("subject", "(No subject)"),
            "from": headers.get("from", ""),
            "date": headers.get("date", ""),
            "snippet": (latest.get("snippet") or thread.get("snippet") or "")[:360],
            "message_count": len(messages),
        })
    return results


def related_query(subject=None, sender=None, days=30):
    subject = re.sub(r'^(?:\s*(?:re|fw|fwd)\s*:\s*)+', '', subject or '', flags=re.I)
    subject = re.sub(r'["{}\r\n\\]', ' ', subject).strip()[:160]
    address = parseaddr(sender or "")[1]
    predicates = []
    if subject and subject.lower() != "(no subject)":
        predicates.append(f'subject:"{subject}"')
    if re.fullmatch(r"[\w@.+-]+", address):
        predicates.append(f"from:{address}")
    if not predicates:
        return None
    condition = predicates[0] if len(predicates) == 1 else "{" + " ".join(predicates) + "}"
    after = (datetime.now() - timedelta(days=max(1, min(days, 90)))).strftime("%Y/%m/%d")
    return f"{condition} after:{after}"


def search_related(service, subject=None, sender=None, days=30, limit=8, exclude=None):
    query = related_query(subject, sender, days)
    if not query:
        return []
    limit = max(1, min(limit, 12))
    rows = summarize_threads(service, query, limit + int(bool(exclude)))
    return [row for row in rows if row["thread_id"] != exclude][:limit]


def _tokens(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", value).casefold()
    return re.findall(r"[^\W_]+", "".join(c for c in normalized if not unicodedata.combining(c)))


def rank_fuzzy_threads(threads: list[dict], query: str, limit: int) -> list[dict]:
    terms = _tokens(query)[:8]
    if not terms:
        return []
    ranked = []
    for thread in threads:
        primary = set(_tokens(f"{thread.get('subject', '')} {thread.get('from', '')}"))
        snippet = set(_tokens(thread.get("snippet", "")))
        scores = []
        for term in terms:
            if term in primary or (len(term) >= 3 and any(word.startswith(term) for word in primary)):
                scores.append(1.0)
                continue
            if term in snippet:
                scores.append(0.92)
                continue
            if len(term) < 3:
                scores.append(0)
                continue
            scores.append(max((
                SequenceMatcher(None, term, word, autojunk=False).ratio() * weight
                for words, weight in ((primary, 1.0), (snippet, 0.91))
                for word in words if abs(len(word) - len(term)) <= 3
            ), default=0))
        mean = sum(scores) / len(scores)
        if min(scores) >= 0.64 and mean >= 0.74:
            ranked.append((mean, thread))
    return [thread for _, thread in sorted(ranked, key=lambda entry: -entry[0])[:limit]]


def fuzzy_search(service, query: str, days=14, limit=12):
    days = max(1, min(days, 30))
    candidates = summarize_threads(service, f"newer_than:{days}d", 30)
    return rank_fuzzy_threads(candidates, query, max(1, min(limit, 12))), len(candidates)
