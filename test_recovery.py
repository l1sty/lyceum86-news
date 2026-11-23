import io
import json
import sqlite3
import unittest
from unittest.mock import Mock, patch

import bot


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        bot.initialize(self.db)

    def test_unsubscribe_keeps_polls_requested_by_reader(self):
        self.db.execute("INSERT INTO polls VALUES (1, 'Коли?', ?)", (json.dumps(["А", "Б"]),))
        self.db.execute("INSERT INTO deliveries(chat,body,broadcast) VALUES (7,'1',4)")
        for text in ("/polls", "/unsubscribe"):
            bot.handle(self.db, {"message": {"chat": {"type": "private", "id": 7}, "text": text}}, set())
        pending = self.db.execute("SELECT chat,body,broadcast,photo FROM deliveries WHERE body='1'").fetchall()
        self.assertEqual(len(pending), 1)
        api = Mock(return_value={"message_id": 77, "date": int(bot.time.time())})
        bot.deliver(self.db, api, *pending[0], set())
        self.assertEqual(api.call_args.kwargs["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "vote:1:0")
        self.db.execute("INSERT INTO deleted_polls VALUES (1)")
        bot.deliver(self.db, api, *pending[0], set())
        self.assertEqual(api.call_count, 1)
        bot.remove_poll_messages(self.db, api)
        api.assert_called_with("deleteMessage", chat_id=7, message_id=77)
        self.assertEqual(bot.record_vote(self.db, {"data": "vote:1:0"}), "Опитування видалено.")

    def test_temporary_delivery_failure_keeps_queued_news(self):
        self.db.execute("INSERT INTO subscribers VALUES (7)")
        with self.db:
            bot.publish(self.db, "Новина")
        attempts = []
        def api(method, **params):
            if method == "getUpdates":
                if len(attempts) == 2:
                    raise StopIteration
                return []
            attempts.append(params["text"])
            if len(attempts) == 1:
                raise OSError("temporary connection failure")
        with patch.object(bot.time, "sleep"), self.assertRaises(StopIteration):
            bot.run(self.db, api, set())
        self.assertEqual(attempts, ["📰 86 News\n\nНовина"] * 2)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM deliveries").fetchone()[0], 0)


class TelegramRecoveryTests(unittest.TestCase):
    def test_incomplete_success_response_is_retryable(self):
        for payload in (b"", b"null", b"{}", b'{"ok":true}'):
            with self.subTest(payload=payload), patch.object(bot, "urlopen", return_value=io.BytesIO(payload)):
                with self.assertRaises(OSError):
                    bot.telegram("dummy", "getUpdates")

    def test_startup_recovers_from_outage_and_rate_limit(self):
        expected = {"id": 9, "username": "test_bot"}
        api = Mock(side_effect=[OSError(), bot.ApiError({"error_code": 503}),
                                bot.ApiError({"error_code": 429, "parameters": {"retry_after": 77}}), expected])
        with patch.object(bot.time, "sleep") as sleep:
            self.assertEqual(bot.get_identity(api, Mock()), expected)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [3, 3, 77])
        with self.assertRaises(bot.ApiError):
            bot.get_identity(Mock(side_effect=bot.ApiError({"error_code": 401})), Mock())


if __name__ == "__main__":
    unittest.main()
