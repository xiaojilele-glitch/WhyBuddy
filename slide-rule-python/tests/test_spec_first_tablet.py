# -*- coding: utf-8 -*-
"""spec-first 的平板横屏（1112×834 CSS 像素）编译接线。

## 病灶

2026-08-30 夜真机：dropdown 选了平板、goal / pages_json / generated-app
都盖了 tablet 章，五页 HTML 仍是 <aside class="w-64">，舞台 1920×1080。

跟 08-20 手机「壳换了、IA 没换」同构，这次是「戳对了、契约没换」。
根因是活路上仍写 ``phone if else desktop``——tablet 静默领走桌面合同。

## 接线的形状：一处定、处处跟（抄 grok ScreenMode：一个枚举、一处引导）

    run_spec_first        preferred_device=tablet 原样传到下游，不折成 desktop
    spec_tree             tablet → 两栏 + 窄侧栏 IA，不写 1920 工作台，不写手机底栏
    design_language       tablet → 1112×834，不点名「主表几列 / 右侧详情栏」
    spec_page_html        tablet → 1112×834 + w-52，保留 <aside>，不要手机 TabBar
    page_shell            tablet → 走 aside 统一路径，侧栏锁 w-52（不是底栏、不是 w-64）
    页面事件 / 产物        每一份都带 device=tablet，前端据此选 1112 画布

数字抄账本 viewportCss / ant-design Layout.Sider，不自己发明。
"""

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_first_pipeline as sfp
from services.archetype_legal import device_viewport_css
from services.design_language import (
    build_style_brief_prompt,
    render_design_language,
)
from services.page_shell import (
    _aside_tokens,
    main_offset_tokens,
    repair_pages_after_bind,
    unify_shell,
)
from services.spec_page_html import build_design_system_prompt_block, build_page_html_prompt
from services.spec_tree import build_spec_prompt


def _code(mod) -> str:
    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


SPEC = {
    "appName": "巡店助手",
    "personas": [{"id": "u1", "name": "店长", "goals": []}],
    "pages": [{"id": "p1", "name": "巡店"}, {"id": "p2", "name": "点单"}],
}


class Test页面提示词三档分开:
    def test_tablet换平板契约(self):
        p = build_page_html_prompt("某页", device="tablet")
        for word in ["1112×834", "w-52", "旁路详情", "<aside>", "44px"]:
            assert word in p, f"平板契约里少了「{word}」"
        assert "铺满 1920×1080" not in p
        assert "必须用 w-64" not in p
        assert "不要左侧边栏" not in p
        assert "demo2.less" not in p
        assert "phone-tabbar" not in p

    def test_desktop仍是1920宽侧栏(self):
        desk = build_page_html_prompt("某页", device="desktop")
        assert "铺满 1920×1080" in desk
        assert "必须用 w-64" in desk
        assert "1112×834" not in desk
        assert "w-52" not in desk

    def test_phone仍是竖屏底栏(self):
        phone = build_page_html_prompt("某页", device="phone")
        assert "390×844" in phone
        assert "不要左侧边栏" in phone or "不要 <aside>" in phone
        assert "1112×834" not in phone
        assert "w-52" not in phone

    def test_三档缺省合同互不相同(self):
        a = build_design_system_prompt_block(None, device="desktop")
        b = build_design_system_prompt_block(None, device="phone")
        c = build_design_system_prompt_block(None, device="tablet")
        assert a != b and b != c and a != c

    def test_tablet不是desktop缺省的别名(self):
        """把 tablet 分支删掉、退回 `phone else desktop`，本条必须红。"""
        assert build_page_html_prompt("某页", device="tablet") != build_page_html_prompt(
            "某页", device="desktop"
        )
        assert build_page_html_prompt("某页", device="tablet") != build_page_html_prompt(
            "某页", device="phone"
        )


