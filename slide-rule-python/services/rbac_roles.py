"""角色的两种写法，一处归一（2026-08-05）。

## 为什么角色需要这么一层

模型里所有概念都是 **id + 中文名** 配对——实体 `{id, name}`、字段 `{id, name}`、
菜单 `{id, label}`、页面 `{id, name}`、流程节点 `{id, name}`。**只有角色是一根
光杆字符串**：

    "roles": ["warehouse_keeper", "store_clerk", ...]

于是界面上、流程条上、角色下拉里显示的全是 `warehouse_keeper`。前端那层
"引用 → 显示名"的解析器把这件事暴露得最清楚：`resolveEntityRef` 能吐
`entity.name || entity.id`，`resolveRoleRef` 只能把 id 原样吐回去——**label
那个位置早就留好了，只是没东西可填**。

所以补的不是翻译，是模型里本来就缺的那半个字段。

## 为什么必须同时吃两种形态

- 新生成的模型：`[{"id": "warehouse_keeper", "name": "仓库管理员"}]`
- 内置域夹具（services/data/builtin_domain_models.json）：`["requester", "manager"]`
- **线上库里已有的应用**：全是字符串

存量一条都不迁移——它们数据里就没有中文名，迁移只能瞎编。所以两种形态永远
共存，判断收在这一处；散开写迟早只改一半。

## 为什么 id 不能直接写成中文

id 同时是 `roleRefs`、`workflow.assigneeRole`、`aigc.roleRefs`、
`appbundle.roleRef` 的引用键，还会被投影成生成代码里的常量、存进
localStorage。把"标识符"和"显示名"合成一个，以后想改名就会连引用一起断——
这正是模型里其他概念都要分开写两个字段的原因。
"""

from __future__ import annotations

from typing import Any, Dict, List


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def role_entries(rbac: Any) -> List[Dict[str, str]]:
    """rbac → `[{"id": ..., "label": ...}]`，两种写法都吃。

    没有中文名时 label 回落成 id：显示成英文总好过显示空白，而且一眼能看出
    "这个应用是补字段之前生成的"。
    """
    out: List[Dict[str, str]] = []
    seen: set = set()
    for role in _as_list((rbac or {}).get("roles") if isinstance(rbac, dict) else None):
        if isinstance(role, str):
            rid, label = role.strip(), role.strip()
        elif isinstance(role, dict):
            rid = str(role.get("id") or role.get("name") or "").strip()
            label = str(role.get("name") or role.get("label") or "").strip() or rid
        else:
            continue
        if not rid or rid in seen:
            continue
        seen.add(rid)
        out.append({"id": rid, "label": label})
    return out


def role_ids(rbac: Any) -> List[str]:
    """只要引用键。所有 `roleRefs ∈ rbac.roles` 的校验都该用它。"""
    return [r["id"] for r in role_entries(rbac)]


def role_labels(rbac: Any) -> Dict[str, str]:
    """id → 显示名。"""
    return {r["id"]: r["label"] for r in role_entries(rbac)}
