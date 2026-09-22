"""第 6 步：把前五步的产物汇合成完整五系统模型，过结构闸。

## 这一步在链路里的位置

    1 澄清+缺口+证据      ✅ 现成能力
    2 起草 SPEC           ✅ services/spec_tree.py
    3 spec 每页 → HTML    ✅ services/spec_page_html.py
  3.5 外壳统一            ✅ services/page_shell.py
    4 HTML → 结构         ✅ services/html_structure.py
    5 结构+SPEC → 语义    ✅ services/spec_semantics.py
    6 **本文件**：汇合 → 五系统模型 → 结构闸 → 交给设计段

## 它不是纯拼装

结构闸要六段齐全（datamodel / rbac / workflow / page / aigc / appbundle），
而前五步只产出了其中的一部分。缺的四样是**跨系统的绑定**：

    page.pages[].fieldBindings      这一页显示哪些 实体.字段
    page.pages[].actionPermissions  这一页的操作要哪些权限
    rbac.menus                      哪个角色看得到哪个菜单
    aigc.capabilities               AI 能力吃哪些字段、写回哪个字段
    appbundle.pageBindings          页面 ↔ 工作流

## 分工：能机械拼的一律机械拼

只有上面那五样需要判断，其余全是搬运：

    机械（零 LLM）  datamodel / rbac.roles / rbac.permissions / workflow /
                   page 的 id·name·kind / appbundle 的 roleRefs·dataModelRefs·
                   landingPageRef·preferredDevice·appIdentity·invariants
    要判断（1 次）  上面那五样绑定

这样切的理由：**每多一样交给模型，就多一处会编的地方**。而这一步的词汇表
已经全部封闭了——实体、字段、页面、角色、权限、工作流节点都在前五步定死并
校验过，所以模型只能在既有 id 里挑，编不出新的，闸也验得了。

## 抄了什么

⚠ **绑定推导这件事没有开源可抄。** 查过 amis（百度）和 Formily（阿里）——
它们都是**消费** JSON schema 的渲染器，schema 是人写的；没有一个是从数据模型
反推页面绑定的。这跟 docs/绑定契约草案-v1.md 第六节查到的一致
（那批字段清单驱动的项目全是 JSON 驱动，没有一个做这一步）。所以这里
写清是自研，不假称有出处。

**照抄的是仓里自己的一条：结构闸裁决回喂（E37）。**
`generate_five_system_model(goal, gate_feedback=...)` 早就在这么干——把
闸的 findings 原文喂回去、有界重生成一次、两版都拦仍然 fail-closed。
这一步同理：闸报什么就回喂什么，不自己另发明一套错误话术。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

MODEL_ASSEMBLY_VERSION = "model-assembly-v1"


class ModelAssemblyError(RuntimeError):
    """汇合失败。**不回落**——一份过不了闸的模型往下走，只会在更远的地方炸。"""


# ── 机械段：零 LLM，纯搬运 ─────────────────────────────────────────────


from .spec_llm_call import call_spec_json

#: 实体/字段 id 的合法形状。跟 html_structure._ID_RE 同一条——连接器声明的 id
#: 也得过这一关，不然补进去的东西过不了结构闸，等于把炸点往后挪一步。
_CONN_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def merge_connector_entities(datamodel: Dict[str, Any]) -> List[str]:
    """把本轮挂着的连接器实体**确定性地**补进 datamodel。返回补了哪些实体 id。

    ## 为什么要有这一步（2026-08-29 真机撞出来）

    挂了 weather 连接器跑一轮（sr-conn-180152），产出的 datamodel 是
    `camp_site / activity_schedule / schedule_conflict`——**`weather_daily` 不在里面**。
    页面倒是叫 `weather_calendar` / `weather_reschedule_center`，看着像成了。

    翻 SSE 逐段看，病灶是**连接器块接在了不产 datamodel 的那一步**：

        specfirst.spec       连接器块在这里（spec_tree.build_spec_prompt）
                             → SPEC 树里确实提到了 weather_daily，但那是**散文**
        specfirst.structure  datamodel 从这里来（html_structure.derive_structure），
                             它是**从生成好的 HTML 反推**结构，提示词里没有连接器块
        → 于是实体从来没被建出来

    仓里第一条的原形：接在不通电的插座上。而且四条既有判据
    （`test_connectors_reach_the_live_path.py`）全绿——它们只验到「块进了
    prompt」为止，没有任何一条验「实体活到了模型里」。**正向判据齐全、反向
    判据缺失**（第三条）。

    ## 为什么是补录，不是再给模型加一句要求

    第 4 步的全部纪律是「只记 HTML 里真有的，臆造的剪掉」。往它的提示词里塞
    一句"这个实体你必须收录"，等于给臆造开同一道门。

    而连接器实体是**已经逐字声明好的**（id / name / 字段 id / 类型都在注册表里），
    根本不需要任何模型去"抄"一遍——让模型抄一份我们已经有的东西，只是多一处
    会抄错的地方。所以这里零 LLM 直接搬，跟 `assemble_mechanical` 同一条原则。

    ## ⚠ 三个坑

    1. **不许重复。** 同 id 已经在了就往里补缺的字段，不新增第二条——
       重复 id 过不了结构闸。
    2. **类型必须在合法域里。** 注册表哪天声明了闭集外的类型，宁可丢掉那个
       字段也不能喂进模型（同 `_clean_binding` 的取舍）。
    3. **补在 `_vocabulary` 之前。** 绑定层只能在词汇表里挑；补晚了实体虽然在，
       页面却绑不上它，运行时照样每格填「—」——那正是这条要治的病本身。
    """
    from .schema_legal import FIELD_TYPES
    from .turn_context import active_connectors

    conns = active_connectors()
    if not conns:
        return []
    legal = set(FIELD_TYPES)
    entities = datamodel.setdefault("entities", [])
    by_id = {str(e.get("id") or ""): e for e in entities if isinstance(e, dict)}
    added: List[str] = []
    for conn in conns:
        decl = (conn or {}).get("entity") or {}
        eid = str(decl.get("id") or "").strip()
        if not eid or not _CONN_ID_RE.match(eid):
            print(f"[model_assembly] 连接器实体 id 不合法，跳过：{eid!r}")
            continue
        fields = []
        for f in decl.get("fields") or []:
            fid = str((f or {}).get("id") or "").strip()
            ftype = str((f or {}).get("type") or "string").strip()
            if not fid or not _CONN_ID_RE.match(fid) or ftype not in legal:
                continue
            fields.append({"id": fid, "name": str(f.get("name") or fid), "type": ftype})
        if not fields:
            continue
        target = by_id.get(eid)
        if target is None:
            entities.append(
                {"id": eid, "name": str(decl.get("name") or eid), "fields": fields}
            )
            by_id[eid] = entities[-1]
            added.append(eid)
            continue
        have = {str(f.get("id") or "") for f in target.get("fields") or []}
        missing = [f for f in fields if f["id"] not in have]
        if missing:
            target.setdefault("fields", []).extend(missing)
            added.append(eid)
    if added:
        # 真机自证：跟 set_active_connectors 那行 log 同一条老办法。
        print(f"[model_assembly] 连接器实体补录：{'、'.join(added)}", flush=True)
    return added


def assemble_mechanical(
    structure: Dict[str, Any],
    semantics: Dict[str, Any],
    spec: Dict[str, Any],
) -> Dict[str, Any]:
    """把前五步已经定死的东西搬进六段骨架，绑定那一层留空。

    这里一个判断都不做——搬运出错是能被 diff 出来的，判断出错不能。
    """
    from .html_structure import HtmlStructure, to_datamodel
    from .spec_semantics import SpecSemantics, to_model_sections

    st = structure if isinstance(structure, HtmlStructure) else HtmlStructure.model_validate(structure)
    sem = semantics if isinstance(semantics, SpecSemantics) else SpecSemantics.model_validate(semantics)
    sections = to_model_sections(sem)

    pages = [
        {
            "id": p.id,
            "name": p.name,
            "kind": p.kind,
            "fieldBindings": [],       # ← 绑定层填
            "actionPermissions": [],   # ← 绑定层填
        }
        for p in st.pages
    ]
    datamodel = to_datamodel(st)
    # ⚠ 必须在 entity_ids / _vocabulary 之前：绑定层只能在词汇表里挑，
    #   补晚了实体在、页面却绑不上它，运行时照样每格填「—」（见函数头第 3 坑）。
    try:
        merge_connector_entities(datamodel)
    except Exception as exc:  # noqa: BLE001 — 补录是确定性搬运，出错只可能是 bug；
        # 不许因为它把整轮推演打死，但**必须吵**，别静静地少一张表。
        print(f"[model_assembly] 连接器实体补录失败（本轮少了这些表）：{exc}", flush=True)
    entity_ids = [str(e.get("id") or "") for e in datamodel.get("entities") or []]
    role_ids = [r.id for r in sem.roles]

    return {
        "datamodel": datamodel,
        "rbac": {**sections["rbac"], "menus": []},   # ← 绑定层填
        "workflow": {"id": "main_flow", "name": "主流程", **sections["workflow"]},
        "page": {"pages": pages},
        "aigc": {"capabilities": []},                # ← 绑定层填
        "appbundle": {
            "pageBindings": [],                      # ← 绑定层填
            "landingPageRef": pages[0]["id"] if pages else "",
            "preferredDevice": "desktop",
            "roleRefs": role_ids,
            "dataModelRefs": entity_ids,
            "appIdentity": {"appName": str(spec.get("appName") or "").strip()},
            "invariants": sections["invariants"],
        },
    }


def _vocabulary(model: Dict[str, Any]) -> Dict[str, List[str]]:
    """把模型里已经定死的 id 摊成词汇表，喂给绑定层当"只能用这些"。"""
    fields = [
        f"{e['id']}.{f['id']}"
        for e in model["datamodel"]["entities"]
        for f in e["fields"]
    ]
    return {
        "fields": fields,
        "pages": [p["id"] for p in model["page"]["pages"]],
        "roles": [r["id"] for r in model["rbac"]["roles"]],
        "permissions": list(model["rbac"]["permissions"]),
        "workflowNodes": [n["id"] for n in model["workflow"]["nodes"]],
    }


# ── 绑定层：一次 LLM，词汇表全封闭 ──────────────────────────────────────

_SYSTEM = (
    "你在给一个已经定好的应用补跨系统绑定关系。只输出一个 JSON 对象，"
    "不要解释、不要 markdown 围栏。"
)


def build_binding_prompt(model: Dict[str, Any], gate_feedback: str = "") -> List[Dict[str, str]]:
    import json as _json

    vocab = _vocabulary(model)
    pages_brief = "\n".join(
        f"- {p['id']}（{p['kind']}）{p['name']}" for p in model["page"]["pages"]
    )
    feedback = ""
    if gate_feedback.strip():
        # 闸的裁决原文回喂——照 E37 那条既有做法，不自己另写一套错误话术。
        feedback = (
            f"\n\n⚠ 上一版被结构闸拦下了，findings 原文如下。**只改这些地方**：\n"
            f"{gate_feedback.strip()}\n"
        )

    body = f"""下面这个应用的实体、字段、页面、角色、权限、工作流**都已经定死了**。
