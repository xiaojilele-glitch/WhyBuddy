"""
T3 — LLM generate() for the five-system model.

Produces a five-system (six-section) enterprise-app metamodel from a free-text
intent, targeting the exact shape validate_five_system_model() checks. The
LLM output is ALWAYS run through the structural gate by the caller; this module
only produces a candidate.

North-star discipline (先证通用性，再接 LLM；别把两件事耦合):
    generate_five_system_model(goal, *, llm_json_fn=None)
      - llm_json_fn is injectable. Default wraps call_llm_json_with_shape.
      - Tests pass a fake llm_json_fn so gate/closure logic is verified with
        NO real key and NO network.
      - No key / LLM error / unparseable => returns None (never raises,
        never a silent stub). Caller treats None as fail-closed.
"""

from __future__ import annotations
from .archetype_legal import fill_device_placeholders as _fill_device_placeholders
from .archetype_legal import required_evidence as _required_evidence

import os
from contextvars import ContextVar
from typing import Any, Callable, Dict, List, Optional

from sliderule_llm.config import default_max_tokens, wider_output_budget

from .enrich_timing import stage as _enrich_stage

# Sections the model must contain — mirrors v5_model_gate.SKILL_KEYS.
#: ⚠ 2026-08-30：第 10 处手抄的六系统词表（生成契约这一份）。生成侧要产哪几段，
#: 必须与闸要哪几段同源——不同源就是「生成了五段、闸要六段」这类静默 0/6。
#: 现在从产品原型账本派生。tuple 语义不变（本模块多处 `in _REQUIRED_SECTIONS`）。
_REQUIRED_SECTIONS = tuple(_required_evidence())

# 生成调用的输出上限走**全局那一个** `default_max_tokens()`。
#
# 这里以前有个 `_DEFAULT_GENERATE_MAX_TOKENS = 8000` 和它专属的
# `LLM_GENERATE_MAX_TOKENS`，**已经删了**。它救不了这条链路：推理模型的思考
# token 和正文共用 max_tokens，8000 全被思考吃掉、正文一个字没有、
# finish_reason=length、客户端只看到 `empty content from LLM (stream)`
# ——而下游还有一堆这个旋钮管不着的写死预算，调它只是把病挪个地方发作。
# 现在全链路一个 `LLM_MAX_TOKENS`，理由见 sliderule_llm.config.DEFAULT_MAX_TOKENS。

