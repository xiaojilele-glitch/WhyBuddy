"""Trusted fixed-suite browser execution in a separate E2B sandbox.

2026-09-13 P4: local Chrome smoke files were developer evidence, not a durable
delivery authority. This provider never connects to the generated application's
sandbox or accepts model code. Only our bundled public-API Playwright runner and
a one-use, exact-origin preview ticket reach a new verification sandbox. E2B
management credentials stay in this host process. The SQL worker owns revision,
approval and lease checks; callback failure interrupts execution before cleanup.

The runner follows microsoft/playwright's Apache-2.0 public expect/context APIs,
not MCP Response.addAction (which only records code for display).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import logging
import os
from pathlib import Path
import re
import threading
import time
from typing import Callable
from urllib.parse import parse_qs, urlsplit

from config.settings import settings
from services.project_verification_gate import SUITE_ASSERTIONS

logger = logging.getLogger(__name__)

RUNNER_VERSION = "whybuddy-browser-v1:pw1.61.1"
SUITE_VERSION = "react-vite-counter@1"
ASSERTION_IDS = frozenset({"heading_visible", "counter_initial", "counter_increment",
    "counter_second_increment", "reload_reset", "no_page_errors", "no_failed_requests"})
COUNTER_EXPECTED = {"counter_initial": "0", "counter_increment": "1",
    "counter_second_increment": "2", "reload_reset": "0"}
# 跟 browser-runner.mjs 的 DETAIL_CODES 成对，改一处必须改两处（§4）。
DETAIL_CODES = frozenset({"timeout", "assertion", "error"})
# ⚠ 跟 browser-runner.mjs 的 OBSERVED / bounded() 成对（§4）。
#   2026-09-17 第二趟真机：reader_login 的 detail=assertion 只说明"值不对"，
#   拿到 writer（登录串号）和拿到 none（session 查不到人）分不开。
#   于是给 tasks 套件放开 expected/actual——但**只放我们自己产生**的短标记：
#   角色名和 HTTP 状态码，页面文本一个字都不许进。每个 id 能声明什么也钉死。
TASK_EXPECTED = {"writer_login": frozenset({"writer", "200"}),
    "reader_login": frozenset({"reader"}),
    "reader_api_session": frozenset({"reader"}),
    "reader_api_forbidden": frozenset({"403"}),
    "anonymous_api_forbidden": frozenset({"401"})}
_OBSERVED = re.compile(r"writer|reader|none|[1-5][0-9]{2}")


def _observation_is_bounded(item) -> bool:
    """失败断言带的 expected/actual 必须落在该 id 声明的封闭集合里。"""
    if item["status"] != "failed" or not isinstance(item["actual"], str):
        return False
    if item["id"] in COUNTER_EXPECTED:
        return (item["expected"] == COUNTER_EXPECTED[item["id"]]
                and (item["actual"] == "unexpected_value"
                     or re.fullmatch(r"-?[0-9]{1,16}", item["actual"]) is not None))
    allowed = TASK_EXPECTED.get(item["id"])
    if allowed is None:
        return False
    return (item["expected"] in allowed
            and (item["actual"] == "unexpected_value"
                 or _OBSERVED.fullmatch(item["actual"]) is not None))
_ASSERTION_SHAPES = ({"id", "status"}, {"id", "status", "detail"},
    {"id", "status", "detail", "expected", "actual"})
SUITE_ARTIFACTS = {SUITE_VERSION: frozenset({"before.png", "after.png"}),
    "react-vite-tasks@1": frozenset({"tasks-created.png", "tasks-reader.png"})}
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_RESULT_BYTES = 6 * 1024 * 1024
REMOTE_ROOT = "/home/user/whybuddy-browser"
METADATA_KIND = "whybuddy-project-verification-v1"
BUNDLE = Path(__file__).resolve().parents[2] / "server/project-verification/browser-runner.mjs"
ERROR_CODES = frozenset({"project_browser_not_configured", "project_browser_key_missing",
    "project_browser_unavailable", "project_browser_input_invalid", "project_browser_auth_failed",
    "project_browser_revision_mismatch", "project_browser_navigation_blocked", "project_browser_assertion_failed",
    "project_browser_artifact_too_large", "project_browser_output_invalid", "project_browser_timeout",
    "project_browser_execution_failed", "project_browser_cleanup_pending", "project_browser_interrupted"})


def _identifier(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value) is not None


def _empty(code, *, cleanup=True):
    return {"status": "blocked", "errorCode": code, "runnerVersion": RUNNER_VERSION,
        "assertions": [], "artifacts": {}, "cleanupConfirmed": cleanup}


def _input(entry_url, revision, suite_version, verification_id, scope):
    if (not _identifier(revision) or not _identifier(verification_id) or suite_version not in SUITE_ASSERTIONS
            or not isinstance(scope, dict) or set(scope) != {"origin", "projectId", "runtimeId"}
            or not _identifier(scope["projectId"]) or not _identifier(scope["runtimeId"])
            or not isinstance(entry_url, str) or len(entry_url) > 8192):
        raise ValueError("project_browser_input_invalid")
    try:
        origin, entry = urlsplit(scope["origin"]), urlsplit(entry_url)
        fields = parse_qs(entry.query, keep_blank_values=True)
        token = fields.get("ticket", [])
        if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
                or origin.path or origin.query or origin.fragment
                or scope["origin"] != f"https://{origin.netloc}"
                or entry.scheme != origin.scheme or entry.netloc != origin.netloc
                or entry.username or entry.password or entry.fragment
                or entry.path != "/_whybuddy/authorize" or set(fields) != {"ticket"}
                or len(token) != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{16,4096}", token[0])):
            raise ValueError()
        _ = entry.port
    except (ValueError, TypeError, AttributeError):
        raise ValueError("project_browser_input_invalid") from None
    return {"verificationId": verification_id, "revision": revision, "suiteVersion": suite_version,
        "scope": dict(scope), "entryUrl": entry_url}


def decode_result(raw: str, *, revision: str, verification_id: str, suite_version: str = SUITE_VERSION):
    """Only bounded, typed receipts reach the worker; prose/URLs/headers cannot."""
    try:
        required = SUITE_ASSERTIONS[suite_version]
        artifact_names = SUITE_ARTIFACTS[suite_version]
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_RESULT_BYTES:
            raise ValueError()
        value = json.loads(raw)
        keys = {"verificationId", "revision", "suiteVersion", "runnerVersion", "status", "errorCode",
            "assertions", "artifacts", "cleanupConfirmed", "revisionBefore", "revisionAfter"}
        if (not isinstance(value, dict) or set(value) != keys or value["verificationId"] != verification_id
                or value["revision"] != revision or value["suiteVersion"] != suite_version
                or value["runnerVersion"] != RUNNER_VERSION or value["status"] not in {"passed", "failed", "blocked"}
                or value["errorCode"] not in ERROR_CODES | {None} or type(value["cleanupConfirmed"]) is not bool
                or not isinstance(value["assertions"], list) or len(value["assertions"]) > len(required)):
            raise ValueError()
        seen = set()
        for item in value["assertions"]:
            if (not isinstance(item, dict) or set(item) not in _ASSERTION_SHAPES or item["id"] not in required
                    or item["id"] in seen or item["status"] not in {"passed", "failed", "not_run"}):
                raise ValueError()
            # detail 与 failed 互为充要：失败必须带上归因，passed / not_run 不许带。
            # 产出侧 classify() 永远给得出一个值，所以"失败但没 detail"只能是收据被改过。
            if ("detail" in item) != (item["status"] == "failed") or item.get("detail", "timeout") not in DETAIL_CODES:
                raise ValueError()
            if "expected" in item and not _observation_is_bounded(item):
                raise ValueError()
            seen.add(item["id"])
        # ⚠ 反向判据（§3）：跑出结论的收据必须**报满整张名单**。
        #   2026-09-17 生产那趟收据只有 10 条、名单 13 条，少掉的三条是被全局超时切的，
        #   而收据里"被切掉"和"这套本来就更短"完全同形——闸红了却查不出是哪种。
        #   现在少一条就是 output_invalid。blocked 例外：那是连套件都没起来。
        if value["status"] in {"passed", "failed"} and seen != required:
            raise ValueError()
        source = value["artifacts"]
        if not isinstance(source, dict) or not set(source) <= artifact_names:
            raise ValueError()
        artifacts = {}
        for name, encoded in source.items():
            if not isinstance(encoded, str) or len(encoded) > (MAX_IMAGE_BYTES + 2) // 3 * 4:
                raise ValueError()
            data = base64.b64decode(encoded, validate=True)
            if len(data) > MAX_IMAGE_BYTES or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError()
            artifacts[name] = data
        if value["status"] == "passed" and (seen != required or set(artifacts) != artifact_names
                or value["errorCode"] is not None or value["cleanupConfirmed"] is not True
                or value["revisionBefore"] != revision or value["revisionAfter"] != revision
                or any(item["status"] != "passed" for item in value["assertions"])):
            raise ValueError()
        if value["status"] == "failed" and not any(item["status"] == "failed" for item in value["assertions"]):
            raise ValueError()
        if value["status"] != "passed" and value["errorCode"] is None:
            raise ValueError()
        return {"status": value["status"], "errorCode": value["errorCode"], "runnerVersion": RUNNER_VERSION,
            "assertions": value["assertions"], "artifacts": artifacts, "cleanupConfirmed": value["cleanupConfirmed"]}
    except (ValueError, TypeError, KeyError):
        return _empty("project_browser_output_invalid", cleanup=False)


class E2BProjectBrowserProvider:
    def __init__(self, *, template: str | None = None, api_key: str | None = None,
                 timeout_seconds: float | None = None, bundle_path: Path = BUNDLE, sandbox_class=None):
        self.template = str(template if template is not None else getattr(settings, "WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "") or "").strip()
        self._api_key = (api_key if api_key is not None else
            getattr(settings, "E2B_API_KEY", "") or os.getenv("E2B_API_KEY", "")).strip()
        timeout_seconds = timeout_seconds if timeout_seconds is not None else getattr(settings, "WHYBUDDY_PROJECT_BROWSER_TIMEOUT_SECONDS", 120)
        if type(timeout_seconds) not in (int, float) or not 10 <= timeout_seconds <= 300:
            raise ValueError("project_browser_input_invalid")
        self.timeout_seconds, self.bundle_path, self._sandbox_class = timeout_seconds, Path(bundle_path), sandbox_class

    def availability_error(self):
        """Local capability check only; never create, connect or call the cloud."""
        if not self.template:
            return "project_browser_not_configured"
        if not self._api_key:
            return "project_browser_key_missing"
        if not self.bundle_path.is_file() or (self._sandbox_class is None and importlib.util.find_spec("e2b") is None):
            return "project_browser_unavailable"
        return None

    def _sdk(self):
        if self._sandbox_class is not None:
            return self._sandbox_class
        from e2b import Sandbox
        return Sandbox

    @staticmethod
    def _metadata(verification_id):
        return {"whybuddy_kind": METADATA_KIND, "whybuddy_verification_id": verification_id}

    def _discover(self, verification_id):
        from e2b import SandboxQuery
        metadata = self._metadata(verification_id)
        pages = self._sdk().list(query=SandboxQuery(metadata=metadata), limit=100,
            api_key=self._api_key, request_timeout=10)
        found = set()
        while pages.has_next:
            for item in pages.next_items():
                actual = getattr(item, "metadata", None)
                identity = getattr(item, "sandbox_id", None)
                if not isinstance(actual, dict) or any(actual.get(key) != value for key, value in metadata.items()) or not _identifier(identity):
                    raise ValueError("project_browser_cleanup_pending")
                found.add(identity)
        return found

    def cleanup(self, verification_id, check_callback: Callable[[], None] | None = None):
        """Destroy only this verification's resources; no reconnect or replay."""
        return self._cleanup(verification_id, check_callback)[0]

    def _cleanup(self, verification_id, check_callback=None):
        observed = False
        if not _identifier(verification_id) or not self._api_key:
            return False, observed
        stage = "cleanup_authority"
        try:
            for _ in range(3):
                if check_callback:
                    check_callback()
                stage = "cleanup_discover"
                found = self._discover(verification_id)
                observed = observed or bool(found)
                for sandbox_id in found:
                    if check_callback:
                        check_callback()
                    stage = "cleanup_kill"
                    self._sdk().kill(sandbox_id, api_key=self._api_key, request_timeout=10)
                stage = "cleanup_confirm"
                if not self._discover(verification_id):
                    return True, observed
            return False, observed
        except Exception as exc:
            logger.warning("project browser stage=%s exception=%s", stage, type(exc).__name__)
            return False, observed

    def run(self, *, entry_url, revision, suite_version, verification_id, scope,
            check_callback: Callable[[], None]):
        missing = self.availability_error()
        if missing:
            return _empty(missing)
        try:
            job = _input(entry_url, revision, suite_version, verification_id, scope)
        except ValueError:
            return _empty("project_browser_input_invalid")
        result, sandbox, handle, thread = _empty("project_browser_execution_failed"), None, None, None
        create_attempted = False
        finished, overflow = threading.Event(), threading.Event()
        outcome, output_size = {}, [0]
        control_error = None
        stage = "initial_authority"
        deadline = time.monotonic() + self.timeout_seconds
        def check():
            nonlocal control_error
            try:
                check_callback()
            except Exception as rejected:
                control_error = rejected
                raise
        try:
            check()
            # A second invocation cannot adopt a previous browser or repeat clicks.
            stage = "discover"
            if self._discover(verification_id):
                result = _empty("project_browser_interrupted")
            else:
                from e2b import ALL_TRAFFIC
                create_attempted = True
                stage = "create"
                # 2026-09-13 real E2B returned 400 for allow_out domains without
                # a deny-all CIDR. ALL_TRAFFIC is an SDK constant whose wire
                # value is 0.0.0.0/0; the literal name also gets rejected. Keep
                # the independent contract test pinned to the real CIDR value.
                sandbox = self._sdk().create(template=self.template, timeout=int(self.timeout_seconds + 60),
                    metadata=self._metadata(verification_id), network={"allow_public_traffic": False,
                        "allow_out": [urlsplit(scope["origin"]).hostname], "deny_out": [ALL_TRAFFIC]},
                    api_key=self._api_key, request_timeout=20)
                stage = "post_create_authority"
                check()
                if not _identifier(getattr(sandbox, "sandbox_id", None)):
                    raise ValueError("project_browser_execution_failed")
                # The template owns dependencies; never npm-install or read files
                # from the generated project. No manager key enters envs or files.
                stage = "bundle_upload"
                sandbox.files.write(REMOTE_ROOT + "/browser-runner.mjs", self.bundle_path.read_text(encoding="utf-8"), request_timeout=20)
                stage = "job_upload"
                sandbox.files.write(REMOTE_ROOT + "/job.json", json.dumps(job), request_timeout=20)
                stage = "pre_execution_authority"
                check()
                stage = "execute"
                handle = sandbox.commands.run("node " + REMOTE_ROOT + "/browser-runner.mjs " + REMOTE_ROOT + "/job.json",
                    cwd=REMOTE_ROOT, envs={"NODE_ENV": "production", "NODE_OPTIONS": "", "NODE_PATH": "",
                        "PLAYWRIGHT_BROWSERS_PATH": "/ms-playwright"}, background=True,
                    timeout=max(1, int(deadline - time.monotonic())), request_timeout=20)
                if type(getattr(handle, "pid", None)) is not int or handle.pid <= 0:
                    raise ValueError("project_browser_execution_failed")

                def count_output(text):
                    output_size[0] += len(text.encode("utf-8"))
                    if output_size[0] > MAX_RESULT_BYTES:
                        overflow.set()

                def wait_result():
                    try:
                        outcome["value"] = handle.wait(on_stdout=count_output, on_stderr=count_output)
                    except Exception as exc:
                        logger.warning("project browser stage=wait exception=%s", type(exc).__name__)
                        outcome["failed"] = True
                    finally:
                        finished.set()

                thread = threading.Thread(target=wait_result, name="project-browser-result", daemon=True)
                thread.start()
                stage = "wait"
                while not finished.wait(0.2):
                    check()
                    if overflow.is_set() or time.monotonic() >= deadline:
                        break
                stage = "final_authority"
                check()
                if overflow.is_set():
                    result = _empty("project_browser_output_invalid")
                elif time.monotonic() >= deadline:
                    result = _empty("project_browser_timeout")
                elif "value" in outcome and getattr(outcome["value"], "exit_code", None) == 0:
                    stage = "decode_receipt"
                    result = decode_result(outcome["value"].stdout, revision=revision, verification_id=verification_id,
                        suite_version=suite_version)
        except Exception as exc:
            logger.warning("project browser stage=%s exception=%s", stage, type(exc).__name__)
            # A callback may reject only once (lease ownership can change again).
            # Preserve that rejection; a second successful check must not erase it.
            result = _empty("project_browser_interrupted" if control_error is not None else "project_browser_execution_failed")
        finally:
            if handle is not None:
                try:
                    handle.kill()  # real SIGKILL, not cancellation of a Python waiter
                except Exception:
                    pass  # sandbox destruction below is the final process fence
            # Capture a known handle even when metadata listing is delayed.
            known_clean = True
            if sandbox is not None:
                try:
                    sandbox.kill(request_timeout=10)
                except Exception:
                    known_clean = False
            clean, observed = self._cleanup(verification_id)
            if thread is not None:
                thread.join(timeout=2)
                if thread.is_alive():
                    try:
                        handle.disconnect()
                    except Exception:
                        pass
                    thread.join(timeout=1)
            # A lost create response plus an empty discovery cannot prove that
            # a late provider create will never appear. Keep cleanup pending for
            # the worker's recovery reconciler; provider TTL remains bounded.
            if create_attempted and sandbox is None and not observed:
                clean = False
            # Invalid runner output is not evidence, but cannot keep a fully
            # destroyed verifier in an endless cleanup-pending recovery loop.
            result["cleanupConfirmed"] = bool(clean and known_clean and (thread is None or not thread.is_alive()))
            if not result["cleanupConfirmed"]:
                result["status"], result["errorCode"] = "blocked", "project_browser_cleanup_pending"
        if control_error is not None and result["cleanupConfirmed"]:
            raise control_error
        return result
