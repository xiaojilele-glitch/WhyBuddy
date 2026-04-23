export const WEB_AIGC_AI_PPT_API = {
  EXECUTE: "POST /api/ai-ppt/nodes/execute",
  DOWNLOAD_OUTPUT: "GET /api/ai-ppt/outputs/:outputId/:filename",
} as const;

export const WEB_AIGC_AI_PPT_NODE_TYPES = ["ai_ppt"] as const;

export type AiPptNodeType = (typeof WEB_AIGC_AI_PPT_NODE_TYPES)[number];

export const WEB_AIGC_AI_PPT_OUTPUT_BASE_PATH = "tmp/ai-ppt-outputs";

export interface WebAigcAiPptArtifactInput {
  persistOutput?: boolean;
  outputId?: string;
  fileName?: string;
}

export interface AiPptNodeInput {
  topic?: string;
  brief?: string;
  sourceText?: string;
  audience?: string;
  locale?: string;
  slideCount?: number;
  artifact?: WebAigcAiPptArtifactInput;
  context?: Record<string, unknown>;
}

export interface WebAigcAiPptGenerationInput {
  topic?: string;
  brief?: string;
  sourceText?: string;
  audience?: string;
  locale?: string;
  slideCount: number;
}

export interface AiPptNodeExecutionRequest {
  nodeType: AiPptNodeType;
  input?: AiPptNodeInput;
}

export interface WebAigcAiPptSlide {
  slideNumber: number;
  title: string;
  bullets: string[];
  speakerNotes?: string;
}

export interface WebAigcAiPptDeck {
  title: string;
  summary: string;
  slides: WebAigcAiPptSlide[];
  generationMode: "generated" | "fallback";
}

export interface WebAigcAiPptArtifact {
  kind: "file";
  name: string;
  path: string;
  mimeType: string;
  downloadUrl: string;
  description: string;
}

export interface PersistedWebAigcAiPptOutput {
  outputId: string;
  artifacts: WebAigcAiPptArtifact[];
}

export interface AiPptNodeExecutionResult {
  ok: true;
  nodeType: AiPptNodeType;
  output: {
    status: "completed" | "degraded";
    degraded: boolean;
    deck: WebAigcAiPptDeck;
    artifact?: PersistedWebAigcAiPptOutput;
    fallbackReason?: string;
    context: Record<string, unknown>;
    observability: {
      eventKey: "content.ai_ppt";
      nodeType: AiPptNodeType;
      slideCount: number;
      artifactPersisted: boolean;
      degraded: boolean;
      latencyMs: number;
    };
    warnings: string[];
  };
}

export function validateWebAigcAiPptOutputSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function buildWebAigcAiPptOutputDownloadUrl(
  outputId: string,
  filename: string,
): string {
  return `/api/ai-ppt/outputs/${encodeURIComponent(outputId)}/${encodeURIComponent(
    filename,
  )}`;
}

export function buildWebAigcAiPptOutputRelativePath(
  outputId: string,
  filename: string,
): string {
  return `${WEB_AIGC_AI_PPT_OUTPUT_BASE_PATH}/${outputId}/${filename}`;
}
