"""
T3 tests — LLM generate() + structural closure gate.

Proves the gate logic is decoupled from LLM reliability (north-star): a fake
llm_json_fn drives generation with NO key + NO network.

  1. valid five-system model  -> gate passes -> closure 6/6
  2. dangling cross-ref model -> gate blocks -> fail-closed + precise finding
  3. missing section          -> gate blocks
  4. _build_per_skill_evidence wiring: fake llm closes a novel intent
"""

import os
import sys
import copy
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

#: 演示域夹具快路径 2026-08-10 起默认关（见 _demo_fixture_enabled 头注）。
#  这个文件绝大多数用例走的是 LLM 生成路径（新颖意图，_recognize_domain
#  返回 None，开关与它们无关），只有几条以"确定性域"为题的要显式开回来。
#  故意逐条标而不是整个文件 pytestmark：这里 LLM 路径才是主角，整个文件
#  开着会掩盖"用户路径不再走夹具"这件事。
_deterministic_domain = pytest.mark.usefixtures("demo_fixture_path")

from services.v5_model_gate import validate_five_system_model, DANGLING, MISSING_SECTION
from services.v5_llm_generate import generate_five_system_model
from services.v5_capability_executor import _build_per_skill_evidence, REQUIRED_EVIDENCE_KEYS
from models.v5_state import V5SessionState


@pytest.fixture(autouse=True)
def _this_file_is_the_gen5_socket(monkeypatch):
    """本文件测的是 GEN5 + 结构闸。spec-first 默认开且失败不再回落，
    不关掉的话假 LLM 根本走不到这里。"""
    monkeypatch.setattr(
        "services.spec_first_pipeline.spec_first_enabled", lambda: False
    )


def _valid_library_model():
    """A novel domain (library lending) with fully-resolved cross-refs."""
    return {
        "datamodel": {
            "entities": [
                {"id": "loan", "name": "借阅记录", "fields": [
                    {"id": "id", "name": "编号", "type": "string"},
                    {"id": "book_id", "name": "图书", "type": "ref"},
                    {"id": "due_date", "name": "应还日期", "type": "date"},
                    {"id": "status", "name": "状态", "type": "enum"},
                ]},
                {"id": "book", "name": "图书", "fields": [
                    {"id": "id", "name": "编号", "type": "string"},
                    {"id": "title", "name": "书名", "type": "string"},
                ]},
            ]
        },
        "rbac": {
            "roles": ["member", "librarian", "admin"],
            "permissions": ["loan:create", "loan:approve", "loan:view"],
            "menus": [
                {"id": "m_my_loans", "label": "我的借阅", "roleRefs": ["member"], "permissionRefs": ["loan:view"]},
                {"id": "m_approve", "label": "审批", "roleRefs": ["librarian"], "permissionRefs": ["loan:approve"]},
            ],
        },
        "workflow": {
            "id": "wf_loan",
            "nodes": [
                {"id": "submit", "name": "提交借阅", "assigneeRole": "member"},
                {"id": "review", "name": "馆员审核", "assigneeRole": "librarian"},
            ],
            "transitions": [{"from": "submit", "to": "review"}],
        },
        "page": {
            "pages": [
                {"id": "p_apply", "name": "借阅申请", "fieldBindings": ["loan.book_id", "loan.due_date"],
                 "actionPermissions": ["loan:create"]},
                {"id": "p_review", "name": "审核详情", "fieldBindings": ["loan.status"],
                 "actionPermissions": ["loan:approve"]},
            ]
        },
        "aigc": {
            "capabilities": [
                {"id": "c_reco", "name": "图书推荐", "inputFields": ["book.title"],
                 "outputField": "loan.book_id", "roleRefs": ["member"]},
            ]
        },
        "appbundle": {
            "pageBindings": [{"pageRef": "p_apply", "workflowRef": "wf_loan"},
                             {"pageRef": "p_review", "workflowRef": "review"}],
            "roleRefs": ["member", "librarian", "admin"],
            "dataModelRefs": ["loan", "book"],
            "landingPageRef": "p_apply",
        },
    }


def _broken_model():
    """Same, but workflow assignee + page binding + appbundle ref all dangle."""
    m = _valid_library_model()
    m["workflow"]["nodes"][1]["assigneeRole"] = "ghost_role"       # not in rbac.roles
    m["page"]["pages"][0]["fieldBindings"] = ["loan.nonexistent"]  # not in datamodel
    m["appbundle"]["pageBindings"][0]["pageRef"] = "p_missing"     # not in pages
    return m


def test_valid_model_passes_gate():
    result = validate_five_system_model(_valid_library_model())
    assert result["passed"] is True, result["findings"]
    assert result["findings"] == []


def test_generated_model_gate_requires_one_supported_preferred_device():
    for device in (None, "", "watch"):
        model = _valid_library_model()
        if device is not None:
            model["appbundle"]["preferredDevice"] = device

        result = validate_five_system_model(model, require_preferred_device=True)

        assert result["passed"] is False
        assert any(
            finding["path"] == "appbundle.preferredDevice"
            for finding in result["findings"]
        )

    for device in ("desktop", "phone", "tablet"):
        model = _valid_library_model()
        model["appbundle"]["preferredDevice"] = device

        result = validate_five_system_model(model, require_preferred_device=True)

        assert result["passed"] is True, result["findings"]


def test_historic_model_gate_remains_tolerant_of_missing_or_tablet_device():
    missing = validate_five_system_model(_valid_library_model())
    tablet_model = _valid_library_model()
    tablet_model["appbundle"]["preferredDevice"] = "tablet"
    tablet = validate_five_system_model(tablet_model)

    assert missing["passed"] is True, missing["findings"]
    assert tablet["passed"] is True, tablet["findings"]


def test_marketing_landing_presentation_rejects_dashboard_content():
    model = _valid_library_model()
    page = model["page"]["pages"][0]
    page["presentation"] = "marketing-landing"
    page["stats"] = [{"id": "count", "name": "数量", "entity": "loan", "metric": "count"}]

    result = validate_five_system_model(model)

    assert result["passed"] is False
    assert any(
        f.get("path") == "page.pages[p_apply].presentation" and "stats" in f.get("message", "")
        for f in result["findings"]
    )


def test_unknown_page_presentation_is_rejected():
    model = _valid_library_model()
    model["page"]["pages"][0]["presentation"] = "random-template"

    result = validate_five_system_model(model)

    assert result["passed"] is False
    assert any(f.get("path") == "page.pages[p_apply].presentation" for f in result["findings"])


def test_broken_model_blocked_with_precise_findings():
    result = validate_five_system_model(_broken_model())
    assert result["passed"] is False
    codes = {f["code"] for f in result["findings"]}
    assert DANGLING in codes
    refs = {f["ref"] for f in result["findings"]}
    assert "ghost_role" in refs
    assert "loan.nonexistent" in refs
    assert "p_missing" in refs


def test_landing_page_ref_must_resolve_to_a_page():
    m = _valid_library_model()
    m["appbundle"]["landingPageRef"] = "p_missing"
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any(
        f["path"] == "appbundle.landingPageRef" and f["ref"] == "p_missing"
        for f in result["findings"]
    )


def test_generation_contract_requires_a_real_landing_page():
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert '"landingPageRef": "<page_id shown first when the app opens>"' in _SCHEMA_INSTRUCTION
    assert "appbundle.landingPageRef is REQUIRED" in _SCHEMA_INSTRUCTION


def test_generation_contract_requires_exactly_one_supported_device():
    from services.archetype_legal import device_domain_bar
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    bar = device_domain_bar()
    assert f'"preferredDevice": "{bar}"' in _SCHEMA_INSTRUCTION
    assert "preferredDevice is REQUIRED" in _SCHEMA_INSTRUCTION
    assert "never omit" in _SCHEMA_INSTRUCTION.lower()
    assert "tablet" in bar
    assert "watch" not in bar
    # ⚠ 2026-08-30：不能 `assert "watch" not in _SCHEMA_INSTRUCTION`。
    # 契约正文有 "actually watches" / "watching live state"，子串会误伤；
    # 钉的是合法域槽位和带引号的设备词，不是英文单词。
    assert "'watch'" not in _SCHEMA_INSTRUCTION
    assert '"watch"' not in _SCHEMA_INSTRUCTION


