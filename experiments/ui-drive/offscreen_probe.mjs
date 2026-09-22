// 量「首屏主体区被顶出视口」——一整页内容都在，但用户一眼看到的是空白。
//
// 2026-08-22 真机（连锁药房 p2 复核工作台）：内容全在 DOM 里，可 <main> 的
// 顶边在 y=1144，而视口只有 1080——main 自己 overflow:hidden，全被裁掉。
// 成因：模型给 <body> 写了 `w-full h-full` 但**没写 flex**，而 <aside> 在
// 文档流里，于是它独占一整行（256×1080），把 header 顶到 1080、main 顶到 1144。
//
// ⚠ 这条不是本次四步引入的：同一份 HTML 换回 84121aa4 的 CSS，结果一模一样。
// ⚠ 也不是「没生成内容」：main 里有 200 行、5000 字。判据必须落在**渲染后的
//   位置**上，量源码字数会说这页很丰满。
import { chromium } from '@playwright/test';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
const [ROOT, TW] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const dev of ['phone', 'desktop']) {
  const vp = dev === 'phone' ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  await p.route('**://**', r => {
    const u = r.request().url();
    if (u.startsWith('file:')) return r.continue();
    if (/tailwind/.test(u)) return r.fulfill({ path: TW, contentType: 'application/javascript' });
    return r.abort();
  });
  let n = 0, hit = 0;
  for (const d of readdirSync(ROOT).filter(x => x.startsWith(dev + '__') && statSync(join(ROOT, x)).isDirectory()))
    for (const f of readdirSync(join(ROOT, d)).filter(x => x.endsWith('.html'))) {
      await p.goto('file://' + resolve(ROOT, d, f), { waitUntil: 'load' });
      await p.waitForTimeout(500);
      const r = await p.evaluate(() => {
        const m = document.querySelector('main');
        if (!m) return null;
        const bb = m.getBoundingClientRect();
        // 首屏里 main 露出来多少
        const visible = Math.max(0, Math.min(bb.bottom, innerHeight) - Math.max(bb.top, 0));
        const body = document.body;
        return {
          top: Math.round(bb.top), visible: Math.round(visible),
          bodyDisplay: getComputedStyle(body).display,
          bodyFlexDir: getComputedStyle(body).flexDirection,
          asideInFlow: (() => {
            const a = document.querySelector('aside');
            return a ? !['fixed', 'absolute'].includes(getComputedStyle(a).position) : null;
          })(),
        };
      });
      n++;
      if (r && r.visible < 100) {
        hit++;
        console.log(`  ${dev} ${d.slice(-10)}/${f.padEnd(12)} main 顶边 y=${r.top} 首屏只露 ${r.visible}px  `
          + `body=${r.bodyDisplay}/${r.bodyFlexDir} aside在流里=${r.asideInFlow}`);
      }
    }
  console.log(`${dev}: ${hit}/${n} 页主体区被顶出首屏\n`);
  await ctx.close();
}
await b.close();
