from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode

from game import rules
from game.web import tick
import bot
from panel import create_panel

TOKEN = "local-test"


def signed(uid):
    fields = dict(auth_date=str(int(time.time())), user=json.dumps({"id": uid, "first_name": f"Учень {uid}"}))
    secret = hmac.digest(b"WebAppData", TOKEN.encode(), "sha256")
    content = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    fields["hash"] = hmac.new(secret, content.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class Multiplayer(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "school.sqlite"
        self.app = create_panel(self.path, TOKEN, set(range(1, 8)), None)

    def call(self, uid, route, data=None, status=200):
        client = self.app.test_client()
        headers = {"X-Telegram-Init-Data": signed(uid)}
        path = "/game/api/" + route
        resp = client.get(path, headers=headers) if data is None else client.post(path, json=data, headers=headers)
        self.assertEqual(resp.status_code, status, resp.data)
        return resp.get_json()

    def create(self, private=False, n=2):
        s = self.call(1, "rooms", dict(action="create", mode="quick", private=private))
        self.route = "rooms/" + s["code"]
        for i in range(2, n+1):
            s = self.call(i, "rooms", dict(action="join", code=s["code"]))
        self.s = s

    def act(self, uid, action, **fields):
        self.s = self.call(uid, self.route, dict(version=self.s["version"], action=action, **fields))

    def test_bot_launch_and_scoped_session(self):
        with closing(sqlite3.connect(self.path)) as db, patch("bot.panel_url",return_value="https://school.example"):
            bot.initialize(db)
            bot.handle(db, {"message":{"chat":{"type":"private","id":1},"from":{"id":1},"text":"/game"}}, {1})
            chat,body,kind,photo = db.execute("SELECT chat,body,broadcast,photo FROM deliveries").fetchone()
            api = Mock()
            bot.deliver(db,api,chat,body,kind,photo,{1})
            markup = api.call_args.kwargs["reply_markup"]
            self.assertEqual(markup["inline_keyboard"][0][0]["web_app"]["url"], "https://school.example/game/")
        client = self.app.test_client(use_cookies=False)
        response = client.get("/game/api/lobby",headers={"X-Telegram-Init-Data":signed(1)})
        headers = {"X-Game-Session":response.headers["X-Game-Session"]}
        self.assertEqual(client.get("/game/api/lobby",headers=headers).json["me"],"1")
        self.assertEqual(client.get("/api/editor",headers=headers).status_code,403)

    def test_admin_only_game(self):
        self.call(8, "lobby", status=403)
        self.call(8, "rooms", dict(action="create", private=False, mode="quick"), 403)
        ticket = self.app.test_client().get("/game/api/lobby", headers={"X-Telegram-Init-Data":signed(1)}).headers["X-Game-Session"]
        revoked = create_panel(self.path, TOKEN, {2}, None).test_client()
        self.assertEqual(revoked.get("/game/api/lobby", headers={"X-Game-Session":ticket}).status_code, 403)

    def test_private_capacity_auth_and_restart(self):
        self.create(True, 6)
        self.assertFalse(self.call(7, "lobby")["rooms"])
        self.call(7, self.route, status=404)
        self.call(7, "rooms", dict(action="join", code=self.s["code"]), 409)
        self.call(2, self.route, dict(action="start", version=self.s["version"]), 409)
        client = self.app.test_client()
        self.assertEqual(client.get("/api/editor", headers={"X-Telegram-Init-Data":signed(8)}).status_code,403)
        self.assertEqual(client.get("/game/api/lobby", headers={"X-Telegram-Init-Data":signed(1)+"ff"}).status_code,403)
        self.act(1, "start")
        self.act(6, "chat", text="Вітаю!")
        self.app = create_panel(self.path, TOKEN, set(range(1, 8)), None)
        self.assertEqual(self.call(6, "lobby")["current"], self.s["code"])
        self.assertEqual(self.call(6, self.route)["chat"][-1]["text"], "Вітаю!")

    def test_simultaneous_roll_and_economy(self):
        self.create()
        self.assertEqual(len(self.call(3,"lobby")["rooms"]), 1)
        self.act(1,"start")
        def attempt(_):
            client = self.app.test_client()
            return client.post("/game/api/"+self.route, json=dict(action="roll", version=self.s["version"]),
                               headers={"X-Telegram-Init-Data":signed(1)}).status_code
        with patch("game.rules.secrets.randbelow", return_value=0), ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(attempt,range(2))), [200,409])
        self.s = self.call(1,self.route)
        self.act(1,"buy")
        with patch("game.rules.secrets.randbelow",return_value=0):
            self.act(2,"roll")
        self.assertEqual(self.s["players"][1]["cash"],876)
        self.act(1,"upgrade",tile=2)
        self.act(1,"offer",tile=2,to="2",amount=250)
        self.act(2,"accept")
        self.assertEqual(self.s["deeds"]["2"],dict(level=1,owner="2"))
        with patch("game.rules.secrets.randbelow",return_value=0):
            self.act(1,"roll")
        self.act(1,"pass")
        self.call(2,self.route,dict(action="bid",version=self.s["version"],amount=999999),409)
        self.act(2,"bid",amount=150)
        with patch("game.web.time.time",return_value=self.s["deadline"]+1):
            tick(self.path)
        self.s = self.call(2,self.route)
        self.assertEqual(self.s["deeds"]["4"]["owner"],"2")
        self.assertEqual(self.s["players"][1]["cash"],476)
        self.act(2,"resign")
        self.assertEqual(self.s["winner"],"1")
        self.assertEqual(self.call(1,"lobby")["leaders"],[["Учень 1",1]])

    def test_six_seat_automatic_quick_game(self):
        self.create(n=6)
        self.act(1,"start")
        for _ in range(240):
            with patch("game.web.time.time", return_value=self.s["deadline"]+1):
                tick(self.path)
            self.s=self.call(1,self.route)
            if self.s["phase"]=="finished":
                break
        self.assertEqual(self.s["phase"],"finished")
        self.assertEqual(self.s["moves"],72)
        self.assertTrue(self.call(6,"lobby")["leaders"])

    def test_event_and_bankruptcy(self):
        s=rules.room("ABC", {"id":1},False,"classic")
        s["players"].append(rules.player({"id":2}))
        rules.action(s,"1",{"action":"start"},100)
        s["players"][0]["cash"]=1
        with patch("game.rules.secrets.randbelow",side_effect=[0,1]), patch("game.rules.secrets.choice",return_value=rules.EVENTS[1]):
            rules.action(s,"1",{"action":"roll"},101)
        self.assertTrue(s["players"][0]["out"])
        self.assertEqual(s["winner"],"2")

