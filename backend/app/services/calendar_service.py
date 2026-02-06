"""
Calendar Service
Handles Google Calendar API operations
"""
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from typing import List, Dict, Optional, Any
from datetime import datetime

class CalendarService:
    """Service for Calendar API operations"""
    
    def __init__(self, credentials: Credentials):
        self.service = build('calendar', 'v3', credentials=credentials)
    
    def list_events(
        self,
        time_min_iso: str,
        time_max_iso: str,
        calendar_id: str = "primary",
        max_results: int = 2500,
    ) -> List[Dict[str, Any]]:
        """
        List calendar events in a time range.

        Args:
            time_min_iso: RFC3339/ISO start time (inclusive)
            time_max_iso: RFC3339/ISO end time (exclusive)
            calendar_id: Calendar ID (default: primary)
            max_results: Max events to return

        Returns:
            List of Google Calendar event resources.
        """
        events: List[Dict[str, Any]] = []
        page_token: Optional[str] = None

        while True:
            resp = (
                self.service.events()
                .list(
                    calendarId=calendar_id,
                    timeMin=time_min_iso,
                    timeMax=time_max_iso,
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=max_results,
                    pageToken=page_token,
                )
                .execute()
            )
            events.extend(resp.get("items", []) or [])
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        return events

    def create_event(self, event_data: Dict[str, Any], calendar_id: str = "primary") -> Dict[str, Any]:
        """
        Create a calendar event
        
        Args:
            event_data: Event dictionary with title, start, end, etc.
            calendar_id: Calendar ID (default: primary)
        
        Returns:
            Created event dictionary
        """
        # Minimal mapping to Google Calendar API fields
        payload: Dict[str, Any] = {
            "summary": event_data.get("summary") or event_data.get("title") or "Email follow-up",
            "description": event_data.get("description") or "",
            "location": event_data.get("location") or None,
            "attendees": event_data.get("attendees") or None,
            "start": event_data.get("start"),
            "end": event_data.get("end"),
        }
        # Remove Nones to keep payload clean
        payload = {k: v for k, v in payload.items() if v is not None}

        created = self.service.events().insert(calendarId=calendar_id, body=payload).execute()
        return created
    
    def extract_events_from_text(self, text: str) -> List[Dict]:
        """
        Extract potential calendar events from text (using LLM)
        
        Args:
            text: Text to analyze (e.g., email body)
        
        Returns:
            List of potential event dictionaries
        """
        # TODO: Implement event extraction using LLM
        pass
