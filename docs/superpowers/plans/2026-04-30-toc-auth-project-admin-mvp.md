# ToC Auth Project Admin MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next MVP slice after Wave 0: email login, DB-backed session, personal project ownership isolation, and a read-only admin gate.

**Architecture:** Wave 0 already provides MySQL/Redis persistence under `server/persistence`. This plan makes auth the shared contract first: `requireAuth` injects `req.user`, project APIs consume it for `owner_user_id`, and admin APIs consume the same session via `requireAdmin`. Redis remains optional; Redis miss or outage must fall back to MySQL sessions.

**Tech Stack:** Express 4, TypeScript ESM, mysql2/promise via `server/persistence/mysql.ts`, Wouter, Zustand, Vitest server config with `--pool=forks --poolOptions.forks.singleFork`.

---

## Current Baseline

- Latest persistence foundation commit: `b05a304 feat: add toc persistence foundation`.
- Wave 0 spec is complete: `.kiro/specs/lightweight-mysql-redis-persistence-strategy/tasks.md`.
- Remaining MVP specs:
  - `.kiro/specs/consumer-email-auth-and-account/tasks.md`: `0 / 14`
  - `.kiro/specs/personal-project-ownership-and-isolation/tasks.md`: `0 / 15`
  - `.kiro/specs/admin-console-and-global-role-gate/tasks.md`: `0 / 15`
- Existing project UI still uses `client/src/lib/project-store.ts` and localStorage.
- Existing app routes live in `client/src/App.tsx`.
- Existing safe fetch helper is `client/src/lib/api-client.ts`.
- Do not replace `server/db/index.ts`; it remains legacy/demo/runtime storage.

## Parallel Execution Boundary

These can run in parallel after Task 2 is merged:

- Project owner API worker: `server/projects/*`, `server/routes/projects.ts`, project API tests.
- Frontend auth/admin UI worker: `client/src/lib/auth-store.ts`, `client/src/pages/auth/*`, `client/src/pages/admin/*`, shell entry.
- Admin API worker: `server/routes/admin.ts`, admin tests.

These should not be parallelized before the contract is fixed:

- `shared/auth.ts`
- `server/auth/session-service.ts`
- `server/auth/middleware.ts`
- `server/routes/auth.ts`

Reason: every later slice depends on `CurrentUser`, cookie name, response shape, and `req.user` typing.

---

## File Map

### Shared Contract

- Create `shared/auth.ts`: `UserRole`, `UserStatus`, `CurrentUser`, request/response contracts.
- Create `server/auth/types.ts`: Express request augmentation helpers for authenticated requests.

### Server Auth

