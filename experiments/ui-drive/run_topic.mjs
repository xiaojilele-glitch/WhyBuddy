// 在**真产品界面**里跑一个话题，闭环后逐页截图。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… node run_topic.mjs <输出目录> <phone:|desktop:><话题>
//
// ## 与 walk_generated_app.mjs 的区别：闭环判定走 API，不 grep 页面文字
//
// ⚠ 2026-08-22：walk 那版靠 `document.body.innerText` 里出现「closed 6/6」
//   来判闭环。真跑下来**一个字符都没输出**——文案没匹配上，脚本空转到超时，
//   而 node 往文件写 stdout 是块缓冲的，中途连日志都看不到。
//   改成盯 GET /sessions 的 phase：这是服务端的事实，不是界面的措辞。
//
// 下面三条沿用 walk 的教训，别删：
// 1) 等「填了 N 处」再截，不要固定等 N 秒（宿主按 data-rows 克隆行是异步的）
// 2) 每次点击后 iframe 重载，句柄立刻失效，必须重新取 frame
// 3) 未登录时推演接口 401 而前端只是转圈，表现完全像「很慢」——登录失败直接退出
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

// ⚠ 页面里**不止一个** iframe：切过会话之后，上一个会话的 srcdoc 仍然挂在 DOM 里。
//   2026-08-22 实测同一屏三个 iframe，第一个是上一轮「传信通·授信管理」的残留。
//   `frames().find(fr => fr !== mainFrame())` 抓到的就是它——于是药房系统的菜单
//   被读成了「授信/审批/风险/我的」，而截图里明明是「处方录入/复核工作台」。
//   必须按**可见性**选帧，不能按顺序。
async function visibleAppFrame(p) {
  for (const f of p.frames().reverse()) {
    if (f === p.mainFrame()) continue;
    try {
      const el = await f.frameElement();
      const box = await el.boundingBox();
      if (box && box.width > 200 && box.height > 200) return f;
    } catch { /* 帧已卸载 */ }
  }
  return null;
}

const OUT = process.argv[2];
const RAW = process.argv[3];
const wantPhone = /^phone:/.test(RAW);
const GOAL = RAW.replace(/^(phone|desktop):/, '');
const API = 'http://127.0.0.1:3000/api/sliderule';
const log = (...a) => { console.log(...a); };

mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });

const lr = await ctx.request.post(`${API}/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
log('登录', lr.status());
if (lr.status() !== 200) { await b.close(); process.exit(1); }

const before = new Set(
  ((await (await ctx.request.get(`${API}/sessions`)).json()).sessions || []).map(s => s.sessionId));

const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
const nb = p.locator('text=新建会话').first();
if (await nb.count()) { await nb.click(); await p.waitForTimeout(2500); }

if (wantPhone) {
  // ⚠ 侧边栏里有「应用市场」，`:has-text("应用")` 会命中它。限定在输入框那一行、用精确文本。
  const composer = p.locator('form, [class*=composer]').filter({ has: p.locator('textarea') }).first();
  const scope = (await composer.count()) ? composer : p.locator('body');
  const btn = scope.getByText(/^应用$/).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(800); }
  // ★ 点了不算数，必须验证真的切过去了：placeholder 会变成「…手机应用…」
  const ph = await p.locator('textarea').first().getAttribute('placeholder');
  if (!/手机/.test(ph || '')) { log(`✗ 「应用」开关没切过去（提示：${ph}），不提交`); await b.close(); process.exit(1); }
  log('✓ 已切到「应用」（竖屏）');
}

const box = p.locator('textarea, input[type=text]').first();
await box.click(); await box.fill(GOAL); await p.waitForTimeout(400);
await p.keyboard.press('Enter');
log(`已提交：${GOAL.slice(0, 28)}…`);

// —— 闭环判定：盯 API 的 phase，不 grep 界面文字 ——
const t0 = Date.now();
let sid = null;
for (let i = 0; i < 200; i++) {
  await p.waitForTimeout(6000);
  let list = [];
  try { list = ((await (await ctx.request.get(`${API}/sessions`)).json()).sessions || []); } catch {}
  const fresh = list.filter(s => !before.has(s.sessionId));
  if (fresh.length) {
    sid = fresh[0].sessionId;
    if (fresh[0].phase && fresh[0].phase !== 'orchestrating') {
      log(`✓ 闭环 ${((Date.now() - t0) / 1000) | 0}s  phase=${fresh[0].phase}  ${sid}`);
      break;
    }
  }
  if (i % 10 === 0) log(`  [${((Date.now() - t0) / 1000) | 0}s] ${sid ? 'orchestrating' : '等会话出现'}`);
}
if (!sid) { log('✗ 没等到新会话'); await b.close(); process.exit(1); }

const waitFilled = async (ms = 45000) => {
  const s = Date.now();
  while (Date.now() - s < ms) {
    const t = await p.evaluate(() => document.body.innerText);
    const m = t.match(/填了\s*(\d+)\s*处/);
    if (m && +m[1] > 0) return +m[1];
    await p.waitForTimeout(1000);
  }
  return 0;
};
// ⚠ 闭环 ≠ 页面画完。首屏此时常还写着「界面生成中 4/4」，这时候去读菜单
//   读到的是**上一个会话残留的 iframe**——2026-08-22 T1 就这么把药房系统的
//   菜单读成了「授信/审批/风险/我的」（上一轮授信应用的菜单）。
//   必须等这行消失，再读一次。
for (let i = 0; i < 60; i++) {
  const t = await p.evaluate(() => document.body.innerText);
  if (!/界面生成中/.test(t)) break;
  if (i === 0) log('  等页面画完（界面生成中…）');
  await p.waitForTimeout(3000);
}
await p.waitForTimeout(2500);
const filled = await waitFilled();
const meta = await p.evaluate(() => (document.body.innerText.match(/(\d+)×(\d+)/) || [''])[0]);
log(`  首屏 ${meta} 填了 ${filled} 处`);
await p.screenshot({ path: `${OUT}/00-首屏.png` });

let appFrame = await visibleAppFrame(p);
const frame = () => appFrame;
const f0 = appFrame;
if (!f0) { log('  没有可见的应用 iframe'); await b.close(); process.exit(0); }
const labels = await f0.locator('nav a, aside a').allInnerTexts().catch(() => []);
log(`  菜单 ${labels.length} 项：${labels.map(s => s.trim().slice(0, 6)).join(' / ')}`);
for (let i = 0; i < labels.length && i < 6; i++) {
  const label = (labels[i].trim().slice(0, 8).replace(/[^\w一-龥]/g, '')) || `p${i}`;
  try {
    appFrame = (await visibleAppFrame(p)) || appFrame;
    await frame().locator('nav a, aside a').nth(i).click({ timeout: 5000 });
    await waitFilled(30000); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${label}.png` });
    log(`    截 ${label}`);
  } catch (e) { log(`    ${label} 跳过 ${String(e).slice(0, 50)}`); }
}
log(`会话 ${sid}`);
await b.close();
