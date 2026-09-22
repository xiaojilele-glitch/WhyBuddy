import type { IncomingMessage, ServerResponse } from "node:http";

/** Server-owned identity. expiresAt is Unix epoch milliseconds, never a duration. */
export interface PreviewBinding {
  grantId: string;
  audience: string;
  tunnelId: string;
  projectId: string;
  operationId: string;
  workspaceId: string;
  runtimeId: string;
  revision: string;
  generation: number;
  port: number;
  expiresAt: number;
}

export interface TunnelGrant extends PreviewBinding {
  role: "tunnel";
}

export interface BrowserGrant extends PreviewBinding {
  role: "browser";
  /** True only when Authorization authenticated the gateway, not the app. */
  authorizationIsGatewayCredential?: boolean;
}

export interface PreviewRelayLimits {
  maxStreams: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  validateIntervalMs: number;
  maxFrameBytes: number;
  highWaterMark: number;
}

export interface PreviewRelayOptions {
  authorizeTunnel(request: IncomingMessage): Promise<TunnelGrant | null>;
  authorizeBrowser(request: IncomingMessage): Promise<BrowserGrant | null>;
  validateBinding(binding: PreviewBinding): Promise<boolean>;
  beforeRequest?(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  gatewayCookieNames?: string[];
  limits?: Partial<PreviewRelayLimits>;
}

export const TUNNEL_CONTROL_PATH = "/_whybuddy/tunnel/control";
export const TUNNEL_DATA_PATH = "/_whybuddy/tunnel/data";
export const TUNNEL_PROTOCOL = "whybuddy-tunnel-v1";

export const DEFAULT_LIMITS: PreviewRelayLimits = {
  maxStreams: 16,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 60_000,
  validateIntervalMs: 1_000,
  maxFrameBytes: 64 * 1024,
  highWaterMark: 128 * 1024,
};

export function sameBinding(a: PreviewBinding, b: PreviewBinding): boolean {
  return a.projectId === b.projectId && a.runtimeId === b.runtimeId &&
    a.operationId === b.operationId && a.workspaceId === b.workspaceId && a.port === b.port &&
    a.audience === b.audience && a.tunnelId === b.tunnelId &&
    a.revision === b.revision && a.generation === b.generation;
}

export function validBinding(binding: PreviewBinding, now = Date.now()): boolean {
  return !!binding && [binding.grantId, binding.audience, binding.tunnelId, binding.projectId,
    binding.operationId, binding.workspaceId, binding.runtimeId, binding.revision]
    .every(value => typeof value === "string" && value.length > 0 && value.length <= 256) &&
    Number.isSafeInteger(binding.generation) && binding.generation > 0 &&
    Number.isSafeInteger(binding.port) && binding.port >= 1024 && binding.port <= 65535 &&
    Number.isFinite(binding.expiresAt) && binding.expiresAt > now;
}
