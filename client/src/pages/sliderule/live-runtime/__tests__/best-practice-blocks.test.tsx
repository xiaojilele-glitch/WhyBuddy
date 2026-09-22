import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({
  id,
  values,
  createdAt: "2026-08-09T09:00:00.000Z",
});

describe("开源最佳实践区块", () => {
  it("附件面板把文件状态、大小和上传入口放在一个完整区块里", () => {
    const block: ExperienceBlockInstance = {
      id: "files",
      type: "AttachmentPanel",
      props: { title: "项目附件", allowUpload: true, uploadText: "添加材料", surface: "plain" },
      binding: {
        entityRef: "file",
        fileNameFieldRef: "name",
        fileSizeFieldRef: "size",
        statusFieldRef: "status",
        uploadedAtFieldRef: "at",
      },
    };
    const markup = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={block}
        entityRows={{ file: [row("f1", { name: "验收报告.pdf", size: 2048, status: "可用", at: "2026-08-09" })] }}
      />
    );

    expect(markup).toContain("项目附件");
    expect(markup).toContain("验收报告.pdf");
    expect(markup).toContain("2.0 KB");
    expect(markup).toContain("添加材料");
  });

  it("讨论线程按 parentFieldRef 把回复留在父评论下面并提供输入出口", () => {
    const block: ExperienceBlockInstance = {
      id: "comments",
      type: "CommentThread",
      props: { title: "协作讨论", surface: "plain" },
      binding: {
        entityRef: "comment",
        authorFieldRef: "author",
        contentFieldRef: "content",
        timeFieldRef: "at",
        parentFieldRef: "parentId",
      },
    };
    const markup = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={block}
        entityRows={{
          comment: [
            row("c1", { author: "陈晓", content: "材料已补齐", at: "今天", parentId: "" }),
            row("c2", { author: "周宁", content: "收到，马上复核", at: "刚刚", parentId: "c1" }),
          ],
        }}
      />
    );

    expect(markup.indexOf("材料已补齐")).toBeLessThan(markup.indexOf("收到，马上复核"));
    expect(markup).toContain("写下评论");
    expect(markup).toMatch(/发\s*布/);
  });

  it("记录选择器在桌面与手机都保留搜索、选择和确认边界", () => {
    const block: ExperienceBlockInstance = {
      id: "picker",
      type: "RecordPicker",
      props: { title: "选择门店", searchable: true, selectionMode: "multiple", surface: "plain" },
      binding: { entityRef: "store", titleFieldRef: "name", descFieldRef: "desc" },
    };
    const props = {
      block,
      entityRows: { store: [row("s1", { name: "人民路店", desc: "华东区域" })] },
    };

    const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
    const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);

    for (const markup of [desktop, phone]) {
      expect(markup).toContain("选择门店");
      expect(markup).toContain("人民路店");
      expect(markup).toContain("搜索可选记录");
      expect(markup).toContain("确认选择");
    }
  });

  it("状态看板按状态分列并在手机上改为单列切换", () => {
    const block: ExperienceBlockInstance = {
      id: "board",
      type: "KanbanBoard",
      props: { title: "任务看板", movable: true, surface: "plain" },
      binding: { entityRef: "task", titleFieldRef: "name", statusFieldRef: "status", descFieldRef: "desc" },
    };
    const props = {
      block,
      entityRows: {
        task: [
          row("t1", { name: "核对材料", status: "待处理", desc: "检查附件" }),
          row("t2", { name: "现场复查", status: "进行中", desc: "周五下午" }),
        ],
      },
    };
    const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
    const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
    expect(desktop).toContain("待处理");
    expect(desktop).toContain("进行中");
    expect(desktop).toContain("核对材料");
    expect(phone).toContain("任务看板");
    expect(phone).toContain("核对材料");
  });

  it("日程日历把选中日期和当天议程放在同一区块", () => {
    const block: ExperienceBlockInstance = {
      id: "calendar",
      type: "ScheduleCalendar",
      props: { title: "巡检日程", initialDate: "2026-08-09", surface: "plain" },
      binding: { entityRef: "event", titleFieldRef: "title", startFieldRef: "start", statusFieldRef: "status" },
    };
    const markup = renderToStaticMarkup(
      <ExperienceBlockBoundary block={block} entityRows={{ event: [row("e1", { title: "高新店复查", start: "2026-08-09", status: "已确认" }), row("e2", { title: "下周盘点", start: "2026-08-12" })] }} />
    );
    expect(markup).toContain("巡检日程");
    expect(markup).toContain("8 月 9 日");
    expect(markup).toContain("高新店复查");
    expect(markup).not.toContain("下周盘点");
  });

  it("通知收件箱在桌面和手机都保留分类、未读和全部已读", () => {
    const block: ExperienceBlockInstance = {
      id: "notices",
      type: "NotificationInbox",
      props: { title: "消息通知", surface: "plain" },
      binding: { entityRef: "notice", titleFieldRef: "title", contentFieldRef: "content", timeFieldRef: "at", categoryFieldRef: "category", readFieldRef: "read" },
    };
    const props = {
      block,
      entityRows: { notice: [row("n1", { title: "材料已通过", content: "复核完成", at: "10:30", category: "系统", read: false })] },
    };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("消息通知");
      expect(markup).toContain("材料已通过");
      expect(markup).toContain("全部已读");
      expect(markup).toContain("系统");
    }
  });

  it("层级导航在桌面和手机都保留父子关系与搜索入口", () => {
    const block: ExperienceBlockInstance = {
      id: "tree",
      type: "TreeNavigator",
      props: { title: "组织结构", searchable: true, defaultExpandAll: true, surface: "plain" },
      binding: { entityRef: "node", labelFieldRef: "label", parentFieldRef: "parent", descFieldRef: "desc" },
    };
    const props = {
      block,
      entityRows: { node: [row("root", { label: "华东区域", parent: "", desc: "区域" }), row("child", { label: "杭州", parent: "root", desc: "城市" }), row("leaf", { label: "人民路店", parent: "child", desc: "门店" })] },
    };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("组织结构");
      expect(markup).toContain("华东区域");
      expect(markup).toContain("搜索层级节点");
    }
  });

  it("审批队列把待处理任务与审批动作放在同一区块", () => {
    const block: ExperienceBlockInstance = {
      id: "approvals",
      type: "ApprovalQueue",
      props: { title: "我的审批", pendingValue: "pending", approvedValue: "approved", rejectedValue: "rejected", surface: "plain" },
      binding: { entityRef: "approval", titleFieldRef: "title", statusFieldRef: "status", applicantFieldRef: "applicant", summaryFieldRef: "summary" },
    };
    const props = { block, entityRows: { approval: [row("a1", { title: "延期申请", status: "pending", applicant: "陈晓", summary: "延期到周五" })] } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("我的审批");
      expect(markup).toContain("延期申请");
      expect(markup).toContain("待处理 1");
      expect(markup).toMatch(/通\s*过/);
      expect(markup).toMatch(/驳\s*回/);
    }
  });

  it("审计记录把操作摘要和前后值分层展示", () => {
    const block: ExperienceBlockInstance = {
      id: "audit",
      type: "AuditTrail",
      props: { title: "操作审计", pageSize: 5, surface: "plain" },
      binding: { entityRef: "audit", actorFieldRef: "actor", actionFieldRef: "action", timeFieldRef: "at", fieldNameFieldRef: "field", beforeFieldRef: "before", afterFieldRef: "after" },
    };
    const props = { block, entityRows: { audit: [row("l1", { actor: "陈晓", action: "更新状态", at: "10:18", field: "status", before: "待复查", after: "已完成" })] } };
    const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
    const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
    for (const markup of [desktop, phone]) {
      expect(markup).toContain("操作审计");
      expect(markup).toContain("陈晓");
      expect(markup).toContain("更新状态");
    }
    expect(desktop).toContain("变更前");
    expect(desktop).toContain("待复查");
    expect(desktop).toContain("已完成");
  });

  it("数据导入向导在双端保留字段映射、校验和提交边界", () => {
    const block: ExperienceBlockInstance = {
      id: "import", type: "DataImportWizard",
      props: { title: "导入巡检数据", initialPhase: "mapping", initialFileName: "巡检.xlsx", surface: "plain" },
      binding: { entityRef: "mapping", sourceFieldRef: "source", targetFieldRef: "target", statusFieldRef: "status", issueFieldRef: "issue" },
    };
    const props = { block, entityRows: { mapping: [row("m1", { source: "门店", target: "storeName", status: "valid" }), row("m2", { source: "日期", target: "inspectedAt", status: "pending" })] } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("导入巡检数据");
      expect(markup).toContain("巡检.xlsx");
      expect(markup).toContain("门店");
      expect(markup).toContain("校验数据");
    }
  });

  it("异步任务监控只按真实 current/total 展示进度和状态动作", () => {
    const block: ExperienceBlockInstance = {
      id: "tasks", type: "AsyncTaskMonitor", props: { title: "后台任务", surface: "plain" },
      binding: { entityRef: "task", titleFieldRef: "title", statusFieldRef: "status", progressCurrentFieldRef: "current", progressTotalFieldRef: "total", errorFieldRef: "error", resultFieldRef: "result" },
    };
    const props = { block, entityRows: { task: [row("t1", { title: "导入数据", status: "running", current: 25, total: 100 }), row("t2", { title: "同步记录", status: "failed", error: "连接超时" })] } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("后台任务");
      expect(markup).toContain("导入数据");
      expect(markup).toContain("25/100");
      expect(markup).toContain("连接超时");
      expect(markup).toMatch(/重\s*试/);
    }
  });

  it("权限矩阵在桌面和手机都保留资源动作三态", () => {
    const block: ExperienceBlockInstance = {
      id: "permissions", type: "PermissionMatrix", props: { title: "角色权限", surface: "plain" },
      binding: { entityRef: "permission", resourceFieldRef: "resource", viewFieldRef: "view", createFieldRef: "create", editFieldRef: "edit", deleteFieldRef: "delete" },
    };
    const props = { block, entityRows: { permission: [row("p1", { resource: "门店档案", view: "allow", create: "inherit", edit: "allow", delete: "deny" })] } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("角色权限");
      expect(markup).toContain("门店档案");
      expect(markup).toContain("查看");
      expect(markup).toContain("允许");
      expect(markup).toContain("拒绝");
      expect(markup).toContain("保存权限");
    }
  });

  it("数据导出面板在双端明确范围、字段、格式和数量上限", () => {
    const block: ExperienceBlockInstance = {
      id: "export", type: "DataExportPanel", props: { title: "导出门店数据", maxRows: 2000, surface: "plain" },
      binding: { entityRef: "store", fieldRefs: ["name", "status", "at"] },
    };
    const props = { block, entityRows: { store: [row("s1", { name: "人民路店", status: "active", at: "2026-08-09" })] }, selection: { rowIds: { store: ["s1"] } } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("导出门店数据");
      expect(markup).toContain("最多导出 2000 条");
      expect(markup).toContain("Excel");
      expect(markup).toContain("CSV");
      expect(markup).toMatch(/开始\s*导出/);
    }
  });

  it("批量编辑面板只对已选记录提供保持、修改和清空三种字段动作", () => {
    const block: ExperienceBlockInstance = {
      id: "bulk", type: "BulkEditPanel", props: { title: "批量更新门店", surface: "plain" },
      binding: { entityRef: "store", fieldRefs: ["status", "channel"] },
    };
    const props = { block, entityRows: { store: [row("s1", { status: "active", channel: "线上" }), row("s2", { status: "pending", channel: "门店" })] }, selection: { rowIds: { store: ["s1", "s2"] } } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("批量更新门店");
      expect(markup).toContain("2 条记录");
      expect(markup).toMatch(/不变|保持不变/);
      expect(markup).toContain("清空");
    }
  });

  it("成员分配器把当前成员和候选集合分开并保留移除动作", () => {
    const block: ExperienceBlockInstance = {
      id: "members", type: "MemberAssignment", props: { title: "巡检组成员", memberValue: "member", surface: "plain" },
      binding: { entityRef: "user", nameFieldRef: "name", accountFieldRef: "account", statusFieldRef: "status", membershipFieldRef: "membership" },
    };
    const props = { block, entityRows: { user: [row("u1", { name: "陈晓", account: "chen@example.com", status: "active", membership: "member" }), row("u2", { name: "林雪", account: "lin@example.com", status: "active", membership: "candidate" })] } };
    for (const markup of [renderToStaticMarkup(<ExperienceBlockBoundary {...props} />), renderToStaticMarkup(<PhoneExperienceBlock {...props} />)]) {
      expect(markup).toContain("巡检组成员");
      expect(markup).toContain("陈晓");
      expect(markup).toContain("可添加 1");
      expect(markup).toMatch(/移\s*除/);
      expect(markup).not.toContain("林雪");
    }
  });

  it("欠缺区域的 14 个新区块都有独立桌面与手机渲染器", () => {
    const entityRows = {
      order: [
        row("o1", { name: "人民路店", status: "doing", channel: "门店", amount: 428, discount: 20 }),
        row("o2", { name: "高新店", status: "done", channel: "线上", amount: 366, discount: 0 }),
      ],
      approval: [row("a1", { title: "整改延期", status: "pending" })],
      task: [row("t1", { title: "材料核验", current: 6, total: 10, status: "running", next: "主管复核" })],
    };
    const cases: Array<{ type: string; block: ExperienceBlockInstance; extra?: Record<string, unknown>; desktop: string; phone: string }> = [
      { type: "ContextBreadcrumb", block: { id: "b1", type: "ContextBreadcrumb", props: { items: ["运营", "门店", "人民路店"], surface: "plain" } }, desktop: "context-breadcrumb", phone: "phone-context-breadcrumb" },
      { type: "LiveRefreshControl", block: { id: "b2", type: "LiveRefreshControl", props: { surface: "plain" }, binding: { targets: ["table"] } }, desktop: "live-refresh-control", phone: "phone-live-refresh-control" },
      { type: "ActiveFilterSummary", block: { id: "b3", type: "ActiveFilterSummary", props: { surface: "plain" }, binding: { targets: ["table"] } }, extra: { filterState: { enumFilters: { status: "doing" }, enumMulti: {} } }, desktop: "active-filter-summary", phone: "phone-active-filter-summary" },
      { type: "AnalyticsDateScope", block: { id: "b4", type: "AnalyticsDateScope", props: { surface: "plain" }, binding: { targets: ["chart"] } }, desktop: "analytics-date-scope", phone: "phone-analytics-date-scope" },
      { type: "HeaderEntitySummary", block: { id: "b4a", type: "HeaderEntitySummary", props: { surface: "plain" }, binding: { entityRef: "order", titleFieldRef: "name", fieldRefs: ["status", "channel", "amount"] } }, extra: { focus: { order: "o1" } }, desktop: "header-entity-summary", phone: "phone-header-entity-summary" },
      { type: "HeaderProgressSummary", block: { id: "b4b", type: "HeaderProgressSummary", props: { surface: "plain" }, binding: { entityRef: "task", titleFieldRef: "title", currentFieldRef: "current", totalFieldRef: "total", statusFieldRef: "status", nextFieldRef: "next" } }, extra: { focus: { task: "t1" } }, desktop: "header-progress-summary", phone: "phone-header-progress-summary" },
      { type: "WorkspaceTabs", block: { id: "b5", type: "WorkspaceTabs", props: { surface: "plain" }, binding: { entityRef: "order", titleFieldRef: "name", targets: ["work"] } }, desktop: "workspace-tabs", phone: "phone-workspace-tabs" },
      { type: "SavedViewTabs", block: { id: "b6", type: "SavedViewTabs", props: { surface: "plain" }, binding: { entityRef: "order", titleFieldRef: "name", presetKeyFieldRef: "status", targets: ["table"] } }, desktop: "saved-view-tabs", phone: "phone-saved-view-tabs" },
      { type: "AdvancedFilterBuilder", block: { id: "b7", type: "AdvancedFilterBuilder", props: { surface: "plain" }, binding: { entityRef: "order", fieldRefs: ["status", "channel"], targets: ["table"] } }, desktop: "advanced-filter-builder", phone: "phone-advanced-filter-builder" },
      { type: "FacetedFilterPanel", block: { id: "b8", type: "FacetedFilterPanel", props: { surface: "plain" }, binding: { entityRef: "order", fieldRefs: ["status", "channel"], targets: ["table"] } }, desktop: "faceted-filter-panel", phone: "phone-faceted-filter-panel" },
      { type: "WizardNavigationBar", block: { id: "b9", type: "WizardNavigationBar", props: { steps: ["填写", "确认"], surface: "plain" }, binding: { targets: ["form"] } }, desktop: "wizard-navigation-bar", phone: "phone-wizard-navigation-bar" },
      { type: "ApprovalDecisionBar", block: { id: "b10", type: "ApprovalDecisionBar", props: { surface: "plain" }, binding: { entityRef: "approval", titleFieldRef: "title", statusFieldRef: "status", targets: ["detail"] } }, extra: { focus: { approval: "a1" } }, desktop: "approval-decision-bar", phone: "phone-approval-decision-bar" },
      { type: "CheckoutSummaryBar", block: { id: "b11", type: "CheckoutSummaryBar", props: { surface: "plain" }, binding: { entityRef: "order", amountFieldRef: "amount", discountFieldRef: "discount", targets: ["list"] } }, extra: { selection: { rowIds: { order: ["o1", "o2"] } } }, desktop: "checkout-summary-bar", phone: "phone-checkout-summary-bar" },
      { type: "RecordLifecycleBar", block: { id: "b12", type: "RecordLifecycleBar", props: { surface: "plain" }, binding: { entityRef: "order", statusFieldRef: "status", targets: ["form"] } }, extra: { focus: { order: "o1" } }, desktop: "record-lifecycle-bar", phone: "phone-record-lifecycle-bar" },
    ];

    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows, ...(testCase.extra ?? {}) };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
      expect(desktop, testCase.type).toContain(`data-testid="${testCase.desktop}"`);
      expect(phone, testCase.type).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("分析与审查批次的 12 个区块都有独立双端渲染器", () => {
    const entityRows = {
      order: [row("o1", { name: "人民路店", amount: 428, weekDelta: 12, status: "doing", channel: "门店" }), row("o2", { name: "高新店", amount: 366, weekDelta: -3, status: "done", channel: "线上" })],
      task: [row("t1", { current: 68, total: 100 })],
      alert: [row("a1", { title: "支付错误率升高", state: "firing", severity: "critical", at: "11:20", labels: "service=payment" })],
      policy: [row("p1", { name: "默认路由", parent: "", matcher: "全部", receiver: "值班群" }), row("p2", { name: "严重告警", parent: "p1", matcher: "severity=critical", receiver: "电话" })],
      deleted: [row("d1", { title: "旧任务", at: "2026-08-08", by: "陈晓" })],
      revision: [row("r2", { version: 2, author: "陈晓", at: "2026-08-09", summary: "补充材料", current: "current" }), row("r1", { version: 1, author: "周宁", at: "2026-08-08", summary: "创建记录", current: "history" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; extra?: Record<string, unknown>; desktop: string; phone: string }> = [
      { block: { id: "c1", type: "WaterfallChart", props: { title: "增减", surface: "plain" }, binding: { entityRef: "order", categoryFieldRef: "channel", valueFieldRef: "weekDelta" } }, desktop: "waterfall-chart", phone: "phone-waterfall-chart" },
      { block: { id: "c2", type: "FunnelChart", props: { title: "漏斗", stages: ["doing", "done"], surface: "plain" }, binding: { entityRef: "order", stageFieldRef: "status", valueFieldRef: "amount" } }, desktop: "funnel-chart", phone: "phone-funnel-chart" },
      { block: { id: "c3", type: "DistributionHistogram", props: { title: "分布", surface: "plain" }, binding: { entityRef: "order", valueFieldRef: "amount" } }, desktop: "distribution-histogram", phone: "phone-distribution-histogram" },
      { block: { id: "c4", type: "HeatmapMatrix", props: { title: "热力", surface: "plain" }, binding: { entityRef: "order", xFieldRef: "status", yFieldRef: "channel", valueFieldRef: "amount" } }, desktop: "heatmap-matrix", phone: "phone-heatmap-matrix" },
      { block: { id: "c5", type: "TreemapBreakdown", props: { title: "构成", surface: "plain" }, binding: { entityRef: "order", labelFieldRef: "name", valueFieldRef: "amount" } }, desktop: "treemap-breakdown", phone: "phone-treemap-breakdown" },
      { block: { id: "c6", type: "GaugeProgress", props: { title: "完成度", surface: "plain" }, binding: { entityRef: "task", currentFieldRef: "current", targetFieldRef: "total" } }, desktop: "gauge-progress", phone: "phone-gauge-progress" },
      { block: { id: "c7", type: "AlertTriagePanel", props: { surface: "plain" }, binding: { entityRef: "alert", titleFieldRef: "title", stateFieldRef: "state", severityFieldRef: "severity", timeFieldRef: "at", targets: ["silence"] } }, desktop: "alert-triage-panel", phone: "phone-alert-triage-panel" },
      { block: { id: "c8", type: "AlertSilenceForm", props: { surface: "plain" }, binding: { entityRef: "alert", titleFieldRef: "title", labelFieldRef: "labels", targets: ["triage"] } }, extra: { focus: { alert: "a1" } }, desktop: "alert-silence-form", phone: "phone-alert-silence-form" },
      { block: { id: "c9", type: "AlertRoutingPolicy", props: { surface: "plain" }, binding: { entityRef: "policy", nameFieldRef: "name", parentFieldRef: "parent", matcherFieldRef: "matcher", receiverFieldRef: "receiver" } }, desktop: "alert-routing-policy", phone: "phone-alert-routing-policy" },
      { block: { id: "c10", type: "DeletedRecordsRecovery", props: { surface: "plain" }, binding: { entityRef: "deleted", titleFieldRef: "title", deletedAtFieldRef: "at", deletedByFieldRef: "by", targets: ["list"] } }, desktop: "deleted-records-recovery", phone: "phone-deleted-records-recovery" },
      { block: { id: "c11", type: "RevisionHistoryPanel", props: { surface: "plain" }, binding: { entityRef: "revision", versionFieldRef: "version", authorFieldRef: "author", timeFieldRef: "at", summaryFieldRef: "summary", currentFieldRef: "current", targets: ["detail"] } }, desktop: "revision-history-panel", phone: "phone-revision-history-panel" },
      { block: { id: "c12", type: "RecordComparePanel", props: { surface: "plain" }, binding: { entityRef: "order", fieldRefs: ["name", "amount", "status"], targets: ["list"] } }, extra: { selection: { rowIds: { order: ["o1", "o2"] } } }, desktop: "record-compare-panel", phone: "phone-record-compare-panel" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows, ...(testCase.extra ?? {}) };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("调度、告警配置与关系操作的 10 个区块都有独立双端渲染器", () => {
    const entityRows = {
      schedule: [row("s1", { title: "门店复查", start: "2026-08-09", end: "2026-08-11", group: "进行中" })],
      flow: [row("f1", { source: "访问", target: "咨询", value: 80 }), row("f2", { source: "咨询", target: "下单", value: 40 })],
      order: [row("o1", { name: "人民路店", channel: "线上", amount: 428, quality: 90, speed: 82, service: 88 }), row("o2", { name: "高新店", channel: "门店", amount: 366, quality: 72, speed: 91, service: 77 })],
      rule: [row("r1", { name: "错误率", query: "errors > 0", threshold: 5, severity: "critical" })],
      mute: [row("m1", { name: "周末维护", weekdays: "周六、周日", start: "00:00", end: "06:00", timezone: "Asia/Shanghai" })],
      contact: [row("c1", { name: "运维群", type: "webhook", address: "hooks.example.com", status: "ready" })],
      member: [row("u1", { name: "陈晓", relation: "linked" }), row("u2", { name: "林雪", relation: "available" })],
      search: [row("q1", { title: "人民路店", category: "门店", desc: "待复查" })],
      change: [row("x1", { title: "人民路店", action: "更新", actor: "周宁", at: "11:26" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; extra?: Record<string, unknown>; desktop: string; phone: string }> = [
      { block: { id: "d1", type: "GanttSchedule", props: { title: "排期", surface: "plain" }, binding: { entityRef: "schedule", labelFieldRef: "title", startFieldRef: "start", endFieldRef: "end", groupFieldRef: "group" } }, desktop: "gantt-schedule", phone: "phone-gantt-schedule" },
      { block: { id: "d2", type: "SankeyFlow", props: { title: "流向", surface: "plain" }, binding: { entityRef: "flow", sourceFieldRef: "source", targetFieldRef: "target", valueFieldRef: "value" } }, desktop: "sankey-flow", phone: "phone-sankey-flow" },
      { block: { id: "d3", type: "BoxPlotDistribution", props: { title: "分布", surface: "plain" }, binding: { entityRef: "order", categoryFieldRef: "channel", valueFieldRef: "amount" } }, desktop: "boxplot-distribution", phone: "phone-boxplot-distribution" },
      { block: { id: "d4", type: "RadarComparison", props: { title: "对比", surface: "plain" }, binding: { entityRef: "order", nameFieldRef: "name", metricFieldRefs: ["quality", "speed", "service"] } }, desktop: "radar-comparison", phone: "phone-radar-comparison" },
      { block: { id: "d5", type: "AlertRuleEditor", props: { surface: "plain" }, binding: { entityRef: "rule", nameFieldRef: "name", queryFieldRef: "query", thresholdFieldRef: "threshold", severityFieldRef: "severity", targets: ["rules"] } }, extra: { focus: { rule: "r1" } }, desktop: "alert-rule-editor", phone: "phone-alert-rule-editor" },
      { block: { id: "d6", type: "MuteTimingSchedule", props: { surface: "plain" }, binding: { entityRef: "mute", nameFieldRef: "name", weekdaysFieldRef: "weekdays", startTimeFieldRef: "start", endTimeFieldRef: "end", timezoneFieldRef: "timezone", targets: ["policies"] } }, desktop: "mute-timing-schedule", phone: "phone-mute-timing-schedule" },
      { block: { id: "d7", type: "ContactPointManager", props: { surface: "plain" }, binding: { entityRef: "contact", nameFieldRef: "name", typeFieldRef: "type", addressFieldRef: "address", statusFieldRef: "status", targets: ["policies"] } }, desktop: "contact-point-manager", phone: "phone-contact-point-manager" },
      { block: { id: "d8", type: "ReferenceManyManager", props: { linkedValue: "linked", surface: "plain" }, binding: { entityRef: "member", titleFieldRef: "name", relationFieldRef: "relation", targets: ["detail"] } }, desktop: "reference-many-manager", phone: "phone-reference-many-manager" },
      { block: { id: "d9", type: "GlobalSearchPalette", props: { surface: "plain" }, binding: { entityRef: "search", titleFieldRef: "title", categoryFieldRef: "category", descFieldRef: "desc" } }, desktop: "global-search-palette", phone: "phone-global-search-palette" },
      { block: { id: "d10", type: "LiveChangeReview", props: { surface: "plain" }, binding: { entityRef: "change", titleFieldRef: "title", actionFieldRef: "action", actorFieldRef: "actor", timeFieldRef: "at", targets: ["list"] } }, desktop: "live-change-review", phone: "phone-live-change-review" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows, ...(testCase.extra ?? {}) };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("预约、错误诊断与数据连接的 10 个区块都有独立双端渲染器", () => {
    const entityRows = {
      availability: [row("a1", { day: "周一", start: "09:00", end: "12:00", enabled: "enabled" })],
      slots: [row("s1", { start: "2026-08-11T09:00:00+08:00", end: "2026-08-11T09:30:00+08:00", available: "available", capacity: 2 })],
      conflicts: [row("c1", { title: "设备检查", start: "2026-08-11T09:00:00+08:00", end: "2026-08-11T10:30:00+08:00", resource: "会议室 A" }), row("c2", { title: "项目复盘", start: "2026-08-11T10:00:00+08:00", end: "2026-08-11T11:00:00+08:00", resource: "会议室 A" })],
      frames: [row("f1", { fn: "submit", file: "src/submit.ts", line: 84, code: "return result.data.id;", inApp: "in_app" })],
      breadcrumbs: [row("b1", { message: "请求返回 500", category: "http", level: "error", at: "2026-08-09 11:20" })],
      commits: [row("m1", { hash: "9fe21a0c", author: "陈晓", message: "调整提交结构", at: "2026-08-09 10:12", score: 92 })],
      jobs: [row("j1", { type: "sync", status: "failed", at: "2026-08-09 10:32", summary: "权限不足", records: 0 })],
      schema: [row("h1", { stream: "orders", field: "amount", change: "type_changed", before: "number", after: "string", breaking: "breaking" })],
      streams: [row("t1", { name: "payments", status: "failed", at: "2026-08-09 10:32", freshness: "40 分钟", records: 0, error: "无写入权限" })],
      mappings: [row("p1", { source: "legacy_status", target: "", transform: "lookup", status: "invalid" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "e1", type: "AvailabilityPlanner", props: { surface: "plain" }, binding: { entityRef: "availability", dayFieldRef: "day", startTimeFieldRef: "start", endTimeFieldRef: "end", enabledFieldRef: "enabled" } }, desktop: "availability-planner", phone: "phone-availability-planner" },
      { block: { id: "e2", type: "BookingSlotPicker", props: { surface: "plain" }, binding: { entityRef: "slots", startFieldRef: "start", endFieldRef: "end", availableFieldRef: "available", capacityFieldRef: "capacity", targets: ["form"] } }, desktop: "booking-slot-picker", phone: "phone-booking-slot-picker" },
      { block: { id: "e3", type: "ScheduleConflictResolver", props: { surface: "plain" }, binding: { entityRef: "conflicts", titleFieldRef: "title", startFieldRef: "start", endFieldRef: "end", resourceFieldRef: "resource", targets: ["calendar"] } }, desktop: "schedule-conflict-resolver", phone: "phone-schedule-conflict-resolver" },
      { block: { id: "e4", type: "StackTracePanel", props: { surface: "plain" }, binding: { entityRef: "frames", functionFieldRef: "fn", fileFieldRef: "file", lineFieldRef: "line", codeFieldRef: "code", inAppFieldRef: "inApp" } }, desktop: "stack-trace-panel", phone: "phone-stack-trace-panel" },
      { block: { id: "e5", type: "EventBreadcrumbTimeline", props: { surface: "plain" }, binding: { entityRef: "breadcrumbs", messageFieldRef: "message", categoryFieldRef: "category", levelFieldRef: "level", timeFieldRef: "at" } }, desktop: "event-breadcrumb-timeline", phone: "phone-event-breadcrumb-timeline" },
      { block: { id: "e6", type: "SuspectCommitPanel", props: { surface: "plain" }, binding: { entityRef: "commits", hashFieldRef: "hash", authorFieldRef: "author", messageFieldRef: "message", timeFieldRef: "at", scoreFieldRef: "score", targets: ["issue"] } }, desktop: "suspect-commit-panel", phone: "phone-suspect-commit-panel" },
      { block: { id: "e7", type: "ConnectionTimeline", props: { surface: "plain" }, binding: { entityRef: "jobs", typeFieldRef: "type", statusFieldRef: "status", timeFieldRef: "at", summaryFieldRef: "summary", recordsFieldRef: "records", targets: ["jobs"] } }, desktop: "connection-timeline", phone: "phone-connection-timeline" },
      { block: { id: "e8", type: "SchemaChangeReview", props: { surface: "plain" }, binding: { entityRef: "schema", streamFieldRef: "stream", fieldNameFieldRef: "field", changeTypeFieldRef: "change", beforeFieldRef: "before", afterFieldRef: "after", breakingFieldRef: "breaking", targets: ["connection"] } }, desktop: "schema-change-review", phone: "phone-schema-change-review" },
      { block: { id: "e9", type: "StreamStatusMonitor", props: { surface: "plain" }, binding: { entityRef: "streams", nameFieldRef: "name", statusFieldRef: "status", lastSyncFieldRef: "at", freshnessFieldRef: "freshness", recordsFieldRef: "records", errorFieldRef: "error", targets: ["streams"] } }, desktop: "stream-status-monitor", phone: "phone-stream-status-monitor" },
      { block: { id: "e10", type: "ConnectionMappingPanel", props: { surface: "plain" }, binding: { entityRef: "mappings", sourceFieldRef: "source", targetFieldRef: "target", transformFieldRef: "transform", statusFieldRef: "status", targets: ["mapping"] } }, desktop: "connection-mapping-panel", phone: "phone-connection-mapping-panel" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("七个稀缺区域新增的 12 个区块都有独立双端渲染器", () => {
    const entityRows = {
      issue: [row("i1", { title: "支付失败", status: "unresolved", priority: "high", assignee: "陈晓", events: 120, users: 32, env: "production", code: "500", reason: "权限不足", success: "10:30", downtime: "48 分钟" })],
      connection: [row("c1", { title: "订单同步", status: "active", sync: "running", schedule: "30 分钟", breaking: "safe", source: "PostgreSQL", target: "Snowflake", sourceVersion: "v3", targetVersion: "v2" })],
      job: [row("j1", { bytes: 1048576, records: 1200, rejected: 3, duration: "2 分钟", attempts: 2, title: "订单同步", status: "running", progress: 68, type: "sync", at: "2026-08-09" })],
      section: [row("s1", { title: "状态", key: "status", enabled: "enabled", count: 0 }), row("s2", { title: "Schema", key: "schema", enabled: "disabled", count: 2 })],
      mode: [row("m1", { title: "数据", key: "data", enabled: "enabled", issues: 0 }), row("m2", { title: "错误", key: "error", enabled: "enabled", issues: 3 })],
      dirty: [row("d1", { field: "连接名称", valid: "valid" }), row("d2", { field: "命名空间", valid: "invalid" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; extra?: Record<string, unknown>; desktop: string; phone: string }> = [
      { block: { id: "f1", type: "IssueCommandHeader", props: { surface: "plain" }, binding: { entityRef: "issue", titleFieldRef: "title", statusFieldRef: "status", priorityFieldRef: "priority", assigneeFieldRef: "assignee", targets: ["detail"] } }, desktop: "issue-command-header", phone: "phone-issue-command-header" },
      { block: { id: "f2", type: "ConnectionControlHeader", props: { surface: "plain" }, binding: { entityRef: "connection", titleFieldRef: "title", statusFieldRef: "status", syncStatusFieldRef: "sync", scheduleFieldRef: "schedule", breakingFieldRef: "breaking", targets: ["status"] } }, desktop: "connection-control-header", phone: "phone-connection-control-header" },
      { block: { id: "f3", type: "EventUserCountMetrics", props: { surface: "plain" }, binding: { entityRef: "issue", eventCountFieldRef: "events", userCountFieldRef: "users" } }, desktop: "event-user-count-metrics", phone: "phone-event-user-count-metrics" },
      { block: { id: "f4", type: "JobRunMetrics", props: { surface: "plain" }, binding: { entityRef: "job", bytesFieldRef: "bytes", recordsFieldRef: "records", rejectedFieldRef: "rejected", durationFieldRef: "duration", attemptsFieldRef: "attempts" } }, desktop: "job-run-metrics", phone: "phone-job-run-metrics" },
      { block: { id: "f5", type: "OccurrenceEvidenceSummary", props: { surface: "plain" }, binding: { entityRef: "issue", environmentFieldRef: "env", statusCodeFieldRef: "code", reasonFieldRef: "reason", lastSuccessFieldRef: "success", downtimeFieldRef: "downtime" } }, desktop: "occurrence-evidence-summary", phone: "phone-occurrence-evidence-summary" },
      { block: { id: "f6", type: "ConnectionRouteSummary", props: { surface: "plain" }, binding: { entityRef: "connection", sourceFieldRef: "source", targetFieldRef: "target", sourceVersionFieldRef: "sourceVersion", targetVersionFieldRef: "targetVersion", statusFieldRef: "status" } }, desktop: "connection-route-summary", phone: "phone-connection-route-summary" },
      { block: { id: "f8", type: "InspectorModeTabs", props: { surface: "plain" }, binding: { entityRef: "mode", titleFieldRef: "title", keyFieldRef: "key", enabledFieldRef: "enabled", issueCountFieldRef: "issues", targets: ["inspector"] } }, desktop: "inspector-mode-tabs", phone: "phone-inspector-mode-tabs" },
      { block: { id: "f9", type: "IssueEventFilter", props: { surface: "plain" }, binding: { entityRef: "issue", environmentFieldRef: "env", targets: ["events"] } }, desktop: "issue-event-filter", phone: "phone-issue-event-filter" },
      { block: { id: "f10", type: "TimelineFilterBar", props: { surface: "plain" }, binding: { entityRef: "job", typeFieldRef: "type", statusFieldRef: "status", timeFieldRef: "at", targets: ["timeline"] } }, desktop: "timeline-filter-bar", phone: "phone-timeline-filter-bar" },
      { block: { id: "f11", type: "UnsavedChangesBar", props: { surface: "plain" }, binding: { entityRef: "dirty", fieldNameFieldRef: "field", validFieldRef: "valid", targets: ["form"] } }, desktop: "unsaved-changes-bar", phone: "phone-unsaved-changes-bar" },
      { block: { id: "f12", type: "RunningJobControlBar", props: { surface: "plain" }, binding: { entityRef: "job", titleFieldRef: "title", statusFieldRef: "status", progressFieldRef: "progress", typeFieldRef: "type", targets: ["jobs"] } }, desktop: "running-job-control-bar", phone: "phone-running-job-control-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows, ...(testCase.extra ?? {}) };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("预约、告警与保存批次的 12 个稀缺区域区块都有独立双端渲染器", () => {
    const entityRows = {
      booking: [row("b1", { title: "义诊预约", status: "PENDING", start: "2026-08-12", end: "2026-08-12", location: "线上", recurring: "single", paid: "paid", timezone: "Asia/Shanghai", attendee: "张女士", capacity: 40, booked: 31, noShow: 2, waitlist: 4 })],
      rule: [row("r1", { title: "支付错误率", state: "firing", editable: "editable", provisioned: "custom", silenceable: "enabled" })],
      instance: [row("i1", { name: "payment-01", state: "firing", rule: "payment", value: "8.2%", labels: "env=prod", summary: "错误率超限", started: "11:12" }), row("i2", { name: "payment-02", state: "firing", rule: "payment", value: "6.7%" }), row("i3", { name: "queue", state: "pending", rule: "queue", value: "920" })],
      tab: [row("t1", { title: "即将发生", key: "upcoming", count: 12, enabled: "enabled" }), row("t2", { title: "待确认", key: "unconfirmed", count: 3, enabled: "enabled" })],
      formTab: [row("f1", { title: "基础", key: "basic", errors: 0, dirty: 2 }), row("f2", { title: "排期", key: "schedule", errors: 2, dirty: 1 })],
      option: [row("o1", { type: "团队", key: "medical", title: "医疗组" }), row("o2", { type: "成员", key: "chen", title: "陈医生" })],
      dashboard: [row("d1", { title: "支付监控", dirty: "dirty", canSave: "allowed", managed: "custom", template: "template" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "g1", type: "BookingCommandHeader", props: { surface: "plain" }, binding: { entityRef: "booking", titleFieldRef: "title", statusFieldRef: "status", startFieldRef: "start", endFieldRef: "end", locationFieldRef: "location", recurringFieldRef: "recurring", paidFieldRef: "paid", targets: ["detail"] } }, desktop: "booking-command-header", phone: "phone-booking-command-header" },
      { block: { id: "g2", type: "AlertRuleCommandHeader", props: { surface: "plain" }, binding: { entityRef: "rule", titleFieldRef: "title", stateFieldRef: "state", editableFieldRef: "editable", provisionedFieldRef: "provisioned", silenceableFieldRef: "silenceable", targets: ["rules"] } }, desktop: "alert-rule-command-header", phone: "phone-alert-rule-command-header" },
      { block: { id: "g3", type: "AlertStateMetrics", props: { surface: "plain" }, binding: { entityRef: "instance", stateFieldRef: "state", ruleIdFieldRef: "rule" } }, desktop: "alert-state-metrics", phone: "phone-alert-state-metrics" },
      { block: { id: "g4", type: "BookingCapacityMetrics", props: { surface: "plain" }, binding: { entityRef: "booking", capacityFieldRef: "capacity", bookedFieldRef: "booked", noShowFieldRef: "noShow", waitlistFieldRef: "waitlist" } }, desktop: "booking-capacity-metrics", phone: "phone-booking-capacity-metrics" },
      { block: { id: "g5", type: "BookingContextSummary", props: { surface: "plain" }, binding: { entityRef: "booking", titleFieldRef: "title", startFieldRef: "start", endFieldRef: "end", timezoneFieldRef: "timezone", locationFieldRef: "location", attendeeFieldRef: "attendee", recurringFieldRef: "recurring" } }, desktop: "booking-context-summary", phone: "phone-booking-context-summary" },
      { block: { id: "g6", type: "AlertInstanceSummary", props: { surface: "plain" }, binding: { entityRef: "instance", nameFieldRef: "name", valueFieldRef: "value", labelsFieldRef: "labels", summaryFieldRef: "summary", startedFieldRef: "started" } }, desktop: "alert-instance-summary", phone: "phone-alert-instance-summary" },
      { block: { id: "g7", type: "BookingStatusTabs", props: { surface: "plain" }, binding: { entityRef: "tab", titleFieldRef: "title", keyFieldRef: "key", countFieldRef: "count", enabledFieldRef: "enabled", targets: ["list"] } }, desktop: "booking-status-tabs", phone: "phone-booking-status-tabs" },
      { block: { id: "g8", type: "ValidatedFormTabs", props: { surface: "plain" }, binding: { entityRef: "formTab", titleFieldRef: "title", keyFieldRef: "key", errorCountFieldRef: "errors", dirtyCountFieldRef: "dirty", targets: ["form"] } }, desktop: "validated-form-tabs", phone: "phone-validated-form-tabs" },
      { block: { id: "g9", type: "AlertMatcherFilter", props: { surface: "plain", defaultQuery: "severity=\"critical\"" }, binding: { targets: ["alerts"] } }, desktop: "alert-matcher-filter", phone: "phone-alert-matcher-filter" },
      { block: { id: "g10", type: "BookingDirectoryFilter", props: { surface: "plain" }, binding: { entityRef: "option", typeFieldRef: "type", keyFieldRef: "key", titleFieldRef: "title", targets: ["list"] } }, desktop: "booking-directory-filter", phone: "phone-booking-directory-filter" },
      { block: { id: "g11", type: "BookingDecisionBar", props: { surface: "plain" }, binding: { entityRef: "booking", titleFieldRef: "title", statusFieldRef: "status", paidFieldRef: "paid", recurringFieldRef: "recurring", targets: ["detail"] } }, desktop: "booking-decision-bar", phone: "phone-booking-decision-bar" },
      { block: { id: "g12", type: "DashboardSaveBar", props: { surface: "plain" }, binding: { entityRef: "dashboard", titleFieldRef: "title", dirtyFieldRef: "dirty", canSaveFieldRef: "canSave", managedFieldRef: "managed", templateFieldRef: "template", targets: ["dashboard"] } }, desktop: "dashboard-save-bar", phone: "phone-dashboard-save-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("工作项、文档与查询批次的 14 个稀缺区域区块都有独立双端渲染器", () => {
    const entityRows = {
      work: [row("w1", { title: "完善巡检流程", status: "in_progress", priority: "high", assignee: "陈晓", project: "运营平台", cycle: "八月", due: "2026-08-18", labels: "流程" })],
      document: [row("d1", { title: "巡检手册", state: "draft", permission: "publish", revision: "", collection: "运营规范", owner: "周宁", visibility: "团队", updated: "11:25", dirty: "dirty", location: "运营 / 门店" })],
      environment: [row("e1", { name: "生产", status: "healthy" })],
      freshness: [row("f1", { source: "订单数仓", updated: "11:28", status: "fresh" })],
      tab: [row("t1", { title: "概览", key: "overview", count: 0, enabled: "enabled" })],
      option: [row("o1", { type: "状态", key: "doing", title: "进行中" })],
      parameter: [row("p1", { title: "区域", key: "region", value: "华东", required: "required" })],
      cycle: [row("c1", { completed: 34, total: 52, overdue: 5, unstarted: 8 })],
      query: [row("q1", { time: 842, rows: 1280, cached: "realtime", bytes: 1843200 })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; extra?: Record<string, unknown>; desktop: string; phone: string }> = [
      { block: { id: "h1", type: "WorkItemCommandHeader", props: { surface: "plain" }, binding: { entityRef: "work", titleFieldRef: "title", statusFieldRef: "status", priorityFieldRef: "priority", assigneeFieldRef: "assignee", targets: ["detail"] } }, desktop: "work-item-command-header", phone: "phone-work-item-command-header" },
      { block: { id: "h2", type: "DocumentCommandHeader", props: { surface: "plain" }, binding: { entityRef: "document", titleFieldRef: "title", stateFieldRef: "state", permissionFieldRef: "permission", revisionFieldRef: "revision", targets: ["editor"] } }, desktop: "document-command-header", phone: "phone-document-command-header" },
      { block: { id: "h3", type: "EnvironmentStatusStrip", props: { surface: "plain" }, binding: { entityRef: "environment", nameFieldRef: "name", statusFieldRef: "status" } }, desktop: "environment-status-strip", phone: "phone-environment-status-strip" },
      { block: { id: "h4", type: "DataFreshnessIndicator", props: { surface: "plain" }, binding: { entityRef: "freshness", sourceFieldRef: "source", updatedAtFieldRef: "updated", statusFieldRef: "status", targets: ["dashboard"] } }, desktop: "data-freshness-indicator", phone: "phone-data-freshness-indicator" },
      { block: { id: "h5", type: "WorkItemContextSummary", props: { surface: "plain" }, binding: { entityRef: "work", titleFieldRef: "title", fieldRefs: ["project", "cycle", "due", "labels"] } }, desktop: "work-item-context-summary", phone: "phone-work-item-context-summary" },
      { block: { id: "h10", type: "DashboardParameterBar", props: { surface: "plain" }, binding: { entityRef: "parameter", titleFieldRef: "title", keyFieldRef: "key", valueFieldRef: "value", requiredFieldRef: "required", targets: ["dashboard"] } }, desktop: "dashboard-parameter-bar", phone: "phone-dashboard-parameter-bar" },
      { block: { id: "h11", type: "CycleHealthMetrics", props: { surface: "plain" }, binding: { entityRef: "cycle", completedFieldRef: "completed", totalFieldRef: "total", overdueFieldRef: "overdue", unstartedFieldRef: "unstarted" } }, desktop: "cycle-health-metrics", phone: "phone-cycle-health-metrics" },
      { block: { id: "h12", type: "QueryExecutionMetrics", props: { surface: "plain" }, binding: { entityRef: "query", timeFieldRef: "time", rowsFieldRef: "rows", cachedFieldRef: "cached", bytesFieldRef: "bytes" } }, desktop: "query-execution-metrics", phone: "phone-query-execution-metrics" },
      { block: { id: "h13", type: "BulkSelectionBar", props: { surface: "plain" }, binding: { entityRef: "work", targets: ["list"] } }, extra: { selection: { rowIds: { work: ["w1"] } } }, desktop: "bulk-selection-bar", phone: "phone-bulk-selection-bar" },
      { block: { id: "h14", type: "DraftPublishBar", props: { surface: "plain" }, binding: { entityRef: "document", titleFieldRef: "title", stateFieldRef: "state", dirtyFieldRef: "dirty", canPublishFieldRef: "permission", locationFieldRef: "location", targets: ["editor"] } }, desktop: "draft-publish-bar", phone: "phone-draft-publish-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows, ...(testCase.extra ?? {}) };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("目录、协作与查询工作区的 14 个新区块都有独立双端渲染器", () => {
    const entityRows = {
      question: [row("q1", { title: "履约趋势", saved: "saved", dirty: "dirty", bookmarked: "bookmarked", status: "completed", runnable: "runnable", time: 842, cached: "realtime" })],
      entity: [row("e1", { title: "订单服务", kind: "Component", type: "service", starred: "starred", owner: "数据平台", lifecycle: "production", system: "交易平台", domain: "零售" })],
      collaborator: [row("c1", { name: "周宁", present: "present", editing: "editing" }), row("c2", { name: "陈晓", present: "present", editing: "viewing" })],
      source: [row("s1", { database: "经营数仓", schema: "commerce", source: "store_daily", type: "模型" })],
      tab: [row("t1", { title: "查询", key: "query", count: 0, enabled: "enabled" }), row("t2", { title: "字段", key: "columns", count: 18, enabled: "enabled" })],
      option: [row("o1", { facet: "种类", key: "component", title: "Component" }), row("o2", { facet: "生命周期", key: "production", title: "生产" })],
      clause: [row("f1", { field: "区域", operator: "=", value: "华东", enabled: "enabled" })],
      insight: [row("i1", { views: 1842, contributors: 6, created: "2026-07-18", updated: "2026-08-09" })],
      quality: [row("m1", { total: 24, documented: 19, typed: 21 })],
      document: [row("d1", { title: "巡检手册", visibility: "public", domain: "docs.example.com", permission: "share", link: "https://docs.example.com/inspection" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "i1", type: "QuestionCommandHeader", props: { surface: "plain" }, binding: { entityRef: "question", titleFieldRef: "title", savedFieldRef: "saved", dirtyFieldRef: "dirty", bookmarkFieldRef: "bookmarked", targets: ["query"] } }, desktop: "question-command-header", phone: "phone-question-command-header" },
      { block: { id: "i2", type: "CatalogEntityCommandHeader", props: { surface: "plain" }, binding: { entityRef: "entity", titleFieldRef: "title", kindFieldRef: "kind", typeFieldRef: "type", starredFieldRef: "starred", targets: ["detail"] } }, desktop: "catalog-entity-command-header", phone: "phone-catalog-entity-command-header" },
      { block: { id: "i3", type: "CollaboratorPresenceStrip", props: { surface: "plain" }, binding: { entityRef: "collaborator", nameFieldRef: "name", presentFieldRef: "present", editingFieldRef: "editing" } }, desktop: "collaborator-presence-strip", phone: "phone-collaborator-presence-strip" },
      { block: { id: "i4", type: "QueryRunStatusStrip", props: { surface: "plain" }, binding: { entityRef: "question", statusFieldRef: "status", timeFieldRef: "time", cachedFieldRef: "cached", targets: ["query"] } }, desktop: "query-run-status-strip", phone: "phone-query-run-status-strip" },
      { block: { id: "i5", type: "EntityOwnershipSummary", props: { surface: "plain" }, binding: { entityRef: "entity", titleFieldRef: "title", ownerFieldRef: "owner", lifecycleFieldRef: "lifecycle", systemFieldRef: "system", domainFieldRef: "domain" } }, desktop: "entity-ownership-summary", phone: "phone-entity-ownership-summary" },
      { block: { id: "i6", type: "QueryDataSourceSummary", props: { surface: "plain" }, binding: { entityRef: "source", databaseFieldRef: "database", schemaFieldRef: "schema", sourceFieldRef: "source", typeFieldRef: "type" } }, desktop: "query-data-source-summary", phone: "phone-query-data-source-summary" },
      { block: { id: "i10", type: "QueryClauseFilterBar", props: { surface: "plain" }, binding: { entityRef: "clause", fieldFieldRef: "field", operatorFieldRef: "operator", valueFieldRef: "value", enabledFieldRef: "enabled", targets: ["query"] } }, desktop: "query-clause-filter-bar", phone: "phone-query-clause-filter-bar" },
      { block: { id: "i12", type: "MetadataQualityMetrics", props: { surface: "plain" }, binding: { entityRef: "quality", totalFieldRef: "total", documentedFieldRef: "documented", typedFieldRef: "typed" } }, desktop: "metadata-quality-metrics", phone: "phone-metadata-quality-metrics" },
      { block: { id: "i13", type: "QuestionExecutionBar", props: { surface: "plain" }, binding: { entityRef: "question", statusFieldRef: "status", runnableFieldRef: "runnable", dirtyFieldRef: "dirty", targets: ["query"] } }, desktop: "question-execution-bar", phone: "phone-question-execution-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("周期、事故与运行可靠性批次的 14 个区块都有独立双端渲染器", () => {
    const entityRows = {
      cycle: [row("c1", { title: "八月周期", status: "active", editable: "editable", owner: "周宁", members: "陈晓、林静", dates: "08-01 至 08-18", progress: "34 / 52" })],
      group: [row("g1", { title: "支付规则组", status: "active", editable: "editable", interval: "1 分钟", namespace: "production", rules: "12 条", firing: "3 个", datasource: "Prometheus" })],
      ownership: [row("o1", { assignee: "陈晓", source: "ownership_rule", suggested: "支付组" })],
      schedule: [row("s1", { frequency: "30 分钟", next: "2026-08-09 12:00", timezone: "Asia/Shanghai", status: "active" })],
      tab: [row("t1", { title: "设置", key: "setup", count: 0, enabled: "enabled" }), row("t2", { title: "Webhook", key: "webhooks", count: 1, enabled: "disabled" })],
      option: [row("f1", { type: "状态", key: "active", title: "进行中" }), row("f2", { type: "开始时间", key: "august", title: "八月" })],
      reliability: [row("r1", { success: 47, failed: 3, records: 18420, freshness: "8 分钟" })],
      evaluation: [row("e1", { active: 38, paused: 4, errors: 2, duration: 128 })],
      eventType: [row("v1", { title: "专家义诊", hidden: "hidden", dirty: "dirty", valid: "valid" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "j1", type: "CycleCommandHeader", props: { surface: "plain" }, binding: { entityRef: "cycle", titleFieldRef: "title", statusFieldRef: "status", editableFieldRef: "editable", targets: ["cycle"] } }, desktop: "cycle-command-header", phone: "phone-cycle-command-header" },
      { block: { id: "j2", type: "AlertGroupCommandHeader", props: { surface: "plain" }, binding: { entityRef: "group", titleFieldRef: "title", statusFieldRef: "status", editableFieldRef: "editable", intervalFieldRef: "interval", targets: ["rules"] } }, desktop: "alert-group-command-header", phone: "phone-alert-group-command-header" },
      { block: { id: "j3", type: "IncidentOwnershipStrip", props: { surface: "plain" }, binding: { entityRef: "ownership", assigneeFieldRef: "assignee", sourceFieldRef: "source", suggestedFieldRef: "suggested", targets: ["issue"] } }, desktop: "incident-ownership-strip", phone: "phone-incident-ownership-strip" },
      { block: { id: "j4", type: "SyncScheduleStrip", props: { surface: "plain" }, binding: { entityRef: "schedule", frequencyFieldRef: "frequency", nextRunFieldRef: "next", timezoneFieldRef: "timezone", statusFieldRef: "status", targets: ["connection"] } }, desktop: "sync-schedule-strip", phone: "phone-sync-schedule-strip" },
      { block: { id: "j9", type: "CycleFilterBar", props: { surface: "plain" }, binding: { entityRef: "option", typeFieldRef: "type", keyFieldRef: "key", titleFieldRef: "title", targets: ["cycles"] } }, desktop: "cycle-filter-bar", phone: "phone-cycle-filter-bar" },
      { block: { id: "j10", type: "AlertRuleFilterBar", props: { surface: "plain", defaultQuery: "state:firing" }, binding: { targets: ["rules"] } }, desktop: "alert-rule-filter-bar", phone: "phone-alert-rule-filter-bar" },
      { block: { id: "j11", type: "SyncReliabilityMetrics", props: { surface: "plain" }, binding: { entityRef: "reliability", successFieldRef: "success", failedFieldRef: "failed", recordsFieldRef: "records", freshnessFieldRef: "freshness" } }, desktop: "sync-reliability-metrics", phone: "phone-sync-reliability-metrics" },
      { block: { id: "j12", type: "RuleEvaluationMetrics", props: { surface: "plain" }, binding: { entityRef: "evaluation", activeFieldRef: "active", pausedFieldRef: "paused", errorFieldRef: "errors", durationFieldRef: "duration" } }, desktop: "rule-evaluation-metrics", phone: "phone-rule-evaluation-metrics" },
      { block: { id: "j14", type: "EventTypePublishBar", props: { surface: "plain" }, binding: { entityRef: "eventType", titleFieldRef: "title", hiddenFieldRef: "hidden", dirtyFieldRef: "dirty", validFieldRef: "valid", targets: ["event"] } }, desktop: "event-type-publish-bar", phone: "phone-event-type-publish-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("客服会话与身份权限批次的 14 个区块都有独立双端渲染器", () => {
    const entityRows = {
      conversation: [row("c1", { name: "张女士", status: "open", verified: "verified", inbox: "微信", assignee: "陈晓", team: "售后组", priority: "urgent", channel: "wechat", phone: "138****", sla: "12 分钟" })],
      user: [row("u1", { username: "wang.xiao", enabled: "enabled", impersonate: "allowed", email: "x@example.com", provider: "ldap", created: "2026-06-18", verified: "verified", actions: "更新密码", sessions: 3, manageable: "allowed" })],
      realm: [row("r1", { name: "whybuddy", enabled: "enabled", brute: "enabled", ssl: "external" })],
      tab: [row("t1", { title: "详情", key: "details", count: 0, enabled: "enabled" }), row("t2", { title: "会话", key: "sessions", count: 3, enabled: "enabled" })],
      option: [row("o1", { type: "状态", key: "open", title: "待处理" }), row("o2", { type: "优先级", key: "urgent", title: "紧急" })],
      sla: [row("s1", { first: "4 分钟", resolution: "1 小时", breaches: 7, count: 286 })],
      sessions: [row("m1", { active: 18, offline: 4, clients: 6, risk: 2 })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "k1", type: "ConversationCommandHeader", props: { surface: "plain" }, binding: { entityRef: "conversation", titleFieldRef: "name", statusFieldRef: "status", verifiedFieldRef: "verified", inboxFieldRef: "inbox", targets: ["conversation"] } }, desktop: "conversation-command-header", phone: "phone-conversation-command-header" },
      { block: { id: "k2", type: "UserCommandHeader", props: { surface: "plain" }, binding: { entityRef: "user", usernameFieldRef: "username", enabledFieldRef: "enabled", impersonateFieldRef: "impersonate", targets: ["user"] } }, desktop: "user-command-header", phone: "phone-user-command-header" },
      { block: { id: "k3", type: "ConversationAssignmentStrip", props: { surface: "plain" }, binding: { entityRef: "conversation", assigneeFieldRef: "assignee", teamFieldRef: "team", priorityFieldRef: "priority", targets: ["conversation"] } }, desktop: "conversation-assignment-strip", phone: "phone-conversation-assignment-strip" },
      { block: { id: "k4", type: "RealmStatusStrip", props: { surface: "plain" }, binding: { entityRef: "realm", nameFieldRef: "name", enabledFieldRef: "enabled", bruteForceFieldRef: "brute", sslFieldRef: "ssl", targets: ["realm"] } }, desktop: "realm-status-strip", phone: "phone-realm-status-strip" },
      { block: { id: "k10", type: "UserDirectoryFilter", props: { surface: "plain" }, binding: { targets: ["users"] } }, desktop: "user-directory-filter", phone: "phone-user-directory-filter" },
      { block: { id: "k11", type: "ConversationSlaMetrics", props: { surface: "plain" }, binding: { entityRef: "sla", firstResponseFieldRef: "first", resolutionFieldRef: "resolution", breachFieldRef: "breaches", countFieldRef: "count" } }, desktop: "conversation-sla-metrics", phone: "phone-conversation-sla-metrics" },
      { block: { id: "k13", type: "ConversationReplyBar", props: { surface: "plain" }, binding: { entityRef: "conversation", statusFieldRef: "status", channelFieldRef: "channel", targets: ["messages"] } }, desktop: "conversation-reply-bar", phone: "phone-conversation-reply-bar" },
      { block: { id: "k14", type: "UserAccessBar", props: { surface: "plain" }, binding: { entityRef: "user", usernameFieldRef: "username", enabledFieldRef: "enabled", sessionsFieldRef: "sessions", manageableFieldRef: "manageable", targets: ["user"] } }, desktop: "user-access-bar", phone: "phone-user-access-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("图表与运行上下文批次的 12 个区块都有独立双端渲染器", () => {
    const entityRows = {
      series: [row("s1", { time: "08-01", value: 12, lower: 8, upper: 16, anomaly: "normal", cohort: "七月", period: "第 1 周", rate: 72, status: "success", p50: 80, p95: 140, p99: 220 })],
      tab: [row("t1", { title: "概览", key: "overview", count: 2, enabled: "enabled" })],
      connection: [row("c1", { status: "healthy" }), row("c2", { status: "failed" })],
      issue: [row("i1", { events: 128, users: 34, first: "08-01", last: "08-10" })],
      context: [row("x1", { title: "订单服务", owner: "交易组", lifecycle: "production", source: "经营仓", filters: 3 })],
      release: [row("r1", { version: "2026.08.10", health: 99.5, environment: "production", adoption: 62 })],
      dashboard: [row("d1", { title: "经营总览", starred: "starred", subscribed: "subscribed", editable: "editable" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "l1", type: "TimeSeriesAnomalyChart", props: { surface: "plain" }, binding: { entityRef: "series", timeFieldRef: "time", valueFieldRef: "value", lowerFieldRef: "lower", upperFieldRef: "upper", anomalyFieldRef: "anomaly" } }, desktop: "time-series-anomaly-chart", phone: "phone-time-series-anomaly-chart" },
      { block: { id: "l2", type: "CohortRetentionChart", props: { surface: "plain" }, binding: { entityRef: "series", cohortFieldRef: "cohort", periodFieldRef: "period", rateFieldRef: "rate" } }, desktop: "cohort-retention-chart", phone: "phone-cohort-retention-chart" },
      { block: { id: "l3", type: "UptimeStatusTimeline", props: { surface: "plain" }, binding: { entityRef: "series", timeFieldRef: "time", statusFieldRef: "status" } }, desktop: "uptime-status-timeline", phone: "phone-uptime-status-timeline" },
      { block: { id: "l4", type: "PercentileBandChart", props: { surface: "plain" }, binding: { entityRef: "series", timeFieldRef: "time", p50FieldRef: "p50", p95FieldRef: "p95", p99FieldRef: "p99" } }, desktop: "percentile-band-chart", phone: "phone-percentile-band-chart" },
      { block: { id: "l7", type: "ConnectionFleetMetrics", props: { surface: "plain" }, binding: { entityRef: "connection", statusFieldRef: "status", targets: ["connections"] } }, desktop: "connection-fleet-metrics", phone: "phone-connection-fleet-metrics" },
      { block: { id: "l8", type: "IssueImpactMetrics", props: { surface: "plain" }, binding: { entityRef: "issue", eventCountFieldRef: "events", userCountFieldRef: "users", firstSeenFieldRef: "first", lastSeenFieldRef: "last" } }, desktop: "issue-impact-metrics", phone: "phone-issue-impact-metrics" },
      { block: { id: "l11", type: "ReleaseHealthStrip", props: { surface: "plain" }, binding: { entityRef: "release", versionFieldRef: "version", healthFieldRef: "health", environmentFieldRef: "environment", adoptionFieldRef: "adoption" } }, desktop: "release-health-strip", phone: "phone-release-health-strip" },
      { block: { id: "l12", type: "DashboardCommandHeader", props: { surface: "plain" }, binding: { entityRef: "dashboard", titleFieldRef: "title", starredFieldRef: "starred", subscribedFieldRef: "subscribed", editableFieldRef: "editable", targets: ["dashboard"] } }, desktop: "dashboard-command-header", phone: "phone-dashboard-command-header" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("部署与发布批次的 16 个区块都有独立双端渲染器", () => {
    const entityRows = {
      series: [row("s1", { time: "08-09", queue: 8, pull: 20, start: 14, ready: 44, adoption: 86, health: 99.5 })],
      tab: [row("t1", { title: "概览", key: "overview", count: 2, enabled: "enabled" })],
      workload: [row("w1", { title: "order-api", status: "healthy", editable: "editable", desired: 6, ready: 5, available: 5, unavailable: 1, namespace: "commerce", cluster: "prod", image: "order:latest" })],
      release: [row("r1", { title: "2026.08.10", environment: "production", status: "active", adoption: 86, health: 99.5, events: 12, users: 8, project: "whybuddy", commit: "77f469a" })],
      cluster: [row("c1", { name: "prod-cn", status: "healthy", nodes: 12, version: "v1.31" })],
      flag: [row("f1", { title: "new-checkout", enabled: "enabled", rollout: 25, editable: "editable" })],
      option: [row("o1", { facet: "环境", key: "production", title: "production" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "m1", type: "DeploymentLatencyChart", props: { surface: "plain" }, binding: { entityRef: "series", timeFieldRef: "time", queueFieldRef: "queue", pullFieldRef: "pull", startFieldRef: "start", readyFieldRef: "ready" } }, desktop: "deployment-latency-chart", phone: "phone-deployment-latency-chart" },
      { block: { id: "m2", type: "ReleaseAdoptionTrendChart", props: { surface: "plain" }, binding: { entityRef: "series", timeFieldRef: "time", adoptionFieldRef: "adoption", healthFieldRef: "health" } }, desktop: "release-adoption-trend-chart", phone: "phone-release-adoption-trend-chart" },
      { block: { id: "m5", type: "DeploymentRolloutMetrics", props: { surface: "plain" }, binding: { entityRef: "workload", desiredFieldRef: "desired", readyFieldRef: "ready", availableFieldRef: "available", unavailableFieldRef: "unavailable" } }, desktop: "deployment-rollout-metrics", phone: "phone-deployment-rollout-metrics" },
      { block: { id: "m6", type: "ReleaseAdoptionMetrics", props: { surface: "plain" }, binding: { entityRef: "release", adoptionFieldRef: "adoption", healthFieldRef: "health", eventCountFieldRef: "events", userCountFieldRef: "users" } }, desktop: "release-adoption-metrics", phone: "phone-release-adoption-metrics" },
      { block: { id: "m7", type: "ClusterHealthStrip", props: { surface: "plain" }, binding: { entityRef: "cluster", nameFieldRef: "name", statusFieldRef: "status", nodeCountFieldRef: "nodes", versionFieldRef: "version" } }, desktop: "cluster-health-strip", phone: "phone-cluster-health-strip" },
      { block: { id: "m8", type: "ReleaseEnvironmentStrip", props: { surface: "plain" }, binding: { entityRef: "release", versionFieldRef: "title", environmentFieldRef: "environment", statusFieldRef: "status", targets: ["release"] } }, desktop: "release-environment-strip", phone: "phone-release-environment-strip" },
      { block: { id: "m13", type: "DeploymentCommandHeader", props: { surface: "plain" }, binding: { entityRef: "workload", titleFieldRef: "title", statusFieldRef: "status", editableFieldRef: "editable", targets: ["deployment"] } }, desktop: "deployment-command-header", phone: "phone-deployment-command-header" },
      { block: { id: "m14", type: "FeatureFlagCommandHeader", props: { surface: "plain" }, binding: { entityRef: "flag", titleFieldRef: "title", enabledFieldRef: "enabled", rolloutFieldRef: "rollout", editableFieldRef: "editable", targets: ["flag"] } }, desktop: "feature-flag-command-header", phone: "phone-feature-flag-command-header" },
      { block: { id: "m15", type: "DeploymentScaleBar", props: { surface: "plain" }, binding: { entityRef: "workload", desiredFieldRef: "desired", readyFieldRef: "ready", editableFieldRef: "editable", targets: ["deployment"] } }, desktop: "deployment-scale-bar", phone: "phone-deployment-scale-bar" },
      { block: { id: "m16", type: "ReleaseRolloutBar", props: { surface: "plain" }, binding: { entityRef: "release", statusFieldRef: "status", adoptionFieldRef: "adoption", healthFieldRef: "health", targets: ["release"] } }, desktop: "release-rollout-bar", phone: "phone-release-rollout-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("工作流分析与预约冲突批次的 10 个区块都有独立双端渲染器", () => {
    const entityRows = {
      flow: [row("f1", { time: "08-09", state: "进行中", count: 7, available: 42, booked: 31, canceled: 3 })],
      tab: [row("t1", { title: "详情", key: "detail", count: 2, enabled: "enabled" })],
      metric: [row("m1", { completed: 43, entered: 51, wip: 7, blocked: 2, available: 2400, booked: 1870, canceled: 14, noShow: 6 })],
      risk: [row("r1", { title: "八月周期", remaining: 6, blocked: 2, overdue: 1 })],
      calendar: [row("c1", { account: "ops@example.com", status: "failed", provider: "Outlook", synced: "1 小时前" })],
      work: [row("w1", { title: "完善错误提示", group: "当前周期" }), row("w2", { title: "候选", group: "下个周期" })],
      conflict: [row("b1", { title: "专家门诊", start: "10:00", end: "10:30", severity: "high" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "n1", type: "CumulativeFlowChart", props: { surface: "plain" }, binding: { entityRef: "flow", timeFieldRef: "time", stateFieldRef: "state", valueFieldRef: "count" } }, desktop: "cumulative-flow-chart", phone: "phone-cumulative-flow-chart" },
      { block: { id: "n2", type: "BookingDemandChart", props: { surface: "plain" }, binding: { entityRef: "flow", timeFieldRef: "time", availableFieldRef: "available", bookedFieldRef: "booked", canceledFieldRef: "canceled" } }, desktop: "booking-demand-chart", phone: "phone-booking-demand-chart" },
      { block: { id: "n7", type: "CycleRiskStrip", props: { surface: "plain" }, binding: { entityRef: "risk", titleFieldRef: "title", remainingFieldRef: "remaining", blockedFieldRef: "blocked", overdueFieldRef: "overdue" } }, desktop: "cycle-risk-strip", phone: "phone-cycle-risk-strip" },
      { block: { id: "n9", type: "WorkItemMoveDrawer", props: { surface: "plain" }, binding: { entityRef: "work", titleFieldRef: "title", groupFieldRef: "group", targets: ["work"] } }, desktop: "work-item-move-drawer", phone: "phone-work-item-move-drawer" },
      { block: { id: "n10", type: "BookingConflictDrawer", props: { surface: "plain" }, binding: { entityRef: "conflict", titleFieldRef: "title", startFieldRef: "start", endFieldRef: "end", severityFieldRef: "severity", targets: ["booking"] } }, desktop: "booking-conflict-drawer", phone: "phone-booking-conflict-drawer" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });

  it("工作流运行与 Realm 安全批次的 13 个区块都有独立双端渲染器", () => {
    const entityRows = {
      duration: [row("d1", { time: "08-09", average: 690, p95: 1180, failed: 2100 })],
      tab: [row("t1", { title: "概要", key: "summary", count: 2, enabled: "enabled" })],
      outcome: [row("o1", { success: 184, failed: 7, running: 3, pending: 11 })],
      workflow: [row("w1", { title: "订单异常处理", name: "订单异常处理", enabled: "enabled", version: "v12", editable: "editable", updated: "8 分钟前", trigger: "订单创建", owner: "交易组" })],
      failure: [row("f1", { node: "发送通知", message: "Webhook 502", status: "failed", time: "11:42" })],
      option: [row("p1", { facet: "状态", key: "failed", title: "失败" })],
      execution: [row("e1", { status: "started", progress: 62 })],
      realm: [row("r1", { title: "whybuddy", name: "whybuddy", enabled: "enabled", manageable: "allowed", ssl: "external", brute: "enabled" })],
      credential: [row("c1", { username: "wang.xiao", resettable: "allowed", temporary: "temporary", updated: "08-01" })],
    };
    const cases: Array<{ block: ExperienceBlockInstance; desktop: string; phone: string }> = [
      { block: { id: "p1", type: "WorkflowDurationChart", props: { surface: "plain" }, binding: { entityRef: "duration", timeFieldRef: "time", averageFieldRef: "average", p95FieldRef: "p95", failedFieldRef: "failed" } }, desktop: "workflow-duration-chart", phone: "phone-workflow-duration-chart" },
      { block: { id: "p3", type: "WorkflowOutcomeMetrics", props: { surface: "plain" }, binding: { entityRef: "outcome", successFieldRef: "success", failedFieldRef: "failed", runningFieldRef: "running", pendingFieldRef: "pending" } }, desktop: "workflow-outcome-metrics", phone: "phone-workflow-outcome-metrics" },
      { block: { id: "p4", type: "WorkflowVersionStrip", props: { surface: "plain" }, binding: { entityRef: "workflow", nameFieldRef: "name", versionFieldRef: "version", enabledFieldRef: "enabled", updatedAtFieldRef: "updated" } }, desktop: "workflow-version-strip", phone: "phone-workflow-version-strip" },
      { block: { id: "p5", type: "WorkflowFailureDrawer", props: { surface: "plain" }, binding: { entityRef: "failure", nodeFieldRef: "node", messageFieldRef: "message", statusFieldRef: "status", timeFieldRef: "time", targets: ["execution"] } }, desktop: "workflow-failure-drawer", phone: "phone-workflow-failure-drawer" },
      { block: { id: "p6", type: "WorkflowCommandHeader", props: { surface: "plain" }, binding: { entityRef: "workflow", titleFieldRef: "title", enabledFieldRef: "enabled", versionFieldRef: "version", editableFieldRef: "editable", targets: ["workflow"] } }, desktop: "workflow-command-header", phone: "phone-workflow-command-header" },
      { block: { id: "p9", type: "WorkflowControlBar", props: { surface: "plain" }, binding: { entityRef: "execution", statusFieldRef: "status", progressFieldRef: "progress", targets: ["execution"] } }, desktop: "workflow-control-bar", phone: "phone-workflow-control-bar" },
      { block: { id: "p10", type: "RealmCommandHeader", props: { surface: "plain" }, binding: { entityRef: "realm", nameFieldRef: "name", enabledFieldRef: "enabled", manageableFieldRef: "manageable", targets: ["realm"] } }, desktop: "realm-command-header", phone: "phone-realm-command-header" },
      { block: { id: "p13", type: "CredentialLifecycleBar", props: { surface: "plain" }, binding: { entityRef: "credential", usernameFieldRef: "username", resettableFieldRef: "resettable", temporaryFieldRef: "temporary", updatedAtFieldRef: "updated", targets: ["credentials"] } }, desktop: "credential-lifecycle-bar", phone: "phone-credential-lifecycle-bar" },
    ];
    for (const testCase of cases) {
      const props = { block: testCase.block, entityRows };
      expect(renderToStaticMarkup(<ExperienceBlockBoundary {...props} />)).toContain(`data-testid="${testCase.desktop}"`);
      expect(renderToStaticMarkup(<PhoneExperienceBlock {...props} />)).toContain(`data-testid="${testCase.phone}"`);
    }
  });
});
