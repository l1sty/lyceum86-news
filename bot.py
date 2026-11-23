from contextlib import closing
import json
from http.client import IncompleteRead
import os
import sqlite3
import time
import threading
import secrets
import requests
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
EDITOR = "✎ Редакція"
TRACK = "Статус звернення"
POLLS = "Опитування"
POLL_BROADCAST = 4
POLL_REQUEST = 5
MENU = {"keyboard": [[NEWS, POLLS], [FEEDBACK, TRACK], [ON, OFF]], "resize_keyboard": True}
COMMANDS = {"start": "Відкрити меню", "news": "Останні новини школи",
            "subscribe": "Підписатися на новини", "unsubscribe": "Скасувати підписку",
            "id": "Дізнатися свій Telegram ID"}


class ApiError(Exception):
    def __init__(self, data):
        self.code = data["error_code"]
        self.delay = data.get("parameters", {}).get("retry_after", 3)
        super().__init__(data.get("description", "Помилка Telegram"))


def telegram_result(data, http_status=200):
    if isinstance(data, dict):
        if data.get("ok") is True and "result" in data:
            return data["result"]
        if isinstance(data.get("error_code"), int):
            raise ApiError(data)
    if http_status >= 400:
        raise ApiError({"error_code": http_status})
    raise OSError("Telegram повернув неповну відповідь.")


def telegram(token, method, **params):
    request = Request(f"https://api.telegram.org/bot{token}/{method}",
                      data=json.dumps(params).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=50) as response:
            return telegram_result(json.load(response))
    except HTTPError as error:
        try:
            return telegram_result(json.loads(error.read()), error.code)
        except (ValueError, IncompleteRead):
            raise ApiError({"error_code": error.code}) from None
    except (ValueError, IncompleteRead):
        raise OSError("Telegram повернув неповну відповідь.") from None


