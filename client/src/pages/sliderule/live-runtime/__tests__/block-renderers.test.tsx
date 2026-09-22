/**
 * 五个数据区块的渲染层测试（2026-07-28）。
 *
 * 取数逻辑在 block-data.test.ts 里锁（那层才是容易算错的地方）；这里锁的是
 * 渲染层的三件事：
 *   1. 有数据时真的画出来了（不是还挂着占位灰框）；
 *   2. **空态说清楚缺什么**——"未绑定实体" / "写入某字段后自动出图" 各不相同，
 *      糊成一句"暂无数据"用户就不知道该去干嘛；
 *   3. 遗留的 children 透传没被这次改动弄丢。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyColumnState,
  EXPERIENCE_BLOCK_RENDERERS,
  ExperienceBlockBoundary,
  fieldSemanticForTest,
} from "../block-registry";
import type { ExperienceBlockInstance } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";
import CATALOG from "@experience-blocks";

const row = (id: string, values: Record<string, unknown>): RuntimeRow =>
  ({ id, values }) as RuntimeRow;

function render(
  rendererKey: string,
  block: ExperienceBlockInstance,
  entityRows?: Record<string, RuntimeRow[]>,
  children?: React.ReactNode,
  /** 额外的渲染器入参（enumOptionsOf / fieldLabelOf 这类查询函数） */
  extra?: Record<string, unknown>
) {
  const R = EXPERIENCE_BLOCK_RENDERERS[rendererKey];
  return renderToStaticMarkup(
    <R block={block} entityRows={entityRows} {...extra}>
      {children}
    </R>
  );
}

const ORDERS = [
  row("o1", { name: "甲单", amount: 100, at: "2026-07-01", level: "高" }),
  row("o2", { name: "乙单", amount: 300, at: "2026-07-03", level: "低" }),
  row("o3", { name: "丙单", amount: 200, at: "2026-07-03" }),
];
const ROWS = { order: ORDERS };

describe("五个区块都已接真渲染器（不再是占位）", () => {
  it("注册表里没有一个还挂着 ExistingContentAdapter", async () => {
    const { ExistingContentAdapter } = await import("../block-registry");
    for (const key of [
      "metric-grid",
      "trend-chart",
      "ranked-list",
      "activity-feed",
      "data-table",
    ])
      expect(EXPERIENCE_BLOCK_RENDERERS[key]).not.toBe(ExistingContentAdapter);
  });
});

describe("MetricGrid", () => {
  it("count 聚合出真实条数", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      props: { title: "订单概览" },
      binding: { entityRef: "order", aggregate: "count" },
    }, ROWS);
    expect(html).toContain("订单概览");
    expect(html).toContain("3");
  });

  it("sum 聚合", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "order", aggregate: "sum:amount" },
    }, ROWS);
    expect(html).toContain("600");
  });

  it("字段一行有效值都没有 → 显示「—」并说明，不显示 0", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "order", aggregate: "sum:不存在的字段" },
    }, ROWS);
    expect(html).toContain("—");
    expect(html).toContain("该字段暂无有效数值");
  });

  it("实体绑不上 → 说清楚是绑定问题", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "不存在的实体" },
    }, ROWS);
    expect(html).toContain("指标未绑定到有效实体");
  });
});

describe("TrendChart", () => {
  it("有数据时出图并标出粒度", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      props: { title: "下单趋势" },
      binding: { entityRef: "order", timeDimensionRef: "at", timeGrain: "day" },
    }, ROWS);
    expect(html).toContain('data-testid="trend-chart"');
    expect(html).toContain("下单趋势");
    expect(html).toContain("按天");
  });

  it("时间字段没绑 → 空态点名缺的是时间字段", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("趋势未绑定到有效的时间字段");
  });

  it("绑了字段但一行都没日期 → 提示写入该字段，带上字段名", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      binding: { entityRef: "order", timeDimensionRef: "没填过的日期字段" },
    }, ROWS);
    expect(html).toContain("没填过的日期字段");
    expect(html).toContain("自动出图");
  });
});

