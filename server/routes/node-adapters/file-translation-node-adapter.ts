import { randomUUID } from "node:crypto";

import type {
  FileTranslationNodeExecutionRequest,
  FileTranslationNodeExecutionResult,
  FileTranslationNodeInput,
  FileTranslationNodeType,
  FileTranslationSegment,
  FileTranslationSegmentKind,
  WebAigcFileTranslationArtifact,
  WebAigcFileTranslationOutputFormat,
} from "../../../shared/web-aigc-file-translation.js";
import {
  buildWebAigcFileTranslationOutputDownloadUrl,
  buildWebAigcFileTranslationVirtualPath,
  resolveWebAigcFileTranslationMediaType,
  validateWebAigcFileTranslationOutputSegment,
} from "../../../shared/web-aigc-file-translation.js";

export class FileTranslationNodeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FileTranslationNodeError";
    this.status = status;
  }
}

export interface FileTranslationSegmentTranslationInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  kind: FileTranslationSegmentKind;
  index: number;
  fileName: string;
  mimeType: string;
}

export interface FileTranslationNodeAdapterDeps {
  translateSegment?: (
    input: FileTranslationSegmentTranslationInput,
  ) => Promise<string>;
  now?: () => number;
}

interface NormalizedFileInput {
  name: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
  sourceLanguage: string;
  targetLanguage: string;
  preserveStructure: boolean;
  persistOutput: boolean;
  outputId?: string;
  outputFormat: WebAigcFileTranslationOutputFormat;
  maxChars: number;
  maxSegments: number;
  context: Record<string, unknown>;
}

interface StoredFileTranslationOutput {
  outputId: string;
  filename: string;
  mediaType: string;
  content: string;
  sizeBytes: number;
}

interface ParsedSourceSegment {
  kind: FileTranslationSegmentKind;
  marker?: string;
  sourceText: string;
  level?: number;
}

const DEFAULT_MAX_CHARS = 16000;
const DEFAULT_MAX_SEGMENTS = 600;
const OUTPUT_STORE = new Map<string, Map<string, StoredFileTranslationOutput>>();

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  field: "maxChars" | "maxSegments",
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new FileTranslationNodeError(
      400,
      `file_translation '${field}' must be a positive number.`,
    );
  }

  return Math.floor(value);
}

function sanitizeSegment(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return sanitized.replace(/^-+|-+$/g, "") || "translated-file";
}

function resolveOutputFormat(
  requested: unknown,
  sourceName: string,
): WebAigcFileTranslationOutputFormat {
  if (requested === "json" || requested === "md" || requested === "txt") {
    return requested;
  }

  return sourceName.toLowerCase().endsWith(".md") ? "md" : "txt";
}

function resolveBaseName(input: FileTranslationNodeInput): string {
  const candidate =
    normalizeString(input.file?.name) ||
    normalizeString(input.document?.title) ||
    "translated-file";

  return candidate.replace(/\.[^.]+$/, "");
}

function resolveContent(input: FileTranslationNodeInput): string {
  const candidate =
    normalizeString(input.file?.content) ||
    normalizeString(input.document?.text) ||
    normalizeString(input.content);

  if (!candidate) {
    throw new FileTranslationNodeError(
      400,
      "File translation requires file.content, document.text, or content.",
    );
  }

  return candidate;
}

