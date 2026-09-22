"""Bounded DAG generation for the six-section V5 application model.

The orchestration follows the same execution semantics used by mature graph
runtimes such as LangGraph: immutable shared input, bounded fan-out/fan-in,
context propagation per worker, and failure of the whole wave when a required
node fails.  It deliberately stays dependency-free because this repository's
streaming LLM transport is not compatible with the default SDK stack used by
those runtimes.

The LLM never invents cross-system identifiers independently.  A complete
``SystemContract`` owns the architecture and cross-system references first;
section workers elaborate that contract, and appbundle is assembled
deterministically from validated outputs.
"""

from __future__ import annotations
from .archetype_legal import default_device as _default_device
from .archetype_legal import device_domain_or as _device_domain_or
from .archetype_legal import fill_device_placeholders as _fill_device_placeholders
from .archetype_legal import supported_devices as _supported_devices

import copy
import json
import os
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from contextvars import copy_context
from typing import Any, Callable, Dict, Iterable, Optional, Sequence

from .enrich_timing import stage as _enrich_stage


JsonCall = Callable[[list[dict[str, str]], tuple[str, ...], int], Optional[Dict[str, Any]]]

_FIRST_WAVE = ("datamodel", "rbac", "workflow")
_SECOND_WAVE = ("page", "aigc")
_ALL_LLM_SECTIONS = _FIRST_WAVE + _SECOND_WAVE


def parallel_generation_enabled() -> bool:
    """并行生成的开关。**默认关**（2026-08-06 从 on 改过来）。

    ## 为什么关掉

    实测三趟，同一话题、同一模型（gpt-5.6-luna / api.rcouyi.com）：

        并行 第 1 趟   ❌ 生成失败   569.6s
        并行 第 2 趟   ❌ 生成失败   738.0s
        串行           ✅ 成功       236.0s（8 实体 / 5 页 / 5 角色）

    并行不是慢一点，是**跑不出东西**，而且比串行慢 2.4~3.1 倍。两趟失败判词
    一致，可复现：

        contract page club_overview stat has an unknown metric field
        contract page club_overview ranking / feed has an unknown binding
        contract AIGC booking_training_advice has an unknown inputField: student_id
        contract.menus must grant every declared permission

    根因在 `_contract_problems`：它要求 Contract 里 stats / rankings / feeds /
    AIGC 输入输出引用的字段**必须已在 Contract 内声明**（field_refs）。这等于
    逼 Contract 先把实体字段全枚举一遍——Contract 本该是"小型 ID 骨架"，现在
    接近"先生成半套六系统"，于是它既慢又过不了自己的校验。

    ## 为什么失败一次就整趟报废

    v5_llm_generate 里：`attempts = 1 if use_parallel else (2 if ... else 1)`
    ——并行只给一次机会，Contract 挂了直接 return None。串行代码就在旁边却
    走不到。**这是 fail-closed 的最坏形态**：能用的老路径还在，却因为新路径
    的开关默认打开而永远用不上。

    ## 这是止血，不是结论

    并行的方向没问题（Contract 统一 ID 口径，解决并发时各写各的），
    `_run_wave` 的 copy_context 也是对的。要修的是两件事，都跟这个开关无关：

      ① 给并行加串行兜底 —— Contract 失败时回落，而不是整趟报废
      ② Contract 瘦身到真正的 ID 骨架（目标 30~60s）；注意光减提示词不够，
        `_contract_problems` 那套字段级校验必须同步放宽，否则瘦身后的
        Contract 反而更过不了自己的校验

    这两件做完、有实测数据支撑之后，把默认改回 on 即可——
    `SLIDERULE_PARALLEL_MODEL_GENERATION=1` 现在就能单独打开来调试。

    ⚠ 2026-08-29：原来是 `默认 "off"` 配 `not in {"0","false","no","off"}` ——
      **默认关，却拿"关"的词表解析**。拼错一个字母（`onn` / `enable`）就落到
      "不在关词表里"，并行**静静地打开**，而上面整段正说着它为什么必须关着。
    """
    from .env_flags import flag

    return flag("SLIDERULE_PARALLEL_MODEL_GENERATION", default=False)


