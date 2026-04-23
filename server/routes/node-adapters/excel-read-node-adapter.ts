import * as XLSX from "xlsx";

import type {
  ExcelReadCellValue,
  ExcelReadColumnDefinition,
  ExcelReadColumnType,
  ExcelReadDynamicChartPayload,
  ExcelReadNodeExecutionRequest,
  ExcelReadNodeExecutionResult,
  ExcelReadNodeInput,
  ExcelReadNodeType,
  ExcelReadValidationSummary,
} from "../../../shared/web-aigc-excel-read.js";

type RawCellValue = string | number | boolean | Date | null | undefined;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number | undefined,
  min = 1,
  max = 10000,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error("Excel read numeric options must be valid numbers.");
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function stripBase64Prefix(value: string): string {
  const normalized = value.trim();
  const marker = "base64,";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized;
}

function toCellValue(value: RawCellValue): ExcelReadCellValue {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return String(value);
}

function inferColumnType(values: RawCellValue[]): ExcelReadColumnType {
  const nonEmpty = values.filter(
    (value): value is Exclude<RawCellValue, null | undefined | ""> =>
      value !== null && value !== undefined && value !== "",
  );

  if (nonEmpty.length === 0) {
    return "empty";
  }

  const kinds = new Set(
    nonEmpty.map(value => {
      if (value instanceof Date) {
        return "date";
      }
      if (typeof value === "number") {
        return "number";
      }
      if (typeof value === "boolean") {
        return "boolean";
      }
      return "string";
    }),
  );

  return kinds.size === 1
    ? (Array.from(kinds)[0] as ExcelReadColumnType)
    : "mixed";
}

function makeUniqueHeader(
  rawHeader: string | undefined,
  columnIndex: number,
  seen: Map<string, number>,
  issues: string[],
): string {
  const base = rawHeader || `col_${columnIndex + 1}`;
  const normalized = base.trim() || `col_${columnIndex + 1}`;
  const count = seen.get(normalized) ?? 0;
  seen.set(normalized, count + 1);

  if (count === 0) {
    if (!rawHeader) {
      issues.push(`第 ${columnIndex + 1} 列缺少表头，已自动生成 ${normalized}。`);
    }
    return normalized;
  }

  const next = `${normalized}_${count + 1}`;
  issues.push(`检测到重复表头 ${normalized}，已重命名为 ${next}。`);
  return next;
}

function buildRangeInfo(sheet: XLSX.WorkSheet, requestedRange?: string) {
  const baseRange = sheet["!ref"];
  if (!baseRange && !requestedRange) {
    throw new Error("Selected worksheet does not contain readable cells.");
  }

  const resolvedRange = requestedRange ?? baseRange!;
  const decodedRange = XLSX.utils.decode_range(resolvedRange);
  return {
    resolvedRange,
    decodedRange,
  };
}

function chooseSheet(workbook: XLSX.WorkBook, input: ExcelReadNodeInput) {
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error("Workbook does not contain any worksheets.");
  }

  const requestedName = normalizeString(input.sheetName);
  const requestedIndex = normalizePositiveInteger(input.sheetIndex, 1, 1, 1000);

  if (requestedName) {
    const sheetIndex = sheetNames.findIndex(name => name === requestedName);
    if (sheetIndex < 0) {
      throw new Error(`Worksheet not found: ${requestedName}`);
    }
    return {
      sheetName: requestedName,
      sheetIndex,
    };
  }

  const zeroBasedIndex = requestedIndex ? requestedIndex - 1 : 0;
  if (zeroBasedIndex < 0 || zeroBasedIndex >= sheetNames.length) {
    throw new Error(`Worksheet index out of range: ${requestedIndex}`);
  }

  return {
    sheetName: sheetNames[zeroBasedIndex],
    sheetIndex: zeroBasedIndex,
  };
}

