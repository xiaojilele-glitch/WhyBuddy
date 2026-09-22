# -*- coding: utf-8 -*-
"""办公文件不是任务清单（2026-09-20 真机 sr-20260920051924-QA0YXX59Q0）。

用户要做 PPT，自由 Agent 调了 project_create(react-vite-tasks)。
host 提示词把 tasks 写成正经应用，完工闸只认任务清单 eligible，
右栏 iframe 出现「登录任务清单」。

判据喂真机形状：已批准 office-file 计划 + project_create(react-vite-tasks)。
不许手搓 forcedTool。删闸或把办公目标仍指向 delivery.eligible，必须红。
"""

from __future__ import annotations

import ast
import asyncio
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_approved_session,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence, rehearsal_control as control
from services.control_run_service import ControlRunService
from services.deliverable_kind import (
    OFFICE_FILE,
    WEB_APP,
    WORKSPACE_README,
    WORKSPACE_TEMPLATE_VERSION,
    WRONG_ARTIFACT,
    is_office_file_plan,
    normalize_deliverable_kind,
    office_file_uses_task_delivery,
    office_workspace_files,
    plan_deliverable_kind,
    reject_tasks_template,
    skip_vite_dependency_install,
)
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_store import ProjectStore
from services.control_skills import SkillInfo
from services.scope_authority import latest_control_plan
from services.slide_rule_session import load_session


ROOT = Path(__file__).resolve().parents[1]
CONTROL_SRC = ROOT / "services" / "rehearsal_control.py"
CREATE_SRC = ROOT / "services" / "project_creation.py"
GOAL_SRC = ROOT / "services" / "control_run_service.py"
WORKER_SRC = ROOT / "services" / "project_runtime_worker.py"
PPT_PLAN = (
    "用 office-skills 做一份办公启动 PPT，产出 office-skills-launch.pptx。"
)


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


def test_leaf_defaults_unknown_to_web_app():
    assert normalize_deliverable_kind(None) == WEB_APP
    assert normalize_deliverable_kind("") == WEB_APP
    assert normalize_deliverable_kind("pptx") == WEB_APP
    assert plan_deliverable_kind({}) == WEB_APP
    assert plan_deliverable_kind({"deliverableKind": OFFICE_FILE}) == OFFICE_FILE
    assert is_office_file_plan({"deliverableKind": OFFICE_FILE})
    assert reject_tasks_template(OFFICE_FILE, "react-vite-tasks") == WRONG_ARTIFACT
    assert reject_tasks_template(WEB_APP, "react-vite-tasks") is None
    assert reject_tasks_template(OFFICE_FILE, "react-vite") is None
    files = office_workspace_files()
    assert files == {"README.md": WORKSPACE_README}
    assert "package.json" not in files
    assert "先 pip" not in WORKSPACE_README
    assert "必须先调" not in WORKSPACE_README
    assert "project_logs" in WORKSPACE_README
    assert "一行" in WORKSPACE_README
    assert office_file_uses_task_delivery(OFFICE_FILE)
    assert not office_file_uses_task_delivery(WEB_APP)
    assert skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version=WORKSPACE_TEMPLATE_VERSION,
        files=files,
    )
    assert not skip_vite_dependency_install(
        operation_kind="runtime.start",
        template_version=WORKSPACE_TEMPLATE_VERSION,
        files=files,
    )
    assert not skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version="whybuddy-react-vite-1",
        files={"package.json": "{}"},
    )
    assert not skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version=WORKSPACE_TEMPLATE_VERSION,
        files={**files, "package-lock.json": "{}"},
    )
    # ⚠ 13ME64TF8Z：revision 不是 workspace-1，树却是办公文件。
    assert skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version="whybuddy-react-vite-1",
        files={"README.md": WORKSPACE_README,
               "scripts/generate_kickoff_pptx.py": "print(1)\n"},
    )
    assert skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version=None,
        files={"README.md": WORKSPACE_README},
    )
    # ⚠ XSGAMK9PYZ：template 是 workspace-1，files 形状哪怕古怪也要 skip。
    assert skip_vite_dependency_install(
        operation_kind="runtime.exec",
        template_version=WORKSPACE_TEMPLATE_VERSION,
        files=None,
    )


