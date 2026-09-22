/**
 * 区块 props 接线护栏（2026-08-08，②阶段复盘的产物）。
 *
 * ## 这条护栏是怎么来的
 *
 * 搬到第 23 个区块时做了一次复盘，本来是想找"哪些逻辑在反复重写、该抽成
 * schema"。找到的不是重复代码，是**一条一直在漏的缝**：
 *
 * 批次 1-4 给渲染器加了六个新 prop（selection / onSelectionChange /
 * columnState / onColumnStateChange / targetColumns / focus）。装配预览
 * （ComponentsLibraryPage）每个都接了，**真实运行时（AppRuntimeScreen）一个
 * 都没接**。于是这六个 prop 撑起来的那些区块在真实应用里全是死壳：
 *
 *     BatchActionBar    永远显示「勾选左侧的行」
 *     DataTable         没有勾选列
 *     ColumnSettingPanel 「没有连到任何表格」
 *     关联单据表         「先选中一条主记录」
 *     TagFilterRow      勾了标签没反应
 *     SearchBox         敲了词没反应
 *
 * 每一个都渲染得**完全正常**，只是点不动——这正是这个项目已经踩过一次的
 * 形状（QuickActionPanel 拿不到 pageActions，一直渲染成空气、没人发现）。
 *
 * AppRuntimeScreen 里那份 `sharedBlockRendererProps` 当初就是为了防这件事
 * 建的，它的注释写着"逐个列举等于每加一个 prop 就埋一次漏传"。**但它自己
 * 就是逐个列举的**，只是把三个调用点收成了一处——加新 prop 时照样要记得回来
 * 补，漏了不报错。
 *
 * ## 所以这条护栏钉的是什么
 *
 * 渲染器接口里每一个 prop，要么被宿主真的传了，要么写进下面的豁免名单并
 * 说明为什么。**沉默的漏传变成红用例。**
 *
 * 这不是"抽象"——四种页面态的形状还没稳定到该合并（见文件末尾的观察）。
 * 这是在真正抽象之前，先把已经在流血的地方止住。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n?/g, "\n");

const registry = read("../live-runtime/block-registry.tsx");
const runtime = read("../live-runtime/AppRuntimeScreen.tsx");
const library = read("../ComponentsLibraryPage.tsx");

/** 渲染器接口里声明的 prop 名（不含下划线开头的遗留字段）。 */
function declaredProps(): string[] {
  const start = registry.indexOf("export interface ExperienceBlockRendererProps {");
  expect(start, "找不到渲染器 props 接口 —— 是不是改名了？").toBeGreaterThan(-1);
  const end = registry.indexOf("\n}", start);
  return [...registry.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)]
    .map(m => m[1])
    .filter(name => !name.startsWith("_"));
}

/**
 * 不需要宿主传的 prop，逐个说明理由。
 *
 * **加东西进这张表要写清楚为什么**——它是豁免名单，不是待办清单。
 */
const NOT_FROM_HOST: Record<string, string> = {
  block: "每个调用点单独传的那一个，本来就不在共享包里",
  children: "遗留 children 透传，装配路径不用",
  previewId: "只有落地页自审那条路用得上",
  sessionId: "只有需要解析生成资产的宿主传（AppRuntimeScreen 传了，对照台不需要）",
  pageActions: "QuickActionPanel 专用，对照台用自己那份 previewActions",
  targetColumns: "**按区块算**，不能进整页共享的那一份，各调用点单独传",
  workflow: "五系统数据，只有拿得到 model 的宿主传",
};

