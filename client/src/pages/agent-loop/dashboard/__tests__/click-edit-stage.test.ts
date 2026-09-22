// @vitest-environment jsdom
/**
 * 点选编辑存库前"换壳"那条纯函数（spliceEditedBody）——这是整个功能
 * 不把 Tailwind 注入/覆盖 CSS 存回 pages_json 的唯一保证，必须钉死：
 *   ①编辑过的内容真的进了最终 HTML
 *   ②我们自己注入的东西（chrome 覆盖层、Tailwind script）**不在**最终 HTML 里
 *   ③找不到 <body> 就返回 null，不许编一份出来（fail-closed）
 */
import { describe, expect, it } from "vitest";

import {
  spliceEditedBody,
  preservedScripts,
  labelOfEditable,
  firstEditableDescendant,
  editableAncestorChain,
  breadcrumbLabel,
  clampFontSizePx,
  resolveFontSizePx,
  parseFirstElement,
  toCanvasRect,
  placeToolbar,
  MIN_FONT_SIZE_PX,
  MAX_FONT_SIZE_PX,
} from "../ClickEditStage";

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>档案页</title></head><body><h1 data-field="title">原标题</h1><button data-action="save">保存</button></body></html>`;

describe("spliceEditedBody", () => {
  it("换壳成功：body 换成编辑后的内容", () => {
    const editedBody = `<body><h1 data-field="title">改过的标题</h1><button data-action="save">保存</button></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).toBeTruthy();
    expect(out).toContain("改过的标题");
    expect(out).not.toContain("原标题");
  });

  it("反向：不许把渲染用的注入物存回去", () => {
    // 模拟画布里那份被 buildDocument 注入过 Tailwind script 的 body——
    // 即便调用方手滑把整个注入过的 body 传进来，换壳函数本身不引入新的注入，
    // 但真正的把关在于调用方只传 body.outerHTML（不含 head），这里确认
    // 换出来的整份文档里没有我们会注入的那个 vendor 脚本路径。
    const editedBody = `<body><h1 data-field="title">改过的标题</h1></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).not.toContain("tailwind-play");
    expect(out).not.toContain("sliderule-preview-chrome");
  });

  it("保留原始 head（title/meta 不因为编辑 body 而丢）", () => {
    const editedBody = `<body><h1 data-field="title">改过的标题</h1></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).toContain("<title>档案页</title>");
  });

  it("原始 HTML 是垃圾内容：DOMPurify 的 WHOLE_DOCUMENT 会归一成一份空壳（带 <body>），\n" +
    "   不会走到「没有 body」那条分支——真按到 null 分支需要 sanitizeAppHtml 本身\n" +
    "   失效（见下一条），这里钉住的是「不崩、不把垃圾原样吐回去」。", () => {
    const out = spliceEditedBody("<not-a-real-document>", "<body>x</body>");
    expect(out).toContain("<body>x</body>");
    expect(out).not.toContain("not-a-real-document");
  });

  it("原始 HTML 是空串：同样归一成空壳，塞进去的编辑内容原样落地", () => {
    const out = spliceEditedBody("", "<body>x</body>");
    expect(out).toContain("<body>x</body>");
  });

  it("空 originalHtml 传入时不抛异常（防御 sanitizeAppHtml 自身的 fail-closed 分支，\n" +
    "   见其 typeof purify.sanitize !== \"function\" 判据；真实 DOMPurify 下走不到，\n" +
    "   这里只钉「不崩」，别去猜它一定归一成什么」", () => {
    expect(() => spliceEditedBody(undefined as unknown as string, "<body>x</body>")).not.toThrow();
  });
});

describe("labelOfEditable", () => {
  it("有语义 data-* 属性时用它当标签", () => {
    const el = document.createElement("h1");
    el.setAttribute("data-field", "title");
    expect(labelOfEditable(el)).toBe('data-field="title"');
  });

  it("没有语义属性就退化成标签名 + 文字摘要", () => {
    const el = document.createElement("span");
    el.textContent = "一段很长很长很长很长很长很长很长的文字内容";
    const label = labelOfEditable(el);
    expect(label.startsWith("<span>")).toBe(true);
    expect(label.length).toBeLessThan(40);
  });

  it("空文字元素只给标签名", () => {
    const el = document.createElement("div");
    expect(labelOfEditable(el)).toBe("<div>");
  });
});

