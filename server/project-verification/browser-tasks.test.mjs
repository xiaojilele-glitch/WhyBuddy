// Real Chrome, built React UI, real Node API and a separate SQLite directory.
// Prerequisite: npm ci --ignore-scripts && npm run build in the tasks template.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { existsSync } from "node:fs";
import { cp, mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runVerification, TASK_SUITE_VERSION, TASK_ASSERTION_IDS } from "./browser-runner.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const template = join(root, "project-templates/react-vite-tasks");
const chrome = process.env.SLIDERULE_CHROMIUM_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
const revision = "prv-task-browser-fixture";
async function fixture(mutation, execute) {
  const directory = await mkdtemp(join(tmpdir(), "whybuddy-tasks-browser-"));
  const project = join(directory, "project"), data = join(directory, "data");
  await cp(template, project, { recursive: true, filter: file => !file.includes("node_modules") });
  await symlink(join(template, "node_modules"), join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(project, "dist/__whybuddy_revision.json"), JSON.stringify({ revision }));
  if (mutation) {
    const file = join(project, mutation.file), source = await readFile(file, "utf8");
    assert.equal(source.split(mutation.before).length - 1, 1);
    await writeFile(file, source.replace(mutation.before, mutation.after));
  }
  const { startApplication } = await import(pathToFileURL(join(project, "server.mjs")));
  const app = await startApplication({ port: 0, dataDir: data, staticDir: join(project, "dist") });
  const proxy = createServer((request, response) => {
    if (request.url.startsWith("/_whybuddy/authorize?ticket=")) {
      response.writeHead(303, { location: "/", "set-cookie": "WhyBuddyPreview=fixture-private; HttpOnly; SameSite=Strict; Path=/" }); response.end(); return;
    }
    if (!request.headers.cookie?.includes("WhyBuddyPreview=fixture-private")) { response.writeHead(403); response.end(); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: app.server.address().port,
      path: request.url, method: request.method, headers: request.headers }, reply => {
      response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const result = await runVerification({ verificationId: "verify-tasks", revision, suiteVersion: TASK_SUITE_VERSION,
      scope: { origin, projectId: "tasks-project", runtimeId: "tasks-runtime" },
      entryUrl: origin + "/_whybuddy/authorize?ticket=fixture_ticket_12345678901234567890" },
      { allowLoopback: true, assertionTimeoutMs: 600, timeoutMs: 30000, launchOptions: chrome ? { executablePath: chrome } : {} });
    await execute(result, data);
  } finally {
    proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await app.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()))); await rm(directory, { recursive: true, force: true });
  }
}

test("trusted tasks suite executes real setup, CRUD, refresh and independent application RBAC in Chrome", async () => {
  await fixture(null, async (result, data) => {
    assert.equal(result.status, "passed", JSON.stringify({ error: result.errorCode, assertions: result.assertions }));
    assert.equal(result.cleanupConfirmed, true);
    assert.deepEqual(result.assertions.map(item => item.id), TASK_ASSERTION_IDS);
    assert.equal(result.suiteVersion, TASK_SUITE_VERSION);
    assert.equal(result.revisionBefore, revision); assert.equal(result.revisionAfter, revision);
    assert.equal(Object.keys(result.artifacts).length, 2);
    assert.equal((await readFile(join(data, "tasks.sqlite"))).subarray(0, 16).toString(), "SQLite format 3\0");
    // Actual Chrome output must cross the production Python decoder. Separate
    // hand-built fixtures missed task screenshot names being rejected in cloud.
    const python = join(root, "slide-rule-python/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const decoded = JSON.parse(execFileSync(python, ["-c", [
      "import json,sys; from pathlib import Path",
      "sys.path.insert(0,str(Path.cwd()/'slide-rule-python'))",
      "from services.project_browser_provider import decode_result",
      "raw=sys.stdin.read(); wire=json.loads(raw)",
      "value=decode_result(raw,revision=wire['revision'],verification_id=wire['verificationId'],suite_version=wire['suiteVersion'])",
      "print(json.dumps({'status':value['status'],'errorCode':value['errorCode'],'assertions':len(value['assertions']),'artifacts':sorted(value['artifacts'])}))",
    ].join("\n")], { cwd: root, input: JSON.stringify(result), encoding: "utf8", windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 1024 * 1024 }));
    assert.deepEqual(decoded, { status: "passed", errorCode: null, assertions: 13, artifacts: ["tasks-created.png", "tasks-reader.png"] });
    assert.ok(!JSON.stringify(result).includes("fixture_ticket"));
    assert.ok(!JSON.stringify(result).includes("Writer!"));
    assert.ok(!JSON.stringify(result).includes("Reader!"));
  });
});

test("removing actual server writer authorization fails browser API proof even though reader controls stay hidden", async () => {
  await fixture({ file: "server.mjs", before: 'if (user.role !== "writer")', after: "if (false)" }, async result => {
    assert.equal(result.status, "failed", result.errorCode);
    assert.equal(result.assertions.find(item => item.id === "reader_ui_readonly").status, "passed");
    assert.equal(result.assertions.find(item => item.id === "reader_api_forbidden").status, "failed");
  });
});

test("a successful HTTP update without a SQLite mutation cannot pass task edit or refresh assertions", async () => {
  await fixture({ file: "database.mjs", before: 'db.run("UPDATE tasks SET title=?,status=?,updated_at=? WHERE id=?", [title.trim(), status, now, id]);',
    after: 'db.run("UPDATE tasks SET updated_at=? WHERE id=?", [now, id]);' }, async result => {
    assert.equal(result.status, "failed", result.errorCode);
    assert.equal(result.assertions.find(item => item.id === "task_create").status, "passed");
    assert.equal(result.assertions.find(item => item.id === "task_edit").status, "failed");
    assert.equal(result.assertions.find(item => item.id === "task_refresh").status, "failed");
  });
});
