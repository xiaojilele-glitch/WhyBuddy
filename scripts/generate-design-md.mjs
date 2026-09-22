/**
 * 每套设计系统 → 一份 DESIGN.md（Google 开源格式，spec: github.com/google-labs-code/design.md）。
 *
 * ## 为什么必须生成、不许手写
 *
 * DESIGN.md 是给**模型**看的，前端那 12 个字段是**真正渲染**的。两份东西描述
 * 同一件事——这正是 identity_theme_presets.json 警告过的形状：
 *
 *   > 两边各写一份的话，提示词说的颜色和实际渲染的颜色会悄悄分叉，
 *   > 而这种分叉只有肉眼比对才看得出来。
 *
 * 所以种子色是唯一真相，DESIGN.md 只是它的投影。改了 design_systems.json 就得
 * 重跑本脚本，`--check` 在 CI 上卡过期。
 *
 * ## 色板派生：为什么这里是近似
 *
 * 真正渲染那份用 MCU 的 HCT（client/src/lib/identity-palette.ts）。这里跟
 * Python 侧的 identity_palette_hint.py 同一个处境：只要**色相一致、意图一致**
 * 就够用，不必为逐位对齐搬一套 HCT 进来。DESIGN.md 里的色值是给模型的锚点，
 * 不是渲染源——渲染仍然走前端那份。
 *
 * ⚠ 但"近似"不等于"随便"：判据会拿两边的**色相**对齐（design-md.test.ts），
 * 偏差超过阈值必红。别把这句注释当成可以乱填的许可。
 *
 * ## 校验用官方 CLI，不自己写
 *
 * `npx @google/design.md lint` 是格式的权威实现。
 * ⚠ 它**有 error 也 exit 0**，必须解析 stdout 的 summary.errors，别看退出码。
 *
 * 用法：
 *   node scripts/generate-design-md.mjs           # 生成
 *   node scripts/generate-design-md.mjs --check   # CI：过期就红
 *   node scripts/generate-design-md.mjs --lint    # 额外跑官方 lint（需要网络）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const TABLE_FILE = path.join(
  ROOT,
  "slide-rule-python/services/data/design_systems.json"
);
const OUT_DIR = path.join(ROOT, "slide-rule-python/services/data/design-md");

const TABLE = require(TABLE_FILE);

/** 圆角档 → 具体像素。与 client 的 design-recipes 同量级。 */
const RADIUS_PX = { none: "0px", sm: "4px", md: "8px", lg: "16px" };

// --- 色板派生（sRGB↔OKLCh 的最小实现，够用且无依赖）-------------------------

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
    srgbToLinear(v / 255)
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L,
    C: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

function oklchToHex({ L, C, h }) {
  const hr = (h * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(v => {
    const c = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return c.toString(16).padStart(2, "0");
  });
  return `#${rgb.join("")}`;
}

/**
 * 种子色 → 色板。派生规则照抄 identity-palette.ts 的意图：
 *   secondary 彩度 ×0.5、tertiary ×0.75、**neutral ×0.2**（关键那一行：
 *   中性灰用主色的色相，绿应用的灰偏绿、橘应用的灰偏暖）。
 */
function derivePalette(seed, dark) {
  const base = hexToOklch(seed);
  const at = (L, cMul, hShift = 0) =>
    oklchToHex({ L, C: base.C * cMul, h: (base.h + hShift + 360) % 360 });
  return {
    primary: seed,
    "on-primary": base.L > 0.65 ? "#1a1a1a" : "#ffffff",
    secondary: at(base.L, 0.5),
    tertiary: at(base.L, 0.75, 60),
    neutral: at(dark ? 0.35 : 0.55, 0.2),
    surface: at(dark ? 0.18 : 0.98, 0.2),
    "on-surface": at(dark ? 0.95 : 0.2, 0.2),
    outline: at(dark ? 0.45 : 0.75, 0.2),
    error: "#d32f2f",
  };
}

function typographyScale(system) {
  const H = system.headlineFont;
  const B = system.bodyFont;
  return {
    "headline-lg": { fontFamily: H, fontSize: "32px", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.02em" },
    "headline-md": { fontFamily: H, fontSize: "24px", fontWeight: 600, lineHeight: 1.3 },
    "body-md": { fontFamily: B, fontSize: "14px", fontWeight: 400, lineHeight: 1.6 },
    "body-sm": { fontFamily: B, fontSize: "12px", fontWeight: 400, lineHeight: 1.5 },
    "label-md": { fontFamily: B, fontSize: "12px", fontWeight: 500, lineHeight: 1.4 },
  };
}

function yaml(obj, indent = 0) {
  const pad = " ".repeat(indent);
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return `${pad}${k}:\n${yaml(v, indent + 2)}`;
      }
      const needsQuote = typeof v === "string" && /^[#\d]/.test(v);
      return `${pad}${k}: ${needsQuote ? `"${v}"` : v}`;
    })
    .join("\n");
}