class Test规格树平板IA:
    def test_tablet把密度约束写进user消息(self):
        user = build_spec_prompt("连锁便利店巡店点单", device="tablet")[-1]["content"]
        for mark in ("1112×834", "w-52", "旁路详情", "平板"):
            assert mark in user, f"平板 SPEC 少了「{mark}」"
        assert "每一页的侧栏上" in user, "平板壳挂 aside，不许改成顶栏"
        assert "每一页的顶栏上" not in user
        assert "一屏一件主任务" not in user
        assert "铺满 1920×1080" not in user

    def test_desktop不掺平板密度(self):
        user = build_spec_prompt("连锁便利店巡店点单")[-1]["content"]
        assert "w-52" not in user
        assert "1112×834" not in user
        assert "每一页的侧栏上" in user

class Test风格段平板:
    def test_tablet不点名宽表和右侧栏(self):
        joined = " ".join(
            m["content"] for m in build_style_brief_prompt(SPEC, device="tablet")
        )
        assert "1112×834" in joined
        assert "主表几列" not in joined
        assert "有没有右侧详情栏" not in joined
        assert "手机竖屏 App" not in joined
        assert "390×844" not in joined
        assert "逐个点名" in joined
        assert "不要硬凑统计卡" in joined

    def test_tablet确定性密度也不走桌面条款(self):
        prose = render_design_language(None, device="tablet")
        assert "1112×834" in prose
        assert "主表格至少 6 列" not in prose
        assert "手机竖屏 App" not in prose


def _tablet_page(brand: str, role: str, labels: list[str], active: int) -> str:
    links = []
    for i, label in enumerate(labels):
        cls = "nav-active" if i == active else ""
        links.append(
            f'<a class="nav-item {cls}" href="#">'
            f'<svg class="icon{i}"><path d="M{i}"/></svg><span>{label}</span></a>'
        )
    return (
        "<!DOCTYPE html><html><body>"
        f'<aside class="w-52"><div class="brand">{brand}</div>'
        f"<nav>{''.join(links)}</nav><div class='user'>{role}</div></aside>"
        f"<header><span>{brand} · 顶栏</span></header>"
        "<main>正文</main>"
        "</body></html>"
    )


def _tablet_fixed(brand: str, role: str, labels: list[str], width: str, offset: str) -> str:
    """fixed 侧栏 + 让位，用来咬 unify / bind 的宽度锁和 ml-* 成对。"""
    links = "".join(f'<a class="nav-item"><span>{label}</span></a>' for label in labels)
    return (
        "<!DOCTYPE html><html><body class=\"bg-slate-50\">"
        f'<aside class="{width} flex-shrink-0 bg-slate-900 fixed h-full">'
        f'<div class="brand">{brand}</div><nav>{links}</nav>'
        f'<div class="user">{role}</div></aside>'
        f"<header><span>{brand} · 顶栏</span></header>"
        f'<main class="{offset} min-h-screen">正文</main>'
        "</body></html>"
    )


