"""Packaged smoke must boot the real app before spending cloud runtime budget."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import runpy
import secrets
import signal
import socket
import subprocess
import sys
import tarfile
import time
from types import SimpleNamespace

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_smoke_timeout_stops_actual_descendant_but_preserves_unrelated_process(tmp_path):
    """Killing just the saved Node/Python parent must leave this assertion red."""
    helper = runpy.run_path(str(ROOT / "scripts/project-product-smoke.py"))
    leaf = (
        "import json,os,pathlib,signal,socket,sys,time; "
        "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
        "s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); "
        "pathlib.Path(sys.argv[1]).write_text(json.dumps({'pid':os.getpid(),'port':s.getsockname()[1]})); "
        "time.sleep(120)"
    )
    parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(leaf) + ",sys.argv[1]]); time.sleep(120)"
    owned_path, other_path = tmp_path / "owned.json", tmp_path / "other.json"
    owned = helper["start_local_process"]([sys.executable, "-c", parent, str(owned_path)])
    other = helper["start_local_process"]([sys.executable, "-c", leaf, str(other_path)])

    def listening(port):
        with socket.socket() as probe:
            probe.settimeout(0.2)
            return probe.connect_ex(("127.0.0.1", port)) == 0

    try:
        deadline = time.monotonic() + 10
        while not (owned_path.exists() and other_path.exists()) and time.monotonic() < deadline:
            time.sleep(0.025)
        assert owned_path.exists() and other_path.exists(), "local process fixture did not start"
        owned_leaf, other_leaf = json.loads(owned_path.read_text()), json.loads(other_path.read_text())
        assert owned_leaf["pid"] != owned.pid
        assert listening(owned_leaf["port"]) and listening(other_leaf["port"])
        helper["stop_local_process_tree"](owned)
        deadline = time.monotonic() + 3
        while listening(owned_leaf["port"]) and time.monotonic() < deadline:
            time.sleep(0.025)
        assert not listening(owned_leaf["port"]), "smoke timeout left its descendant listener alive"
        assert other.poll() is None and listening(other_leaf["port"]), "smoke cleanup killed an unrelated process"
        helper["stop_local_process_tree"](owned)
    finally:
        # Mutation runs intentionally strand the descendant. Clean up only the
        # exact fixture PIDs even when the production cleanup helper is broken.
        for path in (owned_path, other_path):
            if path.exists():
                pid = int(json.loads(path.read_text())["pid"])
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
                        creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        for process in (owned, other):
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)


def test_smoke_recovers_unknown_remote_create_without_touching_other_sandboxes():
    helper = runpy.run_path(str(ROOT / "scripts/project-product-smoke.py"))

    class Pager:
        def __init__(self, rows):
            self.rows, self.has_next = rows, True

        def next_items(self):
            self.has_next = False
            return self.rows

    class SandboxInventory:
        items = {"unrelated": {"whybuddy_product_smoke": "another-run"}}
        killed = []

        @classmethod
        def create(cls):
            cls.items["created-but-reply-lost"] = {"whybuddy_product_smoke": "this-run"}
            raise TimeoutError("remote create response lost")

        @classmethod
        def list(cls, *, api_key, query):
            return Pager([SimpleNamespace(sandbox_id=key, metadata=value) for key, value in cls.items.items()
                          if value == query.metadata])

        @classmethod
        def kill(cls, sandbox_id, *, api_key):
            cls.killed.append(sandbox_id)
            del cls.items[sandbox_id]

    trusted = None
    with pytest.raises(TimeoutError):
        trusted = SandboxInventory.create()
    assert trusted is None
    assert helper["cleanup_trusted_service"](SandboxInventory, SimpleNamespace,
        api_key="fixture", identity="this-run", trusted=trusted)
    assert SandboxInventory.killed == ["created-but-reply-lost"]
    assert SandboxInventory.items == {"unrelated": {"whybuddy_product_smoke": "another-run"}}


def test_smoke_remote_cleanup_refuses_an_unrelated_inventory_result():
    helper = runpy.run_path(str(ROOT / "scripts/project-product-smoke.py"))

    class WrongInventory:
        killed = []

        @classmethod
        def list(cls, **kwargs):
            class Page:
                has_next = True

                def next_items(self):
                    self.has_next = False
                    return [SimpleNamespace(sandbox_id="unrelated", metadata={"whybuddy_product_smoke": "another-run"})]
            return Page()

        @classmethod
        def kill(cls, *args, **kwargs):
            cls.killed.append(args)

    with pytest.raises(RuntimeError, match="cleanup_identity_mismatch"):
        helper["cleanup_trusted_service"](WrongInventory, SimpleNamespace,
            api_key="fixture", identity="this-run", trusted=None)
    assert WrongInventory.killed == []


def test_actual_smoke_finally_recovers_lost_create_response(tmp_path, monkeypatch):
    """Exercise main's failure path; a correct but unwired cleanup cannot pass."""
    import e2b_code_interpreter

    helper = runpy.run_path(str(ROOT / "scripts/project-product-smoke.py"))
    inventory, killed = {}, []

    class FakeSandbox:
        @staticmethod
        def create(**kwargs):
            inventory["lost-response"] = kwargs["metadata"]
            raise TimeoutError("response lost after allocation")

        @staticmethod
        def list(**kwargs):
            class Page:
                has_next = True

                def next_items(self):
                    self.has_next = False
                    return [SimpleNamespace(sandbox_id=key, metadata=value) for key, value in inventory.items()
                            if value == kwargs["query"].metadata]
            return Page()

        @staticmethod
        def kill(sandbox_id, **kwargs):
            killed.append(sandbox_id)
            del inventory[sandbox_id]

    monkeypatch.setattr(e2b_code_interpreter, "Sandbox", FakeSandbox)
    monkeypatch.setenv("E2B_API_KEY", "isolated-smoke-fixture-key")
    monkeypatch.setattr(sys, "argv", ["project-product-smoke", "--timeout", "180"])
    monkeypatch.setitem(helper["main"].__globals__, "ROOT", tmp_path)
    monkeypatch.setitem(helper["main"].__globals__, "source_archive", lambda: b"fixture-source")
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout="fixture-head", returncode=0))
    assert helper["main"]() == 1, "a lost create response must still report the scenario failed"
    report_paths = list((tmp_path / "artifacts/project-product").glob("*/report.json"))
    assert len(report_paths) == 1
    report = json.loads(report_paths[0].read_text())
    assert killed == ["lost-response"] and inventory == {}, "main skipped unknown-create inventory cleanup"
    assert report["cleanup"] == [{"resource": "trusted_service", "confirmedEmpty": True}]
    assert report["status"] == "failed" and report["error"] == "TimeoutError"
    assert "isolated-smoke-fixture-key" not in report_paths[0].read_text()


