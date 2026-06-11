/**
 * WhyBuddy V5 Session Store HTTP API (pilot durable).
 *
 * Provides the 4 endpoints (surface 100% unchanged from skeleton):
 *   GET    /api/whybuddy/sessions           -> list
 *   GET    /api/whybuddy/sessions/:sessionId -> load one
 *   PUT    /api/whybuddy/sessions/:sessionId -> save (upsert)
 *   DELETE /api/whybuddy/sessions/:sessionId -> delete
 *
 * Now backed by durable JSON file (data/whybuddy-sessions.json) for the Durable Store Pilot.
 * In-memory Map is a hot cache only. Every mutate flushes to disk (atomic tmp+rename).
 * Loads from disk at module init. Re-init / reload-from-disk supported for smoke/tests only
 * via the test-only __reload endpoint (or the exported helper for direct use).
 *
 * HTTP surface + client HttpWhyBuddySessionStore contract remain identical and swappable.
 * (tsx watch on server/ files will pick up changes live.)
 */

import express, { Router, type Request, type Response } from "express";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLM, callLLMJson, callLLMJsonWithUsage } from "../core/llm-client.js";
import { buildStructuredReport } from "../../shared/blueprint/whybuddy-report-builder.js";
import { buildFallbackNarration } from "../../shared/blueprint/whybuddy-deliverable-sanitize.js";
import type { GoalStatusForNarration } from "../../shared/blueprint/whybuddy-deliverable-sanitize.js";
import { executeGithubMcpCapability } from "../whybuddy/github-mcp-adapter.js";
import { executeRepoStaticInspect } from "../whybuddy/repo-static-analyzer.js";
import {
  executeEvidenceSearchMapped,
  executeRepoInspectMapped,
} from "../whybuddy/capability-exec-map.js";
import {
  executeDeliberationCapabilityMapped,
  isDeliberationCapability,
} from "../whybuddy/deliberation-exec-map.js";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// Durable file-backed pilot store.
// - DATA_FILE lives under data/ (runtime artifacts are explicitly gitignored below).
// - Map is hot cache for speed + simple list/GET shaping.
// - load/reload from disk; flushToDisk after every mutate (set/delete/clear) — now returns boolean.
// - Atomic write: write .tmp then renameSync.
const DATA_FILE = path.resolve(process.cwd(), "data", "whybuddy-sessions.json");

const sessions = new Map<string, V5SessionState>();

function loadFromDisk(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const arr: Array<[string, V5SessionState]> = raw ? JSON.parse(raw) : [];
      sessions.clear();
      for (const [k, v] of arr) {
        if (k && v) sessions.set(k, v);
      }
    }
  } catch (e) {
    // Pilot: never crash the server on bad/partial file; start empty and let next flush repair.
    console.error("[whybuddy-store] loadFromDisk failed (starting empty):", (e as Error)?.message || e);
  }
}

function reloadFromDisk(): void {
  sessions.clear();
  loadFromDisk();
}

function flushToDisk(): boolean {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    const payload = JSON.stringify(Array.from(sessions.entries()), null, 2);
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    console.error("[whybuddy-store] flushToDisk failed:", (e as Error)?.message || e);
    return false;
  }
}

// Initial load (runs once when tsx loads this module; watch will re-exec on file change).
loadFromDisk();

// GET /api/whybuddy/sessions
// Returns { sessions: [...] } for easy consumption (also accepts raw array on client).
router.get("/sessions", (_req: Request, res: Response) => {
  const list = Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    goal: s.goal?.text || "",
    createdAt: (s as any).createdAt,
    lastActive: (s as any).lastActive,
    artifactCount: (s.artifacts || []).length,
    phase: (s as any).runtimePhase,
  }));
  res.json({ sessions: list });
});

// GET /api/whybuddy/sessions/:sessionId
router.get("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const s = sessions.get(sid);
  if (!s) {
    return res.status(404).json({ error: "not_found", sessionId: sid });
  }
  res.json(s);
});

