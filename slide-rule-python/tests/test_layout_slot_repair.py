"""放错槽位的区块挪回首选槽位（services/v5_model_repair._repair_layout_slot_violations）。

背景：开了目录窄化之后模型真在用大量特定场景件，而这些件的槽位约束比泛用件紧，
于是首轮过闸失败里 4/6 趟都是「block X is not allowed in slot Y」。

要守住的：
  · **挪，不摘**。客户端 AppRuntimeScreen 里声明了 layout 时没进槽位的区块压根
    不渲染，摘掉 ref 等于把区块从页面上抹掉；
  · 挪到 `allowedRegions[0]`——目录 authored 的首选位置，不是我猜的顺序；
  · 认不出来的一律不动，留给门（fail-closed 不变）。
"""

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.schema_legal import EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE as ALLOWED
from services.v5_model_repair import repair_five_system_model


def _model(layout, blocks):
    return {
        # 字段/aigc 不能空：门在 Step 7（layout 校验）**之前**就会因
        # "empty skill section: aigc" 短路返回，layout 那段压根跑不到。
        # 这条端到端用例第一版就是这么假绿的——夹具太薄，门还没走到要测的地方。
        "datamodel": {
            "entities": [
                {
                    "id": "alert",
                    "name": "告警",
                    "fields": [
                        {"id": "title", "name": "标题", "type": "string"},
                        {"id": "summary", "name": "摘要", "type": "string"},
                    ],
                }
            ]
        },
        "rbac": {"roles": [{"id": "ops", "name": "运维"}], "permissions": [], "menus": []},
        "workflow": {"id": "wf", "name": "流程", "nodes": [], "transitions": [], "chains": []},
        "page": {
            "pages": [
                {
                    "id": "p1",
                    "name": "页面",
                    "kind": "workbench",
                    "blocks": blocks,
                    "layout": layout,
                }
            ]
        },
        "aigc": {
            "capabilities": [
                {
                    "id": "cap_summary",
                    "name": "生成摘要",
                    "inputFields": ["alert.title"],
                    "outputField": "alert.summary",
                    "roleRefs": ["ops"],
                }
            ]
        },
        "appbundle": {"landingPageRef": "p1"},
    }


def _layout(result):
    return result["model"]["page"]["pages"][0]["layout"]


def _slot_of(result, block_id):
    for slot, refs in _layout(result).items():
        if isinstance(refs, list) and block_id in refs:
            return slot
    return None


