"""复述句不许把原话题丢掉。

抄的标准答案：grok-build
  `xai-chat-state/src/actor/queries.rs` —— 取数口拆两个，各写明给谁用：
      get_first_user_text()       会话身份（"e.g. for memory context search"）
      get_last_user_query_text()  本轮动作（且先剥掉元数据标签）
  `xai-chat-state/src/compaction_utils.rs`
      is_synthetic_extracted_query() / is_real_user_turn()
      —— "the single source of truth for 'real user' classification"
  `xai-grok-foreign-sessions/src/codex/mod.rs`
      fn title(primary, fallback) = normalize_title(primary).or_else(fallback)

⚠ 抄不动的那一半：grok 的"不算真用户话"只包括系统自己塞进去的文本
  （auto-continue、bootstrap reminder）。全库扫过 ok/yes/sure/继续，两家都没有
  「人说的空确认」这个概念。`_is_content_free_reply` 是本仓自己定的。

⚠ 事故（2026-08-27 真机 + 探针）：控制面喂给模型的 messages 只有两条——
  system 一条 + 当前这句 user。探针实测：

      [system] …当前目标：（尚无确认的应用目标）。停泊：none。
               已经问过一轮澄清，不要再问，直接 scope_card。
      [user]   就按上面这个推演
      原话题出现在 messages 里？ -> False

  模型被要求"直接开范围卡"，而它对世界的全部认知就是那七个字，只能编。库里
  6 条 goal 长这样：「按当前设定的应用范围进行推演」「基于已确认的需求开展方案
  推演与可行性分析」——四个不同项目，名字一模一样。

  代价不止标题难看：goal 变成一句一个业务点的场面话之后，closure_relevance 判
  「样本不足以判定相关性（业务点 1 个 < 3），跳过」——**「产出对不对得上题」
  那道闸整个失效**。2026-08-27 真机复现过一次（那轮 blocked=False 是假绿）。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import (  # noqa: E402
    _is_content_free_reply,
    _restate,
    _session_topic,
    _system_prompt,
    first_substantive_user_text,
)

TOPIC = (
    "构建面向企业SaaS与IT技术服务场景的智能工单系统，覆盖客户支持、"
    "AI意图识别智能分类、坐席负载动态分派、跨组协作、SLA 计时与差评预警闭环"
)

#: 真机上用户真打过的空确认。
_CONTENT_FREE = [
    "就按上面这个推演",
    "就按上面这个",
    "按上面的来",
    "就这样",
    "好",
    "好的",
    "行",
    "可以了",
    "继续",
    "开始吧",
    "确认",
    "没问题",
    "ok",
    "OK！",
    "yes",
    "你好",
    "",
    "   ",
]

#: ⚠ 从库里 104 条真 goal 里抄下来的样本（2026-08-27）。判据必须一条都不误伤。
#:   只测自己编的短语很容易全绿——真话题里有大量"系统""管理""推演"这类词，
#:   跟空确认的语素重叠，正是最容易被误杀的一批。
_REAL_GOALS = [
    "构建面向企业SaaS与IT技术服务场景的智能工单与客户支持系统。涵盖多级技术支持流转、SLA分级响应监控",
    "宠物造景工作室的客户预约、上门施工排期与物料库存管理系统",
    "构建面向个人投资者的投资学习打卡与错题复盘系统",
    "构建语音指令收集与后台工单流转系统，服务一线人员与后台",
    "大赛积分软件",
    "构建古籍数字化项目管理系统，服务项目经理、录入员与审核员",
    "做一个流浪猫智能救助的数据库（匹配识别）的应用",
    "我需要一个可以学习关于车辆改装的网页",
    "健身房会员与私教排课系统",
    "做一个中小学课后托管的报名、排班与考勤系统",
    "继续做刚才那个排班的",
]


# ── 判定本身 ──────────────────────────────────────────────────────


@pytest.mark.parametrize("text", _CONTENT_FREE)
def test_pure_confirmations_carry_no_information(text: str):
    assert _is_content_free_reply(text) is True, text


@pytest.mark.parametrize("goal", _REAL_GOALS)
def test_real_topics_are_never_mistaken_for_confirmations(goal: str):
    """反向判据。误杀一条真话题 = 把用户的需求当成"好的"扔掉，比漏判更糟。"""
    assert _is_content_free_reply(goal) is False, goal


def test_restate_refuses_to_turn_a_confirmation_into_a_restatement():
    """守卫放在 _restate 这一份里，四个 park 点自动都对（CLAUDE.md §4）。

    变异：把守卫去掉 → 本条红，且下面那条兜底链的通电判据一起红。
    """
    assert _restate("就按上面这个推演") == ""
    assert _restate("做一个连锁咖啡店的物料订货系统") != ""


# ── 两个取数口 ────────────────────────────────────────────────────


def _parked_session() -> V5SessionState:
    """真机形状：用户说了话题 → 系统问了一轮澄清 → 用户回一句空确认。"""
    return V5SessionState(
        sessionId="restate-1",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"id": "c1", "role": "user", "kind": "turn", "text": TOPIC},
            {"id": "c2", "role": "assistant", "kind": "clarify", "text": "服务主体？"},
            {"id": "c3", "role": "user", "kind": "turn", "text": "就按上面这个推演"},
        ],
        runtimePhase="awaiting",
    )


def test_first_substantive_user_text_skips_the_confirmations():
    """会话身份取**第一句有内容的**，不取最后一句（grok 的 get_first_user_text）。"""
    assert first_substantive_user_text(_parked_session()) == TOPIC


def test_first_substantive_user_text_is_empty_when_there_is_nothing_real():
    """一句实话都没有就返回空串，**不许**把"好的"当话题顶上去。"""
    state = V5SessionState(
        sessionId="restate-2",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"id": "c1", "role": "user", "kind": "turn", "text": "你好"},
            {"id": "c2", "role": "user", "kind": "turn", "text": "好的"},
        ],
    )
    assert first_substantive_user_text(state) == ""


def test_session_topic_prefers_the_confirmed_goal():
    """确认过的目标优先，兜底才是第一句实话（grok 的 title(primary, fallback)）。"""
    state = _parked_session()
    assert _session_topic(state) == TOPIC
    state.goal = {"text": "已经确认过的目标", "status": "clear"}
    assert _session_topic(state) == "已经确认过的目标"


# ── 通电：模型这一轮到底看得见什么 ─────────────────────────────────


def test_the_model_can_see_the_topic_when_the_goal_is_not_confirmed_yet():
    """system 提示里必须带上原话题。

    这条是整件事的根因判据。变异：把 _system_prompt 改回
    `_goal_text(state) or "（尚无确认的应用目标）"` → 本条红。
    """
    prompt = _system_prompt(_parked_session())
    assert "智能工单" in prompt and "差评预警" in prompt, prompt[:300]
    assert "尚无确认的应用目标" not in prompt


def test_the_placeholder_still_shows_when_there_really_is_no_topic():
    """反向：真没有话题时还得说"尚无"，不许拿空串糊过去。"""
    prompt = _system_prompt(
        V5SessionState(sessionId="restate-3", goal={"text": "", "status": "needs_refinement"})
    )
    assert "尚无确认的应用目标" in prompt


@pytest.mark.parametrize("current", ["就按上面这个推演", "改成做一个社区养老助餐的订餐与配送系统"])
def test_plan_model_receives_original_topic_and_current_instruction(monkeypatch, current):
    from control_turn_support import ControlHarness, new_sid, seed_session, six_fields

    sid = new_sid("plan-topic-context")
    seed_session(sid, controlTranscript=[{"role": "user", "kind": "turn", "text": TOPIC}])
    harness = ControlHarness(monkeypatch)
    harness.post(six_fields(sid, current))
    messages = harness.llm_calls[0]["messages"]
    assert TOPIC in str(messages)
    assert current in str(messages)
    assert not harness.helper_calls
