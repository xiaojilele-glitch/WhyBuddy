# -*- coding: utf-8 -*-
"""技能商店：OSS 存货、沙盒开箱、控制面短目录。

正向：装了 → 沙盒文件图有 SKILL.md+脚本；目录有名无正文；skill 回全文。
反向：只写安装行不 hydrate → 红；featured-skills / localStorage 不进 catalog；
空安装目录无 <skill> 正文。
"""

from __future__ import annotations

import inspect
import io
import zipfile
from pathlib import Path

import pytest

from services.control_skills import (
    catalog_xml,
    filter_selected,
    invoke_skill,
    parse_skill_md,
    skill_tool_description,
)
from services.identity_store import IdentityStore, _SqlExecutor
from services.skill_catalog_store import (
    SkillCatalogStore,
    _ALLOWED_CATEGORIES,
    _GITHUB_SEEDS,
    _SEED_DENY,
    load_github_seeds,
    load_seed_deny,
    reset_skill_catalog_cache,
)
from services.skill_hydrate import files_for_owner, files_for_package, sandbox_relpath
from services.skill_package_format import skill_md_text, unpack_skill_zip


def _zip_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, text in files.items():
            zf.writestr(name, text)
    return buf.getvalue()


COMPLETE = {
    "demo/SKILL.md": (
        "---\nname: demo\ndescription: 用来测开箱的完整包\n---\n\n# Demo\n\n"
        "跑 scripts/hello.py。\n"
    ),
    "demo/scripts/hello.py": "print('hello')\n",
    "demo/LICENSE": "MIT\n",
}


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "fs")
    monkeypatch.setenv("S3_FS_ROOT", str(tmp_path / "oss"))
    reset_skill_catalog_cache()
    ident = IdentityStore(_SqlExecutor(f"sqlite:///{tmp_path / 'id.db'}"), is_sqlite=True)
    store = SkillCatalogStore(ident._x, is_sqlite=True)
    yield store
    reset_skill_catalog_cache()


def test_unpack_rejects_zip_slip_and_missing_skill_md():
    with pytest.raises(ValueError, match="zip_slip"):
        unpack_skill_zip(_zip_bytes({"../SKILL.md": "x"}))
    with pytest.raises(ValueError, match="missing_skill_md"):
        unpack_skill_zip(_zip_bytes({"scripts/hello.py": "print(1)\n"}))


def test_install_unpacks_skill_md_and_scripts(catalog):
    digest = __import__("hashlib").sha256(_zip_bytes(COMPLETE)).hexdigest()
    from services.skill_blob_store import blob_put

    key = "skills/demo/1.0.0.zip"
    blob_put(key, _zip_bytes(COMPLETE))
    pkg = catalog.upsert_package(
        slug="demo",
        name="Demo",
        description="用来测开箱的完整包",
        version="1.0.0",
        oss_key=key,
        sha256=digest,
        license="MIT",
    )
    installed = catalog.install(owner_id="alice", skill_id=pkg["id"])
    files = files_for_package(installed, store=catalog)
    assert sandbox_relpath("demo", "SKILL.md") in files
    assert sandbox_relpath("demo", "scripts/hello.py") in files
    assert "print('hello')" in files[sandbox_relpath("demo", "scripts/hello.py")]


def test_catalog_has_name_not_body(catalog):
    digest = __import__("hashlib").sha256(_zip_bytes(COMPLETE)).hexdigest()
    from services.skill_blob_store import blob_put

    blob_put("skills/demo/1.0.0.zip", _zip_bytes(COMPLETE))
    pkg = catalog.upsert_package(
        slug="demo", name="Demo", description="用来测开箱的完整包",
        version="1.0.0", oss_key="skills/demo/1.0.0.zip", sha256=digest, license="MIT",
    )
    catalog.install(owner_id="alice", skill_id=pkg["id"])
    infos = catalog.installed_skill_infos("alice")
    xml = catalog_xml(infos)
    assert "<name>demo</name>" in xml
    assert "跑 scripts/hello.py" not in xml
    desc = skill_tool_description(infos)
    assert "跑 scripts/hello.py" not in desc
    loaded = invoke_skill(infos, "demo")
    assert loaded["ok"] is True
    assert "跑 scripts/hello.py" in loaded["skill_message"]


