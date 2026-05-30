# Skill Session Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-based `/api/skill/session/*` facade so a Trae Skill can start a workflow session, observe agent status summaries, respond to decisions, and receive the final result package.

**Architecture:** Keep the existing runtime intact and add a thin facade layer on top of the current Express server. Introduce one in-memory session store for sandbox verification, one dedicated router for `start/respond/snapshot/agent-stream`, and one mapper that converts internal session state into Skill-friendly snapshots, decisions, and result envelopes.

**Tech Stack:** TypeScript, Express, Vitest, existing server bootstrap in `server/index.ts`

---

### Task 1: Create Failing Session Route Tests

**Files:**
- Create: `server/tests/skill-session-routes.test.ts`
- Test: `server/tests/skill-session-routes.test.ts`

- [ ] **Step 1: Write the failing tests for session lifecycle endpoints**

```ts
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import {
  createSkillSessionRouter,
  createInMemorySkillSessionStore,
} from "../routes/skill-session.js";

async function withSessionServer(handler: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/skill/session",
    createSkillSessionRouter({
      store: createInMemorySkillSessionStore(),
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe("skill session routes", () => {
  it("starts a session and returns a running snapshot", async () => {
    await withSessionServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "我想做一个 AI 剧本共创平台" }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("running");
      expect(body.snapshot.stage).toBe("clarification");
      expect(body.sessionId).toMatch(/^skill_sess_/);
    });
  });

  it("returns the same session from snapshot", async () => {
    await withSessionServer(async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 session snapshot" }),
      });
      const startBody = await startResponse.json();

      const snapshotResponse = await fetch(
        `${baseUrl}/api/skill/session/${startBody.sessionId}/snapshot`,
      );
      const snapshotBody = await snapshotResponse.json();

      expect(snapshotResponse.status).toBe(200);
      expect(snapshotBody.sessionId).toBe(startBody.sessionId);
      expect(snapshotBody.snapshot.stage).toBe("clarification");
    });
  });

  it("returns a decision_required event from the agent stream", async () => {
    await withSessionServer(async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 agent stream" }),
      });
      const startBody = await startResponse.json();

      const streamResponse = await fetch(
        `${baseUrl}/api/skill/session/${startBody.sessionId}/agent-stream`,
      );
      const streamBody = await streamResponse.json();

      expect(streamResponse.status).toBe(200);
      expect(streamBody.events.at(-1).type).toBe("decision_required");
      expect(streamBody.events.at(-1).waitingForUser).toBe(true);
    });
  });

  it("accepts a clarification answer and transitions to route selection", async () => {
    await withSessionServer(async baseUrl => {
      const startResponse = await fetch(`${baseUrl}/api/skill/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "测试 respond" }),
      });
      const startBody = await startResponse.json();

      const respondResponse = await fetch(`${baseUrl}/api/skill/session/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: startBody.sessionId,
          stepId: "clarify-target-user",
          answer: { selected: "consumer" },
        }),
      });
      const respondBody = await respondResponse.json();

      expect(respondResponse.status).toBe(200);
      expect(respondBody.status).toBe("waiting_for_user");
      expect(respondBody.decision.stepId).toBe("route-selection");
      expect(respondBody.snapshot.stage).toBe("route_selection");
    });
  });
});
```

- [ ] **Step 2: Run the new route test and confirm it fails because the session facade router does not exist yet**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-session-routes.test.ts
```

Expected:

```text
FAIL  server/tests/skill-session-routes.test.ts
Error: Failed to load url ../routes/skill-session.js
```

- [ ] **Step 3: Commit the failing test scaffold**

```bash
git add server/tests/skill-session-routes.test.ts
git commit -m "test: add failing tests for skill session facade"
```

### Task 2: Implement the In-Memory Session Facade

**Files:**
- Create: `server/routes/skill-session.ts`
- Test: `server/tests/skill-session-routes.test.ts`

- [ ] **Step 1: Add focused session, decision, snapshot, and event types**

```ts
import express from "express";
import { randomUUID } from "node:crypto";

type SkillSessionStatus = "running" | "waiting_for_user" | "completed" | "failed";
type SkillDecisionType = "single_select" | "multi_select" | "text_input";
type SkillAgentStatus = "working" | "blocked" | "completed";

interface SkillAgentCard {
  id: string;
  name: string;
  role: string;
  status: SkillAgentStatus;
  summary: string;
}

interface SkillDecision {
  stepId: string;
  type: SkillDecisionType;
  title: string;
  description: string;
  required: boolean;
  options?: Array<{ id: string; label: string; description: string }>;
}

interface SkillSnapshot {
  stage: string;
  summary: string;
  waitingForUser: boolean;
  agents: SkillAgentCard[];
}

interface SkillAgentStreamEvent {
  sequence: number;
  type: "agent_status" | "decision_required";
  timestamp: string;
  stage: string;
  agent: Omit<SkillAgentCard, "summary">;
  summary: string;
  waitingForUser: boolean;
}
```

- [ ] **Step 2: Implement a minimal in-memory store with start/respond/snapshot/stream methods**

```ts
interface SkillSessionRecord {
  sessionId: string;
  input: string;
  status: SkillSessionStatus;
  snapshot: SkillSnapshot;
  decision: SkillDecision | null;
  events: SkillAgentStreamEvent[];
  result: null | {
    input: string;
    clarifications: Array<{ stepId: string; answer: string }>;
    selectedRoute: { id: string; label: string } | null;
    specTree: { title: string; nodes: unknown[] };
    specDocument: { title: string; markdown: string };
    imagePrompts: Array<{ id: string; label: string; prompt: string; imageSize: string }>;
  };
  clarifications: Array<{ stepId: string; answer: string }>;
}

export function createInMemorySkillSessionStore() {
  const sessions = new Map<string, SkillSessionRecord>();

  function createInitialDecision(): SkillDecision {
    return {
      stepId: "clarify-target-user",
      type: "single_select",
      title: "你更想优先验证哪类用户？",
      description: "这会影响后续路线和规格结构。",
      required: true,
      options: [
        { id: "consumer", label: "C 端用户", description: "面向普通用户" },
        { id: "business", label: "B 端团队", description: "面向企业团队" },
      ],
    };
  }

  function start(input: string): SkillSessionRecord {
    const sessionId = `skill_sess_${randomUUID()}`;
    const decision = createInitialDecision();
    const snapshot: SkillSnapshot = {
      stage: "clarification",
      summary: "澄清师已生成首个澄清问题，等待用户回答。",
      waitingForUser: true,
      agents: [
        {
          id: "clarifier",
          name: "澄清师",
          role: "clarifier",
          status: "blocked",
          summary: "等待用户回答目标用户问题",
        },
      ],
    };
    const record: SkillSessionRecord = {
      sessionId,
      input,
      status: "waiting_for_user",
      snapshot,
      decision,
      result: null,
      clarifications: [],
      events: [
        {
          sequence: 1,
          type: "agent_status",
          timestamp: new Date().toISOString(),
          stage: "clarification",
          agent: {
            id: "clarifier",
            name: "澄清师",
            role: "clarifier",
            status: "working",
          },
          summary: "正在分析初始输入",
          waitingForUser: false,
        },
        {
          sequence: 2,
          type: "decision_required",
          timestamp: new Date().toISOString(),
          stage: "clarification",
          agent: {
            id: "clarifier",
            name: "澄清师",
            role: "clarifier",
            status: "blocked",
          },
          summary: "需要用户确认目标用户类型",
          waitingForUser: true,
        },
      ],
    };
    sessions.set(sessionId, record);
    return record;
  }

  function get(sessionId: string): SkillSessionRecord | null {
    return sessions.get(sessionId) ?? null;
  }

  function respond(sessionId: string, stepId: string, selected: string): SkillSessionRecord | null {
    const record = sessions.get(sessionId);
    if (!record || stepId !== "clarify-target-user") return null;

    record.clarifications.push({ stepId, answer: selected });
    record.status = "waiting_for_user";
    record.snapshot = {
      stage: "route_selection",
      summary: "规划师已生成候选路线，等待用户选择。",
      waitingForUser: true,
      agents: [
        {
          id: "planner",
          name: "规划师",
          role: "planner",
          status: "blocked",
          summary: "等待用户选择推进路线",
        },
      ],
    };
    record.decision = {
      stepId: "route-selection",
      type: "single_select",
      title: "请选择推进路线",
      description: "不同路线会影响输出粒度和优先级。",
      required: true,
      options: [
        { id: "fast-validation", label: "快速验证路线", description: "优先得到最小产物包" },
        { id: "full-spec", label: "完整规格路线", description: "优先得到完整规格文档" },
      ],
    };
    record.events.push({
      sequence: record.events.length + 1,
      type: "decision_required",
      timestamp: new Date().toISOString(),
      stage: "route_selection",
      agent: {
        id: "planner",
        name: "规划师",
        role: "planner",
        status: "blocked",
      },
      summary: "需要用户选择推进路线",
      waitingForUser: true,
    });
    return record;
  }

  return { start, get, respond };
}
```

- [ ] **Step 3: Implement the router endpoints around the in-memory store**

```ts
export function createSkillSessionRouter(deps: {
  store: ReturnType<typeof createInMemorySkillSessionStore>;
}) {
  const router = express.Router();

  router.post("/start", (request, response) => {
    const input = typeof request.body?.input === "string" ? request.body.input.trim() : "";
    if (!input) {
      response.status(400).json({
        ok: false,
        sessionId: null,
        status: "failed",
        snapshot: null,
        decision: null,
        result: null,
        error: { code: "INVALID_INPUT", message: "input is required" },
      });
      return;
    }

    const record = deps.store.start(input);
    response.json({
      ok: true,
      sessionId: record.sessionId,
      status: record.status,
      snapshot: record.snapshot,
      decision: record.decision,
      result: record.result,
      error: null,
    });
  });

  router.get("/:id/snapshot", (request, response) => {
    const record = deps.store.get(request.params.id);
    if (!record) {
      response.status(404).json({
        ok: false,
        sessionId: null,
        status: "failed",
        snapshot: null,
        decision: null,
        result: null,
        error: { code: "SESSION_NOT_FOUND", message: "session does not exist or has expired" },
      });
      return;
    }

    response.json({
      ok: true,
      sessionId: record.sessionId,
      status: record.status,
      snapshot: record.snapshot,
      decision: record.decision,
      result: record.result,
      error: null,
    });
  });

  router.get("/:id/agent-stream", (request, response) => {
    const record = deps.store.get(request.params.id);
    if (!record) {
      response.status(404).json({
        ok: false,
        sessionId: null,
        cursor: 0,
        events: [],
        error: { code: "SESSION_NOT_FOUND", message: "session does not exist or has expired" },
      });
      return;
    }

    response.json({
      ok: true,
      sessionId: record.sessionId,
      cursor: record.events.length,
      events: record.events,
      error: null,
    });
  });

  router.post("/respond", (request, response) => {
    const sessionId = typeof request.body?.sessionId === "string" ? request.body.sessionId : "";
    const stepId = typeof request.body?.stepId === "string" ? request.body.stepId : "";
    const selected =
      typeof request.body?.answer?.selected === "string" ? request.body.answer.selected : "";

    if (!sessionId || !stepId || !selected) {
      response.status(400).json({
        ok: false,
        sessionId: sessionId || null,
        status: "failed",
        snapshot: null,
        decision: null,
        result: null,
        error: { code: "INVALID_ANSWER", message: "sessionId, stepId, and answer.selected are required" },
      });
      return;
    }

    const record = deps.store.respond(sessionId, stepId, selected);
    if (!record) {
      response.status(404).json({
        ok: false,
        sessionId,
        status: "failed",
        snapshot: null,
        decision: null,
        result: null,
        error: { code: "SESSION_NOT_FOUND", message: "session does not exist or has expired" },
      });
      return;
    }

    response.json({
      ok: true,
      sessionId: record.sessionId,
      status: record.status,
      snapshot: record.snapshot,
      decision: record.decision,
      result: record.result,
      error: null,
    });
  });

  return router;
}
```

- [ ] **Step 4: Run the focused route test and confirm it passes**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-session-routes.test.ts
```

Expected:

```text
✓ server/tests/skill-session-routes.test.ts
Tests  4 passed
```

- [ ] **Step 5: Commit the minimal session facade**

```bash
git add server/routes/skill-session.ts server/tests/skill-session-routes.test.ts
git commit -m "feat: add minimal skill session facade"
```

### Task 3: Mount the Session Facade in the Main Server

**Files:**
- Modify: `server/index.ts`
- Modify: `server/routes/skill.ts`
- Test: `server/tests/skill-routes.test.ts`
- Test: `server/tests/skill-session-routes.test.ts`

- [ ] **Step 1: Keep the existing echo router and mount the new session facade beside it**

Insert the dynamic import near the current skill route registration in `server/index.ts`:

```ts
  const { createSkillRouter } = await import("./routes/skill.js");
  const {
    createSkillSessionRouter,
    createInMemorySkillSessionStore,
  } = await import("./routes/skill-session.js");

  app.use("/api/skill", createSkillRouter());
  app.use(
    "/api/skill/session",
    createSkillSessionRouter({
      store: createInMemorySkillSessionStore(),
    }),
  );
```

- [ ] **Step 2: Run both focused test files to confirm the old bridge and new session facade coexist**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts server/tests/skill-session-routes.test.ts
```

Expected:

```text
✓ server/tests/skill-routes.test.ts
✓ server/tests/skill-session-routes.test.ts
```

- [ ] **Step 3: Commit the server mount**

```bash
git add server/index.ts server/routes/skill.ts server/routes/skill-session.ts server/tests/skill-routes.test.ts server/tests/skill-session-routes.test.ts
git commit -m "feat: expose skill session facade endpoints"
```

### Task 4: Verify the Live Sandbox Session Flow

**Files:**
- Modify: `.env.example`
- Test: `server/tests/skill-session-routes.test.ts`

- [ ] **Step 1: Document the session facade base path for sandbox verification**

Append this near the existing skill bridge setting in `.env.example`:

```env
# Skill session facade exposes start/respond/snapshot/agent-stream inside the Trae sandbox.
SKILL_SESSION_BASE_PATH=/api/skill/session
```

- [ ] **Step 2: Re-run focused tests and typecheck**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts server/tests/skill-session-routes.test.ts
pnpm exec tsc --noEmit
```

Expected:

```text
[all focused tests pass]
[no output from tsc]
```

- [ ] **Step 3: Restart the server and run a live sandbox flow against the session endpoints**

Run:

```bash
node -e "fetch('http://127.0.0.1:3001/api/skill/session/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:'我想做一个 AI 剧本共创平台'})}).then(r=>r.json()).then(async start=>{console.log('START',JSON.stringify(start));const snapshot=await fetch(`http://127.0.0.1:3001/api/skill/session/${start.sessionId}/snapshot`).then(r=>r.json());console.log('SNAPSHOT',JSON.stringify(snapshot));const stream=await fetch(`http://127.0.0.1:3001/api/skill/session/${start.sessionId}/agent-stream`).then(r=>r.json());console.log('STREAM',JSON.stringify(stream));const respond=await fetch('http://127.0.0.1:3001/api/skill/session/respond',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:start.sessionId,stepId:'clarify-target-user',answer:{selected:'consumer'}})}).then(r=>r.json());console.log('RESPOND',JSON.stringify(respond));})"
```

Expected:

```text
START {"ok":true,...,"status":"waiting_for_user",...}
SNAPSHOT {"ok":true,...,"snapshot":{"stage":"clarification",...}}
STREAM {"ok":true,...,"events":[...,"type":"decision_required",...]}
RESPOND {"ok":true,...,"snapshot":{"stage":"route_selection",...}}
```

- [ ] **Step 4: Commit the verification and docs changes**

```bash
git add .env.example server/index.ts server/routes/skill-session.ts server/tests/skill-session-routes.test.ts
git commit -m "docs: document skill session facade sandbox flow"
```
