import sqlite3
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import bot
from mafia import web
from panel import create_panel
from test_game import TOKEN, signed


class MafiaMatch(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / "bot.sqlite"
        self.app = create_panel(self.db, TOKEN, set(), None)

    def call(self, uid, path, data=None, status=200):
        client = self.app.test_client()
        headers = {"X-Telegram-Init-Data": signed(uid)}
        path = "/mafia/api/" + path
        response = client.get(path, headers=headers) if data is None else client.post(path, json=data, headers=headers)
        self.assertEqual(response.status_code, status, response.data)
        return response.get_json(silent=True)

    def create(self, n):
        self.state = self.call(1, "rooms", {"action": "create"})
        self.code = self.state["code"]
        self.route = "rooms/" + self.code
        for uid in range(2, n + 1):
            self.call(uid, "rooms", dict(action="join", code=self.code))

    def command(self, uid, action, status=200, **data):
        return self.call(uid, self.route, dict(action=action, step=self.state["step"], **data), status)

    def start(self, n):
        self.create(n)
        for uid in range(1, n + 1):
            self.command(uid, "ready", ready=True)
        self.state = self.command(1, "start")
        by_role = {}
        for uid in range(1, n + 1):
            state = self.call(uid, self.route)
            self.assertFalse(any(p["role"] for p in state["players"]))
            by_role.setdefault(state["role"], []).append(uid)
        return by_role

    def advance(self, phase):
        web.tick(self.db, self.state["deadline"])
        self.state = self.call(1, self.route)
        self.assertEqual(self.state["phase"], phase)

    def test_complete_city_match_private_checks_and_reconnect(self):
        sides = self.start(6)
        don, maf, doc, det = (sides[r][0] for r in ("don", "mafia", "doctor", "detective"))
        citizen = sides["civilian"][0]
        self.call(90, "rooms", dict(action="watch", code=self.code))
        self.advance("night")
        self.command(90, "inspect", 409, target=str(don))
        self.command(citizen, "attack", 409, target=str(det))
        for uid in (don, maf):
            self.command(uid, "attack", target=str(det))
        self.assertEqual(self.call(maf, self.route)["team_picks"], {str(don):str(det), str(maf):str(det)})
        for uid in (90, det, doc, citizen):
            self.assertEqual(self.call(uid,self.route)["team_picks"], {})
        self.command(doc, "heal", target=str(det))
        self.command(det, "inspect", target=str(don))
        self.command(don, "inspect", target=str(det))
        self.advance("report")
        self.assertIsNone(self.state["report"]["victim"])
        for uid in (det, don):
            self.assertTrue(self.call(uid, self.route)["notes"][0]["positive"])
        for uid in (90, citizen, maf, doc):
            state = self.call(uid, self.route)
            self.assertEqual(state["notes"], [])
            self.assertNotIn("moves", state)
        self.assertFalse(self.call(90, self.route)["role"])
        self.advance("day")
        self.command(det, "chat", text="Перевірка завершена.")
        self.command(det, "chat", 409, text="Ще раз")
        self.assertEqual(self.call(citizen, self.route)["chat"][-1]["uid"], str(det))
        self.advance("vote")
        self.app = create_panel(self.db, TOKEN, set(), None)
        self.assertEqual(self.call(det, "home")["current"], self.code)
        self.assertEqual(self.call(det, self.route)["role"], "detective")
        step = self.state["step"]
        self.call(det, self.route, dict(action="vote", step=step-1, target=str(maf)), 409)
        with ThreadPoolExecutor(max_workers=5) as pool:
            list(pool.map(lambda uid: self.command(uid, "vote", target=str(don)), [uid for uid in range(1, 7) if uid != don]))
        self.assertEqual(self.call(det, self.route)["vote_count"], 5)
        self.advance("report")
        self.assertEqual(self.state["report"]["victim"], str(don))
        self.advance("night")
        self.command(don, "attack", 409, target=str(det))
        self.command(doc, "heal", 409, target=str(det))
        self.advance("report")
        self.advance("day")
        self.command(don, "chat", 409, text="Вибув")
        self.advance("vote")
        self.command(det, "vote", target=str(maf))
        self.advance("report")
        self.advance("finished")
        self.assertEqual(self.state["winner"], "city")
        self.assertTrue(all(p["role"] for p in self.state["players"]))
        self.assertEqual(self.call(det, "records")["stats"]["wins"], 1)
        self.assertEqual(self.call(don, "records")["history"][0]["won"], 0)
        self.assertEqual(self.call(90, "records")["history"], [])
        self.command(det, "leave")
        self.assertIsNone(self.call(det, "home")["current"])

    def test_full_table_mafia_win_and_tied_votes(self):
        roles = self.start(12)
        self.assertEqual(len(roles["mafia"]), 3)
        self.call(13, "rooms", dict(action="join", code=self.code), 409)
        self.advance("night")
        attackers = roles["mafia"] + roles["don"]
        for idx in range(4):
            victim = roles["civilian"][idx]
            self.command(attackers[0], "attack", target=str(victim))
            self.advance("report")
            self.assertEqual(self.state["report"]["victim"], str(victim))
            if idx == 3:
                self.advance("finished")
                break
            self.advance("day")
            self.advance("vote")
            self.command(attackers[0], "vote", target=str(attackers[1]))
            self.command(attackers[1], "vote", target=str(attackers[0]))
            self.advance("report")
            self.assertIsNone(self.state["report"]["victim"])
            self.advance("night")
        self.assertEqual(self.state["winner"], "mafia")
        self.assertEqual(len(self.call(1, "records")["leaders"]), 12)

    def test_deadline_enforced_without_clock_worker_and_recovery_draw(self):
        self.start(7)
        with patch.object(web, "time", Mock(time=lambda: self.state["deadline"])):
            self.command(1, "ready", 409, ready=False)
        self.state = self.call(1, self.route)
        self.assertEqual(self.state["phase"], "night")
        web.tick(self.db, self.state["deadline"] + 86400)
        self.state = self.call(1, self.route)
        self.assertEqual((self.state["phase"], self.state["winner"]), ("finished", "draw"))
        web.tick(self.db, self.state["deadline"] + 10)
        self.assertEqual(self.call(1, "records")["stats"], dict(games=1,wins=0,draws=1))

    def test_capacity_simultaneous_join_settings_host_and_spectators(self):
        self.create(5)
        self.command(2, "settings", 409, capacity=6, pace="quick")
        self.command(2, "start", 409)
        self.command(1, "start", 409)
        self.command(2, "ready", ready=True)
        self.state = self.command(1, "settings", capacity=6, pace="quick")
        self.assertFalse(any(p["ready"] for p in self.state["players"]))
        def join(uid):
            return self.app.test_client().post("/mafia/api/rooms", json=dict(action="join",code=self.code),
                     headers={"X-Telegram-Init-Data":signed(uid)}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(join, [6,7])), [200,409])
        self.call(8, self.route, status=404)
        self.call(8, "rooms", dict(action="watch", code=self.code))
        self.command(8, "ready", 409, ready=True)
        self.command(8, "leave")
        self.command(1, "leave")
        self.assertEqual(self.call(2,self.route)["host"], "2")
        web.tick(self.db,int(time.time())+86500)
        self.assertIsNone(self.call(2, "home")["current"])

    def test_telegram_launch_and_versioned_updates(self):
        self.create(1)
        self.call(1, self.route+"?v="+str(self.state["version"]), status=204)
        c = self.app.test_client()
        self.assertEqual(c.get("/mafia/api/home").status_code,403)
        ticket = self.call(1, "home")["ticket"]
        self.assertEqual(c.get("/mafia/api/home",headers={"X-Mafia-Session":ticket}).json["me"],"1")
        self.assertEqual(c.get("/mafia/api/home",headers={"X-Mafia-Session":ticket+"x"}).status_code,403)
        with patch("time.time",return_value=time.time()-7200):
            expired = signed(1)
        self.assertEqual(c.get("/mafia/api/home",headers={"X-Telegram-Init-Data":expired}).status_code,403)
        with closing(sqlite3.connect(self.db)) as db, patch("bot.panel_url",return_value="https://school.example"):
            bot.initialize(db)
            for message in ({"text":"/mafia"},{"web_app_data":{"data":"mafia"}}):
                bot.handle(db, {"message":{"chat":{"type":"private","id":1},**message}}, set())
            deliveries=db.execute("SELECT chat,body,broadcast,photo FROM deliveries").fetchall()
            self.assertEqual(len(deliveries),2)
            for chat, body, kind, photo in deliveries:
                api=Mock()
                bot.deliver(db,api,chat,body,kind,photo,set())
                button=api.call_args.kwargs["reply_markup"]["inline_keyboard"][0][0]
                self.assertEqual(button["web_app"]["url"],"https://school.example/mafia/")
