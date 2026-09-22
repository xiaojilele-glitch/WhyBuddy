"""Pure source validation and hashing, independent of storage and providers.

Accept only regular UTF-8 text files in the first project format. There is no
archive extraction or symlink representation to turn a valid logical path into
a write outside the workspace. The provider must also reject live symlinks.
"""

import fnmatch
import hashlib
import json
import re
from collections.abc import Mapping

from models.project_runtime import ManifestFile, ProjectManifest

MAX_FILE_BYTES = 512 * 1024
MAX_PROJECT_BYTES = 8 * 1024 * 1024
MAX_PROJECT_FILES = 512


def source_path(path: str) -> str:
    if not isinstance(path, str) or not path or len(path) > 240:
        raise ValueError("invalid_project_path")
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("invalid_project_path")
    if re.search(r"[\\:\x00-\x1f\x7f]", path):
        raise ValueError("invalid_project_path")
    for part in parts:
        if part.casefold() in (".git", "node_modules", ".venv"):
            raise ValueError("reserved_project_path")
        if part.casefold().startswith(".env") and part.casefold() not in (".env.example", ".env.sample"):
            raise ValueError("project_secret_file_forbidden")
        if part.endswith((" ", ".")):
            raise ValueError("invalid_project_path")
    return path


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def build_manifest(files: Mapping[str, str]) -> ProjectManifest:
    if not isinstance(files, Mapping) or not files or len(files) > MAX_PROJECT_FILES:
        raise ValueError("invalid_project_file_count")
    entries: list[ManifestFile] = []
    folded: set[str] = set()
    total = 0
    for path, content in sorted(files.items()):
        path = source_path(path)
        if path.casefold() in folded:
            raise ValueError("ambiguous_project_path")
        folded.add(path.casefold())
        if not isinstance(content, str) or "\x00" in content:
            raise ValueError("project_text_file_required")
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise ValueError("project_file_too_large")
        total += size
        if total > MAX_PROJECT_BYTES:
            raise ValueError("project_too_large")
        entries.append(ManifestFile(path=path, sha256=content_hash(content), sizeBytes=size))
    # File/directory aliases are forbidden too: a plus a/b cannot be materialized.
    for entry in entries:
        parts = entry.path.casefold().split("/")
        if any("/".join(parts[:i]) in folded for i in range(1, len(parts))):
            raise ValueError("ambiguous_project_path")
    tree_hash = content_hash(canonical_json([entry.model_dump() for entry in entries]))
    return ProjectManifest(treeHash=tree_hash, totalBytes=total, files=entries)


def apply_file_changes(files: Mapping[str, str], changes: Mapping[str, str | None]) -> dict[str, str]:
    if not isinstance(changes, Mapping):
        raise ValueError("invalid_project_changes")
    updated = dict(files)
    for path, content in changes.items():
        source_path(path)
        if content is None:
            if path not in updated:
                raise ValueError("project_file_not_found")
            del updated[path]
        else:
            updated[path] = content
    build_manifest(updated)
    return updated


def prepare_source_patch(files: Mapping[str, str], changes: list[dict], *, live: bool = False) -> tuple[dict[str, str], list[str]]:
    """Validate the model's exact before/after contract before any side effect.

    A running Vite process can consume source/assets. Dependency and startup
    configuration changes need a separately managed reinstall/restart; silently
    writing them would make the saved revision differ from installed execution.
    """
    replacements = {}
    for change in changes:
        path = source_path(change["path"])
        if path.casefold() == "public/__whybuddy_revision.json":
            raise ValueError("project_reserved_revision_file")
        if path in replacements:
            raise ValueError("project_duplicate_change_path")
        actual = content_hash(files[path]) if path in files else None
        if change["expectedSha256"] != actual:
            raise ValueError("project_file_hash_conflict")
        replacements[path] = change["content"]
    changed = [path for path, content in replacements.items() if files.get(path) != content]
    if live and any(path != "index.html" and not path.startswith(("src/", "public/", "tests/")) for path in changed):
        raise ValueError("project_live_patch_requires_restart")
    return apply_file_changes(files, replacements), changed