def test_generation_contract_requires_ref_fields_to_name_their_target():
    """ref 字段必须自带目标实体（2026-08-11）。

    没有这条规则时，前端只能按字段名猜目标（`guessRefEntityId`）。181 份真实
    模型里 1689 个 ref 字段只猜得出 41%，其余 998 个**退化成让用户手打行 id 的
    纯文本框**。契约里给了这个键，门禁才有东西可校验
    （test_v5_field_semantics_gate 里那四条），运行时才有东西可优先采用。
    """
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert '"refEntity"' in _SCHEMA_INSTRUCTION
    assert "MUST DECLARE ITS TARGET" in _SCHEMA_INSTRUCTION


def test_llm_generation_normalizes_device_before_gate_and_visual_enrichment(monkeypatch):
    from services import app_store, freeform_block, v5_llm_generate
    from services.v5_capability_executor import _try_llm_generate_evidence

    generated = _valid_library_model()
    seen = []
    monkeypatch.setattr(
        v5_llm_generate,
        "generate_five_system_model",
        lambda *args, **kwargs: copy.deepcopy(generated),
    )
    monkeypatch.setattr(
        freeform_block,
        "enrich_freeform_blocks",
        lambda model: seen.append(("blocks", copy.deepcopy(model["appbundle"]))) or model,
    )
    monkeypatch.setattr(
        freeform_block,
        "enrich_monitor_page_overviews",
        lambda model, **kwargs: seen.append(("monitor", copy.deepcopy(model["appbundle"]))) or model,
    )
    monkeypatch.setattr(app_store, "save_app_or_version", lambda *args, **kwargs: None)

    result = _try_llm_generate_evidence("做一个手机图书借阅 App", lambda prompt: {})

    assert result is not None
    assert [stage for stage, _ in seen] == ["blocks", "monitor"]
    assert all(bundle["preferredDevice"] == "phone" for _, bundle in seen)
    assert all(bundle["deviceAuthority"] == "single-v1" for _, bundle in seen)


def test_gate_feedback_retry_is_normalized_before_strict_gate(monkeypatch):
    from services import app_store, freeform_block, v5_llm_generate
    from services.v5_capability_executor import _try_llm_generate_evidence

    broken = _valid_library_model()
    del broken["aigc"]
    repaired_retry = _valid_library_model()
    generated = iter((copy.deepcopy(broken), copy.deepcopy(repaired_retry)))
    seen = []
    monkeypatch.setattr(
        v5_llm_generate,
        "generate_five_system_model",
        lambda *args, **kwargs: next(generated),
    )
    monkeypatch.setattr(freeform_block, "enrich_freeform_blocks", lambda model: model)
    monkeypatch.setattr(
        freeform_block,
        "enrich_monitor_page_overviews",
        lambda model, **kwargs: seen.append(copy.deepcopy(model["appbundle"])) or model,
    )
    monkeypatch.setattr(app_store, "save_app_or_version", lambda *args, **kwargs: None)

    result = _try_llm_generate_evidence("做一个 PC 端图书管理网页", lambda prompt: {})

    assert result is not None
    assert seen == [
        {
            **repaired_retry["appbundle"],
            "preferredDevice": "desktop",
            "deviceAuthority": "single-v1",
        }
    ]


def test_missing_section_blocked():
    m = _valid_library_model()
    del m["aigc"]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any(f["code"] == MISSING_SECTION and f["affectedSkill"] == "aigc" for f in result["findings"])


def _with_chain_and_invariants(model):
    """扩展有效模型：附加一条 money 链路 + 两条落地的不变式（改进①②）。"""
    model["workflow"]["chains"] = [
        {
            "id": "wf_fine",
            "name": "逾期罚款链路",
            "kind": "money",
            "nodes": [
                {"id": "fine_assess", "name": "核定罚款", "assigneeRole": "librarian"},
                {"id": "fine_pay", "name": "缴纳罚款", "assigneeRole": "member"},
            ],
            "transitions": [{"from": "fine_assess", "to": "fine_pay"}],
        }
    ]
    model["appbundle"]["invariants"] = [
        {
            "id": "inv_loan_status_ledger",
            "statement": "借阅状态变更必须落借阅记录，不允许只改内存",
            "systems": ["datamodel", "workflow"],
            "refs": ["loan.status", "review"],
        },
        {
            "id": "inv_fine_before_next_loan",
            "statement": "有未缴罚款的会员不能发起新借阅",
            "systems": ["workflow", "rbac"],
            "refs": ["fine_pay", "member"],
        },
    ]
    return model


def test_chains_and_invariants_valid_model_passes():
    m = _with_chain_and_invariants(_valid_library_model())
    # appbundle 可以引用附加链路的 id / 节点 id
    m["appbundle"]["pageBindings"].append({"pageRef": "p_review", "workflowRef": "wf_fine"})
    m["appbundle"]["pageBindings"].append({"pageRef": "p_review", "workflowRef": "fine_pay"})
    result = validate_five_system_model(m)
    assert result["passed"] is True, result["findings"]


def test_chain_dangling_assignee_blocked():
    m = _with_chain_and_invariants(_valid_library_model())
    m["workflow"]["chains"][0]["nodes"][0]["assigneeRole"] = "ghost_role"
    result = validate_five_system_model(m)
    assert result["passed"] is False
    hits = [f for f in result["findings"] if f["ref"] == "ghost_role"]
    assert hits and "workflow.chains[wf_fine]" in hits[0]["path"]


def test_page_charts_valid_and_dangling():
    m = _valid_library_model()
    # 合法图表：count 按状态分布 + sum 指标
    m["page"]["pages"][0]["charts"] = [
        {"id": "c_status", "name": "借阅状态分布", "type": "pie",
         "dimension": "loan.status", "metric": "count"},
    ]
    result = validate_five_system_model(m)
    assert result["passed"] is True, result["findings"]

    # 悬挂 dimension / 非法 type / 非法 metric 全部拦下
    m["page"]["pages"][0]["charts"] = [
        {"id": "c_bad", "type": "radar", "dimension": "loan.nonexistent", "metric": "avg:loan.id"},
    ]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    refs = {f["ref"] for f in result["findings"]}
    assert "radar" in refs
    assert "loan.nonexistent" in refs
    assert "avg:loan.id" in refs

    # sum 指标引用不存在的字段
    m["page"]["pages"][0]["charts"] = [
        {"id": "c_sum", "type": "bar", "dimension": "loan.status", "metric": "sum:loan.ghost"},
    ]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any(f["ref"] == "loan.ghost" for f in result["findings"])


def test_aigc_pipelines_gate_valid_and_broken():
    """编排一期：steps 解析 + 相邻步字段级衔接（prev.outputField ∈ next.inputFields）。"""
    m = _valid_library_model()
    m["aigc"]["capabilities"].append({
        "id": "c_blurb",
        "name": "推荐语润色",
        # 衔接字段：上一能力 c_reco 的 outputField 是 loan.book_id
        "inputFields": ["loan.book_id", "book.title"],
        "outputField": "book.title",
        "roleRefs": ["librarian"],
    })
    # 合法管线：c_reco → c_blurb（loan.book_id 衔接）
    m["aigc"]["pipelines"] = [
        {"id": "pipe_reco", "name": "推荐链", "steps": ["c_reco", "c_blurb"]}
    ]
    assert validate_five_system_model(m)["passed"] is True, validate_five_system_model(m)["findings"]

    # 悬挂步骤 id
    m["aigc"]["pipelines"] = [{"id": "p_bad", "steps": ["c_reco", "ghost_cap"]}]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any(f["ref"] == "ghost_cap" for f in result["findings"])

    # 衔接断裂：c_reco → c_reco（c_reco 输出 loan.book_id 不在自身输入 book.title 里）
    m["aigc"]["pipelines"] = [{"id": "p_broken", "steps": ["c_reco", "c_reco"]}]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any("handoff broken" in f["message"] for f in result["findings"])

    # 单步不算编排
    m["aigc"]["pipelines"] = [{"id": "p_single", "steps": ["c_reco"]}]
    result = validate_five_system_model(m)
    assert result["passed"] is False
    assert any("at least 2 steps" in f["message"] for f in result["findings"])

    # 无 pipelines 字段 → 老模型零变化
    del m["aigc"]["pipelines"]
    assert validate_five_system_model(m)["passed"] is True


