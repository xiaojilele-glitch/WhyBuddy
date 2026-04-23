import type {
  OCRPageResult,
  OCRRecognitionResult,
  OCRTextFragment,
} from "../../core/ocr-provider.js";
import { recognizeImagesText } from "../../core/ocr-provider.js";
import {
  OCR_OUTPUT_FORMATS,
  type OCROutputFormat,
  type PersistedVisionOutput,
  writeOCRArtifacts,
} from "../../core/vision-output.js";
import type {
  OcrRecognitionNodeExecutionRequest,
  OcrRecognitionNodeExecutionResult,
  OcrRecognitionNodeInput,
  OcrRecognitionNodeType,
  WebAigcOcrRecognitionImageInput,
} from "../../../shared/web-aigc-ocr-recognition.js";

export class OcrRecognitionNodeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OcrRecognitionNodeError";
    this.status = status;
  }
}

export interface OcrRecognitionNodeAdapterDeps {
  recognizeImages?: (
    images: Array<{ base64DataUrl: string; name: string }>,
    prompt?: string,
  ) => Promise<Map<string, OCRRecognitionResult>>;
  persistArtifacts?: (
    results: Array<{ name: string; recognition: OCRRecognitionResult }>,
    options?: {
      outputId?: string;
      formats?: OCROutputFormat[];
    },
  ) => Promise<PersistedVisionOutput>;
  now?: () => number;
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

function normalizeImages(value: unknown): WebAigcOcrRecognitionImageInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OcrRecognitionNodeError(
      400,
      "OCR recognition node input requires a non-empty images array.",
    );
  }

  return value.map((item, index) => {
    const record = normalizeObject(item);
    const name = normalizeString(record.name);
    const base64DataUrl = normalizeString(record.base64DataUrl);

    if (!name) {
      throw new OcrRecognitionNodeError(
        400,
        `images[${index}].name is required and must be a non-empty string.`,
      );
    }

    if (!base64DataUrl) {
      throw new OcrRecognitionNodeError(
        400,
        `images[${index}].base64DataUrl is required and must be a non-empty string.`,
      );
    }

    return {
      name,
      base64DataUrl,
    };
  });
}

function normalizeOutputFormats(value: unknown): OCROutputFormat[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new OcrRecognitionNodeError(
      400,
      "'artifact.outputFormats' must be a non-empty array of supported formats.",
    );
  }

  const formats = value.map(entry => normalizeString(entry)) as Array<
    OCROutputFormat | undefined
  >;

  if (
    formats.some(
      format =>
        !format || !OCR_OUTPUT_FORMATS.includes(format as OCROutputFormat),
    )
  ) {
    throw new OcrRecognitionNodeError(
      400,
      `'artifact.outputFormats' must only contain supported formats: ${OCR_OUTPUT_FORMATS.join(", ")}.`,
    );
  }

  return [...new Set(formats as OCROutputFormat[])];
}

function buildFallbackRecognition(name: string): OCRRecognitionResult {
  return {
    text: "",
    fragments: [],
    pages: [{ page: 1, text: "" }],
    rawResponse: `fallback:${name}`,
  };
}

function flattenPages(results: Array<{ recognition: OCRRecognitionResult }>): OCRPageResult[] {
  return results.flatMap(result => result.recognition.pages);
}

function flattenFragments(
  results: Array<{ recognition: OCRRecognitionResult }>,
): OCRTextFragment[] {
  return results.flatMap(result => result.recognition.fragments);
}

function buildCombinedText(results: Array<{ recognition: OCRRecognitionResult }>): string {
  return results
    .map(result => result.recognition.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildContext(
  input: OcrRecognitionNodeInput,
  results: Array<{ name: string; recognition: OCRRecognitionResult }>,
  artifact:
    | {
        outputId: string;
        artifacts: PersistedVisionOutput["artifacts"];
      }
    | undefined,
): Record<string, unknown> {
  const baseContext = normalizeObject(input.context);

  return {
    ...baseContext,
    ocrRecognition: {
      text: buildCombinedText(results),
      results: results.map(result => ({
        name: result.name,
        text: result.recognition.text,
        fragments: result.recognition.fragments,
        pages: result.recognition.pages,
      })),
      ...(artifact
        ? {
            artifact: {
              outputId: artifact.outputId,
              artifacts: artifact.artifacts,
            },
          }
        : {}),
    },
  };
}

export function isOcrRecognitionNodeType(
  value: unknown,
): value is OcrRecognitionNodeType {
  return value === "ocr_recognition";
}

export async function executeOcrRecognitionNode(
  request: OcrRecognitionNodeExecutionRequest,
  deps: OcrRecognitionNodeAdapterDeps = {},
): Promise<OcrRecognitionNodeExecutionResult> {
  if (!isOcrRecognitionNodeType(request.nodeType)) {
    throw new OcrRecognitionNodeError(
      400,
      "Unsupported ocr_recognition node type.",
    );
  }

  const input = request.input ?? {};
  const images = normalizeImages(input.images);
  const prompt = normalizeString(input.prompt);
  const artifactInput = normalizeObject(input.artifact);
  const persistOutput =
    artifactInput.persistOutput === undefined
      ? true
      : Boolean(artifactInput.persistOutput);
  const outputId = normalizeString(artifactInput.outputId);
  const outputFormats = normalizeOutputFormats(artifactInput.outputFormats);
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const recognizeImages = deps.recognizeImages ?? recognizeImagesText;

  let resultMap: Map<string, OCRRecognitionResult>;
  try {
    resultMap = await recognizeImages(images, prompt);
  } catch (error) {
    throw new OcrRecognitionNodeError(
      500,
      `OCR recognition failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const results = images.map(image => ({
    name: image.name,
    recognition: resultMap.get(image.name) ?? buildFallbackRecognition(image.name),
  }));
  const warnings = images
    .filter(image => !resultMap.has(image.name))
    .map(image => `OCR provider returned no result for ${image.name}; fallback payload was used.`);

  let artifact:
    | {
        outputId: string;
        artifacts: PersistedVisionOutput["artifacts"];
      }
    | undefined;

  if (persistOutput) {
    try {
      const persistArtifacts = deps.persistArtifacts ?? writeOCRArtifacts;
      const persisted = await persistArtifacts(results, {
        ...(outputId ? { outputId } : {}),
        ...(outputFormats ? { formats: outputFormats } : {}),
      });
      artifact = {
        outputId: persisted.outputId,
        artifacts: persisted.artifacts,
      };
    } catch (error) {
      throw new OcrRecognitionNodeError(
        500,
        `OCR artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const latencyMs = Math.max(0, now() - startedAt);
  const pages = flattenPages(results);
  const fragments = flattenFragments(results);

  return {
    ok: true,
    nodeType: "ocr_recognition",
    output: {
      status: "completed",
      text: buildCombinedText(results),
      results: results.map(result => ({
        name: result.name,
        recognition: result.recognition,
        pageCount: result.recognition.pages.length,
        fragmentCount: result.recognition.fragments.length,
      })),
      pages,
      fragments,
      ...(artifact
        ? {
            artifact: {
              outputId: artifact.outputId,
              artifacts: artifact.artifacts,
              requestedFormats: outputFormats ?? ["json", "txt"],
            },
          }
        : {}),
      context: buildContext(input, results, artifact),
      observability: {
        eventKey: "multimodal.ocr_recognition",
        nodeType: "ocr_recognition",
        imageCount: images.length,
        totalPageCount: pages.length,
        totalFragmentCount: fragments.length,
        artifactPersisted: Boolean(artifact),
        latencyMs,
      },
      warnings,
    },
  };
}
