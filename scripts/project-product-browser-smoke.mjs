// Full product UI: no Playwright route fixtures and no component-only shell.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const report = { status: "running", stage: "launch", checks: [], pageErrors: [],
  observations: { auth: "real account cookie", api: "real Vite proxy to Python", bootstrapStatuses: [], hmrConnected: false } };
const persist = () => writeFile(join(config.directory, "browser-report.json"), JSON.stringify(report, null, 2));
const check = async (name, value) => {
  report.checks.push({ name, passed: Boolean(value) });
  await persist();
  if (!value) throw new Error(name);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
try {
  const chrome = process.env.SLIDERULE_CHROMIUM_PATH || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
  browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ sessionId, workbench }) => {
    if (location.origin === workbench) localStorage.setItem("sliderule:active-session-id", sessionId);
  }, { sessionId: config.sessionId, workbench: config.workbench });
  const login = await context.request.post(config.workbench + "/api/sliderule/account/login",
    { data: { email: config.ownerEmail, password: config.password } });
  await check("real browser account transport logs in", login.status() === 200);
  const page = await context.newPage();
  page.on("pageerror", error => { report.pageErrors.push({ name: error.name }); });
  const csp = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) csp.push("blocked");
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === config.previewOrigin && url.pathname === "/_whybuddy/authorize")
      report.observations.bootstrapStatuses.push({ status: response.status(), cleanRedirect: response.headers().location === "/" });
  });
  page.on("websocket", socket => {
    const url = new URL(socket.url());
    if (url.origin.replace(/^ws/, "http") !== config.previewOrigin) return;
    socket.on("framereceived", frame => {
      try { if (JSON.parse(String(frame.payload)).type === "connected") report.observations.hmrConnected = true; } catch { /* non-HMR */ }
    });
  });
  const fixture = async path => {
    const response = await context.request.post(config.authority + "/_smoke/" + path,
      { headers: { Authorization: "Bearer " + config.fixtureKey } });
    if (!response.ok()) throw new Error("trusted_fixture_http_" + response.status());
    return response.json();
  };
  async function openPreview(heading) {
    await page.getByTestId("sandbox-preview-surface").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-preview-open"]')?.disabled === false,
      undefined, { timeout: 60000 });
    await page.getByTestId("project-preview-open").click();
    const locator = page.frameLocator('[data-testid="project-preview-frame"]');
    await locator.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60000 });
    return locator;
  }
  const verificationPath = `/api/sliderule/projects/${config.projectId}/verification`;
  async function verifyPage(expectedStatus, revision, label) {
    report.stage = "independent_verification_" + label;
    await persist();
    const runtimeState = async () => (await context.request.get(config.authority + "/_smoke/state",
      { headers: { Authorization: "Bearer " + config.fixtureKey } })).json();
    const beforeRuntime = (await runtimeState()).operations.find(item => item.operationId === config.operationId).runtime;
    const button = page.getByTestId("project-verification-start");
    await expect(button).toBeEnabled({ timeout: 30000 });
    const sent = page.waitForRequest(request => request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/sliderule/project-operations/${config.operationId}/verify`);
    await button.click();
    const request = await sent;
    await check(label + " uses actual UI command for the current revision", request.postDataJSON().expectedRevision === revision);
    const accepted = await request.response();
    await check(label + " enters the durable runtime verification queue", accepted?.status() === 202);
    const operation = await accepted.json();
    let snapshot;
    const until = Date.now() + 160000;
    while (Date.now() < until) {
      const reply = await context.request.get(config.workbench + verificationPath);
      const body = reply.ok() ? await reply.json() : null;
      if (body?.operationId === operation.operationId && body.snapshot &&
          ["passed", "failed", "blocked", "cancelled"].includes(body.snapshot.effectiveStatus)) {
        snapshot = body.snapshot;
        break;
      }
      await delay(500);
    }
    report.verifications ??= [];
    report.verifications.push({ label, operationId: operation.operationId, snapshot });
    await check(label + " receives the actual independent browser verdict", snapshot?.effectiveStatus === expectedStatus);
    let afterRuntime;
    const restoredUntil = Date.now() + 60000;
    while (Date.now() < restoredUntil) {
      const parent = (await runtimeState()).operations.find(item => item.operationId === config.operationId);
      if (parent.runtime.status === "ready" && !parent.result?.verificationBuild && parent.runtime.processId !== beforeRuntime.processId) {
        afterRuntime = parent.runtime;
        break;
      }
      await delay(500);
    }
    const oldProcess = await fixture("process/" + beforeRuntime.processId);
    await check(label + " restores a new dev PID and confirms the old dev process stopped", afterRuntime?.runtimeId === beforeRuntime.runtimeId &&
      afterRuntime.processId !== beforeRuntime.processId && oldProcess.running === false);
    report.processTransitions ??= [];
    report.processTransitions.push({ label, oldPid: beforeRuntime.processId, newPid: afterRuntime.processId, oldStopped: !oldProcess.running });
    await check(label + " binds evidence to the exact source and limited coverage", snapshot.verification.revision === revision &&
      snapshot.deliveryEligible === false && snapshot.verification.assertions.length === 7 &&
      snapshot.verification.runnerVersion === "whybuddy-browser-v1:pw1.61.1");
    await check(label + " verifies the actual immutable production build", snapshot.verification.build?.status === "passed" &&
      snapshot.verification.build.installExitCode === 0 && snapshot.verification.build.buildExitCode === 0 &&
      snapshot.verification.build.outputFileCount > 0 && /^[a-f0-9]{64}$/.test(snapshot.verification.build.outputHash));
    await page.getByRole("button", { name: "更新检查状态", exact: true }).click();
    await expect(page.getByTestId("project-verification-status")).toContainText(expectedStatus === "passed" ? "通过" : "失败", { timeout: 15000 });
    const evidence = snapshot.verification;
    await check(label + " retains real before and after browser screenshots", evidence.artifactRefs.length === 2);
    for (const artifact of evidence.artifactRefs) {
      const response = await context.request.get(config.workbench +
        `/api/sliderule/project-verifications/${evidence.verificationId}/artifacts/${artifact.artifactId}`);
      const bytes = await response.body();
      await check(label + " serves authenticated PNG " + artifact.label,
        response.status() === 200 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && bytes.length === artifact.sizeBytes);
      await writeFile(join(config.directory, "verification-" + label + "-" + artifact.artifactId + ".png"), bytes);
    }
    await page.screenshot({ path: join(config.directory, "verification-" + label + "-workbench.png"), fullPage: true });
    return snapshot;
  }
  async function editCounter(action, previousRevision) {
    report.stage = "source_sync_" + action;
    await persist();
    const patch = await fixture("counter/" + action);
    await check(action + " intent uses the actual project patch tool", patch.ok && patch.kind === "runtime.patch");
    let revision;
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      const response = await context.request.get(config.workbench + `/api/sliderule/projects/${config.projectId}/preview`);
      const body = response.ok() ? await response.json() : null;
      if (body?.available && body.descriptor?.status === "ready" && body.descriptor.revision !== previousRevision) {
        revision = body.descriptor.revision;
        break;
      }
      await delay(500);
    }
    await check(action + " publishes a synchronized source revision", Boolean(revision));
    await page.getByTestId("project-preview-frame").waitFor({ state: "detached", timeout: 20000 });
    const latest = await (await context.request.get(config.workbench + verificationPath)).json();
    await check(action + " makes the previous evidence stale", latest.snapshot?.effectiveStatus === "stale");
    // Verification already removed the iframe while serving the immutable
    // build. Its absence cannot prove this later source revision reached React.
    // Wait for the exact revision consumed by the actual preview, since the
    // verification panel polls independently and can observe the change first.
    await expect(page.getByTestId("sandbox-preview-surface")).toHaveAttribute("data-project-revision", revision, { timeout: 30000 });
    await expect(page.getByTestId("project-verification-status")).toContainText("旧版本", { timeout: 30000 });
    await openPreview("Integrated source update");
    return revision;
  }
  report.stage = "studio";
  await persist();
  await page.goto(config.workbench + "/agent-loop/sliderule", { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await openPreview("New Project");
  await check("full Studio uses the real project surface", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);
  await frame.getByRole("button", { name: "Increment count" }).click();
  await check("full Studio iframe handles actual React interaction", await frame.getByLabel("Count", { exact: true }).textContent() === "1");
  const appFrame = page.frames().find(value => value.url() === config.previewOrigin + "/");
  await check("real ticket exchange redirects to clean isolated origin", Boolean(appFrame) &&
    report.observations.bootstrapStatuses.some(item => item.status === 303 && item.cleanRedirect));
  const isolation = await appFrame.evaluate(() => {
    let denied = false;
    try { void parent.document.body; } catch { denied = true; }
    return { denied, cookie: document.cookie.includes("WhyBuddyPreview"), referrer: document.referrer };
  });
  await check("generated app cannot access host DOM or HttpOnly grant", isolation.denied && !isolation.cookie && isolation.referrer === "");
  await page.screenshot({ path: join(config.directory, "studio-before.png"), fullPage: true });

  // A real second administrator must still fail the project ownership boundary.
  const other = await browser.newContext();
  const otherLogin = await other.request.post(config.authority + "/api/sliderule/account/login",
    { data: { email: config.strangerEmail, password: config.password } });
  await check("second real account logs in independently", otherLogin.ok());
  const deniedTicket = await other.request.post(config.authority + `/api/sliderule/project-operations/${config.operationId}/preview-ticket`);
  await check("other administrator cannot obtain owner project ticket", deniedTicket.status() === 404);
  await other.close();

  // Keep an unused ticket to prove source changes revoke it in actual SQL.
  const oldTicketReply = await context.request.post(config.workbench + `/api/sliderule/project-operations/${config.operationId}/preview-ticket`);
  await check("owner can obtain a one-use revision ticket", oldTicketReply.ok());
  const oldTicket = await oldTicketReply.json();
  report.stage = "source_sync";
  await persist();
  const patch = await fixture("patch");
  await check("fixture edit reaches actual queued project tool", patch.ok && patch.kind === "runtime.patch");
  const deadline = Date.now() + 90000;
  let current;
  while (Date.now() < deadline) {
    const response = await context.request.get(config.workbench + `/api/sliderule/projects/${config.projectId}/preview`);
    current = response.ok() ? await response.json() : null;
    if (current?.available && current.descriptor?.revision !== config.initialRevision) break;
    await delay(500);
  }
  await check("real descriptor announces a new ready source revision", current?.available && current.descriptor?.status === "ready" && current.descriptor?.revision !== config.initialRevision);
  const stale = await context.request.get(oldTicket.entryUrl, { maxRedirects: 0 });
  await check("source synchronization revokes unused old revision ticket", stale.status() === 403);
  await page.getByTestId("project-preview-frame").waitFor({ state: "detached", timeout: 20000 });
  await check("Studio removes old authorized iframe after revision changes", await page.getByTestId("project-preview-frame").count() === 0);
  const revisedFrame = await openPreview("Integrated source update");
  await revisedFrame.getByRole("button", { name: "Increment count" }).click();
  await check("new revision remains interactive through the real gateway", await revisedFrame.getByLabel("Count", { exact: true }).textContent() === "1");
  await page.screenshot({ path: join(config.directory, "studio-after.png"), fullPage: true });
  report.stage = "refresh";
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await openPreview("Integrated source update");
  await check("whole workbench refresh restores current project from Python", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);

  report.stage = "apps_workbench";
  await persist();
  await page.goto(config.workbench + "/agent-loop/workbench", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Projects are private session artifacts. The market is the default shelf;
  // enter the real owner shelf before looking for this isolated fixture.
  await page.getByRole("button", { name: "我的应用", exact: true }).click();
  const card = page.getByTestId("app-cell-" + config.sessionId);
  await card.waitFor({ timeout: 60000 });
  await card.getByText("工程", { exact: true }).waitFor({ timeout: 60000 });
  await check("full AppsWorkbench loads actual project session card", await card.getByText("工程", { exact: true }).isVisible());
  await page.screenshot({ path: join(config.directory, "apps-project.png"), fullPage: true });
  await card.click();
  await openPreview("Integrated source update");
  await check("AppsWorkbench project card reopens the same current runtime", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);
  if (config.verifyBrowser) {
    const passed = await verifyPage("passed", current.descriptor.revision, "initial");
    const brokenRevision = await editCounter("break", current.descriptor.revision);
    const failed = await verifyPage("failed", brokenRevision, "broken");
    await check("broken counter produces actual failed click assertions", failed.verification.assertions.some(item =>
      item.id === "counter_increment" && item.status === "failed"));
    const repairedRevision = await editCounter("repair", brokenRevision);
    await verifyPage("passed", repairedRevision, "repaired");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    // The app center stores the selected session in the workbench route; the
    // Studio route restores that same project from the real persisted session.
    await page.goto(config.workbench + "/agent-loop/sliderule", { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.getByTestId("project-verification-status")).toContainText("通过", { timeout: 30000 });
    await check("Studio refresh restores the latest persisted verification", await page.getByTestId("project-verification-panel").isVisible());
    const old = await context.request.get(config.workbench + `/api/sliderule/project-verifications/${passed.verification.verificationId}`);
    await check("historical passed record remains stored but stale", (await old.json()).effectiveStatus === "stale");
    const stranger = await browser.newContext();
    try {
      await stranger.request.post(config.authority + "/api/sliderule/account/login",
        { data: { email: config.strangerEmail, password: config.password } });
      const id = passed.verification.verificationId;
      const png = passed.verification.artifactRefs[0].artifactId;
      const deniedRecord = await stranger.request.get(config.authority + `/api/sliderule/project-verifications/${id}`);
      const deniedImage = await stranger.request.get(config.authority + `/api/sliderule/project-verifications/${id}/artifacts/${png}`);
      await check("another administrator cannot read browser records or images", deniedRecord.status() === 404 && deniedImage.status() === 404);
    } finally { await stranger.close(); }
  }
  report.observations.cspViolations = csp.length;
  await check("product browser has no uncaught JavaScript errors", report.pageErrors.length === 0);
  await check("Vite HMR WebSocket connects through authorized product preview", report.observations.hmrConnected);
  report.status = "passed";
  await context.close();
} catch (error) {
  report.status = "failed";
  // Playwright error strings can contain one-use URLs. Save assertion text only
  // for our own errors; otherwise retain class and stage, plus a screenshot.
  report.error = error.name === "Error" && !error.message.includes("\n") && !error.message.includes("http")
    ? error.message : error.name;
  const page = browser?.contexts()?.[0]?.pages()?.[0];
  if (page) {
    report.visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
    await page.screenshot({ path: join(config.directory, "failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  await browser?.close();
  await persist();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, report: join(config.directory, "browser-report.json") }));
}
process.exitCode = report.status === "passed" ? 0 : 1;