def test_packaged_product_smoke_runs_real_lifespan_and_account_boundary(tmp_path):
    helper = runpy.run_path(str(ROOT / "scripts/project-product-smoke.py"))
    # This preflight tests app packaging/startup without requiring Node bundles;
    # real relay+agent bundles are built and exercised by the cloud smoke.
    blob = helper["source_archive"](include_preview=False)
    with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
        names = archive.getnames()
        assert "slide-rule-python/services/data/product_archetypes.json" in names
        assert "project-templates/react-vite-tasks/database.mjs" in names
        assert "project-templates/react-vite-tasks/public/_whybuddy/editor.js" in names
        assert not any("/node_modules/" in name or "/dist/" in name or name.endswith("tasks.sqlite") for name in names)
        assert not any(Path(name).name == ".env" or name.startswith("slide-rule-python/data/") for name in names)
        archive.extractall(tmp_path, filter="data")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    config = {"fixtureKey": secrets.token_urlsafe(32), "password": "ArchiveFixture42!",
        "ownerEmail": "owner@example.invalid", "strangerEmail": "other@example.invalid",
        "runtimeId": "rt-offline", "sessionId": "archive-offline", "title": "Archive startup", "port": port,
        "environment": {"APP_STORE_DATABASE_URL": "sqlite:///" + (tmp_path / "state.db").as_posix(),
            "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "", "APP_STORE_NEON_HTTP": "0",
            "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "NODE_ENV": "development", "LLM_API_KEY": "",
            "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "E2B_API_KEY": "",
            "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE": "", "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY": "",
            "SLIDE_RULE_INTERNAL_KEY": secrets.token_hex(32), "SLIDERULE_AUTH_SECRET": secrets.token_hex(32)}}
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    log = (tmp_path / "startup.log").open("w", encoding="utf-8")
    process = subprocess.Popen([sys.executable, str(tmp_path / "scripts/fixtures/project-product-backend.py"), str(path)],
        cwd=tmp_path, env={**os.environ, "PYTHONUTF8": "1"}, stdout=log, stderr=subprocess.STDOUT)
    try:
        origin = "http://127.0.0.1:" + str(port)
        with httpx.Client(timeout=2, trust_env=False) as client:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    log.flush()
                    raise AssertionError((tmp_path / "startup.log").read_text(encoding="utf-8"))
                try:
                    response = client.get(origin + "/_smoke/state", headers={"Authorization": "Bearer " + config["fixtureKey"]})
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError("packaged_app_startup_timeout")
            value = response.json()
            assert value["composition"] == {"runtimeWorker": True, "controlService": True, "previewAccess": True, "previewRuntime": False}
            assert client.get(origin + "/_smoke/state").status_code == 403
            assert client.get(origin + "/api/sliderule/sessions/" + config["sessionId"]).status_code in (401, 403, 404)
            login = client.post(origin + "/api/sliderule/account/login", json={"email": config["ownerEmail"], "password": config["password"]})
            assert login.status_code == 200
            assert client.get(origin + "/api/sliderule/sessions/" + config["sessionId"]).status_code == 200
            assert value["runtimeIdFixtureCalls"] == 0
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        log.close()
