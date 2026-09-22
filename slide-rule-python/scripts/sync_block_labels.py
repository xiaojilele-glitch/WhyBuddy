"""把区块中文名从渲染器注册表搬进目录 JSON（真相源）。

    cd slide-rule-python
    .venv/bin/python scripts/sync_block_labels.py --check    # 只查差异，CI 用
    .venv/bin/python scripts/sync_block_labels.py            # 写回目录

## 为什么要搬

中文名一直是有的——`client/src/pages/sliderule/live-runtime/block-registry.tsx`
里每个区块都带 `label`（FilterBar → 「筛选条」，TrendChart → 「趋势图」），
111 个一个不缺。**但它只活在那一个 TSX 文件里**，于是：

  · `component-search.buildIndex(labelOf, …)` 靠调用方注入。组件库页面注入了
    真名字，而 `__tests__/component-search.test.ts` 注入的是 `() => undefined`
    ——**测出来的排序和用户看到的排序不是同一份**。这是 2026-08-09 排查
    「订单筛选」排序时发现的：我一度据此断定"区块没有中文名"，那个判断是错的，
    错在拿测试夹具当了产品现状。
  · Python 侧（拼提示词、门禁、装配）根本读不到中文名——那个 TSX 搬不过去。

目录 JSON 是两侧共用的唯一真相源，中文名理应待在那里。搬过去之后
`labelOf` 退化成可选覆盖，注入不注入都拿得到名字。

## 为什么是"搬"而不是"重新生成一份"

registry 里那 111 个名字是随渲染器一起写的，跟界面上真正显示的标题一致。
让模型另生成一份必然与之漂移，而且漂移看不出来。**已有的真话就别再编一遍。**

`--check` 是给 CI 的：以后在 registry 里改了名字忘了同步，这条先响。

## 落盘方式

按行插入，不重新序列化整份 JSON——原文件把短对象压在一行，`indent=2` 回写
会产生五千行重排（label_block_generality.py 里记着这笔账）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "services" / "data" / "experience_block_catalog.json"
REGISTRY = (
    ROOT.parent / "client" / "src" / "pages" / "sliderule" / "live-runtime" / "block-registry.tsx"
)
DYNAMIC_LABEL_SOURCES = [
    REGISTRY.with_name("configuration-wizard-batch.tsx"),
    REGISTRY.with_name("collaboration-content-blocks.tsx"),
    REGISTRY.with_name("data-governance-blocks.tsx"),
    REGISTRY.with_name("hierarchy-selection-blocks.tsx"),
]

#: BLOCK_DEFINITIONS 的条目形如 `    FilterBar: { render: …, label: "筛选条", … },`
#: 四空格缩进锚定的是注册表那张字面量表，避免匹配到组件内部的 `label:` 选项。
_ENTRY_RE = re.compile(r'^\s{4}(\w+):\s*\{[^\n]*?label:\s*"([^"]+)"', re.MULTILINE)
_MULTILINE_CONFIG_RE = re.compile(
    r'^\s{2}(\w+):\s*\{\r?\n\s{4}title:\s*"([^"]+)"', re.MULTILINE
)
_INLINE_CONFIG_RE = re.compile(
    r'(\w+):\s*\{[^\n{}]*?title:\s*"([^"]+)"[^\n{}]*?\}'
)

#: 块级键的缩进；propsSchema 内部也有 "type"，靠缩进区分。
_BLOCK_TYPE_LINE = '      "type": "'
_BLOCK_LABEL_LINE = '      "label": "'
_BLOCKS_START = '  "blocks": ['
_BLOCKS_END = "  ],"


def labels_from_registry() -> dict[str, str]:
    labels = {m[1]: m[2] for m in _ENTRY_RE.finditer(REGISTRY.read_text(encoding="utf-8"))}
    for source in DYNAMIC_LABEL_SOURCES:
        text = source.read_text(encoding="utf-8")
        labels.update({m[1]: m[2] for m in _MULTILINE_CONFIG_RE.finditer(text)})
        labels.update({m[1]: m[2] for m in _INLINE_CONFIG_RE.finditer(text)})
    return labels


def block_label_counts(text: str) -> dict[str, int]:
    """Count top-level label keys per catalog block without hiding duplicate JSON keys."""
    counts: dict[str, int] = {}
    current: str | None = None
    in_blocks = False
    for line in text.split("\n"):
        if line == _BLOCKS_START:
            in_blocks = True
            continue
        if in_blocks and line == _BLOCKS_END:
            break
        if not in_blocks:
            continue
        if line.startswith(_BLOCK_TYPE_LINE):
            current = line[len(_BLOCK_TYPE_LINE) :].split('"', 1)[0]
            counts[current] = 0
        elif current and line.startswith(_BLOCK_LABEL_LINE):
            counts[current] += 1
    return counts


def rewrite_catalog_labels(text: str, labels: dict[str, str]) -> tuple[str, int]:
    """Replace every block's top-level label while preserving its field order."""
    lines = text.split("\n")
    out: list[str] = []
    wrote = 0
    in_blocks = False
    index = 0
    while index < len(lines):
        line = lines[index]
        if line == _BLOCKS_START:
            in_blocks = True
            out.append(line)
            index += 1
            continue
        if in_blocks and line == _BLOCKS_END:
            in_blocks = False
            out.append(line)
            index += 1
            continue
        if not (in_blocks and line.startswith(_BLOCK_TYPE_LINE)):
            out.append(line)
            index += 1
            continue

        block_type = line[len(_BLOCK_TYPE_LINE) :].split('"', 1)[0]
        end = index + 1
        while end < len(lines) and lines[end] != _BLOCKS_END and not lines[end].startswith(_BLOCK_TYPE_LINE):
            end += 1
        chunk = lines[index:end]
        label = labels.get(block_type)
        label_indexes = [i for i, chunk_line in enumerate(chunk) if chunk_line.startswith(_BLOCK_LABEL_LINE)]
        if label is not None:
            replacement = f'      "label": "{label}",'
            if label_indexes:
                chunk[label_indexes[0]] = replacement
                for duplicate_index in reversed(label_indexes[1:]):
                    del chunk[duplicate_index]
            else:
                chunk.insert(1, replacement)
            wrote += 1
        out.extend(chunk)
        index = end
    return "\n".join(out), wrote


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报差异，不写文件")
    args = ap.parse_args()

    labels = labels_from_registry()
    catalog_text = CATALOG.read_text(encoding="utf-8")
    catalog = json.loads(catalog_text)
    blocks = catalog["blocks"]
    print(f"注册表 {len(labels)} 个中文名，目录 {len(blocks)} 个区块")

    missing = [b["type"] for b in blocks if b["type"] not in labels]
    stale = [
        b["type"]
        for b in blocks
        if b.get("label") and b["type"] in labels and b["label"] != labels[b["type"]]
    ]
    todo = [b["type"] for b in blocks if b["type"] in labels and b.get("label") != labels[b["type"]]]
    duplicate_labels = [block_type for block_type, count in block_label_counts(catalog_text).items() if count > 1]

    if missing:
        print(f"注册表里没有中文名的 {len(missing)} 个：{', '.join(missing)}")
    if stale:
        print(f"与注册表不一致的 {len(stale)} 个：{', '.join(stale)}")
    if duplicate_labels:
        print(f"存在重复 label 键的 {len(duplicate_labels)} 个：{', '.join(duplicate_labels)}")

    if args.check:
        if todo or duplicate_labels:
            print(
                f"\n目录需同步：{len(todo)} 个名称差异，{len(duplicate_labels)} 个重复 label",
                file=sys.stderr,
            )
            return 1
        print("目录与注册表一致")
        return 0

    rewritten, wrote = rewrite_catalog_labels(catalog_text, labels)
    CATALOG.write_text(rewritten, encoding="utf-8")
    print(f"已写回 {wrote} 个中文名")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
