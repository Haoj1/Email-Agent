# Agents Module

This module will contain LangGraph-based agents for:
- Email triage and summarization
- Thread chat agent
- Draft generation
- Calendar event extraction

## Planned Structure

```
agents/
├── __init__.py
├── triage_agent.py      # Batch email triage agent
├── thread_chat_agent.py # Cursor-style thread chat agent
├── draft_agent.py       # Draft generation agent
├── calendar_agent.py    # Calendar event extraction
└── tools/               # Agent tools
    ├── gmail_tools.py
    ├── calendar_tools.py
    └── datetime_tools.py
```
