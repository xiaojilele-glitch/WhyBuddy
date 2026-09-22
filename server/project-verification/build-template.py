"""Explicit cloud build of the private-use verifier image; no local Docker.

Only this directory's three named files are uploaded. Running the ordinary
provider never builds a template. Use --name deliberately after reviewing this
fixed image, dependency lock and build resource allocation.
"""
import argparse
import json
import os
from pathlib import Path
import re
import time

ROOT = Path(__file__).resolve().parent
BASE_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-noble"
REMOTE_ROOT = "/home/user/whybuddy-browser"


def make_template():
    from e2b import Template
    return (Template(file_context_path=ROOT).from_image(BASE_IMAGE)
        .set_user("root")
        .run_cmd("id -u user >/dev/null 2>&1 || useradd --create-home --shell /bin/bash user")
        .run_cmd("mkdir -p " + REMOTE_ROOT + " && chown user:user " + REMOTE_ROOT)
        .copy(["package.json", "package-lock.json", "browser-runner.mjs"], REMOTE_ROOT + "/", user="user", mode=0o600)
        .set_workdir(REMOTE_ROOT)
        .run_cmd("npm ci --omit=dev --ignore-scripts --no-audit --no-fund")
        .set_envs({"PLAYWRIGHT_BROWSERS_PATH": "/ms-playwright", "NODE_ENV": "production"})
        .set_user("user")
        .run_cmd("node -e \"require('@playwright/test').chromium.launch({headless:true,chromiumSandbox:true}).then(b=>b.close())\""))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True, help="dedicated E2B verifier template name or name:tag")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--report", type=Path, help="write sanitized build evidence")
    args = parser.parse_args()
    if not 60 <= args.timeout_seconds <= 1800:
        parser.error("--timeout-seconds must be between 60 and 1800")
    key = os.environ.get("E2B_API_KEY", "").strip()
    if not key:
        parser.error("E2B_API_KEY is required in the process environment")
    from e2b import Template
    evidence = {"name": args.name, "baseImage": BASE_IMAGE,
        "runnerVersion": "whybuddy-browser-v1:pw1.61.1", "status": "starting", "logs": []}
    def save():
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    def safe(value):
        return re.sub(r"https?://\S+", "[url]", str(value).replace(key, "[redacted]"))[:4096]
    deadline = time.monotonic() + args.timeout_seconds
    try:
        built = Template.build_in_background(make_template(), name=args.name, cpu_count=2,
            memory_mb=2048, api_key=key, request_timeout=30)
        evidence.update(templateId=built.template_id, buildId=built.build_id, status="building")
        print(json.dumps({k: v for k, v in evidence.items() if k != "logs"}), flush=True)
        save()
        offset = 0
        while time.monotonic() < deadline:
            status = Template.get_build_status(built, logs_offset=offset, api_key=key, request_timeout=20)
            entries = status.log_entries
            offset += len(entries)
            evidence["logs"].extend(safe(item.message) for item in entries)
            evidence["logs"] = evidence["logs"][-500:]
            evidence["status"] = status.status.value
            if status.reason:
                evidence["reason"] = safe(status.reason.message)
            save()
            if evidence["status"] in {"ready", "error"}:
                break
            time.sleep(5)
        else:
            evidence["status"] = "build_wait_timed_out"
    except Exception as exc:
        # SDK errors can carry request URLs or authorization details. Retain only
        # a known error class; remote build logs above are scrubbed separately.
        evidence["status"] = "build_request_failed"
        evidence["errorClass"] = type(exc).__name__
    save()
    print(json.dumps({k: v for k, v in evidence.items() if k != "logs"}), flush=True)
    raise SystemExit(0 if evidence["status"] == "ready" else 1)
