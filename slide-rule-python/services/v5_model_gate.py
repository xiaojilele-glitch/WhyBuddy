"""
Five-system structural closure gate (the moat).

Validates that an LLM-generated five-system model is *structurally* closed:
every cross-system reference must resolve to a real node. This is the depth
that separates "AI can name the modules" (anyone can) from "the five systems
are wired by one model and verifiable".

Contract (see docs/Intent-to-App 五系统闭包样板 · SPEC.md, 验收标准 4):
    validate_five_system_model(model) -> {"passed": bool, "findings": [...]}
    Any dangling cross-reference => passed=False + a precise
    PUBLISH_DANGLING_CROSSREF finding naming the exact ref + path.

The model shape this gate expects (also the shape the LLM generator targets):

    {
      "datamodel": {"entities": [{"id","name","fields":[{"id","name","type"}]}]},
      "rbac":      {"roles": [{"id":"applicant","name":"申请人"}, ...],
                    "permissions": ["purchase:create", ...],
                    "menus": [{"id","label","roleRefs":["applicant"],"permissionRefs":[...]}]},
      "workflow":  {"nodes": [{"id","name","assigneeRole":"dept_manager"}],
                    "transitions": [{"from","to","condition"?}]},
      "page":      {"pages": [{"id","name","fieldBindings":["purchase_request.amount"],
                               "actionPermissions":["purchase:approve_dept"]}]},
      "aigc":      {"capabilities": [{"id","name","inputFields":["purchase_request.amount"],
                                      "outputField":"purchase_request.reason","roleRefs":[...]}]},
      "appbundle": {"pageBindings": [{"pageRef","workflowRef"?}],
                    "roleRefs": [...], "dataModelRefs": ["purchase_request"]}
    }

All checks are pure + deterministic. No LLM, no IO.
"""

from __future__ import annotations
from .archetype_legal import device_domain_or as _device_domain_or
from .archetype_legal import historic_preferred_devices as _historic_preferred_devices
from .archetype_legal import required_evidence as _required_evidence
from .archetype_legal import supported_devices as _supported_devices

from typing import Any, Dict, List

#: ⚠ 2026-08-30：第 11 处手抄的六系统词表——而且是**结构闸自己那一份**。
#: `v5_llm_generate` 的注释写着 "mirrors v5_model_gate.SKILL_KEYS"，
#: 「mirror」正是本仓第四条点名的形状：两份靠人肉对齐，改一份不报错。
#: 现在同源于产品原型账本。
SKILL_KEYS = _required_evidence()

DANGLING = "PUBLISH_DANGLING_CROSSREF"
MISSING_SECTION = "PUBLISH_MISSING_SKILL_SECTION"
EMPTY_SECTION = "PUBLISH_EMPTY_SKILL_SECTION"
MISSING_REQUIRED = "PUBLISH_MISSING_REQUIRED_FIELD"
PUBLISH_INVALID_FIELD = "PUBLISH_INVALID_FIELD"
PUBLISH_ENUM_VIOLATION = "PUBLISH_ENUM_VIOLATION"

# 合法域一律来自 schema_legal 加载的 JSON 账本（E40.1）——五系统枚举在
# five_system_legal.json，体验区块在 experience_block_catalog.json。
# 此处 re-export 保持历史名字；加合法值只改对应账本，四方一致性由测试锁死。
from .schema_legal import (  # noqa: F401 — re-export 即接口
    CHART_TYPES,
    EXPERIENCE_BLOCK_ALLOWED_REGIONS,
    EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE,
    EXPERIENCE_BLOCK_BINDING_SCHEMAS,
    EXPERIENCE_BLOCK_TYPES,
    FIELD_TONES,
    FIELD_TYPES,
    NUMBER_FORMATS,
    PAGE_SURFACE_DENSITIES,
    PAGE_SURFACE_TYPES,
    PAGE_KINDS,
    PAGE_PRESENTATIONS,
    STAT_FORMATS,
    STRING_FORMATS,
)


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finding(code: str, path: str, message: str, ref: str = "", skill: str = "") -> Dict[str, Any]:
    return {"code": code, "path": path, "message": message, "ref": ref, "affectedSkill": skill}


def _collect_datamodel_field_refs(datamodel: Dict[str, Any]) -> set:
    """Return the set of fully-qualified field refs: 'entityId.fieldId' + bare 'entityId'."""
    refs: set = set()
    for entity in _as_list(datamodel.get("entities")):
        e = _as_dict(entity)
        eid = str(e.get("id") or e.get("name") or "").strip()
        if not eid:
            continue
        refs.add(eid)
        for field in _as_list(e.get("fields")):
            f = _as_dict(field)
            fid = str(f.get("id") or f.get("name") or "").strip()
            if fid:
                refs.add(f"{eid}.{fid}")
    return refs


