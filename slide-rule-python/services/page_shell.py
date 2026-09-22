"""第 3.5 步：把多页 HTML 的**外壳**统一成一套（零 LLM 调用）。

## 病灶：三个页面是三个产品

第 3 步逐页独立生成 HTML，每页各自发明自己的导航、侧栏、Header。
2026-08-13 量了一轮真实产物（同一份 spec 的三页）：

    页面   产品名          登录用户                    菜单项
    p1    智维工单        李师傅 · 维修一组 · 维修工     6
    p2    维保云          李主管 · 维修主管             6
    p3    智维运维平台     李晓雯 · 行政部 · 普通员工     11

**三个产品名、三个登录人、三套菜单。** 而且 p3 的菜单列了 8 个页面入口，
可 spec 里只有 3 页——它凭空发明了 5 个不存在的页面。

这不是"菜单不稳"，是根本不像同一个应用。V5.9 架构图的已知缺口里记着这一条
（「菜单在多次生成之间不稳……应该由 spec 的页面清单锚定，不该让图去投票。
这一项目前没有判据在守」），现在补上判据。

## 为什么**不**用 Readability.js

Readability 干的正是这件事的反面（剥掉导航侧栏、留下正文），思路对得上。
但它用不上，理由是实测的：**9/9 份第 3 步产物都规规矩矩用了
`<aside>` + `<header>` + `<main>` + `<nav>`**，壳占 20~26%。

Readability 存在的理由是"真实网页乱七八糟、没人用语义标签，只能靠启发式猜
内容边界"。我们这份 HTML 是自己的提示词生成的，边界**已经标好了**——再上一个
启发式库，是拿猜的去替代已知的，只会更差，还多一个依赖。

所以借它的思路（壳与内容是两回事，可以分开处理），不借它的实现。

## 做法：取一页的壳当模板，但导航按 spec 重排

用户裁决的是"取其中一个页面的壳共用"。这里在那之上多做一步——**导航项按
spec 的页面清单重排**，而不是照抄被选中那页的菜单。理由就是上面 p3 那 8 项：
照抄等于把"发明了 5 个不存在的页面"这个错误扩散到所有页上。

    壳（侧栏外框 / Header / 产品名 / 登录人）  → 取一页，整体复用
    导航项                                  → 按 spec.pages 重新生成

导航项的生成沿用 G2 实验验过的那条契约：**留一个当模板，按清单重复它**
（见 experiments/visual-first/g2_render_test.mjs）。激活态怎么认不写死类名——
比较各链接的 class 词集，**所有链接都有的是基座，只有某一个有的就是激活标记**，
这样换一套配色/命名也不用改代码。图标按位置复用源导航的，不够就循环，
免得所有菜单项长成同一个图标。
"""

from __future__ import annotations

import re
from html import escape, unescape
from typing import Any, Dict, List, Optional, Tuple

PAGE_SHELL_VERSION = "page-shell-v1"

_ASIDE = re.compile(r"<aside\b[\s\S]*?</aside>", re.I)
_HEADER = re.compile(r"<header\b[\s\S]*?</header>", re.I)
_NAV = re.compile(r"<nav\b[\s\S]*?</nav>", re.I)
_BREADCRUMB_NAV = re.compile(
    r"<nav\b[^>]*aria-label\s*=\s*['\"]Breadcrumb['\"]",
    re.I,
)
_LINK = re.compile(r"<a\b[^>]*>[\s\S]*?</a>", re.I)
_CLASS = re.compile(r'class="([^"]*)"', re.I)
_SVG = re.compile(r"<svg\b[\s\S]*?</svg>", re.I)
#: 内容区容器的开标签。抠的是 class，因为**位移全写在 class 上**
#: （`ml-64` / `ml-[248px]` / `flex-1`）。
_MAIN_OPEN = re.compile(r"<main\b[^>]*>", re.I)
_ASIDE_OPEN = re.compile(r"<aside\b[^>]*>", re.I)
_NAV_OPEN = re.compile(r"<nav\b[^>]*>", re.I)
_HEADER_OPEN = re.compile(r"<header\b[^>]*>", re.I)

#: 移动端底栏挡住正文（2026-08-20 真机）：壳换成顶栏+底栏之后，
#: 模型常把 <nav> 写在文档流末尾、main 不留底衬。当时对照 antd-mobile
#: TabBar 用了网站写法（fixed + pb-32）。第五趟改抄官方 demo2.less：
#: 底栏在 flex 列里 flex:0，不再钉 fixed、不再垫 pb-32。
#: ⚠ 2026-08-20 过夜（幼安行 r2）：模型写成没有 flex 横排的底栏，
#: 五个 <a> 按块级竖着堆。横排必须单独保证。
_PHONE_NAV_ROW = ("flex", "justify-around", "items-center")
_PHONE_NAV_NOT_COL = frozenset(("flex-col", "flex-column"))
#: overlay 定位从顶栏/底栏剥掉，让它们重新参加 body 的 flex 列。
_OVERLAY_POS = frozenset(("fixed", "absolute", "sticky"))
_NAV_OVERLAY_LEFTOVER = frozenset(("inset-x-0", "inset-y-0", "inset-0", "bottom-0", "top-0"))
_HEADER_OVERLAY_LEFTOVER = frozenset(("inset-x-0", "inset-0", "top-0"))
#: 模型常用的顶栏/底栏让位档。pt-4 / pb-4 是内容内边距，不要剥。
_MAIN_CHROME_TOP_PAD = frozenset(
    ("pt-10", "pt-12", "pt-14", "pt-16", "pt-20", "pt-24", "pt-28", "pt-32")
)
_MAIN_CHROME_BOTTOM_PAD = frozenset(
    ("pb-20", "pb-24", "pb-28", "pb-32", "pb-36")
)

#: 铺满手机视口（2026-08-20 真机）：画布曾是 1080×1920，模型按 v0 习惯
#: 输出 max-w-md mx-auto 机模，内容缩在框中间。对照 Playwright iPhone 14
#: 与 Chrome DevTools：视口改成 390×844 之后，仍要机械盖一层 CSS——
#: 已经生成的 HTML 不会自己把 mx-auto 拿掉。id 与前端 html-app-surface
#: 的 PHONE_FILL_STYLE_ID 同名，两边注入幂等。
_PHONE_FILL_STYLE_ID = "sliderule-phone-fill"
#: ⚠ 2026-08-20 第二趟：只盖 body>max-w-md 不够。真机（选题库）是
#: body>div.min-h-screen.flex.items-center.justify-center 包着一排底栏图标，
#: 视觉上四个入口漂在屏幕正中。对照 antd-mobile TabBar：header 顶、main 吃
#: 剩余高度、nav 贴底。选择器与前端 html-app-surface.PHONE_FILL_CSS 同文。
#: ⚠ 2026-08-20 第三趟：第二趟写成 body>div[class*="items-center"]，顶栏几乎
#: 都是 flex items-center justify-between——被当成整页容器拉到 100% 高，
#: 用户看到的就是「顶部区域样式有问题」。居中陷阱盯 justify-center /
#: min-h-screen，不要单独盯 items-center。main 不要 display:flex，否则
#: 内部 header 变成竖排 flex 项，滚动也没了。
#: ⚠ 2026-08-20 第五趟：网站壳（fixed nav + pb-32 + sticky header + pt-16）
#: 和 flex 列铺满对打。改抄 ant-design-mobile TabBar demo2.less——
#: .app { height:100vh; flex-direction:column } .top/.bottom { flex:0 }
#: .body { flex:1 }。TabBar 文档：本身不含定位。NavBar 默认也在文档流。
#: 旧会话烤着的 fixed 用 position:static 拉回流。选择器与前端同文。
#: ⚠ 2026-08-21：铺满层把 main padding 清零之后，顶栏贴着机框圆角、
#: 底栏贴着 Home Indicator 那一圈。header/nav 自己补 inset；html/body
#: 白底——缺页或透明页不再透过 iframe 黑底看起来像黑屏。
#: ⚠ 同日晚 猎网卫士：main 一律 padding-top/bottom:0 把 .p-4 的上下
#: 也盖掉了（左右 1rem 还在、卡片贴着顶栏底栏）。pt-4/pb-4 是内容
#: 内边距，_MAIN_CHROME_* 本来就不剥。只清给 fixed 壳让位的大档。
#: ⚠ 2026-08-22 第四趟（健身打卡小程序 / 早餐摊进货，两台设备各中一次）：
#: 居中容器那条 display:flex!important **把模态背景板掀开了**。
#: 生成侧是照做的——提示词要求「预留的浮层根节点必须带 hidden」，模型
#: 写的就是 `class="hidden fixed inset-0 bg-black/80 z-50 flex items-center
#: justify-center p-4"`。可 `body>div[class*="justify-center"]` 正好选中它，
#: !important 压过 Tailwind 的 .hidden，**首屏 100% 被浮层盖死**：
#: 手机那版整屏只有「提交今日训练打卡」，桌面那版整页只剩「快捷入库录入」
#: 抽屉——底下那张做得很完整的库存看板一点没露出来。
#: 53 份真机页面里中了 3 份（手机 2 / 桌面 1）。
#: 修法：两条居中选择器都加 :not([class~="hidden"]):not([hidden])。
#: ⚠ **必须整词匹配**。写成 [class*="hidden"] 会连 overflow-hidden 一起排掉，
#: 而整页容器常带它——那就退回「应用缩在屏幕正中」，把第一趟的病治回来。
#: 判据在 client/.../__tests__/html-app-surface.test.tsx（拿 Element.matches
#: 直接问「这条规则选不选它」，正反两侧都写了），同文那条在
#: tests/test_spec_first_mobile.py——只改一侧会红。
#: ⚠ 同日续：光排 ``hidden`` 不够。把这条规则拿到 53 页真机上跑
#:   ``querySelectorAll``，一共只选中 **4 个元素，4 个全是脱离文档流的浮层**
#:   （3 个模态 + 1 个 ``pointer-events-none`` 的悬浮 CTA），**没有一个是页面
#:   容器**——命中率 100% 是误伤。那个悬浮 CTA 没带 hidden，被这条拉成了
#:   **844px 满屏**（自然高 52px），是个看不见但真实的缺陷。
#:   再加 ``:not([class~="fixed"]):not([class~="absolute"])``，53 页选中 0 个。
#: ⚠ 判别标准**不能**写成「同时带 max-w- 或 mx-auto 才算病」：上面第二趟记的
#:   原文是 ``body>div.min-h-screen.flex.items-center.justify-center`` 包着一排
#:   底栏图标，**没有 max-w**。那么写等于把第二趟的病治回来。
#:   **整页容器在文档流里，浮层不在**——这才是分界线。
#: ⚠ 靠 class 认脱流，行内 ``style="position:fixed"`` 会漏。真机 53 页里没有
#:   这种写法，且 hidden 那条还兜着一层；真出现了再补。
_PHONE_FILL_CSS = (
    "html,body{margin:0!important;width:100%!important;height:100%!important;"
    "min-height:100%!important;max-width:none!important;overflow:hidden!important}"
    # ⚠ 白底是**兜底**，不是覆盖：它治的是「缺页/透明页透出 iframe 黑底」，
    #   不是「模型的底色不对」。写成 !important 会把深色页刷成白纸——
    #   2026-08-22 主题锁改成分层兜底之后，这条立刻接手成了新的元凶，
    #   手机端深浅翻转从 4 页涨到 8 页、整屏纯白。同一个病的第二处。
    #   进同名 @layer：主题锁那份注入得更靠后，同层内它赢；两者都没有时
    #   才轮到白色。层内顺序 = 源码顺序，所以这份必须在 <head> 更前面。
    "@layer sliderule-fallback{html,body{background-color:#fff}}"
    "body{display:flex!important;flex-direction:column!important;"
    "align-items:stretch!important;justify-content:flex-start!important}"
    "body>*{width:100%!important;max-width:none!important;"
    "margin-left:0!important;margin-right:0!important;box-sizing:border-box!important}"
    'body>div[class*="min-h-screen"]:not([class~="hidden"]):not([hidden]):not([class~="fixed"]):not([class~="absolute"]),'
    'body>div[class*="justify-center"]:not([class~="hidden"]):not([hidden]):not([class~="fixed"]):not([class~="absolute"]){'
    "display:flex!important;flex-direction:column!important;"
    "align-items:stretch!important;justify-content:flex-start!important;"
    "min-height:0!important;flex:1 1 auto!important;height:100%!important;width:100%!important;"
    "overflow:hidden!important}"
    "header{position:static!important;flex:0 0 auto!important;width:100%!important;"
    "padding-top:12px!important}"
    "main{flex:1 1 auto!important;min-height:0!important;width:100%!important;"
    "overflow-y:auto!important;overflow-x:hidden!important;"
    "-webkit-overflow-scrolling:touch}"
    "main.pt-10,main.pt-12,main.pt-14,main.pt-16,main.pt-20,main.pt-24,"
    "main.pt-28,main.pt-32{padding-top:0!important}"
    "main.pb-20,main.pb-24,main.pb-28,main.pb-32,main.pb-36{padding-bottom:0!important}"
    'body>nav,body>div[class*="min-h-screen"]>nav,'
    'body>div[class*="justify-center"]>nav,nav.fixed,nav[class*="bottom-0"]{'
    "position:static!important;display:flex!important;flex-direction:row!important;"
    "flex-wrap:nowrap!important;justify-content:space-around!important;"
    "align-items:stretch!important;flex:0 0 auto!important;width:100%!important;"
    "min-height:56px!important;padding-top:6px!important;padding-bottom:16px!important}"
    'body>nav>a,body>div[class*="min-h-screen"]>nav>a,'
    'body>div[class*="justify-center"]>nav>a,nav.fixed>a,nav[class*="bottom-0"]>a{'
    "flex:1 1 0!important;min-width:0!important;"
    "display:flex!important;flex-direction:column!important;"
    "align-items:center!important;justify-content:center!important;"
    "white-space:nowrap!important;font-size:10px!important;"
    "line-height:1.2!important;text-align:center!important;padding:4px 8px!important}"
    'body>nav>a span,body>div[class*="min-h-screen"]>nav>a span,'
    'body>div[class*="justify-center"]>nav>a span,nav.fixed>a span,nav[class*="bottom-0"]>a span{'
    "white-space:nowrap!important;overflow:hidden!important;"
    "text-overflow:ellipsis!important;max-width:100%!important;"
    "font-size:10px!important;line-height:15px!important}"
)

#: 铺满桌面 1920×1080（2026-08-20 满电青年）：模型把 aside+header+main
#: 塞进 ``max-w-6xl mx-auto`` 白卡片，再给 body 浅绿底 + items-center
#: justify-center。画布是满的，应用缩在正中——三支箭头指的是卡片四周的底。
#: 手机页已有铺满层，桌面漏了。id 与前端 html-app-surface 同名，两边注入幂等。
#:
#: ⚠ **不许**抄手机那条 ``body>*{margin-left:0}``：桌面 fixed 侧栏靠
#: ``ml-64`` / ``ml-16`` 让位，一盖就回到侧栏压穿 / 中间空缝。
#: ⚠ **不许**给 body 写 ``flex-direction:column``：aside 和 main 并排
#: 会被竖着叠。只拆掉整页居中卡片，不改壳的横竖。
_DESKTOP_FILL_STYLE_ID = "sliderule-desktop-fill"
_DESKTOP_FILL_CSS = (
    "html,body{margin:0!important;width:100%!important;height:100%!important;"
    "min-height:100%!important;max-width:none!important;overflow:hidden!important}"
    "body{align-items:stretch!important;justify-content:flex-start!important;"
    "padding:0!important}"
    'body>[class*="mx-auto"]{'
    "max-width:none!important;width:100%!important;height:100%!important;"
    "margin:0!important;box-sizing:border-box!important;"
    "border-radius:0!important;box-shadow:none!important}"
    'body>div[class*="min-h-screen"]:not([class~="hidden"]):not([hidden]):not([class~="fixed"]):not([class~="absolute"]),'
    'body>div[class*="justify-center"]:not([class~="hidden"]):not([hidden]):not([class~="fixed"]):not([class~="absolute"]){'
    "display:flex!important;align-items:stretch!important;"
    "justify-content:flex-start!important;"
    "width:100%!important;height:100%!important;max-width:none!important;"
    "padding:0!important;margin:0!important;box-sizing:border-box!important}"
    'body>div[class*="min-h-screen"]>[class*="mx-auto"],'
    'body>div[class*="min-h-screen"]>[class*="max-w-"],'
    'body>div[class*="justify-center"]>[class*="mx-auto"],'
    'body>div[class*="justify-center"]>[class*="max-w-"]{'
    "max-width:none!important;width:100%!important;height:100%!important;"
    "margin:0!important;box-sizing:border-box!important;"
    "border-radius:0!important;box-shadow:none!important}"
)


