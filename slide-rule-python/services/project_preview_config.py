"""Bounded relay configuration shared by runtime composition and HTTP edges.

The runtime ID occupies a whole hostname label, giving each application its own
cookie/storage/service-worker origin. Credentials, paths and caller URLs cannot
turn this template into an arbitrary proxy or an entry on the main site.
"""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit


def gateway_key() -> str:
    value = os.getenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")
    if len(value) < 32 or len(value) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise ValueError("project_preview_gateway_not_configured")
    return value


def origin_for_runtime(runtime_id: str) -> str:
    if not isinstance(runtime_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,61}[a-z0-9]", runtime_id):
        raise ValueError("project_preview_runtime_id_invalid")
    template = os.getenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "")
    if template.count("{runtimeId}") != 1:
        raise ValueError("project_preview_origin_not_configured")
    value = template.replace("{runtimeId}", runtime_id)
    if any(char in value for char in ("{", "}", "\\", "\r", "\n", "\t", " ")):
        raise ValueError("project_preview_origin_invalid")
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname or "", parsed.port
    except ValueError as exc:
        raise ValueError("project_preview_origin_invalid") from exc
    labels = host.split(".")
    if (parsed.scheme not in {"https", "http"} or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment or not parsed.netloc
            or len(labels) < 2 or labels[0] != runtime_id or len(host) > 253
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
            or (port is not None and not 1 <= port <= 65535)
            or (parsed.scheme == "http" and not host.endswith(".localhost"))):
        raise ValueError("project_preview_origin_invalid")
    # Reject noncanonical netloc encodings/case and empty explicit ports.
    canonical = f"{parsed.scheme}://{host}" + (f":{port}" if port is not None else "")
    if canonical != value:
        raise ValueError("project_preview_origin_invalid")
    # WHATWG URL.origin (Node gateway and browser) omits a default port. Issue
    # the same origin here or a valid :443/:80 template creates grants which
    # the real gateway can never redeem despite identical network destinations.
    if (parsed.scheme, port) in {("https", 443), ("http", 80)}:
        return f"{parsed.scheme}://{host}"
    return canonical


def preview_configuration_enabled() -> bool:
    try:
        gateway_key()
        origin_for_runtime("rt-configuration-probe")
        return True
    except ValueError:
        return False


def published_preview_url(value: str | None) -> str | None:
    """E2B's official published host. Internal preview copies this when the
    private relay is unreachable from the sandbox.

    2026-09-16 TicketStream：runtime 已 ready，但 agent 往
    `{runtimeId}.preview.miantuan.ai` 拨 WSS，DNS 到公网机且 TLS 失败，
    本机 :3002 网关永远接不到。GET 一直 `project_preview_tunnel_not_started`。
    E2B `sandbox.get_host(port)` 是他们文档里的预览口，源与工作台隔离。
    只认 `*.e2b.app` / `*.e2b.dev`；别的 previewUrl 不许当可打开预览。
    allowlist / production 不许走这条。
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
    except ValueError:
        return None
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.port not in (None, 443)
            or not host.endswith((".e2b.app", ".e2b.dev"))
            or host.count(".") < 2):
        return None
    return f"https://{host}/"
