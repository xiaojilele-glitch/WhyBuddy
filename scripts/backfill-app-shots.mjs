/**
 * 给存量应用补封面（2026-08-23）。
 *
 * ## 为什么需要它
 *
 * 封面（shot）只在**推演收口**那一刻由浏览器采一次。2026-08-22 之前还有第二条
 * 路——应用中心的卡片会活渲染，谁逛市场谁的浏览器顺手把图补上（"众包补图"）；
 * 那条路连同卡片活渲染一起删了（同屏十几张把主线程堵四秒）。于是**在那之前就
 * 已经没图的存量应用，再也不会自己长出图来**。查库：68 个应用，45 个没图。
 *
 * 这个脚本把那一次渲染补上：跑一个无头浏览器，用**跟线上收口采集完全同一段
 * 代码**（studio-landing-shot 的落地页选取 + html-app-surface 渲染 +
 * thumb-capture 采集回传）把图补齐。
 *
 * ⚠ 服务端常驻起无头浏览器是被否过的（见 routes/sliderule_full 的
 *   upload_generated_app_shot 头注：那次渲染在用户浏览器里本来就要发生，服务端
 *   再渲一遍是纯浪费）。**一次性回填是另一回事**：这些应用不会再有那次渲染了。
 *   所以这是个跑完就完的脚本，不是常驻服务。
 *
 * ## 用法
 *
 *   # 默认 dry-run：只渲染、只报大小，不写库
 *   node scripts/backfill-app-shots.mjs
 *   # 真写
 *   node scripts/backfill-app-shots.mjs --apply
 *   # 先拿一个试
 *   node scripts/backfill-app-shots.mjs --limit 1 --apply
 *
 * 需要 UI_EMAIL / UI_PASSWORD（覆盖别人的图要 revise 权限，超管可以）。
 * 需要本地 dev 栈在跑（脚本靠它把 TS 源码转给浏览器）。
 *
 * 默认 dry-run 的先例见 slide-rule-python/scripts/backfill_app_badge_counts.py。
 *
 * ## 2026-08-23 那次实跑的结果（留着当基线）
 *
 * 44 个待补，**43 成 · 1 跳过 · 0 失败**。跳过的那个（495d5c91…）是
 * `pages_json` 为 null——库里压根没存过页面 HTML，不是脚本挑不出落地页。
 * 补出来的图 78510 / 87954 / 40028… 字节不等，`image/webp`，画幅跟着
 * app 的 device 走（phone 1440×2560、desktop 走桌面比例），跟收口采的一样。
 *
 * ⚠ 一次跑十几个会把 dev 栈拖久，**分批跑**（--limit 10）比一把梭稳：脚本每次
 *   重新拉"没图的"名单，补过的自动不再出现，所以直接重复跑就是断点续传。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const APPLY = process.argv.includes('--apply');
const argOf = name => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(argOf('--limit') || 0) || Infinity;
const ONLY_ID = argOf('--id');
/** 渲染完等多久再采。跟 studio-landing-shot 的 SETTLE_MS 同一个量级。 */
const SETTLE_MS = 2500;

if (!process.env.UI_EMAIL || !process.env.UI_PASSWORD) {
  console.error('需要 UI_EMAIL / UI_PASSWORD —— 覆盖已有图要 revise 权限。');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const login = await ctx.request.post(`${BASE}/api/sliderule/account/login`, {
  data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD },
});
if (!login.ok()) { console.error('登录失败：HTTP', login.status()); process.exit(2); }

const listed = await (await ctx.request.get(`${BASE}/api/sliderule/apps?limit=200&offset=0`)).json();
let todo = (listed.apps || []).filter(a => !a.has_preview);
if (ONLY_ID) todo = todo.filter(a => a.id === ONLY_ID);
todo = todo.slice(0, LIMIT);
console.log(`${APPLY ? '【真写】' : '【dry-run】'} 待补 ${todo.length} 个（库里没图的共 ${(listed.apps || []).filter(a => !a.has_preview).length} 个）`);

const page = await ctx.newPage();
page.on('console', m => { const t = m.text(); if (t.includes('[landing-shot]')) console.log('     ·', t); });
await page.goto(`${BASE}/agent-loop/workbench`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

let ok = 0, skipped = 0, failed = 0;
for (const [i, app] of todo.entries()) {
  const label = `${String(i + 1).padStart(3)}/${todo.length} ${app.id.slice(0, 8)} ${(app.product_name || app.goal || '').slice(0, 22)}`;
  try {
    const rec = await (await ctx.request.get(`${BASE}/api/sliderule/apps/${app.id}`)).json();
    // 渲染 + 采集的实现住在源码树里（client/src/dev-harness/backfill-shot.tsx）：
    // 内联 evaluate 里 `import('react')` 这类裸模块名不会被 Vite 改写，会直接炸。
    const res = await page.evaluate(async ({ id, pagesJson, modelJson, apply, settle }) => {
      const m = await import('/src/dev-harness/backfill-shot.tsx');
      return await m.renderAndCapture({ appId: id, pagesJson, modelJson, apply, settleMs: settle });
    }, { id: app.id, pagesJson: rec.pages_json, modelJson: rec.model_json, apply: APPLY, settle: SETTLE_MS });

    if (res.skip) { skipped++; console.log(`  ⊘ ${label} — ${res.skip}`); continue; }
    if (res.stored) { ok++; console.log(`  ✓ ${label} — ${res.device}${res.bytes ? ` ${res.bytes} 字节 ${res.type}` : ''}`); }
    else { failed++; console.log(`  ✗ ${label} — 采集/回传没成功（原因见上面 [landing-shot] 那行）`); }
  } catch (e) {
    failed++;
    console.log(`  ✗ ${label} — ${String(e).slice(0, 120)}`);
  }
}
console.log(`\n成功 ${ok} · 跳过 ${skipped} · 失败 ${failed}${APPLY ? '' : '（dry-run，一条都没写库）'}`);
await browser.close();
