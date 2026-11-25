import type { Home } from "./model";
interface WebApp {
  isActive?: boolean;
  onEvent?(event: "activated" | "deactivated", handler: () => void): void;
  offEvent?(event: "activated" | "deactivated", handler: () => void): void;
  initData: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  HapticFeedback?: {
    selectionChanged(): void;
    impactOccurred(style: "light"): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
  };
}
export const tg = (window as Window & { Telegram?: { WebApp: WebApp } })
  .Telegram?.WebApp;
export const haptic = () => {
  if (tg?.isVersionAtLeast("6.1")) tg.HapticFeedback?.selectionChanged();
};
export function initTelegram() {
  tg?.ready();
  tg?.expand();
  if (tg?.isVersionAtLeast("6.1")) tg.setBackgroundColor("#101012");
  if (tg?.isVersionAtLeast("6.9")) tg.setHeaderColor("#101012");
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let ticket = "";
let authenticated = false;
try {
  ticket = sessionStorage.getItem("mafia-ticket") || "";
} catch {
  /* Storage is optional. */
}
async function fetchGame<T>(
  route: string,
  data?: Record<string, unknown>,
  useInit = false,
): Promise<T | null> {
  const headers: Record<string, string> = {};
  if (useInit || !ticket) headers["X-Telegram-Init-Data"] = tg?.initData || "";
  else headers["X-Mafia-Session"] = ticket;
  if (data) headers["Content-Type"] = "application/json";
  const abort = new AbortController();
  const timeout = window.setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch("/mafia/api/" + route, {
      method: data ? "POST" : "GET",
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: abort.signal,
      cache: "no-store",
    });
    if (res.status === 204) return null;
    const payload = await res
      .json()
      .catch(() => ({ error: "Сервер тимчасово недоступний." }));
    if (!res.ok)
      throw new ApiError(
        payload.error || "Не вдалося виконати дію.",
        res.status,
      );
    return payload as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Немає зв’язку із сервером. Спробуйте ще раз.", 0);
  } finally {
    clearTimeout(timeout);
  }
}
export async function api<T>(route: string, data?: Record<string, unknown>) {
  if (!authenticated)
    throw new ApiError("Відкрийте «Мафію» командою /mafia у Telegram.", 403);
  return fetchGame<T>(route, data);
}
export async function bootstrap() {
  authenticated = false;
  let home: Home | null;
  // Fresh Telegram launches take precedence over a previous account on this webview.
  try {
    home = await fetchGame<Home>("home", undefined, Boolean(tg?.initData));
  } catch (err) {
    // A suspended webview may carry expired initData. Bind its stored ticket to the same user.
    let sameUser = false;
    try {
      const launchUser = JSON.parse(
        new URLSearchParams(tg?.initData).get("user") || "null",
      );
      sameUser =
        String(launchUser?.id) === sessionStorage.getItem("mafia-user");
    } catch {
      /* A new Telegram launch is required. */
    }
    if (!(err instanceof ApiError && err.status === 403 && ticket && sameUser))
      throw err;
    home = await fetchGame<Home>("home");
  }
  if (!home) throw new Error("Не вдалося відкрити гру.");
  if (home.ticket) {
    ticket = home.ticket;
    try {
      sessionStorage.setItem("mafia-ticket", ticket);
      sessionStorage.setItem("mafia-user", home.me);
    } catch {}
  }
  authenticated = true;
  return home;
}
