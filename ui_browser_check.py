"""Mini App UI regression checks. Run with python -m ui_browser_check."""
import os
import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlencode

from playwright.sync_api import expect, sync_playwright
from waitress import create_server

import bot
from panel import create_panel
from test_game import TOKEN, signed

SIZES = ((320, 568), (360, 640), (375, 667), (390, 844), (430, 932),
         (768, 1024), (844, 390), (1280, 900), (1440, 900))


def check_layout(page):
    for width, height in SIZES:
        page.set_viewport_size({"width": width, "height": height})
        page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
        assert page.evaluate("document.documentElement.scrollWidth") <= width + 1, (page.url.split("#")[0], width, height)
        dialog = page.locator("dialog[open]")
        if dialog.count():
            assert dialog.evaluate("d => d.scrollWidth <= d.clientWidth + 1"), (width, height)
    page.set_viewport_size({"width": 390, "height": 844})


def check_school(page, base, launch):
    page.goto(base + "/app/" + launch)
    # Telegram passes launch data in the initial hash. Editor discovery must also work there.
    page.locator("[data-action=editor]").click()
    expect(page.locator("#body")).to_be_editable()
    page.locator("[data-view=pollview]").click()
    page.locator("[name=question]").fill("Яку подію проведемо?")
    page.locator("#choices").fill("Книжковий обмін\nШаховий турнір")
    page.locator("#pollform button").click()
    remove = page.get_by_role("button", name="Видалити опитування")
    remove.click()
    check_layout(page)
    page.keyboard.press("Escape")
    expect(remove).to_be_focused()
    page.locator("nav a[href='#community']").click()
    page.locator("[data-action=polls]").click()
    choice = page.locator(".poll-option").first
    choice.click()
    expect(choice).to_have_attribute("aria-pressed", "true")
    check_layout(page)
    page.evaluate("Telegram.WebView.receiveEvent('back_button_pressed', {})")
    expect(page.locator("body")).to_have_attribute("data-page", "community")


def check_board(page, base, launch):
    page.goto(base + "/game/" + launch)
    page.locator("#join").click()
    page.locator("#code input").fill("123456789A")
    page.locator("#code button").click()
    expect(page.locator("#sheet-error")).to_be_visible()
    with page.expect_response(lambda response: response.url.endswith("/game/api/lobby")):
        page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.locator("#sheet-error")).to_be_visible()
    expect(page.locator("#code input")).to_have_value("123456789A")
    check_layout(page)
    page.evaluate("Telegram.WebView.receiveEvent('back_button_pressed', {})")
    expect(page.locator("dialog")).not_to_be_visible()
    page.locator("#create").click()
    page.locator("#new button").click()
    expect(page.locator("#session")).to_be_visible()
    check_layout(page)
    page.set_viewport_size({"width": 320, "height": 568})
    expect(page.locator("[data-act=code-card]")).to_be_in_viewport()


def run():
    with TemporaryDirectory() as temp, sync_playwright() as pw:
        database = Path(temp) / "school.sqlite"
        with closing(sqlite3.connect(database)) as db:
            bot.initialize(db)
        app = create_panel(database, TOKEN, {1}, bot.publish)
        server = create_server(app, host="127.0.0.1", port=0)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            browser = pw.chromium.launch(executable_path=os.getenv("MAFIA_TEST_CHROME") or None)
            context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                          is_mobile=True, reduced_motion="reduce")
            if sdk := os.getenv("MAFIA_TEST_SDK"):
                context.route("https://telegram.org/js/telegram-web-app.js**",
                              lambda route: route.fulfill(path=sdk, content_type="text/javascript"))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            base = f"http://127.0.0.1:{server.effective_port}"
            launch = "#" + urlencode({"tgWebAppData": signed(1), "tgWebAppVersion": "8.0", "tgWebAppPlatform": "web"})
            check_school(page, base, launch)
            check_board(page, base, launch)
            assert not errors, errors
            browser.close()
        finally:
            server.close()
            server.task_dispatcher.shutdown()
            thread.join(timeout=3)


if __name__ == "__main__":
    run()
    print("Інтерфейс ліцею, редакції та ігрових кімнат перевірено.")

