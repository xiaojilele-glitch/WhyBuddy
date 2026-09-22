import { once } from "node:events";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createPreviewService } from "./service";
import { startPreviewTunnelAgent } from "./tunnel-agent";
import { TUNNEL_CONTROL_PATH, TUNNEL_PROTOCOL } from "./contracts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const gatewayKey = "gateway-" + "k".repeat(40);
const ticket = "t".repeat(43), browserToken = "b".repeat(43), tunnelToken = "n".repeat(43);
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
function send(origin: string, path = "/", headers: IncomingHttpHeaders = {}, method = "GET") {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(origin + path, { method, headers }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; }); res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }); req.on("error", reject); req.end();
  });
}
function nonRoundTripExpiry(): number {
  const start = Date.now() / 1000 + 60;
  for (let i = 0; i < 10000; i++) {
    const value = start + i / 1_000_000;
    if (value * 1000 / 1000 !== value) return value;
  }
  throw new Error("expiry_fixture_not_found");
}
const canonical = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

// The authority is a real HTTP peer implementing the Python route wire shape.
// In particular it checks expiry EXACTLY as Python dict equality does, and
// reorders keys: a JSON.stringify comparison or seconds roundtrip must fail.
async function fixture(options: { precision?: boolean; denyRole?: "browser" | "tunnel" | "binding" } = {}) {
  const observed: IncomingHttpHeaders[] = [];
  const app = createServer((req, res) => { observed.push(req.headers); res.end(JSON.stringify(req.headers)); });
  const appWs = new WebSocketServer({ noServer: true });
  app.on("upgrade", (req, socket, head) => {
    observed.push(req.headers);
    appWs.handleUpgrade(req, socket, head, ws => { ws.on("error", () => {}); ws.on("message", value => ws.send(value)); });
  });
  const appPort = await listen(app);
  cleanup.push(async () => { for (const ws of appWs.clients) ws.terminate(); appWs.close(); await stop(app); });
  let audience = ""; let unavailable = false; let redeemed = false;
  const expiry = options.precision ? nonRoundTripExpiry() : Math.floor(Date.now() / 1000) + 60;
  const binding = (kind: string) => ({ ownerId: "owner", sessionId: "session", projectId: "project", operationId: "operation",
    workspaceId: "workspace", runtimeId: "runtime", revision: "revision", generation: 1, port: appPort,
    audience, grantId: kind + "-grant", tunnelId: "tunnel-id", expiresAt: expiry });
  const calls: Array<{ path: string; body: Record<string, unknown>; authorization?: string }> = [];
  const authority = createServer(async (req, res) => {
    const bytes: Buffer[] = []; for await (const chunk of req) bytes.push(chunk);
    const body = JSON.parse(Buffer.concat(bytes).toString());
    calls.push({ path: req.url!, body, authorization: req.headers.authorization });
    const deny = () => res.writeHead(403).end("{}");
    if (unavailable) return void res.writeHead(503).end("{}");
    if (req.headers.authorization !== "Bearer " + gatewayKey || body.audience !== audience) return void deny();
    if (req.url === "/authority/redeem") {
      if (body.ticket !== ticket || redeemed) return void deny();
      redeemed = true; res.end(JSON.stringify({ token: browserToken, binding: binding("browser") })); return;
    }
    if (req.url !== "/authority/authorize") return void deny();
    let scope;
    if (body.role === "browser" && body.token === browserToken) scope = binding("browser");
    else if (body.role === "tunnel" && body.token === tunnelToken) scope = binding("tunnel");
    else if (body.role === "binding") {
      scope = binding(body.binding?.grantId === "browser-grant" ? "browser" : "tunnel");
      if (canonical(body.binding ?? {}) !== canonical(scope)) return void deny();
    } else return void deny();
    res.end(JSON.stringify({ ok: options.denyRole !== body.role, binding: body.role === "binding"
      ? Object.fromEntries(Object.entries(scope).reverse()) : scope }));
  });
  const authorityPort = await listen(authority); cleanup.push(() => stop(authority));
  const service = createPreviewService({ authorityUrl: `http://127.0.0.1:${authorityPort}/authority`,
    gatewayKey, publicProtocol: "https:", workbenchOrigin: "https://workbench.example.test" });
  const port = await listen(service.server); const origin = `http://127.0.0.1:${port}`;
  audience = `https://127.0.0.1:${port}`; cleanup.push(() => service.close());
  async function agent() {
    const active = await startPreviewTunnelAgent({ relayOrigin: origin, localPort: appPort, token: tunnelToken,
      allowLoopbackInsecure: true, limits: { connectTimeoutMs: 1500 } });
    cleanup.push(() => active.close()); return active;
  }
  function socket(headers: IncomingHttpHeaders = {}) {
    const supplied = Object.fromEntries(Object.entries({ cookie: "__Host-WhyBuddyPreview=" + browserToken,
      origin: audience, ...headers }).filter(([, value]) => value !== undefined));
    const ws = new WebSocket(origin.replace("http:", "ws:") + "/hmr", {
      headers: supplied });
    ws.on("error", () => {}); cleanup.push(() => ws.terminate()); return ws;
  }
  return { service, agent, origin, audience, calls, observed, socket, binding,
    cookie: { cookie: "__Host-WhyBuddyPreview=" + browserToken }, unavailable: () => { unavailable = true; } };
}