def test_invariant_ref_to_aigc_capability_is_legal():
    """线上截图案例（'vocal_pitch_coach'）：不变式引用 AIGC 能力 id 是合法写法
    （"AI 建议不得直发"这类约束必然引用能力节点）。曾因门禁与修复器各自维护
    合法域导致奇偶不齐——修复器认、门禁不认 → 合法不变式被误拦整模型报废。"""
    from services.v5_model_repair import repair_five_system_model

    m = _with_chain_and_invariants(_valid_library_model())
    m["appbundle"]["invariants"].append({
        "id": "inv_ai_not_direct",
        "statement": "AI 图书推荐结果不得跳过馆员确认直接生效",
        "systems": ["aigc", "workflow"],
        "refs": ["c_reco", "review"],  # c_reco = aigc.capabilities[0].id
    })
    # 修复器：合法 ref 原样保留（不改写、不剔除）
    result = repair_five_system_model(m)
    assert result["repaired"] == [] and result["dropped"] == []
    kept = {i["id"] for i in result["model"]["appbundle"]["invariants"]}
    assert "inv_ai_not_direct" in kept
    # 门禁：直接通过（与修复器同一合法域）
    gate = validate_five_system_model(result["model"])
    assert gate["passed"] is True, gate["findings"]


def test_repair_fixes_unique_near_miss_and_drops_unresolvable():
    from services.v5_model_repair import repair_five_system_model

    m = _with_chain_and_invariants(_valid_library_model())
    m["appbundle"]["invariants"].append({
        "id": "inv_near_miss",
        "statement": "罚款核定必须留痕",
        "systems": ["workflow"],
        # 拼错：真实节点是 fine_assess（LLM 常见的多前缀幻觉）
        "refs": ["do_fine_assess"],
    })
    m["appbundle"]["invariants"].append({
        "id": "inv_hopeless",
        "statement": "引用一个完全不存在的东西",
        "systems": ["workflow"],
        "refs": ["quantum_blockchain_module"],
    })
    result = repair_five_system_model(m)
    repaired_model = result["model"]
    # 原模型不被修改（纯函数）
    assert m["appbundle"]["invariants"][-1]["id"] == "inv_hopeless"
    # 近邻唯一命中 → 改写留痕
    assert {"invariantId": "inv_near_miss", "from": "do_fine_assess", "to": "fine_assess"} in result["repaired"]
    # 修不好的整条剔除 → 留痕含未解析引用
    dropped_ids = {d["invariantId"] for d in result["dropped"]}
    assert "inv_hopeless" in dropped_ids
    kept_ids = {i["id"] for i in repaired_model["appbundle"]["invariants"]}
    assert "inv_near_miss" in kept_ids and "inv_hopeless" not in kept_ids
    # 留痕随 appbundle 段走
    assert repaired_model["appbundle"]["invariantNotes"]["dropped"]
    # 修复后的模型过门禁（不变式层不再株连骨架）
    gate = validate_five_system_model(repaired_model)
    assert gate["passed"] is True, gate["findings"]


def test_repair_is_noop_for_clean_or_legacy_models():
    from services.v5_model_repair import repair_five_system_model

    clean = _with_chain_and_invariants(_valid_library_model())
    r = repair_five_system_model(clean)
    assert r["repaired"] == [] and r["dropped"] == []
    assert "invariantNotes" not in r["model"]["appbundle"]
    assert r["model"]["appbundle"]["invariants"] == clean["appbundle"]["invariants"]

    legacy = _valid_library_model()  # 无 invariants 的老模型
    r2 = repair_five_system_model(legacy)
    assert r2["model"]["appbundle"].get("invariants") in (None, [])
    assert r2["repaired"] == [] and r2["dropped"] == []


def test_repair_refuses_ambiguous_matches():
    from services.v5_model_repair import repair_five_system_model

    m = _with_chain_and_invariants(_valid_library_model())
    # "loan.b" 同时近似 loan.book_id 与其他 loan.* 字段 → 歧义不猜 → 剔除
    m["appbundle"]["invariants"] = [{
        "id": "inv_ambiguous",
        "statement": "歧义引用",
        "systems": ["datamodel"],
        "refs": ["loan.b"],
    }]
    result = repair_five_system_model(m)
    assert result["repaired"] == []
    assert result["dropped"][0]["invariantId"] == "inv_ambiguous"


def test_generate_pipeline_survives_hallucinated_invariant_ref():
    """集成：fake LLM 返回带幻觉不变式引用的模型 → 修复剔除 → 证据照常产出（不再 0/6）。"""
    from services.v5_capability_executor import _try_llm_generate_evidence

    bad_model = _with_chain_and_invariants(_valid_library_model())
    bad_model["appbundle"]["invariants"].append({
        "id": "inv_hallucinated",
        "statement": "线上截图同款：引用不存在的能力 id",
        "systems": ["aigc"],
        "refs": ["generate_fall_risk_explanation"],
    })
    artifacts = _try_llm_generate_evidence("智能助行监测", lambda _goal: bad_model)
    assert artifacts is not None, "一条坏不变式不应再株连整个模型（0/6）"
    assert set(artifacts.keys()) == {"datamodel", "rbac", "workflow", "page", "aigc", "appbundle"}
    notes = artifacts["appbundle"]["_model_section"]["invariantNotes"]
    assert any(d["invariantId"] == "inv_hallucinated" for d in notes["dropped"])


def test_invariant_dangling_ref_and_bad_system_blocked():
    m = _with_chain_and_invariants(_valid_library_model())
    m["appbundle"]["invariants"][0]["refs"] = ["loan.nonexistent_field"]
    m["appbundle"]["invariants"][1]["systems"] = ["blockchain"]
    m["appbundle"]["invariants"].append(
        {"id": "inv_vague", "statement": "系统应当安全", "systems": [], "refs": []}
    )
    result = validate_five_system_model(m)
    assert result["passed"] is False
    refs = {f["ref"] for f in result["findings"]}
    assert "loan.nonexistent_field" in refs
    assert "blockchain" in refs
    assert any("inv_vague" in f["path"] and "no refs" in f["message"] for f in result["findings"])


