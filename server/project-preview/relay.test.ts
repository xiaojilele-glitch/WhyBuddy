import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createPreviewRelay } from "./relay";
import { startPreviewTunnelAgent } from "./tunnel-agent";
import { TunnelStream } from "./tunnel-stream";
import { TUNNEL_CONTROL_PATH, TUNNEL_DATA_PATH, TUNNEL_PROTOCOL,
  type BrowserGrant, type PreviewBinding, type PreviewRelayLimits, type TunnelGrant } from "./contracts";

// These tests traverse real HTTP -> relay pipe -> outbound WS -> local app
// sockets. Stubbing the byte transport would hide the EOF and first-frame bugs
// that make a healthy dev server unusable through an otherwise authorized URL.
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function until(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("condition_timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function http(origin: string, path = "/headers", headers: IncomingHttpHeaders = {}, body?: Buffer) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request(new URL(path, origin), { method: body ? "POST" : "GET", headers }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
function browserWs(origin: string, cookie = "__Host-WhyBuddyPreview=browser", headers: IncomingHttpHeaders = {}) {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/hmr", "vite-hmr", { headers: { cookie, ...headers } });
  const messages: Array<{ data: Buffer; binary: boolean }> = [];
  ws.on("message", (data, binary) => messages.push({ data: Buffer.from(data as Buffer), binary }));
  ws.on("error", () => {});
  cleanup.push(() => ws.terminate());
  return { ws, messages };
}
async function refusedWs(url: string, token: string, protocol = TUNNEL_PROTOCOL): Promise<number> {
  const ws = new WebSocket(url, protocol, { headers: { authorization: `Bearer ${token}` } });
  cleanup.push(() => ws.terminate());
  return new Promise((resolve, reject) => {
    ws.on("error", () => {});
    ws.on("open", () => reject(new Error("unexpected_upgrade")));
    ws.on("unexpected-response", (_req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode!); });
  });
}
async function fixture(limits: Partial<PreviewRelayLimits> = {}) {
  const observed: IncomingHttpHeaders[] = [];
  let streamEnded = false;
  const app = createServer((req, res) => {
    observed.push(req.headers);
    if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      req.on("close", () => { streamEnded = true; });
      return;
    }
    if (req.url === "/body") {
      const hash = createHash("sha256"); let length = 0;
      req.on("data", chunk => { hash.update(chunk); length += chunk.length; });
      req.on("end", () => res.end(JSON.stringify({ hash: hash.digest("hex"), length })));
      return;
    }
    res.setHeader("Set-Cookie", ["app_session=updated; Path=/", "__Host-WhyBuddyPreview=stolen; Path=/; Secure"]);
    res.setHeader("E2B-Traffic-Access-Token", "upstream-must-not-expose");
    res.end(JSON.stringify(req.headers));
  });
  const appWs = new WebSocketServer({ noServer: true });
  app.on("upgrade", (req, socket, head) => {
    observed.push(req.headers);
    appWs.handleUpgrade(req, socket, head, ws => {
      ws.send("first-server-frame");
      ws.on("message", (data, binary) => ws.send(data, { binary }));
      ws.on("error", () => {});
    });
  });
  const port = await listen(app);
  cleanup.push(async () => {
    for (const client of appWs.clients) client.terminate();
    appWs.close(); app.closeAllConnections();
    await new Promise<void>(resolve => app.close(() => resolve()));
  });
  const binding: PreviewBinding = { grantId: "base", audience: "https://runtime.preview.test",
    tunnelId: "tunnel-id", projectId: "project", operationId: "operation", workspaceId: "workspace",
    runtimeId: "runtime", revision: "revision", generation: 1, port, expiresAt: Date.now() + 60_000 };
  const tunnel: TunnelGrant = { ...binding, grantId: "tunnel-grant", role: "tunnel" };
  const browser: BrowserGrant = { ...binding, grantId: "browser-grant", role: "browser" };
  const tokens = new Map<string, TunnelGrant>([["tunnel", tunnel]]);
  const browsers = new Map<string, BrowserGrant>([["browser", browser]]);
  const invalid = new Set<string>(); let authorityDown = false;
  const relay = createPreviewRelay({
    authorizeTunnel: async req => tokens.get(String(req.headers.authorization).replace(/^Bearer /, "")) ?? null,
    authorizeBrowser: async req => {
      const token = /(?:^|;\s*)__Host-WhyBuddyPreview=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      return browsers.get(token ?? "") ?? null;
    },
    validateBinding: async grant => {
      if (authorityDown) throw new Error("authority_unavailable");
      return !invalid.has(grant.grantId);
    },
    beforeRequest: async (req, res) => {
      if (req.url !== "/_whybuddy/health") return false;
      res.writeHead(200).end("health"); return true;
    },
    limits: { connectTimeoutMs: 500, idleTimeoutMs: 5_000, validateIntervalMs: 30, ...limits },
  });
  const relayPort = await listen(relay.server);
  cleanup.push(() => relay.close());
  const origin = `http://127.0.0.1:${relayPort}`;
  async function agent(token = "tunnel") {
    const instance = await startPreviewTunnelAgent({ relayOrigin: origin, localPort: port, token,
      allowLoopbackInsecure: true, limits: { connectTimeoutMs: 500, idleTimeoutMs: 5_000, ...limits } });
    cleanup.push(() => instance.close()); return instance;
  }
  const tunnelAgent = await agent();
  return { app, appWs, observed, binding, tunnel, browser, tokens, browsers, invalid, relay,
    origin, port, agent, tunnelAgent, streamEnded: () => streamEnded,
    authorityDown: () => { authorityDown = true; }, cookie: { cookie: "__Host-WhyBuddyPreview=browser" } };
}