# The JSON contract handed to the LLM. Kept explicit so the model emits exactly
# the shape the gate validates (cross-refs must be internally consistent).
# E40.1：契约里的合法域枚举段由单一真相源渲染（__TOKEN__ 占位，文件底部
# 统一替换）——账本加值，LLM 看到的菜单自动跟上，不再手抄漂移。
_SCHEMA_INSTRUCTION_TEMPLATE = """\
You are an enterprise-application metamodel designer. Given a business intent,
produce a SINGLE JSON object modelling FIVE interlocking systems. Output ONLY
valid JSON (no prose, no markdown fences). Every cross-system reference MUST
resolve to a node you define in this same object — dangling references will be
rejected by a structural gate.

Required shape (use these exact keys):
{
  "datamodel": {
    "entities": [
      {"id": "<snake_case>", "name": "<label>", "fields": [
        {"id": "<snake_case>", "name": "<label>", "type": "string|number|date|ref|enum",
         "refEntity": "<entity_id>",
         "options": [{"id": "<value>", "label": "<label>", "tone": "__FIELD_TONES__"}],
         "format": "__FIELD_FORMATS__"}
      ]}
    ]
  },
  "rbac": {
    "roles": [{"id": "<snake_case>", "name": "<label>"}, ...],
    "permissions": ["<resource>:<action>", ...],
    "menus": [{"id": "<id>", "label": "<label>", "roleRefs": ["<role_id>"], "permissionRefs": ["<perm>"]}]
  },
  "workflow": {
    "id": "<workflow_id>",
    "name": "<label of the PRIMARY chain — the core business object lifecycle>",
    "nodes": [{"id": "<id>", "name": "<label>", "assigneeRole": "<role_id>", "phase": "<stage label>"}],
    "transitions": [{"from": "<node_id>", "to": "<node_id>", "condition": "<optional>"}],
    "chains": [
      {"id": "<chain_id>", "name": "<label>", "kind": "money|lifecycle|governance|recovery",
       "nodes": [{"id": "<id>", "name": "<label>", "assigneeRole": "<role_id>", "phase": "<stage label>"}],
       "transitions": [{"from": "<node_id>", "to": "<node_id>", "condition": "<optional>"}]}
    ]
  },
  "page": {
    "pages": [{"id": "<id>", "name": "<label>",
               "kind": "__PAGE_KINDS__",
               "presentation": "marketing-landing|application",
               "surface": {"type": "__PAGE_SURFACE_TYPES__", "density": "__PAGE_SURFACE_DENSITIES__"},
               "statusField": "<entity_id>.<field_id> (kanban only)",
               "dateField": "<entity_id>.<field_id> (calendar only)",
               "colorBy": "<entity_id>.<field_id> (calendar only, optional)",
               "fieldBindings": ["<entity_id>.<field_id>"],
               "actionPermissions": ["<resource>:<action>"],
               "stats": [
                 {"id": "<id>", "name": "<label>", "entity": "<entity_id>",
                  "metric": "__STAT_METRIC_FORMS__",
                  "format": "__STAT_FORMATS__"}
               ],
               "charts": [
                 {"id": "<id>", "name": "<label>", "type": "__CHART_TYPES__",
                  "dimension": "<entity_id>.<field_id>",
                  "metric": "__CHART_METRIC_FORMS__"}
               ],
               "rankings": [
                 {"id": "<id>", "name": "<label>", "entity": "<entity_id>",
                  "sortBy": "<entity_id>.<number_field_id>", "limit": 5}
               ],
               "feeds": [
                 {"id": "<id>", "name": "<label>", "entity": "<entity_id>",
                  "timeField": "<entity_id>.<date_field_id>",
                  "levelField": "<entity_id>.<enum_field_id> (optional)"}
               ],
               "blocks": [
                 {"id": "<id>", "type": "<experience block type>",
                  "props": {"title": "<label>"},
                  "binding": {"entityRef": "<entity_id>"}}
               ]}]
  },
  "aigc": {
    "capabilities": [{"id": "<id>", "name": "<label>",
                      "inputFields": ["<entity_id>.<field_id>"],
                      "outputField": "<entity_id>.<field_id>",
                      "roleRefs": ["<role_id>"]}],
    "pipelines": [
      {"id": "<id>", "name": "<label>", "steps": ["<capability_id>", "<capability_id>"]}
    ]
  },
  "appbundle": {
    "pageBindings": [{"pageRef": "<page_id>", "workflowRef": "<workflow_id_or_node_id>"}],
    "landingPageRef": "<page_id shown first when the app opens>",
    "preferredDevice": "__PREFERRED_DEVICES__",
    "roleRefs": ["<role_id>"],
    "dataModelRefs": ["<entity_id>"],
    "appIdentity": {"productName": "<2-6字产品名>", "theme": "__IDENTITY_THEMES__",
                    "icon": "__IDENTITY_ICONS__", "nav": "__IDENTITY_NAVS__"},
    "invariants": [
      {"id": "<snake_case>", "statement": "<one-sentence declarative constraint>",
       "systems": ["datamodel|rbac|workflow|page|aigc"],
       "refs": ["<entity_id or entity_id.field_id or role_id or permission or workflow/chain node_id or aigc capability id>"]}
    ]
  }
}

Rules:
- Every workflow node assigneeRole MUST be one of the rbac.roles[].id values.
- rbac.roles[].id is the reference key: snake_case ASCII, used by assigneeRole,
  roleRefs and menu roleRefs. rbac.roles[].name is what humans see — write it in
  the SAME LANGUAGE as the user's intent (e.g. 仓库管理员, not warehouse_keeper).
  Never put the display name in the id, and never leave name equal to the id.
- Every page fieldBinding MUST be "<entityId>.<fieldId>" from datamodel.
- Every page actionPermission MUST be in rbac.permissions.
- A BLOCK CAN ONLY BIND FIELDS THE ENTITY ACTUALLY HAS, of the exact type the
  block's binding contract asks for. Before you place a block, make sure the entity
  you bind it to CARRIES those fields — if it does not, add them to the entity in
  datamodel. Two cases keep going wrong; both end as a rejected model:
  · A recurring time-of-day window (a daily/weekly quiet period, business hours,
    an on-call shift slot) is a "string" field holding "HH:MM" — NOT a "date".
    "date" pins one absolute moment, which cannot express "every day 09:00-18:00".
    Blocks asking for startTimeFieldRef / endTimeFieldRef want that "HH:MM" string,
    so the entity needs string fields for it.
  · A threshold, score, count or ranking measure is a "number" field. An enum
    severity is NOT a threshold and a "ref" is never a measure. If a block needs a
    numeric field (thresholdFieldRef, sortByRef, …) and the entity has no number
    field at all, that entity is under-modelled — add the real numeric field.
  Picking the nearest wrong-typed field does not work: the gate rejects the model
  and the whole thing is regenerated.
- PEOPLE NEED A NAME FIELD, not only a relation. Whenever an entity carries a
  person / team / owner / assignee / recipient party, give that entity a "string"
  field holding the party's DISPLAY NAME — in addition to any "ref" field you use
  for the relation (e.g. BOTH assignee_ref of type "ref" AND assignee_name of type
  "string"). Experience blocks bind people through assigneeFieldRef,
  memberFieldRef, ownerFieldRef, receiverFieldRef, actorFieldRef and
  applicantFieldRef, and EVERY one of those requires a "string" field. A "ref"
  field can never satisfy them: "ref" declares no target entity anywhere in this
  schema, so nothing downstream can resolve it into a name to display. If the only
  person-ish field on the entity is a "ref", the block has nothing correct to bind,
  the structural gate rejects the page, and the whole model is regenerated — this
  is a rejected deliverable, not a cosmetic warning.
- A "ref" FIELD MUST DECLARE ITS TARGET: `"refEntity": "<entity_id>"` naming the
  entity it points at (that entity must exist in this same datamodel). Without it
  the relation degrades into a plain text box and the user has to TYPE a row id by
  hand — the runtime can only render a picker when it knows which rows to offer.
  Measured on 181 real generated models: 1689 "ref" fields, and the id-name
  heuristic could only resolve 41% of them; the other 998 rendered as free text.
  Naming alone does not carry it — `assigned_team` pointing at `oncall_teams`,
  `route_group_id` pointing at `on_call_group`, or `alert_ref` where BOTH
  `alert_event` and `alert_route_rule` exist are all unresolvable without the
  declaration. Put "refEntity" on every "ref" field and on no other field.
- HIERARCHY IS A STRING ID, not a "ref". When an entity forms a tree (parent
  policy, sub-item, parent node, caller/callee), give it a "string" field holding
  the PARENT ROW'S id — e.g. parent_policy_id of type "string". Blocks bind
  hierarchy through parentFieldRef, parentPartFieldRef, spanParentFieldRef,
  nodeParentFieldRef, operatorParentFieldRef and profileParentFieldRef, and EVERY
  one of them requires a "string" field. Typing that column "ref" reads as the
  natural choice and is exactly what gets the model rejected: NO entityFieldRef in
  the whole catalog accepts "ref" — of 1009 required field types, 447 want string,
  273 enum, 205 number, 84 date and ZERO want ref — because "ref" declares no
  target entity anywhere in this schema. Root rows carry an empty parent id; never
  invent a parent to fill it.
- Every aigc input/output field MUST be from datamodel; roleRefs from rbac.roles.
- appbundle pageRef∈pages, workflowRef∈workflow, roleRefs∈roles, dataModelRefs∈entities.
__WORKFLOWREF_RULE__
- appbundle.landingPageRef is REQUIRED and MUST equal one page.pages[].id. Pick
  the page that best represents the user's main job when the app opens (for
  example a monitor/dashboard/calendar page), not a generic approval home.
- appbundle.preferredDevice is REQUIRED and MUST be exactly one of: __PREFERRED_DEVICES_OR__.
  Follow an explicit device in the user's goal. Otherwise decide once from the
  complete product, landing-page shape, and primary operating posture. Never omit
  this field and never request responsive or dual-device generation.
- Model the SPECIFIC business the intent describes (entities, roles, approval
  steps, pages that fit that domain). Do not emit a generic template.
- PHASES (swimlanes): give EVERY workflow node a "phase" — a short stage label
  in the intent's language (e.g. 申请 / 审核 / 执行 / 验收). Use 2-4 phases
  total; nodes of the same phase must be consecutive along the main flow.

- APP IDENTITY (every app gets its own face): appbundle.appIdentity is
  REQUIRED. "productName" is a REAL product name in the intent's language
  (2-6 chars/words, brandable — e.g. 舆情智采, 采买通, IncomeBoard), NEVER a
  copy of the user's raw sentence. "theme" picks the visual temperament:
  azure = universal enterprise blue, forest = operations/production green,
  graphite = neutral professional gray, tangerine = consumer-facing energy,
  violet = creative/AI intelligence, amber = finance/audit warmth,
  clay = warm humanistic terracotta, indigo = data-dense analytical.
  "icon" picks the brand mark from the closed set (cart=procurement,
  users=HR/CRM, shield=audit/security, chart=analytics, calendar=scheduling,
  wrench=service/ops, spark=AI tools, globe=cross-region, heart=health/care,
  book=learning, file=docs, boxes=generic platform). "nav" = side (management
  consoles, many menus) or top (monitoring/overview products, few menus).

Content-quality rules (checked by a deterministic regression gate):
- REACHABILITY: every permission listed in a page's actionPermissions MUST be
  granted to at least one role via rbac.menus[].permissionRefs — a page whose
  permissions no role holds is unreachable for everyone (hard failure).
- LEAST PRIVILEGE: spread permissions across roles by duty; no single role
  should hold (almost) all permissions. Every declared permission should be
  granted to at least one role.
- FLOW SHAPE: the workflow MUST contain at least one conditional branch and a
  rejection/return path (e.g. a transition back to an earlier node or to a
  terminal "rejected/cancelled" node) — never a single straight line.
- NO ORPHANS: every entity should be referenced by at least one page
  fieldBinding, aigc field, or another entity's ref field.
- MULTI-CHAIN COVERAGE: real systems run on SEVERAL business chains, not one
  approval flow. The top-level workflow (id/nodes/transitions) is the PRIMARY
  chain: the lifecycle of the core business object (e.g. order/task/case:
  create → validate/charge → execute → archive). Then add 1-3 more chains in
  "chains", each with a distinct kind:
    * "money"      — funds movement (order → pay → server-side confirm → credit
                     account → audit trail), if the intent involves payment/billing;
    * "governance" — approval/review flow, if the domain needs one;
    * "recovery"   — compensation/retry/cleanup for failures, when async work exists.
  Every chain follows the same node/transition rules (assigneeRole ∈ rbac.roles,
  phase labels, at least one branch or return path). Node ids must be unique
  ACROSS all chains. Do NOT duplicate the primary chain inside "chains".
- PIPELINES (agent orchestration): when two or more capabilities naturally
  chain — one capability's outputField feeds another's inputFields — declare
  1-2 "pipelines" (2-4 steps each, steps are capability ids in execution
  order). HARD RULE: for every adjacent pair, the previous capability's
  outputField MUST literally appear in the next capability's inputFields —
  that field IS the handoff (orchestration is wired through datamodel fields,
  not loose prose). Do NOT force pipelines when capabilities are unrelated;
  omit "pipelines" entirely in that case.
- CHARTS (library-agnostic): pages whose job includes monitoring/analytics
  (dashboards, finance, audit, ops) declare "charts" — how many depends on
  what this operation genuinely needs to see visualized (a single decisive
  trend, or several breakdowns), not a fixed quota. A chart is a
  SEMANTIC declaration — what to visualize, never which UI library renders it:
  "dimension" is the grouping field (enum/status/category/date fields work
  best), "metric" is either "count" (rows per group) or "sum:<entity.field>"
  over a number field. Both MUST reference real datamodel fields. "type" picks
  the form by the data's job: bar = compare magnitudes across categories,
  line = change over an ordered/date dimension, pie = share of a whole with
  FEW (≤5) categories, donut = share of a whole with the TOTAL as the hero
  number in the center (pick donut when the total itself matters). Pure CRUD
  pages need no charts.
- RANKINGS (leaderboard, optional): monitoring/analytics pages where "who is
  top-N" matters (hot content, top spenders, best performers) may declare ONE
  ranking: "entity" is the row source, "sortBy" MUST be a real NUMBER field
  (rank by score/amount/count-like values), "limit" 3-10. Skip when ranking
  carries no business meaning.
- PAGE KINDS: workbench = CRUD console (default), kanban = status board
  (needs statusField), calendar = date-driven (needs dateField), dashboard =
  chart-first analytics, monitor = ops overview — its headline metrics and
  charts are the operational numbers THIS business actually watches, so the
  MIX and COUNT must follow the domain, not a fixed template: some overviews
  live on one hero metric plus a couple of trend charts, others on a wall of
  small KPIs with a single breakdown. Do NOT reflexively emit the same
  "N stats + M charts + a ranking + a feed" shape for every app — that makes
  every product's home page look identical. Declare only what this business
  genuinely surfaces first (a ranking/feed only when top-N or a live activity
  stream is a real part of THIS operation, not as a slot to fill). wizard =
  step-by-step guided flow (the page MUST be bound to the workflow via
  appbundle.pageBindings workflowRef — its steps ARE the workflow nodes).
  Pick by the page's job, vary across pages — real products mix kinds.
- WORKBENCH SURFACE (optional, for workbench pages): choose the primary operating
  structure by the page's actual job. table = searchable read-heavy registry;
  editable-table = high-frequency inline editing such as attendance or stock;
  split-list = master list plus persistent detail pane for people/resources;
  queue = status-segmented processing for payments, approvals, renewals, or
  exceptions. density is compact/default/comfortable. Do not vary this merely
  for decoration: pages with different jobs should have different structures.
- FEEDS (activity/alert stream, optional): overview pages that watch things
  happen (alerts, submissions, escalations) may declare ONE feed: "entity" is
  the row source, "timeField" MUST be a real DATE field (stream orders by it,
  newest first), "levelField" (optional) MUST be an enum field — its options'
  tones color the level tag (danger=红/warning=橙…). Skip on pure CRUD pages.
- ENUM OPTIONS (status semantics): EVERY enum field MUST declare "options" —
  2-6 concrete values in the intent's language, each with a "tone" carrying
  its color semantics: success = positive/done (已通过/已完成), processing =
  in-flight (进行中/审核中), warning = waiting/attention (待审批/即将到期),
  danger = risk/failure (已驳回/高风险), default = neutral (草稿/未开始).
  Status-machine fields (审批状态/优先级/风险等级/阶段) matter most — the
  runtime renders these as colored badges, kanban columns and filters.
  Never declare "options" on a non-enum field.
- FIELD FORMAT (display semantics, optional): declare "format" only when a
  field has one canonical rendering — number fields: "money" (amounts, ¥),
  "percent" (rates 0-100), "progress" (completion 0-100 → progress bar),
  "score" (0-100 evaluation), "rating" (1-5 stars); string fields: "masked"
  (phone/ID-card — sensitive, rendered partially hidden). Omit for plain
  values; NEVER put a format on date/ref/enum fields.
- STATS (KPI cards): pages whose job includes overview/monitoring declare
  "stats" — headline metric cards. Let the count follow what this business
  actually leads with: it can be a single decisive number, a tight pair, or a
  denser row of six — pick by the domain, don't default to the same count
  every time (a monitor that always has exactly 4 stats reads as a template,
  not a design). "entity" scopes count; sum/avg must target a number field.
  Same field-existence rules as charts. Pure CRUD pages need none.
- PAGE PRESENTATION: use "marketing-landing" only for a consumer-facing or public landing page
  whose first job is to explain an offer, establish a brand, and drive one primary action. Such a
  page MUST NOT be coerced into an operations monitor and MUST NOT declare stats, charts, rankings,
  feeds, or a workbench surface. Use "application" for authenticated operational product pages.
- PAGE KIND (view paradigm): pick each page's "kind" by its job — omit or
  "workbench" (default) for CRUD tables; "kanban" when the core object flows
  through stages (跟进/审批/生产状态) — REQUIRES "statusField" naming an enum
  field (with options) of this page's entity, columns come from its options;
  "calendar" when rows live on dates (排期/预约/计划) — REQUIRES "dateField"
  naming a date field of this page's entity, optional "colorBy" naming an
  enum field for event coloring; "monitor" for the app's HOME/ops overview —
  the page users open first to see how the business is doing (KPI + trends +
  activity), there is usually exactly ONE such page per app; "dashboard" only
  for a SECONDARY chart-first analytics page beyond the home overview (深钻
  分析页), not for the home page itself. Give overview pages the stats and
  charts the domain actually leads with, count set by the business's real
  focus rather than a fixed quota.
  Use at most one kanban and one calendar page; never force a paradigm the
  domain doesn't need.
- LANDING PAGE: appbundle.landingPageRef points to the page that should truly open first. For a
  public/consumer offer, this MUST be the marketing-landing page. For an internal operations app,
  it usually points to the monitor/overview page. Do not invent an operations dashboard merely to
  satisfy landingPageRef.
- INVARIANTS: emit 5-8 entries in "appbundle.invariants" — declarative constraints that
  must always hold, the kind an architect writes after a production incident
  (ordering: "charge before calling the upstream provider"; source of truth:
  "payment status changes only via server-side verified callback"; durability:
  "generated remote media must be re-hosted to owned storage"; traceability:
  "every balance change must have a ledger row"). Each invariant MUST ground
  itself via "refs" pointing at ids that exist in THIS model (entity, field,
  role, permission, or workflow/chain node) and "systems" naming the sections
  it constrains. Write statements in the intent's language. No vague platitudes
  ("system should be secure") — each must be checkable against the model.
"""


