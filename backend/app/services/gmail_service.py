"""
Gmail Service
Handles Gmail API operations and data normalization
"""
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
import base64
import re
import email.utils

class GmailService:
    """Service for Gmail API operations"""
    
    def __init__(self, credentials: Credentials):
        self.service = build('gmail', 'v1', credentials=credentials)
    
    def get_threads(self, max_results: int = 30, days: int = 7) -> List[Dict]:
        """
        Get email threads from inbox
        
        Args:
            max_results: Maximum number of threads to return
            days: Number of days to look back
        
        Returns:
            List of thread dictionaries (raw Gmail format)
        """
        after_date = (datetime.now() - timedelta(days=days)).strftime('%Y/%m/%d')
        query = f'after:{after_date}'
        
        result = self.service.users().threads().list(
            userId='me',
            maxResults=max_results,
            q=query
        ).execute()
        
        threads = result.get('threads', [])
        thread_details = []
        
        for thread in threads[:max_results]:
            try:
                thread_detail = self.service.users().threads().get(
                    userId='me',
                    id=thread['id'],
                    format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date', 'To', 'Cc']
                ).execute()
                thread_details.append(thread_detail)
            except Exception as e:
                print(f"Error getting thread {thread.get('id')}: {e}")
                continue
        
        return thread_details
    
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
    
    def normalize_thread(self, thread_data: Dict) -> Dict:
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
        for msg in messages:
            normalized_msg = self._normalize_message(msg)
            if normalized_msg:
                normalized_messages.append(normalized_msg)
        
        return {
            'thread_id': thread_data['id'],
            'subject': normalized_subject,
            'participants': participants,
            'messages': normalized_messages,
            'latest_message_date': normalized_date,
            'message_count': len(normalized_messages),
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
        body_text, body_html = self._extract_body(message_data.get('payload', {}))
        
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
    
    def _extract_body(self, payload: Dict) -> Tuple[str, Optional[str]]:
        """Extract text and HTML body from message payload"""
        body_text = ""
        body_html = None
        
        def extract_from_part(part: Dict):
            nonlocal body_text, body_html
            mime_type = part.get('mimeType', '')
            body_data = part.get('body', {}).get('data', '')
            
            if body_data:
                try:
                    decoded = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
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
        
        if 'parts' in payload:
            for part in payload['parts']:
                extract_from_part(part)
        else:
            # Single part message
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
