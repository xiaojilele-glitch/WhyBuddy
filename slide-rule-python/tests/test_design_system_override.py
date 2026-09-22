"""设计系统按轮覆盖：选了要生效，跑完要清干净。

这份判据挡两件都不报错的事：

1. **选择器变装饰**：UI 上换了设计系统，生成提示词里的颜色没变。
   本仓「闸全绿但东西没了」的标准形状——正向判据（选择存下来了）齐全，
   反向判据（它真的影响了产物）缺失。

2. **串轮脏读**：finally 忘了清 override，下一轮沿用上一轮的颜色。
   不会报错，只是颜色莫名其妙不对，且只有肉眼比对才看得出来——
   device_policy 的 _override 注释里已经写过同一个坑。
"""

from services.freeform_block import _theme_palette
from services.identity_palette_hint import (
    BRAND_SEED,
    active_brand_seed,
    set_design_system_override,
)


def _primary(system_id):
    set_design_system_override(system_id)
    try:
        return _theme_palette("brand").get("primary")
    finally:
        set_design_system_override(None)


def test_默认那套设计系统的种子色_等于_brand_seed():
    """⚠ 不要写成 `active_brand_seed() == BRAND_SEED`——无覆盖时它**必然**成立，
    是句同义反复，把 design_systems.json 的默认种子色改成红色也照样绿。
    要比的是**表里那套默认系统**和 brandSeed 是不是同一个色。"""
    import json
    from pathlib import Path

    data_dir = Path(__file__).resolve().parents[1] / "services" / "data"
    systems = json.loads((data_dir / "design_systems.json").read_text(encoding="utf-8"))
    presets = json.loads(
        (data_dir / "identity_theme_presets.json").read_text(encoding="utf-8")
    )
    default = next(
        s for s in systems["systems"] if s["id"] == systems["defaultId"]
    )
    assert default["seed"].lower() == presets["brandSeed"]["seed"].lower()
    # 顺带确认运行时也走的是它
    assert active_brand_seed()[0].lower() == default["seed"].lower()


def test_选了别的设计系统_提示色板真的跟着变():
    default = _primary(None)
    forest = _primary("forest")
    ember = _primary("ember")
    # 三者两两不同：只要有两个相等，就说明覆盖没真正接上
    assert len({default, forest, ember}) == 3, (default, forest, ember)


def test_中性底色跟随主色色相_不是固定灰():
    """identity-palette 的支点那一行：neutral 用主色色相、彩度压到两成。

    绿系统的底色应当偏绿、暖系统的底色应当偏暖。这条要是失效，
    整套配色会退回"主色变了但页面还是那个灰"的样子。
    """
    set_design_system_override("forest")
    try:
        green_bg = _theme_palette("brand").get("contentBg")
    finally:
        set_design_system_override(None)
    set_design_system_override("ember")
    try:
        warm_bg = _theme_palette("brand").get("contentBg")
    finally:
        set_design_system_override(None)
    assert green_bg != warm_bg, (green_bg, warm_bg)


def test_清空之后回到默认_不串轮():
    before = _theme_palette("brand").get("primary")
    set_design_system_override("ember")
    _theme_palette("brand")
    set_design_system_override(None)
    after = _theme_palette("brand").get("primary")
    assert before == after == _primary(None)


def test_认不出的_id_回落默认_不抛错():
    for bad in ("不存在", "", None, 123, {"id": "forest"}):
        set_design_system_override(bad)
        try:
            assert active_brand_seed()[0] == BRAND_SEED, bad
        finally:
            set_design_system_override(None)


def test_路由两个入口都设了也都清了():
    """同步驱动 / 流式驱动是本仓的经典成对物——流式是前端主路径，
    只改同步等于没改。流式信封在 helper 里设/清。"""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    routes = (root / "routes" / "sliderule_full.py").read_text(encoding="utf-8")
    helper = (root / "services" / "drive_full_factory.py").read_text(encoding="utf-8")
    assert "set_design_system_override(" in routes
    assert routes.count("set_design_system_override(None)") >= 1
    assert "set_design_system_override(design_system_id)" in helper
    assert helper.count("set_design_system_override(None)") >= 1
    assert "start_drive_full_factory_run" in routes