#: appbundle.pageBindings[].workflowRef 的合法域说明（2026-08-10 加，治 B 族）。
#
# 曾用 SLIDERULE_EXP_OMIT_WORKFLOWREF_RULE 对这一段做过 A/B，判定完成后开关已撤，
# 结论留在这里。起因是加了这条之后，**新出现**了一族 chainRef 裁决——
# `chainRef 'alert_lifecycle' not found in workflow.chains`，而 alert_lifecycle
# 正是主链 id，也正是这条规则新告诉模型"算 workflow id"的那个东西。怀疑模型把
# 这条外推到了 chainRef 上（chainRef 恰恰**不认**主链，见
# _collect_workflow_chain_ids）。
#
# A/B 判定（跨 5 个队列共 28 个模型）：非法 chainRef **只出现在**"有本规则、且没有
# 末尾那句限定域"的那一个队列（2/6 趟），其余 22 个模型零非法，超几何 p≈0.040；
# 两个非法值都是主链 id `alert_lifecycle`——正是本规则新点名为合法 workflow id 的
# 那个东西。所以末尾"别外推到 chainRef"那句是**必须留着**的。
_WORKFLOWREF_RULE = """\
- appbundle.pageBindings[].workflowRef IS NOT A FREE LABEL and is NOT one per page.
  It MUST be an id you already defined inside "workflow": the top-level workflow.id,
  one of workflow.chains[].id, or one of the node ids in either. Nothing else is a
  workflow id. It is OPTIONAL: set it only on a page the user actually drives that
  workflow from, and OMIT it everywhere else. Never invent a per-page process name
  and never copy the pageRef into it. Omitting the field is correct and costs
  nothing; a value that is not one of those ids is a dangling reference that gets the
  whole model rejected and regenerated. The one exception: a page with kind "wizard"
  MUST be bound here with a real workflowRef, because the wizard's steps are read
  from that workflow — a wizard without it cannot render.
  This paragraph is about workflowRef ONLY. Do NOT carry it over to a block's
  props.chainRef: chainRef accepts ONLY a workflow.chains[].id — the top-level
  workflow.id and node ids are NOT valid there."""


