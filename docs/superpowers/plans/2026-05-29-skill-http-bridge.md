# Skill HTTP Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal `POST /api/skill/echo` endpoint so a Trae Skill running in the same sandbox can call the project over HTTP and receive structured JSON.

**Architecture:** Keep the implementation inside the existing Express server. Add one focused router file for `/api/skill`, mount it in `server/index.ts`, and verify behavior with a dedicated Vitest route test plus one live sandbox fetch command against `localhost:3001`.

**Tech Stack:** TypeScript, Express, Vitest, existing server bootstrap in `server/index.ts`

---

### Task 1: Add Failing Route Tests

**Files:**
- Create: `server/tests/skill-routes.test.ts`
- Test: `server/tests/skill-routes.test.ts`

- [ ] **Step 1: Write the failing tests for the happy path and validation errors**

```ts
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createSkillRouter } from "../routes/skill.js";

async function withSkillServer(handler: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/skill", createSkillRouter());

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

describe("skill routes", () => {
  afterEach(() => {
    delete process.env.SOLO_TRAE_BYPASS_AUTH;
  });

  it("echoes a valid skill message", async () => {
    await withSkillServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/skill/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello from skill" }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        message: "hello from skill",
        source: "cube-pets-office",
        channel: "skill-http-bridge",
      });
    });
  });

  it("returns 400 when message is missing", async () => {
    await withSkillServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/skill/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        ok: false,
        error: "message is required",
      });
    });
  });

  it("returns 400 when message is blank", async () => {
    await withSkillServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/skill/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "   " }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        ok: false,
        error: "message must be a non-empty string",
      });
    });
  });
});
```

- [ ] **Step 2: Run the focused route test and confirm it fails because the router does not exist yet**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts
```

Expected:

```text
FAIL  server/tests/skill-routes.test.ts
Error: Cannot find module '../routes/skill.js'
```

- [ ] **Step 3: Commit the failing test scaffold**

```bash
git add server/tests/skill-routes.test.ts
git commit -m "test: add failing tests for skill http bridge"
```

### Task 2: Implement the Skill Router

**Files:**
- Create: `server/routes/skill.ts`
- Test: `server/tests/skill-routes.test.ts`

- [ ] **Step 1: Create the minimal skill router with input validation**

```ts
import express from "express";

interface SkillEchoRequestBody {
  message?: unknown;
}

function parseMessage(body: SkillEchoRequestBody): string | null {
  if (typeof body.message !== "string") {
    return null;
  }

  const message = body.message.trim();
  return message ? message : null;
}

export function createSkillRouter() {
  const router = express.Router();

  router.post("/echo", (request, response) => {
    const message = parseMessage((request.body ?? {}) as SkillEchoRequestBody);

    if (typeof (request.body ?? {}).message === "undefined") {
      response.status(400).json({ ok: false, error: "message is required" });
      return;
    }

    if (!message) {
      response.status(400).json({
        ok: false,
        error: "message must be a non-empty string",
      });
      return;
    }

    response.json({
      ok: true,
      message,
      source: "cube-pets-office",
      channel: "skill-http-bridge",
    });
  });

  return router;
}
```

- [ ] **Step 2: Run the focused route test again and make sure it passes**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts
```

Expected:

```text
✓ server/tests/skill-routes.test.ts
Tests  3 passed
```

- [ ] **Step 3: Commit the router implementation**

```bash
git add server/routes/skill.ts server/tests/skill-routes.test.ts
git commit -m "feat: add minimal skill echo router"
```

### Task 3: Mount the Router in the Main Server

**Files:**
- Modify: `server/index.ts`
- Test: `server/tests/skill-routes.test.ts`

- [ ] **Step 1: Add the route import and mount `/api/skill` in the bootstrap path**

Insert a dynamic import and mount in `server/index.ts` near the other `app.use("/api/*", ...)` route registrations:

```ts
  const { createSkillRouter } = await import("./routes/skill.js");

  app.use("/api/skill", createSkillRouter());

  // ── Agent Permission Model ──
  const { RoleStore } = await import("./permission/role-store.js");
```

- [ ] **Step 2: Run the focused route test to verify the mount change does not break the new router**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts
```

Expected:

```text
✓ server/tests/skill-routes.test.ts
Tests  3 passed
```

- [ ] **Step 3: Commit the server mount**

```bash
git add server/index.ts server/routes/skill.ts server/tests/skill-routes.test.ts
git commit -m "feat: expose skill http bridge endpoint"
```

### Task 4: Verify the Live Sandbox HTTP Bridge

**Files:**
- Modify: `.env.example`
- Test: `server/tests/skill-routes.test.ts`

- [ ] **Step 1: Document the local bridge assumption for sandbox runs**

Append this near the existing sandbox settings in `.env.example`:

```env
# Skill bridge uses the local server inside the Trae sandbox.
SKILL_BRIDGE_BASE_URL=http://localhost:3001
```

- [ ] **Step 2: Re-run the focused test and then run a live fetch against the running server**

Run:

```bash
pnpm vitest run --config vitest.config.server.ts server/tests/skill-routes.test.ts
node -e "fetch('http://127.0.0.1:3001/api/skill/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'hello from skill'})}).then(async r=>{console.log(r.status);console.log(await r.text())})"
```

Expected:

```text
200
{"ok":true,"message":"hello from skill","source":"cube-pets-office","channel":"skill-http-bridge"}
```

- [ ] **Step 3: Run a final type check and commit the bridge verification changes**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected:

```text
[no output]
```

Commit:

```bash
git add .env.example server/index.ts server/routes/skill.ts server/tests/skill-routes.test.ts
git commit -m "docs: document local skill http bridge"
```
