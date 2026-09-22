"""Regression tests for the actual grok documentation CLI and its source input.

The initial report lost source after a literal "/*" and mislabeled *_tests.rs.
Fixtures keep those failures observable without requiring the external checkout.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grok_rust_inventory import count_rust_lines, file_kind, inventory, rust_code
from grok_module_docs import entrypoints, evidence_path, registered_views, symbol_line

spec = importlib.util.spec_from_file_location('grok_graph', Path(__file__).with_name('arch-graph-grok.py'))
graph = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = graph
spec.loader.exec_module(graph)


class RustInventoryTests(unittest.TestCase):
    def test_literals_and_nested_comments_do_not_erase_following_code(self):
        lines = [
            '// header "',
            'let marker = "/*";',
            'let url = "https://example.test";',
            'let raw = br##"',
            '// still literal',
            '/* still literal */',
            '"##;',
            '/* outer',
            ' /* nested */ still comment',
            ' */ fn after() {} // trailing',
            '',
            "fn borrow<'a>(s: &'a str) { let ch = '\\''; }",
        ]
        self.assertEqual(count_rust_lines('\n'.join(lines) + '\n'), (12, 8))
        self.assertEqual(count_rust_lines('/* a /* b */ c */\nfn live() {}'), (2, 1))
        self.assertEqual(count_rust_lines('fn a() {}\r\n// comment\r\n'), (2, 1))
        self.assertEqual(count_rust_lines(''), (0, 0))

    def test_mask_preserves_line_offsets_but_removes_fake_symbols(self):
        text = '/* fn fake() {} */\nlet s = r#"fn fake() {}"#;\nfn real() {}\n'
        masked = rust_code(text, mask_literals=True)
        self.assertEqual(len(masked), len(text))
        self.assertEqual(masked.count('\n'), text.count('\n'))
        self.assertNotIn('fake', masked)
        self.assertIn('real', masked)

    def test_test_paths_are_disjoint_from_bench_and_example(self):
        for rel in ['tests/flow.rs', 'src/config_tests.rs', 'src/tests.rs',
                    'src/test_parser.rs', 'src/a_test.rs', 'src/actor_tests/queue.rs']:
            self.assertEqual(file_kind(rel), 'test', rel)
        self.assertEqual(file_kind('src/testing.rs'), 'source')
        self.assertEqual(file_kind('benches/test_speed.rs'), 'bench')
        self.assertEqual(file_kind('examples/test_demo.rs'), 'example')

    def test_inventory_counts_real_files_without_build_or_fuzz_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for rel in ['src/lib.rs', 'src/config_tests.rs', 'benches/a.rs', 'examples/a.rs', 'target/stale.rs', 'fuzz/input.rs']:
                p = root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('fn a() {}\n// comment\n', encoding='utf-8')
            rows = inventory(root)
            self.assertEqual(len(rows), 4)
            self.assertEqual(sum(f.raw for f in rows), 8)
            self.assertEqual(sum(f.source for f in rows), 4)
            self.assertEqual({f.kind for f in rows}, {'source', 'test', 'bench', 'example'})


class GeneratedDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'whybuddy'
        self.root = Path(self.temp.name) / 'grok'
        self.crate = self.root / 'crates/codegen/demo'
        self.write(self.root / 'Cargo.toml', '[workspace]\nmembers = ["crates/codegen/demo"]\n')
        self.write(self.crate / 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nautobins = false\n')
        self.write(self.crate / 'src/lib.rs', 'pub fn entry() {}\n')
        self.write(self.crate / 'src/config_tests.rs', '#[test]\nfn check() {}\n')
        self.write(self.repo / 'scripts/grok-module-notes-test.json', json.dumps({'crates': [{
            'crate': 'demo', 'purpose': 'Fixture reads the real entry.',
            'boundaries': {'owns': ['entry']},
            'subsystems': [{'path': 'src/lib.rs', 'responsibility': 'entry'}],
            'flows': [{'name': 'entry', 'steps': [{'path': 'src/lib.rs', 'symbol': 'entry', 'detail': 'entry point'}]}],
        }]}))
        self.patch = patch.multiple(graph, REPO=self.repo, DIAGRAM=self.repo/'docs/graph.md',
            OVERVIEW=self.repo/'docs/overview.md', DETAIL_DIR=self.repo/'docs/details', DETAIL_TARGETS=('demo',))
        self.patch.start()
        self.addCleanup(self.patch.stop)

    @staticmethod
    def write(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def cli(self, mode):
        # Test main -> scanner -> render -> disk/check, not a second implementation.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return graph.main(['--root', str(self.root), mode])

    def test_cli_emits_all_documents_and_detects_source_and_document_drift(self):
        self.assertEqual(self.cli('--emit'), 0)
        outputs = sorted((self.repo/'docs').rglob('*.md'))
        self.assertEqual(len(outputs), 4)  # graph, overview, index, detail
        before = {p: p.read_bytes() for p in outputs}
        self.assertEqual(self.cli('--check'), 0)
        self.assertEqual(self.cli('--emit'), 0)
        self.assertEqual(before, {p: p.read_bytes() for p in outputs})
        detail = self.repo/'docs/details/demo.md'
        self.assertIn('src/config_tests.rs', detail.read_text(encoding='utf8'))
        detail.write_text('stale', encoding='utf8')
        self.assertEqual(self.cli('--check'), 1)
        self.assertEqual(self.cli('--emit'), 0)
        self.write(self.crate/'src/new.rs', 'fn added() {}\n')
        self.assertEqual(self.cli('--check'), 1)
        # A same-LOC source rewrite must also invalidate the evidence fingerprint.
        self.cli('--emit')
        self.write(self.crate/'src/new.rs', 'fn other() {}\n')
        self.assertEqual(self.cli('--check'), 1)

    def test_missing_member_or_evidence_fails_instead_of_silently_shrinking_report(self):
        (self.crate/'src/lib.rs').unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.cli('--emit')
        (self.crate/'Cargo.toml').unlink()
        with self.assertRaisesRegex(ValueError, 'missing Cargo.toml'):
            graph.build_graph(self.root)

    def test_explicit_invalid_root_never_selects_a_different_checkout(self):
        with self.assertRaises(SystemExit):
            graph._discover_root(str(self.root/'missing'))

    def test_cited_symbol_in_a_comment_does_not_pass_reference_gate(self):
        self.write(self.crate/'src/lib.rs', '// fn entry() {}\nconst S: &str = "entry";\n')
        with self.assertRaisesRegex(ValueError, 'symbol missing'):
            self.cli('--emit')

    def test_cargo_binary_entries_and_real_view_declarations(self):
        self.write(self.crate/'src/bin/hidden.rs', 'fn main() {}')
        c = graph.build_graph(self.root).crates['demo']
        self.assertEqual(len(entrypoints(c, {'package': {'autobins': False}})), 1)
        self.assertEqual(len(entrypoints(c, {'package': {}})), 2)
        self.write(self.crate/'src/views/mod.rs', '// pub mod fake;\npub mod first;\npub(crate) mod second;\n')
        self.write(self.crate/'src/views/first.rs', 'fn first() {}')
        self.write(self.crate/'src/views/second/mod.rs', 'fn second() {}')
        self.assertEqual([r[0] for r in registered_views(c)], ['first', 'second'])
        self.write(self.crate/'src/views/mod.rs', 'pub mod absent;')
        with self.assertRaisesRegex(ValueError, 'cannot resolve'):
            registered_views(c)


if __name__ == '__main__':
    unittest.main()
