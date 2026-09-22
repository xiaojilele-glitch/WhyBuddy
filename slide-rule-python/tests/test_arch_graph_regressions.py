"""Behavioral counterexamples from the 2026-09-11 architecture review.

The source fixtures exercise the real scanner. Replacing the fixes with the old
max-alias resolver, parse-error continue, or DFS ratchet makes these tests fail.
"""

import copy
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import arch_graph as arch


def write_sources(root, sources):
    for name, source in sources.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    return root


def graph(pairs):
    return arch.Graph(
        modules={node for pair in pairs for node in pair},
        edges=[arch.Edge(a, b, a.split(".")[0], b.split(".")[0], False, 1)
               for a, b in pairs],
    )


@pytest.mark.parametrize("statement", [
    "import services.a, services.longer",
    "from services import a, longer",
    "from . import a, longer",
])
def test_every_import_alias_contributes_its_dependency(tmp_path, statement):
    root = write_sources(tmp_path, {
        "services/consumer.py": statement + "\n",
        "services/a.py": "VALUE = 1\n",
        "services/longer.py": "VALUE = 2\n",
    })
    result = arch.build_graph(root)
    assert {edge.key() for edge in result.edges} == {
        "services.consumer -> services.a", "services.consumer -> services.longer",
    }


def test_package_initializers_and_exported_symbols_are_dependencies(tmp_path):
    root = write_sources(tmp_path, {
        "pkg/__init__.py": "from .leaf import VALUE\n",
        "pkg/leaf.py": "VALUE = 1\n",
        "pkg/sibling.py": "from .leaf import VALUE\n",
        "consumer.py": "from pkg import VALUE\nimport pkg.leaf\n",
    })
    result = arch.build_graph(root)
    assert {edge.key() for edge in result.edges} == {
        "consumer -> pkg.__init__", "consumer -> pkg.leaf",
        "pkg.__init__ -> pkg.leaf", "pkg.sibling -> pkg.leaf",
    }
    assert arch.cyclic_edges(result) == []


def test_nested_packages_and_star_import_load_initializers(tmp_path):
    root = write_sources(tmp_path, {
        "pkg/__init__.py": "VALUE = 1\n",
        "pkg/nested/__init__.py": "from .. import VALUE\n",
        "pkg/nested/leaf.py": "VALUE = 2\n",
        "consumer.py": "from pkg import *\nimport pkg.nested.leaf\n",
    })
    result = arch.build_graph(root)
    consumer_targets = {edge.dst for edge in result.edges if edge.src == "consumer"}
    assert consumer_targets == {"pkg.__init__", "pkg.nested.__init__", "pkg.nested.leaf"}
    assert "pkg.nested.__init__ -> pkg.__init__" in {edge.key() for edge in result.edges}


def test_deferred_ratchet_counts_statements_after_alias_and_initializer_expansion(tmp_path):
    root = write_sources(tmp_path, {
        "pkg/__init__.py": "",
        "pkg/a.py": "",
        "pkg/longer.py": "",
        "consumer.py": "def consume():\n    from pkg import a, longer\n",
    })
    result = arch.build_graph(root)
    assert len(result.edges) == 3
    assert arch.deferred_count(result) == 1


def test_two_import_statements_on_one_line_cannot_reduce_the_ratchet(tmp_path):
    root = write_sources(tmp_path, {
        "a.py": "",
        "b.py": "",
        "consumer.py": "def consume():\n    import a; import b\n",
    })
    assert arch.deferred_count(arch.build_graph(root)) == 2


@pytest.mark.parametrize("mode", ["--check", "--emit"])
def test_parse_failure_rejects_the_cli_before_writing_diagrams(tmp_path, monkeypatch, mode):
    root = write_sources(tmp_path / "source", {
        "services/leaf.py": "import services.driver\ndef broken(:\n",
        "services/driver.py": "VALUE = 1\n",
    })
    build = arch.build_graph
    with pytest.raises(arch.GraphScanError, match="leaf.py"):
        build(root)
    python_doc, repo_doc = tmp_path / "python.md", tmp_path / "repo.md"
    monkeypatch.setattr(arch, "build_graph", lambda: build(root))
    monkeypatch.setattr(arch, "DIAGRAM", python_doc)
    monkeypatch.setattr(arch, "REPO_DIAGRAM", repo_doc)
    assert arch.main([mode]) == 1
    assert not python_doc.exists()
    assert not repo_doc.exists()


