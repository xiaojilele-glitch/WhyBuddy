"""Closed browser actions compile before any driver runs.

反向：compile 放行无目标的 click、run_browser_action 在没 Playwright
时假装成功，本文件都会红。
"""

import pytest

from services.project_browser_interact import local_playwright_available, run_browser_action
from services.project_tool_contracts import compile_browser_action
from types import SimpleNamespace


def test_compile_requires_a_target_and_rejects_sudo():
    with pytest.raises(ValueError, match="project_sudo_forbidden"):
        compile_browser_action("browser_click", SimpleNamespace(
            sudo=True, index=0, coordinate_x=None, coordinate_y=None))
    with pytest.raises(ValueError, match="project_browser_action_invalid"):
        compile_browser_action("browser_click", SimpleNamespace(
            sudo=False, index=None, coordinate_x=None, coordinate_y=None))
    assert compile_browser_action("browser_click", SimpleNamespace(
        sudo=False, index=2, coordinate_x=None, coordinate_y=None)) == {
        "op": "click", "index": 2,
    }
    assert compile_browser_action("browser_input", SimpleNamespace(
        sudo=False, index=1, text="hello", press_enter=True)) == {
        "op": "type", "text": "hello", "pressEnter": True, "index": 1,
    }


def test_empty_preview_is_not_ready():
    with pytest.raises(ValueError, match="project_browser_preview_not_ready"):
        run_browser_action("", {"op": "snapshot"})


def test_missing_playwright_is_unavailable_not_a_fake_click(monkeypatch):
    monkeypatch.setattr("services.project_browser_interact.local_playwright_available", lambda: False)
    with pytest.raises(ValueError, match="project_browser_driver_unavailable"):
        run_browser_action("https://app.preview.example.com/", {"op": "snapshot"})


def test_playwright_shot_stays_off_the_model_observation(monkeypatch):
    import base64
    import json
    from types import SimpleNamespace

    png = b"\x89PNG\r\n\x1a\n" + b"shot"
    monkeypatch.setattr(
        "services.project_browser_interact.local_playwright_available", lambda: True
    )

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({
                "ok": True,
                "op": "snapshot",
                "url": "https://app.preview.example.com/",
                "title": "Game",
                "snapshot": [],
                "evaluated": None,
                "screenshot": base64.b64encode(png).decode("ascii"),
            }),
            stderr="",
        )

    monkeypatch.setattr(
        "services.project_browser_interact.subprocess.run", fake_run
    )
    result = run_browser_action(
        "https://app.preview.example.com/", {"op": "snapshot"}
    )
    assert result["screenshotPng"] == png
    assert "screenshot" not in result
    assert result["title"] == "Game"
