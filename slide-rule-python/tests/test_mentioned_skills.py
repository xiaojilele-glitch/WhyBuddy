# -*- coding: utf-8 -*-
"""这一轮 @技能 只注入路径和一句话，不收窄已装目录。

用户要的是活的「自由 Agent 编排 + Skills 流程」：
  / 面板能选已装技能，正文留下 @office-skills，
  host 告诉模型去哪查 SKILL.md，不把全文倒进 system。

不是 SkillSelectBar 勾选存档，也不是写死 PPT 步骤。
删掉 _system_prompt 里的 playbooks 注入，或点名后仍把别的技能藏起来，必须红。
"""

from __future__ import annotations

import ast
from pathlib import Path

from control_turn_support import strip_python
from models.v5_state import V5SessionState
from services.control_skills import (
    mentioned_skill_playbooks,
    mentioned_skill_slugs,
    parse_skill_md,
)
import services.rehearsal_control as control

CONTROL_SRC = Path(control.__file__)


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


def _skill(name: str, description: str, body: str):
    info = parse_skill_md(
        f"---\nname: {name}\ndescription: {description}\n---\n{body}\n",
        path=f".sliderule/skills/{name}/SKILL.md",
    )
    assert info is not None
    return info


def test_mentioned_slugs_are_at_tokens_not_email_or_npm():
    assert mentioned_skill_slugs("@office-skills 做个5页PPT") == ["office-skills"]
    assert mentioned_skill_slugs(
        "用 @office-skills 和 @frontend-design",
        ["office-skills", "frontend-design"],
    ) == ["office-skills", "frontend-design"]
    assert mentioned_skill_slugs("npm@2.0 升级") == []
    assert mentioned_skill_slugs("做个PPT", ["office-skills"]) == []
    assert mentioned_skill_slugs("@ghost 做ppt", ["office-skills"]) == []


def test_playbook_is_path_and_summary_not_the_skill_body():
    info = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    text = mentioned_skill_playbooks([info])
    assert "office-skills" in text
    assert "做 PPT" in text
    assert ".sliderule/skills/office-skills/SKILL.md" in text
    assert "不是工程" in text
    assert "不要 file_read" in text
    assert "find" in text
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" not in text
    assert "必须先调" not in text
    assert "先 pip" not in text
    assert mentioned_skill_playbooks([]) == ""


def test_at_mention_points_to_path_and_keeps_other_installed_skills(monkeypatch):
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    other = _skill("frontend-design", "界面", "USE REAL FONT PAIRING")
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [office, other])
    token = control._CONTROL_PAYLOAD.set(
        {
            "userText": "@office-skills 做个5页PPT",
            "selectedSkills": ["office-skills"],
        }
    )
    try:
        state = V5SessionState(
            sessionId="mention-office",
            ownerId="alice",
            goal={"text": "做个PPT", "status": "clear"},
        )
        prompt = control._system_prompt(state)
        catalog = control._skill_infos_for_turn(state)
        named = control._mentioned_skill_infos(state)
    finally:
        control._CONTROL_PAYLOAD.reset(token)

    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" not in prompt
    assert "用户这一轮点名了技能" in prompt
    assert ".sliderule/skills/office-skills/SKILL.md" in prompt
    assert "不是工程文件" in prompt
    assert "源码和技能以磁盘为准" not in prompt
    assert "必须先调" not in prompt
    assert [info.name for info in named] == ["office-skills"]
    assert {info.name for info in catalog} == {"office-skills", "frontend-design"}
    assert "USE REAL FONT PAIRING" not in prompt


def test_no_mention_does_not_preload_body(monkeypatch):
    office = _skill("office-skills", "做 PPT", "HOW TO MAKE PPT WITH PYTHON-PPTX")
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [office])
    token = control._CONTROL_PAYLOAD.set({"userText": "做个5页PPT"})
    try:
        state = V5SessionState(
            sessionId="no-mention",
            ownerId="alice",
            goal={"text": "做个PPT", "status": "clear"},
        )
        prompt = control._system_prompt(state)
    finally:
        control._CONTROL_PAYLOAD.reset(token)
    assert "HOW TO MAKE PPT WITH PYTHON-PPTX" not in prompt
    assert "用户这一轮点名了技能" not in prompt


def test_live_path_preloads_from_system_prompt_source():
    """反向：把预加载从 _system_prompt 拿掉，或点名后又 filter_selected，这条红。"""
    prompt_body = _fn_body(strip_python(CONTROL_SRC), "_system_prompt")
    assert "_mentioned_skill_infos" in prompt_body
    assert "mentioned_skill_playbooks" in prompt_body

    turn_body = _fn_body(strip_python(CONTROL_SRC), "_skill_infos_for_turn")
    assert "installed_skill_infos" in turn_body
    assert "filter_selected" not in turn_body
