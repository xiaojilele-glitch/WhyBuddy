"""E40.1：合法域单一真相源——四方派生的 parity 锁。

账本 = services/data/five_system_legal.json。这里锁三方（门/修复器/生成
契约）与账本逐字一致；客户端渲染器的 parity 由 vitest 侧
legal-domains-parity.test.ts 锁（同读同一份 JSON）。任何一方私自扩枚举、
或改了账本但没跟上派生，这里当场红——E37 式漏账的机械防线。
"""

import re
from pathlib import Path

from services import schema_legal
from services.schema_legal import experience_block_prompt_block
from services.v5_model_gate import (
    CHART_TYPES,
    EXPERIENCE_BLOCK_TYPES,
    FIELD_TONES,
    NUMBER_FORMATS,
    PAGE_KINDS,
    STAT_FORMATS,
    STRING_FORMATS,
)


def test_gate_constants_are_the_ledger():
    """门的常量必须就是账本对象本身（re-export，不是抄写）。"""
    assert FIELD_TONES is schema_legal.FIELD_TONES
    assert NUMBER_FORMATS is schema_legal.NUMBER_FORMATS
    assert STRING_FORMATS is schema_legal.STRING_FORMATS
    assert STAT_FORMATS is schema_legal.STAT_FORMATS
    assert PAGE_KINDS is schema_legal.PAGE_KINDS
    assert CHART_TYPES is schema_legal.CHART_TYPES
    assert EXPERIENCE_BLOCK_TYPES is schema_legal.EXPERIENCE_BLOCK_TYPES


def test_loader_matches_json_ledger():
    snap = schema_legal.legal_snapshot()
    assert tuple(snap["fieldTones"]) == schema_legal.FIELD_TONES
    assert tuple(snap["pageKinds"]) == schema_legal.PAGE_KINDS
    assert tuple(snap["chartTypes"]) == schema_legal.CHART_TYPES
    assert tuple(snap["statFormats"]) == schema_legal.STAT_FORMATS
    assert tuple(snap["metricBare"]) == schema_legal.METRIC_BARE
    assert tuple(snap["chartMetricPrefixes"]) == schema_legal.CHART_METRIC_PREFIXES
    assert tuple(snap["statMetricPrefixes"]) == schema_legal.STAT_METRIC_PREFIXES


