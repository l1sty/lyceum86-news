import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowLeft,
  BookOpen,
  Club,
  Gamepad2,
  LogIn,
  Trophy,
  UserRound,
} from "lucide-react";
import { Menu, Rules, Archive } from "./Library";
import { Table } from "./Table";
import { Music } from "./Music";
import { api, ApiError, bootstrap, haptic, initTelegram, tg } from "./api";
import type { Command, Home, Role, Room } from "./model";
import "./style.css";

type Page = "menu" | "join" | "rules" | "ranking" | "profile";
const tabs = [
  ["menu", "Грати", Gamepad2],
  ["rules", "Правила", BookOpen],
  ["ranking", "Рейтинг", Trophy],
  ["profile", "Профіль", UserRound],
] as const;

function App() {
  const [page, setPage] = useState<Page>("menu"),
    [home, setHome] = useState<Home | null>(null);
  const [room, setRoom] = useState<Room | null>(null),
    [busy, setBusy] = useState(false),
    [booting, setBooting] = useState(true);
  const [error, setError] = useState(""),
    [offline, setOffline] = useState(""),
    [initialRole, setInitialRole] = useState<Role>();
  const [code, setCode] = useState(""),
    [watch, setWatch] = useState(false);
  const lock = useRef(false),
    roomRef = useRef<Room | null>(null),
    reduce = useReducedMotion();
  const put = useCallback((r: Room | null) => {
    roomRef.current = r;
    setRoom(r);
  }, []);
  const accept = useCallback(
    (r: Room) => {
      if (
        roomRef.current?.code === r.code &&
        r.version >= roomRef.current.version
      )
        put(r);
    },
    [put],
  );
  const load = useCallback(async () => {
    setBooting(true);
    setError("");
    try {
      const h = await bootstrap();
      setHome(h);
      if (h.current) {
        try {
          const r = await api<Room>("rooms/" + h.current);
          if (r) put(r);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooting(false);
    }
  }, [put]);
  useEffect(() => {
    initTelegram();
    void load();
  }, [load]);
  const roomCode = room?.code;
  useEffect(() => {
    if (!roomCode) return;
    let active = true,
      pending = false,
      timer = 0,
      failures = 0;
    const poll = async () => {
      if (
        !active ||
        pending ||
        document.hidden ||
        roomRef.current?.code !== roomCode
      )
        return;
      pending = true;
      try {
        const r = await api<Room>(
          "rooms/" + roomCode + "?v=" + roomRef.current.version,
        );
        if (active) {
          if (r) accept(r);
          failures = 0;
          setOffline("");
        }
      } catch (e) {
        if (active && roomRef.current?.code === roomCode) {
          if (e instanceof ApiError && e.status === 404) {
            put(null);
            setError(e.message);
            setOffline("");
          } else {
            failures++;
            setOffline(
              e instanceof ApiError && e.status === 403
                ? e.message
                : "Зв’язок перервано. Відновлюємо гру…",
            );
          }
        }
      } finally {
        pending = false;
        if (active && !document.hidden)
          timer = window.setTimeout(poll, Math.min(5000, 850 * (1 + failures)));
      }
    };
    const wake = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [roomCode, accept, put]);
  function go(dest: Page, r?: Role) {
    haptic();
    setError("");
    setInitialRole(r);
    setPage(dest);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    if (!tg?.isVersionAtLeast("6.1") || !tg.BackButton) return;
    const back = () => go("menu");
    if (!room && page !== "menu") {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    } else tg.BackButton.hide();
    return () => tg?.BackButton?.offClick(back);
  }, [roomCode, page]);
  async function enter(action: string) {
    if (lock.current || booting) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!home) {
        const h = await bootstrap();
        setHome(h);
      }
      const r = await api<Room>("rooms", { action, code });
      if (r) {
        put(r);
        setPage("menu");
        haptic();
        window.scrollTo(0, 0);
      }
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) {
        const h = await api<Home>("home").catch(() => null);
        if (h?.current) {
          const r = await api<Room>("rooms/" + h.current).catch(() => null);
          if (r) {
            put(r);
            setError("");
          }
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const command: Command = async (action, data = {}) => {
    const current = roomRef.current;
    if (!current || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const s = await api<Room | { left: boolean }>("rooms/" + current.code, {
        action,
        step: current.step,
        ...data,
      });
      if (s && "left" in s) {
        put(null);
        setPage("menu");
        setOffline("");
        window.scrollTo(0, 0);
      } else if (s && "code" in s) accept(s);
      haptic();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const screen = room ? room.code + "-" + room.step : page;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
  return (
    <div
      className={room ? "shell in-room" : "shell"}
      data-light={
        room?.phase === "night"
          ? "night"
          : room?.phase === "day" || room?.phase === "vote"
            ? "day"
            : "neutral"
      }
    >
      <div className="ambient" aria-hidden="true" />
      <header className="brandbar">
        <span className="brand">
          <span className="brandmark">
            <Club fill="currentColor" />
          </span>
          Ігротека <b>86</b>
        </span>
        <span className="edition">
          {room ? "Ігрова кімната" : "Клуб настільних ігор"}
        </span>
        <Music />
      </header>
      {(offline || error) && (
        <div className="notice" role="alert">
          <span>{offline || error}</span>
          {!room && (
            <button onClick={() => void load()} disabled={booting}>
              Оновити
            </button>
          )}
        </div>
      )}
      <main>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.16 }}
          >
            {room ? (
              <Table r={room} cmd={command} busy={busy} />
            ) : page === "menu" ? (
              <Menu
                busy={busy || booting}
                create={() => void enter("create")}
                join={() => go("join")}
                openRules={(r) => go("rules", r)}
              />
            ) : page === "join" ? (
              <section className="page join">
                <button className="link" onClick={() => go("menu")}>
                  <ArrowLeft />
                  До меню
                </button>
                <h1>Увійти за кодом</h1>
                <p>Введіть шість символів, які вам надіслав власник кімнати.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void enter(watch ? "watch" : "join");
                  }}
                >
                  <label htmlFor="room-code">Код кімнати</label>
                  <input
                    id="room-code"
                    className="code-input"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="characters"
                    maxLength={6}
                    value={code}
                    placeholder="······"
                    onChange={(e) =>
                      setCode(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                      )
                    }
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={watch}
                      onChange={(e) => setWatch(e.target.checked)}
                    />
                    Увійти як спостерігач
                  </label>
                  <button
                    className="primary"
                    disabled={busy || booting || code.length !== 6}
                  >
                    <LogIn />
                    Увійти в кімнату
                  </button>
                </form>
              </section>
            ) : page === "rules" ? (
              <Rules initial={initialRole} />
            ) : (
              <Archive
                profile={page === "profile"}
                name={home?.name || "Гравець"}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
      {!room && (
        <nav aria-label="Головна навігація">
          {tabs.map(([id, title, Icon]) => (
            <button
              key={id}
              aria-current={
                page === id || (id === "menu" && page === "join")
                  ? "page"
                  : undefined
              }
              onClick={() => go(id)}
            >
              <Icon />
              {title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
