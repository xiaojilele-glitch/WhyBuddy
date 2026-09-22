"""统一外壳依赖的自定义类，必须每页都在（2026-08-16 线上实测）。

## 这条防的是"同一段外壳在某一页样式崩掉"

真机证据 —— 会话 `sr-20260816095147`（「步伴 AI 拐杖」，四页桌面端）：

侧栏是**统一**的外壳，四页导航项都写着 `rounded-custom`。而每页的 `<style>`
是**各写各的**：

    p1  定义了 rounded-custom ✓（另外用了 ring-primary，无人定义）
    p2  **没有定义 rounded-custom** ✗   ← 那一页的菜单圆角失效
    p3  定义了 ✓
    p4  定义了 ✓

用户看到的就是"菜单的显示看着有问题"。

这不是运气问题。外壳一旦统一，它依赖的类名就成了**跨页契约**，而定义这些类
的 CSS 仍由每页的 LLM 各自即兴发挥——页数 × 类数一多，必然周期性复发。
所以补那一个类没有意义，要补的是"外壳自带它依赖的样式"这条机制。

## 为什么判据是"搬过去"而不是"有个值"

补一个 `border-radius:8px` 同样能让类存在，但那是**另一种设计**：p2 的圆角
会跟其它三页不一样。把一个显眼的 bug 换成一个不显眼的，不算修好。
所以下面第二条断言的是**值相同**，不只是"有定义"。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    shell_class_tokens,
    style_class_rules,
    unify_shell,
)

_SPEC = {
    "pages": [
        {"id": "p1", "name": "长辈守护实时看板"},
        {"id": "p2", "name": "紧急救援响应大屏"},
    ]
}


def _page(style_body: str, *, brand: str = "步伴守护云") -> str:
    """一页最小可用的桌面壳：aside 里的导航项用 rounded-custom。"""
    return f"""<!doctype html><html><head><style>
        body {{ background:#F8FAFC; }}
        {style_body}
    </style></head><body class="flex">
      <aside class="w-64 bg-white">
        <div class="p-6">{brand}</div>
        <nav>
          <a href="#p1" class="flex items-center p-3 rounded-custom bg-primary">长辈守护实时看板</a>
          <a href="#p2" class="flex items-center p-3 rounded-custom">紧急救援响应大屏</a>
        </nav>
      </aside>
      <main class="flex-1"><header><nav><span>首页</span><span>看板</span></nav></header></main>
    </body></html>"""


_ROUNDED = ".rounded-custom { border-radius: 14px; }"
_PRIMARY = ".bg-primary { background-color: #2D5CF7; }"


def _unify(p1_style: str, p2_style: str):
    return unify_shell({"p1": _page(p1_style), "p2": _page(p2_style)}, _SPEC)["pages"]


def test_the_page_missing_a_shell_class_gets_it():
    """p2 没写 rounded-custom → 统一之后必须有。这是主判据。"""
    pages = _unify(_ROUNDED + _PRIMARY, _PRIMARY)

    assert "rounded-custom" in shell_class_tokens(pages["p2"]), "前提没了：外壳本来就没用这个类"
    assert "rounded-custom" in style_class_rules(pages["p2"]), (
        "统一外壳用了 rounded-custom，而 p2 自己没定义、也没被补上 —— "
        "那一页的菜单样式就是崩的"
    )


def test_the_transplanted_value_matches_the_source_page():
    """搬过去的必须是**同一个值**，不是随手编的默认值。

    只断言"有定义"拦不住 `border-radius:8px` 这种自造值——那会让 p2 的圆角
    跟 p1 不一样，bug 从显眼变成不显眼。
    """
    pages = _unify(_ROUNDED + _PRIMARY, _PRIMARY)
    got = style_class_rules(pages["p2"])["rounded-custom"]
    assert "14px" in got, f"p2 拿到的是 {got!r}，跟 p1 的 14px 不是一套设计"


def test_a_class_nobody_defines_is_not_invented():
    """没有任何一页定义过的类，不许凭空造一个出来。

    真机上 `ring-primary` 就是这个情况（p1 用了、无人定义）。没有真相来源时
    编一个值，是拿"看起来对"冒充"是对的"；它照旧交给 Tailwind 运行时。
    """
    p1 = _page(_PRIMARY).replace('class="flex items-center p-3 rounded-custom bg-primary"',
                                 'class="flex items-center p-3 ring-primary bg-primary"')
    pages = unify_shell({"p1": p1, "p2": _page(_PRIMARY)}, _SPEC)["pages"]
    for pid in ("p1", "p2"):
        assert "ring-primary" not in style_class_rules(pages[pid]), (
            f"{pid} 被塞了一个没人定义过的 ring-primary"
        )


def test_a_page_that_defines_it_keeps_its_own_value():
    """本页自己写了同名类 → 本页那条要赢。这一段只填空，不覆盖。

    做法是把补的 <style> 插在页面自己那块**之前**，靠 CSS 后来者胜。
    这条同时锁住"插入位置"——插到后面去的话，全站会被源页的值统一覆盖，
    那是另一种破坏（每页各自的设计被抹平）。
    """
    pages = _unify(_ROUNDED + _PRIMARY, ".rounded-custom { border-radius: 2px; }" + _PRIMARY)
    html = pages["p2"]
    own_at = html.index("border-radius: 2px")
    moved_at = html.find("border-radius: 14px")
    if moved_at != -1:
        assert moved_at < own_at, "补的那条排在本页定义之后，会把本页的 2px 覆盖掉"
    assert style_class_rules(html)["rounded-custom"].endswith("14px;") is False


def test_pages_that_need_nothing_are_left_alone():
    """两页都齐全 → 不插入任何东西（别给没病的页加噪音）。"""
    pages = _unify(_ROUNDED + _PRIMARY, _ROUNDED + _PRIMARY)
    for pid in ("p1", "p2"):
        assert "data-shell-css" not in pages[pid], f"{pid} 什么都不缺，却被插了一段样式"
