import { create } from "zustand";

import { fetchJsonSafe } from "./api-client";

export type AdminUserRole = "user" | "admin" | "super_admin";
export type AdminUserStatus = "active" | "disabled";
export type AdminProjectStatus = "active" | "archived";
export type AdminProjectSource = "user" | "imported_local" | "demo";

export interface AdminSummary {
  users: number;
  projects: number;
  runs: number;
  failures: number;
  audit: number;
}

export interface AdminUser {
  id: string;
  email: string;
  emailNormalized?: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: AdminUserRole;
  status: AdminUserStatus;
  isSuperuser?: boolean;
  isActive?: boolean;
  emailVerifiedAt?: string | null;
    lastLoginAt?: string | null;
    lastActiveAt?: string | null;
  lastLoginIp?: string | null;
  createdAt: string;
  updatedAt?: string;
  sessions?: number;
  estimatedTokens?: number;
  estimatedCostUsd?: number;
}

export const STAFF_USERS_PATH = "/api/sliderule/account/admin/users";
export const STAFF_APPS_PATH = "/api/sliderule/account/admin/apps";
export const STAFF_SESSIONS_PATH = "/api/sliderule/account/admin/sessions";

function asIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

export function asStaffUser(raw: Record<string, unknown>): AdminUser {
  const isSuperuser =
    raw.isSuperuser === true || raw.role === "super_admin" || raw.role === "admin";
  const isActive = raw.isActive !== false && raw.status !== "disabled";
  return {
    id: String(raw.id || ""),
    email: String(raw.email || ""),
    displayName: typeof raw.displayName === "string" ? raw.displayName : null,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : null,
    role: isSuperuser ? "super_admin" : "user",
    status: isActive ? "active" : "disabled",
    isSuperuser,
    isActive,
    lastLoginAt: asIso(raw.lastLoginAt),
    lastActiveAt: asIso(raw.lastActiveAt),
    createdAt: asIso(raw.createdAt) || "",
    sessions: Number(raw.sessions) || 0,
    estimatedTokens: Number(raw.estimatedTokens) || 0,
    estimatedCostUsd: Number(raw.estimatedCostUsd) || 0,
  };
}