def test_generate_with_fake_llm_returns_model():
    fake = lambda goal: _valid_library_model()
    model = generate_five_system_model("我要一个图书馆借阅系统", llm_json_fn=fake)
    assert model is not None
    assert set(["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]).issubset(model.keys())


def test_generate_none_when_llm_returns_junk():
    assert generate_five_system_model("x", llm_json_fn=lambda g: {"datamodel": {}}) is None  # missing sections
    assert generate_five_system_model("x", llm_json_fn=lambda g: None) is None
    assert generate_five_system_model("", llm_json_fn=lambda g: _valid_library_model()) is None  # empty goal


def _empty_state(goal: str) -> V5SessionState:
    return V5SessionState(sessionId="t-llm", goal={"text": goal, "status": "needs_refinement"})


def test_wiring_novel_intent_closes_with_valid_fake_llm():
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _valid_library_model(),
    )
    assert all(per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS), per_skill


def test_action_type_enum_violation():
    """Step 5：非法 action type 被门禁拦截。"""
    m = _valid_library_model()
    pages = m.get("page", {}).get("pages", [])
    if pages:
        pages[0]["actions"] = [{"id": "a1", "type": "INVALID_TYPE"}]
    result = validate_five_system_model(m)
    findings = [f for f in result["findings"] if "type" in f.get("path", "") and "actions" in f.get("path", "")]
    assert len(findings) >= 1


def test_action_permissionRef_dangling():
    """Step 5：permissionRef 不在 page.actionPermissions 里被拦截。"""
    m = _valid_library_model()
    pages = m.get("page", {}).get("pages", [])
    if pages:
        pages[0]["actionPermissions"] = ["loan:view"]
        pages[0]["actions"] = [{"id": "a1", "type": "navigate", "permissionRef": "nonexistent:perm"}]
    result = validate_five_system_model(m)
    findings = [f for f in result["findings"] if "permissionRef" in f.get("path", "")]
    assert len(findings) >= 1


def test_action_navigate_targetPageRef_dangling():
    """Step 5：navigate 的 targetPageRef 不存在于 page.pages 被拦截。"""
    m = _valid_library_model()
    pages = m.get("page", {}).get("pages", [])
    if pages:
        pages[0]["actions"] = [{"id": "a1", "type": "navigate", "targetPageRef": "ghost_page_xyz"}]
    result = validate_five_system_model(m)
    findings = [f for f in result["findings"] if "targetPageRef" in f.get("path", "")]
    assert len(findings) >= 1


def test_wiring_novel_intent_fail_closed_with_broken_fake_llm():
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _broken_model(),
    )
    # Gate blocked -> no evidence injected -> all absent
    assert all(not per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS), per_skill


@_deterministic_domain
def test_wiring_deterministic_domain_unaffected_by_llm():
    # Purchase still closes via fixture WITHOUT calling the LLM at all.
    state = _empty_state("采购审批平台")
    called = {"n": 0}
    def _should_not_be_called(g):
        called["n"] += 1
        return None
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="采购审批平台",
        llm_json_fn=_should_not_be_called,
    )
    assert all(per_skill[k]["evidencePresent"] for k in REQUIRED_EVIDENCE_KEYS)
    assert called["n"] == 0  # deterministic domain never touches the LLM


# ---------------------------------------------------------------------------
# T3.5 — thread the gate-PASSED model through evidence + SSE (payload only)
# ---------------------------------------------------------------------------


def test_llm_path_per_skill_evidence_carries_model_sections():
    """Gate-passed LLM model sections ride on perSkillEvidence as modelSection payload."""
    model = _valid_library_model()
    state = _empty_state("图书馆借阅系统")
    per_skill = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: model,
    )
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert per_skill[skill]["evidencePresent"] is True
        if skill == "appbundle":
            assert per_skill[skill]["modelSection"] == {
                **model[skill],
                "preferredDevice": "desktop",
                "deviceAuthority": "single-v1",
            }
        else:
            assert per_skill[skill]["modelSection"] == model[skill], skill


@_deterministic_domain
def test_deterministic_domain_carries_builtin_model_section():
    """E35 反转旧设计：演示域现在带冻结的内置模型段（用户实测：闭环后右侧
    必须能长出应用）。模型是 LLM 一次性生成、过门后冻结的夹具——仍然
    不是运行时捏造。"""
    state = _empty_state("采购审批平台")
    per_skill = _build_per_skill_evidence(state, blocked_signal=False, goal="采购审批平台")
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert per_skill[skill]["evidencePresent"] is True
        assert isinstance(per_skill[skill].get("modelSection"), dict), skill


def test_model_section_never_participates_in_closure_hash():
    """modelSection is payload only: closure hash identical with or without it."""
    from services.v5_capability_executor import _stable_closure_hash

    state = _empty_state("图书馆借阅系统")
    with_model = _build_per_skill_evidence(
        state, blocked_signal=False, goal="图书馆借阅系统",
        llm_json_fn=lambda g: _valid_library_model(),
    )
    stripped = {
        skill: {k: v for k, v in entry.items() if k != "modelSection"}
        for skill, entry in with_model.items()
    }
    assert _stable_closure_hash(with_model, False, "图书馆借阅系统") == \
        _stable_closure_hash(stripped, False, "图书馆借阅系统")


def test_linkage_artifact_content_embeds_fenced_section_json():
    """Artifact content carries the section as a fenced ```json block (client-parseable),
    while matching/trust still reads only id/title/kind/summary."""
    import json
    from services.v5_llm_generate import model_to_linkage_artifacts

    model = _valid_library_model()
    artifacts = model_to_linkage_artifacts(model, "图书馆借阅系统")
    assert len(artifacts) == 6
    for artifact in artifacts:
        skill = artifact["id"].replace("llm-linkage-", "")
        assert artifact["_model_section"] == model[skill]
        content = artifact["content"]
        assert "```json" in content
        fenced = content.split("```json", 1)[1].split("```", 1)[0].strip()
        assert json.loads(fenced) == {skill: model[skill]}
        # trust haystack fields stay clean of model payload
        assert "```" not in artifact["summary"]
        assert "```" not in artifact["title"]


def test_stream_skill_result_emits_model_section_for_llm_path(monkeypatch):
    """drive_full_v5_session_stream: skill_result events carry modelSection when the
    (mocked) LLM path closes a novel intent; shape matches the client contract."""
    import asyncio
    import services.v5_llm_generate as v5_llm_generate

    model = _valid_library_model()
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    monkeypatch.setattr(
        v5_llm_generate, "generate_five_system_model",
        lambda goal, llm_json_fn=None: model,
    )

    from services.v5_full_driver import drive_full_v5_session_stream

    state = V5SessionState(
        sessionId="t-llm-stream",
        goal={"text": "图书馆借阅系统", "status": "needs_refinement"},
    )

    async def _collect():
        events = []
        async for event in drive_full_v5_session_stream(
            state, max_loops=1, user_instruction="图书馆借阅系统"
        ):
            events.append(event)
        return events

    events = asyncio.run(_collect())
    skill_results = [e for e in events if e.get("type") == "skill_result"]
    assert len(skill_results) == 6, [e.get("type") for e in events]
    by_label = {e["label"]: e for e in skill_results}
    for skill in REQUIRED_EVIDENCE_KEYS:
        event = by_label[skill]
        assert event["evidencePresent"] is True
        if skill == "appbundle":
            assert event["modelSection"] == {
                **model[skill],
                "preferredDevice": "desktop",
                "deviceAuthority": "single-v1",
            }
        else:
            assert event["modelSection"] == model[skill], skill
        assert isinstance(event.get("mermaid"), str)  # edge projection still present


@_deterministic_domain
def test_stream_skill_result_model_section_present_for_deterministic_domain():
    """E35：演示域 skill_result 闭 6/6 且 modelSection 为冻结夹具段（dict）。"""
    import asyncio

    from services.v5_full_driver import drive_full_v5_session_stream

    state = V5SessionState(
        sessionId="t-det-stream",
        goal={"text": "采购审批平台", "status": "needs_refinement"},
    )

    async def _collect():
        events = []
        async for event in drive_full_v5_session_stream(
            state, max_loops=1, user_instruction="采购审批平台"
        ):
            events.append(event)
        return events

    events = asyncio.run(_collect())
    skill_results = [e for e in events if e.get("type") == "skill_result"]
    assert len(skill_results) == 6
    for event in skill_results:
        assert "modelSection" in event  # field always present in the SSE contract
        assert isinstance(event["modelSection"], dict)  # E35 冻结夹具段


def _closure_result_for(goal: str, monkey_env=None):
    """Run appbundle.runtimeClosure via the real executor and return the report dict."""
    from services.v5_capability_executor import execute_v5_capability

    state = _empty_state(goal)
    result = execute_v5_capability("appbundle.runtimeClosure", state, [], "appbundle", "t1")
    return result if isinstance(result, dict) else result.model_dump()