def _inject_head_style(html: str, style_id: str, css: str) -> str:
    """往 <head> 里塞一份带 id 的 <style>。已有同 id 就换文案，不插第二份。"""
    src = html or ""
    if f'id="{style_id}"' in src:
        return re.sub(
            rf'(<style id="{re.escape(style_id)}">)[\s\S]*?(</style>)',
            lambda m: m.group(1) + css + m.group(2),
            src,
            count=1,
            flags=re.I,
        )
    tag = f'<style id="{style_id}">{css}</style>'
    head = re.search(r"<head\b[^>]*>", src, re.I)
    if head:
        at = head.end()
        return src[:at] + tag + src[at:]
    html_open = re.search(r"<html\b[^>]*>", src, re.I)
    if html_open:
        at = html_open.end()
        return src[:at] + f"<head>{tag}</head>" + src[at:]
    return tag + src


def _ensure_tag_classes(markup: str, opener: re.Pattern[str], needed: Tuple[str, ...]) -> str:
    m = _search_outside_comments(opener, markup or "")
    if not m:
        return markup
    open_tag = m.group(0)
    cls = _CLASS.search(open_tag)
    have = cls.group(1).split() if cls else []
    extra = [c for c in needed if c not in have]
    if not extra:
        return markup
    if cls:
        new_tag = open_tag.replace(cls.group(0), f'class="{" ".join(have + extra)}"', 1)
    else:
        new_tag = open_tag[:-1] + f' class="{" ".join(needed)}">'
    return markup[: m.start()] + new_tag + markup[m.end():]


#: 未闭合注释把壳吃掉。壳正则照样能 match 并替换，替换完仍在注释里——
#: 截图上看不见，判据 grep 源码却是绿的。
#:
#:   2026-08-20 过夜，团长帮 p3：``<!-- 底部固定的 <nav class="fixed …``
#:   2026-08-20 过夜，律所 r0：``<!-- 左侧导航 <aside class="w-64 …``
#:     下一句才是 ``<!-- 主正文 <main> -->``，第一个 ``-->`` 在那儿，
#:     整段侧栏被当成注释。inspect 直接搜 ``<aside`` 假绿。
#:
#: 只捞 aside/nav，以及**带着属性的** header。模型常写已闭合的
#: ``<!-- 主正文 <main> -->`` / ``<!-- 顶部 <header>：在文档流里 -->``，
#: 捞裸 ``<header>`` / ``<main>`` 会把说明注释截断、留下裸 ``-->``，
#: 或者把说明里的标签名当成真顶栏。
#:
#: ⚠ 2026-08-20 满电青年：``<!-- 左侧导航 <aside>…</aside> -->`` 这种
#: **两边都有**的写法，捞开会标签之后 ``-->`` 还在。aside 是 fixed 不占位，
#: 这个 ``-->`` 就成了 body 里第一段真正排版的文字——顶在预览左上角。
#: 已闭合的 ``<!-- 主正文 <main> -->`` 是开标签后面的 ``-->``，不是
#: ``</aside> -->``，下面这条正则碰不到它。
#:
#: ⚠ 2026-08-21 听令工单：模型在真 ``<header class="flex-shrink-0">`` 前面
#: 写 ``<!-- 顶部 <header>：在文档流里，flex-shrink:0 -->``。壳正则从注释
#: 里那个裸 ``<header>`` 一路吃到真 ``</header>``，unify 把这段残片复制到
#: 别页，变成可见的 ``：在文档流里，flex-shrink:0 -->`` 顶在手机最上头。
#: 跟满电青年同一类注释手术，只是这次标签在说明注释里、后面还有真顶栏。
#: 药方是：壳标签的 search/sub **跳过注释内部**；裸 ``<header>`` 不当活标签捞。
_UNCLOSED_COMMENT_SHELL = re.compile(
    r"<!--(?:(?!-->).)*?(<(?:aside|nav)\b|<header\b(?=[^>]*[\s/]))",
    re.I | re.S,
)
_ORPHAN_COMMENT_CLOSE = re.compile(
    r"(</(?:aside|nav|header|main|div)\s*>|<body\b[^>]*>)\s*-->",
    re.I,
)
#: 已经被抠出注释、变成真节点的说明残片。``<header>：…-->`` 中间没有子标签。
_COMMENT_GUTTER_HEADER = re.compile(
    r"<header\b[^>]*>\s*[^<]{0,120}-->\s*(?:</header\s*>)?",
    re.I,
)
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
_NAV_PAGE_ID_ATTR = re.compile(r"\sdata-page-id=\"[^\"]*\"", re.I)
_NAV_ARIA_CURRENT_ATTR = re.compile(r"\saria-current=\"[^\"]*\"", re.I)


def _comment_spans(markup: str) -> Tuple[Tuple[int, int], ...]:
    """闭合并的 ``<!-- … -->``，外加拖到文末的未闭合 ``<!--``。"""
    text = markup or ""
    spans = [(m.start(), m.end()) for m in _HTML_COMMENT.finditer(text)]
    rest = spans[-1][1] if spans else 0
    dangling = text.find("<!--", rest)
    if dangling >= 0:
        spans.append((dangling, len(text)))
    return tuple(spans)


def _pos_in_spans(pos: int, spans: Tuple[Tuple[int, int], ...]) -> bool:
    return any(start <= pos < end for start, end in spans)


def _blank_comments(markup: str) -> str:
    """注释换成空格，长度不变。壳正则就没法从注释里的标签吃到真 ``</header>``。"""
    text = markup or ""
    if not text:
        return text
    chars = list(text)
    for start, end in _comment_spans(text):
        for i in range(start, end):
            if chars[i] not in "\n\r":
                chars[i] = " "
    return "".join(chars)


def _search_outside_comments(pattern: re.Pattern[str], markup: str) -> Optional[re.Match[str]]:
    """壳正则不许进注释。听令工单：注释里的 ``<header>：说明`` 不是真顶栏。

    只跳过「起点在注释内」不够：``<header>：说明 -->`` 没有自己的闭合标签，
    ``<header>[\\s\\S]*?</header>`` 会从注释里一路吃到真顶栏的 ``</header>``，
    整段被当成一次命中丢掉，真顶栏就没了。
    """
    text = markup or ""
    match = pattern.search(_blank_comments(text))
    if not match:
        return None
    return pattern.search(text, match.start(), match.end())


def _sub_first_outside_comments(pattern: re.Pattern[str], repl: str, markup: str) -> str:
    match = _search_outside_comments(pattern, markup)
    if not match:
        return markup or ""
    return (markup or "")[: match.start()] + repl + (markup or "")[match.end() :]


def _strip_orphan_comment_closes(markup: str) -> str:
    """摘 ``</aside> -->`` 这种已经漏出注释的闭合符。注释内部的 ``-->`` 不动。"""
    text = markup or ""
    spans = _comment_spans(text)
    parts: List[str] = []
    cursor = 0
    for match in _ORPHAN_COMMENT_CLOSE.finditer(text):
        if _pos_in_spans(match.start(), spans):
            continue
        parts.append(text[cursor:match.start()])
        parts.append(match.group(1))
        cursor = match.end()
    parts.append(text[cursor:])
    return "".join(parts)


def _strip_comment_gutter_headers(markup: str) -> str:
    """摘掉已经漏出注释、顶在页面上的 ``<header>：…-->``。注释内部不动。"""
    text = markup or ""
    spans = _comment_spans(text)
    cuts: List[Tuple[int, int]] = []
    for match in _COMMENT_GUTTER_HEADER.finditer(text):
        if not _pos_in_spans(match.start(), spans):
            cuts.append((match.start(), match.end()))
    if not cuts:
        return text
    parts: List[str] = []
    cursor = 0
    for start, end in cuts:
        parts.append(text[cursor:start])
        cursor = end
    parts.append(text[cursor:])
    return "".join(parts)


def ensure_nav_not_commented(markup: str) -> str:
    """把未闭合注释里的 <aside>/<nav>/真 <header> 捞出来。

    幂等：已闭合的说明注释 ``<!-- 主正文 <main> -->`` /
    ``<!-- 顶部 <header>：在文档流里 -->`` 不动。

    捞开 ``<!--`` 之后，若注释本来写了闭合 ``-->``，把它一并摘掉，
    免得变成页面左上角三个字符。已经漏成活节点的 ``<header>：…-->``
    也摘掉——听令工单落库页刷新时靠这一下，不必重跑推演。
    """
    html = _UNCLOSED_COMMENT_SHELL.sub(r"\1", markup or "")
    html = _strip_orphan_comment_closes(html)
    return _strip_comment_gutter_headers(html)


def outside_html_comments(markup: str) -> str:
    """剥掉 HTML 注释（含未闭合拖到文末的）。查「页上有没有这个标签」用这个。

    ⚠ 直接 grep 源码会把注释里的 ``<aside>`` 当成活标签——律所 r0 过夜闸
    就是这么假绿的。把本函数改成恒等，那条闸会再绿。
    """
    text = _HTML_COMMENT.sub("", markup or "")
    cut = text.find("<!--")
    return text[:cut] if cut >= 0 else text


def _strip_tag_classes(markup: str, opener: re.Pattern[str], drop: frozenset[str]) -> str:
    m = _search_outside_comments(opener, markup or "")
    if not m:
        return markup
    open_tag = m.group(0)
    cls = _CLASS.search(open_tag)
    if not cls:
        return markup
    have = [c for c in cls.group(1).split() if c not in drop]
    if have == cls.group(1).split():
        return markup
    new_tag = open_tag.replace(cls.group(0), f'class="{" ".join(have)}"', 1)
    return markup[: m.start()] + new_tag + markup[m.end():]


def _strip_main_chrome_pad(markup: str) -> str:
    """flex 列壳不需要 main 为 overlay 顶栏/底栏让位。pt-16 / pb-32 会变成空带。"""
    main_m = _search_outside_comments(_MAIN_OPEN, markup or "")
    if not main_m:
        return markup
    cls = _CLASS.search(main_m.group(0))
    if not cls:
        return markup
    drop = frozenset(
        t
        for t in cls.group(1).split()
        if t in _MAIN_CHROME_TOP_PAD
        or t in _MAIN_CHROME_BOTTOM_PAD
        or (t.startswith("pt-[") and t.endswith("]"))
        or (t.startswith("pb-[") and t.endswith("]"))
    )
    if not drop:
        return markup
    return _strip_tag_classes(markup, _MAIN_OPEN, drop)


def ensure_phone_safe_area(markup: str) -> str:
    """把模型写的网站壳收成 antd-mobile demo2 那列 flex。不重问。

    ⚠ 2026-08-20：曾强制 nav.fixed + main.pb-32，和铺满 CSS 的 flex 列对打，
    sticky 顶栏再叠 pt-16 变成空带。官方 TabBar 不含定位——剥 overlay，
    横排留给 class，钉底靠 body 竖排 flex。
    """
    markup = ensure_nav_not_commented(markup)
    nav_m = _search_outside_comments(_NAV_OPEN, markup or "")
    if nav_m:
        markup = _strip_tag_classes(
            markup, _NAV_OPEN, _OVERLAY_POS | _NAV_OVERLAY_LEFTOVER | _PHONE_NAV_NOT_COL
        )
        markup = _ensure_tag_classes(markup, _NAV_OPEN, _PHONE_NAV_ROW)
    header_m = _search_outside_comments(_HEADER_OPEN, markup or "")
    if header_m:
        markup = _strip_tag_classes(
            markup, _HEADER_OPEN, _OVERLAY_POS | _HEADER_OVERLAY_LEFTOVER
        )
    return _strip_main_chrome_pad(markup)


def ensure_phone_viewport_fill(markup: str) -> str:
    """把套在 max-w-md / mx-auto 里的机模撑满视口。模型漏写时由代码补。

    幂等：已经有 #sliderule-phone-fill 不再插第二份。
    """
    return _inject_head_style(markup or "", _PHONE_FILL_STYLE_ID, _PHONE_FILL_CSS)


def ensure_desktop_viewport_fill(markup: str) -> str:
    """把套在 max-w-6xl / mx-auto 里的整页卡片撑满 1920×1080。模型漏写时由代码补。

    幂等：已经有 #sliderule-desktop-fill 不再插第二份。
    """
    return _inject_head_style(markup or "", _DESKTOP_FILL_STYLE_ID, _DESKTOP_FILL_CSS)


class PageShellError(RuntimeError):
    """统一外壳失败。**不回落**——半套壳比原来那三套还糟。"""


#: 壳节点自报家门（2026-08-22）。
#:
#: ⚠ 病灶：``unify_shell`` **自己把 header/aside/nav 放进每一页**，它百分之百
#:   知道哪个节点是壳。可下游两层都不问它，各自拿 CSS 猜：
#:     · 主题锁 ``header,aside,nav.fixed`` → **26/26 手机页的 <nav> 都不带
#:       ``.fixed``，命中 0**；同一份 CSS 里 ``html,body{...!important}`` 却把
#:       53/53 页的整页底色全改了（8 页深浅整个翻转）。该管的漏光，不该管的全中。
#:     · 间距契约 ``aside[class*="fixed"]:has(nav a)~*`` 同样是猜，而且住在
#:       theme_tokens.py 里，跟这个文件里的手机那半劈成了两处。
#:
#: 做法照 shadcn/ui sidebar：它用 ``data-slot="sidebar"`` / ``data-sidebar=…``
#: 标功能区，宽度走 ``--sidebar-width`` 变量，主体靠 peer-data 让位——
#: **没有一处从 class 子串反推语义**。我们更省：标是自己打的，不用求模型配合。
#:
#: ⚠ 属性名用 ``data-shell`` 而**不是** ``data-slot``：模型抄 shadcn 代码时
#:   会带 ``data-slot``，撞上就分不清是我们打的还是它抄来的。
#: ⚠ 新增 ``data-*`` 必须同时进**两份** DOMPurify 白名单
#:   （bound-html-surface.tsx / html-app-surface.tsx），漏一份会被静默剥掉——
#:   跟 ``data-page-id`` 当年一样的坑。
SHELL_MARK_ATTR = "data-shell"


