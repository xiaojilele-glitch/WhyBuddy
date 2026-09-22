"""Platform Vite Host wrap must work on Agent createServer, not on a template grep.

2026-09-18 真机：工程里的 server.mjs 是模型写的，createViteServer 没接
allowedHosts。改模板、改那一个项目，下一份还是没接。这份判据跑真正的
Node --import 钩子：mock 的 vite.createServer 必须拿到中继 Host。
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess

import pytest

from services.vite_preview_hosts import (
    HOOK_SOURCE,
    REGISTER_PATH,
    REGISTER_SOURCE,
    injected_preview_dev_command,
    validate_preview_hosts,
)

_DEV = "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"
_HOST = "rt-preview.preview.156.239.47.108.sslip.io"


def test_inject_command_writes_outside_project_and_imports_the_hook():
    command = injected_preview_dev_command(_DEV, [_HOST, "5173-sandbox-1.e2b.app"])
    assert command.startswith("python3 -I -S -c ")
    assert " && " in command
    assert REGISTER_PATH in command
    assert f"export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={_HOST} &&" in command
    assert f"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={_HOST}," not in command
    assert "5173-sandbox-1.e2b.app" in command
    assert "./server.mjs --dev" in command
    assert "if [ -f ./server.mjs ]" in command
    assert "node --import=" in command
    assert command.endswith("fi")
    host_env = command.split("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=", 1)[1].split()[0]
    assert host_env == _HOST
    assert "*" not in host_env
    assert "allowedHosts:true" not in command.replace(" ", "")
    assert "allowedHosts=true" not in command.replace(" ", "")


def test_vite_73_env_is_exactly_the_iframe_host_not_a_comma_list():
    """Vite 7.3.6 resolveServerOptions 不按逗号拆 env。"""
    command = injected_preview_dev_command(_DEV, [_HOST, "5173-sandbox-1.e2b.app"])
    assert f"export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={_HOST} &&" in command
    assert f"{_HOST},5173-sandbox-1.e2b.app" not in command.split("export NODE_OPTIONS", 1)[0]


def test_inject_rejects_wildcard_and_shell_hosts():
    with pytest.raises(ValueError, match="project_preview_origin_invalid"):
        injected_preview_dev_command(_DEV, ["*.preview.example.com"])
    with pytest.raises(ValueError, match="project_preview_origin_invalid"):
        injected_preview_dev_command(_DEV, ["preview.example.com;echo"])
    with pytest.raises(ValueError, match="project_preview_origin_invalid"):
        validate_preview_hosts([])


def test_hook_source_never_sets_allowed_hosts_true():
    compact = HOOK_SOURCE.replace(" ", "")
    assert "allowedHosts:true" not in compact
    assert "allowedHosts=true" not in compact
    assert "createServer" in HOOK_SOURCE
    assert "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" in HOOK_SOURCE
    assert "register" in REGISTER_SOURCE


def _node() -> str:
    found = shutil.which("node")
    if not found:
        pytest.skip("node is required to prove the createServer wrap")
    return found


def _write_hook_fixture(root: pathlib.Path) -> pathlib.Path:
    inject = root / "inject"
    inject.mkdir()
    (inject / "register.mjs").write_text(REGISTER_SOURCE, encoding="utf-8")
    (inject / "hook.mjs").write_text(HOOK_SOURCE, encoding="utf-8")
    vite = root / "node_modules" / "vite"
    vite.mkdir(parents=True)
    (vite / "package.json").write_text(
        json.dumps({"name": "vite", "type": "module", "exports": {".": "./index.js"}}),
        encoding="utf-8",
    )
    (vite / "index.js").write_text(
        "export function createServer(config) { return { config }; }\n"
        "export default { createServer };\n",
        encoding="utf-8",
    )
    (root / "server.mjs").write_text(
        # Agent 真机那份：createViteServer 不传 allowedHosts。
        "const { createServer: createViteServer } = await import('vite');\n"
        "const vite = await createViteServer({\n"
        "  root: '.',\n"
        "  server: { middlewareMode: true, hmr: { server: {} } },\n"
        "  appType: 'spa',\n"
        "});\n"
        "process.stdout.write(JSON.stringify(vite.config));\n",
        encoding="utf-8",
    )
    return inject / "register.mjs"


def test_create_server_without_allowed_hosts_still_gets_relay_host(tmp_path):
    """反向：同一份 Agent server.mjs，不 --import 就没有 Host；包上才有。"""
    register = _write_hook_fixture(tmp_path)
    env = {**os.environ, "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": _HOST}
    server = str(tmp_path / "server.mjs")
    node = _node()
    bare = subprocess.run(
        [node, server], cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    assert bare.returncode == 0, bare.stderr
    assert json.loads(bare.stdout).get("server", {}).get("allowedHosts") in (None, [])

    wrapped = subprocess.run(
        [node, "--import", register.resolve().as_uri(), server],
        cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    assert wrapped.returncode == 0, wrapped.stderr
    hosts = json.loads(wrapped.stdout)["server"]["allowedHosts"]
    assert hosts == [_HOST]
    assert True not in hosts and "true" not in [str(item).lower() for item in hosts]


def test_node_http_rewrites_preview_host_to_loopback(tmp_path):
    """Agent 的 node:http 先于 Vite 中间件看到 Host。改成 127.0.0.1 则 Vite 不再拦。

    反向：同一份 createServer，不 --import 时 Host 仍是 sslip。
    """
    register = _write_hook_fixture(tmp_path)
    (tmp_path / "http-app.mjs").write_text(
        "import { createServer, request as httpRequest } from 'node:http';\n"
        "const server = createServer((req, res) => { res.end(String(req.headers.host || '')); });\n"
        "server.listen(0, '127.0.0.1', () => {\n"
        "  const { port } = server.address();\n"
        "  const req = httpRequest({ host: '127.0.0.1', port, headers: { host: process.env.PREVIEW_HOST } }, res => {\n"
        "    let body = ''; res.on('data', chunk => { body += chunk; });\n"
        "    res.on('end', () => { process.stdout.write(body); server.close(); });\n"
        "  });\n"
        "  req.end();\n"
        "});\n",
        encoding="utf-8",
    )
    env = {**os.environ, "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": _HOST, "PREVIEW_HOST": _HOST}
    app = str(tmp_path / "http-app.mjs")
    node = _node()
    bare = subprocess.run(
        [node, app], cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    assert bare.returncode == 0, bare.stderr
    assert bare.stdout == _HOST

    wrapped = subprocess.run(
        [node, "--import", register.resolve().as_uri(), app],
        cwd=tmp_path, env=env, capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    assert wrapped.returncode == 0, wrapped.stderr
    assert wrapped.stdout == "127.0.0.1"


def test_existing_allowed_hosts_true_is_left_alone(tmp_path):
    register = _write_hook_fixture(tmp_path)
    (tmp_path / "keep-true.mjs").write_text(
        "const { createServer } = await import('vite');\n"
        "const vite = await createServer({ server: { allowedHosts: true } });\n"
        "process.stdout.write(JSON.stringify(vite.config.server.allowedHosts));\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [_node(), "--import", register.resolve().as_uri(), str(tmp_path / "keep-true.mjs")],
        cwd=tmp_path,
        env={**os.environ, "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": _HOST},
        capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) is True
