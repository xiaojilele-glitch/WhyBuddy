"""Create a fixed source project from a durably approved product session.

Source creation and the conversation store cannot share one transaction. The
session-unique project identity repairs a crash between them, while binding
rechecks approval inside session persistence CAS. Source revisions remain the
authority; the session pointer is a repairable projection.
"""

from __future__ import annotations

from pathlib import Path
import uuid

from models.project_runtime import Project
from models.v5_state import V5SessionState
from services import persistence
from services.control_checkpoint import current_checkpoint
from services.project_acceptance import TASK_ACCEPTANCE_PROFILE
from services.deliverable_kind import (
    OFFICE_FILE,
    WORKSPACE_README,
    WORKSPACE_TEMPLATE_VERSION,
    idle_office_exec_allows_source_write,
    office_workspace_files,
    operation_left_on_lease,
    orch_trace,
    plan_deliverable_kind,
)
from services.project_authority import approved_reference, assert_session_authorized, has_generated_application
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStore, ProjectStoreUnavailable
from services.scope_authority import latest_control_plan

TEMPLATE_VERSION = "whybuddy-react-vite-1"
TEMPLATE_ROOT = Path(__file__).resolve().parents[2] / "project-templates" / "react-vite"
TEMPLATE_FILES = (
    "package.json", "package-lock.json", "tsconfig.json", "index.html",
    "src/main.tsx", "src/counter.mjs", "src/style.css", "tests/counter.test.mjs",
    "public/_whybuddy/editor.js",
)
TASK_TEMPLATE_VERSION = "whybuddy-react-vite-tasks-1"
TASK_TEMPLATE_FILES = (
    "package.json", "package-lock.json", "tsconfig.json", "index.html", "README.md",
    "database.mjs", "server.mjs", "src/main.tsx", "src/style.css", "tests/application.test.mjs",
    "public/_whybuddy/editor.js",
)


def load_project_template(template_id: str = "react-vite") -> tuple[dict[str, str], str]:
    if template_id not in {"react-vite", "react-vite-tasks"}:
        raise ValueError("project_template_unsupported")
    root = TEMPLATE_ROOT if template_id == "react-vite" else TEMPLATE_ROOT.parent / "react-vite-tasks"
    names = TEMPLATE_FILES if template_id == "react-vite" else TASK_TEMPLATE_FILES
    try:
        files = {name: (root / name).read_text(encoding="utf-8") for name in names}
    except (OSError, UnicodeError) as exc:
        raise ProjectStoreUnavailable("project_template_unavailable") from exc
    return files, TEMPLATE_VERSION if template_id == "react-vite" else TASK_TEMPLATE_VERSION


def load_authorized_session(session_id: str, *, owner_id: str,
                            approval_ref: str | None = None) -> V5SessionState:
    result = persistence.load_session_record(session_id)
    if not result.get("ok"):
        if result.get("reason") == "not_found" or result.get("error") == "not_found":
            raise ProjectNotFound("project_session_not_found")
        raise ProjectStoreUnavailable("project_session_store_unavailable")
    state = result.get("session")
    if not owner_id or not isinstance(state, V5SessionState) or state.ownerId != owner_id:
        raise ProjectNotFound("project_session_not_found")
    if approval_ref is not None:
        assert_session_authorized(state, owner_id=owner_id, approval_ref=approval_ref)
    return state


def _save_reference(state: V5SessionState, project: Project, approval_ref: str) -> V5SessionState:
    port = current_checkpoint.get()
    if port is not None:
        port.guard()
    candidate = state.model_copy(update={"runtimeKind": "project", "projectId": project.projectId,
                                         "projectRevision": project.currentRevision})
    result = persistence.save_session_record(candidate, server_write=True,
        project_binding_approval=approval_ref,
        expected_project_revision=state.projectRevision if state.projectId else None,
        expected_control_run=port.fence() if port is not None else None)
    if not result.get("ok") or not isinstance(result.get("state"), V5SessionState):
        raise ProjectStoreUnavailable("project_session_binding_failed")
    authoritative = result["state"]
    sink = persistence.get_cache_sink()
    if sink is not None:
        sink(authoritative.sessionId, authoritative)
    return authoritative


