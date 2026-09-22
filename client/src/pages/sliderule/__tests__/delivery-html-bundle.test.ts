// @vitest-environment jsdom
/**
 * 交付包：把新链路画的整页打成一个自包含 HTML 文件。
 *
 * 这一层的坑全是**转义类**的，而转义坏掉的样子都不是报错，是"文件生成了、
 * 点开是散架的"。所以判据钉在三处：
 *   ① 页面内容里的 `</script>` 不许提前终结宿主结构（生成的页面本来就带
 *      `<script src="cdn.tailwindcss.com">`，这不是边角情况，是**每一页**）
 *   ② 中文过 base64 往返不许乱码
 *   ③ 沙箱口径要跟产品里一模一样（包会在别人机器上打开，威胁模型不变）
 */

import { describe, expect, it } from "vitest";

import {
  serializeSlideRuleDeliveryHtml,
  deliveryPagesFromState,
  toBase64Utf8,
  type DeliveryPage,
} from "../serialize-sliderule-delivery-html";

/**
 * 从包里取出内嵌的数据。
 *
 * ⚠ 别用 /var D = (\{.*\});/s：`.*` 贪婪会一路吃到 IIFE 结尾那个 `})();`，
 * JSON.parse 当场炸。数据是**单独一行**，按行取才稳——这条是写这组测试时
 * 当场踩的，记在这儿免得下一个人再踩。
 */
function payloadOf(html: string): { title: string; at: string; notes: string; tw: string;
                                    pages: Array<{ id: string; name: string; b64: string }> } {
  const line = html.split("\n").find(l => l.trim().startsWith("var D = "))!;
  const json = line.trim().slice("var D = ".length).replace(/;$/, "");
  return JSON.parse(json.replace(/\\u003c/g, "<"));
}

/** base64 → 文本（跟包内运行时同一条解码路径）。 */
function decode(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
}

