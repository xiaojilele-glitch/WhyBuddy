// HTTP adapter + presenter for the AgentLoop dashboard.
//
// Replaces the VS Code extension host's stateReader/dashboardPanel layer: fetches the
// Python `/api/agent-loop/*` endpoints and projects their raw run state into the
// OverviewPayload / DetailPayload shapes that DashboardApp renders.

import type {
  AgentLoopSettingsViewModel,
  DetailPayload,
  OverviewPayload,
  OverviewTask,
  PythonHealthStatus,
  PythonHealthViewModel,
} from "./dashboardTypes";
import {
  activeAgentLabel,
  buildPipelineSteps,
  formatElapsed,
  isAttentionStatus,
  isDoneStatus,
  isRunningStatus,
  outcomeGroupFor,
  phaseLabel,
  resolveAgentRoles,
} from "./phaseLabels";
import { fetchJsonSafe, isPythonBackendFailure, isDegradedApiError } from "@/lib/api-client";

const BASE = "/api/agent-loop";

export type AgentLoopRunSummary = {
  runId: string;
  status?: string | null;
  task?: string | null;
  runMode?: string | null;
  iterations?: number | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  runTimeLocal?: string | null;
  runTimeUtc?: string | null;
};

export type RunEventSubscriptionHandlers = {
  onEvent?: (payload: Record<string, unknown>) => void;
  onSnapshot?: (payload: Record<string, unknown>) => void;
  onPing?: (payload: Record<string, unknown>) => void;
  onError?: (error: unknown) => void;
};

function shortTaskLabel(taskPath: string | null | undefined): string {
  if (!taskPath) return "-";
  return (taskPath.split("/").pop() || taskPath).replace(/\.md$/, "");
}

function agentPair(fix?: string | null, review?: string | null): string {
  const f = fix || "grok";
  const r = review || "codex";
  return `${f} / ${r}`;
}

