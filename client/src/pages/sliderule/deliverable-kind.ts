/**
 * 批准计划上的交付物类别。跟 Python `services/deliverable_kind.py` 同一份事实。
 *
 * ⚠ 2026-09-20 真机 sr-20260920051924-QA0YXX59Q0：做 PPT 被编成
 *   react-vite-tasks，右栏出现「登录任务清单」。类别由 write_plan 落库，
 *   缺省 web-app，不猜用户那句话像不像 PPT。
 */

export const WEB_APP = "web-app";
export const OFFICE_FILE = "office-file";

export type DeliverableKind = typeof WEB_APP | typeof OFFICE_FILE;

export function planDeliverableKind(plan: unknown): DeliverableKind {
  if (!plan || typeof plan !== "object") return WEB_APP;
  const raw = (plan as { deliverableKind?: unknown }).deliverableKind;
  return raw === OFFICE_FILE ? OFFICE_FILE : WEB_APP;
}

export function latestPlanDeliverableKind(
  rows: ReadonlyArray<Record<string, unknown>> | null | undefined
): DeliverableKind {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    const row = rows?.[i];
    if (row && row.kind === "plan_written") return planDeliverableKind(row);
  }
  return WEB_APP;
}

/** plan_written 必须自己带着键。缺键不是缺省 web-app——那是合同没落盘。 */
export function planWrittenHasDeliverableKind(
  rows: ReadonlyArray<Record<string, unknown>> | null | undefined
): boolean {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    const row = rows?.[i];
    if (row && row.kind === "plan_written") {
      return Object.prototype.hasOwnProperty.call(row, "deliverableKind");
    }
  }
  return false;
}

export function isOfficeFileDeliverable(kind: string | undefined | null): boolean {
  return kind === OFFICE_FILE;
}

/** 办公文件前端仍可 POST react-vite；host 按批准计划覆盖成空工作区。 */
export function projectTemplateForDeliverable(
  kind: string | undefined | null
): "react-vite" | "react-vite-tasks" {
  return isOfficeFileDeliverable(kind) ? "react-vite" : "react-vite-tasks";
}
