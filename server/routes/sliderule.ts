/**
 * SlideRule V5 Session Store HTTP API (pilot durable).
 *
 * Provides the 4 endpoints (surface 100% unchanged from skeleton):
 *   GET    /api/sliderule/sessions           -> list
 *   GET    /api/sliderule/sessions/:sessionId -> load one
 *   PUT    /api/sliderule/sessions/:sessionId -> save (upsert)
 *   DELETE /api/sliderule/sessions/:sessionId -> delete
 *
 * Now backed by durable JSON file (data/sliderule-sessions.json) for the Durable Store Pilot.
 * In-memory Map is a hot cache only. Every mutate flushes to disk (atomic tmp+rename).
 * Loads from disk at module init. Re-init / reload-from-disk supported for smoke/tests only
 * via the test-only __reload endpoint (or the exported helper for direct use).
 *
 * HTTP surface + client HttpSlideRuleSessionStore contract remain identical and swappable.
 * (tsx watch on server/ files will pick up changes live.)
 */

import { readEnvCompat } from "../../shared/env/read-env-compat.js";
import express, { Router, type Request, type Response } from "express";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  createExecuteCapabilityLogger,
  provenanceFromBody,
} from "../sliderule/execute-capability-log.js";
// Legacy Node V5 execute paths (LLM/pool/mapped/GitHub/repo/orchestrate/narration/prompts) isolated:
// - NEVER imported at module top level (would retain business in prod route file).
// - Only dynamically imported() inside isLegacyNodeBusinessEnabled() branches or /respond legacy path.
// - Default (SLIDERULE_V5_BACKEND=python) + prod NEVER loads or reaches LLM/llm-call/narration/prompt/context/output/pool/orchestrate legacy execute.
// This advances NodeRetirement for V5 execute paths (classification: RETIRED for default path).
import {
  callPythonSlideRule,
  callPythonSlideRuleGet,
  delegateToPythonSlideRule,
  viewerHeadersFrom,
  checkPythonSlideRuleHealth,
  resolvePythonSlideRuleRuntimeConfig,
  resolvePythonDriveTimeoutMs,
  PythonSlideRuleHttpError,
} from "../sliderule/python-delegation.js";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// Re-export for test spies / external (the real interception for internal calls happens via the imported binding + vi.mock on python-delegation module)
export { callPythonSlideRule, callPythonSlideRuleGet, delegateToPythonSlideRule };

// Node sliderule routes REDUCED TO THIN PROXY COMPATIBILITY ONLY (V5.2 NodeRetirement).
// Python FastAPI owns durable session state + sanitize/replay/merge + V5 capability execution.
// Legacy Node V5 execute paths (orchestrate-plan, execute-capability mapped/LLM/GitHub/repo/pool)
// removed from static import; only dynamic import inside isLegacyNodeBusinessEnabled().
// Default SLIDERULE_V5_BACKEND=python (prod) = pure thin proxy, never loads/executes legacy business.
// Classification: execute paths = RETIRED (Node); PYTHON_AUTHORITY (Python via delegation).
// Legacy retained only for explicit non-prod compat; strict isolation per this NodeRetirement task.
//
// Dev startup clarity (sliderule-python-v52-dev-all-python-api-mode-105): `npm run dev` launches Vite which
// proxies owned /api/sliderule to Python (9700) by default. Node `dev:server` (3001) is explicit compat only
// (for sockets or SLIDERULE_V5_BACKEND=legacy). This file is thin proxy/compat shell under default.
const SESSIONS_FILE_ENV = readEnvCompat("SLIDERULE_SESSIONS_FILE");
const DATA_FILE = SESSIONS_FILE_ENV
  ? path.resolve(process.cwd(), SESSIONS_FILE_ENV)
  : path.resolve(process.cwd(), "data", "sliderule-sessions.json");
const LEGACY_DATA_FILE = path.resolve(process.cwd(), "data", "whybuddy-sessions.json");

// Thin no-op shims retained only for __tests__ that may reference; prod paths delegate.
function reloadFromDisk(): void { /* thin: Python owns durable; see delegate */ }
function flushToDisk(): boolean { return true; /* thin */ }
const sessions = new Map<string, V5SessionState>(); // retained for narrow test surface only; not written by routes

// Legacy isolation (this task): Node V5 exec business (orchestrate/LLM/pool/mapped/GitHub/repo) ONLY when
// SLIDERULE_V5_BACKEND=legacy AND (non-prod or test helper). In default python/prod: strict no-execute + no module load.
// respond path also guarded (no Python equivalent, 404 triggers client fallback).
function isLegacyNodeBusinessEnabled(): boolean {
  const mode = (process.env.SLIDERULE_V5_BACKEND || "python").toLowerCase().trim();
  if (mode === "python") return false;
  return process.env.NODE_ENV !== "production" || readEnvCompat("SLIDERULE_ENABLE_TEST_HELPERS") === "1";
}

const REQUIRED_PUBLISH_CLOSURE_SKILLS = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
] as const;

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizePublishClosureForProxy(
  publishClosure: unknown,
): Record<string, any> | "strip" | undefined {
  if (publishClosure === undefined) return undefined;
  if (!isPlainObject(publishClosure) || typeof publishClosure.blocked !== "boolean") {
    return "strip";
  }

  const perSkillEvidence = isPlainObject(publishClosure.perSkillEvidence)
    ? publishClosure.perSkillEvidence
    : {};

  if (publishClosure.blocked) {
    return { ...publishClosure, perSkillEvidence };
  }

  const hasDigest = Boolean(publishClosure.stableDigest || publishClosure.closureHash);
  const hasAllSkillEvidence = REQUIRED_PUBLISH_CLOSURE_SKILLS.every((skill) => {
    const evidence = perSkillEvidence[skill];
    return isPlainObject(evidence) && evidence.evidencePresent === true;
  });

  if (!hasDigest || !hasAllSkillEvidence) {
    return {
      ...publishClosure,
      blocked: true,
      blockerCount: Number(publishClosure.blockerCount || 0) + 1,
      perSkillEvidence,
    };
  }

  return { ...publishClosure, perSkillEvidence };
}

