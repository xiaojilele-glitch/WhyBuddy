"""壳里那两样**本该按页变**的东西：面包屑与激活态（2026-08-15）。

外壳统一是整段复制 `<header>`/`<aside>`，于是壳里的东西必然各页相同——
可面包屑最后一节和导航激活态**本来就该各页不同**。真机（汽修那趟）：
p3 是库存明细页，面包屑却写「首页 › 服务接车」，侧栏也看不出当前页在哪。

## ⚠ 这里连着栽了三跤，每一跤都由下面某条用例钉着

### ① 正则吞掉了整个面包屑

第一版用「负向前瞻找最后一个 `<li>`」：

    (<li\\b[^>]*>)([\\s\\S]*?)(</li>)(?![\\s\\S]*<li\\b)

惰性组会一路吞到最后一个 `</li>`，等于从**第一个** li 替换到末尾。
真机上当场把「首页 ›」连同分隔符一起吃掉，面包屑只剩当前页一节。
改成 finditer 取最后一个 match。

### ② 把 hover 样式当成了激活样式

`nav_templates` 原来拿「独有 class 词最多的链接」当激活链接，结果认到的是
`hover:bg-slate-50`——悬停样式，鼠标不放上去零差别。于是 aria-current 打对了、
判据也绿了，界面上却看不出当前页。**又一次「闸绿了但功能没生效」。**

### ③ 剔掉变体之后还是判错

改成只看不带冒号的稳定 class，认到了 `text-slate-600`，而基座是
`text-slate-700`——两个都是灰，肉眼同样没差。

**「这个 class 够不够显眼」机械判不了**，而判错的代价是当前页毫无标记。
所以最后不判了：无条件注入一条挂在 `aria-current="page"` 上的兜底样式。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    extract_shell,
    nav_templates,
    set_breadcrumb_current,
    set_breadcrumb_root,
    unify_shell,
)

_CRUMB = (
    '<header class="h-16">'
    '<nav aria-label="Breadcrumb"><ol>'
    "<li>首页</li>"
    '<li><svg class="w-4 h-4"></svg></li>'
    '<li class="font-medium">服务接车</li>'
    "</ol></nav></header>"
)


def _crumb_text(header: str) -> str:
    nav = re.search(r'<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?</nav>', header)
    return " ".join(re.sub(r"<[^>]+>", " ", nav.group(0)).split()) if nav else ""


class Test面包屑最后一节跟着页面走:
    def test_换掉最后一节(self):
        out = set_breadcrumb_current(_CRUMB, "库存明细与调拨页")
        assert "库存明细与调拨页" in out and "服务接车" not in out

    def test_前面的层级不许被吃掉(self):
        """★ **踩过的第一跤**：惰性组一路吞到最后一个 </li>，
        把「首页」和分隔符 svg 一起替换没了。"""
        out = set_breadcrumb_current(_CRUMB, "库存明细与调拨页")
        assert "首页" in out, "层级前缀被吃了"
        assert "<svg" in out, "分隔符被吃了"
        assert _crumb_text(out) == "首页 库存明细与调拨页"

    def test_li_的_class_保留(self):
        """只换文本，不动那一节的样式。"""
        out = set_breadcrumb_current(_CRUMB, "新页")
        assert '<li class="font-medium">新页</li>' in out

    def test_没有面包屑就原样返回(self):
        h = '<header class="h-16"><span>顶栏</span></header>'
        assert set_breadcrumb_current(h, "新页") == h

    def test_页名为空时不动(self):
        assert set_breadcrumb_current(_CRUMB, "") == _CRUMB

    def test_页名里的尖括号被转义(self):
        out = set_breadcrumb_current(_CRUMB, "<script>x</script>")
        assert "<script>" not in out and "&lt;script&gt;" in out

    def test_真的接进了_unify_shell(self):
        """⚠ **变异测试逼出来的一条**：上面几条全在直接调函数，
        把 `set_breadcrumb_current(...)` 从 unify_shell 里整行删掉，
        它们**一条都不红**——等于函数写对了却没接线，真机上毫无作用。

        同样的教训在 test_page_foreign_references 里写过一次，这里自己漏了。
        判据必须有一条**走完整条路**。
        """
        page = (
            "<!doctype html><html><head></head><body>"
            '<aside class="w-64"><nav><a class="flex">甲</a><a class="flex">乙</a></nav></aside>'
            + _CRUMB
            + '<main class="flex-1"><div>正文</div></main></body></html>'
        )
        spec = {"pages": [{"id": "p1", "name": "工单派工台"}, {"id": "p2", "name": "配件库存页"}]}
        out = unify_shell({"p1": page, "p2": page}, spec)["pages"]
        assert _crumb_text(extract_shell(out["p1"])["header"]) == "首页 工单派工台"
        assert _crumb_text(extract_shell(out["p2"])["header"]) == "首页 配件库存页"


class Test面包屑套话根换成产品名:
    """2026-08-20 满电青年：Header 写着「通用后台 / 运营地图首页」。"""

    _GENERIC = (
        '<header class="h-16">'
        '<nav aria-label="Breadcrumb"><ol>'
        "<li>通用后台</li>"
        '<li class="font-medium">运营地图首页</li>'
        "</ol></nav></header>"
    )

    def test_通用后台换成产品名(self):
        out = set_breadcrumb_root(self._GENERIC, "满电青年")
        assert "通用后台" not in out
        assert "满电青年" in out
        assert "运营地图首页" in out

    def test_真IA第一级不动(self):
        real = (
            '<header><nav aria-label="Breadcrumb"><ol>'
            "<li>充电业务</li>"
            "<li>运营地图首页</li>"
            "</ol></nav></header>"
        )
        assert set_breadcrumb_root(real, "满电青年") == real

    def test_首页那种合法根不动(self):
        out = set_breadcrumb_root(_CRUMB, "满电青年")
        assert "首页" in out
        assert "满电青年" not in out

    def test_宿主品牌根换成产品名(self):
        """⚠ 2026-08-21：模型把面包屑第一级写成「面团AI系统」。"""
        src = (
            '<header class="h-16">'
            '<nav aria-label="Breadcrumb"><ol>'
            "<li>面团AI系统</li>"
            '<li class="font-medium">首页</li>'
            "</ol></nav></header>"
        )
        out = set_breadcrumb_root(src, "内容雷达")
        assert "面团AI系统" not in out
        assert "内容雷达" in out
        assert "首页" in out

    def test_走unify_shell(self):
        page = (
            "<!doctype html><html><head></head><body>"
            '<aside class="w-64"><nav><a class="flex">甲</a><a class="flex">乙</a></nav></aside>'
            + self._GENERIC
            + '<main class="flex-1"><div>正文</div></main></body></html>'
        )
        spec = {
            "appName": "满电青年",
            "pages": [
                {"id": "p1", "name": "运营地图首页"},
                {"id": "p2", "name": "我的工作台"},
            ],
        }
        out = unify_shell({"p1": page, "p2": page}, spec)["pages"]
        h1 = extract_shell(out["p1"])["header"]
        assert "通用后台" not in h1
        assert "满电青年" in h1
        assert "运营地图首页" in h1


class Test激活态识别不许被状态变体骗:
    def test_hover_不算激活样式(self):
        """★ **踩过的第二跤**：唯一差别是 hover:bg-slate-50，静态下零差别。"""
        nav = (
            '<nav><a class="flex px-4 hover:bg-slate-50">甲</a>'
            '<a class="flex px-4">乙</a><a class="flex px-4">丙</a></nav>'
        )
        t = nav_templates(nav)
        assert "hover:bg-slate-50" not in t["active_class"], "把悬停样式当激活了"

    @pytest.mark.parametrize("v", ["focus:ring-2", "dark:bg-black", "md:flex", "group-hover:text-white"])
    def test_各种变体都不算(self, v):
        nav = f'<nav><a class="flex {v}">甲</a><a class="flex">乙</a></nav>'
        assert v not in nav_templates(nav)["active_class"]

    def test_真的激活样式要认出来(self):
        """⚠ 反向：剔变体不能把**真**的激活样式也剔掉。"""
        nav = (
            '<nav><a class="flex px-4 bg-blue-600 text-white">甲</a>'
            '<a class="flex px-4">乙</a></nav>'
        )
        t = nav_templates(nav)
        assert "bg-blue-600" in t["active_class"] and "text-white" in t["active_class"]


class Test兜底样式无条件注入:
    """⚠ **本文件最要紧的一组**。踩过的第三跤：剔掉变体之后认到
    `text-slate-600`，而基座是 `text-slate-700`——两个都是灰，肉眼没差。

    「够不够显眼」机械判不了，判错的代价是当前页毫无标记。所以不判了，
    一律注入。把它改回「只在认不出激活样式时注入」，下面这条会红。
    """

    def _pages(self):
        aside = (
            '<aside class="w-64"><nav>'
            '<a class="flex px-4 text-slate-700">甲</a>'
            '<a class="flex px-4 text-slate-600">乙</a></nav></aside>'
        )
        page = (
            "<!doctype html><html><head></head><body>"
            + aside
            + '<main class="flex-1"><div>正文</div></main></body></html>'
        )
        return {"p1": page, "p2": page}

    def test_即使能认出激活class也照样注入(self):
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        out = unify_shell(self._pages(), spec)["pages"]
        for pid, html in out.items():
            assert 'aria-current="page"]{' in html, f"{pid} 没有兜底样式"

    def test_兜底样式用_currentColor_派生(self):
        """⚠ 侧栏可能白底也可能深色底（真机两种都见过）。
        写死 `bg-slate-100` 在深色侧栏上等于没有。"""
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        html = unify_shell(self._pages(), spec)["pages"]["p1"]
        assert "currentColor" in html
        assert "aside [aria-current=\"page\"]" in html
        assert "Breadcrumb" in html

    def test_只注入一次(self):
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        html = unify_shell(self._pages(), spec)["pages"]["p1"]
        # 侧栏一条 + 面包屑一条。改回全局 `[aria-current="page"]` 会把面包屑涂白。
        assert html.count('aria-current="page"]{') == 2

    def test_当前页真的带_aria_current(self):
        """兜底样式挂在 aria-current 上，那这个属性必须真的打上——
        否则样式再对也落不到任何元素上。"""
        spec = {"pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}]}
        out = unify_shell(self._pages(), spec)["pages"]
        nav = extract_shell(out["p2"])["aside"]
        cur = re.findall(r'<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)</a>', nav)
        assert len(cur) == 1 and "乙" in cur[0]
