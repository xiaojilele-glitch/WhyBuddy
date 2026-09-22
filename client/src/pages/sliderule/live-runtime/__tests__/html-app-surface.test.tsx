// @vitest-environment jsdom
/**
 * 可操作的应用面：菜单能切、数据填得进去、点得动、游标够得着。
 *
 * ## 这组存在的理由
 *
 * 08-14 第一版做成了沙箱 iframe（不透明源）。样式对了，但把这条链路存在的
 * 理由一起解决掉了——宿主碰不到框内 DOM，于是填数/点击/游标/切页**四件事
 * 一件都做不了**。用户原话：「偏离了初衷，不是只生成页面，是操作跟以前一样」。
 *
 * 所以这里每一条都对着那四件事里的一件，外加安全边界那两条
 * （脚本必须被摘、配色必须是"读出来"而不是"执行出来"）。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractPalette,
  sanitizeAppHtml,
  applyPhoneViewportFill,
  applyDesktopViewportFill,
  applyChromeContrast,
  applyPreviewChrome,
  pinPhoneFillStyle,
  pinDesktopFillStyle,
  pinChromeContrastStyle,
  pinPreviewChromeStyles,
  watchPreviewChromePin,
  stripOrphanCommentClosers,
  stripCommentGutterHeaders,
  navTabLabel,
  rewritePhoneNavLabels,
  stripFrameNavigatingHrefs,
  markSrcdocGeneration,
  sanitizeHtmlFragment,
  PHONE_FILL_STYLE_ID,
  PHONE_FILL_CSS,
  DESKTOP_FILL_STYLE_ID,
  DESKTOP_FILL_CSS,
  CHROME_CONTRAST_STYLE_ID,
  CHROME_CONTRAST_CSS,
  PREVIEW_CHROME_STYLE_ID,
  HTML_APP_SURFACE_VERSION,
} from "../html-app-surface";
import { deriveBindingSource } from "../derive-binding-source";
import { BINDING_ATTRS } from "../html-binding-runtime";

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: { colors: {
    brand: { 50: '#effcf8', 500: '#13b58c', 700: '#087f64' },
    ink: '#172b4d',
    muted: '#6b7a90'
  } } } };
</script>
<style>.x{color:red}</style>
</head><body class="bg-slate-50">
<aside><nav>
  <a data-page-id="p1" aria-current="page">预约挂号</a>
  <a data-page-id="p2">宠物档案</a>
</nav></aside>
<table><thead data-head="pet"><tr><th data-col>列</th></tr></thead>
<tbody data-rows="pet"><tr><td data-cell>格</td>
<td><button data-action="editRecord" data-entity="pet">改</button></td></tr></tbody></table>
</body></html>`;

describe("安全边界还是 DOMPurify —— 同源不等于放开", () => {
  it("页面自带的 script 一个不留", () => {
    /**
     * ⚠ 框是**同源**的（要 contentDocument 才能填数/点击/游标）。
     * 所以页面里的脚本必须在写进去**之前**就没了——那才是边界，
     * 不是 sandbox 属性。
     */
    const out = sanitizeAppHtml(PAGE);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("cdn.tailwindcss.com");
    expect(out).not.toContain("tailwind.config");
  });

  it("on* 与 javascript: 照样摘", () => {
    const out = sanitizeAppHtml(
      '<html><body><button onclick="alert(1)">点</button><a href="javascript:alert(1)">链</a></body></html>'
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("点");
  });

  it("整份文档的骨架留着 —— WHOLE_DOCUMENT 不开的话 style/meta 会散架", () => {
    // 08-14 那版"一堆裸文字"的另一半原因就是 html/head/body 被拆了。
    const out = sanitizeAppHtml(PAGE);
    expect(out).toContain("<head");
    expect(out).toContain("<body");
    expect(out).toContain(".x{color:red}");
  });

  it("消毒不了就返回空串，不是原样放行", () => {
    expect(sanitizeAppHtml.toString()).toContain('typeof purify.sanitize !== "function"');
    expect(sanitizeAppHtml.toString()).toContain('return ""');
  });
});

describe("捞开注释后不许留下裸 -->", () => {
  it("aside 后面的 --> 要摘掉，说明注释里的 --> 不动", () => {
    const fished =
      "<html><body>" +
      "<aside class='w-16'>侧</aside> -->\n" +
      "<!-- 主正文 <main> -->\n" +
      "<header>满电青年</header><main>正文</main></body></html>";
    const out = stripOrphanCommentClosers(fished);
    expect(out).toContain("<aside");
    expect(out).toContain("<!-- 主正文 <main> -->");
    expect(out).not.toMatch(/<\/aside[^>]*>\s*-->/i);
    expect(sanitizeAppHtml(fished)).not.toMatch(/<\/aside[^>]*>\s*-->/i);
  });

  it("消毒入口接上了 —— 只测函数不接线会假绿", () => {
    const src = readFileSync(
      [`client/src/pages/sliderule/live-runtime/html-app-surface.tsx`,
       `src/pages/sliderule/live-runtime/html-app-surface.tsx`]
        .map(c => resolve(process.cwd(), c))
        .find(c => existsSync(c))!,
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).toContain("stripOrphanCommentClosers(markup");
    expect(src).toContain("stripCommentGutterHeaders(stripOrphanCommentClosers");
  });
});