def test_experience_block_catalog_is_structurally_closed():
    catalog = schema_legal.experience_block_catalog_snapshot()
    blocks = catalog["blocks"]
    assert tuple(block["type"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_TYPES
    assert tuple(block["rendererKey"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS
    assert len(set(schema_legal.EXPERIENCE_BLOCK_TYPES)) == len(blocks)
    assert len(set(schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS)) == len(blocks)
    for block in blocks:
        assert set(block["dataKinds"]) <= set(catalog["dataKinds"])
        assert set(block["allowedRegions"]) <= set(catalog["pageRegions"])
        assert set(block["events"]) <= set(catalog["eventTypes"])


def test_repair_shares_gate_chart_types():
    from services.v5_model_repair import _CHART_TYPES

    assert _CHART_TYPES is schema_legal.CHART_TYPES


def test_schema_instruction_renders_from_ledger():
    """生成契约的枚举段 = 账本渲染；不残留占位符，不残留手抄串。"""
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert "__" not in _SCHEMA_INSTRUCTION, "契约中不允许残留 __TOKEN__ 占位"
    assert schema_legal.enum_str("fieldTones") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("numberFormats", "stringFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("pageKinds") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("statFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("chartTypes") in _SCHEMA_INSTRUCTION
    # metric 形态按 bare+前缀拼装（与门/修复器判定同源）
    assert "count|sum:<entity_id>.<field_id>|avg:<entity_id>.<field_id>" in _SCHEMA_INSTRUCTION
    assert '"metric": "count|sum:<entity_id>.<field_id>"' in _SCHEMA_INSTRUCTION
    # page.blocks 的放开名单由目录 generationEnabled 派生（2026-07-27）。
    # 此前这里断言的是一刀切禁令 "DO NOT emit page.blocks for production
    # pages"——那句话在渲染器陆续落地后过期了五天，把已经能用的区块一直
    # 关在门外，所以断言随语义一起换成"名单来自目录"。
    _enabled = [
        str(b["type"]) for b in schema_legal.EXPERIENCE_BLOCKS if b.get("generationEnabled")
    ]
    if _enabled:
        # 2026-07-28：只锁"名单整串来自目录"，不锁包着它的措辞。措辞从许可式
        # 改成祈使式那次（实测：0 个积木 → 8~9 个），这条曾因为钉死了
        # "ONLY these types are renderable today: " 这句话而误报。
        assert ", ".join(_enabled) in _SCHEMA_INSTRUCTION
    else:
        assert "DO NOT emit page.blocks for production pages" in _SCHEMA_INSTRUCTION
    for block_type in schema_legal.EXPERIENCE_BLOCK_TYPES:
        assert f"- {block_type}:" in _SCHEMA_INSTRUCTION


def test_gate_still_blocks_off_ledger_values():
    """接线后语义不变：账本外的值照拦（拿 E37 的 avg: 图表案例回归）。"""
    from services.v5_model_gate import validate_five_system_model

    model = {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "s", "name": "S", "type": "enum",
             "options": [{"id": "a", "label": "A", "tone": "sparkly"}]},
        ]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [{"id": "p", "name": "P", "kind": "hologram",
                            "fieldBindings": ["t.s"], "actionPermissions": ["t:view"],
                            "charts": [{"id": "c", "type": "sparkline", "dimension": "t.s", "metric": "count"}]}]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
                      "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }
    verdict = validate_five_system_model(model)
    assert verdict["passed"] is False
    refs = {f.get("ref") for f in verdict["findings"]}
    assert "sparkly" in refs      # 非法 tone
    assert "hologram" in refs     # 非法页面范式
    assert "sparkline" in refs    # 非法图表形态


def _named_between(text: str, after: str, before: str) -> set[str]:
    """把 `after` 与 `before` 之间那串 `A, B, C` 切成**精确的名字集合**。

    ## 为什么不能用 `"FilterBar" in sentence`

    子串包含在这份数据上是**真的会漏**，不是理论风险。目录里：

        FilterBar   是 TimelineFilterBar / WorkItemFilterBar /
                    CatalogEntityFilterBar / QueryClauseFilterBar /
                    CycleFilterBar / AlertRuleFilterBar 这 6 个的子串
        StatusTabs  是 BookingStatusTabs 的子串
        TrendChart  是 ReleaseAdoptionTrendChart / SyncVolumeTrendChart 的子串

    35 个受监视的名字里有 3 个被这样掩护着。也就是说：把 `FilterBar` 从禁令里
    整个删掉，只要那 6 个兄弟里还剩一个在，守卫照样绿灯——而 `FilterBar` 恰恰
    是这一族里最常被模型摆出来的那个，正是整条禁令最初为它而设的。

    反方向同样有问题：`ok_sentence` 里出现 `BookingStatusTabs`，会让
    "`StatusTabs` 被推荐了"这条**误报**，把一次干净的改动判成回归。

    所以按分隔符切，然后比集合。名单本身就是 `", ".join(...)` 拼出来的，
    切回去是无损的。
    """
    start = text.index(after) + len(after)
    end = text.index(before, start)
    return {name.strip() for name in text[start:end].split(",") if name.strip()}


def test_monitor_pages_carry_an_explicit_block_prohibition():
    """2026-08-01：总览页的禁用积木必须是**显式禁令**，不能只是"不在推荐清单里"。

    实测教训：先只把 FilterBar 从 monitor_ok 移除，重跑一轮 dashboard 页照样
    声明了 analytics_filters——目录里它仍是通电区块，没有任何一句说总览页不许
    用，模型按语义直觉("总览页该有个筛选条")就补上了。

    所以这里锁三件事：说了 NEVER、该点名的都在**禁令那一句里**、且给了理由
    （本仓库反复验证过只丢名单不给理由时模型会照旧按直觉猜）。

    2026-08-11：判据从"四个名字"换成"三个名字 + capability==filter 整族"。
    原注释自己写过"是同一个洞，只是还没撞上"——撞上了：`filterChange` 在总览页
    够不到任何东西这条理由是**机械的**（KPI/图表/积木/设计树全读未筛全量，只有
    本页的表/看板/日历吃筛过的行），所以 32 个 filter 区块一个不少都得禁，不只
    FilterBar。断言也跟着从"名字在提示词里"改成"名字在禁令句里"——前者太弱，
    这些名字在下面的全目录清单里本来就会出现，禁令句删掉了照样通过。
    """
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    head = "On monitor / dashboard pages, NEVER emit these blocks"
    assert head in prompt

    # 2026-08-11：三处断言从"名字是句子的子串"换成**精确名单比对**。
    # 原来的写法在这份数据上是真的会漏（见 `_named_between` 的说明）。
    banned = _named_between(prompt, head + ": ", ". Each is inert there")

    for t in ("MetricGrid", "TrendChart", "DataTable"):
        assert t in banned, f"{t} 不在禁令句里（禁令点名了 {len(banned)} 个）"

    # 机械判据：所有 filter 能力的通电区块都必须在禁令句里点名
    filters = [
        str(b["type"])
        for b in schema_legal.EXPERIENCE_BLOCKS
        if b.get("generationEnabled") and str(b.get("capability") or "") == "filter"
    ]
    assert filters, "目录里没有 filter 区块了，这条判据失去意义"
    missing = [t for t in filters if t not in banned]
    assert not missing, f"这些 filter 区块没被总览页禁令点名：{missing[:8]}"

    # 反面：被禁的不能同时出现在"总览页可以用这些"那句里
    ok_head = "monitor / dashboard pages are NOT exempt"
    recommended = _named_between(
        prompt, "declare it as a block: ", ". Pick by what THIS operation"
    )
    assert ok_head in prompt
    both = sorted(set(filters + ["MetricGrid", "DataTable"]) & recommended)
    assert not both, f"同一份提示词里既禁止又推荐：{both[:8]}"

    # 理由必须在场——筛选那条是最容易被当成"随便定的规矩"的
    assert "cannot filter ANYTHING on an overview" in prompt


#: 总览页禁令与 pageKinds 打架、因而**无处可去**的区块。只准变少，现在是 0。
#:
#: 2026-08-11 把总览页禁令改成机械判据（capability==filter 一律禁）时照出两个：
#: `AnalyticsDateScope` 和 `DashboardParameterBar` 的 pageKinds **只**写了
#: dashboard/monitor，禁令一上就成了"只允许总览页 + 总览页不许用"。
#:
#: 当天收口时按同一条判据修掉了：筛选类区块的归宿是**逐行展示记录的页面**，
#: 所以这两个的 pageKinds 改成 `workbench`——那里 `applyPageFilter` 真的会
#: 收窄表格的行（含 dateRangeField 那条日期范围），控件是活的。
#:
#: 剩下的一句仍然成立：总览页的 KPI/图表照旧不吃 filterState
#: （pageStatDisplay 与 phoneChartNode 都直读 state.entities）。将来若要让
#: 仪表盘像 Grafana 那样"时间范围/模板变量管全页"，那是个功能，届时这条禁令
#: 本身要重新议，不是把这两个区块搬回去。
_OVERVIEW_ONLY_FILTERS_BASELINE = 0


def test_没有更多区块被总览页禁令堵死():
    """禁令是机械判据，可能把"只允许总览页"的区块堵死。这条守住那个数只准变少。

    要让某个 filter 区块重新可用，两条路：给它加一个非总览页型（说明它在
    业务页上确实有用），或者把总览页的 KPI/图表接上 filterState（那时这条
    禁令本身就该重新议）。
    """
    from services import schema_legal

    overview = {"monitor", "dashboard"}
    stranded = sorted(
        str(b["type"])
        for b in schema_legal.EXPERIENCE_BLOCKS
        if b.get("generationEnabled")
        and str(b.get("capability") or "") == "filter"
        and set(b.get("pageKinds") or []) <= overview
    )
    assert len(stranded) <= _OVERVIEW_ONLY_FILTERS_BASELINE, (
        f"又多了被堵死的区块（只允许总览页，而总览页禁止筛选类）：{stranded}。"
        "给它一个非总览页型，或者别把它标成 filter。"
    )
    if len(stranded) < _OVERVIEW_ONLY_FILTERS_BASELINE:
        raise AssertionError(
            f"被堵死的区块降到 {len(stranded)} 个（基线 "
            f"{_OVERVIEW_ONLY_FILTERS_BASELINE}）：{stranded}。"
            "请把 _OVERVIEW_ONLY_FILTERS_BASELINE 改成这个数锁住改善。"
        )


def test_region_restrictions_have_no_unexplained_width_gaps():
    """区域限制的物理依据是宽度——不该出现"窄的能放、宽的能放、中间不能放"。

    2026-08-08 第三轮：旧五槽整套退休，这条跟着换到区域词汇。**顺带纠正上一版
    写错的依据**——旧注释说"secondary=1/3、primary=2/3、activity/content=全宽
    且 className 逐字节相同"，还引了 AppRuntimeScreen.tsx:1490-1532。那句是错的。
    真跑 upgradeLegacySlotsToGrid 量出来（12 栅格）：

        summary / primary    → 12
        secondary / activity → 4
        content              → 仪表盘 12、其它页型 4

    所以 activity 与 content 并不相同，content 还随页型变宽；那个行号如今指向的
    也是无关代码。旧描述停在网格化之前的渲染器上，一直没跟着改——这正是推翻五槽
    的依据之一：五个名字只有两种行为，还有一个是不定项。

    换到区域之后宽度是清楚的：aside 是窄列（4/12），正文侧的都是整行。
    """
    from services import schema_legal

    # 实测宽度档：1=窄列，2=整行
    width = {"aside": 1, "main": 2, "metrics": 2, "charts": 2, "supplement": 2}
    for block in schema_legal.EXPERIENCE_BLOCKS:
        regions = set(block["allowedRegions"])
        ranked = [width[r] for r in regions if r in width]
        if not ranked:
            continue
        lo, hi = min(ranked), max(ranked)
        gaps = [r for r, o in width.items() if lo < o < hi and r not in regions]
        assert not gaps, (
            f"{block['type']} 的宽度区间有洞：允许 {sorted(regions)}，却禁了 {gaps}"
        )


def test_every_region_restriction_ships_its_reason():
    """**凡是限制了区域的类型，都必须说明为什么**——不是只给犯过错的那个补。

    2026-08-01 的教训：给 WorkflowTimeline 补了理由之后它那类违规归零，但同一
    个毛病立刻换主角复发——FilterBar→content ×2、QuickActionPanel→content ×3。
    上一版这条用例只钉了 WorkflowTimeline 一个，所以"补了理由"这件事没有被推广，
    等于修了症状没修这一类。

    2026-08-08 又添一例，说明这条依然在防真事：PageHeader 被装配器放进了
    footerBar——两者能力都是 action，容器侧的 accepts 放行了。区块侧的限制这轮
    才进门禁，理由也就必须在场。

    判据：allowedRegions 不是全集 = 存在限制 = 必须有 regionsRationale。模型推
    不出"为什么不行"时只会按名字的字面意思猜。
    """
    from services import schema_legal

    all_regions = set(schema_legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
    for block in schema_legal.EXPERIENCE_BLOCKS:
        if set(block["allowedRegions"]) >= all_regions:
            continue  # 不限制就不用解释
        assert str(block.get("regionsRationale") or "").strip(), (
            f"{block['type']} 限制了区域（只允许 {sorted(block['allowedRegions'])}）"
            "却没写 regionsRationale——模型无从推断，只会按名字乱猜"
        )


def test_slot_rationales_reach_the_generation_contract():
    """理由必须真的进生成契约，不能只躺在目录里。"""
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    for block in schema_legal.EXPERIENCE_BLOCKS:
        rationale = str(block.get("regionsRationale") or "").strip()
        if rationale:
            assert rationale in prompt, f"{block['type']} 的槽位理由没进 prompt"


def test_contract_explains_what_the_regions_look_like():
    """区域的**渲染形态**要交代清楚——这是那一类违规的根因。

    此前提示词只给名字，从没说过它们渲染成什么样。模型不知道形态就只能按名字
    猜，逐块补理由是治单点，这一句才治这一类。

    2026-08-08 第三轮换到区域词汇，同时补上这轮实测出来的那条最容易错的规则：
    **关键数字放哪儿**——仪表盘用全宽 metrics（IntroduceRow 那一排），列表/详情
    页放 headerExtra（页头右侧，不占正文）。写死一句是因为新区域都是 optional，
    而 optional 在模型眼里约等于"可以不管"（实测：不写这句，detail 页只用
    header/main/aside，把状态和金额丢在主区里；写了之后 headerExtra 就用上了）。
    """
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    assert "What the regions actually look like" in prompt
    # 唯一的窄区域必须点名——这是"别把宽的东西塞进去"的判据
    assert "aside is the ONLY narrow region" in prompt
    # 页头带的阅读顺序
    assert "header / headerExtra / headerContent / filters" in prompt
    # 关键数字的去处
    assert "headerExtra" in prompt
    assert "never open such a page with a full-width band of metric cards" in prompt


def test_contract_teaches_responsive_business_page_grid():
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    assert "layout.grid" in prompt
    assert "desktop=12, tablet=8, phone=4" in prompt
    assert "page-content" in prompt
    assert "blockRef/x/y/w/h" in prompt
    assert "one placement per blockRef per breakpoint" in prompt


def test_推荐上总览页的区块_没有一个被页型MUST规则禁止():
    """同一份 prompt 不能既推荐一个区块上总览页、又立规矩禁止它上总览页。

    ## 这条钉的是什么

    `monitor_ok`（"Where this business's overview genuinely leads with something
    beyond numbers, declare it as a block: …"）当初只过了一道判据——
    `_inert_on_overview`，也就是"它在总览页上是不是死控件"。它**不看** pageKinds。

    而 2026-08-11 同一份 prompt 里新立了一条 MUST：区块只能出现在 `pages=` 列出
    的页型里。两处一夹，模型在同一份提示词里会连着读到三句互斥的话：

        - QuickActionPanel: … pages=workbench,wizard          ← 条目自己写着不含总览页
        … declare it as a block: QuickActionPanel, …          ← 这里推荐它上总览页
        A block MUST only appear … whose kind is in that list ← 又禁止这么做

    当时的规模是 323 个推荐里 134 个这样，不是零星几个。

    ## 为什么从 prompt 正文里解析，而不是断言源码

    本文件里已经有过教训：用"源码里出现过某个名字"当判据，`FilterBar` 是另外
    六个类型名的子串，守卫会被子串喂饱而漏掉真实回归。所以这条**把真实拼出来的
    prompt 正文切出来解析**——推荐名单来自正文那一句，pages= 来自正文的条目行。
    两边都是模型真正会读到的字节，中间不经过任何我们自己的判据函数。
    """
    text = experience_block_prompt_block()

    # 1) 从条目行里取每个区块的 pages=（模型读到的那一份，不是目录对象）
    declared: dict[str, set[str]] = {}
    for line in text.splitlines():
        m = re.match(r"^- (\w+): .*?; pages=([\w,]+);", line)
        if m:
            declared[m.group(1)] = set(m.group(2).split(","))
    assert declared, "prompt 正文里一条 `- 类型: … pages=…` 都没解析到，判据失效"

    # 2) 从推荐句里取名单。按分隔符精确切，不用 `\b[A-Z]\w+\b` 那种宽正则——
    #    后者会把句子里任何一个大写开头的词当成区块名（"Pick"、"Declaring"），
    #    多解析出来的名字不在 `declared` 里、被第 3 步静默跳过，等于判据缩水。
    recommended = _named_between(
        text, "declare it as a block: ", ". Pick by what THIS operation"
    )
    assert recommended, "推荐句里没解析到任何区块名"

    # 3) 交叉核对：被推荐上总览页的，pages= 必须真的含 monitor 或 dashboard
    contradicted = [
        t
        for t in recommended
        if t in declared and not (declared[t] & {"monitor", "dashboard"})
    ]
    assert not contradicted, (
        f"{len(contradicted)}/{len(recommended)} 个区块被推荐上总览页，"
        f"但它们自己的 pages= 不含 monitor/dashboard，"
        f"同一份 prompt 里的 MUST 规则禁止这么做：{contradicted[:8]}"
    )


def test_筛选族的事件分布_钉住注释里那几个数():
    """`28/32 只发 filterChange` 这个数必须由目录算出来，不许再手写。

    ## 为什么值得单独钉一条

    这个数原本写成 31/32，在 `schema_legal.py`、`AppRuntimeScreen.tsx` 和
    `docs/page-kinds-widening-proposal.md` 三处各抄了一遍，**三处全错**，而且
    错了没有任何东西会红——它只是注释。

    代价不是"注释不好看"：判据（整族 filter 一律禁总览页）的正当性就建立在这个
    数上。数错了，复核的人据此提出的补救方向也是错的（"放宽成 events⊆{filterChange}
    让那几个活下来"）——而那 4 个多发的事件同样到不了岸，放宽只会把按不动的控件
    放回总览页。

    所以这条不钉"判据对不对"，钉的是**判据赖以成立的那组事实**。
    """
    filters = [
        b
        for b in schema_legal.EXPERIENCE_BLOCKS
        if str(b.get("capability") or "") == "filter"
    ]
    only_filter_change = [
        b for b in filters if set(b.get("events") or ()) == {"filterChange"}
    ]
    exceptions = {
        str(b["type"]): sorted(b.get("events") or ())
        for b in filters
        if set(b.get("events") or ()) != {"filterChange"}
    }

    # 2026-08-11 去重：32 → 27（facetFilterRenderer 一族 6 个只留 1 个）。
    # 例外那四个一个没变——删掉的全是"只发 filterChange"那一档，整族判据不受影响。
    # 第二刀：27 → 22（5 个筛选条结构全等，只留 1 个）
    assert len(filters) == 22, f"filter 区块数变了（{len(filters)}），三处注释要跟着改"
    assert len(only_filter_change) == 18, (
        f"只发 filterChange 的是 {len(only_filter_change)}/{len(filters)}，"
        f"不是注释里写的 18——schema_legal.py、AppRuntimeScreen.tsx、"
        f"docs/page-kinds-widening-proposal.md 三处要一起改"
    )
    assert exceptions == {
        "HierarchicalCategoryPicker": ["filterChange", "itemSelect"],
        "SavedSearchPanel": ["filterChange", "submitRequest"],
        "SavedViewTabs": ["filterChange", "submitRequest"],
        # 注意：它一个 filterChange 都不发，却被标成 capability=filter
        "ValidatedFormTabs": ["itemSelect"],
    }, f"筛选族的事件例外变了：{exceptions}"


def test_额外事件到不了岸_所以整族禁令仍然成立():
    """禁令覆盖那 4 个例外的依据：`eventBindings` 全仓库没有第二处读它。

    这是上一条的另一半。上一条钉事实（谁发了什么事件），这条钉**为什么发了别的
    事件也照禁**——因为事件名→动作 id 的映射根本没接上，多发的事件在任何页面上
    都是空转。哪天有人把 `eventBindings` 接上了，这条会红，那时才该回头重议判据。
    """
    root = Path(schema_legal.__file__).resolve().parent.parent.parent / "client" / "src"
    hits: list[str] = []
    for path in root.rglob("*.ts*"):
        if "__tests__" in path.parts:
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            # 只数**代码行**：注释里提到它不算接线（这一条本身的说明就提了两次，
            # 连注释一起数会把判据变成"谁都不许谈论它"）
            if line.lstrip().startswith(("//", "*", "/*")):
                continue
            if "eventBindings" in line:
                hits.append(f"{path.relative_to(root)}:{i}")

    # 只允许三处：两处类型声明 + 一处解析赋值。多出来的说明有人开始真读它了。
    assert len(hits) == 3, (
        "client 侧 eventBindings 的代码引用处变了。若已把事件名→动作 id 接进渲染层，"
        "那么筛选族禁令对 SavedViewTabs / SavedSearchPanel / "
        f"HierarchicalCategoryPicker 这几个就要重议：{hits}"
    )


def test_名单解析是精确匹配_不会被兄弟名字喂饱():
    """守卫必须按名字比，不能按子串——这条把"改回子串写法"钉死。

    ## 实测过的失效

    把 `FilterBar` 从总览页禁令里整个删掉（只留它那 6 个兄弟），跑同一份提示词：

        旧守卫（`"FilterBar" in sentence`）  报缺失 []            → 绿灯
        新守卫（精确名单比对）              报缺失 ['FilterBar'] → 红

    绿灯的原因是 `TimelineFilterBar` / `AlertRuleFilterBar` 等仍在句子里，
    子串一找就中。而 `FilterBar` 恰恰是这一族里模型最常摆出来的那个，整条禁令
    最初就是为它设的——守卫对"它没了"这件事完全失明。

    反方向的误报同理：`BookingStatusTabs` 在场会让"`StatusTabs` 被推荐了"成立。
    """
    # 正向：名字不在名单里，就算兄弟在也不许算它在
    banned = _named_between(
        "NEVER emit these blocks: TimelineFilterBar, AlertRuleFilterBar"
        ". Each is inert there, not merely discouraged.",
        "NEVER emit these blocks: ",
        ". Each is inert there",
    )
    assert banned == {"TimelineFilterBar", "AlertRuleFilterBar"}
    assert "FilterBar" not in banned, "子串又漏进来了——守卫退回了旧写法"

    # 反向：兄弟在场不许把短名字误判成"在名单里"
    recommended = _named_between(
        "declare it as a block: BookingStatusTabs"
        ". Pick by what THIS operation actually does first",
        "declare it as a block: ",
        ". Pick by what THIS operation",
    )
    assert recommended == {"BookingStatusTabs"}
    assert "StatusTabs" not in recommended, "反方向的误报还在"

    # 目录里真实存在这种掩护关系，所以这条判据不是假想敌
    types = {str(b["type"]) for b in schema_legal.EXPERIENCE_BLOCKS}
    shadowed = {t for t in types if any(t != o and t in o for o in types)}
    assert {"FilterBar", "StatusTabs", "TrendChart"} <= shadowed, (
        f"这些名字不再被别的类型名掩护了，判据可以放宽——先确认：{sorted(shadowed)[:10]}"
    )


def test_层级指针的规则_数字必须跟目录对得上():
    """`ref` 那条规则里的数字是**从目录数出来的**，不许手写漂着。

    ## 这条规则是怎么来的（2026-08-11）

    跑真实话题三趟，有一趟首轮没过闸，唯一那条裁决是：

        [fieldref_type] parentFieldRef 'parent_policy_id' must be a string field (got 'ref')

    模型把"父级策略"标成了 `ref`——**语义上完全正确**，而且确定性修复器也救不
    回来：`_repair_binding_field_types` 只在同实体、类型正好相等的字段里挑，
    那个实体的 string 字段是 name / receiver_name / matcher，没有唯一近邻，
    按"歧义不猜"原样留给门。修复器是对的，缺的是**没人告诉过模型**。

    ## 为什么判定"契约对、提示词缺"，而不是改契约

    同一天在这类事上已经错判过两次（`sortByRef` 要 number、`startTimeFieldRef`
    要 string，两次都是契约对）。所以这次先数：

        entityFieldRefs 全目录 1009 处，string 447 / enum 273 / number 205 /
        date 84 / **ref 0**

    **没有任何一处绑定接受 `ref`。** 也就是说模型只要把某个字段标成 `ref` 并让
    区块去绑它，就必然被拒——这不是某个区块契约窄，是 `ref` 在这套 schema 里
    压根没有目标声明、下游解析不出来（"PEOPLE NEED A NAME FIELD" 那条早就写了
    同一个机制，只是它只覆盖了人物类的六个 FieldRef，漏了自引用的层级指针）。

    ## 这条测试守什么

    规则句里写死了几个数（1009 / 447 / 273 / 205 / 84 / 0）和六个 FieldRef 名字。
    数据一变它们就成了假话，而**假前提是最难查的一类错**——模型会照着一个不存在
    的事实推理。所以这里逐个跟目录核对。
    """
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION as S

    head = "HIERARCHY IS A STRING ID"
    assert head in S, "层级指针那条规则不见了"

    counts: dict[str, int] = {}
    parents: set[str] = set()
    for b in schema_legal.EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        wants = (b.get("bindingSchema") or {}).get("entityFieldRefs") or {}
        for key, typ in wants.items():
            counts[str(typ)] = counts.get(str(typ), 0) + 1
            if "parent" in key.lower():
                parents.add(key)

    # ① 没有任何绑定接受 ref —— 整条规则的地基
    assert counts.get("ref", 0) == 0, (
        f"现在有 {counts['ref']} 处绑定要求 ref 了，规则句里那句 "
        "'ZERO want ref' 变成了假话，请一起改"
    )

    # ② 规则句里报的每个数，就是从目录数出来的那个数
    total = sum(counts.values())
    expected = [
        (f"of {total} required field types", "绑定总数"),
        (f"{counts.get('string', 0)} want string", "string"),
        (f"{counts.get('enum', 0)} enum", "enum"),
        (f"{counts.get('number', 0)} number", "number"),
        (f"{counts.get('date', 0)} date", "date"),
    ]
    wrong = [(frag, what) for frag, what in expected if frag not in S]
    assert not wrong, (
        "规则句里的数字与目录对不上（目录现在是 "
        f"总数 {total} / string {counts.get('string', 0)} / enum {counts.get('enum', 0)}"
        f" / number {counts.get('number', 0)} / date {counts.get('date', 0)}）："
        + "；".join(f"{what} 那处应为 “{frag}”" for frag, what in wrong)
    )

    # ③ 点名的 FieldRef 必须都还在目录里（名字改了就得跟着改）
    named = {k for k in parents if k in S}
    assert named == parents, (
        f"这些父指针 FieldRef 没被规则句点名：{sorted(parents - named)}。"
        "漏掉一个，模型在那个区块上就照旧会标 ref。"
    )
