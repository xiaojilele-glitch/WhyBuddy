import { describe, it, expect } from "vitest";
import {
  buildAiActionInputs,
  deriveAppRuntimeSchema,
  type AppPageSchema,
} from "../live-runtime/app-runtime-schema";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "member_card",
        name: "会员卡",
        fields: [
          { id: "id", name: "编号", type: "string" },
          { id: "holder", name: "持卡人", type: "string" },
          { id: "balance", name: "余额", type: "number" },
          { id: "coach_ref", name: "私教", type: "ref" },
        ],
      },
      {
        id: "coach",
        name: "私教",
        fields: [{ id: "name", name: "姓名", type: "string" }],
      },
    ],
  },
  rbac: {
    roles: ["member", "manager"],
    permissions: ["card:create"],
    menus: [],
  },
  workflow: {
    nodes: [
      { id: "submit", name: "提交核销" },
      { id: "approve", name: "经理审批" },
    ],
    transitions: [{ from: "submit", to: "approve" }],
  },
  page: {
    pages: [
      {
        id: "card_page",
        name: "会员卡核销",
        fieldBindings: [
          "member_card.holder",
          "member_card.balance",
          "coach.name",
        ],
        actionPermissions: ["card:create"],
      },
      { id: "empty_page", name: "无绑定页", fieldBindings: [] },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "余额提醒文案",
        inputFields: [
          "member_card.holder",
          "member_card.balance",
          "coach.name",
        ],
        outputField: "member_card.balance",
      },
      {
        id: "cap_write",
        name: "持卡人画像",
        inputFields: ["member_card.holder"],
        outputField: "member_card.holder",
      },
      {
        id: "cap_dangling",
        name: "悬空输出",
        inputFields: [],
        outputField: "member_card.not_a_field",
      },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "card_page", workflowRef: "wf" }],
    roleRefs: ["member"],
    dataModelRefs: ["member_card"],
  },
};

