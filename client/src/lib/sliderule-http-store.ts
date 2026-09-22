import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { SlideRuleSessionStore } from "./sliderule-runtime";

/**
 * HttpSlideRuleSessionStore — productionization adapter skeleton.
 *
 * Implements the shared SlideRuleSessionStore contract over HTTP.
 * Talks to the 4 endpoints the user specified:
 *   GET    /api/sliderule/sessions
 *   GET    /api/sliderule/sessions/:sessionId
 *   PUT    /api/sliderule/sessions/:sessionId
 *   DELETE /api/sliderule/sessions/:sessionId
 *
 * Default base is relative "/api/sliderule" so that:
 * - In browser (with vite proxy or full server) it just works.
 * - In tests / pure in-mem usage we never instantiate this unless explicitly asked.
 *
 * Node server routes (server/routes/sliderule.ts) are thin compatibility proxy only.
 * Python FastAPI owns durable V5.2 state, sanitization, replay, and execute-capability/orchestrate semantics.
 *
 * Dev startup: Vite (npm run dev) + Python backend (9700) is the clear Python API path.
 * Http store is frontend contract consumer / thin proxy target selector; Node backend only explicit compat.
 *
 * Usage (when you want to opt into remote/persistent for a demo):
 *   import { HttpSlideRuleSessionStore } from "@/lib/sliderule-http-store";
 *   import { setSlideRuleSessionStore } from "@/lib/sliderule-runtime";
 *   setSlideRuleSessionStore(new HttpSlideRuleSessionStore());
 *
 * All load/save in the runtime + page are now async, so callers await.
 */
export class HttpSlideRuleSessionStore implements SlideRuleSessionStore {
  private readonly base: string;

  constructor(baseUrl = "/api/sliderule") {
    // normalize: ensure no trailing slash before we append /sessions...
    this.base = baseUrl.replace(/\/$/, "");
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  private isSessionState(data: unknown): data is V5SessionState {
    return Boolean(
      data &&
        typeof data === "object" &&
        typeof (data as { sessionId?: unknown }).sessionId === "string" &&
        "graph" in data
    );
  }

  private normalizeState(state: V5SessionState): V5SessionState {
    return {
      ...state,
      artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
      conversation: Array.isArray(state.conversation) ? state.conversation : [],
      openQuestions: Array.isArray(state.openQuestions) ? state.openQuestions : [],
      evidence: Array.isArray(state.evidence) ? state.evidence : [],
      decisions: Array.isArray(state.decisions) ? state.decisions : [],
      risks: Array.isArray(state.risks) ? state.risks : [],
      capabilityRuns: Array.isArray(state.capabilityRuns) ? state.capabilityRuns : [],
      gates: Array.isArray(state.gates) ? state.gates : [],
      dependencyGraph: Array.isArray(state.dependencyGraph) ? state.dependencyGraph : [],
      staleArtifactIds: Array.isArray(state.staleArtifactIds) ? state.staleArtifactIds : [],
      coverageGaps: Array.isArray(state.coverageGaps) ? state.coverageGaps : [],
      graph: {
        ...state.graph,
        nodes: Array.isArray(state.graph?.nodes) ? state.graph.nodes : [],
        edges: Array.isArray(state.graph?.edges) ? state.graph.edges : [],
      },
    };
  }

  private unwrapStateEnvelope(data: unknown): V5SessionState | undefined {
    if (data && typeof data === "object" && "state" in data) {
      const state = (data as { state?: unknown }).state;
      return this.isSessionState(state) ? this.normalizeState(state) : undefined;
    }
    return this.isSessionState(data) ? this.normalizeState(data) : undefined;
  }

  private isLegacyUntrustedArtifactRejection(status: number, text: string): boolean {
    return (
      status === 422 &&
      text.includes("trustLevel") &&
      text.includes("untrusted")
    );
  }

  async load(sessionId: string): Promise<V5SessionState | undefined> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}`), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpSlideRuleSessionStore.load failed: ${res.status} ${text}`);
    }
    return this.unwrapStateEnvelope(await res.json());
  }

  async save(state: V5SessionState): Promise<V5SessionState> {
    const sid = state.sessionId || "sliderule-local-proto";
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sid)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "include",
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (this.isLegacyUntrustedArtifactRejection(res.status, text)) {
        return state;
      }
      throw new Error(`HttpSlideRuleSessionStore.save failed: ${res.status} ${text}`);
    }
    const data = await res.json().catch(() => null);
    return this.unwrapStateEnvelope(data) ?? state;
  }

  async listSessions(): Promise<Array<{
    sessionId: string;
    goal: string;
    createdAt?: string;
    lastActive?: string;
    artifactCount: number;
    phase?: string;
  }>> {
    const res = await fetch(this.url(`/sessions`), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpSlideRuleSessionStore.listSessions failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    // Accept both { sessions: [...] } and raw array shapes for flexibility
    return (data && data.sessions ? data.sessions : data) || [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpSlideRuleSessionStore.deleteSession failed: ${res.status} ${text}`);
    }
  }
}

/**
 * Convenience factory (matches the "createHttp..." naming users expect for adapters).
 */
export function createHttpSlideRuleSessionStore(baseUrl?: string): SlideRuleSessionStore {
  return new HttpSlideRuleSessionStore(baseUrl);
}

export default HttpSlideRuleSessionStore;