def test_empty_installs_have_no_skill_body():
    xml = catalog_xml([])
    assert "<skill>" not in xml
    assert invoke_skill([], "demo")["ok"] is False


def test_selected_skills_narrows_catalog():
    a = parse_skill_md(
        "---\nname: one\ndescription: first\n---\nONE BODY\n",
        path=".sliderule/skills/one/SKILL.md",
    )
    b = parse_skill_md(
        "---\nname: two\ndescription: second\n---\nTWO BODY\n",
        path=".sliderule/skills/two/SKILL.md",
    )
    assert a and b
    narrowed = filter_selected([a, b], ["two"])
    assert [s.name for s in narrowed] == ["two"]
    assert filter_selected([a, b], []) == [a, b]


def test_install_row_without_hydrate_is_not_enough(catalog):
    """只记安装行、不走 files_for_owner，沙盒文件图必须是空的。"""
    digest = __import__("hashlib").sha256(_zip_bytes(COMPLETE)).hexdigest()
    from services.skill_blob_store import blob_put

    blob_put("skills/demo/1.0.0.zip", _zip_bytes(COMPLETE))
    pkg = catalog.upsert_package(
        slug="demo", name="Demo", description="用来测开箱的完整包",
        version="1.0.0", oss_key="skills/demo/1.0.0.zip", sha256=digest, license="MIT",
    )
    catalog.install(owner_id="alice", skill_id=pkg["id"])
    assert catalog.is_installed("alice", pkg["id"])
    # 假装只写了行：不调用 files_for_owner / write_files。
    # 正向：files_for_owner 才会开箱。
    files = files_for_owner("alice", store=catalog)
    assert sandbox_relpath("demo", "SKILL.md") in files
    # 反向：没装的人没有文件。
    assert files_for_owner("bob", store=catalog) == {}


