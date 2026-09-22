"""
FreeformInsight 区块的结构化生成与校验（2026-07-23，实验三 Pydantic + reask
机制生产化，记录见 docs/freeform-llm-generation-experiment-2026-07-23.md）。

不引入 instructor 包——本仓网关已经真机验证过会撞 WAF UA 拦截 + Cloudflare
524（docs/OSS_GAP_ANALYSIS.md），instructor SDK 栈默认用 openai SDK 的非流式
HTTP 客户端，两条都会撞。改成在 sliderule_llm.structured 的流式 reask 骨架
（call_llm_with_retry + on_delta 强制流式）上，加一层 Pydantic 深校验——原来
structured_llm_json 只做 shape 级校验（JSON 能解析 + 必需字段非空），这里补
到"标签/样式/图标在白名单内 + 数字类内容必须挂 dataRef 指向真实数据"。
（"数字必须挂 dataRef"这条 2026-07-26 前只写在本段注释里、代码从没真正
执行——LLM 把编造数字写进普通 text 就一路直达渲染。现在由 FreeformNode 的
check_numbers_grounded 校验器真实拦截、错误回喂 reask，guardrails 声明式
validator 同款思路。）

安全边界：LLM 只产出数据（标签/样式/文字/图标引用/dataRef），永远不会被当
代码执行；渲染端只用安全 API 拼装（React createElement），不用 dangerouslySet
InnerHTML/eval。压力测试实测：模型第一次交上来的东西几乎从不完全合规，这层
校验不是极端情况下的兜底，是正常路径。

分层：本模块只管"一个 FreeformInsight 区块的内容"生成与校验，跟
v5_model_gate 校验整个五系统模型是两回事——调用方在重试耗尽时应该把这个
区块降级/拿掉，不能让一个装饰性区块的生成失败拖垮整个应用发布。
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Literal, Optional

import json_repair
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from pathlib import Path

from sliderule_llm.config import default_max_tokens

from .app_preview import OverviewPreviewSink
from .enrich_timing import remaining_run_budget_seconds, stage as _enrich_stage
from .identity_palette_hint import (
    BRAND_LABEL,
    BRAND_SEED,
    active_brand_seed,
    derive_prompt_palette,
)
from .sheet_palette import usable_chart_palette
from .palette_guard import extract_hex_colors, palette_report, repair_colors
from .schema_legal import (
    EXPERIENCE_BLOCKS,
    EXPERIENCE_BLOCK_BINDING_SCHEMAS,
    FREEFORM_ALLOWED_ICON_REFS,
    FREEFORM_ALLOWED_STYLE_PROPS,
    FREEFORM_ALLOWED_TAGS,
    FREEFORM_ICON_NAME_PATTERN,
    FREEFORM_LEGACY_ICON_ALIASES,
)

_DANGEROUS_VALUE_RE = re.compile(r"url\(|javascript:|expression\(|import\b|@import", re.I)

# 无单位数字属性——数字值原样输出，不补 px。名单取自 React 源码
# shared/CSSProperty.js 的 isUnitlessNumber（只保留本仓库
# freeformAllowedStyleProps 里真实存在的那些；React 那份还有一堆 SVG/
# 老式 box-flex 属性，我们的白名单里没有，列了也用不上）。
_UNITLESS_STYLE_PROPS = frozenset({
    "flex", "flexGrow", "flexShrink", "fontWeight", "lineHeight",
    "opacity", "zIndex",
})

# lineHeight 不带单位时是"字号的倍数"（CSS 规范特例，React 的
# isUnitlessNumber 原样保留这条），不是像素值——真机逮到过 LLM 把它当成
# "字号 28px 配一个稍大的行高 32" 来写，写成 lineHeight: 32（或强转后的
# "32"），结果渲染成 32 倍字号 = 896px 的行高，一整行 KPI 卡被撑到
# 1000+px，图表/列表全被挤到一屏之外——版式看着"稀疏"，其实是这一个属性
# 把后面的内容全推没了。正常行高倍数很少超过 3（宽松排版顶格用到 2），
# 超过这个阈值基本可以断定是"把像素值当倍数写"的手误，拦下来逼它改用带
# 单位的写法（比如 "32px"），不做静默纠偏——纠偏会把"该用多大行高"这个
#设计判断替它做了，交回 reask 让它自己选一个合理值更稳妥。
_LINE_HEIGHT_RATIO_MAX = 4.0


def _check_plausible_line_height(value: str) -> None:
    try:
        ratio = float(value)
    except (TypeError, ValueError):
        return  # 带单位（"32px"/"150%"）或其它形式，不是这条要拦的情况
    if ratio > _LINE_HEIGHT_RATIO_MAX:
        raise ValueError(
            f"lineHeight '{value}' 不带单位时表示字号的倍数（1.5 = 1.5 倍字号），"
            f"不是像素值——{value} 倍字号会把行高撑到离谱的高度，把同一行/同一页"
            "后面的内容挤出可视区域。如果想要更宽松的行距，用 1.2~2 之间的倍数；"
            "如果确实需要一个固定像素值，必须带单位写成比如 '32px'。"
        )

# 合法的 Ant Design 图标组件名形状：PascalCase + Outlined/Filled/TwoTone 结尾
# （@ant-design/icons 全部图标都遵循这个命名，前端按名字动态解析）。校验只看
# 形状不看具体名字——编造/拼错的名字前端解析不到会渲染成空，优雅降级。
# 2026-07-26：正则与 legacy 别名不再手抄——从 experience_block_catalog.json
# 派生（前端 block-registry.tsx 同源），改目录一处两端同步。
_ANTD_ICON_NAME_RE = re.compile(FREEFORM_ICON_NAME_PATTERN)
# 老模型里可能还有这批 kebab 语义名（放开之前的 12 个白名单），前端保留了
# 同名别名映射，这里也一并放行，历史产物不炸。
_LEGACY_ICON_ALIASES = frozenset(FREEFORM_LEGACY_ICON_ALIASES.keys())


class FreeformGenerationError(RuntimeError):
    """FreeformInsight 内容生成/校验失败（调用方应把这个区块降级/拿掉）。"""


# 取值范围的说明词——"前5条""最近3笔""Top 10"这类**列表标题**，说的是
# "这个列表打算显示几行"，不是"数据算出来是几"。它们没有聚合可挂，被当成
# 数据声明拦下就是死局：模型改不出能过的写法，只能重试到耗尽。
#
# 2026-08-05 真跑代价：首页设计连挂三次、609 秒零产出，全败在同一个「前5条」
# 上——而那正是 rowsRef 的 limit（默认 5）在标题里的自然说法。
#
# 为什么原来会漏：下面那条量词规则的注释自称"不拦结构性数字"，但它靠的是
# 「天/小时/年不在量词表里」这个巧合，没有任何正向白名单。于是同样形状的
# 标签，命运取决于量词碰巧在不在表里——`前10名` 放行、`前5条` 拦下。
_STRUCTURAL_SCOPE_RE = re.compile(
    r"(?:前|最近|近|第|top|Top|TOP)\s*\d[\d,\.]*\s*"
    r"(?:条|单|件|个|笔|人|次|名|项|页|行|天|周|月|年)?"
)

# "数据声明"形状的数字——check_numbers_grounded 只拦这些。
# ⚠️ 判定前先把上面那些取值范围说明词挖掉，否则它们会被下面的量词规则误伤。
_NUMERIC_CLAIM_RES = (
    re.compile(r"^\W*[¥$€]?\d[\d,\.]*\s*%?\W*$"),          # 整段就是一个数（"128" "1,234.5%"）
    re.compile(r"[¥$€]\s*\d"),                              # 货币（"¥128,000"）
    re.compile(r"\d+(\.\d+)?\s*%"),                         # 百分比（"3.5%"）
    re.compile(r"\d{1,3}(,\d{3})+"),                        # 千分位（"12,345"）
    re.compile(r"(共|合计|总计|累计)\s*\d"),                 # 计数句式（"共 42 条"）
    re.compile(r"\d[\d,\.]*\s*(条|单|件|个|笔|人|次|元|万|亿)"),  # 数+量词（"328 单"）
)


def _NUMERIC_CLAIM_RES_MATCH(text: str) -> bool:
    """这段文字是不是在"声称一个算出来的数"。

    先把取值范围说明词（前5条/最近3笔/Top 10）挖掉再判——挖的是**那一小段**
    而不是整句，所以"最近30天新增 128 单"里的 `128 单` 照样拦得住：被挖掉的
    只有 `最近30`，剩下的仍然是一句实打实的数据声明。
    """
    stripped = _STRUCTURAL_SCOPE_RE.sub(" ", text)
    return any(p.search(stripped) for p in _NUMERIC_CLAIM_RES)


# 内容树硬上限（micromark/cmark 同款纪律：不可信输入必须带嵌套/规模上限）。
# 超限在这里被 Pydantic 拦下、错误回喂 reask；前端 block-registry.tsx 用同
# 值做纵深防御第二道（持久化快照恢复也走渲染那条路径）。改值两侧要一起改。
FREEFORM_MAX_DEPTH = 12
FREEFORM_MAX_NODES = 300

# rowsRef 单次取行数（2026-08-03）。逐行内容展开发生在渲染期，一个 rowsRef
# 就能把 limit 份模板子树摆进页面——limit 不设上限的话，一句 "limit": 500 能
# 直接把渲染预算（FREEFORM_MAX_NODES）吃穿、页面高度也失控。默认值按参照图上
# 排行榜/动态流的常见长度取（5~8 条），上限给到 20 留余量。
# 两侧同值：前端 block-registry.tsx 展开时再夹一次（纵深防御，快照恢复也走那条路）。
ROWS_REF_DEFAULT_LIMIT = 5
ROWS_REF_MAX_LIMIT = 20


def _env_budget(name: str, default: int) -> int:
    """读一个非负整数预算 env；不合法/未设走默认。0 = 完全关闭该项开销。"""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


# 体验层成本笼子（2026-07-26）：每个区块/每个 monitor 页此前都各自独立生一张
# 参考图 + 各起一个一次性 E2B 沙盒截图自检，无缓存、无上限、全部串行——
# 区块多的应用把"过门 → 发布"拖到分钟级。上限按"每次 enrich 调用"计，
# 超出预算的区块退化为纯文字生成（行为与未配生图/沙盒时完全一致，不是
# 静默丢内容）；命中即打日志（no silent caps）。
_ENRICH_MAX_REF_IMAGES_ENV = "SLIDERULE_ENRICH_MAX_REF_IMAGES"
_ENRICH_MAX_SCREENSHOT_VERIFY_ENV = "SLIDERULE_ENRICH_MAX_SCREENSHOT_VERIFY"
_ENRICH_MAX_REF_IMAGES_DEFAULT = 4
_ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT = 2


def _freeform_tree_bounds(root: Any) -> "tuple[int, int]":
    """迭代遍历（不递归——校验器自己先栈爆就本末倒置了），返回 (最大深度, 节点总数)。

    节点数越过上限两倍就提前止损返回，不为一棵注定被拒的树白遍历到底。
    """
    max_depth = 0
    count = 0
    stack: list[tuple[Any, int]] = [(root, 1)]
    while stack:
        node, depth = stack.pop()
        count += 1
        if depth > max_depth:
            max_depth = depth
        if count > FREEFORM_MAX_NODES * 2:
            break
        children = getattr(node, "children", None) or []
        for child in children:
            stack.append((child, depth + 1))
    return max_depth, count


# 生成主题（appIdentity.generatedTheme）的合格契约——与前端
# isValidGeneratedTheme 同读 presets JSON 里的 generatedThemeContract。
# 2026-07-30 起契约只剩一个必填字段 seed（路线丙：LLM 只选种子色，其余
# 字段由 identity_palette_hint.derive_prompt_palette / 前端 deriveIdentityPalette
# 派生），不再是 11 项严校验。
_THEME_PRESETS_PATH = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
_THEME_PRESETS: dict[str, Any] = json.loads(_THEME_PRESETS_PATH.read_text(encoding="utf-8"))
_GENERATED_THEME_CONTRACT: dict[str, Any] = _THEME_PRESETS.get("generatedThemeContract") or {}
_CONTRACT_HEX_RE = re.compile(str(_GENERATED_THEME_CONTRACT.get("hexPattern") or r"^#[0-9a-fA-F]{6}$"))


def is_valid_generated_theme(v: Any) -> bool:
    """生成主题合格判定（与前端 isValidGeneratedTheme 同一契约、同一份 JSON）。

    合格才拿来配卡片色；不合格这里不用、前端也必然回落 FALLBACK_SEED 派生
    的中性色板——两端判定物理同源，不存在"后端用了前端弃用"的错配窗口。

    fullmatch 不是 match：Python 的 $ 会豁免尾随换行（"#123456\\n" 能过），
    JS 的 $ 不豁免——用 match 就给"两端同源"留了一道换行错配窗口
    （Python 判合格拿去配卡片色、前端整套弃用回落预设）。
    """
    if not isinstance(v, dict):
        return False
    seed = v.get("seed")
    return isinstance(seed, str) and bool(_CONTRACT_HEX_RE.fullmatch(seed))

_DEVICE_CONTAINER_HINTS: dict[str, str] = {
    "phone": (
        "这张卡片会被塞进手机端内容区：上方约 48px 标题栏、下方有底部 Tab "
        "导航，两者都已经画好，不用你画；内容区窄（几百像素宽），必须单列纵向"
        "排布，字号/图标/间距都要比桌面版收紧一档，避免横向并排的多列布局。"
    ),
    "desktop": (
        "这张卡片会被塞进桌面端内容区：左侧约 208px 深色侧边栏、上方约 56px "
        "顶栏，两者都已经画好，不用你画；内容区较宽，可以用横向排布/多列。"
    ),
    "tablet": (
        "这张卡片会被塞进平板端内容区（比桌面窄一些的侧边栏+顶栏已经画好，"
        "不用你画）；内容区中等宽度，横向排布元素不宜过多。"
    ),
}
_DEFAULT_DEVICE = "desktop"

# 占位文案的写法（2026-07-30，抄自一份第三方技能包的产出）。
#
# 我们原本统一写「示例XX」——不写真实数据这条是对的，但**把所有字段类型
# 压成了同一个词**，出图里每一格都是"示例XX"，看着就不像真界面。对照那份
# 技能包生成的 CRM 草样：日期写 20XX-XX-XX、电话写 138-••••-••••、邮箱写
# name@xxxx.com、公司写「示例科技有限公司」——同样没有一个真数据，但**保留
# 了每类字段的形状**，所以一眼就能看出哪格是日期、哪格是金额。
#
# 这对参照图是实打实的：设计 LLM 看图学的是"这一格该放什么形状的内容"，
# 形状被抹平，它就学不到列宽/对齐/字号该怎么排。
_PLACEHOLDER_STYLE_NOTE = (
    "占位文案要**保留每类字段本来的形状**，不要所有格子都写同一个词："
    "日期写成 20XX-XX-XX、时间写成 20XX-XX-XX 10:30、手机号写成 138-••••-••••、"
    "邮箱写成 name@xxxx.com、金额写成 ¥ ××,×××、百分比写成 ××.×%、"
    # 人名给的是**构词法**不是具体名字：写死「张销售」会把一个销售岗的称呼
    # 带进健身房/餐饮这些完全不相干的应用里（真机撞到过：健身房会员列表里
    # 出现「会员：张销售」）。让它按当前业务语境自己选。
    "人名写成「张先生」「李女士」这类示例名——**按这个应用自己的业务语境选**，"
    "不要带上跟本业务无关的职业称呼；机构写成「示例科技有限公司」这类；"
    "状态/分类这种有固定选项的，直接用下面数据字段里给出的真实枚举标签。"
    # 2026-07-30 补：原来这份清单**漏了纯数值那一类**（计数/量/图表数据点），
    # 模型学会了日期和电话怎么占位，对数字却没范例可循，就回退到编——真机
    # 撞到过：KPI 卡写 2,385 人 / ¥128,650，折线图 312/356/410，环形图各段
    # 加起来还正好等于 KPI 的总数，编了一整套自洽的假数据。
    #
    # 这个漏洞在完整版 prompt 里被末尾那段信息层级清单兜住了（那里又复述了
    # 一遍"照上面那套占位法写"），所以一直没暴露。补在这里才是治本——省得
    # 这份清单的正确性依赖另一段话去复述。
    "数值也一样要按形状占位、不许编：计数写成 ×,××× 或 ××（带单位就写成"
    "「×,××× 人」「×× 节」），带小数的量写成 ×××.×，金额和百分比照上面的写法。"
    "**图表里的数据点、坐标轴刻度、环形图各段占比同样适用**——不要编一组"
    "「看起来很合理、加起来还能对上」的真数字，那比明显的假数据更容易被当真。"
    "**一个真实数据都不许出现**，但要让人一眼看出这一格装的是什么类型的内容；"
)

# KPI 卡的视觉处理（2026-07-30，人工核对第三方技能包产出后放开）。
#
# 这条推翻了 ba67e59 定的"图表之外保持单一色系"。当初锁单色是为了修"颜色发花"
# ——但那次发花的真正原因是**四张卡是高饱和实心圆、没有设计语言托着**，多色
# 只是表象。对照那份技能包的产出：它每张卡也是一个色相，却配了柔和渐变装饰 +
# 圆角方形图标底座，多色被设计语言兜住了，不显乱。
#
# 所以放开的是"**多色 + 装饰**"这一对，不是单独把多色放开——只放多色不加装饰，
# 会原样退回发花那一版。改这里的人请把两半当一个整体看。
_CARD_VISUAL_NOTE = (
    "KPI 指标卡要有设计感，不要画成白底纯文字的方块："
    "每张卡左上角一个**圆角方形图标底座**（约 44~52px，用浅色到主色的柔和渐变作底，"
    "图标本身用白色或更深一档的同色系），**四张卡各用一个不同色相**——从上面那组"
    "图表分类色里挑，同一张卡的图标底座、装饰和强调数字共用它自己那个色相；"
    "卡片下半部或右下角再加一块**柔和的渐变波浪/弧形装饰**（低饱和、半透明，"
    "压在卡片底色上当氛围，绝不能盖住文字）；卡片整体仍是白底、细边框、小圆角。"
    # 2026-07-30 二次放开：原本这里还锁着"这几个色相只用在 KPI 卡这一层，
    # 正文/表格/列表照旧墨色、不要整屏铺彩色"。人工核对后连这条也撤了——
    # 前几轮的教训是"发花"来自没有设计语言托着的高饱和实心块，不是来自色彩
    # 用得多。现在装饰语言已经立住了，就没必要再把彩色圈在一层里。
    #
    # 只留两条**功能性**底线（不是审美偏好，别当成克制指令删掉）：
    #   ① 色相仍从上面那套主题色板取——B 版实测丢掉这条之后，生成的主题种子
    #      完全白给，整屏配色跟应用身份对不上。
    #   ② 正文/数值这类要读的文字保证对比度——彩色底就上白字，浅底就上深字。
    "彩色可以放开用，不用刻意克制：列表项图标、动态流头像/圆点、表格状态列、"
    "分区标题的小色条、卡片浅色底纹这些地方都可以上色，让整屏有色彩节奏；"
    "但**色相一律从上面那套主题色板里取**（主色 + 图表分类色），不要另配一套"
    "糖果色，否则整屏配色会跟这个应用的身份对不上。"
    "唯一的硬底线是可读性：正文、数值、表格文字必须跟它的底色拉开对比"
    "（彩色底配白字，浅底配深字），不要出现看不清的低对比文字。"
)

# 生图尺寸：**当前这家端点（api.xiaoleai.team）逐像素认 size 参数**——传
# 什么回什么，不降档、不改比例。所以下面这些值就是真实画布，写 prompt 时可以
# 直接照着算密度。
#
# 实测（2026-07-31，探针带形状线索，逐个真发一轮）：
#   1280x720  → 实收 1280x720  (0.92MP, 16:9)  69s
#   720x1280  → 实收 720x1280  (0.92MP, 9:16)  48s
#   1920x1080 → HTTP 400（不在这家的白名单里，秒回）
# 中文标签在 0.92MP 上依旧锐利，没有糊字——密度预算够用。
#
# ⚠️ **这是端点相关的行为，换端点必须整份重测。** 同一份代码在上一家
# （hello.vangularcode.asia）上表现完全相反：那家 size 参数**完全不起作用**，
# 十个尺寸/形态组合（1024x1024 一路到 3840x2160，以及 image_size 1K/2K/4K +
# aspect_ratio）**全部**回 1672x941，总像素锁死 1.57MP，长宽比只由提示词内容
# 决定（横版线索→1672x941，中性→1254x1254，9:16 线索→864x1821）。
#
# 被这件事绊过三次，记在这里免得下一个人再踩：
#   ① 拿上一个端点测出的"可用尺寸白名单"当常量用，换 URL 后整份作废；
#   ② 拿**没有形状线索**的中性提示词做探针（"纯浅灰背景，正中一个大号数字
#      1"），拿到一堆方图就误判成"这家给不了竖图"——错的是探针不是端点；
#   ③ 把 ② 得出的"形状只能靠提示词"当成普适结论，而它只对那一家成立。
#
# 提示词里的比例措辞仍然保留、并且**要跟这里的尺寸对齐**：认尺寸的端点上它
# 是冗余的双保险，不认尺寸的端点上它是唯一的形状来源，两边都不吃亏
# （见 _build_reference_image_prompt 的 device_note 与
# identity_theme_gen._SHELL_SHAPE_NOTE）。
_DEVICE_IMAGE_SIZE: dict[str, str] = {
    "phone": "720x1280",
    "desktop": "1280x720",
    "tablet": "1280x720",
}
# 手机档参照图的**实际**画布（explicit 好过 implicit：调用方要写 prompt
# 就得知道真实形状，不能从上面那个字面值猜）。这家端点不降档，所以两者相同；
# 留着这个名字是因为换回降档端点时它还会重新分叉。
_PHONE_IMAGE_ACTUAL_SIZE = "720x1280"


# 参照板的尺寸：跟 _DEVICE_IMAGE_SIZE 同一套，按档位取。
#
# 曾经这里是一个跟设备无关的常量（"1792x1024"），因为上一家端点无论传什么都
# 回同一个横版尺寸，手机档只能靠 prompt 里那句"9:16 竖屏"把形状掰回来。换到
# 认尺寸的端点之后没有理由再这么绕——手机档直接传 720x1280，形状由参数保证，
# prompt 里那句竖屏措辞降级成双保险。
#
# 密度预算跟画布尺寸是一组：元素个数不同步收敛的话每个元素分到的像素会少到
# 中文标签糊成一片。所以下面 prompt 里图表最多 2 张、动态列表最多 5 行那些
# 上限不能单独放开——真正让参照失效的不是总像素不够，是每个元素分到的像素
# 不够。0.92MP 这一档实测中文仍然锐利，当前上限有余量。
#
# ── 2026-08-03：参照板单独提到 2560x1440，**不跟区块级参照图共用一张表** ──
#
# 探针实测（api.gpt.ge / gpt-image-2，同一句提示词逐档跑）：
#   1280x720   51.2s   773KB     ← 此前用的
#   1920x1088  49.5s  1482KB
#   2048x1152  52.1s  1572KB
#   2560x1440  50.6s  2136KB     ← 现在用的
#   1920x1080  ✗ 400 "both edges must be multiples of 16"（1080÷16=67.5）
#
# 两条结论：
#   ① **两边都必须是 16 的倍数**，所以拿不到 1920x1080，2560x1440 反而合法
#      （2560÷16=160，1440÷16=90）。这是端点的硬校验，2.4 秒就打回来，
#      连队列都没进——跟"生成慢"是两回事，别混。
#   ② **耗时不随像素涨**：四倍像素，四档全落在 49~52s 的噪声里，最大那张甚至
#      比最小那张快。这家按次排队、不按像素算力。所以这次提分辨率的时间成本
#      是 0，换来每个元素 4 倍像素——上面那句"每个元素分到的像素不够"正是
#      灰条/掉坐标轴刻度那批老 bug 的成因。
#
# 为什么不跟 _DEVICE_IMAGE_SIZE 一起提：那张表还供着**区块级参照图**
# （_image_size_for_device），而区块级那张是**喂进视觉 LLM 当输入**的，
# 图越大输入 token 越多、越慢越贵。参照板不进模型输入（它是给设计 LLM 看的
# 附图，同样进输入……但只进一次，且它决定整页版式，值这个钱）——区块级那张
# 每个区块都要生一次，成本乘以区块数。两者的账不一样，所以拆成两张表。
_SHEET_DEVICE_IMAGE_SIZE: dict[str, str] = {
    "phone": "1440x2560",
    "desktop": "2560x1440",
    "tablet": "2560x1440",
}
_SHEET_IMAGE_SIZE = _SHEET_DEVICE_IMAGE_SIZE["desktop"]


def _image_size_for_device(device: str) -> str:
    return _DEVICE_IMAGE_SIZE.get(device) or _DEVICE_IMAGE_SIZE[_DEFAULT_DEVICE]


def _sheet_image_size_for_device(device: str) -> str:
    """参照板按档位取画布。

    device 没明说时走桌面档——跟 _build_overview_sheet_prompt 的 else 分支
    一致：那一支要在一张横版画布上并排画桌面和手机两块，本身就是横版。

    2026-08-03 起读 _SHEET_DEVICE_IMAGE_SIZE（2560x1440 档），不再跟区块级
    参照图共用 _DEVICE_IMAGE_SIZE——两者的成本账不一样，理由见那张表上方。
    """
    return _SHEET_DEVICE_IMAGE_SIZE.get(device) or _SHEET_IMAGE_SIZE


def _theme_palette(
    theme_id: str,
    generated_theme: Optional[dict[str, Any]] = None,
    chart_colors: Optional[list[str]] = None,
    chart_variant_key: str = "",
) -> dict[str, Any]:
    """**外壳一个颜色**（2026-08-03，用户裁决）：色板由**当轮种子色**派生。

    ⚠️ 2026-08-24：这句原文是"永远是 BRAND_SEED 派生的色板"，现在不再"永远"——
    作曲家上有了设计系统选择器，种子色按轮取（active_brand_seed）。08-03 那条裁决
    没被推翻：它砍的是「LLM 为每个应用自动选色」（要先花 74s 生参照图再取色），
    不是「用户显式挑一套」。仍然是一轮一套、全局统一，只是这一套由用户定。

    ⚠️ 2026-08-04 起**图表色是例外**：那一组改成从这个应用自己的参照图上读
    （chart_colors，来源见 services/sheet_palette）。外壳统一、图表跟着应用走
    ——「全站一个颜色」那条裁决管的是外壳。

    这个色板只有一个用途：告诉设计 LLM「运行时的侧边栏/顶栏/按钮已经按这套
    渲染了」，好让它生成的版式配色跟真实外壳对得上。所以它必须与前端实际
    渲染的那套同源——两者同读 identity_theme_presets.json 的 brandSeed。

    theme_id / generated_theme 都不再参与颜色决定，签名保持不变：调用点有十几处，
    且**存量应用的库里仍然存着 generatedTheme 字段**。保留参数 = 老数据不需要
    迁移脚本，读进来直接被忽略。

    · theme_id：appIdentity.theme 那 8 选 1 的分类字段，2026-07-30 起就不是
      颜色来源了（仍然是 gate 校验的合法分类值）。
    · generated_theme：2026-08-03 起不再生成。为它生的那张参照图从不展示给
      任何人，用一次生图换一个色值，已整段移除。

    derive_prompt_palette 返回的色板是 OKLCh 近似（不是前端渲染用的权威
    HCT 派生），只用于这里的 prompt 拼接和下面 palette_guard 的色相参照——
    见 identity_palette_hint.py 顶部说明，为什么这里不需要跟前端数值一致。"""
    del theme_id, generated_theme
    # ⚠ 按轮取，不用模块常量：用户可能在作曲家里选了别的设计系统。
    #   写成 BRAND_SEED 的话选择器会变成纯装饰——UI 动了、生成的颜色没动。
    _seed, _label = active_brand_seed()
    palette = derive_prompt_palette(_seed, id_="brand", label=_label)
    # 2026-08-04：图表色改成从这个应用的参照图上读（services/sheet_palette）。
    # 传进来了就覆盖——**这一步是为了消掉"提示词说的"和"画出来的"分叉**：
    # 前端真实渲染已经优先用 chartColors 了（identity-palette.chartsFor），
    # 这里不跟着换的话，设计 LLM 会照着一组不会出现的颜色配色，
    # palette_guard 的色相参照也对着过时的色相判。
    #
    # 没取到色就退回账本色序，**用跟前端同一个键**（产品名），两边才挑到同一套。
    # 此前这里够不着应用名，只能用旧的色相旋转算法，于是兜底路径上"提示词说的"
    # 和"画出来的"也是分叉的——那是 0f9172a 留下的已知不一致，它的注释写着
    # "修的时候一次穿到底"，就是这里。
    #
    # 两个都没有时才落回旧算法：那是老调用点的行为，不因这次改动悄悄变色。
    usable = usable_chart_palette(chart_colors or [])
    if usable:
        palette = {**palette, "charts": usable}
    elif chart_variant_key:
        palette = derive_prompt_palette(
            active_brand_seed()[0],
            id_="brand",
            label=active_brand_seed()[1],
            chart_variant_key=chart_variant_key,
        )
    return palette


def _theme_prompt_fragment(
    theme_id: str,
    generated_theme: Optional[dict[str, Any]] = None,
    chart_colors: Optional[list[str]] = None,
    chart_variant_key: str = "",
) -> str:
    hint = _theme_palette(theme_id, generated_theme, chart_colors, chart_variant_key)
    charts = ", ".join(hint["charts"])
    return (
        f"这个应用当前用的身份主题是「{hint['label']}」，下面这套色板已经用在真实"
        f"渲染出来的侧边栏/顶栏/按钮上了，你的配色**只能从这套色板里取**（含深浅/"
        f"透明度变体），不能自己另外发明色相：\n"
        f"- 主色：{hint['primary']}（悬停态 {hint['primaryHover']}，浅端 {hint['gradTo']}）\n"
        f"- 内容区底色：{hint['contentBg']}\n"
        f"- 强调浅底/强调字：{hint['accentBg']} / {hint['accentFg']}\n"
        # 「这 N 个」按实际条数写。此前写死"这 3 个"、后面却列了 6 个色
        # ——参照图取色之后条数还会变（4~6），写死的数字只会更不准。
        f"- 多类别/多序列区分色（画多阶段流程、多类别图例这种需要好几个不同色块"
        f"时优先从这 {len(hint['charts'])} 个里选，而不是自己配一套糖果色）：{charts}\n"
        "同一个组件里如果需要不止一种颜色，从以上色值出发做深浅/透明度调整，"
        "不要引入跟这套色板色相不搭的新颜色（比如主题是暖橙系就不要通篇上蓝紫）。"
    )


def _device_prompt_fragment(device: str) -> str:
    return _DEVICE_CONTAINER_HINTS.get(device) or _DEVICE_CONTAINER_HINTS[_DEFAULT_DEVICE]


def _datamodel_summary_lines(datamodel: dict[str, Any]) -> str:
    """把数据模型压成生图 prompt 用得上的自然语言摘要——不是甩一整段原始
    JSON 进去（生图模型不是在做结构化解析，喂太长的原始 JSON 对画面构图没
    帮助），只挑「画面里该出现几类/叫什么名字」这种直接影响构图的信息：
    实体名 + 字段名/类型，enum 字段展开真实选项（比如状态有几种、分别叫
    什么），这样生成的图不会凭空编一个"看起来对"但跟真实字段对不上的阶段数。

    不设实体数/选项数上限——密度应该由真实数据模型本身有多厚来决定，不是
    开发者手工定一个"最多给你看 6 个实体"的天花板；有多少真实字段/关系，
    就让生图/结构生成看见多少，让画面的丰富程度自己长出来，而不是靠 prompt
    里写死"多来点分组/多来点标签"这种指令去撑密度。
    """
    lines: list[str] = []
    for e in datamodel.get("entities") or []:
        ename = e.get("name") or e.get("id") or ""
        bits: list[str] = []
        for f in e.get("fields") or []:
            fname = f.get("name") or f.get("id") or ""
            ftype = f.get("type") or ""
            opts = f.get("options")
            if ftype == "enum" and isinstance(opts, list) and opts:
                labels = "/".join(str(o.get("label") or o.get("id") or "") for o in opts)
                bits.append(f"{fname}（{len(opts)}类：{labels}）")
            else:
                bits.append(f"{fname}[{ftype}]")
        if bits:
            lines.append(f"{ename}：{'、'.join(bits)}")
    return "\n".join(lines)


def _enumerate_chart_candidates(datamodel: dict[str, Any]) -> list[dict[str, Any]]:
    """按 Metabase X-Ray 的思路，机械枚举数据模型里所有"数学上合法"的图表
    组合——每个 enum 字段的分布计数、每个 number 字段按 enum 字段分组求和——
    而不是完全指望 LLM 自己去猜哪些字段组合能撑起一张图。这些候选本身已经
    保证 entityRef/dimensionFieldId/metricFieldId 都是真实存在的字段，LLM
    从这批候选里选/组合，可用真实候选一目了然，用不用、用几个，仍然是 LLM
    自己的设计判断，这里只负责穷举"有哪些合法选项"。

    不设候选数量上限——候选多少取决于数据模型本身有多少 enum/number 字段，
    跟 _datamodel_summary_lines 的"不设实体数上限"是同一个原则：密度由真实
    数据模型的厚度决定，不是开发者手工定一个候选数天花板。
    """
    candidates: list[dict[str, Any]] = []
    for e in datamodel.get("entities") or []:
        eid = e.get("id")
        if not eid:
            continue
        ename = e.get("name") or eid
        fields = e.get("fields") or []
        enum_fields = [f for f in fields if f.get("type") == "enum" and f.get("id")]
        number_fields = [f for f in fields if f.get("type") == "number" and f.get("id")]
        for ef in enum_fields:
            efname = ef.get("name") or ef.get("id")
            candidates.append(
                {
                    "entityRef": eid,
                    "dimensionFieldId": ef["id"],
                    "metric": "count",
                    "metricFieldId": None,
                    "metricLabel": f"{ename}数量",
                    "note": f"{ename}按「{efname}」分布计数",
                }
            )
            for nf in number_fields:
                nfname = nf.get("name") or nf.get("id")
                candidates.append(
                    {
                        "entityRef": eid,
                        "dimensionFieldId": ef["id"],
                        "metric": "sum",
                        "metricFieldId": nf["id"],
                        "metricLabel": f"{nfname}总和",
                        "note": f"{ename}按「{efname}」分组的「{nfname}」总和",
                    }
                )
    return candidates


def _chart_candidates_prompt_fragment(datamodel: dict[str, Any]) -> str:
    candidates = _enumerate_chart_candidates(datamodel)
    if not candidates:
        return ""
    lines = []
    for c in candidates:
        metric_bit = (
            'metric="count"'
            if c["metric"] == "count"
            else f'metric="sum", metricFieldId="{c["metricFieldId"]}"'
        )
        lines.append(
            f'- {c["note"]}：entityRef="{c["entityRef"]}", '
            f'dimensionFieldId="{c["dimensionFieldId"]}", {metric_bit}, '
            f'metricLabel 建议"{c["metricLabel"]}"'
        )
    return (
        "\n下面是这个数据模型里机械枚举出来的所有合法图表候选（每一条的字段组合"
        "都已验证过真实存在，可以直接拿来填 chart 字段，type 自己按设计需要挑 "
        "bar/line/pie/donut）——不要求全部用上，但可以更多地利用这些真实候选去"
        "撑画面密度，而不是只挑一两个：\n" + "\n".join(lines) + "\n"
    )


def _entity_index(datamodel: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    entities = {e.get("id"): e for e in datamodel.get("entities", []) if e.get("id")}
    field_types: dict[str, str] = {}
    for e in datamodel.get("entities", []):
        eid = e.get("id")
        if not eid:
            continue
        for f in e.get("fields", []):
            fid = f.get("id")
            if fid:
                field_types[f"{eid}.{fid}"] = f.get("type")
    return entities, field_types


def build_freeform_models(datamodel: dict[str, Any]) -> type[BaseModel]:
    """按当轮真实数据模型闭包构建 Pydantic 模型——DataRef.entityRef/aggregate
    的校验需要知道"真实存在哪些实体/字段"，每轮数据模型不同，模型也要重建。
    """
    entities, field_types = _entity_index(datamodel)

    def _entity_field_ids(entity_id: str) -> list[str]:
        """某实体的真实字段 id 列表——只用来把校验错误说清楚。

        报错里带上"这个实体到底有哪些字段"，reask 一次就能改对；只说"字段
        不存在"的话模型只能瞎猜，白烧一轮重试。"""
        prefix = f"{entity_id}."
        return [k[len(prefix):] for k in field_types if k.startswith(prefix)]

    class DataRef(BaseModel):
        """一个数字的真实来源。

        2026-07-29 加了 trendFieldRef/trendGrain：参考图上的 KPI 卡都是
        「大数字 + 较昨日↑12% + 卡底一条迷你走势线」三层，我们只出得了第一层，
        对比下来就是"少了两层信息"。形状对标 ant-design/pro-components 的
        StatisticCard（Statistic 的 trend: up|down + description 文案，
        StatisticCard 的 chart 槽位 + chartPlacement）——那是这类卡片的成熟
        长相，不自己发明一套。

        **一个字段同时驱动两层**：给了 trendFieldRef 就既算环比、也出走势线。
        分成两个声明的话模型要多记一套规则，而这两层本来就靠同一份时间分桶，
        没有"只要其一"的实际场景。
        """

        entityRef: str
        aggregate: Optional[str] = None
        #: 时间字段（同实体下的 date 字段）。给了就出环比 + 迷你走势线。
        trendFieldRef: Optional[str] = None
        #: 分桶粒度，默认按天。
        trendGrain: Optional[str] = None

        @field_validator("trendGrain")
        @classmethod
        def check_grain(cls, v: Optional[str]) -> Optional[str]:
            if v is not None and v not in ("day", "week", "month"):
                raise ValueError("trendGrain must be one of: day, week, month")
            return v

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"entityRef '{v}' does not exist. Real entities are: {list(entities.keys())}"
                )
            return v

        @model_validator(mode="after")
        def check_aggregate(self) -> "DataRef":
            if self.aggregate and self.aggregate != "count":
                prefix, sep, field_id = self.aggregate.partition(":")
                if not sep or prefix not in ("sum", "avg"):
                    raise ValueError(
                        "aggregate must be 'count', 'sum:<fieldId>', or 'avg:<fieldId>'"
                    )
                qualified = f"{self.entityRef}.{field_id}"
                if qualified not in field_types:
                    raise ValueError(
                        f"field '{field_id}' does not exist on entity '{self.entityRef}'"
                    )
                if field_types[qualified] != "number":
                    raise ValueError(
                        f"field '{field_id}' on '{self.entityRef}' is type "
                        f"'{field_types[qualified]}', aggregate requires a number field"
                    )
            if self.trendFieldRef:
                qualified_trend = f"{self.entityRef}.{self.trendFieldRef}"
                if qualified_trend not in field_types:
                    raise ValueError(
                        f"dataRef.trendFieldRef '{self.trendFieldRef}' does not exist on "
                        f"entity '{self.entityRef}'"
                    )
                if field_types[qualified_trend] != "date":
                    raise ValueError(
                        f"dataRef.trendFieldRef '{self.trendFieldRef}' on '{self.entityRef}' "
                        f"is type '{field_types[qualified_trend]}', 环比与走势线需要 date 字段"
                    )
            elif self.trendGrain:
                raise ValueError("dataRef.trendGrain 需要同时给 trendFieldRef")
            return self

    class RowsRef(BaseModel):
        """逐行真实数据的来源——「取这张表、按某字段排序、前 N 行」。

        为什么要有它（2026-08-03）：dataRef 只能表达聚合值（count/sum/avg），
        没有"枚举第 N 行"的能力。于是设计模型只要想画排行榜/动态流/最近记录
        这类**一行一行**的内容，就只能画出表头加一片空白——这正是当初引入
        blockRef（从固定积木清单里挑一个摆进来）的唯一原因。

        但固定积木是死的：长什么样由组件写死，设计模型改不动，参照图上画的
        版式落不了地。用户裁决「首页只由 LLM 动态设计，图上有什么就设计什么」
        之后，正确的解法不是二选一，而是**把逐行能力补给设计模型自己**：
        版式它自由画，数据我们负责喂真的。补上之后 blockRef 整条通道就没有
        存在理由了，已一并删除。

        ## 用法：这个节点是列表容器，它的 children 是**一行**的模板

            {"tag": "div", "rowsRef": {...}, "children": [ ...一行的样子... ]}

        渲染端把 children 这棵子树按取到的行数重复渲染，每行把子树里带
        fieldRef 的节点替换成那一行的真实字段值。模板只写一次，展开发生在
        渲染期——所以设计树本身不会因为行数多而变大，节点上限不受影响。

        ## 安全边界（逐行数据比聚合数字敏感得多，这里是主要防线）

        · fieldRefs 是**显式白名单**：模板里的 fieldRef 只能取这里声明过的
          字段。不声明就读不到——避免设计模型顺手把整张表的字段拉出来。
        · limit 夹在 1..ROWS_REF_MAX_LIMIT 之间，防止一个 rowsRef 把整表拉平
          撑爆版面（也撑爆渲染预算）。
        · entityRef / fieldRefs / sortByRef 全部要求在真实数据模型里存在，
          与 dataRef 同一套判定，不另起一套。
        """

        entityRef: str
        #: 模板里允许读取的字段白名单。至少一个，且必须真实存在。
        fieldRefs: list[str] = Field(default_factory=list)
        #: 排序字段（可选，不给就按数据源自然顺序）。
        sortByRef: Optional[str] = None
        #: asc | desc，默认 desc（榜单/动态流绝大多数是"最大/最新在前"）。
        order: Optional[str] = None
        #: 取前几行。
        limit: int = ROWS_REF_DEFAULT_LIMIT

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"rowsRef.entityRef '{v}' does not exist. "
                    f"Real entities are: {list(entities.keys())}"
                )
            return v

        @field_validator("limit")
        @classmethod
        def check_limit(cls, v: int) -> int:
            if v < 1 or v > ROWS_REF_MAX_LIMIT:
                raise ValueError(
                    f"rowsRef.limit 必须在 1..{ROWS_REF_MAX_LIMIT} 之间（给的是 {v}）"
                )
            return v

        @field_validator("order")
        @classmethod
        def check_order(cls, v: Optional[str]) -> Optional[str]:
            if v is not None and v not in ("asc", "desc"):
                raise ValueError("rowsRef.order must be 'asc' or 'desc'")
            return v

        @model_validator(mode="after")
        def check_fields(self) -> "RowsRef":
            if not self.fieldRefs:
                raise ValueError(
                    "rowsRef.fieldRefs 不能为空——必须先声明这一行要显示哪些字段，"
                    "模板里的 fieldRef 只能取声明过的字段"
                )
            for fid in self.fieldRefs:
                if f"{self.entityRef}.{fid}" not in field_types:
                    raise ValueError(
                        f"rowsRef.fieldRefs 里的 '{fid}' 在实体 '{self.entityRef}' 上"
                        f"不存在。该实体的真实字段：{_entity_field_ids(self.entityRef)}"
                    )
            if self.sortByRef and f"{self.entityRef}.{self.sortByRef}" not in field_types:
                raise ValueError(
                    f"rowsRef.sortByRef '{self.sortByRef}' 在实体 "
                    f"'{self.entityRef}' 上不存在。"
                    f"该实体的真实字段：{_entity_field_ids(self.entityRef)}"
                )
            return self

    class ChartSpec(BaseModel):
        """真图表声明——不是画出来的近似值，是运行时拿真实行数据现算的
        ECharts option（复用 client 侧 build-echarts-option.ts 那套已经在用
        的确定性配色/分组逻辑）。数据会随真实数据变化自动更新，不是生成时
        定死的静态快照。"""

        type: str
        entityRef: str
        dimensionFieldId: str
        metric: str
        metricFieldId: Optional[str] = None
        metricLabel: str

        @field_validator("type")
        @classmethod
        def check_type(cls, v: str) -> str:
            if v not in ("bar", "line", "pie", "donut"):
                raise ValueError("chart.type must be one of: bar, line, pie, donut")
            return v

        @field_validator("metric")
        @classmethod
        def check_metric(cls, v: str) -> str:
            if v not in ("count", "sum"):
                raise ValueError("chart.metric must be 'count' or 'sum'")
            return v

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"chart.entityRef '{v}' does not exist. Real entities are: {list(entities.keys())}"
                )
            return v

        @model_validator(mode="after")
        def check_fields(self) -> "ChartSpec":
            qualified_dim = f"{self.entityRef}.{self.dimensionFieldId}"
            if qualified_dim not in field_types:
                raise ValueError(
                    f"chart.dimensionFieldId '{self.dimensionFieldId}' does not exist on entity '{self.entityRef}'"
                )
            if self.metric == "sum":
                if not self.metricFieldId:
                    raise ValueError("chart.metric='sum' requires metricFieldId")
                qualified_metric = f"{self.entityRef}.{self.metricFieldId}"
                if qualified_metric not in field_types:
                    raise ValueError(
                        f"chart.metricFieldId '{self.metricFieldId}' does not exist on entity '{self.entityRef}'"
                    )
                if field_types[qualified_metric] != "number":
                    raise ValueError(
                        f"chart.metricFieldId '{self.metricFieldId}' on '{self.entityRef}' is type "
                        f"'{field_types[qualified_metric]}', sum requires a number field"
                    )
            return self

    class ActionRef(BaseModel):
        """这个节点点了之后干什么（2026-08-13 新增）。

        ## 为什么补这一维

        节点契约原来只有 tag/style/text/iconRef/imageRef/dataRef/chart/
        rowsRef/fieldRef/children ——**没有任何"点了干什么"**。于是设计模型
        画得出「编辑」按钮，却没地方写它该触发什么，渲染出来是个会发光的 div。

        而管道一直是通的：`ExperienceBlockRendererProps` 里有
        `onAction(actionId, eventData)`，所有渲染器都收得到，组件区块靠它干活
        （DataTable 行内那两个链接就是）。自由树那边调用次数是 0——不是线断了，
        是节点上没有可以接线的地方。

        ## 抄了什么、没抄什么

        抄 nocobase 的 Action：**容器由动作自己决定（openMode: drawer/modal/
        page），不由触发它的那个组件决定**。仓库里 pagePipes 的注释已经引过
        这一条，这里保持同一套分层。

        **没抄它的内嵌式**：nocobase 把"要打开的东西"作为按钮的子 schema
        （`properties.drawer1`）。那样自包含、不用解析引用，但同一个表单在多处
        打开就要写多遍，且 schema 会很深。我们这边模型本来就是引用式的
        （entityRef/fieldRef 全是引用），而且有结构闸专门查悬空引用——
        用引用更贴本仓的既有纪律。

        ## 为什么只有这三种

        `navigate`（跳到某一页）**这一版没有**：目标是 page id，而
        `build_freeform_models` 只拿得到 datamodel、结构闸也没走进自由树——
        **验不了的引用不该让模型写**，否则就是又开一个可以瞎填的字段。
        等 page id 能传进来再补。

        这三种全部落在 datamodel 上，验得死；而且运行时那三个入口
        （pagePipes 的 openCreate / openRecordById / openEdit）**全是现成的**，
        一个都不用新加。

        ## 标签白名单一个字不动

        白名单里**没有 `button`**（只有 div/span/p/strong/em/small/h1-3/ul/li）
        ——这本身就印证了"自由树从来没打算能点"。但不加：加了之后模型能画出
        不带 actionRef 的 `<button>`，那就是又造一批死按钮，回到原点。

        改成**带 actionRef 的节点自动变可交互**（渲染层加 role="button"、
        tabIndex、键盘事件）。好处是顺带更有表达力——整张卡片可点，不只是
        卡片角落那个按钮；而且白名单是 XSS 防线，能不动就不动。

        ## 写入仍然归组件

        动作只负责"打开哪个容器"，真正的增删改查由组件完成。理由是实测的：
        让模型自己写 JS 实现增删改查，六项功能通过 12/18，三份里只有 1 份全过，
        而且失败是静默的（能点、不报错、就是没反应）。
        """

        #: 词表**直接查 html_bindings.ACTION_KINDS**（2026-08-14 晚收拢）。
        #: 之前这里手抄了一份 Literal，靠 AST 测试跟那边对齐——四份词表
        #: 两份是抄写。现在 Python 侧只剩 html_bindings 那一份，这里查表校验，
        #: 加词只改一处。转移三种在自由树上暂时只是**词表统一**：老链路的
        #: 提示词不教模型用它们（审批在 Workflow 试运行面做）。
        kind: str
        entityRef: str

        @field_validator("kind")
        @classmethod
        def check_kind(cls, v: str) -> str:
            from services.html_bindings import ACTION_KINDS

            if v not in ACTION_KINDS:
                raise ValueError(
                    f"actionRef.kind '{v}' 不在动作词表里。"
                    f"只有这些词有后果：{list(ACTION_KINDS)}"
                )
            return v

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"actionRef.entityRef '{v}' does not exist. "
                    f"Real entities are: {list(entities.keys())}"
                )
            return v

    class FreeformNode(BaseModel):
        tag: str
        style: dict[str, str] = Field(default_factory=dict)
        text: Optional[str] = None
        iconRef: Optional[str] = None
        imageRef: Optional[Literal["landing-hero"]] = None
        imageAlt: Optional[str] = None
        dataRef: Optional[DataRef] = None
        chart: Optional[ChartSpec] = None
        #: 逐行列表容器：children 是一行的模板，按取到的行数重复渲染。
        rowsRef: Optional[RowsRef] = None
        #: 取当前行的某个字段值（只在 rowsRef 子树内有意义，且必须在该
        #: rowsRef 的 fieldRefs 白名单里——两条都由 FreeformDesign 树级校验保证）。
        fieldRef: Optional[str] = None
        #: 点了干什么。openRecord/editRecord 要有"当前行"，所以必须落在
        #: rowsRef 子树内且实体对得上——跟 fieldRef 同一条作用域规则，
        #: 由 FreeformDesign 树级校验保证。
        actionRef: Optional[ActionRef] = None
        children: list["FreeformNode"] = Field(default_factory=list)

        @field_validator("tag")
        @classmethod
        def check_tag(cls, v: str) -> str:
            if v not in FREEFORM_ALLOWED_TAGS:
                raise ValueError(
                    f"tag '{v}' is not allowed. Allowed tags: {list(FREEFORM_ALLOWED_TAGS)}"
                )
            return v

        @field_validator("style", mode="before")
        @classmethod
        def coerce_style_numbers(cls, v: Any) -> Any:
            """数字样式值补单位——照 React 的做法，不比 React 还严。

            2026-07-28 真跑逮到：模型写 `{"gap": 24, "padding": 16}`（数字），
            而 style 的类型标注是 dict[str, str]，Pydantic 在下面那个白名单
            校验之前就整批拒了——一次 89 条错误、三次重试全耗在同一类问题上，
            最后整个 freeformOverview 生成失败、首页回落固定骨架。

            React 本身是接受数字的：`style={{gap: 24}}` 渲染成 `gap: 24px`，
            只有一批"无单位属性"（flex/fontWeight/opacity/lineHeight/zIndex…）
            原样输出（见 React 源码 shared/CSSProperty.js 的 isUnitlessNumber）。
            这里照抄那份名单——渲染层最终就是交给 React，判定标准跟它一致才
            不会出现"Pydantic 拒了但 React 其实画得出来"的错杀。

            只做数字 → 字符串这一步；属性白名单和危险值拦截仍由下面那个
            校验器负责，安全边界没有放松。
            """
            if not isinstance(v, dict):
                return v
            out: dict[str, Any] = {}
            for k, val in v.items():
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    out[k] = val
                    continue
                num = int(val) if float(val).is_integer() else val
                out[k] = f"{num}" if k in _UNITLESS_STYLE_PROPS else f"{num}px"
            return out

        @field_validator("style")
        @classmethod
        def check_style(cls, v: dict[str, str]) -> dict[str, str]:
            for k, val in v.items():
                if k not in FREEFORM_ALLOWED_STYLE_PROPS:
                    raise ValueError(f"style property '{k}' is not in the allowed list")
                if _DANGEROUS_VALUE_RE.search(str(val)):
                    raise ValueError(f"style value for '{k}' contains a disallowed pattern: {val}")
                if k == "lineHeight":
                    _check_plausible_line_height(val)
            return v

        @field_validator("iconRef")
        @classmethod
        def check_icon(cls, v: Optional[str]) -> Optional[str]:
            # 2026-07-24：不再限定在一个手维护的十几个图标里——Ant Design 图标
            # 有上百个，硬卡一个小集合会逼着 LLM 拿语义不搭的图标凑合（真机
            # 撞到：订单销售额配了 trending-up、补货任务配了 alert-triangle）。
            # 改成"形状校验"：只要是合法的 Ant Design 图标组件名（PascalCase +
            # Outlined/Filled/TwoTone 结尾）就放行，前端按名字动态解析成真实
            # 组件。安全性不靠这个白名单兜底——图标名永远只当组件名查表，从不
            # 被当代码执行，且前端解析不到（拼错/编造的名字）就渲染成空、优雅
            # 降级，不会崩。老的 kebab 别名（check-circle 等）仍兼容。
            if v is None:
                return v
            if v in _LEGACY_ICON_ALIASES or _ANTD_ICON_NAME_RE.match(v):
                return v
            raise ValueError(
                f"iconRef '{v}' 不是合法的 Ant Design 图标名"
                "（应为 PascalCase 且以 Outlined/Filled/TwoTone 结尾，如 WalletOutlined）"
            )

        @model_validator(mode="after")
        def check_numbers_grounded(self) -> "FreeformNode":
            # "数字不能编"的生成侧强制（此前只靠 prompt 约束，模块 docstring
            # 自称有这条校验但代码里没有——guardrails 声明式 validator 思路）。
            # 只拦"数据声明"形状的数字（裸数值/货币/百分比/千分位/量词计数），
            # 不拦结构性数字（"近 7 天趋势"/"Top 5 客户"/"2026 年度"这类标题
            # ——终检实测过的一批误伤，prompt 也明说装饰性文案不需要 dataRef）。
            # 拦下即校验错误回喂 reask；建议把数值拆成独立节点挂 dataRef，
            # 因为渲染端 dataRefText 会整段替换 text（标签与数值要分节点写）。
            if self.text and _NUMERIC_CLAIM_RES_MATCH(self.text):
                if not (self.dataRef and self.dataRef.aggregate):
                    raise ValueError(
                        f"text 是数据声明（'{self.text[:40]}'）但没有挂 dataRef 聚合——"
                        "具体数值必须来自真实数据现算，不能手写。把数值拆成独立节点并挂 "
                        "dataRef（aggregate=count / sum:<fieldId> / avg:<fieldId>，"
                        "标签文字放在相邻节点），或改写文案去掉具体数值"
                    )
            return self

    FreeformNode.model_rebuild()

    class FreeformDesign(BaseModel):
        root: FreeformNode

        @model_validator(mode="after")
        def check_action_refs_scoped(self) -> "FreeformDesign":
            """openRecord / editRecord 必须落在某个 rowsRef 的子树里，且实体对得上。

            跟 fieldRef 同一条作用域规则，理由也同一条：这两个动作要的是
            **当前这一行**，作用域外没有"当前行"可言，渲染期无解。

            createRecord 不受这条限制——新建不需要当前行，页头那个「+ 新建」
            按钮就该在列表外面。

            实体对得上这条是防串台：在 customer 的列表里放一个
            `editRecord(follow_up)`，运行时会拿着客户的行 id 去开跟进记录的
            表单，打开的是一条不存在的记录。这种错单看节点看不出来，只有
            树级才判得了。
            """

            def walk(node: "FreeformNode", row_entity: Optional[str]) -> None:
                scope = node.rowsRef.entityRef if node.rowsRef is not None else row_entity
                a = node.actionRef
                # 转移三种跟 open/edit 同一条作用域规则：流程实例挂在具体
                # 那条记录上，没有"当前行"就没有可提交/可审批的对象。
                if a is not None and a.kind != "createRecord":
                    if scope is None:
                        raise ValueError(
                            f"actionRef '{a.kind}' 不在任何 rowsRef 里——"
                            "打开/编辑某一条记录必须放在声明了 rowsRef 的列表容器内部"
                            "（要有\"当前行\"才知道开哪一条）。"
                            "页头那种「新建」按钮请用 kind='createRecord'。"
                        )
                    if a.entityRef != scope:
                        raise ValueError(
                            f"actionRef '{a.kind}' 的 entityRef 是 '{a.entityRef}'，"
                            f"但它所在的列表是 '{scope}' 的——两者必须一致，"
                            "否则会拿着这张表的行 id 去开另一张表的记录。"
                        )
                for child in node.children:
                    walk(child, scope)

            walk(self.root, None)
            return self

        @model_validator(mode="after")
        def check_field_refs_scoped(self) -> "FreeformDesign":
            """fieldRef 必须落在某个 rowsRef 的子树里，且取的字段被那个
            rowsRef 显式声明过。

            这条只能在树级做——单个节点看不到自己在谁的作用域内。两件事一起
            管住：
              · 作用域外的 fieldRef（没有"当前行"可言）→ 渲染期无解，直接拦下
              · 白名单外的字段 → 逐行数据的主要防线，见 RowsRef 的说明
            嵌套 rowsRef 时以**最近的**那个为准（同 CSS 作用域直觉），所以递归
            时把 allowed 换成内层的白名单。
            """

            def walk(node: "FreeformNode", allowed: Optional[set[str]]) -> None:
                scope = (
                    set(node.rowsRef.fieldRefs) if node.rowsRef is not None else allowed
                )
                if node.fieldRef is not None:
                    if scope is None:
                        raise ValueError(
                            f"fieldRef '{node.fieldRef}' 不在任何 rowsRef 里——"
                            "取某一行的字段必须放在声明了 rowsRef 的列表容器内部。"
                            "如果你要的是总数/求和这类聚合值，用 dataRef。"
                        )
                    if node.fieldRef not in scope:
                        raise ValueError(
                            f"fieldRef '{node.fieldRef}' 没有在所属 rowsRef 的 "
                            f"fieldRefs 里声明（已声明的是 {sorted(scope)}）——"
                            "要显示的字段必须先在 rowsRef.fieldRefs 里列出来。"
                        )
                for child in node.children:
                    walk(child, scope)

            walk(self.root, None)
            return self

        @model_validator(mode="after")
        def check_tree_bounds(self) -> "FreeformDesign":
            depth, nodes = _freeform_tree_bounds(self.root)
            if depth > FREEFORM_MAX_DEPTH:
                raise ValueError(
                    f"内容树嵌套过深（{depth} 层，上限 {FREEFORM_MAX_DEPTH}）——"
                    "请压平结构，减少不必要的嵌套容器"
                )
            if nodes > FREEFORM_MAX_NODES:
                raise ValueError(
                    f"内容树节点过多（≥{nodes} 个，上限 {FREEFORM_MAX_NODES}）——"
                    "请精简内容，只保留关键信息"
                )
            return self

    return FreeformDesign


