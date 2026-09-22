# -*- coding: utf-8 -*-
"""连接器实体活到模型里没有——**四条既有判据全绿，东西却没了**（2026-08-29）。

## 真机撞出来的

挂 weather 连接器跑一轮（sr-conn-180152，本地生活户外活动排期），产出的
datamodel 是 `camp_site / activity_schedule / schedule_conflict`——
**`weather_daily` 不在里面**。页面倒是叫 `weather_calendar` /
`weather_reschedule_center`，看着像成了。

而 `tests/test_connectors_reach_the_live_path.py` 里四条"接在链上吗"的判据
**全绿**：块进了 `_build_user_content`、进了 `build_spec_prompt`、两条路由都
设了都清了、前端两处载荷都带了。它们**验到「块进了 prompt」为止**。

这就是 CLAUDE.md 第三条点名的形状：**正向判据齐全、反向判据缺失**。
「名单里有名字 ≠ 埋点在」——这次是「块进了 prompt ≠ 实体进了模型」。

## 病灶：块接在了不产 datamodel 的那一步（第一条）

翻 SSE 逐段数 `weather_daily` 的出现次数：

    specfirst.spec        2 次   ← 连接器块在这一步（spec_tree.build_spec_prompt）
                                   但 SPEC 树是**需求树**，那两次是散文里的 notes
    specfirst.structure   0 次   ← datamodel 从这一步来（html_structure），
                                   它**从生成好的 HTML 反推**，提示词里没有连接器块
    specfirst.semantics   0 次
    specfirst.assemble    0 次

实体从来没有被建出来过。

## 修法：确定性补录，不是再给模型加一句要求

第 4 步的全部纪律是「只记 HTML 里真有的，臆造的剪掉」。往它提示词里塞一句
"这个实体你必须收录"，等于给臆造开同一道门。

而连接器实体是**已经逐字声明好的**（注册表里 id/name/字段/类型俱全），
不需要任何模型去抄一遍——让模型抄一份我们已经有的东西，只是多一处会抄错的
地方。所以在第 6 步机械段零 LLM 直接搬。

## 这个文件的判据分工

    Test补录真的发生       ← 病本身。改动前必红
    Test补进了绑定词汇表   ← ⚠ 真正要紧的那条：实体在 ≠ 页面绑得上它
    Test没挂连接器时零变化 ← 反向判据。不许多一个空实体/空键
    Test补录不许把模型搞坏 ← 不重复 id、非法类型丢掉、补完照样过闸
    Test接在通电的那一步上 ← 第一条。函数写对了 ≠ 有人在活路径上调它
"""

from __future__ import annotations

import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.model_assembly import (  # noqa: E402
    _vocabulary,
    apply_bindings,
    assemble,
    assemble_mechanical,
    merge_connector_entities,
)
from services.turn_context import set_active_connectors_cleaned  # noqa: E402
from services.v5_llm_generate import set_active_connectors  # noqa: E402
from services.v5_model_gate import validate_five_system_model  # noqa: E402
from tests.test_model_assembly import BINDINGS, SEMANTICS, SPEC, STRUCTURE  # noqa: E402

WEATHER_FIELDS = ("date", "city", "condition", "temp_max", "temp_min", "rain_chance", "wind_max")


@pytest.fixture(autouse=True)
def _clean():
    set_active_connectors(None)
    yield
    set_active_connectors(None)


def _ids(model):
    return [e["id"] for e in model["datamodel"]["entities"]]


class Test补录真的发生:
    """⚠ 病本身。这一组在修复之前必红——真机就是这么坏的。"""

    def test_挂了连接器_实体进了datamodel(self):
        set_active_connectors(["weather"])
        model = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert "weather_daily" in _ids(model), (
            "连接器实体没进 datamodel——用户挂了数据源，运行时却没有表可填"
        )

    def test_字段_id_逐字_不许改名(self):
        """⚠ 字段 id 差一个字，取回来的真数据就填不进孔：
        derive-binding-source 每格填「—」，而 problems 是空的。"""
        set_active_connectors(["weather"])
        model = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        ent = next(e for e in model["datamodel"]["entities"] if e["id"] == "weather_daily")
        got = [f["id"] for f in ent["fields"]]
        assert set(WEATHER_FIELDS) <= set(got), f"字段 id 没逐字搬过来：{got}"

    def test_挂两个就补两个(self):
        set_active_connectors(["weather", "fx"])
        model = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert {"weather_daily", "fx_rate"} <= set(_ids(model))

    def test_实体也进了dataModelRefs(self):
        """⚠ 只补 datamodel 不补 refs = 只改一半（第四条）：
        appbundle 说这个应用用哪些实体，漏了它就是"表在但没登记"。"""
        set_active_connectors(["weather"])
        model = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert "weather_daily" in model["appbundle"]["dataModelRefs"]


class Test补进了绑定词汇表:
    """⚠ **这一组才是真正要紧的。**

    绑定层的提示词是**全封闭词汇表**——模型只能在 `_vocabulary()` 给的 id 里挑。
    补录如果发生在词汇表算完之后，实体是在了，页面却绑不上它，运行时照样每格
    填「—」——**那正是这条要治的病本身**，只是换了个位置复发。
    """

    def test_连接器字段出现在绑定词汇表里(self):
        set_active_connectors(["weather"])
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        fields = _vocabulary(skeleton)["fields"]
        assert "weather_daily.temp_max" in fields, (
            "实体补进去了，但绑定层的词汇表里没有它——页面绑不上，等于没补"
        )

    def test_页面真能绑上连接器字段(self):
        """端到端：绑定层挑了连接器字段，闸放行。"""
        set_active_connectors(["weather"])
        skeleton = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        bindings = copy.deepcopy(BINDINGS)
        bindings["pageBindings"][1]["fieldBindings"].append("weather_daily.temp_max")
        model = apply_bindings(skeleton, bindings)
        gate = validate_five_system_model(
            model, require_landing_page_ref=True, require_preferred_device=True
        )
        assert gate["passed"] is True, f"绑上连接器字段之后过不了闸：{gate['findings']}"


