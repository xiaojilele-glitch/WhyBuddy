# -*- coding: utf-8 -*-
"""本回合已加载的技能不许再灌全文（2026-09-21 sr-20260921150545-6QG1GNGP1P）。

真机：skill(office-skills) 成功 → 压缩桩写 file_read/grep → 再调 skill
第三遍 → control_producer_failed。判据必须走 dispatch，不许只测 helper。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.control_skills import parse_skill_md
from services.slide_rule_session import load_session
import services.rehearsal_control as control

CONTROL_SRC = Path(control.__file__)


def _skill(name: str, description: str, body: str):
    info = parse_skill_md(
        f"---\nname: {name}\ndescription: {description}\n---\n{body}\n",
        path=f".sliderule/skills/{name}/SKILL.md",
    )
    assert info is not None
    return info


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_second_skill_call_same_turn_does_not_resend_body(harness, monkeypatch):
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [office])
    sid = new_sid("skill-reload")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] <= 2:
            return llm_tool(
                "skill",
                {"name": "office-skills"},
                call_id=f"sk-{n['i']}",
            )
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid,
        "@office-skills 做个PPT",
        selectedSkills=["office-skills"],
        installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert len(results) >= 2, [e.get("type") for e in events]
    assert results[0].get("ok") is True
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" in str(results[0].get("skill_message") or "")
    assert results[1].get("alreadyLoaded") is True
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" not in str(results[1].get("skill_message") or "")
    assert "不要再调 skill" in str(results[1].get("skill_message") or "")


def test_llm_fail_after_questionnaire_is_error_not_idle(harness):
    """问卷答案落了、模型 503，不许看起来像做完了。"""
    from sliderule_llm.client import LlmError

    sid = new_sid("ask-503")
    seed_session(sid, goal={"text": "做个PPT", "status": "needs_refinement"})
    harness.llm_impl = lambda *_a, **_k: llm_tool(
        "ask_user_question",
        {"question": "风格？", "options": ["浅色", "深色"]},
    )
    _, events = harness.post(six_fields(sid, "做个PPT"))
    ask = next(e for e in events if e.get("type") == "control_ask_user")
    req = ask.get("reqId")
    assert load_session(sid).awaitReason == "control_ask"

    def boom(*_a, **_k):
        raise LlmError(
            "upstream 503: All available accounts exhausted",
            status=503,
            transient=False,
        )

    harness.llm_impl = boom
    _, events = harness.post(six_fields(
        sid,
        "浅色",
        toolAnswer={
            "kind": "ask_user",
            "reqId": req,
            "outcome": "accepted",
            "answers": {"q1": ["浅色"]},
            "text": "浅色",
        },
    ))
    _assert_error_park(sid, events, "user_answer")


def test_first_turn_llm_fail_is_error_not_idle(harness):
    """⚠ 2026-09-21 sr-20260921155056-HKA1MC5142：首轮就 503。
    问卷那条只覆盖了 toolAnswer 路径。首轮没有停泊可清，`_canned`
    仍把 complete 画成 idle——卡片一样是「任务已完成」。
    """
    from sliderule_llm.client import LlmError

    sid = new_sid("first-503")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError(
            "upstream 503: All available accounts exhausted",
            status=503,
            transient=False,
        )

    harness.llm_impl = boom
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    _assert_error_park(sid, events)


def test_turn_after_503_does_not_finish_still_failed(harness):
    """⚠ 2026-09-22 BABCJGGB44：503 之后下一轮已经生成完并 idle，
    complete 仍是 failed/error、stop 为空。旧停泊必须在新一轮开头清掉。
    """
    from sliderule_llm.client import LlmError

    sid = new_sid("after-503")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError("upstream 503: Service temporarily unavailable", status=503, transient=True)

    harness.llm_impl = boom
    harness.post(six_fields(sid, "@office-skills 做个PPT"))
    parked = load_session(sid)
    assert parked.awaitReason == "error" and parked.runtimePhase == "failed"

    harness.llm_impl = lambda *_a, **_k: llm_tool("idle", {}, call_id="idle-1")
    _, events = harness.post(six_fields(sid, "继续执行。不要重做问卷。"))
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") != "failed"
    assert st.get("awaitReason") != "error"
    assert complete.get("stopReason") is None
    done = load_session(sid)
    assert done.awaitReason != "error"
    assert done.runtimePhase != "failed"


def test_text_after_503_ends_idle_not_still_orchestrating(harness):
    """清掉失败停泊后，模型只用文字收口，complete 不能停在 orchestrating。"""
    from sliderule_llm.client import LlmError

    sid = new_sid("after-503-text")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "needs_refinement"})

    def boom(*_a, **_k):
        raise LlmError("upstream 503: Service temporarily unavailable", status=503, transient=True)

    harness.llm_impl = boom
    harness.post(six_fields(sid, "@office-skills 做个PPT"))
    harness.llm_impl = lambda *_a, **_k: llm_text("5 页已经生成。")
    _, events = harness.post(six_fields(sid, "继续执行。"))
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") == "idle"
    assert not st.get("awaitReason")
    assert complete.get("stopReason") is None


def _assert_error_park(sid: str, events: list, *extra_kinds: str) -> None:
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "error"
    assert loaded.runtimePhase == "failed"
    assert loaded.awaitDetail == "llm_unavailable"
    kinds = [r.get("kind") for r in loaded.controlTranscript if isinstance(r, dict)]
    for kind in extra_kinds:
        assert kind in kinds
    assert "canned" in kinds
    complete = next(e for e in reversed(events) if e.get("type") == "complete")
    st = complete.get("state") or {}
    assert st.get("runtimePhase") == "failed"
    assert st.get("awaitReason") == "error"
    assert complete.get("stopReason") == "llm_unavailable"
    idle_done = [
        e for e in events
        if e.get("type") == "complete"
        and (e.get("state") or {}).get("runtimePhase") in (None, "idle")
        and not (e.get("state") or {}).get("awaitReason")
    ]
    assert not idle_done, idle_done


def test_skill_seed_fallback_when_turn_catalog_is_empty(harness, monkeypatch):
    """⚠ YKEDKJDJ5R：_skill_infos_for_turn 交空列表，点名仍必须打开种子 zip。"""
    monkeypatch.setattr(control, "_skill_infos_for_turn", lambda state: [])
    sid = new_sid("skill-invoke-seed")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-inv")
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert "office-skills" in str(results[0].get("skill_message") or "")
    assert int(results[0].get("seedBytes") or 0) > 80


def test_skill_loads_local_seed_when_catalog_is_empty(harness, monkeypatch):
    """⚠ 2026-09-21 XSGAMK9PYZ：GET /skills 已装 office-skills，
    skill() 却 available=[]。商店 unpack 失败时必须打开仓库种子 zip。
    """
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [])
    sid = new_sid("skill-seed")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})
    n = {"i": 0}

    def model(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-seed")
        return llm_text("开始写计划")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid, "@office-skills 做个PPT",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("error") != "skill_not_found"
    body = str(results[0].get("skill_message") or "")
    assert "office-skills" in body
    assert len(body) > 80


def test_skill_survives_catalog_empty_after_plan_turn(harness, monkeypatch):
    """⚠ 2026-09-21 13ME64TF8Z：批准后新回合 skill_not_found。

    第一回合商店有 office-skills，第二回合目录空了。缓存必须还在。
    """
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    box = {"infos": [office]}
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: list(box["infos"]))
    sid = new_sid("skill-cache")
    seed_session(sid, goal={"text": "@office-skills 做个PPT", "status": "clear"})

    n0 = {"i": 0}

    def first(*_a, **_k):
        n0["i"] += 1
        if n0["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-1")
        return llm_text("开始写计划")

    harness.llm_impl = first
    harness.post(six_fields(
        sid, "@office-skills 做个PPT",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    loaded = load_session(sid)
    assert loaded is not None
    names = [row.get("name") for row in (loaded.controlSkillCache or [])]
    assert "office-skills" in names, loaded.controlSkillCache

    box["infos"] = []
    n = {"i": 0}

    def second(*_a, **_k):
        n["i"] += 1
        if n["i"] == 1:
            return llm_tool("skill", {"name": "office-skills"}, call_id="sk-2")
        return llm_text("按计划继续")

    harness.llm_impl = second
    _, events = harness.post(six_fields(
        sid, "批准计划并执行",
        selectedSkills=["office-skills"], installedSkills=["office-skills"],
    ))
    results = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "skill"
    ]
    assert results, [e.get("type") for e in events]
    assert results[0].get("ok") is True, results[0]
    assert results[0].get("error") != "skill_not_found"
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" in str(results[0].get("skill_message") or "")


def test_reload_and_error_park_are_on_the_live_dispatch():
    body = _fn_body(strip_python(CONTROL_SRC), "_dispatch_tool")
    assert "_skills_loaded_this_turn" in body
    assert "alreadyLoaded" in body
    loop = _fn_body(strip_python(CONTROL_SRC), "_control_llm_loop")
    fail_at = loop.find("except LlmError")
    park_at = loop.find("_park_control_error(", fail_at)
    generic_at = loop.find("except Exception", fail_at)
    park2_at = loop.find("_park_control_error(", generic_at)
    canned_in_fail = loop.find("_canned(", fail_at, generic_at)
    assert 0 <= fail_at < park_at < generic_at < park2_at
    assert canned_in_fail == -1, "LlmError 分支又走回了 _canned"