def _max_workers() -> int:
    raw = str(os.getenv("SLIDERULE_MODEL_GENERATION_CONCURRENCY", "3")).strip()
    try:
        value = int(raw)
    except ValueError:
        value = 3
    return max(1, min(value, 3))


_CONTRACT_INSTRUCTION = """\
You are the planning node for an enterprise application model. Produce ONLY a
JSON object with the top-level key "contract". This is the complete immutable
architecture contract consumed by parallel workers. It must decide every
cross-system relationship before fan-out; IDs must be unique, snake_case ASCII.

Shape:
{
  "contract": {
    "entities": [{"id":"...","name":"...","fields":[
      {"id":"...","name":"...","type":"string|number|date|ref|enum",
        "options":[{"id":"...","label":"...","tone":"<legal tone>"}],
        "format":"<legal format, optional>"}
    ]}],
    "roles": [{"id":"...","name":"..."}],
    "permissions": ["resource:action"],
    "menus": [{"id":"...","label":"...","roleRefs":["<role id>"],
      "permissionRefs":["<resource:action>"]}],
    "workflow": {
      "id":"...","name":"...",
      "nodes":[{"id":"...","name":"...","assigneeRole":"<role id>","phase":"..."}],
      "transitions":[{"from":"<node id>","to":"<node id>","condition":"..."}],
      "chains":[{"id":"...","name":"...","kind":"money|lifecycle|governance|recovery",
        "nodes":[{"id":"...","name":"...","assigneeRole":"<role id>","phase":"..."}],
        "transitions":[{"from":"<node id>","to":"<node id>","condition":"..."}]}]
    },
    "pages": [{"id":"...","name":"...","kind":"workbench|kanban|calendar|dashboard|monitor|wizard",
      "presentation":"marketing-landing|application",
      "surface":{"type":"table|editable-table|split-list|queue","density":"compact|default|comfortable"},
      "statusField":"<entity.field, kanban only>","dateField":"<entity.field, calendar only>",
      "colorBy":"<entity.field, optional>",
      "fieldBindings":["<entity.field>"],"actionPermissions":["<resource:action>"],
      "stats":[{"id":"...","name":"...","entity":"<entity id>","metric":"count|sum:<entity.field>|avg:<entity.field>","format":"<legal format>"}],
      "charts":[{"id":"...","name":"...","type":"bar|line|pie|donut","dimension":"<entity.field>","metric":"count|sum:<entity.field>"}],
      "rankings":[{"id":"...","name":"...","entity":"<entity id>","sortBy":"<entity.number field>","limit":5}],
      "feeds":[{"id":"...","name":"...","entity":"<entity id>","timeField":"<entity.date field>","levelField":"<entity.enum field, optional>"}],
      "blocks":[{"id":"...","type":"<legal experience block type>","props":{"title":"..."},"binding":{"entityRef":"<entity id>"}}]}],
    "pageBindings":[{"pageRef":"<page id>","workflowRef":"<workflow, chain, or node id>"}],
    "aigcIntents": [{"id":"...","name":"...","inputFields":["<entity.field>"],
      "outputField":"<entity.field>","roleRefs":["<role id>"]}],
    "aigcPipelines":[{"id":"...","name":"...","steps":["<aigc intent id>"]}],
    "landingPageRef":"<page id>",
    "preferredDevice":"__PREFERRED_DEVICES__",
    "appIdentity":{"productName":"...","theme":"azure|forest|graphite|tangerine|violet|amber|clay|indigo",
      "icon":"cart|users|shield|chart|calendar|wrench|spark|globe|heart|book|file|boxes",
      "nav":"side|top"},
    "invariants":[{"id":"...","statement":"...",
      "systems":["datamodel|rbac|workflow|page|aigc"],
      "refs":["<declared entity, field, role, permission, workflow/node, page, or capability id>"]}]
  }
}

Rules:
- Model the user's specific business, not a generic admin template.
- Include all entity fields needed by pages, workflows and AIGC. Every field
  reference must exactly match a declared entity.field. Decide enum options and
  canonical display formats here; downstream generation must preserve them.
- Spread permissions across roles by duty through menus. Every permission must
  be granted and every role/menu reference must resolve.
- Fully design the primary workflow and its additional business chains here,
  including nodes, assignee roles, phases, transitions, branches and return paths.
- Pages must cover the requested user-facing landing page and operational jobs.
  Decide their business bindings, operating structure, analytics and business
  blocks here. Bind only pages that actually participate in a workflow; do not
  bind every page by default. A marketing landing page has no admin analytics.
- Declare useful AIGC capabilities with complete field and role bindings. Emit a
  pipeline only when each previous outputField is a later step's literal input.
- Emit 5-8 concrete, checkable invariants grounded in declared references.
- Choose exactly one device. Obey an explicit device in the user request.
- This contract is intentionally complete. Do not shorten it into an inventory
  or defer cross-system decisions to downstream workers.
"""


