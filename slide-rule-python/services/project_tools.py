"""Session-bound model tools over immutable sources and durable E2B operations.

Tool arguments cannot choose a project or owner. Even a server-side caller holding
an old approved state must re-read durable session authority before each write.
Source edits hold the same fencing lease as the worker, and never reuse a lease
whose sandbox or dispatch references still need reconciliation.
"""

from __future__ import annotations

import base64
import json
import time
import uuid
from types import SimpleNamespace

from pydantic import ValidationError

from services.persistence import PersistClosedError
from services.control_checkpoint import guard_control_run
from services.project_authority import approved_reference, verification_with_current_authority
from services.project_creation import create_session_project, load_authorized_session, sync_session_project
from services.project_manifest import (
    canonical_json, content_hash, file_content_matches, file_name_matches,
    file_tree_matches, kernel_str_replace_changes, kernel_write_changes,
    prepare_source_patch, source_path, workspace_file_path,
)
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from services.project_source_operations import ProjectSourceOperations
from services.project_browser_interact import local_playwright_available, run_browser_action
from services.project_tool_contracts import (
    BROWSER_INTERACT_TOOLS, FILE_READ_EXCERPT_CHARS, FILE_READ_EXCERPT_LINES,
    LEAKED_UNAVAILABLE, PROJECT_ARGUMENTS, PROJECT_KERNEL_WRITE_TOOLS,
    PROJECT_READ_MAX_RESULT_CHARS, PROJECT_WRITE_TOOLS, PatchArguments,
    classify_shell_command, compile_browser_action, explicit_read_window,
    leaked_browser_url_allowed,
    leaked_shell_exec_dir_allowed,
    SHELL_EXEC_FOREGROUND_BLOCK_SECONDS,
)
from services.deliverable_kind import (
    OFFICE_START_NOT_APPLICABLE, OFFICE_VERIFY_NOT_APPLICABLE,
    WORKSPACE_TEMPLATE_VERSION,
    idle_office_exec_allows_source_write,
    operation_left_on_lease,
    is_office_artifact_path, is_office_file_plan,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore, decode_office_write


def _skill_body_for_catalog_path(path: str, owner_id: str | None) -> str | None:
    """技能目录标签读不到工程文件时，交种子正文，不许变成 project_file_not_found。"""
    from services.control_skills import catalog_skill_slug
    from services.skill_catalog_store import installed_skill_infos, local_seed_skill_info

    slug = catalog_skill_slug(path)
    if not slug:
        return None
    if owner_id:
        try:
            for info in installed_skill_infos(owner_id):
                if getattr(info, "name", None) == slug and getattr(info, "body", None):
                    return info.body
        except Exception:
            pass
    seeded = local_seed_skill_info(slug)
    if seeded is not None and getattr(seeded, "body", None):
        return seeded.body
    return None
from services.scope_authority import latest_control_plan, plan_execution_authorized
from services.project_rollout import rollout_readiness
from services.project_acceptance import approved_acceptance_requirements

MAX_RESULT_CHARS = 3800

_TERMINAL = {"completed", "failed", "cancelled"}


def _size(value):
    return len(json.dumps(value, ensure_ascii=False))


def _bounded_text(value, key, text, cap=None):
    """Account for JSON escaping so the outer control result cap never cuts a cursor."""
    cap = MAX_RESULT_CHARS if cap is None else cap
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if _size({**value, key: text[:middle]}) <= cap:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def _bounded_log_text(result, item, text):
    low, high = 0, min(len(text), 2000)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = {**result, "logs": result["logs"] + [{**item, "text": text[:middle]}]}
        if _size(candidate) <= MAX_RESULT_CHARS:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def operation_snapshot(snapshot):
    operation = snapshot["operation"]
    result = {"operationId": operation.operationId, "kind": operation.kind,
        "status": operation.status, "revision": operation.expectedRevision,
        "cancelRequested": operation.cancelRequested, "lastSeq": snapshot["lastSeq"]}
    runtime = snapshot.get("runtime")
    expired_lease = False
    if runtime is not None:
        active = operation.status not in _TERMINAL
        expired_lease = active and (snapshot.get("leaseExpiresAt") or 0) <= time.time()
        result["runtime"] = {"status": "reconciling" if expired_lease else runtime.status,
            "revision": runtime.revision, "health": "unknown" if expired_lease else runtime.health,
            "errorCode": "workspace_lease_expired" if expired_lease else runtime.errorCode,
            "expiresAt": runtime.expiresAt}
    # Only command outcomes are model-visible. Provider handles and the worker's
    # recovery/result payload remain private even when new fields are added.
    saved = operation.result or {}
    # 抄 grok：接单成功 ≠ 命令跑完。queued / running 没有 exitCode，
    # 模型不许把 ok:true 说成「已经 build 过」。runtime.start 以 ready 为准
    # （服务中的沙盒不会进 completed，等它死就是 2026-09-16 那次钉目标）。
    serving = (
        operation.kind == "runtime.start"
        and runtime is not None
        and not expired_lease
        and runtime.status == "ready"
    )
    result["commandFinished"] = operation.status in _TERMINAL or serving
    for name in ("command", "exitCode", "errorCode"):
        if name in saved and isinstance(saved[name], (str, int, type(None))):
            result[name] = saved[name][:240] if isinstance(saved[name], str) else saved[name]
    if isinstance(saved.get("gate"), str) and saved["gate"]:
        result["gate"] = saved["gate"][:300]
    files = saved.get("officeFiles")
    if isinstance(files, list) and files:
        result["officeFiles"] = [str(item)[:240] for item in files[:8] if isinstance(item, str)]
    if operation.kind == "runtime.patch":
        for name in ("revision", "parentRevision", "runtimeOperationId", "synchronized", "sourcePublished"):
            if name in saved and isinstance(saved[name], (str, bool)):
                result[name] = saved[name]
        result["verification"] = "not_run"
    elif operation.kind == "runtime.verify":
        requirements = operation.input.get("acceptanceRequirements") if isinstance(operation.input, dict) else None
        result["acceptanceRequirements"] = list(requirements or [])
    return result


def _pointer_file(path, text, revision):
    """无窗读：路径 + 文件头，不把全文灌进 messages。"""
    lines = text.splitlines(keepends=True)
    excerpt = "".join(lines[:FILE_READ_EXCERPT_LINES])
    if len(excerpt) > FILE_READ_EXCERPT_CHARS:
        excerpt = excerpt[:FILE_READ_EXCERPT_CHARS]
    return {
        "revision": revision.revision,
        "path": path,
        "sha256": content_hash(text),
        "totalChars": len(text),
        "lineCount": len(lines),
        "excerpt": excerpt,
        "content": "",
        "nextOffset": 0,
        "truncated": len(text) > 0,
        "hint": (
            "这是路径和摘要，不是全文。"
            "要原文带 offset/limit 或 start_line/end_line；搜内容用 file_find_in_content。"
        ),
    }


def _command_log_excerpt(store, operation_id, owner_id) -> str:
    """操作日志末尾。bash 写出的文本不进源码树，file_read 找不到。"""
    op_id = str(operation_id or "").strip()
    if not op_id or store is None:
        return ""
    events = store.list_events(op_id, owner_id=owner_id, after_seq=0, limit=100)
    parts: list[str] = []
    for event in events:
        payload = event.payload if getattr(event, "payload", None) else {}
        if not isinstance(payload, dict):
            continue
        if event.type == "runtime.log":
            parts.append(str(payload.get("text") or ""))
        elif event.type == "runtime.console":
            parts.append(str(payload.get("data") or payload.get("text") or ""))
    text = "".join(parts)
    if len(text) > FILE_READ_EXCERPT_CHARS:
        return text[-FILE_READ_EXCERPT_CHARS:]
    return text


def _command_pointer(result, excerpt=""):
    """bash / shell_exec：exit + operationId + 日志尾。完整 stdout 留在操作日志。

    ⚠ 2026-09-20 真机：excerpt 写成 errorCode，模型只看见
      project_command_failed，去 file_read run.log 又是 project_file_not_found。
      摘要必须是日志尾，再取带同一个 operationId。
    """
    if not isinstance(result, dict):
        return result
    hint = "完整输出在操作日志，用 project_logs 或 shell_view 带 operationId 再取。"
    # ⚠ 2026-09-22 BABCJGGB44：回执没有文件路径，模型把 pptx base64 进日志。
    #   收回的路径必须写在模型看得见的这句话里，不能只藏在字段名里。
    files = result.get("officeFiles")
    if isinstance(files, list) and files:
        named = ", ".join(str(item) for item in files[:8])
        hint = (
            f"办公文件已收回：{named}。"
            "这就是交付，不要再把文件 base64 进日志或 file_write。"
            "同一个沙盒留给下一条命令，已安装的包还在。"
            + hint
        )
    out = {
        **result,
        "excerpt": str(excerpt or "")[:FILE_READ_EXCERPT_CHARS],
        "hint": hint,
    }
    out.pop("stdout", None)
    out.pop("stderr", None)
    out.pop("logPath", None)
    return out


def command_receipt_from(adapter, operation_id):
    """终态回执 = 快照 + 日志尾。分发处等完不许拿裸 snapshot 盖掉 excerpt。

    ⚠ 2026-09-21 sr-20260921170121-13ME64TF8Z：enqueue 时 wait=False，
      excerpt 还是空的；等命令进终态后 `_dispatch_tool` 用 `_snapshot`
      覆盖 body，模型只看见 project_command_failed。PTY 字节在
      runtime.console 里，file_read 源码树找不到。
    """
    snapper = getattr(adapter, "_snapshot", None)
    if not callable(snapper):
        return {"operationId": operation_id}
    snap = snapper(operation_id)
    store = getattr(adapter, "store", None)
    owner = getattr(adapter, "owner_id", None)
    return _command_pointer(
        snap,
        _command_log_excerpt(store, operation_id, owner),
    )


def _wait_backoff(elapsed: float) -> float:
    """等待循环每次重查之间睡多久。

    ⚠ 2026-09-16：原来两个循环都写死 `time.sleep(min(0.1, ...))`。把等待上界
      从 5 秒提到 30 秒之后，那就是**向远程 HTTPS SQL 网关打 300 次查询**去等
      一条 build——把模型往返税换成了数据库风暴，不是省。

      前 2 秒仍然密（刚提交的活经常瞬间就完，密查能立刻返回），之后拉开：
      30 秒总共约 35 次查询，而不是 300 次。

    ⚠ 调用点现在有三处（project_status.waitSeconds、shell_wait.seconds、
      shell_exec/bash 前台）。共用 `_poll_operation` → 共用这一份退避。
      只改一个循环 = 一半还在打风暴，而且不报错（CLAUDE.md §4）。
    """
    if elapsed < 2:
        return 0.1
    if elapsed < 8:
        return 0.5
    return 1.0


class ProjectTools:
    def __init__(self, store, supervisor, owner_id):
        self.store, self.supervisor, self.owner_id = store, supervisor, owner_id

    def capability_readiness(self) -> dict:
        """Return local capability facts for planning, without touching a provider.

        The planner runs before a project exists, so ``project_status`` cannot
        report why a preview or browser check would be blocked.  Keep this
        deliberately side-effect free: it reads configuration and the bundled
        runner only; it never creates an E2B sandbox or exposes credentials.
        """
        rollout = rollout_readiness()
        blockers = list(rollout.get("blockers") or [])
        preview_checker = getattr(self.supervisor, "preview_configuration_enabled", None)
        preview_ready = bool(preview_checker()) if callable(preview_checker) else False
        if not preview_ready and "project_preview_not_configured" not in blockers:
            blockers.append("project_preview_not_configured")
        browser_error = "project_browser_not_configured"
        factory = getattr(self.supervisor, "browser_provider_factory", None) if self.supervisor is not None else None
        if factory is not None:
            try:
                # The provider's availability_error is a pure local check; the
                # factory constructor must not create or connect to a sandbox.
                browser_error = factory().availability_error()
            except (ValueError, TypeError, OSError, ImportError):
                browser_error = "project_browser_unavailable"
        browser_ready = browser_error is None
        if not browser_ready:
            blockers.append(browser_error)
        # Stable, model-safe facts only; never include URLs, keys or provider handles.
        return {"rolloutConfigured": bool(rollout.get("configured")),
                "previewConfigured": preview_ready, "browserConfigured": browser_ready,
                "blockers": list(dict.fromkeys(blockers))}

    def execute(self, name, args, state, *, wait: bool = True) -> dict:
        guard_control_run()
        try:
            if name not in PROJECT_ARGUMENTS:
                raise ValueError("unknown_project_tool")
            if not isinstance(args, dict):
                raise ValueError("project_tool_arguments_invalid")
            parsed = PROJECT_ARGUMENTS[name].model_validate(args)
            session_id = str(getattr(state, "sessionId", "") or "")
            # 核写工具不让模型填 approvalRef：会话里已批准的计划就是闸。
            # 旧的 project_patch 仍要模型回传引用，合同不能改一半。
            if name in PROJECT_KERNEL_WRITE_TOOLS:
                authority = load_authorized_session(session_id, owner_id=self.owner_id)
                if not plan_execution_authorized(authority):
                    raise PermissionError("project_plan_approval_required")
            else:
                authority = load_authorized_session(session_id, owner_id=self.owner_id,
                    approval_ref=parsed.approvalRef if name in PROJECT_WRITE_TOOLS else None)
            if name == "project_create":
                guard_control_run()
                project = create_session_project(self.store, session_id,
                    owner_id=self.owner_id, approval_ref=parsed.approvalRef, template_id=parsed.templateId)
                created = self._project_result(project)
                if created.get("templateVersion") == WORKSPACE_TEMPLATE_VERSION:
                    tree = self.store.read_files(project.projectId, owner_id=self.owner_id)
                    readme = tree.get("README.md") or ""
                    created["readmeBytes"] = len(readme.encode())
                    created["readmeSha"] = content_hash(readme)[:16]
                return {"ok": True, **created}
            project = self.store.get_project_for_session(session_id, owner_id=self.owner_id)
            if (project is None or project.sessionId != authority.sessionId
                    or authority.projectId != project.projectId or authority.runtimeKind != "project"):
                raise ProjectNotFound("session_project_not_found")
            # Runtime tools derive identity from the project index. Session fields
            # are a presentation projection and can lag a successful revision CAS.
            if name == "project_status" and parsed.operationId is None:
                result = self._project_result(project)
                if plan_execution_authorized(authority):
                    result["approvalRef"] = approved_reference(authority)
                operations = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                    after_id=parsed.operationCursor, limit=9)
                result["operations"] = [{"operationId": op.operationId, "kind": op.kind,
                    "status": op.status, "revision": op.expectedRevision} for op in operations[:8]]
                result["hasMoreOperations"] = len(operations) > 8
                result["nextOperationCursor"] = operations[7].operationId if len(operations) > 8 else None
                lease = self.store.get_lease(project.projectId, owner_id=self.owner_id)
                result["activeOperationId"] = lease.processRefs.get("operationId") if lease else None
                return {"ok": True, **result}
            if name == "project_patch":
                return {"ok": True, **self._patch(project, parsed)}
            if name in LEAKED_UNAVAILABLE:
                if getattr(parsed, "sudo", False):
                    raise ValueError("project_sudo_forbidden")
                raise ValueError(LEAKED_UNAVAILABLE[name])
            if name in BROWSER_INTERACT_TOOLS:
                result = self._browser_interact(project, name, parsed)
                self._keep_preview_snapshot(project, result, source="browser_interact")
                return {"ok": True, **result}
            if name == "shell_write_to_process":
                return {"ok": True, **self._shell_stdin(project, parsed)}
            if name in {"shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
                        "browser_navigate", "browser_restart"}:
                return {"ok": True, **self._kernel_runtime(
                    project, name, parsed, authority, wait=wait)}
            if name in {"shell_view", "shell_wait", "shell_kill_process", "browser_view",
                        "browser_console_view", "make_manus_page"}:
                result = self._leaked_observe(project, name, parsed)
                if name == "browser_view":
                    self._keep_preview_snapshot(project, result, source="browser_view")
                return {"ok": True, **result}
            if name in PROJECT_KERNEL_WRITE_TOOLS:
                return {"ok": True, **self._kernel_edit(project, name, parsed, authority)}
            if name == "project_revisions":
                return {"ok": True, **ProjectSourceOperations(self.store, self.supervisor, self.owner_id).revisions(
                    project.projectId, parsed.cursor, parsed.limit)}
            if name == "project_restore":
                return {"ok": True, **ProjectSourceOperations(self.store, self.supervisor, self.owner_id).restore(
                    project.projectId, expected_revision=parsed.expectedRevision,
                    target_revision=parsed.targetRevision, idempotency_key=parsed.idempotencyKey,
                    approval_ref=parsed.approvalRef)}
            if name == "project_export":
                revision = self.store.get_revision(project.projectId, parsed.revision, owner_id=self.owner_id)
                return {"ok": True, "revision": revision.revision, "treeHash": revision.treeHash,
                    "downloadPath": f"/api/sliderule/projects/{project.projectId}/export?revision={revision.revision}",
                    "businessDataIncluded": False, "deployed": False}
            if name == "project_verify":
                if is_office_file_plan(latest_control_plan(authority)):
                    raise ValueError(OFFICE_VERIFY_NOT_APPLICABLE)
                guard_control_run()
                if self.supervisor is None:
                    raise ProjectStoreUnavailable("project_worker_unavailable")
                parent = self.store.get_operation(parsed.runtimeOperationId, owner_id=self.owner_id)
                if parent.projectId != project.projectId or parent.sessionId != session_id:
                    raise ProjectNotFound("project_operation_not_found")
                operation = self.supervisor.submit_verification(parent.operationId, owner_id=self.owner_id,
                    expected_revision=parsed.expectedRevision, approval_ref=parsed.approvalRef,
                    idempotency_key=parsed.idempotencyKey,
                    acceptance_requirements=approved_acceptance_requirements(authority))
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"project_start", "project_exec"}:
                if name == "project_start" and is_office_file_plan(latest_control_plan(authority)):
                    raise ValueError(OFFICE_START_NOT_APPLICABLE)
                guard_control_run()
                if self.supervisor is None:
                    raise ProjectStoreUnavailable("project_worker_unavailable")
                if name == "project_exec" and project.currentRevision != parsed.expectedRevision:
                    raise ProjectConflict("project_revision_conflict")
                params = dict(owner_id=self.owner_id, expected_revision=parsed.expectedRevision,
                    approval_ref=parsed.approvalRef, idempotency_key=parsed.idempotencyKey)
                if name == "project_start":
                    operation = self.supervisor.submit(project.projectId, **params, port=parsed.port)
                else:
                    operation = self.supervisor.submit_command(project.projectId, **params, command=parsed.command)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"project_status", "project_logs", "project_cancel", "project_verification"}:
                operation = self.store.get_operation(parsed.operationId, owner_id=self.owner_id)
                if operation.projectId != project.projectId or operation.sessionId != session_id:
                    raise ProjectNotFound("project_operation_not_found")
                if name == "project_verification" and operation.kind != "runtime.verify":
                    raise ProjectNotFound("project_verification_not_found")
                if name == "project_status" and parsed.waitSeconds:
                    operation = self._poll_operation(operation, parsed.waitSeconds)
                if name == "project_logs":
                    return {"ok": True, **self._logs(operation, parsed)}
                if name == "project_cancel":
                    if self.supervisor is None:
                        self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
                    else:
                        self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"file_read", "read_file", "file_find_in_content", "file_find_by_name",
                        "grep", "glob", "list_dir"}:
                revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
                files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
                if name in {"file_read", "read_file"}:
                    return {"ok": True, **self._file_read(files, revision, parsed, project)}
                if name == "file_find_in_content":
                    return {"ok": True, **self._file_find_in_content(files, revision, parsed)}
                if name == "grep":
                    return {"ok": True, **self._github_grep(files, revision, parsed)}
                if name == "list_dir":
                    return {"ok": True, **self._github_list_dir(files, revision, parsed)}
                if name == "glob":
                    return {"ok": True, **self._github_glob(files, revision, parsed, project)}
                return {"ok": True, **self._file_find_by_name(files, revision, parsed, project)}
            revision = self.store.get_revision(project.projectId, parsed.revision, owner_id=self.owner_id)
            if name == "project_list":
                return {"ok": True, **self._list(revision, parsed)}
            files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
            if name == "project_read":
                return {"ok": True, **self._read(files, revision, parsed)}
            return {"ok": True, **self._search(files, revision, parsed)}
        except ValidationError:
            return {"ok": False, "error": "project_tool_arguments_invalid"}
        except PersistClosedError as exc:
            return {"ok": False, "error": str(exc.reason)[:240]}
        except (ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, PermissionError, ValueError) as exc:
            return {"ok": False, "error": str(exc)[:240]}

    def _project_result(self, project):
        revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        return {"projectId": project.projectId, "revision": revision.revision,
            "templateVersion": revision.templateVersion, "fileCount": len(revision.manifest.files),
            "sourceBytes": revision.manifest.totalBytes, "runtimeKind": "project"}

    def _keep_preview_snapshot(self, project, result, *, source: str) -> None:
        """Persist a browser PNG for the result card. Fail-open. Not verification."""
        data = result.pop("screenshotPng", None)
        raw = result.pop("screenshot", None)
        if data is None and isinstance(raw, str) and raw.strip():
            try:
                data = base64.b64decode(raw)
            except Exception:
                data = None
        elif data is None and isinstance(raw, (bytes, bytearray)):
            data = bytes(raw)
        if not isinstance(data, (bytes, bytearray)) or not data:
            return
        try:
            self.store.put_preview_snapshot(
                project.projectId,
                owner_id=self.owner_id,
                png=bytes(data),
                revision=str(result.get("revision") or getattr(project, "currentRevision", "") or ""),
                source=source,
            )
            result["previewSnapshot"] = True
        except Exception:
            # 缩略图是增强项：落库失败不许拖垮 browser_view。
            pass

    def _snapshot(self, operation_id):
        source = self.store.snapshot_operation(operation_id, owner_id=self.owner_id)
        result = operation_snapshot(source)
        if source["operation"].kind == "runtime.verify" and self.supervisor is not None:
            authority = load_authorized_session(source["operation"].sessionId,
                owner_id=self.owner_id, approval_ref=None)
            snapshot = verification_with_current_authority(self.supervisor.verification_store.for_operation(
                operation_id, owner_id=self.owner_id), authority)
            if snapshot is not None:
                record = snapshot.verification
                result["verification"] = {"verificationId": record.verificationId,
                    "status": snapshot.effectiveStatus, "revision": record.revision,
                    "suiteVersion": record.suiteVersion, "deliveryEligible": snapshot.deliveryEligible,
                    "acceptanceProfile": record.specRevision if snapshot.deliveryEligible else None,
                    "acceptanceRequirements": list(record.acceptanceRequirements),
                    "errorCode": record.errorCode,
                    "runtimeOperationId": record.runtimeOperationId,
                    "logOperationId": record.runtimeOperationId,
                    "build": ({key: getattr(record.build, key) for key in (
                        "status", "installExitCode", "buildExitCode", "outputHash", "revision")}
                        if record.build else None),
                    "assertions": [{"id": item.id, "status": item.status,
                        **({"expected": item.expected, "actual": item.actual}
                            if item.status == "failed" and item.expected is not None and item.actual is not None else {})}
                        for item in record.assertions],
                    "artifactIds": [item.artifactId for item in record.artifactRefs]}
        return result

    def _poll_operation(self, operation, seconds):
        """等到操作释放，或秒数用尽。秒数 <= 0 立刻把当前快照交回去。

        ⚠ 2026-09-18：shell_exec 前台抄 grok bash `backend.run()`——这次工具
          调用要堵住，直到命令进终态。project_status / shell_wait 原来各写
          一份 while；再给 shell_exec 抄第三份就会漂（CLAUDE.md §4）。
          提前返回（终态 / runtime.ready）必须留在这一处。
        """
        if seconds is None or seconds <= 0 or operation is None:
            return operation
        deadline = time.monotonic() + float(seconds)
        started = time.monotonic()
        while operation.status not in _TERMINAL and time.monotonic() < deadline:
            if operation.runtime is not None and getattr(operation.runtime, "status", None) == "ready":
                break
            time.sleep(min(_wait_backoff(time.monotonic() - started),
                           max(0, deadline - time.monotonic())))
            operation = self.store.get_operation(operation.operationId, owner_id=self.owner_id)
        return operation

    def _latest_operation(self, project, kinds=None):
        operations = self.store.list_project_operations(
            project.projectId, owner_id=self.owner_id, limit=100)
        if kinds:
            operations = [item for item in operations if item.kind in kinds]
        return operations[-1] if operations else None

    def _operation_by_id(self, project, session_id, operation_id, kinds=None):
        if operation_id:
            operation = self.store.get_operation(operation_id, owner_id=self.owner_id)
        else:
            operation = self._latest_operation(project, kinds=kinds)
            if operation is None:
                raise ProjectNotFound("project_operation_not_found")
        if operation.projectId != project.projectId or operation.sessionId != session_id:
            raise ProjectNotFound("project_operation_not_found")
        return operation

    def _kernel_runtime(self, project, name, parsed, authority, *, wait=True):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        if self.supervisor is None:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        params = dict(
            owner_id=self.owner_id,
            expected_revision=current.revision,
            approval_ref=approved_reference(authority),
            idempotency_key=getattr(parsed, "id", None) or str(uuid.uuid4()),
        )
        if name in {"shell_exec", "bash"}:
            if name == "shell_exec" and not leaked_shell_exec_dir_allowed(getattr(parsed, "exec_dir", None)):
                raise ValueError("project_shell_exec_dir_not_supported")
            if name == "bash":
                params["idempotency_key"] = str(uuid.uuid4())
            managed, script = classify_shell_command(parsed.command)
            if script is None:
                operation = self.supervisor.submit_command(
                    project.projectId, **params, command=managed)
            else:
                operation = self.supervisor.submit_command(
                    project.projectId, **params, command="shell", script=script)
            operation = self.store.get_operation(operation.operationId, owner_id=self.owner_id)
            # wait=False：分发处先把 operationId 推给界面订 PTY，再自己堵。
            # 这里再等，id 要等命令结束才出去，终端进行中是白纸。
            if wait and not getattr(parsed, "is_background", False):
                block = getattr(parsed, "timeout", None)
                if block is None:
                    block = SHELL_EXEC_FOREGROUND_BLOCK_SECONDS
                operation = self._poll_operation(operation, block)
            return command_receipt_from(self, operation.operationId)
        if name in {"deploy_expose_port", "deploy_apply_deployment"}:
            port = getattr(parsed, "port", None) or 5173
            operation = self.supervisor.submit(project.projectId, **params, port=port)
            result = self._snapshot(operation.operationId)
            if name == "deploy_apply_deployment":
                result["deployed"] = False
                result["public"] = False
                result["previewPrivate"] = True
            return result
        if name == "browser_navigate":
            if not leaked_browser_url_allowed(parsed.url):
                raise ValueError("project_browser_external_url_forbidden")
            operation = self.supervisor.submit(project.projectId, **params, port=5173)
            return {**self._snapshot(operation.operationId), "url": parsed.url, "previewPrivate": True}
        # browser_restart: cancel latest runtime, then start again.
        latest = self._latest_operation(project, kinds=("runtime.start", "runtime.exec", "runtime.verify"))
        if latest is not None:
            self.supervisor.cancel(latest.operationId, owner_id=self.owner_id)
        operation = self.supervisor.submit(project.projectId, **params, port=5173)
        return self._snapshot(operation.operationId)

    def _leaked_observe(self, project, name, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        session_id = project.sessionId
        if name == "make_manus_page":
            # ⚠ 2026-09-22 办公文件不在源码树。只查源码时，点名 pptx 得到
            #   project_file_not_found，右边却把失败的网页运行当成预览。
            result = self._project_result(project)
            if parsed.file:
                revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
                files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
                path = workspace_file_path(parsed.file, files)
                if path in files:
                    result["path"] = path
                    result["presented"] = "project"
                else:
                    meta = ProjectOfficeArtifactStore(self.store).find_by_path(
                        project.projectId, path, owner_id=self.owner_id)
                    if meta is None:
                        raise ProjectNotFound("project_file_not_found")
                    result["path"] = meta["path"]
                    result["artifactId"] = meta["artifactId"]
                    result["presented"] = "office"
            else:
                result["presented"] = "project"
            if parsed.title:
                result["title"] = parsed.title
            return result
        if name == "browser_view":
            result = self._project_result(project)
            latest = self._latest_operation(project)
            if latest is not None:
                result.update(self._snapshot(latest.operationId))
            page = self._preview_page(project)
            result["interactive"] = page is not None
            if page is not None:
                result["url"] = page["url"]
                interactor = getattr(self.supervisor, "browser_interactor", None)
                if callable(interactor):
                    observed = interactor({"op": "snapshot"}, page)
                    if isinstance(observed, dict):
                        result.update(observed)
                elif local_playwright_available():
                    result.update(run_browser_action(page["url"], {"op": "snapshot"}))
            return result
        operation = self._operation_by_id(project, session_id, parsed.id)
        if name == "shell_kill_process":
            if self.supervisor is None:
                self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
            else:
                self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
            return self._snapshot(operation.operationId)
        if name == "shell_wait":
            wait = parsed.seconds if parsed.seconds is not None else 2
            operation = self._poll_operation(operation, wait)
            return self._snapshot(operation.operationId)
        logs = self._logs(operation, SimpleNamespace(afterSeq=0, offset=0))
        if name == "browser_console_view":
            logs["console"] = "runtime"
        return logs

    def _preview_page(self, project):
        resolver = getattr(self.supervisor, "preview_page", None)
        if callable(resolver):
            page = resolver(project)
            if isinstance(page, dict) and isinstance(page.get("url"), str) and page["url"].strip():
                if not leaked_browser_url_allowed(page["url"]):
                    raise ValueError("project_browser_external_url_forbidden")
                return page
            return None
        latest = self._latest_operation(project, kinds=("runtime.start",))
        runtime = latest.runtime if latest is not None else None
        if latest is None or latest.status not in {"running", "completed"} or runtime is None:
            return None
        if getattr(runtime, "status", None) != "ready":
            return None
        url = getattr(runtime, "previewUrl", None)
        if not isinstance(url, str) or not leaked_browser_url_allowed(url):
            return None
        return {"url": url, "revision": getattr(runtime, "revision", None)}

    def _browser_interact(self, project, name, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        action = compile_browser_action(name, parsed)
        page = self._preview_page(project)
        if page is None:
            raise ValueError("project_browser_preview_not_ready")
        interactor = getattr(self.supervisor, "browser_interactor", None)
        if callable(interactor):
            observed = interactor(action, page)
            if not isinstance(observed, dict):
                raise ValueError("project_browser_action_failed")
            return {"interactive": True, **observed}
        if local_playwright_available():
            return run_browser_action(page["url"], action)
        raise ValueError("project_browser_driver_unavailable")

    def _shell_stdin(self, project, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        if self.supervisor is None:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        operation = self._operation_by_id(project, project.sessionId, parsed.id)
        self.supervisor.enqueue_stdin(
            operation.operationId, owner_id=self.owner_id, text=parsed.input,
            press_enter=parsed.press_enter)
        return {"operationId": operation.operationId, "stdinQueued": True}

    def _kernel_edit(self, project, name, parsed, authority):
        """把 path+content / 唯一串替换展开成现行 patch，再走同一条落库。

        版本和哈希从当前 revision 读，不信模型。删掉这一支、只加 schema，
        模型会看见工具，写进去的字节却不会落库。
        """
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        files = self.store.read_files(project.projectId, current.revision, owner_id=self.owner_id)
        if name in {"file_write", "project_write", "write_file"}:
            path = workspace_file_path(getattr(parsed, "file", None) or parsed.path, files)
            if is_office_artifact_path(path):
                data = decode_office_write(
                    parsed.content,
                    encoding=getattr(parsed, "contentEncoding", None),
                )
                meta = ProjectOfficeArtifactStore(self.store).put(
                    project.projectId, owner_id=self.owner_id, path=path, data=data)
                return {
                    "projectId": project.projectId,
                    "revision": current.revision,
                    "path": meta["path"],
                    "sha256": meta["sha256"],
                    "sizeBytes": meta["sizeBytes"],
                    "downloadable": True,
                    "artifactId": meta["artifactId"],
                    "changedFiles": [meta["path"]],
                }
            content = parsed.content
            if getattr(parsed, "leading_newline", False):
                content = "\n" + content
            if getattr(parsed, "trailing_newline", False) and not content.endswith("\n"):
                content += "\n"
            changes = kernel_write_changes(files, path, content, append=getattr(parsed, "append", False))
        else:
            path = workspace_file_path(getattr(parsed, "file", None) or parsed.path, files)
            old = getattr(parsed, "old_str", None) or getattr(parsed, "old_string", None) or parsed.oldStr
            if hasattr(parsed, "new_str"):
                new = parsed.new_str
            elif hasattr(parsed, "new_string"):
                new = parsed.new_string
            else:
                new = parsed.newStr
            changes = kernel_str_replace_changes(files, path, old, new)
        return self._patch(project, PatchArguments.model_validate({
            "approvalRef": approved_reference(authority),
            "expectedRevision": current.revision,
            "changes": changes,
        }))

    def _patch(self, project, args):
        active = self.store.get_lease(project.projectId, owner_id=self.owner_id)
        if active is not None and active.expiresAt > time.time() and active.processRefs.get("operationId"):
            if self.supervisor is None:
                raise ProjectStoreUnavailable("project_worker_unavailable")
            # Queue to the existing execution owner. Never borrow its lease or
            # write into its sandbox from a control/HTTP request thread.
            changes = [change.model_dump() for change in args.changes]
            before = self.store.read_files(project.projectId, args.expectedRevision, owner_id=self.owner_id)
            prepare_source_patch(before, changes, live=True)
            parent_id = active.processRefs["operationId"]
            key = "live-patch-" + content_hash(canonical_json({"runtimeOperationId": parent_id, **args.model_dump()}))
            operation = self.supervisor.submit_patch(parent_id, owner_id=self.owner_id,
                expected_revision=args.expectedRevision, approval_ref=args.approvalRef,
                idempotency_key=key, changes=changes)
            return {"projectId": project.projectId, "runtimeOperationId": parent_id,
                **self._snapshot(operation.operationId)}
        lease = self.store.acquire_lease(project.projectId, owner_id=self.owner_id,
            lease_owner="patch-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            prior = operation_left_on_lease(self.store, lease, self.owner_id)
            if (lease.sandboxId or lease.processRefs) and not idle_office_exec_allows_source_write(lease, prior):
                raise ProjectConflict("project_runtime_reconciliation_required")
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
            if current.revision != args.expectedRevision:
                raise ProjectConflict("project_revision_conflict")
            files = self.store.read_files(project.projectId, current.revision, owner_id=self.owner_id)
            updated, changed_paths = prepare_source_patch(files, [change.model_dump() for change in args.changes])
            if updated == files and current.planRef == args.approvalRef:
                sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
                return {"projectId": project.projectId, "revision": current.revision, "changedFiles": []}
            # Check again after bounded source reads; no cached approval can be
            # carried through an arbitrarily slow storage call into publication.
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            guard_control_run()
            revision = self.store.commit_revision(project.projectId, owner_id=self.owner_id,
                expected_revision=current.revision, files=updated, template_version=current.templateVersion,
                plan_ref=args.approvalRef, spec_revision=current.specRevision,
                lease_generation=lease.generation, lease_owner=lease.leaseOwner)
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            result = {"projectId": project.projectId, "revision": revision.revision,
                "parentRevision": current.revision, "changedFileCount": len(changed_paths),
                "changedFiles": [], "truncated": False, "verification": "not_run"}
            for path in changed_paths:
                if _size({**result, "changedFiles": result["changedFiles"] + [path]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    break
                result["changedFiles"].append(path)
            return result
        finally:
            self.store.release_lease(project.projectId, owner_id=self.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)

    def _list(self, revision, args):
        entries = revision.manifest.files
        if args.cursor > len(entries):
            raise ValueError("invalid_project_cursor")
        result = {"revision": revision.revision, "files": [], "nextCursor": args.cursor, "truncated": True}
        for entry in entries[args.cursor:args.cursor + args.limit]:
            item = entry.model_dump()
            if _size({**result, "files": result["files"] + [item]}) > MAX_RESULT_CHARS:
                break
            result["files"].append(item)
            result["nextCursor"] += 1
        result["truncated"] = result["nextCursor"] < len(entries)
        return result

    def _file_read(self, files, revision, args, project=None):
        if getattr(args, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        path = workspace_file_path(getattr(args, "file", None) or args.path, files)
        if project is not None and is_office_artifact_path(path):
            meta = ProjectOfficeArtifactStore(self.store).find_by_path(
                project.projectId, path, owner_id=self.owner_id)
            if meta is None:
                raise ProjectNotFound("project_file_not_found")
            return {
                "revision": revision.revision, "path": meta["path"],
                "sha256": meta["sha256"], "sizeBytes": meta["sizeBytes"],
                "downloadable": True, "artifactId": meta["artifactId"],
                "content": "", "truncated": False,
            }
        skill_read = False
        if path not in files:
            # ⚠ 2026-09-22 BABCJGGB44：file_read .sliderule/skills/.../SKILL.md
            #   得到 project_file_not_found，模型接着 bash `find /`。
            skill_body = _skill_body_for_catalog_path(path, self.owner_id)
            if skill_body is None:
                raise ProjectNotFound("project_file_not_found")
            files = {**files, path: skill_body}
            skill_read = True
        if not explicit_read_window(args):
            pointer = _pointer_file(path, files[path], revision)
            if skill_read:
                pointer["hint"] = (
                    "这是技能正文的摘要，不是工程文件。"
                    "全文已经在 skill 回执里。不要在沙盒里 find .sliderule/skills。"
                )
            return pointer
        lines = files[path].splitlines(keepends=True)
        if getattr(args, "start_line", None) is not None:
            start = args.start_line
        else:
            start = getattr(args, "offset", None) or 0
        if getattr(args, "end_line", None) is not None:
            end = args.end_line
        elif getattr(args, "limit", None) is not None:
            end = start + args.limit
        else:
            end = len(lines)
        if start > len(lines) or end < start:
            raise ValueError("invalid_project_offset")
        text = "".join(lines[start:end])
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(files[path]),
            "start_line": start, "end_line": start + text.count("\n") + (0 if text.endswith("\n") or not text else 1),
            "truncated": False, "totalChars": len(files[path])}
        result["content"] = _bounded_text({"ok": True, **result}, "content", text,
            cap=PROJECT_READ_MAX_RESULT_CHARS)
        result["truncated"] = result["content"] != text
        return result

    def _file_find_in_content(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        path = workspace_file_path(args.file, files)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        matches = file_content_matches(files[path], args.regex)
        return {"revision": revision.revision, "path": path, "matches": matches,
            "truncated": len(matches) >= 40}

    def _github_grep(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        target = args.path or "."
        resolved = workspace_file_path(target, files) if target not in {".", ""} else ""
        if resolved in files:
            matches = [{"path": resolved, **row} for row in file_content_matches(files[resolved], args.pattern)]
        else:
            matches = file_tree_matches(files, args.pattern, directory=target, glob=args.glob or "*")
        return {"revision": revision.revision, "matches": matches, "truncated": len(matches) >= 40}

    def _github_list_dir(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        found = file_name_matches(sorted(files), args.path, "*")
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _github_glob(self, files, revision, args, project=None):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        names = self._names_with_artifacts(files, project)
        found = file_name_matches(names, args.path or ".", args.pattern)
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _file_find_by_name(self, files, revision, args, project=None):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        names = self._names_with_artifacts(files, project)
        found = file_name_matches(names, args.path, args.glob)
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _names_with_artifacts(self, files, project):
        names = list(files)
        if project is None:
            return sorted(names)
        try:
            extras = ProjectOfficeArtifactStore(self.store).list(
                project.projectId, owner_id=self.owner_id)
        except Exception:
            extras = []
        for item in extras:
            path = item.get("path")
            if isinstance(path, str) and path not in names:
                names.append(path)
        return sorted(names)

    def _read(self, files, revision, args):
        path = source_path(args.path)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        text = files[path]
        if not explicit_read_window(args):
            return _pointer_file(path, text, revision)
        if args.offset > len(text):
            raise ValueError("invalid_project_offset")
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(text),
            "offset": args.offset, "nextOffset": args.offset + args.limit, "truncated": True, "totalChars": len(text)}
        # ⚠ `ok` 是**调用方**加的（`return {"ok": True, **self._read(...)}`），
        #   但模型看到的是加完之后那一包。不把它算进来，夹出来的结果就必然
        #   比上限多 12 个字符——2026-09-14 放宽读窗时被
        #   test_literal_search_and_read_cursors_keep_exact_content_under_result_cap
        #   逮到：老判据留了 200 字的富余，正好盖住这笔账。
        result["content"] = _bounded_text({"ok": True, **result}, "content",
            text[args.offset:args.offset + args.limit], cap=PROJECT_READ_MAX_RESULT_CHARS)
        result["nextOffset"] = args.offset + len(result["content"])
        result["truncated"] = result["nextOffset"] < len(text)
        return result

    def _search(self, files, revision, args):
        query = args.query if args.caseSensitive else args.query.casefold()
        result = {"revision": revision.revision, "matches": [], "nextCursor": args.cursor, "truncated": False}
        index = 0
        for path, content in sorted(files.items()):
            sha = content_hash(content)
            for line, text in enumerate(content.splitlines(), 1):
                haystack = text if args.caseSensitive else text.casefold()
                if query not in haystack:
                    continue
                index += 1
                if index <= args.cursor:
                    continue
                item = {"path": path, "line": line, "sha256": sha, "text": text[:240], "excerptTruncated": len(text) > 240}
                if len(result["matches"]) >= args.limit or _size({**result, "matches": result["matches"] + [item]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    return result
                result["matches"].append(item)
                result["nextCursor"] = index
        if args.cursor > index:
            raise ValueError("invalid_project_cursor")
        return result

    def _logs(self, operation, args):
        events = self.store.list_events(operation.operationId, owner_id=self.owner_id,
            after_seq=args.afterSeq, limit=100)
        if args.offset and not events:
            raise ValueError("invalid_project_log_offset")
        result = {"operationId": operation.operationId, "logs": [], "nextSeq": args.afterSeq,
            "nextOffset": args.offset, "hasMore": False}
        for event in events:
            # PTY 走 runtime.console（data），文件日志走 runtime.log（text）。
            # ⚠ 2026-09-21 13ME64TF8Z：只认 runtime.log → bash 终态后
            #   project_logs 空，模型去 file_read 沙箱里 tee 的文件。
            if event.type in {"runtime.log", "runtime.console"}:
                payload = event.payload if isinstance(event.payload, dict) else {}
                text = str(payload.get("text") or payload.get("data") or "")
                offset = result["nextOffset"]
                if offset > len(text):
                    raise ValueError("invalid_project_log_offset")
                item = {"seq": event.seq, "offset": offset,
                    "providerTruncated": bool(payload.get("truncated"))}
                segment = _bounded_log_text(result, item, text[offset:])
                if text[offset:] and not segment:
                    result["hasMore"] = True
                    return result
                result["logs"].append({**item, "text": segment})
                if offset + len(segment) < len(text):
                    result["nextOffset"] = offset + len(segment)
                    result["hasMore"] = True
                    return result
            elif result["nextOffset"]:
                raise ValueError("invalid_project_log_offset")
            result["nextSeq"] = event.seq
            result["nextOffset"] = 0
        result["hasMore"] = len(events) == 100
        return result
