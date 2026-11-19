from contextlib import closing
import hashlib
import hmac
import io
import json
from pathlib import Path
import sqlite3
import time
from urllib.parse import parse_qsl
from uuid import UUID

from flask import Flask, g, jsonify, request, send_file
from PIL import Image, ImageOps, UnidentifiedImageError


def editor_id(raw, token, admins):
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
        uid = json.loads(fields["user"])["id"]
        return uid if -30 <= age <= 3600 and type(uid) is int and uid in admins else None
    except (ValueError, KeyError, TypeError):
        return None


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


def create_panel(database, token, admins, publish):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 9 * 1024 * 1024

    def page_cursor():
        last_id = 2**63 - 1
        before = request.args.get("before", last_id, type=int)
        return max(0, min(before, last_id))

    @app.before_request
    def authorize():
        if request.path.startswith("/api/"):
            g.editor = editor_id(request.headers.get("X-Telegram-Init-Data", ""), token, admins)
            if g.editor is None:
                return jsonify(error="Відкрийте редакцію через /admin з облікового запису редактора."), 403

    @app.after_request
    def cache_policy(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/api/polls", methods=["GET", "POST"])
    def polls():
        with closing(sqlite3.connect(database, timeout=15)) as db, db:
            if request.method == "GET":
                items = []
                rows = db.execute("SELECT id,question,options FROM polls WHERE id<? ORDER BY id DESC LIMIT 21", (page_cursor(),)).fetchall()
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
    def index():
        return send_file(Path(__file__).with_name("editor.html"), max_age=0)

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