class Test平板壳统一:
    def test_tablet走aside不是底栏(self):
        pages = {
            "p1": _tablet_page("巡店通", "店长", ["巡店", "点单"], 0),
            "p2": _tablet_page("别的名", "店员", ["巡店", "点单"], 1),
        }
        out = unify_shell(pages, SPEC, device="tablet")
        for html in out["pages"].values():
            assert "<aside" in html
            assert "phone-tabbar" not in html
            assert "bottom-bar" not in html
            assert "巡店助手" in html
            # ⚠ 2026-08-30 巡店点单真机：只断言品牌和 aside，unify 把
            # w-52 抬成 w-64 仍绿。宽度必须钉在开标签上。
            assert "w-52" in _aside_tokens(html)
            assert "w-64" not in _aside_tokens(html)

    def test_tablet不把w52抬成桌面w64(self):
        """同一份契约 HTML：tablet 锁 w-52，desktop 仍抬到 w-64。

        把 tablet 枝删掉、ensure 退回桌面门槛，本条必须红——那就是
        巡店点单四页侧栏全变成 16rem 的那次。桌面半边回潮也红。
        """
        pages = {
            "p1": _tablet_page("巡店通", "店长", ["巡店", "点单"], 0),
            "p2": _tablet_page("别的名", "店员", ["巡店", "点单"], 1),
        }
        tab = unify_shell(pages, SPEC, device="tablet")["pages"]
        desk = unify_shell(pages, SPEC, device="desktop")["pages"]
        for html in tab.values():
            assert "w-52" in _aside_tokens(html)
            assert "w-64" not in _aside_tokens(html)
        for html in desk.values():
            assert "w-64" in _aside_tokens(html)
            assert "w-52" not in _aside_tokens(html)

    def test_tablet过窄文字轨抬到w52_让位跟ml52(self):
        pages = {
            "p1": _tablet_fixed("巡店通", "店长", ["巡店", "点单"], "w-16", "ml-16"),
            "p2": _tablet_fixed("巡店通", "店长", ["巡店", "点单"], "w-16", "ml-16"),
        }
        tab = unify_shell(pages, SPEC, device="tablet")["pages"]["p1"]
        desk = unify_shell(pages, SPEC, device="desktop")["pages"]["p1"]
        assert "w-52" in _aside_tokens(tab)
        assert "w-64" not in _aside_tokens(tab)
        assert main_offset_tokens(tab) == ["ml-52"]
        assert "w-64" in _aside_tokens(desk)
        assert "w-16" not in _aside_tokens(desk)
        assert main_offset_tokens(desk) == ["ml-64"]

    def test_tablet把桌面宽侧栏收回w52(self):
        """模型偶发写成 w-64 时，unify 也要收回去，不能当『已经够宽』放行。"""
        pages = {
            "p1": _tablet_fixed("巡店通", "店长", ["巡店", "点单"], "w-64", "ml-64"),
            "p2": _tablet_fixed("巡店通", "店长", ["巡店", "点单"], "w-64", "ml-64"),
        }
        tab = unify_shell(pages, SPEC, device="tablet")["pages"]["p1"]
        assert "w-52" in _aside_tokens(tab)
        assert "w-64" not in _aside_tokens(tab)
        assert main_offset_tokens(tab) == ["ml-52"]

    def test_bind之后平板仍锁w52_桌面仍抬w64(self):
        """unify 修好、打孔收尾再按桌面门槛抬宽 = 只改一半。"""
        before = {
            "p1": _tablet_fixed("巡店通", "店长", ["巡店", "点单"], "w-52", "ml-52"),
        }
        after = {
            "p1": before["p1"].replace("w-52", "w-16").replace("ml-52", "ml-16"),
        }
        tab, _r, _rec = repair_pages_after_bind(after, before, device="tablet")
        desk, _r2, _rec2 = repair_pages_after_bind(after, before, device="desktop")
        assert "w-52" in _aside_tokens(tab["p1"])
        assert "w-64" not in _aside_tokens(tab["p1"])
        assert main_offset_tokens(tab["p1"]) == ["ml-52"]
        assert "w-64" in _aside_tokens(desk["p1"])
        assert "w-52" not in _aside_tokens(desk["p1"])
        assert main_offset_tokens(desk["p1"]) == ["ml-64"]


class Test账本视口:
    def test_tablet视口跟账本一致(self):
        assert device_viewport_css("tablet") == (1112, 834)
        assert device_viewport_css("phone") == (390, 844)
        assert device_viewport_css("desktop") == (1920, 1080)


