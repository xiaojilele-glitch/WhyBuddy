# -*- coding: utf-8 -*-
"""每一跳要什么前置。**声明成数据，放一处，一个求值器。**

抄的标准答案：grok-build `xai-grok-tools/src/types/requirements.rs`

    //! Requirement expressions for tool dependency validation.

    pub enum Expr<T> { Value(T), And(Vec<Expr<T>>), Or(Vec<Expr<T>>), Not(..), True, False }

    pub fn eval(&self, f: &impl Fn(&T) -> bool) -> bool {
        match self {
            Expr::And(items) => items.iter().all(|e| e.eval(f)),
            Expr::Or(items)  => items.iter().any(|e| e.eval(f)),
            ...
        }
    }

⚠ 只抄**形状**，别照搬语义。grok 的 `ToolRequirement` 判的是「另一件工具在
  这份配置里启没启用」（`EvalContext.tools` 是 proposed configuration），
  跟我们要判的「这个会话手上有没有 SPEC / 页面」根本不是一回事。
  抄错层会造出一个真机上永远为真的条件（§一之二）。

  可抄的是那条纪律：**前置是数据，一个求值器，谁要用谁来问**。

──────────────────────────────────────────────────────────────────────────
## 这条治的是什么（CLAUDE.md §4 那张表）

改造前同一条规则写了两遍，形式还不一样：

    TOOL_LIST_WHEN["pages"] = lambda st: _scope_confirmed(st) and _has_spec(st)
                                                    ← 这一轮列不列给模型看
    _factory_hop_blocker:  hop == "pages" and not _has_spec(state)
                           → "还没有 SPEC。先调 spec。"
                                                    ← 真要跑时拦不拦

structure / bind / closure 三跳同样两处。改一处不报错，**只有一半生效**：
- 只改清单 → 模型看不见它，但 forcedTool 直接点进去照跑
- 只改闸   → 摆在菜单上，点了当场被拒（用户眼里就是「按钮坏了」）

而「列出来了到底能不能跑」这件事**今天没有任何判据在量**。

──────────────────────────────────────────────────────────────────────────
## 真机验过（2026-09-09）

重构后 12 条真话题 11 绿（第 12 条是已知存量抖动）。而且其中两条的第 2 轮
模型**自发**走了第 4 格该有的样子——先列活儿清单，再挑下一件工具：

    ['control_scope_card', 'control_handoff_factory'],
    ['control_tool_start', 'control_todo', 'control_tool_result',
     'control_handoff_factory']

「一跳一件、老师傅自己挑」这半边今天也在真机上量过：
spec(6s) → pages(138s) → structure(93s) → bind(38s)，各一轮，不偷跑。

──────────────────────────────────────────────────────────────────────────
## 没抄的构造子，以及为什么

grok 的 `Expr` 有六个：Value / And / Or / Not / True / False。
这里只留 Value / And / Or / TRUE 四个。

`Not` 和 `False` 在我们这五跳的前置里一条都用不上——留着就是**没有任何
判据能咬住的死枝**，跟 §一之二 那种恒假分支同一类账。真需要了再加。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Dict, List, Tuple, Union


class Need(str, Enum):
    """一条前置。可穷举——加一档必须在 `_PHRASE` 里给它一句人话。"""

    #: Durable approval for the exact implementation plan revision.
    PLAN = "plan"
    #: 手上有 SPEC。
    SPEC = "spec"
    #: 手上有页面。
    PAGES = "pages"
    #: 手上有五系统模型。
    MODEL = "model"


#: 前置 → 人话里的名字。**唯一渲染处**（同 `_STOP_TABLE` / `_SAY` 那条纪律）。
_PHRASE: Dict[Need, str] = {
    Need.PLAN: "批准实施计划",
    Need.SPEC: "SPEC",
    Need.PAGES: "页面",
    Need.MODEL: "五系统模型",
}


@dataclass(frozen=True)
class All:
    """全都要。对应 grok `Expr::And`。"""

    items: Tuple["Expr", ...]


@dataclass(frozen=True)
class Any_:
    """有一个就行。对应 grok `Expr::Or`。"""

    items: Tuple["Expr", ...]


class _True:
    """无条件。对应 grok `Expr::True`。"""

    __slots__ = ()


TRUE = _True()

Expr = Union[Need, All, Any_, _True]


def all_of(*items: "Expr") -> All:
    return All(tuple(items))


def any_of(*items: "Expr") -> Any_:
    return Any_(tuple(items))


def evaluate(expr: "Expr", have: Callable[[Need], bool]) -> bool:
    """求值。抄 grok `Expr::eval`：叶子交给调用方那个闭包判，与/或照常合并。

    `have` 是「这个会话有没有这个东西」——谁调谁给，本模块不认识 state，
    所以它是叶子（services 里谁都不依赖）。
    """
    if isinstance(expr, _True):
        return True
    if isinstance(expr, Need):
        return bool(have(expr))
    if isinstance(expr, All):
        return all(evaluate(i, have) for i in expr.items)
    if isinstance(expr, Any_):
        return any(evaluate(i, have) for i in expr.items)
    raise TypeError(f"不认识的前置表达式：{expr!r}")


def unmet(expr: "Expr", have: Callable[[Need], bool]) -> Tuple[Tuple[Need, ...], ...]:
    """没满足的那些。返回「若干组」，每组内部是**或**的关系（差一组里的任一个）。

    与 `evaluate` 分开是有意的：判「能不能跑」和说「差什么」是两件事，
    但**必须出自同一份声明**——改造前它们出自两处手写代码，这正是要治的病。
    """
    if evaluate(expr, have):
        return ()
    if isinstance(expr, Need):
        return ((expr,),)
    if isinstance(expr, All):
        out: List[Tuple[Need, ...]] = []
        for item in expr.items:
            out.extend(unmet(item, have))
        return tuple(out)
    if isinstance(expr, Any_):
        # 整组都没满足：差的是「这一组里随便哪一个」。
        leaves: List[Need] = []
        for item in expr.items:
            for group in unmet(item, have):
                leaves.extend(group)
        return (tuple(dict.fromkeys(leaves)),)
    return ()


#: 每一跳的前置。**这份就是那个单一真相源**——清单谓词和 blocker 都从它派生。
#:
#: ⚠ 加一跳只改这里。清单谓词、blocker、判据全都跟着走，忘不掉——
#:   改造前要改两处，忘一处不报错。
HOP_REQUIRES: Dict[str, "Expr"] = {
    # 起草 SPEC 只要范围定了就能跑（第一件 WRITE）。
    "spec": Need.PLAN,
    "pages": all_of(Need.PLAN, Need.SPEC),
    "structure": all_of(Need.PLAN, Need.PAGES),
    "bind": all_of(Need.PLAN, Need.PAGES),
    # 有页面**或**有模型都算「有可判定的产物」。
    "closure": all_of(Need.PLAN, any_of(Need.PAGES, Need.MODEL)),
}


def satisfied(hop: str, have: Callable[[Need], bool]) -> bool:
    """这一跳现在跑得动吗。没声明前置的一律跑得动（缺省 TRUE，抄 grok
    `requires_expr` 缺省 `Expr::True`）。"""
    return evaluate(HOP_REQUIRES.get(str(hop or "").strip(), TRUE), have)


def blocker_text(hop: str, have: Callable[[Need], bool]) -> str:
    """缺前置时那句人话。跑得动就是空串。

    ⚠ 措辞跟改造前**逐字一致**。这三句是真机上给用户看的，
      重构不许顺手改文案——那会让「重构」和「改产品」混在一条 diff 里。
    """
    hop = str(hop or "").strip()
    groups = unmet(HOP_REQUIRES.get(hop, TRUE), have)
    if not groups:
        return ""
    missing = {n for group in groups for n in group}
    if Need.PLAN in missing:
        return "实施计划尚未批准。先写计划并请求批准。"
    if missing == {Need.SPEC}:
        return "还没有 SPEC。先调 spec。"
    if missing == {Need.PAGES}:
        return f"还没有页面。先调 pages，再 {hop}。"
    if missing == {Need.PAGES, Need.MODEL}:
        return "还没有可判定的产物。先调 spec 或 pages。"
    # 兜底：新加的前置组合还没写专门措辞时，用词表拼一句，
    # **不许静默返回空串**——空串等于"跑得动"，那是伪造绿灯（§7）。
    names = "、".join(_PHRASE[n] for n in Need if n in missing)
    return f"还差：{names}。"
