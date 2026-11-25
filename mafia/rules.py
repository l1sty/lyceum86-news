"""Server-owned rules. Only view() results may cross the room API boundary."""
from collections import Counter
import secrets

CRIME = {"mafia", "don"}
PACE = {"standard": (120, 45, 45), "quick": (60, 30, 30)}
LIMIT = 12


class Invalid(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Invalid(message)


def player(user):
    photo = user.get("photo_url", "")
    return dict(id=str(user["id"]), name=(user.get("first_name") or "Гравець")[:64],
                photo=photo if isinstance(photo, str) and photo.startswith("https://") else "",
                ready=False, alive=True, role=None)


def room(code, user, now):
    host = player(user)
    return dict(code=code, host=host["id"], players=[host], phase="lobby", step=0,
                version=0, deadline=now + 86400, round=0, pace="standard", capacity=12,
                ballots={}, moves={}, notes={}, last_heal=None, chat=[], report=None, winner=None)


def find(s, uid):
    return next((p for p in s["players"] if p["id"] == uid), None)


def change_phase(s, phase, now, duration):
    s.update(phase=phase, step=s["step"] + 1, deadline=now + duration if duration else 0,
             ballots={}, moves={})


def start(s, now):
    n = len(s["players"])
    require(6 <= n <= s["capacity"] and all(p["ready"] for p in s["players"]),
            "Для початку потрібно щонайменше шість гравців. Усі мають підтвердити готовність.")
    roles = ["don", "mafia", "detective", "doctor"]
    if n >= 9:
        roles.append("mafia")
    if n == 12:
        roles.append("mafia")
    roles.extend(["civilian"] * (n - len(roles)))
    secrets.SystemRandom().shuffle(roles)
    for p, role in zip(s["players"], roles):
        p["role"] = role
    s["round"] = 1
    change_phase(s, "reveal", now, 15)


def targets(s, p):
    if not p or not p["alive"]:
        return {}
    alive = [q for q in s["players"] if q["alive"]]
    others = [q["id"] for q in alive if q != p]
    if s["phase"] == "vote":
        return {"vote": others}
    if s["phase"] != "night":
        return {}
    role = p["role"]
    options = {}
    if role in CRIME:
        options["attack"] = [q["id"] for q in alive if q["role"] not in CRIME]
    if role in ("don", "detective"):
        options["inspect"] = others
    if role == "doctor":
        options["heal"] = [q["id"] for q in alive if q["id"] != s["last_heal"]]
    return options


def act(s, uid, data, now):
    p = find(s, uid)
    require(p is not None, "Спостерігачі не беруть участі в грі.")
    require(type(data.get("step")) is int and data["step"] == s["step"], "Етап гри змінився.")
    action = data.get("action")
    if s["phase"] == "lobby":
        if action == "ready":
            require(type(data.get("ready")) is bool, "Вкажіть готовність.")
            p["ready"] = data["ready"]
            return
        require(uid == s["host"], "Ця дія доступна власнику кімнати.")
        if action == "settings":
            pace, capacity = data.get("pace"), data.get("capacity")
            require(isinstance(pace, str) and pace in PACE and type(capacity) is int
                    and max(6, len(s["players"])) <= capacity <= LIMIT, "Перевірте налаштування кімнати.")
            if (pace, capacity) != (s["pace"], s["capacity"]):
                s.update(pace=pace, capacity=capacity, step=s["step"] + 1)
                for member in s["players"]:
                    member["ready"] = False
            return
        require(action == "start", "Оберіть доступну дію.")
        start(s, now)
        return
    require(p["alive"], "Ви спостерігаєте за партією.")
    if action == "chat":
        require(s["phase"] == "day", "Обговорення відбувається вдень.")
        body = data.get("text")
        require(isinstance(body, str) and 0 < len(body.strip()) <= 300, "Введіть до 300 символів.")
        require(not any(m["uid"] == uid and m["at"] > now - 2 for m in s["chat"]), "Зачекайте дві секунди.")
        s["chat"].append(dict(uid=uid, text=body.strip(), at=now, round=s["round"]))
        s["chat"] = s["chat"][-80:]
        return
    choices = targets(s, p)
    require(isinstance(action, str) and action in choices and data.get("target") in choices[action],
            "Ця дія або ціль недоступна.")
    if action == "vote":
        s["ballots"][uid] = data["target"]
    else:
        s["moves"].setdefault(uid, {})[action] = data["target"]


def plurality(ballots):
    counts = Counter(ballots).most_common()
    if counts and (len(counts) == 1 or counts[0][1] > counts[1][1]):
        return counts[0][0]
    return None


def end_night(s):
    attacks, healed = [], None
    for uid, actions in s["moves"].items():
        if "attack" in actions:
            attacks.append(actions["attack"])
        if "heal" in actions:
            healed = actions["heal"]
        if "inspect" in actions:
            q = find(s, actions["inspect"])
            is_don = find(s, uid)["role"] == "don"
            result = (q["role"] == "detective") if is_don else (q["role"] in CRIME)
            s["notes"].setdefault(uid, []).append(dict(round=s["round"], target=q["id"], positive=result))
    s["last_heal"] = healed
    victim = plurality(attacks)
    return victim if victim != healed else None


def victory(s):
    alive = [p for p in s["players"] if p["alive"]]
    crime = sum(p["role"] in CRIME for p in alive)
    if crime == 0:
        return "city"
    if crime * 2 >= len(alive):
        return "mafia"
    return None


def expire(s, now):
    phase = s["phase"]
    day, vote, night = PACE[s["pace"]]
    if phase == "reveal":
        change_phase(s, "night", now, night)
    elif phase == "day":
        change_phase(s, "vote", now, vote)
    elif phase in ("night", "vote"):
        victim = end_night(s) if phase == "night" else plurality(s["ballots"].values())
        if victim:
            find(s, victim)["alive"] = False
        s["report"] = dict(source=phase, victim=victim, round=s["round"])
        change_phase(s, "report", now, 8)
    elif phase == "report":
        winner = victory(s)
        after_vote = s["report"]["source"] == "vote"
        if winner or (after_vote and s["round"] >= LIMIT):
            s["winner"] = winner or "draw"
            change_phase(s, "finished", now, 0)
        elif after_vote:
            s["round"] += 1
            change_phase(s, "night", now, night)
        else:
            change_phase(s, "day", now, day)


def view(s, uid, spectator, now):
    p = None if spectator else find(s, uid)
    role = p and p["role"]
    public = {k: s[k] for k in ("code", "host", "version", "phase", "step", "deadline", "round",
                                 "pace", "capacity", "report", "winner", "chat")}
    public["players"] = [dict(id=q["id"], name=q["name"], photo=q["photo"], ready=q["ready"],
                              alive=q["alive"], role=q["role"] if s["phase"] == "finished" else None)
                         for q in s["players"]]
    return dict(**public, now=now, me=uid, spectator=spectator, role=role,
                allies=[q["id"] for q in s["players"] if role in CRIME and q["role"] in CRIME],
                team_picks={actor: moves["attack"] for actor, moves in s["moves"].items()
                            if "attack" in moves and role in CRIME and p["alive"]},
                choices=targets(s, p), selected=({"vote": s["ballots"].get(uid)}
                         if s["phase"] == "vote" else s["moves"].get(uid, {})) if p else {},
                notes=s["notes"].get(uid, []) if p else [], vote_count=len(s["ballots"]))
