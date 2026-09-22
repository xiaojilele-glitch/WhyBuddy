/**
 * 失败的推演。标准答案：ProTable。从全站会话筛 phase=failed。
 */
import { useEffect, useMemo, useState } from "react";
import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";
import { ProTable } from "@ant-design/pro-components";

import { useAdminStore, type AdminFailure } from "@/lib/admin-store";

import {
  StaffAlert,
  formatAdminDate,
  ownerLabel,
  staffPagination,
} from "./admin-page-utils";

export function AdminFailuresPage() {
  const failures = useAdminStore(state => state.failures);
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadFailures = useAdminStore(state => state.loadFailures);
  const loadUsers = useAdminStore(state => state.loadUsers);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    void loadFailures();
    void loadUsers();
  }, [loadFailures, loadUsers]);

  const dataSource = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return failures;
    return failures.filter(failure => {
      const owner = ownerLabel(failure.userId, users).toLowerCase();
      return (
        String(failure.message || "").toLowerCase().includes(needle) ||
        String(failure.runId || failure.id).toLowerCase().includes(needle) ||
        owner.includes(needle)
      );
    });
  }, [failures, users, keyword]);

  const columns: ProColumns<AdminFailure>[] = [
    {
      title: "失败",
      dataIndex: "message",
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: () => <Tag color="error">失败</Tag>,
    },
    {
      title: "用户",
      dataIndex: "userId",
      ellipsis: true,
      width: 160,
      render: (_, failure) => ownerLabel(failure.userId, users),
    },
    {
      title: "运行",
      dataIndex: "runId",
      ellipsis: true,
      copyable: true,
      width: 180,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 140,
      render: (_, failure) => formatAdminDate(failure.createdAt),
    },
  ];

  return (
    <section data-testid="admin-failures-page">
      <StaffAlert error={error} />
      <div data-testid="admin-failures-search">
        <ProTable<AdminFailure>
          rowKey="id"
          headerTitle="失败"
          cardBordered
          size="small"
          loading={loading}
          dataSource={dataSource}
          columns={columns}
          search={false}
          options={{ density: true, reload: true, setting: true }}
          pagination={staffPagination("条")}
          locale={{
            emptyText: loading ? "正在读取失败记录…" : "没有失败记录",
          }}
          toolbar={{
            search: {
              placeholder: "搜索目标、编号或主人",
              onSearch: value => setKeyword(value),
            },
          }}
        />
      </div>
    </section>
  );
}
