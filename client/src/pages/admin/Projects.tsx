/**
 * 全站应用。标准答案：ProTable。长目标走列上 ellipsis（自带 tooltip）。
 * 活路径 `/api/sliderule/account/admin/apps`，不是 Node `/api/admin/projects`。
 */
import { useEffect, useMemo, useState } from "react";
import { Tag } from "antd";
import type { ProColumns } from "@ant-design/pro-components";
import { ProTable } from "@ant-design/pro-components";

import { useAdminStore, type AdminProject } from "@/lib/admin-store";

import {
  StaffAlert,
  formatAdminDate,
  ownerLabel,
  staffPagination,
} from "./admin-page-utils";

export function AdminProjectsPage() {
  const projects = useAdminStore(state => state.projects);
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadProjects = useAdminStore(state => state.loadProjects);
  const loadUsers = useAdminStore(state => state.loadUsers);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    void loadProjects();
    void loadUsers();
  }, [loadProjects, loadUsers]);

  const dataSource = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(project => {
      const owner = ownerLabel(project.ownerUserId, users).toLowerCase();
      return (
        project.name.toLowerCase().includes(needle) ||
        (project.description || "").toLowerCase().includes(needle) ||
        owner.includes(needle)
      );
    });
  }, [projects, users, keyword]);

  const columns: ProColumns<AdminProject>[] = [
    {
      title: "项目",
      dataIndex: "name",
      ellipsis: true,
      render: (_, project) => (
        <span>
          {project.name}
          {project.isOfficial ? <Tag style={{ marginLeft: 8 }}>官方</Tag> : null}
        </span>
      ),
    },
    {
      title: "目标",
      dataIndex: "description",
      ellipsis: true,
      search: false,
      render: (_, project) =>
        project.description && project.description !== project.name
          ? project.description
          : "-",
    },
    {
      title: "所有者",
      dataIndex: "ownerUserId",
      ellipsis: true,
      width: 160,
      render: (_, project) => ownerLabel(project.ownerUserId, users),
    },
    {
      title: "可见性",
      dataIndex: "visibility",
      width: 100,
      filters: true,
      valueEnum: {
        private: { text: "私有" },
        public: { text: "公开" },
        unlisted: { text: "不公开列表" },
      },
      render: (_, project) => {
        const key = project.visibility || "private";
        if (key === "public") return <Tag color="success">公开</Tag>;
        if (key === "unlisted") return <Tag>不公开列表</Tag>;
        return <Tag>私有</Tag>;
      },
    },
    {
      title: "页面",
      dataIndex: "pageCount",
      width: 80,
      search: false,
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 140,
      search: false,
      sorter: (a, b) =>
        (a.updatedAt || a.createdAt).localeCompare(b.updatedAt || b.createdAt),
      render: (_, project) => formatAdminDate(project.updatedAt),
    },
  ];

  return (
    <section data-testid="admin-projects-page">
      <StaffAlert error={error} />
      <div data-testid="admin-projects-search">
        <ProTable<AdminProject>
          rowKey="id"
          headerTitle="项目"
          cardBordered
          size="small"
          loading={loading}
          dataSource={dataSource}
          columns={columns}
          search={false}
          options={{ density: true, reload: true, setting: true }}
          pagination={staffPagination("个")}
          toolbar={{
            search: {
              placeholder: "搜索名称、目标或主人",
              onSearch: value => setKeyword(value),
            },
          }}
        />
      </div>
    </section>
  );
}