describe("private preview outbound tunnel", () => {
  it("streams large request bodies and preserves app cookies/auth without forwarding gateway credentials", async () => {
    const f = await fixture();
    const payload = randomBytes(2 * 1024 * 1024 + 317);
    const result = await http(f.origin, "/body", f.cookie, payload);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString())).toEqual({ hash: createHash("sha256").update(payload).digest("hex"), length: payload.length });
    const response = await http(f.origin, "/headers", { cookie: f.cookie.cookie + "; app_session=value",
      authorization: "Bearer app-credential", "E2B-Traffic-Access-Token": "provider-secret",
      "x-whybuddy-authority": "authority-secret", "x-internal-key": "internal-secret",
      connection: "close, x-hop-secret", "x-hop-secret": "connection-secret", "x-forwarded-host": "evil.test",
      "x-forwarded-proto": "http", forwarded: "proto=http;host=evil.test" });
    const headers = JSON.parse(response.body.toString());
    expect(headers.cookie).toBe("app_session=value");
    expect(headers.authorization).toBe("Bearer app-credential");
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers.forwarded).toBeUndefined();
    for (const key of ["e2b-traffic-access-token", "x-whybuddy-authority", "x-internal-key", "x-hop-secret", "x-forwarded-host"])
      expect(headers[key]).toBeUndefined();
    expect(response.headers["set-cookie"]).toEqual(["app_session=updated; Path=/"]);
    expect(response.headers["e2b-traffic-access-token"]).toBeUndefined();
    await until(() => f.relay.snapshot()[0].streams === 0);
  });

  it("rewrites the iframe Host to loopback so sandbox Vite does not block sslip", async () => {
    const f = await fixture();
    const iframeHost = "rt-pop-c95a3c8fe4dc4c818361260f3d722777.preview.156.239.47.108.sslip.io";
    const response = await http(f.origin, "/headers", { cookie: f.cookie.cookie, host: iframeHost });
    expect(response.status).toBe(200);
    const headers = JSON.parse(response.body.toString());
    expect(headers.host).toBe("127.0.0.1");
    expect(headers.host).not.toBe(iframeHost);
    await until(() => f.relay.snapshot()[0].streams === 0);
  });

  it("allows health handling before auth and rejects anonymous, role-confused and mismatched resources", async () => {
    const f = await fixture();
    expect((await http(f.origin, "/_whybuddy/health")).body.toString()).toBe("health");
    expect((await http(f.origin)).status).toBe(403);
    expect((await http(f.origin, "/headers", { cookie: "__Host-WhyBuddyPreview=tunnel" })).status).toBe(403);
    expect((await http(f.origin, "/_whybuddy/tunnel/control", f.cookie)).status).toBe(404);
    for (const field of ["runtimeId", "projectId", "workspaceId", "operationId", "revision", "tunnelId", "audience"] as const) {
      f.browsers.set("wrong", { ...f.browser, [field]: "wrong" });
      expect((await http(f.origin, "/headers", { cookie: "__Host-WhyBuddyPreview=wrong" })).status).toBe(403);
    }
    f.browsers.set("old", { ...f.browser, generation: 2 });
    expect((await http(f.origin, "/headers", { cookie: "__Host-WhyBuddyPreview=old" })).status).toBe(403);
    expect(f.observed).toHaveLength(0);
    expect(await refusedWs(f.origin.replace("http:", "ws:") + TUNNEL_CONTROL_PATH, "browser")).toBe(403);
    expect(await refusedWs(f.origin.replace("http:", "ws:") + TUNNEL_DATA_PATH + "?streamId=fake&controlId=fake", "tunnel")).toBe(403);
  });

  it("forwards WebSocket 101, first frame, text/binary and app headers through the same private path", async () => {
    const f = await fixture();
    const client = browserWs(f.origin, f.cookie.cookie + "; app_session=ws", {
      authorization: "Bearer app-ws", "e2b-traffic-access-token": "leak", "x-internal-key": "leak",
      "x-forwarded-proto": "http" });
    await once(client.ws, "open");
    expect(client.ws.protocol).toBe("vite-hmr");
    await until(() => client.messages.length === 1);
    expect(client.messages[0].data.toString()).toBe("first-server-frame");
    client.ws.send("hmr-update"); const binary = randomBytes(128 * 1024 + 7); client.ws.send(binary);
    await until(() => client.messages.length === 3);
    expect(client.messages[1]).toEqual({ data: Buffer.from("hmr-update"), binary: false });
    expect(client.messages[2]).toEqual({ data: binary, binary: true });
    expect(f.observed[0].cookie).toBe("app_session=ws");
    expect(f.observed[0].authorization).toBe("Bearer app-ws");
    expect(f.observed[0]["x-forwarded-proto"]).toBe("https");
    expect(f.observed[0]["e2b-traffic-access-token"]).toBeUndefined();
    expect(f.observed[0]["x-internal-key"]).toBeUndefined();
    client.ws.close(); await once(client.ws, "close");
    await until(() => f.relay.snapshot()[0].streams === 0);
  });

  it("preserves the first client frame sent in the HTTP upgrade packet", async () => {
    const f = await fixture();
    const socket = createConnection({ host: "127.0.0.1", port: Number(new URL(f.origin).port) });
    cleanup.push(() => socket.destroy()); socket.on("error", () => {});
    await once(socket, "connect");
    const payload = Buffer.from("client-first-frame"); const mask = Buffer.from([19, 27, 3, 91]);
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask,
      Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))]);
    const chunks: Buffer[] = []; socket.on("data", chunk => chunks.push(chunk));
    const upgrade = `GET /hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Protocol: vite-hmr\r\nCookie: ${f.cookie.cookie}\r\n\r\n`;
    socket.write(Buffer.concat([Buffer.from(upgrade), frame]));
    await until(() => Buffer.concat(chunks).includes(payload));
    expect(Buffer.concat(chunks).toString()).toContain("101 Switching Protocols");
    expect(Buffer.concat(chunks).toString()).toContain("first-server-frame");
  });

  it("binds pending data streams to their control and consumes a stream only once", async () => {
    const f = await fixture();
    const origin = f.origin.replace("http:", "ws:");
    const control = new WebSocket(origin + TUNNEL_CONTROL_PATH, TUNNEL_PROTOCOL,
      { headers: { authorization: "Bearer tunnel" } });
    control.on("error", () => {}); cleanup.push(() => control.terminate());
    const ready = JSON.parse((await once(control, "message"))[0].toString());
    const opening = once(control, "message");
    const response = http(f.origin, "/headers", f.cookie);
    // A failing auth assertion still tears down this in-flight HTTP request.
    // Keep that cleanup rejection handled; the awaited result below still fails.
    void response.catch(() => {});
    const { streamId } = JSON.parse((await opening)[0].toString());
    const path = `${origin}${TUNNEL_DATA_PATH}?streamId=${streamId}&controlId=${ready.controlId}`;
    expect(await refusedWs(path.replace(ready.controlId, "stale-control"), "tunnel")).toBe(403);
    f.tokens.set("wrong", { ...f.tunnel, tunnelId: "other-tunnel" });
    expect(await refusedWs(path, "wrong")).toBe(403);
    expect(f.relay.snapshot()[0].pending).toBe(1);
    const data = new WebSocket(path, TUNNEL_PROTOCOL, { headers: { authorization: "Bearer tunnel" } });
    data.on("error", () => {}); cleanup.push(() => data.terminate());
    await once(data, "open");
    const stream = new TunnelStream(data, 64 * 1024, 128 * 1024);
    stream.on("error", () => {}); stream.resume();
    expect(await refusedWs(path, "tunnel")).toBe(403);
    stream.end("HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nisolated");
    expect((await response).body.toString()).toBe("isolated");
  });

  it("delivers SSE before completion and aborting the browser closes the app stream", async () => {
    const f = await fixture();
    const first = await new Promise<string>((resolve, reject) => {
      const req = request(new URL("/stream", f.origin), { headers: f.cookie }, res => {
        res.once("data", chunk => { resolve(chunk.toString()); req.destroy(); });
      });
      req.on("error", error => { if (!req.destroyed) reject(error); }); req.end();
    });
    expect(first).toBe("data: first\n\n");
    await until(f.streamEnded);
    await until(() => f.relay.snapshot()[0].streams === 0);
  });

  it("revokes one live browser grant without closing another grant on the same runtime", async () => {
    const f = await fixture();
    f.browsers.set("second", { ...f.browser, grantId: "second-browser" });
    const first = browserWs(f.origin); const second = browserWs(f.origin, "__Host-WhyBuddyPreview=second");
    await Promise.all([once(first.ws, "open"), once(second.ws, "open")]);
    const closed = once(first.ws, "close"); f.invalid.add(f.browser.grantId); await closed;
    second.ws.send("still-authorized");
    await until(() => second.messages.some(message => message.data.toString() === "still-authorized"));
    expect(f.relay.snapshot()).toHaveLength(1);
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(403);
  });

  it("expires live browser streams and strips Authorization when it authenticated the gateway", async () => {
    const f = await fixture();
    f.browsers.set("browser", { ...f.browser, expiresAt: Date.now() + 250, authorizationIsGatewayCredential: true });
    const response = await http(f.origin, "/headers", { ...f.cookie, authorization: "Bearer gateway" });
    expect(JSON.parse(response.body.toString()).authorization).toBeUndefined();
    const client = browserWs(f.origin); await once(client.ws, "open"); await once(client.ws, "close");
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(403);
  });

  it("fences old generations and stale close handlers when replacing a control", async () => {
    const f = await fixture();
    const client = browserWs(f.origin); await once(client.ws, "open");
    const closed = once(client.ws, "close");
    const replacement = await f.agent(); await closed;
    await until(() => f.tunnelAgent.closed);
    expect(f.relay.snapshot()[0].controlId).toBe(replacement.controlId);
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(200);
    f.tokens.set("new", { ...f.tunnel, generation: 2, grantId: "new-tunnel" });
    f.browsers.set("browser", { ...f.browser, generation: 2 });
    const next = await f.agent("new");
    expect(f.relay.snapshot()[0].controlId).toBe(next.controlId);
    await expect(f.agent()).rejects.toThrow();
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(200);
    f.relay.revoke(f.binding.runtimeId, 2);
    await until(() => next.closed);
    await expect(f.agent("new")).rejects.toThrow();
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(403);
  });

  it("closes active transport if authority becomes unavailable", async () => {
    const f = await fixture(); const client = browserWs(f.origin); await once(client.ws, "open");
    const closed = once(client.ws, "close"); f.authorityDown(); await closed;
    await until(() => f.tunnelAgent.closed);
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(403);
  });

  it("limits concurrent streams and releases them after the tunnel agent stops", async () => {
    const f = await fixture({ maxStreams: 1 }); const client = browserWs(f.origin); await once(client.ws, "open");
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(502);
    const closed = once(client.ws, "close"); f.tunnelAgent.close(); await closed;
    await until(() => f.relay.snapshot().length === 0);
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(403);
  });

  it("reports a dead local app as unavailable and releases the pending socket", async () => {
    const f = await fixture({ connectTimeoutMs: 100 });
    await new Promise<void>(resolve => f.app.close(() => resolve()));
    expect((await http(f.origin, "/headers", f.cookie)).status).toBe(502);
    await until(() => f.relay.snapshot()[0].streams === 0 && f.relay.snapshot()[0].pending === 0);
  });

  it("reaps idle browser streams while retaining a healthy control connection", async () => {
    const f = await fixture({ idleTimeoutMs: 100 });
    const client = browserWs(f.origin); await once(client.ws, "open"); await once(client.ws, "close");
    expect(f.relay.snapshot()).toHaveLength(1);
    await until(() => f.relay.snapshot()[0].streams === 0);
  });
});

