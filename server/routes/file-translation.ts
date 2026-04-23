import { Router } from "express";

import { validateWebAigcFileTranslationOutputSegment } from "../../shared/web-aigc-file-translation.js";
import {
  FileTranslationNodeError,
  executeFileTranslationNode,
  getFileTranslationOutput,
  isFileTranslationNodeType,
  type FileTranslationNodeAdapterDeps,
} from "./node-adapters/file-translation-node-adapter.js";

export interface FileTranslationRouterDeps
  extends FileTranslationNodeAdapterDeps {}

export function createFileTranslationRouter(
  deps: FileTranslationRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isFileTranslationNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be file_translation" });
    }

    try {
      const result = await executeFileTranslationNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof FileTranslationNodeError) {
        return res.status(error.status).json({ error: error.message });
      }

      const message =
        error instanceof Error
          ? error.message
          : "File translation node execution failed.";
      const status =
        /requires file\.content, document\.text, or content|maxchars|maxsegments/i.test(
          message,
        )
          ? 400
          : 500;

      return res.status(status).json({ error: message });
    }
  });

  router.get("/outputs/:outputId/:filename", async (req, res) => {
    const { outputId, filename } = req.params;

    if (
      !validateWebAigcFileTranslationOutputSegment(outputId) ||
      !validateWebAigcFileTranslationOutputSegment(filename)
    ) {
      return res.status(403).json({ error: "Invalid output path" });
    }

    const output = getFileTranslationOutput(outputId, filename);
    if (!output) {
      return res.status(404).json({ error: "Output artifact not found" });
    }

    res.setHeader("Content-Type", output.mediaType);
    res.setHeader("Content-Length", String(output.sizeBytes));
    if (req.query.download === "1") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${output.filename}"`,
      );
    }

    return res.status(200).send(output.content);
  });

  return router;
}

const router = createFileTranslationRouter();

export default router;
