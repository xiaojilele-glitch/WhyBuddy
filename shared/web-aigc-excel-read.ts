export const WEB_AIGC_EXCEL_READ_API = {
  EXECUTE: "POST /api/excel-read/nodes/execute",
} as const;

export const WEB_AIGC_EXCEL_READ_NODE_TYPES = ["excel_read"] as const;

export type ExcelReadNodeType =
  (typeof WEB_AIGC_EXCEL_READ_NODE_TYPES)[number];

export type ExcelReadCellValue = string | number | boolean | null;

export type ExcelReadColumnType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "mixed"
  | "empty";

export interface ExcelReadNodeInput {
  workbookBase64?: string;
  fileName?: string;
  sheetName?: string;
  sheetIndex?: number;
  range?: string;
  headerRow?: number;
  dataStartRow?: number;
  useHeaderRow?: boolean;
  maxRows?: number;
  context?: Record<string, unknown>;
}

export interface ExcelReadNodeExecutionRequest {
  nodeType: ExcelReadNodeType;
  input?: ExcelReadNodeInput;
}

export interface ExcelReadColumnDefinition {
  key: string;
  header: string;
  columnIndex: number;
  columnLetter: string;
  inferredType: ExcelReadColumnType;
}

export interface ExcelReadValidationSummary {
  rowCount: number;
  columnCount: number;
  rectangular: boolean;
  issues: string[];
  numericFields: string[];
  dimensionFields: string[];
  dynamicChartReady: boolean;
}

export interface ExcelReadDynamicChartPayload {
  compatible: boolean;
  categoriesField?: string;
  seriesFields: string[];
  rows: Array<Record<string, ExcelReadCellValue>>;
  columns: string[];
  suggestedChartType: "bar" | "line" | "table";
  usesSyntheticCategory: boolean;
}

export interface ExcelReadNodeExecutionResult {
  ok: true;
  nodeType: ExcelReadNodeType;
  output: {
    status: "completed";
    workbook: {
      fileName?: string;
      totalSheets: number;
      sheetNames: string[];
    };
    selection: {
      sheetName: string;
      sheetIndex: number;
      requestedRange?: string;
      resolvedRange: string;
      headerRow: number | null;
      dataStartRow: number;
      maxRowsApplied: number | null;
    };
    columns: ExcelReadColumnDefinition[];
    rows: Array<Record<string, ExcelReadCellValue>>;
    matrix: ExcelReadCellValue[][];
    validation: ExcelReadValidationSummary;
    dynamicChart: ExcelReadDynamicChartPayload;
    warnings: string[];
    context: Record<string, unknown>;
    observability: {
      eventKey: "content.excel_read";
      nodeType: ExcelReadNodeType;
      sheetName: string;
      rowCount: number;
      columnCount: number;
      dynamicChartReady: boolean;
    };
  };
}