describe("说明注释里的 header 残片不许顶在预览最上头", () => {
  it("已经漏出注释的 <header>：…--> 要摘掉，说明注释本身不动", () => {
    /**
     * ⚠ 2026-08-21 听令工单：模型写 ``<!-- 顶部 <header>：在文档流里 -->``，
     * 壳正则把注释里的标签当成真顶栏复制出来。刷新不必重跑推演，消毒层摘掉。
     * 把 ``stripCommentGutterHeaders`` 从 sanitize 拿掉，本条必须红。
     */
    const leaked =
      "<html><body><!-- 顶部 Header -->" +
      "<header>：在文档流里，flex-shrink:0 -->" +
      '<header class="flex-shrink-0"><h1>听令工单</h1></header>' +
      "<main>列表</main></body></html>";
    const stripped = stripCommentGutterHeaders(leaked);
    expect(stripped).toContain("听令工单");
    expect(stripped).not.toMatch(/：在文档流/);
    expect(stripped).toContain("<!-- 顶部 Header -->");
    const out = sanitizeAppHtml(leaked);
    expect(out).toContain("听令工单");
    expect(out).not.toMatch(/：在文档流/);
    const explained =
      "<!-- 顶部 <header>：在文档流里，flex-shrink:0 -->" +
      '<header class="flex-shrink-0"><h1>听令工单</h1></header>';
    expect(stripCommentGutterHeaders(explained)).toContain(
      "<!-- 顶部 <header>：在文档流里，flex-shrink:0 -->"
    );
  });
});

describe("配色是读出来的，不是执行出来的", () => {
  it("嵌套色阶读得出", () => {
    const p = extractPalette(PAGE);
    expect(p.brand).toEqual({ "50": "#effcf8", "500": "#13b58c", "700": "#087f64" });
  });

  it("平铺色也读得出", () => {
    const p = extractPalette(PAGE);
    expect(p.ink).toBe("#172b4d");
    expect(p.muted).toBe("#6b7a90");
  });

  it("读不出来就返回空 —— 宁可没配色也不执行模型写的 JS", () => {
    /**
     * ⚠ 这是这一层最关键的一条。框是同源的，在里面 eval 一段模型写的脚本
     * 等于让生成内容碰到父页面（话题文字可以承载提示注入）。
     * 降级的代价只是品牌色掉回默认，版式照样对。
     */
    expect(extractPalette("<html><body>没有配置</body></html>")).toEqual({});
  });

  it("读得动主题锁注入的 chrome/background", () => {
    // 跟 Python theme_tokens._theme_config 同一形状。键必须是标识符，
    // 值必须是 '#rrggbb'——extractPalette 不执行 JS、也不认 var(--x)。
    const html = `<script>
/* sliderule-theme-tokens */
tailwind.config = { theme: { extend: { colors: {
  background: '#0f172a',
  foreground: '#f8fafc',
  chrome: '#1e293b',
  card: '#1e293b',
  primary: '#0ea5e9',
  muted: '#334155',
  border: '#475569'
}
} } };
</script>`;
    const p = extractPalette(html);
    expect(p.chrome).toBe("#1e293b");
    expect(p.background).toBe("#0f172a");
    expect(p.primary).toBe("#0ea5e9");
  });
});

describe("四件事各自的接线点都在", () => {
  // 判据钉在源码上：这四条断了都**不会有用例变红**——页面照常渲染，
  // 只是数据没填/点了没反应/游标空白/菜单切不动。
  //
  // ⚠ cwd 可能是仓根也可能是 client/（vitest 的 root 是 client，而
  //   process.cwd() 是仓根），两个候选都试，别赌其中一个。
  const rel = "src/pages/sliderule/live-runtime/html-app-surface.tsx";
  const found = [`client/${rel}`, rel]
    .map(c => resolve(process.cwd(), c))
    .find(c => existsSync(c))!;
  const src = readFileSync(found, "utf8");

  it("① 填数：applyBindings 打在 contentDocument 上", () => {
    expect(src).toContain("frame.contentDocument");
    expect(src).toContain("applyBindings(d.body");
  });

  it("② 点击：动作回调接出去", () => {
    expect(src).toMatch(/onAction:\s*e\s*=>\s*cbs\.current\.onAction/);
  });

  it("搜索/筛选走 iframe 内 bindNow，不写 React state（否则 srcdoc 重写、输入失焦）", () => {
    /**
     * 对照 petite-vue v-model：筛选项活在这一页的运行时，不进宿主 React。
     * 变异：删掉 catalogView / bindNow，搜索只能靠改 props → useEffect
     * 重写 srcdoc，输入框失焦。本条必须红。
     */
    expect(src).toMatch(/catalogView = React\.useRef/);
    expect(src).toContain("const bindNow = ");
    expect(src).toContain("searchEntityId(search)");
    expect(src).toContain("filterCatalog");
    const bindAt = src.indexOf("const bindNow = ");
    expect(bindAt).toBeGreaterThan(0);
    const bindBody = src.slice(bindAt, src.indexOf('d.addEventListener("input", onSearch)', bindAt));
    expect(bindBody).not.toContain("srcdoc");
  });

  it("③ 切页：认 data-page-id，不认标签文字", () => {
    expect(src).toContain('closest?.("[data-page-id]")');
    // 反向：不许退回按文字匹配
    expect(src).not.toMatch(/textContent\s*===/);
  });

  it("srcdoc 里普通 a[href] 不许把 iframe 导航到宿主", () => {
    // 2026-08-21：底栏没打上 data-page-id 时，href=/ 会把同源 iframe
    // 从 srcdoc 切到面团 AI 自己的路由，看起来像黑屏 / 串台。
    expect(src).toContain('closest?.("a")');
    expect(src).toContain("preventDefault");
    expect(src).toContain("stripFrameNavigatingHrefs");
  });

  it("切页监听赶在 srcdoc 之前 —— 后挂会错过同步 load", () => {
    const loadAt = src.indexOf('addEventListener("load"');
    const srcdocAt = src.indexOf("frame.srcdoc = doc");
    expect(loadAt).toBeGreaterThan(0);
    expect(srcdocAt).toBeGreaterThan(loadAt);
    expect(src).toContain("stopPropagation");
  });

  it("④ 游标：hover 报出带绑定的元素", () => {
    expect(src).toContain("onHoverBinding");
    expect(src).toContain("mouseover");
  });

  it("⚠ iframe 不许有 sandbox —— 有了就回到「能看不能用」", () => {
    /**
     * 这条是这次返工的核心。sandbox 会让 contentDocument 变成不透明源，
     * 上面四条**全部**静默失效：页面照常渲染，只是什么都点不动。
     */
    expect(src).not.toMatch(/<iframe[\s\S]*?sandbox=/);
  });

  it("data-page-id 在消毒白名单里 —— 漏了菜单点不动且不报错", () => {
    expect(sanitizeAppHtml(PAGE)).toContain('data-page-id="p2"');
  });

  it("⑤ 抽屉：wireOverlays 打在 contentDocument 上，且在填数之后", () => {
    /**
     * 页面 script 已被摘掉，开/关只能宿主做。挂在 applyBindings 之后：
     * 行是打孔克隆出来的，先填再接线。把这行拿掉，菜单会被打开态遮罩盖住。
     */
    const applyAt = src.indexOf("applyBindings(d.body");
    const wireAt = src.indexOf("wireOverlays(d)");
    expect(applyAt).toBeGreaterThan(0);
    expect(wireAt).toBeGreaterThan(applyAt);
  });

  it("hidden / data-state 过消毒 —— 漏了关上的抽屉会被剥开", () => {
    const out = sanitizeAppHtml(
      '<html><body><div class="fixed inset-0" hidden data-state="closed">抽屉</div></body></html>'
    );
    expect(out).toMatch(/\shidden(?:\s|=|>)/);
    expect(out).toContain('data-state="closed"');
  });

  it("绑定词汇一个不漏地过消毒", () => {
    for (const attr of BINDING_ATTRS) {
      expect(sanitizeAppHtml(`<html><body><div ${attr}="x">格</div></body></html>`)).toContain(attr);
    }
  });
});

