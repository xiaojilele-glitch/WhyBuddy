"""注册前干跑：真引擎 + 桩 host。

抄 grok-build `xai-workflow` `validate.rs`：

    extract_meta → 起一条桩 host 线程（match SpawnAgent / Scratch / Budget …）
    → run_workflow(真引擎, 空 journal, 桩 host) → Completed/Paused 过，Failed 拒

WhyBuddy 没有 Rhai / HostRequest 通道。日历是 `WorkflowPreset.tools` →
`expand_tools` → `run_spec_first`。LLM 客户端就是 host：桩打在
`call_llm_json` / `call_llm_with_retry` / `call_llm`，**按请求种类分发罐头**
（spec JSON / HTML / 结构 / 语义 / 绑定），和 grok 的 `match req` 同一件事。
html / 生图 / bind_pages 保持真实现——那是引擎，不是 host。

⚠ 2026-09-02 第一版只走 spec/pages，结构请求也喂 spec 罐头，
  `HtmlStructureError` 之后就把 walk 裁掉。那不是 grok：grok 干跑走完整
  脚本。缺 assemble 靠闭包检查能拦住，但 `structure-bind` 这种日历引擎
  一步都没跑到。这一版 host 按种类回复，日历整段走。

⚠ 叶子 `workflow_registry` 不许 import 本模块。
"""

from __future__ import annotations

import copy
import json
import re
from contextlib import contextmanager
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple
from unittest.mock import patch

import sliderule_llm.client as _llm_client
from services.capability_plan import expand_tools
from services.spec_first_pipeline import SpecFirstError, run_spec_first, take_last_pages
from services.workflow_journal import Journal, journal_scope
from services.workflow_registry import (
    WorkflowPreset,
    register_workflow,
    workflow_for,
    workflow_names,
)


class WorkflowDryRunError(ValueError):
    """这份日历干跑跑不通，不许注册。对照 grok `ValidationError::Run`。"""


@dataclass(frozen=True)
class ValidationReport:
    """对照 grok `ValidationReport`。"""

    name: str
    phases: int
    outcome_ok: bool
    outcome_summary: str


