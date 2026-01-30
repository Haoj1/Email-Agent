"""
Add message_count column to triage_results table
Run this script to add the message_count field to existing database
"""
import asyncio
from sqlalchemy import text
from app.database import engine, get_database_url

async def add_message_count_column():
    """Add message_count column to triage_results table"""
    print("Adding message_count column to triage_results table...")
    print(f"Database URL: {get_database_url().replace('password', '***')}")
    print()
    
    try:
        async with engine.begin() as conn:
            # Check if column already exists
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'triage_results' 
                AND column_name = 'message_count';
            """)
            result = await conn.execute(check_query)
            exists = result.fetchone()
            
            if exists:
                print("✅ Column 'message_count' already exists in triage_results table")
                return
            
            # Add the column
            alter_query = text("""
                ALTER TABLE triage_results 
                ADD COLUMN message_count INTEGER;
            """)
            await conn.execute(alter_query)
            print("✅ Successfully added message_count column to triage_results table")
            print()
            print("Note: Existing rows will have message_count = NULL")
            print("They will be updated when triage is run again on those threads.")
            
    except Exception as e:
        print(f"❌ Error adding column: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(add_message_count_column())
