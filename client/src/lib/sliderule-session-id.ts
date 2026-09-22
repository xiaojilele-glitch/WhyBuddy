/**
 * 当前会话 id 的单一兜底。
 *
 * ⚠ 2026-09-02 真机：新建会话后「社区图书馆」产物写进昨天的诊所会话。
 * 字面量散落 7 处，拿不到 id 的路径全掉进同一个桶。定义只许这一处。
 *
 * ⚠ 2026-09-15：主入口 `/agent-loop/sliderule` 只把 id 写在 localStorage，
 *   刷新 / 应用中心整页跳 / 复刻链接都指回光秃秃的路径——用户说「刷新丢会话」。
 *   地址栏才是可收藏的权威，localStorage 降成 fallback。查询键只许这一处。
 */
export const DEFAULT_SESSION_ID = "sliderule-v51-product";

/** 地址栏上的会话键。开发态 `/sliderule/dev?session=` 早就用这个字。 */
export const SESSION_QUERY_KEY = "session";

export class SessionIdMismatchError extends Error {
  constructor(
    readonly driveSessionId: string,
    readonly shellSessionId: string
  ) {
    super(
      `会话错位：推演 ${driveSessionId} ≠ 当前 ${shellSessionId}，拒绝点火`
    );
    this.name = "SessionIdMismatchError";
  }
}

/** 点火前：消息落库的会话必须等于本次推演的会话。不等就拒绝，不许静默择一。 */
export function assertDriveSessionMatchesShell(
  driveSessionId: string | null | undefined,
  shellSessionId: string | null | undefined
): string {
  const shell = String(shellSessionId || "").trim();
  if (!shell) {
    throw new SessionIdMismatchError("", "");
  }
  const drive = String(driveSessionId || "").trim();
  if (drive && drive !== shell) {
    throw new SessionIdMismatchError(drive, shell);
  }
  return shell;
}

export function sessionIdFromSearch(search: string): string | null {
  const raw = String(search || "").trim();
  if (!raw) return null;
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  try {
    const id = String(new URLSearchParams(query).get(SESSION_QUERY_KEY) || "").trim();
    return id || null;
  } catch {
    return null;
  }
}

/** SSR / 残缺 window 上 location.href 可能根本不在。 */
export function hrefFromWindow(win: { location?: { href?: string } } | undefined | null): string {
  const href = win?.location?.href;
  return typeof href === "string" ? href : "";
}

export function sessionIdFromHref(href: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  try {
    return sessionIdFromSearch(new URL(raw, "https://sliderule.local").search);
  } catch {
    return sessionIdFromSearch(raw);
  }
}

/**
 * 推演页才把 session 写进地址栏。工作台 / 设置带着别人的查询串，
 * 不许被切换会话顺手改掉。
 */
export function isSliderulePath(pathname: string): boolean {
  const path = String(pathname || "").split(/[?#]/, 1)[0];
  const trimmed = path.replace(/\/+$/, "") || "/";
  const n = trimmed.toLowerCase();
  return (
    n === "/agent-loop" ||
    n.endsWith("/agent-loop") ||
    n === "/agent-loop/sliderule" ||
    n.endsWith("/agent-loop/sliderule")
  );
}

export function hrefWithSession(href: string, sessionId: string): string {
  const id = String(sessionId || "").trim();
  const raw = String(href || "").trim();
  if (!id || !raw) return raw;
  try {
    const url = new URL(raw, "https://sliderule.local");
    url.searchParams.set(SESSION_QUERY_KEY, id);
    if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(raw)) return url.href;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
}

export function slideruleSessionPath(sessionId: string): string {
  return hrefWithSession("/agent-loop/sliderule", sessionId);
}

/** URL 有就听 URL；没有再听存储；再没有才掉进历史兜底桶。 */
export function resolveActiveSessionId(input: {
  urlSession?: string | null;
  stored?: string | null;
  fallback?: string;
}): string {
  const url = String(input.urlSession || "").trim();
  if (url) return url;
  const stored = String(input.stored || "").trim();
  if (stored) return stored;
  return String(input.fallback || DEFAULT_SESSION_ID);
}

export function applySessionToHistory(
  history: {
    state: unknown;
    pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
    replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
  },
  href: string,
  sessionId: string,
  mode: "push" | "replace"
): string | null {
  let pathname = "";
  try {
    pathname = new URL(href, "https://sliderule.local").pathname;
  } catch {
    pathname = String(href || "").split(/[?#]/, 1)[0];
  }
  if (!isSliderulePath(pathname)) return null;
  const next = hrefWithSession(href, sessionId);
  if (!next || next === href) return null;
  const prior =
    history.state && typeof history.state === "object"
      ? (history.state as Record<string, unknown>)
      : {};
  if (mode === "replace") history.replaceState(prior, "", next);
  else history.pushState({ ...prior, sessionId }, "", next);
  return next;
}
