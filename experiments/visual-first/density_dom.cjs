/**
 * 交付页密度度量：量**渲染后的 DOM**，不是量 HTML 源码。
 *
 * ## 为什么必须过运行时（2026-08-16 返工）
 *
 * 这条链路的成品**必须经过运行时才成立**：bind 按契约把重复行收成一行模板，
 * 解释器再按记录克隆回来。数源码等于数模板，行越多的页面被低估得越狠。
 *
 * 我因此误报过一次「bind 缩水 18%」。查下来：表格外按钮 40→40 一个没少，
 * 掉的全是被收起来的模板行（p2 没有表格也掉 15%，因为它的 data-rows 是
 * div 做的卡片列表，同样被收成模板）。**bind 没有丢内容，是我数错了。**
 *
 * ⚠ 这是同一类错误当天的第三次（表格永远一行 / 内容区没让位 / bind 缩水），
 *   三次都是**拿静态 HTML 当成品看**。所以度量本身也得过运行时。
 *
 * ## ⚠ 不数字符数——这条仓里早就写着，我没照做
 *
 * img_hop2.py 的判据设计里明写：「不数字符数：上一轮吃过亏——T 路 HTML 一致
 * 更大，但大不等于结构多，**Tailwind 的长 class 串能把任何东西撑大**。」
 *
 * 而我上一版 density.py 数的就是字符数。实测两把尺给出的排序**几乎相反**：
 *
 *     源码字符/页    B 25838 > D 21174 > C 18748 > A 16892
 *     渲染文字量     A 1398  > B 1040  > C 898   > D 653
 *
 * 所以字符数这一项已经删掉，只留能反映**结构与可操作性**的计数。
 *
 * ## 面板/图表用计算样式判，不用 class 名
 *
 * class 是生成侧的自由（换套命名就全失效），而"看起来是不是一块卡片"
 * 是渲染结果的属性：有圆角 + 有边框或阴影 + 尺寸够大。
 *
 * ## 用法
 *
 *     curl -sSL -o /tmp/tailwind.js https://cdn.tailwindcss.com
 *     node density_dom.cjs <app.json>:<标签> [<app.json>:<标签> …]
 *
 * app.json 是 GET /api/sliderule/apps/{id} 的原样落盘（含 model_json 与
 * pages_json）。需要先把绑定运行时打成 driver.js——见文件尾的说明。
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");

//: 绑定运行时的 bundle。**必须是真运行时**，不许在这里另写一份填数逻辑——
//: 另写一份就是"度量用的那套跟线上跑的那套不是同一个东西"，量出来不作数。
//: 生成方式（在仓根跑）：
//:   node_modules/.bin/esbuild <driver.ts> --bundle --format=iife //:     --alias:@=client/src --outfile=/tmp/sliderule-driver.js
//: driver.ts 三行：
//:   import {applyBindings} from "@/pages/sliderule/live-runtime/html-binding-runtime";
//:   import {deriveBindingSource} from "@/pages/sliderule/live-runtime/derive-binding-source";
//:   import {seedRuntimeState} from "@/pages/sliderule/live-runtime/demo-seed";
//:   window.__drive = m => applyBindings(document.body,
//:     {source: deriveBindingSource(m, seedRuntimeState({entities:{},seededEntities:{}}, m))});
const DRIVER = process.env.SLIDERULE_DRIVER_JS || "/tmp/sliderule-driver.js";
const TAILWIND = process.env.TAILWIND_JS || "/tmp/tailwind.js";
const PH = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAT0lEQVR42u3QMQEAAAgDoJnc6BpjDyQgd2XQK4qiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqiKIqi/BcLxgABm5tXAgAAAABJRU5ErkJggg==", "base64");

const MEASURE = () => {
  const px = (v) => parseFloat(v) || 0;
  const els = [...document.querySelectorAll("body *")];
  let panels = 0, charts = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    const s = getComputedStyle(el);
    const rounded = px(s.borderTopLeftRadius) >= 4;
    const framed = px(s.borderTopWidth) > 0 || px(s.borderLeftWidth) > 0 ||
                   (s.boxShadow && s.boxShadow !== "none");
    if (rounded && framed) panels++;
  }
  for (const svg of document.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (r.width * r.height >= 10000) charts++;   // 图标级 svg 排除
  }
  const rowBoxes = [...document.querySelectorAll("[data-rows]")];
  // ⚠ textContent 而不是 innerText：多数页面是 h-screen overflow-hidden，
  //   innerText 会把**被裁切掉**的内容排除，量出来只有首屏那点。
  //   量内容总量用 textContent，裁切情况单独用 首屏文字 暴露。
  const all = (document.body.textContent || "").replace(/\s+/g, "");
  const seen = (document.body.innerText || "").replace(/\s+/g, "");
  return {
    文字量: all.length,
    首屏文字: seen.length,
    页面全高: document.documentElement.scrollHeight,
    面板: panels,
    图表: charts,
    渲染行数: rowBoxes.reduce((n, b) => n + b.children.length, 0),
    表格列数: Math.max(0, ...[...document.querySelectorAll("table")]
      .map(t => t.querySelectorAll("thead th, tr:first-child th").length)),
    交互控件: document.querySelectorAll("button,input,select,textarea,[data-action]").length,
    标题: document.querySelectorAll("h1,h2,h3,h4").length,
  };
};

(async () => {
  const jobs = process.argv.slice(2);           // app.json:标签 …
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    if (/cdn\.tailwindcss\.com/.test(u)) return r.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(TAILWIND, "utf8") });
    if (/placehold|placeholder|dummyimage|picsum/.test(u)) return r.fulfill({ status: 200, contentType: "image/png", body: PH });
    if (/^https?:/.test(u)) return r.abort();
    return r.continue();
  });

  for (const job of jobs) {
    const [file, label] = job.split(":");
    const app = JSON.parse(fs.readFileSync(file, "utf8"));
    const model = app.model_json;
    const pages = app.pages_json.pages;
    const tot = {}; let n = 0;
    console.log(`\n═══ ${label || file} ═══`);
    for (const pid of Object.keys(pages).sort()) {
      const p = await ctx.newPage();
      const html = typeof pages[pid] === "string" ? pages[pid] : (pages[pid].html || "");
      await p.setContent(html, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(1200);
      await p.addScriptTag({ path: DRIVER });
      await p.evaluate((m) => window.__drive(m), model);
      await p.waitForTimeout(400);
      const m = await p.evaluate(MEASURE);
      console.log(`  ${pid}: ` + Object.entries(m).map(([k, v]) => `${k}=${v}`).join("  "));
      for (const [k, v] of Object.entries(m)) tot[k] = (tot[k] || 0) + v;
      n++;
      await p.close();
    }
    console.log(`  ── 均值：` + Object.entries(tot).map(([k, v]) => `${k}=${(v / n).toFixed(1)}`).join("  "));
  }
  await b.close();
})();
