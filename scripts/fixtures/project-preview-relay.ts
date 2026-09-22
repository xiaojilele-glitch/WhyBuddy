/** Cloud smoke fixture. The production service/transport are real; the authority
 * below is deliberately a test identity registry, not the Python durable store.
 * Every endpoint, including fixture mutation, requires its separate gateway key.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createPreviewService } from "../../server/project-preview/service";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
let enabled = true;
let generation = 1;
let port = 5187;
let ticket = config.ticket;
let consumed = false;
let tunnelToken = config.tunnelToken;
let browserToken = config.browserToken;
const base = config.binding;
function scope(role: string) {
  return { ...base, generation, port, tunnelId: `binding-${generation}`,
    grantId: `${role}-${generation}`, expiresAt: config.expiresAt };
}
const authority = createServer(async (request, response) => {
  const reply = (status: number, body: object) => {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== "Bearer " + config.gatewayKey || request.method !== "POST") {
    reply(403, { error: "denied" }); return;
  }
  try {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16384) throw new Error();
    }
    const data = JSON.parse(body);
    if (request.url === "/control") {
      if (data.action === "revoke") enabled = false;
      else if (data.action === "rotate") {
        enabled = true; generation += 1; port = data.port;
        ticket = data.ticket; consumed = false;
        tunnelToken = data.tunnelToken; browserToken = data.browserToken;
      } else if (data.action === "ticket") { ticket = data.ticket; consumed = false; }
      else throw new Error();
      reply(200, { ok: true, generation }); return;
    }
    if (!enabled || data.audience !== base.audience || Date.now() / 1000 >= config.expiresAt) throw new Error();
    if (request.url === "/redeem") {
      if (consumed || data.ticket !== ticket) throw new Error();
      consumed = true;
      reply(200, { token: browserToken, binding: scope("browser") }); return;
    }
    if (request.url !== "/authorize") throw new Error();
    if (data.role === "browser" && data.token === browserToken) {
      reply(200, { ok: true, binding: scope("browser") }); return;
    }
    if (data.role === "tunnel" && data.token === tunnelToken) {
      reply(200, { ok: true, binding: scope("tunnel") }); return;
    }
    if (data.role === "binding") {
      const role = String(data.binding?.grantId).split("-", 1)[0];
      const expected = scope(role);
      if (!["browser", "tunnel"].includes(role) || Object.keys(data.binding).length !== Object.keys(expected).length ||
          Object.entries(expected).some(([key, value]) => data.binding[key] !== value)) throw new Error();
      reply(200, { ok: true, binding: expected }); return;
    }
    throw new Error();
  } catch { reply(403, { error: "denied" }); }
});
authority.listen(5191, "0.0.0.0", () => {
  const relay = createPreviewService({ authorityUrl: "http://127.0.0.1:5191", gatewayKey: config.gatewayKey,
    publicProtocol: "https:" });
  relay.server.listen(5190, "0.0.0.0");
  const close = async () => { await relay.close(); authority.close(); };
  process.once("SIGTERM", () => { void close(); });
  process.once("SIGINT", () => { void close(); });
});
