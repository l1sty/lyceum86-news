from contextlib import closing
import hmac
import re
import secrets
import sqlite3
import time
from uuid import UUID

import requests
from flask import g, jsonify, request


INVITE = 9
NEW_MAIL = 10
USERNAME = re.compile(r"[A-Za-z0-9_]{1,32}")
UNAVAILABLE = "Не вдалося перевірити ім’я в Telegram. Спробуйте знову або скористайтеся посиланням на скриньку."


def telegram_username(token, owner):
    """Read the current handle by numeric private chat id. Never trust a typed owner id."""
    try:
        response = requests.post(f"https://api.telegram.org/bot{token}/getChat",
                                 json={"chat_id": owner}, timeout=(2, 4))
        if response.status_code in (400, 403):
            return None
        response.raise_for_status()
        chat = response.json()["result"]
        if chat["id"] != owner or chat["type"] != "private":
            raise ValueError
        username = chat.get("username")
        return username if username and USERNAME.fullmatch(username) else None
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raise ConnectionError(UNAVAILABLE) from None


def sync_username(db, token, owner):
    row = db.execute("SELECT code,username FROM val_boxes WHERE owner=?", (owner,)).fetchone()
    if not row:
        return
    try:
        username = telegram_username(token, owner)
    except ConnectionError:
        return
    code, previous = row
    if previous == username:
        return
    with db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM val_boxes WHERE owner=? AND code=? AND username IS ?",
                      (owner, code, previous)).fetchone():
            if username:
                db.execute("UPDATE val_boxes SET username=NULL WHERE username=? AND owner<>?", (username, owner))
            db.execute("UPDATE val_boxes SET username=? WHERE owner=?", (username, owner))


def index_existing_boxes(database, token):
    with closing(sqlite3.connect(database, timeout=15)) as db:
        owners = db.execute("SELECT owner FROM val_boxes").fetchall()
        for owner, in owners:
            sync_username(db, token, owner)
            time.sleep(0.2)


def register(app, database, token, bot_username):
    with closing(sqlite3.connect(database)) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS val_boxes(owner INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS val_letters(id INTEGER PRIMARY KEY, recipient INTEGER NOT NULL,
                body TEXT NOT NULL, created INTEGER NOT NULL, receipt TEXT NOT NULL UNIQUE);
            CREATE INDEX IF NOT EXISTS val_inbox ON val_letters(recipient,id DESC);
        """)
        if "username" not in {r[1] for r in db.execute("PRAGMA table_info(val_boxes)")}:
            db.execute("ALTER TABLE val_boxes ADD COLUMN username TEXT COLLATE NOCASE")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS val_username ON val_boxes(username COLLATE NOCASE)")

    def mailbox(db):
        row = db.execute("SELECT code,username FROM val_boxes WHERE owner=?", (g.student,)).fetchone()
        code = row[0] if row else None
        link = f"https://t.me/{bot_username}?start=val_{code}" if bot_username and code else None
        return dict(code=code, link=link, username=row[1] if row else None)

    @app.get("/app/api/valentines")
    def inbox():
        before = min(2**63-1, max(0, request.args.get("before", 2**63-1, type=int)))
        with closing(sqlite3.connect(database)) as db:
            if "before" not in request.args:
                sync_username(db, token, g.student)
            box = mailbox(db)
            rows = db.execute("""SELECT id,body,created FROM val_letters
                WHERE recipient=? AND id<? ORDER BY id DESC LIMIT 21""", (g.student, before)).fetchall()
            return jsonify(**box, items=[dict(id=i, text=t, created=at) for i,t,at in rows[:20]],
                           more=len(rows)>20)

    @app.post("/app/api/valentines/box")
    def configure_box():
        action = request.form.get("action")
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if action == "open":
                while not db.execute("SELECT 1 FROM val_boxes WHERE owner=?", (g.student,)).fetchone():
                    db.execute("INSERT OR IGNORE INTO val_boxes(owner,code) VALUES (?,?)", (g.student, secrets.token_hex(6).upper()))
            elif action == "close":
                db.execute("DELETE FROM val_boxes WHERE owner=?", (g.student,))
            else:
                return jsonify(error="Невідома дія."), 400
            db.commit()
            if action == "open":
                sync_username(db, token, g.student)
            return jsonify(mailbox(db))

    @app.post("/app/api/valentines/send")
    def send_letter():
        address = request.form.get("recipient", request.form.get("code", "")).strip()
        username = None if re.fullmatch(r"[A-Fa-f0-9]{12}", address) else address.removeprefix("@")
        if username is not None and not USERNAME.fullmatch(username):
            return jsonify(error="Перевірте ім’я користувача після @."), 400
        code = address.upper()
        body = request.form.get("text", "").strip()
        if not 1 <= len(body) <= 1000:
            return jsonify(error="Введіть текст валентинки до 1000 символів."), 400
        try:
            nonce = UUID(request.form.get("nonce", ""))
        except ValueError:
            return jsonify(error="Не вдалося підтвердити запит. Відкрийте форму ще раз."), 400
        receipt = hmac.digest(token.encode(), f"valentine:{g.student}:{nonce}".encode(), "sha256").hex()
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            if username is not None:
                if db.execute("SELECT 1 FROM val_letters WHERE receipt=?", (receipt,)).fetchone():
                    return jsonify(ok=True)
                missing = "За цим іменем скриньку не знайдено. Попросіть отримувача відкрити розділ валентинок і ввімкнути прийом."
                candidate = db.execute("SELECT owner,code FROM val_boxes WHERE username=?", (username,)).fetchone()
                if not candidate:
                    return jsonify(error=missing), 404
                try:
                    current = telegram_username(token, candidate[0])
                except ConnectionError:
                    return jsonify(error=UNAVAILABLE), 503
                if not current or current.lower() != username.lower():
                    return jsonify(error=missing), 404
                code = candidate[1]
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM val_letters WHERE receipt=?", (receipt,)).fetchone():
                return jsonify(ok=True)
            if username is not None:
                row = db.execute("SELECT owner FROM val_boxes WHERE owner=? AND code=? AND username=?",
                                 (candidate[0], code, username)).fetchone()
            else:
                row = db.execute("SELECT owner FROM val_boxes WHERE code=?", (code,)).fetchone()
            if not row:
                return jsonify(error=missing if username is not None else "Скриньку не знайдено. Попросіть нове посилання або код."), 404
            if row[0] == g.student:
                return jsonify(error="Це ваша скринька. Вкажіть іншого отримувача."), 400
            db.execute("INSERT INTO val_letters(recipient,body,created,receipt) VALUES (?,?,?,?)",
                       (row[0], body, int(time.time()), receipt))
            db.execute("""INSERT INTO deliveries(chat,body,broadcast)
                SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM deliveries WHERE chat=? AND broadcast=?)""",
                       (row[0], "У вашій скриньці є нова валентинка.", NEW_MAIL, row[0], NEW_MAIL))
            return jsonify(ok=True)
