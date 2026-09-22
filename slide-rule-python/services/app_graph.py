# -*- coding: utf-8 -*-
"""把五系统模型摊成一张**显式的图**：谁引用谁（2026-08-17）。

## 为什么要有它

这个系统的核心不是那几页 HTML。HTML 是木偶——只有样子，自己不会动，
既读不了数据也写不了。真正让它动起来的是**数据模型 + 权限 + 工作流**：
它们不在页面上，却伸进页面的每一处，决定哪里显示什么、谁能点、点了走到哪。

这张网本来就存在，只是**一直是隐式的**：它散落在 `v5_model_gate` 的十几处
DANGLING 检查里——闸每次都在走这些边，走完就丢，没人把图本身拿出来用。
于是"改了这一块，还牵扯到哪些东西"这个问题，在代码里问不出来。

本模块把边显式化。它不新增任何规则，**只是把闸已经在走的边摆到台面上**。

## ⚠ 节点必须带 kind 前缀

实体 `order` 和页面 `order` 在各自的域里都合法，裸 id 会**悄悄合并成一个
节点**——那种错在图上看不出来，只会让影响面算错。所以一律
`entity:order` / `page:p1` / `role:mgr` / `perm:order:read` / `wf:n1` /
`aigc:c1` / `field:order.amount`。

## ⚠ 无界闭包会吞掉全图，所以必须限跳数（这个结论被翻过两次）

  1. 最初写"这张网强连通，无界闭包必然覆盖全图"。
  2. 判据一验就红：订单页出发十二跳只覆盖 11/15，客户那一簇够不着。
     于是**更正**成"按实体簇分块，簇内连通、簇间隔离"。
  3. 然后发现图**漏了一条边**——`role → page`（可进入），前端沙盘
     （`system-screens/sandbox-graph.ts`）早就画了。补上之后再验，全图重新
     连通：角色是跨簇的桥，同一个角色既在订单流程里当审批人、又能进客户页。

所以第 2 步那个"更正"是**基于不完整的图得出的错误结论**，而且它看起来
完全合理。真正的教训不是"图分不分块"，是：

    **图缺一条边，影响分析就会系统性低估影响面——而低估的结果毫无破绽。**

正因为全图连通，`impacted_closure` 才必须强制传跳数：半径得自己划，
图不会替你划。

## 边的方向：引用者 → 被引用者

    page:p1        → field:order.amount     （页面绑了这个字段）
    page:p1        → perm:order:read        （这一页上的动作要这个权限）
    wf:n1          → role:mgr               （这个节点派给这个角色）
    aigc:c1        → field:order.amount     （能力吃这个字段）
    perm:order:read→ entity:order           （权限属于这个实体）
    field:o.amount → entity:order           （字段属于这个实体）

于是两个方向各有各的问法：

    顺着边走（dependencies）：这个东西**依赖**谁 —— 我改了它，我引的还在吗
    逆着边走（dependents）  ：谁**依赖**这个东西 —— 我改了它，谁会被弄坏
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


def _as_dict(x: Any) -> Dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _as_list(x: Any) -> List[Any]:
    return x if isinstance(x, list) else []


def _sid(kind: str, ident: Any) -> str:
    return f"{kind}:{ident}"


def build_app_graph(model: Dict[str, Any]) -> Dict[str, Any]:
    """五系统模型 → `{"nodes": {id: {kind, name}}, "edges": [(src, dst, label)]}`。

    ⚠ 节点集**复用 v5_model_gate 的 collector**，不在这里另抄一份 id 提取逻辑。
      两份提取迟早漂移，而漂移的表现是"图上少了个点，影响面算漏了"——
      没有任何一处会报错。本仓在「修复器认 AIGC 能力 id、门禁不认」上
      栽过一次同款（见 _resolvable_refs 的注释）。
    """
    from .v5_model_gate import (
        _collect_aigc_capability_ids,
        _collect_datamodel_field_refs,
        _collect_page_ids,
        _collect_permission_ids,
        _collect_role_ids,
        _collect_workflow_ids,
    )

    m = _as_dict(model)
    datamodel, rbac = _as_dict(m.get("datamodel")), _as_dict(m.get("rbac"))
    workflow, page = _as_dict(m.get("workflow")), _as_dict(m.get("page"))
    aigc, appbundle = _as_dict(m.get("aigc")), _as_dict(m.get("appbundle"))

    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Tuple[str, str, str]] = []

    def add_node(kind: str, ident: Any, name: Any = None) -> Optional[str]:
        if ident is None or str(ident).strip() == "":
            return None
        nid = _sid(kind, ident)
        if nid not in nodes:
            nodes[nid] = {"kind": kind, "name": str(name) if name else str(ident)}
        elif name and nodes[nid]["name"] == str(ident):
            nodes[nid]["name"] = str(name)
        return nid

    def add_edge(src: Optional[str], dst: Optional[str], label: str) -> None:
        # ⚠ 只连**两端都在图里**的边。指向不存在的 id 是悬空引用，那是闸的活
        #   （DANGLING），不是图的活。在这里悄悄补一个节点会把"引用坏了"
        #   变成"图上多一个孤点"，把真问题藏起来。
        if src and dst and src in nodes and dst in nodes:
            edges.append((src, dst, label))

    # ── 点 ──────────────────────────────────────────────────────────
    for e in _as_list(datamodel.get("entities")):
        ed = _as_dict(e)
        add_node("entity", ed.get("id"), ed.get("name"))
        for f in _as_list(ed.get("fields")):
            fd = _as_dict(f)
            if ed.get("id") and fd.get("id"):
                add_node("field", f"{ed['id']}.{fd['id']}", fd.get("name"))
    for r in _as_list(rbac.get("roles")):
        rd = _as_dict(r)
        add_node("role", rd.get("id") if rd else r, rd.get("name") if rd else None)
    for p in _collect_permission_ids(rbac):
        add_node("perm", p)
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        add_node("page", pd.get("id"), pd.get("name"))
    for n in _as_list(workflow.get("nodes")):
        nd = _as_dict(n)
        add_node("wf", nd.get("id"), nd.get("name"))
    for c in _as_list(aigc.get("capabilities")):
        cd = _as_dict(c)
        add_node("aigc", cd.get("id"), cd.get("name"))

    # ── 边 ──────────────────────────────────────────────────────────
    # 字段 → 所属实体；权限 → 所属实体（权限形如 `<实体id>:<动作>`）
    for nid, meta in list(nodes.items()):
        if meta["kind"] == "field":
            ent = nid.split(":", 1)[1].split(".", 1)[0]
            add_edge(nid, _sid("entity", ent), "belongs_to")
        elif meta["kind"] == "perm":
            ent = nid.split(":", 1)[1].split(":", 1)[0]
            add_edge(nid, _sid("entity", ent), "on_entity")

    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = _sid("page", pd.get("id"))
        for fb in _as_list(pd.get("fieldBindings")):
            add_edge(pid, _sid("field", fb), "binds_field")
        for ap in _as_list(pd.get("actionPermissions")):
            add_edge(pid, _sid("perm", ap), "needs_perm")

    for n in _as_list(workflow.get("nodes")):
        nd = _as_dict(n)
        add_edge(_sid("wf", nd.get("id")), _sid("role", nd.get("assigneeRole")), "assigned_to")

    for c in _as_list(aigc.get("capabilities")):
        cd = _as_dict(c)
        cid = _sid("aigc", cd.get("id"))
        for fb in _as_list(cd.get("inputFields")):
            add_edge(cid, _sid("field", fb), "reads_field")
        out = cd.get("outputField")
        if out:
            add_edge(cid, _sid("field", out), "writes_field")
        for rr in _as_list(cd.get("roleRefs")):
            add_edge(cid, _sid("role", rr), "for_role")

    for pb in _as_list(appbundle.get("pageBindings")):
        bd = _as_dict(pb)
        pid = _sid("page", bd.get("pageRef"))
        add_edge(pid, _sid("wf", bd.get("workflowRef")), "drives_workflow")

    # 角色 → 页面（可进入）。**这条是推导出来的，不是字面引用**——
    #
    # ⚠ 2026-08-17 我第一版漏了它，是用户把沙盘截图摆出来才发现的：
    #   前端 `client/src/pages/sliderule/system-screens/sandbox-graph.ts`
    #   早就画了这条 `role-page` 边，而我这份 Python 图没有。少了它，
    #   「改了这一页的权限，哪些角色进不来了」这个问题在服务端答不出来
    #   ——而那正是影响分析要回答的问题。
    #
    # 判据跟 TS 侧逐字对齐（sandbox-graph.ts 第 2 条 + rbac-preview 的
    # PageAccess）：页面声明的 actionPermissions 与角色持有的权限**有交集**
    # 才算可进。两边口径分叉的话，同一份模型会在前端和后端得出不同的可达性
    # ——正是 CLAUDE.md 第四条「Python 判定 / TypeScript 运行时」那一行。
    # ⚠⚠ 角色持有哪些权限，模型里**有两份数据**，而且它们不一致：
    #
    #     rbac.rolePermissions       第 5 步（spec_semantics）产出
    #     rbac.menus[].roleRefs/permissionRefs   第 6 步（汇合绑定）产出
    #
    #   2026-08-17 拿仓里四份真机模型验过：**rolePermissions 全是空的**，
    #   真实数据一条不落全在 menus 里。我第一版读 rolePermissions，于是这条边
    #   在真机上一条都产不出来——而判据全绿，因为 fixture 是我自己编的、
    #   带着 rolePermissions。**判据验的是我的假设，不是现实。**
    #
    #   所以以 menus 为准（跟 TS 侧 rbac-preview.deriveRoleAccess 同源），
    #   rolePermissions 仅在 menus 缺席时兜底。
    #
    # ⚠ 「同一件事两份数据」本身是个待清理的问题，不归这个模块解决；
    #   这里只保证**不再多出第三种口径**。
    role_perms: Dict[str, Set[str]] = {}
    for mn in _as_list(rbac.get("menus")):
        md = _as_dict(mn)
        perms = {str(p) for p in _as_list(md.get("permissionRefs"))}
        for rr in _as_list(md.get("roleRefs")):
            role_perms.setdefault(str(rr), set()).update(perms)
    if not role_perms:
        for role_id, perms in _as_dict(rbac.get("rolePermissions")).items():
            role_perms[str(role_id)] = {str(p) for p in _as_list(perms)}
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        declared = {str(x) for x in _as_list(pd.get("actionPermissions"))}
        # ⚠ 公共页（没声明权限）**不画**：那是"人人可进"，画出来是
        #   角色 × 页面的全连接，信息量为零还会把闭包撑爆。同 TS 侧。
        if not declared:
            continue
        for role_id, held in role_perms.items():
            if held & declared:
                add_edge(_sid("role", role_id), _sid("page", pd.get("id")), "can_enter")

    return {"nodes": nodes, "edges": edges}


def _adjacency(graph: Dict[str, Any]) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
    fwd: Dict[str, Set[str]] = {}
    rev: Dict[str, Set[str]] = {}
    for src, dst, _label in graph.get("edges") or []:
        if src == dst:
            continue  # 自环不参与传播，否则闭包里全是它自己
        fwd.setdefault(src, set()).add(dst)
        rev.setdefault(dst, set()).add(src)
    return fwd, rev


def impacted_closure(
    graph: Dict[str, Any],
    seeds: Iterable[str],
    *,
    hops: int,
    direction: str = "both",
    no_expand_kinds: Optional[Iterable[str]] = None,
) -> Set[str]:
    """从 seeds 出发走 `hops` 跳，返回**受影响的节点集合**（含 seeds 本身）。

    `direction`：

        "dependents"    只逆着边走 —— 谁依赖我。改了我，**谁会被弄坏**
        "dependencies"  只顺着边走 —— 我依赖谁。改了我，**我引的还在吗**
        "both"          两边都走

    `no_expand_kinds`：落在这些 kind 上算进闭包，但**不从它们往外走**。
    角色是跨簇的桥（模块头翻过两次的那条），沿 `role` 再走一跳等于扫全图。
    过夜咖啡馆：种子哪怕是对的那一页，两跳也会经 `role:staff` 把三页全吃进去。
    形状对齐 Nx 后来不再把 `package.json` 当成 `"*"` 隐式依赖——枢纽节点
    不当扩散起点。默认不拦（沙盘/体检要看完整可达性）；精修作用域自己打开。

    ⚠ `hops` **是必填的**，不给默认值。补齐 role→page 之后全图连通
      （角色是跨簇的桥），无界闭包最后必然覆盖全部节点——那时"影响面"
      等于"全部"，跟不做影响分析没区别。半径得自己划，图不会替你划。
      这个结论被翻过两次，来回见模块头。

    ⚠ 不在图里的 seed 直接忽略，不报错也不硬塞。硬塞会让一个拼错的 id
      变成一个孤立节点，闭包算出来只有它自己，看起来像"影响面很小"——
      那是最坏的一种错：**看着正常**。
    """
    if hops < 0:
        raise ValueError("hops 不能是负数")
    nodes = graph.get("nodes") or {}
    blocked = {str(k) for k in (no_expand_kinds or ()) if k}
    fwd, rev = _adjacency(graph)
    frontier = {s for s in seeds if s in nodes}
    seen: Set[str] = set(frontier)
    for _ in range(hops):
        nxt: Set[str] = set()
        for n in frontier:
            if blocked and (nodes.get(n) or {}).get("kind") in blocked:
                continue
            if direction in ("both", "dependencies"):
                nxt |= fwd.get(n, set())
            if direction in ("both", "dependents"):
                nxt |= rev.get(n, set())
        nxt -= seen
        if not nxt:
            break
        seen |= nxt
        frontier = nxt
    return seen


def segments_touched(graph: Dict[str, Any], node_ids: Iterable[str]) -> Set[str]:
    """一批节点落在哪几个五系统段上。

    这是把图上的结论**翻回段的语言**——精修沿用、判作用域那些地方问的
    还是"哪几段要重新生成"。
    """
    kind_to_segment = {
        "entity": "datamodel",
        "field": "datamodel",
        "role": "rbac",
        "perm": "rbac",
        "page": "page",
        "wf": "workflow",
        "aigc": "aigc",
    }
    nodes = graph.get("nodes") or {}
    out: Set[str] = set()
    for nid in node_ids:
        meta = nodes.get(nid)
        if meta:
            seg = kind_to_segment.get(meta["kind"])
            if seg:
                out.add(seg)
    return out


#: 断线体检的判据表。**逐条对齐前端 sandbox-graph.ts 的第 3 节**——
#: 那边是给人看的（打开沙盘才知道），这边是给生成链路用的（产出时就知道）。
#:
#: ⚠ 只报**机械可判**的，不猜。工作流节点之间的连通性（transitions）不在
#:   这张图上，归流程屏判，这里不冤枉人——同 TS 侧。
_ORPHAN_RULES = {
    # ⚠ 实体这条要**穿一层字段**看，不能只看指向实体自己的边。
    #   TS 那边 page→entity 是直连；这边更细，是 page→field→entity 两跳。
    #   照抄 TS 的写法（只看实体自己的入边）会把 `belongs_to` 算成"有人用"
    #   ——而每个实体都有自己的字段指向它，于是**永远判不出孤岛**。
    #   2026-08-17 第一版就是这么写的，判据当场咬出来。
    "entity": (
        "via-fields", ("binds_field", "reads_field", "writes_field"),
        "没有任何页面读它、也没有 AIGC 写它——这张表是孤岛",
    ),
    "page": (
        "dependencies", ("binds_field",),
        "一个实体都没绑——这一页没有数据孔，界面是空的",
    ),
    "role": (
        "any", (),
        "没有连到任何页面/审批点/AIGC——这个角色在应用里没有手",
    ),
    "aigc": (
        "dependencies", ("writes_field", "reads_field"),
        "输出字段没有落在任何实体上——生成的东西无处安放",
    ),
    # ⚠ 2026-09-05 补：权限这一类原先**没有规则**，于是「声明了一个动作，
    #   却没有任何页面提供它」在图上完全看不见。
    #
    #   真机（社区养老 sr-20260904181150）：模型声明了 elder:update、
    #   staff:manage、service_order:create、qc_work_order:create 四条权限，
    #   四个页面的 actionPermissions 里**一条都没有**——也就是这个应用
    #   「可以新建服务工单」是纸面上的，界面上没有任何地方能新建。
    #   用户那道题的第 1 条「老人全景档案」进不去，就是这个形状：
    #   长者字段在工单页上看得见，但没有一处能建档、能改档。
    #
    #   相关性闸量的是"叫法像不像"，量不出这个；SPEC 的 pages_are_usable
    #   只查页→需求，不查反向。这条规则补的正是那个反面（§3）。
    #
    #   跟其它孤岛一样**只报不拦**（§7）：真库 171 个会话里 51% 至少有一条，
    #   拿它去打死推演不划算——它是"这个应用哪里还没做"的清单，不是正确性错误。
    "perm": (
        "dependents", ("needs_perm",),
        "没有任何页面提供这个动作——这条权限声明了却用不上",
    ),
}


def _page_has_visible_data_source(html: str) -> bool:
    """用户看得见的数据孔。键表跟打孔那一步同一份，不另造。"""
    from .html_bindings import DATA_SOURCE_KEYS

    text = html or ""
    return any(f"data-{k}=" in text for k in DATA_SOURCE_KEYS)


def find_orphans(
    graph: Dict[str, Any],
    *,
    page_html: Optional[Dict[str, str]] = None,
) -> List[Dict[str, str]]:
    """图上的孤岛：**东西在不在网里**。返回 `[{key, kind, name, reason}]`。

    page_html（2026-08-19）：交付出口在打孔之后才调用。指南页常见
    `data-record` / `data-rows` 而模型 `fieldBindings` 为空——覆盖闸认孔，
    体检查的是模型网。打孔前按模型网报「一个实体都没绑」是谎。
    沙盘（sandbox-graph.ts）仍只看模型网，两边用途不同，不许悄悄并成一套。

    ## 为什么闸查不出来

    `v5_model_gate` 查的是「引用有没有悬空」——引用了一个不存在的 id 才报。
    而孤岛是**反面**：空数组里没有引用，自然没有悬空，**闸一个字都不会说**。
    一张没人读的表、一个没有手的角色、一页没有数据孔的界面，闸全部放行。

    这对判据（闸 = 正向，体检 = 反向）是 CLAUDE.md 第三条在架构层面的样子。

    ## ⚠ 2026-08-17 之前这件事**只有前端知道**

    体检逻辑原本只在 `client/.../sandbox-graph.ts` 里，意味着：生成出来的应用
    可以**带着孤岛交付，只有人打开沙盘才看得见**。而增量迭代更容易制造孤岛
    ——改一页把某个实体的最后一个引用删掉，那张表就悬空了，没有任何一处会拦。
    这个函数把同一套判据搬到服务端，让孤岛在产出时就说得出话。

    ## fail 的方向

    **只报不拦。** 孤岛是质量问题不是正确性问题（模型本身仍然自洽、闸也过），
    拿它去打死一次能跑完的推演不划算。调用方决定怎么用——记账、提示、
    或者在精修时当作"这一改把东西改没了"的信号。
    """
    nodes = graph.get("nodes") or {}
    fwd, rev = _adjacency(graph)
    labels: Dict[Tuple[str, str], Set[str]] = {}
    for src, dst, lbl in graph.get("edges") or []:
        labels.setdefault((src, dst), set()).add(lbl)

    def has(node: str, side: str, kinds: Tuple[str, ...]) -> bool:
        if side == "any":
            return bool(fwd.get(node)) or bool(rev.get(node))
        if side == "via-fields":
            # 实体专用：看它**自己或它的任一字段**有没有被绑/读/写。
            targets = [node] + [
                n for n in nodes
                if nodes[n]["kind"] == "field"
                and n.split(":", 1)[1].split(".", 1)[0] == node.split(":", 1)[1]
            ]
            return any(has(t, "dependents", kinds) for t in targets)
        peers = fwd.get(node, set()) if side == "dependencies" else rev.get(node, set())
        for peer in peers:
            pair = (node, peer) if side == "dependencies" else (peer, node)
            if labels.get(pair, set()) & set(kinds):
                return True
        return False

    out: List[Dict[str, str]] = []
    for nid, meta in nodes.items():
        rule = _ORPHAN_RULES.get(meta["kind"])
        if not rule:
            continue
        side, kinds, reason = rule
        if meta["kind"] == "page" and page_html is not None:
            page_id = nid.split(":", 1)[1]
            html = page_html.get(page_id)
            if html is not None and _page_has_visible_data_source(html):
                continue
        if not has(nid, side, kinds):
            out.append({"key": nid, "kind": meta["kind"], "name": meta["name"], "reason": reason})
    return out
