import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Plus,
  LogIn,
  UsersRound,
  Layers3,
} from "lucide-react";
import { api, haptic } from "./api";
import { art, roles, type Role, type Records } from "./model";

const cast: Role[] = ["don", "detective", "mafia", "doctor", "civilian"];

export function Menu({
  create,
  join,
  openRules,
  busy,
}: {
  create: () => void;
  join: () => void;
  openRules: (r?: Role) => void;
  busy: boolean;
}) {
  return (
    <>
      <section className="cover">
        <div className="cover-art">
          <img
            src={art("city")}
            alt="Трамвай і силует у капелюсі на вечірній вулиці"
            fetchPriority="high"
          />
        </div>
        <div className="cover-copy">
          <div className="overline">
            <i />
            Гра на дедукцію
          </div>
          <h1 className="mast-title">Мафія</h1>
          <p className="intro">
            Місто засинає. Хтось із тих, кому ви довіряєте, цієї ночі
            прокинеться.
          </p>
          <div className="facts">
            <span>
              <UsersRound />
              6–12 гравців
            </span>
            <span>
              <Layers3 />5 ролей
            </span>
          </div>
          <div className="cover-actions">
            <button className="primary" onClick={create} disabled={busy}>
              <Plus />
              Створити кімнату
            </button>
            <button className="secondary" onClick={join} disabled={busy}>
              <LogIn />
              Увійти за кодом
            </button>
          </div>
        </div>
      </section>
      <section className="cast-section">
        <div className="section-line">
          <h2>За столом</h2>
          <button className="link" onClick={() => openRules()}>
            Правила <ArrowUpRight />
          </button>
        </div>
        <div className="cast">
          {cast.map((r) => (
            <button key={r} onClick={() => openRules(r)}>
              <img src={art(r)} alt="" loading="lazy" />
              <span>{roles[r][0]}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
export function Rules({ initial }: { initial?: Role }) {
  const [opened, setOpened] = useState<Role | undefined>(initial);
  return (
    <article className="page">
      <div className="overline">
        <i />
        За ігровим столом
      </div>
      <h1>Правила</h1>
      <p className="lead">
        Місто виграє, коли викриє всю мафію. Мафії достатньо зрівнятися
        чисельністю з рештою живих гравців.
      </p>
      <h2>Ролі</h2>
      <div className="role-list">
        {cast.map((r) => (
          <div key={r}>
            <button
              aria-expanded={r === opened}
              onClick={() => {
                haptic();
                setOpened(opened === r ? undefined : r);
              }}
            >
              <img src={art(r)} alt="" />
              <strong>{roles[r][0]}</strong>
              <ChevronDown size={17} />
            </button>
            {r === opened && <p>{roles[r][1]}</p>}
          </div>
        ))}
      </div>
      <h2>Перебіг партії</h2>
      <ol className="instructions">
        <li>
          <b>Підготовка.</b> Від 6 до 12 учасників підтверджують готовність.
          Власник починає гру, і кожен отримує таємну роль. За столом один Дон,
          детектив і лікар. Разом із Доном мафіозі двоє, від дев’яти гравців —
          троє, а за повного столу — четверо.
        </li>
        <li>
          <b>Ніч.</b> Мафія голосує за ціль. Вибуває гравець із найбільшою
          кількістю голосів, якщо його не захистив лікар. За рівності голосів
          ніхто не вибуває.
        </li>
        <li>
          <b>День.</b> Живі гравці обговорюють підозри в чаті, потім голосують.
          Свій вибір можна змінювати до кінця відліку. За рівності голосів або
          коли всі утрималися, ніхто не вибуває.
        </li>
        <li>
          <b>Після вибуття.</b> Можна далі спостерігати. Ролі всіх гравців
          відкриються у фіналі. Якщо за 12 раундів переможця немає, партія
          закінчується нічиєю.
        </li>
      </ol>
    </article>
  );
}
export function Archive({ profile, name }: { profile: boolean; name: string }) {
  const [records, setRecords] = useState<Records | null>(null);
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    api<Records>("records")
      .then((r) => {
        if (current) setRecords(r);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [retry, profile]);
  return (
    <section className="page">
      <div className="overline">
        <i />
        {profile ? "Особова справа" : "Архів партій"}
      </div>
      <h1>{profile ? "Профіль" : "Рейтинг"}</h1>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            Повторити
          </button>
        </div>
      ) : !records ? (
        <p role="status">Завантаження…</p>
      ) : profile ? (
        <>
          <h2>{name}</h2>
          <div className="stats">
            {[
              ["Партії", records.stats.games],
              ["Перемоги", records.stats.wins],
              ["Нічиї", records.stats.draws],
            ].map(([k, v]) => (
              <div key={k}>
                <strong>{v}</strong>
                <small>{k}</small>
              </div>
            ))}
          </div>
          <h2>Останні партії</h2>
          {!records.history.length ? (
            <p>Тут з’явиться результат вашої першої партії.</p>
          ) : (
            records.history.map((h) => (
              <div className="archive-row" key={h.code}>
                <span>
                  <b>{roles[h.role][0]}</b>
                  <small>
                    {new Date(h.ended * 1000).toLocaleDateString("uk-UA")} ·{" "}
                    {h.code}
                  </small>
                </span>
                <strong>
                  {h.winner === "draw"
                    ? "Нічия"
                    : h.won
                      ? "Перемога"
                      : "Поразка"}
                </strong>
              </div>
            ))
          )}
        </>
      ) : (
        <>
          <p>Виграні партії за весь час</p>
          {!records.leaders.length ? (
            <p>Перші гравці з’являться після завершення партії.</p>
          ) : (
            <ol className="leaders">
              {records.leaders.map((p, i) => (
                <li key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <b>{p.name}</b>
                  <strong>
                    {p.wins} / {p.games}
                  </strong>
                </li>
              ))}
            </ol>
          )}
          {!!records.leaders.length && <small>Перемоги / зіграні партії</small>}
        </>
      )}
    </section>
  );
}
