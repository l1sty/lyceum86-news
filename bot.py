from contextlib import closing
import json
import os
import sqlite3
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


NEWS = "📰 Останні новини"
ON = "🔔 Підписатися"
OFF = "🔕 Відписатися"
MENU = {"keyboard": [[NEWS], [ON, OFF]], "resize_keyboard": True}
COMMANDS = {"start": "Відкрити меню", "news": "Останні новини школи",
            "subscribe": "Підписатися на новини", "unsubscribe": "Скасувати підписку",
            "id": "Дізнатися свій Telegram ID"}


class ApiError(Exception):
    def __init__(self, data):
        self.code = data["error_code"]
        self.delay = data.get("parameters", {}).get("retry_after", 3)
        super().__init__(data.get("description", "Помилка Telegram"))


def telegram(token, method, **params):
    request = Request(f"https://api.telegram.org/bot{token}/{method}",
                      data=json.dumps(params).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=50) as response:
            data = json.load(response)
    except HTTPError as error:
        try:
            data = json.loads(error.read())
        except ValueError:
            raise ApiError({"error_code": error.code}) from None
    if not data.get("ok"):
        raise ApiError(data)
    return data["result"]


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS subscribers (chat INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, chat INTEGER,
            body TEXT, broadcast INTEGER);
        CREATE TABLE IF NOT EXISTS cursor_state (id INTEGER PRIMARY KEY, pos INTEGER);
        INSERT OR IGNORE INTO cursor_state VALUES (1, 0);
    """)


def handle(db, update, admin):
    message = update.get("message", {})
    if message.get("chat", {}).get("type") != "private":
        return
    chat = message["chat"]["id"]
    text = message.get("text", "").strip()
    parts = text.split(maxsplit=1)
    command = parts[0] if parts else ""
    def reply(body):
        db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,0)", (chat, body))

    if command == "/start":
        welcome = "Вітаємо у 86 News! Тут публікуємо шкільні новини. Перегляньте останні оголошення або підпишіться, щоб отримувати нові."
        if chat == admin:
            welcome += "\n\nЩоб опублікувати новину, надішліть /post і текст оголошення одним повідомленням."
        reply(welcome)
    elif text in (ON, "/subscribe"):
        db.execute("INSERT OR IGNORE INTO subscribers VALUES (?)", (chat,))
        reply("Підписку увімкнено. Нові оголошення надходитимуть сюди.")
    elif text in (OFF, "/unsubscribe"):
        db.execute("DELETE FROM subscribers WHERE chat=?", (chat,))
        db.execute("DELETE FROM deliveries WHERE chat=? AND broadcast=1", (chat,))
        reply("Підписку вимкнено. Новини залишаються доступними в меню.")
    elif text in (NEWS, "/news"):
        items = db.execute("SELECT body FROM news ORDER BY id DESC LIMIT 3").fetchall()
        for body, in reversed(items):
            reply(body)
        if not items:
            reply("Шкільних новин поки немає. Підпишіться, щоб отримати перше оголошення.")
    elif command == "/id":
        reply(f"Ваш Telegram ID — {chat}")
    elif command == "/post" and chat == admin and message.get("from", {}).get("id") == admin:
        if len(parts) < 2 or len(parts[1].encode("utf-16-le")) // 2 > 4000:
            reply("Після /post додайте текст оголошення довжиною до 4000 знаків.")
            return
        body = "📰 86 News\n\n" + parts[1]
        db.execute("INSERT INTO news(body) VALUES (?)", (body,))
        db.execute("INSERT INTO deliveries(chat,body,broadcast) SELECT chat,?,1 FROM subscribers", (body,))
        reply("Новину опубліковано.")
    else:
        reply("Оберіть дію в меню або надішліть /start.")


def run(db, api, admin):
    while True:
        try:
            pos = db.execute("SELECT pos FROM cursor_state").fetchone()[0]
            pending = db.execute("SELECT 1 FROM deliveries LIMIT 1").fetchone()
            for update in api("getUpdates", offset=pos, timeout=0 if pending else 30,
                              allowed_updates=["message"]):
                with db:
                    handle(db, update, admin)
                    db.execute("UPDATE cursor_state SET pos=?", (update["update_id"] + 1,))
            for row, chat, body in db.execute("SELECT id,chat,body FROM deliveries ORDER BY id LIMIT 20").fetchall():
                try:
                    api("sendMessage", chat_id=chat, text=body, reply_markup=MENU)
                except ApiError as error:
                    if error.code not in (400, 403):
                        raise
                    print(f"Доставку пропущено (Telegram {error.code}).")
                    if error.code == 403:
                        db.execute("DELETE FROM subscribers WHERE chat=?", (chat,))
                with db:
                    db.execute("DELETE FROM deliveries WHERE id=?", (row,))
                time.sleep(0.06)
        except ApiError as error:
            if error.code in (401, 404, 409):
                raise SystemExit(str(error))
            if error.code == 429:
                print(f"Telegram тимчасово обмежив запити. Повтор через {error.delay} с.")
            time.sleep(max(1, error.delay))
        except (URLError, OSError):
            time.sleep(3)


def main(token=None, admin_text=None, status=print):
    if token is None:
        token = os.getenv("BOT_TOKEN", "")
    token = token.strip()
    if not token:
        raise SystemExit("Для запуску потрібен токен.")
    def api(method, **params):
        return telegram(token, method, **params)
    if admin_text is None:
        admin_text = os.getenv("ADMIN_ID", "").strip()
    if admin_text and not admin_text.isdecimal():
        raise SystemExit("Telegram ID має складатися з цифр.")
    admin = int(admin_text) if admin_text else None
    volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    if not volume:
        raise SystemExit("Підключіть Volume до сервісу бота в Railway та повторіть запуск.")
    while True:
        try:
            me = api("getMe")
            break
        except ApiError as error:
            if error.code != 429:
                raise
            status(f"Telegram обмежив getMe. Повтор через {error.delay} с.")
            time.sleep(max(1, error.delay))
    with closing(sqlite3.connect(Path(volume) / f"news-{me['id']}.sqlite3")) as db:
        initialize(db)
        db.execute("CREATE TABLE IF NOT EXISTS profile_setup (method TEXT PRIMARY KEY, retry_at REAL)")
        settings = {
            "setMyName": {"name": "86 News"},
            "setMyDescription": {"description": "Новини школи, оголошення та події. Натисніть «Розпочати», щоб переглянути публікації та підписатися."},
            "setMyCommands": {"commands": [{"command": k, "description": v} for k, v in COMMANDS.items()]},
        }
        for method, params in settings.items():
            row = db.execute("SELECT retry_at FROM profile_setup WHERE method=?", (method,)).fetchone()
            if row and (row[0] is None or row[0] > time.time()):
                continue
            retry_at = None
            try:
                api(method, **params)
            except ApiError as error:
                if error.code != 429:
                    raise
                status(f"Telegram обмежив {method} на {error.delay} с. Продовжуємо запуск.")
                retry_at = time.time() + max(1, error.delay)
            with db:
                db.execute("INSERT OR REPLACE INTO profile_setup VALUES (?,?)", (method, retry_at))
            if retry_at is not None:
                break
        status(f"86 News працює: https://t.me/{me['username']}")
        run(db, api, admin)


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        raise SystemExit(f"Помилка Telegram: {error}")
    except KeyboardInterrupt:
        print("\nБота зупинено.")
