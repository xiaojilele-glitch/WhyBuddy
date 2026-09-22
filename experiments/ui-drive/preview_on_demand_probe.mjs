// 点开只读预览：整包必须在点击时才拉，且真的渲染出来。
//
// 盯的是 2026-08-22 那次改动最危险的一处——卡片详情改从摘要推之后，
// model/specPages 恒为 null；如果点开时不去拉整包，弹窗就是永远空白，
// 而所有纯函数判据全绿。
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:3000';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
// 匿名（NO_LOGIN=1）：只读预览这条路只有"进不去这个会话"的人才走得到，
// 而登录成本主的账号点自己的卡是直接进会话的，永远开不出弹窗。
if (!process.env.NO_LOGIN) {
  await ctx.request.post(`${BASE}/api/sliderule/account/login`,
    { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
}
const p = await ctx.newPage();
const appGets = [];
p.on('request', r => {
  const m = /\/api\/sliderule\/apps\/([0-9a-f]{8,})(\?|$)/.exec(r.url());
  if (m) appGets.push({ t: Date.now(), id: m[1] });
});
await p.goto(`${BASE}/agent-loop/workbench`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-testid^="app-card-"]', { timeout: 60000 });
await p.waitForTimeout(6000);

const before = appGets.length;
// 挨个点，直到有一张开出只读预览（自己的应用会直接进会话）。
const cards = await p.$$('[data-testid^="app-card-"]');
console.log(`卡片 ${cards.length} 张，点击前已有 /apps/{id} 请求 ${before} 次`);
let opened = false;
for (const c of cards.slice(0, 8)) {
  await c.click({ position: { x: 60, y: 60 } }).catch(() => {});
  await p.waitForTimeout(1200);
  if (await p.$('[data-testid="app-preview-modal"]')) { opened = true; break; }
  if (!p.url().includes('/workbench')) { await p.goBack(); await p.waitForTimeout(2500); }
}
if (!opened) { console.log('✗ 八张都没开出只读预览（可能全是自己的应用）'); await b.close(); process.exit(1); }

const onClick = appGets.length - before;
console.log(`点开预览后新增 /apps/{id} 请求 ${onClick} 次  ${onClick >= 1 ? '✓ 按需拉整包' : '✗ 没拉'}`);
// 等渲染。空态文案还在 = 整包没接上。
let state = '';
for (let i = 0; i < 40; i++) {
  state = await p.evaluate(() => {
    const m = document.querySelector('[data-testid="app-preview-modal"]');
    if (!m) return 'gone';
    if (m.querySelector('iframe')) return 'rendered:iframe';
    const t = m.textContent || '';
    if (t.includes('这一版没有可预览的页面')) return 'empty';
    if (t.includes('预览加载中')) return 'loading';
    return 'rendered:other';
  });
  if (state.startsWith('rendered')) break;
  await p.waitForTimeout(300);
}
console.log(`预览内容：${state}  ${state.startsWith('rendered') ? '✓' : '✗'}`);
await p.screenshot({ path: process.env.SHOT || '/tmp/preview.png' });
await b.close();
process.exit(state.startsWith('rendered') && onClick >= 1 ? 0 : 1);
