"""Explicit setup for execution tests; approval tests must exercise real receipts."""

from copy import deepcopy
from uuid import uuid4

from conftest import TEST_USER_ID
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session, save_session


def approved_plan_rows(content="Build the requested application and verify its workflows.",
                       *, deliverable_kind=None):
    document = {"planId": "test-plan", "revision": 1, "planContent": content}
    if deliverable_kind is not None:
        document["deliverableKind"] = deliverable_kind
    request = {**document, "reqId": "test-plan-approval"}
    return [
        {"role": "assistant", "kind": "plan_written", **document},
        {"role": "assistant", "kind": "plan_approval", **request},
        {"role": "user", "kind": "plan_approved", **request},
    ]


def approved_execution_payload(payload):
    """Seed the server prerequisite for tests of behavior after approval.

    Production intentionally ignores approval in HTTP bodies. Legacy execution
    tests must arrange it in the store without weakening any request guard.
    """
    body = deepcopy(payload)
    raw = dict(body.get("state") or {})
    sid = str(raw.get("sessionId") or body.get("sessionId") or f"approved-test-{uuid4().hex}")
    state = load_session(sid)
    if state is None:
        state = V5SessionState.server_load({**raw, "sessionId": sid, "ownerId": TEST_USER_ID})
    state.controlTranscript = [
        row for row in state.controlTranscript if not str(row.get("kind", "")).startswith("plan_")
    ] + approved_plan_rows()
    save_session(state, server_write=True)
    body["sessionId"] = sid
    body["state"] = {**raw, "sessionId": sid}
    return body
