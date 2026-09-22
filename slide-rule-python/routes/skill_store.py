# -*- coding: utf-8 -*-
"""技能商店 HTTP。登录闸。

列表只读索引（表里的名字/描述/装没装）。解压发生在安装之后、写进
当前 e2b 沙盒的时候，不是打开货架的时候。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException

from middlewares.current_user import CurrentUser
from services.skill_catalog_store import get_skill_catalog_store
from services.skill_hydrate import files_for_package, try_hydrate_running_project

router = APIRouter(tags=["Skill store"])


def _store():
    try:
        return get_skill_catalog_store()
    except Exception as exc:
        raise HTTPException(503, "skill_catalog_unavailable") from exc


@router.get("/skills")
def list_skills(viewer: CurrentUser, projectId: Optional[str] = None) -> dict[str, Any]:
    # ⚠ 2026-09-20：这里曾经每次 GET 都 ensure_seed，三个 zip 解压写 OSS。
    # 技能页只要索引。种子只在货架第一次建起来时下，见 get_skill_catalog_store。
    skills = _store().catalog_for_owner(str(viewer.id))
    return {"skills": skills, "projectId": projectId}


@router.post("/skills/{skill_id}/install")
def install_skill(
    skill_id: str,
    viewer: CurrentUser,
    payload: dict[str, Any] = Body(default={}),
) -> dict[str, Any]:
    store = _store()
    try:
        pkg = store.install(owner_id=str(viewer.id), skill_id=skill_id)
    except ValueError as exc:
        code = str(exc)
        if code == "skill_not_in_catalog":
            raise HTTPException(404, "skill_not_in_catalog") from exc
        raise HTTPException(400, code) from exc
    try:
        files = files_for_package(pkg, store=store)
    except Exception as exc:
        raise HTTPException(502, f"skill_unpack_failed:{exc}") from exc
    project_id = str((payload or {}).get("projectId") or "").strip() or None
    hydrate = try_hydrate_running_project(
        owner_id=str(viewer.id), project_id=project_id, files=files
    )
    return {
        "ok": True,
        "skill": pkg,
        "unpackedFiles": len(files),
        "hydrate": hydrate,
    }


@router.post("/skills/{skill_id}/uninstall")
def uninstall_skill(
    skill_id: str,
    viewer: CurrentUser,
    payload: dict[str, Any] = Body(default={}),
) -> dict[str, Any]:
    store = _store()
    pkg = store.uninstall(owner_id=str(viewer.id), skill_id=skill_id)
    if pkg is None:
        raise HTTPException(404, "skill_not_in_catalog")
    project_id = str((payload or {}).get("projectId") or "").strip() or None
    hydrate = try_hydrate_running_project(
        owner_id=str(viewer.id),
        project_id=project_id,
        delete_slug=str(pkg.get("slug") or ""),
    )
    return {"ok": True, "skill": {**pkg, "installed": False}, "hydrate": hydrate}
