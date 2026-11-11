"""
Gmail Service
Handles Gmail API operations and data normalization
"""
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import HttpRequest
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import base64
import re
import email.utils

from app.services.telemetry import timed_operation

class TimedGmailRequest(HttpRequest):
    def __init__(self, *args, methodId=None, **kwargs):
        super().__init__(*args, methodId=methodId, **kwargs)
        self.operation = methodId or "gmail.request"

    def execute(self, *args, **kwargs):
        with timed_operation("gmail", self.operation):
            return super().execute(*args, **kwargs)


class GmailService:
    """Service for Gmail API operations"""
    
    def __init__(self, credentials: Credentials):
        self.service = build('gmail', 'v1', credentials=credentials, requestBuilder=TimedGmailRequest)
    
    def get_threads(self, max_results: int = 30, days: int = 7, *, query: Optional[str] = None) -> List[Dict]:
        """
        Get email threads from inbox
        
        Args:
            max_results: Maximum number of threads to return
            days: Number of days to look back
        
        Returns:
            List of thread dictionaries (raw Gmail format)
        """
        threads, _ = self.get_thread_page(max_results, days, query=query)
        return threads

    def _thread_listing(self, max_results, days, query=None, page_token=None):
        if not query:
            after = (datetime.now() - timedelta(days=days)).strftime("%Y/%m/%d")
            query = f"after:{after}"
        params = {"userId": "me", "maxResults": max_results, "q": query}
        if page_token:
            params["pageToken"] = page_token
        return self.service.users().threads().list(**params).execute()

    def list_thread_page(self, max_results, days, *, query=None, page_token=None, strict=False):
        response = self._thread_listing(max_results, days, query, page_token)
        ids = list(dict.fromkeys(thread["id"] for thread in response.get("threads", [])[:max_results]))
        return (self.get_metadata_batch(ids, strict=strict),
                response.get("nextPageToken"), response.get("resultSizeEstimate", 0))

    def get_metadata_batch(self, ids, *, strict=True):
        details = {}
        for offset in range(0, len(ids), 25):
            errors = []

            def record(thread_id, data, error):
                if error is None:
                    details[thread_id] = data
                elif not (isinstance(error, HttpError) and error.resp.status == 404):
                    errors.append(error)

            batch = self.service.new_batch_http_request(callback=record)
            for thread_id in ids[offset:offset + 25]:
                batch.add(self.thread_metadata_request(thread_id), request_id=thread_id)
            with timed_operation("gmail", "gmail.threads.get_batch", len(ids[offset:offset + 25])):
                batch.execute()
            if strict and errors:
                raise errors[0]
        return [details[thread_id] for thread_id in ids if thread_id in details]

    def get_history_id(self):
        return self.service.users().getProfile(userId="me", fields="historyId").execute()["historyId"]

    def get_history_page(self, history_id, page_token=None):
        params = {
            "userId": "me", "startHistoryId": history_id, "maxResults": 25,
            "fields": "historyId,nextPageToken,history(messagesAdded(message/threadId),"
                      "messagesDeleted(message/threadId),labelsAdded(message/threadId),labelsRemoved(message/threadId))",
        }
        if page_token:
            params["pageToken"] = page_token
        return self.service.users().history().list(**params).execute()

    def get_thread_page(self, max_results, days, *, query=None, page_token=None, strict=False):
        details, next_token, _ = self.list_thread_page(
            max_results, days, query=query, page_token=page_token, strict=strict
        )
        return details, next_token

    def get_recent_thread_ids(self, max_results: int, days: int) -> List[str]:
        return [thread["id"] for thread in self._thread_listing(max_results, days).get("threads", [])]

    def thread_metadata_request(self, thread_id):
        return self.service.users().threads().get(
            userId="me", id=thread_id, format="metadata",
            metadataHeaders=["From", "Subject", "Date", "To", "Cc"],
            fields="id,historyId,snippet,messages(id,internalDate,snippet,labelIds,payload(headers))",
        )

    def get_thread_metadata(self, thread_id):
        return self.thread_metadata_request(thread_id).execute()

    def get_thread_full(self, thread_id: str) -> Dict:
        """
        Get a specific thread by ID with full message content
        
        Args:
            thread_id: Gmail thread ID
        
        Returns:
            Thread dictionary with full messages
        """
        return self.service.users().threads().get(
            userId='me',
            id=thread_id,
            format='full'
        ).execute()
    
    def normalize_thread(self, thread_data: Dict, *, message_limit: Optional[int] = None) -> Dict:
        """
        Normalize Gmail thread data to internal Thread schema
        
        Args:
            thread_data: Raw Gmail thread data from API
        
        Returns:
            Normalized thread dictionary
        """
        messages = thread_data.get('messages', [])
        if not messages:
            return None
        
        # Get the latest message
        latest_message = messages[-1]
        headers = latest_message.get('payload', {}).get('headers', [])
        
        # Extract headers
        def get_header(name: str) -> str:
            return next((h['value'] for h in headers if h['name'] == name), '')
        
        from_header = get_header('From')
        to_header = get_header('To')
        cc_header = get_header('Cc')
        subject_header = get_header('Subject')
        date_header = get_header('Date')
        
        # Parse participants
        participants = {
            'from': self._parse_email_address(from_header),
            'to': self._parse_email_addresses(to_header),
            'cc': self._parse_email_addresses(cc_header),
            'bcc': []  # Bcc is usually not in headers
        }
        
        # Normalize subject (remove Re:, Fwd: prefixes for consistency)
        normalized_subject = self._normalize_subject(subject_header)
        
        # Parse date to ISO format
        normalized_date = self._parse_date(date_header)
        
        # Extract labels
        label_ids = latest_message.get('labelIds', [])
        is_unread = 'UNREAD' in label_ids
        
        # Normalize messages
        normalized_messages = []
        recent_messages = messages[-message_limit:] if message_limit else messages
        for msg in recent_messages:
            normalized_msg = self._normalize_message(msg)
            if normalized_msg:
                normalized_messages.append(normalized_msg)
        
        return {
            'thread_id': thread_data['id'],
            'subject': normalized_subject,
            'participants': participants,
            'messages': normalized_messages,
            'latest_message_date': normalized_date,
            'message_count': len(messages),
            'is_unread': is_unread,
            'labels': label_ids,
            'synced_at': datetime.utcnow().isoformat() + 'Z'
        }
    
    def _normalize_message(self, message_data: Dict) -> Optional[Dict]:
        """Normalize a single message"""
        headers = message_data.get('payload', {}).get('headers', [])
        
        def get_header(name: str) -> str:
            return next((h['value'] for h in headers if h['name'] == name), '')
        
        # Extract body
        body_text, body_html = self.extract_body(message_data.get('payload', {}))
        
        # Parse date
        date_str = get_header('Date')
        normalized_date = self._parse_date(date_str)
        
        return {
            'message_id': message_data['id'],
            'from': self._parse_email_address(get_header('From')),
            'to': self._parse_email_addresses(get_header('To')),
            'cc': self._parse_email_addresses(get_header('Cc')),
            'subject': self._normalize_subject(get_header('Subject')),
            'body_text': body_text,
            'body_html': body_html,
            'date': normalized_date,
            'snippet': message_data.get('snippet', ''),
            'labels': message_data.get('labelIds', [])
        }
    
    @staticmethod
    def extract_body(payload: Dict) -> Tuple[str, Optional[str]]:
        """Extract text and HTML body from message payload"""
        body_text = ""
        body_html = None
        
        def extract_from_part(part: Dict):
            nonlocal body_text, body_html
            mime_type = part.get('mimeType', '')
            if part.get('filename') or mime_type == 'message/rfc822':
                return
            body_data = part.get('body', {}).get('data', '')

            if body_data and mime_type in ('text/plain', 'text/html'):
                try:
                    raw = base64.urlsafe_b64decode(body_data + '=' * (-len(body_data) % 4))
                    content_type = next(
                        (header['value'] for header in part.get('headers', [])
                         if header.get('name', '').lower() == 'content-type'), ''
                    )
                    charset = re.search(r'charset\s*=\s*["\']?([\w.-]+)', content_type, re.I)
                    try:
                        decoded = raw.decode(charset[1] if charset else 'utf-8', errors='replace')
                    except LookupError:
                        decoded = raw.decode('utf-8', errors='replace')
                    if mime_type == 'text/plain' and not body_text:
                        body_text = decoded
                    elif mime_type == 'text/html' and not body_html:
                        body_html = decoded
                except Exception as e:
                    print(f"Error decoding body: {e}")
            
            # Recursively check parts
            if 'parts' in part:
                for subpart in part.get('parts', []):
                    extract_from_part(subpart)
        
        extract_from_part(payload)
        
        return body_text, body_html
    
    def _parse_email_address(self, address_str: str) -> str:
        """Parse email address from header string (e.g., 'Name <email@example.com>')"""
        if not address_str:
            return ''
        
        # Try to parse using email.utils
        try:
            name, addr = email.utils.parseaddr(address_str)
            return addr if addr else address_str
        except:
            # Fallback: extract email using regex
            match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', address_str)
            return match.group(0) if match else address_str
    
    def _parse_email_addresses(self, addresses_str: str) -> List[str]:
        """Parse multiple email addresses from header string"""
        if not addresses_str:
            return []
        
        addresses = []
        # Split by comma
        for addr in addresses_str.split(','):
            parsed = self._parse_email_address(addr.strip())
            if parsed:
                addresses.append(parsed)
        
        return addresses
    
    def _normalize_subject(self, subject: str) -> str:
        """Normalize subject by removing Re:, Fwd: prefixes"""
        if not subject:
            return '(No Subject)'
        
        # Remove common prefixes (case insensitive)
        subject = re.sub(r'^(re|fwd|fw):\s*', '', subject, flags=re.IGNORECASE)
        return subject.strip()
    
    def _parse_date(self, date_str: str) -> str:
        """Parse date string to ISO 8601 format"""
        if not date_str:
            return datetime.utcnow().isoformat() + 'Z'
        
        try:
            # Parse using email.utils
            parsed_time = email.utils.parsedate_tz(date_str)
            if parsed_time:
                timestamp = email.utils.mktime_tz(parsed_time)
                dt = datetime.fromtimestamp(timestamp)
                return dt.isoformat() + 'Z'
        except:
            pass
        
        # Fallback to current time
        return datetime.utcnow().isoformat() + 'Z'
    
    def create_draft(self, to: str, subject: str, body: str, thread_id: Optional[str] = None) -> Dict:
        """
        Create a Gmail draft
        
        Args:
            to: Recipient email
            subject: Email subject
            body: Email body
            thread_id: Optional thread ID for reply
        
        Returns:
            Draft dictionary with draft ID and other info
        """
        from email.message import EmailMessage
        
        # Create email message
        message = EmailMessage()
        message.set_content(body)
        message['To'] = to
        message['Subject'] = subject
        
        # Encode message
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        
        # Build draft body
        draft_body = {
            'message': {
                'raw': raw_message
            }
        }
        
        # Add thread_id if provided (for replies)
        if thread_id:
            draft_body['message']['threadId'] = thread_id
        
        # Create draft via Gmail API
        try:
            draft = self.service.users().drafts().create(
                userId='me',
                body=draft_body
            ).execute()
            
            return {
                "success": True,
                "draft_id": draft.get('id'),
                "message_id": draft.get('message', {}).get('id'),
                "thread_id": draft.get('message', {}).get('threadId'),
                "draft": draft
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
