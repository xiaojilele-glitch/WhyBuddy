# -*- coding: utf-8 -*-
"""消费 / 内容原型：另开壳，图是一等公民（2026-08-31）。

范围卡选 content_app 之后，SPEC / 风格段 / 画页契约 / unify 必须换顶栏横栏。
漏传任何一处 = 杂志套上后台 aside。手机仍走底栏；平板 + 内容走内容壳，
不要 w-52 巡店侧栏。选择通道是 productArchetype，不许按话题词分流。
"""

from __future__ import annotations

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_first_pipeline as sfp
from services.design_language import build_style_brief_prompt, render_design_language
from services.page_shell import (
    check_shell_consistency,
    main_offset_tokens,
    unify_shell,
)
from services.spec_page_html import build_page_html_prompt
from services.spec_tree import build_spec_prompt


def _code(mod) -> str:
    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


SPEC = {
    "appName": "团子日刊",
    "personas": [{"id": "u1", "name": "读者", "goals": []}],
    "pages": [{"id": "p1", "name": "今日"}, {"id": "p2", "name": "图流"}],
}


def _content_page(brand: str, role: str, nav_labels: list[str], active: int, *, aside: bool = False) -> str:
    links = []
    for i, label in enumerate(nav_labels):
        cls = "font-semibold" if i == active else "text-sm"
        links.append(f'<a href="#" class="{cls}">{label}</a>')
    aside_html = (
        '<aside class="w-64"><nav><a>后台</a><a>台账</a></nav></aside>' if aside else ""
    )
    return (
        "<!DOCTYPE html><html><head></head>"
        '<body class="flex min-h-screen">'
        f"{aside_html}"
        f"<header class='flex items-center gap-6'><h1>{brand}</h1>"
        f"<nav class='flex gap-6'>{''.join(links)}</nav>"
        f"<span>{role}</span></header>"
        '<main><img src="https://placehold.co/800x400" alt="morning light"/>'
        "<h2>今日封面</h2></main>"
        "</body></html>"
    )


