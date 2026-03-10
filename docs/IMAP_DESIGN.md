## IMAP Integration Design

This document describes the requirements and high-level design for adding IMAP-based email accounts to the Email Agent app, alongside the existing Gmail API integration. It is **design-only** and does not change current behavior; existing Gmail users should continue to work without any migration issues.

---

### 1. Goals

- **Primary goal**: Allow users to connect non-Gmail email accounts (corporate / self-hosted / other providers) via IMAP so that:
  - Priority Inbox (triage) can analyze their emails.
  - Inbox Copilot (RAG search) can use these emails as part of the knowledge base.
- **Scope for first phase**:
  - **Read-only IMAP**:
    - Fetch and normalize recent conversations.
    - No sending, drafting, or modifying messages/labels.
  - **Keep existing Gmail behavior unchanged**:
    - Gmail still uses the Gmail API and OAuth, as today.

---

### 2. User-Facing Requirements

#### 2.1 What the user needs to provide for IMAP

For a non-Gmail account, the user will provide:

- **Email address**: e.g. `alice@company.com`
- **IMAP server** (host), e.g.:
  - `imap.company.com`
  - `imap.qq.com`
  - `outlook.office365.com`
- **Port**:
  - Typically `993` (IMAP over SSL/TLS)
  - Optionally `143` (IMAP with StartTLS), but we can default to 993.
- **Security mode**:
  - SSL/TLS (recommended)
  - StartTLS (optional)
- **Username**:
  - Often equal to the email address; make this default.
- **Password / App password**:
  - For most IMAP providers this is either:
    - The mailbox password, or
    - An app-specific password / IMAP authorization code (recommended for security).

Optional (future):

- Display name for future send/draft features.
- Folder selection (e.g. only `INBOX` vs. additional folders).

#### 2.2 UX summary

- In `Email Accounts` card:
  - Add a button such as **"+ Add IMAP Account"**.
  - Opens a small modal or side panel with the fields above.
- On submit:
  - Backend attempts a test IMAP login.
  - If successful, credentials/config are stored and the account appears in the account list.
  - If login fails, show a clear error and allow the user to correct the fields.

---

### 3. Data Model Changes (Backward Compatible)

The current `UserEmail` model is Gmail-focused but can be extended in a backward-compatible way.

#### 3.1 New fields on `UserEmail`

Add **nullable** fields to `UserEmail` (no existing rows are modified or removed):

- `provider: str`  
  - `"gmail"` (default/implicit for existing rows)  
  - `"imap"` (for new IMAP accounts)  
  - Future: `"outlook"`, `"exchange"`, etc.
- `imap_host: str | None`
- `imap_port: int | None` (e.g. 993)
- `imap_use_ssl: bool | None` (True for SSL/TLS, False for plain/StartTLS)
- `imap_username: str | None`
- `imap_password_encrypted: str | None`

Notes:

- Existing Gmail rows can keep `provider` as `NULL` and be interpreted as `"gmail"` in code; or a one-time migration can set `provider='gmail'`.
- No changes are required to `TriageResult` or `EmailEmbedding`:
  - They already store `user_id`, `email`, and `thread_id`.
  - IMAP-based threads will just use a different `thread_id` scheme.

#### 3.2 Security considerations

- `imap_password_encrypted` **must not** store the plaintext password.
- Use symmetric encryption with a server-side key (e.g. from environment variables).
- Never log passwords or decrypted values.

---

### 4. Service Layer Design

Introduce a common abstraction for email access and implement separate providers for Gmail API and IMAP.

#### 4.1 Common interface (conceptual)

```python
class BaseMailService:
    def get_threads(self, max_results: int = 30, days: int = 7) -> list[dict]:
        \"\"\"Return a list of raw thread-like objects from the mailbox.\"\"\"

    def get_thread_full(self, thread_id: str) -> dict:
        \"\"\"Return a full thread (all messages) by thread identifier.\"\"\"

    def normalize_thread(self, thread_data: dict) -> dict:
        \"\"\"Normalize raw thread data into the internal Thread schema:
        {
          'thread_id': str,
          'subject': str,
          'participants': { 'from': str, 'to': list[str], 'cc': list[str], 'bcc': list[str] },
          'messages': [ ... ],
          'latest_message_date': str (ISO),
          'message_count': int,
          'is_unread': bool,
          'labels': list[str]  # optional / provider-specific
        }
        \"\"\"
```

Current `GmailService` effectively already implements this shape; the goal is to make its public methods match `BaseMailService` so other providers can be slotted in.

#### 4.2 New `ImapService`

File: `backend/app/services/imap_service.py`

Responsibilities:

- Manage IMAP connection and authentication.
- Fetch recent messages from `INBOX` (for now).
- Group messages into “threads” and normalize them.

Key points:

- Use `imaplib` or `imapclient`:
  - Connect with SSL/TLS to `imap_host:imap_port`.
  - Authenticate with `imap_username` and decrypted password.
  - `SELECT INBOX`, `SEARCH` with a date filter (`SINCE` N days ago).
  - `FETCH` `RFC822` for matching message IDs, parse via `email` stdlib.