def _render_schema_instruction(template: str) -> str:
    """E40.1：把契约模板里的 __TOKEN__ 占位换成真相源账本渲染的枚举串。

    metric 形态按 bare + 前缀拼装（"count|sum:<entity_id>.<field_id>|…"），
    与门/修复器的判定规则同一来源。渲染后的契约不含任何残留占位——
    parity 测试锁死。
    """
    from .schema_legal import (
        CHART_METRIC_PREFIXES,
        METRIC_BARE,
        STAT_METRIC_PREFIXES,
        enum_str,
    )

    field_ref = "<entity_id>.<field_id>"
    chart_metrics = "|".join(list(METRIC_BARE) + [f"{p}{field_ref}" for p in CHART_METRIC_PREFIXES])
    stat_metrics = "|".join(list(METRIC_BARE) + [f"{p}{field_ref}" for p in STAT_METRIC_PREFIXES])
    rendered = (
        template
        .replace("__WORKFLOWREF_RULE__", _WORKFLOWREF_RULE)
        .replace("__FIELD_TONES__", enum_str("fieldTones"))
        .replace("__FIELD_FORMATS__", enum_str("numberFormats", "stringFormats"))
        .replace("__PAGE_KINDS__", enum_str("pageKinds"))
        .replace("__PAGE_SURFACE_TYPES__", enum_str("pageSurfaceTypes"))
        .replace("__PAGE_SURFACE_DENSITIES__", enum_str("pageSurfaceDensities"))
        .replace("__STAT_FORMATS__", enum_str("statFormats"))
        .replace("__CHART_TYPES__", enum_str("chartTypes"))
        .replace("__STAT_METRIC_FORMS__", stat_metrics)
        .replace("__CHART_METRIC_FORMS__", chart_metrics)
        .replace("__IDENTITY_THEMES__", enum_str("identityThemes"))
        .replace("__IDENTITY_ICONS__", enum_str("identityIcons"))
        .replace("__IDENTITY_NAVS__", enum_str("identityNavs"))
    )
    return _fill_device_placeholders(rendered)


def _append_experience_block_catalog(instruction: str) -> str:
    """二阶段：从同一目录注入过渡说明，不让 Prompt 另写一份区块清单。"""
    from .schema_legal import experience_block_prompt_block

    return (
        f"{instruction.rstrip()}\n\n"
        f"{_fill_device_placeholders(experience_block_prompt_block())}\n"
    )


_SCHEMA_INSTRUCTION = _append_experience_block_catalog(
    _render_schema_instruction(_SCHEMA_INSTRUCTION_TEMPLATE)
)


def schema_instruction_for(goal: str) -> str:
    """这一次生成实际用的系统指令。

    窄化关（默认）→ 原样返回模块级那份全量常量，行为与从前逐字相同。
    窄化开 → 按题意挑一批区块，**每次请求重新组装**目录段。

    为什么不能沿用模块级常量：`_SCHEMA_INSTRUCTION` 是 import 那一刻就固化的，
    而窄化的结果依赖 goal。所以窄化必须在请求期组装——这也是它唯一的代价
    （多拼一次字符串，相对 100s+ 的生成可忽略）。

    fail-open：窄化过程里任何异常都退回全量指令。窄化是优化，不该让生成不可用。
    """
    try:
        from .block_narrowing import (
            derive_goal_presets,
            narrowing_enabled,
            narrowing_limit,
            preset_block_names,
            select_blocks,
        )

        if not narrowing_enabled() or not (goal or "").strip():
            return _SCHEMA_INSTRUCTION

        from .schema_legal import (
            EXPERIENCE_BLOCKS,
            PAGE_KIND_PRESETS,
            PAGE_KINDS,
            experience_block_prompt_block,
        )

        enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
        picked = select_blocks(
            enabled,
            goal,
            limit=narrowing_limit(),
            mandatory=preset_block_names(PAGE_KIND_PRESETS),
        )
        # select_blocks 原样退回全量（自适应判定为"目录没覆盖这个域"、goal 空、
        # 依赖缺失…）时，**返回模块级那份常量本身**，而不是照 enabled 重建一遍。
        #
        # 差别是真实的：`enabled` 只含通电区块，而全量那份 prompt 是拿
        # EXPERIENCE_BLOCKS（含 schema-only 那档）建的。照 enabled 重建会把
        # schema-only 的详情段丢掉——退回路径本该"什么都没变"，却悄悄少了一段
        # 禁令上下文。测试 test_零覆盖域的系统指令与全量逐字相同 抓的就是这个。
        if len(picked) == len(enabled):
            return _SCHEMA_INSTRUCTION
        # 第 2 层：按题意派生几档预设追加到 PROVEN LAYOUTS 后面。窄化只把对题件
        # 送进可达区（第 1 层），而选材仍被预设形状主导——实测选中数停在 4.5/16。
        derived = derive_goal_presets(picked, PAGE_KIND_PRESETS, PAGE_KINDS)
        base = _render_schema_instruction(_SCHEMA_INSTRUCTION_TEMPLATE)
        catalog = _fill_device_placeholders(
            experience_block_prompt_block(picked, extra_presets=derived)
        )
        return f"{base.rstrip()}\n\n{catalog}\n"
    except Exception as exc:  # noqa: BLE001 — 窄化失败不得让生成挂掉
        print(f"[v5_llm_generate] catalog narrowing skipped: {str(exc)[:160]}")
        return _SCHEMA_INSTRUCTION


# ── 请求域状态（2026-08-06 从模块级全局改过来）──────────────────────
#
# 下面这几项原本是**普通模块级全局**，等于整个进程共用一份。单人本地开发看
# 不出问题，多租户并发下三条全部实测复现（并发探针，两个请求 + 三个并行 worker）：
#
#   _delta_sink            → 用户 A 生成的内容实时出现在用户 B 的页面上，
#                            A 自己那边一片空白。**跨用户内容泄漏。**
#   _installed_skills      → A 装的技能没进 A 的生成，B 的技能进去了。
#   _last_call_error       → 三个并行 worker 互相覆盖，报错张冠李戴
#                            （datamodel 挂了却报 rbac 挂了）。
#   last_generate_diagnostic → 同上，跨请求互相覆盖。
#
# ## 为什么用 ContextVar，以及为什么其中一个必须存「可变容器」
#
# ContextVar 是 PEP 567 给的标准答案，且**与现有并行实现天然配套**：
# v5_parallel_generate._run_wave 已经用 `copy_context()` + `ctx.run(...)` 把
# 上下文传进 worker（与 OpenTelemetry 的 `context.get_current()` /
# `context.attach()` 是同一套语义，见 opentelemetry-instrumentation-threading
# 的 __wrap_thread_pool_submit）。
#
# 但那套复制的是 ContextVar 的**值**——worker 里 `var.set(x)` **不会**回传给
# 父线程。这对 sink / skills 无所谓（父设、子读），对 _last_call_error 却是
# 致命的：它恰恰是 worker 写、主线程读，存值会让主线程永远读到空。
#
# 解法照抄两个成熟实现共用的那一招：**ContextVar 存的是可变容器的引用，
# 不是值本身**。父子共享同一个 dict，worker 改 dict 主线程看得见；不同请求
# 各拿各的 dict，天然隔离。出处：
#   · OpenTelemetry —— ContextVar 存 Span 引用，子任务改 Span 属性，父任务读得到
#   · asgiref.local._CVar —— ContextVar 存 _Storage，真正的数据在 _Storage.data
#     这个可变 dict 里（django/asgiref，asgiref/local.py）
#
# 顺带：容器还让「三个 worker 互相覆盖」这件事也解决了——按 section 分键存，
# 谁的错就是谁的，不用抢同一个格子。

# 最近一次生成的诊断（供 publish closure 的 blocker 面向用户透出失败原因；
# fail-closed 判定完全不读它——它只是留痕，不参与 trust/gate）。
_diagnostic_var: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "sliderule_generate_diagnostic", default=None
)

# 实时增量回调（推演可观测性）：驱动层注册后，五系统 LLM 生成的内容增量会
# 逐块推给它（SSE llm_delta → 前端左栏实时草稿）。只是观测钩子——不参与
# 生成结果、gate、trust 判定；回调异常被吞掉，永不影响调用本身。
_delta_sink_var: ContextVar[Optional[Callable[[str], None]]] = ContextVar(
    "sliderule_generate_delta_sink", default=None
)

# 每请求一个的错误簿：worker 线程写、主线程读，所以必须是可变容器（理由见上）。
# 键是 section 名（并行路径）或 "default"（串行路径）。
_error_book_var: ContextVar[Optional[Dict[str, str]]] = ContextVar(
    "sliderule_generate_error_book", default=None
)


def _error_book() -> Dict[str, str]:
    """拿到本请求的错误簿；没有就建一个并绑上去。

    懒建而不是在请求入口建：这个模块有一堆入口（评测脚本、测试、直接调
    generate_five_system_model），要求每个入口都记得初始化必然会漏，
    漏了就退回"读不到任何错误原因"——比串号更难查。
    """
    book = _error_book_var.get()
    if book is None:
        book = {}
        _error_book_var.set(book)
    return book


