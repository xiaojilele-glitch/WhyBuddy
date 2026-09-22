from types import SimpleNamespace

import services.project_acceptance as acceptance


def test_normalize_acceptance_requirements_bounds_and_deduplicates():
    values = acceptance.normalize_acceptance_requirements([
        "Create, edit and filter tasks through a real API",
        "  Add due date filtering  ",
        "Add due date filtering",
        "",
        "x" * 1201,
    ])
    assert values == ["Add due date filtering"]


def test_goal_requirements_are_extracted_without_parsing_plan_prose():
    state = SimpleNamespace(goal={"acceptanceRequirements": ["Add due date filtering"]})
    assert acceptance.approved_acceptance_requirements(state) == ["Add due date filtering"]


def test_approved_requirements_get_stable_profile_id():
    state = SimpleNamespace(goal={"acceptanceRequirements": ["Add due date filtering"]})
    extras = acceptance.approved_acceptance_requirements(state)
    first = acceptance.acceptance_profile(extras)
    second = acceptance.acceptance_profile(extras)
    assert extras == ["Add due date filtering"]
    assert first == second
    assert first["profileId"].startswith(acceptance.TASK_ACCEPTANCE_PROFILE + "+")
    assert "Add due date filtering" in first["requirements"]
