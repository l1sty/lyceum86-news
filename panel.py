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

from flask import Flask, jsonify, request, send_file
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

    @app.get("/")
    def index():
        return send_file(Path(__file__).with_name("editor.html"), max_age=0)

    @app.route("/api/editor", methods=["GET", "POST"])
    def editor():
        uid = editor_id(request.headers.get("X-Telegram-Init-Data", ""), token, admins)
        if uid is None:
            return jsonify(error="Відкрийте панель з чату бота через /admin з облікового запису редактора."), 403
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
