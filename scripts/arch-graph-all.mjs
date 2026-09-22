/**
 * 四张权威架构图的**单一入口**：Python 侧 / TS 侧 / grok-build 对照物。
 *
 * ⚠ 2026-09-08：在这之前只有 TS 侧接进了 package.json（`arch:ts:*`），
 *   Python 侧和 grok 侧只写在 CLAUDE.md 的正文里。结果是「改完代码重新生成」
 *   这条纪律，有两个生成器要靠人从文档里抄路径——抄漏一个，图就和代码脱节，
 *   而脱节只在 pytest 里报红，不在你手边报。四个入口收进这里一处。
 *
 * ⚠ 不写 `python3`：Windows 标准安装没有这个名字（作者在 Windows）。
 *   按 `dev-all.mjs` 同一套解析 venv，venv 不在就退回 PATH 上的解释器——
 *   两个生成器都只用标准库，系统 python 也跑得动。
 *
 * 用法：
 *   node scripts/arch-graph-all.mjs --emit     # 全部重新生成
 *   node scripts/arch-graph-all.mjs --check    # 全部过闸
 *   node scripts/arch-graph-all.mjs --report   # 人看的摘要
 *   node scripts/arch-graph-all.mjs --emit --only=py|ts|grok   # 只跑一侧
 *
 * grok 侧要有对照物才跑：`GROK_BUILD_ROOT`，或仓根兄弟目录 `../grok-build`。
 * 找不到就**跳过并说清楚**，不当失败——对照物不进本仓，CI 上本来就没有。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** venv 优先（跟 dev-all.mjs 同一套），没有就用 PATH 上的。 */
function pythonExe() {
  const venv =
    process.platform === "win32"
      ? resolve(ROOT, "slide-rule-python", ".venv", "Scripts", "python.exe")
      : resolve(ROOT, "slide-rule-python", ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

/** grok-build 对照物在哪。跟 arch-graph-grok.py 同一条查找链。 */
function grokRoot() {
  const env = (process.env.GROK_BUILD_ROOT || "").trim();
  if (env) return env; // Python validates explicit selection; never fall back silently.
  const candidates = [
    env,
    resolve(ROOT, "..", "grok-build"),
    resolve(ROOT, "grok-build"),
  ].filter(Boolean);
  return candidates.find(p => existsSync(resolve(p, "Cargo.toml")));
}

function run(label, cmd, args, opts = {}) {
  process.stdout.write(`\n───── ${label} ─────\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.error) {
    console.error(`[arch] ${label} 起不来：${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

function main(argv) {
  const flags = argv.filter(a => ["--emit", "--check", "--report", "--overview", "--details"].includes(a));
  if (flags.length > 1) {
    console.error("[arch] 一次只选择一种生成/检查模式。");
    return 1;
  }
  const flag = flags[0] || "--report";
  const onlyArg = argv.find(a => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).trim() : "";
  if (only && !["py", "ts", "grok"].includes(only)) {
    console.error(`[arch] 未知生成器：${only}`);
    return 1;
  }
  const grokDocumentMode = ["--overview", "--details"].includes(flag);
  if (grokDocumentMode && only && only !== "grok") {
    console.error("[arch] overview/details 只适用于 grok。");
    return 1;
  }
  const wants = name => !only || only === name;
  const py = pythonExe();
  let failed = 0;

  if (wants("py") && !grokDocumentMode) {
    failed += run("Python 侧", py, ["slide-rule-python/arch_graph.py", flag]) ? 1 : 0;
  }
  if (wants("ts") && !grokDocumentMode) {
    failed += run("TS 侧", process.execPath, ["scripts/arch-graph-ts.mjs", flag]) ? 1 : 0;
  }
  if (!wants("grok")) {
    if (failed) {
      console.error(`\n[arch] ${failed} 个生成器没过。`);
      return 1;
    }
    process.stdout.write("\n[arch] 全部完成。\n");
    return 0;
  }

  const grok = grokRoot();
  if (!grok) {
    if (only === "grok" || grokDocumentMode) {
      console.error("[arch] 找不到指定任务需要的 grok-build；请设置 GROK_BUILD_ROOT。");
      return 1;
    }
    process.stdout.write(
      "\n───── grok-build 对照 ─────\n" +
        "跳过：没找到 grok-build。设 GROK_BUILD_ROOT，或放到仓根兄弟目录 ../grok-build。\n"
    );
  } else {
    failed += run("grok-build 对照", py, ["scripts/arch-graph-grok.py", flag], {
      env: { ...process.env, GROK_BUILD_ROOT: grok },
    })
      ? 1
      : 0;
  }

  if (failed) {
    console.error(`\n[arch] ${failed} 个生成器没过。`);
    return 1;
  }
  process.stdout.write("\n[arch] 全部完成。\n");
  return 0;
}

process.exit(main(process.argv.slice(2)));
