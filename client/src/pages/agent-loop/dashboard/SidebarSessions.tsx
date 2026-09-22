/**
 * SidebarSessions — 侧栏会话区。
 *
 * ⚠ 2026-08-19：先铺过今天/昨天整表，侧栏被撑出屏幕；又收成「最近 6 条」
 *   把筛选一起撤了。用户要留着筛选，列表改成「最近 4 + 近七天 6」，
 *   超高就在列表里滚，再多走「更多」去应用中心。
 *   行样式是小方图 + 标题 + 副行（设备 / 日期 / 已分享或私有）。
 *   可见性来自关联应用，不是会话本身——会话恒 private，分享的是应用。
 *
 * 数据：GET /api/sliderule/sessions（python 会话库）。切换/新建只做两件事：
 * 写 localStorage 的 active-session-id + 广播 window 事件——SlideRule 会话壳
 * 监听事件后以 key=sessionId 整树重挂完成水合。列表拉取失败如实显示。
 */

import React from "react";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import {
  DEFAULT_SESSION_ID,
  applySessionToHistory,
  hrefFromWindow,
  resolveActiveSessionId,
  sessionIdFromHref,
} from "@/lib/sliderule-session-id";
import { listApps, type AppStoreSummary } from "./app-store-client";
import {
  SESSION_THUMB_APP_LIMIT,
  SessionThumb,
  indexAppsBySession,
  sessionRowTitle,
} from "./session-thumb";
import { useShellSidebar } from "@/pages/sliderule/ShellSidebarContext";
import { fetchSessionsList, invalidateSessionsList } from "./sessions-list-client";

export const ACTIVE_SESSION_KEY = "sliderule:active-session-id";
export const SESSION_CHANGED_EVENT = "sliderule:active-session-changed";
/** 会话库内容有更新（话题落盘/推演完成）——侧栏收到后重拉列表，
 *  标题从"新会话"实时变成话题文案。 */
export const SESSIONS_UPDATED_EVENT = "sliderule:sessions-updated";

export function notifySessionsUpdated(): void {
  window.dispatchEvent(new CustomEvent(SESSIONS_UPDATED_EVENT));
}

export interface SessionMeta {
  sessionId: string;
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  artifactCount?: number;
  phase?: string;
}

/**
 * 新会话 id：**向服务端要**，不在本地生成（2026-08-06）。
 *
 * ## 为什么挪到后端
 *
 * 原来是 `sr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
 * —— 5 位 base36 ≈ **25 位熵**，而且 Math.random() 不是加密安全的。服务端那份
 * 是 50 位 Crockford Base32 + 存在性检查（slide_rule_session._new_session_id）。
 *
 * 更要紧的是**权威归属**：id 由谁生成，就决定了"这条会话是谁的"这件事由谁说了算。
 * 客户端生成时服务端只能被动接受，实测出过一个劫持漏洞——攻击者拿着别人的
 * sessionId 发一次 POST 就能把整条会话连内容带归属一起夺走（已在服务端补了查重，
 * 见 routes/sliderule_full.create_sess）。id 从服务端出，这类问题从根上少一类。
 *
 * ## 代价：会话变成「点了就建」
 *
 * 之前是懒创建——本地先有个 id，用户真发第一条消息才落库，所以点开不发消息
 * 不会留下痕迹。现在点一次就在库里建一条。空会话会累积，这是有意接受的取舍：
 * 换来的是"客户端说的 id 服务端不必相信"。
 *
 * 侧栏那个「新建会话」按钮本来就只在用户主动点击时触发，不是页面加载就调，
 * 所以不会因为有人打开一次首页就凭空多一条。
 *
 * ## 失败怎么办
 *
 * 抛出去，由调用方决定怎么提示。**不回落到本地生成** —— 那等于把刚拆掉的
 * 弱路径又留了个后门，而且失败的真实原因通常是"没登录"（建会话已要求登录），
 * 悄悄给一个本地 id 只会让用户在下一步撞得更莫名其妙。
 */
export async function createSessionId(): Promise<string> {
  const res = await fetch("/api/sliderule/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: { text: "" } }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "请先登录后再新建会话" : `新建会话失败（HTTP ${res.status}）`
    );
  }
  const body = (await res.json()) as { sessionId?: string };
  const sid = String(body?.sessionId || "").trim();
  if (!sid) throw new Error("服务端没有返回 sessionId");
  return sid;
}

