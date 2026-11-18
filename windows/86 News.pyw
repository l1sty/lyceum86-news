import queue
import threading
import tkinter as tk
from tkinter import ttk

import bot


def launch():
    root = tk.Tk()
    root.title("86 News")
    frame = ttk.Frame(root, padding=20)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Токен від BotFather").pack(anchor="w")
    token = ttk.Entry(frame, width=50, show="*")
    token.pack(fill="x")
    def paste():
        try:
            value = root.clipboard_get().strip()
        except tk.TclError:
            status.set("Спершу скопіюйте токен у BotFather.")
            return
        token.delete(0, "end")
        token.insert(0, value)
    ttk.Button(frame, text="Вставити токен", command=paste).pack(anchor="w")
    ttk.Label(frame, text="Telegram ID редакторів через кому (за бажанням)").pack(anchor="w", pady=(14, 0))
    admin = ttk.Entry(frame)
    admin.pack(fill="x")
    status = tk.StringVar(value="Без ID бот працюватиме в режимі читання.")
    events = queue.Queue()
    def worker(key, editor):
        try:
            bot.main(key, editor, lambda msg: events.put((msg, False)))
        except (bot.ApiError, SystemExit) as error:
            events.put((f"Помилка запуску: {error}", True))
        except Exception:
            events.put(("Не вдалося запустити бота. Перевірте токен, інтернет і доступ до папки.", True))
    def start():
        key, editor = token.get().strip(), admin.get().strip()
        if not key or ":" not in key:
            status.set("Вставте повний токен від BotFather.")
            return
        button.state(["disabled"])
        status.set("Підключення до Telegram…")
        threading.Thread(target=worker, args=(key, editor), daemon=True).start()
    def poll():
        while not events.empty():
            message, failed = events.get_nowait()
            status.set(message)
            if failed:
                button.state(["!disabled"])
        root.after(200, poll)
    button = ttk.Button(frame, text="Запустити", command=start)
    button.pack(anchor="w", pady=12)
    ttk.Label(frame, textvariable=status, wraplength=420).pack(anchor="w")
    token.focus()
    poll()
    root.mainloop()


if __name__ == "__main__":
    launch()
