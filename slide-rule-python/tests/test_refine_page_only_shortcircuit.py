# -*- coding: utf-8 -*-
"""page-only 短路必须接在 run_spec_first 上（2026-08-18）。

只测 helper 会假绿：把调用点删掉，单元测试照样过，真机继续先做再盖。
这组跑真实控制流，seed 固定为 page:p1（图闭包 segments=page）。
"""

import inspect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_first_pipeline as sfp  # noqa: E402
from tests.test_refine_short_circuit import MODEL  # noqa: E402

PREV_PAGES = {"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"}


def _code(mod) -> str:
    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_short_circuit_is_wired_into_the_live_run_spec_first():
    """纪律一：短路函数必须出现在 run_spec_first 控制流里，不是只写了个 helper。"""
    src = _code(sfp.run_spec_first)
    assert "hold_spec_from_reuse" in src, "规格打补丁没接到 run_spec_first"
    assert "is_page_only_verdict" in src, "page-only 判据没接到 run_spec_first"
    assert "merge_held_structure" in src, "未改页结构沿用没接到 run_spec_first"
    assert "overlay_page_only_model" in src, "权限流程沿用没接到 run_spec_first"
    assert "format_refine_reuse_note" in src, "左栏收口句没从 pipeline 写出来"


def test_helper_names_in_comments_alone_do_not_count():
    """反向：剥注释后还在。注释里写这些名字，不剥必然假绿。"""
    raw = inspect.getsource(sfp.run_spec_first)
    stripped = _code(sfp.run_spec_first)
    assert "hold_spec_from_reuse" in raw and "hold_spec_from_reuse" in stripped


def _drive(monkeypatch, *, seed="page:p1", shortcircuit=True):
    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.refine_graph_scope as rgs
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree

    seen = {"spec": 0, "semantics": 0, "assemble": 0, "structure_pages": []}

    def fake_spec(*a, **k):
        seen["spec"] += 1
        raise AssertionError("page-only 仍在整本重写 SPEC")

    def fake_structure(pages, **kw):
        seen["structure_pages"].append(sorted(pages.keys()))
        return {
            "entities": [{
                "id": "order", "name": "订单", "evidence": "订单",
                "fields": [
                    {"id": "amount", "name": "金额", "type": "number", "evidence": "金额"},
                ],
            }],
            "pages": [{
                "id": pid, "name": pid, "kind": "workbench",
                "sourcePageId": pid, "evidence": "画面",
            } for pid in pages],
        }

    def fake_sem(*a, **k):
        seen["semantics"] += 1
        return {"roles": [], "workflowNodes": []}

    def fake_assemble(*a, **k):
        seen["assemble"] += 1
        return {"model": {"datamodel": {}}, "gate": {"passed": True}}

    monkeypatch.setattr(spec_tree, "generate_spec_tree", fake_spec)
    monkeypatch.setattr(rgs, "decide_seed_nodes", lambda i, g, **kw: [seed])
    monkeypatch.setattr(sph, "generate_pages_parallel", lambda spec, **kw: {
        "pages": {
            **{pid: html for pid, html in (kw.get("reuse_pages") or {}).items()},
            **{
                pid: f"<html>新-{pid}</html>"
                for pid in ("p1", "p2")
                if pid not in (kw.get("reuse_pages") or {})
            },
        },
        "failed": {},
    })
    monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", fake_structure)
    monkeypatch.setattr(ss, "derive_semantics", fake_sem)
    monkeypatch.setattr(ma, "assemble", fake_assemble)
    monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})
    if not shortcircuit:
        monkeypatch.setenv("SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT", "0")

    out = sfp.run_spec_first(
        "做个工单系统",
        refine={"instruction": "订单页加催离按钮", "modelDigest": "d"},
        reuse_model=MODEL,
        reuse_pages=PREV_PAGES,
    )
    seen["out"] = out
    return seen


def test_page_only_does_not_rewrite_spec_or_semantics(monkeypatch):
    seen = _drive(monkeypatch)
    assert seen["spec"] == 0, "图只碰 page 仍整本重写了规格"
    assert seen["out"]["spec"]["refineScope"] == [], "refineScope 不是 []，6.2 不敢沿用"
    first = seen["structure_pages"][0]
    assert first == ["p1"], f"结构步仍吃了未改页：{seen['structure_pages']}"
    assert "p2" not in first
    note = seen["out"].get("refineReuseNote") or ""
    assert "改了" in note and "沿用" in note
    assert "步" not in note
    # 权限/流程：overlay 过闸则不调；过不了闸允许回落，但不得先编再盖无痕
    if seen["semantics"] == 0:
        assert seen["assemble"] == 0
        assert seen["out"]["stages"]["semantics"].get("skipped") == "page-only"
    assert seen["out"]["spec"].get("pages")