def sync_session_project(store: ProjectStore, session_id: str, *, owner_id: str,
                         approval_ref: str) -> V5SessionState:
    for _ in range(6):
        state = load_authorized_session(session_id, owner_id=owner_id, approval_ref=approval_ref)
        project = store.get_project_for_session(session_id, owner_id=owner_id)
        if project is None:
            raise ProjectNotFound("project_not_found")
        if state.projectId and state.projectId != project.projectId:
            raise ProjectConflict("project_identity_changed")
        revision = store.get_revision(project.projectId, owner_id=owner_id)
        if not state.projectId and revision.planRef != approval_ref:
            raise ProjectConflict("project_initial_plan_changed")
        try:
            saved = _save_reference(state, project, approval_ref)
        except persistence.PersistClosedError as exc:
            if exc.reason == "project_revision_conflict":
                continue
            if exc.reason == "project_plan_approval_required":
                raise PermissionError(exc.reason) from exc
            if exc.reason in {"project_conversion_required", "project_identity_changed", "session_owner_changed"}:
                raise ProjectConflict(exc.reason) from exc
            raise ProjectStoreUnavailable("project_session_binding_failed") from exc
        current = store.get_project(project.projectId, owner_id=owner_id)
        if saved.projectRevision == current.currentRevision:
            return saved
    raise ProjectConflict("project_reference_sync_conflict")


def _ensure_office_tree(store: ProjectStore, project: Project, *, owner_id: str,
                        approval_ref: str) -> Project:
    """办公计划的源码树必须是当前这份 README。

    ⚠ 2026-09-22 Z8NPKNM14C：进程里的 WORKSPACE_README 已是 309 字节，
      落库的仍是上一版 78 字 / 150 字节（sha 5edc1d7e）。工具回执照样
      ok。这里读回正文，不对就改这一份 README，不把已经写上的脚本抹掉。
      树里还有 package.json，说明建成了 Vite，整树换成空工作区。
    """
    wanted = office_workspace_files()
    current = store.get_revision(project.projectId, owner_id=owner_id)
    stored = store.read_files(project.projectId, current.revision, owner_id=owner_id)
    readme = stored.get("README.md") or ""
    orch_trace(
        "office-tree",
        template=current.templateVersion,
        storedBytes=len(readme.encode()),
        wantedBytes=len(WORKSPACE_README.encode()),
        files=sorted(stored),
    )
    vite = "package.json" in stored or "package-lock.json" in stored
    if (
        readme == WORKSPACE_README
        and current.templateVersion == WORKSPACE_TEMPLATE_VERSION
        and not vite
    ):
        return project
    files = dict(wanted) if vite else {**stored, "README.md": WORKSPACE_README}
    lease = store.acquire_lease(
        project.projectId, owner_id=owner_id,
        lease_owner="office-tree-" + uuid.uuid4().hex, ttl_seconds=120,
    )
    try:
        current = store.get_revision(project.projectId, owner_id=owner_id)
        store.commit_revision(
            project.projectId, owner_id=owner_id,
            expected_revision=current.revision, files=files,
            template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref=approval_ref,
            spec_revision=None if vite else current.specRevision,
            lease_generation=lease.generation, lease_owner=lease.leaseOwner,
        )
    finally:
        store.release_lease(
            project.projectId, owner_id=owner_id,
            lease_owner=lease.leaseOwner, generation=lease.generation,
        )
    project = store.get_project(project.projectId, owner_id=owner_id)
    current = store.get_revision(project.projectId, owner_id=owner_id)
    stored = store.read_files(project.projectId, current.revision, owner_id=owner_id)
    if stored.get("README.md") != WORKSPACE_README:
        raise ValueError("project_workspace_readme_mismatch")
    return project