def test_blocked_closure_carries_llm_disabled_diagnostic(monkeypatch):
    """新颖意图 + LLM 未开启 → blocker 明示 LLM_GENERATE_DISABLED（不再无解释 0/6）。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    report = _closure_result_for("星际殖民地物资调度系统")
    assert report["blocked"] is True
    codes = [b["code"] for b in report["blockers"]]
    assert "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED" in codes
    assert "LLM_GENERATE_DISABLED" in codes
    diag = next(b for b in report["blockers"] if b["code"] == "LLM_GENERATE_DISABLED")
    assert "SLIDERULE_LLM_GENERATE_ENABLED" in diag["ref"]
    assert {"code": "LLM_GENERATE_DISABLED"} in report["findingsByTier"]["hard_blocker"]


def test_blocked_closure_carries_llm_failed_diagnostic(monkeypatch):
    """LLM 开启但调用失败 → blocker 明示 LLM_GENERATE_FAILED + 失败原因。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import services.v5_llm_generate as v5_llm_generate

    def _boom(goal, llm_json_fn=None):
        # 请求域 ContextVar，不再是模块属性（2026-08-06）
        v5_llm_generate.set_generate_diagnostic({
            "outcome": "failed",
            "detail": "LlmError: connection refused to llm host",
        })
        return None

    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", _boom)
    report = _closure_result_for("星际殖民地物资调度系统")
    assert report["blocked"] is True
    diag = next(b for b in report["blockers"] if b["code"] == "LLM_GENERATE_FAILED")
    assert "connection refused" in diag["ref"]


@_deterministic_domain
def test_closed_closure_has_no_diagnostic_blocker():
    """确定性域正常闭合 → 无诊断 blocker（诊断只在 blocked 时透出）。"""
    report = _closure_result_for("采购审批平台")
    assert report["blocked"] is False
    assert report["blockers"] == []
    assert report["findingsByTier"]["hard_blocker"] == []


def test_stream_emits_llm_delta_during_generation(monkeypatch):
    """新颖意图生成期间，SSE 流应携带 llm_delta 事件（LLM 实时输出可观测）。"""
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import asyncio
    import services.v5_llm_generate as v5_llm_generate
    from services.v5_full_driver import drive_full_v5_session_stream

    def fake_generate(goal, llm_json_fn=None):
        # 模拟流式：通过模块 sink 逐块吐增量（真实路径由 _default_llm_json_fn
        # 的 on_delta 驱动），然后返回合法模型。
        v5_llm_generate._emit_delta('{"datamodel"')
        v5_llm_generate._emit_delta(": {...}")
        return _valid_library_model()

    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", fake_generate)
    state = _empty_state("图书馆借阅系统")

    async def _collect():
        events = []
        async for ev in drive_full_v5_session_stream(state, max_loops=2, user_instruction="图书馆借阅系统"):
            events.append(ev)
        return events

    events = asyncio.run(_collect())
    deltas = [e for e in events if e.get("type") == "llm_delta"]
    assert len(deltas) >= 1, "generation increments must surface as llm_delta events"
    assert '"datamodel"' in "".join(d["text"] for d in deltas)
    # sink 用完即卸载（不泄漏到后续会话）
    assert v5_llm_generate._delta_sink_var.get() is None


def test_diagnostic_never_affects_closure_hash(monkeypatch):
    """诊断只是留痕：同一 per-skill 证据下，有无诊断 hash 一致（不参与判定）。"""
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    r1 = _closure_result_for("星际殖民地物资调度系统")
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    import services.v5_llm_generate as v5_llm_generate
    monkeypatch.setattr(v5_llm_generate, "generate_five_system_model", lambda goal, llm_json_fn=None: None)
    r2 = _closure_result_for("星际殖民地物资调度系统")
    # 两次都是 0/6 blocked；诊断 code 不同（disabled vs failed）但 closureHash 相同
    assert r1["closureHash"] == r2["closureHash"]


# ---------------------------------------------------------------------------
# E37：展示层声明修复（page.charts/stats）+ 门裁决回喂重试
# 用户实测案例：chart.metric 写 avg:*（stats 合法、charts 非法的枚举陷阱）
# → 门禁硬拦 → 整模型 0/6 报废 → 右侧无应用。
# ---------------------------------------------------------------------------


def test_repair_drops_illegal_chart_metric_and_model_passes_gate():
    """avg: 图表指标剔除留痕（不改写撒谎），其余图表保留，模型照常过门。"""
    from services.v5_model_repair import repair_five_system_model

    m = _valid_library_model()
    m["page"]["pages"][0]["charts"] = [
        {"id": "ch_ok", "type": "bar", "dimension": "loan.status", "metric": "count"},
        {"id": "ch_avg", "type": "pie", "dimension": "loan.status", "metric": "avg:loan.due_date"},
    ]
    result = repair_five_system_model(m)
    fixed = result["model"]
    assert [c["id"] for c in fixed["page"]["pages"][0]["charts"]] == ["ch_ok"]
    notes = fixed["appbundle"]["presentationNotes"]
    assert notes["droppedCharts"][0]["chartId"] == "ch_avg"
    # 原模型不被修改（纯函数）
    assert len(m["page"]["pages"][0]["charts"]) == 2
    gate = validate_five_system_model(fixed)
    assert gate["passed"] is True, gate["findings"]


def test_repair_presentation_near_match_and_format_clear():
    """图表维度拼错近邻修复；统计卡实体拼错修复、非法 format 清除、
    无解引用整卡剔除——全部留痕，修完过门。"""
    from services.v5_model_repair import repair_five_system_model

    m = _valid_library_model()
    m["page"]["pages"][0]["charts"] = [
        {"id": "ch_typo", "type": "bar", "dimension": "loan.statu", "metric": "count"},
    ]
    m["page"]["pages"][1]["stats"] = [
        {"id": "st_typo", "entity": "loans", "metric": "count", "format": "number"},
        {"id": "st_badfmt", "entity": "loan", "metric": "count", "format": "fancy"},
        {"id": "st_hopeless", "entity": "quantum_ledger", "metric": "count"},
    ]
    result = repair_five_system_model(m)
    fixed = result["model"]
    assert fixed["page"]["pages"][0]["charts"][0]["dimension"] == "loan.status"
    stats = {s["id"]: s for s in fixed["page"]["pages"][1]["stats"]}
    assert stats["st_typo"]["entity"] == "loan"
    assert "format" not in stats["st_badfmt"]
    assert "st_hopeless" not in stats
    notes = fixed["appbundle"]["presentationNotes"]
    assert {r["from"] for r in notes["repaired"]} == {"loan.statu", "loans"}
    assert notes["clearedFormats"][0]["statId"] == "st_badfmt"
    assert notes["droppedStats"][0]["statId"] == "st_hopeless"
    gate = validate_five_system_model(fixed)
    assert gate["passed"] is True, gate["findings"]


def test_repair_landing_page_near_match_or_clear_with_trace():
    from services.v5_model_repair import repair_five_system_model

    near = _valid_library_model()
    near["appbundle"]["landingPageRef"] = "p_appl"
    repaired = repair_five_system_model(near)["model"]
    assert repaired["appbundle"]["landingPageRef"] == "p_apply"
    assert any(
        note.get("path") == "landingPageRef"
        and note.get("from") == "p_appl"
        and note.get("to") == "p_apply"
        for note in repaired["appbundle"]["presentationNotes"]["repaired"]
    )
    assert validate_five_system_model(repaired)["passed"] is True

    hopeless = _valid_library_model()
    hopeless["appbundle"]["landingPageRef"] = "quantum_console"
    cleared = repair_five_system_model(hopeless)["model"]
    assert "landingPageRef" not in cleared["appbundle"]
    assert cleared["appbundle"]["presentationNotes"]["clearedLandingPage"][0]["value"] == "quantum_console"
    assert validate_five_system_model(cleared)["passed"] is True


