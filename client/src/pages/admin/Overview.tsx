/**
 * 总览。标准答案是 ant-design/ant-design-pro 工作台，不是自己拼一张
 * 指标卡再底下塞两张表。
 *
 * 对照 GitHub `ant-design/ant-design-pro`
 * `src/pages/dashboard/workplace/index.tsx`（master）：
 *   PageContainer 的 content + extraContent —— 左侧问候，右侧 antd
 *   Statistic 横排（带竖分割线）；
 *   下面 Row xl={16}+xl={8}：左栏 Card.Grid「进行中的项目」+ List
 *   「动态」，右栏名单。
 *
 * ⚠ 2026-08-21 真机：把五个数字放进内容区 StatisticCard.Group，再外包
 * <a>，Group 只认直接子卡片，flex 塌成一列，整页变成「一张空白板竖着
 * 五个数」。本页套在 DashboardApp `prefixCls="agent-ant"` 里，ProCard
 * 的横排样式对不上这个前缀。指标条跟 workplace ExtraContent 一样走
 * antd Statistic，不许再塞回 Group。
 */
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { PageContainer } from "@ant-design/pro-components";
import { Avatar, Card, Col, List, Row, Statistic, Tag, Typography } from "antd";

import { useAdminStore } from "@/lib/admin-store";
import { useAuth } from "@/lib/use-auth";

import {
  StaffAlert,
  formatAdminDate,
  formatNeverLogin,
  formatTokens,
  ownerLabel,
  staffSeenAt,
} from "./admin-page-utils";

function staffHref(section: string) {
  return section === "overview" ? "/agent-loop/admin" : `/agent-loop/admin/${section}`;
}

const PHASE: Record<string, { text: string; color: string }> = {
  orchestrating: { text: "推演中", color: "processing" },
  awaiting: { text: "待确认", color: "warning" },
  done: { text: "完成", color: "success" },
  failed: { text: "失败", color: "error" },
  idle: { text: "空闲", color: "default" },
};

