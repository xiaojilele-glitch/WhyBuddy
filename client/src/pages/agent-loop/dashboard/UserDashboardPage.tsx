/**
 * 登录用户的 Dashboard。版式抄超管总览（问候 + Statistic 横条 +
 * 左项目/运行 + 右用量），数据只走本人接口。
 *
 * ⚠ 不许打 `/api/sliderule/account/admin/*`。那是全站台，闸在超管。
 * 普通人进同一入口看见的是自己的项目、会话、用量。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { PageContainer } from "@ant-design/pro-components";
import { Avatar, Card, Col, List, Row, Statistic, Tag, Typography } from "antd";

import type { AuthUser } from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";
import { slideruleSessionPath } from "@/lib/sliderule-session-id";

import { formatAdminDate, formatTokens } from "@/pages/admin/admin-page-utils";
import { StaffConsolePage } from "@/pages/admin/StaffConsolePage";

import { listApps, type AppStoreSummary } from "./app-store-client";
import { fetchSessionsList } from "./sessions-list-client";
import type { SessionMeta } from "./SidebarSessions";

const PHASE: Record<string, { text: string; color: string }> = {
  orchestrating: { text: "推演中", color: "processing" },
  awaiting: { text: "待确认", color: "warning" },
  done: { text: "完成", color: "success" },
  failed: { text: "失败", color: "error" },
  idle: { text: "空闲", color: "default" },
};

const extraWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  whiteSpace: "nowrap",
  alignItems: "flex-start",
};

const statItem = (last: boolean): CSSProperties => ({
  position: "relative",
  display: "inline-block",
  padding: last ? "0 0 0 24px" : "0 24px",
  borderRight: last ? undefined : "1px solid rgba(5, 5, 5, 0.06)",
});

const headerWrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
};

function helloByHour(hour = new Date().getHours()) {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

interface UsageSummary {
  totals: {
    sessions: number;
    runs: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
  };
  bySession: Array<{
    sessionId: string;
    goal: string;
    runs: number;
    estimatedTokens: number;
  }>;
}

export function AccountDashboardPage() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <p className="px-8 py-8 text-[13px] text-[#737373]" data-testid="user-dashboard-page">
        正在确认登录状态…
      </p>
    );
  }
  if (user?.isSuperuser) return <StaffConsolePage />;
  return <UserDashboardPage user={user} />;
}

export function UserDashboardPage({ user }: { user: AuthUser | null }) {
  const [apps, setApps] = useState<AppStoreSummary[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([
      listApps({ limit: 12, offset: 0, scope: "mine" }),
      fetchSessionsList(),
      fetch("/api/sliderule/usage", { credentials: "include" }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<UsageSummary>;
      }),
    ])
      .then(([mine, sessionBody, usageBody]) => {
        if (!alive) return;
        setApps(mine);
        setSessions((sessionBody.sessions ?? []) as SessionMeta[]);
        setUsage(usageBody);
      })
      .catch(err => {
        if (alive) setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user) {
    return (
      <p className="px-8 py-8 text-[13px] text-[#737373]" data-testid="user-dashboard-page">
        登录后查看自己的项目、会话和用量。
      </p>
    );
  }

  const displayName = user.displayName || user.email;
  const liveProjects = [...apps].slice(0, 6);
  const recentRuns = [...sessions]
    .sort((a, b) =>
      String(b.lastActive || b.createdAt || "").localeCompare(
        String(a.lastActive || a.createdAt || "")
      )
    )
    .slice(0, 8);
  const usageRows = (usage?.bySession ?? []).slice(0, 8);
  const metric = (value: number) => (loading ? "-" : value);

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)]"
      data-testid="user-dashboard-page"
      aria-label="Dashboard"
    >
      <ConfigProvider locale={zhCN}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1280px] px-8 py-8">
            {error ? (
              <p className="mb-4 text-[13px] text-rose-600">{error}</p>
            ) : null}
            <PageContainer
              title={false}
              breadcrumbRender={false}
              content={
                <div style={headerWrap}>
                  <Avatar size={72} src={user.avatarUrl || undefined} style={{ flex: "0 0 72px" }}>
                    {(displayName || "?").trim().charAt(0).toUpperCase()}
                  </Avatar>
                  <div style={{ marginLeft: 24, lineHeight: "22px" }}>
                    <div
                      style={{
                        marginBottom: 12,
                        fontSize: 20,
                        fontWeight: 500,
                        lineHeight: "28px",
                        color: "rgba(0,0,0,0.88)",
                      }}
                    >
                      {helloByHour()}，{displayName}
                    </div>
                    <div style={{ color: "rgba(0,0,0,0.45)" }}>{user.email}</div>
                  </div>
                </div>
              }
              extraContent={
                <div style={extraWrap} data-testid="user-dashboard-stats">
                  {(
                    [
                      { title: "项目", value: metric(apps.length) },
                      { title: "运行", value: metric(sessions.length) },
                      {
                        title: "Token",
                        value: loading ? "-" : formatTokens(usage?.totals.estimatedTokens),
                      },
                    ] as { title: string; value: string | number; suffix?: ReactNode }[]
                  ).map((item, index, list) => (
                    <div key={item.title} style={statItem(index === list.length - 1)}>
                      <Statistic title={item.title} value={item.value} suffix={item.suffix} />
                    </div>
                  ))}
                </div>
              }
              token={{
                paddingInlinePageContainerContent: 0,
                paddingBlockPageContainerContent: 0,
              }}
            >
              <Row gutter={24}>
                <Col xl={16} lg={24} md={24} sm={24} xs={24}>
                  <Card
                    title="进行中的项目"
                    extra={<a href="/agent-loop/workbench">全部</a>}
                    variant="borderless"
                    loading={loading && !apps.length}
                    styles={{ body: { padding: 0 } }}
                    style={{ marginBottom: 24 }}
                  >
                    {liveProjects.length ? (
                      liveProjects.map(project => (
                        <Card.Grid key={project.id} hoverable={false} style={{ width: "33.33%" }}>
                          <Card.Meta
                            title={
                              <Typography.Text ellipsis={{ tooltip: true }}>
                                {project.product_name || project.goal || project.id}
                              </Typography.Text>
                            }
                            description={
                              <Typography.Text
                                type="secondary"
                                ellipsis={{ tooltip: true }}
                                style={{ width: "100%" }}
                              >
                                {project.goal && project.goal !== project.product_name
                                  ? project.goal
                                  : project.theme_label || "我的应用"}
                              </Typography.Text>
                            }
                          />
                          <div
                            style={{
                              display: "flex",
                              marginTop: 8,
                              fontSize: 12,
                              color: "rgba(0,0,0,0.45)",
                            }}
                          >
                            <span>{formatAdminDate(project.created_at)}</span>
                          </div>
                        </Card.Grid>
                      ))
                    ) : (
                      <div style={{ padding: 24, color: "rgba(0,0,0,0.45)" }}>
                        {loading ? "正在读取…" : "还没有项目"}
                      </div>
                    )}
                  </Card>
                  <Card
                    title="最近运行"
                    extra={<a href="/agent-loop/sliderule">全部</a>}
                    variant="borderless"
                    style={{ marginBottom: 24 }}
                  >
                    <List
                      loading={loading && !sessions.length}
                      locale={{ emptyText: loading ? "正在读取…" : "还没有运行记录" }}
                      dataSource={recentRuns}
                      renderItem={run => {
                        const phase = PHASE[String(run.phase || "idle")] || PHASE.idle;
                        const href = slideruleSessionPath(run.sessionId);
                        return (
                          <List.Item extra={<Tag color={phase.color}>{phase.text}</Tag>}>
                            <List.Item.Meta
                              title={
                                <a href={href}>
                                  <Typography.Text ellipsis={{ tooltip: true }}>
                                    {run.goal || run.sessionId}
                                  </Typography.Text>
                                </a>
                              }
                              description={formatAdminDate(run.lastActive || run.createdAt)}
                            />
                          </List.Item>
                        );
                      }}
                    />
                  </Card>
                </Col>
                <Col xl={8} lg={24} md={24} sm={24} xs={24}>
                  <Card title="用量" variant="borderless">
                    <List
                      loading={loading && !usage}
                      locale={{ emptyText: loading ? "正在读取…" : "还没有用量台账" }}
                      dataSource={usageRows}
                      renderItem={row => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <Typography.Text ellipsis={{ tooltip: true }}>
                                {row.goal || row.sessionId}
                              </Typography.Text>
                            }
                            description={`${formatTokens(row.estimatedTokens)} tokens · ${row.runs} 次`}
                          />
                        </List.Item>
                      )}
                    />
                  </Card>
                </Col>
              </Row>
            </PageContainer>
          </div>
        </div>
      </ConfigProvider>
    </div>
  );
}
