# -*- coding: utf-8 -*-
"""老师傅自己列的活儿清单。纯函数：吃「旧清单 + 这一笔改动」，吐新清单。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/todo/mod.rs`（`TodoWriteTool`）。
它的工具说明只有两句，两句都要：

    Create and manage a structured task list.
    **The user sees this list live — it is your primary way to show progress.**
    Use for any task with 3+ steps. Skip for trivial single-step work.

──────────────────────────────────────────────────────────────────────────
## 跟 `factoryTodo` 不是一回事，别合并

    factoryTodo   闭集五件套（spec/pages/structure/bind/closure）里哪几件还没跑
                  **服务端拥有**，闭环读它，非空不发合格证（fail-closed）
    这一份        老师傅自己说这活儿分几步，自由文本、有状态
                  **条目、文案、status 都是模型的**（`todo_write`），给人看进度
                  host 只转发 `control_todo`，不许按工程动作猜进度

⚠ 2026-09-19：host 曾按 path 匹配推进 status。那是写死流程，不是
  控制面自己挑。真机写 CreateModal 被猜成第 3 条做完——模型没调
  `todo_write`。撤掉。清单只在模型调用 `todo_write` 时变。

一个是闸的输入，一个是叙述。合并了就会出现「模型把 closure 从待办里划掉，
闭环就放行」——那是 §7 点名的伪造绿灯。两份各管各的，判据钉着。

──────────────────────────────────────────────────────────────────────────
## 抄过来的三条韧性设计（grok 的注释里写清了每一条为什么）

1. **merge 缺省为真**，按 id 合并。已有条目的 content 可以不带——
   「This lets the model mark an item from `in_progress` → `completed`
   without echoing the content back.」

2. **merge 时 id 兜底当 content**：
   「if `content` is omitted the `id` is used as a fallback so the tool never
   errors on a merge call. This makes the tool resilient to state being lost
   between calls.」

3. **模型忘了写 merge=true 时自动升格**：
   「Auto-upgrade to merge when the model forgot `merge: true` but clearly
   intended a partial update: state already has items and every update targets
   an existing ID without providing content.」
   —— 少了这条，模型一次疏忽就把整张清单冲掉，用户眼睁睁看着进度归零。

4. **回喂必须带 id**（`summarize_todo_state`：`- [in_progress] {id}: {content}`）。
   合清单按 id，模型看不见 id 就会另起一套。minimax 是整张快照替换、
   没有 id——我们不抄那条。人看的浮层读 `controlTodo`，不读这段摘要。

5. **同文案新 id 合回旧条**（不是按文件猜进度）。
   ⚠ 2026-09-19 飞机大战 `sr-20260919163941-977KTNMZ0K`：清单先是
   `canvas-engine` 等 8 条，续跑另起 `task-1`…`task-8`，文案相同。
   只按 id 合并就追加成 16 条，旧的 `canvas-engine` 还停在 in_progress，
   浮层钉「Canvas… 3/16」。host 不许从写文件猜完成；模型自己写了两套
   同一句话，按**去掉首尾空白后完全相同的 content** 合成一条。完成态
   覆盖进行中。文案不同的新 id 仍追加——那是真的多了一条。

──────────────────────────────────────────────────────────────────────────
## 真机验过（2026-09-09，真 LLM + 真 HTTP）

第一发 todo-1788951017 **是红的，而且单测全绿**：模型在正文里老实列了四步，
`control_todo` 事件里却是「还没有列活儿清单。」，工具还回 `ok: true`。
真因见 `coerce_updates` 头注（没带 id → 静默丢掉）。

修完 todo-1788951173：

    左栏那一句: 活儿清单 0/4 · 正在做：列出小型请假系统开发步骤并展示给用户
      ◐ 列出小型请假系统开发步骤并展示给用户
      ○ 建立数据结构与权限工作流（员工、主管、HR）
      ○ 编写页面 SPEC 并逐页生成 HTML 页面
      ○ 进行产品排练与闭环检查

模型自己会用 in_progress 标当前这一条。

### 第二次发作（2026-09-10，probe-build-1789004996 第 4 轮）

**同一个症状，换了个真因，而且上一轮补的判据一条都咬不住。**

真机：模型自己挑了 todo_write，回给它 `ok: true, count: 0`，
`control_todo` 的 `line` 是空串——前端 `if (payload.line)` 才渲染，
于是用户那边一个字都没有，模型那边一盏绿灯。

两个真因，都在**分发处**，不在这个模块里：

1. `rehearsal_control` 先 `[u for u in raw if isinstance(u, dict)]` 滤了一道，
   于是上面 `coerce_updates` 认的三种松散形状（整条字符串、task/text、
   没带 id）**在真机上一次都用不上**。修复是对的，装在不通电的插座上
   （本仓 §一）——22 条判据全绿，因为它们直接调 `apply`，从没经过分发。
2. 解析不出任何一条时仍然回 `ok: true`。上一轮补的判据是
   「非空输入不许产出空清单」，**反向那半没写**（本仓 §三）：
   空结果不许回 ok。§7 的分类是 fail-closed——工具结果是一句
   「我干了活」的声明，不是增强项。

`apply` 本身没改：空清单是它的合法输出（`merge: false` + 空 todos =
「把清单清了」，那是真动作）。判决属于**发声明的那一层**，
判据落在 `test_活路径上*` 三条，全走 harness。

**拆掉滤网当场看见第三种形状**（real-topic-survives-1789005461）：模型把每条
待办 `JSON.stringify` 了一遍再塞进数组，键名还没加引号——

    "{id: \"spec\", content: \"起草并确认门店排班与考勤系统 SPEC\", status: \"in_progress\"}"

滤网在的时候它整张被丢掉；滤网一拆，整串字面量成了 content，用户在左栏
看见一行代码。两种都不对，`_row_from_text` 管这一种。
**这就是拆滤网的收益**：静默丢弃变成看得见的错，才有得修。

──────────────────────────────────────────────────────────────────────────

重复 id 是**错误即输出**，不是抛异常：grok 那句
「return an error-as-output variant so the Python side can distinguish this
from infra errors」——分不清"模型写错了"和"我们炸了"，两种都会被当成后者。
"""