def test_experience_block_catalog_gate_and_repair():
    """二阶段只锁区块 id/type：目录内通过，目录外拦截或诚实修复/剔除。"""
    from services.v5_model_repair import repair_five_system_model

    valid = _valid_library_model()
    valid["page"]["pages"][0]["blocks"] = [
        {"id": "loan_metrics", "type": "MetricGrid"},
    ]
    assert validate_five_system_model(valid)["passed"] is True

    invalid = _valid_library_model()
    invalid["page"]["pages"][0]["blocks"] = [
        {"id": "typo", "type": "MetricGri"},
        {"id": "fantasy", "type": "MagicWall"},
    ]
    verdict = validate_five_system_model(invalid)
    assert verdict["passed"] is False
    assert {f.get("ref") for f in verdict["findings"]} >= {"MetricGri", "MagicWall"}

    fixed = repair_five_system_model(invalid)["model"]
    blocks = fixed["page"]["pages"][0]["blocks"]
    assert blocks == [{"id": "typo", "type": "MetricGrid"}]
    notes = fixed["appbundle"]["presentationNotes"]
    assert any(
        note.get("from") == "MetricGri" and note.get("to") == "MetricGrid"
        for note in notes["repaired"]
    )
    assert notes["droppedBlocks"][0]["type"] == "MagicWall"
    assert validate_five_system_model(fixed)["passed"] is True


def test_repair_presentation_noop_for_clean_model():
    """无 charts/stats 或全合法 → 零变化、无 presentationNotes（老模型不受扰）。"""
    from services.v5_model_repair import repair_five_system_model

    clean = _valid_library_model()
    r = repair_five_system_model(clean)
    assert "presentationNotes" not in r["model"]["appbundle"]
    assert r["model"]["page"] == clean["page"]


def test_gate_feedback_retry_recovers_blocked_model():
    """门裁决回喂（E37）：第一版骨架级悬空引用被门拦（修复器不管骨架）→
    findings 喂回重生成一次 → 第二版过门 → 证据照常产出（不再 0/6）。"""
    from services.v5_capability_executor import _try_llm_generate_evidence

    calls: list = []

    def fake(_goal):
        calls.append(_goal)
        return _broken_model() if len(calls) == 1 else _valid_library_model()

    artifacts = _try_llm_generate_evidence("宠物美容预约平台", fake)
    assert artifacts is not None, "回喂重试过门后不应 fail-closed"
    assert len(calls) == 2, "应恰好重试一次"
    assert set(artifacts.keys()) == set(REQUIRED_EVIDENCE_KEYS)


def test_gate_feedback_retry_still_fail_closed_when_both_blocked():
    """两版都被门拦 → 仍 fail-closed（回喂是增强，不是放行通道）。"""
    import services.v5_capability_executor as executor
    from services.v5_capability_executor import _try_llm_generate_evidence

    artifacts = _try_llm_generate_evidence("宠物美容预约平台", lambda g: _broken_model())
    assert artifacts is None
    # 2026-08-11：诊断从模块级 dict 改成请求域 ContextVar（并发下 A 的失败原因
    # 会写进 B 的 blocker）。读法跟着改成访问器——**断言的东西没变**，仍然是
    # "两版都被门拦下时要留下 MODEL_GATE_BLOCKED 这个原因"。
    assert executor._diagnostic()["code"] == "MODEL_GATE_BLOCKED"


def test_default_llm_fn_appends_gate_feedback_to_prompt(monkeypatch):
    """gate_feedback 只作用于默认 LLM 通道：喂回文本必须进 user prompt。"""
    import services.v5_llm_generate as gen

    captured = {}

    def fake_call(messages, **kwargs):
        captured["user"] = messages[-1]["content"]
        raise RuntimeError("stop here")  # 只验 prompt 装配，不真调 LLM

    import sliderule_llm.client as llm_client

    monkeypatch.setattr(llm_client, "call_llm_json_with_shape", fake_call)
    monkeypatch.setattr(gen, "_structured_llm_json_fn", lambda messages: None)
    gen._default_llm_json_fn("测试意图", gate_feedback="- page.charts[x].metric: bad")
    assert "page.charts[x].metric: bad" in captured.get("user", "")
    assert "FAILED the deterministic structural gate" in captured["user"]


# ---------- strict Gate 测试 ----------


def _make_model_with_landing(page_id: str = "p_apply") -> dict:
    """构造一个带有有效 landingPageRef 的最小合法模型（用于 strict 模式正常通过）。

    基于 _valid_library_model()：page.pages 里第一个页面 id 是 p_apply，
    所以 landingPageRef 默认设为 p_apply。
    """
    m = _valid_library_model()
    m["appbundle"]["landingPageRef"] = page_id
    return m


def _make_model_without_landing() -> dict:
    """构造一个缺少 landingPageRef 的最小合法模型（用于验证 strict 拦截）。

    _valid_library_model() 现在带 landingPageRef（代表正常生成产物），
    这里显式移除以模拟旧快照或 Repair 清除后的状态。
    """
    m = _valid_library_model()
    m["appbundle"].pop("landingPageRef", None)
    return m


def test_strict_gate_passes_with_landing_page_ref():
    """strict=True 时有效 landingPageRef 应通过。"""
    model = _make_model_with_landing()
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
    assert len(findings) == 0, f"should pass but got findings: {findings}"


def test_strict_gate_fails_missing_landing_page_ref():
    """strict=True 时缺少 landingPageRef 应产生 PUBLISH_MISSING_REQUIRED_FIELD。"""
    model = _make_model_without_landing()
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
    assert len(findings) == 1
    assert findings[0]["path"] == "appbundle.landingPageRef"


# ---------- Step 4：binding 强类型校验 ----------


def test_binding_entityRef_passes_gate_with_known_entity():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        entity_id = entities[0]["id"]
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid", "binding": {"entityRef": entity_id, "aggregate": "count"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    blocking = [f for f in result["findings"] if f.get("code") in ("PUBLISH_DANGLING_CROSSREF", "PUBLISH_INVALID_FIELD") and "binding" in f.get("path", "")]
    assert len(blocking) == 0, f"unexpected binding findings: {blocking}"


def test_binding_entityRef_fails_gate_with_unknown_entity():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid", "binding": {"entityRef": "nonexistent_entity_xyz"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "entityRef" in f.get("path", "")]
    assert len(findings) >= 1, f"expected entityRef finding but got: {result}"


