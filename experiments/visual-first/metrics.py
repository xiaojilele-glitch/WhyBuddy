"""五系统模型的客观度量——两组用同一把尺子。

## 为什么要这份文件

这个实验要回答的是一句主观感受：「AI 看不到页面时，关联关系推得不准」。
主观感受不能靠再看一眼产出来验证——**看的人已经知道哪份是哪组了**。
所以先把「准」拆成能数出来的东西，尺子写死在代码里，跑之前就定好。

## 尺子分三类

1. **闸口**：结构闸的 findings 数。现成的、确定性的，两组同一份判据。
2. **关联密度**：ref 字段数 / 声明完整率 / 悬空率。
   `ref` 字段就是实体之间的关联本身——这一项直接对应他要问的问题。
   工作流的连通性、权限对页面动作的覆盖率同理，都是"跨系统引用"。
3. **spec 覆盖**：spec 里点名的业务名词，datamodel 里认不认得。
   这条防的是"模型自己编了一套很漂亮但跟需求无关的东西"。

## 一条纪律

名词表**只从 spec 抽一次**，两组共用，且在看到任何产出之前定好。
边看产出边调尺子就是自证。
"""

from __future__ import annotations

import json
import re
from typing import Any


def _entities(model: dict) -> list[dict]:
    return ((model.get("datamodel") or {}).get("entities")) or []


def _pages(model: dict) -> list[dict]:
    return ((model.get("page") or {}).get("pages")) or []


def relation_metrics(model: dict) -> dict[str, Any]:
    """跨系统引用的密度与完整度——「关联关系准不准」的可数版本。"""
    ents = _entities(model)
    entity_ids = {e.get("id") for e in ents}
    ref_total = ref_declared = ref_dangling = 0
    field_total = 0

    for e in ents:
        for f in e.get("fields") or []:
            field_total += 1
            if f.get("type") != "ref":
                continue
            ref_total += 1
            target = f.get("refEntity")
            if target:
                ref_declared += 1
                if target not in entity_ids:
                    ref_dangling += 1

    wf = model.get("workflow") or {}
    nodes = wf.get("nodes") or []
    trans = wf.get("transitions") or []
    node_ids = {n.get("id") for n in nodes}
    # 连通性：把转移当无向边，看是不是一张连通图。断成两片说明流程没接上。
    adj: dict[str, set[str]] = {n: set() for n in node_ids}
    for t in trans:
        a, b = t.get("from"), t.get("to")
        if a in adj and b in adj:
            adj[a].add(b)
            adj[b].add(a)
    connected = True
    if node_ids:
        seen, stack = set(), [next(iter(node_ids))]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(adj.get(cur, ()) - seen)
        connected = len(seen) == len(node_ids)

    perms = set((model.get("rbac") or {}).get("permissions") or [])
    page_actions: set[str] = set()
    for p in _pages(model):
        page_actions.update(p.get("actionPermissions") or [])
    covered = len(page_actions & perms)

    bindings = sum(len(p.get("fieldBindings") or []) for p in _pages(model))
    blocks = sum(len(p.get("blocks") or []) for p in _pages(model))

    return {
        "entities": len(ents),
        "fields": field_total,
        "ref_fields": ref_total,
        "ref_declared": ref_declared,
        "ref_dangling": ref_dangling,
        "wf_nodes": len(nodes),
        "wf_transitions": len(trans),
        "wf_connected": connected,
        "permissions": len(perms),
        "page_actions": len(page_actions),
        "page_actions_covered": covered,
        "pages": len(_pages(model)),
        "blocks": blocks,
        "field_bindings": bindings,
        "aigc_capabilities": len(((model.get("aigc") or {}).get("capabilities")) or []),
        "invariants": len(((model.get("appbundle") or {}).get("invariants")) or []),
    }


def spec_coverage(model: dict, terms: list[str]) -> dict[str, Any]:
    """spec 点名的业务名词，datamodel + page 里认不认得。

    只做子串命中，不做同义词——同义词判定要再叫一次 LLM，那把尺子就有方差了，
    而尺子有方差的对照实验等于没做。宁可这条偏保守，两组一起偏。
    """
    hay = json.dumps(
        {"datamodel": model.get("datamodel"), "page": model.get("page")},
        ensure_ascii=False,
    )
    hit = [t for t in terms if t and t in hay]
    return {
        "terms_total": len(terms),
        "terms_hit": len(hit),
        "terms_missed": sorted(set(terms) - set(hit)),
        "coverage": round(len(hit) / len(terms), 3) if terms else 0.0,
    }


def fabrication_smell(model: dict) -> dict[str, Any]:
    """臆造气味：占位式命名有多少。

    参照图上写的是「客户A」「示例公司」「负责人占位」——它们是**故意的占位**
    （生图提示词原话：只示意不写真实数据）。如果这些词漏进了 datamodel 的
    字段名/枚举值，就说明反推把占位当成了契约。这正是"从渲染里取语义"最怕的
    那件事，所以单独数一列。
    """
    pat = re.compile(r"占位|示例|placeholder|sample|示意|demo|测试|XX|xx{2,}")
    hits: list[str] = []
    for e in _entities(model):
        for f in e.get("fields") or []:
            for label in (f.get("name"), f.get("id")):
                if label and pat.search(str(label)):
                    hits.append(f"{e.get('id')}.{f.get('id')}")
            for opt in f.get("options") or []:
                if pat.search(str(opt.get("label") or "")):
                    hits.append(f"{e.get('id')}.{f.get('id')}={opt.get('label')}")
    return {"fabrication_hits": len(hits), "fabrication_where": hits[:10]}


def measure(model: dict, gate_result: dict, terms: list[str]) -> dict[str, Any]:
    findings = gate_result.get("findings") or []
    return {
        "gate_passed": bool(gate_result.get("passed")),
        "gate_findings": len(findings),
        "gate_findings_text": [str(f)[:160] for f in findings[:8]],
        **relation_metrics(model),
        **spec_coverage(model, terms),
        **fabrication_smell(model),
    }