export function derivePublishClosureReportExportSummary(
  publishClosure: unknown,
): Record<string, any> {
  const normalized = normalizePublishClosureForProxy(publishClosure);
  if (!normalized || normalized === "strip") {
    return {
      source: "publish-artifact-closure",
      status: "degraded",
      blocked: true,
      digest: null,
    };
  }

  const digest = normalized.stableDigest || normalized.closureHash || null;
  if (normalized.blocked) {
    return {
      source: "publish-artifact-closure",
      status: "blocked",
      blocked: true,
      digest,
      evidencePresentCount: normalized.evidencePresentCount,
    };
  }

  return {
    source: "publish-artifact-closure",
    status: "closed",
    blocked: false,
    digest,
    evidencePresentCount: normalized.evidencePresentCount,
    skillCount: normalized.skillCount,
  };
}

function normalizeDriveClosureResponse<T extends Record<string, any>>(data: T): T {
  let out: Record<string, any> = data;

  if (Object.prototype.hasOwnProperty.call(data, "publishClosure")) {
    const normalized = normalizePublishClosureForProxy(data.publishClosure);
    if (normalized === "strip") {
      const { publishClosure: _publishClosure, ...rest } = out;
      out = rest;
    } else if (normalized) {
      out = { ...out, publishClosure: normalized };
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "rollbackClosureDiff")) {
    const rollbackClosureDiff = data.rollbackClosureDiff;
    if (!isPlainObject(rollbackClosureDiff)) {
      const { rollbackClosureDiff: _rollbackClosureDiff, ...rest } = out;
      out = rest;
    } else if (typeof rollbackClosureDiff.digestMatch !== "boolean") {
      out = { ...out, rollbackClosureDiff: { ...rollbackClosureDiff, degraded: true } };
    }
  }

  return out as T;
}

// GET /api/sliderule/sessions
// Returns { sessions: [...] } for easy consumption (also accepts raw array on client).
router.get("/health", async (_req: Request, res: Response) => {
  const health = await checkPythonSlideRuleHealth(resolvePythonSlideRuleRuntimeConfig());
  res.status(health.ok ? 200 : 503).json(health);
});