function formatClock(ts: string | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 写接口的 401 说人话（2026-08-04）。
 *
 * 后端给 5 个写接口加了登录要求（`/queue/run` `/task/run` `/rerun` `/cancel`
 * `/settings`）——此前这几个**谁都能调**：真起 LLM 任务、取消别人正在跑的
 * 东西、改全局设置。这个文件里用到其中 4 个（`/rerun` 前端没有调用点）。
 *
 * 加守卫之后匿名用户会撞上 401，裸抛 `HTTP 401` 没人看得懂它要你干嘛。
 *
 * 读接口（运行列表/事件流/面板）不受影响，仍然匿名可读。
 */
function writeFailure(path: string, status: number): Error {
  if (status === 401) return new Error("请先登录后再执行（运行、取消、改设置需要账号）");
  return new Error(`POST ${path} → HTTP ${status}`);
}

async function getJson<T>(url: string): Promise<T> {
  // Use normalized fetchJsonSafe so Python error/timeout/degraded/legacy envelopes surface (105 req1)
  const result = await fetchJsonSafe<T>(url);
  if (!result.ok) {
    const short = url.replace(/.*\/api\/agent-loop/, "/api/agent-loop");
    const pyFail = isPythonBackendFailure(result.error) ? " [python-degraded]" : "";
    const degraded = isDegradedApiError(result.error) ? " [degraded]" : "";
    throw new Error(`${short} → HTTP ${result.error.status ?? "?"} ${pyFail}${degraded} ${result.error.message}`);
  }
  return result.data;
}

function parseSseJson(event: MessageEvent): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(event?.data || "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildRunEventsStreamUrl(runId: string, live = true): string {
  const suffix = live ? "?live=1" : "";
  return `${BASE}/runs/${encodeURIComponent(runId)}/events/stream/v2${suffix}`;
}

export function subscribeRunEvents(
  runId: string | null | undefined,
  handlers: RunEventSubscriptionHandlers = {},
): () => void {
  if (!runId || typeof EventSource === "undefined") {
    return () => undefined;
  }
  const source = new EventSource(buildRunEventsStreamUrl(String(runId), true));
  source.addEventListener("event", (event) => handlers.onEvent?.(parseSseJson(event as MessageEvent)));
  source.addEventListener("snapshot", (event) => handlers.onSnapshot?.(parseSseJson(event as MessageEvent)));
  source.addEventListener("ping", (event) => handlers.onPing?.(parseSseJson(event as MessageEvent)));
  source.onerror = (error) => handlers.onError?.(error);
  return () => source.close();
}

// ---- Overview -------------------------------------------------------------

function summaryToTask(run: AgentLoopRunSummary): OverviewTask {
  const running = isRunningStatus(run.status);
  return {
    id: run.runId,
    task: run.task || run.runId,
    taskLabel: shortTaskLabel(run.task),
    statusLabel: phaseLabel(run.status),
    outcomeGroup: outcomeGroupFor(run.status, running),
    running,
    enabled: true,
    agent: agentPair(run.fixAgent, run.reviewAgent),
    fixAgent: run.fixAgent ?? null,
    reviewAgent: run.reviewAgent ?? null,
    lastUpdatedText: run.runTimeLocal || run.runTimeUtc || "-",
  };
}

function deriveCounts(runs: AgentLoopRunSummary[]): Record<string, number> {
  let running = 0;
  let done = 0;
  let reviewed = 0;
  let failed = 0;
  let pending = 0;
  for (const run of runs) {
    if (isRunningStatus(run.status)) running += 1;
    else if (isDoneStatus(run.status)) {
      done += 1;
      if (String(run.status || "").toUpperCase().includes("REVIEW")) reviewed += 1;
    } else if (isAttentionStatus(run.status)) failed += 1;
    else pending += 1;
  }
  return {
    queueTotal: runs.length,
    total: runs.length,
    running,
    done,
    reviewed,
    failed,
    pending,
  };
}

export async function fetchOverview(): Promise<OverviewPayload> {
  try {
    const overview = await getJson<OverviewPayload>(`${BASE}/queue/overview`);
    const tasks = Array.isArray(overview?.tasks) ? overview.tasks : [];
    const counts = overview?.counts && typeof overview.counts === "object" ? overview.counts : {};
    return {
      queueRunning: Boolean(overview?.queueRunning),
      queuePath: overview?.queuePath ?? null,
      latestQueuePath: overview?.latestQueuePath ?? null,
      queueStale: Boolean(overview?.queueStale),
      availableQueues: Array.isArray(overview?.availableQueues) ? overview.availableQueues : [],
      counts,
      tasks,
      current: overview?.current ?? null,
      landing: overview?.landing ?? null,
    };
  } catch {
    const runs = await getJson<AgentLoopRunSummary[]>(`${BASE}/runs/overview`);
    const list = Array.isArray(runs) ? runs : [];
    const tasks = list.map(summaryToTask);
    const counts = deriveCounts(list);
    const currentRun = list.find((run) => isRunningStatus(run.status)) || null;
    return {
      queueRunning: Boolean(currentRun),
      counts,
      tasks,
      current: currentRun
        ? {
            taskLabel: shortTaskLabel(currentRun.task),
            phaseLabel: phaseLabel(currentRun.status),
            status: currentRun.status ?? null,
            elapsedText: null,
          }
        : null,
    };
  }
}

// ---- Detail ---------------------------------------------------------------

type RawState = {
  runId?: string | null;
  status?: string | null;
  task?: { path?: string | null } | string | null;
  options?: { task?: string | null; fixAgent?: string | null; reviewAgent?: string | null; skipReview?: boolean | null } | null;
  iterations?: Array<Record<string, unknown>> | null;
  events?: Array<{ status?: string | null; ts?: string | null; iteration?: number | null }> | null;
  reviewRounds?: Array<Record<string, unknown>> | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  commit?: string | null;
  landing?: Record<string, unknown> | null;
  artifacts?: Array<{ id?: string; kind?: string; title?: string | null; path?: string | null; content?: string | null }> | null;
  agentReview?: Record<string, unknown> | null;
  codexReview?: Record<string, unknown> | null;
  grokReview?: Record<string, unknown> | null;
};

function taskPathOf(state: RawState): string | null {
  if (typeof state.task === "string") return state.task;
  if (state.task && typeof state.task === "object") return state.task.path ?? null;
  return state.options?.task ?? null;
}

function markPipeline(steps: ReturnType<typeof buildPipelineSteps>, state: RawState) {
  const seen = new Set((state.events || []).map((e) => String(e.status || "")));
  const status = state.status || "";
  return steps.map((step) => {
    const reached = seen.has(step.key);
    const active = step.key === status;
    // DONE step is done when the run reached any terminal DONE_* status.
    const done = step.key === "DONE" ? isDoneStatus(status) : reached && !active;
    return { ...step, done, active };
  });
}

function elapsedMsOf(state: RawState): number {
  const start = state.startedAt ? new Date(state.startedAt).getTime() : NaN;
  const end = state.updatedAt ? new Date(state.updatedAt).getTime() : Date.now();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, end - start);
}