def test_binding_timeGrain_enum_violation():
    model = _make_model_with_landing()
    pages = model.get("page", ).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        pages[0]["blocks"] = [{"id": "b1", "type": "TrendChart", "binding": {"entityRef": entities[0]["id"], "timeGrain": "invalid"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "timeGrain" in f.get("path", "")]
    assert len(findings) >= 1


# ---------- bindingSchema 深校验（单一真相源延伸到 binding 层，见 schema_legal） ----------


def test_binding_trendchart_missing_required_timeDimensionRef():
    """TrendChart 的 bindingHints 一直要求 timeDimensionRef 必填，但重构前 Gate
    从不检查它——漏填也能通过。这条锁死"必填字段查表校验"这个新能力。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        pages[0]["blocks"] = [{"id": "b1", "type": "TrendChart", "binding": {"entityRef": entities[0]["id"]}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [
        f for f in result["findings"]
        if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD" and "timeDimensionRef" in f.get("path", "")
    ]
    assert len(findings) >= 1, f"expected timeDimensionRef required-field finding but got: {result['findings']}"


def test_binding_rankedlist_missing_required_sortByRef():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        pages[0]["blocks"] = [{"id": "b1", "type": "RankedList", "binding": {"entityRef": entities[0]["id"]}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [
        f for f in result["findings"]
        if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD" and "sortByRef" in f.get("path", "")
    ]
    assert len(findings) >= 1


def test_binding_rankedlist_sortByRef_wrong_field_type():
    """sortByRef 指向一个非 number 字段——按数值排名排不出"第一名"，之前完全不检查字段类型。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        string_field = next(f["id"] for f in entities[0]["fields"] if f.get("type") == "string")
        pages[0]["blocks"] = [{
            "id": "b1", "type": "RankedList",
            "binding": {"entityRef": entities[0]["id"], "sortByRef": string_field},
        }]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "sortByRef" in f.get("path", "")]
    assert len(findings) >= 1, f"expected sortByRef type-mismatch finding but got: {result['findings']}"


def test_binding_metricgrid_aggregate_sum_wrong_field_type():
    """aggregate='sum:<fieldId>' 指向非 number 字段——之前 Gate 完全不解析 aggregate 表达式。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        string_field = next(f["id"] for f in entities[0]["fields"] if f.get("type") == "string")
        pages[0]["blocks"] = [{
            "id": "b1", "type": "MetricGrid",
            "binding": {"entityRef": entities[0]["id"], "aggregate": f"sum:{string_field}"},
        }]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "aggregate" in f.get("path", "")]
    assert len(findings) >= 1, f"expected aggregate type-mismatch finding but got: {result['findings']}"


def test_binding_metricgrid_aggregate_invalid_syntax():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        pages[0]["blocks"] = [{
            "id": "b1", "type": "MetricGrid",
            "binding": {"entityRef": entities[0]["id"], "aggregate": "bogus"},
        }]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_INVALID_FIELD" and "aggregate" in f.get("path", "")]
    assert len(findings) >= 1


def test_binding_rankedlist_limit_out_of_range():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        pages[0]["blocks"] = [{
            "id": "b1", "type": "RankedList",
            "binding": {"entityRef": entities[0]["id"], "sortByRef": entities[0]["fields"][0]["id"], "limit": 500},
        }]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "limit" in f.get("path", "")]
    assert len(findings) >= 1


def test_binding_trendchart_valid_binding_passes_clean():
    """正确的 binding（entityRef + timeDimensionRef 都对得上真实字段与类型）不应产生 binding 相关 finding——防止新校验误报。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    entities = model.get("datamodel", {}).get("entities", [])
    if pages and entities:
        date_field = next(f["id"] for f in entities[0]["fields"] if f.get("type") == "date")
        pages[0]["blocks"] = [{
            "id": "b1", "type": "TrendChart",
            "binding": {"entityRef": entities[0]["id"], "timeDimensionRef": date_field, "timeGrain": "week"},
        }]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "binding" in f.get("path", "")]
    assert len(findings) == 0, f"unexpected binding findings on a valid binding: {findings}"


def test_strict_gate_fails_none_landing_page_ref():
    """strict=True 时 landingPageRef=None 应产生 PUBLISH_MISSING_REQUIRED_FIELD。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {})["landingPageRef"] = None
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
    assert len(findings) == 1


def test_strict_gate_fails_empty_landing_page_ref():
    """strict=True 时 landingPageRef="" 或纯空白应产生 PUBLISH_MISSING_REQUIRED_FIELD。"""
    for bad_val in ["", "   "]:
        model = _make_model_with_landing()
        model.setdefault("appbundle", {})["landingPageRef"] = bad_val
        from services.v5_model_gate import validate_five_system_model
        result = validate_five_system_model(model, require_landing_page_ref=True)
        findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
        assert len(findings) == 1, f"bad_val={repr(bad_val)} should fail"


def test_compat_gate_passes_missing_landing_page_ref():
    """默认（strict=False）时缺少 landingPageRef 是合法旧模型，应通过。"""
    model = _make_model_without_landing()
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)   # 不传 require_landing_page_ref
    findings = [f for f in result["findings"] if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD"]
    assert len(findings) == 0, f"compat mode should pass but got: {findings}"


def test_page_blocks_pass_gate_with_valid_catalog_type():
    """page.blocks 里的合法目录类型应通过 Gate。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    block_findings = [f for f in result["findings"] if "block" in f.get("path", "").lower()]
    assert len(block_findings) == 0, f"unexpected block findings: {block_findings}"