def _section_label(required_keys: "tuple[str, ...]") -> str:
    """并行 worker 的错误按段归档，别让三个 worker 抢同一个格子。

    并行路径每个 worker 的 required_keys 就是 (section,)，直接拿来当键。
    """
    return required_keys[0] if len(required_keys) == 1 else "default"


def _record_call_error(detail: str, *, section: str = "default") -> None:
    _error_book()[section] = detail


def _read_call_error() -> str:
    """汇总本请求记下的错误。并行路径下多个 section 都失败时逐条列出。"""
    book = _error_book_var.get() or {}
    if not book:
        return ""
    if len(book) == 1:
        return next(iter(book.values()))
    return "；".join(f"{sec}: {msg}" for sec, msg in sorted(book.items()))


def set_generate_delta_sink(sink: "Optional[Callable[[str], None]]") -> None:
    _delta_sink_var.set(sink)


def generate_delta_sink_scope(sink):
    """装了自带卸的写法（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。

    调用方优先用这个，别用上面那个裸 setter——裸 setter 要人肉记得去别处
    补一行卸载，而且卸成 None 而不是还原成原来那个。
    """
    from sliderule_llm.scoped import sink_scope

    return sink_scope(_delta_sink_var, sink)


def get_generate_diagnostic() -> Dict[str, Any]:
    """本请求最近一次生成的诊断。

    从模块属性 `last_generate_diagnostic` 换成访问器（2026-08-06）：属性读法
    在多租户下会读到别的请求的结果。调用方原本写的是
    `from .v5_llm_generate import last_generate_diagnostic as _diag`——那是
    函数内 import，每次拿的是当时的模块属性，正好跨请求串。
    """
    return _diagnostic_var.get() or {}


def set_generate_diagnostic(diag: Optional[Dict[str, Any]]) -> None:
    """给测试/评测脚本用的显式写入口（生产路径由生成函数自己写）。"""
    _diagnostic_var.set(diag)


# 已安装技能 / 连接器的**请求域存储与读侧**已搬到叶子 services.turn_context
# （2026-08-29）。这里只留带注册表的清洗——搬清洗过去会让叶子不再是叶子。
#
# ⚠ 别在这个文件里再补一个同名 ContextVar：setter 写 A、getter 读 B 是
#   **静默失效**（技能注入不生效 / 连接器实体没进 prompt，页面每格填「—」，
#   不报错不告警）。判据见 tests/test_turn_context_leaf.py。
from .turn_context import (  # noqa: F401  （下游按老路径 import，保持可用）
    DEFAULT_SKILL_CHANNEL as _DEFAULT_SKILL_CHANNEL,
    MAX_CONNECTORS as _MAX_CONNECTORS,
    MAX_INSTALLED_SKILLS as _MAX_INSTALLED_SKILLS,
    SKILL_CHANNELS as _SKILL_CHANNELS,
    _clarifications_var,
    _connectors_var,
    _installed_skills_var,
    active_connectors,
    approved_plan_prompt_block,
    clarification_prompt_block,
    connector_prompt_block,
    installed_skills_for_channel,
    set_active_connectors_cleaned as _store_connectors,
    set_clarifications,
    set_approved_plan,
    set_installed_skills_cleaned as _store_installed_skills,
)


def _clean_binding(raw: Any) -> str:
    """把技能声明的绑定形状压成一行 prompt 文案，如 "2 number -> enum"。

    技能目录里的条目不知道目标应用有哪些实体，所以它声明的不是具体字段名，
    而是**形状**：读几个什么类型的字段、写回什么类型的字段。类型取自
    five_system_legal.json 的 fieldTypes 闭集；出现闭集外的类型就整条作废
    （返回空串）——宁可不给形状提示，也不把非法类型喂进 prompt 让模型学歪。
    """
    if not isinstance(raw, dict):
        return ""
    from .schema_legal import FIELD_TYPES

    legal = set(FIELD_TYPES)
    ins = raw.get("inputTypes")
    out = str(raw.get("outputType") or "").strip()
    if not isinstance(ins, list) or not ins or out not in legal:
        return ""
    ins = [str(t).strip() for t in ins]
    if any(t not in legal for t in ins):
        return ""
    return f"{' + '.join(ins)} -> {out}"


# 本轮挂着的连接器（2026-08-25）。跟 _installed_skills 同一请求域模式：
# /drive-full(-stream) 进来时设置、结束必清空。
#
# ⚠ 它跟技能注入**不是同一件事**，别合并：
#   技能给的是"这一页该怎么设计"（影响生成），
#   连接器给的是"这张表的数据从哪来、有哪些字段"（影响运行时填什么）。
#   所以连接器进 prompt 的是一份**逐字段的实体声明**，要求模型原样收录——
#   字段 id 差一个字，生成期取回来的真数据就填不进页面上的孔
#   （derive-binding-source 会老老实实每格填「—」，而 problems 是空的）。
#（`_connectors_var` / `_MAX_CONNECTORS` 在 services.turn_context，见上面那段注释）


def set_active_connectors(connectors: "Optional[List[Dict[str, Any]]]") -> None:
    """设置本轮挂着的连接器（清洗后进 prompt）。传 None / 空即清空。

    ⚠ 只收**后端注册表认识**的连接器 id。前端传什么都照单全收的话，
      模型会为一个根本不存在的数据源建一张表，生成期取不到数，页面上多出
      一张永远空着的表——不报错、不告警。
    """
    cleaned: List[Dict[str, Any]] = []
    try:
        from .connectors import get_connector
    except Exception:
        _store_connectors([])
        return
    for raw in connectors or []:
        cid = ""
        if isinstance(raw, str):
            cid = raw.strip()
        elif isinstance(raw, dict):
            cid = str(raw.get("id") or raw.get("key") or "").strip()
        spec = get_connector(cid) if cid else None
        if not spec or not spec.available():
            continue
        if any(c["id"] == spec.id for c in cleaned):
            continue
        cleaned.append(
            {
                "id": spec.id,
                "name": spec.name,
                "source": spec.source,
                "entity": spec.entity_declaration(),
            }
        )
        if len(cleaned) >= _MAX_CONNECTORS:
            break
    _store_connectors(cleaned)
    # 真机自证：仓里的老办法（"想验证这条还通电，在这行打一句 log"）。
    # 一轮推演要跑十几分钟，事后翻日志比重新加探针便宜得多。
    if cleaned:
        print(
            "[connectors] 本轮挂上 "
            + "、".join(f"{c['id']}→{c['entity']['id']}" for c in cleaned),
            flush=True,
        )


def clarifications_from_state(state: Any) -> List[Dict[str, str]]:
    """从状态里捡出**答过的**澄清问答（resolved 且留了答案的 open_question）。

    ⚠ 只认留了答案的。光把缺口置 resolved 不记答案，等于闸绿了而模型什么也
      没多知道——那正是 2026-08-27 之前澄清"问了等于没问"的形态。
    """
    out: List[Dict[str, str]] = []
    for gap in getattr(state, "coverageGaps", None) or []:
        get = gap.get if isinstance(gap, dict) else lambda k, _g=gap: getattr(_g, k, None)
        if get("kind") != "open_question" or get("status") != "resolved":
            continue
        q = str(get("label") or "").strip()
        a = str(get("answer") or "").strip()
        if q and a:
            out.append({"q": q, "a": a})
    return out


def set_installed_skills(skills: "Optional[List[Dict[str, Any]]]") -> None:
    """设置本轮推演要注入的已安装技能（清洗：上限 6 条，name/description 截断）。

    channel 决定拼进哪个 prompt 块（见 _build_user_content）。未标注或标注了
    未知值的一律按 unbound——宁可不提要求，也不发一条注定绑不上的硬要求。

    传 None / 空列表即清空——无安装时生成 prompt 与历史逐字节一致。
    """
    cleaned: List[Dict[str, str]] = []
    for raw in skills or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:60]
        if not name:
            continue
        channel = str(raw.get("channel") or "").strip()
        if channel not in _SKILL_CHANNELS:
            channel = _DEFAULT_SKILL_CHANNEL
        entry = {
            "name": name,
            "description": str(raw.get("description") or "").strip()[:160],
            "channel": channel,
        }
        binding = _clean_binding(raw.get("binding"))
        if binding:
            entry["binding"] = binding
        cleaned.append(entry)
        if len(cleaned) >= _MAX_INSTALLED_SKILLS:
            break
    _store_installed_skills(cleaned)


