import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "../../shared/auth.js";
import { createAdminRouter, type AdminRouterDeps } from "../routes/admin.js";

type UserFixture = Awaited<ReturnType<AdminRouterDeps["users"]["list"]>>[number];
type ProjectFixture = Awaited<ReturnType<AdminRouterDeps["projects"]["list"]>>[number];

const now = new Date("2026-05-02T00:00:00.000Z");

const adminUser: CurrentUser = {
  id: "admin-1",
  email: "admin@example.com",
  role: "admin",
  status: "active",
  emailVerified: true,
  createdAt: now.toISOString(),
};

const regularUser: CurrentUser = {
  ...adminUser,
  id: "user-1",
  email: "user@example.com",
  role: "user",
};

// 用户来自新身份体系（Python 的 `User.public()`）——那一层根本不返回密码哈希，
// 所以这里的 fixture 也没有可泄漏的字段。下面仍然断言"响应里不出现 passwordHash"，
// 因为它防的是"以后有人把整行记录透传出去"这类回归，不是防当下这份 fixture。
const users: UserFixture[] = [
  {
    id: "user-1",
    email: "user@example.com",
    displayName: "User One",
    isSuperuser: false,
    isVerified: true,
    isActive: true,
    createdAt: now.toISOString(),
    lastLoginAt: null,
    sessions: 0,
    estimatedTokens: 0,
    estimatedCostUsd: 0,
  },
  {
    id: "admin-1",
    email: "admin@example.com",
    displayName: "Admin One",
    isSuperuser: true,
    isVerified: true,
    isActive: true,
    createdAt: now.toISOString(),
    lastLoginAt: null,
    sessions: 0,
    estimatedTokens: 0,
    estimatedCostUsd: 0,
  },
];

const projects: ProjectFixture[] = [
  {
    id: "project-owned-by-other-user",
    ownerUserId: "user-2",
    name: "Other User Project",
    description: null,
    status: "active",
    source: "user",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  {
    id: "project-owned-by-admin",
    ownerUserId: "admin-1",
    name: "Admin Project",
    description: "Visible through admin reader",
    status: "active",
    source: "demo",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
];

function createDeps(currentUser: CurrentUser): AdminRouterDeps {
  const requireAuth: RequestHandler = (request, _response, next) => {
    (request as typeof request & { user: CurrentUser; sessionId: string }).user = currentUser;
    (request as typeof request & { user: CurrentUser; sessionId: string }).sessionId = "session-1";
    next();
  };

  const requireAdmin: RequestHandler = (request, response, next) => {
    const user = (request as typeof request & { user?: CurrentUser }).user;
    if (user?.role !== "admin" && user?.role !== "super_admin") {
      response.status(403).json({ success: false, error: "Admin privileges required" });
      return;
    }
    next();
  };

  return {
    requireAuth,
    requireAdmin,
    users: {
      list: vi.fn(async () => users),
      findById: vi.fn(
        async (userId: string) => users.find(user => user.id === userId) ?? null,
      ),
      setActive: vi.fn(async (userId: string, isActive: boolean) => {
        const user = users.find(entry => entry.id === userId);
        if (!user) return null;
        return { ...user, isActive };
      }),
    },
    projects: {
      list: vi.fn(async () => projects),
      findById: vi.fn(async projectId => projects.find(project => project.id === projectId) ?? null),
    },
  };
}

async function withServer(
  deps: AdminRouterDeps,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter(deps));

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
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("admin routes", () => {
  it("returns 403 for regular users", async () => {
    const deps = createDeps(regularUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/summary`);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        error: "Admin privileges required",
      });
      expect(deps.users.list).not.toHaveBeenCalled();
      expect(deps.projects.list).not.toHaveBeenCalled();
    });
  });

  it("returns summary for admins", async () => {
    await withServer(createDeps(adminUser), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/summary`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        summary: {
          users: 2,
          projects: 2,
          runs: 0,
          failures: 0,
          audit: 0,
        },
      });
    });
  });

  it("does not expose password hashes in user responses", async () => {
    await withServer(createDeps(adminUser), async baseUrl => {
      const listResponse = await fetch(`${baseUrl}/api/admin/users`);
      const listBody = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(JSON.stringify(listBody)).not.toContain("passwordHash");
      expect(JSON.stringify(listBody)).not.toContain("password");
      expect(listBody.items).toHaveLength(2);

      const detailResponse = await fetch(`${baseUrl}/api/admin/users/user-1`);
      const detailBody = await detailResponse.json();

      expect(detailResponse.status).toBe(200);
      expect(JSON.stringify(detailBody)).not.toContain("passwordHash");
      expect(JSON.stringify(detailBody)).not.toContain("password");
      expect(detailBody.user.id).toBe("user-1");
    });
  });

  it("uses the admin projects reader instead of an owner-scoped list", async () => {
    const deps = createDeps(adminUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/projects`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(deps.projects.list).toHaveBeenCalledOnce();
      expect(body.items.map((project: ProjectFixture) => project.id)).toEqual([
        "project-owned-by-other-user",
        "project-owned-by-admin",
      ]);
    });
  });

  it("forwards search q to the users reader", async () => {
    const deps = createDeps(adminUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/users?q=alice`);
      expect(response.status).toBe(200);
      expect(deps.users.list).toHaveBeenCalledWith(expect.anything(), "alice");
    });
  });

  it("patches isActive through the users reader", async () => {
    const deps = createDeps(adminUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/users/user-1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(deps.users.setActive).toHaveBeenCalledWith(
        "user-1",
        false,
        expect.anything(),
      );
      expect(body.user.isActive).toBe(false);
    });
  });
});
