// 用真浏览器驱动**产品界面**跑一次推演，并截图。
//
// ## 为什么必须有这个
//
// 2026-08-22：此前所有审查都是「读代码 + 解析 HTML + 跑判据」，一次都没打开过
// 浏览器。结果是两类问题系统性看不见：
//
// 1. **产品能不能跑起来**。实测本地整页是 Vite 编译错误
//    （`Failed to resolve import "@zumer/snapdom"`，package.json 声明了但
//    node_modules 陈旧没装）。所有判据全绿，而产品打不开。
//
// 2. **用户真正看到的界面**。生成的页面里表格是 `data-rows` **模板行**，
//    克隆由宿主 client/src/pages/sliderule/live-runtime/html-binding-runtime.ts
//    做。独立截 HTML 永远只能看到模板态（表格 1 行 + 大片空白），
//    而产品里宿主会填成几十行——用户截图上那句「已接数据 · 填了 45 处」就是它。
//    拿独立截图判版式/空白，判的是一个不存在的状态。
//
// 用法：node experiments/ui-drive/drive_real_ui.mjs <输出目录> <目标文本>
// 前置：pnpm run dev:all（vite 3000 + python 9700）
import { chromium } from '@playwright/test';

const OUT = process.argv[2], GOAL = process.argv[3];
if (!OUT || !GOAL) { console.error('用法: drive_real_ui.mjs <输出目录> <目标文本>'); process.exit(2); }

// 容器里装的是 chromium-1194，而仓里 @playwright/test 期望更新的版本；
// 不显式指路径会报 "Executable doesn't exist"。**不要 playwright install**。
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });

// ⚠ 必须先登录：推演接口要鉴权，未登录时 POST /drive-full-stream 直接 401，
//   而前端**不会把这个错显示出来**——它只是原地反复重试 PUT /sessions（404），
//   界面停在「2 步 1s」不动。表现完全像「推演很慢」，其实是压根没开始。
//   凭据从环境变量取，不写死在文件里。
const EMAIL = process.env.UI_EMAIL, PASSWORD = process.env.UI_PASSWORD;
if (EMAIL && PASSWORD) {
  const r = await ctx.request.post('http://127.0.0.1:3000/api/sliderule/account/login', {
    data: { email: EMAIL, password: PASSWORD },
  });
  console.log(`  登录 HTTP ${r.status()}${r.ok() ? '' : ' —— 未登录会 401，推演不会开始'}`);
  if (!r.ok()) { await b.close(); process.exit(1); }
} else {
  console.log('  ⚠ 没给 UI_EMAIL / UI_PASSWORD，推演大概率 401');
}
const p = await ctx.newPage();
p.on('console', m => {
  const t = m.text();
  if (/error|Error|失败/i.test(t) && !/favicon/.test(t)) console.log('  [console]', t.slice(0, 130));
});

await p.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/00-landing.png` });

const boxes = await p.locator('textarea, input[type=text]').count();
if (boxes === 0) {
  // 编译错误覆盖层也长这样——先把落地页截下来，不然会误判成「推演没跑」
  console.log('  ✗ 没找到输入框（很可能整页是编译错误覆盖层），见 00-landing.png');
  await b.close(); process.exit(1);
}
const box = p.locator('textarea, input[type=text]').first();
await box.click(); await box.fill(GOAL); await p.waitForTimeout(400);
await p.keyboard.press('Enter');
console.log('  已提交，盯推演…');

const t0 = Date.now();
let last = '';
for (let i = 0; i < 150; i++) {
  await p.waitForTimeout(5000);
  const body = await p.evaluate(() => document.body.innerText.slice(0, 4000));
  const sig = (body.match(/(\d+)\s*步|closed\s*\d\/6|\d+s/g) || []).join(' ');
  if (sig !== last) { console.log(`  [${((Date.now() - t0) / 1000) | 0}s] ${sig.slice(0, 90)}`); last = sig; }
  if (/closed\s*6\/6|本次推演已顺利闭环|成品/.test(body)) { console.log('  ✓ 闭环'); break; }
}
await p.screenshot({ path: `${OUT}/10-done.png` });
console.log(`  用时 ${((Date.now() - t0) / 1000) | 0}s`);
await b.close();
