import { Router } from "express";

import type { VectorDeleteActionInput } from "../../shared/web-aigc-vector-delete.js";
import type { VectorDeleteAdapter } from "../web-aigc/vector-delete-adapter.js";

export interface VectorDeleteRouterDeps {
  vectorDeleteAdapter: VectorDeleteAdapter;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function createVectorDeleteRouter(
  deps: VectorDeleteRouterDeps,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
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
            : result.status === "failed"
              ? 500
              : result.status === "unavailable"
                ? 503
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

const router = createVectorDeleteRouter({
  vectorDeleteAdapter: null as unknown as VectorDeleteAdapter,
});

export default router;
