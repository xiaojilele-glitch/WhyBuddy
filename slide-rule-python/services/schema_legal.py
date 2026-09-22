"""五系统模型合法域——单一真相源加载器（E40.1）。

背景：此前"什么写法是合法的"记在四处——结构门的常量、修复器的本地拷贝、
生成契约手写的枚举串、客户端渲染器的手抄版。四本账靠人肉对齐，E37 的
根因（charts/stats 的 metric 合法域不对称、修复器不知情）就是漏账的代价。

本模块是唯一入口：五系统枚举账本 `five_system_legal.json` 与体验区块账本
`experience_block_catalog.json` 都从这里加载，四方全部从这里派生——
  - 结构门 v5_model_gate：常量改为从此 import（对外名字不变，老引用零改动）
  - 修复器 v5_model_repair：经门的 re-export 自动跟随
  - 生成契约 v5_llm_generate：_SCHEMA_INSTRUCTION 的枚举段由 enum_str() 渲染
  - 客户端 live-runtime：构建期直接 import 同一 JSON（vite 全仓上下文），
    并有 vitest parity 测试锁死（见 legal-domains parity 测试）
加枚举 = 只改 JSON；哪一方没消费到，parity 测试当场红。

参考：阿里低代码引擎《物料协议》的"一份物料描述、编辑器/渲染器/校验器
共同消费"（docs/specs/material-spec）——同一思想的最小实现。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

_LEGAL_PATH = Path(__file__).resolve().parent / "data" / "five_system_legal.json"
_BLOCK_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "experience_block_catalog.json"

with _LEGAL_PATH.open(encoding="utf-8") as _f:
    _LEGAL: Dict[str, object] = json.load(_f)

with _BLOCK_CATALOG_PATH.open(encoding="utf-8") as _f:
    _BLOCK_CATALOG: Dict[str, object] = json.load(_f)


def _tuple(key: str) -> tuple:
    value = _LEGAL.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"five_system_legal.json 缺失或为空: {key}")
    return tuple(str(v) for v in value)


LEGAL_VERSION: int = int(_LEGAL.get("version", 0))

FIELD_TYPES = _tuple("fieldTypes")
FIELD_TONES = _tuple("fieldTones")
NUMBER_FORMATS = _tuple("numberFormats")
STRING_FORMATS = _tuple("stringFormats")
STAT_FORMATS = _tuple("statFormats")
PAGE_KINDS = _tuple("pageKinds")
PAGE_PRESENTATIONS = _tuple("pagePresentations")
PAGE_SURFACE_TYPES = _tuple("pageSurfaceTypes")
PAGE_SURFACE_DENSITIES = _tuple("pageSurfaceDensities")
CHART_TYPES = _tuple("chartTypes")
METRIC_BARE = _tuple("metricBare")
CHART_METRIC_PREFIXES = _tuple("chartMetricPrefixes")
STAT_METRIC_PREFIXES = _tuple("statMetricPrefixes")
# E40.2 应用身份段：主题/图标/导航形态的封闭枚举
IDENTITY_THEMES = _tuple("identityThemes")
IDENTITY_ICONS = _tuple("identityIcons")
IDENTITY_NAVS = _tuple("identityNavs")
# Step 9：视觉配方封闭集（人工调好的配方，模型只选不自由生成）。
# 配方只管密度/布局/深浅色，不选主色——主色由 identity.theme（8 套）独立决定，
# 两者叠加使用。id/取值来自对一批真实产品原型截图的视觉聚类（2026-07-23 校订，
# 原先 compact-dark/warm-orange/cool-blue/soft-neutral 几个名字实际在挑颜色，
# 和 identity.theme 职责重叠，已废弃改名）。
DESIGN_RECIPES = (
    "default",           # 跟随主题默认密度，不做覆盖
    "spacious-guided",   # 宽松留白、分步引导（AI 工具/向导式产品）
    "compact-dense",     # 紧凑高密度、浅色（数据监控/竞品分析类）
    "content-cards",     # 圆角卡片感更强（内容创作/知识管理类）
    "dark-monitoring",   # 深色 + 紧凑（运维大屏/监控场景）
    "high-contrast",     # 边框加深、字号略增（无障碍场景）
)


def _catalog_tuple(key: str) -> tuple:
    value = _BLOCK_CATALOG.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"experience_block_catalog.json 缺失或为空: {key}")
    return tuple(str(v) for v in value)


def _load_experience_blocks() -> tuple:
    """读取并自检区块目录；坏目录在服务启动时直接失败，不带病进入 Gate。"""
    raw_blocks = _BLOCK_CATALOG.get("blocks")
    if not isinstance(raw_blocks, list) or not raw_blocks:
        raise ValueError("experience_block_catalog.json 缺失或为空: blocks")

    legal_regions = set(_BLOCK_CATALOG.get("pageRegions") or {})
    legal_families = set(_BLOCK_CATALOG.get("blockFamilies") or ())
    legal_data_kinds = set(_catalog_tuple("dataKinds"))
    legal_events = set(_catalog_tuple("eventTypes"))
    legal_field_types = set(_tuple("fieldTypes"))
    blocks: List[Dict[str, Any]] = []
    seen_types: set = set()
    seen_renderers: set = set()
    for index, raw in enumerate(raw_blocks):
        if not isinstance(raw, dict):
            raise ValueError(f"experience_block_catalog.json blocks[{index}] 不是对象")
        block_type = str(raw.get("type") or "").strip()
        renderer_key = str(raw.get("rendererKey") or "").strip()
        if not block_type or not renderer_key:
            raise ValueError(f"experience_block_catalog.json blocks[{index}] 缺 type/rendererKey")
        if block_type in seen_types:
            raise ValueError(f"experience_block_catalog.json 重复区块 type: {block_type}")
        if renderer_key in seen_renderers:
            raise ValueError(f"experience_block_catalog.json 重复 rendererKey: {renderer_key}")
        if not isinstance(raw.get("description"), str) or not str(raw.get("description")).strip():
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 description")
        if not isinstance(raw.get("propsSchema"), dict):
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 propsSchema")
        # rendererStatus = 事实（前端 block-registry.tsx 登记的是真渲染器还是
        # ExistingContentAdapter 惰性占位）；generationEnabled = 灰度决定（准不准
        # 让 LLM 往 page.blocks 里写这个类型）。分两个字段是因为它们会各自独立
        # 变化：渲染器先落地、放开是后一步的决定。
        # regionsRationale（可选，2026-08-01 起；2026-08-08 从 slotsRationale 改名）：
        # 只给"限制不显然"的类型写一句
        # **为什么**。三轮真跑里模型把 WorkflowTimeline 放进 secondary 共 5 次，
        # 是最稳定的一类结构门失败——它按"流程条是辅助信息"的语义直觉摆，而真实
        # 依据是宽度（横向流程条塞不进 1/3 窄栏）。只丢一张 slots 表模型无从
        # 推断，下次照样按直觉猜；本仓库反复验证过措辞/理由决定行为。
        # 放在这里而不是 prompt 文案里：理由与它约束的 allowedRegions 同处一行，
        # 谁改约束都会看见。
        regions_rationale = raw.get("regionsRationale")
        if regions_rationale is not None and (
            not isinstance(regions_rationale, str) or not regions_rationale.strip()
        ):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.regionsRationale 必须是非空字符串（或整个省略）"
            )
        renderer_status = raw.get("rendererStatus")
        if renderer_status not in ("real", "placeholder"):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.rendererStatus 必须是 real/placeholder"
            )
        generation_enabled = raw.get("generationEnabled")
        if not isinstance(generation_enabled, bool):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.generationEnabled 必须是布尔值"
            )
        # 不变式：占位渲染器绝不能放开生成。这正是历史上那条一刀切禁令要
        # 挡的事故——放开了，用户看到的是"区块已登记，内容将在下一阶段接入"
        # 的死卡片。宁可 fail-fast 在启动期，也不要带病进 prompt。
        if generation_enabled and renderer_status != "real":
            raise ValueError(
                f"experience_block_catalog.json {block_type} 放开了生成但渲染器仍是"
                f" {renderer_status}——会渲染成惰性占位卡"
            )
        for key, legal in (
            ("dataKinds", legal_data_kinds),
            ("allowedRegions", legal_regions),
            ("events", legal_events),
        ):
            values = raw.get(key)
            # dataKinds may be empty for action-only blocks (e.g. QuickActionPanel)
            # that require no entity data; events may be empty for blocks with no
            # interactive events yet (e.g. FreeformInsight，静态展示卡)；
            # allowedRegions must always be non-empty.
            if key in ("dataKinds", "events"):
                if not isinstance(values, list):
                    raise ValueError(f"experience_block_catalog.json {block_type}.{key} 缺失或为空")
            else:
                if not isinstance(values, list) or not values:
                    raise ValueError(f"experience_block_catalog.json {block_type}.{key} 缺失或为空")
            unknown = {str(v) for v in values} - legal
            if unknown:
                raise ValueError(
                    f"experience_block_catalog.json {block_type}.{key} 含目录外值: {sorted(unknown)}"
                )
        # family（2026-08-08）：这个区块**能不能单独存在**。
        #
        # 与 capability 是一对：capability 说"我干什么"（filter / action /
        # entityRows…），family 说"我要不要挂在别人身上"。此前只有 capability，
        # 于是模型知道 FilterBar 是 filter，却不知道它离开表格就没有意义。
        #
        # 分法照 nocobase 的 data-blocks / filter-blocks / other-blocks
        # （packages/core/client/src/modules/blocks/），我们把 other 拆成
        # action 与 content，因为"对别人做事"和"纯内容"是两回事。
        family = raw.get("family")
        if family not in legal_families:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.family 必须是 "
                f"{sorted(legal_families)} 之一，现在是 {family!r}"
            )

        # source（可选，2026-08-08 起）：这个区块是照哪个开源项目的哪个文件建的。
        #
        # 用户拍板参照不设限之后，记来源的理由从"合规"换成了**可追溯**：以后
        # 看到某条奇怪的边界处理，能查到它是从哪学来的、当初为什么那么写。
        # `took` 那一栏写的是"学到的是什么"——搬运的真正产出是边界情况，不是
        # 那几行 JSX，所以它是三个字段里最值钱的一个。
        #
        # 校验它，是因为不校验的自由文本三个月后就会退化成一句"参考了 antd"。
        source = raw.get("source")
        if source is not None:
            if not isinstance(source, dict):
                raise ValueError(
                    f"experience_block_catalog.json {block_type}.source 必须是对象（或整个省略）"
                )
            for field in ("repo", "path", "took"):
                value = source.get(field)
                if not isinstance(value, str) or not value.strip():
                    raise ValueError(
                        f"experience_block_catalog.json {block_type}.source.{field} 必须是非空字符串"
                    )

        binding_schema = raw.get("bindingSchema")
        if not isinstance(binding_schema, dict):
            raise ValueError(f"experience_block_catalog.json {block_type} 缺 bindingSchema")
        _validate_binding_schema(block_type, binding_schema, legal_field_types)

        # filter / action 族必须能说出自己作用于谁 —— 否则它就是个装饰。
        #
        # 照 nocobase 的 x-filter-targets（SchemaSettingsConnectDataBlocks.tsx）：
        # 筛选区块不是套在数据区块里面，而是作为兄弟节点、用 uid 显式连过去。
        # 我们此前靠一份页面级的 filterState 隐式连，后果是一页两张表会互相
        # 干扰——这条约束就是来堵它的。
        # 谁必须声明 targets —— 这条判据我改过两次，记下来免得再绕（2026-08-08）：
        #
        #   第一版「filter/action 族一律必须」：把 PageHeader 和 QuickActionPanel
        #     也拖下水了。那两个是**完全不绑 binding** 的区块，契约里明写"不使用
        #     binding"、还有专门的门禁挡"塞了 binding"；加上之后 note 变成自相
        #     矛盾的"不使用 binding；targets 是…"，两条既有用例当场红。
        #   第二版「绑了实体的才必须」：又漏了 FilterBar——它的 entityRef 是
        #     **可选**的（不按实体筛的场景也成立），于是判据放它过去了。而筛选
        #     恰恰是最需要 targets 的那个。
        #
        # 定稿的分法按族分开说，因为两族的语义本来就不同：
        #   filter —— 一律必须。筛选的定义就是"筛某个东西"，没有目标不成立。
        #   action —— 绑实体的才必须。批量审批操作某张表的选中行；页头的"新建"
        #             是页面级动作，不针对任何一张表。
        declared_required = set(binding_schema.get("required") or [])
        needs_targets = family == "filter" or (
            family == "action" and "entityRef" in declared_required
        )
        if needs_targets:
            declared = declared_required | set(binding_schema.get("optional") or [])
            if "targets" not in declared:
                raise ValueError(
                    f"experience_block_catalog.json {block_type} 是 {family} 族"
                    f"{'（且绑实体）' if family == 'action' else ''}，"
                    "bindingSchema 必须声明 targets（作用于哪些区块）"
                )
        seen_types.add(block_type)
        seen_renderers.add(renderer_key)
        blocks.append(json.loads(json.dumps(raw)))
    return tuple(blocks)


def _validate_binding_schema(
    block_type: str, schema: Dict[str, Any], legal_field_types: set
) -> None:
    """bindingSchema 自检：坏账本在服务启动时直接失败，不带病进入 Gate/Prompt。"""
    required = schema.get("required", [])
    optional = schema.get("optional", [])
    if not isinstance(required, list) or not isinstance(optional, list):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.required/optional 必须是数组")
    known_fields = set(required) | set(optional)
    enums = schema.get("enums", {})
    if not isinstance(enums, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums 必须是对象")
    for field, values in enums.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums 引用了未声明字段: {field}")
        if not isinstance(values, list) or not values:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.enums.{field} 缺失或为空")
    entity_field_refs = schema.get("entityFieldRefs", {})
    if not isinstance(entity_field_refs, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs 必须是对象")
    for field, field_type in entity_field_refs.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs 引用了未声明字段: {field}")
        if field_type not in legal_field_types:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefs.{field} "
                f"字段类型 '{field_type}' 不在合法域内"
            )
    # entityFieldRefLists：值是**字段 id 数组**的绑定键（如 ActivityFeed 宽行档
    # 的 detailFieldRefs）。跟 entityFieldRefs 的区别只有两条——值是数组、且不限
    # 定字段类型（明细列展示什么都行，数字/日期/枚举都是合法的一列）。类型收窄
    # 交给 fieldType 可选键，没写就是"任意类型"。
    ref_lists = schema.get("entityFieldRefLists", {})
    if not isinstance(ref_lists, dict):
        raise ValueError(
            f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists 必须是对象"
        )
    for field, spec in ref_lists.items():
        if field not in known_fields:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists "
                f"引用了未声明字段: {field}"
            )
        if not isinstance(spec, dict):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field} 必须是对象"
            )
        max_items = spec.get("maxItems")
        if max_items is not None and (not isinstance(max_items, int) or max_items < 1):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field}"
                ".maxItems 必须是正整数"
            )
        field_type = spec.get("fieldType")
        if field_type is not None and field_type not in legal_field_types:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldRefLists.{field}"
                f".fieldType '{field_type}' 不在合法域内"
            )
    # entityFieldGroups：值是**带标题的字段分组数组**的绑定键。
    #
    #     [{ "title": "仓库管理", "fieldRefs": ["name", "url", "owner"] }, ...]
    #
    # 2026-08-09 批次 5/7 一起要的新形状。此前只有"一串字段"（entityFieldRefLists），
    # 表达不了「这几个字段属于同一段，这一段叫什么」——而分段表单和多级表头**要的
    # 恰恰是那个标题**。拿两个平行数组（titles[] + 每段几个字段）拼是能拼出来，
    # 但那种声明一旦长度对不上就静默错位，模型也更容易写错。
    #
    # 一个形状服务两处：SectionedForm.sections（表单分段）与 DataTable.columnGroups
    # （多级表头）。只加一次校验，两边共用。
    field_groups = schema.get("entityFieldGroups", {})
    if not isinstance(field_groups, dict):
        raise ValueError(
            f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldGroups 必须是对象"
        )
    for field, spec in field_groups.items():
        if field not in known_fields:
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldGroups "
                f"引用了未声明字段: {field}"
            )
        if not isinstance(spec, dict):
            raise ValueError(
                f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldGroups.{field} 必须是对象"
            )
        for key in ("maxGroups", "maxFieldsPerGroup"):
            bound = spec.get(key)
            if bound is not None and (not isinstance(bound, int) or bound < 1):
                raise ValueError(
                    f"experience_block_catalog.json {block_type}.bindingSchema.entityFieldGroups.{field}"
                    f".{key} 必须是正整数"
                )

    ranges = schema.get("ranges", {})
    if not isinstance(ranges, dict):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges 必须是对象")
    for field, bounds in ranges.items():
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges 引用了未声明字段: {field}")
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.ranges.{field} 必须是 [min, max]")
    aggregate_fields = schema.get("aggregateFields", [])
    if not isinstance(aggregate_fields, list):
        raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.aggregateFields 必须是数组")
    for field in aggregate_fields:
        if field not in known_fields:
            raise ValueError(f"experience_block_catalog.json {block_type}.bindingSchema.aggregateFields 引用了未声明字段: {field}")


EXPERIENCE_BLOCK_CATALOG_VERSION: int = int(_BLOCK_CATALOG.get("version", 0))
EXPERIENCE_BLOCK_ALLOWED_REGIONS = tuple(_BLOCK_CATALOG.get("pageRegions") or {})
# 页面区域词汇（2026-08-08 第三轮收编）。
#
# 此前区域语法只有 page_archetypes.py 有，前端 REGION_LAYOUT 是手抄的第二份。
# 收进目录之后两边同读一份：Python 从这里，前端从 vite 的 @experience-blocks。
#
#   PAGE_REGIONS        区域目录：叫什么、摆哪条带、在 pro-blocks 里的出处
#   PAGE_ARCHETYPES_RAW 范式语法：哪个范式有哪些区域、多重、必不必填、收什么
#   PAGE_REGION_BANDS   带的取值域
#
# 拆两张表是因为前者是全局事实（main 永远在正文带），后者按范式各有一套
# （列表页的 main 收 entityRows，结果页的 main 收 outcome）。
PAGE_REGIONS: Dict[str, Dict[str, Any]] = dict(_BLOCK_CATALOG.get("pageRegions") or {})
_REGION_KEYS = tuple(PAGE_REGIONS)
PAGE_ARCHETYPES_RAW: Dict[str, Dict[str, Any]] = dict(
    _BLOCK_CATALOG.get("pageArchetypes") or {}
)
PAGE_REGION_BANDS = _catalog_tuple("pageRegionBands")
#: 区块分族：data 自己取数展示 / filter 只筛别人 / action 只对别人做事 /
#: content 纯内容。与 capability 一对——它说"我干什么"，这个说"我能不能
#: 单独存在"。分法照 nocobase 的 data-blocks / filter-blocks / other-blocks。
BLOCK_FAMILIES = _catalog_tuple("blockFamilies")
EXPERIENCE_BLOCK_DATA_KINDS = _catalog_tuple("dataKinds")
EXPERIENCE_BLOCK_EVENT_TYPES = _catalog_tuple("eventTypes")
# FreeformInsight（2026-07-23）的安全原子积木白名单——Python 深校验、Prompt、
# 前端渲染器共用同一份，见 freeform_block.py / block-registry.tsx。
FREEFORM_ALLOWED_TAGS = _catalog_tuple("freeformAllowedTags")
FREEFORM_ALLOWED_ICON_REFS = _catalog_tuple("freeformAllowedIconRefs")
FREEFORM_ALLOWED_STYLE_PROPS = _catalog_tuple("freeformAllowedStyleProps")
# 图标合法域（2026-07-26 收编）：形状正则 + legacy kebab 别名映射此前在
# freeform_block.py 与前端 block-registry.tsx 各手抄一份、无对账哨兵——
# 目录里的 freeformAllowedIconRefs 早已退化成 prompt 建议清单，真正的合法
# 域漂在两份平行实现里。现在两侧都从目录这两个字段派生，改一处两端同步。
FREEFORM_ICON_NAME_PATTERN: str = str(_BLOCK_CATALOG.get("freeformIconNamePattern") or "")
FREEFORM_LEGACY_ICON_ALIASES: Dict[str, str] = dict(
    _BLOCK_CATALOG.get("freeformLegacyIconAliases") or {}
)
def _load_page_kind_presets(blocks: tuple) -> Dict[str, tuple]:
    """页面形态预设：**每种页面的 2~3 套"已经排好的积木组合"**。

    ## 为什么要有它

    此前给模型的是"13 个积木 + 一句自己组织"。用户的判断（2026-08-07）：
    「首先让 AI 去设计，感觉有点不现实，因为他也搞不出来很好的组件」——
    症结不在积木不够，在于**从零编排**这件事对模型太难，而且每次结果都不一样。

    对照阿里 lowcode-engine 的物料协议，它比我们多的正是这一样：`snippets`
    ——"用户从组件面板拖入组件时会向页面 schema 中插入 snippets 中定义的
    低代码 schema"。也就是**拖进来的不是一个裸组件，是一段排好的片段**。

    这里照这个思路做成页面级的：模型先挑一套预设，再把每个积木绑到真实
    实体/字段上。选型这一步从"发明"降级成"挑选"，而绑定那一步本来就有
    bindingSchema 与门禁把关。

    ## 为什么在启动时自检

    预设是**手写**的，而它引用的每个 (type, region) 都必须同时满足三件事：
    区块放开了生成、这种页面允许它、这个槽位允许它。手写的东西会漂——
    今天改了某个区块的 allowedRegions，明天预设就在推荐一个门禁必拦的组合，
    而模型会照着抄。那种失败很难查：模型"照做了"，却每次都被门禁打回。

    所以坏预设**在服务启动时直接失败**，跟 bindingSchema 自检同一条纪律：
    不带病进入 Prompt。
    """
    raw = _BLOCK_CATALOG.get("pageKindPresets")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("experience_block_catalog.json pageKindPresets 必须是对象")
    legal_kinds = set(PAGE_KINDS)
    out: Dict[str, tuple] = {}
    for kind, presets in raw.items():
        if kind not in legal_kinds:
            raise ValueError(f"pageKindPresets 含目录外页面形态: {kind}")
        if not isinstance(presets, list) or not presets:
            raise ValueError(f"pageKindPresets.{kind} 必须是非空数组")
        seen_ids: set = set()
        for ps in presets:
            pid = str((ps or {}).get("id") or "").strip()
            if not pid:
                raise ValueError(f"pageKindPresets.{kind} 有预设缺 id")
            if pid in seen_ids:
                raise ValueError(f"pageKindPresets.{kind} 重复预设 id: {pid}")
            seen_ids.add(pid)
            for key in ("name", "when"):
                if not str(ps.get(key) or "").strip():
                    raise ValueError(f"pageKindPresets.{kind}.{pid} 缺 {key}")
            items = ps.get("blocks")
            if not isinstance(items, list) or not items:
                raise ValueError(f"pageKindPresets.{kind}.{pid}.blocks 必须是非空数组")
            for it in items:
                problem = block_placement_problem(
                    str((it or {}).get("type") or "").strip(),
                    kind,
                    str((it or {}).get("region") or "").strip(),
                )
                if problem:
                    raise ValueError(f"pageKindPresets.{kind}.{pid}: {problem}")
        out[kind] = tuple(presets)
    return out


def block_placement_problem(
    block_type: str, page_kind: str, region: str
) -> "str | None":
    """「这个区块能不能摆在这种页的这个区域」—— 四条判据，一份实现。

    2026-08-11 从 `_load_page_kind_presets` 里抽出来。抽的理由不是省行数：
    应用级模板骨架（services/app_template.py）要问的是**同一个问题**，而这四条
    判据全都是从目录派生的。各写一份的下场这个仓库刚吃过——`BLOCK_DEFINITIONS.uses`
    就是第二份副本，316 个区块全部与实际不符，最后只能整个删掉。

    返回 None 表示可以摆；返回一句话表示不能，且说清楚为什么。
    """
    entry = EXPERIENCE_BLOCK_BY_TYPE.get(block_type)
    if entry is None:
        return f"引用了未知区块 {block_type}"
    if not entry.get("generationEnabled"):
        return f"推荐了未放开生成的区块 {block_type}——模型照做会被门禁拦下"
    if page_kind not in entry.get("pageKinds", []):
        return (
            f"{block_type} 不允许出现在 {page_kind} 页"
            f"（允许 {entry.get('pageKinds')}）"
        )
    if region not in entry.get("allowedRegions", []):
        return (
            f"{block_type} 不允许放在 {region}"
            f"（允许 {entry.get('allowedRegions')}）"
        )
    return None


def _assert_field_ref_type_ratchet(blocks: tuple) -> None:
    """同一个 `*FieldRef` 名字，在不同区块里被要求成不同类型 —— 只准变少。

    ## 这条闸防的是什么

    2026-08-10 审目录时数出来：356 个区块里，**32 个 FieldRef 名字被要求成
    多种类型**。最刺眼的几条：

        descFieldRef      text  5 / string 21
        priorityFieldRef  enum  7 / number  5
        timeFieldRef      date 37 / number  2
        errorFieldRef     number 2 / text 1 / string 1

    要分清两种成因，它们的处置完全不同：

      · **同义不同型** —— `descFieldRef` 就是"描述"，21 处写 string、5 处写
        text，纯粹随手。这种该统一。
      · **同名不同义** —— `errorFieldRef` 在 metrics 里是**错误数**、在 monitor
        里是**错误信息**；`timeFieldRef` 37 处是时间戳、2 处是**耗时**。这种
        不该统一类型，该给其中一方改名。

    ## 真正导致过闸失败的不是"冲突"，是"稀有类型"

    先澄清一个我自己一开始想错的点：**同名冲突本身不会让闸判错**——闸是按
    区块查该区块声明的类型，两个区块各查各的，不会串。生成提示词也是按区块
    渲染的（`_format_binding_schema` 输出 `descFieldRef(text field)`），
    模型被如实告知过。

    真正的杀手是**要求了模型几乎不产出的类型**。改之前全目录 1029 处类型要求里
    `text` 只有 12 处（1.2%）、`ref` 只有 3 处（0.3%）；模型写描述字段的先验
    压倒性是 `string`，于是每次撞上那 15 个少数派就被拦。线上日志里那条
    `page.pages[case_kanban]…descFieldRef must be a text field (got 'string')`
    就是 `KanbanBoard` 声明了 text 造成的。

    所以这一轮做了两件事：
      ① 那 15 处 `text`/`ref` 全部改成 `string`（运行期同为字符串，渲染器不动），
         过闸失败的那一类直接消失；顺带 32 个冲突降到 27 个。
      ② 剩下的 27 个是"同名不同义"，要逐个改名 + 连带改双端渲染器，工作量与
         风险都不小，且需要逐条判断语义。**不在这一轮做，但必须锁住。**

    ## 为什么是棘轮而不是硬性"一名一型"

    硬性禁止会让 27 个存量当场卡住服务启动；一次性改名又要在没有充分判断的
    情况下动 27 组语义。取 ESLint `--max-warnings` 基线、以及各类 type-coverage
    ratchet 的同款做法：**存量记进基线冻结，新增一律拒绝，基线只准变小**。

    于是：
      · 没在基线里的名字 → 必须单一类型，多一种就启动失败；
      · 在基线里的名字   → 类型集合必须**恰好等于**基线记录，多出一种也失败；
      · 冲突消解掉之后   → 基线里那一项必须删掉，否则同样失败（防止基线变成
        永远不清的垃圾场）。
    """
    baseline_raw = _BLOCK_CATALOG.get("fieldRefTypeConflicts") or {}
    if not isinstance(baseline_raw, dict):
        raise ValueError("experience_block_catalog.json fieldRefTypeConflicts 必须是对象")
    baseline = {str(k): set(v) for k, v in baseline_raw.items()}

    seen: Dict[str, set] = {}
    for block in blocks:
        for field, ftype in (block["bindingSchema"].get("entityFieldRefs") or {}).items():
            seen.setdefault(str(field), set()).add(str(ftype))

    problems: List[str] = []
    for field, types in sorted(seen.items()):
        allowed = baseline.get(field)
        if len(types) == 1:
            if allowed is not None:
                problems.append(
                    f"{field} 已经统一成 {sorted(types)[0]} 了，请把它从 "
                    f"fieldRefTypeConflicts 里删掉（基线只准变小）"
                )
            continue
        if allowed is None:
            problems.append(
                f"{field} 被要求成 {sorted(types)} 多种类型。同义就统一，"
                f"同名不同义就给一方改名——不要往 fieldRefTypeConflicts 里加新条目"
            )
        elif types != allowed:
            problems.append(
                f"{field} 的类型集合从基线 {sorted(allowed)} 变成了 {sorted(types)}"
            )
    for field in sorted(set(baseline) - set(seen)):
        problems.append(f"fieldRefTypeConflicts 里的 {field} 已经没人用了，请删掉")
    if problems:
        raise ValueError(
            "experience_block_catalog.json FieldRef 类型契约回退：\n  - "
            + "\n  - ".join(problems)
        )


# ── 位置效应：为什么目录顺序要紧（2026-08-10 实测，实验开关已撤）─────────────
#
# 曾有个 SLIDERULE_EXP_PROMOTE_BLOCKS 开关把指定区块提到目录最前，用来把"位置"
# 与"措辞 / 内容匹配 / 描述缺失"分开。判定完成、结论落地为
# services/block_narrowing.py 之后开关已删，结论留在这里：
#
#   把原第 279 名的 OnCallScheduleCalendar 挪到第 15 位，同题三趟从 **0/3 变 3/3**。
#   两臂 prompt 字符数完全相同（141,797），类型集合、binding 表、PAGE_KIND_PRESETS
#   逐一比对相同——唯一变量就是顺序。另外三个竞争解释都被单独排除过。
#
#   但位置是**必要条件不是充分条件**：提上来的 16 个只有 4 个真被用过。
#   详见 docs/block-narrowing-eval.md 与 services/block_narrowing.py 头注。
EXPERIENCE_BLOCKS = _load_experience_blocks()
_assert_field_ref_type_ratchet(EXPERIENCE_BLOCKS)
#: type -> 目录条目。`block_placement_problem` 与模板骨架校验共用的索引。
EXPERIENCE_BLOCK_BY_TYPE: Dict[str, Dict[str, Any]] = {
    str(block["type"]): block for block in EXPERIENCE_BLOCKS
}
EXPERIENCE_BLOCK_TYPES = tuple(str(block["type"]) for block in EXPERIENCE_BLOCKS)
EXPERIENCE_BLOCK_RENDERER_KEYS = tuple(
    str(block["rendererKey"]) for block in EXPERIENCE_BLOCKS
)
# type -> bindingSchema；Gate 的 binding 深校验按类型查表用（同一份账本，见 v5_model_gate）。
EXPERIENCE_BLOCK_BINDING_SCHEMAS: Dict[str, Dict[str, Any]] = {
    str(block["type"]): block["bindingSchema"] for block in EXPERIENCE_BLOCKS
}
# type -> allowedRegions；Gate 校验 page.layout 时按类型查表，确认区块落的区域是
# 目录里给它开放的槽位，而不只是"槽位名合法 + 区块 id 存在"（此前 layout 深
# 校验只查这两条，槽位与区块类型的搭配完全没人管，见 Puck DropZone 的
# allow/disallow 思路——目录数据其实早就够用，只是没人拿它去查 layout）。
PAGE_KIND_PRESETS: Dict[str, tuple] = _load_page_kind_presets(EXPERIENCE_BLOCKS)

EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE: Dict[str, tuple] = {
    str(block["type"]): tuple(block["allowedRegions"]) for block in EXPERIENCE_BLOCKS
}

#: type -> pageKinds。「这种区块适合放在哪几种页上」，是 lowcode-engine
#: `nestingRule.parentWhitelist` 那一半，只是父级是"页"不是"容器"。
#:
#: 2026-08-11 之前这份声明**只被选材侧读**（block_assembler 挑候选、
#: block_narrowing 派生预设、pageKindPresets 自检），生成路径上没有任何一处查它
#: ——提示词不说、结构闸不查。于是模型把 MuteTimingSchedule（只允许
#: monitor/dashboard）摆进 workbench 页，没有任何依据知道这不对。
EXPERIENCE_BLOCK_PAGE_KINDS_BY_TYPE: Dict[str, tuple] = {
    str(block["type"]): tuple(block["pageKinds"]) for block in EXPERIENCE_BLOCKS
}

#: 总览页——这两种没有逐行视图。"筛选类在这儿是死控件"等一系列判据都从这条
#: 事实派生。与 scripts/label_block_page_kinds.py 的 OVERVIEW_KINDS、
#: AppRuntimeScreen.tsx 的 OVERVIEW_KINDS 是同一份定义，别各写各的。
_OVERVIEW_PAGE_KINDS: tuple = ("monitor", "dashboard")

#: type -> family。装配器按它判"这个区块能不能单独存在"、要不要 targets。
EXPERIENCE_BLOCK_FAMILY_BY_TYPE = {
    str(block["type"]): str(block["family"]) for block in EXPERIENCE_BLOCKS
}
def enum_str(*keys: str) -> str:
    """把一个或多个枚举键渲染成生成契约用的 "a|b|c" 串（顺序=账本顺序）。"""
    values: List[str] = []
    for key in keys:
        values.extend(_tuple(key))
    return "|".join(values)


def legal_snapshot() -> Dict[str, object]:
    """账本原文快照（测试/审计用，防外部改动内部状态返回深拷贝）。"""
    return json.loads(json.dumps(_LEGAL))


def experience_block_catalog_snapshot() -> Dict[str, object]:
    """体验区块目录原文快照（测试/审计用）。"""
    return json.loads(json.dumps(_BLOCK_CATALOG))


def _format_binding_schema(schema: Dict[str, Any]) -> str:
    """把一个 block 的 bindingSchema 结构渲染成给 LLM 看的一行说明；
    Gate 校验用的是同一份 schema（见 v5_model_gate），改一处两边同步。"""
    required = list(schema.get("required", []))
    optional = list(schema.get("optional", []))
    if not required and not optional:
        # 不能写成裸的 "none"。真跑撞过：prompt 里那行长成
        # `binding=none (不使用 binding；…)`，模型把 "none" 当成**要填的值**，
        # 产出 `"binding": {"entityRef": "none"}`，四个 QuickActionPanel 全中，
        # 门禁报 4 条 entityRef 悬挂。哨兵词长得像值就会被当成值——改成祈使句。
        note = schema.get("note")
        omit = "OMIT — this block takes no binding; do NOT emit a `binding` key at all"
        return f"{omit}. ({note})" if note else omit
    enums = schema.get("enums", {})
    entity_field_refs = schema.get("entityFieldRefs", {})
    ranges = schema.get("ranges", {})
    ref_lists = schema.get("entityFieldRefLists", {})
    field_groups = schema.get("entityFieldGroups", {})
    aggregate_fields = set(schema.get("aggregateFields", []))

    def annotate(field: str) -> str:
        if field in aggregate_fields:
            return f"{field}(count|sum:<fieldId>|avg:<fieldId>)"
        if field in enums:
            return f"{field}({'|'.join(enums[field])})"
        if field in entity_field_refs:
            return f"{field}({entity_field_refs[field]} field)"
        if field in ref_lists:
            spec = ref_lists[field]
            want = spec.get("fieldType")
            cap = spec.get("maxItems")
            bits = [f"{want} fieldId" if want else "fieldId"]
            if cap:
                bits.append(f"max {cap}")
            return f"{field}([{', '.join(bits)}])"
        if field in field_groups:
            spec = field_groups[field]
            bits = ['[{title, fieldRefs:[fieldId]}]']
            if spec.get("maxGroups"):
                bits.append(f"max {spec['maxGroups']} groups")
            if spec.get("maxFieldsPerGroup"):
                bits.append(f"max {spec['maxFieldsPerGroup']} fields each")
            return f"{field}({', '.join(bits)})"
        if field in ranges:
            lo, hi = ranges[field]
            return f"{field}({lo}-{hi})"
        return field

    parts = []
    if required:
        parts.append(f"required={','.join(annotate(f) for f in required)}")
    if optional:
        parts.append(f"optional={','.join(annotate(f) for f in optional)}")
    note = schema.get("note")
    if note:
        parts.append(f"note={note}")
    return "; ".join(parts)


def experience_block_prompt_block(
    blocks: "List[Dict[str, Any]] | None" = None,
    extra_presets: "Dict[str, Any] | None" = None,
) -> str:
    """把目录压成给 LLM 的封闭选材说明；不另写第二份区块清单。

    `blocks`：要注入的通电区块子集**及其顺序**。缺省 = 全量目录（原行为）。
    传子集就是"目录窄化"——由 services/block_narrowing.select_blocks 按题意挑，
    顺序即注入顺序（靠前 = 可达性好）。
    `extra_presets`：按题意派生的额外预设，追加在 authored 的 PROVEN LAYOUTS 之后。

    ⚠️ 窄化只影响**通电区块**那一档。下面 schema-only（渲染器没上线、永不可 emit）
    那份清单仍取全量：它是一条禁令，漏掉一个就等于默许模型去 emit 它。


    ## ⚠️ 实测：这份目录里只有前 ~50 个区块是**可达**的（2026-08-10）

    改这个函数之前先读这一段。它不是一句提醒，是两趟线上真跑量出来的。

    ### 数据

    把线上应用中心 10 个真实应用的模型全拉下来，统计 `page.blocks[].type`：

        10 个应用，共 127 个区块实例 —— 只用到 **17 种**类型（目录 358 个）
        这 17 种在本函数输出的名单里排第几：最小 1，最大 **38**，中位 15
        第 39 名往后的 320 个区块，一次都没出现过

    这有两种解释，当时分不清：(a) 名单太长，模型只读了开头；(b) 前 40 个本来
    就是通用件，后面 318 个是垂直细分的，家谱应用本来就不该用 AlertRuleEditor。

    ### 分辨这两者的那一趟

    专门发了一道**明确属于某个垂直域**的题（告警值班与静默管理），题面逐字
    点名了「静默时段」「按标签路由」「值班表按周排」「升级策略」。目录里恰好
    有名字几乎一模一样的区块：

        第  62 名  AlertSilenceForm        告警静默表单
        第  63 名  AlertRoutingPolicy      告警路由策略
        第  72 名  MuteTimingSchedule      静默时段计划
        第 279 名  OnCallScheduleCalendar  值班日历
        第 328 名  EscalationPolicyPanel   升级策略面板

    结果：6 页 18 个区块 12 种类型，**上面这些一个都没用**，全换成了
    DataTable / RecordFormDialog / ScheduleCalendar 这些前 30 名的通用件。
    用到的 12 种位置是 4~52，最远 **第 52 名**。

    **排除了 (b)**：逐个查过 `block_placement_problem`，这些告警区块在那一趟
    真实生成的 6 个页面上**全都摆得进去**（AlertSilenceForm 有 4 个合法位置，
    EscalationPolicyPanel 有 3 个）。不是契约挡的，是没被选中。

    ### 机制

    本函数的输出结构是：先一句 358 个名字连成的长句（1,864 tokens），
    再是每个区块的详情段落，全长 53,627 tokens。详情段落的位置：

        DataTable               第  5,023 token 处
        AlertSilenceForm        第 17,184
        OnCallScheduleCalendar  第 43,959
        EscalationPolicyPanel   第 48,845

    模型从那句长名单里挑，挑的是它读进去的前几十个。

    ### 结论与后果

    **306 个区块（85%）是死的**：有渲染器、有测试、有契约，每次生成还要花
    5.3 万 token 描述它们，然后从来不被选中。

    继续往目录里加区块只会让它更糟——名单更长、token 更多、模型照样挑前 50。
    **新加的区块生下来就是死的。**

    所以「按题意窄化注入」这件事的性质不是省 token（虽然确实能从 5.3 万降到
    1 万以内），而是**让另外 306 个区块第一次有机会被选中**。省钱是副作用。

    原始数据见 docs/区块可达性-2026-08-10实测.md。

    ## 后续进展：上面这个问题已经在治（2026-08-11）

    上面那段结论「窄化的性质是让另外 306 个区块第一次有机会被选中」已落地为
    services/block_narrowing.py，并于 2026-08-11 翻为**默认开**。实测（两个覆盖域
    各臂 n=6）：对题区块被选中数 0.67 → 3.25（Mann-Whitney 单尾精确 p=0.00004），
    prompt 从 16 万字符降到 5.3 万。原第 328 名的 EscalationPolicyPanel 已能稳定
    进入交付。完整报告见 docs/block-narrowing-eval.md。

    两处需要跟上面的表述对齐：

      · **"306 个是死的"稍有过头。** 后来把 control 臂 10 趟 136 次选中逐一统计，
        来自原名次 >52 的有 **2 次（1.5%）**——是概率随名次陡降，不是硬边界。
        窄化的理由不变（1.5% 对 85% 的错配），但别按"绝对够不到"去设计。
      · **位置是必要条件不是充分条件。** 把对题件提到最前之后，16 个里仍只有 4 个
        真被用过——第二层是 PROVEN LAYOUTS 预设的形状在主导，已由 extra_presets
        这条通道处理（见 block_narrowing.derive_goal_presets）。
    """
    lines = [
        "EXPERIENCE BLOCK CATALOG (closed set):",
    ]
    # 放开名单从目录派生，不在这里手写——历史事故：渲染器 07-22/07-23 陆续
    # 接上了，prompt 里那句"渲染器还没上线，不要输出 page.blocks"却留在原地，
    # 于是 WorkflowTimeline 这类已经能用的区块一次都没被渲染过。现在这句话
    # 由 generationEnabled 决定，改目录即改 prompt，不会再各说各话。
    source = EXPERIENCE_BLOCKS if blocks is None else blocks
    enabled = [b for b in source if b.get("generationEnabled")]
    if enabled:
        # 措辞是祈使式，不是许可式（2026-07-28 实测定的）。此前写的是
        # "You MAY emit page.blocks ... an unnecessary block is worse than none"
        # 外加一句"Use the existing stats/charts/rankings/feeds fields instead"，
        # 通电了七个区块，模型仍然一个都不用——同一目标连跑三次，全是 0。
        # 排除过的其它假设：往 JSON 骨架里补 blocks 键（补了照样 0）、
        # CHANNEL OWNERSHIP 规则挤掉了积木（拿掉也是 0）。只把这两句换成
        # 下面的祈使式，其余一字未动，同目标跑两次得到 9 个 / 8 个积木，
        # 业务页覆盖 3/3、4/4，方案 C 零越界。
        # 关窍在于说清"不用的代价"：模型默认走它熟悉的 stats/charts 老路，
        # 除非明确告诉它空着的业务页是残次交付。
        lines.append(
            "page.blocks is how you compose a page beyond its table. Renderable today: "
            + ", ".join(str(b["type"]) for b in enabled)
            + ". Compose each page with the blocks it needs. A workbench / kanban / "
            "calendar / wizard page that ships with NO blocks renders as a bare table — "
            "that is an incomplete deliverable, not a safe default. Typically 1-3 blocks "
            "per business page."
        )
        # 2026-07-31：monitor 页此前被这条祈使句**漏在外面**——上一句只点名了
        # workbench/kanban/calendar/wizard，加上下面 CHANNEL OWNERSHIP 那条
        # "monitor 页照常声明 stats/charts"，两处合起来读就是"总览页不用积木"。
        # 实测后果：19 个真实页面里 page.blocks 声明数 **0**，其中 4 个 monitor
        # 页一个积木都没有，QuickActionPanel / WorkflowTimeline 这两个
        # generationEnabled=true、rendererStatus=real 的区块从未被生成过。
        #
        # 这直接决定了总览页的骨架形状：喂给 freeformOverview 设计环节的内容
        # 永远是"N 个标量 + M 个分布 + 可选一组逐行记录"这三档，排布几乎被内容
        # 定死。放开这一处，输入的内容类型才可能变，版式才跟着变。
        #
        # 措辞照上一句的教训走**祈使式**：07-28 记过，写成许可式（"You MAY
        # emit…"）时七个通电区块一个都没被用，同目标连跑三次全是 0；换成祈使
        # 式并说清"不用的代价"之后才有产出。所以这里也说清代价。
        # 2026-08-01 追加排除 FilterBar：它在总览页**驱动不了任何东西**。
        # 实测链路：filterState 全仓只有 FilterBarRenderer 自己读（用来显示当前
        # 筛选态），变更经 onFilterChange 进页面级过滤态，只影响页面自有视图
        # （Table/看板/日历，走筛过的 rows）；而积木与 freeform 设计树拿到的是
        # entityRows = state.entities，**未筛的全量**。总览页没有 Table/看板/
        # 日历，于是那条筛选栏按下去什么都不会变。
        # 这也正是 blockRef 白名单一直不收它的理由（test_freeform_blockref 的
        # 用例注释原文："FilterBar 在总览页筛不动东西"）——既然嵌不进设计、
        # 又驱动不了内容，就不该在总览页把它摆出来当选项：模型真的会照单声明
        # （2026-08-01 基线轮，dashboard 页声明了 analytics_filter），结果是
        # 一个按不动的控件掉在设计区外面。
        # 只从推荐清单里拿掉是**不够的**：2026-08-01 实测，把 FilterBar 从
        # monitor_ok 移除后重跑，dashboard 页照样声明了 analytics_filters——
        # 目录里它仍是通电区块，没有任何一句话说总览页不许用。所以下面补一条
        # 显式禁令。四个一起禁（不只 FilterBar）：另外三个此前同样只是"不推荐"
        # 而无硬禁，是同一个洞，只是还没撞上。
        #
        # ── 2026-08-11：把 FilterBar 那条从"一个名字"改成"一条机械判据" ──
        #
        # 上面那句"是同一个洞，只是还没撞上"写对了，只是禁的方式没跟上：按名字
        # 硬编码四个，而 FilterBar 那条的**理由是机械的**——`filterChange` 事件
        # 在总览页够不到任何东西。重新核实了一遍这条链路，比原注释写的还彻底：
        #
        #     AppRuntimeScreen.tsx:812   rows = applyPageFilter(allRows, activePageFilter, …)
        #                                ↑ 只有这一份行被筛过，喂给本页的表/看板/日历
        #     :1922 pageStatDisplay      state.entities[stat.entityId]      ← 未筛
        #     :2913 phoneChartNode       state.entities[chart.entityId]     ← 未筛
        #     :1691 sharedBlockRendererProps.entityRows = state.entities    ← 未筛（注释自己写着"未收窄"）
        #
        # 总览页没有表/看板/日历，KPI、图表、积木、设计树全读未筛全量，所以
        # **任何**发 filterChange 的区块在总览页都是死控件，不只 FilterBar。
        # 所以判据取 **capability == "filter"**，不再点名字。
        #
        # ── 2026-08-11 复核：原注释这里的数字是错的，连带把理由讲窄了 ──
        #
        # 原文写"32 个 filter 区块有 31 个只发 filterChange（HierarchicalCategoryPicker
        # 多发一个 itemSelect）"。真数是 **28/32**，例外有四个不是一个：
        #
        # ── 2026-08-11 再更新：两刀去重之后是 **18/22** ──
        # facetFilterRenderer 那一族 6 个（KubernetesResourceFilter / LogLabelFilter /
        # ReleaseEnvironmentFilter / UserEventFilter / StreamNamespaceFilter /
        # WorkflowExecutionFilter）是同一个工厂、参数只有 testid 和一句中文标题，
        # 已删到只剩 1 个。**例外那四个一个没变**——被删的全是"只发 filterChange"
        # 那一档，所以整族判据不受影响。
        #
        #     SavedViewTabs               filterChange + submitRequest
        #     SavedSearchPanel            filterChange + submitRequest
        #     HierarchicalCategoryPicker  filterChange + itemSelect
        #     ValidatedFormTabs           itemSelect（**一个 filterChange 都不发**）
        #
        # 数字错了会引出错的补救——第一次复核就据此提过"把判据放宽成
        # events⊆{filterChange}，让这 4 个在总览页活下来"。**那是反的**：它们多发的
        # 那两个事件在任何页面上都到不了岸——
        #
        #     · `eventBindings`（事件名→动作 id 的映射）只在
        #       app-runtime-schema.ts:823 被解析，全仓库**没有第二处读它**；
        #     · handleBlockAction（AppRuntimeScreen.tsx:1607）只特判 rowSelect /
        #       editRequest / createRequest，其余一律去 `page.pageActions` 里找
        #       **id 等于事件名**的动作，而动作 id 是模型生成的，不会恰好叫
        #       "submitRequest"。
        #
        # 所以放宽只会把"照样按不动的控件"放回总览页。docs/page-kinds-widening-
        # proposal.md 当初对 SavedSearchPanel 的判断（"删除发 submitRequest，
        # **主动词死了**"）是对的，这里补上机械依据。判据维持整族不变。
        # 这个数由 tests/test_schema_legal_source.py 钉住，别再手写。
        #
        # 另外三个（MetricGrid / TrendChart / DataTable）理由各不相同（重复渲染、
        # 宽度），不是一条机械判据能覆盖的，继续按名字禁。
        _MONITOR_FORBIDDEN_BY_NAME = ("MetricGrid", "TrendChart", "DataTable")

        def _inert_on_overview(b: dict[str, Any]) -> bool:
            """它在总览页上是不是**死控件**（运行时摆上去也不干活）。

            注意这只回答"能不能干活"，不回答"目录允不允许"——后者看 pageKinds，
            是另一条判据，见下面 `_allowed_on_overview`。两者都过了才该推荐。
            """
            return (
                str(b["type"]) in _MONITOR_FORBIDDEN_BY_NAME
                or str(b.get("capability") or "") == "filter"
            )

        # ── 2026-08-11：推荐名单必须先过 pageKinds 这一关 ──────────────────
        #
        # `_inert_on_overview` 只回答"它在总览页上是不是死的"，**不看目录里
        # 那份 pageKinds 声明**。而同一份提示词下面（见「页型限制的规则句」）
        # 刚立了一条 MUST：区块只能出现在 pages= 列出的页型里。两处一夹，
        # 模型会在同一份 prompt 里连着读到三句互斥的话：
        #
        #     - QuickActionPanel: … pages=workbench,wizard        ← 条目自己写着不含总览页
        #     … declare it as a block: QuickActionPanel, …        ← 这里在推荐它上总览页
        #     A block MUST only appear … whose kind is in that list  ← 又禁止这么做
        #
        # 实测规模：323 个推荐里 **134 个**的 pageKinds 不含 monitor/dashboard，
        # 不是零星几个。在这条 MUST 进 prompt 之前这只是"两套判据各说各的"、
        # 没有可见后果（docs/page-kinds-widening-proposal.md 当时记的"零影响"
        # 是对的）；MUST 一进来，它就变成了自相矛盾的指令。
        #
        # 所以推荐名单在这里跟规则句对齐：**只推荐 pageKinds 真的允许总览页的**。
        # 反过来收紧禁令名单是不行的——禁令说的是"运行时死控件"，跟目录声明
        # 是两件事，一个区块可以既没被目录允许、又不是死控件。
        def _allowed_on_overview(b: dict[str, Any]) -> bool:
            return bool(set(b.get("pageKinds") or ()) & set(_OVERVIEW_PAGE_KINDS))

        monitor_ok = [
            str(b["type"])
            for b in enabled
            if not _inert_on_overview(b) and _allowed_on_overview(b)
        ]
        monitor_forbidden_live = [str(b["type"]) for b in enabled if _inert_on_overview(b)]
        if monitor_forbidden_live:
            # 逐条给理由而不是只列名单：本仓库反复验证过措辞决定行为（许可式
            # 让七个通电区块一个都没被用；binding 哨兵词 "none" 被当成值）。
            # 只丢一张禁用表，模型下次照样按语义直觉去猜"这页是不是该有个筛选条"。
            #
            # 筛选那批现在是整族，逐个给理由会把这段撑爆（窄化开着时是几个、
            # 关着时是 22 个；2026-08-11 两刀去重前是 32 个）。所以措辞改成"三个点名 + 筛选整族一句"，
            # **理由一句都不省**——省掉理由这件事本仓库已经付过学费。
            #
            # 理由句必须**跟着名单走**：目录窄化开着时这一批常常只剩筛选类
            # （实测告警值班题：名单里 4 个全是 filter），此时还照抄
            # "MetricGrid and TrendChart would…" 就是在解释一个没出现的名字，
            # 模型读到的是一段对不上号的说明。所以逐段按在场情况拼。
            live = set(monitor_forbidden_live)
            why: list[str] = []
            if {"MetricGrid", "TrendChart"} & live:
                why.append(
                    ("MetricGrid and TrendChart" if {"MetricGrid", "TrendChart"} <= live
                     else ("MetricGrid" if "MetricGrid" in live else "TrendChart"))
                    + " would render the same numbers a second time — an overview's KPIs "
                    "and charts are already declared as page.stats / page.charts and get "
                    "laid out by the design pass."
                )
            if "DataTable" in live:
                why.append(
                    "DataTable needs full width and a second entity to be worth "
                    "anything on an overview."
                )
            if any(str(b.get("capability") or "") == "filter" for b in enabled
                   if str(b["type"]) in live):
                why.append(
                    "EVERY filter block cannot filter ANYTHING on an overview: filter "
                    "state only reaches this page's own table / kanban / calendar views, "
                    "and an overview has none of them — its KPIs, its charts, its blocks "
                    "and its designed layout all read the unfiltered rows, so the control "
                    "would sit there doing nothing. That holds for a saved-view switcher "
                    "and a date-range picker just as much as for a filter bar. Put the "
                    "filter on the business page that actually lists records instead."
                )
            lines.append(
                "On monitor / dashboard pages, NEVER emit these blocks: "
                + ", ".join(monitor_forbidden_live)
                + ". Each is inert there, not merely discouraged. "
                + " ".join(why)
            )
        if monitor_ok:
            lines.append(
                "monitor / dashboard pages are NOT exempt from this. Their stats and "
                "charts answer 'how are the numbers', but an overview whose ONLY "
                "content is numbers is a report, not a workbench — the user opens it "
                "to act. Where this business's overview genuinely leads with something "
                "beyond numbers, declare it as a block: "
                + ", ".join(monitor_ok)
                + ". Pick by what THIS operation actually does first — a panel of the "
                "actions this role starts the day with, the stage bar of the process "
                "the business runs on, a live stream of what just happened, a top-N "
                "that drives a real decision. Declaring none is correct only when the "
                "overview truly is read-only; declaring one you cannot justify from "
                "the domain is worse than none."
            )
        schema_only = [b for b in EXPERIENCE_BLOCKS if not b.get("generationEnabled")]
        if schema_only:
            lines.append(
                "Only these are schema-only (renderer not shipped) — never emit them: "
                + ", ".join(str(b["type"]) for b in schema_only)
                + ". Everything else listed above is live and SHOULD be used where it fits."
            )
    else:
        lines.append(
            "No block type is renderable yet — DO NOT emit page.blocks for production pages. "
            "ALWAYS use the existing stats/charts/rankings/feeds fields instead."
        )
    # ── 页面形态预设（2026-08-07）────────────────────────────────────────
    # 用户的判断："首先让 AI 去设计，感觉有点不现实"。此前给的是一堆散积木
    # 加一句"自己组织"，模型每次都得从零发明一遍排布。这里给出**已经排好的
    # 组合**，选型从"发明"降级成"挑选"。做法照 lowcode-engine 的 snippets
    # （拖进来的不是裸组件，是一段排好的片段），只是做在页面这一层。
    #
    # 措辞仍走本文件反复验证过的那条：**祈使 + 说清不照做的代价**。写成
    # "here are some examples you may consider" 这类许可式，按 07-28 的实测
    # 记录，模型会当没看见。
    #
    # 同时明说"预设是起点不是枷锁"——业务真需要别的组合时照常自己排，
    # 否则会把模型逼进只会抄预设的另一个极端。
    # ⚠️ **别删这一段预设。**（2026-08-10 实测，实验开关已撤）
    #
    # 曾用 SLIDERULE_EXP_OMIT_PROVEN_LAYOUTS 摘掉整段做过对照。结论：它**不是**
    # 区块选材天花板的成因（摘掉后点名区块仍 0/5，最远名次只从 52 挪到 61），
    # 而摘掉的代价很实在——生成慢 **4 倍**（104.9s → 422.7s），并开始长废件
    # （PageHeader 糊在 6 页里的 5 页、一页塞两个 DataTable + 两个 RecordFormDialog）。
    # 它把选型从"发明"降级成"挑选"，省的是真推理时间。
    #
    # 真正的天花板是**位置/可达性**，已由 services/block_narrowing.py 处理。
    if PAGE_KIND_PRESETS:
        lines.append(
            "PROVEN LAYOUTS — start from one of these instead of composing from scratch. "
            "Each has already been checked against the catalog: every block is live, "
            "allowed on that page kind, and allowed in that region. Pick the one whose "
            "'use when' matches THIS page's job, then bind each block to real entities "
            "and fields. Composing your own set is allowed and expected when the "
            "business genuinely needs something else — but an invented layout that "
            "merely re-derives one of these wastes a turn and usually lands in a region "
            "the gate rejects."
        )
        for kind in PAGE_KINDS:
            # authored 那几档在前，按题意派生的追加在后（**只加不减**）。
            # 顺序有意为之：authored 的是人写的、带真实"use when"判断；派生的
            # 是本次目标检索出来的补充。让人写的先说话，模型仍能看到专用件那档。
            presets = list(PAGE_KIND_PRESETS.get(kind) or []) + list(
                (extra_presets or {}).get(kind) or []
            )
            if not presets:
                continue
            for ps in presets:
                combo = " + ".join(
                    f"{it['type']}@{it['region']}" for it in ps["blocks"]
                )
                lines.append(f"  {kind} · {ps['name']}: {combo} — use when {ps['when']}")

    lines.append(
        "Whenever you do emit page.blocks, every block type MUST be one of the catalog entries below."
    )
    # 归属划分（2026-07-28）：KPI/图表在一页里只能由一条路负责，否则同一个指标
    # 会被画两次。总览页的 stats/charts 会被后续增强步骤重新设计成一块整体版式
    # （每个应用长得不一样，是展示面的主角）；业务页没有那一步，走积木更整齐
    # 可预期。渲染层已经硬隔离（写错了也不会画两遍），这里说清楚是为了让模型
    # 一开始就写对通道，而不是靠下游兜。
    lines.append(
        "CHANNEL OWNERSHIP for KPIs and charts — one page, one channel:\n"
        "  - monitor / dashboard pages: declare page.stats and page.charts as usual. "
        "Do NOT emit MetricGrid or TrendChart blocks there; they would duplicate the "
        "same numbers the overview already shows. This ban covers KPI/trend blocks "
        "ONLY — it is not a ban on page.blocks for overview pages (see above: action "
        "panels, stage bars, streams and top-N belong there when the domain leads "
        "with them).\n"
        "  - all other page kinds (workbench / kanban / calendar / wizard): use "
        "MetricGrid / TrendChart blocks when the page needs KPIs or trends, and leave "
        "page.stats / page.charts empty on those pages.\n"
        "  - RankedList / ActivityFeed are not affected by this split; "
        "they may be used on any page kind where they fit.\n"
        # 2026-08-08 这一条整个反过来了。
        #
        # 原文是"每一页都已经自带一张主实体表，**不要**再发 DataTable"。那时候
        # 是真的：桌面档的 workbench/wizard 页整页交给内置 ProTable 骨架。
        #
        # 三步走的第②步把默认翻了：**声明了 blocks 的页面由积木画，内置表格不再
        # 渲染**。旧措辞于是变成了一条有害指令——它教模型别发表格，而现在不发就
        # 真的没有表格了。12 个真实生成的应用、60 个页面，DataTable 出现 0 次，
        # 就是这条措辞的直接后果。
        #
        # 措辞仍走本文件反复验证过的那条：祈使 + 说清不照做的代价。
        "  - DataTable: a page that lists records MUST emit one, bound to the page's "
        "own primary entity. The page no longer renders a table of its own — blocks "
        "own the page now, so a list page without a DataTable is a list page with "
        "nothing to read. (A fallback table is injected when no block shows records, "
        "but it is a safety net, not the design: it cannot be filtered, sorted or "
        "batch-selected by the blocks you placed around it.) Emitting one for a "
        "DIFFERENT entity is also fine and useful (e.g. a supplier table on an "
        "inventory page)."
    )
    # ⚠️ 必须走 `source` 而不是 EXPERIENCE_BLOCKS。第一版漏了这里，后果不是
    #    "省得少"，而是**窄化压根没生效**：名单句收窄了，可下面每个区块的详情段
    #    还是全量 358 条，而 prompt 里明写着"every block type MUST be one of the
    #    catalog entries below"——below 指的就是这些详情段。于是模型照样能挑任何
    #    一个，窄化只剩个换序效果。当时只省了 8% 字符，正是这个漏的信号。
    for block in source:
        # slots 后面紧跟这一类的槽位理由（只有限制不显然的类型才有）。
        # 只给一张 slots 表，模型无从推断"为什么不行"，会按语义直觉去猜——
        # WorkflowTimeline 被摆进 secondary 在三轮真跑里复发 5 次就是这么来的。
        rationale = str(block.get("regionsRationale") or "").strip()
        regions_part = f"regions={','.join(block['allowedRegions'])}"
        if rationale:
            regions_part += f" ({rationale})"
        # `pages=` 是 2026-08-11 补的。目录里每个区块都声明了 pageKinds（这种区块
        # 适合放在哪几种页上），而在这之前**这条从没进过 prompt**：模型只被告知
        # 区域限制，页型限制一个字没提。
        #
        # 实测后果（第一份线上真骨架收割时照出来的）：告警值班那趟里
        # AlertRoutingPolicy 与 MuteTimingSchedule 都声明 pages=monitor,dashboard，
        # 模型把它们摆进了 workbench 页。模型没有任何依据知道这么摆不对——
        # **不是模型马虎，是我们没说。**
        #
        # 这是 lowcode-engine `nestingRule` 里 parentWhitelist 那一半，只是层级更高
        # （父级是"页"而不是"容器"）。它的文件注释举的例子正是这个形状：
        # 「FormField 只能在 Form 容器下，Column 只能在 Table 下」。区域那一半
        # 这个仓库 2026-08-08 已经补过（见 page_assembler「双向约束的另一半」），
        # 页型这一半漏到了现在。
        #
        # ⚠️ 只进 prompt，**没有进结构闸**。因为目录里这份声明本身经不起推敲：
        # 同为 capability=form 的 AlertSilenceForm 允许 workbench、AlertRuleEditor
        # 不允许；而「路由策略管理页」天然就是工作台。全目录 304/358 都允许
        # workbench，这几个被卡住更像随手标窄。拿一条可能标错的规则去硬拒模型，
        # 是把"违规发出去"换成"合规的也发不出去"。先告知、观测，攒够证据再决定
        # 是收紧模型还是放宽目录。
        lines.append(
            f"- {block['type']}: {block['description']} "
            f"data={','.join(block['dataKinds'])}; pages={','.join(block['pageKinds'])}; {regions_part}; "
            f"events={','.join(block['events'])}; "
            f"binding={_format_binding_schema(block['bindingSchema'])}"
        )
    # 页型限制的**规则句**（2026-08-11）。
    #
    # 光在条目里多印一个 `pages=` 字段是不够的——区域限制当初也有条目字段，
    # 照样反复被违反，直到 Step 7 里补上那句点名 PageHeader 的规则句才收住。
    # 措辞照那句的形状：给判据 + 举一个具体的反例，不写"请注意"这类软话。
    #
    # ⚠️ 逃生口（2026-08-11 收窄）：原话是无条件的"改页型去迁就区块"，方向反了
    # 一半。总览页那两种（monitor/dashboard）**不能**用这个逃生口——
    #   · 上面那批禁令说的就是"筛选/KPI 积木在总览页是死控件"，把页改成
    #     workbench 只是把死控件搬到了它能动的页上，但这一页的**职责**没变；
    #   · CHANNEL OWNERSHIP 那段（见下）把 KPI 通道按页型分了工：总览页归
    #     page.stats/charts、业务页归 MetricGrid/TrendChart。为了塞一个区块
    #     把 overview 改判成 workbench，等于顺手把这一页的 KPI 通道也换了，
    #     而模型不会意识到这个连带后果。
    # 所以逃生口限定在"业务页之间互换"，总览页明确要求换区块而不是换页型。
    lines.append(
        "Each block also declares which PAGE KINDS it belongs on (pages=... in its catalog entry). "
        "A block MUST only appear in page.blocks of a page whose kind is in that list — e.g. "
        "MuteTimingSchedule (pages=monitor,dashboard) on a workbench page is a violation, even though "
        "the block renders. When a page's job genuinely needs a block whose pages= excludes that kind, "
        "change the PAGE's kind to one the block allows rather than forcing the block onto the wrong "
        "kind — a page dedicated to managing one config object is usually a workbench, but a page whose "
        "job is watching live state is a monitor. This swap is only ever between the row-view kinds "
        "(workbench / wizard / kanban / calendar). NEVER retype a monitor or dashboard page to fit a "
        "block in: an overview owns its numbers through page.stats and page.charts, and retyping it "
        "silently moves that page onto the other KPI channel. On an overview, pick a block whose "
        "pages= already lists monitor or dashboard instead."
    )
    lines.append(
        "binding.entityRef (when required or provided) MUST match a datamodel entity id exactly; "
        "every other *Ref field in binding is a bare field id scoped to that same entity "
        "(datamodel.entities[entityRef].fields[].id), not an 'entity.field' qualified string."
    )
    lines.append(
        "Pages MAY include an actions array with instances of: "
        "navigate (targetPageRef), openDetail (entityRef), createRecord (entityRef), "
        "updateRecord (entityRef), changeFilter (targetBlockRef), drillDown (targetBlockRef). "
        "Each action MUST have a permissionRef matching an entry in page.actionPermissions. "
        "Blocks MAY include eventBindings mapping event names to action ids defined in the same page."
    )
    # 槽位的**实际形态**（2026-08-01）。此前提示词从头到尾只给槽位**名字**，
    # 从没说过它们渲染成什么样——模型不知道 content 在页面最下面、secondary
    # 只有 1/3 宽，于是只能按名字的字面意思猜（"content 听起来就是放内容的"）。
    # 那一类违规反复复发、只是换主角：WorkflowTimeline→secondary（5 次）、
    # FilterBar→content（2 次）、QuickActionPanel→content（3 次）。
    # 逐块补 slotsRationale 是在治单点，这一句才是治这一类：把判据交给模型，
    # 它才谈得上自己推。数值取自 AppRuntimeScreen 的实际渲染。
    lines.append(
        "What the regions actually look like when rendered (top to bottom): "
        "header / headerExtra / headerContent / filters are full-width rows above "
        "everything, in that order — this is the page header band; "
        "then the page's own data surface (the table, board, calendar or wizard) "
        "takes the main area, giving up the right 1/3 to aside when aside is used; "
        "then metrics / charts / main / supplement render as full-width rows BELOW "
        "that surface; footerBar pins to the very bottom; overlay costs no layout "
        "space at all because it only appears on click. "
        "aside is the ONLY narrow region. Anything the user must see or act on "
        "BEFORE the page's content belongs in the header band — everything else "
        "renders after the very things the user would act on."
    )
    lines.append(
        "Step 7 — Page layout: pages MAY declare a layout object whose OWN KEYS ARE THE REGION NAMES — "
        + "/".join(_REGION_KEYS)
        + " — each mapping to an ordered list of block ids, "
        'exactly like "layout": {"headerExtra": ["kpi_grid"], "main": ["order_table"]}. '
        'Do NOT nest them under a wrapper key: "layout": {"slots": {...}} is WRONG and the whole layout '
        "will be discarded. "
        "Every block id in layout MUST exist in page.blocks, AND each block MUST be placed only in one "
        "of the regions listed for its type above (regions=... in the catalog entry) — e.g. a PageHeader "
        "(regions=header) placed in footerBar is a violation, even though the block id itself exists. "
        "Where the key numbers go is the rule people get wrong most often: on a dashboard they ARE the "
        "page, so use the full-width metrics region; on a list or detail page the list or the record is "
        "the page, so put two or three numbers in headerExtra beside the title where they cost no "
        "vertical space — never open such a page with a full-width band of metric cards."
    )
    lines.append(
        "Step 7b — Responsive business-page grid (preferred for workbench/kanban/calendar/wizard): "
        "layout.grid is an object with optional desktop/tablet/phone arrays. Column counts are "
        "desktop=12, tablet=8, phone=4. Every array item has exactly blockRef/x/y/w/h; all coordinates "
        "and sizes are integers, x/y are non-negative, w/h are positive, and x+w must fit the breakpoint. "
        "blockRef is either an id from page.blocks or the reserved value page-content, which means this "
        "page's real table/kanban/calendar/wizard data surface. Use one placement per blockRef per breakpoint. "
        "Phone layouts must be a single reading-order column (x=0,w=4). When a smaller breakpoint is omitted, "
        "runtime falls back to the nearest larger layout. Example: "
        '"layout":{"grid":{"desktop":[{"blockRef":"filter","x":0,"y":0,"w":12,"h":1},'
        '{"blockRef":"page-content","x":0,"y":1,"w":9,"h":3},'
        '{"blockRef":"feed","x":9,"y":1,"w":3,"h":3}],'
        '"phone":[{"blockRef":"filter","x":0,"y":0,"w":4,"h":1},'
        '{"blockRef":"page-content","x":0,"y":1,"w":4,"h":2},'
        '{"blockRef":"feed","x":0,"y":2,"w":4,"h":1}]}}. '
        "Do not emit both a grid placement and a second copy of the same content through another block."
    )
    # 设备合法域是占位符：本模块是 util 叶子，不许 import archetype_legal。
    # 生成侧 fill_device_placeholders 填账本。手抄 desktop|phone = 加档漏接。
    lines.append(
        "Step 8 — Shell and device: appbundle MAY include experienceShell "
        "{mode: 'navigation'|'focus', navigation: 'side'|'top'} and MUST include "
        "preferredDevice '__PREFERRED_DEVICES__'. "
        "Use experienceShell instead of appIdentity.nav for new models. "
        "mode MUST be 'navigation' for now — 'focus' (full-screen single-purpose tools like a report "
        "viewer or document editor) is schema-legal but has NO client renderer yet; declaring it renders "
        "as an ordinary navigation shell, not the immersive full-screen layout the name implies."
    )
    # 2026-07-30：preferredDevice 此前只声明了合法域、没给任何判据，结果实测
    # 9 个真实应用 9 个 desktop——这个字段是死的。而下游拿它决定要不要多花
    # 一次调用去设计手机版式（enrich_monitor_page_overviews）。现在它是新生成模型
    # 的单一权威选择：按完整产品与操作姿态选一档，判不清也走确定性单端兜底。
    lines.append(
        "Step 8b — How to choose preferredDevice. You MUST choose exactly one supported device; "
        "NEVER omit the field, request both devices, or emit an unsupported device. Judge by the "
        "user's POSTURE while operating, not by keywords in the request:\n"
        "__DEVICE_GENERATION_BULLETS__\n"
        "  · When posture is ambiguous, inspect the complete five-system model, landing-page shape, "
        "and primary operation, then still choose exactly one device.\n"
        "Two traps (both judged by WHO operates it in WHAT state, not by the words present): "
        "'courier dispatch board' contains 'courier' but the operator is a dispatcher at a desk → "
        "desktop; 'inspection work order, worker photographs on site and submits' contains 'work order' "
        "but the operator is walking around → phone. If the request names a device explicitly "
        "(app / mobile / mini-program / PC / web / 'on the computer'), follow that.\n"
        # 2026-08-03：姿态判据本身没错，但它可能跟**你自己产出的东西**打架。
        # 真机案例：「鱼眼图像辨别水产新鲜度」——采样确实是站着拍照，姿态判 phone，
        # 按上面的规则一点没判错；可这个应用真正生成出来的是一整套后台（新鲜度
        # 评分仪表盘、样品占比环图、各品类平均评分柱状图、批次台账），一个 9:16
        # 的窄条根本装不下，作品墙上那张卡也因此是竖的、糊的。
        #
        # 采集动作往往只是**整套系统里的一个页面**，而首页决定的是整个应用的形态。
        # 所以补一条压在姿态之上：先看你打算产出什么，再看谁在什么状态下用。
        "OVERRIDE (this outranks posture): judge by WHAT YOU ARE ABOUT TO BUILD first. "
        "If this app's landing page is an overview/dashboard — KPI tiles, charts, cross-entity "
        "aggregates, batch review or reconciliation — choose 'desktop' EVEN IF the request "
        "describes on-site capture (photographing, scanning, clocking in). Capture is usually one "
        "page inside the system; the landing page decides the shape of the whole app, and a 9:16 "
        "column cannot hold a multi-column dashboard. Choose 'phone' only when capture-in-the-moment "
        "is essentially the WHOLE product and there is no back-office side to it."
    )
    lines.append(
        f"Step 9 — Design recipe: appbundle.appIdentity MAY include designRecipeRef "
        f"from: {', '.join(DESIGN_RECIPES)}. "
        "Recipes control density/layout/dark-mode ONLY — they do NOT pick colors; "
        "primary color is a separate, independent choice via appIdentity.theme. "
        "spacious-guided = generous spacing for step-by-step wizard tools; "
        "compact-dense = tight spacing for monitoring/competitive-analysis dashboards; "
        "content-cards = larger rounded cards for content/knowledge tools; "
        "dark-monitoring = dark background + compact spacing for ops dashboards; "
        "high-contrast = darker borders and larger text for accessibility. "
        "default = no override, follows the theme's own spacing. "
        "Do not free-generate colors or CSS — only reference a recipe by id."
    )
    return "\n".join(lines)