def _source_for_create(state: V5SessionState, template_id: str) -> tuple[dict[str, str], str, str | None]:
    """批准计划决定电脑形状。模型传来的 react-vite* 对办公计划无效。"""
    if plan_deliverable_kind(latest_control_plan(state)) == OFFICE_FILE:
        files = office_workspace_files()
        orch_trace(
            "create-source",
            kind=OFFICE_FILE,
            template=WORKSPACE_TEMPLATE_VERSION,
            readmeBytes=len(files["README.md"].encode()),
        )
        return files, WORKSPACE_TEMPLATE_VERSION, None
    files, version = (
        load_project_template() if template_id == "react-vite"
        else load_project_template(template_id)
    )
    spec = TASK_ACCEPTANCE_PROFILE if template_id == "react-vite-tasks" else None
    return files, version, spec


def create_session_project(store: ProjectStore, session_id: str, *, owner_id: str,
                           approval_ref: str, template_id: str = "react-vite") -> Project:
    state = load_authorized_session(session_id, owner_id=owner_id, approval_ref=approval_ref)
    if not state.projectId and has_generated_application(state):
        raise ProjectConflict("project_conversion_required")
    existing = store.get_project_for_session(session_id, owner_id=owner_id)
    if state.projectId and (existing is None or state.projectId != existing.projectId):
        raise ProjectConflict("project_identity_changed")
    if existing is None:
        # ⚠ 2026-09-20 真机：办公计划仍建成 Vite（tasks 或最小 react-vite），
        #   messages 里堆 package.json，右栏按网页醒。类别是批准计划上的
        #   事实——host 覆盖 templateId，不猜用户那句话，不加办公专用工具。
        files, version, spec_revision = _source_for_create(state, template_id)
        existing = store.create_project(session_id, owner_id=owner_id, files=files,
            template_version=version, plan_ref=approval_ref,
            spec_revision=spec_revision)
    elif not state.projectId or state.projectId == existing.projectId:
        # ⚠ 2026-09-15 TicketStream：源码已经在（4 个 revision），会话
        #   runtimeKind 却掉回 html-prototype、projectId 空。只认
        #   `state.projectId == existing.projectId` 时，丢失指针 + 当前
        #   批准哈希对不上旧 planRef，会在 sync 里甩
        #   project_initial_plan_changed，电脑永远绑不回去。
        #   指针丢了仍是「这个会话自己的工程」，走同一条 adopt。
        #   创建当中计划被换成未批准的新稿，仍由下面的
        #   load_authorized_session 拒（见 test_plan_change_between_…）。
        # A fork deliberately starts without the original execution grant. Once
        # the new session approves its own plan, adopt the same source in a new
        # revision; never copy the parent's approval or reuse old evidence.
        current = store.get_revision(existing.projectId, owner_id=owner_id)
        if current.planRef != approval_ref:
            lease = store.acquire_lease(existing.projectId, owner_id=owner_id,
                lease_owner="adopt-plan-" + uuid.uuid4().hex, ttl_seconds=120)
            try:
                prior = operation_left_on_lease(store, lease, owner_id)
                if (lease.sandboxId or lease.processRefs) and not idle_office_exec_allows_source_write(lease, prior):
                    raise ProjectConflict("project_runtime_reconciliation_required")
                load_authorized_session(session_id, owner_id=owner_id, approval_ref=approval_ref)
                current = store.get_revision(existing.projectId, owner_id=owner_id)
                if current.planRef != approval_ref:
                    store.commit_revision(existing.projectId, owner_id=owner_id,
                        expected_revision=current.revision,
                        files=store.read_files(existing.projectId, current.revision, owner_id=owner_id),
                        template_version=current.templateVersion, plan_ref=approval_ref,
                        spec_revision=current.specRevision, lease_generation=lease.generation,
                        lease_owner=lease.leaseOwner)
            finally:
                store.release_lease(existing.projectId, owner_id=owner_id,
                    lease_owner=lease.leaseOwner, generation=lease.generation)
    if plan_deliverable_kind(latest_control_plan(state)) == OFFICE_FILE:
        existing = _ensure_office_tree(
            store, existing, owner_id=owner_id, approval_ref=approval_ref,
        )
    sync_session_project(store, session_id, owner_id=owner_id, approval_ref=approval_ref)
    return store.get_project(existing.projectId, owner_id=owner_id)
