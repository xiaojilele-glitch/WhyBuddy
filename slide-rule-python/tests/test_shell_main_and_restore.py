"""外壳漂移的两个来源，两处修法（2026-08-15）。

真机八趟八次都有外壳漂移。摊开看**来源是两个**，位置也不同：

    第 3 步生成    → <main> 容器每页一套（3.5 步的 unify_shell 不管这一层）
    第 6.5 步 bind → LLM 重写整页时把 aside/header 改了

## ⚠ 一：判据此前有盲区，报出来的是假绿

`check_shell_consistency` 只给 `<aside>`/`<header>` 打指纹，**不看承载它们的
那一层**。真机形状：

    header 指纹   p1/p2/p3/p4 完全相同（len=904）
    <main> class  p1/p2: flex-1 flex flex-col min-w-0 overflow-hidden
                  p3:    flex-1 flex flex-col min-w-0 bg-slate-50 relative
                  p4:    **ml-64** flex-1 flex flex-col

p4 已经靠 flex 排在 256px 侧栏右边，又叠 `ml-64` 的 256px，整个内容区右移
一屏——而 shellProblems=0。全仓 39 份产出量过：**8/8 批全中，三个模型全漏**
（luna 是 `ml-[236px]`/`ml-[244px]`/`ml-[248px]`，差几像素肉眼无感而已）。

## ⚠ 二：还原不能无脑全换

bind 也会往壳里打**合法**的绑定孔——34 份产出里 12 份有：

    <span data-value="booking" data-aggregate="count">今日已有 N 节排课</span>
    <button data-action="createRecord" data-entity="vaccine_plan">

无脑还原会把这些洗掉，页面退回死的静态壳。所以判定标准是**结构**：
抠掉 data-* 再比指纹，一致就说明 bind 只是加了孔，该保留。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    check_shell_consistency,
    main_offset_tokens,
    restore_shell_after_bind,
    strip_main_offset,
    unify_shell,
)

_ASIDE = (
    '<aside class="w-64"><div>炼动连锁云</div>'
    '<nav><a href="#p1">首页</a><a href="#p2">排期</a></nav></aside>'
)
_HEADER = '<header class="h-16"><span>顶栏</span></header>'


def _page(main_cls: str, *, aside: str = _ASIDE, header: str = _HEADER) -> str:
    return (
        f"<!doctype html><html><body>{aside}"
        f'<main class="{main_cls}"><div>正文</div></main>{header}</body></html>'
    )


class Test只管定位_不管版式:
    """⚠ **当天返工出来的一组**。

    第一版拿整个 `<main>` 的 class 当指纹，还让 unify_shell 把源页的整段
    class 抄给所有页。真机（烘焙那趟 p3）当场排炸：

        p1 main: flex-1 flex overflow-hidden …   子元素是左右两栏 section
        p3 main: 同上（抄来的）                   子元素是 header + 纵向内容

    `flex` 默认横向，p3 的纵向内容被横着排，文字竖排、整页不可用。
    加回 `flex-col` 就完全正常。

    根因：main 的 class 混着**相对侧栏的定位**（该一致）和**本页自己的版式**
    （必须不同）。抄整段 = 把源页的版式强加给别人。

    ⚠ 我当时拿 39 份历史产出验过「main 收敛到 1 种」——**指标绿了，页面废了**。
    """

    def _page(self, main_cls: str, body_cls: str = "flex") -> str:
        return (
            f'<!doctype html><html><head></head><body class="{body_cls}">'
            '<aside class="w-64"><nav><a class="flex">甲</a><a class="flex">乙</a></nav></aside>'
            f'<main class="{main_cls}"><div>正文</div></main></body></html>'
        )

    def test_双倍偏移被报出来(self):
        """★ 真机那个整屏右移 256px 的形状：body 是横向 flex，main 又加 ml-64。"""
        pages = {"p1": self._page("flex-1 flex flex-col"), "p2": self._page("ml-64 flex-1")}
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        paths = {p["path"] for p in check_shell_consistency(pages, spec)}
        assert "p2.main" in paths and "p1.main" not in paths

    def test_版式不同不算漂移(self):
        """⚠ **本组最要紧的一条**：一页左右分栏、一页上下堆叠，是**正常的**。
        把它报成漂移，就会有人照着去"修"，然后把页面排炸。"""
        pages = {
            "p1": self._page("flex-1 flex overflow-hidden"),
            "p2": self._page("flex-1 flex flex-col overflow-y-auto p-8"),
        }
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        assert [p for p in check_shell_consistency(pages, spec) if "main" in p["path"]] == []

    def test_body_不是横向flex时偏移是合法的(self):
        """侧栏用 fixed 定位时，内容区**必须**自己留 ml-64，那不是双倍偏移。"""
        pages = {"p1": self._page("ml-64 flex-1", body_cls="min-h-screen")}
        spec = {"pages": [{"id": "p1", "name": "甲"}]}
        assert [p for p in check_shell_consistency(pages, spec) if "main" in p["path"]] == []


class Test去掉多余偏移:
    def _page(self, main_cls: str, body_cls: str = "flex") -> str:
        return (
            f'<!doctype html><html><head></head><body class="{body_cls}">'
            '<aside class="w-64"></aside>'
            f'<main class="{main_cls}"><div>正文</div></main></body></html>'
        )

    def test_删掉偏移_其余class一个不动(self):
        out = strip_main_offset(self._page("ml-64 flex-1 flex flex-col overflow-hidden"))
        assert main_offset_tokens(out) == []
        for keep in ("flex-1", "flex", "flex-col", "overflow-hidden"):
            assert keep in out, f"{keep} 被误删了"

    def test_flex_col_不许被动(self):
        """★ 真机排炸就炸在这个词上。"""
        out = strip_main_offset(self._page("ml-64 flex-1 flex flex-col"))
        assert "flex-col" in out

    def test_body_不是横向flex时不动(self):
        src = self._page("ml-64 flex-1", body_cls="min-h-screen")
        assert strip_main_offset(src) == src

    def test_没有偏移时原样返回(self):
        src = self._page("flex-1 flex flex-col")
        assert strip_main_offset(src) == src

    def test_接进了_unify_shell(self):
        """⚠ 光有函数不算数——同 breadcrumb 那次的教训。"""
        pages = {"p1": self._page("ml-64 flex-1 flex flex-col"),
                 "p2": self._page("flex-1 flex flex-col")}
        pages = {k: v.replace("<aside class=\"w-64\"></aside>",
                              '<aside class="w-64"><nav><a class="flex">甲</a><a class="flex">乙</a></nav></aside>')
                 for k, v in pages.items()}
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        out = unify_shell(pages, spec)["pages"]
        assert main_offset_tokens(out["p1"]) == [], "偏移没被去掉——没接线？"
        assert "flex-col" in out["p1"], "版式被动了"


class Test还原bind改坏的壳:
    def test_结构被改的换回去(self):
        """★ 真机 p2.header / p5.aside 就是这个形状。"""
        before = {"p1": _page("flex-1")}
        after = {"p1": _page("flex-1", header='<header class="h-16"><span>换了个顶栏</span></header>')}
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == ["p1.header"]
        assert "换了个顶栏" not in fixed["p1"] and "顶栏" in fixed["p1"]

    def test_只加了绑定孔的要保留(self):
        """⚠ **本文件最要紧的一条**。真机 34 份里 12 份壳里有 data-*，
        无脑还原会把它们洗掉，页面退回死的静态壳。"""
        before = {"p1": _page("flex-1")}
        bound_header = (
            '<header class="h-16"><span data-value="booking" '
            'data-aggregate="count">顶栏</span></header>'
        )
        after = {"p1": _page("flex-1", header=bound_header)}
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == [], "只加了孔却被还原了——绑定被洗掉"
        assert 'data-value="booking"' in fixed["p1"]

    def test_原样没动的不碰(self):
        before = {"p1": _page("flex-1")}
        fixed, restored = restore_shell_after_bind(dict(before), before)
        assert restored == [] and fixed["p1"] == before["p1"]

    def test_同时改结构又加孔_按结构判(self):
        """边界：既动了结构又加了孔——结构优先，还原。
        代价是那个孔没了，但**错的版式比少一个孔严重**：
        版式错是用户一眼看见的，孔没了下一轮 bind 还能补。"""
        before = {"p1": _page("flex-1")}
        after = {
            "p1": _page(
                "flex-1",
                header='<header class="h-16"><b data-value="x">全新顶栏</b></header>',
            )
        }
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == ["p1.header"]
        assert "全新顶栏" not in fixed["p1"]

    def test_打孔前没有的页跳过(self):
        """bind 产出里多出一页时不该炸。"""
        fixed, restored = restore_shell_after_bind({"p9": _page("flex-1")}, {})
        assert restored == [] and "p9" in fixed