def test_write_plan_persists_office_file_kind(monkeypatch):
    """真机形状：做 PPT 的 write_plan 把 deliverableKind 落进 plan_written。"""
    harness = ControlHarness(monkeypatch)
    sid = new_sid("office-plan")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})
    harness.llm_impl = lambda *a, **kw: llm_tool(
        "write_plan",
        {"planContent": PPT_PLAN, "deliverableKind": OFFICE_FILE},
    )
    harness.post(six_fields(sid, "做个PPT @office-skills"))
    plan = latest_control_plan(load_session(sid))
    assert plan["planContent"] == PPT_PLAN
    assert plan["deliverableKind"] == OFFICE_FILE


def test_write_plan_omitted_kind_survives_get_as_office_file(monkeypatch):
    """真机六字段 + @office-skills + 省略 kind → GET / complete 必须带键。

    ⚠ 2026-09-20 sr-20260920102543-OFFICE / sr-20260920105329-PPT：
      write_plan 源码写了 deliverableKind，complete/GET 快照没有。
      现有单测只 load_session，没钉 GET。不 monkeypatch 点名函数——
      活路径是信封里的 @slug。GET 行没有该键必须红。
    """
    from control_turn_support import KEY, client

    harness = ControlHarness(monkeypatch)
    sid = new_sid("office-get")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})

    def model(*_a, **_kw):
        if not harness.llm_calls or len(harness.llm_calls) <= 1:
            return llm_tool("write_plan", {"planContent": PPT_PLAN})
        return llm_text("计划已写好，请批准。")

    harness.llm_impl = model
    _, events = harness.post(six_fields(
        sid,
        "@office-skills 做个PPT",
        selectedSkills=["office-skills"],
        installedSkills=["office-skills"],
    ))
    complete = next(event for event in events if event.get("type") == "complete")
    written = next(
        row for row in reversed(complete["state"]["controlTranscript"])
        if row.get("kind") == "plan_written"
    )
    assert "deliverableKind" in written
    assert written["deliverableKind"] == OFFICE_FILE

    got = client.get(f"/api/sliderule/sessions/{sid}", headers=KEY)
    assert got.status_code == 200, got.text[:800]
    plan = next(
        row for row in reversed(got.json()["state"]["controlTranscript"])
        if row.get("kind") == "plan_written"
    )
    assert "deliverableKind" in plan
    assert plan["deliverableKind"] == OFFICE_FILE


def test_write_plan_omitted_kind_follows_mentioned_office_skill(monkeypatch):
    """@办公技能省略 kind → office-file。不是从「做个PPT」猜。"""
    harness = ControlHarness(monkeypatch)
    sid = new_sid("office-at")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})
    monkeypatch.setattr(
        control,
        "_mentioned_skill_infos",
        lambda _state: [SkillInfo(
            name="office-skills", description="办公文件",
            path="office-skills/SKILL.md", body="做出磁盘上的 pptx。",
            enabled=True,
        )],
    )
    harness.llm_impl = lambda *a, **kw: llm_tool(
        "write_plan", {"planContent": PPT_PLAN}
    )
    harness.post(six_fields(sid, "@office-skills 做个PPT"))
    plan = latest_control_plan(load_session(sid))
    assert plan["deliverableKind"] == OFFICE_FILE


def test_write_plan_ppt_text_without_mention_stays_web_app(monkeypatch):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("ppt-guess")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})
    harness.llm_impl = lambda *a, **kw: llm_tool(
        "write_plan", {"planContent": "做一份五页PPT"}
    )
    harness.post(six_fields(sid, "做个PPT"))
    plan = latest_control_plan(load_session(sid))
    assert plan["deliverableKind"] == WEB_APP


def test_write_plan_omitted_kind_defaults_to_web_app(monkeypatch):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("web-plan")
    seed_session(sid, goal={"text": "做一个任务应用", "status": "clear"})
    harness.llm_impl = lambda *a, **kw: llm_tool(
        "write_plan", {"planContent": "做一个带登录的任务清单"}
    )
    harness.post(six_fields(sid, "做一个任务应用"))
    plan = latest_control_plan(load_session(sid))
    assert plan["deliverableKind"] == WEB_APP


@pytest.fixture
def project_setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.session_blob_store import SqlSessionBlobStore
    blobs = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: blobs)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    yield store, blobs
    store.close()
    blobs._engine.dispose()


