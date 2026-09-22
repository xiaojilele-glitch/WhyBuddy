# -*- coding: utf-8 -*-
"""精修轮页 id 结构拨回（2026-08-18 过夜）。

提示词冻结（test_refine_id_freezing）接线全绿，过夜照样漂：

    快递   p1 → p1_page → p1_page_workbench
    活动室 p1..p4 → equipment_hall / admin_dashboard / …
    物业   p1..p4 → p1_page / p3_page / p4_page，p2 失踪

这些形状必须在**不调 LLM** 的情况下被拨回去。删掉调用点由
test_refine_id_freezing.Test结构拨回_过夜形状 咬住。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_id_freeze import (  # noqa: E402
    freeze_pages_in_model,
    freeze_spec_pages,
    resolve_prev_page_id,
)


PREV4 = [
    {"id": "p1", "name": "报修台"},
    {"id": "p2", "name": "工单页"},
    {"id": "p3", "name": "派工页"},
    {"id": "p4", "name": "回访页"},
]


class Test词干与名字:
    def test_后缀链拨回p1(self):
        """过夜快递：p1 → p1_page → p1_page_workbench。"""
        spec = {"pages": [{"id": "p1_page_workbench", "name": "取件台", "purpose": "取", "audience": "用户"}]}
        out, report = freeze_spec_pages(spec, [{"id": "p1", "name": "取件台"}])
        assert [p["id"] for p in out["pages"]] == ["p1"]
        assert report["mapping"] == {"p1_page_workbench": "p1"}

    def test_语义改名按名字拨回(self):
        """过夜活动室：p1..p4 整套换成 equipment_hall 这种语义 id。"""
        spec = {
            "pages": [
                {"id": "equipment_hall", "name": "报修台", "purpose": "a", "audience": "u"},
                {"id": "admin_dashboard", "name": "工单页", "purpose": "a", "audience": "u"},
            ]
        }
        out, report = freeze_spec_pages(spec, PREV4[:2])
        assert [p["id"] for p in out["pages"]] == ["p1", "p2"]
        assert report["mapping"] == {
            "equipment_hall": "p1",
            "admin_dashboard": "p2",
        }

    def test_同名歧义不猜(self):
        page = {"id": "ticket", "name": "工单页"}
        prev = [{"id": "p1", "name": "工单页"}, {"id": "p2", "name": "工单页"}]
        assert resolve_prev_page_id(page, prev, set()) is None

    def test_精确id优先于名字(self):
        page = {"id": "p2", "name": "报修台"}
        assert resolve_prev_page_id(page, PREV4, set()) == "p2"


class Test丢页:
    def test_加后缀时失踪的页补回来(self):
        """过夜物业：其余页加了 _page，p2 被当成删掉。"""
        spec = {
            "pages": [
                {"id": "p1_page", "name": "报修台", "purpose": "a", "audience": "u"},
                {"id": "p3_page", "name": "派工页", "purpose": "a", "audience": "u"},
                {"id": "p4_page", "name": "回访页", "purpose": "a", "audience": "u"},
            ]
        }
        out, report = freeze_spec_pages(spec, PREV4, PREV4)
        assert [p["id"] for p in out["pages"]] == ["p1", "p2", "p3", "p4"]
        assert report["restored"] == ["p2"]

    def test_真删不补(self):
        """四页还是原 id、少一页 = 提示词允许的真删。"""
        spec = {
            "pages": [
                {"id": "p1", "name": "报修台", "purpose": "a", "audience": "u"},
                {"id": "p3", "name": "派工页", "purpose": "a", "audience": "u"},
                {"id": "p4", "name": "回访页", "purpose": "a", "audience": "u"},
            ]
        }
        out, report = freeze_spec_pages(spec, PREV4, PREV4)
        assert [p["id"] for p in out["pages"]] == ["p1", "p3", "p4"]
        assert report["mapping"] == {}
        assert report["restored"] == []


class Test边界:
    def test_没有上一版不改(self):
        spec = {"pages": [{"id": "p1_page", "name": "报修台"}]}
        out, report = freeze_spec_pages(spec, [])
        assert [p["id"] for p in out["pages"]] == ["p1_page"]
        assert report["mapping"] == {}

    def test_新页保住(self):
        spec = {
            "pages": [
                {"id": "p1_page", "name": "报修台", "purpose": "a", "audience": "u"},
                {"id": "exception_board", "name": "异常看板", "purpose": "a", "audience": "u"},
            ]
        }
        out, report = freeze_spec_pages(spec, PREV4[:1])
        assert [p["id"] for p in out["pages"]] == ["p1", "exception_board"]
        assert report["mapping"] == {"p1_page": "p1"}

    def test_引用跟着拨(self):
        spec = {
            "pages": [{"id": "p1_page", "name": "报修台", "purpose": "a", "audience": "u"}],
            "landingPageRef": "p1_page",
        }
        out, _ = freeze_spec_pages(spec, PREV4[:1])
        assert out["landingPageRef"] == "p1"

    def test_不改传入对象(self):
        spec = {"pages": [{"id": "p1_page", "name": "报修台", "purpose": "a", "audience": "u"}]}
        freeze_spec_pages(spec, PREV4[:1])
        assert spec["pages"][0]["id"] == "p1_page"

    def test_结构侧不补页(self):
        structure = {
            "pages": [
                {"id": "p1_page", "name": "报修台", "kind": "workbench", "sourcePageId": "p1_page"}
            ]
        }
        out, report = freeze_spec_pages(structure, PREV4, PREV4, restore=False)
        assert [p["id"] for p in out["pages"]] == ["p1"]
        assert out["pages"][0]["sourcePageId"] == "p1"
        assert report["restored"] == []


class Test模型侧:
    def test_page与落地页一起拨(self):
        reuse = {"page": {"pages": [{"id": "p1", "name": "报修台"}]}}
        model = {
            "page": {"pages": [{"id": "p1_page", "name": "报修台"}]},
            "appbundle": {"landingPageRef": "p1_page", "pageBindings": [{"pageRef": "p1_page"}]},
        }
        out, report = freeze_pages_in_model(model, reuse)
        assert [p["id"] for p in out["page"]["pages"]] == ["p1"]
        assert out["appbundle"]["landingPageRef"] == "p1"
        assert out["appbundle"]["pageBindings"][0]["pageRef"] == "p1"
        assert report["mapping"] == {"p1_page": "p1"}
        assert model["page"]["pages"][0]["id"] == "p1_page"
