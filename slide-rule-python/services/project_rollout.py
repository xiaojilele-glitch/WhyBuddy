"""Explicit deployment/rollout configuration; never infer readiness from one key."""

import os
import re
from urllib.parse import urlsplit

from config.settings import settings


def rollout_mode():
    value = os.getenv("WHYBUDDY_PROJECT_ROLLOUT", "").strip()
    if not value:
        return "internal" if os.getenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED") == "1" else "disabled"
    return value if value in {"disabled", "internal", "allowlist"} else "disabled"


def allowed_users():
    return frozenset(item.strip() for item in os.getenv("WHYBUDDY_PROJECT_ALLOWED_USERS", "").split(",") if item.strip())


def _origin(value, *, template=False):
    if template and value.count("{runtimeId}") != 1:
        return None
    try:
        url = urlsplit(value.replace("{runtimeId}", "rt-preflight"))
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.path or url.query or url.fragment or url.port not in (None, 443)):
            return None
        host = url.hostname
        if (any(char in value for char in (" ", "\\", "\t", "\r", "\n")) or
                (template and not value.startswith("https://{runtimeId}.")) or
                any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split("."))):
            return None
        return host
    except ValueError:
        return None


def rollout_readiness(*, mode=None):
    mode = mode or rollout_mode()
    production = settings.NODE_ENV == "production" or os.getenv("NODE_ENV") == "production"
    blockers = []
    if mode == "disabled":
        blockers.append("project_rollout_disabled")
    if mode == "internal" and production:
        blockers.append("project_internal_mode_not_for_production")
    if mode == "allowlist":
        if not allowed_users():
            blockers.append("project_rollout_users_missing")
        database = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
        api = (getattr(settings, "APP_STORE_HTTP_API_URL", "") or "").strip()
        api_key = (getattr(settings, "APP_STORE_HTTP_API_KEY", "") or "").strip()
        if not (database.startswith(("postgresql:", "postgresql+")) or
                (api.startswith("https://") and len(api_key) >= 16)):
            blockers.append("project_durable_database_required")
        preview = _origin(os.getenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", ""), template=True)
        workbench = _origin(os.getenv("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", ""))
        if not preview:
            blockers.append("project_private_preview_origin_required")
        if not workbench:
            blockers.append("project_workbench_origin_required")
        if preview and workbench and (preview == workbench or preview.endswith("." + workbench)):
            blockers.append("project_preview_origin_isolation_required")
        if len(os.getenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")) < 32:
            blockers.append("project_preview_gateway_key_required")
        if not os.getenv("E2B_API_KEY", "").strip():
            blockers.append("project_sandbox_not_configured")
        if not os.getenv("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "").strip():
            blockers.append("project_browser_not_configured")
    return {"mode": mode, "configured": not blockers, "blockers": blockers,
        "configurationOnly": True, "production": production}


def project_worker_enabled():
    # Keep the execution owner online during rollback so it can reconcile and
    # destroy existing sandboxes. Its actor check still rejects all new work.
    return rollout_readiness()["configured"] or os.getenv("WHYBUDDY_PROJECT_CLEANUP_ENABLED") == "1"