def _approved(sid, *, kind=None, owner="alice"):
    rows = approved_plan_rows(PPT_PLAN if kind == OFFICE_FILE else "Build a task app",
                              deliverable_kind=kind)
    state = V5SessionState(
        sessionId=sid, ownerId=owner,
        goal={"text": "做个PPT" if kind == OFFICE_FILE else "任务应用"},
        controlTranscript=rows,
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    return state, approved_reference(state)


def test_office_file_ignores_vite_templates_on_create(project_setup):
    """通电：办公计划 + react-vite-tasks 也建成空工作区，不拒建、不灌 Vite。"""
    store, _ = project_setup
    state, ref = _approved("sess-office-tasks", kind=OFFICE_FILE)
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                    approval_ref=ref, template_id="react-vite-tasks")
    assert store.get_revision(project.projectId, owner_id="alice").templateVersion == WORKSPACE_TEMPLATE_VERSION
    files = store.read_files(project.projectId, owner_id="alice")
    assert "package.json" not in files
    assert files["README.md"] == WORKSPACE_README
    assert "一行" in files["README.md"]


def test_stale_office_readme_is_replaced_before_the_tool_returns(project_setup):
    """⚠ 2026-09-22 Z8NPKNM14C：已有工程的 README 仍是 78 字旧句。

    create 再走一次必须换成当前正文。删掉 _ensure_office_tree 本条变红。
    """
    from services.project_manifest import content_hash

    store, _ = project_setup
    state, ref = _approved("sess-stale-readme", kind=OFFICE_FILE)
    old = (
        "这是空工作区。源码树里没有 Vite。"
        "写文本用 file_write，跑命令用 bash。"
        "办公文件（.pptx / .docx / .xlsx）不进源码树。"
    )
    assert content_hash(old) == "5edc1d7ee54f4cce5832e05c538243f6f8d505ec50206a5bb921b8aeec772624"
    store.create_project(
        state.sessionId, owner_id="alice", files={"README.md": old},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref=ref,
    )
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=ref, template_id="react-vite",
    )
    files = store.read_files(project.projectId, owner_id="alice")
    assert files["README.md"] == WORKSPACE_README
    assert content_hash(files["README.md"]) != content_hash(old)


def test_office_file_may_use_bare_computer(project_setup):
    store, _ = project_setup
    state, ref = _approved("sess-office-bare", kind=OFFICE_FILE)
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=ref, template_id="react-vite")
    assert project.projectId
    assert store.get_revision(project.projectId, owner_id="alice").templateVersion == WORKSPACE_TEMPLATE_VERSION
    assert "package.json" not in store.read_files(project.projectId, owner_id="alice")


def test_ppt_topic_web_app_plan_is_not_office_workspace(project_setup):
    """话题写了 PPT，计划仍是 web-app：不许改成空工作区。"""
    store, _ = project_setup
    rows = approved_plan_rows("做一份五页PPT")
    state = V5SessionState(
        sessionId="sess-ppt-web", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=rows,
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    assert store.get_revision(project.projectId, owner_id="alice").templateVersion == "whybuddy-react-vite-1"
    assert "package.json" in store.read_files(project.projectId, owner_id="alice")


def test_web_app_plan_still_creates_tasks(project_setup):
    """存量：不带 deliverableKind 的网页会话仍可建 tasks。"""
    store, _ = project_setup
    state, ref = _approved("sess-web-tasks")
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=ref, template_id="react-vite-tasks")
    assert store.get_revision(project.projectId, owner_id="alice").templateVersion == "whybuddy-react-vite-tasks-1"


def test_goal_is_done_office_file_ignores_task_eligible():
    """eligible 为真的任务工程不能让办公目标变完成。"""
    office = V5SessionState(
        sessionId="s-office-done", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=[{"kind": "plan_written", "planId": "p1", "revision": 1,
                            "planContent": PPT_PLAN, "deliverableKind": OFFICE_FILE}],
    )
    web = V5SessionState(
        sessionId="s-web-done", ownerId="alice",
        goal={"text": "任务应用"},
        controlTranscript=[{"kind": "plan_written", "planId": "p1", "revision": 1,
                            "planContent": "任务应用"}],
    )
    calls = []

    class Delivery:
        def __init__(self, store, owner):
            self.owner = owner

        def status(self, project_id):
            calls.append(project_id)
            return {"eligible": True, "blockedReasons": []}

    service = SimpleNamespace(
        authorize=lambda sid, owner: office if sid == office.sessionId else web,
        project_store=SimpleNamespace(
            get_project_for_session=lambda *_a, **_k: SimpleNamespace(projectId="proj-1"),
        ),
    )
    import services.control_run_service as run_mod
    original = run_mod.ProjectDeliveryService
    run_mod.ProjectDeliveryService = Delivery
    try:
        assert asyncio.run(ControlRunService._goal_is_done(
            service, {"sessionId": office.sessionId, "ownerId": "alice"})) is False
        assert calls == []
        assert asyncio.run(ControlRunService._goal_is_done(
            service, {"sessionId": web.sessionId, "ownerId": "alice"})) is True
        assert calls == ["proj-1"]
        assert asyncio.run(ControlRunService._goal_blocked_reasons(
            service, {"sessionId": office.sessionId, "ownerId": "alice"})) == ["office_file_not_found"]
    finally:
        run_mod.ProjectDeliveryService = original


