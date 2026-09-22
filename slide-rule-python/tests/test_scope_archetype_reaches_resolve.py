"""Persisted product choices still reach the factory after explicit plan approval."""
from __future__ import annotations

import pytest

from control_turn_support import ControlHarness, event_types, new_sid, seed_approved_session, seed_session, six_fields
from services.slide_rule_session import load_session


@pytest.mark.parametrize("archetype", ["business_app", "content_app", "free_app"])
@pytest.mark.parametrize("device", ["desktop", "phone", "tablet"])
def test_approved_goal_choices_reach_factory(monkeypatch, archetype, device):
    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("approved-choices")
    seed_approved_session(sid, goal={"text": "inventory management system", "status": "clear", "preferredDevice": device, "productArchetype": archetype})
    _, events = harness.post(six_fields(sid, "continue", forcedTool="spec", preferredDevice="desktop", productArchetype="business_app"))
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0]["preferred_device"] == device
    assert "control_handoff_factory" in event_types(events)
    assert load_session(sid).goal["productArchetype"] == archetype
    assert "control_scope_card" not in event_types(events)


@pytest.mark.parametrize("archetype", ["casual_game", "unknown_archetype"])
def test_unwired_or_unknown_persisted_archetype_cannot_handoff(monkeypatch, archetype):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("unwired-approved")
    seed_approved_session(sid, goal={"text": "inventory management system", "status": "clear", "productArchetype": archetype})
    _, events = harness.post(six_fields(sid, "continue", forcedTool="spec"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
    assert any(archetype in str(e.get("text", "")) for e in events)


def test_product_settings_do_not_grant_plan_approval(monkeypatch):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("choices-no-approval")
    seed_session(sid, goal={"text": "inventory management system", "status": "clear", "preferredDevice": "tablet", "productArchetype": "free_app"})
    _, events = harness.post(six_fields(sid, "continue", forcedTool="spec"))
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)
