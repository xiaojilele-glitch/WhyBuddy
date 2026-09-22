# -*- coding: utf-8 -*-
"""精修作用域第二判官：LLM 只报**种子节点**，扩散交给图算（2026-08-17）。

## 为什么在 refine_page_scope 之外再有一个

`refine_page_scope` 让 LLM 直接猜"要重画哪几页"——判断和扩散混在一次 LLM
调用里。它答不了这个系统真正要答的问题：**"改这一块，牵扯的工作流/权限/
数据模型也要跟着动"**。页面只是木偶；那三只手不在页面清单上。

这里把两件事拆开，各归各的擅长者：

    LLM 判种子    "这句话直接点名要改的是哪几个节点"——语义题，图答不了
    图算扩散      "这些节点牵扯到什么"——机械题，LLM 猜不准且每次猜的不一样

## 跟 Aider ContextCoder 的分工差异（2026-08-17 对着原文核过）

本仓的 refine_page_scope 取自 Aider 的 ContextCoder。但那套让模型报
**完整**影响清单（"Return the *complete* list of files which will need to
be modified"）——因为 Aider 手里没有一张可靠的依赖图，只能求模型想全。
我们有（`services/app_graph.py`，契约钉在 shared/app-graph/edge-contract.json，
48 份真机模型验过）。所以这里反过来：**模型只报直接点名的，宁窄勿宽**，
牵连由 `impacted_closure` 确定性地扩。同年的 blast-radius 工具
（scope / graphyn / nodestradamus）全是同一形状：图的构建与遍历零 LLM、
深度限制、方向可选——扩散这一步没有一家交给模型。

## 执行模式（2026-08-18 从影子切过来）

出生时是影子（只打对照日志不改行为，纪律五：先拿真机对照）。2026-08-18
攒到两轮真机对照后由用户拍板切执行：加列那轮文本/图完全一致且图更窄；
改权限那轮种子带角色、两跳扩全图——宽了但方向安全（多画不会画错）。

现在 `spec_first_pipeline` 第 2.85 步按**判官阶梯**用它：图闭包页 →（缺席时）
文本判 →（再缺席）全量重画，每一级 fail-open 且比上一级宽。
`SLIDERULE_GRAPH_SCOPE_DRIVE=0` 退回纯影子。对照日志在执行期照打——它仍是
hops 标定集的唯一来源。判据在 `tests/test_refine_graph_scope.py` 的
「图判决定重画范围」那组；退回影子的行为钉在「开关关掉退回影子」。

形状对齐 Nx affected（种子 → 图遍历 → 只跑受影响的任务集）：扩散那一步
Nx / Turborepo / Bazel 没有一家交给模型猜，全是确定性遍历。

## hops=2 是拍的，标定继续攒

页 → 字段/权限 → 实体/角色，两跳够到"三只手"的第一层。按纪律六：改这个
数字要连同标定一起做，别只改数字。

⚠ 2026-08-18 过夜咖啡馆：种子落到 `role:staff`（或从一页两跳踩到它），
角色是跨簇的桥，再走一跳三页全吃——加一列红标却整栋重画。当时注释写
「宽但安全」，过夜证明宽得跟没判一样。修法不是改 hops（纪律六），是
**枢纽不当扩散起点**：种子只认本轮碰到的页/实体/字段；`role`/`perm`
落进闭包可以，不从它们往外走。Nx 后来也不再把 `package.json` 标成 `"*"`
隐式依赖，同一形状。`SLIDERULE_GRAPH_SCOPE_HUB_BARRIER=0` 退回老行为。

⚠ 2026-08-18 咖啡馆 10 轮：角色那条堵住了，大盘页还在当桥。p3 绑了预约/
积分/座位，从 `page:p3` 走两步三页全到——「给上座率加昨日环比」变成
重画 3、照搬 0。页可以当种子（`narrow_page_seeds` 必须留着），但**不从
页面往外走**。实体/字段种子仍能走到绑了它的页。hops 不动。
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _safe_print(msg: str) -> None:
    """Windows 控制台默认 GBK，⚠ 会 UnicodeEncodeError。

    2026-08-18 真机：同文件的警告符把 spec-first 整条打回老链路（见
    spec_first_pipeline._safe_print）。图判种子失败时这里也会 print ⚠，
    不接住的话影子对照永远攒不到标定集。
    """
    try:
        print(msg)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(msg.encode(encoding, errors="replace").decode(encoding, errors="replace"))


DEFAULT_HOPS = 2

#: 精修页作用域的种子。角色/权限是跨簇的桥，当种子或从它们往外走 =
#: 该角色能进的页全重画（过夜咖啡馆）。流程/能力点名了可以当种子，
#: 但不沿角色继续扫。
PAGE_SCOPE_SEED_KINDS = frozenset({"page", "entity", "field", "wf", "aigc"})
#: 种子收窄丢掉的 kind。**不要把 page 放进来**——放进来 `narrow_page_seeds`
#: 会把页种子整条扔掉，图判永远无页、永远回落文本判。
HUB_KINDS = frozenset({"role", "perm"})
#: 闭包算进这些节点，但不从它们往外走。page 在这里、不在 HUB_KINDS：
#: 大盘是种子，不是桥。
EXPAND_HUB_KINDS = frozenset({"role", "perm", "page"})


def hub_barrier_enabled() -> bool:
    """`SLIDERULE_GRAPH_SCOPE_HUB_BARRIER=0` 退回「沿角色扫全图」。默认开。"""
    from .env_flags import flag

    return flag("SLIDERULE_GRAPH_SCOPE_HUB_BARRIER", default=True)


def narrow_page_seeds(
    seeds: Iterable[str], graph: Dict[str, Any]
) -> Tuple[List[str], List[str]]:
    """留下页/实体/字段，枢纽种子单独记账。"""
    nodes = graph.get("nodes") or {}
    kept: List[str] = []
    dropped: List[str] = []
    for raw in seeds:
        nid = str(raw).strip()
        if not nid:
            continue
        kind = (nodes.get(nid) or {}).get("kind")
        if kind in PAGE_SCOPE_SEED_KINDS:
            kept.append(nid)
        else:
            dropped.append(nid)
    return kept, dropped

#: 节点太多时放弃图判（fail-open 到现状），不硬塞超长清单给 LLM——
#: 清单一长挑选质量掉得比省的那点还多。真机模型目前 50~120 个节点。
MAX_NODES_FOR_PROMPT = 400

_KIND_LABEL = {
    "page": "页面",
    "entity": "数据表（实体）",
    "field": "字段",
    "role": "角色",
    "perm": "权限",
    "wf": "流程节点",
    "aigc": "AIGC 能力",
}

_SYSTEM = (
    "你在判断一条修改要求**直接点名**要改的是应用里的哪几个节点。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 围栏。"
)

#: 同 refine_page_scope：这一步绝不产内容（Aider 的 `NEVER RETURN CODE!`）。
_NEVER_GENERATE = "**不要输出任何 HTML 或页面内容**，这一步只定位节点。"


def build_node_scope_prompt(
    instruction: str, graph: Dict[str, Any]
) -> List[Dict[str, str]]:
    """装配种子判定对话。graph 是 `build_app_graph` 的产物。"""
    by_kind: Dict[str, List[str]] = {}
    for nid, meta in (graph.get("nodes") or {}).items():
        kind = meta.get("kind")
        name = meta.get("name") or ""
        bare = nid.split(":", 1)[1]
        line = f"- {nid}" + (f"（{name}）" if name and name != bare else "")
        by_kind.setdefault(kind, []).append(line)

    sections = []
    for kind, label in _KIND_LABEL.items():
        if by_kind.get(kind):
            sections.append(f"{label}：\n" + "\n".join(sorted(by_kind[kind])))
    listing = "\n\n".join(sections)

    body = f"""这个应用由下面这些节点组成（页面只是外观，角色/权限/流程/数据表决定它怎么动）：

