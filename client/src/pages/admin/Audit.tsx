/**
 * 操作审计。标准答案：ProTable。
 * 停用只翻身份位，还没有单独流水。空状态要说实话。
 */
import { useEffect } from "react";
import type { ProColumns } from "@ant-design/pro-components";
import { ProTable } from "@ant-design/pro-components";

import { useAdminStore, type AdminAuditEntry } from "@/lib/admin-store";

import {
  StaffAlert,
  formatAdminDate,
  formatAdminValue,
  staffPagination,
} from "./admin-page-utils";

export function AdminAuditPage() {
  const audit = useAdminStore(state => state.audit);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadAudit = useAdminStore(state => state.loadAudit);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const columns: ProColumns<AdminAuditEntry>[] = [
    {
      title: "事件",
      dataIndex: "id",
      ellipsis: true,
      copyable: true,
    },
    {
      title: "操作人",
      dataIndex: "actorEmail",
      ellipsis: true,
      render: (_, entry) => formatAdminValue(entry.actorEmail ?? entry.actorId),
    },
    {
      title: "动作",
      dataIndex: "action",
      ellipsis: true,
      render: (_, entry) => formatAdminValue(entry.action),
    },
    {
      title: "对象",
      dataIndex: "targetId",
      ellipsis: true,
      render: (_, entry) =>
        formatAdminValue(
          entry.targetType && entry.targetId
            ? `${entry.targetType}:${entry.targetId}`
            : entry.targetType ?? entry.targetId
        ),
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 160,
      render: (_, entry) => formatAdminDate(entry.createdAt),
    },
  ];

  return (
    <section data-testid="admin-audit-page">
      <StaffAlert error={error} />
      <ProTable<AdminAuditEntry>
        rowKey="id"
        headerTitle="审计"
        cardBordered
        size="small"
        loading={loading}
        dataSource={audit}
        columns={columns}
        search={false}
        options={{ density: true, reload: true, setting: true }}
        pagination={staffPagination("条")}
        locale={{
          emptyText:
            "还没有操作流水。停用目前只改身份库的登录位，没有另记一条审计。",
        }}
      />
    </section>
  );
}
