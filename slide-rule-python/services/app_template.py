# -*- coding: utf-8 -*-
"""应用级模板 —— **骨架，不是成品**（2026-08-11）。

## 这一版要取代什么

在这之前，「匹配行业直接用模板」这件事在代码里是有的，叫**内置演示域**
（`builtin_domain_models.json` + `DOMAIN_INTENT_MARKERS`）：说一句「请假」就
命中 `leave_approval`，原样吐出一份写死的五系统模型，一次 LLM 都不调。

它有两个病，都是"写死"这个形态本身带来的：

**病一：写死的那份已经过期了。** 量过：4 个演示域的页面里连 `blocks` 这个键
都不存在，`stats` / `charts` 也是空的——它们是 page.blocks 上线**之前**冻结的。
所以命中演示域，用户拿到的是几个光秃秃的表格页，目录里 359 个区块一个都用不上。
而生成提示词里自己写着：

    A workbench / kanban / calendar / wizard page that ships with NO blocks
    renders as a bare table — that is an incomplete deliverable.

**快路径产出的，正是契约自己定义为「残次交付」的那个东西。**

**病二：写死的东西装不下用户的题。** 2026-08-04 实测事故：「给中小学课后托管
做家长请假申请」因为「请假」二字命中 `leave_approval`，套上企业请假样板，
学生 / 班次 / 签到 / 账单一个没做。当时的补救是加一道相关性复核把它挡掉——
那是在给一个方向错的机制打补丁。

## 所以骨架存什么、不存什么

    存                                    不存（每次按指令生成）
    ────────────────────────────────────  ──────────────────────────────
    industry / name / when                实体 id、实体名、字段
    pages[]: kind + purpose               binding.entityRef、任何 *FieldRef
    pages[].blocks[]: type + region       契约（bindingSchema 在目录里）
    roleShape: 大致几类角色                权限矩阵
    workflowShape: 有没有审批、几步        流程节点的具体名字

一句话：**骨架只回答「这个行业的应用长什么样」，不回答「你这道题的实体叫什么」。**

不存的那几样各有硬理由：

  · **契约** —— `bindingSchema` / `allowedRegions` / `family` 已经在区块目录里，
    骨架再抄一份就是第二份会漂的副本。这个仓库刚为此付过账：
    `BLOCK_DEFINITIONS.uses` 就是那样一份手写副本，316 个区块全部与实际渲染
    不符（84 条声称了没渲染、974 条渲染了没声称），最后整个删掉。
  · **区块↔基础组件的关系** —— 从渲染器 AST 生成（block-component-usage.json），
    骨架碰都不碰。
  · **绑定** —— 见下面 `_assert_no_bindings`，这是本模块最该守的不变式。

## 校验为什么复用 `block_placement_problem`

「这个区块能不能摆在这种页的这个区域」这四条判据，`pageKindPresets` 已经在
问了。同一个问题两份实现，迟早各说各话。所以那边抽成了公共函数，这边直接调。

## 匹配：只有一道尺子，而且默认是「不用」

计划里我写的是「industry 粗筛 + 相关性精判」，实现时发现**粗筛这一步不成立**：
用户交上来的只有一句自然语言目标，我们并不知道它属于哪个行业——知道了就不用
匹配了。所以 industry 留给 UI 分组和人工筛选，匹配只靠 `closure_relevance`
一道。这里如实记下来，免得后来人照着计划去找那个不存在的粗筛。

**默认值是反的，这是故意的。** `goal_coverage` 在样本不足时返回
`applicable=False, passed=True`（放行）——它服务的场景是"别误杀已经生成好的
模型"。套模板是反方向的动作：判不了却套上，等于把别人的应用扣在用户头上。
所以 `match_app_template` 要求 `applicable and passed` 同时成立，判不了就
老老实实生成。演示域时代只有 4 个域，误判影响有限；模板攒到几百条还这么默认，
就是天天套错。

## 接线（2026-08-27）

此前本模块对工厂是死的：契约、种子、单测都在，`match_app_template` 的非测试
引用为零。现在接在 `spec_first_pipeline.run_spec_first` →
`spec_tree.generate_spec_tree` 的骨架先验槽上（页清单 / 区块槽，不是绑定）。
匹配失败 fail-open（无骨架继续），不许 fail-closed 拦推演。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from .closure_relevance import goal_coverage
from .schema_legal import (
    EXPERIENCE_BLOCK_BY_TYPE,
    PAGE_KINDS,
    block_placement_problem,
)

#: 骨架里**绝对不能出现**的键。出现就说明有人把成品塞进了骨架。
#:
#: `*FieldRef` 不在这张表里，靠后缀判（目录里 200 多个字段引用名，枚举必漏）。
_FORBIDDEN_KEYS = frozenset(
    {
        "binding",
        "bindings",
        "entityRef",
        "entityRefs",
        "fieldBindings",
        "entities",
        "datamodel",
        "fields",
        "targets",
    }
)

_MAX_PAGES = 12
"""一套骨架最多几页。真实应用见过 19 页，但那是生成出来的；骨架是**建议**，
超过十来页就不再是"这个行业长什么样"，而是把一整个应用抄了下来。"""


def _assert_no_bindings(node: Any, path: str, problems: List[str]) -> None:
    """递归确认骨架里没有任何绑定痕迹。

    这是本模块的核心不变式：骨架一旦带上 `entityRef: "order"` 这类东西，
    就退化成了旧模板库那个形态——那些绑定指向组件库的订单夹具，丢进任何
    真实话题都会被结构闸的 DANGLING 判据当场拦下。
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if key in _FORBIDDEN_KEYS or key.endswith("FieldRef") or key.endswith("FieldRefs"):
                problems.append(
                    f"{path}.{key}：骨架不许带绑定/实体/字段——那些每次按指令生成"
                )
                continue
            _assert_no_bindings(value, f"{path}.{key}", problems)
    elif isinstance(node, list):
        for index, item in enumerate(node):
            _assert_no_bindings(item, f"{path}[{index}]", problems)


