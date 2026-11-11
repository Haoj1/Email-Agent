"""Exercise the email workflow against a disposable PostgreSQL database and fake Gmail."""
import base64
from datetime import datetime, timedelta, timezone
import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx
from httplib2 import Response
from googleapiclient.errors import HttpError
from sqlalchemy import func, select, text, update

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.models import EmailEmbedding, FollowUp, LoginSession, MailboxSyncState, OAuthToken, User, UserEmail
from app.routes.auth import session_digest
from app.services.background_tasks import index_pending
from app.services.embedding_service import EmbeddingService
from app.services.gmail_service import GmailService
from app.services.mailbox_sync import sync_mailbox
from app.services.rag_service import RAGSearchService
from main import app
from migrate import migrate

PRIMARY = "one@example.test"
SECONDARY = "two@example.test"
OTHER = "someone-else@example.test"
THREAD = "sample-thread"
SECRET = "fixture-session-cookie"
VECTOR = [1.0] + [0.0] * 383


def message(id, ms, address, content, labels=None):
    return {
        "id": id, "internalDate": str(ms), "labelIds": labels or ["INBOX"], "snippet": content,
        "payload": {
            "headers": [{"name": "From", "value": address}, {"name": "Subject", "value": "Sample order"}],
            "mimeType": "text/plain", "body": {"data": base64.urlsafe_b64encode(content.encode()).decode()},
        },
    }


