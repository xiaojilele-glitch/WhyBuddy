import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import dotenv from "dotenv";
import Dockerode from "dockerode";

const __devAllDir = dirname(fileURLToPath(import.meta.url));
const __projectRoot = resolve(__devAllDir, "..");

/** Read NO_PROXY from .env file (dotenv does not override pre-set OS env vars on Windows). */
function readNoProxyFromEnvFile() {
  try {
    const text = readFileSync(resolve(__projectRoot, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("NO_PROXY=")) {
        return trimmed.slice("NO_PROXY=".length).trim();
      }
      if (trimmed.startsWith("no_proxy=")) {
        return trimmed.slice("no_proxy=".length).trim();
      }
    }
  } catch {
    /* .env optional */
  }
  return "";
}

const children = [];
let shuttingDown = false;

function loadDevDotenv() {
  // Force .env values (including NO_PROXY for blackaicoding.com / custom LLM hosts) to override
  // any pre-existing system env (common on Windows with Clash etc.). This ensures child
  // processes see the correct NO_PROXY list for direct LLM calls.
  dotenv.config({ override: true });
  // slide-rule-python/.env 也要进进程环境：python 侧的 LLM 客户端
  // (sliderule_llm/config.py) 与 SLIDERULE_LLM_GENERATE_ENABLED 等开关读的是
  // os.environ，pydantic 只读自己声明的字段——不导出则 key/开关静默丢失，
  // 会重现 "publish blocked 0/6"。根目录 .env 优先（先加载的赢，override 下
  // 后加载覆盖，故 python .env 用 override:false 仅补缺）。
  dotenv.config({ path: resolve(__projectRoot, "slide-rule-python", ".env"), override: false });
}

export function resolvePythonReloadArgs(pythonDir, env = process.env) {
  // ⚠ 2026-08-19：Windows 默认关 --reload。WatchFiles 先起 reloader 再起
  // worker，等于 import 两遍；再叠会话 load_all，dev:all 就会在
  // Application startup complete 前空等。要热重载显式 SLIDE_RULE_PYTHON_RELOAD=1。
  const fallback = process.platform === "win32" ? "0" : "1";
  const raw = String(
    env.SLIDE_RULE_PYTHON_RELOAD ?? env.PYTHON_BACKEND_RELOAD ?? fallback
  )
    .trim()
    .toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) {
    return [];
  }
  return ["--reload", "--reload-dir", pythonDir];
}

export function pythonStdioEnv(env = process.env) {
  // CPython：Windows 对 pipe（非控制台）用 ANSI 代码页。dev:all 等就绪时
  // stdout/stderr 就是 pipe，print(⚠) → UnicodeEncodeError，被当成推演失败。
  // 标准答案是 PYTHONIOENCODING=utf-8:replace（sys.stdout 文档）+ PYTHONUTF8=1
  // （PEP 540）。用户显式设过的不覆盖。
  return {
    PYTHONIOENCODING: env.PYTHONIOENCODING || "utf-8:replace",
    PYTHONUTF8: env.PYTHONUTF8 || "1",
  };
}

export function buildPythonUvicornArgs(pythonDir, pythonPort, env = process.env) {
  return [
    "-m",
    "uvicorn",
    "app:app",
    "--host",
    "127.0.0.1",
    "--port",
    pythonPort,
    ...resolvePythonReloadArgs(pythonDir, env),
  ];
}

function resolveCommand(command) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npx")
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteShellArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Hostname of a URL or bare host. Empty / garbage → "". */
export function hostnameFromMaybeUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname;
  } catch {
    return s.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  }
}

/**
 * Hosts that must bypass Clash when `dev:all` injects HTTP_PROXY.
 *
 * ⚠ 2026-08-19：名单原先只有 `LLM_API_BASE` / `OPENAI_BASE_URL`，**漏了
 * 真正在用的 `LLM_BASE_URL`**。换 grok（hello.vangularcode.asia）后面
 * NO_PROXY 还是 api.rcouyi.com，Python httpx 把长请求送进 7890，画页/打孔
 * 502/503/504。硬编码旧网关救不了换供应商。
 */
