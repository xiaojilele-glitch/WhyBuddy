"""第 5 步：(第 4 步产物 + SPEC) → 权限 / 工作流 / 不变式。

## 这一步在链路里的位置

    1 澄清+缺口+证据      ✅ 现成能力
    2 起草 SPEC           ✅ services/spec_tree.py
    3 spec 每页 → HTML    ✅ services/spec_page_html.py
  3.5 外壳统一            ✅ services/page_shell.py
    4 HTML → 结构         ✅ services/html_structure.py
    5 **本文件**：结构 + SPEC → 权限/工作流/不变式
    6 汇合 → 五系统模型 → 结构闸 → 设计

## 为什么必须两个输入，且是串行不是并行

这条边是六步里**唯一没有正面实测**的一条，但**两侧的反证都有实测**：

  少了 SPEC（只看画面）→ 退回行业常识
      实测：4 份 HTML 里「角色/权限/主管/管理员」出现 **0 次**、
      「成交/流失/归档/阶段」**0 次**；五组推出来的流程拓扑完全相同
      （5 节点 6 转移）。那是模型的行业常识，不是从这个产品读到的。

  少了结构（只看 SPEC）→ 写出悬空引用
      实测（2026-08-13 act2 那轮，结构闸 findings=1）：
      invariants[reassignment_preserves_audit_context].refs:
      invariant ref 'reassign_work_order' not found in model

所以分工是：**SPEC 给「该有什么规则」，第 4 步产物给「规则挂在什么上」。**
是相加不是替代——这一点本图上一版画错过（画成两条并行线），已更正。

## 抄了什么

### Casbin 的 {subject, object, action} 三元组

Apache Casbin 把授权统一成 `sub, obj, act`。五系统模型里的
`permissions: ["work_order:create", ...]` 正是 `obj:act`，roles 是 sub。
所以合法性判据直接照它的口径立：

    subject  必须是本份产出里真实存在的 role
    object   必须是**第 4 步推出来的实体**（不是模型现编的资源名）
    action   必须在封闭动作表里

这三条是这一步能不能验证的关键——它们把"编一条权限"变成机械可判的。

### 状态机的可达性判据（statechart 通用口径）

workflow 是个状态机。通用的良构判据只有三条：起点唯一可达、每个节点都从
起点到得了、至少有一个终态。孤儿节点和死胡同都是**能过形状校验、却在运行时
把流程卡死**的东西。

⚠ 没有照抄某个具体库：查过 Casbin 是 authz 不管 workflow，OpenFGA 是
关系式授权（Zanzibar 那一路）也不管状态机。状态机这三条是通识不是某家的
约定，所以这里写清是"通用口径"，不假称有出处。

## 角色为什么必须回指 persona

这是防"退回行业常识"那一侧的判据，跟第 4 步的 grounding 同一个思路：
**每个 role 必须 personaRef 到 SPEC 里的一个 persona**。模型想凭空加一个
「系统管理员」，就得先在 spec 的 personas 里找到它——找不到就拦。

第 2 步的契约里 personas 是必填的，这条判据才立得住。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

SPEC_SEMANTICS_VERSION = "spec-semantics-v1"

#: 封闭动作表。照 Casbin 的 act 维度立，取值对齐五系统模型里已经在用的那批
#: （work_order:create / read / update / assign / approve / export …）。
#: 不开放自由填写：动作一旦自由，permissions 就变成一句无法校验的自然语言。
ACTIONS: tuple[str, ...] = (
    "create", "read", "update", "delete",
    "assign", "approve", "reject", "export", "manage",
)

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_PERM_RE = re.compile(r"^([a-z][a-z0-9_]*):([a-z]+)$")


class DerivedRole(BaseModel):
    id: str
    name: str
    #: 回指 SPEC 的 persona id。**必填**——这是防"退回行业常识"那一侧的判据。
    personaRef: str

    @field_validator("id")
    @classmethod
    def id_shape(cls, v: str) -> str:
        if not _ID_RE.match(v or ""):
            raise ValueError(f"角色 id '{v}' 不合规：小写字母开头，只能有小写字母/数字/下划线")
        return v

    @field_validator("name", "personaRef")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("角色的 name 和 personaRef 都不能为空")
        return v.strip()


class WorkflowNode(BaseModel):
    id: str
    name: str
    #: 谁来办这一步。结构闸硬校验它 ∈ rbac.roles（v5_model_gate 第 2 条）。
    assigneeRole: str
    #: 这一步在流程里的阶段名（「申请」「审核」「执行」…），自由文本。
    phase: str = ""

    @field_validator("id")
    @classmethod
    def id_shape(cls, v: str) -> str:
        if not _ID_RE.match(v or ""):
            raise ValueError(f"节点 id '{v}' 不合规：小写字母开头，只能有小写字母/数字/下划线")
        return v


class WorkflowTransition(BaseModel):
    from_: str = Field(alias="from")
    to: str
    #: 什么条件下走这一条。空着等于"无条件"，允许，但多条无条件出边会被拦。
    condition: str = ""

    model_config = {"populate_by_name": True}


class Invariant(BaseModel):
    id: str
    statement: str
    #: 这条不变式管到哪些系统。
    systems: List[str] = Field(default_factory=list)
    #: 指向真实的 实体.字段 / 角色 / 工作流节点。悬空就是 act2 那次的失败形态。
    refs: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def needs_refs(self) -> "Invariant":
        if not self.refs:
            raise ValueError(
                f"不变式 '{self.id}' 一个 refs 都没有——那是一句没有约束对象的空话"
            )
        if not (self.statement or "").strip():
            raise ValueError(f"不变式 '{self.id}' 没有 statement")
        return self


class SpecSemantics(BaseModel):
    version: str = SPEC_SEMANTICS_VERSION
    roles: List[DerivedRole]
    #: `<实体id>:<动作>`，照 Casbin 的 obj:act。
    permissions: List[str]
    #: 角色 → 权限。分开放而不是塞进 role 里，是为了跟五系统模型的 rbac 段对齐。
    rolePermissions: Dict[str, List[str]] = Field(default_factory=dict)
    workflowNodes: List[WorkflowNode]
    workflowTransitions: List[WorkflowTransition]
    invariants: List[Invariant]

    @model_validator(mode="after")
    def basics(self) -> "SpecSemantics":
        if not self.roles:
            raise ValueError("一个角色都没有——第 5 步的产出不能为空")
        if not self.workflowNodes:
            raise ValueError("一个工作流节点都没有——第 5 步的产出不能为空")
        for label, ids in (
            ("角色", [r.id for r in self.roles]),
            ("工作流节点", [n.id for n in self.workflowNodes]),
            ("不变式", [i.id for i in self.invariants]),
        ):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            if dupes:
                raise ValueError(f"{label} id 重复：{dupes}")
        for perm in self.permissions:
            if not _PERM_RE.match(perm):
                raise ValueError(
                    f"权限 '{perm}' 形状不对，要写成 <实体id>:<动作>，例如 work_order:create"
                )
            if perm.split(":")[1] not in ACTIONS:
                raise ValueError(
                    f"权限 '{perm}' 的动作不在封闭动作表里，只能是 {list(ACTIONS)}"
                )
        return self

    @model_validator(mode="after")
    def roles_and_permissions_resolve(self) -> "SpecSemantics":
        """Casbin 口径：subject 与 object 都必须是真实存在的东西。"""
        role_ids = {r.id for r in self.roles}
        perms = set(self.permissions)
        for rid, granted in self.rolePermissions.items():
            if rid not in role_ids:
                raise ValueError(f"rolePermissions 里的 '{rid}' 不是已声明的角色")
            for p in granted:
                if p not in perms:
                    raise ValueError(
                        f"角色 '{rid}' 被授予了 '{p}'，但它不在 permissions 清单里"
                    )
        for node in self.workflowNodes:
            if node.assigneeRole not in role_ids:
                raise ValueError(
                    f"节点 '{node.id}' 的 assigneeRole '{node.assigneeRole}' 不是已声明的角色"
                    f"（结构闸也会拦这一条）"
                )
        return self

    @model_validator(mode="after")
    def workflow_is_reachable(self) -> "SpecSemantics":
        """状态机的通用良构判据：起点唯一、全部可达、至少一个终态。

        孤儿节点和死胡同都能过形状校验，却会在运行时**把流程卡死**——
        这类"形状对、跑起来是死的"正是本仓反复吃亏的形态。
        """
        ids = {n.id for n in self.workflowNodes}
        for t in self.workflowTransitions:
            for side, ref in (("from", t.from_), ("to", t.to)):
                if ref not in ids:
                    raise ValueError(f"转移的 {side} 指向不存在的节点 '{ref}'")

        targets = {t.to for t in self.workflowTransitions}
        starts = [n.id for n in self.workflowNodes if n.id not in targets]
        if len(starts) != 1:
            raise ValueError(
                f"起点应该恰好一个（没有入边的节点），现在有 {len(starts)} 个：{sorted(starts)}"
            )
        reached, frontier = {starts[0]}, [starts[0]]
        out: Dict[str, List[str]] = {}
        for t in self.workflowTransitions:
            out.setdefault(t.from_, []).append(t.to)
        while frontier:
            cur = frontier.pop()
            for nxt in out.get(cur, []):
                if nxt not in reached:
                    reached.add(nxt)
                    frontier.append(nxt)
        orphans = sorted(ids - reached)
        if orphans:
            raise ValueError(f"这些节点从起点走不到：{orphans}——孤儿节点会让流程卡死")
        if not [n for n in ids if n not in out]:
            raise ValueError("没有终态节点（所有节点都有出边）——流程永远结束不了")
        return self


from .spec_llm_call import call_spec_json

def check_grounded_in_inputs(
    semantics: SpecSemantics,
    *,
    structure: Dict[str, Any],
    spec: Dict[str, Any],
) -> List[Dict[str, str]]:
    """两侧接地：角色回指 SPEC，权限与不变式回指第 4 步产物。

    **这是本步能被验证的全部依据**，也是三臂对照实验量的两个数：

        角色可溯率  = 有合法 personaRef 的角色 / 全部角色   ← 少了 SPEC 会掉
        悬空引用数  = 指不到实体/字段/节点的 ref 数         ← 少了结构会涨
    """
    problems: List[Dict[str, str]] = []

    persona_ids = {str(p.get("id") or "") for p in (spec.get("personas") or [])}
    for r in semantics.roles:
        if r.personaRef not in persona_ids:
            problems.append({
                "path": f"roles[{r.id}].personaRef",
                "message": f"回指 '{r.personaRef}'，但 SPEC 的 personas 里没有它"
                           f"（真实的是 {sorted(persona_ids)}）——这个角色是凭空加的",
            })

    # ⚠ 反向也要查：SPEC 里的每个 persona 都得有角色认领。
    #
    # 三臂对照时发现的（2026-08-13）：只喂结构那一臂（H）产出**只有 1 个角色**，
    # 把 4 类使用者塌成了一个「前台接诊员」——可它那一个角色的 personaRef 恰好
    # 猜中了 'u1'，于是"可溯率"是 100%。**指标全绿，3/4 的角色没了。**
    #
    # 这正是今天反复出现的形状：只查"产出的东西对不对"，不查"该有的东西在不在"。
    # 同一课在第 4 步也上过一次（整页被丢、闸全绿），所以这里一并补上。
    covered = {r.personaRef for r in semantics.roles}
    for pid in sorted(persona_ids - covered):
        name = next((str(p.get("name") or "") for p in (spec.get("personas") or [])
                     if str(p.get("id") or "") == pid), pid)
        problems.append({
            "path": f"personas[{pid}]",
            "message": f"SPEC 里的使用者「{name}」没有任何角色认领它——"
                       f"这类使用者进了系统会无权可用",
        })

    entities = {e.get("id"): e for e in (structure.get("entities") or [])}
    for perm in semantics.permissions:
        obj = perm.split(":")[0]
        if obj not in entities:
            problems.append({
                "path": f"permissions[{perm}]",
                "message": f"object '{obj}' 不是第 4 步推出来的实体"
                           f"（真实实体：{sorted(entities)}）",
            })

    # 不变式的 refs 可以指：实体、实体.字段、角色、工作流节点
    valid: set[str] = set(entities)
    for eid, ent in entities.items():
        for f in ent.get("fields") or []:
            valid.add(f"{eid}.{f.get('id')}")
    valid |= {r.id for r in semantics.roles}
    valid |= {n.id for n in semantics.workflowNodes}
    for inv in semantics.invariants:
        for ref in inv.refs:
            if ref not in valid:
                problems.append({
                    "path": f"invariants[{inv.id}].refs",
                    "message": f"ref '{ref}' 指不到任何实体/字段/角色/节点——"
                               f"这正是 act2 那轮结构闸拦下的失败形态",
                })
    return problems


def validate_semantics(
    payload: Any,
    *,
    structure: Optional[Dict[str, Any]] = None,
    spec: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        sem = payload if isinstance(payload, SpecSemantics) else SpecSemantics.model_validate(payload)
    except ValidationError as exc:
        return {
            "passed": False,
            "findings": [
                {
                    "path": ".".join(str(x) for x in e.get("loc", ())) or "semantics",
                    "message": str(e.get("msg", "")).replace("Value error, ", ""),
                }
                for e in exc.errors()
            ],
        }
    except Exception as exc:  # noqa: BLE001
        return {"passed": False, "findings": [{"path": "semantics", "message": str(exc)[:200]}]}

    findings: List[Dict[str, str]] = []
    if structure is not None and spec is not None:
        findings = check_grounded_in_inputs(sem, structure=structure, spec=spec)
    return {"passed": not findings, "findings": findings}


_SYSTEM = (
    "你是把已定的需求与已推出的数据结构，落成权限、工作流、不变式的架构师。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 围栏。"
)


def build_prev_ids_block(prev_ids: Optional[Dict[str, Any]]) -> str:
    """精修时把上一版的「角色/流程节点名 → id」摆出来，要求认出同一个就照抄。

    ⚠ 权限不在这里列。它的形状是 `<实体id>:create`，**跟着实体 id 走**——
      实体 id 在第 4 步就稳住了，权限自然跟着稳。单独再列一份权限表，
      等于给同一件事两个真相，对不上时不知道该信谁。

    ⚠ 锚是名字不是位置，理由同 html_structure.build_prev_ids_block。
    """
    import json as _json

    parts = []
    for key, label in (("roles", "角色"), ("workflowNodes", "流程节点")):
        items = (prev_ids or {}).get(key) or []
        if items:
            parts.append(f"{label}：\n{_json.dumps(items, ensure_ascii=False, indent=1)}")
    if not parts:
        return ""
    return f"""