describe("推演刚结束点菜单不许漏到宿主", () => {
  /**
   * 2026-08-21 猎网卫士：刷新正常，打孔后点底栏串到面团空态。
   * 同一 pageId 复用 iframe，同步 onLoad 接到旧 document；新 srcdoc 里
   * href="#" 的 fallback base 是宿主 URL。摘 href + 只给带戳的文档接线。
   * 桌面侧栏/面包屑契约同样写 href="#"，漏不按设备分叉。
   */
  const rel = "src/pages/sliderule/live-runtime/html-app-surface.tsx";
  const found = [`client/${rel}`, rel]
    .map(c => resolve(process.cwd(), c))
    .find(c => existsSync(c))!;
  const src = readFileSync(found, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

  it("摘掉 #、站内路径、外链，留下 data-page-id 和标签", () => {
    const out = stripFrameNavigatingHrefs(
      '<nav><a data-page-id="p2" href="/线索">线索</a>' +
        '<a href="#">我的</a><a href="https://x.test/x">外</a></nav>'
    );
    expect(out).toContain('data-page-id="p2"');
    expect(out).toContain(">线索</a>");
    expect(out).toContain(">我的</a>");
    expect(out).not.toMatch(/\bhref\s*=/);
  });

  it("桌面侧栏和面包屑的 href=# 同样要摘 —— 契约就教模型这么写", () => {
    const out = stripFrameNavigatingHrefs(
      '<aside><nav><a data-page-id="p1" href="#">工作台</a>' +
        '<a data-page-id="p2" href="/案件台账">案件</a></nav></aside>' +
        '<header><nav aria-label="Breadcrumb"><a href="#">模块名</a>' +
        '<a href="#" aria-current="page">当前页</a></nav></header>'
    );
    expect(out).toContain("<aside");
    expect(out).toContain('data-page-id="p2"');
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).not.toMatch(/\bhref\s*=/);
  });

  it("写进框的那份经过摘 href —— 只测函数会假绿", () => {
    expect(src).toMatch(/stripFrameNavigatingHrefs\(\s*sanitizeAppHtml/);
  });

  it("换 srcdoc 只给带这一次戳的文档接线", () => {
    expect(markSrcdocGeneration("<html lang='zh'>", "n1")).toContain('data-sr-frame="n1"');
    expect(src).toContain("markSrcdocGeneration(raw, token)");
    expect(src).toMatch(/if\s*\(\s*!isMarkedSrcdoc\(\s*d\s*,\s*token\s*\)\s*\)\s*return/);
  });
});

describe("数据源产出", () => {
  const MODEL = {
    datamodel: {
      entities: [
        {
          id: "pet",
          name: "宠物",
          fields: [
            { id: "name", name: "名字", type: "string" },
            { id: "status", name: "状态", type: "enum",
              options: [{ id: "in_care", label: "住院中" }, { id: "done", label: "已出院" }] },
          ],
        },
      ],
    },
  } as never;

  const RUNTIME = {
    entities: {
      pet: [
        { id: "r1", values: { name: "豆包", status: "in_care" }, createdAt: "" },
        { id: "r2", values: { name: "团团", status: "done" }, createdAt: "" },
      ],
    },
    instances: [],
    seq: 2,
  } as never;

  it("行要摊平 —— RuntimeRow 是 {id, values}，解释器按 row[fieldId] 取", () => {
    /**
     * ⚠ 不摊平的话每个格子都取到 undefined，页面填出一片「—」，
     * 而 problems 是空的（孔都认得出，只是值没有）——又一个不报错的失效。
     */
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(src.rows.pet[0]).toEqual({ id: "r1", name: "豆包", status: "in_care" });
  });

  it("字段清单照模型，enum 取值原样带过去", () => {
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(src.fields.pet.map(f => f.id)).toEqual(["name", "status"]);
    expect(src.fields.pet[1].options).toEqual([
      { id: "in_care", label: "住院中" },
      { id: "done", label: "已出院" },
    ]);
  });

  it("options 键名不做转换 —— 转一次就有两份词汇", () => {
    // `{value,label}` 那个 bug（enum 恒显内部 id）就是这么来的
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(Object.keys(src.fields.pet[1].options![0])).toEqual(["id", "label"]);
  });

  it("没有运行时数据时实体仍在，只是零行 —— 不编数据", () => {
    const src = deriveBindingSource(MODEL, null);
    expect(src.fields.pet).toHaveLength(2);
    expect(src.rows.pet).toEqual([]);
  });

  it("模型缺席返回空源 —— 让解释器如实报 problems", () => {
    // 页面引用了不存在的实体是模型的问题，不该被一份假数据盖住
    expect(deriveBindingSource(null, RUNTIME)).toEqual({
      rows: {},
      fields: {},
      cartRows: {},
    });
  });
});

describe("版本号在", () => {
  it("有版本号，便于日志对齐", () => {
    expect(HTML_APP_SURFACE_VERSION).toBe("html-app-surface-v1");
  });
});

describe("手机页铺满视口", () => {
  it("机模 CSS 注入且幂等 —— 不删原文，用覆盖撑满", () => {
    const src =
      '<html><head></head><body class="flex items-center justify-center">' +
      '<div class="max-w-md mx-auto">卡</div></body></html>';
    const once = applyPhoneViewportFill(src);
    expect(once).toContain(`id="${PHONE_FILL_STYLE_ID}"`);
    expect(once).toContain("overflow-y:auto!important");
    expect(once).toContain('body>div[class*="justify-center"]');
    expect(once).toContain("flex-direction:row");
    expect(once).toContain("nav.fixed");
    expect(once).toContain("position:static!important");
    expect(once).toContain("main.pt-16");
    expect(once).toContain("main.pb-32");
    expect(once).not.toContain(
      "overflow-x:hidden!important;padding-top:0!important;padding-bottom:0!important"
    );
    expect(once).toContain("min-height:56px!important");
    expect(once).toContain("padding-bottom:16px!important");
    // ⚠ 2026-08-22 改成分层兜底：白底治的是「缺页/透明页透出 iframe 黑底」，
    //   不是「模型的底色不对」。写成 !important 会把深色页刷成白纸——主题锁
    //   降级成分层兜底之后这条立刻接手成新元凶，手机端整屏纯白、深浅翻转 4→8。
    expect(once).toContain("@layer sliderule-fallback{html,body{background-color:#fff}}");
    expect(once).not.toContain("background:#fff!important");
    expect(once).not.toContain("nav{display:flex");
    expect(once).not.toContain('body>div[class*="items-center"]{');
    expect(once).not.toContain("main{display:flex");
    expect(once).toContain("max-w-md");
    expect(applyPhoneViewportFill(once)).toBe(once);
  });

  it("Tailwind 后注的样式要把铺满层再钉到 head 末尾", () => {
    /**
     * 真机：首屏看起来铺满了，Play CDN 扫完 class 往 head 末尾注 utility，
     * items-center 把底栏重新居中。钉末尾 + 已在末尾则不动，避免观察者死循环。
     */
    const doc = document.implementation.createHTMLDocument("");
    const tw = doc.createElement("style");
    tw.id = "tw";
    doc.head.appendChild(tw);
    pinPhoneFillStyle(doc);
    expect(doc.head.lastElementChild?.id).toBe(PHONE_FILL_STYLE_ID);
    const later = doc.createElement("style");
    later.id = "tw-late";
    doc.head.appendChild(later);
    pinPhoneFillStyle(doc);
    expect(doc.head.lastElementChild?.id).toBe(PHONE_FILL_STYLE_ID);
    const before = doc.head.lastElementChild;
    pinPhoneFillStyle(doc);
    expect(doc.head.lastElementChild).toBe(before);
  });

  it("舞台手机页把 fillPhone 接到活路上，并且 load 后会钉样式", () => {
    const pick = (rel: string) =>
      [`client/${rel}`, rel]
        .map(c => resolve(process.cwd(), c))
        .find(c => existsSync(c))!;
    const strip = (p: string) =>
      readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(strip(pick("src/pages/sliderule/live-runtime/SpecPageLiveStage.tsx"))).toContain(
      "fillPhone={isPhone}"
    );
    const surface = strip(pick("src/pages/sliderule/live-runtime/html-app-surface.tsx"));
    expect(surface).toContain("buildDocument(html, fillPhone)");
    expect(surface).toContain("applyPreviewChrome(clean, fillPhone)");
    expect(surface).toContain("rewritePhoneNavLabels(page)");
    expect(surface).not.toContain("applyDesktopViewportFill(clean)");
    expect(surface).not.toContain("applyPhoneViewportFill(clean)");
    expect(surface).not.toContain("applyChromeContrast(filled)");
    expect(surface).toContain("watchPreviewChromePin(d, fillPhone)");
    const pinFn = surface.slice(
      surface.indexOf("export function pinPreviewChromeStyles"),
      surface.indexOf("export function watchPreviewChromePin")
    );
    expect(pinFn).toContain("PREVIEW_CHROME_STYLE_ID");
    expect(pinFn.match(/pinFillStyle/g)?.length).toBe(1);
    expect(pinFn).not.toContain("pinDesktopFillStyle");
    expect(pinFn).not.toContain("pinPhoneFillStyle");
    expect(pinFn).not.toContain("pinChromeContrastStyle");
  });

  it("旧会话烤着的全局 nav{} 要换成当前文案", () => {
    const stale =
      '<html><head><style id="sliderule-phone-fill">nav{width:100%}</style></head>' +
      "<body>中文</body></html>";
    const out = applyPreviewChrome(stale, true);
    expect(out).toContain("nav.fixed");
    expect(out).not.toContain("nav{width:100%}");
    expect(out.match(/id="sliderule-phone-fill"/g)?.length).toBe(1);
  });

  it("底栏剥页字，首页留下；面包屑 nav 不动", () => {
    expect(navTabLabel("团长帮 - 核销首页", "团长帮")).toBe("核销首页");
    expect(navTabLabel("古籍列表页", "芸编智管")).toBe("古籍列表");
    expect(navTabLabel("档案页")).toBe("档案");
    expect(navTabLabel("首页")).toBe("首页");
    const src =
      '<header><nav aria-label="Breadcrumb"><a><span>古籍详情页</span></a></nav></header>' +
      '<nav class="fixed inset-x-0 bottom-0">' +
      '<a data-page-id="p1"><span>古籍列表页</span></a>' +
      '<a data-page-id="p2"><span>首页</span></a></nav>';
    const out = rewritePhoneNavLabels(src);
    expect(out).toContain(">古籍列表</span>");
    expect(out).not.toContain(">古籍列表页</span>");
    expect(out).toContain(">首页</span>");
    expect(out).toContain(">古籍详情页</span>");
  });
});

describe("桌面页铺满视口", () => {
  it("居中卡片 CSS 注入且幂等 —— 不删原文，用覆盖撑满", () => {
    const src =
      '<html><head></head><body class="min-h-screen flex items-center justify-center p-10">' +
      '<div class="max-w-6xl mx-auto"><aside></aside><main class="ml-16">卡</main></div>' +
      "</body></html>";
    const once = applyDesktopViewportFill(src);
    expect(once).toContain(`id="${DESKTOP_FILL_STYLE_ID}"`);
    expect(once).toContain('body>[class*="mx-auto"]');
    expect(once).toContain("max-w-6xl");
    expect(once).toContain("ml-16");
    expect(applyDesktopViewportFill(once)).toBe(once);
  });

  it("不许抄手机那条 body>*{margin-left:0} —— 会抹掉侧栏让位", () => {
    expect(DESKTOP_FILL_CSS).not.toContain("body>*{");
    expect(DESKTOP_FILL_CSS).not.toContain("flex-direction:column");
  });

  it("Tailwind 后注的样式要把桌面铺满层再钉到 head 末尾", () => {
    const doc = document.implementation.createHTMLDocument("");
    const tw = doc.createElement("style");
    tw.id = "tw";
    doc.head.appendChild(tw);
    pinDesktopFillStyle(doc);
    expect(doc.head.lastElementChild?.id).toBe(DESKTOP_FILL_STYLE_ID);
    const later = doc.createElement("style");
    later.id = "tw-late";
    doc.head.appendChild(later);
    pinDesktopFillStyle(doc);
    expect(doc.head.lastElementChild?.id).toBe(DESKTOP_FILL_STYLE_ID);
  });
});

describe("浅色壳上的白字和高亮", () => {
  it("对比层注入且幂等", () => {
    const src =
      '<html data-theme="light"><head></head><body>' +
      '<header class="text-white"><nav aria-label="Breadcrumb">' +
      '<a aria-current="page">当前</a></nav></header>' +
      '<aside><a aria-current="page" class="text-white">甲</a></aside>' +
      "</body></html>";
    const once = applyChromeContrast(src);
    expect(once).toContain(`id="${CHROME_CONTRAST_STYLE_ID}"`);
    expect(once).toContain('html[data-theme="light"] header .text-white');
    expect(once).toContain("aside nav a{box-sizing:border-box;width:100%;");
    expect(CHROME_CONTRAST_CSS).toContain('aside [aria-current="page"]');
    expect(CHROME_CONTRAST_CSS).toContain('nav[aria-label="Breadcrumb"]');
    expect(CHROME_CONTRAST_CSS).toContain("min-width:var(--shell-aside-width)");
    expect(CHROME_CONTRAST_CSS).toContain("--shell-aside-width:16rem");
    // 数字只有一个来源：宽度和让位共用同一个变量，不会改一个忘一个
    expect(CHROME_CONTRAST_CSS.split("16rem").length - 1).toBe(1);
    expect(CHROME_CONTRAST_CSS).toContain("bg-zinc-950");
    expect(CHROME_CONTRAST_CSS).toContain("align-items:center");
    expect(CHROME_CONTRAST_CSS).toContain("justify-content:flex-start");
    expect(CHROME_CONTRAST_CSS).toContain("aside nav a svg");
    expect(CHROME_CONTRAST_CSS).toContain('html[data-theme="light"] aside .bg-slate-950');
    expect(CHROME_CONTRAST_CSS).toContain(".grid-cols-24{grid-template-columns:repeat(24,minmax(0,1fr))}");
    expect(applyChromeContrast(once)).toBe(once);
  });

  it("Tailwind 后注要把对比层钉到 head 末尾", () => {
    const doc = document.implementation.createHTMLDocument("");
    doc.head.appendChild(doc.createElement("style")).id = "tw";
    pinChromeContrastStyle(doc);
    expect(doc.head.lastElementChild?.id).toBe(CHROME_CONTRAST_STYLE_ID);
  });

  it("铺满+对比合成一张；观察器跳过自己，对照 Tailwind skip-self", async () => {
    /**
     * ★ 满电青年 2026-08-20：两张表抢 lastElementChild 把主线程钉死。
     * 标准答案抄 Tailwind `@tailwindcss-browser`：一张 output sheet，
     * `if (node === sheet) continue`。变异：pinPreviewChromeStyles 再连调
     * 两层 pin，或拿掉 skip-self 改回两层互踢，本条 last id / 源码必红。
     */
    const src = readFileSync(
      resolve(
        process.cwd(),
        existsSync("client/src/pages/sliderule/live-runtime/html-app-surface.tsx")
          ? "client/src/pages/sliderule/live-runtime/html-app-surface.tsx"
          : "src/pages/sliderule/live-runtime/html-app-surface.tsx"
      ),
      "utf8"
    );
    const fn = src.slice(
      src.indexOf("export function watchPreviewChromePin"),
      src.indexOf("const TAILWIND_SRC")
    );
    expect(fn).toContain("Skip the output stylesheet itself to prevent loops");
    expect(fn).toContain("if (node === ours) continue");
    expect(fn).not.toContain("mo?.disconnect()");
    expect(fn).not.toContain("pinDesktopFillStyle");
    expect(fn).not.toContain("pinChromeContrastStyle");

    const baked = applyPreviewChrome(
      "<html><head></head><body><aside></aside></body></html>",
      false
    );
    expect(baked).toContain(`id="${PREVIEW_CHROME_STYLE_ID}"`);
    expect(baked).toContain('body>[class*="mx-auto"]');
    expect(baked).toContain('html[data-theme="light"] header .text-white');
    expect(applyPreviewChrome(baked, false)).toBe(baked);

    const doc = document.implementation.createHTMLDocument("");
    const mo = watchPreviewChromePin(doc, false);
    expect(doc.head.lastElementChild?.id).toBe(PREVIEW_CHROME_STYLE_ID);
    expect(doc.querySelectorAll(`#${PREVIEW_CHROME_STYLE_ID}`).length).toBe(1);
    const sheet = doc.getElementById(PREVIEW_CHROME_STYLE_ID);
    expect(sheet?.textContent).toContain('body>[class*="mx-auto"]');
    expect(sheet?.textContent).toContain("min-width:var(--shell-aside-width)");
    for (let i = 0; i < 6; i++) {
      const late = doc.createElement("style");
      late.id = `tw-late-${i}`;
      doc.head.appendChild(late);
      await new Promise(r => setTimeout(r, 0));
    }
    mo?.disconnect();
    expect(doc.head.lastElementChild?.id).toBe(PREVIEW_CHROME_STYLE_ID);
    expect(doc.querySelectorAll(`#${PREVIEW_CHROME_STYLE_ID}`).length).toBe(1);
    pinPreviewChromeStyles(doc, false);
    expect(doc.head.lastElementChild).toBe(sheet);
  });

  it("不先断开就两层互踢——这条是对照，钉死旧写法", async () => {
    const doc = document.implementation.createHTMLDocument("");
    let n = 0;
    let mo: MutationObserver;
    const pin = () => {
      n += 1;
      if (n > 40) {
        mo.disconnect();
        return;
      }
      pinDesktopFillStyle(doc);
      pinChromeContrastStyle(doc);
    };
    mo = new MutationObserver(pin);
    mo.observe(doc.head, { childList: true });
    pin();
    await new Promise(r => setTimeout(r, 30));
    mo.disconnect();
    expect(n).toBeGreaterThan(20);
  });
});

/**
 * 铺满层不许把「作者标了关」的浮层掀开。
 *
 * ⚠ 2026-08-22 真机（健身打卡小程序 / 早餐摊进货）：生成侧**照做了**——
 * 模态根节点写的是 `class="hidden fixed inset-0 bg-black/80 z-50 flex
 * items-center justify-center p-4"`，`hidden` 在里面。但消费侧这条
 * `body>div[class*="justify-center"]{display:flex!important}` 把它选中了，
 * `!important` 压过 Tailwind 的 `.hidden`，**首屏 100% 被模态盖死**。
 * 手机端那一版整屏就是「提交今日训练打卡」，桌面端那一版整页只剩
 * 「快捷入库录入」抽屉——底下的列表页根本没露出来。
 *
 * 这是「居中陷阱」家族的第四趟。前三趟记在 page_shell.py 模块头：
 * 第二趟盯 `items-center` 误伤顶栏，第三趟收敛到 `justify-center`。
 * 没人想到 **模态背景板的惯用写法正好就是 `flex items-center justify-center`**。
 *
 * 判据落在**选择器语义**上，不落在字符串里有没有某个 token：
 * 直接拿 jsdom 的 `Element.matches()` 问「这条规则会不会选中它」。
 *
 * ⚠ 反向那条同样重要：修法**不许**写成 `:not([class*="hidden"])`——
 * 整页容器常带 `overflow-hidden`，一盖就把真正该铺满的容器也排除掉，
 * 于是回到「应用缩在屏幕正中」。必须用 `[class~="hidden"]` 按整词匹配。
 */
describe("铺满层不许掀开作者标了关的浮层", () => {
  /** 取出那条 display:flex!important 的居中容器规则的选择器。 */
  const centeringSelector = (css: string): string => {
    const rules = css.split("}").map((r) => r + "}");
    const hit = rules.find(
      (r) => r.includes('justify-center"]') && /display:\s*flex!important/.test(r),
    );
    expect(hit, `${css.slice(0, 40)}… 里找不到居中容器那条规则`).toBeTruthy();
    return (hit as string).split("{")[0];
  };

  const mount = (className: string): Element => {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.className = className;
    document.body.appendChild(el);
    return el;
  };

  for (const [name, css] of [
    ["手机", PHONE_FILL_CSS],
    ["桌面", DESKTOP_FILL_CSS],
  ] as const) {
    const sel = () => centeringSelector(css);

    it(`${name}：class 里带 hidden 的模态背景板不许被选中`, () => {
      // 真机原文（健身打卡 checkin-modal / 早餐摊 quick-inbound-modal）
      const modal = mount(
        "hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4",
      );
      expect(modal.matches(sel())).toBe(false);
    });

    it(`${name}：hidden **属性**标的浮层也不许被选中`, () => {
      const drawer = mount("fixed inset-y-0 right-0 flex items-center justify-center");
      drawer.setAttribute("hidden", "");
      expect(drawer.matches(sel())).toBe(false);
    });

    it(`${name}：真正的整页容器必须还被选中（正向）`, () => {
      expect(mount("min-h-screen flex flex-col").matches(sel())).toBe(true);
      expect(mount("flex items-center justify-center min-h-screen").matches(sel())).toBe(true);
    });

    it(`${name}：脱离文档流的元素一律不是整页容器`, () => {
      /**
       * 2026-08-22 真机 53 页实测：这条居中规则一共只选中 **4 个元素**，
       * 4 个**全是**脱离文档流的浮层（3 个模态 + 1 个 pointer-events-none 的
       * 悬浮 CTA），**没有一个是页面容器**。命中率 100% 是误伤。
       *
       * ⚠ 这条比 `hidden` 那条更强：它连**可见的**误伤也排掉（那个悬浮 CTA
       *   没带 hidden，照样被选中并被拉成 92% 屏高）。
       * ⚠ 判别标准**不能**写成「同时带 max-w- 或 mx-auto 才算病」——模块头记的
       *   第二趟事故原文是 `body>div.min-h-screen.flex.items-center.justify-center`
       *   包着一排底栏图标，**没有 max-w**。那么写等于把老病治回来。
       *   整页容器在文档流里，浮层不在——这才是分界线。
       */
      expect(mount("fixed inset-0 z-50 flex items-center justify-center").matches(sel())).toBe(false);
      expect(mount("absolute inset-0 flex items-center justify-center").matches(sel())).toBe(false);
      expect(
        mount("absolute bottom-16 left-0 right-0 px-5 pointer-events-none flex justify-center z-10")
          .matches(sel()),
      ).toBe(false);
    });

    it(`${name}：在流里的居中容器仍然被治（第二趟那种，没有 max-w）`, () => {
      // 真机原文形态：min-h-screen flex items-center justify-center 包着底栏图标
      expect(mount("min-h-screen flex items-center justify-center").matches(sel())).toBe(true);
    });

    it(`${name}：带 overflow-hidden 的整页容器不许被误排除`, () => {
      // ⚠ 这条专治「修法写成 [class*=\"hidden\"]」——那会连它一起排掉。
      expect(mount("min-h-screen flex flex-col overflow-hidden").matches(sel())).toBe(true);
      expect(
        mount("flex items-center justify-center overflow-hidden min-h-screen").matches(sel()),
      ).toBe(true);
    });
  }
});

/** 另一份白名单同样得放行 data-shell。见 bound-html-surface.test.ts 里那条的说明。 */
describe("data-shell 穿过消毒（应用面这一份）", () => {
  it("壳节点上的 data-shell 不许被剥", () => {
    const out = sanitizeAppHtml(
      '<!DOCTYPE html><html><body><aside data-shell="aside"><nav>菜单</nav></aside>' +
        '<header data-shell="header">顶</header><main data-shell="main">正文</main>' +
        '<nav data-shell="nav">底</nav></body></html>',
    );
    for (const v of ["aside", "header", "main", "nav"]) {
      expect(out, `data-shell="${v}" 被剥掉了`).toContain(`data-shell="${v}"`);
    }
  });

  it("反向：没在白名单里的 data-* 仍然该被剥", () => {
    expect(
      sanitizeAppHtml('<!DOCTYPE html><html><body><div data-not-allowed="x">正文</div></body></html>'),
    ).not.toContain("data-not-allowed");
  });
});

describe("data-theme 穿过消毒（对比层靠它认浅色）", () => {
  it("html 上的 data-theme 不许被剥", () => {
    const out = sanitizeAppHtml(
      '<!DOCTYPE html><html data-theme="light"><body><aside class="bg-slate-950">侧</aside></body></html>',
    );
    expect(out, "data-theme 被剥掉了，aside 深砖改写会全部打空").toContain('data-theme="light"');
  });

  it("反向：白名单外的 data-theme-secret 仍然被剥", () => {
    expect(
      sanitizeAppHtml('<!DOCTYPE html><html><body><div data-theme-secret="x">正文</div></body></html>'),
    ).not.toContain("data-theme-secret");
  });
});

/** 另一份白名单同样得放行块身份。见 bound-html-surface.test.ts 里那条的说明。 */
describe("data-block 穿过消毒（应用面这一份）", () => {
  it("块标与块类型都不许被剥", () => {
    const out = sanitizeAppHtml(
      '<!DOCTYPE html><html><body><main data-shell="main">' +
        '<div data-block="本月营业收入" data-block-kind="metric">1,284</div>' +
        "</main></body></html>",
    );
    expect(out, "data-block 被剥掉了").toContain('data-block="本月营业收入"');
    expect(out, "data-block-kind 被剥掉了").toContain('data-block-kind="metric"');
  });

  it("反向：白名单外的块状 data-* 仍然被剥", () => {
    expect(
      sanitizeAppHtml('<!DOCTYPE html><html><body><div data-block-secret="x">正文</div></body></html>'),
    ).not.toContain("data-block-secret");
  });
});

/**
 * body 忘了写 flex，整页主体被顶出视口（2026-08-22 真机·连锁药房 p2）。
 *
 * ## 病灶
 *
 * 模型给 `<body>` 写了 `w-full h-full` 但**没写 flex**，而 `<aside>` 在文档流里。
 * 于是侧栏独占一整行（256×1080），`<header>` 被顶到 y=1080、`<main>` 到 y=1144——
 * 而 main 自己 `overflow:hidden`，**整页内容一点都看不见**。用户看到的就是
 * 「左边一条菜单，右边一大片空白」，正是「有时候特别差」里最差的那种。
 *
 * ⚠ 不是「没生成内容」：那页 main 里有 200 行、5000 字。判据必须落在**渲染后
 *   的位置**上——量源码字数会说这页很丰满。
 * ⚠ 不是这轮四步改出来的：同一份 HTML 换回 84121aa4 的 CSS，main 顶边一样是
 *   y=1144。既有缺陷，真机 31 份桌面页里中 1 份。
 *
 * ## 修法与边界
 *
 * body 不是 flex 而侧栏在流里 → 把侧栏提成 fixed，兄弟按 `--shell-aside-width`
 * 让位。这正是本仓一直用的桌面壳形态（「fixed 侧栏靠 ml-64 让位」）。
 *
 * ⚠ **不能**改成给 body 加 `display:flex`：body 的子节点是 aside/header/main
 *   三个并列，横排会把 header 挤成一根窄条。_DESKTOP_FILL_CSS 模块头也写着
 *   「不许给 body 写 flex-direction:column」——横竖都不能由这一层替它决定。
 * ⚠ 反向那条是关键：body **已经**是 flex 的页（真机 30/31 都是）绝不许被碰，
 *   一碰就是把好页面改坏。
 */
describe("body 忘了 flex 时把侧栏提成 fixed", () => {
  const asideRule = () => {
    const rules = CHROME_CONTRAST_CSS.split("}").map(r => r + "}");
    const hit = rules.find(r => r.includes("position:fixed") && r.includes("aside"));
    expect(hit, "找不到「侧栏提成 fixed」那条规则").toBeTruthy();
    return (hit as string).split("{")[0];
  };
  const siblingRule = () => {
    const rules = CHROME_CONTRAST_CSS.split("}").map(r => r + "}");
    const hit = rules.find(r => r.includes("body:not(.flex)") && r.includes("~*"));
    expect(hit, "找不到「兄弟让位」那条规则").toBeTruthy();
    return (hit as string).split("{")[0];
  };
  const build = (bodyClass: string) => {
    document.body.className = bodyClass;
    document.body.innerHTML = '<aside class="w-64 h-full flex flex-col"><nav><a href="#">甲</a></nav></aside>'
      + '<header class="h-16">顶</header><main class="flex-1">正文</main>';
    return {
      aside: document.querySelector("aside") as Element,
      header: document.querySelector("header") as Element,
      main: document.querySelector("main") as Element,
    };
  };

  it("body 没有 flex 时，侧栏被提成 fixed", () => {
    const { aside } = build("w-full h-full bg-slate-100");
    expect(aside.matches(asideRule())).toBe(true);
  });

  it("body 没有 flex 时，header 和 main 都要让位", () => {
    const { header, main } = build("w-full h-full bg-slate-100");
    expect(header.matches(siblingRule()), "header 没让位会被 fixed 侧栏压住左边").toBe(true);
    expect(main.matches(siblingRule())).toBe(true);
  });

  it("反向：body 已经是 flex 的页一律不许碰", () => {
    // 真机 31 份桌面页里 30 份是这种，碰一下就是把好页面改坏
    const { aside, header, main } = build("w-full h-full flex bg-slate-100");
    expect(aside.matches(asideRule())).toBe(false);
    expect(header.matches(siblingRule())).toBe(false);
    expect(main.matches(siblingRule())).toBe(false);
  });

  it("反向：没有侧栏的页不受影响", () => {
    document.body.className = "w-full h-full";
    document.body.innerHTML = '<header class="h-16">顶</header><main>正文</main>';
    const main = document.querySelector("main") as Element;
    expect(main.matches(siblingRule())).toBe(false);
  });

  it("反向：让位量必须走同一个变量，不许再写死 16rem", () => {
    const rules = CHROME_CONTRAST_CSS.split("}");
    const hit = rules.find(r => r.includes("body:not(.flex)") && r.includes("~*"));
    expect(hit).toContain("var(--shell-aside-width)");
  });
});

/**
 * sanitizeHtmlFragment（2026-08-24）——点选编辑器"✨ AI 编辑"存在的安全前提：
 * LLM 回的是原始文本，这道消毒是它落进真实 DOM 之前唯一的关卡。跟
 * sanitizeAppHtml 共用同一张白名单（ALLOWED_TAGS/ALLOWED_ATTR/FORBID_TAGS），
 * 判据钉住"共用"这条——不是重新抄一遍规则，是同一份规则的片段模式。
 */
describe("sanitizeHtmlFragment", () => {
  it("放行片段：不需要 WHOLE_DOCUMENT 就能处理半份 HTML（没有 html/head/body 包裹）", () => {
    const out = sanitizeHtmlFragment('<div data-field="title" class="text-lg font-bold">你好</div>');
    expect(out).toContain("你好");
    expect(out).toContain('data-field="title"');
  });

  it("摘掉 <script>——跟 sanitizeAppHtml 同一条安全边界，不是片段模式就松了", () => {
    const out = sanitizeHtmlFragment('<div>正文<script>alert(1)</script></div>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("正文");
  });

  it("摘掉 on* 事件处理器（DOMPurify 默认行为，白名单里没放行）", () => {
    const out = sanitizeHtmlFragment('<button onclick="doEvil()">按钮</button>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("按钮");
  });

  it("反向：白名单外的标签/属性一样被摘，不因为是片段模式就放宽", () => {
    const out = sanitizeHtmlFragment('<iframe src="https://evil.example"></iframe><div data-not-allowed="x">正文</div>');
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("data-not-allowed");
    expect(out).toContain("正文");
  });

  it("语义 data-* 白名单（BINDING_ATTRS）跟 sanitizeAppHtml 是同一份，片段模式下照样放行", () => {
    for (const attr of BINDING_ATTRS) {
      expect(sanitizeHtmlFragment(`<div ${attr}="x">格</div>`)).toContain(attr);
    }
  });
});