describe("RankedList", () => {
  it("按数值倒序出名次，且真值和条形都在", () => {
    const html = render("ranked-list", {
      id: "b3",
      type: "RankedList",
      props: { title: "金额排行" },
      binding: { entityRef: "order", sortByRef: "amount", limit: 3 },
    }, ROWS);
    expect(html).toContain("金额排行");
    expect(html.match(/data-testid="ranked-list-item"/g)).toHaveLength(3);
    // 只给条形不给数看不出量级——真值必须在
    expect(html).toContain("300");
    // 第一名是金额最大的乙单
    expect(html.indexOf("乙单")).toBeLessThan(html.indexOf("丙单"));
  });

  it("排序字段没绑 → 空态点名缺的是数值字段", () => {
    const html = render("ranked-list", {
      id: "b3",
      type: "RankedList",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("排行未绑定到有效的数值字段");
  });
});

describe("ActivityFeed", () => {
  it("按时间倒序，带出等级标签", () => {
    const html = render("activity-feed", {
      id: "b4",
      type: "ActivityFeed",
      props: { title: "近期动态" },
      binding: { entityRef: "order", timeFieldRef: "at", levelFieldRef: "level" },
    }, ROWS);
    expect(html).toContain("近期动态");
    expect(html.match(/data-testid="activity-feed-item"/g)).toHaveLength(3);
    expect(html).toContain("高");
    // 最新的 07-03 排在 07-01 前面
    expect(html.indexOf("2026-07-03")).toBeLessThan(html.indexOf("2026-07-01"));
  });

  it("时间字段没绑 → 空态点名", () => {
    const html = render("activity-feed", {
      id: "b4",
      type: "ActivityFeed",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("动态未绑定到有效的时间字段");
  });
});

describe("DataTable", () => {
  it("画出表头与行，超出条数时如实说明", () => {
    const many = { order: Array.from({ length: 12 }, (_, i) => row(`r${i}`, { name: `第${i}单` })) };
    const html = render("data-table", {
      id: "b5",
      type: "DataTable",
      props: { title: "订单明细" },
      binding: { entityRef: "order" },
    }, many);
    expect(html).toContain("订单明细");
    expect(html.match(/data-testid="data-table-row"/g)).toHaveLength(8);
    // 截断必须说出来，否则用户以为只有 8 条
    expect(html).toContain("共 12 条");
  });

  it("实体存在但零行 → 引导去新建，而不是报绑定错误", () => {
    const html = render("data-table", {
      id: "b5",
      type: "DataTable",
      binding: { entityRef: "order" },
    }, { order: [] });
    expect(html).toContain("点「新建」写入第一条真实数据");
  });
});

describe("接 antd 之后的三条不许退回去（2026-07-28 重构）", () => {
  // 这三条都是对照台（/block-gallery.html）上肉眼逮到的，不是想出来的：
  // 手写样式时它们全都"看着能跑"，但颜色跟应用主题无关、枚举出的是取值 id。
  const src = () =>
    import("../block-registry.tsx?raw").then(
      m => (m as unknown as { default: string }).default
    );

  it("ActivityFeed 的等级出声明里的 label，不是取值 id", () => {
    const html = render(
      "activity-feed",
      {
        id: "b",
        type: "ActivityFeed",
        binding: { entityRef: "order", timeFieldRef: "at", levelFieldRef: "level" },
      },
      { order: [row("o1", { name: "甲", at: "2026-07-01", level: "frozen" })] },
      undefined,
      { enumOptionsOf: () => [{ id: "frozen", label: "已冻结", tone: "danger" }] }
    );
    expect(html).toContain("已冻结");
    expect(html).not.toContain("frozen");
  });

  it("DataTable 列头出中文显示名，枚举列出标签", () => {
    const html = render(
      "data-table",
      { id: "b", type: "DataTable", binding: { entityRef: "order" } },
      { order: [row("o1", { lot_code: "RR-1", status: "frozen" })] },
      undefined,
      {
        fieldLabelOf: (_e: string, f: string) =>
          ({ lot_code: "批次编码", status: "库存状态" })[f],
        enumOptionsOf: (_e: string, f: string) =>
          f === "status" ? [{ id: "frozen", label: "已冻结", tone: "danger" }] : [],
      }
    );
    expect(html).toContain("批次编码");
    expect(html).toContain("已冻结");
  });

  it("排行的条与名次标签取主题 token，不写死颜色", async () => {
    const s = await src();
    // Progress 在 percent>=100 时会自动变 success 绿，必须显式给 strokeColor，
    // 否则第一名永远是绿的、跟应用主题无关
    expect(s).toContain("strokeColor={token.colorPrimary}");
    // color="processing" 是 antd 固定语义蓝，不跟 colorPrimary
    expect(s).not.toContain('color={i < 3 ? "processing"');
    // 手写时代残留的靛蓝硬编色值不许回来。只查**用法**不查散文——注释里
    // 还留着这两个色值在讲当年为什么要换掉，一刀切会把那段历史也禁了
    expect(s).not.toMatch(/(bg|text|border)-\[#5b6cff\]/);
    expect(s).not.toMatch(/(bg|text|border)-\[#3b5bdb\]/);
  });

  it("等级颜色走声明的 tone，不靠关键词猜", async () => {
    const s = await src();
    expect(s).toContain("toneTimelineColor");
    // 第一版那个中英文关键词猜测器：枚举是 available/frozen 这种英文 id 时
    // 一条都命中不了，八个节点全同色
    expect(s).not.toContain("levelTimelineColor");
  });
});

describe("遗留 children 透传没丢", () => {
  it("传了 children 就照原样渲染（_fromLegacy 转换期用法）", () => {
    for (const key of [
      "metric-grid",
      "trend-chart",
      "ranked-list",
      "activity-feed",
      "data-table",
    ]) {
      const html = render(
        key,
        { id: "x", type: "X", binding: { entityRef: "order" } },
        ROWS,
        <span>现成内容</span>
      );
      expect(html).toContain("现成内容");
    }
  });
});

/**
 * ── 字段语义渲染（2026-08-08，照 refinedev/refine 的 Inferencer）──────────
 *
 * 用户拿一张真实的「门店订单管理」页做示范，指出我们的表格差太远：状态该是
 * 彩色标签、金额该是 ¥428.00、时间该是完整时刻、末尾该有操作列、分页该带
 * 总数。此前我们**直接拿行数据的键当列**，没有语义也没有格式化。
 *
 * refine 的做法是三层：字段语义推断链 → 每种语义一个字段渲染器 → 自动追加
 * 操作列。我们比它占一个便宜：字段类型是数据模型里声明好的，不用从值猜。
 */
describe("字段语义渲染", () => {
  const rows = [
    {
      id: "r1",
      values: { code: "OD20250806", amount: 428, status: "done", at: "2025-08-06 14:28:32" },
      createdAt: "2025-08-06T14:28:32.000Z",
    },
  ];
  const types: Record<string, string> = {
    code: "string",
    amount: "number",
    status: "enum",
    at: "date",
  };
  const render = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "t", type: "DataTable", binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ code: "订单号", amount: "金额", status: "状态", at: "下单时间" })[f]}
        fieldTypeOf={(_e, f) => types[f]}
        enumOptionsOf={(_e, f) =>
          f === "status" ? [{ id: "done", label: "已完成", tone: "success" }] : []
        }
        {...extra}
      />
    );

  it("金额列格式化成货币并右对齐 —— 左对齐的金额没法竖着比大小", () => {
    const html = render();
    expect(html).toContain("¥428.00");
    // antd 的 align 落成内联 style，不是类名（实测；写成 ant-table-cell-align-right
    // 会红，那是别的版本的类名）
    expect(html).toContain("text-align:right");
  });

  it("枚举列出彩色标签，颜色来自声明的 tone 而不是猜的", () => {
    const html = render();
    expect(html).toContain("已完成");
    expect(html).toContain("ant-tag-success");
    // 取值 id 不该露出来
    expect(html).not.toMatch(/>done</);
  });

  it("带时刻的日期出完整时刻，不是只有日期", () => {
    expect(render()).toContain("2025-08-06 14:28:32");
  });

  it("操作列**只在调用方接了 onAction 时**出现", () => {
    // 没人接的时候画一排点不动的链接，比不画更糟
    expect(render()).not.toContain("操作");
    expect(render({ onAction: () => {} })).toContain("操作");
  });

  it("分页带总数 —— 此前是 slice(0,8) 加一行「显示前 8 条」，用户翻不到第 9 条", () => {
    const html = render();
    expect(html).toContain("共 1 条");
    expect(html).toContain("ant-pagination");
  });
});

/**
 * 2026-08-08：照 pro-components 补的两个区块。
 *
 * 它们共用一个风险：**依赖宿主态，宿主不给就渲染成空气**。这个项目当天刚踩过
 * 一次——QuickActionPanel 第一行是「没有 pageActions 就返回 null」，而装配预览
 * 从来没传过，于是它一直是空气、没人发现（它总跟别的区块挤在一个区里，看不出
 * 少了谁）。所以这两个的用例先钉「宿主没接时说人话，不是消失」。
 */
describe("StatusTabs（状态切换栏）", () => {
  const ENUMS = {
    status: [
      { id: "todo", label: "待办" },
      { id: "doing", label: "进行中" },
      { id: "done", label: "已完成" },
    ],
  };
  const TASKS = {
    task: [
      row("t1", { name: "甲", status: "todo" }),
      row("t2", { name: "乙", status: "done" }),
      row("t3", { name: "丙", status: "done" }),
    ],
  };
  const block = {
    id: "st",
    type: "StatusTabs",
    props: {},
    binding: { entityRef: "task", statusField: "status" },
  } as unknown as ExperienceBlockInstance;

  it("条数是真数出来的，不是 props 里写死的", () => {
    // 写死的话，用户删掉一条记录、页签还写着原来的数——那种不一致比不显示
    // 条数更糟，因为它看起来是对的。
    const html = render("status-tabs", block, TASKS, undefined, {
      enumOptionsOf: (_e: string, f: string) => (ENUMS as never)[f] ?? [],
      filterState: { enumFilters: {} },
    });
    expect(html).toContain("全部 3");
    expect(html).toContain("已完成 2");
    expect(html).toContain("待办 1");
    expect(html).toContain("进行中 0");
  });

  it("绑的字段不是枚举时说清楚，而不是渲染一个空的页签条", () => {
    const html = render(
      "status-tabs",
      {
        ...block,
        binding: { entityRef: "task", statusField: "name" },
      } as unknown as ExperienceBlockInstance,
      TASKS,
      undefined,
      { enumOptionsOf: () => [], fieldLabelOf: () => "名称" }
    );
    expect(html).toContain("不是枚举字段");
  });
});

describe("BatchActionBar（批量操作栏）", () => {
  const block = {
    id: "bar",
    type: "BatchActionBar",
    props: { actions: ["批量审批", "批量导出"] },
    binding: { entityRef: "order" },
  } as unknown as ExperienceBlockInstance;

  it("没选中时给一句引导，不是整条消失", () => {
    // 官方 Alert 的做法是整条消失（selectedRowKeys 为空就 return null）。
    // 我们在组件库和装配预览里不能那样——**会消失的区块没法审阅**，而且
    // "消失"和"坏了"长得一模一样。
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: {} },
    });
    expect(html).toContain("勾选左侧的行");
    expect(html).not.toContain("已选择");
  });

  it("选中之后显示条数与批量操作按钮", () => {
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: { order: ["o1", "o3"] } },
    });
    expect(html).toContain("已选择");
    expect(html).toContain(">2<");
    expect(html).toContain("批量审批");
    expect(html).toContain("批量导出");
    expect(html).toContain("清空");
  });

  it("只认自己绑的那个实体的勾选 —— 一页可能有不止一张表", () => {
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: { customer: ["c1", "c2", "c3"] } },
    });
    expect(html).toContain("勾选左侧的行");
  });
});