def test_page_blocks_fail_gate_with_invalid_type():
    """page.blocks 里的非目录类型应产生 finding。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "NonExistentBlockType"}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    assert len(result["findings"]) > 0, "expected Gate to reject unknown block type"
    assert any("NonExistentBlockType" in f.get("ref", "") for f in result["findings"])


def test_page_surface_accepts_ant_design_pro_workbench_contract():
    model = _make_model_with_landing()
    model["page"]["pages"][0]["surface"] = {
        "type": "split-list",
        "density": "compact",
    }
    from services.v5_model_gate import validate_five_system_model

    result = validate_five_system_model(model)
    findings = [f for f in result["findings"] if ".surface" in f.get("path", "")]
    assert findings == []


def test_page_surface_rejects_unknown_type_and_density():
    model = _make_model_with_landing()
    model["page"]["pages"][0]["surface"] = {
        "type": "magic-canvas",
        "density": "huge",
    }
    from services.v5_model_gate import validate_five_system_model

    result = validate_five_system_model(model)
    findings = [f for f in result["findings"] if ".surface" in f.get("path", "")]
    assert len(findings) == 2
    assert all(f.get("code") == "PUBLISH_ENUM_VIOLATION" for f in findings)


def test_quick_action_panel_passes_gate():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "qap1", "type": "QuickActionPanel"}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    type_findings = [f for f in result["findings"] if "QuickActionPanel" in str(f) or ("blocks" in f.get("path","") and "type" in f.get("path",""))]
    assert len(type_findings) == 0, f"QuickActionPanel should pass gate: {type_findings}"


def test_filter_bar_passes_gate():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "fb1", "type": "FilterBar"}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    type_findings = [f for f in result["findings"] if "FilterBar" in str(f) or ("blocks" in f.get("path","") and "type" in f.get("path",""))]
    assert len(type_findings) == 0, f"FilterBar should pass gate: {type_findings}"


if __name__ == "__main__":
    # Allow running directly without pytest (fixture-taking tests are pytest-only).
    import inspect

    fns = [
        v for k, v in sorted(globals().items())
        if k.startswith("test_") and callable(v)
        and not inspect.signature(v).parameters
    ]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(fns)} passed")
    sys.exit(0 if passed == len(fns) else 1)


# ---------- Steps 7-9 测试 ----------

def test_layout_dangling_block_ref_fails():
    """layout 引用不存在的 block id 应产生 DANGLING finding。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
        pages[0]["layout"] = {"primary": ["nonexistent_block"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "layout" in f.get("path", "")]
    assert len(findings) >= 1, f"expected layout dangling ref finding: {result}"

def test_layout_valid_block_ref_passes():
    """layout 引用已声明的 block id 应通过。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
        pages[0]["layout"] = {"metrics": ["b1"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    layout_findings = [f for f in result["findings"] if "layout" in f.get("path", "")]
    assert len(layout_findings) == 0, f"valid layout should pass: {layout_findings}"

def test_layout_invalid_slot_fails():
    """layout 使用不在合法域的槽位应产生 finding。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
        pages[0]["layout"] = {"invalid_slot_xyz": ["b1"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "layout" in f.get("path", "")]
    assert len(findings) >= 1, f"invalid slot should fail: {result}"

def test_layout_block_type_not_allowed_in_slot_fails():
    """RankedList 的目录 allowedSlots 是 primary/secondary；塞进 activity 槽
    此前只查"id 存不存在"，不查"类型放得对不对"，能悄悄通过。这条锁死
    "槽位 x 区块类型"交叉校验（Puck DropZone allow 思路）。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "RankedList"}]
        pages[0]["layout"] = {"activity": ["b1"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [
        f for f in result["findings"]
        if f.get("code") == "PUBLISH_ENUM_VIOLATION" and "activity" in f.get("path", "")
    ]
    assert len(findings) >= 1, f"expected slot-type mismatch finding but got: {result['findings']}"


def test_layout_block_type_allowed_in_declared_slot_passes():
    """同一个 RankedList 放进目录允许的 aside 区域应该干净通过——防止新校验误报。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "RankedList"}]
        pages[0]["layout"] = {"aside": ["b1"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    layout_findings = [f for f in result["findings"] if "layout" in f.get("path", "")]
    assert len(layout_findings) == 0, f"valid region placement should pass: {layout_findings}"


def test_layout_nested_slots_key_reports_actionable_message():
    """槽位表被多包一层 `slots` 时，finding 必须直说"摊平"，不能只说"槽位名非法"。

    真跑撞过：一轮生成里 6 个页面全写成 `layout: {"slots": {...}}`，起因是
    prompt 里 "a layout object with slots summary/..." 被读成"有个叫 slots
    的键"。泛化那条 "slot 'slots' is not in allowed slots" 虽然不假，但
    reask 拿着它不知道该怎么改——所以这里锁的是**措辞可执行**。
    """
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
        pages[0]["layout"] = {"slots": {"summary": ["b1"]}}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    layout_findings = [f for f in result["findings"] if "layout" in f.get("path", "")]
    assert len(layout_findings) == 1, f"expected exactly one layout finding: {layout_findings}"
    msg = layout_findings[0]["message"]
    assert "must not be nested" in msg and "hoist" in msg, msg
    # 不能顺带再报一堆"block ref 'summary' 不存在"的噪声
    assert "not found in page.blocks" not in msg, msg


def test_layout_nested_slots_does_not_swallow_other_slot_errors():
    """包装层之外照常校验：同一个 layout 里的非法槽位名不能被 `slots` 分支吃掉。"""
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
        pages[0]["layout"] = {"slots": {"summary": ["b1"]}, "bogus_slot": ["b1"]}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    msgs = [f["message"] for f in result["findings"] if "layout" in f.get("path", "")]
    assert any("must not be nested" in m for m in msgs), msgs
    assert any("bogus_slot" in m for m in msgs), msgs


def test_layout_grid_valid_refs_and_page_content_pass():
    model = _make_model_with_landing()
    page = model["page"]["pages"][0]
    page["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
    page["layout"] = {
        "grid": {
            "desktop": [
                {"blockRef": "b1", "x": 0, "y": 0, "w": 4, "h": 1},
                {"blockRef": "page-content", "x": 4, "y": 0, "w": 8, "h": 3},
            ],
            "phone": [
                {"blockRef": "b1", "x": 0, "y": 0, "w": 4, "h": 1},
                {"blockRef": "page-content", "x": 0, "y": 1, "w": 4, "h": 2},
            ],
        }
    }
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if ".layout.grid" in f.get("path", "")]
    assert findings == [], findings


def test_layout_grid_rejects_invalid_breakpoint_coordinates_bounds_duplicates_and_refs():
    model = _make_model_with_landing()
    page = model["page"]["pages"][0]
    page["blocks"] = [{"id": "b1", "type": "MetricGrid"}]
    page["layout"] = {
        "grid": {
            "watch": [{"blockRef": "b1", "x": 0, "y": 0, "w": 1, "h": 1}],
            "desktop": [
                {"blockRef": "b1", "x": 0.5, "y": 0, "w": 4, "h": 1},
                {"blockRef": "b1", "x": 0, "y": 1, "w": 4, "h": 1},
                {"blockRef": "missing", "x": 0, "y": 2, "w": 13, "h": 0},
            ],
        }
    }
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    messages = [
        f["message"] for f in result["findings"]
        if ".layout.grid" in f.get("path", "")
    ]
    assert any("breakpoint" in message for message in messages), messages
    assert any("integers" in message for message in messages), messages
    assert any("duplicate" in message for message in messages), messages
    assert any("not found" in message for message in messages), messages
    assert any("within 12 columns" in message for message in messages), messages


# ---------- WorkflowTimeline（2026-07-23）：props.chainRef 深校验 ----------


def _model_with_workflow_chain():
    model = _make_model_with_landing()
    model["workflow"] = model.get("workflow") or {}
    model["workflow"]["nodes"] = [{"id": "n1", "name": "Step 1"}, {"id": "n2", "name": "Step 2"}]
    model["workflow"]["transitions"] = [{"from": "n1", "to": "n2"}]
    model["workflow"]["chains"] = [
        {"id": "money_chain", "name": "Money", "nodes": [{"id": "m1"}], "transitions": []}
    ]
    return model


def test_workflow_timeline_empty_chainref_passes():
    """chainRef 留空 = 主链路，永远合法。"""
    model = _model_with_workflow_chain()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "WorkflowTimeline", "props": {"title": "Flow"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "chainRef" in f.get("path", "")]
    assert len(findings) == 0, f"unexpected chainRef findings: {findings}"


def test_workflow_timeline_valid_chainref_passes():
    model = _model_with_workflow_chain()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "WorkflowTimeline", "props": {"chainRef": "money_chain"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "chainRef" in f.get("path", "")]
    assert len(findings) == 0, f"unexpected chainRef findings: {findings}"


def test_workflow_timeline_unknown_chainref_fails():
    """chainRef 指向不存在的链路——不能瞎编，必须报错。"""
    model = _model_with_workflow_chain()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "b1", "type": "WorkflowTimeline", "props": {"chainRef": "nonexistent"}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [
        f for f in result["findings"]
        if f.get("code") == "PUBLISH_DANGLING_CROSSREF" and "chainRef" in f.get("path", "")
    ]
    assert len(findings) >= 1, f"expected chainRef dangling finding but got: {result['findings']}"


# ---------- FreeformInsight（2026-07-23）：主模型只需交出非空 designBrief ----------


def test_freeform_insight_missing_designbrief_fails():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [{"id": "f1", "type": "FreeformInsight", "props": {}}]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [
        f for f in result["findings"]
        if f.get("code") == "PUBLISH_MISSING_REQUIRED_FIELD" and "designBrief" in f.get("path", "")
    ]
    assert len(findings) >= 1, f"expected designBrief required finding but got: {result['findings']}"


def test_freeform_insight_with_designbrief_passes():
    model = _make_model_with_landing()
    pages = model.get("page", {}).get("pages", [])
    if pages:
        pages[0]["blocks"] = [
            {"id": "f1", "type": "FreeformInsight", "props": {"designBrief": "客户增长趋势总览"}}
        ]
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "designBrief" in f.get("path", "")]
    assert len(findings) == 0, f"unexpected designBrief findings: {findings}"


def test_experience_shell_mode_enum_violation():
    """experienceShell.mode 非法值应产生 finding。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {})["experienceShell"] = {"mode": "canvas"}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    findings = [f for f in result["findings"] if "experienceShell.mode" in f.get("path", "")]
    assert len(findings) >= 1

def test_experience_shell_valid_navigation_passes():
    """experienceShell 合法声明应通过。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {})["experienceShell"] = {"mode": "navigation", "navigation": "side"}
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "experienceShell" in f.get("path", "")]
    assert len(findings) == 0

def test_preferred_device_enum_violation():
    """preferredDevice 非法值应产生 finding。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {})["preferredDevice"] = "wearable"
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    findings = [f for f in result["findings"] if "preferredDevice" in f.get("path", "")]
    assert len(findings) >= 1

def test_design_recipe_ref_valid_passes():
    """合法的 designRecipeRef 应通过。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {}).setdefault("appIdentity", {})["designRecipeRef"] = "compact-dense"
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model, require_landing_page_ref=True)
    findings = [f for f in result["findings"] if "designRecipeRef" in f.get("path", "")]
    assert len(findings) == 0

def test_design_recipe_ref_invalid_fails():
    """非法的 designRecipeRef 应产生 DANGLING finding。"""
    model = _make_model_with_landing()
    model.setdefault("appbundle", {}).setdefault("appIdentity", {})["designRecipeRef"] = "neon-rainbow-custom"
    from services.v5_model_gate import validate_five_system_model
    result = validate_five_system_model(model)
    findings = [f for f in result["findings"] if "designRecipeRef" in f.get("path", "")]
    assert len(findings) >= 1
