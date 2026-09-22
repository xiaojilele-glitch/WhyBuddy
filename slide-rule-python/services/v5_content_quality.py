"""v5_content_quality — 五系统模型的确定性内容质量启发式（路线 3 · D1）。

结构 gate（v5_model_gate）保证"引用不悬挂"；本模块回答"内容像不像一个
认真设计的系统"——全部确定性规则，零 LLM、零波动，可当回归门：

- 流程形状：纯线性（无分支）？有无驳回/回退出路？终态数
- 可达性：声明了 actionPermissions 的页面是否至少有一个角色可见
  （真实案例：宠物领养话题的 adopter:read 未授予任何角色 → 页面全员锁定）
- 最小权限：满权角色（违反最小权限嫌疑）、无人持有的孤儿权限、无用角色
- 数据面完整：孤儿实体（无任何页面/AIGC/ref/装配引用）、空页面（无字段绑定）

severity 语义：
  fail — 生成内容存在"用户一上手就会撞墙"的硬伤（当前仅 PAGE_UNREACHABLE）
  warn — 深度/完备性短板，回归趋势值得盯，但单条不足以拦截
  info — 备查信号

LLM-as-judge 维度（需求覆盖度/行业常识/命名质量）在 D2 叠加，不在此模块。
纯函数：模型进、结论出，无副作用。
"""

from __future__ import annotations

from typing import Any, Dict, List

from .rbac_roles import role_ids


def _as_list(v: Any) -> List[Any]:
    return v if isinstance(v, list) else []