from __future__ import annotations

import ast
import json
import re
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Tuple


class TodoStatus(str, Enum):
    """条目状态。可穷举——加一档要在 `_TAG` 里给它写标记。"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


#: 状态 → 渲染标记。**唯一渲染处**（同 `_STOP_TABLE` / `_SAY` 那条纪律）。
_TAG: Dict[TodoStatus, str] = {
    TodoStatus.PENDING: "○",
    TodoStatus.IN_PROGRESS: "◐",
    TodoStatus.COMPLETED: "●",
    TodoStatus.CANCELLED: "✕",
}

#: 清单上限。grok 没设——它的清单在终端里滚，我们要塞进控制面提示词，
#: 每轮都带着走。20 条是拍的，但拍得有理由：超过这个数的"计划"对
#: 一次应用推演来说不是计划，是把 SPEC 抄了一遍。
MAX_TODO_ITEMS = 20


def status_tag(status: TodoStatus) -> str:
    return _TAG[status]


def _coerce_status(raw: Any) -> TodoStatus:
    """认不出来的一律 pending。抄 grok 的 `status.unwrap_or(Pending)`——
    缺省是最保守那一档，不是最乐观那一档（别把认不出的当成已完成）。"""
    try:
        return TodoStatus(str(raw or "").strip())
    except ValueError:
        return TodoStatus.PENDING


#: 同文案叠两条时，完成盖过进行中。cancelled 最低，不许反过来冲掉进度。
_STATUS_RANK = {
    TodoStatus.CANCELLED.value: -1,
    TodoStatus.PENDING.value: 0,
    TodoStatus.IN_PROGRESS.value: 1,
    TodoStatus.COMPLETED.value: 2,
}


def _collapse_same_content(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """同一句只留一条。后写的 id 留下，状态取更靠前的那档。"""
    at: Dict[str, int] = {}
    out: List[Dict[str, str]] = []
    for row in rows:
        key = row["content"]
        if key in at:
            kept = out[at[key]]
            if _STATUS_RANK.get(row["status"], 0) >= _STATUS_RANK.get(
                kept["status"], 0
            ):
                kept["status"] = row["status"]
            kept["id"] = row["id"]
            continue
        at[key] = len(out)
        out.append(dict(row))
    return out


def normalize(raw: Any) -> List[Dict[str, str]]:
    """把落库的清单读成规范形状。脏数据一律丢，不抛。

    同文案叠两套 id 的，这里就合成一条——人看的浮层和回喂模型的摘要
    必须同一把尺子（§4）。已经落库的 16 条飞机大战清单，读的时候也是 8。
    """
    out: List[Dict[str, str]] = []
    for row in raw or []:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id") or "").strip()
        if not rid:
            continue
        out.append(
            {
                "id": rid,
                "content": str(row.get("content") or "").strip() or rid,
                "status": _coerce_status(row.get("status")).value,
            }
        )
    return _collapse_same_content(out)


#: 键名没加引号的对象字面量，把**键**位置的裸词补上引号。只认这一处形状：
#: `{` 或 `,` 之后、冒号之前的那个标识符。值里的冒号、逗号一概不碰。
_BARE_KEY = re.compile(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:')


def _row_from_text(text: str) -> Optional[Dict[str, Any]]:
    """一条待办被模型**当成字符串**送进来时，看它是不是一整个对象字面量。

    ⚠ 2026-09-10 真机 real-topic-survives-1789005461：模型把三条待办
      序列化成了字符串再塞进数组——

          "{id: \"spec\", content: \"起草并确认门店排班与考勤系统 SPEC\", status: \"in_progress\"}"

      键名没加引号，`json.loads` 直接抛。上一版分发处先滤掉非 dict，
      于是整张清单静默清零（`ok: true, count: 0`）；把滤网拆掉之后，
      整串字面量成了 content——用户在左栏看见一行代码。两种都不对。

    ⚠ 同一天第二发（real-topic-survives-1789005633）值用的是**单引号**——

          "{id: '1', content: '起草系统 SPEC', status: 'pending'}"

      只补键的引号还是抛。所以第三道用 `ast.literal_eval`：它认单引号、
      只吃字面量，遇到函数调用/名字一律抛，拿来解析模型即兴填的入参是安全的。
      两发都留在判据里（§一之二：判据喂真机那一发的原样载荷）。

    解析不出来就返回 None，调用方把原文当 content —— **不许丢**。
    """
    t = (text or "").strip()
    if not (t.startswith("{") and t.endswith("}")):
        return None
    quoted = _BARE_KEY.sub(r'\1"\2":', t)
    for parse, candidate in (
        (json.loads, t),
        (json.loads, quoted),
        (ast.literal_eval, quoted),
    ):
        try:
            parsed = parse(candidate)
        except Exception:  # noqa: BLE001 — 解析不了就是解析不了，走兜底
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def coerce_updates(raw: Any) -> List[Dict[str, str]]:
    """把模型送来的这一笔归一成 {id, content, status}。

    ⚠ 2026-09-09 真机 todo-1788951017 逮到的：模型在正文里老老实实列了四步，
      清单却是空的，而工具还回了 `ok: true`——正是 CLAUDE.md §3 那个形状
      「闸全绿但东西没了」。真因是**它没带 id**，而第一版 `apply` 里那句
      `if not rid: continue` 把四条全静默丢掉了。

      grok 的 schema 把 id 写成 required，它的模型照着给；我们的不给。
      照抄"必填"等于把真机上最常见的那一发扔掉。修法照 grok 自己那条韧性
      哲学的**反方向**——它在 content 缺席时拿 id 兜底
      （"so the tool never errors"），我们在 id 缺席时拿 content 兜底。

    还认三种真机上出现过的松散形状：整条是字符串、整条是**被序列化的对象
    字面量**（见 `_row_from_text`）、内容写在 `task`/`text` 上。
    多认几种键不是纵容，是承认「工具的入参由模型即兴填」这个事实——
    不认就只能丢，而丢是静默的。
    """
    out: List[Dict[str, str]] = []
    for i, row in enumerate(raw or []):
        if isinstance(row, str):
            # 先看它是不是被序列化过的一条（见 `_row_from_text`）；
            # 不是就整串当内容，那是真机上另一种出现过的形状。
            row = _row_from_text(row) or {"content": row}
        if not isinstance(row, dict):
            continue
        content = str(
            row.get("content") or row.get("task") or row.get("text") or ""
        ).strip()
        rid = str(row.get("id") or "").strip()
        if not rid:
            # 拿内容当 id：**稳定**，下一笔想改状态还能对上。
            # 内容也空才退到位置码（不稳定，但已经没有别的键可依）。
            rid = content or f"t{i + 1}"
        item: Dict[str, str] = {"id": rid}
        if content:
            item["content"] = content
        status = str(row.get("status") or "").strip()
        if status:
            item["status"] = status
        out.append(item)
    return out


def duplicate_id(updates: Sequence[Dict[str, Any]]) -> Optional[str]:
    """这一笔里有没有重复 id。抄 grok `validate_no_duplicate_ids`。"""
    seen: set = set()
    for u in updates:
        rid = str((u or {}).get("id") or "").strip()
        if not rid:
            continue
        if rid in seen:
            return rid
        seen.add(rid)
    return None


def _has_no_content(u: Dict[str, Any]) -> bool:
    return not str((u or {}).get("content") or "").strip()


def effective_merge(
    existing: List[Dict[str, str]], updates: Sequence[Dict[str, Any]], merge: bool
) -> bool:
    """要不要按合并处理。抄 grok 的自动升格。

    条件三个都要成立：清单本来就有东西、这一笔非空、**每一条**都指向已有 id
    且没带 content。少任何一个都按调用方说的算——自动升格只救「明显是想改状态
    却忘了写 merge」，不许扩大成「猜模型想干嘛」。
    """
    if merge:
        return True
    if not existing or not updates:
        return False
    ids = {row["id"] for row in existing}
    return all(
        _has_no_content(u) and str((u or {}).get("id") or "").strip() in ids
        for u in updates
    )


def apply(
    existing: Any, updates: Any, *, merge: bool = True
) -> Tuple[List[Dict[str, str]], Optional[str]]:
    """算出新清单。返回 (清单, 出错的话那句话)。

    出错时**返回原清单不动** —— 半张清单比没写更糟（用户看着进度倒退）。
    """
    rows = normalize(existing)
    updates = coerce_updates(updates)
    dup = duplicate_id(updates)
    if dup:
        return rows, f"这一笔里 id「{dup}」出现了两次。每条待办的 id 必须唯一。"

    use_merge = effective_merge(rows, updates, merge)
    if not use_merge:
        rows = []

    by_id = {row["id"]: row for row in rows}
    order = [row["id"] for row in rows]
    for u in updates:
        rid = str((u or {}).get("id") or "").strip()
        if not rid:
            continue
        content = str((u or {}).get("content") or "").strip()
        row = by_id.get(rid)
        if row is not None:
            # 已有条目：content 可以不带（只翻状态），status 不带就保持原样。
            if content:
                row["content"] = content
            if str((u or {}).get("status") or "").strip():
                row["status"] = _coerce_status(u.get("status")).value
            continue
        twin = None
        if use_merge and content:
            for existing in by_id.values():
                if existing["content"] == content:
                    twin = existing
                    break
        if twin is not None:
            # 同文案新 id：合到旧条上，换上这次的 id，下一笔按 id 就能对上。
            old_id = twin["id"]
            if str((u or {}).get("status") or "").strip():
                twin["status"] = _coerce_status(u.get("status")).value
            twin["id"] = rid
            del by_id[old_id]
            by_id[rid] = twin
            order[order.index(old_id)] = rid
            continue
        # 新条目：content 缺就拿 id 兜底（grok：让合并调用永不报错）。
        by_id[rid] = {
            "id": rid,
            "content": content or rid,
            "status": _coerce_status((u or {}).get("status")).value,
        }
        order.append(rid)

    out = _collapse_same_content([by_id[i] for i in order])[:MAX_TODO_ITEMS]
    return out, None


def summarize(rows: Any) -> str:
    """喂回模型的那一段。抄 grok `summarize_todo_state`：标记、id、文案都在。

    ⚠ 2026-09-19 坦克大战 `sr-20260919072444-11CSR1RSM6`：第一版只回
      `◐ 初始化…`，没带 id。模型下一发另起 `todo-1`，merge 按 id 追加，
      同一条文案叠成 step1 + todo-1 两份，码头钉在还在进行的 step1 上
      报 1/13。grok 的摘要是 `- [in_progress] step1: 初始化…`——id 在
      回喂里，下一发才对得上。人看的浮层读 `controlTodo`，不读这段。
    """
    items = normalize(rows)
    if not items:
        return "还没有列活儿清单。"
    return "\n".join(
        f"{status_tag(_coerce_status(r['status']))} {r['id']}: {r['content']}"
        for r in items
    )


def one_line(rows: Any) -> str:
    """左栏那一条 chip 的一句话。清单是给人看进度的——看不见就等于没做。"""
    items = normalize(rows)
    if not items:
        return ""
    done = sum(1 for r in items if r["status"] == TodoStatus.COMPLETED.value)
    doing = next(
        (r["content"] for r in items if r["status"] == TodoStatus.IN_PROGRESS.value), ""
    )
    head = f"活儿清单 {done}/{len(items)}"
    return f"{head} · 正在做：{doing}" if doing else head
