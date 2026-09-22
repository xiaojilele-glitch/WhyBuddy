import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const checks = [];
const observations = { hmrConnected: false, hmrUpdates: [], pageErrors: 0,
  surface: { actualComponent: true, api: "controlled Playwright route fixture", ticketRequests: 0, bootstrapRedirects: [] } };
let stage = "browser-launch";
const check = (name, passed) => {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(name);
};
let browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixtureTicket() {
  const seq = ++observations.surface.ticketRequests;
  await writeFile(join(config.directory, "browser-ticket-request.json"), JSON.stringify({ seq }));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = JSON.parse(await readFile(join(config.directory, "browser-ticket-response.json"), "utf8"));
      if (response.seq === seq) return response.ticket;
    } catch { /* Python atomically publishes the one-use ticket when ready. */ }
    await delay(100);
  }
  throw new Error("browser_ticket_fixture_timeout");
}

async function verifyActualSurface() {
  stage = "surface-build";
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({ stdin: { contents: `import React from "react";
    import { createRoot } from "react-dom/client";
    import { SandboxPreviewSurface } from "./client/src/pages/sliderule/project-runtime/SandboxPreviewSurface";
    createRoot(document.getElementById("surface")).render(React.createElement(SandboxPreviewSurface,
      ${JSON.stringify({ projectId: config.projectId, projectRevision: config.revision, appTitle: "真实工程预览组件" })}));`,
    loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const workbenchOrigin = "https://workbench.whybuddy.test";
  const otherOrigin = "https://workbench.another.test";
  const context = await browser.newContext();
  try {
    check("new iframe browser context begins without preview credentials", (await context.cookies()).length === 0);
    // Host-only workbench cookies/storage are deliberate nonsecret probes. They
    // must remain absent inside the remote application and inaccessible by SOP.
    await context.addCookies([{ name: "workbench_probe", value: "host-only", url: workbenchOrigin,
      secure: true, sameSite: "Lax" }]);
    const surfacePage = await context.newPage();
    surfacePage.on("pageerror", () => { observations.pageErrors += 1; });
    surfacePage.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === config.origin && url.pathname === "/_whybuddy/authorize") {
        observations.surface.bootstrapRedirects.push({ status: response.status(),
          cleanRedirect: response.headers().location === "/" });
      }
    });
    await context.route(workbenchOrigin + "/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/surface-smoke.js") {
        await route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }); return;
      }
      if (url.pathname === "/") {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8">
          <style>body{font:16px sans-serif;margin:20px}#surface{height:780px}iframe{height:620px;width:100%;border:0}button{padding:10px;margin:8px}</style>
          </head><body><h1 id="host-marker">受控工作台宿主</h1><div id="surface"></div><script src="/surface-smoke.js"></script></body></html>` }); return;
      }
      if (url.pathname === `/api/sliderule/projects/${config.projectId}/preview` && request.method() === "GET") {
        await route.fulfill({ json: { operationId: config.operationId, available: true, reason: null,
          descriptor: { kind: "project", projectId: config.projectId, runtimeId: config.runtimeId,
            revision: config.revision, status: "ready", expiresAt: config.expiresAt } } }); return;
      }
      if (url.pathname === `/api/sliderule/project-operations/${config.operationId}/preview-ticket` && request.method() === "POST") {
        await route.fulfill({ json: await fixtureTicket() }); return;
      }
      await route.fulfill({ status: 404, body: "fixture route unavailable" });
    });
    stage = "surface-open";
    await surfacePage.goto(workbenchOrigin, { waitUntil: "networkidle" });
    await surfacePage.evaluate(() => { localStorage.setItem("workbench_probe", "host-only"); });
    await surfacePage.waitForFunction(() => document.querySelector('[data-testid="project-preview-open"]')?.disabled === false);
    await surfacePage.getByTestId("project-preview-open").click();
    const frameElement = surfacePage.getByTestId("project-preview-frame");
    const frameLocator = surfacePage.frameLocator('[data-testid="project-preview-frame"]');
    await frameLocator.getByRole("heading", { name: "New Project" }).waitFor({ timeout: 60000 });
    const frame = surfacePage.frames().find(candidate => candidate.parentFrame() && candidate.url() === config.origin + "/");
    check("actual SandboxPreviewSurface loads the remote app in a separate origin", Boolean(frame));
    check("actual iframe keeps the product sandbox and referrer policy", await frameElement.getAttribute("sandbox") ===
      "allow-scripts allow-forms allow-same-origin allow-modals allow-downloads" &&
      await frameElement.getAttribute("referrerpolicy") === "no-referrer");
    check("cross-site iframe ticket receives 303 and its navigated URL is clean",
      observations.surface.bootstrapRedirects.length === 1 && observations.surface.bootstrapRedirects[0].status === 303 &&
      observations.surface.bootstrapRedirects[0].cleanRedirect && frame.url() === config.origin + "/");
    await frameLocator.getByRole("button", { name: "Increment count" }).click();
    check("real component cross-site iframe remains interactive", await frameLocator.getByLabel("Count", { exact: true }).textContent() === "1");
    const isolation = await frame.evaluate(() => {
      let hostDomDenied = false, hostStorageDenied = false;
      try { void parent.document.getElementById("host-marker"); } catch (error) { hostDomDenied = error.name === "SecurityError"; }
      try { void parent.localStorage.getItem("workbench_probe"); } catch (error) { hostStorageDenied = error.name === "SecurityError"; }
      return { hostDomDenied, hostStorageDenied, noHostCookie: !document.cookie.includes("workbench_probe"),
        noGatewayCookie: !document.cookie.includes("WhyBuddyPreview"), noHostStorage: localStorage.getItem("workbench_probe") === null,
        noReferrer: document.referrer === "" };
    });
    check("generated app cannot access the host DOM cookie or storage", isolation.hostDomDenied && isolation.hostStorageDenied &&
      isolation.noHostCookie && isolation.noHostStorage);
    check("iframe JavaScript cannot read its HttpOnly grant or workbench Referer", isolation.noGatewayCookie && isolation.noReferrer);
    const grantCookies = (await context.cookies()).filter(cookie => cookie.name === "__Host-WhyBuddyPreview");
    check("iframe grant is host-only HttpOnly Secure and partitioned for this top-level site", grantCookies.length === 1 &&
      grantCookies[0].httpOnly && grantCookies[0].secure && grantCookies[0].domain === new URL(config.origin).hostname &&
      grantCookies[0].partitionKey === "https://whybuddy.test");
    stage = "surface-refresh";
    await Promise.all([frame.waitForNavigation({ waitUntil: "networkidle", timeout: 45000 }), frame.evaluate(() => { location.reload(); })]);
    await frameLocator.getByRole("heading", { name: "New Project" }).waitFor({ timeout: 45000 });
    check("iframe refresh keeps its authorized runtime and persisted source", await frame.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--whybuddy-hmr-probe").trim()) === "updated");
    const refreshedBootstrap = surfacePage.waitForResponse(response => new URL(response.url()).origin === config.origin &&
      new URL(response.url()).pathname === "/_whybuddy/authorize");
    await surfacePage.getByTestId("project-preview-open").click();
    await refreshedBootstrap;
    await frameLocator.getByRole("heading", { name: "New Project" }).waitFor({ timeout: 60000 });
    check("actual refresh-preview button obtains and redeems a fresh one-use ticket", observations.surface.ticketRequests === 2 &&
      observations.surface.bootstrapRedirects.length === 2 && observations.surface.bootstrapRedirects.every(value => value.status === 303 && value.cleanRedirect));
    await surfacePage.screenshot({ path: join(config.directory, "actual-sandbox-preview-surface.png"), fullPage: true });
    stage = "surface-cookie-partition";
    const otherPage = await context.newPage();
    await context.route(otherOrigin + "/**", route => route.fulfill({ contentType: "text/html",
      body: `<!doctype html><h1>另一个顶层站点</h1><iframe src="${config.origin}/" sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe>` }));
    const deniedResponse = otherPage.waitForResponse(response => response.url() === config.origin + "/" && response.request().resourceType() === "document");
    await otherPage.goto(otherOrigin, { waitUntil: "networkidle", timeout: 45000 });
    check("another top-level site cannot reuse the first site's partitioned preview cookie", (await deniedResponse).status() === 403);
    check("other site's denial does not disconnect the authorized workbench", await frameLocator.getByRole("heading", { name: "New Project" }).isVisible());
  } finally { await context.close(); }
}
try {
  browser = await chromium.launch({ executablePath: config.chrome, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", () => { observations.pageErrors += 1; });
  page.on("websocket", socket => socket.on("framereceived", frame => {
    try {
      const value = JSON.parse(String(frame.payload));
      if (value.type === "connected") observations.hmrConnected = true;
      if (value.type === "update" && Array.isArray(value.updates)) {
        for (const update of value.updates) {
          // Save only the fixed fixture's known module and protocol type, never
          // WS URLs, query tokens, arbitrary frame contents or app data.
          if (["js-update", "css-update"].includes(update.type))
            observations.hmrUpdates.push({ type: update.type,
              isFixtureStyle: update.path === "/src/style.css" });
        }
      }
    } catch { /* Non-HMR application traffic isn't a passing observation. */ }
  }));
  stage = "standalone-preview";
  await page.goto(config.entryUrl, { waitUntil: "networkidle", timeout: 60000 });
  check("ticket removed from actual browser URL", page.url() === config.origin + "/");
  await page.getByRole("heading", { name: "New Project" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Increment count" }).click();
  check("real React click updates counter", await page.getByLabel("Count", { exact: true }).textContent() === "1");
  await page.evaluate(() => { globalThis.__whybuddyDocumentMarker = "same-document"; });
  await page.screenshot({ path: join(config.directory, "before-hmr.png"), fullPage: true });
  await writeFile(join(config.directory, "browser-ready.json"), JSON.stringify({ ready: true }));
  stage = "standalone-hmr";
  await page.waitForFunction(() => getComputedStyle(document.documentElement)
    .getPropertyValue("--whybuddy-hmr-probe").trim() === "updated", undefined, { timeout: 45000 });
  observations.sameDocument = await page.evaluate(() =>
    globalThis.__whybuddyDocumentMarker === "same-document");
  observations.counterPreserved = await page.getByLabel("Count", { exact: true }).textContent() === "1";
  // CSS imported by main.tsx is a Vite JS module with updateStyle(); CSS linked
  // by HTML uses css-update. Both must deliver an actual WS update for this file.
  check("Vite WS connected and delivered the style module update", observations.hmrConnected &&
    observations.hmrUpdates.some(update => update.isFixtureStyle));
  check("HMR preserves document and live React state", observations.sameDocument && observations.counterPreserved);
  const cookies = await context.cookies();
  check("preview grant uses private isolated cookie", cookies.some(cookie =>
    cookie.name === "__Host-WhyBuddyPreview" && cookie.httpOnly && cookie.secure && cookie.sameSite === "None"));
  check("page JavaScript cannot read gateway cookie", !(await page.evaluate(() => document.cookie)).includes("WhyBuddyPreview"));
  await page.reload({ waitUntil: "networkidle", timeout: 45000 });
  check("refresh keeps authorized preview and written source", await page.getByRole("heading").textContent() === "New Project" &&
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--whybuddy-hmr-probe").trim()) === "updated");
  check("no browser page exceptions", observations.pageErrors === 0);
  await page.screenshot({ path: join(config.directory, "after-hmr.png"), fullPage: true });
  await context.close();
  await verifyActualSurface();
  check("standalone and embedded browser scenarios have no page exceptions", observations.pageErrors === 0);
  await writeFile(join(config.directory, "browser-report.json"), JSON.stringify({ status: "passed", checks, observations }, null, 2));
} catch (error) {
  // Playwright errors can contain navigated URLs and ticket query parameters.
  // Retain only a fixed stage and exception class, never raw error text/stack.
  await writeFile(join(config.directory, "browser-report.json"), JSON.stringify({ status: "failed", stage,
    errorKind: error?.constructor?.name ?? "Error", checks, observations }, null, 2));
  process.exitCode = 1;
} finally { await browser?.close(); }
