"""
Gmail Tools for Thread Chat Agent
Provides read-only tools for querying Gmail data
"""
from typing import Optional, List, Dict, Any
from langchain_core.tools import tool
from app.services.gmail_service import GmailService
from app.services.mail_search import search_related
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
def _trim_context(thread):
    for message in thread.get("messages", []):
        message.pop("body_html", None)
        message["body_text"] = (message.get("body_text") or "")[:1500]
    return thread


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
            normalized = gmail_service.normalize_thread(thread_data, message_limit=4)
            if normalized:
                return {
                    "success": True,
                    "thread": _trim_context(normalized)
                }
            return {"success": False, "error": "Failed to normalize thread"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def batch_get_threads(thread_ids: List[str]) -> Dict[str, Any]:
        """Get multiple threads"""
        threads = {}
        for tid in thread_ids[:5]:  # Bound the context sent to the agent
            try:
                thread_data = gmail_service.get_thread_full(tid)
                normalized = gmail_service.normalize_thread(thread_data, message_limit=4)
                if normalized:
                    threads[tid] = _trim_context(normalized)
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
            sender = from_email or domain or (participants[0] if participants else None)
            threads = search_related(gmail_service, subject_keywords, sender, days, max_results)
            return {"success": True, "threads": threads}
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
                body = _clean_text(msg.get("body_text") or msg.get("snippet", ""))
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
    
    @tool
    def generate_draft_reply(
        thread_id: str,
        instruction: Optional[str] = None,
        tone: str = "professional"
    ) -> Dict[str, Any]:
        """
        Generate a draft email reply for a thread.
        Use this when the user asks to generate a reply, draft, or write a response.
        
        Args:
            thread_id: Gmail thread ID (required)
            instruction: Optional instruction for the draft (e.g., "be concise", "ask for clarification")
            tone: Tone of reply (professional, friendly, formal, casual). Default: professional
        
        Returns:
            Dictionary with draft content including subject and body
        """
        try:
            # Get thread first
            thread_data = gmail_service.get_thread_full(thread_id)
            normalized = gmail_service.normalize_thread(thread_data)
            
            if not normalized:
                return {
                    "success": False,
                    "error": "Failed to load thread"
                }
            
            # Extract recipient information
            participants = normalized.get('participants', {})
            to_email = participants.get('from', '')
            if not to_email:
                messages = normalized.get('messages', [])
                if messages:
                    from_header = messages[0].get('from', '')
                    match = re.search(r'<(.+?)>', from_header)
                    if match:
                        to_email = match.group(1)
                    else:
                        to_email = from_header
            
            # Get latest message content
            latest_message = normalized.get('messages', [{}])[-1] if normalized.get('messages') else {}
            latest_body = latest_message.get('body_text') or latest_message.get('snippet', '')
            
            # Use LLM to generate draft (simplified version, can be enhanced)
            from langchain_core.messages import SystemMessage, HumanMessage
            from app.agents.llm_factory import get_chat_llm
            
            llm = get_chat_llm()
            
            messages = [
                SystemMessage(content=f"""You are an email assistant that generates professional email drafts.

IMPORTANT: You must ONLY output the draft email content in the exact format below. Do NOT include any explanations, thinking, or tool calls.

Output format (strictly follow this):
SUBJECT: [email subject line]
BODY: [email body content]

Rules:
- Tone: {tone}
- Be concise and professional
- Address all questions/requests from the original email
- Do NOT include any meta-commentary or explanations
- Do NOT show your thinking process
- Output ONLY the SUBJECT and BODY lines"""),
                HumanMessage(content=f"""Generate a draft email reply.

Original Email:
From: {normalized.get('participants', {}).get('from', 'N/A')}
Subject: {normalized.get('subject', 'N/A')}
Content: {latest_body[:1000]}

{"Additional instruction: " + instruction if instruction else ""}

Generate the draft reply now. Output ONLY SUBJECT: and BODY: lines.""")
            ]
            
            response = llm.invoke(messages)
            draft_content = response.content if hasattr(response, 'content') else str(response)
            
            # Parse draft
            subject = ""
            body = ""
            
            if "SUBJECT:" in draft_content.upper():
                subject_match = re.search(r'SUBJECT:\s*(.+?)(?=BODY:|$)', draft_content, re.IGNORECASE | re.DOTALL)
                if subject_match:
                    subject = subject_match.group(1).strip()
            
            if "BODY:" in draft_content.upper():
                body_match = re.search(r'BODY:\s*(.+?)$', draft_content, re.IGNORECASE | re.DOTALL)
                if body_match:
                    body = body_match.group(1).strip()
            
            # Fallback parsing
            if not body:
                if "SUBJECT:" in draft_content.upper():
                    parts = re.split(r'SUBJECT:', draft_content, flags=re.IGNORECASE, maxsplit=1)
                    if len(parts) > 1:
                        remaining = parts[1]
                        if "BODY:" in remaining.upper():
                            body = re.split(r'BODY:', remaining, flags=re.IGNORECASE, maxsplit=1)[1].strip()
                        else:
                            body = remaining.strip()
                else:
                    body = draft_content.strip()
            
            # Clean up
            subject = subject.strip().strip('"').strip("'")
            body = body.strip()
            body = re.sub(r'^(SUBJECT:|BODY:)\s*', '', body, flags=re.IGNORECASE | re.MULTILINE)
            
            # If subject is empty, use Re: prefix
            if not subject and normalized.get('subject'):
                original_subject = normalized.get('subject', '')
                if not original_subject.lower().startswith('re:'):
                    subject = f"Re: {original_subject}"
                else:
                    subject = original_subject
            
            if not body:
                body = "Draft content could not be extracted. Please try again."
            
            return {
                "success": True,
                "subject": subject,
                "body": body,
                "to": to_email,
                "thread_id": thread_id
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    return [
        get_thread,
        batch_get_threads,
        search_related_threads,
        extract_relevant_context,
        list_labels,
        generate_draft_reply,
    ]