# E29 增量迭代：精修/回退上下文（与 _installed_skills 同一请求域模式）。
# refine：带当前模型 + 补充指令，让 LLM 在现有设计上做增量修改；
# override：直接以给定模型为生成结果（版本回退用，不调 LLM）。
#
# 2026-07-27 并发修复（迭代体验审查 D4）：此前是模块级普通全局——E25 后台
# run 用 asyncio.create_task 并发驱动多会话时，A 会话的精修上下文/直供模型
# 会被 B 会话读到、B 的 finally 会清掉 A 正在用的上下文，最坏情况 A 的应用
# 被换成 B 的模型（跨会话数据泄露）。改 ContextVar：asyncio 任务创建/线程
# 池调用都会拷贝上下文,每个 run 天然隔离,setter/getter API 不变。
from contextvars import ContextVar

_refine_context_var: "ContextVar[Optional[Dict[str, Any]]]" = ContextVar(
    "sliderule_refine_context", default=None
)
_model_override_var: "ContextVar[Optional[Dict[str, Any]]]" = ContextVar(
    "sliderule_model_override", default=None
)


def set_refine_context(
    model: "Optional[Dict[str, Any]]",
    instruction: str = "",
    pages: "Optional[Dict[str, Any]]" = None,
) -> None:
    """设置本轮精修上下文：现有五系统模型 + 用户补充指令 + 上一版页面 HTML。

    传 None 清空。

    pages（2026-08-17 加）：上一版的 `{pageId: html}`，来自 `state.specFirstPages`。
    给按需重画用——指令没点到的页面**原样照搬，不进 LLM**（见
    services/refine_page_scope.py）。⚠ 它是**可选**的：取不到就退回全量重画，
    也就是这条参数出现之前的行为，不许因为缺它就把精修打死。
    """
    _refine_context_var.set(
        {
            "model": model,
            "instruction": str(instruction or "").strip()[:2000],
            "pages": pages if isinstance(pages, dict) else None,
        }
        if model
        else None
    )


def get_refine_context() -> "Optional[Dict[str, Any]]":
    return _refine_context_var.get()


def set_model_override(model: "Optional[Dict[str, Any]]") -> None:
    """设置模型直供（版本回退）：生成层原样返回该模型，不调 LLM；
    结构闸照常校验。传 None 清空。"""
    _model_override_var.set(model if isinstance(model, dict) else None)


def get_model_override() -> "Optional[Dict[str, Any]]":
    return _model_override_var.get()


def _emit_delta(chunk: str) -> None:
    sink = _delta_sink_var.get()
    if sink is None:
        return
    try:
        sink(chunk)
    except Exception:
        pass

# _default_llm_json_fn 内部最近一次调用失败的原因（LlmError / 异常文本）。


def _build_user_content(
    goal: str,
    *,
    final_instruction: str = "Produce the five-system JSON now.",
) -> str:
    """用户消息装配：意图 + （命中时）业界参考技能块。

    参考块来自宽松协议开源技能语料（v5_skill_reference，技能库二期）——
    只给命名与输入输出风格的 few-shot 氛围，明确指示不复制内容；
    语料缺失或与意图无关时不加块，prompt 与从前逐字节一致。
    """
    parts = [f"Business intent:\n{goal}"]
    # ①已安装技能（硬要求）：仅 aigc 通道。每项必须落成一条 aigc.capabilities，
    # 字段绑定到真实 datamodel 实体字段——门禁仍然硬校验，绑不上会被拦（不豁免）。
    bound = installed_skills_for_channel("aigc")
    if bound:
        lines = [
            "User-installed skills (REQUIRED: for EACH one below, include a matching "
            "entry in aigc.capabilities with inputFields/outputField bound to real "
            "datamodel entity fields of this app):"
        ]
        for skill in bound:
            desc = f" — {skill['description']}" if skill["description"] else ""
            # 形状提示（inputFields/outputField 各该是什么类型的字段）：技能
            # 目录里声明的是形状不是字段名，模型据此去这个应用的 datamodel
            # 里挑真实字段，比让它凭描述硬猜准得多。
            shape = f" [field shape: {skill['binding']}]" if skill.get("binding") else ""
            lines.append(f"- {skill['name']}{desc}{shape}")
        parts.append("\n".join(lines))
    # ①a 本轮挂着的连接器（硬要求）：实体声明必须原样收录，见
    # connector_prompt_block 的注释——字段 id 差一个字，真数据就填不进孔。
    conn_block = connector_prompt_block()
    if conn_block:
        parts.append(conn_block)
    # ①a2 开工前用户答过的澄清（硬约束）：问过就得算数，见
    # clarification_prompt_block 的注释——不带这块，澄清就只是让用户多点几下。
    clarify_block = clarification_prompt_block()
    if clarify_block:
        parts.append(clarify_block)
    plan_block = approved_plan_prompt_block()
    if plan_block:
        parts.append(plan_block)
    # ①b 未验证绑定的已安装技能（软参考）：明确写"不要为它硬造能力卡"。
    # 从前它们跟上面混在一条 REQUIRED 里，模型只能二选一——要么编一个绑不上
    # 的能力被门禁拦，要么硬塞进无关实体。两种都比不提要求更糟。
    unbound = installed_skills_for_channel("unbound")
    if unbound:
        lines = [
            "User-installed skills (context only — do NOT invent an aigc.capabilities "
            "entry for these; include one ONLY if it genuinely binds to real entity "
            "fields of this app):"
        ]
        for skill in unbound:
            desc = f" — {skill['description']}" if skill["description"] else ""
            lines.append(f"- {skill['name']}{desc}")
        parts.append("\n".join(lines))
    # experience 通道不进这条 prompt：活路径是风格段
    #（design_language.experience_skill_constraint），不当种子色。
    # ②业界参考技能（软参考）：只借命名与 IO 风格
    try:
        from .v5_skill_reference import reference_prompt_block

        block = reference_prompt_block(goal)
        if block:
            parts.append(block)
    except Exception:
        pass  # 参考语料是增强项，任何异常都不拦生成主路径
    # ③设计菜谱（E40.3 软参考）：按域命中的导航/开门页/组件/主题气质配方
    #（owner 视觉稿蒸馏冻结语料）——只给风格灵感，门照常裁决，无命中零变化
    try:
        from .v5_design_reference import design_reference_block

        design_block = design_reference_block(goal)
        if design_block:
            parts.append(design_block)
    except Exception:
        pass
    # E29 精修：把现有模型与补充指令给到 LLM——在现有设计上做最小增量修改，
    # 与设计无关的指令要求原样返回（版本判等后不记新版本）。
    refine_ctx = get_refine_context()
    if refine_ctx:
        import json as _json

        try:
            model_json = _json.dumps(refine_ctx["model"], ensure_ascii=False)
        except (TypeError, ValueError):
            model_json = "{}"
        parts.append(
            "REFINE MODE — an approved five-system model for this app already "
            "exists. Apply the user's follow-up instruction as a MINIMAL "
            "incremental edit on top of it.\n"
            f"Current model JSON:\n{model_json}\n"
            f"Follow-up instruction:\n{refine_ctx['instruction']}"
        )
        # ⚠ 精修模式下**换掉收尾那句**（2026-08-16 线上实测）。
        #
        # 默认收尾是 "Produce the complete SystemContract JSON now."——它跟上面
        # 那段 "return the current model unchanged / keep byte-identical" 直接
        # 打架，而且它在**最后**。LLM 对末尾指令权重最高，于是照着"产出完整的"
        # 干，把整份模型重写一遍。
        #
        # 真机证据（sr-20260816113435）：用户只说「预警消息中心的消息流没有
        # 数据」，产出的 mv-2 **六段指纹全变**，一段没留；菜单从
        # 「守望地图首页/预警消息中心/拐杖参数配置页」换成
        # 「监护实时看护舱/志愿者接单大厅/安全与硬件设置页」——**用户提的那
        # 一页直接不存在了**。
        #
        # 这跟 build_design_system_prompt_block 当初那个是同一个形状：约束被埋
        # 在中间，后面的话把它盖掉。那次的修法是把契约挪到最后并写明"冲突时
        # 以这一节为准"，这里同理——但不动块顺序（顺序会影响别的分支），
        # 只把最后一句换成不打架的措辞。
        # ★ 只要补丁，不要整份（2026-08-16 晚，RFC 7386）。
        #
        # 上一版这里要的是"完整模型，但只改一处"——线上干净复测
        # （sr-20260816201658）证明这条路到头了：菜单保住了 3/3，**六段指纹仍
        # 然全变**，包括跟指令毫不相干的 workflow / rbac，而那轮指令里明写着
        # 「其他页面不要动」。
        #
        # 换成要 Merge Patch：模型**只被允许输出要改的那部分**，其余由代码从基线
        # 合并。没提到的段想变也变不了——从"求它自觉"变成"结构上做不到"。
        #
        # 模型不配合、还是吐了整份时：合并等价于整份替换，行为退化成修复前，
        # **不会更糟**（见 merge_patch.looks_like_full_model 的说明）。
        final_instruction = (
            "Return a JSON Merge Patch (RFC 7386) against the current model "
            "above — NOT the full model. Include ONLY the keys you need to "
            "change; every key you omit keeps its current value automatically. "
            "Keep the same nesting shape as the model (top-level keys are "
            "datamodel / workflow / rbac / page / aigc / appbundle; include a "
            "top-level key ONLY if the instruction requires changing inside it). "
            "Arrays are replaced wholesale, so when you touch an array include "
            "all of its items. Output the patch object only."
        )
    parts.append(final_instruction)
    return "\n\n".join(parts)


