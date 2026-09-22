export const PAGE_CONTENT_REF = "page-content";

export type BusinessPageBreakpoint = "desktop" | "tablet" | "phone";

export interface BusinessGridItem {
  blockRef: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BusinessGridLayouts = Partial<
  Record<BusinessPageBreakpoint, BusinessGridItem[]>
>;

/**
 * 页面区域 -> 落在里面的区块 id。
 *
 * 2026-08-08：旧名 LegacyBusinessSlots，装的是那五个槽。整套换成有出处的区域
 * 名之后它不再是"legacy"了——它就是模型直接产出的东西。
 */
export interface BusinessRegions {
  header: string[];
  headerExtra: string[];
  headerContent: string[];
  tabs: string[];
  filters: string[];
  metrics: string[];
  charts: string[];
  main: string[];
  supplement: string[];
  aside: string[];
  footerBar: string[];
  overlay: string[];
}

export const BUSINESS_GRID_COLUMNS: Record<BusinessPageBreakpoint, number> = {
  desktop: 12,
  tablet: 8,
  phone: 4,
};

const BREAKPOINTS: BusinessPageBreakpoint[] = ["desktop", "tablet", "phone"];

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeItems(
  raw: unknown,
  validRefs: ReadonlySet<string>,
  columns: number
): BusinessGridItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: BusinessGridItem[] = [];

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const blockRef = String(item.blockRef ?? "").trim();
    const rawX = asInteger(item.x);
    const rawY = asInteger(item.y);
    const rawW = asInteger(item.w);
    const rawH = asInteger(item.h);
    if (
      !blockRef ||
      !validRefs.has(blockRef) ||
      seen.has(blockRef) ||
      rawX === null ||
      rawY === null ||
      rawW === null ||
      rawH === null ||
      rawW <= 0 ||
      rawH <= 0
    ) {
      continue;
    }

    const w = Math.min(columns, rawW);
    const x = Math.min(Math.max(0, rawX), columns - w);
    items.push({
      blockRef,
      x,
      y: Math.max(0, rawY),
      w,
      h: rawH,
    });
    seen.add(blockRef);
  }

  return items.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function normalizeBusinessGrid(
  raw: unknown,
  validRefs: ReadonlySet<string>
): BusinessGridLayouts | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const layouts: BusinessGridLayouts = {};

  for (const breakpoint of BREAKPOINTS) {
    const items = normalizeItems(
      source[breakpoint],
      validRefs,
      BUSINESS_GRID_COLUMNS[breakpoint]
    );
    if (items.length > 0) layouts[breakpoint] = items;
  }

  return Object.keys(layouts).length > 0 ? layouts : undefined;
}

function projectItems(
  items: BusinessGridItem[],
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  const columns = BUSINESS_GRID_COLUMNS[breakpoint];
  if (breakpoint === "phone") {
    return items
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item, index) => ({
        ...item,
        x: 0,
        y: index,
        w: columns,
      }));
  }
  return items.map(item => {
    const w = Math.min(columns, item.w);
    return {
      ...item,
      w,
      x: Math.min(Math.max(0, item.x), columns - w),
    };
  });
}

export function resolveBusinessGrid(
  layouts: BusinessGridLayouts,
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  const source =
    layouts[breakpoint] ??
    (breakpoint === "phone" ? layouts.tablet : undefined) ??
    layouts.desktop ??
    [];
  return projectItems(source, breakpoint);
}

export function ensurePageContentItem(
  items: BusinessGridItem[],
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  if (items.some(item => item.blockRef === PAGE_CONTENT_REF)) return items;
  const nextY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return [
    ...items,
    {
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: nextY,
      w: BUSINESS_GRID_COLUMNS[breakpoint],
      h: breakpoint === "phone" ? 2 : 3,
    },
  ];
}

function fullWidthItems(
  refs: string[],
  columns: number,
  startY: number
): BusinessGridItem[] {
  return refs.map((blockRef, index) => ({
    blockRef,
    x: 0,
    y: startY + index,
    w: columns,
    h: 1,
  }));
}

/**
 * 区域 -> 栅格。
 *
 * ## 为什么重写
 *
 * 上一版叫 `upgradeLegacySlotsToGrid`，名字里就写着 legacy：它把那五个旧槽
 * 翻译成栅格。2026-08-08 实测量过它的输出（12 栅格）——
 *
 *     summary / primary    → 12
 *     secondary / activity → 4
 *     content              → 仪表盘 12、其它页型 4
 *
 * 五个名字两种行为，content 还随页型变。而 12 个已存应用里 secondary 和
 * content 一次都没被用过。所以整套换成照 ant-design/pro-blocks 那 29 个真实
 * 页面定出来的区域（见目录 pageRegions，每个都带出处）。
 *
 * ## 带（band）决定几何，不是每个区域各写一套
 *
 * 12 个区域归 5 条带（目录里 pageRegions[].band 说了是哪条）：
 *
 *     top      页头带：标题、页头指标、页头说明、页签、筛选 —— 整行、依次堆叠
 *     main     正文带：指标区、图表区、主体区、补充说明 —— 整行；有 aside 时让出右栏
 *     aside    右栏：辅助区 —— 4/12（看板日历 3/12，因为它们的主视图更需要宽度）
 *     footer   底部条：贴在最后，整行
 *     overlay  浮层：**不进栅格** —— 点了才出来，不占版面
 *
 * 这样加一个区域不用回来改几何，只要在目录里给它一条带。
 */
const REGIONS_BY_BAND = {
  top: ["header", "headerExtra", "headerContent", "tabs", "filters"],
  main: ["metrics", "charts", "main", "supplement"],
  aside: ["aside"],
  footer: ["footerBar"],
} as const;

