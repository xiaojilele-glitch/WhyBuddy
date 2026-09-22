"""structure 单跳必须真跑反推，不许只交 runtimeClosure 空信封。

2026-09-03 真机（团子的一天 turn-3）：goal.tools=['structure']，18 秒结束，
capabilityPlan 仍是 pages，spec 里没有 entities。控制面叙述「已经出过 4 页」。

抄 grok：WRITE 工具点下去必须真跑。T3 五系统开关不许把这一跳跳过。
"""

from __future__ import annotations

import inspect
import re
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services import v5_capability_executor as ex  # noqa: E402


def _code(obj) -> str:
    src = inspect.getsource(obj)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


class _Dump:
    def __init__(self, payload):
        self._p = payload

    def model_dump(self, mode="json"):
        return self._p


SPEC = {
    "appName": "团子的一天",
    "pages": [{"id": "p1", "name": "今日", "coversNodes": []}],
    "nodes": [],
}
PAGES = {"p1": "<!doctype html><html><body>今日打卡</body></html>"}


def test_run_spec_first_structure_hop_reuses_pages_and_derives(monkeypatch):
    derived = []

    def fake_derive(pages, **kw):
        derived.append(sorted(pages))
        return _Dump(
            {"entities": [{"id": "habit", "name": "习惯"}], "pages": [{"id": "p1"}]}
        )

    def fake_sem(structure, spec, **kw):
        return _Dump({"roles": [{"id": "self"}], "workflowNodes": []})

    def fake_assemble(structure, semantics, spec, **kw):
        return {
            "model": {
                "datamodel": structure,
                "rbac": {"roles": semantics.get("roles")},
                "page": {"pages": [{"id": "p1"}]},
                "workflow": {"nodes": []},
                "aigc": {},
                "appbundle": {},
            }
        }

    monkeypatch.setattr("services.html_structure.derive_structure", fake_derive)
    monkeypatch.setattr("services.spec_semantics.derive_semantics", fake_sem)
    monkeypatch.setattr("services.model_assembly.assemble", fake_assemble)

    out = sfp.run_spec_first(
        "团子的一天",
        tools=["structure"],
        reuse_spec=SPEC,
        reuse_pages=PAGES,
        preferred_device="phone",
        product_archetype="free_app",
        bind_html=False,
        llm_json_fn=lambda *a, **k: (_ for _ in ()).throw(
            AssertionError("structure 跳不该再调未 mock 的 LLM")
        ),
    )
    assert derived == [["p1"]], f"没有把上一跳页面送去反推：{derived}"
    plan = (out.get("stages") or {}).get("capabilityPlan") or {}
    assert plan.get("tools") == ["structure"], f"计划不是 structure：{plan}"
    assert "structure" in (out.get("stages") or {}), "structure 阶段没跑"
    entities = ((out.get("model") or {}).get("datamodel") or {}).get("entities") or []
    assert any(e.get("id") == "habit" for e in entities), f"没有反推出实体：{entities}"


def test_execute_runtime_closure_force_runs_structure_even_if_generate_flag_off(
    monkeypatch,
):
    """T3 开关默认关。用户点 structure 仍必须进 run_spec_first。

    变异：把 force_llm=_host_hop 删掉 → 本条红（called 空）。
    """
    called = []

    def fake_run_spec_first(goal, **kw):
        called.append(list(kw.get("tools") or []))
        sfp._last_pages_var.set(
            {
                "spec": SPEC,
                "pages": dict(PAGES),
                "capabilityPlan": {
                    "name": "product-rehearsal",
                    "tools": ["structure"],
                    "capabilities": ["specfirst.structure"],
                },
                "structure": {"entities": [{"id": "habit"}]},
            }
        )
        return {"model": None, "spec": SPEC, "pages": dict(PAGES)}

    monkeypatch.setattr(ex, "_llm_generate_enabled", lambda: False)
    monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run_spec_first)
    monkeypatch.setattr("services.spec_first_pipeline.spec_first_enabled", lambda: True)
    monkeypatch.setattr(ex, "retrieve_evidence", lambda *a, **k: [])
    monkeypatch.setattr(ex, "generate_with_rag", lambda *a, **k: "ok")

    state = V5SessionState(
        sessionId="struct-hop",
        goal={"text": "团子的一天", "status": "clear", "tools": ["structure"]},
        specFirstPages={
            "spec": SPEC,
            "pages": dict(PAGES),
            "capabilityPlan": {
                "name": "product-rehearsal",
                "tools": ["pages"],
                "capabilities": ["specfirst.pages"],
            },
        },
    )
    ex.execute_v5_capability(
        "appbundle.runtimeClosure", state, [], "综合", "turn-3"
    )
    assert called == [["structure"]], f"没把 structure 交给 spec-first：{called}"
    called.clear()
    ex.execute_v5_capability(
        "factory.structure", state, [], "综合", "turn-4"
    )
    assert called == [["structure"]], (
        f"账本 id factory.structure 没进 spec-first：{called}"
    )
    plan = (state.specFirstPages or {}).get("capabilityPlan") or {}
    assert plan.get("tools") == ["structure"], (
        f"落库计划还停在 pages：{plan}。单跳无模型时也必须 cache。"
    )


def test_executor_wires_force_llm_for_host_hop():
    src = _code(ex.execute_v5_capability)
    assert "force_llm=_host_hop" in src
    assert "_cache_spec_first_pages(state)" in src
    assert "FACTORY_HOPS" in src
    assert "hop_from_factory_capability" in src
