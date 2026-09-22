"""画页主题锁：语义色变量钉死顶栏/侧栏/卡片，不靠模型自觉。

⚠ 2026-08-20 真机（满电青年）：同一应用里 Header 有时黑、有时白，
  侧栏海军蓝、顶栏纯黑；浅色页底部又突然出现 bg-slate-900 的「系统设置」
  砖。设计语言只把 hex 写进散文（「主色 #2563eb」），每页 LLM 各画各的
  Tailwind 灰阶——提示词拦不住，也没有任何一层去改。

做法照 shadcn/ui 的语义 token（:root 上 --background/--card/--primary，
组件不写死颜色；sidebar 与 background 同族）和 daisyUI 的「一份 theme
对象染全身」。我们比 shadcn 更严一档：`--chrome` 同时铺 header 和
aside——真机的病就是这两块各自发明了一个深色。

W3C Design Tokens 的 hex→分量仍由 design_language.to_dtcg 算；这里只
派生「给 CSS / Tailwind Play 用的那一张表」。OKLCh 走 coloraide，跟
palette_guard 同一把尺。

增强类 fail-open：钉主题挂了不许拖画页。

⚠ 2026-08-22 真机 53 页量出来的两笔账，都记在这里：

  **① 作用域外扩。** 上面那三个病灶——Header 忽黑忽白、侧栏海军蓝、浅色页
  里一块深砖——**没有一个是「整页底色」**。可第一版写出来的头一条 CSS 是
  ``html,body{background-color:…!important;color:…!important}``。代价：
  53/53 页整页底色被改，8 页深浅整个翻转（模型的黑底白字被刷成白底、字还是
  白的，实测 1.09:1）。而它真该管的 ``nav.fixed`` 在 **26/26 手机页命中 0**，
  底栏一次都没染到（深板岩字压深绿底 1.1:1）。**该管的漏光，不该管的全中。**

  修法：整页那条降级成 ``@layer sliderule-fallback`` 兜底（页面自己一声明
  就让位），chrome 那条认 ``page_shell`` 打的 ``data-shell``。

  ⚠ **分层里绝不许写 !important**：``!important`` 声明的层序是**反的**，
    ``@layer f{html,body{…!important}}`` 反而压过未分层的普通声明。实测过。
  ⚠ 同一个病在 ``page_shell._PHONE_FILL_CSS`` 里还有第二处
    （``background:#fff!important``）。只改这边，手机端深浅翻转从 4 页涨到
    **8 页**、整屏纯白——那条也一起进了同名分层。

  **② 极性脱离页面。** 只收窄作用域不够：页面保住深色、菜单却按浅色主题刷成
  白条，深浅在同一屏里打架。根因是深浅全押在 ``is_dark_tone(tone)``——只读
  散文。加了 ``page_tone_evidence``（看页面自己声明的 body 底色），冲突时
  **以页面为准**。真机 15 个应用里改判了 2 个，深浅翻转 8 → 0。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional

from coloraide import Color

from .design_language import DEFAULT_DESIGN_LANGUAGE, normalize_design_language
from .page_shell import SHELL_ASIDE_LAYOUT_CSS
from .palette_guard import repair_colors

THEME_STYLE_ID = "sliderule-theme"
THEME_MARK = "sliderule-theme-tokens"

_HEX = re.compile(r"#[0-9a-fA-F]{6}")
_DARK_MARKS = ("深色", "暗色", "暗黑", "黑底", "夜间", "dark")
_LIGHT_MARKS = ("浅色", "亮色", "白底", "浅底", "light")

#: 浅色页里模型爱用的「强调深砖」；深色页里的「突然一块白卡」。
#: 选择器盯 Tailwind 真类名（Play CDN 会生成 .bg-slate-900），不靠 class*= 误伤。
_LIGHT_DARK_BRICKS = (
    "bg-black",
    "bg-slate-800", "bg-slate-900", "bg-slate-950",
    "bg-gray-800", "bg-gray-900", "bg-gray-950",
    "bg-zinc-800", "bg-zinc-900", "bg-zinc-950",
    "bg-neutral-800", "bg-neutral-900", "bg-neutral-950",
    "bg-stone-800", "bg-stone-900", "bg-stone-950",
)
_DARK_LIGHT_BRICKS = (
    "bg-white",
    "bg-gray-50", "bg-slate-50", "bg-zinc-50", "bg-neutral-50", "bg-stone-50",
)


def is_dark_tone(tone: str) -> bool:
    """浅色词优先：同时写「深色点缀的浅色底」仍算浅色。"""
    text = str(tone or "")
    low = text.lower()
    if any(m in text or m in low for m in _LIGHT_MARKS):
        return False
    return any(m in text or m in low for m in _DARK_MARKS)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _to_hex(lightness: float, chroma: float, hue: float) -> str:
    color = Color("oklch", [_clamp01(lightness), max(0.0, chroma), hue % 360.0])
    return color.convert("srgb").fit("srgb").to_string(hex=True).lower()


def _lch(hex_color: str) -> Optional[tuple[float, float, float]]:
    try:
        c = Color(hex_color).convert("oklch")
    except Exception:  # noqa: BLE001
        return None
    hue = c["hue"]
    if hue != hue:
        hue = 0.0
    return float(c["lightness"]), float(c["chroma"]), float(hue)


def _fg_for(lightness: float) -> str:
    return "#f8fafc" if lightness < 0.6 else "#0f172a"


#: 深浅判定的「看页面」那一路（2026-08-22）。
#:
#: ⚠ 病灶：``derive_theme_tokens`` 里整个深浅分支押在
#:   ``is_dark_tone(d["tone"])`` 这一个布尔上，而它只读**设计语言那句散文**。
#:   健身打卡那版散文里没写「深色」，于是判成浅色；可页面自己写着
#:   ``body{background-color:#14271F}``。真机 53 页里 8 页因此深浅整个翻转。
#:   把主题锁收窄成「只刷菜单」之后病没好，只是换了形态：内容保住深色、
#:   顶栏底栏被刷成白条，深浅在同一屏里打架。**作用域对了，极性还错。**
#:
#: 阈值 0.42 取自 APCA 的 polarity 分界（apcacontrast.com）：它是
#: polarity-aware 的对比模型，把「浅底深字」和「深底浅字」当两件事，
#: 相对亮度 ≈0.42 是那条分界线。
#:
#: ⚠ 抽不出证据就返回 None，**不许自己发明一个默认深浅**——交回给散文。
#:   「宁可少认，不可认错」是本仓 demo-seed-semantics 立的规矩，同样适用。
_TONE_PIVOT = 0.42
#: <body> 上常见的深色砖。只列 Tailwind 默认色阶里**确定是深色**的那几档，
#: 拿不准的不列——认错比不认更贵。
_BODY_DARK_CLASS_HEX = {
    "bg-black": "#000000",
    "bg-slate-800": "#1e293b", "bg-slate-900": "#0f172a", "bg-slate-950": "#020617",
    "bg-gray-800": "#1f2937", "bg-gray-900": "#111827", "bg-gray-950": "#030712",
    "bg-zinc-800": "#27272a", "bg-zinc-900": "#18181b", "bg-zinc-950": "#09090b",
    "bg-neutral-800": "#262626", "bg-neutral-900": "#171717", "bg-neutral-950": "#0a0a0a",
    "bg-stone-800": "#292524", "bg-stone-900": "#1c1917", "bg-stone-950": "#0c0a09",
}
_BODY_LIGHT_CLASS_HEX = {
    "bg-white": "#ffffff",
    "bg-slate-50": "#f8fafc", "bg-gray-50": "#f9fafb", "bg-zinc-50": "#fafafa",
    "bg-neutral-50": "#fafafa", "bg-stone-50": "#fafaf9",
}
_BODY_OPEN = re.compile(r"<body\b[^>]*>", re.I)
#: class 值。单双引号都收——真机基本是双引号，但判据/存量里两种都出现过。
_BODY_CLASS = re.compile(r"""class\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
#: 页面自己那份 <style> 里给 body 定的底色。``[\s\S]*?`` 防止跨规则误吃。
_BODY_BG_RULE = re.compile(
    # ⚠ 前缀不能写成 ``(?:^|[}\s,])``：``<style>body{…`` 里 body 前面是 ``>``，
    #   第一版就是这么把最要紧的那种写法漏掉的（真机健身打卡正是这形状）。
    #   改成「前面不是标识符字符」，既放行 ``>body{`` 又挡住 ``.mybody{``。
    r"(?<![\w.#-])body\s*\{[^}]*?background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})",
    re.I,
)
_ARBITRARY_BG = re.compile(r"bg-\[(#[0-9a-fA-F]{3,8})\]")


