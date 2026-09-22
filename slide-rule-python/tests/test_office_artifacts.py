# -*- coding: utf-8 -*-
"""办公产物：bash 成功才回传，不进文本源码树。

⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：generate_deck.py 在源码树，
  .pptx 停在沙箱。判据必须执行 worker._collect_office_artifacts 和
  run_command 源码，不许重抄一份收集逻辑。
"""

from __future__ import annotations

import ast
import asyncio
import base64
import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from plan_approval_support import approved_plan_rows
from project_actor_support import project_actor
from models.v5_state import V5SessionState
from routes import project_sources as route
from services.control_run_service import ControlRunService
from services.deliverable_kind import (
    OFFICE_FILE,
    OFFICE_FILE_NOT_TEXT,
    OFFICE_START_NOT_APPLICABLE,
    is_office_artifact_path,
    office_preview_payload,
)
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_export import source_archive
from services.project_office_artifacts import ProjectOfficeArtifactStore, decode_office_write
from services.project_runtime_worker import ProjectRuntimeSupervisor, _RuntimeTask
from services.project_store import ProjectStore
from services.project_tools import ProjectTools
from services import persistence, project_creation, project_tools
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT
from services.session_blob_store import SqlSessionBlobStore


ROOT = Path(__file__).resolve().parents[1]
WORKER_SRC = ROOT / "services" / "project_runtime_worker.py"
TOOLS_SRC = ROOT / "services" / "project_tools.py"


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


def minimal_pptx(text: str = "面团启动") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
        )
        archive.writestr(
            "ppt/slides/slide1.xml",
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            f"<a:t>{text}</a:t></p:sld>",
        )
    return buf.getvalue()