/**
 * 面包屑导航（editableAncestorChain / firstEditableDescendant）——参照
 * GrapesJS ComponentExit「沿 parent() 链爬到第一个够格祖先」写的一对
 * 互逆函数。判据钉两头：能往上找到该找的那级、也能往下钻到该钻的那级，
 * 而且中间那些不够格的容器（纯 div）不能被误当成一级。
 */
describe("editableAncestorChain / firstEditableDescendant（面包屑导航）", () => {
  function buildFixture() {
    document.body.innerHTML = `
      <nav data-shell="aside">
        <div class="wrap">
          <ul>
            <li data-field="nav_item_1">面试日程日历</li>
          </ul>
        </div>
      </nav>`;
    const li = document.querySelector('[data-field="nav_item_1"]') as HTMLElement;
    const nav = document.querySelector("nav") as HTMLElement;
    return { li, nav };
  }

  it("从叶子节点往上收链：语义/结构节点各占一级，中间纯 div 不占位", () => {
    const { li, nav } = buildFixture();
    const chain = editableAncestorChain(li);
    expect(chain[chain.length - 1]).toBe(li);
    expect(chain[0]).toBe(nav);
    // wrap 那层纯 div 没有语义属性也不在 BLOCK_TAGS 里，不该单独占一级
    expect(chain.some(el => el.className === "wrap")).toBe(false);
  });

  it("反向：链条不超过 max 参数指定的级数", () => {
    document.body.innerHTML = `
      <nav><header><section><article><li data-field="deep">深</li></article></section></header></nav>`;
    const li = document.querySelector('[data-field="deep"]') as HTMLElement;
    const chain = editableAncestorChain(li, 2);
    expect(chain.length).toBe(2);
    expect(chain[chain.length - 1]).toBe(li);
  });

  it("从容器往下钻：找到第一个语义/块级后代", () => {
    const { nav, li } = buildFixture();
    const found = firstEditableDescendant(nav);
    expect(found).toBe(li);
  });

  it("反向：叶子节点自己没有可下钻的后代时返回 null", () => {
    const { li } = buildFixture();
    expect(firstEditableDescendant(li)).toBeNull();
  });

  it("结构标签（nav/header/aside/main/footer）在面包屑里显示中文名，不是原始标签", () => {
    const nav = document.createElement("nav");
    expect(breadcrumbLabel(nav)).toBe("导航");
    const aside = document.createElement("aside");
    expect(breadcrumbLabel(aside)).toBe("侧栏");
  });

  it("语义元素在面包屑里显示属性值，不是「属性名=值」的完整形式（跟 labelOfEditable 不同）", () => {
    const el = document.createElement("li");
    el.setAttribute("data-field", "nav_item_1");
    expect(breadcrumbLabel(el)).toBe("nav_item_1");
  });
});

/**
 * 字号：跟 Tiptap font-size 扩展同一条读值优先级——先信行内 style，
 * 没改过才退回 computed。判据钉住这个优先级顺序（反向：改过之后不能被
 * computed 值盖回去），以及夹紧范围不越界。
 */
describe("resolveFontSizePx / clampFontSizePx（字号）", () => {
  it("没改过时用 computed 值", () => {
    const el = document.createElement("span");
    expect(resolveFontSizePx(el, "20px")).toBe(20);
  });

  it("反向：改过一次之后必须信行内 style，不能被 computed 盖回去", () => {
    const el = document.createElement("span");
    el.style.fontSize = "24px";
    // 即便 computed 传进来的还是旧值（真机里 computed 有一帧延迟很常见），
    // 结果也必须是行内那个 24，不是 computed 的 16。
    expect(resolveFontSizePx(el, "16px")).toBe(24);
  });

  it("computed 解析不出数字时兜底 16", () => {
    const el = document.createElement("span");
    expect(resolveFontSizePx(el, "")).toBe(16);
  });

  it("夹紧：不允许缩到下限以下、放大到上限以上", () => {
    expect(clampFontSizePx(MIN_FONT_SIZE_PX - 5)).toBe(MIN_FONT_SIZE_PX);
    expect(clampFontSizePx(MAX_FONT_SIZE_PX + 50)).toBe(MAX_FONT_SIZE_PX);
    expect(clampFontSizePx(20)).toBe(20);
  });
});

/**
 * parseFirstElement——AI 编辑返回的 HTML 片段（已经过 sanitizeHtmlFragment
 * 消毒）落地成真实 DOM 节点。判据钉住"只取第一个顶层元素"这条：跟后端
 * 提示词"只输出一个元素"对齐，AI 万一吐出兄弟节点不能被悄悄拼接进页面。
 */