describe("deriveAppRuntimeSchema（应用运行 option）", () => {
  it("projects the single-device authority marker into runtime identity", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.appbundle!.preferredDevice = "phone";
    (model.appbundle as Record<string, unknown>).deviceAuthority = "single-v1";

    const schema = deriveAppRuntimeSchema(model)!;

    expect(schema.identity.preferredDevice).toBe("phone");
    expect(schema.identity.deviceAuthority).toBe("single-v1");
  });

  it("preserves a valid Pro workbench surface declaration", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].surface = {
      type: "split-list",
      density: "compact",
    };

    const schema = deriveAppRuntimeSchema(model)!;

    expect(schema.pages[0].surface).toEqual({
      type: "split-list",
      density: "compact",
      source: "model",
    });
  });

  it("deterministically types legacy business pages without another LLM call", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages = [
      { ...model.page!.pages![0], id: "members", name: "Member Registry" },
      { ...model.page!.pages![0], id: "coaches", name: "Coach Management" },
      { ...model.page!.pages![0], id: "checkins", name: "Check-in Console" },
      { ...model.page!.pages![0], id: "renewals", name: "Renewal Workbench" },
    ];

    const schema = deriveAppRuntimeSchema(model)!;

    expect(schema.pages.map(page => page.surface.type)).toEqual([
      "table",
      "split-list",
      "editable-table",
      "queue",
    ]);
    expect(schema.pages.every(page => page.surface.source === "inferred")).toBe(true);
  });

  it("keeps people-management pages split even when they are workflow-linked", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages = [
      { ...model.page!.pages![0], id: "coaches", name: "Coach Management" },
    ];
    model.appbundle!.pageBindings = [
      { pageRef: "coaches", workflowRef: "coach_lifecycle" },
    ];

    const schema = deriveAppRuntimeSchema(model)!;

    expect(schema.pages[0].workflowLinked).toBe(true);
    expect(schema.pages[0].surface.type).toBe("split-list");
  });

  it("页面主实体 = fieldBindings 中占多数的实体；表单项 = 绑定字段", () => {
    const schema = deriveAppRuntimeSchema(MODEL, "健身房系统")!;
    expect(schema.appName).toBe("健身房系统");
    expect(schema.roles).toEqual(["member", "manager"]);
    expect(schema.menus.map(m => m.label)).toEqual([
      "工作台",
      "会员卡核销",
      "无绑定页",
    ]);

    const page = schema.pages[0];
    expect(page.entityId).toBe("member_card");
    expect(page.formFields.map(f => f.id)).toEqual(["holder", "balance"]);
    expect(page.columns.map(f => f.id)).toContain("coach_ref");
    expect(page.workflowLinked).toBe(true);
    expect(page.actions).toEqual(["card:create"]);
  });

  it("工作台（home）JSON 化：统计卡声明来源，菜单首项指向 home", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.landingPageId).toBe("home");
    expect(schema.home.id).toBe("home");
    expect(schema.home.title).toBe("工作台");
    expect(schema.menus[0].pageId).toBe("home");
    // 前两实体行数 + 进行中/累计审批，共 4 张卡
    expect(schema.home.stats.map(s => s.source)).toEqual([
      "entity:member_card",
      "entity:coach",
      "instances:running",
      "instances:total",
    ]);
    // 图表也 JSON 声明：实体数据量条形 + 审批状态环图
    expect(schema.home.charts.map(c => `${c.type}:${c.source}`)).toEqual([
      "bar:entities:rowcount",
      "donut:instances:status",
    ]);
  });

  it("landingPageRef：真实业务页成为首屏且不再额外插入工作台；坏引用诚实回退", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.appbundle!.landingPageRef = "card_page";
    const schema = deriveAppRuntimeSchema(model)!;
    expect(schema.landingPageId).toBe("card_page");
    expect(schema.menus.map(m => m.pageId)).toEqual([
      "card_page",
      "empty_page",
    ]);
    expect(schema.menus.some(m => m.pageId === "home")).toBe(false);
    // home 仍保留为老模型/无可见页面的兼容回退，不出现在新应用菜单中。
    expect(schema.home.id).toBe("home");

    model.appbundle!.landingPageRef = "ghost_page";
    const fallback = deriveAppRuntimeSchema(model)!;
    expect(fallback.landingPageId).toBe("home");
    expect(fallback.menus[0].pageId).toBe("home");
  });

  it("体验区块：page.blocks 直接声明时透传 id/type/props；旧页面保持空数组", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].blocks = [
      { id: "metric_overview", type: "MetricGrid", props: { title: "概览" } },
      { id: "unknown", type: "MagicWall" },
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    expect(schema.pages[0].experienceBlocks).toEqual([
      { id: "metric_overview", type: "MetricGrid", props: { title: "概览" } },
      { id: "unknown", type: "MagicWall" },
    ]);
    expect(schema.pages[1].experienceBlocks).toEqual([]);
  });

  it("legacy 转换器：无 page.blocks 时 stats/charts/rankings/feeds 转为 _fromLegacy 区块", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].stats = [
      { id: "s1", name: "会员卡总数", entity: "member_card", metric: "count" },
    ];
    model.page!.pages![0].charts = [
      {
        id: "c1",
        name: "余额分布",
        type: "bar",
        dimension: "member_card.holder",
        metric: "count",
      },
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    const blocks = schema.pages[0].experienceBlocks;
    const statBlock = blocks.find(b => b.id === "legacy-stat-s1");
    expect(statBlock).toBeDefined();
    expect(statBlock!.type).toBe("MetricGrid");
    expect(statBlock!._fromLegacy).toBe(true);
    expect(statBlock!._legacyStat).toMatchObject({ id: "s1", metric: "count" });
    const chartBlock = blocks.find(b => b.id === "legacy-chart-c1");
    expect(chartBlock).toBeDefined();
    expect(chartBlock!.type).toBe("TrendChart");
    expect(chartBlock!._fromLegacy).toBe(true);
  });

  it("legacy 转换器：有 page.blocks 时不走 legacy 转换", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].stats = [
      { id: "s1", name: "会员卡总数", entity: "member_card", metric: "count" },
    ];
    model.page!.pages![0].blocks = [
      { id: "b1", type: "MetricGrid" },
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    const blocks = schema.pages[0].experienceBlocks;
    // 直接用 page.blocks，不生成 legacy 区块
    expect(blocks.every(b => !b._fromLegacy)).toBe(true);
    expect(blocks.map(b => b.id)).toEqual(["b1"]);
  });

  it("详情抽屉字段 = 主实体全字段（不截断）", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.pages[0].detailFields.map(f => f.id)).toEqual([
      "id",
      "holder",
      "balance",
      "coach_ref",
    ]);
  });

  it("ref 字段解析目标实体（coach_ref → coach）供下拉渲染", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const refField = schema.pages[0].columns.find(f => f.id === "coach_ref")!;
    expect(refField.type).toBe("ref");
    expect(refField.refEntityId).toBe("coach");
  });

  /**
   * refEntity：模型自己声明关系目标（2026-08-11）。
   *
   * 上面那条测的是**猜测**通道——从字段名反推。它在真实数据上只认得出 41%
   * （181 个存过的模型、1689 个 ref 字段，998 个猜不出来），而猜不出来的代价
   * 是关系字段退化成纯文本框，用户得手打行 id。所以契约里加了 `refEntity`，
   * 猜测降级成存量模型的兜底。
   *
   * 下面每条都配一句反向断言：不声明的时候现象确实是坏的。否则测试可能只是
   * 在证明"猜测本来就能猜对"，加不加声明都绿。
   */
  describe("refEntity 声明优先，猜测兜底", () => {
    /** 在 MODEL 的主实体上换一组字段，返回主实体的全字段 schema。 */
    function fieldsWith(
      fields: Array<Record<string, unknown>>,
      extraEntities: Array<Record<string, unknown>> = []
    ) {
      const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
      const entities = model.datamodel!.entities!;
      entities[0].fields = fields as typeof entities[0]["fields"];
      entities.push(...(extraEntities as unknown as typeof entities));
      return deriveAppRuntimeSchema(model)!.pages[0].detailFields;
    }

    it("声明的目标压过猜测 —— 名字像 coach 也照声明走", () => {
      const declared = fieldsWith(
        [{ id: "coach_ref", name: "私教", type: "ref", refEntity: "trainer" }],
        [{ id: "trainer", name: "教练", fields: [{ id: "name", type: "string" }] }]
      ).find(f => f.id === "coach_ref")!;
      expect(declared.refEntityId).toBe("trainer");

      // 反向：去掉声明，猜测会指到 coach——证明这条确实是声明在起作用
      const guessed = fieldsWith(
        [{ id: "coach_ref", name: "私教", type: "ref" }],
        [{ id: "trainer", name: "教练", fields: [{ id: "name", type: "string" }] }]
      ).find(f => f.id === "coach_ref")!;
      expect(guessed.refEntityId).toBe("coach");
    });

    it("名字压根对不上的字段，声明能把它从纯文本框里救回来", () => {
      // assigned_team → oncall_teams 是真实样本里的失败形态：词干完全不同
      const declared = fieldsWith(
        [{ id: "assigned_team", name: "值班组", type: "ref", refEntity: "oncall_teams" }],
        [{ id: "oncall_teams", name: "值班组", fields: [{ id: "name", type: "string" }] }]
      ).find(f => f.id === "assigned_team")!;
      expect(declared.refEntityId).toBe("oncall_teams");

      // 反向：不声明就是 undefined，渲染器拿不到候选行 → 退化成 Input
      const guessed = fieldsWith(
        [{ id: "assigned_team", name: "值班组", type: "ref" }],
        [{ id: "oncall_teams", name: "值班组", fields: [{ id: "name", type: "string" }] }]
      ).find(f => f.id === "assigned_team")!;
      expect(guessed.refEntityId).toBeUndefined();
    });

    it("悬空声明不回落去猜 —— 模型说错了就如实空着，别拿猜测盖掉", () => {
      const field = fieldsWith([
        { id: "coach_ref", name: "私教", type: "ref", refEntity: "not_an_entity" },
      ]).find(f => f.id === "coach_ref")!;
      // 注意不是 "coach"：猜测能猜对，但声明已经明确指向别处，
      // 悄悄改成猜出来的目标会让门禁标的红跟界面上的现象对不上
      expect(field.refEntityId).toBeUndefined();
    });

    it("声明的自引用要认，猜出来的自引用照旧丢弃", () => {
      // 指回同一张表是合法的（合卡时的 merged_into 之类）。声明了就认——
      // 运行时把模型的明确表态偷偷改掉，只会让门禁的绿灯跟界面对不上。
      const declared = fieldsWith([
        { id: "id", name: "编号", type: "string" },
        { id: "merged_into", name: "并入卡", type: "ref", refEntity: "member_card" },
      ]).find(f => f.id === "merged_into")!;
      expect(declared.refEntityId).toBe("member_card");

      // 反向：靠猜命中自己身上的（字段 member_card_ref 长在实体 member_card 上）
      // 多半是命名巧合，仍然丢弃
      const guessed = fieldsWith([
        { id: "id", name: "编号", type: "string" },
        { id: "member_card_ref", name: "上级卡", type: "ref" },
      ]).find(f => f.id === "member_card_ref")!;
      expect(guessed.refEntityId).toBeUndefined();
    });
  });

  it("AI 动作：outputField 落在本页主实体的能力进 aiActions；悬空输出不进", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const page = schema.pages[0];
    expect(page.aiActions.map(a => a.capId)).toEqual([
      "cap_summary",
      "cap_write",
    ]);
    const summary = page.aiActions[0];
    expect(summary.label).toBe("余额提醒文案");
    expect(summary.outputFieldId).toBe("balance");
    expect(summary.outputLabel).toBe("余额");
    // 悬空 outputField（member_card.not_a_field）被诚实排除
    expect(page.aiActions.some(a => a.capId === "cap_dangling")).toBe(false);
    // 无主实体的页面没有 AI 动作
    expect(schema.pages[1].aiActions).toEqual([]);
  });

  it("buildAiActionInputs：同实体字段从行值预填，跨实体引用留空不猜", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const action = schema.pages[0].aiActions[0]; // cap_summary
    const inputs = buildAiActionInputs(action, "member_card", {
      holder: "张三",
      balance: 42,
    });
    expect(inputs).toEqual({
      "member_card.holder": "张三",
      "member_card.balance": "42",
      "coach.name": "", // 跨实体 → 留空
    });
  });

  it("页面级图表：合法声明派生成 AppPageChartSchema，悬空/跨实体 sum 丢弃，未知 type 回退 bar", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].charts = [
      {
        id: "c1",
        name: "余额分布",
        type: "pie",
        dimension: "member_card.holder",
        metric: "count",
      },
      {
        id: "c2",
        name: "按人合计余额",
        type: "bar",
        dimension: "member_card.holder",
        metric: "sum:member_card.balance",
      },
      {
        id: "c3",
        name: "坏维度",
        type: "bar",
        dimension: "member_card.ghost",
        metric: "count",
      },
      {
        id: "c4",
        name: "跨实体求和",
        type: "bar",
        dimension: "member_card.holder",
        metric: "sum:coach.name",
      },
      {
        id: "c5",
        name: "未知形态",
        type: "radar" as never,
        dimension: "member_card.holder",
        metric: "count",
      },
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    const charts = schema.pages[0].charts;
    expect(charts.map(c => c.id)).toEqual(["c1", "c2", "c5"]); // c3/c4 悬空丢弃
    expect(charts[0]).toMatchObject({
      type: "pie",
      entityId: "member_card",
      dimensionFieldId: "holder",
      metric: "count",
      metricLabel: "数量",
    });
    expect(charts[1]).toMatchObject({
      metric: "sum",
      metricFieldId: "balance",
      metricLabel: "余额",
    });
    expect(charts[2].type).toBe("bar"); // radar 回退 bar
    // 无 charts 声明的页 → 空数组（老模型零变化）
    expect(schema.pages[1].charts).toEqual([]);
  });

  it("字段语义透传（加厚 schema 一期）：enum options 归一化、format 类型校验", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.datamodel!.entities![0].fields = [
      { id: "id", name: "编号", type: "string" },
      {
        id: "status",
        name: "状态",
        type: "enum",
        options: [
          { id: "待跟进", tone: "warning" },
          { id: "已成交", label: "已成交 ✓", tone: "success" },
          { id: "", tone: "danger" }, // 空 id 剔除
          { id: "待跟进", tone: "danger" }, // 重复保首个
          { id: "异常", tone: "rainbow" }, // 非法 tone 降级 default
        ],
      },
      { id: "amount", name: "金额", type: "number", format: "money" },
      { id: "phone", name: "电话", type: "string", format: "masked" },
      { id: "bad_fmt", name: "坏格式", type: "string", format: "money" }, // 类型不匹配丢弃
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    const fields = Object.fromEntries(
      schema.pages[0].detailFields.map(f => [f.id, f])
    );
    expect(fields.status.options).toEqual([
      { id: "待跟进", label: "待跟进", tone: "warning" },
      { id: "已成交", label: "已成交 ✓", tone: "success" },
      { id: "异常", label: "异常", tone: "default" },
    ]);
    expect(fields.amount.format).toBe("money");
    expect(fields.phone.format).toBe("masked");
    expect(fields.bad_fmt.format).toBeUndefined();
    expect(fields.id.options).toBeUndefined();
  });

  it("页面级 KPI 卡：count/sum/avg 派生，悬空实体与字段丢弃，未知 format 回退 number", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.page!.pages![0].stats = [
      { id: "s1", name: "会员卡总数", entity: "member_card", metric: "count" },
      {
        id: "s2",
        name: "余额合计",
        entity: "member_card",
        metric: "sum:member_card.balance",
        format: "money",
      },
      {
        id: "s3",
        name: "平均余额",
        entity: "member_card",
        metric: "avg:member_card.balance",
        format: "hex",
      },
      { id: "s4", name: "坏实体", entity: "ghost", metric: "count" },
      {
        id: "s5",
        name: "坏字段",
        entity: "member_card",
        metric: "sum:member_card.ghost",
      },
    ];
    const schema = deriveAppRuntimeSchema(model)!;
    const stats = schema.pages[0].stats;
    expect(stats.map(s => s.id)).toEqual(["s1", "s2", "s3"]); // s4/s5 悬空丢弃
    expect(stats[0]).toMatchObject({
      entityId: "member_card",
      metric: "count",
      format: "number",
    });
    expect(stats[1]).toMatchObject({
      metric: "sum",
      metricFieldId: "balance",
      format: "money",
    });
    expect(stats[2]).toMatchObject({ metric: "avg", format: "number" }); // hex 回退 number
    // 无 stats 声明的页 → 空数组（老模型零变化）
    expect(schema.pages[1].stats).toEqual([]);
  });

  it("页面范式派生（二期）：kanban/calendar 绑定成立即生效，绑不上诚实降级 workbench", () => {
    const model: FiveSystemModel = JSON.parse(JSON.stringify(MODEL));
    model.datamodel!.entities![0].fields!.push(
      {
        id: "status",
        name: "状态",
        type: "enum",
        options: [{ id: "待处理", tone: "warning" }],
      },
      { id: "due_at", name: "到期日", type: "date" }
    );
    const p = model.page!.pages![0];
    p.kind = "kanban";
    p.statusField = "member_card.status";
    let schema = deriveAppRuntimeSchema(model)!;
    expect(schema.pages[0].view).toEqual({
      kind: "kanban",
      statusFieldId: "status",
    });

    // calendar + colorBy
    p.kind = "calendar";
    p.dateField = "member_card.due_at";
    p.colorBy = "member_card.status";
    schema = deriveAppRuntimeSchema(model)!;
    expect(schema.pages[0].view).toEqual({
      kind: "calendar",
      dateFieldId: "due_at",
      colorByFieldId: "status",
    });

    // 绑定指向非对应类型字段 → 降级 workbench（门禁负责标红）
    p.kind = "kanban";
    p.statusField = "member_card.holder"; // string，非 enum
    schema = deriveAppRuntimeSchema(model)!;
    expect(schema.pages[0].view).toEqual({ kind: "workbench" });

    // dashboard 无绑定要求；缺省 kind = workbench（老模型零变化）
    p.kind = "dashboard";
    schema = deriveAppRuntimeSchema(model)!;
    expect(schema.pages[0].view).toEqual({ kind: "dashboard" });
    expect(schema.pages[1].view).toEqual({ kind: "workbench" });
  });

  it("无绑定页 entityId=null；缺页面/实体时整体返回 null（不伪造）", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.pages[1].entityId).toBeNull();
    expect(schema.pages[1].workflowLinked).toBe(false);
    expect(deriveAppRuntimeSchema({})).toBeNull();
    expect(
      deriveAppRuntimeSchema({ ...MODEL, page: { pages: [] } })
    ).toBeNull();
  });

  it("排行榜/动态流/donut（E40.4）：合法声明派生，悬空引用诚实丢弃", () => {
    const model: FiveSystemModel = {
      ...MODEL,
      datamodel: {
        entities: [
          {
            id: "task",
            name: "任务",
            fields: [
              { id: "title", name: "标题", type: "string" },
              { id: "score", name: "评分", type: "number" },
              { id: "due", name: "截止", type: "date" },
              {
                id: "level",
                name: "级别",
                type: "enum",
                options: [{ id: "high", label: "高", tone: "danger" }],
              },
            ],
          },
        ],
      },
      page: {
        pages: [
          {
            id: "p_monitor",
            name: "监控",
            fieldBindings: ["task.title"],
            rankings: [
              { id: "rk_ok", name: "评分榜", entity: "task", sortBy: "task.score", limit: 5 },
              { id: "rk_bad", name: "坏榜", entity: "task", sortBy: "task.ghost" },
            ],
            feeds: [
              { id: "fd_ok", name: "动态", entity: "task", timeField: "task.due", levelField: "task.level" },
              { id: "fd_bad", name: "坏流", entity: "task", timeField: "task.title" },
            ],
            charts: [
              { id: "ch_donut", name: "环", type: "donut", dimension: "task.level", metric: "count" },
            ],
          },
        ],
      },
    };
    const schema = deriveAppRuntimeSchema(model)!;
    const pageSchema = schema.pages.find(p => p.id === "p_monitor")!;
    expect(pageSchema.rankings.map(r => r.id)).toEqual(["rk_ok"]);
    expect(pageSchema.rankings[0]).toMatchObject({
      sortFieldId: "score",
      sortLabel: "评分",
      limit: 5,
    });
    expect(pageSchema.feeds.map(f => f.id)).toEqual(["fd_ok"]);
    expect(pageSchema.feeds[0]).toMatchObject({
      timeFieldId: "due",
      levelFieldId: "level",
    });
    expect(pageSchema.charts[0].type).toBe("donut");
  });

  it("wizard/monitor 范式（E40.5）：monitor 直通，wizard 未挂流程降级 workbench", () => {
    const base = {
      ...MODEL,
      page: {
        pages: [
          { id: "p_mon", name: "监控", kind: "monitor", fieldBindings: ["order.amount"] },
          { id: "p_wiz", name: "向导", kind: "wizard", fieldBindings: ["order.amount"] },
        ],
      },
    };
    // p_wiz 未在 pageBindings 挂 workflowRef → 降级 workbench
    const schema = deriveAppRuntimeSchema(base)!;
    expect(schema.pages.find(p => p.id === "p_mon")!.view.kind).toBe("monitor");
    expect(schema.pages.find(p => p.id === "p_wiz")!.view.kind).toBe("workbench");

    const bound = {
      ...base,
      appbundle: {
        ...base.appbundle,
        pageBindings: [{ pageRef: "p_wiz", workflowRef: "wf_order" }],
      },
    };
    const schema2 = deriveAppRuntimeSchema(bound)!;
    expect(schema2.pages.find(p => p.id === "p_wiz")!.view.kind).toBe("wizard");
  });

  it("应用身份段（E40.2）：产品名权威 > 会话标题，枚举缺省回退与历史一致", () => {
    // 无身份段（老模型）：缺省 azure/boxes/side，appName = 会话标题
    const legacy = deriveAppRuntimeSchema(MODEL, "健身房系统")!;
    expect(legacy.identity).toEqual({
      themeId: "azure",
      icon: "boxes",
      nav: "side",
    });
    expect(legacy.appName).toBe("健身房系统");

    // 带身份段：产品名顶掉会话标题，主题/图标/导航生效
    const branded = deriveAppRuntimeSchema(
      {
        ...MODEL,
        appbundle: {
          ...MODEL.appbundle,
          appIdentity: {
            productName: "健身魔方",
            theme: "tangerine",
            icon: "heart",
            nav: "top",
          },
        },
      },
      "健身房系统"
    )!;
    expect(branded.appName).toBe("健身魔方");
    expect(branded.identity).toEqual({
      themeId: "tangerine",
      icon: "heart",
      nav: "top",
    });
  });

  it("preserves page reconstruction evidence on the derived page schema", () => {
    const model = structuredClone(MODEL);
    model.page!.pages![0].pageReconstruction = {
      version: "page-reconstruction-v1",
      status: "ready",
      spec: { device: "desktop", regions: [{ id: "hero" }] },
      prompt: "PAGE RECONSTRUCTION CONTRACT",
      diagnostic: "",
    };

    const page: AppPageSchema = deriveAppRuntimeSchema(model)!.pages[0];

    expect(page.pageReconstruction?.status).toBe("ready");
    expect(page.pageReconstruction?.prompt).toBe("PAGE RECONSTRUCTION CONTRACT");
  });
});
