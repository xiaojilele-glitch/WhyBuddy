# -*- coding: utf-8 -*-
"""跳的前置只有一份声明：列出来的一定跑得动，跑得动的一定列出来。

抄的标准答案：grok-build `xai-grok-tools/src/types/requirements.rs`

    //! Requirement expressions for tool dependency validation.
    pub enum Expr<T> { Value(T), And(..), Or(..), Not(..), True, False }
    pub fn eval(&self, f: &impl Fn(&T) -> bool) -> bool

只抄形状：**前置是数据、放一处、一个求值器**。它的 `ToolRequirement` 判的是
「另一件工具配没配」，跟我们判会话产物不是一回事（照搬会造出恒真条件，§一之二）。

## 改造前的病（CLAUDE.md §4 那张表）

同一条规则写两遍，形式还不一样：

    TOOL_LIST_WHEN["pages"] = lambda st: _scope_confirmed(st) and _has_spec(st)
    _factory_hop_blocker:  hop == "pages" and not _has_spec(state) → 一句话

改一处不报错，只有一半生效：
  只改清单 → 模型看不见它，forcedTool 直接点进去照跑
  只改闸   → 摆在菜单上，点了当场被拒（用户眼里就是「按钮坏了」）

而**「列出来的到底跑不跑得动」改造前没有任何判据在量**。下面
`test_列出来的一定跑得动` 就是那条缺失的反向判据（§3）：对四个前置的
全部 16 种状态组合逐一比对，任何一处漂了当场红。
"""

from __future__ import annotations

import itertools

import pytest

from models.v5_state import V5SessionState
from services.closed_tools import FACTORY_HOPS
from services.hop_requirements import (
    HOP_REQUIRES,
    All,
    Any_,
    Need,
    TRUE,
    all_of,
    any_of,
    blocker_text,
    evaluate,
    satisfied,
    unmet,
)
from services.rehearsal_control import (
    _factory_hop_blocker,
    _session_has,
    should_list_tool,
)

pytest.importorskip("fastapi")


def _have(**flags):
    on = {Need[k.upper()] for k, v in flags.items() if v}
    return lambda need: need in on


# ── 一、单一真相源：两处必须永远一致 ─────────────────────────────────────


def _state(scope: bool, spec: bool, pages: bool, model: bool) -> V5SessionState:
    """按四个前置拼一个会话。用真机那几个字段，不是自己造的标志位。

    ⚠ 四个标志**不是互相独立的**：`_scope_confirmed` 的第一条就是「有模型
      版本即已确认」，所以 model=True 必然 scope=True。第一版判据把 16 种
      组合当成都可达，于是在 (scope=False, model=True) 这种**真机到不了的
      状态**上报红——判据自己拼了一个不存在的载荷（§一之二 的另一面）。
      现在不可达组合由 `_REACHABLE` 挡掉。
    """
    st = V5SessionState(sessionId="req", goal={"text": "请假系统"})
    if model:
        st.modelVersions = [{"id": "v1", "model": {"pages": []}}]
    if scope:
        plan = {"planId": "plan-1", "revision": 1, "planContent": "Build the app"}
        st.controlTranscript = [
            {"kind": "plan_written", **plan},
            {"kind": "plan_approval", "reqId": "approval-1", **plan},
            {"kind": "plan_approved", "reqId": "approval-1", **plan},
        ]
    blob = {}
    if spec:
        blob["spec"] = {"appName": "x", "pages": [{"id": "p1"}], "nodes": []}
    if pages:
        blob["pages"] = {"p1": "<html></html>"}
    if blob:
        st.specFirstPages = blob
    return st


#: 真机到得了的状态组合。model=True 蕴含 scope=True（见 `_state` 头注）。
_REACHABLE = [
    combo
    for combo in itertools.product([False, True], repeat=4)
]


def test_不可达的组合确实被挡掉了():
    """反向：别把 `_REACHABLE` 写成恒真——那样上面那条又变回枚举幻想。"""
    assert len(_REACHABLE) == 16, len(_REACHABLE)
    assert (False, False, False, True) in _REACHABLE


@pytest.mark.parametrize("scope,spec,pages,model", _REACHABLE)
@pytest.mark.parametrize("hop", list(FACTORY_HOPS))
def test_列出来的一定跑得动(hop, scope, spec, pages, model):
    """**这条是改造前缺的那一条。**

    16 种状态 × 5 跳 = 80 组，逐组比对「这一轮列不列」和「真跑拦不拦」。
    任何一处漂了当场红——改造前它们出自两段手写代码，漂了没人知道。

    ⚠ spec 是唯一允许「跑得动但不列」的：已经有 SPEC 就不再列它，
      那不是前置（前置问"跑得动吗"），是"别重复干活"。forcedTool=spec
      重起草仍然放行，所以 blocker 必须是空的。
    """
    st = _state(scope, spec, pages, model)
    listed = should_list_tool(hop, st)
    runnable = not _factory_hop_blocker(st, hop)

    if hop == "spec" and spec and scope:
        assert runnable, "已有 SPEC 时重起草被当成缺前置拦掉了"
        return
    # 范围没确认时清单谓词一律为假，而 blocker 只说产物缺口（范围是范围卡的事）。
    if not scope:
        assert not listed, f"{hop} 在范围没确认时被列出来了"
        assert not runnable
        return
    assert listed == runnable, (
        f"{hop} 列={listed} 但跑得动={runnable}"
        f"（scope={scope} spec={spec} pages={pages} model={model}）"
    )


