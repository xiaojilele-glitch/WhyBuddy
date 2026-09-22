"""Plan rejection feedback remains visible until a revised plan supersedes it."""

from models.v5_state import V5SessionState
from services.rehearsal_control import _system_prompt


def test_plan_cancelled_feedback_reaches_the_next_model_turn():
    state = V5SessionState(sessionId="cancelled", goal={"text": "Clinic"})
    state.controlTranscript = [
        {"kind": "plan_written", "planId": "p1", "revision": 1, "planContent": "Phone booking"},
        {"kind": "plan_cancelled", "feedback": "Use desktop instead"},
        {"kind": "turn", "role": "user", "text": "Continue planning"},
    ]
    prompt = _system_prompt(state)
    assert "Phone booking" in prompt
    assert "Use desktop instead" in prompt


def test_revised_plan_retires_the_previous_rejection_feedback():
    state = V5SessionState(sessionId="revised", goal={"text": "Clinic"})
    state.controlTranscript = [
        {"kind": "plan_cancelled", "feedback": "Obsolete feedback"},
        {"kind": "plan_written", "planId": "p1", "revision": 2, "planContent": "Desktop booking"},
    ]
    prompt = _system_prompt(state)
    assert "Desktop booking" in prompt
    assert "Obsolete feedback" not in prompt


def test_no_rejection_is_invented_for_a_fresh_session():
    state = V5SessionState(sessionId="fresh", goal={"text": "Clinic"})
    assert "plan_cancelled" not in _system_prompt(state)