describe("DataTable 的勾选列", () => {
  const block = {
    id: "dt",
    type: "DataTable",
    props: {},
    binding: { entityRef: "order" },
  } as unknown as ExperienceBlockInstance;

  it("宿主没接选择态时不长出勾选列 —— 勾了也没地方用，纯噪音", () => {
    const html = render("data-table", block, ROWS);
    expect(html).not.toContain("selection-col");
  });

  it("宿主接了才出现勾选列", () => {
    const html = render("data-table", block, ROWS, undefined, {
      selection: { rowIds: { order: [] } },
      onSelectionChange: () => {},
    });
    expect(html).toContain("selection-col");
  });
});

/**
 * 2026-08-08 ①c：字段语义从 7 种补到 13 种。
 *
 * 六种新的（email / url / image / richtext / boolean / relation）全部来自
 * refine 的 field-inferencers，判据是逐条对着抄的，不是自己想的。
 *
 * 最要紧的一条是**优先级模型**：refine 让所有推断器都跑再取最高分
 * （utilities/pick-inferred-field/），不是先到先得。先到先得会出错——
 * `https://a.com/x.png` 按链序先撞上 url，就再也轮不到 image。
 */
describe("字段语义 13 种", () => {
  const sem = (fieldId: string, sample: unknown, declared?: string) =>
    fieldSemanticForTest(fieldId, sample, declared);

  it("图片赢过链接 —— 优先级模型，不是先到先得", () => {
    // 这一条就是"全跑取最高分"的判据。image 2 > url 1。
    expect(sem("avatar", "https://cdn.example.com/a/b.png")).toBe("image");
    expect(sem("avatar", "https://cdn.example.com/a/b.PNG")).toBe("image");
    // 不是图片后缀就还是链接
    expect(sem("homepage", "https://example.com/a/b")).toBe("url");
  });

  it("邮箱、链接、长文本、布尔各自认出来", () => {
    expect(sem("contact", "a.b-c@example.com")).toBe("email");
    expect(sem("site", "https://example.com")).toBe("url");
    expect(sem("remark", "很".repeat(120))).toBe("richtext");
    expect(sem("enabled", true)).toBe("boolean");
  });

  it("关联字段按名字判 —— 值只要是标量或标量数组", () => {
    expect(sem("owner_id", "u-1")).toBe("relation");
    expect(sem("tagIds", ["t1", "t2"])).toBe("relation");
    // 名字不像关联就不是
    expect(sem("title", "u-1")).toBe("text");
  });

  it("日期那三个条件缺一不可 —— 这是 refine 的 dateInfer", () => {
    // 三条齐：认
    expect(sem("created_at", "2026-08-08")).toBe("date");
    expect(sem("created_at", "2026-08-08 10:30:00")).toBe("datetime");
    // 只有 key 后缀、值没分隔符：不认（`create_at_count` 那类）
    expect(sem("created_at", "12")).not.toBe("date");
    // 只有分隔符、不是日期：不认
    expect(sem("ratio", "a-b")).not.toBe("date");
  });

  it("声明成字符串**不代表**没有更细的语义", () => {
    // 声明只说了"这是个字符串"，是不是邮箱得看值。上一版在 declared==="string"
    // 时直接返回 text/id，六种新语义对声明过的字段全部失效——那等于白补。
    expect(sem("contact", "a@example.com", "string")).toBe("email");
    expect(sem("cover", "https://x.com/a.png", "string")).toBe("image");
    // 值里看不出更细语义时才回落
    expect(sem("name", "张三", "string")).toBe("text");
    expect(sem("order_no", "SO-2026-001", "string")).toBe("id");
  });

  it("声明优先于值 —— 声明了枚举就按枚举，不去猜", () => {
    expect(sem("status", "https://x.com", "enum")).toBe("enum");
  });

  it("**我们的日期判据比 refine 严** —— 它那条有洞，实测过", () => {
    // refine 的 dateInfer 展开是「有分隔符 且 dayjs 能解析」。实测跑 dayjs：
    //
    //   dayjs("u-1")          → valid，2001-01-01
    //   dayjs("SO-2026-001")  → valid，2026-01-01
    //   dayjs("2")            → valid，2001-02-01
    //
    // 所以在 refine 里外键和单号都会被判成日期，而 date 的 priority(1) 还高于
    // relation(0)，它赢定了。我们加了一道形状闸：必须以四位年份开头。
    //
    // 这条用例存在的意义是：谁要是哪天"照 refine 对齐"把闸门去掉，它当场红。
    expect(sem("owner_id", "u-1")).not.toBe("date");
    expect(sem("order_no", "SO-2026-001", "string")).not.toBe("date");
    expect(sem("qty", "2")).not.toBe("date");
    // 真日期照样认
    expect(sem("created_at", "2026-08-08")).toBe("date");
    expect(sem("paid_at", "2026/08/08 10:30")).toBe("datetime");
  });
});

/**
 * 2026-08-08：表格终于也能声明"显示哪几列"。
 *
 * 此前 DataTable 是唯一"会显示字段却不能声明显示哪几个"的区块——列全靠从行
 * 数据的键里派生再截断到 8。字段一多，谁上榜取决于键的顺序，模型和使用者都
 * 说了不算。对照台上就撞上了：十一个字段，截断正好切在第八个，布尔、关联、
 * 长文本三种语义一个都看不见。
 */
