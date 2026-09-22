"""页面形态预设：给模型"已经排好的组合"，而不是一堆散积木。

## 这批预设为什么存在

2026-08-07 用户的判断：「首先让 AI 去设计，感觉有点不现实，因为他也搞不出来
很好的组件」。症结不在积木不够（当时已有 13 个），在于**从零编排**这件事对
模型太难，而且每次结果都不一样。

对照阿里 lowcode-engine 的物料协议，它比我们多的正是这一样：`snippets`——
"用户从组件面板拖入组件时会向页面 schema 中插入 snippets 中定义的低代码
schema"，也就是**拖进来的不是裸组件，是一段排好的片段**。这里照这个思路做
成页面级：模型先挑一套，再把每个积木绑到真实实体/字段上。选型从"发明"降级
成"挑选"，绑定那一步本来就有 bindingSchema 与门禁把关。

## 这组测试钉的是"预设不能骗人"

预设是手写的，而它引用的每个 (type, slot) 都得同时满足三件事：区块放开了
生成、这种页面允许它、这个槽位允许它。手写的东西会漂——今天改了某个区块的
allowedSlots，明天预设就在推荐一个门禁必拦的组合，而模型会照着抄。

那种失败特别难查：模型"照做了"，每次却都被门禁打回，日志里看到的是模型不
听话，实际是我们给的示范本身违规。所以坏预设必须在**服务启动时**就炸，
跟 bindingSchema 自检同一条纪律。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import schema_legal as L


def test_every_preset_block_is_legal_where_it_is_placed():
    """预设推荐的每个 (type, slot) 都必须过契约——这是这批预设的全部价值。

    推荐一个门禁会拦的组合，比不推荐更糟：模型照做，然后被打回，两边都以为
    是对方的问题。
    """
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets:
            for it in ps["blocks"]:
                t, slot = it["type"], it["region"]
                entry = by_type[t]
                assert entry.get("generationEnabled"), f"{kind}/{ps['id']}: {t} 未放开生成"
                assert kind in entry["pageKinds"], (
                    f"{kind}/{ps['id']}: {t} 不允许出现在 {kind} 页"
                )
                assert slot in entry["allowedRegions"], (
                    f"{kind}/{ps['id']}: {t} 不允许放在 {slot}"
                )


def test_monitor_presets_respect_the_forbidden_four():
    """总览页那四个禁用区块，预设里一个都不许出现。

    MetricGrid / TrendChart / DataTable / FilterBar 在总览页是**惰性的**
    （理由见 experience_block_prompt_block 里那段：前两个会把同一批数字画
    第二遍，DataTable 要全宽，FilterBar 筛不动任何东西）。prompt 里已经有
    一条硬禁令，预设要是又把它们摆出来，就是自己打自己。
    """
    forbidden = {"MetricGrid", "TrendChart", "DataTable", "FilterBar"}
    for kind in ("monitor", "dashboard"):
        for ps in L.PAGE_KIND_PRESETS.get(kind, ()):
            used = {it["type"] for it in ps["blocks"]}
            assert not (used & forbidden), (
                f"{kind}/{ps['id']} 用了总览页禁用区块: {sorted(used & forbidden)}"
            )


def test_bad_preset_fails_at_startup_not_at_runtime():
    """坏预设必须当场炸，不能带病进 Prompt。

    分三种坏法各验一次——它们是真会发生的三种漂移：改了 generationEnabled、
    改了 pageKinds、改了 allowedSlots，而预设没跟着改。
    """
    blocks = L.EXPERIENCE_BLOCKS
    cases = {
        "槽位不合法": {"workbench": [{"id": "x", "name": "n", "when": "w",
                                   "blocks": [{"type": "DataTable", "region": "filters"}]}]},
        "页面形态不合法": {"wizard": [{"id": "x", "name": "n", "when": "w",
                                   "blocks": [{"type": "DataTable", "region": "main"}]}]},
        "未放开生成": {"monitor": [{"id": "x", "name": "n", "when": "w",
                                 "blocks": [{"type": "FreeformInsight", "region": "main"}]}]},
    }
    for label, bad in cases.items():
        original = L._BLOCK_CATALOG.get("pageKindPresets")
        L._BLOCK_CATALOG["pageKindPresets"] = bad
        try:
            with pytest.raises(ValueError):
                L._load_page_kind_presets(blocks)
        finally:
            if original is None:
                L._BLOCK_CATALOG.pop("pageKindPresets", None)
            else:
                L._BLOCK_CATALOG["pageKindPresets"] = original


def test_presets_reach_the_prompt_with_the_reason_attached():
    """预设要进 prompt，而且**每条都得带上"什么时候用"**。

    只丢一张组合表，模型无从判断该挑哪一套，会退回按直觉猜——本仓库反复
    验证过措辞与理由决定行为（许可式让七个通电区块一次都没被用；
    WorkflowTimeline 被摆进窄栏 5 次是因为只给了 slots 表没给理由）。
    """
    prompt = L.experience_block_prompt_block()
    assert "PROVEN LAYOUTS" in prompt
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets:
            assert ps["name"] in prompt, f"{kind}/{ps['id']} 没进 prompt"
            assert ps["when"] in prompt, f"{kind}/{ps['id']} 进了 prompt 但没带理由"
            for it in ps["blocks"]:
                assert f"{it['type']}@{it['region']}" in prompt


def test_prompt_says_presets_are_a_starting_point_not_a_cage():
    """必须明说"业务需要时照常自己排"。

    只给预设不给这句话，会把模型逼进另一个极端：只会抄这几套，遇到真正
    不一样的业务也硬套。这跟"从零发明"是同一枚硬币的两面。
    """
    prompt = L.experience_block_prompt_block()
    assert "Composing your own set is allowed and expected" in prompt


def test_every_live_page_kind_has_at_least_one_preset():
    """六种页面形态都得有预设——漏掉的那种就退回从零发明了。

    这条会在新增 pageKind 时红，逼着补预设，而不是让新形态悄悄没有起点。
    """
    for kind in L.PAGE_KINDS:
        assert L.PAGE_KIND_PRESETS.get(kind), f"页面形态 {kind} 没有任何预设"


def test_width_hungry_blocks_never_land_in_the_narrow_support_column():
    """需要完整宽度的积木不能被预设摆进右侧窄列。

    ## 这条是预设视图当场抓出来的

    2026-08-07：预设刚接进组件库页就看见「流程条 + 单页表单」里的 RecordForm
    被压成了右侧窄条——而它自己的 slotsRationale 明写着"a form needs full
    label+control width"。**契约没被违反**（content 确实在 RecordForm 的
    allowedSlots 里），违反的是我对渲染结果的预期。

    机制在 business-page-layout.upgradeLegacySlotsToGrid：非 dashboard 形态下

    2026-08-08 第三轮：旧五槽整套退休了，这条跟着换到区域词汇。

    实测过的宽度（跑 upgradeLegacySlotsToGrid 量出来的，12 栅格）：

        summary / primary                → 12  全宽
        secondary / activity             → 4   窄列（看板日历 3）
        content                          → 仪表盘 12、其它页型 4

    也就是五个名字只有两种行为，content 还随页型变。这正是推翻它们的依据。
    换到区域之后窄的只剩 aside 一个，判据清楚了。

    ## 为什么钉在预设这一层而不是收窄 allowedRegions

    RecordForm 放进窄列本身不是非法的：一个窄的表单也能用，只是不好用。
    真正不能接受的是**我们推荐的示范**把它摆在那里——模型会照抄，用户看到的
    就是一排挤成一条的输入框。契约管"合不合法"，预设管"好不好"，两层各管各的。
    """
    NARROW = {"aside"}
    WIDTH_HUNGRY = {"RecordForm", "StepsForm", "DataTable", "WorkflowTimeline"}
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets:
            for it in ps["blocks"]:
                if it["type"] in WIDTH_HUNGRY:
                    assert it["region"] not in NARROW, (
                        f"{kind}/{ps['id']}: {it['type']} 摆在 {it['region']}，"
                        f"aside 是 4/12 的窄列——这个积木要整行宽"
                    )


def test_only_containers_may_carry_children():
    """children **只有容器类积木能有**。

    这不是洁癖。渲染侧多数积木把 children 当成"遗留适配内容"直接原样返回
    （block-registry 每个渲染器开头那句 `if (children != null) return
    <>{children}</>`），所以给 DataTable 塞 children 会让它变成一个只显示
    别人、自己什么都不画的空壳——页面上看着像那个表格坏了。

    模型确实会这么写（它没理由知道这条实现细节），所以组装侧剥掉并如实上报。
    """
    from services.block_assembler import _validate

    dm = {"entities": [{"id": "order", "fields": [{"id": "name"}]}]}
    kept, dropped = _validate(
        "workbench",
        [
            {"id": "b1", "type": "DataTable", "region": "main",
             "binding": {"entityRef": "order"}, "children": ["b2"]},
            {"id": "b2", "type": "RecordDetail", "region": "aside",
             "binding": {"entityRef": "order"}},
        ],
        dm,
    )
    assert kept[0]["children"] == [], "非容器的 children 必须被剥掉"
    assert not kept[1].get("nested"), "被非法引用的积木仍应独立占槽位"
    assert any("只有容器" in d["why"] for d in dropped), "剥掉了就要说出来"


def test_container_children_must_point_at_surviving_blocks():
    """容器只能装**同一批里真的留下来的**积木。

    模型可能引用一个被剔除的积木，或者干脆编一个 id。悬空引用留着会让容器
    渲染成空卡片，而空卡片看起来像"这里本来该有东西但坏了"——比不放这个
    容器更糟。
    """
    from services.block_assembler import _validate

    dm = {"entities": [{"id": "order", "fields": [{"id": "name"}]}]}
    kept, dropped = _validate(
        "workbench",
        [
            {"id": "c1", "type": "ContentCard", "region": "aside",
             "props": {"title": "详情"}, "children": ["real", "编的"]},
            {"id": "real", "type": "RecordDetail", "region": "aside",
             "binding": {"entityRef": "order"}},
        ],
        dm,
    )
    card = next(b for b in kept if b["type"] == "ContentCard")
    assert card["children"] == ["real"], "悬空引用必须断开"
    assert any("不存在" in d["why"] for d in dropped), "断开了就要说出来"
    nested = next(b for b in kept if b["id"] == "real")
    assert nested.get("nested"), "被装进容器的积木不该再单独占槽位"