请只补它们之间的绑定关系。

页面：
{pages_brief}

**只能用下面这些 id，一个都不许新造**：
{_json.dumps(vocab, ensure_ascii=False, indent=1)}

输出这个形状：

{{
  "pageBindings": [
    {{"pageId": "<页面id>",
      "fieldBindings": ["<实体id>.<字段id>"],
      "actionPermissions": ["<权限>"]}}
  ],
  "menus": [
    {{"id": "<菜单id>", "label": "<菜单名>",
      "roleRefs": ["<角色id>"], "permissionRefs": ["<权限>"]}}
  ],
  "aigcCapabilities": [
    {{"id": "<能力id>", "name": "<能力名>",
      "inputFields": ["<实体id>.<字段id>"], "outputField": "<实体id>.<字段id>",
      "roleRefs": ["<角色id>"]}}
  ],
  "workflowPageBindings": [
    {{"pageRef": "<页面id>", "workflowRef": "<工作流节点id 或 main_flow>"}}
  ]
}}

硬性要求：

1. **每一个页面都要出现在 pageBindings 里**，一个都不许少。
2. fieldBindings 只能从上面 fields 里挑；actionPermissions 只能从 permissions 里挑。
   挑不到合适的就给空数组，**不要造一个看着像的**。
3. menus 至少一条，roleRefs / permissionRefs 都必须是上面列过的。
4. aigcCapabilities 至少一条。inputFields 和 outputField 都必须是真实字段，
   且 **outputField 不能出现在 inputFields 里**（自己写自己没有意义）。