// GET /api/sliderule/sessions — thin proxy to Python (Node no longer owns list/session state)
router.get("/sessions", async (req: Request, res: Response) => {
  const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
  try {
    const data = await callPythonSlideRuleGet(
      pythonRuntime.baseUrl,
      "/api/sliderule/sessions",
      pythonRuntime.internalKey,
      // 身份必须透传，否则 Python 按匿名过滤 → 登录用户看到的历史永远是空的
      { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
    );
    return res.json(data);
  } catch (e) {
    console.warn("[sliderule] python sessions list delegation failed", e);
    return res.status(502).json({ sessions: [], error: "python_unavailable", backend: "python" });
  }
});

// GET /api/sliderule/sessions/:sessionId — thin proxy to Python
router.get("/sessions/:sessionId", async (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
  try {
    const data = await callPythonSlideRuleGet(
      pythonRuntime.baseUrl,
      `/api/sliderule/sessions/${encodeURIComponent(sid)}`,
      pythonRuntime.internalKey,
      // 同上：不带身份 → 有主会话一律 404 → 打开应用是空白页
      { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
    );
    return res.json(data);
  } catch (e) {
    // 上游 404（会话不存在）原样透传：前端 store 契约是「404 => undefined」
    // （sliderule-http-store.ts load()）；压成 502 会让缺失会话读取变成抛错
    if (e instanceof PythonSlideRuleHttpError && e.status === 404) {
      return res.status(404).json({ error: "not_found", sessionId: sid, backend: "python" });
    }
    console.warn("[sliderule] python get session delegation failed", e);
    return res.status(502).json({ error: "python_unavailable", sessionId: sid, backend: "python" });
  }
});

// PUT /api/sliderule/sessions/:sessionId — thin proxy to Python (Node owns ZERO durable state, sanitize, replay, persist)
router.put("/sessions/:sessionId", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const body = req.body || {};
  const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
  try {
    const data = await delegateToPythonSlideRule(
      pythonRuntime.baseUrl,
      `/api/sliderule/sessions/${encodeURIComponent(sid)}`,
      "PUT",
      body,
      pythonRuntime.internalKey,
      { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
    );
    return res.status(200).json(data);
  } catch (e) {
    console.warn("[sliderule] python put session delegation failed", e);
    return res.status(502).json({ error: "python_unavailable", sessionId: sid, backend: "python" });
  }
});

// DELETE /api/sliderule/sessions/:sessionId — thin proxy to Python
router.delete("/sessions/:sessionId", async (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
  try {
    await delegateToPythonSlideRule(
      pythonRuntime.baseUrl,
      `/api/sliderule/sessions/${encodeURIComponent(sid)}`,
      "DELETE",
      null,
      pythonRuntime.internalKey,
      { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
    );
    return res.status(204).end();
  } catch (e) {
    // 删除不存在的会话（上游 404）幂等成功：与「删过再删」同语义
    if (e instanceof PythonSlideRuleHttpError && e.status === 404) {
      return res.status(204).end();
    }
    console.warn("[sliderule] python delete session delegation failed", e);
    return res.status(502).end();
  }
});

// Test-only helper routes (used by smoke + dev tooling for durable pilot verification).
// These are **not** part of the official 4-endpoint contract.
//
// Production isolation:
// - Only registered when NODE_ENV !== "production" (normal dev/test)
// - Or when the explicit escape hatch SLIDERULE_ENABLE_TEST_HELPERS=1 is set.
// This prevents accidental (or malicious) use of __clear / __reload against a
// production-like deployment of the session store.
export const isTestHelperEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  readEnvCompat("SLIDERULE_ENABLE_TEST_HELPERS") === "1";

const enableTestHelpers = isTestHelperEnabled();

// (Optional nicety) allow a manual clear for dev / tests against the real server
// Not part of the official 4-endpoint contract.
if (enableTestHelpers) {
  router.post("/sessions/__clear", (_req: Request, res: Response) => {
    sessions.clear();
    if (!flushToDisk()) {
      return res.status(500).end();
    }
    res.status(204).end();
  });
}

// (Optional nicety) allow a manual reload-from-durable-file for dev / tests against the real server.
// Triggers live server backing re-init from the on-disk JSON (clear + loadFromDisk).
// This is the correct way for the smoke (or any external test) to prove "re-init recovery"
// against the *live* serving process. Not part of the official 4-endpoint contract.
if (enableTestHelpers) {
  router.post("/sessions/__reload", (_req: Request, res: Response) => {
    reloadFromDisk();
    res.status(204).end();
  });
}

type SlideRuleRespondBody = {
  state?: V5SessionState;
  turnId?: string;
  userText?: string;
  intervention?: { intent?: string } | null;
  selected?: Array<{ capabilityId?: string; roleId?: string }>;
  artifacts?: Array<{ kind?: string; title?: string; summary?: string; realLlm?: boolean }>;
  mainArtifact?: { kind?: string; title?: string; content?: string } | null;
  goalStatusBefore?: string;
  planReason?: string | null;
  skipped?: Array<{ capabilityId?: string; reason: string }>;
};

export type NarrationFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "hijacked";

// ai-topology removed (task 57 final-deprecated-stub-cleanup-105): proven unused.
// - No callsites in client/**, scripts/**, agent-loop/** (grep confirmed).
// - Marked dead code in inventories (task 09, status).
// - Classified ACTIVE_NODE_BUSINESS (unused stub); now removed from Node backend API surface.
// - No Python route added: unused behavior has no owner requirement (retirement of dead stub).
// - Thin shell / removal proved by dedicated Vitest 404 test below.
// POST /api/sliderule/orchestrate-plan — scheduling proposal (LLM or heuristic fallback, always 200).
router.post("/orchestrate-plan", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    state?: V5SessionState;
    turnId?: string;
    userText?: string;
    intervention?: { intent?: string; targetArtifactId?: string; targetDecisionId?: string } | null;
  };

  if (!body.turnId || !String(body.turnId).trim()) {
    return res.status(400).json({ error: "bad_request", message: "turnId is required" });
  }
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const v5Backend = (process.env.SLIDERULE_V5_BACKEND || 'python').toLowerCase().trim();
  if (v5Backend === 'python') {
    // Thin proxy only (default): delegate to Python. Node executes ZERO orchestrate business.
    const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
    try {
      const data = await callPythonSlideRule(
        pythonRuntime.baseUrl,
        '/api/sliderule/orchestrate-plan',
        {
          state: body.state,
          turnId: String(body.turnId),
          userText: String(body.userText || ""),
          intervention: body.intervention ?? null,
        },
        pythonRuntime.internalKey,
        // 身份要跟着走：Python 侧推演类路由 _require_login(viewer)，
        // 不带就是 401（实测踩过）。理由见 viewerHeadersFrom。
        { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
      );
      return res.json(data);
    } catch (e) {
      console.warn('[sliderule] python orchestrate-plan delegation failed', e);
      return res.status(502).json({
        selected: [],
        rationale: "Python orchestrate.plan delegation failed in compat shell",
        source: "python-rag",
        degraded: true,
        error: "python_unavailable",
        backend: "python",
        provenance: "python-rag",
      });
    }
  }

  // Legacy Node business isolated (SLIDERULE_V5_BACKEND=legacy + non-prod/test boundary only)
  // Dynamic import ensures default python path never loads legacy execute-orchestrate module.
  if (isLegacyNodeBusinessEnabled()) {
    const { executeOrchestratePlan } = await import("../sliderule/orchestrate-plan.js");
    const result = await executeOrchestratePlan({
      state: body.state,
      turnId: String(body.turnId),
      userText: String(body.userText || ""),
      intervention: body.intervention ?? null,
    });
    return res.json(result);
  }

  // Default thin-compat when no legacy: explicit no-business
  return res.status(404).json({ error: "thin_proxy_only", path: "/orchestrate-plan", backend: "python" });
});

// POST /api/sliderule/drive-full — thin proxy to Python for multi-loop full drive.
// Python returns top-level publishClosure + skillRuntimeGraph (cross-runtime closure fields).
// Node forwards the entire response body verbatim (no schema filtering, no drop of extra keys).
router.post("/drive-full", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    state?: any;
    max_loops?: number;
    userText?: string;
    user_text?: string;
    installedSkills?: unknown;
  };
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const v5Backend = (process.env.SLIDERULE_V5_BACKEND || 'python').toLowerCase().trim();
  if (v5Backend === 'python') {
    const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
    try {
      const data = await callPythonSlideRule(
        pythonRuntime.baseUrl,
        '/api/sliderule/drive-full',
        {
          state: body.state,
          max_loops: body.max_loops ?? 10,
          userText: body.userText ?? body.user_text ?? '',
          // 2026-07-27 修复：此前手工重组 body 时漏掉 installedSkills——
          // 回退到非流式驱动时技能注入静默失效（流式走 catch-all 全量透传
          // 所以正常）。
          installedSkills: body.installedSkills,
        },
        pythonRuntime.internalKey,
        // 推演专用超时，不能用通用的 120s —— 一趟推演实测 374~1190s，
        // 用通用值必然在第 2 分钟掐断返回 502，而 Python 侧那趟还在跑。
        // 理由与取值见 python-delegation.ts 的 DEFAULT_DRIVE_TIMEOUT_MS。
        { timeoutMs: resolvePythonDriveTimeoutMs(), viewer: viewerHeadersFrom(req) },
      );
      return res.json(normalizeDriveClosureResponse(data as any));
    } catch (e) {
      console.warn('[sliderule] python drive-full delegation failed', e);
      // Fail-closed: explicit error, no fabricated publishClosure/skillRuntimeGraph.
      return res.status(502).json({
        error: "python_unavailable",
        backend: "python",
        degraded: true,
      });
    }
  }

  // Legacy/no-python: thin proxy only (no drive business in Node).
  return res.status(404).json({ error: "thin_proxy_only", path: "/drive-full", backend: "python" });
});

