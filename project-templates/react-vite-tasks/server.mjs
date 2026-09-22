import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase, appError, DATA_SCHEMA_VERSION } from "./database.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MAX_BODY = 16384;
// Worker sets __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS to the relay Host
// (and E2B published host when present). createViteServer must pass it
// through: Vite CLI merges the env, middleware mode still needs the option.
function viteAllowedHosts() {
  return String(process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean);
}
async function body(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) throw appError(415, "需要JSON请求");
  if (request.headers["sec-fetch-site"] === "cross-site") throw appError(403, "不允许跨站写入");
  let text = "";
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > MAX_BODY) throw appError(413, "请求过大"); }
  try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(); return value; }
  catch { throw appError(400, "请求格式无效"); }
}
function sessionToken(request) { return (request.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith("WhyBuddyTaskSession="))?.slice(20); }
// Cloud smoke 2026-09-13: SameSite=Strict let iframe setup succeed but omitted
// the cookie from its next API call. The private gateway derives HTTPS from
// its authorized audience after stripping caller-supplied forwarding headers.
const cookie = (token, request) => `WhyBuddyTaskSession=${token}; Path=/; HttpOnly; Max-Age=${token ? 43200 : 0}${request.headers["x-forwarded-proto"] === "https" ? "; Secure; SameSite=None; Partitioned" : "; SameSite=Lax"}`;

export async function startApplication({ host = "127.0.0.1", port = 5173, dev = false,
    dataDir = process.env.WHYBUDDY_APP_DATA_DIR || resolve(ROOT, "../.whybuddy-application"), staticDir = resolve(ROOT, "dist") } = {}) {
  const database = await openDatabase(dataDir);
  let vite;
  const server = createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url, "http://application.internal");
      if (url.pathname.startsWith("/api/")) {
        const token = sessionToken(request), user = database.user(token);
        if (url.pathname === "/api/health" && request.method === "GET") return send(200, { ok: true, dataSchemaVersion: DATA_SCHEMA_VERSION });
        if (url.pathname === "/api/auth/session" && request.method === "GET") return send(200, { user, setupRequired: database.setupRequired() });
        if (["/api/auth/setup", "/api/auth/login"].includes(url.pathname) && request.method === "POST") {
          const input = await body(request);
          if (url.pathname.endsWith("setup")) database.setup(input.username, input.password);
          const result = database.login(input.username, input.password);
          response.setHeader("Set-Cookie", cookie(result.token, request));
          return send(200, { user: result.user });
        }
        if (!user) throw appError(401, "请先登录");
        if (url.pathname === "/api/auth/logout" && request.method === "POST") {
          await body(request); database.logout(token); response.setHeader("Set-Cookie", cookie("", request)); return send(200, { ok: true });
        }
        if (url.pathname === "/api/tasks" && request.method === "GET") return send(200, { tasks: database.tasks(url.searchParams.get("status") || "all", url.searchParams.get("q") || "") });
        if (request.method === "POST" || request.method === "PATCH") {
          if (user.role !== "writer") throw appError(403, "只读成员不能修改数据");
          const input = await body(request);
          if (url.pathname === "/api/users" && request.method === "POST") return send(201, { user: database.createReader(input.username, input.password) });
          if (url.pathname === "/api/tasks" && request.method === "POST") return send(201, { task: database.saveTask(null, input.title, input.status || "open") });
          const match = /^\/api\/tasks\/([0-9a-f-]{36})$/.exec(url.pathname);
          if (match && request.method === "PATCH") return send(200, { task: database.saveTask(match[1], input.title, input.status) });
        }
        throw appError(404, "接口不存在");
      }
      if (vite) return vite.middlewares(request, response, () => { response.writeHead(404); response.end(); });
      if (!["GET", "HEAD"].includes(request.method)) throw appError(405, "不支持的请求方法");
      const decoded = decodeURIComponent(url.pathname);
      let file = resolve(staticDir, "." + decoded);
      if (file !== resolve(staticDir) && !file.startsWith(resolve(staticDir) + sep)) throw appError(403, "无权访问文件");
      try { if (!(await stat(file)).isFile()) file = resolve(staticDir, "index.html"); }
      catch { if (extname(file)) throw appError(404, "文件不存在"); file = resolve(staticDir, "index.html"); }
      const content = await readFile(file);
      const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" }[extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) { send(error.status || 500, { error: error.code || "服务暂时不可用，请重试" }); }
  });
  try {
    if (dev) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({ root: ROOT, server: { middlewareMode: true, hmr: { server }, allowedHosts: viteAllowedHosts() }, appType: "spa" });
    }
    await new Promise((yes, no) => { server.once("error", no); server.listen(port, host, yes); });
  } catch (error) { await vite?.close(); database.close(); throw error; }
  return { server, database, async close() {
    await vite?.close(); server.closeAllConnections();
    await new Promise((yes, no) => server.close(error => error ? no(error) : yes())); database.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === "--dev") options.dev = true;
    else if (key === "--strictPort") continue;
    else if (["--host", "--port", "--static-dir", "--data-dir"].includes(key)) {
      const value = process.argv[++index];
      if (!value) throw Error("missing_server_argument");
      options[{ "--host": "host", "--port": "port", "--static-dir": "staticDir", "--data-dir": "dataDir" }[key]] = key === "--port" ? Number(value) : resolveIfPath(key, value);
    } else throw Error("unsupported_server_argument");
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw Error("invalid_server_port");
  const application = await startApplication(options);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => { if (stopping) return; stopping = true; await application.close(); process.exit(0); });
  console.log("Task application is ready");
}
function resolveIfPath(key, value) { return key.endsWith("-dir") ? resolve(value) : value; }
