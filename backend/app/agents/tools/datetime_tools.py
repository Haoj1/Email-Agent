"""
DateTime Tools for Thread Chat Agent
Provides time and date related utilities
"""
from typing import Optional, Dict, Any
from langchain_core.tools import tool
from datetime import datetime, timezone, timedelta


@tool
def get_current_time_tool(timezone_offset: Optional[int] = None) -> Dict[str, Any]:
    """
    Get current date and time.
    Useful for calculating deadlines, "this week", "7 days ago", etc.
    
    Args:
        timezone_offset: UTC offset in hours (e.g., -5 for EST, +8 for CST)
                         If not provided, uses UTC
    
    Returns:
        Dictionary with current time in ISO format and human-readable format
    """
    try:
        if timezone_offset is not None:
            tz = timezone(timedelta(hours=timezone_offset))
            now = datetime.now(tz)
        else:
            now = datetime.now(timezone.utc)
            tz = timezone.utc
        
        return {
            "success": True,
            "iso": now.isoformat(),
            "readable": now.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": "UTC" if timezone_offset is None else f"UTC{timezone_offset:+d}",
            "year": now.year,
            "month": now.month,
            "day": now.day,
            "weekday": now.strftime("%A"),
            "hour": now.hour,
            "minute": now.minute
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Error getting time: {str(e)}"
        }