#: 「侧栏多宽 / 主体让多少位」——chrome 与 main 之间的空间契约（2026-08-22）。
#:
#: ⚠ 这条契约原来住在 ``theme_tokens._chrome_contrast_css`` 里，而手机那半
#:   （header 静态 / main 吃剩余高度 / nav 贴底）住在本文件的 ``_PHONE_FILL_CSS``。
#:   同一件事劈在两个文件、两个职责里，正是本仓「改一半必然静默失效」的温床。
#:   定义搬回壳的主人这边，两半在同一个文件里挨着放。
#:
#: ⚠ **注入位置不动**：仍由 theme_tokens 拼进主题层。不能挪进
#:   ``_DESKTOP_FILL_CSS``——bind 会整页重写吃掉 head，而 spec_first_pipeline
#:   在 bind 之后**只重钉主题**，铺满层没人补（它只在 unify_shell 里注入一次）。
#:   挪过去等于在 bind 路径上静默丢契约。
#:
#: 数字只留一个来源 ``--shell-aside-width``，照 shadcn/ui Sidebar 的
#: ``--sidebar-width: 16rem``：宽度和让位读同一个变量，不会改一个忘一个。
#: 认第 1 步打的 ``data-shell``；旧选择器留着当存量会话的退路。
#: ⚠ ``[class*="fixed"]`` 这一档**不能**去掉：它问的不是「是不是壳」（那是标
#:   回答的），而是「这个侧栏占不占位」——只有脱离文档流的侧栏才需要兄弟让位，
#:   在流里的一让就是中间一道空缝。
SHELL_ASIDE_LAYOUT_CSS = (
    ":root{--shell-aside-width:16rem}"
    '[data-shell="aside"],aside:has(nav a)'
    "{min-width:var(--shell-aside-width)!important;box-sizing:border-box}"
    '[data-shell="aside"][class*="fixed"],[data-shell="aside"][class*="absolute"],'
    'aside[class*="fixed"]:has(nav a),aside[class*="absolute"]:has(nav a)'
    "{width:var(--shell-aside-width)!important}"
    '[data-shell="aside"][class*="fixed"]~*,[data-shell="aside"][class*="absolute"]~*,'
    'aside[class*="fixed"]:has(nav a)~*,aside[class*="absolute"]:has(nav a)~*'
    "{margin-left:var(--shell-aside-width)!important}"
    # ⚠ 2026-08-22 真机（连锁药房 p2 复核工作台）：模型给 <body> 写了
    #   ``w-full h-full`` 但**没写 flex**，而 <aside> 在文档流里——侧栏独占
    #   一整行（256×1080），header 被顶到 y=1080、main 到 y=1144，而 main 自己
    #   ``overflow:hidden``，**整页内容一点都看不见**。用户看到的就是「左边一条
    #   菜单，右边一大片空白」。31 份真机桌面页里中 1 份，一中就是整页报废。
    #   ⚠ 不是这轮改出来的：同一份 HTML 换回 84121aa4 的 CSS，main 顶边一样 1144。
    #   ⚠ 也不是「没生成内容」：那页 main 里有 200 行、5000 字。判据只能落在
    #     渲染后的位置上（experiments/ui-drive/offscreen_probe.mjs）。
    #
    #   修法：把侧栏提成 fixed，兄弟按同一个变量让位——这本来就是本仓桌面壳的
    #   形态（「fixed 侧栏靠 ml-64 让位」）。
    #   ⚠ **不能**改成给 body 加 display:flex：body 下是 aside/header/main 三个
    #     并列，横排会把 header 挤成一根窄条。横竖不由这一层替它决定。
    #   ⚠ ``body:not(.flex)`` 是关键的反向闸：真机 30/31 页 body 本来就是 flex，
    #     碰一下就是把好页面改坏。
    'body:not(.flex):has(>aside)>aside'
    "{position:fixed!important;top:0!important;left:0!important;"
    "height:100%!important;z-index:20}"
    'body:not(.flex):has(>aside)>aside~*'
    "{margin-left:var(--shell-aside-width)!important}"
)


def _is_content_shell(device: str, product_archetype: str) -> bool:
    """顶栏横栏、不要 aside。手机仍走底栏，不走这条。

    content_app 和 free_app 共用这条壳（is_open_chrome）。杂志四页 vs
    自由切页是 SPEC/密度的事，不在这里分叉。
    选择通道是范围卡 productArchetype，不许按话题词猜。
    """
    if device == "phone":
        return False
    from services.archetype_legal import is_open_chrome

    return is_open_chrome(product_archetype)


def mark_shell_parts(
    markup: str, *, device: str = "desktop", product_archetype: str = ""
) -> str:
    """给这一页的壳节点打 ``data-shell`` 标。幂等，注释里的不算。

    桌面打 aside / header / main；手机打 header / main + **页面级** nav。
    消费 / 内容打 header / main + header 里的横栏 nav，**不打 aside**
    （那一层会被 unify 剥掉，标了也是给主题锁一个已删除的节点）。

    ⚠ 手机的 nav 走 ``_page_nav``，不是裸 ``_NAV``：面包屑 ``<nav
      aria-label="Breadcrumb">`` 住在 <header> 里，正则先吃到的是它。
      2026-08-21 素材雷达就是这么把底栏模板写进顶栏的；我自己读菜单时
      也栽过同一跤（``navs[0]`` 是面包屑，据此报了「菜单跟会话对不上」）。
    """
    text = markup or ""
    if not text:
        return text
    blanked = _blank_comments(text)
    todo: List[Tuple[int, str]] = []

    def _plan(open_start: int, open_end: int, value: str) -> None:
        """⚠ 标插在开标签**末尾**，不插在标签名后面。

        插前面会把 ``<nav class="bottom-bar">`` 变成
        ``<nav data-shell="nav" class="bottom-bar">``——本仓大量正则是按
        ``<tag class="…"`` 抓的（test_spec_first_mobile 那条底栏判据当场
        就红了）。插末尾对所有「第一个属性是什么」的假设都无害。
        """
        if open_end <= open_start or SHELL_MARK_ATTR in text[open_start:open_end]:
            return
        todo.append((open_end - 1, value))  # ``>`` 前面那一格

    def mark_tag(tag_name: str, value: str) -> None:
        m = re.compile(rf"<{tag_name}\b[^>]*>", re.I).search(blanked)
        if m:
            _plan(m.start(), m.end(), value)

    if device == "phone":
        mark_tag("header", "header")
        mark_tag("main", "main")
        nav = _page_nav(text)
        if nav:
            open_end = text.find(">", nav.start())
            if open_end > 0:
                _plan(nav.start(), open_end + 1, "nav")
    elif _is_content_shell(device, product_archetype):
        # 消费端：导航住在 header 横栏，不是 aside。标 aside 等于给
        # 主题锁一个马上要剥掉的节点。nav 仍走 _page_nav 跳过面包屑。
        mark_tag("header", "header")
        mark_tag("main", "main")
        nav = _page_nav(text)
        if nav:
            open_end = text.find(">", nav.start())
            if open_end > 0:
                _plan(nav.start(), open_end + 1, "nav")
    else:
        # tablet 跟 desktop 同一条 aside 路径。2026-08-30 夜：编译配方
        # 是窄侧栏 w-52，不是另起手机底栏——给平板换 TabBar，unify 会
        # 按 aside 抠壳抠空，整套导航锚定静默失效。
        mark_tag("aside", "aside")
        mark_tag("header", "header")
        mark_tag("main", "main")

    out = text
    for pos, value in sorted(todo, reverse=True):
        out = out[:pos] + f' {SHELL_MARK_ATTR}="{value}"' + out[pos:]
    return out


def extract_shell(markup: str) -> Dict[str, str]:
    """抠出一页的壳：`<aside>` 与 `<header>` 两段原文。

    抠不到就返回空串，由调用方判断——这里不抛，因为"这一页没有壳"本身
    是合法的（比如向导页可能故意不放侧栏）。
    """
    aside = _search_outside_comments(_ASIDE, markup or "")
    header = _search_outside_comments(_HEADER, markup or "")
    return {
        "aside": aside.group(0) if aside else "",
        "header": header.group(0) if header else "",
    }


def _class_tokens(link: str) -> List[str]:
    m = _CLASS.search(link)
    return m.group(1).split() if m else []


def nav_templates(nav_html: str) -> Optional[Dict[str, Any]]:
    """从一段 `<nav>` 里拆出「基座链接 / 激活链接 / 图标列表」。

    激活态**不写死类名**：把各链接的 class 词集取交集当基座，只出现在某一个
    链接上的词就是激活标记。换配色、换命名（active / is-current / 自定义）
    都不用改这里。

    取不到链接返回 None，调用方回落成"这一页不重排导航"。
    """
    links = _LINK.findall(nav_html or "")
    if len(links) < 2:
        return None
    token_sets = [set(_class_tokens(a)) for a in links]
    base = set.intersection(*token_sets) if token_sets else set()
    # ⚠ 认激活链接时**先把状态变体剔掉**（2026-08-15）。
    #
    # 真机形状（汽修那趟）：
    #     base_class   = flex font-medium items-center px-4 py-3 rounded-lg …
    #     active_class = base + **hover:bg-slate-50**
    #
    # `hover:` 是悬停样式，鼠标不放上去**没有任何视觉差别**——于是
    # aria-current 打对了、判据也绿了，界面上却看不出当前页在哪。
    # 又一次「闸绿了但功能没生效」。
    #
    # Tailwind 的变体一律带冒号（hover: / focus: / dark: / md: / group-hover:），
    # 它们都不能表示一个**持续**的激活状态，所以按冒号一刀切掉。
    def _stable(ts: set) -> set:
        return {t for t in ts if ":" not in t}

    stable_sets = [_stable(ts) for ts in token_sets]
    stable_base = _stable(base)
    extras = [len(ts - stable_base) for ts in stable_sets]
    active_idx = extras.index(max(extras)) if max(extras) > 0 else 0
    # 激活 class 也只留稳定词：把 hover: 抄过去等于抄了个空。
    active_tokens = sorted(stable_sets[active_idx]) if max(extras) > 0 else sorted(stable_base)
    icons = [(_SVG.search(a).group(0) if _SVG.search(a) else "") for a in links]
    return {
        "link": links[0 if active_idx != 0 else -1],  # 拿一个**非激活**的当基座
        "base_class": " ".join(sorted(base)),
        "active_class": " ".join(active_tokens),
        "icons": icons,
    }


#: 源导航本来就没有激活样式时的兜底。挂在 `aria-current="page"` 上，
#: 而 aria-current 是 build_nav_items 一定会打的，所以不依赖任何 class 命名。
#:
#: ⚠ 用 `currentColor` 派生而不是写死颜色：侧栏可能是白底也可能是深色底
#:   （真机两种都见过），写死 `bg-slate-100` 在深色侧栏上等于没有。
_ACTIVE_FALLBACK_CSS = (
    "<style>"
    "aside [aria-current=\"page\"],"
    "header nav:not([aria-label=\"Breadcrumb\"]) [aria-current=\"page\"]{"
    "background-color:color-mix(in srgb, var(--primary, currentColor) 16%, transparent);"
    "color:var(--chrome-fg, inherit);"
    "font-weight:600}"
    "header nav[aria-label=\"Breadcrumb\"] [aria-current=\"page\"]{"
    "background-color:transparent;"
    "color:var(--chrome-fg, inherit);"
    "font-weight:600}"
    "</style>"
)

_STYLE_BLOCK = re.compile(r"<style\b[^>]*>([\s\S]*?)</style>", re.I)
#: 只认「单个类选择器 + 一条规则」这种最朴素的写法——真机上模型给自定义类
#: 写的就是这个形状（`.bg-primary { background-color: #2D5CF7; }`）。
#: 复合选择器 / 伪类 / 媒体查询一律不认：移植它们要连上下文一起搬，
#: 而搬错比不搬更糟。
_SIMPLE_RULE = re.compile(r"(?<![\w.\-])\.([A-Za-z][\w-]*)\s*\{([^{}]*)\}")


def style_class_rules(markup: str) -> Dict[str, str]:
    """页面自己的 <style> 里定义了哪些类 → 规则原文。"""
    rules: Dict[str, str] = {}
    for block in _STYLE_BLOCK.findall(markup or ""):
        for name, body in _SIMPLE_RULE.findall(block):
            rules.setdefault(name, body.strip())
    return rules


def shell_class_tokens(*shell_parts: str) -> set:
    """统一外壳（aside/header）用到的全部 class 名。"""
    tokens: set = set()
    for part in shell_parts:
        for value in _CLASS.findall(part or ""):
            tokens.update(t for t in value.split() if t)
    return tokens


def transplant_shell_css(html: str, needed: Dict[str, str]) -> str:
    """把外壳依赖、而本页 <style> 里没有的类定义补回来。

    ## 这条防的是一个必然会周期性发生的形态

    真机证据（sr-20260816095147「步伴 AI 拐杖」，2026-08-16）：侧栏是四页
    **统一**的外壳，导航项都写着 `rounded-custom`；而每页的 `<style>` 是
    **各写各的**——p1/p3/p4 定义了 `.rounded-custom`，**p2 没有**。于是同一段
    外壳在 p2 上圆角失效，四页菜单长得不一样。

    这不是运气问题：外壳统一之后，它依赖的类名就成了**跨页契约**，而定义那些
    类的 CSS 仍由每页的 LLM 各自即兴发挥。只要页数 × 类数够多，总会漏。

    ## 为什么是"移植"而不是"兜底默认值"

    不发明数值。补给 p2 的那条 `.rounded-custom` 就是 p1 写的那条原文——
    外壳本来就是从某一页抄过来的，它依赖的样式跟着一起抄才叫完整。
    随手写个 `border-radius:8px` 看着也能跑，但那是**另一种设计**，
    会让 p2 的圆角跟其它页不一致——把一个明显的 bug 换成一个不易察觉的。

    没有任何页定义过的类（真机上的 `ring-primary`）**不补**：没有真相来源时
    编一个出来，就是拿"看起来对"冒充"是对的"。它照旧交给 Tailwind 运行时。

    ## 插在最前面

    插在页面自己的 <style> **之前**，所以本页若自己定义了同名类，
    按 CSS 后来者胜，本页那条照常赢。这一段只填空，不覆盖。
    """
    if not needed:
        return html
    css = "".join(f".{name}{{{body}}}" for name, body in sorted(needed.items()))
    tag = f"<style data-shell-css>{css}</style>"
    first = _STYLE_BLOCK.search(html or "")
    if first:
        return html[: first.start()] + tag + html[first.start() :]
    if "</head>" in html:
        return html.replace("</head>", tag + "</head>", 1)
    return re.sub(r"(<body\b[^>]*>)", lambda m: m.group(1) + tag, html, count=1)


#: 面包屑那个 nav。**两种都认**：
#:   · APG 标准写法 `<nav aria-label="Breadcrumb">`
#:   · 真机上模型常写的裸 nav（无 aria-label，用 <span> + 图标分隔符）
#: ⚠ 第一版只认前者，真机（烘焙那趟 ouyi）四页的面包屑全是后者——
#:   修复静静地不生效，没有报错、没有告警、判据全绿。
_BREADCRUMB_NAV = re.compile(
    r'<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?</nav>', re.I
)
#: header 里的第一个 nav（回落用）。header 里通常只有面包屑一个 nav；
#: 侧栏导航在 <aside> 里，不会被这条捞到。
_ANY_NAV = re.compile(r"<nav\b[^>]*>[\s\S]*?</nav>", re.I)

#: 带 aria-current="page" 的那个元素（**任意标签**）。
#: W3C ARIA APG 的 Breadcrumb 模式规定当前项打这个属性：
#:
#:     <li><a href="./breadcrumb.html" aria-current="page">Breadcrumb Example</a></li>
#:
#: （拉了官方示例源码对照：aria-practices/content/patterns/breadcrumb/examples/breadcrumb.html）
#: Bootstrap / Ant Design / Tailwind UI 的面包屑组件都照这个出。
#:
#: ⚠ 认 aria-current 而不是认 `<li>`：真机上模型写过 <span>、<a>、<li> 三种，
#:   按结构猜必然漏。而这个属性是**标准**，且我们侧栏已经在用、已经验证能
#:   穿过消毒器——不另造 data-crumb-current，词表分叉是下一个对不齐的地方。
_ARIA_CURRENT_EL = re.compile(
    r'<(\w+)\b[^>]*aria-current="page"[^>]*>([\s\S]*?)</\1>', re.I
)

#: 回落：认不出 aria-current 时取最后一个"文本节"。
#: ⚠ 不能用「负向前瞻找最后一个」那种写法：惰性组会一路吞到最后一个闭合标签，
#:   等于从**第一个**节替换到末尾。真机上当场把「首页 ›」连同分隔符一起吃掉。
_CRUMB_SEG = re.compile(r"<(li|span|a)\b[^>]*>[^<>]*</\1>", re.I)
_SEG_INNER = re.compile(r"(<\w+\b[^>]*>)([\s\S]*)(</\w+>)", re.I)


