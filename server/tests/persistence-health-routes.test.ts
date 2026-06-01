import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import {
  checkMysqlHealth,
  checkRedisHealth,
  createPersistenceHealthRouter,
  type PersistenceHealthSnapshot,
} from "../routes/persistence-health.js";

async function withHealthServer(
  snapshot: PersistenceHealthSnapshot,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(
    "/api/health/persistence",
    createPersistenceHealthRouter({
      checkHealth: async () => snapshot,
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
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("persistence health route", () => {
  it("returns healthy when MySQL is healthy and Redis is disabled", async () => {
    await withHealthServer(
      {
        status: "healthy",
        mysql: { status: "healthy", required: true, latencyMs: 3 },
        redis: { status: "disabled", enabled: false, required: false },
        checkedAt: "2026-04-30T00:00:00.000Z",
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/persistence`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe("healthy");
        expect(body.redis.status).toBe("disabled");
      },
    );
  });

  it("returns 503 when MySQL is unavailable", async () => {
    await withHealthServer(
      {
        status: "unhealthy",
        mysql: { status: "unhealthy", required: true, error: "connect failed" },
        redis: { status: "disabled", enabled: false, required: false },
        checkedAt: "2026-04-30T00:00:00.000Z",
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/persistence`);
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.status).toBe("unhealthy");
        expect(body.mysql.error).toContain("connect failed");
      },
    );
  });

  it("keeps the route available when optional Redis is degraded", async () => {
    await withHealthServer(
      {
        status: "degraded",
        mysql: { status: "healthy", required: true, latencyMs: 2 },
        redis: {
          status: "degraded",
          enabled: true,
          required: false,
          keyPrefix: "cube:pets:office:",
          error: "redis timeout",
        },
        checkedAt: "2026-04-30T00:00:00.000Z",
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health/persistence`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe("degraded");
        expect(body.redis.required).toBe(false);
      },
    );
  });
});

describe("persistence health checks", () => {
  it("marks MySQL unhealthy when the ping query fails", async () => {
    const health = await checkMysqlHealth(
      {
        provider: "mysql",
        mysql: {
          host: "db.local",
          port: 3306,
          database: "whybuddy",
          user: "cube_user",
          password: "secret",
          pool: {
            connectionLimit: 10,
            waitForConnections: true,
            queueLimit: 0,
            connectTimeoutMs: 1000,
          },
        },
      },
      {
        query: async () => {
          throw new Error("database offline");
        },
      },
    );

    expect(health.status).toBe("unhealthy");
    expect(health.required).toBe(true);
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("treats disabled Redis as an accepted MySQL-only mode", async () => {
    const health = await checkRedisHealth({
      enabled: false,
      host: "redis.local",
      port: 6379,
      password: "redis-secret",
      db: 2,
      keyPrefix: "cube:pets:office:",
      connectTimeoutMs: 1000,
    });

    expect(health.status).toBe("disabled");
    expect(health.required).toBe(false);
    expect(JSON.stringify(health)).not.toContain("redis-secret");
  });
});