class Test内容壳统一:
    def test_剥掉leftover_aside并统一顶栏横栏(self):
        pages = {
            "p1": _content_page("日刊甲", "小编", ["今日", "我的"], 0, aside=True),
            "p2": _content_page("团子日刊", "读者", ["首页", "图流", "设置"], 1),
        }
        out = unify_shell(pages, SPEC, product_archetype="content_app")
        assert out["navAnchored"] is True
        assert out["appName"] == "团子日刊"
        for pid, html in out["pages"].items():
            assert "<aside" not in html.lower()
            assert "团子日刊" in html
            assert 'data-page-id="p1"' in html and 'data-page-id="p2"' in html
            # 整页会把兜底 CSS 选择器也算进去（3 处选择器 + 1 处真属性）。
            # 钉在横栏上：当前页恰好一项。
            navs = re.findall(r"<nav\b[^>]*>[\s\S]*?</nav>", html, re.I)
            assert sum(n.count('aria-current="page"') for n in navs) == 1
            assert 'data-shell="header"' in html
            assert 'data-shell="nav"' in html
            assert 'data-shell="aside"' not in html
        assert check_shell_consistency(out["pages"], SPEC) == []
        # 横栏带 data-page-id，不许再被当成面包屑把当前项文字抹掉。
        from services.page_shell import blank_breadcrumb_current, extract_shell

        h1 = extract_shell(out["pages"]["p1"])["header"]
        assert blank_breadcrumb_current(h1) == h1
        assert "今日" in h1 and "图流" in h1

    def test_剥aside之后不许留下ml64(self):
        """模型按后台皮套出 aside + main.ml-64。unify 剥 aside 之后
        leftover 左边空一截（2026-09-01 内容站真机，main.x=256）。

        ⚠ 夹具必须自己带着 aside 和 ml-64。``_content_page`` 的 main
        不带偏移——删掉清理函数那条照样绿，正是这次漏掉的形状。

        ⚠ body 已经是 flex-col：只把 reconcile 挪到转列之前不够，
        源页自己写成纵向时 strip_main_offset 照样 bail。
        """
        page = (
            "<!DOCTYPE html><html><head></head>"
            '<body class="flex flex-col min-h-screen">'
            '<aside class="fixed inset-y-0 left-0 w-64">侧栏</aside>'
            '<header class="flex items-center gap-6"><h1>团子日刊</h1>'
            '<nav class="flex gap-6"><a>今日</a><a>图流</a></nav>'
            "<span>读者</span></header>"
            '<main class="ml-64 flex-1">封面</main>'
            "</body></html>"
        )
        wrapped = (
            page.replace("flex flex-col min-h-screen", "flex min-h-screen").replace(
                'class="ml-64 flex-1"', 'class="ml-[248px] flex-1"'
            )
        )
        out = unify_shell(
            {"p1": page, "p2": wrapped}, SPEC, product_archetype="content_app"
        )
        for html in out["pages"].values():
            assert "<aside" not in html.lower()
            assert main_offset_tokens(html) == []
        free = unify_shell(
            {"p1": page, "p2": wrapped}, SPEC, product_archetype="free_app"
        )
        for html in free["pages"].values():
            assert main_offset_tokens(html) == []
        biz = unify_shell({"p1": page, "p2": page}, SPEC)
        assert "<aside" in biz["pages"]["p1"].lower()
        assert main_offset_tokens(biz["pages"]["p1"]) == ["ml-64"]

    def test_剥偏移接在内容壳unify上(self):
        """函数写对 ≠ 接在剥 aside 之后。改成只调 reconcile_main_offset
        本条必须红：转成 flex-col 之后那条会直接 return。"""
        from services import page_shell as ps

        code = _code(ps._unify_shell_content)
        assert "_drop_main_offset_classes(" in code
        assert "reconcile_main_offset(" not in code

    def test_没选内容原型时桌面仍要侧栏(self):
        """反向：business_app 桌面路径一字不改。"""
        from services.page_shell import extract_shell

        aside = (
            '<aside class="w-64"><div>维保云</div><nav>'
            '<a class="item" href="#">工单</a>'
            '<a class="item current" href="#">档案</a>'
            "</nav><span>维修主管</span></aside>"
        )
        page = (
            "<!DOCTYPE html><html><body class='flex'>"
            f"{aside}<header>顶</header><main>正文</main></body></html>"
        )
        spec = {
            "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管"}],
            "pages": [{"id": "p1", "name": "工单"}, {"id": "p2", "name": "档案"}],
        }
        out = unify_shell({"p1": page, "p2": page}, spec)
        assert extract_shell(out["pages"]["p1"])["aside"]
        assert "<aside" in out["pages"]["p1"]

    def test_平板加内容也剥aside(self):
        pages = {
            "p1": _content_page("日刊", "读者", ["今日", "图流"], 0, aside=True),
            "p2": _content_page("日刊", "读者", ["今日", "图流"], 1, aside=True),
        }
        out = unify_shell(
            pages, SPEC, device="tablet", product_archetype="content_app"
        )
        for html in out["pages"].values():
            assert "<aside" not in html.lower()
            assert 'data-shell="aside"' not in html


def _phone_page(brand: str, role: str, nav_labels: list[str], active: int) -> str:
    links = []
    for i, label in enumerate(nav_labels):
        cls = "tab active-tab" if i == active else "tab"
        links.append(
            f'<a href="#" class="{cls}"><svg viewBox="0 0 1 1"></svg><span>{label}</span></a>'
        )
    return (
        "<!DOCTYPE html><html><head></head><body>"
        f"<header><h1>{brand}</h1><span>{role}</span></header>"
        "<main>正文内容</main>"
        f'<nav class="bottom-bar">{"".join(links)}</nav>'
        "</body></html>"
    )


class Test手机加内容仍是竖屏壳:
    def test_底栏还在_不改成顶栏横栏独占(self):
        pages = {
            "p1": _phone_page("日刊甲", "小编", ["今日", "我的"], 0),
            "p2": _phone_page("团子日刊", "读者", ["今日", "图流"], 1),
        }
        out = unify_shell(
            pages, SPEC, device="phone", product_archetype="content_app"
        )
        for html in out["pages"].values():
            assert "<aside" not in html
            assert 'class="bottom-bar"' in html or "bottom-bar" in html
            assert 'data-page-id="p1"' in html