def _looks_like_page_nav(nav_html: str) -> bool:
    """横栏 / 底栏菜单，不是「首页 › 当前页」。

    ⚠ 消费端顶栏就是页面清单。``_drift_fingerprint`` 会先剥 data-* 再
      抹面包屑末节——只认 ``data-page-id`` 会在剥完之后失效，当前项文字
      被抹掉，指纹报「两种 header」。烘焙裸面包屑是 span + chevron，
      没有成对 ``<a>``；APG / 汽修是 ``<ol>/<li>``。那两种仍走面包屑。
    """
    blob = nav_html or ""
    if _BREADCRUMB_NAV.search(blob):
        return False
    if re.search(r"<ol\b|<li\b|fa-chevron|chevron-right|›|»", blob, re.I):
        return False
    if re.search(r"\sdata-page-id=", blob, re.I):
        return True
    return len(_LINK.findall(blob)) >= 2


def _breadcrumb_nav(header_html: str) -> Optional[re.Match]:
    """header 里的面包屑 nav。页面清单横栏不是面包屑。"""
    labeled = _BREADCRUMB_NAV.search(header_html or "")
    if labeled:
        return labeled
    any_nav = _ANY_NAV.search(header_html or "")
    if not any_nav:
        return None
    if _looks_like_page_nav(any_nav.group(0)):
        return None
    return any_nav


def _breadcrumb_current_span(header_html: str) -> Optional[Tuple[re.Match, re.Match]]:
    """定位面包屑的**当前节**，返回 (nav 匹配, 该节匹配)。

    ⚠ 抽出来是因为有三个调用方要用**同一套**定位：写（set_）、读（_text）、
      抹平（blank_）。三份各写各的，就是下一处「一个改了另一个没改」。
      本模块刚在归一化上栽过一次：restore_shell_after_bind 知道 data-* 不算
      漂移，check_shell_consistency 不知道——同一个模块两套标准。
    """
    nav = _breadcrumb_nav(header_html)
    if not nav:
        return None
    body = nav.group(0)
    cur = _ARIA_CURRENT_EL.search(body)
    if cur:
        return nav, cur
    segs = [m for m in _CRUMB_SEG.finditer(body) if m.group(0).strip()]
    if not segs:
        return None
    return nav, segs[-1]


def breadcrumb_current_text(header_html: str) -> Optional[str]:
    """面包屑当前节的**文本**。没有面包屑返回 None（合法，不是错）。"""
    found = _breadcrumb_current_span(header_html)
    if not found:
        return None
    inner = _SEG_INNER.search(found[1].group(0))
    raw = inner.group(2) if inner else found[1].group(0)
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def blank_breadcrumb_current(header_html: str) -> str:
    """把面包屑当前节的文本抹掉，用于**比各页外壳是不是同一套**。

    ⚠ 这一节 `set_breadcrumb_current` **故意**写成各页不同——它是壳里唯一
      该逐页变的东西。比指纹时不抹掉，各页 header 必然不同，判据就会把
      「修复正常工作」报成「3 种不同的 header」。

      真机实测（社区药店，2026-08-15）：三页 header 指纹两两不同，抹平
      aria-current 和 class 之后**唯一**的差异就是这一节的文字——
      「进货入库管理页」/「库存看板与效期监控」/「处方登记审计日志」。

      一道对正确行为报警的闸比没有闸更糟：它会训练人忽略它。所以照
      shell_fingerprint 对 aria-current 的老办法——**比之前抹平，
      该查的另开一条判据去查**（见 check_shell_consistency 的 .breadcrumb）。
    """
    found = _breadcrumb_current_span(header_html)
    if not found:
        return header_html
    nav, seg = found
    body = nav.group(0)
    replaced = (
        body[: seg.start()]
        + _SEG_INNER.sub(lambda m: m.group(1) + m.group(3), seg.group(0), count=1)
        + body[seg.end():]
    )
    return header_html.replace(body, replaced, 1)


def set_breadcrumb_current(header_html: str, page_name: str) -> str:
    """把面包屑的**当前节**换成当前页名。

    ## 为什么需要

    外壳统一是整段复制 `<header>`，而面包屑就住在 header 里——于是各页的
    面包屑全都写着源页那一节。真机（汽修）：p3 是库存明细页，面包屑却写
    「首页 › 服务接车」。壳里的东西必然各页相同，而面包屑最后一节
    **本来就该各页不同**，得单独留个位置。

    ## 怎么认「当前节」——照 W3C ARIA APG

    优先认 `aria-current="page"`（APG Breadcrumb 模式的标准标记，
    Bootstrap / antd / Tailwind UI 都这么出）。认不到才回落到"最后一个文本节"。

    ⚠ **第一版只认 `<nav aria-label="Breadcrumb">` 里的 `<li>`**，那是从
      汽修那一趟的 markup 抄的结构。烘焙那趟 ouyi 写的是裸 `<nav>` + `<span>`
      + 图标分隔符，四页面包屑一模一样——**修复静静地不生效**，没有报错、
      没有告警、判据全绿，我差点把它记成「没触发」。
      拿一个样本的 markup 当通用结构，这是同一类错误的第五次。

    ⚠ 前面的层级（首页 › 模块）原样留着：那几节是应用结构，本该各页一样。
      **例外**：第一节约成「通用后台 / Admin / 控制台」这种套话时，换成
      产品名——真机（满电青年 2026-08-20）Header 写着「通用后台 /
      运营地图首页」，跟侧栏产品名不是同一个应用。见 set_breadcrumb_root。
    ⚠ 找不到面包屑就原样返回——没有面包屑是合法的，硬塞一个是新的破坏。
    """
    if not page_name:
        return header_html
    nav = _breadcrumb_nav(header_html)
    if not nav:
        return header_html
    found = _breadcrumb_current_span(header_html)
    if not found:
        return header_html
    nav, seg = found
    body = nav.group(0)
    replaced = (
        body[: seg.start()]
        + _SEG_INNER.sub(
            lambda m: m.group(1) + escape(page_name) + m.group(3), seg.group(0), count=1
        )
        + body[seg.end():]
    )
    return header_html.replace(body, replaced, 1)


#: 面包屑第一节约成这些，就不是应用结构，是模型套的通用后台模板。
_GENERIC_CRUMB_ROOTS = frozenset({
    "通用后台", "管理后台", "管理系统", "控制台", "后台",
    "后台首页", "通用系统", "Admin", "Dashboard", "Console",
    "Administration", "Control Panel",
    "面团", "面团AI", "面团 AI", "面团AI系统", "面团 AI 系统",
    "SlideRule", "MianTuan",
})


def _crumb_plain(seg_html: str) -> str:
    inner = _SEG_INNER.search(seg_html or "")
    raw = inner.group(2) if inner else (seg_html or "")
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def _is_generic_crumb_root(text: str) -> bool:
    t = (text or "").strip()
    if t in _GENERIC_CRUMB_ROOTS:
        return True
    if "通用" in t and ("后台" in t or "系统" in t):
        return True
    from services.page_naming import is_host_brand_name

    return is_host_brand_name(t)


def set_breadcrumb_root(header_html: str, app_name: str) -> str:
    """把面包屑**第一级套话**换成产品名。零 LLM。

    ⚠ 只动套话，不动「充电业务 › 运营地图」这种真 IA。W3C APG 面包屑
      第一项本来就是站点名（aria-practices breadcrumb 示例的 Home /
      WAI 那一级）——有产品名却写「通用后台」，就是套错了模板。
    """
    if not (app_name or "").strip():
        return header_html
    nav = _breadcrumb_nav(header_html)
    if not nav:
        return header_html
    current = _breadcrumb_current_span(header_html)
    current_html = current[1].group(0) if current else ""
    body = nav.group(0)
    root = None
    for m in _CRUMB_SEG.finditer(body):
        if current_html and m.group(0) == current_html:
            continue
        text = _crumb_plain(m.group(0))
        if len(text) < 2:
            continue
        root = m
        break
    if root is None:
        return header_html
    text = _crumb_plain(root.group(0))
    if text == app_name.strip() or not _is_generic_crumb_root(text):
        return header_html
    replaced_seg = _SEG_INNER.sub(
        lambda m: m.group(1) + escape(app_name.strip()) + m.group(3),
        root.group(0),
        count=1,
    )
    new_body = body[: root.start()] + replaced_seg + body[root.end():]
    return header_html.replace(body, new_body, 1)


def _set_class(link: str, value: str) -> str:
    if _CLASS.search(link):
        return _CLASS.sub(f'class="{value}"', link, count=1)
    return link.replace("<a", f'<a class="{value}"', 1)


#: 源导航常把徽标撑开写成 justify-between。_set_label 剥掉徽标之后，
#: flex 只剩图标+文字，文字被甩到最右边。对照 shadcn SidebarMenuButton：
#: ``flex w-full items-center gap-2``，徽标是独立的 SidebarMenuBadge 兄弟，
#: 按钮本身从不用 justify-between。
_JUSTIFY_SPREAD = re.compile(r"^justify-(?:between|around|evenly)$")
_GAP_TOKEN = re.compile(r"^(?:[\w:/\[\]-]+?:)?gap-")
#: 图标要吃 currentColor（对照 shadcn [&>svg] 继承）。尺寸/对齐类留下。
_TEXT_KEEP = re.compile(
    r"^text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|"
    r"left|center|right|justify|start|end|clip|ellipsis|wrap|nowrap|"
    r"balance|pretty|\[)"
)


def _nav_item_class(value: str) -> str:
    tokens = [t for t in (value or "").split() if t and not _JUSTIFY_SPREAD.fullmatch(t)]
    if not any(_GAP_TOKEN.match(t) for t in tokens):
        tokens.append("gap-2")
    return " ".join(tokens)


def _is_icon_color_token(token: str) -> bool:
    if not token.startswith("text-"):
        return False
    return _TEXT_KEEP.match(token) is None


def _neutralize_icon(icon: str) -> str:
    """剥掉 SVG 上烤死的 text-white / text-slate-400，让它吃 currentColor。"""
    if not icon:
        return icon

    def _repl(match: re.Match[str]) -> str:
        kept = [t for t in match.group(1).split() if t and not _is_icon_color_token(t)]
        return f'class="{" ".join(kept)}"'

    return _CLASS.sub(_repl, icon, count=1)


def _set_label(link: str, icon: str, label: str) -> str:
    """把链接内部换成「图标 + 文案」。

    整段替换而不是找文本节点：链接里通常是 `<svg/>` 加一个 `<span>`，也可能是
    裸文本，还可能夹着徽标。整段换掉最稳，代价是丢掉徽标那类装饰——
    那正是应该丢的（每页各编一个数字徽标也是"不像同一个应用"的一部分）。
    """
    inner = f"{icon}<span>{label}</span>" if icon else f"<span>{label}</span>"
    return re.sub(r"(<a\b[^>]*>)[\s\S]*(</a>)", lambda m: m.group(1) + inner + m.group(2), link, count=1)


#: ⚠ 2026-08-29：`_strip_page_suffix` / `nav_tab_label` 搬到了叶子
#:   services/page_naming——见那个文件的模块头（page_shell ⇄ spec_tree 的环，
#:   全部原因就是这两个小函数）。同名转出保留：`page_id_freeze` 复用的正是
#:   `page_shell.nav_tab_label` 这个名字，判据也钉在它上面。
from services.page_naming import _strip_page_suffix, nav_tab_label  # noqa: F401


def build_nav_items(
    templates: Dict[str, Any],
    spec_pages: List[Dict[str, Any]],
    current_page_id: str,
    *,
    app_name: str = "",
    device: str = "desktop",
) -> str:
    """按 spec 的页面清单生成导航项。

    沿用 G2 实验验过的契约：留一个当模板，按清单重复它
    （experiments/visual-first/g2_render_test.mjs）。图标按位置复用源导航的，
    不够就循环——不然所有菜单项会长成同一个图标。
    """
    icons = [i for i in templates["icons"] if i] or [""]
    out: List[str] = []
    for i, page in enumerate(spec_pages):
        # 剥「页」只在手机做（标准答案见 page_naming.nav_tab_label 头注：
        # antd-mobile TabBar 短名 vs Ant Design Pro 菜单 14 项带「页」）。
        name = nav_tab_label(
            str(page.get("name") or page.get("id") or ""),
            app_name,
            strip_page_suffix=(device == "phone"),
        )
        is_current = str(page.get("id") or "") == current_page_id
        link = _set_class(
            templates["link"],
            _nav_item_class(
                templates["active_class"] if is_current else templates["base_class"]
            ),
        )
        link = _set_label(link, _neutralize_icon(icons[i % len(icons)]), name)
        # ⚠ 导航项必须带页面 id（2026-08-14）。宿主要把点击映射回"切到哪一页"，
        #   而**靠标签文字匹配是不行的**：名字可以重复、可以带图标字符、可以被
        #   模型改写成另一种说法。这条跟 data-* 绑定孔是同一条纪律——
        #   界面上的东西要能指回声明，就得有 id，不能靠人眼看得懂的那串字。
        # ⚠ 2026-08-20 精修第二轮：模板链接上已经有上一轮的 data-page-id，
        #   再 replace("<a", ...) 会写成 data-page-id="p5" data-page-id="p1"。
        #   HTML 认第一个，点哪都跳到模板那一页。先剥再盖。
        page_id = str(page.get("id") or "").strip()
        link = _NAV_PAGE_ID_ATTR.sub("", link)
        link = _NAV_ARIA_CURRENT_ATTR.sub("", link)
        if page_id:
            link = re.sub(
                r"<a\b",
                f'<a data-page-id="{escape(page_id, quote=True)}"',
                link,
                count=1,
                flags=re.I,
            )
        if is_current:
            link = re.sub(r"<a\b", '<a aria-current="page"', link, count=1, flags=re.I)
        out.append(link)
    return "\n".join(out)


_CN_TEXT = re.compile(r">([^<>]+)<")


def _cn_len(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text))


def detect_brand_and_role(aside_html: str) -> Tuple[str, str]:
    """从一段侧栏里认出「模型编的产品名」和「模型编的角色」。

    启发式：侧栏里**第一段中文**是产品名，**最后一段中文**是角色。
    这不是拍脑袋——拿 9 份真实产物验过，9/9 命中：

        r1/T_p1  首「智维工单」    末「维修主管」
        r2/T_p3  首「智维运维平台」 末「行政部 · 普通员工」
        r3/T_p2  首「维保云」      末「维修主管」

    ⚠ 但它终究是启发式，认错了不会自己喊。所以**替换完必须有一道硬校验**
    （check_shell_consistency 里那条 appName）：spec 的名字必须出现在每一页、
    旧名字必须一处不剩。认错就当场报出来，绝不半改——半改比不改更糟，
    那会出现"侧栏是新名字、顶栏还是旧名字"这种没人看得懂的中间态。

    2026-08-18 CareBridge：方块里一个「循」是缩写，不是品名。把它当 old
    去做全局 replace，已经写对的「循护桥」会变成「循护桥护桥」。
    单字中文不当品牌/角色——标定集里最短的品名也是「维保云」。
    """
    texts = [s.strip() for s in _CN_TEXT.findall(aside_html or "") if s.strip()]
    texts = [s for s in texts if _cn_len(s) >= 2]
    if not texts:
        return "", ""
    return texts[0], texts[-1]


