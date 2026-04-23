import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type {
  AiPptNodeExecutionRequest,
  AiPptNodeExecutionResult,
  AiPptNodeInput,
  AiPptNodeType,
  PersistedWebAigcAiPptOutput,
  WebAigcAiPptDeck,
  WebAigcAiPptGenerationInput,
  WebAigcAiPptSlide,
} from "../../../shared/web-aigc-ai-ppt.js";
import {
  buildWebAigcAiPptOutputDownloadUrl,
  buildWebAigcAiPptOutputRelativePath,
  validateWebAigcAiPptOutputSegment,
} from "../../../shared/web-aigc-ai-ppt.js";

export class AiPptNodeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AiPptNodeError";
    this.status = status;
  }
}

export interface AiPptNodeAdapterDeps {
  generateDeck?: (
    input: WebAigcAiPptGenerationInput,
  ) => Promise<Omit<WebAigcAiPptDeck, "generationMode">>;
  persistOutput?: (
    deck: WebAigcAiPptDeck,
    options?: {
      outputId?: string;
      fileName?: string;
    },
  ) => Promise<PersistedWebAigcAiPptOutput>;
  now?: () => number;
  createOutputId?: () => string;
}

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

function normalizeSlideCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }

  return Math.max(3, Math.min(12, Math.floor(value)));
}

