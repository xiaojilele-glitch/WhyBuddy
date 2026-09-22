"""Injectable Python runtime boundary for mcp.call.

⚠ 2026-08-27：非产品流、流式 driver 不调、禁止接成控制面。
事故：mcp_runtime 是独立可注入适配器（测试/node_bridge 才 set），
v5_full_driver 与 rehearsal_control 零引用。若把薄控制面接到这里，
会变成不通电的插座——那是编码 Agent 的 MCP 应用商店 DNA，不是
推演母语。产品流走封闭工具表 + 工厂信封，不走本适配器。

This module defines the adapter and permission-check interfaces only. It never
opens a network connection or supplies a fake production adapter; tests inject
their own fakes through create_mcp_runtime().
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Tuple

from models.v5_state import V5SessionState

MCP_RUNTIME_NAME = "python"
MCP_RUNTIME_PROVENANCE = "python-mcp-runtime"
FAKE_MCP_RUNTIME_PROVENANCE = "python-fake-mcp"
PERMISSION_PROVENANCE = "python-mcp-permission"


class McpAdapterError(Exception):
    """Base class for adapter-side mcp.call runtime failures."""

    error_type = "adapter_error"
    error_code = "mcp_adapter_error"


class McpAdapterUnavailable(McpAdapterError):
    """Raised when the injectable MCP adapter is missing or down."""

    error_type = "adapter_unavailable"
    error_code = "mcp_adapter_unavailable"


class McpToolNotFoundError(McpAdapterError):
    """Raised when the adapter does not expose the requested tool."""

    error_type = "tool_not_found"
    error_code = "mcp_tool_not_found"


class McpPermissionCheckError(Exception):
    """Raised when the permission checker itself fails."""

    error_type = "permission_error"
    error_code = "mcp_permission_check_failed"


@dataclass(frozen=True)
class McpToolInvokeRequest:
    server_id: str
    tool_name: str
    arguments: Dict[str, Any]
    input: str
    session_id: str = ""
    role_id: str = ""
    turn_id: str = ""
    input_artifact_ids: Tuple[str, ...] = ()


@dataclass(frozen=True)
class McpPermissionRequest:
    server_id: str
    tool_name: str
    arguments: Dict[str, Any]
    input: str
    session_id: str
    role_id: str
    turn_id: str
    input_artifact_ids: Tuple[str, ...]


@dataclass(frozen=True)
class McpPermissionDecision:
    allowed: bool
    reason: str = ""
    provenance: str = PERMISSION_PROVENANCE
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class McpToolInvokeResult:
    output: str
    response: Any = None
    provenance: str = MCP_RUNTIME_PROVENANCE


class McpToolAdapter(Protocol):
    def invoke(self, request: McpToolInvokeRequest) -> McpToolInvokeResult:
        ...


class McpPermissionChecker(Protocol):
    def check(self, request: McpPermissionRequest) -> McpPermissionDecision:
        ...


@dataclass(frozen=True)
class McpRuntime:
    adapter: McpToolAdapter
    permission_checker: McpPermissionChecker


_mcp_runtime: Optional[McpRuntime] = None


def set_mcp_runtime(runtime: Optional[McpRuntime]) -> None:
    global _mcp_runtime
    _mcp_runtime = runtime


def get_mcp_runtime() -> Optional[McpRuntime]:
    return _mcp_runtime


def create_mcp_runtime(
    *,
    adapter: McpToolAdapter,
    permission_checker: McpPermissionChecker,
) -> McpRuntime:
    """Create an explicit mcp.call runtime.

    Callers must provide a permission checker. The helper does not install an
    allow-all default because that would make the adapter boundary bypassable.
    """

    return McpRuntime(adapter=adapter, permission_checker=permission_checker)


def _mcp_params_from_state(state: V5SessionState) -> tuple[str, str, Dict[str, Any]]:
    goal = state.goal if isinstance(state.goal, dict) else {}
    server_id = str(goal.get("mcpServerId") or goal.get("serverId") or "mcp-server")
    tool_name = str(goal.get("mcpToolName") or goal.get("toolName") or "mcp.call")
    arguments = dict(goal.get("mcpArguments") or goal.get("arguments") or {})
    return server_id, tool_name, arguments


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def _permission_payload(decision: McpPermissionDecision) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "allowed": decision.allowed,
        "provenance": decision.provenance,
    }
    if decision.reason:
        payload["reason"] = decision.reason
    if decision.details:
        payload["details"] = decision.details
    return payload


def _error_result(
    *,
    title: str,
    summary: str,
    content: str,
    provenance: str,
    error: str,
    error_type: str,
    server_id: str,
    tool_name: str,
    arguments: Dict[str, Any],
    permission: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "title": title,
        "summary": summary,
        "content": content,
        "runtime": MCP_RUNTIME_NAME,
        "runtimeProvenance": MCP_RUNTIME_PROVENANCE,
        "provenance": provenance,
        "degraded": True,
        "error": error,
        "errorType": error_type,
        "toolName": tool_name,
        "serverId": server_id,
        "arguments": arguments,
        "sources": [],
    }
    if permission is not None:
        result["permission"] = permission
    return result


def execute_mcp_call_with_runtime(
    state: V5SessionState,
    role_id: str,
    turn_id: str,
    input_artifact_ids: List[str],
    *,
    runtime: Optional[McpRuntime] = None,
) -> Dict[str, Any]:
    active = runtime or _mcp_runtime
    if active is None:
        raise RuntimeError("mcp runtime is not configured")

    goal_text = _goal_text(state)
    server_id, tool_name, arguments = _mcp_params_from_state(state)
    artifact_ids = tuple(input_artifact_ids)
    permission_request = McpPermissionRequest(
        server_id=server_id,
        tool_name=tool_name,
        arguments=arguments,
        input=goal_text,
        session_id=state.sessionId,
        role_id=role_id,
        turn_id=turn_id,
        input_artifact_ids=artifact_ids,
    )

    try:
        decision = active.permission_checker.check(permission_request)
    except McpPermissionCheckError as exc:
        return _error_result(
            title="mcp.call permission check failed",
            summary="The Python mcp.call permission checker failed before adapter invocation",
            content=str(exc),
            provenance=PERMISSION_PROVENANCE,
            error=exc.error_code,
            error_type=exc.error_type,
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments,
        )
    except Exception as exc:  # noqa: BLE001
        return _error_result(
            title="mcp.call permission check failed",
            summary="The Python mcp.call permission checker failed before adapter invocation",
            content=str(exc),
            provenance=PERMISSION_PROVENANCE,
            error="mcp_permission_check_failed",
            error_type="permission_error",
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments,
        )

    permission_payload = _permission_payload(decision)
    if not decision.allowed:
        return _error_result(
            title="mcp.call permission denied",
            summary="The Python mcp.call runtime denied the request before adapter invocation",
            content=decision.reason or "permission denied",
            provenance=decision.provenance,
            error="mcp_permission_denied",
            error_type="permission_denied",
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments,
            permission=permission_payload,
        )

    invoke_request = McpToolInvokeRequest(
        server_id=server_id,
        tool_name=tool_name,
        arguments=arguments,
        input=goal_text,
        session_id=state.sessionId,
        role_id=role_id,
        turn_id=turn_id,
        input_artifact_ids=artifact_ids,
    )

    try:
        result = active.adapter.invoke(invoke_request)
    except McpAdapterError as exc:
        return _error_result(
            title="mcp.call adapter failed",
            summary="The Python mcp.call adapter returned a runtime error",
            content=str(exc),
            provenance=MCP_RUNTIME_PROVENANCE,
            error=exc.error_code,
            error_type=exc.error_type,
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments,
            permission=permission_payload,
        )
    except Exception as exc:  # noqa: BLE001
        return _error_result(
            title="mcp.call adapter failed",
            summary="The Python mcp.call adapter returned a runtime error",
            content=str(exc),
            provenance=MCP_RUNTIME_PROVENANCE,
            error="mcp_adapter_error",
            error_type="adapter_error",
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments,
            permission=permission_payload,
        )

    return {
        "title": f"mcp.call {tool_name}",
        "summary": "Python mcp.call runtime adapter returned a tool result",
        "content": result.output,
        "runtime": MCP_RUNTIME_NAME,
        "runtimeProvenance": MCP_RUNTIME_PROVENANCE,
        "provenance": result.provenance,
        "degraded": False,
        "toolName": tool_name,
        "serverId": server_id,
        "arguments": arguments,
        "toolResult": result.response if result.response is not None else {"output": result.output},
        "permission": permission_payload,
        "sources": [],
    }