/**
 * 「这条会话可以直接拿来当新会话用吗」。
 *
 * ⚠ 2026-08-27 用户报「点新建会话右侧显示有问题」，追下去是两条：布局那条
 *   在 studio-layout.needsEmptySessionRestore；这条是**新建会话根本没新建**。
 *
 *   E28 防双开原来的判据是 `!meta.goal`。PR-4 控制面上线后，便宜轮
 *   （问候 / 搜索 / ask_user）**刻意不写 goal**——goal 只在确认 rehearse 时
 *   由 _write_confirmed_goal 写入（KD17）。于是一条装满控制面对话的会话
 *   仍被判为"空"，点新建会话直接复用了它：用户看到的是上一轮的内容，
 *   叠上舞台最大化就成了那张"中间全空、打不了字"的死角图。
 *
 *   又是「只改一半」：控制面改了 goal 的写入时机，这条空判据没跟着改。
 *
 * 判据加 phase：真正全新的会话 runtimePhase 是 `idle`；控制面一停泊
 * （control_ask / control_scope）或工厂一跑就变 `awaiting`/`done`/`failed`。
 * 真机实测（同一账号、同一时刻）：
 *   全新           goal='' phase='idle'    createdAt == lastActive
 *   问候+搜索之后  goal='' phase='awaiting' lastActive 比 createdAt 晚 56 分钟
 *
 * 用 phase 而不是时间戳差：时间戳会被"只是打开看了一眼"的落盘顶掉，
 * phase 说的是这条会话有没有真的跑过东西。
 */
export function isBlankSessionMeta(
  meta: { goal?: string | null; phase?: string | null } | null | undefined
): boolean {
  if (!meta) return true; // 不在列表里 = 刚建未落盘
  if (meta.goal) return false;
  const phase = String(meta.phase || "").trim().toLowerCase();
  return phase === "" || phase === "idle";
}

export type NewSessionAction = "reuse-active" | "create";

/**
 * 点「新建会话」时只许做两件事之一：
 *   reuse-active  当前这条就是真正的空会话 → 站住，别再铸一条
 *   create        其它情况 → 向服务端要新 id
 *
 * ⚠ 不许扫列表里「别的」空壳拿来当新会话。那条 2026-08-27 真机就是：
 *   上一条 goal 空但已经聊过，被当成空壳复用，点新建还是旧内容。
 * 当前这条空着再点新建，才复用——铸 id 等于库里多一行，连点会堆空会话。
 */
export function decideNewSessionAction(opts: {
  activeId: string;
  activeMeta: { goal?: string | null; phase?: string | null } | null | undefined;
}): NewSessionAction {
  if (opts.activeId === DEFAULT_SESSION_ID) return "create";
  return isBlankSessionMeta(opts.activeMeta) ? "reuse-active" : "create";
}

export type SessionSort = "active" | "created";
export type SessionPhaseFilter = "all" | "running" | "done" | "failed";

/** 排序键。active = lastActive 优先；created = createdAt 优先。都缺沉底。 */
export function sessionSortTime(s: SessionMeta, order: SessionSort): string {
  return order === "created"
    ? String(s.createdAt ?? s.lastActive ?? "")
    : String(s.lastActive ?? s.createdAt ?? "");
}

export function sortSessions(
  sessions: SessionMeta[],
  order: SessionSort = "active",
): SessionMeta[] {
  return [...sessions].sort((a, b) =>
    sessionSortTime(b, order).localeCompare(sessionSortTime(a, order)),
  );
}

/** 最近活跃倒序（无时间戳的沉底，稳定排序）。 */
export function sortSessionsByRecency(sessions: SessionMeta[]): SessionMeta[] {
  return sortSessions(sessions, "active");
}

export const SIDEBAR_RECENT_LIMIT = 4;
export const SIDEBAR_WEEK_LIMIT = 6;

export function isWithinLast7Days(
  iso: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const g = sessionAgeGroup(iso, now);
  return g === "today" || g === "yesterday" || g === "week";
}

/**
 * 已经排好序的名单：头 4 条进「最近」，其后 7 天内再取 6 条进「近七天」，
 * 剩下的 hiddenCount 走「更多」。不在这里再排一次——排序由调用方的筛选项定。
 */