def _structured_llm_json_fn(messages: list) -> Optional[Dict[str, Any]]:
    """P3 结构化通道（instructor 错误回喂）：校验失败把「上次输出+具体报错」
    拼回消息让模型自我修正——替代盲重采样。失败返回 None（调用方回落/留痕）。"""
    try:
        from sliderule_llm.structured import (
            StructuredLlmError,
            structured_llm_enabled,
            structured_llm_json,
        )
    except Exception:
        return None
    if not structured_llm_enabled():
        return None
    try:
        parsed = structured_llm_json(
            messages,
            required_keys=_REQUIRED_SECTIONS,
            temperature=0.2,
            max_tokens=default_max_tokens(),
            max_retries=2,
        )
        return parsed if isinstance(parsed, dict) else None
    except StructuredLlmError as exc:
        print(f"[v5_llm_generate] structured channel failed: {str(exc)[:200]}")
        _record_call_error(f"structured: {str(exc)[:160]}")
        return None


def _parallel_json_call(
    messages: list[dict[str, str]],
    required_keys: tuple[str, ...],
    max_tokens: int | None,
) -> Optional[Dict[str, Any]]:
    """Structured, non-streaming worker call used by the bounded model DAG.

    Raw token deltas from concurrent JSON workers cannot be interleaved into one
    valid preview stream. Progress is exposed through the per-node timing/SSE
    stages instead; the final assembled model still follows the existing stream.
    """
    effective_max_tokens = wider_output_budget(max_tokens, default_max_tokens())
    try:
        from sliderule_llm.structured import (
            StructuredLlmError,
            structured_llm_enabled,
            structured_llm_json,
        )

        if structured_llm_enabled():
            try:
                return structured_llm_json(
                    messages,
                    required_keys=required_keys,
                    temperature=0.2,
                    max_tokens=effective_max_tokens,
                    max_retries=1,
                )
            except StructuredLlmError as exc:
                _record_call_error(f"structured: {str(exc)[:160]}", section=_section_label(required_keys))
    except Exception:
        pass

    try:
        from sliderule_llm.client import call_llm_json_with_shape

        parsed, _result = call_llm_json_with_shape(
            messages,
            required_keys=required_keys,
            max_shape_retries=1,
            temperature=0.2,
            max_tokens=effective_max_tokens,
            backoff_ms=2000,
            on_delta=None,
        )
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:  # noqa: BLE001
        _record_call_error(f"{type(exc).__name__}: {str(exc)[:160]}", section=_section_label(required_keys))
        return None