def _action_prompt_fragment() -> str:
    """按钮怎么才能真的能点——actionRef 的用法（2026-08-13）。

    不写这一段的话模型永远不会用它：契约里加了字段，但提示词里没提，
    等于加了个没人知道的开关。这跟 rowsRef 上线时是同一个道理。
    """
    return """\
想让某个元素**点了有反应**（按钮、卡片、一行记录），给它加 actionRef。
不加 actionRef 的元素点了什么都不会发生——不要画一个写着「编辑」却没有
actionRef 的框，那对用户是纯误导。

    {"tag": "div", "text": "+ 新建客户",
     "actionRef": {"kind": "createRecord", "entityRef": "customer"}}

三种动作，只有这三种：

    createRecord   打开新建表单。**不需要当前行**，页头那个「新建」就用它。
    openRecord     打开这一行的详情。
    editRecord     打开这一行的编辑表单。

⚠️ openRecord / editRecord **必须写在 rowsRef 列表容器的内部**——它们要的是
"当前这一行"，写在列表外面没有当前行可言，会被直接判失败。
而且 entityRef 必须跟所在列表的 entityRef 一致，否则会拿着这张表的行 id
去开另一张表的记录。

⚠️ 标签白名单里**没有 button**。带了 actionRef 的元素会自动变成可点击的
（含键盘可达），所以用 div/span 加 actionRef 就行，整张卡片也可以点。

⚠️ actionRef 只负责"打开哪个容器"，**不做写入**。真正的保存/删除由打开的
那个表单完成，你不需要也不能表达"点了直接改数据"。
"""