// POST /api/sliderule/drive-marathon — thin proxy (also carries publishClosure + skillRuntimeGraph from Python).
router.post("/drive-marathon", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as any;
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const v5Backend = (process.env.SLIDERULE_V5_BACKEND || 'python').toLowerCase().trim();
  if (v5Backend === 'python') {
    const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
    try {
      const data = await callPythonSlideRule(
        pythonRuntime.baseUrl,
        '/api/sliderule/drive-marathon',
        body,
        pythonRuntime.internalKey,
        // 推演专用超时，不能用通用的 120s —— 一趟推演实测 374~1190s，
        // 用通用值必然在第 2 分钟掐断返回 502，而 Python 侧那趟还在跑。
        // 理由与取值见 python-delegation.ts 的 DEFAULT_DRIVE_TIMEOUT_MS。
        { timeoutMs: resolvePythonDriveTimeoutMs(), viewer: viewerHeadersFrom(req) },
      );
      return res.json(normalizeDriveClosureResponse(data as any));
    } catch (e) {
      console.warn('[sliderule] python drive-marathon delegation failed', e);
      return res.status(502).json({
        error: "python_unavailable",
        backend: "python",
        degraded: true,
      });
    }
  }

  return res.status(404).json({ error: "thin_proxy_only", path: "/drive-marathon", backend: "python" });
});

// POST /api/sliderule/respond — thin proxy compat only under default (this NodeRetirement task).
// respond has no Python backend route (client localNarrationFallback on !ok per contract); Node does not own/run narration business in python mode (explicit 404, legacy LLM only behind guard).
router.post("/respond", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as SlideRuleRespondBody;

  if (!body.turnId || !String(body.turnId).trim()) {
    return res.status(400).json({ error: "bad_request", message: "turnId is required" });
  }
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  if (!isLegacyNodeBusinessEnabled()) {
    // Thin proxy only: do not execute LLM, prompt build, fallback, or any narration business.
    // Returns 404 so Vite-proxy-to-python or direct call triggers client fallback visibly (degraded explicit).
    return res.status(404).json({ error: "thin_proxy_only", path: "/respond", note: "client localNarrationFallback expected", backend: "python" });
  }

  // Dynamic import ONLY when legacy enabled: default python/prod path never loads narration/llm-client at all.
  const { getAIConfig } = await import("../core/ai-config.js");
  const { callLLM } = await import("../core/llm-client.js");
  const {
    buildNarrationSystemPrompt,
    buildNarrationUserPrompt,
    detectNarrationHijack,
  } = await import("../../shared/blueprint/sliderule-narration-immunity.js");
  const { buildFallbackNarration } = await import("../../shared/blueprint/sliderule-deliverable-sanitize.js");

  const goalStatus = (body.state as any)?.goal?.status as any;
  const selectedCount = (body.selected || []).length;
  const hasMain = Boolean(body.mainArtifact?.content);

  const userPromptForNarration = buildNarrationUserPrompt({
    turnId: String(body.turnId || ""),
    userText: body.userText || "",
    goalText: (body.state as any)?.goal?.text || "",
    goalStatus: goalStatus || "needs_refinement",
    goalStatusBefore: body.goalStatusBefore,
    interventionIntent: body.intervention?.intent,
    selectedCount: (body.selected || []).length,
    selectedLine: (body.selected || []).map((s: any) => `${s.capabilityId || "?"}×${s.roleId || "?"}`).join(", ") || "(none)",
    planReason: body.planReason,
    skippedSummary: (body.skipped || []).map((s: any) => `${s.capabilityId || "?"}:${s.reason}`).join("; ") || undefined,
    artifactSummaries: (body.artifacts || []).map((a: any, i: number) => `${i + 1}. [${a.kind || "item"}] ${String(a.title || "").slice(0, 80)} — ${String(a.summary || "").slice(0, 200)}`).join("\n") || "(none)",
    mainArtifactContent: body.mainArtifact?.content || null,
  });

  const fallback = () =>
    buildFallbackNarration({
      userText: body.userText || "",
      goalStatus,
      goalStatusBefore: body.goalStatusBefore as any,
      selectedCount,
      interventionIntent: body.intervention?.intent,
      mainArtifactContent: body.mainArtifact?.content || null,
      planReason: body.planReason,
      skipped: body.skipped,
      sanitizeMainArtifact: true,
    });

  try {
    const config = getAIConfig();
    if (!config.apiKey) {
      console.warn("[sliderule] /respond fallback: no_api_key (LLM_API_KEY/OPENAI_API_KEY unset)");
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "no_api_key" as const,
      });
    }

    const { content, usage } = await callLLM(
      [
        { role: "system", content: buildNarrationSystemPrompt(hasMain, selectedCount) },
        { role: "user", content: userPromptForNarration },
      ],
      {
        model: config.model,
        temperature: 0.4,
        // Align with execute-capability (120s cap). gpt-5.5 + high reasoning often exceeds 45s.
        timeoutMs: Math.min(config.timeoutMs, 120_000),
      } as any
    );

    const text = String(content || "").trim();
    if (!text) {
      console.warn("[sliderule] /respond fallback: empty_response from LLM");
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "empty_response" as const,
      });
    }

    const hijack = detectNarrationHijack(text);
    if (hijack.hijacked) {
      console.warn("[sliderule] /respond fallback: hijacked —", hijack.reason);
      return res.json({
        text: fallback(),
        source: "fallback" as const,
        reason: "hijacked" as const,
      });
    }

    return res.json({
      text,
      source: "llm" as const,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: config.model,
          }
        : undefined,
    });
  } catch (e: any) {
    console.warn("[sliderule] /respond fallback: llm_error —", String(e?.message || e).slice(0, 200));
    return res.json({
      text: fallback(),
      source: "fallback" as const,
      reason: "llm_error" as const,
    });
  }
});

type PooledDialogueJson = { title?: string; summary?: string; content?: string };

// Legacy pool helpers: lazy import pool module only when executed under legacy flag.
// (ensures default path does not load pool-json-llm legacy execution at static time)
async function loadPoolModule(): Promise<any> {
  return await import("../sliderule/pool-json-llm.js");
}