_CANNED_SPEC: Dict[str, Any] = {
    "rootNodeId": "n0",
    "version": 3,
    "appName": "干跑校验",
    "personas": [
        {"id": "u1", "name": "管理员", "goals": ["看清待办"]},
        {"id": "u2", "name": "经办人", "goals": ["提交一单"]},
    ],
    "successCriteria": [
        {"id": "sc1", "text": "经办人可在 2 分钟内完成一次提交。"},
        {"id": "sc2", "text": "管理员能查看当日待办数量。"},
    ],
    "nodes": [
        {
            "id": "n0",
            "parentId": None,
            "type": "requirement",
            "title": "提供提交闭环",
            "acceptance": "当经办人提交表单时，系统应生成记录并分配初始状态。",
            "coversCriteria": ["sc1"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n1",
            "parentId": "n0",
            "type": "requirement",
            "title": "按状态统计待办",
            "acceptance": "当管理员打开总览页时，系统应展示当日待办数量。",
            "coversCriteria": ["sc2"],
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n2",
            "parentId": "n0",
            "type": "design",
            "title": "提交表单",
            "notes": "入口打开表单，必填说明，保存后回到列表。",
            "evidenceRefs": ["nE1"],
        },
        {
            "id": "n3",
            "parentId": "n2",
            "type": "task",
            "title": "定义数据模型",
            "verify": "提交后能在列表看到新记录。",
        },
        {
            "id": "nE1",
            "parentId": "n0",
            "type": "evidence",
            "title": "用户要求待办系统",
            "source": "user_input:干跑校验",
        },
    ],
    "pages": [
        {
            "id": "p1",
            "name": "工单工作台",
            "audience": "管理员",
            "purpose": "一眼看到当日待办。",
            "coversNodes": ["n1"],
        },
        {
            "id": "p2",
            "name": "工单详情",
            "audience": "经办人",
            "purpose": "填写说明并提交一单。",
            "coversNodes": ["n0", "n2"],
        },
    ],
}

#: 画面上的原文必须覆盖结构罐头的每一条 evidence（grounding 会回查）。
_CANNED_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<script src="https://cdn.tailwindcss.com"></script>
<title>工单工作台</title>
</head>
<body class="bg-slate-50">
<aside><nav>
<a href="#">工单工作台</a>
<a href="#">设备台账</a>
</nav></aside>
<header>顶栏</header>
<main>
<h1>工单工作台</h1>
<table>
<thead><tr>
<th>工单编号</th><th>设备</th><th>报修时间</th><th>状态</th>
</tr></thead>
<tbody><tr><td>WO-1</td><td>空压机</td><td>20XX-01-01</td><td>待处理</td></tr></tbody>
</table>
<h2>工单详情</h2>
<label>故障描述</label>
<label>设备编号</label>
<p>AI 备注</p>
</main>
</body>
</html>
"""

_CANNED_BOUND_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<script src="https://cdn.tailwindcss.com"></script>
<title>工单工作台</title>
</head>
<body class="bg-slate-50">
<aside><nav>工单工作台</nav></aside>
<main>
<h1>工单工作台</h1>
<table data-rows="work_order">
<thead><tr><th>工单编号</th><th>状态</th></tr></thead>
<tbody>
<tr><td data-field="order_no">WO-1</td><td data-field="status">待处理</td></tr>
</tbody>
</table>
<div data-record="work_order"><span data-field="fault_desc">故障描述</span></div>
<p>报修时间</p>
<p>AI 备注</p>
</main>
</body>
</html>
"""

_CANNED_SEMANTICS: Dict[str, Any] = {
    "version": "spec-semantics-v1",
    "roles": [
        {"id": "manager", "name": "管理员", "personaRef": "u1"},
        {"id": "clerk", "name": "经办人", "personaRef": "u2"},
    ],
    "permissions": [
        "work_order:create",
        "work_order:read",
    ],
    "rolePermissions": {
        "manager": ["work_order:read"],
        "clerk": ["work_order:create", "work_order:read"],
    },
    "workflowNodes": [
        {"id": "received", "name": "已提交", "assigneeRole": "clerk", "phase": "提交"},
        {"id": "listed", "name": "已处理", "assigneeRole": "manager", "phase": "处理"},
    ],
    "workflowTransitions": [
        {"from": "received", "to": "listed", "condition": "处理完成"},
    ],
    "invariants": [
        {
            "id": "order_has_equip",
            "statement": "工单必须关联设备。",
            "systems": ["datamodel"],
            "refs": ["work_order"],
        }
    ],
}

_ENGINE_TOOLS = ("spec", "pages", "structure", "bind")
_PAGE_MARK = re.compile(r"—— 页面 ([^\s—]+) ——")


def default_probe_args() -> Dict[str, Any]:
    """对照 grok `default_probe_args`：给不自带 spec/pages 的日历垫上一跳产物。"""
    spec = copy.deepcopy(_CANNED_SPEC)
    pages = {
        str(page["id"]): _CANNED_HTML
        for page in spec.get("pages") or []
        if isinstance(page, dict) and page.get("id")
    }
    return {
        "goal": "干跑校验",
        "spec": spec,
        "pages": pages,
    }


def _infer_tools(stages: Tuple[str, ...]) -> Tuple[str, ...]:
    seen = set(stages)
    tools: List[str] = []
    if "specfirst.spec" in seen:
        tools.append("spec")
    if "specfirst.pages" in seen:
        tools.append("pages")
    if "specfirst.structure" in seen or "specfirst.assemble" in seen:
        tools.append("structure")
    if "specfirst.bind" in seen:
        tools.append("bind")
    return tuple(tools)


def required_stages_for(preset: WorkflowPreset) -> Tuple[str, ...]:
    tools = tuple(preset.tools) if preset.tools else _infer_tools(tuple(preset.stages))
    if not tools:
        return ()
    return expand_tools(tools)


def _joined(messages: Any) -> str:
    parts: List[str] = []
    for item in messages or []:
        if isinstance(item, dict):
            parts.append(str(item.get("content") or ""))
        else:
            parts.append(str(item))
    return "\n".join(parts)


def _host_kind(text: str) -> str:
    """对照 grok `match req`：看这一跳 host 调用是哪种。"""
    lower = text.lower()
    if "绑定词汇" in text or "只往标签上加" in text:
        return "bind_html"
    if "html-structure-v1" in text or "sourcePageId" in text:
        return "structure"
    if "fieldBindings" in text or "aigcCapabilities" in text:
        return "assemble"
    if "personaRef" in text or "assigneeRole" in text or "spec-semantics" in text:
        return "semantics"
    if (
        "tailwind" in lower
        or "cdn.tailwindcss.com" in lower
        or "front-end" in lower
    ):
        return "html"
    if "stylebrief" in lower.replace(" ", "") or (
        "密度" in text and "逐页" in text
    ):
        return "style"
    return "spec"


def _structure_payload(page_ids: Sequence[str]) -> Dict[str, Any]:
    ids = [str(item).strip() for item in page_ids if str(item).strip()] or ["p1", "p2"]
    pages = [
        {
            "id": "work_order_board",
            "name": "工单工作台",
            "kind": "workbench",
            "sourcePageId": ids[0],
            "sections": ["筛选栏", "工单表格"],
            "evidence": "工单工作台",
        }
    ]
    for index, page_id in enumerate(ids[1:], start=1):
        pages.append(
            {
                "id": f"work_order_page_{index}",
                "name": "工单详情",
                "kind": "workbench",
                "sourcePageId": page_id,
                "sections": ["基础信息"],
                "evidence": "工单详情",
            }
        )
    return {
        "version": "html-structure-v1",
        "entities": [
            {
                "id": "work_order",
                "name": "报修工单",
                "evidence": "工单工作台",
                "fields": [
                    {
                        "id": "order_no",
                        "name": "工单编号",
                        "type": "string",
                        "evidence": "工单编号",
                    },
                    {
                        "id": "reported_at",
                        "name": "报修时间",
                        "type": "date",
                        "evidence": "报修时间",
                    },
                    {
                        "id": "status",
                        "name": "状态",
                        "type": "enum",
                        "evidence": "状态",
                    },
                    {
                        "id": "fault_desc",
                        "name": "故障描述",
                        "type": "text",
                        "evidence": "故障描述",
                    },
                    {
                        "id": "ai_note",
                        "name": "AI 备注",
                        "type": "text",
                        "evidence": "AI 备注",
                    },
                ],
            },
        ],
        "pages": pages,
    }


def _bindings_payload(page_ids: Sequence[str]) -> Dict[str, Any]:
    ids = [str(item).strip() for item in page_ids if str(item).strip()] or [
        "work_order_board"
    ]
    page_bindings = []
    workflow_bindings = []
    for index, page_id in enumerate(ids):
        page_bindings.append(
            {
                "pageId": page_id,
                "fieldBindings": ["work_order.order_no", "work_order.status"],
                "actionPermissions": ["work_order:read"],
            }
        )
        workflow_bindings.append(
            {
                "pageRef": page_id,
                "workflowRef": "received" if index == 0 else "listed",
            }
        )
    return {
        "pageBindings": page_bindings,
        "menus": [
            {
                "id": "m1",
                "label": "工单",
                "roleRefs": ["manager"],
                "permissionRefs": ["work_order:read"],
            }
        ],
        "aigcCapabilities": [
            {
                "id": "note_hint",
                "name": "备注建议",
                "inputFields": ["work_order.order_no"],
                "outputField": "work_order.ai_note",
                "roleRefs": ["manager"],
            }
        ],
        "workflowPageBindings": workflow_bindings,
    }


class _StubHost:
    """对照 grok validate.rs 里那条桩 host 线程：记住这一趟的页面 id。"""

    def __init__(self) -> None:
        self.structure_page_ids: List[str] = ["work_order_board"]

    def json(self, messages, **_kw):
        text = _joined(messages)
        kind = _host_kind(text)
        if kind == "structure":
            page_ids = _PAGE_MARK.findall(text) or ["p1", "p2"]
            payload = _structure_payload(page_ids)
            self.structure_page_ids = [str(page["id"]) for page in payload["pages"]]
            return copy.deepcopy(payload)
        if kind == "semantics":
            return copy.deepcopy(_CANNED_SEMANTICS)
        if kind == "assemble":
            return copy.deepcopy(_bindings_payload(self.structure_page_ids))
        if kind == "style":
            return {
                "density": "comfortable",
                "pages": {
                    "p1": {"tone": "calm"},
                    "p2": {"tone": "calm"},
                },
            }
        if kind == "html":
            return {"html": _CANNED_HTML}
        return copy.deepcopy(_CANNED_SPEC)

    def chat(self, messages, **_kw):
        text = _joined(messages)
        kind = _host_kind(text)
        if kind == "bind_html":
            return SimpleNamespace(content=_CANNED_BOUND_HTML)
        if kind == "html":
            return SimpleNamespace(content=_CANNED_HTML)
        payload = self.json(messages)
        return SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))


