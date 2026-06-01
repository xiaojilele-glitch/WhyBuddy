import type {
  WebSearchMode,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResultItem,
} from "../../../shared/web-search.js";

export type WebSearchNodeType = "web_search";

export interface WebSearchNodeInput {
  query?: string;
  options?: {
    topK?: number;
    mode?: WebSearchMode;
  };
}

export interface WebSearchNodeExecutionRequest {
  nodeType: WebSearchNodeType;
  input?: WebSearchNodeInput;
}

export interface WebSearchNodeExecutionResult {
  ok: true;
  nodeType: WebSearchNodeType;
  output: WebSearchResponse & {
    result: WebSearchResponse;
    citations: string[];
    summaries: string[];
    observability: {
      eventKey: "external.web_search";
      nodeType: WebSearchNodeType;
      query: string;
      mode: WebSearchMode;
      latencyMs: number;
      totalCandidates: number;
    };
  };
}

export interface WebSearchNodeAdapterDeps {
  executeWebSearch?: (request: WebSearchRequest) => Promise<WebSearchResponse>;
  now?: () => number;
}

const DEFAULT_WEB_SEARCH_RESULTS: WebSearchResultItem[] = [
  {
    title: "WhyBuddy Web Search Mock Overview",
    url: "https://example.test/web-search/cube-overview",
    snippet:
      "Cube Web Search mock result describing how search output can feed web QA and static webpage reading nodes.",
    source: "mock-search-index",
  },
  {
    title: "Web QA Integration Notes",
    url: "https://example.test/web-search/web-qa-integration",
    snippet:
      "Guidance for linking web_search output into downstream QA, summary, and page reading workflows.",
    source: "mock-search-index",
  },
  {
    title: "Static Webpage Read Companion",
    url: "https://example.test/web-search/static-webpage-read",
    snippet:
      "A mock page showing the expected handoff from search results to webpage content extraction.",
    source: "mock-search-index",
  },
];

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeMode(value: unknown): WebSearchMode | undefined {
  if (value === "mock" || value === "hybrid") {
    return value;
  }

  return undefined;
}

function normalizeTopK(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(10, Math.floor(value)));
}

function buildWebSearchRequest(input: WebSearchNodeInput | undefined): WebSearchRequest {
  const query = normalizeString(input?.query);
  if (!query) {
    throw new Error("Web search node input requires query.");
  }

  const topK = normalizeTopK(input?.options?.topK);
  const mode = normalizeMode(input?.options?.mode) ?? "mock";

  return {
    query,
    options: {
      ...(typeof topK === "number" ? { topK } : {}),
      mode,
    },
  };
}

function buildMockWebSearchResponse(
  request: WebSearchRequest,
  latencyMs: number,
): WebSearchResponse {
  const topK = request.options?.topK ?? 3;
  const loweredQuery = request.query.toLowerCase();
  const matched = DEFAULT_WEB_SEARCH_RESULTS.filter((result) => {
    const haystack = `${result.title}\n${result.snippet}\n${result.source}`.toLowerCase();
    return loweredQuery
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });
  const ranked = (matched.length > 0 ? matched : DEFAULT_WEB_SEARCH_RESULTS).slice(0, topK);

  return {
    query: request.query,
    results: ranked,
    totalCandidates: ranked.length,
    latencyMs,
    mode: request.options?.mode ?? "mock",
  };
}

function buildCitations(results: WebSearchResultItem[]): string[] {
  return results.map((result) => `${result.title} - ${result.url}`);
}

function buildSummaries(results: WebSearchResultItem[]): string[] {
  return results.map(
    (result, index) => `${index + 1}. ${result.title}: ${result.snippet}`,
  );
}

export function isWebSearchNodeType(value: unknown): value is WebSearchNodeType {
  return value === "web_search";
}

export async function executeWebSearchNode(
  request: WebSearchNodeExecutionRequest,
  deps: WebSearchNodeAdapterDeps = {},
): Promise<WebSearchNodeExecutionResult> {
  if (!isWebSearchNodeType(request.nodeType)) {
    throw new Error("Unsupported web search node type.");
  }

  const normalizedRequest = buildWebSearchRequest(request.input);
  const now = deps.now ?? Date.now;
  const startedAt = now();

  let result: WebSearchResponse;
  try {
    if (deps.executeWebSearch) {
      result = await deps.executeWebSearch(normalizedRequest);
    } else {
      result = buildMockWebSearchResponse(normalizedRequest, Math.max(0, now() - startedAt));
    }
  } catch (error) {
    throw new Error(
      `Web search node failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const latencyMs =
    typeof result.latencyMs === "number" && Number.isFinite(result.latencyMs)
      ? result.latencyMs
      : Math.max(0, now() - startedAt);
  const normalizedMode = normalizeMode(result.mode) ?? normalizedRequest.options?.mode ?? "mock";
  const normalizedResult: WebSearchResponse = {
    ...result,
    query: result.query || normalizedRequest.query,
    latencyMs,
    mode: normalizedMode,
    results: Array.isArray(result.results) ? result.results : [],
    totalCandidates:
      typeof result.totalCandidates === "number" && Number.isFinite(result.totalCandidates)
        ? result.totalCandidates
        : Array.isArray(result.results)
          ? result.results.length
          : 0,
  };
  const citations = buildCitations(normalizedResult.results);
  const summaries = buildSummaries(normalizedResult.results);

  return {
    ok: true,
    nodeType: "web_search",
    output: {
      ...normalizedResult,
      result: normalizedResult,
      citations,
      summaries,
      observability: {
        eventKey: "external.web_search",
        nodeType: "web_search",
        query: normalizedResult.query,
        mode: normalizedResult.mode,
        latencyMs: normalizedResult.latencyMs,
        totalCandidates: normalizedResult.totalCandidates,
      },
    },
  };
}
