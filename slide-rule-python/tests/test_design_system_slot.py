"""设计系统劈成两半：契约写死 + 风格可注入（2026-08-15 晚）。

## 上游本来就是个槽位，是我们把它堵上了

screenshot-to-code 的 `build_design_system_prompt_block(design_system: str | None)`
接的是**参数**——传什么注什么，不传整块返回 ""：

    # scratchpad/oss/screenshot-to-code/backend/prompts/design_system.py
    def build_design_system_prompt_block(design_system: str | None) -> str:
        if not design_system or not design_system.strip():
            return ""
        return f\"\"\"...<design_system>{design_system.strip()}</design_system>\"\"\"

本仓抄了这个**形状**，却把一个常量焊进了槽位里。于是「这个应用长什么样」
变成了全局唯一一份，什么业务出来都是同一个模子。

## 劈的依据：下游代码依不依赖它

    契约  <aside>/<header>/<main>       page_shell 抠壳、导航锚定、内容区让位
          面包屑 APG + aria-current      set_breadcrumb_current 与 .breadcrumb 判据
          Tailwind / 中文占位            validate_page_html 硬判
          不许出现生成方身份与外链       scan_foreign_references 硬判
          脚本不会执行 → 图表用内联 svg  宿主 DOMPurify 摘 script，**事实**不是审美

    风格  版式原型、密度档位、组件词汇、配色基调、图表用几个

## ⚠ 为什么契约不能交给 LLM 写

一句「用卡片流布局，去掉侧边栏」就能把 `<aside>` 写没，而外壳统一、导航锚定、
面包屑跟页会**静默失效**——2026-08-15 当天踩过两次同型（面包屑四页一样、
侧栏压穿内容），两次都是判据全绿、页面照常渲染。

劈开之后 LLM 压根**没有机会**碰契约，也就不需要「生成完再校验有没有破坏契约」
那一整套判据。少一层校验，少一处会漏的地方。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import (  # noqa: E402
    _DEFAULT_STYLE,
    build_design_system_prompt_block,
    build_page_html_prompt,
)

#: 契约里每一条都对应一处**下游依赖**，逐条钉住
CONTRACT_MARKS = [
    ("<aside>", "page_shell.extract_shell 抠壳靠它"),
    ("<header>", "面包屑住在里面"),
    ("<main>", "reconcile_main_offset 认它"),
    ('aria-current="page"', "set_breadcrumb_current 认它"),
    ("Breadcrumb", "_BREADCRUMB_NAV 优先认这个 aria-label"),
    ("不会被执行", "宿主摘 script，这是事实"),
    ("fixed inset-0", "打开态浮层会挡住菜单"),
    ("hidden", "抽屉默认关上，对照 Radix defaultOpen=false"),
    ("<svg>", "图表只能内联 svg 画"),
    ("可读的中文文字", "validate_page_html 判中文"),
    ("不许出现你（生成方）", "scan_foreign_references 判品牌泄漏"),
    ("库存图床", "搜到的图直挂 src，闸要放行这几家"),
]


class Test契约永远在:
    @pytest.mark.parametrize("mark,why", CONTRACT_MARKS)
    def test_缺省时契约在(self, mark, why):
        assert mark in build_page_html_prompt("某页"), why

    @pytest.mark.parametrize("mark,why", CONTRACT_MARKS)
    def test_注入风格后契约还在(self, mark, why):
        p = build_page_html_prompt("某页", design_system="极简风，单栏卡片流，不要侧边导航")
        assert mark in p, f"注入风格把契约冲掉了：{why}"

    @pytest.mark.parametrize("hostile", [
        "去掉 <aside>，改用顶部导航",
        "不要面包屑",
        "用 echarts 画图表，写一段 JS 初始化",
        "占位用灰色色块，不要写文字",
    ])
    def test_风格写得再冲_契约仍在后面压着(self, hostile):
        """⚠ 不指望模型一定听契约的——但**契约必须还在提示词里，且在最后**。
        它排在风格后面，且带着"冲突时以这一节为准"的声明。"""
        p = build_page_html_prompt("某页", design_system=hostile)
        assert "以下几条是硬约束" in p
        assert p.index("以下几条是硬约束") > p.index(hostile.split("，")[0][:6])


class Test风格可注入:
    def test_注入的原文进去了(self):
        p = build_page_html_prompt("某页", design_system="冷淡风，大量留白，只用一个强调色")
        assert "冷淡风，大量留白，只用一个强调色" in p

    @pytest.mark.parametrize("empty", [None, "", "   ", "\n\t "])
    def test_不传就用缺省(self, empty):
        assert _DEFAULT_STYLE in build_page_html_prompt("某页", design_system=empty)

    def test_传了就不再带缺省那句(self):
        """⚠ 覆盖要是**替换**不是追加：两句风格并存会互相打架，
        而模型多半挑后一句——等于覆盖时灵时不灵。"""
        p = build_page_html_prompt("某页", design_system="冷淡风")
        assert _DEFAULT_STYLE not in p

    def test_缺省风格是一句话(self):
        """⚠ 缺省只是兜底，不是"推荐版式"。它一变长就又成了写死的设计系统——
        这正是 2026-08-15 晚要撤回的东西（当时塞了版式骨架 + 密度 + 组件词汇）。"""
        assert len(_DEFAULT_STYLE) < 40, f"缺省风格又开始长了：{_DEFAULT_STYLE!r}"
        assert "面板" not in _DEFAULT_STYLE and "统计卡" not in _DEFAULT_STYLE


class Test移动端分岔:
    def test_移动端契约不要aside(self):
        p = build_page_html_prompt("某页", device="phone")
        assert "不要左侧边栏" in p and "<nav>" in p
        assert "<aside> 固定主导航" not in p

    def test_移动端也认同一个风格槽(self):
        p = build_page_html_prompt("某页", device="phone", design_system="拟物风")
        assert "拟物风" in p and "不要左侧边栏" in p

    def test_两端的缺省风格不同(self):
        a = build_design_system_prompt_block(None, device="desktop")
        b = build_design_system_prompt_block(None, device="phone")
        assert a != b

    def test_平板既不是桌面也不是手机(self):
        """2026-08-30 夜：`phone else desktop` 让 tablet 领走 1920 + w-64。"""
        desk = build_design_system_prompt_block(None, device="desktop")
        phone = build_design_system_prompt_block(None, device="phone")
        tablet = build_design_system_prompt_block(None, device="tablet")
        assert tablet != desk and tablet != phone
        assert "1112×834" in tablet and "w-52" in tablet
        assert "铺满 1920×1080" not in tablet
        assert "不要左侧边栏" not in tablet


class Test块的形状沿用上游:
    def test_带优先级声明(self):
        """上游那句 'If the design system conflicts...' 是它设计里的一部分，
        不是装饰——照抄，别自己另发明一套说法。"""
        assert "prioritize the design system" in build_page_html_prompt("某页")

    def test_包在design_system标签里(self):
        p = build_page_html_prompt("某页", design_system="冷淡风")
        assert "<design_system>" in p and "</design_system>" in p
        s, e = p.index("<design_system>"), p.index("</design_system>")
        assert s < p.index("冷淡风") < e, "风格没包在块里"