describe("DataTable 的列由 binding.fieldRefs 说了算", () => {
  const values: Record<string, unknown> = {
    a: "1", b: "2", c: "3", d: "4", e: "5",
    f: "6", g: "7", h: "8", i: "9", j: "10",
  };
  const rows = [{ id: "r1", values, createdAt: "2026-08-08T00:00:00.000Z" }];
  const render = (binding: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "t", type: "DataTable", binding }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => `列${f.toUpperCase()}`}
      />
    );

  it("没声明时才派生，且仍然截断到 8 —— 兜底行为没变", () => {
    const html = render({ entityRef: "order" });
    expect(html).toContain("列H");
    expect(html).not.toContain("列I");
    expect(html).not.toContain("列J");
  });

  it("声明了就**全用**，不再截断 —— 明写十列就出十列", () => {
    const html = render({ entityRef: "order", fieldRefs: Object.keys(values) });
    expect(html).toContain("列I");
    expect(html).toContain("列J");
  });

  it("声明的顺序就是列的顺序，不按键的顺序重排", () => {
    const html = render({ entityRef: "order", fieldRefs: ["j", "a"] });
    expect(html.indexOf("列J")).toBeLessThan(html.indexOf("列A"));
    expect(html).not.toContain("列B");
  });

  it("目录里也开了口子，不然门禁会把模型写的 fieldRefs 判非法", () => {
    const table = (CATALOG.blocks as Array<{
      type: string;
      bindingSchema: Record<string, unknown>;
    }>).find(b => b.type === "DataTable")!;
    expect(table.bindingSchema.optional).toContain("fieldRefs");
    // entityFieldRefLists 是"值是字段 id 数组"的那一类，门禁靠它校验字段真的
    // 属于这个实体。只写进 optional 而不登记，等于开了口子却不查。
    expect(table.bindingSchema.entityFieldRefLists).toHaveProperty("fieldRefs");
  });
});

/**
 * 2026-08-08：详情与表格共用 renderCell。
 *
 * "同一份数据在两个区块里必须读起来一样"这句纪律本来就写在 RecordDetail 的
 * 注释里，但当初只兑现了枚举那一条——别的字段一律 String() 原样打印。于是
 * 同一条订单，金额在表格里是 ¥428.00、进了详情变成 428；邮箱在表格里能点、
 * 在详情里是一段死文本。
 */
describe("RecordDetail 与 DataTable 读起来一样", () => {
  const rows = [
    {
      id: "r1",
      values: {
        amount: 428,
        status: "done",
        contact: "a@example.com",
        site: "https://example.com/x",
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    },
  ];
  const common = {
    entityRows: { order: rows },
    fieldTypeOf: (_e: string, f: string) =>
      ({ amount: "number", status: "enum", contact: "string", site: "string" })[f],
    enumOptionsOf: (_e: string, f: string) =>
      f === "status" ? [{ id: "done", label: "已完成", tone: "success" as const }] : [],
  };
  const binding = {
    entityRef: "order",
    fieldRefs: ["amount", "status", "contact", "site"],
  };

  it("金额、枚举、邮箱、外链在详情里的画法与表格一致", () => {
    const detail = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "d", type: "RecordDetail", binding }}
        {...common}
      />
    );
    expect(detail).toContain("¥428.00");
    expect(detail).toContain("已完成");
    expect(detail).toContain("ant-tag-success");
    expect(detail).toContain('href="mailto:a@example.com"');
    expect(detail).toContain('target="_blank"');
    // 取值 id 不该露出来——这条是原来就有的纪律，别在扩展时丢掉
    expect(detail).not.toMatch(/>done</);
  });
});

/**
 * 2026-08-08：会长的语义单行截断。
 *
 * tableLayout="fixed" 下，邮箱和外链这种长度不可控的单行串会被竖着折成一座塔。
 * 对照台上十列的那张表，行高被撑到 130px+，整张表参差不齐。
 */
describe("长字段单行截断", () => {
  const rows = [
    {
      id: "r1",
      values: {
        contact: "somebody.with.a.long.name@a-very-long-domain.example.com",
        site: "https://example.com/a/very/long/path/that/keeps/going",
        amount: 428,
      },
      createdAt: "2026-08-08T00:00:00.000Z",
    },
  ];
  const html = renderToStaticMarkup(
    <ExperienceBlockBoundary
      block={{
        id: "t", type: "DataTable",
        binding: { entityRef: "order", fieldRefs: ["contact", "site", "amount"] },
      }}
      entityRows={{ order: rows }}
    />
  );

  it("邮箱与外链列带截断类名", () => {
    // antd 的 ellipsis 落成 ant-table-cell-ellipsis
    const hits = html.match(/ant-table-cell-ellipsis/g) ?? [];
    // 两列 × （表头 + 一行）
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it("数字列不截断 —— 它长度可控，截了反而看不全金额", () => {
    expect(html).toContain("¥428.00");
    // 金额单元格自己不该带截断类
    expect(html).not.toMatch(/ant-table-cell-ellipsis[^>]*>[^<]*¥428/);
  });
});

/**
 * 2026-08-08 ②批次 1：ColumnSettingPanel，照 pro-components 的 ColumnSetting。
 *
 * **这一组用例才是搬运的产出。** 那 605 行 JSX 我们一行没用（没有 TableContext、
 * 没有 Tree、状态形状也不同），真正拿到的是它替我们踩过的四条边界——每一条我们
 * 自己写都会漏，而且漏了之后界面看起来是「好的」，只是行为不对。
 */
describe("列设置：applyColumnState 的三步顺序", () => {
  const fields = ["a", "b", "c", "d"];

  it("不传状态就原样返回 —— 没装面板的表格不该受任何影响", () => {
    expect(applyColumnState(fields, undefined)).toEqual(fields);
  });

  it("隐藏的列不出现", () => {
    expect(applyColumnState(fields, { hidden: ["b"], order: [], fixed: {} })).toEqual([
      "a", "c", "d",
    ]);
  });

  it("没排过序的列排在排过序的后面，且组内保持原顺序", () => {
    expect(applyColumnState(fields, { hidden: [], order: ["d"], fixed: {} })).toEqual([
      "d", "a", "b", "c",
    ]);
  });

  it("**固定分组盖过顺序号** —— pro-components 的 issue #9556 就是这条没做对", () => {
    // c 被显式排到最前，但它固定在右侧；固定分组必须赢，否则「固定在右」的列
    // 画在最左边，分组和顺序自相矛盾。
    const out = applyColumnState(fields, {
      hidden: [],
      order: ["c", "a", "b", "d"],
      fixed: { c: "right", d: "left" },
    });
    expect(out).toEqual(["d", "a", "b", "c"]);
  });

  it("状态里躺着已经不存在的字段名时不会凭空造出列", () => {
    // 数据模型删过字段，hidden/order/fixed 里都可能留着过期 id
    const out = applyColumnState(["a", "b"], {
      hidden: ["gone"],
      order: ["gone", "b", "a"],
      fixed: { alsoGone: "left" },
    });
    expect(out).toEqual(["b", "a"]);
  });
});

describe("列设置面板", () => {
  const cols = ["name", "amount", "status", "at"];
  const render = (extra: Record<string, unknown> = {}, binding: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "panel", type: "ColumnSettingPanel",
          binding: { entityRef: "order", targets: ["tbl"], ...binding },
        }}
        targetColumns={cols}
        fieldLabelOf={(_e, f) => ({ name: "门店", amount: "金额", status: "状态", at: "日期" })[f]}
        {...extra}
      />
    );

  it("没连到表格时说清楚，而不是渲染一排管不着任何东西的复选框", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "panel", type: "ColumnSettingPanel", binding: { entityRef: "order" } }}
      />
    );
    expect(html).toContain("没有连到任何表格");
  });

  it("列出目标表格的列，出中文标签不出字段 id", () => {
    const html = render();
    expect(html).toContain("门店");
    expect(html).toContain("金额");
    expect(html).not.toMatch(/>amount</);
  });

  it("**半选的分母只数面板里真的列出来的列** —— 状态里的过期 id 不算", () => {
    // 这是 pro-components 那条注释的判据：columnsMap 里可能有已经不存在的 key，
    // 算进分母，全选框会永远停在半选（分子分母对不齐）。
    const html = render({
      columnState: { tbl: { hidden: ["ghost1", "ghost2"], order: [], fixed: {} } },
    });
    // 四列一个没藏，全选框该是「全选」，不是半选
    expect(html).toContain("列展示（4/4）");
    expect(html).not.toContain("ant-checkbox-indeterminate");
  });

  it("真藏了一列才是半选", () => {
    const html = render({ columnState: { tbl: { hidden: ["amount"], order: [], fixed: {} } } });
    expect(html).toContain("列展示（3/4）");
    expect(html).toContain("ant-checkbox-indeterminate");
  });

  it("被藏起来的列**仍然列在面板里** —— 否则没有地方能把它勾回来", () => {
    const html = render({ columnState: { tbl: { hidden: ["amount"], order: [], fixed: {} } } });
    expect(html).toContain("金额");
  });

  it("被藏起来的列留在**原来的位置**，不是被甩到末尾", () => {
    // 自己踩过的：顺序一度按"可见的那些"算，于是藏掉一列、再勾回来，它会因为
    // 丢了名次跳到最后。隐藏是"这次不看"，不该顺手改掉它的位置。
    // 列序 name/amount/status/at，藏掉 amount：面板里它仍该排在 name 之后。
    const html = render({ columnState: { tbl: { hidden: ["amount"], order: [], fixed: {} } } });
    const at = (label: string) => html.indexOf(label);
    expect(at("门店")).toBeLessThan(at("金额"));
    expect(at("金额")).toBeLessThan(at("状态"));
  });

  it("没有任何固定列时不出分组标题 —— 一个孤零零的「不固定」会让人以为还有别的组", () => {
    expect(render()).not.toContain("不固定");
    const pinned = render({ columnState: { tbl: { hidden: [], order: [], fixed: { name: "left" } } } });
    expect(pinned).toContain("固定在左侧");
    expect(pinned).toContain("不固定");
  });

  // 「重置」按钮在静态标记里长这样：
  //   <button data-testid="column-setting-reset" ... disabled=""><span>重置</span></button>
  const resetDisabled = (html: string) =>
    /<button data-testid="column-setting-reset"[^>]*\sdisabled=""/.test(html);

  it("没改过任何东西时「重置」是禁用的 —— 点一下什么都不会变的按钮是骗人的", () => {
    expect(resetDisabled(render())).toBe(true);
  });

  it("改过之后「重置」可点", () => {
    const byHide = render({ columnState: { tbl: { hidden: ["amount"], order: [], fixed: {} } } });
    expect(resetDisabled(byHide)).toBe(false);
    // 只改了固定、一列没藏，也算改过
    const byPin = render({ columnState: { tbl: { hidden: [], order: [], fixed: { name: "left" } } } });
    expect(resetDisabled(byPin)).toBe(false);
    // 只改了顺序也算 —— pro-components 的 issue #9558 就是"重置没管顺序"
    const byOrder = render({ columnState: { tbl: { hidden: [], order: ["at", "name"], fixed: {} } } });
    expect(resetDisabled(byOrder)).toBe(false);
  });

  it("**面板自己不声明默认列** —— 那是表格说了算，一件事不能有两个出处", () => {
    // 2026-08-08 当天改掉的：一开始给了面板一份 fieldRefs，浏览器里当场露馅——
    // 面板说默认 4 列、表格自己声明 10 列，什么都没动过「重置」却是可点的。
    // 现在面板收到 fieldRefs 也一律忽略，原始态就是原始态。
    const withStrayFieldRefs = render({}, { fieldRefs: ["name"] });
    expect(resetDisabled(withStrayFieldRefs)).toBe(true);
    expect(withStrayFieldRefs).toContain("列展示（4/4）");
  });
});

