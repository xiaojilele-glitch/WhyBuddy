"""开工前的澄清：问题从**这句需求**里长出来，答案要真进生成提示词。

2026-08-27 的诊断：澄清这条链在产品路径上**整条没接**——

  · profile="app" 的短清单（_app_profile_short_picks）里没有 gap.ask，
    六步钟第 ① 步「澄清与取证」基本恒空转；
  · 唯一还在用的模板问题是 TS 那 4 条写死的（users/platform/scenario/scope，
    选项是「个人C端/企业内部」这种通用词），而且挂在旧本地引擎上；
  · 判定还写着「目标 ≥80 字直接算已充分规约、一个问题都不问」；
  · 前端 ClarificationCard 是完整的多步卡（单选/多选/填空/默认值/说明），
    **前面没有任何东西给它喂题**。

所以用户看到的就是"AI 只会一次性随口问一句"。

这里钉四件事，每条都配反向：
  1. 需求含糊 → 真的产出带选项的问题，且落成 open_question 缺口
  2. 反向：模型判断已经清楚（给空列表）→ 不许硬 park 一张空卡
  3. 反向：已经问过一轮 → 不许再问（改开范围卡），别把人困在问答里
  4. 答完之后，答案要**原样进生成提示词**（这条断了前面全白问）
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

VAGUE = "做一个诊所系统"


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _gaps(sid: str, status: str = "open"):
    saved = load_session(sid)
    out = []
    for g in saved.coverageGaps or []:
        get = g.get if isinstance(g, dict) else lambda k, _g=g: getattr(_g, k, None)
        if get("kind") == "open_question" and get("status") == status:
            out.append(
                {
                    "id": get("id"),
                    "label": get("label"),
                    "type": get("clarifyType"),
                    "options": get("options"),
                    "context": get("context"),
                    "answer": get("answer"),
                    "kindLabel": get("kindLabel"),
                }
            )
    return out


QUESTIONS = [
    {
        "prompt": "这个诊所系统主要给谁用？",
        "type": "multi_choice",
        "options": ["医生", "护士", "前台", "患者"],
        "context": "用谁决定角色与权限怎么切",
        "kind": "users",
    },
    {
        "prompt": "挂号之后要不要走缴费？",
        "type": "single_choice",
        "options": ["要，挂号即缴费", "不要，到诊再缴", "先不做缴费"],
        "context": "影响工作流节点数",
        "kind": "scenario",
    },
]


class TestClarifyIsRetired:
    """clarify 这件工具 2026-09-09 退役（用户裁决）。

    ## 退役掉的是什么

    原来这里有四条：问题落成带选项的 gap、single_choice 缺 options 退化成
    自由文本、空列表不许 park 一张空卡、第二轮澄清被拒。它们测的是
    `_park_clarify` 与 `_dispatch_tool` 的 clarify 分支。

    ## 为什么退役而不是修

    `TOOL_LIST_WHEN` 早已是 `"clarify": lambda st: False`——模型永远看不见
    它；`should_list` 之后没被列出的调用会被整个丢掉，所以那条分发分支
    **一次都跑不到**（forced 也到不了，实测过）。四条判据在测一段没通电的
    代码，正是 §一 反过来的形状。

    维度问题现在长在 SPEC 假设卡上——那里问才有上下文可依，也不会变成
    "开场先考几道模板题"（漫画第 2 格）。

    ## 留下来的是什么

    · 答题路径：已经停在 `awaitReason=control_clarify` 的老会话仍要能交卷
      （`_tool_answer_from_payload` / `_messages_after_need_answer`）。
      抄 grok：把一件工具移出目录，不作废在途的 NeedUserAnswer 相关性。
    · 本文件其余几组：提示词把答案原样带进生成、答案落在 gap 上、
      未答的澄清 gap 不阻断闭环——都跟这件工具无关，照常跑。

    变异：把 clarify 加回 `CONTROL_TOOLS` → 本条红。
    """

    def test_clarify_is_not_in_the_model_catalog(self):
        from services.rehearsal_control import CONTROL_TOOLS

        names = {(t.get("function") or {}).get("name") for t in CONTROL_TOOLS}
        assert "clarify" not in names, "clarify 又回到模型目录里了"
        # 反向：目录本身没被清空
        assert "ask_user_question" in names and "exit_plan_mode" in names
        assert "scope_card" not in names

    def test_clarify_is_not_a_closed_tool_on_either_side(self):
        """两侧同一张表。只改一侧 = 芯片一半认一半不认（§4）。"""
        from pathlib import Path

        from services.closed_tools import CLOSED_TOOLS

        assert "clarify" not in CLOSED_TOOLS
        ts = (
            Path(__file__).resolve().parents[2]
            / "client" / "src" / "lib" / "factory-hops.ts"
        ).read_text(encoding="utf-8")
        at = ts.index("export const CLOSED_TOOLS")
        # ⚠ 结束标记要从 at 之后找：FACTORY_HOPS 也用 `] as const;`，
        #   从 0 找会切出一段空的，反向断言反而先红（写这条时就踩了）。
        body = ts[at : ts.index("] as const;", at)]
        assert '"clarify"' not in body, "TS 侧闭集表里 clarify 还在"
        assert '"ask_user_question"' in body, "反向：TS 侧那张表没被读空"

    def test_the_dispatch_branch_is_gone(self):
        """分支还在就说明只撤了目录——下一个人加回 TOOL_LIST_WHEN 就会复活。"""
        from pathlib import Path

        from control_turn_support import strip_python

        src = strip_python(
            Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
        )
        assert 'if name == "clarify":' not in src
        assert "_park_clarify" not in src
        # 反向：答题路径必须还在
        assert "control_clarify" in src, "老会话的交卷路径被一起删了"


class TestPromptGetsTheAnswers:
    def test_answers_reach_the_generation_prompt_verbatim(self):
        """答案要**原样**进生成提示词——这条断了，前面问得再漂亮也白问。

        ⚠ 判据钉在 `_build_user_content` 的产物上（真的会发给模型的那段字），
          不是"有没有调过 set_clarifications"。调用计数那种判据，把
          clarification_prompt_block 返回空字符串照样绿。
        """
        from models.v5_state import V5SessionState
        from services.v5_llm_generate import (
            _build_user_content,
            clarifications_from_state,
            set_clarifications,
        )

        state = V5SessionState(
            sessionId="clar-prompt",
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "挂号之后要不要走缴费？",
                    "status": "resolved",
                    "createdAt": "2026-08-27T00:00:00Z",
                    "answer": "要，挂号即缴费",
                },
                {
                    "id": "g2",
                    "kind": "open_question",
                    "label": "没答的这条",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                },
            ],
        )
        pairs = clarifications_from_state(state)
        assert pairs == [{"q": "挂号之后要不要走缴费？", "a": "要，挂号即缴费"}]
        set_clarifications(pairs)
        try:
            content = _build_user_content("诊所系统")
            assert "挂号之后要不要走缴费？" in content
            assert "要，挂号即缴费" in content
            # 反向：没答的那条不许进提示词（模型会把它当成已定的事实）
            assert "没答的这条" not in content
        finally:
            set_clarifications(None)

    def test_no_answers_means_no_block(self):
        """反向：没答过就不加这块，prompt 跟从前逐字节一致。"""
        from services.v5_llm_generate import _build_user_content, set_clarifications

        set_clarifications(None)
        content = _build_user_content("诊所系统")
        assert "already answered these clarifying questions" not in content

    def test_resolved_without_an_answer_is_not_fed(self):
        """反向：只把缺口置 resolved、没留答案 → 不许进提示词。

        那正是 2026-08-27 之前的形态：闸绿了，模型什么也没多知道。
        """
        from models.v5_state import V5SessionState
        from services.v5_llm_generate import clarifications_from_state

        state = V5SessionState(
            sessionId="clar-noanswer",
            goal={"text": "x", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "问过的",
                    "status": "resolved",
                    "createdAt": "2026-08-27T00:00:00Z",
                }
            ],
        )
        assert clarifications_from_state(state) == []


class TestAnswerIsStoredOnTheGap:
    def test_answered_gaps_carry_the_answer_text(self, harness):
        sid = new_sid("clarify-answer")
        seed_session(
            sid,
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "挂号之后要不要走缴费？",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                }
            ],
        )
        harness.post(
            six_fields(
                sid,
                "「挂号之后要不要走缴费？」答：要，挂号即缴费",
                answeredGaps=[{"gapId": "g1", "answer": "要，挂号即缴费"}],
            )
        )
        resolved = _gaps(sid, status="resolved")
        assert len(resolved) == 1
        assert resolved[0]["answer"] == "要，挂号即缴费", "答案没留下来 → 生成侧取不到料"


class TestPromptTellsTheModelWhatIsMissing:
    """system prompt 要**指着这句需求说缺什么**，而不是干喊"先澄清"。

    ⚠ 旧的 TS 那套把它做成硬闸：命中维度 <2 才问、目标 ≥80 字直接算说清。
      于是一句一百字的废话一条不问，一句 30 字的好需求反倒被问四条模板题。
      现在规则只报告"我没读到什么"，问不问、问几条交给模型
      （参考 dzhng/deep-research 的 generateFeedback：最多 N 条、清楚就少问）。
    """

    def test_missing_dimensions_are_named_in_the_prompt(self, harness):
        from services.rehearsal_control import _missing_dimensions

        assert "谁用（角色）" in _missing_dimensions("做一个诊所系统")
        # 反向：说清楚了的维度不许再报缺
        said = "给医生和前台用的诊所网页系统，核心流程是挂号到缴费，本期不做库存"
        assert _missing_dimensions(said) == [], _missing_dimensions(said)
        # 真机水果店：「老板能看今天卖了多少」就是谁用。漏掉老板 = 问候后还问核心用户。
        fruit = "街边水果店的收银台：称重、改价、结账，老板能看今天卖了多少"
        assert "谁用（角色）" not in _missing_dimensions(fruit), _missing_dimensions(fruit)

    def test_long_but_vague_text_is_not_auto_declared_clear(self):
        """反向：**不许**再用"字数够长就算说清"那条规则。

        旧 isUnderSpecifiedGoal 里写着 `if t.length >= 80: return false`。
        一百字的废话照样什么维度都没说。
        """
        from services.rehearsal_control import _missing_dimensions

        long_vague = "我想做一个很好用的系统" * 12  # 120+ 字，什么维度都没说
        assert len(long_vague) > 80
        assert _missing_dimensions(long_vague), "长文本被当成已充分规约了"

    def test_prompt_carries_the_hint_and_stops_after_one_round(self, harness):
        from models.v5_state import V5SessionState
        from services.rehearsal_control import _system_prompt

        vague = V5SessionState(
            sessionId="p1", goal={"text": "做一个诊所系统", "status": "needs_refinement"}
        )
        prompt = _system_prompt(vague)
        assert "把这件事做完" in prompt
        assert "还没读到" not in prompt
        assert "开范围卡之前" not in prompt
        assert "先用 clarify" not in prompt

        asked = V5SessionState(
            sessionId="p2",
            goal={"text": "做一个诊所系统", "status": "needs_refinement"},
            controlTranscript=[{"id": "c1", "kind": "clarify", "text": "问过了"}],
        )
        after = _system_prompt(asked)
        assert "还没读到" not in after
        assert "直接 scope_card" not in after
        assert "已经问过一轮" not in after


class TestUnansweredClarifyDoesNotBlockClosure:
    """没答的澄清**不许**把闭环判 blocked。

    ⚠ 这条是本仓第七条的分线题：澄清是**增强**（问了更准，不问也能跑），
      不是证据/闭环。把它做成 fail-closed 的后果是——用户关掉那张卡，
      整场推演就永远出不来，而且提示语还会说"缺证据"。

    ⚠ 反过来，真正的闭环缺口（写进 contract.blockingGapIds 的那些）**必须**
      照旧拦住。所以下面两条一起钉：澄清缺口不拦、契约缺口照拦。
    """

    def _state_with(self, gaps, blocking_ids):
        from models.v5_state import V5SessionState

        return V5SessionState(
            sessionId="clar-gate",
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=gaps,
            coverageContract={
                "id": "c1",
                "version": 1,
                "requiredCapabilities": [],
                "blockingGapIds": blocking_ids,
            },
        )

    def _gap(self, gid, kind="open_question", status="open"):
        return {
            "id": gid,
            "kind": kind,
            "label": f"{gid} 的问题",
            "status": status,
            "createdAt": "2026-08-27T00:00:00Z",
        }

    def test_open_clarify_gap_is_not_blocking(self):
        from services.slide_rule_coverage import evaluate_coverage_gate

        state = self._state_with([self._gap("gap-q-1")], blocking_ids=[])
        result = evaluate_coverage_gate(state)
        unresolved = (
            result.get("unresolvedGaps")
            if isinstance(result, dict)
            else getattr(result, "unresolvedGaps", [])
        ) or []
        assert "gap-q-1" not in unresolved, (
            "没答的澄清把闭环拦住了——用户关掉卡片就再也跑不出应用"
        )

    def test_contract_blocking_gap_still_blocks(self):
        """反向：写进契约的缺口照旧拦得住（别为了放行澄清把闸拆了）。"""
        from services.slide_rule_coverage import evaluate_coverage_gate

        state = self._state_with(
            [self._gap("gap-eviD", kind="missing_evidence")],
            blocking_ids=["gap-eviD"],
        )
        result = evaluate_coverage_gate(state)
        unresolved = (
            result.get("unresolvedGaps")
            if isinstance(result, dict)
            else getattr(result, "unresolvedGaps", [])
        ) or []
        assert "gap-eviD" in unresolved
