import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.device_policy import (  # noqa: E402
    DEVICE_AUTHORITY,
    infer_device_from_text,
    normalize_model_preferred_device,
    resolve_preferred_device,
)


def test_explicit_desktop_goal_overrides_phone_model_choice():
    assert resolve_preferred_device("做一个 PC 端采购审批网页", "phone") == "desktop"


def test_explicit_phone_goal_overrides_desktop_model_choice():
    assert resolve_preferred_device("做一个移动端巡检小程序", "desktop") == "phone"


def test_conflicting_explicit_devices_preserve_valid_model_choice():
    goal = "同时提供 PC 网页和手机 App"

    assert resolve_preferred_device(goal, "desktop") == "desktop"
    assert resolve_preferred_device(goal, "phone") == "phone"


def test_neutral_goal_preserves_valid_five_system_model_choice():
    goal = "做一个社区活动报名和核销系统"

    assert resolve_preferred_device(goal, "desktop") == "desktop"
    assert resolve_preferred_device(goal, "phone") == "phone"


def test_missing_invalid_and_watch_choices_fall_back_to_desktop():
    goal = "做一个设备维护记录系统"

    assert resolve_preferred_device(goal, None) == "desktop"
    assert resolve_preferred_device(goal, "") == "desktop"
    assert resolve_preferred_device(goal, "watch") == "desktop"


def test_infer_device_from_text_unique_word_only():
    assert infer_device_from_text("巡店点单平板") == "tablet"
    assert infer_device_from_text("做一个移动端巡检小程序") == "phone"
    assert infer_device_from_text("电脑和平板") is None
    assert infer_device_from_text("请假系统") is None


def test_wechat_miniprogram_stays_phone():
    """微信小程序仍只成 phone 档，不许另开一档、不许掉回 desktop。"""
    assert infer_device_from_text("做一个微信小程序亲子打卡") == "phone"
    assert resolve_preferred_device("做一个微信小程序亲子打卡", "desktop") == "phone"


def test_tablet_model_choice_and_explicit_goal_are_kept():
    assert resolve_preferred_device("做一个设备维护记录系统", "tablet") == "tablet"
    assert resolve_preferred_device("做个平板端堂食点单", None) == "tablet"


def test_normalization_writes_one_authoritative_device_without_losing_model_data():
    model = {
        "datamodel": {"entities": [{"id": "ticket"}]},
        "appbundle": {"preferredDevice": "desktop", "landingPageRef": "home"},
    }

    result = normalize_model_preferred_device("做一个手机报修 App", model)

    assert result is model
    assert result["datamodel"] == {"entities": [{"id": "ticket"}]}
    assert result["appbundle"]["landingPageRef"] == "home"
    assert result["appbundle"]["preferredDevice"] == "phone"
    assert result["appbundle"]["deviceAuthority"] == DEVICE_AUTHORITY == "single-v1"


def test_normalization_repairs_a_non_mapping_appbundle():
    model = {"appbundle": None}

    result = normalize_model_preferred_device("做一个库存系统", model)

    assert result["appbundle"] == {
        "preferredDevice": "desktop",
        "deviceAuthority": "single-v1",
    }


def test_composer_override_beats_goal_language_and_model_choice():
    """空态点了「应用」必须出 phone，哪怕句子里写的是网站。"""
    from services.device_policy import set_preferred_device_override

    set_preferred_device_override("phone")
    try:
        assert resolve_preferred_device("做一个库存系统", "desktop") == "phone"
        assert resolve_preferred_device("做一个采购审批网站", None) == "phone"
    finally:
        set_preferred_device_override(None)
    assert resolve_preferred_device("做一个库存系统", None) == "desktop"


def test_invalid_override_is_ignored():
    from services.device_policy import set_preferred_device_override

    set_preferred_device_override("watch")
    try:
        assert resolve_preferred_device("做一个库存系统", None) == "desktop"
    finally:
        set_preferred_device_override(None)


def test_tablet_override_is_honored():
    from services.device_policy import set_preferred_device_override

    set_preferred_device_override("tablet")
    try:
        assert resolve_preferred_device("做一个库存系统", "desktop") == "tablet"
    finally:
        set_preferred_device_override(None)