function normalizeInput(input: FileTranslationNodeInput | undefined): NormalizedFileInput {
  const normalizedInput = input ?? {};
  const content = resolveContent(normalizedInput);
  const sourceName = resolveBaseName(normalizedInput);
  const fileName = normalizeString(normalizedInput.file?.name)
    ? normalizeString(normalizedInput.file?.name)!
    : `${sanitizeSegment(sourceName)}.txt`;
  const mimeType =
    normalizeString(normalizedInput.file?.mimeType) ||
    (fileName.toLowerCase().endsWith(".md")
      ? "text/markdown; charset=utf-8"
      : "text/plain; charset=utf-8");
  const sourceLanguage = normalizeString(normalizedInput.sourceLanguage) || "auto";
  const targetLanguage = normalizeString(normalizedInput.targetLanguage) || "zh-CN";
  const preserveStructure = normalizeBoolean(
    normalizedInput.preserveStructure,
    true,
  );
  const artifactInput = normalizeObject(normalizedInput.artifact);
  const persistOutput = normalizeBoolean(artifactInput.persistOutput, true);
  const outputId = normalizeString(artifactInput.outputId);
  const outputFormat = resolveOutputFormat(artifactInput.outputFormat, fileName);
  const maxChars = normalizeLimit(
    normalizedInput.limits?.maxChars,
    DEFAULT_MAX_CHARS,
    "maxChars",
  );
  const maxSegments = normalizeLimit(
    normalizedInput.limits?.maxSegments,
    DEFAULT_MAX_SEGMENTS,
    "maxSegments",
  );

  return {
    name: fileName,
    mimeType,
    content,
    sizeBytes:
      typeof normalizedInput.file?.sizeBytes === "number" &&
      Number.isFinite(normalizedInput.file.sizeBytes)
        ? Math.max(0, Math.floor(normalizedInput.file.sizeBytes))
        : Buffer.byteLength(content, "utf-8"),
    sourceLanguage,
    targetLanguage,
    preserveStructure,
    persistOutput,
    outputId,
    outputFormat,
    maxChars,
    maxSegments,
    context: normalizeObject(normalizedInput.context),
  };
}

function parseLine(line: string): ParsedSourceSegment {
  if (!line.trim()) {
    return {
      kind: "blank",
      sourceText: "",
    };
  }

  const headingMatch = line.match(/^(#{1,6})(\s+)(.*)$/);
  if (headingMatch) {
    return {
      kind: "heading",
      marker: `${headingMatch[1]}${headingMatch[2]}`,
      sourceText: headingMatch[3],
      level: headingMatch[1].length,
    };
  }

  const unorderedListMatch = line.match(/^(\s*[-*+]\s+)(.*)$/);
  if (unorderedListMatch) {
    return {
      kind: "list_item",
      marker: unorderedListMatch[1],
      sourceText: unorderedListMatch[2],
    };
  }

  const orderedListMatch = line.match(/^(\s*\d+\.\s+)(.*)$/);
  if (orderedListMatch) {
    return {
      kind: "list_item",
      marker: orderedListMatch[1],
      sourceText: orderedListMatch[2],
    };
  }

  const quoteMatch = line.match(/^(\s*>\s+)(.*)$/);
  if (quoteMatch) {
    return {
      kind: "quote",
      marker: quoteMatch[1],
      sourceText: quoteMatch[2],
    };
  }

  return {
    kind: "paragraph",
    sourceText: line,
  };
}

function parseContent(content: string): ParsedSourceSegment[] {
  return content.replace(/\r\n/g, "\n").split("\n").map(parseLine);
}

function ensureBoundaries(
  content: string,
  segments: ParsedSourceSegment[],
  normalized: NormalizedFileInput,
): void {
  const inputChars = content.length;
  if (inputChars > normalized.maxChars) {
    throw new FileTranslationNodeError(
      413,
      `File translation content exceeds maxChars limit (${inputChars} > ${normalized.maxChars}).`,
    );
  }

  if (segments.length > normalized.maxSegments) {
    throw new FileTranslationNodeError(
      413,
      `File translation content exceeds maxSegments limit (${segments.length} > ${normalized.maxSegments}).`,
    );
  }
}

async function defaultTranslateSegment(
  input: FileTranslationSegmentTranslationInput,
): Promise<string> {
  return `[${input.targetLanguage}] ${input.text}`;
}

function rebuildLine(segment: FileTranslationSegment): string {
  if (segment.kind === "blank") {
    return "";
  }

  return `${segment.marker ?? ""}${segment.translatedText}`;
}

function buildTranslatedText(
  segments: FileTranslationSegment[],
  preserveStructure: boolean,
): string {
  if (preserveStructure) {
    return segments.map(rebuildLine).join("\n");
  }

  return segments
    .filter(segment => segment.kind !== "blank")
    .map(segment => segment.translatedText)
    .join("\n");
}

function buildOutputFilename(
  sourceName: string,
  targetLanguage: string,
  format: WebAigcFileTranslationOutputFormat,
): string {
  const baseName = sanitizeSegment(sourceName.replace(/\.[^.]+$/, ""));
  const locale = sanitizeSegment(targetLanguage);
  return `${baseName}.${locale}.${format}`;
}

function buildArtifactContent(
  result: Pick<
    FileTranslationNodeExecutionResult["output"],
    "sourceFile" | "translation" | "boundary"
  >,
  format: WebAigcFileTranslationOutputFormat,
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        sourceFile: result.sourceFile,
        translation: result.translation,
        boundary: result.boundary,
      },
      null,
      2,
    );
  }

  return result.translation.text;
}

