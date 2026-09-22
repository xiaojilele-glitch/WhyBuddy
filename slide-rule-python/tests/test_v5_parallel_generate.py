from __future__ import annotations

import copy
import sys
import threading
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_model_gate import validate_five_system_model
from services.v5_parallel_generate import (
    _contract_instruction,
    _section_instruction,
    assemble_appbundle,
    generate_parallel_five_system_model,
    regenerate_failed_sections,
)


def _fixture():
    contract = {
        "entities": [
            {
                "id": "loan",
                "name": "Loan",
                "fields": [
                    {"id": "title", "name": "Title", "type": "string"},
                    {"id": "status", "name": "Status", "type": "enum"},
                ],
            }
        ],
        "roles": [
            {"id": "member", "name": "Member"},
            {"id": "librarian", "name": "Librarian"},
        ],
        "permissions": ["loan:view", "loan:update"],
        "menus": [
            {
                "id": "loans",
                "label": "Loans",
                "roleRefs": ["member", "librarian"],
                "permissionRefs": ["loan:view", "loan:update"],
            }
        ],
        "workflow": {
            "id": "loan_flow",
            "name": "Loan flow",
            "nodes": [
                {"id": "requested", "name": "Requested", "assigneeRole": "member", "phase": "Apply"},
                {"id": "reviewed", "name": "Reviewed", "assigneeRole": "librarian", "phase": "Review"},
            ],
            "transitions": [{"from": "requested", "to": "reviewed"}],
            "chains": [],
        },
        "pages": [
            {
                "id": "loan_home",
                "name": "Loans",
                "kind": "workbench",
                "presentation": "application",
                "fieldBindings": ["loan.title", "loan.status"],
                "actionPermissions": ["loan:view", "loan:update"],
            }
        ],
        "pageBindings": [{"pageRef": "loan_home", "workflowRef": "loan_flow"}],
        "aigcIntents": [
            {
                "id": "summarize_loan",
                "name": "Summarize loan",
                "inputFields": ["loan.title"],
                "outputField": "loan.title",
                "roleRefs": ["librarian"],
            }
        ],
        "aigcPipelines": [],
        "landingPageRef": "loan_home",
        "preferredDevice": "desktop",
        "appIdentity": {"productName": "BookDesk", "theme": "azure", "icon": "book", "nav": "side"},
        "invariants": [
            {
                "id": "review_before_update",
                "statement": "A librarian reviews a loan before its status changes.",
                "systems": ["workflow", "rbac", "datamodel"],
                "refs": ["reviewed", "librarian", "loan.status", "loan:update"],
            }
        ],
    }
    sections = {
        "datamodel": {"entities": copy.deepcopy(contract["entities"])},
        "rbac": {
            "roles": copy.deepcopy(contract["roles"]),
            "permissions": list(contract["permissions"]),
            "menus": copy.deepcopy(contract["menus"]),
        },
        "workflow": {
            "id": "loan_flow",
            "name": "Loan flow",
            "nodes": [
                {"id": "requested", "name": "Requested", "assigneeRole": "member", "phase": "Apply"},
                {"id": "reviewed", "name": "Reviewed", "assigneeRole": "librarian", "phase": "Review"},
            ],
            "transitions": [{"from": "requested", "to": "reviewed"}],
            "chains": [],
        },
        "page": {
            "pages": [
                {
                    **copy.deepcopy(contract["pages"][0]),
                    "surface": {"type": "table", "density": "default"},
                }
            ]
        },
        "aigc": {
            "capabilities": [
                {
                    "id": "summarize_loan",
                    "name": "Summarize loan",
                    "inputFields": ["loan.title"],
                    "outputField": "loan.title",
                    "roleRefs": ["librarian"],
                }
            ]
        },
    }
    return contract, sections


