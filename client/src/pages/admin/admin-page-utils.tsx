/**
 * 管理台共用：格式化和 ProTable 默认分页。
 *
 * 列表页本身用 Ant Design ProTable（省略号、tooltip、分页、筛选都是
 * 组件自带的）。总览对照 ant-design-pro 工作台，走 PageContainer
 * extraContent + Statistic，不走 StatisticCard.Group。
 */
import { Alert } from "antd";
import type { TablePaginationConfig } from "antd";

export function formatAdminDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNeverLogin(value: string | null | undefined) {
  if (!value) return "从未登录";
  return formatAdminDate(value);
}

export function staffSeenAt(user: {
  lastLoginAt?: string | null;
  lastActiveAt?: string | null;
}): string | null {
  const login = user.lastLoginAt || "";
  const active = user.lastActiveAt || "";
  if (login && active) return login > active ? login : active;
  return login || active || null;
}

export function formatAdminValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function formatTokens(value: number | undefined) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function ownerLabel(
  ownerId: string | null | undefined,
  users: { id: string; email: string; displayName: string | null }[]
) {
  if (!ownerId) return "无主";
  const hit = users.find(user => user.id === ownerId);
  if (!hit) return ownerId.slice(0, 8);
  return hit.displayName || hit.email;
}

export function localizeAdminError(message: string): string {
  if (
    message === "Admin route failed" ||
    message === "Admin privileges required" ||
    message.startsWith("Unable to load admin")
  ) {
    return "管理接口暂时读不到";
  }
  return message;
}

export function staffPagination(unit = "条"): TablePaginationConfig {
  return {
    defaultPageSize: 10,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50],
    showTotal: (total, range) =>
      range
        ? `共 ${total} ${unit} · ${range[0]}-${range[1]}`
        : `共 ${total} ${unit}`,
  };
}

export function StaffAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert
      type="error"
      showIcon
      message={localizeAdminError(error)}
      style={{ marginBottom: 16 }}
    />
  );
}
