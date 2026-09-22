/**
 * 页面范式（加厚 schema 二期）测试。
 * 锁：kanban 分组（声明列序、声明外进未归类）、月历纯日期算术
 * （周一起始、整周补位、数据月推导）、KanbanBoard/CalendarBoard 静态渲染。
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KANBAN_UNASSIGNED,
  dateKeyOf,
  dominantMonth,
  groupRowsForKanban,
  rowsByDateKey,
} from "../live-runtime/page-views";
import { KanbanBoard, CalendarBoard } from "../live-runtime/PageViews";
import type { RuntimeRow } from "../live-runtime/live-runtime";

const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({
  id,
  createdAt: "2026-07-09T00:00:00Z",
  values,
});

const OPTIONS = [
  { id: "待跟进", label: "待跟进", tone: "warning" as const },
  { id: "跟进中", label: "跟进中", tone: "processing" as const },
  { id: "已成交", label: "已成交", tone: "success" as const },
];

describe("kanban 分组", () => {
  it("行按声明列序分组；声明外/空值进未归类列（仅在有此类行时出现）", () => {
    const rows = [
      row("r1", { status: "已成交", title: "A" }),
      row("r2", { status: "待跟进", title: "B" }),
      row("r3", { status: "野值", title: "C" }),
      row("r4", { title: "D" }),
    ];
    const cols = groupRowsForKanban(rows, "status", OPTIONS);
    expect(cols.map(c => c.id)).toEqual([
      "待跟进",
      "跟进中",
      "已成交",
      KANBAN_UNASSIGNED,
    ]);
    expect(cols[0].rows.map(r => r.id)).toEqual(["r2"]);
    expect(cols[1].rows).toEqual([]);
    expect(cols[2].rows.map(r => r.id)).toEqual(["r1"]);
    expect(cols[3].rows.map(r => r.id)).toEqual(["r3", "r4"]);
    // 全部可归类时不出未归类列
    const clean = groupRowsForKanban([rows[0], rows[1]], "status", OPTIONS);
    expect(clean.map(c => c.id)).toEqual(["待跟进", "跟进中", "已成交"]);
  });
});

describe("月历纯函数", () => {
  it("dateKeyOf：只认 YYYY-MM-DD 前缀；rowsByDateKey 跳过不可解析行", () => {
    expect(dateKeyOf("2026-07-09")).toBe("2026-07-09");
    expect(dateKeyOf("2026-07-09T10:00:00Z")).toBe("2026-07-09");
    expect(dateKeyOf("下周三")).toBeNull();
    expect(dateKeyOf("")).toBeNull();
    const map = rowsByDateKey(
      [
        row("a", { d: "2026-07-01" }),
        row("b", { d: "2026-07-01" }),
        row("c", { d: "无" }),
      ],
      "d"
    );
    expect(map.get("2026-07-01")!.map(r => r.id)).toEqual(["a", "b"]);
    expect(map.size).toBe(1);
  });

  it("dominantMonth：行数最多的月份；并列取较早月；无数据 null", () => {
    const map = rowsByDateKey(
      [
        row("a", { d: "2026-07-01" }),
        row("b", { d: "2026-07-15" }),
        row("c", { d: "2026-08-02" }),
      ],
      "d"
    );
    expect(dominantMonth(map)).toBe("2026-07");
    expect(dominantMonth(new Map())).toBeNull();
  });

  
  });

describe("视图组件静态渲染", () => {
  const STATUS_FIELD = {
    id: "status",
    label: "跟进状态",
    type: "enum",
    options: OPTIONS,
  };
  const TITLE_FIELD = { id: "title", label: "客户", type: "string" as const };

  it("KanbanBoard：声明列 + tone 徽标 + 卡片字段值", () => {
    const html = renderToStaticMarkup(
      <KanbanBoard
        rows={[row("r1", { status: "已成交", title: "张三" })]}
        statusField={STATUS_FIELD}
        cardFields={[TITLE_FIELD]}
        onOpenRow={() => {}}
      />
    );
    expect(html).toContain('data-testid="app-runtime-kanban"');
    expect(html).toContain('data-testid="app-kanban-col-已成交"');
    expect(html).toContain("ant-tag-success");
    expect(html).toContain("张三");
    // 空列如实显示"暂无"
    expect(html).toContain("暂无");
  });

  it("CalendarBoard：默认展示数据月、事件条入格、着色点", () => {
    const html = renderToStaticMarkup(
      <CalendarBoard
        rows={[
          row("r1", { d: "2026-07-09", status: "已成交", title: "张三" }),
          row("r2", { d: "2026-07-09", status: "待跟进", title: "李四" }),
        ]}
        dateFieldId="d"
        colorByField={STATUS_FIELD}
        titleFieldId="title"
        onOpenRow={() => {}}
      />
    );
    expect(html).toContain('data-testid="app-runtime-calendar"');
    // dayjs 的 M 不补零（"7 月" 不是 "07 月"）；自建版是手拼字符串才有前导零
    expect(html).toContain("2026 年 7 月");
    expect(html).toContain('data-testid="app-calendar-event-r1"');
    expect(html).toContain("张三");
    expect(html).toContain("李四");
    expect(html).toContain("共 2 条排期");
    // 着色改走 Badge 的 status 档，不再自己写死十六进制：
    // 已成交 success / 待跟进 warning，颜色由主题 token 出，跟着身份主色走
    expect(html).toContain("ant-badge-status-success");
    expect(html).toContain("ant-badge-status-warning");
    expect(html).not.toContain("#52c41a");
  });

  /**
   * 把"今天"钉死在数据所在的那个月里（2026-08-09 修）。
   *
   * 这条用例本来是**定时炸弹**：它让日历停在数据的月份（2026-07），却断言
   * 画面上有"今天"的高亮。而 antd 的月视图是 6 周 42 格，只覆盖
   * 2026-06-28 ~ 2026-08-08 —— 也就是说：
   *
   *     真实日期 ≤ 2026-08-08  → 今天在格子里，绿
   *     真实日期 = 2026-08-09  → 今天差一天出界，红
   *
   * 它在 08-08 那天还是绿的，08-09 就红了，而代码一行没动。这种红最费人：
   * 单跑也红、全量也红，但 git blame 指不到任何改动。
   *
   * 冻住时间之后，断言才真的在验"今天有没有高亮"，而不是在验"今天是几号"。
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("CalendarBoard：换成 antd Calendar 后白拿到的两样东西", () => {
    const html = renderToStaticMarkup(
      <CalendarBoard
        rows={[row("r1", { d: "2026-07-09", status: "已成交", title: "张三" })]}
        dateFieldId="d"
        colorByField={STATUS_FIELD}
        titleFieldId="title"
        onOpenRow={() => {}}
      />
    );
    // 1. 今天的高亮 —— 自建版一直没有
    expect(html).toContain("ant-picker-cell-today");
    // 2. 每格带 title（无障碍/悬停可读的完整日期）
    expect(html).toContain('title="2026-07-09"');
  });

  it("CalendarBoard：无可解析日期时如实空态", () => {
    const html = renderToStaticMarkup(
      <CalendarBoard rows={[]} dateFieldId="d" onOpenRow={() => {}} />
    );
    expect(html).toContain("暂无带日期的数据");
  });
});
