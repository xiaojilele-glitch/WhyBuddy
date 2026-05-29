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
    const body = (request.body ?? {}) as SkillEchoRequestBody;
    const message = parseMessage(body);

    if (typeof body.message === "undefined") {
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
