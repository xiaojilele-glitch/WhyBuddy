/**
 * 超管用户表。标准答案：Ant Design ProTable
 * （搜索、筛选、分页、长文本省略号 + tooltip 都是组件自带的）。
 *
 * 活路径是 `/api/sliderule/account/admin/users`（Python SuperUser），
 * 不是旧 Node `/api/admin/users` 的 MySQL 表。不建号、不配菜单权限。
 */
import { useEffect, useMemo, useState } from "react";
import { Avatar, Button, Modal, Space, Tag, Typography } from "antd";
import type { ProColumns } from "@ant-design/pro-components";
import { ProTable } from "@ant-design/pro-components";

import { STAFF_USERS_PATH, useAdminStore, type AdminUser } from "@/lib/admin-store";
import { useAuth } from "@/lib/use-auth";

import {
  StaffAlert,
  formatAdminDate,
  formatNeverLogin,
  formatTokens,
  staffPagination,
  staffSeenAt,
} from "./admin-page-utils";

function isSuper(user: AdminUser) {
  return user.isSuperuser || user.role === "super_admin";
}

function isActive(user: AdminUser) {
  return user.isActive !== false && user.status !== "disabled";
}

export function AdminUsersPage({ embedded = false }: { embedded?: boolean }) {
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadUsers = useAdminStore(state => state.loadUsers);
  const setUserActive = useAdminStore(state => state.setUserActive);
  const me = useAuth().user;
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const dataSource = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(user => {
      const name = (user.displayName || "").toLowerCase();
      return user.email.toLowerCase().includes(needle) || name.includes(needle);
    });
  }, [users, keyword]);

  const columns: ProColumns<AdminUser>[] = [
    {
      title: "成员",
      dataIndex: "email",
      ellipsis: true,
      render: (_, user) => {
        const letter = (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();
        return (
          <Space>
            <Avatar src={user.avatarUrl || undefined} size="small">
              {letter}
            </Avatar>
            <div style={{ minWidth: 0, maxWidth: 280 }}>
              <Typography.Text ellipsis={{ tooltip: true }} style={{ maxWidth: 280 }}>
                {user.displayName || user.email}
              </Typography.Text>
              <div>
                <Typography.Text
                  type="secondary"
                  ellipsis={{ tooltip: true }}
                  style={{ maxWidth: 280, fontSize: 12 }}
                >
                  {user.email}
                </Typography.Text>
              </div>
            </div>
          </Space>
        );
      },
    },
    {
      title: "身份",
      dataIndex: "status",
      width: 100,
      filters: true,
      valueEnum: {
        active: { text: "正常", status: "Success" },
        disabled: { text: "已停用", status: "Error" },
        admin: { text: "超管", status: "Processing" },
      },
      render: (_, user) => {
        if (!isActive(user)) return <Tag color="error">已停用</Tag>;
        if (isSuper(user)) return <Tag color="processing">超管</Tag>;
        return <Tag>正常</Tag>;
      },
    },
    {
      title: "话题",
      dataIndex: "sessions",
      width: 80,
      search: false,
      sorter: (a, b) => (a.sessions || 0) - (b.sessions || 0),
    },
    {
      title: "用量",
      dataIndex: "estimatedTokens",
      width: 90,
      search: false,
      sorter: (a, b) => (a.estimatedTokens || 0) - (b.estimatedTokens || 0),
      render: (_, user) => formatTokens(user.estimatedTokens),
    },
    {
      title: "最后活动",
      dataIndex: "lastActiveAt",
      width: 140,
      search: false,
      render: (_, user) => formatNeverLogin(staffSeenAt(user)),
    },
    {
      title: "注册",
      dataIndex: "createdAt",
      width: 140,
      search: false,
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (_, user) => formatAdminDate(user.createdAt),
    },
    {
      title: "操作",
      valueType: "option",
      width: 88,
      render: (_, user) => {
        const self = me?.id === user.id;
        const superuser = isSuper(user);
        const active = isActive(user);
        const disableBlocked = self || superuser;
        if (active) {
          return [
            <Button
              key="off"
              type="link"
              danger
              size="small"
              data-testid={`admin-user-toggle-${user.id}`}
              disabled={disableBlocked}
              title={
                self ? "不能停用自己" : superuser ? "不能停用其他超管" : "停用后无法登录"
              }
              onClick={() => {
                Modal.confirm({
                  title: "停用这个账号？",
                  content: `${user.email} 将无法再登录。账号还在，之后可以恢复。`,
                  okText: "停用",
                  okButtonProps: { danger: true },
                  cancelText: "取消",
                  onOk: () => setUserActive(user.id, false),
                });
              }}
            >
              停用
            </Button>,
          ];
        }
        return [
          <Button
            key="on"
            type="link"
            size="small"
            data-testid={`admin-user-toggle-${user.id}`}
            onClick={() => void setUserActive(user.id, true)}
          >
            恢复
          </Button>,
        ];
      },
    },
  ];

  return (
    <section
      data-testid="admin-users-page"
      data-staff-users-path={STAFF_USERS_PATH}
      data-embedded={embedded ? "true" : undefined}
    >
      <StaffAlert error={error} />
      <div data-testid="admin-users-search">
        <ProTable<AdminUser>
          rowKey="id"
          headerTitle="用户"
          cardBordered
          size="small"
          loading={loading}
          dataSource={dataSource}
          columns={columns}
          search={false}
          options={{
            density: true,
            reload: true,
            setting: true,
          }}
          pagination={staffPagination("人")}
          toolbar={{
            search: {
              placeholder: "搜索邮箱或昵称",
              onSearch: value => {
                setKeyword(value);
              },
            },
          }}
          onReset={() => setKeyword("")}
        />
      </div>
    </section>
  );
}
