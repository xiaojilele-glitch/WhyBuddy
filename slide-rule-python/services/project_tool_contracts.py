"""Closed, typed project-tool inputs shared by model dispatch and HTTP adapters."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class CreateArguments(ToolArguments):
    approvalRef: str = Field(min_length=1, max_length=240)
    templateId: Literal["react-vite", "react-vite-tasks"] = "react-vite"


class RevisionArguments(ToolArguments):
    revision: str | None = Field(default=None, min_length=1, max_length=240)


class ListArguments(RevisionArguments):
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=20)


#: `project_read` 一次最多回多少字符。
#:
#: 抄的标准答案：grok-build
#: `xai-grok-tools/src/implementations/grok_build/read_file/mod.rs` +
#: `xai-grok-tools/src/types/context.rs`：
#:
#:     /// Max lines to read (read_file). Default: 1000.
#:     pub max_lines_read: Option<usize>,
#:     ...
#:     Some(input.limit.unwrap_or(usize::MAX).min(max_lines))
#:
#: 两条形状都抄了：**不传 limit 就是"整份读完"**（再由上限夹住），以及
#: 上限本身要大到一次能吞下一个正常源文件。grok 的默认是 1000 行 / 25k token，
#: 我们按字符计，取 8000。
#:
#: ⚠ 2026-09-14 真机（text168/grok-4.6，`artifacts/control-real-model/1fcfd3d4`）
#:   就是被这个数字烧死的。原值 2000 字符，而模板里正常源文件是：
#:
#:       database.mjs 7458  server.mjs 7356  src/main.tsx 7188
#:       tests/application.test.mjs 6529  src/style.css 2775  README.md 1040
#:
#:   读完一遍要 19 次调用 / 4 轮。真机跑到第 5 轮（共 16 轮）时 offset 老老实实
#:   走到 0→2000→4000，**一次都没打转**，64000 的 token 预算先烧完了：
#:
#:       stopReason=token_budget limit=64000 used=64488   页面落库：0 份
#:
#:   原地打转护栏一次都没响——它是对的，模型确实在往前走，只是窗口太小，
#:   同样的字节被"重发历史"摊进 4 轮里。8000 之后同样这批文件 6 次调用 / 1 轮。
#:
#: ⚠ 这个数字**不是单独生效的**（CLAUDE.md §4）。它下游还有两道夹子，
#:   只改这一个不会报错、只会一点效果都没有：
#:       services/project_tools.py        `PROJECT_READ_MAX_RESULT_CHARS`（信封）
#:       services/rehearsal_control.py    `control_tool_result_max_chars()`（回喂）
#:   `tests/test_project_read_window_fits_real_sources.py` 把三道一起钉住。
PROJECT_READ_MAX_CHARS = 8000


#: `project_read` 专用的信封上限（其余工具仍走 MAX_RESULT_CHARS）。
#:
#: 抄 grok `TruncationConfig::per_tool_max_output_bytes`——按工具名覆盖，
#: 默认档不动：
#:
#:     /// Per-tool overrides keyed by canonical tool name.
#:     pub per_tool_max_output_bytes: HashMap<String, usize>,
#:     ...
#:     Precedence: per-tool override > default override > built-in fallback.
#:
#: ⚠ 为什么必须单列一个（CLAUDE.md §4）：`_bounded_text` 夹的是**整包 JSON**，
#:   3800 的信封会把 8000 字的正文当场砍回 ~3500。把 PROJECT_READ_MAX_CHARS
#:   调大而不动这里，不报错、不告警，读窗一个字都不会变宽。
#:
#: 取值 = 8000 正文 × JSON 转义余量（源码里的换行/引号会变两个字符）+ 信封
#: 那几个字段（revision / path / sha256 / offset / nextOffset / totalChars）。
PROJECT_READ_MAX_RESULT_CHARS = 10_000

#: 无窗 file_read / project_read 只回路径 + 文件头。要原文必须显式带
#: offset / limit / start_line / end_line。抄 Manus filesystem-as-context：
#: 磁盘是权威，messages 里不灌全文。
FILE_READ_EXCERPT_LINES = 40
FILE_READ_EXCERPT_CHARS = 800


def explicit_read_window(args: object) -> bool:
    """模型有没有点名读窗。默认字段不算——pydantic 会填 offset=0 / limit=8000。"""
    provided = getattr(args, "model_fields_set", set())
    return bool(provided & {"start_line", "end_line", "offset", "limit"})


class ReadArguments(RevisionArguments):
    path: str = Field(min_length=1, max_length=240)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=PROJECT_READ_MAX_CHARS, ge=1, le=PROJECT_READ_MAX_CHARS)


class SearchArguments(RevisionArguments):
    query: str = Field(min_length=1, max_length=200)
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=8, ge=1, le=8)
    caseSensitive: bool = False


class WriteArguments(ToolArguments):
    approvalRef: str = Field(min_length=1, max_length=240)
    expectedRevision: str = Field(min_length=1, max_length=240)


class FileChange(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    content: str | None = Field(max_length=512 * 1024)
    expectedSha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")


class PatchArguments(WriteArguments):
    changes: list[FileChange] = Field(min_length=1, max_length=64)


class StartArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    port: int = Field(default=5173, ge=1024, le=65535)


class ExecArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    command: Literal["check", "build", "test"]


class VerifyArguments(WriteArguments):
    runtimeOperationId: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")


#: 等待类工具（project_status.waitSeconds / shell_wait.seconds）的上界。
#:
#: ⚠ 2026-09-16 真机（sr-20260916212612-6N7V2BZ6XS）量出来的。原值是 5，
#:   而真机上一条命令的实际耗时是：
#:
#:       npm run build 18.9s   npm run check 18.9s   npm test 19.0s
#:       project_status 结果回来普遍 18~24s
#:
#:   于是等一条 build 至少要 4 次 shell_wait，而**每一次的真实代价不是 5 秒，
#:   是 5 秒 + 一次模型往返**。同一趟真机里，`tool_result` 到下一个
#:   `tool_start` 的间隔稳定在 12~20 秒（服务端记账是 ms 级，那一段就是模型）。
#:
#:       等 18 秒的活  →  4 轮 × (5 + 15) ≈ 80 秒
#:
#:   整趟 1127 秒里，34 轮有 9 轮是纯轮询（project_status ×5、shell_wait ×4），
#:   全是这么烧掉的。
#:
#: ⚠ 调大它之所以是纯赚，靠的是那两个循环**提前返回**：操作进终态、或
#:   runtime 变 ready 就立刻 break（services/project_tools.py）。不该等的
#:   时候一秒都不会多等；只有真在等的时候才少跑几轮。
#:   **哪天把提前返回改成死等满，这个数字就不再安全了** ——
#:   `tests/test_waiting_costs_a_round_trip.py` 正面反面都钉着。
PROJECT_WAIT_MAX_SECONDS = 30.0

#: shell_exec / bash 前台默认堵住这次工具调用、等到命令进终态。
#:
#: 抄 grok-build `xai-grok-tools/.../bash/mod.rs`：
#:     const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
#:     const MAX_FOREGROUND_BLOCK: Duration = Duration::from_secs(300);
#: 前台是 `backend.run()` 真等；`is_background: true` 才立刻给 task_id。
#: 我们没有进程级 FG，就在这次工具调用里把 `_poll_operation` 等到终态。
#:
#: ⚠ 2026-09-18 真机（问「用户名密码是啥」那轮）：`shell_exec npm run build`
#:   一交就 `ok: true` + `status: queued`，模型把接单当成跑完，开口了；
#:   左栏还亮着进行中。grok 前台路径上模型根本看不到 queued。
SHELL_EXEC_FOREGROUND_BLOCK_SECONDS = 120.0
SHELL_EXEC_MAX_FOREGROUND_SECONDS = 300.0


class StatusArguments(ToolArguments):
    operationId: str | None = Field(default=None, min_length=1, max_length=240)
    waitSeconds: float = Field(default=2, ge=0, le=PROJECT_WAIT_MAX_SECONDS)
    operationCursor: str = Field(default="", max_length=240)


class OperationArguments(ToolArguments):
    operationId: str = Field(min_length=1, max_length=240)


class HistoryArguments(ToolArguments):
    cursor: str | None = Field(default=None, min_length=1, max_length=240)
    limit: int = Field(default=5, ge=1, le=5)


class RestoreArguments(WriteArguments):
    targetRevision: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")


class KernelWriteArguments(ToolArguments):
    #: 日常整文件写。批准引用和当前版本由服务端从会话绑，模型不许自己填。
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    append: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class KernelStrReplaceArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    oldStr: str = Field(min_length=1, max_length=512 * 1024)
    newStr: str = Field(max_length=512 * 1024)


class FileReadArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    start_line: int | None = Field(default=None, ge=0)
    end_line: int | None = Field(default=None, ge=0)
    sudo: bool = False


class FileWriteArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    append: bool = False
    leading_newline: bool = False
    trailing_newline: bool = False
    sudo: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class FileStrReplaceArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    old_str: str = Field(min_length=1, max_length=512 * 1024)
    new_str: str = Field(max_length=512 * 1024)
    sudo: bool = False


class FileFindContentArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    regex: str = Field(min_length=1, max_length=200)
    sudo: bool = False


class FileFindNameArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    glob: str = Field(min_length=1, max_length=200)
    sudo: bool = False


class ShellExecArguments(ToolArguments):
    command: str = Field(min_length=1, max_length=2000)
    id: str | None = Field(default=None, min_length=1, max_length=240)
    exec_dir: str | None = Field(default=None, max_length=240)
    sudo: bool = False
    #: 抄 grok bash `is_background`：true 立刻交回 running，不是命令成功。
    is_background: bool = False
    #: 前台最多等几秒。不传就用 SHELL_EXEC_FOREGROUND_BLOCK_SECONDS。
    timeout: float | None = Field(default=None, ge=0, le=SHELL_EXEC_MAX_FOREGROUND_SECONDS)


class ShellSessionArguments(ToolArguments):
    id: str | None = Field(default=None, min_length=1, max_length=240)
    seconds: float | None = Field(default=None, ge=0, le=PROJECT_WAIT_MAX_SECONDS)
    sudo: bool = False


class ShellWriteArguments(ToolArguments):
    id: str = Field(min_length=1, max_length=240)
    input: str = Field(max_length=8 * 1024)
    press_enter: bool = True
    sudo: bool = False


class BrowserNavigateArguments(ToolArguments):
    url: str = Field(min_length=1, max_length=2000)
    sudo: bool = False


class BrowserEmptyArguments(ToolArguments):
    sudo: bool = False


class BrowserClickArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    coordinate_x: float | None = None
    coordinate_y: float | None = None
    sudo: bool = False


class BrowserInputArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    text: str = Field(max_length=8 * 1024)
    press_enter: bool = False
    sudo: bool = False


class BrowserMouseArguments(ToolArguments):
    coordinate_x: float
    coordinate_y: float
    sudo: bool = False


class BrowserKeyArguments(ToolArguments):
    key: str = Field(min_length=1, max_length=80)
    sudo: bool = False


class BrowserSelectArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    option: str = Field(min_length=1, max_length=240)
    sudo: bool = False


class BrowserScrollArguments(ToolArguments):
    to_top: bool = False
    to_bottom: bool = False
    sudo: bool = False


class BrowserConsoleArguments(ToolArguments):
    javascript: str = Field(min_length=1, max_length=8 * 1024)
    sudo: bool = False


class DeployPortArguments(ToolArguments):
    port: int = Field(default=5173, ge=1024, le=65535)
    sudo: bool = False


class DeployApplyArguments(ToolArguments):
    type: str = Field(default="preview", min_length=1, max_length=80)
    sudo: bool = False


class MakePageArguments(ToolArguments):
    file: str | None = Field(default=None, min_length=1, max_length=240)
    title: str | None = Field(default=None, max_length=240)
    sudo: bool = False


class GithubReadArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    offset: int | None = Field(default=None, ge=0)
    limit: int | None = Field(default=None, ge=1)
    sudo: bool = False


class GithubWriteArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    sudo: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class GithubReplaceArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    old_string: str = Field(min_length=1, max_length=512 * 1024)
    new_string: str = Field(max_length=512 * 1024)
    sudo: bool = False


class GithubBashArguments(ToolArguments):
    command: str = Field(min_length=1, max_length=2000)
    sudo: bool = False
    is_background: bool = False
    timeout: float | None = Field(default=None, ge=0, le=SHELL_EXEC_MAX_FOREGROUND_SECONDS)


class GithubGrepArguments(ToolArguments):
    pattern: str = Field(min_length=1, max_length=200)
    path: str | None = Field(default=None, max_length=240)
    glob: str | None = Field(default=None, max_length=200)
    sudo: bool = False


class GithubListDirArguments(ToolArguments):
    path: str = Field(default=".", min_length=1, max_length=240)
    sudo: bool = False


class GithubGlobArguments(ToolArguments):
    pattern: str = Field(min_length=1, max_length=200)
    path: str | None = Field(default=None, max_length=240)
    sudo: bool = False


#: 抄 grok-build bash：沙箱里跑模型给的那一行，宿主闸只挡 sudo / 控制字符。
#: `project_exec` 仍然只吃 check/build/test；shell_exec / bash 走这条。
_SHELL_SUDO = re.compile(r"(^|[\s;&|`$])(sudo|doas)([\s=]|$)")


def sandbox_shell_script(command: str) -> str:
    """Return one PTY-safe sandbox line, or fail closed.

    ⚠ 2026-09-17：第一版把自由 curl 直接拒掉。用户要的是 grok 那台
    沙箱机，不是再发明一份 npm script 白名单。E2B 是边界；sudo 仍拒。
    start_console 不许换行，所以这里先挡，避免工人抛成 invalid_workspace_command。
    """
    if not isinstance(command, str):
        raise ValueError("project_shell_command_not_allowed")
    text = command.strip()
    if not text or len(text) > 2000:
        raise ValueError("project_shell_command_not_allowed")
    if any(char in text for char in ("\n", "\r", "\x00")):
        raise ValueError("project_shell_command_not_allowed")
    if _SHELL_SUDO.search(text.lower()) or text.lower().startswith("sudo"):
        raise ValueError("project_sudo_forbidden")
    return text


def classify_shell_command(command: str) -> tuple[str, str | None]:
    """Map a model command to (`check`/`build`/`test`, None) or (`shell`, script)."""
    text = sandbox_shell_script(command)
    lowered = " ".join(text.split()).lower()
    for name in ("check", "build", "test"):
        if lowered == name or lowered.endswith(" " + name) or f"run {name}" in lowered:
            return name, None
    return "shell", text


def leaked_shell_command(command: str) -> str:
    """Managed check/build/test only. project_exec still uses this closed set."""
    name, script = classify_shell_command(command)
    if script is not None:
        raise ValueError("project_shell_command_not_allowed")
    return name


def leaked_shell_exec_dir_allowed(exec_dir: str | None) -> bool:
    raw = str(exec_dir or "").strip().replace("\\", "/").rstrip("/")
    return raw.lower() in {"", ".", "home/ubuntu", "/home/ubuntu", "workspace", "/workspace"}


def leaked_browser_url_allowed(url: str) -> bool:
    raw = str(url or "").strip()
    if not raw or raw[0] in "./" or "://" not in raw:
        return True
    lower = raw.lower()
    if lower.startswith(("http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1")):
        return True
    return ".e2b." in lower or "preview." in lower


LEAKED_KERNEL_TOOLS = frozenset({
    "message_notify_user", "message_ask_user",
    "file_read", "file_write", "file_str_replace", "file_find_in_content", "file_find_by_name",
    "shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process",
    "browser_view", "browser_navigate", "browser_restart",
    "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
    "browser_select_option", "browser_scroll_up", "browser_scroll_down",
    "browser_console_exec", "browser_console_view",
    "info_search_web",
    "deploy_expose_port", "deploy_apply_deployment",
    "make_manus_page",
    "idle",
})
assert len(LEAKED_KERNEL_TOOLS) == 29

GITHUB_KERNEL_TOOLS = frozenset({
    "read_file", "write_file", "search_replace", "bash", "grep", "list_dir", "glob",
})
assert len(GITHUB_KERNEL_TOOLS) == 7

#: 2026-09-17：点击 / stdin / 沙箱 bash 接到现有 E2B+Playwright 核。
#: 公开 CDN 仍然没有——deploy_apply 只许亮私有预览，不许 deployed=true。
LEAKED_UNAVAILABLE: dict[str, str] = {}

BROWSER_INTERACT_TOOLS = frozenset({
    "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
    "browser_select_option", "browser_scroll_up", "browser_scroll_down",
    "browser_console_exec",
})


def compile_browser_action(name: str, parsed) -> dict:
    """Closed Playwright/OpenHands action. Model JS is only `evaluate`.

    抄 OpenHands BrowserToolExecutor + Playwright public API 的形状：
    typed op in，observation out。不把模型源码当 runner。
    """
    if getattr(parsed, "sudo", False):
        raise ValueError("project_sudo_forbidden")
    if name == "browser_click":
        action: dict = {"op": "click"}
        if parsed.index is not None:
            action["index"] = parsed.index
        if parsed.coordinate_x is not None and parsed.coordinate_y is not None:
            action["x"] = parsed.coordinate_x
            action["y"] = parsed.coordinate_y
        if "index" not in action and "x" not in action:
            raise ValueError("project_browser_action_invalid")
        return action
    if name == "browser_input":
        action = {"op": "type", "text": parsed.text, "pressEnter": parsed.press_enter}
        if parsed.index is not None:
            action["index"] = parsed.index
        return action
    if name == "browser_move_mouse":
        return {"op": "move", "x": parsed.coordinate_x, "y": parsed.coordinate_y}
    if name == "browser_press_key":
        return {"op": "key", "key": parsed.key}
    if name == "browser_select_option":
        action = {"op": "select", "option": parsed.option}
        if parsed.index is not None:
            action["index"] = parsed.index
        return action
    if name == "browser_scroll_up":
        return {"op": "scroll", "direction": "up", "toEnd": parsed.to_top}
    if name == "browser_scroll_down":
        return {"op": "scroll", "direction": "down", "toEnd": parsed.to_bottom}
    if name == "browser_console_exec":
        return {"op": "evaluate", "javascript": parsed.javascript}
    raise ValueError("project_browser_action_invalid")


class LogsArguments(OperationArguments):
    afterSeq: int = Field(default=0, ge=0)
    offset: int = Field(default=0, ge=0)


PROJECT_ARGUMENTS = {
    "project_create": CreateArguments,
    "project_list": ListArguments,
    "project_read": ReadArguments,
    "project_search": SearchArguments,
    "project_revisions": HistoryArguments,
    "project_restore": RestoreArguments,
    "project_export": RevisionArguments,
    "project_patch": PatchArguments,
    "project_write": KernelWriteArguments,
    "project_str_replace": KernelStrReplaceArguments,
    "file_read": FileReadArguments,
    "file_write": FileWriteArguments,
    "file_str_replace": FileStrReplaceArguments,
    "file_find_in_content": FileFindContentArguments,
    "file_find_by_name": FileFindNameArguments,
    "shell_exec": ShellExecArguments,
    "shell_view": ShellSessionArguments,
    "shell_wait": ShellSessionArguments,
    "shell_write_to_process": ShellWriteArguments,
    "shell_kill_process": ShellSessionArguments,
    "browser_view": BrowserEmptyArguments,
    "browser_navigate": BrowserNavigateArguments,
    "browser_restart": BrowserEmptyArguments,
    "browser_click": BrowserClickArguments,
    "browser_input": BrowserInputArguments,
    "browser_move_mouse": BrowserMouseArguments,
    "browser_press_key": BrowserKeyArguments,
    "browser_select_option": BrowserSelectArguments,
    "browser_scroll_up": BrowserScrollArguments,
    "browser_scroll_down": BrowserScrollArguments,
    "browser_console_exec": BrowserConsoleArguments,
    "browser_console_view": BrowserEmptyArguments,
    "deploy_expose_port": DeployPortArguments,
    "deploy_apply_deployment": DeployApplyArguments,
    "make_manus_page": MakePageArguments,
    "read_file": GithubReadArguments,
    "write_file": GithubWriteArguments,
    "search_replace": GithubReplaceArguments,
    "bash": GithubBashArguments,
    "grep": GithubGrepArguments,
    "list_dir": GithubListDirArguments,
    "glob": GithubGlobArguments,
    "project_start": StartArguments,
    "project_exec": ExecArguments,
    "project_verify": VerifyArguments,
    "project_verification": OperationArguments,
    "project_status": StatusArguments,
    "project_logs": LogsArguments,
    "project_cancel": OperationArguments,
}
PROJECT_TOOL_NAMES = frozenset(PROJECT_ARGUMENTS)
PROJECT_WRITE_TOOLS = frozenset({
    "project_create", "project_patch", "project_write", "project_str_replace",
    "file_write", "file_str_replace", "write_file", "search_replace",
    "shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
    "browser_navigate", "browser_restart",
    "project_start", "project_exec", "project_verify", "project_restore",
})
PROJECT_KERNEL_WRITE_TOOLS = frozenset({
    "project_write", "project_str_replace", "file_write", "file_str_replace",
    "write_file", "search_replace",
    "shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
    "browser_navigate", "browser_restart",
})
PROJECT_ALIAS_TOOLS = frozenset({
    "project_write", "project_str_replace",
})

_DESCRIPTIONS = {
    "project_create": "Create or recover this session's React/TypeScript/Vite project using the current approved plan. templateId=react-vite-tasks is only for a task-management web app (login, SQLite, writer/reader roles). Office files (.pptx/.docx/.xlsx) are not a task app — do not pick react-vite-tasks for those. react-vite is a minimal computer. Existing projects retain their source. Returns saved revision, not delivery.",
    "project_list": "List immutable project files with SHA256 and source revision. Continue with nextCursor and the returned revision while truncated.",
    "project_read": "Read a saved source file. Default (no offset/limit) returns path, sha256, size and a short excerpt — not the full text. Ask for a window with offset/limit (max {max_read_chars} characters) when you need the body; search with project_search. Use returned SHA256 for patch preconditions. Only when truncated is true, continue with nextOffset and the same revision.",
    "project_search": "Search saved source for literal text, with bounded line excerpts. Use nextCursor and the same revision to continue; this is not regex or shell execution.",
    "project_revisions": "List committed source history for this project, newest first. Continue with nextCursor. History never includes losing or uncommitted source writes.",
    "project_restore": "Restore a committed historical source tree as a new revision under the current approved plan. Does not rewind history, copy old verification, or restore business data. Live source-only changes queue runtime.patch; dependency/startup changes require stopping and confirmed cleanup first. Poll operationId before declaring completion.",
    "project_export": "Return the authorized download path for an immutable source ZIP and hash manifest. Application data, environment secrets and preview credentials are separate. Downloading source is not deployment or verified delivery.",
    "project_patch": "Apply exact file replacements/deletions to this session project using expectedRevision and per-file expectedSha256 (null only for new files). A ready runtime queues source/assets to its existing worker and returns operationId: poll project_status until completed with synchronized=true before using the returned new revision. Dependencies/startup configuration require a stopped, reconciled runtime. Submission is not completion; old verification is not proof for new source. Prefer file_write or file_str_replace for an ordinary single-file edit.",
    "project_write": "Alias of file_write with path/content. Prefer file_write.",
    "project_str_replace": "Alias of file_str_replace with path/oldStr/newStr. Prefer file_str_replace.",
    "file_read": "Read one saved source file. file is a project-relative path (absolute sandbox prefixes are stripped). Default (no start_line/end_line) returns path, sha256, size and a short excerpt — not the full text. Pass start_line/end_line (0-based, exclusive end) for a window. sudo=true is rejected. Do not send approvalRef or hashes.",
    "file_write": "Overwrite or append one saved source file. Pass file, content, and optional append/leading_newline/trailing_newline. sudo=true is rejected. Do not send approvalRef, revision, or SHA256 — the server binds the current approved plan. Prefer file_str_replace for a unique in-file edit. Multi-file CAS or deletion still uses project_patch. Office files (.pptx/.docx/.xlsx) are not text source: write them with contentEncoding=base64 (ZIP bytes) or generate them in bash so the host can collect them. A UTF-8 string at an office path is rejected.",
    "file_str_replace": "Replace one unique old_str with new_str in a saved source file. old_str must occur exactly once. sudo=true is rejected. Do not send approvalRef, revision, or hashes.",
    "file_find_in_content": "Search one saved source file with a regular expression. Returns bounded line excerpts. sudo=true is rejected. This is not shell execution.",
    "file_find_by_name": "Find saved source paths under path whose name or relative path matches glob. path may be a directory prefix or '.' for the whole tree.",
    "shell_exec": "Run one command in this project's E2B sandbox. Foreground (default) blocks this tool until the command exits or about {fg_block_secs}s, then returns commandFinished and exitCode; ok only means the command was accepted. is_background=true returns immediately with status running and commandFinished=false — that is not completion; do not claim the command finished. check/build/test (or npm/pnpm run those) stay on the managed installer. Any other one-line command runs as grok-build bash in /home/user/workspace. An office workspace (no package.json) keeps that same sandbox for the next command, so packages you installed stay. .pptx/.docx/.xlsx written in the workspace come back on this receipt as officeFiles — that is the deliverable; do not base64 them into logs or file_write. Newlines and sudo are rejected. Optional id is the idempotency key. Optional timeout is foreground seconds (max 300). Poll a backgrounded command with shell_wait / shell_view.",
    "shell_view": "Read bounded output of a queued project command. id is the operationId from shell_exec; omit it to read the latest operation.",
    "shell_wait": "Wait up to seconds (max 30) for a queued project command. It returns the moment the command finishes, so one generous wait beats several short polls. id is the operationId; omit it to wait on the latest operation.",
    "shell_write_to_process": "Type into the live bash PTY of a queued project command. id is the operationId from shell_exec. press_enter defaults true. The worker delivers bytes on the next poll; a finished operation is rejected.",
    "shell_kill_process": "Cancel a queued or running project operation. id is the operationId; omit it to cancel the latest active one.",
    "browser_view": "Read the current private preview and last trusted verification snapshot. This is not a live DOM dump.",
    "browser_navigate": "Open the session's private preview. url must be a relative path or this project's preview origin; arbitrary external sites are rejected. This starts the managed runtime when needed.",
    "browser_restart": "Cancel the current runtime and queue a fresh managed start.",
    "browser_click": "Click an interactive element (index from browser_view) or coordinates on the private preview. External sites are rejected. Needs a ready preview.",
    "browser_input": "Type into the focused or indexed field on the private preview. press_enter sends Enter after the text.",
    "browser_move_mouse": "Move the pointer on the private preview.",
    "browser_press_key": "Press one key on the private preview.",
    "browser_select_option": "Choose an option in a select on the private preview.",
    "browser_scroll_up": "Scroll the private preview up. to_top jumps to the start.",
    "browser_scroll_down": "Scroll the private preview down. to_bottom jumps to the end.",
    "browser_console_exec": "Evaluate JavaScript in the private preview page. This is not project_verify and not delivery evidence.",
    "browser_console_view": "Read the latest managed command log, which is the closest console this workspace exposes.",
    "deploy_expose_port": "Start the managed private preview on port. This is not a public deployment.",
    "deploy_apply_deployment": "Start the private preview (same kernel as deploy_expose_port). This is not a public CDN. deployed is always false; previewPrivate is true.",
    "make_manus_page": "Open one existing file in the preview browser. file may be a source .html, or a collected .pptx/.docx/.xlsx (the officeFiles path). The browser opens that file. A missing path fails. This does not start Vite and does not preview a file you did not name.",
    "read_file": "Read one saved source file. path is project-relative. Default (no offset/limit) returns path and a short excerpt, not the full text. Optional offset/limit are 0-based line counts for a window. Same store as file_read. sudo=true is rejected.",
    "write_file": "Overwrite one saved source file with path and content. Do not send approvalRef or hashes. Same store as file_write. sudo=true is rejected.",
    "search_replace": "Replace one unique old_string with new_string in a saved source file. Zero or several matches fail closed. Same store as file_str_replace.",
    "bash": "Run one command in this project's E2B sandbox. Same worker and foreground/background contract as shell_exec: default waits until exit or about {fg_block_secs}s and returns commandFinished plus a short excerpt; full stdout stays in operation logs (project_logs / shell_view). The command is one PTY line — newlines are rejected (write a file with file_write, then python3 that file). An office workspace keeps the same sandbox across commands (installed packages stay). .pptx/.docx/.xlsx written in the workspace are listed on this receipt as officeFiles; that path is the deliverable — do not base64 the file into logs or file_write. is_background=true returns running, not completion. sudo is rejected.",
    "grep": "Search saved source with a regular expression across the tree. Optional path is a file or directory prefix; optional glob limits names. This is not shell execution.",
    "list_dir": "List saved source paths under path. path may be '.' for the whole tree.",
    "glob": "Find saved source paths whose name or relative path matches pattern. Optional path limits the directory prefix.",
    "project_start": "Queue managed installation and Vite startup for an exact approved source revision. Use one idempotencyKey per intended operation, then inspect status/logs. Ready is not verified delivery; private browser preview may remain unavailable. Prefer deploy_expose_port.",
    "project_exec": "Queue one fixed project command (check, build or test) in E2B for the approved source revision. Reuse idempotencyKey on retries. Poll status/logs for actual results. A command passing is not browser or business verification. Prefer shell_exec.",
    "project_status": "Without operationId, discover this session's saved operations and current revision; continue with nextOperationCursor while hasMoreOperations. With operationId, read durable status and optionally wait up to waitSeconds (max 30; it returns as soon as the operation settles, so asking for the full budget costs nothing). A status is not business acceptance. Prefer shell_wait.",
    "project_logs": "Read bounded durable command output. Continue using returned nextSeq and nextOffset until hasMore is false. Full logs remain available through the authorized operation HTTP endpoint. Prefer shell_view.",
    "project_cancel": "Request cancellation of this session project's operation. Cancelling is intent; wait for a terminal status to confirm remote cleanup. Approval is not needed to stop owned work. Prefer shell_kill_process.",
    "project_verify": "Queue a locked-dependency build and the trusted browser suite for this exact approved revision. The task template checks real API creation/edit/filter/refresh and independent writer/reader access; the counter template checks only counting and reload reset. The runtime owner temporarily serves built output, isolates verification data, then restores development. Reuse idempotencyKey on retries and read project_verification. Missing capabilities are blocked; passing covers only the declared suite.",
    "project_verification": "Read trusted browser assertions and artifact references for this session's verification operation. Source or approval changes make old evidence stale. Use real failed assertions to guide source fixes, then request a new verification. For build failures, read project_logs with logOperationId (the runtime owner), not the verification child ID. Never treat queued/completed alone as passed or a template suite as business acceptance.",
}


def interpolate_description(description: str) -> str:
    """把真实上限填进工具描述里。

    抄 grok `TruncationConfig::interpolate_description`：

        .replace("{max_lines_read}", &self.max_lines_read().to_string())

    grok 这么做的理由就是本仓 §4：描述里写死一个数字，改了常量不改描述，
    模型读到的还是旧的——不报错，只是它按一个不存在的窗口去分页。
    从常量渲染出来，两边不可能对不上。
    """
    return (
        description
        .replace("{max_read_chars}", str(PROJECT_READ_MAX_CHARS))
        .replace("{fg_block_secs}", str(int(SHELL_EXEC_FOREGROUND_BLOCK_SECONDS)))
    )


def project_tool_definitions() -> list[dict]:
    return [{"type": "function", "function": {
        "name": name, "description": interpolate_description(_DESCRIPTIONS[name]),
        "parameters": model.model_json_schema(),
    }} for name, model in PROJECT_ARGUMENTS.items()]


PROJECT_TOOLS = project_tool_definitions()