- Create `server/auth/password.ts`: password hash and verify helpers using Node `crypto.scrypt`.
- Create `server/auth/session-service.ts`: opaque token generation, SHA-256 token hash, DB session lookup, cookie options.
- Create `server/auth/middleware.ts`: `requireAuth`, `optionalAuth`, `requireAdmin`.
- Create `server/routes/auth.ts`: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/refresh`, `/api/auth/logout`.
- Modify `server/index.ts`: mount `/api/auth`.
- Extend `server/persistence/repositories.ts` only if needed for `findById`, session expiry extension, and admin listing.

### Server Projects

- Create `server/projects/project-service.ts`: maps API payloads to `projects` repository calls.
- Create `server/routes/projects.ts`: `/api/projects` CRUD subset and owner guard.
- Modify `server/index.ts`: mount `/api/projects`.
- Extend `server/persistence/repositories.ts`: add `updateForOwner`, `findAnyById` if required for admin read-only.

### Server Admin

- Create `server/routes/admin.ts`: read-only summary/users/projects/runs/failures/audit.
- Modify `server/index.ts`: mount `/api/admin`.

### Frontend Auth and Routing

- Create `client/src/lib/auth-store.ts`: current user, loading, login/register/logout/fetchMe, `isAdmin`.
- Create `client/src/pages/auth/AuthPage.tsx`: login/register page.
- Create `client/src/pages/admin/AdminLayout.tsx`.
- Create admin pages under `client/src/pages/admin/`: `OverviewPage.tsx`, `UsersPage.tsx`, `ProjectsPage.tsx`, `RunsPage.tsx`, `FailuresPage.tsx`, `AuditPage.tsx`.
- Modify `client/src/App.tsx`: add `/login`, `/admin/*` routes and auth bootstrap.
- Modify `client/src/components/AppSidebar.tsx`: show admin entry only when `isAdmin`.
- Modify `client/src/components/MobileTabBar.tsx` only if mobile admin entry is desired for admins.

### Frontend Project Ownership Transition

- Modify `client/src/lib/project-store.ts`: add `ownerUserId?: string` and user-scoped storage key helpers.
- Create `client/src/lib/project-api.ts`: wraps `/api/projects`.
- Later in this plan, decide whether Home reads server projects immediately or keeps local transition with migration marker.

---

## Task 1: Shared Auth Contract

**Files:**
- Create: `shared/auth.ts`
- Create: `server/auth/types.ts`
- Test: `server/tests/auth-contract.test.ts`

- [x] **Step 1: Write the failing shared contract test**

Create `server/tests/auth-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isAdminRole,
  normalizeAuthEmail,
  type CurrentUser,
} from "../../shared/auth.js";

describe("auth shared contract", () => {
  it("normalizes email globally and identifies admin roles", () => {
    expect(normalizeAuthEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(isAdminRole("user")).toBe(false);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
  });

  it("keeps CurrentUser free of password and token fields", () => {
    const user: CurrentUser = {
      id: "user-1",
      email: "user@example.com",
      role: "user",
      status: "active",
      emailVerified: true,
    };

    expect(JSON.stringify(user)).not.toContain("passwordHash");
    expect(JSON.stringify(user)).not.toContain("tokenHash");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-contract.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

Expected: fail because `shared/auth.ts` does not exist.

- [x] **Step 3: Add shared auth contract**

Create `shared/auth.ts`:

```ts
export type UserRole = "user" | "admin" | "super_admin";
export type UserStatus = "active" | "disabled";

export interface CurrentUser {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
}

export interface AuthResponse {
  success: true;
  user: CurrentUser;
}

export interface AuthErrorResponse {
  success: false;
  error: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminRole(role: UserRole | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}
```

Create `server/auth/types.ts`:

```ts
import type { Request } from "express";
import type { CurrentUser } from "../../shared/auth.js";

export interface AuthenticatedRequest extends Request {
  user: CurrentUser;
  sessionId: string;
}

export interface RequestWithOptionalUser extends Request {
  user?: CurrentUser;
  sessionId?: string;
}
```

- [x] **Step 4: Run the test and verify it passes**

Run the same command. Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add shared/auth.ts server/auth/types.ts server/tests/auth-contract.test.ts
git commit -m "feat: add shared auth contract"
```

---

## Task 2: DB-Backed Session Service and Auth Middleware

**Files:**
- Create: `server/auth/password.ts`
- Create: `server/auth/session-service.ts`
- Create: `server/auth/middleware.ts`
- Modify: `server/persistence/repositories.ts`
- Test: `server/tests/auth-session-middleware.test.ts`

- [x] **Step 1: Write failing middleware tests**

Create `server/tests/auth-session-middleware.test.ts`:

```ts
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createAuthMiddleware } from "../auth/middleware.js";
import type { SessionLookupResult, SessionService } from "../auth/session-service.js";

async function withServer(
  service: Pick<SessionService, "readSessionToken" | "resolveCurrentUser" | "clearCookie">,
  handler: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  const auth = createAuthMiddleware(service as SessionService);
  app.get("/required", auth.requireAuth, (req, res) => {
    res.json({ user: (req as any).user });
  });
  app.get("/optional", auth.optionalAuth, (req, res) => {
    res.json({ user: (req as any).user ?? null });
  });
  app.get("/admin", auth.requireAuth, auth.requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });

  const address = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function service(result: SessionLookupResult | null): Pick<SessionService, "readSessionToken" | "resolveCurrentUser" | "clearCookie"> {
  return {
    readSessionToken: () => "token",
    resolveCurrentUser: async () => result,
    clearCookie: (_res) => undefined,
  };
}

describe("auth middleware", () => {
  it("returns 401 when a required session is missing", async () => {
    await withServer(service(null), async baseUrl => {
      const response = await fetch(`${baseUrl}/required`);
      expect(response.status).toBe(401);
    });
  });

  it("injects active user for required auth", async () => {
    await withServer(service({
      sessionId: "session-1",
      user: {
        id: "user-1",
        email: "user@example.com",
        role: "user",
        status: "active",
        emailVerified: true,
      },
    }), async baseUrl => {
      const response = await fetch(`${baseUrl}/required`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.id).toBe("user-1");
    });
  });

  it("returns 403 for non-admin users on admin routes", async () => {
    await withServer(service({
      sessionId: "session-1",
      user: {
        id: "user-1",
        email: "user@example.com",
        role: "user",
        status: "active",
        emailVerified: true,
      },
    }), async baseUrl => {
      const response = await fetch(`${baseUrl}/admin`);
      expect(response.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run and verify red**

Run:

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-session-middleware.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

Expected: fail because auth modules do not exist.

- [x] **Step 3: Implement password helpers**

Create `server/auth/password.ts`:

```ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, hash] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [x] **Step 4: Implement session service**

Create `server/auth/session-service.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { CurrentUser } from "../../shared/auth.js";
import type { SessionRecord, UserRecord } from "../persistence/repositories.js";

export interface SessionLookupResult {
  sessionId: string;
  user: CurrentUser;
}

export interface SessionRepositories {
  sessions: {
    create(input: {
      userId: string;
      tokenHash: string;
      ip?: string | null;
      userAgent?: string | null;
      expiresAt: Date;
    }): Promise<SessionRecord>;
    findActiveByTokenHash(tokenHash: string, now?: Date): Promise<SessionRecord | null>;
    refreshLastSeen(sessionId: string): Promise<void>;
    revoke(sessionId: string): Promise<void>;
  };
  users: {
    findById(userId: string): Promise<UserRecord | null>;
  };
}

export interface SessionService {
  createSession(input: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<{ token: string; session: SessionRecord }>;
  resolveCurrentUser(token: string | null | undefined): Promise<SessionLookupResult | null>;
  revokeSession(sessionId: string): Promise<void>;
  refreshSession(sessionId: string): Promise<void>;
  readSessionToken(request: Request): string | null;
  writeSessionCookie(response: Response, token: string): void;
  clearCookie(response: Response): void;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionService(options: {
  repositories: SessionRepositories;
  cookieName: string;
  ttlDays: number;
  secureCookie?: boolean;
  now?: () => Date;
}): SessionService {
  const now = options.now ?? (() => new Date());

  function expiresAt() {
    return new Date(now().getTime() + options.ttlDays * 24 * 60 * 60 * 1000);
  }

  function toCurrentUser(user: UserRecord): CurrentUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  return {
    async createSession(input) {
      const token = randomBytes(32).toString("base64url");
      const session = await options.repositories.sessions.create({
        userId: input.userId,
        tokenHash: hashSessionToken(token),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: expiresAt(),
      });
      return { token, session };
    },
    async resolveCurrentUser(token) {
      if (!token) return null;
      const session = await options.repositories.sessions.findActiveByTokenHash(hashSessionToken(token), now());
      if (!session) return null;
      const user = await options.repositories.users.findById(session.userId);
      if (!user || user.status !== "active") return null;
      return {
        sessionId: session.id,
        user: toCurrentUser(user),
      };
    },
    revokeSession(sessionId) {
      return options.repositories.sessions.revoke(sessionId);
    },
    refreshSession(sessionId) {
      return options.repositories.sessions.refreshLastSeen(sessionId);
    },
    readSessionToken(request) {
      const raw = request.headers.cookie ?? "";
      const cookies = raw.split(";").map(part => part.trim());
      const prefix = `${options.cookieName}=`;
      const match = cookies.find(cookie => cookie.startsWith(prefix));
      return match ? decodeURIComponent(match.slice(prefix.length)) : null;
    },
    writeSessionCookie(response, token) {
      response.cookie(options.cookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookie ?? false,
        path: "/",
        maxAge: options.ttlDays * 24 * 60 * 60 * 1000,
      });
    },
    clearCookie(response) {
      response.clearCookie(options.cookieName, { path: "/" });
    },
  };
}
```

- [x] **Step 5: Implement middleware**

Create `server/auth/middleware.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { isAdminRole } from "../../shared/auth.js";
import type { AuthenticatedRequest, RequestWithOptionalUser } from "./types.js";
import type { SessionService } from "./session-service.js";

export function createAuthMiddleware(sessionService: SessionService) {
  async function restoreUser(request: Request, response: Response) {
    const token = sessionService.readSessionToken(request);
    const result = await sessionService.resolveCurrentUser(token);
    if (!result) return null;
    const target = request as RequestWithOptionalUser;
    target.user = result.user;
    target.sessionId = result.sessionId;
    return target;
  }

  return {
    async requireAuth(request: Request, response: Response, next: NextFunction) {
      const restored = await restoreUser(request, response);
      if (!restored) {
        sessionService.clearCookie(response);
        response.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      next();
    },
    async optionalAuth(request: Request, response: Response, next: NextFunction) {
      await restoreUser(request, response);
      next();
    },
    requireAdmin(request: Request, response: Response, next: NextFunction) {
      const user = (request as AuthenticatedRequest).user;
      if (!user) {
        response.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      if (!isAdminRole(user.role)) {
        response.status(403).json({ success: false, error: "Admin privileges required" });
        return;
      }
      next();
    },
  };
}
```

- [x] **Step 6: Add repository `findById` and run tests**

Modify `createUsersRepository` in `server/persistence/repositories.ts` to include:

```ts
async findById(userId: string): Promise<UserRecord | null> {
  const rows = await db.query<UserRow>(
    `SELECT id, email, email_normalized, password_hash, display_name, avatar_url, role, status,
            email_verified_at, last_login_at, last_login_ip, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}
```

Run:

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-session-middleware.test.ts server/tests/persistence-repositories.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add server/auth/password.ts server/auth/session-service.ts server/auth/middleware.ts server/auth/types.ts server/persistence/repositories.ts server/tests/auth-session-middleware.test.ts
git commit -m "feat: add db session auth middleware"
```

---

## Task 3: Auth Routes

**Files:**
- Create: `server/routes/auth.ts`
- Modify: `server/index.ts`
- Modify: `server/persistence/repositories.ts`
- Test: `server/tests/auth-routes.test.ts`

- [x] **Step 1: Write failing route tests**

Create `server/tests/auth-routes.test.ts` with route factory tests that do not import `server/index.ts`. Cover:

```ts
// Required cases:
// POST /api/auth/register returns 201 and Set-Cookie.
// Duplicate email returns 409.
// POST /api/auth/login returns generic 401 for wrong password.
// GET /api/auth/me returns safe CurrentUser.
// POST /api/auth/logout revokes session and clears cookie.
// Disabled user cannot login.
```

Use in-memory fake repositories with the same method names as `createUsersRepository` and `createSessionsRepository`. Do not hit real MySQL in unit route tests.

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-routes.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

Expected: fail because `server/routes/auth.ts` does not exist.

- [x] **Step 3: Implement `createAuthRouter`**

Create `server/routes/auth.ts` with this public shape:

```ts
export function createAuthRouter(deps: {
  users: ReturnType<typeof createUsersRepository>;
  sessions: ReturnType<typeof createSessionsRepository>;
  sessionService: SessionService;
}) {
  const router = express.Router();
  const auth = createAuthMiddleware(deps.sessionService);
  router.post("/register", ...);
  router.post("/login", ...);
  router.get("/me", auth.requireAuth, ...);
  router.post("/refresh", auth.requireAuth, ...);
  router.post("/logout", auth.requireAuth, ...);
  return router;
}
```

Validation rules:

- Email required and normalized.
- Password minimum length 8.
- Duplicate email returns 409.
- Login failure always returns `401 { success:false, error:"邮箱或密码错误" }`.
- Never return `passwordHash`, `tokenHash`, or token plaintext in JSON.

- [x] **Step 4: Wire real dependencies in `server/index.ts`**

Near other route imports after persistence foundation is available:

```ts
const { readPersistenceConfig } = await import("./persistence/config.js");
const { createMysqlQueryExecutor } = await import("./persistence/mysql.js");
const {
  createUsersRepository,
  createSessionsRepository,
} = await import("./persistence/repositories.js");
const { createSessionService } = await import("./auth/session-service.js");
const { createAuthRouter } = await import("./routes/auth.js");

const persistenceConfig = readPersistenceConfig();
const authDb = createMysqlQueryExecutor(persistenceConfig.database.mysql);
const usersRepository = createUsersRepository(authDb);
const sessionsRepository = createSessionsRepository(authDb);
const sessionService = createSessionService({
  repositories: {
    users: usersRepository,
    sessions: sessionsRepository,
  },
  cookieName: persistenceConfig.session.cookieName,
  ttlDays: persistenceConfig.session.ttlDays,
  secureCookie: process.env.NODE_ENV === "production",
});

app.use("/api/auth", createAuthRouter({
  users: usersRepository,
  sessions: sessionsRepository,
  sessionService,
}));
```

If this duplicates DB executor creation with health, keep it local for now; do not refactor global app lifecycle in this task.

- [x] **Step 5: Run route tests and smoke**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-routes.test.ts server/tests/auth-session-middleware.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
npx tsx scripts/persistence-smoke.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add server/routes/auth.ts server/index.ts server/persistence/repositories.ts server/tests/auth-routes.test.ts
git commit -m "feat: add email auth routes"
```

---

## Task 4: Frontend Auth Store and Login Page

**Files:**
- Create: `client/src/lib/auth-store.ts`
- Create: `client/src/pages/auth/AuthPage.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/lib/auth-store.test.ts`

- [x] **Step 1: Write failing auth store tests**

Create `client/src/lib/auth-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./auth-store";

describe("auth store", () => {
  beforeEach(() => {
    useAuthStore.getState().resetForTest();
    vi.restoreAllMocks();
  });

  it("fetches current user and derives isAdmin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      user: {
        id: "admin-1",
        email: "admin@example.com",
        role: "admin",
        status: "active",
        emailVerified: true,
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await useAuthStore.getState().fetchMe();

    expect(useAuthStore.getState().currentUser?.id).toBe("admin-1");
    expect(useAuthStore.getState().isAdmin()).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run client/src/lib/auth-store.test.ts
```

If Windows hits `spawn EPERM`, rerun with:

```powershell
npx vitest run client/src/lib/auth-store.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Implement `auth-store`**

Create `client/src/lib/auth-store.ts`:

```ts
import { create } from "zustand";
import { isAdminRole, type CurrentUser, type LoginRequest, type RegisterRequest } from "../../../shared/auth";
import { fetchJsonSafe } from "./api-client";

interface AuthState {
  currentUser: CurrentUser | null;
  loading: boolean;
  error: string | null;
  fetchMe: () => Promise<void>;
  login: (input: LoginRequest) => Promise<boolean>;
  register: (input: RegisterRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  resetForTest: () => void;
}

const initial = {
  currentUser: null,
  loading: false,
  error: null,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initial,
  async fetchMe() {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<{ success: true; user: CurrentUser } | { success: false; error: string }>("/api/auth/me", {
      credentials: "include",
    });
    if (result.ok && result.data.success) {
      set({ currentUser: result.data.user, loading: false });
      return;
    }
    set({ currentUser: null, loading: false });
  },
  async login(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<{ success: true; user: CurrentUser } | { success: false; error: string }>("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (result.ok && result.data.success) {
      set({ currentUser: result.data.user, loading: false });
      return true;
    }
    set({ currentUser: null, loading: false, error: result.ok ? result.data.error : result.error.message });
    return false;
  },
  async register(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<{ success: true; user: CurrentUser } | { success: false; error: string }>("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (result.ok && result.data.success) {
      set({ currentUser: result.data.user, loading: false });
      return true;
    }
    set({ currentUser: null, loading: false, error: result.ok ? result.data.error : result.error.message });
    return false;
  },
  async logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    set({ currentUser: null, error: null, loading: false });
  },
  isAuthenticated() {
    return Boolean(get().currentUser);
  },
  isAdmin() {
    return isAdminRole(get().currentUser?.role);
  },
  resetForTest() {
    set(initial);
  },
}));
```

- [x] **Step 4: Add login page and routes**

Create `client/src/pages/auth/AuthPage.tsx` as a compact app page with email, password, display name only in register mode, submit button, and no marketing hero.

Modify `client/src/App.tsx`:

```tsx
import AuthPage from "./pages/auth/AuthPage";
import { useAuthStore } from "./lib/auth-store";
```

Add routes:

```tsx
<Route path={"/login"} component={AuthPage} />
```

Add an auth bootstrap component inside `AppShell` or `App`:

```tsx
function AuthBootstrap() {
  const fetchMe = useAuthStore(state => state.fetchMe);
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);
  return null;
}
```

Render `<AuthBootstrap />` under `<LocaleSync />`.

- [x] **Step 5: Run tests**

```powershell
npx vitest run client/src/lib/auth-store.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 5a: Add project workspace unauthenticated redirect**

Added `sessionChecked` to the frontend auth store so route guards wait for session restore before redirecting. `AppShell` now redirects unauthenticated access to `/`, `/tasks`, `/tasks/:taskId`, `/specs`, and replay workspace routes to `/login`, while leaving `/login`, `/admin`, and debug routes outside that personal project workspace guard.

- [ ] **Step 6: Commit**

```powershell
git add client/src/lib/auth-store.ts client/src/lib/auth-store.test.ts client/src/pages/auth/AuthPage.tsx client/src/App.tsx
git commit -m "feat: add frontend auth flow"
```

---

## Task 5: Project Owner Type and Local Migration Boundary

**Files:**
- Modify: `client/src/lib/project-store.ts`
- Test: `client/src/lib/project-store.test.ts`

- [x] **Step 1: Write failing tests**

Add tests in `client/src/lib/project-store.test.ts`:

```ts
it("assigns ownerUserId when creating a project with an authenticated owner", () => {
  useProjectStore.getState().setActiveOwnerForTest("user-1");
  const project = useProjectStore.getState().createProject({ goal: "Build auth" });
  expect(project.ownerUserId).toBe("user-1");
});

it("uses a user-scoped current project selection", () => {
  useProjectStore.getState().setActiveOwnerForTest("user-1");
  const first = useProjectStore.getState().createProject({ goal: "First" });
  useProjectStore.getState().setActiveOwnerForTest("user-2");
  const second = useProjectStore.getState().createProject({ goal: "Second" });
  expect(first.ownerUserId).toBe("user-1");
  expect(second.ownerUserId).toBe("user-2");
});
```

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run client/src/lib/project-store.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Add `ownerUserId` transition support**

Modify `Project`:

```ts
export interface Project {
  id: string;
  ownerUserId?: string;
  ...
}
```

Add to `ProjectStoreState`:

```ts
activeOwnerUserId: string | null;
setActiveOwner: (userId: string | null) => void;
setActiveOwnerForTest: (userId: string | null) => void;
```

In `emptySnapshot`, keep persisted snapshot unchanged but store runtime `activeOwnerUserId` outside `ProjectStoreSnapshot`.

In `createProject`, set:

```ts
ownerUserId: get().activeOwnerUserId ?? undefined,
```

Do not make localStorage the real permission source. This is only transition metadata until `/api/projects` is live.

- [x] **Step 4: Run tests**

```powershell
npx vitest run client/src/lib/project-store.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [ ] **Step 5: Commit**

```powershell
git add client/src/lib/project-store.ts client/src/lib/project-store.test.ts
git commit -m "feat: add project owner transition metadata"
```

---

## Task 6: Server Project Owner APIs

**Files:**
- Create: `server/routes/projects.ts`
- Create: `server/tests/project-owner-routes.test.ts`
- Modify: `server/persistence/repositories.ts`
- Modify: `server/index.ts`

- [x] **Step 1: Write failing route tests**

Create `server/tests/project-owner-routes.test.ts` covering:

- `GET /api/projects` only returns rows for `req.user.id`.
- `POST /api/projects` writes `owner_user_id` from `req.user.id`, not request body.
- `GET /api/projects/:projectId` returns 404 when repository returns null.
- `PATCH /api/projects/:projectId` uses owner filter.
- `POST /api/projects/:projectId/archive` uses owner filter.

Use fake auth middleware that injects:

```ts
app.use((req, _res, next) => {
  (req as any).user = {
    id: "user-1",
    email: "user@example.com",
    role: "user",
    status: "active",
    emailVerified: true,
  };
  next();
});
```

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/project-owner-routes.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Implement project route**

Create `server/routes/projects.ts` with:

```ts
export function createProjectsRouter(deps: {
  requireAuth: RequestHandler;
  projects: ReturnType<typeof createProjectsRepository>;
}) {
  const router = express.Router();
  router.use(deps.requireAuth);
  router.get("/", ...);
  router.post("/", ...);
  router.get("/:projectId", ...);
  router.patch("/:projectId", ...);
  router.post("/:projectId/archive", ...);
  return router;
}
```

Rules:

- Never accept `ownerUserId` from request body.
- Ordinary not-found or not-owned returns 404.
- Response shape: `{ success: true, project }` or `{ success: true, projects }`.

- [x] **Step 4: Extend repository**

Add:

```ts
async updateForOwner(projectId: string, ownerUserId: string, patch: { name?: string; description?: string | null; status?: ProjectStatus }): Promise<ProjectRecord | null>
```

Use SQL with:

```sql
WHERE id = ? AND owner_user_id = ?
```

- [x] **Step 5: Wire in `server/index.ts` after auth middleware exists**

Mount:

```ts
app.use("/api/projects", createProjectsRouter({
  requireAuth: authMiddleware.requireAuth,
  projects: projectsRepository,
}));
```

- [x] **Step 6: Run tests**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/project-owner-routes.test.ts server/tests/persistence-repositories.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 6a: Add owner-guarded project resource bundle and write APIs**

Implemented `GET /api/projects/:projectId/bundle` plus owner-guarded writes for messages, clarification questions, specs, routes, mission links, artifacts, and evidence. Added the `project_resources` persistence migration and repository so child resources inherit project ownership through the server project lookup instead of trusting request payload ownership fields.

- [x] **Step 6b: Guard project-bound mission creation and return path**

Extended mission projection links and `CreateMissionRequest` to carry `projectId`. `POST /api/tasks` now rejects mismatched top-level/projection project IDs, conditionally restores auth only when a project binding is requested, validates `projects.findByIdForOwner(projectId, currentUser.id)` before `runtime.createTask`, writes only the canonical owned project ID into `task.projection.projectId`, and records a server-side `project_resources` mission link for bundle return paths. The client tasks store now sends `projectId` through to the mission API instead of stripping it.

- [x] **Step 6c: Document single-owner Project-first phase**

Updated the Project ownership design document to state that this phase is a single owner model and does not include project members, invites, sharing links, project roles, team spaces, or collaboration status.

- [ ] **Step 7: Commit**

```powershell
git add server/routes/projects.ts server/tests/project-owner-routes.test.ts server/persistence/repositories.ts server/index.ts
git commit -m "feat: add owner-scoped project api"
```

---

## Task 7: Admin Gate and Read-Only Admin APIs

**Files:**
- Create: `server/routes/admin.ts`
- Create: `server/tests/admin-routes.test.ts`
- Modify: `server/index.ts`

- [x] **Step 1: Write failing admin route tests**

Create `server/tests/admin-routes.test.ts` covering:

- user role `user` receives 403.
- `admin` receives 200 for `/api/admin/summary`.
- `/api/admin/users` returns safe user rows without password hash.
- `/api/admin/projects` uses admin repository method and does not call owner-scoped list.

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/admin-routes.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Implement `server/routes/admin.ts`**

```ts
export function createAdminRouter(deps: {
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  users: AdminUsersReader;
  projects: AdminProjectsReader;
}) {
  const router = express.Router();
  router.use(deps.requireAuth, deps.requireAdmin);
  router.get("/summary", ...);
  router.get("/users", ...);
  router.get("/users/:userId", ...);
  router.get("/projects", ...);
  router.get("/projects/:projectId", ...);
  router.get("/runs", ...);
  router.get("/failures", ...);
  router.get("/audit", ...);
  return router;
}
```

For `runs/failures/audit`, return a safe empty first slice if real repository is not wired yet:

```json
{ "success": true, "items": [] }
```

This satisfies read-only shell without pretending operations exist.

- [x] **Step 4: Wire `/api/admin`**

In `server/index.ts`, mount after auth middleware creation:

```ts
app.use("/api/admin", createAdminRouter({
  requireAuth: authMiddleware.requireAuth,
  requireAdmin: authMiddleware.requireAdmin,
  users: usersRepository,
  projects: projectsRepository,
}));
```

- [x] **Step 5: Run tests**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/admin-routes.test.ts server/tests/auth-session-middleware.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [ ] **Step 6: Commit**

```powershell
git add server/routes/admin.ts server/tests/admin-routes.test.ts server/index.ts
git commit -m "feat: add admin role gate api"
```

---

## Task 8: Admin Frontend Shell

**Files:**
- Create: `client/src/pages/admin/AdminLayout.tsx`
- Create: `client/src/pages/admin/OverviewPage.tsx`
- Create: `client/src/pages/admin/UsersPage.tsx`
- Create: `client/src/pages/admin/ProjectsPage.tsx`
- Create: `client/src/pages/admin/RunsPage.tsx`
- Create: `client/src/pages/admin/FailuresPage.tsx`
- Create: `client/src/pages/admin/AuditPage.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/AppSidebar.tsx`
- Test: `client/src/pages/admin/AdminLayout.test.tsx`

- [x] **Step 1: Write failing shell tests**

Create a test that renders admin route with an admin user and expects the admin nav labels. Render with a non-admin user and expect redirect or denied state.

- [ ] **Step 2: Run and verify red**

```powershell
npx vitest run client/src/pages/admin/AdminLayout.test.tsx --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Implement restrained admin shell**

Design constraints:

- Operational dashboard, not landing page.
- No hero.
- Dense tables and status bands.
- Use existing UI primitives and icons.
- Cards only for repeated metric tiles or list rows; no nested cards.

Admin tabs:

```text
Overview
Users
Projects
Runs
Failures
Audit
```

- [x] **Step 4: Add routes**

In `client/src/App.tsx`:

```tsx
<Route path={"/admin"} component={AdminOverviewPage} />
<Route path={"/admin/users"} component={AdminUsersPage} />
<Route path={"/admin/projects"} component={AdminProjectsPage} />
<Route path={"/admin/runs"} component={AdminRunsPage} />
<Route path={"/admin/failures"} component={AdminFailuresPage} />
<Route path={"/admin/audit"} component={AdminAuditPage} />
```

Each page should check `useAuthStore(state => state.isAdmin())`; non-admin gets a compact denied state.

- [x] **Step 5: Add sidebar entry only for admin**

Modify `AppSidebar` to read `useAuthStore`. Show `Admin` link only when `isAdmin()` is true.

- [x] **Step 6: Run tests**

```powershell
npx vitest run client/src/pages/admin/AdminLayout.test.tsx --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [ ] **Step 7: Commit**

```powershell
git add client/src/pages/admin client/src/App.tsx client/src/components/AppSidebar.tsx
git commit -m "feat: add admin console shell"
```

---

## Task 9: Spec Progress and Architecture Artifacts Update

**Files:**
- Modify: `.kiro/specs/consumer-email-auth-and-account/tasks.md`
- Modify: `.kiro/specs/personal-project-ownership-and-isolation/tasks.md`
- Modify: `.kiro/specs/admin-console-and-global-role-gate/tasks.md`
- Modify: `docs/toc-auth-project-admin-spec-progress-overview-2026-04-30.svg`
- Optionally modify: `docs/whybuddy-toc-login-architecture-2026-04-30.svg`

- [x] **Step 1: Update checkboxes**

Mark only completed items. Do not mark UI or API tasks done just because placeholders exist.

- [x] **Step 2: Update SVG counts**

Expected after Tasks 1-8 if all completed:

- Wave 0: `15 / 15`
- Auth: likely `10 / 14` or higher depending old local project migration and web-main audit item.
- Project isolation: likely `6-10 / 15` depending bundle/write endpoints.
- Admin gate: likely `10-14 / 15` depending tests and docs.

- [x] **Step 3: Validate SVG XML**

```powershell
$path = Resolve-Path 'docs\toc-auth-project-admin-spec-progress-overview-2026-04-30.svg'
$xml = New-Object System.Xml.XmlDocument
$xml.PreserveWhitespace = $true
$xml.Load($path)
Write-Output "XML_OK docs\toc-auth-project-admin-spec-progress-overview-2026-04-30.svg"
```

- [ ] **Step 4: Commit**

```powershell
git add .kiro/specs/consumer-email-auth-and-account/tasks.md .kiro/specs/personal-project-ownership-and-isolation/tasks.md .kiro/specs/admin-console-and-global-role-gate/tasks.md docs/toc-auth-project-admin-spec-progress-overview-2026-04-30.svg docs/whybuddy-toc-login-architecture-2026-04-30.svg
git commit -m "docs: update toc auth progress"
```

---

## Task 10: Final Verification and Delivery Commit

**Files:**
- No required code files unless verification exposes issues.

- [x] **Step 1: Run targeted server suites**

```powershell
npx vitest run --config vitest.config.server.ts server/tests/auth-contract.test.ts server/tests/auth-session-middleware.test.ts server/tests/auth-routes.test.ts server/tests/project-owner-routes.test.ts server/tests/admin-routes.test.ts server/tests/persistence-config.test.ts server/tests/migration-runner.test.ts server/tests/persistence-health-routes.test.ts server/tests/persistence-repositories.test.ts --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 2: Run targeted client suites**

```powershell
npx vitest run client/src/lib/auth-store.test.ts client/src/lib/project-store.test.ts client/src/pages/admin/AdminLayout.test.tsx --pool=forks --poolOptions.forks.singleFork --no-file-parallelism
```

- [x] **Step 3: Run persistence smoke**

```powershell
npx tsx scripts/persistence-smoke.mjs
```

Expected:

```text
MYSQL_OK database=whybuddy applied=0 skippedSecond=1
REDIS_OK db=2 prefix=cube:pets:office:
```

Actual after adding `002_project_resources`:

```text
MYSQL_OK database=whybuddy applied=1 skippedSecond=2
REDIS_OK db=2 prefix=cube:pets:office:
```

- [x] **Step 4: Run secret scan**

```powershell
rg -n "real_password_here|real_api_key_here|real_test_host_here|sk-[A-Za-z0-9_-]{12,}" .env.example .kiro\specs docs server client shared scripts
```

Expected: no matches for real test secrets. Existing generic credential-pattern docs may be reviewed manually if they appear.

Actual: the broad `sk-...` expression also matches ordinary `task-...` slugs. A boundary-refined rescan only matched this documented command line and no real secret tokens.

- [x] **Step 5: Run diff whitespace check**

```powershell
git diff --check
```

Expected: no whitespace errors. CRLF warnings are acceptable on this Windows checkout.

- [ ] **Step 6: Commit any final fixes**

```powershell
git status --short
git add <only task-related files>
git commit -m "feat: complete toc auth project admin mvp slice"
```

---

## Recommended Parallel Plan

### Batch A: Contract and Auth Foundation

Run Tasks 1-3 sequentially. Do not parallelize.

Reason: Project and Admin need `CurrentUser`, cookie semantics, `requireAuth`, and route response shape.

### Batch B: Parallel After Auth Middleware

After Task 3:

- Worker 1: Task 4 Frontend Auth Store and Login Page.
- Worker 2: Task 5 Project Owner Type and Local Migration Boundary.
- Worker 3: Task 6 Server Project Owner APIs.
- Worker 4: Task 7 Admin Gate and Read-Only Admin APIs.

Avoid two workers editing `server/index.ts` at the same time. If split across workers, leave route mounting to the coordinator.

### Batch C: Admin UI and Progress

After Task 7:

- Task 8 Admin Frontend Shell.
- Task 9 Spec Progress and Architecture Artifacts Update.

### Batch D: Verification

Task 10 in the coordinator session only.

---

## Acceptance Criteria

- A user can register/login with email and password.
- Browser receives an httpOnly session cookie; API responses never expose token plaintext or token hash.
- `GET /api/auth/me` restores current user from DB-backed session.
- Logout writes `sessions.revoked_at` and clears the cookie.
- Disabled users cannot access protected APIs.
- Ordinary project APIs only return `owner_user_id = currentUser.id`.
- Ordinary users receive 404 for projects they do not own.
- Admin APIs live under `/api/admin/*` and require `admin` or `super_admin`.
- Admin UI entry is hidden from ordinary users.
- Redis outage does not block auth/project access when MySQL is healthy.
- `data/database.json` and localStorage remain explicitly legacy/demo/transition only.

## Known Risks

- Full `npx tsc --noEmit` currently has unrelated repo-wide type debt. Use targeted typecheck for touched server files and targeted Vitest suites until those debts are cleaned.
- Plain Vitest can hit `spawn EPERM` on this Windows checkout. Prefer `--pool=forks --poolOptions.forks.singleFork --no-file-parallelism`.
- `.env` contains real local test credentials and must remain untracked.
- `docs/project-first-9-spec-architecture-2026-04-30.svg` is currently untracked from prior work; do not accidentally include it unless deliberately requested.