async function formatPooledCapabilityJson(
  pooled: any,
  defaultTitle: string
) {
  const poolMod = await loadPoolModule();
  const tag = poolMod.formatPoolSummaryTag(pooled.model, pooled.poolLabel);
  const title = String(pooled.json.title || defaultTitle).trim();
  const summary = String(pooled.json.summary || "").trim();
  const content = String(pooled.json.content || "").trim();
  const out = {
    title,
    summary: summary ? `${summary} ${tag}` : tag,
    content,
    provenance: "llm" as const,
    usage: pooled.usage,
  };

  return out;
}

async function tryPooledDialogueCapability(
  systemPrompt: string,
  userPrompt: string,
  temperature: number
): Promise<any | null> {
  const poolMod = await loadPoolModule();
  const pooled = await poolMod.callPoolJsonLlm(
    systemPrompt,
    userPrompt,
    temperature
  ) as { json?: PooledDialogueJson } | null;

  if (pooled?.json) {
    // Dynamic load for isEmpty check (legacy only path)
    const { isEmptyDialogueJsonShape } = await import("../core/llm-json-budget.js");
    if (!isEmptyDialogueJsonShape(pooled.json)) {
      return pooled;
    }
  }
  return null;
}

function isPrimaryLlmRecoverableError(errMsg: string): boolean {
  return (
    /HTTP 5\d\d|504|502|503|service error|gateway timeout/i.test(errMsg) ||
    /temporarily unavailable|provider cooling down|all llm providers are temporarily unavailable/i.test(
      errMsg
    )
  );
}

