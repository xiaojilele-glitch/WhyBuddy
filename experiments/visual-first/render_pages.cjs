/**
 * 把独立 HTML 渲染成截图 —— 对照实验唯一可信的判据来源。
 *
 * ## 为什么必须有这个文件（2026-08-13 血的教训）
 *
 * 这一天在「有图 vs 无图」的对照上连错四次，最后一次是最糟的：
 * **渲染器没加载 Tailwind，我拿着一批「零 CSS」的截图报了「T 路六张坏三张」，
 * 还提议按这个去定判据。**
 *
 * 病灶：这些 HTML 走 `<script src="https://cdn.tailwindcss.com">`
 * （screenshot-to-code 的标准栈），而**这个容器里 Chromium 出不了网**——
 * 所有 https 都 `ERR_CONNECTION_RESET`，同一时刻 curl 却是 200。于是：
 *
 *     Tailwind 请求: FAILED net::ERR_CONNECTION_RESET https://cdn.tailwindcss.com/
 *     window.tailwind: undefined
 *     class="min-h-screen flex" 的元素 → getComputedStyle().display === "block"
 *
 * 一条样式都没生效。裸 `<svg>` 没有 `w-5 h-5` 约束就撑满视口，页面被顶到
 * 25000~30000px 高——**那正是我当成「模型把页面画坏了」的东西**。
 *
 * 修好之后同样那几页：30453px → 1221px，2858px 宽 → 1920px。一张都没坏。
 *
 * ## 纪律
 *
 * **截图之前必须先证明样式真的生效，再看内容。** 这个脚本每张都打印
 * `tailwind=` 与 `flex生效=`，两个都为 true 才算数——判据自己得先可信，
 * 否则量出来的全是废数。这跟仓里那条老规矩是同一条：
 * 「会静默失效的功能，健康探针里必须有它的位置」（见 NARROWOBS）。
 *
 * ## 用法
 *
 *     curl -sSL -o /tmp/tailwind.js https://cdn.tailwindcss.com   # curl 能出网
 *     node render_pages.cjs <目录> [目录…]
 *
 * 环境变量：
 *     TAILWIND_JS     本地 tailwind 脚本路径（默认 /tmp/tailwind.js）
 *     CHROMIUM_PATH   浏览器可执行文件（默认 /opt/pw-browsers 里预装那个）
 *     VIEWPORT_ONLY   =1 只截 1920x1080 视口；缺省截全页
 */
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const TAILWIND_JS = process.env.TAILWIND_JS || "/tmp/tailwind.js";
// ⚠ 不用 @playwright/test 自带的下载版：仓里 pin 的版本跟 /opt/pw-browsers 里
//   预装的对不上（它要 chromium_headless_shell-1228，装的是 1194），
//   而这个容器又下载不了浏览器。指路径是官方给的处方，不是变通。
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const VIEWPORT_ONLY = process.env.VIEWPORT_ONLY === "1";
const SUFFIX = VIEWPORT_ONLY ? ".vp.png" : ".css.png";

(async () => {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("用法：node render_pages.cjs <目录> [目录…]");
    process.exit(2);
  }
  if (!fs.existsSync(TAILWIND_JS)) {
    // fail-closed：拿不到 Tailwind 就**不要出图**。出一批没样式的图比不出更糟——
    // 它们看起来是正常产物，会被当成证据用（今天就是这么栽的）。
    console.error(
      `！找不到 ${TAILWIND_JS}。先跑：curl -sSL -o ${TAILWIND_JS} https://cdn.tailwindcss.com\n` +
      "  不喂本地 Tailwind 就截图 = 截出一批零 CSS 的原形，量出来全是废数。"
    );
    process.exit(2);
  }
  const TW = fs.readFileSync(TAILWIND_JS, "utf8");

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  // Chromium 出不了代理 → 外部依赖一律本地喂或挡掉。
  await page.route("**cdn.tailwindcss.com**", (r) =>
    r.fulfill({ status: 200, contentType: "application/javascript", body: TW }));
  await page.route("**fonts.googleapis.com**", (r) => r.abort());
  await page.route("**fonts.gstatic.com**", (r) => r.abort());
  // screenshot-to-code 的 image policy 会让模型用 placehold.co 占位图；
  // 拿不到就是一堆碎图标，看着像"页面缺东西"，其实只是网络。
  await page.route("**placehold.co**", (r) =>
    r.fulfill({ status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">' +
            '<rect width="400" height="240" fill="#e2e8f0"/></svg>' }));

  let bad = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".html")).sort()) {
      // ⚠ 必须转绝对路径：file:// 不认相对路径，传相对的会得到一句
      //   「navigating to file://runs/…」然后超时——看着像页面有问题，其实是路径
      await page.goto("file://" + path.resolve(dir, f), { waitUntil: "networkidle" });
      // Tailwind CDN 是**运行时**编译（扫 DOM 再生成样式），不等它就截到半成品
      await page
        .waitForFunction(() => typeof window.tailwind !== "undefined", { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
      const d = await page.evaluate(() => {
        const el = document.querySelector(".flex");
        return {
          w: document.documentElement.scrollWidth,
          h: document.documentElement.scrollHeight,
          tw: typeof window.tailwind !== "undefined",
          // 光有 window.tailwind 不够：它可能加载了但没扫到 DOM。
          // 拿一个 .flex 元素问计算样式，这才是"样式真的生效了"的证据。
          flexOk: el ? getComputedStyle(el).display === "flex" : null,
        };
      });
      const out = path.join(dir, f.replace(/\.html$/, SUFFIX));
      await page.screenshot({ path: out, fullPage: !VIEWPORT_ONLY && d.h <= 20000 });
      const ok = d.tw && d.flexOk !== false;
      if (!ok) bad++;
      console.log(
        `${path.basename(dir)}/${f.padEnd(12)} ${d.w}x${d.h}  ` +
        `tailwind=${d.tw} flex生效=${d.flexOk}${ok ? "" : "   ← ⚠ 样式没生效，这张不可用"}`
      );
      // 横向溢出单独点名：视口 1920 而页面更宽 = 内容被切，肉眼看截图不一定发现
      if (d.w > 1920) console.log(`${" ".repeat(14)}⚠ 横向溢出 ${d.w}px > 视口 1920px`);
    }
  }
  await browser.close();
  process.exit(bad ? 1 : 0);   // 有任何一张样式没生效就非零退出，别让它悄悄过去
})();
