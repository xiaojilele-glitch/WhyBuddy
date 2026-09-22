"""干跑闸：真编排 + 桩 LLM。建设单 O-7。

判据：注册 ['spec','pages','bind'] 缺 assemble 必须拒。
反向：合法 product-rehearsal 干跑通过；html 生成器本身不许被打桩。
"""

from __future__ import annotations

import pytest

from services.workflow_registry import WorkflowPreset, register_workflow
from services.workflow_select import PAGES_PREVIEW, select_workflow
from services.workflow_validate import (
    WorkflowDryRunError,
    dry_run_workflow,
    register_validated_workflow,
    required_stages_for,
)


def test_bind_without_assemble_is_refused():
    """建设单 O-7：['spec','pages','bind'] 干跑必须指出缺 assemble。"""
    stages = (
        "specfirst.spec",
        "specfirst.design",
        "specfirst.pages",
        "specfirst.shell",
        "specfirst.bind",
    )
    bad = WorkflowPreset(
        name="bad-bind",
        stages=stages,
        tools=("spec", "pages", "bind"),
    )
    with pytest.raises(WorkflowDryRunError, match="assemble"):
        dry_run_workflow(bad)


def test_required_stages_put_assemble_next_to_bind():
    """变异：把 expand_tools 的 bind 闭包删掉 → 本条红，干跑闸也跟着瞎。"""
    required = required_stages_for(
        WorkflowPreset(
            name="need-assemble",
            stages=("specfirst.bind",),
            tools=("bind",),
        )
    )
    assert "specfirst.bind" in required
    assert "specfirst.assemble" in required


def test_product_rehearsal_dry_run_passes():
    dry_run_workflow(select_workflow())


def test_pages_preview_dry_run_passes():
    dry_run_workflow(select_workflow(name=PAGES_PREVIEW))


def test_new_presets_pass_the_dry_run_gate():
    """O-9 新日历必须过 O-7。没有干跑就扩库 = 批量生产跑不通的子集。"""
    from services.workflow_select import SPEC_PAGES_STRUCTURE, STRUCTURE_BIND

    dry_run_workflow(select_workflow(name=STRUCTURE_BIND))
    dry_run_workflow(select_workflow(name=SPEC_PAGES_STRUCTURE))


def test_new_presets_are_not_the_incomplete_bind_subset():
    """反向：structure-bind 若漏 assemble，干跑必须红。"""
    from services.capability_plan import expand_tools
    from services.workflow_select import STRUCTURE_BIND_TOOLS

    required = expand_tools(STRUCTURE_BIND_TOOLS)
    assert "specfirst.assemble" in required
    bad = WorkflowPreset(
        name="almost-structure-bind",
        stages=tuple(s for s in required if s != "specfirst.assemble"),
        tools=STRUCTURE_BIND_TOOLS,
    )
    with pytest.raises(WorkflowDryRunError, match="assemble"):
        dry_run_workflow(bad)


def test_dry_run_calls_real_page_generator_not_a_fake(monkeypatch):
    """只桩 LLM：generate_pages_parallel 必须还是真函数。"""
    from services import spec_page_html

    real = spec_page_html.generate_pages_parallel
    seen = {"n": 0}

    def spy(*args, **kwargs):
        seen["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", spy)
    dry_run_workflow(select_workflow(tools=("spec", "pages")))
    assert seen["n"] >= 1, "干跑没走到画页——桩打到 html 生成器上了，或者没进引擎"


def test_dry_run_does_not_call_live_llm(monkeypatch):
    """反向：干跑时真 LLM 入口必须被桩掉。变异：拿掉 stub_llm_host → 本条红。"""
    hits = []

    def boom(*_a, **_k):
        hits.append("live")
        raise AssertionError("干跑打到了真 LLM")

    monkeypatch.setattr("sliderule_llm.client.call_llm_json", boom)
    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", boom)
    dry_run_workflow(select_workflow(tools=("spec",)))
    assert hits == []


def test_register_validated_rejects_before_leaf():
    bad = WorkflowPreset(
        name="still-bad-bind",
        stages=("specfirst.bind",),
        tools=("bind",),
    )
    with pytest.raises(WorkflowDryRunError, match="assemble"):
        register_validated_workflow(bad)
    with pytest.raises(KeyError):
        from services.workflow_registry import workflow_for

        workflow_for("still-bad-bind")


def test_leaf_registry_stays_a_leaf():
    import inspect

    from services import workflow_registry as wr

    src = inspect.getsource(wr)
    assert "run_spec_first" not in src
    assert "workflow_validate" not in src


def test_stub_llm_host_is_the_only_patch():
    """变异：改成桩 generate_pages_parallel → 本条红。"""
    import inspect

    from services import workflow_validate as wv

    src = inspect.getsource(wv.stub_llm_host)
    assert "call_llm" in src
    assert "generate_pages_parallel" not in src
    assert "html_bindings" not in src


def test_register_workflow_still_rejects_bind_without_assemble():
    """叶子那道便宜闸还在。干跑是整类，这道是同一事实的快路径。"""
    with pytest.raises(ValueError, match="assemble"):
        register_workflow(WorkflowPreset("bind-without-model-2", ("specfirst.bind",)))


def test_dry_run_returns_a_validation_report():
    """对照 grok validate_script：合法脚本过，报告带 name。"""
    from services.workflow_validate import ValidationReport

    report = dry_run_workflow(select_workflow(tools=("spec", "pages")))
    assert isinstance(report, ValidationReport)
    assert report.outcome_ok
    assert report.phases >= 1


def test_default_probe_args_seed_spec_and_pages():
    """对照 grok default_probe_args：不自带 spec 的日历也有垫子。"""
    from services.workflow_validate import default_probe_args

    args = default_probe_args()
    assert args["goal"]
    assert args["spec"]["pages"]
    assert args["pages"]


def test_dry_run_walks_structure_not_a_clip(monkeypatch):
    """grok 走完整脚本。变异：walk 再裁回 spec/pages → 本条红。"""
    from services import html_structure

    real = html_structure.derive_structure
    seen = {"n": 0}

    def spy(*args, **kwargs):
        seen["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr("services.html_structure.derive_structure", spy)
    from services.capability_plan import expand_tools

    dry_run_workflow(
        WorkflowPreset(
            name="structure-bind-probe",
            stages=expand_tools(("structure", "bind")),
            tools=("structure", "bind"),
        )
    )
    assert seen["n"] >= 1, "structure-bind 干跑没走进结构步——walk 被裁掉了"


def test_host_does_not_feed_spec_json_to_structure():
    """变异：host 不分种类、一律回 spec 罐头 → 结构步 HtmlStructureError。"""
    from services.workflow_validate import _host_kind

    assert _host_kind('{"version": "html-structure-v1", "sourcePageId": "p1"}') == "structure"
    assert _host_kind("personaRef 与 assigneeRole") == "semantics"
    assert _host_kind("pageBindings 与 fieldBindings") == "assemble"
    assert _host_kind("绑定词汇：只往标签上加 data-*") == "bind_html"
    assert _host_kind("Use Tailwind CDN and front-end HTML") == "html"
    assert _host_kind("Produce the spec JSON now") == "spec"


def test_startup_self_check_is_wired():
    """装配根必须真的调干跑。变异：app.py 里那行调用删掉 → 本条红。"""
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "app.py").read_text(encoding="utf-8")
    assert "dry_run_registered_calendars" in src
    assert "_dry_run_calendars()" in src
    assert "workflow calendars dry-ran" in src