def _rows_prompt_fragment() -> str:
    """逐行内容怎么画——rowsRef 的用法（2026-08-03）。

    取代了此前的 `_blockref_prompt_fragment`（口径是"你画不出来，从名单里挑
    个现成积木摆进去"）。用户裁决「首页只由 LLM 动态设计，参照图上有什么就
    设计什么，不要固定组件」之后，固定积木那条路整体删除，逐行能力直接补给
    设计模型自己——版式它自由画，真实行数据由 rowsRef 喂进去。

    这段话必须把三件事说清楚，少一件都会退回老毛病：
      ① 逐行内容**可以画**（不说的话模型沿用旧直觉，改用聚合数字替代）；
      ② 模板只写一行（不说的话模型会手写 5 份几乎相同的子树，节点数爆掉）；
      ③ 要显示的字段必须先在 fieldRefs 里声明（白名单是逐行数据的主要防线，
         漏声明会被 Pydantic 拒收、白烧一轮 reask）。
    """
    return "\n".join([
        "",
        "### 逐行内容（排行榜、最近动态、待办清单、流程记录……）",
        "",
        "这类「一行一行列出真实记录」的内容**你可以自己画**，版式完全由你定：",
        "几列、每列多宽、徽标/进度条怎么摆，跟画别的区域一样自由。",
        "",
        "数据这样绑：在**列表容器**节点上写 rowsRef 声明取哪些行，它的 children",
        "写**一行**的样子（模板），运行时会按取到的真实行数重复渲染这份模板，",
        "把模板里带 fieldRef 的节点替换成那一行的真实值。",
        "",
        '{"tag": "div", "style": {"display": "flex", "flexDirection": "column"},',
        ' "rowsRef": {',
        '   "entityRef": "<真实实体 id>",',
        '   "fieldRefs": ["<这一行要显示的字段 id>", "..."],',
        '   "sortByRef": "<排序字段 id，可选>", "order": "desc", "limit": 5},',
        ' "children": [',
        '   {"tag": "div", "style": {"display": "flex", "gap": "12px"},',
        '    "children": [{"tag": "span", "fieldRef": "<字段 id>"},',
        '                 {"tag": "span", "fieldRef": "<字段 id>"}]}]}',
        "",
        "四条硬规矩：",
        "1. **模板只写一份**——不要手写 5 份几乎相同的行，重复由运行时负责。",
        # 2026-08-04：原来这条只说了 fieldRef 与 fieldRefs 的**关系**，没说
        # fieldRefs 本身必填。真机连挂三轮、烧 192 秒降级，报的都是
        # "rowsRef.fieldRefs 不能为空"——模型写了 entityRef/limit 就以为齐了。
        # 关系描述推不出"这个字段不能省"，得直说。
        "2. **fieldRefs 必填、且不能是空数组**——先在这里列出这一行要显示的字段 id，"
        "模板里的 fieldRef 才取得到值。只写 entityRef 和 limit 是不够的，会被直接拒收。",
        "3. **fieldRef 只能取 fieldRefs 里声明过的字段**，没声明的读不到（会被拒）。",
        "4. rowsRef 与 fieldRef 都必须指向数据模型里真实存在的实体/字段，不能编。",
        "",
        "limit 建议 5-8 条（上限 20）。这一页用不上逐行内容就完全不用，不要为了",
        "凑版面硬塞一个跟业务无关的排行榜——参照图上有才画，没有就没有。",
    ])


#: 「怎么画」的**兜底**处方（2026-08-07 拆出来）。
#:
#: 这两段（图标用法 1037 字 + 间距/圆角/阴影刻度 581 字）原本写死在
#: build_freeform_prompt 正文里，是首页同质化的最大来源：实测两个完全不同
#: 业务（连锁药房 / 农业大棚）的首页设计提示词**逐字相同 98.6%**——8512 字
#: 里只有 123 字随业务变化，而那 123 字全是 enum 选项名和内容清单，
#: 没有一个字关于"怎么排"。
#:
#: 于是每张 KPI 卡都被钉成"左上角一个 40~48px 圆角色块图标底座"，间距只准
#: 取 4/8/12/16/24/32，阴影只准用那两串固定值。药房和大棚拿到同一份处方，
#: 画出来自然是同一张脸。
#:
#: 现在它退居**兜底**：正常路径由 _refine_craft_via_llm 按业务现写
#: （见那个函数），改写失败才回落到这里。回落是静默的、逐字节等于旧行为。
#:
#: ⚠️ 这是模板不是成品：`{icon_list}` 那个占位符要由 _craft_fallback() 填。
#: 原文在 build_freeform_prompt 的 f-string 里，图标清单是就地插值的；搬成
#: 模块常量之后 f-string 没了，直接用会把 `{json.dumps(...)}` 原样发给模型。
_FREEFORM_CRAFT_FALLBACK_TEMPLATE = """图标要做得醒目、有存在感：统计卡（KPI 卡）的图标别做成一个跟正文一样大的
小字符，做成一个 40~48px 的圆角色块当图标底座（给这个图标节点设
backgroundColor 一块主题色/浅色底 + borderRadius + 居中），图标本身用
fontSize 22~28px，色块配色跟这张卡的主色系呼应——参考现代仪表盘里
"每张 KPI 卡左上角一个醒目图标方块"的做法，不要缩成一个灰扑扑的小图标。

间距（padding/margin/gap）、圆角（borderRadius）只能从这套固定刻度里取值，
不要自己另外发明数字——这套刻度是应用真实壳体（侧边栏/顶栏/卡片）本身在用
的同一套 Design Token，从这里取才能跟外层容器的间距感觉一致，不是"设计得
更精致"，是"对得上"：
- 间距刻度（px）：4、8、12、16、24、32——越小用在图标与文字的贴身间距，
  越大用在卡片之间的分隔；同一张卡片内部的 padding 通常统一用同一个值
  （比如卡片一律 16，不要一张卡 14 另一张 18）。
- 圆角刻度（px）：4（小元素，比如徽标/标签）、6（默认，大多数卡片/按钮）、
  8（强调型大卡片）。
- 阴影：浅色卡片用 "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)"
  这类很轻的多层阴影（近似取代边框、不抢视觉），需要更明显层次时用
  "0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)"，
  不要自己调一个更重/更黑的阴影。"""


def _craft_fallback() -> str:
    """「怎么画」的兜底处方。图标**契约**不在这里（见 _icon_contract）。"""
    return _FREEFORM_CRAFT_FALLBACK_TEMPLATE


