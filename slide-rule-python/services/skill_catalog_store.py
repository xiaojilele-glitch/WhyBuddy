# -*- coding: utf-8 -*-
"""技能货架：wb_skill_package / wb_skill_install。

表只回答两件事：货在哪、这个账号装了没有。不是登录权限。
借 identity_store 那条执行器，不另开库。
"""

from __future__ import annotations

import json
import hashlib
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from services.control_skills import SkillInfo, parse_skill_md
from services.identity_store import get_identity_store
from services.skill_blob_store import blob_get, blob_put
from services.skill_package_format import skill_md_text, unpack_skill_zip

PACKAGE_TABLE = "wb_skill_package"
INSTALL_TABLE = "wb_skill_install"

_DDL = (
    f"create table if not exists {PACKAGE_TABLE} ("
    "id varchar(80) primary key, slug varchar(80) unique not null, "
    "name varchar(160) not null, description text not null, "
    "version varchar(40) not null, oss_key varchar(240) not null, "
    "sha256 varchar(64) not null, license varchar(80), source_url varchar(400))",
    f"create table if not exists {INSTALL_TABLE} ("
    "owner_id varchar(240) not null, skill_id varchar(80) not null, "
    "version varchar(40) not null, installed_at varchar(64) not null, "
    "primary key (owner_id, skill_id))",
)

_REPO_SKILLS = Path(__file__).resolve().parents[2] / "skills"

# 自家 SPEC 包不当「写应用」日常默认——目录里标清楚。
_SLIDERULE_SEED = {
    "slug": "sliderule",
    "name": "SlideRule 出 SPEC",
    "description": (
        "一句话进、可评审的 SPEC 包出。带闸脚本。这是出规格的包，"
        "不是日常「写应用」的默认技能。"
    ),
    "version": "1.0.0",
    "license": "MIT",
    "source_url": "https://github.com/xiaojilele-glitch/WhyBuddy/tree/main/skills",
    "category": "规格",
}

# GitHub 种子只认 skills/seeds/index.json。手写 100 行 tuple 会裂。
# 民间只进手艺包。调度咒 / 目录墙写在 seeds/deny.json，测试钉着。
_SEED_INDEX_PATH = _REPO_SKILLS / "seeds" / "index.json"
_SEED_DENY_PATH = _REPO_SKILLS / "seeds" / "deny.json"
_ALLOWED_CATEGORIES = frozenset(
    {"规格", "办公", "开发工具", "界面设计", "内容创作", "效率提升", "测试"}
)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_github_seeds() -> tuple[dict[str, str], ...]:
    raw = _load_json(_SEED_INDEX_PATH)
    packages = raw.get("packages") if isinstance(raw, dict) else raw
    if not isinstance(packages, list) or not packages:
        raise ValueError("skill_seed_index_empty")
    out: list[dict[str, str]] = []
    for item in packages:
        if not isinstance(item, dict):
            raise ValueError("skill_seed_index_row")
        slug = str(item.get("slug") or "").strip()
        if not slug:
            raise ValueError("skill_seed_index_slug")
        category = str(item.get("category") or "").strip()
        if category not in _ALLOWED_CATEGORIES:
            raise ValueError(f"skill_seed_index_category:{slug}")
        out.append({
            "slug": slug,
            "name": str(item.get("name") or slug),
            "description": str(item.get("description") or ""),
            "version": str(item.get("version") or "1.0.0"),
            "license": str(item.get("license") or ""),
            "source_url": str(item.get("source_url") or ""),
            "category": category,
            "archive": str(item.get("archive") or ""),
        })
    return tuple(out)


def load_seed_deny() -> frozenset[str]:
    raw = _load_json(_SEED_DENY_PATH)
    if not isinstance(raw, list):
        raise ValueError("skill_seed_deny_invalid")
    return frozenset(str(item).strip() for item in raw if str(item).strip())


