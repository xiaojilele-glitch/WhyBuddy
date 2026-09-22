"""Reference-image analysis contract for executable homepage reconstruction."""

from __future__ import annotations

import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_reconstruction import (  # noqa: E402
    analyze_page_reference,
    compile_reconstruction_prompt,
)


def _valid_spec(device: str = "desktop") -> dict:
    return {
        "device": device,
        "viewport": {"width": 1440 if device == "desktop" else 390, "height": 900 if device == "desktop" else 844},
        "componentLibrary": "antd" if device == "desktop" else "antd-mobile",
        "regions": [
            {
                "id": "hero",
                "role": "primary-action",
                "order": 1,
                "geometry": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 0.58},
                "hierarchy": 1,
                "layout": "full-bleed media with copy overlay",
                "alignment": "left",
                "spacing": "48px outer, 24px between copy",
                "typography": "display title, body support copy",
                "colors": ["#ffffff", "#1677ff"],
                "imagery": "cover image, center crop, readable text area on left",
                "component": {"library": "antd", "name": "Typography", "purpose": "hero copy"},
                "dataBindings": [],
                "fixedFacts": ["primary action is visible above the fold"],
                "confidence": 0.96,
            }
        ],
        "designTokens": {"radius": "6px", "contentMaxWidth": "1200px"},
        "fixedVisualFacts": ["hero occupies most of the first viewport"],
        "allowedAdaptations": ["copy may wrap to two lines"],
        "forbiddenDeviations": ["do not replace the hero with dashboard KPI cards"],
        "uncertainRegions": [],
    }


def test_compile_reconstruction_prompt_is_deterministic_and_explicit():
    spec = _valid_spec()

    first = compile_reconstruction_prompt(spec)
    second = compile_reconstruction_prompt(spec)

    assert first == second
    assert "desktop" in first
    assert "Ant Design" in first
    assert "hero" in first
    assert "x=0.000" in first and "height=0.580" in first
    assert "do not replace the hero with dashboard KPI cards" in first


def test_analyze_page_reference_returns_persistable_spec_and_prompt():
    captured = {}

    class Result:
        content = __import__("json").dumps(_valid_spec(), ensure_ascii=False)

    def fake_llm(messages, **kwargs):
        captured["messages"] = messages
        captured["kwargs"] = kwargs
        return Result()

    result = analyze_page_reference(
        "aW1hZ2U=",
        design_brief="营地预订首页，首要动作是立即预订",
        datamodel={"entities": [{"id": "booking", "fields": [{"id": "date", "type": "date"}]}]},
        device="desktop",
        llm_call=fake_llm,
    )

    assert result["version"] == "page-reconstruction-v1"
    assert result["status"] == "ready"
    assert result["spec"]["regions"][0]["id"] == "hero"
    assert "hero" in result["prompt"]
    content = captured["messages"][0]["content"]
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].endswith("aW1hZ2U=")
    assert captured["kwargs"]["temperature"] == 0.1


def test_analyze_page_reference_rejects_mismatched_device_without_raising():
    class Result:
        content = __import__("json").dumps(_valid_spec("phone"), ensure_ascii=False)

    result = analyze_page_reference(
        "aW1hZ2U=",
        design_brief="桌面审批台",
        datamodel={"entities": []},
        device="desktop",
        llm_call=lambda *args, **kwargs: Result(),
    )

    assert result["status"] == "failed"
    assert result["spec"] is None
    assert "device" in result["diagnostic"]


def test_analyze_page_reference_marks_missing_image_as_skipped():
    result = analyze_page_reference(
        None,
        design_brief="任意首页",
        datamodel={"entities": []},
        device="phone",
        llm_call=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not call LLM")),
    )

    assert result == {
        "version": "page-reconstruction-v1",
        "status": "skipped",
        "spec": None,
        "prompt": "",
        "diagnostic": "reference image unavailable",
    }


def test_analyze_page_reference_rejects_region_component_library_mismatch():
    spec = _valid_spec()
    spec["regions"][0]["component"]["library"] = "antd-mobile"

    class Result:
        content = __import__("json").dumps(spec, ensure_ascii=False)

    result = analyze_page_reference(
        "aW1hZ2U=",
        design_brief="桌面首页",
        datamodel={"entities": []},
        device="desktop",
        llm_call=lambda *args, **kwargs: Result(),
    )

    assert result["status"] == "failed"
    assert "component" in result["diagnostic"]


def test_analyze_page_reference_rejects_region_outside_the_image():
    spec = _valid_spec()
    spec["regions"][0]["geometry"].update({"x": 0.8, "width": 0.5})

    class Result:
        content = __import__("json").dumps(spec, ensure_ascii=False)

    result = analyze_page_reference(
        "aW1hZ2U=",
        design_brief="桌面首页",
        datamodel={"entities": []},
        device="desktop",
        llm_call=lambda *args, **kwargs: Result(),
    )

    assert result["status"] == "failed"
    assert "geometry" in result["diagnostic"]


def test_freeform_generator_includes_compiled_reconstruction_prompt(monkeypatch):
    from services.freeform_block import generate_freeform_block
    from sliderule_llm import client

    captured = {}

    class Result:
        content = '{"root":{"tag":"div","style":{},"children":[]}}'

    def fake_llm(messages, **kwargs):
        captured["messages"] = messages
        return Result()

    monkeypatch.setattr(client, "call_llm_with_retry", fake_llm)
    result = generate_freeform_block(
        "生成一个审批首页",
        {"entities": []},
        device="desktop",
        use_reference_image=False,
        allow_screenshot_verify=False,
        max_retries=0,
        reconstruction_prompt="RECONSTRUCT approval queue at x=0.100 width=0.800",
    )

    assert result["root"]["tag"] == "div"
    first_user_text = captured["messages"][0]["content"]
    assert "页面还原契约" in first_user_text
    assert "RECONSTRUCT approval queue at x=0.100 width=0.800" in first_user_text