#: 图标的**契约**：怎么把一个图标挂上去。永远在提示词里，跟改写没关系。
#:
#: 2026-08-07 拆分后第一次真机产出就踩了这个坑：药房和大棚两页
#: **一个 iconRef 都没有**，模型把 "FileSearchOutlined"、"AlertOutlined"
#: 这些名字当**正文**写进了 text 字段，页面上渲染出一排蓝色的英文单词。
#:
#: 原因很直接：改写系统提示里写着"不要写任何关于 JSON 结构、标签名、字段名
#: 的内容"，改写 LLM 老老实实照办，写出来的是"图标使用 MedicineBoxOutlined
#: 表示药房业务、图标统一 16px"——**只说了用哪个图标，没说图标挂在哪**。
#: 而这句"挂在节点的 iconRef 字段上"原本就藏在被我搬走的那段处方里。
#:
#: 所以边界在这儿：
#:   · **契约**（字段名 iconRef、名字形状、大小由 fontSize 决定、可选清单）
#:     → 系统给，固定不变，改写碰不到；
#:   · **处方**（配哪个语义的图标、多大、要不要底座色块、什么形状）
#:     → 改写按业务自己定。
#: 这跟 style 白名单 / chart 字段名留在外面是同一条线——凡是"写错就判失败或
#: 渲染不出来"的，都不进改写的输入。
_FREEFORM_ICON_CONTRACT_TEMPLATE = """图标怎么挂：在**需要图标的那个节点**上写 `"iconRef": "<Ant Design 图标组件名>"`。
图标名不是正文——**绝不要把图标名写进 text 字段**，那样页面上会直接显示出
"FileSearchOutlined" 这么一串英文单词。一个节点写了 iconRef 就渲染成图标本身。
名字用 PascalCase、以 Outlined 结尾（Filled/TwoTone 也可以），比如
WalletOutlined、ShoppingCartOutlined、PieChartOutlined。Ant Design 有上百个
图标，**按语义挑最贴切的那个**，不要将就：金额/营收用 DollarOutlined/
WalletOutlined/AccountBookOutlined，订单/购物用 ShoppingCartOutlined/
ShoppingOutlined，库存/补货用 InboxOutlined/DropboxOutlined/ContainerOutlined，
任务/清单用 ProfileOutlined/CarryOutOutlined，图表/分析用 PieChartOutlined/
BarChartOutlined/LineChartOutlined，用户/会员用 UserOutlined/TeamOutlined/
CrownOutlined，时间/排期用 ClockCircleOutlined/CalendarOutlined，告警/风险用
WarningOutlined/AlertOutlined/FireOutlined。下面是一批常用示例，但不限于这些，
任何合法的 Ant Design 图标名都可以用：
{icon_list}
图标大小 = 这个节点的 fontSize，想让图标大就把这个节点的 fontSize 调大，
**不是**设 width/height。
每张统计卡/列表项/小节标题旁边，尽量都配一个贴切的 iconRef——图标是这类信息
卡片天然该有的视觉锚点，不要整份设计一个图标都不用。"""


def _icon_contract() -> str:
    """把图标契约里的可选清单填上。

    用 replace 而不是 str.format：这段文本里有 `"iconRef": "<...>"` 这样的
    JSON 片段，将来再加一段带花括号的例子，format 会当场炸，replace 不会。
    """
    return _FREEFORM_ICON_CONTRACT_TEMPLATE.replace(
        "{icon_list}", json.dumps(list(FREEFORM_ALLOWED_ICON_REFS), ensure_ascii=False)
    )


#: 让 LLM 按业务现写「怎么画」那一段的系统提示（2026-08-07）。
#:
#: 形制照抄 _SHEET_PROMPT_REFINE_SYSTEM（参照板出图提示词那条已经这么干了，
#: 见 _build_overview_sheet_facts 的说明）。但**边界不同，这条差别是要命的**：
#:
#:   出图那条的产物是一张**图片**，没有校验。改写 LLM 漏一条，图丑一点而已。
#:   这条的产物是一棵**必须过校验的 JSON 树**（标签白名单 / style 属性白名单 /
#:   dataRef 与 chart 的 key 名与取值域）。漏掉契约条款 → 设计判失败 →
#:   首页退回固定骨架，正是用户抱怨的那个样子。
#:
#: 所以**契约段不进这个改写的输入，也不许它输出契约**：它只负责"气质与排布"，
#: 白名单和 schema 由 build_freeform_prompt 自己拼在外面，改写 LLM 碰不到。
#:
#: ⚠️ 第 3 条被真机打过脸一次，值得单独说。原文只写"图标用 Ant Design 组件名、
#: 按语义挑"，改写 LLM 照办，产出"图标使用 MedicineBoxOutlined 表示药房业务、
#: 统一 16px"——**说了用哪个，没说挂在哪**。下游设计模型于是把图标名当正文
#: 写进 text，两页一个 iconRef 都没有，页面上排出一串蓝色英文单词。
#: 现在"挂在 iconRef 字段上"由 _icon_contract() 固定给出，这里补一句让改写
#: 知道机制已由系统交代、它只管设计判断，免得它以为自己得负责说清怎么挂。
_FREEFORM_CRAFT_REFINE_SYSTEM = (
    "你是给「界面设计模型」写作画要求的人。下面会给你一个企业应用某一页的"
    "**事实**：这一页要覆盖的内容范围、真实数据字段、设备档。\n\n"
    "请据此写出一段**中文作画要求**，交给另一个模型去产出这一页的版式。\n\n"
    "要求：\n"
    "1. 只输出要求正文，不要解释、不要标题、不要 markdown 代码块。\n"
    "2. **按这个业务的性质决定视觉气质与排布**：哪块内容该最显眼、分几列、"
    "谁跟谁并排、什么该占整行、卡片之间的大小对比、图标该用什么语义的、"
    "间距该紧凑还是疏朗、圆角该硬朗还是柔和、阴影该轻还是重。"
    "按这个业务的人打开这一页最先要做什么来排——**不要套「顶部一排等宽指标卡 + "
    "下面两张图 + 底部一张表」那种通用后台网格**，那是这次要摆脱的东西。\n"
    "3. 图标：**怎么挂图标（写在哪个字段上）系统已经另外交代过了，你不用管**，"
    "你只决定设计层面的事——这一页哪些地方该配图标、配什么语义的图标"
    "（用 Ant Design 图标组件名，如 WarningOutlined）、多大、要不要底座色块、"
    "什么形状，也可以判断这一页压根不用底座。\n"
    "4. 间距、圆角、阴影**给出具体数值**，让下游有确定的依据；但数值由你按这一页"
    "的气质定，不必迁就任何通用刻度。\n"
    "5. **不要**写任何关于 JSON 结构、标签名、允许的 CSS 属性名、dataRef/chart "
    "字段名的内容——那些由系统另行给出，你写了会互相打架。\n"
    "6. 不要编造数据模型里没有的字段或指标。\n"
    "7. 长度 300-600 字，写成连贯的中文段落。"
)


