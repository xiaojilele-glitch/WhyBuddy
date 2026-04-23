import { Router } from "express";

import type { VectorInsertActionInput } from "../../shared/web-aigc-risk-actions.js";
import type { VectorInsertAdapter } from "../web-aigc/vector-insert-adapter.js";
import type { VectorDeleteAdapter } from "../web-aigc/vector-delete-adapter.js";
import type { VectorUpdateAdapter } from "../web-aigc/vector-update-adapter.js";
import type { VectorDeleteActionInput } from "../../shared/web-aigc-vector-delete.js";
import type { VectorUpdateActionInput } from "../../shared/web-aigc-vector-update.js";

export interface WebAigcRiskActionRouterDeps {
  vectorInsertAdapter: VectorInsertAdapter;
  vectorDeleteAdapter?: Pick<VectorDeleteAdapter, "execute">;
  vectorUpdateAdapter?: Pick<VectorUpdateAdapter, "execute">;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function createWebAigcRiskActionRouter(
  deps: WebAigcRiskActionRouterDeps,
): Router {
  const router = Router();

  router.post("/vector-insert", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<VectorInsertActionInput>;
      if (!body.agentId || !body.token || !body.namespace || !body.payload) {
        return res.status(400).json({
          ok: false,
          error: "agentId, token, namespace, and payload are required",
        });
      }

      const payload = body.payload;
      if (
        !payload.sourceType ||
        !payload.sourceId ||
        !payload.projectId ||
        !payload.content ||
        !payload.timestamp
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "payload.sourceType, sourceId, projectId, content, and timestamp are required",
        });
      }

      const result = await deps.vectorInsertAdapter.execute({
        agentId: body.agentId,
        token: body.token,
        namespace: body.namespace,
        collection: body.collection,
        payload,
        requireApproval: body.requireApproval,
        metadata: body.metadata,
      });

      const statusCode =
        result.status === "denied"
          ? 403
          : result.status === "approval_required"
            ? 409
            : result.status === "failed"
              ? 500
              : result.status === "unavailable"
                ? 503
              : 200;

      return res.status(statusCode).json(result);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: errorMessage(error),
      });
    }
  });

  router.post("/vector-update", async (req, res) => {
    try {
      if (!deps.vectorUpdateAdapter) {
        return res.status(503).json({
          ok: false,
          error: "vector update adapter is unavailable",
        });
      }

      const body = (req.body ?? {}) as Partial<VectorUpdateActionInput>;
      const hasSelection =
        body.selection &&
        typeof body.selection === "object" &&
        !Array.isArray(body.selection) &&
        ((Array.isArray((body.selection as { ids?: unknown }).ids) &&
          (body.selection as { ids?: unknown[] }).ids!.length > 0) ||
          (typeof (body.selection as { sourceId?: unknown }).sourceId === "string" &&
            (body.selection as { sourceId?: string }).sourceId!.trim().length > 0));

      if (
        !body.agentId ||
        !body.token ||
        !body.namespace ||
        !body.projectId ||
        !hasSelection ||
        !body.metadataPatch ||
        typeof body.metadataPatch !== "object" ||
        Array.isArray(body.metadataPatch)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "agentId, token, namespace, projectId, selection, and metadataPatch are required",
        });
      }

      const result = await deps.vectorUpdateAdapter.execute({
        agentId: body.agentId,
        token: body.token,
        namespace: body.namespace,
        collection: body.collection,
        projectId: body.projectId,
        sourceType: body.sourceType,
        selection: body.selection,
        metadataPatch: body.metadataPatch,
        requireApproval: body.requireApproval,
        reason: body.reason,
        context:
          body.context && typeof body.context === "object" && !Array.isArray(body.context)
            ? body.context
            : undefined,
      });

      const statusCode =
        result.status === "denied" || result.status === "approval_required"
          ? 403
          : result.status === "unavailable"
            ? 503
            : result.status === "failed"
              ? 500
              : 200;

      return res.status(statusCode).json(result);
    } catch (error) {
      const message = errorMessage(error);
      const statusCode =
        /namespace|collection|selection/i.test(message)
          ? 400
          : 500;

      return res.status(statusCode).json({
        ok: false,
        error: message,
      });
    }
  });

  router.post("/vector-delete", async (req, res) => {
    try {
      if (!deps.vectorDeleteAdapter) {
        return res.status(503).json({
          ok: false,
          error: "vector delete adapter is unavailable",
        });
      }

      const body = (req.body ?? {}) as Partial<VectorDeleteActionInput>;
      if (!body.agentId || !body.token || !body.namespace || !body.target || !body.confirmation) {
        return res.status(400).json({
          ok: false,
          error: "agentId, token, namespace, target, and confirmation are required",
        });
      }

      if (
        (!Array.isArray(body.target.ids) || body.target.ids.length === 0) &&
        !body.target.sourceId
      ) {
        return res.status(400).json({
          ok: false,
          error: "target.ids or target.sourceId is required",
        });
      }

      const result = await deps.vectorDeleteAdapter.execute({
        agentId: body.agentId,
        token: body.token,
        namespace: body.namespace,
        collection: body.collection,
        target: body.target,
        confirmation: body.confirmation,
        requireApproval: body.requireApproval,
        metadata: body.metadata,
      });

      const statusCode =
        result.status === "denied"
          ? 403
          : result.status === "approval_required"
            ? 409
            : result.status === "unavailable"
              ? 503
              : result.status === "failed"
                ? 500
                : 200;

      return res.status(statusCode).json(result);
    } catch (error) {
      const message = errorMessage(error);
      const statusCode =
        /confirmation|target\.ids or target\.sourceId is required|namespace|collection/i.test(
          message,
        )
          ? 400
          : 500;

      return res.status(statusCode).json({
        ok: false,
        error: message,
      });
    }
  });

  return router;
}