_SECTION_INSTRUCTIONS: dict[str, str] = {
    "datamodel": """Return ONLY {"datamodel": {...}}. Materialize the immutable
contract entities and fields as the production datamodel. Preserve every ID,
name, type, enum option and format from the contract; do not remove, rename or
add fields. Ref fields must represent real relationships in this business.""",
    "rbac": """Return ONLY {"rbac": {...}} with roles, permissions and menus.
Materialize the contract RBAC exactly. Preserve all role, permission and menu
IDs and every roleRefs/permissionRefs assignment. Roles use objects with id and
human-readable name. Do not redistribute privileges independently.""",
    "workflow": """Return ONLY {"workflow": {...}}. Materialize the complete
contract workflow. Preserve every workflow, chain and node ID, assignee role,
phase and transition; do not redesign the graph independently. You may improve
labels or fill optional transition conditions without changing topology. Keep
nodes ordered, phases consecutive and references resolvable.""",
    "page": """Return ONLY {"page":{"pages":[...]}}. Elaborate every page in
the immutable contract and preserve page IDs, kinds, presentation, surface,
fieldBindings, actionPermissions, stats, charts, rankings, feeds and business
blocks. Use the attached validated datamodel and RBAC sections to add only
renderer-level layout/action detail without changing contract bindings. Copy
references byte-for-byte: field references MUST retain
the ``entity.field`` dot and permissions MUST retain the ``resource:action``
colon; never flatten either separator to an underscore. Give each operational page a job-specific
surface (table, editable-table, split-list or queue), blocks and layout instead
of repeating one dashboard/table template. Marketing landing pages must not
contain admin stats/charts. Kanban needs an enum statusField; calendar needs a
dateField; wizard actions and workflow-related blocks must use real IDs. Actions
may only use navigate, openDetail, createRecord, updateRecord, changeFilter or
drillDown, and every permissionRef/targetPageRef must resolve.""",
    "aigc": """Return ONLY {"aigc":{"capabilities":[...],"pipelines":[...]}}.
Materialize the complete contract aigcIntents and aigcPipelines. Preserve every
capability ID, inputFields, outputField, roleRefs and pipeline step; do not bind
them independently. Copy every ``entity.field`` reference byte-for-byte and
never replace its dot with an underscore. Omit pipelines only when the contract
declares none.""",
}


