// 把落盘的整页 HTML 渲染成截图，用来**看用户真正看到的东西**。
//
// ⚠ 为什么要有这个：这一整轮的判据都落在模型 JSON 的 id 上，那是中间表征。
//   本仓纪律五的原话是「判据要落在用户真正看到的东西上，量渲染后的 DOM，
//   不量源码」。要给人看效果的时候才发现页面根本没留下来，只能重跑一轮——
//   所以顺手把 two_round_drive 的落盘和这个渲染脚本都补上。
//
// ⚠ 浏览器用 executablePath 显式指定：容器里装的是 chromium-1194，而仓里
//   @playwright/test 期望 1228，不指就报 "Executable doesn't exist"。
//   **不要去 playwright install**（环境说明明确禁止，会重下一整套）。
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [, , runDir, outDir] = process.argv;
if (!runDir || !outDir) {
  console.error('用法: node shoot_pages.mjs <轮次目录> <输出目录>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// ⚠ 生成的页面靠 https://cdn.tailwindcss.com 提供样式（163 个 class 全是
//   Tailwind 的，内联 CSS 只有 476 字符）。浏览器取不到 CDN 的话，截出来的是
//   **裸奔的页面**——图标撑成巨幅、版式全塌。
//   拿那种图当「效果」看，就是判据落在一个坏掉的观测上：页面没问题，是尺子坏了。
//   所以浏览器必须跟 curl 走同一个出站代理。
// 第一版想让浏览器走 HTTPS_PROXY，**没用**：代理是 TLS 拦截的，浏览器不信任
// 它的 CA，请求照样失败，截出来还是裸页。与其去动浏览器的证书信任（麻烦且
// 影响面大），不如把 Tailwind 抓到本地、拦截那个请求用本地文件应答——
// 完全不依赖浏览器的网络和证书。
const TAILWIND = process.env.TAILWIND_JS;
if (!TAILWIND || !existsSync(TAILWIND)) {
  console.error(
    '✗ 缺 TAILWIND_JS（本地 tailwind 脚本路径）。页面 163 个 class 全靠它，\n' +
    '  没有它截出来的是版式全塌的裸页——那种图看起来像个结论，其实是尺子坏了。\n' +
    '  先跑：curl -sSL https://cdn.tailwindcss.com -o /tmp/tailwind.js'
  );
  process.exit(3);
}
const tailwindJs = readFileSync(TAILWIND, 'utf8');

const browser = await chromium.launch({ executablePath: CHROME });
for (const tag of ['round1', 'round2']) {
  const dir = join(runDir, `pages_${tag}`);
  if (!existsSync(dir)) {
    console.log(`跳过 ${tag}：${dir} 不存在`);
    continue;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  for (const f of files) {
    // 视口按设备走：手机端页面是照 390×844 设计的（page_shell 里 antd-mobile
    // TabBar demo2 那套），拿 1440 宽去截，底栏和卡片全会被拉变形——
    // 那样截出来的"问题"是尺子造成的，不是页面的。
    const vw = process.env.SHOT_VIEWPORT === 'phone'
      ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const page = await browser.newPage({ viewport: vw });
    // 拦下 CDN，用本地那份应答。**顺带断掉其余外部请求**：截图要的是
    // 「这一版页面长什么样」，不是「今天网络通不通」——放任外部资源会让
    // 同一份 HTML 在不同时刻截出不同的图，那样的对照没法信。
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('cdn.tailwindcss.com')) {
        return route.fulfill({ contentType: 'application/javascript', body: tailwindJs });
      }
      if (url.startsWith('http')) return route.abort();
      return route.continue();
    });
    // file:// 而不是 setContent：页面里的相对资源、脚本执行时机都更接近真实。
    await page.setContent(readFileSync(join(dir, f), 'utf8'), {
      waitUntil: 'networkidle',
    });
    // 绑定是运行时克隆行的（bind 把重复行收成模板，运行时再克隆回来），
    // 不等一下截到的是模板态，行数会比真实少——本仓在「按钮数少了 18%」
    // 那次就是这么被骗过一回。
    await page.waitForTimeout(1200);
    const out = join(outDir, `${tag}-${basename(f, '.html')}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${out}`);
    await page.close();
  }
}
await browser.close();