function helloByHour(hour = new Date().getHours()) {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

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

function PageHeaderContent({ name, email }: { name: string; email: string }) {
  const letter = (name || email || "?").trim().charAt(0).toUpperCase();
  return (
    <div style={headerWrap}>
      <Avatar size={72} style={{ flex: "0 0 72px" }}>
        {letter}
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
          {helloByHour()}，{name}
        </div>
        <div style={{ color: "rgba(0,0,0,0.45)" }}>{email} · 超管</div>
      </div>
    </div>
  );
}

function ExtraContent({
  items,
}: {
  items: { title: string; value: string | number; suffix?: ReactNode }[];
}) {
  return (
    <div style={extraWrap} data-testid="admin-overview-stats">
      {items.map((item, index) => (
        <div key={item.title} style={statItem(index === items.length - 1)}>
          <Statistic title={item.title} value={item.value} suffix={item.suffix} />
        </div>
      ))}
    </div>
  );
}

export function AdminOverviewPage() {
  const me = useAuth().user;
  const summary = useAdminStore(state => state.summary);
  const users = useAdminStore(state => state.users);
  const projects = useAdminStore(state => state.projects);
  const runs = useAdminStore(state => state.runs);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadOverview = useAdminStore(state => state.loadOverview);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const displayName = me?.displayName || me?.email || "超管";
  const recentUsers = [...users]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  const recentRuns = [...runs]
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(
        String(a.updatedAt || a.createdAt || "")
      )
    )
    .slice(0, 8);
  const liveProjects = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  const metric = (key: keyof NonNullable<typeof summary>) =>
    loading && !summary ? "-" : Number(summary?.[key] ?? 0);

  return (
    <section data-testid="admin-overview-page">
      <StaffAlert error={error} />
      <PageContainer
        title={false}
        breadcrumbRender={false}
        content={
          <PageHeaderContent
            name={displayName}
            email={me?.email || ""}
          />
        }
        extraContent={
          <ExtraContent
            items={[
              { title: "用户", value: metric("users") },
              { title: "项目", value: metric("projects") },
              { title: "运行", value: metric("runs") },
              { title: "失败", value: metric("failures") },
              { title: "审计", value: metric("audit") },
            ]}
          />
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
              extra={<a href={staffHref("projects")}>全部</a>}
              variant="borderless"
              loading={loading && !projects.length}
              styles={{ body: { padding: 0 } }}
              style={{ marginBottom: 24 }}
            >
              {liveProjects.length ? (
                liveProjects.map(project => (
                  <Card.Grid
                    key={project.id}
                    hoverable={false}
                    style={{ width: "33.33%" }}
                  >
                    <Card.Meta
                      title={
                        <Typography.Text ellipsis={{ tooltip: true }}>
                          {project.name}
                        </Typography.Text>
                      }
                      description={
                        <Typography.Text
                          type="secondary"
                          ellipsis={{ tooltip: true }}
                          style={{ width: "100%" }}
                        >
                          {project.description && project.description !== project.name
                            ? project.description
                            : ownerLabel(project.ownerUserId, users)}
                        </Typography.Text>
                      }
                    />
                    <div
                      style={{
                        display: "flex",
                        marginTop: 8,
                        fontSize: 12,
                        color: "rgba(0,0,0,0.45)",
                        gap: 8,
                        overflow: "hidden",
                      }}
                    >
                      <Typography.Text
                        type="secondary"
                        ellipsis={{ tooltip: true }}
                        style={{ flex: 1, fontSize: 12 }}
                      >
                        {ownerLabel(project.ownerUserId, users)}
                      </Typography.Text>
                      <span style={{ flex: "0 0 auto" }}>
                        {formatAdminDate(project.updatedAt)}
                      </span>
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
              extra={<a href={staffHref("runs")}>全部</a>}
              variant="borderless"
              style={{ marginBottom: 24 }}
            >
              <List
                loading={loading && !runs.length}
                locale={{ emptyText: loading ? "正在读取…" : "还没有运行记录" }}
                dataSource={recentRuns}
                renderItem={run => {
                  const phase = PHASE[String(run.status || "idle")] || PHASE.idle;
                  return (
                    <List.Item extra={<Tag color={phase.color}>{phase.text}</Tag>}>
                      <List.Item.Meta
                        title={
                          <Typography.Text ellipsis={{ tooltip: true }}>
                            {run.title || run.id}
                          </Typography.Text>
                        }
                        description={`${ownerLabel(run.userId, users)} · ${formatAdminDate(
                          run.updatedAt || run.createdAt
                        )}`}
                      />
                    </List.Item>
                  );
                }}
              />
            </Card>
          </Col>
          <Col xl={8} lg={24} md={24} sm={24} xs={24}>
            <Card
              title="最近用户"
              extra={<a href={staffHref("users")}>全部</a>}
              variant="borderless"
            >
              <List
                loading={loading && !users.length}
                locale={{ emptyText: loading ? "正在读取…" : "还没有用户" }}
                dataSource={recentUsers}
                renderItem={user => {
                  const letter = (
                    user.displayName ||
                    user.email ||
                    "?"
                  )
                    .trim()
                    .charAt(0)
                    .toUpperCase();
                  return (
                    <List.Item>
                      <List.Item.Meta
                        avatar={
                          <Avatar src={user.avatarUrl || undefined} size="small">
                            {letter}
                          </Avatar>
                        }
                        title={
                          <Typography.Text ellipsis={{ tooltip: true }}>
                            {user.displayName || user.email}
                          </Typography.Text>
                        }
                        description={`${formatNeverLogin(staffSeenAt(user))} · ${formatTokens(
                          user.estimatedTokens
                        )} tokens`}
                      />
                    </List.Item>
                  );
                }}
              />
            </Card>
          </Col>
        </Row>
      </PageContainer>
    </section>
  );
}