function renderDesignMd(system) {
  const colors = derivePalette(system.seed, system.dark);
  const front = {
    version: "alpha",
    name: system.label,
    description: system.description,
    colors,
    typography: typographyScale(system),
    rounded: { none: "0px", sm: "4px", md: "8px", lg: "16px", full: "9999px" },
    spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  };

  // ⚠ Do's and Don'ts 是这份文档里**唯一模型猜不出来**的部分。上面那些色值
  //   它照抄就行；下面这些是本仓真机踩出来的约束，缺了它们模型会重新发明一遍
  //   已经被否决过的做法。加规则要写清楚"哪天、什么场景、错在哪"。
  return `---
${yaml(front)}
---

# ${system.label}

## Overview

${system.reference}

${system.description}

主色由种子色 \`${system.seed}\` 派生。中性色**跟随主色色相、彩度压到两成**——
这一条是整套配色的支点：中性灰不是纯灰，绿色系统的灰偏绿、暖色系统的灰偏暖。
手挑的灰永远挑不准这个量。

## Colors

\`primary\` 只出现在**选中态、主按钮、图表**上。菜单与页头保持中性底
（\`surface\`），不要整片铺主色。

\`error\` 只用于真正的失败与破坏性操作，不要拿它当强调色。

## Typography

标题 \`${system.headlineFont}\`，正文 \`${system.bodyFont}\`。正文行高不低于 1.6——
业务系统里长表格和长段落是常态，行高偏紧会显著拖慢扫读。

## Shapes

圆角档位 \`${system.radius}\`（${RADIUS_PX[system.radius]}）。同一屏里不要混用多个圆角档。

## Do's and Don'ts

- **Do** 表格行高不低于 44px：这是触摸目标的下限，手机档直接照搬桌面行高会点不中。
- **Do** 每个列表/表格都要有空态：真机上"没有数据"比"有数据"更早出现。
- **Don't** 用颜色作为唯一的状态区分：状态必须同时有文字或图标，色盲用户看不出绿/红。
- **Don't** 把主色铺满页头或侧栏：主色铺开之后，真正需要被看见的按钮就没有对比度可用了。
- **Don't** 自己发明新的圆角/间距数值：上面 \`rounded\` / \`spacing\` 两档已经够用，
  多一个数值就多一处对不齐。
${system.donts.map(d => `- **Don't** ${d}`).join("\n")}
`;
}

const files = TABLE.systems.map(s => ({
  name: `${s.id}.DESIGN.md`,
  body: renderDesignMd(s),
}));

if (process.argv.includes("--check")) {
  let stale = [];
  for (const f of files) {
    const p = path.join(OUT_DIR, f.name);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    if (cur.replace(/\r\n/g, "\n") !== f.body.replace(/\r\n/g, "\n")) stale.push(f.name);
  }
  if (stale.length) {
    console.error(
      `DESIGN.md is stale: ${stale.join(", ")}. Run: pnpm designmd:generate`
    );
    process.exitCode = 1;
  } else {
    console.log(`DESIGN.md matches design_systems.json (${files.length} systems).`);
  }
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(OUT_DIR, f.name), f.body);
  console.log(`Generated ${files.length} DESIGN.md into ${path.relative(ROOT, OUT_DIR)}`);
}

if (process.argv.includes("--lint")) {
  let bad = 0;
  for (const f of files) {
    const p = path.join(OUT_DIR, f.name);
    // ⚠ 官方 CLI 有 error 也 exit 0，只能解析 stdout。
    const out = execFileSync("npx", ["--yes", "@google/design.md@0.4.0", "lint", p], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const report = JSON.parse(out);
    const n = report.summary?.errors ?? 0;
    if (n > 0) {
      bad += n;
      console.error(`${f.name}: ${n} error(s)`);
      for (const x of report.findings.filter(x => x.severity === "error")) {
        console.error(`  - ${x.path ?? ""} ${x.message}`);
      }
    }
  }
  if (bad > 0) process.exitCode = 1;
  else console.log("Official design.md lint: 0 errors.");
}
