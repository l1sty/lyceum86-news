"""Server-owned rules for the twenty-square school board."""
import secrets


def tile(name, district, price=0):
    return dict(name=name, district=district, price=price, rent=price // 5,
                upgrade=price // 2)


BOARD = [
    tile("Перший дзвоник", "Старт"), tile("Книгарня", "Гуманітарний", 100),
    tile("Читальна зала", "Гуманітарний", 120), tile("Скринька подій", "Подія"),
    tile("Бібліотека", "Гуманітарний", 140), tile("Велика перерва", "Відпочинок"),
    tile("Майстерня", "Мистецький", 150), tile("Артстудія", "Мистецький", 160),
    tile("Шкільна лотерея", "Подія"), tile("Актова зала", "Мистецький", 180),
    tile("День ліцею", "Подія"), tile("Лабораторія", "Науковий", 190),
    tile("Робототехніка", "Науковий", 200), tile("Науковий грант", "Подія"),
    tile("Обсерваторія", "Науковий", 220), tile("Шкільний сквер", "Відпочинок"),
    tile("Спортзал", "Спортивний", 230), tile("Басейн", "Спортивний", 240),
    tile("Рада ліцею", "Подія"), tile("Стадіон", "Спортивний", 260),
]
EVENTS = [("Перемога на олімпіаді", 130), ("Ремонт обладнання", -100),
          ("Стипендія ліцею", 90), ("Витрати на екскурсію", -70)]


class RuleError(ValueError):
    pass


def require(condition, message="Ця дія зараз недоступна."):
    if not condition:
        raise RuleError(message)


def player(user):
    return dict(id=str(user["id"]), name=str(user.get("first_name") or "Гравець")[:60],
                photo=user.get("photo_url", ""), cash=900, pos=0, out=False)


def room(code, user, private, mode):
    host = player(user)
    return dict(code=code, host=host["id"], private=private, mode=mode, players=[host],
                phase="waiting", turn=0, moves=0, deadline=0, dice=[], roll=0, version=1,
                deeds={}, auction=None, offer=None, log=[], chat=[], winner=None)


def note(s, message):
    s["log"] = (s["log"] + [message])[-30:]


def current(s):
    return s["players"][s["turn"]]


def wealth(s, p):
    return p["cash"] + sum(BOARD[int(i)]["price"] + d["level"] * BOARD[int(i)]["upgrade"]
                            for i, d in s["deeds"].items() if d["owner"] == p["id"])


def phase(s, name, now):
    s["phase"] = name
    s["deadline"] = now + (18 if s["mode"] == "quick" else 40)


def advance(s, now):
    s.update(auction=None, offer=None)
    alive = [p for p in s["players"] if not p["out"]]
    s["moves"] += 1
    if len(alive) == 1 or (s["mode"] == "quick" and s["moves"] >= 12 * len(s["players"])):
        winner = max(alive, key=lambda p: wealth(s, p))
        s.update(phase="finished", deadline=0, winner=winner["id"])
        note(s, "Перемога — " + winner["name"])
        return
    while True:
        s["turn"] = (s["turn"] + 1) % len(s["players"])
        if not current(s)["out"]:
            break
    phase(s, "roll", now)


def pay(s, p, amount, owner=None):
    if owner:
        owner["cash"] += min(p["cash"], amount)
    p["cash"] -= amount
    if p["cash"] < 0:
        p.update(cash=0, out=True)
        s["deeds"] = {i: d for i, d in s["deeds"].items() if d["owner"] != p["id"]}
        note(s, p["name"] + " вибуває через банкрутство.")


def roll(s, now):
    s["offer"] = None
    p = current(s)
    dice = [secrets.randbelow(6) + 1 for _ in range(2)]
    dest = p["pos"] + sum(dice)
    if dest >= len(BOARD):
        p["cash"] += 160
        note(s, "За коло нараховано 160 ₴.")
    p["pos"] = dest % len(BOARD)
    s.update(dice=dice, roll=s["roll"] + 1)
    place = BOARD[p["pos"]]
    note(s, f"{p['name']} · {sum(dice)} · {place['name']}")
    deed = s["deeds"].get(str(p["pos"]))
    if place["price"] and not deed:
        phase(s, "buy", now)
        return
    if deed and deed["owner"] != p["id"]:
        owner = next(q for q in s["players"] if q["id"] == deed["owner"])
        amount = place["rent"] * (1 + deed["level"])
        pay(s, p, amount, owner)
        note(s, f"Оренда · {amount} ₴ → {owner['name']}")
    if place["district"] == "Подія":
        message, change = secrets.choice(EVENTS)
        pay(s, p, -change)
        note(s, f"{message} · {change:+} ₴")
    advance(s, now)


def open_auction(s, now):
    phase(s, "auction", now)
    s["auction"] = dict(tile=current(s)["pos"], amount=0, bidder=None)
    note(s, "Розпочато аукціон.")


def resolve_auction(s, now):
    a = s["auction"]
    if a["bidder"]:
        buyer = next(p for p in s["players"] if p["id"] == a["bidder"])
        buyer["cash"] -= a["amount"]
        s["deeds"][str(a["tile"])] = dict(owner=buyer["id"], level=0)
        note(s, f"{buyer['name']} виграє аукціон за {a['amount']} ₴.")
    advance(s, now)


def expire(s, now):
    if s["phase"] == "roll":
        roll(s, now)
    elif s["phase"] == "buy":
        open_auction(s, now)
    elif s["phase"] == "auction":
        resolve_auction(s, now)


def action(s, uid, data, now):
    kind = data.get("action")
    p = next((p for p in s["players"] if p["id"] == uid), None)
    require(p is not None)
    if kind == "chat":
        msg = data.get("text")
        require(isinstance(msg, str) and 0 < len(msg.strip()) <= 280, "Довжина повідомлення — від 1 до 280 знаків.")
        require(not any(m["id"] == uid and m["time"] > now - 1 for m in s["chat"]), "Зачекайте секунду.")
        s["chat"] = (s["chat"] + [dict(id=uid, name=p["name"], text=msg.strip(), time=now)])[-50:]
        return
    if kind == "start":
        require(s["phase"] == "waiting" and uid == s["host"] and len(s["players"]) >= 2)
        phase(s, "roll", now)
        return
    require(not p["out"])
    if kind == "resign":
        require(s["phase"] in ("roll", "buy", "auction"))
        p.update(out=True, cash=0)
        s["deeds"] = {i: d for i, d in s["deeds"].items() if d["owner"] != uid}
        note(s, p["name"] + " залишає партію.")
        if p == current(s) or sum(not q["out"] for q in s["players"]) == 1:
            advance(s, now)
        else:
            if s["offer"] and s["offer"]["to"] == uid:
                s["offer"] = None
            if s["auction"] and s["auction"]["bidder"] == uid:
                s["auction"].update(bidder=None, amount=0)
        return
    if kind == "bid":
        a = s["auction"]
        value = data.get("amount")
        require(s["phase"] == "auction" and type(value) is int and a["amount"] + 10 <= value <= p["cash"],
                "Ставка має зрости щонайменше на 10 ₴ у межах балансу.")
        a.update(bidder=uid, amount=value)
        return
    offer = s["offer"]
    if kind in ("accept", "decline"):
        require(offer and offer["to"] == uid and s["phase"] == "roll")
        if kind == "accept":
            deed = s["deeds"][offer["tile"]]
            require(p["cash"] >= offer["amount"] and deed["owner"] == current(s)["id"])
            p["cash"] -= offer["amount"]
            current(s)["cash"] += offer["amount"]
            deed["owner"] = uid
            note(s, "Угоду укладено · " + BOARD[int(offer["tile"])]["name"])
        s["offer"] = None
        return
    require(current(s)["id"] == uid, "Зараз хід іншого гравця.")
    if kind == "roll":
        require(s["phase"] == "roll")
        roll(s, now)
    elif kind in ("buy", "pass"):
        require(s["phase"] == "buy")
        if kind == "pass":
            open_auction(s, now)
        else:
            cost = BOARD[p["pos"]]["price"]
            require(p["cash"] >= cost, "Недостатньо коштів.")
            p["cash"] -= cost
            s["deeds"][str(p["pos"])] = dict(owner=uid, level=0)
            note(s, p["name"] + " купує " + BOARD[p["pos"]]["name"] + ".")
            advance(s, now)
    elif kind in ("upgrade", "offer"):
        key = str(data.get("tile"))
        deed = s["deeds"].get(key)
        require(s["phase"] == "roll" and deed and deed["owner"] == uid)
        if kind == "upgrade":
            cost = BOARD[int(key)]["upgrade"]
            require(p["cash"] >= cost and deed["level"] < 3)
            p["cash"] -= cost
            deed["level"] += 1
            note(s, "Поліпшено · " + BOARD[int(key)]["name"])
        else:
            target, amount = data.get("to"), data.get("amount")
            require(type(amount) is int and 1 <= amount <= 1000000 and
                    any(q["id"] == target and q != p and not q["out"] for q in s["players"]))
            s["offer"] = dict(tile=key, to=target, amount=amount)
    else:
        raise RuleError("Невідома дія.")

