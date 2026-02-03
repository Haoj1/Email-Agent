"""
Initialize database - create all tables for MVP
Run this script to set up the database schema
"""
import asyncio
from app.database import init_db, engine
from sqlalchemy import text

async def main(drop_tables=False):
    """Initialize database"""
    print(f"🚀 {'Re-initializing' if drop_tables else 'Initializing'} database for MVP...")
    print()
    
    try:
        if drop_tables:
            print("⚠️  Dropping all existing tables...")
            async with engine.begin() as conn:
                from app.database import Base
                await conn.run_sync(Base.metadata.drop_all)
            print("✅ Tables dropped successfully.")
            print()

        # Initialize database (create tables)
        await init_db()
        
        # Apply missing indexes without dropping tables
        if not drop_tables:
            print("🔍 Checking for missing indexes...")
            async with engine.begin() as conn:
                # List of indexes to ensure (table_name, index_name, columns)
                # Based on models.py definitions
                required_indexes = [
                    ('assist_chat_sessions', 'idx_assist_user_created_at', 'user_id, created_at'),
                    ('triage_tasks', 'idx_triage_task_user_created_at', 'user_id, created_at'),
                    ('triage_results', 'idx_triage_user_created_at', 'user_id, created_at'),
                    ('triage_results', 'idx_triage_user_updated_at', 'user_id, updated_at'),
                    ('drafts', 'idx_draft_user_updated_at', 'user_id, updated_at'),
                    ('calendar_proposals', 'idx_calendar_user_created_at', 'user_id, created_at'),
                    ('calendar_proposals', 'idx_calendar_user_updated_at', 'user_id, updated_at'),
                    ('email_embeddings', 'idx_email_embedding_user_thread', 'user_id, thread_id'),
                ]
                
                for table, idx_name, cols in required_indexes:
                    # Check if index exists
                    check_idx = await conn.execute(text(f"""
                        SELECT 1 FROM pg_indexes 
                        WHERE schemaname = 'public' 
                        AND tablename = '{table}' 
                        AND indexname = '{idx_name}';
                    """))
                    if not check_idx.fetchone():
                        print(f"  ➕ Creating missing index {idx_name} on {table}...")
                        try:
                            await conn.execute(text(f"CREATE INDEX {idx_name} ON {table} ({cols});"))
                            print(f"  ✅ Created {idx_name}")
                        except Exception as idx_err:
                            print(f"  ⚠️  Could not create {idx_name}: {idx_err}")
                    else:
                        print(f"  ✨ Index {idx_name} already exists.")
            print()

        # Verify tables were created
        async with engine.begin() as conn:
            result = await conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name;
            """))
            tables = result.fetchall()
            
            if tables:
                print()
                print("✅ Database initialized successfully!")
                print()
                print("Created tables and verified columns:")
                for table in tables:
                    table_name = table[0]
                    # Get column details
                    col_result = await conn.execute(text(f"""
                        SELECT column_name, data_type 
                        FROM information_schema.columns 
                        WHERE table_name = '{table_name}'
                        ORDER BY ordinal_position;
                    """))
                    columns = col_result.fetchall()
                    print(f"  - {table_name}:")
                    for col in columns:
                        print(f"    • {col[0]} ({col[1]})")
            
            # Count indexes
            result = await conn.execute(text("""
                SELECT COUNT(*) 
                FROM pg_indexes
                WHERE schemaname = 'public';
            """))
            index_count = result.scalar()
            
            print()
            print(f"✅ Verified {len(tables)} tables with {index_count} indexes")
            print()
            print("MVP database is ready with all current model fields!")
        
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        await engine.dispose()
    
    return True

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Initialize database for MVP')
    parser.add_argument('--drop', action='store_true', help='Drop all tables before recreating')
    args = parser.parse_args()
    
    success = asyncio.run(main(drop_tables=args.drop))
    exit(0 if success else 1)