export function collectLlmBypassHosts(env = process.env) {
  const fromEnv = [
    env.LLM_BASE_URL,
    env.LLM_API_BASE,
    env.LLM_HOST,
    env.OPENAI_API_BASE,
    env.OPENAI_BASE_URL,
    env.FALLBACK_LLM_BASE_URL,
    env.APP_STORE_HTTP_API_URL,
    env.APP_STORE_DATABASE_URL,
  ]
    .map(hostnameFromMaybeUrl)
    .filter(Boolean);
  return Array.from(
    new Set([...fromEnv, "blackaicoding.com", "api.rcouyi.com", "www.su8.codes", "miantuan.ai"])
  );
}

function defaultDockerHost() {
  return process.platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "/var/run/docker.sock";
}

function parseDockerOptions(dockerHost) {
  if (!dockerHost) return {};

  if (dockerHost.startsWith("npipe:")) {
    return {
      socketPath: dockerHost.replace(/^npipe:\/\//, "").replace(/\//g, "\\"),
    };
  }

  if (dockerHost.startsWith("/") || dockerHost.startsWith("\\\\.\\pipe\\")) {
    return { socketPath: dockerHost };
  }

  try {
    const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
    return {
      host: url.hostname,
      port: url.port || "2375",
      protocol: "http",
    };
  } catch {
    return { host: dockerHost };
  }
}

function resolveRequestedExecutionMode() {
  const requestedMode = process.env.LOBSTER_EXECUTION_MODE;
  if (requestedMode === "mock" || requestedMode === "native") {
    return requestedMode;
  }
  return "real";
}

/**
 * `blueprint-v4-full-alignment`：把 v4 全流程的 5 个 env gate 在 dev:all 启动的
 * 子进程里默认翻转为 "true"（opt-out on），让 checks-ledger / content-quality /
 * companion / traceability-matrix / preview-audit 在本地开发链路里默认上电。
 *
 * 与 AUTOPILOT_REAL_RUNTIME 同款语义：用户在 `.env` / shell 里显式设置的值始终
 * 优先（`process.env.X ?? "true"`）。`BUILD_TARGET=test` 路径不经过本脚本，
 * 既有 85+ E2E 基线（gates-off）不受影响。
 */
function resolveV4AlignmentGates() {
  return {
    BLUEPRINT_CHECKS_LEDGER_ENABLED:
      process.env.BLUEPRINT_CHECKS_LEDGER_ENABLED ?? "true",
    BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED:
      process.env.BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED ?? "true",
    BLUEPRINT_COMPANION_ENABLED:
      process.env.BLUEPRINT_COMPANION_ENABLED ?? "true",
    BLUEPRINT_TRACEABILITY_MATRIX_ENABLED:
      process.env.BLUEPRINT_TRACEABILITY_MATRIX_ENABLED ?? "true",
    BLUEPRINT_PREVIEW_AUDIT_ENABLED:
      process.env.BLUEPRINT_PREVIEW_AUDIT_ENABLED ?? "true",
  };
}

async function isDockerReachable(dockerHost) {
  try {
    const docker = new Dockerode(parseDockerOptions(dockerHost));
    // ⚠ 2026-08-19：本机没 Docker 时 npipe 常见立刻 ENOENT（1ms），但部分
    // Windows 上 named pipe connect 会挂到几十秒。dev:stop 之后马上
    // dev:all，这段会变成「清完场却半天没输出」。800ms 内必须给结论。
    await Promise.race([
      docker.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("docker ping timeout")), 800)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

function hasExplicitProxyEnv() {
  return Boolean(
    process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.ALL_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy ||
      process.env.all_proxy ||
      process.env.NODE_USE_ENV_PROXY
  );
}

function canConnectToLocalPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Poll a local TCP port until it either accepts a connection or the timeout expires.
 *
 * Used by `run()` with `portGuard` to distinguish a real crash from a harmless wrapper
 * exit on Windows. On Windows, `npm run` / `npx` goes through `cmd.exe /c` which spawns
 * the real Node process as a separate child; the cmd wrapper often exits with code -1
 * (0xFFFFFFFF / 4294967295) while the underlying listener stays alive. Before treating
 * such an exit as a fatal failure, we verify whether the advertised port is still
 * bound.
 */
async function waitForPortListening(port, { timeoutMs = 800 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToLocalPort(port)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function resolveProxyEnvironment() {
  if (hasExplicitProxyEnv()) {
    return {};
  }

  const localProxyPort = Number(process.env.DEV_AUTO_PROXY_PORT || 7890);
  if (!Number.isFinite(localProxyPort) || localProxyPort <= 0) {
    return {};
  }

  if (!(await canConnectToLocalPort(localProxyPort))) {
    return {};
  }

  const proxyUrl = `http://127.0.0.1:${localProxyPort}`;

  // Robust NO_PROXY construction (V5.3 audit fix for blackaicoding.com / custom LLM):
  // 1. Prefer explicit read from .env (now with override above).
  // 2. Always merge localhost + LLM hosts from env (LLM_BASE_URL is the live knob).
  // 3. Append known custom domains if present in .env or process.
  const envNoProxy = readNoProxyFromEnvFile() || process.env.NO_PROXY || process.env.no_proxy || "";
  const llmHosts = collectLlmBypassHosts(process.env);
  const base = "localhost,127.0.0.1,::1";
  const merged = [envNoProxy, base, ...llmHosts]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const noProxy = Array.from(new Set(merged)).join(",");

  console.warn(
    `[dev:all] Detected local proxy at ${proxyUrl}. Enabling Node env proxy (HTTP_PROXY/HTTPS_PROXY + NODE_USE_ENV_PROXY=1) for dev child processes.`
  );
  console.log(`[dev:all] NO_PROXY for child processes: ${noProxy} (includes LLM hosts from .env + blackaicoding etc.)`);

  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    NODE_USE_ENV_PROXY: "1",
  };
}

async function resolveDevEnvironment() {
  const requestedExecutionMode = resolveRequestedExecutionMode();
  // Task 14（`.kiro/specs/autopilot-capability-runtime-enablement`）：
  // 为所有 dev:all 启动的子进程默认注入 AUTOPILOT_REAL_RUNTIME=true，让
  // blueprint capability bridge 的 env resolver 把 5 条桥的 tier-1 门禁
  // 默认翻转为 "true"。用户显式设置的值始终优先（requirement 1.6）。
  const masterSwitch = process.env.AUTOPILOT_REAL_RUNTIME ?? "true";
  const v4Gates = resolveV4AlignmentGates();
  const proxyEnv = await resolveProxyEnvironment();

  // backend-python-total-cutover-105: make local dev prefer Python for owned API routes via Vite proxy.
  // Explicit flag for client/vite (and children) so resolveApiTarget uses Python target by default.
  const pythonFirstEnv = { VITE_PYTHON_FIRST_API: "true" };

  if (requestedExecutionMode !== "real") {
    return {
      LOBSTER_EXECUTION_MODE: requestedExecutionMode,
      AUTOPILOT_REAL_RUNTIME: masterSwitch,
      ...v4Gates,
      ...proxyEnv,
      ...pythonFirstEnv,
    };
  }

  const dockerHost =
    process.env.LOBSTER_DOCKER_HOST ||
    process.env.DOCKER_HOST ||
    defaultDockerHost();
  const dockerProbeStarted = Date.now();
  const dockerReachable = await isDockerReachable(dockerHost);
  console.log(
    `[dev:all] docker probe ${Date.now() - dockerProbeStarted}ms at "${dockerHost}" (${dockerReachable ? "up" : "unavailable"})`
  );

  if (dockerReachable) {
    return {
      LOBSTER_EXECUTION_MODE: "real",
      AUTOPILOT_REAL_RUNTIME: masterSwitch,
      ...v4Gates,
      ...proxyEnv,
      ...pythonFirstEnv,
    };
  }

  console.warn(
    `[dev:all] Docker is unavailable at "${dockerHost}". Falling back to ` +
      `LOBSTER_EXECUTION_MODE=native so the dev stack can keep running.`
  );

  return {
    LOBSTER_EXECUTION_MODE: "native",
    AUTOPILOT_REAL_RUNTIME: masterSwitch,
    ...v4Gates,
    ...proxyEnv,
    ...pythonFirstEnv,
  };
}

function terminateChild(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore shutdown races
    }
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore shutdown races
      }
    }
  }, 1500);
  forceKillTimer.unref?.();
}