def _apply_identity(shell_part: str, old: str, new: str) -> str:
    """整段替换产品名 / 角色。空值或没变化时原样返回。

    对照 WHATWG DOM / BeautifulSoup：只改**文本节点**，不动属性、标签名。
    成熟做法是遍历 NavigableString（bs4 文档「NavigableString」；DOM 的
    ``Text``），禁止对整段 markup 做 ``str.replace``——那会把
    ``class="维保云-theme"`` 一并改掉，壳还在、主题类名却丢了。

    旧名是新名的真子串时还要更严：禁止「节点里出现旧名就换」。
    ``「循护桥」.replace("循", "循护桥")`` 就是「循护桥护桥」。
    这种只改**整段文本恰好等于旧名**的节点（方块缩写），已经写对的新名留下。
    """
    if not old or not new or old == new:
        return shell_part
    exact_only = old in new

    def _one(match: re.Match[str]) -> str:
        text = match.group(1)
        if exact_only:
            if text.strip() != old:
                return match.group(0)
        elif old not in text:
            return match.group(0)
        return f">{text.replace(old, new)}<"

    return _CN_TEXT.sub(_one, shell_part)


def _pick_shell_source(
    pages_html: Dict[str, str], *, device: str = "desktop"
) -> str:
    """选哪一页的壳当模板：有文字的宽侧栏优先，其次导航链接最多。

    链接多仍有用——图标模板多。但 2026-08-20 满电青年真机：工单页链接
    略多、侧栏却是 ``w-16``，unify 把 64px 轨灌到首页。点进「服务工单工作台」
    菜单文字挤成一竖条，像侧栏自己收成了图标模式。

    对照 shadcn/ui Sidebar：``--sidebar-width: 16rem`` 是展开态（有 label），
    ``--sidebar-width-icon: 3rem`` 只在 *collapsible=icon* 时切。有菜单文字
    时不许拿图标轨当整站壳。导航内容仍按 spec 重排，带走的只有外框。

    平板的「够宽」是 w-52，不是桌面的 w-56。用桌面门槛的话，契约写对的
    窄侧栏进不了优选池，链接更多的图标轨又会被当成壳源。
    """
    min_rank, _ = _labeled_aside_policy(device)
    labeled_wide: List[Tuple[int, int, str]] = []
    all_pages: List[Tuple[int, int, str]] = []
    for page_id, markup in pages_html.items():
        nav = _NAV.search(extract_shell(markup)["aside"] or markup)
        n = len(_LINK.findall(nav.group(0))) if nav else 0
        w = aside_width_rank(markup)
        all_pages.append((n, w, page_id))
        if aside_has_text_labels(markup) and w >= min_rank:
            labeled_wide.append((n, w, page_id))
    pool = labeled_wide or all_pages
    pool.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return pool[0][2] if pool else ""


def _is_breadcrumb_nav(nav_html: str) -> bool:
    return bool(_BREADCRUMB_NAV.search(nav_html or ""))


def _page_nav(markup: str) -> Optional[re.Match[str]]:
    """页面级 <nav>：底部标签栏 / 侧栏菜单。不是 header 里的面包屑。

    ⚠ 2026-08-21 素材雷达：手机 header 带着 Breadcrumb。<nav> 正则先吃到
    它，unify 把底栏模板写进顶栏，底部原链（href=/创作）还在——点「创作」
    把同源 srcdoc iframe 导航到宿主（面团 AI），看起来像黑屏 / 路由串台。
    """
    text = markup or ""
    for match in _NAV.finditer(_blank_comments(text)):
        real = _NAV.search(text, match.start(), match.end())
        if not real or _is_breadcrumb_nav(real.group(0)):
            continue
        return real
    return None


def _ensure_phone_header(html: str, header: str) -> str:
    """有顶栏就换成统一那份；精修/校验把 header 整段删了则补回去。

    手机没有「向导页故意不放侧栏」那条桌面豁免——缺顶栏的页点进去就是
    黑屏。缺了就塞，比原样放过更接近同一个 App。
    """
    if not header:
        return html or ""
    if _search_outside_comments(_HEADER, html or ""):
        return _sub_first_outside_comments(_HEADER, header, html)
    if re.search(r"<body\b[^>]*>", html or "", re.I):
        return re.sub(
            r"(<body\b[^>]*>)",
            lambda m: m.group(1) + "\n" + header,
            html,
            count=1,
            flags=re.I,
        )
    return header + (html or "")


def _ensure_phone_nav(html: str, new_nav: str) -> str:
    found = _page_nav(html or "")
    if found:
        return html[: found.start()] + new_nav + html[found.end() :]
    if re.search(r"</body>", html or "", re.I):
        return re.sub(r"</body>", new_nav + "\n</body>", html, count=1, flags=re.I)
    return (html or "") + new_nav


def _usable_app_name(spec_name: str, detected: str) -> str:
    """spec.appName 若是生成方品牌（面团 AI / SlideRule），改用页上认出的真名。

    校验闸会拦新生成的；已经落库的坏 spec 仍会走进 unify——这里是第二道。
    spec 没给名字时返回空：统一是本模块的职责，起名不是。
    """
    from services.page_naming import is_host_brand_name

    name = (spec_name or "").strip()
    if not name:
        return ""
    if not is_host_brand_name(name):
        return name
    fallback = (detected or "").strip()
    if fallback and not is_host_brand_name(fallback):
        return fallback
    return name


def _pick_shell_source_phone(pages_html: Dict[str, str]) -> str:
    """移动端选源页：**页面级 <nav>（底部标签栏）链接最多的那页**。

    与桌面 _pick_shell_source 同一动机（图标模板越多越好），差别只在
    移动端的导航不在 <aside> 里——设计系统明说了不要侧栏。
    """
    best, best_n = "", -1
    for page_id, markup in pages_html.items():
        nav = _page_nav(markup or "")
        n = len(_LINK.findall(nav.group(0))) if nav else 0
        if n > best_n:
            best, best_n = page_id, n
    return best


def _ensure_desktop_aside(html: str, aside: str) -> str:
    """桌面页有侧栏就换上统一那份；精修把 ``<aside>`` 整段删了则补回去。

    ⚠ 2026-08-20 律所 r1：局部改只留 ``<!-- 左侧导航 -->``，标签没了。
    旧逻辑 ``_ASIDE.search`` 失败就原样放过——壳统一问题=2，截图仍无侧栏。

    向导页故意不放侧栏（只有 ``<main>``、没有 ``<header>``）仍然放过，
    见 ``test_某一页没有壳时不会被塞坏``。
    """
    if _search_outside_comments(_ASIDE, html or ""):
        return _sub_first_outside_comments(_ASIDE, aside, html)
    if not _search_outside_comments(_HEADER, html or "") or not _search_outside_comments(
        _MAIN_OPEN, html or ""
    ):
        return html
    main_at = re.search(r"<main\b", html, re.I)
    if not main_at:
        return html
    return html[: main_at.start()] + aside + "\n" + html[main_at.start() :]


def _strip_aside(html: str) -> str:
    """消费端不要 leftover <aside>。模型常按后台皮套出侧栏，unify 必须剥掉。

    只剥注释外的真标签；循环几次是因为一页偶尔写两个 aside。
    """
    out = html or ""
    for _ in range(4):
        nxt = _sub_first_outside_comments(_ASIDE, "", out)
        if nxt == out:
            break
        out = nxt
    return out


def _ensure_content_body_column(markup: str) -> str:
    """剥掉 aside 之后，body 若仍是横向 flex，header 和 main 会并排。"""
    if _body_is_flex_row(markup):
        return _ensure_tag_classes(markup, _BODY_OPEN, ("flex-col",))
    return markup


def _pick_shell_source_content(pages_html: Dict[str, str]) -> str:
    """消费端选源页：header 横栏链接最多的那页。没有横栏就退到有 header 的。"""
    best, best_n = "", -1
    for page_id, markup in pages_html.items():
        header = extract_shell(markup)["header"]
        nav = _page_nav(header) if header else None
        if nav:
            n = len(_LINK.findall(nav.group(0)))
        elif header:
            n = 1
        else:
            n = 0
        if n > best_n:
            best, best_n = page_id, n
    return best


#: 源页 header 里没有横栏时的基座。class 故意少，激活态交给
#: ``_ACTIVE_FALLBACK_CSS`` 挂在 aria-current 上，不另发明一套皮。
_CONTENT_NAV_FALLBACK: Dict[str, Any] = {
    "link": '<a href="#" class="px-3 py-2 text-sm">x</a>',
    "base_class": "px-3 py-2 text-sm",
    "active_class": "px-3 py-2 text-sm font-semibold",
    "icons": [""],
}

#: 源侧栏 <nav> 里不够两条 <a> 时的基座。模型常写成 <button>，
#: ``nav_templates`` 取不到链接就 return None。消费端壳 2026-08 已经有
#: 上面那条兜底；桌面 / 手机漏了 = 菜单还在，一个 data-page-id 都没有，
#: 点了没反应、也没有任何报错（2026-09-09 真机）。
_DESKTOP_NAV_FALLBACK: Dict[str, Any] = {
    "link": '<a href="#" class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm">x</a>',
    "base_class": "flex items-center gap-3 px-4 py-3 rounded-lg text-sm",
    "active_class": "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold",
    "icons": [""],
}
_PHONE_NAV_FALLBACK: Dict[str, Any] = {
    "link": '<a href="#" class="flex flex-col items-center justify-center gap-1 text-xs">x</a>',
    "base_class": "flex flex-col items-center justify-center gap-1 text-xs",
    "active_class": "flex flex-col items-center justify-center gap-1 text-xs font-semibold",
    "icons": [""],
}


def _nav_templates_or_fallback(
    nav_html: Optional[str], fallback: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """有 <nav> 就必须能重排。取不到 <a> 就用兜底基座，不许跳过。"""
    if not nav_html:
        return None
    got = nav_templates(nav_html)
    return got if got is not None else dict(fallback)


def _minimal_content_header(app_name: str, role: str) -> str:
    """源页连 header 都没有时的兜底。有 header 不许走这里——会盖掉模型的皮。"""
    brand = escape(app_name or "应用")
    who = escape(role) if role else ""
    return (
        '<header class="flex items-center justify-between gap-6 px-8 py-4 border-b">'
        f'<div class="font-semibold">{brand}</div>'
        '<nav class="flex items-center gap-6"></nav>'
        f"<div>{who}</div>"
        "</header>"
    )


def _rewrite_header_nav(header: str, new_nav: str) -> str:
    """把 header 里那条非面包屑横栏换成统一那份；没有就插在 </header> 前。"""
    nav = _page_nav(header or "")
    if nav:
        return header[: nav.start()] + new_nav + header[nav.end() :]
    if re.search(r"</header>", header or "", re.I):
        return re.sub(
            r"</header>", new_nav + "</header>", header, count=1, flags=re.I
        )
    return (header or "") + new_nav


def _unify_shell_content(
    pages_html: Dict[str, str], spec: Dict[str, Any], *, device: str = "desktop"
) -> Dict[str, Any]:
    """消费 / 内容应用的壳统一：<header> 顶栏横栏 + <main>。没有 <aside>。

    对照 Medium / Apple News 的顶栏，不是 ant-design Layout.Sider。
    模型仍可能按后台皮套出 aside——这里剥掉，不把中台侧栏扩散到每一页。

    手机不走这条（底栏 TabBar 仍是竖屏壳）。平板走这条：选了 content_app
    就不能再要 w-52 侧栏。
    """
    spec_pages = list(spec.get("pages") or [])
    pages_html = {
        pid: _ensure_content_body_column(_strip_aside(ensure_nav_not_commented(html)))
        for pid, html in pages_html.items()
    }
    source_id = _pick_shell_source_content(pages_html)
    src = pages_html.get(source_id) or next(iter(pages_html.values()))
    header_m = _search_outside_comments(_HEADER, src)
    personas = list(spec.get("personas") or [])
    role = str((personas[0] or {}).get("name") or "").strip() if personas else ""
    header = header_m.group(0) if header_m else ""
    old_brand, old_role = detect_brand_and_role(header)
    app_name = _usable_app_name(str(spec.get("appName") or "").strip(), old_brand)
    if not header:
        # ⚠ 源页连顶栏都没有：合成一条，总比把后台 aside 皮套回去好。
        #   有 header 不许走这里——会把模型写的气质盖掉。
        header = _minimal_content_header(app_name or old_brand, role or old_role)
        print(f"[page_shell] 消费端源页 {source_id} 没有 <header>，用最小顶栏兜底")
    header = _apply_identity(header, old_brand, app_name)
    header = _apply_identity(header, old_role, role)

    nav_m = _page_nav(header)
    templates = nav_templates(nav_m.group(0)) if nav_m else None
    if templates is None:
        templates = dict(_CONTENT_NAV_FALLBACK)

    vocabulary: Dict[str, str] = {}
    for _markup in pages_html.values():
        for _name, _body in style_class_rules(_markup).items():
            vocabulary.setdefault(_name, _body)

    print(f"[page_shell] 消费端壳：header 横栏，剥 aside（源页 {source_id}）")
    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        page_header = header
        # 消费端顶栏横栏是页面清单，不是「首页 › 当前页」。套面包屑改写
        # 会把最后一项改成页名，再被 blank_breadcrumb_current 当漂移抹掉。
        items = build_nav_items(templates, spec_pages, page_id, app_name=app_name)
        if nav_m:
            new_nav = re.sub(
                r"(<nav\b[^>]*>)[\s\S]*(</nav>)",
                lambda m: m.group(1) + "\n" + items + "\n" + m.group(2),
                nav_m.group(0),
                count=1,
            )
        else:
            new_nav = f'<nav class="flex items-center gap-6">\n{items}\n</nav>'
        page_header = _rewrite_header_nav(page_header, new_nav)
        html = _ensure_phone_header(markup, page_header)
        html = _strip_aside(html)
        html = _ensure_content_body_column(html)
        # ⚠ 2026-09-01 内容站真机：模型按后台皮套出 aside + main.ml-64，
        #   剥 aside 再转 flex-col 之后 reconcile_main_offset →
        #   strip_main_offset 看到「没侧栏 / 已是纵向」直接 return，
        #   leftover ml-64 留着，main.x=256，左边空一截。
        #   消费端没有侧栏，偏移不是页面自己的版式。
        html = _drop_main_offset_classes(html)
        _own = style_class_rules(html)
        _missing = {
            name: body
            for name, body in vocabulary.items()
            if name in shell_class_tokens("", page_header) and name not in _own
        }
        html = transplant_shell_css(html, _missing)
        if _ACTIVE_FALLBACK_CSS not in html:
            if "</head>" in html:
                html = html.replace("</head>", _ACTIVE_FALLBACK_CSS + "</head>", 1)
            else:
                html = re.sub(
                    r"(<body\b[^>]*>)",
                    lambda m: m.group(1) + _ACTIVE_FALLBACK_CSS,
                    html,
                    count=1,
                )
        html = mark_shell_parts(
            html, device=device, product_archetype="content_app"
        )
        out[page_id] = ensure_desktop_viewport_fill(html)

    return {
        "version": PAGE_SHELL_VERSION,
        "sourcePageId": source_id,
        "navAnchored": True,
        "navItems": [
            {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or "")}
            for p in spec_pages
        ],
        "appName": app_name or old_brand,
        "personaRole": role or old_role,
        "pages": out,
    }


