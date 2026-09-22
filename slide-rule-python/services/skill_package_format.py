# -*- coding: utf-8 -*-
"""完整技能包：zip 开箱、防 zip-slip、必须有 SKILL.md。

叶子：只吃字节，不 import services 里其它模块。
OSS / 表 / 沙盒写入留在调用方。
"""

from __future__ import annotations

import io
import zipfile
from typing import Iterable

MAX_PACKAGE_BYTES = 8 * 1024 * 1024
MAX_PACKAGE_FILES = 200
MAX_FILE_BYTES = 512 * 1024
SKILL_MD = "skill.md"

_TEXT_SUFFIXES = (
    ".md",
    ".py",
    ".sh",
    ".json",
    ".txt",
    ".yml",
    ".yaml",
    ".toml",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".html",
    ".csv",
    ".gitignore",
)


def unpack_skill_zip(blob: bytes) -> dict[str, str]:
    """解开完整包。路径相对技能根（含 SKILL.md 的那一层）。

    二进制略过。没有 SKILL.md、路径逃逸、超上限 → ValueError。
    """
    if not isinstance(blob, (bytes, bytearray)) or not blob:
        raise ValueError("skill_package_empty")
    if len(blob) > MAX_PACKAGE_BYTES:
        raise ValueError("skill_package_too_large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise ValueError("skill_package_not_zip") from exc
    raw: dict[str, bytes] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = _safe_zip_name(info.filename)
        if name is None:
            continue
        if info.file_size > MAX_FILE_BYTES:
            raise ValueError("skill_package_file_too_large")
        data = archive.read(info)
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("skill_package_file_too_large")
        raw[name] = data
        if len(raw) > MAX_PACKAGE_FILES:
            raise ValueError("skill_package_too_many_files")
    if not raw:
        raise ValueError("skill_package_empty")
    prefix = _skill_root_prefix(raw)
    files: dict[str, str] = {}
    for name, data in raw.items():
        rel = name[len(prefix):] if prefix and name.startswith(prefix) else name
        if not rel or rel.endswith("/"):
            continue
        if not _looks_text(rel, data):
            continue
        files[rel.replace("\\", "/")] = data.decode("utf-8")
    if not any(path.lower() == SKILL_MD or path.lower().endswith("/" + SKILL_MD) for path in files):
        raise ValueError("skill_package_missing_skill_md")
    # 根上必须能直接读到 SKILL.md（前缀剥完之后）。
    if SKILL_MD not in {path.lower() for path in files}:
        raise ValueError("skill_package_missing_skill_md")
    return {path: text for path, text in files.items()}


def skill_md_text(files: dict[str, str]) -> str:
    for path, text in files.items():
        if path.replace("\\", "/").lower() == SKILL_MD:
            return text
    raise ValueError("skill_package_missing_skill_md")


def _safe_zip_name(filename: str) -> str | None:
    name = (filename or "").replace("\\", "/")
    if name.startswith("/") or name.startswith("../") or "/../" in name or name == "..":
        raise ValueError("skill_package_zip_slip")
    if name.startswith("__MACOSX/") or name.endswith(".ds_store"):
        return None
    parts = [p for p in name.split("/") if p and p not in (".",)]
    if not parts or any(p == ".." for p in parts):
        raise ValueError("skill_package_zip_slip")
    return "/".join(parts)


def _skill_root_prefix(names: Iterable[str]) -> str:
    """zip 常包一层目录 `sliderule/SKILL.md`。剥到 SKILL.md 所在目录。"""
    skill_paths = [
        name for name in names if name.lower() == SKILL_MD or name.lower().endswith("/" + SKILL_MD)
    ]
    if not skill_paths:
        return ""
    skill_paths.sort(key=len)
    chosen = skill_paths[0]
    if "/" not in chosen:
        return ""
    return chosen.rsplit("/", 1)[0] + "/"


def _looks_text(path: str, data: bytes) -> bool:
    if b"\x00" in data:
        return False
    lower = path.lower()
    if lower.endswith(_TEXT_SUFFIXES) or lower.split("/")[-1] in {"skill.md", "readme", "license", "makefile"}:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return lower.endswith((".xml", ".svg", ".mmd", ".jinja", ".j2"))
