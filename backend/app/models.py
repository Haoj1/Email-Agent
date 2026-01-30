"""
Database models for MVP - Minimal but sufficient design
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, Float, Index, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    """User model - stores application user information"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    primary_email = Column(String, nullable=True, index=True)  # Primary email for initial login identification (nullable for flexibility)
    timezone = Column(String, nullable=True)
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="triage_results")
    task = relationship("TriageTask", back_populates="results")
    
    # MVP: Essential indexes for Today View
    __table_args__ = (
        UniqueConstraint('user_id', 'thread_id', name='unique_user_thread_triage'),
        Index('idx_triage_user_label_priority', 'user_id', 'label', 'priority'),  # Today View filtering
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
    )
