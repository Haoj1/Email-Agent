"""
Background Task for Email Sync and Embedding
"""
import asyncio
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import UserEmail, EmailEmbedding
from app.services.gmail_service import GmailService
from app.services.embedding_service import EmbeddingService
from google.oauth2.credentials import Credentials
import os

async def sync_and_embed_emails(user_id: int, email: Optional[str] = None, days: int = 7):
    """
    Background task to sync recent emails and generate embeddings
    """
    print(f"Starting background sync and embed for user {user_id}, email {email}...")
    
    # Get a new database session
    from app.database import SessionLocal
    async with SessionLocal() as db:
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
            
            # 3. Fetch recent threads
            raw_threads = gmail_service.get_threads(max_results=20, days=days)
            print(f"Fetched {len(raw_threads)} threads for embedding")

            for raw_thread in raw_threads:
                thread_id = raw_thread['id']
                
                # Check if we already have embeddings for this thread
                check_query = select(EmailEmbedding).where(
                    EmailEmbedding.user_id == user_id,
                    EmailEmbedding.thread_id == thread_id
                ).limit(1)
                check_result = await db.execute(check_query)
                if check_result.scalar_one_or_none():
                    print(f"Thread {thread_id} already embedded, skipping")
                    continue

                # Get full thread content
                full_thread = gmail_service.get_thread_full(thread_id)
                normalized = gmail_service.normalize_thread(full_thread)
                
                if not normalized or not normalized.get('messages'):
                    continue

                # Process each message in the thread
                for msg in normalized['messages']:
                    body = msg.get('body_text', '')
                    if not body or len(body.strip()) < 10:
                        continue

                    # Chunk and embed
                    chunks = embedding_service.chunk_text(body)
                    for chunk in chunks:
                        vector = embedding_service.get_embedding(chunk)
                        
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
                print(f"Embedded thread {thread_id}")

            print(f"Background sync and embed completed for user {user_id}")

        except Exception as e:
            print(f"Error in background sync and embed: {e}")
            import traceback
            traceback.print_exc()
            await db.rollback()
