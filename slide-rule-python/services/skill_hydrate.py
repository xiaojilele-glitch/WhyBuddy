# -*- coding: utf-8 -*-
"""技能开箱：表 + OSS → 沙盒文件图。真正写入留给 provider / worker。

缺一步就是假装：只记安装行、不拉包、不解进当前沙盒，都不算装完。
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

from services.e2b_workspace_provider import PROJECT_ROOT, E2BWorkspaceProvider
from services.project_store import get_project_store
from services.skill_catalog_store import get_skill_catalog_store
from services.workspace_provider import WorkspaceHandle

log = logging.getLogger(__name__)

SKILL_SANDBOX_PREFIX = ".sliderule/skills"
_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")


def sandbox_relpath(slug: str, rel: str) -> str:
    safe = (slug or "").strip().lower()
    if not _SLUG_RE.fullmatch(safe):
        raise ValueError("skill_slug_invalid")
    name = (rel or "").replace("\\", "/").lstrip("/")
    if not name or ".." in name.split("/"):
        raise ValueError("skill_hydrate_path_invalid")
    return f"{SKILL_SANDBOX_PREFIX}/{safe}/{name}"


def files_for_package(pkg: dict[str, Any], *, store: Any = None) -> dict[str, str]:
    catalog = store or get_skill_catalog_store()
    unpacked = catalog.unpack_package(pkg)
    slug = str(pkg.get("slug") or "")
    return {sandbox_relpath(slug, rel): text for rel, text in unpacked.items()}


def files_for_owner(owner_id: str, *, store: Any = None) -> dict[str, str]:
    """账号已装列表 → 沙盒路径图。失败 fail-open 成空图，不拖垮 project_start。"""
    if not str(owner_id or "").strip():
        return {}
    try:
        catalog = store or get_skill_catalog_store()
        out: dict[str, str] = {}
        for pkg in catalog.list_installed(owner_id):
            try:
                out.update(files_for_package(pkg, store=catalog))
            except Exception:
                continue
        return out
    except Exception:
        return {}


def write_skill_files(write_files: Callable[..., None], handle: Any, files: dict[str, str]) -> int:
    """按技能拆批写，避免跟工程 8MiB 清单挤在一次 write_files 里。"""
    if not files:
        return 0
    by_slug: dict[str, dict[str, str]] = {}
    prefix = SKILL_SANDBOX_PREFIX + "/"
    for path, text in files.items():
        rest = path[len(prefix):] if path.startswith(prefix) else path
        slug = rest.split("/", 1)[0]
        by_slug.setdefault(slug, {})[path] = text
    written = 0
    for batch in by_slug.values():
        write_files(handle, batch)
        written += len(batch)
    return written


def hydrate_owner_into(write_files: Callable[..., None], handle: Any, owner_id: str) -> int:
    """账号已装技能写进沙盒。**整条都 fail-open**，写失败返回 0 不抛。

    ⚠ 2026-09-20 review：契约只兑现了一半。files_for_owner 是全包 try/except 的，
      但 write_skill_files 里 `write_files(handle, batch)` 是裸调——E2B 写一抖，
      异常穿过这里落进 ProjectRuntimeService.start 的 try，
      **except 会把刚建好的沙盒销毁、整个 project_start 失败**。
      技能注水是增强类，按 §7 炸了不许拖垮主链路；工程本身没有它照样能跑，
      少几个技能目录而已。
      配套判据 tests/test_skill_hydrate_never_breaks_project_start.py。
    """
    try:
        return write_skill_files(write_files, handle, files_for_owner(owner_id))
    except Exception:
        log.warning("skill hydration failed, project_start continues owner=%s", owner_id, exc_info=True)
        return 0


def try_hydrate_running_project(
    *,
    owner_id: str,
    project_id: str | None,
    files: dict[str, str] | None = None,
    delete_slug: str | None = None,
) -> dict[str, Any]:
    """当前工程沙盒若在跑，把文件写进去 / 能删则删。沙盒不在不算安装失败。"""
    if not project_id:
        return {"hydrated": False, "reason": "no_project"}
    try:
        store = get_project_store()
        lease = store.get_lease(str(project_id), owner_id=str(owner_id))
        sandbox_id = getattr(lease, "sandboxId", None) if lease is not None else None
        workspace_id = getattr(lease, "workspaceId", None) if lease is not None else None
        if not sandbox_id or not workspace_id:
            return {"hydrated": False, "reason": "no_running_sandbox"}
        provider = E2BWorkspaceProvider()
        handle = WorkspaceHandle(str(workspace_id), str(sandbox_id))
        provider.connect(handle)
        if files:
            write_skill_files(provider.write_files, handle, files)
        if delete_slug and _SLUG_RE.fullmatch(delete_slug):
            provider.run(
                handle,
                f"rm -rf {PROJECT_ROOT}/{SKILL_SANDBOX_PREFIX}/{delete_slug}",
            )
        return {"hydrated": True}
    except Exception as exc:
        return {"hydrated": False, "reason": "hydrate_failed", "detail": str(exc)[:200]}
