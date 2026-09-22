"""SSOT 收编哨兵（2026-07-26）：图标/槽位/主题不再两边手抄。

历史问题：图标形状正则+legacy 别名表在 freeform_block.py 与前端
block-registry.tsx 各写一份；gate 的 LAYOUT_SLOTS 手抄目录 allowedSlots；
8 套主题色板 Python 侧手抄前端 THEMES；生成主题合格标准后端 8 键弱检查、
前端 11 项严校验——四处平行拷贝全都没有对账哨兵，谁改一边另一边不会红。

现在真相源收进共享 JSON（experience_block_catalog.json /
identity_theme_presets.json，前端经 vite alias 直读同一份文件），本文件锁
Python 侧的派生关系与契约行为。前端侧对应哨兵：
client/src/pages/sliderule/__tests__/ssot-parity.test.ts
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import freeform_block, schema_legal
from services.freeform_block import _theme_palette, is_valid_generated_theme
from services.identity_palette_hint import BRAND_LABEL, BRAND_SEED
from services.identity_theme_gen import IdentityThemeSeedSpec
from services.v5_model_gate import validate_five_system_model  # noqa: F401 — import 即哨兵

_DATA = Path(__file__).resolve().parent.parent / "services" / "data"
CATALOG = json.loads((_DATA / "experience_block_catalog.json").read_text(encoding="utf-8"))
PRESETS = json.loads((_DATA / "identity_theme_presets.json").read_text(encoding="utf-8"))
LEGAL = json.loads((_DATA / "five_system_legal.json").read_text(encoding="utf-8"))


# ── 图标合法域从目录派生 ───────────────────────────────────

def test_icon_pattern_derived_from_catalog():
    assert freeform_block._ANTD_ICON_NAME_RE.pattern == CATALOG["freeformIconNamePattern"]
    assert schema_legal.FREEFORM_ICON_NAME_PATTERN == CATALOG["freeformIconNamePattern"]


def test_legacy_icon_aliases_derived_from_catalog():
    assert freeform_block._LEGACY_ICON_ALIASES == set(CATALOG["freeformLegacyIconAliases"].keys())
    # 映射值必须都是合法组件名形状（前端要拿它去 AntdIcons 查表）
    for alias, component in CATALOG["freeformLegacyIconAliases"].items():
        assert freeform_block._ANTD_ICON_NAME_RE.match(component), (alias, component)
        assert not freeform_block._ANTD_ICON_NAME_RE.match(alias), alias


# ── 槽位从目录派生（gate 不再手抄）─────────────────────────

def test_gate_layout_regions_derived_from_catalog():
    assert set(schema_legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS) == set(CATALOG["pageRegions"])
    # gate 源码不允许再出现手抄槽位集合
    gate_src = (Path(__file__).resolve().parent.parent / "services" / "v5_model_gate.py").read_text(
        encoding="utf-8"
    )
    assert 'LAYOUT_SLOTS = {"summary"' not in gate_src
    assert "LAYOUT_SLOTS = set(EXPERIENCE_BLOCK_ALLOWED_REGIONS)" in gate_src


# ── 生成主题契约：与前端同一判定（2026-07-30 起只有 seed 一个必填字段）──
#
# 此前这里还有三条测主题预设的（test_theme_hints_derived_from_presets /
# test_preset_ids_match_legal_ledger / test_presets_pass_generation_spec）：
# 那三条锁的是"8 套手挑色板"这个东西本身的一致性，而这次改动的目的正是
# 删掉那套东西——presets JSON 不再有 themes 键，锁一个已经不存在的结构
# 没有意义。appIdentity.theme 的 8 个合法 id 仍然在 five_system_legal.json
# 里、仍然被 gate/repair 校验（v5_model_gate.py/v5_model_repair.py 那两处
# 没有改），但它们不再对应任何色板，两边不再需要"id 清单一致"这条哨兵。

VALID_THEME = {"seed": "#123456", "label": "测试主题"}


def test_generated_theme_contract_accepts_valid():
    """契约判定本身还在（存量数据要能被识别），但**不再决定颜色**。"""
    assert is_valid_generated_theme(VALID_THEME)


def test_palette_is_always_the_brand_seed(monkeypatch):
    """全站一个颜色（2026-08-03，用户裁决）：不管传什么都出品牌色板。

    这条锁的是"不会有半套新半套旧"：库里的存量应用带着各自的
    generatedTheme，如果它们还能影响配色，同一个应用中心里就会既有品牌色
    的新应用、又有五颜六色的老应用——而外壳（白菜单/白 Header）是统一的，
    混在一起比全都不统一更难看。
    """
    for arg in (VALID_THEME, {"label": "只有标签没有种子色"}, None, {"seed": "#ff0000"}):
        palette = _theme_palette("azure", arg)
        assert palette["primary"] == BRAND_SEED.lower(), f"{arg} 影响了配色"
        assert palette["label"] == BRAND_LABEL


def test_brand_seed_is_read_from_the_shared_ledger():
    """种子色必须来自前后端同读的那份账本，不能在 Python 里写死。

    写死的话，改一次颜色要记得改两个地方；漏掉一边的症状是"提示词说的颜色
    和实际渲染的颜色不一样"——只有肉眼比对才看得出来。
    """
    import json
    from pathlib import Path

    ledger = json.loads(
        (Path(__file__).resolve().parent.parent / "services" / "data" / "identity_theme_presets.json")
        .read_text(encoding="utf-8")
    )
    assert BRAND_SEED == ledger["brandSeed"]["seed"]
    assert BRAND_LABEL == ledger["brandSeed"]["label"]


def test_generated_theme_contract_rejects_trailing_newline():
    """Python 的 $ 豁免尾随换行、JS 不豁免——必须用 fullmatch 堵住这道
    "后端判合格、前端整套弃用"的换行错配窗口。"""
    sneaky = dict(VALID_THEME, seed="#123456\n")
    assert not is_valid_generated_theme(sneaky)


def test_generated_theme_contract_rejects_bad_hex():
    assert not is_valid_generated_theme(dict(VALID_THEME, seed="red"))
    assert not is_valid_generated_theme(dict(VALID_THEME, seed="#12345"))


def test_spec_fields_cover_contract():
    contract = PRESETS["generatedThemeContract"]
    assert set(contract["requiredKeys"]) <= set(IdentityThemeSeedSpec.model_fields.keys())


# ── 区块生成放开名单从目录派生（2026-07-27）──────────────────
# 历史事故：渲染器 07-22/07-23 陆续接上，prompt 里那句"渲染器还没上线，
# 不要输出 page.blocks"却留在原地五天——WorkflowTimeline 这类已经能用的
# 区块一次都没被渲染过。放开名单现在由 generationEnabled 决定，改目录即
# 改 prompt；前端侧的 rendererStatus 对账见 ssot-parity.test.ts。

def test_generation_enabled_requires_real_renderer():
    """放开生成的前提是渲染器是真的——占位渲染器放开=用户看到死卡片。"""
    for block in CATALOG["blocks"]:
        if block.get("generationEnabled"):
            assert block.get("rendererStatus") == "real", (
                f"{block['type']} 放开了生成但 rendererStatus="
                f"{block.get('rendererStatus')}"
            )


def test_catalog_rejects_enabling_placeholder_block(monkeypatch):
    """坏组合必须在加载期 fail-fast，不能带病进 prompt。

    2026-07-28：原来这里是"从真实目录里挑一个 placeholder 再打开开关"来造
    坏数据。五个占位区块补上真渲染器之后目录里一个 placeholder 都没有了，
    循环挑不到东西、坏组合根本没造出来，测试就变成了永远通过的空壳
    （DID NOT RAISE 时才暴露）。改成显式合成一条坏区块——不变式的测试不该
    依赖真实数据里恰好存在一个反例。
    """
    import copy

    import pytest

    bad = copy.deepcopy(CATALOG)
    bad["blocks"].append(
        {
            **copy.deepcopy(bad["blocks"][0]),
            "type": "__SyntheticPlaceholder__",
            "rendererKey": "__synthetic-placeholder__",
            "rendererStatus": "placeholder",
            "generationEnabled": True,
        }
    )
    monkeypatch.setattr(schema_legal, "_BLOCK_CATALOG", bad)
    with pytest.raises(ValueError, match="放开了生成"):
        schema_legal._load_experience_blocks()


def test_prompt_allowlist_derived_from_catalog():
    """prompt 的放开名单逐字来自目录，不是手写的第二份清单。

    只锁「名单派生自目录」这个契约，不锁包着它的那句话怎么写——2026-07-28
    把措辞从许可式（You MAY emit…）改成祈使式时，这条曾因为断言里钉死了
    "ONLY these types are renderable today: " 而误报。措辞是要随实测调的，
    名单来源才是不能漂的那一头。
    """
    prompt = schema_legal.experience_block_prompt_block()
    enabled = [b["type"] for b in CATALOG["blocks"] if b.get("generationEnabled")]
    disabled = [b["type"] for b in CATALOG["blocks"] if not b.get("generationEnabled")]
    assert enabled, "目录里一个可生成区块都没有——放开名单退化了？"
    # 通电名单必须整串出现（顺序也来自目录，防止有人另手写一份）
    assert ", ".join(enabled) in prompt
    # 未通电的必须被点名禁止，且不能混进通电名单那一串里
    for t in disabled:
        assert t in prompt, f"{t} 未通电，prompt 必须明确点名禁止它"
        assert t not in ", ".join(enabled)


def test_prompt_no_longer_carries_blanket_ban():
    """那句一刀切禁令必须消失，否则放开名单等于白写（真实事故复现哨兵）。"""
    prompt = schema_legal.experience_block_prompt_block()
    assert "DO NOT emit page.blocks for production pages" not in prompt
    assert "renderer for it is NOT shipped yet" not in prompt
