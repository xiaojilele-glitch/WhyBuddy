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
import { callLLMJson, callLLMJsonWithUsage } from "../core/llm-client.js";
import { buildStructuredReport } from "../../shared/blueprint/whybuddy-report-builder.js";
import { executeGithubMcpCapability } from "../whybuddy/github-mcp-adapter.js";
import { executeRepoStaticInspect } from "../whybuddy/repo-static-analyzer.js";
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

// POST /api/whybuddy/execute-capability
// Server-side LLM execution for the WhyBuddy V5 capability seam (risk.analyze + report.write).
// Reuses the project's unified LLM stack (getAIConfig + callLLMJson) exactly like /autopilot and blueprint routes.
// Input: the same args the LlmCapabilityProvider receives on the client.
// Output: strictly the raw 4-field shape { title, summary, content, provenance? }.
// On any config/LLM error we return 5xx (or throw) so the client LlmCapabilityExecutor reliably falls back
// to PilotRealCapabilityExecutor. This route never touches commitArtifact, Trust Gate, producedBy, or session state.
router.post("/execute-capability", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const { capabilityId, state, inputArtifactIds = [], roleId, turnId } = (req.body || {}) as {
    capabilityId?: string;
    state?: V5SessionState;
    inputArtifactIds?: string[];
    roleId?: string;
    turnId?: string;
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