export function splitSidebarSessions(
  sessions: SessionMeta[],
  now: number = Date.now(),
  order: SessionSort = "active",
): { recent: SessionMeta[]; week: SessionMeta[]; hiddenCount: number } {
  const recent = sessions.slice(0, SIDEBAR_RECENT_LIMIT);
  const rest = sessions.slice(SIDEBAR_RECENT_LIMIT);
  const week = rest
    .filter(s => isWithinLast7Days(sessionSortTime(s, order) || null, now))
    .slice(0, SIDEBAR_WEEK_LIMIT);
  const shown = new Set([...recent, ...week].map(s => s.sessionId));
  return {
    recent,
    week,
    hiddenCount: sessions.filter(s => !shown.has(s.sessionId)).length,
  };
}

export function takeRecentSessions(
  sessions: SessionMeta[],
  limit: number = SIDEBAR_RECENT_LIMIT,
): { shown: SessionMeta[]; hiddenCount: number } {
  const sorted = sortSessionsByRecency(sessions);
  const n = Math.max(0, limit);
  return {
    shown: sorted.slice(0, n),
    hiddenCount: Math.max(0, sorted.length - n),
  };
}

/** 副行日期。今天 / 昨天 / M月D日。不引 AppsWorkbench。 */
export function sessionWhen(
  iso?: string | null,
  now: number = Date.now(),
): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const today0 = startOfLocalDay(now);
  if (t >= today0) return "今天";
  if (t >= today0 - DAY_MS) return "昨天";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export type SessionRowDevice = "desktop" | "phone";
export type SessionRowVisibility = "public" | "private";

/**
 * 副行设备。词表跟 composer / device_policy 对齐（desktop / phone）。
 * 没有关联应用、或 device 不是这两档 → 不画，不默认成 Web。
 */
export function sessionRowDevice(
  app?: AppStoreSummary | null,
): SessionRowDevice | null {
  if (!app) return null;
  const d = String(app.device || "").trim();
  if (d === "phone") return "phone";
  if (d === "desktop") return "desktop";
  return null;
}

/**
 * 副行可见性。只认关联应用上的 visibility。
 *
 * 无 app → null，不许伪造「已分享」（会话本身恒 private，见 app_access
 * session_record）。缺字段也不猜成 public——那是访问层的存量规则，
 * 画成已分享会把还没公开的应用端成绿灯。
 *
 * unlisted 能点开链接，算已分享，只是不进应用市场。
 */
export function sessionRowVisibility(
  app?: AppStoreSummary | null,
): SessionRowVisibility | null {
  if (!app) return null;
  const v = app.visibility;
  if (v === "private") return "private";
  if (v === "public" || v === "unlisted") return "public";
  return null;
}

export function sessionRowVisibilityLabel(kind: SessionRowVisibility): string {
  return kind === "public" ? "已分享" : "私有";
}

/**
 * 会话行副行：设备图标 + 日期 + 已分享/私有。形状对标 Stitch 项目列表
 * （手机/显示器、日期、双人「已分享」）。没有应用就不画设备/可见性。
 */
export function SessionRowMeta({
  when,
  device,
  visibility,
}: {
  when: string;
  device: SessionRowDevice | null;
  visibility: SessionRowVisibility | null;
}) {
  if (!when && !device && !visibility) return null;
  return (
    <span className="native-agent-session-meta">
      {device && (
        <span
          className="native-agent-session-chip"
          data-testid="sidebar-session-device"
          data-device={device}
          title={device === "phone" ? "应用" : "Web"}
        >
          {device === "phone" ? <PhoneGlyph /> : <MonitorGlyph />}
        </span>
      )}
      {when && <span className="native-agent-session-chip">{when}</span>}
      {visibility && (
        <span
          className="native-agent-session-chip"
          data-testid="sidebar-session-visibility"
          data-visibility={visibility}
        >
          {visibility === "public" ? <PeopleGlyph /> : <LockGlyph />}
          {sessionRowVisibilityLabel(visibility)}
        </span>
      )}
    </span>
  );
}

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function MonitorGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M21.5 20c0-2.4-1.6-4.2-4-4.6" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * 列表 ``phase`` 就是 runtimePhase。机器：
 * idle → orchestrating → awaiting | done | failed（偶发 concluded）。
 * 不是 done/failed 的（含缺字段）算推演中——老会话经常没写 phase，
 * 漏掉它们「推演中」会空。
 */
export function sessionPhaseBucket(phase: string | null | undefined): Exclude<SessionPhaseFilter, "all"> {
  const p = String(phase ?? "").trim().toLowerCase();
  if (p === "failed") return "failed";
  if (p === "done" || p === "concluded") return "done";
  return "running";
}