def validate_app_template(raw: Any) -> List[str]:
    """校验一条骨架，返回问题清单（空 = 合格）。

    返回清单而不是抛异常：种子文件要在启动时**一次报全**所有毛病，一条一条
    抛出去修的体验很差；而调用方（存模板的路由）要把问题原样回给用户。
    """
    problems: List[str] = []
    if not isinstance(raw, dict):
        return ["模板必须是对象"]

    for key in ("id", "name", "industry", "when"):
        if not str(raw.get(key) or "").strip():
            problems.append(f"缺 {key}")

    pages = raw.get("pages")
    if not isinstance(pages, list) or not pages:
        problems.append("pages 必须是非空数组")
        pages = []
    elif len(pages) > _MAX_PAGES:
        problems.append(f"pages 有 {len(pages)} 页，超过上限 {_MAX_PAGES}")

    seen_page_ids: set = set()
    for index, page in enumerate(pages):
        where = f"pages[{index}]"
        if not isinstance(page, dict):
            problems.append(f"{where} 不是对象")
            continue
        page_id = str(page.get("id") or "").strip()
        if not page_id:
            problems.append(f"{where} 缺 id")
        elif page_id in seen_page_ids:
            problems.append(f"{where} 重复的页面 id: {page_id}")
        else:
            seen_page_ids.add(page_id)
        kind = str(page.get("kind") or "").strip()
        if kind not in PAGE_KINDS:
            problems.append(f"{where}.kind '{kind}' 不在页面形态目录内（{list(PAGE_KINDS)}）")
        if not str(page.get("purpose") or "").strip():
            # purpose 是骨架里**唯一**能被相关性尺子量到的业务语义（页型和区块
            # 类型都是技术词）。缺了它这一页对匹配毫无贡献。
            problems.append(f"{where} 缺 purpose（这一页是干什么的，一句话）")

        blocks = page.get("blocks")
        if blocks is None:
            continue
        if not isinstance(blocks, list):
            problems.append(f"{where}.blocks 必须是数组（可以省略，但不能是别的类型）")
            continue
        for block_index, item in enumerate(blocks):
            if not isinstance(item, dict):
                problems.append(f"{where}.blocks[{block_index}] 不是对象")
                continue
            block_type = str(item.get("type") or "").strip()
            region = str(item.get("region") or "").strip()
            if region:
                problem = block_placement_problem(block_type, kind, region)
            else:
                # region 可选（见 `_region_of_block` 头注：栅格布局根本没有区域名）。
                # 缺 region 时判据降一档但**不取消**：这个区块至少得能摆在这种页的
                # 某个区域上。否则骨架会推荐一个门禁必拦的组合，而模型照做还查不出
                # 为什么——`pageKindPresets` 的自检当初就是为这个而设的。
                entry = EXPERIENCE_BLOCK_BY_TYPE.get(block_type)
                if entry is None:
                    problem = f"引用了未知区块 {block_type}"
                elif not any(
                    block_placement_problem(block_type, kind, r) is None
                    for r in entry.get("allowedRegions") or []
                ):
                    problem = f"{block_type} 在 {kind} 页上没有任何合法区域"
                else:
                    problem = None
            if problem:
                problems.append(f"{where}.blocks[{block_index}]: {problem}")

    roles = raw.get("roleShape")
    if roles is not None and (
        not isinstance(roles, list) or any(not str(r or "").strip() for r in roles)
    ):
        problems.append("roleShape 必须是非空字符串数组（或整个省略）")

    workflow = raw.get("workflowShape")
    if workflow is not None:
        if not isinstance(workflow, dict):
            problems.append("workflowShape 必须是对象（或整个省略）")
        else:
            steps = workflow.get("steps")
            if steps is not None and (not isinstance(steps, int) or steps < 1):
                problems.append("workflowShape.steps 必须是正整数")

    _assert_no_bindings(raw, "template", problems)
    return problems


