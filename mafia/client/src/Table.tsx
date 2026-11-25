import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Eye, EyeOff, Moon, Send, Timer } from "lucide-react";
import {
  art,
  roles,
  outcomes,
  type Choice,
  type Command,
  type Player,
  type Room,
} from "./model";
import { haptic } from "./api";

function Avatar({ p }: { p: Player }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar">
      {p.photo && !failed ? (
        <img
          src={p.photo}
          referrerPolicy="no-referrer"
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        p.name.trim().slice(0, 1)
      )}
    </span>
  );
}
function Roster({ r }: { r: Room }) {
  return (
    <ul className="roster">
      {r.players.map((p) => (
        <li key={p.id}>
          <Avatar p={p} />
          <span>
            {p.name}
            {p.id === r.me && <small>Ви</small>}
            {r.phase === "lobby" && r.host === p.id && <small>Власник</small>}
          </span>
          <em>
            {r.phase === "lobby"
              ? p.ready
                ? "Готово"
                : "Очікує"
              : r.phase === "finished" && p.role
                ? roles[p.role][0]
                : p.alive
                  ? "За столом"
                  : "Гру завершено"}
          </em>
        </li>
      ))}
    </ul>
  );
}
function Countdown({ r }: { r: Room }) {
  const [seconds, setSeconds] = useState(Math.max(0, r.deadline - r.now));
  useEffect(() => {
    const end = performance.now() + (r.deadline - r.now) * 1000;
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [r.deadline, r.now]);
  return (
    <span className="timer" aria-label="Залишок часу">
      <Timer />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}
function Lobby({ r, cmd, busy }: { r: Room; cmd: Command; busy: boolean }) {
  const [copy, setCopy] = useState("");
  const mine = r.players.find((p) => p.id === r.me);
  const ready = r.players.filter((p) => p.ready).length;
  return (
    <>
      <h1>Кімната очікування</h1>
      <div className="room-code">
        <div>
          <small>Код кімнати</small>
          <strong>{r.code}</strong>
        </div>
        <button
          className="icon"
          aria-label="Скопіювати код"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(r.code);
              setCopy("Код скопійовано");
            } catch {
              setCopy("Виділіть код і скопіюйте його вручну.");
            }
          }}
        >
          <Copy />
        </button>
      </div>
      <small role="status">
        {copy || "Надішліть друзям цей код для входу."}
      </small>
      {r.host === r.me && !r.spectator && (
        <fieldset disabled={busy}>
          <legend>Налаштування</legend>
          <label>
            Темп гри
            <select
              value={r.pace}
              onChange={(e) =>
                void cmd("settings", {
                  pace: e.target.value,
                  capacity: r.capacity,
                })
              }
            >
              <option value="standard">Звичайний</option>
              <option value="quick">Швидкий</option>
            </select>
          </label>
          <label>
            Місць за столом
            <select
              value={r.capacity}
              onChange={(e) =>
                void cmd("settings", {
                  pace: r.pace,
                  capacity: Number(e.target.value),
                })
              }
            >
              {Array.from({ length: 7 }, (_, i) => i + 6)
                .filter((n) => n >= r.players.length)
                .map((n) => (
                  <option key={n}>{n}</option>
                ))}
            </select>
          </label>
        </fieldset>
      )}
      {!r.spectator && (
        <div className="controls">
          <button
            aria-pressed={mine?.ready}
            className={mine?.ready ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void cmd("ready", { ready: !mine?.ready })}
          >
            <Check />
            {mine?.ready ? "Скасувати готовність" : "Я готовий / готова"}
          </button>
          {r.me === r.host && (
            <button
              className="primary"
              disabled={busy || ready < 6 || ready !== r.players.length}
              onClick={() => void cmd("start")}
            >
              Почати партію
            </button>
          )}
        </div>
      )}
      <p className="hint">
        Готові {ready} з {r.players.length}. Для старту потрібно щонайменше
        шестеро.
      </p>
      <div className="section-line">
        <h2>Гравці</h2>
        <span>{r.players.length} / {r.capacity}</span>
      </div>
      <Roster r={r} />
    </>
  );
}
function Secret({ r }: { r: Room }) {
  const [open, setOpen] = useState(false),
    reduce = useReducedMotion();
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setOpen(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  if (!r.role) return null;
  const [name, description] = roles[r.role];
  return (
    <div className="secret">
      <button
        onClick={() => {
          haptic();
          setOpen(!open);
        }}
        aria-expanded={open}
        className="secret-toggle"
      >
        {open ? <EyeOff /> : <Eye />}
        {open ? "Приховати роль" : "Відкрити свою роль"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="role-card"
            initial={reduce ? false : { opacity: 0, rotateY: -14, y: 8 }}
            animate={{ opacity: 1, rotateY: 0, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <img src={art(r.role)} alt="" />
            <div>
              <small>Ваша роль</small>
              <h2>{name}</h2>
              <p>{description}</p>
              {r.allies.length > 0 && (
                <p>
                  <b>Ваша команда</b>
                  <br />
                  {r.players
                    .filter((p) => r.allies.includes(p.id))
                    .map((p) => p.name)
                    .join(", ")}
                </p>
              )}
              {r.notes.length > 0 && (
                <>
                  <b>Ваші перевірки</b>
                  {r.notes.map((n) => (
                    <small key={n.round}>
                      Ніч {n.round} ·{" "}
                      {r.players.find((p) => p.id === n.target)?.name} —{" "}
                      {r.role === "don"
                        ? n.positive
                          ? "детектив"
                          : "не детектив"
                        : n.positive
                          ? "мафія"
                          : "не мафія"}
                    </small>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
const actions: Record<Choice, string> = {
  attack: "Оберіть жертву",
  inspect: "Кого перевірити?",
  heal: "Кого захистити?",
  vote: "Кого підозрюєте?",
};
function Choices({ r, cmd, busy }: { r: Room; cmd: Command; busy: boolean }) {
  return (
    <>
      {(Object.keys(r.choices) as Choice[]).map((action) => (
        <section className="choices" key={action}>
          <h2>{actions[action]}</h2>
          <p className="hint">Вибір можна змінити до кінця відліку.</p>
          <div className="target-list">
            {r.players
              .filter((p) => r.choices[action]?.includes(p.id))
              .map((p) => {
                const active = r.selected[action] === p.id;
                return (
                  <motion.button
                    whileTap={{ scale: 0.985 }}
                    disabled={busy}
                    aria-pressed={active}
                    key={p.id}
                    onClick={() => void cmd(action, { target: p.id })}
                  >
                    <Avatar p={p} />
                    <span>{p.name}</span>
                    <i>{active && <Check size={15} />}</i>
                  </motion.button>
                );
              })}
          </div>
          {action === "attack" && Object.keys(r.team_picks).length > 0 && (
            <p className="hint">
              Вибір мафії ·{" "}
              {Object.entries(r.team_picks)
                .map(([uid, target]) =>
                  [uid, target]
                    .map((id) => r.players.find((p) => p.id === id)?.name)
                    .join(" → "),
                )
                .join(" · ")}
            </p>
          )}
        </section>
      ))}
    </>
  );
}
function Discussion({
  r,
  cmd,
  busy,
  alive,
}: {
  r: Room;
  cmd: Command;
  busy: boolean;
  alive: boolean;
}) {
  const [draft, setDraft] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const messages = r.chat.filter((m) => m.round === r.round);
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages.at(-1)?.at]);
  return (
    <>
      <h2>Обговорення</h2>
      <div ref={feed} className="chat" role="log">
        {!messages.length ? (
          <p>Хто викликає підозру?</p>
        ) : (
          messages.map((m, i) => (
            <div key={i}>
              <b>{r.players.find((p) => p.id === m.uid)?.name}</b>
              <p>{m.text}</p>
            </div>
          ))
        )}
      </div>
      {alive && (
        <form
          className="compose"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!busy && (await cmd("chat", { text: draft }))) setDraft("");
          }}
        >
          <input
            aria-label="Ваше повідомлення"
            maxLength={300}
            placeholder="Ваше повідомлення"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="primary"
            disabled={!draft.trim() || busy}
            aria-label="Надіслати"
          >
            <Send />
          </button>
        </form>
      )}
    </>
  );
}
const phaseTitles = {
  lobby: "Кімната",
  reveal: "Роздача ролей",
  night: "Місто засинає",
  day: "Місто прокидається",
  vote: "Час голосувати",
  report: "Підсумок",
  finished: "Фінал",
};
export function Table({
  r,
  cmd,
  busy,
}: {
  r: Room;
  cmd: Command;
  busy: boolean;
}) {
  const p = r.players.find((q) => q.id === r.me),
    alive = !r.spectator && !!p?.alive;
  const victim = r.players.find((q) => q.id === r.report?.victim);
  const leave =
    r.spectator || !alive || r.phase === "lobby" || r.phase === "finished";
  return (
    <article className={"table page lighting-" + r.phase}>
      <div className="table-top">
        <div className="overline">
          <i />
          {r.phase === "lobby"
            ? "Ігровий стіл"
            : "Кімната " + r.code + " · Раунд " + r.round}
        </div>
        {!["lobby", "finished"].includes(r.phase) && <Countdown r={r} />}
      </div>
      {r.spectator && (
        <p className="observer">
          <Eye />
          Ви спостерігаєте
        </p>
      )}
      {r.phase === "lobby" ? (
        <Lobby r={r} cmd={cmd} busy={busy} />
      ) : (
        <>
          <h1>
            {r.winner
              ? outcomes[r.winner]
              : r.phase === "report"
                ? r.report?.source === "night"
                  ? "Після ночі"
                  : "Рішення міста"
                : phaseTitles[r.phase]}
          </h1>
          {r.phase !== "finished" && <Secret r={r} />}
          {r.phase === "reveal" && (
            <p>Запам’ятайте свою роль. Після відліку почнеться перша ніч.</p>
          )}
          {!alive && !r.spectator && r.phase !== "finished" && (
            <p className="observer">
              <Eye />
              Ви вибули й далі спостерігаєте.
            </p>
          )}
          {r.phase === "night" && !Object.keys(r.choices).length && (
            <div className="night-wait">
              <Moon />
              <p>
                Тривають нічні ходи. На світанку місто дізнається, хто залишився
                за столом.
              </p>
            </div>
          )}
          {r.phase === "day" && (
            <Discussion r={r} cmd={cmd} busy={busy} alive={alive} />
          )}
          {r.phase === "vote" && (
            <p>
              Проголосували {r.vote_count} з{" "}
              {r.players.filter((q) => q.alive).length}.
            </p>
          )}
          <Choices r={r} cmd={cmd} busy={busy} />
          {r.phase === "report" && (
            <div className="verdict">
              {victim ? (
                <>
                  <small>Гру залишає</small>
                  <h2>{victim.name}</h2>
                </>
              ) : (
                <h2>Усі залишаються за столом</h2>
              )}
            </div>
          )}
          {r.phase === "finished" && (
            <p>Зіграно раундів — {r.round}. Ролі відкрито.</p>
          )}
          <div className="section-line">
            <h2>{r.phase === "finished" ? "Ролі за столом" : "За столом"}</h2>
            <span>
              {r.players.filter((q) => q.alive).length} / {r.players.length}
            </span>
          </div>
          <Roster r={r} />
        </>
      )}
      {leave && (
        <button
          className="leave"
          disabled={busy}
          onClick={() => void cmd("leave")}
        >
          {r.phase === "finished" ? "До головного меню" : "Вийти з кімнати"}
        </button>
      )}
    </article>
  );
}