def _validate_block_binding(
    block_path: str,
    btype: str,
    binding: Dict[str, Any],
    entity_ids: set,
    field_types: Dict[str, str],
    findings: List[Dict[str, Any]],
) -> None:
    """按 experience_block_catalog.json 的 bindingSchema 校验一个区块的 binding：
    必填字段、枚举取值、引用字段的实体归属与类型、聚合表达式、数值范围。
    同一份账本驱动 Prompt 文案（schema_legal._format_binding_schema）和这里的
    校验——改账本两边自动同步，不再各写一份（E40.1 单一真相源延伸到 binding 层）。
    区块类型不在合法域内时上层已经报过，这里直接跳过不重复报。"""
    schema = EXPERIENCE_BLOCK_BINDING_SCHEMAS.get(btype)
    if schema is None:
        return

    # 这类积木压根不吃 binding（QuickActionPanel / WorkflowTimeline）。塞了就
    # 直说"它不该有 binding"，别让它掉到下面按 entityRef 悬挂去报——那条报错
    # 说的是"实体找不到"，会把人引去查数据模型，而真正该做的是把整个 binding
    # 删掉。freeform 的 BlockRef 深校验早就有这条规则，page.blocks 这边漏了。
    if not schema.get("required") and not schema.get("optional") and binding:
        findings.append(_finding(
            PUBLISH_INVALID_FIELD, f"{block_path}.binding",
            f"{btype} takes no binding; remove the binding object "
            f"(got keys: {sorted(binding)})",
            ref=btype, skill="page",
        ))
        return

    entity_ref = str(binding.get("entityRef") or "").strip()
    if entity_ref and entity_ref not in entity_ids:
        findings.append(_finding(
            DANGLING, f"{block_path}.binding.entityRef",
            f"entityRef '{entity_ref}' not found in datamodel.entities",
            ref=entity_ref, skill="page",
        ))

    for field in schema.get("required", []):
        value = binding.get(field)
        if value is None or value == "":
            findings.append(_finding(
                MISSING_REQUIRED, f"{block_path}.binding.{field}",
                f"{btype} binding requires '{field}'",
                ref=field, skill="page",
            ))

    for field, legal_values in schema.get("enums", {}).items():
        value = binding.get(field)
        if value and value not in legal_values:
            findings.append(_finding(
                PUBLISH_ENUM_VIOLATION, f"{block_path}.binding.{field}",
                f"{field} must be one of {'/'.join(legal_values)}, got '{value}'",
                ref=str(value), skill="page",
            ))

    for field, bounds in schema.get("ranges", {}).items():
        value = binding.get(field)
        if value is not None:
            lo, hi = bounds
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not (lo <= value <= hi):
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} must be a number in [{lo}, {hi}], got '{value}'",
                    ref=str(value), skill="page",
                ))

    # entityRef 本身缺失/悬挂已经报过；没有实体锚点无法解析字段归属，不重复报噪音
    if entity_ref and entity_ref in entity_ids:
        for field, expected_type in schema.get("entityFieldRefs", {}).items():
            value = binding.get(field)
            if not value:
                continue
            qualified = f"{entity_ref}.{value}"
            if qualified not in field_types:
                findings.append(_finding(
                    DANGLING, f"{block_path}.binding.{field}",
                    f"{field} '{value}' not found in entity '{entity_ref}' fields",
                    ref=str(value), skill="page",
                ))
            elif field_types[qualified] != expected_type:
                findings.append(_finding(
                    DANGLING, f"{block_path}.binding.{field}",
                    f"{field} '{value}' must be a {expected_type} field (got '{field_types[qualified]}')",
                    ref=str(value), skill="page",
                ))

        # 带标题的字段分组（SectionedForm.sections / DataTable.columnGroups）。
        #
        # 2026-08-09 批次 5/7 加的形状：`[{title, fieldRefs:[...]}]`。校验三件事
        # ——分组本身是对象、标题非空、里面每个字段都真的属于这个实体。
        #
        # **标题必须非空**，这条比看着重要：分段表单和多级表头的全部意义就是那个
        # 标题；标题空了，界面上就是几组没名字的字段挤在一起，比不分组更糟。
        for field, spec in (schema.get("entityFieldGroups") or {}).items():
            value = binding.get(field)
            if value is None:
                continue
            if not isinstance(value, list):
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} must be an array of {{title, fieldRefs}} groups, got '{value}'",
                    ref=str(value), skill="page",
                ))
                continue
            max_groups = spec.get("maxGroups")
            if max_groups and len(value) > max_groups:
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} accepts at most {max_groups} group(s), got {len(value)}",
                    ref=str(len(value)), skill="page",
                ))
            max_each = spec.get("maxFieldsPerGroup")
            for gi, group in enumerate(value):
                where = f"{block_path}.binding.{field}[{gi}]"
                if not isinstance(group, dict):
                    findings.append(_finding(
                        PUBLISH_INVALID_FIELD, where,
                        f"group must be an object with title and fieldRefs, got '{group}'",
                        ref=str(group), skill="page",
                    ))
                    continue
                if not str(group.get("title") or "").strip():
                    findings.append(_finding(
                        PUBLISH_INVALID_FIELD, f"{where}.title",
                        "group title must not be empty — the title is the whole point of grouping",
                        ref="", skill="page",
                    ))
                refs = group.get("fieldRefs")
                if not isinstance(refs, list) or not refs:
                    findings.append(_finding(
                        PUBLISH_INVALID_FIELD, f"{where}.fieldRefs",
                        f"fieldRefs must be a non-empty array of field ids, got '{refs}'",
                        ref=str(refs), skill="page",
                    ))
                    continue
                if max_each and len(refs) > max_each:
                    findings.append(_finding(
                        PUBLISH_INVALID_FIELD, f"{where}.fieldRefs",
                        f"a group accepts at most {max_each} field(s), got {len(refs)}",
                        ref=str(len(refs)), skill="page",
                    ))
                for field_ref in refs:
                    qualified = f"{entity_ref}.{field_ref}"
                    if qualified not in field_types:
                        findings.append(_finding(
                            DANGLING, f"{where}.fieldRefs",
                            f"'{field_ref}' not found in entity '{entity_ref}' fields",
                            ref=str(field_ref), skill="page",
                        ))

        # 数组型字段引用（ActivityFeed 宽行档的 detailFieldRefs）：逐个落到同
        # 一实体上。写成非数组、或超出 maxItems 都拦——渲染端只能画声明得清楚
        # 的列，模糊的声明到了运行时只能猜，猜出来的列是编的。
        for field, spec in (schema.get("entityFieldRefLists") or {}).items():
            value = binding.get(field)
            if value is None:
                continue
            if not isinstance(value, list):
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} must be an array of field ids, got '{value}'",
                    ref=str(value), skill="page",
                ))
                continue
            max_items = spec.get("maxItems")
            if max_items and len(value) > max_items:
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} accepts at most {max_items} field(s), got {len(value)}",
                    ref=str(len(value)), skill="page",
                ))
            want_type = spec.get("fieldType")
            for field_ref in value:
                qualified = f"{entity_ref}.{field_ref}"
                if qualified not in field_types:
                    findings.append(_finding(
                        DANGLING, f"{block_path}.binding.{field}",
                        f"{field} '{field_ref}' not found in entity '{entity_ref}' fields",
                        ref=str(field_ref), skill="page",
                    ))
                elif want_type and field_types[qualified] != want_type:
                    findings.append(_finding(
                        DANGLING, f"{block_path}.binding.{field}",
                        f"{field} '{field_ref}' must be a {want_type} field "
                        f"(got '{field_types[qualified]}')",
                        ref=str(field_ref), skill="page",
                    ))

        for field in schema.get("aggregateFields", []):
            value = binding.get(field)
            if not value or value == "count":
                continue
            prefix, sep, field_ref = str(value).partition(":")
            if sep and prefix in ("sum", "avg"):
                qualified = f"{entity_ref}.{field_ref}"
                if qualified not in field_types:
                    findings.append(_finding(
                        DANGLING, f"{block_path}.binding.{field}",
                        f"{field} '{value}' references unknown field '{field_ref}' on entity '{entity_ref}'",
                        ref=field_ref, skill="page",
                    ))
                elif field_types[qualified] != "number":
                    findings.append(_finding(
                        DANGLING, f"{block_path}.binding.{field}",
                        f"{field} '{value}' must reference a number field (got '{field_types[qualified]}')",
                        ref=field_ref, skill="page",
                    ))
            else:
                findings.append(_finding(
                    PUBLISH_INVALID_FIELD, f"{block_path}.binding.{field}",
                    f"{field} must be 'count', 'sum:<fieldId>', or 'avg:<fieldId>', got '{value}'",
                    ref=str(value), skill="page",
                ))


def _collect_field_types(datamodel: Dict[str, Any]) -> Dict[str, str]:
    """'entityId.fieldId' → 字段类型（小写）。页面范式绑定校验用。"""
    types: Dict[str, str] = {}
    for entity in _as_list(datamodel.get("entities")):
        e = _as_dict(entity)
        eid = str(e.get("id") or e.get("name") or "").strip()
        if not eid:
            continue
        for field in _as_list(e.get("fields")):
            f = _as_dict(field)
            fid = str(f.get("id") or f.get("name") or "").strip()
            if fid:
                types[f"{eid}.{fid}"] = str(f.get("type") or "string").strip().lower()
    return types


def _collect_role_ids(rbac: Dict[str, Any]) -> set:
    """角色引用键集合。两种写法都吃——判断收在 services/rbac_roles.py 一处。"""
    from .rbac_roles import role_ids

    return set(role_ids(rbac))


def _collect_permission_ids(rbac: Dict[str, Any]) -> set:
    perms: set = set()
    for perm in _as_list(rbac.get("permissions")):
        if isinstance(perm, str):
            perms.add(perm.strip())
        elif isinstance(perm, dict):
            pid = str(perm.get("id") or perm.get("name") or "").strip()
            if pid:
                perms.add(pid)
    return perms


def _collect_page_ids(page: Dict[str, Any]) -> set:
    ids: set = set()
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = str(pd.get("id") or pd.get("name") or "").strip()
        if pid:
            ids.add(pid)
    return ids


def _iter_workflow_chains(workflow: Dict[str, Any]):
    """Yield (path_label, chain_dict) for the primary chain + optional extra chains.

    多链路（改进①，见 docs/reverse-eval-ai-artist-saas.md）：顶层 id/nodes/transitions
    仍是主链路（老模型/老消费者零破坏），`chains` 携带资金/治理/补偿等附加链路，
    结构与主链路同构。
    """
    yield "workflow", workflow
    for i, chain in enumerate(_as_list(workflow.get("chains"))):
        cd = _as_dict(chain)
        label = str(cd.get("id") or cd.get("name") or i)
        yield f"workflow.chains[{label}]", cd


