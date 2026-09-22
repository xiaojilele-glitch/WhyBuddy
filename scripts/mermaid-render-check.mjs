/**
 * 架构图渲染自检：拿仓库自己装的 mermaid 真渲染一遍，语法不过就非零退出。
 *
 *   node scripts/mermaid-render-check.mjs "docs/SlideRule V5.6 架构图.md"
 *   node scripts/mermaid-render-check.mjs <图.md> <出图.png>   # 顺便落 PNG+SVG
 *
 * 为什么值得有：写 V5.6 时我先写了个"节点定义都在不在、subgraph/end 平不平衡"
 * 的静态检查，它全绿——然后真渲染一跑，**连着挂了五次**，每次都是静态检查
 * 看不出来的语法坑：
 *   1. 单独一行的 `%%`（空注释）—— 直接 Parse error on line 1
 *   2. 节点标签 ["…"] 里出现裸英文双引号 —— 标签被提前截断
 *   3. 边标签 -.…​.-> 里出现裸英文双引号 —— 同上
 *   4. 粗箭头标签 ==>|…| 里出现 ASCII 圆括号 —— got 'PS'
 *   5. 点线边标签 -.…​.-> 里出现英文句点 —— 跟 `.->` 定界符撞车（mobile.root）
 * 上面这些都不影响 .md 在编辑器里的观感，只在真渲染时炸——而架构图是给人看
 * 的交付物，"提交了但渲染不出来"等于没写。所以改完图必须跑这个。
 *
 * 报错里的行号是 mermaid **剥掉注释之后**的行号，不是文件行号；定位靠它给的
 * 那段上下文文本去 grep，别直接按行号翻文件。
 *
 * 浏览器用环境预装的 chromium（仓库 @playwright/test 钉的版本常与预装版不一致，
 * 这里显式 executablePath，不要去跑 playwright install）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const src = process.argv[2];
if (!src) {
  console.error("用法: node scripts/mermaid-render-check.mjs <图.md> [出图.png]");
  process.exit(2);
}
const out = process.argv[3];
const raw = readFileSync(src, "utf-8");
// 两种载体都要吃：V5.x 架构图是**裸 mermaid**（整个 .md 就是图源，第一行是 %% 注释），
// 而普通说明文档把图放在 ```mermaid 围栏里。分不清就会把 Markdown 正文喂进解析器，
// 报「No diagram type detected」——那是检查器的锅，不是文档的锅。
const fenced = [...raw.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map(m => m[1]);
const graphs = fenced.length ? fenced : [raw];
if (fenced.length) console.log(`（围栏文档：${fenced.length} 个 mermaid 块，逐块检查）`);

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.SLIDERULE_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await (await browser.newContext({ viewport: { width: 2400, height: 1600 } })).newPage();

const mermaidJs = readFileSync(
  new URL("../node_modules/mermaid/dist/mermaid.min.js", import.meta.url),
  "utf-8"
);

await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
<div id="host"></div></body></html>`);
await page.addScriptTag({ content: mermaidJs });

let failed = 0;
for (const [idx, code] of graphs.entries()) {
const result = await page.evaluate(async graph => {
  // eslint-disable-next-line no-undef
  mermaid.initialize({ startOnLoad: false, maxTextSize: 500000, maxEdges: 2000 });
  try {
    // eslint-disable-next-line no-undef
    await mermaid.parse(graph);
  } catch (e) {
    return { ok: false, phase: "parse", error: String(e.message || e) };
  }
  try {
    // eslint-disable-next-line no-undef
    const { svg } = await mermaid.render("g", graph);
    document.getElementById("host").innerHTML = svg;
    const el = document.querySelector("#host svg");
    el.removeAttribute("style");
    el.setAttribute("width", "2400");
    return {
      ok: true,
      nodes: document.querySelectorAll("#host .node").length,
      edges: document.querySelectorAll("#host .edgePath, #host .flowchart-link").length,
      clusters: document.querySelectorAll("#host .cluster").length,
    };
  } catch (e) {
    return { ok: false, phase: "render", error: String(e.message || e) };
  }
}, code);

console.log(graphs.length > 1 ? `[块 ${idx + 1}] ${JSON.stringify(result)}` : JSON.stringify(result, null, 2));
if (!result.ok) failed++;
if (result.ok && out && idx === 0) {
  // ⚠ 落盘 SVG 必须走 XMLSerializer，不能用 outerHTML（2026-08-18 实测）：
  // outerHTML 是 **HTML 序列化**，foreignObject 里的 <br> 不自闭合——嵌在网页里
  // 没事，但单独打开 .svg 时浏览器按 XML 解析，直接报
  // "Opening and ending tag mismatch: br"，整张图只渲染到第一个 <br> 为止。
  const svg = await page
    .locator("#host svg")
    .evaluate(el => new XMLSerializer().serializeToString(el));
  writeFileSync(out.replace(/\.png$/, ".svg"), svg);
  await page.locator("#host svg").screenshot({ path: out });
  console.log("已落盘:", out);
}
}
await browser.close();
process.exit(failed ? 1 : 0);
