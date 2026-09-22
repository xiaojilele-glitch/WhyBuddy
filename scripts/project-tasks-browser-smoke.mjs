// Actual workbench, Python authority, private gateway, E2B application and
// independently controlled cloud browser. No Playwright route mocks are used.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const report = { status: "running", stage: "launch", checks: [], pageErrors: [], verifications: [], processTransitions: [] };
const persist = () => writeFile(join(config.directory, "browser-report.json"), JSON.stringify(report, null, 2));
const check = async (name, value) => {
  report.checks.push({ name, passed: Boolean(value) }); await persist();
  if (!value) throw new Error(name);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, context, operationId = config.operationId;
let previewOrigin = config.previewOrigin;
const base = `/api/sliderule/projects/${config.projectId}`;
const username = "writer_" + randomBytes(5).toString("hex");
const reader = "reader_" + randomBytes(5).toString("hex");
const password = randomBytes(24).toString("base64url");
const taskTitle = "Cloud recovery task";
const editedTitle = "Cloud recovery task completed";
async function json(path, data) {
  const response = data === undefined ? await context.request.get(config.workbench + path) :
    await context.request.post(config.workbench + path, { data });
  if (!response.ok()) throw new Error("tasks_http_" + response.status() + "_" + path.replace(/[^a-z/]/gi, ""));
  return response.json();
}
async function state() {
  const response = await context.request.get(config.authority + "/_smoke/state", { headers: { Authorization: "Bearer " + config.fixtureKey } });
  if (!response.ok()) throw new Error("tasks_fixture_state_unavailable");
  return response.json();
}
async function waitFor(callback, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) { const result = await callback(); if (result) return result; await delay(500); }
  throw new Error("tasks_wait_timeout_" + report.stage);
}
async function ready(revision) {
  return waitFor(async () => {
    const parent = (await state()).operations.find(item => item.operationId === operationId);
    if (["failed", "completed", "cancelled"].includes(parent.status)) throw new Error("tasks_parent_terminated");
    return parent.runtime?.status === "ready" && !parent.result?.verificationBuild &&
      (!revision || parent.runtime.revision === revision) ? parent : null;
  }, 180);
}
async function openPreview(heading) {
  await page.getByTestId("sandbox-preview-surface").waitFor({ timeout: 60000 });
  const frame = page.frameLocator('[data-testid="project-preview-frame"]');
  // The iframe element can survive a failed/expired ticket while its document
  // is gone.  Re-authorize explicitly instead of treating the stale element
  // as a ready preview; this keeps the smoke deterministic across reloads.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!await page.getByTestId("project-preview-frame").count() || attempt > 0) {
      await expect(page.getByTestId("project-preview-open")).toBeEnabled({ timeout: 60000 });
      await page.getByTestId("project-preview-open").click();
    }
    try {
      await frame.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 30000 });
      return frame;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.getByRole("button", { name: "更新状态", exact: true }).click().catch(() => {});
      await delay(1000);
    }
  }
  throw new Error("tasks_preview_unavailable");
}
async function appLogin(frame, name) {
  await frame.getByLabel("用户名", { exact: true }).fill(name);
  await frame.getByLabel("密码", { exact: true }).fill(password);
  await frame.getByRole("button", { name: "登录", exact: true }).click();
  await frame.getByRole("heading", { name: "任务清单", exact: true }).waitFor();
}
async function applicationRequest(path, data) {
  const target = page.frames().find(frame => frame.url().startsWith(previewOrigin + "/"));
  if (!target) throw new Error("tasks_application_frame_missing");
  return target.evaluate(async ({ path, data }) => {
    const response = await fetch(path, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, body };
  }, { path, data });
}
async function sourceEdit(transform, label) {
  report.stage = "source_" + label; await persist();
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.getByRole("navigation", { name: "工程文件" }).getByRole("button", { name: "src/main.tsx", exact: true }).click();
  const editor = page.getByTestId("project-source-editor");
  await expect(editor).toHaveValue(/createRoot/);
  const before = await editor.inputValue(), after = transform(before);
  await check(label + " source edit changes the actual persisted template", before !== after);
  await editor.fill(after);
  const sent = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === base + "/source/patch");
  await page.getByRole("button", { name: "保存源码", exact: true }).click();
  const response = await sent;
  await check(label + " save uses the actual source patch HTTP command", response.status() === 200);
  const command = await response.json();
  await waitFor(async () => {
    const result = await json(`/api/sliderule/project-operations/${command.operationId}`);
    if (["failed", "cancelled"].includes(result.operation.status)) throw new Error("tasks_source_sync_failed");
    return result.operation.status === "completed";
  });
  const index = await json(base + "/source");
  await ready(index.currentRevision);
  const file = await json(base + "/source/file?path=src%2Fmain.tsx");
  await check(label + " saved source is read back through the real source API", file.content === after);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  return index.currentRevision;
}
async function verify(expected, revision, label) {
  report.stage = "verification_" + label; await persist();
  const before = await ready(revision);
  await expect(page.getByTestId("project-verification-start")).toBeEnabled({ timeout: 30000 });
  const sent = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/sliderule/project-operations/${operationId}/verify`);
  await page.getByTestId("project-verification-start").click();
  const accepted = await sent;
  await check(label + " starts independent cloud verification from the actual UI", accepted.status() === 202);
  const command = await accepted.json();
  const snapshot = await waitFor(async () => {
    const value = await json(base + "/verification");
    return value.operationId === command.operationId && ["passed", "failed", "blocked", "cancelled"].includes(value.snapshot?.effectiveStatus) ? value.snapshot : null;
  }, 220);
  report.verifications.push({ label, operationId: command.operationId, snapshot });
  await check(label + " receives the real expected browser verdict", snapshot.effectiveStatus === expected);
  const proof = snapshot.verification;
  await check(label + " checks all thirteen task assertions on the fixed source build", proof.revision === revision &&
    proof.suiteVersion === "react-vite-tasks@1" && proof.assertions.length === 13 && proof.build?.status === "passed" &&
    proof.build.installExitCode === 0 && proof.build.buildExitCode === 0 && proof.build.serverKind === "tasks-node" &&
    proof.build.outputFileCount > 0 && /^[a-f0-9]{64}$/.test(proof.build.outputHash));
  const after = await ready(revision);
  const stoppedReply = await context.request.post(config.authority + "/_smoke/process/" + before.runtime.processId,
    { headers: { Authorization: "Bearer " + config.fixtureKey } });
  const stopped = stoppedReply.ok() ? await stoppedReply.json() : null;
  report.processTransitions.push({ label, oldPid: before.runtime.processId, newPid: after.runtime.processId, oldStopped: stopped?.running === false });
  await check(label + " stops the old PID and restores a new dev process under the same runtime", stopped?.running === false &&
    before.runtime.processId !== after.runtime.processId && before.runtime.runtimeId === after.runtime.runtimeId);
  await page.getByRole("button", { name: "更新检查状态", exact: true }).click();
  await expect(page.getByTestId("project-verification-status")).toContainText(expected === "passed" ? "通过" : "失败", { timeout: 30000 });
  await page.getByRole("button", { name: "查看截图 1", exact: true }).click();
  await expect(page.getByAltText("浏览器检查截图", { exact: true })).toBeVisible();
  await check(label + " displays the authenticated PNG in the actual workbench", true);
  await page.getByRole("button", { name: "关闭截图", exact: true }).click();
  for (const artifact of proof.artifactRefs) {
    const response = await context.request.get(config.workbench + `/api/sliderule/project-verifications/${proof.verificationId}/artifacts/${artifact.artifactId}`);
    const bytes = await response.body();
    await check(label + " serves real authenticated PNG " + artifact.label, response.ok() && bytes.length === artifact.sizeBytes &&
      bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
    await writeFile(join(config.directory, `tasks-${label}-${artifact.artifactId}.png`), bytes);
  }
  await page.screenshot({ path: join(config.directory, "tasks-" + label + ".png"), fullPage: true });
  return proof;
}
try {
  const chrome = process.env.SLIDERULE_CHROMIUM_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
  browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true });
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(({ id, origin }) => { if (location.origin === origin) localStorage.setItem("sliderule:active-session-id", id); },
    { id: config.sessionId, origin: config.workbench });
  const login = await context.request.post(config.workbench + "/api/sliderule/account/login", { data: { email: config.ownerEmail, password: config.password } });
  await check("actual workbench account login succeeds", login.ok());
  page = await context.newPage();
  page.on("pageerror", error => report.pageErrors.push({ name: error.name }));
  let hmr = false;
  page.on("websocket", socket => { if (![config.previewOrigin, config.secondPreviewOrigin].includes(new URL(socket.url()).origin.replace(/^ws/, "http"))) return;
    socket.on("framereceived", frame => { try { if (JSON.parse(String(frame.payload)).type === "connected") hmr = true; } catch {} }); });
  report.stage = "business_ui"; await persist();
  await page.goto(config.workbench + "/agent-loop/sliderule", { waitUntil: "domcontentloaded", timeout: 90000 });
  let frame = await openPreview("创建管理员");
  await frame.getByLabel("用户名", { exact: true }).fill(username);
  await frame.getByLabel("密码", { exact: true }).fill(password);
  await frame.getByRole("button", { name: "创建并登录", exact: true }).click();
  await frame.getByRole("heading", { name: "任务清单", exact: true }).waitFor();
  await frame.getByLabel("任务标题", { exact: true }).fill(taskTitle);
  await frame.getByRole("button", { name: "新增任务", exact: true }).click();
  await frame.getByRole("article", { name: taskTitle, exact: true }).waitFor();
  await frame.getByRole("button", { name: "编辑任务 " + taskTitle, exact: true }).click();
  await frame.getByLabel("编辑标题", { exact: true }).fill(editedTitle);
  await frame.getByLabel("编辑状态", { exact: true }).selectOption("done");
  await frame.getByRole("button", { name: "保存修改", exact: true }).click();
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await frame.getByLabel("筛选状态", { exact: true }).selectOption("open");
  await expect(frame.getByRole("article", { name: editedTitle, exact: true })).toHaveCount(0);
  await frame.getByLabel("筛选状态", { exact: true }).selectOption("done");
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await check("actual task create edit and status filter use the cloud application API", true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  frame = await openPreview("任务清单");
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await check("whole workbench reload preserves the real task and application login", true);
  await frame.getByText("新增只读成员", { exact: true }).click();
  await frame.getByLabel("只读用户名", { exact: true }).fill(reader);
  await frame.getByLabel("只读密码", { exact: true }).fill(password);
  await frame.getByRole("button", { name: "创建只读成员", exact: true }).click();
  await frame.getByRole("status").filter({ hasText: "只读成员已创建" }).waitFor();
  await frame.getByRole("button", { name: "退出登录", exact: true }).click();
  await appLogin(frame, reader);
  await expect(frame.getByRole("button", { name: "新增任务", exact: true })).toHaveCount(0);
  const readerDenied = await applicationRequest("/api/tasks", { title: "must not write" });
  await check("independent reader account cannot write even by direct API", readerDenied.status === 403 && readerDenied.body.error === "只读成员不能修改数据");
  await frame.getByRole("button", { name: "退出登录", exact: true }).click();
  // The preview is cross-origin and the browser may retain a partitioned
  // application cookie while logout is settling. Clear only the task-app
  // cookie before the anonymous probe, preserving the workbench and private
  // preview grants in this context.
  await context.clearCookies({ name: "WhyBuddyTaskSession" });
  const anonymousDenied = await applicationRequest("/api/tasks", { title: "must not write" });
  report.anonymousProbe = { status: anonymousDenied.status, body: anonymousDenied.body };
  await persist();
  await check("anonymous application API cannot write", anonymousDenied.status === 401 && anonymousDenied.body?.error === "请先登录");
  await appLogin(frame, username);

  report.stage = "source_selection";
  await page.getByRole("button", { name: "点选元素定位源码", exact: true }).click();
  await frame.getByRole("heading", { name: "任务清单", exact: true }).click();
  await expect(page.getByTestId("project-source-editor")).toHaveValue(/createRoot/);
  await check("real cross-origin selection opens the persisted source editor", await page.getByTestId("project-source-editor").evaluate(node => node.selectionEnd > node.selectionStart));
  const revision = await sourceEdit(source => source.replace("把计划变成今天的小行动", "源码保存后的真实任务应用"), "heading");
  frame = await openPreview("任务清单");
  await frame.getByText("源码保存后的真实任务应用", { exact: true }).waitFor();
  await check("source saved in the workbench appears in real E2B preview", true);
  const initialProof = await verify("passed", revision, "initial");
  frame = await openPreview("任务清单");
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await check("formal verification uses an isolated DB and preserves user task data", true);
  const delivery = await json(base + "/delivery");
  await check("fixed task business evidence unlocks the managed delivery profile", delivery.eligible === true && delivery.deployment.status === "not_configured");
  const release = (await json(base + "/releases", { expectedRevision: revision, verificationId: initialProof.verificationId, idempotencyKey: "tasks-initial-release" })).release;
  const releaseZip = await context.request.get(config.workbench + release.downloadPath);
  await check("actual delivery archive downloads with source and fixed evidence", releaseZip.ok() && releaseZip.headers()["content-type"].startsWith("application/zip"));
  await writeFile(join(config.directory, "tasks-delivery.zip"), await releaseZip.body());

  const brokenRevision = await sourceEdit(source => source.replace("status: editing.status", 'status: "open"'), "break");
  const stale = await json(base + "/delivery");
  const oldPrepare = await context.request.post(config.workbench + base + "/releases", { data: { expectedRevision: brokenRevision,
    verificationId: initialProof.verificationId, idempotencyKey: "tasks-stale-release" } });
  await check("changed source marks previous delivery stale and rejects old verification", !stale.eligible &&
    stale.releases.find(item => item.releaseId === release.releaseId)?.effectiveStatus === "stale" && oldPrepare.status() === 409);
  const failed = await verify("failed", brokenRevision, "broken");
  await check("broken status update fails real task business assertions", failed.assertions.some(item => ["task_edit", "task_filter"].includes(item.id) && item.status === "failed"));
  const repairedRevision = await sourceEdit(source => source.replace('title: editing.title, status: "open"', "title: editing.title, status: editing.status"), "repair");
  await verify("passed", repairedRevision, "repaired");

  report.stage = "source_history";
  const history = await json(base + "/revisions");
  await check("actual source history retains all four immutable source revisions", history.revisions.length === 4 &&
    history.revisions.some(item => item.revision === config.initialRevision) && history.currentRevision === repairedRevision);
  const sourceZip = await context.request.get(config.workbench + base + "/export?revision=" + repairedRevision);
  await check("source export returns a real ZIP", sourceZip.ok() && (await sourceZip.body()).subarray(0, 2).toString() === "PK");
  await writeFile(join(config.directory, "tasks-source.zip"), await sourceZip.body());
  const fork = await json(base + "/fork", { revision: repairedRevision, idempotencyKey: "tasks-source-fork" });
  report.forkedProjectId = fork.projectId;
  const forkedSource = await json(`/api/sliderule/projects/${fork.projectId}/source/file?path=src%2Fmain.tsx`);
  const originalSource = await json(base + "/source/file?path=src%2Fmain.tsx");
  const forkedData = await json(`/api/sliderule/projects/${fork.projectId}/data`);
  await check("source fork makes a separate project without copying business data or secrets", fork.projectId !== config.projectId &&
    forkedSource.content === originalSource.content && forkedData.backup === null);

  report.stage = "stop_checkpoint";
  const stopResponse = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/sliderule/project-operations/${operationId}/cancel`);
  await page.getByRole("button", { name: "停止应用", exact: true }).click();
  const stopped = await stopResponse;
  await check("actual owner stop command is accepted", stopped.ok());
  await waitFor(async () => { const value = await state(), parent = value.operations.find(item => item.operationId === operationId);
    return parent.status === "cancelled" && !value.lease?.sandboxId; }, 90);
  const data = await json(base + "/data");
  await check("normal stop saves a final SQLite checkpoint into durable SQL", data.backup?.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(data.backup.sha256));
  report.applicationDataBackup = data.backup;
  const restoredSource = await json(base + "/restore", { expectedRevision: repairedRevision, targetRevision: revision, idempotencyKey: "tasks-source-restore" });
  await check("stopped source restoration creates a new revision", restoredSource.status === "completed" && restoredSource.revision !== repairedRevision);
  const restoredData = await json(base + "/data/restore", { backupId: data.backup.backupId, expectedVersion: data.backup.version });
  await check("stopped data restoration creates a fenced backup version", restoredData.backup.version > data.backup.version && restoredData.backup.sha256 === data.backup.sha256);
  const started = await json(base + "/runtime/start", { expectedRevision: restoredSource.revision, approvalRef: config.approvalRef, idempotencyKey: "tasks-rebuild" });
  operationId = started.operation.operationId; report.restartedOperationId = operationId;
  previewOrigin = config.secondPreviewOrigin;
  report.stage = "sandbox_rebuild"; await persist();
  const restarted = await ready(restoredSource.revision);
  const newState = await state(); report.restartedSandboxId = newState.lease.sandboxId;
  await check("new sandbox restores the persisted business database before launch", newState.lease.sandboxId !== config.initialSandboxId &&
    restarted.result.applicationData?.sha256 === data.backup.sha256 && restarted.runtime.runtimeId !== new URL(config.previewOrigin).hostname.split(".")[0]);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  frame = await openPreview("登录任务清单");
  await appLogin(frame, username);
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await expect(frame.getByRole("article", { name: editedTitle, exact: true })).toContainText("已完成");
  await check("destroyed sandbox rebuild preserves actual account password and completed task", true);
  await frame.getByRole("button", { name: "退出登录", exact: true }).click();
  await appLogin(frame, reader);
  await expect(frame.getByRole("button", { name: "新增任务", exact: true })).toHaveCount(0);
  const restoredReaderDenied = await applicationRequest("/api/tasks", { title: "must remain forbidden" });
  await check("restored reader retains server-enforced read-only permissions", restoredReaderDenied.status === 403 && restoredReaderDenied.body.error === "只读成员不能修改数据");
  await page.screenshot({ path: join(config.directory, "tasks-restored.png"), fullPage: true });

  report.stage = "ownership";
  const stranger = await browser.newContext();
  await stranger.request.post(config.authority + "/api/sliderule/account/login", { data: { email: config.strangerEmail, password: config.password } });
  for (const path of [base + "/source", base + "/revisions", base + "/export", base + "/data", base + "/delivery",
    `/api/sliderule/project-verifications/${initialProof.verificationId}`,
    `/api/sliderule/project-verifications/${initialProof.verificationId}/artifacts/${initialProof.artifactRefs[0].artifactId}`]) {
    const response = await stranger.request.get(config.authority + path);
    await check("other administrator cannot read " + path.split("/").slice(-1)[0], response.status() === 404);
  }
  await stranger.close();
  report.stage = "apps_workbench";
  await page.goto(config.workbench + "/agent-loop/workbench", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: "我的应用", exact: true }).click();
  const card = page.getByTestId("app-cell-" + config.sessionId);
  await card.waitFor({ timeout: 60000 }); await card.click();
  frame = await openPreview("任务清单");
  await frame.getByRole("article", { name: editedTitle, exact: true }).waitFor();
  await check("application center opens the same restored project and task data", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);
  await check("real private preview HMR WebSocket connects", hmr);
  await check("actual product browser has no uncaught JavaScript errors", report.pageErrors.length === 0);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.name === "Error" && !error.message.includes("\n") && !error.message.includes("http") ? error.message : error.name;
  // Keep the first stack frame in the sanitized artifact so a generic
  // assertion failure can be located without exposing URLs or credentials.
  if (error?.stack) report.errorStack = String(error.stack).split("\n").slice(0, 3).join("\n").replace(/https?:\/\/[^\s)]+/g, "[url]");
  if (page) {
    report.visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
    await page.screenshot({ path: join(config.directory, "tasks-failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  await browser?.close(); await persist();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, report: join(config.directory, "browser-report.json") }));
}
process.exitCode = report.status === "passed" ? 0 : 1;