def _refine_craft_via_llm(
    design_brief: str, datamodel: dict[str, Any], *, device: str = ""
) -> Optional[str]:
    """让 LLM 按这一页的业务现写「怎么画」。**加分项，失败静默回退。**

    与 _refine_sheet_prompt_via_llm 同一套 fail-open 纪律：任何失败（LLM 报错 /
    空回复 / 短得不像要求）都返回 None，调用方回落 _FREEFORM_CRAFT_FALLBACK
    ——那份常量逐字节等于改造前的行为，所以最坏情况是"跟以前一样"，不是更差。

    为什么值得多花一轮 LLM：写死处方下两个完全不同业务的首页设计提示词逐字
    相同 98.6%，版式必然雷同。

    ⚠️ 这是**拿确定性换多样性**。那两段常量原本在替模型兜住已知的坑（图标退化成
    小字符、间距各写各的），现在每次让改写 LLM 重新想一遍，它漏掉哪一条，那一页
    就可能复发对应的老毛病。判断划不划算只能看产出——别拿"以前修过"当作现在也
    不会复发的理由。这句话是从 _build_overview_sheet_facts 那次同类改造里抄来的，
    因为那次的教训后来真的复发过一回（灰条占位）。
    """
    # 连 import 都放进 try：这一整段是加分项，导入失败（模块缺失、循环导入）
    # 也必须表现成"这一步跳过"，而不是把 build_freeform_prompt 整个炸掉——
    # 那会让首页退回固定骨架，比拿兜底处方画一张同质化的页糟得多。
    try:
        from sliderule_llm.client import LlmError, call_llm_with_retry
    except Exception as exc:  # noqa: BLE001
        print(f"[freeform_block] craft refine skipped (import): {str(exc)[:160]}")
        return None

    # 预算不够就别抢：这一步是**嵌在 monitor.design 里面**跑的，而 design 自己
    # 的准入线只有 `130 * design_total` 秒。实测这次改写单次 ~40s，如果卡着
    # 130 秒进来再花 40，留给真正出版式的只剩 90——那不是"版式朴素一点"，是
    # 版式**整段生成失败**、首页退回固定骨架，比拿兜底处方画一张同质化的页
    # 糟得多。所以门槛设在 design 准入线之上留足余量。
    #
    # 220 = 40（改写实测）+ 130（design 准入线）+ 50（改写偶尔重试一轮的余量）。
    # 拿不到预算上下文（remaining is None，比如单测/离线调用）时照常跑——
    # 这跟这个文件里另外两处预算判断（palette / design）的写法一致。
    remaining = remaining_run_budget_seconds()
    if remaining is not None and remaining < 220:
        print(f"[freeform_block] craft refine skipped: 预算只剩 {remaining:.0f}s")
        return None

    facts = "\n".join(
        [
            f"设备档：{device or 'desktop'}。",
            f"这一页要覆盖的内容范围：\n{design_brief}",
            f"真实数据字段：\n{_datamodel_summary_lines(datamodel)}",
        ]
    )
    try:
        result = call_llm_with_retry(
            [
                {"role": "system", "content": _FREEFORM_CRAFT_REFINE_SYSTEM},
                {"role": "user", "content": facts},
            ],
            max_attempts=2,
            backoff_ms=1500,
            temperature=0.9,  # 比出图改写更高：这一步要的就是发散
            max_tokens=default_max_tokens(),
        )
    except LlmError as exc:
        print(f"[freeform_block] craft refine skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 改写失败绝不能拖垮主链路
        print(f"[freeform_block] craft refine skipped (unexpected): {str(exc)[:160]}")
        return None
    text = (result.content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if len(text) < 120:
        print(f"[freeform_block] craft refine skipped: 回复太短（{len(text)} 字）")
        return None
    return text


def build_freeform_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
    chart_colors: Optional[list[str]] = None,
    chart_variant_key: str = "",
) -> str:
    # 「怎么画」这一段每页现写一次（拿确定性换多样性，理由见 _refine_craft_via_llm）。
    # 失败静默回落到兜底常量，逐字节等于改造前的行为。
    craft = _refine_craft_via_llm(design_brief, datamodel, device=device) or _craft_fallback()
    return f"""你是一名前端视觉设计师。设计一个可视化组件：{design_brief}
要有视觉创意和现代感，大胆用间距、层次、颜色对比、图标去表达内容。

{_theme_prompt_fragment(theme_id, generated_theme, chart_colors, chart_variant_key)}
{_device_prompt_fragment(device)}

只能用安全原子积木拼：{", ".join(FREEFORM_ALLOWED_TAGS)} 标签。

受控图片（imageRef）：只有营销落地页会提供 `landing-hero`。需要主视觉时在一个
div 节点写 `"imageRef":"landing-hero"` 和准确的 `imageAlt`；运行时只会解析
这个受控引用，不能填写 URL、data URI 或其它值。图片节点可用 width/height/
borderRadius/overflow 控制版式，不能用 CSS url(...)。

{_icon_contract()}

{craft}

style 对象的 key 只能用这些 CSS 属性名，写了列表之外的属性（比如 fontFamily、
listStyle）会被直接判失败：{", ".join(FREEFORM_ALLOWED_STYLE_PROPS)}。
颜色用具体十六进制值，背景可用 linear-gradient(...)，不能出现 url(...)。

根节点（也就是最外层那个 "root"）会被直接放进页面已有的内容区容器里，那层
容器本身已经带了背景色和内边距——根节点的 style 不要再设置 backgroundColor
或 padding，会跟外层容器套出"卡片里嵌卡片"的多余边框感；根节点只负责整体
排布（display/flexDirection/gap/width 这类）就够了。想要的卡片感、分组感，
放到内部子块（比如每张统计卡/图表卡自己）上去做。

需要柱状图/折线图/饼图/环形图这类真正的图表时，不要用 CSS 画近似的形状——
节点上加一个 chart 字段，交给真实图表引擎按运行时的真实数据现算，会随数据
变化自动更新，不是生成时定死的静态画面：
{{"tag": "div", "style": {{...控制这块区域的宽高/间距...}}, "chart": {{
  "type": "bar" | "line" | "pie" | "donut",
  "entityRef": "<数据模型里真实的实体 id>",
  "dimensionFieldId": "<同实体下真实的字段 id，通常是 enum 字段，图表按这个
    字段的取值分组>",
  "metric": "count" | "sum",
  "metricFieldId": "<metric 是 sum 时必填，同实体下真实的 number 字段 id>",
  "metricLabel": "<这个指标的展示名，比如 数量/总额>"
}}}}
有 chart 字段的节点不需要也不应该再写 children/text 去画图表本身的内容
（图表引擎会接管这块区域），但节点本身的 style 仍然控制这块区域的宽高/
外边距/背景。柱状图/饼图/环形图的分组字段（dimensionFieldId）优先选 enum
类型的字段——这样图表的类别数量和名字直接来自真实数据，不需要你去猜。

注意：chart 节点渲染出来的图表画布本身是固定高度（约 200px），你在这个
节点 style 上设的 height 不会让图表本身跟着变高变矮，只影响这块区域在
整体版式里占多大留白——不要指望"设一个更大的 height 图表就会画得更大"，
想要图表视觉上更突出，用外层包一层更宽的容器（比如让它独占一整行）或
调整周围留白，而不是在 chart 节点自己身上加一个不会生效的 height 期望。
{_chart_candidates_prompt_fragment(datamodel)}
{_rows_prompt_fragment()}
{_action_prompt_fragment()}
下面是这个应用真实的数据模型，唯一可以引用的数据来源：
{json.dumps(datamodel, ensure_ascii=False, indent=2)}

如果设计里画的是某个 enum 字段的分类/阶段/流程步骤（比如状态流转图、分类
占比图），具体有几类、每一类叫什么名字，必须跟这个字段 options 里的真实值
完全一致（数量、顺序、名字都不能改），不能自己另外发明一套"看起来差不多但
对不上"的名字——那样图面好看，但跟真实数据字段脱节，dataRef 引用它也没
意义了。

凡是设计里出现的具体数字/统计类文字，必须挂 dataRef 指向真实存在的
entity+field，JSON 形状严格是这样，key 名必须一字不差（不能写成 entity/
field 这种猜测的名字，必须是 entityRef/aggregate）：
{{"dataRef": {{"entityRef": "<上面数据模型里真实的实体 id>", "aggregate": "count"}}}}
aggregate 只能是 "count"、"sum:<字段id>"、"avg:<字段id>" 三种之一，或者不填
这个键（没有聚合、只是引用实体本身时可以省略 aggregate）。
数据模型里没有合适字段支撑的数字就不要画，不能编。纯装饰性文案不需要 dataRef。

KPI 数字想带「环比 + 迷你走势线」时，在同一个 dataRef 里再加两个键：
{{"dataRef": {{"entityRef": "<实体 id>", "aggregate": "count",
  "trendFieldRef": "<同一个实体下 type 为 date 的字段 id>", "trendGrain": "day"}}}}
trendFieldRef 必须是**同一个实体**下的 date 字段（不是 number、不是 string），
trendGrain 只能是 "day"、"week"、"month"，不填按 day 算。给了这两个键之后，
渲染端会按这个时间字段自动分桶，在大数字下面渲染出「较前一日 ↑12%」和一条
迷你走势线——**这两层是渲染端算的，你不要自己再写一个写死的百分比文字节点，
也不要为它画额外的图**。走势的取值口径跟 aggregate 一致（aggregate 是
sum:金额，走势线画的就是每期金额之和）。
这是 KPI 卡片最该用的地方：数据模型里有日期字段的核心指标，都值得带上。

注意：children 数组里每一项都必须是完整的节点对象（有 tag 字段），
不能直接放字符串当子节点——文字内容一律放在节点的 text 字段里。

输出严格 JSON：{{"root": {{"tag": "div", "style": {{}}, "children": [...]}}}}
只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏。"""


def _build_reference_image_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """2026-07-30 改版：把"只示意版式与配色"换成"画出真实完整的版式细节"。
    实测对比过（同一份内容清单、同一套配色约束，只改这一句）：旧措辞画出来的
    卡片经常只有图标轮廓+大数字，没有图标徽标底色、趋势对比小字这类真实产品
    里常见的细节；换成"真实完整"之后密度明显提升，且配色约束没受影响（这条
    跟"是否单一克制品牌色"是两回事，可以分开控制）。不要求画侧栏/顶栏——那
    部分继续由 device_note 说明"另有画面，不用你画"，这里只提升内容区本身
    的细节完整度。
    """
    hint = _theme_palette(theme_id, generated_theme)
    charts = "、".join(hint["charts"])
    device_note = {
        # 手机档必须在**提示词里明说竖屏**，这是拿到竖版画布的唯一办法：
        # 这个端点的输出形状由**提示词内容**决定，尺寸参数只定像素预算档位
        # （详见 _DEVICE_IMAGE_SIZE 上方的探针记录）。此前这里只写"比例偏竖长"
        # 这种含糊说法，配上后面那句"充分利用整个画布"，模型就把内容横着摊开
        # 画成方图——画出来的比例手机上根本不存在。现在直接点名 9:16 手机屏。
        "phone": (
            "这是手机端内容区里的一张卡片（上方标题栏、下方 Tab 导航另有画面，"
            "不用你画）。**整张图要画成手机竖屏比例（9:16 的竖长画面）**，"
            "内容必须单列纵向排布，字号/图标/间距都比桌面收紧一档。"
        ),
        "tablet": "这是平板端内容区里的一张卡片（侧边栏+顶栏另有画面，不用你画），中等宽度。",
    }.get(device, "这是桌面端内容区里的一张卡片（左侧侧边栏、上方顶栏另有画面，不用你画），可以偏宽幅横向布局。")
    fill_note = "画面内容要充分利用整个画布，边缘到边缘，不要在四周留一圈空白画布底色、"
    datamodel_summary = _datamodel_summary_lines(datamodel)
    datamodel_note = (
        f"\n这个区块背后真实的数据字段长这样（画面里出现的分类/阶段/条目数量"
        f"和名字要照着这些字段（尤其是括号里展开的 enum 选项）来，不要凭空编一个"
        f"'看起来差不多但对不上'的数量或名字，只示意版式不用写具体数值）：\n{datamodel_summary}\n"
        if datamodel_summary else ""
    )
    return (
        f"为一个应用界面区块生成一张 UI 参考效果图（干净原型图）。设计需求：{design_brief}。"
        "要求：画出这个内容区真实完整的版式细节——每张卡片要有具体的图标（配色底"
        "徽标而不是裸线条）、标题、数据占位，以及趋势对比/状态标签这类辅助信息，"
        "不要只画示意性的空壳卡片；"
        f"{_PLACEHOLDER_STYLE_NOTE}"
        # 2026-07-30：这条明令原本只写在 _build_overview_sheet_prompt 里，
        # 这边漏了——而两边**会吃到同一份 brief**：总览页正常走参照板，但
        # _generate_overview_sheet_b64 任何一步失败都静默返回 None，
        # generate_freeform_block 就会退回来自己生一张，把带 blockRef JSON 的
        # 总览 brief 原样喂到这里。真机复现过两次：画面里直接印出
        # 「rowsRef / entityRef」这类徽标，严重时整块 JSON 当代码块画进图里。
        "注意：上面的设计需求里可能夹带 JSON 片段、字段 id、rowsRef 之类的"
        "技术标识，那些只是在告诉你**这一格该放什么内容**，不是要画的文案——"
        "画面里一个技术标识都不许出现，该画成对应的真实界面（比如一行行的动态"
        "列表、带图标和状态标签的条目），标题用人看得懂的中文短语；"
        f"配色基调用「{hint['label']}」这套主题——主色 {hint['primary']}，大面积底色仍走浅色（贴近 "
        f"{hint['contentBg']} 或纯白，保证内容读得清），强调浅底可参考 {hint['accentBg']}；"
        # 多色分类板**只给图表用**。此前这句写的是"如果画面需要多个不同色块
        # 区分类别"——范围太含糊，模型会把这 5 个色相铺到 KPI 卡的图标徽标上，
        # 一张卡一个色（蓝/紫/青/橙），整屏看着花。真机对比过：同一份内容、
        # 只把配色说明换成单一主色，出图明显更协调（2026-07-30 手机档对比）。
        # 图表本来就需要多色区分类别，所以不是不给，是**限定在图表里面**。
        f"图表（折线/环形/柱状）里区分类别时用这几个颜色：{charts}，不要另配一套糖果色；"
        f"{_CARD_VISUAL_NOTE}"
        "不要出现任何多余的装饰性水印或品牌字样；"
        f"{fill_note}"
        "不要画装饰性的外框/圆角卡片壳/网页浏览器窗口 mockup 把整个画面包起来——"
        "这张图本身就是内容区局部，不是「一张图里嵌一张界面截图」的效果。"
        f"{device_note}"
        # 2026-07-30 人工核对：加完配色限定与技术标识两段之后，出图明显变稀
        # ——坐标轴刻度和图例数值退化成灰色横线、KPI 卡掉了副标题和环比行、
        # 列表项掉了次要信息。这条 prompt 到这里已经堆了十几句"不要/不许"，
        # 而"画出真实完整的版式细节"那句在最前面，早被冲掉了：模型把一长串
        # 禁令读成"少画点最安全"。这跟 c425911 记的是同一个坑（"只示意版式与
        # 配色"被读成"画个意思就行"）。
        #
        # 所以在**最后**补一份正面的、可逐项核对的清单——顺序上压在所有禁令
        # 之后，并明说禁令管的是别画错、不是让你少画。正面枚举比否定句管用，
        # 这也正是那份第三方技能包提示词的写法（把真实结构件逐个点名）。
        "最后一条，优先级最高：这张图是拿来当版式参照的，**信息层级必须画满**"
        "——每张 KPI 卡要有图标、标题、数值占位、以及环比/趋势那一行；每个图表"
        "要有标题、图例、坐标轴刻度标签和单位；每条列表项要有图标、主标题、"
        "一行次要信息、状态标签和时间占位。**这些标签一律写成看得见的占位文字**"
        "（照上面那套按字段形状写的占位法），不许用灰色横线、色块或者留空代替文字。"
        "上面那些「不要」管的是别画错东西，不是让你少画东西。"
        f"{datamodel_note}"
    )


def _build_overview_sheet_facts(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """总览参照板的**事实清单**——只给模型它自己产生不了的信息，不给任何做法。

    2026-07-31 重构。此前这里是一份 ~1500 字的写死模板（版式处方 / 技术标识
    禁令 / 占位写法 / 水印与铺满 / 信息层级清单），实测两个完全不同业务的出图
    提示词**逐字相同 87%**——能变的那 13% 里没有一个字是关于"怎么排"的，所以
    无论换什么题材，画出来都是「KPI 行 → 图表 → 列表」。

    现在改成两段式：这里只吐事实，怎么画交给 _refine_sheet_prompt_via_llm 按
    这一个系统现写（见那个函数的说明）。事实包含四类，每一类都是"模型没法
    自己推出来"的：

      · 画布尺寸与设备档 —— 端点逐像素认 size，两边说的必须是同一个画布
      · design_brief    —— 这一页经过门禁的内容范围
      · datamodel 摘要  —— 真实实体/字段/enum 选项，防止编出对不上的分类数

    ⚠️ **不给色板**（2026-08-03，用户裁决：首页生图自由发挥）。
    此前这里会附一句"运行时外壳已经按这套渲染了，别偏色"。现在全站外壳是
    统一的白菜单 + 白 Header + 一个品牌主色，参照图本来就不需要去迁就它——
    它的职责只剩**版式**。把配色的手铐摘掉，出图的表现力明显更高，而外壳
    的一致性由前端那套固定色板保证，不依赖这张图画成什么样。

    ⚠️ 保留一条底线：**这段文本会被原样塞进 refine 的输入里**，而 brief 里
    夹带 blockRef JSON 是常态。refine 那一步的指令里必须自己处理这件事——
    这里不再重复禁令（那正是本次要拿掉的东西之一）。
    """
    del theme_id, generated_theme  # 见上：参照图不再受色板约束
    datamodel_summary = _datamodel_summary_lines(datamodel)
    canvas = _sheet_image_size_for_device(device)
    tier = {
        "desktop": "桌面端（宽屏，横版画布）",
        "phone": "手机端（窄屏，竖版画布）",
    }.get(device, "未指定（按桌面宽屏处理）")

    parts = [
        f"画布：{canvas} 像素，出图端点逐像素照此返回。",
        f"设备档：{tier}。",
        f"这一页要覆盖的内容范围：\n{design_brief}",
    ]
    if datamodel_summary:
        parts.append(
            "背后真实的数据字段（画面里出现的分类/阶段/条目的数量和名字要照着"
            f"这些来，尤其是括号里展开的 enum 选项）：\n{datamodel_summary}"
        )
    return "\n\n".join(parts)


# refine 那一步的**元提示词**：告诉改写 LLM 它在写什么、写给谁看。
#
# 这一段本身仍然是常量——但它约束的是"怎么写提示词"，不是"怎么画界面"。
# 界面上的每一条要求（画多大、画几张、怎么占位、不许画什么）现在都由改写
# LLM 按这一个系统自己定，所以不同业务出来的提示词文字必然不同。
_SHEET_PROMPT_REFINE_SYSTEM = (
    "你是给文生图模型写提示词的人。下面会给你一个企业应用某一页的**事实清单**"
    "（画布尺寸、设备档、这一页要覆盖的内容范围、身份色板、真实数据字段）。\n\n"
    "请据此写出一段**中文文生图提示词**，用来生成这一页的 UI 版式参照图。"
    "这张图的读者不是终端用户，而是另一个负责出页面结构的设计模型——它会照着"
    "这张图学「这一页该长什么样」。\n\n"
    "要求：\n"
    "1. 只输出提示词正文，不要解释、不要标题、不要 markdown 代码块。\n"
    "2. 版式由你按这一页的**业务性质**决定：哪块内容该在最显眼的位置、"
    "分几列、谁跟谁并排、什么该占整行——按这个业务的人打开这一页最先要做什么"
    "来排，不要套「顶部一排指标卡 + 下面两张图 + 底部一张表」那种通用后台网格。\n"
    "3. 事实清单里可能夹带 JSON 片段、字段 id、rowsRef 这类**技术标识**，"
    "那些只是在说明某一格该放什么内容，不是要画在图上的文案——你写的提示词里"
    "必须把它们翻译成人看得懂的中文界面说法。\n"
    "4. 这张图**不能出现任何真实数据**（它会被误当成真实业务数字）。你要在"
    "提示词里写清楚该怎么占位，并且**按字段类型选合适的占位形状**，让人一眼"
    "看出这一格装的是什么类型的内容。\n"
    # 2026-08-03 补：这一条此前只写"要占位"，没写"占位长什么样"，于是出图里
    # 数值那一类退化成**灰色横条/灰色圆角方块**——真机连着撞到（KPI 数值、
    # 环图中心、坐标轴刻度全是灰条）。
    #
    # 这不是"不好看"而已：参照板的读者是设计模型，它看图学的是"这一格该放什么
    # 形状的内容"。一根灰条什么都没说——分不清那格装的是三位数计数、金额还是
    # 日期，于是列宽/对齐/字号全学不到，信息层级也塌了（看不出 KPI 卡是三层
    # 还是一层）。
    #
    # 同一条规则在区块级参照图那边（_build_reference_image_prompt）一直是写死
    # 的常量，2026-07-31 这条链路改成两段式时**没跟着搬过来**——V5.7 架构图
    # 当时就写下了这个风险："改写 LLM 漏掉哪一条，那一张图就会复发对应的老
    # bug。"这次就是那次复发。所以补的时候把**两头都写死**：既说占位形状，
    # 也点名禁掉灰条这个具体的退化形态。
    "4b. 占位必须是**看得见的文字**，而且要保留每类字段本来的形状——"
    "日期写成 20XX-XX-XX、金额写成 ¥ ××,×××、百分比写成 ××.×%、"
    "计数写成 ×,××× 或「×× 人」、手机号写成 138-••••-••••、"
    "人名写成「张先生」这类（按本业务语境选，别带无关职业称呼）、"
    "状态/分类直接用事实清单里给出的真实枚举标签。\n"
    "   **不许用灰色横条、灰色色块或者留空来代替这些文字**，一格都不行。"
    "同样地，坐标轴刻度、图例数值、KPI 的环比那一行也都要写成可读的占位文字，"
    "不能省掉——这张图是拿来当版式参照的，信息层级必须画满。\n"
    "5. 画布尺寸和色板照抄事实清单里的值，不要自己改。\n"
    "6. 长度控制在 400-800 字，写成一段连贯的中文，不要分点罗列。"
)


def _refine_sheet_prompt_via_llm(facts: str, *, device: str = "") -> Optional[str]:
    """让 LLM 按这一个系统现写出图提示词。**加分项，失败静默回退。**

    跟 _critique_and_revise_design 同一套纪律：任何失败（LLM 报错 / 空回复 /
    短得不像提示词）都返回 None，调用方退回事实清单直接出图。绝不能因为
    "想写得更好"反而把整条参照图链路弄挂。

    为什么值得多花一轮 LLM：写死模板下两个不同业务的提示词逐字相同 87%，
    版式必然雷同（见 _build_overview_sheet_facts 的说明）。让模型按业务现写，
    才有"律所工作台"和"大棚监控台"排布不同的可能。
    """
    from sliderule_llm.client import LlmError, call_llm_with_retry

    convo = [
        {"role": "system", "content": _SHEET_PROMPT_REFINE_SYSTEM},
        {"role": "user", "content": facts},
    ]
    try:
        # **不传 on_delta**——传了 call_llm 就走流式（见其 docstring）。当前
        # provider（api.rcouyi.com / gpt-5.6-luna）的流式回包解析出来是空内容，
        # 同一个请求非流式一次就回。这里没有逐块回显的需求，直接走非流式。
        # 别照抄 _critique_and_revise_design 那处的写法：那里传 on_delta 是为了
        # 兼容它自己的调用约定，不是因为需要流。
        result = call_llm_with_retry(
            convo,
            max_attempts=2,
            backoff_ms=1500,
            temperature=0.7,
            max_tokens=default_max_tokens(),
        )
    except LlmError as exc:
        print(f"[freeform_block] sheet prompt refine skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 改写失败绝不能拖垮主链路
        print(f"[freeform_block] sheet prompt refine skipped (unexpected): {str(exc)[:160]}")
        return None
    # 字段是 content 不是 text——LlmResult 上没有 text，用 getattr 兜底会**永远
    # 拿到空串**，然后被下面的长度检查判成"回复太短"静默退回。这个 bug 不会报错、
    # 不会留痕，表现就是"改写好像一直没生效"。
    text = (result.content or "").strip()
    # 去掉模型偶尔套上的代码块围栏
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if len(text) < 120:
        print(f"[freeform_block] sheet prompt refine skipped: 回复太短（{len(text)} 字）")
        return None
    del device  # 档位信息已经在 facts 里，这里只留作调用方可读性
    return text


def refine_sheet_prompts_parallel(
    items: list[tuple[str, str]], *, max_workers: int = 4
) -> list[Optional[str]]:
    """批量改写，**并发发出**。返回与入参等长的列表，失败位置是 None。

    每次改写是一发独立的网络请求，串行做 N 页就是 N 倍延迟。这里用线程池并发
    ——call_llm_with_retry 是阻塞 IO，线程池对它有效。

    失败不抛：单个位置失败就是 None，调用方按"这一项退回事实清单"处理，与
    单发版本的 fail-open 语义一致。
    """
    if not items:
        return []
    if len(items) == 1:
        facts, device = items[0]
        return [_refine_sheet_prompt_via_llm(facts, device=device)]

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(max_workers, len(items))) as pool:
        futures = [
            pool.submit(_refine_sheet_prompt_via_llm, facts, device=device)
            for facts, device in items
        ]
        out: list[Optional[str]] = []
        for f in futures:
            try:
                out.append(f.result())
            except Exception as exc:  # noqa: BLE001 — 单个失败不拖垮整批
                print(f"[freeform_block] sheet prompt refine worker failed: {str(exc)[:160]}")
                out.append(None)
    return out


def _build_overview_sheet_prompt(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> str:
    """总览参照板的最终出图提示词 = 事实清单 → LLM 现写。

    ── 2026-07-31 之前是什么样 ────────────────────────────────────

    此前这里是一份写死的 f-string 模板，装着五段常量：版式处方（按 device
    三选一，每支自己是死字符串）、技术标识禁令、占位写法（435 字模块常量）、
    "不要水印 / 画面撑满画布"、末尾信息层级清单。

    那套模板是一路减法实验调出来的，每一条都有出图证据（砍技术标识禁令 →
    blockRef 的 JSON 被当代码块画进图；砍占位写法 → 编出加起来能对上的自洽
    假数据）。问题不在单条对不对，而在**它对每个应用说同一句话**：实测两个
    完全不同业务（律所案件台 / 农业大棚监控）的出图提示词逐字相同 87%，能变
    的 13% 全是色值、字段名和内容清单，没有一个字关于"怎么排"。所以连着三轮
    实验——删掉版式处方、加一句"每个页面布局要各不相同"、换掉 brief 口吻——
    出图骨架都纹丝不动。

    ── 现在的形态 ────────────────────────────────────────────────

    两段式：
      ① _build_overview_sheet_facts 吐**事实**（画布/设备档/内容范围/色板/
         真实字段），一条做法都不给；
      ② _refine_sheet_prompt_via_llm 让 LLM 按这一个系统现写出图提示词，
         版式、占位写法、该强调什么，全部由它按业务性质定。

    ⚠️ **这是拿确定性换多样性。** 那五段常量原本是在替模型兜住已知的坑；
    现在改成每次让改写 LLM 自己重新想一遍，元提示词里只留了"翻译技术标识"
    和"按字段类型选占位形状"两条方向性要求，没有逐类字段的形状清单。改写
    LLM 漏掉哪一条，那一张图就会复发对应的老 bug。判断这笔交易划不划算，
    唯一的办法是出图看——别拿"以前修过"当作现在也不会复发的理由。

    改写失败（LLM 报错/回复过短/未配置）时**静默退回事实清单直接出图**，
    与 _generate_overview_sheet_b64 的 fail-open 纪律一致：宁可出一张少了
    做法指导的图，也不能让参照图这一步拖垮整条生成链。
    """
    facts = _build_overview_sheet_facts(
        design_brief, datamodel,
        theme_id=theme_id, device=device, generated_theme=generated_theme,
    )
    return _refine_sheet_prompt_via_llm(facts, device=device) or facts


def _generate_reference_image_b64(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """生图当参照——加分项，不是必需项。未配置 IMAGE_API_KEY 或生图失败都
    静默降级为 None，绝不能让这一步拖垮 FreeformInsight 主生成路径。图片
    只在本次调用内临时使用（喂给下面的视觉 LLM 看一眼），不落盘、不进产物、
    不展示给终端用户——它上面的"数字"都是占位假象，不能当真实数据源。
    """
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
    except Exception:
        return None
    try:
        prompt = _build_reference_image_prompt(
            design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
        )
        png_bytes = generate_image_png(prompt, size=_image_size_for_device(device))
    except ImageGenError as exc:
        print(f"[freeform_block] reference image skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[freeform_block] reference image skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _supports_image_content_parts() -> bool:
    """通道支不支持多模态 content parts。

    单独抽出来是因为 get_llm_config 在 generate_freeform_block 里是**函数内
    导入**的（那是为了不让 LLM 配置在模块导入期就被拉起），
    enrich_monitor_page_overviews 用不到那个局部名字。配置读不出来时按
    "不支持"处理——宁可退回纯文字生成，也不要在生图上白等一轮。
    """
    try:
        from sliderule_llm.config import get_llm_config

        return bool(get_llm_config().supports_image_content_parts)
    except Exception:  # noqa: BLE001 — 配置异常不该拖垮主链路
        return False


def _image_generation_configured() -> bool:
    """配没配生图。**这就是首页参照板的开关**——没有单独的环境变量。

    首页参照板可以单独指到另一家服务商（SHEET_ 前缀），缺项时回落到默认那份，
    所以两份任意一份齐全就算配了；判据与 _generate_overview_sheet_b64 真正
    取配置的顺序一致，不能只看默认那份（否则只配了 SHEET_ 的部署会被误判成
    "没配"，一张图都不生，而实际上它是能生的）。

    读不出配置按"没配"处理：宁可退回纯文字设计，也不要在一个注定失败的
    生图请求上串行地白等一分钟。
    """
    try:
        from sliderule_llm.image_client import get_image_gen_config

        return (
            get_image_gen_config("SHEET_") is not None
            or get_image_gen_config() is not None
        )
    except Exception:  # noqa: BLE001 — 配置异常不该拖垮主链路
        return False


def _build_marketing_hero_prompt(design_brief: str, *, device: str = "") -> str:
    orientation = "横向宽画幅" if device != "phone" else "竖向画幅"
    return (
        f"为以下品牌首页生成一张{orientation}的沉浸式主视觉真实摄影素材：\n"
        f"{design_brief}\n\n"
        "画面要清晰展示真实地点、产品或体验本身，主体完整、光线自然、细节可检视，"
        "并在构图一侧保留适量干净空间供界面层叠放标题。不要出现任何文字、数字、"
        "标志、水印、控件、边框、设备外壳或排版稿。不要使用渐变色块、抽象光斑、"
        "朦胧库存照片质感。输出应当是一张可直接作为全宽首屏背景使用的独立图片。"
    )


def _build_marketing_page_prompt(design_brief: str, *, device: str = "") -> str:
    if device == "phone":
        device_label = "手机端"
        composition = "390x844 左右的单列竖屏页面，触控优先，首屏底部露出下一内容区"
    elif device == "tablet":
        device_label = "平板端"
        composition = (
            "1112x834 左右的横屏页面，窄侧栏 + 主任务 + 可折叠旁路详情，"
            "触控优先，不要 1920 工作台密度"
        )
    else:
        device_label = "桌面端"
        composition = "1440x900 左右的宽屏页面，首屏内容有明确水平层次，底部露出下一内容区"
    return (
        f"为以下品牌生成一张{device_label}完整首页视觉稿，而不是一张独立 Hero 素材：\n"
        f"{design_brief}\n\n"
        f"画布与构图：{composition}。画出真实可运行网页的完整页面组合，包括品牌导航、"
        "真实摄影主视觉、可读中文文案、清晰的主要行动按钮，以及与业务直接相关的下一内容区开头。"
        "产品、地点、服务或人物必须清晰可检视，不能只用抽象色块代替。标题、辅助文案、按钮、"
        "图片和后续内容之间的相对尺寸、位置、留白和对齐必须明确，让另一个模型能够逐区还原。"
        "不要套通用后台 KPI 卡片网格，不要把标题或主要体验塞进悬浮卡片，不要画浏览器边框、"
        "设备外壳、水印、设计标注或多个页面拼板。只输出一个设备档的一张完整首页视觉稿。"
    )


def _generate_overview_sheet_b64(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
    marketing_hero: bool = False,
    marketing_page: bool = False,
) -> Optional[str]:
    """生成参照板（默认三区，device 明说 desktop/phone 时两区——见
    _build_overview_sheet_prompt）。跟 _generate_reference_image_b64 一样是
    **加分项**：任何失败都静默返回 None，调用方退回纯文字生成，绝不拖垮主链路。

    尺寸走 _sheet_image_size_for_device()（桌面 2560x1440 / 手机 1440x2560，
    见 _SHEET_DEVICE_IMAGE_SIZE）——这张图上要同时容纳版式和一堆样例，
    小了字就糊。**两边都必须是 16 的倍数**，否则端点直接 400；可用尺寸见
    那张表上方的活体探针记录，别凭直觉改。

    2026-08-06 更正：这段此前写着"传 1792x1024，实收 1672x941"，那是**上上家**
    端点（hello.vangularcode.asia，无论传什么都降档回同一个横版尺寸）的结论。
    当前端点（api.gpt.ge）逐像素认 size，实测传 2560x1440 实收 2560x1440。
    换端点必须整份重测，别把旧结论当常量——这条注释本身就是没重测的产物。

    **首页参照板可以单独指到另一家服务商**（2026-07-30）：配齐
    SHEET_IMAGE_API_URL / SHEET_IMAGE_MODEL / SHEET_IMAGE_API_KEY 三项就走那家，
    缺任意一项自动回落到默认端点、行为与从前逐字节一致。

    为什么只给这一处开这个口子：审查一份第三方技能包的产出时量到，它的图是
    7.3MP 而当时我们只有 1.6MP，观感差距主要来自**端点给的像素档位**，不是
    提示词（同一 prompt 在当时那家端点传 3840x2160 也只回 1672x941）。
    换到认尺寸的端点之后这个缺口自己合上了（现在 2560x1440 = 3.7MP），这个
    口子留着是为了下次再遇到降档端点时不用改代码。
    而这张首页参照板是当前**唯一驱动版式的图**——FreeformInsight 没放开
    （见 experience_block_catalog 那条 generationEnabled:false 与它的哨兵测试），
    单区块参照图只在这张失败时兜底触发。所以把口子开在这一处，等于用最小
    改动面换到那份观感，其余路径完全不动。

    SHEET_IMAGE_SIZE / SHEET_IMAGE_BODY_STYLE / SHEET_IMAGE_ASPECT_RATIO 一并
    可配：有的服务商用 {"size":"1792x1024"}，有的用 {"image_size":"2K",
    "aspect_ratio":"16:9"}，形态由 body_style 决定（见 image_client）。
    """
    try:
        from sliderule_llm.image_client import (
            ImageGenError,
            generate_image_png,
            get_image_gen_config,
        )
    except Exception:
        return None
    try:
        if marketing_page:
            prompt = _build_marketing_page_prompt(design_brief, device=device)
        elif marketing_hero:
            prompt = _build_marketing_hero_prompt(design_brief, device=device)
        else:
            prompt = _build_overview_sheet_prompt(
                design_brief, datamodel, theme_id=theme_id, device=device,
                generated_theme=generated_theme,
            )
        sheet_cfg = get_image_gen_config("SHEET_")
        size = (os.environ.get("SHEET_IMAGE_SIZE") or "").strip() if sheet_cfg else ""
        png_bytes = generate_image_png(
            prompt, cfg=sheet_cfg, size=size or _sheet_image_size_for_device(device)
        )
    except ImageGenError as exc:
        print(f"[freeform_block] overview sheet skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[freeform_block] overview sheet skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _render_preview_screenshot_b64(
    design_dump: dict[str, Any],
    *,
    theme_id: str,
    device: str,
    generated_theme: Optional[dict[str, Any]],
    reference_image_b64: Optional[str] = None,
    landing_media_b64: Optional[str] = None,
) -> Optional[str]:
    """把校验通过的候选内容真实渲染一次、截图，供下面的自我校验步骤跟参考图
    比对（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：生成→截图→
    自己看→改，不是纯一次性生成完就当定稿）。

    这一步这时候还没有真实运行时行数据（generate_freeform_block 只有
    datamodel schema，没有实例数据）——chart 节点会渲染成"暂无数据"占位，
    截图主要用来检验版式/密度/图标使用/留白这些跟真实数据无关的部分，不能
    验证图表配色/形状本身。跟生参考图一样，任何一步不可用/失败都返回 None，
    调用方必须当作"这一步跳过"处理，不能让这个增强项拖垮主生成路径。
    """
    try:
        from services.app_screenshot import (
            capture_freeform_preview_screenshot,
            e2b_screenshot_available,
            local_screenshot_available,
        )
        from services.freeform_preview_store import put_preview
    except Exception:
        return None
    # 2026-08-04：此前这里只认 E2B，而 E2B 要公网域名——本地开发永远拿不到，
    # 这个自检闭环从上线起 got=0 一次没跑过。本机 Playwright 可用就够了。
    if not (local_screenshot_available() or e2b_screenshot_available()):
        return None
    try:
        preview_payload = {
            "freeformContent": design_dump,
            "themeId": theme_id,
            "generatedTheme": generated_theme,
            "device": device or _DEFAULT_DEVICE,
        }
        hero_b64 = landing_media_b64 or reference_image_b64
        if hero_b64:
            preview_payload["_landingHeroB64"] = hero_b64
        pid = put_preview(preview_payload)
        png_bytes = capture_freeform_preview_screenshot(pid)
    except Exception:
        return None
    if not png_bytes:
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def _count_nodes(node: Any) -> int:
    """内容树节点总数。护栏用：修订不该把东西改没了。"""
    if not isinstance(node, dict):
        return 0
    return 1 + sum(_count_nodes(c) for c in (node.get("children") or []))


def _format_axe_evidence(violations: Optional[list]) -> str:
    """把 axe-core 扫出来的确定性违规拼成证据段。

    为什么要单独一段、而且明说「这些是算出来的硬事实」：UICrit（UIST'24）
    实测 zero-shot 让模型自由评审 UI，**只有 13.1% 的意见有效**。对比度、
    alt 文本这类能算准的东西根本不该问模型——axe-core 是 deterministic、
    官方口径「no false positives」，还能给出确切数值（实测算出对比度
    1.65、并指明前景色 #c9c9c9）。把硬事实先摆出来，模型才不至于满屏
    臆测；也让它清楚哪些是必须改、哪些只是它的主观建议。
    """
    if not violations:
        return ""
    lines = ["【已确诊的硬问题（axe-core 自动检测算出来的，不是主观判断，必须修）】"]
    for v in violations[:6]:
        if not isinstance(v, dict):
            continue
        lines.append(
            f"- {v.get('id')}（{v.get('impact') or '未分级'}，{v.get('count') or 0} 处）："
            f"{(v.get('help') or '')[:80]}"
        )
        for s in (v.get("sample") or [])[:1]:
            lines.append(f"    实测：{str(s)[:160]}")
    lines.append("")
    return "\n".join(lines)


def _critique_against_reference(
    design_dump: dict[str, Any],
    *,
    reference_image_b64: str,
    preview_screenshot_b64: str,
    design_brief: str,
    FreeformDesign: type[BaseModel],
    axe_violations: Optional[list] = None,
) -> Optional[dict[str, Any]]:
    """把参考图、真实渲染截图、以及 axe-core 扫出来的确定性违规一起喂给 LLM，
    让它按真实设计评审的维度找问题，并产出一版修订过的完整 JSON。

    ## 为什么不是「让它自由发挥」

    UICrit（UIST'24，google-research-datasets/uicrit）拿 3059 条专业设计师
    批评做过实测：**zero-shot 自由评审只有 13.1% 的意见有效**，失败模式是
    大量臆测、抓不住重点。而这里的修订是**直接采纳**的——放任自由发挥等于
    让一个八成说胡话的评审去改用户的页面。

    所以三条约束照该论文的结论来：
    ① 维度白名单，权重取自那 11328 条批评的实际分布（见 prompt 内注）；
    ② 强制两段式「standard / observed」——这是真实批评的固定结构，
       必须先说出依据的标准，就很难凭空编问题；
    ③ 能算准的（对比度/alt）交给 axe-core，不进模型的主观判断。

    ## 护栏

    只做一轮，不递归再校验修订结果的截图——那样成本会失控。修订结果必须：
    - 过同一套 Pydantic 深校验（原有）
    - **节点数不少于原版**（新增）——防止它"精简"掉真实内容。UICrit 那
      13.1% 的另一面就是它可能自信地删掉不该删的东西。

    任何失败（LLM 报错/JSON 解析失败/校验不过/节点变少）都静默回退到原始
    design_dump——想变好不能反而变坏。
    """
    from sliderule_llm.client import LlmError, call_llm_with_retry

    axe_block = _format_axe_evidence(axe_violations)
    critique_prompt = (
        f"你是资深产品设计评审。设计需求是：{design_brief}\n\n"
        "第一张图是配色/版式参考图（草稿参照，不是真实数据）。第二张图是刚才"
        "生成的结构 JSON 真实渲染出来的样子。\n"
        "【不算问题、不要因此改动】图表显示「暂无数据」占位（此刻还没有真实行"
        "数据，是正常的）。\n\n"
        f"{axe_block}"
        "请只在下面这些维度上找问题——它们来自 UICrit（UIST'24）对 11328 条"
        "真实设计师批评的分布统计，括号里是该类问题在真实评审中的占比：\n"
        "1. 图标与文案是否让人一看就懂（20.6%）：图标含义含糊、标签词不达意\n"
        "2. 视觉层级与主次（13.6%）：最重要的信息没有被突出，或次要信息喧宾夺主\n"
        "3. 可点击元素的可用性（13.0%）：按钮/操作项看起来不像能点，或热区过小\n"
        "4. 一致性（7.5%）：同类元素的字号/圆角/间距/颜色处理不统一\n"
        "5. 字号与字重层级（5.9%）：标题没有明显大于正文，层级靠不住\n"
        "6. 对齐与边界（4.9%）：元素越界、错位、参差不齐\n"
        "7. 留白与密度（3.7%）：过于单薄大片空白，或过于拥挤没有喘息\n\n"
        "**每条意见必须写成两段式**（这是真实设计师批评的固定结构，"
        "写不出「标准」的意见一律不要提）：\n"
        '  standard：这一条依据的设计标准是什么\n'
        '  observed：当前这一版具体哪里违背了它（要能在第二张图上指出来）\n\n'
        "纪律：\n"
        "- 只提你能在第二张图里**看到**的问题，不要臆测看不见的东西\n"
        "- 没把握的不要提。少而准 >> 多而糊\n"
        "- 修订只能在现有结构上调整/补充，**不要删掉已有的卡片、分组或数据绑定**\n"
        "- 其它规则完全不变：安全标签白名单、dataRef 必须指向真实字段、chart 字段格式\n\n"
        "只输出 JSON，两种形态二选一：\n"
        '① 有问题：{"findings":[{"dimension":"层级","standard":"…","observed":"…"}],'
        '"design":{完整修订后的内容树}}\n'
        '② 已经够好：{"findings":[],"design":null}\n'
        "**findings 非空就必须同时给出 design**——把你列出的问题在这份内容树里"
        "实际改掉（调 style 的字号/字重/间距/背景，或补节点），只挑出毛病却不"
        "给修订等于白说一轮。确实无从下手的那条，就别写进 findings。\n"
        "design 必须是完整的内容树（跟输入同结构、可直接替换），不是 diff 片段。"
    )
    convo: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": critique_prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{preview_screenshot_b64}"}},
            ],
        }
    ]
    try:
        result = call_llm_with_retry(
            convo,
            max_attempts=2,
            backoff_ms=2000,
            temperature=0.5,
            max_tokens=default_max_tokens(),
            on_delta=lambda _chunk: None,
        )
    except LlmError as exc:
        # 同上：静默失败会伪装成「评审认为没问题」。实测因此误判过一次
        # ——LLM 压根没配上，却以为是模型说 OK。
        print(f"[freeform_block] 评审 LLM 调用失败，本轮跳过：{str(exc)[:160]}")
        return None

    raw = (result.content or "").strip()
    # 解析每一步都留痕。此前失败是静默 return None，日志里只剩 revised=0，
    # 分不清是「它说没问题」「它说了但输出被截断」还是「解析没认出来」
    # ——排查时只能靠猜（实测因此误判过一次）。
    if not raw:
        print("[freeform_block] 评审无返回（空正文）")
        return None
    if raw.strip('"').strip() == "GOOD":  # 上一版口径，模型偶尔还这么答
        return None
    try:
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        if not text.startswith("{"):
            print(f"[freeform_block] 评审返回不是 JSON：{text[:120]}")
            return None
        payload = json.loads(text)
    except (ValueError, json.JSONDecodeError) as exc:
        # 最常见的是要求「同时给意见和完整树」时输出被 max_tokens 截断
        print(
            f"[freeform_block] 评审 JSON 解析失败（{str(exc)[:60]}）；"
            f"长度 {len(text)}，结尾：…{text[-80:]}"
        )
        return None

    findings = payload.get("findings") if isinstance(payload, dict) else None
    if isinstance(findings, list) and findings:
        # 评审意见留痕。哪怕最后没采纳修订，也要能看到它到底看出了什么——
        # 否则「revised=0」永远分不清是「确实没问题」还是「它根本没在看」。
        for f in findings[:5]:
            if isinstance(f, dict):
                print(
                    f"[freeform_block] 评审意见[{f.get('dimension') or '?'}] "
                    f"标准={str(f.get('standard') or '')[:60]} "
                    f"实况={str(f.get('observed') or '')[:80]}"
                )

    # 新契约 {"findings":[...], "design":{...}}；design 为空即「不用改」
    candidate = payload.get("design") if isinstance(payload, dict) else None
    if candidate is None and isinstance(payload, dict) and "root" in payload:
        candidate = payload  # 兼容老口径：整份树直接顶格返回
    if not isinstance(candidate, dict):
        if isinstance(findings, list) and findings:
            # 提了问题却不给修订 = 白说一轮。prompt 里已明令要求两者同出，
            # 还这样就是模型没照做，留痕出来才知道要不要再拧 prompt。
            print(f"[freeform_block] 评审提了 {len(findings)} 条意见但没给修订，本轮不改")
        return None

    try:
        revised = FreeformDesign.model_validate(candidate)
    except (ValueError, ValidationError) as exc:
        if isinstance(exc, ValidationError) and exc.errors():
            first = exc.errors()[0]
            path = ".".join(str(part) for part in first.get("loc") or ()) or "<root>"
            detail = str(first.get("msg") or str(exc))
            print(f"[freeform_block] 修订未过深校验，保留原版：{path}: {detail}")
        else:
            print(f"[freeform_block] 修订未过深校验，保留原版：{str(exc)[:240]}")
        return None
    revised_dump = revised.model_dump()

    # 护栏：修订不许把内容改少。UICrit 实测的高幻觉率有另一面——模型会
    # 自信地"精简"掉不该删的东西，而这里的修订是直接采纳的。
    before, after = _count_nodes(design_dump.get("root")), _count_nodes(revised_dump.get("root"))
    if after < before:
        print(f"[freeform_block] 修订被拒：节点 {before} → {after}，改少了，保留原版")
        return None
    return revised_dump


