import getpass
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
FEEDBACK = "💬 Скарги та пропозиції"
ANONYMOUS = "Анонімна скарга"
SIGNED = "Скарга з підписом"
IDEA = "Пропозиція з підписом"
CANCEL = "Скасувати"
MENU = {"keyboard": [[NEWS], [ON, OFF], [FEEDBACK]], "resize_keyboard": True}
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
        CREATE TABLE IF NOT EXISTS feedback_flow (chat INTEGER PRIMARY KEY, stage TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audience (
            chat INTEGER PRIMARY KEY, last_seen INTEGER NOT NULL, starts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, chat INTEGER,
            body TEXT, broadcast INTEGER);
        CREATE TABLE IF NOT EXISTS cursor_state (id INTEGER PRIMARY KEY, pos INTEGER);
        INSERT OR IGNORE INTO cursor_state VALUES (1, 0);
    """)


def parse_admin_ids(value):
    if not value.strip():
        return set()
    ids = [item.strip() for item in value.split(",")]
    if any(not item.isascii() or not item.isdecimal() or int(item) == 0 for item in ids):
        raise SystemExit("Введіть числові Telegram ID редакторів через кому.")
    return {int(item) for item in ids}


def feedback_keyboard(db, chat):
    row = db.execute("SELECT stage FROM feedback_flow WHERE chat=?", (chat,)).fetchone()
    if not row:
        return MENU
    rows = [[ANONYMOUS], [SIGNED], [IDEA], [CANCEL]] if row[0] == "choose" else [[CANCEL]]
    return {"keyboard": rows, "resize_keyboard": True}


def handle_feedback(db, chat, text, command, admin_ids, reply):
    row = db.execute("SELECT stage FROM feedback_flow WHERE chat=?", (chat,)).fetchone()
    if text == FEEDBACK or command == "/feedback":
        if not admin_ids:
            reply("Прийом звернень поки недоступний.")
            return True
        db.execute("INSERT OR REPLACE INTO feedback_flow VALUES (?, 'choose')", (chat,))
        reply("Що ви хочете надіслати редакторам 86 News?")
        return True
    if not row:
        return False
    if text == CANCEL or command.startswith("/") or text in (NEWS, ON, OFF):
        db.execute("DELETE FROM feedback_flow WHERE chat=?", (chat,))
        if text == CANCEL or command == "/cancel":
            reply("Звернення скасовано.")
            return True
        return False
    if row[0] == "choose":
        if text not in (ANONYMOUS, SIGNED, IDEA):
            reply("Оберіть тип звернення за допомогою кнопок.")
            return True
        db.execute("UPDATE feedback_flow SET stage=? WHERE chat=?", (text, chat))
        if text == ANONYMOUS:
            reply("Напишіть скаргу одним текстовим повідомленням. Редактори отримають лише текст. Для анонімності не зазначайте в ньому своє ім’я чи контакти.")
        else:
            reply("Напишіть звернення одним текстовим повідомленням. Редактори отримають текст і ваш Telegram ID.")
        return True
    if not text or len(text.encode("utf-16-le")) // 2 > 3900:
        reply("Надішліть текст до 3900 знаків або натисніть «Скасувати».")
        return True
    if text in (ANONYMOUS, SIGNED, IDEA):
        reply("Напишіть текст звернення або натисніть «Скасувати», щоб змінити тип.")
        return True
    db.execute("DELETE FROM feedback_flow WHERE chat=?", (chat,))
    if not admin_ids:
        reply("Прийом звернень поки недоступний.")
        return True
    header = row[0]
    if header != ANONYMOUS:
        header += f"\nTelegram ID автора — {chat}"
    body = f"{header}\n\n{text}"
    db.executemany("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,2)",
                   [(editor, body) for editor in admin_ids])
    reply("Звернення прийнято для надсилання редакторам.")
    return True


def handle(db, update, admin_ids):
    message = update.get("message", {})
    if message.get("chat", {}).get("type") != "private":
        return
    chat = message["chat"]["id"]
    is_editor = chat in admin_ids and message.get("from", {}).get("id") == chat
    text = message.get("text", "").strip()
    parts = text.split(maxsplit=1)
    command = parts[0] if parts else ""
    def reply(body):
        db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,0)", (chat, body))

    if handle_feedback(db, chat, text, command, admin_ids, reply):
        return
    now = int(time.time())
    db.execute("""
        INSERT INTO audience(chat, last_seen, starts) VALUES (?, ?, ?)
        ON CONFLICT(chat) DO UPDATE SET
            last_seen = MAX(last_seen, excluded.last_seen), starts = starts + excluded.starts
    """, (chat, message.get("date", now), int(command == "/start")))

    if command == "/start":
        welcome = "Вітаємо у 86 News! Тут публікуємо шкільні новини. Перегляньте останні оголошення або підпишіться, щоб отримувати нові."
        if is_editor:
            welcome += "\n\nСтатистика відвідувань — /stats."
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
    elif command == "/stats":
        if not is_editor:
            reply("Статистика доступна лише редактору. Щоб дізнатися свій Telegram ID, надішліть /id.")
            return
        total, day, week, starters = db.execute("""
            SELECT COUNT(*), COUNT(CASE WHEN last_seen >= ? THEN 1 END),
                   COUNT(CASE WHEN last_seen >= ? THEN 1 END),
                   COUNT(CASE WHEN starts > 0 THEN 1 END)
            FROM audience
        """, (now - 86400, now - 7 * 86400)).fetchone()
        subscribers = db.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0]
        reply(f"📊 Статистика 86 News\n\n"
              f"Усього користувачів від початку обліку — {total}\n"
              f"Активні за останні 24 години — {day}\n"
              f"Активні за останні 7 днів — {week}\n"
              f"Хоча б раз надіслали /start — {starters}\n"
              f"Зараз підписані — {subscribers}")
    elif command == "/post" and is_editor:
        if len(parts) < 2 or len(parts[1].encode("utf-16-le")) // 2 > 4000:
            reply("Після /post додайте текст оголошення довжиною до 4000 знаків.")
            return
        body = "📰 86 News\n\n" + parts[1]
        db.execute("INSERT INTO news(body) VALUES (?)", (body,))
        db.execute("INSERT INTO deliveries(chat,body,broadcast) SELECT chat,?,1 FROM subscribers", (body,))
        reply("Новину опубліковано.")
    else:
        reply("Оберіть дію в меню або надішліть /start.")


def run(db, api, admin_ids):
    while True:
        try:
            pos = db.execute("SELECT pos FROM cursor_state").fetchone()[0]
            pending = db.execute("SELECT 1 FROM deliveries LIMIT 1").fetchone()
            for update in api("getUpdates", offset=pos, timeout=0 if pending else 30,
                              allowed_updates=["message"]):
                with db:
                    handle(db, update, admin_ids)
                    db.execute("UPDATE cursor_state SET pos=?", (update["update_id"] + 1,))
            for row, chat, body, kind in db.execute("SELECT id,chat,body,broadcast FROM deliveries ORDER BY id LIMIT 20").fetchall():
                try:
                    if kind != 2 or chat in admin_ids:
                        api("sendMessage", chat_id=chat, text=body, reply_markup=feedback_keyboard(db, chat))
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
            time.sleep(max(1, error.delay))
        except (URLError, OSError):
            time.sleep(3)


def main(token=None, admin_text=None, status=print):
    if token is None:
        token = os.getenv("BOT_TOKEN") or getpass.getpass("Токен від BotFather: ")
    token = token.strip()
    if not token:
        raise SystemExit("Для запуску потрібен токен.")
    def api(method, **params):
        return telegram(token, method, **params)
    me = api("getMe")
    if admin_text is None:
        admin_text = os.getenv("ADMIN_ID") or input("Telegram ID редакторів через кому (Enter — режим читання): ").strip()
    admin_ids = parse_admin_ids(admin_text)
    api("setMyName", name="86 News")
    api("setMyDescription", description="Новини школи, оголошення та події. Натисніть «Розпочати», щоб переглянути публікації та підписатися.")
    api("setMyCommands", commands=[{"command": k, "description": v} for k, v in COMMANDS.items()])
    with sqlite3.connect(Path(__file__).with_name(f"news-{me['id']}.sqlite3")) as db:
        initialize(db)
        status(f"86 News працює: https://t.me/{me['username']}")
        run(db, api, admin_ids)


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        raise SystemExit(f"Помилка Telegram: {error}")
    except KeyboardInterrupt:
        print("\nБота зупинено.")