class WorkflowTest(IsolatedAsyncioTestCase):
    async def test_follow_up_incremental_sync_and_private_search(self):
        await migrate()
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            owner = User(primary_email=PRIMARY)
            other = User(primary_email=OTHER)
            db.add_all([owner, other])
            await db.flush()
            first = UserEmail(user_id=owner.id, email=PRIMARY, is_primary=True)
            second = UserEmail(user_id=owner.id, email=SECONDARY)
            outside = UserEmail(user_id=other.id, email=OTHER, is_primary=True)
            db.add_all([first, second, outside])
            await db.flush()
            for account in (first, second, outside):
                db.add(OAuthToken(user_id=account.user_id, user_email_id=account.id, access_token=account.email))
            await db.commit()
            db.expunge_all()

        # Emulate the previous schema and prove the additive migration preserves its rows.
        async with engine.begin() as connection:
            await connection.execute(text("DROP TABLE login_sessions, follow_ups, mailbox_sync_state, mailbox_thread_index"))
            await connection.execute(text("ALTER TABLE email_embeddings DROP COLUMN user_email_id"))
            await connection.execute(text("ALTER TABLE triage_results DROP COLUMN ai_reviewed, DROP COLUMN ai_reviewed_through_ms"))
            await connection.execute(text("ALTER TABLE users DROP COLUMN ai_review_mode, DROP COLUMN ai_review_since"))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/api/ready")).status_code, 503)
            await migrate()
            await migrate()
            self.assertEqual((await client.get("/api/ready")).status_code, 200)
            async with AsyncSessionLocal() as db:
                self.assertEqual(await db.scalar(select(func.count()).select_from(UserEmail)), 3)
                db.add_all([
                    LoginSession(token_hash=session_digest(SECRET), user_id=first.user_id, email=PRIMARY,
                                 expires_at=now + timedelta(days=1)),
                    LoginSession(token_hash=session_digest("next-session"), user_id=first.user_id, email=PRIMARY,
                                 expires_at=now + timedelta(days=1)),
                    LoginSession(token_hash=session_digest("other-session"), user_id=outside.user_id, email=OTHER,
                                 expires_at=now + timedelta(days=1)),
                    LoginSession(token_hash=session_digest("expired"), user_id=first.user_id, email=PRIMARY,
                                 expires_at=now - timedelta(seconds=1)),
                ])
                await db.commit()

            client.cookies.set("session_id", "expired")
            self.assertEqual((await client.get("/api/auth/me")).status_code, 401)
            self.assertEqual((await client.patch("/api/auth/preferences",
                                                json={"ai_review_mode": "unclear"})).status_code, 401)
            client.cookies.set("session_id", SECRET)
            profile = (await client.get("/api/auth/me")).json()
            self.assertEqual(profile["primary_email"], PRIMARY)
            self.assertEqual(profile["ai_review_mode"], "off")
            self.assertEqual((await client.get("/api/follow-ups", params={"email": OTHER})).status_code, 404)
            self.assertEqual((await client.put("/api/follow-ups/" + THREAD, params={"email": OTHER},
                                               json={"status": "waiting"})).status_code, 404)

            senders = {PRIMARY: "shop@example.test", SECONDARY: "separate@example.test"}
            threads = {mailbox: {"id": THREAD, "messages": [message("old", 100, address, "Initial order and estimate")]}
                       for mailbox, address in senders.items()}
            history = {mailbox: {"historyId": "101"} for mailbox in senders}
            calls = []

            def initialize(service, credentials):
                service.mailbox = credentials.token

            def get_thread(service, thread_id):
                if thread_id != THREAD or threads[service.mailbox] is None:
                    raise HttpError(Response({"status": "404"}), b"{}")
                return threads[service.mailbox]

            def recent(service, *args, **kwargs):
                calls.append(("bootstrap", service.mailbox, kwargs.get("page_token")))
                raw = threads[service.mailbox]
                return ([raw] if raw else []), None

            def incremental(service, start, page_token):
                calls.append(("history", service.mailbox, start, page_token))
                page = history[service.mailbox]
                if page is None:
                    raise HttpError(Response({"status": "404"}), b"{}")
                return page

            def batch(service, ids):
                raw = threads[service.mailbox]
                return [raw] if THREAD in ids and raw else []

            async def tick(account):
                async with AsyncSessionLocal() as db:
                    await db.execute(update(MailboxSyncState).where(MailboxSyncState.user_email_id == account.id)
                                     .values(next_check_at=now))
                    await db.commit()
                    self.assertTrue(await sync_mailbox(db, account))

            async def edit(status, email=PRIMARY, due=None):
                response = await client.put("/api/follow-ups/" + THREAD, params={"email": email},
                                            json={"status": status, "due_at": due})
                self.assertEqual(response.status_code, 200, response.text)
                return response.json()["item"]

            async def read(email=PRIMARY):
                result = await client.get("/api/follow-ups/" + THREAD, params={"email": email})
                self.assertEqual(result.status_code, 200)
                return result.json()["item"]

            with (
                patch.object(settings, "MAILBOX_EMBEDDINGS_ENABLED", True),
                patch.object(GmailService, "__init__", initialize),
                patch.object(GmailService, "get_thread_metadata", get_thread),
                patch.object(GmailService, "get_thread_full", get_thread),
                patch.object(GmailService, "get_thread_page", recent),
                patch.object(GmailService, "get_history_id", return_value="100"),
                patch.object(GmailService, "get_history_page", incremental),
                patch.object(GmailService, "get_metadata_batch", batch),
                patch.object(EmbeddingService, "get_embeddings", side_effect=lambda entries: [VECTOR for _ in entries]),
                patch.object(EmbeddingService, "get_embedding", return_value=VECTOR),
            ):
                due = now + timedelta(hours=1)
                self.assertIsNone(await read())
                self.assertEqual((await edit("waiting", due=due.isoformat()))["status"], "waiting")
                await edit("later", SECONDARY)
                await tick(first)
                await tick(second)
                self.assertEqual((await read())["status"], "waiting")
                async with AsyncSessionLocal() as db:
                    await index_pending(db, first.id, first.user_id)
                    await index_pending(db, second.id, second.user_id)
                    self.assertEqual(await db.scalar(select(func.count()).select_from(FollowUp)), 2)
                    search = RAGSearchService()
                    self.assertEqual({row["email"] for row in await search.search_emails(first.user_id, "order", db=db)},
                                     {PRIMARY, SECONDARY})
                    self.assertEqual({row["email"] for row in await search.search_emails(first.user_id, "order", db=db,
                                                                                       email=SECONDARY)}, {SECONDARY})
                    self.assertEqual(await search.search_emails(outside.user_id, "order", db=db, email=PRIMARY), [])

                change = {"messagesAdded": [{"message": {"threadId": THREAD}}]}
                history[PRIMARY] = {"history": [change, change], "historyId": "102", "nextPageToken": "next"}
                threads[PRIMARY]["messages"].extend([
                    message("sent", 200, PRIMARY, "Our sent reply", ["SENT"]),
                    message("draft", 300, senders[PRIMARY], "Unsaved draft", ["DRAFT"]),
                ])
                await tick(first)
                self.assertEqual((await read())["status"], "waiting")
                history[PRIMARY] = {"history": [change], "historyId": "103"}
                threads[PRIMARY]["messages"].append(message("new", 400, senders[PRIMARY], "New received response"))
                await tick(first)
                self.assertIn(("history", PRIMARY, "100", "next"), calls)
                reopened = await read()
                self.assertEqual(reopened["status"], "reply")
                self.assertTrue(reopened["reopened_at"])
                self.assertEqual(datetime.fromisoformat(reopened["due_at"]), due)
                self.assertEqual((await read(SECONDARY))["status"], "later")
                async with AsyncSessionLocal() as db:
                    await index_pending(db, first.id, first.user_id)
                    hits = await search.search_emails(first.user_id, "response", db=db, email=PRIMARY)
                    self.assertTrue(any("New received response" in row["content"] for row in hits))
                    self.assertFalse(any("Unsaved draft" in row["content"] for row in hits))

                await edit("waiting", due=due.isoformat())
                await tick(first)
                self.assertEqual((await read())["status"], "waiting")
                await edit("done")
                result = await client.get("/api/follow-ups", params={"email": PRIMARY})
                self.assertEqual(result.json()["items"], [])
                result = await client.get("/api/follow-ups", params={"email": PRIMARY, "status": "done"})
                self.assertEqual(len(result.json()["items"]), 1)
                self.assertEqual((await client.put("/api/follow-ups/" + THREAD, params={"email": PRIMARY},
                                                   json={"status": "later", "due_at": "2026-11-12T10:30"})).status_code, 422)

                await edit("waiting", due=due.isoformat())
                threads[PRIMARY]["messages"].append(message("browser-reply", 500, senders[PRIMARY],
                                                            "Reply also seen by the browser fallback"))
                response = await client.post("/api/triage/run", json={
                    "automatic": True, "review_unclear": True, "email": PRIMARY,
                })
                events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines()
                          if line.startswith("data: ")]
                self.assertEqual(events[-1]["follow_ups_reopened"], 1, events)
                self.assertEqual(events[-1]["ai_calls"], 0)
                self.assertEqual((await read())["status"], "reply")

                async def scan():
                    response = await client.post("/api/triage/run", json={"automatic": True, "email": PRIMARY})
                    events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines()
                              if line.startswith("data: ")]
                    self.assertTrue(events[-1]["success"], events)
                    return events[-1]

                async def set_mode(mode):
                    response = await client.patch("/api/auth/preferences", json={"ai_review_mode": mode})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["ai_review_mode"], mode)
                    async with AsyncSessionLocal() as db:
                        since = (await db.get(User, first.user_id)).ai_review_since
                    return int(since.timestamp() * 1000) if since else None

                invalid = await client.patch("/api/auth/preferences", json={"ai_review_mode": "everything"})
                self.assertEqual(invalid.status_code, 422)
                since = await set_mode("unclear")
                self.assertEqual(await set_mode("unclear"), since)
                await client.post("/api/auth/logout")
                client.cookies.set("session_id", "next-session")
                self.assertEqual((await client.get("/api/auth/me")).json()["ai_review_mode"], "unclear")
                client.cookies.set("session_id", "other-session")
                self.assertEqual((await client.get("/api/auth/me")).json()["ai_review_mode"], "off")
                client.cookies.set("session_id", "next-session")

                def review_result(items, *, bodies=None):
                    return {item["thread_id"]: {
                        "label": "NEEDS_REPLY" if bodies or item["thread_id"] == "new-primary" else "REVIEW",
                        "priority": 0.8 if bodies else 0.45,
                        "summary": "Based on body" if bodies else "Based on preview",
                        "key_points": [],
                    } for item in items}

                with (
                    patch("app.agents.batch_triage.review_batch", side_effect=review_result) as review,
                    patch.object(GmailService, "get_message_text", return_value="Additional context") as body,
                ):
                    self.assertEqual((await scan())["ai_calls"], 0)  # Mail from before opt-in.
                    threads[PRIMARY]["messages"].append(message("new-unclear", since + 1, senders[PRIMARY],
                                                                "An ambiguous message"))
                    self.assertEqual((await scan())["ai_reviewed"], 1)
                    self.assertEqual((await scan())["ai_calls"], 0)
                    review.assert_called_once()
                    body.assert_not_called()

                    since = await set_mode("primary_important")
                    threads[PRIMARY]["messages"].extend([
                        message("new-primary", since + 2, senders[PRIMARY], "Please reply",
                                ["INBOX", "CATEGORY_PERSONAL"]),
                        message("new-important", since + 3, senders[PRIMARY], "Schedule update",
                                ["IMPORTANT", "CATEGORY_UPDATES"]),
                        message("promotion", since + 4, senders[PRIMARY], "Sale", ["INBOX", "CATEGORY_PROMOTIONS"]),
                        message("outgoing", since + 5, PRIMARY, "Thanks", ["SENT", "IMPORTANT"]),
                    ])
                    await tick(first)  # The sync worker can write rule results before AI runs.
                    result = await scan()
                    self.assertEqual((result["ai_calls"], result["ai_reviewed"]), (2, 2))
                    self.assertEqual(result["results"][0]["summary"], "Based on body")
                    self.assertEqual({item["thread_id"] for item in review.call_args_list[1].args[0]},
                                     {"new-primary", "new-important"})
                    self.assertEqual(review.call_args.kwargs["bodies"], {"new-important": "Additional context"})
                    body.assert_called_once_with("new-important")
                    self.assertEqual((await scan())["ai_calls"], 0)

                    self.assertIsNone(await set_mode("off"))
                    threads[PRIMARY]["messages"].append(message("off-primary", since + 6, senders[PRIMARY], "New email"))
                    self.assertEqual((await scan())["ai_calls"], 0)
                    self.assertEqual((await client.get("/api/auth/me")).json()["ai_review_mode"], "off")

                history[PRIMARY] = None
                await tick(first)
                await tick(first)
                async with AsyncSessionLocal() as db:
                    self.assertEqual((await db.get(MailboxSyncState, first.id)).history_id, "100")
                    self.assertTrue(await db.scalar(select(func.count()).select_from(EmailEmbedding)))

            async def search_public(query):
                self.assertEqual(query, "public launch dates")
                return {"success": True, "results": [{"title": "Launch", "link": "https://example.test", "snippet": "Date"}]}

            with patch("app.agents.tools.assist_chat_tools.execute_web_search", new=AsyncMock(side_effect=search_public)):
                response = await client.post("/api/assist-chat/ask", json={
                    "question": "/web public launch dates",
                    "conversation_history": [{"role": "assistant", "content": "Private mailbox context"}],
                })
                events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines()
                          if line.startswith("data: ")]
                self.assertEqual(events[-1]["type"], "result", events)
                self.assertTrue(events[-1]["used_web_search"])
            self.assertEqual((await client.delete(f"/api/emails/{outside.id}")).status_code, 404)
            disconnected = await client.delete(f"/api/emails/{second.id}")
            self.assertEqual(disconnected.status_code, 200)
            self.assertEqual([account["email"] for account in disconnected.json()["emails"]], [PRIMARY])
            self.assertEqual((await client.delete(f"/api/emails/{first.id}")).status_code, 400)
            async with AsyncSessionLocal() as db:
                self.assertIsNone(await db.get(UserEmail, second.id))
                self.assertEqual(await db.scalar(select(func.count()).select_from(OAuthToken)
                                                 .where(OAuthToken.user_email_id == second.id)), 0)
            self.assertEqual((await client.post("/api/auth/logout")).status_code, 200)
            client.cookies.set("session_id", "next-session")
            self.assertEqual((await client.get("/api/auth/me")).status_code, 401)
        await engine.dispose()