def test_parallel_generator_runs_bounded_waves_and_assembles_appbundle():
    contract, sections = _fixture()
    first_barrier = threading.Barrier(3, timeout=2)
    second_barrier = threading.Barrier(2, timeout=2)
    calls = []
    lock = threading.Lock()

    def fake_call(_messages, required_keys, _max_tokens):
        key = required_keys[0]
        with lock:
            calls.append(key)
        if key == "contract":
            return {"contract": copy.deepcopy(contract)}
        if key in {"datamodel", "rbac", "workflow"}:
            first_barrier.wait()
        elif key in {"page", "aigc"}:
            second_barrier.wait()
        return {key: copy.deepcopy(sections[key])}

    model = generate_parallel_five_system_model(
        "Build a desktop library system",
        user_context="Build a desktop library system",
        call_json=fake_call,
    )

    assert model is not None
    assert calls[0] == "contract"
    assert set(calls[1:4]) == {"datamodel", "rbac", "workflow"}
    assert set(calls[4:]) == {"page", "aigc"}
    assert "appbundle" not in calls
    assert model["appbundle"]["landingPageRef"] == "loan_home"
    assert model["appbundle"]["pageBindings"] == [
        {"pageRef": "loan_home", "workflowRef": "loan_flow"}
    ]
    gate = validate_five_system_model(
        model,
        require_landing_page_ref=True,
        require_preferred_device=True,
    )
    assert gate["passed"] is True, gate["findings"]


def test_public_generator_uses_parallel_dag_for_initial_production_path(monkeypatch):
    from services import v5_llm_generate

    contract, sections = _fixture()
    calls = []

    def fake_call(_messages, required_keys, _max_tokens):
        key = required_keys[0]
        calls.append(key)
        if key == "contract":
            return {"contract": copy.deepcopy(contract)}
        return {key: copy.deepcopy(sections[key])}

    monkeypatch.setenv("SLIDERULE_PARALLEL_MODEL_GENERATION", "on")
    monkeypatch.setattr(v5_llm_generate, "_parallel_json_call", fake_call)
    v5_llm_generate.set_refine_context(None)
    v5_llm_generate.set_model_override(None)

    model = v5_llm_generate.generate_five_system_model("Build a desktop library system")

    assert model is not None
    assert calls[0] == "contract"
    assert set(calls[1:]) == {"datamodel", "rbac", "workflow", "page", "aigc"}
    assert "appbundle" not in calls


def test_parallel_generator_is_fail_closed_when_required_worker_fails():
    contract, sections = _fixture()

    def fake_call(_messages, required_keys, _max_tokens):
        key = required_keys[0]
        if key == "contract":
            return {"contract": copy.deepcopy(contract)}
        if key == "rbac":
            return None
        return {key: copy.deepcopy(sections[key])}

    assert generate_parallel_five_system_model(
        "Build a library system",
        user_context="Build a library system",
        call_json=fake_call,
    ) is None


def test_contract_semantic_failure_reasks_only_contract_node():
    contract, sections = _fixture()
    calls = []

    def fake_call(_messages, required_keys, _max_tokens):
        key = required_keys[0]
        calls.append(key)
        if key == "contract" and calls.count("contract") == 1:
            broken = copy.deepcopy(contract)
            broken["aigcIntents"] = []
            return {"contract": broken}
        if key == "contract":
            return {"contract": copy.deepcopy(contract)}
        return {key: copy.deepcopy(sections[key])}

    model = generate_parallel_five_system_model(
        "Build a library system",
        user_context="Build a library system",
        call_json=fake_call,
    )

    assert model is not None
    assert calls.count("contract") == 2
    assert calls.count("datamodel") == 1
    assert calls.count("rbac") == 1
    assert calls.count("workflow") == 1
    assert calls.count("page") == 1
    assert calls.count("aigc") == 1


def test_contract_semantic_failure_reasks_when_architecture_was_compacted():
    contract, sections = _fixture()
    calls = []

    def fake_call(_messages, required_keys, _max_tokens):
        key = required_keys[0]
        calls.append(key)
        if key == "contract" and calls.count("contract") == 1:
            compact = copy.deepcopy(contract)
            compact["workflow"] = {"id": "loan_flow", "name": "Loan flow", "chainIntents": []}
            compact.pop("pageBindings")
            compact.pop("invariants")
            compact["aigcIntents"] = [{"id": "summarize_loan", "name": "Summarize loan"}]
            return {"contract": compact}
        if key == "contract":
            return {"contract": copy.deepcopy(contract)}
        return {key: copy.deepcopy(sections[key])}

    model = generate_parallel_five_system_model(
        "Build a library system",
        user_context="Build a library system",
        call_json=fake_call,
    )

    assert model is not None
    assert calls.count("contract") == 2