def _unify_shell_phone(pages_html: Dict[str, str], spec: Dict[str, Any]) -> Dict[str, Any]:
    """移动端（竖屏）的壳统一：<header> 顶栏 + 页面级 <nav> 底部标签栏。

    与桌面版同一套病灶与药方（各页各编产品名/登录人/菜单 → 取一页的壳
    整体复用，导航按 spec.pages 重排），只是壳的部件不同：
    没有 <aside>，产品名和角色在 <header> 里认。
    """
    spec_pages = list(spec.get("pages") or [])
    pages_html = {pid: ensure_nav_not_commented(html) for pid, html in pages_html.items()}
    source_id = _pick_shell_source_phone(pages_html)
    src = pages_html[source_id]
    header_m = _search_outside_comments(_HEADER, src)
    nav_m = _page_nav(src)
    if not header_m and not nav_m:
        raise PageShellError(f"选中的源页 {source_id} 既没有 <header> 也没有 <nav>，抠不出移动壳")

    header = header_m.group(0) if header_m else ""
    personas = list(spec.get("personas") or [])
    role = str((personas[0] or {}).get("name") or "").strip() if personas else ""
    old_brand, old_role = detect_brand_and_role(header)
    app_name = _usable_app_name(str(spec.get("appName") or "").strip(), old_brand)
    header = _apply_identity(header, old_brand, app_name)
    header = _apply_identity(header, old_role, role)

    templates = _nav_templates_or_fallback(
        nav_m.group(0) if nav_m else None, _PHONE_NAV_FALLBACK
    )
    name_of = {
        str(p.get("id") or ""): str(p.get("name") or p.get("id") or "").strip()
        for p in spec_pages
    }

    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        html = markup
        page_header = header
        if page_header:
            # ★ 面包屑按页改。桌面 unify 一直这么做；手机分支此前整段复制
            #   源页 header，点进「创作」路由仍写着源页 / 宿主品牌。
            page_header = set_breadcrumb_current(page_header, name_of.get(page_id, ""))
            page_header = set_breadcrumb_root(page_header, app_name)
            html = _ensure_phone_header(html, page_header)
        if templates and nav_m:
            items = build_nav_items(
                templates, spec_pages, page_id, app_name=app_name, device="phone"
            )
            new_nav = re.sub(
                r"(<nav\b[^>]*>)[\s\S]*(</nav>)",
                lambda m: m.group(1) + "\n" + items + "\n" + m.group(2),
                nav_m.group(0),
                count=1,
            )
            html = _ensure_phone_nav(html, new_nav)
        # ★ 打标放在铺满层之前：下游（主题锁、间距契约）认标不认 class。
        html = mark_shell_parts(html, device="phone")
        out[page_id] = ensure_phone_viewport_fill(ensure_phone_safe_area(html))

    return {
        "version": PAGE_SHELL_VERSION,
        "sourcePageId": source_id,
        "navAnchored": bool(templates),
        "navItems": [
            {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or "")}
            for p in spec_pages
        ],
        "appName": app_name or old_brand,
        "personaRole": role or old_role,
        "pages": out,
    }


def unify_shell(
    pages_html: Dict[str, str],
    spec: Dict[str, Any],
    *,
    device: str = "desktop",
    product_archetype: str = "",
) -> Dict[str, Any]:
    """把多页 HTML 的壳统一成一套，导航按 spec.pages 重排。零 LLM 调用。

    device（2026-08-14 晚加）：`"phone"` 走移动分支（<header> + 页面级
    <nav> 底部标签栏，没有 <aside>）。词表沿用 device_policy 的 Device。
    `"tablet"` 走这条桌面 aside 路径（2026-08-30 夜接通编译）：壳仍是
    <aside>+<header>+<main>，侧栏锁 w-52（见 ``_labeled_aside_policy``），
    视口 1112×834。这里不许再写成 `phone else desktop` 把平板送进底栏，
    也不许按桌面 min-rank 56 把契约写的 w-52 抬成 w-64。

    product_archetype（2026-08-31）：``content_app`` / ``free_app`` 走顶栏横栏、剥 aside。
    手机 + 开放壳仍走底栏（竖屏壳），平板 + 开放壳走内容壳（不要 w-52 侧栏）。
    选择通道是范围卡，不许按话题词猜。空 / business_app 一字不改这条桌面路径。

    返回 {"version", "sourcePageId", "pages": {page_id: html}, "navItems": [...]}。
    """
    if not pages_html:
        raise PageShellError("没有任何页面可统一")
    spec_pages = list(spec.get("pages") or [])
    if not spec_pages:
        raise PageShellError("spec 里没有页面清单，导航无从锚定")
    if device == "phone":
        return _unify_shell_phone(pages_html, spec)
    if _is_content_shell(device, product_archetype):
        return _unify_shell_content(pages_html, spec, device=device)

    # ⚠ 桌面也曾只在移动分支捞注释（2026-08-20 律所）。unify 替换的
    # aside 仍困在 ``<!-- 左侧导航 <aside`` 里，截图没有侧栏。
    pages_html = {pid: ensure_nav_not_commented(html) for pid, html in pages_html.items()}
    source_id = _pick_shell_source(pages_html, device=device)
    shell = extract_shell(pages_html[source_id])
    if not shell["aside"] and not shell["header"]:
        raise PageShellError(f"选中的源页 {source_id} 既没有 <aside> 也没有 <header>，抠不出壳")

    # 产品名与角色：spec 里有就按 spec 灌，没有就保持模型编的那一套。
    # 保持也算合格——统一是本模块的职责，起名不是；spec 没给就不该由这里发明。
    personas = list(spec.get("personas") or [])
    role = str((personas[0] or {}).get("name") or "").strip() if personas else ""
    old_brand, old_role = detect_brand_and_role(shell["aside"])
    app_name = _usable_app_name(str(spec.get("appName") or "").strip(), old_brand)
    for part in ("aside", "header"):
        shell[part] = _apply_identity(shell[part], old_brand, app_name)
        shell[part] = _apply_identity(shell[part], old_role, role)

    # ⚠ 顺序要紧：nav 必须在**身份替换之后**重新定位。
    #
    # 先定位再替换的话，一旦产品名或角色那几个字正好落在 nav 里（比如某个菜单项
    # 就叫「维修主管」），替换会把 nav 的原文改掉，后面拿旧的 nav_match 去
    # `replace` 就匹配不上——导航重排**静默不发生**，而各页壳仍然一致，
    # check_shell_consistency 的前两条也照样绿。这种"闸全绿但功能没生效"的
    # 形状，本仓踩过不止一次。
    nav_match = _NAV.search(shell["aside"])
    templates = _nav_templates_or_fallback(
        nav_match.group(0) if nav_match else None, _DESKTOP_NAV_FALLBACK
    )


    # ⚠ **无条件注入**这条兜底，不再试图判断"源导航有没有激活样式"。
    #
    # 判断过一版，两次都判错：
    #   ① 第一版拿「独有 class 词最多」认激活链接 → 认到了 `hover:bg-slate-50`，
    #      悬停样式，静态下零差别；
    #   ② 剔掉变体之后认到 `text-slate-600`，而基座是 `text-slate-700`——
    #      两个都是灰，肉眼同样看不出。
    #
    # 「这个 class 在视觉上够不够显眼」机械判不了，而判错的代价是**当前页
    # 没有任何标记**。所以不判了：aria-current 一定会打，就挂在它上面加一层
    # 底色和字重，有没有原生激活样式都不冲突（叠加在已有高亮上仍然读得通）。
    need_fallback = bool(templates)

    # 页面 id → 名字，给面包屑用
    name_of = {
        str(p.get("id") or ""): str(p.get("name") or p.get("id") or "").strip()
        for p in spec_pages
    }

    # 全站自定义类词表：任意一页定义过的类，都算"这套设计里有的东西"。
    # 外壳依赖其中某个类而本页没写，就从这里把定义搬过去（见
    # transplant_shell_css）。取并集而不是只取源页：外壳的图标/徽标可能
    # 用到源页之外定义的类。
    vocabulary: Dict[str, str] = {}
    for _markup in pages_html.values():
        for _name, _body in style_class_rules(_markup).items():
            vocabulary.setdefault(_name, _body)

    out: Dict[str, str] = {}
    for page_id, markup in pages_html.items():
        aside, header = shell["aside"], shell["header"]
        # ★ 面包屑按页改（2026-08-15）：壳是整段复制的，面包屑住在里面，
        #   不单独处理的话每页都写着源页那一节。
        header = set_breadcrumb_current(header, name_of.get(page_id, ""))
        header = set_breadcrumb_root(header, app_name)
        if templates and nav_match:
            items = build_nav_items(templates, spec_pages, page_id, app_name=app_name)
            new_nav = re.sub(
                r"(<nav\b[^>]*>)[\s\S]*(</nav>)",
                lambda m: m.group(1) + "\n" + items + "\n" + m.group(2),
                nav_match.group(0),
                count=1,
            )
            aside = aside.replace(nav_match.group(0), new_nav, 1)
        html = markup
        if aside:
            html = _ensure_desktop_aside(html, aside)
        # ★ 有菜单文字时不许停在图标轨。源页若是 w-16（或 bind 之后才变窄），
        #   整段复制会把「点进某页侧栏瘪了」扩散到每一页。锁宽度必须在
        #   reconcile **之前**：让位跟的是锁完之后的宽度。
        # ⚠ 2026-08-30 巡店点单真机：device=tablet 仍走桌面抬宽，四页
        #   w-52 全变成 w-64。宽度政策按 device 分，不许再写死 w-64。
        html = ensure_labeled_aside_width(html, device=device)
        if header:
            html = (
                _sub_first_outside_comments(_HEADER, header, html)
                if _search_outside_comments(_HEADER, html)
                else html
            )
        # ★ 内容区容器也要统一（2026-08-15 补）。
        #
        # 此前这里只换 aside/header，**承载它们的那一层没人管**：真机上
        # aside 被收成 1 种、main 仍是 5 种，其中一页写着 `ml-64`——它已经
        # 靠 flex 排在 256px 侧栏右边，再叠 256px 左边距，整个内容区右移一屏。
        # 而判据当时也不看 main，于是 shellProblems=0，**假绿**。
        #
        # ⚠ 只换开标签上的 class，不动 main 里面的任何东西：位移全写在 class
        #   上，而内容里可能有 bind 打的绑定孔，碰不得。
        # ★ 只去掉多余的左偏移，**不抄源页的 main class**（2026-08-15 当天返工）。
        #   抄整段那一版真机当场炸了：p1 是左右分栏（flex 横向），抄给纵向排布的
        #   p3，子元素全被横着排、文字竖排、整页不可用。见 main_offset_tokens。
        # ★ 两个方向都要（2026-08-15 晚）：统一后的侧栏若是 fixed，它不占位，
        #   没有偏移的那一页会被压在侧栏底下（真机 p4 就这么坏的）。
        html = reconcile_main_offset(html)
        # ★ 外壳依赖的自定义类，本页没定义就从别页搬一份（2026-08-16）。
        #   放在 reconcile 之后：那时 aside/header 已经是最终形态，
        #   数出来的 class 才是这一页真正会用到的。
        _own = style_class_rules(html)
        _missing = {
            name: body
            for name, body in vocabulary.items()
            if name in shell_class_tokens(aside, header) and name not in _own
        }
        html = transplant_shell_css(html, _missing)
        if need_fallback and _ACTIVE_FALLBACK_CSS not in html:
            # 塞进 </head> 之前；没有 head 就退到 <body> 之后（都没有就不塞）。
            if "</head>" in html:
                html = html.replace("</head>", _ACTIVE_FALLBACK_CSS + "</head>", 1)
            else:
                html = re.sub(
                    r"(<body\b[^>]*>)",
                    lambda m: m.group(1) + _ACTIVE_FALLBACK_CSS,
                    html,
                    count=1,
                )
        # ★ 整页居中卡片撑满视口（2026-08-20 满电青年）。放在 reconcile
        #   之后：ml-16 已经写对，铺满层才不会去动让位。
        html = mark_shell_parts(html, device="desktop")
        out[page_id] = ensure_desktop_viewport_fill(html)

    return {
        "version": PAGE_SHELL_VERSION,
        "sourcePageId": source_id,
        "navAnchored": bool(templates),
        # ⚠ 带 id，不只是名字。宿主要照它渲染左侧菜单并切页——只有名字的话
        #   又回到"靠文字认页面"。老口径（纯字符串数组）在 08-14 换掉。
        "navItems": [
            {"id": str(p.get("id") or ""), "name": str(p.get("name") or p.get("id") or "")}
            for p in spec_pages
        ],
        "appName": app_name or old_brand,
        "personaRole": role or old_role,
        "pages": out,
    }


_ARIA_CURRENT = re.compile(r'\s*aria-current="[^"]*"', re.I)


def shell_fingerprint(part_html: str) -> str:
    """把一段壳归一化成"除去当前页标记之外的样子"，用来比各页是不是同一套。

    ⚠ **不能拿原文逐字节比。** 第一版就是那么写的，结果对着真实产物报
    「3 种不同的 <aside>」——查下来唯一差别是哪一项带 `aria-current="page"`
    和激活态 class，而那**正是每页应该不同的地方**（每页要标出自己是当前页）。

    一道对正确行为报警的闸比没有闸更糟：它会训练人忽略它。本仓在区块去重那次
    记过同一条教训——「误判会逼人删掉真有用的」。所以比之前先把当前页标记抹平，
    "有没有恰好标一个当前页"另开一条判据去查（见下面 nav.current）。
    """
    text = _ARIA_CURRENT.sub("", part_html or "")
    return _CLASS.sub('class=""', text)


#: 左偏移类：`ml-64` / `ml-[248px]` / `pl-64` 这一类。
_OFFSET_CLS = re.compile(r"^(ml|pl)-(\d+|\[[^\]]+\])$")
_BODY_OPEN = re.compile(r"<body\b[^>]*>", re.I)


def _body_is_flex_row(markup: str) -> bool:
    """`<body>` 是不是一个横向 flex 容器（侧栏和内容区并排的那种布局）。"""
    m = _BODY_OPEN.search(markup or "")
    if not m:
        return False
    cls = _CLASS.search(m.group(0))
    toks = set(cls.group(1).split()) if cls else set()
    return "flex" in toks and "flex-col" not in toks


#: 脱离文档流的定位类。`fixed`/`absolute` 的侧栏**不占位**。
_OUT_OF_FLOW = ("fixed", "absolute")
_WIDTH_CLS = re.compile(r"^w-(\d+|\[[^\]]+\])$")
_STRIP_TAGS = re.compile(r"<[^>]+>")
#: 有菜单文字时低于这个 Tailwind 档算图标轨。w-56 = 14rem 是文字轨下限；
#: shadcn 展开态是 16rem = w-64。平板另锁 w-52，见 ``_labeled_aside_policy``。
_LABELED_ASIDE_MIN_RANK = 56
_LABELED_ASIDE_WIDTH = "w-64"
_TABLET_LABELED_ASIDE_MIN_RANK = 52
_TABLET_LABELED_ASIDE_WIDTH = "w-52"


def _labeled_aside_policy(device: str = "desktop") -> Tuple[int, str]:
    """有菜单文字时的侧栏宽度：桌面 w-64，平板锁 w-52。

    ⚠ 2026-08-30 连锁便利店巡店点单真机（sr-20260828100331-H76H5C6N11）：
    模型按契约写了 ``<aside class="w-52">``，``ensure_labeled_aside_width``
    仍按桌面 ``rank < 56 → 抬到 w-64`` 把四页全抬成 16rem。舞台已经是
    1112×834，侧栏却是桌面宽——「契约通了、统一把密度吃掉」。
    数字抄 ant-design Layout.Sider 200 / ProLayout 208，不许另发明。
    """
    if device == "tablet":
        return _TABLET_LABELED_ASIDE_MIN_RANK, _TABLET_LABELED_ASIDE_WIDTH
    return _LABELED_ASIDE_MIN_RANK, _LABELED_ASIDE_WIDTH


def _aside_tokens(markup: str) -> set:
    m = _ASIDE_OPEN.search(markup or "")
    if not m:
        return set()
    cls = _CLASS.search(m.group(0))
    return set(cls.group(1).split()) if cls else set()


