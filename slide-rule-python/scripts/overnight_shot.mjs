/**
 * 过夜查验截图。必须喂本地 Tailwind，否则截到的是无样式原形
 * （experiments/visual-first/render_pages.cjs 同一条纪律）。
 *
 * 用法（仓根）：node slide-rule-python/scripts/overnight_shot.mjs <目录> phone|desktop
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "");
const device = process.argv[3] === "phone" ? "phone" : "desktop";
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node overnight_shot.mjs <dir> phone|desktop");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const twPath = path.join(root, "client/public/vendor/tailwind-play-3.js");
if (!fs.existsSync(twPath)) {
  console.error("no local tailwind:", twPath);
  process.exit(2);
}
const TW = fs.readFileSync(twPath, "utf8");
const viewport = device === "phone" ? { width: 390, height: 844 } : { width: 1920, height: 1080 };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport })).newPage();
await page.route("**cdn.tailwindcss.com**", (r) =>
  r.fulfill({ status: 200, contentType: "application/javascript", body: TW })
);
await page.route("**fonts.googleapis.com**", (r) => r.abort());
await page.route("**fonts.gstatic.com**", (r) => r.abort());
await page.route("**placehold.co**", (r) =>
  r.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#e2e8f0"/></svg>',
  })
);

let bad = 0;
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".html")).sort()) {
  const htmlPath = path.join(dir, name);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => typeof window.tailwind !== "undefined", { timeout: 8000 });
  } catch {
    /* 没编译到也不挡，下面 flexOk 会记 */
  }
  await page.waitForTimeout(900);
  try {
    await page.waitForFunction(
      () => [...document.images].every((i) => i.complete),
      { timeout: 8000 }
    );
  } catch {
    /* 外链图没齐也截，下面日志能看出 */
  }
  const d = await page.evaluate(() => {
    const el = document.querySelector(".flex");
    return {
      tw: typeof window.tailwind !== "undefined",
      flexOk: el ? getComputedStyle(el).display === "flex" : null,
    };
  });
  const out = htmlPath.replace(/\.html$/, ".png");
  await page.screenshot({ path: out, fullPage: false });
  const ok = d.tw && d.flexOk !== false;
  if (!ok) bad++;
  console.log(`${name} tailwind=${d.tw} flex=${d.flexOk}${ok ? "" : "  <- unused shot"}`);
}
await browser.close();
process.exit(bad ? 1 : 0);
