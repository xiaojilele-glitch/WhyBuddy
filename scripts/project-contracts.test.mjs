import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("project wire contracts are generated and checked from the Python models", () => {
  const result = spawnSync("node", ["scripts/project-contracts.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("generated project schema exposes the server-owned identity and revision fields", async () => {
  const schema = JSON.parse(
    await readFile(join(root, "shared/project-runtime.generated.schema.json"), "utf8"),
  );
  const project = schema.$defs.Project;
  assert.ok(project);
  assert.equal(project.properties.projectId.type, "string");
  assert.equal(project.properties.currentRevision.type, "string");
  assert.deepEqual(project.properties.runtimeKind.const, "project");
});
