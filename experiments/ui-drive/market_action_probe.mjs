// 量「应用市场点一个菜单动作，代价有多大」。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… [BASE=https://miantuan.ai] node market_action_probe.mjs [输出目录]
//
// ⚠ 这个探针会**真的改一张应用的可见性**。打生产时它会在量完之后**改回原样**
//   ——别人的数据不是量具的耗材。恢复失败会显式报出来，不静默。
//
// 量三件用户真能感觉到的事：
//   ① 卡片有没有整片消失（setApps(null) → 列表清空 → 看起来就是整页刷新）
//   ② 已经滚出来的分页还在不在（61 个应用、PAGE_SIZE=12，滚了几页会不会被打回第一页）
//   ③ 打了几个网络请求（哪些跟这次操作根本无关）
//
// ⚠ 判据落在**渲染后的卡片数**上，不看代码里写没写 reload——本仓的教训是
//   「函数写对了 ≠ 它被调用了」，反过来也一样：没有 location.reload() 不代表
//   用户看到的不是整页刷新。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
const OUT = process.argv[2] || '';
const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
if (OUT) mkdirSync(OUT, { recursive: true });
// ⚠ 打非本机站点时把浏览器接到 HTTPS_PROXY 上。
//
//   2026-08-22 实测：**在 Claude Code 的远程沙箱里这条路走不通**——带不带代理，
//   Chromium 连 https://example.com 都是 ERR_CONNECTION_RESET，浏览器出站是封的
//   （同一环境下 curl 和 ctx.request 都正常，登录还回 200，看着像「站点好好的、
//   只有页面打不开」，很容易误判成目标站的问题）。
//   所以线上验收只能退而求其次：拿 curl 抓已部署的 bundle，在压缩产物里找代码
//   指纹（例：本条修复的 `Math.min(Math.max(PAGE_SIZE,…),PAGE_SIZE*8)` 压缩后是
//   `Math.min(Math.max(db,Ce.current),db*8)`）。那只能证明**代码上线了**，
//   证明不了**行为对**——两者差一档，别混着说。
//   这段配置留着：换个能出网的环境（本机 / CI）就直接可用。
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const REMOTE = !/127\.0\.0\.1|localhost/.test(BASE);
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ...(REMOTE && PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await b.newContext({
  viewport: { width: 1920, height: 1080 },
  ...(REMOTE ? { ignoreHTTPSErrors: true } : {}),
});
const lr = await ctx.request.post(`${BASE}/api/sliderule/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
console.log('登录', lr.status());
const p = await ctx.newPage();

const reqs = [];
p.on('request', r => reqs.push({ t: Date.now(), url: r.url() }));

await p.goto(`${BASE}/agent-loop/workbench`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
// 进「我的应用」
const mine = p.getByText(/^我的应用$/).first();
if (await mine.count()) { await mine.click(); await p.waitForTimeout(3000); }

// ⚠ 数每张卡都有的 `app-menu-`，别数 `app-visibility-`：后者只在**菜单打开时**
//   存在，菜单一开计数就掉到 1-2，看着像列表塌了。第一版就这么把「打开菜单」
//   误读成「清空过」。
const cardCount = () => p.evaluate(() =>
  document.querySelectorAll('[data-testid^="app-menu-"]').length);

// 滚几屏把后面的分页加载出来
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 4000); await p.waitForTimeout(1500); }
await p.waitForTimeout(2000);
const before = await cardCount();
console.log(`滚动加载后，页面上有 ${before} 张卡`);
if (OUT) await p.screenshot({ path: `${OUT}/00-动作前.png` });

// 找一个能点「设为私有 / 设为公开」的卡
const menuBtns = p.locator('[data-testid^="app-menu-"], button[aria-label*="更多"], button[title*="更多"]');
let opened = false;
const n = await menuBtns.count();
for (let i = 0; i < Math.min(n, 5); i++) {
  try {
    await menuBtns.nth(i).click({ timeout: 3000 });
    await p.waitForTimeout(600);
    if (await p.locator('[data-testid^="app-visibility-"]').first().count()) { opened = true; break; }
  } catch { /* 换下一个 */ }
}
if (!opened) {
  console.log('✗ 没找到能打开的卡片菜单（选择器要跟着 UI 走），当前卡数', before);
  await b.close(); process.exit(1);
}

reqs.length = 0;
const t0 = Date.now();
await p.locator('[data-testid^="app-visibility-"]').first().click();

// 逐帧看卡片数，抓「有没有清空过」
let minCards = before, blanked = false, backAt = 0;
for (let i = 0; i < 120; i++) {
  const c = await cardCount();
  minCards = Math.min(minCards, c);
  if (c === 0) blanked = true;
  if (blanked && c >= 12 && !backAt) backAt = Date.now() - t0;
  await p.waitForTimeout(150);
}
const after = await cardCount();
if (OUT) await p.screenshot({ path: `${OUT}/01-动作后.png` });

// ★ 把动过的那张改回原样。生产数据不是量具的耗材。
let restored = 'n/a';
try {
  const again = p.locator('[data-testid^="app-visibility-"]').first();
  // 菜单可能已关，重新打开同一张卡的菜单
  if (!(await again.count())) {
    for (let i = 0; i < 5; i++) {
      try { await menuBtns.nth(i).click({ timeout: 2500 }); await p.waitForTimeout(500); } catch {}
      if (await p.locator('[data-testid^="app-visibility-"]').first().count()) break;
    }
  }
  const btn = p.locator('[data-testid^="app-visibility-"]').first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(2500); restored = '已改回'; }
  else restored = '✗ 没找回那张卡，请手动确认可见性';
} catch (e) { restored = '✗ 恢复失败：' + String(e).slice(0, 60); }

const api = reqs.filter(r => r.url.includes('/api/'));
console.log(`\n点一次「设为私有」的代价（${BASE}）：`);
console.log(`  卡片数     ${before} → 最低 ${minCards} → ${after}   ${blanked ? '★ 整片清空过' : '没有清空'}`);
if (backAt) console.log(`  列表恢复   ${backAt}ms`);
console.log(`  网络请求   ${api.length} 个：`);
const byPath = {};
for (const r of api) { const u = new URL(r.url).pathname; byPath[u] = (byPath[u] || 0) + 1; }
for (const [u, c] of Object.entries(byPath)) console.log(`     ×${c}  ${u}`);
console.log(`  数据复原   ${restored}`);
await b.close();