def test_appbundle_preserves_explicit_contract_page_bindings_only():
    contract, sections = _fixture()
    sections["page"]["pages"].append(
        {
            "id": "loan_report",
            "name": "Loan report",
            "kind": "dashboard",
            "presentation": "application",
            "fieldBindings": ["loan.status"],
            "actionPermissions": ["loan:view"],
        }
    )

    bundle = assemble_appbundle(sections, contract)

    assert bundle["pageBindings"] == [
        {"pageRef": "loan_home", "workflowRef": "loan_flow"}
    ]


def test_targeted_repair_regenerates_only_affected_section():
    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = assemble_appbundle(model, contract)
    calls = []

    replacement_page = copy.deepcopy(sections["page"])
    replacement_page["pages"][0]["name"] = "Repaired loans"

    def fake_call(_messages, required_keys, _max_tokens):
        calls.append(required_keys[0])
        return {"page": copy.deepcopy(replacement_page)}

    repaired = regenerate_failed_sections(
        "Build a library system",
        model,
        [
            {
                "affectedSkill": "page",
                "path": "page.pages[loan_home].fieldBindings",
                "message": "bad field",
            }
        ],
        call_json=fake_call,
    )

    assert repaired is not None
    assert calls == ["page"]
    assert repaired["page"]["pages"][0]["name"] == "Repaired loans"
    assert repaired["datamodel"] == model["datamodel"]
    assert repaired["rbac"] == model["rbac"]
    assert repaired["workflow"] == model["workflow"]
    assert repaired["aigc"] == model["aigc"]


def test_appbundle_only_repair_uses_no_llm():
    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = {"landingPageRef": "missing", "preferredDevice": "desktop"}

    repaired = regenerate_failed_sections(
        "Build a library system",
        model,
        [{"affectedSkill": "appbundle", "path": "appbundle.landingPageRef", "message": "missing"}],
        call_json=lambda *_args: (_ for _ in ()).throw(AssertionError("LLM must not run")),
    )

    assert repaired is not None
    assert repaired["appbundle"]["landingPageRef"] == "loan_home"
    assert repaired["appbundle"]["pageBindings"] == [
        {"pageRef": "loan_home", "workflowRef": "loan_flow"}
    ]


def test_section_prompts_consume_runtime_legal_domains():
    contract_prompt = _contract_instruction()
    datamodel_prompt = _section_instruction("datamodel")
    page_prompt = _section_instruction("page")

    assert "This contract is intentionally complete" in contract_prompt
    assert '"pageBindings"' in contract_prompt
    assert '"aigcPipelines"' in contract_prompt
    assert '"invariants"' in contract_prompt
    assert "EXPERIENCE BLOCK CATALOG (closed set)" in contract_prompt
    assert "Date/ref/enum fields MUST omit format" in datamodel_prompt
    assert "masked" in datamodel_prompt
    assert "Closed page domains from the runtime schema" in page_prompt
    assert "EXPERIENCE BLOCK CATALOG (closed set)" in page_prompt


def test_deterministic_repair_clears_illegal_field_format_without_llm():
    from services.v5_model_repair import repair_five_system_model

    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = assemble_appbundle(model, contract)
    model["datamodel"]["entities"][0]["fields"][0]["format"] = "phone-CN"

    result = repair_five_system_model(model)

    repaired_field = result["model"]["datamodel"]["entities"][0]["fields"][0]
    assert "format" not in repaired_field
    assert {
        "entityId": "loan",
        "fieldId": "title",
        "format": "phone-CN",
    } in result["model"]["appbundle"]["presentationNotes"]["clearedFormats"]
    gate = validate_five_system_model(
        result["model"],
        require_landing_page_ref=True,
        require_preferred_device=True,
    )
    assert gate["passed"] is True, gate["findings"]


def test_deterministic_repair_restores_flattened_calendar_field_ref():
    from services.v5_model_repair import repair_five_system_model

    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = assemble_appbundle(model, contract)
    model["datamodel"]["entities"][0]["fields"].append(
        {"id": "due_date", "name": "Due date", "type": "date"}
    )
    page = model["page"]["pages"][0]
    page["kind"] = "calendar"
    page["dateField"] = "loan_due_date"
    page["fieldBindings"].append("loan.due_date")

    result = repair_five_system_model(model)

    repaired_page = result["model"]["page"]["pages"][0]
    assert repaired_page["dateField"] == "loan.due_date"
    assert {
        "pageId": "loan_home",
        "path": "dateField",
        "from": "loan_due_date",
        "to": "loan.due_date",
    } in result["model"]["appbundle"]["presentationNotes"]["repaired"]
    gate = validate_five_system_model(
        result["model"],
        require_landing_page_ref=True,
        require_preferred_device=True,
    )
    assert gate["passed"] is True, gate["findings"]


