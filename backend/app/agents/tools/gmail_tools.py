"""
Gmail Tools for Thread Chat Agent
Provides read-only tools for querying Gmail data
"""
from typing import Optional, List, Dict, Any
from langchain_core.tools import tool
from app.services.gmail_service import GmailService
import re


def _clean_text(text: str) -> str:
    """Clean email text by removing quoted replies and signatures"""
    if not text:
        return ""
    
    # Remove quoted replies (lines starting with >)
    lines = text.split('\n')
    cleaned_lines = []
    in_quote = False
    
    for line in lines:
        # Check for common quote markers
        if line.strip().startswith('>') or line.strip().startswith('On ') and 'wrote:' in line:
            in_quote = True
            continue
        if in_quote and line.strip() == '':
            continue
        if in_quote and not line.strip().startswith('>'):
            in_quote = False
        
        if not in_quote:
            cleaned_lines.append(line)
    
    # Remove common signature patterns
    text = '\n'.join(cleaned_lines)
    text = re.sub(r'--\s*\n.*', '', text, flags=re.DOTALL)
    text = re.sub(r'Sent from.*', '', text, flags=re.IGNORECASE)
    
    return text.strip()


@tool
def get_thread_tool(thread_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    """
    Get full details of a specific email thread.
    
    Args:
        thread_id: Gmail thread ID
        email: Email account to use (optional, uses primary if not specified)
    
    Returns:
        Dictionary with thread details including messages, participants, dates, etc.
    """
    # This will be called with GmailService instance injected
    # For now, return a placeholder structure
    return {
        "thread_id": thread_id,
        "error": "Tool must be called with GmailService instance"
    }


@tool
def batch_get_threads_tool(thread_ids: List[str], email: Optional[str] = None) -> Dict[str, Any]:
    """
    Get multiple threads at once to reduce API calls.
    
    Args:
        thread_ids: List of Gmail thread IDs
        email: Email account to use (optional)
    
    Returns:
        Dictionary mapping thread_id to thread data
    """
    return {
        "threads": {},
        "error": "Tool must be called with GmailService instance"
    }


@tool
def search_related_threads_tool(
    participants: Optional[List[str]] = None,
    from_email: Optional[str] = None,
    domain: Optional[str] = None,
    subject_keywords: Optional[str] = None,
    days: int = 30,
    max_results: int = 10,
    email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Search for related threads (same sender, domain, or similar subject) for historical context.
    
    Args:
        participants: List of email addresses to search for
        from_email: Specific sender email address
        domain: Domain name to search (e.g., "company.com")
        subject_keywords: Keywords to search in subject line
        days: Number of days to look back
        max_results: Maximum number of results
        email: Email account to use (optional)
    
    Returns:
        List of related threads with basic info (thread_id, subject, from, date, snippet)
    """
    return {
        "threads": [],
        "error": "Tool must be called with GmailService instance"
    }


@tool
def extract_relevant_thread_context_tool(
    thread_id: str,
    question: str,
    top_k: int = 5,
    email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extract the most relevant parts of a thread based on a question (lightweight RAG).
    This helps reduce token usage and improve accuracy by focusing on relevant content.
    
    Args:
        thread_id: Gmail thread ID
        question: User's question to find relevant context
        top_k: Number of relevant segments to return
        email: Email account to use (optional)
    
    Returns:
        Dictionary with relevant message segments and their sources
    """
    return {
        "segments": [],
        "error": "Tool must be called with GmailService instance"
    }


@tool
def list_labels_tool(email: Optional[str] = None) -> Dict[str, Any]:
    """
    List all available Gmail labels for the user.
    Useful for understanding email categories and organization.
    
    Args:
        email: Email account to use (optional)
    
    Returns:
        List of label objects with id and name
    """
    return {
        "labels": [],
        "error": "Tool must be called with GmailService instance"
    }


@tool
def list_attachments_tool(message_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    """
    List attachments for a specific message.
    
    Args:
        message_id: Gmail message ID
        email: Email account to use (optional)
    
    Returns:
        List of attachment objects with filename, size, mimeType
    """
    return {
        "attachments": [],
        "error": "Tool must be called with GmailService instance"
    }


# Helper functions to create tool instances with GmailService
def create_gmail_tools(gmail_service: GmailService, email: Optional[str] = None):
    """
    Create tool instances bound to a GmailService instance.
    This allows tools to access Gmail API through the service.
    """
    
    @tool
    def get_thread(thread_id: str) -> Dict[str, Any]:
        """Get full thread details"""
        try:
            thread_data = gmail_service.get_thread_full(thread_id)
            normalized = gmail_service.normalize_thread(thread_data)
            if normalized:
                return {
                    "success": True,
                    "thread": normalized
                }
            return {"success": False, "error": "Failed to normalize thread"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def batch_get_threads(thread_ids: List[str]) -> Dict[str, Any]:
        """Get multiple threads"""
        threads = {}
        for tid in thread_ids[:10]:  # Limit to 10 at a time
            try:
                thread_data = gmail_service.get_thread_full(tid)
                normalized = gmail_service.normalize_thread(thread_data)
                if normalized:
                    threads[tid] = normalized
            except Exception as e:
                threads[tid] = {"error": str(e)}
        return {"success": True, "threads": threads}
    
    @tool
    def search_related_threads(
        participants: Optional[List[str]] = None,
        from_email: Optional[str] = None,
        domain: Optional[str] = None,
        subject_keywords: Optional[str] = None,
        days: int = 30,
        max_results: int = 10
    ) -> Dict[str, Any]:
        """Search for related threads"""
        try:
            # Build Gmail query
            query_parts = []
            if from_email:
                query_parts.append(f"from:{from_email}")
            elif domain:
                query_parts.append(f"from:{domain}")
            elif participants:
                # Use first participant
                query_parts.append(f"from:{participants[0]}")
            
            if subject_keywords:
                query_parts.append(f'subject:"{subject_keywords}"')
            
            from datetime import datetime, timedelta
            after_date = (datetime.now() - timedelta(days=days)).strftime('%Y/%m/%d')
            query_parts.append(f"after:{after_date}")
            
            query = " ".join(query_parts)
            
            # Get threads
            raw_threads = gmail_service.get_threads(max_results=max_results, days=days)
            
            results = []
            for thread_data in raw_threads[:max_results]:
                normalized = gmail_service.normalize_thread(thread_data)
                if normalized:
                    results.append({
                        "thread_id": normalized["thread_id"],
                        "subject": normalized["subject"],
                        "from": normalized["participants"]["from"],
                        "date": normalized["latest_message_date"],
                        "snippet": normalized["messages"][-1].get("snippet", "") if normalized["messages"] else ""
                    })
            
            return {"success": True, "threads": results}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def extract_relevant_context(thread_id: str, question: str, top_k: int = 5) -> Dict[str, Any]:
        """Extract relevant thread context"""
        try:
            thread_data = gmail_service.get_thread_full(thread_id)
            normalized = gmail_service.normalize_thread(thread_data)
            
            if not normalized or not normalized.get("messages"):
                return {"success": False, "error": "No messages found"}
            
            # Simple keyword-based relevance scoring
            question_lower = question.lower()
            question_words = set(question_lower.split())
            
            scored_segments = []
            for msg in normalized["messages"]:
                body = _clean_text(msg.get("body", "") or msg.get("snippet", ""))
                body_lower = body.lower()
                
                # Score based on keyword matches
                score = sum(1 for word in question_words if word in body_lower)
                if score > 0:
                    scored_segments.append({
                        "message_id": msg.get("message_id"),
                        "from": msg.get("from"),
                        "date": msg.get("date"),
                        "text": body[:500],  # Limit length
                        "score": score
                    })
            
            # Sort by score and return top_k
            scored_segments.sort(key=lambda x: x["score"], reverse=True)
            
            return {
                "success": True,
                "segments": scored_segments[:top_k]
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def list_labels() -> Dict[str, Any]:
        """List Gmail labels"""
        try:
            service = gmail_service.service
            labels = service.users().labels().list(userId='me').execute()
            return {
                "success": True,
                "labels": [{"id": l["id"], "name": l["name"]} for l in labels.get("labels", [])]
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    return [
        get_thread,
        batch_get_threads,
        search_related_threads,
        extract_relevant_context,
        list_labels,
    ]
