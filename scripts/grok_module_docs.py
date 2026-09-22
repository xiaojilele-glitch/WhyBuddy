"""Render code inventories together with reviewed, source-linked reading notes.

Numbers and Cargo edges are computed; responsibilities and flow explanations are
curated in grok-module-notes-*.json. Never pretend that a filename proves a call
chain. Missing evidence makes generation fail rather than emit a plausible link.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

from grok_rust_inventory import rust_code

MODULE = re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;', re.M)
KIND = {'source': '实现路径（可含内嵌测试）', 'test': '独立测试路径', 'bench': '基准路径', 'example': '示例路径'}


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', '<br/>')


def table(lines, headings, rows):
    lines.extend(['| ' + ' | '.join(headings) + ' |', '|' + '|'.join('---' for _ in headings) + '|'])
    for row in rows:
        lines.append('| ' + ' | '.join(cell(v) for v in row) + ' |')
    lines.append('')


def link(path, output_dir, label=None, line=None):
    target = quote(os.path.relpath(path, output_dir).replace('\\', '/'), safe='/.-_')
    if line:
        target += f'#L{line}'
    return f'[{label or path.name}]({target})'


def evidence_path(crate, rel, root):
    path = (crate.path / rel).resolve()
    if not path.is_relative_to(root.resolve()) or not path.exists():
        raise ValueError(f'{crate.name}: missing or external evidence: {rel}')
    return path


def symbol_line(path, symbol):
    # A reference can name a type or method, not necessarily a definition.
    # Match only code tokens so an explanatory comment cannot satisfy the gate.
    code = rust_code(path.read_text(encoding='utf-8'), mask_literals=True)
    name = symbol.split('::')[-1]
    pattern = re.compile(r'\b' + re.escape(name) + r'\b')
    definition = re.search(r'\b(?:fn|struct|enum|trait|type|mod)\s+' + re.escape(name) + r'\b', code)
    found = definition or pattern.search(code)
    if not found:
        raise ValueError(f'{path}: evidence symbol missing from code: {symbol}')
    return code.count('\n', 0, found.start()) + 1


def normalize_notes(raw):
    if 'crates' in raw:
        return {item['crate']: item for item in raw['crates']}
    # Core research notes keep steps as prose and collect their evidence per flow.
    result = {}
    for name, item in raw.items():
        result[name] = {
            'purpose': item['summary'], 'boundaries': {'owns': [item['boundary']]},
            'subsystems': [{'path': s['paths'][0], 'responsibility': s['purpose'],
                            'name': s['name'], 'evidence': s['paths'][1:]} for s in item['sections']],
            'flows': [{'name': f['title'], 'steps': f['steps'], 'evidence': f['evidence']} for f in item['flows']],
            'reuse_items': item['reuse'], 'reading_order': item['reading_order'],
            'tests': item['tests'], 'pitfalls': item.get('pitfalls', []),
        }
    return result


def load_notes(repo, graph, targets):
    result = {}
    for path in sorted((repo / 'scripts').glob('grok-module-notes-*.json')):
        raw = json.loads(path.read_text(encoding='utf-8'))
        for name, note in normalize_notes(raw).items():
            if name in result:
                raise ValueError(f'duplicate reading notes for {name}: {path}')
            note['_source'] = path
            result[name] = note
    for name in targets:
        if name not in result or name not in graph.crates:
            raise ValueError(f'detailed module not covered by notes/workspace: {name}')
        note, crate = result[name], graph.crates[name]
        for section in note['subsystems']:
            evidence_path(crate, section['path'], graph.root)
            for rel in section.get('evidence', []):
                evidence_path(crate, rel, graph.root)
        for flow in note['flows']:
            for step in flow['steps']:
                if isinstance(step, dict):
                    p = evidence_path(crate, step['path'], graph.root)
                    if step.get('symbol'):
                        symbol_line(p, step['symbol'])
            for rel in flow.get('evidence', []):
                evidence_path(crate, rel, graph.root)
        for row in note.get('tests', []) + note.get('reading_order', []):
            evidence_path(crate, row['path'], graph.root)
        for row in note.get('reuse_items', []):
            for rel in row.get('evidence', []):
                evidence_path(crate, rel, graph.root)
        for rel in note.get('reuse', {}).get('whybuddy_paths', []):
            if not (repo / rel).is_file():
                raise ValueError(f'{name}: WhyBuddy reference missing: {rel}')
    return result


def stats(files):
    return [len(files), f'{sum(f.source for f in files):,}', f'{sum(f.raw for f in files):,}']


def subset(files, rel):
    rel = rel.rstrip('/')
    return [f for f in files if f.rel == rel or f.rel.startswith(rel + '/')]


def fingerprint(crate, files):
    data = '\n'.join(f'{f.rel}:{f.digest}' for f in sorted(files, key=lambda f: f.rel))
    data += '\n' + (crate.path / 'Cargo.toml').read_text(encoding='utf-8')
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def dependencies_mermaid(graph, name):
    neighbors = {name}
    edges = [(a, b) for a, b in sorted(graph.edges) if name in (a, b)]
    for a, b in edges:
        neighbors.update((a, b))
    ids = {n: f'n{i}' for i, n in enumerate(sorted(neighbors))}
    result = ['flowchart LR']
    result += [f'  {ids[n]}["{n}"]' for n in sorted(neighbors)]
    result += [f'  {ids[a]} --> {ids[b]}' for a, b in edges]
    result.append(f'  style {ids[name]} fill:#dbeafe,stroke:#2563eb,stroke-width:3px')
    return '\n'.join(result)


def entrypoints(crate, manifest):
    rows = []
    lib = manifest.get('lib', {})
    if 'lib' in manifest or (crate.path / 'src/lib.rs').is_file():
        rows.append(('library', lib.get('name', crate.name.replace('-', '_')), lib.get('path', 'src/lib.rs')))
    seen = set()
    for spec in manifest.get('bin', []):
        name = spec['name']
        candidates = [f'src/bin/{name}.rs', f'src/bin/{name}/main.rs', 'src/main.rs']
        rel = spec.get('path') or next((p for p in candidates if (crate.path / p).is_file()), None)
        if rel is None:
            raise ValueError(f'{crate.name}: binary entry missing for {name}')
        seen.add(rel)
        rows.append(('binary' + (' / feature: ' + ', '.join(spec['required-features']) if spec.get('required-features') else ''), name, rel))
    if manifest.get('package', {}).get('autobins', True):
        automatic = [crate.path / 'src/main.rs']
        automatic += sorted((crate.path / 'src/bin').glob('*.rs'))
        automatic += sorted((crate.path / 'src/bin').glob('*/main.rs'))
        for p in automatic:
            rel = p.relative_to(crate.path).as_posix()
            if p.is_file() and rel not in seen:
                name = crate.name if rel == 'src/main.rs' else p.parent.name if p.name == 'main.rs' else p.stem
                rows.append(('binary（Cargo 自动发现）', name, rel))
    return rows


def registered_views(crate):
    registry = crate.path / 'src/views/mod.rs'
    code = rust_code(registry.read_text(encoding='utf-8'), mask_literals=True)
    rows = []
    for match in MODULE.finditer(code):
        name = match.group(1)
        for rel in (f'src/views/{name}.rs', f'src/views/{name}/mod.rs'):
            if (crate.path / rel).is_file():
                rows.append((name, rel, code.count('\n', 0, match.start()) + 1))
                break
        else:
            raise ValueError(f'{crate.name}: cannot resolve views module {name}; check #[path]')
    return rows


def render_detail(graph, crate, note, output_dir, repo, manifest):
    files = graph.files[crate.name]
    source_link = lambda rel, label=None, line=None: link(evidence_path(crate, rel, graph.root), output_dir, label or rel, line)
    lines = [f'# {crate.name}：模块详解', '', f'[返回十模块索引](README.md) · [返回全仓总览](../{quote("grok-build 模块总览（自动生成）.md")})', '',
             '> 自动统计 + 源码阅读说明。修改 scripts/grok-module-notes-*.json 中的解读，运行 `pnpm run arch:grok:details` 更新。', '',
             note['purpose'], '', '## 源码版本与统计口径', '',
             f'- grok-build SOURCE_REV：`{graph.source_rev or "未提供"}`；解读审阅基于 `c4ea71cfdbcdb21e32e41bc25a0043d7d4836714`。',
             f'- Rust 源码及 Cargo.toml 指纹：`{fingerprint(crate, files)}`。',
             '- raw LOC 是物理行；source LOC 是去注释后的非空行，保留字符串内容。扫描全部 crate 下 .rs，排除 target/ 和 fuzz/，不展开 feature、宏或 include。',
             '- 下表分类按路径互斥分桶；实现路径可能含 #[cfg(test)] 内嵌测试，不能把这一列当成纯生产代码。场景 YAML、提示词 Markdown、快照等非 Rust 资产另见下文。',
             '- 依赖方向 A → B 表示 A 的 Cargo 清单依赖 B，含 build/target/optional 的静态并集，不含 dev-dependencies；不是运行时调用图。',
             '- 调用链文字是源码阅读结果，引用检查只验证文件/符号存在。本次没有执行 grok 二进制、Rust 测试或浏览器业务验收。', '']
    if graph.source_rev != 'c4ea71cfdbcdb21e32e41bc25a0043d7d4836714':
        lines += ['> 当前源码版本已变化：目录与行数已重算；人工解读须对新版本复核。', '']
    table(lines, ['类别', '.rs 文件', 'source LOC', 'raw LOC'],
          [(KIND[k], *stats([f for f in files if f.kind == k])) for k in KIND] + [('总计', *stats(files))])
    lines += ['## 职责边界', '']
    for key, title in [('owns', '本模块负责'), ('does_not_own', '协作边界')]:
        if note.get('boundaries', {}).get(key):
            lines += [f'**{title}**', ''] + [f'- {s}' for s in note['boundaries'][key]] + ['']
    lines += ['## 入口与导出', '']
    entries = entrypoints(crate, manifest)
    table(lines, ['类型', '名称', '真实入口'], [(kind, f'`{name}`', source_link(rel)) for kind, name, rel in entries])
    for kind, _, rel in entries:
        if kind == 'library':
            code = rust_code((crate.path / rel).read_text(encoding='utf-8'), mask_literals=True)
            names = [m.group(1) for m in MODULE.finditer(code)]
            lines += ['库入口的词法 `mod` 声明（可能受 cfg 控制）：' + '、'.join(f'`{n}`' for n in names) + '。', '']
    lines += ['## 内部怎么拆：职责与源码', '']
    rows = []
    for s in note['subsystems']:
        refs = [s['path']] + s.get('evidence', [])
        rows.append((s.get('name', s['path']), s['responsibility'], '；'.join(source_link(p) for p in refs), *stats(subset(files, s['path']))))
    table(lines, ['子系统', '做什么', '阅读入口', '入口覆盖 .rs', 'source LOC', 'raw LOC'], rows)
    lines += ['上表行数仅覆盖该行首个阅读入口的文件/目录，入口可能重叠；下表按 src 一级目录及 tests/benches 等桶互斥统计，可以相加。', '', '## 目录体积', '']
    buckets = defaultdict(list)
    for f in files:
        parts = Path(f.rel).parts
        bucket = 'src/（根文件）' if parts[0] == 'src' and len(parts) == 2 else '/'.join(parts[:2]) if parts[0] == 'src' else parts[0]
        buckets[bucket].append(f)
    table(lines, ['目录桶', '.rs', 'source LOC', 'raw LOC', '其中独立测试 source LOC'],
          [(b, *stats(fs), f'{sum(f.source for f in fs if f.kind == "test"):,}') for b, fs in sorted(buckets.items(), key=lambda x: (-sum(f.source for f in x[1]), x[0]))])
    lines += ['## 关键链路与源码阅读路径', '']
    for flow in note['flows']:
        lines += [f'### {flow["name"]}', '']
        for i, step in enumerate(flow['steps'], 1):
            if isinstance(step, str):
                lines.append(f'{i}. {step}')
            else:
                path = evidence_path(crate, step['path'], graph.root)
                line = symbol_line(path, step['symbol']) if step.get('symbol') else None
                lines.append(f'{i}. {source_link(step["path"], step.get("symbol"), line)}：{step["detail"]}')
        lines.append('')
        if flow.get('evidence'):
            lines += ['源码依据：' + '；'.join(source_link(p) for p in flow['evidence']) + '。', '']
    if crate.name == 'xai-grok-pager':
        render_views(lines, crate, note, files, source_link, repo)
    lines += ['## 直接依赖与被依赖', '', '图中的每条边都来自 Cargo 扫描；边界内的可选依赖可能仅在特定构建配置启用。', '', '```mermaid', dependencies_mermaid(graph, crate.name), '```', '']
    for heading, names in [('本模块依赖', [b for a, b in sorted(graph.edges) if a == crate.name]), ('使用本模块', [a for a, b in sorted(graph.edges) if b == crate.name])]:
        lines += [f'**{heading}（{len(names)}）**', '']
        table(lines, ['crate', 'Cargo 用途/模块说明'], [(f'`{n}`', graph.crates[n].description) for n in names])
    lines += ['## 测试依据与非 Rust 资产', '']
    if note.get('tests'):
        table(lines, ['已有测试阅读入口', '代码中覆盖的行为（本次未运行）'], [(source_link(t['path']), t['proves']) for t in note['tests']])
    table(lines, ['独立测试文件 Top 8', 'source LOC', 'raw LOC'], [(source_link(f.rel), f'{f.source:,}', f'{f.raw:,}') for f in [f for f in files if f.kind == 'test'][:8]])
    assets = defaultdict(list)
    for p in sorted(crate.path.rglob('*')):
        rel = p.relative_to(crate.path)
        if p.is_file() and not ({'target', '.git', 'fuzz'} & set(rel.parts)) and p.suffix.lower() in {'.md', '.json', '.yaml', '.yml', '.toml', '.snap', '.txt', '.proto'}:
            assets[p.suffix.lower()].append(rel.as_posix())
    table(lines, ['类型', '文件数', '示例（不计 Rust LOC）'], [(ext, len(paths), '；'.join(source_link(p) for p in paths[:3])) for ext, paths in sorted(assets.items())])
    lines += ['## 对 WhyBuddy 可以怎么用', '']
    reuse = note.get('reuse', {})
    for s in reuse.get('can_borrow', []):
        lines.append(f'- {s}')
    lines.append('')
    for s in note.get('reuse_items', []):
        lines += [f'**{s["name"]}**：{s["value"]} {s["adaptation"]}', '', '依据：' + '；'.join(source_link(p) for p in s['evidence']) + '。', '']
    if reuse.get('whybuddy_paths'):
        lines += ['WhyBuddy 当前可对照的文件（路径存在不等于业务已经对齐）：', '']
        lines += [f'- {link(repo / p, output_dir, p)}' for p in reuse['whybuddy_paths']] + ['']
    for s in reuse.get('migration_constraints', []) + note.get('pitfalls', []):
        lines.append(f'- {s}')
    lines += ['', '## 建议阅读顺序', '']
    order = note.get('reading_order') or [{'path': s['path'], 'reason': s['responsibility']} for s in note['subsystems'][:7]]
    for i, row in enumerate(order, 1):
        lines.append(f'{i}. {source_link(row["path"])}：{row["reason"]}')
    lines += ['', '## 大文件与完整 Rust 清单', '', '先看实现路径的 Top 15；它们仍可能带内嵌测试。下面的完整清单包含所有统计文件，方便继续拆到单个组件。', '']
    table(lines, ['实现路径 Top 15', 'source LOC', 'raw LOC'], [(source_link(f.rel), f'{f.source:,}', f'{f.raw:,}') for f in [f for f in files if f.kind == 'source'][:15]])
    lines += ['<details>', f'<summary>展开全部 {len(files)} 个 Rust 文件</summary>', '']
    table(lines, ['文件', '类别', 'source LOC', 'raw LOC'], [(source_link(f.rel), KIND[f.kind], f'{f.source:,}', f'{f.raw:,}') for f in sorted(files, key=lambda f: f.rel)])
    lines += ['</details>', '', '解读维护源：' + link(note['_source'], output_dir, note['_source'].name) + '。', '']
    return '\n'.join(lines)


def render_views(lines, crate, note, files, source_link, repo):
    views = registered_views(crate)
    lines += [f'## 面板拆解索引：{len(views)} 个 views 模块声明', '',
              '这来自 views/mod.rs 实际声明，不是手填数量。包含主界面、交互卡、选择器和绘制辅助模块；一次声明不等于一个独立页面，也不等于已接到运行链路。', '']
    registry = note.get('views_registry', {})
    for text in registry.get('runtime_owners', []):
        lines.append(f'- {text}')
    lines.append('')
    groups = {e: s['group'] for s in registry.get('split_basis', []) for e in s['entries']}
    purposes = json.loads((repo / 'scripts/grok-view-notes.json').read_text(encoding='utf-8'))
    stale = set(purposes) - {name for name, _, _ in views}
    if stale:
        raise ValueError(f'view reading notes no longer declared: {sorted(stale)}')
    table(lines, ['模块', '做什么', '拆分组', '入口/声明', '.rs', 'source LOC', 'raw LOC'], [
        (f'`{name}`', purposes.get(name, '新增视图，待补中文解读'), groups.get(name, '其他视图/辅助'), source_link(rel) + ' / ' + source_link('src/views/mod.rs', '声明', line),
         *stats(subset(files, str(Path(rel).parent).replace('\\', '/') if rel.endswith('/mod.rs') else rel))) for name, rel, line in views])
    table(lines, ['建议一起拆的组', '为什么要一起读'], [(s['group'], s['reason']) for s in registry.get('split_basis', [])])


def render_index(graph, targets, notes):
    lines = ['# grok-build：十个大模块拆解索引', '',
             '[全仓模块总览](../' + quote('grok-build 模块总览（自动生成）.md') + ')', '',
             '先用这页选模块，再到各自文档里找职责、入口、子系统、关键链路、测试和文件清单。所有行数与依赖由源码扫描；中文解读来自源码阅读，维护在 scripts/grok-module-notes-*.json。', '',
             '生成：`pnpm run arch:grok:details`；图、总览和详解一起刷新：`pnpm run arch:grok:emit`；核对全部生成物：`pnpm run arch:grok:check`。', '',
             f'SOURCE_REV：`{graph.source_rev or "未提供"}`。源码默认 ../grok-build，可用 GROK_BUILD_ROOT 指定。源码链接指向外部 checkout；GitHub 单独浏览 WhyBuddy 仓库时不会带上 grok 源码。', '',
             '## 十份详解', '']
    table(lines, ['模块', '职责', '.rs', 'source LOC', 'raw LOC'], [(f'[{name}]({name}.md)', notes[name]['purpose'], *stats(graph.files[name])) for name in targets])
    view_count = len(registered_views(graph.crates['xai-grok-pager'])) if 'xai-grok-pager' in graph.crates else 0
    lines += ['## 建议拆解顺序', '',
              f'1. **pager**：先找出 {view_count} 个视图声明、状态归属、输入和提交协议。问卷/批准/权限卡优先带着恢复链一起读。',
              '2. **shell + agent + tools**：把用户选择怎样恢复 turn、agent 如何装配工具、工具怎样交还结果连起来。',
              '3. **workspace + fast-worktree**：研究权限边界、文件与进程、工作树隔离、preview/browser 服务的宿主接口。',
              '4. **pager-render + PTY harness**：分别提取显示原语与可复现验证场景；Web 端的呈现和验证需要换成浏览器实现。',
              '5. **login + telemetry**：补足登录/凭证、事件结构、脱敏和运行诊断。', '',
              '每次继续拆一个子模块时，记录它接收什么、谁拥有状态、触发什么副作用、产生什么结果，以及哪条测试覆盖取消/恢复。不能只拿一段 render 函数就认定整套能力已经搬过去。', '',
              '## 当前快照的浏览器能力边界', '',
              '这份 grok-build 是公开的 CLI 源码快照。workspace 里 BrowserService 的部分描述保留在注释中，但 finalize_session_setup 没有实际注入浏览器，shutdown_browser_service 是空函数，browser_tab_chrome_e2e.rs 只有注释。权限、终端、工作树和可选 preview 接口有实现；完整浏览器服务需要另外接入。详见 [workspace 的源码依据](xai-grok-workspace.md)。', '',
              '## 数字如何理解', '',
              'source LOC 保留字符串、排除注释和空行，仍含内嵌测试。独立测试、基准和示例按路径分桶。修正了上一版字符串被误当注释、*_tests.rs 漏分的问题，因此源码版本相同也可能与旧表不同。', '',
              '图与清单覆盖的是静态声明，不是全部运行场景。本轮检查文档生成、文件/符号引用与图渲染，没有运行 grok Rust 全套测试，也没有搬迁十个模块的产品实现。', '']
    return '\n'.join(lines)
