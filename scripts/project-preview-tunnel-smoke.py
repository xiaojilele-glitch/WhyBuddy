"""Two real E2B sandboxes, production relay/agent, real Chrome and Vite HMR.

The relay sandbox contains ONLY trusted service code and a test authorization
registry. The generated application remains in a separate private sandbox.
Python durable authorization and Studio consumption have separate real-entry
tests; this smoke does not substitute the fixture registry for those contracts.
Temporary credentials never enter saved evidence and are removed in finally.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import shlex
import subprocess
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))
from dotenv import dotenv_values
import httpx
from e2b import SandboxQuery
from e2b_code_interpreter import Sandbox
from websockets.sync.client import connect as websocket_connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.project_creation import load_project_template


def main(output: Path) -> int:
    identity = uuid.uuid4().hex
    directory = output / (str(int(time.time())) + "-" + identity[:8])
    directory.mkdir(parents=True)
    report = {"schemaVersion": 1, "status": "running", "scope": "two isolated E2B sandboxes and production preview transport",
        "notCovered": ["live Python authority over public network", "full Studio and AppsWorkbench composition in browser", "worker-owned HMR revisions",
                       "production preview DNS/TLS", "business persistence and verification gate"],
        "checks": [], "cleanup": []}
    def persist():
        (directory / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    def checked(name, condition):
        report["checks"].append({"name": name, "passed": bool(condition)})
        persist()
        print(("PASS " if condition else "FAIL ") + name, flush=True)
        if not condition:
            raise AssertionError(name)
    key = (os.getenv("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY") or "").strip()
    if not key:
        report.update(status="blocked", error="e2b_api_key_missing"); persist()
        print(json.dumps({"status": "blocked", "report": str(directory / "report.json")})); return 2
    provider = E2BWorkspaceProvider(api_key=key)
    relay = handle = browser_process = None
    browser_config = directory / "browser-config.json"
    browser_ticket_response = directory / "browser-ticket-response.json"
    browser_ticket_temporary = directory / "browser-ticket-response.json.tmp"
    workspace = "preview-tunnel-" + identity
    gateway_key, tunnel_token, browser_token, ticket = [secrets.token_urlsafe(32) for _ in range(4)]
    expires_at = int(time.time()) + 840
    management_headers = {"Authorization": "Bearer " + gateway_key}
    try:
        subprocess.run(["node", "scripts/build-project-preview.mjs"], cwd=ROOT, check=True)
        build_fixture = """require('esbuild').buildSync({entryPoints:['scripts/fixtures/project-preview-relay.ts'],outfile:process.argv[1],bundle:true,platform:'node',format:'cjs',target:'node22',external:['bufferutil','utf-8-validate'],banner:{js:\"process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';\"}})"""
        fixture_bundle = directory / "relay-fixture.cjs"
        subprocess.run(["node", "-e", build_fixture, str(fixture_bundle)], cwd=ROOT, check=True)
        relay = Sandbox.create(timeout=900, api_key=key, network={"allow_public_traffic": True},
            metadata={"whybuddy_preview_smoke_id": identity})
        origin = "https://" + relay.get_host(5190)
        control_origin = "https://" + relay.get_host(5191)
        config = {"gatewayKey": gateway_key, "tunnelToken": tunnel_token, "browserToken": browser_token,
            "ticket": ticket, "expiresAt": expires_at, "binding": {"ownerId": "smoke-owner", "sessionId": "smoke-session",
            "projectId": "project-" + identity, "operationId": "operation-" + identity,
            "workspaceId": workspace, "runtimeId": "runtime-" + identity, "revision": "revision-" + identity, "audience": origin}}
        relay.files.write("/home/user/relay.cjs", fixture_bundle.read_text(encoding="utf-8"))
        relay.files.write("/home/user/relay-config.json", json.dumps(config))
        relay.commands.run("node /home/user/relay.cjs /home/user/relay-config.json", background=True, timeout=900)
        client = httpx.Client(timeout=25, follow_redirects=False, trust_env=False)
        def wait_http(path, headers):
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                try:
                    response = client.get(origin + path, headers=headers)
                    if response.status_code == 200: return response
                except httpx.HTTPError:
                    pass
                time.sleep(0.5)
            raise AssertionError("remote_relay_readiness_timeout")
        wait_http("/_whybuddy/health", management_headers)
        checked("trusted relay health requires its independent key", client.get(origin + "/_whybuddy/health").status_code == 403)
        handle = provider.create(workspace_id=workspace, timeout_seconds=900)
        checked("application and trusted relay have different sandbox identities", relay.sandbox_id != handle.sandbox_id)
        files, template_version = load_project_template()
        report["templateVersion"] = template_version
        fixture = runpy.run_path(str(ROOT / "scripts/project-private-ingress-smoke.py"))["SERVER"]
        provider.write_files(handle, {**files, "transport-probe.mjs": fixture})
        installed = provider.start_process(handle, "npm ci --ignore-scripts", timeout_seconds=600)
        app = provider.start_process(handle, "node transport-probe.mjs " + shlex.quote(identity), timeout_seconds=900)
        source = (ROOT / "dist/project-preview/agent.cjs").read_text(encoding="utf-8")
        tunnel = provider.start_preview_tunnel(handle, agent_source=source, relay_origin=origin,
            token=tunnel_token, port=5187, expires_at=expires_at)
        checked("tunnel is a provider-managed real process", bool(tunnel.process_id))
        target = provider.private_preview_target(handle, 5187)
        checked("direct anonymous app ingress remains private", client.get(target.origin).status_code == 403)
        checked("anonymous gateway HTTP is rejected", client.get(origin + "/").status_code == 403)
        boot = client.get(origin + "/_whybuddy/authorize", params={"ticket": ticket})
        checked("ticket bootstraps once and redirects to a clean URL", boot.status_code == 303 and boot.headers.get("location") == "/")
        checked("used ticket cannot be replayed", client.get(origin + "/_whybuddy/authorize", params={"ticket": ticket}).status_code == 403)
        cookie = "__Host-WhyBuddyPreview=" + browser_token
        headers = {"Cookie": cookie}
        response = wait_http("/?probe=" + identity, {**headers, **management_headers})
        observed = response.json()
        checked("authorized HTTP reaches the private application through outbound WSS", observed.get("marker") == identity)
        digests = observed.get("valueDigests", [])
        checked("application HTTP cannot read E2B or gateway credentials", not any(
            hashlib.sha256(value.encode()).hexdigest() in digests for value in (key, target.access_token,
                gateway_key, "Bearer " + gateway_key, browser_token, cookie, tunnel_token)))
        checked("tunnel credential cannot authorize browser traffic", client.get(origin, headers={"Cookie": "__Host-WhyBuddyPreview=" + tunnel_token}).status_code == 403)
        denied = False
        try:
            with websocket_connect(origin.replace("https:", "wss:") + "/socket", origin=origin,
                    subprotocols=["whybuddy-private-ingress-smoke"], open_timeout=15, close_timeout=2):
                pass
        except InvalidStatus as exc:
            denied = exc.response.status_code == 403
        checked("anonymous WebSocket is rejected", denied)
        with websocket_connect(origin.replace("https:", "wss:") + "/socket", origin=origin,
                additional_headers={**headers, **management_headers}, subprotocols=["whybuddy-private-ingress-smoke"], open_timeout=20, close_timeout=3) as ws:
            observed = json.loads(ws.recv(timeout=20))
            checked("real WebSocket handshake and first application frame arrive", observed.get("marker") == identity)
            checked("WebSocket application cannot read management traffic or gateway grant", not any(
                hashlib.sha256(value.encode()).hexdigest() in observed.get("valueDigests", [])
                for value in (key, target.access_token, gateway_key, "Bearer " + gateway_key, browser_token, cookie, tunnel_token)))
            ws.send("outbound-roundtrip")
            checked("real bidirectional WebSocket messages", json.loads(ws.recv(timeout=20)) == {"type": "echo", "value": "outbound-roundtrip"})
            control = client.post(control_origin + "/control", headers=management_headers, json={"action": "revoke"})
            checked("trusted authority revokes the runtime", control.status_code == 200)
            closed = False
            try: ws.recv(timeout=10)
            except ConnectionClosed: closed = True
            checked("revocation closes the already-open browser WebSocket", closed)
        checked("revoked HTTP is rejected without stopping the app", client.get(origin, headers=headers).status_code == 403 and
            provider.is_process_running(handle, app.process_id))
        provider.stop(handle, tunnel.process_id)
        # A new generation and new credentials cannot revive the old browser grant.
        tunnel_token, browser_token, ticket = [secrets.token_urlsafe(32) for _ in range(3)]
        rotated = client.post(control_origin + "/control", headers=management_headers, json={"action": "rotate", "port": 5173,
            "ticket": ticket, "tunnelToken": tunnel_token, "browserToken": browser_token})
        checked("generation replacement rejects the old browser credential", rotated.status_code == 200 and client.get(origin, headers=headers).status_code == 403)
        deadline = time.monotonic() + 600
        while provider.is_process_running(handle, installed.process_id):
            if time.monotonic() > deadline: raise AssertionError("project_install_timeout")
            time.sleep(2)
        checked("fixed template installs from its lockfile", provider.process_result(handle, installed.process_id).exit_code == 0)
        host = httpx.URL(origin).host
        provider.start_process(handle, "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=" + shlex.quote(host) +
            " npm run dev -- --host 0.0.0.0 --port 5173 --strictPort", timeout_seconds=900)
        provider.start_preview_tunnel(handle, agent_source=source, relay_origin=origin,
            token=tunnel_token, port=5173, expires_at=expires_at)
        wait_http("/", {"Cookie": "__Host-WhyBuddyPreview=" + browser_token})
        chrome = os.getenv("SLIDERULE_CHROMIUM_PATH") or "C:/Program Files/Google/Chrome/Application/chrome.exe"
        if not Path(chrome).is_file(): raise AssertionError("local_chrome_missing")
        browser_config.write_text(json.dumps({"chrome": chrome, "entryUrl": origin + "/_whybuddy/authorize?ticket=" + ticket,
            "origin": origin, "directory": str(directory.resolve()), "projectId": config["binding"]["projectId"],
            "operationId": config["binding"]["operationId"], "runtimeId": config["binding"]["runtimeId"],
            "revision": config["binding"]["revision"],
            "expiresAt": datetime.fromtimestamp(expires_at, timezone.utc).isoformat()}), encoding="utf-8")
        browser_process = subprocess.Popen(["node", "scripts/project-preview-browser-smoke.mjs", str(browser_config)], cwd=ROOT)
        deadline = time.monotonic() + 100
        while not (directory / "browser-ready.json").exists():
            if browser_process.poll() is not None or time.monotonic() > deadline:
                raise AssertionError("browser_initial_preview_failed")
            time.sleep(0.5)
        provider.write_files(handle, {"src/style.css": files["src/style.css"] + "\n:root { --whybuddy-hmr-probe: updated; }\n"})
        deadline = time.monotonic() + 180
        ticket_sequence = 0
        while browser_process.poll() is None:
            if time.monotonic() > deadline: raise AssertionError("browser_hmr_timeout")
            request_path = directory / "browser-ticket-request.json"
            if request_path.exists():
                try:
                    requested = json.loads(request_path.read_text(encoding="utf-8")).get("seq")
                except json.JSONDecodeError:
                    requested = None
                if type(requested) is int and requested > ticket_sequence:
                    if requested != ticket_sequence + 1 or requested > 2:
                        raise AssertionError("browser_ticket_request_sequence_invalid")
                    next_ticket = secrets.token_urlsafe(32)
                    issued = client.post(control_origin + "/control", headers=management_headers,
                        json={"action": "ticket", "ticket": next_ticket})
                    if issued.status_code != 200:
                        raise AssertionError("browser_iframe_ticket_issue_failed")
                    # This temporary exchange file is never evidence. Only the
                    # Python supervisor holds the fixture administration key.
                    browser_ticket_temporary.write_text(json.dumps({"seq": requested, "ticket": {
                        **{key: config["binding"][key] for key in ("projectId", "operationId", "runtimeId", "revision")},
                        "entryUrl": origin + "/_whybuddy/authorize?ticket=" + next_ticket,
                        "ticketExpiresAt": datetime.fromtimestamp(min(int(time.time()) + 60, expires_at), timezone.utc).isoformat(),
                        "accessExpiresAt": datetime.fromtimestamp(expires_at, timezone.utc).isoformat()}}), encoding="utf-8")
                    browser_ticket_temporary.replace(browser_ticket_response)
                    ticket_sequence = requested
            time.sleep(0.5)
        browser_report = json.loads((directory / "browser-report.json").read_text(encoding="utf-8"))
        report["browser"] = browser_report
        checked("real Chrome preview HMR and actual SandboxPreviewSurface cross-site iframe", browser_process.returncode == 0 and browser_report["status"] == "passed")
        report["status"] = "passed"
    except Exception as exc:
        report.update(status="failed", error=type(exc).__name__)
        browser_result = directory / "browser-report.json"
        if browser_result.exists():
            report["browser"] = json.loads(browser_result.read_text(encoding="utf-8"))
        report["failureLocation"] = [{"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(exc.__traceback__)]
        if isinstance(exc, AssertionError): report["failedCheck"] = str(exc)
    finally:
        if browser_process is not None and browser_process.poll() is None:
            browser_process.terminate()
            try: browser_process.wait(timeout=10)
            except subprocess.TimeoutExpired: browser_process.kill(); browser_process.wait(timeout=10)
        browser_config.unlink(missing_ok=True)
        browser_ticket_response.unlink(missing_ok=True)
        browser_ticket_temporary.unlink(missing_ok=True)
        try:
            for sandbox in provider.find_workspaces(workspace_id=workspace):
                provider.destroy(sandbox)
                report["cleanup"].append({"role": "application", "sandboxId": sandbox.sandbox_id, "destroyed": True})
            checked("no application sandbox left after cleanup", not provider.find_workspaces(workspace_id=workspace))
        except Exception:
            report["status"] = "failed"; report["cleanup"].append({"role": "application", "destroyed": False})
        try:
            pages = Sandbox.list(query=SandboxQuery(metadata={"whybuddy_preview_smoke_id": identity}), api_key=key)
            while pages.has_next:
                for sandbox in pages.next_items():
                    Sandbox.kill(sandbox.sandbox_id, api_key=key)
                    report["cleanup"].append({"role": "trusted-relay", "sandboxId": sandbox.sandbox_id, "destroyed": True})
            pages = Sandbox.list(query=SandboxQuery(metadata={"whybuddy_preview_smoke_id": identity}), api_key=key)
            survivors = []
            while pages.has_next: survivors.extend(pages.next_items())
            checked("no trusted relay sandbox left after cleanup", not survivors)
        except Exception:
            report["status"] = "failed"; report["cleanup"].append({"role": "trusted-relay", "destroyed": False})
        persist()
    print(json.dumps({"status": report["status"], "report": str(directory / "report.json")}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/project-preview-tunnel-smoke")
    raise SystemExit(main(parser.parse_args().output))
