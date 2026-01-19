"""
Database connection and session management for PostgreSQL
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from app.config import settings
import os

# Base class for models
Base = declarative_base()

# Import models to register them with Base.metadata
# This ensures tables are created when init_db() is called
from app import models  # noqa: F401, E402

# Database URL construction
def get_database_url() -> str:
    """
    Construct database URL from settings.
    Supports both direct connection and Cloud SQL connection.
    """
    if settings.DATABASE_URL:
        # Use provided DATABASE_URL directly
        return settings.DATABASE_URL
    
    # Construct from individual settings
    if settings.DATABASE_CONNECTION_NAME:
        # Cloud SQL connection (Unix socket or Cloud SQL Proxy)
        # Format: postgresql+psycopg://USER:PASSWORD@/DATABASE?host=/cloudsql/CONNECTION_NAME
        if settings.DATABASE_PASSWORD:
            return (
                f"postgresql+psycopg://{settings.DATABASE_USER}:{settings.DATABASE_PASSWORD}"
                f"@/{settings.DATABASE_NAME}?host=/cloudsql/{settings.DATABASE_CONNECTION_NAME}"
            )
        else:
            return (
                f"postgresql+psycopg://{settings.DATABASE_USER}"
                f"@/{settings.DATABASE_NAME}?host=/cloudsql/{settings.DATABASE_CONNECTION_NAME}"
            )
    else:
        # Direct TCP connection
        if settings.DATABASE_PASSWORD:
            return (
                f"postgresql+psycopg://{settings.DATABASE_USER}:{settings.DATABASE_PASSWORD}"
                f"@{settings.DATABASE_HOST}:{settings.DATABASE_PORT}/{settings.DATABASE_NAME}"
            )
        else:
            return (
                f"postgresql+psycopg://{settings.DATABASE_USER}"
                f"@{settings.DATABASE_HOST}:{settings.DATABASE_PORT}/{settings.DATABASE_NAME}"
            )

# Create async engine
database_url = get_database_url()
engine = create_async_engine(
    database_url,
    echo=settings.DEBUG,  # Log SQL queries in debug mode
    poolclass=NullPool if settings.DATABASE_CONNECTION_NAME else None,  # Use NullPool for Cloud SQL
    pool_pre_ping=True,  # Verify connections before using
)

# Create session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Dependency for FastAPI
async def get_db() -> AsyncSession:
    """
    Dependency function to get database session.
    Use this in FastAPI route dependencies.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# Initialize database (create tables)
async def init_db():
    """
    Initialize database by creating all tables.
    Call this on application startup.
    """
    async with engine.begin() as conn:
        # Enable pgvector extension for RAG support (if needed)
        # This will be ignored if extension doesn't exist or is already enabled
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            print("✅ pgvector extension enabled (for RAG support)")
        except Exception as e:
            print(f"⚠️  pgvector extension not available: {e}")
            print("   (This is OK if you're not using RAG features yet)")
        
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
