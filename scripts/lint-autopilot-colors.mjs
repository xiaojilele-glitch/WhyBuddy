#!/usr/bin/env node
/**
 * lint-autopilot-colors.mjs
 *
 * 静态扫描 Phase 1 + Phase 3 autopilot 组件文件中的颜色字面量，
 * 强制颜色取色必须经过 `resolveToken` / `visualTokens` 间接出现。
 *
 * 规则（_Requirements: 17.1, 17.3_）：
 * - 禁止匹配 `#[0-9a-fA-F]{3,8}`（hex literal，如 `#fff`、`#ff00aa`、`#ff00aabb`）
 * - 禁止匹配 `rgb(` / `hsl(` / `oklch(`（CSS color function 字面量）
 * - 命中即失败（exit 1）；未命中输出简要 summary 并 exit 0
 *
 * 豁免逻辑：
 * - 行注释（`// ...`）整行被剥离
 * - 块注释（`/* ... *​/`，跨行）的注释体被剥离
 * - 剥离后的代码再做匹配；这样 docstring / 行注释中提到的反例文本不会触发
 *
 * 软耦合契约：
 * - 这 7 个组件只允许通过 `resolveToken(key, theme)` 或 `visualTokens` 间接使用颜色
 * - 任何对色值的硬编码都属于设计违例
 *
 * 用法：
 *   node scripts/lint-autopilot-colors.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

/** Phase 1 + Phase 3 组件文件清单（路径相对仓库根） */
const TARGET_FILES = [
  "client/src/components/autopilot/EffectPreviewImagePanel.tsx",
  "client/src/components/autopilot/AutopilotImageSettingsPanel.tsx",
  "client/src/components/autopilot/EffectPreviewScheduleTimeline.tsx",
  "client/src/components/autopilot/ProjectMainChainTimeline.tsx",
  "client/src/components/autopilot/CapabilitySnapshotBadges.tsx",
  "client/src/components/autopilot/HorizontalCrossCutBar.tsx",
  "client/src/components/autopilot/CodeBoundarySidebar.tsx",
];

/** 禁用的颜色字面量正则 */
const FORBIDDEN_PATTERNS = [
  { name: "hex", regex: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb", regex: /\brgb\(/ },
  { name: "hsl", regex: /\bhsl\(/ },
  { name: "oklch", regex: /\boklch\(/ },
];

/**
 * 把一段源码中的注释剥离掉，返回与原文等长（按行）的“可分析行”数组。
 *
 * 算法：单次扫描，逐字符判断当前所处状态：
 *   - in-block-comment：遇到 `*​/` 退出
 *   - in-line-comment：遇到换行退出
 *   - 其它字符：原样保留
 * 注释体被替换为同长度空格，保持列号一致以便错误定位。
 */
function stripComments(source) {
  const out = [];
  let i = 0;
  let state = "code"; // "code" | "line-comment" | "block-comment"
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line-comment";
        out.push(" ", " ");
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block-comment";
        out.push(" ", " ");
        i += 2;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (state === "line-comment") {
      if (ch === "\n") {
        state = "code";
        out.push(ch);
        i += 1;
        continue;
      }
      // 注释体替换为空格（保留换行结构）
      out.push(" ");
      i += 1;
      continue;
    }

    // block-comment
    if (ch === "*" && next === "/") {
      state = "code";
      out.push(" ", " ");
      i += 2;
      continue;
    }
    out.push(ch === "\n" ? "\n" : " ");
    i += 1;
  }
  return out.join("");
}

function lintFile(absPath, relPath) {
  if (!existsSync(absPath)) {
    return {
      relPath,
      missing: true,
      violations: [],
    };
  }

  const raw = readFileSync(absPath, "utf8");
  const stripped = stripComments(raw);
  const rawLines = raw.split(/\r?\n/);
  const strippedLines = stripped.split(/\r?\n/);

  const violations = [];
  for (let idx = 0; idx < strippedLines.length; idx += 1) {
    const codeOnly = strippedLines[idx];
    if (codeOnly.length === 0) continue;

    for (const pattern of FORBIDDEN_PATTERNS) {
      const match = codeOnly.match(pattern.regex);
      if (match) {
        violations.push({
          line: idx + 1,
          patternName: pattern.name,
          matched: match[0],
          // 输出原始行，便于人读
          rawLine: rawLines[idx] ?? "",
        });
        // 同一行出现多个不同模式只报第一个，简化输出
        break;
      }
    }
  }

  return { relPath, missing: false, violations };
}

function main() {
  const results = TARGET_FILES.map((rel) =>
    lintFile(resolve(repoRoot, rel), rel),
  );

  let totalViolations = 0;
  let missingFiles = 0;

  for (const r of results) {
    if (r.missing) {
      missingFiles += 1;
      console.error(`✗ ${r.relPath}: file not found`);
      continue;
    }
    for (const v of r.violations) {
      totalViolations += 1;
      console.error(
        `${r.relPath}:${v.line}: [${v.patternName}] ${v.rawLine.trim()}`,
      );
    }
  }

  if (missingFiles > 0) {
    console.error(
      `\nlint:autopilot-colors failed — ${missingFiles} target file(s) missing`,
    );
    process.exit(1);
  }

  if (totalViolations > 0) {
    console.error(
      `\nlint:autopilot-colors failed — ${totalViolations} color literal violation(s) found across ${results.length} file(s).`,
    );
    console.error(
      `Allowed source: only via resolveToken() / visualTokens indirection.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ ${results.length} files checked, no color literal violations.`,
  );
  process.exit(0);
}

main();