function normalizeArtifactOptions(input: AiPptNodeInput | undefined): {
  persistOutput: boolean;
  outputId?: string;
  fileName?: string;
} {
  const artifact = normalizeObject(input?.artifact);
  const persistOutput =
    artifact.persistOutput === undefined ? true : Boolean(artifact.persistOutput);
  const outputId = normalizeString(artifact.outputId);
  const fileName = normalizeString(artifact.fileName);

  if (outputId && !validateWebAigcAiPptOutputSegment(outputId)) {
    throw new AiPptNodeError(
      400,
      "'artifact.outputId' must contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }

  if (fileName && !validateWebAigcAiPptOutputSegment(fileName)) {
    throw new AiPptNodeError(
      400,
      "'artifact.fileName' must contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return {
    persistOutput,
    ...(outputId ? { outputId } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

function normalizeGenerationInput(
  input: AiPptNodeInput | undefined,
): WebAigcAiPptGenerationInput {
  const topic = normalizeString(input?.topic);
  const brief = normalizeString(input?.brief);
  const sourceText = normalizeString(input?.sourceText);
  const audience = normalizeString(input?.audience);
  const locale = normalizeString(input?.locale);
  const slideCount = normalizeSlideCount(input?.slideCount);

  if (!topic && !brief && !sourceText) {
    throw new AiPptNodeError(
      400,
      "AI PPT node input requires topic, brief, or sourceText.",
    );
  }

  return {
    ...(topic ? { topic } : {}),
    ...(brief ? { brief } : {}),
    ...(sourceText ? { sourceText } : {}),
    ...(audience ? { audience } : {}),
    ...(locale ? { locale } : {}),
    slideCount,
  };
}

function splitSentences(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\r\n]+|[。！？!?;；]+/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

function buildSlideTitle(topic: string, index: number, total: number): string {
  if (index === 0) {
    return `${topic}概览`;
  }
  if (index === total - 1) {
    return `${topic}结论与行动`;
  }
  return `${topic}第 ${index + 1} 页`;
}

function buildFallbackDeck(input: WebAigcAiPptGenerationInput): WebAigcAiPptDeck {
  const title = input.topic ?? input.brief ?? "AI PPT";
  const sourceSegments = [
    ...splitSentences(input.brief),
    ...splitSentences(input.sourceText),
  ];

  const summary = input.brief ?? input.sourceText ?? `围绕 ${title} 生成的演示文稿。`;
  const slides: WebAigcAiPptSlide[] = Array.from({ length: input.slideCount }, (_, index) => {
    const seed = sourceSegments[index] ?? sourceSegments[0] ?? `围绕 ${title} 提炼关键内容。`;
    const next = sourceSegments[(index + 1) % Math.max(sourceSegments.length, 1)] ?? seed;

    return {
      slideNumber: index + 1,
      title: buildSlideTitle(title, index, input.slideCount),
      bullets: [
        `核心主题：${title}`,
        `重点信息：${seed}`,
        `建议展开：${next}`,
      ],
      speakerNotes: input.audience
        ? `面向 ${input.audience} 进行讲解，按业务价值优先展开。`
        : "按业务背景、关键结论、后续动作进行讲解。",
    };
  });

  return {
    title,
    summary,
    slides,
    generationMode: "fallback",
  };
}

function normalizeGeneratedDeck(
  deck: Omit<WebAigcAiPptDeck, "generationMode">,
  fallback: WebAigcAiPptDeck,
): WebAigcAiPptDeck {
  const title = normalizeString(deck.title) ?? fallback.title;
  const summary = normalizeString(deck.summary) ?? fallback.summary;
  const slides = Array.isArray(deck.slides) && deck.slides.length > 0
    ? deck.slides.map((slide, index) => ({
        slideNumber:
          typeof slide.slideNumber === "number" && Number.isFinite(slide.slideNumber)
            ? Math.max(1, Math.floor(slide.slideNumber))
            : index + 1,
        title: normalizeString(slide.title) ?? `第 ${index + 1} 页`,
        bullets: Array.isArray(slide.bullets)
          ? slide.bullets
              .filter((item): item is string => typeof item === "string")
              .map(item => item.trim())
              .filter(Boolean)
          : [],
        ...(normalizeString(slide.speakerNotes)
          ? { speakerNotes: normalizeString(slide.speakerNotes) }
          : {}),
      }))
    : fallback.slides;

  return {
    title,
    summary,
    slides: slides.map((slide, index) => ({
      slideNumber: index + 1,
      title: slide.title,
      bullets: slide.bullets.length > 0 ? slide.bullets : fallback.slides[index]?.bullets ?? [],
      ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
    })),
    generationMode: "generated",
  };
}

function buildContext(
  input: AiPptNodeInput | undefined,
  deck: WebAigcAiPptDeck,
  artifact: PersistedWebAigcAiPptOutput | undefined,
): Record<string, unknown> {
  const context = normalizeObject(input?.context);

  return {
    ...context,
    aiPpt: {
      title: deck.title,
      summary: deck.summary,
      slideCount: deck.slides.length,
      generationMode: deck.generationMode,
      ...(artifact ? { artifact } : {}),
    },
  };
}

function defaultOutputId(): string {
  return `ai-ppt-${Date.now()}`;
}

function defaultFileName(outputId: string): string {
  return `${outputId}.ppt.json`;
}

export function resolveAiPptOutputAbsolutePath(
  outputId: string,
  filename: string,
): string {
  return path.join(process.cwd(), "tmp/ai-ppt-outputs", outputId, filename);
}

export async function persistAiPptOutput(
  deck: WebAigcAiPptDeck,
  options: {
    outputId?: string;
    fileName?: string;
  } = {},
): Promise<PersistedWebAigcAiPptOutput> {
  const outputId = options.outputId ?? defaultOutputId();
  const fileName = options.fileName ?? defaultFileName(outputId);

  if (
    !validateWebAigcAiPptOutputSegment(outputId) ||
    !validateWebAigcAiPptOutputSegment(fileName)
  ) {
    throw new AiPptNodeError(400, "Invalid AI PPT artifact path segment.");
  }

  const absolutePath = resolveAiPptOutputAbsolutePath(outputId, fileName);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        deck,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    outputId,
    artifacts: [
      {
        kind: "file",
        name: fileName,
        path: buildWebAigcAiPptOutputRelativePath(outputId, fileName),
        mimeType: "application/json",
        downloadUrl: buildWebAigcAiPptOutputDownloadUrl(outputId, fileName),
        description: `AI PPT output artifact (${fileName})`,
      },
    ],
  };
}

export function isAiPptNodeType(value: unknown): value is AiPptNodeType {
  return value === "ai_ppt";
}

export async function executeAiPptNode(
  request: AiPptNodeExecutionRequest,
  deps: AiPptNodeAdapterDeps = {},
): Promise<AiPptNodeExecutionResult> {
  if (!isAiPptNodeType(request.nodeType)) {
    throw new AiPptNodeError(400, "Unsupported ai_ppt node type.");
  }

  const now = deps.now ?? Date.now;
  const startedAt = now();
  const input = request.input ?? {};
  const normalizedInput = normalizeGenerationInput(input);
  const artifactOptions = normalizeArtifactOptions(input);
  const fallbackDeck = buildFallbackDeck(normalizedInput);
  const warnings: string[] = [];

  let deck = fallbackDeck;
  let degraded = false;
  let fallbackReason: string | undefined;

  if (deps.generateDeck) {
    try {
      const generated = await deps.generateDeck(normalizedInput);
      deck = normalizeGeneratedDeck(generated, fallbackDeck);
    } catch (error) {
      degraded = true;
      fallbackReason = `AI PPT generation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      warnings.push("AI PPT 生成器失败，已自动回退到本地模板页纲。");
      deck = fallbackDeck;
    }
  }

  let artifact: PersistedWebAigcAiPptOutput | undefined;
  if (artifactOptions.persistOutput) {
    try {
      const persistOutput = deps.persistOutput ?? persistAiPptOutput;
      artifact = await persistOutput(deck, {
        ...(artifactOptions.outputId
          ? { outputId: artifactOptions.outputId }
          : deps.createOutputId
            ? { outputId: deps.createOutputId() }
            : {}),
        ...(artifactOptions.fileName ? { fileName: artifactOptions.fileName } : {}),
      });
    } catch (error) {
      throw new AiPptNodeError(
        500,
        `AI PPT artifact persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const latencyMs = Math.max(0, now() - startedAt);

  return {
    ok: true,
    nodeType: "ai_ppt",
    output: {
      status: degraded ? "degraded" : "completed",
      degraded,
      deck,
      ...(artifact ? { artifact } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      context: buildContext(input, deck, artifact),
      observability: {
        eventKey: "content.ai_ppt",
        nodeType: "ai_ppt",
        slideCount: deck.slides.length,
        artifactPersisted: Boolean(artifact),
        degraded,
        latencyMs,
      },
      warnings,
    },
  };
}
