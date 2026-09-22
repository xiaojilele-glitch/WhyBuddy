// 谁在打 /apps/{id}：用 CDP 的 initiator 调用栈定位到源文件。
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:3000';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.request.post(`${BASE}/api/sliderule/account/login`,
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Network.enable');
const hits = [];
cdp.on('Network.requestWillBeSent', e => {
  if (!/\/api\/sliderule\/(apps\/[0-9a-f]{8,}|sessions\/[A-Za-z0-9-]{8,})/.test(e.request.url)) return;
  const frames = e.initiator?.stack?.callFrames || [];
  const named = frames.map(f => `${f.url.split('/').slice(-1)[0].split('?')[0]}:${f.lineNumber}`)
    .filter(x => !x.startsWith('debug-collector') && !x.startsWith('chunk-')).slice(0, 4);
  const kind = e.request.url.includes('/apps/') ? 'apps/{id}' : 'sessions/{id}';
  hits.push(`${kind}  ${named.join(' < ') || '(异步续接，栈空)'}`);
});
await p.goto(`${BASE}/agent-loop/workbench`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(15000);
const counts = {};
for (const h of hits) counts[h] = (counts[h] || 0) + 1;
console.log(`重载荷请求共 ${hits.length} 次，调用栈分组：`);
for (const [k, n] of Object.entries(counts).sort((a,b)=>b[1]-a[1])) console.log(`  ×${n}  ${k}`);
const dom = await p.evaluate(() => ({
  cards: document.querySelectorAll('[data-testid^="app-card-"]').length,
  empties: document.querySelectorAll('[data-testid="app-thumb-empty"]').length,
  sheets: document.querySelectorAll('[data-testid="app-thumb-sheet"]').length,
  live: document.querySelectorAll('[data-testid^="app-thumb-live"],[data-testid="app-thumb-html"]').length,
  iframes: document.querySelectorAll('iframe').length,
}));
console.log('DOM：', JSON.stringify(dom));
await p.screenshot({ path: process.env.SHOT || '/tmp/gallery.png', fullPage: false });
await b.close();
