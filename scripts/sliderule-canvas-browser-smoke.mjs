/**
 * sliderule-canvas-browser-smoke —— 画布档的真机判据。
 *
 * ## 为什么必须是浏览器 smoke，不能只写单测
 *
 * 画布档有一半的行为**在 jsdom 里根本不成立**：
 *
 *   · React Flow 的平移缩放走 d3-zoom，要真实的 wheel/pointer 事件与容器尺寸；
 *   · 画板里是 iframe，srcdoc 在 jsdom 里不加载；
 *   · 而这一档最关键的那条坑——**iframe 会吞掉画布手势**——恰恰只在真浏览器里
 *     才复现得出来（jsdom 没有跨文档事件边界这回事）。
 *
 * 也就是说：光靠单测，"滚轮停在画板上时画布还能不能缩放"这件事**永远测不到**，
 * 而它正是 2026-08-25 那天写歪过两次的地方。判据必须落在用户真正操作的东西上
 * （本仓第五条纪律），所以有了这个文件。
 *
 * ## 它钉住的 8 件事
 *
 *   A1 同一个会话的档位偏好记得住（刷新不丢位置）
 *   A2 **别的会话**的偏好接管不了这一个  ← 2026-08-28 用户报的那个
 *   B 滚轮停在**画板上**能平移        ← 手势层通电的证据
 *   C ctrl+滚轮停在画板上能缩放        ← 同上
 *   D  画板上拖拽 = 重排画板（改动前它不动）
 *   D2 空格+拖拽 = 平移画布（画板不动）   ← 跟 D 是一对，只看一条会漏
 *   D3 输入框里空格照常打得出（全局空格监听最容易打坏的一件事）
 *   D4 按着空格切走窗口，回来不卡在平移态 ← 变异测出来的缺口，D/D2/D3 都漏
 *   D5 拖走之后连线从朝着目标那一侧出发   ← 用户报的"连线一拖动就没了"
 *   D6 刚拖过的画板叠在最上层             ← 同一趟的另一半："页面就没了"
 *   D7 双击进板把镜头对到画板现在的位置   ← 跟 D5 同一处根因
 *   D8 拖画板不触发自动适应画布           ← "拖远一点线就没了"的真根因
 *   D9 但排版真变了还是会重新适应         ← D8 的反面，少了它 effect 拆了也绿
 *   D10 容器变了但列数没变也不许有画板跑出视口 ← D9 的另一半（2026-08-28）
 *   E 双击进板：只撤掉**那一块**的手势层，其余照旧挡着
 *   F Esc 退出，手势层全部回来
 *   G 点缩放读数 = 适应画布
 *   H 「在页面档打开」真的切回单页舞台，且带着选中的那一页
 *
 * 第二轮（连线 / 属性面板 / 右键菜单 / 素材图）再钉 6 条：
 *
 *   I 连线态下四条边的把手可见
 *   J 从把手拖到另一块画板真的连出一条线    ← 把手有没有被手势层压住的唯一证据
 *   K 连线存了档，刷新之后还在
 *   L 属性面板列出这一页的真实事实（绑定/权限/连线/素材）
 *   M 「写进页面」把页面作用域指令填进输入框，且**没有自动发出去**
 *   N 右键菜单七项齐、且没有「删除」
 *
 * 第四轮（画布档锁死最大化）再钉 5 条：
 *
 *   U 一进画布档对话栏就是折的      ← 首屏真的锁上了的唯一证据
 *   V 最大化钮置灰且说清原因
 *   W 硬点钮 / 分隔条折钮都掰不开
 *   X 切到页面档：锁解开、对话栏回来
 *   Y 切回画布档：重新锁上
 *
 * 第六轮（Ctrl+Click 进元素编辑）再钉 2 条：
 *
 *   AB 按住 Ctrl 滑过只高亮（不选中、不弹面板）
 *   AC Ctrl+单击 → 选中 + 右侧编辑器，且没跳去页面档
 *   AD **框逐像素落在元素上**  ← AC 只证明"有框"，框飘到别处照样绿
 *   AE 面板排成 容器/文字/外观/内容 四段
 *   AF **面板上的数是元素真实的值**  ← 控件排满一屏但全是"默认"也叫丰富
 *
 * 第七轮（刀 1：块矩形）再钉 3 条：
 *
 *   AG 选中的画板画出块框，没选中的一个都没有
 *   AH **块框逐像素落在块上**       ← AG 只证明"有框"，框飘了照样绿
 *   AI **表格块的框高度证明量在绑定之后** ← 单测钉不死的那条
 *
 * ⚠ J 与 I 必须一起看，理由同 B/C 与 E：把手 opacity 是 1（I 绿）不代表它
 *   收得到事件。2026-08-25 真机就是 I 绿 J 红——手势层 `absolute inset-0`
 *   在 DOM 里排在把手后面，同层后来居上，把手看得见按不下去。
 *
 * ⚠ B/C 曾经"通过"过一次，但那是假的：当时 elementsSelectable={false} 让
 *   React Flow 给节点挂了 pointer-events:none，事件直接落到 pane——
 *   **手势层一个事件都没收到，平移缩放却是好的**。所以 E 那条
 *   （手势层剩 n-1 层）不是锦上添花，它是 B/C 的防伪标记：手势层没通电时
 *   E 必然失败。三条要一起看。
 *
 * ## 用法
 *
 *   pnpm run dev:all                       # 另开一个终端
 *   node scripts/sliderule-canvas-browser-smoke.mjs
 *
 * 需要一个**已经跑完、有成品页面**的会话。默认从 GET /api/sliderule/sessions
 * 里自动挑第一个 has_preview 的；也可以显式指定：
 *
 *   SLIDERULE_CANVAS_SMOKE_SESSION=sr-2026... node scripts/sliderule-canvas-browser-smoke.mjs
 *
 * 需要登录（会话是私有的）。凭据走环境变量，**不写进仓库**：
 *
 *   SLIDERULE_SMOKE_EMAIL=... SLIDERULE_SMOKE_PASSWORD=... node scripts/...
 *
 * 退出码 0 = 8 项全过。任一项失败即非零——画布是增强类（fail-open），
 * 但**判据不 fail-open**：手势层哑掉必须红，不许静静地放过去。
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number.parseInt(process.env.SLIDERULE_SMOKE_PORT ?? "3000", 10);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.SLIDERULE_SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SLIDERULE_SMOKE_PASSWORD ?? "";
const WANT_SESSION = process.env.SLIDERULE_CANVAS_SMOKE_SESSION ?? "";
const SHOT_DIR = resolve("tmp", "sliderule-canvas-smoke");
const NAV_TIMEOUT = Number.parseInt(
  process.env.SLIDERULE_SMOKE_NAV_TIMEOUT ?? "60000",
  10
);

function log(msg) {
  process.stdout.write(`[canvas-smoke] ${msg}\n`);
}

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail ?? ""}`);
}

/**
 * Chromium 可执行文件。容器里预装在 /opt/pw-browsers（不许再跑
 * `playwright install`），本地开发就用 Playwright 自己找的那份。
 */