def kernel_write_changes(files: Mapping[str, str], path: str, content: str, *, append: bool = False) -> list[dict]:
    """整文件写：服务端填当前哈希，模型只给路径和正文。

    ⚠ 2026-09-16 TicketStream：`project_patch` 要 expectedSha256 + approvalRef，
      模型连猜带截断，十几次 `project_tool_arguments_invalid` /
      `project_file_hash_conflict`。泄漏的 Manus 核和 grok/Claude 的 Write
      都是 path+content。哈希仍走 prepare_source_patch，只是不让模型填。
    """
    path = source_path(path)
    if append and path in files:
        content = files[path] + content
    return [{
        "path": path,
        "content": content,
        "expectedSha256": content_hash(files[path]) if path in files else None,
    }]


def kernel_str_replace_changes(files: Mapping[str, str], path: str, old: str, new: str) -> list[dict]:
    """唯一旧串替换。0 次或多于 1 次都 fail-closed，不许默默改错处。"""
    path = source_path(path)
    if path not in files:
        raise ValueError("project_file_not_found")
    if not isinstance(old, str) or not old:
        raise ValueError("project_str_replace_empty")
    if not isinstance(new, str):
        raise ValueError("project_text_file_required")
    body = files[path]
    found = body.count(old)
    if found == 0:
        raise ValueError("project_str_replace_not_found")
    if found > 1:
        raise ValueError("project_str_replace_ambiguous")
    return [{
        "path": path,
        "content": body.replace(old, new, 1),
        "expectedSha256": content_hash(body),
    }]


def workspace_file_path(file: str, files: Mapping[str, str] | None = None) -> str:
    """泄漏包用绝对路径；工程源码是相对路径。剥前缀，对不上再试去掉首段。"""
    raw = str(file or "").strip().replace("\\", "/")
    raw = raw.lstrip("/")
    for prefix in ("home/ubuntu/", "workspace/", "app/"):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
    if files and raw not in files:
        parts = [part for part in raw.split("/") if part]
        for index in range(1, len(parts)):
            candidate = "/".join(parts[index:])
            if candidate in files:
                return source_path(candidate)
    return source_path(raw)


def file_content_matches(text: str, regex: str, *, limit: int = 40) -> list[dict]:
    try:
        pattern = re.compile(regex)
    except re.error as exc:
        raise ValueError("project_regex_invalid") from exc
    matches = []
    for line, body in enumerate(text.splitlines(), 1):
        if pattern.search(body) is None:
            continue
        matches.append({"line": line, "text": body[:240], "excerptTruncated": len(body) > 240})
        if len(matches) >= limit:
            break
    return matches


def file_tree_matches(
    files: Mapping[str, str],
    regex: str,
    *,
    directory: str = ".",
    glob: str = "*",
    limit: int = 40,
) -> list[dict]:
    """GitHub Grep：跨文件正则。单文件 file_find_in_content 不够。"""
    found = []
    for path in file_name_matches(sorted(files), directory, glob):
        for row in file_content_matches(files[path], regex, limit=limit - len(found)):
            found.append({"path": path, **row})
            if len(found) >= limit:
                return found
    return found


def file_name_matches(paths: list[str], directory: str, glob: str) -> list[str]:
    prefix = ""
    raw = str(directory or "").strip().replace("\\", "/").lstrip("/")
    if raw not in {"", ".", "*"}:
        for prefix_name in ("home/ubuntu/", "workspace/", "app/"):
            if raw.lower().startswith(prefix_name):
                raw = raw[len(prefix_name):]
        prefix = source_path(raw) if raw else ""
    found = []
    for path in paths:
        if prefix and path != prefix and not path.startswith(prefix + "/"):
            continue
        name = path.rsplit("/", 1)[-1]
        if fnmatch.fnmatch(name, glob) or fnmatch.fnmatch(path, glob):
            found.append(path)
    return found