def test_invalid_utf8_is_not_silently_removed(tmp_path):
    (tmp_path / "broken.py").write_bytes(b"VALUE = 1\n\xff")
    with pytest.raises(arch.GraphScanError, match="broken.py"):
        arch.build_graph(tmp_path)


def test_scc_ratchet_detects_a_chord_that_dfs_does_not_report():
    before = graph([("a", "b"), ("b", "c"), ("c", "a")])
    after = graph([("a", "b"), ("b", "c"), ("c", "a"), ("a", "c")])
    assert arch.find_cycles(before) == arch.find_cycles(after)
    assert set(arch.cyclic_edges(after)) - set(arch.cyclic_edges(before)) == {"a -> c"}
    baseline = {"cyclic_edges": arch.cyclic_edges(before)}
    assert arch._ratchet_errors("cyclic_edges", arch.cyclic_edges(after), baseline) == [
        "baseline.cyclic_edges: new a -> c",
    ]
    baseline["cyclic_edges"] = arch.cyclic_edges(after)
    assert arch._ratchet_errors("cyclic_edges", arch.cyclic_edges(before), baseline) == [
        "baseline.cyclic_edges: stale a -> c",
    ]


def test_component_scc_ratchet_and_rendering_include_every_cyclic_edge(monkeypatch):
    before = graph([("a", "b"), ("b", "c"), ("c", "a")])
    after = graph([("a", "b"), ("b", "c"), ("c", "a"), ("a", "c")])
    manifest = {"component": {name: {"modules": [name]} for name in "abc"}}
    assert arch.component_cycles(manifest, before) == arch.component_cycles(manifest, after)
    assert set(arch.component_cyclic_edges(after, manifest)) == {
        "a -> b", "b -> c", "c -> a", "a -> c",
    }
    monkeypatch.setattr(arch, "gate_inventory", lambda: [])
    monkeypatch.setattr(arch, "all_blocker_codes", lambda: [])
    monkeypatch.setattr(arch, "gate_codes_without_health", lambda _manifest: [])
    assert "a -.->|1| c" in arch.render_doc(after, manifest)


def test_cycle_exemption_does_not_hide_an_scc_that_reaches_another_component():
    manifest = {"component": {
        "x": {"modules": ["a", "b"], "allow_internal_cycles": True},
        "y": {"modules": ["c"]},
    }}
    assert arch.cyclic_edges(graph([("a", "b"), ("b", "a")]), manifest) == []
    mixed = graph([("a", "b"), ("b", "a"), ("b", "c"), ("c", "a")])
    assert set(arch.cyclic_edges(mixed, manifest)) == {
        "a -> b", "b -> a", "b -> c", "c -> a",
    }


@pytest.mark.parametrize("body", [
    "return start_drive_full_factory_run",
    "start_drive_full_factory_run = None\n    return False",
    "def unused():\n        return start_drive_full_factory_run()\n    return False",
])
def test_handoff_requires_a_call_in_the_handoff_body(tmp_path, body):
    path = tmp_path / "source.py"
    path.write_text("async def _handoff_factory():\n    " + body + "\n", encoding="utf-8")
    assert not arch.handoff_is_live_from(path, "_handoff_factory", "start_drive_full_factory_run")


@pytest.mark.parametrize("target", ["start_drive_full_factory_run", "factory.start_drive_full_factory_run"])
def test_handoff_recognizes_direct_and_qualified_calls(tmp_path, target):
    path = tmp_path / "source.py"
    path.write_text(f"async def _handoff_factory():\n    return await {target}()\n", encoding="utf-8")
    assert arch.handoff_is_live_from(path, "_handoff_factory", "start_drive_full_factory_run")


@pytest.fixture(scope="module")
def repository_graph():
    return arch.build_graph(), arch.load_manifest()


def test_every_module_has_exactly_one_component(repository_graph):
    current, manifest = repository_graph
    assert arch.ownership_errors(current, manifest) == []
    missing = copy.deepcopy(manifest)
    missing["component"]["control"]["modules"].remove("services.done_claim")
    assert "component: unassigned module services.done_claim" in arch.ownership_errors(current, missing)
    duplicate = copy.deepcopy(manifest)
    duplicate["component"]["platform"]["modules"].append("services.done_claim")
    assert any("duplicate ownership services.done_claim" in item
               for item in arch.ownership_errors(current, duplicate))