def aside_out_of_flow(markup: str) -> bool:
    """侧栏是不是脱离了文档流（`fixed` / `absolute`）。

    ## ⚠ 这才是「内容区该不该带左偏移」的真正判据（2026-08-15 晚返工）

    此前只问 `<body>` 是不是横向 flex，**漏了一半**：`fixed` 的侧栏根本不参与
    flex 排布，flex 不会给它留出 256px。这时内容区**必须**自己带 `ml-64`，
    否则直接被压在侧栏底下。

    真机（社区药店 p4）当场撞上：

        <body class="flex h-screen overflow-hidden">        ← 横向 flex
        <aside class="w-64 … fixed h-full">                 ← 却是 fixed，不占位
        <main class="flex-1 flex flex-col min-w-0 …">       ← 没有偏移

    截图上侧栏整个压在表格上，「登记时间」「流水单号」两列被盖住。
    而判据全绿——旧规则看到 body 有 flex 就认定「已经排好了」。

    实测：给这一页加回 `ml-64`，main 左边界 256px = 侧栏右边界 256px，严丝合缝。

    ⚠ 这个 `fixed` 还是 **unify_shell 自己贴上去的**：源页的侧栏是 fixed，
      统一时整段复制给了各页，而各页的 main 各自按原来的侧栏形态写偏移。
      壳统一了、承载层没跟着对齐——所以下面 reconcile_main_offset 要成对做。
    """
    return bool(_aside_tokens(markup) & set(_OUT_OF_FLOW))


def aside_offset_token(markup: str) -> Optional[str]:
    """侧栏宽度对应的左偏移类：`w-64` → `ml-64`，`w-[248px]` → `ml-[248px]`。

    ⚠ 宽度认不出来就返回 None，**不猜一个 ml-64 塞进去**：猜错的偏移
      跟没有偏移一样是坏版式，而且更难查。
    """
    tok = aside_width_token(markup)
    if not tok:
        return None
    m = _WIDTH_CLS.match(tok)
    return f"ml-{m.group(1)}" if m else None


def aside_width_token(markup: str) -> Optional[str]:
    """侧栏开标签上的 ``w-*``。没有就 None，不猜。"""
    for tok in _aside_tokens(markup):
        if _WIDTH_CLS.match(tok):
            return tok
    return None


def aside_width_rank(markup: str) -> int:
    """把 ``w-16`` / ``w-[256px]`` 收成可比较的整数。越大越宽。

    Tailwind 数字档：``w-16``=64px，``w-64``=256px。任意值 ``w-[256px]``
    除以 4 对齐到同一把尺。认不出就 0。
    """
    tok = aside_width_token(markup)
    if not tok:
        return 0
    inner = _WIDTH_CLS.match(tok).group(1)
    if inner.isdigit():
        return int(inner)
    px = re.fullmatch(r"\[(\d+)px\]", inner)
    if px:
        return int(px.group(1)) // 4
    rem = re.fullmatch(r"\[(\d+(?:\.\d+)?)rem\]", inner)
    if rem:
        return int(round(float(rem.group(1)) * 4))
    return 0


def aside_has_text_labels(markup: str) -> bool:
    """侧栏导航是不是带着可读文字（不是纯 SVG 图标轨）。

    剥标签再看：中文，或连续三个以上拉丁字母。path 的 ``d=`` 已经随标签走了。
    """
    block = _ASIDE.search(markup or "")
    if not block:
        return False
    nav = _NAV.search(block.group(0))
    blob = nav.group(0) if nav else block.group(0)
    text = unescape(_STRIP_TAGS.sub(" ", blob))
    if re.search(r"[\u4e00-\u9fff]", text):
        return True
    return bool(re.search(r"[A-Za-z]{3,}", text))


def apply_aside_width_token(html: str, width_tok: str) -> str:
    """改 ``<aside>`` 开标签上的宽度类，其它 class 一个不动。"""
    m = _ASIDE_OPEN.search(html or "")
    if not m or not width_tok:
        return html
    tag = m.group(0)
    cls = _CLASS.search(tag)
    if not cls:
        new_tag = re.sub(r"<aside\b", f'<aside class="{width_tok}"', tag, count=1, flags=re.I)
        return html[: m.start()] + new_tag + html[m.end() :]
    toks = cls.group(1).split()
    new: List[str] = []
    replaced = False
    for t in toks:
        if _WIDTH_CLS.match(t):
            if not replaced:
                new.append(width_tok)
                replaced = True
        else:
            new.append(t)
    if not replaced:
        new.insert(0, width_tok)
    new_tag = tag.replace(cls.group(0), f'class="{" ".join(new)}"', 1)
    return html[: m.start()] + new_tag + html[m.end() :]


def ensure_labeled_aside_width(markup: str, *, device: str = "desktop") -> str:
    """有菜单文字的侧栏锁到该设备的文字轨。纯图标轨不动。

    ⚠ 2026-08-20 满电青年：首页 ``w-64`` 文字排得下，工单页 ``w-16``
    同样四个中文项挤成一列。unify 若源页是窄的，点进去就像侧栏自己收了。
    shadcn 展开态是 16rem，不是 3rem。

    ⚠ 2026-08-30 巡店点单：平板契约写 w-52（rank 52），桌面门槛 56
    会把它当图标轨抬成 w-64。平板锁 ``w-52``——太窄抬上去，已经是
    桌面宽的也收回来，让位由 ``reconcile_main_offset`` 跟 ``ml-52``。
    """
    if not aside_has_text_labels(markup):
        return markup
    min_rank, width_tok = _labeled_aside_policy(device)
    if device == "tablet":
        if aside_width_token(markup) == width_tok:
            return markup
        return apply_aside_width_token(markup, width_tok)
    rank = aside_width_rank(markup)
    if rank >= min_rank:
        return markup
    return apply_aside_width_token(markup, width_tok)


def canonical_labeled_aside_width(
    pages_html: Dict[str, str], *, device: str = "desktop"
) -> Optional[str]:
    """多页里文字侧栏该锁的宽度。

    桌面：够宽的取最宽；全是图标轨则抬到 ``w-64``。
    平板：有菜单文字就锁 ``w-52``，不许再抬到桌面 16rem。
    """
    min_rank, width_tok = _labeled_aside_policy(device)
    if device == "tablet":
        for html in pages_html.values():
            if aside_has_text_labels(html):
                return width_tok
        return None
    best_rank, best_tok = -1, None
    labeled = False
    for html in pages_html.values():
        if not aside_has_text_labels(html):
            continue
        labeled = True
        tok = aside_width_token(html)
        rank = aside_width_rank(html)
        if tok and rank > best_rank:
            best_rank, best_tok = rank, tok
    if not labeled:
        return None
    if best_tok and best_rank >= min_rank:
        return best_tok
    return width_tok


_TAG = re.compile(r"<(/?)([a-zA-Z][\w-]*)\b([^>]*?)(/?)>")
#: 空元素不进栈——它们没有闭合标签，压进去会把后面所有祖先关系算错。
_VOID = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})


def _offset_tokens_of(open_tag: str) -> List[str]:
    cls = _CLASS.search(open_tag or "")
    if not cls:
        return []
    return [t for t in cls.group(1).split() if _OFFSET_CLS.match(t)]


def main_offset_chain(markup: str) -> List[Tuple[int, int, str]]:
    """`<main>` **自己和它到 `<body>` 之间的每一层祖先**的开标签，由外向内。

    ## ⚠ 为什么不能只看 `<main>`（2026-08-15 晚，律所那趟当场打脸）

    真机 p1 长这样——偏移写在**包裹层**上，`<main>` 自己干干净净：

        <body class="flex h-screen">
          <aside class="w-64 … fixed">…</aside>
          <div class="flex-1 ml-64 flex flex-col">   ← 让位的是它
            <header>…</header>
            <main class="flex-1 …">…</main>          ← 这一层没有偏移

    只看 `<main>` 的判据于是报「内容区没有左偏移」——**假警报**；
    而按它去"修"（给 main 补 ml-64）真机当场量到 main.left=512px，
    整屏右移了一整个侧栏的宽度。**判据错和修复错是同一个根因。**

    这是同一处第五次返工，也是同一类错误又一次：**拿一个节点推的结论
    套到整棵子树上**。前四次是 class 抄整段 / 只删不补 / 只看 body /
    只看 main，这次是只看一层。
    """
    src = markup or ""
    body = _BODY_OPEN.search(src)
    start = body.end() if body else 0
    stack: List[Tuple[int, int, str]] = []
    for m in _TAG.finditer(src, start):
        closing, name, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if name == "main" and not closing:
            return stack + [(m.start(), m.end(), m.group(0))]
        if closing:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][2][1:].split(None, 1)[0].rstrip(">").lower() == name:
                    del stack[i:]
                    break
        elif not selfclose and name not in _VOID:
            stack.append((m.start(), m.end(), m.group(0)))
    return []


def main_offset_tokens(markup: str) -> List[str]:
    """内容区容器上的**左偏移**类，只取这一类。

    ## ⚠ 为什么只看偏移，不看整个 class（2026-08-15 当天返工）

    第一版拿整个 `<main>` 的 class 当指纹，还让 unify_shell 把源页的整段
    class 抄给所有页。**真机当场炸了**（烘焙那趟 p3）：

        p1 main: flex-1 flex overflow-hidden …   子元素是左右两栏 section
        p3 main: 同上（从 p1 抄的）              子元素是 header + 纵向内容

    `flex` 默认横向，p3 的纵向内容被横着排，每个子元素挤成窄条、文字竖排，
    整页不可用。加回 `flex-col` 就完全正常。

    根因是 main 的 class 混着两种东西：

        ml-64        相对侧栏的**定位**    ← 该各页一致
        flex/flex-col overflow p-8
                     **本页自己的版式**    ← 必须各页不同

    抄整段 = 把源页的版式强加给别人。所以收窄到只管偏移那一半。

    ⚠ 这次的教训：我拿 39 份历史产出验过「main 收敛到 1 种」，但**没验页面
      还能不能看**。指标绿了不等于东西对——这一天里第三次栽在同一处。
    """
    return sorted({t for _s, _e, tag in main_offset_chain(markup)
                   for t in _offset_tokens_of(tag)})


def _replace_offset_classes(tag: str, want: Optional[str]) -> str:
    """只动左偏移类，其余 class 一个不碰。want=None 就是摘掉偏移。"""
    cls = _CLASS.search(tag)
    if not cls:
        if not want:
            return tag
        if tag.endswith("/>"):
            return f'{tag[:-2]} class="{want}"/>'
        if tag.endswith(">"):
            return f'{tag[:-1]} class="{want}">'
        return tag
    toks = cls.group(1).split()
    kept = [t for t in toks if not _OFFSET_CLS.match(t)]
    if want:
        first_off = next((i for i, t in enumerate(toks) if _OFFSET_CLS.match(t)), 0)
        kept.insert(min(first_off, len(kept)), want)
    return tag.replace(cls.group(0), f'class="{" ".join(kept)}"', 1)


def _apply_wanted_offset(markup: str, want: str) -> str:
    """让祖先链上**恰好一层**带着 `want`，错的改、缺的补、多的摘。

    ⚠ 必须改**已经带着偏移的那一层**，不许给 `<main>` 再叠一份——
    律所那趟偏移写在包裹层上，给 main 补 ml-64 当场量到 512px。
    """
    chain = main_offset_chain(markup)
    if not chain:
        return markup
    with_off = [(s, e, t) for s, e, t in chain if _offset_tokens_of(t)]
    if not with_off:
        start, end, tag = chain[-1]
        return markup[:start] + _replace_offset_classes(tag, want) + markup[end:]
    keeper = (with_off[0][0], with_off[0][1])
    out = markup
    for start, end, tag in reversed(chain):
        offs = _offset_tokens_of(tag)
        is_keeper = (start, end) == keeper
        if not offs and not is_keeper:
            continue
        new_tag = _replace_offset_classes(tag, want if is_keeper else None)
        if new_tag != tag:
            out = out[:start] + new_tag + out[end:]
    return out


def offset_needed(markup: str) -> bool:
    """内容区**该不该**带左偏移。侧栏占不占位说了算，不是 body 说了算。

      · 侧栏 fixed/absolute（不占位）→ 该带：不带就被压在侧栏底下
      · 侧栏在流内 + body 横向 flex   → 不该带：flex 已经排好了，再带就偏两次
      · 其余（没侧栏 / 纵向布局）      → 不动它，这是页面自己的版式
    """
    return aside_out_of_flow(markup)


def _drop_main_offset_classes(markup: str) -> str:
    """无条件去掉 main 祖先链上的 ml/pl 偏移类。其余 class 不动。

    ``strip_main_offset`` 有闸（fixed 侧栏要留、非横排 body 当版式）。
    消费端剥掉 aside 之后必须走这里，不能走那条闸。
    """
    out = markup
    # 从内往外改，先改后面的：改了前面的会让后面记下来的偏移量失效。
    for start, end, tag in reversed(main_offset_chain(markup)):
        if not _offset_tokens_of(tag):
            continue
        cls = _CLASS.search(tag)
        kept = [t for t in cls.group(1).split() if not _OFFSET_CLS.match(t)]
        out = (
            out[:start]
            + tag.replace(cls.group(0), f'class="{" ".join(kept)}"', 1)
            + out[end:]
        )
    return out


def strip_main_offset(markup: str) -> str:
    """去掉内容区上**多余**的左偏移（侧栏在流内、body 又是横排的那种）。

    真机上那个「整屏右移 256px」的确定性修法：`ml-64` 叠在 flex 排布之上
    等于偏移两次。只删偏移类，其余 class 一个不动。

    ⚠ `fixed` 的侧栏不占位，那时偏移**不是多余的**——见 aside_out_of_flow。
    """
    if aside_out_of_flow(markup) or not _body_is_flex_row(markup):
        return markup
    return _drop_main_offset_classes(markup)


def reconcile_main_offset(markup: str) -> str:
    """让内容区的左偏移跟**这一页现在这个侧栏**对齐。两个方向都要做。

    ## 为什么必须成对（2026-08-15 晚，真机 p4 被压穿之后补）

    `unify_shell` 把源页的 `<aside>` 整段复制给各页——**连定位方式一起复制**。
    源页的侧栏是 `fixed`，于是各页的侧栏全变成 `fixed`；而各页的 `<main>`
    还写着它原来那套侧栏形态下的偏移：

        p2/p3  main class="ml-64 …"    ← 本来就配 fixed 侧栏，正好
        p4     main class="flex-1 …"   ← 本来配的是流内侧栏，现在没人占位了

    结果 p4 的内容区整个滑到侧栏底下，两列表头被盖住。**壳统一了，
    承载层没跟着对齐**——这正是「只修一半」的形状。

    所以这里两个方向都补：该带的补上，多余的去掉。

    ## ⚠ 有偏移 ≠ 偏移对（2026-08-20 满电青年，第六次返工）

    上一版看到祖先链上有任何 `ml-*` 就 `return markup`——问的是「让了没有」，
    不问「让的是不是这一根侧栏的宽度」。真机源页图标轨 `w-16`（64px），
    别的页还写着给 `w-64` 让的 `ml-64`（256px）。unify 把窄轨贴上去之后，
    中间空出 ~192px 的深色缝，看起来像多了一列空侧栏。

    成熟实现（shadcn/ui Sidebar）用**同一个宽度变量**同时驱动轨和让位：
    `--sidebar-width: 16rem` / `--sidebar-width-icon: 3rem`，gap 元素写
    `w-(--sidebar-width)`，收成图标轨时切到 `--sidebar-width-icon`。
    静态 Tailwind 页面做不到 CSS 变量，等价约束是：`w-16` 就必须 `ml-16`，
    `w-64` 就必须 `ml-64`。错了就改**已经带着偏移的那一层**，不要再给
    `<main>` 叠一份。
    """
    if not _MAIN_OPEN.search(markup or ""):
        return markup
    if not aside_out_of_flow(markup):
        return strip_main_offset(markup)
    want = aside_offset_token(markup)
    if not want:
        return markup  # 宽度认不出来，不猜
    # ⚠ 问的是**整条祖先链**有没有让位，不是只问 <main>：真机 p1 的偏移
    #   写在包裹层上，只看 main 会以为没让位，补一个就成了双倍偏移（512px）。
    layers = [t for _s, _e, t in main_offset_chain(markup) if _offset_tokens_of(t)]
    have = main_offset_tokens(markup)
    if have == [want] and len(layers) == 1:
        return markup  # 已经让对了，一个字都别动
    return _apply_wanted_offset(markup, want)


