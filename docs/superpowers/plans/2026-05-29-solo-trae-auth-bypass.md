# Solo Trae Auth Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Solo Trae sandbox-only auth bypass switch that skips `requireAuth` and `requireAdmin` while keeping the default auth behavior unchanged elsewhere.

**Architecture:** Keep the change inside `server/auth/middleware.ts` so route wiring stays untouched. Introduce one environment-gated sandbox user context and validate it with focused middleware tests plus one environment example update.

**Tech Stack:** TypeScript, Express, Vitest, existing auth/session middleware

---

### Task 1: Cover Sandbox Bypass With Tests

**Files:**
- Modify: `server/tests/auth-session-middleware.test.ts`
- Test: `server/tests/auth-session-middleware.test.ts`

- [ ] **Step 1: Write the failing sandbox-auth tests**

```ts
it("bypasses required auth in Solo Trae sandbox mode", async () => {
  process.env.SOLO_TRAE_BYPASS_AUTH = "true";
  await withServer(service(null), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/required`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe("solo-trae-sandbox");
    expect(body.user.role).toBe("super_admin");
  });
});

it("bypasses admin auth in Solo Trae sandbox mode", async () => {
  process.env.SOLO_TRAE_BYPASS_AUTH = "true";
  await withServer(service(null), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the focused test file and confirm the new tests fail**

Run: `pnpm vitest run server/tests/auth-session-middleware.test.ts`
Expected: FAIL because sandbox mode is not implemented yet.

### Task 2: Implement Sandbox-Only Middleware Bypass

**Files:**
- Modify: `server/auth/middleware.ts`

- [ ] **Step 1: Add an env-gated sandbox bypass helper and sandbox user fixture**

```ts
const SOLO_TRAE_SANDBOX_USER: CurrentUser = {
  id: "solo-trae-sandbox",
  email: "solo-trae-sandbox@local.invalid",
  displayName: "Solo Trae Sandbox",
  role: "super_admin",
  status: "active",
  emailVerified: true,
  createdAt: "2026-05-29T00:00:00.000Z",
};

function isSandboxAuthBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SOLO_TRAE_BYPASS_AUTH?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
```

- [ ] **Step 2: Inject sandbox user and skip auth/admin guards when the flag is enabled**

```ts
if (isSandboxAuthBypassEnabled()) {
  const target = request as RequestWithOptionalUser;
  target.user = SOLO_TRAE_SANDBOX_USER;
  target.sessionId = "solo-trae-sandbox-session";
  next();
  return;
}
```

- [ ] **Step 3: Keep default behavior unchanged when the flag is off**

```ts
const restored = await restoreUser(request);
if (!restored) {
  sessionService.clearCookie(response);
  response.status(401).json({ success: false, error: "Authentication required" });
  return;
}
```

### Task 3: Document And Verify

**Files:**
- Modify: `.env.example`
- Test: `server/tests/auth-session-middleware.test.ts`

- [ ] **Step 1: Document the sandbox-only switch**

```env
# Solo Trae sandbox only: bypass HTTP auth and admin checks for local sandbox runs.
SOLO_TRAE_BYPASS_AUTH=false
```

- [ ] **Step 2: Re-run focused verification**

Run: `pnpm vitest run server/tests/auth-session-middleware.test.ts`
Expected: PASS with both default auth behavior and sandbox bypass behavior covered.

- [ ] **Step 3: Run diagnostics-level type safety check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS without introducing TypeScript errors in auth middleware or tests.