function buildColumnDefinitions(input: {
  headerValues: RawCellValue[];
  dataRows: RawCellValue[][];
  issues: string[];
}): ExcelReadColumnDefinition[] {
  const seen = new Map<string, number>();
  const width = Math.max(
    input.headerValues.length,
    ...input.dataRows.map(row => row.length),
    0,
  );

  return Array.from({ length: width }, (_, columnIndex) => {
    const header = makeUniqueHeader(
      normalizeString(
        input.headerValues[columnIndex] === undefined ||
          input.headerValues[columnIndex] === null
          ? undefined
          : String(input.headerValues[columnIndex]),
      ),
      columnIndex,
      seen,
      input.issues,
    );

    const columnValues = input.dataRows.map(row => row[columnIndex]);
    return {
      key: header,
      header,
      columnIndex,
      columnLetter: XLSX.utils.encode_col(columnIndex),
      inferredType: inferColumnType(columnValues),
    };
  });
}

function rowsAreRectangular(rows: RawCellValue[][], columnCount: number): boolean {
  return rows.every(row => row.length === columnCount);
}

function buildStructuredRows(
  columns: ExcelReadColumnDefinition[],
  rows: RawCellValue[][],
) {
  const matrix: ExcelReadCellValue[][] = [];
  const records: Array<Record<string, ExcelReadCellValue>> = [];

  for (const row of rows) {
    const normalizedRow = columns.map((column, index) => toCellValue(row[index]));
    matrix.push(normalizedRow);
    records.push(
      columns.reduce<Record<string, ExcelReadCellValue>>((accumulator, column, index) => {
        accumulator[column.key] = normalizedRow[index];
        return accumulator;
      }, {}),
    );
  }

  return {
    matrix,
    records,
  };
}

function buildDynamicChartPayload(input: {
  rows: Array<Record<string, ExcelReadCellValue>>;
  columns: ExcelReadColumnDefinition[];
}) {
  const numericFields = input.columns
    .filter(column => column.inferredType === "number")
    .map(column => column.key);
  const dimensionFields = input.columns
    .filter(column => column.inferredType !== "number" && column.inferredType !== "empty")
    .map(column => column.key);

  let categoriesField = dimensionFields[0];
  let chartRows = input.rows;
  let usesSyntheticCategory = false;

  if (!categoriesField && numericFields.length > 0) {
    categoriesField = "__rowIndex";
    chartRows = input.rows.map((row, index) => ({
      __rowIndex: index + 1,
      ...row,
    }));
    usesSyntheticCategory = true;
  }

  const compatible = chartRows.length > 0 && numericFields.length > 0 && Boolean(categoriesField);
  const suggestedChartType =
    !compatible
      ? "table"
      : numericFields.length === 1 && chartRows.length > 8
        ? "line"
        : "bar";

  const payload: ExcelReadDynamicChartPayload = {
    compatible,
    ...(categoriesField ? { categoriesField } : {}),
    seriesFields: numericFields,
    rows: chartRows,
    columns: input.columns.map(column => column.key),
    suggestedChartType,
    usesSyntheticCategory,
  };

  return {
    payload,
    numericFields,
    dimensionFields,
  };
}

function buildValidationSummary(input: {
  rows: RawCellValue[][];
  columns: ExcelReadColumnDefinition[];
  issues: string[];
  dynamicChartCompatible: boolean;
  numericFields: string[];
  dimensionFields: string[];
}): ExcelReadValidationSummary {
  return {
    rowCount: input.rows.length,
    columnCount: input.columns.length,
    rectangular: rowsAreRectangular(input.rows, input.columns.length),
    issues: input.issues,
    numericFields: input.numericFields,
    dimensionFields: input.dimensionFields,
    dynamicChartReady: input.dynamicChartCompatible,
  };
}

export function isExcelReadNodeType(value: unknown): value is ExcelReadNodeType {
  return value === "excel_read";
}

