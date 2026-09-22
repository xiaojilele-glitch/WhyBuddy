"""方案 B 真 LLM 收口总结：prompt 材料装配 + 失败回落语义。

总结永远不挡闭环：LLM 失败/无通道返回 None（调用方回落客户端模板 A）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_closure_summary as summary_mod  # noqa: E402


def _state_with_artifacts() -> V5SessionState:
    state = V5SessionState(
        sessionId="s-sum",
        goal={"text": "做一个青少年编程竞赛报名与作品评审平台"},
        artifacts=[],
    )
    state.artifacts = [
        {
            "id": "a1",
            "kind": "risk",
            "title": "Risk analysis",
            "summary": "风险清单",
            "content": "评审公平性风险：评委利益冲突需回避机制。",
            "producedBy": {"capabilityRunId": "r1", "capabilityId": "risk.analyze", "roleId": "agent"},
        },
        {
            "id": "a2",
            "kind": "risk",
            "title": "Synthesis",
            "summary": "综合",
            "content": "结论：先做报名+评审最小闭环。",
            "producedBy": {"capabilityRunId": "r2", "capabilityId": "synthesis.merge", "roleId": "agent"},
        },
    ]
    return state


CLOSURE = {
    "blocked": False,
    "perSkillEvidence": {
        "datamodel": {
            "evidencePresent": True,
            "modelSection": {
                "entities": [
                    {"id": "contest", "name": "竞赛", "fields": [{"id": "f1"}, {"id": "f2"}]},
                    {"id": "entry", "name": "报名", "fields": [{"id": "f3"}]},
                ]
            },
        },
        "rbac": {"evidencePresent": True, "modelSection": {"roles": ["student", "judge"], "permissions": ["p1"]}},
        "workflow": {"evidencePresent": True, "modelSection": {"nodes": [{"id": "n1"}], "transitions": []}},
        "page": {"evidencePresent": True, "modelSection": {"pages": [{"id": "pg", "name": "报名页"}]}},
        "aigc": {"evidencePresent": True},
        "appbundle": {"evidencePresent": True},
    },
}


def test_build_summary_messages_carries_full_context():
    messages = summary_mod.build_summary_messages(_state_with_artifacts(), CLOSURE)
    assert messages[0]["role"] == "system"
    user = messages[1]["content"]
    assert "青少年编程竞赛" in user
    assert "closed" in user and "6/6" in user
    # 五系统事实 + 轮内真实产出都进了材料
    assert "2 实体" in user and "竞赛" in user
    assert "student" in user
    assert "评委利益冲突" in user  # risk.analyze content
    assert "最小闭环" in user  # synthesis.merge content
    # 指令要求覆盖四点
    assert "能干什么" in messages[0]["content"]
    assert "风险" in messages[0]["content"]


def test_generate_summary_never_raises_and_falls_back_to_none(monkeypatch):
    # 无 LLM 通道 / 调用失败 → None（客户端回落模板 A），绝不抛出
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert summary_mod.generate_closure_chat_summary(_state_with_artifacts(), CLOSURE) is None


LEAKED_CHECKLIST = (
    "存审计日志 / 字数与格式检查\n"
    "字数：大约 280 字\n"
    "符合「350 字以内」"
)


def test_echoed_checklist_is_rejected_for_mechanical_facts(monkeypatch):
    """⚠ 2026-08-19：模型把指令清单写进 chatSummary。对照 Instructor
    拒收像 prompt 的 completion——回声不许落库。"""
    import sliderule_llm.client as client_mod

    class _Result:
        content = LEAKED_CHECKLIST
        model = "fake"
        usage = {}

    def fake_call(messages, **kwargs):
        on_delta = kwargs.get("on_delta")
        if on_delta:
            on_delta("存审计日志")
            on_delta(" / 字数与格式检查")
        return _Result()

    monkeypatch.setattr(client_mod, "call_llm_with_retry", fake_call)
    chunks = []
    text = summary_mod.generate_closure_chat_summary(
        _state_with_artifacts(), CLOSURE, on_delta=chunks.append
    )
    assert text is not None
    assert "字数与格式检查" not in text
    assert "存审计日志" not in text
    assert "数据模型" in text and "2 实体" in text
    assert all("字数与格式检查" not in c for c in chunks)


def test_good_summary_unchanged(monkeypatch):
    import sliderule_llm.client as client_mod

    class _Result:
        content = "闭环已闭合。这个竞赛平台能报名、评审。"
        model = "fake"
        usage = {}

    monkeypatch.setattr(
        client_mod, "call_llm_with_retry", lambda *a, **k: _Result()
    )
    text = summary_mod.generate_closure_chat_summary(
        _state_with_artifacts(), CLOSURE
    )
    assert text == "闭环已闭合。这个竞赛平台能报名、评审。"


def test_echo_detector_does_not_flag_audit_app():
    """反向：真做审计日志的应用，正文提到审计不该被误杀。"""
    assert summary_mod.summary_looks_like_instruction_echo(
        "本应用会把每次派工写入审计日志，便于事后追责。"
    ) is False
    assert summary_mod.summary_looks_like_instruction_echo(LEAKED_CHECKLIST) is True


def test_generate_summary_streams_deltas(monkeypatch):
    import sliderule_llm.client as client_mod

    class _Result:
        content = "总结正文"
        model = "fake"
        usage = {}

    def fake_call(messages, **kwargs):
        on_delta = kwargs.get("on_delta")
        if on_delta:
            on_delta("总结")
            on_delta("正文")
        return _Result()

    monkeypatch.setattr(client_mod, "call_llm_with_retry", fake_call)
    chunks = []
    text = summary_mod.generate_closure_chat_summary(
        _state_with_artifacts(), CLOSURE, on_delta=chunks.append
    )
    assert text == "总结正文"
    assert chunks == ["总结", "正文"]
