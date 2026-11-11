"""
Database models for MVP - Minimal but sufficient design
"""
from sqlalchemy import Column, Integer, BigInteger, String, Text, DateTime, ForeignKey, UniqueConstraint, Float, Index, Boolean, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from app.database import Base


class User(Base):
    """User model - stores application user information"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    primary_email = Column(String, nullable=True, index=True)  # Primary email for initial login identification (nullable for flexibility)
    timezone = Column(String, nullable=True)
    ai_review_mode = Column(String(24), nullable=False, server_default="off")
    ai_review_since = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    emails = relationship("UserEmail", back_populates="user", cascade="all, delete-orphan")
    oauth_tokens = relationship("OAuthToken", back_populates="user", cascade="all, delete-orphan")
    thread_caches = relationship("ThreadCache", back_populates="user", cascade="all, delete-orphan")
    assist_chat_sessions = relationship("AssistChatSession", back_populates="user", cascade="all, delete-orphan")
    triage_tasks = relationship("TriageTask", back_populates="user", cascade="all, delete-orphan")
    triage_results = relationship("TriageResult", back_populates="user", cascade="all, delete-orphan")
    drafts = relationship("Draft", back_populates="user", cascade="all, delete-orphan")
    calendar_proposals = relationship("CalendarProposal", back_populates="user", cascade="all, delete-orphan")


class UserEmail(Base):
    """User email accounts - supports multiple emails per user"""
    __tablename__ = "user_emails"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, unique=True, nullable=False, index=True)  # Google account email
    is_primary = Column(Boolean, nullable=False, default=False)  # Is this the primary email
    verified = Column(Boolean, nullable=False, default=True)  # Is email verified (default True for OAuth)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="emails")
    oauth_tokens = relationship("OAuthToken", back_populates="user_email", cascade="all, delete-orphan")
    
    # Indexes for common queries
    __table_args__ = (
        Index('idx_user_email_user_primary', 'user_id', 'is_primary'),  # Find primary email
        UniqueConstraint('user_id', 'email', name='unique_user_email'),  # One email per user
    )


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token_hash = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)


class FollowUp(Base):
    __tablename__ = "follow_ups"

    user_email_id = Column(Integer, ForeignKey("user_emails.id", ondelete="CASCADE"), primary_key=True)
    thread_id = Column(String(128), primary_key=True)
    subject = Column(String(512), nullable=False)
    status = Column(String(16), nullable=False)
    due_at = Column(DateTime(timezone=True))
    last_inbound_at_ms = Column(BigInteger, nullable=False, server_default="0")
    reopened_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('reply', 'waiting', 'later', 'done')", name="follow_up_status"),
        Index("idx_follow_up_mailbox_status_due", "user_email_id", "status", "due_at"),
    )


class MailboxSyncState(Base):
    __tablename__ = "mailbox_sync_state"

    user_email_id = Column(Integer, ForeignKey("user_emails.id", ondelete="CASCADE"), primary_key=True)
    history_id = Column(String(32))
    bootstrap_history_id = Column(String(32))
    page_token = Column(Text)
    next_check_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    synced_at = Column(DateTime(timezone=True))
    changed_at = Column(DateTime(timezone=True))


class MailboxThreadIndex(Base):
    __tablename__ = "mailbox_thread_index"

    user_email_id = Column(Integer, ForeignKey("user_emails.id", ondelete="CASCADE"), primary_key=True)
    thread_id = Column(String(128), primary_key=True)
    desired_version = Column(String(64), nullable=False)
    indexed_version = Column(String(64))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_mailbox_thread_pending", "user_email_id", "updated_at",
              postgresql_where=(indexed_version.is_distinct_from(desired_version))),
    )


class OAuthToken(Base):
    """OAuth token storage for Google API access - linked to specific email"""
    __tablename__ = "oauth_tokens"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email_id = Column(Integer, ForeignKey("user_emails.id", ondelete="CASCADE"), nullable=False, index=True)  # Link to specific email
    provider = Column(String, nullable=False, default="google")
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    scope = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="oauth_tokens")
    user_email = relationship("UserEmail", back_populates="oauth_tokens")
    
    # One token per email per user
    __table_args__ = (
        UniqueConstraint('user_id', 'user_email_id', name='unique_user_email_token'),
        Index('idx_oauth_user_email', 'user_id', 'user_email_id'),  # Find token for specific email
    )


class ThreadCache(Base):
    """Cache for thread chat agent outputs"""
    __tablename__ = "thread_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    thread_id = Column(String, nullable=False, index=True)
    agent_output = Column(JSONB, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="thread_caches")
    
    # MVP: Unique constraint ensures one cache per thread, no extra indexes needed
    __table_args__ = (
        UniqueConstraint('user_id', 'thread_id', name='unique_user_thread'),
    )


class AssistChatSession(Base):
    """Assist Chat Agent conversation sessions"""
    __tablename__ = "assist_chat_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String, unique=True, nullable=False, index=True)  # Unique index for lookup
    conversation_history = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="assist_chat_sessions")
    
    # MVP: Only essential index - get recent sessions for user
    __table_args__ = (
        Index('idx_assist_user_updated', 'user_id', 'updated_at'),  # List recent sessions
        Index('idx_assist_user_created_at', 'user_id', 'created_at'),
    )


class AssistChatMessage(Base):
    """Append-only Copilot messages. Existing session JSON remains readable."""
    __tablename__ = "assist_chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("assist_chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(12), nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(JSONB, nullable=True)
    used_web_search = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="valid_assist_chat_role"),
        Index("idx_assist_chat_messages_session_order", "session_id", "id"),
    )


class TriageTask(Base):
    """Async triage task tracking - for submitting and polling task status"""
    __tablename__ = "triage_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(String, unique=True, nullable=False, index=True)  # Unique task identifier (UUID)
    status = Column(String, nullable=False, default="pending", index=True)  # pending, running, completed, failed
    thread_ids = Column(JSONB, nullable=False)  # Array of thread IDs to process
    total_threads = Column(Integer, nullable=False, default=0)
    processed_threads = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)  # Error message if failed
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="triage_tasks")
    results = relationship("TriageResult", back_populates="task", cascade="all, delete-orphan")
    
    # MVP: Essential indexes for task polling
    __table_args__ = (
        Index('idx_triage_task_user_status', 'user_id', 'status', 'created_at'),  # List user's tasks by status
        Index('idx_triage_task_user_created_at', 'user_id', 'created_at'),
    )


class TriageResult(Base):
    """Batch email agent triage and summary results"""
    __tablename__ = "triage_results"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey("triage_tasks.id", ondelete="SET NULL"), nullable=True, index=True)  # Link to task
    email = Column(String, nullable=True, index=True)  # Source email for this triage result
    thread_id = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)  # NEEDS_REPLY, FYI, ARCHIVE, SPAM_LIKE
    priority = Column(Float, nullable=False)  # 0-1
    summary = Column(Text, nullable=True)
    key_points = Column(JSONB, nullable=True)
    message_count = Column(Integer, nullable=True)  # Number of messages in thread when triaged (for smart updates)
    ai_reviewed = Column(Boolean, nullable=False, server_default="false")
    ai_reviewed_through_ms = Column(BigInteger, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="triage_results")
    task = relationship("TriageTask", back_populates="results")
    
    # MVP: Essential indexes for Today View
    __table_args__ = (
        UniqueConstraint('user_id', 'thread_id', name='unique_user_thread_triage'),
        Index('idx_triage_user_label_priority', 'user_id', 'label', 'priority'),  # Today View filtering
        Index('idx_triage_user_created_at', 'user_id', 'created_at'),  # Added for time-based filtering
        Index('idx_triage_user_updated_at', 'user_id', 'updated_at'),
    )


class Draft(Base):
    """Email draft records generated by agents"""
    __tablename__ = "drafts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    thread_id = Column(String, nullable=True)  # Nullable for new emails
    gmail_draft_id = Column(String, nullable=True, unique=True)  # Gmail draft ID after saving
    to = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, saved, sent, deleted
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="drafts")
    
    # MVP: Only essential index - list user's drafts
    __table_args__ = (
        Index('idx_draft_user_created', 'user_id', 'created_at'),  # List drafts
        Index('idx_draft_user_updated_at', 'user_id', 'updated_at'),
    )


class CalendarProposal(Base):
    """Calendar event proposals extracted from emails"""
    __tablename__ = "calendar_proposals"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    thread_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    start_iso = Column(DateTime(timezone=True), nullable=False)
    end_iso = Column(DateTime(timezone=True), nullable=False)
    timezone = Column(String, nullable=True)
    attendees = Column(JSONB, nullable=True)
    location = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False)  # 0-1, extraction confidence
    status = Column(String, nullable=False, default="pending")  # pending, confirmed, rejected, created
    calendar_event_id = Column(String, nullable=True, unique=True)  # Google Calendar event ID after creation
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="calendar_proposals")
    
    # MVP: Essential index - list pending proposals by date
    __table_args__ = (
        Index('idx_calendar_user_status_start', 'user_id', 'status', 'start_iso'),  # List proposals
        Index('idx_calendar_user_created_at', 'user_id', 'created_at'),
        Index('idx_calendar_user_updated_at', 'user_id', 'updated_at'),
    )


class EmailEmbedding(Base):
    """Stores email chunks and their vectors for RAG retrieval"""
    __tablename__ = "email_embeddings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email_id = Column(Integer, ForeignKey("user_emails.id", ondelete="CASCADE"))
    thread_id = Column(String, nullable=False, index=True)
    message_id = Column(String, nullable=True)
    
    content = Column(Text, nullable=False)  # The actual text chunk
    embedding = Column(Vector(384), nullable=False)  # 384 dimensions for all-MiniLM-L6-v2
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User")
    
    __table_args__ = (
        Index('idx_email_embedding_user_thread', 'user_id', 'thread_id'),
        Index('idx_email_embedding_mailbox_thread', 'user_email_id', 'thread_id'),
    )
