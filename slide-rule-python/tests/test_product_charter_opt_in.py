"""产品宪章 opt-in 必须接在通电的 spec-first / scope_card 上。

仓里第一条 + 第三条：函数写对了 ≠ 它被调用了。这个文件里每一条正向
（opt-in 真 → 宪章进 prompt）都配反向（opt-in 假 / 没旗 / 删调用点 → 不进）。

判据剥注释后再 grep 调用点——只写在模块头里的 charter_prompt_block 不算。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import product_charter as pc  # noqa: E402
from services.rehearsal_control import _system_prompt  # noqa: E402
from services.spec_tree import build_spec_prompt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean():
    pc.reset_charter_cache()
    yield
    pc.reset_charter_cache()


def _strip_py(src: str) -> str:
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"'''[\s\S]*?'''", "", src)
    src = re.sub(r"#.*", "", src)
    return src


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


SAMPLE = {
    "industry": "咖啡烘焙",
    "terms": "生豆批次、出炉曲线",
    "defaultRoles": "烘焙主管",
    "hardCompliance": "食品留样 48 小时",
    "brandConstraints": "不要写成连锁奶茶",
}


def test_opt_in_关着_spec_prompt_里不许出现宪章():
    pc.set_charter_context(SAMPLE, opt_in=False)
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert pc.CHARTER_MARKER not in user
    assert "咖啡烘焙" not in user
    assert pc.charter_prompt_block() == ""


def test_opt_in_开着_spec_prompt_里必须有宪章():
    """活路径：build_spec_prompt 自己去读 charter_prompt_block。
    直接调 charter_prompt_block 全绿、调用点被删照样绿——所以要从拼 prompt
    的那个函数里找它。"""
    pc.set_charter_context(SAMPLE, opt_in=True)
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert pc.CHARTER_MARKER in user
    assert "咖啡烘焙" in user
    assert "食品留样 48 小时" in user
    assert "不是证据" in user


def test_opt_in_关着时_prompt与从前逐字一致():
    """库里/上下文有宪章但没打旗，spec-first prompt 必须跟清空后逐字节一样。
    否则『关着』只是不写标记、正文仍漏进去。"""
    pc.clear_charter_for_run()
    baseline = build_spec_prompt("做一个订单管理系统")
    pc.set_charter_context(SAMPLE, opt_in=False)
    assert build_spec_prompt("做一个订单管理系统") == baseline


def test_没有旗_存着宪章也不许注入():
    """库里有文档 ≠ 打了沿用旗。自动灌就是自动沿用。"""
    state = SimpleNamespace(sessionId="s-no-flag", ownerId="u1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="session", scope_id="s-no-flag", charter=SAMPLE, reuse_next=False)
    pc.activate_charter_for_run(state, {})
    user = build_spec_prompt("做一个天气看板")[-1]["content"]
    assert pc.CHARTER_MARKER not in user
    assert "咖啡烘焙" not in user
    scope = _system_prompt(state)
    assert pc.CHARTER_MARKER not in scope


def test_账户下一场沿用旗才注入():
    state = SimpleNamespace(sessionId="s-next", ownerId="acct-1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="account", scope_id="acct-1", charter=SAMPLE, reuse_next=True)
    pc.activate_charter_for_run(state, {})
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert "咖啡烘焙" in user
    assert pc.CHARTER_MARKER in _system_prompt(state)


def test_payload显式false盖过账户旗():
    state = SimpleNamespace(sessionId="s-off", ownerId="acct-1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="account", scope_id="acct-1", charter=SAMPLE, reuse_next=True)
    pc.activate_charter_for_run(state, {"reuseCharter": False})
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert "咖啡烘焙" not in user


def test_两回合_省略字段保留账户旗_显式false才清():
    """账户 reuse_next=True → {} 仍注入且旗仍真；{reuseCharter:false} 落 false；
    再 {} 不再注入。删掉 `if explicit is not None` 这条必须红。"""
    owner = "acct-two-turn"
    pc.save_charter(scope="account", scope_id=owner, charter=SAMPLE, reuse_next=True)

    first = SimpleNamespace(
        sessionId="s-t1", ownerId=owner, productCharter=None, charterReuseNext=False
    )
    pc.activate_charter_for_run(first, {})
    assert pc.CHARTER_MARKER in build_spec_prompt("做个应用")[-1]["content"]
    assert pc.load_charter(scope="account", scope_id=owner).get("reuse_next") is True

    pc.clear_charter_for_run()
    second = SimpleNamespace(
        sessionId="s-t2", ownerId=owner, productCharter=None, charterReuseNext=False
    )
    pc.activate_charter_for_run(second, {"reuseCharter": False})
    assert pc.CHARTER_MARKER not in build_spec_prompt("做个应用")[-1]["content"]
    assert pc.load_charter(scope="account", scope_id=owner).get("reuse_next") is False

    pc.clear_charter_for_run()
    third = SimpleNamespace(
        sessionId="s-t3", ownerId=owner, productCharter=None, charterReuseNext=False
    )
    pc.activate_charter_for_run(third, {})
    assert pc.CHARTER_MARKER not in build_spec_prompt("做个应用")[-1]["content"]
    assert pc.load_charter(scope="account", scope_id=owner).get("reuse_next") is False


def test_payload_reuseCharter_true才把正文送进_scope与spec():
    state = SimpleNamespace(sessionId="s-on", ownerId="u2", productCharter=None, charterReuseNext=False)
    pc.activate_charter_for_run(
        state, {"productCharter": SAMPLE, "reuseCharter": True}
    )
    assert pc.CHARTER_MARKER in build_spec_prompt("做个应用")[-1]["content"]
    assert pc.CHARTER_MARKER in _system_prompt(state)


def test_五系统模型字段不许进宪章():
    stuffed = {
        "industry": "烘焙",
        "datamodel": {"entities": [{"id": "order", "fields": []}]},
        "rbac": {"roles": ["admin"]},
        "workflow": {},
        "page": {},
        "aigc": {},
        "appbundle": {},
        "fiveSystemModel": {"x": 1},
    }
    cleaned = pc.normalize_charter(stuffed)
    assert "datamodel" not in cleaned
    assert "rbac" not in cleaned
    assert cleaned == {"industry": "烘焙"}
    for key in pc._FIVE_SYSTEM_KEYS:
        assert key not in cleaned
    pc.set_charter_context(stuffed, opt_in=True)
    block = pc.charter_prompt_block()
    assert "entities" not in block
    assert "admin" not in block
    assert "烘焙" in block


def test_工厂kwargs缺键不等于显式false():
    assert "reuse_charter" not in pc.factory_charter_kwargs({})
    assert "reuse_charter" not in pc.factory_charter_kwargs({"productCharter": SAMPLE})
    assert pc.factory_charter_kwargs({"reuseCharter": False})["reuse_charter"] is False
    assert pc.factory_charter_kwargs({"reuseCharter": True})["reuse_charter"] is True


def test_建造者文档路径不许当宪章正文():
    cleaned = pc.normalize_charter(
        {"industry": "见 Claude.md 第三条", "terms": "AGENTS.md 里的闸"}
    )
    assert cleaned == {}


def test_调用点写在_spec_first与_scope_prompt_剥注释后还在():
    spec = _strip_py(_src("slide-rule-python/services/spec_tree.py"))
    control = _strip_py(_src("slide-rule-python/services/rehearsal_control.py"))
    # 活路径：build_spec_prompt 里真的 append 了，不只是调了函数丢掉返回值。
    build = spec[spec.index("def build_spec_prompt") : spec.index("def generate_spec_tree")]
    assert "charter_prompt_block()" in build
    assert "parts.append(charter)" in build
    sys_fn = control[control.index("def _system_prompt") : control.index("def _usage_tokens")]
    assert "charter_prompt_block()" in sys_fn


def test_同步和流式两条驱动都激活了也都清空了():
    routes = _strip_py(_src("slide-rule-python/routes/sliderule_full.py"))
    helper = _strip_py(_src("slide-rule-python/services/drive_full_factory.py"))
    control = _strip_py(_src("slide-rule-python/services/rehearsal_control.py"))
    assert "activate_charter_for_run(state, payload)" in routes
    assert "activate_charter_for_run(state, charter_payload)" in helper
    assert "activate_charter_for_run(state, None)" not in helper
    assert "activate_charter_for_run(state, payload)" in control
    assert "factory_charter_kwargs" in routes
    assert "factory_charter_kwargs" in control
    assert "reuse_charter" in helper
    assert "product_charter" in helper
    assert routes.count("clear_charter_for_run()") >= 1
    assert helper.count("clear_charter_for_run()") >= 1
    assert control.count("clear_charter_for_run()") >= 1


def test_control_turn信封把reuseCharter送到工厂命名字段(monkeypatch):
    """确认 extras 真的到 helper kwargs。只 grep 源码键名会绿、调用点被删也绿。"""
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: E402
        ControlHarness,
        new_sid,
        seed_approved_session as seed_session,
        six_fields,
    )

    harness = ControlHarness(monkeypatch)
    sid = new_sid("charter-extra")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            reuseCharter=True,
            productCharter=SAMPLE,
        )
    )
    assert len(harness.helper_calls) == 1
    call = harness.helper_calls[0]
    assert call.get("reuse_charter") is True, "reuseCharter 没进工厂命名字段"
    assert call.get("product_charter") == SAMPLE


def test_工厂命名字段即使控制面ContextVar被清也注入(monkeypatch):
    """删掉 stream_factory 里的 activate 必须红——不能靠 control-turn 的
    ContextVar 副本把宪章带进 spec-first。"""
    import asyncio
    from types import SimpleNamespace as NS

    from models.v5_state import V5SessionState
    from services.drive_full_factory import start_drive_full_factory_run
    from services.slide_rule_session import save_session

    captured: dict = {}

    async def fake_stream(state, **kwargs):
        captured["prompt"] = build_spec_prompt("做个应用")[-1]["content"]
        yield {"type": "complete", "state": state.model_dump()}

    async def inline_start(session_id, stream_factory, on_complete=None, **kw):
        async for event in stream_factory():
            if on_complete and isinstance(event, dict) and event.get("type") == "complete":
                event = await on_complete(event)
        return NS(run_id="run-charter-factory")

    import services.drive_full_factory as factory
    from services import run_registry

    monkeypatch.setattr(factory, "drive_full_v5_session_stream", fake_stream)
    monkeypatch.setattr(run_registry, "start_run", inline_start)

    sid = "s-factory-named-charter"
    from plan_approval_support import approved_plan_rows

    save_session(
        V5SessionState(
            sessionId=sid,
            ownerId="u-factory-named",
            goal={"text": "做个应用", "status": "clear"},
            controlTranscript=approved_plan_rows(),
        )
    )
    pc.clear_charter_for_run()
    assert pc.charter_prompt_block() == ""

    async def scenario():
        return await start_drive_full_factory_run(
            sid,
            "做个应用",
            None,
            None,
            None,
            None,
            reuse_charter=True,
            product_charter=SAMPLE,
        )

    asyncio.run(scenario())
    assert pc.CHARTER_MARKER in captured.get("prompt", ""), (
        "工厂命名字段没把宪章送进 build_spec_prompt"
    )


def test_分一变体追加modelVersions且不粘源会话(monkeypatch):
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: E402
        ControlHarness,
        event_types,
        new_sid,
        seed_approved_session as seed_session,
        six_fields,
    )

    sid = new_sid("fork-tl")
    seed_session(
        sid,
        modelVersions=[{"id": "mv-1", "instruction": "初稿", "model": {"pages": []}}],
        currentModelVersionId="mv-1",
    )
    harness = ControlHarness(monkeypatch)
    _, events = harness.post(
        six_fields(sid, "从这里分一个变体", forcedTool="fork_variant")
    )
    types = event_types(events)
    assert "control_tool_result" in types
    result = next(e for e in events if e.get("type") == "control_tool_result")
    assert result.get("ok") is True
    assert result.get("versionId")
    assert result.get("versionId") != "mv-1"
    complete = next(e for e in events if e.get("type") == "complete")
    versions = (complete.get("state") or {}).get("modelVersions") or []
    assert len(versions) == 2, "版本条必须能看见新变体"
    assert versions[-1]["id"] == result["versionId"]
    assert (complete.get("state") or {}).get("currentModelVersionId") == result["versionId"]

    src = _strip_py(_src("slide-rule-python/services/rehearsal_control.py"))
    fork = src[src.index("async def _tool_fork") : src.index("def _system_prompt")]
    assert "fork_app" not in fork
    assert "session_id=state.sessionId" not in fork
    dispatch = src[src.index('if name == "fork_variant"') :]
    assert "_tool_fork" in dispatch
    assert "_complete(state)" in dispatch[:800]
