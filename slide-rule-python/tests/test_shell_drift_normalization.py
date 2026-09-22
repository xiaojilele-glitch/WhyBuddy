"""外壳漂移判据的归一化：抹掉 data-* 与面包屑末节（2026-08-15）。

## 真机形状：一趟报了 2 条，两条全是把**正确行为**当故障

社区药店那趟（ouyi-5-preview，3 页交付），bind 后判据报：

    打孔后外壳漂移：aside — 3 种不同的 <aside>
    打孔后外壳漂移：header — 3 种不同的 <header>

逐字节比下来，两条都不是漂移：

**header**：抹平 aria-current 和 class 之后，三页**唯一**的差异是面包屑
末节的文字——「进货入库管理页」/「库存看板与效期监控」/「处方登记审计日志」。
那正是 `set_breadcrumb_current` **故意**逐页写的东西。修复越是正常工作，
这条警报叫得越响。

**aside**：bind 往侧栏那块登录人卡片打了合法的孔，三页打的位置深浅不同——

    p2: <div class="…" data-record="pharmacist"><div class="…">
    p3: <div class="…"><div class="…" data-record="pharmacist">
    p4: （没打）

## ⚠ 病根：同一个模块里两套归一化标准

`restore_shell_after_bind` **早就知道** data-* 不算漂移——它比指纹之前先
`_DATA_ATTR.sub("", …)`，还在文档里写明「判定标准是结构，不是原文」。
而 `check_shell_consistency` 不知道。**同一个文件里，一个函数知道的事情
另一个函数不知道**，于是同一批产出在第 6.5 步被判成「只加了孔，保留」，
在判据里被判成「三种不同的壳」。

所以这次把定位与归一化都收成一处（`_breadcrumb_current_span` /
`_drift_fingerprint`），而不是在第二处再抄一份判断。

## 抹掉什么，就得另开判据查什么

`shell_fingerprint` 的老注释写过这条纪律：抹平 aria-current 之后，
「全都不激活」和「标了三个」都会静静通过，所以另开了 nav.current。
这次抹掉面包屑末节，同样另开 `.breadcrumb`——否则「逐页改对」和
「压根没改、三页全是源页那一节」会一起绿。

⚠ 一道对正确行为报警的闸比没有闸更糟：它会训练人忽略它。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    blank_breadcrumb_current,
    breadcrumb_current_text,
    check_shell_consistency,
    shell_fingerprint,
)

SPEC = {"pages": [{"id": "p1", "name": "进货入库管理页"},
                  {"id": "p2", "name": "库存看板与效期监控"}]}


def _page(crumb: str, *, user_hole: str = "", menu: str = "库存看板与效期监控",
          brand: str = "库存管理") -> str:
    """一页真机形状的桌面页：横排 body + aside + header(面包屑) + main。"""
    return (
        '<!doctype html><html><head></head><body class="flex">'
        '<aside class="w-64"><nav>'
        '<a data-page-id="p1" aria-current="page"><span>进货入库管理页</span></a>'
        f'<a data-page-id="p2"><span>{menu}</span></a>'
        "</nav>"
        f'<div class="p-4"{user_hole}><img src="https://placehold.co/40x40">'
        "<span>张药师</span></div>"
        "</aside>"
        '<header class="h-16">'
        f'<nav aria-label="Breadcrumb"><ol><li><a href="/">{brand}</a></li>'
        f'<li><a href="./x" aria-current="page">{crumb}</a></li></ol></nav>'
        "</header>"
        '<main class="flex-1"><div>正文</div></main></body></html>'
    )


def _paths(problems):
    return sorted(p["path"] for p in problems)


class Test面包屑逐页不同不算漂移:
    """★ 真机报的第一条假警报。"""

    def test_各页面包屑不同_不报header漂移(self):
        pages = {"p1": _page("进货入库管理页"), "p2": _page("库存看板与效期监控")}
        assert "header" not in _paths(check_shell_consistency(pages, SPEC))

    def test_层级前缀被改_照旧报漂移(self):
        """⚠ 只抹**当前节**，不是抹整个面包屑。前面那几节是应用结构，
        本该各页一样——真被改了必须还能抓到，否则这次归一化就是把闸拆了。"""
        pages = {"p1": _page("进货入库管理页"),
                 "p2": _page("库存看板与效期监控", brand="欧亿药房")}
        assert "header" in _paths(check_shell_consistency(pages, SPEC))

    def test_blank只吃文字_标签和属性都留着(self):
        h = ('<header><nav aria-label="Breadcrumb"><ol><li><a href="/">库存管理</a></li>'
             '<li><a href="./x" aria-current="page">进货入库管理页</a></li></ol></nav></header>')
        out = blank_breadcrumb_current(h)
        assert "进货入库管理页" not in out
        assert "库存管理" in out, "把前面的层级也吃了"
        assert 'aria-current="page"' in out and 'href="./x"' in out


class Test抹掉了就得另开判据查:
    """⚠ **本文件最要紧的一组**。归一化把差异抹平之后，
    「逐页改对」和「压根没改」在指纹上长得一模一样。"""

    def test_三页面包屑一模一样_要报出来(self):
        """等于 set_breadcrumb_current 静静失效——真机上就是这么溜过去的：
        没有报错、没有告警、判据全绿，四页面包屑写着同一节。"""
        pages = {"p1": _page("进货入库管理页"), "p2": _page("进货入库管理页")}
        probs = check_shell_consistency(pages, SPEC)
        assert "p2.breadcrumb" in _paths(probs)

    def test_报错要说清哪页该是啥(self):
        pages = {"p1": _page("进货入库管理页"), "p2": _page("进货入库管理页")}
        msg = next(p["message"] for p in check_shell_consistency(pages, SPEC)
                   if p["path"] == "p2.breadcrumb")
        assert "进货入库管理页" in msg and "库存看板与效期监控" in msg

    def test_面包屑对了就不报(self):
        pages = {"p1": _page("进货入库管理页"), "p2": _page("库存看板与效期监控")}
        assert not [p for p in check_shell_consistency(pages, SPEC)
                    if p["path"].endswith(".breadcrumb")]

    def test_没有面包屑不算错(self):
        """⚠ 没有面包屑是合法版式，硬塞一个是新的破坏。
        但这里要小心：整页没有任何 <nav> 才算没有——侧栏那个 nav 在 aside 里，
        取 header 时本来就不该看见它。"""
        pages = {pid: _page("x").replace(
            re.search(r"<header[\s\S]*?</header>", _page("x")).group(0),
            '<header class="h-16"><span>顶栏</span></header>')
            for pid in ("p1", "p2")}
        assert not [p for p in check_shell_consistency(pages, SPEC)
                    if p["path"].endswith(".breadcrumb")]


class Testbind打的孔不算漂移:
    """★ 真机报的第二条假警报：侧栏登录人卡片被打了 data-record/data-field，
    三页打的位置深浅不同。"""

    def test_data属性位置不同_不报aside漂移(self):
        pages = {
            "p1": _page("进货入库管理页", user_hole=' data-record="pharmacist"'),
            "p2": _page("库存看板与效期监控", user_hole=""),
        }
        assert "aside" not in _paths(check_shell_consistency(pages, SPEC))

    def test_侧栏菜单真不同_照旧报漂移(self):
        """⚠ 反向：放开 data-* 不等于放开整个 aside。
        菜单名逐页不同是真事故（真机出过「同一个应用两套侧栏菜单」）。"""
        pages = {"p1": _page("进货入库管理页"),
                 "p2": _page("库存看板与效期监控", menu="发明出来的入口")}
        assert "aside" in _paths(check_shell_consistency(pages, SPEC))

    @pytest.mark.parametrize("hole,structural,label", [
        (' data-record="pharmacist"', False, "只多了个孔"),
        ("", True, "菜单名真的不一样"),
    ])
    def test_跟还原步同一套标准(self, hole, structural, label):
        """⚠ **这次的病根就是这两处标准不一致**——所以直接验「两边判得一样」。

        `restore_shell_after_bind` 判「bind 只是加了孔」→ 保留；
        判据这边就不该把同一份东西叫成「两种壳」。同一批产出上一步说保留、
        另一步说漂移，人只能学会忽略其中一个。

        ⚠ 第一版这条是去源码里 grep `_DATA_ATTR`——**它在文档字符串里也出现**，
          于是把那行代码删掉，这条测试照样绿。判据钉在散文上等于没钉。
        """
        from services.page_shell import restore_shell_after_bind

        before = {"p2": _page("库存看板与效期监控")}
        after = {"p2": _page("库存看板与效期监控", user_hole=hole,
                             menu="发明出来的入口" if structural else "库存看板与效期监控")}
        _, restored = restore_shell_after_bind(after, before)
        drifted = "aside" in _paths(check_shell_consistency(
            {"p1": _page("进货入库管理页"), "p2": after["p2"]}, SPEC))
        assert bool(restored) == structural, f"还原步判错了：{label}"
        assert drifted == structural, (
            f"两步标准不一致（{label}）：还原步 restored={restored}、"
            f"判据 drifted={drifted}"
        )


class Test读当前节:
    @pytest.mark.parametrize("crumb", ["进货入库管理页", "库存看板与效期监控"])
    def test_读回来的就是写进去的(self, crumb):
        assert breadcrumb_current_text(_page(crumb)) == crumb

    def test_没面包屑返回None(self):
        assert breadcrumb_current_text('<header><span>顶栏</span></header>') is None

    def test_实体被还原回来(self):
        """写的时候 escape 过，读的时候得 unescape，否则带 & 的页名永远判不等。"""
        h = ('<header><nav aria-label="Breadcrumb"><ol>'
             '<li><a aria-current="page">进货 &amp; 入库</a></li></ol></nav></header>')
        assert breadcrumb_current_text(h) == "进货 & 入库"


class Test归一化不许越界:
    def test_shell_fingerprint_本身不动文字(self):
        """⚠ 抹面包屑只在**比漂移**时做，不能塞进 shell_fingerprint——
        restore_shell_after_bind 也在用它，那一步要的是「bind 有没有动结构」，
        把文字抹了会让「bind 把面包屑改掉」这种真事故变得看不见。"""
        a = shell_fingerprint('<header><nav><li aria-current="page">甲</li></nav></header>')
        b = shell_fingerprint('<header><nav><li aria-current="page">乙</li></nav></header>')
        assert a != b
