"""
Assist Chat Tools - Tools for the Assist Chat Agent
Includes RAG search, triage query, web search, and other email-related tools
"""
import asyncio
from typing import Optional, List, Dict, Any, Tuple
from langchain_core.tools import tool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from datetime import datetime, timedelta
from app.models import TriageResult, EmailEmbedding
from app.services.rag_service import RAGSearchService
from app.services.gmail_service import GmailService
from app.config import settings


def create_assist_chat_tools(
    db: AsyncSession,
    user_id: int,
    gmail_services: Optional[Dict[str, GmailService]] = None,
    primary_gmail_service: Optional[GmailService] = None,
    email: Optional[str] = None,
    gmail_service=None  # For backward compatibility
):
    """
    Create tool instances for Assist Chat Agent.
    These tools allow the agent to query triage results, search emails via RAG, etc.
    """
    rag_service = RAGSearchService()
    
    @tool
    def query_triage_results(
        label: Optional[str] = None,
        priority_min: Optional[float] = None,
        days: Optional[int] = None,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Query email triage results from the database.
        Use this to find important emails that need attention.
        
        Args:
            label: Filter by label (NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE). If None, returns all labels.
            priority_min: Minimum priority score (0.0 to 1.0). Higher priority = more important.
            days: Number of days to look back (e.g., 7 for last week)
            limit: Maximum number of results to return (default: 10)
        
        Returns:
            Dictionary with list of triage results including thread_id, label, priority, summary, etc.
        """
        try:
            # Build query
            query = select(TriageResult).where(TriageResult.user_id == user_id)
            
            if label:
                query = query.where(TriageResult.label == label)
            
            if priority_min is not None:
                query = query.where(TriageResult.priority >= priority_min)
            
            if days:
                cutoff_date = datetime.utcnow() - timedelta(days=days)
                query = query.where(TriageResult.created_at >= cutoff_date)
            
            query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc())
            query = query.limit(limit)
            
            # This tool will be executed asynchronously by the agent
            # Return a placeholder that indicates the tool was called
            # The actual execution happens in execute_query_triage_results
            return {
                "success": True,
                "message": "Querying triage results...",
                "params": {
                    "label": label,
                    "priority_min": priority_min,
                    "days": days,
                    "limit": limit
                }
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    @tool
    def search_emails_rag(
        query: str,
        limit: int = 5
    ) -> Dict[str, Any]:
        """
        Search emails using RAG (Retrieval-Augmented Generation) semantic search.
        This finds emails that are semantically similar to the query, even if they don't contain exact keywords.
        
        Args:
            query: Natural language query (e.g., "emails about project deadlines", "meeting requests")
            limit: Maximum number of results to return (default: 5)
        
        Returns:
            Dictionary with list of relevant email chunks including thread_id, content, similarity score
        """
        try:
            # This tool will be executed asynchronously by the agent
            return {
                "success": True,
                "message": "Searching emails...",
                "params": {
                    "query": query,
                    "limit": limit
                }
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    @tool
    def get_important_emails(
        days: int = 7,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Get important emails that need attention (high priority, NEEDS_REPLY label).
        This is a convenience function that queries triage results for urgent items.
        
        Args:
            days: Number of days to look back (default: 7)
            limit: Maximum number of results (default: 10)
        
        Returns:
            Dictionary with list of important emails from triage results
        """
        try:
            # This tool will be executed asynchronously by the agent
            return {
                "success": True,
                "message": "Getting important emails...",
                "params": {
                    "days": days,
                    "limit": limit
                }
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    @tool
    def web_search(query: str, max_results: int = 5) -> Dict[str, Any]:
        """
        Search the web for current information. Use when the user asks about topics outside their emails (e.g. company info, news, definitions, recent events).
        Do not use for finding emails—use search_emails_rag or query_triage_results instead.
        
        Args:
            query: Search query (e.g. "Company X latest news", "what is API")
            max_results: Maximum number of results to return (default: 5, max 10)
        
        Returns:
            Dictionary with list of search results (title, link, snippet) or error.
        """
        if not getattr(settings, "ENABLE_WEB_SEARCH", True):
            return {"success": False, "error": "Web search is disabled"}
        try:
            max_results = min(max_results, getattr(settings, "WEB_SEARCH_MAX_RESULTS", 10) or 10)
            return {
                "success": True,
                "message": "Searching the web...",
                "params": {"query": query, "max_results": max_results},
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # Add Gmail tools if gmail services are available
    tools = [
        query_triage_results,
        search_emails_rag,
        get_important_emails,
    ]
    if getattr(settings, "ENABLE_WEB_SEARCH", True):
        tools.append(web_search)
    
    # For backward compatibility
    if gmail_service and not primary_gmail_service:
        primary_gmail_service = gmail_service
    
    # If gmail services are available, add Gmail tools with multi-email support
    if gmail_services or primary_gmail_service:
        gmail_tools = create_multi_email_gmail_tools(
            gmail_services=gmail_services or {},
            primary_gmail_service=primary_gmail_service,
            email=email
        )
        tools.extend(gmail_tools)
    
    return tools


def create_multi_email_gmail_tools(
    gmail_services: Dict[str, GmailService],
    primary_gmail_service: Optional[GmailService] = None,
    email: Optional[str] = None
):
    """
    Create Gmail tools that automatically try multiple email accounts.
    When a thread is not found in one account, it tries all other accounts.
    """
    from langchain_core.tools import tool
    
    def find_thread_in_any_account(thread_id: str) -> Tuple[Optional[GmailService], Optional[str]]:
        """
        Try to find a thread in any available email account.
        Returns (gmail_service, email_account) or (None, None) if not found.
        """
        # Try primary email first if specified
        if email and email in gmail_services:
            try:
                gmail_services[email].get_thread_full(thread_id)
                return gmail_services[email], email
            except:
                pass
        
        # Try primary service if available
        if primary_gmail_service:
            try:
                primary_gmail_service.get_thread_full(thread_id)
                return primary_gmail_service, email or "primary"
            except:
                pass
        
        # Try all other accounts
        for account_email, service in gmail_services.items():
            if account_email == email:
                continue
            try:
                service.get_thread_full(thread_id)
                return service, account_email
            except:
                continue
        
        return None, None
    
    @tool
    def get_thread(thread_id: str) -> Dict[str, Any]:
        """Get full thread details. Automatically tries all email accounts if not found in primary."""
        service, account_email = find_thread_in_any_account(thread_id)
        if not service:
            return {
                "success": False,
                "error": f"Thread {thread_id} not found in any email account"
            }
        
        try:
            thread_data = service.get_thread_full(thread_id)
            normalized = service.normalize_thread(thread_data)
            if normalized:
                return {
                    "success": True,
                    "thread": normalized,
                    "email_account": account_email
                }
            return {"success": False, "error": "Failed to normalize thread"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def batch_get_threads(thread_ids: List[str]) -> Dict[str, Any]:
        """Get multiple threads. Automatically tries all email accounts for each thread."""
        threads = {}
        for tid in thread_ids[:10]:  # Limit to 10 at a time
            service, account_email = find_thread_in_any_account(tid)
            if service:
                try:
                    thread_data = service.get_thread_full(tid)
                    normalized = service.normalize_thread(thread_data)
                    if normalized:
                        threads[tid] = {
                            **normalized,
                            "email_account": account_email
                        }
                except Exception as e:
                    threads[tid] = {"error": str(e)}
            else:
                threads[tid] = {"error": f"Thread not found in any email account"}
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
        """Search for related threads. Uses primary email account."""
        service = primary_gmail_service or (gmail_services.get(email) if email else None)
        if not service and gmail_services:
            service = next(iter(gmail_services.values()))
        
        if not service:
            return {"success": False, "error": "No Gmail service available"}
        
        try:
            # Build Gmail query
            query_parts = []
            if from_email:
                query_parts.append(f"from:{from_email}")
            elif domain:
                query_parts.append(f"from:{domain}")
            elif participants:
                query_parts.append(f"from:{participants[0]}")
            
            if subject_keywords:
                query_parts.append(f'subject:"{subject_keywords}"')
            
            from datetime import datetime, timedelta
            after_date = (datetime.now() - timedelta(days=days)).strftime('%Y/%m/%d')
            query_parts.append(f"after:{after_date}")
            
            query = " ".join(query_parts)
            
            # Get threads
            raw_threads = service.get_threads(max_results=max_results, days=days)
            
            results = []
            for thread_data in raw_threads[:max_results]:
                normalized = service.normalize_thread(thread_data)
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
        """Extract relevant thread context. Automatically tries all email accounts."""
        service, account_email = find_thread_in_any_account(thread_id)
        if not service:
            return {
                "success": False,
                "error": f"Thread {thread_id} not found in any email account"
            }
        
        try:
            thread_data = service.get_thread_full(thread_id)
            normalized = service.normalize_thread(thread_data)
            
            if not normalized or not normalized.get("messages"):
                return {"success": False, "error": "No messages found"}
            
            # Simple keyword-based relevance scoring
            question_lower = question.lower()
            question_words = set(question_lower.split())
            
            scored_segments = []
            for msg in normalized["messages"]:
                body = (msg.get("body", "") or msg.get("snippet", "")).lower()
                
                # Score based on keyword matches
                score = sum(1 for word in question_words if word in body)
                if score > 0:
                    scored_segments.append({
                        "message_id": msg.get("message_id"),
                        "from": msg.get("from"),
                        "date": msg.get("date"),
                        "text": (msg.get("body", "") or msg.get("snippet", ""))[:500],
                        "score": score
                    })
            
            # Sort by score and return top_k
            scored_segments.sort(key=lambda x: x["score"], reverse=True)
            
            return {
                "success": True,
                "segments": scored_segments[:top_k],
                "email_account": account_email
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    @tool
    def list_labels() -> Dict[str, Any]:
        """List Gmail labels. Uses primary email account."""
        service = primary_gmail_service or (gmail_services.get(email) if email else None)
        if not service and gmail_services:
            service = next(iter(gmail_services.values()))
        
        if not service:
            return {"success": False, "error": "No Gmail service available"}
        
        try:
            labels = service.service.users().labels().list(userId='me').execute()
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
        """Generate a draft email reply. Automatically tries all email accounts to find the thread."""
        service, account_email = find_thread_in_any_account(thread_id)
        if not service:
            return {
                "success": False,
                "error": f"Thread {thread_id} not found in any email account"
            }
        
        # Use the existing generate_draft_reply from gmail_tools
        from app.agents.tools.gmail_tools import create_gmail_tools
        temp_tools = create_gmail_tools(service, account_email)
        draft_tool = next((t for t in temp_tools if t.name == "generate_draft_reply"), None)
        
        if draft_tool:
            result = draft_tool.invoke({
                "thread_id": thread_id,
                "instruction": instruction,
                "tone": tone
            })
            if isinstance(result, dict):
                result["email_account"] = account_email
            return result
        
        return {"success": False, "error": "Draft generation tool not available"}
    
    return [
        get_thread,
        batch_get_threads,
        search_related_threads,
        extract_relevant_context,
        list_labels,
        generate_draft_reply,
    ]


async def execute_query_triage_results(
    db: AsyncSession,
    user_id: int,
    label: Optional[str] = None,
    priority_min: Optional[float] = None,
    days: Optional[int] = None,
    limit: int = 10
) -> Dict[str, Any]:
    """Execute the query_triage_results tool asynchronously"""
    try:
        query = select(TriageResult).where(TriageResult.user_id == user_id)
        
        if label:
            query = query.where(TriageResult.label == label)
        
        if priority_min is not None:
            query = query.where(TriageResult.priority >= priority_min)
        
        if days:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            query = query.where(TriageResult.created_at >= cutoff_date)
        
        query = query.order_by(TriageResult.priority.desc(), TriageResult.created_at.desc())
        query = query.limit(limit)
        
        result = await db.execute(query)
        triage_results = result.scalars().all()
        
        results = []
        for tr in triage_results:
            results.append({
                "thread_id": tr.thread_id,
                "email": tr.email,
                "label": tr.label,
                "priority": tr.priority,
                "summary": tr.summary,
                "key_points": tr.key_points or [],
                "created_at": tr.created_at.isoformat() if tr.created_at else None,
            })
        
        return {
            "success": True,
            "count": len(results),
            "results": results
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


async def execute_search_emails_rag(
    db: AsyncSession,
    user_id: int,
    query: str,
    limit: int = 5
) -> Dict[str, Any]:
    """Execute the search_emails_rag tool asynchronously"""
    try:
        rag_service = RAGSearchService()
        search_results = await rag_service.search_emails(
            user_id=user_id,
            query=query,
            limit=limit,
            db=db
        )
        
        return {
            "success": True,
            "count": len(search_results),
            "results": search_results
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


async def execute_get_important_emails(
    db: AsyncSession,
    user_id: int,
    days: int = 7,
    limit: int = 10
) -> Dict[str, Any]:
    """Execute the get_important_emails tool asynchronously"""
    try:
        return await execute_query_triage_results(
            db=db,
            user_id=user_id,
            label="NEEDS_REPLY",
            priority_min=0.5,
            days=days,
            limit=limit
        )
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def _run_web_search_sync(query: str, max_results: int) -> Dict[str, Any]:
    """Synchronous web search using DuckDuckGo (free, no API key). Run in executor to avoid blocking."""
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS  # fallback if old package name still installed
        results = []
        ddgs = DDGS()
        # .text() returns list of dicts with title, href, body (ddgs) or generator (duckduckgo_search)
        raw = ddgs.text(query, max_results=max_results)
        if hasattr(raw, "__iter__") and not isinstance(raw, (list, tuple)):
            raw = list(raw)
        for r in raw or []:
            if not isinstance(r, dict):
                continue
            results.append({
                "title": r.get("title", ""),
                "link": r.get("href", r.get("link", "")),
                "snippet": r.get("body", r.get("snippet", "")),
            })
        return {"success": True, "count": len(results), "results": results}
    except Exception as e:
        return {"success": False, "error": str(e), "results": []}


async def execute_web_search(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Execute web_search tool asynchronously (runs DuckDuckGo in thread pool)."""
    max_results = min(max_results, getattr(settings, "WEB_SEARCH_MAX_RESULTS", 10) or 10)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: _run_web_search_sync(query, max_results),
    )
