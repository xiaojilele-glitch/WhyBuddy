# -*- coding: utf-8 -*-
"""本轮工厂菜单 → 钟上该亮哪几格。core 层，只依赖两个 util 叶子。

## 为什么单独一个模块

组合的两半分别住在两个 util 叶子里：

    capability_plan.expand_tools          知道「这批工具要跑哪些 stage」
    stage_legal.product_steps_for_stages  知道「stage 是第几步」

两个都是 `may_depend_on = []` 的叶子，谁也不许 import 谁（抄 grok 的叶子 crate）。
所以组合只能发生在上面一层。

而写 `goal["tools"]` 的地方有**两个 flow 模块**：

    rehearsal_control._set_goal_tools        控制面三处（按钮点火 / 单跳 / workflow 减菜）
    v5_full_driver._stamp_factory_tools_onto_goal   驱动器减菜（「run_spec_first / 钟都读这里」）

⚠ 2026-09-02：如果把组合抄两份，就正好落进 CLAUDE.md 第四条——「同一件事两条
实现，改一条不改另一条不会报错，只会有一半不生效」。这个仓在同步/流式驱动、
Python 判定/TS 运行时上已经栽过三次。所以宁可多一个 12 行的模块，也不抄两遍。

不放 rehearsal_control 里让驱动器 import：驱动器已经被控制面 import（点火插座），
反向再连一条就是环，两侧架构闸都会红。
"""

from __future__ import annotations

from typing import Iterable, List

from services.capability_plan import expand_tools
from services.stage_legal import product_steps_for_stages

__all__ = ["product_steps_for_tools"]


def product_steps_for_tools(tools: Iterable[str], *, refine: bool = False) -> List[int]:
    """公开工具清单 → 钟上的步号，升序去重。

    `refine=True` 会带上 graphscope / pagescope（都算第 3 步）——精修轮只挑
    `spec` 时钟上也该看见「划范围」那一格，否则事件到了却没有格子接。

    返回 list 而不是 tuple：它要直接进 goal 落库、上 SSE，JSON 里就是数组。
    """
    chosen = [str(item or "").strip() for item in (tools or ()) if str(item or "").strip()]
    return list(product_steps_for_stages(expand_tools(chosen, refine=refine)))
