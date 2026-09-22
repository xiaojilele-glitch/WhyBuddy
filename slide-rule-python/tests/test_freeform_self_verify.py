"""FreeformInsight 自我校验闭环（2026-07-24，借鉴 abi/screenshot-to-code
的 screenshot_preview 思路：生成→截图→自己看→改）的单测覆盖。

只测新增的两个函数本身（_render_preview_screenshot_b64 / _critique_against_
reference），不跑真实 E2B 沙盒/真实 LLM——网关/沙盒都打桩，专注验证：
(1) E2B 不可用时直接静默返回 None，不发起任何网络调用；
(2) LLM 回复 "GOOD" 时不修订，原样返回 None；
(3) LLM 回复一版新 JSON 且能通过 Pydantic 校验时，返回修订后的 dump；
(4) LLM 回复的 JSON 校验不过时，静默丢弃修订、返回 None（不能让一次"想
    变好"的修订绕过校验直接生效）。
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import (  # noqa: E402
    _critique_against_reference,
    _render_preview_screenshot_b64,
    build_freeform_models,
)
from sliderule_llm.client import LlmResult  # noqa: E402


def _datamodel():
    return {
        "entities": [
            {
                "id": "ticket",
                "name": "工单",
                "fields": [
                    {
                        "id": "status",
                        "name": "状态",
                        "type": "enum",
                        "options": [{"id": "开", "label": "开"}, {"id": "关", "label": "关"}],
                    }
                ],
            }
        ]
    }


def _valid_design_dump():
    return {"root": {"tag": "div", "style": {}, "children": []}}


def test_render_preview_screenshot_returns_none_when_e2b_unavailable(monkeypatch):
    monkeypatch.setattr(
        "services.app_screenshot.local_screenshot_available", lambda: False
    )
    monkeypatch.setattr(
        "services.app_screenshot.e2b_screenshot_available", lambda: False
    )
    result = _render_preview_screenshot_b64(
        _valid_design_dump(), theme_id="azure", device="desktop", generated_theme=None
    )
    assert result is None


def test_render_preview_attaches_the_trusted_hero_to_the_preview_token(monkeypatch):
    stored = []
    monkeypatch.setattr("services.app_screenshot.local_screenshot_available", lambda: True)
    monkeypatch.setattr("services.app_screenshot.e2b_screenshot_available", lambda: False)
    monkeypatch.setattr(
        "services.app_screenshot.capture_freeform_preview_screenshot",
        lambda pid: b"PNG",
    )
    monkeypatch.setattr(
        "services.freeform_preview_store.put_preview",
        lambda payload: stored.append(payload) or "preview-1",
    )

    result = _render_preview_screenshot_b64(
        _valid_design_dump(),
        theme_id="azure",
        device="desktop",
        generated_theme=None,
        reference_image_b64="SEVSTw==",
    )

    assert result
    assert stored[0]["_landingHeroB64"] == "SEVSTw=="


def test_preview_media_endpoint_serves_hero_without_embedding_it_in_json():
    from routes.sliderule_full import get_freeform_preview, get_freeform_preview_media
    from services.freeform_preview_store import put_preview

    pid = put_preview({"freeformContent": _valid_design_dump(), "_landingHeroB64": "SEVSTw=="})
    payload_response = get_freeform_preview(pid)
    media_response = get_freeform_preview_media(pid, "landing-hero")

    assert "_landingHeroB64" not in json.loads(payload_response.body)
    assert media_response.body == b"HERO"
    assert media_response.media_type == "image/png"


def test_critique_against_reference_keeps_original_when_llm_says_good(monkeypatch):
    FreeformDesign = build_freeform_models(_datamodel())

    def fake_llm(*_args, **_kwargs):
        return LlmResult(
            content='"GOOD"',
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_llm)

    result = _critique_against_reference(
        _valid_design_dump(),
        reference_image_b64="ZmFrZQ==",
        preview_screenshot_b64="ZmFrZQ==",
        design_brief="测试区块",
        FreeformDesign=FreeformDesign,
    )
    assert result is None


def test_critique_against_reference_applies_valid_revision(monkeypatch):
    FreeformDesign = build_freeform_models(_datamodel())
    revised_json = (
        '{"root": {"tag": "div", "style": {}, '
        '"children": [{"tag": "span", "style": {}, "text": "补充卡片"}]}}'
    )

    def fake_llm(*_args, **_kwargs):
        return LlmResult(
            content=revised_json,
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_llm)

    result = _critique_against_reference(
        _valid_design_dump(),
        reference_image_b64="ZmFrZQ==",
        preview_screenshot_b64="ZmFrZQ==",
        design_brief="测试区块",
        FreeformDesign=FreeformDesign,
    )
    assert result is not None
    assert result["root"]["children"][0]["text"] == "补充卡片"


def test_critique_against_reference_discards_invalid_revision(monkeypatch):
    FreeformDesign = build_freeform_models(_datamodel())
    # tag "video" 不在白名单里，Pydantic 校验必然失败。
    invalid_json = '{"root": {"tag": "video", "style": {}, "children": []}}'

    def fake_llm(*_args, **_kwargs):
        return LlmResult(
            content=invalid_json,
            usage=None,
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_llm)

    result = _critique_against_reference(
        _valid_design_dump(),
        reference_image_b64="ZmFrZQ==",
        preview_screenshot_b64="ZmFrZQ==",
        design_brief="测试区块",
        FreeformDesign=FreeformDesign,
    )
    assert result is None