def _collect_workflow_chain_ids(workflow: Dict[str, Any]) -> set:
    """workflow.chains[] 的 id/name 集合（不含主链路、不含节点 id）——
    WorkflowTimeline 的 props.chainRef 只认这个集合，跟悬挂引用检查用的
    "chain+node 混一起"那份 _collect_workflow_ids 是两回事，不能共用。"""
    ids: set = set()
    for chain in _as_list(workflow.get("chains")):
        cd = _as_dict(chain)
        cid = str(cd.get("id") or cd.get("name") or "").strip()
        if cid:
            ids.add(cid)
    return ids


def _collect_workflow_ids(workflow: Dict[str, Any]) -> set:
    """Workflow is referenced by its top-level id, chain ids, and/or node ids."""
    ids: set = set()
    for _path, chain in _iter_workflow_chains(workflow):
        wid = str(chain.get("id") or chain.get("name") or "").strip()
        if wid:
            ids.add(wid)
        for node in _as_list(chain.get("nodes")):
            nd = _as_dict(node)
            nid = str(nd.get("id") or nd.get("name") or "").strip()
            if nid:
                ids.add(nid)
    return ids


def _collect_aigc_capability_ids(aigc: Dict[str, Any]) -> set:
    ids: set = set()
    for cap in _as_list(aigc.get("capabilities")):
        cid = str(_as_dict(cap).get("id") or "").strip()
        if cid:
            ids.add(cid)
    return ids


def collect_invariant_ref_ids(model: Any) -> set:
    """不变式 refs 的合法解析域：实体/字段/角色/权限/页面/流程节点/AIGC 能力。

    门禁第 7 节与 v5_model_repair 共用本函数——两边各自维护集合曾导致
    奇偶不齐（修复器认 AIGC 能力 id、门禁不认 → 合法不变式被误拦，
    线上案例 ref 'vocal_pitch_coach'）。合法域只在这里改。
    """
    m = _as_dict(model)
    return (
        _collect_datamodel_field_refs(_as_dict(m.get("datamodel")))
        | _collect_role_ids(_as_dict(m.get("rbac")))
        | _collect_permission_ids(_as_dict(m.get("rbac")))
        | _collect_page_ids(_as_dict(m.get("page")))
        | _collect_workflow_ids(_as_dict(m.get("workflow")))
        | _collect_aigc_capability_ids(_as_dict(m.get("aigc")))
    )