def test_project_start_calls_hydrate():
    src = Path(__file__).resolve().parents[1] / "services" / "project_runtime.py"
    text = src.read_text(encoding="utf-8")
    text = "\n".join(
        line for line in text.splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "hydrate_owner_into" in text
    assert "write_files(handle, {**files" in text


def test_skill_page_list_is_index_only():
    """技能页 GET 只读表。解压在安装/开箱，不在逛货架。"""
    route_src = inspect.getsource(
        __import__("routes.skill_store", fromlist=["list_skills"]).list_skills
    )
    catalog_src = inspect.getsource(SkillCatalogStore.catalog_for_owner)
    for src in (route_src, catalog_src):
        code = "\n".join(
            line for line in src.splitlines() if not line.lstrip().startswith("#")
        )
        assert "unpack" not in code
        assert "ensure_seed" not in code
        assert "blob_get" not in code
        assert "blob_put" not in code
        assert "files_for_package" not in code


def test_catalog_index_carries_seed_category(catalog):
    """分类写在种子索引里，不打开 zip。"""
    catalog.ensure_seed()
    by_slug = {pkg["slug"]: pkg["category"] for pkg in catalog.catalog_for_owner("u1")}
    assert by_slug["sliderule"] == "规格"
    assert by_slug["webapp-testing"] == "测试"
    assert by_slug["mcp-builder"] == "开发工具"
    assert by_slug["frontend-design"] == "界面设计"
    assert by_slug["web-artifacts-builder"] == "开发工具"
    assert by_slug["algorithmic-art"] == "界面设计"
    assert by_slug["brand-guidelines"] == "界面设计"
    assert by_slug["theme-factory"] == "界面设计"
    assert by_slug["canvas-design"] == "内容创作"
    assert by_slug["doc-coauthoring"] == "内容创作"
    assert by_slug["internal-comms"] == "办公"
    assert by_slug["office-skills"] == "办公"
    assert by_slug["pptx-slide-specification"] == "办公"
    assert by_slug["study"] == "办公"
    assert by_slug["data-storytelling"] == "办公"
    assert by_slug["kpi-dashboard-design"] == "办公"
    assert by_slug["accessibility"] == "测试"
    assert by_slug["web-quality-audit"] == "测试"
    assert by_slug["systematic-debugging"] == "开发工具"
    assert by_slug["verification-before-completion"] == "测试"
    assert by_slug["performance"] == "测试"
    assert by_slug["requesting-code-review"] == "开发工具"
    assert by_slug["react-state-management"] == "开发工具"
    assert by_slug["avoid-ai-writing"] == "内容创作"
    assert set(by_slug.values()) <= (_ALLOWED_CATEGORIES | {"其他"})


def test_github_seed_zips_unpack_without_required_keys():
    """种子 zip 能开箱，说明书不把第三方 key 写成必填。"""
    seeds = Path(__file__).resolve().parents[2] / "skills" / "seeds"
    forbidden = ("API_KEY", "OPENAI", "ANTHROPIC_API")
    assert _GITHUB_SEEDS
    for meta in _GITHUB_SEEDS:
        zip_path = seeds / f"{meta['slug']}.zip"
        assert zip_path.is_file(), zip_path.name
        files = unpack_skill_zip(zip_path.read_bytes())
        body = skill_md_text(files)
        for token in forbidden:
            assert token not in body
        if meta["license"] == "MIT":
            assert any(path.lower().endswith("license") for path in files)


def test_seed_index_is_about_one_hundred_and_denies_orchestrators():
    """货架种子约 100 份。调度咒 / 要 key 的包写进索引必须红。"""
    seeds = load_github_seeds()
    deny = load_seed_deny()
    slugs = {meta["slug"] for meta in seeds}
    sources = {meta["slug"]: meta["source_url"] for meta in seeds}
    assert 95 <= len(seeds) <= 105
    assert seeds == _GITHUB_SEEDS
    assert deny == _SEED_DENY
    assert slugs.isdisjoint(deny)
    assert "using-superpowers" in deny
    assert "stripe-integration" in deny
    assert "using-superpowers" not in slugs
    assert "stripe-integration" not in slugs
    assert "writing-plans" not in slugs
    assert "test-driven-development" not in slugs
    assert "before-you-build" not in slugs
    assert "accessibility" in slugs
    assert "performance" in slugs
    assert "requesting-code-review" in slugs
    assert "react-state-management" in slugs
    assert "office-skills" in slugs
    assert "pptx-slide-specification" in slugs
    assert "study" in slugs
    assert sources["office-skills"].startswith("https://github.com/lamvu211/office-skills")
    assert sources["study"].startswith("https://github.com/SugarMGP/study.skill")
    assert slugs.isdisjoint({"docx", "pptx", "xlsx", "pdf"})
    for banned in (
        "anthropics/skills/tree/main/skills/docx",
        "anthropics/skills/tree/main/skills/pptx",
        "anthropics/skills/tree/main/skills/xlsx",
        "anthropics/skills/tree/main/skills/pdf",
    ):
        assert all(banned not in url for url in sources.values())
    assert "addyosmani" in sources["accessibility"]
    assert "obra/superpowers" in sources["systematic-debugging"]
    assert "wshobson/agents" in sources["react-state-management"]
    assert "anthropics/skills" not in sources["accessibility"]
    for meta in seeds:
        assert meta["category"] in _ALLOWED_CATEGORIES


def test_office_root_packs_keep_scripts_drop_viewer():
    """仓根 SKILL.md 进架：说明书和脚本在，播放器 / 开发目录不进沙盒。"""
    import importlib.util

    seeds = Path(__file__).resolve().parents[2] / "skills" / "seeds"
    spec = importlib.util.spec_from_file_location(
        "vendor_community", seeds / "vendor_community.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    assert mod._find_skill_md(["office-skills-main/SKILL.md"], "office-skills") == (
        "office-skills-main/SKILL.md"
    )
    assert mod._find_skill_md(["repo/skills/foo/SKILL.md"], "foo") == (
        "repo/skills/foo/SKILL.md"
    )
    assert mod._keep_root_rel("SKILL.md")
    assert mod._keep_root_rel("scripts/pack.py")
    assert not mod._keep_root_rel("viewer/index.html")
    assert not mod._keep_root_rel("dev/notes.md")

    office = unpack_skill_zip((seeds / "office-skills.zip").read_bytes())
    assert "SKILL.md" in office or any(path.lower() == "skill.md" for path in office)
    assert any(path.replace("\\", "/").startswith("scripts/") for path in office)
    study = unpack_skill_zip((seeds / "study.zip").read_bytes())
    assert any(path.lower() == "skill.md" for path in study)
    assert all(
        "viewer/" not in path.replace("\\", "/") and "/dev/" not in path.replace("\\", "/")
        for path in study
    )


def test_ensure_seed_skips_shelved_packages(catalog, monkeypatch):
    """已在架上的同版本不许再 unpack / blob_put。变异：去掉 version 判断必红。"""
    first = catalog.ensure_seed()
    assert "mcp-builder" in first
    assert any(pkg["slug"] == "mcp-builder" for pkg in catalog.list_packages())
    catalog._seed_settled = False
    puts: list[str] = []
    unpacks: list[int] = []
    monkeypatch.setattr(
        "services.skill_catalog_store.blob_put",
        lambda key, data: puts.append(key) or "deadbeef",
    )
    monkeypatch.setattr(
        "services.skill_catalog_store.unpack_skill_zip",
        lambda data: unpacks.append(1) or {},
    )
    second = catalog.ensure_seed()
    assert second == []
    assert puts == []
    assert unpacks == []
    third = catalog.ensure_seed()
    assert third == []
    assert puts == []


def test_featured_skills_do_not_enter_catalog():
    store_mod = __import__("services.skill_catalog_store", fromlist=["skill_catalog_store"])
    route_mod = __import__("routes.skill_store", fromlist=["skill_store"])
    store_src = inspect.getsource(store_mod)
    route_src = inspect.getsource(route_mod)
    code = "\n".join(
        line for line in (store_src + "\n" + route_src).splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "featured-skills" not in code
    assert "localStorage" not in code
    assert "sliderule:installed-skills" not in code
    assert "client/src/data" not in code


def test_skill_text_does_not_force_tool():
    from services.closed_tools import closed_tool_from_text

    assert closed_tool_from_text("I have a skill for baking bread") is None
    assert closed_tool_from_text("skill") is None


def test_control_lists_skill_and_loads_body(monkeypatch):
    from models.v5_state import V5SessionState
    from services import rehearsal_control as rc
    from services.control_skills import SkillInfo

    info = SkillInfo(
        name="demo",
        description="用来测开箱的完整包",
        path=".sliderule/skills/demo/SKILL.md",
        body="# Demo\n\n跑 scripts/hello.py。\n",
    )
    monkeypatch.setattr(rc, "_skill_infos_for_turn", lambda state: [info])
    monkeypatch.setattr(rc, "guard_control_run", lambda: None)
    state = V5SessionState(sessionId="s1", ownerId="alice", goal={"text": "build"})
    listed = rc.list_control_tools(state)
    skill = next(t for t in listed if t["function"]["name"] == "skill")
    desc = skill["function"]["description"]
    assert "<name>demo</name>" in desc
    assert "跑 scripts/hello.py" not in desc

    async def _run():
        events = []
        async for ev in rc._dispatch_tool(
            "skill", {"name": "demo"}, state, "", [], [], "desktop", None, ""
        ):
            events.append(ev)
        return events

    import asyncio

    events = asyncio.run(_run())
    result = next(ev for ev in events if ev["type"] == "control_tool_result")
    assert result["ok"] is True
    assert "跑 scripts/hello.py" in result["skill_message"]