/**
 * 全部列都被藏起来是真会发生的（把「列展示」的全选框取消掉就是）。
 * pro-components 到这一步会把一张没有列的表交给 antd Table，渲染出一片空白
 * 表头——看起来像坏了。这条钉住我们说人话。
 */
describe("表格：所有列都被隐藏时", () => {
  const rows = [{ id: "r1", values: { a: "1", b: "2" }, createdAt: "2026-08-08T00:00:00.000Z" }];

  it("给一句能照着做的空态，不是一张没有列的空壳表", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "tbl", type: "DataTable", binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
        columnState={{ tbl: { hidden: ["a", "b"], order: [], fixed: {} } }}
      />
    );
    expect(html).toContain("所有列都被隐藏了");
  });

  it("列视图态按**区块 id** 认领 —— 一页两张表各改各的", () => {
    // 状态写在 other 名下，这张表叫 tbl，不该受影响
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "tbl", type: "DataTable", binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => `列${f.toUpperCase()}`}
        columnState={{ other: { hidden: ["a", "b"], order: [], fixed: {} } }}
      />
    );
    expect(html).toContain("列A");
    expect(html).toContain("列B");
  });
});

/**
 * 2026-08-08 ②批次 1：EditableSubTable，照 pro-components 的 EditableTable。
 *
 * 这次搬的是"接进契约"——EditableProTable / RowEditorTable / CellEditorTable
 * 三个都在我们已装的 pro-components 2.8.10 里导出着，一个新依赖都不用加。
 * 所以用例钉的是**契约这一侧**：列从哪来、控件类型从哪来、上限到了怎么办。
 *
 * 它内部那条最值钱的（失焦延迟 150ms 才退出编辑，否则 Tab 切下一格就误关）
 * 是组件自己的行为，我们只要不绕过它；钉在这里的是"我们用的就是它"。
 */
describe("可编辑子表", () => {
  const rows = [
    { id: "r1", values: { name: "螺丝", qty: 12, status: "done" }, createdAt: "2026-08-08T00:00:00.000Z" },
    { id: "r2", values: { name: "螺母", qty: 30, status: "todo" }, createdAt: "2026-08-08T00:00:00.000Z" },
  ];
  const render = (props: Record<string, unknown> = {}, binding: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "sub", type: "EditableSubTable",
          props: { title: "订单明细", ...props },
          binding: { entityRef: "order", ...binding },
        }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ name: "物料", qty: "数量", status: "状态" })[f]}
        fieldTypeOf={(_e, f) => ({ name: "string", qty: "number", status: "enum" })[f]}
        enumOptionsOf={(_e, f) =>
          f === "status"
            ? [
                { id: "todo", label: "待办", tone: "default" as const },
                { id: "done", label: "已完成", tone: "success" as const },
              ]
            : []
        }
        {...props.hostProps as Record<string, unknown>}
      />
    );

  it("列出中文标签，行数据真的进表", () => {
    const html = render();
    expect(html).toContain("物料");
    expect(html).toContain("数量");
    expect(html).toContain("螺丝");
  });

  it("列由 binding.fieldRefs 说了算 —— 与表格族同一条规则", () => {
    const html = render({}, { fieldRefs: ["name"] });
    expect(html).toContain("物料");
    expect(html).not.toContain("数量");
  });

  it("没绑到实体时说清楚，不渲染一张空表", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "sub", type: "EditableSubTable", binding: { entityRef: "nope" } }}
        entityRows={{ order: rows }}
      />
    );
    expect(html).toContain("未绑定到有效实体");
  });

  it("**到了行数上限就把新建按钮藏掉**，不是让用户点了再报错", () => {
    // 两行数据，上限 5 —— 按钮该在
    expect(render({ maxRows: 5, addText: "新增一行" })).toContain("新增一行");
    // 上限 2，已经两行 —— 按钮该消失
    expect(render({ maxRows: 2, addText: "新增一行" })).not.toContain("新增一行");
  });

  it("不设上限就一直能加", () => {
    expect(render({ addText: "新增一行" })).toContain("新增一行");
  });
});