def test_switch_off_falls_back_to_full_spec(monkeypatch):
    """杆必须接到真链。关掉还短路，线上退不回去。"""
    seen = {"spec": 0}

    def fake_spec(*a, **k):
        seen["spec"] += 1
        return {
            "rootNodeId": "n0", "version": 3, "appName": "订单台",
            "personas": [{"id": "u1", "name": "店长", "goals": ["看单"]}],
            "successCriteria": [{"id": "sc1", "text": "能下单"}],
            "nodes": [],
            "pages": [{"id": "p1", "name": "订单页"}, {"id": "p2", "name": "客户页"}],
            "refineScope": [],
        }

    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.refine_graph_scope as rgs
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree

    monkeypatch.setenv("SLIDERULE_REFINE_PAGE_ONLY_SHORTCIRCUIT", "0")
    monkeypatch.setattr(spec_tree, "generate_spec_tree", fake_spec)
    monkeypatch.setattr(rgs, "decide_seed_nodes", lambda i, g, **kw: ["page:p1"])
    monkeypatch.setattr(
        sph, "generate_pages_parallel",
        lambda spec, **kw: {"pages": {"p1": "<html>x</html>", "p2": "<html>y</html>"}, "failed": {}},
    )
    monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
    monkeypatch.setattr(ss, "derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr(ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}})
    monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

    sfp.run_spec_first(
        "做个工单系统",
        refine={"instruction": "加按钮", "modelDigest": "d"},
        reuse_model=MODEL,
        reuse_pages=PREV_PAGES,
    )
    assert seen["spec"] == 1, "开关关了还在短路——退回杆是假的"


def test_empty_segments_must_not_short_circuit(monkeypatch):
    """空 segments 当 page-only = 拿含糊当授权。"""
    import services.refine_graph_scope as rgs

    monkeypatch.setattr(
        rgs, "graph_scope_verdict",
        lambda g, s, **kw: {"seeds": s, "impacted": [], "pages": ["p1"], "segments": []},
    )
    seen = {"spec": 0}

    def fake_spec(*a, **k):
        seen["spec"] += 1
        return {
            "rootNodeId": "n0", "version": 3, "appName": "订单台",
            "personas": [{"id": "u1", "name": "店长", "goals": ["看单"]}],
            "successCriteria": [{"id": "sc1", "text": "能下单"}],
            "nodes": [],
            "pages": [{"id": "p1", "name": "订单页"}, {"id": "p2", "name": "客户页"}],
        }

    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree

    monkeypatch.setattr(spec_tree, "generate_spec_tree", fake_spec)
    monkeypatch.setattr(rgs, "decide_seed_nodes", lambda i, g, **kw: ["page:p1"])
    monkeypatch.setattr(
        sph, "generate_pages_parallel",
        lambda spec, **kw: {"pages": {"p1": "<html>x</html>", "p2": "<html>y</html>"}, "failed": {}},
    )
    monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
    monkeypatch.setattr(ss, "derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr(ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}})
    monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

    sfp.run_spec_first(
        "做个工单系统",
        refine={"instruction": "加按钮", "modelDigest": "d"},
        reuse_model=MODEL,
        reuse_pages=PREV_PAGES,
    )
    assert seen["spec"] == 1, "segments 空也被当成 page-only 短路了"


def test_reuse_note_reads_spec_first_pages_after_take():
    """真机：页面落库先 take，闭环再建才读 note。只 peek 必空。"""
    from models.v5_state import V5SessionState
    from services import v5_capability_executor as ex

    note = "改了 售后及缺货退款管理页（p5） · 沿用 4 页 · 规格、权限、流程沿用"
    sfp._last_pages_var.set({"pages": {"p5": "<html/>"}, "refineReuseNote": note})
    state = V5SessionState(sessionId="sr-note", goal={"text": "团购"})
    ex._cache_spec_first_pages(state)
    assert (state.specFirstPages or {}).get("refineReuseNote") == note
    assert sfp.peek_last_pages() is None, "take 之后 peek 必须空——这就是真机左栏丢句的形状"
    assert ex._refine_reuse_note_from_pages() == "", "不传 state 就读不到已落库的那份"
    assert ex._refine_reuse_note_from_pages(state) == note


def test_closure_rebuild_passes_state_into_reuse_note():
    """接线：闭环重建必须把 state 传进去。删掉实参，这条红。"""
    from services import v5_capability_executor as ex

    src = _code(ex.execute_v5_capability)
    assert "_refine_reuse_note_from_pages(state)" in src, (
        "闭环重建没把 state 传给收口句——take 之后左栏继续写步数"
    )