=== 上一版已经有的角色与流程节点 id（本轮是在它基础上迭代）===

{chr(10).join(parts)}

**认出同一个东西就照抄它的 id，一个字母都不要改。** 判断依据是 name：
上面叫「社区养老站长」的角色，这一轮你又推出「社区养老站长」，那它的 id
就必须还是上面那个，不许换成近义词（`station_manager` / `role_station_manager`
/ `manager_role` 是同一个东西，换来换去会让工作流、权限、页面上所有引用它的
地方全部悬空）。流程节点同理。

真正**新增**的角色/节点才自己起 id；上一版有而本轮 SPEC 里确实没有的，
不用硬凑进来。
"""


def build_prompt(
    structure: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    with_spec: bool = True,
    with_structure: bool = True,
    prev_ids: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, str]]:
    """装配对话。

    `with_spec` / `with_structure` 两个开关是给**三臂对照实验**用的：
    关掉一侧就能量出"少了它会怎样"。生产路径两个都开——两侧的反证都有实测，
    见模块头注。

    prev_ids（2026-08-17 加）：精修时上一版的角色/节点 id 词表，见
    build_prev_ids_block。不传则提示词逐字不变。
    """
    import json as _json

    blocks: List[str] = []
    if with_spec:
        personas = spec.get("personas") or []
        reqs = [n for n in (spec.get("nodes") or []) if n.get("type") == "requirement"]
        blocks.append(
            "=== SPEC：这个产品该有什么规则 ===\n"
            f"使用者：\n" + "\n".join(
                f"- id:{p.get('id')} {p.get('name')}"
                + (f"（{'；'.join(p.get('goals') or [])}）" if p.get("goals") else "")
                for p in personas
            )
            + "\n\n需求与验收条件：\n" + "\n".join(
                f"- {n.get('id')} {n.get('title')}：{n.get('acceptance')}" for n in reqs
            )
        )
    if with_structure:
        slim = {
            "entities": [
                {"id": e.get("id"), "name": e.get("name"),
                 "fields": [{"id": f.get("id"), "name": f.get("name"), "type": f.get("type")}
                            for f in (e.get("fields") or [])]}
                for e in (structure.get("entities") or [])
            ],
            "pages": [{"id": p.get("id"), "name": p.get("name"), "kind": p.get("kind")}
                      for p in (structure.get("pages") or [])],
        }
        blocks.append(
            "=== 已推出的数据结构：规则只能挂在这些东西上 ===\n"
            + _json.dumps(slim, ensure_ascii=False, indent=1)
        )

    body = f"""请产出这个产品的权限、工作流、不变式。JSON 形状严格如下（尖括号是占位说明，替换成真实值；**不要照抄示例里的任何名字**——示例故意不用具体业务词，就是免得你把它当成答案的一部分）：