def test_两处都从同一份声明派生_不许再手写():
    """变异：把 `_factory_hop_blocker` 或清单谓词改回手写 if → 上面那条会红。
    这一条钉的是**出处**：源码里不许再出现第二份前置判断。"""
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(
        Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    )
    at = src.find("def _factory_hop_blocker")
    assert at > 0
    body = src[at : at + 400]
    assert "hop_blocker_text" in body, "blocker 又自己判了一遍前置"
    for hardcoded in ("还没有 SPEC", "还没有页面", "还没有可判定的产物"):
        assert hardcoded not in body, f"措辞又被抄回控制面了：{hardcoded}"


# ── 二、求值器本身（抄 grok Expr::eval）──────────────────────────────────


def test_与或的语义():
    assert evaluate(TRUE, _have()) is True
    assert evaluate(Need.SPEC, _have(spec=True)) is True
    assert evaluate(all_of(Need.SPEC, Need.PAGES), _have(spec=True)) is False
    assert evaluate(all_of(Need.SPEC, Need.PAGES), _have(spec=True, pages=True)) is True
    assert evaluate(any_of(Need.PAGES, Need.MODEL), _have(model=True)) is True
    assert evaluate(any_of(Need.PAGES, Need.MODEL), _have()) is False


def test_满足了就没有缺口():
    assert unmet(all_of(Need.SPEC), _have(spec=True)) == ()


def test_或里差的是一组_不是逐条():
    """`closure` 差的是「页面**或**模型」，说成两条缺口会让用户以为两样都要补。"""
    groups = unmet(any_of(Need.PAGES, Need.MODEL), _have())
    assert len(groups) == 1
    assert set(groups[0]) == {Need.PAGES, Need.MODEL}


def test_不认识的表达式要抛_不许当成通过():
    """§7：闸这一类 fail-closed。悄悄返回 True 就是伪造绿灯。"""
    with pytest.raises(TypeError):
        evaluate("我不是表达式", _have())  # type: ignore[arg-type]


def test_没声明前置的跳缺省跑得动():
    """抄 grok `requires_expr` 缺省 `Expr::True`。"""
    assert satisfied("以后新加的跳", _have()) is True
    assert blocker_text("以后新加的跳", _have()) == ""


# ── 三、措辞逐字不许变 ───────────────────────────────────────────────────


def test_三句人话逐字不变():
    """重构不许顺手改文案——那会让「重构」和「改产品」混在一条 diff 里，
    出事时分不清是哪一边。"""
    scope_only = _have(plan=True)
    assert blocker_text("pages", scope_only) == "还没有 SPEC。先调 spec。"
    assert blocker_text("bind", scope_only) == "还没有页面。先调 pages，再 bind。"
    assert (
        blocker_text("structure", scope_only) == "还没有页面。先调 pages，再 structure。"
    )
    assert blocker_text("closure", scope_only) == "还没有可判定的产物。先调 spec 或 pages。"
    assert blocker_text("spec", scope_only) == ""


def test_新前置组合不许静默返回空串():
    """空串等于"跑得动"。新加一条前置忘了写措辞就放行 = 伪造绿灯（§7）。"""
    HOP_REQUIRES["__probe__"] = all_of(Need.PLAN, Need.MODEL)
    try:
        said = blocker_text("__probe__", _have(plan=True))
        assert said, "新组合静默放行了"
        assert "五系统模型" in said, said
    finally:
        HOP_REQUIRES.pop("__probe__", None)


def test_每一跳都有声明():
    missing = [h for h in FACTORY_HOPS if h not in HOP_REQUIRES]
    assert not missing, f"这几跳没声明前置：{missing}"


def test_每条前置都有人话名字():
    from services.hop_requirements import _PHRASE

    missing = [n.value for n in Need if n not in _PHRASE]
    assert not missing, f"这些前置没有人话名字：{missing}"


def test_没抄的构造子确实没被用上():
    """头注说 Not / False 一条都用不上所以没抄。这条钉住那句话是真的——
    哪天真用上了，声明里会出现别的类型，本条提醒回去补求值器。"""
    def _walk(e):
        if isinstance(e, (All, Any_)):
            for i in e.items:
                yield from _walk(i)
        else:
            yield e

    kinds = {type(x).__name__ for expr in HOP_REQUIRES.values() for x in _walk(expr)}
    assert kinds <= {"Need", "_True"}, kinds
