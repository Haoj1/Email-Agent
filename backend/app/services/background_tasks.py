"""
Background Task for Email Sync and Embedding
"""
import asyncio
from typing import Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models import UserEmail, EmailEmbedding
from app.services.gmail_service import GmailService
from app.services.embedding_service import EmbeddingService
from google.oauth2.credentials import Credentials
import os

# Track running tasks to avoid duplicate processing
_running_tasks: Dict[str, datetime] = {}

async def sync_and_embed_emails(user_id: int, email: Optional[str] = None, days: int = 7, force: bool = False):
    """
    Background task to sync recent emails and generate embeddings
    
    Args:
        user_id: User ID
        email: Optional email address (defaults to primary)
        days: Number of days to look back (default: 7)
        force: Force processing even if recently processed (default: False)
    """
    # Create task key to track duplicates
    task_key = f"{user_id}_{email or 'primary'}"
    
    # Check if task is already running or was recently completed (within last hour)
    if not force and task_key in _running_tasks:
        last_run = _running_tasks[task_key]
        if datetime.now() - last_run < timedelta(hours=1):
            print(f"Skipping embedding task for {task_key} - recently completed")
            return
    
    # Mark task as running
    _running_tasks[task_key] = datetime.now()
    
    print(f"Starting background sync and embed for user {user_id}, email {email}...")
    
    # Get a new database session
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            # 1. Get credentials
            query = select(UserEmail).where(UserEmail.user_id == user_id)
            if email:
                query = query.where(UserEmail.email == email)
            else:
                query = query.where(UserEmail.is_primary == True)
                
            result = await db.execute(query)
            user_email = result.scalar_one_or_none()
            
            if not user_email:
                print(f"No email found for user {user_id}")
                return

            # Get OAuth token
            from app.models import OAuthToken
            token_query = select(OAuthToken).where(OAuthToken.user_email_id == user_email.id)
            token_result = await db.execute(token_query)
            token = token_result.scalar_one_or_none()
            
            if not token:
                print(f"No OAuth token found for email {user_email.email}")
                return

            creds = Credentials(
                token=token.access_token,
                refresh_token=token.refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=os.getenv("GOOGLE_CLIENT_ID"),
                client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
                scopes=token.scope.split(' ') if token.scope else []
            )

            # 2. Initialize services
            gmail_service = GmailService(creds)
            embedding_service = EmbeddingService()
            
            # 3. Fetch recent threads (reduced from 20 to 5 for faster processing)
            max_threads = 5 if not force else 20  # Process fewer threads on auto-sync
            raw_threads = gmail_service.get_threads(max_results=max_threads, days=days)
            print(f"Fetched {len(raw_threads)} threads for embedding")

            # Quick check: count how many threads need embedding
            thread_ids = [t['id'] for t in raw_threads]
            if thread_ids:
                existing_count_query = select(func.count()).select_from(
                    select(EmailEmbedding.thread_id)
                    .where(
                        EmailEmbedding.user_id == user_id,
                        EmailEmbedding.thread_id.in_(thread_ids)
                    )
                    .distinct()
                    .subquery()
                )
                existing_count_result = await db.execute(existing_count_query)
                existing_count = existing_count_result.scalar() or 0
                
                if existing_count >= len(thread_ids) and not force:
                    print(f"All {len(thread_ids)} threads already embedded, skipping")
                    return

            processed_count = 0
            for raw_thread in raw_threads:
                thread_id = raw_thread['id']
                
                # Check if we already have embeddings for this thread
                check_query = select(EmailEmbedding).where(
                    EmailEmbedding.user_id == user_id,
                    EmailEmbedding.thread_id == thread_id
                ).limit(1)
                check_result = await db.execute(check_query)
                if check_result.scalar_one_or_none():
                    continue  # Skip already embedded threads

                # Get full thread content
                full_thread = gmail_service.get_thread_full(thread_id)
                normalized = gmail_service.normalize_thread(full_thread)
                
                if not normalized or not normalized.get('messages'):
                    continue

                # Process each message in the thread (limit to first 3 messages per thread for speed)
                messages_to_process = normalized['messages'][:3]
                for msg in messages_to_process:
                    body = msg.get('body_text', '')
                    if not body or len(body.strip()) < 10:
                        continue

                    # Chunk and embed (smaller chunks for faster processing)
                    chunks = embedding_service.chunk_text(body, chunk_size=800, overlap=100)
                    # Limit chunks per message to avoid too many embeddings
                    chunks = chunks[:3]  # Max 3 chunks per message
                    
                    # Batch generate embeddings for better performance
                    if chunks:
                        vectors = embedding_service.get_embeddings(chunks)
                        for chunk, vector in zip(chunks, vectors):
                            new_embedding = EmailEmbedding(
                                user_id=user_id,
                                thread_id=thread_id,
                                message_id=msg['message_id'],
                                content=chunk,
                                embedding=vector
                            )
                            db.add(new_embedding)
                
                # Commit per thread to show progress and avoid long transactions
                await db.commit()
                processed_count += 1
                print(f"Embedded thread {thread_id} ({processed_count}/{len(raw_threads)})")

            print(f"Background sync and embed completed for user {user_id} - processed {processed_count} threads")

        except Exception as e:
            print(f"Error in background sync and embed: {e}")
            import traceback
            traceback.print_exc()
            await db.rollback()
        finally:
            # Update last run time
            _running_tasks[task_key] = datetime.now()