// PUT /api/whybuddy/sessions/:sessionId
// Body: the full V5SessionState (or a partial that we treat as the new truth for the session).
// We trust the client for the prototype phase (same as the in-memory client store did).
router.put("/sessions/:sessionId", express.json({ limit: "2mb" }), (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const body = (req.body || {}) as Partial<V5SessionState> & { sessionId?: string };

  // Force the key from the URL (defense in depth)
  const state: V5SessionState = {
    ...(body as V5SessionState),
    sessionId: sid,
  };

  // Stamp lastActive for list views (client also does this, server does it too for purity)
  (state as any).lastActive = new Date().toISOString();
  if (!(state as any).createdAt) {
    const existing = sessions.get(sid);
    (state as any).createdAt = (existing as any)?.createdAt || (state as any).lastActive;
  }

  const previous = sessions.get(sid);
  sessions.set(sid, state);
  if (!flushToDisk()) {
    if (previous) sessions.set(sid, previous);
    else sessions.delete(sid);
    return res.status(500).json({ error: "persist_failed" });
  }
  res.status(200).json(state);
});

// DELETE /api/whybuddy/sessions/:sessionId
router.delete("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const existed = sessions.delete(sid);
  if (!flushToDisk()) {
    return res.status(500).end();
  }
  // 204 No Content is conventional for successful DELETE even if it didn't exist
  res.status(204).end();
});

// Test-only helper routes (used by smoke + dev tooling for durable pilot verification).
// These are **not** part of the official 4-endpoint contract.
//
// Production isolation:
// - Only registered when NODE_ENV !== "production" (normal dev/test)
// - Or when the explicit escape hatch WHYBUDDY_ENABLE_TEST_HELPERS=1 is set.
// This prevents accidental (or malicious) use of __clear / __reload against a
// production-like deployment of the session store.
export const isTestHelperEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.WHYBUDDY_ENABLE_TEST_HELPERS === "1";

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

type WhyBuddyRespondBody = {
  state?: V5SessionState;
  turnId?: string;
  userText?: string;
  intervention?: { intent?: string } | null;
  selected?: Array<{ capabilityId?: string; roleId?: string }>;
  artifacts?: Array<{ kind?: string; title?: string; summary?: string; realLlm?: boolean }>;
  mainArtifact?: { kind?: string; title?: string; content?: string } | null;
};

function buildNarrationSystemPrompt(hasMain: boolean): string {
  const lengthRule = hasMain
    ? "When mainArtifact is provided: rewrite the material into 300–700 Chinese characters for the user. Preserve ALL facts, evidence, risks, disagreements, and open gaps from the material. Do NOT add conclusions not present in the material. Remove engineering implementation details and internal references. Use short section headings and line breaks; avoid bullet-symbol stacking. Open with one sentence responding to the user input; end with one forward-looking question or next-step suggestion."
    : "When no mainArtifact: reply in 120–260 Chinese characters summarizing the turn.";

  return (
    "You are WhyBuddy's user-facing narrator for a reasoning product.\n" +
    "Discipline (mandatory):\n" +
    "1. Transcribe mechanical conclusions only — never adjudicate goal.status yourself.\n" +
    "2. Never use internal engineering terms (artifact, stale, upstream, gate, capability, provenance, orchestrator, etc.) in user-visible text.\n" +
    "3. Never announce optimistic trust labels like '已收敛·可信' unless the mechanical state already says clear — and even then describe neutrally.\n" +
    "4. " +
    lengthRule +
    "\n" +
    "5. Output plain Chinese prose only — no JSON, no markdown code fences."
  );
}

