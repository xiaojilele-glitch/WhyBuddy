import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startApplication } from "../server.mjs";

const writer = { username: "writer_test", password: "TestWriter!2026" };
const reader = { username: "reader_test", password: "TestReader!2026" };
async function fixture(execute) {
  const root = await mkdtemp(join(tmpdir(), "whybuddy-tasks-test-"));
  const dataDir = join(root, "data"), staticDir = join(root, "dist");
  await mkdir(staticDir); await writeFile(join(staticDir, "index.html"), "<h1>Built task application</h1>");
  let app = await startApplication({ port: 0, dataDir, staticDir });
  const request = async (path, { method = "GET", data, token } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method,
      headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...(token ? { cookie: token } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    const body = await response.json();
    return { status: response.status, body, token: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const restart = async (directory = dataDir) => { await app.close(); app = null; app = await startApplication({ port: 0, dataDir: directory, staticDir }); };
  try { await execute({ request, restart, root, dataDir }); }
  finally { await app?.close(); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\") || resolve(root).startsWith(resolve(tmpdir()) + "/")); await rm(root, { recursive: true, force: true }); }
}

test("HTTP CRUD, filtering and authenticated session survive server restart and SQLite backup restore", async () => {
  await fixture(async ({ request, restart, root, dataDir }) => {
    const before = await request("/api/auth/session"); assert.equal(before.body.setupRequired, true);
    const account = await request("/api/auth/setup", { method: "POST", data: writer });
    assert.equal(account.status, 200); assert.equal(account.body.user.role, "writer");
    const token = account.token;
    const created = await request("/api/tasks", { method: "POST", token, data: { title: "First task" } });
    assert.equal(created.status, 201); assert.equal(created.body.task.status, "open");
    const id = created.body.task.id;
    const edited = await request(`/api/tasks/${id}`, { method: "PATCH", token, data: { title: "Edited task", status: "done" } });
    assert.equal(edited.status, 200); assert.equal(edited.body.task.title, "Edited task");
    assert.equal((await request("/api/tasks?status=open", { token })).body.tasks.length, 0);
    assert.equal((await request("/api/tasks?status=done&q=edited", { token })).body.tasks[0].id, id);
    assert.equal((await request("/api/tasks?q=%27%20OR%201%3D1", { token })).body.tasks.length, 0);
    const database = await readFile(join(dataDir, "tasks.sqlite"));
    assert.equal(database.subarray(0, 16).toString(), "SQLite format 3\0");
    assert.equal(database.includes(Buffer.from(writer.password)), false);
    assert.equal(database.includes(Buffer.from(token.slice(token.indexOf("=") + 1))), false);
    await restart();
    assert.equal((await request("/api/tasks", { token })).body.tasks[0].title, "Edited task");
    const restoredDir = join(root, "restored"); await mkdir(restoredDir);
    await copyFile(join(dataDir, "tasks.sqlite"), join(restoredDir, "tasks.sqlite"));
    await restart(restoredDir);
    assert.equal((await request("/api/tasks", { token })).body.tasks[0].status, "done");
    assert.equal((await request("/api/auth/session", { token })).body.user.username, writer.username);
    assert.equal((await request("/api/auth/setup", { method: "POST", data: { username: "hijacker", password: "NotAllowed!2026" } })).status, 409);
  });
});

test("anonymous and reader writes fail at API even with forged role, while reader can view/filter", async () => {
  await fixture(async ({ request }) => {
    assert.equal((await request("/api/tasks")).status, 401);
    assert.equal((await request("/api/tasks", { method: "POST", data: { title: "Unauthorized" } })).status, 401);
    const writerSession = await request("/api/auth/setup", { method: "POST", data: writer });
    const created = await request("/api/tasks", { method: "POST", token: writerSession.token, data: { title: "Protected" } });
    const member = await request("/api/users", { method: "POST", token: writerSession.token, data: { ...reader, role: "writer" } });
    assert.equal(member.status, 201); assert.equal(member.body.user.role, "reader");
    const readerSession = await request("/api/auth/login", { method: "POST", data: reader });
    assert.equal(readerSession.status, 200);
    assert.equal((await request("/api/tasks?status=open", { token: readerSession.token })).body.tasks.length, 1);
    for (const [path, method, data] of [["/api/tasks", "POST", { title: "Forbidden", role: "writer" }],
      [`/api/tasks/${created.body.task.id}`, "PATCH", { title: "Forbidden", status: "done" }],
      ["/api/users", "POST", { username: "another", password: "Forbidden!2026" }]]) {
      assert.equal((await request(path, { method, token: readerSession.token, data })).status, 403);
    }
    assert.equal((await request("/api/tasks", { token: writerSession.token })).body.tasks[0].title, "Protected");
    assert.equal((await request("/api/auth/login", { method: "POST", data: { ...writer, password: "WrongPassword!" } })).status, 401);
    await request("/api/auth/logout", { method: "POST", token: readerSession.token, data: {} });
    assert.equal((await request("/api/tasks", { token: readerSession.token })).status, 401);
  });
});

test("invalid tasks do not persist and independent static paths never expose application database", async () => {
  await fixture(async ({ request }) => {
    const account = await request("/api/auth/setup", { method: "POST", data: writer });
    for (const data of [{ title: "" }, { title: "x".repeat(161) }, { title: "test", status: "invented" }]) {
      assert.equal((await request("/api/tasks", { method: "POST", token: account.token, data })).status, 400);
    }
    assert.equal((await request("/api/tasks", { token: account.token })).body.tasks.length, 0);
    assert.equal((await request("/tasks.sqlite", { token: account.token })).status, 404);
    assert.equal((await request("/database.mjs", { token: account.token })).status, 404);
  });
});
