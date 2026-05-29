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