const PAGE_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{500:'#13b58c'}}}}}</script>
</head><body class="bg-slate-50"><main class="flex">预约挂号 · 宠物档案</main></body></html>`;

const PAGES: DeliveryPage[] = [
  { id: "p1", name: "预约挂号", html: PAGE_HTML },
  { id: "p2", name: "宠物档案", html: PAGE_HTML },
];

describe("base64 往返", () => {
  it("中文不乱码", () => {
    const s = "预约挂号 · 宠物档案 · 疫苗与驱虫提醒";
    const back = new TextDecoder().decode(
      Uint8Array.from(atob(toBase64Utf8(s)), c => c.charCodeAt(0))
    );
    expect(back).toBe(s);
  });

  it("大字符串不炸 —— btoa(String.fromCharCode(...bytes)) 会栈溢出", () => {
    /**
     * ⚠ 25KB 的页面展开成两万多个实参，V8 直接 RangeError
     * （Maximum call stack size exceeded）。所以实现里必须分块。
     * 这条用 200KB 压过阈值。
     */
    const big = "宠物".repeat(50_000); // ~300KB UTF-8
    expect(() => toBase64Utf8(big)).not.toThrow();
    const back = new TextDecoder().decode(
      Uint8Array.from(atob(toBase64Utf8(big)), c => c.charCodeAt(0))
    );
    expect(back.length).toBe(big.length);
  });
});

describe("宿主结构不许被页面内容拆散", () => {
  const out = () => serializeSlideRuleDeliveryHtml(PAGES, { appTitle: "宠物医院" });

  it("页面里的 </script> 不出现在包的裸文本里", () => {
    /**
     * ⚠ 这条是这个文件存在的首要理由。生成的页面**每一页**都带
     * `<script src="https://cdn.tailwindcss.com"></script>`，直接内联的话
     * HTML 解析器看到那个 `</script>` 就当宿主脚本结束了，后面全散架——
     * 而浏览器不会报错，只是渲染出一堆乱七八糟的东西。
     */
    const html = out();
    // 宿主自己只有一个 </script>（结尾那个）
    expect(html.split("</script>").length - 1).toBe(1);
    expect(html).not.toContain("cdn.tailwindcss.com\"></script>");
  });

  it("页面 id 里的 < 也转义掉 —— JSON 里的 </script> 同样会终结宿主", () => {
    const html = serializeSlideRuleDeliveryHtml(
      [{ id: "</script><b>x", html: PAGE_HTML }],
      {}
    );
    expect(html.split("</script>").length - 1).toBe(1);
  });

  it("标题里的尖括号不逃出去", () => {
    const html = serializeSlideRuleDeliveryHtml(PAGES, { appTitle: "<img onerror=x>" });
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;img onerror");
  });
});

describe("沙箱口径跟产品里一致", () => {
  it("allow-scripts 给，allow-same-origin 不给", () => {
    /**
     * ⚠ 判据钉在**真实赋值**上，不是"文件里出现过这个词"。
     * 头一版写的是 `not.toContain("allow-same-origin")`，被包里那句
     * 「不给 allow-same-origin」的注释判红——跟本仓 tenacity 那次一模一样
     * （判据必须钉在真实语句上，注释里出现这个词是合理的、甚至是必要的）。
     */
    const html = serializeSlideRuleDeliveryHtml(PAGES, {});
    expect(html).toContain('setAttribute("sandbox", "allow-scripts")');
    expect(html).not.toMatch(/setAttribute\("sandbox",\s*"[^"]*allow-same-origin/);
    // 也不许从别的地方赋进去（f.sandbox = ... 这类写法）
    expect(html).not.toMatch(/\.sandbox\s*=\s*"[^"]*allow-same-origin/);
  });

  it("每页都带框内 CSP，外带与表单提交掐死", () => {
    // 包会在别人的机器上打开，内容仍然是模型生成的 —— 威胁模型没变。
    const html = serializeSlideRuleDeliveryHtml(PAGES, {});
    const decoded = decode(payloadOf(html).pages[0].b64);
    expect(decoded).toContain("connect-src 'none'");
    expect(decoded).toContain("form-action 'none'");
  });

  it("CSP 紧跟 <head> 开标签 —— meta 形式只对其后解析的内容生效", () => {
    const html = serializeSlideRuleDeliveryHtml(PAGES, {});
    const decoded = decode(payloadOf(html).pages[0].b64);
    expect(decoded).toMatch(/<head[^>]*><meta http-equiv="Content-Security-Policy"/);
  });

  it("外网 Tailwind 的引用被摘掉 —— 包里 CSP 不放行外域", () => {
    /**
     * ⚠ 交付包是拿去**离线**看的。留着外链只会在控制台刷一条被拦的错，
     * 而样式一条都没有。样式改由打包时内联的那份提供（tailwindJs）。
     */
    const decoded = decode(payloadOf(serializeSlideRuleDeliveryHtml(PAGES, {})).pages[0].b64);
    expect(decoded).not.toContain("cdn.tailwindcss.com");
  });

  it("script-src 不放行任何外域", () => {
    // ⚠ CSP 在 base64 里，不在包的裸文本里 —— 判据要取对层，
    //   在外层搜是搜不到的（会永远绿，等于没这条判据）。
    const decoded = decode(payloadOf(serializeSlideRuleDeliveryHtml(PAGES, {})).pages[0].b64);
    expect(decoded).toContain("script-src 'unsafe-inline'");
    expect(decoded).not.toMatch(/script-src[^;]*https/);
  });

  it("传了 tailwindJs 就内联进包 —— 离线也有样式", () => {
    const html = serializeSlideRuleDeliveryHtml(PAGES, { tailwindJs: "/*TW*/window.tailwind={}" });
    const D = payloadOf(html);
    expect(D.tw).toBeTruthy();
    expect(decode(D.tw)).toContain("/*TW*/");
  });

  it("没传就如实不内联 —— 包照出，只是没样式，不是整个失败", () => {
    expect(payloadOf(serializeSlideRuleDeliveryHtml(PAGES, {})).tw).toBe("");
  });
});

describe("没有页面就如实不交付", () => {
  it("空清单返回空串 —— 不产出只有外壳的包", () => {
    // 交一个点开什么都没有的文件，比不交更糟：它看着像交付成功了。
    expect(serializeSlideRuleDeliveryHtml([], { appTitle: "x" })).toBe("");
  });

  it("只有空 html 的页也算没有", () => {
    expect(serializeSlideRuleDeliveryHtml([{ id: "p1", html: "" }], {})).toBe("");
  });
});

describe("从状态里取页面", () => {
  it("没有 specFirstPages 时返回空 —— 调用方据此回落 .md", () => {
    expect(deliveryPagesFromState({ sessionId: "s" } as never)).toEqual([]);
  });

  it("导航顺序照 navItems，不照 Object.keys", () => {
    /**
     * ⚠ 第 3 步改成 as_completed 之后，**产出顺序 = 完成顺序**，跟 spec 里的
     * 页面顺序无关了。拿 Object.keys 当导航顺序会让交付包里的页乱序，
     * 而且每次跑还不一样。真正的顺序在 navItems（page_shell 重排过那份）。
     */
    const state = {
      sessionId: "s",
      specFirstPages: {
        pages: { p3: "<html>丙</html>", p1: "<html>甲</html>", p2: "<html>乙</html>" },
        navItems: [{ id: "p1", label: "首页" }, { id: "p2" }, { id: "p3" }],
      },
    } as never;
    expect(deliveryPagesFromState(state).map(p => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("navItems 里没有的页不许被丢掉 —— 排在后面也得交", () => {
    const state = {
      sessionId: "s",
      specFirstPages: {
        pages: { p1: "<html>甲</html>", 漏网: "<html>丁</html>" },
        navItems: [{ id: "p1" }],
      },
    } as never;
    expect(deliveryPagesFromState(state).map(p => p.id)).toEqual(["p1", "漏网"]);
  });

  it("navItems 缺席也能交 —— 只是顺序不保证", () => {
    const state = {
      sessionId: "s",
      specFirstPages: { pages: { p1: "<html>甲</html>" } },
    } as never;
    expect(deliveryPagesFromState(state)).toHaveLength(1);
  });

  it("导航名取 label，缺省回落 id，不显 undefined", () => {
    const state = {
      sessionId: "s",
      specFirstPages: {
        pages: { p1: "<html>甲</html>", p2: "<html>乙</html>" },
        navItems: [{ id: "p1", label: "预约挂号" }, { id: "p2" }],
      },
    } as never;
    expect(deliveryPagesFromState(state).map(p => p.name)).toEqual(["预约挂号", "p2"]);
  });
});

describe("推演说明并进包里", () => {
  it("有 notesMd 时包里带得上", () => {
    const html = serializeSlideRuleDeliveryHtml(PAGES, { notesMd: "# 推演总结\n覆盖 6/6" });
    const D = payloadOf(html);
    expect(D.notes).toBeTruthy();
    const notes = decode(D.notes);
    expect(notes).toContain("覆盖 6/6");
  });

  it("没有说明时不留空条目", () => {
    const html = serializeSlideRuleDeliveryHtml(PAGES, {});
    const D = payloadOf(html);
    expect(D.notes).toBe("");
  });
});
