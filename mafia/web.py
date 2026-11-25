import json
import logging
from contextlib import closing
from pathlib import Path
import secrets
import sqlite3
import threading
import time

from flask import Blueprint, g, jsonify, request, send_from_directory
from itsdangerous import BadData, URLSafeTimedSerializer

from game.web import connect
from . import rules

ROOT = Path(__file__).resolve().parent
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def save(db, s, now):
    s["version"] += 1
    db.execute("UPDATE mafia_rooms SET state=?,version=?,due=? WHERE code=?",
               (json.dumps(s, ensure_ascii=False), s["version"], s["deadline"] or now + 86400, s["code"]))
    if s["phase"] == "finished":
        db.executemany("INSERT OR IGNORE INTO mafia_results VALUES (?,?,?,?,?,?,?,?)", [
            (s["code"], p["id"], p["name"], p["role"], s["winner"], now, s["round"],
             int(s["winner"] == ("mafia" if p["role"] in rules.CRIME else "city")))
            for p in s["players"]])


def advance(db, s, now):
    if s["phase"] in ("lobby", "finished"):
        db.execute("DELETE FROM mafia_members WHERE code=?", (s["code"],))
        db.execute("DELETE FROM mafia_rooms WHERE code=?", (s["code"],))
        return False
    while s["deadline"] and s["deadline"] <= now:
        rules.expire(s, s["deadline"])
    save(db, s, now)
    return True


def tick(database, now=None):
    now = int(time.time()) if now is None else now
    with closing(connect(database)) as db, db:
        codes = db.execute("SELECT code FROM mafia_rooms WHERE due<=? ORDER BY due LIMIT 100", (now,)).fetchall()
        for code, in codes:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM mafia_rooms WHERE code=? AND due<=?", (code, now)).fetchone()
            if row:
                advance(db, json.loads(row[0]), now)
            db.commit()


def start_clock(database):
    def run():
        while True:
            try:
                tick(database)
            except sqlite3.Error:
                logging.exception("Не вдалося оновити таймер «Мафії»")
            time.sleep(0.5)
    threading.Thread(target=run, name="mafia-clock", daemon=True).start()


