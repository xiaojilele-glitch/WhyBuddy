# -*- coding: utf-8 -*-
"""重复护栏：一处定义、两道门共用、说得出理由能多要一次（2026-08-05）。

## 改之前是什么样

防"原地打转"有两道门，各写各的，两个写死的 2：

    v5_agentic_pick._validate_proposal   最近 6 次 run 里跑过 2 次 → 剔掉
    v5_full_driver  max_repeat_guard     **整个会话**跑过 2 次   → 永久拉黑

后者没有窗口，数的是会话生命周期总次数。一个能力这辈子跑满两次就再也选不
出来——多轮对话里用户补第三次需求时，evidence.search 已经死了，而那正是最该
再检索一次的时候。

那个 2 的出处，代码自己写着：`# small threshold for guard testability;
per V5.2 policy default higher but slice uses 2`——为测试方便定的，写死两处，
没有配置项。

## 还有一处自相矛盾

状态摘要告诉模型「再选一次就必须说明这次跟上次做的有什么不同」，提案格式里
也一直有 `why` 字段，模型一直在写——**验收从来没读过**。请人申辩然后捂耳朵。
"""

import pytest

from services.repeat_policy import (
    is_over_ceiling,
    is_repeat_exhausted,
    max_repeat_per_cap,
    reason_allows_repeat,
    recent_run_count,
    repeat_ceiling,
    repeat_window,
)


def _state(*cap_ids):
    class S:
        capabilityRuns = [{"capabilityId": c} for c in cap_ids]

    return S()


# ── 窗口 ────────────────────────────────────────────────────────


def test_counting_is_windowed_not_lifetime():
    """这是修的核心：久远的历史不该永久拉黑一个能力。

    窗口 6：前面那两次 evidence.search 已经滚出窗口，第三次必须能选。
    旧实现数的是会话总次数，这里会返回 2 → 永久拉黑。
    """
    st = _state(
        "evidence.search", "evidence.search",   # 早年的两次
        # 之后 6 次，正好把上面两次挤出窗口（窗口按 run 数，默认 6）
        "risk.analyze", "critique.generate", "synthesis.merge",
        "scenario.simulate", "structure.decompose", "intent.clarify",
    )
    assert recent_run_count(st, "evidence.search") == 0
    assert not is_repeat_exhausted(st, "evidence.search")


def test_within_the_window_the_limit_still_bites():
    st = _state("evidence.search", "risk.analyze", "evidence.search")
    assert recent_run_count(st, "evidence.search") == 2
    assert is_repeat_exhausted(st, "evidence.search")


def test_window_and_threshold_are_configurable(monkeypatch):
    """那个 2 是"为测试方便"定的，得能改——而不是散在两个文件里写死。"""
    monkeypatch.setenv("SLIDERULE_MAX_REPEAT_PER_CAP", "3")
    monkeypatch.setenv("SLIDERULE_REPEAT_WINDOW", "10")
    assert max_repeat_per_cap() == 3
    assert repeat_window() == 10
    st = _state("a", "a")
    assert not is_repeat_exhausted(st, "a"), "阈值调到 3，两次不该算跑满"


@pytest.mark.parametrize("bad", ["", "  ", "abc", "-1"])
def test_bad_config_falls_back_to_default(monkeypatch, bad):
    """配置写错不该把推演搞停——读不出来就用默认值。"""
    monkeypatch.setenv("SLIDERULE_MAX_REPEAT_PER_CAP", bad)
    assert max_repeat_per_cap() == 2


def test_window_zero_means_lifetime(monkeypatch):
    """留一个回到旧语义的口子，但那得是**显式选的**，不是默认。"""
    monkeypatch.setenv("SLIDERULE_REPEAT_WINDOW", "0")
    st = _state("a", "a", "b", "c", "d", "e", "f", "g")
    assert recent_run_count(st, "a") == 2


# ── 凭理由放行 ──────────────────────────────────────────────────


def test_a_real_reason_buys_one_more_run():
    st = _state("evidence.search", "evidence.search")
    assert is_repeat_exhausted(st, "evidence.search")
    assert reason_allows_repeat(
        st, "evidence.search", "上次只查到社区口径，这次专门补宠物医疗周期依据"
    )


@pytest.mark.parametrize("weak", ["", "   ", "需要补充", "再来一次"])
def test_empty_or_hollow_reason_does_not(weak):
    """拦的是"没说"，不是"说得不好"——判断理由质量这儿办不到，也不该办。"""
    st = _state("evidence.search", "evidence.search")
    assert not reason_allows_repeat(st, "evidence.search", weak)


def test_the_ceiling_holds_no_matter_how_good_the_reason():
    """理由本质上是模型自己给自己开条子，所以必须有硬顶。

    真正防打转的是这个硬顶，不是理由的质量。
    """
    st = _state("evidence.search", "evidence.search", "evidence.search")
    assert is_over_ceiling(st, "evidence.search")
    assert not reason_allows_repeat(
        st, "evidence.search", "这次要补的是完全不同的一块，理由非常充分且具体"
    )
    assert repeat_ceiling() == max_repeat_per_cap() + 1


# ── 两道门必须同进同退 ──────────────────────────────────────────