describe("parseFirstElement", () => {
  it("单个元素：原样解析出来", () => {
    const el = parseFirstElement(document, '<div data-field="x" class="text-lg">你好</div>');
    expect(el?.tagName).toBe("DIV");
    expect(el?.getAttribute("data-field")).toBe("x");
    expect(el?.textContent).toBe("你好");
  });

  it("反向：多个顶层兄弟节点只取第一个，不悄悄拼接剩下的", () => {
    const el = parseFirstElement(document, "<p>第一段</p><p>第二段</p>");
    expect(el?.textContent).toBe("第一段");
    expect(el?.textContent).not.toContain("第二段");
    // 调用方（handleAiEditSubmit）拿到 el 之后用 replaceWith 把它单独摘出来
    // 插进画布——el 这时还挂在函数内部的临时容器上，第二段留在那个容器里
    // 被整体丢弃，不会跟着 el 一起被搬进文档。这里只钉"el 本身不含第二段"，
    // 搬运时不泄漏是 Node.replaceWith 的原生语义，不是这个函数要保证的事。
  });

  it("空字符串 / 纯文本（没有元素）返回 null", () => {
    expect(parseFirstElement(document, "")).toBeNull();
    expect(parseFirstElement(document, "只是一段文字，没有标签")).toBeNull();
  });
});

/**
 * toCanvasRect —— 2026-08-24 用户截图报的"点选之后高亮框和工具条飘到别处"的
 * 病根判据。iframe 里量到的是 1920×1080 未缩放坐标，高亮框却是画布容器的
 * absolute 子元素，中间隔着 ①transform:scale ②居中留白 两层。
 *
 * 这组用**真机对过账的那笔数**当基准（缩放 59%、画框起点相对容器 (20,170)、
 * 导航项 iframe 坐标 (125,239)），并且反向钉住"少乘 scale"和"少加偏移"
 * 这两种漏法各自会偏多少——只写正向的话，把 scale 写死成 1 照样绿。
 */
describe("toCanvasRect（点选坐标换算）", () => {
  const OFFSET = { left: 20, top: 170 };
  const SCALE = 0.59;
  const NAV = { left: 125, top: 239, width: 130, height: 34 };

  it("真机那笔数：iframe (125,239) @59% + 居中留白 (20,170) → 容器 (93.75, 311.01)", () => {
    const out = toCanvasRect(NAV, SCALE, OFFSET);
    expect(out.left).toBeCloseTo(20 + 125 * 0.59, 5);
    expect(out.top).toBeCloseTo(170 + 239 * 0.59, 5);
    expect(out.width).toBeCloseTo(130 * 0.59, 5);
    expect(out.height).toBeCloseTo(34 * 0.59, 5);
  });

  it("反向：漏乘 scale 会把元素画到明显更靠下的地方（这正是 bug 的形状）", () => {
    const correct = toCanvasRect(NAV, SCALE, OFFSET);
    const buggy = { left: OFFSET.left + NAV.left, top: OFFSET.top + NAV.top };
    // 漏乘 scale 的话 top 会多出 239*(1-0.59)≈98px——不是"差一点"，是差一屏的量级
    expect(buggy.top - correct.top).toBeGreaterThan(90);
  });

  it("反向：漏加居中留白，左上角就锚在容器 (0,0) 上，跟画框对不齐", () => {
    const correct = toCanvasRect(NAV, SCALE, OFFSET);
    const buggy = toCanvasRect(NAV, SCALE, { left: 0, top: 0 });
    expect(correct.left - buggy.left).toBeCloseTo(OFFSET.left, 5);
    expect(correct.top - buggy.top).toBeCloseTo(OFFSET.top, 5);
  });

  it("越靠下的元素偏得越狠——漏乘 scale 是乘法误差，不是常量偏移", () => {
    const near = toCanvasRect({ ...NAV, top: 100 }, SCALE, OFFSET);
    const far = toCanvasRect({ ...NAV, top: 900 }, SCALE, OFFSET);
    const driftNear = OFFSET.top + 100 - near.top;
    const driftFar = OFFSET.top + 900 - far.top;
    expect(driftFar).toBeGreaterThan(driftNear * 5);
  });

  it("scale=1 且无留白时是恒等变换（退化情形不该额外动坐标）", () => {
    expect(toCanvasRect(NAV, 1, { left: 0, top: 0 })).toEqual(NAV);
  });
});

/**
 * placeToolbar —— 坐标修对之后工具条才真的贴着元素，于是才**真的会**溢出。
 * 规则照 floating-ui 的 flip + shift（Tiptap BubbleMenu 同款）。
 */