{listing}

用户提出的修改要求是：

{instruction.strip()[:2000]}

请判断这条要求**直接点名要改**的是哪几个节点。

{_NEVER_GENERATE}

输出这个形状：

{{"nodes": ["<节点id>", "..."], "why": "<一句话说清为什么是这几个>"}}

硬性要求：

1. **只列这句话直接点到的页面 / 数据表 / 字段**。不要列角色、权限、流程——
   沿角色扫会把该角色能进的所有页都吃进去（改一页红标变成整栋重画）。
   牵连关系系统会沿着图自动算，你多列反而会把范围撑大。
2. 节点 id **必须从上面的清单里挑**，不许新造、不许改写。
3. 判断标准：「不动这个节点，用户的要求就没被满足吗」。
4. 要求指名了某一页或某一张表，就列那个页面/实体/字段本身。
"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


def parse_node_scope(payload: Any, graph: Dict[str, Any]) -> Optional[List[str]]:
    """把 LLM 的回答收成**只含图上真实节点 id** 的清单。判不出来回 None。

    ⚠ 未知 id 直接丢掉，不做模糊匹配——同 refine_page_scope 的理由：
      模糊匹配对错人，会把"改 A"算成"牵扯 B 那一片"，且日志里长得跟正常一样。
    """
    if not isinstance(payload, dict):
        return None
    raw = payload.get("nodes")
    if not isinstance(raw, list):
        return None
    known = set((graph.get("nodes") or {}).keys())
    got = [str(x).strip() for x in raw if str(x).strip()]
    picked = [x for x in got if x in known]
    dropped = [x for x in got if x not in known]
    if dropped:
        _safe_print(f"[refine_graph_scope] ⚠ 模型报了图上没有的节点 id，已丢弃：{dropped[:8]}")
    return picked


