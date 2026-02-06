from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from app.config import settings
from app.routes import auth, health, emails, gmail, triage, thread_chat, assist_chat, calendar

app = FastAPI(
    title="Email Agent API",
    description="Multi-User AI Email Agent Backend",
    version="1.0.0"
)

# CORS middleware
cors_origins = [origin.strip() for origin in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(emails.router, prefix="/api", tags=["emails"])
app.include_router(gmail.router, prefix="/api", tags=["gmail"])
app.include_router(triage.router, prefix="/api", tags=["triage"])
app.include_router(thread_chat.router, prefix="/api", tags=["thread-chat"])
app.include_router(assist_chat.router, prefix="/api", tags=["assist-chat"])
app.include_router(calendar.router, prefix="/api", tags=["calendar"])

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)}
    )

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG
    )
