# -*- coding: utf-8 -*-
"""精修时冻住 data-* 绑定孔。

SEARCH/REPLACE 常把 ``<tbody data-rows>`` 或行模板上的 ``data-field`` 改丢，
运行时就没了克隆行的洞。2026-08-31 会聚通那次：now-line 抢了第一个子元素，
运行时按实体数克隆红线、房间行被擦掉——同一类「孔还在源码里、运行时对不上」。

逻辑抄 idiomorph（MIT，bigskysoftware/idiomorph）的两步：
  1. 按树路径对齐同名标签（软匹配）；对不上再按 bind 身份（data-rows 等）对齐
  2. 同步属性

方向相反：新 HTML 是正文，旧节点上的 bind 属性如果被改丢了就补回去。
不复制 idiomorph 源码。

元素整段删了（路径对不上、身份也对不上）不复活——那是用户要拿掉这块。
"""

from __future__ import annotations

from html.parser import HTMLParser
from typing import Dict, List, Optional, Tuple

#: 运行时认的孔。跟 html_bindings / page_blocks 那几份对过，不另发明。
BIND_ATTRS = (
    "data-rows",
    "data-record",
    "data-field",
    "data-value",
    "data-chart",
    "data-action",
    "data-entity",
    "data-sort",
    "data-order",
    "data-limit",
    "data-aggregate",
    "data-dimension",
    "data-metric",
    "data-cell",
)

#: 用来认「还是同一个孔」的身份键。路径对不上时靠它。
_IDENTITY = ("data-rows", "data-record", "data-field", "data-value", "data-chart")

_VOID = frozenset(
    "area base br col embed hr img input link meta param source track wbr".split()
)


def _index_from_pos(text: str, lineno: int, offset: int) -> int:
    """HTMLParser.getpos 是 (1-based line, 0-based col)。"""
    if lineno <= 1:
        return min(offset, len(text))
    lines = text.splitlines(keepends=True)
    return min(sum(len(line) for line in lines[: lineno - 1]) + offset, len(text))


class _Index(HTMLParser):
    """扫出每个开标签的路径、属性、在原文里的开标签区间。"""

    def __init__(self, text: str) -> None:
        super().__init__(convert_charrefs=True)
        self.text = text
        self.nodes: List[Dict[str, object]] = []
        self._stack: List[str] = []
        self._counts: List[Dict[str, int]] = [{}]

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag_l = tag.lower()
        counts = self._counts[-1]
        idx = counts.get(tag_l, 0)
        counts[tag_l] = idx + 1
        path = "/".join(self._stack + [f"{tag_l}[{idx}]"])
        ad = {str(k).lower(): ("" if v is None else str(v)) for k, v in attrs}
        line, col = self.getpos()
        start = _index_from_pos(self.text, line, col)
        end = _tag_end(self.text, start)
        self.nodes.append(
            {"path": path, "tag": tag_l, "attrs": ad, "start": start, "end": end}
        )
        if tag_l not in _VOID:
            self._stack.append(f"{tag_l}[{idx}]")
            self._counts.append({})

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        while self._stack:
            last = self._stack.pop()
            if self._counts:
                self._counts.pop()
            if last.startswith(tag_l + "["):
                break

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        # HTMLParser 默认就是 start + end。覆盖时只开不关，SVG
        # ``<path />`` 不是 HTML void，进栈不出，后一个图标套进前一个
        # （2026-09-01 冻洞）。void 已经在 handle_starttag 里不入栈，
        # 再调 handle_endtag 会把父级弹掉。
        self.handle_starttag(tag, attrs)
        if tag.lower() not in _VOID:
            self.handle_endtag(tag)


def _tag_end(text: str, start: int) -> int:
    """从 ``<`` 找到这个开标签的 ``>``，属性值里的 ``>`` 不算。"""
    i = start
    n = len(text)
    quote = ""
    while i < n:
        ch = text[i]
        if quote:
            if ch == quote:
                quote = ""
        elif ch in ('"', "'"):
            quote = ch
        elif ch == ">":
            return i + 1
        i += 1
    return n


def _scan(html: str) -> List[Dict[str, object]]:
    parser = _Index(html or "")
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        return []
    return parser.nodes


def freeze_bind_holes(prev_html: str, new_html: str) -> str:
    """把上一版还在、这一版改丢的 data-* 孔补回去。挂了返回原文（fail-open）。"""
    if not (prev_html or "").strip() or not (new_html or "").strip():
        return new_html
    try:
        return _freeze(prev_html, new_html)
    except Exception as exc:  # noqa: BLE001 — 冻孔是增强，不许拖精修
        print(f"[bind_hole_freeze] 冻孔失败（不拦精修）：{str(exc)[:160]}")
        return new_html


def _freeze(prev_html: str, new_html: str) -> str:
    old_nodes = _scan(prev_html)
    new_nodes = _scan(new_html)
    if not old_nodes or not new_nodes:
        return new_html

    new_by_path = {str(n["path"]): n for n in new_nodes}
    new_by_id: Dict[Tuple[str, str, str], Dict[str, object]] = {}
    for n in new_nodes:
        attrs = n["attrs"]  # type: ignore[assignment]
        assert isinstance(attrs, dict)
        for key in _IDENTITY:
            val = str(attrs.get(key) or "").strip()
            if val:
                new_by_id.setdefault((str(n["tag"]), key, val), n)

    # (new_start, attr, value) 同一开标签上的补丁按 start 归组
    grouped: Dict[int, List[Tuple[str, str]]] = {}
    seen_on_node: Dict[int, set] = {}

    def _want(node: Dict[str, object], attr: str, value: str) -> None:
        start = int(node["start"])
        attrs = node["attrs"]
        assert isinstance(attrs, dict)
        if str(attrs.get(attr) or "").strip():
            return
        bag = seen_on_node.setdefault(start, set())
        if attr in bag:
            return
        bag.add(attr)
        grouped.setdefault(start, []).append((attr, value))
        attrs[attr] = value

    for old in old_nodes:
        old_attrs = old["attrs"]
        assert isinstance(old_attrs, dict)
        bind = {
            k: str(v)
            for k, v in old_attrs.items()
            if k in BIND_ATTRS and str(v or "").strip()
        }
        if not bind:
            continue
        matched: Optional[Dict[str, object]] = None
        cand = new_by_path.get(str(old["path"]))
        if cand and cand["tag"] == old["tag"]:
            matched = cand
        if matched is None:
            for key in _IDENTITY:
                val = str(old_attrs.get(key) or "").strip()
                if not val:
                    continue
                ident = new_by_id.get((str(old["tag"]), key, val))
                if ident:
                    matched = ident
                    break
        if matched is None:
            continue
        for attr, value in bind.items():
            _want(matched, attr, value)

    if not grouped:
        return new_html

    out = new_html
    for start in sorted(grouped, reverse=True):
        end = None
        for n in new_nodes:
            if int(n["start"]) == start:
                end = int(n["end"])
                break
        if not end or end <= start:
            continue
        open_tag = out[start:end]
        extra = "".join(
            f' {attr}="{_esc_attr(val)}"' for attr, val in grouped[start]
        )
        if open_tag.endswith("/>"):
            open_tag = open_tag[:-2] + extra + " />"
        elif open_tag.endswith(">"):
            open_tag = open_tag[:-1] + extra + ">"
        else:
            continue
        out = out[:start] + open_tag + out[end:]
    return out


def _esc_attr(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
    )
