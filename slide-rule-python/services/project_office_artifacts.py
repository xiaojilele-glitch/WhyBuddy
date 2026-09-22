"""Office deliverables live next to source, not inside the UTF-8 revision tree.

⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：bash 写出了 generate_deck.py，
  python-pptx 的 .pptx 停在 E2B 磁盘上。主机源码库是 dict[str,str]，
  file_read run.log 得到 project_file_not_found，右边只剩 Vite 登录页。

  产物按解码后的文件字节做 CAS。generate_deck.py 继续只活在文本 revision。
  收集失败 fail-open；有没有交付物 fail-closed。
"""
from __future__ import annotations

import base64
import hashlib
import json
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from services.deliverable_kind import (
    OFFICE_FILE_NOT_TEXT,
    is_office_artifact_path,
    is_office_zip_bytes,
    office_artifact_suffix,
    office_preview_payload,
)
from services.project_manifest import source_path
from services.project_store import ProjectNotFound, ProjectStoreUnavailable

MAX_OFFICE_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_PROJECT_OFFICE_BYTES = 32 * 1024 * 1024
_DDL = (
    "create table if not exists wb_project_office_artifact("
    "id varchar(80) primary key, project_id varchar(80) not null, path varchar(240) not null, "
    "sha256 varchar(64) not null, size_bytes integer not null, created_at text not null)",
    "create table if not exists wb_project_office_content("
    "hash varchar(64) primary key, size_bytes integer not null, content text not null)",
    "create table if not exists wb_project_office_preview("
    "artifact_id varchar(80) primary key, kind varchar(32) not null, "
    "sha256 varchar(64) not null, size_bytes integer not null, content text not null)",
    "create table if not exists wb_project_office_budget("
    "project_id varchar(80) primary key, reserved_bytes bigint not null)",
)


def decode_office_write(content: str, *, encoding: str | None) -> bytes:
    if str(encoding or "").strip() != "base64":
        raise ValueError(OFFICE_FILE_NOT_TEXT)
    try:
        data = base64.b64decode(content, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError(OFFICE_FILE_NOT_TEXT) from exc
    if not is_office_zip_bytes(data):
        raise ValueError(OFFICE_FILE_NOT_TEXT)
    if not 4 <= len(data) <= MAX_OFFICE_ARTIFACT_BYTES:
        raise ValueError("project_office_file_too_large")
    return data


def try_host_pdf(data: bytes, path: str) -> bytes | None:
    """有 soffice 才转。没有或失败返回 None——预览 fail-open。"""
    suffix = office_artifact_suffix(path)
    if suffix is None:
        return None
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="wb_office_") as folder:
            src = Path(folder) / f"in{suffix}"
            src.write_bytes(data)
            subprocess.run(
                [binary, "--headless", "--norestore", "--convert-to", "pdf",
                 "--outdir", folder, str(src)],
                check=False, capture_output=True, timeout=60,
            )
            pdfs = list(Path(folder).glob("*.pdf"))
            if not pdfs:
                return None
            pdf = pdfs[0].read_bytes()
            if not pdf.startswith(b"%PDF") or len(pdf) > MAX_OFFICE_ARTIFACT_BYTES:
                return None
            return pdf
    except (OSError, subprocess.SubprocessError):
        return None


