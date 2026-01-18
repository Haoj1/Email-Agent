"""
Test database connection script
Run this to verify your PostgreSQL connection is working
"""
import asyncio
from sqlalchemy import text
from app.database import engine, get_database_url

async def test_connection():
    """Test database connection"""
    print("Testing database connection...")
    print(f"Database URL: {get_database_url().replace('password', '***')}")
    print()
    
    try:
        async with engine.begin() as conn:
            # Test basic connection
            result = await conn.execute(text("SELECT version();"))
            version = result.scalar()
            print(f"✅ Database connection successful!")
            print(f"PostgreSQL version: {version}")
            print()
            
            # Test database name
            result = await conn.execute(text("SELECT current_database();"))
            db_name = result.scalar()
            print(f"Connected to database: {db_name}")
            print()
            
            # Test user
            result = await conn.execute(text("SELECT current_user;"))
            user = result.scalar()
            print(f"Connected as user: {user}")
            print()
            
            # List tables (if any exist)
            result = await conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public';
            """))
            tables = result.fetchall()
            if tables:
                print("Existing tables:")
                for table in tables:
                    print(f"  - {table[0]}")
            else:
                print("No tables found (database is empty)")
            
    except Exception as e:
        print(f"❌ Database connection failed!")
        print(f"Error: {e}")
        print()
        print("Troubleshooting:")
        print("1. Check your .env file has correct DATABASE_* settings")
        print("2. Verify your IP is in the authorized networks (if using public IP)")
        print("3. Check database password is correct")
        print("4. Ensure Cloud SQL instance is running")
        return False
    
    return True

if __name__ == "__main__":
    success = asyncio.run(test_connection())
    exit(0 if success else 1)