def test_office_prompt_is_a_fact_not_a_recipe():
    text = control._system_prompt(V5SessionState(
        sessionId="office-prompt",
        goal={"text": "做个PPT", "status": "clear"},
        controlTranscript=[{"kind": "plan_written", "planId": "p1", "revision": 1,
                            "planContent": PPT_PLAN, "deliverableKind": OFFICE_FILE}],
    ))
    assert "办公文件" in text
    assert "react-vite-tasks 只用于任务管理网页" in text
    assert "没有点名就没有预览" in text
    assert "应用运行失败不是办公文件的预览" in text
    assert "不能当幻灯片交差" not in text
    assert "空工作区" in text
    assert "必须先调" not in text
    assert "先调 make_manus_page" not in text
    assert "先 pip" not in text
    fruit = control._system_prompt(V5SessionState(
        sessionId="fruit-prompt",
        goal={"text": "水果店收银台", "status": "clear"},
    ))
    assert "没有点名就没有预览" not in fruit


def test_live_path_gates_are_in_source_after_stripping_comments():
    """反向：把闸删掉或办公目标仍指向 eligible，这条红。"""
    create_body = _fn_body(strip_python(CREATE_SRC), "create_session_project")
    assert "_source_for_create" in create_body
    assert "reject_tasks_template" not in create_body
    source_body = _fn_body(strip_python(CREATE_SRC), "_source_for_create")
    assert "office_workspace_files" in source_body
    assert "WORKSPACE_TEMPLATE_VERSION" in source_body
    assert "plan_deliverable_kind" in source_body
    assert "做个PPT" not in source_body

    write_body = _fn_body(strip_python(CONTROL_SRC), "_dispatch_tool")
    assert "deliverableKind" in write_body
    assert "_deliverable_kind_for_write_plan" in write_body
    helper = _fn_body(strip_python(CONTROL_SRC), "_deliverable_kind_for_write_plan")
    assert "_this_turn_office_skill_named" in helper
    assert "做一份 PPT" not in helper
    named = _fn_body(strip_python(CONTROL_SRC), "_this_turn_office_skill_named")
    assert "OFFICE_SKILL_CATEGORY" in named
    assert "userText" in named
    commit = _fn_body(strip_python(CONTROL_SRC), "_commit_plan_state")
    assert "stamp_control_plan_kind" in commit
    assert "_persist_durable_state" in commit

    done_body = _fn_body(strip_python(GOAL_SRC), "_goal_is_done")
    office_at = done_body.find("office_file_uses_task_delivery")
    delivery_at = done_body.find("ProjectDeliveryService")
    assert 0 <= office_at < delivery_at
    reasons_body = _fn_body(strip_python(GOAL_SRC), "_goal_blocked_reasons")
    assert "office_file_uses_task_delivery" in reasons_body
    assert "office_file_not_found" in reasons_body

    # worker 里有只含文档串的类，整文件 strip_python 再 unparse 会空 class。
    # 先切 run() 再剥注释，标识符写在头注里不得把变异养绿。
    run_body = _fn_body(WORKER_SRC.read_text(encoding="utf-8"), "run")
    run_body = re.sub(r'""".*?"""', "", run_body, flags=re.S)
    run_body = re.sub(r"#.*", "", run_body)
    skip_at = run_body.find("skip_vite_dependency_install")
    npm_at = run_body.find("npm ci --ignore-scripts")
    assert 0 <= skip_at < npm_at
    assert "not skip_install" in run_body


def test_project_create_tool_description_does_not_advertise_tasks_as_the_real_app():
    from services.project_tool_contracts import _DESCRIPTIONS
    desc = _DESCRIPTIONS["project_create"]
    assert "only for a task-management web app" in desc
    assert "Office files" in desc
    assert "do not pick react-vite-tasks" in desc