@contextmanager
def stub_llm_host() -> Iterator[_StubHost]:
    """只桩 LLM 调用口。html 生成器 / bind_pages 保持真实现。"""
    host = _StubHost()

    def json_for_client(messages, **kw):
        return host.json(messages, **kw), None

    with (
        patch.object(_llm_client, "call_llm_json", json_for_client),
        patch.object(_llm_client, "call_llm_with_retry", host.chat),
        patch.object(_llm_client, "call_llm", host.chat),
    ):
        yield host


def _declared_tools(preset: WorkflowPreset) -> List[str]:
    if preset.tools:
        return [str(item) for item in preset.tools]
    return list(_infer_tools(tuple(preset.stages)))


def dry_run_workflow(preset: WorkflowPreset) -> ValidationReport:
    """这份日历能不能跑。跑不通抛 WorkflowDryRunError，不许注册。

    对照 grok `validate_script`：
      1. 合同（expand_tools ⊆ stages）——WhyBuddy 的 extract_meta；
      2. 真引擎 + 桩 host + 空 journal 整段走；
      3. Completed → ValidationReport；Failed → Run 错误。
    """
    required = required_stages_for(preset)
    if required:
        missing = [stage for stage in required if stage not in preset.stages]
        if missing:
            raise WorkflowDryRunError(
                f"workflow {preset.name} 跑不通：缺 {', '.join(missing)}"
            )
    declared = _declared_tools(preset)
    walk = [name for name in declared if name in _ENGINE_TOOLS]
    if not walk:
        return ValidationReport(
            name=preset.name,
            phases=len(preset.stages),
            outcome_ok=True,
            outcome_summary="completed: no engine hops",
        )
    probe = default_probe_args()
    kwargs: Dict[str, Any] = {
        "preferred_device": "desktop",
        "tools": walk,
        "workflow": preset.name,
        "llm_json_fn": None,
    }
    if "spec" not in walk:
        kwargs["reuse_spec"] = probe["spec"]
    if "pages" not in walk:
        kwargs["reuse_pages"] = probe["pages"]
    try:
        with stub_llm_host() as host, journal_scope(Journal()):
            kwargs["llm_json_fn"] = host.json
            run_spec_first(probe["goal"], **kwargs)
    except WorkflowDryRunError:
        raise
    except Exception as exc:
        raise WorkflowDryRunError(
            f"workflow {preset.name} 干跑失败：{exc}"
        ) from exc
    finally:
        take_last_pages()
    return ValidationReport(
        name=preset.name,
        phases=len(preset.stages),
        outcome_ok=True,
        outcome_summary="completed: stub host",
    )


def register_validated_workflow(preset: WorkflowPreset, *, replace: bool = False) -> None:
    """host 注册口：先干跑，再交给叶子注册表。"""
    dry_run_workflow(preset)
    register_workflow(preset, replace=replace)


def dry_run_registered_calendars() -> None:
    """装配根启动自检：注册表里每一份日历都要干跑过。"""
    import sys

    if "pytest" in sys.modules:
        return
    for name in workflow_names():
        dry_run_workflow(workflow_for(name))
