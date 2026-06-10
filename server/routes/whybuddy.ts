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
