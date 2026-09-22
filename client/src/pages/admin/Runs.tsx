/**
 * 全站话题。标准答案：ProTable。活路径 `/api/sliderule/account/admin/sessions`。
 */
import { useEffect, useMemo, useState } from "react";
import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";
import { ProTable } from "@ant-design/pro-components";

import { useAdminStore, type AdminRun } from "@/lib/admin-store";

import {
  StaffAlert,
  formatAdminDate,
  ownerLabel,
  staffPagination,
} from "./admin-page-utils";

const PHASE_ENUM = {
  orchestrating: { text: "推演中", status: "Processing" },
  awaiting: { text: "待确认", status: "Warning" },
  done: { text: "完成", status: "Success" },
  failed: { text: "失败", status: "Error" },
  idle: { text: "空闲", status: "Default" },
} as const;

export function AdminRunsPage() {
  const runs = useAdminStore(state => state.runs);
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadRuns = useAdminStore(state => state.loadRuns);
  const loadUsers = useAdminStore(state => state.loadUsers);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    void loadRuns();
    void loadUsers();
  }, [loadRuns, loadUsers]);

  const dataSource = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter(run => {
      const owner = ownerLabel(run.userId, users).toLowerCase();
      return (
        String(run.title || "").toLowerCase().includes(needle) ||
        String(run.id).toLowerCase().includes(needle) ||
        owner.includes(needle)
      );
    });
  }, [runs, users, keyword]);

  const columns: ProColumns<AdminRun>[] = [
    {
      title: "运行",
      dataIndex: "title",
      ellipsis: true,
    },
    {
      title: "编号",
      dataIndex: "id",
      ellipsis: true,
      width: 180,
      copyable: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      filters: true,
      valueEnum: PHASE_ENUM,
      render: (_, run) => {
        const key = String(run.status || "idle") as keyof typeof PHASE_ENUM;
        const hit = PHASE_ENUM[key] || PHASE_ENUM.idle;
        const color =
          key === "failed"
            ? "error"
            : key === "done"
              ? "success"
              : key === "orchestrating"
                ? "processing"
                : "default";
        return <Tag color={color}>{hit.text}</Tag>;
      },
    },
    {
      title: "用户",
      dataIndex: "userId",
      ellipsis: true,
      width: 160,
      render: (_, run) => ownerLabel(run.userId, users),
    },
    {
      title: "产物",
      dataIndex: "artifactCount",
      width: 80,
      search: false,
    },
    {
      title: "开始",
      dataIndex: "startedAt",
      width: 140,
      search: false,
      render: (_, run) => formatAdminDate(run.startedAt ?? run.createdAt),
    },
    {
      title: "活动",
      dataIndex: "updatedAt",
      width: 140,
      search: false,
      sorter: (a, b) =>
        String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
      render: (_, run) => formatAdminDate(run.updatedAt),
    },
  ];

  return (
    <section data-testid="admin-runs-page">
      <StaffAlert error={error} />
      <div data-testid="admin-runs-search">
        <ProTable<AdminRun>
          rowKey="id"
          headerTitle="运行"
          cardBordered
          size="small"
          loading={loading}
          dataSource={dataSource}
          columns={columns}
          search={false}
          options={{ density: true, reload: true, setting: true }}
          pagination={staffPagination("条")}
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
