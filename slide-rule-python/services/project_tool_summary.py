"""工具调用的**脱敏摘要**：让界面说得出「它正在对什么动手」。

## 为什么需要它（2026-09-13，用户对照 Manus 截图第 4 件）

Manus 右侧那个「电脑」面板最有价值的地方，是看得见**它正在调什么、参数
是什么、返回了什么**。我们这边 `control_tool_start` 只发一个工具名：

    {"type": "control_tool_start", "tool": "project_patch"}

界面于是只能说「正在写入工程源码」——改的哪个文件、跑的哪条命令，一个字
都说不出。结果侧的 `**body` 已经带了 command / revision / exitCode，**开场
侧什么都没有**，所以动作进行中的那几十秒界面是哑的。

## 为什么不能把 args 原样发出去

工具参数里有两样东西绝对不能进事件流：

    approvalRef   授权令牌。它是「这一跳被批准过」的凭证，泄露等于把闸
                  的钥匙贴在界面上。
    changes       `project_patch` 的文件**全文**。一次 patch 可以是几十 KB
                  源码，原样广播既是泄露也是把事件流撑爆。

所以这里是**白名单**，不是黑名单：每个工具显式列出可以说的字段，没列到的
一律不说。新增工具默认什么都不说——宁可界面少一句，不可多说一句。

⚠ 判据 `test_project_tool_summary.py` 钉着两头：该有的字段在、
  approvalRef / 文件内容**在任何工具下都不许出现**。加新工具时先补判据。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# 摘要里任何字符串字段的硬上限。事件流是给人看的一行字，不是日志转储。
MAX_TEXT = 160
# project_patch 最多点名几个文件，其余折成「等 N 个文件」。
MAX_PATHS = 3

#: 每个工具允许出现在摘要里的字段。**没列到的工具就是没有摘要。**
#:
#: ⚠ 不许写成「除了 approvalRef 都放行」。那是黑名单，加一个带敏感内容的
#:   新参数就自动泄露；白名单加新参数默认不说话。
_ALLOWED: Dict[str, tuple] = {
    "project_create": ("templateId",),
    "project_read": ("path",),
    "project_write": ("path",),
    "project_str_replace": ("path",),
    "file_read": ("file",),
    "file_write": ("file",),
    "file_str_replace": ("file",),
    "file_find_in_content": ("file",),
    "file_find_by_name": ("path", "glob"),
    "read_file": ("path",),
    "write_file": ("path",),
    "search_replace": ("path",),
    "bash": ("command",),
    "grep": ("pattern", "path"),
    "list_dir": ("path",),
    "glob": ("pattern", "path"),
    "shell_exec": ("command",),
    "shell_view": ("id",),
    "shell_wait": ("id",),
    "shell_kill_process": ("id",),
    "browser_navigate": ("url",),
    "deploy_expose_port": ("port",),
    "make_manus_page": ("file", "title"),
    "project_exec": ("command",),
    "project_restore": ("targetRevision",),
    "project_export": ("revision",),
    "project_logs": ("operationId",),
    "project_status": ("operationId",),
    "project_cancel": ("operationId",),
    "project_verification": ("operationId",),
    # 只说加载了哪份技能。SKILL.md 正文在 tool result 里回给模型，
    # 不许进会话摘要。
    "skill": ("name", "skill"),
}


def _text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    return cleaned[:MAX_TEXT] if len(cleaned) > MAX_TEXT else cleaned


def _patch_summary(args: Dict[str, Any]) -> Optional[str]:
    """只说**改了哪几个文件**，绝不说改成什么。"""
    changes = args.get("changes")
    if not isinstance(changes, list) or not changes:
        return None
    paths: List[str] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        path = _text(change.get("path"))
        if path:
            paths.append(path)
    if not paths:
        return None
    if len(paths) <= MAX_PATHS:
        return "、".join(paths)
    head = "、".join(paths[:MAX_PATHS])
    return f"{head} 等 {len(paths)} 个文件"


def project_tool_summary(name: str, args: Any) -> Optional[str]:
    """一句能公开的「它在对什么动手」。拿不到就返回 None——不编。

    返回 None 与返回空串是同一件事的两种写法，调用点按 falsy 处理即可；
    这里统一用 None，好让「没有摘要」在类型上看得见。
    """
    tool = str(name or "").strip()
    if not (
        tool.startswith(("project_", "file_", "shell_", "browser_", "deploy_"))
        or tool in {
            "make_manus_page", "read_file", "write_file", "search_replace",
            "bash", "grep", "list_dir", "glob", "skill",
        }
    ) or not isinstance(args, dict):
        return None
    if tool == "project_patch":
        return _patch_summary(args)
    if tool == "skill":
        # name 优先，skill 是别名。两个都有也不许拼成「name name」。
        return _text(args.get("name")) or _text(args.get("skill")) or None
    allowed = _ALLOWED.get(tool)
    if not allowed:
        return None
    parts = [_text(args.get(key)) for key in allowed]
    joined = " ".join(part for part in parts if part)
    return joined or None