class Test没挂连接器时零变化:
    """⚠ 反向判据。增强项最常见的坏法是"不该出现的时候出现了"。"""

    def test_没挂就跟从前一模一样(self):
        set_active_connectors(None)
        model = assemble_mechanical(STRUCTURE, SEMANTICS, SPEC)
        assert _ids(model) == ["vehicle", "store"], "没挂连接器却多出了实体"

    def test_补录函数自己返回空(self):
        set_active_connectors(None)
        dm = {"entities": [{"id": "vehicle", "name": "车", "fields": []}]}
        before = copy.deepcopy(dm)
        assert merge_connector_entities(dm) == []
        assert dm == before, "没挂连接器却动了 datamodel"


class Test补录不许把模型搞坏:
    def test_同名实体只合并字段_不新增第二条(self):
        """⚠ 重复 id 过不了结构闸。HTML 里如果已经反推出同名实体，
        补录必须往里补缺的字段，不是再加一条。"""
        set_active_connectors(["weather"])
        dm = {
            "entities": [
                {"id": "weather_daily", "name": "天气", "fields": [
                    {"id": "date", "name": "日期", "type": "date"},
                ]}
            ]
        }
        merge_connector_entities(dm)
        assert [e["id"] for e in dm["entities"]] == ["weather_daily"], "补出了重复实体"
        got = {f["id"] for f in dm["entities"][0]["fields"]}
        assert set(WEATHER_FIELDS) <= got, "同名实体没被补齐缺的字段"
        assert len([f for f in dm["entities"][0]["fields"] if f["id"] == "date"]) == 1, (
            "已有的字段被补了第二遍"
        )

    def test_合法域外的类型直接丢掉(self):
        """⚠ 宁可少一个字段，也不把闭集外的类型喂进模型
        （同 _clean_binding 的取舍）。"""
        set_active_connectors_cleaned([
            {"id": "x", "name": "X", "source": "t", "entity": {
                "id": "x_rows", "name": "X 行",
                "fields": [{"id": "ok_one", "name": "好", "type": "number"},
                           {"id": "bad_one", "name": "坏", "type": "blob"}],
            }}
        ])
        dm = {"entities": []}
        merge_connector_entities(dm)
        got = {f["id"] for f in dm["entities"][0]["fields"]}
        assert got == {"ok_one"}, f"非法类型的字段没被丢掉：{got}"

    def test_非法实体id整条跳过(self):
        set_active_connectors_cleaned([
            {"id": "x", "name": "X", "source": "t", "entity": {
                "id": "Bad-Id!", "name": "坏", "fields": [{"id": "a", "name": "a", "type": "string"}],
            }}
        ])
        dm = {"entities": []}
        assert merge_connector_entities(dm) == []
        assert dm["entities"] == [], "非法 id 的实体被补进去了，炸点只是往后挪了一步"

    def test_补完照样过闸(self):
        set_active_connectors(["weather"])
        model = assemble(
            STRUCTURE, SEMANTICS, SPEC, llm_json_fn=lambda _m: copy.deepcopy(BINDINGS)
        )["model"]
        assert "weather_daily" in _ids(model)
        gate = validate_five_system_model(
            model, require_landing_page_ref=True, require_preferred_device=True
        )
        assert gate["passed"] is True, f"补录之后过不了闸：{gate['findings']}"


class Test接在通电的那一步上:
    """⚠ CLAUDE.md 第一条。上面每一条都直接调 merge_connector_entities 或
    assemble_mechanical——**把调用点删掉，它们照样全绿**。这一组盯的是调用点。"""

    def test_assemble_mechanical里真的调了(self):
        import inspect

        src = inspect.getsource(assemble_mechanical)
        assert "merge_connector_entities(" in src, "补录函数没人调——写对了等于没写"

    def test_补录发生在词汇表算出来之前(self):
        """⚠ 顺序判据。补晚了实体在、页面绑不上，病换个位置复发。"""
        import inspect

        # ⚠ 必须先剥注释再找位置。第一版没剥，而调用点上方那句注释里正好写着
        #   "必须在 entity_ids / _vocabulary 之前"——`src.index("entity_ids")`
        #   命中的是注释，判据当场打空。这就是第二条点名的原形。
        src = "\n".join(
            l for l in inspect.getsource(assemble_mechanical).splitlines()
            if not l.lstrip().startswith("#")
        )
        assert src.index("merge_connector_entities(") < src.index("entity_ids"), (
            "补录排在 entity_ids 之后了——dataModelRefs 和绑定词汇表都会漏掉它"
        )

    def test_补录炸了不许打死整轮(self):
        """⚠ 第七条：补录是确定性搬运，出错只可能是 bug。
        不许因为它把一轮推演打死，但**必须吵**（源码里那句 print）。"""
        import inspect

        src = inspect.getsource(assemble_mechanical)
        i = src.index("merge_connector_entities(")
        window = src[max(0, i - 200):i + 400]
        assert "try:" in window and "except" in window, "补录没有兜住异常"
        assert "print(" in window, "补录失败时一声不吭——少了一张表没人会发现"
