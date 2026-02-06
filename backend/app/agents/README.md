# Agents Module

This directory contains the agent implementations used by the app:

## Implemented Agents

- **`triage_agent.py`**: batch triage + prioritization for Priority Inbox
- **`thread_chat_agent.py`**: per-thread assistant (Thread Chat) used on the thread detail page
- **`assist_chat_agent.py`**: global assistant (Inbox Copilot) with tools + RAG

## Tools

Located in `tools/`:
- `gmail_tools.py`: Gmail thread retrieval, related-thread search, draft generation
- `assist_chat_tools.py`: triage queries + RAG search + “important emails” convenience tool + multi-account Gmail tools
- `datetime_tools.py`: current time tool for scheduling/deadline reasoning

## Notes

- Agents stream “thinking steps” and results to the frontend using SSE endpoints in `backend/app/routes/`.
