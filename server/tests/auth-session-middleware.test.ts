import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createAuthMiddleware } from "../auth/middleware.js";
import type { SessionLookupResult, SessionService } from "../auth/session-service.js";

const originalSoloTraeBypassAuth = process.env.SOLO_TRAE_BYPASS_AUTH;

async function withServer(
  service: Pick<SessionService, "readSessionToken" | "resolveCurrentUser" | "clearCookie">,
  handler: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  const auth = createAuthMiddleware(service as SessionService);

  app.get("/required", auth.requireAuth, (request, response) => {
    response.json({ user: (request as any).user });
  });
  app.get("/optional", auth.optionalAuth, (request, response) => {
    response.json({ user: (request as any).user ?? null });
  });
  app.get("/admin", auth.requireAuth, auth.requireAdmin, (_request, response) => {
    response.json({ ok: true });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });

  const address = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function service(
  result: SessionLookupResult | null,
): Pick<SessionService, "readSessionToken" | "resolveCurrentUser" | "clearCookie"> {
  return {
    readSessionToken: () => "token",
    resolveCurrentUser: async () => result,
    clearCookie: (_response) => undefined,
  };
}

describe("auth middleware", () => {
  afterEach(() => {
    if (originalSoloTraeBypassAuth === undefined) {
      delete process.env.SOLO_TRAE_BYPASS_AUTH;
      return;
    }
    process.env.SOLO_TRAE_BYPASS_AUTH = originalSoloTraeBypassAuth;
  });

  it("returns 401 when a required session is missing", async () => {
    await withServer(service(null), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/required`);
      expect(response.status).toBe(401);
    });
  });

  it("injects active user for required auth", async () => {
    await withServer(
      service({
        sessionId: "session-1",
        user: {
          id: "user-1",
          email: "user@example.com",
          role: "user",
          status: "active",
          emailVerified: true,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/required`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.user.id).toBe("user-1");
      },
    );
  });

  it("keeps optional auth public when no session is present", async () => {
    await withServer(service(null), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/optional`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ user: null });
    });
  });

  it("returns 403 for non-admin users on admin routes", async () => {
    await withServer(
      service({
        sessionId: "session-1",
        user: {
          id: "user-1",
          email: "user@example.com",
          role: "user",
          status: "active",
          emailVerified: true,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/admin`);
        expect(response.status).toBe(403);
      },
    );
  });

  it("bypasses required auth in Solo Trae sandbox mode", async () => {
    process.env.SOLO_TRAE_BYPASS_AUTH = "true";

    await withServer(service(null), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/required`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        user: {
          id: "solo-trae-sandbox",
          role: "super_admin",
        },
      });
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
});