def _luminance(hex_color: str) -> Optional[float]:
    try:
        return float(Color(hex_color).luminance())
    except Exception:  # noqa: BLE001  增强类 fail-open：算不出就当没证据
        return None


def page_tone_evidence(html: str) -> Optional[float]:
    """页面**自己**声明的 body 底色的相对亮度。抽不出来返回 None。

    按可靠度取第一个命中：
      1. 页面自带 ``<style>`` 里的 ``body{background(-color):#hex}``
      2. ``<body class>`` 上的任意值 ``bg-[#hex]``
      3. ``<body class>`` 上 Tailwind 默认色阶的深/浅砖

    ⚠ 只看 ``<body>``，不看里面的容器：模型常给内容区套一张深色卡片，
      那不代表整页是深色主题。
    ⚠ 不看我们自己注入的那几块：``sliderule-theme`` / ``sliderule-*-fill``
      里也有 ``html,body{...}``，读进来就成了自己证明自己。
    """
    text = html or ""
    if not text:
        return None
    # 自己注入的样式块先剔掉，否则读到的是上一轮钉进去的结果
    own = re.sub(
        r'<style id="sliderule-[^"]*">[\s\S]*?</style>', "", text, flags=re.I
    )
    m = _BODY_BG_RULE.search(own)
    if m:
        lum = _luminance(m.group(1))
        if lum is not None:
            return lum
    body = _BODY_OPEN.search(own)
    if not body:
        return None
    cls_m = _BODY_CLASS.search(body.group(0))
    if not cls_m:
        return None
    tokens = (cls_m.group(1) or cls_m.group(2) or "").split()
    for tok in tokens:
        hit = _ARBITRARY_BG.fullmatch(tok)
        if hit:
            lum = _luminance(hit.group(1))
            if lum is not None:
                return lum
    for tok in tokens:
        hexv = _BODY_DARK_CLASS_HEX.get(tok) or _BODY_LIGHT_CLASS_HEX.get(tok)
        if hexv:
            return _luminance(hexv)
    return None