def _section_instruction(section: str) -> str:
    instruction = _SECTION_INSTRUCTIONS[section]
    if section == "datamodel":
        from .schema_legal import FIELD_TONES, NUMBER_FORMATS, STRING_FORMATS

        instruction += (
            "\n\nClosed legal domains from the runtime schema: enum option tone must be one of "
            f"{', '.join(FIELD_TONES)}. A number field may use format only from "
            f"{', '.join(NUMBER_FORMATS)}. A string/text field may use format only from "
            f"{', '.join(STRING_FORMATS)}. Date/ref/enum fields MUST omit format. "
            "When no listed format applies, omit format instead of inventing one."
        )
    if section == "page":
        # The catalog is the single source of truth shared by prompt, gate and
        # renderer. Import it at call time so catalog revisions need no changes
        # in this orchestrator.
        from .schema_legal import (
            CHART_TYPES,
            PAGE_KINDS,
            PAGE_PRESENTATIONS,
            PAGE_SURFACE_DENSITIES,
            PAGE_SURFACE_TYPES,
            STAT_FORMATS,
            experience_block_prompt_block,
        )

        instruction += (
            "\n\nClosed page domains from the runtime schema: "
            f"kind={','.join(PAGE_KINDS)}; presentation={','.join(PAGE_PRESENTATIONS)}; "
            f"surface.type={','.join(PAGE_SURFACE_TYPES)}; "
            f"surface.density={','.join(PAGE_SURFACE_DENSITIES)}; "
            f"chart.type={','.join(CHART_TYPES)}; stat.format={','.join(STAT_FORMATS)}. "
            "Chart metric is count or sum:<number field>. Stat metric is count, "
            "sum:<number field>, or avg:<number field>. Never invent enum values."
            f"\n\n{_fill_device_placeholders(experience_block_prompt_block())}"
        )
    return instruction


