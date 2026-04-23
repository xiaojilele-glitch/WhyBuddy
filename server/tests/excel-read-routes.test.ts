import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { createExcelReadRouter } from "../routes/excel-read.js";

function createWorkbookBase64(): string {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Label", "Value"],
    ["Alpha", 10],
    ["Beta", 15],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Metrics");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/excel-read", createExcelReadRouter());
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

describe("POST /api/excel-read/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/excel-read/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "file_read",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType must be excel_read");
    });
  });

  it("returns structured rows with dynamic_chart payload", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/excel-read/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "excel_read",
          input: {
            workbookBase64: createWorkbookBase64(),
            sheetName: "Metrics",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.rows).toHaveLength(2);
      expect(body.output.dynamicChart.compatible).toBe(true);
      expect(body.output.dynamicChart.categoriesField).toBe("Label");
      expect(body.output.dynamicChart.seriesFields).toEqual(["Value"]);
    });
  });

  it("returns 400 when workbookBase64 is missing", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/excel-read/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "excel_read",
          input: {
            sheetName: "Metrics",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("requires workbookBase64");
    });
  });
});
