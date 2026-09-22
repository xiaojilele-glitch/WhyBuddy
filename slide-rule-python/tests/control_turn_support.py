"""Live-path harness for POST /api/sliderule/control-turn-stream.

⚠ 反向判据必须打在这条 HTTP 上：monkeypatch 的是
`services.rehearsal_control.start_drive_full_factory_run`（模块顶 import），
不是把 helper 单独调一遍。单独调会让「删掉 dispatcher 调用点」照样绿。
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi.testclient import TestClient

from app import app
from conftest import TEST_USER_ID
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services.slide_rule_session import load_session, save_session
from sliderule_llm.control_client import ControlLlmResult

KEY = {"x-internal-key": "dev-slide-rule-internal"}
CONTROL_URL = "/api/sliderule/control-turn-stream"
ROOT = Path(__file__).resolve().parents[2]
PY_ROOT = Path(__file__).resolve().parents[1]

client = TestClient(app)


def new_sid(prefix: str = "ctl") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _seed_hop_artifact(state: V5SessionState) -> None:
    """假工厂不跑 spec-first，但 host 交回后必须看见这一跳的产物。

    活路径在 v5_capability_executor 把 take_last_pages 写进 specFirstPages。
    夹具若不落 SPEC，pages 不会进清单，`必须调 pages` 的提示词也拼不出来——
    测的是「工厂空转」，不是「host 下一跳」。

    ⚠ 第 7 格：host 交回后再挑 pages。上一版 `if spec not in tools: return`
      且「已有 SPEC 就整段跳过」——pages 跳 stamp=['pages'] 时夹具什么都不落，
      下一跳 blocker 说还没有页面。有 SPEC 仍要按本跳补 pages。
    """
    goal = state.goal if isinstance(state.goal, dict) else {}
    tools = list(goal.get("tools") or [])
    blob = state.specFirstPages if isinstance(state.specFirstPages, dict) else {}
    out = dict(blob)
    changed = False
    spec = out.get("spec")
    has_spec = isinstance(spec, dict) and bool(
        spec.get("pages") or spec.get("nodes") or spec.get("appName")
    )
    if ("spec" in tools or "rehearse" in tools) and not has_spec:
        out["spec"] = {
            "appName": str(goal.get("text") or "应用")[:40],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        }
        changed = True
    pages = out.get("pages") if isinstance(out.get("pages"), dict) else {}
    if any(t in tools for t in ("pages", "structure", "bind")) and not pages:
        out["pages"] = {"p1": "<html>p1</html>"}
        changed = True
    if not changed:
        return
    state.specFirstPages = out
    save_session(state)


def six_fields(sid: str, user_text: str, **extra: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "sessionId": sid,
        "userText": user_text,
        "installedSkills": extra.pop("installedSkills", []),
        "activeConnectors": extra.pop("activeConnectors", []),
        "preferredDevice": extra.pop("preferredDevice", "desktop"),
        "designSystemId": extra.pop("designSystemId", None),
    }
    if extra.get("toolAnswer") is not None:
        body["toolAnswer"] = extra.pop("toolAnswer")
    body.update(extra)
    return body


def parse_sse(text: str) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped.startswith("data:"):
            continue
        raw = stripped[5:].strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return events


def event_types(events: List[Dict[str, Any]]) -> List[str]:
    return [str(e.get("type") or "") for e in events]


def seed_session(sid: str, **kwargs: Any) -> V5SessionState:
    payload: Dict[str, Any] = {
        "sessionId": sid,
        "goal": kwargs.pop("goal", {"text": "", "status": "needs_refinement"}),
        "ownerId": kwargs.pop("ownerId", TEST_USER_ID),
        "conversation": kwargs.pop("conversation", []),
        "artifacts": kwargs.pop("artifacts", []),
    }
    payload.update(kwargs)
    return save_session(V5SessionState(**payload))


def seed_approved_session(sid: str, **kwargs: Any) -> V5SessionState:
    """Execution tests opt in to the now-required server approval precondition."""
    kwargs["controlTranscript"] = [
        row for row in kwargs.get("controlTranscript", [])
        if not str(row.get("kind", "")).startswith("plan_")
    ] + approved_plan_rows()
    if kwargs.get("awaitReason") == "control_scope":
        kwargs["awaitReason"] = None
        kwargs["awaitDetail"] = None
    return seed_session(sid, **kwargs)


def goal_text(state: Optional[V5SessionState]) -> str:
    if state is None:
        return ""
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    return str(getattr(goal, "text", "") or "").strip()


def llm_text(content: str) -> ControlLlmResult:
    return ControlLlmResult(
        content=content,
        tool_calls=[],
        usage={"total_tokens": 12},
        finish_reason="stop",
        model="ctrl-test",
        latency_ms=1,
    )


def llm_tool(
    name: str,
    arguments: Optional[Dict[str, Any]] = None,
    call_id: str = "call-1",
    usage: Optional[Dict[str, Any]] = None,
) -> ControlLlmResult:
    return ControlLlmResult(
        content="",
        tool_calls=[
            {
                "id": call_id,
                "name": name,
                "arguments": arguments or {},
            }
        ],
        usage=usage if usage is not None else {"total_tokens": 12},
        finish_reason="tool_calls",
        model="ctrl-test",
        latency_ms=1,
    )


def strip_python(path: Path) -> str:
    """剥注释 + 模块/函数/类文档串。标识符写在头注里不得把变异养绿。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            continue
        body = getattr(node, "body", None)
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            body.pop(0)
    return ast.unparse(tree)