def pages_tone_evidence(pages: Dict[str, str]) -> Optional[bool]:
    """一个应用一个结论：各页投票，多数决。全无证据返回 None。

    ⚠ 不许每页各判各的——「一份 theme 染全身」正是这一层存在的理由。
    """
    dark = light = 0
    for html in (pages or {}).values():
        lum = page_tone_evidence(html)
        if lum is None:
            continue
        if lum < _TONE_PIVOT:
            dark += 1
        else:
            light += 1
    if not dark and not light:
        return None
    return dark > light


def derive_theme_tokens(dl: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """design_language → 语义色表。header 与 sidebar 共用 chrome，不许分叉。"""
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)
    primary = str(d["primary"])
    accent = str(d["accent"])
    got = _lch(primary) or (0.5, 0.1, 250.0)
    _l, chroma, hue = got
    surf_c = min(0.03, max(0.008, chroma * 0.25))
    dark = is_dark_tone(str(d.get("tone") or ""))
    if dark:
        background = _to_hex(0.16, surf_c, hue)
        chrome = _to_hex(0.22, surf_c, hue)
        card = _to_hex(0.26, surf_c, hue)
        muted = _to_hex(0.28, surf_c, hue)
        border = _to_hex(0.34, surf_c, hue)
        foreground = _fg_for(0.16)
    else:
        background = _to_hex(0.97, surf_c, hue)
        chrome = _to_hex(0.99, min(0.02, surf_c), hue)
        card = _to_hex(1.0, min(0.01, surf_c), hue)
        muted = _to_hex(0.95, surf_c, hue)
        border = _to_hex(0.90, surf_c, hue)
        foreground = _fg_for(0.97)
    chrome_l = (_lch(chrome) or (0.22, 0, 0))[0]
    card_l = (_lch(card) or (1.0, 0, 0))[0]
    primary_l = (_lch(primary) or (0.5, 0, 0))[0]
    return {
        "scheme": "dark" if dark else "light",
        "primary": primary,
        "accent": accent,
        "background": background,
        "foreground": foreground,
        "chrome": chrome,
        "chromeFg": _fg_for(chrome_l),
        "card": card,
        "cardFg": _fg_for(card_l),
        "muted": muted,
        "border": border,
        "primaryFg": _fg_for(primary_l),
        "radius": str(d.get("radius") or "8px"),
    }


