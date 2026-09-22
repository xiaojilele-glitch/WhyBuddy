/** Isolated preview HTTP service; Python owns credentials and runtime authority.
 *
 * Source references: OpenSandbox ingress credential stripping, ws noServer
 * authorization, and frp replacement fencing. See docs/WhyBuddy 工程重构参考源码索引.md.
 * This process never holds E2B API/traffic tokens. Its authority key stays here;
 * the application receives only its narrowly scoped tunnel capability.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createPreviewRelay } from "./relay";
import { validBinding, type PreviewBinding, type TunnelGrant, type BrowserGrant } from "./contracts";
import { installPreviewSelectionBridge } from "../../shared/project-preview-selection.mjs";

export interface PreviewServiceConfig {
  authorityUrl: string;
  gatewayKey: string;
  publicProtocol: "https:" | "http:";
  workbenchOrigin?: string;
  fetch?: typeof globalThis.fetch;
}

const WIRE_EXPIRY: unique symbol = Symbol("preview_wire_expiry");
type Scope = PreviewBinding & { ownerId: string; sessionId: string; [WIRE_EXPIRY]: number };
const HTTPS_COOKIE = "__Host-WhyBuddyPreview";
const LOCAL_COOKIE = "WhyBuddyPreview";
const safeToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

function secretMatches(actual: string | undefined, expected: string) {
  const a = Buffer.from(actual ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookie(request: IncomingMessage, name: string): string | null {
  const values = (request.headers.cookie ?? "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return safeToken(value) ? value : null;
}

function respond(response: ServerResponse, status: number, value: object) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

function requestAudience(request: IncomingMessage, protocol: "https:" | "http:") {
  const host = request.headers.host;
  if (!host || !/^[a-zA-Z0-9.\[\]:-]{1,253}$/.test(host)) throw new Error("preview_host_invalid");
  const url = new URL(protocol + "//" + host);
  if (protocol === "http:" && !(url.hostname === "localhost" || url.hostname.endsWith(".localhost")
      || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) {
    throw new Error("preview_https_required");
  }
  return url.origin;
}

function scopeFromWire(value: unknown, audience: string): Scope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("preview_scope_invalid");
  const wire = value as Record<string, unknown>;
  if (typeof wire.expiresAt !== "number" || !Number.isFinite(wire.expiresAt)) throw new Error("preview_scope_invalid");
  // Python compares the exact issued float on revalidation. Multiplying by
  // 1000 then dividing can move one ULP; retain the original wire seconds.
  // An enumerable symbol survives relay object spreads but never enters JSON.
  const binding = { ...wire, expiresAt: wire.expiresAt * 1000, [WIRE_EXPIRY]: wire.expiresAt } as unknown as Scope;
  if (!validBinding(binding) || wire.audience !== audience ||
      ![wire.ownerId, wire.sessionId, wire.grantId, wire.tunnelId].every(
        item => typeof item === "string" && item.length > 0 && item.length <= 256)) {
    throw new Error("preview_scope_invalid");
  }
  return binding;
}

function scopeToWire(binding: PreviewBinding) {
  const { role: _role, authorizationIsGatewayCredential: _auth, [WIRE_EXPIRY]: wireExpiry, ...value } = binding as
    PreviewBinding & Partial<Scope> & { role?: string; authorizationIsGatewayCredential?: boolean };
  return { ...value, expiresAt: wireExpiry !== undefined && wireExpiry * 1000 === binding.expiresAt
    ? wireExpiry : binding.expiresAt / 1000 };
}

export function createPreviewService(config: PreviewServiceConfig) {
  const authority = new URL(config.authorityUrl);
  if (authority.username || authority.password || authority.search || authority.hash ||
      !["http:", "https:"].includes(authority.protocol) || config.gatewayKey.length < 32 ||
      /[\r\n]/.test(config.gatewayKey) || !["http:", "https:"].includes(config.publicProtocol)) {
    throw new Error("preview_service_config_invalid");
  }
  if (authority.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(authority.hostname)) {
    throw new Error("preview_authority_https_required");
  }
  if (config.workbenchOrigin) {
    const workbench = new URL(config.workbenchOrigin);
    if (workbench.origin !== config.workbenchOrigin || !["https:", "http:"].includes(workbench.protocol) ||
        (workbench.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(workbench.hostname))) {
      throw new Error("preview_workbench_origin_invalid");
    }
  }
  const fetcher = config.fetch ?? globalThis.fetch;
  const cookieName = config.publicProtocol === "https:" ? HTTPS_COOKIE : LOCAL_COOKIE;
  async function call(path: string, body: object): Promise<Record<string, unknown>> {
    const response = await fetcher(config.authorityUrl.replace(/\/$/, "") + path, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.gatewayKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("preview_authority_denied"); }
    // Authority responses are small. Bound even a damaged/misconfigured peer.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("preview_authority_empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) throw new Error("preview_authority_response_too_large");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const relay = createPreviewRelay({
    gatewayCookieNames: [HTTPS_COOKIE, LOCAL_COOKIE],
    async authorizeTunnel(request): Promise<TunnelGrant | null> {
      try {
        const audience = requestAudience(request, config.publicProtocol);
        // Tunnel clients are server processes, not browser JavaScript.
        if (request.headers.origin !== undefined) return null;
        const header = request.headers.authorization;
        if (!header?.startsWith("Bearer ") || !safeToken(header.slice(7))) return null;
        const result = await call("/authorize", { role: "tunnel", token: header.slice(7), audience });
        if (result.ok !== true) return null;
        return { ...scopeFromWire(result.binding, audience), role: "tunnel" } as TunnelGrant;
      } catch { return null; }
    },
    async authorizeBrowser(request): Promise<BrowserGrant | null> {
      try {
        const audience = requestAudience(request, config.publicProtocol);
        if (request.headers.origin && request.headers.origin !== audience) return null;
        if (request.headers.upgrade && request.headers.origin !== audience) return null;
        const token = cookie(request, cookieName);
        if (!token) return null;
        const result = await call("/authorize", { role: "browser", token, audience });
        if (result.ok !== true) return null;
        return { ...scopeFromWire(result.binding, audience), role: "browser",
          authorizationIsGatewayCredential: secretMatches(request.headers.authorization, "Bearer " + config.gatewayKey) } as BrowserGrant;
      } catch { return null; }
    },
    async validateBinding(binding) {
      try {
        const audience = (binding as Scope & { audience: string }).audience;
        const result = await call("/authorize", { role: "binding", binding: scopeToWire(binding), audience });
        if (result.ok !== true) return false;
        const checked = scopeToWire(scopeFromWire(result.binding, audience));
        const expected = scopeToWire(binding);
        return Object.keys(checked).length === Object.keys(expected).length &&
          Object.entries(checked).every(([key, value]) => value === (expected as Record<string, unknown>)[key]);
      } catch { return false; }
    },
    async beforeRequest(request, response) {
      const path = request.url?.split("?", 1)[0];
      if (path === "/_whybuddy/editor.js") {
        try {
          if (request.method !== "GET") throw new Error("preview_method_invalid");
          const audience = requestAudience(request, config.publicProtocol);
          if (request.headers.origin && request.headers.origin !== audience) throw new Error("preview_origin_denied");
          const token = cookie(request, cookieName);
          if (!token) throw new Error("preview_access_denied");
          const result = await call("/authorize", { role: "browser", token, audience });
          if (result.ok !== true) throw new Error("preview_access_denied");
          const scope = scopeFromWire(result.binding, audience);
          const identity = { workbenchOrigin: config.workbenchOrigin,
            projectId: scope.projectId, runtimeId: scope.runtimeId, revision: scope.revision };
          response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
          response.end(config.workbenchOrigin
            ? `(${installPreviewSelectionBridge.toString()})(${JSON.stringify(identity)});`
            : "// Preview selection requires a configured workbench origin.\n");
        } catch { respond(response, 403, { error: "preview_access_denied" }); }
        return true;
      }
      if (path === "/_whybuddy/health" || path === "/_whybuddy/status") {
        if (!secretMatches(request.headers.authorization, "Bearer " + config.gatewayKey)) {
          respond(response, 403, { error: "preview_access_denied" });
        } else if (request.method !== "GET") {
          respond(response, 405, { error: "preview_method_invalid" });
        } else { respond(response, 200, path === "/_whybuddy/health" ? { ok: true } : { connections: relay.snapshot() }); }
        return true;
      }
      if (path !== "/_whybuddy/authorize") return false;
      try {
        if (request.method !== "GET") throw new Error("preview_method_invalid");
        const audience = requestAudience(request, config.publicProtocol);
        const url = new URL(request.url!, audience);
        const values = url.searchParams.getAll("ticket");
        if (values.length !== 1 || !safeToken(values[0]) || [...url.searchParams.keys()].length !== 1) {
          throw new Error("preview_ticket_invalid");
        }
        const result = await call("/redeem", { ticket: values[0], audience });
        const scope = scopeFromWire(result.binding, audience);
        if (!safeToken(result.token)) throw new Error("preview_grant_invalid");
        const maxAge = Math.min(900, Math.floor((scope.expiresAt - Date.now()) / 1000));
        if (maxAge < 1) throw new Error("preview_grant_expired");
        const attributes = config.publicProtocol === "https:"
          ? "; Secure; SameSite=None; Partitioned" : "; SameSite=Lax";
        response.writeHead(303, { Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
          "Set-Cookie": `${cookieName}=${result.token}; Path=/; HttpOnly; Max-Age=${maxAge}${attributes}` });
        response.end();
      } catch { respond(response, 403, { error: "preview_ticket_expired_or_denied" }); }
      return true;
    },
  });
  return relay;
}
