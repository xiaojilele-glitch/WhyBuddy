"""Real app lifespan, SQL authority, private E2B runtime and full Web workbench.

Uses a trusted service sandbox separate from the generated project. Local
databases and .env files are not packaged; only the trusted service receives
the explicitly required management credentials. One exact E2B TLS hostname is
used as the initial opaque runtime ID; production origin checks stay enabled.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import signal
import socket
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))


def start_local_process(arguments, **kwargs):
    """Own a process group; timeout cleanup must include Node's Chrome children."""
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(arguments, **kwargs)


def stop_local_process_tree(process):
    if process is None:
        return
    if os.name == "nt":
        if process.poll() is None:
            # Same PID-bounded policy as mission-smoke-shared.mjs/dev-all.mjs.
            # Terminating Node alone bypasses its finally and strands Chrome.
            result = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode and process.poll() is None:
                raise RuntimeError("product_smoke_local_process_cleanup_failed")
        process.wait(timeout=10)
    else:
        # start_local_process established this isolated group, so no existing
        # user browser or developer service can be in the kill target.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=10)


def cleanup_trusted_service(sandbox_class, query_class, *, api_key, identity, trusted):
    """Recover a create whose remote allocation succeeded but response was lost."""
    if trusted is not None:
        try:
            trusted.kill()
        except Exception:
            pass  # Reconcile exact metadata below, including an uncertain kill.
    selector = query_class(metadata={"whybuddy_product_smoke": identity})
    pages = sandbox_class.list(api_key=api_key, query=selector)
    discovered = []
    while pages.has_next:
        for item in pages.next_items():
            if (not isinstance(item.metadata, dict)
                    or item.metadata.get("whybuddy_product_smoke") != identity
                    or not isinstance(item.sandbox_id, str) or not item.sandbox_id):
                raise RuntimeError("product_smoke_cleanup_identity_mismatch")
            discovered.append(item.sandbox_id)
    for sandbox_id in discovered:
        sandbox_class.kill(sandbox_id, api_key=api_key)
    remaining = sandbox_class.list(api_key=api_key, query=selector)
    return not remaining.next_items() and not remaining.has_next


