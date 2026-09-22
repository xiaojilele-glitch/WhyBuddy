/**
 * KPI/图表的通道归属（方案 C，2026-07-28）。
 *
 * 一页里 KPI 和图表只能由一条路负责，否则同一个指标会被画两次：
 *
 *   总览页（monitor/dashboard）→ page.stats/charts，由 ENRICH 重新设计成
 *     freeformOverview 整体版式（每个应用长得不一样，是展示面的主角）
 *   业务页（其余 kind）        → MetricGrid/TrendChart 积木（模板渲染，整齐可预期）
 *
 * 两个方向都在渲染层硬隔离，不指望 LLM 一定守规矩：
 *   - 总览页上出现的 KPI 积木被摘掉（否则和总览区重复）
 *   - 业务页上有 KPI 积木时，固定骨架的 statsBand/chartsBand 让位
 *
 * 用源码断言：AppRuntimeScreen 带一堆 hook，本仓库没有 jsdom 跑不起来；而
 * 这两条恰恰是"删掉之后编译能过、测试能过、只有真机上才看得出画了两遍"
 * 的类型，值得单独钉住。
 */
import { describe, it, expect } from "vitest";

import catalog from "@experience-blocks";

const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

interface CatalogFile {
  blocks: Array<{
    type: string;
    rendererStatus: string;
    generationEnabled: boolean;
  }>;
}
const BLOCKS = (catalog as unknown as CatalogFile).blocks;

