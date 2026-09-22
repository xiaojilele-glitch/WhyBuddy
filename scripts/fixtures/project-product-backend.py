"""Trusted smoke bootstrap around the actual app and its unmodified lifespan.

Only the account, approved session, source-edit intent and initial runtime ID
are fixtures. Auth dependencies, SQL stores, workers, gateway callbacks and
provider IO remain real. This file is never installed as a product route.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import sys


def main(config_path: str) -> None:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    os.environ.update(config["environment"])
    backend = Path(__file__).resolve().parents[2] / "slide-rule-python"
    sys.path.insert(0, str(backend))
    from app import app
    from fastapi import Header, HTTPException
    from models.v5_state import V5SessionState
    from services import persistence, project_runtime_worker
    from services.identity_store import get_identity_store, hash_password
    from services.project_authority import approved_reference
    from services.project_manifest import content_hash
    from services.project_store import get_project_store
    from services.project_tools import ProjectTools

    identity = get_identity_store()
    owner = identity.create(config["ownerEmail"], hash_password(config["password"]),
                            is_superuser=True, is_verified=True)
    stranger = identity.create(config["strangerEmail"], hash_password(config["password"]),
                               is_superuser=True, is_verified=True)
    plan = {"planId": "product-smoke-plan", "revision": 1, "reqId": "product-smoke-approval",
        "planContent": "Run the fixed Vite template; change its heading in the same runtime; inspect private preview in both workbenches; verify counter behavior in an independent browser, break then repair the counter and recheck; stop and clean up."}
    if config.get("runtimeIds"):
        plan["planContent"] = "Run the fixed tasks application; create independent writer and reader accounts; check tasks CRUD, refresh and API permissions; save source, verify a production build, break and repair task status; inspect source history, export, fork and delivery; stop, checkpoint SQLite, restore source/data into a new sandbox, then stop and clean up."
    state = V5SessionState(sessionId=config["sessionId"], ownerId=owner.id,
        goal={"text": config["title"], "status": "clear"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    if not persistence.save_session_record(state, server_write=True).get("ok"):
        raise RuntimeError("smoke_seed_not_saved")
    approval = approved_reference(state)

    # E2B provides one exact TLS hostname, without a wildcard runtime subdomain.
    # Choose opaque IDs matching the exact fixture gateway TLS hosts. Tasks
    # smoke permits a second runtime on another port after destroying the first.
    runtime_model = project_runtime_worker.RuntimeInstance
    runtime_ids = []
    def fixture_runtime(**kwargs):
        allowed = config.get("runtimeIds", [config["runtimeId"]])
        if len(runtime_ids) >= len(allowed):
            raise RuntimeError("smoke_unexpected_second_runtime")
        selected = allowed[len(runtime_ids)]
        runtime_ids.append(kwargs["runtimeId"])
        return runtime_model(**{**kwargs, "runtimeId": selected})
    project_runtime_worker.RuntimeInstance = fixture_runtime

    def guard(value):
        if not secrets.compare_digest(value or "", "Bearer " + config["fixtureKey"]):
            raise HTTPException(403, "smoke_fixture_denied")

    def snapshot():
        store = get_project_store()
        project = store.get_project_for_session(state.sessionId, owner_id=owner.id)
        operations = store.list_project_operations(project.projectId, owner_id=owner.id) if project else []
        lease = store.get_lease(project.projectId, owner_id=owner.id) if project else None
        return {"sessionId": state.sessionId, "approvalRef": approval, "ownerId": owner.id,
            "strangerId": stranger.id, "project": project.model_dump(mode="json") if project else None,
            "operations": [op.model_dump(mode="json") for op in operations],
            "lease": lease.model_dump(mode="json") if lease else None,
            "runtimeIdFixtureCalls": len(runtime_ids),
            "composition": {"runtimeWorker": bool(app.state.project_runtime_supervisor and app.state.project_runtime_supervisor.running),
                "controlService": app.state.control_run_service is not None,
                "previewAccess": app.state.project_preview_access is not None,
                "previewRuntime": bool(app.state.project_runtime_supervisor and app.state.project_runtime_supervisor.preview_runtime)}}

    @app.get("/_smoke/state")
    def fixture_state(authorization: str | None = Header(default=None)):
        guard(authorization)
        return snapshot()

    @app.post("/_smoke/process/{process_id}")
    def fixture_process(process_id: str, authorization: str | None = Header(default=None)):
        guard(authorization)
        if not process_id.isdigit():
            raise HTTPException(422, "smoke_invalid_process")
        supervisor = app.state.project_runtime_supervisor
        provider = supervisor.provider_factory()
        value = snapshot()
        lease = value.get("lease") or {}
        handles = provider.find_workspaces(workspace_id=lease.get("workspaceId", "missing"))
        matching = [handle for handle in handles if handle.sandbox_id == lease.get("sandboxId")]
        if len(matching) != 1:
            raise HTTPException(409, "smoke_workspace_unavailable")
        provider.connect(matching[0])
        return {"processId": process_id, "running": provider.is_process_running(matching[0], process_id)}

    @app.post("/_smoke/patch")
    def fixture_patch(authorization: str | None = Header(default=None)):
        guard(authorization)
        store = get_project_store()
        current = persistence.load_session_record(state.sessionId)["session"]
        project = store.get_project(current.projectId, owner_id=owner.id)
        source = store.read_files(project.projectId, owner_id=owner.id)["src/main.tsx"]
        if source.count(">New Project</h1>") != 1:
            raise HTTPException(409, "smoke_patch_already_applied")
        tools = ProjectTools(store, app.state.project_runtime_supervisor, owner.id)
        return tools.execute("project_patch", {"approvalRef": approval,
            "expectedRevision": project.currentRevision, "changes": [{"path": "src/main.tsx",
                "expectedSha256": content_hash(source), "content": source.replace(">New Project</h1>",
                    ">Integrated source update</h1>")}]}, current)

    @app.post("/_smoke/revoke-owner")
    def fixture_revoke(authorization: str | None = Header(default=None)):
        guard(authorization)
        identity.set_superuser(owner.id, False)
        return {"ok": True}

    @app.post("/_smoke/counter/{action}")
    def fixture_counter(action: str, authorization: str | None = Header(default=None)):
        guard(authorization)
        if action not in {"break", "repair"}:
            raise HTTPException(404, "smoke_unknown_counter_action")
        store = get_project_store()
        current = persistence.load_session_record(state.sessionId)["session"]
        project = store.get_project(current.projectId, owner_id=owner.id)
        source = store.read_files(project.projectId, owner_id=owner.id)["src/counter.mjs"]
        expected, replacement = ("value + 1", "value + 2") if action == "break" else ("value + 2", "value + 1")
        if source.count(expected) != 1:
            raise HTTPException(409, "smoke_counter_patch_conflict")
        return ProjectTools(store, app.state.project_runtime_supervisor, owner.id).execute("project_patch", {
            "approvalRef": approval, "expectedRevision": project.currentRevision,
            "changes": [{"path": "src/counter.mjs", "expectedSha256": content_hash(source),
                         "content": source.replace(expected, replacement)}]}, current)

    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=config.get("port", 5192), access_log=False, log_level="warning")


if __name__ == "__main__":
    main(sys.argv[1])
