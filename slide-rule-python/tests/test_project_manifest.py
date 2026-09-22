"""Source snapshots must represent files that can be safely materialized."""

import pytest

from services import project_manifest as manifest


def test_manifest_hash_covers_path_content_and_utf8_size():
    a = manifest.build_manifest({"src/app.ts": "你好", "package.json": "{}"})
    b = manifest.build_manifest({"package.json": "{}", "src/app.ts": "你好"})
    assert a == b
    assert a.totalBytes == 8
    assert a.treeHash != manifest.build_manifest({"src/app.ts": "您好", "package.json": "{}"}).treeHash
    assert a.treeHash != manifest.build_manifest({"src/other.ts": "你好", "package.json": "{}"}).treeHash


@pytest.mark.parametrize("path", ["../evil", "/absolute", "C:/windows", "src\\evil", "a//b", "a/./b", "a/../b", "bad\x00file", ".git/config", "node_modules/x", ".env", "nested/.env.production", "trailing."])
def test_invalid_or_secret_paths_never_enter_manifest(path):
    with pytest.raises(ValueError):
        manifest.build_manifest({path: "hello"})


@pytest.mark.parametrize("files", [{"A": "1", "a": "2"}, {"src": "1", "src/a": "2"}, {"SRC": "1", "src/a": "2"}])
def test_file_directory_aliases_and_case_collisions_fail(files):
    with pytest.raises(ValueError, match="ambiguous_project_path"):
        manifest.build_manifest(files)


def test_limits_apply_to_utf8_bytes_and_total(monkeypatch):
    monkeypatch.setattr(manifest, "MAX_FILE_BYTES", 5)
    with pytest.raises(ValueError, match="file_too_large"):
        manifest.build_manifest({"a": "你好"})
    monkeypatch.setattr(manifest, "MAX_PROJECT_BYTES", 5)
    with pytest.raises(ValueError, match="project_too_large"):
        manifest.build_manifest({"a": "你", "b": "好"})


def test_changes_do_not_mutate_original_and_removal_is_explicit():
    files = {"a": "old", ".env.example": "DEMO=1"}
    changed = manifest.apply_file_changes(files, {"a": None, "b": "new"})
    assert files["a"] == "old"
    assert changed == {"b": "new", ".env.example": "DEMO=1"}
    with pytest.raises(ValueError, match="not_found"):
        manifest.apply_file_changes(files, {"missing": None})
    with pytest.raises(ValueError, match="text_file_required"):
        manifest.build_manifest({"a": {"symlink": "/etc/passwd"}})
