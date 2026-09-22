import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest,
  type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { DEFAULT_LIMITS, TUNNEL_CONTROL_PATH, TUNNEL_DATA_PATH, TUNNEL_PROTOCOL,
  sameBinding, validBinding, type BrowserGrant, type PreviewBinding,
  type PreviewRelayOptions, type TunnelGrant } from "./contracts";
import { bridgeTunnel } from "./tunnel-stream";

type Pending = { socket: Socket; timeout: ReturnType<typeof setTimeout> };
type Control = {
  id: string;
  grant: TunnelGrant;
  ws: WebSocket;
  listener: NetServer;
  socketPath: string;
  sockets: Set<Socket>;
  data: Set<WebSocket>;
  pending: Map<string, Pending>;
  closed: boolean;
  validating: boolean;
};

const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const PRIVATE_HEADERS = new Set(["x-internal-key", "x-api-key", "x-session-api-key",
  "opensandbox-secure-access", "opensandbox-api-key"]);
const DEFAULT_GATEWAY_COOKIES = ["__Host-WhyBuddyPreview", "whybuddy_preview",
  "whybuddy_session", "sliderule_session"];

function privateHeader(name: string): boolean {
  return PRIVATE_HEADERS.has(name) || name.startsWith("e2b-") || name.startsWith("x-e2b-") ||
    name.startsWith("x-whybuddy-") || name === "forwarded" || name.startsWith("x-forwarded-");
}

function filteredHeaders(headers: IncomingHttpHeaders, cookies: Set<string>, response = false,
  stripAuthorization = false): IncomingHttpHeaders {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection ?? "").split(",")) blocked.add(name.trim().toLowerCase());
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (blocked.has(name) || privateHeader(name) || value === undefined ||
      (name === "authorization" && stripAuthorization)) continue;
    if (!response && name === "cookie") {
      const kept = String(value).split(";").map(part => part.trim())
        .filter(part => part.includes("=") && !cookies.has(part.slice(0, part.indexOf("="))));
      if (kept.length) result.cookie = kept.join("; ");
    } else if (response && name === "set-cookie") {
      const kept = (Array.isArray(value) ? value : [value]).filter(cookie =>
        !cookies.has(cookie.slice(0, cookie.indexOf("=")).trim()));
      if (kept.length) result["set-cookie"] = kept;
    } else result[name] = value;
  }
  return result;
}