{{
  "version": "{SPEC_SEMANTICS_VERSION}",
  "roles": [{{"id": "<角色id>", "name": "<角色名>", "personaRef": "<SPEC 里的 persona id>"}}],
  "permissions": ["<实体id>:create", "<实体id>:read"],
  "rolePermissions": {{"<角色id>": ["<实体id>:create"]}},
  "workflowNodes": [
    {{"id": "<节点id>", "name": "<节点名>", "assigneeRole": "<角色id>", "phase": "<阶段名>"}}
  ],
  "workflowTransitions": [
    {{"from": "<节点id>", "to": "<另一个节点id>", "condition": "<什么条件下走这一条>"}}
  ],
  "invariants": [
    {{"id": "<不变式id>", "statement": "<一句话说清约束什么>",
      "systems": ["datamodel", "workflow"],
      "refs": ["<实体id>", "<实体id>.<字段id>", "<节点id>"]}}
  ]
}}

硬性要求（不满足会被机械校验拦下，然后把错误原文喂回给你重做）：

1. **每个 role 必须 personaRef 到 SPEC 里真实存在的 persona id。**
   想加一个 SPEC 里没有的角色，就是在编——编出来的一定是行业常识而不是
   这个产品的真实需求。
   ⚠ 反过来也一样：**SPEC 里列的每一个 persona 都必须有一个角色认领它，
   一个都不许漏**。少一个，那类使用者进了系统就无权可用。
