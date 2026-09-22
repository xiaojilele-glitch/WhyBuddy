import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--proxy-server=${process.env.HTTPS_PROXY}`, '--ignore-certificate-errors', '--no-sandbox'],
});
const page = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
for (const u of ['https://example.com', 'https://miantuan.ai/api/health']) {
  try {
    const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(u.padEnd(38), '→', r.status());
  } catch (e) {
    console.log(u.padEnd(38), '→ 失败:', String(e.message).split('\n')[0]);
  }
}
await b.close();
