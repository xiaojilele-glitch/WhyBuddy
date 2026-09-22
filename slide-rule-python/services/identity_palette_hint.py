"""identity_palette_hint — 种子色 → 提示色板（OKLCh 近似，2026-07-30）。

## 这是什么，为什么不是权威实现

真正渲染给用户看的色板只有一处权威实现：前端 `client/src/lib/identity-palette.ts`
的 `deriveIdentityPalette`（用 vendored 的 material-color-utilities，HCT/CAM16
空间派生）。Python 这边不重复实现它——`coloraide` 8.10 不支持 HCT/CAM16
（查过 `Color.CS_MAP`，没有 `hct`/`cam16` 条目），要么手搓约 300 行色彩科学，
要么就近似。既然这个模块的两个消费方（`freeform_block.py` 的 prompt 色板
提示、`palette_guard` 的色相校验参照色）**只关心色相是否一致**、不关心
色调数值跟前端渲染是否逐位精确对齐，就没必要为了数值精确去搬一套 HCT。

这里用 `coloraide` 已经具备的 OKLCh（同样是感知均匀空间，`palette_guard.py`
自己也在用）做同一套"色相不动、明度/彩度按规则挪"的近似派生——常数（tone
表、hover/渐变的偏移量、图表色相旋转量）逐项照抄前端的 HCT tone（0-100）
换算成 OKLCh lightness（0-1，除以 100），色相旋转量原样照搬（旋转角度跟
色彩空间无关）。两边测的不是同一把尺，但方向和意图完全对齐。

## 种子色从哪来

2026-08-03 起**全站一个颜色**：所有生成应用共用 `BRAND_SEED`，读自
`services/data/identity_theme_presets.json` 的 `brandSeed.seed`——前端
`live-runtime/identity-themes.ts` 读的是同一处。

这一条必须同源：Python 用它拼进生成提示词里那句"运行时的侧边栏/顶栏/按钮
已经按这套渲染了"，前端用它派生真正渲染的 12 个字段。两边各写一份的话，
提示词说的颜色和实际渲染的颜色会悄悄分叉，而这种分叉只有肉眼比对才看得出来。

`FALLBACK_SEED` 保留为读取失败时的最后兜底（JSON 缺失/损坏）——那是部署
事故，不该让整条生成链路跟着炸。
"""

from __future__ import annotations

import re
from typing import Any, Optional

from coloraide import Color

__all__ = [
    "BRAND_SEED",
    "BRAND_LABEL",
    "FALLBACK_SEED",
    "derive_prompt_palette",
    "set_design_system_override",
    "active_brand_seed",
]

#: 读不出账本时的最后兜底（JSON 缺失/损坏，属于部署事故）。
FALLBACK_SEED = "#5b6b7c"


def _read_brand_seed() -> tuple[str, str]:
    """从与前端同一份账本里读品牌种子色。

    模块导入期读一次：这个值在进程生命周期内不会变，而 prompt 拼接是热路径。
    读失败不抛——回落 FALLBACK_SEED，让链路继续跑（fail-open 是这条链路的纪律）。
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
    try:
        brand = json.loads(path.read_text(encoding="utf-8")).get("brandSeed") or {}
        seed = str(brand.get("seed") or "")
        if _HEX_RE.match(seed):
            return seed, str(brand.get("label") or "品牌")
    except Exception as exc:  # noqa: BLE001 — 账本读不出不该拖垮生成
        print(f"[identity_palette_hint] brandSeed 读取失败，回落兜底色: {str(exc)[:120]}")
    return FALLBACK_SEED, "中性 · 降级"

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

#: 全站唯一的品牌种子色 / 标签。与前端同读一份账本（见模块头说明）。
#: 赋值放在 _HEX_RE 之后：_read_brand_seed 要用它校验格式。
BRAND_SEED, BRAND_LABEL = _read_brand_seed()

# HCT tone（0-100）→ OKLCh lightness（0-1）的换算：除以 100。逐项抄自
# identity-palette.ts 的 TONE 表。
_TONE = {
    "accentBg": 0.94,
    "accentFg": 0.32,
    "contentBg": 0.97,
    "sidebarBg": 0.22,
    "sidebarText": 0.92,
}
# 2026-07-30：跟前端 identity-palette.ts 同步调轻（人工视觉核对反馈"整体
# 偏重"）——hover/渐变深度收窄，图表色调亮、彩度下限降低并加了上限。
_HOVER_DELTA = -0.06  # HCT -6 / 100
_GRAD_DELTA = -0.14  # HCT -14 / 100
_GRAD_HUE_SHIFT = 12.0
_CHART_HUE_SHIFTS = (0.0, 62.0, 145.0, 210.0, 285.0, 330.0)
_CHART_LIGHTNESS = 0.58  # HCT tone 58 / 100
# 图表色相的彩度下限/上限——OKLCh 尺度下的量级估计，不追求精确复刻前端
# TonalPalette 的 HCT 尺度数值，只要方向一致（下限降低、封了上限）。
_CHART_CHROMA_FLOOR = 0.07
_CHART_CHROMA_CEIL = 0.16
# 强调浅底/强调字的彩度打七折，跟前端 ACCENT_CHROMA_SCALE 同一个值——
# 全彩度铺在大面积浅底上比想要的"水洗"质感重得多。
_ACCENT_CHROMA_SCALE = 0.7


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _to_hex(lightness: float, chroma: float, hue: float) -> str:
    color = Color("oklch", [_clamp01(lightness), max(0.0, chroma), hue % 360.0])
    return color.convert("srgb").fit("srgb").to_string(hex=True).lower()


def _foreground_for(lightness: float) -> str:
    """底色 tone < 60（OKLCh lightness < 0.6）用白字，跟前端同一条判据。"""
    return "#ffffff" if lightness < 0.6 else "#1f1f1f"


def _chart_variants() -> list[list[str]]:
    """账本里那 8 套已验证图表色序（与前端 identity-palette.ts 同读一份）。

    不是"配"出来的，是**验**出来的：8 个旋转逐个跑过 dataviz 的
    validate_palette.js（白底），0 个 FAIL。顺序本身就是安全机制——相邻对的
    区分度按这个顺序验，重排等于作废。
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        variants = ((data.get("chartThemes") or {}).get("variants")) or []
        return [list(v) for v in variants if isinstance(v, list) and v]
    except Exception:  # noqa: BLE001 — 读不到就退回旧算法，配色不该拖垮生成
        return []