- Threading strategy (IMAP does not have Gmail-style thread IDs):
  - Simplest: treat each message as its own “thread” using its `Message-ID`.
  - Better: group by `Message-ID` / `In-Reply-To` / `References` into conversations, and assign a synthetic `thread_id`:
    - e.g. `sha1(conversation_root_message_id)` or just the root `Message-ID`.
- `normalize_thread`:
  - Construct the same shape as `GmailService.normalize_thread`, so triage and RAG don’t need to know the provider.

#### 4.3 Provider factory

File: `backend/app/services/mail_provider.py` (new)

```python
from app.services.gmail_service import GmailService
from app.services.imap_service import ImapService
from app.models import UserEmail, OAuthToken

def get_mail_service(user_email: UserEmail, db_session: AsyncSession) -> BaseMailService:
    if not user_email.provider or user_email.provider == \"gmail\":
        # Existing behavior: use Gmail API credentials (OAuthToken)
        creds = build_google_credentials_for_user_email(user_email, db_session)
        return GmailService(creds)
    elif user_email.provider == \"imap\":
        # Use IMAP configuration from UserEmail
        cfg = get_imap_config(user_email)
        return ImapService(
            host=cfg.host,
            port=cfg.port or 993,
            username=cfg.username or user_email.email,
            password=decrypt(cfg.password_encrypted),
            use_ssl=cfg.use_ssl is not False,
        )
    else:
        raise ValueError(f\"Unsupported email provider: {user_email.provider}\")
```

The rest of the application (triage, background embedding, threads API) calls `get_mail_service(...)` instead of directly constructing `GmailService`.

---

### 5. Integration Points

#### 5.1 Triage (`backend/app/routes/triage.py`)

Current behavior:

- Uses `GmailService` directly with credentials from `get_user_credentials(...)`.

Planned change:

- Resolve the relevant `UserEmail` record for the requested `email`.
- Pass that `UserEmail` into `get_mail_service(...)` to get a `BaseMailService` instance.
- Replace direct `GmailService` calls:
  - `gmail_service.get_threads(...)` → `mail_service.get_threads(...)`
  - `gmail_service.normalize_thread(...)` → `mail_service.normalize_thread(...)`
- All downstream logic (smart filtering, saving `TriageResult`) should remain unchanged because it operates on normalized threads.

#### 5.2 Background embedding (`background_tasks.sync_and_embed_emails`)

Current behavior:

- Builds `Credentials` manually and constructs `GmailService`.

Planned change:

- Resolve `UserEmail` (either primary or the specific email).
- Use `get_mail_service(user_email, db)` to get the appropriate provider (Gmail or IMAP).
- Use `mail_service.get_thread_full(...)` + `normalize_thread(...)` to extract messages for embeddings.

#### 5.3 Conversations API (`backend/app/routes/gmail.py`)

Current behavior:

- `/gmail/threads` uses the Gmail REST API directly.

Options:

1. **Short term**: Keep `/gmail/threads` for Gmail only, and add a new route `/mail/threads` that uses the generic `BaseMailService`.
2. **Better long term**: Migrate `/gmail/threads` to `/mail/threads` and:
   - Internally resolve the `UserEmail` and select the provider via `get_mail_service(...)`.
   - Keep the JSON response compatible so the frontend doesn’t change.

For the first IMAP iteration, we can focus on triage and embedding, and later unify the Conversations API.

---

### 6. Frontend Impact

Initial IMAP support can be added with **minimal frontend changes**:

- `EmailAccountsCard`:
  - Add a new action: `+ Add IMAP Account`, opening a form to collect IMAP details.
  - Call a new backend endpoint, e.g. `POST /api/email-accounts/imap`, which:
    - Validates IMAP connection.
    - Creates a `UserEmail` row with `provider='imap'` and configuration.
- `Dashboard`, `Priority Inbox`, `Conversations`, `Inbox Copilot`:
  - Continue to send `selectedEmail` as they do today.
  - Backend uses `UserEmail.provider` to decide whether to use Gmail API or IMAP.  
  - No UI changes are required for displaying threads/triage results, because the normalized shape remains the same.

---

### 7. Migration & Backward Compatibility

- Database migration:
  - Only `ALTER TABLE user_emails ADD COLUMN ...` operations.
  - Existing Gmail data remains valid; no rows are modified or removed.
- Code compatibility:
  - For `provider IS NULL` or `provider == 'gmail'`, behavior is identical to current Gmail-only implementation.
  - IMAP support is opt-in: only new accounts with `provider='imap'` use `ImapService`.
- Rollback:
  - If needed, disable IMAP by:
    - Hiding **Add IMAP Account** in UI.
    - Rejecting `provider='imap'` in the provider factory.
  - Gmail users continue to work as before.

---

### 8. Future Extensions (Out of Scope for First Iteration)

- **SMTP / sending emails** for IMAP accounts:
  - Implement `SmtpService` for sending drafts and replies.
  - Add SMTP configuration fields alongside IMAP in `UserEmail`.
- **Provider-specific optimizations**:
  - Use Microsoft Graph for Outlook/Office365 instead of raw IMAP.
  - Per-provider search capabilities.
- **Folder selection & more advanced filtering**.

For now, the focus is **read-only IMAP integration** for triage and RAG, without changing the user experience for existing Gmail users.

