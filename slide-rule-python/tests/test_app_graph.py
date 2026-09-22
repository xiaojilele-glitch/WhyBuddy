# -*- coding: utf-8 -*-
"""把五系统模型摊成显式的图：谁引用谁（2026-08-17）。

## 为什么

HTML 是木偶——只有样子，自己不会动。让它动起来的是数据模型 + 权限 + 工作流，
它们伸进页面每一处，决定哪里显示什么、谁能点、点了走到哪。这张网本来就在，
只是一直**隐式**散落在 `v5_model_gate` 的十几处 DANGLING 检查里：闸每次都在
走这些边，走完就丢。于是"改了这一块还牵扯到哪些东西"这个问题在代码里问不出来。

## 这组判据守两件事

1. **图不许跟闸漂移**——点集必须复用闸的 collector，不能另抄一份。
2. **闭包必须有半径**——补齐 role→page 之后全图连通（角色是跨簇的桥），
   无界闭包必然覆盖全部节点。这个结论被翻过两次，来回记在
   test_补齐角色边之后_全图重新连通 的文档串里，是"图缺一条边就会系统性
   低估影响面"的活样本。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.app_graph import (  # noqa: E402
    build_app_graph,
    impacted_closure,
    segments_touched,
)

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
        # ⚠ 形状按**真机**来：真实模型里 rolePermissions 恒为空，权限全在 menus。
        #   2026-08-17 我第一版 fixture 只写了 rolePermissions，于是判据全绿而
        #   功能在真机上是死的。留一个空的在这儿，就是钉住"别再照假形状写"。
        "rolePermissions": {},
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


@pytest.fixture(scope="module")
def G():
    return build_app_graph(MODEL)


class Test建图:
    def test_六类节点都在(self, G):
        kinds = {m["kind"] for m in G["nodes"].values()}
        assert kinds == {"entity", "field", "role", "perm", "page", "wf", "aigc"}

    def test_节点带kind前缀_不许裸id(self, G):
        """反向判据：实体 order 和页面 order 在各自域里都合法。

        裸 id 会把两者**悄悄合并成一个节点**——那种错在图上看不出来，
        只会让影响面算错。
        """
        assert "entity:order" in G["nodes"] and "page:p1" in G["nodes"]
        assert "order" not in G["nodes"]

    def test_页面到字段与权限的边(self, G):
        e = {(s, d) for s, d, _ in G["edges"]}
        assert ("page:p1", "field:order.amount") in e
        assert ("page:p1", "perm:order:create") in e

    def test_流程节点到角色的边(self, G):
        e = {(s, d) for s, d, _ in G["edges"]}
        assert ("wf:approve", "role:mgr") in e

    def test_能力到字段与角色的边(self, G):
        e = {(s, d) for s, d, _ in G["edges"]}
        assert ("aigc:sum1", "field:order.amount") in e
        assert ("aigc:sum1", "role:mgr") in e

    def test_字段与权限都挂到实体上(self, G):
        e = {(s, d) for s, d, _ in G["edges"]}
        assert ("field:order.amount", "entity:order") in e
        assert ("perm:order:read", "entity:order") in e

    def test_悬空引用不许自动补节点(self):
        """反向判据：指向不存在的 id 是**闸**的活（DANGLING），不是图的活。

        在这里悄悄补一个节点，会把"引用坏了"变成"图上多一个孤点"，
        把真问题藏起来。
        """
        bad = {
            "datamodel": {"entities": []},
            "rbac": {"roles": [], "permissions": []},
            "page": {"pages": [{"id": "p9", "fieldBindings": ["ghost.field"]}]},
        }
        g = build_app_graph(bad)
        assert "field:ghost.field" not in g["nodes"]
        assert not [e for e in g["edges"] if e[1] == "field:ghost.field"]

    def test_空模型不炸(self):
        for bad in ({}, None, {"datamodel": "不是字典"}):
            g = build_app_graph(bad)  # type: ignore[arg-type]
            assert g["nodes"] == {} or isinstance(g["nodes"], dict)


class Test闭包必须有半径:
    def test_hops是必填的(self, G):
        """★ 不给默认值：无界闭包会吞掉整个连通分量，等于没做影响分析。"""
        with pytest.raises(TypeError):
            impacted_closure(G, ["page:p1"])  # type: ignore[call-arg]

    def test_跳数越多覆盖越大_并在连通分量上收敛(self, G):
        """闭包随跳数单调increase，并在有限跳内收敛。

        ⚠ 收敛点是**全图**——理由见下一条判据里记的那个来回（我一度以为
          簇间隔离，那是图漏了一条边造成的错觉）。
        """
        sizes = [len(impacted_closure(G, ["page:p1"], hops=h)) for h in (0, 1, 2, 6, 12)]
        assert sizes[0] == 1, "0 跳就是它自己"
        assert sizes == sorted(sizes), "跳数变多覆盖反而变小了？"
        assert sizes[-1] == sizes[-2], "十二跳还在长，说明没收敛"
        assert sizes[-1] == len(G["nodes"]), "收敛点应该是全图——见下一条判据的来回"

    def test_补齐角色边之后_全图重新连通(self, G):
        """★ 这条判据被翻过两次，整个来回值得记下来。

        1. 我最初写"这张网强连通，无界闭包必然覆盖全图"。
        2. 判据一验就红：订单页出发十二跳只覆盖 11/15，客户那一簇够不着。
           我据此**更正**成"按实体簇分块，簇内连通、簇间隔离"。
        3. 后来发现图**漏了一条边**（role→page 可进入，前端沙盘早就画了）。
           补上之后再验——全图重新连通：角色是跨簇的桥，店员既在订单流程里
           当审批人、又能进客户页。

        所以第 2 步那个"更正"是**基于不完整的图得出的错误结论**。
        真正的教训不是"图分不分块"，而是：**图缺一条边，影响分析就会
        系统性低估影响面**，而且低估的结果看起来完全合理。
        """
        got = impacted_closure(G, ["page:p1"], hops=99)
        assert got == set(G["nodes"]), (
            f"补齐 role→page 后仍有够不着的节点：{sorted(set(G['nodes']) - got)}"
        )

    def test_限方向仍然收得住(self, G):
        """连通不等于没法用：限方向 + 限跳数照样切得出小闭包。

        这才是 hops/direction 两个旋钮存在的意义——不是因为图分块，
        是因为**图连通所以必须自己划半径**。
        """
        got = impacted_closure(G, ["field:cust.phone"], hops=1, direction="dependents")
        assert got == {"field:cust.phone", "page:p2"}

    def test_改字段时谁会被弄坏(self, G):
        """逆着边走：依赖这个字段的东西。"""
        got = impacted_closure(G, ["field:order.amount"], hops=1, direction="dependents")
        assert "page:p1" in got, "绑了这个字段的页面没被算进来"
        assert "aigc:sum1" in got, "吃这个字段的能力没被算进来"
        assert "page:p2" not in got, "不相干的页面被卷进来了"

    def test_改页面时它依赖什么(self, G):
        """顺着边走：这一页引了哪些字段和权限。"""
        got = impacted_closure(G, ["page:p1"], hops=1, direction="dependencies")
        assert {"field:order.amount", "field:order.status",
                "perm:order:read", "perm:order:create"} <= got
        assert "field:cust.phone" not in got

    def test_两跳能从页面走到实体(self, G):
        """page → field → entity：改一页会牵扯到哪个实体。"""
        got = impacted_closure(G, ["page:p1"], hops=2, direction="dependencies")
        assert "entity:order" in got
        assert "entity:cust" not in got

    def test_不在图里的seed直接忽略(self, G):
        """反向判据：拼错的 id 不许硬塞进图。

        硬塞会让它变成孤立节点，闭包算出来只有它自己，看起来像"影响面很小"
        ——最坏的一种错：**看着正常**。
        """
        assert impacted_closure(G, ["page:不存在"], hops=3) == set()

    def test_负跳数报错(self, G):
        with pytest.raises(ValueError):
            impacted_closure(G, ["page:p1"], hops=-1)


class Test翻回段的语言:
    def test_节点映射到五系统段(self, G):
        assert segments_touched(G, ["field:order.amount"]) == {"datamodel"}
        assert segments_touched(G, ["perm:order:read", "role:mgr"]) == {"rbac"}
        assert segments_touched(G, ["wf:submit"]) == {"workflow"}
        assert segments_touched(G, ["page:p1"]) == {"page"}
        assert segments_touched(G, ["aigc:sum1"]) == {"aigc"}

    def test_改一个字段牵扯到哪几段(self, G):
        """这就是"改了这一块，牵扯的工作流/权限/数据模型也要更新"的答案。"""
        got = impacted_closure(G, ["field:order.amount"], hops=2)
        segs = segments_touched(G, got)
        assert {"datamodel", "page", "aigc"} <= segs

    def test_不认识的节点不硬塞段(self, G):
        assert segments_touched(G, ["不存在:x"]) == set()


class Test图不许跟闸漂移:
    """纪律四：点集必须复用闸的 collector，不能另抄一份。

    两份提取迟早漂移，而漂移的表现是"图上少了个点、影响面算漏了"——
    没有任何一处会报错。本仓在「修复器认 AIGC 能力 id、门禁不认」上栽过
    一次同款。
    """

    def test_图的点集覆盖闸认的所有可解析引用(self, G):
        from services.v5_model_gate import collect_invariant_ref_ids

        gate_refs = collect_invariant_ref_ids(MODEL)
        graph_bare = {nid.split(":", 1)[1] for nid in G["nodes"]}
        missing = gate_refs - graph_bare
        assert not missing, f"闸认得这些 id 而图上没有，影响面会算漏：{sorted(missing)[:10]}"

    def test_源码里没有另抄一份id提取(self):
        """反向判据：只准从 v5_model_gate 导入 collector，不许自己写一遍。"""
        import inspect
        import re

        from services import app_graph

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(app_graph)))
        assert "from .v5_model_gate import" in src, "没复用闸的 collector"
        assert "def _collect_" not in src, "自己另抄了一份 id 提取逻辑，迟早跟闸漂移"


class Test角色到页面_推导出来的那条边:
    """★ 2026-08-17：第一版漏了这条，是用户摆出沙盘截图才发现的。

    前端 `system-screens/sandbox-graph.ts` 早就画了 `role-page`，而这份
    Python 图没有。少了它，「改了这一页的权限，哪些角色进不来了」在服务端
    答不出来——而那正是影响分析要回答的问题。

    ⚠ 判据必须跟 TS 侧同口径，否则同一份模型在前端和后端得出不同的可达性
      ——CLAUDE.md 第四条「Python 判定 / TypeScript 运行时」那一行。
    """

    def test_权限有交集才连(self, G):
        e = {(s, d) for s, d, lbl in G["edges"] if lbl == "can_enter"}
        assert ("role:mgr", "page:p1") in e, "店长持有 order:read，订单页声明了它，该能进"
        assert ("role:clerk", "page:p2") in e, "店员持有 cust:read，客户页声明了它，该能进"

    def test_权限没交集就不连(self, G):
        e = {(s, d) for s, d, lbl in G["edges"] if lbl == "can_enter"}
        assert ("role:clerk", "page:p1") not in e, "店员没有订单权限却被判成能进"
        assert ("role:mgr", "page:p2") not in e

    def test_公共页不画(self):
        """反向判据：没声明权限 = 人人可进，画出来是全连接。

        信息量为零，还会把闭包撑爆——闭包一旦经过公共页，会把所有角色
        和它们能进的所有页面一起卷进来。
        """
        m = {
            "datamodel": {"entities": []},
            "rbac": {"roles": [{"id": "r1"}], "permissions": [],
                     "rolePermissions": {"r1": []}},
            "page": {"pages": [{"id": "pub", "name": "公共页"}]},
        }
        g = build_app_graph(m)
        assert not [e for e in g["edges"] if e[2] == "can_enter"]

    def test_改页面权限能算出哪些角色受影响(self, G):
        """这就是这条边存在的理由。"""
        got = impacted_closure(G, ["page:p1"], hops=1, direction="dependents")
        assert "role:mgr" in got, "改订单页的权限，店长受影响却没被算进来"
        assert "role:clerk" not in got

    def test_枢纽不往外走_角色落进闭包但不扫邻页(self, G):
        """精修作用域用的旋钮。默认闭包仍走全图（上面几条不能破）。"""
        got = impacted_closure(
            G, ["page:p1"], hops=2, direction="both",
            no_expand_kinds=("role", "perm"),
        )
        assert "role:mgr" in got
        assert "page:p2" not in got, "经角色扫到了不相干的页"


class Test两份实现钉在同一份契约上:
    """图在**两个运行时里各有一份**：Python 这份（服务端算影响面）和前端
    `system-screens/sandbox-graph.ts`（画沙盘 + 断线体检）。

    两份是有理由的——用途和运行时都不同，不是重复造轮子。但**边的词汇表
    不能各定一套**：同一份模型在前端画出来是通的、后端算影响面时却是断的，
    而这种不一致没有任何一处会报错。

    契约在 `shared/app-graph/edge-contract.json`，两边各自实现提取逻辑，
    但都必须覆盖它列的每一种边、且不许产出它没有的边。
    """

    @staticmethod
    def _contract():
        import json
        import pathlib

        p = pathlib.Path(__file__).resolve().parents[2] / "shared/app-graph/edge-contract.json"
        return json.loads(p.read_text(encoding="utf-8"))

    def test_契约里每种边这边都产得出(self, G):
        contract = self._contract()
        produced = {lbl for _, _, lbl in G["edges"]}
        for spec in contract["edges"]:
            want = set(spec["pythonLabels"])
            assert want & produced, (
                f"契约里的 `{spec['kind']}`（{spec['displayLabel']}）这边一条都没产出。"
                f"期望标签之一：{sorted(want)}"
            )

    def test_不许产出契约外的边(self, G):
        """反向判据：多出来的边同样要过审，写进契约才算数。

        悄悄多一种边，前端沙盘上就少一根线，而两边谁都不会报错。
        """
        contract = self._contract()
        allowed = {lbl for spec in contract["edges"] for lbl in spec["pythonLabels"]}
        allowed |= set(contract.get("pythonOnlyLabels") or {})
        produced = {lbl for _, _, lbl in G["edges"]}
        extra = produced - allowed
        assert not extra, f"这些边不在契约里：{sorted(extra)}——加边要先写进契约"

    def test_契约与TS的边类型一一对上(self):
        import pathlib
        import re

        ts = pathlib.Path(__file__).resolve().parents[2] / (
            "client/src/pages/sliderule/system-screens/sandbox-graph.ts"
        )
        if not ts.exists():
            import pytest as _pytest

            _pytest.skip("前端源码不在这个检出里")
        m = re.search(r"export type SandboxEdgeKind\s*=([^;]+);", ts.read_text(encoding="utf-8"))
        assert m, "TS 侧的边类型定义找不到了——链路变了，先确认现状再改判据"
        ts_kinds = set(re.findall(r'"([a-z-]+)"', m.group(1)))
        contract_kinds = {spec["kind"] for spec in self._contract()["edges"]}
        assert ts_kinds == contract_kinds, (
            f"契约与 TS 对不上。TS 多出：{sorted(ts_kinds - contract_kinds)}；"
            f"契约多出：{sorted(contract_kinds - ts_kinds)}"
        )

    def test_角色权限的口径由契约钉死(self):
        """★ 这条是这份契约存在的直接原因。

        TS 走 menus、Python 第一版走 rolePermissions，而真机里后者恒空——
        两边对"这个角色能进哪些页"得出完全不同的答案，没有任何一处报错。
        """
        rule = self._contract()["rules"]["role-perms-intersect-page-actions"]
        assert "menus" in rule["roleHeldPermissions"]["authoritative"]
        import inspect
        import re

        from services import app_graph

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(app_graph)))
        at_menus = src.find('rbac.get("menus")')
        at_rp = src.find('rbac.get("rolePermissions")')
        assert at_menus != -1, "没读 menus——真机上这条边会是零"
        assert at_rp == -1 or at_menus < at_rp, "rolePermissions 排在 menus 前面，口径反了"

    def test_源码里没有另抄一份id提取(self):
        """反向判据：只准从 v5_model_gate 导入 collector，不许自己写一遍。"""
        import inspect
        import re

        from services import app_graph

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(app_graph)))
        assert "from .v5_model_gate import" in src, "没复用闸的 collector"
        assert "def _collect_" not in src, "自己另抄了一份 id 提取逻辑，迟早跟闸漂移"


class Test拿真机模型验:
    """★ 判据必须落在**真实数据的形状**上，不是我自己编的形状。

    2026-08-17：`role → page` 那条边我第一版读 `rbac.rolePermissions`，
    fixture 里我自己填了它，判据全绿。而仓里四份真机模型的
    `rolePermissions` **全是空的**——真实数据一条不落全在 `rbac.menus` 里。
    也就是说那条边在真机上一条都产不出来，而没有任何一处会报错。

    这一组直接读 `experiments/refine-fingerprint/` 里落盘的真机模型。
    """

    @staticmethod
    def _real_models():
        import glob
        import json
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2]
        out = []
        for f in sorted(glob.glob(str(root / "experiments/refine-fingerprint/**/*round*.json"),
                                  recursive=True)):
            try:
                out.append((f, json.load(open(f, encoding="utf-8"))))
            except Exception:  # noqa: BLE001
                continue
        return out

    def test_真机模型上能建出图(self):
        models = self._real_models()
        if not models:
            import pytest as _pytest

            _pytest.skip("仓里没有落盘的真机模型")
        for path, m in models:
            g = build_app_graph(m)
            assert g["nodes"], f"{path}：真机模型建不出节点"
            assert g["edges"], f"{path}：真机模型建不出任何边"

    def test_真机模型上角色到页面的边不是零(self):
        """★ 本文件最要紧的一条。这条边一旦为零，影响分析就系统性漏掉权限那一手。"""
        models = self._real_models()
        if not models:
            import pytest as _pytest

            _pytest.skip("仓里没有落盘的真机模型")
        for path, m in models:
            g = build_app_graph(m)
            enters = [e for e in g["edges"] if e[2] == "can_enter"]
            menus = ((m.get("rbac") or {}).get("menus")) or []
            if not menus:
                continue  # 模型自己就没菜单，产不出这条边是如实反映
            assert enters, (
                f"{path}：模型里有 {len(menus)} 条菜单，却一条 can_enter 都没产出"
                f"——权限那只手在图上没连到页面"
            )

    def test_真机模型里rolePermissions确实是空的(self):
        """把"真实形状长什么样"这件事本身钉住。

        哪天它不空了，说明第 5 步的产物开始能活到第 6 步之后——那时这条
        兜底逻辑要重新评估，别让两份数据悄悄都生效。
        """
        models = self._real_models()
        if not models:
            import pytest as _pytest

            _pytest.skip("仓里没有落盘的真机模型")
        filled = [p for p, m in models if ((m.get("rbac") or {}).get("rolePermissions"))]
        assert not filled, (
            f"这些真机模型的 rolePermissions 不再是空的：{filled}。"
            f"模型里同一件事有两份数据（menus / rolePermissions），"
            f"两份都生效时口径以哪个为准要重新定。"
        )


class Test断线体检:
    """★ 闸查「引用有没有悬空」，体检查反面「东西在不在网里」。

    空数组里没有引用，自然没有悬空——**闸一个字都不会说**。一张没人读的表、
    一个没有手的角色、一页没有数据孔的界面，闸全部放行。

    ⚠ 2026-08-17 之前这件事**只有前端知道**：体检逻辑只在 sandbox-graph.ts
      里，意味着生成出来的应用可以带着孤岛交付，只有人打开沙盘才看得见。
      而增量迭代更容易制造孤岛——改一页把某个实体的最后一个引用删掉，
      那张表就悬空了，没有任何一处会拦。
    """

    def test_没人读的表报出来(self):
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": [
                {"id": "used", "name": "用着的", "fields": [{"id": "f", "name": "F"}]},
                {"id": "lonely", "name": "没人读的", "fields": [{"id": "g", "name": "G"}]},
            ]},
            "rbac": {"roles": [], "permissions": []},
            "page": {"pages": [{"id": "p1", "name": "页", "fieldBindings": ["used.f"]}]},
        }
        g = build_app_graph(m)
        keys = {o["key"] for o in find_orphans(g)}
        assert "entity:lonely" in keys
        assert "entity:used" not in keys

    def test_没有数据孔的页面报出来(self):
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": [{"id": "e", "name": "表", "fields": [{"id": "f", "name": "F"}]}]},
            "rbac": {"roles": [], "permissions": []},
            "page": {"pages": [
                {"id": "ok", "name": "有孔", "fieldBindings": ["e.f"]},
                {"id": "empty", "name": "空页"},
            ]},
        }
        g = build_app_graph(m)
        reasons = {o["key"]: o["reason"] for o in find_orphans(g)}
        assert "page:empty" in reasons and "没有数据孔" in reasons["page:empty"]
        assert "page:ok" not in reasons

    def test_没有手的角色报出来(self):
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": [{"id": "e", "name": "表", "fields": [{"id": "f", "name": "F"}]}]},
            "rbac": {"roles": [{"id": "busy", "name": "干活的"}, {"id": "idle", "name": "闲着的"}],
                     "permissions": ["e:read"],
                     "menus": [{"id": "m", "roleRefs": ["busy"], "permissionRefs": ["e:read"]}]},
            "page": {"pages": [{"id": "p", "name": "页", "fieldBindings": ["e.f"],
                                "actionPermissions": ["e:read"]}]},
        }
        g = build_app_graph(m)
        keys = {o["key"] for o in find_orphans(g)}
        assert "role:idle" in keys
        assert "role:busy" not in keys

    def test_接线全通时不报(self):
        """反向判据：别把正常的也报出来，否则这条提示会被当噪音忽略。"""
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": [{"id": "e", "name": "表", "fields": [{"id": "f", "name": "F"}]}]},
            "rbac": {"roles": [{"id": "r", "name": "角色"}], "permissions": ["e:read"],
                     "menus": [{"id": "m", "roleRefs": ["r"], "permissionRefs": ["e:read"]}]},
            "page": {"pages": [{"id": "p", "name": "页", "fieldBindings": ["e.f"],
                                "actionPermissions": ["e:read"]}]},
        }
        assert find_orphans(build_app_graph(m)) == []

    def test_工作流节点不判(self):
        """节点间连通性（transitions）不在这张图上，归流程屏判，这里不冤枉人。"""
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": []}, "rbac": {"roles": [], "permissions": []},
            "page": {"pages": []},
            "workflow": {"nodes": [{"id": "n1", "name": "孤立节点"}]},
        }
        assert [o for o in find_orphans(build_app_graph(m)) if o["kind"] == "wf"] == []

    def test_HTML有数据孔的空绑定页不报空界面(self):
        """覆盖闸认 data-record；体检查模型网。不是同一件事。

        不传 HTML 时仍报——沙盘 / 单测保持模型口径。
        """
        from services.app_graph import find_orphans

        m = {
            "datamodel": {"entities": [{"id": "e", "name": "表", "fields": [{"id": "f", "name": "F"}]}]},
            "rbac": {"roles": [], "permissions": []},
            "page": {"pages": [{"id": "p3", "name": "指南"}]},
        }
        g = build_app_graph(m)
        assert any(o["key"] == "page:p3" for o in find_orphans(g))
        html = {"p3": '<section data-record="guide"><p>入口</p></section>'}
        keys = {o["key"] for o in find_orphans(g, page_html=html)}
        assert "page:p3" not in keys
        still_empty = {"p3": "<section><p>纯文案</p></section>"}
        assert any(
            o["key"] == "page:p3" for o in find_orphans(g, page_html=still_empty)
        )

    def test_闸对这些孤岛全部放行(self):
        """★ 这条说明体检为什么必须存在：同一份模型，闸是绿的。"""
        from services.app_graph import find_orphans
        from services.v5_model_gate import validate_five_system_model

        m = {
            "datamodel": {"entities": [
                {"id": "e", "name": "表", "fields": [{"id": "f", "name": "F", "type": "string"}]},
                {"id": "lonely", "name": "没人读的", "fields": [{"id": "g", "name": "G", "type": "string"}]},
            ]},
            "rbac": {"roles": [{"id": "r", "name": "角色"}], "permissions": ["e:read"],
                     "menus": [{"id": "m", "roleRefs": ["r"], "permissionRefs": ["e:read"]}]},
            "workflow": {"nodes": []},
            "page": {"pages": [{"id": "p", "name": "页", "fieldBindings": ["e.f"],
                                "actionPermissions": ["e:read"]}]},
            "aigc": {"capabilities": []},
            "appbundle": {"landingPageRef": "p", "preferredDevice": "desktop"},
        }
        verdict = validate_five_system_model(m, require_page_kind_contract=False)
        assert verdict["passed"], "这份模型闸本来就该放行——孤岛不是悬空引用"
        assert any(o["key"] == "entity:lonely" for o in find_orphans(build_app_graph(m))), (
            "闸放行了，体检也不报，那这个孤岛就没有任何一处看得见"
        )