describe("placeToolbar（工具条翻面与贴边）", () => {
  const TOOLBAR = { width: 300, height: 40 };
  const CONTAINER = { width: 1000, height: 600 };

  it("默认放在选中框上方", () => {
    const p = placeToolbar({ left: 100, top: 300, width: 200, height: 30 }, TOOLBAR, CONTAINER);
    expect(p.top).toBe(300 - 40 - 8);
    expect(p.left).toBe(100);
  });

  it("上方顶到容器边就翻到下方（flip），不是硬夹在顶上盖住元素", () => {
    const rect = { left: 100, top: 10, width: 200, height: 30 };
    const p = placeToolbar(rect, TOOLBAR, CONTAINER);
    expect(p.top).toBe(rect.top + rect.height + 8);
  });

  it("反向：选中框贴着右边时工具条要被推回容器内（shift），不许跑出画布", () => {
    const p = placeToolbar({ left: 950, top: 300, width: 40, height: 30 }, TOOLBAR, CONTAINER);
    expect(p.left).toBe(CONTAINER.width - TOOLBAR.width - 4);
    expect(p.left + TOOLBAR.width).toBeLessThanOrEqual(CONTAINER.width);
  });

  it("反向：左边也不许出界", () => {
    const p = placeToolbar({ left: -50, top: 300, width: 40, height: 30 }, TOOLBAR, CONTAINER);
    expect(p.left).toBe(4);
  });

  it("工具条尺寸还没量到（首帧 0×0）时退化成贴着选中框放，不崩也不乱跳", () => {
    const p = placeToolbar({ left: 100, top: 300, width: 200, height: 30 }, { width: 0, height: 0 }, CONTAINER);
    expect(p.left).toBe(100);
    expect(p.top).toBe(300 - 8);
  });
});

/**
 * 点选编辑存一次，页面里的 `<script>` 不许没（2026-09-05 真机）。
 *
 * 事故：`spliceEditedBody` 先把**整份原文**消毒再换 body，而消毒器的
 * `FORBID_TAGS` 里有 `script`——那是给**展示**用的（舞台不跑页面脚本，
 * 页面是数据绑定驱动的木偶），但存库那份是**交付物**。
 *
 * 真机 sr-20260904232526（汉字连线消除小游戏）三页各带 2~3 个内联 script、
 * 最多 880 字符，整局逻辑全在里面。用户去改一个标题，存完游戏变成一张死图，
 * 而他改的那处跟脚本毫无关系；接口还返回 `{ok:true, bytes:N}`。
 * 没有报错、没有告警、判据全绿——本仓最忌的「闸绿但东西没了」。
 */
