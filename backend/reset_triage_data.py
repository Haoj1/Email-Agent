"""
Reset Triage Data Script
Safely clears triage_results and triage_tasks tables without affecting other data
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select, delete
from app.database import get_database_url
from app.models import TriageResult, TriageTask
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


async def reset_triage_data(user_id: int = None):
    """
    Reset triage data (triage_results and triage_tasks)
    
    Args:
        user_id: Optional user ID to reset only for specific user.
                 If None, resets for all users.
    """
    # Create async engine
    database_url = get_database_url()
    engine = create_async_engine(database_url, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    
    async with async_session() as session:
        try:
            # Count existing records
            if user_id:
                result_count = await session.execute(
                    select(TriageResult).where(TriageResult.user_id == user_id)
                )
                task_count = await session.execute(
                    select(TriageTask).where(TriageTask.user_id == user_id)
                )
                results = result_count.scalars().all()
                tasks = task_count.scalars().all()
            else:
                result_count = await session.execute(select(TriageResult))
                task_count = await session.execute(select(TriageTask))
                results = result_count.scalars().all()
                tasks = task_count.scalars().all()
            
            print(f"Found {len(results)} triage_results records")
            print(f"Found {len(tasks)} triage_tasks records")
            
            if len(results) == 0 and len(tasks) == 0:
                print("No triage data to reset.")
                return
            
            # Confirm deletion
            if user_id:
                print(f"\n⚠️  WARNING: This will delete ALL triage data for user_id={user_id}")
            else:
                print("\n⚠️  WARNING: This will delete ALL triage data for ALL users")
            
            print("This will NOT affect:")
            print("  - users table")
            print("  - user_emails table")
            print("  - oauth_tokens table")
            print("  - thread_cache table")
            print("  - assist_chat_sessions table")
            print("  - drafts table")
            print("  - calendar_proposals table")
            
            # Delete triage_results
            if user_id:
                await session.execute(
                    delete(TriageResult).where(TriageResult.user_id == user_id)
                )
            else:
                await session.execute(delete(TriageResult))
            
            # Delete triage_tasks
            if user_id:
                await session.execute(
                    delete(TriageTask).where(TriageTask.user_id == user_id)
                )
            else:
                await session.execute(delete(TriageTask))
            
            await session.commit()
            
            print(f"\n✅ Successfully deleted {len(results)} triage_results records")
            print(f"✅ Successfully deleted {len(tasks)} triage_tasks records")
            print("\nTriage data has been reset. Other database tables are unaffected.")
            
        except Exception as e:
            await session.rollback()
            print(f"\n❌ Error resetting triage data: {e}")
            import traceback
            traceback.print_exc()
            raise
        finally:
            await engine.dispose()


async def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Reset triage data (triage_results and triage_tasks)')
    parser.add_argument(
        '--user-id',
        type=int,
        default=None,
        help='Optional: Reset only for specific user ID. If not provided, resets for all users.'
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Triage Data Reset Script")
    print("=" * 60)
    print()
    
    await reset_triage_data(user_id=args.user_id)


if __name__ == "__main__":
    asyncio.run(main())