/**
 * 2026-08-08 ②批次 1：BatchActionBar 补 alwaysShowAlert。
 *
 * 官方的判据是一行：`selectedRowKeys.length < 1 && !alwaysShowAlert` → null。
 * 关键不在默认值，而在**它把这件事做成了开关**——我们原来把"永远显示一句
 * 引导"写死了，等于替使用者做了决定。
 */
describe("批量操作栏的 alwaysShow", () => {
  const rows = [{ id: "r1", values: { a: "1" }, createdAt: "2026-08-08T00:00:00.000Z" }];
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "bar", type: "BatchActionBar", props, binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
      />
    );

  it("默认永远显示 —— 会凭空消失的区块在装配预览里没法审阅", () => {
    expect(render()).toContain("勾选左侧的行");
  });

  it("alwaysShow=false 时没选中就整条不渲染 —— 这是官方的默认行为", () => {
    expect(render({ alwaysShow: false })).toBe("");
  });

  it("选中了就照样出来，跟 alwaysShow 无关", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "bar", type: "BatchActionBar",
          props: { alwaysShow: false, actions: ["批量导出"] },
          binding: { entityRef: "order" },
        }}
        entityRows={{ order: rows }}
        selection={{ rowIds: { order: ["r1"] } }}
      />
    );
    expect(html).toContain("已选择");
    expect(html).toContain("批量导出");
  });
});

/**
 * 2026-08-08 ②批次 1：拖拽排序做成 DataTable 的 prop，不是第四张表。
 *
 * pro-components 那边 DragSortTable 独立成组件，是因为它得包住 ProTable 的
 * components/tableViewRender 才能塞进 dnd 上下文——实现约束，不是概念区分。
 */
describe("表格的拖拽排序", () => {
  const rows = [
    { id: "r1", values: { name: "甲" }, createdAt: "2026-08-08T00:00:00.000Z" },
    { id: "r2", values: { name: "乙" }, createdAt: "2026-08-08T00:00:00.000Z" },
  ];
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "t", type: "DataTable", props, binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ name: "名称" })[f]}
      />
    );

  it("没开的时候还是原来那张表", () => {
    const html = render({});
    expect(html).toContain("名称");
    expect(html).toContain("ant-pagination");
  });

  it("开了之后行还在、列还在 —— 换的是同一张表的能力，不是换一个区块", () => {
    const html = render({ sortable: true });
    expect(html).toContain("名称");
    expect(html).toContain("甲");
    expect(html).toContain("乙");
  });

  it("两种形态用的是**同一个区块 type** —— 不许分裂成两个", () => {
    // 这条是判据本身：目录里不该出现 DragSortTable 这种"能拖的 DataTable"
    const types = (CATALOG.blocks as Array<{ type: string }>).map(b => b.type);
    expect(types).toContain("DataTable");
    expect(types).not.toContain("DragSortTable");
    const table = (CATALOG.blocks as Array<{
      type: string;
      propsSchema: { properties: Record<string, unknown> };
    }>).find(b => b.type === "DataTable")!;
    expect(table.propsSchema.properties).toHaveProperty("sortable");
  });
});

/**
 * 2026-08-08 ②批次 2：仪表盘。照 pro-blocks 的 DashboardAnalysis。
 *
 * ChartCard 把一张指标卡拆成五槽 —— title / action / total / children(迷你图)
 * / footer。我们此前只有 total 一个槽：一个孤零零的大数字，看不出涨跌、也看
 * 不出走势。
 */
describe("指标卡的五槽", () => {
  const rows = [
    { id: "a", values: { amount: 100, at: "2026-08-01" }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", values: { amount: 200, at: "2026-08-02" }, createdAt: "2026-08-02T00:00:00.000Z" },
    { id: "c", values: { amount: 400, at: "2026-08-03" }, createdAt: "2026-08-03T00:00:00.000Z" },
  ];
  const render = (props: Record<string, unknown> = {}, binding: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "m", type: "MetricGrid",
          props: { title: "销售额", ...props },
          binding: { entityRef: "order", aggregate: "sum:amount", ...binding },
        }}
        entityRows={{ order: rows }}
      />
    );

  it("不给 trendFieldRef 就只出大数字，不编趋势", () => {
    const html = render();
    expect(html).toContain("700");
    expect(html).not.toContain('data-testid="metric-grid-delta"');
    expect(html).not.toContain('data-testid="metric-grid-spark"');
  });

  it("给了日期字段才出环比 —— footer 槽", () => {
    const html = render({}, { trendFieldRef: "at" });
    expect(html).toContain('data-testid="metric-grid-delta"');
    // 400 相对 200 是翻倍
    expect(html).toContain("100%");
  });

  it("副标题写中文字段名，不是字段 id", () => {
    // 对照台上逮到的：这张卡写「合计 · amount」，旁边表格的同一列写着「金额」。
    // 同一份数据在两个区块里必须读起来一样——这条纪律的最后一处漏网。
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "m", type: "MetricGrid", props: { title: "销售额" },
          binding: { entityRef: "order", aggregate: "sum:amount" },
        }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ amount: "金额" })[f]}
      />
    );
    expect(html).toContain("合计 · 金额");
    expect(html).not.toContain("合计 · amount");
  });

  it("查不到中文名就回落字段 id，不显示 undefined", () => {
    expect(render()).toContain("合计 · amount");
  });

  it("action 槽只在写了说明时出现 —— 点开什么都没有的问号比没有更糟", () => {
    expect(render()).not.toContain('data-testid="metric-grid-hint"');
    expect(render({ hint: "口径说明" })).toContain('data-testid="metric-grid-hint"');
  });

  it("footer 槽两样都没有就整条不出，不留一截空白", () => {
    const html = render();
    expect(html).not.toContain('data-testid="metric-grid-delta"');
    expect(html).not.toContain("口径以财务月结为准");
  });

  it("**`0` 要显示成 0，不是「—」** —— ChartCard 那句 `!total && total !== 0` 防的就是这个", () => {
    const zero = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "m", type: "MetricGrid", props: { title: "今日新增" },
          binding: { entityRef: "order", aggregate: "sum:amount" },
        }}
        entityRows={{ order: [{ id: "z", values: { amount: 0 }, createdAt: "2026-08-08T00:00:00.000Z" }] }}
      />
    );
    // 有 0 这个数就写 0；写成「—」的话「今日新增 0 单」这张卡看起来像坏了
    expect(zero).toMatch(/>0</);
    expect(zero).not.toContain("该字段暂无有效数值");
  });
});

