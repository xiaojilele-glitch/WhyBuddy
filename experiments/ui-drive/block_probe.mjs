// 块身份的真机判据（2026-08-27）。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… node block_probe.mjs <输出目录> [会话标题片段]
//
// ## 它证明三件事，缺一条都不算数
//
//   1) **落库的产物里真有块标**  ← 纪律一：改之前先确认那条链真的在跑。
//      2026-08-16 一天打偏三次，三次代码都对、三次装在没通电的插座上。
//      所以第一条判据不看界面，直接读 `GET /apps/{id}` 里的 pages_json。
//   2) **渲染后的 DOM 里块标还在**  ← 纪律五：量用户看见的东西，不量源码。
//      两份 DOMPurify 白名单漏一份就静默剥掉，源码里有、页面上没有。
//   3) **画布上认得出这一块**  ← Ctrl 悬停时高亮框上那行字必须是块身份，
//      而且要跟源 HTML 里那一块**同名**（不是随便报个什么）。
//
// ⚠ 只挑**带块标**的会话：老会话是这次改动之前跑的，本来就没有块标，
//   拿它当样本会得出"功能没生效"的错误结论。
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

const OUT = process.argv[2];
// 会话 id（挑应用用）；第 4 个参数是会话列表里那一行的文字（进 UI 用）。
const WANT = process.argv[3] || '';
const ROW = process.argv[4] || WANT;
const API = 'http://127.0.0.1:3000/api/sliderule';
const log = (...a) => console.log(...a);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const lr = await ctx.request.post(`${API}/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
log('登录', lr.status());
if (lr.status() !== 200) { await b.close(); process.exit(1); }

let bad = 0;
const check = (name, ok, detail = '') => { log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) bad++; };

/* ── 1) 落库的产物 ───────────────────────────────────────────── */
const apps = ((await (await ctx.request.get(`${API}/apps`)).json()).apps || []);
log(`应用 ${apps.length} 个`);
let hit = null;
for (const a of apps.slice(0, 12)) {
  if (WANT && !String(a.session_id || '').includes(WANT) && !String(a.goal || '').includes(WANT)) continue;
  const rec = await (await ctx.request.get(`${API}/apps/${a.id || a.appId}`)).json();
  // ⚠ 页在 `pages_json.pages` 里，不是 `pages_json` 本身：那一层还并排放着
  //   device / navItems / boundPages 等等。直接遍历外层会一页都读不到，而且
  //   报的是"功能没接上链路"——2026-08-27 我自己先踩了一次，量的是错的地方。
  const bundle = rec.pages_json || rec.pagesJson || {};
  const pages = bundle.pages || bundle;
  const list = Array.isArray(pages) ? pages : Object.entries(pages).map(([id, html]) => ({ id, html }));
  const total = list.reduce(
    (n, p) => n + (typeof p.html === 'string' ? (p.html.match(/data-block="/g) || []).length : 0), 0);
  if (total > 0) { hit = { app: a, rec, list, total }; break; }
}
if (!hit) { log('✗ 最近 12 个应用里没有一个带块标——功能没接上链路，或者这一轮还没跑完'); await b.close(); process.exit(1); }

log(`\n应用「${hit.app.name || hit.app.id}」  ${hit.list.length} 页 / ${hit.total} 块`);
const perPage = hit.list.filter(p => typeof p.html === 'string').map(p => {
  const html = p.html;
  const names = [...html.matchAll(/data-block="([^"]*)"[^>]*data-block-kind="([^"]*)"/g)].map(m => `${m[2]}|${m[1]}`);
  return { id: p.id || p.pageId, names };
});
for (const p of perPage) log(`  ${p.id}  ${p.names.length} 块：${p.names.map(n => n.split('|')[1]).join(' / ')}`);
writeFileSync(`${OUT}/blocks.json`, JSON.stringify(perPage, null, 2));
check('1 落库产物里有块标（这条链真的在跑）', hit.total > 0, `${hit.total} 块`);
check('1b 每页都被切成了块（不是只有一页有）',
  perPage.filter(p => p.names.length > 0).length === perPage.length,
  `${perPage.filter(p => p.names.length > 0).length}/${perPage.length} 页`);

/* ── 2) 渲染后的 DOM ─────────────────────────────────────────── */
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
// 从会话列表点进这个应用对应的会话
const row = p.locator(`text=${ROW}`).first();
if (await row.count()) { await row.click(); await p.waitForTimeout(6000); }
for (let i = 0; i < 40; i++) {
  if (!/界面生成中/.test(await p.evaluate(() => document.body.innerText))) break;
  await p.waitForTimeout(3000);
}
// 切到画布档
const canvasBtn = p.getByText(/^画布$/).first();
if (await canvasBtn.count()) { await canvasBtn.click(); await p.waitForTimeout(4000); }
await p.screenshot({ path: `${OUT}/00-画布.png` });

const domBlocks = await p.evaluate(() => {
  const out = [];
  for (const board of document.querySelectorAll('[data-testid="sliderule-canvas-artboard"]')) {
    const d = board.querySelector('iframe')?.contentDocument;
    if (!d?.body) continue;
    out.push([...d.querySelectorAll('[data-block]')].map(e => `${e.getAttribute('data-block-kind')}|${e.getAttribute('data-block')}`));
  }
  return out;
});
const domTotal = domBlocks.reduce((n, a) => n + a.length, 0);
check('2 渲染后的 DOM 里块标还在（没被消毒剥掉）', domTotal > 0, `${domBlocks.length} 块画板 / ${domTotal} 块`);
log(`  画板逐块：${domBlocks.map(a => a.length).join(' / ')}`);

/* ── 3) 画布上认得出这一块 ───────────────────────────────────── */
const target = await p.evaluate(() => {
  for (const board of document.querySelectorAll('[data-testid="sliderule-canvas-artboard"]')) {
    const f = board.querySelector('iframe');
    const d = f?.contentDocument;
    if (!d?.body) continue;
    for (const blk of d.querySelectorAll('[data-block]')) {
      // 挑块里一个有字、够大的元素当落点
      const el = [...blk.querySelectorAll('h1,h2,h3,h4,p,span,td,div')]
        .find(e => (e.textContent || '').trim().length > 2 && e.getBoundingClientRect().width > 30) || blk;
      const r = el.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      if (!(r.width > 0) || !(fb.width > 0)) continue;
      const sx = fb.width / (d.documentElement.clientWidth || f.clientWidth);
      const sy = fb.height / (d.documentElement.clientHeight || f.clientHeight);
      return {
        block: blk.getAttribute('data-block'),
        kind: blk.getAttribute('data-block-kind'),
        x: fb.left + (r.left + r.width / 2) * sx,
        y: fb.top + (r.top + r.height / 2) * sy,
      };
    }
  }
  return null;
});
if (!target) { check('3 画布上找得到一块可悬停的块', false); await b.close(); process.exit(bad ? 1 : 0); }
log(`  落点：${target.kind} / ${target.block}`);

await p.keyboard.down('Control');
await p.mouse.move(target.x - 60, target.y);
await p.waitForTimeout(200);
await p.mouse.move(target.x, target.y);
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/01-悬停报块.png` });
const hoverLabel = await p.evaluate(() =>
  document.querySelector('[data-testid="sliderule-canvas-element-hover"]')?.innerText || '');
