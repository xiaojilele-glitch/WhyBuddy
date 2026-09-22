// 打开一个**已经跑完**的会话，逐页截图。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… node shoot_session.mjs <输出目录> <会话标题片段>
//
// ⚠ 与 run_topic 分开的理由：闭环之后页面还在画（首屏写着「界面生成中 N/N」），
//   那时候读菜单会读到**上一个会话残留的 iframe**。2026-08-22 T1 就这么把药房
//   系统的菜单读成了「授信/审批/风险/我的」（上一轮授信应用的）。
//   这个脚本从会话列表点进去，页面早已画完，读到的一定是这个应用自己的菜单。
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

const OUT = process.argv[2], TITLE = process.argv[3];
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const lr = await ctx.request.post('http://127.0.0.1:3000/api/sliderule/account/login',
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
console.log('登录', lr.status());
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
// ⚠ 侧栏没有 data-session-id，只能按标题文字点。片段要够长够独特——
//   「做一个」这种前缀会命中一堆会话。
const row = p.locator('aside').getByText(TITLE, { exact: false }).first();
if (!(await row.count())) { console.log(`✗ 侧栏里找不到「${TITLE}」`); await b.close(); process.exit(1); }
await row.click();
await p.waitForTimeout(4000);
const title = await p.evaluate(() => document.body.innerText.slice(0, 200));
if (!title.includes(TITLE)) { console.log(`✗ 点开的不是目标会话`); await b.close(); process.exit(1); }

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
const filled = await waitFilled();
const meta = await p.evaluate(() => (document.body.innerText.match(/(\d+)×(\d+)/) || [''])[0]);
console.log(`  ${meta} 填了 ${filled} 处`);
await p.screenshot({ path: `${OUT}/00-首屏.png` });
let appFrame = await visibleAppFrame(p);
const frame = () => appFrame;
if (!appFrame) { console.log('  没有可见的应用 iframe'); await b.close(); process.exit(0); }
const labels = await frame().locator('nav a, aside a').allInnerTexts().catch(() => []);
console.log(`  菜单 ${labels.length} 项：${labels.map(s => s.trim().slice(0, 8)).join(' / ')}`);
for (let i = 0; i < labels.length && i < 6; i++) {
  const label = (labels[i].trim().slice(0, 8).replace(/[^\w一-龥]/g, '')) || `p${i}`;
  try {
    appFrame = (await visibleAppFrame(p)) || appFrame;
    await frame().locator('nav a, aside a').nth(i).click({ timeout: 5000 });
    await waitFilled(30000); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${label}.png` });
    console.log(`    截 ${label}`);
  } catch (e) { console.log(`    ${label} 跳过 ${String(e).slice(0, 46)}`); }
}
await b.close();