function buildNarrationUserPrompt(body: WhyBuddyRespondBody): string {
  const goalStatus = (body.state as any)?.goal?.status as GoalStatusForNarration;
  const selected = (body.selected || [])
    .map((s) => `${s.capabilityId || "?"}×${s.roleId || "?"}`)
    .join(", ");
  const artifactSummaries = (body.artifacts || [])
    .map(
      (a, i) =>
        `${i + 1}. [${a.kind || "item"}] ${String(a.title || "").slice(0, 80)} — ${String(a.summary || "").slice(0, 200)}`
    )
    .join("\n");

  let prompt =
    `Turn: ${body.turnId}\n` +
    `User input: ${body.userText || ""}\n` +
    `Mechanical goal.status (transcribe faithfully, do not override): ${goalStatus || "needs_refinement"}\n` +
    `Intervention: ${body.intervention?.intent || "none"}\n` +
    `Selected analyses: ${selected || "(none)"}\n` +
    `Artifact summaries:\n${artifactSummaries || "(none)"}\n`;

  if (body.mainArtifact?.content) {
    prompt +=
      `\n本轮主产物(权威素材,你的回复要把它完整改写为面向用户的行文——保留其中全部\n` +
      `事实、证据、风险、分歧与未解缺口,不得新增任何素材里没有的结论,砍掉工程实现\n` +
      `细节与内部引用):\n` +
      `${String(body.mainArtifact.content).slice(0, 6000)}`;
  }

  return prompt;
}

// POST /api/whybuddy/respond — user-facing narration (LLM or deterministic fallback, always 200).
router.post("/respond", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const body = (req.body || {}) as WhyBuddyRespondBody;

  if (!body.turnId || !String(body.turnId).trim()) {
    return res.status(400).json({ error: "bad_request", message: "turnId is required" });
  }
  if (!body.state) {
    return res.status(400).json({ error: "bad_request", message: "state is required" });
  }

  const goalStatus = (body.state as any)?.goal?.status as GoalStatusForNarration;
  const analysisCount = (body.selected || []).length || (body.artifacts || []).length;
  const hasMain = Boolean(body.mainArtifact?.content);

  const fallback = () =>
    buildFallbackNarration({
      userText: body.userText || "",
      goalStatus,
      analysisCount,
      interventionIntent: body.intervention?.intent,
      mainArtifactContent: body.mainArtifact?.content || null,
    });

  try {
    const config = getAIConfig();
    if (!config.apiKey) {
      return res.json({ text: fallback(), source: "fallback" as const });
    }

    const { content, usage } = await callLLM(
      [
        { role: "system", content: buildNarrationSystemPrompt(hasMain) },
        { role: "user", content: buildNarrationUserPrompt(body) },
      ],
      {
        model: config.model,
        temperature: 0.4,
        timeoutMs: Math.min(config.timeoutMs, 45000),
      } as any
    );

    const text = String(content || "").trim();
    if (!text) {
      return res.json({ text: fallback(), source: "fallback" as const });
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
    console.error("[whybuddy] /respond fallback:", String(e?.message || e).slice(0, 200));
    return res.json({ text: fallback(), source: "fallback" as const });
  }
});

