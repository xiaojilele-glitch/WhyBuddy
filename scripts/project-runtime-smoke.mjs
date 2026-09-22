import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = join(
  root,
  "slide-rule-python",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
);
if (!existsSync(python))
  throw new Error("Project smoke requires slide-rule-python/.venv");
const args = process.argv.slice(2);
const scripts = new Map([
  ["--preflight", "project-preflight.py"],
  ["--lifecycle", "project-lifecycle-smoke.py"],
  ["--process", "project-process-smoke.py"],
  ["--tools", "project-tools-smoke.py"],
  ["--control", "control-run-smoke.py"],
  ["--control-restart", "control-restart-smoke.py"],
  ["--postgres", "control-postgres-smoke.py"],
  ["--idle-postgres", "project-idle-postgres-smoke.py"],
  ["--verification-postgres", "project-verification-postgres-smoke.py"],
  ["--model", "project-model-smoke.py"],
  ["--private-ingress", "project-private-ingress-smoke.py"],
  ["--preview-tunnel", "project-preview-tunnel-smoke.py"],
  ["--source-sync", "project-source-sync-smoke.py"],
  ["--product", "project-product-smoke.py"],
]);
const script = scripts.has(args[0])
  ? scripts.get(args.shift())
  : "project-runtime-smoke.py";
const result = spawnSync(python, [join(root, "scripts", script), ...args], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