it("serves a runtime-bound editor only after current browser authorization without passing credentials to code", async () => {
  const f = await fixture();
  const response = await send(f.origin, "/_whybuddy/editor.js", f.cookie);
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toContain("text/javascript");
  expect(response.body).toContain('"projectId":"project"');
  expect(response.body).toContain('"revision":"revision"');
  expect(response.body).toContain('"workbenchOrigin":"https://workbench.example.test"');
  expect(response.body).not.toContain(gatewayKey);
  expect(response.body).not.toContain(browserToken);
  expect(response.body).not.toContain("ownerId");
  expect(f.observed).toHaveLength(0);
  expect((await send(f.origin, "/_whybuddy/editor.js")).status).toBe(403);
  expect((await send(f.origin, "/_whybuddy/editor.js", { ...f.cookie, origin: "https://other.test" })).status).toBe(403);
  f.unavailable();
  expect((await send(f.origin, "/_whybuddy/editor.js", f.cookie)).status).toBe(403);
});

it("rejects invalid workbench origins before opening an editor transport", () => {
  for (const workbenchOrigin of ["https://example.test/path", "http://example.test", "https://name:pass@example.test", "null"]) {
    expect(() => createPreviewService({ authorityUrl: "http://127.0.0.1:1234/authority", gatewayKey,
      publicProtocol: "https:", workbenchOrigin })).toThrow();
  }
});

it("redeems one ticket into a bounded HttpOnly partitioned cookie and redirects to a clean URL", async () => {
  const f = await fixture();
  const res = await send(f.origin, "/_whybuddy/authorize?ticket=" + ticket);
  expect(res.status).toBe(303); expect(res.headers.location).toBe("/"); expect(res.body).toBe("");
  expect(res.headers["cache-control"]).toBe("no-store"); expect(res.headers["referrer-policy"]).toBe("no-referrer");
  const setCookie = res.headers["set-cookie"]?.[0] ?? "";
  expect(setCookie).toContain("__Host-WhyBuddyPreview=" + browserToken + "; Path=/; HttpOnly;");
  expect(setCookie).toContain("Secure; SameSite=None; Partitioned");
  expect(Number(/Max-Age=(\d+)/.exec(setCookie)?.[1])).toBeGreaterThan(0);
  expect(setCookie).not.toContain("Domain="); expect(setCookie).not.toContain(ticket);
  expect((await send(f.origin, "/_whybuddy/authorize?ticket=" + ticket)).status).toBe(403);
  expect(f.calls.every(call => call.authorization === "Bearer " + gatewayKey)).toBe(true);
});

