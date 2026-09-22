# -*- coding: utf-8 -*-
"""图判作用域（执行模式）：LLM 只报种子，扩散交给图算，图闭包定重画范围。

## 为什么有这个

refine_page_scope 让 LLM 直接猜"重画哪几页"——它答不了"改这一块，牵扯的
工作流/权限/数据模型也要更新"，因为那三只手不在页面清单上。这里拆开：
LLM 判**种子**（语义题），`impacted_closure` 算**牵连**（机械题）。
跟 Aider ContextCoder 的分工差异见 services/refine_graph_scope.py 模块头。

2026-08-17 出生时是影子（只对照不改行为）；2026-08-18 攒到两轮真机对照后
切执行。当时钉的「影子期不许碰行为」按约定**改判据**成现在的
「图判决定重画范围」——不是绕过，是履约。

## 这组判据守四件事

1. **fail 的方向**：判不出来回 None，由调用方走判官阶梯退一级（纪律七）。
2. **翻译不许丢齿**：闭包出来的页面必须是裸 id——带着 `page:` 前缀对不上
   SPEC/reuse_pages 的键，表现是"对照两边永远零交集"，尺子先坏。
3. **判官阶梯**：图闭包页 → 文本判 → 全量重画，每一级缺席都退下一级，
   绝不 fail 成"一页都不改"。
4. **对照日志执行期照打**：它是 hops 标定集的唯一来源，切了执行更不能停。
5. **枢纽不当扩散起点**（2026-08-18 过夜咖啡馆）：`role:staff` 两跳吃三页。
   种子只认页/实体/字段；沿角色扫全图必须红。
6. **大盘页也不当桥**（2026-08-18 咖啡馆 10 轮）：p3 绑了预约/积分/座位，
   从 `page:p3` 走两步仍三页全到。页可当种子，不从页往外走。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.app_graph import build_app_graph  # noqa: E402
from services.refine_graph_scope import (  # noqa: E402
    DEFAULT_HOPS,
    MAX_NODES_FOR_PROMPT,
    build_node_scope_prompt,
    decide_seed_nodes,
    graph_scope_verdict,
    narrow_page_seeds,
    parse_node_scope,
    shadow_compare_line,
)

# 与 test_app_graph 同形状：带 menus（真机口径），role→page 边能产出。
MODEL = {
    "datamodel": {"entities": [
        {"id": "order", "name": "订单", "fields": [
            {"id": "amount", "name": "金额"}, {"id": "status", "name": "状态"},
        ]},
        {"id": "cust", "name": "客户", "fields": [{"id": "phone", "name": "电话"}]},
    ]},
    "rbac": {
        "roles": [{"id": "mgr", "name": "店长"}, {"id": "clerk", "name": "店员"}],
        "permissions": ["order:read", "order:create", "cust:read"],
        "menus": [
            {"id": "m1", "label": "订单", "roleRefs": ["mgr"],
             "permissionRefs": ["order:read", "order:create"]},
            {"id": "m2", "label": "客户", "roleRefs": ["clerk"],
             "permissionRefs": ["cust:read"]},
        ],
    },
    "workflow": {"nodes": [
        {"id": "submit", "name": "提交", "assigneeRole": "clerk"},
        {"id": "approve", "name": "审批", "assigneeRole": "mgr"},
    ]},
    "page": {"pages": [
        {"id": "p1", "name": "订单页",
         "fieldBindings": ["order.amount", "order.status"],
         "actionPermissions": ["order:read", "order:create"]},
        {"id": "p2", "name": "客户页",
         "fieldBindings": ["cust.phone"], "actionPermissions": ["cust:read"]},
    ]},
    "aigc": {"capabilities": [
        {"id": "sum1", "name": "订单摘要", "inputFields": ["order.amount"], "roleRefs": ["mgr"]},
    ]},
    "appbundle": {"landingPageRef": "p1", "preferredDevice": "desktop",
                  "pageBindings": [{"pageRef": "p1", "workflowRef": "submit"}]},
}

G = build_app_graph(MODEL)


class Test提示词:
    def test_节点按类分组_带kind前缀和中文名(self):
        user = build_node_scope_prompt("这一页只给店长看", G)[-1]["content"]
        assert "page:p1" in user and "订单页" in user
        assert "role:mgr" in user and "店长" in user
        assert "wf:approve" in user
        assert "角色" in user and "流程节点" in user

    def test_不许它产内容(self):
        """对应 Aider ContextPrompts 的 `NEVER RETURN CODE!`，同 refine_page_scope。"""
        user = build_node_scope_prompt("改点东西", G)[-1]["content"]
        assert "不要输出任何 HTML" in user

    def test_只要直接点名的_牵连声明由系统算(self):
        """★ 跟 Aider 的分工差异落在提示词上：Aider 要模型报**完整**清单
        （它没有图），这里反过来只要种子——模型得知道多列的代价，
        否则它会照习惯把牵连也列进来，闭包再一扩就是双重放大。
        """
        user = build_node_scope_prompt("改点东西", G)[-1]["content"]
        assert "直接点" in user
        assert "牵连" in user and "自动" in user
        assert "不要列角色" in user, "提示词还在怂恿列角色——咖啡馆那病会再来"


class Test收答案:
    def test_只收图上真实存在的节点(self):
        assert parse_node_scope({"nodes": ["page:p1", "role:mgr"]}, G) == [
            "page:p1", "role:mgr",
        ]

    def test_图上没有的id直接丢掉(self):
        """反向判据：不做模糊匹配（同 refine_page_scope 的理由）。"""
        assert parse_node_scope(
            {"nodes": ["page:p1", "page:p9", "订单页", "entity:ghost"]}, G
        ) == ["page:p1"]

    def test_形状不对回None(self):
        for bad in (None, [], "page:p1", {"nodes": "page:p1"}, {}):
            assert parse_node_scope(bad, G) is None


class Test判不出来必须fail_open:
    """★ 同 refine_page_scope：fail 的方向错了比不做这个功能还糟。"""

    def test_LLM抛异常回None(self, capsys):
        def boom(messages):
            raise RuntimeError("网关炸了")

        assert decide_seed_nodes("改点东西", G, llm_json_fn=boom) is None

    def test_答非所问回None(self):
        assert decide_seed_nodes("改点东西", G, llm_json_fn=lambda m: {"随便": 1}) is None

    def test_空清单回None(self):
        assert decide_seed_nodes("改点东西", G, llm_json_fn=lambda m: {"nodes": []}) is None

    def test_全是图外id回None(self):
        assert decide_seed_nodes(
            "改点东西", G, llm_json_fn=lambda m: {"nodes": ["page:p9"]}
        ) is None

    def test_没指令或空图回None(self):
        assert decide_seed_nodes("", G, llm_json_fn=lambda m: {"nodes": ["page:p1"]}) is None
        assert decide_seed_nodes(
            "改", {"nodes": {}, "edges": []}, llm_json_fn=lambda m: {"nodes": ["page:p1"]}
        ) is None

    def test_节点太多放弃图判_且不调LLM(self, capsys):
        """清单一长挑选质量不可信；而且这时**连 LLM 都不该调**——
        调了也是浪费一次调用换一个不可信的答案。
        """
        big = {"nodes": {f"page:x{i}": {"kind": "page", "name": f"页{i}"}
                         for i in range(MAX_NODES_FOR_PROMPT + 1)},
               "edges": []}
        called = []

        def spy(messages):
            called.append(1)
            return {"nodes": ["page:x0"]}

        assert decide_seed_nodes("改点东西", big, llm_json_fn=spy) is None
        assert not called, "放弃图判却还是调了 LLM"
        assert "放弃图判" in capsys.readouterr().out

    def test_判出来了如实返回(self):
        assert decide_seed_nodes(
            "这一页只给店长看", G, llm_json_fn=lambda m: {"nodes": ["page:p1", "role:mgr"]}
        ) == ["page:p1"]

    def test_只有角色种子算判不出来(self):
        """咖啡馆：模型只报 role:staff → 不当页作用域，回落文本判。"""
        assert decide_seed_nodes(
            "给店员加个红标", G, llm_json_fn=lambda m: {"nodes": ["role:mgr"]}
        ) is None


class Test闭包翻译:
    def test_角色种子不再扫页(self):
        """2026-08-18 过夜改判：沿角色走等于扫全图，不当页作用域。"""
        v = graph_scope_verdict(G, ["role:mgr"])
        assert v["pages"] == [], "角色种子还在扫页——咖啡馆那病没治"
        assert v["droppedHubs"] == ["role:mgr"]
        assert "rbac" in v["segments"]

    def test_页面清单是裸id(self):
        """★ 反向判据（变异咬这里）：带 `page:` 前缀对不上 SPEC/reuse_pages
        的键，影子对照会**永远零交集**——尺子坏了，数据看着还正常。
        """
        v = graph_scope_verdict(G, ["page:p1"])
        assert "p1" in v["pages"]
        assert not any(p.startswith("page:") for p in v["pages"])

    def test_闭包有半径_默认两跳够不到三跳的东西(self):
        """从提交节点出发：两跳到店员和订单页那一圈，三跳外的 AIGC 能力
        和客户页的字段**不许**进来——半径就是拿来挡这个的。
        """
        v = graph_scope_verdict(G, ["wf:submit"], hops=DEFAULT_HOPS)
        assert "wf:submit" in v["impacted"] and "page:p1" in v["impacted"]
        assert "aigc:sum1" not in v["impacted"], "三跳外的能力被卷进来了——半径没起作用"
        assert "field:cust.phone" not in v["impacted"]

    def test_种子本身也算受影响(self):
        v = graph_scope_verdict(G, ["page:p2"])
        assert "page:p2" in v["impacted"] and "p2" in v["pages"]


# 过夜咖啡馆：一个店员角色能进三页。沿它走两跳 = 加一列红标整栋重画。
CAFE_MODEL = {
    "datamodel": {"entities": [
        {"id": "seat", "name": "座位", "fields": [{"id": "status", "name": "状态"}]},
        {"id": "point", "name": "积分", "fields": [{"id": "balance", "name": "余额"}]},
        {"id": "dash", "name": "大盘指标", "fields": [{"id": "rate", "name": "上座率"}]},
    ]},
    "rbac": {
        "roles": [{"id": "staff", "name": "店员"}],
        "permissions": ["seat:read", "point:read", "dash:read"],
        "menus": [{
            "id": "m_all", "label": "店员菜单", "roleRefs": ["staff"],
            "permissionRefs": ["seat:read", "point:read", "dash:read"],
        }],
    },
    "workflow": {"nodes": []},
    "page": {"pages": [
        {"id": "p1", "name": "预约台",
         "fieldBindings": ["seat.status"], "actionPermissions": ["seat:read"]},
        {"id": "p2", "name": "积分页",
         "fieldBindings": ["point.balance"], "actionPermissions": ["point:read"]},
        {"id": "p3", "name": "大盘",
         "fieldBindings": ["dash.rate", "seat.status", "point.balance"],
         "actionPermissions": ["dash:read"]},
    ]},
    "aigc": {"capabilities": []},
    "appbundle": {"landingPageRef": "p1", "preferredDevice": "desktop",
                  "pageBindings": []},
}
CAFE_G = build_app_graph(CAFE_MODEL)
SPEC_CAFE = {
    "rootNodeId": "n0", "version": 3, "appName": "咖啡馆",
    "personas": [{"id": "u1", "name": "店员", "goals": ["预约"]}],
    "successCriteria": [{"id": "sc1", "text": "能预约"}],
    "nodes": [],
    "pages": [
        {"id": "p1", "name": "预约台"},
        {"id": "p2", "name": "积分页"},
        {"id": "p3", "name": "大盘"},
    ],
}
PREV_CAFE = {
    "p1": "<html>旧1</html>", "p2": "<html>旧2</html>", "p3": "<html>旧3</html>",
}


class Test咖啡馆枢纽:
    """过夜咖啡馆：role:staff 吃三页。删掉 no_expand / 收窄，这组必红。"""

    def test_角色能进三页_图上是连着的(self):
        """尺子先校准：要是边没画上，后面「没吃三页」是假绿。"""
        edges = CAFE_G["edges"]
        assert ("role:staff", "page:p1", "can_enter") in edges
        assert ("role:staff", "page:p2", "can_enter") in edges
        assert ("role:staff", "page:p3", "can_enter") in edges

    def test_沿角色两跳会吃三页_所以必须拦住(self):
        """反向：不拦枢纽时的病。开关关掉必须复现，证明拦的是这个。"""
        from services.app_graph import impacted_closure

        eaten = impacted_closure(CAFE_G, ["role:staff"], hops=DEFAULT_HOPS)
        pages = {n.split(":", 1)[1] for n in eaten if n.startswith("page:")}
        assert pages == {"p1", "p2", "p3"}

    def test_角色种子不扫三页(self):
        v = graph_scope_verdict(CAFE_G, ["role:staff"])
        assert v["pages"] == [], f"角色种子仍扫到 {v['pages']}"
        assert v["droppedHubs"] == ["role:staff"]

    def test_对的页种子不经角色吃邻居(self):
        """加预约台红标：种子是 p1，经 staff 两跳会把积分页和大盘也吃掉。"""
        v = graph_scope_verdict(CAFE_G, ["page:p1"])
        assert v["pages"] == ["p1"]
        assert "p2" not in v["pages"] and "p3" not in v["pages"]

    def test_种子收窄丢掉角色留下页(self):
        kept, dropped = narrow_page_seeds(
            ["page:p1", "role:staff", "entity:seat"], CAFE_G
        )
        assert kept == ["page:p1", "entity:seat"]
        assert dropped == ["role:staff"]

    def test_开关关掉退回沿角色扫全图(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_HUB_BARRIER", "0")
        v = graph_scope_verdict(CAFE_G, ["role:staff"])
        assert set(v["pages"]) == {"p1", "p2", "p3"}, "对照臂没复现咖啡馆那病"


class Test大盘页枢纽:
    """咖啡馆 10 轮：角色堵住了，大盘自己连着三张表，两跳仍整本重画。

    删掉 EXPAND_HUB_KINDS 里的 page，这组必红。page 不许进 HUB_KINDS——
    那是种子收窄用的，放进去以后谁把 narrow 改回按 HUB 丢，页种子就没了。
    """

    def test_页是种子不是收窄要丢的枢纽(self):
        from services.refine_graph_scope import EXPAND_HUB_KINDS, HUB_KINDS

        assert "page" in EXPAND_HUB_KINDS
        assert "page" not in HUB_KINDS

    def test_大盘绑了邻居的字段_图上是连着的(self):
        """尺子先校准：边没画上的话，后面「没吃三页」是假绿。"""
        edges = CAFE_G["edges"]
        assert ("page:p3", "field:dash.rate", "binds_field") in edges
        assert ("page:p3", "field:seat.status", "binds_field") in edges
        assert ("page:p3", "field:point.balance", "binds_field") in edges

    def test_只拦角色时从大盘两跳仍吃三页(self):
        """反向：旧屏障（role/perm）治不好大盘。"""
        from services.app_graph import impacted_closure

        eaten = impacted_closure(
            CAFE_G, ["page:p3"], hops=DEFAULT_HOPS,
            no_expand_kinds=("role", "perm"),
        )
        pages = {n.split(":", 1)[1] for n in eaten if n.startswith("page:")}
        assert pages == {"p1", "p2", "p3"}, (
            f"尺子坏了：只拦角色时大盘闭包是 {pages}，后面「只剩 p3」证明不了病"
        )

    def test_大盘种子只重画自己(self):
        v = graph_scope_verdict(CAFE_G, ["page:p3"])
        assert v["pages"] == ["p3"], f"从大盘吃到了邻居：{v['pages']}"

    def test_改座位实体仍能到预约台(self):
        """页面不当桥 ≠ 实体种子走不到绑了它的页。"""
        v = graph_scope_verdict(CAFE_G, ["entity:seat"])
        assert "p1" in v["pages"], "座位种子没到预约台"
        assert "p2" not in v["pages"], "座位种子跨到了积分页"

    def test_开关关掉大盘仍吃三页(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_HUB_BARRIER", "0")
        v = graph_scope_verdict(CAFE_G, ["page:p3"])
        assert set(v["pages"]) == {"p1", "p2", "p3"}, "对照臂没复现大盘那病"


class Test影子对照日志行:
    def test_两边都有时报交集和差集(self):
        v = graph_scope_verdict(G, ["page:p1"])
        line = shadow_compare_line(["p1", "p3"], v)
        assert "交集=['p1']" in line
        assert "只有文本有=['p3']" in line

    def test_图判失败时如实说(self):
        line = shadow_compare_line(["p1"], None)
        assert "图判失败/未启用" in line and "p1" in line

    def test_文本全量时写全量(self):
        line = shadow_compare_line(None, graph_scope_verdict(G, ["page:p1"]))
        assert "(全量)" in line


SPEC_WIRE = {
    "rootNodeId": "n0", "version": 3, "appName": "维保云",
    "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
    "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
    "nodes": [],
    "pages": [{"id": "p1", "name": "工单页"}, {"id": "p2", "name": "报表页"}],
}

PREV_PAGES = {"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"}


def _drive_pipeline(monkeypatch, *, refine=True, reuse_model=None,
                    reuse_pages=None, text_scope=None, seed_fn=None,
                    spec=None, page_ids=None):
    """跑真实 run_spec_first 控制流（抄自 test_refine_page_scope.Test端到端接线）。

    fake bind 给重打的页盖 `bound-` 戳：谁被重新打孔、谁沿用上一轮，
    在最终产物里一眼可辨——局部打孔的判据全靠这个戳。
    """
    import services.html_bindings as hb
    import services.html_structure as hs
    import services.model_assembly as ma
    import services.page_shell as ps
    import services.refine_graph_scope as rgs
    import services.refine_page_scope as rps
    import services.spec_page_html as sph
    import services.spec_semantics as ss
    import services.spec_tree as spec_tree
    from services import spec_first_pipeline as sfp

    seen = {}
    spec = spec or SPEC_WIRE
    page_ids = page_ids or ("p1", "p2")

    monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(spec))
    monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: text_scope)
    if seed_fn is not None:
        monkeypatch.setattr(rgs, "decide_seed_nodes", seed_fn)

    def fake_pages(spec, **kw):
        seen["reuse_pages"] = kw.get("reuse_pages")
        # 跟真 generate_pages_parallel 同约定：照搬页原样回传，重画页新产出。
        reused = dict(kw.get("reuse_pages") or {})
        drawn = {pid: f"<html>新画-{pid}</html>"
                 for pid in page_ids if pid not in reused}
        return {"pages": {**reused, **drawn}, "failed": {}}

    # ⚠ 替身必须跟着产线签名走（2026-09-04）：bind_pages 加了关键字参数
    #   product_archetype，替身没跟 → 38 条判据全炸在 TypeError 上，
    #   一条真正的行为都没验到。替身一律收 *a/**kw，别再让签名漂移
    #   把整个文件打成红的。
    def fake_bind(p, m, *a, **kw):
        seen["bind_input"] = sorted(p.keys())
        return {"pages": {pid: f"<html>bound-{pid}</html>" for pid in p}, "failed": {}}

    monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
    monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
    monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
    monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
    monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
    monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
    monkeypatch.setattr(
        ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}}
    )
    monkeypatch.setattr(hb, "bind_pages", fake_bind)

    out = sfp.run_spec_first(
        "做个工单系统",
        refine=({"instruction": "报表页只给主管看", "modelDigest": "d"} if refine else None),
        reuse_pages=reuse_pages,
        reuse_model=reuse_model,
    )
    seen["stages"] = out.get("stages") or {}
    seen["pages"] = out.get("pages") or {}
    return seen


class Test接线:
    """★ 纪律一：图判必须接在**真正在跑的那条链**（run_spec_first）上。"""

    def _drive(self, monkeypatch, **kw):
        return _drive_pipeline(monkeypatch, **kw)

    PREV = PREV_PAGES

    def test_影子步真的在链路上跑_且图建自上一版模型(self, monkeypatch):
        got = {}

        def spy(instruction, graph, **kw):
            got["instruction"] = instruction
            got["node_ids"] = set((graph.get("nodes") or {}).keys())
            return ["page:p1"]

        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=spy)
        assert got, "影子步没被执行——接线断了"
        assert got["instruction"] == "报表页只给主管看"
        assert "page:p1" in got["node_ids"] and "role:mgr" in got["node_ids"], (
            "图不是从上一版模型建的"
        )
        assert "graphscope" in seen["stages"], "没有独立埋点，墙钟会混进别的段"

    def test_对照日志行真的打出来了(self, monkeypatch, capsys):
        """★ 反向判据的镜像：影子模式的**全部产出**就是这行日志（拿它攒标定集）。

        把 print 删掉，其余判据照样全绿——"闸全绿但东西没了"的标准形状，
        所以这行必须单独钉。
        """
        self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                    text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        out = capsys.readouterr().out
        assert "影子对照" in out, "对照日志没打出来——影子模式白跑，标定集攒不起来"
        assert "只有图有" in out

    def test_图判决定重画范围(self, monkeypatch):
        """★ 本文件最要紧的一条（2026-08-18 从「影子期不许碰行为」按约定改判据）。

        重画哪几页由**图闭包**决定：文本说改 p2，图种子指向 p1（闭包页只有
        p1）——照搬集必须跟图走（照搬 p2）。谁把这行为退回文本判，这条当场红。
        """
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["reuse_pages"] == {"p2": "<html>旧2</html>"}, (
            "重画范围没跟图闭包走——执行模式没接上（或被悄悄退回了影子）"
        )
        assert seen["stages"]["graphscope"]["decider"] == "graph"

    def test_图判缺席回落文本判(self, monkeypatch):
        """判官阶梯第二级：种子判不出来（None）→ 文本判说了算。"""
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=lambda i, g, **kw: None)
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, (
            "图判缺席时没回落文本判"
        )
        assert seen["stages"]["graphscope"]["decider"] == "text"

    def test_闭包无页回落文本判(self, monkeypatch):
        """种子判出来了但闭包一页都不含——按判错处理，回落文本判。
        接管一个空重画集等于"一页都不改"，那是 fail 错方向。
        """
        import services.refine_graph_scope as rgs

        monkeypatch.setattr(
            rgs, "graph_scope_verdict",
            lambda g, s, **kw: {"seeds": s, "impacted": [], "pages": [], "segments": []},
        )
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=lambda i, g, **kw: ["role:mgr"])
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}
        assert seen["stages"]["graphscope"]["decider"] == "text"

    def test_文本判失败图判仍接管(self, monkeypatch):
        """阶梯是双向兜底：2026-08-18 真机第二轮就是文本判全量（reuse 丢失场景
        的近亲）——图判成了就该接管，别让一级的失败拖垮另一级。
        """
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=None, seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["reuse_pages"] == {"p2": "<html>旧2</html>"}, (
            "文本判失败时图判没接管，白白全量重画"
        )

    def test_两级都缺席全量重画(self, monkeypatch):
        """阶梯的底：谁都判不出来 → 全量重画（最老的行为），绝不是"一页不改"。"""
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=None, seed_fn=lambda i, g, **kw: None)
        assert seen["reuse_pages"] == {}, "两级都缺席时没有退到全量重画"

    def test_图判炸了不拖垮主链路(self, monkeypatch):
        """纪律七：图判是增强类，它炸了主链路必须照跑（回落文本判）。"""
        def boom(instruction, graph, **kw):
            raise RuntimeError("图判炸了")

        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=boom)
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, "主链路被图判拖垮了"

    def test_执行开关关掉退回影子(self, monkeypatch):
        """`SLIDERULE_GRAPH_SCOPE_DRIVE=0`：图照跑、对照照打，但**不碰行为**——
        这就是 2026-08-17 的影子模式，留作执行期出问题时的退路。
        """
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_DRIVE", "0")
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, (
            "退回影子后图判还在碰行为"
        )
        assert seen["stages"]["graphscope"]["decider"] == "shadow"

    def test_总开关关掉图判整个不跑(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GRAPH_SCOPE_SHADOW", "0")
        called = []
        seen = self._drive(monkeypatch, reuse_model=MODEL, reuse_pages=self.PREV,
                           text_scope=["p2"],
                           seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called, "总开关关了图判还在跑"
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, "行为该由文本判决定"

    def test_角色种子不接管三页_回落文本判(self, monkeypatch):
        """纪律一：咖啡馆病必须在 run_spec_first 上红。

        种子 role:staff、文本只点 p1。拦枢纽之后图闭包无页 → 回落文本判，
        只重画预约台，积分页和大盘照搬。谁把枢纽拦拿掉，照搬集变空。
        """
        seen = self._drive(
            monkeypatch, reuse_model=CAFE_MODEL, reuse_pages=PREV_CAFE,
            text_scope=["p1"], seed_fn=lambda i, g, **kw: ["role:staff"],
            spec=SPEC_CAFE, page_ids=("p1", "p2", "p3"),
        )
        assert seen["reuse_pages"] == {
            "p2": "<html>旧2</html>", "p3": "<html>旧3</html>",
        }, f"角色种子仍在接管重画：照搬={seen.get('reuse_pages')}"
        assert seen["stages"]["graphscope"]["decider"] == "text"

    def test_对的页种子接管但不吃邻居(self, monkeypatch):
        """种子 page:p1、文本说改 p2：图只该重画 p1，p2/p3 照搬。"""
        seen = self._drive(
            monkeypatch, reuse_model=CAFE_MODEL, reuse_pages=PREV_CAFE,
            text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"],
            spec=SPEC_CAFE, page_ids=("p1", "p2", "p3"),
        )
        assert seen["reuse_pages"] == {
            "p2": "<html>旧2</html>", "p3": "<html>旧3</html>",
        }, f"从 p1 经角色吃到了邻居：照搬={seen.get('reuse_pages')}"
        assert seen["stages"]["graphscope"]["decider"] == "graph"

    def test_大盘种子接管但不吃邻居(self, monkeypatch):
        """纪律一：大盘病必须在 run_spec_first 上红。

        种子 page:p3、文本说改 p1。图只该重画大盘，预约台和积分页照搬。
        谁把 page 从 no_expand 拿掉，照搬集变空。
        """
        seen = self._drive(
            monkeypatch, reuse_model=CAFE_MODEL, reuse_pages=PREV_CAFE,
            text_scope=["p1"], seed_fn=lambda i, g, **kw: ["page:p3"],
            spec=SPEC_CAFE, page_ids=("p1", "p2", "p3"),
        )
        assert seen["reuse_pages"] == {
            "p1": "<html>旧1</html>", "p2": "<html>旧2</html>",
        }, f"从大盘吃到了邻居：照搬={seen.get('reuse_pages')}"
        assert seen["stages"]["graphscope"]["decider"] == "graph"

    def test_非精修轮不跑图判(self, monkeypatch):
        """反向判据：新建应用没有上一版，建图没有对象，跑了就是白烧一次 LLM。"""
        called = []
        self._drive(monkeypatch, refine=False, reuse_model=MODEL,
                    seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called

    def test_没有上一版模型时不跑图判(self, monkeypatch):
        called = []
        self._drive(monkeypatch, reuse_model=None, reuse_pages=self.PREV,
                    text_scope=["p2"],
                    seed_fn=lambda i, g, **kw: called.append(1) or ["page:p1"])
        assert not called


class Test局部打孔:
    """照搬页不再重新打孔（2026-08-18，Turborepo cache-hit 同形状）。

    照搬页的 HTML 就是上一版打过孔的交付页；id 冻结 + 段沿用保证引用不漂。
    此前每轮对照搬页也全量重打（真机第三轮 4 页里 3 页照搬、bind 照样 71.9s
    打满 4 页）。判据靠 fake bind 的 `bound-` 戳分辨谁被重打。
    """

    def test_只重打图判点中的页(self, monkeypatch):
        """图闭包=p1 → bind 只收 p1；p2 沿用上一轮打孔结果原样交付。"""
        seen = _drive_pipeline(monkeypatch, reuse_model=MODEL, reuse_pages=PREV_PAGES,
                               text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["bind_input"] == ["p1"], "照搬页也被送去重新打孔了"
        assert seen["pages"]["p1"] == "<html>bound-p1</html>"
        assert seen["pages"]["p2"] == "<html>旧2</html>", (
            "照搬页丢了或被改——省了打孔、赔了页面"
        )

    def test_照搬页必须还在交付里(self, monkeypatch):
        """★ 反向判据单独钉：bound 只有重打页，谁把合并写成整份替换，
        照搬页就从交付里消失——判据全绿但页面没了的标准形状。
        """
        seen = _drive_pipeline(monkeypatch, reuse_model=MODEL, reuse_pages=PREV_PAGES,
                               text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert set(seen["pages"]) == {"p1", "p2"}, "交付页数少了"
        # ⚠ 2026-09-08（`pages_to_skip_bind`）：跳过条件收紧成「**已经打过孔**
        #   的照搬页」。上一版把没打孔的照搬页也跳过，交付里就留下一页永远
        #   没绑数据的壳。PREV_PAGES 里的 `<html>旧1</html>` 没打过孔，
        #   所以现在**不跳**、照常打——bindSkipped=0 才是对的。
        #
        #   这条断言原来写 ==1，钉的是旧语义。真正贵的是上面那句（★ 反向：
        #   照搬页不许从交付里消失），它没变。
        assert seen["stages"]["bind"]["bindSkipped"] == 0, (
            "没打过孔的照搬页被跳过了——交付里会留一页没绑数据的壳"
        )

    def test_开关关掉回全量打孔(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_REFINE_PARTIAL_BIND", "0")
        seen = _drive_pipeline(monkeypatch, reuse_model=MODEL, reuse_pages=PREV_PAGES,
                               text_scope=["p2"], seed_fn=lambda i, g, **kw: ["page:p1"])
        assert seen["bind_input"] == ["p1", "p2"], "开关关了还在局部打孔"

    def test_非精修轮全量打孔(self, monkeypatch):
        seen = _drive_pipeline(monkeypatch, refine=False)
        assert seen["bind_input"] == ["p1", "p2"]

    def test_全量重画时全量打孔(self, monkeypatch):
        """照搬集为空（两级判官都缺席）→ 没有可沿用的孔，必须全量重打。"""
        seen = _drive_pipeline(monkeypatch, reuse_model=MODEL, reuse_pages=PREV_PAGES,
                               text_scope=None, seed_fn=lambda i, g, **kw: None)
        assert seen["bind_input"] == ["p1", "p2"]