export function filterSessionsByPhase(
  sessions: SessionMeta[],
  phase: SessionPhaseFilter,
): SessionMeta[] {
  if (phase === "all") return sessions;
  return sessions.filter(s => sessionPhaseBucket(s.phase) === phase);
}

export type SessionAgeGroup = "today" | "yesterday" | "week" | "month" | "older";

export const SESSION_AGE_LABELS: Record<SessionAgeGroup, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "近 7 天",
  month: "近 30 天",
  older: "更早",
};

const AGE_ORDER: SessionAgeGroup[] = ["today", "yesterday", "week", "month", "older"];
const DAY_MS = 86_400_000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 按本地日历分桶。now 可注入，避免测试撞 CI 时区的「现在」。 */
export function sessionAgeGroup(
  iso: string | null | undefined,
  now: number = Date.now(),
): SessionAgeGroup {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "older";
  const today0 = startOfLocalDay(now);
  if (t >= today0) return "today";
  if (t >= today0 - DAY_MS) return "yesterday";
  if (t >= today0 - 7 * DAY_MS) return "week";
  if (t >= today0 - 30 * DAY_MS) return "month";
  return "older";
}

export function groupSessionsByAge(
  sessions: SessionMeta[],
  now: number = Date.now(),
  order: SessionSort = "active",
): { id: SessionAgeGroup; label: string; sessions: SessionMeta[] }[] {
  const buckets: Record<SessionAgeGroup, SessionMeta[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    older: [],
  };
  for (const s of sessions) {
    buckets[sessionAgeGroup(sessionSortTime(s, order) || null, now)].push(s);
  }
  return AGE_ORDER.filter(id => buckets[id].length > 0).map(id => ({
    id,
    label: SESSION_AGE_LABELS[id],
    sessions: buckets[id],
  }));
}

/** 搜标题。空串原样返回——清空搜索必须回到全表，不能搜出空。 */
export function filterSessionsByQuery(sessions: SessionMeta[], query: string): SessionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(s => (s.goal || "").toLowerCase().includes(q));
}

/** 切换当前会话：地址栏权威 + 存储兜底 + 广播（SlideRule 壳整树重挂）。 */
export function activateSession(
  sessionId: string,
  opts?: { history?: "push" | "replace" | "none" }
): void {
  const id = String(sessionId || "").trim();
  if (!id) return;
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } catch {
    /* 隐私模式降级：事件仍然广播，本次内存态生效 */
  }
  if (opts?.history !== "none" && typeof window !== "undefined") {
    applySessionToHistory(
      window.history,
      hrefFromWindow(window),
      id,
      opts?.history ?? "push"
    );
  }
  window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT, { detail: { sessionId: id } }));
}

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function readActiveSessionId(): string {
  const url = sessionIdFromHref(
    typeof window !== "undefined" ? hrefFromWindow(window) : ""
  );
  return resolveActiveSessionId({ urlSession: url, stored: readStoredSessionId() });
}

