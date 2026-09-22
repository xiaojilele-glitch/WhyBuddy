"""monitor 页面总览区块交给 FreeformInsight 设计（2026-07-24）的单测覆盖。

只测新增的两个函数本身：
- _monitor_overview_design_brief：把页面已声明的 stats/charts 翻译成自然语言
  需求文案，覆盖率/措辞正确，不依赖真实 LLM。故意不包含 rankings/feeds——
  真机测试过一次，FreeformInsight 的 dataRef 只能表达聚合值，没法引用"第 N
  行真实记录"，让 LLM 画排行榜/动态流只会画出表头+空表身，比留白还难看，
  所以这两类内容明确排除在设计文案之外，继续走原有的动态行渲染。
- enrich_monitor_page_overviews：编排逻辑本身——只处理 kind=monitor 且声明
  了 stats/charts 的页面（只有 rankings/feeds 没有 stats/charts 时，没东西
  可画，直接跳过），生成成功写回 freeformOverview，生成失败 fail-open 保留
  原有固定骨架不炸、不删数据。generate_freeform_block 本身在这里打桩，不
  发真实网络请求。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import (  # noqa: E402
    FreeformGenerationError,
    _build_overview_sheet_facts,
    _build_marketing_page_prompt,
    _marketing_landing_design_brief,
    _monitor_overview_design_brief,
    _sheet_image_size_for_device,
    enrich_monitor_page_overviews,
)


def test_marketing_landing_brief_is_not_an_operations_dashboard():
    page = {
        "id": "home",
        "name": "星野营地",
        "kind": "monitor",
        "presentation": "marketing-landing",
        "stats": [{"id": "bookings", "name": "预订数", "entity": "order", "metric": "count"}],
        "charts": [{"id": "trend", "name": "趋势", "type": "line", "dimension": "order.created_at", "metric": "count"}],
    }

    brief = _marketing_landing_design_brief(page, _datamodel(), audience="image")

    assert "沉浸式首屏主视觉" in brief
    assert "主要行动按钮" in brief
    assert "KPI" not in brief
    assert "图表" not in brief
    assert "运营总览" not in brief
    assert "完整首页视觉稿" in brief
    assert "不要在图片里绘制网页文字" not in brief


def test_generation_contract_exposes_marketing_landing_presentation():
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert '"presentation": "marketing-landing|application"' in _SCHEMA_INSTRUCTION
    assert "consumer-facing or public landing page" in _SCHEMA_INSTRUCTION
    assert "MUST NOT be coerced into an operations monitor" in _SCHEMA_INSTRUCTION


def test_marketing_page_prompt_requests_a_complete_homepage_visual():
    prompt = _build_marketing_page_prompt(
        "星野营地提供沙漠观星住宿体验", device="desktop"
    )

    assert "完整首页视觉稿" in prompt
    assert "桌面端" in prompt
    assert "真实摄影主视觉" in prompt
    assert "可读中文文案" in prompt
    assert "主要行动按钮" in prompt
    assert "下一内容区" in prompt
    assert "只画一张 Hero" not in prompt
    assert "不要出现任何文字" not in prompt


# ── 逐行内容：由设计模型自己画（2026-08-03）
#
# blockRef（从固定积木清单里挑一个嵌进设计树）整条通道已删除。逐行内容改由
# 设计模型用 rowsRef 自己画——版式它定，真实行数据由渲染端绑。所以这份 brief
# 仍然要列出"这一页有哪些逐行内容"，只是措辞从"照抄这段 blockRef JSON"变成
# 业务语言描述（实体 + 排序字段），具体长什么样交给模型按参照图决定。


def _datamodel():
    return {
        "entities": [
            {
                "id": "order",
                "name": "订单",
                "fields": [
                    {"id": "amount", "name": "金额", "type": "number"},
                    {
                        "id": "status",
                        "name": "状态",
                        "type": "enum",
                        "options": [{"id": "open", "label": "进行中"}, {"id": "done", "label": "已完成"}],
                    },
                ],
            },
            {
                "id": "ticket",
                "name": "工单",
                "fields": [{"id": "created_at", "name": "创建时间", "type": "date"}],
            },
        ]
    }


def _monitor_page():
    return {
        "id": "home",
        "name": "运营总览",
        "kind": "monitor",
        "stats": [
            {"id": "s1", "name": "订单总数", "entity": "order", "metric": "count"},
            {"id": "s2", "name": "总金额", "entity": "order", "metric": "sum:order.amount"},
        ],
        "charts": [
            {"id": "c1", "name": "状态分布", "type": "bar", "dimension": "order.status", "metric": "count"},
        ],
        "rankings": [
            {"id": "r1", "name": "金额排行", "entity": "order", "sortBy": "order.amount", "limit": 5},
        ],
        "feeds": [
            {"id": "f1", "name": "工单动态", "entity": "ticket", "timeField": "ticket.created_at"},
        ],
    }


def test_sheet_canvas_is_the_2560_tier_and_decoupled_from_block_reference_images():
    """参照板 2560x1440 档，且**不再跟区块级参照图共用一张尺寸表**（2026-08-03）。

    两件事各自钉住：

    · **16 的倍数**——端点硬校验，两边不整除 16 直接 400（所以拿不到
      1920x1080：1080÷16=67.5，而 2560x1440 反而合法）。不写成测试的话，
      下次有人手改成一个"看起来更标准"的尺寸，会在生图那一步才炸，报的还是
      400 不是超时，很容易被当成鉴权或网络问题去查。
    · **和区块级参照图分开**——那张图每个区块生一次、且要喂进视觉 LLM 当输入，
      图越大输入 token 越多越贵；参照板整页只生一次。两者的成本账不一样，
      合用一张表迟早会为了省其中一个而误伤另一个。
    """
    from services.freeform_block import _image_size_for_device, _sheet_image_size_for_device

    for device in ("desktop", "tablet", "phone", ""):
        w, h = (int(x) for x in _sheet_image_size_for_device(device).split("x"))
        assert w % 16 == 0 and h % 16 == 0, (device, w, h)
        assert w * h >= 2560 * 1440, (device, w, h)   # 不许悄悄降回小档
        # 区块级那张仍然是小档，两者必须是两个数
        assert _sheet_image_size_for_device(device) != _image_size_for_device(device)

    # 档位形状不能弄反：桌面横版、手机竖版
    dw, dh = (int(x) for x in _sheet_image_size_for_device("desktop").split("x"))
    pw, ph = (int(x) for x in _sheet_image_size_for_device("phone").split("x"))
    assert dw > dh and ph > pw


def test_refine_system_prompt_carries_the_placeholder_rules():
    """占位写法必须写进**改写系统提示词**，不能只留在区块级那份常量里。

    这条防的是一次真实复发（2026-08-03）：07-31 参照板提示词从写死模板改成
    「LLM 现写」，那五段常量——含占位写法与末尾信息层级清单——一条都没搬过来。
    出图里数值那一类于是退化成**灰色横条**（KPI 数值、环图中心、坐标轴刻度
    全是灰条）。

    为什么这不只是"不好看"：参照板的读者是设计模型，它看图学的是「这一格该放
    什么形状的内容」。一根灰条什么都没说——分不清那格装的是三位数计数、金额
    还是日期，列宽/对齐/字号全学不到，信息层级也塌了。

    V5.7 架构图当时就写下了这个风险："改写 LLM 漏掉哪一条，那一张图就会复发
    对应的老 bug。" 所以这里两头都钉：既要有占位形状，也要点名禁掉灰条。
    """
    from services.freeform_block import _SHEET_PROMPT_REFINE_SYSTEM as sys_prompt

    # ① 按字段形状占位——各类字段至少给出范例
    for shape in ("20XX-XX-XX", "¥ ××,×××", "××.×%", "×,×××"):
        assert shape in sys_prompt, shape
    # ② 点名禁掉那个具体的退化形态
    assert "灰色横条" in sys_prompt
    assert "留空" in sys_prompt
    # ③ 信息层级要画满——坐标轴刻度这类最容易被省掉的也点名
    assert "坐标轴刻度" in sys_prompt
    # ④ 不能因此把「不许出现真实数据」那条挤掉——两条是一组，只留一条就会
    #    从"画灰条"翻车成"编一套自洽的假数据"（真机撞过：环图各段加起来正好
    #    等于 KPI 总数）。
    assert "不能出现任何真实数据" in sys_prompt


def test_design_brief_covers_stats_and_charts():
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "订单总数" in brief
    assert "总金额" in brief
    assert "状态分布" in brief
    # 字段/实体用中文标签，不是裸 id——这是喂给 LLM 的自然语言线索
    assert "金额" in brief
    assert "状态" in brief


def test_design_brief_lists_row_content_outside_the_mandatory_section():
    """rankings/feeds 不进「必须包含」清单，但要作为**可画的逐行内容**列出来。

    两层语义（2026-08-03 起）：
    - **不在**必须清单里：必须画的只有 KPI 与图表，逐行内容看参照图有没有；
    - **在**逐行内容清单里：模型得知道这一页有哪些一行一行的东西可画、
      数据绑哪个实体哪个字段，否则它只能瞎猜或干脆不画。
    """
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    required_section = brief.split("这一页还有下面这些")[0]
    assert "金额排行" not in required_section
    assert "工单动态" not in required_section
    # 但在逐行内容那一段里要出现，并且给出数据来源
    assert "金额排行" in brief and "工单动态" in brief
    assert "rowsRef" in brief
    # 用业务语言给数据来源，不再是可照抄的 blockRef JSON
    assert '"type": "RankedList"' not in brief
    assert "blockRef" not in brief


def test_choice_scope_never_swallows_the_mandatory_lists():
    """取舍话术出现时，"必须包含"的措辞必须同时在场且未被削弱。"""
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "必须包含的 KPI 统计卡" in brief
    assert "必须包含的图表" in brief
    assert "不能遗漏清单里的任何一项" in brief
    # 旧版那句会把"别凑齐"泛化到所有内容，必须已撤
    assert "别为了凑齐而硬塞" not in brief


def test_design_brief_has_no_placement_demand_without_blocks():
    """没有可安置积木的页面不该出现那段取舍话术（否则是对着空气下命令）。"""
    page = {
        "id": "home", "name": "首页", "kind": "monitor",
        "stats": [{"id": "s1", "name": "总数", "metric": "count", "entity": "appointment"}],
        "charts": [], "rankings": [], "feeds": [], "blocks": [],
    }
    brief = _monitor_overview_design_brief(page, _datamodel())
    assert "备选项" not in brief


def test_design_brief_omits_empty_sections():
    page = {"id": "home", "name": "首页", "kind": "monitor", "stats": [], "charts": [], "rankings": [], "feeds": []}
    brief = _monitor_overview_design_brief(page, _datamodel())
    assert "必须包含的 KPI 统计卡" not in brief
    assert "必须包含的图表" not in brief


def test_enrich_skips_non_monitor_pages(monkeypatch):
    called = []

    def fake_generate(*args, **kwargs):
        called.append(True)
        return {"root": {"tag": "div", "style": {}, "children": []}}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "p1", "kind": "workbench", "stats": [{"id": "s"}]}]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_skips_monitor_page_with_no_declared_content(monkeypatch):
    called = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda *a, **k: called.append(True) or {"root": {"tag": "div", "style": {}, "children": []}},
    )
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "home", "kind": "monitor"}]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_skips_monitor_page_with_only_rankings_or_feeds(monkeypatch):
    called = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda *a, **k: called.append(True) or {"root": {"tag": "div", "style": {}, "children": []}},
    )
    page = {
        "id": "home",
        "kind": "monitor",
        "rankings": [{"id": "r1", "name": "金额排行", "entity": "order", "sortBy": "order.amount", "limit": 5}],
        "feeds": [{"id": "f1", "name": "工单动态", "entity": "ticket", "timeField": "ticket.created_at"}],
    }
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [page]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_writes_freeform_overview_on_success(monkeypatch):
    fake_content = {"root": {"tag": "div", "style": {}, "children": []}}
    captured_kwargs = {}

    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        captured_kwargs.update(kwargs)
        calls.append(kwargs.get("device"))
        assert "订单总数" in brief
        return {"root": dict(fake_content["root"])}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    overview = result["page"]["pages"][0]["freeformOverview"]
    assert overview["root"] == fake_content["root"]
    assert "mobile" not in overview
    assert calls == ["desktop"]
    assert captured_kwargs["theme_id"] == "forest"
    # 原有固定骨架字段必须原样保留——freeformOverview 是追加，不是替换
    assert result["page"]["pages"][0]["stats"]


def test_enrich_fails_open_on_generation_error(monkeypatch):
    def fake_generate(*args, **kwargs):
        raise FreeformGenerationError("boom")

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    page = result["page"]["pages"][0]
    assert "freeformOverview" not in page
    assert page["stats"]  # 固定骨架数据没被动过


def test_enrich_covers_dashboard_pages(monkeypatch):
    """2026-07-27:dashboard 页也纳入设计版式——此前只认 monitor,LLM 把总览
    页写成 dashboard 或夹具用 dashboard 时,首页恒回固定骨架(用户实测)。"""
    called = []

    def fake_generate(*args, **kwargs):
        called.append(kwargs.get("device"))
        return {"root": {"tag": "div", "style": {}, "children": []}}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "d1", "kind": "dashboard", "stats": [{"id": "s"}]}]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == ["desktop"]
    assert "freeformOverview" in result["page"]["pages"][0]


# ── 参照板尺寸与密度预算（2026-07-29 从 4K 改回 1672x941）──────────────


def test_sheet_size_matches_prompt_canvas():
    """请求尺寸与 prompt 里写的画布尺寸必须对得上，**逐档对**。

    这两处分开写在两个地方（常量 + prompt 文案），改一处忘一处的话，模型会
    按一个尺寸排布、实际画布是另一个尺寸，比例直接歪掉。这里钉住它们同步。

    2026-07-31 换到 api.xiaoleai.team 之后这条更要紧了：这家**逐像素认 size**
    （传什么回什么，实测记录见 _DEVICE_IMAGE_SIZE 上方），不像上一家那样无论
    传什么都降档回同一个横版尺寸。所以 prompt 里报的必须是真正传出去的那个值，
    而且手机档要跟桌面档报不一样的数——写死一个常量就等于手机档报错尺寸。
    """
    from services.freeform_block import (
        _build_overview_sheet_prompt,
        _sheet_image_size_for_device,
    )

    for device in ("desktop", "phone", ""):
        size = _sheet_image_size_for_device(device)
        prompt = _build_overview_sheet_prompt(
            "测试", {"entities": []}, theme_id="tangerine", device=device
        )
        assert size in prompt, f"{device!r} 档 prompt 里没报出真实画布 {size}"

    # 手机竖、桌面横：形状由 size 参数保证，不再只靠 prompt 措辞掰。
    pw, ph = (int(x) for x in _sheet_image_size_for_device("phone").split("x"))
    dw, dh = (int(x) for x in _sheet_image_size_for_device("desktop").split("x"))
    assert pw < ph, "手机档必须是竖版画布"
    assert dw > dh, "桌面档必须是横版画布"
    # device 没明说时跟桌面档一致——那一支要并排画两块，本身就是横版。
    assert _sheet_image_size_for_device("") == _sheet_image_size_for_device("desktop")


def test_facts_carry_only_what_the_model_cannot_derive():
    """事实清单只装**三类**事实，一条做法都不许有。

    2026-07-31 重构：此前这里钉的是"砍四类留四类"那份写死模板的边界。那套
    模板每一条都有出图证据，问题出在它对每个应用说同一句话——实测两个完全
    不同业务的出图提示词逐字相同 87%，能变的 13% 全是色值/字段名/内容清单，
    没有一个字关于"怎么排"。所以做法整体挪给 refine 那一步按业务现写，这里
    只保留模型自己推不出来的事实。

    这条守的是**边界不许回流**：谁要是图省事又把"顶部一行指标卡"塞回事实里，
    多样性立刻回到写死模板的水平，而且不会有任何报错。
    """
    facts = _build_overview_sheet_facts(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    # 三类事实都在
    assert "画布：" in facts
    assert "设备档：" in facts
    assert "这一页要覆盖的内容范围" in facts

    # 色板已从事实里拿掉（2026-08-03，用户裁决：首页生图自由发挥）。
    # 此前会附一句"运行时外壳已经按这套渲染了，别偏色"——现在外壳是统一的
    # 白菜单 + 白 Header + 一个品牌主色，参照图的职责只剩版式，不必迁就配色。
    # 这条断言的方向是反的（不许回流），因为把手铐加回去不会有任何报错。
    assert "身份色板" not in facts
    assert "主色 #" not in facts

    # 做法一条都不许有
    for banned in (
        "顶部一行", "最多 2 张图", "多列横向排布",     # 版式处方
        "20XX-XX-XX", "138-", "一个真实数据都不许出现",  # 占位写法
        "技术标识", "rowsRef",                         # 技术标识禁令
        "水印", "画面撑满画布",                        # 水印/铺满
        "信息层级必须画满", "一项都不许漏",             # 信息层级清单
        "字高", "Ant Design",                          # 密度预算 / 控件形态
    ):
        assert banned not in facts, f"事实清单里混进了做法：{banned}"


def test_facts_state_the_device_tier_and_canvas_consistently():
    """设备档与画布必须同时出现且互相自洽——竖版画布配"桌面端"会让改写 LLM
    按宽屏排布，出图却是竖的。两处分开写就一定会分叉，这里钉住。"""
    for device, is_portrait in (("desktop", False), ("phone", True), ("", False)):
        facts = _build_overview_sheet_facts(
            "测试", {"entities": []}, theme_id="tangerine", device=device
        )
        canvas = _sheet_image_size_for_device(device)
        assert canvas in facts
        w, h = (int(x) for x in canvas.split("x"))
        assert (w < h) is is_portrait
        assert ("竖版画布" in facts) is is_portrait


def test_prompt_falls_back_to_facts_when_refine_fails(monkeypatch):
    """改写失败必须静默退回事实清单——绝不能让"想写得更好"把整条链路弄挂。

    与 _generate_overview_sheet_b64 同一套 fail-open 纪律。测试环境本来就没配
    LLM，但这里显式打桩，免得哪天有了默认 provider 让这条用例失去意义。
    """
    import services.freeform_block as fb

    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", lambda *a, **k: None)
    facts = fb._build_overview_sheet_facts(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    prompt = fb._build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert prompt == facts


def test_prompt_uses_the_refined_text_when_refine_succeeds(monkeypatch):
    """改写成功时，最终提示词就是改写结果本身——不再跟旧模板拼接。

    "作为最终内容覆盖"是这次重构的原话：拼接会让写死的做法从后门回来。
    """
    import services.freeform_block as fb

    refined = "改写后的提示词" * 30
    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", lambda *a, **k: refined)
    prompt = fb._build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert prompt == refined


def test_refine_meta_prompt_still_guards_the_two_proven_bugs():
    """做法虽然交给改写 LLM，但两条**有出图证据**的坑必须在元提示词里点名。

    减法实验里唯二"砍掉就复发"的：
      · 技术标识 —— 砍后 brief 里的 blockRef JSON 被当代码块画进图
      · 真实数据 —— 砍后编出一组加起来能对上的自洽假数字，比明显的假数据更危险

    这里不要求元提示词给出逐类字段的形状清单（那正是本次拿掉的），只要求它
    **点到这两件事**，让改写 LLM 自己写出对应的守卫。
    """
    from services.freeform_block import _SHEET_PROMPT_REFINE_SYSTEM as sys_prompt

    assert "技术标识" in sys_prompt and "rowsRef" in sys_prompt
    assert "不能出现任何真实数据" in sys_prompt
    assert "占位形状" in sys_prompt
    # 版式要交给业务性质决定，且明确反掉通用后台网格
    assert "通用后台网格" in sys_prompt
    # 只出正文，别裹 markdown——裹了会被原样喂给生图模型
    assert "不要 markdown 代码块" in sys_prompt


def test_parallel_refine_preserves_order_and_isolates_failures(monkeypatch):
    """批量改写并发发出，但**返回顺序必须与入参一致**，单个失败不拖垮整批。

    顺序错位是这类改造最容易出的错，而且不会报错——只会让手机档拿到桌面档的
    提示词，出图形状全错。
    """
    import services.freeform_block as fb

    def fake(facts, *, device=""):
        if "坏" in facts:
            raise RuntimeError("boom")
        return facts + "|refined" + str(len(facts) * 4)

    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", fake)
    items = [("A", "desktop"), ("坏", "phone"), ("CCC", "desktop")]
    out = fb.refine_sheet_prompts_parallel(items)
    assert len(out) == 3
    assert out[0].startswith("A|refined")
    assert out[1] is None, "失败位置必须是 None，不能塌缩掉"
    assert out[2].startswith("CCC|refined")


def test_desktop_sheet_no_longer_hardcodes_shell_rules():
    """参照图不画外壳这条**从提示词挪走了**，但设计侧那半必须留着。

    两处原本成对：参照图里说"不要画侧边栏"，generate_freeform_block 里说
    "不要在你的内容树里搭这些"。前一半属于"做法"，归改写 LLM 管了；后一半是
    对设计 LLM 的硬约束，跟参照图画不画壳无关，不能跟着一起消失。
    """
    import inspect

    from services.freeform_block import generate_freeform_block

    src = inspect.getsource(generate_freeform_block)
    assert "不要在你的内容树里搭这些" in src, "要明令禁止把外壳搭进内容树"


def test_sheet_generation_receives_the_declared_device(monkeypatch):
    """`enrich_monitor_page_overviews` 必须把 device 转给参照板生成函数，
    不能只转给版式 JSON 生成——两处漏一处，参照板就会继续白画多余的档。"""
    sheet_calls = []

    def fake_sheet(brief, datamodel, **kwargs):
        sheet_calls.append(kwargs.get("device"))
        return None

    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", fake_sheet)
    monkeypatch.setattr("services.freeform_block._supports_image_content_parts", lambda: True)
    # 2026-08-03：参照板的开关是"配没配生图 key"，测试里显式打开
    monkeypatch.setattr("services.freeform_block._image_generation_configured", lambda: True)
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: {"root": {"tag": "div", "children": []}},
    )
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert sheet_calls == ["desktop"], f"参照板生成没收到 device: {sheet_calls}"


def test_declared_phone_designs_only_the_phone_layout(monkeypatch):
    """明说手机档时也只生成一次（原本就是这样，这条把它钉住）。"""
    calls = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("device")),
                                        {"root": {"tag": "div", "children": []}})[1],
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "phone"},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert calls == ["phone"], f"明说手机档却生成了别的档: {calls}"


def test_declared_desktop_skips_the_phone_layout(monkeypatch):
    """**明说桌面档时不许再生成一版手机版式。**

    这是 preferredDevice 这个字段存在的全部意义——省掉的就是这一次调用
    （实测约 67s/总览页）。此前这条路径只被间接覆盖：
    test_sheet_generation_receives_the_declared_device 断言的是"参照板收到了
    desktop"，而**不是**"手机档那次调用没发生"，两者是两回事。

    守的是 freeform_block 里那个双重否定：
        if device != "phone" and not declared_desktop_only:
    这种写法很容易在后续改动里被顺手"化简"成 `if device != "phone"`，而那一改
    正好把省下来的调用又加回去，且没有任何测试会红。
    """
    calls = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("device")),
                                        {"root": {"tag": "div", "children": []}})[1],
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert calls == ["desktop"], f"明说桌面档却仍生成了手机版式: {calls}"
    # 顺带钉住产物形状：没有 mobile 键，前端 availableDeviceTiers 据此只给桌面
    # 一档入口（不给一个通往"没设计过的档位"的门）。
    overview = model["page"]["pages"][0].get("freeformOverview") or {}
    assert "mobile" not in overview, "桌面档不该挂 mobile 设计"


def test_unspecified_device_deterministically_designs_desktop_only(monkeypatch):
    """历史/部分模型进入增强时也只能走一个确定性兜底，不得恢复双生成。"""
    calls = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("device")),
                                        {"root": {"tag": "div", "children": []}})[1],
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    assert calls == ["desktop"]
    assert "mobile" not in result["page"]["pages"][0]["freeformOverview"]


def test_monitor_progress_reports_one_authoritative_device(monkeypatch):
    from services import enrich_timing

    events = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: {"root": {"tag": "div", "children": []}},
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    enrich_timing.set_stage_sink(
        lambda phase, name, fields: events.append((phase, name, dict(fields)))
    )
    try:
        enrich_monitor_page_overviews(
            {
                "datamodel": _datamodel(),
                "appbundle": {
                    "appIdentity": {"theme": "forest"},
                    "preferredDevice": "phone",
                    "deviceAuthority": "single-v1",
                },
                "page": {"pages": [_monitor_page()]},
            }
        )
    finally:
        enrich_timing.set_stage_sink(None)

    design_starts = [
        fields
        for phase, name, fields in events
        if phase == "start" and name == "monitor.design"
    ]
    assert design_starts == [
        {"page": "home", "device": "phone", "current": 1, "total": 1}
    ]


def test_reference_image_is_analyzed_persisted_and_passed_to_page_generation(monkeypatch):
    from services import freeform_block, page_reconstruction, sheet_palette

    seen = {"analysis": 0, "prompt": None}

    def fake_analysis(image, **kwargs):
        seen["analysis"] += 1
        assert image == "sheet-image"
        assert kwargs["device"] == "desktop"
        return {
            "version": "page-reconstruction-v1",
            "status": "ready",
            "spec": {"device": "desktop", "regions": [{"id": "hero"}]},
            "prompt": "RECONSTRUCT hero at x=0.000 width=1.000",
            "diagnostic": "",
        }

    def fake_design(brief, datamodel, **kwargs):
        seen["prompt"] = kwargs.get("reconstruction_prompt")
        return {"root": {"tag": "div", "children": []}}

    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    monkeypatch.setattr(freeform_block, "_generate_overview_sheet_b64", lambda *a, **k: "sheet-image")
    monkeypatch.setattr(page_reconstruction, "analyze_page_reference", fake_analysis)
    monkeypatch.setattr(sheet_palette, "extract_chart_palette", lambda image: [])
    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_design)

    model = {
        "datamodel": _datamodel(),
        "appbundle": {"landingPageRef": "home", "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    page = enrich_monitor_page_overviews(model)["page"]["pages"][0]

    assert seen == {
        "analysis": 1,
        "prompt": "RECONSTRUCT hero at x=0.000 width=1.000",
    }
    assert page["pageReconstruction"]["status"] == "ready"
    assert page["pageReconstruction"]["spec"]["regions"][0]["id"] == "hero"


def test_missing_reference_image_persists_skipped_reconstruction(monkeypatch):
    from services import freeform_block

    seen = []
    monkeypatch.setattr(freeform_block, "_generate_overview_sheet_b64", lambda *a, **k: None)
    monkeypatch.setattr(
        freeform_block,
        "generate_freeform_block",
        lambda brief, datamodel, **kwargs: (
            seen.append(kwargs.get("reconstruction_prompt"))
            or {"root": {"tag": "div", "children": []}}
        ),
    )
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"landingPageRef": "home", "preferredDevice": "phone"},
        "page": {"pages": [_monitor_page()]},
    }

    page = enrich_monitor_page_overviews(model)["page"]["pages"][0]

    assert seen == [None]
    assert page["pageReconstruction"] == {
        "version": "page-reconstruction-v1",
        "status": "skipped",
        "spec": None,
        "prompt": "",
        "diagnostic": "reference image unavailable",
    }


def test_marketing_landing_separates_full_page_reference_from_hero_media(monkeypatch):
    from services import freeform_block, page_reconstruction, sheet_palette
    from services.app_preview import OverviewPreviewSink

    generated = []
    design_kwargs = {}

    def fake_image(*args, **kwargs):
        generated.append((kwargs.get("marketing_page"), kwargs.get("marketing_hero")))
        return "full-page-reference" if kwargs.get("marketing_page") else "hero-media"

    def fake_analysis(image, **kwargs):
        assert image == "full-page-reference"
        return {
            "version": "page-reconstruction-v1",
            "status": "ready",
            "spec": {"device": "desktop", "regions": [{"id": "hero"}]},
            "prompt": "FULL PAGE CONTRACT",
            "diagnostic": "",
        }

    def fake_design(*args, **kwargs):
        design_kwargs.update(kwargs)
        return {"root": {"tag": "div", "children": []}}

    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    monkeypatch.setattr(freeform_block, "_generate_overview_sheet_b64", fake_image)
    monkeypatch.setattr(page_reconstruction, "analyze_page_reference", fake_analysis)
    monkeypatch.setattr(sheet_palette, "extract_chart_palette", lambda image: [])
    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_design)
    sink = OverviewPreviewSink()
    page = {
        "id": "home",
        "name": "星野营地",
        "kind": "monitor",
        "presentation": "marketing-landing",
    }
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"landingPageRef": "home", "preferredDevice": "desktop"},
        "page": {"pages": [page]},
    }

    enrich_monitor_page_overviews(model, preview_sink=sink)

    assert sorted(generated) == [(False, True), (True, False)]
    assert sink.png_b64 == "hero-media"
    assert design_kwargs["reference_image_b64"] == "full-page-reference"
    assert design_kwargs["landing_media_b64"] == "hero-media"
    assert design_kwargs["full_page_visual"] is True
    assert design_kwargs["reconstruction_prompt"] == "FULL PAGE CONTRACT"


def test_generation_contract_teaches_how_to_pick_the_device():
    """契约里必须有「怎么选 preferredDevice」这段判据，而且必须是姿态口径。

    只声明合法域不给判据的后果是实测出来的：9 个真实应用 9 个 desktop，字段是
    死的，下游那个省时判断（明说桌面就跳过手机档）也就无从做起。两个方向的
    坑也要在正文里——只教一个方向，模型会把所有现场词都往那一边推。
    """
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    # 钉通电的插座：模块级指令才是生成侧真用的。只测
    # experience_block_prompt_block() 会让叶子占位符路径假绿。
    body = _SCHEMA_INSTRUCTION
    assert "preferredDevice" in body
    assert "POSTURE" in body.upper(), "判据必须是姿态，不是关键词"
    assert "courier" in body and "dispatcher" in body, "缺「带现场词的后台需求」这一向"
    assert "inspection work order" in body and "walking around" in body, \
        "缺「带后台词的现场需求」这一向"
    assert "MUST choose exactly one" in body
    assert "NEVER omit" in body
    from services.archetype_legal import device_domain_bar

    bar = device_domain_bar()
    assert f"preferredDevice '{bar}'" in body
    assert "tablet" in bar
    assert "emit an unsupported device" in body
    # ⚠ 2026-08-30：不能 `assert "watch" not in body`。Step 8 前文有
    # "watching live state"，子串会误伤。钉的是带引号的设备词。
    step8 = body.split("Step 9")[0]
    assert "'watch'" not in step8
    assert '"watch"' not in step8


# ── monitor 页放开 page.blocks（2026-07-31）─────────────────────────────


def _monitor_page_with_blocks():
    page = _monitor_page()
    page["blocks"] = [
        {"id": "qa", "type": "QuickActionPanel", "props": {"title": "常用操作", "columns": 3}},
        {"id": "wf", "type": "WorkflowTimeline", "props": {"title": "审批流程", "chainRef": "chain_main"}},
    ]
    return page


def test_generation_contract_no_longer_exempts_monitor_pages_from_blocks():
    """生成契约必须明说 monitor 页也要摆积木。

    此前两处合起来把总览页排除在外——祈使句只点名 workbench/kanban/calendar/
    wizard，CHANNEL OWNERSHIP 又说"monitor 页照常声明 stats/charts"。实测后果：
    19 个真实页面里 page.blocks 声明数 0，QuickActionPanel / WorkflowTimeline
    这两个 generationEnabled=true 的区块从未被生成过。
    """
    from services.schema_legal import experience_block_prompt_block

    text = experience_block_prompt_block()
    assert "monitor / dashboard pages are NOT exempt" in text
    # KPI/趋势区块的禁令仍在，且明确写清它只管这两类，不是禁掉整个 page.blocks
    assert "Do NOT emit MetricGrid or TrendChart blocks there" in text
    assert "not a ban on page.blocks for overview pages" in text
    # 放行名单从目录派生，且不含被 CHANNEL OWNERSHIP 挡掉的三类。
    #
    # ⚠ 按**逗号切出来的整名**比，不能用子串（2026-08-10 修）。
    #
    # 原来是 `assert banned not in seg`。目录涨到 359 个区块之后名单里出现了
    # `ReleaseAdoptionTrendChart` —— 它**包含**子串 "TrendChart"，于是这条断言
    # 判它违规。可它是一个独立区块，跟被禁的 TrendChart 毫无关系。
    #
    # 这是本仓记过一次的同一类错误（v5_capability_executor 的域识别注释：裸子串
    # 让 "sla" 命中 translation / island / slack）。判据该是"名单里有没有这一项"，
    # 不是"这串字符出现过没有"。
    seg = text.split("monitor / dashboard pages are NOT exempt")[1].split("\n")[0]
    allowed = {name.strip() for name in seg.replace(":", ",").split(",")}
    for banned in ("MetricGrid", "TrendChart", "DataTable"):
        assert banned not in allowed, (
            f"{banned} 不该出现在总览页的放行名单里；"
            f"名单里形近的有：{sorted(n for n in allowed if banned in n)}"
        )


def test_generation_contract_json_skeleton_exposes_blocks():
    """光在说明里讲不够——JSON 骨架里没有 blocks 键，模型不知道往哪写。

    骨架和说明是两处，历史上分叉过（07-28 那次补了说明没补骨架，仍然 0 产出）。
    这条把两处钉在一起。
    """
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    page_section = _SCHEMA_INSTRUCTION.split('"page": {')[1].split('"aigc": {')[0]
    assert '"blocks": [' in page_section, "page 骨架里必须有 blocks 键"
    assert '"type": "<experience block type>"' in page_section


def test_image_audience_brief_carries_no_technical_identifiers():
    """参照板出图的 brief 里不许出现 blockRef/binding/JSON 这类技术标识。

    这份 brief 被 _build_overview_sheet_facts 整段照抄进出图提示词。此前两个
    受众共用一份（blockRef 的技术形态），后果是生图模型读到
    {"type": "ActivityFeed", "binding": {...}} 无从知道该画什么——参照板上
    一直没有这些积木，原因在此，不是它判断"这一页不需要"。架构图那条
    "画面里不许出现 JSON/字段id/blockRef 等技术标识"针对的也是这里。
    """
    page = _monitor_page()
    page["blocks"] = [
        {"id": "acts", "type": "QuickActionPanel", "props": {"title": "常用操作"}},
        {"id": "flow", "type": "WorkflowTimeline", "props": {}},
    ]
    img = _monitor_overview_design_brief(page, _datamodel(), audience="image")
    for forbidden in ("blockRef", "binding", '{"type"', "照抄"):
        assert forbidden not in img, f"出图 brief 混进了技术标识: {forbidden}"


# ── 设计者的否决权（2026-08-01，方案 B）────────────────────────────
#
# 语义：设计 LLM 没有摆进版式的可嵌积木 = 它判断这一页用不上 → 真的移除。
# 此前"不摆"没有出口：积木照样渲染，只是掉到设计外面，比摆了还糟。


def _page_with_blocks():
    page = _monitor_page()
    page["blocks"] = [
        {"id": "acts", "type": "QuickActionPanel", "props": {"title": "常用操作"}},
        {"id": "flow", "type": "WorkflowTimeline", "props": {}},
    ]
    page["layout"] = {"summary": ["acts"], "primary": ["flow"]}
    return page


def _design_with(*types):
    children = [{"tag": "div", "blockRef": {"type": t, "binding": {}, "props": {}}} for t in types]
    return {"root": {"tag": "div", "style": {}, "children": children}}


def _run_enrich(page, design, monkeypatch):
    monkeypatch.setattr("services.freeform_block.generate_freeform_block", lambda *a, **k: design)
    monkeypatch.setattr("services.freeform_block._supports_image_content_parts", lambda: False)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}, "preferredDevice": "desktop"},
        "page": {"pages": [page]},
    }
    return enrich_monitor_page_overviews(model)["page"]["pages"][0]


def test_all_placed_keeps_everything(monkeypatch):
    page = _run_enrich(
        _page_with_blocks(), _design_with("QuickActionPanel", "WorkflowTimeline"), monkeypatch
    )
    assert [b["id"] for b in page["blocks"]] == ["acts", "flow"]


def test_generation_failure_removes_nothing(monkeypatch):
    """设计生成失败 → 回落固定骨架，此时一个都不能删（否则内容凭空消失）。"""

    def boom(*a, **k):
        raise FreeformGenerationError("boom")

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", boom)
    monkeypatch.setattr("services.freeform_block._supports_image_content_parts", lambda: False)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}, "preferredDevice": "desktop"},
        "page": {"pages": [_page_with_blocks()]},
    }
    page = enrich_monitor_page_overviews(model)["page"]["pages"][0]
    assert [b["id"] for b in page["blocks"]] == ["acts", "flow"]
    assert "freeformOverview" not in page


def test_non_embeddable_block_is_never_pruned(monkeypatch):
    """不可嵌类型压根没有"摆进设计"这个选项，不能按未安置移除。"""
    page = _page_with_blocks()
    page["blocks"].append({"id": "tbl", "type": "DataTable", "binding": {"entityRef": "order"}})
    out = _run_enrich(page, _design_with("QuickActionPanel", "WorkflowTimeline"), monkeypatch)
    assert "tbl" in [b["id"] for b in out["blocks"]]


def test_prune_matches_by_type_not_instance(monkeypatch):
    """保守偏向保留：设计里出现过该类型就整类保留，宁可多留不误删。"""
    page = _monitor_page()
    page["blocks"] = [
        {"id": "feed_a", "type": "ActivityFeed", "binding": {"entityRef": "ticket", "timeFieldRef": "created_at"}},
        {"id": "feed_b", "type": "ActivityFeed", "binding": {"entityRef": "order", "timeFieldRef": "created_at"}},
    ]
    out = _run_enrich(page, _design_with("ActivityFeed"), monkeypatch)
    assert [b["id"] for b in out["blocks"]] == ["feed_a", "feed_b"]