def test_both_gates_share_one_judgement():
    """提案门放行、驱动门拦下 = 白跑一次规划。

    此前两边算法不一样（窗口 vs 全生命周期），这种错位是必然会发生的。
    """
    import inspect

    from services import v5_agentic_pick, v5_full_driver

    assert "repeat_policy" in inspect.getsource(v5_agentic_pick._validate_proposal)
    assert "repeat_policy" in inspect.getsource(v5_full_driver._repeat_allows)


def test_driver_gate_honours_a_grant_from_the_proposal_gate():
    from services.v5_full_driver import _repeat_allows

    st = _state("evidence.search", "evidence.search")
    plain = {"capabilityId": "evidence.search", "roleId": "综合"}
    granted = {"capabilityId": "evidence.search", "roleId": "综合", "repeatGranted": True}
    assert not _repeat_allows(st, plain)
    assert _repeat_allows(st, granted), "提案门刚凭理由放行的，驱动门不能转头拦掉"


def test_a_grant_cannot_break_the_ceiling():
    """标记不是免死金牌——超了硬顶照拦。"""
    from services.v5_full_driver import _repeat_allows

    st = _state("evidence.search", "evidence.search", "evidence.search")
    granted = {"capabilityId": "evidence.search", "roleId": "综合", "repeatGranted": True}
    assert not _repeat_allows(st, granted)


def test_unrelated_capability_is_unaffected():
    from services.v5_full_driver import _repeat_allows

    st = _state("evidence.search", "evidence.search")
    assert _repeat_allows(st, {"capabilityId": "risk.analyze", "roleId": "安全"})


# ── 验收门真的会读 why ──────────────────────────────────────────


def _pickable_state(*cap_ids):
    class S:
        capabilityRuns = [{"capabilityId": c} for c in cap_ids]

    return S()


def test_validator_reads_why_and_marks_the_grant():
    from services.v5_agentic_pick import _validate_proposal

    st = _pickable_state("evidence.search", "evidence.search")
    picks = _validate_proposal(
        {
            "rationale": "补齐宠物医疗周期依据",
            "picks": [{
                "capabilityId": "evidence.search",
                "roleId": "综合",
                "why": "上次只查到社区口径，这次专门补宠物医疗周期与免疫间隔",
            }],
        },
        st,
    )
    assert picks and picks[0]["capabilityId"] == "evidence.search"
    assert picks[0]["repeatGranted"] is True


def test_validator_still_drops_a_repeat_with_no_reason():
    from services.v5_agentic_pick import _validate_proposal

    st = _pickable_state("evidence.search", "evidence.search")
    assert _validate_proposal(
        {"rationale": "再查一次", "picks": [
            {"capabilityId": "evidence.search", "roleId": "综合", "why": ""}
        ]},
        st,
    ) is None


# ── 剔光了得说清剔的是谁（2026-08-05）──────────────────────────
#
# 实测一轮里连着两次「提案全被门剔除，回落规则版」，日志就这七个字。剔的是
# 哪几条、卡在哪道门，事后完全查不出来——而每次剔光都意味着这轮 LLM 选材白跑
# （25~30 秒）且整轮被标降级，是该看得见的事。


def test_dropped_items_are_explained_one_by_one():
    from services.v5_agentic_pick import _validate_proposal

    st = _pickable_state("evidence.search", "evidence.search")
    dropped: list[str] = []
    out = _validate_proposal(
        {
            "rationale": "再来一轮",
            "picks": [
                {"capabilityId": "evidence.search", "roleId": "综合", "why": ""},
                {"capabilityId": "根本不存在的能力", "roleId": "综合", "why": "x"},
            ],
        },
        st,
        dropped,
    )
    assert out is None
    assert len(dropped) == 2
    joined = "；".join(dropped)
    assert "evidence.search" in joined and "窗口内已跑 2 次" in joined
    assert "不在能力清单里" in joined


def test_ceiling_rejection_says_it_is_the_ceiling():
    """"没说理由"和"说了也没用（到顶了）"是两种情况，日志得分得开。"""
    from services.v5_agentic_pick import _validate_proposal

    st = _pickable_state("evidence.search", "evidence.search", "evidence.search")
    dropped: list[str] = []
    _validate_proposal(
        {"picks": [{
            "capabilityId": "evidence.search", "roleId": "综合",
            "why": "这次要补的是完全不同的一块，理由非常充分且具体",
        }]},
        st,
        dropped,
    )
    assert dropped and "硬顶" in dropped[0]


def test_diagnostics_are_optional_and_do_not_change_the_verdict():
    """不传 dropped 时行为必须跟以前一模一样——诊断不能改判。"""
    from services.v5_agentic_pick import _validate_proposal

    st = _pickable_state("evidence.search", "evidence.search")
    proposal = {"picks": [
        {"capabilityId": "evidence.search", "roleId": "综合", "why": ""},
        {"capabilityId": "risk.analyze", "roleId": "安全", "why": "看风险"},
    ]}
    with_diag: list[str] = []
    a = _validate_proposal(proposal, st, with_diag)
    b = _validate_proposal(proposal, st)
    assert a == b
    assert with_diag, "传了收集器却什么都没记"
