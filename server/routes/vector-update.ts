import { Router } from "express";

import { VectorUpdateAdapter } from "../web-aigc/vector-update-adapter.js";

export interface VectorUpdateRouterDeps {
  vectorUpdateAdapter: Pick<VectorUpdateAdapter, "execute">;
}

function mapStatusToHttpStatus(status: string | undefined): number {
  switch (status) {
    case "completed":
      return 200;
    case "denied":
      return 403;
    case "approval_required":
      return 403;
    case "unavailable":
      return 503;
    case "failed":
      return 500;
    default:
      return 500;
  }
}

function isValidSelection(selection: unknown): boolean {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return false;
  }

  const candidate = selection as Record<string, unknown>;
  const hasSourceId =
    typeof candidate.sourceId === "string" && candidate.sourceId.trim().length > 0;
  const hasIds =
    Array.isArray(candidate.ids) &&
    candidate.ids.some((entry) => typeof entry === "string" && entry.trim().length > 0);

  return hasSourceId || hasIds;
}

export function createVectorUpdateRouter(
  deps: VectorUpdateRouterDeps,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const body = req.body ?? {};

    if (
      typeof body.agentId !== "string" ||
      typeof body.token !== "string" ||
      typeof body.namespace !== "string" ||
      typeof body.projectId !== "string" ||
      !isValidSelection(body.selection) ||
      !body.metadataPatch ||
      typeof body.metadataPatch !== "object" ||
      Array.isArray(body.metadataPatch)
    ) {
      return res.status(400).json({
        error:
          "agentId, token, namespace, projectId, selection, and metadataPatch are required",
      });
    }

    try {
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

      return res.status(mapStatusToHttpStatus(result.status)).json(result);
    } catch (error: any) {
      const message = error?.message || "Vector update failed";
      const status =
        /namespace/i.test(message) ||
        /collection/i.test(message) ||
        /selection must provide/i.test(message)
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