// POST /api/sliderule/execute-capability
// Server-side LLM execution for the SlideRule V5 capability seam
// (risk/report + D1 dialogue + R2 deliberation + F1 mapped caps).
// Reuses the project's unified LLM stack (getAIConfig + callLLMJson) exactly like /autopilot and blueprint routes.
// Input: the same args the LlmCapabilityProvider receives on the client.
// Output: strictly the raw 4-field shape { title, summary, content, provenance? }.
// On any config/LLM error we return 5xx (or throw) so the client LlmCapabilityExecutor reliably falls back
// to PilotRealCapabilityExecutor. This route never touches commitArtifact, Trust Gate, producedBy, or session state.
router.post("/execute-capability", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const {
    capabilityId,
    state,
    inputArtifactIds = [],
    roleId,
    turnId,
    userText,
    deliberationMaxRounds,
    targetRoleId,
  } = (req.body || {}) as {
    capabilityId?: string;
    state?: V5SessionState;
    inputArtifactIds?: string[];
    roleId?: string;
    turnId?: string;
    userText?: string;
    deliberationMaxRounds?: number;
    targetRoleId?: string;
  };

  const logCap = createExecuteCapabilityLogger(capabilityId || "?", turnId || "?");
  const sendJson = (body: unknown, httpStatus = 200) => {
    logCap({
      provenance: provenanceFromBody(body),
      httpStatus,
      model:
        body && typeof body === "object" && "usage" in (body as object)
          ? String((body as { usage?: { model?: string } }).usage?.model || "")
          : undefined,
    });
    return httpStatus === 200
      ? res.json(body)
      : res.status(httpStatus).json(body);
  };

  if (!capabilityId || !state || !turnId) {
    logCap({ error: "bad_request", httpStatus: 400 });
    return res.status(400).json({ error: "bad_request", message: "capabilityId, state and turnId are required" });
  }

  try {
    // GitHub / repo special cases — legacy Node only, isolated to non-prod/test boundary via isLegacyNodeBusinessEnabled.
    // Under default python: thin proxy (no specials, no business ever).
    // Dynamic import: default path never resolves these legacy modules.
    if (isLegacyNodeBusinessEnabled()) {
      const ghMod = await import("../sliderule/github-mcp-adapter.js");
      const repoMod = await import("../sliderule/repo-static-analyzer.js");
      const capExecMod = await import("../sliderule/capability-exec-map.js");
      if (capabilityId === "source.github.inspect" || capabilityId === "evidence.github.collect") {
        const gh = await ghMod.executeGithubMcpCapability(capabilityId, state, inputArtifactIds);
        return sendJson(gh);
      }
      if (capabilityId === "repo.static.inspect") {
        const result = await repoMod.executeRepoStaticInspect(capabilityId, state, inputArtifactIds);
        return sendJson(result);
      }
      if (capabilityId === "repo.inspect") {
        const result = await capExecMod.executeRepoInspectMapped(state, inputArtifactIds);
        return sendJson(result);
      }
    }

    // V5 delegation: default python always delegates V5 caps (thin proxy). Legacy full paths isolated.
    const v5Backend = (process.env.SLIDERULE_V5_BACKEND || 'python').toLowerCase().trim();

    const isPythonV5Cap =
      capabilityId === 'intent.clarify' ||
      capabilityId === 'gap.ask' ||
      capabilityId === 'question.expand' ||
      capabilityId === 'critique.generate' ||
      capabilityId === 'synthesis.merge' ||
      capabilityId === 'rebuttal.resolve' ||
      capabilityId === 'counter.argue' ||
      capabilityId === 'mcp.call' ||
      capabilityId === 'skill.invoke' ||
      capabilityId === 'evidence.search' ||
      capabilityId === 'report.write' ||
      capabilityId === 'risk.analyze' ||
      capabilityId === 'orchestrate.plan' ||
      capabilityId === 'structure.decompose' ||
      capabilityId === 'document.draft' ||
      capabilityId === 'traceability.matrix' ||
      capabilityId === 'task.write' ||
      capabilityId === 'instruction.package' ||
      capabilityId === 'outcome.visualize' ||
      capabilityId === 'handoff.package' ||
      capabilityId === 'ux.preview';

    if (v5Backend === 'python' && isPythonV5Cap) {
      // Delegate V5 paths to the new slide-rule-python backend (correct /api/sliderule/* surface)
      // This replaces the old Node LLM pool / primary path for these capabilities.
      // Use stable Python RAG for real external evidence (no more template/degraded).
      // Controlled by SLIDERULE_V5_BACKEND=python (default) | legacy .
      const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();

      const payload = {
        capabilityId,
        state,
        inputArtifactIds: inputArtifactIds || [],
        roleId,
        turnId,
        userText: String(userText ?? state.goal?.text ?? ''),
      };

      try {
        const endpoint = capabilityId === 'orchestrate.plan'
          ? '/api/sliderule/orchestrate-plan'
          : '/api/sliderule/execute-capability';
        const data = await callPythonSlideRule(
          pythonRuntime.baseUrl,
          endpoint,
          payload,
          pythonRuntime.internalKey,
          { timeoutMs: pythonRuntime.timeoutMs, viewer: viewerHeadersFrom(req) },
        );
        return sendJson(data);
      } catch (e) {
        console.warn('[sliderule] python V5 delegation failed', e);
      }

      // IMPORTANT: do not return a pseudo-success when Python is unavailable.
      // Returning a 200 "python-delegated" result can make callers think RAG evidence
      // was successfully retrieved. Make failure explicit (degraded + 5xx) so tests,
      // UI, and upper layers can distinguish "real Python RAG" from "Python down".
      return sendJson(
        {
          title: `${capabilityId} (delegated)`,
          summary: 'Python V5 backend unavailable',
          content: '委托 slide-rule-python 失败（服务不可用、端口或 key 错误等）。',
          provenance: 'python-delegated-failed',
          degraded: true,
          error: 'python_unavailable',
        },
        502,
      );
    }

    // Under default python: no Node business. Under legacy isolated: allow mapped/llm.
    if (!isLegacyNodeBusinessEnabled()) {
      return sendJson(
        {
          title: `${capabilityId} (thin-proxy)`,
          summary: "Node is thin proxy only; business owned by Python",
          content: "Unexpected legacy path in default SLIDERULE_V5_BACKEND=python",
          provenance: "python-delegated-failed",
          degraded: true,
          error: "thin_proxy_violation",
        },
        500,
      );
    }

    // Dynamic import for all remaining legacy V5 mapped/LLM execute paths (GitHub/repo already above).
    // Ensures production default python route file never executes/loads legacy business even if code retained for compat flag.
    const capExecMod = await import("../sliderule/capability-exec-map.js");
    const structMod = await import("../sliderule/structure-exec-map.js");
    const deliveryMod = await import("../sliderule/delivery-exec-map.js");
    const visualMod = await import("../sliderule/visual-exec-map.js");
    const delibMod = await import("../sliderule/deliberation-exec-map.js");
    const dialMod = await import("../sliderule/dialogue-exec-map.js");

    // Load LLM/narration/prompt helpers lazily here (only executed under legacy flag).
    const { buildCapabilityPrompt } = await import("../../shared/blueprint/sliderule-capability-prompts.js");
    const { callSlideRuleDialogueJsonLlm } = await import("../sliderule/json-llm-call.js");
    const { clearPrimaryLLMCooldown } = await import("../core/llm-client.js");
    const { getAIConfig: getAIConfigLegacy } = await import("../core/ai-config.js");

    if (capabilityId === "evidence.search") {
      const result = await capExecMod.executeEvidenceSearchMapped(state, inputArtifactIds, roleId);
      return sendJson(result);
    }

    if (structMod.isStructureCapability(capabilityId)) {
      const result = await structMod.executeStructureDecomposeMapped(
        state,
        inputArtifactIds,
        roleId,
        turnId
      );
      return sendJson(result);
    }

    if (deliveryMod.isDeliveryCapability(capabilityId)) {
      const result = await deliveryMod.executeDeliveryCapabilityMapped(capabilityId, state, inputArtifactIds);
      return sendJson(result);
    }

    if (visualMod.isVisualCapability(capabilityId)) {
      const result = await visualMod.executeVisualCapabilityMapped(capabilityId, state);
      return sendJson(result);
    }

    const isLlmBacked =
      delibMod.isDeliberationCapability(capabilityId) ||
      dialMod.isDialogueCapability(capabilityId) ||
      capabilityId === "risk.analyze" ||
      capabilityId === "report.write";

    if (!isLlmBacked) {
      const err = new Error(`Server LLM provider does not handle capability: ${capabilityId}`);
      (err as any).status = 400;
      throw err;
    }

    const config = getAIConfigLegacy();

    if (delibMod.isDeliberationCapability(capabilityId)) {
      const result = await delibMod.executeDeliberationCapabilityMapped({
        capabilityId: capabilityId as any,
        state,
        inputArtifactIds,
        roleId,
        turnId,
        deliberationMaxRounds,
        targetRoleId,
      });
      // V5.3 P2.5: forward events (from panel/dialogue) as-is alongside title/summary/content/payload
      return sendJson({ ...result, events: (result as any).events });
    }

    if (dialMod.isDialogueCapability(capabilityId)) {
      const result = await dialMod.executeDialogueCapability({
        capabilityId: capabilityId as any,
        state,
        inputArtifactIds,
        roleId,
        turnId,
      });
      // V5.3 P2.5: forward events (think/observe etc.) as-is
      return sendJson({ ...result, events: (result as any).events });
    }

    // B1: 使用共享 prompt 构造（单一真相）。server 路由现在是薄壳 (legacy only).
    const { systemPrompt, userPrompt, maxTokens, temperature } = buildCapabilityPrompt({
      capabilityId,
      state: state as any,
      inputArtifactIds,
      roleId,
      turnId,
    });


    if (capabilityId === "risk.analyze" || capabilityId === "report.write") {
      const defaultTitle =
        capabilityId === "risk.analyze" ? "Risk Analysis" : "Report";
      const pooled = await tryPooledDialogueCapability(
        systemPrompt,
        userPrompt,
        temperature
      );

      if (pooled) {
        return sendJson(await formatPooledCapabilityJson(pooled, defaultTitle));
      }

      // report.write prefers pool (to avoid large-prompt 504s on high-model primary like su8),
      // but if pool is exhausted we still allow primary as last resort before template (more resilient than hard skip).
      // (The hard skip only applies to risk.analyze in this path.)
      // Note: V5 caps like report.write are now delegated early to Python backend above; this is legacy for non-delegated flow.
    }

    if (
      capabilityId === "risk.analyze" &&
      (await (await import("../sliderule/pool-json-llm.js")).shouldSkipPrimaryLlmAfterPoolExhausted())
    ) {
      throw new Error("pool_exhausted_skip_primary");
    }

    if (!config.apiKey) {
      throw new Error("LLM not configured (no apiKey from getAIConfig)");
    }

    let llmResult: { json: any; usage?: any } | null = null;
    const llmCallOptions = {
      model: config.model,
      temperature,
      maxTokens,
      timeoutMs: Math.min(config.timeoutMs, 120000),
    };

    try {
      llmResult = await callSlideRuleDialogueJsonLlm(
        capabilityId,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        llmCallOptions as any
      );
    } catch (llmErr: any) {
      const errMsg = String(llmErr?.message || llmErr);
      const isGateway5xx = /HTTP 5\d\d|504|502|503|service error|gateway timeout/i.test(errMsg);

      if (isPrimaryLlmRecoverableError(errMsg)) {
        const promptLen = (systemPrompt?.length || 0) + (userPrompt?.length || 0);
        console.warn(
          `[sliderule] /execute-capability primary recoverable error for ${capabilityId}, promptLen≈${promptLen}. ` +
            `Will clear cooldown → pool retry → lighter before degraded.`
        );

        try {
          clearPrimaryLLMCooldown();
        } catch {}

        const poolMod = await loadPoolModule();
        if (poolMod.isSlideRuleCapabilityPoolEnabled()) {
          const pooledRetry = await tryPooledDialogueCapability(
            systemPrompt,
            userPrompt,
            temperature
          );
          if (pooledRetry) {
            const defaultTitle =
              capabilityId === "risk.analyze" ? "Risk Analysis" : "Evidence Report";
            console.warn(
              `[sliderule] /execute-capability pool retry succeeded for ${capabilityId}`
            );
            return sendJson(await formatPooledCapabilityJson(pooledRetry, defaultTitle));
          }
        }

        if (!isGateway5xx) {
          throw llmErr;
        }

        const lighterMax = Math.max(4000, Math.floor(maxTokens * 0.6));
        try {
          llmResult = await callSlideRuleDialogueJsonLlm(
            capabilityId,
            [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            {
              ...llmCallOptions,
              maxTokens: lighterMax,
              reasoningEffort: "low",
            } as any
          );
          console.warn(
            `[sliderule] /execute-capability lighter retry succeeded for ${capabilityId}`
          );
          try {
            clearPrimaryLLMCooldown();
          } catch {}
        } catch (lighterErr) {
          throw lighterErr;
        }
      } else {
        throw llmErr;
      }
    }

    const { json: result, usage } = llmResult!;

    const title = (result.title || (capabilityId === "risk.analyze" ? "Risk Analysis" : "Evidence Report")).trim();
    const summary = (result.summary || "").trim();
    const content = String(result.content || "").trim();
    if (!content) {
      throw new Error("empty_json_content_from_llm");
    }

    return sendJson({
      title,
      summary: summary ? `${summary} [server-llm:${config.model}]` : `[server-llm:${config.model}]`,
      content,
      provenance: "llm" as const,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: config.model,
          }
        : undefined,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = e?.status || 500;

    if (status === 400 || status === 422) {
      const code = "unsupported_capability";
      logCap({ error: msg.slice(0, 200), httpStatus: status });
      return res.status(status).json({ error: code, message: msg.slice(0, 300) });
    }

    const llmFbMod = await import("../sliderule/capability-llm-fallback.js");
    if (llmFbMod.isLlmContentHijackError(msg)) {
      console.error("[sliderule] /execute-capability hijack blocked:", msg.slice(0, 200));
      logCap({ error: msg.slice(0, 200), httpStatus: 500 });
      return res.status(500).json({ error: "llm_execution_failed", message: msg.slice(0, 300) });
    }

    const fb = llmFbMod.buildCapabilityLlmFallback({
      capabilityId,
      state,
      inputArtifactIds,
      roleId,
      turnId,
      reason: msg.slice(0, 120),
    });
    if (fb) {
      console.warn("[sliderule] /execute-capability degraded:", msg.slice(0, 200));
      logCap({ provenance: fb.provenance, error: msg.slice(0, 200), httpStatus: 200 });
      return res.json(fb);
    }

    console.error("[sliderule] /execute-capability failed:", msg);
    logCap({ error: msg.slice(0, 200), httpStatus: 500 });
    return res.status(500).json({ error: "llm_execution_failed", message: msg.slice(0, 300) });
  }
});

// ── Phase A：生成应用缩略图截图（Playwright 离线，无 LLM/Python 调用）──────
// POST  /api/sliderule/sessions/:sessionId/screenshot  { modelHash? }
//   → 首次：启动 Playwright 截图，缓存到 tmp/app-thumbnails/
//   → 已有缓存：直接返回 PNG
// DELETE /api/sliderule/sessions/:sessionId/screenshot
//   → 删除该 session 全部缓存截图（模型变化时调用）
router.post("/sessions/:sessionId/screenshot", express.json({ limit: "512kb" }), async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { modelHash, device: requestedDevice } = (req.body ?? {}) as {
    modelHash?: string;
    device?: string;
  };
  const {
    normalizeScreenshotDevice,
    resolveScreenshotResponseDevice,
    screenshotAuthoritySlug,
    screenshotCacheSlug,
  } = await import(
    "./sliderule-screenshot-device.js"
  );
  const requested = normalizeScreenshotDevice(requestedDevice);

  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __routeDir = nodePath.dirname(fileURLToPath(import.meta.url));
  const screenshotDir = nodePath.resolve(__routeDir, "../../tmp/app-thumbnails");
  await fs.mkdir(screenshotDir, { recursive: true });

  const authorityPath = nodePath.join(
    screenshotDir,
    `${screenshotAuthoritySlug(sessionId, modelHash)}.txt`,
  );

  // Cache lookup follows the device previously confirmed by Python, not the request.
  try {
    const authoritative = resolveScreenshotResponseDevice(
      requested,
      (await fs.readFile(authorityPath, "utf8")).trim(),
    );
    const slug = screenshotCacheSlug(sessionId, modelHash, authoritative);
    const screenshotPath = nodePath.join(screenshotDir, `${slug}.png`);
    await fs.access(screenshotPath);
    const buf = await fs.readFile(screenshotPath);
    res
      .set("Content-Type", "image/png")
      .set("X-Sliderule-Device", authoritative)
      .set("Cache-Control", "public, max-age=86400")
      .send(buf);
    return;
  } catch {}

  // 无缓存：转发到 Python，在 E2B 沙盒里跑 Playwright 截图。
  //
  // 2026-07-23 修复：这里原来是本地 chromium.launch()，但生产运行时镜像是
  // node:22-alpine（musl libc）+ @playwright/test 只在 devDependencies（生产
  // `pnpm install --prod` 排除）——这条路径在生产环境从未真正跑通过，
  // import("@playwright/test") 必然失败，截图接口恒 503，前端一直静默回退
  // 到 MiniAppThumb 假占位卡（应用中心卡片跟设计效果图差距的根子在这）。
  // 改走 Python 侧的 E2B 沙盒（services/app_screenshot.py）：沙盒是真机
  // Debian（glibc 兼容），宿主 Node/Python 镜像都不用装 Chromium。
  // fail-closed：Python 侧 E2B_API_KEY / SLIDERULE_PUBLIC_APP_URL 任一未配置
  // 时直接 404，这里照实转 503，前端行为和过去的失败态一致（无假装成功）。
  const pythonRuntime = resolvePythonSlideRuleRuntimeConfig();
  try {
    const upstream = await fetch(
      `${pythonRuntime.baseUrl}/api/sliderule/sessions/${encodeURIComponent(sessionId)}/e2b-screenshot?device=${requested}`,
      {
        method: "POST",
        headers: { "X-Internal-Key": pythonRuntime.internalKey },
        // E2B 沙盒 cache-miss 冷启动（现装 playwright+chromium）实测约
        // 30-90s，给足超时；命中 Node 侧文件缓存的请求走不到这里。
        signal: AbortSignal.timeout(120_000),
      }
    );
    if (!upstream.ok) {
      res.status(503).json({ error: "screenshot_unavailable" });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const authoritative = resolveScreenshotResponseDevice(
      requested,
      upstream.headers.get("x-sliderule-device"),
    );
    const slug = screenshotCacheSlug(sessionId, modelHash, authoritative);
    const screenshotPath = nodePath.join(screenshotDir, `${slug}.png`);
    await fs.writeFile(screenshotPath, buf);
    await fs.writeFile(authorityPath, authoritative, "utf8");
    res
      .set("Content-Type", "image/png")
      .set("X-Sliderule-Device", authoritative)
      .set("Cache-Control", "public, max-age=86400")
      .send(buf);
  } catch {
    res.status(503).json({ error: "screenshot_unavailable" });
  }
});

router.delete("/sessions/:sessionId/screenshot", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  try {
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __routeDir = nodePath.dirname(fileURLToPath(import.meta.url));
    const screenshotDir = nodePath.resolve(__routeDir, "../../tmp/app-thumbnails");
    const files = await fs.readdir(screenshotDir).catch(() => [] as string[]);
    const slug = sessionId.slice(0, 32);
    await Promise.all(files.filter(f => f.startsWith(slug)).map(f =>
      fs.unlink(nodePath.join(screenshotDir, f)).catch(() => {})
    ));
  } catch {}
  res.status(204).end();
});

