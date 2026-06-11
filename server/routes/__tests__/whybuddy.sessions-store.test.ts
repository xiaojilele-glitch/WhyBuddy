import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("WhyBuddy session store HTTP API", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whybuddy-store-"));
  const dataFile = path.join(tmpDir, "sessions.json");
  let restoreEnv: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let base = "";

  beforeEach(async () => {
    restoreEnv = process.env.WHYBUDDY_SESSIONS_FILE;
    process.env.WHYBUDDY_SESSIONS_FILE = dataFile;
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);

    vi.resetModules();
    const mod = await import("../whybuddy.js");
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/whybuddy", mod.default);

    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    if (restoreEnv === undefined) delete process.env.WHYBUDDY_SESSIONS_FILE;
    else process.env.WHYBUDDY_SESSIONS_FILE = restoreEnv;
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
  });

  it("PUT/GET/LIST/DELETE roundtrip with 404 after delete", async () => {
    const sid = `vitest-store-${Date.now()}`;
    const minimal = {
      sessionId: sid,
      goal: { text: "store vitest", status: "needs_refinement" },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
    };

    const put = await fetch(`${base}/sessions/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minimal),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${base}/sessions/${sid}`);
    expect(get.status).toBe(200);
    const loaded = await get.json();
    expect(loaded.sessionId).toBe(sid);

    const list = await fetch(`${base}/sessions`);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.sessions.some((s: { sessionId: string }) => s.sessionId === sid)).toBe(true);

    const del = await fetch(`${base}/sessions/${sid}`, { method: "DELETE" });
    expect([200, 204]).toContain(del.status);

    const missing = await fetch(`${base}/sessions/${sid}`);
    expect(missing.status).toBe(404);
  });
});