def test_emit_rejects_unowned_modules_before_writing(repository_graph, monkeypatch, tmp_path):
    current, manifest = repository_graph
    changed = copy.deepcopy(manifest)
    changed["component"]["control"]["modules"].remove("services.done_claim")
    python_doc, repo_doc = tmp_path / "python.md", tmp_path / "repo.md"
    monkeypatch.setattr(arch, "build_graph", lambda: current)
    monkeypatch.setattr(arch, "load_manifest", lambda: changed)
    monkeypatch.setattr(arch, "DIAGRAM", python_doc)
    monkeypatch.setattr(arch, "REPO_DIAGRAM", repo_doc)
    assert arch.main(["--emit"]) == 1
    assert not python_doc.exists()
    assert not repo_doc.exists()


def test_shared_validation_includes_orphan_classification_and_cli(repository_graph, monkeypatch):
    current, manifest = repository_graph
    changed = copy.deepcopy(manifest)
    del changed["orphan_reasons"]["services.web_aigc_open_adapter"]
    monkeypatch.setattr(arch, "build_graph", lambda: current)
    monkeypatch.setattr(arch, "load_manifest", lambda: changed)
    monkeypatch.setattr(arch, "document_errors", lambda *_args: [])
    assert "orphan_reasons: missing services.web_aigc_open_adapter" in arch.validate_graph(current, changed)
    assert arch.main(["--check"]) == 1


def test_shared_validation_rejects_paid_off_orphan_baselines(repository_graph):
    current, manifest = repository_graph
    changed = copy.deepcopy(current)
    changed.edges.append(arch.Edge("app", "routes.sliderule", "app", "routes", False, 99999))
    errors = arch.validate_graph(changed, manifest, check_documents=False)
    assert "baseline.orphans: stale routes.sliderule" in errors
    assert "orphan_reasons: stale routes.sliderule" in errors


def test_cli_uses_shared_validator_and_document_sync(repository_graph, monkeypatch, tmp_path):
    current, manifest = repository_graph
    python_doc, repo_doc = tmp_path / "python.md", tmp_path / "repo.md"
    python_doc.write_bytes(b"python\r\n")
    repo_doc.write_text("repo\n", encoding="utf-8")
    monkeypatch.setattr(arch, "DIAGRAM", python_doc)
    monkeypatch.setattr(arch, "REPO_DIAGRAM", repo_doc)
    monkeypatch.setattr(arch, "render_doc", lambda *_args: "python\n")
    monkeypatch.setattr(arch, "render_repo_doc", lambda *_args: "repo\n")
    monkeypatch.setattr(arch, "build_graph", lambda: current)
    monkeypatch.setattr(arch, "load_manifest", lambda: manifest)
    assert arch.validate_graph(current, manifest) == []
    assert arch.main(["--check"]) == 0
    repo_doc.write_text("changed\n", encoding="utf-8")
    assert any("Generated diagram is stale" in error for error in arch.validate_graph(current, manifest))
    assert arch.main(["--check"]) == 1


def test_freeze_changes_only_named_keys_in_the_baseline_table(tmp_path, monkeypatch):
    path = tmp_path / "architecture.toml"
    source = '''[unrelated]
violations = ["keep"]
cycles = ["keep too"]
[baseline]
violations = ["old"]
cycles = ["old"]
services_violations = ["old"]
cyclic_edges = ["old"]
component_violations = ["component debt"]
component_cycles = ["component witnesses"]
component_cyclic_edges = ["component cyclic debt"]
orphans = ["orphan"]
[after]
violations = ["also keep"]
'''
    path.write_text(source, encoding="utf-8")
    manifest = arch.tomllib.loads(source)
    monkeypatch.setattr(arch, "MANIFEST", path)
    arch._freeze(arch.Graph(), manifest)
    expected = copy.deepcopy(manifest)
    for key in ("violations", "cycles", "services_violations", "cyclic_edges"):
        expected["baseline"][key] = []
    assert arch.tomllib.loads(path.read_text(encoding="utf-8")) == expected


def test_missing_baseline_key_makes_freeze_fail_without_writing(tmp_path, monkeypatch):
    path = tmp_path / "architecture.toml"
    source = "[baseline]\nviolations = []\n"
    path.write_text(source, encoding="utf-8")
    monkeypatch.setattr(arch, "MANIFEST", path)
    with pytest.raises(ValueError, match="baseline.cycles"):
        arch._freeze(arch.Graph(), arch.tomllib.loads(source))
    assert path.read_text(encoding="utf-8") == source