const pick = (regions: BusinessRegions, band: keyof typeof REGIONS_BY_BAND) =>
  REGIONS_BY_BAND[band].flatMap(k => regions[k as keyof BusinessRegions] ?? []);

function phonePreset(
  kind: string,
  regions: BusinessRegions,
  hasPageContent: boolean
): BusinessGridItem[] {
  // 手机只有一列，带的顺序就是从上到下的顺序。仪表盘把辅助内容提到主体
  // 之前——小屏上「现在怎么样」比「全部明细」先看。
  const content = hasPageContent ? [PAGE_CONTENT_REF] : [];
  const ordered =
    kind === "dashboard"
      ? [...pick(regions, "top"), ...content, ...pick(regions, "aside"),
         ...pick(regions, "main"), ...pick(regions, "footer")]
      : [...pick(regions, "top"), ...pick(regions, "main"), ...content,
         ...pick(regions, "aside"), ...pick(regions, "footer")];
  return ordered.map((blockRef, index) => ({
    blockRef,
    x: 0,
    y: index,
    w: BUSINESS_GRID_COLUMNS.phone,
    h: blockRef === PAGE_CONTENT_REF ? 2 : 1,
  }));
}

export function regionsToGrid(
  kind: string,
  regions: BusinessRegions,
  options?: { hasPageContent?: boolean }
): Required<Pick<BusinessGridLayouts, "desktop" | "tablet" | "phone">> {
  /**
   * 这一页到底有没有"内置主视图"（PAGE_CONTENT_REF）。
   *
   * 2026-08-12：用户在「团长管理」上圈出主体区左半边一大块纯白。量出来是
   * 870×273，位置正好是内置主视图那格。成因不是哪个区块渲染成了空——
   * **那一格压根没进栅格**，白是邻居撑出来的：
   *
   *     page-content   (0,0,8,3)  ← 积木自己有表格时，上游把它整条摘掉
   *     leader_detail  (8,0,4,3)  ← 辅助区照样占着三行
   *     leader_table   (0,3,12,1) ← 正文带无条件排在"主视图三行"之后
   *
   * 于是第 1–3 行的左边 8 格没有任何东西，而右边那张详情卡把这三行撑到
   * 273px 高。`empty:hidden` 收的是"格子里的区块渲染成空"，这里连格子都
   * 没有，它当然收不掉——**同一片白，两种成因，上一刀只切到其中一种**。
   *
   * 修法是让几何知道这件事：没有内置主视图时，正文带的区块**自己就是**
   * 主视图，占内容列（跟辅助区并排），而不是排在一段没人认领的空高之后。
   */
  const hasPageContent = options?.hasPageContent !== false;
  const columns = BUSINESS_GRID_COLUMNS.desktop;
  const top = pick(regions, "top");
  const mainRegion = pick(regions, "main");
  const aside = pick(regions, "aside");
  const footer = pick(regions, "footer");

  // 看板/日历的主视图是棋盘和月历，比别的页型更吃宽度，右栏收窄一格。
  const asideWidth = kind === "kanban" || kind === "calendar" ? 3 : 4;
  // 内容列存在的前提是**真的有东西填它**。既没有内置主视图、正文带也空的
  // 页面（只剩一个辅助区），再给右栏留 4/12 就是把另外 8/12 让给空白。
  const hasContentColumn = hasPageContent || mainRegion.length > 0;
  const contentWidth =
    aside.length > 0 && hasContentColumn ? columns - asideWidth : columns;

  const desktop = fullWidthItems(top, columns, 0);
  const contentY = desktop.length;

  // 内容列：有内置主视图就是它（占三行）；没有就由正文带的区块逐行顶上。
  const contentItems: BusinessGridItem[] = hasPageContent
    ? [{ blockRef: PAGE_CONTENT_REF, x: 0, y: contentY, w: contentWidth, h: 3 }]
    : mainRegion.map((blockRef, index) => ({
        blockRef,
        x: 0,
        y: contentY + index,
        w: contentWidth,
        h: 1,
      }));
  contentItems.forEach(i => desktop.push(i));

  // 辅助区跨的行数跟内容列**实测**一样高，不再写死 3：写死的那个 3 正是
  // 上面那片白的另一半原因（内容列没了，3 行照样占着）。
  const contentRows = Math.max(
    1,
    contentItems.reduce((max, i) => Math.max(max, i.y + i.h - contentY), 0)
  );
  aside.forEach((blockRef, index) => {
    desktop.push({
      blockRef,
      x: hasContentColumn ? contentWidth : 0,
      y: contentY + (hasContentColumn ? index : contentRows + index),
      w: hasContentColumn ? asideWidth : columns,
      h: hasContentColumn && aside.length === 1 ? contentRows : 1,
    });
  });

  // 正文带的区块跟在主视图下面，整行 —— 它们是主体的一部分，不是附属。
  // 没有内置主视图时它们已经在上面当过内容列了，这里不能再摆一遍。
  const afterContent =
    contentY + contentRows + (hasContentColumn ? 0 : aside.length);
  if (hasPageContent) {
    fullWidthItems(mainRegion, columns, afterContent).forEach(i => desktop.push(i));
  }
  const afterMain = afterContent + (hasPageContent ? mainRegion.length : 0);
  fullWidthItems(footer, columns, afterMain).forEach(i => desktop.push(i));

  const tablet = desktop.map(item => ({
    ...item,
    x: 0,
    w: BUSINESS_GRID_COLUMNS.tablet,
  }));

  return { desktop, tablet, phone: phonePreset(kind, regions, hasPageContent) };
}
