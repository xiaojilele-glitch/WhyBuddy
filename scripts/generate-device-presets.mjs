/**
 * 预览设备清单：从 Playwright 自带的设备描述表生成，不手抄数字。
 *
 * 为什么是 Playwright 而不是手写一张表：
 *   canvas-scale.tsx 里那句注释早就定了先例——现在的 390×844 就是
 *   「Playwright devices['iPhone 14'] / Chrome DevTools 同款」。Playwright 的
 *   deviceDescriptorsSource.json 本身是跟着 Chrome DevTools 的 emulated devices
 *   走的，且它已经是本仓的 devDependency，本地就有，不必联网也不会过期成孤本。
 *   手抄一张表的问题不是"抄错一次"，是**没人知道它什么时候开始过期**。
 *
 * ⚠ screen 还是 viewport：取 `screen ?? viewport`。
 *   Playwright 的 viewport 是**扣掉浏览器地址栏后**的可视高度（iPhone 15 Pro
 *   393×659），screen 才是整块屏（393×852）。我们预览的是全屏应用/小程序那种
 *   形态，机框里不该留一条看不见的地址栏。取错这个字段，所有 iPhone 都会矮一截，
 *   而且因为数字看着很合理，不会有人发现。老设备（iPhone SE / Galaxy）没有
 *   screen 字段，那时 viewport 就是整块屏，回落即可。
 *
 * 机身边框（bezel/radius）Playwright 不提供，只能自己定；按 phone/tablet 两档，
 * 沿用 canvas-scale 注释里已经引用过的 Flowbite device-mockups 量级。
 *
 * 用法：
 *   node scripts/generate-device-presets.mjs           # 生成
 *   node scripts/generate-device-presets.mjs --check   # CI：过期就红
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
// ⚠ 走 @playwright/test 的**公开** devices 导出，不要去 require
// playwright-core/lib/server/deviceDescriptorsSource.json——那条子路径被
// playwright-core 的 package.json `exports` 挡着（ERR_PACKAGE_PATH_NOT_EXPORTED），
// 而且 pnpm 严格布局下 playwright-core 也不是本仓的直接依赖，解析不到。
import { devices as DESCRIPTORS } from "@playwright/test";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/generated/device-presets.json"
);

/**
 * 策展清单：id → Playwright 设备名。
 *
 * 不是把 207 个全倒出来——那是个下拉滚动地狱，且大半是 2013 年的机器。挑的标准是
 * **比例/尺寸要有区分度**，每一档都能问出"我的页面在这种屏上还成立吗"：
 *   · 320 宽是现存最窄的在售屏，最容易把布局挤爆；
 *   · 430 宽是最大的直板；
 *   · 折叠展开态接近方屏，栅格假设最容易崩；
 *   · 平板进来是因为「移动端」在中文语境里包含 iPad，且它会触发 md:/lg: 断点。
 * 同尺寸的机型只留一个代表（iPhone 12/13/14 都是 390×844，只留 iPhone 14）。
 */
const CURATED = [
  { id: "iphone-se", device: "iPhone SE", label: "iPhone SE", class: "phone" },
  { id: "iphone-12-mini", device: "iPhone 12 Mini", label: "iPhone 12 mini", class: "phone" },
  { id: "iphone-14", device: "iPhone 14", label: "iPhone 12/13/14", class: "phone" },
  { id: "iphone-15-pro", device: "iPhone 15 Pro", label: "iPhone 15/16 Pro", class: "phone" },
  { id: "iphone-15-pro-max", device: "iPhone 15 Pro Max", label: "iPhone 15/16 Pro Max", class: "phone" },
  { id: "galaxy-s24", device: "Galaxy S24", label: "Galaxy S24", class: "phone" },
  { id: "pixel-7", device: "Pixel 7", label: "Pixel 7", class: "phone" },
  { id: "galaxy-z-fold-7", device: "Galaxy Z Fold 7", label: "Galaxy Z Fold 7（展开）", class: "tablet" },
  { id: "ipad-mini", device: "iPad Mini", label: "iPad mini", class: "tablet" },
  { id: "ipad-pro-11", device: "iPad Pro 11", label: 'iPad Pro 11"', class: "tablet" },
];

/** 机身量级。Flowbite device-mockups 同量级；phone 档与改动前的硬编码一致。 */
const FRAME_BY_CLASS = {
  phone: { bezel: 12, bezelBottom: 20, radius: 40, innerRadius: 28 },
  tablet: { bezel: 14, bezelBottom: 18, radius: 24, innerRadius: 12 },
};

/** 默认档：跟改动前的 390×844 同一台，避免升级这次改动就把所有人的预览换了机器。 */
const DEFAULT_ID = "iphone-14";

const missing = CURATED.filter(entry => !DESCRIPTORS[entry.device]);
if (missing.length) {
  console.error(
    `Playwright 设备表里找不到：${missing.map(m => m.device).join(", ")}。\n` +
      `多半是 playwright-core 升级改了名字——去 deviceDescriptorsSource.json 查新名字，` +
      `不要把这些条目悄悄删掉（删掉等于机型清单静默变短）。`
  );
  process.exit(1);
}

const presets = CURATED.map(entry => {
  const d = DESCRIPTORS[entry.device];
  // ⚠ screen 优先：viewport 是扣掉地址栏后的高度，见模块头。
  const box = d.screen ?? d.viewport;
  return {
    id: entry.id,
    label: entry.label,
    deviceClass: entry.class,
    width: box.width,
    height: box.height,
    deviceScaleFactor: d.deviceScaleFactor,
    source: entry.device,
    frame: FRAME_BY_CLASS[entry.class],
  };
});

const dupes = presets.filter(
  (p, i) => presets.findIndex(q => q.width === p.width && q.height === p.height) !== i
);
if (dupes.length) {
  console.error(
    `策展清单里有尺寸完全重复的机型：${dupes.map(d => `${d.label}(${d.width}×${d.height})`).join(", ")}。\n` +
      `清单的意义是比例有区分度，同尺寸只留一个代表。`
  );
  process.exit(1);
}

if (!presets.some(p => p.id === DEFAULT_ID)) {
  console.error(`默认档 ${DEFAULT_ID} 不在清单里。`);
  process.exit(1);
}

const serialized =
  JSON.stringify(
    {
      $comment:
        "由 scripts/generate-device-presets.mjs 从 playwright-core 的设备表生成，请勿手改。改清单去改那个脚本。",
      generatorVersion: 1,
      playwrightTest: require("@playwright/test/package.json").version,
      defaultPresetId: DEFAULT_ID,
      presets,
    },
    null,
    2
  ) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT_FILE)
    ? fs.readFileSync(OUTPUT_FILE, "utf8")
    : "";
  if (current !== serialized) {
    console.error("Device presets are stale. Run: pnpm devices:generate");
    process.exitCode = 1;
  } else {
    console.log("Device presets match the Playwright descriptor table.");
  }
} else {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, serialized);
  console.log(`Generated ${path.relative(ROOT, OUTPUT_FILE)} (${presets.length} presets)`);
}
