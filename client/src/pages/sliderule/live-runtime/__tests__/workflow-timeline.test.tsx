import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance } from "../block-registry";

/**
 * WorkflowTimeline 区块渲染哨兵（2026-07-27）。
 *
 * 补的是一个真空白：这个渲染器 07-23 就接了真实 workflow 数据，却一直零
 * 测试覆盖——因为生成侧 prompt 有一句"渲染器还没上线，不要输出
 * page.blocks"的禁令，它实际上从没被渲染过，坏了也没人会发现。现在目录
 * 把 WorkflowTimeline 的 generationEnabled 放开（灰度第一个），补齐覆盖
 * 再上路。
 *
 * 锁三件事：节点从 workflow 系统机械派生（不接受自由文案）、chainRef 选
 * 链路、无数据时诚实空态（不白屏也不编节点）。
 */

const WORKFLOW = {
  nodes: [
    { id: "submit", name: "提交申请", assigneeRole: "requester" },
    { id: "review", name: "主管审批", assigneeRole: "manager" },
    { id: "done", name: "归档" },
  ],
  transitions: [
    { from: "submit", to: "review" },
    { from: "review", to: "done", condition: "金额 ≤ 5000" },
  ],
  chains: [
    { id: "fast_chain", name: "快速通道", nodes: [{ id: "auto", name: "自动放行" }], transitions: [] },
  ],
};

function block(props: Record<string, unknown> = {}): ExperienceBlockInstance {
  return { id: "wf1", type: "WorkflowTimeline", props } as ExperienceBlockInstance;
}

function render(props: Record<string, unknown>, workflow: unknown): string {
  return renderToStaticMarkup(
    <ExperienceBlockBoundary
      block={block(props)}
      workflow={workflow as never}
    />
  );
}

const nodeCount = (html: string) =>
  (html.match(/data-testid="workflow-timeline-node"/g) ?? []).length;

describe("WorkflowTimeline 渲染", () => {
  it("chainRef 留空时渲染主链路全部节点，顺序与 workflow 一致", () => {
    const html = render({ title: "审批流程" }, WORKFLOW);
    expect(nodeCount(html)).toBe(3);
    expect(html.indexOf("提交申请")).toBeLessThan(html.indexOf("主管审批"));
    expect(html.indexOf("主管审批")).toBeLessThan(html.indexOf("归档"));
    expect(html).toContain("审批流程");
  });

  it("节点文案只来自 workflow 系统：角色与流转条件如实透出", () => {
    const html = render({}, WORKFLOW);
    expect(html).toContain("requester");
    expect(html).toContain("manager");
    expect(html).toContain("金额 ≤ 5000");
  });

  it("chainRef 指定时只渲染那条链路，不混主链路节点", () => {
    const html = render({ chainRef: "fast_chain" }, WORKFLOW);
    expect(nodeCount(html)).toBe(1);
    expect(html).toContain("自动放行");
    expect(html).not.toContain("提交申请");
  });

  it("没有 workflow 数据时给诚实空态，不白屏、不编节点", () => {
    const html = render({}, undefined);
    expect(html).toContain('data-testid="workflow-timeline-empty"');
    expect(nodeCount(html)).toBe(0);
  });

  it("链路存在但节点为空时同样走空态", () => {
    const html = render(
      { chainRef: "fast_chain" },
      { ...WORKFLOW, chains: [{ id: "fast_chain", name: "空链", nodes: [], transitions: [] }] }
    );
    expect(html).toContain('data-testid="workflow-timeline-empty"');
    expect(nodeCount(html)).toBe(0);
  });
});

/**
 * 分支与回环不许被铺成"下一步"（2026-08-11）。
 *
 * ## 线上截图逮到的
 *
 * 「拒绝兑换」是第 4 步、「退回调整」「退回重做」是第 5 步——驳回被铺成了正向
 * 流程的下一步，等于告诉用户"走完确认发放就该去拒绝兑换"。
 *
 * 根因是渲染器直接 `nodes.map(...)` 按**声明数组顺序**铺 Steps，完全没读
 * transitions 的图结构。而 antd 的 Steps 表达的是线性进度，分支塞不进去；
 * 成熟做法也是分开的（NocoBase 的审批节点把驳回做成分支、Camunda 用网关）。
 *
 * 这个夹具就是告警值班那趟的真实图形状：两条驳回分支汇到同一个节点，还有两条
 * 回环边。上面那三条老用例用的是**纯线性**流程，所以它们全绿也照不出这个 bug
 * ——这正是要单独补一个带分支的夹具的原因。
 */