def _contract_instruction() -> str:
    """Render the complete contract against the same closed domains as Gate."""
    from .schema_legal import (
        CHART_TYPES,
        FIELD_TONES,
        NUMBER_FORMATS,
        PAGE_KINDS,
        PAGE_PRESENTATIONS,
        PAGE_SURFACE_DENSITIES,
        PAGE_SURFACE_TYPES,
        STAT_FORMATS,
        STRING_FORMATS,
        experience_block_prompt_block,
    )

    return _fill_device_placeholders(
        _CONTRACT_INSTRUCTION
        + "\nClosed runtime domains (never invent values): "
        + f"field tone={','.join(FIELD_TONES)}; "
        + f"number format={','.join(NUMBER_FORMATS)}; "
        + f"string format={','.join(STRING_FORMATS)}; "
        + f"page kind={','.join(PAGE_KINDS)}; "
        + f"presentation={','.join(PAGE_PRESENTATIONS)}; "
        + f"surface type={','.join(PAGE_SURFACE_TYPES)}; "
        + f"surface density={','.join(PAGE_SURFACE_DENSITIES)}; "
        + f"chart type={','.join(CHART_TYPES)}; "
        + f"stat format={','.join(STAT_FORMATS)}."
        + " Date/ref/enum fields omit format.\n\n"
        + experience_block_prompt_block()
    )


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _contract_problems(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["top-level output must be an object"]
    contract = payload.get("contract")
    if not isinstance(contract, dict):
        return ["contract must be an object"]
    problems = []
    for key in ("entities", "roles", "permissions", "menus", "pages", "aigcIntents"):
        if not isinstance(contract.get(key), list) or not contract.get(key):
            problems.append(f"contract.{key} must be a non-empty array")
    if not isinstance(contract.get("workflow"), dict) or not contract.get("workflow"):
        problems.append("contract.workflow must be a non-empty object")
    if not isinstance(contract.get("pageBindings"), list):
        problems.append("contract.pageBindings must be an array")
    if not isinstance(contract.get("invariants"), list) or not contract.get("invariants"):
        problems.append("contract.invariants must be a non-empty array")
    if contract.get("preferredDevice") not in set(_supported_devices()):
        problems.append(f"contract.preferredDevice must be {_device_domain_or()}")

    entities = [item for item in contract.get("entities", []) if isinstance(item, dict)]
    entity_ids = {str(item.get("id") or "").strip() for item in entities}
    field_refs = {
        f"{entity.get('id')}.{field.get('id')}"
        for entity in entities
        for field in entity.get("fields", [])
        if entity.get("id") and isinstance(field, dict) and field.get("id")
    }
    role_ids = {
        str(role.get("id") or "").strip()
        for role in contract.get("roles", [])
        if isinstance(role, dict)
    }
    permissions = {
        str(permission).strip()
        for permission in contract.get("permissions", [])
        if str(permission).strip()
    }
    for menu in contract.get("menus", []):
        if not isinstance(menu, dict):
            problems.append("contract.menus entries must be objects")
            continue
        if any(role_ref not in role_ids for role_ref in menu.get("roleRefs", [])):
            problems.append(f"contract menu {menu.get('id')} has an unknown roleRef")
        if any(permission not in permissions for permission in menu.get("permissionRefs", [])):
            problems.append(f"contract menu {menu.get('id')} has an unknown permissionRef")
    granted_permissions = {
        permission
        for menu in contract.get("menus", [])
        if isinstance(menu, dict)
        for permission in menu.get("permissionRefs", [])
    }
    if permissions - granted_permissions:
        problems.append("contract.menus must grant every declared permission")

    workflow = contract.get("workflow") if isinstance(contract.get("workflow"), dict) else {}
    workflow_ids = _workflow_ids(workflow)
    workflow_nodes = [item for item in workflow.get("nodes", []) if isinstance(item, dict)]
    if not workflow_nodes:
        problems.append("contract.workflow.nodes must be a non-empty array")
    if not isinstance(workflow.get("transitions"), list) or not workflow.get("transitions"):
        problems.append("contract.workflow.transitions must be a non-empty array")
    for chain in [workflow, *(workflow.get("chains") or [])]:
        if not isinstance(chain, dict):
            continue
        node_ids = {
            str(node.get("id") or "").strip()
            for node in chain.get("nodes", [])
            if isinstance(node, dict)
        }
        for node in chain.get("nodes", []):
            if isinstance(node, dict) and str(node.get("assigneeRole") or "").strip() not in role_ids:
                problems.append(f"workflow node {node.get('id')} has an unknown assigneeRole")
        for transition in chain.get("transitions", []):
            if not isinstance(transition, dict):
                continue
            if transition.get("from") not in node_ids or transition.get("to") not in node_ids:
                problems.append(f"workflow {chain.get('id')} has a dangling transition")

    page_ids = {
        str(page.get("id") or "").strip()
        for page in contract.get("pages", [])
        if isinstance(page, dict)
    }
    if not page_ids or str(contract.get("landingPageRef") or "").strip() not in page_ids:
        problems.append("contract.landingPageRef must resolve to contract.pages[].id")
    for page in contract.get("pages", []):
        if not isinstance(page, dict):
            continue
        page_id = str(page.get("id") or "").strip()
        for ref in page.get("fieldBindings", []):
            if ref not in field_refs:
                problems.append(f"contract page {page_id} has an unknown fieldBinding: {ref}")
        for key in ("statusField", "dateField", "colorBy"):
            ref = page.get(key)
            if ref and ref not in field_refs:
                problems.append(f"contract page {page_id} has an unknown {key}: {ref}")
        for permission in page.get("actionPermissions", []):
            if permission not in permissions:
                problems.append(f"contract page {page_id} has an unknown actionPermission: {permission}")
        for stat in page.get("stats", []):
            if not isinstance(stat, dict):
                continue
            if stat.get("entity") not in entity_ids:
                problems.append(f"contract page {page_id} stat has an unknown entity")
            metric = str(stat.get("metric") or "")
            if ":" in metric and metric.split(":", 1)[1] not in field_refs:
                problems.append(f"contract page {page_id} stat has an unknown metric field")
        for chart in page.get("charts", []):
            if not isinstance(chart, dict):
                continue
            if chart.get("dimension") not in field_refs:
                problems.append(f"contract page {page_id} chart has an unknown dimension")
            metric = str(chart.get("metric") or "")
            if ":" in metric and metric.split(":", 1)[1] not in field_refs:
                problems.append(f"contract page {page_id} chart has an unknown metric field")
        for ranking in page.get("rankings", []):
            if not isinstance(ranking, dict):
                continue
            if ranking.get("entity") not in entity_ids or ranking.get("sortBy") not in field_refs:
                problems.append(f"contract page {page_id} ranking has an unknown binding")
        for feed in page.get("feeds", []):
            if not isinstance(feed, dict):
                continue
            if feed.get("entity") not in entity_ids or feed.get("timeField") not in field_refs:
                problems.append(f"contract page {page_id} feed has an unknown binding")
            if feed.get("levelField") and feed.get("levelField") not in field_refs:
                problems.append(f"contract page {page_id} feed has an unknown levelField")
        for block in page.get("blocks", []):
            if not isinstance(block, dict):
                continue
            binding = block.get("binding") if isinstance(block.get("binding"), dict) else {}
            if binding.get("entityRef") and binding.get("entityRef") not in entity_ids:
                problems.append(f"contract page {page_id} block has an unknown entityRef")
    for binding in contract.get("pageBindings", []):
        if not isinstance(binding, dict):
            problems.append("contract.pageBindings entries must be objects")
            continue
        if binding.get("pageRef") not in page_ids:
            problems.append(f"contract.pageBindings has an unknown pageRef: {binding.get('pageRef')}")
        if binding.get("workflowRef") not in workflow_ids:
            problems.append(f"contract.pageBindings has an unknown workflowRef: {binding.get('workflowRef')}")

    capabilities = [item for item in contract.get("aigcIntents", []) if isinstance(item, dict)]
    capability_ids = {str(item.get("id") or "").strip() for item in capabilities}
    capability_by_id = {str(item.get("id") or "").strip(): item for item in capabilities}
    for capability in capabilities:
        capability_id = str(capability.get("id") or "").strip()
        for ref in capability.get("inputFields", []):
            if ref not in field_refs:
                problems.append(f"contract AIGC {capability_id} has an unknown inputField: {ref}")
        if capability.get("outputField") not in field_refs:
            problems.append(f"contract AIGC {capability_id} has an unknown outputField")
        for role_ref in capability.get("roleRefs", []):
            if role_ref not in role_ids:
                problems.append(f"contract AIGC {capability_id} has an unknown roleRef: {role_ref}")
    pipelines = contract.get("aigcPipelines", [])
    if not isinstance(pipelines, list):
        problems.append("contract.aigcPipelines must be an array")
        pipelines = []
    for pipeline in pipelines:
        if not isinstance(pipeline, dict):
            problems.append("contract.aigcPipelines entries must be objects")
            continue
        steps = pipeline.get("steps")
        if not isinstance(steps, list) or len(steps) < 2:
            problems.append(f"contract AIGC pipeline {pipeline.get('id')} must have at least two steps")
            continue
        if any(step not in capability_ids for step in steps):
            problems.append(f"contract AIGC pipeline {pipeline.get('id')} has an unknown capability")
            continue
        for previous, following in zip(steps, steps[1:]):
            output = capability_by_id[previous].get("outputField")
            if output not in capability_by_id[following].get("inputFields", []):
                problems.append(f"contract AIGC pipeline {pipeline.get('id')} has a broken field handoff")

    declared_refs = entity_ids | field_refs | role_ids | permissions | workflow_ids | page_ids | capability_ids
    for invariant in contract.get("invariants", []):
        if not isinstance(invariant, dict):
            problems.append("contract.invariants entries must be objects")
            continue
        if not str(invariant.get("statement") or "").strip():
            problems.append(f"contract invariant {invariant.get('id')} has no statement")
        refs = invariant.get("refs")
        if not isinstance(refs, list) or not refs:
            problems.append(f"contract invariant {invariant.get('id')} has no refs")
        elif any(ref not in declared_refs for ref in refs):
            problems.append(f"contract invariant {invariant.get('id')} has an unknown ref")
    return problems


def _valid_contract(payload: Any) -> Optional[Dict[str, Any]]:
    if _contract_problems(payload):
        return None
    return payload["contract"]


def _section_from_payload(payload: Any, section: str) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    value = payload.get(section)
    return value if isinstance(value, dict) and value else None


def _run_wave(
    sections: Sequence[str],
    worker: Callable[[str], Optional[Dict[str, Any]]],
) -> Optional[Dict[str, Dict[str, Any]]]:
    if not sections:
        return {}
    results: Dict[str, Dict[str, Any]] = {}
    futures: dict[Future[Optional[Dict[str, Any]]], str] = {}
    with ThreadPoolExecutor(max_workers=min(_max_workers(), len(sections))) as pool:
        for section in sections:
            # Match graph-runtime behavior: each worker receives an isolated copy
            # of the request context instead of sharing mutable ContextVar state.
            ctx = copy_context()
            futures[pool.submit(ctx.run, worker, section)] = section
        for future in as_completed(futures):
            section = futures[future]
            try:
                value = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"[v5_parallel_generate] section={section} failed: {str(exc)[:160]}")
                value = None
            if value is None:
                for pending in futures:
                    if pending is not future:
                        pending.cancel()
                return None
            results[section] = value
    return results if len(results) == len(sections) else None