export function SidebarSessions({
  onOpenSliderule,
  onOpenWorkbench,
}: {
  onOpenSliderule?: () => void;
  onOpenWorkbench?: () => void;
}) {
  const [sessions, setSessions] = React.useState<SessionMeta[] | null>(null);
  const [apps, setApps] = React.useState<AppStoreSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [sortOrder, setSortOrder] = React.useState<SessionSort>("active");
  const [phaseFilter, setPhaseFilter] = React.useState<SessionPhaseFilter>("all");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const creatingSessionRef = React.useRef(false);
  const [creatingSession, setCreatingSession] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = React.useState<string>(() => readActiveSessionId());
  // 两步删除确认：第一次点垃圾桶进入待确认（变红），再点才真删；点别处/超时复位
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const shell = useShellSidebar();
  const rail = shell?.collapsed ?? false;
  const [recentsOpen, setRecentsOpen] = React.useState(false);
  const recentsRef = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback(() => {
    // 与应用中心共享同一次请求（见 sessions-list-client 的说明）：两边在同一
    // 拍挂载，各拉一次等于白打一发。
    fetchSessionsList()
      .then((body) => {
        setSessions((body.sessions ?? []) as SessionMeta[]);
        setError(null);
      })
      .catch((e) => setError(String(e)));
    if (IS_GITHUB_PAGES) return;
    listApps({ limit: SESSION_THUMB_APP_LIMIT, offset: 0 })
      .then(rows => setApps(rows))
      .catch(() => setApps([]));
  }, []);

  React.useEffect(() => {
    refresh();
    const onChanged = () => {
      setActiveId(readActiveSessionId());
      refresh();
    };
    const onPop = () => setActiveId(readActiveSessionId());
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    window.addEventListener("popstate", onPop);
    // 话题落盘/推演完成后重拉：当前会话标题从"新会话"实时变成话题
    window.addEventListener(SESSIONS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(SESSIONS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  React.useEffect(() => {
    if (!confirmDeleteId) return;
    const t = window.setTimeout(() => setConfirmDeleteId(null), 3500);
    return () => window.clearTimeout(t);
  }, [confirmDeleteId]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!menuRef.current?.contains(ev.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  React.useEffect(() => {
    if (!rail) setRecentsOpen(false);
  }, [rail]);

  React.useEffect(() => {
    if (!recentsOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (!recentsRef.current?.contains(ev.target as Node)) setRecentsOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setRecentsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [recentsOpen]);

  const pick = (id: string) => {
    if (id !== activeId) activateSession(id);
    setActiveId(id);
    setRecentsOpen(false);
    onOpenSliderule?.();
  };

  const remove = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(String(e));
      return;
    }
    // 列表变了：清掉共享取数的飞行槽，保证下一个调用方一定发新请求，
    // 不会跟一次"删之前发出的"请求合流拿到旧列表（删了还在列表里）。
    invalidateSessionsList();
    const remaining = (sessions ?? []).filter((s) => s.sessionId !== id);
    setSessions(remaining);
    notifySessionsUpdated();
    // 删的是当前会话：切到最近的剩余会话；一个不剩才向服务端要一个新的
    if (id === activeId) {
      let next = remaining[0]?.sessionId;
      if (!next) {
        try {
          next = await createSessionId();
        } catch (e) {
          setError(String(e instanceof Error ? e.message : e));
          return;
        }
      }
      activateSession(next);
      setActiveId(next);
    }
  };

  const named = (sessions ?? []).filter(s => (s.goal || "").trim());
  const listed = sortSessions(
    filterSessionsByPhase(filterSessionsByQuery(named, query), phaseFilter),
    sortOrder,
  );
  const { recent, week, hiddenCount } = splitSidebarSessions(
    listed,
    Date.now(),
    sortOrder,
  );
  const appsBySession = React.useMemo(() => indexAppsBySession(apps), [apps]);
  const filterDirty = sortOrder !== "active" || phaseFilter !== "all";

  const openWorkbench = (ev: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenWorkbench) return;
    ev.preventDefault();
    onOpenWorkbench();
  };

  const renderRow = (s: SessionMeta) => {
    const active = s.sessionId === activeId;
    const confirming = confirmDeleteId === s.sessionId;
    const when = sessionWhen(s.lastActive || s.createdAt);
    const app = appsBySession.get(s.sessionId);
    const title = sessionRowTitle(s.goal, app);
    return (
      <div
        key={s.sessionId}
        className={`native-agent-session-row${active ? " native-agent-session-row-active" : ""}`}
      >
        <button
          type="button"
          title={String(s.goal || "").trim() || title}
          data-testid={`sidebar-session-item-${s.sessionId}`}
          className="native-agent-session-item"
          onClick={() => pick(s.sessionId)}
        >
          <SessionThumb
            sessionId={s.sessionId}
            title={title}
            app={app}
            phase={s.phase}
            goal={s.goal}
          />
          <span className="native-agent-session-copy">
            <span className="native-agent-session-title">{title}</span>
            <SessionRowMeta
              when={when}
              device={sessionRowDevice(app)}
              visibility={sessionRowVisibility(app)}
            />
          </span>
        </button>
        <button
          type="button"
          title={confirming ? "再点一次确认删除" : "删除会话"}
          aria-label={confirming ? "确认删除" : "删除会话"}
          data-testid={`sidebar-session-delete-${s.sessionId}`}
          className={`native-agent-session-delete${confirming ? " native-agent-session-delete-confirm" : ""}`}
          onClick={ev => {
            ev.stopPropagation();
            if (confirming) void remove(s.sessionId);
            else setConfirmDeleteId(s.sessionId);
          }}
        >
          {confirming ? "确认" : (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="native-agent-sessions" data-testid="sidebar-sessions">
      <button
        type="button"
        className="native-agent-session-new"
        data-testid="sidebar-session-new"
        title="新建会话"
        disabled={creatingSession}
        onClick={() => {
          // 只复用**当前**这条空会话。扫列表里别的空壳 = 2026-08-27
          // 把聊过的会话当新建（goal 空）。当前这条空着再点，才站住——
          // 铸 id 等于库里多一行。
          if (creatingSessionRef.current) return;
          const list = sessions ?? [];
          const activeMeta = list.find((s) => s.sessionId === activeId);
          if (
            decideNewSessionAction({ activeId, activeMeta }) === "reuse-active"
          ) {
            pick(activeId);
            return;
          }
          creatingSessionRef.current = true;
          setCreatingSession(true);
          void (async () => {
            try {
              pick(await createSessionId());
            } catch (e) {
              setError(String(e instanceof Error ? e.message : e));
            } finally {
              creatingSessionRef.current = false;
              setCreatingSession(false);
            }
          })();
        }}
      >
        <svg className="native-agent-session-new-plus" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="native-agent-rail-copy">新建会话</span>
      </button>

      <div className="native-agent-recents-wrap" ref={recentsRef}>
        {rail ? (
          <button
            type="button"
            className={`native-agent-session-recents${recentsOpen ? " is-open" : ""}`}
            data-testid="sidebar-session-recents"
            aria-label="最近会话"
            aria-expanded={recentsOpen}
            title="最近会话"
            onClick={() => setRecentsOpen(open => !open)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
        ) : null}

      <div
        className={rail ? "native-agent-session-flyout" : "native-agent-sessions-body"}
        data-testid="sidebar-session-flyout"
        hidden={rail && !recentsOpen}
      >
        {rail ? <div className="native-agent-sessions-label">最近会话</div> : null}

      <div className="native-agent-session-tools" ref={menuRef}>
        <label className="native-agent-session-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20 16.5 16.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="搜索会话"
            aria-label="搜索会话"
            data-testid="sidebar-session-search"
          />
        </label>
        <button
          type="button"
          className={`native-agent-session-filter${filterDirty ? " native-agent-session-filter-on" : ""}`}
          data-testid="sidebar-session-filter"
          aria-label="排序与筛选"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        </button>
        <div
          className="native-agent-session-menu"
          data-testid="sidebar-session-menu"
          hidden={!menuOpen}
        >
          <div className="native-agent-session-menu-cap">排序</div>
          <button type="button" data-active={sortOrder === "active"} onClick={() => setSortOrder("active")}>
            最近活跃
          </button>
          <button type="button" data-active={sortOrder === "created"} onClick={() => setSortOrder("created")}>
            创建时间
          </button>
          <div className="native-agent-session-menu-cap">阶段</div>
          <button type="button" data-active={phaseFilter === "all"} onClick={() => setPhaseFilter("all")}>
            全部
          </button>
          <button type="button" data-active={phaseFilter === "running"} onClick={() => setPhaseFilter("running")}>
            推演中
          </button>
          <button type="button" data-active={phaseFilter === "done"} onClick={() => setPhaseFilter("done")}>
            已完成
          </button>
          <button type="button" data-active={phaseFilter === "failed"} onClick={() => setPhaseFilter("failed")}>
            失败
          </button>
        </div>
      </div>

      <div className="native-agent-sessions-list" data-testid="sidebar-session-list">
        {sessions === null && !error && (
          <div className="native-agent-sessions-hint">加载中…</div>
        )}
        {error && <div className="native-agent-sessions-hint">会话列表不可用</div>}
        {sessions?.length === 0 && <div className="native-agent-sessions-hint">暂无历史会话</div>}
        {/* E30：空会话（无话题）不进列表——它们只是还没说话的壳，显示成
            一排「新会话」是纯噪音（冒烟遗留的空会话同样隐藏） */}
        {sessions && recent.length > 0 && (
          <div className="native-agent-session-group">
            <div className="native-agent-sessions-label">最近</div>
            {recent.map(renderRow)}
          </div>
        )}
        {sessions && week.length > 0 && (
          <div className="native-agent-session-group">
            <div className="native-agent-sessions-label">近七天</div>
            {week.map(renderRow)}
          </div>
        )}
        {sessions !== null && !error && listed.length === 0 && named.length > 0 && (
          <div className="native-agent-sessions-hint">没有匹配的会话</div>
        )}
      </div>
      {hiddenCount > 0 && (
        <a
          href="/agent-loop/workbench"
          className="native-agent-session-more"
          data-testid="sidebar-session-more"
          onClick={openWorkbench}
        >
          更多
        </a>
      )}
      </div>
      </div>
    </div>
  );
}