const BRANCHING_WORKFLOW = {
  nodes: [
    { id: "received", name: "告警接入", assigneeRole: "coordinator" },
    { id: "routed", name: "标签路由", assigneeRole: "coordinator" },
    { id: "notified", name: "通知值班组", assigneeRole: "responder" },
    { id: "acked", name: "确认告警", assigneeRole: "responder" },
    { id: "resolved", name: "告警恢复", assigneeRole: "responder" },
    { id: "closed", name: "关闭告警", assigneeRole: "coordinator" },
    { id: "rejected", name: "驳回告警", assigneeRole: "coordinator" },
  ],
  transitions: [
    { from: "received", to: "routed" },
    // 驳回边**故意声明在正常边之前**——真实模型里完全可能这么写，
    // 判据不能依赖"第一条声明的边就是主路径"
    { from: "routed", to: "rejected", condition: "没有匹配的路由策略" },
    { from: "routed", to: "notified", condition: "存在匹配的生效路由策略" },
    { from: "notified", to: "acked", condition: "值班响应人在升级时限内确认" },
    { from: "notified", to: "routed", condition: "超过升级时限，重新路由" },
    { from: "acked", to: "resolved", condition: "监控信号恢复" },
    { from: "acked", to: "rejected", condition: "确认后判定为误报" },
    { from: "resolved", to: "closed" },
    { from: "rejected", to: "routed", condition: "误报判定被撤回" },
  ],
  chains: [],
};

describe("分支与回环不进主流程顺序", () => {
  const html = render({ title: "告警流程" }, BRANCHING_WORKFLOW);

  it("驳回节点不出现在 Steps 里 —— 它是分支出口，不是第 7 步", () => {
    expect(nodeCount(html), "主链路应当是 6 步（7 个节点里驳回不算）").toBe(6);
    // 主链路顺序照旧
    for (const [a, b] of [
      ["告警接入", "标签路由"],
      ["标签路由", "通知值班组"],
      ["通知值班组", "确认告警"],
      ["确认告警", "告警恢复"],
      ["告警恢复", "关闭告警"],
    ] as const) {
      expect(html.indexOf(a), `${a} 应排在 ${b} 之前`).toBeLessThan(html.indexOf(b));
    }
  });

  it("驳回节点作为分支出口单独渲染，并带上「因为什么」", () => {
    expect(html).toContain('data-testid="workflow-timeline-branches"');
    expect(html).toContain("驳回告警");
    // 一个驳回节点常有多个来源，只显示名字说明不了什么
    expect(html).toContain("没有匹配的路由策略");
    expect(html).toContain("确认后判定为误报");
  });

  it("步骤上显示的是**继续主链路**那条边的条件，不是驳回边的", () => {
    /**
     * 原来 conditionByFrom 按 `from` 建 Map，一个节点多条出边时**只留最后一条**。
     * 这个夹具里 routed 的两条出边，按旧写法活下来的是「存在匹配的生效路由策略」
     * 或「没有匹配的路由策略」——取决于声明顺序，也就是说正常步骤上可能显示驳回
     * 分支的条件。图 4 那行橙字就是这么来的。
     */
    const stepsPart = html.slice(0, html.indexOf('data-testid="workflow-timeline-branches"'));
    expect(stepsPart, "主链路的推进条件该在步骤上").toContain("存在匹配的生效路由策略");
    expect(stepsPart, "驳回条件不该出现在主链路步骤上").not.toContain("没有匹配的路由策略");
  });

  it("回环边不会让节点重复出现，也不会把主链路走成死循环", () => {
    // notified → routed 和 rejected → routed 都是回环；主链路每个节点只能出现一次
    expect((html.match(/标签路由/g) ?? []).length).toBe(1);
  });
});
