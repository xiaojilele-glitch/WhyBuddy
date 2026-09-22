# -*- coding: utf-8 -*-
"""声明了的动作，界面上得真有地方能做（2026-09-05 社区养老）。

## 事故

真机 sr-20260904181150。用户那道题第 1 条是「老人全景档案」。交付出来的应用：

    权限声明   elder:read  elder:update  staff:read  staff:manage
               service_order:create/read/update/assign/approve
               qc_work_order:create/read/update/approve
    页面动作   p1 service_order:read/update + elder:read + staff:read
               p2 service_order:read/assign + staff:read
               p3 service_order:read/approve
               p4 qc_work_order:read/update/approve

对一下就看出来：**elder:update、staff:manage、service_order:create、
qc_work_order:create 四个动作，没有任何一个页面提供。** 这个应用「可以新建
服务工单」是纸面上的——它自己最核心的那张单子，界面上没地方新建；
用户要的建档改档，也没地方做。

当时没有任何一处开口：

  · 相关性闸量的是"叫法像不像"，「长者档案」这几个字在词表里，量不出"点不进去"；
  · SPEC 的 `pages_are_usable` 只查**页→需求**，不查反向的**需求→页**；
  · `app_graph.find_orphans` 本来就是干这个的（"东西在不在网里"），但
    `_ORPHAN_RULES` 里**没有 perm 这一类**——图上有 `page --needs_perm--> perm`
    这条边，却没人问过"哪些 perm 一条入边都没有"。

## 第二段：报了也得让计划侧看见

孤岛结论存进 `specFirstPages.qualityNotices`，而那条路**只通到前端**
（ArchitectureStage 画一块提示）。模型交回 host 时看不到，于是它既不知道
缺了什么，也就不会去补——跟今晚闭环裁决那条是同一个病。
"""

import pytest

from models.v5_state import V5SessionState
from services.app_graph import build_app_graph, find_orphans
from services.rehearsal_control import _after_write_hint

#: 真机那一发的原样形状（只留判定要用的字段）
REAL_MODEL = {
    "datamodel": {"entities": [
        {"id": "elder", "name": "长者档案", "fields": [{"id": "name"}]},
        {"id": "staff", "name": "社区照护员", "fields": [{"id": "name"}]},
        {"id": "service_order", "name": "服务工单", "fields": [{"id": "order_no"}]},
        {"id": "qc_work_order", "name": "待回访差评工单", "fields": [{"id": "qc_no"}]},
    ]},
    "rbac": {
        "roles": [{"id": "care_staff", "name": "社区照护员"}],
        "permissions": [
            "elder:read", "elder:update", "staff:read", "staff:manage",
            "service_order:create", "service_order:read", "service_order:update",
            "service_order:assign", "service_order:approve",
            "qc_work_order:create", "qc_work_order:read",
            "qc_work_order:update", "qc_work_order:approve",
        ],
        "menus": [{"id": "m1", "label": "任务作业", "roleRefs": ["care_staff"],
                   "permissionRefs": ["service_order:read"]}],
    },
    "page": {"pages": [
        {"id": "p1", "name": "任务作业",
         "fieldBindings": ["service_order.order_no", "elder.name", "staff.name"],
         "actionPermissions": ["service_order:read", "service_order:update",
                               "elder:read", "staff:read"]},
        {"id": "p2", "name": "上门照护排班",
         "fieldBindings": ["service_order.order_no", "staff.name"],
         "actionPermissions": ["service_order:read", "service_order:assign", "staff:read"]},
        {"id": "p3", "name": "费用结算与补贴流水",
         "fieldBindings": ["service_order.order_no"],
         "actionPermissions": ["service_order:read", "service_order:approve"]},
        {"id": "p4", "name": "服务质控",
         "fieldBindings": ["qc_work_order.qc_no"],
         "actionPermissions": ["qc_work_order:read", "qc_work_order:update",
                               "qc_work_order:approve"]},
    ]},
}


def _perm_orphans(model):
    return {o["key"] for o in find_orphans(build_app_graph(model))
            if o["key"].startswith("perm:")}


