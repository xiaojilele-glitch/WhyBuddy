import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPythonUvicornArgs, collectLlmBypassHosts, hostnameFromMaybeUrl, pythonStdioEnv } from "./dev-all.mjs";

function sourceWithoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("buildPythonUvicornArgs enables uvicorn reload when SLIDE_RULE_PYTHON_RELOAD=1", () => {
  const pythonDir = resolve("slide-rule-python");

  const args = buildPythonUvicornArgs(pythonDir, "9700", {
    SLIDE_RULE_PYTHON_RELOAD: "1",
  });

  assert.deepEqual(args, [
    "-m",
    "uvicorn",
    "app:app",
    "--host",
    "127.0.0.1",
    "--port",
    "9700",
    "--reload",
    "--reload-dir",
    pythonDir,
  ]);
});

test("buildPythonUvicornArgs defaults reload off on Windows so worker import runs once", () => {
  const pythonDir = resolve("slide-rule-python");
  const args = buildPythonUvicornArgs(pythonDir, "9700", {});
  if (process.platform === "win32") {
    assert.deepEqual(args, [
      "-m",
      "uvicorn",
      "app:app",
      "--host",
      "127.0.0.1",
      "--port",
      "9700",
    ]);
  } else {
    assert.ok(args.includes("--reload"));
  }
});

test("buildPythonUvicornArgs can disable Python backend reload with env", () => {
  const pythonDir = resolve("slide-rule-python");

  const args = buildPythonUvicornArgs(pythonDir, "9700", {
    SLIDE_RULE_PYTHON_RELOAD: "0",
  });

  assert.deepEqual(args, [
    "-m",
    "uvicorn",
    "app:app",
    "--host",
    "127.0.0.1",
    "--port",
    "9700",
  ]);
});

test("pythonStdioEnv pins utf-8 replace so Windows pipes cannot kill a print", () => {
  const env = pythonStdioEnv({});
  assert.equal(env.PYTHONIOENCODING, "utf-8:replace");
  assert.equal(env.PYTHONUTF8, "1");
  const kept = pythonStdioEnv({
    PYTHONIOENCODING: "gbk",
    PYTHONUTF8: "0",
  });
  assert.equal(kept.PYTHONIOENCODING, "gbk");
  assert.equal(kept.PYTHONUTF8, "0");
});

test("dev:all and dev:sliderule actually pass pythonStdioEnv to the child", () => {
  const allSrc = sourceWithoutComments(
    readFileSync(fileURLToPath(new URL("./dev-all.mjs", import.meta.url)), "utf8")
  );
  const slideruleSrc = sourceWithoutComments(
    readFileSync(fileURLToPath(new URL("./dev-sliderule.mjs", import.meta.url)), "utf8")
  );
  const pyStart = allSrc.indexOf("function startPythonBackend");
  const pyFn = allSrc.slice(pyStart, allSrc.indexOf("async function main()"));
  assert.match(pyFn, /pythonStdioEnv\(/, "dev:all starts python without PYTHONIOENCODING");
  assert.match(
    slideruleSrc,
    /pythonStdioEnv\(/,
    "dev:sliderule starts python without PYTHONIOENCODING"
  );
});

test("hostnameFromMaybeUrl keeps the host and drops the path", () => {
  assert.equal(hostnameFromMaybeUrl("https://llm.example.test/v1"), "llm.example.test");
  assert.equal(hostnameFromMaybeUrl("llm.example.test"), "llm.example.test");
  assert.equal(hostnameFromMaybeUrl(""), "");
});

test("collectLlmBypassHosts includes the live LLM_BASE_URL host", () => {
  const hosts = collectLlmBypassHosts({
    LLM_BASE_URL: "https://llm.example.test/v1",
  });
  assert.ok(hosts.includes("llm.example.test"));
  assert.ok(hosts.includes("api.rcouyi.com"));
});

test("collectLlmBypassHosts includes the session-store HTTPS gateway", () => {
  const hosts = collectLlmBypassHosts({
    APP_STORE_HTTP_API_URL: "https://store.example.test/db-api",
  });
  assert.ok(hosts.includes("store.example.test"));
});

test("collectLlmBypassHosts does not depend on the unused LLM_API_BASE alias", () => {
  const hosts = collectLlmBypassHosts({
    LLM_BASE_URL: "https://only-this.example/v1",
    LLM_API_BASE: "",
    OPENAI_BASE_URL: "",
  });
  assert.ok(hosts.includes("only-this.example"));
  assert.equal(hosts.includes(""), false);
});

test("dev:all awaits python ready before starting vite", () => {
  const src = readFileSync(fileURLToPath(new URL("./dev-all.mjs", import.meta.url)), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const code = sourceWithoutComments(main);
  const client = code.indexOf('run("client"');
  const awaitPy = code.search(/await\s+Promise\.race\(\[\s*python\.readyPromise/);
  assert.ok(client !== -1, "main() no longer starts the vite client");
  assert.ok(awaitPy !== -1, "python wait is still fire-and-forget; vite will ECONNREFUSED on first load");
  assert.ok(awaitPy < client, "vite still starts before python.readyPromise is awaited");
});

test("dev:sliderule starts python and waits before vite", () => {
  const src = readFileSync(fileURLToPath(new URL("./dev-sliderule.mjs", import.meta.url)), "utf8");
  const code = sourceWithoutComments(src);
  const py = code.indexOf('run("python"');
  const vite = code.indexOf('run("vite"');
  assert.ok(py !== -1 && vite !== -1, "dev:sliderule lost python or vite spawn");
  assert.ok(py < vite, "dev:sliderule still starts vite before python");
  assert.match(
    code.slice(py, vite),
    /waitForPortListening/,
    "dev:sliderule starts python but does not wait before vite"
  );
});

test("preflight does not poll free ports after dev:stop", () => {
  const src = readFileSync(fileURLToPath(new URL("./dev-all.mjs", import.meta.url)), "utf8");
  const start = src.indexOf("async function preflightDevPorts()");
  const end = src.indexOf("class PreflightAbort");
  assert.ok(start !== -1 && end > start, "preflightDevPorts missing");
  const code = sourceWithoutComments(src.slice(start, end));
  assert.equal(
    code.includes("waitForPortListening"),
    false,
    "preflight still uses waitForPortListening; empty ports after stop cost ~1.7s"
  );
  assert.match(code, /canConnectToLocalPort/, "preflight lost the one-shot listen probe");
});

test("docker ping is bounded so a missing engine cannot stall startup", () => {
  const src = readFileSync(fileURLToPath(new URL("./dev-all.mjs", import.meta.url)), "utf8");
  const start = src.indexOf("async function isDockerReachable");
  const end = src.indexOf("function hasExplicitProxyEnv");
  assert.ok(start !== -1 && end > start, "isDockerReachable missing");
  const code = sourceWithoutComments(src.slice(start, end));
  assert.match(code, /Promise\.race/, "docker ping has no timeout race");
  assert.match(code, /\b800\b/, "docker ping timeout is no longer 800ms");
});
