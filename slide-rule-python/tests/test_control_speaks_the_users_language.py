"""控制面对用户开口跟用户同一种语言（默认简体中文）。

## 修的是什么（2026-09-15，真机 TicketStream）

sr-20260915165800-M6JK4H3XFB：用户中文需求、ask_user_question 和
write_plan 都已是中文，但派工具前的 `content` 是英文思考独白——
「Initial Assessment…」「playing the role of the thinking entity」。
host 把它当 `control_text` 开口，左栏整段英文。

技能包那句「用户输入是什么语言就用什么语言（默认简体中文）」控制面
漏了。思考模型默认用英文想，想完写进正文。

## 这条判据为什么这么写

⚠ 喂的是 `_system_prompt` 的**返回值**，不是源码字符串。注释里写
「简体中文」而提示词里没有，正向判据会假绿。

⚠ 反向：这不是第 2 格那本车间手册。语言是对用户开口的边界，路径
仍自己挑——「先用 clarify」不许借这条加回去。
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import CONTROL_TOOLS, _system_prompt  # noqa: E402

LIVE_GOAL = (
    "构建一个名为“TicketStream”的服务台 SaaS 界面。"
    "目的：管理支持工单、实时聊天和知识库。"
)


def _tool_description(name: str) -> str:
    return next(
        str((item.get("function") or {}).get("description") or "")
        for item in CONTROL_TOOLS
        if (item.get("function") or {}).get("name") == name
    )


def test_system_prompt_asks_for_the_users_language():
    text = _system_prompt(
        V5SessionState(
            sessionId="lang-ticketstream",
            goal={"text": LIVE_GOAL, "status": "clear"},
        )
    )
    assert "默认简体中文" in text
    assert "思考过程不要写进正文" in text
    assert LIVE_GOAL[:12] in text
    # 反向：语言边界不是流程手册。
    assert "先用 clarify" not in text
    assert "请调 pages" not in text


def test_questionnaire_and_plan_tools_speak_the_users_language():
    ask = _tool_description("ask_user_question")
    plan = _tool_description("write_plan")
    assert "默认简体中文" in ask, ask
    assert "默认简体中文" in plan, plan
    # 变异：只写进注释 / 只改 system、工具说明仍是英文手册 → 本条红。
    assert "问句和选项" in ask
    assert "计划正文" in plan