def test_合法槽位不动():
    m = _model({"main": ["b1"]}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "main"
    assert not (r.get("layoutSlots") or {})


def test_越界的被挪到首选槽位():
    """MuteTimingSchedule 的 allowedRegions 是 (main, aside, supplement)。"""
    assert ALLOWED["MuteTimingSchedule"][0] == "main"
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "main"
    moved = (r["layoutSlots"] or {})["moved"]
    assert moved[0]["from"] == "overlay" and moved[0]["to"] == "main"


def test_首选顺序按目录声明而不是写死_main():
    """ActivityFeed 的首选是 aside 而不是 main——顺序是 authored 的。

    这条是哨兵：要是有人把实现改成"一律挪去 main"，它会红。
    """
    assert ALLOWED["ActivityFeed"][0] == "aside"
    m = _model({"charts": ["b1"]}, [{"id": "b1", "type": "ActivityFeed"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "aside"


def test_绝不把区块摘掉():
    """最要紧的一条：声明了 layout 时没进任何槽位的区块压根不渲染。"""
    m = _model({"metrics": ["b1"]}, [{"id": "b1", "type": "WorkflowTimeline"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") is not None, "区块被挪丢了——那等于把它从页面上抹掉"


def test_目标槽位已有别的区块时是追加不是覆盖():
    m = _model(
        {"main": ["b0"], "overlay": ["b1"]},
        [{"id": "b0", "type": "DataTable"}, {"id": "b1", "type": "MuteTimingSchedule"}],
    )
    r = repair_five_system_model(m)
    assert _layout(r)["main"] == ["b0", "b1"]


def test_不产生重复():
    m = _model(
        {"main": ["b1"], "overlay": ["b1"]},
        [{"id": "b1", "type": "MuteTimingSchedule"}],
    )
    r = repair_five_system_model(m)
    assert _layout(r)["main"].count("b1") == 1
    assert "b1" not in (_layout(r).get("overlay") or [])


def test_幂等():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    once = repair_five_system_model(m)["model"]
    twice = repair_five_system_model(once)
    assert twice["model"]["page"]["pages"][0]["layout"] == once["page"]["pages"][0]["layout"]
    assert not (twice.get("layoutSlots") or {})


def test_不改入参():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "MuteTimingSchedule"}])
    snapshot = copy.deepcopy(m)
    repair_five_system_model(m)
    assert m == snapshot


# ── 认不出来的一律不动 ──────────────────────────────────────────────────────


def test_不认识的区块类型不动():
    m = _model({"overlay": ["b1"]}, [{"id": "b1", "type": "TotallyMadeUpBlock"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "b1") == "overlay"


def test_悬空_ref_不动():
    """layout 指了个 page.blocks 里没有的 id —— 门已有 DANGLING 判据。"""
    m = _model({"overlay": ["ghost"]}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _slot_of(r, "ghost") == "overlay"


def test_槽位值不是数组时不动():
    """`layout: {slots: {...}}` 这类多包一层的形状交给门（它有专门的提示语）。"""
    m = _model({"slots": {"main": ["b1"]}}, [{"id": "b1", "type": "DataTable"}])
    r = repair_five_system_model(m)
    assert _layout(r)["slots"] == {"main": ["b1"]}


def test_没有_layout_的页不受影响():
    m = _model({}, [{"id": "b1", "type": "DataTable"}])
    m["page"]["pages"][0].pop("layout")
    r = repair_five_system_model(m)
    assert "layout" not in r["model"]["page"]["pages"][0]


# ── 与门对齐 ───────────────────────────────────────────────────────────────


def test_修完之后门不再报槽位违规():
    """端到端：修完再过门，PUBLISH_ENUM_VIOLATION 的槽位那条应当消失。"""
    from services.v5_model_gate import validate_five_system_model

    m = _model(
        {"overlay": ["b1"], "metrics": ["b2"]},
        [
            {"id": "b1", "type": "MuteTimingSchedule", "binding": {"entityRef": "alert"}},
            {"id": "b2", "type": "WorkflowTimeline"},
        ],
    )
    before = [
        f for f in (validate_five_system_model(m).get("findings") or [])
        if "is not allowed in slot" in str(f.get("message") or "")
    ]
    assert before, "夹具本身应当先触发槽位违规"
    fixed = repair_five_system_model(m)["model"]
    after = [
        f for f in (validate_five_system_model(fixed).get("findings") or [])
        if "is not allowed in slot" in str(f.get("message") or "")
    ]
    assert after == [], f"修完仍报槽位违规: {after}"


# ── 槽位名撞车：metrics/charts 槽 vs page.stats/page.charts ────────────────


def _model_with_panels(layout):
    m = _model(layout, [{"id": "b1", "type": "DataTable"}])
    pg = m["page"]["pages"][0]
    pg["kind"] = "monitor"
    pg["stats"] = [
        {"id": "firing_alerts", "name": "触发中", "entity": "alert", "metric": "count"},
        {"id": "pending_alerts", "name": "待确认", "entity": "alert", "metric": "count"},
    ]
    pg["charts"] = [
        {"id": "alert_trend", "name": "趋势", "type": "line",
         "dimension": "alert.title", "metric": "count"},
    ]
    return m


def test_塞进槽位的_stat_chart_id_被摘掉():
    """2026-08-10 两趟独立复现、形态一模一样：slot=metrics 收 stats 的 id、
    slot=charts 收 charts 的 id。槽位名就叫 metrics/charts，模型的读法合乎字面。

    摘掉是安全的：总览页 stats/charts 归 freeformOverview 那条通道渲染，layout
    槽位压根不参与——运行时本来就忽略，只有门在硬拦。
    """
    m = _model_with_panels({"metrics": ["firing_alerts", "pending_alerts"],
                            "charts": ["alert_trend"], "main": ["b1"]})
    r = repair_five_system_model(m)
    lay = _layout(r)
    assert lay.get("metrics") == []
    assert lay.get("charts") == []
    assert lay.get("main") == ["b1"], "真正的区块 ref 不能被牵连"
    dropped = (r["layoutSlots"] or {})["droppedPanelRefs"]
    assert {d["ref"] for d in dropped} == {"firing_alerts", "pending_alerts", "alert_trend"}


def test_认不出来的_ref_不摘_留给门():
    """纪律：只摘**已证实是 stats/charts/rankings/feeds** 的 id。拼错/凭空造的
    不碰——门有 DANGLING 判据，在这儿猜只会把"引用错了"伪装成"没这回事"。"""
    m = _model_with_panels({"metrics": ["totally_made_up_id"], "main": ["b1"]})
    r = repair_five_system_model(m)
    assert _layout(r)["metrics"] == ["totally_made_up_id"]


def test_rankings_与_feeds_的_id_同样处理():
    """⚠️ 夹具必须让 ranking/feed 本身**合法**（sortBy 指 number、timeField 指
    date）。第一版拿 alert.title（string）当 sortBy，于是
    _repair_presentation_layer 在本条修复之前就把这两条整条剔除了——id 随之消失、
    自然认不出是面板 id，测试红在"没摘掉"上，看着像实现坏了，其实是夹具无效。
    """
    m = _model(({"main": ["b1"], "supplement": ["top_rules", "recent_events"]}),
               [{"id": "b1", "type": "DataTable"}])
    m["datamodel"]["entities"][0]["fields"] += [
        {"id": "hits", "name": "次数", "type": "number"},
        {"id": "at", "name": "时间", "type": "date"},
    ]
    pg = m["page"]["pages"][0]
    pg["rankings"] = [{"id": "top_rules", "name": "排行", "entity": "alert",
                       "sortBy": "alert.hits", "limit": 5}]
    pg["feeds"] = [{"id": "recent_events", "name": "动态", "entity": "alert",
                    "timeField": "alert.at"}]
    r = repair_five_system_model(m)
    assert _layout(r)["supplement"] == []


def test_摘面板_ref_后门不再报_layout_悬空():
    from services.v5_model_gate import validate_five_system_model

    m = _model_with_panels({"metrics": ["firing_alerts"], "charts": ["alert_trend"],
                            "main": ["b1"]})
    before = [f for f in (validate_five_system_model(m).get("findings") or [])
              if "layout block ref" in str(f.get("message") or "")]
    assert before, "夹具本身应当先触发 layout 悬空"
    fixed = repair_five_system_model(m)["model"]
    after = [f for f in (validate_five_system_model(fixed).get("findings") or [])
             if "layout block ref" in str(f.get("message") or "")]
    assert after == []
