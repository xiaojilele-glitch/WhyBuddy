import { Router } from "express";

import {
  executeExcelReadNode,
  isExcelReadNodeType,
} from "./node-adapters/excel-read-node-adapter.js";

export function createExcelReadRouter(): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isExcelReadNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be excel_read" });
    }

    try {
      const result = await executeExcelReadNode({
        nodeType,
        input: req.body?.input,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      const message = error?.message || "Excel read node execution failed.";
      const status =
        /requires workbookBase64|worksheet|range|numeric options/i.test(message)
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createExcelReadRouter();

export default router;