def language_from_style_brief(brief: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """风格段赢了的那条路没有 designLanguage 字典，从散文里捞 hex / 深浅。"""
    out = dict(DEFAULT_DESIGN_LANGUAGE)
    if not isinstance(brief, dict):
        return out
    text = str(brief.get("app") or "")
    hexes = _HEX.findall(text)
    if hexes:
        out["primary"] = hexes[0].lower()
        if len(hexes) > 1:
            out["accent"] = hexes[1].lower()
    if text.strip():
        out["tone"] = " ".join(text.split())[:60]
    return normalize_design_language(out)


def resolve_theme_language(
    design_language: Optional[Dict[str, Any]] = None,
    style_brief: Optional[Dict[str, Any]] = None,
    design_system: Optional[Any] = None,
) -> Dict[str, Any]:
    if isinstance(design_language, dict) and design_language.get("primary"):
        return normalize_design_language(design_language)
    if isinstance(style_brief, dict):
        return language_from_style_brief(style_brief)
    if isinstance(design_system, str) and design_system.strip():
        return language_from_style_brief({"app": design_system})
    if isinstance(design_system, dict):
        joined = " ".join(str(v) for v in design_system.values() if v)
        return language_from_style_brief({"app": joined})
    return dict(DEFAULT_DESIGN_LANGUAGE)


def _chrome_contrast_css() -> str:
    """浅色 chrome 上，盖掉模型按深色壳写的白字 / 白高亮 / 深按钮。

    ⚠ 2026-08-20 满电青年审查：``header,aside{color:var(--chrome-fg)!important}``
    **不会**压过子元素的 ``.text-white``（继承带不走 !important）。于是：
    面包屑当前节白字看不见、菜单高亮一块白、Logo 白字、顶栏右侧一排黑按钮。
    ``[aria-current="page"]`` 还同时打在侧栏和面包屑上——面包屑被涂成白底。

    选择器与前端 html-app-surface.CHROME_CONTRAST_CSS 同文，渲染时再钉一次，
    已经生成的页刷新就能看见。

    ⚠ 同日第二趟：Logo 和标题不对齐（aside 品牌行没有 items-center，对照
    shadcn SidebarMenuButton）；有文字的侧栏停在 w-16（对照 Sidebar
    ``--sidebar-width: 16rem``）；顶栏右侧分段控件写成 bg-zinc-950，
    浅色 Header 上是一块黑。砖表补 950，宽度和品牌行也盖在这一层——
    已经生成的页刷新即生效，不必重跑推演。

    ⚠ 2026-08-31 会聚通（sr-20260831123105-JTNBQHD7X4）：浅色壳上侧栏菜单
    文案飞到最右边、图标一灰一白。根因两层——
      1. ``build_nav_items`` 抄了源导航的 ``justify-between``（徽标位），
         ``_set_label`` 把徽标剥掉后只剩图标+文字，flex 把文字甩到尾。
         shadcn SidebarMenuButton 是 ``flex … gap-2``，**不是**
         justify-between（徽标是独立的 SidebarMenuBadge 兄弟）。
      2. 图标 SVG 烤着 ``text-slate-400`` / ``text-white``。元素选择器
         ``aside nav a svg`` 特异性 (0,0,3)，**压不过** Tailwind 类
         ``.text-slate-400`` (0,1,0)，必须 ``color:inherit!important``。
      3. 深砖改写原先只盖 header。aside 品牌行 ``bg-slate-950`` 漏光，
         浅色壳上仍是一块黑。header 选择器必须仍是前缀（既有判据钉着），
         再接 aside 同一张砖表。
      4. Tailwind Play 默认只生成 ``grid-cols-1..12``。时段矩阵写了
         ``grid-cols-24``，CDN 不产出这条，格子塌成一列。13–24 钉在
         这一层，已生成的页刷新即生效。
    """
    light_white = ",".join(
        f'html[data-theme="light"] {surf} .{cls}'
        for surf in ("header", "aside")
        for cls in ("text-white", "text-slate-100", "text-slate-200", "text-gray-100")
    )
    # header 选择器保持前缀，aside 接在后面——既有判据盯着 header .bg-*。
    light_dark_bg = ",".join(
        f'html[data-theme="light"] {surf} .{cls}'
        for surf in ("header", "aside")
        for cls in _LIGHT_DARK_BRICKS
    )
    return (
        f"{light_white}{{color:var(--chrome-fg,#0f172a)!important}}"
        f"{light_dark_bg}{{background-color:var(--muted)!important;"
        f"color:var(--chrome-fg,#0f172a)!important}}"
        "aside nav a{box-sizing:border-box;width:100%;"
        "display:flex!important;flex-direction:row!important;"
        "align-items:center!important;justify-content:flex-start!important;gap:.5rem}"
        "aside nav a svg{color:inherit!important}"
        "aside>:first-child:not(nav):not(:has(nav)){"
        "display:flex!important;flex-direction:row!important;"
        "align-items:center!important;gap:.5rem}"
        "aside :is(img,svg){flex-shrink:0}"
        # ★ 侧栏宽度与主体让位这条**空间契约**归 page_shell 定义（它是壳的
        #   主人），这里只负责把它注进主题层——主题层是 bind 之后唯一会被
        #   重钉的那层，铺满层不是。定义搬家、注入不动。
        + SHELL_ASIDE_LAYOUT_CSS
        +         'aside [aria-current="page"]{'
        "background-color:color-mix(in srgb,var(--primary,currentColor) 16%,var(--chrome,transparent))!important;"
        "color:var(--chrome-fg,inherit)!important;font-weight:600}"
        'header nav[aria-label="Breadcrumb"] [aria-current="page"],'
        'header nav[aria-label="breadcrumb"] [aria-current="page"]{'
        "background-color:transparent!important;"
        "color:var(--chrome-fg,inherit)!important;font-weight:600}"
        + _GRID_COLS_EXTRA_CSS
    )


#: Tailwind Play 默认只生成 .grid-cols-1 … 12。真机时段矩阵写了 24 列，
#: CDN 不产出这条，格子塌掉。补 13–24 钉在对比层——已生成的页刷新即生效。
_GRID_COLS_EXTRA_CSS = "".join(
    f".grid-cols-{n}{{grid-template-columns:repeat({n},minmax(0,1fr))}}"
    for n in range(13, 25)
)


def _theme_css(tokens: Dict[str, str]) -> str:
    scheme = tokens["scheme"]
    bricks = _LIGHT_DARK_BRICKS if scheme == "light" else _DARK_LIGHT_BRICKS
    brick_sel = ",".join(
        f'html[data-theme="{scheme}"] main .{cls}' for cls in bricks
    )
    return (
        f':root{{'
        f'--background:{tokens["background"]};'
        f'--foreground:{tokens["foreground"]};'
        f'--chrome:{tokens["chrome"]};'
        f'--chrome-fg:{tokens["chromeFg"]};'
        f'--card:{tokens["card"]};'
        f'--card-fg:{tokens["cardFg"]};'
        f'--primary:{tokens["primary"]};'
        f'--primary-fg:{tokens["primaryFg"]};'
        f'--muted:{tokens["muted"]};'
        f'--border:{tokens["border"]};'
        f'--radius:{tokens["radius"]};'
        f"}}"
        # 整页底色：**只是兜底**，进 @layer，页面自己一声明就让位。
        #
        # ⚠ 2026-08-22：这条原来是 !important，53/53 页的整页底色被它改掉，
        #   其中 8 页深浅整个翻转——模型画的黑底白字被刷成白底、字还是白的
        #   （实测 1.09:1）。而本模块头记的三个病灶（Header 忽黑忽白、侧栏
        #   海军蓝、浅色页里一块深砖）**没有一个是「整页底色」**，这条属于
        #   范围外扩。降级成分层兜底：实测页面写了 body{background:#14271F}
        #   就保住深色，什么都没写才吃到兜底色（不会透出 iframe 黑底）。
        # ⚠ **分层里绝不许写 !important**：!important 声明的层序是**反的**，
        #   `@layer f{html,body{...!important}}` 会压过未分层的普通声明，
        #   等于什么都没改。判据在 test_theme_tokens.Test主题锁只染菜单不刷整页。
        f"@layer sliderule-fallback{{"
        f"html,body{{background-color:var(--background);color:var(--foreground)}}"
        f"}}"
        # 顶栏和侧栏（含手机底栏）锁同一块 chrome。不许一边黑一边海军蓝。
        #
        # ⚠ 认 ``data-shell``（page_shell.mark_shell_parts 打的），不再靠
        #   ``nav.fixed`` 猜：真机 26/26 手机页的底栏都不带 .fixed，**命中 0**，
        #   底栏一次都没被染到——而 body 那条 color!important 又顺着继承下去，
        #   于是深板岩字压深绿底 1.1:1。旧选择器留着当存量会话的退路。
        # ⚠ 底色与字色必须**同一条规则一起给**。只给一样就是上面那个病：
        #   底还是模型的深色、字被换成浅色主题的深色。
        # ⚠ 不许把 ``[data-shell="main"]`` 加进来——那等于换个写法把整页重刷，
        #   正是这次要治的病。
        f'[data-shell="header"],[data-shell="aside"],[data-shell="nav"],'
        f"header,aside,nav.fixed{{background-color:var(--chrome)!important;"
        f"color:var(--chrome-fg)!important}}"
        f"{brick_sel}{{background-color:var(--card)!important;"
        f"color:var(--card-fg)!important;border-color:var(--border)!important}}"
        f"{_chrome_contrast_css()}"
    )


def _theme_config(tokens: Dict[str, str]) -> str:
    # extractPalette 只认 名字: '#rrggbb'，键必须是标识符（别加引号、别用连字符）。
    return (
        "<script>\n"
        f"/* {THEME_MARK} */\n"
        "tailwind.config = { theme: { extend: { colors: {\n"
        f"  background: '{tokens['background']}',\n"
        f"  foreground: '{tokens['foreground']}',\n"
        f"  chrome: '{tokens['chrome']}',\n"
        f"  card: '{tokens['card']}',\n"
        f"  primary: '{tokens['primary']}',\n"
        f"  muted: '{tokens['muted']}',\n"
        f"  border: '{tokens['border']}'\n"
        "} } } };\n"
        "</script>"
    )


def _set_html_theme(html: str, scheme: str) -> str:
    if re.search(r"<html\b[^>]*data-theme=", html or "", re.I):
        return re.sub(
            r'data-theme="[^"]*"',
            f'data-theme="{scheme}"',
            html,
            count=1,
            flags=re.I,
        )
    if re.search(r"<html\b", html or "", re.I):
        return re.sub(r"<html\b", f'<html data-theme="{scheme}"', html, count=1, flags=re.I)
    return f'<html data-theme="{scheme}">{html}</html>'


_STYLE_BLOCK = re.compile(
    rf'<style id="{THEME_STYLE_ID}">[\s\S]*?</style>', re.I
)
_CONFIG_BLOCK = re.compile(
    rf"<script>\s*/\* {re.escape(THEME_MARK)} \*/[\s\S]*?</script>", re.I
)


def apply_theme_to_html(html: str, tokens: Dict[str, str]) -> str:
    """给一页钉主题。幂等：已有同 id 的块就换内容。"""
    if not html:
        return html
    scheme = tokens.get("scheme") or "light"
    out = _set_html_theme(html, scheme)
    style = f'<style id="{THEME_STYLE_ID}">{_theme_css(tokens)}</style>'
    config = _theme_config(tokens)
    if _STYLE_BLOCK.search(out):
        out = _STYLE_BLOCK.sub(style, out, count=1)
    elif "</head>" in out:
        out = out.replace("</head>", style + "</head>", 1)
    else:
        out = style + out
    if _CONFIG_BLOCK.search(out):
        out = _CONFIG_BLOCK.sub(config, out, count=1)
    elif "</head>" in out:
        out = out.replace("</head>", config + "</head>", 1)
    else:
        out = config + out
    # 把跑出色板的 hex（紫图标、蓝按钮）旋回主色相。Tailwind 类名走上面 CSS。
    repaired, _n = repair_colors(
        out, [tokens["primary"], tokens["accent"]], tokens["primary"]
    )
    return repaired


def apply_theme_to_pages(
    pages: Dict[str, str],
    language: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    tokens = derive_theme_tokens(language)
    # ★ 深浅以**页面自己画出来的样子**为准（2026-08-22）。散文没写「深色」
    #   而页面是深底时，钉浅色主题会让顶栏底栏变成白条压在深内容上。
    #   代价不对称：这一层带 !important，判错就是深底深字，判对只是配色统一。
    voted = pages_tone_evidence(pages or {})
    if voted is not None and voted != (tokens.get("scheme") == "dark"):
        tokens = derive_theme_tokens(
            {**(normalize_design_language(language or DEFAULT_DESIGN_LANGUAGE)),
             "tone": "深色" if voted else "浅色底"}
        )
    return {pid: apply_theme_to_html(html, tokens) for pid, html in (pages or {}).items()}


def theme_token_values(language: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """测试/埋点用。"""
    return derive_theme_tokens(language)
