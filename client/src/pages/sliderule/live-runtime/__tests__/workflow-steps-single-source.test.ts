/**
 * 一页只许有一条流程步骤条（2026-08-11，线上截图 #8）。
 *
 * ## 这条护栏是怎么来的
 *
 * 用户的截图里，同一个向导页上叠着**两条流程步骤条**，而且两条各说一套：
 *
 *   · 上面那条是宿主内置的（AppRuntimeScreen，`kind === "wizard"` 时无条件画），
 *     按 `workflow.nodes` 的**声明数组顺序**铺，于是「拒绝兑换」成了正向第 4 步
 *   · 下面那条是页面声明的 `WorkflowTimeline` 区块，读 transitions 走图，
 *     驳回归到"分支出口"里
 *
 * 同一份 workflow 画两遍已经是问题，两遍还不一致就更没法看。所以：
 *
 *   ① 派生逻辑收到 workflow-main-path.ts 一份，两处共用
 *   ② 积木已经画了流程，宿主内置那条就让位（跟 freeformOverview 出现时固定
 *      KPI 骨架让位是同一个规矩：**同一份内容不许在一屏里出现两遍**）
 *
 * ## 为什么要扫源码
 *
 * ②的判据是 `EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW`，一张**手写**的表——
 * "这个渲染器有没有读 workflow prop"在运行时问不出来。手写表会漂移：以后有人
 * 新写一个读 workflow 的区块、忘了往表里加，两条步骤条就又叠回来，而且没有任何
 * 东西会红。所以这里把真相从源码里算出来（谁解构了 `workflow`），跟那张表比对。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW } from "../block-registry";
import { deriveWorkflowMainPath } from "../workflow-main-path";

const read = (name: string) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(
    /\r\n?/g,
    "\n"
  );

const registry = read("block-registry.tsx");
const screen = read("AppRuntimeScreen.tsx");

describe("流程步骤条只有一个真相源", () => {
  it("读了 workflow prop 的渲染器，必须一个不少地登记在名单里", () => {
    // 1. 找出所有解构了 workflow 的渲染器函数名
    //    形如 `const XxxRenderer: ExperienceBlockRenderer = ({ block, workflow, … })`
    const consumers = new Set<string>();
    const declPattern =
      /const\s+(\w+):\s*ExperienceBlockRenderer\s*=\s*\(\s*\{([^}]*)\}/g;
    for (const m of registry.matchAll(declPattern)) {
      const [, name, destructured] = m;
      if (/\bworkflow\b/.test(destructured)) consumers.add(name);
    }
    expect(
      consumers.size,
      "一个都没扫到 = 匹配规则跟源码写法脱节了，这条护栏在空转"
    ).toBeGreaterThan(0);

    // 2. 反查回区块 type：渲染表里 `Type: { render: XxxRenderer, … }`
    const declared = new Set<string>();
    for (const name of consumers) {
      const uses = registry.matchAll(
        new RegExp(`(\\w+):\\s*\\{[^{}]*render:\\s*${name}\\b`, "g")
      );
      for (const u of uses) declared.add(u[1]);
    }

    expect(
      [...declared].sort(),
      "这些区块的渲染器读了 workflow，却没登记进 " +
        "EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW——宿主不知道流程已经被画过，" +
        "向导页上会叠出第二条步骤条"
    ).toEqual([...EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW].sort());
  });

  it("宿主内置的向导步骤条真的受名单约束，而不是无条件画", () => {
    // 桌面档和手机档各一处，两处都必须带 !blocksDrawWorkflow
    const guarded = screen.match(/!blocksDrawWorkflow/g) ?? [];
    expect(
      guarded.length,
      "内置步骤条有两处（桌面 Steps + phoneSectionData.steps），都要让位"
    ).toBe(2);
    expect(screen).toMatch(
      /blocksDrawWorkflow\s*=\s*declaredBlocks\.some[\s\S]{0,120}EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW/
    );
  });

  it("两处内置步骤条都走主链路派生，不许退回按声明序铺", () => {
    // 反向断言：`workflow.nodes` 直接 .slice().map() 成步骤条是被修掉的写法，
    // 它把驳回节点铺成正向的下一步（跟 WorkflowTimeline 修过的是同一个 bug）。
    expect(
      screen,
      "内置步骤条又在按声明数组顺序铺了——改回 wizardMainPath"
    ).not.toMatch(/workflow\?\.nodes\s*\?\?\s*\[\]\)\.slice\(/);
    expect((screen.match(/wizardMainPath\.slice\(/g) ?? []).length).toBe(2);
    expect(screen).toContain("deriveWorkflowMainPath");
    // 区块那侧也得是共用的那份，不能自己再抄一遍
    expect(registry).toContain("deriveWorkflowMainPath(");
  });
});

/**
 * 内置步骤条没有渲染测试可搭（AppRuntimeScreen 太大，本目录一贯用源码扫描），
 * 所以直接钉住它现在读的那个派生函数：喂截图里那份流程，驳回不许进步骤条。
 */
describe("内置步骤条读到的顺序（截图那份流程）", () => {
  // 复刻线上那个兑换流程：驳回边声明在正常边**之前**，正是原来按声明序铺时
  // 「拒绝兑换」跑到第 4 步的成因。
  const NODES = [
    { id: "apply", name: "提交兑换" },
    { id: "review", name: "资格审核" },
    { id: "grant", name: "确认发放" },
    { id: "rejected", name: "拒绝兑换" },
    { id: "returned", name: "退回调整" },
  ];
  const TRANSITIONS = [
    { from: "apply", to: "rejected", condition: "资料不全" },
    { from: "apply", to: "review" },
    { from: "review", to: "returned", condition: "积分不足" },
    { from: "review", to: "grant", condition: "积分充足" },
    { from: "rejected", to: "apply", condition: "补齐资料后重提" },
  ];

  it("主链路只有正向三步，驳回/退回归到分支出口", () => {
    const { mainPath, branchExits } = deriveWorkflowMainPath(NODES, TRANSITIONS);
    expect(mainPath.map(n => n.name)).toEqual([
      "提交兑换",
      "资格审核",
      "确认发放",
    ]);
    expect(branchExits.map(b => b.node.name)).toEqual(["拒绝兑换", "退回调整"]);
    expect(branchExits[0].reasons).toEqual(["资料不全"]);
  });

  it("步骤上的条件是「继续往下走」那条，不是驳回那条", () => {
    const { advanceCondition } = deriveWorkflowMainPath(NODES, TRANSITIONS);
    // apply 有两条出边，驳回那条声明在前——取错了就会在第 1 步下面写「资料不全」
    expect(advanceCondition.get("apply")).toBeUndefined(); // 继续的那条是无条件边
    expect(advanceCondition.get("review")).toBe("积分充足");
  });
});