5. workflowPageBindings 的 workflowRef 只能是工作流节点 id 或 "main_flow"。
{feedback}"""
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}]


def apply_bindings(model: Dict[str, Any], bindings: Dict[str, Any]) -> Dict[str, Any]:
    """把绑定层的产出灌回六段骨架。原地不改，返回新的一份。"""
    import copy

    # ⚠ 两侧都要 deepcopy。
    #
    # 头一版只 deepcopy 了 model，绑定那几段用的是 `list(...)`——那只复制外层
    # 列表，**里面的 dict 还是调用方那几个对象**。后果不是"多占内存"，是
    # **调用方之后改自己的 bindings，模型会跟着变**（写测试时当场撞到：一个
    # 用例改了 aigc 的 inputFields，后面所有用例都跟着坏，坏因还完全看不出来）。
    #
    # 汇合这一步的产物要交给下游设计段，中途被别处改掉是最难查的一类问题。
    out = copy.deepcopy(model)
    src = copy.deepcopy(bindings)
    by_page = {str(b.get("pageId") or ""): b for b in (src.get("pageBindings") or [])}
    for page in out["page"]["pages"]:
        b = by_page.get(page["id"]) or {}
        page["fieldBindings"] = list(b.get("fieldBindings") or [])
        page["actionPermissions"] = list(b.get("actionPermissions") or [])
    out["rbac"]["menus"] = list(src.get("menus") or [])
    out["aigc"]["capabilities"] = list(src.get("aigcCapabilities") or [])
    out["appbundle"]["pageBindings"] = list(src.get("workflowPageBindings") or [])
    return out


def check_bindings_closed(model: Dict[str, Any]) -> List[Dict[str, str]]:
    """绑定层是不是只用了既有 id。

    结构闸也查一部分（fieldBindings / actionPermissions / assigneeRole），
    但**它不查 aigc 的 outputField 自环、也不查每页是不是都被绑定过**。
    这两条是这一步自己该守的：

      · outputField 出现在 inputFields 里 = 拿一个字段算它自己，是句废话
      · 有页面没进 pageBindings = 那一页没有任何数据，界面上是空的
        （跟第 4 步那条"整页被丢"同型——**东西少了、闸却绿**）
    """
    vocab = _vocabulary(model)
    fields, perms = set(vocab["fields"]), set(vocab["permissions"])
    roles, nodes = set(vocab["roles"]), set(vocab["workflowNodes"]) | {"main_flow"}
    problems: List[Dict[str, str]] = []

    bound_pages = set()
    for page in model["page"]["pages"]:
        bound_pages.add(page["id"])
        for fb in page.get("fieldBindings") or []:
            if fb not in fields:
                problems.append({"path": f"page.pages[{page['id']}].fieldBindings",
                                 "message": f"'{fb}' 不是真实字段"})
        for ap in page.get("actionPermissions") or []:
            if ap not in perms:
                problems.append({"path": f"page.pages[{page['id']}].actionPermissions",
                                 "message": f"'{ap}' 不在权限清单里"})
        if not (page.get("fieldBindings") or page.get("actionPermissions")):
            problems.append({
                "path": f"page.pages[{page['id']}]",
                "message": "既没有 fieldBindings 也没有 actionPermissions——"
                           "这一页在界面上会是空的",
            })

    for menu in model["rbac"].get("menus") or []:
        for r in menu.get("roleRefs") or []:
            if r not in roles:
                problems.append({"path": f"rbac.menus[{menu.get('id')}].roleRefs",
                                 "message": f"'{r}' 不是已声明的角色"})
        for p in menu.get("permissionRefs") or []:
            if p not in perms:
                problems.append({"path": f"rbac.menus[{menu.get('id')}].permissionRefs",
                                 "message": f"'{p}' 不在权限清单里"})

    for cap in model["aigc"].get("capabilities") or []:
        ins = list(cap.get("inputFields") or [])
        out_f = str(cap.get("outputField") or "")
        for fld in ins + ([out_f] if out_f else []):
            if fld not in fields:
                problems.append({"path": f"aigc.capabilities[{cap.get('id')}]",
                                 "message": f"'{fld}' 不是真实字段"})
        if out_f and out_f in ins:
            problems.append({
                "path": f"aigc.capabilities[{cap.get('id')}].outputField",
                "message": f"'{out_f}' 同时出现在 inputFields 里——拿一个字段算它自己是句废话",
            })

    for pb in model["appbundle"].get("pageBindings") or []:
        if str(pb.get("pageRef")) not in bound_pages:
            problems.append({"path": "appbundle.pageBindings",
                             "message": f"pageRef '{pb.get('pageRef')}' 不是已有页面"})
        if str(pb.get("workflowRef")) not in nodes:
            problems.append({"path": "appbundle.pageBindings",
                             "message": f"workflowRef '{pb.get('workflowRef')}' 不是工作流节点"})
    return problems


def ensure_wizard_workflow_refs(model: Dict[str, Any]) -> List[str]:
    """机械补向导页的 workflowRef。对照 rustc --fix / TypeScript codefix：
    闸认得的洞，先自己补，再问模型。

    ⚠ 2026-08-19 安康随访通：装配重问第 1 次
    `page.pages[p2].kind：wizard page must be bound…`，随后自己恢复。
    活路径是本文件的 assemble 循环，**不是** GEN5 的 v5_model_repair——
    那边对向导拒绝编 ref，改那边等于没改（纪律一）。

    fail-closed：只在 `main_flow` 已在闸的合法域，或合法域里只剩一个 id
    时才补。两个流程且没有 main_flow → 不猜，留给闸重问。
    合法域复用 `v5_model_gate._collect_workflow_ids`，不另造第二份。
    """
    from .v5_model_gate import _collect_workflow_ids

    legal = _collect_workflow_ids(model.get("workflow") or {})
    if "main_flow" in legal:
        pick = "main_flow"
    elif len(legal) == 1:
        pick = next(iter(legal))
    else:
        return []

    appbundle = model.setdefault("appbundle", {})
    bindings = list(appbundle.get("pageBindings") or [])
    by_page: Dict[str, int] = {}
    for i, pb in enumerate(bindings):
        pref = str((pb or {}).get("pageRef") or "").strip()
        if pref:
            by_page[pref] = i

    stamped: List[str] = []
    for page in (model.get("page") or {}).get("pages") or []:
        if str((page or {}).get("kind") or "").strip() != "wizard":
            continue
        pid = str((page or {}).get("id") or (page or {}).get("name") or "").strip()
        if not pid:
            continue
        idx = by_page.get(pid)
        if idx is None:
            bindings.append({"pageRef": pid, "workflowRef": pick})
            by_page[pid] = len(bindings) - 1
            stamped.append(pid)
            continue
        existing = str((bindings[idx] or {}).get("workflowRef") or "").strip()
        if existing and existing in legal:
            continue
        bindings[idx] = {**(bindings[idx] or {}), "workflowRef": pick}
        stamped.append(pid)
    appbundle["pageBindings"] = bindings
    return stamped


def assemble(
    structure: Dict[str, Any],
    semantics: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Callable[[List[Dict[str, str]]], Optional[Dict[str, Any]]]] = None,
    max_reask: int = 2,
) -> Dict[str, Any]:
    """汇合成完整五系统模型并过闸。过不了就把**闸的裁决原文**回喂重来。

    返回 {"model": {...}, "gate": {"passed": True, "findings": []}}。
    """
    from .v5_model_gate import validate_five_system_model

    skeleton = assemble_mechanical(structure, semantics, spec)
    feedback = ""
    last = "未调用"

    for attempt in range(max_reask + 1):
        outcome = call_spec_json(
            build_binding_prompt(skeleton, feedback), llm_json_fn, stage="specfirst.assemble"
        )
        payload = outcome.payload
        if payload is None:
            last = outcome.failure or "LLM 没有返回可解析的 JSON"
            # 传输/配额层挂了：没拿到东西、没有可喂回去的内容，而且下层
            # call_llm_with_retry 已经退避重试过了。再转两圈是纯浪费。
            if outcome.transport:
                break
        else:
            model = apply_bindings(skeleton, payload)
            ensure_wizard_workflow_refs(model)
            own = check_bindings_closed(model)
            gate = validate_five_system_model(
                model,
                require_landing_page_ref=True,
                require_preferred_device=True,
                # 新链路的交付物是第 3 步那份 HTML，页面长什么样由 HTML 决定。
                # kanban/calendar 的 statusField/dateField 是老渲染器的输入需求，
                # 这条链路上没有任何消费者——拿它拦住整条链只会回落老路。
                # ⚠ 只关「必须存在」；给了仍然必须指到真字段（见闸里那段注释）。
                require_page_kind_contract=False,
            )
            if not own and gate["passed"]:
                return {"model": model, "gate": gate}
            last = "；".join(
                [f"{p['path']}：{p['message']}" for p in own[:6]]
                + [f"{f.get('path')}：{f.get('message')}" for f in (gate["findings"] or [])[:6]]
            )
        if attempt == max_reask:
            break
        # ⚠ 重问必须留痕（2026-08-16 补）。真机一趟这里花了 82.6s，
        #   而平常 9~12s——**日志里一个字都没有**，查不出重问过几次、为什么。
        #   慢 8 倍却说不出原因，等于这一步对运维是黑的。
        print(
            f"[model_assembly] 过不了闸，重问第 {attempt + 1} 次："
            f"{last[:200]}"
        )
        feedback = last

    raise ModelAssemblyError(f"汇合后过不了闸（重问 {max_reask} 次后）：{last}")