class ProjectOfficeArtifactStore:
    def __init__(self, store):
        self.store = store
        for sql in _DDL:
            store._q(sql)

    def _require_project(self, project_id: str, owner_id: str) -> None:
        self.store.get_project(project_id, owner_id=owner_id)

    def put(self, project_id: str, *, owner_id: str, path: str, data: bytes) -> dict:
        self._require_project(project_id, owner_id)
        rel = source_path(str(path or "").replace("\\", "/").lstrip("/"))
        if not is_office_artifact_path(rel):
            raise ValueError("project_office_path_required")
        payload = bytes(data)
        if not is_office_zip_bytes(payload):
            raise ValueError("project_office_zip_required")
        if not 4 <= len(payload) <= MAX_OFFICE_ARTIFACT_BYTES:
            raise ValueError("project_office_file_too_large")
        digest = hashlib.sha256(payload).hexdigest()
        existing = self.store._q(
            "select id,sha256,size_bytes from wb_project_office_artifact "
            "where project_id=$1 and path=$2",
            [project_id, rel],
        )
        if existing and existing[0]["sha256"] == digest:
            self._ensure_preview(existing[0]["id"], payload, rel)
            return self._row(existing[0]["id"])
        if not self.store._q("select hash from wb_project_office_content where hash=$1", [digest]):
            self.store._q(
                "insert into wb_project_office_budget(project_id,reserved_bytes) "
                "select $1,0 where not exists("
                "select 1 from wb_project_office_budget where project_id=$1)",
                [project_id],
            )
            grew = self.store._q(
                "update wb_project_office_budget set reserved_bytes=reserved_bytes+$1 "
                "where project_id=$2 and reserved_bytes+$1<=$3 returning project_id",
                [len(payload), project_id, MAX_PROJECT_OFFICE_BYTES],
            )
            if not grew:
                raise ValueError("project_office_budget")
            self.store._q(
                "insert into wb_project_office_content(hash,size_bytes,content) values($1,$2,$3) "
                "on conflict(hash) do nothing",
                [digest, len(payload), base64.b64encode(payload).decode("ascii")],
            )
        identity = json.dumps([project_id, rel, digest], separators=(",", ":"))
        artifact_id = existing[0]["id"] if existing else "art-" + hashlib.sha256(
            identity.encode()
        ).hexdigest()[:40]
        captured = datetime.now(timezone.utc).isoformat()
        if existing:
            self.store._q(
                "update wb_project_office_artifact set sha256=$1,size_bytes=$2,created_at=$3 "
                "where id=$4",
                [digest, len(payload), captured, artifact_id],
            )
        else:
            self.store._q(
                "insert into wb_project_office_artifact"
                "(id,project_id,path,sha256,size_bytes,created_at) values($1,$2,$3,$4,$5,$6)",
                [artifact_id, project_id, rel, digest, len(payload), captured],
            )
        self._ensure_preview(artifact_id, payload, rel)
        return self._row(artifact_id)

    def _row(self, artifact_id: str) -> dict:
        rows = self.store._q(
            "select id,project_id,path,sha256,size_bytes,created_at "
            "from wb_project_office_artifact where id=$1",
            [artifact_id],
        )
        if not rows:
            raise ProjectNotFound("project_office_artifact_not_found")
        row = rows[0]
        return {
            "artifactId": row["id"],
            "projectId": row["project_id"],
            "path": row["path"],
            "sha256": row["sha256"],
            "sizeBytes": row["size_bytes"],
            "createdAt": row["created_at"],
            "downloadable": True,
        }

    def list(self, project_id: str, *, owner_id: str) -> list[dict]:
        self._require_project(project_id, owner_id)
        rows = self.store._q(
            "select id from wb_project_office_artifact where project_id=$1 order by created_at",
            [project_id],
        )
        return [self._row(row["id"]) for row in rows]

    def has_any(self, project_id: str, *, owner_id: str) -> bool:
        self._require_project(project_id, owner_id)
        rows = self.store._q(
            "select 1 as ok from wb_project_office_artifact where project_id=$1 limit 1",
            [project_id],
        )
        return bool(rows)

    def get_bytes(self, project_id: str, artifact_id: str, *, owner_id: str) -> tuple[dict, bytes]:
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        rows = self.store._q(
            "select content,size_bytes from wb_project_office_content where hash=$1",
            [meta["sha256"]],
        )
        if not rows:
            raise ProjectStoreUnavailable("project_office_content_missing")
        try:
            data = base64.b64decode(rows[0]["content"], validate=True)
        except ValueError as exc:
            raise ProjectStoreUnavailable("project_office_content_corrupt") from exc
        if len(data) != rows[0]["size_bytes"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise ProjectStoreUnavailable("project_office_content_corrupt")
        return meta, data

    def find_by_path(self, project_id: str, path: str, *, owner_id: str) -> dict | None:
        self._require_project(project_id, owner_id)
        try:
            rel = source_path(str(path or "").replace("\\", "/").lstrip("/"))
        except ValueError:
            return None
        rows = self.store._q(
            "select id from wb_project_office_artifact where project_id=$1 and path=$2",
            [project_id, rel],
        )
        return self._row(rows[0]["id"]) if rows else None

    def get_preview(self, project_id: str, artifact_id: str, *, owner_id: str) -> dict | None:
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        rows = self.store._q(
            "select kind,content from wb_project_office_preview where artifact_id=$1",
            [artifact_id],
        )
        if not rows:
            return None
        kind = rows[0]["kind"]
        if kind == "pdf":
            return {"kind": "pdf", "content": rows[0]["content"]}
        try:
            payload = json.loads(base64.b64decode(rows[0]["content"], validate=True))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        # ⚠ 2026-09-22 已入库的预览只有正文。读的时候按文件字节补位置，
        #   不必等下一轮生成才从文档卡片变成幻灯片舞台。补失败就用旧的。
        slides = payload.get("slides")
        laid_out = (
            isinstance(slides, list)
            and any(isinstance(item, dict) and item.get("shapes") for item in slides)
        )
        if payload.get("kind") == "slides" and not laid_out:
            try:
                _meta, data = self.get_bytes(project_id, artifact_id, owner_id=owner_id)
                fresh = office_preview_payload(data, meta["path"])
                if isinstance(fresh, dict) and fresh.get("kind") == "slides":
                    return fresh
            except Exception:
                return payload
        return payload

    def _ensure_preview(self, artifact_id: str, data: bytes, path: str) -> None:
        present = self.store._q(
            "select artifact_id from wb_project_office_preview where artifact_id=$1",
            [artifact_id],
        )
        if present:
            return
        pdf = try_host_pdf(data, path)
        if pdf:
            digest = hashlib.sha256(pdf).hexdigest()
            self.store._q(
                "insert into wb_project_office_preview"
                "(artifact_id,kind,sha256,size_bytes,content) values($1,$2,$3,$4,$5)",
                [artifact_id, "pdf", digest, len(pdf),
                 base64.b64encode(pdf).decode("ascii")],
            )
            return
        payload = office_preview_payload(data, path)
        if not payload:
            return
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.store._q(
            "insert into wb_project_office_preview"
            "(artifact_id,kind,sha256,size_bytes,content) values($1,$2,$3,$4,$5)",
            [artifact_id, str(payload.get("kind") or "slides"),
             hashlib.sha256(raw).hexdigest(), len(raw),
             base64.b64encode(raw).decode("ascii")],
        )


# 给测试/路由一个稳定 id 前缀，避免和会话 id 撞。
def new_artifact_id() -> str:
    return "art-" + uuid.uuid4().hex[:40]