export async function executeExcelReadNode(
  request: ExcelReadNodeExecutionRequest,
): Promise<ExcelReadNodeExecutionResult> {
  if (!isExcelReadNodeType(request.nodeType)) {
    throw new Error("Unsupported excel_read node type.");
  }

  const input = request.input ?? {};
  const workbookBase64 = normalizeString(input.workbookBase64);
  if (!workbookBase64) {
    throw new Error("Excel read node input requires workbookBase64.");
  }

  const workbookBuffer = Buffer.from(stripBase64Prefix(workbookBase64), "base64");
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: true,
    dense: true,
  });

  const sheetSelection = chooseSheet(workbook, input);
  const sheet = workbook.Sheets[sheetSelection.sheetName];
  if (!sheet) {
    throw new Error(`Worksheet not found: ${sheetSelection.sheetName}`);
  }

  const requestedRange = normalizeString(input.range);
  const { resolvedRange, decodedRange } = buildRangeInfo(sheet, requestedRange);
  const useHeaderRow = input.useHeaderRow !== false;
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    range: resolvedRange,
    defval: null,
  }) as RawCellValue[][];

  if (aoa.length === 0) {
    throw new Error("Resolved worksheet range does not contain any rows.");
  }

  const issues: string[] = [];
  const headerRow =
    useHeaderRow
      ? normalizePositiveInteger(
          input.headerRow,
          decodedRange.s.r + 1,
          decodedRange.s.r + 1,
          decodedRange.e.r + 1,
        )!
      : null;
  const headerOffset = headerRow !== null ? headerRow - (decodedRange.s.r + 1) : 0;
  if (headerRow !== null && (headerOffset < 0 || headerOffset >= aoa.length)) {
    throw new Error("Configured headerRow is outside the resolved range.");
  }

  const defaultDataStartRow = headerRow !== null ? headerRow + 1 : decodedRange.s.r + 1;
  const dataStartRow = normalizePositiveInteger(
    input.dataStartRow,
    defaultDataStartRow,
    decodedRange.s.r + 1,
    decodedRange.e.r + 1,
  )!;
  const dataOffset = dataStartRow - (decodedRange.s.r + 1);

  const rawDataRows = aoa.slice(dataOffset).filter(row =>
    row.some(cell => cell !== null && cell !== undefined && cell !== ""),
  );
  const maxRows = normalizePositiveInteger(input.maxRows, undefined, 1, 5000);
  const limitedRows =
    typeof maxRows === "number" ? rawDataRows.slice(0, maxRows) : rawDataRows;
  const warnings: string[] = [];
  if (typeof maxRows === "number" && rawDataRows.length > maxRows) {
    warnings.push(`已按 maxRows=${maxRows} 截断读取结果。`);
  }

  const headerValues = useHeaderRow
    ? aoa[headerOffset] ?? []
    : Array.from(
        { length: Math.max(...limitedRows.map(row => row.length), 0) },
        (_, index) => `col_${index + 1}`,
      );

  const columns = buildColumnDefinitions({
    headerValues,
    dataRows: limitedRows,
    issues,
  });
  const structured = buildStructuredRows(columns, limitedRows);
  const dynamicChart = buildDynamicChartPayload({
    rows: structured.records,
    columns,
  });

  if (!dynamicChart.payload.compatible) {
    issues.push("当前输出缺少可用于 dynamic_chart 的数值列，建议调整范围或表头配置。");
  }
  if (dynamicChart.payload.usesSyntheticCategory) {
    warnings.push("未检测到维度列，已为 dynamic_chart 自动补充 __rowIndex 分类轴。");
  }

  return {
    ok: true,
    nodeType: "excel_read",
    output: {
      status: "completed",
      workbook: {
        ...(normalizeString(input.fileName)
          ? { fileName: normalizeString(input.fileName) }
          : {}),
        totalSheets: workbook.SheetNames.length,
        sheetNames: workbook.SheetNames,
      },
      selection: {
        sheetName: sheetSelection.sheetName,
        sheetIndex: sheetSelection.sheetIndex,
        ...(requestedRange ? { requestedRange } : {}),
        resolvedRange,
        headerRow,
        dataStartRow,
        maxRowsApplied: maxRows ?? null,
      },
      columns,
      rows: structured.records,
      matrix: structured.matrix,
      validation: buildValidationSummary({
        rows: limitedRows,
        columns,
        issues,
        dynamicChartCompatible: dynamicChart.payload.compatible,
        numericFields: dynamicChart.numericFields,
        dimensionFields: dynamicChart.dimensionFields,
      }),
      dynamicChart: dynamicChart.payload,
      warnings,
      context: normalizeRecord(input.context),
      observability: {
        eventKey: "content.excel_read",
        nodeType: "excel_read",
        sheetName: sheetSelection.sheetName,
        rowCount: limitedRows.length,
        columnCount: columns.length,
        dynamicChartReady: dynamicChart.payload.compatible,
      },
    },
  };
}