describe("存库不许把页面脚本吃掉", () => {
  const GAME = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>限时消除对战台</title>
<script>window.__CFG={grid:8,seconds:90};</script></head>
<body><h1>限时消除对战台</h1><div id="board"></div>
<script>function tick(){}document.getElementById('board').addEventListener('click',tick);</script>
</body></html>`;

  it("★ 事故本体：改标题不许把整局逻辑改没", () => {
    const editedBody = `<body><h1>限时消除对战台（改过）</h1><div id="board"></div></body>`;
    const out = spliceEditedBody(GAME, editedBody) || "";
    expect(out).toContain("改过");
    expect(out).toContain("function tick");
    expect(out).toContain("window.__CFG");
    expect((out.match(/<script\b/gi) || []).length).toBe(2);
  });

  it("脚本之间的先后顺序保住（配置脚本要排在用它的那个前面）", () => {
    const out = spliceEditedBody(GAME, `<body><h1>x</h1></body>`) || "";
    expect(out.indexOf("window.__CFG")).toBeLessThan(out.indexOf("function tick"));
  });

  it("反向配对：我们自己注入的那几个仍然不许存回去", () => {
    // ⚠ 注入的是**本地** /vendor/tailwind-play-3.js（buildDocument:646），
    //   不是 cdn.tailwindcss.com——见下一条。
    const injected = `<!DOCTYPE html><html><head><script src="/vendor/tailwind-play-3.js"></script>
<script id="sliderule-preview-chrome">/*chrome*/</script></head><body><h1>t</h1></body></html>`;
    const out = spliceEditedBody(injected, `<body><h1>t2</h1></body>`) || "";
    expect(out).not.toContain("tailwind-play-3.js");
    expect(out).not.toContain("sliderule-preview-chrome");
  });

  /**
   * ★ 2026-09-05 真机抓到的第二刀。
   *
   * 交付页**自己带着** `<script src="https://cdn.tailwindcss.com">`——
   * spec_page_html 的栈约束点名要引，缺了那边判「栈约束没被遵守」。
   * 而第一版的注入清单手写了这一条，于是点选编辑每存一次就把它摘掉一次：
   * 真机 sr-20260904232526 的 p1 从 2 个脚本变成 1 个，页面在站外打开
   * 一条样式都没有，屏幕上却是绿色的「已保存」。
   *
   * 判据盯**语义**（"页面自己的 Tailwind 得留着"），不盯某个域名字面。
   */
  it("交付页自带的 Tailwind CDN 不许被当成注入物摘掉", () => {
    const delivered = `<!DOCTYPE html><html><head>
<script src="https://cdn.tailwindcss.com"></script>
<script> tailwind.config = { theme: { extend: {} } }; </script>
</head><body><h1>标题</h1></body></html>`;
    expect(preservedScripts(delivered)).toHaveLength(2);
    const out = spliceEditedBody(delivered, `<body><h1>改过的标题</h1></body>`) || "";
    expect(out).toContain("cdn.tailwindcss.com");
    expect(out).toContain("tailwind.config");
  });

  it("清单从注入方那边取，不许再手写一份（§4 一把尺子）", () => {
    // 手写的清单是一份关于别人在做什么的猜测，而猜测会过期——今天就过期了。
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../ClickEditStage.tsx"),
      "utf8"
    ) as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(
      /INJECTED_SCRIPT_MARKS\s*=\s*PREVIEW_INJECTED_SCRIPT_MARKS/
    );
    expect(code).not.toContain("cdn.tailwindcss.com");
  });

  it("反向配对：本来就没有脚本的页，输出不许平白多出 script", () => {
    const out = spliceEditedBody(PAGE, `<body><h1>改过的标题</h1></body>`) || "";
    expect((out.match(/<script\b/gi) || []).length).toBe(0);
  });

  it("preservedScripts 只捞原文的，注入物滤掉", () => {
    expect(preservedScripts(GAME)).toHaveLength(2);
    expect(
      preservedScripts(`<script src="/vendor/tailwind-play-3.js"></script>`)
    ).toHaveLength(0);
    expect(preservedScripts("")).toHaveLength(0);
  });
});

/**
 * 「存进去了，但顺手带走了东西」这句话必须走到屏幕上。
 *
 * ⚠ 2026-09-05：后端 page_edit_guard 数出了缺口、`PATCH` 也把 `losses` 透出来了，
 *   **前端却把这个字段丢在地上**——三个写回点全都只显「已保存 / 已改好」。
 *   于是"点选编辑把整局游戏脚本吃掉"在屏幕上仍然长得跟成功一模一样。
 *   这正是本仓 §4「只改一半必然静默失效」的标准形状：生成侧加了字段，
 *   消费侧没接，没有报错、没有告警、判据全绿。
 *
 * 判据钉在**源码**上而不是渲染上：三个写回点分散在两个大组件里，
 * 单独渲染任何一个都证明不了另外两个还接着。
 */
describe("带走了什么，得让人看见", () => {
  const read = (p: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, p),
      "utf8"
    ) as string;
  /** ⚠ 先剥注释再匹配：本仓踩过——判据 grep 的那个词同时出现在文档字符串里，
   *  把实现删了照样绿。 */
  const code = (p: string) =>
    read(p)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("接口把 warn 带回来（不是只回 bytes）", () => {
    const src = code("../app-store-client.ts");
    expect(src).toMatch(/lossesMessage/);
    expect(src).toMatch(/warn/);
  });

  it("点选编辑保存后把 warn 显出来", () => {
    const src = code("../ClickEditStage.tsx");
    expect(src).toMatch(/warn:\s*res\.warn/);
    expect(src).toContain("click-edit-status-warn");
  });

  it("画布两条写回路径也都显（元素编辑 / 换图）", () => {
    const src = code("../../../sliderule/live-runtime/SpecPageCanvasStage.tsx");
    expect(src).toMatch(/setToast\(\s*res\.warn\s*\|\|/);
    expect(src).toMatch(/lostWarn/);
  });

  it("反向配对：绿色的「已保存」不许把 warn 顶掉", () => {
    // 两个都得在——只留 warn 就没人知道存成功了，只留「已保存」就是今天要修的坑。
    const src = code("../ClickEditStage.tsx");
    expect(src).toContain("click-edit-status-ok");
    expect(src).toContain("click-edit-status-warn");
  });
});
