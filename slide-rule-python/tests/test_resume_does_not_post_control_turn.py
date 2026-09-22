"""刷新续播只 GET /runs/{id}/stream，不得再 POST control-turn-stream。

generator / helper 次数不得因续播增加。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ROOT,
    ControlHarness,
    KEY,
    client,
    event_types,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
    strip_python,
)
from pathlib import Path

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_get_run_stream_does_not_increase_helper_or_generator(harness):
    sid = new_sid("resume")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
    )
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert len(harness.helper_calls) == 1
    gen_after_ignite = len(harness.generator_calls)
    handoff = next(
        e for e in events if e.get("type") == "control_handoff_factory"
    )
    run_id = handoff["runId"]
    resumed = client.get(
        f"/api/sliderule/runs/{run_id}/stream?since=0", headers=KEY
    )
    assert resumed.status_code == 200, resumed.text[:500]
    assert len(harness.helper_calls) == 1
    assert len(harness.generator_calls) == gen_after_ignite
    # 续播是 GET，不是又 POST 一次控制面。
    assert "control_handoff_factory" in event_types(events)


def test_product_resume_arm_is_get_not_control_turn_post():
    """runTurn(..., { runId }) 只走 resumeDriveFullStream（GET）。

    反向：把续播改成 POST control-turn-stream → 这条红。
    """
    session = Path(ROOT / "client/src/pages/sliderule/useSlideRuleSession.ts")
    driver = Path(ROOT / "client/src/lib/sliderule-marathon-driver.ts")
    session_src = session.read_text(encoding="utf-8")
    driver_src = driver.read_text(encoding="utf-8")

    python_drive = session_src[
        session_src.index("const pythonDrive = resumeRun") : session_src.index(
            "classifyStreamFallback"
        )
    ]
    resume_at = python_drive.index("resumeDriveFullStream")
    post_at = python_drive.index("driveStream(")
    assert resume_at < post_at
    assert "postControlTurnStream" not in python_drive.split(":")[0]
    assert "resumeDriveFullStream(resumeRun.runId" in python_drive.replace(
        "\n", ""
    ) or "resumeDriveFullStream(resumeRun.runId" in python_drive

    assert "/api/sliderule/runs/${encodeURIComponent(runId)}/stream" in driver_src or (
        "/api/sliderule/runs/" in driver_src and "/stream" in driver_src
    )
    resume_fn = driver_src[
        driver_src.index("export async function resumeDriveFullStream") : driver_src.index(
            "type FactoryStreamAcc"
        )
    ]
    assert "method: \"POST\"" not in resume_fn
    assert "control-turn-stream" not in resume_fn