def _prune_non_dict_list_items(node: Any) -> Any:
    """递归丢弃 list 里非 dict 的元素——json_repair 修复过程中,原始文本里
    多出来的孤立字符/字符串（真机复现过：一份坏 JSON 结尾多了一个孤立的
    句号 "."）有时会被它当成"数组里的一项"塞进去,而不是当噪声丢掉。这些
    杂质在我们的 schema 里必然是非法值（FreeformNode 只能是 dict），
    下面这道清理只删"不是字典的数组项"这一种确定性的垃圾，不改任何
    看起来像合法节点的内容，不做结构性猜测。"""
    if isinstance(node, dict):
        return {k: _prune_non_dict_list_items(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_prune_non_dict_list_items(x) for x in node if isinstance(x, dict)]
    return node


def _repair_freeform_json_or_none(text: str) -> Optional[dict[str, Any]]:
    """LLM 一次性吐深层嵌套 JSON 时偶发数错括号层数（真机复现：{}/[] 各差
    1、结尾多一个孤立句号，且不是 token 截断——那份输出结尾收得完整）。
    这类"语法错但结构基本对"的输出，用成熟的 json-repair 库机械修一次，
    比重新问一轮 LLM 更快更稳；手搓的"数括号数、线性补全"式修补容易把
    内容拼出语法合法但结构错位的树，不如让一个专门为这个问题写的解析器
    来做。修复失败或者输出形状不对（不是 dict）都返回 None，调用方照旧
    落回原有的 reask 流程——这一步只在能省一轮重问时才生效，不改变任何
    失败路径的行为。"""
    try:
        repaired = json_repair.repair_json(text)
        payload = json.loads(repaired)
    except Exception:  # noqa: BLE001 — 修复库本身的异常不该拖垮已有的 reask 兜底
        return None
    if not isinstance(payload, dict):
        return None
    return _prune_non_dict_list_items(payload)


def _repair_missing_field_refs(node: Any) -> int:
    """给写了 rowsRef 但漏了 fieldRefs 的列表容器，按模板里实际用到的 fieldRef
    把这份声明补上。返回补了几处。

    ## 为什么值得机械补，而不是继续重问

    `rowsRef.fieldRefs 不能为空` 是这条链路上最顽固的一个失败——2026-08-04
    真机连挂三轮、烧掉 192 秒，三轮报的都是同一句（见 _reask_hint 的说明）；
    2026-08-07 又复现一次，三轮全挂在同一句，整页降级回固定骨架。分诊式
    reask 提示已经加过了，还是挡不住：模型写了 entityRef/sortByRef/limit，
    模板里 fieldRef 一个不少，就是不肯把这份字段清单再抄一遍到 fieldRefs 里。

    但正因为"模板里 fieldRef 一个不少"，**模型的意图是完全明确的**：这一行
    要显示的字段就是模板里用到的那些。这不是猜，是把它已经写出来的信息换个
    地方誊一遍——跟 json-repair 补括号是同一类修复（语法/形式错，语义没歧义），
    所以放在同一个位置、按同一条纪律做：能省一轮重问才生效，修不了就原样
    交给校验器照旧报错、照旧 reask，不改变任何失败路径的行为。

    只补**空缺**：已经写了非空 fieldRefs 的一律不碰——那是模型的显式选择
    （比如它想显示的字段比模板里出现的多，留着给 sortByRef 用）。
    """
    fixed = 0
    if isinstance(node, list):
        return sum(_repair_missing_field_refs(item) for item in node)
    if not isinstance(node, dict):
        return 0

    rows_ref = node.get("rowsRef")
    if isinstance(rows_ref, dict) and not rows_ref.get("fieldRefs"):
        used: list[str] = []

        def _collect(n: Any) -> None:
            # 只走这个列表容器自己的模板子树。嵌套的 rowsRef 有自己的字段域，
            # 把它的 fieldRef 收上来会串味（拿 B 实体的字段去声明 A 实体的行）。
            if isinstance(n, list):
                for item in n:
                    _collect(item)
                return
            if not isinstance(n, dict):
                return
            ref = n.get("fieldRef")
            if isinstance(ref, str) and ref and ref not in used:
                used.append(ref)
            for child in n.get("children") or []:
                if isinstance(child, dict) and isinstance(child.get("rowsRef"), dict):
                    continue
                _collect(child)

        for child in node.get("children") or []:
            _collect(child)
        if used:
            rows_ref["fieldRefs"] = used
            fixed += 1

    for child in node.get("children") or []:
        fixed += _repair_missing_field_refs(child)
    return fixed


def _reask_hint(error_text: str) -> str:
    """按**这次真正报的错**给建议，而不是每次都念一遍全部老经验。

    ## 为什么改成分诊

    2026-08-04 真机：一次首页设计连挂三轮、烧掉 192 秒，最后降级回固定骨架。
    三轮报的都是同一句——

        root.children.2.children.1.rowsRef
          Value error, rowsRef.fieldRefs 不能为空

    错误本身回喂得没问题，问题出在紧跟着那段固定的"请仔细检查"：它整段讲的是
    children 形状、tag/style 白名单、以及 dataRef 的 key 名怎么写，**一个字都
    没提 rowsRef**。模型拿到一句正确的报错，后面跟着一大段把它往 dataRef 上引
    的建议——三轮都没改对。

    那段话本身没错，它是 dataRef 时代攒下来的真经验；错在**无差别播放**。
    提示词里每多一句无关的话，真正相关的那句就被冲淡一分——这跟出图那边
    "一长串禁令把'画满'那句冲掉"是同一个毛病（见 _build_reference_image_prompt
    里 2026-07-30 那段注释）。

    ## 分诊口径

    按错误原文里的关键词挑一条建议。认不出来才回落通用清单——**不是每次都发
    通用清单再附加一条**：那等于没分诊。

    新增一类失败模式时，在这里加一条，而不是往通用清单里再堆一句。
    """
    err = error_text or ""
    if "rowsRef" in err or "fieldRef" in err:
        return (
            "这个错跟**逐行内容（rowsRef）**有关，请只检查这几点：\n"
            "· rowsRef 里 fieldRefs 是**必填且不能为空**——先列出这一行要显示的"
            "字段 id，模板里的 fieldRef 才取得到值；只写 entityRef/limit 是不够的。\n"
            "· 模板（rowsRef 节点的 children）里每一个 fieldRef，都必须出现在"
            "同一个 rowsRef 的 fieldRefs 数组里。\n"
            "· entityRef 和所有字段 id 必须是数据模型里真实存在的，不能编。\n"
            "· 这一页如果本来就不需要逐行列表，**直接把这个 rowsRef 节点整个删掉**"
            "比补一个凑数的字段清单好。\n"
        )
    if "dataRef" in err:
        return (
            "这个错跟 **dataRef** 有关：它的 key 只有 entityRef / aggregate / "
            "trendFieldRef / trendGrain 四个，写成 entity / field 之类会被拒；"
            "引用的实体和字段必须真实存在且类型对得上。\n"
        )
    if "chart" in err:
        return (
            "这个错跟 **chart 节点**有关：type 只能是 bar/line/pie/donut，"
            "entityRef / dimensionFieldId 必须真实存在，metric=sum 时必须给 "
            "metricFieldId。\n"
        )
    if "tag" in err or "style" in err or "iconRef" in err:
        return (
            "这个错跟**白名单**有关：tag、style 属性名、iconRef 都只能用允许清单"
            "里的值，清单在上面的说明里，不要用清单外的。\n"
        )
    return (
        "请仔细检查：children 数组每一项必须是完整节点对象（不能是裸字符串）、"
        "tag/style 属性/iconRef 必须在允许的白名单内、引用的实体和字段必须真实"
        "存在且类型对得上。\n"
    )


def generate_freeform_block(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    theme_id: str = "",
    device: str = "",
    generated_theme: Optional[dict[str, Any]] = None,
    max_retries: int = 2,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    use_reference_image: bool = True,
    allow_screenshot_verify: bool = True,
    reference_image_b64: Optional[str] = None,
    landing_media_b64: Optional[str] = None,
    full_page_visual: bool = False,
    reconstruction_prompt: Optional[str] = None,
    chart_colors: Optional[list[str]] = None,
    chart_variant_key: str = "",
) -> dict[str, Any]:
    """生成 + 深校验一个 FreeformInsight 区块的内容树。校验失败时把「上次
    输出 + 具体报错」拼回消息重问（跟 structured_llm_json 同一套 reask 语义，
    这里额外插入 Pydantic 深校验，不只是 shape 校验）。重试耗尽抛
    FreeformGenerationError，调用方应把这个区块降级/拿掉，不能让它拖垮
    整个应用发布。

    theme_id/device：这个区块最终会落进真实运行的固定壳里（哪套身份主题的
    侧边栏/顶栏、哪种设备容器），生图和结构生成两处 prompt 都要照这两条线
    走，否则配色会跟真实壳脱节、版式也不知道自己是塞进桌面宽内容区还是手机
    窄内容区。留空按 azure/desktop 兜底，不是必填——老调用方不传也不炸。

    generated_theme：如果这个 app 的身份主题是 identity_theme_gen.py 生图
    生成的（不是 8 预设之一），把那份完整主题对象传进来，优先级高于
    theme_id——否则 FreeformInsight 的配色还是照着 8 预设走，跟侧边栏/顶栏
    真实用的自定义主题对不上。

    use_reference_image=True（默认）时先生一张干净原型图当视觉参照，喂给
    视觉 LLM 一起看（需要网关声明 LLM_SUPPORTS_IMAGE_CONTENT_PARTS=1，未声明
    或生图不可用时自动降级为纯文字生成，行为与加这段之前完全一致）。

    max_tokens 缺省走全局 `default_max_tokens()`。这里的写死值一路 7000 →
    10000 → 14000，**每一次都是被真实截断推上去的**，从来没有一次是预判对的：
    10000 那次是加了视觉参照（模型描述更细、节点数变多）；14000 那次是加了
    blockRef（可嵌积木清单进 prompt、逐行内容清单进 brief，输出又长一截，
    实测在 6580 字符处被切断、三次重试全挂在同一个位置）；再往后换了推理模型，
    14000 又被思考 token 整个吃光，正文一个字没有、首页设计整段失败。
    这条追赶曲线就是"预算不该写死"的证据本身，所以不再猜，交给全局那一个。
    截断表现为 "invalid JSON: Expecting ',' delimiter"——不是模型写错了 JSON，
    是话没说完。
    """
    design_brief = (design_brief or "").strip()
    if not design_brief:
        raise FreeformGenerationError("designBrief is empty")

    from sliderule_llm.client import LlmError, call_llm_with_retry
    from sliderule_llm.config import get_llm_config

    FreeformDesign = build_freeform_models(datamodel)
    prompt_text = build_freeform_prompt(
        design_brief, datamodel, theme_id=theme_id, device=device,
        generated_theme=generated_theme, chart_colors=chart_colors,
        chart_variant_key=chart_variant_key,
    )
    if reconstruction_prompt:
        prompt_text += (
            "\n\n下面是从参考图独立解析并通过结构校验的页面还原契约。"
            "它约束视觉区域、相对几何和组件映射；业务数据仍只允许使用上面的"
            "DataModel 与合法 dataRef/rowsRef：\n"
            + reconstruction_prompt
        )
    if full_page_visual:
        prompt_text += (
            "\n\n这是营销首页的完整页面设计，不是嵌在后台壳里的单张卡片。根节点拥有整张"
            "营销首页的内容结构；参考图里可见的品牌导航、主视觉、可读文案、主要行动和"
            "后续内容区都要还原。不要生成浏览器边框或设备外壳。"
        )

    # 调用方可以把现成的参照图传进来（reference_image_b64）——总览页就是这么用的：
    # 唯一设备档复用首页参照图；没传时区块生成器才自己补一张。
    if reference_image_b64 is None and use_reference_image and get_llm_config().supports_image_content_parts:
        with _enrich_stage("block.refimage", device=device or "unspecified") as _st:
            reference_image_b64 = _generate_reference_image_b64(
                design_brief, datamodel, theme_id=theme_id, device=device, generated_theme=generated_theme
            )
            _st["got"] = 1 if reference_image_b64 else 0

    if reference_image_b64:
        shell_note = (
            "\n注意：这是一张完整营销首页视觉稿。页面内容从品牌导航开始，参考图里"
            "可见的所有主要区域都归你设计；只排除浏览器边框和设备外壳。"
            if full_page_visual
            else "\n注意：侧边栏、顶栏、搜索框、用户头像这些外壳组件由运行时另外"
            "渲染，不归你设计——不要在你的内容树里搭这些，从内容区第一张卡片开始画。"
        )
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是这个设计需求的参考效果图：版式布局、配色克制程度、"
                "留白节奏照着这张图的风格来。但图上任何看起来像数字/统计的内容都只是"
                "占位假象，绝不能照抄或参考它的具体数值——真实数字仍然只能来自上面给出的"
                "数据模型，并挂 dataRef。"
                # 2026-07-30：参照图**不画外壳**（试过画、又撤回，见
                # _build_overview_sheet_prompt 那条注释）。所以这里不需要"外壳是
                # 背景"那句解释；但"别自己搭外壳"这条禁令保留——它防的是设计 LLM
                # 自作主张在内容区里加一套导航，跟参照图画不画壳无关。
                + shell_note,
            },
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
        ]
    else:
        first_content = prompt_text

    convo: list[dict[str, Any]] = [{"role": "user", "content": first_content}]
    last_error = "unknown"
    for _attempt in range(max_retries + 1):
        try:
            result = call_llm_with_retry(
                convo,
                max_attempts=2,
                backoff_ms=2000,
                temperature=temperature,
                max_tokens=max_tokens,
                # 推理档位不在这里定。这条路是全链路最吃思考的一段（七层深、带严格
                # 契约的节点树，全局 low 时实测 3 次尝试全挂在 `tag Field required`），
                # 但正因为它最吃思考，才**不该**由代码写死一个档位盖住 .env——
                # 那是"分路值反向咬人"的形态，理由见 config.py 那块墓碑。
                on_delta=lambda _chunk: None,  # 强制流式，免疫 CF 524（跟 structured_llm_json 同招）
            )
        except LlmError as exc:
            last_error = f"llm error: {str(exc)[:200]}"
            continue

        raw = result.content or ""
        try:
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
            if not text.startswith("{"):
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if not m:
                    raise ValueError("no JSON object found in response")
                text = m.group(0)
            payload = json.loads(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid JSON: {str(exc)[:200]}"
            # 先试机械修复，成功就直接往下走验证——省一轮重问；修不好或者
            # 修完还是校验不过，就照旧落回 reask（见 _repair_freeform_json_or_none
            # 的说明）。
            repaired_payload = _repair_freeform_json_or_none(text)
            if repaired_payload is None:
                convo = convo + [
                    {"role": "assistant", "content": raw[:6000]},
                    {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
                ]
                continue
            print("[freeform_block] JSON repaired mechanically (json-repair), reask 轮次被省下")
            payload = repaired_payload

        # 校验前先把"漏抄 fieldRefs"这一类补上——模型已经在模板里写清了要显示
        # 哪些字段，只是没誊到声明里。理由见 _repair_missing_field_refs。
        try:
            refs_fixed = _repair_missing_field_refs(payload.get("root"))
        except Exception:  # noqa: BLE001 — 修复自身出问题不该顶掉已有的 reask 兜底
            refs_fixed = 0
        if refs_fixed:
            print(
                f"[freeform_block] rowsRef.fieldRefs repaired mechanically: {refs_fixed} 处，"
                "reask 轮次被省下"
            )

        try:
            design = FreeformDesign.model_validate(payload)
        except ValidationError as exc:
            last_error = str(exc)[:1200]
            convo = convo + [
                {"role": "assistant", "content": raw[:6000]},
                {
                    "role": "user",
                    "content": (
                        f"你上次的输出没有通过校验，具体错误：\n{last_error}\n"
                        f"{_reask_hint(last_error)}"
                        "重新输出完整的 JSON，只要一个 JSON 对象。"
                    ),
                },
            ]
            continue

        design_dump = design.model_dump()

        # 配色合规的机械防线（2026-07-29，见 palette_guard.py）。
        #
        # 色板约束此前**只写在 prompt 里**，而且写得很清楚（连"暖橙系不要通篇
        # 上蓝紫"都写了）。真跑一看模型一字不差地干了那句话警告的事：tangerine
        # 主题的应用主色一次没出现、蓝色占 60%、还自己发明了一套绿。参考图给
        # 对了、文字约束给对了，但没有任何一层去查。这里补上。
        #
        # 违规先 reask（跟 Pydantic 校验失败走同一条路，把具体哪几个色、偏了
        # 多少度告诉它）；重试耗尽时**机械纠偏后放行**，绝不因为配色问题抛错
        # ——抛了调用方就回落固定骨架，那正是这一整条链路一直在治的病。
        palette_hint = _theme_palette(theme_id, generated_theme, chart_colors, chart_variant_key)
        palette_list = [
            c
            for c in [palette_hint.get("primary"), *(palette_hint.get("charts") or [])]
            if isinstance(c, str) and c.startswith("#")
        ]
        primary_color = str(palette_hint.get("primary") or "")
        if palette_list and primary_color:
            report = palette_report(
                extract_hex_colors(design_dump), palette_list, primary_color
            )
            if not report.ok:
                is_last = _attempt >= max_retries
                if not is_last:
                    last_error = "palette non-compliance"
                    convo = convo + [
                        {"role": "assistant", "content": raw[:6000]},
                        {
                            "role": "user",
                            "content": report.reask_message(palette_list, primary_color)
                            + "\n其余内容（版式、节点结构、dataRef、chart、rowsRef）保持不变，"
                            "重新输出完整的 JSON，只要一个 JSON 对象。",
                        },
                    ]
                    continue
                repaired, changed = repair_colors(
                    json.dumps(design_dump, ensure_ascii=False), palette_list, primary_color
                )
                if changed:
                    try:
                        design_dump = json.loads(repaired)
                        print(
                            f"[freeform_block] palette repaired mechanically: {changed} color(s) "
                            "snapped to the nearest palette hue"
                        )
                    except json.JSONDecodeError:
                        pass  # 纠偏后解析不了就用原样，配色问题不值得丢掉整份设计
                if not report.primary_ok:
                    print(
                        "[freeform_block] palette warning: primary hue used "
                        f"{report.primary_uses}x vs dominant family {report.dominant_uses}x "
                        "(kept as-is; proportion is a design call, not mechanically repairable)"
                    )

        # 自我校验闭环（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：
        # 生成→截图→自己看→改，不是纯一次性生成完就当定稿）。只在真的生了
        # 参考图时才做——没有参照物就没法判断"够不够密"。这整块包在自己的
        # try/except 里，任何异常（哪怕是我没预料到的 bug）都不能让一次已经
        # 校验通过的生成结果因为这个增强步骤而报废。
        if reference_image_b64 and allow_screenshot_verify:
            try:
                # 埋点：E2B 截图自检。这一段此前**完全测不到**——本地没配
                # SLIDERULE_PUBLIC_APP_URL 时整段不触发，只能拿"沙盒固定开销
                # 实测 29.1s + 代码里的超时上限"夹逼出 29~69s 的区间
                # （审查文档「九、3」）。这条线一上，那个区间就能换成实测值。
                with _enrich_stage("block.screenshot", device=device or "unspecified") as _st:
                    preview_b64 = _render_preview_screenshot_b64(
                        design_dump,
                        theme_id=theme_id,
                        device=device,
                        generated_theme=generated_theme,
                        reference_image_b64=reference_image_b64,
                        landing_media_b64=landing_media_b64,
                    )
                    _st["got"] = 1 if preview_b64 else 0
                if preview_b64:
                    # 截图那一趟顺带扫出来的确定性违规（本机路径才有；E2B 返回空）
                    try:
                        from services.app_screenshot import last_axe_violations

                        _axe = last_axe_violations()
                    except Exception:  # noqa: BLE001 — 拿不到证据不该拖垮评审
                        _axe = []
                    with _enrich_stage("block.critique", device=device or "unspecified") as _st:
                        _st["axe"] = len(_axe)
                        revised_dump = _critique_against_reference(
                            design_dump,
                            reference_image_b64=reference_image_b64,
                            preview_screenshot_b64=preview_b64,
                            design_brief=design_brief,
                            FreeformDesign=FreeformDesign,
                            axe_violations=_axe,
                        )
                        _st["revised"] = 1 if revised_dump is not None else 0
                    if revised_dump is not None:
                        design_dump = revised_dump
            except Exception as exc:  # noqa: BLE001 — 增强步骤绝不能拖垮已校验通过的主结果
                print(f"[freeform_block] self-verify skipped (unexpected): {str(exc)[:160]}")
        return design_dump

    raise FreeformGenerationError(f"exhausted {max_retries + 1} attempts, last error: {last_error}")


def enrich_freeform_blocks(model: dict[str, Any]) -> dict[str, Any]:
    """主模型过 Gate 之后，同一次「生成」体验里紧接着跑的第二段——扫描
    page.blocks 里的 FreeformInsight，逐个生成+校验内容树，写回
    block["freeformContent"]。生成失败（重试耗尽）的区块直接从
    page.blocks 和 page.layout 的槽位引用里一并摘掉，如实降级，不让一个
    装饰性区块的生成失败拖垮整个应用发布（fail-closed 的口径延伸到区块
    级）。原地修改并返回同一个 model，方便调用方链式使用。

    ⚠️ **当前灰度下这个函数在生产路径上不处理任何区块**（2026-08-01 实测）。

    它只认 `type == "FreeformInsight"` 的块，而该类型在
    `experience_block_catalog.json` 里是 `generationEnabled: false`，生成契约
    还把它列进 schema-only 名单明令 "never emit them"
    （`schema_legal.py` 的 `schema_only` 那段）。四条独立证据：
      · 目录里 generationEnabled=false
      · 生成契约明令不许产出
      · 演示域冻结夹具 builtin_domain_models.json 里出现 0 次
      · 离线夹具再生成脚本 enrich_builtin_domain_models.py 压根不调用本函数
    五轮真跑（诊所×3 / 公园×2）里 `[enrich-timing] stage=freeform.total` 恒为
    `ms=0`，一次都没触发。

    **但它不是可以删的死代码**：结构门并不拒绝 `FreeformInsight`
    （`v5_model_gate.py:660-672` 有它的专门校验分支，检查 props.designBrief
    非空），所以这是"提示词层面的禁止"而非"结构上的不可能"——模型万一漏网
    吐出一个，门会放行，这段就会真的执行。

    灰度一旦放开（把目录里那个布尔改成 true），这里立刻恢复工作；届时**必须
    先处理下面那两个预算计数器的并发问题**再谈并行化，见
    docs/enrich-pipeline-parallelization-audit-2026-07-31.md「四、2」。
    """
    # 墙钟埋点在函数内部（理由见 identity_theme_gen.enrich_identity_theme 同处
    # 注释：这条链路有多个入口，埋在调用点则换一个入口就没数）。
    with _enrich_stage("freeform.total"):
        return _enrich_freeform_blocks_inner(model)


def _enrich_freeform_blocks_inner(model: dict[str, Any]) -> dict[str, Any]:
    datamodel = model.get("datamodel") or {}
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    theme_id = str(identity.get("theme") or "").strip()
    from .device_policy import preferred_layout_device

    device = preferred_layout_device(appbundle)
    # identity_theme_gen.enrich_identity_theme 如果已经跑过（在这之前调用），
    # appIdentity.generatedTheme 会有一份自定义主题——FreeformInsight 的配色
    # 要照它走，不能还停在 8 预设，不然侧边栏和内容卡片颜色对不上。
    generated_theme_raw = identity.get("generatedTheme")
    generated_theme = generated_theme_raw if isinstance(generated_theme_raw, dict) else None
    max_ref_images = _env_budget(_ENRICH_MAX_REF_IMAGES_ENV, _ENRICH_MAX_REF_IMAGES_DEFAULT)
    max_screenshot_verify = _env_budget(
        _ENRICH_MAX_SCREENSHOT_VERIFY_ENV, _ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT
    )
    ref_used = 0
    shot_used = 0
    capped_blocks = 0
    for page in (model.get("page") or {}).get("pages") or []:
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            continue
        dropped_ids: set[str] = set()
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "FreeformInsight":
                continue
            # 幂等（2026-07-27 D1）：已有内容树的区块不重生成——精修/回退
            # 时未被指令触及的区块必须原样保留（REFINE prompt 已要求逐字节
            # 保留,这里是第二道保险),否则加一个字段整页设计全部重掷。
            existing_content = block.get("freeformContent")
            if isinstance(existing_content, dict) and existing_content.get("root"):
                continue
            brief = str((block.get("props") or {}).get("designBrief") or "").strip()
            bid = str(block.get("id") or "").strip()
            # 成本预算：参考图/截图自检按"尝试"计费（参考图在 generate 开头
            # 就生成了——失败的区块钱照样花了，必须扣预算；只在成功分支计数
            # 会让网关抖动时笼子完全失效，生图次数退化为区块数×1，终检实测）。
            use_ref = ref_used < max_ref_images
            allow_shot = use_ref and shot_used < max_screenshot_verify
            if use_ref:
                ref_used += 1
            else:
                capped_blocks += 1
            if allow_shot:
                shot_used += 1
            try:
                # 埋点②：区块级生成。当前灰度下 FreeformInsight 的
                # generationEnabled=false，主模型不会产出这类区块，这个循环体
                # 在生产路径上跑不到（审查文档「八、1」）——埋点仍然照放，
                # 灰度一旦放开就直接有数，不用再回来补一次。
                with _enrich_stage("freeform.block", page=str(page.get("id") or ""), block=bid):
                    content = generate_freeform_block(
                        brief, datamodel, theme_id=theme_id, device=device,
                        generated_theme=generated_theme,
                        use_reference_image=use_ref,
                        allow_screenshot_verify=allow_shot,
                    )
                block["freeformContent"] = content
            except FreeformGenerationError as exc:
                print(f"[freeform_block] {page.get('id')}.{bid} generation failed, dropping block: {str(exc)[:200]}")
                if bid:
                    dropped_ids.add(bid)
        if dropped_ids:
            page["blocks"] = [b for b in blocks if str(b.get("id") or "") not in dropped_ids]
            layout = page.get("layout")
            if isinstance(layout, dict):
                for slot_key, refs in list(layout.items()):
                    if isinstance(refs, list):
                        layout[slot_key] = [r for r in refs if r not in dropped_ids]
    if capped_blocks:
        # no silent caps：预算截断必须可见，静默截断会被当成"全覆盖了"。
        print(
            f"[freeform_block] enrich budget hit: {capped_blocks} block(s) generated "
            f"text-only (ref-image cap {max_ref_images}, screenshot cap {max_screenshot_verify}; "
            f"raise {_ENRICH_MAX_REF_IMAGES_ENV} / {_ENRICH_MAX_SCREENSHOT_VERIFY_ENV} to widen)"
        )
    return model


def _marketing_landing_design_brief(
    page: dict[str, Any], datamodel: dict[str, Any], *, audience: str = "design"
) -> str:
    """消费型首页的视觉任务，不借用运营总览的内容与容器假设。"""
    del datamodel
    name = str(page.get("name") or page.get("id") or "首页")
    lines = [
        f"「{name}」是面向访客的品牌与转化首页，不是内部工作台。",
        "首屏必须采用沉浸式首屏主视觉，品牌或产品名作为最醒目的标题，并提供一个明确的主要行动按钮。",
        "首屏在常见桌面和手机视口内仍要露出下一段内容的开头；后续内容围绕真实服务、体验或商品展开。",
        "避免后台卡片阵列、数据分析区、排行榜、活动流水和侧边导航；版式应服务于浏览、理解与转化。",
    ]
    if audience == "design":
        lines.append(
            "主视觉必须使用受控媒体节点 imageRef=landing-hero，并填写准确的 imageAlt；"
            "不要用色块或渐变冒充真实图片。"
        )
    elif audience == "image":
        lines.append(
            "生成一张完整首页视觉稿：必须同时画出真实场景主视觉、可读界面文案、"
            "主要行动按钮和下一内容区开头，让后续设计模型能够按整页结构还原。"
        )
    else:
        lines.append(
            "只生成首页主视觉使用的真实场景摄影素材，不画网页文字、按钮、导航、"
            "浏览器或设备外壳；主体完整，并为界面标题保留干净区域。"
        )
    return "\n".join(lines)


def _monitor_overview_design_brief(
    page: dict[str, Any], datamodel: dict[str, Any], *, audience: str = "design"
) -> str:
    # audience（2026-08-01）：这份 brief 有**两个消费方**，需要的说法不一样。
    #   "design" —— 首页设计 LLM。要 blockRef 的技术形态（type/binding/props
    #                照抄），因为它的产出要能被渲染器认出来。
    #   "image"  —— 参照板生图模型。_build_overview_sheet_facts 把 brief 整段
    #                照抄进出图提示词，而技术形态对它是天书：读到
    #                {"type": "ActivityFeed", "binding": {...}} 它不知道该画一
    #                条时间线；架构图那条"画面里不许出现 JSON/字段id/blockRef
    #                等技术标识"针对的也是这里。给它视觉描述。
    # 此前两边共用一份（技术形态那份），是参照板上一直没有这些积木的原因——
    # 不是生图模型判断"这页不需要"，是它没看懂那段 JSON 在说什么。
    """monitor 页面（首页/运营总览）的总览设计需求文案——不是让 LLM 凭空
    发挥内容范围，而是把这个页面自己已经声明、已经过 Gate 校验的
    stats/charts 当成"必须覆盖的内容清单"喂给它，LLM 只负责这批内容的
    视觉设计（版式/分组/颜色/图标），不负责决定"该不该有"。这样首页既能
    有 FreeformInsight 的设计自由度（不再是每个 app 都长一样的固定网格
    骨架），又不会漂出这个页面本来经过内容质量门校验过的信息架构——真实
    数字仍然要靠 generate_freeform_block 内部的 dataRef 校验兜底，这里只
    提供"画面上该出现哪些卡片"的自然语言线索，不直接摆 entityRef/字段 id
    这种结构化内容，那是 build_freeform_prompt 已经在做的事（完整数据
    模型 + 图表候选枚举），这里重复会互相打架。

    故意不把 rankings/feeds 塞进这份清单：FreeformInsight 的 dataRef 只能
    表达聚合值（count/sum/avg），没有"枚举真实的第 N 行记录"这种能力——
    真机测试过一次，LLM 收到"必须包含排行榜/动态流"的要求后，只能画出
    表头+空表身（没有任何一行数据，因为它没有合法的方式引用具体某一行），
    比留白还难看。排行榜/动态流这类"必须是真实逐行记录"的内容，继续走
    AppRuntimeScreen 里原有的 renderRankingCard/renderFeedCard 动态渲染
    （直接读 state.entities 真实行数据），不归 freeformOverview 管。
    """
    entities = {e.get("id"): e for e in datamodel.get("entities") or [] if e.get("id")}

    def entity_label(entity_id: str) -> str:
        e = entities.get(entity_id) or {}
        return str(e.get("name") or entity_id or "")

    def field_label(qualified: str) -> str:
        entity_id, _, field_id = qualified.partition(".")
        e = entities.get(entity_id) or {}
        for f in e.get("fields") or []:
            if f.get("id") == field_id:
                return str(f.get("name") or field_id)
        return field_id or qualified

    name = page.get("name") or page.get("id") or "总览"
    lines = [f"「{name}」——这个应用打开后看到的首页/运营总览区块。"]
    # 2026-07-28 真跑发现：上面这句话里带了页面名，模型就照着写了个 <h1>「经营监控」，
    # 而外层页卡（AppRuntimeScreen 的 defaultPageContent）本来就以 page.name 当标题，
    # 于是同一个词在一屏里出现三次（面包屑 / 页卡标题 / 你写的 h1）。
    # 这是「容器拥有标题」的惯例问题——ProCard 那类容器组件里，标题归外层，内容
    # 区不再自报家门。模型不知道自己被嵌在一张已有标题的卡片里，得明说。
    lines.append(
        f"注意：你的设计会被嵌进一张**已经有标题「{name}」的卡片**里，"
        "所以不要再写页面级大标题/副标题（不要出现 h1，也不要在最上面重复一遍页面名）——"
        "直接从内容开始画。区块内部每张小卡自己的标题照常写。"
    )

    stats = page.get("stats") or []
    if stats:
        bits = []
        for s in stats:
            metric = str(s.get("metric") or "count")
            if metric == "count":
                metric_desc = f"{entity_label(str(s.get('entity') or ''))}数量"
            else:
                prefix, _, mref = metric.partition(":")
                metric_desc = f"{field_label(mref)}{'总和' if prefix == 'sum' else '平均值'}"
            bits.append(f"{s.get('name') or s.get('id')}（{metric_desc}）")
        lines.append("必须包含的 KPI 统计卡：" + "、".join(bits) + "。")

    charts = page.get("charts") or []
    if charts:
        bits = []
        for c in charts:
            dim = field_label(str(c.get("dimension") or ""))
            metric = str(c.get("metric") or "count")
            metric_desc = "数量分布" if metric == "count" else f"{field_label(metric.partition(':')[2])}总和分布"
            bits.append(f"{c.get('name') or c.get('id')}（按「{dim}」的{metric_desc}，用{c.get('type') or 'bar'}图）")
        lines.append("必须包含的图表：" + "、".join(bits) + "。")

    lines.append(
        "这份清单是这个页面已经审核通过的真实内容范围，不能新增清单之外的统计"
        "指标/图表，也不能遗漏清单里的任何一项；具体每一项用什么颜色、图标、"
        "分组方式、卡片大小关系、整体版式，由你自由设计，做出比标准网格骨架"
        "更有设计感的呈现——这正是这次设计要解决的问题。"
    )
    # 这一页已经声明的**逐行内容**：以 blockRef 的形状给出，binding 直接照抄
    # 即可。2026-07-29 第一版只给了一句"适合的话就摆一个"的泛泛引导，真跑
    # 生成出来 blockRef 一个都没有——模型压根不知道这一页有哪些逐行内容可摆
    #（"必须包含"清单里刻意只放了 stats/charts）。给了具体清单和现成绑定，
    # 它才有得挑。仍然是可选项：清单为空就不出这段。
    # 同一份逐行内容常被声明两遍（page.feeds 一份、page.blocks 一份，绑定
    # 逐字段相同只有名字不同——真跑逮到过）。喂给模型之前先按内容指纹去重，
    # 否则等于让它把同一张卡摆两次。指纹口径与前端 page-panel-dedupe.ts 的
    # blockPanelKey 一致：类型 + 实体 + 关键字段，不含 id / 名字 / 条数。
    row_bits: list[str] = []
    plain_bits: list[str] = []  # 不吃 binding 的成品积木（动作面／流程面）
    # 同一批积木给**画图模型**看的说法（2026-08-01）。
    #
    # 这份 brief 会被 _build_overview_sheet_facts 整段照抄进出图提示词，而上面
    # 那两份 bits 是给设计 LLM 的：里头是 {"type": "ActivityFeed", "binding":
    # {...}} 这种 JSON 加一句"照抄即可"。生图模型读到它**无从知道该画一排按钮
    # 还是一条时间线**——参照板上一直没有这些积木，原因就在这里，不是它判断
    # "这一页不需要"。架构图那条"画面里不许出现 JSON/字段id/blockRef 等技术
    # 标识（brief 是照抄进 prompt 的）"说的也是同一件事。
    #
    # 所以按受众分两套说法：技术形态留给设计 LLM，画图模型拿视觉描述。
    visual_bits: list[str] = []
    _VISUAL_SHAPE = {
        "RankedList": "一张 Top-N 排行榜（名次 + 名称 + 数值，纵向若干行）",
        "ActivityFeed": "一列最近动态（按时间倒序的事件条目，每条带时间与状态标记）",
        "QuickActionPanel": "一排常用操作按钮（横向并列的几个按钮）",
        "WorkflowTimeline": "一条横向流程阶段条（若干阶段依次相连，当前阶段高亮）",
    }

    def _visual(block_type: str, title: str = "") -> None:
        shape = _VISUAL_SHAPE.get(block_type)
        if not shape:
            return
        visual_bits.append(f"{shape}{f'——{title}' if title else ''}")
    seen_row_keys: set[str] = set()

    def _take(key: str) -> bool:
        if key in seen_row_keys:
            return False
        seen_row_keys.add(key)
        return True

    # 这一页声明的**逐行内容**（2026-08-03 改）。
    #
    # 以前这里拼的是 blockRef 的 JSON（"照抄这段，把这个积木摆进版式"）。固定
    # 积木那条通道已整体删除——现在设计模型用 rowsRef 自己画逐行内容，所以这里
    # 改成用**业务语言**描述"这一页有哪些一行一行的东西、数据从哪来"，具体长
    # 什么样由模型按参照图决定，我们不再规定形状。
    #
    # 两个受众都要说（对比上一版把两边一起停掉的做法）：
    #   · 设计 LLM 要知道有哪些逐行内容可画、绑哪个实体哪些字段；
    #   · 生图模型要把它们画进参照板——现在渲染端真做得出来了，参照板承诺得起。
    for r in page.get("rankings") or []:
        entity = str(r.get("entity") or "").strip()
        sort_by = str(r.get("sortBy") or "").rpartition(".")[2]
        if not entity or not sort_by:
            continue
        if not _take(f"RankedList|{entity}|{sort_by}"):
            continue
        limit = r.get("limit")
        limit_bit = f"，取前 {limit} 条" if isinstance(limit, int) else ""
        row_bits.append(
            f'{r.get("name") or r.get("id")}（排行榜）：实体 "{entity}"，'
            f'按字段 "{sort_by}" 从高到低排序{limit_bit}'
        )
        _visual("RankedList", str(r.get("name") or ""))
    for f in page.get("feeds") or []:
        entity = str(f.get("entity") or "").strip()
        time_field = str(f.get("timeField") or "").rpartition(".")[2]
        if not entity or not time_field:
            continue
        level = str(f.get("levelField") or "").rpartition(".")[2]
        if not _take(f"ActivityFeed|{entity}|{time_field}|{level}"):
            continue
        level_bit = f'，另有等级字段 "{level}" 可用来上色/加徽标' if level else ""
        row_bits.append(
            f'{f.get("name") or f.get("id")}（最近动态）：实体 "{entity}"，'
            f'按时间字段 "{time_field}" 倒序{level_bit}'
        )
        _visual("ActivityFeed", str(f.get("name") or ""))

    # ── 出图受众：到此为止 ──────────────────────────────────────
    # 下面是给设计 LLM 的安置指导，只对它有意义。给生图模型的是同一批内容的
    # 视觉描述——它才画得出来。
    #
    # 2026-08-03：这批逐行内容以前渲染端做不出来（dataRef 只有聚合值），所以
    # 上一版把给生图模型的这段一并停掉了，理由是"参照板不该承诺渲染兑现不了
    # 的东西"。现在 rowsRef 补上了逐行能力，承诺兑现得了，这段恢复。
    if audience == "image":
        if visual_bits:
            lines.append(
                "画面上除了这些数字与图表，还要画出下面这几块内容（它们是这一页"
                "真实存在的部分，不是装饰）：\n- " + "\n- ".join(visual_bits)
            )
        return "\n".join(lines)

    if row_bits:
        lines.append(
            "这一页还有下面这些**逐行内容**。版式由你按参照图定（几列、多宽、"
            "怎么排都由你），数据用 rowsRef 绑（用法见下方说明）：\n- "
            + "\n- ".join(row_bits)
        )

    # 措辞用祈使式并把代价说明白（2026-08-01 的教训，保留）：仓库里两次栽在
    # 许可式措辞上——schema_legal 记着 "You MAY emit…" 让七个通电区块一个没被
    # 用、连跑三次全是 0。所以这里说"要画就这样画"，不说"你可以考虑画"。
    #
    # 2026-08-03 措辞随机制改：以前这些是"已声明、你不安置就会掉到设计区外面
    # 变成外挂卡"的既成事实，所以要说"不摆的代价"。现在没有外挂卡这条退路了
    # ——整页就是你的设计，参照图上没有的就是没有。于是取舍标准回到唯一该有
    # 的那个：**看参照图**。
    if row_bits:
        names = [b.split("（", 1)[0] for b in row_bits]
        lines.append(
            "关于**逐行内容**（也只关于它）的取舍——上面「必须包含」的 KPI 统计卡"
            "与图表**不在取舍范围内，一项都不能少**：\n"
            f"· 可选的只有这几块：{'、'.join(names)}\n"
            "· 参照图上画了 → 用 rowsRef 画出来，放哪一格、占多宽、长什么样由你定；\n"
            "· 参照图上没有 → **不要画**。不画就是这一页没有这块内容，不会跑到"
            "你的设计外面另起一张卡。\n"
            "按这一页的实际需要选，不必凑齐——但这句话只对逐行内容有效，"
            "KPI 与图表照单全画。"
        )
    return "\n".join(lines)

def _existing_chart_colors(model: dict[str, Any]) -> list[str]:
    """模型里已经有的图表色（幂等用：重跑一遍不该再花一次取色调用）。"""
    identity = ((model.get("appbundle") or {}).get("appIdentity")) or {}
    got = identity.get("chartColors")
    return [c for c in got if isinstance(c, str)] if isinstance(got, list) else []


def _chart_variant_key(model: dict[str, Any]) -> str:
    """账本色序的挑选键——**必须跟前端取的是同一个值**。

    前端用的是 `productName || appName`（app-runtime-schema），所以这里取
    appIdentity.productName。取不到就返回空串，退回旧算法（老行为）而不是编一个
    ——编出来的键会让提示词和真实渲染挑到不同的两套色，比"都用旧的"更难查。
    """
    identity = ((model.get("appbundle") or {}).get("appIdentity")) or {}
    return str(identity.get("productName") or "").strip()


def _write_chart_colors(model: dict[str, Any], colors: list[str]) -> None:
    """把取到的图表色写进 appbundle.appIdentity.chartColors。

    挂在 appIdentity 下而不是新开一个顶层字段：这就是"这个应用长什么样"的一部分，
    跟 theme/icon/nav 同一段；门禁与修复器也已经按段处理这一块（出现即校验、
    非法值清除留痕）。前端 app-runtime-schema 从同一处透传。
    """
    appbundle = model.get("appbundle")
    if not isinstance(appbundle, dict):
        appbundle = {}
        model["appbundle"] = appbundle
    identity = appbundle.get("appIdentity")
    if not isinstance(identity, dict):
        identity = {}
        appbundle["appIdentity"] = identity
    identity["chartColors"] = list(colors)


def enrich_monitor_page_overviews(
    model: dict[str, Any], *, preview_sink: Optional[OverviewPreviewSink] = None
) -> dict[str, Any]:
    """首页/monitor 页面的总览区块也交给 FreeformInsight 设计，不再永远
    套同一套固定骨架（KPI 行 + 图表主列 + 排行/动态流侧列）——那套骨架
    此前是唯一选项，所以所有生成出来的应用首页看起来都一个模子，且列
    高度不一致时还得靠 grid-compact.ts 去补洞。

    跟 enrich_freeform_blocks 同一套 fail-open 纪律：只在这里追加写入
    freeformOverview，从不删除页面已有的 stats/charts/rankings/feeds 声明
    ——AppRuntimeScreen 渲染时优先用 freeformOverview，没有（未声明/生成
    失败）就照旧走固定骨架兜底，两者是"有更好的就用更好的，没有就诚实
    退回骨架"，不是互相替代关系。原地修改并返回同一个 model，方便调用方
    链式使用。

    preview_sink：可选的参照板收集槽（见 app_preview）。传了就把这次画的参照板
    交进去，供落库时当应用中心的卡片缩略图；**不传就完全不收集**——两个脚本
    调用方（fresh_topic_shot / enrich_builtin_domain_models）因此不用改，也不会
    有几 MB 的 base64 混进它们产出的 model.json 和仓库里冻结的域夹具。
    """
    # 墙钟埋点在函数内部（理由见 identity_theme_gen.enrich_identity_theme 同处
    # 注释：这条链路有多个入口，埋在调用点则换一个入口就没数）。
    with _enrich_stage("monitor.total"):
        return _enrich_monitor_page_overviews_inner(model, preview_sink=preview_sink)


def _enrich_monitor_page_overviews_inner(
    model: dict[str, Any], *, preview_sink: Optional[OverviewPreviewSink] = None
) -> dict[str, Any]:
    datamodel = model.get("datamodel") or {}
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    theme_id = str(identity.get("theme") or "").strip()
    from .device_policy import preferred_layout_device

    device = preferred_layout_device(appbundle)
    # 哪一页代表这个应用：落地页那张参照板就是用户点开应用第一眼看到的画面，
    # 也就是卡片该显示的东西（见 OverviewPreviewSink.offer 的取舍规则）。
    landing_ref = str(appbundle.get("landingPageRef") or "").strip()
    generated_theme_raw = identity.get("generatedTheme")
    generated_theme = generated_theme_raw if isinstance(generated_theme_raw, dict) else None

    # 生图只给**首页**一张（2026-08-03，用户裁决）。
    #
    # 之前是"每个 monitor/dashboard 页各一张，上限 4 张"，再加主题那张。实测
    # 单张 60~85s 且串行，而真正被用到的只有落地页那张——它同时是应用中心
    # 卡片显示的画面（见 OverviewPreviewSink.offer）。其余页拿到参照板的收益
    # 远不抵那一分多钟。
    #
    # 开关就是**有没有配生图 key**，不再引入新的环境变量：配了就首页这一张，
    # 没配就一张都不生（整页退回纯文字设计，与从前"未配生图"时逐字节一致）。
    # 少一个旋钮少一处"文档说关了其实没关干净"的机会——这条链路已经踩过
    # 一次那个坑（主题图曾经不读成本笼子，设 0 之后照生，白等 685s）。
    sheet_enabled = _image_generation_configured() and _supports_image_content_parts()
    max_screenshot_verify = _env_budget(
        _ENRICH_MAX_SCREENSHOT_VERIFY_ENV, _ENRICH_MAX_SCREENSHOT_VERIFY_DEFAULT
    )
    shot_used = 0
    sheet_used = 0
    pages = (model.get("page") or {}).get("pages") or []
    eligible_pages = [
        page
        for page in pages
        if (
            str(page.get("presentation") or "").strip() == "marketing-landing"
            or (
                str(page.get("kind") or "").strip() in ("monitor", "dashboard")
                and (bool(page.get("stats")) or bool(page.get("charts")))
            )
        )
        and not (
            isinstance(page.get("freeformOverview"), dict)
            and page["freeformOverview"].get("root")
        )
    ]
    sync_page = next(
        (page for page in eligible_pages if str(page.get("id") or "") == landing_ref),
        eligible_pages[0] if eligible_pages else None,
    )
    sync_page_id = str((sync_page or {}).get("id") or "")

    # 一个够格的页都没有 —— 说清楚，别默不作声（2026-08-06）。
    #
    # 实测撞到：一个手机端私教应用，4 个页面全是 calendar/workbench/kanban，
    # stats 与 charts 全为 0，于是 eligible_pages 是空的，这个函数**一声不吭
    # 直接返回**。表现是"这个应用就是没有设计"，日志里连一行都没有——比
    # 生成失败还难查，因为失败至少会留个 failed 状态。
    #
    # 为什么不干脆放宽资格：这些页面本来就没有可聚合的内容（stats/charts 全空），
    # 硬给它设计一版总览等于让模型**发明数据**。这条链路的纪律是不发明——
    # 所以正确的做法是把"为什么没有"讲出来，而不是硬凑一个出来。
    #
    # 只打日志，**不往页面上写状态标记**。
    #
    # 本来想顺手标一个 freeformOverviewStatus="not_eligible"，查下来放弃了：
    # 前端一个地方都没读这个字段（已有的 ready/deferred/failed 同样没人读），
    # 所以标记带不来任何用户可见的好处；而它会把一个字段写进**已经过门禁的
    # 模型**里，打破 test_v5_llm_generate_gate 那条"modelSection 等于门禁批准
    # 的原样产出"的不变量。为一个没人读的字段破坏一条真不变量，不划算。
    # 哪天前端要显示"这个应用没有可做总览的页"，再连着 UI 一起加。
    if not eligible_pages:
        kinds = ",".join(sorted({str(p.get("kind") or "?") for p in pages})) or "(无页面)"
        print(
            f"[freeform_block] 没有可做总览的页，本次不生成任何版式设计："
            f"共 {len(pages)} 页（{kinds}），没有一页带 stats/charts，"
            f"也没有 presentation=marketing-landing 的页。"
            f"这不是失败——这个应用确实没有可聚合的内容。"
        )
        return model

    # 真实长尾里首页参照图、取色、版式合计会占 2~6 分钟。运行预算只约束这些
    # fail-open 视觉增强，不中断已经过结构闸的业务模型、权限和流程。
    remaining = remaining_run_budget_seconds()
    design_total = 1
    required_visual_seconds = 150 + (130 * design_total)
    reference_budget_available = remaining is None or remaining >= required_visual_seconds
    if sync_page is not None and remaining is not None and remaining < 130 * design_total:
        sync_page["freeformOverviewStatus"] = "deferred_budget"
        with _enrich_stage(
            "monitor.design",
            page=sync_page_id,
            device=device or "unspecified",
            current=1,
            total=design_total,
        ) as skipped:
            skipped["got"] = 0
            skipped["skippedReason"] = "deadline"
        for page in eligible_pages:
            if page is not sync_page:
                page["freeformOverviewStatus"] = "deferred"
        return model

    for page in pages:
        # 2026-07-27：dashboard 也纳入——此前只认 monitor,LLM 把总览页写成
        # dashboard(prompt 曾反向引导)或夹具用 dashboard 时,设计版式整条
        # 生成不出来,首页恒回固定骨架。渲染端 AppRuntimeScreen 同步放宽。
        is_marketing_landing = (
            str(page.get("presentation") or "").strip() == "marketing-landing"
        )
        if not is_marketing_landing and str(page.get("kind") or "").strip() not in ("monitor", "dashboard"):
            continue
        # 只看 stats/charts——rankings/feeds 不进设计文案（见
        # _monitor_overview_design_brief 的说明），一个页面如果只声明了
        # rankings/feeds、没有 stats/charts，freeformOverview 没有东西可画，
        # 生成了也是空区块，不如不生成，直接走原有固定骨架（那套骨架的
        # renderRankingCard/renderFeedCard 本来就能正确渲染这种页面）。
        has_content = is_marketing_landing or bool(page.get("stats")) or bool(page.get("charts"))
        if not has_content:
            continue
        # 幂等（2026-07-27 D1）：已有总览设计的页不重生成（同上区块级注释）。
        existing_overview = page.get("freeformOverview")
        if isinstance(existing_overview, dict) and existing_overview.get("root"):
            continue
        page_id_now = str(page.get("id") or "")
        if page_id_now != sync_page_id:
            page["freeformOverviewStatus"] = "deferred"
            continue
        page["freeformOverviewStatus"] = "generating"
        brief_builder = (
            _marketing_landing_design_brief if is_marketing_landing else _monitor_overview_design_brief
        )
        brief = brief_builder(page, datamodel)
        # 参照板走**出图受众**那一份：同一批内容，但积木用视觉描述而不是
        # blockRef 的 JSON 形态（见 _monitor_overview_design_brief 的 audience）。
        sheet_brief = brief_builder(page, datamodel, audience="image")
        hero_brief = (
            brief_builder(page, datamodel, audience="hero")
            if is_marketing_landing
            else ""
        )
        # 只有首页那一张（见上面的说明）。
        #
        # 落地页没声明时退回"第一个符合条件的页"——不能因为模型漏填一个字段
        # 就整个应用一张图都没有。按尝试计费：生图失败也算用掉了，否则端点
        # 抖动时这个"一张"会退化成"每页都试一次"。
        is_landing = bool(landing_ref) and page_id_now == landing_ref
        use_ref = sheet_enabled and sheet_used == 0 and reference_budget_available
        allow_shot = use_ref and shot_used < max_screenshot_verify
        if use_ref:
            sheet_used += 1
        if allow_shot:
            shot_used += 1
        # 参照板（只画会真正生成的那几档真实版式），共用一张。分开生的话
        # 各随机各的，拼起来不像一个产品；共用一张，模型看到的是"这些档本来
        # 就该长成一家人"。device 明说 desktop/phone 时参照板也只画那一档
        # （见 _build_overview_sheet_prompt）——不然会让生图模型白画一块
        # 后面根本不会用来生成设计的版式区，还挤占了真正会用的那档的画布
        # 份额。生图失败返回 None，下面照旧退回纯文字生成。
        page_id = str(page.get("id") or "")
        # 埋点①：参照板生图。单张实测 60~85s，是这一段最贵的一步，也是并行化
        # 收益最大的那一处（见审查文档「八、7」第 2 项）——改造前后就靠这条线对比。
        with _enrich_stage(
            "monitor.sheet", page=page_id, device=device or "unspecified", current=1, total=1
        ) as _st:
            landing_media_b64 = None
            if use_ref and is_marketing_landing:
                # 完整视觉稿负责还原，独立 Hero 负责运行时媒体。两个请求互不依赖，
                # 并发发出避免把营销首页生图时长直接翻倍。
                from concurrent.futures import ThreadPoolExecutor

                with ThreadPoolExecutor(max_workers=2) as pool:
                    page_future = pool.submit(
                        _generate_overview_sheet_b64,
                        sheet_brief,
                        datamodel,
                        theme_id=theme_id,
                        device=device,
                        generated_theme=generated_theme,
                        marketing_page=True,
                        marketing_hero=False,
                    )
                    hero_future = pool.submit(
                        _generate_overview_sheet_b64,
                        hero_brief,
                        datamodel,
                        theme_id=theme_id,
                        device=device,
                        generated_theme=generated_theme,
                        marketing_page=False,
                        marketing_hero=True,
                    )
                    sheet_b64 = page_future.result()
                    landing_media_b64 = hero_future.result()
            elif use_ref:
                sheet_b64 = _generate_overview_sheet_b64(
                    sheet_brief,
                    datamodel,
                    theme_id=theme_id,
                    device=device,
                    generated_theme=generated_theme,
                )
            else:
                sheet_b64 = None
            # 跳过（非首页/未配生图/通道不支持图片）和真生了图，耗时天差地别，
            # 光看 ms 会以为"生图很快"，得把这一位记下来才看得懂数据。
            _st["got"] = 1 if sheet_b64 else 0
            _st["mediaGot"] = 1 if landing_media_b64 else 0
        # 这张图排完版式就该丢了——但它同时也正是应用中心那张卡该显示的画面。
        # 调用方给了收集槽就交一份（见 app_preview：**没给槽就什么都不做**，
        # 所以两个脚本调用方不用改也不会被污染）。生图失败传 None 无害，
        # offer 自己会忽略。
        if preview_sink is not None:
            preview_sink.offer(
                page_id,
                landing_media_b64 if is_marketing_landing else sheet_b64,
                is_landing=bool(landing_ref and page_id == landing_ref),
            )
        # 参考图先独立解析成可检查的结构契约，再交给最终页面生成器。此前最终
        # LLM 同时承担看图、理解布局和写 JSON，失败后无法区分是哪一层出了错。
        with _enrich_stage(
            "monitor.reconstruction",
            page=page_id,
            device=device or "unspecified",
            current=1,
            total=1,
        ) as _rst:
            try:
                from .page_reconstruction import analyze_page_reference

                reconstruction = analyze_page_reference(
                    sheet_b64,
                    design_brief=brief,
                    datamodel=datamodel,
                    device=device,
                )
            except Exception as exc:  # noqa: BLE001 - analysis cannot block a valid model
                reconstruction = {
                    "version": "page-reconstruction-v1",
                    "status": "failed",
                    "spec": None,
                    "prompt": "",
                    "diagnostic": f"reconstruction orchestration failed: {str(exc)[:500]}",
                }
            page["pageReconstruction"] = reconstruction
            _rst["got"] = 1 if reconstruction.get("status") == "ready" else 0
            _rst["status"] = str(reconstruction.get("status") or "failed")
        # 顺手把这张图的**配色**也读回来（2026-08-04）。
        #
        # 用户观察："图表的颜色是一样的"。查下来是链路断在这一步：图每个应用
        # 都真的生成了、也真的喂给了视觉模型，但视觉模型只被问了"这一页该怎么
        # 排"，从来没人问过"图上是什么颜色"——那份配色画完就丢了，图表色另走
        # 账本里 8 套预置色序按应用名散列挑一套，而那 8 套是同一条 ramp 的 8 个
        # 旋转，所以摆在一起仍然是"一个调调"。
        #
        # 这里补的就是那一问：图已经在手上，多问一句拿到的是**这个应用自己的**
        # 颜色。放在这个位置是因为 sheet_b64 只在首页那一张上有值（sheet_used
        # 那道闸），一个应用只会取一次色。
        #
        # 取不到/不合格返回 None，什么都不写——前端读不到 chartColors 就回落
        # 账本色序，跟这次改动之前的行为一模一样（fail-open）。
        palette_remaining = remaining_run_budget_seconds()
        if (
            sheet_b64
            and not _existing_chart_colors(model)
            and (palette_remaining is None or palette_remaining >= 160)
        ):
            with _enrich_stage(
                "monitor.palette", page=page_id, device=device or "unspecified", current=1, total=1
            ) as _pst:
                from .sheet_palette import extract_chart_palette

                picked = extract_chart_palette(sheet_b64)
                _pst["got"] = len(picked or ())
            if picked:
                _write_chart_colors(model, picked)
                print(f"[freeform_block] 参照图取色 → 图表色 {picked}")
        elif sheet_b64 and not _existing_chart_colors(model):
            with _enrich_stage(
                "monitor.palette", page=page_id, device=device or "unspecified", current=1, total=1
            ) as skipped:
                skipped["got"] = 0
                skipped["skippedReason"] = "deadline"
        design_remaining = remaining_run_budget_seconds()
        if design_remaining is not None and design_remaining < 130 * design_total:
            page["freeformOverviewStatus"] = "deferred_budget"
            with _enrich_stage(
                "monitor.design",
                page=page_id,
                device=device or "unspecified",
                current=1,
                total=design_total,
            ) as skipped:
                skipped["got"] = 0
                skipped["skippedReason"] = "deadline"
            continue
        try:
            with _enrich_stage(
                "monitor.design",
                page=page_id,
                device=device or "unspecified",
                current=1,
                total=design_total,
            ):
                content = generate_freeform_block(
                    brief, datamodel, theme_id=theme_id, device=device,
                    generated_theme=generated_theme,
                    use_reference_image=use_ref,
                    allow_screenshot_verify=allow_shot,
                    reference_image_b64=sheet_b64,
                    landing_media_b64=landing_media_b64,
                    full_page_visual=is_marketing_landing,
                    reconstruction_prompt=(
                        str(reconstruction.get("prompt") or "")
                        if reconstruction.get("status") == "ready"
                        else None
                    ),
                    # 设计 LLM 拿到的图表色 = 真实会画出来的那几个（上面刚从
                    # 参照图读出来的）。不传的话它会照着账本旧色配色，而 ECharts
                    # 画的是参照图那套——同一页两套颜色。
                    chart_colors=_existing_chart_colors(model) or None,
                    chart_variant_key=_chart_variant_key(model),
                )
            page["freeformOverview"] = content
            page["freeformOverviewStatus"] = "ready"
        except FreeformGenerationError as exc:
            page["freeformOverviewStatus"] = "failed"
            print(
                f"[freeform_block] {page.get('id')} monitor overview generation failed, "
                f"keeping fixed skeleton: {str(exc)[:200]}"
            )
    # no silent caps：一张都没生的时候说清楚是"没配 key"还是"通道不吃图"，
    # 否则现象只是"首页长得比较素"，没人会想到去查配置。
    if not sheet_enabled:
        why = (
            "生图未配置（IMAGE_API_URL / IMAGE_MODEL / IMAGE_API_KEY 需三项齐全）"
            if not _image_generation_configured()
            else "LLM 通道不支持图片输入（LLM_SUPPORTS_IMAGE_CONTENT_PARTS=0）"
        )
        print(f"[freeform_block] 首页参照板已跳过，本次全部走纯文字设计：{why}")
    return model
