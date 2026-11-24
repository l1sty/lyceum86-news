from contextlib import closing
import hashlib
import hmac
import io
import json
import sqlite3
import time
import requests
from itsdangerous import URLSafeTimedSerializer, BadData
from urllib.parse import parse_qsl
from uuid import UUID

from flask import Flask, g, jsonify, render_template, request, send_file
from PIL import Image, ImageOps, UnidentifiedImageError


def telegram_user(raw, token):
    try:
        pairs = parse_qsl(raw, strict_parsing=True, keep_blank_values=True, max_num_fields=32)
        fields = dict(pairs)
        if len(fields) != len(pairs):
            return None
        signature = fields.pop("hash")
        content = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
        secret = hmac.digest(b"WebAppData", token.encode(), "sha256")
        expected = hmac.new(secret, content.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        age = time.time() - int(fields["auth_date"])
        user = json.loads(fields["user"])
        return user if -30 <= age <= 3600 and type(user["id"]) is int else None
    except (ValueError, KeyError, TypeError):
        return None


def app_user(raw, token):
    user = telegram_user(raw, token)
    if user:
        return user
    try:
        uid = URLSafeTimedSerializer(token, salt="student-app").loads(
            request.headers.get("X-Student-Launch", ""), max_age=7*86400)
    except BadData:
        return None
    return {"id": uid} if type(uid) is int else None


def prepare_photo(upload):
    with Image.open(upload) as image:
        width, height = image.size
        if image.format not in {"JPEG", "PNG", "WEBP"} or width * height > 24_000_000 or max(width,height) > 20 * min(width,height):
            raise ValueError
        image.thumbnail((1920, 1920))
        rotated = ImageOps.exif_transpose(image).convert("RGBA")
        background = Image.new("RGB", rotated.size, "white")
        background.paste(rotated, mask=rotated.getchannel("A"))
        output = io.BytesIO()
        background.save(output, format="JPEG", quality=88)
        return output.getvalue()


def create_panel(database, token, admins, publish, bot_username=None):
    app = Flask(__name__, template_folder="",
                static_folder="editor_assets", static_url_path="/app/assets")
    from game.web import register
    register(app, database, token, app_user, admins, bot_username)
    app.config["MAX_CONTENT_LENGTH"] = 9 * 1024 * 1024

    def page_cursor():
        last_id = 2**63 - 1
        before = request.args.get("before", last_id, type=int)
        return max(0, min(before, last_id))

    @app.before_request
    def authorize():
        raw = request.headers.get("X-Telegram-Init-Data", "")
        if request.path.startswith("/app/api/"):
            user = app_user(raw, token)
            if not user:
                return jsonify(error="Для доступу відкрийте застосунок через нову кнопку після /start."), 403
            g.student = user["id"]
        if request.path.startswith("/api/"):
            user = app_user(raw, token)
            if not user or user["id"] not in admins:
                return jsonify(error="Редакція доступна лише з облікового запису редактора. Відкрийте застосунок у Telegram."), 403
            g.editor = user["id"]

    @app.after_request
    def cache_policy(response):
        if request.path.startswith(("/api/", "/app/api/")):
            response.headers["Cache-Control"] = "no-store"
        if request.path == "/" or request.path.startswith("/app/"):
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/app/api/news")
    def student_news():
        with closing(sqlite3.connect(database)) as db:
            rows = db.execute("SELECT id,body,photo FROM news ORDER BY id DESC LIMIT 3")
            return jsonify(items=[dict(id=i, body=body.removeprefix("📰 86 News\n\n"), photo=bool(photo))
                                  for i, body, photo in rows])

    @app.route("/app/api/profile", methods=["GET", "POST"])
    def student_profile():
        from bot import change_subscription
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("""INSERT INTO audience VALUES (?, ?, 0)
                          ON CONFLICT(chat) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen)""",
                       (g.student, int(time.time())))
            if request.method == "POST":
                action = request.form.get("action")
                if action not in ("subscribe", "unsubscribe"):
                    return jsonify(error="Невідома дія."), 400
                change_subscription(db, g.student, action == "subscribe")
            polls, subscribed = db.execute("""
                SELECT (SELECT COUNT(*) FROM votes WHERE voter=?),
                       EXISTS(SELECT 1 FROM subscribers WHERE chat=?)
            """, (g.student, g.student)).fetchone()
        return jsonify(id=g.student, polls=polls, subscribed=bool(subscribed), editor=g.student in admins)

    @app.post("/app/api/status")
    def student_status():
        code = request.form.get("code", "").strip().upper()
        with closing(sqlite3.connect(database)) as db:
            row = db.execute("SELECT state,answer FROM cases WHERE code=?", (code,)).fetchone()
        if not row:
            return jsonify(error="Звернення за цим кодом не знайдено."), 404
        return jsonify(state=row[0], answer=row[1])

    @app.route("/app/api/polls", methods=["GET", "POST"])
    def student_polls():
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            if request.method == "POST":
                from bot import record_vote
                message = record_vote(db, {"from": {"id": g.student},
                                           "data": f"vote:{request.form.get('poll')}:{request.form.get('choice')}"})
                if not message.startswith("Ваш голос зараховано:"):
                    return jsonify(error=message), 400
                return jsonify(message=message)
            rows = db.execute("""
                SELECT p.id,p.question,p.options,v.choice FROM active_polls p
                LEFT JOIN votes v ON p.id=v.poll AND v.voter=? ORDER BY p.id DESC LIMIT 5
            """, (g.student,)).fetchall()
        return jsonify(items=[dict(id=i, question=q, options=json.loads(options), choice=choice)
                              for i,q,options,choice in rows])

    @app.get("/api/stats")
    def editor_stats():
        from bot import audience_stats
        with closing(sqlite3.connect(database)) as db:
            return jsonify(audience_stats(db, int(time.time())))

    @app.get("/app/api/news/<int:news_id>/photo")
    def student_photo(news_id):
        if news_id >= 2**63:
            return "", 404
        with closing(sqlite3.connect(database)) as db:
            row = db.execute("SELECT p.data,p.file_id FROM news n JOIN photos p ON n.photo=p.id WHERE n.id=?",
                             (news_id,)).fetchone()
        if not row:
            return "", 404
        data, file_id = row
        if not data and file_id:
            try:
                meta = requests.post(f"https://api.telegram.org/bot{token}/getFile", json={"file_id":file_id}, timeout=10)
                meta.raise_for_status()
                path = meta.json()["result"]["file_path"]
                photo = requests.get(f"https://api.telegram.org/file/bot{token}/{path}", timeout=15)
                photo.raise_for_status()
                data = photo.content
            except (requests.RequestException, KeyError, ValueError):
                return "", 502
        return send_file(io.BytesIO(data), mimetype="image/jpeg") if data else ("", 404)

    @app.post("/app/api/feedback")
    def student_feedback():
        from bot import ANONYMOUS, SIGNED, IDEA, save_case
        if not admins:
            return jsonify(error="Прийом звернень поки недоступний."), 503
        kinds = {"anonymous":ANONYMOUS, "signed":SIGNED, "idea":IDEA}
        kind = request.form.get("kind", "")
        text = request.form.get("text", "").strip()
        if kind not in kinds or not text or len(text.encode("utf-16-le")) // 2 > 3900:
            return jsonify(error="Оберіть тип звернення і введіть текст до 3900 знаків."), 400
        try:
            nonce = UUID(request.form.get("nonce", ""))
        except ValueError:
            return jsonify(error="Некоректний номер запиту."), 400
        receipt = hmac.new(token.encode(), f"case:{g.student}:{nonce}".encode(), hashlib.sha256).hexdigest()
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT code FROM student_receipts WHERE receipt=?", (receipt,)).fetchone()
            if row:
                return jsonify(code=row[0])
            code = save_case(db, g.student, kinds[kind], text, admins)
            db.execute("INSERT INTO student_receipts VALUES (?,?)", (receipt, code))
        return jsonify(code=code)

    @app.route("/api/polls", methods=["GET", "POST"])
    def polls():
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            if request.method == "GET":
                items = []
                rows = db.execute("SELECT id,question,options FROM active_polls WHERE id<? ORDER BY id DESC LIMIT 21", (page_cursor(),)).fetchall()
                for pid, question, raw in rows[:20]:
                    counts = dict(db.execute("SELECT choice,COUNT(*) FROM votes WHERE poll=? GROUP BY choice", (pid,)))
                    items.append(dict(id=pid, question=question, options=json.loads(raw), counts=counts))
                return jsonify(items=items, has_more=len(rows)>20)
            question = request.form.get("question", "").strip()
            options = [s.strip() for s in request.form.getlist("option")]
            if not 1 <= len(question) <= 300 or not 2 <= len(options) <= 10 or any(not 1 <= len(s) <= 80 for s in options) or len({s.casefold() for s in options}) != len(options):
                return jsonify(error="Введіть запитання та від 2 до 10 різних варіантів (до 80 знаків кожен)."), 400
            try:
                nonce = str(UUID(request.form.get("nonce", "")))
            except ValueError:
                return jsonify(error="Некоректний запит."), 400
            if db.execute("INSERT OR IGNORE INTO submissions VALUES (?,?)", (g.editor, nonce)).rowcount:
                pid = db.execute("INSERT INTO polls(question,options) VALUES (?,?)", (question,json.dumps(options))).lastrowid
                db.execute("INSERT INTO deliveries(chat,body,broadcast) SELECT chat,?,4 FROM subscribers", (str(pid),))
        return jsonify(ok=True)

    @app.delete("/api/polls/<int:pid>")
    def delete_poll(pid):
        if pid >= 2**63:
            return jsonify(error="Опитування не знайдено."), 404
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            db.execute("INSERT OR IGNORE INTO deleted_polls SELECT id FROM polls WHERE id=?", (pid,))
            if not db.execute("SELECT 1 FROM deleted_polls WHERE id=?", (pid,)).fetchone():
                return jsonify(error="Опитування не знайдено."), 404
            db.execute("DELETE FROM votes WHERE poll=?", (pid,))
        return jsonify(ok=True)

    @app.route("/api/cases", methods=["GET", "POST"])
    def cases():
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            if request.method == "GET":
                db.row_factory = sqlite3.Row
                rows = db.execute("SELECT rowid AS id,body,state,answer,version FROM cases WHERE rowid<? ORDER BY rowid DESC LIMIT 21", (page_cursor(),)).fetchall()
                return jsonify(items=[dict(row) for row in rows[:20]], has_more=len(rows)>20)
            state = request.form.get("state")
            answer = request.form.get("answer", "").strip()
            if state not in ("Отримано","Розглядаємо","Є відповідь") or len(answer)>2000 or (state=="Є відповідь" and not answer):
                return jsonify(error="Перевірте статус і відповідь (до 2000 знаків)."), 400
            if not db.execute("UPDATE cases SET state=?,answer=?,version=version+1 WHERE rowid=? AND version=?",
                              (state,answer,request.form.get("id"),request.form.get("version"))).rowcount:
                return jsonify(error="Звернення вже змінилося. Оновіть список."), 409
        return jsonify(ok=True)

    @app.get("/")
    @app.get("/app/")
    def student_app():
        initial_page = "editor" if request.path == "/" or request.args.get("view") == "editor" else "home"
        return render_template("student.html", initial_page=initial_page)

    @app.route("/api/editor", methods=["GET", "POST"])
    def editor():
        uid = g.editor
        if request.method == "GET":
            return jsonify(ok=True)
        text = request.form.get("text", "").strip()
        upload = request.files.get("photo")
        limit = 1000 if upload is not None else 4000
        if not text or len(text.encode("utf-16-le")) // 2 > limit:
            return jsonify(error=f"Введіть текст до {limit} знаків."), 400
        try:
            nonce = str(UUID(request.form.get("nonce", "")))
        except ValueError:
            return jsonify(error="Невірний номер запиту. Відкрийте редакцію знову."), 400
        try:
            photo = prepare_photo(upload.stream) if upload is not None else None
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            return jsonify(error="Оберіть фото JPG, PNG або WebP до 24 Мп зі співвідношенням сторін до 20:1."), 400
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            inserted = db.execute("INSERT OR IGNORE INTO submissions VALUES (?,?)", (uid, nonce))
            if inserted.rowcount:
                publish(db, text, photo)
        return jsonify(ok=True)

    return app