export interface AdminProject {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  status: AdminProjectStatus;
  source: AdminProjectSource;
  visibility?: string;
  isOfficial?: boolean;
  sessionId?: string | null;
  pageCount?: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export function asStaffProject(raw: Record<string, unknown>): AdminProject {
  const official = raw.isOfficial === true;
  const visibility = String(raw.visibility || "private");
  const name =
    String(raw.productName || "").trim() ||
    String(raw.goal || "").trim() ||
    String(raw.id || "");
  return {
    id: String(raw.id || ""),
    ownerUserId: String(raw.ownerId || ""),
    name,
    description: String(raw.goal || "") || null,
    status: "active",
    source: official ? "demo" : "user",
    visibility,
    isOfficial: official,
    sessionId: asIso(raw.sessionId),
    pageCount: Number(raw.pageCount) || 0,
    createdAt: asIso(raw.createdAt) || "",
    updatedAt: asIso(raw.updatedAt) || asIso(raw.createdAt) || "",
    archivedAt: null,
  };
}

export interface AdminRun {
  id: string;
  projectId?: string | null;
  userId?: string | null;
  status?: string | null;
  title?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  artifactCount?: number;
  [key: string]: unknown;
}

export function asStaffRun(raw: Record<string, unknown>): AdminRun {
  const id = String(raw.id || raw.sessionId || "");
  return {
    id,
    userId: raw.ownerId ? String(raw.ownerId) : null,
    status: String(raw.phase || "idle"),
    title: String(raw.goal || id),
    startedAt: asIso(raw.createdAt),
    createdAt: asIso(raw.createdAt),
    updatedAt: asIso(raw.lastActive) || asIso(raw.createdAt),
    artifactCount: Number(raw.artifactCount) || 0,
  };
}

export function isFailedRun(run: AdminRun): boolean {
  return String(run.status || "").toLowerCase() === "failed";
}

export interface AdminFailure {
  id: string;
  runId?: string | null;
  projectId?: string | null;
  message?: string | null;
  reason?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

export function asStaffFailure(run: AdminRun): AdminFailure {
  return {
    id: run.id,
    runId: run.id,
    message: run.title || run.id,
    reason: run.status || "failed",
    status: "failed",
    createdAt: run.updatedAt || run.createdAt || run.startedAt || null,
    userId: run.userId || null,
  };
}

export interface AdminAuditEntry {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

interface AdminStateSnapshot {
  summary: AdminSummary | null;
  users: AdminUser[];
  projects: AdminProject[];
  runs: AdminRun[];
  failures: AdminFailure[];
  audit: AdminAuditEntry[];
  loading: boolean;
  error: string | null;
}

export interface AdminState extends AdminStateSnapshot {
  loadSummary: () => Promise<void>;
  loadUsers: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadRuns: () => Promise<void>;
  loadFailures: () => Promise<void>;
  loadAudit: () => Promise<void>;
  loadOverview: () => Promise<void>;
  setUserActive: (userId: string, isActive: boolean) => Promise<void>;
  resetForTest: () => void;
}

const initialState: AdminStateSnapshot = {
  summary: null,
  users: [],
  projects: [],
  runs: [],
  failures: [],
  audit: [],
  loading: false,
  error: null,
};

async function fetchStaffItems<T>(
  path: string,
  map: (raw: Record<string, unknown>) => T
): Promise<{ data: T[] } | { error: string }> {
  const result = await fetchJsonSafe<{
    ok?: boolean;
    items?: Record<string, unknown>[];
    detail?: string;
    error?: string;
  }>(path, { credentials: "include" });

  if (!result.ok) {
    return { error: result.error.message || "读不到清单" };
  }
  const body = result.data;
  if (body.ok === false) {
    return { error: String(body.detail || body.error || "读不到清单") };
  }
  return {
    data: Array.isArray(body.items) ? body.items.map(row => map(row)) : [],
  };
}

async function fetchStaffItemsOpen<T>(
  path: string,
  map: (raw: Record<string, unknown>) => T
): Promise<{ data: T[] }> {
  const result = await fetchStaffItems(path, map);
  if ("error" in result) return { data: [] };
  return result;
}

function inventorySummary(
  users: AdminUser[],
  projects: AdminProject[],
  runs: AdminRun[],
  failures: AdminFailure[],
  audit: AdminAuditEntry[]
): AdminSummary {
  return {
    users: users.length,
    projects: projects.length,
    runs: runs.length,
    failures: failures.length,
    audit: audit.length,
  };
}

async function fetchStaffUsers(): Promise<{ data: AdminUser[] } | { error: string }> {
  return fetchStaffItems(STAFF_USERS_PATH, asStaffUser);
}

export const useAdminStore = create<AdminState>((set, get) => ({
  ...initialState,

  async loadSummary() {
    // 总览人数/清单都从 Python 身份前缀来。旧 Node `/api/admin/summary` 在
    // sliderule 活路径上不通电，不能再当入口。
    await get().loadOverview();
  },

  async loadUsers() {
    set({ loading: true, error: null });
    const result = await fetchStaffUsers();
    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }
    set({ users: result.data, loading: false, error: null });
  },

  async loadProjects() {
    set({ loading: true, error: null });
    const result = await fetchStaffItemsOpen(STAFF_APPS_PATH, asStaffProject);
    set({ projects: result.data, loading: false, error: null });
  },

  async loadRuns() {
    set({ loading: true, error: null });
    const result = await fetchStaffItemsOpen(STAFF_SESSIONS_PATH, asStaffRun);
    set({
      runs: result.data,
      failures: result.data.filter(isFailedRun).map(asStaffFailure),
      loading: false,
      error: null,
    });
  },

  async loadFailures() {
    set({ loading: true, error: null });
    const result = await fetchStaffItemsOpen(STAFF_SESSIONS_PATH, asStaffRun);
    set({
      runs: result.data,
      failures: result.data.filter(isFailedRun).map(asStaffFailure),
      loading: false,
      error: null,
    });
  },

  async loadAudit() {
    // 停用只翻身份库 is_active，没有单独操作流水。空表不是接口失败。
    set({ audit: [], loading: false, error: null });
  },

  async loadOverview() {
    // ⚠ 2026-08-21：总览原先 Promise.all 把 Node `/api/admin/summary` 和
    // 身份名单绑成 fail-closed。sliderule 活路径只代理 `/api/sliderule`，
    // Node 那条 500「Admin route failed」，用户名单其实已经拿到了——
    // 页面红条，人数卡全是 0。身份是证据类 fail-closed；应用/话题清单是
    // 增强类 fail-open，走同一前缀下的超管接口（对照 Gitea /admin/repos）。
    set({ loading: true, error: null });
    const [users, projects, runs] = await Promise.all([
      fetchStaffUsers(),
      fetchStaffItemsOpen(STAFF_APPS_PATH, asStaffProject),
      fetchStaffItemsOpen(STAFF_SESSIONS_PATH, asStaffRun),
    ]);

    if ("error" in users) {
      set({ loading: false, error: users.error });
      return;
    }

    const failures = runs.data.filter(isFailedRun).map(asStaffFailure);
    const audit: AdminAuditEntry[] = [];
    set({
      users: users.data,
      projects: projects.data,
      runs: runs.data,
      failures,
      audit,
      summary: inventorySummary(
        users.data,
        projects.data,
        runs.data,
        failures,
        audit
      ),
      loading: false,
      error: null,
    });
  },

  async setUserActive(userId, isActive) {
    set({ error: null });
    const result = await fetchJsonSafe<{
      ok?: boolean;
      user?: Record<string, unknown>;
      detail?: string;
    }>(`${STAFF_USERS_PATH}/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!result.ok) {
      set({ error: result.error.message || "停用失败" });
      return;
    }
    if (result.data.ok === false || !result.data.user) {
      set({ error: String(result.data.detail || "停用失败") });
      return;
    }
    const next = asStaffUser(result.data.user);
    set({
      users: get().users.map(user => (user.id === next.id ? { ...user, ...next } : user)),
      error: null,
    });
  },

  resetForTest() {
    set(initialState);
  },
}));