_GITHUB_SEEDS = load_github_seeds()
_SEED_DENY = load_seed_deny()
_SEED_CATEGORY = {
    _SLIDERULE_SEED["slug"]: _SLIDERULE_SEED["category"],
    **{meta["slug"]: meta["category"] for meta in _GITHUB_SEEDS},
}
OFFICE_SKILL_CATEGORY = "办公"


def skill_seed_category(slug: str) -> str:
    """种子货架上的类别。未知 slug 空串——不编「其他」。"""
    return str(_SEED_CATEGORY.get(str(slug or "").strip()) or "")


_local_info_cache: dict[str, SkillInfo] = {}


def local_seed_skill_info(slug: str) -> SkillInfo | None:
    """仓库里的种子 zip。不经过 OSS。

    ⚠ 2026-09-21 sr-20260921191557-XSGAMK9PYZ：GET /skills 显示已装
      office-skills，控制回合 skill() 却 available=[]。installed_skill_infos
      每发都从 OSS unpack 十个包，失败被吞成空目录。种子包在磁盘上，
      点名了就必须能打开。
    """
    name = str(slug or "").strip()
    if not name:
        return None
    hit = _local_info_cache.get(name)
    if hit is not None:
        return hit
    path = (
        _REPO_SKILLS / "sliderule.zip"
        if name == "sliderule"
        else _REPO_SKILLS / "seeds" / f"{name}.zip"
    )
    if not path.is_file():
        return None
    try:
        files = unpack_skill_zip(path.read_bytes())
        body = skill_md_text(files)
        info = parse_skill_md(
            body, path=f".sliderule/skills/{name}/SKILL.md", name=name,
        )
    except Exception:
        return None
    if info is not None:
        _local_info_cache[name] = info
    return info


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SkillCatalogStore:
    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._is_sqlite = is_sqlite
        self._seed_settled = False
        for statement in _DDL:
            self._x.execute(statement)

    def upsert_package(
        self,
        *,
        slug: str,
        name: str,
        description: str,
        version: str,
        oss_key: str,
        sha256: str,
        license: str = "",
        source_url: str = "",
        skill_id: str | None = None,
    ) -> dict[str, Any]:
        slug = (slug or "").strip()
        if not slug:
            raise ValueError("skill_slug_required")
        rows = self._x.query(
            f"select id from {PACKAGE_TABLE} where slug = {self._x.ph(1)}", [slug]
        )
        pid = str((rows[0] or {}).get("id") or "") if rows else (skill_id or slug)
        if not pid:
            pid = secrets.token_urlsafe(12)
        p = self._x.ph
        if rows:
            self._x.execute(
                f"update {PACKAGE_TABLE} set name={p(1)}, description={p(2)}, "
                f"version={p(3)}, oss_key={p(4)}, sha256={p(5)}, license={p(6)}, "
                f"source_url={p(7)} where slug={p(8)}",
                [name[:160], description, version[:40], oss_key[:240],
                 sha256[:64], (license or "")[:80], (source_url or "")[:400], slug],
            )
        else:
            self._x.execute(
                f"insert into {PACKAGE_TABLE} (id, slug, name, description, version, "
                f"oss_key, sha256, license, source_url) values "
                f"({p(1)},{p(2)},{p(3)},{p(4)},{p(5)},{p(6)},{p(7)},{p(8)},{p(9)})",
                [pid, slug, name[:160], description, version[:40], oss_key[:240],
                 sha256[:64], (license or "")[:80], (source_url or "")[:400]],
            )
        return self.get_package(pid) or self.get_package_by_slug(slug) or {}

    def get_package(self, skill_id: str) -> dict[str, Any] | None:
        rows = self._x.query(
            f"select * from {PACKAGE_TABLE} where id = {self._x.ph(1)}",
            [str(skill_id or "")],
        )
        return self._package_row(rows[0]) if rows else None

    def get_package_by_slug(self, slug: str) -> dict[str, Any] | None:
        rows = self._x.query(
            f"select * from {PACKAGE_TABLE} where slug = {self._x.ph(1)}",
            [str(slug or "")],
        )
        return self._package_row(rows[0]) if rows else None

    def list_packages(self) -> list[dict[str, Any]]:
        rows = self._x.query(
            f"select * from {PACKAGE_TABLE} order by slug", []
        )
        return [self._package_row(r) for r in rows]

    def install(self, *, owner_id: str, skill_id: str) -> dict[str, Any]:
        owner = str(owner_id or "").strip()
        pkg = self.get_package(skill_id) or self.get_package_by_slug(skill_id)
        if not owner:
            raise ValueError("skill_owner_required")
        if not pkg:
            raise ValueError("skill_not_in_catalog")
        p = self._x.ph
        existing = self._x.query(
            f"select skill_id from {INSTALL_TABLE} where owner_id={p(1)} and skill_id={p(2)}",
            [owner, pkg["id"]],
        )
        now = _now_iso()
        if existing:
            self._x.execute(
                f"update {INSTALL_TABLE} set version={p(1)}, installed_at={p(2)} "
                f"where owner_id={p(3)} and skill_id={p(4)}",
                [pkg["version"], now, owner, pkg["id"]],
            )
        else:
            self._x.execute(
                f"insert into {INSTALL_TABLE} (owner_id, skill_id, version, installed_at) "
                f"values ({p(1)},{p(2)},{p(3)},{p(4)})",
                [owner, pkg["id"], pkg["version"], now],
            )
        return {**pkg, "installed": True, "installedAt": now}

    def uninstall(self, *, owner_id: str, skill_id: str) -> dict[str, Any] | None:
        pkg = self.get_package(skill_id) or self.get_package_by_slug(skill_id)
        if not pkg:
            return None
        self._x.execute(
            f"delete from {INSTALL_TABLE} where owner_id={self._x.ph(1)} and skill_id={self._x.ph(2)}",
            [str(owner_id or ""), pkg["id"]],
        )
        return pkg

    def list_installed(self, owner_id: str) -> list[dict[str, Any]]:
        p = self._x.ph
        rows = self._x.query(
            f"select p.*, i.version as installed_version, i.installed_at "
            f"from {INSTALL_TABLE} i join {PACKAGE_TABLE} p on p.id = i.skill_id "
            f"where i.owner_id = {p(1)} order by p.slug",
            [str(owner_id or "")],
        )
        out = []
        for row in rows:
            item = self._package_row(row)
            item["installed"] = True
            item["installedAt"] = str(row.get("installed_at") or "")
            out.append(item)
        return out

    def is_installed(self, owner_id: str, skill_id: str) -> bool:
        p = self._x.ph
        rows = self._x.query(
            f"select skill_id from {INSTALL_TABLE} where owner_id={p(1)} and skill_id={p(2)}",
            [str(owner_id or ""), str(skill_id or "")],
        )
        return bool(rows)

    def catalog_for_owner(self, owner_id: str) -> list[dict[str, Any]]:
        installed = {item["id"] for item in self.list_installed(owner_id)}
        out = []
        for pkg in self.list_packages():
            pkg["installed"] = pkg["id"] in installed
            out.append(pkg)
        return out

    def unpack_package(self, pkg: dict[str, Any]) -> dict[str, str]:
        blob = blob_get(str(pkg.get("ossKey") or pkg.get("oss_key") or ""))
        expected = str(pkg.get("sha256") or "")
        if expected and hashlib.sha256(blob).hexdigest() != expected:
            raise ValueError("skill_package_checksum_mismatch")
        return unpack_skill_zip(blob)

    def skill_info(self, pkg: dict[str, Any]) -> SkillInfo | None:
        files = self.unpack_package(pkg)
        body = skill_md_text(files)
        return parse_skill_md(body, path=f".sliderule/skills/{pkg['slug']}/SKILL.md", name=pkg["slug"])

    def installed_skill_infos(self, owner_id: str) -> list[SkillInfo]:
        infos: list[SkillInfo] = []
        for pkg in self.list_installed(owner_id):
            slug = str(pkg.get("slug") or "")
            info = local_seed_skill_info(slug)
            if info is None:
                try:
                    info = self.skill_info(pkg)
                except Exception:
                    info = None
            if info is not None:
                infos.append(info)
        return infos

    def ensure_seed(self) -> list[str]:
        """把仓库里的完整包推进 OSS + 表。已在架上的同版本不再解压、不再写。

        ⚠ 2026-09-20 真机：GET /skills 每次都把三个 zip 全量 unpack +
        blob_put + upsert。目录接口 TTFB 3.0s，技能页 LCP 3.26s——LCP
        元素是 MarketRow 那行 12px 描述，等的就是这趟空转。
        """
        if self._seed_settled:
            return []
        existing = {pkg["slug"]: pkg for pkg in self.list_packages()}
        seeded: list[str] = []
        jobs: list[tuple[Path, dict[str, str]]] = []
        sliderule_zip = _REPO_SKILLS / "sliderule.zip"
        if sliderule_zip.is_file():
            jobs.append((sliderule_zip, _SLIDERULE_SEED))
        for meta in _GITHUB_SEEDS:
            path = _REPO_SKILLS / "seeds" / f"{meta['slug']}.zip"
            if path.is_file():
                jobs.append((path, meta))
        for path, meta in jobs:
            have = existing.get(meta["slug"])
            if have and have.get("version") == meta["version"]:
                continue
            seeded.append(self._seed_zip(path, meta))
        self._seed_settled = True
        return [item for item in seeded if item]

    def _seed_zip(self, path: Path, meta: dict[str, str]) -> str:
        data = path.read_bytes()
        unpack_skill_zip(data)  # 拒绝没有 SKILL.md / zip-slip 的种子
        oss_key = f"skills/{meta['slug']}/{meta['version']}.zip"
        digest = blob_put(oss_key, data)
        self.upsert_package(
            slug=meta["slug"],
            name=meta["name"],
            description=meta["description"],
            version=meta["version"],
            oss_key=oss_key,
            sha256=digest,
            license=meta.get("license") or "",
            source_url=meta.get("source_url") or "",
            skill_id=meta["slug"],
        )
        return meta["slug"]

    @staticmethod
    def _package_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row.get("id") or ""),
            "slug": str(row.get("slug") or ""),
            "name": str(row.get("name") or ""),
            "description": str(row.get("description") or ""),
            "version": str(row.get("version") or ""),
            "ossKey": str(row.get("oss_key") or ""),
            "sha256": str(row.get("sha256") or ""),
            "license": str(row.get("license") or ""),
            "sourceUrl": str(row.get("source_url") or ""),
            "category": str(
                row.get("category")
                or _SEED_CATEGORY.get(str(row.get("slug") or ""), "其他")
            ),
            "installed": False,
        }


_store: Optional[SkillCatalogStore] = None
_store_ident: Any = None
_store_lock = threading.Lock()


def get_skill_catalog_store() -> SkillCatalogStore:
    ident = get_identity_store()
    global _store, _store_ident
    with _store_lock:
        if _store is not None and _store_ident is ident:
            return _store
        _store = SkillCatalogStore(ident._x, is_sqlite=ident._is_sqlite)
        _store_ident = ident
        try:
            _store.ensure_seed()
        except Exception:
            pass
        return _store


def reset_skill_catalog_cache() -> None:
    global _store, _store_ident
    with _store_lock:
        _store = None
        _store_ident = None


def installed_skill_infos(owner_id: str) -> list[SkillInfo]:
    try:
        return get_skill_catalog_store().installed_skill_infos(owner_id)
    except Exception:
        return []
