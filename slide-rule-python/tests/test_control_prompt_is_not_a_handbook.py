"""第 2 格：控制面 system 是「把这件事做完」，不是车间规章。

漫画：老师傅被提示词工作手册绑住——先 clarify、再 scope_card、
选项必须带括号。grok 是 complete the request。

变异：把手册句子加回去 → 本条红。
反向：话题、缺维度事实、宪章注入还在。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import _system_prompt  # noqa: E402


HANDBOOK = (
    "选项必须带",
    "直接 scope_card",
    "开范围卡之前",
    "先用 clarify",
    "不要等人点确认",
    "未确认不得 rehearse",
    "问候用 ask_user",
    "请调 pages",
    "精修（refine）",
    "下一跳请挑",
    "在哪用（平台）",
    "已经问过一轮澄清",
)


def test_prompt_is_complete_the_job_not_a_syllabus():
    text = _system_prompt(
        V5SessionState(sessionId="p2", goal={"text": "水果店收银台", "status": "clear"})
    )
    assert "把这件事做完" in text
    assert "水果店收银台" in text
    assert "只能调用给定工具" in text
    # ⚠ 2026-09-09：这里原来断言「禁止开放闲聊」。那句和「把这件事做完」加在
    #   一起堵死了「就回答一句」这条路——模型只剩造东西一个合法出口，真机乱码
    #   那轮它把心里话说出来了：「但我需要推进应用创建流程」。
    #
    #   改抄 grok-build `xai-grok-agent/templates/prompt.md` 的 work_policy：
    #   「明确要动手的就动手；提问/说明/评论这类，回答就好，不要顺手造东西」。
    #   边界没丢——「别跑题」还在，只是不再顺手把「回答」也禁掉。
    assert "不跑题" in text, "跑题那道边界丢了"
    assert "回答就好" in text, "又把「只回答一句」这条路堵死了"
    assert "不要顺手造东西" in text
    # ⚠ 2026-09-18 抄 grok claim-done / is_background。只改上面那句不够：
    #   真机问账号时模型照样改文件打 build，把 queued 的 ok 当成跑完。
    assert "工具结果撑得住" in text, "又把「没证据不许说做完」漏了"
    assert "is_background=true" in text, "没告诉模型后台跑不是做完"
    assert "默认简体中文" in text, "对用户开口的语言边界丢了"
    assert "思考过程不要写进正文" in text
    for banned in HANDBOOK:
        assert banned not in text, banned


def test_missing_dimensions_are_not_a_start_gate():
    """第 7 格：有产品话题就干活。缺维度不许再写进 system 当开工门。"""
    text = _system_prompt(
        V5SessionState(
            sessionId="p2-miss",
            goal={"text": "做一个诊所系统", "status": "needs_refinement"},
        )
    )
    assert "把这件事做完" in text
    assert "还没读到" not in text
    assert "在哪用" not in text
    assert "开范围卡之前" not in text
    assert "最多 3 条" not in text


def test_empty_topic_still_says_none():
    text = _system_prompt(
        V5SessionState(sessionId="p2-empty", goal={"text": "", "status": "needs_refinement"})
    )
    assert "尚无确认的应用目标" in text
    assert "把这件事做完" in text
    assert "还没读到" not in text, "问候空目标还报缺维度，等于暗令先澄清"
    cont = _system_prompt(
        V5SessionState(
            sessionId="p2-cont",
            goal={"text": "继续", "status": "needs_refinement"},
        )
    )
    assert "还没读到" not in cont, "目标是「继续」还报缺维度"


def test_fruit_shop_cashier_is_enough_to_start():
    """漫画第 7 格：做个水果店收银台。不许先问类型/设备。"""
    text = _system_prompt(
        V5SessionState(
            sessionId="p7-fruit",
            goal={"text": "做个水果店收银台", "status": "clear"},
        )
    )
    assert "把这件事做完" in text
    assert "水果店收银台" in text
    assert "还没读到" not in text
    assert "在哪用" not in text
    assert "产品类型" not in text
    assert "请先选择" not in text


def test_scope_card_is_replaced_by_plan_tools():
    from services.rehearsal_control import CONTROL_TOOLS

    names = {tool["function"]["name"] for tool in CONTROL_TOOLS}
    assert "scope_card" not in names
    assert {"write_plan", "exit_plan_mode", "ask_user_question"} <= names


def test_project_prompt_carries_local_readiness_without_replacing_browser_acceptance():
    import services.rehearsal_control as control

    class Readiness:
        def capability_readiness(self):
            return {"rolloutConfigured": True, "previewConfigured": False,
                    "browserConfigured": True, "blockers": ["project_preview_not_configured"]}

    token = control._PROJECT_TOOLS.set(Readiness())
    try:
        text = _system_prompt(V5SessionState(
            sessionId="project-readiness", runtimeKind="project",
            goal={"text": "任务管理应用", "status": "clear"}))
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert "私有预览=blocked" in text
    assert "独立浏览器=ready" in text
    assert "不能用构建、API 或模型自述替代" in text
    assert "project_preview_not_configured" in text