function refuse(socket: Socket, code = 403): void {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function requestPath(request: IncomingMessage): string | null {
  const path = request.url ?? "/";
  // A caller may select a path, never a proxy target or an absolute request URI.
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : null;
}

/**
 * Transport-only relay. Python callbacks own authentication and current binding.
 * frp/server/control.go inspired current-control fencing; OpenSandbox ingress
 * inspired authenticate-before-routing and credential removal on BOTH HTTP/WS.
 * Control/data credentials are accepted only on reserved tunnel endpoints.
 * Raw upstream sockets are OS-local pipes, never publicly exposed relay ports.
 */
export function createPreviewRelay(options: PreviewRelayOptions) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid_relay_limits");
  }
  const cookies = new Set([...DEFAULT_GATEWAY_COOKIES, ...(options.gatewayCookieNames ?? [])]);
  const controls = new Map<string, Control>();
  const revoked = new Map<string, number>();
  const seenGeneration = new Map<string, number>();
  const acceptedSockets = new Set<Socket>();
  const browserAccess = new Set<{ grant: BrowserGrant; close(): void; validating: boolean }>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes,
    perMessageDeflate: false, handleProtocols: protocols =>
      protocols.has(TUNNEL_PROTOCOL) ? TUNNEL_PROTOCOL : false });
  let stopping = false;

  function current(control: Control): boolean {
    return !stopping && !control.closed && controls.get(control.grant.runtimeId) === control &&
      validBinding(control.grant) && control.grant.generation > (revoked.get(control.grant.runtimeId) ?? 0);
  }

  function closeControl(control: Control): void {
    if (control.closed) return;
    control.closed = true;
    // An old close callback must not remove the replacement's registration.
    if (controls.get(control.grant.runtimeId) === control) controls.delete(control.grant.runtimeId);
    for (const pending of control.pending.values()) clearTimeout(pending.timeout);
    control.pending.clear();
    for (const socket of control.sockets) socket.destroy();
    for (const ws of control.data) ws.terminate();
    control.ws.terminate();
    if (control.listener.listening) control.listener.close();
  }

  async function validate(binding: PreviewBinding): Promise<boolean> {
    try { return validBinding(binding) && await options.validateBinding(binding) && validBinding(binding); }
    catch { return false; }
  }

  function trackBrowser(grant: BrowserGrant, close: () => void, onClose: (done: () => void) => void): void {
    const access = { grant, close, validating: false };
    browserAccess.add(access);
    const expire = setTimeout(close, Math.min(2_147_483_647, Math.max(1, grant.expiresAt - Date.now())));
    expire.unref();
    onClose(() => { browserAccess.delete(access); clearTimeout(expire); });
  }

  function acceptUpstream(control: Control, socket: Socket): void {
    socket.on("error", () => {});
    if (!current(control) || control.sockets.size >= limits.maxStreams) return void socket.destroy();
    socket.pause();
    control.sockets.add(socket);
    const streamId = randomUUID();
    const timeout = setTimeout(() => {
      control.pending.delete(streamId);
      socket.destroy();
    }, limits.connectTimeoutMs);
    control.pending.set(streamId, { socket, timeout });
    socket.on("close", () => {
      clearTimeout(timeout);
      control.pending.delete(streamId);
      control.sockets.delete(socket);
    });
    control.ws.send(JSON.stringify({ type: "open", streamId }), error => {
      if (error) socket.destroy();
    });
  }

  async function openControl(request: IncomingMessage, socket: Socket, head: Buffer,
    grant: TunnelGrant): Promise<void> {
    if (!grant.tunnelId || grant.role !== "tunnel" || !await validate(grant) || stopping ||
      grant.generation <= (revoked.get(grant.runtimeId) ?? 0) ||
      grant.generation < (seenGeneration.get(grant.runtimeId) ?? 0)) return refuse(socket);
    const id = randomUUID();
    const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\whybuddy-preview-${id}` :
      join(tmpdir(), `wb-preview-${id}.sock`);
    const listener = createNetServer({ allowHalfOpen: true });
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(socketPath, () => { listener.removeListener("error", reject); resolve(); });
    });
    listener.on("error", () => {});
    if (socket.destroyed || stopping || !validBinding(grant) ||
      grant.generation <= (revoked.get(grant.runtimeId) ?? 0) ||
      grant.generation < (seenGeneration.get(grant.runtimeId) ?? 0)) {
      listener.close();
      return refuse(socket);
    }
    let upgraded = false;
    wss.handleUpgrade(request, socket, head, ws => {
      upgraded = true;
      const previous = controls.get(grant.runtimeId);
      if (previous) closeControl(previous);
      const control: Control = { id, grant: { ...grant }, ws, listener, socketPath,
        sockets: new Set(), data: new Set(), pending: new Map(), closed: false, validating: false };
      controls.set(grant.runtimeId, control);
      seenGeneration.set(grant.runtimeId, grant.generation);
      listener.on("connection", peer => acceptUpstream(control, peer));
      ws.on("close", () => closeControl(control));
      ws.on("error", () => closeControl(control));
      // Agents cannot issue upstream commands or register their own targets.
      ws.on("message", () => closeControl(control));
      ws.send(JSON.stringify({ type: "ready", protocol: TUNNEL_PROTOCOL, controlId: id }));
    });
    // A rejected upgrade never entered the callback and must release the pipe.
    if (!upgraded && listener.listening) listener.close();
  }

  async function openData(request: IncomingMessage, socket: Socket, head: Buffer,
    grant: TunnelGrant): Promise<void> {
    const url = new URL(request.url!, "http://relay.invalid");
    const control = controls.get(grant.runtimeId);
    const streamId = url.searchParams.get("streamId") ?? "";
    const controlId = url.searchParams.get("controlId");
    if (!control || !current(control) || !sameBinding(control.grant, grant) ||
      control.grant.tunnelId !== grant.tunnelId || grant.role !== "tunnel" ||
      controlId !== control.id || !await validate(grant) || !current(control)) return refuse(socket);
    const pending = control.pending.get(streamId);
    if (!pending || pending.socket.destroyed) return refuse(socket);
    // Consume once after the asynchronous authority check and current-control recheck.
    wss.handleUpgrade(request, socket, head, ws => {
      control.pending.delete(streamId);
      clearTimeout(pending.timeout);
      control.data.add(ws);
      ws.on("close", () => control.data.delete(ws));
      bridgeTunnel(pending.socket, ws, limits);
    });
  }

  async function browserControl(request: IncomingMessage): Promise<{ control: Control; grant: BrowserGrant } | null> {
    let grant: BrowserGrant | null;
    try { grant = await options.authorizeBrowser(request); } catch { return null; }
    if (!grant || grant.role !== "browser" || !await validate(grant)) return null;
    const control = controls.get(grant.runtimeId);
    return control && current(control) && sameBinding(control.grant, grant) ? { control, grant } : null;
  }

  async function serveHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (options.beforeRequest && await options.beforeRequest(request, response)) return;
    const path = requestPath(request);
    if (!path || path.startsWith("/_whybuddy/")) {
      response.writeHead(404).end(); return;
    }
    const authorized = await browserControl(request);
    if (!authorized || request.destroyed || response.destroyed) {
      response.writeHead(403).end(); return;
    }
    const { control, grant } = authorized;
    trackBrowser(grant, () => response.destroy(), done => response.once("close", done));
    const upstream = httpRequest({ socketPath: control.socketPath, path,
      method: request.method, agent: false,
      headers: { ...filteredHeaders(request.headers, cookies, false, grant.authorizationIsGatewayCredential),
        // TLS terminates at the preview gateway. The app needs the authenticated
        // public scheme to issue iframe cookies; browser forwarded headers are stripped.
        "x-forwarded-proto": new URL(grant.audience).protocol.slice(0, -1),
        // 2026-09-18：iframe Host 是 `{runtimeId}.preview….sslip.io`。沙箱
        // Vite 7 默认只放行 localhost；Agent 写的 server.mjs 又不接
        // allowedHosts。网关已经按票选好了隧道，转给应用时改成 loopback，
        // Vite 不再回 Blocked request。不要写成 allowedHosts:true。
        host: "127.0.0.1" } });
    upstream.setTimeout(limits.idleTimeoutMs, () => upstream.destroy());
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) response.writeHead(502).end();
    });
    upstream.on("response", incoming => {
      response.writeHead(incoming.statusCode ?? 502, filteredHeaders(incoming.headers, cookies, true));
      incoming.on("error", () => response.destroy());
      incoming.pipe(response);
    });
    request.pipe(upstream);
  }

  async function serveUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    socket.on("error", () => {});
    const path = requestPath(request);
    if (!path) return refuse(socket, 400);
    const pathname = new URL(path, "http://relay.invalid").pathname;
    if (pathname === TUNNEL_CONTROL_PATH || pathname === TUNNEL_DATA_PATH) {
      let grant: TunnelGrant | null;
      try { grant = await options.authorizeTunnel(request); } catch { grant = null; }
      if (!grant || !validBinding(grant) || grant.role !== "tunnel" ||
        request.headers["sec-websocket-protocol"] !== TUNNEL_PROTOCOL) return refuse(socket);
      if (pathname === TUNNEL_CONTROL_PATH) await openControl(request, socket, head, grant);
      else await openData(request, socket, head, grant);
      return;
    }
    if (pathname.startsWith("/_whybuddy/")) return refuse(socket, 404);
    const authorized = await browserControl(request);
    if (!authorized || socket.destroyed) return refuse(socket);
    const { control, grant } = authorized;
    trackBrowser(grant, () => socket.destroy(), done => socket.once("close", done));
    const headers = filteredHeaders(request.headers, cookies, false, grant.authorizationIsGatewayCredential);
    headers["x-forwarded-proto"] = new URL(grant.audience).protocol.slice(0, -1);
    headers.host = "127.0.0.1";
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
    const upstream = httpRequest({ socketPath: control.socketPath, path, method: "GET", headers, agent: false });
    const timeout = setTimeout(() => upstream.destroy(), limits.connectTimeoutMs);
    socket.on("close", () => { clearTimeout(timeout); upstream.destroy(); });
    upstream.on("error", () => { clearTimeout(timeout); refuse(socket, 502); });
    upstream.on("response", response => {
      clearTimeout(timeout);
      response.resume();
      refuse(socket, response.statusCode && response.statusCode >= 400 ? response.statusCode : 502);
    });
    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      clearTimeout(timeout);
      if (!current(control) || !validBinding(grant) || socket.destroyed) {
        upstreamSocket.destroy(); socket.destroy(); return;
      }
      const responseHeaders = filteredHeaders(response.headers, cookies, true);
      responseHeaders.connection = "Upgrade";
      responseHeaders.upgrade = "websocket";
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      for (const [name, value] of Object.entries(responseHeaders)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) lines.push(`${name}: ${item}`);
        }
      }
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.end();
  }

  const server = createHttpServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void serveHttp(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) response.writeHead(503).end();
      else response.destroy();
    });
  });
  server.on("connection", socket => {
    acceptedSockets.add(socket);
    socket.on("close", () => acceptedSockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    void serveUpgrade(request, socket as Socket, head).catch(() => refuse(socket as Socket, 503));
  });
  const timer = setInterval(() => {
    for (const control of controls.values()) {
      if (!current(control)) { closeControl(control); continue; }
      if (control.validating) continue;
      control.validating = true;
      void validate(control.grant).then(valid => {
        if (!valid) closeControl(control);
      }).finally(() => { control.validating = false; });
    }
    for (const access of browserAccess) {
      if (access.validating) continue;
      access.validating = true;
      void validate(access.grant).then(valid => { if (!valid) access.close(); })
        .finally(() => { access.validating = false; });
    }
  }, limits.validateIntervalMs);
  timer.unref();

  return {
    server,
    revoke(runtimeId: string, generation: number): void {
      if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid_generation");
      revoked.set(runtimeId, Math.max(generation, revoked.get(runtimeId) ?? 0));
      const control = controls.get(runtimeId);
      if (control && control.grant.generation <= generation) closeControl(control);
    },
    snapshot() {
      return [...controls.values()].map(control => ({ runtimeId: control.grant.runtimeId,
        generation: control.grant.generation, controlId: control.id,
        streams: control.sockets.size, pending: control.pending.size }));
    },
    async close(): Promise<void> {
      stopping = true;
      clearInterval(timer);
      for (const control of [...controls.values()]) closeControl(control);
      for (const socket of acceptedSockets) socket.destroy();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
