import json
import logging
from contextlib import closing
from pathlib import Path
import secrets
import sqlite3
import threading
import time

from flask import Blueprint, g, jsonify, request, send_from_directory
from itsdangerous import URLSafeTimedSerializer, BadSignature
from . import rules

ASSETS = Path(__file__).with_name("assets")


def connect(database):
    return sqlite3.connect(database, timeout=8)


def save(db, s):
    s["version"] += 1
    db.execute("UPDATE game_rooms SET state=?, due=?, phase=? WHERE code=?",
               (json.dumps(s, ensure_ascii=False), s["deadline"], s["phase"], s["code"]))
    if s["phase"] == "finished":
        db.execute("INSERT OR IGNORE INTO game_wins VALUES (?,?,?)",
                   (s["code"], s["winner"], next(p["name"] for p in s["players"] if p["id"] == s["winner"])))


def tick(database):
    now = int(time.time())
    with closing(connect(database)) as db, db:
        codes = db.execute("SELECT code FROM game_rooms WHERE due>0 AND due<=? LIMIT 100", (now,)).fetchall()
        for code, in codes:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM game_rooms WHERE code=? AND due>0 AND due<=?", (code, now)).fetchone()
            if row:
                s = json.loads(row[0])
                rules.expire(s, now)
                save(db, s)
            db.commit()


def start_clock(database):
    def run():
        while True:
            try:
                tick(database)
            except sqlite3.Error:
                logging.exception("Помилка таймера гри")
            time.sleep(1)
    threading.Thread(target=run, daemon=True, name="game-clock").start()


def register(app, database, token, verify, bot_username=None):
    api = Blueprint("school_game", __name__)
    signer = URLSafeTimedSerializer(token, salt="school-game-v1")
    with closing(connect(database)) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS game_rooms(code TEXT PRIMARY KEY,state TEXT NOT NULL,
                phase TEXT NOT NULL,due INTEGER NOT NULL,private INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS game_due ON game_rooms(due);
            CREATE INDEX IF NOT EXISTS game_public ON game_rooms(phase,private);
            CREATE TABLE IF NOT EXISTS game_members(uid TEXT PRIMARY KEY,code TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS game_wins(code TEXT PRIMARY KEY,uid TEXT,name TEXT);
        """)

    @api.before_request
    def authorize():
        if request.path.startswith("/game/api/"):
            g.user = verify(request.headers.get("X-Telegram-Init-Data", ""), token)
            if not g.user:
                try:
                    ticket = request.headers.get("X-Game-Session") or request.cookies.get("game_session", "")
                    g.user = signer.loads(ticket, max_age=86400)
                except BadSignature:
                    return jsonify(error="Відкрийте гру через меню бота в Telegram."), 403
            g.uid = str(g.user["id"])
            if request.method == "POST" and not request.is_json:
                return jsonify(error="Некоректний формат запиту."), 400

    @api.after_request
    def headers(response):
        if request.path.startswith("/game/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @api.errorhandler(rules.RuleError)
    def invalid(error):
        return jsonify(error=str(error)), 409

    @api.get("/game")
    @api.get("/game/")
    def page():
        return send_from_directory(ASSETS, "index.html", max_age=0)

    @api.get("/game/assets/<path:name>")
    def asset(name):
        return send_from_directory(ASSETS, name)

    @api.get("/game/api/lobby")
    def lobby():
        with closing(connect(database)) as db:
            rooms = [json.loads(row[0]) for row in db.execute(
                "SELECT state FROM game_rooms WHERE private=0 AND phase='waiting' ORDER BY rowid DESC LIMIT 100")]
            member = db.execute("SELECT code FROM game_members WHERE uid=?", (g.uid,)).fetchone()
            leaders = db.execute("SELECT name,count(*) FROM game_wins GROUP BY uid ORDER BY count(*) DESC,uid LIMIT 20").fetchall()
        response = jsonify(me=g.uid, board=rules.BOARD, current=member and member[0], leaders=leaders,
                           invite_base=f"https://t.me/{bot_username}?start=room_" if bot_username else None,
                           rooms=[dict(code=s["code"], name=s["players"][0]["name"], mode=s["mode"],
                                       size=len(s["players"])) for s in rooms if len(s["players"]) < 6])
        if verify(request.headers.get("X-Telegram-Init-Data", ""), token):
            ticket = signer.dumps(g.user)
            response.headers["X-Game-Session"] = ticket
            response.set_cookie("game_session", ticket, max_age=86400, secure=True,
                                httponly=True, samesite="Strict", path="/game/api")
        return response

    @api.post("/game/api/rooms")
    def enter():
        data = request.get_json(silent=True)
        rules.require(isinstance(data, dict))
        with closing(connect(database)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            rules.require(not db.execute("SELECT 1 FROM game_members WHERE uid=?", (g.uid,)).fetchone(),
                          "Спочатку вийдіть із поточної кімнати.")
            if data.get("action") == "create":
                mode, private = data.get("mode"), data.get("private")
                rules.require(mode in ("classic", "quick") and type(private) is bool)
                code = secrets.token_hex(5).upper()
                s = rules.room(code, g.user, private, mode)
                db.execute("INSERT INTO game_rooms VALUES (?,?,?,?,?)",
                           (code, json.dumps(s), "waiting", 0, private))
            else:
                rules.require(data.get("action") == "join")
                code = str(data.get("code", "")).strip().upper()
                row = db.execute("SELECT state FROM game_rooms WHERE code=?", (code,)).fetchone()
                rules.require(row, "Кімнату не знайдено.")
                s = json.loads(row[0])
                rules.require(s["phase"] == "waiting" and len(s["players"]) < 6, "Кімната вже недоступна.")
                s["players"].append(rules.player(g.user))
                save(db, s)
            db.execute("INSERT INTO game_members VALUES (?,?)", (g.uid, code))
        return jsonify(s)

    @api.route("/game/api/rooms/<code>", methods=["GET", "POST"])
    def session(code):
        with closing(connect(database)) as db, db:
            if request.method == "POST":
                db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM game_rooms JOIN game_members USING(code) WHERE code=? AND uid=?",
                             (code, g.uid)).fetchone()
            if not row:
                return jsonify(error="Ви не є учасником цієї кімнати."), 404
            s = json.loads(row[0])
            if request.method == "GET":
                return jsonify(s) if request.args.get("v") != str(s["version"]) else ("", 204)
            data = request.get_json(silent=True)
            rules.require(isinstance(data, dict))
            if data.get("action") == "leave":
                p = next(p for p in s["players"] if p["id"] == g.uid)
                rules.require(s["phase"] in ("waiting", "finished") or p["out"], "Партія ще триває.")
                db.execute("DELETE FROM game_members WHERE uid=?", (g.uid,))
                if s["phase"] == "waiting":
                    s["players"].remove(p)
                    if s["players"]:
                        s["host"] = s["players"][0]["id"]
                        save(db, s)
                    else:
                        db.execute("DELETE FROM game_rooms WHERE code=?", (code,))
                return jsonify(left=True)
            now = int(time.time())
            if s["deadline"] and s["deadline"] <= now:
                rules.expire(s, now)
                save(db, s)
                db.commit()
                return jsonify(error="Час ходу вичерпано. Оновлено стан гри."), 409
            if data.get("action") != "chat":
                rules.require(data.get("version") == s["version"], "Стан гри змінився. Повторіть дію.")
            rules.action(s, g.uid, data, now)
            save(db, s)
            return jsonify(s)

    app.register_blueprint(api)

