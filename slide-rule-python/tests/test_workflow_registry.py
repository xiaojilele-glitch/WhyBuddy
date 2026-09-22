from __future__ import annotations

import inspect

import pytest

from services.capability_plan import NEW_RUN, PRODUCT_REHEARSAL, TOOLS
from services.workflow_registry import (
    WorkflowPreset,
    register_workflow,
    workflow_for,
    workflow_names,
)
from services.workflow_select import (
    PAGES_PREVIEW,
    PAGES_PREVIEW_TOOLS,
    SPEC_PAGES_STRUCTURE,
    SPEC_PAGES_STRUCTURE_TOOLS,
    STRUCTURE_BIND,
    STRUCTURE_BIND_TOOLS,
    select_workflow,
)


def test_product_rehearsal_is_the_compatibility_default():
    preset = workflow_for("product_rehearsal")
    assert preset.name == PRODUCT_REHEARSAL
    assert preset.stages == NEW_RUN
    assert preset.tools == TOOLS


def test_workflow_registry_rejects_duplicates_and_bad_stage_contracts():
    with pytest.raises(ValueError, match="already registered"):
        register_workflow(WorkflowPreset("product-rehearsal", ("spec",)))
    with pytest.raises(ValueError, match="normalized"):
        register_workflow(WorkflowPreset("Game Prototype", ("goal",)))
    with pytest.raises(ValueError, match="non-empty"):
        register_workflow(WorkflowPreset("empty-workflow", ()))
    with pytest.raises(ValueError, match="assemble"):
        register_workflow(
            WorkflowPreset("bind-without-model", ("specfirst.bind",))
        )


def test_workflow_registry_keeps_custom_presets_isolated():
    register_workflow(WorkflowPreset("custom-prototype", ("goal", "scene")))
    assert workflow_for("custom_prototype").stages == ("goal", "scene")
    assert "custom-prototype" in workflow_names()


def test_select_workflow_has_no_goal_parameter():
    """话题词不进这个函数。加回 goal 参数 = 再给关键词分流开口。"""
    assert "goal" not in inspect.signature(select_workflow).parameters
    with pytest.raises(TypeError):
        select_workflow("门店巡检与离线复核")  # type: ignore[misc]


def test_select_workflow_is_the_product_rehearsal_calendar():
    assert select_workflow(device="tablet").name == PRODUCT_REHEARSAL
    assert select_workflow(device="phone").stages == NEW_RUN
    assert select_workflow(device="desktop").tools == TOOLS


def test_select_workflow_tools_override_does_not_invent_a_sixth():
    reduced = select_workflow(tools=("spec", "pages", "closure", "invented"))
    assert reduced.tools == ("spec", "pages", "closure")
    assert "specfirst.bind" not in reduced.stages
    assert "specfirst.structure" not in reduced.stages


def test_select_workflow_does_not_overwrite_the_registered_recipe():
    """本趟减菜不许冲掉注册表。删掉这条、改回 replace=True，下面必红。"""
    reduced = select_workflow(tools=("spec", "pages"))
    assert reduced.tools == ("spec", "pages")
    assert workflow_for("product-rehearsal").tools == TOOLS


def test_pages_preview_is_a_registered_choice_not_the_only_calendar():
    assert PAGES_PREVIEW in workflow_names()
    preview = select_workflow(name="pages-preview")
    assert preview.name == PAGES_PREVIEW
    assert preview.tools == PAGES_PREVIEW_TOOLS
    assert "specfirst.bind" not in preview.stages
    assert "specfirst.structure" not in preview.stages
    underscore = select_workflow(name="pages_preview")
    assert underscore.name == PAGES_PREVIEW
    extra = select_workflow(name="pages-preview", tools=("spec", "pages", "bind", "closure"))
    assert extra.tools == ("spec", "pages", "closure")
    assert select_workflow().name == PRODUCT_REHEARSAL


def test_structure_bind_is_a_complete_named_calendar():
    """建设单 O-9：完整闭包，不注入 spec，assemble 在场。"""
    assert STRUCTURE_BIND in workflow_names()
    preset = select_workflow(name=STRUCTURE_BIND)
    assert preset.name == STRUCTURE_BIND
    assert preset.tools == STRUCTURE_BIND_TOOLS
    assert "spec" not in preset.tools
    assert "specfirst.assemble" in preset.stages
    assert "specfirst.bind" in preset.stages
    assert "specfirst.spec" not in preset.stages


def test_spec_pages_structure_skips_bind_keeps_assemble():
    assert SPEC_PAGES_STRUCTURE in workflow_names()
    preset = select_workflow(name=SPEC_PAGES_STRUCTURE)
    assert preset.tools == SPEC_PAGES_STRUCTURE_TOOLS
    assert "specfirst.assemble" in preset.stages
    assert "specfirst.bind" not in preset.stages
    assert "specfirst.pages" in preset.stages


def test_unwired_archetypes_do_not_get_a_calendar():
    """O-9 不许给 wired=false 的原型批量开跑不通的日历。"""
    names = workflow_names()
    assert "casual-game" not in names
    assert "glance-app" not in names


def test_select_workflow_reads_policy_pack_when_tools_omitted():
    """删掉 allowed_tools 调用、改回写死五件套，这条必须红。"""
    src = inspect.getsource(select_workflow)
    assert "allowed_tools(" in src
    assert "product_rehearsal_plan(" in src
    business = select_workflow(archetype="business_app", device="desktop")
    assert business.tools == TOOLS
