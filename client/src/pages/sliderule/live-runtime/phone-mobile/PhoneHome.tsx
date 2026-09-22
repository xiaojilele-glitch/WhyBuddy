/**
 * PhoneHome — 手机档首页（antd-mobile Card / Grid / Steps，④）。
 *
 * 桌面档首页用的是 antd 的 Card + Statistic + Timeline，手机档一直跟着复用，
 * 只是加了几个 isPhone 三元调间距——间距对了，组件还是 PC 的：Statistic 的
 * 字号层级按桌面信息密度设计，Timeline 的左侧轴线在窄屏里挤掉正文宽度。
 *
 * 这里换成移动端范式：统计走 Grid 两列卡片，审批动态走 Steps 竖排
 * （移动端表达"一串进展"的原生形态），Tag 也换成 antd-mobile 的。
 *
 * 纯展示组件：图表节点由父层传进来（ECharts 的 lazy 边界留在父层，
 * 这个 chunk 不该把图表库拖进来），统计值也由父层算好。
 */

import React from "react";
import { Card, ErrorBlock, Grid, Steps, Tag } from "antd-mobile";

const { Step } = Steps;

export interface PhoneHomeStat {
  id: string;
  label: string;
  value: React.ReactNode;
  suffix?: string;
}

export interface PhoneHomeChart {
  id: string;
  label: string;
  /** 已渲染好的图表节点（或空态提示），父层负责 Suspense */
  node: React.ReactNode;
}

export interface PhoneHomeTimelineItem {
  id: string;
  title: string;
  /** 当前所处节点名 */
  nodeLabel: string;
  statusLabel: string;
  status: "running" | "completed" | "rejected";
}

export interface PhoneHomeProps {
  stats: PhoneHomeStat[];
  charts: PhoneHomeChart[];
  timeline: PhoneHomeTimelineItem[];
  /** 无流程实例时的诚实空态文案（与桌面档一致） */
  timelineEmptyHint: string;
}

/** 流程状态 → Steps 的状态档 + Tag 配色。三态一一对应，不猜。 */
const STATUS_MAP: Record<
  PhoneHomeTimelineItem["status"],
  { step: "process" | "finish" | "error"; tag: "primary" | "success" | "danger" }
> = {
  running: { step: "process", tag: "primary" },
  completed: { step: "finish", tag: "success" },
  rejected: { step: "error", tag: "danger" },
};

export default function PhoneHome({
  stats,
  charts,
  timeline,
  timelineEmptyHint,
}: PhoneHomeProps) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      data-testid="phone-home"
    >
      {stats.length > 0 && (
        <Grid columns={2} gap={8}>
          {stats.map(s => (
            <Grid.Item key={s.id}>
              <Card bodyStyle={{ padding: "10px 12px" }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--adm-color-weak, #999999)",
                    marginBottom: 4,
                  }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>
                  {s.value}
                  {s.suffix && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 400,
                        color: "var(--adm-color-weak, #999999)",
                        marginLeft: 2,
                      }}
                    >
                      {s.suffix}
                    </span>
                  )}
                </div>
              </Card>
            </Grid.Item>
          ))}
        </Grid>
      )}

      {charts.map(c => (
        <Card
          key={c.id}
          title={c.label}
          bodyStyle={{ padding: "4px 8px 8px" }}
          data-testid={`app-runtime-${c.id}`}
        >
          {c.node}
        </Card>
      ))}

      <Card title="审批动态" bodyStyle={{ padding: "8px 12px 12px" }}>
        {timeline.length === 0 ? (
          <ErrorBlock
            status="empty"
            title="暂无审批动态"
            description={timelineEmptyHint}
          />
        ) : (
          <Steps direction="vertical" style={{ "--title-font-size": "13px" }}>
            {timeline.map(item => {
              const m = STATUS_MAP[item.status];
              return (
                <Step
                  key={item.id}
                  status={m.step}
                  title={
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 500,
                      }}
                    >
                      {item.title}
                    </span>
                  }
                  description={
                    <span style={{ fontSize: 12 }}>
                      {item.nodeLabel}
                      <Tag color={m.tag} fill="outline" style={{ marginLeft: 6 }}>
                        {item.statusLabel}
                      </Tag>
                    </span>
                  }
                />
              );
            })}
          </Steps>
        )}
      </Card>
    </div>
  );
}
