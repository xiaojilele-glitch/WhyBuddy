# -*- coding: utf-8 -*-
"""平板版式必须接到通电的插座上（2026-08-30）。

账本把 tablet 翻成 wired，不等于版式侧真用它。2026-08-30 之前
`freeform_block` 两处写成 `phone if … else desktop`——preferredDevice=tablet
会静静走桌面提示词和桌面画布。写好了、有测试、没人调 = 装在不通电的插座上。
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_freeform_asks_layout_device_not_phone_else_desktop():
    from services import freeform_block

    code = _code(freeform_block)
    assert "preferred_layout_device" in code
    assert 'device = "phone" if' not in code
    assert code.count("preferred_layout_device") >= 2, (
        "总览 enrich 和 FreeformInsight enrich 都要问这一处，"
        "只改一半 = 一半静默走桌面。"
    )


def test_preferred_layout_device_keeps_wired_tablet():
    from services.device_policy import preferred_layout_device

    assert preferred_layout_device({"preferredDevice": "tablet"}) == "tablet"
    assert preferred_layout_device({"preferredDevice": "phone"}) == "phone"
    assert preferred_layout_device({"preferredDevice": "watch"}) == "desktop"
    assert preferred_layout_device({"preferredDevice": ""}) == "desktop"


def test_strict_gate_accepts_tablet_rejects_watch():
    from services.v5_model_gate import validate_five_system_model

    # 只钉 preferredDevice 这一支：其余段用空壳会在别的 finding 上红。
    # 完整模型由 test_v5_llm_generate_gate 覆盖。
    from services.archetype_legal import supported_devices

    assert "tablet" in supported_devices()
    assert "watch" not in supported_devices()


def test_compile_path_has_tablet_branch_not_phone_else_desktop():
    """授予接通 ≠ 编译接通。这几处曾是 `phone if else desktop`。"""
    from services import design_language, spec_page_html, spec_tree

    for mod, needle in (
        (spec_page_html, 'device == "tablet"'),
        (design_language, 'device == "tablet"'),
        (spec_tree, "_TABLET_SPEC_IA"),
    ):
        code = _code(mod)
        assert needle in code, f"{mod.__name__} 没有平板枝"


def test_generation_schema_bar_comes_from_ledger():
    """契约里的 desktop|phone|tablet 必须是账本现算，不许再手写一份。"""
    from services.archetype_legal import device_domain_bar
    from services.schema_legal import experience_block_prompt_block
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION
    from services.v5_parallel_generate import _contract_instruction

    bar = device_domain_bar()
    assert "tablet" in bar
    assert f'"{bar}"' in _SCHEMA_INSTRUCTION
    assert bar in _contract_instruction()
    assert "watch" not in bar
    # 叶子只留占位符；填槽必须发生在生成侧。删掉 fill 这两条红。
    raw = experience_block_prompt_block()
    assert "__PREFERRED_DEVICES__" in raw
    assert "__DEVICE_GENERATION_BULLETS__" in raw
    assert "__PREFERRED_DEVICES__" not in _SCHEMA_INSTRUCTION
    assert "__DEVICE_GENERATION_BULLETS__" not in _SCHEMA_INSTRUCTION
    assert "__PREFERRED_DEVICES__" not in _contract_instruction()