// ── E19 Docker/prod 兜底薄代理（2026-07-16）──────────────────────────────
// dev 下 vite 把 /api/sliderule 直接代理到 Python，所以 drive-full-stream
// (SSE)、llm-channel 等端点从未经过 Node；prod/Docker 里它们掉进 SPA 兜底
// 返回 HTML/404——一键部署的主推演流直接断。把未被上面显式路由接住的
// /api/sliderule/* 一律流式转发 Python：SSE 逐块透传不缓冲，Node 不碰
// 业务语义（与 index.ts 退役方向一致，thin proxy only）。
router.use(async (req: Request, res: Response) => {
  // 生产守卫契约：测试专用助手路径（__clear/__reload 等 __ 前缀段）
  // 不注册也不转发，保持 404（见 sliderule-runtime.test.ts 生产守卫用例）
  if (/(^|\/)__/.test(req.path)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const runtime = resolvePythonSlideRuleRuntimeConfig();
  const url = `${runtime.baseUrl}/api/sliderule${req.url}`;
  try {
    const method = req.method.toUpperCase();
    const headers: Record<string, string> = {
      "X-Internal-Key": runtime.internalKey,
      accept: String(req.headers["accept"] || "*/*"),
    };
    // 2026-08-02：把访问者身份透传给 Python。判据与理由见 viewerHeadersFrom。
    //
    // 2026-08-06：这段原本是就地写的，与 python-delegation 里那几条显式路由
    // 各写各的——结果显式路由那边一直没带身份，登录用户的会话列表恒为空。
    // 改成共用同一个函数，杜绝第二次漂移。
    Object.assign(headers, viewerHeadersFrom(req));
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      headers["content-type"] = String(
        req.headers["content-type"] || "application/json"
      );
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url, { method, headers, body });
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    // 登录/登出要靠 Set-Cookie 把 httpOnly 凭据种到浏览器上。不回传的话
    // 登录接口会"成功但没登上"——这类问题很难查，因为响应体是 200。
    // getSetCookie() 保留多条（Node 18.14+ / undici）；退化时用单值兜底。
    const setCookies =
      typeof (upstream.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (upstream.headers as { getSetCookie: () => string[] }).getSetCookie()
        : ([upstream.headers.get("set-cookie")].filter(Boolean) as string[]);
    if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
    if (!upstream.body) {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
      (res as { flush?: () => void }).flush?.();
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({
        error: "python_proxy_failed",
        path: req.url,
        backend: "python",
        detail: String((err as Error)?.message || err).slice(0, 200),
      });
      return;
    }
    res.end();
  }
});

export default router;

/**
 * Durability pilot test helpers (smoke + future server tests only).
 * - Never called from normal request handlers or the public HTTP surface.
 * - Allow the smoke to prove "re-initialize backing from durable file recovers prior writes"
 *   without killing the dev server process (via the __reload endpoint) or for direct use.
 */
export const __SLIDERULE_SESSIONS_FILE = DATA_FILE;

export function __reloadFromDisk(): void {
  reloadFromDisk();
}