def _default_llm_json_fn(goal: str, gate_feedback: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Real LLM path — provider chain + JSON shape validation. None on any failure.

    P3（OSS_GAP_ANALYSIS）双通道互为救场：
    - 无流式 sink（后台驱动/评测）：结构化通道优先（错误回喂重试，治
      推理模型空正文/形状失败——F2 评测两模式闭环全 0 的元凶），失败回落旧通道；
    - 有流式 sink（交互 UI 要 llm_delta 直播）：旧流式通道优先保直播，
      失败用结构化通道救场（少看一段直播，换回一个能用的模型）。
    """
    _error_book().clear()
    try:
        from sliderule_llm.client import call_llm_json_with_shape, LlmError
    except Exception as exc:
        _record_call_error(f"llm client unavailable: {str(exc)[:160]}")
        return None
    user_content = _build_user_content(goal)
    if gate_feedback:
        # E37 门裁决回喂：上一版模型被结构门拦截时，把门的具体 findings
        # 原文喂回（错哪改哪）——比盲重试命中率高一个量级，与 P3 的
        # JSON 形状回喂互补（那层治缺段，这层治悬空引用/枚举违规）。
        user_content += (
            "\n\nIMPORTANT — your previous model FAILED the deterministic structural "
            "gate. Fix EXACTLY these violations and keep everything else unchanged:\n"
            + gate_feedback
        )
    messages = [
        {"role": "system", "content": schema_instruction_for(goal)},
        {"role": "user", "content": user_content},
    ]
    streaming = _delta_sink_var.get() is not None
    if not streaming:
        parsed = _structured_llm_json_fn(messages)
        if parsed is not None:
            return parsed
    try:
        parsed, _result = call_llm_json_with_shape(
            messages,
            required_keys=_REQUIRED_SECTIONS,
            max_shape_retries=1,
            temperature=0.2,
            # 多链路 + 不变式后契约变大（原 4000 面向单链路模型）；截断会直接
            # 变成 shape 失败 → 重试 → fail-closed，宁可放宽。
            # 推理模型还要再放宽一截——思考和正文共用这个预算（见 config.DEFAULT_MAX_TOKENS）。
            max_tokens=default_max_tokens(),
            # 瞬时错误（网关 502/503/超时）退避拉长：默认 200ms 扛不过几秒级
            # 的网关抖动（线上案例：blackaicoding 502 连吃三发）。
            backoff_ms=2000,
            # sink 已注册时走流式：内容增量实时推给 UI（llm_delta）。
            on_delta=_emit_delta if _delta_sink_var.get() is not None else None,
        )
        return parsed if isinstance(parsed, dict) else None
    except LlmError as exc:
        # No key / rate limit / parse failure / shape failure — 流式主路失败先试
        # 结构化通道救场，救不回再 fail-closed 留痕。
        # 展示层人话化：剥 HTML 错误页、5xx 标注瞬时故障（不改 fail-closed 语义）。
        if streaming:
            rescued = _structured_llm_json_fn(messages)
            if rescued is not None:
                print("[v5_llm_generate] legacy stream failed; structured channel rescued")
                return rescued
        from services.llm_error_text import humanize_llm_error

        _record_call_error(f"LlmError: {humanize_llm_error(str(exc))[:180]}")
        print(f"[v5_llm_generate] LlmError: {str(exc)[:200]}")
        return None
    except Exception as exc:  # noqa: BLE001
        _record_call_error(f"{type(exc).__name__}: {str(exc)[:180]}")
        print(f"[v5_llm_generate] unexpected error: {str(exc)[:200]}")
        return None


def _refine_merge_patch_enabled() -> bool:
    """默认开。留开关是因为它改的是生成契约本身，线上出事要能一条环境变量退回。

    ⚠ 2026-08-29：原来这里是 `默认 "1"` 配 `in ("1","true","yes","on")` ——
      **默认开，却拿"开"的词表解析**。拼错一个字母（`ture` / `enable`）落到
      else，这根应急闸就**把自己静静地扳掉了**，不报错不打日志。
      收进 env_flags.flag 之后：认不出来的值回落到声明的默认（True），并喊一声。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_MERGE_PATCH", default=True)


def _apply_refine_patch(model: "Optional[Dict[str, Any]]") -> "Optional[Dict[str, Any]]":
    """精修模式：把 LLM 交回的补丁合并回基线；非精修原样放行。

    三条防线，任何一条不成立都退回"原样返回"，绝不把一次能跑的生成搞崩：
      · 没开开关 / 不在精修模式 / 拿不到基线 → 原样
      · 模型无视要求吐了整份（六段齐全）→ 合并等价整份替换，行为同修复前
      · 合并本身抛异常 → 原样（这是优化，不是必经之路）
    """
    if not isinstance(model, dict) or not model:
        return model
    if not _refine_merge_patch_enabled():
        return model
    ctx = get_refine_context()
    base = (ctx or {}).get("model") if isinstance(ctx, dict) else None
    if not isinstance(base, dict) or not base:
        return model
    try:
        from .merge_patch import looks_like_full_model, merge_patch, patch_touches

        touched = patch_touches(model)
        if looks_like_full_model(model, _REQUIRED_SECTIONS):
            # ⚠ 六段齐全 = 模型没按补丁交付。这时**不能合并**。
            #
            # 写这段时我一度以为"合并等价于整份替换，退化成修复前"，测试当场
            # 打脸：Merge Patch 是**递归**合并，整份补丁会跟基线逐键混合，
            # 基线里那些新版本本该丢掉的键会留下来——拿到的是缝合怪，
            # 比整份替换更糟。
            #
            # 所以这里按整份走，行为与修复前一致：不配合就优雅降级，不发明
            # 一个两者都不是的第三种东西。
            print(f"[v5_llm_generate] 精修：模型交回整份（六段齐全），按整份处理不合并")
            return model
        merged = merge_patch(base, model)
        kept = [s for s in _REQUIRED_SECTIONS if s not in touched]
        print(
            f"[v5_llm_generate] 精修合并（RFC 7386）：补丁动了 {touched}，未触及 {kept}"
        )
        return merged if isinstance(merged, dict) else model
    except Exception as exc:  # noqa: BLE001 — 合并是优化，炸了不能拖垮生成
        print(f"[v5_llm_generate] 精修合并失败，按整份处理：{str(exc)[:160]}")
        return model


def generate_five_system_model(
    goal: str,
    *,
    llm_json_fn: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    gate_feedback: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Generate a five-system model candidate for `goal`.

    Returns the raw model dict (NOT yet gated) or None if generation is
    unavailable/failed. The caller MUST run it through
    v5_model_gate.validate_five_system_model before trusting it.

    `llm_json_fn(goal) -> dict|None` is injectable for tests (fake LLM),
    keeping generality proof decoupled from LLM reliability.

    `gate_feedback`（E37）：上一版模型的结构门裁决文本。只作用于默认 LLM
    通道（注入 fn 的测试路径不受影响）——喂回后 LLM 定向改错重生成。
    """
    _diagnostic_var.set({})
    if not (goal or "").strip():
        return None
    # E29 版本回退：直供模型即生成结果（结构闸仍由调用方照常执行）
    model_override = get_model_override()
    if model_override is not None:
        _diagnostic_var.set({"outcome": "ok"})
        return dict(model_override)
    use_parallel = False
    if llm_json_fn is None and not gate_feedback and get_refine_context() is None:
        try:
            from .v5_parallel_generate import parallel_generation_enabled

            use_parallel = parallel_generation_enabled()
        except Exception:
            use_parallel = False
    if use_parallel:
        from .v5_parallel_generate import generate_parallel_five_system_model

        fn = lambda g: generate_parallel_five_system_model(
            g,
            user_context=_build_user_content(
                g,
                final_instruction="Produce the complete SystemContract JSON now.",
            ),
            call_json=_parallel_json_call,
        )
    elif llm_json_fn is None and gate_feedback:
        fn: Callable[[str], Optional[Dict[str, Any]]] = (
            lambda g: _default_llm_json_fn(g, gate_feedback=gate_feedback)
        )
    else:
        fn = llm_json_fn or _default_llm_json_fn
    # 一次有界重试：并发/限流下的瞬时失败不该直接变成永久 publish blocked
    # （fail-closed 语义保留：两次都失败仍返回 None）。注入 fn 的测试不受影响。
    # Each parallel node already has transport/shape retries. Re-running the
    # complete DAG here would repeat every successful section and defeat the
    # section-level repair path in the caller.
    attempts = 1 if use_parallel else (2 if llm_json_fn is None else 1)
    last_detail = ""
    # 埋点范围是**整个重试循环**，不是单次 fn(goal)（2026-08-05）。
    #
    # 对着屏幕等的人要知道的是"建模这件事进行到哪了"，不是"这是第几次调用"。
    # 一次失败重试在 SSE 上应该表现为同一个阶段耗时更长，而不是同一条步骤
    # 闪两遍——后者看着像出错了。真正的失败次数走日志与下面的 used 字段。
    #
    # ⚠ `attempts` 打的是**上面那行算出来的预算**，不是这一趟试了几次：不管
    # 成功失败它恒等于 1 或 2。实际次数是成功分支里写的 `_st["used"]`。
    # 2026-08-11 有人把日志里的 `attempts=2` 读成"每趟都重试了一次"，据此推断
    # "每次生成白花一倍时间"并去查根因，而同一行的 `used=1` 一直写着答案
    # （七趟全是 1，都是一次成功）。两个字段挨着打、名字又都像次数，很容易读反
    # ——enrich_timing.py 的模块头为此专门加了一段。
    stage_name = "model.regenerate" if gate_feedback else "model.generate"
    with _enrich_stage(stage_name, attempts=attempts, current=1, total=1) as _st:
        for attempt in range(attempts):
            try:
                model = fn(goal)
            except Exception as exc:  # noqa: BLE001
                print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} raised: {str(exc)[:200]}")
                last_detail = f"{type(exc).__name__}: {str(exc)[:180]}"
                model = None
            # ★ 精修模式下，LLM 交回的是**补丁**，在这里合并回基线（RFC 7386）。
            #   放在完整性校验之前：补丁只含一两段，直接过校验必然判"缺段"。
            #   合并之后拿到的是完整模型，后面的闸一条都不用改。
            model = _apply_refine_patch(model)
            if isinstance(model, dict) and all(section in model for section in _REQUIRED_SECTIONS):
                _diagnostic_var.set({"outcome": "ok"})
                _st["used"] = attempt + 1
                return model
            if model is not None:
                print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} returned incomplete model (missing sections)")
                last_detail = "LLM 返回的模型缺少必需的五系统段"
            else:
                print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} returned no model")
                last_detail = _read_call_error() or last_detail or "LLM 未返回模型"
            if attempt + 1 < attempts:
                import time as _time

                _time.sleep(2.0)
        _st["used"] = attempts
    _diagnostic_var.set({"outcome": "failed", "detail": last_detail})
    return None


def model_to_linkage_artifacts(model: Dict[str, Any], goal: str) -> List[Dict[str, Any]]:
    """Convert a gate-passed model into per-skill artifacts the closure evidence
    builder can match (id contains the skill key, so _build_per_skill_evidence
    picks them up). Deterministic; no LLM.

    The gate-PASSED model section rides along twice:
      - `_model_section` — structured payload consumed by _build_per_skill_evidence
        (becomes perSkillEvidence[skill].modelSection and the skill_result SSE field);
      - a fenced ```json block inside `content` so the section survives as plain
        artifact text too (the client parser reads fenced JSON from rawContent).
    Both are PAYLOAD ONLY: evidence matching hashes only id/title/kind/summary and
    the closure hash never includes them, so they cannot flip trust decisions.
    """
    import json as _json

    artifacts: List[Dict[str, Any]] = []
    for skill in _REQUIRED_SECTIONS:
        section = model.get(skill)
        summary = f"LLM-generated {skill} model for: {goal[:60]}"
        section_block = ""
        if section is not None:
            try:
                section_block = (
                    "\n\n```json\n"
                    + _json.dumps({skill: section}, ensure_ascii=False)
                    + "\n```"
                )
            except (TypeError, ValueError):
                section_block = ""  # unserializable payload — keep the artifact text-only
        artifacts.append({
            "id": f"llm-linkage-{skill}",
            "title": f"{skill} model (LLM generate)",
            "kind": "runtimeClosureEvidence",
            "summary": summary,
            "content": f"{skill} section of LLM-generated five-system model{section_block}",
            "provenance": "python-llm-generate",
            "_model_section": section,
        })
    return artifacts