def _workflow_ids(workflow: Dict[str, Any]) -> set[str]:
    ids = {str(workflow.get("id") or "").strip()}
    for chain in [workflow, *(workflow.get("chains") or [])]:
        if not isinstance(chain, dict):
            continue
        ids.add(str(chain.get("id") or "").strip())
        for node in chain.get("nodes") or []:
            if isinstance(node, dict):
                ids.add(str(node.get("id") or "").strip())
    return {item for item in ids if item}


def assemble_appbundle(
    model: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build references from actual section outputs, never from LLM guesses."""
    meta = metadata if isinstance(metadata, dict) else {}
    pages = model.get("page", {}).get("pages", [])
    page_ids = [
        str(page.get("id") or "").strip()
        for page in pages
        if isinstance(page, dict) and str(page.get("id") or "").strip()
    ]
    workflow = model.get("workflow") if isinstance(model.get("workflow"), dict) else {}
    valid_workflow_ids = _workflow_ids(workflow)
    primary_workflow = str(workflow.get("id") or "").strip()
    if primary_workflow not in valid_workflow_ids:
        primary_workflow = next(iter(valid_workflow_ids), "")

    landing = str(meta.get("landingPageRef") or "").strip()
    if landing not in page_ids:
        landing = page_ids[0] if page_ids else ""
    device = str(meta.get("preferredDevice") or "").strip()
    if device not in set(_supported_devices()):
        device = _default_device()

    bindings = []
    declared_bindings = meta.get("pageBindings")
    if isinstance(declared_bindings, list):
        bindings = [
            copy.deepcopy(binding)
            for binding in declared_bindings
            if isinstance(binding, dict)
            and binding.get("pageRef") in page_ids
            and binding.get("workflowRef") in valid_workflow_ids
        ]
    elif primary_workflow:
        # Compatibility for repairing models produced before the complete
        # SystemContract carried explicit page-to-workflow relationships.
        bindings = [{"pageRef": page_id, "workflowRef": primary_workflow} for page_id in page_ids]

    roles = model.get("rbac", {}).get("roles", [])
    role_ids = []
    for role in roles:
        role_id = role.get("id") if isinstance(role, dict) else role
        role_id = str(role_id or "").strip()
        if role_id:
            role_ids.append(role_id)
    entities = model.get("datamodel", {}).get("entities", [])
    entity_ids = [
        str(entity.get("id") or "").strip()
        for entity in entities
        if isinstance(entity, dict) and str(entity.get("id") or "").strip()
    ]

    identity = copy.deepcopy(meta.get("appIdentity"))
    if not isinstance(identity, dict):
        identity = {"productName": "Workspace", "theme": "azure", "icon": "boxes", "nav": "side"}
    nav = identity.get("nav") if identity.get("nav") in {"side", "top"} else "side"
    bundle: Dict[str, Any] = {
        "pageBindings": bindings,
        "landingPageRef": landing,
        "preferredDevice": device,
        "roleRefs": role_ids,
        "dataModelRefs": entity_ids,
        "appIdentity": identity,
        "experienceShell": {"mode": "navigation", "navigation": nav},
    }
    invariants = meta.get("invariants")
    if isinstance(invariants, list) and invariants:
        bundle["invariants"] = copy.deepcopy(invariants)
    return bundle


def generate_parallel_five_system_model(
    goal: str,
    *,
    user_context: str,
    call_json: JsonCall,
) -> Optional[Dict[str, Any]]:
    contract_messages = [
        {"role": "system", "content": _contract_instruction()},
        {"role": "user", "content": user_context},
    ]
    with _enrich_stage("model.contract", current=1, total=4, attempts=2) as contract_stage:
        contract_payload = call_json(
            contract_messages,
            ("contract",),
            12000,
        )
        problems = _contract_problems(contract_payload)
        contract_stage["used"] = 1
        if problems:
            print(f"[v5_parallel_generate] contract validation retry: {'; '.join(problems)}")
            contract_payload = call_json(
                contract_messages
                + [
                    {"role": "assistant", "content": _json(contract_payload)[:12000]},
                    {
                        "role": "user",
                        "content": (
                            "Your SystemContract failed deterministic validation:\n- "
                            + "\n- ".join(problems)
                            + "\nReturn the complete corrected {\"contract\": ...} JSON only."
                        ),
                    },
                ],
                ("contract",),
                12000,
            )
            contract_stage["used"] = 2
    contract = _valid_contract(contract_payload)
    if contract is None:
        print(
            "[v5_parallel_generate] contract missing required identifiers: "
            + "; ".join(_contract_problems(contract_payload))
        )
        return None

    contract_json = _json(contract)

    def first_worker(section: str) -> Optional[Dict[str, Any]]:
        with _enrich_stage("model.section", section=section, wave=1, current=2, total=4):
            payload = call_json(
                [
                    {"role": "system", "content": _section_instruction(section)},
                    {"role": "user", "content": f"Business intent:\n{goal}\n\nImmutable SystemContract:\n{contract_json}"},
                ],
                (section,),
                6000,
            )
        return _section_from_payload(payload, section)

    first = _run_wave(_FIRST_WAVE, first_worker)
    if first is None:
        return None

    validated_context = _json(first)

    def second_worker(section: str) -> Optional[Dict[str, Any]]:
        with _enrich_stage("model.section", section=section, wave=2, current=3, total=4):
            payload = call_json(
                [
                    {"role": "system", "content": _section_instruction(section)},
                    {
                        "role": "user",
                        "content": (
                            f"Business intent:\n{goal}\n\nImmutable SystemContract:\n{contract_json}"
                            f"\n\nCompleted upstream sections:\n{validated_context}"
                        ),
                    },
                ],
                (section,),
                10000 if section == "page" else 5000,
            )
        return _section_from_payload(payload, section)

    second = _run_wave(_SECOND_WAVE, second_worker)
    if second is None:
        return None

    model: Dict[str, Any] = {**first, **second}
    with _enrich_stage("model.appbundle", deterministic=1, current=4, total=4):
        model["appbundle"] = assemble_appbundle(model, contract)
    return model


def regenerate_failed_sections(
    goal: str,
    model: Dict[str, Any],
    findings: Iterable[Dict[str, Any]],
    *,
    call_json: JsonCall,
) -> Optional[Dict[str, Any]]:
    """Regenerate only sections named by gate findings, then reassemble refs."""
    finding_list = [finding for finding in findings if isinstance(finding, dict)]
    affected = {
        str(finding.get("affectedSkill") or "").strip()
        for finding in finding_list
    }
    sections = tuple(section for section in _ALL_LLM_SECTIONS if section in affected)
    candidate = copy.deepcopy(model)
    if not sections and "appbundle" not in affected:
        return None
    feedback = "\n".join(
        f"- {finding.get('path', '')}: {finding.get('message', '')}"
        for finding in finding_list[:30]
    )
    model_json = _json(model)

    def worker(section: str) -> Optional[Dict[str, Any]]:
        with _enrich_stage("model.section.repair", section=section, current=1, total=len(sections)):
            payload = call_json(
                [
                    {
                        "role": "system",
                        "content": (
                            _section_instruction(section)
                            + " Repair only this section. Preserve every unaffected ID and reference."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Business intent:\n{goal}\n\nCurrent complete model:\n{model_json}"
                            f"\n\nDeterministic gate findings:\n{feedback}"
                        ),
                    },
                ],
                (section,),
                10000 if section == "page" else 6000,
            )
        return _section_from_payload(payload, section)

    replacements = _run_wave(sections, worker)
    if replacements is None:
        return None
    candidate.update(replacements)
    candidate["appbundle"] = assemble_appbundle(candidate, model.get("appbundle"))
    return candidate