describe("占比环图", () => {
  const rows = [
    { id: "a", values: { channel: "线上", amount: 100 }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", values: { channel: "门店", amount: 300 }, createdAt: "2026-08-01T00:00:00.000Z" },
  ];
  const render = (binding: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "p", type: "ProportionPie", props: { title: "渠道占比" },
          binding: { entityRef: "order", dimensionRef: "channel", ...binding },
        }}
        entityRows={{ order: rows }}
      />
    );

  it("没绑维度就说清楚缺什么", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "p", type: "ProportionPie", binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
      />
    );
    expect(html).toContain("未绑定到有效的分组维度");
  });

  it("有维度就出图（图表本体走懒加载，这里只钉外壳没崩）", () => {
    expect(render()).toContain("渠道占比");
    expect(render()).not.toContain("未绑定");
  });

  it("零行时说的是「写入某字段后自动出图」，不是绑定错误", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "p", type: "ProportionPie", binding: { entityRef: "order", dimensionRef: "channel" } }}
        entityRows={{ order: [] }}
      />
    );
    expect(html).toContain("自动出图");
  });

  it("契约里**没有 limit** —— 长尾折成「其他」这件事只该有一处管", () => {
    const pie = (CATALOG.blocks as Array<{
      type: string;
      bindingSchema: { optional?: string[] };
    }>).find(b => b.type === "ProportionPie")!;
    expect(pie.bindingSchema.optional).not.toContain("limit");
  });
});

describe("排行里的涨跌", () => {
  const rows = [
    { id: "a", values: { name: "甲店", amount: 300, weekDelta: 12.4 }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", values: { name: "乙店", amount: 200, weekDelta: -3.1 }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "c", values: { name: "丙店", amount: 100, weekDelta: 0 }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "d", values: { name: "丁店", amount: 50 }, createdAt: "2026-08-01T00:00:00.000Z" },
  ];
  const render = (binding: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "r", type: "RankedList", props: { title: "门店排行" },
          binding: { entityRef: "order", sortByRef: "amount", limit: 5, ...binding },
        }}
        entityRows={{ order: rows }}
      />
    );

  it("不声明 deltaFieldRef 就一个箭头都不出", () => {
    expect(render()).not.toContain('data-testid="ranked-list-delta"');
  });

  it("声明了就每行出涨跌，正数向上负数向下", () => {
    const html = render({ deltaFieldRef: "weekDelta" });
    expect(html).toContain("12.4%");
    expect(html).toContain("3.1%");
    expect(html).toContain("anticon-caret-up");
    expect(html).toContain("anticon-caret-down");
  });

  it("恰好 0 只写数不画箭头 —— 箭头是方向的表示，没方向别画", () => {
    const html = render({ deltaFieldRef: "weekDelta" });
    expect(html).toContain("0%");
    // 三个有值的行里只有两个该有箭头
    expect((html.match(/anticon-caret-/g) ?? []).length).toBe(2);
  });

  it("字段没填的那行整块不画 —— 没填和「没有变化」是两回事", () => {
    const html = render({ deltaFieldRef: "weekDelta" });
    expect((html.match(/data-testid="ranked-list-delta"/g) ?? []).length).toBe(3);
    expect((html.match(/data-testid="ranked-list-item"/g) ?? []).length).toBe(4);
  });
});

/**
 * 2026-08-08 ②批次 3：筛选区。
 *
 * 两个新区块（SearchBox / TagFilterRow）+ 一条增强（FilterBar 接上收起展开）。
 * 用例钉的是搬到的那几条判断，不是控件长相。
 */
describe("搜索框", () => {
  const render = (props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "s", type: "SearchBox", props,
          binding: { entityRef: "order", targets: ["tbl"] },
        }}
        {...extra}
      />
    );

  it("出一个搜索框，占位文案可配", () => {
    const html = render({ placeholder: "搜门店名" });
    expect(html).toContain('data-testid="search-box-input"');
    expect(html).toContain("搜门店名");
  });

  it("不配占位文案时给一句能看懂的默认，不是空白框", () => {
    expect(render()).toContain("输入关键词搜索");
  });

  it("已有的搜索词回填进框里 —— 刷新之后不该白敲", () => {
    const html = render({}, { filterState: { enumFilters: {}, keyword: "人民路" } });
    expect(html).toContain('value="人民路"');
  });
});

describe("标签筛选行", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ value: `v${i}`, label: `取值${i}` }));
  const opts = [
    { id: "status", label: "状态", options: many },
    { id: "channel", label: "渠道", options: [
      { value: "线上", label: "线上" }, { value: "门店", label: "门店" },
    ] },
  ];
  const render = (extra: Record<string, unknown> = {}, fieldRefs = ["status", "channel"]) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "t", type: "TagFilterRow", props: { title: "按标签筛选" },
          binding: { entityRef: "order", fieldRefs, targets: ["tbl"] },
        }}
        filterFieldOptions={opts}
        {...extra}
      />
    );

  it("一个字段一行，左边出维度名", () => {
    const html = render();
    expect((html.match(/data-testid="tag-filter-dimension"/g) ?? []).length).toBe(2);
    expect(html).toContain("状态");
    expect(html).toContain("渠道");
  });

  it("「全部」本身是一颗可勾的标签，不是另一个清除按钮", () => {
    const html = render();
    expect((html.match(/data-testid="tag-filter-all"/g) ?? []).length).toBe(2);
    expect(html).toContain("全部");
  });

  it("hideCheckAll 能关掉「全部」", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "t", type: "TagFilterRow", props: { hideCheckAll: true },
          binding: { entityRef: "order", fieldRefs: ["channel"], targets: ["tbl"] },
        }}
        filterFieldOptions={opts}
      />
    );
    expect(html).not.toContain('data-testid="tag-filter-all"');
  });

  it("**展开按钮只在真的放不下时才出现** —— 源码那边只要 expandable 就永远显示", () => {
    const html = render();
    // status 有 11 个取值（超过 8），channel 只有 2 个
    expect((html.match(/data-testid="tag-filter-expand"/g) ?? []).length).toBe(1);
    // 而且说清楚还剩几个，不是光一个「展开」
    expect(html).toContain("还有 3 个");
  });

  it("收起时只画前 8 颗，展开才是全部", () => {
    const html = render();
    expect(html).toContain("取值7");
    expect(html).not.toContain("取值8");
  });

  /** 「全部」那颗标签是不是 checked 态。antd 的 CheckableTag 选中时加
   *  `ant-tag-checkable-checked`（实测的类名，不是猜的）。 */
  const allTagChecked = (html: string) => {
    const m = html.match(/<span data-testid="tag-filter-all" class="([^"]*)"/);
    return !!m && m[1].includes("ant-tag-checkable-checked");
  };

  it("真的全选中时「全部」亮起来", () => {
    const full = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "t", type: "TagFilterRow",
          binding: { entityRef: "order", fieldRefs: ["channel"], targets: ["tbl"] },
        }}
        filterFieldOptions={opts}
        filterState={{ enumFilters: {}, enumMulti: { channel: ["线上", "门店"] } }}
      />
    );
    expect(allTagChecked(full)).toBe(true);
  });

  it("**全选的判据是「每个都在」，不是长度相等**", () => {
    // 源码写的是 `getAllTags().length === value?.length`。筛选态里留着一个
    // 已经被删掉的取值时，长度照样相等，「全部」就会错误地亮起来——而实际上
    // 「门店」根本没被选中。同一类坑在 ColumnSettingPanel 的半选分母上踩过。
    const stale = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "t", type: "TagFilterRow",
          binding: { entityRef: "order", fieldRefs: ["channel"], targets: ["tbl"] },
        }}
        filterFieldOptions={opts}
        filterState={{ enumFilters: {}, enumMulti: { channel: ["线上", "已经不存在的取值"] } }}
      />
    );
    expect(allTagChecked(stale)).toBe(false);
  });

  it("fieldRefs 指向没有取值声明的字段时说清楚，不画一排空行", () => {
    expect(render({}, ["没有取值的字段"])).toContain("没有可摊成标签行的枚举字段");
  });
});

