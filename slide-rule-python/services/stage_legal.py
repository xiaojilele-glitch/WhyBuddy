# -*- coding: utf-8 -*-
"""流水线阶段账本——阶段人话 / 分组 / 耗时预估的单一真相源（2026-08-30）。

## 为什么有这个文件

「用户在左栏看到的步骤」这份表，2026-08-30 数下来有 **5 份**，而且互相对不上：

    后端 2 份   turn_narration._SPEC_FIRST_LABELS      9 条（人话）
                v5_full_driver._ENRICH_STAGE_LABELS    9 条（人话 + 耗时）
    前端 3 份   useSlideRuleSession 文案表             7 条
                stage-authority 权属表                 9 条
                blueprint-stage-signal 场景词表        9 条，**完全另一套词表**

第五份与前四份**只有 `spec_tree` 一个词对得上**。而后端真发的事件是
`specfirst.spec / design / pages / structure / semantics / assemble / bind`
（2026-08-29 真机跑出来的就是这七个）。

后果：

    后端加一步  → 前端文案表没有 → 左栏显示原始 id（`specfirst.xxx`），不是人话
    后端删一步  → 前端那条永远不亮，没人发现
    换产品原型  → 五份表都要改，漏一份就是静默错位

## 抄的是 grok 的 `xai-grok-session-events`

    Typed per-session event log written as JSON lines

关键在 **typed**：事件是自描述的。grok 的 `xai-workflow` 是 Rhai 脚本编排、
步骤运行时才确定，它的 TUI 因此**根本不预先知道步骤**——它渲染事件流本身，
事件自己带着展示信息。

所以正确的抄法是**删表，不是改表**：让后端事件带 `label` / `group` / `eta` /
`order` / `of`，前端从「查表翻译」改成「直接渲染」。

**这是「页面能不能跟着自由」的前提**：不做它，后端配方化之后前端会更乱
（步骤动态了，翻译表却是静态的）。

## ⚠ 两件不由账本生成的事

**① `specfirst.shell` 故意不在表里。** 零 LLM、实测 0.004 秒，start/end
背靠背发出去只在左栏闪一下。名单外的阶段不报——这是纪律，不是漏了。

**② 耗时区间是实测标定的**（08-14 端到端那趟）。`bind` 原写「3~4 分钟」
实测 9.2 分钟，差一倍多——写窄了比不写更糟：用户等到第 5 分钟会以为卡死，
而它只是还在正常跑。改这些数字要连同实测一起重跑（第六条）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

_PATH = Path(__file__).resolve().parent / "data" / "pipeline_stages.json"

with _PATH.open(encoding="utf-8") as _f:
    _LEDGER: Dict[str, Any] = json.load(_f)

STAGE_LEDGER_VERSION: int = int(_LEDGER.get("version", 0))

_STAGES: Dict[str, Dict[str, Any]] = {
    k: v for k, v in (_LEDGER.get("stages") or {}).items() if not k.startswith("$")
}

#: 阶段顺序。**用户看到的先后就是这个**，改它 = 改产品体验。
STAGE_ORDER: Tuple[str, ...] = tuple(
    [s for s in (_LEDGER.get("$order") or []) if s in _STAGES]
    + sorted(set(_STAGES) - set(_LEDGER.get("$order") or []))
)


def stage_ids() -> Tuple[str, ...]:
    return STAGE_ORDER


def labels() -> Dict[str, str]:
    """阶段 → 人话。给 `turn_narration` 用（它只要人话）。"""
    return {k: str(_STAGES[k].get("label") or "") for k in STAGE_ORDER}


def labels_with_eta() -> Dict[str, Tuple[str, str]]:
    """阶段 → (人话, 耗时区间)。给 `v5_full_driver` 用。

    ⚠ 保持 `Dict[str, tuple]` 的形状不变——老调用方是 `label, eta = TABLE[name]`，
      换成 dict 会静默变成「解包出两个 key 名」而不是报错。
    """
    return {
        k: (str(_STAGES[k].get("label") or ""), str(_STAGES[k].get("eta") or ""))
        for k in STAGE_ORDER
    }


def describe(stage_id: str, *, sequence: List[str] | None = None) -> Dict[str, Any]:
    """一个阶段的完整展示信息——**这就是要塞进 SSE 事件的那一份**。

    前端拿到它就能直接渲染，不需要任何本地表。名单外的阶段返回空 dict
    （调用方按「不报」处理，同既有纪律）。

    ⚠ `sequence` 是**本轮真实要跑的阶段列表**，`order`/`of` 由它算。
      第一版拿账本位置当 order、调用方传 total 当 of，实测立刻出
      `order=8, of=7`——账本含两个精修专用步（pagescope / graphscope），
      **绝对位置对哪一轮都不准**：新建轮少两步，精修轮才有。
      不传 sequence 就只给 order（账本位置），不给 of——
      宁可少给一个字段，也不给一对自相矛盾的数。
    """
    spec = _STAGES.get(stage_id)
    if not spec:
        return {}
    out: Dict[str, Any] = {
        "stage": stage_id,
        "label": str(spec.get("label") or ""),
        "group": str(spec.get("group") or ""),
        "eta": str(spec.get("eta") or ""),
    }
    step = spec.get("productStep")
    if isinstance(step, int) and 1 <= step <= 6:
        out["productStep"] = step
    if sequence:
        seq = [s for s in sequence if s in _STAGES]
        if stage_id in seq:
            out["order"] = seq.index(stage_id) + 1
            out["of"] = len(seq)
    else:
        out["order"] = STAGE_ORDER.index(stage_id) + 1
    if spec.get("refineOnly"):
        out["refineOnly"] = True
    return out


def product_steps_for_stages(stage_ids: Iterable[str]) -> Tuple[int, ...]:
    """本轮真要跑的阶段 → 钟上该亮哪几格。升序去重。

    ## 为什么在这里，不在 capability_plan

    `capability_plan.expand_tools` 知道「跑哪些 stage」，账本知道「stage 是第几步」。
    两个都是 util 叶子（`may_depend_on = []`），谁也不许 import 谁——所以组合发生在
    调用点（flow 层），这里只收 stage id，那本来就是账本自己的地盘。

    ## 为什么必须有这个函数

    ⚠ 2026-09-02：前端一直自带一张 `PUBLIC_TOOL_TO_STEP`（公开工具 → 步号），
    跟账本对不上——`bind` 前端写 5、账本是 6；`closure` 前端写 6，而**账本里
    根本没有 closure 阶段**（它不是 spec-first 步，见 capability_plan.expand_tools
    的说明），于是 `pages-preview` 配方下第 6 格永远 pending，没人点得亮。
    同一趟还把 `semantics`(5) 整格漏了：`[spec,pages,structure,bind]` 前端只开
    {2,3,4,6}，第 5 格被当成「工具没选」直接不画。

    本文件模块头写着「正确的抄法是**删表，不是改表**」，`session_events` 写着
    「不许在前端再补一张表」。这个函数就是那句话的落点：步集由账本算，随 goal
    下发，前端只渲染。

    名单外的阶段（如 `specfirst.shell`，故意不进账本）不贡献步号——不报就是不报，
    不许在这里补一个默认值。
    """
    steps: set[int] = set()
    for stage_id in stage_ids or ():
        spec = _STAGES.get(str(stage_id or ""))
        if not spec:
            continue
        step = spec.get("productStep")
        if isinstance(step, int) and 1 <= step <= 6:
            steps.add(step)
    return tuple(sorted(steps))


def groups() -> List[str]:
    """分组顺序，去重保序。左栏折叠用。"""
    seen: List[str] = []
    for k in STAGE_ORDER:
        g = str(_STAGES[k].get("group") or "")
        if g and g not in seen:
            seen.append(g)
    return seen