class Test契约与风格段:
    def test_画页契约换内容合同(self):
        p = build_page_html_prompt("封面", product_archetype="content_app")
        assert "不要 <aside>" in p or "不要左侧边栏" in p
        assert "图是一等公民" in p
        assert "必须用 w-64" not in p

    def test_风格段换消费端(self):
        joined = " ".join(
            m["content"]
            for m in build_style_brief_prompt(SPEC, product_archetype="content_app")
        )
        assert "资深消费端视觉设计师" in joined
        assert "图是一等公民" in joined

    def test_回落密度条款也换内容(self):
        text = render_design_language(
            {"tone": "杂志", "primary": "#111111", "accent": "#222222",
             "radius": "8px", "density": "标准", "components": [], "charts": False},
            product_archetype="content_app",
        )
        assert "内容产品" in text or "图是一等公民" in text
        assert "不是业务后台" in text or "不是 PC 后台" in text
        desk = render_design_language(
            {"tone": "后台", "primary": "#2563eb", "accent": "#0f172a",
             "radius": "8px", "density": "标准", "components": [], "charts": False},
        )
        assert "后台" in desk
        assert "内容产品" not in desk

    def test_SPEC有内容IA(self):
        user = build_spec_prompt("团子的一天", product_archetype="content_app")[-1]["content"]
        assert "图是一等公民" in user
        assert "每一页的侧栏上" not in user


class Test管道一处定处处跟:
    def _wire(self, monkeypatch, captured):
        def _spec(*a, **k):
            captured["spec_arch"] = k.get("product_archetype")
            captured["spec_device"] = k.get("device")
            return dict(SPEC, nodes=[])

        monkeypatch.setattr("services.spec_tree.generate_spec_tree", _spec)

        def _style(spec, **kw):
            captured["style_arch"] = kw.get("product_archetype")
            return None

        monkeypatch.setattr("services.design_language.generate_style_brief", _style)

        def _lang(spec, **kw):
            captured["lang_arch"] = kw.get("product_archetype")
            return {
                "tone": "x",
                "primary": "#2563eb",
                "accent": "#0f172a",
                "radius": "8px",
                "density": "标准",
                "components": [],
                "charts": False,
            }

        monkeypatch.setattr("services.design_language.generate_design_language", _lang)

        def _pages(spec, **kw):
            captured["gen_arch"] = kw.get("product_archetype")
            return {
                "pages": {"p1": "<html>1</html>", "p2": "<html>2</html>"},
                "failed": {},
            }

        monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _pages)

        def _shell(pages, spec, **kw):
            captured["shell_arch"] = kw.get("product_archetype")
            captured["shell_device"] = kw.get("device")
            return {"pages": pages, "navItems": []}

        monkeypatch.setattr("services.page_shell.unify_shell", _shell)
        monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
        monkeypatch.setattr(
            "services.html_structure.derive_structure",
            lambda *a, **k: {"entities": [], "pages": []},
        )
        monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
        monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
        monkeypatch.setattr(
            "services.html_bindings.bind_pages",
            lambda pages, model, **kw: {"pages": pages, "failed": {}},
        )

    def test_content_app全链带到下游(self, monkeypatch):
        captured: dict = {}
        self._wire(monkeypatch, captured)
        sfp.run_spec_first("团子的一天", product_archetype="content_app")
        assert captured["spec_arch"] == "content_app"
        assert captured.get("style_arch") == "content_app" or captured.get("lang_arch") == "content_app"
        assert captured["gen_arch"] == "content_app"
        assert captured["shell_arch"] == "content_app"
        sfp.take_last_pages()

    def test_空原型不把内容壳传下去(self, monkeypatch):
        captured: dict = {}
        self._wire(monkeypatch, captured)
        sfp.run_spec_first("请假系统")
        assert captured["spec_arch"] == ""
        assert captured["gen_arch"] == ""
        assert captured["shell_arch"] == ""
        sfp.take_last_pages()

    def test_调用点真写了product_archetype(self):
        """剥注释再盯。写在 docstring 里也会绿。"""
        pipe = _code(sfp)
        spec_at = pipe.index("generate_spec_tree(")
        assert "product_archetype=arch" in pipe[spec_at : spec_at + 360]
        style_at = pipe.index("generate_style_brief(")
        assert "product_archetype=arch" in pipe[style_at : style_at + 120]
        pages_at = pipe.index("generate_pages_parallel(")
        assert "product_archetype=arch" in pipe[pages_at : pages_at + 900]
        shell_at = pipe.index("unify_shell(pages, spec, device=device")
        assert "product_archetype=arch" in pipe[shell_at : shell_at + 80]
        bind_at = pipe.index("bind_pages(to_bind, model")
        assert "product_archetype=arch" in pipe[bind_at : bind_at + 80]
        from services import page_shell as ps

        unify = _code(ps.unify_shell)
        assert "_unify_shell_content" in unify
        assert "_is_content_shell" in unify