def test_deterministic_repair_restores_page_and_aigc_cross_refs():
    from services.v5_model_repair import repair_five_system_model

    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = assemble_appbundle(model, contract)
    page = model["page"]["pages"][0]
    page["fieldBindings"] = ["loan_title", "loan_status"]
    page["actionPermissions"] = ["loan_view", "loan_update"]
    capability = model["aigc"]["capabilities"][0]
    capability["inputFields"] = ["loan_title"]
    capability["outputField"] = "loan_title"

    result = repair_five_system_model(model)

    repaired = result["model"]
    assert repaired["page"]["pages"][0]["fieldBindings"] == ["loan.title", "loan.status"]
    assert repaired["page"]["pages"][0]["actionPermissions"] == [
        "loan:view",
        "loan:update",
    ]
    assert repaired["aigc"]["capabilities"][0]["inputFields"] == ["loan.title"]
    assert repaired["aigc"]["capabilities"][0]["outputField"] == "loan.title"
    gate = validate_five_system_model(
        repaired,
        require_landing_page_ref=True,
        require_preferred_device=True,
    )
    assert gate["passed"] is True, gate["findings"]


def test_deterministic_repair_drops_single_step_aigc_pipeline():
    from services.v5_model_repair import repair_five_system_model

    contract, sections = _fixture()
    model = copy.deepcopy(sections)
    model["appbundle"] = assemble_appbundle(model, contract)
    model["aigc"]["pipelines"] = [
        {
            "id": "single_step",
            "name": "Not an orchestration",
            "steps": ["summarize_loan"],
        }
    ]

    result = repair_five_system_model(model)

    repaired = result["model"]
    assert "pipelines" not in repaired["aigc"]
    assert repaired["appbundle"]["presentationNotes"]["droppedPipelines"] == [
        {
            "pipelineId": "single_step",
            "reason": "pipeline has fewer than two capabilities",
        }
    ]
    gate = validate_five_system_model(
        repaired,
        require_landing_page_ref=True,
        require_preferred_device=True,
    )
    assert gate["passed"] is True, gate["findings"]


# ── 默认开关（2026-08-06）────────────────────────────────────────────
def test_parallel_generation_is_off_by_default():
    """并行生成默认必须是**关**的，直到它能稳定出货。

    实测三趟（同话题、同模型 gpt-5.6-luna / api.rcouyi.com）：

        并行 第 1 趟   ❌ 生成失败   569.6s
        并行 第 2 趟   ❌ 生成失败   738.0s
        串行           ✅ 成功       236.0s

    两趟失败判词一致（Contract 校验过不去），且 v5_llm_generate 里
    `attempts = 1 if use_parallel else 2` —— 并行没有串行兜底，Contract 挂了
    整趟返回 None。默认打开等于把能用的老路径永久遮住。

    要改回 on 之前，先把这两件做完并有实测支撑：
      ① 并行失败时回落串行
      ② Contract 瘦身成真正的 ID 骨架（同时放宽 _contract_problems 的字段级校验）
    """
    import os

    import services.v5_parallel_generate as P

    saved = os.environ.pop("SLIDERULE_PARALLEL_MODEL_GENERATION", None)
    try:
        assert P.parallel_generation_enabled() is False, "并行生成不能默认开启"
    finally:
        if saved is not None:
            os.environ["SLIDERULE_PARALLEL_MODEL_GENERATION"] = saved


def test_parallel_generation_can_still_be_turned_on():
    """开关本身要留着——调试和修好之后都要用它。"""
    import os

    import services.v5_parallel_generate as P

    saved = os.environ.get("SLIDERULE_PARALLEL_MODEL_GENERATION")
    try:
        for on in ("1", "true", "yes", "on"):
            os.environ["SLIDERULE_PARALLEL_MODEL_GENERATION"] = on
            assert P.parallel_generation_enabled() is True, f"{on} 应该能打开"
    finally:
        if saved is None:
            os.environ.pop("SLIDERULE_PARALLEL_MODEL_GENERATION", None)
        else:
            os.environ["SLIDERULE_PARALLEL_MODEL_GENERATION"] = saved
