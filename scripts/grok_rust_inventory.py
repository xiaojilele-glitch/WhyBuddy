"""Unbuilt Rust checkout inventory; no Cargo, network, or source rewriting.

2026-09-11: the first LOC report treated `"/*"` as a block comment and silently
discarded subsequent code. Keep Rust literals intact and handle nested comments.
This is a lexical line count, not a count of reachable production statements.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path


TOKEN = re.compile(
    r'(?<!\w)(?:br|cr|r)(?P<hashes>#{0,255})"'
    r'|(?:b|c)?"'
    r"|b?'(?:\\(?:u\{[\da-fA-F_]+\}|x[\da-fA-F]{2}|.)|[^'\\\n])'"
    r'|//[^\n]*|/\*'
)
STRING_END = re.compile(r'\\[\s\S]|"')
BLOCK = re.compile(r'/\*|\*/')


def blank(text: str) -> str:
    return re.sub(r'[^\r\n]', ' ', text)


def rust_code(text: str, *, mask_literals: bool = False) -> str:
    """Mask comments, optionally literals, while preserving line/column offsets."""
    result = []
    pos = 0
    while match := TOKEN.search(text, pos):
        result.append(text[pos:match.start()])
        token = match.group()
        end = match.end()
        comment = token.startswith(('//', '/*'))
        if token == '/*':
            depth = 1
            while depth:
                close = BLOCK.search(text, end)
                if close is None:
                    end = len(text)
                    break
                depth += 1 if close.group() == '/*' else -1
                end = close.end()
        elif match.group('hashes') is not None:
            delimiter = '"' + match.group('hashes')
            close = text.find(delimiter, end)
            end = len(text) if close < 0 else close + len(delimiter)
        elif not comment and token.endswith('"'):
            while True:
                close = STRING_END.search(text, end)
                if close is None:
                    end = len(text)
                    break
                end = close.end()
                if close.group() == '"':
                    break
        literal = text[match.start():end]
        result.append(blank(literal) if comment or mask_literals else literal)
        pos = end
    result.append(text[pos:])
    return ''.join(result)


def count_rust_lines(text: str) -> tuple[int, int]:
    return len(text.splitlines()), sum(bool(line.strip()) for line in rust_code(text).splitlines())


def file_kind(rel: str) -> str:
    parts = Path(rel).parts
    stem = Path(rel).stem
    if 'benches' in parts:
        return 'bench'
    if 'examples' in parts:
        return 'example'
    if (any(p == 'tests' or p.endswith('_tests') for p in parts[:-1])
            or stem in {'test', 'tests'} or stem.startswith('test_')
            or stem.endswith(('_test', '_tests'))):
        return 'test'
    return 'source'


@dataclass(frozen=True)
class RustFile:
    rel: str
    raw: int
    source: int
    kind: str
    digest: str


def inventory(crate_dir: Path) -> list[RustFile]:
    result = []
    for path in sorted(crate_dir.rglob('*.rs')):
        rel = path.relative_to(crate_dir).as_posix()
        if 'target' in Path(rel).parts or rel.startswith('fuzz/'):
            continue
        data = path.read_bytes()
        # Normalize line endings for stable fingerprints across Windows/Linux.
        text = data.decode('utf-8').replace('\r\n', '\n')
        raw, source = count_rust_lines(text)
        result.append(RustFile(rel, raw, source, file_kind(rel),
                               hashlib.sha256(text.encode('utf-8')).hexdigest()))
    return sorted(result, key=lambda item: (-item.source, item.rel))
