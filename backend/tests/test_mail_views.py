import base64
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from app.services.gmail_service import GmailService
from main import app


def thread(identifier, labels):
    return {
        "id": identifier,
        "messages": [{
            "labelIds": labels,
            "snippet": "Winter collection",
            "payload": {"headers": [{"name": "Subject", "value": "Winter collection"}]},
        }],
    }


class MailViewTest(IsolatedAsyncioTestCase):
    async def test_promotions_filter_follows_search_and_pagination(self):
        normal = thread("regular", ["INBOX"])
        promotion = thread("promotion", ["CATEGORY_PROMOTIONS"])
        with patch("app.routes.gmail.get_user_credentials", new=AsyncMock()), \
             patch.object(GmailService, "__init__", return_value=None), \
             patch.object(GmailService, "list_thread_page", side_effect=[
                 ([normal, promotion], "next-page", 2), ([normal], None, 2),
             ]) as listing, \
             patch.object(GmailService, "get_threads", return_value=[normal, promotion]) as candidates:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                path = "/api/gmail/threads"
                hidden = await client.get(path, params={"q": "winter OR summer", "promotions": "hide"})
                self.assertEqual(hidden.status_code, 200)
                self.assertEqual([item["thread_id"] for item in hidden.json()["threads"]], ["regular"])
                next_page = await client.get(path, params={
                    "q": "winter OR summer", "promotions": "hide", "page_token": hidden.json()["next_page_token"],
                })
                self.assertEqual(next_page.status_code, 200)
                self.assertEqual(listing.call_args_list[0].kwargs["query"], "(winter OR summer) -category:promotions")
                self.assertEqual(listing.call_args.kwargs["query"], listing.call_args_list[0].kwargs["query"])
                self.assertEqual(listing.call_args.kwargs["page_token"], "next-page")
                fuzzy = await client.get(path, params={"q": "winter", "mode": "fuzzy", "promotions": "hide"})
                self.assertEqual([item["thread_id"] for item in fuzzy.json()["threads"]], ["regular"])
                self.assertIn("-category:promotions", candidates.call_args.kwargs["query"])

    def test_nested_html_and_plain_body_with_unpadded_base64(self):
        def part(mime, content, **fields):
            return {"mimeType": mime, "body": {
                "data": base64.urlsafe_b64encode(content.encode()).decode().rstrip("="),
            }, **fields}

        payload = {
            "mimeType": "multipart/mixed", "parts": [
                part("text/html", "<p>Attached file</p>", filename="attachment.html"),
                {"mimeType": "multipart/alternative", "parts": [
                    part("text/plain", "会议摘要"),
                    part("text/html", "<table><tr><td>会议摘要</td></tr></table>"),
                ]},
            ],
        }
        text, html = GmailService.extract_body(payload)
        self.assertEqual(text, "会议摘要")
        self.assertIn("<table>", html)
        self.assertIn("会议摘要", html)
