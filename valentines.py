from contextlib import closing
import hmac
import secrets
import sqlite3
import time
from uuid import UUID

from flask import g, jsonify, request


INVITE = 9
NEW_MAIL = 10


def register(app, database, token, bot_username):
    with closing(sqlite3.connect(database)) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS val_boxes(owner INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS val_letters(id INTEGER PRIMARY KEY, recipient INTEGER NOT NULL,
                body TEXT NOT NULL, created INTEGER NOT NULL, receipt TEXT NOT NULL UNIQUE);
            CREATE INDEX IF NOT EXISTS val_inbox ON val_letters(recipient,id DESC);
        """)

    def mailbox(db):
        row = db.execute("SELECT code FROM val_boxes WHERE owner=?", (g.student,)).fetchone()
        code = row[0] if row else None
        link = f"https://t.me/{bot_username}?start=val_{code}" if bot_username and code else None
        return dict(code=code, link=link)

    @app.get("/app/api/valentines")
    def inbox():
        before = min(2**63-1, max(0, request.args.get("before", 2**63-1, type=int)))
        with closing(sqlite3.connect(database)) as db:
            rows = db.execute("""SELECT id,body,created FROM val_letters
                WHERE recipient=? AND id<? ORDER BY id DESC LIMIT 21""", (g.student, before)).fetchall()
            return jsonify(**mailbox(db), items=[dict(id=i, text=t, created=at) for i,t,at in rows[:20]],
                           more=len(rows)>20)

    @app.post("/app/api/valentines/box")
    def configure_box():
        action = request.form.get("action")
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if action == "open":
                while not db.execute("SELECT 1 FROM val_boxes WHERE owner=?", (g.student,)).fetchone():
                    db.execute("INSERT OR IGNORE INTO val_boxes VALUES (?,?)", (g.student, secrets.token_hex(6).upper()))
            elif action == "close":
                db.execute("DELETE FROM val_boxes WHERE owner=?", (g.student,))
            else:
                return jsonify(error="Невідома дія."), 400
            return jsonify(mailbox(db))

    @app.post("/app/api/valentines/send")
    def send_letter():
        code = request.form.get("code", "").strip().upper()
        body = request.form.get("text", "").strip()
        if not 1 <= len(body) <= 1000:
            return jsonify(error="Введіть текст валентинки до 1000 символів."), 400
        try:
            nonce = UUID(request.form.get("nonce", ""))
        except ValueError:
            return jsonify(error="Не вдалося підтвердити запит. Відкрийте форму ще раз."), 400
        receipt = hmac.digest(token.encode(), f"valentine:{g.student}:{nonce}".encode(), "sha256").hex()
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM val_letters WHERE receipt=?", (receipt,)).fetchone():
                return jsonify(ok=True)
            row = db.execute("SELECT owner FROM val_boxes WHERE code=?", (code,)).fetchone()
            if not row:
                return jsonify(error="Скриньку не знайдено. Попросіть нове посилання або код."), 404
            if row[0] == g.student:
                return jsonify(error="Це ваша скринька. Вкажіть код отримувача."), 400
            db.execute("INSERT INTO val_letters(recipient,body,created,receipt) VALUES (?,?,?,?)",
                       (row[0], body, int(time.time()), receipt))
            db.execute("""INSERT INTO deliveries(chat,body,broadcast)
                SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM deliveries WHERE chat=? AND broadcast=?)""",
                       (row[0], "У вашій скриньці є нова валентинка.", NEW_MAIL, row[0], NEW_MAIL))
            return jsonify(ok=True)
