"""The real durable scanner must start Vite with the relay's exact Host allowed.

Local HTTP health alone missed the cloud failure: the smoke had this environment
variable, the product worker did not. These tests submit real operations to the
scanner and inspect the commands actually dispatched to the provider. Only the
remote provider is fake; the store, lease, manager and origin validator are real.
"""

import ast
import pathlib
import re

import pytest
from project_actor_support import project_actor

from services.vite_preview_hosts import REGISTER_PATH, injected_preview_dev_command
from test_project_preview_runtime import scanner
from test_project_runtime_worker import setup, submit, eventually, state

_DEV = "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"


def assert_platform_vite_start(command, hosts, *, files=None):
    """Env 只覆盖 Vite CLI。活路径必须再带 node --import server.mjs，且不写进工程源码。"""
    assert command == injected_preview_dev_command(_DEV, hosts)
    assert "--import=" + REGISTER_PATH in command
    assert "./server.mjs --dev" in command
    assert "if [ -f ./server.mjs ]" in command
    host_env = command.split("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=", 1)[1].split()[0]
    assert host_env == hosts[0]
    assert f"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={hosts[0]}," not in command
    assert "*" not in host_env
    for host in hosts[1:]:
        assert host in command
    compact = command.replace(" ", "")
    assert "allowedHosts:true" not in compact
    assert "allowedHosts=true" not in compact
    if files is not None:
        assert not any("vite-allowed-hosts" in path for path in files)