describe("渲染器的每个 prop 都得有人真的传", () => {
  const props = declaredProps();

  it("接口不是空的（正则没写错）", () => {
    expect(props.length).toBeGreaterThan(15);
    expect(props).toContain("filterState");
    expect(props).toContain("focus");
  });

  it("**真实运行时**接齐了 —— 装配预览好使、真应用是死壳，是这条护栏的由来", () => {
    const start = runtime.indexOf("const sharedBlockRendererProps = {");
    expect(start, "sharedBlockRendererProps 不见了").toBeGreaterThan(-1);
    const shared = runtime.slice(start, runtime.indexOf("\n  };", start));
    const passed = new Set([...shared.matchAll(/^ {4}(\w+)[,:]/gm)].map(m => m[1]));
    const missing = props.filter(p => !passed.has(p) && !(p in NOT_FROM_HOST));
    expect(
      missing,
      `AppRuntimeScreen 没传：${missing.join(", ")}。` +
        "要么补进 sharedBlockRendererProps，要么写进 NOT_FROM_HOST 并说明理由——" +
        "不传而不说明的后果是区块渲染正常但点不动，没人会发现。"
    ).toEqual([]);
  });

  it("**装配预览**接齐了 —— 它是审阅区块的地方，缺一个就审不出真假", () => {
    const start = library.indexOf("const renderBlock = (b: AssembledBlock, i: number) => {");
    expect(start).toBeGreaterThan(-1);
    const seg = library.slice(start, library.indexOf("\n  };", start));
    const passed = new Set([...seg.matchAll(/\b(\w+)=\{/g)].map(m => m[1]));
    const missing = props.filter(p => !passed.has(p) && !(p in NOT_FROM_HOST));
    expect(
      missing,
      `ComponentsLibraryPage 没传：${missing.join(", ")}`
    ).toEqual([]);
  });

  it("豁免名单里的每一条都写了理由，且确实还在接口里", () => {
    for (const [name, why] of Object.entries(NOT_FROM_HOST)) {
      expect(why.length, `${name} 的豁免理由太短，说不清楚`).toBeGreaterThan(8);
      expect(props, `${name} 已经不在接口里了，豁免名单该删掉它`).toContain(name);
    }
  });
});

/**
 * 筛选通道同理：区块往 filterState 里写了什么，宿主就得读什么。
 *
 * 这一条是分开钉的，因为漏的形状不一样——上面那条漏的是 prop 没传，这条漏
 * 的是 prop 传了、但宿主的 reducer 逐字段重建时把新字段吞了。实际发生过：
 * `handlePageFilterChange` 只重建 enumFilters 和 dateRange，TagFilterRow 和
 * SearchBox 发过去的补丁被默默丢掉。
 */
describe("筛选态的每条通道，写的人和读的人对得上", () => {
  const channels = [...registry.matchAll(
    /^ {2}(enumFilters|dateRange|enumMulti|keyword)\??:/gm
  )].map(m => m[1]);

  it("契约里有四条通道", () => {
    expect(new Set(channels)).toEqual(
      new Set(["enumFilters", "dateRange", "enumMulti", "keyword"])
    );
  });

  it("真实运行时的过滤函数四条都读", () => {
    const start = runtime.indexOf("function applyPageFilter");
    const body = runtime.slice(start, runtime.indexOf("\n}", start));
    for (const c of channels) {
      expect(body, `applyPageFilter 没读 ${c} —— 那条筛选点了不会有反应`).toContain(c);
    }
  });

  it("真实运行时的 reducer 四条都保留", () => {
    const start = runtime.indexOf("const handlePageFilterChange");
    const body = runtime.slice(start, runtime.indexOf("\n  };", start));
    for (const c of channels) {
      expect(
        body,
        `handlePageFilterChange 把 ${c} 吞了 —— 逐字段重建的写法每加一条就要回来补`
      ).toContain(c);
    }
  });
});

/**
 * ── 复盘留下的一条观察，暂时**不**动手 ─────────────────────────────────
 *
 * 四份页面态现在是这样：
 *
 *     filterState   Record<区块id, {...}>     键是**筛选区块自己**的 id
 *     columnState   Record<区块id, {...}>     键是**目标表格**的 id
 *     selection     { rowIds: Record<实体, string[]> }   键是实体
 *     focus         Record<实体, string>                  键是实体
 *
 * 两套键并存（区块 id / 实体名），而且同样是"按区块 id"，filterState 存的是
 * 源、columnState 存的是目标。这看着像该统一，但**现在统一是错的**：
 *
 * - 按实体存是对的那两个（选中、聚焦），本来就是实体级概念——一页两张表
 *   绑同一个实体时，选中态本来就该共享。
 * - 按区块存的那两个，源/目标的区别是真实的：一个筛选条可以筛两张表
 *   （一对多），一张表的列设置只属于它自己（一对一）。
 *
 * 硬合成一个 `Record<key, unknown>` 只会把这些区别抹平，然后在每个读的地方
 * 重新判一次。等到出现**第三个**按目标存的状态、或者真的需要跨实体共享选中
 * 态时，再回来看。阶段③的触发条件是"真的看到重复"，这里看到的是**四份各不
 * 相同的东西长得有点像**——那不是重复。
 */

/**
 * 筛选**真的作用到区块上**了吗（2026-08-08，接线台逮到的）。
 *
 * 上面那两条钉的是"prop 传了"和"reducer 没吞"。这条钉的是第三种漏法，也是
 * 藏得最深的一种：prop 传了、reducer 也对，但**区块拿到的是全量行**。
 *
 * `applyPageFilter` 算出来的 `rows` 只喂给内置骨架那张表；区块拿的是
 * `state.entities`。于是 FilterBar / StatusTabs / TagFilterRow / SearchBox
 * 连着 DataTable 时，勾了、敲了，表一动不动——**从一开始就没接通**，
 * 不是这次新通道的问题。
 */
describe("筛选真的收窄了区块看到的行", () => {
  it("区块按 targets 拿自己那一份行，不是全量", () => {
    expect(
      runtime,
      "区块还在直接吃 state.entities —— 筛选作用不到它们身上"
    ).toContain("entityRows={rowsForBlockOf(block.id)}");
    expect(runtime).toContain("const rowsForBlockOf");
  });

  it("判据是「谁在筛我」，不是页面上有筛选就一律筛", () => {
    const start = runtime.indexOf("const rowsForBlockOf");
    const body = runtime.slice(start, start + 700);
    expect(body).toContain("targets as string[] | undefined)?.includes(blockId)");
    // 没人筛它的区块拿全量，不该被别的表的筛选连累
    expect(body).toContain("if (!applies) return state.entities;");
  });
});

/**
 * 页面级管道（2026-08-08，列表页归属三步走的第①步）。
 *
 * 新建表单 / 行详情 / 演示数据徽标这三样，此前**长在固定骨架身上**：骨架自己
 * 调 setFormOpen / setDetailRow，积木那条路想干同一件事没有入口——于是积木
 * 永远只能"显示"，不能"打开点什么"。
 *
 * 这一步把它们摘成整页共用的服务。分层照 nocobase 的 ActionContext /
 * ActionContainer：**容器（drawer/modal/page）由页面按设备决定，不由触发它的
 * 那个组件决定**；积木只说"打开这条记录"。
 */
describe("页面级管道：骨架和积木走同一条", () => {
  it("三条管道都收在一处，不再散在各调用点", () => {
    expect(runtime).toContain("const pagePipes");
    for (const pipe of ["openCreate", "openRecord", "openRecordById"]) {
      expect(runtime, `管道 ${pipe} 不见了`).toContain(pipe);
    }
  });

  it("**骨架不再自己 setState** —— 它跟积木用的是同一条", () => {
    const start = runtime.indexOf("<LazyProWorkbenchSurface");
    const body = runtime.slice(start, runtime.indexOf("/>", start));
    expect(body, "骨架的新建没走管道").toContain("onCreate={pagePipes.openCreate}");
    expect(body, "骨架的行点击没走管道").toContain("onOpenRow={pagePipes.openRecord}");
  });

  it("积木的 createRequest / editRequest 接进了管道", () => {
    const start = runtime.indexOf("const handleBlockAction");
    const body = runtime.slice(start, start + 2200);
    expect(body).toContain('actionId === "createRequest"');
    expect(body).toContain("pagePipes.openCreate()");
    expect(body).toContain('actionId === "editRequest"');
    expect(body).toContain("pagePipes.openRecordById(rowId)");
  });

  it("**rowSelect 只聚焦，不弹抽屉** —— 页面上可能已经摆了详情区块", () => {
    const start = runtime.indexOf('if (actionId === "rowSelect")');
    const body = runtime.slice(start, start + 420);
    expect(body).toContain("setFocus");
    expect(body, "rowSelect 弹了抽屉 —— 那就跟同页的 RecordDetail 做了两遍同一件事")
      .not.toContain("openRecord");
  });

  it("演示数据徽标抽成了独立节点", () => {
    expect(runtime).toContain("const seedNotice");
    // 抽出来之后不该还有第二份内联的
    expect(
      (runtime.match(/data-testid="app-runtime-seed-tag"/g) ?? []).length,
      "徽标出现了不止一处 —— 抽出来的意义就是只剩一份"
    ).toBe(1);
  });
});

/**
 * 翻转默认（2026-08-08，三步走的第②步）。
 *
 * **声明了 blocks 就用积木，没声明才回落骨架。** 骨架从"拥有者"变回"兜底"。
 *
 * 翻之前是反的：桌面档的 workbench/wizard 页一律交给内置 ProTable 骨架，积木
 * 只在 monitor/dashboard 上摆出来——列表页上的积木一个都不上屏。而给模型的
 * prompt 里那十套「参考排布」有三套推荐 DataTable 放 main，模型照做、门禁放行、
 * 运行时又扔掉：我们在教模型生成一个必定被丢掉的东西。
 */
describe("列表页归属：声明了积木就归积木", () => {
  it("判据是「声明了没有」，不是「页面形态是什么」", () => {
    expect(runtime).toContain("const blocksOwnPage");
    const start = runtime.indexOf("const blocksOwnPage");
    const body = runtime.slice(start, start + 200);
    expect(body).toContain("declaredBlocks.length > 0");
  });

  it("声明了积木就不再走 ProTable 骨架", () => {
    const start = runtime.indexOf("const usesProWorkbench");
    const body = runtime.slice(start, runtime.indexOf(");", start));
    expect(body, "翻转没落到 usesProWorkbench 上").toContain("!blocksOwnPage");
  });

  it("**没有展示记录的积木时，内置表格补回来** —— 兜底比纯粹重要", () => {
    expect(runtime).toContain("blocksOwnPage && blocksCoverData ? undefined : pageDataView");
  });

  it("兜底判据用 capability 不用 family —— 这条踩过", () => {
    // 第一版写的是 family === "data"，台子上当场露馅：MetricGrid 的 family
    // 就是 data（它自己取数、能独立存在），于是"只声明了一个指标卡"的页面被
    // 判成"记录已经有人展示了"，表格没补回来，整页只剩一张卡。
    // family 回答"能不能独立存在"，capability 才回答"展示的是什么"。
    const start = runtime.indexOf("const blocksCoverData");
    const body = runtime.slice(start, start + 320);
    expect(body).toContain('EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE[b.type] === "entityRows"');
    expect(body, "又用回 family 了").not.toContain("FAMILY_BY_TYPE");
  });

  it("兜底判据还要看**区域** —— 页头小字/窄栏替代不了主区的行列表", () => {
    /**
     * 同一个 bug 的第三次变体（2026-08-11 线上截图）：「宠物成长看板」主区
     * **一片空白**（约 400px 高），卡片在、内容没有。
     *
     * capability 那一维修对了，但少了区域这一维。目录里有一批 entityRows 区块
     * 物理上进不了 main：
     *
     *     HeaderEntitySummary / HeaderProgressSummary  regions=headerContent
     *     AlertRoutingPolicy                           regions=aside,supplement
     *     RecordComparePanel                           regions=supplement,overlay
     *
     * 只声明了「页头说明」这种，就被判成"记录已经有人展示了"，内置表格不补回来。
     * 放在右侧窄栏的 RecordDetail 同理——它显示的是**一条**记录。
     *
     * 所以判据要求区块落在正文带的全宽区域（main / supplement）。
     */
    const start = runtime.indexOf("const coveringBlockIds");
    expect(start, "区域那一维不见了").toBeGreaterThan(-1);
    const body = runtime.slice(start, start + 400);
    expect(body, "没取 main").toContain("page.layout.main");
    expect(body, "没取 supplement").toContain("page.layout.supplement");
    // aside / headerContent 不算覆盖——它们替代不了行列表
    expect(body, "把窄栏也算成覆盖了").not.toContain("page.layout.aside");
    expect(body, "把页头小字也算成覆盖了").not.toContain("headerContent ??");
    // 没声明 layout 时全部区块都在 main，那种情况按全部算
    expect(runtime).toContain("coveringBlockIds === null || coveringBlockIds.has(b.id)");
  });

  it("「绑主实体的 DataTable 一律摘掉」那条规矩只在骨架还在时生效", () => {
    // 翻转之后内置表格根本不渲染，那时候这个 DataTable 就是这一页唯一的表，
    // 再摘掉页面直接空了。
    const i = runtime.indexOf('b.type === "DataTable" &&\n                page.entityId');
    expect(i, "找不到那条摘除规则").toBeGreaterThan(-1);
    expect(runtime.slice(i - 120, i)).toContain("!blocksOwnPage");
  });

  it("目录派生的两张表都在，且没有手抄", () => {
    expect(registry).toContain("EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE");
    expect(registry).toContain("EXPERIENCE_BLOCK_FAMILY_BY_TYPE");
    // 两张表都必须从目录 map 出来，不许写死字面量
    for (const name of ["CAPABILITY", "FAMILY"]) {
      const start = registry.indexOf(`EXPERIENCE_BLOCK_${name}_BY_TYPE: Readonly`);
      const body = registry.slice(start, start + 400);
      expect(body, `${name} 表不是从目录派生的`).toContain(
        "EXPERIENCE_BLOCK_CATALOG.blocks.map"
      );
    }
  });
});

/**
 * 收掉重复的列设置（2026-08-08，三步走的第③步）。
 *
 * 第②步翻转默认之后，声明了积木的页面**根本不渲染内置表格**。而那个齿轮改的
 * 是 tableColPrefs → page.columns → 内置表格的列——于是它不只是跟
 * ColumnSettingPanel 重复，它是**完全失效的**：点开、勾掉一列，屏幕上什么都
 * 不会变。这是第②步顺手造出来的，不是历史遗留。
 *
 * 接线台实测（三页并排，收之前）：
 *   积木档  齿轮 1 + ColumnSettingPanel 1   ← 重复，且齿轮无效
 *   兜底档  齿轮 1（内置表格在，它是唯一的）
 *   骨架档  ProTable 自带的 options.setting
 * 收之后积木档齿轮变 0，另外两档不动。
 */
describe("列设置只留一个", () => {
  it("判据是「内置表格在不在屏幕上」，不是「有没有 ColumnSettingPanel」", () => {
    // 它 governs 谁，就跟着谁出现。有 ColumnSettingPanel 但内置表格也在的页面
    // （两张表各归各的）不该被误伤。
    expect(runtime).toContain("const builtInTableOnScreen");
    const start = runtime.indexOf("const builtInTableOnScreen");
    expect(runtime.slice(start, start + 120)).toContain(
      "!(blocksOwnPage && blocksCoverData)"
    );
  });

  it("齿轮跟着内置表格走", () => {
    const start = runtime.indexOf("const columnSettings");
    const body = runtime.slice(start, start + 160);
    expect(body, "齿轮没接上那个判据 —— 积木页会留一个点了没反应的齿轮")
      .toContain("builtInTableOnScreen");
  });

  it("**两份列状态故意不合并** —— 记在这里免得以后有人为了对称去合", () => {
    // tableColPrefs 按页面 id 存（内置表格没有区块 id），columnState 按目标
    // 区块 id 存。合并要先给内置表格编一个假 id，那是为对称而对称。
    expect(runtime).toContain("tableColPrefs");
    expect(runtime).toContain("columnState");
    const note = runtime.slice(
      runtime.indexOf("两份列状态"),
      runtime.indexOf("两份列状态") + 160
    );
    expect(note, "那条「不合并」的理由被删了").toContain("不合并");
  });
});

/**
 * 字段声明那条线（2026-08-08，阶段④）。
 *
 * 阶段④本来是"批量灌 amis"。量完供给发现那条路兑现不了区块（见
 * docs/区块建设-amis对照.md），但它照出了一件立刻能兑现的事：amis 把
 * input-rating / input-range / input-password / switch 各做成独立控件，
 * 一个字段该用哪个控件是**声明出来的**；我们这边声明早就有了
 * （type + format + options + refEntityId），零件也早就装着
 * （ProFormRate / ProFormSlider / ProFormSwitch / ProFormSegmented…全在
 * @ant-design/pro-components 里），**中间那根线没接**。
 *
 * 更要命的是判定：`field-value-type.ts` 已经是全站的单一判定表，读侧
 * （FieldValue）、内置表单（FieldEditor）、手机档（PhoneFormField）三处共读。
 * 区块的表单族是**第四处，还自己写了一套更差的**——枚举一律 Select、
 * boolean/ref/datetime 全掉进文本框兜底。这一组用例钉的就是"第四套没有回来"。
 */
describe("字段声明要真的走到表单控件", () => {
  it("判定走那张共用表，这里不许自己写 if", () => {
    // 这条是整组的要害。自己判 = 又一次漂移，而漂移的表现是"读的时候是进度
    // 条、写的时候是裸数字框"，界面上两处分开看都正常。
    const start = registry.indexOf("function formItemFor(");
    const body = registry.slice(start, registry.indexOf("\n}\n", start));
    expect(body, "表单族不读那张判定表了").toContain("resolveValueType(");
    expect(body, "又开始自己按 format 判了").not.toMatch(/format === "/);
    expect(body, "又开始自己按 type 判了").not.toMatch(/type === "/);
  });

  it("判定表给得出的每一档都得有零件接着 —— 少一档就掉进文本框", () => {
    const start = registry.indexOf("function formItemFor(");
    const body = registry.slice(start, registry.indexOf("\n}\n", start));
    // 档位清单从判定表的类型定义里读，不在这里手抄：那边加一档，这里自动要求。
    const vt = read("../live-runtime/field-value-type.ts");
    const decl = vt.slice(
      vt.indexOf("export type RuntimeValueType ="),
      vt.indexOf(";", vt.indexOf("export type RuntimeValueType ="))
    );
    const cases = [...decl.matchAll(/\|\s*"(\w+)"/g)].map(m => m[1]);
    expect(cases.length, "档位清单没读出来").toBeGreaterThan(10);
    for (const c of cases)
      expect(body, `档位 ${c} 没有对应控件，会掉进兜底文本框`).toContain(`case "${c}":`);
  });

  it("两个宿主都得开那扇门 —— 只开一个就是「预览好使、真应用不好使」", () => {
    // 这正是②阶段复盘抓到的形状：装配预览接齐了，真实运行时一个都没接，
    // 六个区块在真应用里全是死壳而渲染得完全正常。
    expect(runtime, "真实运行时没接字段声明").toContain("fieldSchemaOf,");
    expect(library, "装配预览没接字段声明").toContain("fieldSchemaOf={fieldSchemaOf}");
  });

  it("运行时那扇门要归一化，不许把原始声明直接扔进渲染器", () => {
    // 格式与类型不匹配的声明要丢掉（number 声明 masked、string 声明 money
    // 都是非法的）。不归一化的话，一个坏声明就能把手机号字段画成金额框。
    const start = runtime.indexOf("const fieldSchemaOf");
    expect(start, "运行时不查字段声明了？").toBeGreaterThan(-1);
    const body = runtime.slice(start, start + 900);
    expect(body, "format 没过归一化").toContain("normalizeFieldFormat");
    expect(body, "options 没过归一化").toContain("normalizeFieldOptions");
  });

  it("对照台六种格式都得有承载字段 —— 看不见就等于没接上", () => {
    // ①c 上吃过一次亏：六种字段语义写完了，但没有一个字段用得上，
    // 全是死代码而屏幕上看不出来。
    const start = library.indexOf("const FIELD_FORMAT");
    expect(start, "对照台没有格式夹具了？").toBeGreaterThan(-1);
    const body = library.slice(start, library.indexOf("};", start));
    for (const fmt of ["money", "percent", "progress", "score", "rating", "masked"])
      expect(body, `对照台上没有任何字段声明成 ${fmt}`).toContain(`"${fmt}"`);
  });

  /**
   * 选择态**只有 DataTable 一个供给方** —— 别把它拆了。
   *
   * ## 这条是怎么来的（2026-08-11）
   *
   * `pageKinds` 推导脚本第二层跑出来的一条建议是「BatchActionBar 不该上看板页，
   * 因为看板没有多行勾选」。查下来那个**观察是对的，结论是错的**：
   *
   *   · `KanbanBoard`（PageViews.tsx:46）只收 rows/statusField/cardFields/onOpenRow，
   *     确实没有勾选；
   *   · 但 `DataTable` 允许上看板页，而它**就是**选择态的供给方；
   *   · 而且内置表格（AppRuntimeScreen 里那几处 Table）一个都没有 rowSelection
   *     —— 所以 workbench 页同样只在"页面另外声明了 DataTable"时才有勾选。
   *
   * 也就是说这是**区块与区块之间的依赖**，不是区块与页型之间的。narrowing
   * `pageKinds` 治不了它，只会把问题挪个地方。`BatchActionBar` 的出处注释
   * 早写明了这层依赖（"先给 DataTable 接上 rowSelection…再建这个区块"），
   * 但目录里没有任何字段能表达"我需要一个提供选择态的同伴"。
   *
   * 所以这里先钉住那条**唯一的供给链**：DataTable 的 rowSelection 一旦被摘掉，
   * BatchActionBar 就会退化成一句永远的「勾选左侧的行」——那正是②阶段复盘
   * 抓到的形状（渲染得完全正常，只是点不动）。
   */
  it("选择态只有 DataTable 供给，摘了它 BatchActionBar 就静默变死壳", () => {
    // ① DataTable 必须真的把选中键回传给宿主
    const dt = registry.indexOf("const DataTableRenderer");
    expect(dt, "DataTableRenderer 改名了？").toBeGreaterThan(-1);
    const dtBody = registry.slice(dt, registry.indexOf("\n};", dt));
    expect(dtBody, "DataTable 不再提供勾选列了 —— BatchActionBar 会变死壳").toContain(
      "rowSelection"
    );
    expect(dtBody, "DataTable 勾了不回传，选择态到不了别的区块").toContain(
      "onSelectionChange("
    );

    // ② 而且它是**唯一**的供给方。多出第二个供给方本身是好事，
    //    但这条断言会红，提醒回来把上面那段说明改掉。
    //
    // 只数**调用点**（`onSelectionChange(` / `onSelectionChange?.(`），不数类型
    // 声明里的 `onSelectionChange?: (`。当前恰好两处：DataTable 里写入选中键，
    // BatchActionBar 里的「清空」把它清成空数组（那是消费方在复位，不是供给方）。
    const callSites = [
      ...registry.matchAll(/onSelectionChange(\?\.)?\(/g),
    ].map(m => m.index ?? 0);
    expect(
      callSites.length,
      "onSelectionChange 的调用点数变了 —— 确认是不是多了供给方，并更新本用例说明"
    ).toBe(2);
    // 其中"真正写入非空选中键"的那一处必须在 DataTable 里
    expect(
      callSites.some(i => i > dt && i < registry.indexOf("\n};", dt)),
      "写入选中键的调用点不在 DataTableRenderer 里了"
    ).toBe(true);

    // ③ 内置表格没有勾选 —— 这正是"必须有 DataTable 同伴"的原因
    expect(
      runtime.includes("rowSelection"),
      "内置表格接上勾选了？那 BatchActionBar 就不再依赖 DataTable 同伴，请更新说明"
    ).toBe(false);
  });
});