def read_repo(*parts: str) -> str:
    return (ROOT.joinpath(*parts)).read_text(encoding="utf-8")


class ControlHarness:
    """Patch the live dispatcher imports, then POST the real route.

    live_factory=True：只把 helper 包一层（load_session 记 goal）再调真
    start_drive_full_factory_run；生成器换成记录 driver 入参 goal 的短流。
    删掉确认路径的 persist，goals_at_handoff / driver_goals 会空。
    """

    def __init__(self, monkeypatch: Any, *, live_factory: bool = False) -> None:
        self.helper_calls: List[Dict[str, Any]] = []
        self.llm_calls: List[Dict[str, Any]] = []
        self.invalidate_calls: List[Any] = []
        self.generator_calls: List[Any] = []
        self.goals_at_handoff: List[str] = []
        self.driver_goals: List[str] = []
        self.llm_impl: Callable[..., ControlLlmResult] = (
            lambda messages, **kw: llm_text("ok")
        )
        self._install(monkeypatch, live_factory=live_factory)

    def _install(self, monkeypatch: Any, *, live_factory: bool) -> None:
        import services.drive_full_factory as factory
        import services.rehearsal_control as rc
        from services import run_registry
        from services import v5_full_driver

        async def fake_helper(
            session_id: str,
            user_text: str,
            installed_skills: Any,
            active_connectors: Any,
            preferred_device: Any,
            design_system_id: Any,
            **kwargs: Any,
        ):
            loaded = load_session(session_id)
            self.goals_at_handoff.append(goal_text(loaded))
            self.helper_calls.append(
                {
                    "session_id": session_id,
                    "user_text": user_text,
                    "installed_skills": installed_skills,
                    "active_connectors": active_connectors,
                    "preferred_device": preferred_device,
                    "design_system_id": design_system_id,
                    **kwargs,
                }
            )
            if loaded is not None:
                _seed_hop_artifact(loaded)
                loaded = load_session(session_id) or loaded
            dump = (
                loaded.model_dump()
                if loaded is not None
                else {"sessionId": session_id}
            )

            async def gen():
                yield {"type": "complete", "state": dump}

            return await run_registry.start_run(
                str(session_id), gen, user_text=user_text or "",
                owner_id=getattr(loaded, "ownerId", None),
            )

        def fake_llm(messages, **kwargs):
            self.llm_calls.append({"messages": messages, "kwargs": kwargs})
            return self.llm_impl(messages, **kwargs)

        real_inv = rc.apply_user_intervention_invalidation

        def spy_inv(state, intervention):
            self.invalidate_calls.append(intervention)
            return real_inv(state, intervention)

        real_helper = rc.start_drive_full_factory_run

        async def wrapping_helper(
            session_id: str,
            user_text: str,
            installed_skills: Any,
            active_connectors: Any,
            preferred_device: Any,
            design_system_id: Any,
            **kwargs: Any,
        ):
            loaded = load_session(session_id)
            self.goals_at_handoff.append(goal_text(loaded))
            self.helper_calls.append(
                {
                    "session_id": session_id,
                    "user_text": user_text,
                    "installed_skills": installed_skills,
                    "active_connectors": active_connectors,
                    "preferred_device": preferred_device,
                    "design_system_id": design_system_id,
                    **kwargs,
                }
            )
            return await real_helper(
                session_id,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                **kwargs,
            )

        async def stub_factory_stream(state, *args, **kwargs):
            self.driver_goals.append(goal_text(state))
            tools = (
                list((state.goal or {}).get("tools") or [])
                if isinstance(getattr(state, "goal", None), dict)
                else []
            )
            self.generator_calls.append(
                {
                    "args": args,
                    "kwargs": kwargs,
                    "tools": tools,
                    "productSteps": list(
                        (state.goal or {}).get("productSteps") or []
                    )
                    if isinstance(getattr(state, "goal", None), dict)
                    else [],
                }
            )
            yield {"type": "complete", "state": state.model_dump()}

        real_gen = v5_full_driver.drive_full_v5_session_stream

        async def spy_gen(*args, **kwargs):
            self.generator_calls.append({"args": args, "kwargs": kwargs})
            async for event in real_gen(*args, **kwargs):
                yield event

        monkeypatch.setattr(rc, "call_control_llm", fake_llm)
        monkeypatch.setattr(rc, "apply_user_intervention_invalidation", spy_inv)
        if live_factory:
            monkeypatch.setattr(rc, "start_drive_full_factory_run", wrapping_helper)
            monkeypatch.setattr(
                factory, "drive_full_v5_session_stream", stub_factory_stream
            )
        else:
            monkeypatch.setattr(rc, "start_drive_full_factory_run", fake_helper)
            monkeypatch.setattr(
                v5_full_driver, "drive_full_v5_session_stream", spy_gen
            )

    def post(
        self, body: Dict[str, Any], expect_status: int = 200
    ) -> Tuple[Any, List[Dict[str, Any]]]:
        response = client.post(CONTROL_URL, json=body, headers=KEY)
        assert response.status_code == expect_status, response.text[:1200]
        events = parse_sse(response.text) if response.status_code == 200 else []
        return response, events