def positioned_pptx() -> bytes:
    slide = """<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0B1F17"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:sp>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="C2410C"/></a:solidFill>
        </p:spPr>
        <p:txBody>
          <a:p><a:r><a:rPr sz="3200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>面团 AI 办公</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"""
    presentation = """<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("ppt/presentation.xml", presentation)
        archive.writestr("ppt/slides/slide2.xml", slide.replace("面团 AI 办公", "第二页"))
        archive.writestr("ppt/slides/slide10.xml", slide.replace("面团 AI 办公", "第十页"))
    return buf.getvalue()


def test_slide_preview_keeps_position_and_numeric_order():
    """⚠ 2026-09-22 预览只有正文，右边是文档卡片。位置没了，舞台摆不出这一页。

    删掉 shapes 或改回文件名排序，本条变红。
    """
    preview = office_preview_payload(positioned_pptx(), "deck.pptx")
    assert preview is not None
    assert preview["slideWidth"] == 12192000
    assert [slide["text"] for slide in preview["slides"]] == ["第二页", "第十页"]
    shape = preview["slides"][0]["shapes"][0]
    assert shape["x"] == 457200 and shape["y"] == 274638
    assert shape["w"] == 8229600 and shape["h"] == 1143000
    assert shape["fontSize"] == 32 and shape["color"] == "#FFFFFF"
    assert shape["fill"] == "#C2410C"
    assert preview["slides"][0]["background"] == "#0B1F17"


def test_leaf_office_path_and_preview():
    assert is_office_artifact_path("deck.pptx")
    assert is_office_artifact_path("out/notes.docx")
    assert not is_office_artifact_path("generate_deck.py")
    preview = office_preview_payload(minimal_pptx("封面"), "deck.pptx")
    assert preview is not None
    assert preview["kind"] == "slides"
    assert "封面" in preview["slides"][0]["text"]
    assert office_preview_payload(b"not-a-zip", "deck.pptx") is None


def test_decode_office_write_rejects_text():
    try:
        decode_office_write("not zip", encoding=None)
        raise AssertionError("expected reject")
    except ValueError as exc:
        assert str(exc) == OFFICE_FILE_NOT_TEXT
    data = decode_office_write(base64.b64encode(minimal_pptx()).decode(), encoding="base64")
    assert data.startswith(b"PK")


def _project_setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.session_blob_store import SqlSessionBlobStore
    blobs = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: blobs)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    return store, blobs


def test_store_put_and_has_any(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-put"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    office = ProjectOfficeArtifactStore(store)
    assert office.has_any(project.projectId, owner_id="alice") is False
    meta = office.put(
        project.projectId, owner_id="alice", path="面团AI办公启动会.pptx",
        data=minimal_pptx())
    assert meta["downloadable"] is True
    assert office.has_any(project.projectId, owner_id="alice") is True
    listed = office.list(project.projectId, owner_id="alice")
    assert [item["path"] for item in listed] == ["面团AI办公启动会.pptx"]
    _got, data = office.get_bytes(project.projectId, meta["artifactId"], owner_id="alice")
    assert data.startswith(b"PK")
    files = store.read_files(project.projectId, owner_id="alice")
    assert all(not path.endswith(".pptx") for path in files)
    store.close()
    blobs._engine.dispose()


def test_collect_hook_is_on_the_live_run_command():
    """命令结束后都扫，失败那条 raise 之前就要 collect。"""
    body = _fn_body(WORKER_SRC.read_text(encoding="utf-8"), "run_command")
    collect_at = body.find("_collect_office_artifacts")
    failed_at = body.find("project_command_failed")
    unknown_at = body.find("project_command_result_unknown")
    assert 0 <= collect_at < unknown_at < failed_at
    assert "generate_deck.py" not in body


def test_collect_office_artifacts_puts_zip_not_scripts(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-collect"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    task = SimpleNamespace(
        provider=SimpleNamespace(
            collect_office_files=lambda _handle: [
                {"path": "deck.pptx", "data": pptx},
                {"path": "generate_deck.py", "data": b"print(1)"},
            ]
        ),
        handle=object(),
        store=store,
        owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId),
        result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert task.result["officeFiles"] == ["deck.pptx"]
    office = ProjectOfficeArtifactStore(store)
    paths = [item["path"] for item in office.list(project.projectId, owner_id="alice")]
    assert paths == ["deck.pptx"]
    assert "generate_deck.py" not in paths
    store.close()
    blobs._engine.dispose()


def test_collect_skips_when_provider_missing():
    task = SimpleNamespace(
        provider=SimpleNamespace(),
        handle=object(),
        store=None,
        owner_id="alice",
        original=SimpleNamespace(projectId="prj-x"),
    )
    _RuntimeTask._collect_office_artifacts(task)


def test_goal_is_done_when_artifact_exists(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-done"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="deck.pptx", data=minimal_pptx())

    service = SimpleNamespace(
        authorize=lambda *_a, **_k: state,
        project_store=store,
    )
    assert asyncio.run(ControlRunService._goal_is_done(
        service, {"sessionId": sid, "ownerId": "alice"})) is True
    assert asyncio.run(ControlRunService._goal_blocked_reasons(
        service, {"sessionId": sid, "ownerId": "alice"})) == []
    store.close()
    blobs._engine.dispose()


def test_project_start_does_not_start_vite_for_office_file(tmp_path, monkeypatch, project_actor):
    """办公计划不许 project_start 去起 Vite。"""
    project_actor("alice")
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-start"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite-tasks")
    tools = ProjectTools(store, None, "alice")
    result = tools.execute(
        "project_start",
        {"expectedRevision": project.currentRevision, "approvalRef": approved_reference(state),
         "idempotencyKey": "no-vite"},
        persistence.load_session_record(sid)["session"],
    )
    assert result["ok"] is False
    assert result["error"] == OFFICE_START_NOT_APPLICABLE
    store.close()
    blobs._engine.dispose()


def test_project_verify_blocked_in_source():
    body = _fn_body(TOOLS_SRC.read_text(encoding="utf-8"), "execute")
    verify_at = body.find('name == "project_verify"')
    reject_at = body.find("OFFICE_VERIFY_NOT_APPLICABLE")
    submit_at = body.find("submit_verification")
    assert 0 <= verify_at < reject_at < submit_at
    start_at = body.find('name == "project_start"')
    start_reject = body.find("OFFICE_START_NOT_APPLICABLE")
    submit_runtime = body.find("self.supervisor.submit(")
    assert 0 <= start_at
    assert 0 <= start_reject < submit_runtime


def test_collect_office_lives_in_the_sandbox_script():
    script = ARTIFACT_IO_SCRIPT
    collect_at = script.find('action == "collect-office"')
    magic_at = script.find(r"PK\x03\x04")
    skip_at = script.find("node_modules")
    assert 0 <= collect_at < skip_at < magic_at
    assert "generate_deck.py" not in script


def test_collect_office_files_decodes_on_the_live_provider():
    from services.e2b_workspace_provider import E2BWorkspaceProvider

    pptx = minimal_pptx("封面")
    calls = []

    class Fake:
        def _artifact_io(self, handle, action):
            calls.append(action)
            return {"files": [{
                "path": "deck.pptx",
                "data": base64.b64encode(pptx).decode(),
            }]}

    out = E2BWorkspaceProvider.collect_office_files(Fake(), object())
    assert calls == ["collect-office"]
    assert out == [{"path": "deck.pptx", "data": pptx}]


def test_collect_skips_script_even_when_it_arrives_first(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-order"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    task = SimpleNamespace(
        provider=SimpleNamespace(
            collect_office_files=lambda _handle: [
                {"path": "generate_deck.py", "data": b"print(1)"},
                {"path": "deck.pptx", "data": pptx},
            ]
        ),
        handle=object(),
        store=store,
        owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId),
        result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert task.result["officeFiles"] == ["deck.pptx"]
    paths = [
        item["path"]
        for item in ProjectOfficeArtifactStore(store).list(project.projectId, owner_id="alice")
    ]
    assert paths == ["deck.pptx"]
    store.close()
    blobs._engine.dispose()


@pytest.fixture
def tools_setup(tmp_path, monkeypatch, project_actor):
    project_actor("alice")
    monkeypatch.setattr(project_tools, "SHELL_EXEC_FOREGROUND_BLOCK_SECONDS", 0)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({
        "sessionId": "session-office-tools", "ownerId": "alice",
        "goal": {"text": "做个PPT", "status": "clear"},
        "controlTranscript": approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    })
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    files = {"package.json": "{}", "src/App.tsx": "hello\n"}
    monkeypatch.setattr(project_creation, "load_project_template", lambda: (files.copy(), "test-vite-1"))
    supervisor = ProjectRuntimeSupervisor(store, lambda: (_ for _ in ()).throw(AssertionError("no provider")))
    supervisor._scanner = SimpleNamespace(is_alive=lambda: True)
    tools = ProjectTools(store, supervisor, "alice")
    yield SimpleNamespace(
        store=store, sessions=sessions, state=state, tools=tools,
        approval=approved_reference(state), files=files,
    )
    store.close()
    sessions._engine.dispose()


def test_file_write_office_path_rejects_text_and_stores_zip(tools_setup):
    created = tools_setup.tools.execute(
        "project_create", {"approvalRef": tools_setup.approval}, tools_setup.state)
    assert created["ok"], created
    rejected = tools_setup.tools.execute(
        "file_write", {"file": "deck.pptx", "content": "not zip"}, tools_setup.state)
    assert rejected == {"ok": False, "error": OFFICE_FILE_NOT_TEXT}
    pptx = minimal_pptx("封面")
    written = tools_setup.tools.execute(
        "file_write",
        {
            "file": "面团启动.pptx",
            "content": base64.b64encode(pptx).decode(),
            "contentEncoding": "base64",
        },
        tools_setup.state,
    )
    assert written["ok"] is True
    assert written["downloadable"] is True
    assert written["path"] == "面团启动.pptx"
    files = tools_setup.store.read_files(created["projectId"], owner_id="alice")
    assert "面团启动.pptx" not in files
    read = tools_setup.tools.execute(
        "file_read", {"file": "面团启动.pptx"}, tools_setup.state)
    assert read["ok"] is True
    assert read["content"] == ""
    assert read["downloadable"] is True
    assert read["sha256"] == written["sha256"]
    found = tools_setup.tools.execute(
        "file_find_by_name", {"path": ".", "glob": "*.pptx"}, tools_setup.state)
    assert found["ok"] is True
    assert "面团启动.pptx" in found["files"]


def test_export_and_http_serve_office_bytes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(
        sessionId="office-http", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx("封面")
    meta = ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="面团启动.pptx", data=pptx)
    revision = store.get_revision(project.projectId, owner_id="alice")
    files = store.read_files(project.projectId, owner_id="alice")
    archive = source_archive(files, revision, artifacts={"面团启动.pptx": pptx})
    with zipfile.ZipFile(io.BytesIO(archive)) as packed:
        assert packed.read("artifacts/面团启动.pptx") == pptx
        assert all(not name.endswith(".pptx") for name in packed.namelist() if name.startswith("source/"))
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    url = f"/api/sliderule/projects/{project.projectId}"
    with TestClient(app) as client:
        listed = client.get(url + "/artifacts")
        assert listed.status_code == 200
        assert listed.json()["files"][0]["path"] == "面团启动.pptx"
        preview = client.get(url + f"/artifacts/{meta['artifactId']}/preview")
        assert preview.status_code == 200
        body = preview.json()
        assert body["kind"] == "slides"
        assert "封面" in body["slides"][0]["text"]
        page = client.get(url + f"/artifacts/{meta['artifactId']}/preview?render=browser")
        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "封面" in page.text
        assert "function show(n)" in page.text
        download = client.get(url + f"/artifacts/{meta['artifactId']}")
        assert download.status_code == 200
        assert download.content == pptx
        assert "office-file.pptx" in download.headers["content-disposition"]
        assert "UTF-8''" in download.headers["content-disposition"]
        exported = client.get(url + "/export")
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as packed:
            assert packed.read("artifacts/面团启动.pptx") == pptx
        viewer["id"] = "mallory"
        assert client.get(url + "/artifacts").status_code == 404
    store.close()
    sessions._engine.dispose()


def test_browser_page_is_only_the_named_render():
    """没带 render=browser 仍是 JSON。点名之后那一页才是 HTML。"""
    src = (ROOT / "routes" / "project_sources.py").read_text(encoding="utf-8")
    body = _fn_body(src, "preview_office_artifact")
    assert 'get("render") == "browser"' in body
    assert body.index('get("render") == "browser"') < body.index("office_preview_html")


def test_stale_text_preview_keeps_shape_json(tmp_path, monkeypatch):
    """已入库的纯正文，读预览时按文件字节补坐标。仍然是 JSON，不是宿主画的页。

    ⚠ 2026-09-22 启动会那份预览先入库时还没有坐标。删掉读时补位置，本条变红。
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(
        sessionId="office-browser", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    meta = ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="面团启动.pptx", data=positioned_pptx())
    stale = {"kind": "slides", "slides": [{"text": "第二页"}, {"text": "第十页"}]}
    raw = json.dumps(stale, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    store._q(
        "update wb_project_office_preview set content=$1 where artifact_id=$2",
        [base64.b64encode(raw).decode("ascii"), meta["artifactId"]],
    )
    stored = json.loads(base64.b64decode(store._q(
        "select content from wb_project_office_preview where artifact_id=$1",
        [meta["artifactId"]],
    )[0]["content"]))
    assert "shapes" not in stored["slides"][0]
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}/preview"
    with TestClient(app) as client:
        preview = client.get(url)
        assert preview.headers["content-type"].startswith("application/json")
        assert preview.json()["slides"][0]["shapes"][0]["x"] == 457200
        page = client.get(url + "?render=browser")
        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "第二页" in page.text and "第十页" in page.text
        assert "left:" in page.text
    store.close()
    sessions._engine.dispose()