def register(app, database, token, verify):
    bp = Blueprint("mafia", __name__, url_prefix="/mafia")
    signer = URLSafeTimedSerializer(token, salt="mafia-session-v1")
    with closing(connect(database)) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS mafia_rooms(
                code TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL, due INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS mafia_due ON mafia_rooms(due);
            CREATE TABLE IF NOT EXISTS mafia_members(uid TEXT PRIMARY KEY, code TEXT NOT NULL, spectator INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS mafia_members_room ON mafia_members(code);
            CREATE TABLE IF NOT EXISTS mafia_results(code TEXT, uid TEXT, name TEXT, role TEXT,
                winner TEXT, ended INTEGER, rounds INTEGER, won INTEGER, PRIMARY KEY(code,uid));
            CREATE INDEX IF NOT EXISTS mafia_history ON mafia_results(uid,ended DESC);
        """)

    @bp.before_request
    def authorize():
        if not request.path.startswith("/mafia/api/"):
            return
        g.fresh = False
        raw = request.headers.get("X-Telegram-Init-Data")
        if raw:
            user = verify(raw, token)
            g.fresh = bool(user)
        else:
            try:
                user = signer.loads(request.headers.get("X-Mafia-Session", ""), max_age=86400)
            except BadData:
                user = None
        if not user:
            return jsonify(error="Відкрийте «Мафію» командою /mafia у Telegram."), 403
        g.user, g.uid = user, str(user["id"])
        if request.method == "POST":
            if request.content_length is None or request.content_length > 4096:
                return jsonify(error="Запит завеликий."), 413
            g.data = request.get_json(silent=True)
            if not isinstance(g.data, dict):
                return jsonify(error="Некоректний формат запиту."), 400

    @bp.after_request
    def headers(response):
        if request.path.startswith("/mafia/api/"):
            response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @bp.errorhandler(rules.Invalid)
    def invalid(error):
        return jsonify(error=str(error)), 409

    @bp.get("/")
    def index():
        return send_from_directory(ROOT / "dist", "index.html", max_age=0)

    @bp.get("/assets/<path:name>")
    def assets(name):
        return send_from_directory(ROOT / "dist" / "assets", name, max_age=31536000)

    @bp.get("/art/<path:name>")
    def art(name):
        return send_from_directory(ROOT / "art", name)

    @bp.get("/api/home")
    def home():
        with closing(connect(database)) as db:
            current = db.execute("SELECT code FROM mafia_members WHERE uid=?", (g.uid,)).fetchone()
        return jsonify(me=g.uid, name=g.user.get("first_name") or "Гравець", current=current and current[0],
                       ticket=signer.dumps(g.user) if g.fresh else None)

    @bp.get("/api/records")
    def records():
        with closing(connect(database)) as db:
            db.row_factory = sqlite3.Row
            leaders = db.execute("""
                WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY ended DESC, code) AS recent
                    FROM mafia_results)
                SELECT MAX(CASE WHEN recent=1 THEN name END) AS name, COUNT(*) games, SUM(won) wins
                FROM ranked GROUP BY uid ORDER BY wins DESC, games ASC, uid LIMIT 50""")
            leaders = [dict(r) for r in leaders]
            counts = db.execute("""SELECT COUNT(*) games, COALESCE(SUM(won),0) wins,
                COUNT(CASE WHEN winner='draw' THEN 1 END) draws FROM mafia_results WHERE uid=?""", (g.uid,)).fetchone()
            history = db.execute("""SELECT code,role,winner,ended,rounds,won FROM mafia_results
                WHERE uid=? ORDER BY ended DESC,code LIMIT 50""", (g.uid,))
            return jsonify(leaders=leaders, stats=dict(counts), history=[dict(r) for r in history])

    @bp.post("/api/rooms")
    def enter():
        data = g.data
        with closing(connect(database)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            rules.require(not db.execute("SELECT 1 FROM mafia_members WHERE uid=?", (g.uid,)).fetchone(),
                          "Ви вже в кімнаті. Поверніться до гри.")
            action = data.get("action")
            spectator = action == "watch"
            if action == "create":
                while True:
                    code = "".join(secrets.choice(ALPHABET) for _ in range(6))
                    if not db.execute("SELECT code FROM mafia_rooms WHERE code=? UNION ALL SELECT code FROM mafia_results WHERE code=? LIMIT 1",
                                      (code, code)).fetchone():
                        break
                s = rules.room(code, g.user, now)
                db.execute("INSERT INTO mafia_rooms VALUES (?,?,?,?)", (code, "{}", 0, s["deadline"]))
            else:
                rules.require(action in ("join", "watch"), "Оберіть спосіб входу.")
                code = str(data.get("code", "")).strip().upper()
                row = db.execute("SELECT state,due FROM mafia_rooms WHERE code=?", (code,)).fetchone()
                rules.require(row, "Кімнату з таким кодом не знайдено.")
                s = json.loads(row[0])
                rules.require(row[1] > now or s["phase"] not in ("lobby", "finished"), "Час кімнати вичерпано.")
                if spectator:
                    count = db.execute("SELECT COUNT(*) FROM mafia_members WHERE code=? AND spectator=1", (code,)).fetchone()[0]
                    rules.require(count < 24, "Місця для спостерігачів закінчилися.")
                else:
                    rules.require(s["phase"] == "lobby" and len(s["players"]) < s["capacity"],
                                  "Місць за столом немає або партія вже триває. Можна спостерігати.")
                    s["players"].append(rules.player(g.user))
            db.execute("INSERT INTO mafia_members VALUES (?,?,?)", (g.uid, code, spectator))
            save(db, s, now)
            return jsonify(rules.view(s, g.uid, spectator, now))

    @bp.route("/api/rooms/<code>", methods=["GET", "POST"])
    def session(code):
        with closing(connect(database)) as db, db:
            writing = request.method == "POST"
            if writing:
                db.execute("BEGIN IMMEDIATE")
            now = int(time.time())
            member = db.execute("""SELECT spectator,version FROM mafia_members JOIN mafia_rooms USING(code)
                WHERE uid=? AND code=?""", (g.uid, code)).fetchone()
            if not member:
                return jsonify(error="Ви більше не в цій кімнаті."), 404
            spectator, version = member
            if not writing and request.args.get("v") == str(version):
                return "", 204
            row = db.execute("SELECT state,due FROM mafia_rooms WHERE code=?", (code,)).fetchone()
            if not row:
                return jsonify(error="Кімнату закрито."), 404
            s = json.loads(row[0])
            if writing:
                if row[1] <= now:
                    active = advance(db, s, now)
                    db.commit()
                    return jsonify(error="Етап гри змінився." if active else "Кімнату закрито."), 409 if active else 404
                if g.data.get("action") == "leave":
                    p = rules.find(s, g.uid)
                    rules.require(spectator or s["phase"] in ("lobby", "finished") or not p["alive"],
                                  "Ви ще за столом. Можна закрити гру й повернутися.")
                    db.execute("DELETE FROM mafia_members WHERE uid=?", (g.uid,))
                    if not spectator and s["phase"] == "lobby":
                        s["players"].remove(p)
                        if not s["players"]:
                            db.execute("DELETE FROM mafia_rooms WHERE code=?", (code,))
                            db.execute("DELETE FROM mafia_members WHERE code=?", (code,))
                        else:
                            s["host"] = s["players"][0]["id"]
                            save(db, s, now)
                    return jsonify(left=True)
                rules.require(not spectator, "Спостерігачі не беруть участі в грі.")
                rules.act(s, g.uid, g.data, now)
                save(db, s, now)
            return jsonify(rules.view(s, g.uid, bool(spectator), now))

    app.register_blueprint(bp)
