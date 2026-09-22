"""闭环证据槽位的模型段优先级哨兵（2026-07-27 实测事故回归）。

事故：_build_per_skill_evidence 先跑 haystack 关键词匹配（artifact 的
id/title/kind/summary 里含 skill 名即认），推演过程自产的
"appbundle.runtimeClosure" 壳产物 id 里含 "appbundle"，抢占了 appbundle
槽位；夹具/LLM 分支只填空缺（if skill not in matches）——真正携带模型段
（_model_section）的产物被挡在门外。后果：perSkillEvidence.appbundle 恒缺
modelSection，appIdentity/generatedTheme 从未到达前端，演示域与 LLM 生成
应用的右栏主题恒回落 azure 默认（截图像素级实证 #0f2138）。

修复规则：携带模型段的产物优先于不带模型段的 haystack 壳。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 整个文件测的都是"夹具产物不被壳产物抢占槽位"，前提是夹具快路径开着。
# 该开关 2026-08-10 起默认关（见 _demo_fixture_enabled 头注）。
pytestmark = pytest.mark.usefixtures("demo_fixture_path")

from models.v5_state import Artifact, V5SessionState
from services.v5_capability_executor import (
    REQUIRED_EVIDENCE_KEYS,
    _build_per_skill_evidence,
)

GOAL = "我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效"


def _state_with_shell_artifact() -> V5SessionState:
    """复现事故现场：会话里已有一个 id 含 'appbundle' 的壳产物（无模型段）。"""
    state = V5SessionState(sessionId="t-priority", goal={"text": GOAL})
    state.artifacts.append(
        Artifact(
            id="art-3-appbundle.runtimeclosure",
            title="appbundle.runtimeClosure",
            kind="runtimeClosureEvidence",
            summary="closure evidence artifact produced mid-drive",
        )
    )
    return state


def test_fixture_model_section_wins_over_shell_artifact():
    per_skill = _build_per_skill_evidence(
        _state_with_shell_artifact(), blocked_signal=False, goal=GOAL
    )
    entry = per_skill["appbundle"]
    assert isinstance(entry.get("modelSection"), dict), "壳产物不得抢占带模型段的夹具产物"
    identity = entry["modelSection"].get("appIdentity") or {}
    assert identity.get("theme"), "appIdentity 必须随 modelSection 到达闭环"
    assert identity.get("generatedTheme"), "生成主题必须随 modelSection 到达闭环"
    assert entry["artifactId"] == "runtime-linkage-appbundle"


def test_all_skills_carry_model_section_despite_shells():
    """六系统全部带 modelSection——不止 appbundle 一个槽位受保护。"""
    state = V5SessionState(sessionId="t-priority-all", goal={"text": GOAL})
    for skill in REQUIRED_EVIDENCE_KEYS:
        state.artifacts.append(
            Artifact(
                id=f"art-x-{skill}-note",
                title=f"{skill} discussion note",
                kind="note",
                summary=f"mentions {skill} in passing",
            )
        )
    per_skill = _build_per_skill_evidence(state, blocked_signal=False, goal=GOAL)
    for skill in REQUIRED_EVIDENCE_KEYS:
        assert isinstance(per_skill[skill].get("modelSection"), dict), skill
