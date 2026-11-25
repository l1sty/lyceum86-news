from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

import bot
from panel import create_panel
from test_game import TOKEN, signed
from valentines import INVITE, NEW_MAIL


class Valentines(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = Path(temp.name) / "news.db"
        with closing(sqlite3.connect(self.db)) as db:
            bot.initialize(db)
        self.app = create_panel(self.db, TOKEN, set(), None, "school_bot")

    def call(self, uid, path="", data=None, status=200):
        url = "/app/api/valentines" + path
        headers = {"X-Telegram-Init-Data": signed(uid)} if uid else {}
        client = self.app.test_client()
        response = client.get(url, headers=headers) if data is None else client.post(url, data=data, headers=headers)
        self.assertEqual(response.status_code, status, response.data)
        return response.get_json()

    def test_anonymous_delivery_retry_and_closed_box(self):
        self.call(None, status=403)
        self.call(None, "/box", {"action":"open"}, 403)
        self.assertIsNone(self.call(12)["code"])
        box = self.call(12, "/box", {"action":"open"})
        letter = dict(code=box["code"], text="Дякую тобі!", nonce=str(uuid4()))
        self.call(12, "/send", letter, 400)
        self.call(None, "/send", letter, 403)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: self.call(23, "/send", letter), range(2)))
        self.assertEqual(self.call(23, "?recipient=12")["items"], [])
        items = self.call(12)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(set(items[0]), {"id","text","created"})
        self.assertEqual(items[0]["text"], letter["text"])
        self.call(12, "/box", {"action":"close"})
        self.assertEqual(self.call(12)["items"], items)
        self.call(23, "/send", dict(letter, nonce=str(uuid4())), 404)
        self.assertNotEqual(self.call(12, "/box", {"action":"open"})["code"], box["code"])
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute("SELECT chat,broadcast FROM deliveries").fetchall(), [(12,NEW_MAIL)])

    def test_telegram_invitation_and_notification(self):
        box = self.call(12, "/box", {"action":"open"})
        self.assertEqual(box["link"], "https://t.me/school_bot?start=val_" + box["code"])
        with closing(sqlite3.connect(self.db)) as db, patch("bot.panel_url",return_value="https://school.example"):
            bot.handle(db, {"message":{"chat":{"id":23,"type":"private"},"text":"/start val_"+box["code"]}}, set())
            chat, body, kind = db.execute("SELECT chat,body,broadcast FROM deliveries").fetchone()
            self.assertEqual((chat,body,kind), (23,box["code"],INVITE))
            for kind, query in ((INVITE,"&to="+box["code"]), (NEW_MAIL,"")):
                api = Mock()
                bot.deliver(db, api, chat, body, kind, None, set())
                button = api.call_args.kwargs["reply_markup"]["inline_keyboard"][0][0]
                self.assertEqual(button["web_app"]["url"], "https://school.example/app/?view=valentines"+query)

    def test_inbox_pagination_and_validation(self):
        box = self.call(1, "/box", {"action":"open"})
        for text in ("  ", "я"*1001):
            self.call(2, "/send", dict(code=box["code"],text=text,nonce=str(uuid4())), 400)
        for index in range(21):
            self.call(2, "/send", dict(code=box["code"],text=str(index),nonce=str(uuid4())))
        first = self.call(1)
        self.assertTrue(first["more"])
        self.assertEqual(len(first["items"]),20)
        tail = self.call(1, "?before="+str(first["items"][-1]["id"]))
        self.assertFalse(tail["more"])
        self.assertEqual([i["text"] for i in tail["items"]], ["0"])