class Test图上看得见:
    def test_真机那一发_四个动作没有任何页面提供(self):
        """★ 事故本体。规则改回去这条必红。"""
        assert _perm_orphans(REAL_MODEL) == {
            "perm:elder:update", "perm:staff:manage",
            "perm:service_order:create", "perm:qc_work_order:create",
        }

    def test_理由说的是人话_不是一个key(self):
        got = [o for o in find_orphans(build_app_graph(REAL_MODEL))
               if o["key"] == "perm:service_order:create"]
        assert got and "没有任何页面提供" in got[0]["reason"], (
            "只给 key 不给理由，用户和模型都不知道要补什么"
        )

    def test_有页面提供的动作不算孤岛(self):
        """★ 反向配对：别见谁都报。p1 提供了 service_order:update，它就不是孤岛。"""
        orphans = _perm_orphans(REAL_MODEL)
        for provided in ("perm:service_order:read", "perm:service_order:update",
                         "perm:service_order:assign", "perm:service_order:approve",
                         "perm:elder:read", "perm:staff:read",
                         "perm:qc_work_order:read", "perm:qc_work_order:update"):
            assert provided not in orphans, f"{provided} 明明有页面提供，却被报成孤岛"

    def test_每个动作都有页面提供时一条都不报(self):
        """反向配对之二：做全了的应用不许被打扰。"""
        model = {
            "datamodel": {"entities": [{"id": "order", "name": "订单",
                                        "fields": [{"id": "no"}]}]},
            "rbac": {"roles": [{"id": "r1", "name": "员工"}],
                     "permissions": ["order:create", "order:read"],
                     "menus": [{"id": "m1", "label": "订单", "roleRefs": ["r1"],
                                "permissionRefs": ["order:read"]}]},
            "page": {"pages": [{"id": "p1", "name": "订单", "fieldBindings": ["order.no"],
                                "actionPermissions": ["order:create", "order:read"]}]},
        }
        assert _perm_orphans(model) == set()

    def test_只报不拦(self):
        """§7：孤岛是「哪里还没做」的清单，不是正确性错误，不许拿它打死推演。

        `find_orphans` 返回列表、不抛异常——这条钉住它别哪天被改成 raise。
        """
        assert isinstance(find_orphans(build_app_graph(REAL_MODEL)), list)


class Test计划侧看得见:
    """报了也得让模型看见，否则它既不知道缺什么，也就不会去补。"""

    def _state(self, notices):
        st = V5SessionState(sessionId="s-1",
                            goal={"text": "构建覆盖社区居家养老全场景的服务闭环",
                                  "status": "clear", "tools": ["bind"]},
                            ownerId="u-1")
        st.specFirstPages = {
            "spec": {"pages": [{"id": f"p{i}"} for i in range(1, 5)]},
            "pages": {f"p{i}": "<html></html>" for i in range(1, 5)},
            "qualityNotices": notices,
        }
        return st

    def test_孤岛进了交回host的情报(self):
        hint = _after_write_hint(self._state([
            {"kind": "orphan",
             "text": "交付的应用带着 4 个孤岛：perm:service_order:create"
                     "（没有任何页面提供这个动作——这条权限声明了却用不上）"},
        ]))
        assert "孤岛" in hint, f"体检报了孤岛，情报里一个字没提。原文：{hint}"
        assert "service_order:create" in hint, "没把具体缺哪个动作带过去"

    def test_给的是可选项不是命令(self):
        hint = _after_write_hint(self._state([
            {"kind": "orphan", "text": "交付的应用带着 1 个孤岛：perm:order:create（没有任何页面提供这个动作）"},
        ]))
        assert "不需要重跑整条链" in hint, (
            "没告诉模型补一页就行——它多半会去 rehearse，把已有产出全冲掉"
        )
        assert "必须" not in hint.split("孤岛是")[-1], "又写成命令式了"

    def test_没有孤岛时一个字不提(self):
        """反向配对：别的体检项（对比度之类）不该被当成孤岛混进去。"""
        hint = _after_write_hint(self._state([
            {"kind": "contrast", "text": "页面 p1：浅字浅底，对比可能不够"},
        ]))
        assert "孤岛" not in hint

    def test_压根没体检过时不炸(self):
        assert isinstance(_after_write_hint(self._state([])), str)


