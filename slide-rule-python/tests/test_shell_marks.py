"""壳节点自报家门：`data-shell`（2026-08-22）。

## 病灶（实测，不是设想）

统一菜单这一步（``unify_shell``）**自己把 header/aside/nav 放进每一页**——
它百分之百知道哪个节点是壳。可下游两层都不问它，各自拿 CSS 猜：

  · 主题锁   ``header,aside,nav.fixed``  → **26/26 手机页的 <nav> 都不带
    ``.fixed``，命中 0**。手机底栏一次都没被染到，而同一份 CSS 里那条
    ``html,body{...!important}`` 却把 53/53 页的整页底色全改了（8 页深浅
    整个翻转，黑底白字被刷成白底白字）。**该管的漏光，不该管的全中。**
  · 间距契约 ``aside[class*="fixed"]:has(nav a)~*{margin-left:16rem}``
    ——同样是猜，而且这条住在 theme_tokens.py 里，跟 page_shell 那半劈成
    两个文件（"改一半必然静默失效"的温床）。

## 做法

照 shadcn/ui sidebar 的路子：它用 ``data-slot="sidebar"`` /
``data-sidebar="header"`` 标记功能区，宽度走 ``--sidebar-width`` 变量，
主体靠 peer-data 选择器让位——**没有一处是从 class 子串反推语义的**。
我们更省：壳是自己生成的，标直接打上去，不用求模型配合。

属性名用 ``data-shell`` 而不是 ``data-slot``：模型抄 shadcn 代码时会带
``data-slot``，撞上就分不清是我们打的还是它抄来的。

## 这份用例守两头

  · 正向：桌面 aside/header/main、手机 header/nav/main 都得带标
  · **反向**：面包屑那个 <nav> 住在 <header> 里，**不许**被打成底栏；
    main 里的普通 div 也不许沾上。只打正向的话，「全都打上标」同样能过。
"""

from __future__ import annotations

import re

import pytest

from services.page_shell import SHELL_MARK_ATTR, mark_shell_parts, unify_shell


def desktop_page(brand: str, items: list[str]) -> str:
    links = "\n".join(f'<a class="nav-item" href="#"><span>{t}</span></a>' for t in items)
    return f"""<!DOCTYPE html><html lang="zh-CN"><body>
<aside class="w-64"><div class="brand">{brand}</div><nav>{links}</nav></aside>
<header class="h-14"><nav aria-label="Breadcrumb"><ol><li><a href="#">{brand}</a></li>
<li><a href="#" aria-current="page">当前页</a></li></ol></nav></header>
<main class="p-6"><div class="card">正文</div></main></body></html>"""


def phone_page(brand: str, items: list[str]) -> str:
    links = "\n".join(f'<a class="tab" href="#"><span>{t}</span></a>' for t in items)
    return f"""<!DOCTYPE html><html lang="zh-CN"><body class="flex flex-col h-full">
<header class="flex-shrink-0"><span>{brand}</span>
<nav aria-label="Breadcrumb"><ol><li><a href="#" aria-current="page">当前页</a></li></ol></nav>
</header>
<main class="flex-1"><div class="card">正文</div></main>
<nav class="flex-shrink-0 flex justify-around items-center">{links}</nav></body></html>"""


SPEC = {
    "appName": "智维工单",
    "personas": [{"name": "维修主管"}],
    "pages": [{"id": "p1", "name": "工单看板"}, {"id": "p2", "name": "我的任务"}],
}


def marks(html: str) -> list[tuple[str, str]]:
    """(标签名, 标值) —— 按出现顺序。"""
    out = []
    for m in re.finditer(r"<(\w+)\b[^>]*\bdata-shell=\"([^\"]*)\"", html, re.I):
        out.append((m.group(1).lower(), m.group(2)))
    return out


