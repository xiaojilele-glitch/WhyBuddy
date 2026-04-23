import { Router } from "express";

import {
  OcrRecognitionNodeError,
  executeOcrRecognitionNode,
  isOcrRecognitionNodeType,
  type OcrRecognitionNodeAdapterDeps,
} from "./node-adapters/ocr-recognition-node-adapter.js";

export interface OcrRecognitionRouterDeps
  extends OcrRecognitionNodeAdapterDeps {}

export function createOcrRecognitionRouter(
  deps: OcrRecognitionRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isOcrRecognitionNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be ocr_recognition" });
    }

    try {
      const result = await executeOcrRecognitionNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof OcrRecognitionNodeError) {
        return res.status(error.status).json({ error: error.message });
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "OCR recognition node execution failed.",
      });
    }
  });

  return router;
}

const router = createOcrRecognitionRouter();

export default router;
