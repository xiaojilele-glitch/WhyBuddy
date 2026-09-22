# -*- coding: utf-8 -*-
"""图只碰到页面时：规格打补丁、权限流程直接沿用、未改页数据结构沿用。

洗衣房真机 graphSegments=page 仍先整本重写 SPEC、再编权限、再 6.2 盖回。
这组钉的是短路本身；接到 run_spec_first 的那一针在
test_refine_page_only_shortcircuit.py（删调用点必须红）。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.refine_short_circuit import (  # noqa: E402
    format_refine_reuse_note,
    hold_spec_from_reuse,
    is_page_only_verdict,
    merge_held_structure,
    overlay_page_only_model,
    page_only_shortcircuit_enabled,
)


MODEL = {
    "datamodel": {"entities": [
        {"id": "order", "name": "订单", "fields": [
            {"id": "amount", "name": "金额", "type": "number"},
        ]},
        {"id": "cust", "name": "客户", "fields": [
            {"id": "phone", "name": "电话", "type": "string"},
        ]},
    ]},
    "rbac": {
        "roles": [{"id": "mgr", "name": "店长"}, {"id": "clerk", "name": "店员"}],
        "permissions": ["order:read"],
        "menus": [{"id": "m1", "label": "订单", "roleRefs": ["mgr"], "permissionRefs": ["order:read"]}],
    },
    "workflow": {"nodes": [
        {"id": "submit", "name": "提交", "assigneeRole": "clerk"},
    ]},
    "page": {"pages": [
        {"id": "p1", "name": "订单页", "kind": "workbench",
         "fieldBindings": ["order.amount"], "actionPermissions": ["order:read"]},
        {"id": "p2", "name": "客户页", "kind": "workbench",
         "fieldBindings": ["cust.phone"]},
    ]},
    "aigc": {"capabilities": [
        {"id": "sum1", "name": "摘要", "inputFields": ["order.amount"], "roleRefs": ["mgr"]},
    ]},
    "appbundle": {
        "landingPageRef": "p1",
        "preferredDevice": "desktop",
        "pageBindings": [{"pageRef": "p1", "workflowRef": "submit"}],
        "roleRefs": ["mgr"],
        "dataModelRefs": ["order", "cust"],
        "appIdentity": {"appName": "订单台"},
    },
}


class Test判据:
    def test_segments恰好是page才算(self):
        assert is_page_only_verdict({"pages": ["p3"], "segments": ["page"]})
        assert not is_page_only_verdict({"pages": ["p3"], "segments": []})
        assert not is_page_only_verdict({"pages": ["p3"], "segments": ["page", "rbac"]})
        assert not is_page_only_verdict({"pages": [], "segments": ["page"]})
        assert not is_page_only_verdict(None)

    def test_开关默认开_显式关才关(self, monkeypatch):
        monkeypatch.delenv("SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT", raising=False)
        assert page_only_shortcircuit_enabled()
        monkeypatch.setenv("SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT", "0")
        assert not page_only_shortcircuit_enabled()


class Test规格打补丁:
    def test_从上一版重建且refineScope是空列表(self):
        spec = hold_spec_from_reuse(MODEL, instruction="加催离按钮", scope_pages=["p1"])
        assert spec is not None
        assert spec["refineScope"] == []
        assert spec["refineScope"] is not None
        p1 = next(p for p in spec["pages"] if p["id"] == "p1")
        assert "加催离按钮" in p1["purpose"]
        p2 = next(p for p in spec["pages"] if p["id"] == "p2")
        assert "加催离按钮" not in p2["purpose"]

    def test_没有上一版页面就回None(self):
        assert hold_spec_from_reuse({"page": {"pages": []}}) is None
        assert hold_spec_from_reuse(None) is None


class Test未改页结构沿用:
    def test_只把重画页的新结构并进去(self):
        fresh = {
            "entities": [{
                "id": "order", "name": "订单", "evidence": "订单",
                "fields": [
                    {"id": "amount", "name": "金额", "type": "number", "evidence": "金额"},
                    {"id": "urge", "name": "催离", "type": "string", "evidence": "催离"},
                ],
            }],
            "pages": [{
                "id": "p1", "name": "订单页", "kind": "workbench",
                "sourcePageId": "p1", "evidence": "订单",
            }],
        }
        merged = merge_held_structure(
            fresh, MODEL, ["p2"], required_page_ids=["p1", "p2"],
        )
        assert merged is not None
        ids = {p["id"] for p in merged["pages"]}
        assert ids == {"p1", "p2"}
        order = next(e for e in merged["entities"] if e["id"] == "order")
        assert any(f["id"] == "urge" for f in order["fields"])
        assert any(e["id"] == "cust" for e in merged["entities"])

    def test_缺重画页就回None_让调用方全量反推(self):
        fresh = {"entities": [], "pages": []}
        assert merge_held_structure(
            fresh, MODEL, ["p2"], required_page_ids=["p1", "p2"],
        ) is None


class Test权限流程直接沿用:
    def test_overlay不改rbac和workflow(self):
        import copy
        import hashlib
        import json

        def fp(seg):
            return hashlib.sha256(
                json.dumps(seg, ensure_ascii=False, sort_keys=True).encode()
            ).hexdigest()

        out = overlay_page_only_model(MODEL, None)
        assert fp(out["rbac"]) == fp(MODEL["rbac"])
        assert fp(out["workflow"]) == fp(MODEL["workflow"])
        assert fp(out["aigc"]) == fp(MODEL["aigc"])
        assert out is not MODEL
        assert copy.deepcopy(MODEL)["rbac"] == MODEL["rbac"]


class Test收口句:
    def test_写清改了哪一页沿用了什么(self):
        note = format_refine_reuse_note(
            redrawn_ids=["p3"],
            reused_count=3,
            held_spec=True,
            held_semantics=True,
            held_structure=True,
            page_names={"p3": "异常条目"},
        )
        assert "改了 异常条目（p3）" in note
        assert "沿用 3 页" in note
        assert "规格" in note and "权限" in note and "流程" in note
        assert "步" not in note

    def test_首轮全量重画不编收口句(self):
        assert format_refine_reuse_note(redrawn_ids=["p1", "p2"], reused_count=0) == ""