// POST /api/whybuddy/execute-capability
// Server-side LLM execution for the WhyBuddy V5 capability seam (risk.analyze + report.write).
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
    deliberationMaxRounds,
    targetRoleId,
  } = (req.body || {}) as {
    capabilityId?: string;
    state?: V5SessionState;
    inputArtifactIds?: string[];
    roleId?: string;
    turnId?: string;
    deliberationMaxRounds?: number;
    targetRoleId?: string;
  };

  if (!capabilityId || !state || !turnId) {
    return res.status(400).json({ error: "bad_request", message: "capabilityId, state and turnId are required" });
  }

  try {
    // GitHub MCP source/evidence capabilities (P0 Autopilot absorption).
    // These bypass LLM entirely and return the raw executor shape using the
    // existing mcp-github-source reusable modules (url parse + safe http + summary derivation).
    // WhyBuddy runtime still owns commitArtifact, Trust Gate, producedBy, evidenceRefs, etc.
    if (capabilityId === "source.github.inspect" || capabilityId === "evidence.github.collect") {
      const gh = await executeGithubMcpCapability(capabilityId, state, inputArtifactIds);
      return res.json(gh);
    }

    if (capabilityId === "repo.static.inspect") {
      const result = await executeRepoStaticInspect(capabilityId, state, inputArtifactIds);
      return res.json(result);
    }

    if (capabilityId === "repo.inspect") {
      const result = await executeRepoInspectMapped(state, inputArtifactIds);
      return res.json(result);
    }

    if (capabilityId === "evidence.search") {
      const result = await executeEvidenceSearchMapped(state, inputArtifactIds, roleId);
      return res.json(result);
    }

    if (isDeliberationCapability(capabilityId)) {
      const config = getAIConfig();
      if (!config.apiKey) {
        throw new Error("LLM not configured (no apiKey from getAIConfig)");
      }
      const result = await executeDeliberationCapabilityMapped({
        capabilityId: capabilityId as any,
        state,
        inputArtifactIds,
        roleId,
        turnId,
        deliberationMaxRounds,
        targetRoleId,
      });
      return res.json(result);
    }

    const config = getAIConfig();
    if (!config.apiKey) {
      throw new Error("LLM not configured (no apiKey from getAIConfig)");
    }

    // Build compact context (mirrors the spirit of the previous client direct prompts but now on server).
    const goalText = (state as any)?.goal?.text || (state as any)?.goal || "";
    const recentArtifacts = ((state as any).artifacts || []).slice(-6).map((a: any) => ({
      title: a?.title,
      kind: a?.kind,
      summary: String(a?.summary || "").slice(0, 220),
    }));

    const systemPrompt =
      "You are an expert AI collaborator for WhyBuddy V5. " +
      "Return ONLY a single JSON object (no prose, no ```json fences) with exactly these keys:\n" +
      '{"title": string, "summary": string, "content": string}\n' +
      "title: short and specific. summary: one-sentence high-signal. content: professional, actionable, evidence-based.";

    let userPrompt = "";
    if (capabilityId === "risk.analyze") {
      userPrompt =
        `Capability: risk.analyze\nGoal: ${goalText}\n` +
        `Context artifacts: ${JSON.stringify(recentArtifacts)}\n` +
        `Role: ${roleId || "unspecified"}  Turn: ${turnId}\n\n` +
        "Produce a focused risk analysis: key risks, likelihood/impact, mitigations.";
    } else if (capabilityId === "report.write") {
      // Use the deterministic 9-section builder as authoritative base (LLM only polishes/expands).
      // This ensures the main report artifact keeps the strong schema + evidence refs even when real server LLM is active.
      const built = buildStructuredReport({ state, inputArtifactIds, roleId });
      userPrompt =
        `Capability: report.write\nGoal: ${goalText}\n` +
        `Base structured evidence (authoritative 9-section skeleton from buildStructuredReport — preserve all sections, key facts, upstream refs, risks, gaps, and the exact structure; only polish narrative, flow, insight and professionalism):\n` +
        `BASE_TITLE: ${built.title}\nBASE_SUMMARY: ${built.summary}\nBASE_CONTENT:\n${built.content}\n\n` +
        `Role: ${roleId || "综合"}  Turn: ${turnId}\n\n` +
        "Return the polished final evidence report as the required JSON {title, summary, content}.";
    } else {
      // Client error, not LLM execution error.
      const err = new Error(`Server LLM provider does not handle capability: ${capabilityId}`);
      (err as any).status = 400;
      throw err;
    }

    const { json: result, usage } = await callLLMJsonWithUsage<{ title?: string; summary?: string; content?: string }>(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        model: config.model,
        temperature: 0.25,
        timeoutMs: Math.min(config.timeoutMs, 120000),
      } as any
    );

    const title = (result.title || (capabilityId === "risk.analyze" ? "Risk Analysis" : "Evidence Report")).trim();
    const summary = (result.summary || "").trim();
    const content = (result.content || "Model returned no content.").trim();

    return res.json({
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
    console.error("[whybuddy] /execute-capability failed:", msg);
    const status = e?.status || 500;
    const code = status === 400 || status === 422 ? "unsupported_capability" : "llm_execution_failed";
    // Non-2xx so the client provider throws → LlmCapabilityExecutor fallback.
    return res.status(status).json({ error: code, message: msg.slice(0, 300) });
  }
});

export default router;

/**
 * Durability pilot test helpers (smoke + future server tests only).
 * - Never called from normal request handlers or the public HTTP surface.
 * - Allow the smoke to prove "re-initialize backing from durable file recovers prior writes"
 *   without killing the dev server process (via the __reload endpoint) or for direct use.
 */
export const __WHYBUDDY_SESSIONS_FILE = DATA_FILE;

export function __reloadFromDisk(): void {
  reloadFromDisk();
}
