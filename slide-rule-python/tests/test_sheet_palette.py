"""参照图取色（2026-08-04）。

## 这条补的是什么

生成链路上每个应用都会画一张参照板，再喂给视觉模型学版式。那张图**本来就有
配色**（生图提示词从 2026-08-03 起不再给色板，让它按业务气质自由发挥），但
那份配色此前从来没有被读回来过——视觉模型只被问了"这一页该怎么排"。

真正画到图表上的色走的是另一条路：账本里 8 套预置色序按应用名散列挑一套。
而那 8 套是**同一条 8 色 ramp 的 8 个旋转**，所以不同应用摆在一起仍然是同一
串珠子从不同位置起数——用户实测三个不同业务的应用（宠物诊所/生鲜/绘本馆）
环图配色肉眼看不出区别，原话是"图表的颜色是一样的"。

## 这里守两件事

**① 图上的颜色能原样落地。** 取到什么就用什么——不调明度、不调彩度。一旦
开始"修"，出来的就不是图上那套颜色了，等于绕一圈回到算出来的色板。

**② 不合格的整套不要，绝不半用。** 生图模型画的是"好看的界面"，不是"可区分
的数据色板"，画出一组明度接近的邻近色完全正常。那种情况回落账本那 8 套验过
的——好看但读者分不开的图表，比朴素的图表更糟。

所以 usable_chart_palette 的返回值只有两种：一套过了全部检查的颜色，或者
None。没有中间态。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.sheet_palette import (  # noqa: E402
    MIN_USABLE_COLORS,
    NORMAL_VISION_FLOOR,
    CHART_COLOR_COUNT,
    delta_e,
    usable_chart_palette,
)

#: 一组明显拉得开的色（antd 官方分类色）——当"图上画得挺好"的样本。
GOOD = ["#1677ff", "#52c41a", "#fa8c16", "#eb2f96", "#722ed1", "#13c2c2"]


def _worst_adjacent(colors):
    return min(delta_e(colors[i], colors[i + 1]) for i in range(len(colors) - 1))


# ── ① 图上的颜色原样落地 ──────────────────────────────────────────


def test_good_palette_passes_through_unchanged():
    """每个色都必须是原样的那个值——这一步只挑和排，不改色。"""
    got = usable_chart_palette(GOOD)
    assert got is not None
    assert set(got) <= set(GOOD), f"出现了输入里没有的颜色：{set(got) - set(GOOD)}"


def test_first_color_is_kept_first():
    """第一个不动：提示词让模型按重要程度排序，第一个就是这张图的主分类色。

    其余顺序没有语义（可以随便排来拉开相邻距离），第一位有。
    """
    got = usable_chart_palette(GOOD)
    assert got[0] == GOOD[0]


def test_hex_is_normalized_and_extracted_from_prose():
    """模型爱在 JSON 外面多写一句话，整段捞 hex 比整轮放弃划算。"""
    got = usable_chart_palette(["主色 #1677FF", "#52C41A", "辅助 #FA8C16", "#EB2F96"])
    assert got == ["#1677ff", "#fa8c16", "#52c41a", "#eb2f96"] or got[0] == "#1677ff"
    assert all(c == c.lower() for c in got)


def test_caps_at_the_ledger_length():
    """给多了只取前几个——账本每套 6 个，多出来的位没人消费。"""
    got = usable_chart_palette(GOOD + ["#f5222d", "#2f54eb", "#a0d911"])
    assert len(got) <= CHART_COLOR_COUNT


# ── ② 不合格的整套不要 ────────────────────────────────────────────


def test_adjacent_colors_clear_the_normal_vision_floor():
    """返回的色序必须自己就是合格的——这是它存在的全部意义。"""
    got = usable_chart_palette(GOOD)
    assert _worst_adjacent(got) >= NORMAL_VISION_FLOOR


def test_near_neutrals_are_dropped():
    """白底、浅灰卡片壳是参照图上面积最大的颜色，但它们当不了分类色。

    几个灰摆在一起谁也分不出谁——而视觉模型很容易把它们当成"画面主要用色"报上来。
    """
    assert usable_chart_palette(["#ffffff", "#f5f5f5", "#e8e8e8", "#d9d9d9", "#bfbfbf"]) is None


def test_a_lone_neutral_does_not_take_up_a_slot():
    got = usable_chart_palette(["#1677ff", "#f5f5f5", "#52c41a", "#fa8c16", "#eb2f96"])
    assert got is not None
    assert "#f5f5f5" not in got


def test_near_duplicates_are_dropped():
    """同一色相上只差一点的两个值（比如卡片底和它的悬停态）留着等于白占一位。"""
    assert usable_chart_palette(["#1677ff", "#1a7aff", "#2080ff", "#2686ff"]) is None


def test_too_few_usable_colors_is_a_reject():
    """分类色太少会开始循环取色，而循环取色正是"两个类别同一个颜色"的来源。"""
    assert usable_chart_palette(["#1677ff", "#52c41a"]) is None
    assert usable_chart_palette([]) is None
    assert usable_chart_palette(None) is None


def test_a_pretty_but_unreadable_palette_is_rejected_whole():
    """一组明度接近的邻近色——生图模型很常见的"高级灰蓝紫"配色。

    好看，但相邻两色读者分不开。这种情况**整套放弃**回落账本，而不是勉强留下
    ——见模块头 ②。
    """
    monochrome_ish = ["#6b7fd7", "#7183d4", "#6f86dd", "#7480d0", "#6d82d9"]
    assert usable_chart_palette(monochrome_ish) is None


def test_garbage_input_does_not_raise():
    """取色是增强项，链路 fail-open：脏输入返回 None，不抛。"""
    assert usable_chart_palette(["", None, 42, {"a": 1}, "#zzzzzz"]) is None


def test_min_usable_is_honored_exactly():
    """刚好够数的一组要能过——边界不该被误杀。"""
    exact = GOOD[:MIN_USABLE_COLORS]
    got = usable_chart_palette(exact)
    assert got is not None and len(got) == MIN_USABLE_COLORS


# ── 接进提示词：说的和画的必须是同一套 ────────────────────────────


def test_prompt_palette_follows_the_extracted_colors():
    """设计 LLM 看到的图表色 = 真实会画出来的那几个。

    这条防的是一个具体的分叉：前端渲染已经优先用参照图取到的色了，提示词这边
    要是还列着账本旧色，设计 LLM 就会照着一组不会出现的颜色配色，同一页上出现
    两套配色系统。而这种分叉**只有肉眼比对才看得出来**。
    """
    from services.freeform_block import _theme_prompt_fragment

    picked = usable_chart_palette(GOOD)
    frag = _theme_prompt_fragment("azure", None, picked)
    for color in picked:
        assert color in frag, f"提示词里没提到 {color}"


def test_prompt_palette_falls_back_when_nothing_was_extracted():
    """没取到色时提示词跟这次改动之前**逐字相同**——老行为零变化。"""
    from services.freeform_block import _theme_prompt_fragment

    assert _theme_prompt_fragment("azure", None, None) == _theme_prompt_fragment("azure")
    # 取到一组不合格的色也走同一条兜底，不能让半套色泄进提示词
    assert _theme_prompt_fragment("azure", None, ["#ffffff", "#f5f5f5"]) == _theme_prompt_fragment(
        "azure"
    )


def test_ledger_fallback_uses_the_same_hash_as_the_frontend():
    """兜底挑账本色序的键，两边必须逐位同一个函数。

    这条是 2026-08-04 补的，因为 Python 这边**这次才第一次真的用这个键**。
    原来 Python 写的是 `ord(ch) & 0xFF`、前端是 `charCodeAt(i)`（完整码点），
    中文名字下两边的 h 其实不同——只是账本正好 8 套（2 的幂），`h % 8` 只看低
    3 位，高位的 XOR 差异过不了乘法进到低 3 位，于是碰巧一直一致。**账本加到
    第 9 套这个巧合就失效**，而症状只是"提示词说的色和画出来的色对不上"，
    没人会往散列上想。

    所以这里直接照抄前端那一版实现来比，而不是比"当前账本长度下的结果"。
    """
    from services.identity_palette_hint import _chart_variants, _variant_index

    def frontend_variant_index(key: str, count: int) -> int:
        """逐行照抄 client/src/lib/identity-palette.ts 的 variantIndex。"""
        h = 0x811C9DC5
        for ch in key:
            h ^= ord(ch)  # charCodeAt(i)
            h = (h * 0x01000193) & 0xFFFFFFFF
        return h % count

    names = ["宠护提醒", "鲜瞳识鲜", "绘本小站", "果园智记", "消防巡检台", "FreshEye"]
    # 用一个**非 2 的幂**的套数来比：正是这个数暴露出两版实现的差异
    for count in (len(_chart_variants()), 9, 7):
        for name in names:
            assert _variant_index(name, count) == frontend_variant_index(name, count), (
                f"'{name}' 在 {count} 套下 Python 与前端挑到了不同的色序"
            )


# ── 门禁：出现即校验 ──────────────────────────────────────────────


def _model_with_chart_colors(colors):
    return {
        "datamodel": {
            "entities": [
                {"id": "t", "name": "T", "fields": [{"id": "n", "name": "N", "type": "string"}]}
            ]
        },
        "rbac": {
            "roles": ["r"],
            "permissions": ["t:view"],
            "menus": [
                {"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}
            ],
        },
        "workflow": {
            "id": "wf",
            "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
            "transitions": [],
        },
        "page": {
            "pages": [
                {"id": "p", "name": "P", "fieldBindings": ["t.n"], "actionPermissions": ["t:view"]}
            ]
        },
        "aigc": {"capabilities": []},
        "appbundle": {
            "pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
            "roleRefs": ["r"],
            "dataModelRefs": ["t"],
            "appIdentity": {"chartColors": colors},
        },
    }


def test_gate_accepts_a_legal_chart_palette():
    from services.v5_model_gate import validate_five_system_model

    assert validate_five_system_model(_model_with_chart_colors(GOOD))["passed"] is True


@pytest.mark.parametrize(
    "bad",
    [
        "#1677ff",                        # 不是数组
        ["#1677ff", "#52c41a"],           # 数量不够
        ["#1677ff", "#52c41a", "#fa8c16", "红色"],  # 有一个不是 hex
        ["#1677ff", "#52c41a", "#fa8c16", "#12345"],  # 位数不对
    ],
)
def test_gate_rejects_illegal_chart_palettes(bad):
    """出现即校验：这段会被前端直接画出来，非法值 = 画不出来的假承诺。"""
    from services.v5_model_gate import validate_five_system_model

    report = validate_five_system_model(_model_with_chart_colors(bad))
    assert report["passed"] is False
    assert any("chartColors" in str(f) for f in report.get("findings") or [])


def test_repair_clears_an_illegal_palette_whole():
    """非法就整段清掉，不是"把好的挑出来留下"。

    区分度是按**整套的相邻关系**验的，从一套里捡几个剩下的拼起来，那个组合谁
    都没验过。清掉即回落账本里 8 套验过的，比留半套强。
    """
    from services.v5_model_repair import repair_five_system_model

    # 修复器是纯函数：修过的在返回值的 model 里，入参不动
    out = repair_five_system_model(
        _model_with_chart_colors(["#1677ff", "#52c41a", "#fa8c16", "不是颜色"])
    )
    identity = out["model"]["appbundle"]["appIdentity"]
    assert "chartColors" not in identity
    # 清了要留痕，不能悄悄消失
    notes = out["presentation"]["clearedIdentity"]
    assert any(n.get("key") == "chartColors" for n in notes)


def test_repair_keeps_a_legal_palette():
    from services.v5_model_repair import repair_five_system_model

    out = repair_five_system_model(_model_with_chart_colors(GOOD))
    assert out["model"]["appbundle"]["appIdentity"]["chartColors"] == GOOD