def validate_five_system_model(
    model: Any,
    *,
    require_landing_page_ref: bool = False,
    require_preferred_device: bool = False,
    require_page_kind_contract: bool = True,
) -> Dict[str, Any]:
    """Structural closure gate. Returns {'passed': bool, 'findings': [...]}.

    passed=True iff all six sections exist + are non-empty AND every cross-system
    reference resolves. Fail-closed: any problem => passed=False with precise findings.

    require_landing_page_ref=True (strict mode): appbundle.landingPageRef must be
    present, non-None, and non-blank. Use for LLM-generated and LLM-refined models.
    Defaults to False for backward-compat (old snapshots without the field still pass).

    require_preferred_device=True: appbundle.preferredDevice must be one of
    the wired devices in the product-archetype ledger. The tolerant default
    still accepts missing values and historic snapshots (desktop/tablet/phone).

    require_page_kind_contract（2026-08-14 加，默认 True = 老行为）：
      kanban 必须有 statusField、calendar 必须有 dateField。这两条是**老渲染器
      （AppRuntimeScreen）的输入需求**——它渲染看板/日历时要知道按哪个字段分列、
      按哪个字段排期。

      **新链路传 False**：那条链路的交付物是第 3 步的 HTML，页面长什么样由 HTML
      决定；全仓 dateField 没有一个新链路消费者，运行时也不读 page.kind。
      拿一个没人会用的字段拦下整条链路，代价是回落老路（2026-08-14 口腔连锁
      那轮就是这么挂的）。

      ⚠ 只关「必须存在」这一支。字段**给了就必须指到本页实体的对应类型字段**——
        那条解析/类型校验对两条链路一视同仁，不受此开关影响。
    """
    findings: List[Dict[str, Any]] = []
    m = _as_dict(model)

    # 1. All six sections present + non-empty.
    for skill in SKILL_KEYS:
        if skill not in m:
            findings.append(_finding(MISSING_SECTION, skill, f"missing skill section: {skill}", skill=skill))
        elif not _as_dict(m.get(skill)):
            findings.append(_finding(EMPTY_SECTION, skill, f"empty skill section: {skill}", skill=skill))
    if findings:
        # Structure incomplete — no point checking cross-refs against absent sections.
        return {"passed": False, "findings": findings}

    datamodel = _as_dict(m.get("datamodel"))
    rbac = _as_dict(m.get("rbac"))
    workflow = _as_dict(m.get("workflow"))
    page = _as_dict(m.get("page"))
    aigc = _as_dict(m.get("aigc"))
    appbundle = _as_dict(m.get("appbundle"))

    field_refs = _collect_datamodel_field_refs(datamodel)
    role_ids = _collect_role_ids(rbac)
    perm_ids = _collect_permission_ids(rbac)
    page_ids = _collect_page_ids(page)
    workflow_ids = _collect_workflow_ids(workflow)
    entity_ids = {r for r in field_refs if "." not in r}

    # Minimum viable content: each section must carry the primitives others reference.
    if not field_refs:
        findings.append(_finding(EMPTY_SECTION, "datamodel.entities", "datamodel has no entities/fields", skill="datamodel"))
    if not role_ids:
        findings.append(_finding(EMPTY_SECTION, "rbac.roles", "rbac has no roles", skill="rbac"))
    if not page_ids:
        findings.append(_finding(EMPTY_SECTION, "page.pages", "page has no pages", skill="page"))

    # 1.5 datamodel 字段语义（加厚 schema 一期，可选字段）：出现即校验、缺省不罚
    #     （老模型零破坏）。enum options：非空、id 非空且唯一、tone ∈ 合法域、
    #     只允许出现在 enum 字段上；format：合法域且与字段类型匹配
    #     （number → money/percent/progress/score/rating；string/text → masked）。
    for entity in _as_list(datamodel.get("entities")):
        ed = _as_dict(entity)
        eid = ed.get("id") or ed.get("name") or "<unnamed>"
        for field in _as_list(ed.get("fields")):
            fd = _as_dict(field)
            fid = fd.get("id") or fd.get("name") or "<unnamed>"
            fpath = f"datamodel.entities[{eid}].fields[{fid}]"
            ftype = str(fd.get("type") or "string").strip().lower()
            # 字段类型必须落在封闭合法域内。
            #
            # 这条以前是漏的：FIELD_TYPES 只在技能 binding 那里用过，实体字段的
            # type 一路没人查。实测喂 boolean/datetime/file 三个进来，findings
            # 一条都没有、全放行——所谓"合法域"其实只是 prompt 里的一句约定。
            #
            # 漏掉的代价不是"模型写错了没人说"，而是**静默降级**：前端
            # field-value-type 对认不出的类型一律 `return "text"`，于是一个
            # `file` 字段会安安静静变成普通文本输入框。用户以为这儿能传附件，
            # 实际只能打字；不报错、不提示，测试也全绿。
            #
            # 缺省不罚（上面 `or "string"`）：老模型不写 type 的照旧当 string，
            # 与本段"出现即校验、缺省不罚"的口径一致。
            if fd.get("type") is not None and ftype not in FIELD_TYPES:
                findings.append(_finding(
                    PUBLISH_ENUM_VIOLATION, f"{fpath}.type",
                    f"field type '{ftype}' is not one of {'/'.join(FIELD_TYPES)}",
                    ref=ftype, skill="datamodel",
                ))
            # refEntity：关系字段的目标声明（2026-08-11）。
            #
            # ## 为什么必须由模型声明，而不是运行时猜
            #
            # 契约原来没有这个键，前端只能**按字段名猜**目标实体
            # （`guessRefEntityId`：剥掉 _ref/_id 后缀再跟实体 id 匹配，歧义就
            # 放弃）。拿 181 份真实生成模型量过：1689 个 ref 字段里只有 691 个
            # （41%）猜得出来，另外 998 个**退化成纯文本输入框**——用户得手打一个
            # 行 id。猜不出的都是名字对不上的正常命名：`assigned_team` 指向
            # `oncall_teams`、`route_group_id` 指向 `on_call_group`，或者
            # `alert_ref` 而实体里同时有 `alert_event` 和 `alert_route_rule`
            # （两个都以 alert_ 开头 → 歧义不猜）。
            #
            # 这也是 Directus（`related_collection`）/ Strapi（`target`）/
            # nocobase（关联字段的 `target`）的一致做法：**关系字段自带目标**，
            # 没有哪个成熟方案靠名字反推。
            #
            # 口径与本段其余条目一致：**出现即校验、缺省不罚**（老模型零破坏，
            # 运行时那条猜测保留当兜底）。
            if "refEntity" in fd:
                target = str(fd.get("refEntity") or "").strip()
                if ftype != "ref":
                    findings.append(_finding(
                        DANGLING, f"{fpath}.refEntity",
                        f"refEntity declared on non-ref field (type '{ftype}')",
                        ref=ftype, skill="datamodel",
                    ))
                elif not target:
                    findings.append(_finding(
                        EMPTY_SECTION, f"{fpath}.refEntity",
                        "refEntity declared but empty", skill="datamodel",
                    ))
                elif target not in entity_ids:
                    findings.append(_finding(
                        DANGLING, f"{fpath}.refEntity",
                        f"refEntity '{target}' is not an entity in this datamodel",
                        ref=target, skill="datamodel",
                    ))
            if "options" in fd:
                if ftype != "enum":
                    findings.append(_finding(
                        DANGLING, f"{fpath}.options",
                        f"options declared on non-enum field (type '{ftype}')",
                        ref=ftype, skill="datamodel",
                    ))
                opts = [_as_dict(o) for o in _as_list(fd.get("options"))]
                if not opts:
                    findings.append(_finding(
                        EMPTY_SECTION, f"{fpath}.options",
                        "enum options declared but empty", skill="datamodel",
                    ))
                seen_option_ids: set = set()
                for od in opts:
                    oid = str(od.get("id") or "").strip()
                    if not oid:
                        findings.append(_finding(
                            EMPTY_SECTION, f"{fpath}.options",
                            "enum option has no id", skill="datamodel",
                        ))
                        continue
                    if oid in seen_option_ids:
                        findings.append(_finding(
                            DANGLING, f"{fpath}.options",
                            f"duplicate enum option id '{oid}'",
                            ref=oid, skill="datamodel",
                        ))
                    seen_option_ids.add(oid)
                    tone = str(od.get("tone") or "").strip()
                    if tone and tone not in FIELD_TONES:
                        findings.append(_finding(
                            DANGLING, f"{fpath}.options[{oid}].tone",
                            f"option tone '{tone}' is not one of {'/'.join(FIELD_TONES)}",
                            ref=tone, skill="datamodel",
                        ))
            fmt = str(fd.get("format") or "").strip()
            if fmt:
                allowed = (
                    NUMBER_FORMATS if ftype == "number"
                    else STRING_FORMATS if ftype in ("string", "text")
                    else ()
                )
                if fmt not in allowed:
                    findings.append(_finding(
                        DANGLING, f"{fpath}.format",
                        f"field format '{fmt}' is not valid for type '{ftype}'",
                        ref=fmt, skill="datamodel",
                    ))

    # 2. workflow node assigneeRole ∈ rbac.roles — 主链路与附加链路（chains）同一标准
    for chain_path, chain in _iter_workflow_chains(workflow):
        for node in _as_list(chain.get("nodes")):
            nd = _as_dict(node)
            role = str(nd.get("assigneeRole") or "").strip()
            if role and role not in role_ids:
                findings.append(_finding(
                    DANGLING, f"{chain_path}.nodes[{nd.get('id') or nd.get('name')}].assigneeRole",
                    f"workflow node assignee role '{role}' not found in rbac.roles",
                    ref=role, skill="workflow",
                ))

    # 3. page fieldBindings ∈ datamodel fields; actionPermissions ∈ rbac.permissions
    field_types = _collect_field_types(datamodel)
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = pd.get("id") or pd.get("name")
        # 页面范式（加厚 schema 二期，可选字段）：出现即校验、缺省不罚。
        # kind 合法域；kanban 必须带 enum 的 statusField、calendar 必须带
        # date 的 dateField（colorBy 可选但出现必须是 enum 字段）。
        kind = str(pd.get("kind") or "").strip()
        if kind and kind not in PAGE_KINDS:
            findings.append(_finding(
                DANGLING, f"page.pages[{pid}].kind",
                f"page kind '{kind}' is not one of {'/'.join(PAGE_KINDS)}",
                ref=kind, skill="page",
            ))

        presentation = str(pd.get("presentation") or "").strip()
        if presentation and presentation not in PAGE_PRESENTATIONS:
            findings.append(_finding(
                PUBLISH_ENUM_VIOLATION, f"page.pages[{pid}].presentation",
                f"page presentation '{presentation}' is not one of {'/'.join(PAGE_PRESENTATIONS)}",
                ref=presentation, skill="page",
            ))
        elif presentation == "marketing-landing":
            forbidden = [
                key for key in ("stats", "charts", "rankings", "feeds")
                if bool(pd.get(key))
            ]
            if forbidden:
                findings.append(_finding(
                    PUBLISH_ENUM_VIOLATION, f"page.pages[{pid}].presentation",
                    "marketing-landing must not declare operations dashboard content: "
                    + ", ".join(forbidden),
                    ref=presentation, skill="page",
                ))

        surface_raw = pd.get("surface")
        if surface_raw is not None:
            surface = _as_dict(surface_raw)
            surface_type = str(surface.get("type") or "").strip()
            density = str(surface.get("density") or "").strip()
            if surface_type not in PAGE_SURFACE_TYPES:
                findings.append(_finding(
                    PUBLISH_ENUM_VIOLATION, f"page.pages[{pid}].surface.type",
                    f"page surface type '{surface_type}' is not one of {'/'.join(PAGE_SURFACE_TYPES)}",
                    ref=surface_type, skill="page",
                ))
            if density and density not in PAGE_SURFACE_DENSITIES:
                findings.append(_finding(
                    PUBLISH_ENUM_VIOLATION, f"page.pages[{pid}].surface.density",
                    f"page surface density '{density}' is not one of {'/'.join(PAGE_SURFACE_DENSITIES)}",
                    ref=density, skill="page",
                ))

        def _check_view_binding(key: str, required_type: str, required: bool) -> None:
            ref = str(pd.get(key) or "").strip()
            if not ref:
                if required:
                    findings.append(_finding(
                        EMPTY_SECTION, f"page.pages[{pid}].{key}",
                        f"page kind '{kind}' requires '{key}' (a {required_type} field of this page's entity)",
                        skill="page",
                    ))
                return
            if ref not in field_types:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].{key}",
                    f"page {key} '{ref}' not found in datamodel fields",
                    ref=ref, skill="page",
                ))
            elif field_types[ref] != required_type:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].{key}",
                    f"page {key} '{ref}' must be a {required_type} field (got '{field_types[ref]}')",
                    ref=ref, skill="page",
                ))

        # ⚑ 2026-08-14：`required` 这一支是**老渲染器契约**，按链路开关。
        #
        # kanban 要 statusField、calendar 要 dateField，这两条存在的理由是
        # AppRuntimeScreen 渲染看板/日历时得知道按哪个字段分列、按哪个字段排期。
        # 换句话说它们是**区块渲染器的输入需求**，不是模型自身的完整性。
        #
        # 新链路的交付物是第 3 步那份 HTML，页面长什么样由 HTML 决定：
        # 全仓 `dateField` 没有一个新链路消费者（前端精确匹配只命中类型声明、
        # 老渲染器用例与 demo 模板），而 html-binding-runtime / derive-binding-source
        # 压根不读 page.pages[].kind。拿一个没人会用的字段去拦整条链路，
        # 拦下来的代价是回落老路——2026-08-14 口腔连锁那轮就是这么挂的
        # （calendar 页缺 dateField，重问 2 次未补，整条回落）。
        #
        # ⚠ **只松「必须存在」，不松「存在就得对」**：下面 _check_view_binding 里
        #   的解析与类型校验对两条链路一视同仁。新链路真给了 dateField，它照样
        #   必须指到本页实体的 date 字段——放行悬空引用是另一个病，不在这次范围。
        _kind_contract = require_page_kind_contract
        _check_view_binding("statusField", "enum", required=_kind_contract and kind == "kanban")
        _check_view_binding("dateField", "date", required=_kind_contract and kind == "calendar")
        _check_view_binding("colorBy", "enum", required=False)
        for fb in _as_list(pd.get("fieldBindings")):
            ref = str(fb).strip()
            if ref and ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].fieldBindings",
                    f"page field binding '{ref}' not found in datamodel fields",
                    ref=ref, skill="page",
                ))
        for ap in _as_list(pd.get("actionPermissions")):
            ref = str(ap).strip()
            if ref and perm_ids and ref not in perm_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].actionPermissions",
                    f"page action permission '{ref}' not found in rbac.permissions",
                    ref=ref, skill="page",
                ))
        # actions 实例校验（Step 5）
        ALLOWED_ACTION_TYPES = {"navigate", "openDetail", "createRecord", "updateRecord", "changeFilter", "drillDown"}
        for ai, action in enumerate(_as_list(pd.get("actions"))):
            action_dict = _as_dict(action)
            action_path = f"page.pages[{pid}].actions[{ai}]"
            action_type = action_dict.get("type")
            if action_type and action_type not in ALLOWED_ACTION_TYPES:
                findings.append(_finding(
                    "PUBLISH_ENUM_VIOLATION", f"{action_path}.type",
                    f"action type '{action_type}' not in allowed set",
                    ref=action_type, skill="page",
                ))
            # permissionRef 若非空，检查它存在于 page.actionPermissions
            perm_ref = action_dict.get("permissionRef")
            if perm_ref:
                action_perms = set(str(x).strip() for x in _as_list(pd.get("actionPermissions")))
                if perm_ref not in action_perms:
                    findings.append(_finding(
                        "PUBLISH_DANGLING_CROSSREF", f"{action_path}.permissionRef",
                        f"permissionRef '{perm_ref}' not found in page.actionPermissions",
                        ref=perm_ref, skill="page",
                    ))
            # navigate 的 targetPageRef 若非空，检查存在于 page.pages
            if action_type == "navigate":
                target = action_dict.get("targetPageRef")
                if target:
                    page_ids = {p.get("id") for p in _as_list(model.get("page", {}).get("pages")) if p.get("id")}
                    if target not in page_ids:
                        findings.append(_finding(
                            "PUBLISH_DANGLING_CROSSREF", f"{action_path}.targetPageRef",
                            f"targetPageRef '{target}' not found in page.pages",
                            ref=target, skill="page",
                        ))
        # 体验区块目录（二阶段骨架）：blocks 尚未进入生成契约，但若精修或
        # 外部模型提前带入，只允许目录内 type；id 必须存在且页内唯一。
        # 绑定/布局/动作的深校验分别在后续步骤增加，本步不偷跑。
        seen_block_ids: set = set()
        if "blocks" in pd and not isinstance(pd.get("blocks"), list):
            findings.append(_finding(
                EMPTY_SECTION, f"page.pages[{pid}].blocks",
                "experience blocks must be an array",
                skill="page",
            ))
        for block in _as_list(pd.get("blocks")):
            bd = _as_dict(block)
            bid = str(bd.get("id") or "").strip()
            btype = str(bd.get("type") or "").strip()
            block_path = f"page.pages[{pid}].blocks[{bid or '<unnamed>'}]"
            if not bid:
                findings.append(_finding(
                    EMPTY_SECTION, f"{block_path}.id",
                    "experience block requires a non-empty id",
                    skill="page",
                ))
            elif bid in seen_block_ids:
                findings.append(_finding(
                    DANGLING, f"{block_path}.id",
                    f"duplicate experience block id '{bid}' in page '{pid}'",
                    ref=bid, skill="page",
                ))
            else:
                seen_block_ids.add(bid)
            if not btype:
                findings.append(_finding(
                    EMPTY_SECTION, f"{block_path}.type",
                    "experience block requires a type from the catalog",
                    skill="page",
                ))
            elif btype not in EXPERIENCE_BLOCK_TYPES:
                findings.append(_finding(
                    DANGLING, f"{block_path}.type",
                    f"experience block type '{btype}' is not in the closed catalog",
                    ref=btype, skill="page",
                ))
            # binding 深校验（按 bindingSchema 逐类型查表，见 _validate_block_binding）
            binding = bd.get("binding")
            if binding is not None:
                if not isinstance(binding, dict):
                    findings.append(_finding(
                        PUBLISH_INVALID_FIELD, f"{block_path}.binding",
                        "binding must be an object",
                        skill="page",
                    ))
                elif btype:
                    _validate_block_binding(block_path, btype, binding, entity_ids, field_types, findings)
            # WorkflowTimeline 深校验：props.chainRef 留空=主链路（永远合法），
            # 填值必须是 workflow.chains[] 里真实存在的链路 id，不能瞎编。
            if btype == "WorkflowTimeline":
                chain_ref = str(_as_dict(bd.get("props")).get("chainRef") or "").strip()
                if chain_ref and chain_ref not in _collect_workflow_chain_ids(workflow):
                    findings.append(_finding(
                        DANGLING, f"{block_path}.props.chainRef",
                        f"chainRef '{chain_ref}' not found in workflow.chains",
                        ref=chain_ref, skill="page",
                    ))
            # FreeformInsight（2026-07-23）：这一轮主模型只需要交出
            # designBrief——真正的结构/样式/dataRef 由二段生成产出，那层深
            # 校验在 freeform_block.generate_freeform_block 里，这里只管
            # "主模型有没有老实交出一句非空简介"，没交出的直接打回重生成，
            # 不能让二段生成拿着空简介现场编。
            if btype == "FreeformInsight":
                design_brief = str(_as_dict(bd.get("props")).get("designBrief") or "").strip()
                if not design_brief:
                    findings.append(_finding(
                        MISSING_REQUIRED, f"{block_path}.props.designBrief",
                        "FreeformInsight block requires a non-empty props.designBrief",
                        skill="page",
                    ))
        # 库无关图表声明（schema 丰富一期，可选字段）：dimension / sum 指标
        # 必须解析到 datamodel 字段；type 限定在渲染层支持的形态集合。
        for chart in _as_list(pd.get("charts")):
            cd = _as_dict(chart)
            cid = cd.get("id") or cd.get("name") or "<unnamed>"
            ctype = str(cd.get("type") or "").strip()
            if ctype and ctype not in CHART_TYPES:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].type",
                    f"chart type '{ctype}' is not one of {'/'.join(CHART_TYPES)}",
                    ref=ctype, skill="page",
                ))
            dim = str(cd.get("dimension") or "").strip()
            if not dim or dim not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].dimension",
                    f"chart dimension '{dim or '<missing>'}' not found in datamodel fields",
                    ref=dim, skill="page",
                ))
            metric = str(cd.get("metric") or "").strip()
            if metric.startswith("sum:"):
                mref = metric[4:].strip()
                if mref not in field_refs:
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].charts[{cid}].metric",
                        f"chart sum metric '{mref}' not found in datamodel fields",
                        ref=mref, skill="page",
                    ))
            elif metric and metric != "count":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].metric",
                    f"chart metric '{metric}' must be 'count' or 'sum:<entity.field>'",
                    ref=metric, skill="page",
                ))
        # KPI 统计卡声明（加厚 schema 一期，可选字段）：entity 必须是真实实体；
        # sum/avg 指标必须解析到 datamodel 字段；format 限定渲染层支持的集合。
        for stat in _as_list(pd.get("stats")):
            sd = _as_dict(stat)
            sid = sd.get("id") or sd.get("name") or "<unnamed>"
            entity_ref = str(sd.get("entity") or "").strip()
            if not entity_ref or entity_ref not in entity_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].entity",
                    f"stat entity '{entity_ref or '<missing>'}' not found in datamodel entities",
                    ref=entity_ref, skill="page",
                ))
            metric = str(sd.get("metric") or "").strip()
            if metric.startswith("sum:") or metric.startswith("avg:"):
                mref = metric[4:].strip()
                if mref not in field_refs:
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].stats[{sid}].metric",
                        f"stat {metric[:3]} metric '{mref}' not found in datamodel fields",
                        ref=mref, skill="page",
                    ))
            elif metric != "count":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].metric",
                    f"stat metric '{metric or '<missing>'}' must be 'count', 'sum:<entity.field>' or 'avg:<entity.field>'",
                    ref=metric, skill="page",
                ))
            sfmt = str(sd.get("format") or "").strip()
            if sfmt and sfmt not in STAT_FORMATS:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].format",
                    f"stat format '{sfmt}' is not one of {'/'.join(STAT_FORMATS)}",
                    ref=sfmt, skill="page",
                ))
        # 排行榜声明（E40.4，可选）：entity 真实存在；sortBy 必须解析到 number
        # 字段（榜单按数值排序——date/enum 排不出"第一名"的语义）。
        for rank in _as_list(pd.get("rankings")):
            rd = _as_dict(rank)
            rid = rd.get("id") or rd.get("name") or "<unnamed>"
            entity_ref = str(rd.get("entity") or "").strip()
            if not entity_ref or entity_ref not in entity_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].rankings[{rid}].entity",
                    f"ranking entity '{entity_ref or '<missing>'}' not found in datamodel entities",
                    ref=entity_ref, skill="page",
                ))
            sort_ref = str(rd.get("sortBy") or "").strip()
            if not sort_ref or sort_ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].rankings[{rid}].sortBy",
                    f"ranking sortBy '{sort_ref or '<missing>'}' not found in datamodel fields",
                    ref=sort_ref, skill="page",
                ))
            elif field_types.get(sort_ref) != "number":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].rankings[{rid}].sortBy",
                    f"ranking sortBy '{sort_ref}' must be a number field (got '{field_types.get(sort_ref)}')",
                    ref=sort_ref, skill="page",
                ))
        # 动态流声明（E40.4，可选）：entity 真实存在；timeField 必须是 date
        # 字段（按时间倒序的流）；levelField 出现时必须是 enum 字段（级别
        # 标签的颜色语义来自其 options.tone）。
        for feed in _as_list(pd.get("feeds")):
            fd2 = _as_dict(feed)
            fid = fd2.get("id") or fd2.get("name") or "<unnamed>"
            entity_ref = str(fd2.get("entity") or "").strip()
            if not entity_ref or entity_ref not in entity_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].feeds[{fid}].entity",
                    f"feed entity '{entity_ref or '<missing>'}' not found in datamodel entities",
                    ref=entity_ref, skill="page",
                ))
            time_ref = str(fd2.get("timeField") or "").strip()
            if not time_ref or time_ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].feeds[{fid}].timeField",
                    f"feed timeField '{time_ref or '<missing>'}' not found in datamodel fields",
                    ref=time_ref, skill="page",
                ))
            elif field_types.get(time_ref) != "date":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].feeds[{fid}].timeField",
                    f"feed timeField '{time_ref}' must be a date field (got '{field_types.get(time_ref)}')",
                    ref=time_ref, skill="page",
                ))
            level_ref = str(fd2.get("levelField") or "").strip()
            if level_ref:
                if level_ref not in field_refs:
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].feeds[{fid}].levelField",
                        f"feed levelField '{level_ref}' not found in datamodel fields",
                        ref=level_ref, skill="page",
                    ))
                elif field_types.get(level_ref) != "enum":
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].feeds[{fid}].levelField",
                        f"feed levelField '{level_ref}' must be an enum field (got '{field_types.get(level_ref)}')",
                        ref=level_ref, skill="page",
                    ))

    # 4. aigc inputFields/outputField ∈ datamodel fields; roleRefs ∈ rbac.roles
    for cap in _as_list(aigc.get("capabilities")):
        cd = _as_dict(cap)
        cid = cd.get("id") or cd.get("name")
        for fld in _as_list(cd.get("inputFields")) + ([cd.get("outputField")] if cd.get("outputField") else []):
            ref = str(fld).strip()
            if ref and ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"aigc.capabilities[{cid}].fields",
                    f"aigc field '{ref}' not found in datamodel fields",
                    ref=ref, skill="aigc",
                ))
        for rr in _as_list(cd.get("roleRefs")):
            ref = str(rr).strip()
            if ref and ref not in role_ids:
                findings.append(_finding(
                    DANGLING, f"aigc.capabilities[{cid}].roleRefs",
                    f"aigc role ref '{ref}' not found in rbac.roles",
                    ref=ref, skill="aigc",
                ))

    # 4.5 aigc.pipelines（编排一期，可选段）：步骤必须解析到能力 id；
    #     相邻步字段级衔接——上一步 outputField 必须出现在下一步 inputFields
    #     （编排经数据模型字段接线，这是可校验的硬语义，不是松散文案）。
    cap_by_id: Dict[str, Dict[str, Any]] = {}
    for cap in _as_list(aigc.get("capabilities")):
        cd = _as_dict(cap)
        cid = str(cd.get("id") or "").strip()
        if cid:
            cap_by_id[cid] = cd
    for pipe in _as_list(aigc.get("pipelines")):
        pd = _as_dict(pipe)
        pid = pd.get("id") or pd.get("name") or "<unnamed>"
        steps = [str(s).strip() for s in _as_list(pd.get("steps")) if str(s).strip()]
        if len(steps) < 2:
            findings.append(_finding(
                EMPTY_SECTION, f"aigc.pipelines[{pid}].steps",
                "pipeline needs at least 2 steps (a single capability is not an orchestration)",
                skill="aigc",
            ))
            continue
        resolved = True
        for step in steps:
            if step not in cap_by_id:
                findings.append(_finding(
                    DANGLING, f"aigc.pipelines[{pid}].steps",
                    f"pipeline step '{step}' not found in aigc.capabilities",
                    ref=step, skill="aigc",
                ))
                resolved = False
        if not resolved:
            continue
        for prev_id, next_id in zip(steps, steps[1:]):
            prev_out = str(cap_by_id[prev_id].get("outputField") or "").strip()
            next_inputs = {str(f).strip() for f in _as_list(cap_by_id[next_id].get("inputFields"))}
            if prev_out and prev_out not in next_inputs:
                findings.append(_finding(
                    DANGLING, f"aigc.pipelines[{pid}].steps[{prev_id}→{next_id}]",
                    f"pipeline handoff broken: '{prev_id}' outputField '{prev_out}' "
                    f"is not an inputField of '{next_id}'",
                    ref=prev_out, skill="aigc",
                ))

    # 5. rbac.menus.roleRefs ∈ roles; permissionRefs ∈ permissions
    for menu in _as_list(rbac.get("menus")):
        md = _as_dict(menu)
        mid = md.get("id") or md.get("label")
        for rr in _as_list(md.get("roleRefs")):
            ref = str(rr).strip()
            if ref and ref not in role_ids:
                findings.append(_finding(
                    DANGLING, f"rbac.menus[{mid}].roleRefs",
                    f"menu role ref '{ref}' not found in rbac.roles",
                    ref=ref, skill="rbac",
                ))
        for pr in _as_list(md.get("permissionRefs")):
            ref = str(pr).strip()
            if ref and perm_ids and ref not in perm_ids:
                findings.append(_finding(
                    DANGLING, f"rbac.menus[{mid}].permissionRefs",
                    f"menu permission ref '{ref}' not found in rbac.permissions",
                    ref=ref, skill="rbac",
                ))

    # 6. appbundle: pageRef ∈ pages, workflowRef ∈ workflow, roleRefs ∈ roles, dataModelRefs ∈ entities
    for pb in _as_list(appbundle.get("pageBindings")):
        bd = _as_dict(pb)
        pref = str(bd.get("pageRef") or "").strip()
        if pref and pref not in page_ids:
            findings.append(_finding(
                DANGLING, "appbundle.pageBindings.pageRef",
                f"appbundle pageRef '{pref}' not found in page.pages", ref=pref, skill="appbundle",
            ))
        wref = str(bd.get("workflowRef") or "").strip()
        if wref and wref not in workflow_ids:
            findings.append(_finding(
                DANGLING, "appbundle.pageBindings.workflowRef",
                f"appbundle workflowRef '{wref}' not found in workflow", ref=wref, skill="appbundle",
            ))
    landing_ref = str(appbundle.get("landingPageRef") or "").strip()
    landing_page_ids = {
        str(_as_dict(pd).get("id") or "").strip()
        for pd in _as_list(page.get("pages"))
        if str(_as_dict(pd).get("id") or "").strip()
    }
    if landing_ref and landing_ref not in landing_page_ids:
        findings.append(_finding(
            DANGLING, "appbundle.landingPageRef",
            f"appbundle landingPageRef '{landing_ref}' not found in page.pages",
            ref=landing_ref, skill="appbundle",
        ))
    for rr in _as_list(appbundle.get("roleRefs")):
        ref = str(rr).strip()
        if ref and ref not in role_ids:
            findings.append(_finding(
                DANGLING, "appbundle.roleRefs",
                f"appbundle roleRef '{ref}' not found in rbac.roles", ref=ref, skill="appbundle",
            ))
    for dr in _as_list(appbundle.get("dataModelRefs")):
        ref = str(dr).strip()
        if ref and ref not in entity_ids:
            findings.append(_finding(
                DANGLING, "appbundle.dataModelRefs",
                f"appbundle dataModelRef '{ref}' not found in datamodel entities", ref=ref, skill="appbundle",
            ))

    # 6.4 wizard 范式（E40.5）：向导页的步骤骨架来自其绑定的 workflow——
    #    kind=wizard 的页必须出现在 appbundle.pageBindings 且带 workflowRef，
    #    否则渲染器没有步骤可画（诚实拦截，不给假向导）。
    flow_bound_pages = {
        str(_as_dict(pb).get("pageRef") or "").strip()
        for pb in _as_list(appbundle.get("pageBindings"))
        if str(_as_dict(pb).get("workflowRef") or "").strip()
    }
    for pd_raw in _as_list(page.get("pages")):
        pd2 = _as_dict(pd_raw)
        if str(pd2.get("kind") or "").strip() == "wizard":
            pid2 = str(pd2.get("id") or pd2.get("name") or "<unnamed>")
            if pid2 not in flow_bound_pages:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid2}].kind",
                    "wizard page must be bound to a workflow via appbundle.pageBindings (workflowRef)",
                    ref=pid2, skill="page",
                ))

    # 6.5 appbundle.appIdentity（E40.2，可选）：应用身份段——产品名 + 主题 +
    #    图标 + 导航形态。老模型没有该字段 → 不罚；出现即校验：三个枚举必须
    #    在真相源账本内（渲染层只认账本值，非法值 = 渲染不出来的假承诺）。
    from .schema_legal import IDENTITY_ICONS, IDENTITY_NAVS, IDENTITY_THEMES, DESIGN_RECIPES

    identity = _as_dict(appbundle.get("appIdentity"))
    if identity:
        for key, legal, label in (
            ("theme", IDENTITY_THEMES, "identity theme"),
            ("icon", IDENTITY_ICONS, "identity icon"),
            ("nav", IDENTITY_NAVS, "identity nav"),
        ):
            value = str(identity.get(key) or "").strip()
            if value and value not in legal:
                findings.append(_finding(
                    DANGLING, f"appbundle.appIdentity.{key}",
                    f"{label} '{value}' is not one of {'/'.join(legal)}",
                    ref=value, skill="appbundle",
                ))
        name = identity.get("productName")
        if name is not None and not str(name).strip():
            findings.append(_finding(
                DANGLING, "appbundle.appIdentity.productName",
                "identity productName must be a non-empty string when declared",
                ref="", skill="appbundle",
            ))
        # 2026-08-04：chartColors（参照图取色的产物，可选）。出现即校验——
        # 这一段会被前端直接当成图表的分类色画出来，非法值 = 画不出来的假承诺，
        # 跟上面三个枚举同一条纪律。只查客观可查的（是不是 6 位 hex、够不够几个），
        # 好不好看/区分度那条在写入侧（sheet_palette）已经把过关，这里不重复。
        chart_colors = identity.get("chartColors")
        if chart_colors is not None:
            import re

            from .sheet_palette import MIN_USABLE_COLORS

            bad = (
                not isinstance(chart_colors, list)
                or len(chart_colors) < MIN_USABLE_COLORS
                or any(
                    not isinstance(c, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", c)
                    for c in chart_colors
                )
            )
            if bad:
                findings.append(_finding(
                    DANGLING, "appbundle.appIdentity.chartColors",
                    f"chartColors must be a list of at least {MIN_USABLE_COLORS} 6-digit hex colors",
                    ref=str(chart_colors)[:80], skill="appbundle",
                ))

        # Step 9: designRecipeRef 合法域
        design_recipe = str(identity.get("designRecipeRef") or "").strip()
        if design_recipe and design_recipe not in DESIGN_RECIPES:
            findings.append(_finding(
                DANGLING, "appbundle.appIdentity.designRecipeRef",
                f"designRecipeRef '{design_recipe}' is not in allowed recipes: {'/'.join(DESIGN_RECIPES)}",
                ref=design_recipe, skill="appbundle",
            ))

    # Step 8: experienceShell 校验（可选，出现即校验 mode 和 navigation 枚举）
    exp_shell = _as_dict(appbundle.get("experienceShell"))
    if exp_shell:
        shell_mode = str(exp_shell.get("mode") or "").strip()
        if shell_mode and shell_mode not in ("navigation", "focus"):
            findings.append(_finding(
                DANGLING, "appbundle.experienceShell.mode",
                f"experienceShell.mode '{shell_mode}' must be navigation or focus",
                ref=shell_mode, skill="appbundle",
            ))
        shell_nav = str(exp_shell.get("navigation") or "").strip()
        if shell_nav and shell_nav not in ("side", "top"):
            findings.append(_finding(
                DANGLING, "appbundle.experienceShell.navigation",
                f"experienceShell.navigation '{shell_nav}' must be side or top",
                ref=shell_nav, skill="appbundle",
            ))

    # Step 8: preferredDevice 合法域
    pref_device = str(appbundle.get("preferredDevice") or "").strip()
    # ⚠ 2026-08-30：曾是写死的元组。加 watch/tablet 要同时改 intake_judge 的
    #   两处，漏一处 = 生成出来了但闸不认（第四条）。现在同源于账本。
    supported_devices = _supported_devices()
    if require_preferred_device and pref_device not in supported_devices:
        findings.append(_finding(
            DANGLING, "appbundle.preferredDevice",
            f"preferredDevice '{pref_device}' must be exactly {_device_domain_or()}",
            ref=pref_device, skill="appbundle",
        ))
    elif pref_device and pref_device not in set(_historic_preferred_devices()):
        findings.append(_finding(
            DANGLING, "appbundle.preferredDevice",
            f"preferredDevice '{pref_device}' must be {'/'.join(_historic_preferred_devices())}",
            ref=pref_device, skill="appbundle",
        ))

    # Step 7: page layout 校验（可选，出现即校验 slot 合法性 + block 引用）。
    # 槽位合法域从目录账本派生（此前这里手抄一份，往目录加槽位时 per-type
    # 校验放行、这里却拒绝，会产出自相矛盾的 finding）。
    LAYOUT_SLOTS = set(EXPERIENCE_BLOCK_ALLOWED_REGIONS)
    for pi, pg in enumerate(_as_list(m.get("page", {}).get("pages"))):
        pd = _as_dict(pg)
        layout = _as_dict(pd.get("layout"))
        if not layout:
            continue
        page_block_types = {
            str(b.get("id") or "").strip(): str(b.get("type") or "").strip()
            for b in _as_list(pd.get("blocks")) if b.get("id")
        }
        layout_page = f"page.pages[{pd.get('id') or pi}].layout"
        for slot_key, block_refs in layout.items():
            if slot_key == "mobile":
                continue
            if slot_key == "grid":
                grid = _as_dict(block_refs)
                if not grid and block_refs:
                    findings.append(_finding(
                        DANGLING, f"{layout_page}.grid",
                        "layout grid must be an object keyed by desktop/tablet/phone",
                        ref="grid", skill="page",
                    ))
                    continue
                grid_columns = {"desktop": 12, "tablet": 8, "phone": 4}
                for breakpoint, raw_items in grid.items():
                    grid_path = f"{layout_page}.grid.{breakpoint}"
                    if breakpoint not in grid_columns:
                        findings.append(_finding(
                            DANGLING, grid_path,
                            f"layout grid breakpoint '{breakpoint}' must be desktop/tablet/phone",
                            ref=str(breakpoint), skill="page",
                        ))
                        continue
                    seen_grid_refs = set()
                    columns = grid_columns[breakpoint]
                    for item_index, raw_item in enumerate(_as_list(raw_items)):
                        item = _as_dict(raw_item)
                        item_path = f"{grid_path}[{item_index}]"
                        ref_str = str(item.get("blockRef") or "").strip()
                        if ref_str in seen_grid_refs:
                            findings.append(_finding(
                                DANGLING, f"{item_path}.blockRef",
                                f"duplicate layout grid blockRef '{ref_str}' in breakpoint '{breakpoint}'",
                                ref=ref_str, skill="page",
                            ))
                        elif ref_str:
                            seen_grid_refs.add(ref_str)
                        if ref_str != "page-content" and ref_str not in page_block_types:
                            findings.append(_finding(
                                DANGLING, f"{item_path}.blockRef",
                                f"layout grid block ref '{ref_str}' not found in page.blocks",
                                ref=ref_str, skill="page",
                            ))
                        coords = [item.get(key) for key in ("x", "y", "w", "h")]
                        if any(isinstance(value, bool) or not isinstance(value, int) for value in coords):
                            findings.append(_finding(
                                DANGLING, item_path,
                                "layout grid x/y/w/h must be integers",
                                ref=ref_str, skill="page",
                            ))
                            continue
                        x, y, width, height = coords
                        if (
                            x < 0 or y < 0 or width <= 0 or height <= 0
                            or x + width > columns
                        ):
                            findings.append(_finding(
                                DANGLING, item_path,
                                f"layout grid item must fit within {columns} columns with non-negative x/y and positive w/h",
                                ref=ref_str, skill="page",
                            ))
                continue
            # 槽位表被多包了一层 `slots`。真跑撞过一次 6/6 页全中：prompt 里
            # 那句 "a layout object with slots summary/primary/..." 会被读成
            # "有个叫 slots 的键"（跟 binding=none 是同一类哨兵词事故）。
            # 泛化的 "slot 'slots' 不合法" 那条不足以让 reask 知道要怎么改，
            # 这里直接说"把它摊平"。识别是确定的：slots 不是合法槽位名，且
            # 合法槽位的值是数组、这里是对象。
            if slot_key == "slots" and isinstance(block_refs, dict):
                findings.append(_finding(
                    DANGLING, f"{layout_page}.slots",
                    "layout slot map must not be nested under a 'slots' key; hoist its "
                    'entries onto layout itself (layout: {"summary": [...], "content": [...]})',
                    ref=slot_key, skill="page",
                ))
                continue
            if slot_key not in LAYOUT_SLOTS:
                findings.append(_finding(
                    DANGLING, f"{layout_page}.{slot_key}",
                    f"layout slot '{slot_key}' is not in allowed slots: {'/'.join(sorted(LAYOUT_SLOTS))}",
                    ref=slot_key, skill="page",
                ))
            for ref in _as_list(block_refs):
                ref_str = str(ref or "").strip()
                if not ref_str:
                    continue
                if ref_str not in page_block_types:
                    findings.append(_finding(
                        DANGLING, f"{layout_page}.{slot_key}",
                        f"layout block ref '{ref_str}' not found in page.blocks",
                        ref=ref_str, skill="page",
                    ))
                    continue
                # 槽位 x 区块类型搭配校验（Puck DropZone allow 思路）：目录里
                # 每个区块类型早就声明了自己能放哪些槽位（allowedSlots），此前
                # 这里只查"槽位名合法 + 区块 id 存在"，从没拿这份数据交叉核对
                # 过——一个 RankedList 塞进 activity 槽也不会被拦。
                btype = page_block_types[ref_str]
                allowed_slots_for_type = EXPERIENCE_BLOCK_ALLOWED_REGIONS_BY_TYPE.get(btype)
                if allowed_slots_for_type and slot_key not in allowed_slots_for_type:
                    findings.append(_finding(
                        PUBLISH_ENUM_VIOLATION, f"{layout_page}.{slot_key}",
                        f"block '{ref_str}' (type {btype}) is not allowed in slot '{slot_key}'; "
                        f"catalog allows: {'/'.join(allowed_slots_for_type)}",
                        ref=ref_str, skill="page",
                    ))

    # 7. appbundle.invariants（改进②，可选）：老模型没有该字段 → 不罚；出现即校验——
    #    refs 必须解析到本模型内的实体/字段/角色/权限/流程节点，systems 必须是已知系统名。
    #    宽泛口号（无 refs）也算失败：不变式的价值就在于可对照模型检查。
    #    落在 appbundle（总装段）而非顶层：随 per-skill 证据通道原样到达客户端。
    known_ref_ids = collect_invariant_ref_ids(m)
    for inv in _as_list(appbundle.get("invariants")):
        iv = _as_dict(inv)
        iid = str(iv.get("id") or iv.get("statement") or "").strip()[:60] or "<unnamed>"
        refs = [str(r).strip() for r in _as_list(iv.get("refs")) if str(r).strip()]
        if not str(iv.get("statement") or "").strip():
            findings.append(_finding(
                EMPTY_SECTION, f"invariants[{iid}].statement",
                "invariant has no statement", skill="invariants",
            ))
        if not refs:
            findings.append(_finding(
                DANGLING, f"invariants[{iid}].refs",
                "invariant has no refs — ungrounded constraints are not checkable",
                skill="invariants",
            ))
        for ref in refs:
            if ref not in known_ref_ids:
                findings.append(_finding(
                    DANGLING, f"invariants[{iid}].refs",
                    f"invariant ref '{ref}' not found in model (entity/field/role/permission/page/workflow node/aigc capability)",
                    ref=ref, skill="invariants",
                ))
        for system in _as_list(iv.get("systems")):
            sname = str(system).strip()
            if sname and sname not in SKILL_KEYS:
                findings.append(_finding(
                    DANGLING, f"invariants[{iid}].systems",
                    f"invariant system '{sname}' is not one of {SKILL_KEYS}",
                    ref=sname, skill="invariants",
                ))

    # 8. strict Gate：LLM 生成/精修路径要求 landingPageRef 非空存在。
    #    require_landing_page_ref=False（默认）时跳过此检查以保持旧模型兼容。
    if require_landing_page_ref:
        landing = (m.get("appbundle") or {}).get("landingPageRef")
        if not landing or not str(landing).strip():
            findings.append(_finding(
                MISSING_REQUIRED,
                "appbundle.landingPageRef",
                "landingPageRef is required for LLM-generated models but is missing or blank",
            ))

    return {"passed": len(findings) == 0, "findings": findings}