class Test桌面壳打标:
    def setup_method(self):
        self.out = unify_shell(
            {"p1": desktop_page("智维工单", ["工作台", "工单"]),
             "p2": desktop_page("维保云", ["首页", "报表"])},
            SPEC,
            device="desktop",
        )["pages"]

    def test_每页的_aside_header_main_都带标(self):
        for pid, html in self.out.items():
            got = dict(marks(html))
            assert got.get("aside") == "aside", f"{pid} 侧栏没打标：{marks(html)}"
            assert got.get("header") == "header", f"{pid} 顶栏没打标：{marks(html)}"
            assert got.get("main") == "main", f"{pid} 主体没打标：{marks(html)}"

    def test_面包屑不许被当成底栏打标(self):
        """⚠ 面包屑是 <nav aria-label="Breadcrumb">，住在 <header> 里。

        之前拿 `navs[0]` 读菜单时我就被它坑过一次——把面包屑当成菜单，
        得出「菜单跟会话对不上」的错误结论。打标这里同样不能碰它。
        """
        for pid, html in self.out.items():
            for m in re.finditer(r"<nav\b[^>]*>", html, re.I):
                tag = m.group(0)
                if "breadcrumb" in tag.lower():
                    assert SHELL_MARK_ATTR not in tag, f"{pid} 把面包屑打成壳了：{tag}"

    def test_main_里面的普通节点不许沾标(self):
        for pid, html in self.out.items():
            assert 'class="card" data-shell' not in html
            assert marks(html).count(("div", "main")) == 0, pid


class Test手机壳打标:
    def setup_method(self):
        self.out = unify_shell(
            {"p1": phone_page("铁血打卡", ["训练", "记录"]),
             "p2": phone_page("打卡宝", ["首页", "我的"])},
            SPEC,
            device="phone",
        )["pages"]

    def test_每页的_header_nav_main_都带标(self):
        for pid, html in self.out.items():
            got = dict(marks(html))
            assert got.get("header") == "header", f"{pid} 顶栏没打标：{marks(html)}"
            assert got.get("main") == "main", f"{pid} 主体没打标：{marks(html)}"
            assert got.get("nav") == "nav", f"{pid} 底栏没打标：{marks(html)}"

    def test_底栏打的是页面级那个_不是面包屑(self):
        """这条正对着「命中 0」那个病：真机 26/26 页的底栏都不带 .fixed，
        靠 CSS 猜必然漏。标必须**恰好**落在底栏上。"""
        for pid, html in self.out.items():
            navs = re.findall(r"<nav\b[^>]*>", html, re.I)
            marked = [t for t in navs if SHELL_MARK_ATTR in t]
            assert len(marked) == 1, f"{pid} 打了 {len(marked)} 个 nav 标：{navs}"
            assert "breadcrumb" not in marked[0].lower()


class Test打标函数本身:
    SRC = (
        '<body><header class="h">顶</header><aside class="a"><nav>菜单</nav></aside>'
        '<main class="m"><div>正文</div></main>'
        '<nav class="bottom flex justify-around items-center">底</nav></body>'
    )

    def test_幂等_跑两次不会打两遍(self):
        once = mark_shell_parts(self.SRC, device="desktop")
        twice = mark_shell_parts(once, device="desktop")
        assert once == twice
        assert once.count(SHELL_MARK_ATTR) == twice.count(SHELL_MARK_ATTR)

    def test_已有的_data_shell_不被覆盖(self):
        pre = '<body><header data-shell="header" class="h">顶</header></body>'
        assert mark_shell_parts(pre, device="desktop").count(SHELL_MARK_ATTR) == 1

    def test_没有壳节点时原样返回(self):
        plain = "<body><div>只有正文</div></body>"
        assert mark_shell_parts(plain, device="desktop") == plain

    def test_注释里的壳不算(self):
        """⚠ 本仓踩过：unify 替换的 aside 困在 `<!-- 左侧导航 <aside` 里，
        截图没有侧栏。打标同样不能打进注释。"""
        src = '<body><!-- <aside class="old">旧的</aside> --><main>正文</main></body>'
        out = mark_shell_parts(src, device="desktop")
        assert 'class="old"' in out and f'class="old" {SHELL_MARK_ATTR}' not in out
        assert out.count(SHELL_MARK_ATTR) == 1  # 只有 main


class Test标插在开标签末尾:
    """⚠ 2026-08-22 当场踩到：第一版把标插在标签名后面，
    ``<nav class="bottom-bar">`` 变成 ``<nav data-shell="nav" class="bottom-bar">``，
    ``test_面包屑nav不是底栏`` 那条按 ``<nav class="bottom-bar"`` 抓的判据直接红。
    本仓大量正则都假设「第一个属性是 class」，标必须插在**末尾**。"""

    def test_class_仍然紧跟标签名(self):
        src = '<body><nav class="bottom-bar">底</nav><main class="m">正文</main></body>'
        out = mark_shell_parts(src, device="phone")
        assert '<nav class="bottom-bar"' in out
        assert '<main class="m"' in out
        assert 'data-shell="nav"' in out and 'data-shell="main"' in out

    def test_没有属性的标签也插得进去(self):
        out = mark_shell_parts("<body><header>顶</header></body>", device="phone")
        assert '<header data-shell="header">' in out
