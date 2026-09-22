// 真机跑一次推演，收集 [landing-shot] 采集链日志——回答"收口采集到底断在哪一步"。
//
// ⚠ **必须登录**：POST /drive-full-stream 对匿名返回 401，推演压根不会开始
//   （2026-08-23 实测，第一版没登录，日志里一条 [landing-shot] 都没有，
//   因为根本没跑起来）。用法：
//     UI_EMAIL=... UI_PASSWORD=... node experiments/ui-drive/landing_shot_probe.mjs
//
// ⚠ 会在 APP_STORE 指向的库里真建一条应用记录。本地 .env 若指向线上库，
//   这条就落在线上，跑完记得删。
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:3000';
const GOAL = process.env.GOAL || '做一个小区快递代收点的包裹登记与取件通知系统，含入库、通知、取件核销';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } });
if (!process.env.UI_EMAIL || !process.env.UI_PASSWORD) {
  console.error('需要 UI_EMAIL / UI_PASSWORD——匿名跑推演会被 401 挡下，采集链一步都走不到。');
  process.exit(2);
}
const login = await ctx.request.post(`${BASE}/api/sliderule/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
console.log('登录：HTTP', login.status());
if (!login.ok()) { console.error('登录失败，后面必然白跑'); process.exit(2); }
const p = await ctx.newPage();

const shots = [], errs = [];
p.on('console', m => {
  const t = m.text();
  if (t.includes('[landing-shot]')) { shots.push(t); console.log('  ★', t); }
});
p.on('pageerror', e => errs.push(String(e).slice(0, 200)));

const posts = [];
p.on('request', r => { if (/\/preview(\?|$)/.test(r.url()) && r.method() === 'POST') posts.push(r.url()); });
p.on('response', async r => {
  if (/\/preview(\?|$)/.test(r.url()) && r.request().method() === 'POST')
    console.log('  ▲ POST preview →', r.status());
});

await p.goto(`${BASE}/agent-loop/sliderule`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const ta = p.locator('textarea').first();
await ta.waitFor({ timeout: 30000 });
await ta.fill(GOAL);
await p.locator('[data-testid="sliderule-composer-send"]').click();
console.log('已提交，等待推演…');

const started = Date.now();
let sawRunning = false;
while (Date.now() - started < 900000) {
  await p.waitForTimeout(5000);
  const st = await p.evaluate(() => ({
    pill: document.querySelector('[data-testid="sliderule-composer-status-pill"]')?.textContent?.trim() || '',
    shot: !!document.querySelector('[data-testid="studio-landing-shot"]'),
    iframes: document.querySelectorAll('[data-testid="html-app-surface"]').length,
  }));
  if (st.pill) sawRunning = true;
  const el = Math.round((Date.now() - started) / 1000);
  if (el % 30 === 0 || st.shot) console.log(`  [${el}s] 状态="${st.pill}" 离屏宿主=${st.shot} 页面iframe=${st.iframes}`);
  if (sawRunning && !st.pill) { console.log(`  推演结束于 ${el}s，再等 30s 看采集`); await p.waitForTimeout(30000); break; }
}
console.log('\n=== [landing-shot] 日志 ===');
if (!shots.length) console.log('  （一条都没有）');
for (const s of shots) console.log('  ' + s);
console.log('POST preview 次数:', posts.length);
if (errs.length) console.log('页面异常:', errs.slice(0, 3));
await b.close();