2. 权限写成 `<实体id>:<动作>`。**实体 id 只能用上面「已推出的数据结构」里
   列的那些**，不许自己发明资源名。动作只能是：{", ".join(ACTIONS)}。
3. workflowNodes 的 assigneeRole 必须是你自己声明的 role。
4. 工作流必须是个走得通的状态机：**恰好一个起点**（没有入边的节点）、
   每个节点都从起点到得了、**至少一个终态**（没有出边的节点）。
   孤儿节点和死胡同能过形状校验，却会在运行时把流程卡死。
5. 不变式的 refs 只能指：实体 id、`实体id.字段id`、角色 id、工作流节点 id。
   指不到的就是悬空引用——**宁可少写一条不变式，也不要写一条指不到东西的。**
{build_prev_ids_block(prev_ids)}
{chr(10).join(blocks)}"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


class SpecSemanticsError(RuntimeError):
    """推导失败。**不回落**——编出来的权限比没有权限更危险。"""


def derive_semantics(
    structure: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Callable[[List[Dict[str, str]]], Optional[Dict[str, Any]]]] = None,
    max_reask: int = 2,
    with_spec: bool = True,
    with_structure: bool = True,
    prev_ids: Optional[Dict[str, Any]] = None,
) -> SpecSemantics:
    messages = build_prompt(
        structure, spec,
        with_spec=with_spec, with_structure=with_structure, prev_ids=prev_ids,
    )
    last = "未调用"
    for attempt in range(max_reask + 1):
        outcome = call_spec_json(messages, llm_json_fn, stage="specfirst.semantics")
        payload = outcome.payload
        if payload is None:
            last = outcome.failure or "LLM 没有返回可解析的 JSON"
            # 传输/配额层挂了：没拿到任何东西，没有可以喂回去的内容，而且
            # 下层 call_llm_with_retry 已经退避重试过了。再转两圈是拿重问
            # 额度去做下层刚做完的事——实测 11.6 秒跑完三次尝试就是这个形状。
            if outcome.transport:
                break
        else:
            verdict = validate_semantics(payload, structure=structure, spec=spec)
            if verdict["passed"]:
                return SpecSemantics.model_validate(payload)
            last = "；".join(f"{f['path']}：{f['message']}" for f in verdict["findings"][:8])
        if attempt == max_reask:
            break
        import json as _json

        messages = messages + [
            {"role": "assistant", "content": _json.dumps(payload or {}, ensure_ascii=False)[:4000]},
            {"role": "user", "content": (
                f"上面这份没通过机械校验，问题是：\n{last}\n\n"
                "只改错的地方，其余保持原样，重新输出完整 JSON。"
                "指不到东西的引用**就把那一条整个删掉**，不要换个名字硬凑。"
            )},
        ]
    raise SpecSemanticsError(f"权限/工作流推导失败（重问 {max_reask} 次后）：{last}")


def to_model_sections(semantics: SpecSemantics) -> Dict[str, Any]:
    """转成五系统模型的 rbac / workflow / invariants 三段形状（第 6 步汇合时用）。

    personaRef 不带过去——它是**这一步的校验依据**，不是 rbac 的一部分，
    带过去会污染结构闸的形状校验（那边不认识这个键）。
    """
    return {
        "rbac": {
            "roles": [{"id": r.id, "name": r.name} for r in semantics.roles],
            "permissions": list(semantics.permissions),
        },
        "workflow": {
            "nodes": [
                {"id": n.id, "name": n.name, "assigneeRole": n.assigneeRole, "phase": n.phase}
                for n in semantics.workflowNodes
            ],
            "transitions": [
                {"from": t.from_, "to": t.to, "condition": t.condition}
                for t in semantics.workflowTransitions
            ],
        },
        "invariants": [
            {"id": i.id, "statement": i.statement, "systems": list(i.systems), "refs": list(i.refs)}
            for i in semantics.invariants
        ],
    }