def decide_seed_nodes(
    instruction: str,
    graph: Dict[str, Any],
    *,
    llm_json_fn=None,
) -> Optional[List[str]]:
    """判定这条指令直接点中的节点。返回 None = 判不出来。

    ⚠ 增强类，fail-open（纪律七）：任何失败都回 None，由调用方退回现状行为。
      空清单也按判错处理——一条精修指令一个节点都点不中，多半是没读懂。
    """
    if not (instruction or "").strip():
        return None
    nodes = graph.get("nodes") or {}
    if not nodes:
        return None
    if len(nodes) > MAX_NODES_FOR_PROMPT:
        _safe_print(
            f"[refine_graph_scope] ⚠ 图有 {len(nodes)} 个节点，超过 {MAX_NODES_FOR_PROMPT}，"
            "放弃图判作用域（清单太长挑选质量不可信）"
        )
        return None
    try:
        from .spec_llm_call import call_spec_json

        outcome = call_spec_json(
            build_node_scope_prompt(instruction, graph),
            llm_json_fn,
            stage="specfirst.graphscope",
        )
        picked = parse_node_scope(outcome.payload, graph)
    except Exception as exc:  # noqa: BLE001 — 增强类，不许打死主链路
        _safe_print(f"[refine_graph_scope] ⚠ 图判种子失败：{str(exc)[:200]}")
        return None
    if not picked:
        _safe_print("[refine_graph_scope] ⚠ 图判种子没给出可用节点")
        return None
    if hub_barrier_enabled():
        kept, hubs = narrow_page_seeds(picked, graph)
        if hubs:
            _safe_print(
                "[refine_graph_scope] 枢纽种子丢弃（不当页作用域起点）："
                + "、".join(hubs)
            )
        if not kept:
            _safe_print("[refine_graph_scope] ⚠ 图判种子只剩角色/权限，不当页作用域")
            return None
        return kept
    return picked


def graph_scope_verdict(
    graph: Dict[str, Any],
    seeds: List[str],
    *,
    hops: int = DEFAULT_HOPS,
) -> Dict[str, Any]:
    """种子 → 闭包 → 翻成"哪几页、哪几段"。

    返回：

        {"seeds": [...], "impacted": [...],       # 图节点 id
         "pages": [...],                          # 裸页面 id（对齐模型/SPEC 用）
         "segments": [...]}                       # 五系统段名

    ⚠ pages 必须是**裸 id**（去掉 `page:` 前缀）：消费侧（SPEC 页面清单、
      reuse_pages 的键）都是裸 id。带着前缀对不上任何东西，且不会报错——
      表现是"影子对照里两边永远零交集"，那是尺子坏了不是数据坏了。
    """
    from .app_graph import impacted_closure, segments_touched

    raw_seeds = [str(s).strip() for s in seeds if str(s).strip()]
    page_seeds = list(raw_seeds)
    dropped_hubs: List[str] = []
    no_expand = None
    if hub_barrier_enabled():
        page_seeds, dropped_hubs = narrow_page_seeds(raw_seeds, graph)
        no_expand = EXPAND_HUB_KINDS
        if dropped_hubs:
            _safe_print(
                "[refine_graph_scope] 闭包不沿枢纽扩散："
                + "、".join(dropped_hubs)
            )
    impacted = (
        impacted_closure(
            graph, page_seeds, hops=hops, direction="both",
            no_expand_kinds=no_expand,
        )
        if page_seeds
        else set()
    )
    if dropped_hubs:
        impacted |= set(dropped_hubs)
    nodes = graph.get("nodes") or {}
    pages = sorted(
        nid.split(":", 1)[1]
        for nid in impacted
        if nodes.get(nid, {}).get("kind") == "page"
    )
    return {
        "seeds": sorted(page_seeds),
        "droppedHubs": dropped_hubs,
        "impacted": sorted(impacted),
        "pages": pages,
        "segments": sorted(segments_touched(graph, impacted)),
    }


def shadow_compare_line(
    text_scope: Optional[List[str]],
    verdict: Optional[Dict[str, Any]],
) -> str:
    """影子对照的日志行。这行是这次接线的**全部产出**——拿它攒标定集。

    读法：`只有图有` 里反复出现同一类页面 → 文本判漏了牵连；
    `只有文本有` 反复出现 → 图缺边或 LLM 种子判窄了；
    两边页面 id 完全对不上 → 页面 id 跨轮重铸（第 4 步要修的那个）。
    """
    text_pages = set(text_scope or [])
    if verdict is None:
        return f"[refine_graph_scope] 影子对照：图判失败/未启用；文本挑页={sorted(text_pages) or '(全量)'}"
    graph_pages = set(verdict.get("pages") or [])
    return (
        "[refine_graph_scope] 影子对照："
        f"种子={','.join(verdict.get('seeds') or []) or '(无)'}"
        f" 图闭包页={sorted(graph_pages) or '[]'}"
        f" 图段={','.join(verdict.get('segments') or []) or '(无)'}"
        f" 文本挑页={sorted(text_pages) or '(全量)'}"
        f" 交集={sorted(text_pages & graph_pages) or '[]'}"
        f" 只有文本有={sorted(text_pages - graph_pages) or '[]'}"
        f" 只有图有={sorted(graph_pages - text_pages) or '[]'}"
    )
