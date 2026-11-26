import secrets

CASE_REPLY = 11


def initialize_routes(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS case_recipients(case_id INTEGER PRIMARY KEY, chat INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS case_messages(editor INTEGER, message INTEGER, case_id INTEGER NOT NULL,
            PRIMARY KEY(editor,message));
    """)


def save_case(db, chat, header, text, admin_ids):
    if header != "Анонімна скарга":
        header += f"\nTelegram ID автора — {chat}"
    body = f"{header}\n\n{text}"
    code = secrets.token_hex(8).upper()
    case_id = db.execute("INSERT INTO cases(code,body) VALUES (?,?)", (code, body)).lastrowid
    db.execute("INSERT INTO case_recipients VALUES (?,?)", (case_id, chat))
    notice = f"Звернення №{case_id}\nЩоб відповісти автору, натисніть «Відповісти».\n\n{body}"
    db.executemany("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,2)",
                   [(editor, notice) for editor in admin_ids])
    return code


def remember_notice(db, editor, body, sent):
    number = body.split("\n", 1)[0].removeprefix("Звернення №")
    if number.isascii() and number.isdecimal() and len(number) <= 18:
        db.execute("INSERT OR REPLACE INTO case_messages VALUES (?,?,?)",
                   (editor, sent["message_id"], int(number)))


def answer_case(db, editor, message, reply):
    original = message.get("reply_to_message", {})
    row = db.execute("""SELECT m.case_id,r.chat FROM case_messages m
        LEFT JOIN case_recipients r USING(case_id) WHERE m.editor=? AND m.message=?""",
                     (editor, original.get("message_id"))).fetchone()
    if not row:
        return False
    case_id, chat = row
    text = message.get("text", "").strip()
    if chat is None:
        reply("Для цього старого звернення немає адреси доставки. Дайте відповідь у редакції за приватним кодом.")
    elif not text or len(text.encode("utf-16-le")) // 2 > 3900:
        reply("Відповідайте текстом до 3900 знаків.")
    else:
        db.execute("UPDATE cases SET state='Є відповідь',answer=?,version=version+1 WHERE rowid=?", (text, case_id))
        db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (?,?,?)",
                   (chat, f"Відповідь редакції на звернення №{case_id}\n\n{text}", CASE_REPLY))
        reply(f"Відповідь на звернення №{case_id} збережено й додано до надсилання.")
    return True
