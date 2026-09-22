# -*- coding: utf-8 -*-
"""自由类型：不套后台中台，也不套杂志四页（2026-08-31）。

用户圈了空态 Web/应用/平板 下拉要加一档。那是设备轴，自由类型是原型轴，
两轴不许混进同一颗钮。选择通道仍是 productArchetype。

生成侧：壳跟 content 一样（header 横栏、剥 aside）；SPEC/密度/绑洞分叉——
图流货架至少留 4 张示例图，不要「只留一行」把首屏收成半空。
"""

from __future__ import annotations

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import build_style_brief_prompt, render_design_language
from services.html_bindings import build_prompt as build_bind_prompt
from services.page_shell import unify_shell
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

MODEL = {
    "datamodel": {
        "entities": [
            {
                "id": "photo_frame",
                "name": "画幅",
                "fields": [{"id": "title", "name": "标题", "type": "string"}],
            }
        ]
    }
}

HTML = (
    "<!DOCTYPE html><html lang='zh-CN'><head>"
    "<script src='https://cdn.tailwindcss.com'></script></head><body>"
    "<main><img src='https://placehold.co/400' alt='street'/></main>"
    "</body></html>"
)


class Test自由类型契约:
    def test_SPEC不套杂志四页也不套后台骨架(self):
        user = build_spec_prompt("团子的一天", product_archetype="free_app")[-1]["content"]
        assert "自由类型" in user
        assert "不要为了凑杂志硬切成封面/图流/详情/杂志四页" in user
        assert "至少 4 张可见配图" in user
        assert "页型是封面、图流、详情、杂志，不是看板" not in user
        assert "每一页的侧栏上" not in user
        desk = build_spec_prompt("请假系统")[-1]["content"]
        assert "自由类型" not in desk

    def test_画页契约要货架不要KPI(self):
        p = build_page_html_prompt("图流", product_archetype="free_app")
        assert "不要 <aside>" in p or "不要左侧边栏" in p
        assert "至少 4 张" in p
        assert "justify-between" in p
        assert "正方形人像特写" in p
        assert "必须用 w-64" not in p
        desk = build_page_html_prompt("图流")
        assert "自由类型" not in desk
        assert "至少 4 张" not in desk

    def test_风格段是产品设计师不是B端也不是杂志四页(self):
        joined = " ".join(
            m["content"]
            for m in build_style_brief_prompt(SPEC, product_archetype="free_app")
        )
        assert "资深产品视觉设计师" in joined
        assert "资深 B 端产品设计师" not in joined
        assert "封面、图流、详情、杂志" not in joined
        assert "至少 4 张可见图" in joined
        assert "正方形人像特写" in joined

    def test_回落密度按页干活不是一张主图(self):
        text = render_design_language(
            {
                "tone": "胶片",
                "primary": "#111111",
                "accent": "#222222",
                "radius": "8px",
                "density": "标准",
                "components": [],
                "charts": False,
            },
            product_archetype="free_app",
        )
        assert "自由类型" in text
        assert "至少 4" in text
        assert "一张主图。一屏一件内容" not in text
        desk = render_design_language(
            {
                "tone": "后台",
                "primary": "#2563eb",
                "accent": "#0f172a",
                "radius": "8px",
                "density": "标准",
                "components": [],
                "charts": False,
            },
        )
        assert "自由类型" not in desk

    def test_绑洞开放壳留四张货架后台仍只留一行(self):
        free = build_bind_prompt(
            HTML, MODEL, "p1", product_archetype="free_app"
        )[-1]["content"]
        content = build_bind_prompt(
            HTML, MODEL, "p1", product_archetype="content_app"
        )[-1]["content"]
        biz = build_bind_prompt(HTML, MODEL, "p1")[-1]["content"]
        assert "至少留 4 张" in free
        assert "至少留 4 张" in content
        assert "至少留 4 张" not in biz
        assert "只留一行" in biz
        # ⚠ 2026-09-01：上一版写「data-rows 可以打，但里面至少留 4 张」，
        # 运行时仍清空货架。开放壳必须明令货架不要打 data-rows。
        assert "data-rows 可以打" not in free
        assert "data-rows 可以打" not in content
        i = free.index("货架")
        window = free[max(0, i - 40) : i + 120]
        assert "不要" in window and "data-rows" in window
        assert "货架" in content
        assert "不要给这种货架打 data-rows" not in biz

    def test_unify走开放壳剥aside(self):
        page = (
            "<!DOCTYPE html><html><body class='flex'>"
            "<aside class='w-64'><nav><a>后台</a><a>台账</a></nav></aside>"
            "<header class='flex'><h1>日刊</h1>"
            "<nav class='flex'><a>今日</a><a>图流</a></nav></header>"
            "<main><img src='https://placehold.co/800' alt='x'/></main>"
            "</body></html>"
        )
        spec = {
            "appName": "日刊",
            "personas": [{"id": "u1", "name": "读者"}],
            "pages": [{"id": "p1", "name": "今日"}, {"id": "p2", "name": "图流"}],
        }
        out = unify_shell(
            {"p1": page, "p2": page}, spec, product_archetype="free_app"
        )
        for html in out["pages"].values():
            assert "<aside" not in html.lower()
            assert 'data-shell="aside"' not in html
            assert 'data-shell="header"' in html


class Test自由类型接在活路上:
    def test_管道bind也吃product_archetype(self):
        from services import spec_first_pipeline as sfp

        pipe = _code(sfp)
        bind_at = pipe.index("bind_pages(to_bind, model")
        assert "product_archetype=arch" in pipe[bind_at : bind_at + 80]

    def test_page_shell开放壳认free_app(self):
        from services import page_shell as ps

        unify = _code(ps.unify_shell)
        helper = _code(ps._is_content_shell)
        assert "_is_content_shell" in unify
        assert "is_open_chrome" in helper
        assert "is_content_app" not in helper