class Test孤岛不许隔一跳就忘:
    """孤岛只在 bind 跳算（打孔之后才量得准），而单跳会整份替换 qualityNotices。

    真机 2026-09-05：bind 跳日志里明明写着「新产生 2 个孤岛 + 存量 4 个」，
    closure 跳跑完再读会话，一条 orphan 都没有——计划侧只在算出来的那一跳
    看得见它。跟 pages / spec / assumptionsConfirmed 是同一条纪律：
    **单跳不许用「我没算」冒充「没有」**。
    """

    ORPHAN = {"kind": "orphan", "text": "交付的应用带着 4 个孤岛：perm:elder:update（…）"}

    def _cache(self, monkeypatch, prev, got):
        # ⚠ take_last_pages 是**函数体里**才 import 的（v5_capability_executor:1129），
        #   所以替身要打在源模块上，打在执行器上是打空——替身没生效时
        #   `_cache_spec_first_pages` 会去读真的请求域暂存（空），判据会以
        #   "什么都没发生"的方式绿掉。
        import services.spec_first_pipeline as sfp
        import services.v5_capability_executor as ex

        st = V5SessionState(sessionId="s-1", goal={"text": "题"}, ownerId="u-1")
        st.specFirstPages = prev
        monkeypatch.setattr(sfp, "take_last_pages", lambda: got)
        ex._cache_spec_first_pages(st)
        return st.specFirstPages or {}

    def test_closure单跳不许把上一跳的孤岛盖掉(self, monkeypatch):
        got = self._cache(
            monkeypatch,
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [self.ORPHAN]},
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [],
             "capabilityPlan": {"tools": ["closure"]}},
        )
        kinds = [n.get("kind") for n in (got.get("qualityNotices") or [])]
        assert "orphan" in kinds, "closure 单跳把上一跳照出来的孤岛盖没了"

    def test_bind跳重算时以本跳为准(self, monkeypatch):
        """★ 反向配对：bind 跳是**真的重算过**的，它说没有就是没有——
        不许把修好的孤岛一直留在账上。"""
        got = self._cache(
            monkeypatch,
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [self.ORPHAN]},
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [],
             "capabilityPlan": {"tools": ["bind"]}},
        )
        kinds = [n.get("kind") for n in (got.get("qualityNotices") or [])]
        assert "orphan" not in kinds, "孤岛已经修好了，账上还留着"

    def test_本跳自己算出孤岛时不叠加上一跳的(self, monkeypatch):
        fresh = {"kind": "orphan", "text": "本跳的孤岛"}
        got = self._cache(
            monkeypatch,
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [self.ORPHAN]},
            {"pages": {"p1": "<html/>"}, "spec": {"x": 1}, "qualityNotices": [fresh],
             "capabilityPlan": {"tools": ["closure"]}},
        )
        orphans = [n for n in (got.get("qualityNotices") or []) if n.get("kind") == "orphan"]
        assert orphans == [fresh], f"本跳有自己的结论，不该再叠上一跳的：{orphans}"


class Test存量孤岛也是孤岛:
    """★ 2026-09-05 真机（融媒体 sr-20260904195810）抓到的。

    pages/structure/bind 那一跳报了 3 个新孤岛（kind=orphan），紧接着的精修跳
    报的是「存量孤岛 2 个」——kind 变成 `orphan_stale`。只认 `orphan` 的过滤器
    看不见它，于是保留逻辑判定"这一跳跑了 bind 而且没有孤岛"，把上一跳那 3 条
    清了；计划侧最终一条都没看到。

    **存量孤岛照样是用户点不进去的动作**，"上一版就有"说的是责任归属，
    不是"已经不用管了"。
    """

    STALE = {"kind": "orphan_stale", "text": "存量孤岛 2 个（上一版就有，非本次造成）"}

    def test_存量孤岛进得了情报(self):
        from services.rehearsal_control import _after_write_hint as hint
        st = V5SessionState(sessionId="s-1",
                            goal={"text": "题目", "status": "clear", "tools": ["bind"]},
                            ownerId="u-1")
        st.specFirstPages = {
            "spec": {"pages": [{"id": "p1"}]}, "pages": {"p1": "<html/>"},
            "qualityNotices": [self.STALE],
        }
        assert "孤岛" in hint(st), "存量孤岛没进情报——计划侧还是不知道有东西点不进去"

    def test_存量孤岛不会被下一跳清掉(self, monkeypatch):
        import services.spec_first_pipeline as sfp
        import services.v5_capability_executor as ex
        st = V5SessionState(sessionId="s-2", goal={"text": "题"}, ownerId="u-1")
        st.specFirstPages = {"pages": {"p1": "<html/>"}, "spec": {"x": 1},
                             "qualityNotices": [self.STALE]}
        monkeypatch.setattr(sfp, "take_last_pages", lambda: {
            "pages": {"p1": "<html/>"}, "spec": {"x": 1},
            "qualityNotices": [], "capabilityPlan": {"tools": ["closure"]}})
        ex._cache_spec_first_pages(st)
        kinds = [n.get("kind") for n in ((st.specFirstPages or {}).get("qualityNotices") or [])]
        assert "orphan_stale" in kinds
