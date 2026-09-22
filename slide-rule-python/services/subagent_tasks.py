# -*- coding: utf-8 -*-
"""只读子代理账本（2026-09-04 阶段 3）。

抄 grok 四件套的**结构**，不抄自由体：

  spawn  → spawn_readonly_task
  output → get_task_output
  kill   → kill_task
  monitor → list_running_tasks

子代理是已有读能力的封装，不是第二个主 Agent。写侧（spec/pages/structure
/bind/closure / runtimeClosure）不许走这条路——那会撞上 specFirstPages
整份替换。失败 fail-open：记 error，不改主链路 picks / 闭环结论。
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

#: 模型可派的只读种类 → 封装哪件已有能力。page_quality 不调执行器，
#: 只读 specFirstPages 出一份检查报告。
READONLY_KINDS: Dict[str, Optional[str]] = {
    "evidence": "evidence.search",
    "compliance": "evidence.search",
    "page_quality": None,
}

#: 写侧。spawn 见到这些直接拒绝。含公开 hop 和信封。
WRITE_BLOCKED: frozenset[str] = frozenset(
    {
        "spec",
        "pages",
        "structure",
        "bind",
        "closure",
        "refine",
        "repair",
        "rehearse",
        "appbundle.runtimeclosure",
        "factory.spec",
        "factory.pages",
        "factory.structure",
        "factory.bind",
        "factory.closure",
    }
)


def clip_task_requests(raw: Any) -> Tuple[Dict[str, str], ...]:
    """从 LLM JSON 里收只读派工。写侧 / 生词丢掉，不让主链路跟着炸。"""
    if not isinstance(raw, list):
        return ()
    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or item.get("kind") or "").strip()
        if kind in WRITE_BLOCKED or kind not in READONLY_KINDS:
            continue
        if kind in seen:
            continue
        seen.add(kind)
        prompt = str(item.get("prompt") or item.get("description") or "").strip()
        out.append({"type": kind, "prompt": prompt[:500]})
        if len(out) >= 3:
            break
    return tuple(out)


def _tasks(state: Any) -> List[Dict[str, Any]]:
    raw = getattr(state, "subagentTasks", None)
    if isinstance(raw, list):
        return [t for t in raw if isinstance(t, dict)]
    return []


def list_tasks(state: Any) -> Tuple[Dict[str, Any], ...]:
    """monitor：全账本只读快照。"""
    return tuple(dict(t) for t in _tasks(state))


def list_running_tasks(state: Any) -> Tuple[Dict[str, Any], ...]:
    return tuple(t for t in list_tasks(state) if t.get("status") == "running")


def get_task_output(state: Any, task_id: str) -> Optional[Dict[str, Any]]:
    want = str(task_id or "").strip()
    if not want:
        return None
    for item in _tasks(state):
        if str(item.get("id") or "") == want:
            return dict(item)
    return None


def spawn_readonly_task(
    state: Any,
    kind: str,
    prompt: str = "",
    *,
    task_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """派一只只读子代理。写侧种类返回 None，不进账。"""
    name = str(kind or "").strip()
    if name in WRITE_BLOCKED or name not in READONLY_KINDS:
        return None
    tasks = list(_tasks(state))
    n = len(tasks) + 1
    rec = {
        "id": str(task_id or f"sub-{name}-{n}"),
        "type": name,
        "capabilityId": READONLY_KINDS[name],
        "prompt": str(prompt or "")[:500],
        "status": "running",
        "content": "",
        "error": "",
    }
    tasks.append(rec)
    state.subagentTasks = tasks
    return dict(rec)


def record_task_result(
    state: Any,
    task_id: str,
    *,
    ok: bool,
    content: str = "",
    error: str = "",
) -> Optional[Dict[str, Any]]:
    want = str(task_id or "").strip()
    tasks = list(_tasks(state))
    for item in tasks:
        if str(item.get("id") or "") != want:
            continue
        if item.get("status") == "cancelled":
            state.subagentTasks = tasks
            return dict(item)
        item["status"] = "ok" if ok else "error"
        item["content"] = str(content or "")[:4000]
        item["error"] = str(error or "")[:500]
        state.subagentTasks = tasks
        return dict(item)
    return None


def kill_task(state: Any, task_id: str) -> bool:
    """停一只还在跑的。已经 ok/error 的不动。"""
    want = str(task_id or "").strip()
    tasks = list(_tasks(state))
    for item in tasks:
        if str(item.get("id") or "") != want:
            continue
        if item.get("status") != "running":
            return False
        item["status"] = "cancelled"
        item["error"] = "killed"
        state.subagentTasks = tasks
        return True
    return False


def page_quality_report(state: Any) -> str:
    """page_quality 子代理：只读页面袋，不写回。"""
    blob = getattr(state, "specFirstPages", None)
    if not isinstance(blob, dict):
        return "还没有页面。"
    pages = blob.get("pages")
    n = len(pages) if isinstance(pages, dict) else 0
    bound = blob.get("boundPages")
    return f"页面 {n} 张，boundPages={bound if bound is not None else '未知'}。"


def digest_lines(state: Any) -> Tuple[str, ...]:
    """给下一跳规划读。没任务就空——不许伪造一条取料。"""
    lines: List[str] = []
    for item in _tasks(state):
        kind = str(item.get("type") or "")
        status = str(item.get("status") or "")
        if status == "ok":
            snippet = str(item.get("content") or "").replace("\n", " ")[:160]
            lines.append(f"{kind}: {snippet or '完成'}")
        elif status == "error":
            lines.append(f"{kind}: 失败（{str(item.get('error') or '')[:80]}）")
        elif status == "cancelled":
            lines.append(f"{kind}: 已停")
    return tuple(lines)
