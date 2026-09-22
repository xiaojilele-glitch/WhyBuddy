# -*- coding: utf-8 -*-
"""闭集工具词表。抄 grok-build `xai-tool-types`：名字 / 写权限是叶子，
谁都能依赖它，它不依赖 services 里任何其它模块。

运行时谓词（这一轮列不列、批不批准）留在 rehearsal_control——那些要读会话，
搬进来叶子就立刻不是叶子。

⚠ 缺省 Read：新工具不进工厂。要写必须在 TOOL_SCOPE 里显式声明 WRITE。
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, Optional, Tuple


class ToolScope(str, Enum):
    """工具在「能不能造一份新五系统模型」这条轴上的权限。

    抄 grok-build `xai-tool-protocol` ToolScope { Read, Write }。
    Absence is treated as Read.
    """

    READ = "read"
    WRITE = "write"


#: 工厂公开工具。抄 grok：每一跳是一件 WRITE，host 跑完再挑下一件。
FACTORY_HOPS: Tuple[str, ...] = (
    "spec",
    "pages",
    "structure",
    "bind",
    "closure",
)

#: 账本上的 WRITE 身份前缀。信封 `appbundle.runtimeClosure` 是执行器入口，
#: 不是 hop 自己——pages 跑过两条 runtimeClosure，structure 就会被
#: max_repeat / pending 整跳跳过（2026-09-03 真机 XNDW5W2M59）。
FACTORY_CAP_PREFIX = "factory."

#: 左栏人话。跟 `spec-first-labels.ts` / turn_narration 同一套，
#: 漏一个就是「正在执行 factory.structure」上脸。
FACTORY_HOP_LABELS: Dict[str, str] = {
    "spec": "起草规格：成功判据、需求节点与页面清单",
    "pages": "逐页画界面（并发）",
    "structure": "从界面反推数据模型与关联关系",
    "bind": "给界面接上数据",
    "closure": "完整性检查与发布闭环",
}

CLOSED_TOOLS: Tuple[str, ...] = (
    "ask_user_question",
    # clarify 2026-09-09 退役：维度问题长在 SPEC 假设卡上，不再有一件
    # 「开场先问几条模板题」的工具。答题路径（awaitReason=control_clarify
    # 的老会话交卷）不在这张表上，照常可用——见 rehearsal_control 那段注释。
    "search_evidence",
    "inspect_model",
    "write_plan",
    "enter_plan_mode",
    "exit_plan_mode",
    # 报完工：模型声称做完了，判官说了算（抄 grok update_goal）。
    # 缺省 READ——它不产出新的五系统模型，只是把一次声明交给判官。
    # 落 READ 还有一个好处：`action_stationarity` 的紧档正好接得上，
    # 同一份产出上一遍遍重报会被 4 次掐掉。
    "report_done",
    # 老师傅自己列活儿清单（抄 grok todo_write）。缺省 READ——它不造五系统模型。
    "todo_write",
    # 模型自己攒的记忆（抄 grok MemorySearch / MemoryGet）。都是 READ——
    # remember 写的是**记忆**不是五系统模型，不进工厂信封。
    "remember",
    "recall",
    # 加载磁盘技能。skill 是英文常用词，文本抠名必须忽略。
    "skill",
    "rehearse",
    "workflow",
    *FACTORY_HOPS,
    "refine",
    "challenge",
    "repair",
    "restore_version",
    "fork_variant",
    "project_create", "project_list", "project_read", "project_search",
    "project_patch", "project_write", "project_str_replace",
    "file_read", "file_write", "file_str_replace",
    "file_find_in_content", "file_find_by_name",
    "read_file", "write_file", "search_replace", "bash", "grep", "list_dir", "glob",
    "shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process",
    "browser_view", "browser_navigate", "browser_restart",
    "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
    "browser_select_option", "browser_scroll_up", "browser_scroll_down",
    "browser_console_exec", "browser_console_view",
    "message_notify_user", "message_ask_user", "info_search_web",
    "deploy_expose_port", "deploy_apply_deployment", "make_manus_page", "idle",
    "project_start", "project_exec", "project_status",
    "project_logs", "project_cancel", "project_verify", "project_verification",
    "project_revisions", "project_restore", "project_export",
)

# 文本里抠闭集工具名。抄 grok-build AskUserQuestion：选项点下去是 typed
# 答案（Accepted），不是把标签当新 prompt 再问一轮模型。
#
# ⚠ 2026-09-07 真机水果店 sr-20260907192228：芯片写着「精修（refine）」，
#   factory_hop_from_text 只认五件套，parseRehearsalSlash 只认「/精修」，
#   POST 不带 forcedTool，控制面重猜成 bind，弹出登录假设卡。
#   括号里的名字必须对全表，含 refine。
#
# rehearse 故意不从文本回 forcedTool：跟 `/推演` 同一条合同——空会话带
# rehearse 会跳过停泊直接点火。认不认「这句话在点工具」另说，见
# is_closed_tool_command。
_CLOSED_ID_RE = re.compile(
    r"(?:^|[^\w])("
    + "|".join(sorted(CLOSED_TOOLS, key=len, reverse=True))
    + r")(?:[^\w]|$)",
    re.IGNORECASE,
)
_TEXT_FORCED_SKIP = frozenset({
    "rehearse",
    "skill",
    "idle",
    "make_manus_page",
    "bash", "grep", "glob", "list_dir", "read_file", "write_file", "search_replace",
    *(name for name in CLOSED_TOOLS if name.startswith(
        ("project_", "file_", "shell_", "browser_", "deploy_", "message_", "info_")
    )),
})

# 只列 WRITE。没写的一律 READ。
TOOL_SCOPE: Dict[str, ToolScope] = {
    "rehearse": ToolScope.WRITE,
    "workflow": ToolScope.WRITE,
    "spec": ToolScope.WRITE,
    "pages": ToolScope.WRITE,
    "structure": ToolScope.WRITE,
    "bind": ToolScope.WRITE,
    "closure": ToolScope.WRITE,
    "refine": ToolScope.WRITE,
    "repair": ToolScope.WRITE,
    "challenge": ToolScope.WRITE,
    "restore_version": ToolScope.WRITE,
    "fork_variant": ToolScope.WRITE,
}


class ToolScopeViolation(RuntimeError):
    """READ 权限的工具试图进工厂信封。fail-closed：抛，不降级放行。"""


def resolve_tool_scope(name: Any) -> ToolScope:
    """查权限。没声明的一律 READ（含拼错的、以后新加的）。"""
    return TOOL_SCOPE.get(str(name or "").strip(), ToolScope.READ)


def is_closed_tool(name: Any) -> bool:
    return str(name or "").strip() in CLOSED_TOOLS


def host_factory_hop(tools: Any) -> Optional[str]:
    """goal.tools 恰好一件工厂 hop 时返回那一跳，否则 None。

    多一件就不是 host hop——那是整份菜单，账本仍走信封 runtimeClosure。
    """
    if not isinstance(tools, (list, tuple)) or len(tools) != 1:
        return None
    hop = str(tools[0]).strip()
    return hop if hop in FACTORY_HOPS else None


def factory_capability_id(hop: str) -> str:
    """这一跳在账本上的 WRITE 身份。

    抄 grok：每一跳是独立 Terminal。run / artifact / pending / repeat
    都认这个 id，所以 pages 的两次不算 structure 的两次。
    """
    return f"{FACTORY_CAP_PREFIX}{str(hop or '').strip()}"


def hop_from_factory_capability(capability_id: str) -> Optional[str]:
    raw = str(capability_id or "").strip()
    if not raw.startswith(FACTORY_CAP_PREFIX):
        return None
    hop = raw[len(FACTORY_CAP_PREFIX) :]
    return hop if hop in FACTORY_HOPS else None


# ── 已有应用时，工厂单跳指令不许再走入站审查 ────────────────────────
#
# 2026-09-03 真机：用户在已有应用上输入
#   「继续进行数据模型反推（structure）与权限绑定（bind）」
#   「直接执行闭环发布（closure）」
# 作曲家 debounce 500ms 后把整句交给 intake_judge 的 LLM。模型把
# 「closure / 闭环发布」读成新话题（版本发布流程管理系统），弹出
# 「正在审查需求」和一排改写建议——跟点火前澄清同一张卡，但问的是
# 另一件事。确定性层必须在 has_app 时认出这是 hop 指令，零 LLM。
#
# 空会话仍走 LLM：「闭环发布管理系统」是新产品名，不是 hop。

_HOP_ID_RE = re.compile(
    r"(?:^|[^\w])(spec|pages|structure|bind|closure)(?:[^\w]|$)",
    re.IGNORECASE,
)
_ZH_HOP: Tuple[Tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"数据模型反推|数据结构"), "structure"),
    (re.compile(r"权限绑定|权限工作流"), "bind"),
    (re.compile(r"页面生成|画页面"), "pages"),
    (re.compile(r"起草\s*SPEC|起草规格"), "spec"),
    (re.compile(r"完整性检查|上线闭环"), "closure"),
    # 闭环发布后面不能是「管理/系统/平台/应用」——那是新产品名。
    (re.compile(r"闭环发布(?!管理|[系统平台应用])"), "closure"),
)


def factory_hop_from_text(text: str) -> Optional[str]:
    """从人话里抠出唯一一跳。多跳或新产品名 → None。

    抄 grok-build AskUserQuestion：选项点下去是 typed 答案，不是新 prompt。
    「进入数据模型反推（Structure）」必须认出 structure。
    「闭环发布管理系统」不许认成 closure。
    """
    t = str(text or "").strip()
    if not t:
        return None
    ids = [m.group(1).lower() for m in _HOP_ID_RE.finditer(t)]
    uniq = list(dict.fromkeys(ids))
    if len(uniq) == 1:
        return uniq[0]
    if len(uniq) > 1:
        return None
    zh: list[str] = []
    seen: set[str] = set()
    for pat, hop in _ZH_HOP:
        if pat.search(t) and hop not in seen:
            seen.add(hop)
            zh.append(hop)
    if len(zh) == 1:
        return zh[0]
    return None


def is_factory_hop_command(text: str) -> bool:
    """这句话是不是在点工厂五件套里的某一跳（可多跳）。

    不看会话状态——调用方（intake_judge.precheck）只在 has_app 时采用。
    """
    t = str(text or "").strip()
    if not t:
        return False
    if factory_hop_from_text(t):
        return True
    if _HOP_ID_RE.search(t):
        return True
    return False


def closed_tool_from_text(text: str) -> Optional[str]:
    """从人话里抠出唯一一件闭集工具。多件或新产品名 → None。

    认括号里的英文名（「精修（refine）」「进入权限绑定（bind）」），
    也认裸 id（芯片有时只给 refine）。中文启发式仍走 factory_hop_from_text
    （「继续画页面」没有括号）。
    """
    t = str(text or "").strip()
    if not t:
        return None
    ids = [
        m.group(1).lower()
        for m in _CLOSED_ID_RE.finditer(t)
        if m.group(1).lower() not in _TEXT_FORCED_SKIP
    ]
    uniq = list(dict.fromkeys(ids))
    if len(uniq) == 1:
        return uniq[0]
    return None


def is_closed_tool_command(text: str) -> bool:
    """这句话是不是在点闭集表里的某一件（可多件，含 refine）。

    已有应用时 intake 用它跳过「正在审查需求」。空会话不走——
    「闭环发布管理系统」仍交给 LLM 当新产品。
    """
    t = str(text or "").strip()
    if not t:
        return False
    if closed_tool_from_text(t):
        return True
    if _CLOSED_ID_RE.search(t):
        return True
    return False
