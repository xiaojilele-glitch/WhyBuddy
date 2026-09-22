"""Read projections recheck historic proof against the immutable source manifest.

Simulate an older/corrupt stored receipt, then exercise store, model and delivery
reads. A valid suite assertion list cannot hide mismatched production build IO.
"""
from types import SimpleNamespace

import pytest

from models.v5_state import V5SessionState
from services.project_authority import verification_with_current_authority
from services.project_tools import ProjectTools
from services.project_verification_store import ProjectVerificationStore
from test_project_source_operations import setup
from test_project_delivery import proof


@pytest.mark.parametrize("setup", ["react-vite-tasks"], indirect=True)
@pytest.mark.parametrize("change", ["revision", "treeHash", "lockfileHash", "installExitCode", "buildExitCode", "outputHash", "outputFileCount", "serverKind", "assertions"])
def test_invalid_historic_build_is_stale_across_store_model_and_delivery(setup, change):
    initial, *_ = proof(setup)
    records = ProjectVerificationStore(setup.store)
    saved = records.get(initial.verificationId, owner_id="alice").verification
    damaged = saved.model_dump(mode="json")
    if change == "revision": damaged["build"][change] = "prv-old"
    elif change in {"treeHash", "lockfileHash"}: damaged["build"][change] = "0" * 64
    elif change in {"installExitCode", "buildExitCode"}: damaged["build"][change] = 19
    elif change == "outputHash": damaged["build"][change] = None
    elif change == "outputFileCount": damaged["build"][change] = 0
    elif change == "serverKind": damaged["build"][change] = "static-dist"
    else: damaged["assertions"] = damaged["assertions"][:-1]
    import json
    original = json.dumps(damaged)
    setup.store._q("update wb_project_verification set payload=$1 where id=$2", [original, saved.verificationId])
    snapshot = records.get(saved.verificationId, owner_id="alice")
    assert snapshot.verification.status == "passed" and snapshot.effectiveStatus == "stale"
    state = V5SessionState.server_load(setup.sessions.load(setup.project.sessionId).payload)
    assert verification_with_current_authority(snapshot, state).deliveryEligible is False
    tools = ProjectTools(setup.store, SimpleNamespace(verification_store=records), "alice")
    observed = tools.execute("project_verification", {"operationId": saved.operationId}, state)
    assert observed["ok"] and observed["verification"]["status"] == "stale"
    assert observed["verification"]["deliveryEligible"] is False
    assert not setup.client.get(setup.url + "/delivery").json()["eligible"]
    assert setup.store._q("select payload from wb_project_verification where id=$1", [saved.verificationId])[0]["payload"] == original


@pytest.mark.parametrize("setup", ["react-vite-tasks"], indirect=True)
@pytest.mark.parametrize("change", [{"revision": "prv-old"}, {"treeHash": "0" * 64},
    {"installExitCode": 23}, {"buildExitCode": False}, {"outputFileCount": 0}])
def test_authority_revalidates_typed_build_copied_without_pydantic_validation(setup, change):
    initial, *_ = proof(setup)
    snapshot = ProjectVerificationStore(setup.store).get(initial.verificationId, owner_id="alice")
    state = V5SessionState.server_load(setup.sessions.load(setup.project.sessionId).payload)
    assert verification_with_current_authority(snapshot, state).deliveryEligible is True
    damaged = snapshot.verification.model_copy(update={"build": snapshot.verification.build.model_copy(update=change)})
    assert verification_with_current_authority(snapshot.model_copy(update={"verification": damaged}), state).deliveryEligible is False