def main_signature(markup: str) -> str:
    """内容区容器的 class 指纹。**位移全写在这里**，而它一直没人查。

    ⚠ 2026-08-15 补：此前判据只给 `<aside>` / `<header>` 打指纹，
      **不看承载它们的那一层**。真机上因此出过「假绿」：

          header 指纹   p1/p2/p3/p4 完全相同（len=904）
          <main> class  p1/p2: flex-1 flex flex-col min-w-0 overflow-hidden
                        p3:    flex-1 flex flex-col min-w-0 bg-slate-50 relative
                        p4:    **ml-64** flex-1 flex flex-col     ← 左边距 256px

      p4 已经靠 flex 排在 256px 侧栏右边，又叠了 `ml-64` 的 256px，
      整个内容区右移一屏——而 `shellProblems=0`。

    ⚠ 全仓量过一遍，**三个模型全漏**：think 3 种 / ouyi 4 种 / luna 5 种
      （`ml-[236px]` `ml-[248px]` `ml-[244px]` `main-wrap` `main-shell`）。
      luna 只是漏得不显眼——差几个像素肉眼无感，不代表没病。

    抠不到 `<main>` 返回空串：没有 main 是合法的（全屏向导页），
    由调用方按「有的页才比」处理。
    """
    m = _MAIN_OPEN.search(markup or "")
    if not m:
        return ""
    cls = _CLASS.search(m.group(0))
    # class 顺序不该影响判定——排序后比对，避免把「同一套壳换了个书写顺序」
    # 误报成漂移。
    return " ".join(sorted(cls.group(1).split())) if cls else ""


_DATA_ATTR = re.compile(r'\s*data-[a-z-]+="[^"]*"', re.I)


def restore_shell_after_bind(
    bound: Dict[str, str], before: Dict[str, str]
) -> Tuple[Dict[str, str], List[str]]:
    """bind 把壳改坏的页，用打孔前那份壳换回来。**零 LLM。**

    ## 为什么需要

    第 3.5 步 `unify_shell` 已经把各页的壳统一成一套了。然后第 6.5 步 bind
    让 LLM 重写整页——提示词明写「版式一个像素都不要改」，但真机八趟八次
    都测出漂移，最狠的一次是同一个应用里出现两个产品名、两套侧栏菜单。

    既然打孔前那份壳是**已知正确**的，就不用再问模型，直接换回来。

    ## ⚠ 不能无脑全换：bind 也会往壳里打合法的孔

    实测 34 份产出里 **12 份**壳里有 `data-*`，例如：

        <span data-value="booking" data-aggregate="count">今日已有 N 节排课</span>
        <button data-action="createRecord" data-entity="vaccine_plan">

    无脑还原会把这些孔洗掉，页面退回死的静态壳。

    所以判定标准是**结构**，不是原文：把 `data-*` 属性抠掉之后再比指纹。

      · 抠掉 data-* 后一致 → bind 只是加了孔，**保留 bind 的版本**
      · 抠掉 data-* 后仍不同 → bind 动了结构，**换回打孔前那份**

    真机 A/B（同一批 5 页，bind 前后逐页比对）验证过这个划分：
        p2.header  结构被改了      → 该还原
        p5.aside   结构被改了      → 该还原
        p4.aside   只加了 data-*   → 该保留

    返回 (修正后的页面, 被还原的位置清单)。
    """
    fixed = dict(bound)
    restored: List[str] = []
    for pid, after_html in bound.items():
        src = before.get(pid)
        if not src:
            continue
        a, b = extract_shell(src), extract_shell(after_html)
        for part, pattern in (("aside", _ASIDE), ("header", _HEADER)):
            if not a[part] or not b[part]:
                continue
            if shell_fingerprint(a[part]) == shell_fingerprint(b[part]):
                continue  # 原样没动
            if shell_fingerprint(_DATA_ATTR.sub("", a[part])) == shell_fingerprint(
                _DATA_ATTR.sub("", b[part])
            ):
                continue  # 只加了孔，保留
            fixed[pid] = pattern.sub(lambda _m: a[part], fixed[pid], count=1)
            restored.append(f"{pid}.{part}")
    return fixed, restored


def repair_pages_after_bind(
    bound: Dict[str, str],
    before: Dict[str, str],
    *,
    device: str = "desktop",
) -> Tuple[Dict[str, str], List[str], List[str]]:
    """bind 之后的确定性收尾：**换回被改坏的壳 + 重新对齐内容区偏移**。零 LLM。

    ## ⚠ 为什么偏移要再做一遍

    第 3.5 步 `unify_shell` 已经调过 `reconcile_main_offset`——但 bind 是
    **让 LLM 重写整页**，它可以把内容区那一层的 `ml-64` 一起改掉。而
    `restore_shell_after_bind` 只管 `<aside>`/`<header>` 两段，**不碰 main**，
    于是没有任何一处把偏移补回来。这是一条**兜底**，代价是零 LLM 的一次扫描。

    ## ⚠ 诚实记账：它是从一次**假警报**里推出来的

    本函数 2026-08-15 晚加的时候，理由写的是"律所那趟 4 页里 2 页被 bind
    吃掉了偏移"。后来查明那批告警是假的——当时 `main_offset_tokens` 只看
    `<main>` 一层，而真机 p1/p4 的偏移写在**包裹层**上（见 main_offset_chain）。
    交付页本来就是好的，是判据错了；而按那个错判据去"修"，真机量到
    main.left=512px，**整屏右移了一整个侧栏宽度**——判据错和修复错同根。

    所以「bind 吃掉偏移」这个形状**至今没有在真机上观测到**，单测里那份是
    构造出来的。留着它是因为便宜，不是因为它救过火。

    ⚠ 顺序要紧：先还原壳，再锁文字侧栏宽度，再对齐偏移。偏移该不该有
      取决于**侧栏是不是 fixed**，宽度取决于**锁完之后的 w-***——先算偏移
      就是拿旧侧栏做的判断。

    ⚠ 宽度政策跟 unify 同一套 ``device``。漏传的话平板 bind 之后
    又会按桌面门槛把 w-52 抬成 w-64——unify 修好、打孔收尾再弄坏。

    返回 (修好的页面, 被还原的壳, 被重新对齐的内容区)。
    """
    fixed, restored = restore_shell_after_bind(bound, before)
    # bind 常只改 class（w-64 → w-16）。shell_fingerprint 把 class 抹平，
    # restore 会以为没动——侧栏就这么瘪了。锁回打孔前那套文字轨宽度。
    canonical = canonical_labeled_aside_width(
        before, device=device
    ) or canonical_labeled_aside_width(fixed, device=device)
    reconciled: List[str] = []
    for pid, html in list(fixed.items()):
        out = html
        if canonical:
            out = apply_aside_width_token(out, canonical)
        out = ensure_labeled_aside_width(out, device=device)
        aligned = reconcile_main_offset(out)
        if aligned != html:
            fixed[pid] = aligned
            if main_offset_tokens(aligned) != main_offset_tokens(html):
                reconciled.append(f"{pid}.main")
    return fixed, restored, reconciled


def _drift_fingerprint(part: str, part_html: str) -> str:
    """比「各页是不是同一套壳」时用的指纹。**比 shell_fingerprint 多抹两样。**

    ⚠ 两样都是真机上量出来的**假警报**（社区药店，2026-08-15，一趟报了 2 条，
      两条全是把正确行为当故障）：

      1. `data-*`：bind 会往壳里打**合法的**孔（侧栏那块登录人卡片打了
         `data-record="pharmacist"` + `data-field="name"`）。三页打的位置深浅
         不同（p2 打在外层 div、p3 打在内层、p4 没打），指纹就三种。
         **restore_shell_after_bind 早就知道这条**（它比之前先 _DATA_ATTR.sub），
         而这里不知道——同一个模块两套归一化标准，是这次假警报的直接原因。

      2. 面包屑当前节：`set_breadcrumb_current` 故意让它逐页不同。

    抹掉的东西不是不查，是**另开判据查**：孔的合法性归 html_bindings，
    面包屑末节归下面的 `.breadcrumb` 那条。
    """
    stripped = _DATA_ATTR.sub("", part_html or "")
    if part == "header":
        stripped = blank_breadcrumb_current(stripped)
    return shell_fingerprint(stripped)


def check_shell_consistency(
    pages_html: Dict[str, str], spec: Dict[str, Any], *, device: str = "desktop"
) -> List[Dict[str, str]]:
    """判据：统一之后还剩几处不一致。**这是本模块存在的理由，别删。**

    五条，每条对应量到过的一个真实症状：
      · 壳（除当前页标记外）必须各页一致（对应「三个产品名、三个登录人」）
      · **内容区容器必须各页一致**（对应 p4 叠了 ml-64、整屏右移；
        这条 2026-08-15 才补——此前只查壳本身不查承载层，出过假绿）
      · 导航项必须**恰好等于** spec 的页面清单（对应 p3 发明 5 个不存在的入口）
      · 每页恰好标一个当前页（第一版漏掉的——归一化抹平激活态之后，
        "全都不激活"和"标了三个"都会静静通过）
      · 每页至少还剩一个壳（对应替换把壳整段吃掉的失败形态）
    """
    problems: List[Dict[str, str]] = []
    shells = {pid: extract_shell(h) for pid, h in pages_html.items()}

    # 移动端没有 <aside>，导航是页面级 <nav>（底部标签栏）。aside 在时照旧
    # 只认 aside 里的 nav（桌面页面可能另有面包屑 nav，不该被误查）；
    # aside 不在才回落到整页找（2026-08-14 竖屏加）。
    # ⚠ 2026-08-21：整页找必须跳过 Breadcrumb，否则手机顶栏面包屑被当成底栏。
    def _nav_of(pid: str) -> Optional[re.Match]:
        aside = shells[pid]["aside"]
        if aside:
            return _NAV.search(aside)
        return _page_nav(pages_html[pid])

    for part in ("aside", "header"):
        distinct = {_drift_fingerprint(part, s[part]) for s in shells.values() if s[part]}
        if len(distinct) > 1:
            problems.append({
                "path": part,
                "message": f"{len(distinct)} 种不同的 <{part}>——各页还不是同一套壳",
            })

    # 面包屑末节：上面比指纹时**故意**抹掉了它，这里单独查。
    # ⚠ 归一化抹掉什么，就得另开一条判据查什么——否则「逐页改对」和
    #   「压根没改、全是源页那一节」会一起静静通过（aria-current 那条
    #   就是这么补的）。
    names = {
        str(p.get("id") or ""): str(p.get("name") or "").strip()
        for p in (spec.get("pages") or [])
    }
    for pid, s in shells.items():
        want = names.get(pid)
        if not want or not s["header"]:
            continue
        got = breadcrumb_current_text(s["header"])
        if got is None:
            continue  # 没有面包屑是合法的，硬塞一个是新的破坏
        if got != want:
            problems.append({
                "path": f"{pid}.breadcrumb",
                "message": f"面包屑末节写着「{got}」，而这一页是「{want}」",
            })

    # 内容区的**定位**。⚠ 只查左偏移，不比整段 class：
    #   `flex` vs `flex-col`、overflow、padding 都是**这一页自己的版式**，
    #   本来就该各页不同。第一版比整段，等于把「页面各有各的排布」报成漂移，
    #   而按它去"修"（抄源页 class）真机当场把页面排炸了——见 main_offset_tokens。
    for pid, html in pages_html.items():
        out_of_flow = aside_out_of_flow(html)
        offsets = main_offset_tokens(html)
        if not out_of_flow and _body_is_flex_row(html) and offsets:
            problems.append({
                "path": f"{pid}.main",
                "message": (
                    f"内容区带着 {'、'.join(offsets)}，"
                    f"而它已经被 flex 排在侧栏右边了——偏移了两次"
                ),
            })
        # ⚠ 反方向，真机 p4 撞的就是这条：fixed 侧栏不占位，内容区不让位
        #   就被压在底下。旧判据只查「偏移了两次」，这一半是**空的**——
        #   页面坏成那样，shellProblems 里一个字都没有。
        elif out_of_flow and not offsets and _ASIDE_OPEN.search(html or ""):
            problems.append({
                "path": f"{pid}.main",
                "message": (
                    f"侧栏是 fixed/absolute（不占位），而内容区没有左偏移——"
                    f"内容会被压在侧栏底下"
                ),
            })
        # ⚠ 2026-08-20 满电青年：旧判据只问「有没有偏移」，`w-16`+`ml-64`
        #   也算「已经让位了」——假绿，中间一条 192px 的缝没有人报。
        elif out_of_flow and offsets:
            want = aside_offset_token(html)
            if want and any(t != want for t in offsets):
                problems.append({
                    "path": f"{pid}.main",
                    "message": (
                        f"内容区让位是 {'、'.join(offsets)}，"
                        f"侧栏宽度对应的是 {want}——"
                        f"中间会空出一条缝（或内容被压住）"
                    ),
                })

    # 全部页面都没 aside（移动端）时，标签栏本身也要各页一致
    if not any(s["aside"] for s in shells.values()):
        navs = {pid: _nav_of(pid) for pid in shells}
        distinct_nav = {shell_fingerprint(m.group(0)) for m in navs.values() if m}
        if len(distinct_nav) > 1:
            problems.append({
                "path": "nav",
                "message": f"{len(distinct_nav)} 种不同的 <nav>——底部标签栏还不是同一套",
            })

    for pid, s in shells.items():
        nav = _nav_of(pid)
        if not nav:
            continue
        marked = len(re.findall(r'aria-current="page"', nav.group(0), re.I))
        if marked != 1:
            problems.append({
                "path": f"{pid}.nav.current",
                "message": f"标了 {marked} 个当前页，应该恰好 1 个",
            })

    # ⚠ 2026-09-05：这里原先拿 **spec 原名** 去比渲染出来的导航项，而导航项是
    #   `nav_tab_label()` 出来的——它会剥产品名前缀、剥「某某页」的「页」。
    #   于是**只要有一页的名字以「页」结尾，这条检查就必然报错**，跟壳对不
    #   对得上无关。真机（汉字消除小游戏 sr-20260904214530）三页全中：
    #     导航项 ['挑战主', '限时对局', '战绩结算与历史']
    #     spec  ['挑战主页', '限时对局页', '战绩结算与历史页']
    #   一条系统性误报的检查，下一个人只会学会忽略它——那比没有更糟。
    #   两侧共用同一把尺子（§4：成对的东西不许只改一半）。
    _app_for_nav = str(spec.get("appName") or "").strip()
    want = [
        nav_tab_label(
            str(p.get("name") or p.get("id") or ""),
            _app_for_nav,
            strip_page_suffix=(device == "phone"),
        )
        for p in (spec.get("pages") or [])
    ]
    for pid, s in shells.items():
        nav = _nav_of(pid)
        if not nav:
            continue
        got = [
            re.sub(r"<[^>]+>", "", a).strip()
            for a in _LINK.findall(nav.group(0))
        ]
        got = [g for g in got if g]
        if got != want:
            problems.append({
                "path": f"{pid}.nav",
                "message": f"导航项 {got} 跟 spec 的页面清单 {want} 对不上",
            })

    app_name = str(spec.get("appName") or "").strip()
    from services.page_naming import is_host_brand_name

    if app_name and not is_host_brand_name(app_name):
        for pid, s in shells.items():
            blob = s["aside"] + s["header"]
            if blob and app_name not in blob:
                problems.append({
                    "path": f"{pid}.appName",
                    "message": f"壳上没有 spec 的产品名「{app_name}」——"
                               f"多半是认错了模型编的那个名字，替换没落到实处",
                })

    for pid, s in shells.items():
        if not s["aside"] and not s["header"]:
            problems.append({"path": pid, "message": "这一页壳没了，替换把它整段吃掉了"})
    return problems
