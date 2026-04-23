import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { executeExcelReadNode } from "../routes/node-adapters/excel-read-node-adapter.js";

function createWorkbookBase64(): string {
  const workbook = XLSX.utils.book_new();
  const salesSheet = XLSX.utils.aoa_to_sheet([
    ["Month", "Revenue", "Orders", "Region"],
    ["Jan", 120, 12, "East"],
    ["Feb", 180, 18, "East"],
    ["Mar", 210, 20, "West"],
  ]);
  const stagedSheet = XLSX.utils.aoa_to_sheet([
    ["Report", "Q1"],
    ["Category", "Value"],
    ["Pets", 42],
    ["Office", 17],
  ]);

  XLSX.utils.book_append_sheet(workbook, salesSheet, "Sales");
  XLSX.utils.book_append_sheet(workbook, stagedSheet, "Summary");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

describe("executeExcelReadNode", () => {
  it("reads selected worksheet and emits dynamic_chart compatible rows", async () => {
    const result = await executeExcelReadNode({
      nodeType: "excel_read",
      input: {
        workbookBase64: createWorkbookBase64(),
        fileName: "sales.xlsx",
        sheetName: "Sales",
        range: "A1:D4",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.workbook.totalSheets).toBe(2);
    expect(result.output.selection.sheetName).toBe("Sales");
    expect(result.output.columns.map(column => column.header)).toEqual([
      "Month",
      "Revenue",
      "Orders",
      "Region",
    ]);
    expect(result.output.rows).toHaveLength(3);
    expect(result.output.rows[0]).toEqual({
      Month: "Jan",
      Revenue: 120,
      Orders: 12,
      Region: "East",
    });
    expect(result.output.validation.numericFields).toEqual(["Revenue", "Orders"]);
    expect(result.output.dynamicChart.compatible).toBe(true);
    expect(result.output.dynamicChart.categoriesField).toBe("Month");
    expect(result.output.dynamicChart.seriesFields).toEqual(["Revenue", "Orders"]);
    expect(result.output.observability).toEqual({
      eventKey: "content.excel_read",
      nodeType: "excel_read",
      sheetName: "Sales",
      rowCount: 3,
      columnCount: 4,
      dynamicChartReady: true,
    });
  });

  it("supports headerRow and sheetIndex based reading", async () => {
    const result = await executeExcelReadNode({
      nodeType: "excel_read",
      input: {
        workbookBase64: createWorkbookBase64(),
        sheetIndex: 2,
        headerRow: 2,
        dataStartRow: 3,
      },
    });

    expect(result.output.selection.sheetIndex).toBe(1);
    expect(result.output.selection.sheetName).toBe("Summary");
    expect(result.output.columns.map(column => column.header)).toEqual([
      "Category",
      "Value",
    ]);
    expect(result.output.rows).toEqual([
      {
        Category: "Pets",
        Value: 42,
      },
      {
        Category: "Office",
        Value: 17,
      },
    ]);
    expect(result.output.dynamicChart.compatible).toBe(true);
    expect(result.output.dynamicChart.categoriesField).toBe("Category");
    expect(result.output.observability).toEqual({
      eventKey: "content.excel_read",
      nodeType: "excel_read",
      sheetName: "Summary",
      rowCount: 2,
      columnCount: 2,
      dynamicChartReady: true,
    });
  });

  it("fails when workbookBase64 is missing", async () => {
    await expect(
      executeExcelReadNode({
        nodeType: "excel_read",
        input: {},
      }),
    ).rejects.toThrow(/requires workbookBase64/i);
  });
});