function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return {
    args: ["--no-sandbox"],
    ...(explicit ? { executablePath: explicit } : {}),
  };
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 950 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => log(`page error: ${String(e).slice(0, 200)}`));

  try {
    await page.goto(`${BASE}/agent-loop/sliderule`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });

    if (EMAIL && PASSWORD) {
      const status = await page.evaluate(
        async ([email, password]) => {
          const r = await fetch("/api/sliderule/account/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          return r.status;
        },
        [EMAIL, PASSWORD]
      );
      log(`login -> ${status}`);
    } else {
      log(
        "未提供 SLIDERULE_SMOKE_EMAIL/PASSWORD，按匿名可读跑（私有会话会取不到）"
      );
    }

    // 挑一个有成品页面的会话。⚠ 不许随便挑一个：没有页面的会话画布是空态，
    // 8 项里有 6 项无从谈起，那样的"通过"是假的。
    const sid =
      WANT_SESSION ||
      (await page.evaluate(async () => {
        const r = await fetch("/api/sliderule/sessions");
        if (!r.ok) return "";
        const body = await r.json();
        const list = Array.isArray(body?.sessions) ? body.sessions : [];
        return (
          list.find(s => s.has_preview)?.sessionId || list[0]?.sessionId || ""
        );
      }));
    if (!sid)
      throw new Error(
        "拿不到可用会话——先跑一轮推演，或设 SLIDERULE_CANVAS_SMOKE_SESSION"
      );
    log(`session = ${sid}`);

    /*
     * ## ⚠ A 的口径 2026-08-28 变了：偏好现在**属于某一个会话**
     *
     * 用户报的是「新建会话、点击会话进入应用，还原默认设置」。根因是这个键
     * 原来存的是裸字符串，跟会话没有绑定，于是变成一份环境变量式的全局状态：
     * 在 A 会话开了画布，进 B 会话、甚至新建会话都被它接管。
     *
     * 现在存的是 `{sessionId, view}`，归属对不上就当没有（抄 claw-code 的
     * `validate_loaded_session`）。所以这里要**两条一起量**，只留任一条都
     * 是假绿：
     *
     *   A1 归属对得上 → 留在画布档（刷新不丢位置，这份偏好唯一还有用的场景）
     *   A2 归属对不上 → 回默认的页面档（正是用户报的那个）
     *
     * ⚠ 先量 A2：它要求进来时是页面档，而 A1 会把状态写成画布。顺序反了
     *   A2 就永远绿——它量的是自己刚写进去的东西。
     */
    const landedOnCanvas = async () =>
      (await page.getAttribute(
        '[data-testid="sliderule-stage-view-canvas"]',
        "aria-pressed"
      )) === "true";

    // A2. 存档属于**别的会话**：不许拿来接管这一个。
    await page.evaluate(sid => {
      localStorage.setItem("sliderule:active-session-id", sid);
      localStorage.setItem(
        "sliderule:stage-view",
        JSON.stringify({ sessionId: "sr-someone-else", view: "canvas" })
      );
    }, sid);
    await page.goto(`${BASE}/agent-loop/sliderule`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForSelector('[data-testid="sliderule-app-stage-bar"]', {
      timeout: NAV_TIMEOUT,
    });
    const foreign = await landedOnCanvas();
    check(
      "A2 别的会话的档位偏好接管不了这一个（进来落在页面档）",
      foreign === false,
      `aria-pressed=${foreign}`
    );

    // A1. 归属对得上：刷新之后还留在画布档。
    await page.evaluate(sid => {
      localStorage.setItem("sliderule:active-session-id", sid);
      localStorage.setItem(
        "sliderule:stage-view",
        JSON.stringify({ sessionId: sid, view: "canvas" })
      );
    }, sid);
    await page.goto(`${BASE}/agent-loop/sliderule`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    const mine = await landedOnCanvas();
    check("A1 同一个会话的档位偏好记得住", mine === true, `aria-pressed=${mine}`);

    /* ------------------------------------ 画布档锁死最大化（第四轮） */

    /*
     * ⚠ 为什么必须真机：单测那 11 条是**剥注释查源码**，只能证明"接线写了"。
     *   锁是不是真的锁得住——按了钮之后对话栏有没有弹回来、切档来回之后
     *   状态对不对——是 react-resizable-panels 的命令式 collapse/expand
     *   跟 React effect 打交道的结果，只有真浏览器算得出来。
     *
     * ⚠ **V 和 U 必须一起看**（跟 I/J、S/T 同一条纪律）。2026-08-25 真机
     *   第一版就是 V 绿 U 红：钮已经置灰（锁的状态是对的）、对话栏却还占着
     *   半屏——兜底 effect 挂在 Provider 上，首屏跑的时候 StudioSplit 还没
     *   挂载、chatRef 是 null，collapse 静静地没执行，之后依赖不再变就没有
     *   第二次。只看 V 会以为功能好了。
     *   把 StudioSplit 里那句 `chatRef.current?.collapse()` 删掉即可复现：
     *   U/W/Y 三条红、V 照样绿。
     */
    const chatWidth = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-panel-id="sliderule-chat"]');
        return el ? Math.round(el.getBoundingClientRect().width) : -1;
      });

    const lockedState = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-testid="sliderule-stage-view-canvas"]'
      );
      const split = document.querySelector(
        '[data-testid="sliderule-workbench-mode-split"]'
      );
      return {
        canvasPressed: canvas?.getAttribute("aria-pressed") === "true",
        splitPressed: split?.getAttribute("aria-pressed") === "true",
        found: !!canvas && !!split,
      };
    });
    const wCanvas = await chatWidth();
    check(
      "U 画布档一进来对话栏就是折的（舞台最大化）",
      wCanvas === 0,
      `chat=${wCanvas}px`
    );
    check(
      "V 互斥分段选中画布（离开走分栏/全屏，不再有一颗置灰的最大化）",
      lockedState.found &&
        lockedState.canvasPressed === true &&
        lockedState.splitPressed === false,
      JSON.stringify(lockedState)
    );

    // 强行点缝上折对话——对话栏不许弹回来。点「分栏」是离开画布，不在这一条。
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="sliderule-studio-split-toggle-chat"]')
        ?.click();
    });
    await page.waitForTimeout(600);
    const wAfterPoke = await chatWidth();
    check(
      "W 硬点分隔条折钮，对话栏仍然不出来",
      wAfterPoke === 0,
      `chat=${wAfterPoke}px`
    );

    // 切到分栏 → 离开画布、对话栏回来；再切回画布 → 重新锁上
    await page.click('[data-testid="sliderule-workbench-mode-split"]');
    await page.waitForTimeout(800);
    const wPage = await chatWidth();
    const afterSplit = await page.evaluate(() => ({
      split:
        document
          .querySelector('[data-testid="sliderule-workbench-mode-split"]')
          ?.getAttribute("aria-pressed") === "true",
      canvas:
        document
          .querySelector('[data-testid="sliderule-stage-view-canvas"]')
          ?.getAttribute("aria-pressed") === "true",
    }));
    check(
      "X 切到分栏：离开画布、对话栏回来",
      wPage > 0 && afterSplit.split === true && afterSplit.canvas === false,
      `chat=${wPage}px ${JSON.stringify(afterSplit)}`
    );

    await page.click('[data-testid="sliderule-stage-view-canvas"]');
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(800);
    const wBack = await chatWidth();
    check("Y 切回画布档：重新锁上", wBack === 0, `chat=${wBack}px`);

    /* ------------------ Ctrl 悬停高亮 / 点选元素直接改（第六轮） */

    /*
     * ⚠ 单测只能证明"写了 ctrlKey、写了 elementFromPoint"。真正要钉的是
     *   **框画在不在元素上**——画布是缩放过的、高亮层画在 React Flow 节点里，
     *   坐标算错一层框就飘走，源码 grep 一样绿（2026-08-25 真机就是这么抓到
     *   "缩两次"那个 bug 的：元素屏幕 14×5，框画成 4×1）。
     */
    const pickTarget = await page.evaluate(() => {
      const board = document.querySelector(
        '[data-testid="sliderule-canvas-artboard"]'
      );
      const f = board?.querySelector("iframe");
      const d = f?.contentDocument;
      if (!d?.body) return null;
      const cand = [...d.querySelectorAll("button,a,h1,h2,h3,p,span")].filter(
        e =>
          (e.textContent || "").trim().length > 2 &&
          e.getBoundingClientRect().width > 20
      );
      if (!cand.length) return null;
      const el = cand[Math.min(3, cand.length - 1)];
      const r = el.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      const sx = fb.width / (d.documentElement.clientWidth || f.clientWidth);
      const sy = fb.height / (d.documentElement.clientHeight || f.clientHeight);
      return {
        text: (el.textContent || "").trim().slice(0, 20),
        x: fb.left + (r.left + r.width / 2) * sx,
        y: fb.top + (r.top + r.height / 2) * sy,
        screen: {
          left: Math.round(fb.left + r.left * sx),
          top: Math.round(fb.top + r.top * sy),
          w: Math.round(r.width * sx),
          h: Math.round(r.height * sy),
        },
      };
    });

    if (pickTarget) {
      // 不按 Ctrl 滑过 —— 一个高亮都不该有
      await page.mouse.move(pickTarget.x, pickTarget.y);
      await page.waitForTimeout(400);
      const idle = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid="sliderule-canvas-element-hover"]'
          ).length
      );

      // 按住 Ctrl 滑过 —— 只高亮，不选中、不弹面板
      await page.keyboard.down("Control");
      await page.mouse.move(pickTarget.x - 40, pickTarget.y);
      await page.waitForTimeout(150);
      await page.mouse.move(pickTarget.x, pickTarget.y);
      await page.waitForTimeout(600);
      const hovering = await page.evaluate(() => ({
        hover: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-hover"]'
        ),
        select: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-select"]'
        ),
        panel: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-panel"]'
        ),
      }));
      check(
        "AB 按住 Ctrl 滑过只高亮：不选中、不弹面板；不按 Ctrl 一点高亮都没有",
        idle === 0 && hovering.hover && !hovering.select && !hovering.panel,
        `不按Ctrl=${idle} ${JSON.stringify(hovering)}`
      );

      // 按下 —— 选中 + 右侧面板，且**留在画布上**
      await page.mouse.click(pickTarget.x, pickTarget.y);
      await page.keyboard.up("Control");
      await page.waitForTimeout(900);
      const picked = await page.evaluate(() => {
        const spot = document.querySelector(
          '[data-testid="sliderule-canvas-element-select"]'
        );
        const r = spot?.getBoundingClientRect();
        return {
          select: !!spot,
          panel: !!document.querySelector(
            '[data-testid="sliderule-canvas-element-panel"]'
          ),
          stillOnCanvas: !!document.querySelector(
            '[data-testid="sliderule-canvas-stage"]'
          ),
          text: document.body.innerText,
          rect: r
            ? {
                left: Math.round(r.left),
                top: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
              }
            : null,
        };
      });
      check(
        "AC Ctrl+单击 → 选中 + 右侧编辑器，且**没有跳去页面档**",
        picked.select &&
          picked.panel &&
          picked.stillOnCanvas &&
          picked.text.includes(pickTarget.text),
        `select=${picked.select} panel=${picked.panel} onCanvas=${picked.stillOnCanvas}`
      );
      /* ⚠ AC 不够：框画到别处去了，AC 照样绿（有框、有面板、在画布）。
         AD 才是"框在不在元素上"那条闸——允许 1px 取整误差。 */
      const near = (a, b) => Math.abs(a - b) <= 1;
      check(
        "AD 高亮框逐像素落在元素上（不是飘在别处）",
        !!picked.rect &&
          near(picked.rect.left, pickTarget.screen.left) &&
          near(picked.rect.top, pickTarget.screen.top) &&
          near(picked.rect.w, pickTarget.screen.w) &&
          near(picked.rect.h, pickTarget.screen.h),
        `框=${JSON.stringify(picked.rect)} 元素=${JSON.stringify(pickTarget.screen)}`
      );
      await page.screenshot({ path: `${SHOT_DIR}/element-pick.png` });

      /*
       * ⚠ 面板"看着丰富"和"面板上的数是真的"是两件事。第一版只读行内样式，
       *   元素没写过行内样式时每一格都是"默认"——控件排满一屏，一个数都没有。
       *   所以这条判据不看有几个控件，看**读数等不等于元素真实的计算值**。
       */
      const panelTruth = await page.evaluate(() => {
        const board = document.querySelector(
          '[data-testid="sliderule-canvas-artboard"]'
        );
        const f = board?.querySelector("iframe");
        const d = f?.contentDocument;
        const q = id => document.querySelector(`[data-testid="${id}"]`);
        const val = id => q(id)?.value ?? null;
        const sections = [
          ...document.querySelectorAll(
            '[data-testid="sliderule-canvas-element-panel"] h4'
          ),
        ].map(h => h.textContent);
        return {
          sections,
          hasSpacing: !!q("sliderule-canvas-el-spacing"),
          read: {
            width: val("sliderule-canvas-el-width"),
            padTop: val("sliderule-canvas-el-padding-top"),
            radius: val("sliderule-canvas-el-radius"),
            fontsize: val("sliderule-canvas-el-fontsize"),
          },
          docReady: !!d?.body,
        };
      });
      check(
        "AE 面板排成 容器/文字/外观/内容 四段，含内外边距九宫格",
        ["容器", "文字", "外观", "内容"].every(t =>
          panelTruth.sections.includes(t)
        ) && panelTruth.hasSpacing,
        JSON.stringify(panelTruth.sections)
      );
      /* 读数不能全是空——全空说明它又退回"只读行内样式"那版了 */
      const filled = Object.values(panelTruth.read).filter(
        v => v !== null && v !== ""
      ).length;
      check(
        "AF 面板显示的是元素**真实**的值（不是一片默认）",
        filled >= 3,
        `有值的格子 ${filled}/4 · ${JSON.stringify(panelTruth.read)}`
      );

      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else {
      log("画板里取不到可点元素，跳过 AB/AC/AD");
    }

    /*
     * ── 第七轮（刀 1：块矩形）────────────────────────────────────
     *
     * AG 选中的画板上画出块框，且**没选中的画板上一个都没有**
     * AH **块框逐像素落在块上**   ← AG 只证明"有框"，框飘到别处照样绿
     * AI **表格块的框高度证明量在 applyBindings 之后**
     *
     * AI 是这一刀最贵的一条，也是单测钉不死的一条：绑定前 tbody 只有模板行，
     * 量早了框只有真实高度的几分之一——不报错、不告警、源码 grep 全绿。
     * 只有真机上量"表格块的框比一行高多少"才咬得住。
     */
    await page.evaluate(() => {
      const b = document.querySelector(
        '[data-testid="sliderule-canvas-artboard"]'
      );
      b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(700);

    const blockTruth = await page.evaluate(() => {
      const boards = [
        ...document.querySelectorAll('[data-testid="sliderule-canvas-artboard"]'),
      ];
      const active = boards[0];
      const f = active?.querySelector("iframe");
      const d = f?.contentDocument;
      if (!d?.body || !f) return null;

      const spots = [
        ...active.querySelectorAll('[data-testid="sliderule-canvas-block-spot"]'),
      ];
      /* 别的画板上不该有框（只在选中/进板的那块画） */
      const elsewhere = boards
        .slice(1)
        .reduce(
          (n, b) =>
            n +
            b.querySelectorAll('[data-testid="sliderule-canvas-block-spot"]')
              .length,
          0
        );

      /* 页面里**真实**的顶层块（不数嵌套的） */
      const domBlocks = [...d.querySelectorAll("[data-block]")].filter(el => {
        let p = el.parentElement;
        while (p) {
          if (p.hasAttribute?.("data-block")) return false;
          p = p.parentElement;
        }
        /* ⚠ 期望集要跟实现**同一条规则**算：顶层、且矩形不为 0。
           塌成 0 的块（折叠面板 / display:none 的 tab）实现里是主动丢掉的
           （measureBlockRects 那条注释），期望集不照做的话 AG 会长期偏差 1，
           而那不是 bug，是判据自己算错了期望。 */
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });

      const fb = f.getBoundingClientRect();
      const sx = fb.width / (d.documentElement.clientWidth || f.clientWidth);
      const sy = fb.height / (d.documentElement.clientHeight || f.clientHeight);

      /* 逐块比：框的屏幕位置 vs 块的屏幕位置 */
      const pairs = [];
      for (const el of domBlocks) {
        const name = el.getAttribute("data-block");
        const spot = spots.find(s => s.getAttribute("data-block-name") === name);
        if (!spot) {
          pairs.push({ name, missing: true });
          continue;
        }
        const r = el.getBoundingClientRect();
        const sr = spot.getBoundingClientRect();
        pairs.push({
          name,
          want: {
            left: Math.round(fb.left + r.left * sx),
            top: Math.round(fb.top + r.top * sy),
            w: Math.round(r.width * sx),
            h: Math.round(r.height * sy),
          },
          got: {
            left: Math.round(sr.left),
            top: Math.round(sr.top),
            w: Math.round(sr.width),
            h: Math.round(sr.height),
          },
        });
      }

      /* AI：表格块的真实高度 vs 单行高度。绑定跑过 = 行是克隆出来的 = 远高于一行。 */
      const tables = domBlocks
        .filter(el => el.getAttribute("data-block-kind") === "table")
        .map(el => {
          const rows = [...el.querySelectorAll("tbody tr")];
          const rowH = rows.length
            ? rows[0].getBoundingClientRect().height
            : 0;
          const spot = spots.find(
            s => s.getAttribute("data-block-name") === el.getAttribute("data-block")
          );
          /* ⚠ 两套坐标别混：块的高是 **iframe 坐标**，框的高是**屏幕坐标**，
             差一个 sy。第一版直接把 537 和 95 并排打出来，看着像不匹配，
             其实只是我打印错了单位。这里统一折回 iframe 坐标再比。 */
          return {
            name: el.getAttribute("data-block"),
            rows: rows.length,
            rowH: Math.round(rowH),
            blockH: Math.round(el.getBoundingClientRect().height),
            spotHInDoc: spot
              ? Math.round(spot.getBoundingClientRect().height / sy)
              : null,
          };
        });

      return { spots: spots.length, elsewhere, domCount: domBlocks.length, pairs, tables };
    });

    if (!blockTruth) {
      log("取不到画板文档，跳过 AG/AH/AI");
    } else {
      /*
       * ⚠ 这一页一个块标都没有时**如实跳过**（照 AI 那条的先例），
       *   2026-08-28 补。块身份是 2026-08-27 才落地的，在那之前生成的会话
       *   HTML 里一个 `data-block` 都没有——拿它们跑，AG/AH 会红在
       *   "块=0"，而那不是 bug，是这份数据没法验这件事。
       *
       * ⚠ 跳过的条件只能是 `domCount === 0`（页面里真的没有块），
       *   **不能**顺手把 `spots === 0` 也算进去——那样"块在、框没画出来"
       *   这个真 bug 就被跳过去了，正是本仓最忌的假绿。
       *   打标本身有 Python 侧 test_page_blocks 钉着，这边跳过不留缺口。
       */
      if (blockTruth.domCount === 0) {
        check(
          "AG 选中的画板画出块框，条数等于页面里的顶层块数；没选中的画板一个都没有",
          blockTruth.spots === 0,
          "这一页没有任何 data-block（会话早于块身份落地），无从验证——如实跳过"
        );
      } else {
        check(
          "AG 选中的画板画出块框，条数等于页面里的顶层块数；没选中的画板一个都没有",
          blockTruth.spots === blockTruth.domCount && blockTruth.elsewhere === 0,
          `框=${blockTruth.spots} 块=${blockTruth.domCount} 别处=${blockTruth.elsewhere}`
        );
      }

      /* ⚠ AG 不够：框全画在 (0,0) 也是"条数对得上"。AH 才是那条闸。
         允许 2px 取整误差（框有 outline，且画布缩放后取整两次）。 */
      const near = (a, b) => Math.abs(a - b) <= 2;
      const bad = blockTruth.pairs.filter(
        p =>
          p.missing ||
          !near(p.got.left, p.want.left) ||
          !near(p.got.top, p.want.top) ||
          !near(p.got.w, p.want.w) ||
          !near(p.got.h, p.want.h)
      );
      check(
        "AH 块框逐像素落在块上（不是飘在别处、也不是全挤在原点）",
        /* 同 AG：这一页没有块时如实跳过，有块就必须逐个对得上。 */
        blockTruth.domCount === 0 || (blockTruth.pairs.length > 0 && bad.length === 0),
        blockTruth.domCount === 0
          ? "这一页没有任何 data-block，无从验证——如实跳过"
          : bad.length
            ? `对不上的 ${bad.length}/${blockTruth.pairs.length}: ${JSON.stringify(bad.slice(0, 2))}`
            : `${blockTruth.pairs.length} 块全中`
      );

      /* AI：量早了这件事的真机判据。表格块必须明显高于一行。 */
      const multiRow = blockTruth.tables.filter(t => t.rows >= 3);
      check(
        "AI 表格块的框高度证明量在 applyBindings **之后**（不是模板行的高度）",
        multiRow.length === 0 ||
          multiRow.every(
            t => t.spotHInDoc !== null && t.spotHInDoc > t.rowH * 2.5
          ),
        multiRow.length
          ? JSON.stringify(multiRow)
          : "这一页没有多行表格块，跳过（不算通过也不算失败）"
      );
      await page.screenshot({ path: `${SHOT_DIR}/block-spots.png` });
      log(`块框真机：${JSON.stringify(blockTruth.tables)}`);
    }

    // 等画板挂上真渲染再动手：没挂载的画板是占位块，手势层还在但内容没到，
    // 那时候量 B/C 量的是另一件事。
    await page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll(
            '[data-testid="sliderule-canvas-artboard"]'
          ),
        ].some(b => b.getAttribute("data-mounted") === "1"),
      null,
      { timeout: NAV_TIMEOUT }
    );
    await page.waitForTimeout(3000);

    const boardCount = await page.$$eval(
      '[data-testid="sliderule-canvas-artboard"]',
      els => els.length
    );
    if (boardCount === 0)
      throw new Error("画布上一块画板都没有——这个会话没有成品页面");
    log(`画板 ${boardCount} 块`);

    const viewport = () =>
      page.evaluate(
        () =>
          document.querySelector(".react-flow__viewport")?.style.transform || ""
      );
    const zoomText = () =>
      page.evaluate(() =>
        document
          .querySelector('[data-testid="sliderule-canvas-zoom-readout"]')
          ?.textContent?.trim()
      );
    /**
     * 在**画板与画布可视区的交集**里取一个点。
     *
     * ⚠ 别直接用画板 boundingBox 的中心：前一步缩放/平移之后画板常常有一半
     *   在画布外面，中心点会落到画布之外（真机踩过：D 项因此假红，
     *   elementFromPoint 返回的是 .react-flow__pane 而不是手势层）。
     *   判据自己站错位置，比被测的东西坏了更难查。
     */
    const pointOnBoard = async () => {
      const pt = await page.evaluate(() => {
        /*
         * ⚠ 2026-08-28：原来只看**第一块**画板（querySelector）。前面的 D
         *   把第一块拖走之后它整个出了可视区，这里就抛"没有交集"，整份 smoke
         *   当场崩在 D8 之前——5 页那种排得开的会话必崩，4 页的碰巧不崩。
         *
         *   判据要的只是"一个落在某块画板上的点"（让手势落到手势层而不是
         *   .react-flow__pane），**哪一块无所谓**。所以改成扫所有画板，取第
         *   一块有足够交集的。
         *
         *   ⚠ 仍然一块都没有时照旧抛错，不许兜底回画布中心——那样手势会落在
         *     pane 上，B/C/D 全都测的是另一件事，而且还是绿的。
         */
        const host = document
          .querySelector('[data-testid="sliderule-canvas-stage"] .react-flow')
          ?.getBoundingClientRect();
        if (!host) return null;
        for (const el of document.querySelectorAll(
          '[data-testid="sliderule-canvas-artboard"]'
        )) {
          const b = el.getBoundingClientRect();
          const left = Math.max(b.left, host.left);
          const right = Math.min(b.right, host.right);
          const top = Math.max(b.top, host.top);
          const bottom = Math.min(b.bottom, host.bottom);
          if (right - left < 8 || bottom - top < 8) continue;
          return { x: (left + right) / 2, y: (top + bottom) / 2 };
        }
        return null;
      });
      if (!pt) throw new Error("没有任何画板与画布可视区有交集——判据取不到落点");
      return pt;
    };

    // B. 滚轮停在画板上 → 平移。手势层没通电时 wheel 会被 iframe 吃掉，这里不动。
    const bb = await pointOnBoard();
    const v0 = await viewport();
    await page.mouse.move(bb.x, bb.y);
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(700);
    const v1 = await viewport();
    check("B 画板上滚轮平移", v0 !== v1, `${v0} -> ${v1}`);

    // C. ctrl+滚轮停在画板上 → 缩放。
    const z0 = await zoomText();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -260);
    await page.keyboard.up("Control");
    await page.waitForTimeout(700);
    const z1 = await zoomText();
    check("C 画板上 ctrl+滚轮缩放", z0 !== z1, `${z0} -> ${z1}`);

    /*
     * D / D2：画板重排与空格平移是**一对**，必须一起看。
     *
     * ⚠ 这两条替换了原来的「D 画板上拖拽=平移画布且画板不被拖走」——那条钉的是
     *   2026-08-25 早先"为保住平移而放弃重排"的取舍，用户后来推翻了它，改用
     *   Figma / excalidraw 那套：空格给平移留一条任何位置都走得通的路，
     *   于是普通拖拽可以让给重排。判据跟着取舍走，不是把旧判据删掉了事。
     *
     * ⚠ 只看 D 会漏掉"空格根本没生效"（那时 D 仍绿：画板照样能拖）；
     *   只看 D2 会漏掉"画板压根拖不动"（那时 D2 仍绿：画布照样能平移）。
     */
    const v2 = await viewport();
    const node0 = await page.$eval(".react-flow__node", n => n.style.transform);
    const bb2 = await pointOnBoard();
    await page.mouse.move(bb2.x, bb2.y);
    await page.mouse.down();
    await page.mouse.move(bb2.x - 140, bb2.y - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const v3 = await viewport();
    const node1 = await page.$eval(".react-flow__node", n => n.style.transform);
    /*
     * ⚠ 这里**只钉"画板动了"**，不钉"画布没平移"。第一版把后者也写进来，
     *   真机当场红：拖到视口边缘时 React Flow 的 autoPanOnNodeDrag 会跟着
     *   平移一段（把画板挪到远处正需要它）。那条是把**旧取舍的反面**当成了
     *   契约——旧取舍是"画板不可拖、拖即平移"，它的反面并不自动成立。
     *   改动前后的真正差别就是这一条：以前拖画板它**不动**。
     */
    check(
      "D 画板上拖拽=重排画板（改动前它不动）",
      node0 !== node1,
      `node ${node0 !== node1 ? "动了" : "没动"} / viewport ${v2 === v3 ? "没变" : "跟着自动平移了一段"}`
    );

    /*
     * D5 / D6：把画板拖到"跟自动排布完全不同的相对位置"上，看连线和层叠
     *          跟不跟得上。
     *
     * ⚠ 2026-08-25 用户报的原话是"连线一拖动页面就没了"。真机量下来边数
     *   没少、路径也不是 NaN——**边还在，只是画歪了**：从哪一侧出、进哪一侧
     *   是 pickLinkSides 按画板位置挑的，而它一直吃**自动排布的 boxes**，
     *   拖走之后不更新。于是线从画板右侧出发再绕回目标左侧，画出一个跟谁
     *   都不挨着的方框，肉眼就是"线没了"。
     *   同一趟还看到第二件事：被拖的那块**滑到别人底下**（selected 只跟
     *   activePageId 走，拖动不选中，elevateNodesOnSelect 抬不起它），
     *   那是"页面就没了"字面上的另一半。
     *
     * ⚠ 拖**第二块**，不是第一块：这时 activePageId 还是第一块，D6 才分得清
     *   "抬起来的是刚拖的那块"还是"抬起来的只是选中的那块"。拖第一块的话
     *   两件事撞在一起，把 zIndex 那行删掉 D6 **照样绿**（选中本身就 +1000）。
     */
    const boardPoint = async i => {
      const pt = await page.evaluate(n => {
        const b = document
          .querySelectorAll('[data-testid="sliderule-canvas-artboard"]')
          [n]?.getBoundingClientRect();
        const host = document
          .querySelector('[data-testid="sliderule-canvas-stage"] .react-flow')
          ?.getBoundingClientRect();
        if (!b || !host) return null;
        const left = Math.max(b.left, host.left);
        const right = Math.min(b.right, host.right);
        const top = Math.max(b.top, host.top);
        const bottom = Math.min(b.bottom, host.bottom);
        if (!(right > left && bottom > top)) return null;
        return { x: (left + right) / 2, y: top + (bottom - top) * 0.25 };
      }, i);
      if (!pt) throw new Error(`第 ${i} 块画板不在可视区里`);
      return pt;
    };

    /*
     * ⚠ 先缩小再拖：**拖多远决定这条判据有没有用**。第一版在 75% 缩放下拖
     *   (+260,+300) 屏幕像素，折合 flow 里才 (+350,+400)，而邻板间距本来就
     *   有 494——选边压根没翻，把修复改回去 D5 照样绿。缩到 20% 上下，同样
     *   的手势折合 flow 里 1500+，画板真的落到邻板正下方，选边才会从
     *   "右→左"翻成"下→上"。
     */
    const bbZoom = await pointOnBoard();
    await page.keyboard.down("Control");
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.move(bbZoom.x, bbZoom.y);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(180);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(400);
    const zoomFar = await zoomText();

    const bbFar = await boardPoint(1);
    await page.mouse.move(bbFar.x, bbFar.y);
    await page.mouse.down();
    await page.mouse.move(bbFar.x + 30, bbFar.y + 320, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    /*
     * D8：拖画板不许触发"重新适应画布"。
     *
     * ⚠ 用户第二次报的是"一拖动远一点，连接线就没了"。根因不在连线：
     *   自动 fit 的排版指纹里，列数是数 store 里 y===0 的画板——手动拖走一块
     *   它的 y 就不再是 0，指纹一变，effect 在**拖动过程中**调了 fitView。
     *   视口当场跳走，而拖拽按指针在 flow 空间的位移算，视口一换算，画板被
     *   甩到很远的地方，连着它的线跑出屏幕。真机复现：21% 缩放下拖一下，
     *   松手读数自己变回 52%。
     *
     * ⚠ 只钉**缩放读数不变**，不钉整个 viewport transform：拖到视口边缘时
     *   autoPanOnNodeDrag 会平移一段，那是该有的（跟 D 那条同一个坑）。
     */
    const zoomAfterDrag = await zoomText();
    check(
      "D8 拖画板不会触发自动适应画布（改动前视口会在拖动中途自己跳走）",
      !!zoomFar && zoomAfterDrag === zoomFar,
      `拖动前 ${zoomFar} → 拖动后 ${zoomAfterDrag}`
    );

    const routing = await page.evaluate(() => {
      const centre = id => {
        const n = id
          ? document.querySelector(
              `.react-flow__node[data-id="${CSS.escape(id)}"]`
            )
          : null;
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const ends = g => {
        // React Flow 不往 <g> 上写 data-source/data-target，它写的是
        // aria-label="Edge from A to B"；自动连线的 id 也是 "df:A->B"。
        // 两条都试，都读不出来就记 null——判据会红，不会静静放过。
        const m = /^Edge from (.+) to (.+)$/.exec(
          g.getAttribute("aria-label") || ""
        );
        if (m) return [m[1], m[2]];
        const id = g.getAttribute("data-id") || "";
        const k = id.indexOf("->");
        if (k < 0) return [null, null];
        return [id.slice(id.indexOf(":") + 1, k), id.slice(k + 2)];
      };
      const side = (dx, dy) =>
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0
            ? "r"
            : "l"
          : dy >= 0
            ? "b"
            : "t";
      const out = [];
      for (const g of document.querySelectorAll(".react-flow__edge")) {
        const d =
          g.querySelector(".react-flow__edge-path")?.getAttribute("d") || "";
        const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).slice(0, 4).map(Number);
        const [sid, tid] = ends(g);
        const from = centre(sid);
        const to = centre(tid);
        if (nums.length < 4 || !from || !to) {
          out.push({ id: g.getAttribute("data-id"), got: null, want: null });
          continue;
        }
        /*
         * ⚠ 判据钉的是**从哪一侧出发**，不是"大方向对不对"。第一版只比了
         *   点积的正负，真机上假绿了一轮：画板被拖到邻板正下方时，选边该从
         *   "右"翻成"下"，可 dx 依旧是正的，点积照样 > 0。**翻的是轴，不是
         *   符号**，所以这里把轴和符号一起比。
         *
         * 出发方向取自 path（flow 坐标），中心连线取自节点矩形（屏幕坐标）；
         * 两个空间只差一个正缩放加平移，轴和符号都不受影响。
         */
        const got = side(nums[2] - nums[0], nums[3] - nums[1]);
        const want = side(to.x - from.x, to.y - from.y);
        out.push({ id: g.getAttribute("data-id"), got, want });
      }
      return out;
    });
    const badRouting = routing.filter(r => r.got !== r.want || !r.got);
    const posFar = await page.evaluate(() =>
      [...document.querySelectorAll(".react-flow__node-artboard")]
        .map(
          n =>
            `${n.getAttribute("data-id")}${n.style.transform.replace("translate", "")}`
        )
        .join(" ")
    );
    check(
      "D5 拖走画板后连线从朝着目标的那一侧出发（改动前它还按自动排布选边）",
      routing.length > 0 && badRouting.length === 0,
      routing.length === 0
        ? "这个会话没有连线，D5 没判到东西——换一个有连线的会话再跑"
        : `缩放 ${zoomFar} · ${routing.length} 条边，选错边 ${badRouting.length} 条 ${JSON.stringify(badRouting).slice(0, 200)} · 画板 ${posFar}`
    );

    const stacking = await page.evaluate(() =>
      [...document.querySelectorAll(".react-flow__node-artboard")].map(n => ({
        id: n.getAttribute("data-id"),
        z: Number(getComputedStyle(n).zIndex) || 0,
        selected: n.classList.contains("selected"),
      }))
    );
    const draggedId = await page.evaluate(
      () =>
        document
          .querySelectorAll('[data-testid="sliderule-canvas-artboard"]')[1]
          ?.closest(".react-flow__node")
          ?.getAttribute("data-id") ?? null
    );
    const front = stacking.find(b => b.id === draggedId);
    const others = stacking.filter(b => b.id !== draggedId);
    check(
      "D6 刚拖过的画板叠在最上层（改动前它会滑到别人底下）",
      !!front &&
        !front.selected &&
        others.length > 0 &&
        others.some(o => o.selected) &&
        others.every(o => o.z < front.z),
      `拖的是 ${draggedId} z=${front?.z}（selected=${front?.selected}） / 其它 ${JSON.stringify(
        others.map(o => `${o.z}${o.selected ? "*选中" : ""}`)
      )}`
    );

    /*
     * D7：定位（双击进板 → fitBounds）也得看**当前**位置。
     *
     * ⚠ 跟 D5 是同一处根因的另一半：zoomToBoard 原来也是从自动排布的 boxes
     *   里找坐标，画板拖走之后它会把镜头对到一块空地上——"改一半必然静默
     *   失效"。D5 只钉连线，钉不到这条。
     */
    const bbEnter = await boardPoint(1);
    await page.mouse.dblclick(bbEnter.x, bbEnter.y);
    await page.waitForTimeout(900);
    const framed = await page.evaluate(() => {
      const b = document
        .querySelectorAll('[data-testid="sliderule-canvas-artboard"]')
        [1]?.getBoundingClientRect();
      const host = document
        .querySelector('[data-testid="sliderule-canvas-stage"] .react-flow')
        ?.getBoundingClientRect();
      if (!b || !host || !(b.width > 0)) return null;
      const ix = Math.max(0, Math.min(b.right, host.right) - Math.max(b.left, host.left));
      const iy = Math.max(0, Math.min(b.bottom, host.bottom) - Math.max(b.top, host.top));
      return Math.round(((ix * iy) / (b.width * b.height)) * 100);
    });
    check(
      "D7 双击进板把镜头对到画板**现在**的位置（改动前对到自动排布的老坐标）",
      framed !== null && framed >= 90,
      `画板落在视口内 ${framed}%`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    /*
     * ⚠ D5 为了让选边真的翻，把画板拖到了很远、缩放也缩到了 20% 上下。
     *   不收拾干净，后面 G（适应画布）会把镜头拉到能装下那块远板的比例上，
     *   I/J/K 的边把手小到点不中——第一版就这么连红了 5 条。
     *   点「复位」回自动排布（它自带一次 fitAll），把场地还给后面的判据。
     */
    await page.click('[data-testid="sliderule-canvas-reset-layout"]');
    await page.waitForTimeout(800);

    /*
     * D9：D8 的**反面**。D8 说"拖画板不许重新适应画布"——只有这一条的话，
     *     把整个 effect 拆了它照样绿，而排版真变了（多一页、列数变了）时
     *     画布就再也不会重新适应，全是"闸全绿但东西没了"。
     *
     * ⚠ 改窗口宽度 → hostAspect 变 → 列数从 4 变 3，这是"排版真的变了"。
     *   这时必须重新 fit：缩放跟着变，且所有画板仍然落在视口内。
     *   （真机：1600 宽 4 列 52%，1100 宽 3 列 31%，两次都全在视口内。）
     */
    const colsOf = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll(".react-flow__node-artboard")].filter(
            n => /translate\([-\d.]+px, 0px\)/.test(n.style.transform)
          ).length
      );
    const outsideCount = () =>
      page.evaluate(() => {
        const host = document
          .querySelector('[data-testid="sliderule-canvas-stage"] .react-flow')
          ?.getBoundingClientRect();
        if (!host) return -1;
        return [...document.querySelectorAll(".react-flow__node-artboard")].filter(
          n => {
            const r = n.getBoundingClientRect();
            return (
              r.left < host.left - 2 ||
              r.right > host.right + 2 ||
              r.top < host.top - 2 ||
              r.bottom > host.bottom + 2
            );
          }
        ).length;
      });
    /*
     * ⚠ 2026-08-28 这条改了三处，都是**判据自己站错了位置**：
     *
     *   一、宽度写死，而列数变不变**取决于会话有几页**。原来是 1600 → 1100，
     *       注释里记的"4 列 → 3 列"是另一份会话量的。真机上舞台被左侧栏挤掉
     *       ~295px：5 页时容器 1305（2 列）→ 805（2 列）列数根本没变；
     *       4 页时**任何**宽度都是 2 列，这条对它永远无从验证。
     *       于是它一直红在 "cols 2 → 2"，看着像产品坏了。
     *       改成**先探测**：扫几档宽度，找一对真能让列数变的；找不到就照 AI
     *       那条的先例如实跳过——不假装验过。
     *
     *   二、拿"缩放变了"当"重新适应过了"的证据。实测这两档的 fit 都受**高度**
     *       约束：容器 1305 和 805 算出来都是 17.7%，缩放一个数都不动，
     *       而画布确实重新适应过（平移变了）。真正该钉的是
     *       **所有画板都还在视口内**——那才是这条判据要保住的东西。
     *
     *   三、原来跑完不还原窗口宽度就往下走，后面几条在窄窗口下量，白白多一
     *       份噪声。现在探测和验证都在这一段里收干净。
     */
    const colsAtWidth = async w => {
      await page.setViewportSize({ width: w, height: 950 });
      await page.waitForTimeout(1400);
      return colsOf();
    };
    /** 扫几档宽度，找一对列数不同的。找不到回 null。 */
    const findColumnPair = async () => {
      const seen = [];
      for (const w of [2000, 1700, 1400, 1100]) {
        seen.push({ w, cols: await colsAtWidth(w) });
      }
      for (const a of seen) {
        for (const b of seen) {
          if (a.cols !== b.cols) return { wide: a, narrow: b, seen };
        }
      }
      return { wide: null, narrow: null, seen };
    };
    const pair = await findColumnPair();
    if (!pair.wide) {
      check(
        "D9 排版真变了（列数变）还是会重新适应画布——D8 别把这条一起关掉",
        true,
        `这个会话在各档宽度下列数都不变（${pair.seen
          .map(x => `${x.w}→${x.cols}列`)
          .join(" ")}），无从验证——如实跳过，不算通过也不算失败`
      );
    } else {
      await page.setViewportSize({ width: pair.wide.w, height: 950 });
      await page.waitForTimeout(2000);
      const cols0 = await colsOf();
      const zoom0 = await zoomText();
      const out0 = await outsideCount();
      await page.setViewportSize({ width: pair.narrow.w, height: 950 });
      await page.waitForTimeout(2000);
      const cols1 = await colsOf();
      const zoom1 = await zoomText();
      const out1 = await outsideCount();
      check(
        "D9 排版真变了（列数变）还是会重新适应画布——D8 别把这条一起关掉",
        cols1 !== cols0 && out0 === 0 && out1 === 0,
        `${pair.wide.w}→${pair.narrow.w} · 列数 ${cols0} → ${cols1} · 缩放 ${zoom0} → ${zoom1} · 视口外画板 ${out0} → ${out1} 块`
      );
    }

    /*
     * D10：D9 的**另一半**，2026-08-28 补。
     *
     * D9 只覆盖"列数变了"。而排版指纹原来只有 `节点数:列数`，于是
     * **容器变了但列数没变**时画布一次都不重新适应——真机上把窗口从 1600
     * 缩到 1100（容器 1305 → 805，两次都是 2 列），**两块画板留在视口外**。
     * 用户看到的就是"窗口一窄，两页没了"，没有任何报错。
     *
     * 修法是把量化过的容器尺寸也放进指纹（见 SpecPageCanvasStage 的
     * hostSizeKey）。这条钉住它：**列数没变也要保住"全在视口内"**。
     * 少了它，把 hostSizeKey 从指纹里删掉，D9 照样绿。
     */
    await page.setViewportSize({ width: 1600, height: 950 });
    await page.waitForTimeout(2000);
    const colsWide = await colsOf();
    await page.setViewportSize({ width: 1100, height: 950 });
    await page.waitForTimeout(2000);
    const colsNarrow = await colsOf();
    const outNarrow = await outsideCount();
    check(
      "D10 容器变了但列数没变，画板也不许跑到视口外（指纹里少了容器尺寸就红）",
      colsNarrow === colsWide && outNarrow === 0,
      `列数 ${colsWide} → ${colsNarrow}（本就该不变） · 视口外画板 ${outNarrow} 块`
    );

    await page.setViewportSize({ width: 1600, height: 950 });
    await page.waitForTimeout(1800);

    const vSpace0 = await viewport();
    const nodeSpace0 = await page.$eval(
      ".react-flow__node",
      n => n.style.transform
    );
    const bbSpace = await pointOnBoard();
    await page.keyboard.down("Space");
    await page.waitForTimeout(200);
    const spaceOn = await page.evaluate(
      () =>
        document
          .querySelector("[data-space-pan]")
          ?.getAttribute("data-space-pan") === "1"
    );
    await page.mouse.move(bbSpace.x, bbSpace.y);
    await page.mouse.down();
    await page.mouse.move(bbSpace.x + 130, bbSpace.y + 80, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.waitForTimeout(600);
    const vSpace1 = await viewport();
    const nodeSpace1 = await page.$eval(
      ".react-flow__node",
      n => n.style.transform
    );
    check(
      "D2 空格+画板上拖拽=平移画布，画板不动",
      spaceOn && vSpace0 !== vSpace1 && nodeSpace0 === nodeSpace1,
      `space=${spaceOn} viewport ${vSpace0 !== vSpace1 ? "变了" : "没变"} / node ${nodeSpace0 === nodeSpace1 ? "没动" : "被拖走了"}`
    );

    /* ⚠ 加了全局空格监听最容易静默打坏的一件事：输入框里敲不出空格。
       excalidraw 没有这层判断（它的文本编辑是自己那套 wysiwyg），我们有真实
       input/textarea，所以这条判据是我们特有的、也是必须的。 */
    await page.evaluate(() => {
      const i = document.createElement("input");
      i.type = "text";
      i.id = "__space-probe";
      i.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999";
      document.body.appendChild(i);
      i.focus();
    });
    await page.keyboard.type("ab");
    await page.keyboard.press("Space");
    await page.keyboard.type("cd");
    await page.waitForTimeout(250);
    const probe = await page.evaluate(() => {
      const el = document.getElementById("__space-probe");
      const v = el?.value ?? "";
      el?.remove();
      return {
        v,
        pan:
          document
            .querySelector("[data-space-pan]")
            ?.getAttribute("data-space-pan") ?? "0",
      };
    });
    check(
      "D3 输入框里空格照常打得出，且不误进平移态",
      probe.v === "ab cd" && probe.pan !== "1",
      `打出 ${JSON.stringify(probe.v)} · space-pan=${probe.pan}`
    );

    /*
     * ⚠ D4 是 2026-08-25 变异测出来的缺口：把"窗口失焦清空格态"那行拆掉，
     *   D/D2/D3 **全绿**——没有任何判据发现。而这正是 excalidraw 专门处理过的
     *   那个 bug（App.tsx 的 onBlur 里 `isHoldingSpace = false`）：按着空格
     *   Alt+Tab 走掉，keyup 永远不来，切回来就卡在平移态，画板全拖不动，
     *   而且用户完全不知道为什么。
     */
    await page.keyboard.down("Space");
    await page.waitForTimeout(150);
    const heldBefore = await page.evaluate(
      () =>
        document
          .querySelector("[data-space-pan]")
          ?.getAttribute("data-space-pan") === "1"
    );
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(250);
    const heldAfter = await page.evaluate(
      () =>
        document
          .querySelector("[data-space-pan]")
          ?.getAttribute("data-space-pan") === "1"
    );
    await page.keyboard.up("Space");
    await page.waitForTimeout(150);
    check(
      "D4 按着空格切走窗口，回来不会卡在平移态",
      heldBefore && !heldAfter,
      `失焦前 ${heldBefore} → 失焦后 ${heldAfter}`
    );

    // 先适应画布，把画板放回可视区——否则下面按坐标双击会点在画布空白处。
    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);

    // E. 双击进板：只撤掉这一块的手势层。
    const bb3 = await pointOnBoard();
    await page.mouse.dblclick(bb3.x, bb3.y);
    await page.waitForTimeout(1200);
    const entered = await page.evaluate(() => ({
      entered: document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.getAttribute("data-entered"),
      shields: document.querySelectorAll(
        '[data-testid="sliderule-canvas-gesture-shield"]'
      ).length,
      boards: document.querySelectorAll(
        '[data-testid="sliderule-canvas-artboard"]'
      ).length,
    }));
    check(
      "E 双击进板且只撤这一块的手势层",
      Boolean(entered.entered) && entered.shields === entered.boards - 1,
      `entered=${entered.entered} 手势层 ${entered.shields}/${entered.boards}`
    );
    await page.screenshot({ path: `${SHOT_DIR}/entered.png` });

    // F. Esc 退出，手势层全部回来。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const exited = await page.evaluate(() => ({
      entered: document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.getAttribute("data-entered"),
      shields: document.querySelectorAll(
        '[data-testid="sliderule-canvas-gesture-shield"]'
      ).length,
    }));
    check(
      "F Esc 退出且手势层全部回来",
      !exited.entered && exited.shields === entered.boards,
      `entered=${exited.entered ?? "null"} 手势层 ${exited.shields}/${entered.boards}`
    );

    // G. 点缩放读数 = 适应画布（所有画板都进视口）。
    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);
    const allVisible = await page.evaluate(() => {
      const host = document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.querySelector(".react-flow")
        ?.getBoundingClientRect();
      if (!host) return false;
      return [
        ...document.querySelectorAll(
          '[data-testid="sliderule-canvas-artboard"]'
        ),
      ].every(b => {
        const r = b.getBoundingClientRect();
        // 允许 2px 误差：fitView 的 padding 是盒子乘数，边界四舍五入会差个把像素。
        return (
          r.left >= host.left - 2 &&
          r.right <= host.right + 2 &&
          r.top >= host.top - 2 &&
          r.bottom <= host.bottom + 2
        );
      });
    });
    check(
      "G 适应画布后所有画板都在视口内",
      allVisible,
      `zoom=${await zoomText()}`
    );
    await page.screenshot({ path: `${SHOT_DIR}/canvas.png` });

    // H. 在页面档打开 → 切回单页舞台，且带着选中的那一页。
    const openBtn = await page.$(
      '[data-testid="sliderule-canvas-open-in-page"]'
    );
    if (openBtn) {
      await openBtn.click();
      await page.waitForTimeout(1500);
      const handoff = await page.evaluate(() => ({
        spec: !!document.querySelector(
          '[data-testid="sliderule-spec-page-stage"]'
        ),
        canvas: !!document.querySelector(
          '[data-testid="sliderule-canvas-stage"]'
        ),
        active: document
          .querySelector('[data-testid="sliderule-spec-page-stage"]')
          ?.getAttribute("data-active-page"),
      }));
      check(
        "H 在页面档打开并带着选中页",
        handoff.spec && !handoff.canvas && Boolean(handoff.active),
        JSON.stringify(handoff)
      );
    } else {
      check("H 在页面档打开并带着选中页", false, "按钮不在（选中态没建立？）");
    }
    /* ---------------- 第二轮：连线 / 属性面板 / 右键菜单 / 素材图 ------- */

    // ⚠ H 刚把舞台切到了**页面档**，画布整个不在了。第二轮的每一条都要先
    //   切回画布——不切的话下面第一条就超时，而报错长得像"画布坏了"，
    //   实际是判据自己站错了地方。
    await page.click('[data-testid="sliderule-stage-view-canvas"]');
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(4000);

    const linkCount = () =>
      page.evaluate(() =>
        Number(
          document
            .querySelector('[data-testid="sliderule-canvas-stage"]')
            ?.getAttribute("data-link-count") || 0
        )
      );

    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);
    const linksBefore = await linkCount();

    // I. 开连线态，四条边的把手都该看得见。
    await page.click('[data-testid="sliderule-canvas-link-toggle"]');
    await page.waitForTimeout(500);
    const handles = await page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll(
        '[data-testid="sliderule-canvas-artboard"]'
      )) {
        const pid = n.getAttribute("data-page-id");
        const sides = ["top", "right", "bottom", "left"].map(sd => {
          const h = n.querySelector(`.react-flow__handle-${sd}`);
          const r = h?.getBoundingClientRect();
          return {
            sd,
            opacity: h ? getComputedStyle(h).opacity : "0",
            pt: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
          };
        });
        out.push({ pid, sides });
      }
      return out;
    });
    check(
      "I 连线态下四条边把手可见",
      handles.length > 0 &&
        handles.every(h => h.sides.every(s => s.opacity === "1")),
      `${handles.length} 块画板 × 4 边`
    );

    // J. 从第一块画板的下把手拖到第二块的上把手。
    const src = handles[0]?.sides.find(s => s.sd === "bottom")?.pt;
    const dst = handles[1]?.sides.find(s => s.sd === "top")?.pt;
    if (src && dst) {
      await page.mouse.move(src.x, src.y);
      await page.mouse.down();
      await page.mouse.move((src.x + dst.x) / 2, (src.y + dst.y) / 2, {
        steps: 10,
      });
      await page.mouse.move(dst.x, dst.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    }
    const linksAfter = await linkCount();
    check(
      "J 从把手拖出一条连线",
      linksAfter === linksBefore + 1,
      `links ${linksBefore} -> ${linksAfter}`
    );

    // K. 存档 + 刷新后还在。
    const stored = await page.evaluate(
      sid => localStorage.getItem(`sliderule:canvas-links:${sid}`),
      sid
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(6000);
    check(
      "K 连线存档且刷新后还在",
      Boolean(stored) && (await linkCount()) === linksAfter,
      `stored=${stored} 刷新后=${await linkCount()}`
    );

    // L. 属性面板列出这一页的真实事实。
    await page.click('[data-testid="sliderule-canvas-inspector-toggle"]');
    await page.waitForTimeout(500);
    const p2 = await pointOnBoard();
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(900);
    const insp = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="sliderule-canvas-inspector"]'
      );
      return {
        pageId: el?.getAttribute("data-page-id"),
        status: document
          .querySelector('[data-testid="sliderule-canvas-inspector-status"]')
          ?.textContent?.trim(),
        text: el?.textContent?.replace(/\s+/g, " ") ?? "",
      };
    });
    check(
      "L 属性面板列出真实事实",
      Boolean(insp.pageId) &&
        Boolean(insp.status) &&
        insp.text.includes("数据绑定") &&
        insp.text.includes("权限") &&
        insp.text.includes("连线"),
      `${insp.pageId} · ${insp.status}`
    );

    // M. 「写进页面」只填不发。
    const applyBtn = await page.$(
      '[data-testid="sliderule-canvas-link-apply"]'
    );
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(900);
      const composed = await page.evaluate(
        () => document.querySelector("textarea")?.value ?? ""
      );
      check(
        "M 连线落回输入框（页面作用域，只填不发）",
        composed.includes("这一页") && /其余|其他/.test(composed),
        composed.slice(0, 70)
      );
    } else {
      check(
        "M 连线落回输入框（页面作用域，只填不发）",
        false,
        "没找到「写进页面」按钮"
      );
    }

    // N. 右键菜单。
    const p3 = await pointOnBoard();
    await page.mouse.click(p3.x, p3.y, { button: "right" });
    await page.waitForTimeout(700);
    const menuItems = await page.evaluate(() => {
      const m = document.querySelector(
        '[data-testid="sliderule-canvas-board-menu"]'
      );
      return m
        ? [...m.querySelectorAll("[role=menuitem]")].map(x =>
            x.textContent.trim()
          )
        : [];
    });
    check(
      "N 右键菜单齐且没有「删除」",
      menuItems.length === 7 && !menuItems.some(t => t.includes("删除")),
      menuItems.join(" / ")
    );
    await page.screenshot({ path: `${SHOT_DIR}/menu.png` });
    await page.keyboard.press("Escape");

    // 素材：如实报数（有就该有节点，没有就该没有开关）。
    const assetInfo = await page.evaluate(() => {
      const st = document.querySelector(
        '[data-testid="sliderule-canvas-stage"]'
      );
      return {
        declared: Number(st?.getAttribute("data-asset-count") || 0),
        nodes: document.querySelectorAll(
          '[data-testid="sliderule-canvas-asset"]'
        ).length,
        toggle: !!document.querySelector(
          '[data-testid="sliderule-canvas-assets-toggle"]'
        ),
      };
    });
    check(
      "O 素材图数量与节点数一致",
      assetInfo.declared === assetInfo.nodes &&
        (assetInfo.declared === 0 || assetInfo.toggle),
      JSON.stringify(assetInfo)
    );

    /* ---------------------------------------------------- 换图（第三轮） */

    /*
     * P/Q/R/S 钉的是"换图"这条链在真浏览器里到底通不通。
     *
     * ⚠ 为什么必须是真机：搜图那一跳要真的打后端（CSP 把 api.openverse.org
     *   挡在 connect-src 之外，所以它必须走 /api/sliderule/stock-images/search
     *   —— 这件事 jsdom 里测不出来，jsdom 根本不执行 CSP）。
     *
     * ⚠ S **只验到候选出现为止，不点下去**——点下去就是真的改用户的应用。
     *   写回那一段由 e2e 脚本在真库上验过（改完立刻还原），不在 smoke 里做
     *   破坏性动作。
     */
    if (assetInfo.declared > 0) {
      /*
       * ⚠ 2026-08-25 真机事故，这段是修复后的写法，别改回去：
       *   这里原本是 `btn.click()`（DOM 调用）——**绕过命中测试**，所以哪怕
       *   按钮整个点不动它也一直绿。真实故障是：素材节点建的时候写了
       *   `selectable: false`，React Flow 据此给整个 node 挂 pointer-events:none，
       *   用户点换图**从来没有过反应**，而这条判据从来没红过。
       *   "点得到吗"这类判据必须走**真实鼠标坐标**。
       */
      const btnBox = await page
        .locator('[data-testid="sliderule-canvas-asset-replace-btn"]')
        .first()
        .boundingBox()
        .catch(() => null);
      // 先钉命中：按钮中心点上最顶层的元素必须是按钮自己
      const topAtBtn = btnBox
        ? await page.evaluate(
            ([x, y]) =>
              document
                .elementFromPoint(x, y)
                ?.closest("[data-testid]")
                ?.getAttribute("data-testid") || "(none)",
            [btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2]
          )
        : "(no-button)";
      check(
        "P0 换图按钮真的点得到（不是被 pointer-events:none 挡着）",
        topAtBtn === "sliderule-canvas-asset-replace-btn",
        `按钮中心点上是 ${topAtBtn}`
      );
      let openedPanel = "no-button";
      if (btnBox) {
        await page.mouse.click(
          btnBox.x + btnBox.width / 2,
          btnBox.y + btnBox.height / 2
        );
        openedPanel = "clicked";
      }
      await page.waitForTimeout(700);
      const panel = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="sliderule-asset-replace"]'
        );
        if (!el) return null;
        return {
          groups: Number(el.getAttribute("data-use-groups") || 0),
          url: el.getAttribute("data-asset-url") || "",
          disabled: !!el.querySelector(
            '[data-testid="sliderule-asset-replace-disabled"]'
          ),
          hasSearch: !!el.querySelector(
            '[data-testid="sliderule-asset-search"]'
          ),
          hasPaste: !!el.querySelector('[data-testid="sliderule-asset-paste"]'),
        };
      });
      check(
        "P 素材卡上的「换图」打开了面板",
        openedPanel === "clicked" && !!panel,
        `${openedPanel} ${JSON.stringify(panel)}`
      );
      check(
        "Q 面板同时给了搜图和粘地址两条路",
        !!panel && panel.hasSearch && panel.hasPaste,
        JSON.stringify(panel)
      );

      // 粘一个白名单外的域名 → 必须出现那行黄字警告（不是拦下来，是说清后果）
      const warned = await page.evaluate(() => {
        const input = document.querySelector(
          '[data-testid="sliderule-asset-paste"]'
        );
        if (!input) return "no-input";
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        setter.call(input, "https://evil.example.com/a.png");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return "typed";
      });
      await page.waitForTimeout(300);
      const warnVisible = await page.evaluate(
        () =>
          !!document.querySelector(
            '[data-testid="sliderule-asset-host-warning"]'
          )
      );
      check(
        "R 粘白名单外的域名会警告「下一轮精修会被判未授权外链」",
        warned === "typed" && warnVisible,
        `${warned} warn=${warnVisible}`
      );

      // 搜图真的打后端并回结果（或如实说搜不到）——两者都算通，
      // 空手而归**必须**有那块"没搜到"的说明，不许静静地什么都不显示。
      await page.evaluate(() => {
        const input = document.querySelector(
          '[data-testid="sliderule-asset-paste"]'
        );
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          ).set;
          setter.call(input, "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        document
          .querySelector('[data-testid="sliderule-asset-search"]')
          ?.click();
      });
      /*
       * ⚠ 不用定长 sleep：搜图本身要走"逐级退让"，慢的时候接近 10s，
       *   定长等于把判据压在一个随网络漂移的时刻上（第一版就是这么红的，
       *   红的是判据不是功能）。这里轮询到"每个候选格子都有结论"为止，
       *   超时再取一次现场——那时的红才是真的红。
       */
      await page
        .waitForFunction(
          () => {
            const box = document.querySelector(
              '[data-testid="sliderule-asset-candidates"]'
            );
            const empty = document.querySelector(
              '[data-testid="sliderule-asset-search-empty"]'
            );
            const err = document.querySelector(
              '[data-testid="sliderule-asset-replace-error"]'
            );
            if (empty || err) return true;
            if (!box) return false;
            const tiles = [...box.querySelectorAll("li")];
            if (!tiles.length) return false;
            return tiles.every(
              li =>
                li.textContent.includes("加载不出来") ||
                [...li.querySelectorAll("img")].some(i => i.naturalWidth > 0)
            );
          },
          { timeout: 60000 }
        )
        .catch(() => {});
      const searched = await page.evaluate(() => ({
        candidates: document.querySelectorAll(
          '[data-testid="sliderule-asset-candidates"] img'
        ).length,
        // 真的渲染出像素的有几张（naturalWidth>0）。灰方块在这里会露馅。
        rendered: [
          ...document.querySelectorAll(
            '[data-testid="sliderule-asset-candidates"] img'
          ),
        ].filter(i => i.naturalWidth > 0).length,
        // 明确显示"加载不出来"的格子数
        brokenShown: [
          ...document.querySelectorAll(
            '[data-testid="sliderule-asset-candidates"] li'
          ),
        ].filter(li => li.textContent.includes("加载不出来")).length,
        tiles: document.querySelectorAll(
          '[data-testid="sliderule-asset-candidates"] li'
        ).length,
        empty: !!document.querySelector(
          '[data-testid="sliderule-asset-search-empty"]'
        ),
        error: (
          document.querySelector(
            '[data-testid="sliderule-asset-replace-error"]'
          )?.textContent || ""
        ).trim(),
      }));
      check(
        "S 搜图有结果，或如实说没搜到（不许静静地空着）",
        searched.tiles > 0 || searched.empty,
        JSON.stringify(searched)
      );
      /*
       * T 是 S 的防伪标记：S 只证明"有候选格子"，一排灰方块照样让它变绿。
       * 候选是拿来**看着挑**的，看不见就等于没有。
       *
       * 判据钉的是"每个格子都有结论"——要么真渲染出像素，要么明说加载不出来。
       * 两条都不满足 = 灰方块挂着，那才是坏的。
       *
       * ⚠ 这个开发容器里浏览器**出不去外网**（live.staticflickr.com 与
       *   fonts.googleapis.com 一样 ERR_CONNECTION_RESET；curl 能出去是因为
       *   它信任容器的 CA，Chromium 不信）。所以这里走的通常是"加载不出来"
       *   那条——那正是降级该有的样子，不是判据放水。真实用户机器上走的是
       *   rendered 那条。
       */
      check(
        "T 每个候选格子都有结论（渲染出来 或 明说加载不出来）",
        searched.tiles === 0 ||
          searched.rendered + searched.brokenShown === searched.tiles,
        JSON.stringify(searched)
      );
      await page.screenshot({ path: `${SHOT_DIR}/asset-replace.png` });
    } else {
      log("素材 0 张，跳过 P/Q/R/S（这个会话的应用没有 <img>）");
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  log(
    `${results.length - failed.length}/${results.length} 通过 · 截图在 ${SHOT_DIR}`
  );
  if (failed.length) {
    log(`失败：${failed.map(f => f.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  log(`崩了：${err?.stack || err}`);
  process.exitCode = 1;
});
