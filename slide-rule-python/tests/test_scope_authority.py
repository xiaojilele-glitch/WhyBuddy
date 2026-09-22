# -*- coding: utf-8 -*-
"""范围授权：park / confirm / 本轮生成 三套优先级必须能被变异咬住。

对照 grok PermissionState。2026-09-01 起 park 的作曲家载荷是授予
（范围卡锁死置灰）。把 park 改回「句子压过载荷」，团子那场必红。
confirm 仍是载荷优先；把 confirm 改成句子压过点击，这条必须红。
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.scope_authority import (  # noqa: E402
    preferred_device_for_run,
    resolve_confirm_device,
    resolve_park_archetype,
    resolve_park_device,
    stamp_scope_onto_goal,
)


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_park_composer_payload_beats_sentence():
    """空态选了 Web/PC，句子里的「平板」不得改档。"""
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["/推演 巡店点单平板"],
            payload_device="desktop",
        )
        == "desktop"
    )


def test_park_composer_tablet_reaches_card():
    """空态选了平板，命题没写设备词，卡上必须是平板。"""
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["团子的一天"],
            payload_device="tablet",
        )
        == "tablet"
    )


def test_park_persisted_grant_used_when_no_payload():
    assert (
        resolve_park_device(
            last_card={"device": "tablet"},
            goal={"preferredDevice": "phone"},
            texts=["请假系统"],
            payload_device=None,
        )
        == "tablet"
    )


def test_park_archetype_payload_beats_card():
    assert (
        resolve_park_archetype(
            last_card={"productArchetype": "business_app"},
            goal={},
            payload_archetype="free_app",
        )
        == "free_app"
    )


def test_park_wechat_miniprogram_beats_default_desktop():
    """作曲家默认 desktop 不是授予。微信小程序必须停成 phone，卡不许撒谎。"""
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["做一个情侣共同记账的微信小程序"],
            payload_device="desktop",
        )
        == "phone"
    )
    # 澄清最后一答没有设备词，原命题还在。
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["线上预付定金锁定档期", "做一个社区宠物寄养的微信小程序"],
            payload_device="desktop",
        )
        == "phone"
    )


def test_park_without_grant_or_sentence_keeps_payload_or_sentinel():
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["请假系统"],
            payload_device="desktop",
        )
        == "desktop"
    )
    assert (
        resolve_park_device(
            last_card={},
            goal={},
            texts=["请假系统"],
            payload_device=None,
        )
        == "unspecified"
    )


def test_confirm_click_beats_sentence():
    """卡上点 desktop 是授予，句子里的平板压不过。"""
    assert (
        resolve_confirm_device(
            payload_device="desktop",
            last_card={"device": "phone"},
            goal={"preferredDevice": "phone"},
            texts=["巡店点单平板"],
        )
        == "desktop"
    )


def test_confirm_falls_back_to_card_then_goal_then_text():
    assert (
        resolve_confirm_device(
            payload_device="watch",
            last_card={"device": "tablet"},
            goal={},
            texts=[],
        )
        == "tablet"
    )
    assert (
        resolve_confirm_device(
            payload_device=None,
            last_card={"device": "unspecified"},
            goal={"preferredDevice": "phone"},
            texts=["巡店点单平板"],
        )
        == "phone"
    )
    assert (
        resolve_confirm_device(
            payload_device=None,
            last_card={},
            goal={},
            texts=["巡店点单平板"],
        )
        == "tablet"
    )


def test_run_device_persisted_grant_beats_composer_default():
    assert (
        preferred_device_for_run(
            goal={"preferredDevice": "tablet"},
            payload_device="desktop",
            texts=["把提交按钮改红"],
        )
        == "tablet"
    )


def test_run_device_this_turn_sentence_beats_persisted():
    assert (
        preferred_device_for_run(
            goal={"preferredDevice": "tablet"},
            payload_device="desktop",
            texts=["改成手机版"],
        )
        == "phone"
    )


def test_stamp_writes_both_grants():
    goal = stamp_scope_onto_goal(
        {},
        product_archetype="business_app",
        preferred_device="tablet",
        tools=["spec", "pages", "closure"],
    )
    assert goal["productArchetype"] == "business_app"
    assert goal["preferredDevice"] == "tablet"
    assert goal["tools"] == ["spec", "pages", "closure"]


def test_stamp_empty_tools_pops_the_key():
    """空清单不许写成什么都不跑。缺省 = 五件套，由规划器归一。"""
    goal = stamp_scope_onto_goal(
        {"tools": ["spec"]},
        tools=[],
    )
    assert "tools" not in goal


def test_stamp_ignores_unwired_device():
    goal = stamp_scope_onto_goal(
        {"preferredDevice": "desktop"},
        product_archetype="business_app",
        preferred_device="watch",
    )
    assert goal["preferredDevice"] == "desktop"
