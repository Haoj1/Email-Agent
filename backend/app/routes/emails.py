"""
Email management routes - support multiple emails per user
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, update
from sqlalchemy.orm import selectinload
from typing import List
from pydantic import BaseModel
from app.database import get_db
from app.models import TriageResult, User, UserEmail
from app.routes.auth import get_current_user_id
from datetime import datetime

router = APIRouter()


# Pydantic models for request/response
class EmailResponse(BaseModel):
    id: int
    email: str
    is_primary: bool
    verified: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class EmailListResponse(BaseModel):
    emails: List[EmailResponse]
    primary_email: str | None


@router.get("/emails", response_model=EmailListResponse)
async def list_user_emails(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """List all emails for the current user"""
    # Get user with emails
    result = await db.execute(
        select(User)
        .options(selectinload(User.emails))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get primary email
    primary_email_obj = next((e for e in user.emails if e.is_primary), None)
    primary_email = primary_email_obj.email if primary_email_obj else None
    
    return EmailListResponse(
        emails=[EmailResponse.model_validate(e) for e in user.emails],
        primary_email=primary_email
    )


@router.post("/emails/add")
async def initiate_add_email(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Initiate OAuth flow to add a new email.
    Returns OAuth URL for the user to authorize.
    """
    # Verify user exists
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Return OAuth URL that includes action and user_id
    # Frontend should redirect user to this URL
    from app.config import settings
    oauth_url = f"{settings.FRONTEND_URL}/api/auth/google/login?action=add_email&user_id={user_id}"
    
    return {
        "message": "Redirect user to OAuth URL to add email",
        "oauth_url": oauth_url,
        "oauth_url_endpoint": f"/api/auth/google/login?action=add_email&user_id={user_id}"
    }


@router.put("/emails/{email_id}/set-primary")
async def set_primary_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Set an email as the primary email for the user"""
    # Get the email
    result = await db.execute(
        select(UserEmail)
        .where(UserEmail.id == email_id, UserEmail.user_id == user_id)
    )
    email = result.scalar_one_or_none()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Unset all other primary emails for this user
    await db.execute(
        update(UserEmail)
        .where(UserEmail.user_id == user_id)
        .values(is_primary=False)
    )
    
    # Set this email as primary
    email.is_primary = True
    email.updated_at = datetime.utcnow()
    
    # Update user's primary_email field
    user = await db.get(User, user_id)
    if user:
        user.primary_email = email.email
    
    await db.commit()
    await db.refresh(email)
    
    return EmailResponse.model_validate(email)


@router.delete("/emails/{email_id}")
async def delete_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Delete an email account (and its associated OAuth token)"""
    user = await db.get(User, user_id, with_for_update=True)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    # Get the email
    result = await db.execute(
        select(UserEmail)
        .where(UserEmail.id == email_id, UserEmail.user_id == user_id)
    )
    email = result.scalar_one_or_none()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Check if it's the only email
    result = await db.execute(
        select(UserEmail)
        .where(UserEmail.user_id == user_id)
    )
    all_emails = result.scalars().all()
    
    if len(all_emails) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last email account. Please add another email first."
        )
    
    remaining = [account for account in all_emails if account.id != email_id]
    if email.is_primary:
        remaining[0].is_primary = True
        user.primary_email = remaining[0].email
    
    # Delete the email (CASCADE will delete associated OAuth token)
    await db.execute(delete(TriageResult).where(
        TriageResult.user_id == user_id, TriageResult.email == email.email
    ))
    await db.delete(email)
    await db.commit()
    
    return {"message": "Email deleted successfully", "primary_email": user.primary_email,
            "emails": [EmailResponse.model_validate(account) for account in remaining]}


@router.get("/emails/{email_id}")
async def get_email(
    email_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Get details of a specific email"""
    result = await db.execute(
        select(UserEmail)
        .where(UserEmail.id == email_id, UserEmail.user_id == user_id)
    )
    email = result.scalar_one_or_none()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    return EmailResponse.model_validate(email)