describe("渲染层硬隔离", () => {
  it("两张名单都在，且内容就是约定的那几个", () => {
    expect(screenSrc).toContain('OVERVIEW_KINDS = new Set(["monitor", "dashboard"])');
    expect(screenSrc).toContain('KPI_BLOCK_TYPES = new Set(["MetricGrid", "TrendChart"])');
  });

  it("总览页摘掉 KPI 积木（正方向）", () => {
    expect(screenSrc).toContain(
      "OVERVIEW_KINDS.has(page.view.kind) && KPI_BLOCK_TYPES.has(b.type)"
    );
  });

  it("业务页有 KPI 积木时固定骨架让位（反方向）", () => {
    expect(screenSrc).toContain("const pageHasKpiBlocks");
    expect(screenSrc).toContain(") : pageHasKpiBlocks ? (");
    // 让位的是 statsBand/chartsBand，widgetsBand（快速入口）不属于 KPI/图表，
    // 必须保留——它被一起吞掉的话业务页会丢失入口按钮
    expect(screenSrc).toContain("<>{widgetsBand}</>");
  });

  it("绑主实体的 DataTable 被摘掉（同一批行不画两遍）", () => {
    // 真跑发现：放开 DataTable 生成后五个业务页全中——模型不知道"这一页已经
    // 自带主实体表"，于是同样的数据出现两遍，积木那遍还只有裸字段名、没有
    // 枚举标签和行内操作。删掉这条过滤编译能过、测试能过，只有真机上看得出。
    expect(screenSrc).toContain('b.type === "DataTable"');
    expect(screenSrc).toMatch(/entityRef\s*===\s*[\s\S]{0,40}page\.entityId/);
  });

  it("绑别的实体的 DataTable 必须留着 —— 那是真新增内容", () => {
    // 条件里必须带 entityRef 与 page.entityId 的相等判断；写成"凡 DataTable
    // 一律摘掉"会把库存页上那张供应商表也一起吞了
    expect(screenSrc).not.toMatch(/filter\([^)]*b\.type === "DataTable"\s*\)/);
  });

  it("总览页摘掉筛选类积木，判据是 capability 而不是名字", () => {
    // 2026-08-11：原来写的是 `b.type === "FilterBar"`。理由（筛选状态只到本页
    // 的表/看板/日历，总览页三者都没有，KPI/图表/积木/设计树全读未筛全量）对
    // **所有** filter 区块都成立——32 个里 31 个只发 filterChange。按名字挡等于
    // 只挡了这一族里最出名的那个，SavedViewTabs / TagFilterRow / SearchBox 摆
    // 上总览页照样上屏、照样按不动。
    expect(screenSrc).toContain(
      'EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE[b.type] === "filter"'
    );
    // 名字版必须已经删掉，否则等于两条判据并存、以后只会改一条
    expect(screenSrc).not.toMatch(
      /OVERVIEW_KINDS\.has\(page\.view\.kind\) && b\.type === "FilterBar"/
    );
  });

  it("目录与渲染层同判据：没有筛选类区块还声明允许总览页", () => {
    // 三处同源：目录 pageKinds、提示词禁令（services/schema_legal.py）、
    // 上面那条渲染层兜底。目录留着 monitor/dashboard 的话，模型会被条目
    // 告知"这页可以放"，再被禁令告知"不许放"——同一份提示词自相矛盾。
    const stray = (catalog as unknown as { blocks: Array<{
      type: string; generationEnabled: boolean;
      capability?: string; pageKinds?: string[];
    }> }).blocks.filter(
      b =>
        b.generationEnabled &&
        b.capability === "filter" &&
        (b.pageKinds ?? []).some(k => k === "monitor" || k === "dashboard")
    );
    expect(stray.map(b => b.type)).toEqual([]);
  });

  it("pageHasKpiBlocks 只看非 legacy 的真区块", () => {
    // _fromLegacy 是转换占位，本来就走旧路径渲染；把它算进来会让固定骨架
    // 被一个"其实还是走固定骨架"的占位区块顶掉，页面直接空一块
    expect(screenSrc).toMatch(/pageHasKpiBlocks[\s\S]{0,400}_fromLegacy/);
  });

  it("没有 freeform 设计的 dashboard 由业务网格持有主数据且不重复追加表格", () => {
    expect(screenSrc).toContain("const dashboardUsesBusinessGrid");
    expect(screenSrc).toMatch(
      /\(!OVERVIEW_KINDS\.has\(page\.view\.kind\) \|\| dashboardUsesBusinessGrid\)[\s\S]{0,80}businessPageGrid/
    );
    expect(screenSrc).toMatch(
      /OVERVIEW_KINDS\.has\(page\.view\.kind\) && !dashboardUsesBusinessGrid[\s\S]{0,80}blockScaffold/
    );
    expect(screenSrc).toContain(
      "OVERVIEW_KINDS.has(page.view.kind) && !dashboardUsesBusinessGrid &&"
    );
    expect(screenSrc).toMatch(
      /dashboardUsesBusinessGrid[\s\S]{0,80}renderExperienceBlockScaffold\(true, phonePrimaryDataView\)/
    );
  });
});

describe("目录与方案 C 一致", () => {
  it("业务页要用的积木都已通电，且都是真渲染器", () => {
    const need = [
      "MetricGrid",
      "TrendChart",
      "RankedList",
      "ActivityFeed",
      "DataTable",
    ];
    for (const t of need) {
      const b = BLOCKS.find(x => x.type === t);
      expect(b, `${t} 不在目录里`).toBeTruthy();
      expect(b!.rendererStatus, `${t} 还是占位渲染器`).toBe("real");
      expect(b!.generationEnabled, `${t} 没通电，AI 生成不出来`).toBe(true);
    }
  });

  it("FreeformInsight 不通电 —— 它走 ENRICH 旁路合成，不是 LLM 写进 page.blocks 的", () => {
    // 打开它会让 LLM 直接往 page.blocks 里塞 FreeformInsight，绕过
    // enrich_monitor_page_overviews 那套"读 stats/charts 再设计"的流程
    const ff = BLOCKS.find(x => x.type === "FreeformInsight");
    expect(ff!.generationEnabled).toBe(false);
  });

  it("目录里没有「通电了但渲染器是占位」的坏组合", () => {
    for (const b of BLOCKS)
      if (b.generationEnabled) expect(b.rendererStatus).toBe("real");
  });
});