def get_identity(api, status):
    while True:
        try:
            return api("getMe")
        except ApiError as error:
            if error.code != 429 and error.code < 500:
                raise
            delay = max(1, error.delay)
        except OSError:
            delay = 3
        status(f"Очікуємо на Telegram. Наступна спроба через {delay} с.")
        time.sleep(delay)


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
        CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY, data BLOB, file_id TEXT);
        CREATE TABLE IF NOT EXISTS cases (code TEXT PRIMARY KEY, body TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'Отримано', answer TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY, question TEXT NOT NULL, options TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deleted_polls (id INTEGER PRIMARY KEY);
        CREATE VIEW IF NOT EXISTS active_polls AS
            SELECT * FROM polls WHERE id NOT IN (SELECT id FROM deleted_polls);
        CREATE TABLE IF NOT EXISTS poll_messages (
            poll INTEGER, chat INTEGER, message INTEGER, sent INTEGER, PRIMARY KEY(chat,message));
        CREATE INDEX IF NOT EXISTS poll_messages_poll ON poll_messages(poll);
        CREATE INDEX IF NOT EXISTS poll_messages_sent ON poll_messages(sent);
        CREATE TABLE IF NOT EXISTS votes (poll INTEGER, voter INTEGER, choice INTEGER, PRIMARY KEY(poll,voter));
        CREATE TABLE IF NOT EXISTS submissions (editor INTEGER, nonce TEXT, PRIMARY KEY(editor,nonce));
    """)
    for table in ("news", "deliveries"):
        if "photo" not in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN photo INTEGER")


def publish(db, text, photo=None):
    photo_id = None
    if photo:
        photo_id = db.execute("INSERT INTO photos(data) VALUES (?)", (photo,)).lastrowid
    body = "📰 86 News\n\n" + text
    db.execute("INSERT INTO news(body,photo) VALUES (?,?)", (body, photo_id))
    db.execute("INSERT INTO deliveries(chat,body,broadcast,photo) SELECT chat,?,1,? FROM subscribers",
               (body, photo_id))


def panel_url():
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    return os.getenv("MINI_APP_URL") or (f"https://{domain}" if domain else "")


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
    if text == TRACK or command == "/status":
        db.execute("INSERT OR REPLACE INTO feedback_flow VALUES (?, 'lookup')", (chat,))
        reply("Введіть приватний код звернення.")
        return True
    if text == FEEDBACK or command == "/feedback":
        if not admin_ids:
            reply("Прийом звернень поки недоступний.")
            return True
        db.execute("INSERT OR REPLACE INTO feedback_flow VALUES (?, 'choose')", (chat,))
        reply("Що ви хочете надіслати редакторам 86 News?")
        return True
    if not row:
        return False
    if text == CANCEL or command.startswith("/") or text in (NEWS, ON, OFF, POLLS, EDITOR):
        db.execute("DELETE FROM feedback_flow WHERE chat=?", (chat,))
        if text == CANCEL or command == "/cancel":
            reply("Звернення скасовано.")
            return True
        return False
    if row[0] == "lookup":
        case = db.execute("SELECT state,answer FROM cases WHERE code=?", (text.strip().upper(),)).fetchone()
        if case:
            db.execute("DELETE FROM feedback_flow WHERE chat=?", (chat,))
            reply(f"Статус звернення — {case[0]}" + (f"\n\nВідповідь редакції\n{case[1]}" if case[1] else ""))
        else:
            reply("Звернення за цим кодом не знайдено. Перевірте код або натисніть «Скасувати».")
        return True
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
    code = secrets.token_hex(8).upper()
    case_id = db.execute("INSERT INTO cases(code,body) VALUES (?,?)", (code, body)).lastrowid
    db.executemany("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,2)",
                   [(editor, f"Звернення №{case_id}\n{body}") for editor in admin_ids])
    reply(f"Звернення прийнято. Ваш приватний код:\n{code}\n\nЗбережіть його для кнопки «Статус звернення». За кодом можна прочитати відповідь.")
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
    def reply(body, photo=None):
        db.execute("INSERT INTO deliveries(chat,body,broadcast,photo) VALUES (?,?,0,?)", (chat, body, photo))

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
        db.execute("DELETE FROM deliveries WHERE chat=? AND broadcast IN (1,4)", (chat,))
        reply("Підписку вимкнено. Новини залишаються доступними в меню.")
    elif text in (NEWS, "/news"):
        items = db.execute("SELECT body,photo FROM news ORDER BY id DESC LIMIT 3").fetchall()
        for body, photo in reversed(items):
            reply(body, photo)
        if not items:
            reply("Шкільних новин поки немає. Підпишіться, щоб отримати перше оголошення.")
    elif command == "/admin" or text == EDITOR:
        if not is_editor:
            reply("Панель доступна лише редакторам.")
        elif not panel_url().startswith("https://"):
            reply("У Railway підключіть публічний HTTPS-домен до сервісу бота.")
        else:
            db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,3)",
                       (chat, "Відкрийте редакцію, щоб підготувати новину."))
    elif command == "/polls" or text == POLLS:
        polls = db.execute("SELECT id FROM active_polls ORDER BY id DESC LIMIT 5").fetchall()
        for poll, in reversed(polls):
            db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,?)", (chat, str(poll), POLL_REQUEST))
        if not polls:
            reply("Поки немає опитувань.")
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
        publish(db, parts[1])
        reply("Новину опубліковано.")
    else:
        reply("Оберіть дію в меню або надішліть /start.")


def deliver(db, api, chat, body, kind, photo, admin_ids):
    if kind in (POLL_BROADCAST, POLL_REQUEST):
        row = db.execute("SELECT question,options FROM active_polls WHERE id=?", (body,)).fetchone()
        if row is None:
            return
        question, options = row
        buttons = [[{"text": option, "callback_data": f"vote:{body}:{i}"}] for i, option in enumerate(json.loads(options))]
        message = api("sendMessage", chat_id=chat, text=question, reply_markup={"inline_keyboard": buttons})
        db.execute("INSERT INTO poll_messages VALUES (?,?,?,?)",
                   (body, chat, message["message_id"], message["date"]))
        return
    if kind in (2, 3) and chat not in admin_ids:
        return
    markup = feedback_keyboard(db, chat)
    if kind == 3:
        markup = {"inline_keyboard": [[{"text": "Відкрити редакцію", "web_app": {"url": panel_url()}}]]}
    elif chat in admin_ids and markup is MENU:
        markup = dict(MENU, keyboard=MENU["keyboard"] + [[EDITOR]])
    if photo is None:
        api("sendMessage", chat_id=chat, text=body, reply_markup=markup)
        return
    file_id, = db.execute("SELECT file_id FROM photos WHERE id=?", (photo,)).fetchone()
    if file_id:
        api("sendPhoto", chat_id=chat, caption=body, photo=file_id, reply_markup=markup)
    else:
        data, = db.execute("SELECT data FROM photos WHERE id=?", (photo,)).fetchone()
        result = api("sendPhoto", chat_id=chat, caption=body, photo=data, reply_markup=markup)
        db.execute("UPDATE photos SET file_id=?, data=NULL WHERE id=?", (result["photo"][-1]["file_id"], photo))


def record_vote(db, callback):
    parts = callback.get("data", "").split(":")
    if len(parts) != 3 or parts[0] != "vote" or not all(p.isascii() and p.isdecimal() and len(p) < 19 for p in parts[1:]):
        return "Невідома дія."
    poll, choice = map(int, parts[1:])
    row = db.execute("SELECT options FROM active_polls WHERE id=?", (poll,)).fetchone()
    if row is None:
        return "Опитування видалено."
    options = json.loads(row[0])
    if choice >= len(options):
        return "Варіант недоступний."
    if not db.execute("INSERT INTO votes SELECT id,?,? FROM active_polls WHERE id=? "
                      "ON CONFLICT(poll,voter) DO UPDATE SET choice=excluded.choice",
                      (callback["from"]["id"], choice, poll)).rowcount:
        return "Опитування видалено."
    return "Ваш голос зараховано: " + options[choice]


def remove_poll_messages(db, api):
    with db:
        db.execute("DELETE FROM poll_messages WHERE sent<=?", (int(time.time()) - 48 * 3600,))
    rows = db.execute("SELECT chat,message FROM poll_messages WHERE poll IN "
                      "(SELECT id FROM deleted_polls) LIMIT 20").fetchall()
    for chat, message in rows:
        try:
            api("deleteMessage", chat_id=chat, message_id=message)
        except ApiError as error:
            if error.code not in (400, 403):
                raise
        with db:
            db.execute("DELETE FROM poll_messages WHERE chat=? AND message=?", (chat, message))


def run(db, api, admin_ids):
    while True:
        try:
            pos = db.execute("SELECT pos FROM cursor_state").fetchone()[0]
            pending = db.execute("SELECT 1 FROM deliveries LIMIT 1").fetchone()
            for update in api("getUpdates", offset=pos, timeout=0 if pending else 30,
                              allowed_updates=["message", "callback_query"]):
                callback = update.get("callback_query")
                with db:
                    if callback:
                        notice = record_vote(db, callback)
                    else:
                        handle(db, update, admin_ids)
                    db.execute("UPDATE cursor_state SET pos=?", (update["update_id"] + 1,))
                if callback:
                    try:
                        api("answerCallbackQuery", callback_query_id=callback["id"], text=notice)
                    except ApiError as error:
                        if error.code != 400:
                            raise
            remove_poll_messages(db, api)
            for row, chat, body, kind, photo in db.execute("SELECT id,chat,body,broadcast,photo FROM deliveries ORDER BY id LIMIT 20").fetchall():
                try:
                    deliver(db, api, chat, body, kind, photo, admin_ids)
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
        if isinstance(params.get("photo"), bytes):
            files = {"photo": ("news.jpg", params.pop("photo"), "image/jpeg")}
            params["reply_markup"] = json.dumps(params["reply_markup"])
            try:
                response = requests.post(f"https://api.telegram.org/bot{token}/sendPhoto", data=params, files=files, timeout=50)
                try:
                    result = response.json()
                except requests.exceptions.JSONDecodeError:
                    result = None
            except requests.RequestException:
                raise OSError("Помилка зв’язку з Telegram") from None
            return telegram_result(result, response.status_code)
        return telegram(token, method, **params)
    if admin_text is None:
        admin_text = os.getenv("ADMIN_ID", "").strip()
    admin_ids = parse_admin_ids(admin_text)
    volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    if not volume:
        raise SystemExit("Підключіть Volume до сервісу бота в Railway та повторіть запуск.")
    me = get_identity(api, status)
    database = Path(volume) / f"news-{me['id']}.sqlite3"
    with closing(sqlite3.connect(database)) as db:
        initialize(db)
        from panel import create_panel
        from waitress import create_server
        server = create_server(create_panel(database, token, admin_ids, publish), host="0.0.0.0",
                               port=int(os.getenv("PORT", "8080")), max_request_body_size=9*1024*1024)
        threading.Thread(target=server.run, daemon=True).start()
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
                if error.code in (401, 404):
                    raise
                status(f"Оформлення профілю відкладено ({method}, Telegram {error.code}).")
                retry_at = time.time() + max(1, error.delay)
            except OSError:
                status(f"Оформлення профілю відкладено ({method}).")
                retry_at = time.time() + 3
            with db:
                db.execute("INSERT OR REPLACE INTO profile_setup VALUES (?,?)", (method, retry_at))
            if retry_at is not None:
                break
        status(f"86 News працює: https://t.me/{me['username']}")
        run(db, api, admin_ids)


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        raise SystemExit(f"Помилка Telegram: {error}")
    except KeyboardInterrupt:
        print("\nБота зупинено.")
