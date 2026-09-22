"""每个应用一套图表色（2026-08-04）——账本里那 8 套必须**逐套通过配色校验**。

## 这条防的是什么

改之前图表色是**只转色相**算出来的：六个色共用同一个明度（tone 58）和同一个
彩度，只有色相不同。感知上"轻重"完全一致，所以整屏看着"都是一个调调"。这不是
观感问题而已，dataviz 的 validate_palette.js 在白底上量出来两条硬指标不合格：

  · 相邻 #1f95c9 ↔ #009c95，常人视力 ΔE 9.0 —— 低于 15 的硬底线，
    **正常视力也难分**（这就是"一个调调"的量化形态）；
  · 相邻 #889227 ↔ #ce7535，红绿色盲 ΔE 2.4 —— 低于 8，约 8% 的男性看来同色。

根因是同一个：明度相同的两个色，色相再怎么转也拉不开感知距离。

所以"每个应用不一样"这件事**不能靠给每个应用换个色相起点来实现**——那只是把
同一个缺陷换个颜色复制到每个应用身上。变化必须来自**换一套验过的**。

## 这里断言什么

账本 chartThemes.variants 里每一套都要满足：

  ① 6 个色、全是合法 hex、**套内不重复**；
  ② 8 套**互不相同**（否则"每个应用不一样"是假的）；
  ③ 相邻两色在 OKLab 里的距离 ≥ 15（常人视力硬底线，就是上面 ΔE 9.0 栽的那条）。

③ 用的是与校验器同一套口径：OKLab 欧氏距离 ×100。这里只复算"常人视力"这一条
——色盲模拟（Machado-Oliveira-Fernandes 2009）不在本仓依赖里，那一条由改动时
手工跑校验器把关，账本注释里记着实测值（相邻色盲 ΔE 9.1~17.6）。把最容易回归
的那条钉在 CI 上，比一条都不钉强。

## 顺序本身就是安全机制

相邻对的区分度是**按这个顺序**验的：重排等于作废。所以 ③ 也顺带钉住了顺序——
有人把某一套的颜色调换位置，这条会红。
"""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.identity_palette_hint import derive_prompt_palette  # noqa: E402

_LEDGER = (
    Path(__file__).resolve().parent.parent / "services" / "data" / "identity_theme_presets.json"
)

#: 常人视力硬底线（OKLab 欧氏距离 ×100），与 dataviz 校验器同一个数。
_NORMAL_VISION_FLOOR = 15.0


def _variants() -> list[list[str]]:
    data = json.loads(_LEDGER.read_text(encoding="utf-8"))
    return [list(v) for v in data["chartThemes"]["variants"]]


def _oklab(hex_color: str) -> tuple[float, float, float]:
    from coloraide import Color

    c = Color(hex_color).convert("oklab")
    return (float(c["lightness"]), float(c["a"]), float(c["b"]))


def _delta_e(a: str, b: str) -> float:
    la, aa, ba = _oklab(a)
    lb, ab, bb = _oklab(b)
    return 100.0 * ((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2) ** 0.5


def test_ledger_has_variants():
    assert len(_variants()) >= 2, "少于两套就谈不上「每个应用不一样」"


@pytest.mark.parametrize("index", range(len(_variants())))
def test_each_variant_is_six_distinct_legal_colors(index):
    palette = _variants()[index]
    assert len(palette) == 6, palette
    for hexv in palette:
        assert isinstance(hexv, str) and len(hexv) == 7 and hexv.startswith("#"), hexv
        int(hexv[1:], 16)  # 非法 hex 直接抛
    assert len(set(palette)) == 6, f"套内有重复色：{palette}"


def test_variants_are_all_different():
    """8 套两两不同——否则散列挑中不同下标也可能画出同一套色。"""
    variants = _variants()
    seen = {tuple(v) for v in variants}
    assert len(seen) == len(variants)


@pytest.mark.parametrize("index", range(len(_variants())))
def test_adjacent_colors_clear_the_normal_vision_floor(index):
    """相邻两色必须拉得开——这正是旧算法栽的那一条（ΔE 9.0 < 15）。"""
    palette = _variants()[index]
    worst = min(
        (( _delta_e(palette[i], palette[i + 1]), palette[i], palette[i + 1])
         for i in range(len(palette) - 1)),
        key=lambda t: t[0],
    )
    assert worst[0] >= _NORMAL_VISION_FLOOR, (
        f"第 {index} 套相邻 {worst[1]}↔{worst[2]} ΔE {worst[0]:.1f} "
        f"< {_NORMAL_VISION_FLOOR}（常人视力也难分）"
    )


def test_legacy_hue_rotation_would_fail_the_same_floor():
    """反向锚点：**不传 key** 时退回的旧算法确实过不了这条底线。

    没有这条，上面那些用例可能是在为一个本来就不存在的问题背书——把旧值也量一遍，
    才证明这次换色板换掉的是一个真实缺陷，不是换了个说法。
    """
    legacy = derive_prompt_palette("#3B82F6")["charts"]
    worst = min(_delta_e(legacy[i], legacy[i + 1]) for i in range(len(legacy) - 1))
    assert worst < _NORMAL_VISION_FLOOR, (
        f"旧算法相邻最差 ΔE {worst:.1f} 已经达标——那这次换色板的理由就不成立了，"
        f"回去重新核对 dataviz 校验器的读数"
    )


def test_same_app_always_gets_the_same_palette_and_different_apps_differ():
    """散列必须稳定（刷新不换色），且不同应用要能挑到不同套。"""
    a1 = derive_prompt_palette("#3B82F6", chart_variant_key="宠护提醒")["charts"]
    a2 = derive_prompt_palette("#3B82F6", chart_variant_key="宠护提醒")["charts"]
    b = derive_prompt_palette("#3B82F6", chart_variant_key="绘本小站")["charts"]
    assert a1 == a2
    assert a1 != b
    # 挑中的必须是账本里的整套，不是现算的
    assert a1 in _variants() and b in _variants()


def test_shell_colors_stay_uniform_across_apps():
    """只动图表色——外壳仍然全站一个颜色，那是另一条裁决管的事。"""
    a = derive_prompt_palette("#3B82F6", chart_variant_key="宠护提醒")
    b = derive_prompt_palette("#3B82F6", chart_variant_key="绘本小站")
    for field in ("primary", "primaryHover", "sidebarBg", "sidebarText", "contentBg", "accentBg"):
        assert a[field] == b[field], field