def _as_dict(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _finding(code: str, severity: str, detail: str) -> Dict[str, str]:
    return {"code": code, "severity": severity, "detail": detail}


def _role_permissions(model: Dict[str, Any]) -> Dict[str, set]:
    """角色 → 权限并集（rbac.menus 的 roleRefs × permissionRefs，与客户端口径一致）。"""
    rbac = _as_dict(model.get("rbac"))
    # ⚠ 别写成 `if isinstance(r, str)`。2026-08-05 角色补了中文名之后是
    # `{"id","name"}` 对象，那种写法会**静默过滤成零个角色**——下面每一条
    # 质量检查都跟着失效，而且一个 finding 都不报，看起来像"全都合格"。
    roles = role_ids(rbac)
    grants: Dict[str, set] = {r: set() for r in roles}
    for menu in _as_list(rbac.get("menus")):
        menu = _as_dict(menu)
        perms = {p for p in _as_list(menu.get("permissionRefs")) if isinstance(p, str)}
        for role in _as_list(menu.get("roleRefs")):
            if isinstance(role, str) and role in grants:
                grants[role] |= perms
    return grants


def analyze_content_quality(model: Dict[str, Any]) -> Dict[str, Any]:
    """确定性内容质量分析。返回 {metrics, findings, hardFailCount}。"""
    model = _as_dict(model)
    findings: List[Dict[str, str]] = []

    datamodel = _as_dict(model.get("datamodel"))
    entities = [_as_dict(e) for e in _as_list(datamodel.get("entities"))]
    entity_ids = [e.get("id") for e in entities if isinstance(e.get("id"), str)]

    rbac = _as_dict(model.get("rbac"))
    roles = role_ids(rbac)  # 两种写法都吃，见 services/rbac_roles.py
    declared_permissions = [p for p in _as_list(rbac.get("permissions")) if isinstance(p, str)]
    role_perms = _role_permissions(model)

    workflow = _as_dict(model.get("workflow"))
    nodes = [_as_dict(n) for n in _as_list(workflow.get("nodes"))]
    node_ids = [n.get("id") for n in nodes if isinstance(n.get("id"), str)]
    transitions = [_as_dict(t) for t in _as_list(workflow.get("transitions"))]

    pages = [_as_dict(p) for p in _as_list(_as_dict(model.get("page")).get("pages"))]
    caps = [_as_dict(c) for c in _as_list(_as_dict(model.get("aigc")).get("capabilities"))]
    bundle = _as_dict(model.get("appbundle"))

    # ---- 流程形状 -----------------------------------------------------------
    out_degree: Dict[str, int] = {nid: 0 for nid in node_ids}
    order = {nid: i for i, nid in enumerate(node_ids)}
    has_back_edge = False
    for t in transitions:
        src, dst = t.get("from"), t.get("to")
        if isinstance(src, str) and src in out_degree:
            out_degree[src] += 1
        if (
            isinstance(src, str)
            and isinstance(dst, str)
            and src in order
            and dst in order
            and order[dst] <= order[src]
        ):
            has_back_edge = True
    branch_nodes = sum(1 for d in out_degree.values() if d > 1)
    terminals = sum(1 for d in out_degree.values() if d == 0)
    linear = bool(nodes) and branch_nodes == 0
    if linear and len(nodes) > 1:
        findings.append(
            _finding(
                "WORKFLOW_LINEAR",
                "warn",
                f"流程 {len(nodes)} 节点全部单出边（无任何分支判断）——真实审批几乎必有条件分流",
            )
        )
    if nodes and terminals < 2 and not has_back_edge:
        findings.append(
            _finding(
                "WORKFLOW_NO_REJECT_PATH",
                "warn",
                "流程只有单一结局且无回退边——缺少驳回/退回/取消出路",
            )
        )

    # ---- 页面可达性（fail 级：一上手就撞墙） --------------------------------
    unreachable_pages: List[str] = []
    empty_pages: List[str] = []
    for page in pages:
        pid = str(page.get("id") or page.get("name") or "?")
        actions = {a for a in _as_list(page.get("actionPermissions")) if isinstance(a, str)}
        if actions and roles:
            reachable = any(role_perms.get(r, set()) & actions for r in roles)
            if not reachable:
                unreachable_pages.append(pid)
                findings.append(
                    _finding(
                        "PAGE_UNREACHABLE",
                        "fail",
                        f"页面 {pid} 声明了 {len(actions)} 个动作权限，但没有任何角色持有其一——全员锁定",
                    )
                )
        if not _as_list(page.get("fieldBindings")):
            empty_pages.append(pid)
            findings.append(
                _finding("PAGE_EMPTY", "warn", f"页面 {pid} 没有任何字段绑定（空页面）")
            )

    # ---- 最小权限 -----------------------------------------------------------
    over_privileged: List[str] = []
    if len(declared_permissions) >= 5:
        for role, perms in role_perms.items():
            ratio = len(perms & set(declared_permissions)) / len(declared_permissions)
            if ratio >= 0.9:
                over_privileged.append(role)
                findings.append(
                    _finding(
                        "ROLE_OVER_PRIVILEGED",
                        "warn",
                        f"角色 {role} 持有 {round(ratio * 100)}% 的声明权限——最小权限嫌疑",
                    )
                )
    granted_union = set().union(*role_perms.values()) if role_perms else set()
    orphan_permissions = [p for p in declared_permissions if p not in granted_union]
    if orphan_permissions:
        findings.append(
            _finding(
                "PERMISSION_ORPHAN",
                "warn",
                f"{len(orphan_permissions)} 个声明权限无任何角色持有：{', '.join(orphan_permissions[:6])}"
                + ("…" if len(orphan_permissions) > 6 else ""),
            )
        )
    assignee_roles = {n.get("assigneeRole") for n in nodes if isinstance(n.get("assigneeRole"), str)}
    aigc_roles = {r for c in caps for r in _as_list(c.get("roleRefs")) if isinstance(r, str)}
    bundle_roles = {r for r in _as_list(bundle.get("roleRefs")) if isinstance(r, str)}
    unused_roles = [
        r
        for r in roles
        if not role_perms.get(r) and r not in assignee_roles and r not in aigc_roles and r not in bundle_roles
    ]
    if unused_roles:
        findings.append(
            _finding(
                "ROLE_UNUSED",
                "warn",
                f"{len(unused_roles)} 个角色无权限、不审批、无 AIGC/装配引用：{', '.join(unused_roles[:6])}",
            )
        )

    # ---- 孤儿实体 -----------------------------------------------------------
    referenced: set = set()
    for page in pages:
        for b in _as_list(page.get("fieldBindings")):
            if isinstance(b, str) and "." in b:
                referenced.add(b.split(".", 1)[0])
    for c in caps:
        for f in _as_list(c.get("inputFields")) + ([c.get("outputField")] if c.get("outputField") else []):
            if isinstance(f, str) and "." in f:
                referenced.add(f.split(".", 1)[0])
    referenced |= {e for e in _as_list(bundle.get("dataModelRefs")) if isinstance(e, str)}
    for entity in entities:
        for field in _as_list(entity.get("fields")):
            fid = _as_dict(field).get("id")
            ftype = str(_as_dict(field).get("type") or "").lower()
            if isinstance(fid, str) and (ftype == "ref" or fid.endswith("_ref")):
                base = fid.removesuffix("_ref").removesuffix("_id")
                for eid in entity_ids:
                    if eid == base or eid.startswith(f"{base}_") or eid.endswith(f"_{base}"):
                        referenced.add(eid)
    orphan_entities = [e for e in entity_ids if e not in referenced]
    if orphan_entities:
        findings.append(
            _finding(
                "ENTITY_ORPHAN",
                "warn",
                f"{len(orphan_entities)} 个实体无任何页面/AIGC/ref/装配引用：{', '.join(orphan_entities[:6])}",
            )
        )

    hard_fail = sum(1 for f in findings if f["severity"] == "fail")
    return {
        "metrics": {
            "workflowLinear": linear,
            "branchNodes": branch_nodes,
            "terminals": terminals,
            "hasBackEdge": has_back_edge,
            "unreachablePages": len(unreachable_pages),
            "emptyPages": len(empty_pages),
            "overPrivilegedRoles": len(over_privileged),
            "orphanPermissions": len(orphan_permissions),
            "unusedRoles": len(unused_roles),
            "orphanEntities": len(orphan_entities),
        },
        "findings": findings,
        "hardFailCount": hard_fail,
    }
