// 量「打开应用中心，多久能看到第一批卡」以及首屏打了哪些请求、多大。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… [BASE=…] node gallery_load_probe.mjs
//
// ⚠ 只读，不点任何菜单、不改任何数据。
// ⚠ 量的是**渲染出第一张卡的时刻**，不是 load 事件——用户感知的是前者。
import { chromium } from '@playwright/test';
const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const lr = await ctx.request.post(`${BASE}/api/sliderule/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
console.log('登录', lr.status());
const p = await ctx.newPage();

// ★ 同时在飞的请求数 —— 这才是「并发还是串行」的判据。
//   DevTools 里一排「待处理」看着像排队，其实同一瞬间全 pending = 全在飞。
//   串行的话任一时刻只有 1 个 pending。
let inflight = 0, maxInflight = 0;
const flight = [];
p.on('request', r => {
  if (!r.url().includes('/api/')) return;
  inflight++; maxInflight = Math.max(maxInflight, inflight);
  flight.push({ t: Date.now(), n: inflight });
});
p.on('requestfinished', r => { if (r.url().includes('/api/')) inflight--; });
p.on('requestfailed', r => { if (r.url().includes('/api/')) inflight--; });

const reqs = [];
p.on('response', async r => {
  const u = r.url();
  if (!u.includes('/api/')) return;
  let size = 0;
  try { size = (await r.body()).length; } catch { /* 流式/已释放 */ }
  reqs.push({ t: Date.now(), path: new URL(u).pathname, size, status: r.status() });
});

const t0 = Date.now();
await p.goto(`${BASE}/agent-loop/workbench`, { waitUntil: 'domcontentloaded' });
const domAt = Date.now() - t0;

// 第一张卡出现的时刻 —— 用户真正感知的「加载好了」
let firstCardAt = null, cards = 0;
for (let i = 0; i < 200; i++) {
  cards = await p.evaluate(() =>
    document.querySelectorAll('[data-testid^="app-menu-"]').length).catch(() => 0);
  if (cards > 0) { firstCardAt = Date.now() - t0; break; }
  await p.waitForTimeout(100);
}
await p.waitForTimeout(4000);
const settled = await p.evaluate(() =>
  document.querySelectorAll('[data-testid^="app-menu-"]').length).catch(() => 0);

console.log(`\n打开应用中心（${BASE}）：`);
console.log(`  DOM 就绪      ${domAt}ms`);
console.log(`  第一张卡出现  ${firstCardAt === null ? '✗ 没等到' : firstCardAt + 'ms'}`);
console.log(`  4s 后卡片数   ${settled}`);
const total = reqs.reduce((s, r) => s + r.size, 0);
console.log(`  首屏 API      ${reqs.length} 个，共 ${(total / 1024).toFixed(0)} KB`);
console.log(`  最大同时在飞  ${maxInflight} 个  ${maxInflight <= 2 ? '← 串行' : '← 并发'}`);
const agg = {};
for (const r of reqs) {
  const k = r.path.replace(/\/apps\/[0-9a-f-]{8,}.*/, '/apps/{id}…');
  agg[k] = agg[k] || { n: 0, size: 0, first: r.t - t0 };
  agg[k].n++; agg[k].size += r.size;
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].size - a[1].size)) {
  console.log(`     ×${String(v.n).padStart(2)}  ${(v.size / 1024).toFixed(0).padStart(5)} KB  ${String(v.first).padStart(5)}ms  ${k}`);
}
await b.close();