def _variant_index(key: str, count: int) -> int:
    """稳定散列（FNV-1a 32 位，与前端同一套）：同一个 key 永远落到同一套。

    ⚠️ **必须跟前端逐位相同**，否则同一个应用在提示词里说的图表色和真实画出来
    的不是同一套（2026-08-04 起 Python 这边真的开始用这个键了，此前从没传过）。

    这里喂给 XOR 的是 `ord(ch)` 整个码点，对齐前端的 `key.charCodeAt(i)`。
    原来写的是 `ord(ch) & 0xFF`——中文名字（码点 > 0xFF）下两边的 h 其实是
    不同的值，只是**账本正好有 8 套**（2 的幂），而 `h % 8` 只看低 3 位，
    XOR 高位的差异过不了乘法进到低 3 位，于是结果碰巧一直一致。实测 14 个
    中文应用名零分叉——账本一旦加到第 9 套，这个巧合立刻失效且悄无声息。
    与其留个陷阱，不如现在就让两边真的是同一个函数。
    """
    h = 0x811C9DC5
    for ch in key:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % count


def _charts_for(key: Optional[str], seed: str, hue: float, chroma: float) -> list[str]:
    """这个应用的 6 个图表色。

    给了 key 就从已验证色序里挑一套；没给就退回**旧的色相旋转**算法——那套
    区分度不合格（相邻 ΔE 常人 9.0 / 色盲 2.4），但它是老行为，不能因为这次
    改动让没传 key 的调用点悄悄变色。
    """
    variants = _chart_variants()
    if key and variants:
        return list(variants[_variant_index(key, len(variants))])
    out: list[str] = []
    for shift in _CHART_HUE_SHIFTS:
        if shift == 0.0:
            out.append(seed)  # 第一条必须是主色本身，理由同前端注释
        else:
            chart_chroma = min(max(chroma, _CHART_CHROMA_FLOOR), _CHART_CHROMA_CEIL)
            out.append(_to_hex(_CHART_LIGHTNESS, chart_chroma, hue + shift))
    return out


