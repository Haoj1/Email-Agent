"""
Initialize database - create all tables for MVP
Run this script to set up the database schema
"""
import asyncio
from app.database import init_db, engine
from sqlalchemy import text

async def main():
    """Initialize database"""
    print("🚀 Initializing database for MVP...")
    print()
    
    try:
        # Initialize database (create tables)
        await init_db()
        
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
                print("Created tables:")
                for table in tables:
                    print(f"  - {table[0]}")
            
            # Count indexes
            result = await conn.execute(text("""
                SELECT COUNT(*) 
                FROM pg_indexes
                WHERE schemaname = 'public';
            """))
            index_count = result.scalar()
            
            print()
            print(f"✅ Created {len(tables)} tables with {index_count} indexes")
            print()
            print("MVP database is ready!")
        
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        await engine.dispose()
    
    return True

if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)
