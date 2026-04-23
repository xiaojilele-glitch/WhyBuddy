export const WEB_AIGC_FILE_TRANSLATION_API = {
  EXECUTE: "POST /api/file-translation/nodes/execute",
  DOWNLOAD_OUTPUT: "GET /api/file-translation/outputs/:outputId/:filename",
} as const;

export const WEB_AIGC_FILE_TRANSLATION_NODE_TYPES = [
  "file_translation",
] as const;

export type FileTranslationNodeType =
  (typeof WEB_AIGC_FILE_TRANSLATION_NODE_TYPES)[number];

export const WEB_AIGC_FILE_TRANSLATION_OUTPUT_FORMATS = [
  "txt",
  "md",
  "json",
] as const;

export type WebAigcFileTranslationOutputFormat =
  (typeof WEB_AIGC_FILE_TRANSLATION_OUTPUT_FORMATS)[number];

export const WEB_AIGC_FILE_TRANSLATION_SEGMENT_KINDS = [
  "heading",
  "paragraph",
  "list_item",
  "quote",
  "blank",
] as const;

export type FileTranslationSegmentKind =
  (typeof WEB_AIGC_FILE_TRANSLATION_SEGMENT_KINDS)[number];

export interface FileTranslationSourceFileInput {
  name?: string;
  mimeType?: string;
  content?: string;
  sizeBytes?: number;
}

export interface FileTranslationDocumentInput {
  title?: string;
  text?: string;
}

export interface FileTranslationArtifactInput {
  persistOutput?: boolean;
  outputId?: string;
  outputFormat?: WebAigcFileTranslationOutputFormat;
}

export interface FileTranslationLimitsInput {
  maxChars?: number;
  maxSegments?: number;
}

export interface FileTranslationNodeInput {
  file?: FileTranslationSourceFileInput;
  document?: FileTranslationDocumentInput;
  content?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  preserveStructure?: boolean;
  artifact?: FileTranslationArtifactInput;
  limits?: FileTranslationLimitsInput;
  context?: Record<string, unknown>;
}

export interface FileTranslationNodeExecutionRequest {
  nodeType: FileTranslationNodeType;
  input?: FileTranslationNodeInput;
}

export interface FileTranslationSegment {
  segmentId: string;
  index: number;
  kind: FileTranslationSegmentKind;
  marker?: string;
  sourceText: string;
  translatedText: string;
  level?: number;
  preservedStructure: boolean;
}

export interface WebAigcFileTranslationArtifact {
  kind: "file";
  name: string;
  path: string;
  mimeType: string;
  downloadUrl: string;
  description: string;
  sizeBytes: number;
}

export interface FileTranslationNodeExecutionResult {
  ok: true;
  nodeType: FileTranslationNodeType;
  output: {
    status: "completed";
    sourceFile: {
      name: string;
      mimeType: string;
      sizeBytes: number;
      inputChars: number;
    };
    translation: {
      sourceLanguage: string;
      targetLanguage: string;
      text: string;
      segments: FileTranslationSegment[];
      structurePreserved: boolean;
    };
    artifact?: {
      outputId: string;
      format: WebAigcFileTranslationOutputFormat;
      artifact: WebAigcFileTranslationArtifact;
    };
    boundary: {
      inputChars: number;
      segmentCount: number;
      maxChars: number;
      maxSegments: number;
      withinLimit: true;
    };
    branch: {
      selected: "translated";
      conditions: {
        translated: true;
        tooLarge: false;
        artifactReady: boolean;
      };
    };
    context: Record<string, unknown>;
    warnings: string[];
    observability: {
      eventKey: "content.file_translation";
      nodeType: FileTranslationNodeType;
      sourceLanguage: string;
      targetLanguage: string;
      segmentCount: number;
      inputChars: number;
      artifactPersisted: boolean;
      latencyMs: number;
    };
  };
}

export function validateWebAigcFileTranslationOutputSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function buildWebAigcFileTranslationOutputDownloadUrl(
  outputId: string,
  filename: string,
): string {
  return `/api/file-translation/outputs/${encodeURIComponent(outputId)}/${encodeURIComponent(
    filename,
  )}`;
}

export function buildWebAigcFileTranslationVirtualPath(
  outputId: string,
  filename: string,
): string {
  return `memory://web-aigc-file-translation/${outputId}/${filename}`;
}

export function resolveWebAigcFileTranslationMediaType(
  format: WebAigcFileTranslationOutputFormat,
): string {
  if (format === "json") {
    return "application/json; charset=utf-8";
  }

  if (format === "md") {
    return "text/markdown; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}
