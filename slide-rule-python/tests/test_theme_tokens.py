"""主题锁：顶栏/侧栏同一套 chrome，卡片不许跟主题对着干。

正向：浅色不搜深砖、深色 Header 与 aside 同色、通用后台换成产品名。
反向：没接进 unify / pipeline 的调用点，函数写对也等于没修。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import DEFAULT_DESIGN_LANGUAGE  # noqa: E402
from services.theme_tokens import (  # noqa: E402
    THEME_MARK,
    THEME_STYLE_ID,
    apply_theme_to_html,
    apply_theme_to_pages,
    derive_theme_tokens,
    is_dark_tone,
    language_from_style_brief,
    resolve_theme_language,
)

DARK_PAGE = """<!doctype html><html><head></head><body>
<header class="bg-black text-white">顶栏</header>
<aside class="bg-slate-800 text-white">侧栏</aside>
<main>
  <div class="bg-white p-4">突然一块白卡</div>
</main>
</body></html>"""

LIGHT_PAGE = """<!doctype html><html><head></head><body>
<header class="bg-white">顶栏</header>
<aside class="bg-slate-50">侧栏</aside>
<main>
  <div class="bg-slate-900 text-white p-6">系统设置</div>
  <div class="bg-black">数据监控</div>
</main>
</body></html>"""


class Test深浅判断:
    def test_浅色词优先(self):
        assert is_dark_tone("企业后台风格，浅色底") is False
        assert is_dark_tone("深色点缀的浅色底") is False

    def test_深色调(self):
        assert is_dark_tone("科技感深色仪表盘") is True
        assert is_dark_tone("dark neon console") is True


class Test语义色:
    def test_header与sidebar共用chrome(self):
        """shadcn 允许 sidebar 略深一档；真机病是两边各发明一个深色，所以焊死同一值。"""
        dark = derive_theme_tokens({"tone": "科技感深色", "primary": "#0ea5e9"})
        light = derive_theme_tokens({"tone": "浅色底", "primary": "#0ea5e9"})
        assert dark["scheme"] == "dark" and light["scheme"] == "light"
        assert dark["chrome"]
        css = apply_theme_to_html(DARK_PAGE, dark)
        compact = css.replace("\n", "")
        assert "header,aside,nav.fixed{background-color:var(--chrome)" in compact
        assert dark["chrome"] != dark["background"]

    def test_浅色页深砖被改写成卡片色(self):
        tokens = derive_theme_tokens({"tone": "浅色底", "primary": "#2563eb"})
        out = apply_theme_to_html(LIGHT_PAGE, tokens)
        assert 'data-theme="light"' in out
        assert 'html[data-theme="light"] main .bg-slate-900' in out
        assert 'html[data-theme="light"] main .bg-black' in out
        assert THEME_STYLE_ID in out
        assert THEME_MARK in out

    def test_深色页白卡被改写成卡片色(self):
        tokens = derive_theme_tokens({"tone": "深色", "primary": "#0ea5e9"})
        out = apply_theme_to_html(DARK_PAGE, tokens)
        assert 'data-theme="dark"' in out
        assert 'html[data-theme="dark"] main .bg-white' in out

    def test_幂等(self):
        tokens = derive_theme_tokens(DEFAULT_DESIGN_LANGUAGE)
        once = apply_theme_to_html(LIGHT_PAGE, tokens)
        twice = apply_theme_to_html(once, tokens)
        assert twice.count(f'id="{THEME_STYLE_ID}"') == 1
        assert twice.count(THEME_MARK) == 1

    def test_风格段散文也能抽出主色(self):
        lang = language_from_style_brief({
            "app": "科技感深色，主色 #0ea5e9，强调 #22d3ee。",
            "pages": {"p1": "地图"},
        })
        assert lang["primary"] == "#0ea5e9"
        assert is_dark_tone(lang["tone"]) is True

    def test_人写散文走resolve(self):
        lang = resolve_theme_language(None, None, "浅色底，主色 #0f766e")
        assert lang["primary"] == "#0f766e"


class Test接在活路上:
    def test_pipeline在unify之后钉主题(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "spec_first_pipeline.py"),
            encoding="utf-8",
        ).read()
        # 用赋值语句定位，不用 ident 全文搜索——模块头文档会把
        # unify_shell 这个词带跑，三引号剥错还会把这段代码吃掉。
        i = src.index("shell = unify_shell(pages, spec, device=device")
        j = src.index("pages = apply_theme_to_pages(pages, _theme_lang)")
        k = src.index("_reemit_pages(sink, pages, bound=False)")
        assert i < j < k
        assert "resolve_theme_language(" in src[i:k]
        # 打孔会整页重写。主题必须在 repair_pages_after_bind 之后再钉一次，
        # 否则用户看见的 bound=True 成品页又漂回去。删掉后半段，这条必红。
        bind_at = src.index("repair_pages_after_bind(")
        j2 = src.index(
            "pages = apply_theme_to_pages(pages, _theme_lang)", bind_at
        )
        assert j2 > bind_at
        # Binding now supplies the authoritative per-page status map; retain
        # the ordering guarantee while allowing the richer call shape.
        emit_after_bind = src.index("_reemit_pages(sink, pages, bound=True", j2)
        assert emit_after_bind > j2
        assert "binding_status=page_bind_status" in src[emit_after_bind : emit_after_bind + 180]

    def test_多页一起钉(self):
        tokens_lang = {"tone": "浅色底", "primary": "#2563eb"}
        out = apply_theme_to_pages({"p1": LIGHT_PAGE, "p2": LIGHT_PAGE}, tokens_lang)
        assert all(THEME_STYLE_ID in html for html in out.values())
        assert all('data-theme="light"' in html for html in out.values())

    def test_注入形状extractPalette读得动(self):
        """跟 html-app-surface.extractPalette 配对：键是标识符，值是 '#rrggbb'。"""
        tokens = derive_theme_tokens({"tone": "深色", "primary": "#0ea5e9"})
        html = apply_theme_to_html("<html><head></head><body></body></html>", tokens)
        assert "chrome: '" in html
        assert "background: '" in html
        assert re.search(r"colors:\s*\{\n\s*background:", html)

    def test_浅色顶栏白字和高亮被盖住(self):
        """★ 满电青年：面包屑/菜单 text-white 在浅 chrome 上看不见。"""
        tokens = derive_theme_tokens({"tone": "浅色底", "primary": "#2563eb"})
        src = (
            "<html><head></head><body>"
            '<header class="text-white"><nav aria-label="Breadcrumb">'
            '<a aria-current="page" class="text-white">当前页</a></nav>'
            '<button class="bg-slate-900">发布</button></header>'
            '<aside><a aria-current="page" class="text-white">甲</a></aside>'
            "</body></html>"
        )
        out = apply_theme_to_html(src, tokens)
        assert 'html[data-theme="light"] header .text-white' in out
        assert 'html[data-theme="light"] header .bg-slate-900' in out
        assert 'aside [aria-current="page"]' in out
        assert 'nav[aria-label="Breadcrumb"] [aria-current="page"]' in out
        assert "aside nav a{box-sizing:border-box;width:100%;" in out.replace("\n", "")
        assert 'html[data-theme="light"] header .bg-zinc-950' in out
        assert 'html[data-theme="light"] aside .bg-slate-950' in out
        assert "justify-content:flex-start" in out
        assert "aside nav a svg" in out
        assert ".grid-cols-24{" in out
        assert ".grid-cols-13{" in out
        assert ".grid-cols-12{" not in out
        assert "min-width:var(--shell-aside-width)" in out
        assert "align-items:center" in out

    def test_对比层与前端同文(self):
        from services.theme_tokens import _chrome_contrast_css

        ts = open(
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "..",
                "client",
                "src",
                "pages",
                "sliderule",
                "live-runtime",
                "html-app-surface.tsx",
            ),
            encoding="utf-8",
        ).read()
        css = _chrome_contrast_css()
        for token in (
            'html[data-theme="light"] header .text-white',
            "aside nav a{box-sizing:border-box;width:100%;",
            'aside [aria-current="page"]',
            'nav[aria-label="Breadcrumb"] [aria-current="page"]',
            "min-width:var(--shell-aside-width)",
            "--shell-aside-width:16rem",
            '[data-shell="aside"]',
            "bg-zinc-950",
            "align-items:center",
            "justify-content:flex-start",
            "aside nav a svg",
            'html[data-theme="light"] aside .bg-slate-950',
            ".grid-cols-24{",
        ):
            assert token in css, token
            assert token in ts, token


class Test主题锁只染菜单不刷整页:
    """主题锁的职责是**统一菜单配色**，作用域就该是菜单（2026-08-22）。

    ## 病灶（真机 53 页量出来的，不是设想）

    它自己的模块头写着当初治的是什么：「Header 有时黑有时白、**侧栏**海军蓝
    顶栏纯黑、浅色页底部一块 bg-slate-900 的**砖**」——三个症状全是 chrome
    和砖，**一个都不是「整页底色」**。可它写出来的第一条 CSS 是：

        html,body{background-color:var(--background)!important;
                  color:var(--foreground)!important}

    这条不在治病范围内，是**范围外扩**。代价：53/53 页的整页底色被改，其中
    **8 页深浅整个翻转**——模型画的黑底白字被刷成白底，字还是白的，
    实测 1.09:1。而它真该管的那条 ``nav.fixed`` 在 26/26 手机页命中 **0**，
    底栏一次都没染到（1.1:1 深板岩字压深绿底，两页都有）。

    ## 修法与为什么是这个修法

    1. 整页那条降级成 **``@layer`` 兜底**，不再 ``!important``。
       分层的意义正是「给个默认值，作者一写就让位」：实测同一份 HTML，
       页面自己声明 ``body{background:#14271F}`` 时保住深色，页面什么都
       没声明时才吃到兜底色（不会透出 iframe 黑底）。
    2. chrome 那条认 ``data-shell``（第 1 步打的标），旧选择器留着当存量退路。

    ## ⚠ 分层里绝不许写 !important

    实测：``@layer f{html,body{background:#eff7f4!important}}`` **压过**
    未分层的 ``body{background:#14271F}``——``!important`` 声明的层序是
    **反的**，分层的反而更强。真写进去等于什么都没改，而判据看着还挺像回事。
    """

    def _css(self, tone: str = "浅色底") -> str:
        tokens = derive_theme_tokens({"tone": tone, "primary": "#1e3a2f"})
        return apply_theme_to_html(DARK_PAGE, tokens).replace("\n", "")

    def test_整页底色只是兜底_不许再_important(self):
        css = self._css()
        assert "html,body{background-color:var(--background)!important" not in css
        assert "color:var(--foreground)!important}" not in css
        assert "@layer" in css, "整页那条得进分层，否则页面自己的声明赢不了"

    def test_分层里不许出现_important(self):
        """⚠ 这条不是洁癖：分层 + !important 的层序是反的，会把兜底变成霸王条款。"""
        css = self._css()
        for chunk in re.findall(r"@layer[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}", css):
            assert "!important" not in chunk, f"分层里混进了 !important：{chunk[:120]}"

    def test_chrome_认_data_shell_三种壳(self):
        css = self._css()
        for value in ("header", "aside", "nav"):
            assert f'[data-shell="{value}"]' in css, f"chrome 规则没认 data-shell={value}"

    def test_反向_chrome_不许染_main(self):
        """染了 main 等于换个写法把整页重刷一遍，正是这次要治的病。"""
        css = self._css()
        assert '[data-shell="main"]' not in css

    def test_存量退路还在(self):
        """老会话没有 data-shell，旧选择器不能一起删——否则存量应用的顶栏侧栏当场失色。"""
        css = self._css()
        assert "header,aside,nav.fixed" in css or "header,aside" in css

    def test_chrome_的底色和字色必须一起给(self):
        """⚠ 只给一样就是这次要治的病：底还是模型的深绿、字被换成浅色主题的
        深板岩 → 1.1:1。手机底栏两页都中过。"""
        css = self._css()
        m = re.search(r'\[data-shell="header"\][^{]*\{([^}]*)\}', css)
        assert m, f"找不到 chrome 规则：{css[:200]}"
        body = m.group(1)
        assert "background-color:var(--chrome)!important" in body
        assert "color:var(--chrome-fg)!important" in body


class Test深浅跟着页面走:
    """深浅判定不许只读散文，得看页面自己画成什么样（2026-08-22）。

    ## 为什么光收窄作用域不够

    第一版只把主题锁从「刷整页」收成「只刷菜单」。结果真机上出现新形态：
    页面保住了模型的深色底（分层兜底让位了），**菜单却按浅色主题刷成白条**
    ——深内容配白顶栏白底栏，比原来"全刷浅色"还刺眼。作用域对了，**极性还错**。

    根因在 ``derive_theme_tokens``：

        dark = is_dark_tone(str(d.get("tone") or ""))

    整个深浅分支押在这一个布尔上，而它只读**设计语言那句散文**里有没有
    「深色/暗色/dark」。健身打卡那版散文里没写，于是判成浅色，可页面自己
    写着 ``body{background-color:#14271F}``。

    ## 做法

    加一条「看页面」的证据（``page_tone_evidence``），与散文冲突时**以页面为准**。
    理由不是页面更权威，是**代价不对称**：主题锁带 !important，判错就是
    深底深字/浅底浅字，判对的收益只是配色统一。

    阈值 0.42 相对亮度，取自 APCA 的 polarity 分界点（apcacontrast.com）。
    一个应用一个结论（多页投票），保持「一份 theme 染全身」这个设计不变。
    """

    DARK_BODY_STYLE = (
        "<!DOCTYPE html><html><head><style>body{background-color:#14271F;color:#F3F4F6}</style>"
        "</head><body class='flex flex-col'><header>顶</header><main>正文</main></body></html>"
    )
    DARK_BODY_ARBITRARY = (
        "<!DOCTYPE html><html><head></head>"
        "<body class='flex flex-col bg-[#12231B] text-gray-100'><main>正文</main></body></html>"
    )
    DARK_BODY_BRICK = (
        "<!DOCTYPE html><html><head></head>"
        "<body class='bg-slate-900 text-gray-100'><main>正文</main></body></html>"
    )
    LIGHT_BODY = (
        "<!DOCTYPE html><html><head></head>"
        "<body class='bg-white text-slate-900'><main>正文</main></body></html>"
    )
    NO_EVIDENCE = "<!DOCTYPE html><html><head></head><body><main>正文</main></body></html>"

    def test_三种写法都认得出深色(self):
        from services.theme_tokens import page_tone_evidence

        for name, html in (
            ("页面自带 style", self.DARK_BODY_STYLE),
            ("任意值 bg-[#hex]", self.DARK_BODY_ARBITRARY),
            ("Tailwind 深色砖", self.DARK_BODY_BRICK),
        ):
            lum = page_tone_evidence(html)
            assert lum is not None, f"{name}：没抽出证据"
            assert lum < 0.42, f"{name}：亮度 {lum} 没判成深色"

    def test_浅色页判成浅(self):
        from services.theme_tokens import page_tone_evidence

        lum = page_tone_evidence(self.LIGHT_BODY)
        assert lum is not None and lum >= 0.42

    #: body 有一堆 class，但**没有一个是能认出底色的**。
    #: ⚠ 这一条比「body 完全没 class」重要：真机绝大多数页面是这形状
    #:   （bg-gradient / 自定义类 / 什么都不写），走的是最后那条 return None。
    #:   第一版判据只测了没 class 的早退路径，把最后那条 `return None` 改成
    #:   `return 0.9` 照样全绿——典型的「判据咬不住」。
    CLASS_BUT_UNKNOWN = (
        "<!DOCTYPE html><html><head></head>"
        '<body class="flex flex-col h-full antialiased font-sans"><main>正文</main></body></html>'
    )

    def test_反向_没证据就返回_None_不许瞎猜(self):
        """⚠ 「宁可少认，不可认错」：抽不出来就交回给散文，别自己发明一个默认深浅。"""
        from services.theme_tokens import page_tone_evidence

        assert page_tone_evidence(self.NO_EVIDENCE) is None
        assert page_tone_evidence(self.CLASS_BUT_UNKNOWN) is None

    def test_反向_认不出底色的页不参与投票(self):
        """认不出的页不能被当成「浅色一票」，否则一页深三页认不出就翻盘。"""
        from services.theme_tokens import pages_tone_evidence

        assert pages_tone_evidence({"p1": self.CLASS_BUT_UNKNOWN}) is None
        assert pages_tone_evidence(
            {"p1": self.DARK_BODY_STYLE, "p2": self.CLASS_BUT_UNKNOWN,
             "p3": self.CLASS_BUT_UNKNOWN, "p4": self.CLASS_BUT_UNKNOWN}
        ) is True

    def test_散文说浅色但页面是深色_以页面为准(self):
        """这条正对着真机那 4 页：散文没写深色 → 判浅 → 白顶栏压深内容。"""
        pages = {"p1": self.DARK_BODY_STYLE, "p2": self.DARK_BODY_ARBITRARY}
        out = apply_theme_to_pages(pages, {"tone": "浅色底", "primary": "#1e3a2f"})
        for pid, html in out.items():
            assert 'data-theme="dark"' in html, f"{pid} 仍按浅色钉"

    def test_反向_散文说深色且页面也深_仍然是深(self):
        """别把修法写成「永远无视散文」——没证据的页得靠散文。"""
        out = apply_theme_to_pages(
            {"p1": self.NO_EVIDENCE}, {"tone": "科技感深色", "primary": "#0ea5e9"}
        )
        assert 'data-theme="dark"' in out["p1"]

    def test_反向_页面是浅色时不许被散文里的深色词带偏(self):
        out = apply_theme_to_pages(
            {"p1": self.LIGHT_BODY, "p2": self.LIGHT_BODY},
            {"tone": "科技感深色", "primary": "#0ea5e9"},
        )
        assert 'data-theme="light"' in out["p1"]

    def test_多页投票_少数派不翻盘(self):
        """一个应用一个结论：3 深 1 浅仍然是深，不许每页各判各的。"""
        pages = {
            "p1": self.DARK_BODY_STYLE,
            "p2": self.DARK_BODY_ARBITRARY,
            "p3": self.DARK_BODY_BRICK,
            "p4": self.LIGHT_BODY,
        }
        out = apply_theme_to_pages(pages, {"tone": "浅色底", "primary": "#1e3a2f"})
        schemes = {pid: ('dark' if 'data-theme="dark"' in h else 'light') for pid, h in out.items()}
        assert set(schemes.values()) == {"dark"}, schemes


class Test间距契约只有一处主人:
    """「侧栏多宽 / 主体让多少位」这条契约，定义只许有一份（2026-08-22）。

    ## 病灶

    同一件事劈在两个文件里：

        桌面：侧栏 16rem + 主体 margin-left:16rem   → theme_tokens._chrome_contrast_css
        手机：header 静态 + main 吃剩余 + nav 贴底  → page_shell._PHONE_FILL_CSS

    一半在「配色」里、一半在「铺满」里，正是本仓「改一半必然静默失效」的温床。
    而且桌面那半靠 ``aside[class*="fixed"]:has(nav a)`` 猜壳——第 1 步已经给
    壳打了 ``data-shell``，没理由再猜。

    ## 为什么是「定义搬家、注入不动」

    ⚠ **不能**把这几条直接挪进 ``_DESKTOP_FILL_CSS``。bind 会整页重写、吃掉
    head，而 ``spec_first_pipeline`` 在 bind 之后**只重钉主题**
    （``apply_theme_to_pages``），铺满层没人补（它只在 ``unify_shell`` 里注入
    一次）。挪过去等于在 bind 路径上静默丢契约——不报错、不告警。

    所以：**定义**搬到 page_shell（壳的主人），**注入**仍走主题层（耐久的那层）。
    数字只留一个来源 ``--shell-aside-width``，照 shadcn Sidebar 的
    ``--sidebar-width: 16rem``。
    """

    def test_定义在_page_shell_不在_theme_tokens(self):
        import inspect

        from services import theme_tokens
        from services.page_shell import SHELL_ASIDE_LAYOUT_CSS

        assert "--shell-aside-width" in SHELL_ASIDE_LAYOUT_CSS
        src = inspect.getsource(theme_tokens)
        # 剥注释再匹配：模块头讲的就是这条契约，带着注释比对会误绿/误红。
        code = "\n".join(
            line for line in src.splitlines() if not line.lstrip().startswith("#")
        )
        code = re.sub(r'"""[\s\S]*?"""', "", code)
        assert "margin-left:16rem" not in code, "契约还留在 theme_tokens 里"
        assert "min-width:16rem" not in code, "契约还留在 theme_tokens 里"

    def test_body忘写flex那条也走同一个变量(self):
        """新加的救场规则不许再写死 16rem——否则又回到「改一个忘一个」。"""
        from services.page_shell import SHELL_ASIDE_LAYOUT_CSS

        rules = [r for r in SHELL_ASIDE_LAYOUT_CSS.split("}") if "body:not(.flex)" in r]
        assert len(rules) == 2, [r.split("{")[0] for r in rules]
        offset = [r for r in rules if "margin-left" in r]
        assert offset and "var(--shell-aside-width)" in offset[0]

    def test_数字只有一个来源(self):
        from services.page_shell import SHELL_ASIDE_LAYOUT_CSS

        assert SHELL_ASIDE_LAYOUT_CSS.count("16rem") == 1, (
            "16rem 出现多次——宽度和让位必须共用同一个变量，否则改一个忘一个"
        )
        assert SHELL_ASIDE_LAYOUT_CSS.count("var(--shell-aside-width)") >= 3

    def test_认标也留存量退路(self):
        """⚠ 逐条查，不许拿整串做子串匹配。

        第一版写成 ``'[data-shell="aside"]' in SHELL_ASIDE_LAYOUT_CSS``，
        把「宽度」那条的标删掉照样绿——因为「让位」那条里还有这个子串。
        典型的判据咬不住。
        """
        from services.page_shell import SHELL_ASIDE_LAYOUT_CSS

        rules = [r for r in SHELL_ASIDE_LAYOUT_CSS.split("}") if "{" in r]
        # 这份常量里住着**两件事**，判据要分开看：
        #   ① 宽度 / 让位（3 条）——认 data-shell 标，留 :has(nav a) 存量退路
        #   ② body 忘写 flex 时把侧栏提成 fixed（2 条）——键在 body:not(.flex)，
        #     跟「是不是壳」无关，不该要求它认标
        body = [
            r for r in rules
            if not r.strip().startswith(":root") and "body:not(.flex)" not in r
        ]
        assert len(body) == 3, [r.split("{")[0] for r in rules]
        for rule in body:
            sel = rule.split("{")[0]
            assert '[data-shell="aside"]' in sel, f"这条没认标：{sel}"
            # 存量退路的标志是老写法 `:has(nav a)`（宽度那条是 aside:has(nav a)，
            # 另两条是 aside[class*="fixed"]:has(nav a)）。
            assert ":has(nav a)" in sel, f"这条没留存量退路：{sel}"

    def test_成品页里契约还在_行为不变(self):
        """★ 定义搬家不许改变成品。删掉 theme 里那次引用，本条必须红。"""
        src = (
            "<!DOCTYPE html><html><head></head><body>"
            '<aside class="fixed w-64"><nav><a href="#">甲</a></nav></aside>'
            "<main>正文</main></body></html>"
        )
        out = apply_theme_to_html(src, derive_theme_tokens({"tone": "浅色底"}))
        compact = out.replace("\n", "")
        assert "--shell-aside-width:16rem" in compact
        assert "margin-left:var(--shell-aside-width)!important" in compact
        assert "width:var(--shell-aside-width)!important" in compact
