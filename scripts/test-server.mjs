import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const VITEST_ENTRY = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

const TEST_ROOTS = [
  "server/tests",
  "server/permission",
  "shared",
];

const TEST_FILE_PATTERN = /\.test\.ts$/;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_HEARTBEAT_MS = 30000;
const DEFAULT_BATCH_TIMEOUT_MS = 0;
const DEFAULT_KILL_GRACE_MS = 10000;

function walkFiles(dir, bucket) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, bucket);
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      bucket.push(path.relative(ROOT, fullPath));
    }
  }
}

function collectTestFiles() {
  const files = [];

  for (const relRoot of TEST_ROOTS) {
    const absRoot = path.join(ROOT, relRoot);
    if (!statExists(absRoot)) {
      continue;
    }
    walkFiles(absRoot, files);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function statExists(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function chunk(list, size) {
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

function isCiEnvironment() {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

function getBatchTimeoutMs() {
  const configured = Number.parseInt(process.env.TEST_SERVER_BATCH_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_BATCH_TIMEOUT_MS;
}

function getHeartbeatMs() {
  const configured = Number.parseInt(process.env.TEST_SERVER_HEARTBEAT_MS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_HEARTBEAT_MS;
}

function getKillGraceMs() {
  const configured = Number.parseInt(process.env.TEST_SERVER_KILL_GRACE_MS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_KILL_GRACE_MS;
}

function buildVitestArgs(batch) {
  const args = [
    VITEST_ENTRY,
    "run",
    "--config",
    "vitest.config.server.ts",
    "--pool=forks",
    "--silent",
  ];

  if (process.env.TEST_SERVER_SINGLE_FORK === "1") {
    args.push("--poolOptions.forks.singleFork");
  }

  if (process.env.TEST_SERVER_FILE_PARALLELISM === "0") {
    args.push("--no-file-parallelism");
  }

  return args.concat(batch);
}

async function runBatch(batch, batchIndex, totalBatches, depth = 0) {
  const firstFile = batch[0];
  const lastFile = batch[batch.length - 1];
  const batchLabel = `${batchIndex + 1}/${totalBatches}`;
  const depthLabel = depth > 0 ? ` depth=${depth}` : "";

  console.log(
    `[test:server] Running batch ${batchLabel} (${batch.length} files${depthLabel})`,
  );
  console.log(`[test:server] Files ${firstFile} -> ${lastFile}`);

  const args = buildVitestArgs(batch);

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  const heartbeatMs = getHeartbeatMs();
  const batchTimeoutMs = getBatchTimeoutMs();
  const killGraceMs = getKillGraceMs();
  let timedOut = false;
  let forceKilled = false;

  const heartbeat = setInterval(() => {
    console.log(
      `[test:server] Batch ${batchLabel} still running...`,
    );
  }, heartbeatMs);

  let forceKillHandle = null;
  const timeoutHandle = batchTimeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        console.error(
          `[test:server] Batch ${batchLabel} exceeded ${batchTimeoutMs}ms, terminating child process...`,
        );
        child.kill("SIGTERM");

        forceKillHandle = setTimeout(() => {
          forceKilled = true;
          console.error(
            `[test:server] Batch ${batchLabel} did not exit after ${killGraceMs}ms grace period, forcing kill...`,
          );
          child.kill("SIGKILL");
        }, killGraceMs);
      }, batchTimeoutMs)
    : null;

  return new Promise((resolve, reject) => {
    const clearTimers = () => {
      clearInterval(heartbeat);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
    };

    child.on("error", (error) => {
      clearTimers();
      reject(error);
    });

    child.on("exit", async (code, signal) => {
      clearTimers();

      if (timedOut) {
        if (batch.length === 1) {
          if (forceKilled) {
            console.error(`[test:server] Forced kill file: ${batch[0]}`);
          }
          console.error(`[test:server] Timed out file: ${batch[0]}`);
          process.exit(1);
        }

        const midpoint = Math.ceil(batch.length / 2);
        const left = batch.slice(0, midpoint);
        const right = batch.slice(midpoint);

        console.log(
          `[test:server] Splitting timed out batch ${batchLabel} into ${left.length} + ${right.length} files`,
        );

        await runBatch(left, batchIndex, totalBatches, depth + 1);
        await runBatch(right, batchIndex, totalBatches, depth + 1);
        resolve();
        return;
      }

      if (signal) {
        console.error(`[test:server] Batch terminated by signal ${signal}`);
        process.exit(1);
      }

      if (typeof code === "number" && code !== 0) {
        process.exit(code);
      }

      resolve();
    });
  });
}

const batchSize = Number.parseInt(process.env.TEST_SERVER_BATCH_SIZE ?? "", 10) || DEFAULT_BATCH_SIZE;
const testFiles = collectTestFiles();

if (process.env.TEST_SERVER_SINGLE_FORK === undefined && isCiEnvironment()) {
  process.env.TEST_SERVER_SINGLE_FORK = "0";
}

if (process.env.TEST_SERVER_FILE_PARALLELISM === undefined) {
  process.env.TEST_SERVER_FILE_PARALLELISM = "0";
}

if (process.env.TEST_SERVER_BATCH_TIMEOUT_MS === undefined && isCiEnvironment()) {
  process.env.TEST_SERVER_BATCH_TIMEOUT_MS = "180000";
}

if (testFiles.length === 0) {
  console.error("[test:server] No test files found.");
  process.exit(1);
}

const batches = chunk(testFiles, batchSize);

for (const [index, batch] of batches.entries()) {
  await runBatch(batch, index, batches.length);
}

console.log(`[test:server] Completed ${testFiles.length} files across ${batches.length} batches.`);