export async function fetchDetail(runId: string): Promise<DetailPayload> {
  const state = await getJson<RawState>(`${BASE}/runs/${encodeURIComponent(runId)}`);
  // Best effort: also pull snapshot for richer replay-derived fields (reviewVerdict, flow, etc.)
  let snap: any = {};
  try {
    snap = await getJson(`${BASE}/runs/${encodeURIComponent(runId)}/snapshot`);
  } catch {}
  const roles = resolveAgentRoles(state);
  const steps = markPipeline(buildPipelineSteps(state), state);
  const elapsedMs = elapsedMsOf(state);

  const events = (state.events || []).map((event) => ({
    status: event.status ?? null,
    label: phaseLabel(event.status),
    timeText: formatClock(event.ts),
    iteration: event.iteration ?? null,
  }));

  const reviewRounds = (state.reviewRounds || []).map((round) => ({
    round: round.round ?? null,
    verdict: round.verdict ?? null,
    decision: round.decision ?? null,
    summary: round.summary ?? null,
    riskLevel: round.riskLevel ?? null,
    findings: Array.isArray(round.findings) ? round.findings : [],
  }));

  const iterations = (state.iterations || []).map((iteration, index) => ({
    iteration: (iteration.iteration as number) ?? index + 1,
    ...iteration,
  }));

  const encId = encodeURIComponent(state.runId ?? runId);

  // Derive report/landing/state paths from artifact truth (111).
  // Use explicit /artifacts/{name} subroutes (distinct per semantic resource).
  // Fall back only if no artifact index entry (missing degrades cleanly, no crash, no lie).
  // Never collapse distinct artifacts onto identical generic routes.
  const arts = (state.artifacts || []) as Array<{ id?: string; kind?: string; title?: string | null; path?: string | null; content?: string | null }>;
  function pickArt(cands: string[], kindHint?: string): string | null {
    for (const c of cands) {
      if (arts.some((a) => a && (a.id === c || a.path === c || (a.title || "") === c))) return c;
    }
    if (kindHint) {
      const m = arts.find((a) => a && ((a.kind || "").includes(kindHint) || (a.id || "").includes(kindHint)));
      if (m && m.id) return m.id;
    }
    return null;
  }
  const reportMd = pickArt(["final-report.md", "report.md", "final-report"], "report");
  const reportJson = pickArt(["final-report.json", "report.json"], "report");
  const landingArt = pickArt(["landing.json", "landing"], "landing");
  const stateArt = pickArt(["state.json"], "state");

  const reportP = reportMd ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(reportMd)}` : `${BASE}/runs/${encId}`;
  const reportJsonP = reportJson ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(reportJson)}` : (reportP !== `${BASE}/runs/${encId}` ? reportP : `${BASE}/runs/${encId}`);
  const landingP = landingArt ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(landingArt)}` : `${BASE}/runs/${encId}/snapshot`;
  const stateP = stateArt ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(stateArt)}` : `${BASE}/runs/${encId}/snapshot`;

  // Derive the fields the UI tabs expect (Diff / Agent 输出 / Review).
  // These come from artifact contents (bounded) or fallbacks.
  // Diff: prefer explicit diff/patch artifact content.
  let diffText: string | null = null;
  let agentTail: string | null = null;
  for (const a of arts) {
    const name = ((a.id || a.path || a.title) || "").toLowerCase();
    const content = (a.content || "").toString();
    if (!diffText && content && (name.includes("diff") || name.includes("patch"))) {
      diffText = content;
    }
    if (!agentTail && content && (name.includes("log") || name.includes("stdout") || name.includes("stderr") || name.includes("agent") || name.includes("worker") || name.includes("output"))) {
      agentTail = content;
    }
  }
  // Fallback for diff: last iteration may carry raw diff/patch
  if (!diffText && iterations.length) {
    const lastIt = iterations[iterations.length - 1] as any;
    diffText = lastIt?.diff || lastIt?.patch || lastIt?.diffText || null;
  }

  // Review rounds: if backend didn't put reviewRounds at top level, try to derive simple rounds from events
  let finalReviewRounds = reviewRounds;
  if (!finalReviewRounds.length) {
    const reviewEvents = (state.events || []).filter((e: any) => {
      const st = String(e.status || e.type || "").toUpperCase();
      return st.includes("REVIEW") || st.includes("VERDICT");
    });
    if (reviewEvents.length) {
      finalReviewRounds = reviewEvents.map((e: any, i: number) => {
        const p = e.payload || e;
        return {
          round: e.iteration ?? i + 1,
          verdict: p.verdict || e.verdict || e.status || "REVIEW",
          decision: p.verdict || e.decision || e.status,
          summary: p.summary || e.summary || p.message || null,
          riskLevel: p.riskLevel || null,
          findings: Array.isArray(p.findings) ? p.findings : [],
        };
      });
    }
  }

  // Enrich review summary from review log artifact if the structured summary is missing.
  // The review log often contains the exact JSON the reviewer output, which has the short "summary" text description.
  const reviewLog = arts.find((a: any) => {
    const n = ((a.id || a.path || a.title) || '').toLowerCase();
    return n.includes('review') && (n.includes('stdout') || n.includes('output') || n.includes('log'));
  });
  if (reviewLog?.content && finalReviewRounds.length) {
    let desc = '';
    const contentStr = String(reviewLog.content || '').trim();
    try {
      // Try to parse JSON from the log (common for structured grok/scoped reviews)
      const match = contentStr.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object') {
          desc = parsed.summary || parsed.description || parsed.text || '';
        }
      }
    } catch {}
    if (!desc) {
      // Fallback to truncated plain text from log
      desc = contentStr.slice(0, 300) + (contentStr.length > 300 ? '…' : '');
    }
    finalReviewRounds = finalReviewRounds.map((r: any) => ({
      ...r,
      summary: r.summary || desc || null,
    }));
  }

  // Also try to enrich from state review objects if still missing (legacy review summary locations)
  if (finalReviewRounds.length) {
    const reviewObjs = [state.agentReview, state.codexReview, state.grokReview, state.agentReview].filter(Boolean);
    for (const ro of reviewObjs) {
      if (ro && ro.summary) {
        finalReviewRounds = finalReviewRounds.map((r: any) => ({
          ...r,
          summary: r.summary || ro.summary,
        }));
        break;
      }
    }
  }

  return {
    taskLabel: shortTaskLabel(taskPathOf(state)),
    taskPath: taskPathOf(state),
    runId: state.runId ?? runId,
    status: state.status ?? null,
    phaseLabel: phaseLabel(state.status),
    elapsedText: formatElapsed(elapsedMs),
    agentText: activeAgentLabel(state.status, roles),
    fixAgent: roles.fixAgent,
    reviewAgent: roles.reviewAgent,
    commit: state.commit ?? null,
    activeTab: "review",
    pipelineSteps: steps,
    iterations,
    reviewRounds: finalReviewRounds,
    events,
    landing: state.landing ?? null,
    diffText,
    agentTail,
    artifacts: arts,
    reportPath: reportP,
    reportJsonPath: reportJsonP,
    landingPath: landingP,
    statePath: stateP,
  };
}

