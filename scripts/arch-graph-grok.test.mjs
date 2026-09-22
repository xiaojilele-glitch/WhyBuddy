import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const venv = resolve(
  root,
  "slide-rule-python/.venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
);
const python = existsSync(venv)
  ? venv
  : process.platform === "win32"
    ? "python"
    : "python3";

test("grok source inventory and real documentation CLI regressions", () => {
  const r = spawnSync(python, ["scripts/test_grok_module_docs.py", "-v"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  assert.equal(r.status, 0, r.error?.message || r.stdout + r.stderr);
});

test("explicit grok source failure propagates through the package command", () => {
  const r = spawnSync(
    process.execPath,
    ["scripts/arch-graph-all.mjs", "--details", "--only=grok"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GROK_BUILD_ROOT: resolve(root, "__missing_grok_fixture__"),
      },
    }
  );
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /grok-build/);
});
