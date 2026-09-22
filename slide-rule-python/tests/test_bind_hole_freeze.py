# -*- coding: utf-8 -*-
"""精修时冻住 data-* 绑定孔（2026-08-31）。

SEARCH/REPLACE 常把 ``data-rows`` / 行模板上的 ``data-field`` 改丢，
运行时就没了克隆行的洞。逻辑抄 idiomorph（MIT）的两步匹配，方向相反：
新 HTML 是正文，旧节点上的 bind 属性如果被改丢了就补回去。

元素整段删了不复活——那是用户要拿掉这块。
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

from services.bind_hole_freeze import _Index, _scan, freeze_bind_holes
from services import spec_page_html as sph


def _code(src: str) -> str:
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


PREV = (
    '<table><tbody data-rows="room" data-sort="asc">'
    '<tr data-field="name"><td data-value="title">会议室 A</td></tr>'
    "</tbody></table>"
)


def test_改丢的data_rows补回去():
    new = PREV.replace(' data-rows="room"', "")
    assert "data-rows" not in new
    out = freeze_bind_holes(PREV, new)
    assert 'data-rows="room"' in out
    assert "会议室 A" in out


def test_身份对上时顺带补回兄弟bind属性():
    """路径变了（外面多包一层），靠 data-rows 认还是同一张表，data-sort 也要回来。"""
    new = (
        '<div><table><tbody data-rows="room">'
        "<tr><td>会议室 A</td></tr>"
        "</tbody></table></div>"
    )
    out = freeze_bind_holes(PREV, new)
    assert 'data-rows="room"' in out
    assert 'data-sort="asc"' in out


def test_整段删了不复活():
    """用户把表拿掉了，不许把旧 tbody 再塞回来。"""
    new = "<main><p>改成卡片了</p></main>"
    assert freeze_bind_holes(PREV, new) == new


def test_已经有的孔不覆盖():
    """新稿写了另一个 data-rows，以新稿为准。"""
    new = PREV.replace('data-rows="room"', 'data-rows="desk"')
    out = freeze_bind_holes(PREV, new)
    assert 'data-rows="desk"' in out
    assert 'data-rows="room"' not in out


def test_空输入原样返回():
    assert freeze_bind_holes("", "<p>x</p>") == "<p>x</p>"
    assert freeze_bind_holes(PREV, "") == ""


def test_精修局部改真的冻孔():
    """函数写对 ≠ 接在 SEARCH/REPLACE 之后。把调用删掉本条必须红。"""
    src = inspect.getsource(sph.edit_page_html)
    code = _code(src)
    assert "freeze_bind_holes(prev_html, cleaned)" in code
    assert "guidelines_gate_notes" in code


def test_整页重画也冻孔():
    src = inspect.getsource(sph.generate_pages_parallel)
    code = _code(src)
    assert "freeze_bind_holes(prev, str(drawn" in code


def test_validate不因对比不够变严():
    """交付闸只记不拦。拿浅字浅底去撞 validate，必须仍过。"""
    html = (
        "<!doctype html><html><head>"
        '<script src="https://cdn.tailwindcss.com"></script></head>'
        '<body class="bg-white"><p class="text-gray-200">浅字</p></body></html>'
    )
    assert sph.validate_page_html(html) == []
    assert any("对比" in n for n in sph.guidelines_gate_notes(html))


def test_svg自闭合path是兄弟不是套层():
    """``<path />`` 不是 HTML void。handle_startendtag 只开不关时，
    第二个 path 变成 svg[0]/path[0]/path[0]，冻孔对错节点。

    ⚠ 表冻孔测例全是 ``<tr>``，``</svg>`` 会把卡住的 path 弹掉，
    表格碰巧还能对上——判据必须盯图标本身。
    """
    html = '<svg><path d="M1"/><path d="M2"/></svg>'
    paths = [n for n in _scan(html) if n["tag"] == "path"]
    assert [n["path"] for n in paths] == ["svg[0]/path[0]", "svg[0]/path[1]"]


def test_两个图标各自补回自己的data_field():
    """旧稿 ``<path />``、新稿 ``<path></path>``。套层时两边树形不一样，
    第二个 data-field 对不上就被丢掉——两边都自闭合时路径碰巧还能对上。
    """
    prev = (
        '<svg><path data-field="home" d="M1"/><path data-field="user" d="M2"/></svg>'
    )
    new = '<svg><path d="M1"></path><path d="M2"></path></svg>'
    out = freeze_bind_holes(prev, new)
    home = re.search(r"<path\b[^>]*>", out)
    rest = out[home.end() :] if home else ""
    second = re.search(r"<path\b[^>]*>", rest)
    assert home and 'data-field="home"' in home.group(0)
    assert second and 'data-field="user"' in second.group(0)
    assert 'data-field="user"' not in home.group(0)


def test_成对path结束标签不许把svg弹出():
    """把 path 加进 _VOID 会让 ``</path>`` 误弹父级。g 必须仍在 svg 下。"""
    html = '<svg><path data-field="a"></path><g data-field="b"></g></svg>'
    nodes = {n["tag"]: n for n in _scan(html)}
    assert nodes["g"]["path"] == "svg[0]/g[0]"
    assert nodes["path"]["path"] == "svg[0]/path[0]"


def test_自闭合非void会出栈():
    """只写行为测例、不盯调用，会让 handle_startendtag 继续只开不关。"""
    src = inspect.getsource(_Index.handle_startendtag)
    code = _code(src)
    assert "handle_endtag" in code


def test_冻孔模块是叶子不依赖services():
    """util 层。从别的 services 进口会把冻孔拖进环。"""
    src = Path(sph.__file__).resolve().parents[0].joinpath("bind_hole_freeze.py").read_text(
        encoding="utf-8"
    )
    assert "from services." not in src
    assert "from ." not in src