class Test管道一处定处处跟:
    def _wire(self, monkeypatch, captured):
        def _spec(*a, **k):
            captured["spec_device"] = k.get("device")
            return dict(SPEC, nodes=[])

        monkeypatch.setattr("services.spec_tree.generate_spec_tree", _spec)

        def _style(spec, **kw):
            captured["style_device"] = kw.get("device")
            return None

        monkeypatch.setattr(
            "services.design_language.generate_style_brief", _style
        )
        def _lang(spec, **kw):
            captured["lang_device"] = kw.get("device")
            return {
                "tone": "x",
                "primary": "#2563eb",
                "accent": "#0f172a",
                "radius": "8px",
                "density": "标准",
                "components": [],
                "charts": False,
            }

        monkeypatch.setattr(
            "services.design_language.generate_design_language",
            _lang,
        )

        def _pages(spec, **kw):
            captured["gen_device"] = kw.get("device")
            return {"pages": {"p1": "<html>1</html>", "p2": "<html>2</html>"}, "failed": {}}

        monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _pages)

        def _shell(pages, spec, **kw):
            captured["shell_device"] = kw.get("device")
            return {"pages": pages, "navItems": []}

        monkeypatch.setattr("services.page_shell.unify_shell", _shell)
        monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
        monkeypatch.setattr(
            "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
        )
        monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
        monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
        monkeypatch.setattr(
            "services.html_bindings.bind_pages",
            lambda pages, model, **kw: {"pages": pages, "failed": {}},
        )

    def test_preferred_tablet_全链带tablet_句子里不必写平板(self, monkeypatch):
        """dropdown 授予的 tablet 必须压过「巡店点单」这种没写设备词的句子。

        把 preferred_device 吞掉或折成 desktop，本条必须红。
        """
        captured: dict = {}
        events: list = []

        def sink(pid, html, done, total, bound=False, device=None):
            events.append(device)

        self._wire(monkeypatch, captured)
        out = sfp.run_spec_first(
            "连锁便利店巡店点单",
            preferred_device="tablet",
            on_page=sink,
        )
        assert captured["spec_device"] == "tablet"
        assert captured.get("style_device") == "tablet" or captured.get("lang_device") == "tablet"
        assert captured["gen_device"] == "tablet"
        assert captured["shell_device"] == "tablet"
        assert out["device"] == "tablet"
        assert sfp.take_last_pages()["device"] == "tablet"
        assert events and all(d == "tablet" for d in events)


class Test活路不许再写成phone_else_desktop:
    def test_设计系统分叉有tablet枝(self):
        from services import spec_page_html

        code = _code(spec_page_html.build_design_system_prompt_block)
        assert 'device == "tablet"' in code
        assert "elif" in code or "if device == \"tablet\"" in code

    def test_风格段分叉有tablet枝(self):
        from services import design_language

        code = _code(design_language.build_style_brief_prompt)
        assert 'device == "tablet"' in code

    def test_规格树分叉有tablet枝(self):
        from services import spec_tree

        code = _code(spec_tree.build_spec_prompt)
        assert 'device == "tablet"' in code
        assert "_TABLET_SPEC_IA" in inspect.getsource(spec_tree)

    def test_壳统一抬宽有tablet枝且device传到活路(self):
        """函数写对 ≠ 接在 unify / bind / 管道上。剥注释后再咬调用点。

        把 ``device=device`` 从任一处拿掉，本条必须红——缺省桌面会
        再把 w-52 抬成 w-64。
        """
        from services import page_shell, spec_first_pipeline

        policy = _code(page_shell._labeled_aside_policy)
        assert 'device == "tablet"' in policy
        assert "_TABLET_LABELED_ASIDE_WIDTH" in policy
        assert page_shell._TABLET_LABELED_ASIDE_WIDTH == "w-52"
        assert page_shell._labeled_aside_policy("tablet") == (52, "w-52")
        assert page_shell._labeled_aside_policy("desktop") == (56, "w-64")
        assert page_shell._labeled_aside_policy("phone") == (56, "w-64")
        unify = _code(page_shell.unify_shell)
        assert "ensure_labeled_aside_width(html, device=device)" in unify
        repair = _code(page_shell.repair_pages_after_bind)
        assert "canonical_labeled_aside_width" in repair
        assert "ensure_labeled_aside_width(out, device=device)" in repair
        pipe = _code(spec_first_pipeline)
        assert "repair_pages_after_bind(" in pipe
        assert re.search(
            r"repair_pages_after_bind\(\s*pages,\s*before_bind,\s*device=device",
            pipe,
        ), "管道漏传 device，bind 收尾会按桌面抬宽"
