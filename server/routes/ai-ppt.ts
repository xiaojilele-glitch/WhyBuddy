import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { Router } from "express";

import { getMimeType } from "./artifact-utils.js";
import {
  AiPptNodeError,
  executeAiPptNode,
  isAiPptNodeType,
  resolveAiPptOutputAbsolutePath,
  type AiPptNodeAdapterDeps,
} from "./node-adapters/ai-ppt-node-adapter.js";
import { validateWebAigcAiPptOutputSegment } from "../../shared/web-aigc-ai-ppt.js";

export interface AiPptRouterDeps extends AiPptNodeAdapterDeps {}

export function createAiPptRouter(deps: AiPptRouterDeps = {}): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isAiPptNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be ai_ppt" });
    }

    try {
      const result = await executeAiPptNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof AiPptNodeError) {
        return res.status(error.status).json({ error: error.message });
      }

      return res.status(500).json({
        error:
          error instanceof Error ? error.message : "AI PPT node execution failed.",
      });
    }
  });

  router.get("/outputs/:outputId/:filename", async (req, res) => {
    const { outputId, filename } = req.params;

    if (
      !validateWebAigcAiPptOutputSegment(outputId) ||
      !validateWebAigcAiPptOutputSegment(filename)
    ) {
      return res.status(403).json({ error: "Invalid output path" });
    }

    const absolutePath = resolveAiPptOutputAbsolutePath(outputId, filename);

    try {
      await access(absolutePath, fsConstants.R_OK);
    } catch {
      return res.status(404).json({ error: "Output artifact not found" });
    }

    res.setHeader("Content-Type", getMimeType(filename));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.sendFile(absolutePath);
  });

  return router;
}

const router = createAiPptRouter();

export default router;
