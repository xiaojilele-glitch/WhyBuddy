/**
 * POST /sessions/:id/project 失败时对用户说的话。
 *
 * ⚠ 2026-09-15 真机 TicketStream：网关把 Python 的 409 收成
 *   `{ status: "error", message: "project_initial_plan_changed" }`，
 *   不是 FastAPI 文档里的 `{ detail: "…" }`。第一版只认 `detail`，
 *   条件永远不成立，界面上只剩「请刷新状态后重试」。
 */

const PROJECT_CONVERSION_REQUIRED =
  "当前会话已有 HTML 应用，请新建会话创建工程，或通过显式转换迁移。";

export function projectCreateFailureCode(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  return String(row.detail || row.message || "").trim();
}

export function projectCreateFailureText(payload: unknown): string {
  const code = projectCreateFailureCode(payload);
  if (code === "project_rollout_disabled") return "工程模式当前未启用。";
  if (code === "project_plan_approval_required")
    return "当前计划授权已失效，请重新批准计划。";
  if (code === "project_conversion_required") return PROJECT_CONVERSION_REQUIRED;
  if (code === "project_initial_plan_changed")
    return "这份会话里已经有一份按另一份计划建的工程，和当前批准对不上。";
  return "工程创建未完成，请刷新状态后重试。";
}
