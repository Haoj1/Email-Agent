"""
Thread Chat Agent - Interactive chat agent for email threads
Uses LangChain with function calling to enable tool usage
"""
from typing import Dict, List, Optional, Any
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from app.agents.llm_factory import get_chat_llm
from app.agents.tools.gmail_tools import create_gmail_tools
from app.agents.tools.datetime_tools import get_current_time_tool
from app.services.gmail_service import GmailService


class ThreadChatAgent:
    """Thread Chat Agent with tool support"""
    
    def __init__(self, gmail_service: GmailService, email: Optional[str] = None):
        """
        Initialize Thread Chat Agent
        
        Args:
            gmail_service: GmailService instance for API access
            email: Email account being used (optional)
        """
        self.gmail_service = gmail_service
        self.email = email
        self.llm = get_chat_llm()
        
        # Bind tools to LLM
        self.tools = create_gmail_tools(gmail_service, email) + [get_current_time_tool]
        self.llm_with_tools = self.llm.bind_tools(self.tools)
        
        # Build system prompt
        self.system_prompt = self._get_system_prompt()
    
    def _get_system_prompt(self) -> str:
        """System prompt for Thread Chat Agent"""
        return """You are a helpful email assistant that helps users understand and interact with their email threads.

You have access to tools that allow you to:
- Get thread details and messages
- Search for related threads
- Extract relevant context
- Generate draft email replies

When users ask you to:
- "generate a reply" or "write a response" or "create a draft" → Use the generate_draft_reply tool
- "help me reply" or "draft an email" → Use the generate_draft_reply tool
- Ask questions about the thread → Use get_thread and other tools to answer

Always use the appropriate tools to help users with their requests.

## Your Capabilities:
1. **Answer questions** about email threads (summarize, extract action items, deadlines, key points)
2. **Generate draft replies** based on thread context (provide text only, do not send)
3. **Find related threads** from the same sender/domain for historical context
4. **Extract relevant context** from long threads to answer specific questions efficiently

## Available Tools:
- **get_thread**: Get full details of a specific thread
- **batch_get_threads**: Get multiple threads at once
- **search_related_threads**: Find threads from same sender/domain/subject
- **extract_relevant_context**: Extract relevant parts of a thread based on a question
- **list_labels**: List Gmail labels
- **get_current_time_tool**: Get current date/time for deadline calculations
- **generate_draft_reply**: Generate a draft email reply (use when user asks to generate/write/create a reply, draft, or response)

## Guidelines:
- Always use tools when you need to access email data
- For long threads, use extract_relevant_context to focus on relevant parts
- **When user asks to generate/write/create a reply or draft**: Use the generate_draft_reply tool
- When generating draft replies, be concise, professional, and address all questions/requests
- Cite specific messages when referencing content (e.g., "In the first message from John...")
- If you're unsure about something, say so rather than guessing
- For draft replies, include:
  - Appropriate greeting
  - Clear responses to all questions/requests
  - Professional closing
  - Any necessary action items or next steps

## Response Style:
- Be conversational but professional
- Use clear, concise language
- Structure longer responses with bullet points when helpful
- Always cite your sources (which message/thread you're referencing)

Remember: You can only READ email data, you cannot send emails or modify anything."""
    
    def _summarize_tool_result(self, tool_name: str, result: Dict[str, Any]) -> str:
        """Summarize tool result for display"""
        if not isinstance(result, dict):
            return "Tool executed"
        
        if tool_name == "get_thread":
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
        
        elif tool_name == "list_labels":
            if result.get("success"):
                labels = result.get("labels", [])
                return f"Found {len(labels)} label(s)"
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
    
    def chat(
        self,
        thread_id: str,
        question: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        step_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Chat with the agent about a specific thread
        
        Args:
            thread_id: Gmail thread ID
            question: User's question
            conversation_history: Previous messages in format [{"role": "user/assistant", "content": "..."}]
        
        Returns:
            Dictionary with:
            - answer: Agent's response
            - citations: List of message/thread references
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
        
        # Add current question with thread context hint
        current_message = f"""User is asking about thread {thread_id}:

{question}

Please use the available tools to get thread information and answer the question."""
        messages.append(HumanMessage(content=current_message))
        
        # Call LLM with tools
        try:
            response = self.llm_with_tools.invoke(messages)
            
            # Handle tool calls
            tool_calls = []
            citations = []
            thinking_steps = []  # Track thinking process
            
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
                    
                    # Find the tool
                    tool_func = None
                    for tool in self.tools:
                        if tool.name == tool_name:
                            tool_func = tool
                            break
                    
                    if tool_func:
                        try:
                            # Execute tool
                            if tool_name == "get_thread":
                                result = tool_func.invoke({"thread_id": thread_id, **tool_args})
                            elif tool_name == "extract_relevant_context":
                                result = tool_func.invoke({
                                    "thread_id": thread_id,
                                    "question": question,
                                    **tool_args
                                })
                            elif tool_name == "generate_draft_reply":
                                # Ensure thread_id is passed
                                result = tool_func.invoke({
                                    "thread_id": thread_id,
                                    **tool_args
                                })
                            else:
                                result = tool_func.invoke(tool_args)
                            
                            # Record successful tool call
                            tool_result_step = {
                                "type": "tool_result",
                                "tool": tool_name,
                                "status": "success",
                                "summary": self._summarize_tool_result(tool_name, result),
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
                                if "thread" in result:
                                    citations.append(f"Thread {thread_id}")
                                if "segments" in result:
                                    for seg in result.get("segments", []):
                                        if "message_id" in seg:
                                            citations.append(f"Message {seg['message_id']}")
                            
                            # Check if this is a draft generation result
                            is_draft_result = (
                                tool_name == "generate_draft_reply" and 
                                isinstance(result, dict) and 
                                result.get("success") and 
                                "subject" in result and 
                                "body" in result
                            )
                            
                            # Add tool result to messages
                            if is_draft_result:
                                # Format draft result for LLM to understand
                                draft_content = f"""Draft generated successfully:
SUBJECT: {result.get('subject', '')}
BODY: {result.get('body', '')}
TO: {result.get('to', '')}"""
                                messages.append(ToolMessage(
                                    content=draft_content,
                                    tool_call_id=tool_call["id"]
                                ))
                            else:
                                messages.append(ToolMessage(
                                    content=str(result),
                                    tool_call_id=tool_call["id"]
                                ))
                        except Exception as e:
                            # Record error
                            error_step = {
                                "type": "tool_result",
                                "tool": tool_name,
                                "status": "error",
                                "error": str(e),
                                "timestamp": None
                            }
                            thinking_steps.append(error_step)
                            if step_callback:
                                step_callback(error_step)
                            messages.append(ToolMessage(
                                content=f"Error calling {tool_name}: {str(e)}",
                                tool_call_id=tool_call["id"]
                            ))
                    else:
                        tool_not_found_step = {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": "error",
                            "error": "Tool not found",
                            "timestamp": None
                        }
                        thinking_steps.append(tool_not_found_step)
                        if step_callback:
                            step_callback(tool_not_found_step)
                        messages.append(ToolMessage(
                            content=f"Tool {tool_name} not found",
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
            
            # Check if any tool call generated a draft
            draft_data = None
            for tool_call_info in tool_calls:
                if tool_call_info.get("tool") == "generate_draft_reply":
                    result = tool_call_info.get("result", {})
                    if isinstance(result, dict) and result.get("success"):
                        draft_data = {
                            "subject": result.get("subject", ""),
                            "body": result.get("body", ""),
                            "to": result.get("to", ""),
                            "thread_id": thread_id
                        }
                        break
            
            return {
                "success": True,
                "answer": answer,
                "citations": citations,
                "tool_calls": tool_calls,
                "thinking_steps": thinking_steps,
                "draft_data": draft_data  # Include draft if generated
            }
            
        except Exception as e:
            import traceback
            print(f"Error in thread_chat_agent.chat: {e}")
            print(traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "answer": "I encountered an error while processing your question. Please try again."
            }
    
    def draft_reply(
        self,
        thread_id: str,
        instruction: Optional[str] = None,
        tone: str = "professional",
        step_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Generate a draft reply for a thread
        
        Args:
            thread_id: Gmail thread ID
            instruction: Optional instruction for the draft (e.g., "be concise", "ask for clarification")
            tone: Tone of the reply (professional, friendly, formal, casual)
        
        Returns:
            Dictionary with draft content
        """
        # Get thread first
        thread_data = self.gmail_service.get_thread_full(thread_id)
        normalized = self.gmail_service.normalize_thread(thread_data)
        
        if not normalized:
            return {
                "success": False,
                "error": "Failed to load thread"
            }
        
        # Add initial thinking step
        if step_callback:
            step_callback({
                "type": "planning",
                "content": "Analyzing thread context to generate draft reply...",
                "timestamp": None
            })
        
        # Extract recipient information from thread
        participants = normalized.get('participants', {})
        to_email = participants.get('from', '')  # Reply to the sender
        if not to_email:
            # Fallback: try to get from first message
            messages = normalized.get('messages', [])
            if messages:
                from_header = messages[0].get('from', '')
                # Extract email from "Name <email@example.com>" format
                import re
                match = re.search(r'<(.+?)>', from_header)
                if match:
                    to_email = match.group(1)
                else:
                    to_email = from_header
        
        if step_callback:
            step_callback({
                "type": "thinking",
                "content": "Extracting thread information and preparing draft generation...",
                "timestamp": None
            })
        
        # Get latest message content for context
        latest_message = normalized.get('messages', [{}])[-1] if normalized.get('messages') else {}
        latest_body = latest_message.get('body', '') or latest_message.get('snippet', '')
        
        # Build prompt for draft generation
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
        
        try:
            if step_callback:
                step_callback({
                    "type": "thinking",
                    "content": "Generating draft content with LLM...",
                    "timestamp": None
                })
            
            response = self.llm.invoke(messages)
            draft_content = response.content if hasattr(response, 'content') else str(response)
            
            if step_callback:
                step_callback({
                    "type": "thinking",
                    "content": "Parsing and cleaning draft content...",
                    "timestamp": None
                })
            
            # Clean up the response - remove any thinking or tool call traces
            import re
            # Remove JSON-like structures (tool calls)
            draft_content = re.sub(r'\{[^{}]*"action"[^{}]*\}', '', draft_content, flags=re.DOTALL)
            # Remove common thinking patterns
            draft_content = re.sub(r'I\'ll\s+[^\.]+\.', '', draft_content, flags=re.IGNORECASE)
            draft_content = re.sub(r'Let me\s+[^\.]+\.', '', draft_content, flags=re.IGNORECASE)
            
            # Parse draft (improved parsing)
            subject = ""
            body = ""
            
            # Try to extract SUBJECT and BODY
            if "SUBJECT:" in draft_content.upper():
                # Case-insensitive search
                subject_match = re.search(r'SUBJECT:\s*(.+?)(?=BODY:|$)', draft_content, re.IGNORECASE | re.DOTALL)
                if subject_match:
                    subject = subject_match.group(1).strip()
            
            if "BODY:" in draft_content.upper():
                body_match = re.search(r'BODY:\s*(.+?)$', draft_content, re.IGNORECASE | re.DOTALL)
                if body_match:
                    body = body_match.group(1).strip()
            
            # Fallback: if no BODY: found, use everything after SUBJECT: or everything
            if not body:
                if "SUBJECT:" in draft_content.upper():
                    parts = re.split(r'SUBJECT:', draft_content, flags=re.IGNORECASE, maxsplit=1)
                    if len(parts) > 1:
                        remaining = parts[1]
                        if "BODY:" in remaining.upper():
                            body = re.split(r'BODY:', remaining, flags=re.IGNORECASE, maxsplit=1)[1].strip()
                        else:
                            # No BODY: marker, use everything after subject
                            body = re.split(r'BODY:', remaining, flags=re.IGNORECASE, maxsplit=1)[0].strip()
                            if not subject:
                                # Subject might be in the first part
                                subject = body.split('\n')[0].strip()
                                body = '\n'.join(body.split('\n')[1:]).strip()
                else:
                    # No SUBJECT: marker, treat entire content as body
                    body = draft_content.strip()
            
            # Clean up subject and body
            subject = subject.strip().strip('"').strip("'")
            body = body.strip()
            
            # Remove any remaining markers or prefixes
            body = re.sub(r'^(SUBJECT:|BODY:)\s*', '', body, flags=re.IGNORECASE | re.MULTILINE)
            
            # If subject is empty, use Re: prefix for reply
            if not subject and normalized.get('subject'):
                original_subject = normalized.get('subject', '')
                # Add Re: if not already present
                if not original_subject.lower().startswith('re:'):
                    subject = f"Re: {original_subject}"
                else:
                    subject = original_subject
            
            # Final validation
            if not body:
                body = "Draft content could not be extracted. Please try again."
            
            return {
                "success": True,
                "subject": subject,
                "body": body,
                "full_draft": draft_content,
                "to": to_email,
                "thread_id": thread_id
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