it("protects health/status and prevents a management Authorization value entering app HTTP or WS", async () => {
  const f = await fixture(); await f.agent();
  for (const path of ["/_whybuddy/health", "/_whybuddy/status"]) {
    expect((await send(f.origin, path)).status).toBe(403);
    expect((await send(f.origin, path, { authorization: "Bearer " + tunnelToken })).status).toBe(403);
    expect((await send(f.origin, path, { authorization: "Bearer " + gatewayKey })).status).toBe(200);
  }
  const res = await send(f.origin, "/", { ...f.cookie, authorization: "Bearer " + gatewayKey });
  expect(res.status).toBe(200); expect(JSON.parse(res.body).authorization).toBeUndefined();
  const app = await send(f.origin, "/", { ...f.cookie, authorization: "Bearer app-secret" });
  expect(JSON.parse(app.body).authorization).toBe("Bearer app-secret");
  const ws = f.socket({ authorization: "Bearer " + gatewayKey }); await once(ws, "open");
  expect(f.observed.at(-1)?.authorization).toBeUndefined();
});

it("preserves Python expiry precision and accepts reordered wire keys through the complete tunnel", async () => {
  const f = await fixture({ precision: true }); await f.agent();
  const response = await send(f.origin, "/", f.cookie); expect(response.status).toBe(200);
  const checks = f.calls.filter(call => call.body.role === "binding"); expect(checks.length).toBeGreaterThan(0);
  for (const check of checks) {
    expect((check.body.binding as Record<string, unknown>).expiresAt).toBe(f.binding("browser").expiresAt);
    expect((check.body.binding as Record<string, unknown>).ownerId).toBe("owner");
    expect((check.body.binding as Record<string, unknown>).sessionId).toBe("session");
    expect(check.body.binding).not.toHaveProperty("role");
  }
});

it("rejects wrong hosts, origins, duplicate cookies and browser WebSockets without matching Origin", async () => {
  const f = await fixture(); await f.agent();
  expect((await send(f.origin, "/", { ...f.cookie, host: "another.preview.test" })).status).toBe(403);
  expect((await send(f.origin, "/", { ...f.cookie, origin: "https://evil.test" })).status).toBe(403);
  expect((await send(f.origin, "/", { cookie: f.cookie.cookie + "; " + f.cookie.cookie })).status).toBe(403);
  for (const headers of [{ origin: "https://evil.test" }, { origin: undefined }]) {
    const ws = f.socket(headers);
    const [, res] = await once(ws, "unexpected-response"); expect(res.statusCode).toBe(403); res.resume(); ws.terminate();
  }
  const tunnel = new WebSocket(f.origin.replace("http:", "ws:") + TUNNEL_CONTROL_PATH, TUNNEL_PROTOCOL,
    { headers: { authorization: "Bearer " + tunnelToken, origin: f.audience } });
  tunnel.on("error", () => {}); cleanup.push(() => tunnel.terminate());
  const [, res] = await once(tunnel, "unexpected-response"); expect(res.statusCode).toBe(403); res.resume(); tunnel.terminate();
  expect(f.observed).toHaveLength(0);
});

it.each(["tunnel", "browser", "binding"] as const)("fails closed when authority returns ok false for %s, even with a valid binding", async role => {
  const f = await fixture({ denyRole: role });
  if (role === "browser") {
    await f.agent(); expect((await send(f.origin, "/", f.cookie)).status).toBe(403);
  } else {
    await expect(f.agent()).rejects.toThrow(); expect(f.service.snapshot()).toEqual([]);
  }
  expect(f.observed).toEqual([]);
});

it("closes live HTTP/WS authority scopes when Python becomes unavailable", async () => {
  const f = await fixture(); const agent = await f.agent(); const ws = f.socket(); await once(ws, "open");
  const closed = once(ws, "close"); f.unavailable(); await closed;
  expect((await send(f.origin, "/", f.cookie)).status).toBe(403);
  expect(agent.closed).toBe(true);
});

it("rejects malformed bootstrap requests before redeeming any credential", async () => {
  const f = await fixture();
  for (const suffix of ["", "?ticket=short", `?ticket=${ticket}&ticket=${ticket}`, `?ticket=${ticket}&next=https://evil.test`])
    expect((await send(f.origin, "/_whybuddy/authorize" + suffix)).status).toBe(403);
  expect((await send(f.origin, "/_whybuddy/authorize?ticket=" + ticket, {}, "POST")).status).toBe(403);
  expect(f.calls).toHaveLength(0);
});
