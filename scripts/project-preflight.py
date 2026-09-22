"""Read deployment configuration without sending secrets or provisioning resources."""

import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))
from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)
from services.project_rollout import rollout_readiness


def main():
    report = rollout_readiness()
    report["allowlistReadiness"] = rollout_readiness(mode="allowlist")
    bundle = Path(os.getenv("WHYBUDDY_PROJECT_PREVIEW_AGENT_BUNDLE") or ROOT / "dist/project-preview/agent.cjs")
    report["agentBundlePresent"] = bundle.is_file()
    report["cleanupWorkerConfigured"] = os.getenv("WHYBUDDY_PROJECT_CLEANUP_ENABLED") == "1"
    if report["mode"] == "allowlist" and not report["agentBundlePresent"]:
        report["blockers"].append("project_preview_agent_bundle_required")
        report["configured"] = False
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["configured"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