it("retains the reverse byte stream after one direction sends TCP FIN", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", perMessageDeflate: false });
  await once(server, "listening");
  cleanup.push(async () => {
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const accepted = once(server, "connection");
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
  cleanup.push(() => ws.terminate());
  const [peer] = await accepted as [WebSocket]; await once(ws, "open");
  const upstream = new TunnelStream(peer, 16 * 1024, 32 * 1024);
  const downstream = new TunnelStream(ws, 16 * 1024, 32 * 1024);
  const payload = randomBytes(1024 * 1024 + 79);
  const received: Buffer[] = [];
  const errors: Error[] = [];
  upstream.on("error", error => errors.push(error)); downstream.on("error", error => errors.push(error));
  const eof = once(upstream, "end"); upstream.resume(); downstream.end("request"); await eof;
  // The response starts only AFTER the peer has received EOF. A full WS close
  // in _final (the stock ws stream behavior) loses this entire response.
  const complete = once(downstream, "end"); upstream.end(payload);
  // Let the unread side reach its high-water mark before consuming, exercising
  // pause/resume instead of only a fast reader that never applies backpressure.
  await new Promise(resolve => setTimeout(resolve, 75));
  downstream.on("data", data => received.push(data)); await complete;
  expect(Buffer.concat(received)).toEqual(payload); expect(errors).toEqual([]);
});