/**
 * 2026-08-08 ②批次 4：详情页。照 pro-blocks 的 ProfileAdvanced / ProfileBasic。
 *
 * 这一批最要紧的不是新控件，是补上一个**一直缺着的概念**：当前聚焦的是哪一条。
 * RecordDetail 的注释从建成那天就写着「运行时还没有选中态时用第一条」，而"还没有"
 * 一直是"没有"。关联单据表没有它就只能把整张表搬过来——ProfileAdvanced 那三张
 * Table 各是**属于这一单**的操作日志，不是全库的日志。
 */
describe("关联单据表", () => {
  const logs = [
    { id: "l1", values: { orderId: "o1", action: "创建" }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "l2", values: { orderId: "o1", action: "复核" }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "l3", values: { orderId: "o2", action: "创建" }, createdAt: "2026-08-01T00:00:00.000Z" },
  ];
  const render = (binding: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "rel", type: "DataTable", props: { title: "关联单据" }, binding }}
        entityRows={{ orderLog: logs }}
        fieldLabelOf={(_e, f) => ({ action: "操作", orderId: "所属订单" })[f]}
        {...extra}
      />
    );

  it("**只显示挂在聚焦记录下面的行** —— 这就是它跟普通表格的全部区别", () => {
    const html = render(
      { entityRef: "orderLog", parentRef: "order", viaFieldRef: "orderId", fieldRefs: ["action"] },
      { focus: { order: "o1" } }
    );
    expect((html.match(/data-testid="data-table-row"/g) ?? []).length).toBe(2);
    expect(html).toContain("复核");
  });

  it("换一条主记录就换一批行", () => {
    const html = render(
      { entityRef: "orderLog", parentRef: "order", viaFieldRef: "orderId", fieldRefs: ["action"] },
      { focus: { order: "o2" } }
    );
    expect((html.match(/data-testid="data-table-row"/g) ?? []).length).toBe(1);
  });

  it("还没有聚焦记录时说清楚，**不是把整张表摊出来**", () => {
    // 这条是判据本身：没有主记录却照样显示全部，是最容易犯又最难发现的错——
    // 界面看起来完全正常，只是给用户看了不属于这条记录的数据。
    const html = render({
      entityRef: "orderLog", parentRef: "order", viaFieldRef: "orderId", fieldRefs: ["action"],
    });
    expect(html).toContain("先选中一条主记录");
    expect(html).not.toContain('data-testid="data-table-row"');
  });

  it("聚焦的记录名下一条都没有时，说的是「没有关联单据」而不是「点新建」", () => {
    const html = render(
      { entityRef: "orderLog", parentRef: "order", viaFieldRef: "orderId", fieldRefs: ["action"] },
      { focus: { order: "查无此单" } }
    );
    expect(html).toContain("这条记录名下还没有关联单据");
  });

  it("**两个键要么都写要么都不写** —— 只写一个当作没声明，不猜", () => {
    // 猜错的后果是悄悄给用户看了不属于这条记录的数据，那比不生效严重得多。
    const onlyParent = render(
      { entityRef: "orderLog", parentRef: "order", fieldRefs: ["action"] },
      { focus: { order: "o1" } }
    );
    expect((onlyParent.match(/data-testid="data-table-row"/g) ?? []).length).toBe(3);
    const onlyVia = render(
      { entityRef: "orderLog", viaFieldRef: "orderId", fieldRefs: ["action"] },
      { focus: { order: "o1" } }
    );
    expect((onlyVia.match(/data-testid="data-table-row"/g) ?? []).length).toBe(3);
  });
});

describe("详情区块认聚焦的那一条", () => {
  const rows = [
    { id: "r1", values: { name: "甲单" }, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "r2", values: { name: "乙单" }, createdAt: "2026-08-01T00:00:00.000Z" },
  ];
  const render = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "d", type: "RecordDetail", props: { title: "订单详情" },
          binding: { entityRef: "order", fieldRefs: ["name"] },
        }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ name: "单号" })[f]}
        {...extra}
      />
    );

  it("聚焦哪条就显示哪条", () => {
    expect(render({ focus: { order: "r2" } })).toContain("乙单");
  });

  it("没有聚焦态时回落第一条 —— 稳定，不是随机", () => {
    expect(render()).toContain("甲单");
    expect(render()).not.toContain("乙单");
  });

  it("聚焦的 id 查不到时也回落第一条，不渲染空详情", () => {
    const html = render({ focus: { order: "已经被删掉的行" } });
    expect(html).toContain("甲单");
  });
});

describe("详情的列数默认跟容器宽度走", () => {
  it("默认档量的是**容器**，不是视口 —— 视口断点治不了「窗口宽但这一栏窄」", () => {
    /**
     * 这条 2026-08-11 换过判据。原来钉的是视口断点那串字面量
     * `{ xs: 1, sm: 1, md: 2, lg: 3, … }`，而线上截图里详情面板的标签和值**直接
     * 叠在一起**（"所属班级"压住"特级班级"）——因为 antd 的响应式 column 看的是
     * 视口宽度，而详情面板待在右侧窄栏（aside 占 4/12，桌面下约 340px）：
     * 视口是 lg → 选 3 列 → 三对「标签+值」挤进 340px。
     *
     * 也就是说旧断言把一个**看着合理但治不了这个场景**的实现钉住了。所以判据
     * 换成"默认档必须来自容器测量"。
     */
    const src = readFileSync(
      new URL("../block-registry.tsx", import.meta.url),
      "utf8"
    ).replace(/\r\n?/g, "\n");
    expect(src).toContain('String(block.props?.columns ?? "responsive")');
    // 默认档接的是容器测量值
    expect(src).toContain("useContainerColumns(3)");
    expect(src).toMatch(/:\s*measuredColumns;/);
    // 而且不许退回视口断点——那是这次要修掉的东西
    expect(src).not.toContain("{ xs: 1, sm: 1, md: 2, lg: 3, xl: 3, xxl: 3 }");
    // 容器测量必须真的用 ResizeObserver，且窄容器落到 1 列（宁可稀疏不要叠字）
    expect(src).toContain("new ResizeObserver");
    expect(src).toMatch(/w < 380 \? 1/);
  });

  it("显式声明的档位仍然生效 —— 页头那份该是 2 列，正文那份是 3 列", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "d", type: "RecordDetail", props: { columns: "2" },
          binding: { entityRef: "order", fieldRefs: ["name"] },
        }}
        entityRows={{ order: [{ id: "r1", values: { name: "甲" }, createdAt: "2026-08-01T00:00:00.000Z" }] }}
      />
    );
    expect(html).toContain("甲");
  });
});