def derive_prompt_palette(
    seed_hex: str,
    *,
    id_: str = "generated",
    label: str = "",
    chart_variant_key: Optional[str] = None,
) -> dict[str, Any]:
    """种子色 → 提示色板（跟前端 IdentityPalette 同形状，供 prompt 拼接/
    palette_guard 参照色使用）。非法种子色落回 FALLBACK_SEED，不抛错——
    这条链路跟整个 experience 层一样是 fail-open 的。

    chart_variant_key：图表配色的挑选键（2026-08-04）。传一个每个应用稳定且
    互不相同的值（应用名即可），这个应用就固定拿到账本里 8 套已验证色序中的
    一套；不传退回旧的色相旋转算法。**必须跟前端传同一个值**——这份色板是
    写进生成提示词的"事实"，跟真实渲染分叉的话，提示词说的颜色和画出来的
    颜色不是一回事，而这种分叉只有肉眼比对才看得出来。
    """
    seed = seed_hex if isinstance(seed_hex, str) and _HEX_RE.match(seed_hex) else FALLBACK_SEED
    seed = seed.lower()
    oklch = Color(seed).convert("oklch")
    hue = oklch["hue"]
    if hue != hue:  # NaN：无色相（纯灰种子）
        hue = 0.0
    chroma = float(oklch["chroma"])
    lightness = float(oklch["lightness"])
    neutral_chroma = chroma * 0.2  # 与前端同一条 scheme_cmf.ts 规则：中性色带种子色相、彩度压两成

    grad_hue = (hue + _GRAD_HUE_SHIFT) % 360.0

    charts = _charts_for(chart_variant_key, seed, hue, chroma)

    accent_chroma = chroma * _ACCENT_CHROMA_SCALE

    return {
        "id": id_,
        "label": label or "",
        "primary": seed,
        "primaryHover": _to_hex(_clamp01(lightness + _HOVER_DELTA), chroma, hue),
        "gradTo": _to_hex(_clamp01(lightness + _GRAD_DELTA), chroma, grad_hue),
        "primaryFg": _foreground_for(lightness),
        "contentBg": _to_hex(_TONE["contentBg"], neutral_chroma, hue),
        "accentBg": _to_hex(_TONE["accentBg"], accent_chroma, hue),
        "accentFg": _to_hex(_TONE["accentFg"], accent_chroma, hue),
        "charts": charts,
        "sidebarBg": _to_hex(_TONE["sidebarBg"], neutral_chroma, hue),
        "sidebarText": _to_hex(_TONE["sidebarText"], neutral_chroma, hue),
    }


# --- 本轮设计系统覆盖（2026-08-24）-------------------------------------------
#
# 用户在作曲家里挑的那套设计系统。模式照抄 device_policy.set_preferred_device_override：
# 进程内单值，路由入口设、finally 清。
#
# ⚠ 为什么不是把 seed 当参数一路传下去：freeform_block 里读色板的地方有三处，
#   而且都在深层调用栈里。加三条传参链就是三处将来会忘记接的地方——本仓
#   「只改一半必然静默失效」那条纪律的标准形状。
#
# ⚠ finally 必须清。不清的话下一轮会脏读上一轮的选择，而且不会报错，
#   只是颜色莫名其妙变了——这种问题只有肉眼比对才看得出来。

_design_system_override: Optional[dict] = None


def _read_design_systems() -> dict:
    """启动时读一次。见下面 _DESIGN_SYSTEMS 的注释，别改回按调用读。"""
    from pathlib import Path

    path = Path(__file__).resolve().parent / "data" / "design_systems.json"
    try:
        import json

        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - 部署事故
        print(f"[identity_palette_hint] design_systems.json 读取失败: {str(exc)[:120]}")
        return {"defaultId": "", "systems": []}


#: ⚠ 模块级读一次，**不要改成每次调用现读**。
#:
#: set_design_system_override 是从 **async 路由处理函数**里直接调的
#: （routes/sliderule_full.py 的两个入口）。在那里 path.read_text() 就是
#: 事件循环上的裸阻塞 IO——tests/test_no_blocking_io_on_event_loop.py 正是
#: 钉这件事的守卫。那条守卫当前因为别的历史原因是红的，但"守卫本来就红"
#: 不构成照着犯的理由：红的守卫只是抓不住你，不是允许你。
#:
#: 这张表跟着代码走（不是运行时数据），启动读一次与 BRAND_SEED 同款。
_DESIGN_SYSTEMS = _read_design_systems()


def _load_design_systems() -> dict:
    return _DESIGN_SYSTEMS


def set_design_system_override(raw: Any) -> None:
    """本轮推演用哪套设计系统。认不出的 id / None = 回落默认（全站品牌色）。"""
    global _design_system_override
    if not raw:
        _design_system_override = None
        return
    table = _load_design_systems()
    hit = next((s for s in table.get("systems") or [] if s.get("id") == raw), None)
    if hit and _HEX_RE.match(str(hit.get("seed") or "")):
        _design_system_override = hit
    else:
        _design_system_override = None


def active_brand_seed() -> tuple[str, str]:
    """本轮的种子色与标签。没选就是全站品牌色（与改动前逐位相同）。"""
    if _design_system_override:
        return (
            str(_design_system_override["seed"]),
            str(_design_system_override.get("label") or BRAND_LABEL),
        )
    return BRAND_SEED, BRAND_LABEL