const wantLabel = target.block.split(':')[1] || target.block;
check('3 Ctrl 悬停时高亮框报的是**这一块**的名字',
  hoverLabel.includes(wantLabel), `标签「${hoverLabel}」 期望含「${wantLabel}」`);

await p.mouse.click(target.x, target.y);
await p.keyboard.up('Control');
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/02-选中进面板.png` });
const panelBlock = await p.evaluate(() =>
  document.querySelector('[data-testid="sliderule-canvas-panel-block"]')?.innerText || '');
check('3b 右侧面板抬头也报这一块', panelBlock.includes(wantLabel), `徽章「${panelBlock}」`);

/* ── 4) 画板检视器：这一页由哪几块拼成 ─────────────────────── */
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
// ⚠ 检视器不是"点画板就开"：它是顶栏那颗开关
//   （sliderule-canvas-inspector-toggle，跟 canvas-browser-smoke 的 L 条同一颗）。
//   只点画板只会选中它，面板不出来——第一版就这么量出"列了 0 条"，
//   而块清单其实是好的。量错了地方跟功能坏了长得一模一样。
const board = p.locator('[data-testid="sliderule-canvas-artboard"]').first();
await board.click({ position: { x: 20, y: 20 } });
await p.waitForTimeout(500);
await p.click('[data-testid="sliderule-canvas-inspector-toggle"]');
await p.waitForTimeout(1200);
const listed = await p.evaluate(() =>
  [...(document.querySelector('[data-testid="sliderule-canvas-inspector-blocks"]')?.children || [])]
    .map(li => li.innerText.replace(/\s+/g, ' ').trim()));
await p.screenshot({ path: `${OUT}/03-检视器块清单.png` });
log(`  检视器列出：${listed.join(' / ') || '（空）'}`);
check('4 检视器列出这一页由哪几块拼成',
  listed.length === (domBlocks[0]?.length ?? 0) && listed.length > 0,
  `列了 ${listed.length} 条，第一块画板实际 ${domBlocks[0]?.length ?? 0} 块`);

log(`\n${bad ? `✗ ${bad} 条不过` : '✓ 全过'}`);
await b.close();
process.exit(bad ? 1 : 0);
