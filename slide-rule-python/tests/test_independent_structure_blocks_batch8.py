from services import schema_legal as legal


TYPES = {
    "BankTransactionReconciliationMatcher": ("frappe/erpnext", "bank-statement-voucher-amount-matcher"),
    "CvssVectorCalculator": ("DefectDojo/django-DefectDojo", "cvss-metric-vector-score-builder"),
    "LogPatternClusterExplorer": ("openobserve/openobserve", "log-template-cluster-sample-inspector"),
    "ProductVariantMatrixBuilder": ("shopware/shopware", "product-attribute-cartesian-variant-matrix"),
    "InventoryLocationLevelTuner": ("medusajs/medusa", "inventory-location-stock-reservation-envelope"),
    "FaceIdentityAssignmentPanel": ("immich-app/immich", "face-crop-person-candidate-assignment"),
}


def test_batch8_families_are_globally_unique_and_real():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["rendererKey"] for block in selected}) == 6
    assert all(block["rendererStatus"] == "real" and block["generationEnabled"] and block["structureDelta"] for block in selected)


def test_batch8_sources_and_contracts_are_verified():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo and block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}


# 2026-08-11 去重：目录 407 → 350。
#
# 这两条数量棘轮的名字里写着「without alias counting」——当时防的是"同一个渲染器
# 挂两个名字来凑数"。但那道防线只看 rendererKey 唯一，**看不见更贵的那种凑数**：
# 每个类型都有自己的 rendererKey 和自己的 XxxRenderer 常量，可那个常量整体只是
#     const QueryModeTabsRenderer = stableTabsRenderer("query-mode-tabs", "查询模式", "itemSelect")
# 一行工厂调用，17 个 Tabs 类型的第三个参数**全是同一个值**，差异只剩 testid 和
# 一句中文标题。rendererKey 唯一性对此完全无感。
#
# 这一轮按"同工厂 + 参数只有 testid/标题"砍掉 57 个，每族留一个：
#     stableTabs 17→1 · compactSummary 14→1 · facetFilter 6→1 · 三个成对工厂 6→3
#     ScheduleCalendar 11→1 · CalendarBlock 7→1 · 两个向导工厂 6→2
# 线上 5 个应用用到的 21 个类型里，被删的一个都没有（OnCallScheduleCalendar 与
# ResourceBookingCalendar 正因为线上在用才被选为幸存者）。
#
# 数字本身不是判据，判据是下面 test_没有工厂只换文案的凑数类型 那条。
# 第二刀（同一天）：350 → 316。
#
# 第一刀按**源码形状**判（同工厂、参数只有 testid/文案），漏了两大类：
#   · ContextPanelRenderer 那 16 个挤在**同一行源码**里，行锚定的正则只匹到第一个；
#   · 16 个向导是**策略表条目**（CONFIGURATION_WIZARD_POLICIES），根本不是调用点。
# 用户第二次指出来（"我看着主体区、补充说明，怎么还全是表格"）之后换了判据：
# **把每个区块用按它自己 bindingSchema 合成的夹具真渲染一遍，比归一化后的 DOM**。
# 那是地基真相，跟源码怎么写无关。量出 18 组 52 个结构全等，删 34。
#
# ⚠ 度量本身也差点出错：头一版把 19 个图表判成同款（ECharts 在 SSR 下只吐空容器）、
# 把一批未绑定的判成同款（都渲染 antd Empty）。排掉这两类假重复之后才是这 34 个。
def test_batch8_catalog_holds_316_after_dedup():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION == 316
    assert len(legal.EXPERIENCE_BLOCKS) == 316
    assert len({block["type"] for block in legal.EXPERIENCE_BLOCKS}) == 316
