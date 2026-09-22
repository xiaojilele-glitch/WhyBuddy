/**
 * 卡片墙空洞扫描 —— 量真实 DOM，不重建布局逻辑。
 *
 * ## 为什么要有它
 *
 * 跨列（span-positioner.ts）落位时，跨列卡必须放在它要跨的那几列里**最高**那一列
 * 的下沿（放最矮会压住旁边已有的卡）。于是窗口里矮的那些列，从各自原高度到落位点
 * 之间会留下一段永远填不上的死区——高度正好是列间高度差。gestalt 里同样有这个东西，
 * 他们专门算出来打点上报（`multiColumnLayout.ts` 的 additionalWhitespace → logWhitespace）。
 *
 * 麻烦的是它**时有时无**：洞的有无取决于「卡片高度多重集 + 顺序 + 列数」这个具体
 * 组合。同一批 20 个应用实测 4 列 0 洞 / 5 列 2 洞 / 6 列 0 洞 / 3 列 1 洞；新建一个
 * 应用插进序列中间，后面所有卡重排，洞也会跟着挪位甚至消失。所以"看一眼截图没洞"
 * 完全不能作为结论，必须能随时复量。
 *
 * ## 为什么量 DOM 而不是跑定位器
 *
 * 试过在 node 里直接跑 createSpanPositioner，结果对了但**高度模型错了**：当时按
 * 「图下信息区 +52px」算，而 34bd238 已经把信息条改回压在画面上的浮层，真实卡高就是
 * `cellW / aspect`。洞的数量和位置侥幸没受影响（洞来自列间**差值**），但高度报大了
 * 48px。量 DOM 没有这类模型漂移。
 *
 * ## 用法
 *
 *   # dev server 转发到线上后端（两个 target 都指 Node —— /api/agent-loop/sessions
 *   # 是 Node 提供的，指 Python 会 404，墙就空了）
 *   # 地址填当前部署的 Node 服务（docker-compose.prod.yml 那台，默认 :3000）。
 *   # 2026-08-16：原来这里写的是 whybuddy.onrender.com，Render 已不再使用，是死链。
 *   PYTHON_API_TARGET=https://你的线上域名 \
 *   AGENT_LOOP_API_TARGET=https://你的线上域名 npx vite --port 5311
 *
 *   node scripts/app-wall-holes.mjs http://localhost:5311/agent-loop/workbench 1920 out.png
 *
 * 注意只能打 localhost：容器里的 agent 代理只接 HTTPS CONNECT，明文 HTTP 会被它
 * 拦下来回一段说明文字（表现为页面加载成功但内容不对）。
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:5311/agent-loop/workbench";
const viewportWidth = Number(process.argv[3] || 1920);
const shotPath = process.argv[4] || "app-wall.png";

// Keep the CI/container pin, while making the same audit runnable on the
// Windows workstation where Playwright's Chrome channel is installed instead
// of the Linux-only /opt path. An explicit path always wins.
const explicitBrowser = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(explicitBrowser
  ? { executablePath: explicitBrowser }
  : process.platform === "win32"
    ? { channel: "chrome" }
    : { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: viewportWidth, height: 2400 } });
page.on("console", m => {
  if (m.type() === "error") console.log("[console]", m.text().slice(0, 160));
});
await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
await page
  .waitForSelector('[data-testid^="app-cell-"]', { timeout: 60000 })
  .catch(e => console.log("没等到卡片:", e.message.split("\n")[0]));
// 活渲染缩略图是懒挂载的，等它们把高度稳定下来再量
await page.waitForTimeout(8000);

const cells = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-testid^="app-cell-"]')];
  if (!nodes.length) return [];
  // 基准取**最靠上的那张卡**，不是墙容器：apps-wall 是 display:contents，拿不到自己的
  // 盒子，getBoundingClientRect 会退化成整个工作台（含吸顶栏），于是每一列顶部都会
  // 多报一个"洞"，高度恰好等于吸顶栏高（实测 142px 的五个假阳性就是这么来的）。
  const originTop = Math.min(...nodes.map(n => n.getBoundingClientRect().top));
  const originLeft = Math.min(...nodes.map(n => n.getBoundingClientRect().left));
  return nodes.map(n => {
    const r = n.getBoundingClientRect();
    return {
      tier: n.dataset.tier,
      left: Math.round(r.left - originLeft),
      top: Math.round(r.top - originTop),
      w: Math.round(r.width),
      h: Math.round(r.height),
      name: (n.textContent || "").trim().slice(0, 14),
    };
  });
});

if (!cells.length) {
  console.log("没抓到卡片。页面文字：");
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)));
  await page.screenshot({ path: shotPath });
  await browser.close();
  process.exit(1);
}

const lefts = [...new Set(cells.map(c => c.left))].sort((a, b) => a - b);
const columnWidth = Math.min(...cells.map(c => c.w));
const gutter = lefts.length > 1 ? lefts[1] - lefts[0] - columnWidth : 16;
const columnCount = lefts.length;
const columnOf = left => lefts.indexOf(left);
const spanOf = c => Math.round((c.w + gutter) / (columnWidth + gutter));

console.log(
  `卡片 ${cells.length}  列数 ${columnCount}  列宽 ${columnWidth}  间距 ${gutter}`
);
const spanned = cells.filter(c => spanOf(c) > 1);
console.log("跨列卡:", spanned.map(c => `${c.name}(${spanOf(c)}列)`).join("  ") || "无");

// 逐列按 top 排序，相邻两格之间超过一个 gutter 的空隙就是洞。
// 跨列卡要记进它覆盖的**每一列**，否则会把它下面的卡误判成悬空。
const columns = Array.from({ length: columnCount }, () => []);
for (const c of cells) {
  const start = columnOf(c.left);
  for (let j = start; j < start + spanOf(c); j++) columns[j]?.push(c);
}
const holes = [];
columns.forEach((list, ci) => {
  list.sort((a, b) => a.top - b.top);
  let cursor = 0;
  for (const c of list) {
    const gap = c.top - cursor;
    if (gap > gutter + 2) holes.push({ 列: ci, 从: cursor, 到: c.top, 高: gap, 下方是: c.name });
    cursor = Math.max(cursor, c.top + c.h + gutter);
  }
});

console.log(`\n空洞 ${holes.length}`);
if (holes.length) console.table(holes);
const wallHeight = Math.max(...cells.map(c => c.top + c.h));
const holeArea = holes.reduce((s, h) => s + h.高 * columnWidth, 0);
console.log(
  `墙高 ${wallHeight}   空洞面积占比 ${((holeArea / (wallHeight * columnWidth * columnCount)) * 100).toFixed(1)}%`
);

await page.screenshot({ path: shotPath });
console.log("截图", shotPath);
await browser.close();
process.exit(holes.length ? 1 : 0);
