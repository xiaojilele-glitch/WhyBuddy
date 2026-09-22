"""sheet_palette — 从参照图里读出这个应用自己的图表色（2026-08-04）。

## 为什么要有这个模块

生成链路上每个应用都会画一张参照板（`freeform_block._generate_overview_sheet_b64`），
再喂给视觉模型学版式。那张图上**本来就有配色**——生图提示词从 2026-08-03 起
明确不再给色板，让它自由发挥，画出来的用色是这个业务的气质。

但那份配色此前**从来没有被读回来过**：视觉模型只被问了"这一页该怎么排"，
没人问过"图上是什么颜色"。真正画到图表上的色，来自账本里 8 套预置色序按应用名
散列挑一套——而那 8 套是**同一条 8 色 ramp 的 8 个旋转**，所以不同应用摆在一起
仍然是"一个调调"（用户实测三个应用的环图：黄/粉/绿/紫/红，只是起手位置不同）。

这个模块补的就是那一问：图已经生了、视觉通道已经通了，多问一句"你看到哪几个
分类色"，成本是一次小的视觉调用，拿到的是**这个应用自己的**颜色。

## 两条纪律

**① 不替生图模型改色，只挑和排**

拿到的色只做三件事：滤掉不能当分类色的（近中性、太亮/太暗）、去重、**重排**。
不会去调明度/彩度把它"修合格"——那样画出来的就不是图上那套颜色了，等于绕一圈
回到"算出来的色板"。排不出合格顺序就整套放弃，回落账本（见 ②）。

重排是安全的：区分度这条约束管的是**相邻两色**（见 test_chart_palette_variants
的说明），换顺序不动颜色本身就能满足，而顺序本来也没有语义。

**② 区分度不合格就整套不要**

相邻两色 OKLab 距离 ≥ 15 是硬底线（常人视力也难分的分界，与 dataviz 校验器同一
个数）。生图模型画的是"好看的界面"，不是"可区分的数据色板"，画出一组明度接近
的邻近色完全正常。那种情况下**宁可退回账本那 8 套验过的**，也不要把一组读者分
不开的颜色摆到图表上——好看但读不出来的图表比朴素的图表更糟。

所以这个模块的返回值只有两种：一套通过了全部检查的颜色，或者 None。没有"尽力
而为的半成品"。
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Optional

from sliderule_llm.config import default_max_tokens

__all__ = [
    "CHART_COLOR_COUNT",
    "MIN_USABLE_COLORS",
    "NORMAL_VISION_FLOOR",
    "delta_e",
    "extract_chart_palette",
    "usable_chart_palette",
]

#: 想要几个色。跟账本里每套色序的长度一致（identity_theme_presets.chartThemes）。
CHART_COLOR_COUNT = 6

#: 少于这个数就不值得用——分类色太少，画多类别时会开始循环取色，
#: 而循环取色正是"两个不同类别同一个颜色"的来源。
MIN_USABLE_COLORS = 4

#: 常人视力硬底线（OKLab 欧氏距离 ×100），与 dataviz 校验器、
#: test_chart_palette_variants 同一个数。
NORMAL_VISION_FLOOR = 15.0

#: 近中性（彩度太低）不能当分类色：几个灰摆在一起谁也分不出谁。
#: 参照板上大面积的白底/浅灰卡片壳都会落在这条线下面。
_MIN_CHROMA = 0.04

#: 太亮/太暗也不行——极浅色在白底上看不见，极深色几个之间也拉不开。
_MIN_LIGHTNESS = 0.30
_MAX_LIGHTNESS = 0.88

_HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")


def _oklab(hex_color: str) -> tuple[float, float, float]:
    from coloraide import Color

    c = Color(hex_color).convert("oklab")
    return (float(c["lightness"]), float(c["a"]), float(c["b"]))


def delta_e(a: str, b: str) -> float:
    """OKLab 欧氏距离 ×100。与 dataviz 校验器「常人视力」那条同一套口径。"""
    la, aa, ba = _oklab(a)
    lb, ab, bb = _oklab(b)
    return 100.0 * ((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2) ** 0.5


def _is_usable_category_color(hex_color: str) -> bool:
    """能不能当分类色。滤掉近中性和过亮/过暗（见模块头 _MIN_CHROMA 的说明）。"""
    from coloraide import Color

    try:
        c = Color(hex_color).convert("oklch")
    except Exception:  # noqa: BLE001 — 非法色值当不可用，不抛
        return False
    chroma = float(c["chroma"])
    lightness = float(c["lightness"])
    if chroma != chroma:  # NaN：纯灰
        return False
    return chroma >= _MIN_CHROMA and _MIN_LIGHTNESS <= lightness <= _MAX_LIGHTNESS


def _order_for_separation(colors: list[str]) -> list[str]:
    """贪心重排：**保留第一个**，之后每次挑离上一个最远的那个。

    约束管的是相邻对，所以"下一个尽量远"直接对着目标优化。

    第一个不动是有意的：提示词让模型"按在画面上的重要程度从高到低排"，那第一个
    就是这张图的主分类色，而图表的第一个系列通常也是主角。把它挪走等于把读到的
    信息扔掉一半——顺序的**其余部分**没有语义，可以随便排，第一位有。

    不是最优解（最优是 TSP 的反问题），但对 6 个色这个量级足够：真正决定成败的
    是图上那几个色本身拉不拉得开，顺序只是别把两个近的排到一起。
    """
    if len(colors) <= 2:
        return list(colors)
    remaining = list(colors)
    start = remaining.pop(0)
    out = [start]
    while remaining:
        nxt = max(remaining, key=lambda h: delta_e(out[-1], h))
        remaining.remove(nxt)
        out.append(nxt)
    return out


def _worst_adjacent(colors: list[str]) -> tuple[float, str, str]:
    return min(
        ((delta_e(colors[i], colors[i + 1]), colors[i], colors[i + 1])
         for i in range(len(colors) - 1)),
        key=lambda t: t[0],
    )


def usable_chart_palette(raw: Iterable[Any]) -> Optional[list[str]]:
    """一组候选色 → 可用的图表色序，或者 None。

    纯函数（不碰 LLM/网络），所以能单测。步骤：

      规范化 hex → 滤掉不能当分类色的 → 去重（含"肉眼同色"的近重复）
      → 重排拉开相邻距离 → 检查底线

    **任何一步剩得不够或者底线过不了就返回 None**，不返回半成品——见模块头 ②。
    """
    seen: set[str] = set()
    picked: list[str] = []
    for item in raw or []:
        if not isinstance(item, str):
            continue
        m = _HEX_RE.search(item.strip())
        if not m:
            continue
        hexv = m.group(0).lower()
        if hexv in seen:
            continue
        if not _is_usable_category_color(hexv):
            continue
        # 近重复也要滤：生图模型常在同一个色相上给出两个只差一点的值
        # （比如卡片底和它的悬停态），留着等于白占一个分类位。
        if any(delta_e(hexv, kept) < NORMAL_VISION_FLOOR / 2 for kept in picked):
            continue
        seen.add(hexv)
        picked.append(hexv)

    if len(picked) < MIN_USABLE_COLORS:
        return None
    ordered = _order_for_separation(picked)[:CHART_COLOR_COUNT]
    if len(ordered) < MIN_USABLE_COLORS:
        return None
    worst, _a, _b = _worst_adjacent(ordered)
    if worst < NORMAL_VISION_FLOOR:
        # 截短一位再试一次：常见形态是"前几个拉得很开，最后勉强凑的那个跟谁都近"。
        # 只让一次，不递归削到 MIN——那会变成"为了通过而不断丢色"。
        if len(ordered) - 1 >= MIN_USABLE_COLORS:
            ordered = ordered[:-1]
            worst, _a, _b = _worst_adjacent(ordered)
        if worst < NORMAL_VISION_FLOOR:
            return None
    return ordered


_PROMPT = (
    "这是一张企业应用界面的配色参考图。请只回答一件事：**图上用来区分不同类别的"
    "那几个颜色分别是什么**——也就是图表的扇区/柱子/折线、状态徽标、图标底色这类"
    "承担「这是不同的东西」的用色。\n\n"
    "不要报大面积的背景色（白底、浅灰卡片底、页面底色），也不要报文字的黑灰色。\n\n"
    f"最多 {CHART_COLOR_COUNT} 个，按在画面上的重要程度从高到低排。"
    "只输出严格 JSON，不要解释、不要 markdown 代码围栏：\n"
    '{"colors": ["#rrggbb", "#rrggbb"]}'
)


def extract_chart_palette(sheet_b64: str) -> Optional[list[str]]:
    """看一眼参照图，把它的分类色读出来。

    失败一律返回 None（调用方回落账本色序）——这是增强项，
    跟整条 experience 链路一样是 fail-open 的：**颜色读不出来不该拖垮生成**。
    """
    if not sheet_b64:
        return None
    try:
        from sliderule_llm.client import LlmError, call_llm_with_retry
    except Exception:  # noqa: BLE001
        return None

    convo = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": _PROMPT},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{sheet_b64}"},
                },
            ],
        }
    ]
    try:
        result = call_llm_with_retry(
            convo,
            max_attempts=2,
            backoff_ms=1500,
            # 温度压到 0：这一步是**读图上已经有的事实**，不是发挥。
            temperature=0.0,
            max_tokens=default_max_tokens(),
            on_delta=lambda _chunk: None,
        )
    except LlmError as exc:
        print(f"[sheet_palette] 取色跳过: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 取色失败绝不能拖垮主链路
        print(f"[sheet_palette] 取色跳过（意外）: {str(exc)[:160]}")
        return None

    raw = (result.content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    colors: Any = None
    try:
        colors = (json.loads(text) or {}).get("colors")
    except Exception:  # noqa: BLE001 — JSON 崩了就退回正则捞 hex
        colors = None
    if not isinstance(colors, list) or not colors:
        # 模型爱在 JSON 外面多写一句话。整段捞 hex 比整轮放弃划算——
        # 反正下面每个色都要过一遍可用性检查，捞多了也进不来。
        colors = _HEX_RE.findall(text)

    palette = usable_chart_palette(colors)
    if palette is None:
        print(f"[sheet_palette] 取到的色不合格（区分度/数量），回落账本色序: {colors}")
    return palette