function registerOutput(output: StoredFileTranslationOutput): void {
  let outputFiles = OUTPUT_STORE.get(output.outputId);
  if (!outputFiles) {
    outputFiles = new Map<string, StoredFileTranslationOutput>();
    OUTPUT_STORE.set(output.outputId, outputFiles);
  }

  outputFiles.set(output.filename, output);
}

function buildContext(
  normalized: NormalizedFileInput,
  text: string,
  artifact:
    | {
        outputId: string;
        artifact: WebAigcFileTranslationArtifact;
      }
    | undefined,
): Record<string, unknown> {
  return {
    ...normalized.context,
    fileTranslation: {
      text,
      sourceLanguage: normalized.sourceLanguage,
      targetLanguage: normalized.targetLanguage,
      structurePreserved: normalized.preserveStructure,
      ...(artifact
        ? {
            artifact: {
              outputId: artifact.outputId,
              name: artifact.artifact.name,
              downloadUrl: artifact.artifact.downloadUrl,
            },
          }
        : {}),
    },
  };
}

export function isFileTranslationNodeType(
  value: unknown,
): value is FileTranslationNodeType {
  return value === "file_translation";
}

export function getFileTranslationOutput(
  outputId: string,
  filename: string,
): StoredFileTranslationOutput | undefined {
  return OUTPUT_STORE.get(outputId)?.get(filename);
}

export function clearFileTranslationOutputStoreForTests(): void {
  OUTPUT_STORE.clear();
}

