// The production preview is cross-site to the workbench. A top-level browser
// suite alone missed SameSite=Strict breaking all API calls after iframe login.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const template = join(root, "project-templates/react-vite-tasks");
const openssl = process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe") ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
const chrome = process.env.SLIDERULE_CHROMIUM_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);

async function embeddedSession(strict) {
  const directory = await mkdtemp(join(tmpdir(), "whybuddy-task-iframe-"));
  const project = join(directory, "project"), key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  let app, gateway, host, browser;
  try {
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-days", "1"], { stdio: "ignore", windowsHide: true });
    await cp(template, project, { recursive: true, filter: path => !path.includes("node_modules") });
    await symlink(join(template, "node_modules"), join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    if (strict) {
      const path = join(project, "server.mjs"), source = await readFile(path, "utf8");
      assert.equal(source.split("; SameSite=None; Partitioned").length, 2);
      await writeFile(path, source.replace("; SameSite=None; Partitioned", "; SameSite=Strict; Partitioned"));
    }
    const { startApplication } = await import(pathToFileURL(join(project, "server.mjs")));
    app = await startApplication({ port: 0, dataDir: join(directory, "data"), staticDir: join(project, "dist") });
    gateway = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
      const upstream = httpRequest({ hostname: "127.0.0.1", port: app.server.address().port, path: request.url,
        method: request.method, headers: { ...request.headers, "x-forwarded-proto": "https" } }, reply => {
        response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
      });
      upstream.on("error", () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
    });
    await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
    const origin = "https://127.0.0.1:" + gateway.address().port;
    host = httpServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<iframe title="private application" src="${origin}/" style="width:100%;height:900px" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`); });
    await new Promise(resolve => host.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + host.address().port);
    const frame = page.frameLocator("iframe");
    await frame.getByLabel("用户名", { exact: true }).fill("iframe_writer");
    await frame.getByLabel("密码", { exact: true }).fill("EphemeralIframePassword42!");
    await frame.getByRole("button", { name: "创建并登录", exact: true }).click();
    await frame.getByLabel("任务标题", { exact: true }).fill("Preserved iframe task");
    const request = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tasks" && response.request().method() === "POST");
    await frame.getByRole("button", { name: "新增任务", exact: true }).click();
    const status = (await request).status();
    if (status === 201) {
      await frame.getByRole("article", { name: "Preserved iframe task", exact: true }).waitFor();
      await page.reload();
      await frame.getByRole("article", { name: "Preserved iframe task", exact: true }).waitFor();
      await expect(frame.getByLabel("当前用户", { exact: true })).toHaveText("iframe_writer");
      // Cookie is partitioned to this workbench: opening the application from
      // another top-level site cannot borrow that iframe login state.
      const outside = await context.newPage(); await outside.goto(origin);
      await outside.getByRole("heading", { name: "登录任务清单", exact: true }).waitFor();
    }
    return status;
  } finally {
    await browser?.close();
    for (const server of [host, gateway]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await app?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}
test("cross-site HTTPS iframe login survives CRUD and reload while another top-level site has no app session", async () => {
  assert.equal(await embeddedSession(false), 201);
});
test("restoring SameSite Strict reproduces real cloud login-success followed by API 401", async () => {
  assert.equal(await embeddedSession(true), 401);
});