function run(name, command, args = [], extraEnv = {}, options = {}) {
  const {
    waitForReady = false,
    readyText = "",
    portGuard,
    cwd,
    matchStderr = false,
    critical = true,
  } = options;
  const resolvedCommand = resolveCommand(command);
  const child = spawn(
    process.platform === "win32"
      ? [resolvedCommand, ...args].map(quoteShellArg).join(" ")
      : resolvedCommand,
    process.platform === "win32" ? [] : args,
    {
      stdio: waitForReady ? ["inherit", "pipe", "pipe"] : "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
      cwd: cwd || undefined,
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    }
  );

  let readyResolve;
  let readyReject;
  let isReady = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const readyPromise = waitForReady
    ? new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      })
    : Promise.resolve();

  if (waitForReady) {
    child.stdout?.on("data", chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;

      if (!isReady && readyText && stdoutBuffer.includes(readyText)) {
        isReady = true;
        readyResolve?.();
      }
    });

    child.stderr?.on("data", chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer += text;

      // Some servers (e.g. uvicorn) emit their readiness banner on stderr, not stdout.
      if (!isReady && matchStderr && readyText && stderrBuffer.includes(readyText)) {
        isReady = true;
        readyResolve?.();
      }
    });
  }

  child.on("error", error => {
    if (waitForReady && !isReady) {
      readyReject?.(error);
    }

    if (shuttingDown) return;
    if (!critical) {
      console.warn(`[${name}] failed to start: ${error.message}. Continuing without it.`);
      return;
    }
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (waitForReady && !isReady) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      const output = [stdoutBuffer.trim(), stderrBuffer.trim()]
        .filter(Boolean)
        .join("\n");
      readyReject?.(
        new Error(
          output
            ? `[${name}] exited with ${reason}\n${output}`
            : `[${name}] exited with ${reason}`
        )
      );
    }

    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;

    // Non-critical children (e.g. the optional Python backend) must never tear down the
    // whole dev stack when they exit — just report it and keep the rest running.
    if (!critical) {
      console.warn(`[${name}] exited with ${reason}. Dev stack stays up.`);
      return;
    }

    // On Windows, `npm run` / `npx` spawns the real Node process through a `cmd.exe /c`
    // wrapper. The wrapper sometimes exits with code 4294967295 (-1) after forwarding
    // control to the child, while the underlying listener stays alive. If a `portGuard`
    // is configured and the advertised port is still bound, treat this as a benign
    // wrapper exit instead of tearing down the whole dev stack.
    if (portGuard && process.platform === "win32") {
      waitForPortListening(portGuard, { timeoutMs: 800 })
        .then(stillListening => {
          if (shuttingDown) return;
          if (stillListening) {
            console.warn(
              `[${name}] wrapper exited with ${reason}, but port ${portGuard} is still bound. ` +
                `Keeping the dev stack running.`
            );
            return;
          }
          console.error(`[${name}] exited with ${reason}`);
          shutdown(code ?? 1);
        })
        .catch(() => {
          if (shuttingDown) return;
          console.error(`[${name}] exited with ${reason}`);
          shutdown(code ?? 1);
        });
      return;
    }

    console.error(`[${name}] exited with ${reason}`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return { child, readyPromise };
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminateChild(child);
  }

  const exitTimer = setTimeout(
    () => process.exit(exitCode),
    process.platform === "win32" ? 1800 : 400
  );
  exitTimer.unref?.();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/**
 * 启动前哨检查：dev 端口若已被占用，页面实际打到的会是那个"旧进程"，
 * 而不是本次启动的新代码——这曾造成"源码已修好、HTTP 行为还是旧的"的
 * 幽灵现场（占 9700 的端口表属主甚至已经退出 = 监听套接字被孤儿子进程
 * 继承）。策略升级（真实事故：只警告继续跑，起了一套影子服务，用户按
 * "重启"排查了半天）：先自动跑一遍 dev:stop 清场，复查仍被占则拒绝启动
 * （DEV_ALL_ALLOW_BUSY_PORTS=1 可强行放行）。
 */
function devPortEntries() {
  return [
    { port: Number(process.env.VITE_PORT || 3000), name: "vite" },
    { port: 3001, name: "node server" },
    { port: Number(process.env.SLIDE_RULE_PYTHON_PORT || 9700), name: "slide-rule-python" },
    { port: Number(process.env.LOBSTER_EXECUTOR_PORT || 3031), name: "lobster-executor" },
  ];
}

/** One-shot listen probe. Do NOT use waitForPortListening here — that helper
 *  polls until timeout, so four free ports after `dev:stop` cost ~1.7s. */
async function listBusyDevPorts() {
  const busy = [];
  for (const entry of devPortEntries()) {
    if (await canConnectToLocalPort(entry.port)) busy.push(entry);
  }
  return busy;
}

async function preflightDevPorts() {
  const started = Date.now();
  let busy = await listBusyDevPorts();
  if (busy.length) {
    // ⚠ 2026-08-19：刚跑完 dev:stop，监听套接字常还挂 200~800ms。
    // 立刻再跑一遍 Get-CimInstance 等于把 stop 付了两次。短等再探一次。
    await new Promise((r) => setTimeout(r, 400));
    busy = await listBusyDevPorts();
  }
  if (!busy.length) {
    console.log(`[dev:all] preflight ${Date.now() - started}ms (ports free)`);
    return;
  }

  const busyLabel = busy.map(({ port, name }) => `${port} (${name})`).join(", ");
  console.warn(
    `[dev:all] Ports already occupied before startup: ${busyLabel} — running dev:stop to clear them.`
  );
  await new Promise((resolveDone) => {
    const child = spawn(process.execPath, [resolve(__projectRoot, "scripts", "dev-stop.mjs")], {
      cwd: __projectRoot,
      stdio: "inherit",
    });
    child.on("close", () => resolveDone());
    child.on("error", (error) => {
      console.warn(`[dev:all] auto dev:stop failed to run: ${error?.message ?? error}`);
      resolveDone();
    });
  });

  // 清完复查：给内核半秒释放监听套接字
  await new Promise((r) => setTimeout(r, 600));
  const still = [];
  for (const entry of busy) {
    if (await canConnectToLocalPort(entry.port)) still.push(entry);
  }
  if (!still.length) {
    console.log(`[dev:all] ports cleared in ${Date.now() - started}ms - starting fresh stack.`);
    return;
  }

  const stillLabel = still.map(({ port, name }) => `${port} (${name})`).join(", ");
  if (process.env.DEV_ALL_ALLOW_BUSY_PORTS === "1") {
    console.warn(
      `[dev:all] !!! Ports STILL occupied after cleanup: ${stillLabel}. ` +
        `Starting anyway because DEV_ALL_ALLOW_BUSY_PORTS=1 — requests may hit the stale process.`
    );
    return;
  }
  console.error(
    `[dev:all] !!! Ports STILL occupied after dev:stop: ${stillLabel}. ` +
      `Refusing to start a shadowed stack (your new code would never receive requests). ` +
      `If the owner PID is unresolvable in tasklist it is likely a WSL relay — run "wsl --shutdown" ` +
      `(Windows) and retry. To force-start anyway: set DEV_ALL_ALLOW_BUSY_PORTS=1.`
  );
  // 不能用 process.exit()：Windows 上 stdout/stderr 走管道是异步写，exit() 不等
  // 缓冲区刷完就终止进程，上面这条 console.error 会被整条吞掉——真实现场是用户
  // 只看到 "Ports already occupied…" 然后直接回到提示符，既没启动也没有任何原因，
  // 完全无从排查。设 exitCode 让事件循环自然退出，消息才保得住。
  process.exitCode = 1;
  throw new PreflightAbort(stillLabel);
}

/** 端口未清干净时中止启动。单独一个类型，好让 main() 区分"预检拒绝"（已经
 *  打印过原因，静默收场即可）和真异常（需要打印堆栈）。 */
class PreflightAbort extends Error {
  constructor(label) {
    super(`preflight aborted: ports busy (${label})`);
    this.name = "PreflightAbort";
  }
}

function startPythonBackend(sharedDevEnv) {
  const pythonDir = resolve(__projectRoot, "slide-rule-python");
  const pythonExe =
    process.platform === "win32"
      ? resolve(pythonDir, ".venv", "Scripts", "python.exe")
      : resolve(pythonDir, ".venv", "bin", "python");

  if (!existsSync(pythonExe)) {
    console.warn(
      `[dev:all] slide-rule-python venv not found at ${pythonExe}. ` +
        `Skipping Python backend. Run "cd slide-rule-python && python -m venv .venv && pip install -r requirements.txt" to set it up.`
    );
    return null;
  }

  const pythonPort = process.env.SLIDE_RULE_PYTHON_PORT ?? "9700";
  // The backend defaults its runs/events roots to the RELATIVE `.agent-loop/*`,
  // resolved against the process cwd. Since we launch uvicorn with cwd set to the
  // python package dir (so `app:app` imports), pin these to the repo-root absolute
  // paths — otherwise the AgentLoop page reads an empty `slide-rule-python/.agent-loop`
  // and shows zero runs. A user-set value always wins.
  const pythonEnv = {
    ...sharedDevEnv,
    ...pythonStdioEnv(sharedDevEnv),
    AGENT_LOOP_RUNS_DIR:
      process.env.AGENT_LOOP_RUNS_DIR ??
      resolve(__projectRoot, ".agent-loop", "runs"),
    AGENT_LOOP_EVENTS_DIR:
      process.env.AGENT_LOOP_EVENTS_DIR ??
      resolve(__projectRoot, ".agent-loop", "events"),
  };
  return run(
    "slide-rule-python",
    pythonExe,
    buildPythonUvicornArgs(pythonDir, pythonPort),
    pythonEnv,
    {
      cwd: pythonDir,
      portGuard: Number(pythonPort),
      waitForReady: true,
      // uvicorn prints its readiness banner on stderr, so match there.
      readyText: "Application startup complete.",
      matchStderr: true,
      // Optional backend: if it crashes or never boots, keep the rest of the stack alive.
      critical: false,
    }
  );
}

async function main() {
  loadDevDotenv();
  await preflightDevPorts();
  const sharedDevEnv = await resolveDevEnvironment();

  // Explicit visibility: the server child will receive the resolved proxy env (if any).
  if (sharedDevEnv.HTTP_PROXY || sharedDevEnv.HTTPS_PROXY) {
    console.log(
      `[dev:all] Starting server child with proxy: HTTP_PROXY=${sharedDevEnv.HTTP_PROXY ? "set" : ""} ` +
        `HTTPS_PROXY=${sharedDevEnv.HTTPS_PROXY ? "set" : ""} NODE_USE_ENV_PROXY=${sharedDevEnv.NODE_USE_ENV_PROXY || ""} ` +
        `NO_PROXY=${sharedDevEnv.NO_PROXY || sharedDevEnv.no_proxy || "(unset)"}`
    );
  }

  const server = run(
    "server",
    "npm",
    ["run", "dev:server"],
    {
      PORT: "3001",
      ...sharedDevEnv,
    },
    {
      waitForReady: true,
      readyText: "Server running on http://localhost:3001/",
    }
  );
  // Start Python while Node is still booting. Vite proxies /api/sliderule and
  // /api/agent-loop to :9700 when VITE_PYTHON_FIRST_API=true — spawning Vite
  // first is a guaranteed ECONNREFUSED on the first page load.
  const python = startPythonBackend(sharedDevEnv);

  try {
    await Promise.race([
      server.readyPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Timed out waiting for dev server readiness log.")
            ),
          180000
        )
      ),
    ]);
  } catch (error) {
    console.error(
      `[dev:all] ${error instanceof Error ? error.message : String(error)}`
    );
    shutdown(1);
    return;
  }

  // ⚠ 2026-08-19：注释写着「等 uvicorn 起来再开 Vite」，实现却是
  // Promise.race(...).catch(warn) 不等待。Vite 先 ready、Python 还在
  // “Waiting for application startup”，页面一开 /api/sliderule/* 全是
  // ECONNREFUSED。--reload 下 reloader+worker 更慢。慢启动只警告、不拆栈。
  if (python) {
    const pythonWaitStarted = Date.now();
    try {
      await Promise.race([
        python.readyPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("readiness banner timeout")),
            60000
          )
        ),
      ]);
      console.log(`[dev:all] python ready after ${Date.now() - pythonWaitStarted}ms`);
    } catch (error) {
      if (!shuttingDown) {
        console.warn(
          `[dev:all] slide-rule-python did not report ready (${error instanceof Error ? error.message : String(error)}). ` +
            `Continuing; the AgentLoop page may show errors until the Python backend is up.`
        );
      }
    }
  }

  run("client", "npm", ["run", "dev"], sharedDevEnv);
  run(
    "executor",
    "npx",
    ["tsx", "services/lobster-executor/src/index.ts"],
    sharedDevEnv,
    {
      // On Windows the `npx` wrapper sits behind `cmd.exe /c`, which forwards control
      // to the real Node child and then exits with code 4294967295. Guard the exit
      // handler with the executor's listening port (3031) so a benign wrapper exit
      // does not tear down the dev stack.
      portGuard: Number(process.env.LOBSTER_EXECUTOR_PORT ?? 3031),
    }
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // 预检拒绝：原因已经打印过，别再糊一屏堆栈盖住它。其余异常照常抛详情。
    if (!(error instanceof PreflightAbort)) {
      console.error(`[dev:all] ${error?.stack || error}`);
    }
    process.exitCode = 1;
  });
}
