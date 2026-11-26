import sqlite3
import unittest
from unittest.mock import Mock

import bot


class CaseReplies(unittest.TestCase):
    def test_private_reply_from_matching_editor_message(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        bot.initialize(db)
        code = bot.save_case(db, 100, bot.ANONYMOUS, "Прошу допомогти", {7, 8})
        notice, = db.execute("SELECT body FROM deliveries WHERE chat=7").fetchone()
        self.assertNotIn("100", notice)
        bot.deliver(db, Mock(return_value={"message_id": 42}), 7, notice, 2, None, {7, 8})
        for sender in (8, 99, 7):
            message = {"chat": {"id": sender, "type": "private"}, "from": {"id": sender},
                       "reply_to_message": {"message_id": 42}, "text": "Ми отримали звернення."}
            bot.handle(db, {"message": message}, {7, 8})
        rows = db.execute("SELECT chat,body FROM deliveries WHERE broadcast=11").fetchall()
        self.assertEqual(rows, [(100, "Відповідь редакції на звернення №1\n\nМи отримали звернення.")])
        self.assertEqual(db.execute("SELECT state,answer,version FROM cases WHERE code=?", (code,)).fetchone(),
                         ("Є відповідь", "Ми отримали звернення.", 1))
