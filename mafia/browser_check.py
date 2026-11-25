"""Run from the project root: python -m mafia.browser_check (requires Playwright Chromium)."""
import os
import threading
from contextlib import closing
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from urllib.parse import urlencode

from playwright.sync_api import expect, sync_playwright
from waitress import create_server

from mafia import web
from panel import create_panel
from test_game import TOKEN, signed


def run():
    with TemporaryDirectory() as temp, sync_playwright() as pw:
        database = Path(temp) / "local.sqlite"
        app = create_panel(database, TOKEN, set(), None)
        server = create_server(app, host="127.0.0.1", port=0)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        browser = pw.chromium.launch(executable_path=os.getenv("MAFIA_TEST_CHROME") or None)
        url = f"http://127.0.0.1:{server.effective_port}/mafia/"
        errors = []
        pages = {}

        def open_client(uid):
            ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
            # Optional cached copy of the official Telegram SDK for offline test runs.
            if sdk := os.getenv("MAFIA_TEST_SDK"):
                ctx.route("https://telegram.org/js/telegram-web-app.js**",
                          lambda route: route.fulfill(path=sdk, content_type="text/javascript"))
            page = ctx.new_page()
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            page.goto(url + "#" + urlencode(dict(tgWebAppData=signed(uid), tgWebAppVersion="8.0", tgWebAppPlatform="web")))
            pages[uid] = page
            return page

        def button(page, name):
            return page.get_by_role("button", name=name, exact=True)

        def check_layout(page):
            for width, height in ((320,568),(375,667),(430,932),(844,390),(360,350)):
                page.set_viewport_size({"width":width,"height":height})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width,height)
                assert page.locator("button:visible, input:visible, select:visible").evaluate_all(
                    "(items) => items.every(el => {const b=el.getBoundingClientRect();"
                    "return b.left >= -1 && b.right <= innerWidth+1})"), (width,height)
            page.set_viewport_size({"width":390,"height":844})

        def check_music(page):
            assert page.locator("audio").evaluate("a => a.paused")
            button(page,"Увімкнути музику").click()
            page.wait_for_function("document.querySelector('audio').currentTime > 0.05")
            slider = page.get_by_role("slider",name="Гучність музики")
            slider.press("Home")
            slider.press("ArrowRight")
            expect(slider).to_have_value("1")
            assert page.evaluate("localStorage.getItem('mafia-music-volume')") == "0.01"
            check_layout(page)
            page.evaluate("Telegram.WebView.receiveEvent('visibility_changed',{is_visible:false})")
            page.wait_for_function("document.querySelector('audio').paused")
            page.evaluate("Telegram.WebView.receiveEvent('visibility_changed',{is_visible:true})")
            page.wait_for_function("!document.querySelector('audio').paused")
            page.locator("audio").evaluate("a => a.currentTime = a.duration - .15")
            page.wait_for_function("document.querySelector('audio').currentTime < 2")
            button(page,"Вимкнути музику").click()
            assert page.locator("audio").evaluate("a => a.paused")

        def enter(uid, watch=False):
            page = open_client(uid)
            button(page, "Увійти за кодом").click()
            page.get_by_label("Код кімнати").fill(code)
            if watch:
                page.get_by_label("Увійти як спостерігач").check()
            button(page, "Увійти в кімнату").click()
            expect(page.get_by_text(code, exact=True)).to_be_visible()
            return page

        def advance(expected):
            with closing(sqlite3.connect(database)) as db:
                due, = db.execute("SELECT due FROM mafia_rooms WHERE code=?", (code,)).fetchone()
            web.tick(database, due)
            expect(host.get_by_role("heading",name=expected,exact=True)).to_be_visible()
            check_layout(host)

        def shot(page, name):
            if directory := os.getenv("MAFIA_TEST_SCREENSHOTS"):
                page.screenshot(path=str(Path(directory) / (name + ".png")))

        try:
            host = open_client(1)
            expect(button(host,"Створити кімнату")).to_be_enabled()
            check_music(host)
            host.evaluate("""Telegram.WebView.receiveEvent('safe_area_changed',{top:18,left:8,right:8,bottom:14});
                Telegram.WebView.receiveEvent('content_safe_area_changed',{top:22,left:0,right:0,bottom:4})""")
            assert host.locator(".brandbar").bounding_box()["y"] >= 40
            check_layout(host)
            host.evaluate("""Telegram.WebView.receiveEvent('safe_area_changed',{top:0,left:0,right:0,bottom:0});
                Telegram.WebView.receiveEvent('content_safe_area_changed',{top:0,left:0,right:0,bottom:0})""")
            shot(host,"mafia-mobile")
            host.set_viewport_size({"width":1280,"height":900})
            shot(host,"mafia-desktop")
            host.set_viewport_size({"width":390,"height":844})
            button(host,"Дон").click()
            expect(host.get_by_text("Очолюєте мафію.",exact=False)).to_be_visible()
            button(host,"Грати").click()
            button(host,"Створити кімнату").click()
            code = host.locator(".room-code strong").inner_text()
            check_layout(host)
            for uid in range(2,7):
                enter(uid)
            spectator = enter(7,True)
            for uid in range(1,7):
                button(pages[uid],"Я готовий / готова").click()
            shot(host,"mafia-lobby")
            button(host,"Почати партію").click()
            roles = {}
            for uid in range(1,7):
                page = pages[uid]
                button(page,"Відкрити свою роль").click()
                role = page.locator(".role-card h2").inner_text()
                roles.setdefault(role,[]).append(uid)
            shot(host,"mafia-role")
            check_layout(host)
            assert not button(spectator,"Відкрити свою роль").count()
            don, maf, detective, doctor = [roles[k][0] for k in ("Дон","Мафія","Детектив","Лікар")]
            advance("Місто засинає")
            def choose(uid, title, target):
                page = pages[uid]
                group=page.locator(".choices").filter(has=page.get_by_role("heading",name=title,exact=True))
                item=group.get_by_role("button",name=f"Учень {target}",exact=False)
                item.click()
                expect(item).to_have_attribute("aria-pressed","true")
            for uid in (don,maf):
                choose(uid,"Оберіть жертву", detective)
            choose(don,"Кого перевірити?",detective)
            choose(detective,"Кого перевірити?",don)
            choose(doctor,"Кого захистити?",detective)
            advance("Після ночі")
            expect(host.get_by_text("Усі залишаються за столом")).to_be_visible()
            advance("Місто прокидається")
            pages[detective].reload()
            expect(pages[detective].get_by_role("heading",name="Обговорення")).to_be_visible()
            pages[detective].get_by_label("Ваше повідомлення").fill("Пропоную перевірити голоси.")
            button(pages[detective],"Надіслати").click()
            expect(spectator.get_by_text("Пропоную перевірити голоси.")).to_be_visible()
            spectator.context.set_offline(True)
            expect(spectator.get_by_role("alert")).to_contain_text("Зв’язок перервано")
            advance("Час голосувати")
            spectator.context.set_offline(False)
            expect(spectator.get_by_role("heading",name="Час голосувати")).to_be_visible()
            choose(detective,"Кого підозрюєте?",don)
            advance("Рішення міста")
            expect(host.locator(".verdict")).to_contain_text(f"Учень {don}")
            advance("Місто засинає")
            advance("Після ночі")
            advance("Місто прокидається")
            advance("Час голосувати")
            choose(detective,"Кого підозрюєте?",maf)
            advance("Рішення міста")
            advance("Місто перемогло")
            shot(host,"mafia-result")
            button(host,"До головного меню").click()
            button(host,"Профіль").click()
            expect(host.locator(".archive-row")).to_contain_text(code)
            button(host,"Рейтинг").click()
            expect(host.locator(".leaders li")).to_have_count(6)
            assert not errors, errors
            print("Матч завершено у шести браузерних сесіях і сесії спостерігача.")
        finally:
            browser.close()
            server.close()
            server.task_dispatcher.shutdown()


if __name__ == "__main__":
    run()