def template_terms(template: Dict[str, Any]) -> List[str]:
    """骨架里可以拿来跟目标比对的**业务**词。

    刻意排除页型（workbench/kanban…）和区块类型（DataTable…）：那些是技术词，
    每套骨架都长得差不多，放进去只会把所有模板的相关度一起拉平。
    """
    terms: List[str] = []
    for key in ("name", "industry", "when"):
        value = str(template.get(key) or "").strip()
        if value:
            terms.append(value)
    for page in template.get("pages") or []:
        if isinstance(page, dict):
            purpose = str(page.get("purpose") or "").strip()
            if purpose:
                terms.append(purpose)
    for role in template.get("roleShape") or []:
        value = str(role or "").strip()
        if value:
            terms.append(value)
    return list(dict.fromkeys(terms))


def match_app_template(
    goal: str, templates: Sequence[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """给这道题挑一套骨架；挑不出就返回 None（调用方照常走生成）。

    返回 `{"template": …, "verdict": …}`——verdict 是 `goal_coverage` 那套
    自解释结果（score / threshold / passed / matched / missing / reason），
    留着是为了让"为什么选了它"能被打出来，而不是只给一个模板 id。

    调用方：`spec_first_pipeline.run_spec_first`（2026-08-27 接线）。匹配失败
    返回 None，调用方 fail-open 继续无骨架生成。本函数自己不拿来拦推演；
    调用方也必须 catch——匹配是增强类结构先验，不是证据闸。
    """
    best: Optional[Dict[str, Any]] = None
    for template in templates:
        verdict = goal_coverage(goal, template_terms(template))
        # 见模块头：默认是反的——判不了就不套模板。
        if not (verdict.get("applicable") and verdict.get("passed")):
            continue
        if best is None or float(verdict.get("score") or 0) > float(
            best["verdict"].get("score") or 0
        ):
            best = {"template": template, "verdict": verdict}
    return best


_SEEDS_PATH = Path(__file__).resolve().parent / "data" / "app_template_seeds.json"


def _load_seed_templates() -> tuple:
    """种子骨架 —— **坏骨架在服务启动时直接失败**。

    跟 `_load_page_kind_presets` 同一条纪律，理由也一样：种子是手写的，而它
    引用的每个 (区块, 页型, 区域) 都必须同时满足三件事（放开生成、这种页允许、
    这个槽位允许）。手写的东西会漂，而漂掉之后的失败很难查——模型照着骨架做了，
    却每次都被门禁打回。宁可 fail-fast 在启动期，也不要带病进 Prompt。
    """
    try:
        raw = json.loads(_SEEDS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"app_template_seeds.json 读不出来: {exc}") from exc
    items = raw.get("templates")
    if not isinstance(items, list) or not items:
        raise ValueError("app_template_seeds.json templates 必须是非空数组")

    problems: List[str] = []
    seen: set = set()
    for index, item in enumerate(items):
        tid = str((item or {}).get("id") or "").strip() if isinstance(item, dict) else ""
        where = tid or f"templates[{index}]"
        if tid:
            if tid in seen:
                problems.append(f"{where}: 重复的模板 id")
            seen.add(tid)
        problems.extend(f"{where}: {p}" for p in validate_app_template(item))
    if problems:
        raise ValueError("app_template_seeds.json 有问题：\n  - " + "\n  - ".join(problems))
    return tuple(items)


SEED_APP_TEMPLATES: tuple = _load_seed_templates()


def _region_of_block(layout: Any, block_id: str) -> str:
    """这个区块摆在哪个**命名区域** —— 从 `page.layout` 反查。查不到返回空串。

    生成出来的模型里，区块自己**不带**区域：`page.blocks[]` 只有 id/type/binding，
    位置在 `page.layout` 里记。所以抽骨架必须两边对着看。

    ## 空串不等于"这个区块没位置"（2026-08-11 用第一份真实收割数据修正）

    `layout` 有两种记法，`grid` 那种**根本没有区域名**：

        命名槽位  {"main": ["overview_workflow"], "aside": ["overview_activity"]}
        栅格      {"grid": {"desktop": [{"blockRef": "mute_table", "x":0,"y":0,"w":8,"h":5}, …]}}

    第一份从线上真应用收割的骨架里，7 个页面有 5 个只用了栅格——于是 15 个区块
    被判掉 10 个，**丢掉的恰好是这一趟最值钱的那几个**（AlertTriagePanel、
    AlertRoutingPolicy、MuteTimingSchedule、OnCallScheduleCalendar、
    EscalationPolicyPanel，全是窄化之后才第一次进得来的专用件）。

    栅格给的是 x/y/w/h，区域名**客观上不存在**，不是"没记"。所以正确处置不是
    从坐标猜一个区域（那是发明），而是让骨架的 `region` 变成可选：
    **知道这一页该有什么，不总是知道摆哪个槽位。**
    """
    if not isinstance(layout, dict):
        return ""
    for slot, refs in layout.items():
        if slot in ("grid", "mobile") or not isinstance(refs, list):
            continue
        if any(str(ref).strip() == block_id for ref in refs):
            return str(slot)
    return ""


def _positioned_block_ids(layout: Any) -> set:
    """这一页里**确实被摆上去了**的区块 id —— 命名槽位与栅格都算。

    跟 `_region_of_block` 分开是因为两个问题不同：那个问"摆在哪个区域"，
    这个问"到底摆了没有"。没进任何一种 layout 的区块在真实页面上就是没位置，
    抽进骨架等于凭空给它安一个——那正是"手写预设"的错法。
    """
    ids: set = set()
    if not isinstance(layout, dict):
        return ids
    for slot, refs in layout.items():
        if slot == "grid":
            grid = refs if isinstance(refs, dict) else {}
            for items in grid.values():
                for item in items if isinstance(items, list) else []:
                    ref = str((item or {}).get("blockRef") or "").strip()
                    if ref:
                        ids.add(ref)
        elif isinstance(refs, list):
            ids.update(str(r).strip() for r in refs if str(r).strip())
    return ids


def extract_skeleton(
    model: Any, *, template_id: str, industry: str = "", when: str = ""
) -> Dict[str, Any]:
    """从一份**生成好的五系统模型**里抽骨架。

    ## 为什么是这个方向

    用户校正过的链路（原话）：「基础组件是燃料，区块也是技术燃料。在会话推演的
    时候，先区块，整个应用搞完之后，你才有骨架」——**骨架是沉淀物，不是原料**。
    所以这个函数是这条链的最后一环，也是唯一能产出真骨架的地方。

    种子里那四条是从演示域抠的，而演示域根本没走过"用区块搭应用"这一步（页面里
    连 blocks 键都没有），所以它们是假沉淀，区块清单一片空白。

    ## 抽得出来的和抽不出来的

        抽得出来          从哪
        name              appbundle.appIdentity.productName
        pages[].id/kind   page.pages[]
        pages[].purpose   page.pages[].name
        pages[].blocks    page.blocks[].type + layout 反查区域
        roleShape         rbac.menus[].label
        workflowShape     workflow.nodes 的条数 / phase / 有没有审批

        抽不出来          怎么办
        industry          模型里没有这个概念，调用方给（贡献时用户填）
        when              同上

    抽不出来的那两样正好就是**要用户过目的字段**，跟"勾选贡献时给他看 5 行字"
    那个交互天然对齐：能自动抽的自动抽，要人判断的才问人。

    ## 抽不干净的一律丢掉，并留痕

    模型里的区块可能摆在一个目录后来收紧了的区域，或者用了一个后来关掉生成的
    类型。这种直接丢，丢了记进 `dropped`——照 `block_assembler._validate` 同一
    条纪律：**剔除原因如实回给调用方，不静默吃掉**。留一个过不了自检的骨架进库，
    下次服务就起不来。
    """
    model = model if isinstance(model, dict) else {}
    dropped: List[Dict[str, str]] = []

    identity = ((model.get("appbundle") or {}).get("appIdentity") or {})
    name = str(identity.get("productName") or "").strip() if isinstance(identity, dict) else ""

    pages: List[Dict[str, Any]] = []
    for raw_page in ((model.get("page") or {}).get("pages") or []):
        if not isinstance(raw_page, dict):
            continue
        page_id = str(raw_page.get("id") or "").strip()
        kind = str(raw_page.get("kind") or "").strip()
        if not page_id or kind not in PAGE_KINDS:
            dropped.append({"what": page_id or "<无 id 的页>", "why": f"页面形态 '{kind}' 不在目录内"})
            continue
        layout = raw_page.get("layout")
        positioned = _positioned_block_ids(layout)
        blocks: List[Dict[str, str]] = []
        for raw_block in raw_page.get("blocks") or []:
            if not isinstance(raw_block, dict):
                continue
            block_id = str(raw_block.get("id") or "").strip()
            block_type = str(raw_block.get("type") or "").strip()
            if block_id not in positioned:
                # 命名槽位和栅格都没有它 —— 真实页面上就是没位置，抽进骨架等于
                # 凭空给它安一个，那正是"手写预设"的错法。
                dropped.append({"what": f"{page_id}.{block_type or block_id}", "why": "命名槽位与栅格里都没有它，页面上没有位置"})
                continue
            region = _region_of_block(layout, block_id)
            if region:
                problem = block_placement_problem(block_type, kind, region)
                if problem:
                    dropped.append({"what": f"{page_id}.{block_type}@{region}", "why": problem})
                    continue
                blocks.append({"type": block_type, "region": region})
            else:
                # 栅格布局没有区域名（见 _region_of_block 头注）。收下类型、留空
                # region——知道该有什么，不假装知道摆哪。
                entry = EXPERIENCE_BLOCK_BY_TYPE.get(block_type)
                legal = entry and any(
                    block_placement_problem(block_type, kind, r) is None
                    for r in entry.get("allowedRegions") or []
                )
                if not legal:
                    dropped.append({"what": f"{page_id}.{block_type}", "why": f"{block_type} 在 {kind} 页上没有任何合法区域"})
                    continue
                blocks.append({"type": block_type})
        page: Dict[str, Any] = {
            "id": page_id,
            "kind": kind,
            "purpose": str(raw_page.get("name") or "").strip(),
        }
        if blocks:
            # 同一页里同 type 同 region 只留一条：骨架说的是"这种页该有什么"，
            # 不是"这一页摆了几个"。
            page["blocks"] = [
                dict(item) for item in dict.fromkeys(tuple(sorted(b.items())) for b in blocks)
            ]
        pages.append(page)

    menus = ((model.get("rbac") or {}).get("menus") or [])
    role_shape = [
        str(menu.get("label") or "").strip()
        for menu in menus
        if isinstance(menu, dict) and str(menu.get("label") or "").strip()
    ]

    workflow = model.get("workflow") or {}
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    nodes = nodes if isinstance(nodes, list) else []
    phases = [
        str(node.get("phase") or "").strip()
        for node in nodes
        if isinstance(node, dict) and str(node.get("phase") or "").strip()
    ]
    workflow_shape: Dict[str, Any] = {}
    if nodes:
        workflow_shape["steps"] = len(nodes)
        workflow_shape["hasApproval"] = any(
            any(mark in str(node.get("name") or "") for mark in ("审", "批", "核"))
            for node in nodes
            if isinstance(node, dict)
        )
        if phases:
            workflow_shape["phases"] = list(dict.fromkeys(phases))

    skeleton: Dict[str, Any] = {
        "id": template_id,
        "name": name,
        "industry": industry,
        "when": when,
        "pages": pages,
        "source": "harvested",
    }
    if role_shape:
        skeleton["roleShape"] = list(dict.fromkeys(role_shape))
    if workflow_shape:
        skeleton["workflowShape"] = workflow_shape

    return {
        "skeleton": skeleton,
        "dropped": dropped,
        "problems": validate_app_template(skeleton),
    }


def all_app_templates() -> List[Dict[str, Any]]:
    """当前可用的骨架全集。

    现在只有种子。后面从「用户发布应用时勾选贡献」攒出来的那些会并进这里——
    留这个函数是为了让调用方从第一天起就问"全集"，而不是问"种子"，将来加数据
    来源时不必改调用点。
    """
    return list(SEED_APP_TEMPLATES)
