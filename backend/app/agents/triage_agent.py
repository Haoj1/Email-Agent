"""
Email Triage Agent - Classify and prioritize email threads
Uses LangGraph with DeepSeek LLM
"""
import json
from typing import Dict, List, Optional
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from app.agents.llm_factory import get_triage_llm


class TriageResultSchema(BaseModel):
    """Schema for Triage Agent output"""
    label: str = Field(description="Email category: NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE")
    priority: float = Field(description="Priority score from 0.0 to 1.0 (higher = more urgent)")
    summary: str = Field(description="Brief summary of the email thread (1-3 sentences)")
    key_points: List[str] = Field(description="Key points or action items from the email (max 5 items)")


class TriageAgent:
    """Email Triage Agent using LangGraph"""
    
    def __init__(self):
        self.llm = get_triage_llm()
        self.parser = JsonOutputParser(pydantic_object=TriageResultSchema)
    
    def triage_thread(self, thread_data: Dict) -> Dict:
        """
        Triage a single email thread
        
        Args:
            thread_data: Normalized thread data from GmailService
        
        Returns:
            Triage result dictionary with label, priority, summary, key_points
        """
        # Build prompt from thread data
        prompt = self._build_prompt(thread_data)
        
        # Create messages
        messages = [
            SystemMessage(content=self._get_system_prompt()),
            HumanMessage(content=prompt)
        ]
        
        # Call LLM
        try:
            response = self.llm.invoke(messages)
            response_content = response.content.strip()
            
            # Try to extract JSON from response (in case LLM adds extra text)
            import re
            json_match = re.search(r'\{[^{}]*\}', response_content, re.DOTALL)
            if json_match:
                response_content = json_match.group(0)
            
            # Parse JSON response - JsonOutputParser returns a dict
            result_dict = self.parser.parse(response_content)
            
            # Validate and extract values
            label = result_dict.get("label", "FYI")
            priority = float(result_dict.get("priority", 0.5))
            summary = result_dict.get("summary", "Unable to analyze email content.")
            key_points = result_dict.get("key_points", [])
            
            # Validate label
            valid_labels = ["NEEDS_REPLY", "FYI", "ARCHIVE", "SPAM_LIKE"]
            if label not in valid_labels:
                print(f"Warning: Invalid label '{label}', defaulting to 'FYI'")
                label = "FYI"
            
            # Clamp priority to 0.0-1.0
            priority = max(0.0, min(1.0, priority))
            
            return {
                "thread_id": thread_data.get("thread_id"),
                "label": label,
                "priority": priority,
                "summary": summary,
                "key_points": key_points if isinstance(key_points, list) else []
            }
        except Exception as e:
            # Fallback: return basic classification
            import traceback
            print(f"Error in triage_thread for thread {thread_data.get('thread_id')}: {e}")
            print(f"Response content: {response.content if 'response' in locals() else 'N/A'}")
            print(f"Traceback: {traceback.format_exc()}")
            return {
                "thread_id": thread_data.get("thread_id"),
                "label": "FYI",
                "priority": 0.5,
                "summary": "Unable to analyze email content.",
                "key_points": []
            }
    
    def _get_system_prompt(self) -> str:
        """System prompt for the Triage Agent"""
        return """You are an expert email triage assistant. Your task is to analyze email threads and classify them into categories, assign priority scores, and extract key information.

## Classification Categories:
1. **NEEDS_REPLY**: Email requires a response or action from the recipient
   - Contains questions, requests, or requires confirmation
   - Has deadlines or time-sensitive information
   - Requires decision-making or approval

2. **FYI**: For Your Information - no immediate action needed
   - Informational updates, newsletters, announcements
   - Status updates, reports, summaries
   - General information sharing

3. **ARCHIVE**: Can be archived or deleted
   - Completed conversations
   - Outdated information
   - No longer relevant

4. **SPAM_LIKE**: Suspicious or unwanted emails
   - Promotional emails, marketing
   - Suspicious links or requests
   - Unwanted subscriptions

## Priority Scoring (0.0 - 1.0):
- **0.8-1.0**: Urgent - requires immediate attention (deadlines, critical issues)
- **0.5-0.8**: Important - should be addressed soon (questions, requests)
- **0.2-0.5**: Normal - can be handled when convenient
- **0.0-0.2**: Low priority - can be deferred or archived

## Output Format:
You must respond with valid JSON matching this schema:
{
    "label": "NEEDS_REPLY" | "FYI" | "ARCHIVE" | "SPAM_LIKE",
    "priority": 0.0-1.0,
    "summary": "Brief 1-3 sentence summary",
    "key_points": ["point1", "point2", ...]
}

Be concise but accurate. Focus on actionable insights."""
    
    def _build_prompt(self, thread_data: Dict) -> str:
        """Build prompt from thread data"""
        subject = thread_data.get("subject", "(No Subject)")
        participants = thread_data.get("participants", {})
        from_email = participants.get("from", "Unknown")
        to_emails = participants.get("to", [])
        message_count = thread_data.get("message_count", 0)
        is_unread = thread_data.get("is_unread", False)
        
        # Get message snippets
        messages = thread_data.get("messages", [])
        message_texts = []
        for msg in messages[-3:]:  # Last 3 messages for context
            snippet = msg.get("snippet", "")
            body_text = msg.get("body_text", "")
            content = body_text[:500] if body_text else snippet[:200]
            if content:
                message_texts.append(f"- {content}")
        
        prompt = f"""Analyze this email thread and provide classification:

**Subject:** {subject}
**From:** {from_email}
**To:** {', '.join(to_emails) if to_emails else 'Unknown'}
**Message Count:** {message_count}
**Unread:** {'Yes' if is_unread else 'No'}

**Recent Messages:**
{chr(10).join(message_texts) if message_texts else 'No message content available'}

Please classify this email thread and provide a JSON response with the following structure:
{{
    "label": "NEEDS_REPLY" | "FYI" | "ARCHIVE" | "SPAM_LIKE",
    "priority": 0.0-1.0,
    "summary": "Brief 1-3 sentence summary",
    "key_points": ["point1", "point2", ...]
}}

Respond ONLY with valid JSON, no other text."""
        
        return prompt
    
    def triage_batch(self, threads: List[Dict]) -> List[Dict]:
        """
        Triage multiple threads (sequential processing)
        
        Args:
            threads: List of normalized thread data
        
        Returns:
            List of triage results
        """
        results = []
        for i, thread in enumerate(threads):
            print(f"Processing thread {i+1}/{len(threads)}: {thread.get('thread_id', 'unknown')}")
            result = self.triage_thread(thread)
            results.append(result)
        return results
