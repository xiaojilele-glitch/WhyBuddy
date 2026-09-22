"""用户说出口的话，不因为上一轮的闸红了就被丢掉（2026-08-16 线上实测）。

## 这条防的是一次"发了指令但什么都没变"

真机证据 —— 会话 `sr-20260816095147`，话题
「【硬件+社会公益】步伴 AI 拐杖——这一次，我们重新定义智能拐杖！」：

第一轮闭环判 `blocked=True`，blocker 是 `CLOSURE_GOAL_RELEVANCE_FAILED`：
那道闸把上面这句**营销标题**按标点切成三个"业务点"
（硬件+社会公益 / 步伴 AI 拐杖——这一次 / 我们重新定义智能拐杖！），
再拿它们去比页面名（长辈守护实时看板…），覆盖率必然 0%。

用户接着发了「菜单的显示看着有问题」。然后：

    set_refine_context 从未被调用（精修分支挂在 `if not blocked` 之下）
      → 执行器里 _refine_active = False
      → 落到"整轮重建"，_try_llm_generate_evidence(goal, …) 拿的还是原话题
      → 页面重画 204.8 秒，产出与上一版等价
      → awaitReason=no_progress，streak 2，goal.status=needs_refinement

用户视角就是：**我说了话，系统忙了五分半钟，什么都没变。**

## 判据为什么落在"有没有把指令交出去"

不测"页面变没变"——那要真调 LLM，且变化本身不可判定。真正被丢掉的东西是
**指令有没有到达生成层**，而生成层读的就是 refine context。所以这里断言的是
`set_refine_context` 收到了用户那句话，而不是收到话题原文。

## blocked 该管什么、不该管什么

blocked 决定的是"要不要重建"，不是"要不要听用户说话"。
防住"没有模型可精修"的是 `current_model is not None`——证据真缺失（0/6）时
`extract_model_from_closure` 返回 None，精修自然不成立，照旧走重建。
fail-closed 语义不变，下面第三条就是锁这个的。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from models.v5_state import V5SessionState  # noqa: E402

GOAL = "【硬件+社会公益】步伴 AI 拐杖——这一次，我们重新定义智能拐杖！"
INSTRUCTION = "菜单的显示看着有问题"

_BLOCKED_CLOSURE = {
    "blocked": True,
    "topBlockers": [
        {
            "code": "CLOSURE_GOAL_RELEVANCE_FAILED",
            "ref": "产出与题目不符：目标的 3 个业务点只覆盖了 0 个（0% < 50%）。",
            "path": "runtimeClosure.goalRelevance",
            "affectedSkill": "",
        }
    ],
}

_MODEL = {"datamodel": {"entities": []}, "page": {"pages": []}}


@pytest.fixture
def spy(monkeypatch):
    """把这一段的三个外部依赖钉死，只留我们要判的那个分支。

    execute_v5_capability 也钉掉：这条测的是"指令交没交出去"，
    真跑一次收口既慢又会把判据混进别的失败里。
    """
    import services.v5_full_driver as driver
    import services.v5_llm_generate as gen

    calls = []
    # ⚠ 收 **kwargs：`set_refine_context` 后来加了 pages（按需重画用，2026-08-17）。
    #   spy 的签名钉死实参个数的话，被测函数一加参数这里就 TypeError——那是
    #   **判据自己坏了**，跟它要守的"指令有没有交出去"毫无关系，却会红得像
    #   真出了事。只记这条判据关心的 (model, instruction)。
    monkeypatch.setattr(
        gen, "set_refine_context", lambda m, i="", **kw: calls.append((m, i))
    )
    monkeypatch.setattr(driver, "derive_skill_runtime_graph_response", lambda _s: {"bySkill": {}})
    monkeypatch.setattr(driver, "execute_v5_capability", lambda *a, **k: None)
    return calls


def _state() -> V5SessionState:
    return V5SessionState(
        sessionId="t-refine-blocked",
        goal={"text": GOAL, "status": "needs_refinement"},
    )


def _run(monkeypatch, calls, *, closure, model):
    import services.v5_full_driver as driver

    monkeypatch.setattr(driver, "derive_publish_closure_response", lambda _s: closure)
    monkeypatch.setattr(driver, "extract_model_from_closure", lambda _c: model)
    driver._ensure_runtime_closure_evidence(_state(), INSTRUCTION, 1)
    return calls


def test_blocked_closure_still_hands_the_user_instruction_to_generation(monkeypatch, spy):
    """闸红了，但用户带来了新指令 —— 指令必须照样交到生成层。

    这是本文件的主判据。修复前 `set_refine_context` 一次都不会被调用。
    """
    calls = _run(monkeypatch, spy, closure=_BLOCKED_CLOSURE, model=_MODEL)

    assert calls, "闭环 blocked 时用户的新指令被整个丢掉了（精修分支没进）"
    model_arg, instruction_arg = calls[0]
    assert instruction_arg == INSTRUCTION, (
        f"交给生成层的是 {instruction_arg!r}，不是用户说的那句话"
    )
    assert model_arg is _MODEL, "精修必须基于现有模型做增量，而不是从零重来"


def test_the_instruction_is_not_silently_replaced_by_the_topic(monkeypatch, spy):
    """反向判据：交出去的不能是话题原文。

    正向判据（"有调用"）拦不住这个形态——把 goal 原样交出去同样会让
    `calls` 非空，而那正是修复前重建路径实际干的事（mv-2 的 instruction
    字段记的就是话题原文）。
    """
    calls = _run(monkeypatch, spy, closure=_BLOCKED_CLOSURE, model=_MODEL)
    assert calls[0][1] != GOAL, "指令被话题原文顶掉了 —— 用户等于没说话"


def test_blocked_with_no_model_still_falls_through_to_rebuild(monkeypatch, spy):
    """证据真缺失（0/6）时不许假装能精修 —— fail-closed 语义不能被这次修复削弱。

    这条是上面那条的**代价判据**：把精修从 `if not blocked` 底下挪出来之后，
    唯一还拦着"没模型也精修"的就是 `current_model is not None`。它要是失守，
    精修会拿 None 当基线，比原来的重建更糟。
    """
    calls = _run(monkeypatch, spy, closure=_BLOCKED_CLOSURE, model=None)
    assert calls == [], "没有可精修的模型却进了精修分支"


def test_unblocked_and_no_new_instruction_still_short_circuits(monkeypatch, spy):
    """没红、也没有新指令 → 保持原来的早退，不做多余的重建。

    这条锁的是"这次改动没有顺手把别的路径也改了"。指令与话题原文相同
    （用户点了"重新推演"而不是提修改意见）时，早退行为必须原样保留。
    """
    import services.v5_full_driver as driver

    monkeypatch.setattr(driver, "derive_publish_closure_response", lambda _s: {"blocked": False})
    monkeypatch.setattr(driver, "extract_model_from_closure", lambda _c: _MODEL)

    before = len(_state().capabilityRuns or [])
    state = driver._ensure_runtime_closure_evidence(_state(), GOAL, 1)

    assert spy == [], "指令与话题相同不该触发精修"
    assert len(state.capabilityRuns or []) == before, "该早退的路径跑出了额外的收口"
