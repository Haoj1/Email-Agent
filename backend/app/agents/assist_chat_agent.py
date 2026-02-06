"""
Assist Chat Agent - General-purpose email assistant with RAG and tool support
Can query triage results, search emails, and help with email management
"""
from typing import Dict, List, Optional, Any
from app.services.gmail_service import GmailService
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from app.agents.llm_factory import get_chat_llm
from app.agents.tools.assist_chat_tools import (
    create_assist_chat_tools,
    execute_query_triage_results,
    execute_search_emails_rag,
    execute_get_important_emails
)
from app.agents.tools.datetime_tools import get_current_time_tool
from app.services.gmail_service import GmailService
from sqlalchemy.ext.asyncio import AsyncSession


class AssistChatAgent:
    """Assist Chat Agent with RAG and tool support"""
    
    def __init__(
        self,
        db: AsyncSession,
        user_id: int,
        gmail_services: Optional[Dict[str, GmailService]] = None,
        primary_gmail_service: Optional[GmailService] = None,
        email: Optional[str] = None,
        gmail_service: Optional[GmailService] = None  # For backward compatibility
    ):
        """
        Initialize Assist Chat Agent
        
        Args:
            db: Database session
            user_id: User ID
            gmail_services: Optional dict mapping email -> GmailService for multi-email support
            primary_gmail_service: Optional primary GmailService instance (for backward compatibility)
            email: Email account being used (optional)
            gmail_service: Optional GmailService instance (for backward compatibility)
        """
        self.db = db
        self.user_id = user_id
        self.gmail_services = gmail_services or {}
        # For backward compatibility, if gmail_service is provided, use it
        if gmail_service and not primary_gmail_service:
            primary_gmail_service = gmail_service
        self.primary_gmail_service = primary_gmail_service
        self.email = email
        self.llm = get_chat_llm()
        
        # Bind tools to LLM
        self.tools = create_assist_chat_tools(
            db, user_id, 
            gmail_services=self.gmail_services,
            primary_gmail_service=primary_gmail_service,
            email=email
        ) + [get_current_time_tool]
        self.llm_with_tools = self.llm.bind_tools(self.tools)
        
        # Build system prompt
        self.system_prompt = self._get_system_prompt()
    
    def _get_system_prompt(self) -> str:
        """System prompt for Assist Chat Agent"""
        return """You are a helpful email assistant that helps users manage and understand their emails.

## About This Email Agent Application:

This is a Multi-User AI Email Agent application that helps users manage their Gmail emails more effectively. Here are the main features:

### Core Features:
1. **Priority Inbox**: Automatically categorizes emails (NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE) and assigns priority scores (0–1). You can click **Update Priorities** to refresh.
2. **Inbox Copilot** (this agent): A general-purpose AI assistant that can:
   - Find important emails using Priority Inbox results
   - Search emails semantically using RAG (Retrieval‑Augmented Generation)
   - Answer questions about emails
   - Help with email management tasks
3. **Thread Chat**: Interactive chat for a specific conversation, can generate draft replies
4. **Conversations**: Browse email conversations with time-based filtering
5. **Suggested Schedule (Calendar)**: Auto-plans follow‑ups from Priority Inbox into open time on your calendar (week view). Users can review, drag/resize, select items, then confirm to create calendar events.
6. **Dashboard**: Overview of accounts, Conversations, Priority Inbox, Inbox Copilot, and Suggested Schedule

### How to Use:
- **Dashboard**: Main page showing account selector + quick access to Conversations, Priority Inbox, Inbox Copilot, and Suggested Schedule
- **Conversations**: Browse conversations, click one to open the full thread detail page
- **Priority Inbox**: Review prioritized emails; use filters (Today/Last 3 Days/Week/Month); click **Update Priorities** to refresh results
- **Inbox Copilot**: Ask questions like “What needs my attention today?” or “Find emails about deadlines”
- **Thread Chat**: On a thread detail page, chat about that specific conversation and generate a draft reply
- **Suggested Schedule**: Generate follow‑up blocks, use week view to drag/resize, click blocks to select/deselect, then **Confirm & Create** to add to Google Calendar

### Navigation:
- Use the top navigation bar to switch between Dashboard, Conversations, and Priority Inbox
- Click on any conversation / thread ID link to view the full thread
- Use the email selector to switch between multiple Gmail accounts

### Common Questions:
- "How do I find important emails?" → Use Inbox Copilot to query Priority Inbox results or ask "What important emails do I need to reply to?"
- "How do I update priorities?" → Go to Priority Inbox and click "Update Priorities"
- "How do I generate a draft reply?" → Open a thread detail page and use the Thread Chat feature
- "How do I search emails by topic?" → Use Assist Chat and ask questions like "Find emails about deadlines"
- "How do I auto-plan follow‑ups on my calendar?" → Go to Suggested Schedule on the Dashboard, generate suggestions, then Confirm & Create

You have access to tools that allow you to:
- Query email triage results to find important emails
- Search emails using semantic search (RAG)
- Get email thread details
- Find related threads
- Generate draft email replies

## Your Capabilities:
1. **Find important emails**: Use query_triage_results or get_important_emails to find emails that need attention
2. **Search emails**: Use search_emails_rag to find emails by semantic meaning (e.g., "emails about deadlines")
3. **Answer questions** about emails (summarize, extract action items, deadlines, key points)
4. **Generate draft replies** based on thread context
5. **Help with email management**: Find emails by label, priority, date range, etc.

## Available Tools:
- **query_triage_results**: Query triage results by label, priority, date range
- **search_emails_rag**: Semantic search for emails (finds emails by meaning, not just keywords)
- **get_important_emails**: Get high-priority emails that need attention (convenience function)
- **get_thread**: Get full details of a specific thread (if Gmail service available)
- **batch_get_threads**: Get multiple threads at once (if Gmail service available)
- **search_related_threads**: Find threads from same sender/domain/subject (if Gmail service available)
- **extract_relevant_context**: Extract relevant parts of a thread (if Gmail service available)
- **list_labels**: List Gmail labels (if Gmail service available)
- **get_current_time_tool**: Get current date/time for deadline calculations
- **generate_draft_reply**: Generate a draft email reply (if Gmail service available)

## Guidelines:
- **When users ask about the app itself** (how to use it, what features it has, how to do something): Provide helpful guidance based on the "About This Email Agent Application" section above. You don't need to use tools for these questions - just explain the features and how to use them.
- Always use tools when you need to access email data
- When user asks about "important emails" or "emails that need attention", use get_important_emails or query_triage_results with label="NEEDS_REPLY"
- When user asks to find emails by topic/meaning, use search_emails_rag
- When user asks about specific emails, use query_triage_results or get_thread
- For long threads, use extract_relevant_context to focus on relevant parts
- When generating draft replies, be concise, professional, and address all questions/requests
- Cite specific sources when referencing content (e.g., "According to triage result for thread X...")
- **CRITICAL - Thread ID Formatting**: When you mention, reference, or summarize ANY specific email thread in your response, you MUST include the thread_id directly in parentheses or inline with the text.
  - Format: Simply include the thread_id as "{thread_id}" (e.g., "19c202ab59d21359") - do NOT include the word "thread" before it
  - Examples: "I found an important email (19c202ab59d21359)" or "The payment reminder email 19c202ab59d21359 needs your attention"
  - The frontend will automatically convert thread IDs into clickable links
  - Always include the thread_id even if you're summarizing multiple threads - format each as just the ID: "19c202ab59d21359"

## Response Style:
- Be conversational but professional
- Use clear, concise language
- Structure longer responses with bullet points when helpful
- Always cite your sources (which thread/triage result you're referencing)
- If you find important emails, summarize them clearly with their priority and label
- **Always include thread_id**: When summarizing, mentioning, or referencing a specific email thread, include just the thread_id (e.g., "19c202ab59d21359") without the word "thread" - this improves readability and the frontend will automatically make it clickable

Remember: You can help users find, understand, and manage their emails effectively."""
    
    def _summarize_tool_result(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Summarize tool result for display"""
        if not isinstance(result, dict):
            return "Tool executed"
        
        if tool_name == "query_triage_results":
            if result.get("success"):
                count = result.get("count", 0)
                return f"Found {count} triage result(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "search_emails_rag":
            if result.get("success"):
                count = result.get("count", 0)
                return f"Found {count} relevant email(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "get_important_emails":
            if result.get("success"):
                count = result.get("count", 0)
                return f"Found {count} important email(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "get_thread":
            if result.get("success"):
                thread = result.get("thread", {})
                msg_count = thread.get("message_count", 0)
                return f"Retrieved thread with {msg_count} message(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "extract_relevant_context":
            if result.get("success"):
                segments = result.get("segments", [])
                return f"Found {len(segments)} relevant segment(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "search_related_threads":
            if result.get("success"):
                threads = result.get("threads", [])
                return f"Found {len(threads)} related thread(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "batch_get_threads":
            if result.get("success"):
                threads = result.get("threads", {})
                return f"Retrieved {len(threads)} thread(s)"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "get_current_time_tool":
            if result.get("success"):
                return f"Current time: {result.get('readable', 'N/A')}"
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        elif tool_name == "generate_draft_reply":
            if result.get("success"):
                return f"Draft generated: {result.get('subject', 'No subject')[:50]}..."
            return f"Failed: {result.get('error', 'Unknown error')}"
        
        return "Tool executed successfully"
    
    async def chat(
        self,
        question: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        step_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Chat with the agent
        
        Args:
            question: User's question
            conversation_history: Previous messages in format [{"role": "user/assistant", "content": "..."}]
            step_callback: Optional callback for streaming thinking steps
        
        Returns:
            Dictionary with:
            - answer: Agent's response
            - citations: List of thread/triage references
            - tool_calls: List of tools that were called
        """
        # Build messages
        messages = [SystemMessage(content=self.system_prompt)]
        
        # Add conversation history
        if conversation_history:
            for msg in conversation_history:
                if msg["role"] == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    messages.append(AIMessage(content=msg["content"]))
        
        # Add current question
        messages.append(HumanMessage(content=question))
        
        # Call LLM with tools
        try:
            response = self.llm_with_tools.invoke(messages)
            
            # Handle tool calls
            tool_calls = []
            citations = []
            thinking_steps = []
            
            # Add initial thinking step
            initial_step = {
                "type": "planning",
                "content": f"Analyzing question: {question}",
                "timestamp": None
            }
            thinking_steps.append(initial_step)
            if step_callback:
                step_callback(initial_step)
            
            # If LLM wants to call tools, execute them
            iteration = 0
            while hasattr(response, 'tool_calls') and response.tool_calls:
                iteration += 1
                # Add assistant message with tool calls
                messages.append(response)
                
                # Record planning step
                tool_names = [tc.get("name", "unknown") for tc in response.tool_calls]
                planning_step = {
                    "type": "planning",
                    "content": f"Planning to use tools: {', '.join(tool_names)}",
                    "timestamp": None
                }
                thinking_steps.append(planning_step)
                if step_callback:
                    step_callback(planning_step)
                
                # Execute each tool call
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call.get("args", {})
                    
                    # Record tool call start
                    tool_call_step = {
                        "type": "tool_call",
                        "tool": tool_name,
                        "args": tool_args,
                        "status": "calling",
                        "timestamp": None
                    }
                    thinking_steps.append(tool_call_step)
                    if step_callback:
                        step_callback(tool_call_step)
                    
                    # Execute tool (handle async tools)
                    result = None
                    try:
                        if tool_name == "query_triage_results":
                            result = await execute_query_triage_results(
                                db=self.db,
                                user_id=self.user_id,
                                **tool_args
                            )
                        elif tool_name == "search_emails_rag":
                            result = await execute_search_emails_rag(
                                db=self.db,
                                user_id=self.user_id,
                                **tool_args
                            )
                        elif tool_name == "get_important_emails":
                            result = await execute_get_important_emails(
                                db=self.db,
                                user_id=self.user_id,
                                **tool_args
                            )
                        else:
                            # Find the tool for synchronous execution
                            tool_func = None
                            for tool in self.tools:
                                if tool.name == tool_name:
                                    tool_func = tool
                                    break
                            
                            if tool_func:
                                # Execute synchronous tool
                                if tool_name in ["get_thread", "extract_relevant_context", "generate_draft_reply"]:
                                    # These tools might need thread_id or other specific args
                                    result = tool_func.invoke(tool_args)
                                else:
                                    result = tool_func.invoke(tool_args)
                            else:
                                result = {
                                    "success": False,
                                    "error": f"Tool {tool_name} not found"
                                }
                    except Exception as e:
                        result = {
                            "success": False,
                            "error": str(e)
                        }
                    
                    # Record tool result
                    tool_result_step = {
                        "type": "tool_result",
                        "tool": tool_name,
                        "status": "success" if result and result.get("success") else "error",
                        "summary": self._summarize_tool_result(tool_name, result) if result else "No result",
                        "error": result.get("error") if result and not result.get("success") else None,
                        "timestamp": None
                    }
                    thinking_steps.append(tool_result_step)
                    if step_callback:
                        step_callback(tool_result_step)
                    
                    tool_calls.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": result
                    })
                    
                    # Extract citations from results
                    if isinstance(result, dict):
                        if "results" in result:
                            for item in result.get("results", []):
                                if "thread_id" in item:
                                    citations.append(f"Conversation {item['thread_id']}")
                                if "label" in item and "priority" in item:
                                    citations.append(f"Priority Inbox: {item['label']} (priority: {item['priority']:.2f})")
                    
                    # Add tool result to messages
                    messages.append(ToolMessage(
                        content=str(result),
                        tool_call_id=tool_call["id"]
                    ))
                
                # Record thinking step before next LLM call
                if iteration < 5:  # Limit iterations
                    thinking_step = {
                        "type": "thinking",
                        "content": "Processing tool results and generating response...",
                        "timestamp": None
                    }
                    thinking_steps.append(thinking_step)
                    if step_callback:
                        step_callback(thinking_step)
                
                # Get next response
                response = self.llm_with_tools.invoke(messages)
            
            # Record final thinking step
            final_thinking_step = {
                "type": "thinking",
                "content": "Generating final answer...",
                "timestamp": None
            }
            thinking_steps.append(final_thinking_step)
            if step_callback:
                step_callback(final_thinking_step)
            
            # Extract final answer
            answer = response.content if hasattr(response, 'content') else str(response)
            
            return {
                "success": True,
                "answer": answer,
                "citations": citations,
                "tool_calls": tool_calls,
                "thinking_steps": thinking_steps
            }
            
        except Exception as e:
            import traceback
            print(f"Error in assist_chat_agent.chat: {e}")
            print(traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "answer": "I encountered an error while processing your question. Please try again."
            }