@pytest.mark.parametrize("origin", [
    "https://{runtimeId}.preview.example.com",
    "https://{runtimeId}.preview.example.com:8443",
    "http://{runtimeId}.localhost:3002",
])
def test_real_worker_allows_only_its_runtime_relay_hostname(scanner, monkeypatch, origin):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", origin)
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    ready = eventually(lambda: state(scanner.store, operation, "ready"))
    eventually(lambda: scanner.sent)
    runtime_id = ready.runtime.runtimeId
    expected_host = f"{runtime_id}.localhost" if ".localhost" in origin else f"{runtime_id}.preview.example.com"
    assert scanner.provider.commands[0] == "npm ci --ignore-scripts"
    assert_platform_vite_start(
        scanner.provider.commands[1], [expected_host], files=scanner.provider.contents)
    assert scanner.sent[0]["relay_origin"] == origin.replace("{runtimeId}", runtime_id)
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_published_e2b_host_does_not_drop_the_relay_host(scanner, monkeypatch):
    """iframe 走中继 Host。Vite 7.3.6 的 env 只能放这一个；E2B 域写进 hosts.json。

    2026-09-18 真机：published 赢了之后 Vite 只认 `5173-*.e2b.app`。
    同日重启：env 写成 `中继,e2b`，7.3.6 整段当一个 hostname，iframe 仍拦。
    变异：env 再拼上逗号+e2b，或把中继从名单里拿掉 → 本条红。
    """
    monkeypatch.setenv(
        "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE",
        "https://{runtimeId}.preview.156.239.47.108.sslip.io",
    )
    scanner.provider.preview_url = lambda handle, port: f"https://{port}-{handle.sandbox_id}.e2b.app"
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    ready = eventually(lambda: state(scanner.store, operation, "ready"))
    assert ready.runtime.previewUrl == "https://5173-sandbox-1.e2b.app/"
    runtime_id = ready.runtime.runtimeId
    relay = f"{runtime_id}.preview.156.239.47.108.sslip.io"
    assert_platform_vite_start(
        scanner.provider.commands[1],
        [relay, "5173-sandbox-1.e2b.app"],
        files=scanner.provider.contents,
    )
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_missing_agent_bundle_still_allows_the_iframe_relay_host(scanner, monkeypatch):
    """真机 2026-09-18：缺 dist/project-preview/agent.cjs → preview_runtime=None。

    启动日志 `[startup] project preview agent bundle unavailable`。iframe Host
    仍是 origin template 的 sslip。上一版 `_require_relay_origin` 看见
    preview_runtime is None 就 return None，中继名永远不进 Vite 名单。
    本条喂那一发：有 template、没有隧道进程。变异：把 None 短路加回去 → 红。
    """
    monkeypatch.setenv(
        "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE",
        "https://{runtimeId}.preview.156.239.47.108.sslip.io",
    )
    worker = scanner.make_worker()
    operation = submit(worker, scanner.project)
    ready = eventually(lambda: state(scanner.store, operation, "ready"))
    runtime_id = ready.runtime.runtimeId
    relay = f"{runtime_id}.preview.156.239.47.108.sslip.io"
    assert scanner.provider.commands[0] == "npm ci --ignore-scripts"
    assert_platform_vite_start(scanner.provider.commands[1], [relay], files=scanner.provider.contents)
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_require_relay_origin_does_not_skip_when_the_tunnel_process_is_missing():
    """剥注释后不许再把 preview_runtime is None 写成 return None 的前置条件。"""
    src = (pathlib.Path(__file__).resolve().parents[1]
           / "services" / "project_runtime_worker.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    body = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_require_relay_origin":
            body = ast.unparse(node)
            break
    assert body is not None
    assert "origin_for_runtime" in body
    assert "preview_runtime is None" not in body


def test_unconfigured_worker_keeps_default_command_and_never_uses_ambient_hosts(scanner, monkeypatch):
    # Production composition deliberately omits the manager if preview config
    # is missing; stray host-related tool/environment fields cannot enable it.
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    worker = scanner.make_worker()
    operation = submit(worker, scanner.project)
    eventually(lambda: state(scanner.store, operation, "ready"))
    assert scanner.provider.commands == ["npm ci --ignore-scripts",
        "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"]
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


@pytest.mark.parametrize("origin", [
    "https://preview.example.com",
    "https://*.preview.example.com/{runtimeId}",
    "https://{runtimeId}.preview.example.com;echo-pwned",
    "https://{runtimeId}.$(whoami).example.com",
    "https://{runtimeId}.preview.example.com\ntrue",
    "https://user:secret@{runtimeId}.preview.example.com",
    "http://{runtimeId}.preview.example.com",
])
def test_bad_preview_origin_fails_before_any_remote_execution(scanner, monkeypatch, origin):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", origin)
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    failed = eventually(lambda: state(scanner.store, operation, "failed"))
    assert failed.status == "failed"
    assert failed.runtime.errorCode in {"project_preview_origin_invalid", "project_preview_origin_not_configured"}
    assert scanner.provider.commands == []
    assert scanner.provider.created == 0
    assert not scanner.sent


def test_build_operations_do_not_add_or_require_preview_hosts(scanner, monkeypatch):
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = worker.submit_command(scanner.project.projectId, owner_id="alice",
        expected_revision=scanner.project.currentRevision, approval_ref="plan-1",
        idempotency_key="build-without-preview", command="build")
    eventually(lambda: state(scanner.store, operation, "executing"))
    eventually(lambda: len(scanner.provider.commands) == 2)
    assert scanner.provider.commands == ["npm ci --ignore-scripts", "npm run build"]
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_worker_start_command_calls_platform_inject():
    """闸装在 development_server_command。只改模板 / 只设 env → 本条仍绿、预览仍拦。

    变异：把 injected_preview_dev_command 调用删掉，只留 env 前缀 → AST 红。
    """
    src = (pathlib.Path(__file__).resolve().parents[1]
           / "services" / "project_runtime_worker.py").read_text(encoding="utf-8")
    names = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.FunctionDef) and node.name == "development_server_command":
            for child in ast.walk(node):
                if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
                    names.append(child.func.id)
    assert "injected_preview_dev_command" in names


def test_tasks_dev_server_forwards_vite_additional_hosts():
    """模板半边：新项目的 server.mjs 自己也会读 env。

    已有项目 / Agent 重写过的 server.mjs 不走这里，走 worker 的 NODE --import。
    """
    raw = (pathlib.Path(__file__).resolve().parents[2]
           / "project-templates" / "react-vite-tasks" / "server.mjs").read_text(encoding="utf-8")
    code = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    code = re.sub(r"//.*?$", "", code, flags=re.M)
    assert "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" in code
    assert "allowedHosts" in code
    assert "createViteServer" in code
    assert "allowedHosts: true" not in code.replace(" ", "")
