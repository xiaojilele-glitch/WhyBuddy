"""Plan documents and approval requests must not appear before storage commits."""
import asyncio

import pytest

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import rehearsal_control as control


@pytest.mark.parametrize("tool,args", [
    ("write_plan", {"planContent": "A newly revised implementation document"}),
    ("enter_plan_mode", {}),
    ("exit_plan_mode", {}),
])
def test_plan_storage_failure_does_not_publish_candidate(monkeypatch, tool, args):
    state = V5SessionState(sessionId="plan-storage-failure", goal={"text": "inventory app"}, controlTranscript=approved_plan_rows()[:1])
    before = state.model_dump()
    events = []
    writes = []

    def fail_save(candidate, **kwargs):
        assert candidate is not state
        assert kwargs == {"server_write": True, "require_durable": True,
                          "expected_control_run": None}
        writes.append(candidate.model_dump())
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(control, "save_session", fail_save)

    async def run():
        async for event in control._dispatch_tool(tool, args, state, "", [], [], "desktop", None, "inventory app"):
            events.append(event)

    with pytest.raises(RuntimeError, match="storage unavailable"):
        asyncio.run(run())
    assert len(writes) == 1
    assert state.model_dump() == before
    assert not any(e.get("type") == "control_plan_approval" or e.get("ok") is True for e in events)