def source_archive(*, include_preview: bool = True) -> bytes:
    """Explicit code/template allowlist, including new implementation leaves.

    Ignored files, secrets and mutable application/session data are never selected.
    """
    paths = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "slide-rule-python", "project-templates/react-vite", "project-templates/react-vite-tasks"],
        cwd=ROOT, check=True, capture_output=True).stdout.decode().split("\0")
    selected = [path for path in paths if path and (
        (path.startswith("slide-rule-python/") and path.endswith(".py") and "/tests/" not in path)
        or path.startswith("slide-rule-python/services/data/")
        or path == "slide-rule-python/requirements.txt" or path.startswith("project-templates/react-vite/")
        or path.startswith("project-templates/react-vite-tasks/"))]
    selected += ["scripts/fixtures/project-product-backend.py", "server/project-verification/browser-runner.mjs"]
    if include_preview:
        selected += ["dist/project-preview/gateway.cjs", "dist/project-preview/agent.cjs", "dist/project-preview/ws-LICENSE.txt"]
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name in sorted(set(selected)):
            path = ROOT / name
            if path.is_symlink() or not path.is_file():
                raise RuntimeError("product_smoke_source_not_regular")
            archive.add(path, arcname=name, recursive=False)
    return stream.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--without-key", action="store_true")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--browser-template", default="", help="Run the independent browser pass/fail/repair scenario with this trusted E2B template")
    parser.add_argument("--verify-browser", action="store_true", help="Require the independent browser capability; never fall back to preview-only smoke")
    parser.add_argument("--tasks", action="store_true", help="Run the real tasks business/data/rebuild/source/delivery scenario")
    args = parser.parse_args()
    if args.tasks:
        args.verify_browser = True
    if not 180 <= args.timeout <= 1200:
        parser.error("timeout must be 180..1200 seconds")
    from dotenv import dotenv_values
    import httpx
    from e2b import SandboxQuery
    from e2b_code_interpreter import Sandbox
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.project_browser_provider import E2BProjectBrowserProvider

    if args.verify_browser and not args.browser_template:
        args.browser_template = os.getenv("WHYBUDDY_PROJECT_BROWSER_TEMPLATE") or dotenv_values(ROOT / ".env").get("WHYBUDDY_PROJECT_BROWSER_TEMPLATE") or ""

    identity = uuid.uuid4().hex
    directory = ROOT / "artifacts/project-product" / f"{int(time.time())}-{identity[:8]}"
    directory.mkdir(parents=True)
    key = None if args.without_key else os.getenv("E2B_API_KEY") or dotenv_values(ROOT / ".env").get("E2B_API_KEY")
    report = {"schemaVersion": 1, "status": "running", "stage": "preflight", "checks": [], "cleanup": [],
        "fixtures": ["isolated accounts and approved session", "one initial runtime ID matching trusted E2B TLS host", "source edit intent"],
        "notCovered": ["model selects tools in this scenario", "production DNS and deployment", "P4 independent verification worker", "business database and acceptance"]}
    if args.browser_template:
        report["notCovered"].remove("P4 independent verification worker")
        report["notCovered"].append("arbitrary business verification suites")
        report["fixtures"].append("counter break and repair intent")
        report["browserTemplate"] = args.browser_template
    if args.tasks:
        report["notCovered"].remove("business database and acceptance")
        report["fixtures"] = ["isolated accounts and approved tasks session", "two opaque runtime IDs matching separate trusted TLS gateway ports", "source failure and repair intent"]
        report["template"] = "react-vite-tasks"
    def persist():
        (directory / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    def check(name, passed):
        report["checks"].append({"name": name, "passed": bool(passed)})
        persist()
        print(("PASS " if passed else "FAIL ") + name, flush=True)
        if not passed:
            raise RuntimeError(name)
    if not key:
        report.update(status="blocked", error="e2b_api_key_missing")
        persist()
        print(f"BLOCKED e2b_api_key_missing; report: {directory / 'report.json'}")
        return 2
    if args.verify_browser and not args.browser_template:
        report.update(status="blocked", error="project_browser_not_configured")
        persist()
        print(f"BLOCKED project_browser_not_configured; report: {directory / 'report.json'}")
        return 2
    provider = E2BWorkspaceProvider(api_key=key)
    trusted = vite = browser = None
    trusted_requested = False
    project_id = operation_id = None
    verification_ids = set()
    config_path = directory / "browser-config.json"
    log_handles = []
    deadline = time.monotonic() + args.timeout
    fixture_key, gateway_key, password = (secrets.token_urlsafe(32) for _ in range(3))
    fixture_headers = {"Authorization": "Bearer " + fixture_key}
    client = httpx.Client(timeout=30, trust_env=False, follow_redirects=False)
    def wait_for(callback, seconds=90):
        until = min(deadline, time.monotonic() + seconds)
        while time.monotonic() < until:
            try:
                value = callback()
                if value:
                    return value
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        raise RuntimeError("product_smoke_wait_timeout")
    try:
        report["repositoryHead"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
            capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(["node", "scripts/build-project-preview.mjs"], cwd=ROOT, check=True)
        archive = source_archive()
        report["uploadedSourceSha256"] = hashlib.sha256(archive).hexdigest()
        report["stage"] = "trusted_service_setup"
        persist()
        trusted_requested = True
        trusted = Sandbox.create(api_key=key, timeout=args.timeout + 120,
            network={"allow_public_traffic": True}, metadata={"whybuddy_product_smoke": identity})
        preview_origin = "https://" + trusted.get_host(5190)
        authority_origin = "https://" + trusted.get_host(5192)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        workbench = "http://127.0.0.1:" + str(port)
        report["trustedSandboxId"] = trusted.sandbox_id
        config = {"fixtureKey": fixture_key, "password": password,
            "ownerEmail": "owner-" + identity + "@example.invalid", "strangerEmail": "other-" + identity + "@example.invalid",
            "runtimeId": trusted.get_host(5190).split(".")[0], "sessionId": "product-smoke-" + identity,
            "title": "WhyBuddy integrated project " + identity[:8], "environment": {
                "NODE_ENV": "development", "PYTHONUNBUFFERED": "1", "E2B_API_KEY": key, "LLM_API_KEY": "",
                "APP_STORE_DATABASE_URL": "sqlite:////home/user/whybuddy/smoke.db",
                "APP_STORE_HTTP_API_URL": "", "APP_STORE_HTTP_API_KEY": "", "APP_STORE_NEON_HTTP": "0",
                "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "SLIDERULE_WEB_SEARCH": "off",
                "SLIDERULE_AUTH_SECRET": secrets.token_hex(32), "SLIDE_RULE_INTERNAL_KEY": secrets.token_hex(32),
                "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "SLIDERULE_PROJECT_MAX_WORKERS": "1",
                "SLIDERULE_PROJECT_LIFETIME_SECONDS": "900" if args.browser_template else "600", "SLIDERULE_PROJECT_IDLE_SECONDS": "300",
                "SLIDERULE_PROJECT_POLL_SECONDS": "1", "SLIDERULE_PROJECT_INSTALL_SECONDS": "180",
                "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY": gateway_key,
                "WHYBUDDY_PROJECT_BROWSER_TEMPLATE": args.browser_template,
                "WHYBUDDY_PROJECT_BROWSER_TIMEOUT_SECONDS": "120",
                "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE": "https://{runtimeId}.e2b.app",
                "WHYBUDDY_PROJECT_PREVIEW_AGENT_BUNDLE": "/home/user/whybuddy/dist/project-preview/agent.cjs"}}
        if args.tasks:
            config["runtimeIds"] = [trusted.get_host(port).split(".")[0] for port in (5190, 5191)]
            config["environment"]["SLIDERULE_PROJECT_LIFETIME_SECONDS"] = str(args.timeout)
        trusted.files.write("/home/user/whybuddy-source.tar.gz", archive)
        trusted.files.write("/home/user/whybuddy-config.json", json.dumps(config))
        # The archive contains only explicit repository-relative paths selected above.
        trusted.commands.run("mkdir -p /home/user/whybuddy && tar -xzf /home/user/whybuddy-source.tar.gz -C /home/user/whybuddy", timeout=30)
        installed = trusted.commands.run("python -m pip install -q -r /home/user/whybuddy/slide-rule-python/requirements.txt > /home/user/install.log 2>&1", timeout=180)
        check("trusted service dependencies installed", installed.exit_code == 0)
        trusted.commands.run("cd /home/user/whybuddy && python -u scripts/fixtures/project-product-backend.py /home/user/whybuddy-config.json > /home/user/backend.log 2>&1",
            background=True, timeout=args.timeout)
        gateway_environment = {"WHYBUDDY_PROJECT_PREVIEW_AUTHORITY_URL": "http://127.0.0.1:5192/api/sliderule/internal/project-preview",
            "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY": gateway_key, "WHYBUDDY_PROJECT_PREVIEW_PORT": "5190",
            "WHYBUDDY_PROJECT_WORKBENCH_ORIGIN": workbench}
        trusted.commands.run("node /home/user/whybuddy/dist/project-preview/gateway.cjs > /home/user/gateway.log 2>&1",
            envs=gateway_environment, background=True, timeout=args.timeout)
        if args.tasks:
            trusted.commands.run("node /home/user/whybuddy/dist/project-preview/gateway.cjs > /home/user/gateway-second.log 2>&1",
                envs={**gateway_environment, "WHYBUDDY_PROJECT_PREVIEW_PORT": "5191"}, background=True, timeout=args.timeout)
        def state():
            response = client.get(authority_origin + "/_smoke/state", headers=fixture_headers)
            return response.json() if response.status_code == 200 else None
        initial = wait_for(state, 90)
        check("actual app lifespan composes persistent control worker and preview authority", all(initial["composition"].values()))
        check("fixture control cannot be accessed without its separate secret", client.get(authority_origin + "/_smoke/state").status_code == 403)
        # Login tokens are generated and checked by the actual account service.
        logged = client.post(authority_origin + "/api/sliderule/account/login", json={"email": config["ownerEmail"], "password": password})
        check("actual account login succeeds", logged.status_code == 200)
        auth_headers = {"Authorization": "Bearer " + logged.json()["token"]}
        client.cookies.clear()
        created = client.post(authority_origin + "/api/sliderule/sessions/" + config["sessionId"] + "/project",
            headers=auth_headers, json={"approvalRef": initial["approvalRef"], **({"templateId": "react-vite-tasks"} if args.tasks else {})})
        check("HTTP project creation uses approved persisted session", created.status_code == 201)
        project = created.json()["project"]
        project_id = project["projectId"]
        started = client.post(authority_origin + "/api/sliderule/projects/" + project_id + "/runtime/start", headers=auth_headers,
            json={"expectedRevision": project["currentRevision"], "approvalRef": initial["approvalRef"], "idempotencyKey": "product-smoke-start"})
        check("HTTP runtime start returns durable operation", started.status_code == 202)
        operation_id = started.json()["operation"]["operationId"]
        report.update(stage="runtime_startup", projectId=project_id, operationId=operation_id)
        persist()
        def ready():
            value = state()
            if not value:
                return None
            op = next(item for item in value["operations"] if item["operationId"] == operation_id)
            if op["status"] in ("failed", "cancelled", "completed"):
                report["runtimeErrorCode"] = (op.get("result") or {}).get("errorCode")
                raise RuntimeError("product_smoke_runtime_not_ready")
            return value if (op.get("runtime") or {}).get("status") == "ready" else None
        running = wait_for(ready, 240)
        first = next(op for op in running["operations"] if op["operationId"] == operation_id)
        report["applicationSandboxId"] = running["lease"]["sandboxId"]
        check("app sandbox is isolated from trusted authority and gateway", running["lease"]["sandboxId"] != trusted.sandbox_id)
        check("runtime identity fixture is consumed only once", running["runtimeIdFixtureCalls"] == 1)
        check("public app ingress denies unauthenticated access", client.get("https://5173-" + running["lease"]["sandboxId"] + ".e2b.app/").status_code in (401, 403))
        check("preview gateway denies access without its browser grant", client.get(preview_origin + "/").status_code == 403)
        # Run the real Vite config on a fresh loopback port. No existing dev
        # service is stopped and no auth/API response is intercepted in Chrome.
        vite_log = (directory / "vite.log").open("w", encoding="utf-8")
        log_handles.append(vite_log)
        vite = start_local_process(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"], cwd=ROOT,
            env={**os.environ, "PYTHON_API_TARGET": authority_origin,
                "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE": config["environment"]["WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE"]},
            stdout=vite_log, stderr=subprocess.STDOUT)
        wait_for(lambda: client.get(workbench).status_code == 200, 60)
        config_path.write_text(json.dumps({"directory": str(directory), "workbench": workbench,
            "authority": authority_origin, "previewOrigin": preview_origin, "fixtureKey": fixture_key,
            "ownerEmail": config["ownerEmail"], "strangerEmail": config["strangerEmail"], "password": password,
            "sessionId": config["sessionId"], "projectId": project_id, "operationId": operation_id,
            "initialRevision": project["currentRevision"], "title": config["title"],
            "verifyBrowser": bool(args.browser_template), "approvalRef": initial["approvalRef"],
            "initialSandboxId": running["lease"]["sandboxId"],
            "secondPreviewOrigin": "https://" + trusted.get_host(5191) if args.tasks else None}), encoding="utf-8")
        report["stage"] = "full_workbench_browser"
        persist()
        browser_log = (directory / "browser.log").open("w", encoding="utf-8")
        log_handles.append(browser_log)
        browser_script = "scripts/project-tasks-browser-smoke.mjs" if args.tasks else "scripts/project-product-browser-smoke.mjs"
        browser = start_local_process(["node", browser_script, str(config_path)], cwd=ROOT,
            stdout=browser_log, stderr=subprocess.STDOUT)
        while browser.poll() is None and time.monotonic() < deadline:
            time.sleep(0.5)
        if browser.poll() is None:
            raise RuntimeError("product_browser_timeout")
        result_file = directory / "browser-report.json"
        if result_file.exists():
            report["browser"] = json.loads(result_file.read_text(encoding="utf-8"))
        check("full workbench browser checks pass", browser.returncode == 0 and report.get("browser", {}).get("status") == "passed")
        updated = state()
        parent = next(op for op in updated["operations"] if op["operationId"] == operation_id)
        children = [op for op in updated["operations"] if op["kind"] == "runtime.patch"]
        check("source edits synchronize under the original runtime", len(children) == (3 if args.browser_template else 1)
            and all(child["status"] == "completed" and child["result"].get("synchronized") is True for child in children)
            and parent["expectedRevision"] == first["expectedRevision"]
            and parent["runtime"]["runtimeId"] == first["runtime"]["runtimeId"])
        if args.tasks:
            operation_id = report["browser"]["restartedOperationId"]
            preview_origin = "https://" + trusted.get_host(5191)
            check("new runtime has a distinct managed identity after source and database restoration", updated["runtimeIdFixtureCalls"] == 2
                and report["browser"]["restartedSandboxId"] != report["applicationSandboxId"])
        report["stage"] = "account_revocation"
        ticket = client.post(authority_origin + "/api/sliderule/project-operations/" + operation_id + "/preview-ticket", headers=auth_headers)
        check("owner receives final live revision ticket", ticket.status_code == 200)
        redeemed = client.get(ticket.json()["entryUrl"])
        check("real gateway redeems final ticket through Python authority", redeemed.status_code == 303)
        check("issued grant accesses the live application", client.get(preview_origin + "/").status_code == 200)
        revoked = client.post(authority_origin + "/_smoke/revoke-owner", headers=fixture_headers)
        check("owner project qualification is revoked in actual identity store", revoked.status_code == 200)
        check("existing browser grant stops working after owner loses qualification", client.get(preview_origin + "/").status_code == 403)
        def cleaned():
            value = state()
            if not value:
                return None
            op = next(item for item in value["operations"] if item["operationId"] == operation_id)
            return value if op["status"] in ("failed", "cancelled", "completed") and not (value.get("lease") or {}).get("sandboxId") else None
        ended = wait_for(cleaned, 60)
        check("runtime worker stops and destroys app after owner qualification is revoked",
            not provider.find_workspaces(workspace_id="ws-" + project_id)
            and not (ended.get("lease") or {}).get("sandboxId"))
        report["status"] = "passed"
    except Exception as exc:
        # Provider errors can contain signed URLs or headers. Persist only the
        # known local assertion vocabulary and exception class.
        known = str(exc).startswith("product_smoke_") or any(item["name"] == str(exc) for item in report["checks"])
        report.update(status="failed", error=str(exc) if known else type(exc).__name__)
        print("FAIL " + report["error"], flush=True)
    finally:
        if project_id and report["status"] != "passed":
            try:
                observed = state()
                report["lastRuntimeStates"] = [{"kind": item["kind"], "status": item["status"],
                    "runtimeStatus": (item.get("runtime") or {}).get("status"),
                    "runtimeErrorCode": (item.get("runtime") or {}).get("errorCode"),
                    "resultErrorCode": (item.get("result") or {}).get("errorCode"),
                    "previewPhase": (item.get("result") or {}).get("preview", {}).get("phase")}
                    for item in observed["operations"]]
            except Exception:
                report["lastRuntimeStatesUnavailable"] = True
        for process in (browser, vite):
            try:
                stop_local_process_tree(process)
            except Exception:
                report["status"] = "failed"
                report["cleanup"].append({"resource": "local_process_tree", "confirmedEmpty": False})
        try:
            config_path.unlink(missing_ok=True)
        except OSError:
            report["status"] = "failed"
            report["cleanup"].append({"resource": "browser_fixture_credentials", "confirmedEmpty": False})
        for handle in log_handles:
            handle.close()
        # Stop via the real owner command first; verify provider inventory even
        # if the authority crashed or permissions were revoked during a check.
        if operation_id:
            try:
                client.post(authority_origin + "/api/sliderule/project-operations/" + operation_id + "/cancel", headers=auth_headers)
            except Exception:
                pass
        if project_id and args.browser_template:
            try:
                observed = state()
                verification_ids.update(op["operationId"] for op in observed["operations"] if op["kind"] == "runtime.verify")
                verifier = E2BProjectBrowserProvider(api_key=key, template=args.browser_template)
                empty = all([verifier.cleanup(identity) for identity in sorted(verification_ids)])
                report["cleanup"].append({"resource": "independent_browsers", "operationIds": sorted(verification_ids), "confirmedEmpty": empty})
                if not empty:
                    report["status"] = "failed"
            except Exception:
                report["cleanup"].append({"resource": "independent_browsers", "confirmedEmpty": False})
                report["status"] = "failed"
        if project_id:
            try:
                for handle in provider.find_workspaces(workspace_id="ws-" + project_id):
                    provider.destroy(handle)
                empty = not provider.find_workspaces(workspace_id="ws-" + project_id)
                report["cleanup"].append({"resource": "application", "confirmedEmpty": empty})
                if not empty:
                    report["status"] = "failed"
            except Exception:
                report["cleanup"].append({"resource": "application", "confirmedEmpty": False})
                report["status"] = "failed"
        if trusted is not None:
            if report["status"] != "passed":
                for name in ("backend", "gateway", "install"):
                    try:
                        log = trusted.files.read("/home/user/" + name + ".log")[-20000:]
                        for secret in (key, fixture_key, gateway_key, password):
                            log = log.replace(secret, "[redacted]")
                        log = re.sub(r"https?://[^\s\"']+", "[url]", log)
                        log = re.sub(r"eyJ[A-Za-z0-9_.-]+", "[token]", log)
                        (directory / (name + ".log")).write_text(log, encoding="utf-8")
                    except Exception:
                        pass
        if trusted_requested:
            try:
                empty = cleanup_trusted_service(Sandbox, SandboxQuery, api_key=key, identity=identity, trusted=trusted)
                report["cleanup"].append({"resource": "trusted_service", "confirmedEmpty": empty})
                if not empty:
                    report["status"] = "failed"
            except Exception:
                report["cleanup"].append({"resource": "trusted_service", "confirmedEmpty": False})
                report["status"] = "failed"
        client.close()
        persist()
        print(f"Report: {directory / 'report.json'}", flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