export async function executeFileTranslationNode(
  request: FileTranslationNodeExecutionRequest,
  deps: FileTranslationNodeAdapterDeps = {},
): Promise<FileTranslationNodeExecutionResult> {
  if (!isFileTranslationNodeType(request.nodeType)) {
    throw new FileTranslationNodeError(
      400,
      "Unsupported file_translation node type.",
    );
  }

  const normalized = normalizeInput(request.input);
  const parsedSegments = parseContent(normalized.content);
  ensureBoundaries(normalized.content, parsedSegments, normalized);

  const startedAt = (deps.now ?? Date.now)();
  const translateSegment = deps.translateSegment ?? defaultTranslateSegment;
  const translatedSegments: FileTranslationSegment[] = [];

  for (const [index, segment] of parsedSegments.entries()) {
    if (segment.kind === "blank") {
      translatedSegments.push({
        segmentId: `segment-${index + 1}`,
        index,
        kind: segment.kind,
        sourceText: "",
        translatedText: "",
        preservedStructure: normalized.preserveStructure,
      });
      continue;
    }

    const translatedText = await translateSegment({
      text: segment.sourceText,
      sourceLanguage: normalized.sourceLanguage,
      targetLanguage: normalized.targetLanguage,
      kind: segment.kind,
      index,
      fileName: normalized.name,
      mimeType: normalized.mimeType,
    });

    translatedSegments.push({
      segmentId: `segment-${index + 1}`,
      index,
      kind: segment.kind,
      ...(segment.marker ? { marker: segment.marker } : {}),
      ...(typeof segment.level === "number" ? { level: segment.level } : {}),
      sourceText: segment.sourceText,
      translatedText,
      preservedStructure: normalized.preserveStructure,
    });
  }

  const translatedText = buildTranslatedText(
    translatedSegments,
    normalized.preserveStructure,
  );

  const resultBase = {
    sourceFile: {
      name: normalized.name,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
      inputChars: normalized.content.length,
    },
    translation: {
      sourceLanguage: normalized.sourceLanguage,
      targetLanguage: normalized.targetLanguage,
      text: translatedText,
      segments: translatedSegments,
      structurePreserved: normalized.preserveStructure,
    },
    boundary: {
      inputChars: normalized.content.length,
      segmentCount: translatedSegments.length,
      maxChars: normalized.maxChars,
      maxSegments: normalized.maxSegments,
      withinLimit: true as const,
    },
  };

  let artifact:
    | {
        outputId: string;
        format: WebAigcFileTranslationOutputFormat;
        artifact: WebAigcFileTranslationArtifact;
      }
    | undefined;

  if (normalized.persistOutput) {
    const requestedOutputId =
      normalized.outputId || `file_translation_${randomUUID()}`;
    const safeOutputId = sanitizeSegment(requestedOutputId);
    if (!validateWebAigcFileTranslationOutputSegment(safeOutputId)) {
      throw new FileTranslationNodeError(400, "Invalid file translation outputId.");
    }

    const filename = buildOutputFilename(
      normalized.name,
      normalized.targetLanguage,
      normalized.outputFormat,
    );
    if (!validateWebAigcFileTranslationOutputSegment(filename)) {
      throw new FileTranslationNodeError(400, "Invalid file translation filename.");
    }

    const content = buildArtifactContent(resultBase, normalized.outputFormat);
    const mediaType = resolveWebAigcFileTranslationMediaType(normalized.outputFormat);
    const sizeBytes = Buffer.byteLength(content, "utf-8");

    registerOutput({
      outputId: safeOutputId,
      filename,
      mediaType,
      content,
      sizeBytes,
    });

    artifact = {
      outputId: safeOutputId,
      format: normalized.outputFormat,
      artifact: {
        kind: "file",
        name: filename,
        path: buildWebAigcFileTranslationVirtualPath(safeOutputId, filename),
        mimeType: mediaType,
        downloadUrl: buildWebAigcFileTranslationOutputDownloadUrl(
          safeOutputId,
          filename,
        ),
        description: `File translation output artifact (${filename})`,
        sizeBytes,
      },
    };
  }

  const latencyMs = Math.max(0, (deps.now ?? Date.now)() - startedAt);

  return {
    ok: true,
    nodeType: "file_translation",
    output: {
      status: "completed",
      ...resultBase,
      ...(artifact ? { artifact } : {}),
      branch: {
        selected: "translated",
        conditions: {
          translated: true,
          tooLarge: false,
          artifactReady: Boolean(artifact),
        },
      },
      context: buildContext(
        normalized,
        translatedText,
        artifact
          ? {
              outputId: artifact.outputId,
              artifact: artifact.artifact,
            }
          : undefined,
      ),
      warnings: [],
      observability: {
        eventKey: "content.file_translation",
        nodeType: "file_translation",
        sourceLanguage: normalized.sourceLanguage,
        targetLanguage: normalized.targetLanguage,
        segmentCount: translatedSegments.length,
        inputChars: normalized.content.length,
        artifactPersisted: Boolean(artifact),
        latencyMs,
      },
    },
  };
}
