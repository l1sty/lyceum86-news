import queue
import threading
import tkinter as tk
from tkinter import ttk

import bot


def launch():
    root = tk.Tk()
    root.title("86 News · Запуск бота")
    style = ttk.Style(root)
    if "clam" in style.theme_names():
        style.theme_use("clam")
    paper, ink, muted, accent = "#f6f5f0", "#202322", "#565d59", "#334d69"
    style.configure(".", font=("Segoe UI", 10), background=paper, foreground=ink)
    style.configure("Title.TLabel", font=("Georgia", 22), padding=(0, 0, 0, 16))
    style.configure("Note.TLabel", foreground=muted)
    style.configure("TEntry", padding=7, fieldbackground="#fffefa")
    style.configure("TButton", padding=(12, 7))
    style.configure("Primary.TButton", background=accent, foreground="white")
    style.map("Primary.TButton", background=[("disabled", "#d6d6cd"), ("pressed", "#25364b"), ("active", "#3d5978")],
              foreground=[("disabled", muted)])
    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Запуск бота", style="Title.TLabel").pack(anchor="w")
    ttk.Label(frame, text="Токен від BotFather").pack(anchor="w")
    token = ttk.Entry(frame, width=40, show="*")
    token.pack(fill="x")
    def paste():
        try:
            value = root.clipboard_get().strip()
        except tk.TclError:
            status.set("Спершу скопіюйте токен у BotFather.")
            return
        token.delete(0, "end")
        token.insert(0, value)
    ttk.Button(frame, text="Вставити токен", command=paste).pack(anchor="w", pady=(6, 0))
    admin_label = ttk.Label(frame, text="Telegram ID редакторів через кому (за бажанням)", wraplength=360)
    admin_label.pack(anchor="w", pady=(14, 0))
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
        if button.instate(["disabled"]):
            return
        key, editor = token.get().strip(), admin.get().strip()
        if not key or ":" not in key:
            token.focus_set()
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
    button = ttk.Button(frame, text="Запустити", style="Primary.TButton", command=start)
    button.pack(anchor="w", pady=12)
    note = ttk.Label(frame, textvariable=status, style="Note.TLabel", wraplength=380)
    note.pack(fill="x")
    def fit_labels(event):
        width = max(180, event.width - 48)
        for label in (admin_label, note):
            label.configure(wraplength=width)
        root.after_idle(lambda: root.minsize(340, frame.winfo_reqheight()))
    frame.bind("<Configure>", fit_labels)
    for field in (token, admin):
        field.bind("<Return>", lambda event: start())
    root.minsize(340, 320)
    token.focus()
    poll()
    root.mainloop()


if __name__ == "__main__":
    launch()
