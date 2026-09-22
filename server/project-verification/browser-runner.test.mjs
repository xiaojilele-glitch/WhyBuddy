// Actual Chrome, local HTTP fixtures, production runner and public expect APIs.
// These are runner contract tests; the product/E2B smoke remains separate.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { ASSERTION_IDS, runVerification, validateInput } from "./browser-runner.mjs";

const revision = "prv-" + "a".repeat(32);
const token = "one_use_secret_" + "x".repeat(24);
const chrome = process.env.SLIDERULE_CHROMIUM_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => server.close(resolve));

async function fixture(mode, execute) {
  let outsideRequests = 0, markerChanged = false;
  const outside = createServer((_, response) => { outsideRequests++; response.end("outside"); });
  await listen(outside);
  const outsideUrl = `http://127.0.0.1:${outside.address().port}/secret-url`;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/_whybuddy/authorize") {
      response.writeHead(303, { location: "/", "set-cookie": "WhyBuddyPreview=private-grant; HttpOnly; SameSite=Strict; Path=/" });
      response.end(); return;
    }
    if (!request.headers.cookie?.includes("WhyBuddyPreview=private-grant")) { response.writeHead(403); response.end(); return; }
    if (url.pathname === "/__whybuddy_revision.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ revision: mode === "wrong-revision" || markerChanged ? "wrong" : revision })); return;
    }
    if (url.pathname === "/changed") { markerChanged = true; response.end("ok"); return; }
    if (url.pathname === "/missing.js") { response.writeHead(404); response.end(); return; }
    if (mode === "redirect" && url.pathname === "/") { response.writeHead(302, { location: outsideUrl }); response.end(); return; }
    response.setHeader("content-type", "text/html");
    const injection = mode === "external" ? `fetch(${JSON.stringify(outsideUrl)}).catch(()=>{});` :
      mode === "page-error" ? `setTimeout(()=>{throw new Error(${JSON.stringify(outsideUrl)})},0);` :
      mode === "popup" ? `window.open(${JSON.stringify(outsideUrl)});` :
      mode === "unsafe-count" ? `document.querySelector('output').textContent=${JSON.stringify(outsideUrl)};` :
      mode === "change-marker" ? `fetch('/changed');` : "";
    response.end(`<!doctype html><html><body><main>
      <h1 ${mode === "hidden-heading" ? 'style="display:none"' : ""}>Counter fixture</h1>
      <output aria-label="Count">0</output><button aria-label="Increment count">+</button>
      ${mode === "resource-error" ? '<script src="/missing.js"></script>' : ""}
      <script>window.passed=true;document.querySelector('button').onclick=()=>{
      document.querySelector('output').textContent=String(Number(document.querySelector('output').textContent)+${mode === "broken-counter" ? 2 : 1});
      ${injection}};</script></main></body></html>`);
  });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = { verificationId: "verify-fixture", revision, suiteVersion: "react-vite-counter@1",
    scope: { origin, projectId: "project-fixture", runtimeId: "runtime-fixture" },
    entryUrl: origin + "/_whybuddy/authorize?ticket=" + token };
  try { await execute(input, () => outsideRequests); }
  finally { await close(server); await close(outside); }
}

const run = input => runVerification(input, { allowLoopback: true, assertionTimeoutMs: 400,
  timeoutMs: 15000, launchOptions: chrome ? { executablePath: chrome } : {} });

test("real browser completes all seven assertions, screenshots and cleanup", async () => {
  await fixture("normal", async input => {
    const result = await run(input);
    assert.equal(result.status, "passed", result.errorCode);
    assert.equal(result.cleanupConfirmed, true);
    assert.deepEqual(result.assertions.map(item => item.id), ASSERTION_IDS);
    assert.ok(result.assertions.every(item => item.status === "passed"));
    assert.equal(result.revisionBefore, revision);
    assert.equal(result.revisionAfter, revision);
    for (const encoded of Object.values(result.artifacts)) assert.ok(Buffer.from(encoded, "base64").subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes("private-grant"), false);
  });
});

for (const [mode, id] of [["broken-counter", "counter_increment"], ["hidden-heading", "heading_visible"],
  ["page-error", "no_page_errors"], ["resource-error", "no_failed_requests"]]) {
  test("real browser rejects " + mode + " despite page-provided passed", async () => {
    await fixture(mode, async input => {
      const result = await run(input);
      assert.equal(result.status, "failed", result.errorCode);
      assert.equal(result.assertions.find(item => item.id === id)?.status, "failed");
      if (mode === "broken-counter") assert.deepEqual(result.assertions.find(item => item.id === id),
        { id: "counter_increment", status: "failed", expected: "1", actual: "2" });
      assert.equal(result.cleanupConfirmed, true);
      assert.ok(!JSON.stringify(result).includes("secret-url"));
    });
  });
}

test("failed counter emits a fixed sentinel instead of arbitrary DOM or URL text", async () => {
  await fixture("unsafe-count", async input => {
    const result = await run(input);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.assertions.find(item => item.id === "counter_increment"),
      { id: "counter_increment", status: "failed", expected: "1", actual: "unexpected_value" });
    assert.ok(!JSON.stringify(result).includes("secret-url"));
  });
});

for (const mode of ["external", "redirect", "popup"]) {
  test("real browser prevents " + mode + " before external HTTP side effects", async () => {
    await fixture(mode, async (input, requests) => {
      const result = await run(input);
      assert.notEqual(result.status, "passed");
      assert.equal(result.errorCode, "project_browser_navigation_blocked");
      assert.equal(result.cleanupConfirmed, true);
      assert.equal(requests(), 0);
      assert.ok(!JSON.stringify(result).includes("secret-url"));
    });
  });
}

for (const mode of ["wrong-revision", "change-marker"]) {
  test("real browser rejects " + mode, async () => {
    await fixture(mode, async input => {
      const result = await run(input);
      assert.notEqual(result.status, "passed");
      assert.equal(result.errorCode, "project_browser_revision_mismatch");
      assert.equal(result.cleanupConfirmed, true);
    });
  });
}

test("production input refuses model code, arbitrary origins and non-TLS", () => {
  const input = { verificationId: "verify", revision, suiteVersion: "react-vite-counter@1",
    scope: { origin: "https://runtime.preview.test", projectId: "project", runtimeId: "runtime" },
    entryUrl: "https://runtime.preview.test/_whybuddy/authorize?ticket=" + token };
  validateInput(input);
  for (const update of [{ code: "process.exit(0)" }, { suiteVersion: "model-script" },
    { entryUrl: "https://other.test/_whybuddy/authorize?ticket=" + token },
    { entryUrl: "https://runtime.preview.test/_whybuddy/authorize?ticket=" + token + "&next=http://other.test" },
    { scope: { ...input.scope, origin: "http://127.0.0.1" }, entryUrl: "http://127.0.0.1/_whybuddy/authorize?ticket=" + token }]) {
    assert.throws(() => validateInput({ ...input, ...update }), /project_browser_input_invalid/);
  }
});
