# -*- coding: utf-8 -*-
"""网关连不上时，别把锅甩给用户（2026-09-05 真机第 5 轮）。

## 事故

真机 sr-20260904220902。用户把话说得清清楚楚：

    做一个网页端的汉字连线消除小游戏：网格里随机布字，玩家用鼠标把能组成
    词语的相邻汉字连起来消除，消除后上方字块下落补位，限时通关并记录最高分
    与连击数

回过去的是开场罐头：

    我是面团的推演引擎。**说一个要做的应用**，或问当前应用里已经推出来的
    角色/页面。

会话随即 `runtimePhase=idle`、`goal.status=needs_refinement`，整轮死在那儿。

用户只会读出一个意思：**你没听懂我**。于是重说一遍、再重说一遍——而真正的
原因（控制面 LLM 网关不可用）系统自己知道，`StoppedBy.PROVIDER` 就写在
`_STOP_TABLE` 的同一行里，只是没说出口。

跟今晚另外两条是同一个病：闭环没过却说「已完成」、待办没清却说「页面已经
出来」。**机器知道的事实，说话的那一版不知道。**
"""

import pytest

from services.rehearsal_control import CANNED_FAILURE, ControlStopReason, _STOP_TABLE


def _text(reason):
    return _STOP_TABLE[reason][1]


class Test网关不可用要说实话:
    def test_不再套开场罐头(self):
        """★ 事故本体。"""
        assert _text(ControlStopReason.LLM_UNAVAILABLE) != CANNED_FAILURE

    def test_不许再叫用户说一个要做的应用(self):
        """★ 用户刚刚**已经说了**。这句话是这次事故里最伤人的那半句。"""
        assert "说一个要做的应用" not in _text(ControlStopReason.LLM_UNAVAILABLE)

    def test_说清真实原因(self):
        assert "网关" in _text(ControlStopReason.LLM_UNAVAILABLE)

    def test_告诉用户他的话收到了(self):
        """跟"没听懂"划清界限——用户重说一遍解决不了网关问题。"""
        assert "收到" in _text(ControlStopReason.LLM_UNAVAILABLE)

    def test_给下一步(self):
        t = _text(ControlStopReason.LLM_UNAVAILABLE)
        assert "开始推演" in t or "再说一次" in t


class Test别的停因不许被顺手改坏:
    """反向配对：这次只动网关那一条。"""

    @pytest.mark.parametrize("reason,keyword", [
        (ControlStopReason.WALL_CLOCK, "想得太久"),
        (ControlStopReason.TOKEN_BUDGET, "额度用完"),
        (ControlStopReason.TOOL_ROUNDS, "好几轮"),
        (ControlStopReason.UNKNOWN, "没跑完"),
    ])
    def test_原话还在(self, reason, keyword):
        assert keyword in _text(reason)

    def test_每一种停因都有自己的话(self):
        """★ 这条是这次修复的**一般化**：没有哪两种停因该共用一句话。

        共用就意味着其中至少一种在说别人的原因——这次是网关借了开场白的嘴。
        """
        texts = [_STOP_TABLE[r][1] for r in ControlStopReason]
        assert len(set(texts)) == len(texts), "有两种停因共用同一句话"

    def test_开场罐头本身还在(self):
        """CANNED_FAILURE 作为**开场白**是对的，只是不该被停因借去用。"""
        assert "推演引擎" in CANNED_FAILURE
