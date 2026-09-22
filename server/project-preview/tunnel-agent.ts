import { createConnection, type Socket } from "node:net";
import WebSocket from "ws";
import { DEFAULT_LIMITS, TUNNEL_CONTROL_PATH, TUNNEL_DATA_PATH, TUNNEL_PROTOCOL,
  type PreviewRelayLimits } from "./contracts";
import { bridgeTunnel } from "./tunnel-stream";

export interface PreviewTunnelAgentOptions {
  relayOrigin: string;
  token: string;
  localPort: number;
  limits?: Partial<PreviewRelayLimits>;
  /** Explicit local smoke only; remote origins always require wss. */
  allowLoopbackInsecure?: boolean;
}

/**
 * This process is untrusted like the generated app beside it. Its only secret
 * grants serving ONE runtime generation; it has no E2B or gateway admin token.
 * The provider supervises/restarts it explicitly; it never refreshes credentials.
 */
export async function startPreviewTunnelAgent(options: PreviewTunnelAgentOptions) {
  const origin = new URL(options.relayOrigin);
  if (origin.username || origin.password || origin.search || origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "") || !options.token ||
    !Number.isInteger(options.localPort) || options.localPort < 1024 || options.localPort > 65535) {
    throw new Error("invalid_tunnel_agent_options");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (!["https:", "wss:"].includes(origin.protocol) &&
    !(loopback && options.allowLoopbackInsecure && ["http:", "ws:"].includes(origin.protocol))) {
    throw new Error("tunnel_requires_wss");
  }
  origin.protocol = ["https:", "wss:"].includes(origin.protocol) ? "wss:" : "ws:";
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const headers = { authorization: `Bearer ${options.token}` };
  const control = new WebSocket(new URL(TUNNEL_CONTROL_PATH, origin), TUNNEL_PROTOCOL,
    { headers, maxPayload: limits.maxFrameBytes, perMessageDeflate: false,
      handshakeTimeout: limits.connectTimeoutMs });
  const sockets = new Set<Socket>();
  const streams = new Set<WebSocket>();
  let controlId = "";
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const stream of streams) stream.terminate();
    for (const socket of sockets) socket.destroy();
    control.terminate();
  };
  control.on("close", close);
  control.on("error", close);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { close(); reject(new Error("tunnel_control_timeout")); }, limits.connectTimeoutMs);
    control.once("close", () => { clearTimeout(timeout); reject(new Error("tunnel_control_closed")); });
    control.once("error", () => { clearTimeout(timeout); reject(new Error("tunnel_control_failed")); });
    control.on("message", (raw, binary) => {
      let message: { type?: string; protocol?: string; controlId?: string; streamId?: string };
      try { if (binary) throw new Error(); message = JSON.parse(raw.toString()); }
      catch { close(); return; }
      if (message.type === "ready" && !controlId && message.protocol === TUNNEL_PROTOCOL && message.controlId) {
        controlId = message.controlId;
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (message.type !== "open" || !controlId || !message.streamId ||
        !/^[a-f0-9-]{36}$/.test(message.streamId) || sockets.size >= limits.maxStreams) {
        close(); return;
      }
      const socket = createConnection({ host: "127.0.0.1", port: options.localPort, allowHalfOpen: true });
      sockets.add(socket);
      socket.pause();
      socket.on("error", () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
      socket.setTimeout(limits.connectTimeoutMs, () => socket.destroy());
      socket.once("connect", () => {
        if (closed) return void socket.destroy();
        const url = new URL(TUNNEL_DATA_PATH, origin);
        url.searchParams.set("streamId", message.streamId!);
        url.searchParams.set("controlId", controlId);
        const ws = new WebSocket(url, TUNNEL_PROTOCOL, { headers,
          maxPayload: limits.maxFrameBytes, perMessageDeflate: false,
          handshakeTimeout: limits.connectTimeoutMs });
        streams.add(ws);
        ws.on("error", () => socket.destroy());
        ws.on("close", () => { streams.delete(ws); socket.destroy(); });
        socket.on("close", () => ws.terminate());
        ws.once("open", () => {
          if (socket.destroyed || closed) return ws.terminate();
          bridgeTunnel(socket, ws, limits);
        });
      });
    });
  });
  return { controlId, close, get closed() { return closed; } };
}
