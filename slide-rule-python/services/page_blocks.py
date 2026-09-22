"""给交付页里的每个**块**打上可寻址的身份：`data-block` / `data-block-kind`。

## 这是抄来的（xai-org/grok-build `xai-grok-config/src/managed_text/`）

那边解决的是同一类问题的文本版：一份配置文件里，**只有被标记的那几段是我的**，
改的时候只换那几段的 body，其余原文（它叫 `unmanaged_text`）一个字节不动。
四条纪律照抄：

    1. 标记即身份     `# >>> name >>>` … `# <<< name <<<`  →  本仓：`data-block="库存概览"`
    2. 名字必须唯一   `duplicate requested item {}`          →  本仓：同页重名加 `#2`，读回时重名判失败
    3. body 不许含标记 `item {} contains marker-like content` →  本仓：新 body 里出现 data-block 就拒（边界劫持）
    4. 换完要过校验器  `SyntaxValidator`                      →  本仓：scan_bindings + 标签栈平衡

HTML 比行注释配置好办一件事：**闭合标签天然存在**，不需要成对写标记，
一个开标签上的属性就够了。所以这里只打开标签，闭合交给标签栈算。

## 为什么不在第 3 步让模型自己写 data-block

因为它会漏。而且第 3 步是全链最贵的一步，判据挂在那儿要 25 分钟一轮才看得见。
块的划分完全能从 HTML 结构**确定性地**推出来（零 LLM、零成本、可单测），
那就没有理由花模型的钱去换一个不保证的结果。同一条理由让 3.5 步外壳统一
也是零 LLM 的。

## 名字是地址，类型是元信息

`data-block` 是**地址**：一旦定下来，后面每一遍打标都原样保留——名字一变，
用户在画布上选中的那一块就换人了。`data-block-kind` 不是地址，每一遍都按
当前 HTML 重算：第 3.5 步那会儿 `data-*` 孔还没打，看板的四列看不出是逐行
容器；第 6.5 步打完孔再算才算得准。

## ⚠ 打两遍，不是一遍（照 apply_theme_to_pages 的先例）

第 6.5 步 bind 常常**整页重写**——2026-08-15 那次它把 3.5 步统一好的壳都弄乱了，
所以 pipeline 里主题色也是打完孔之后再钉一次的。块标同理：3.5 步打一次（让直播
舞台就能按块看），bind + 还原之后再打一次（补回被重写吃掉的）。
本模块所有写操作**幂等**，重复打不会改已有的名字——名字一变，画布上用户
选中的那一块就换人了。

## ⚠ fail-open（纪律七）

打块标是增强。marker 打不上，页面照样交付；所以调用方一律 try/except 兜住。
读回那一侧（slice/replace）是 fail-closed：改错地方比不给改坏得多。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .page_shell import _blank_comments  # 注释屏蔽只留一份实现

BLOCK_MARK_ATTR = "data-block"
BLOCK_KIND_ATTR = "data-block-kind"

PAGE_BLOCKS_VERSION = "page-blocks-v1"

#: 块类型封闭词表——**Python 侧唯一一份**，前端 page-blocks.ts 直接读属性，
#: 不自己再判一遍（`scan_bindings` 与 JS `querySelectorAll` 语义分叉那口井，
#: CLAUDE.md 第四条，踩过一次够了）。
BLOCK_KINDS: Tuple[str, ...] = (
    "chart",    # 图表
    "table",    # 表格 / 逐行列表
    "form",     # 表单
    "detail",   # 详情卡（单条记录）
    "metric",   # 指标（单值）
    "list",     # 列表
    "media",    # 图文
    "card",     # 兜底：一块内容
)

KIND_LABEL_CN: Dict[str, str] = {
    "chart": "图表",
    "table": "表格",
    "form": "表单",
    "detail": "详情",
    "metric": "指标",
    "list": "列表",
    "media": "图文",
    "card": "卡片",
}

#: 语义标签本身就是一块。
_SEMANTIC_BLOCK_TAGS = frozenset({"section", "article", "table", "form", "figure"})

#: 挂了数据源的元素本身就是一块（词表跟 html_bindings.DATA_SOURCE_KEYS 对齐）。
_DATA_BLOCK_ATTRS = ("data-rows", "data-record", "data-chart", "data-value")

#: **永远不是块**的标签：交互件与行内件。
#:
#: ⚠ 2026-08-27 首轮扫 28 份真机页抓到的：`<button class="... rounded-lg shadow-sm">`
#:   完全吃中"圆角+有面"这条卡片签名，于是「新增老人档案」「导出任务表」两个
#:   按钮被提成了顶层块。按钮是块**里面**的零件（画布已有的元素点选管它），
#:   不是页面的组装单位。判据 test_page_blocks 里那条按钮反例钉着这一点。
_NEVER_BLOCK_TAGS = frozenset(
    {"button", "a", "label", "span", "small", "strong", "em", "i", "b",
     "td", "th", "li", "option", "p", "input", "select", "textarea"}
)

#: 壳与非内容子树：块只在正文里找。
_CHROME_TAGS = frozenset({"aside", "header", "nav", "footer", "script", "style", "svg", "head"})

_VOID_TAGS = frozenset(
    {"br", "hr", "img", "input", "meta", "link", "source", "col", "area", "base", "embed", "track", "wbr"}
)

_TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(/?)>")
_CLASS_RE = re.compile(r'\bclass="([^"]*)"', re.I)
_HEADING_RE = re.compile(r"<(h[1-6])\b[^>]*>(.*?)</\1>", re.I | re.S)
#: 没有 h1~h6 时的第二梯队：带"标题感"字重的元素。
#: ⚠ 标签白名单不能去：表头那一行 ``<tr class="… font-medium">`` 也带粗体，
#:   一放开，块名就变成整行表头（「表格:姓名 性别 年龄 健康等级 …」）——
#:   2026-08-27 修完按钮那条之后立刻踩到的第二个坑。
_TITLEISH_RE = re.compile(
    r'<(div|span|p|h[1-6])\b[^>]*class="[^"]*\bfont-(?:semibold|bold|medium)\b[^"]*"[^>]*>(.*?)</\1>',
    re.I | re.S,
)
#: 纯数值（金额、计数、百分比）不能当标题——指标卡里字最粗的就是那个数。
_NUMERICISH_RE = re.compile(r"^[\d\s,.%+\-/:¥$￥万亿元件人次天时分秒]+$")
_TAGS_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")

#: 标签长度上限。名字要能整个显示在画布的块角标上，太长的截断加省略号。
MAX_LABEL_CHARS = 20


class BlockEditError(RuntimeError):
    """按块改写失败。**不回落**——改错地方比不给改坏得多（纪律七的 fail-closed 那一半）。"""


# ── 元素扫描（标签栈）────────────────────────────────────────────────


class _Element:
    __slots__ = ("tag", "body", "open_start", "open_end", "inner_end", "close_end", "depth")

    def __init__(self, tag: str, body: str, open_start: int, open_end: int, depth: int) -> None:
        self.tag = tag
        self.body = body
        self.open_start = open_start
        self.open_end = open_end
        self.inner_end: Optional[int] = None
        self.close_end: Optional[int] = None
        self.depth = depth


def _scan_elements(text: str) -> List[_Element]:
    """扫出所有**闭合完整**的元素，带开合区间与嵌套深度。

    ⚠ 没闭合的元素直接丢掉（inner_end 留 None）——块的边界靠闭合标签算，
      边界不确定的东西不许当块，否则"改这一块"会顺手吃掉半页。
    """
    blanked = _blank_comments(text or "")
    out: List[_Element] = []
    stack: List[_Element] = []
    for m in _TAG_RE.finditer(blanked):
        closing, tag, body, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if closing:
            hit = next((i for i in range(len(stack) - 1, -1, -1) if stack[i].tag == tag), None)
            if hit is None:
                continue
            # 中间那些没闭合的整段丢掉：它们的边界不可信。
            for el in stack[hit + 1 :]:
                el.inner_end = None
            del stack[hit + 1 :]
            el = stack.pop()
            el.inner_end = m.start()
            el.close_end = m.end()
            continue
        if tag in _VOID_TAGS or selfclose:
            continue
        el = _Element(tag, body, m.start(), m.end(), len(stack))
        stack.append(el)
        out.append(el)
    for el in stack:
        el.inner_end = None
    return [el for el in out if el.inner_end is not None]


def _attr(body: str, name: str) -> Optional[str]:
    m = re.search(rf'\b{re.escape(name)}="([^"]*)"', body, re.I)
    return m.group(1) if m else None


def _class_tokens(body: str) -> List[str]:
    m = _CLASS_RE.search(body)
    return m.group(1).split() if m else []


def _looks_like_card(tokens: Iterable[str]) -> bool:
    """卡片视觉签名：圆角 + （描边 / 投影 / 白底）。

    ⚠ 单看 ``rounded`` 不行：真机页里徽章、头像、按钮全是圆角，一认就把
      卡片里的小零件也提成块。三十份真机页扫下来，"圆角 + 有面"这一条
      抓到的是卡片本身，抓不到零件。
    """
    toks = list(tokens)
    if any(t == "card" or t.startswith("card-") for t in toks):
        return True
    rounded = any(t == "rounded" or t.startswith("rounded-") for t in toks)
    if not rounded:
        return False
    return any(
        t == "border" or t.startswith("border-") or t.startswith("shadow") or t.startswith("bg-white")
        for t in toks
    )


def _is_block_candidate(el: _Element) -> bool:
    if el.tag in _NEVER_BLOCK_TAGS:
        return False
    if el.tag in _SEMANTIC_BLOCK_TAGS:
        return True
    if any(a in el.body.lower() for a in _DATA_BLOCK_ATTRS):
        return True
    return _looks_like_card(_class_tokens(el.body))


def _content_range(text: str, elements: List[_Element]) -> Tuple[int, int]:
    """正文区间：优先 ``<main>``，退到 ``<body>``，再退到整篇。"""
    for tag in ("main", "body"):
        el = next((e for e in elements if e.tag == tag), None)
        if el is not None and el.inner_end is not None:
            return el.open_end, el.inner_end
    return 0, len(text or "")


def _inside_chrome(el: _Element, chrome: List[_Element]) -> bool:
    return any(c.open_start < el.open_start and el.open_start < (c.inner_end or -1) for c in chrome)


def _plain_text(html: str) -> str:
    txt = _TAGS_RE.sub(" ", html or "")
    for ent, ch in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"')):
        txt = txt.replace(ent, ch)
    return _WS_RE.sub(" ", txt).strip()


def _block_kind(inner: str) -> str:
    low = inner.lower()
    if "data-chart" in low:
        return "chart"
    if "<table" in low or "data-rows" in low:
        return "table"
    if "<form" in low or ("data-record" in low and re.search(r"<(input|select|textarea)\b", low)):
        return "form"
    if "data-record" in low:
        return "detail"
    if "data-value" in low:
        return "metric"
    if "<ul" in low or "<ol" in low:
        return "list"
    if _is_media_block(inner, low):
        return "media"
    return "card"


#: 图文块的门槛：图**是主角**，不是配角。
#:
#: ⚠ 2026-08-27 真机（协作空间那趟，20 块）：第一版只要块里有 `<img>` 就判
#:   图文，于是看板的四列（待办/进行中/审核中/已完成，每列一堆任务卡、卡上
#:   带头像）全被判成「图文:待办」，20 块里错了 6 块。头像不是这一块的主角。
#:   门槛落在**文字量**上：图文块的字本来就少（一张图 + 一句说明）。
MEDIA_MAX_TEXT_CHARS = 30


def _is_media_block(inner: str, low: str) -> bool:
    if "<figure" in low:
        return True
    if "<img" not in low:
        return False
    if "<table" in low or "<form" in low:
        return False
    return len(_plain_text(inner)) <= MEDIA_MAX_TEXT_CHARS


#: 紧贴块**前面**那条 HTML 注释。模型画页时几乎每块前面都写一条
#: （`<!-- 老人档案主表 (占据主要高度) -->`），而且写的正是这一块是什么。
_LEAD_COMMENT_RE = re.compile(r"<!--(.*?)-->\s*$", re.S)


def _lead_comment(before: str) -> str:
    """块前那条注释的正文。中间只许隔空白——隔了别的东西就不是在说这一块。"""
    m = _LEAD_COMMENT_RE.search(before or "")
    if not m:
        return ""
    txt = _WS_RE.sub(" ", m.group(1)).strip()
    txt = re.sub(r"[（(].*?[)）]", "", txt).strip()  # 「(占据主要高度)」这种排版旁注
    return txt


def _block_label(inner: str, kind: str, before: str = "") -> str:
    """块的人话名字：先找标题，再找首段短文本，都没有就用类型名。

    ⚠ 标签**不能**含 ``"`` / ``<`` / ``>``——它要写进属性值里，写进去就破。
      不转义、直接剔掉：名字是给人看的，转义序列出现在画布角标上更难看。
    """
    # ⚠ 只在**表格/图表之前**那段抬头里找名字。表格卡没写标题时，整块的
    #   第一段文字就是表头第一列（「表格:姓名」），那不是这一块的名字。
    head_zone = inner or ""
    cut = min(
        (i for i in (head_zone.lower().find(t) for t in ("<table", "<tbody", "<canvas")) if i > 0),
        default=-1,
    )
    if cut > 0:
        head_zone = head_zone[:cut]
    m = _HEADING_RE.search(head_zone)
    raw = _plain_text(m.group(2)) if m else ""
    if not raw:
        # ⚠ 2026-08-27 真机：表格卡的标题常写成 <div class="font-semibold">，
        #   没有 h*。只靠 h* 的话这一块的名字会落到表头第一列（「表格:姓名」）。
        #   但字最粗的元素在指标卡里是那个**数字**，所以纯数值要跳过——
        #   否则块名会变成「指标:1,284」，下一轮数字一变名字就换人。
        for tm in _TITLEISH_RE.finditer(head_zone):
            cand = _plain_text(tm.group(2))
            if cand and len(cand) <= MAX_LABEL_CHARS + 4 and not _NUMERICISH_RE.match(cand):
                raw = cand
                break
    if not raw:
        for seg in _plain_text(head_zone or inner or "").split(" "):
            if seg:
                raw = seg
                break
    if not raw:
        # ⚠ 2026-08-27 真机：24 份页里有两块表格卡**整块没有标题**——卡片直接
        #   包着 <table>，抬头区一个字都没有。名字只能落成「表格:表格」。
        #   而它前面正好有一条 `<!-- 老人档案主表 -->`。模型写注释比写标题勤，
        #   这条兜底把这两块从无名捞了回来。
        raw = _lead_comment(before)
    raw = re.sub(r'[<>"&]', "", raw).strip()
    if not raw:
        return KIND_LABEL_CN.get(kind, kind)
    if len(raw) > MAX_LABEL_CHARS:
        raw = raw[:MAX_LABEL_CHARS] + "…"
    return raw


def _unique(name: str, used: set) -> str:
    """重名加 ``#2``——grok 那边是**拒绝**重名（请求由调用方写，可以拒）；
    我们这边名字是自己算出来的，拒了就等于放弃标记，只能消歧。
    读回那一侧仍然按 grok 的口径：重名 = 失败（见 slice_block）。
    """
    if name not in used:
        used.add(name)
        return name
    n = 2
    while f"{name}#{n}" in used:
        n += 1
    out = f"{name}#{n}"
    used.add(out)
    return out


# ── 打标 ────────────────────────────────────────────────────────────


def mark_page_blocks(markup: str) -> str:
    """给正文里每个**最外层**块打上 ``data-block`` / ``data-block-kind``。幂等。

    「最外层」是这套东西的地基：块之间**不许嵌套**，一页被切成互不重叠的
    若干段，正好对上 grok 那边 item 与 unmanaged_text 的关系。允许嵌套的话
    「改这一块」会变成「改这一块和它里面那三块」，unmanaged_text 就不再是
    原样拼回，而是被覆盖。
    """
    text = markup or ""
    if not text:
        return text
    elements = _scan_elements(text)
    if not elements:
        return text
    lo, hi = _content_range(text, elements)
    chrome = [e for e in elements if e.tag in _CHROME_TAGS]

    picked: List[_Element] = []
    taken_end = -1  # 最外层：按开标签顺序扫，落在上一块区间里的一律跳过
    for el in sorted(elements, key=lambda e: e.open_start):
        if el.open_start < lo or (el.inner_end or 0) > hi:
            continue
        if el.tag in _CHROME_TAGS or _inside_chrome(el, chrome):
            continue
        if el.open_start < taken_end:
            continue
        if not _is_block_candidate(el):
            continue
        picked.append(el)
        taken_end = el.close_end or el.open_end

    if not picked:
        return text

    # 已有的名字先占位：重打时不改已有块的名字（幂等的关键）。
    used = {n for n in re.findall(rf'{BLOCK_MARK_ATTR}="([^"]*)"', text)}
    # (start, end, 替换文本)。end == start 表示纯插入。
    edits: List[Tuple[int, int, str]] = []
    for el in picked:
        inner = text[el.open_end : el.inner_end or el.open_end]
        kind = _block_kind(inner)
        existing = _attr(el.body, BLOCK_MARK_ATTR)
        if existing is not None:
            # ★ 名字是**地址**，一个字都不许改（改了 = 用户选中的那一块换了人）。
            #   类型只是元信息，每一遍都按当前 HTML 重新算：第 3.5 步那会儿
            #   data-* 孔还没打，看板那四列看不出是逐行容器；第 6.5 步打完孔
            #   再算才算得准（2026-08-27 真机：图文→表格、卡片→指标各修正了几块）。
            # ⚠ 在**整段开标签原文**里搜，不在 el.body 里搜：body 是标签名
            #   之后那一截，拿它的偏移去加 open_start 会差 `1+len(tag)` 个字符，
            #   替换落到标签名中间，HTML 当场写坏——而且第一遍看不出来，
            #   是第三遍打标跟第二遍不一致才露的馅（2026-08-27 真机自查）。
            tag_text = text[el.open_start : el.open_end]
            m = re.search(rf'{BLOCK_KIND_ATTR}="([^"]*)"', tag_text)
            if m and m.group(1) != kind:
                at = el.open_start + m.start(1)
                edits.append((at, at + len(m.group(1)), kind))
            elif not m:
                edits.append((el.open_end - 1, el.open_end - 1, f' {BLOCK_KIND_ATTR}="{kind}"'))
            continue
        label = _block_label(inner, kind, before=text[max(0, el.open_start - 400) : el.open_start])
        name = _unique(label, used)
        edits.append(
            (el.open_end - 1, el.open_end - 1, f' {BLOCK_MARK_ATTR}="{name}" {BLOCK_KIND_ATTR}="{kind}"')
        )

    out = text
    for start, end, frag in sorted(edits, key=lambda e: e[0], reverse=True):
        out = out[:start] + frag + out[end:]
    return out


def mark_pages_blocks(pages: Dict[str, str]) -> Dict[str, str]:
    """整批打标。单页炸了只丢那一页的标，不拖累别页（纪律七 fail-open）。"""
    out: Dict[str, str] = {}
    for pid, html in (pages or {}).items():
        try:
            out[pid] = mark_page_blocks(html)
        except Exception:  # noqa: BLE001 — 打标是增强，不许拦交付
            out[pid] = html
    return out


# ── 读回 ────────────────────────────────────────────────────────────


def scan_blocks(markup: str) -> List[Dict[str, Any]]:
    """列出这一页上所有已打标的块。顺序 = 文档顺序。

    每条：``name`` / ``kind`` / ``label`` / ``tag`` / ``start`` / ``bodyStart``
    / ``bodyEnd`` / ``end``。``label`` 从 name 的 ``类型:标签`` 里劈出来。
    """
    text = markup or ""
    out: List[Dict[str, Any]] = []
    for el in sorted(_scan_elements(text), key=lambda e: e.open_start):
        name = _attr(el.body, BLOCK_MARK_ATTR)
        if not name:
            continue
        kind = _attr(el.body, BLOCK_KIND_ATTR) or "card"
        out.append(
            {
                "name": name,
                "kind": kind if kind in BLOCK_KINDS else "card",
                "label": name,
                "tag": el.tag,
                "start": el.open_start,
                "bodyStart": el.open_end,
                "bodyEnd": el.inner_end,
                "end": el.close_end,
            }
        )
    return out


def slice_block(markup: str, name: str) -> Dict[str, Any]:
    """切出一块：``before`` + ``head`` + ``body`` + ``tail`` + ``after`` == 原文。

    ``before`` / ``after`` 就是 grok 的 ``unmanaged_text``——改块的时候这两段
    **一个字节都不许动**。

    重名直接判失败（照抄 `duplicate requested item {}`）：同一个名字指两块，
    改哪一块都是猜。
    """
    text = markup or ""
    hits = [b for b in scan_blocks(text) if b["name"] == name]
    if not hits:
        raise BlockEditError(f"这一页没有名叫「{name}」的块")
    if len(hits) > 1:
        raise BlockEditError(f"块名重复：「{name}」在同一页出现 {len(hits)} 次，改哪一块都是猜")
    b = hits[0]
    return {
        "name": b["name"],
        "kind": b["kind"],
        "label": b["label"],
        "tag": b["tag"],
        "before": text[: b["start"]],
        "head": text[b["start"] : b["bodyStart"]],
        "body": text[b["bodyStart"] : b["bodyEnd"]],
        "tail": text[b["bodyEnd"] : b["end"]],
        "after": text[b["end"] :],
    }


def validate_block_body(body: str, *, name: str = "") -> None:
    """新 body 的入闸。三条，全部 fail-closed。

    1. **不许含块标记**（抄 grok 的 `item {} contains marker-like content`）：
       body 里写 ``data-block`` 就能凭空长出一块、或者把自己劈成两块，
       下一次 slice 拿到的边界就不是这一块了。
    2. **标签必须自平衡**：多一个闭合标签就会把外层的块提前关掉，改完那一页
       的后半段全被吸进这一块里——闸全绿、页面塌了，本仓最忌的形状。
    3. **不许带脚本**：消毒在前端，但脚本不该先落进库里。
    """
    text = body or ""
    who = f"「{name}」" if name else ""
    if BLOCK_MARK_ATTR in text:
        raise BlockEditError(f"块{who}的新内容里出现了 {BLOCK_MARK_ATTR}，会把块的边界劫走")
    if re.search(r"<\s*script\b", text, re.I):
        raise BlockEditError(f"块{who}的新内容里有 <script>")
    depth = 0
    for m in _TAG_RE.finditer(_blank_comments(text)):
        closing, tag, _body, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if tag in _VOID_TAGS or selfclose:
            continue
        if closing:
            depth -= 1
            if depth < 0:
                raise BlockEditError(f"块{who}的新内容多了一个 </{tag}>，会把这一块提前关掉")
        else:
            depth += 1
    if depth != 0:
        raise BlockEditError(f"块{who}的新内容有 {depth} 个标签没闭合")


def replace_block(markup: str, name: str, new_body: str) -> str:
    """只换这一块的 body，其余原样拼回。

    ⚠ 换完**不重新打标**：名字不变，画布上选中的还是同一块。
    """
    validate_block_body(new_body, name=name)
    cut = slice_block(markup, name)
    return cut["before"] + cut["head"] + (new_body or "") + cut["tail"] + cut["after"]


def replace_blocks(markup: str, bodies: Dict[str, str]) -> str:
    """批量换。逐块走 replace_block，任何一块不合格整批不落（fail-closed）。"""
    out = markup or ""
    for name, body in (bodies or {}).items():
        out = replace_block(out, name, body)
    return out


def block_summary(markup: str) -> List[Dict[str, Any]]:
    """给画布/日志看的轻量清单：只有身份，不带正文，也不带偏移。"""
    return [
        {"name": b["name"], "kind": b["kind"], "label": b["label"], "tag": b["tag"]}
        for b in scan_blocks(markup)
    ]