// ---- Settings & Control (bridge for DashboardApp settings + run buttons) ----

export async function fetchSettings(): Promise<any> {
  return getJson(`${BASE}/settings`);
}

export async function saveSettings(values: Record<string, unknown>): Promise<any> {
  // Strip secret fields: /settings backend is non-secret only; never forward or claim persistence for LLM keys
  const SECRET_KEYS = ['grokApiKey', 'openaiApiKey', 'anthropicApiKey'];
  const clean: Record<string, unknown> = {};
  let hadSecret = false;
  for (const [k, v] of Object.entries(values || {})) {
    if (SECRET_KEYS.includes(k)) {
      hadSecret = true;
      continue;
    }
    clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    if (hadSecret) {
      // explicitly do not report success for secret save/clear against nonsecret backend
      return { ok: false, secretsIgnored: true };
    }
    return { ok: true };
  }
  const res = await fetch(`${BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clean),
  });
  if (!res.ok) throw writeFailure("/settings", res.status);
  const json = await res.json();
  if (hadSecret) {
    return { ...(json && typeof json === 'object' ? json : {}), secretsIgnored: true };
  }
  return json;
}

export async function fetchProviderHealth(): Promise<any> {
  return getJson(`${BASE}/provider-health`);
}

function normalizePythonHealthStatus(value: unknown): PythonHealthStatus {
  const text = String(value ?? "").toLowerCase().replace(/[_\s]+/g, "-");
  if (text === "ready" || text === "ok" || text === "healthy" || text === "up") return "ready";
  if (text === "offline" || text === "down" || text === "unreachable") return "offline";
  if (text === "degraded" || text === "timeout" || text === "error" || text === "failed") return "degraded";
  if (text === "missing-config" || text === "missing" || text === "not-configured" || text === "unconfigured") {
    return "missing-config";
  }
  return "unknown";
}

function providerRowsFrom(raw: any): PythonHealthViewModel["providers"] {
  const source = raw?.providers ?? raw?.providerHealth ?? raw?.readiness ?? raw?.checks ?? {};
  const rows: PythonHealthViewModel["providers"] = [];
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.name ?? item.provider ?? item.id ?? "provider");
      const readiness = normalizePythonHealthStatus(item.readiness ?? item.status ?? item.state ?? item.ok);
      rows.push({ name, readiness, detail: item.detail ?? item.reason ?? item.message ?? null });
    }
    return rows;
  }
  if (source && typeof source === "object") {
    for (const [name, item] of Object.entries(source)) {
      if (item && typeof item === "object") {
        const it = item as any;
        rows.push({
          name,
          readiness: normalizePythonHealthStatus(it.readiness ?? it.status ?? it.state ?? it.ok),
          detail: it.detail ?? it.reason ?? it.message ?? null,
        });
      } else {
        rows.push({ name, readiness: normalizePythonHealthStatus(item), detail: null });
      }
    }
  }
  return rows;
}

export function normalizePythonHealthViewModel(raw: any): PythonHealthViewModel {
  const serviceRaw = raw?.service ?? raw?.python ?? raw?.backend ?? raw ?? {};
  const status = normalizePythonHealthStatus(
    serviceRaw?.status ?? serviceRaw?.state ?? raw?.status ?? raw?.state ?? (raw?.ok === true ? "ready" : raw?.ok === false ? "degraded" : null),
  );
  const providers = providerRowsFrom(raw);
  const hasMissingConfig =
    Boolean(raw?.hasMissingConfig ?? raw?.missingConfig) ||
    providers.some((provider) => provider.readiness === "missing-config");
  const effectiveStatus: PythonHealthStatus =
    status !== "unknown" ? status : hasMissingConfig ? "missing-config" : providers.some((p) => p.readiness === "degraded") ? "degraded" : "unknown";
  const label =
    effectiveStatus === "ready"
      ? "Python ready"
      : effectiveStatus === "offline"
        ? "Python offline"
        : effectiveStatus === "degraded"
          ? "Python degraded"
          : effectiveStatus === "missing-config"
            ? "Python missing-config"
            : "Python health unknown";
  return {
    service: {
      status: effectiveStatus,
      label,
      detail: serviceRaw?.detail ?? serviceRaw?.reason ?? serviceRaw?.message ?? raw?.message ?? null,
      checkedAt: serviceRaw?.checkedAt ?? raw?.checkedAt ?? raw?.updatedAt ?? null,
    },
    providers,
    hasMissingConfig,
    raw: raw && typeof raw === "object" ? stripRawSecretsDeep(raw) : null,
  };
}

export async function fetchPythonHealth(): Promise<PythonHealthViewModel> {
  try {
    const [health, providerHealth] = await Promise.allSettled([
      getJson(`${BASE}/health`),
      fetchProviderHealth(),
    ]);
    const healthRaw = health.status === "fulfilled" ? health.value : {};
    const providerRaw = providerHealth.status === "fulfilled" ? providerHealth.value : {};
    return normalizePythonHealthViewModel({
      ...(healthRaw && typeof healthRaw === "object" ? healthRaw : {}),
      providers:
        (providerRaw as any)?.providers ??
        (providerRaw as any)?.providerHealth ??
        (providerRaw as any)?.readiness ??
        providerRaw,
      providerHealth: providerRaw,
    });
  } catch (error: any) {
    return normalizePythonHealthViewModel({
      status: isPythonBackendFailure(error) ? "offline" : "degraded",
      message: error?.message || "Python health probe failed",
    });
  }
}

export async function runQueue(payload: Record<string, unknown> = {}): Promise<any> {
  // Runtime linkage (112): forward supported non-secret runtime options from settings
  // (fixAgent, reviewAgent, workerMaxTurns, workerMaxRetries, worktreeScope, activeProfile, queuePath).
  // queuePath is mapped to `queue` (the field backend CommandRequest + build uses); queuePath also kept in payload.
  // Other opts are accepted by backend model (even if some resolution owned by persisted settings/queue defaults at exec time).
  // Never include secrets (enforced by callers + saveSettings redaction; no raw key path here).
  const q = payload.queue || (payload as any).queuePath;
  const body: any = {
    mode: "queue",
    dryRun: false,
    ...(q ? { queue: q } : {}),
  };
  const rtKeys = ["fixAgent", "reviewAgent", "workerMaxTurns", "workerMaxRetries", "worktreeScope", "activeProfile", "queuePath"];
  for (const k of rtKeys) {
    if (k in payload && payload[k] != null) body[k] = payload[k];
  }
  const res = await fetch(`${BASE}/queue/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw writeFailure("/queue/run", res.status);
  return res.json();
}

export async function runSingleTask(payload: Record<string, unknown> = {}): Promise<any> {
  // Runtime linkage (112): forward supported non-secret runtime options from settings when provided by run controls.
  // Backend CommandRequest accepts them; queuePath only relevant for queue runs (mapped in runQueue).
  // Backend owns execution-time resolution from persisted active settings/queue defaults for most opts when absent.
  // Explicit contract: client forwards only non-secrets; no secret values reach this boundary.
  const task = payload.task || payload.taskPath || "";
  const body: any = { task: String(task || ""), mode: "single", dryRun: false };
  const rtKeys = ["fixAgent", "reviewAgent", "workerMaxTurns", "workerMaxRetries", "worktreeScope", "activeProfile", "queuePath"];
  for (const k of rtKeys) {
    if (k in payload && payload[k] != null) body[k] = payload[k];
  }
  const res = await fetch(`${BASE}/task/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw writeFailure("/task/run", res.status);
  return res.json();
}

export async function cancelCurrent(payload: Record<string, unknown> = {}): Promise<any> {
  const body: any = payload.task ? { task: payload.task } : {};
  const res = await fetch(`${BASE}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw writeFailure("/cancel", res.status);
  return res.json();
}

// ---- Settings View Model Adapter (112) ----
// Typed normalization: projects backend payload (effective + keys) into stable renderable UI contract.
// Explicitly strips ALL raw secret fields (by name or heuristic) so they NEVER reach nonSensitive / render state.
// Provides fields: activeProfile, fixAgent, reviewAgent, queuePath, worktreeScope, provider key status, etc.
const SECRET_KEY_NAMES = ['grokApiKey', 'openaiApiKey', 'anthropicApiKey', 'llmApiKey'];
const SECRET_KEY_RE = /(api[key]|secret|token|password|auth|credential|privatekey)/i;

function isSecretKeyName(k: string): boolean {
  if (!k) return false;
  if (SECRET_KEY_NAMES.includes(k)) return true;
  const kl = String(k).toLowerCase().replace(/[_-]/g, '');
  return SECRET_KEY_RE.test(kl);
}

function stripRawSecretsDeep(input: any): any {
  if (input == null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(stripRawSecretsDeep);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (isSecretKeyName(k)) continue;
    // drop values that look like raw API key material (never render secrets)
    if (typeof v === 'string' && v.length > 12 && /^(sk-|xai-|ghp_|AIza|anthropic|openai)/i.test(v)) continue;
    out[k] = stripRawSecretsDeep(v);
  }
  return out;
}

export function normalizeSettingsForUI(raw: any): AgentLoopSettingsViewModel {
  if (!raw || typeof raw !== 'object') {
    return { activeProfile: 'local', keys: {}, nonSensitive: {} };
  }
  const effSrc = raw.effective || raw || {};
  const cleanEff = stripRawSecretsDeep(effSrc);
  // safe keys: status strings only (map keys intentionally use *ApiKey names for provider status).
  // Never copy raw values; coerce to 'configured' | '' . Do not apply name-skip on the status map.
  const rawKeys = (raw.keys && typeof raw.keys === 'object') ? raw.keys : {};
  const safeKeys: Record<string, 'configured' | ''> = {};
  for (const [k, v] of Object.entries(rawKeys)) {
    const sv = String(v ?? '').toLowerCase().trim();
    safeKeys[k] = sv === 'configured' ? 'configured' : '';
  }
  // top level secrets in raw also stripped implicitly
  const activeProfile = (cleanEff as any).activeProfile ?? raw.activeProfile ?? 'local';
  const vm: AgentLoopSettingsViewModel = {
    activeProfile: activeProfile != null ? String(activeProfile) : 'local',
    fixAgent: (cleanEff as any).fixAgent ?? null,
    reviewAgent: (cleanEff as any).reviewAgent ?? null,
    queuePath: (cleanEff as any).queuePath ?? null,
    worktreeScope: (cleanEff as any).worktreeScope ?? null,
    baseUrl: (cleanEff as any).baseUrl ?? '',
    injectToWorker: (cleanEff as any).injectKeysToWorker ?? (cleanEff as any).injectToWorker ?? true,
    queueRunning: !!raw.queueRunning,
    keys: safeKeys,
    nonSensitive: cleanEff,
  };
  return vm;
}

// Queue defaults contract helper (112): always supported-keys only; explicitly drop workerEnv + any secret-like keys.
// Used by sync-from-settings and structured preview before calling bridge (no synthetic success).
export function filterSupportedQueuePatch(
  proposed: Record<string, unknown>,
  supported: string[] | undefined | null
): { patch: Record<string, unknown>; rejected: string[] } {
  const sup = new Set(Array.isArray(supported) ? supported : []);
  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];
  const isSecretLike = (k: string, v: unknown) =>
    /workerEnv/i.test(k) ||
    /(apiKey|secret|token|password|auth|credential|private)/i.test(k) ||
    (typeof v === "string" && /^(sk-|xai-|ghp_|AIza|anthropic-)/i.test(v));
  for (const [k, v] of Object.entries(proposed || {})) {
    if (isSecretLike(k, v)) {
      rejected.push(k);
      continue;
    }
    if (sup.size > 0 && !sup.has(k)) {
      rejected.push(k);
      continue;
    }
    patch[k] = v;
  }
  return { patch, rejected };
}
