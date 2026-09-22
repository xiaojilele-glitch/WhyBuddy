/**
 * 后续建议 chips：**有真的就显示真的，没有才退回通用；一条都不许编。**
 *
 * ## 病（2026-09-14，用户对照 Manus 截图第 3 件）
 *
 * Manus 跑完给两条针对刚做出来的东西的下一步，点一下接着派工。我们这边
 * `deriveComposerHintChips` 返回的是写死的四条——「路线对比一下」
 * 「澄清权限边界」「分析安全风险」「生成可行性报告」——跟这一轮做了什么
 * 毫无关系，所以每张截图里都是同样那两个。
 *
 * ## 夹具是真机原样载荷（§一之二）
 *
 * 下面 `REAL_TODO` 是从真机会话 `sr-20260914051427-QYYWZ17DHH` 的
 * `state.controlTodo` 抄下来的，**一个字没改**。自己拼一个干净的清单，
 * 就测不出真机上那些「带工具名的待办」「已完成项混在中间」的形态。
 */
import { describe, expect, it } from "vitest";
import { MAX_NEXT_STEP_CHIPS, deriveNextStepChips } from "../next-step-chips";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

/** 真机 `sr-20260914051427-QYYWZ17DHH` 的 controlTodo，原样。 */
const REAL_TODO = [
  { id: "1", status: "completed", content: "创建 react-vite-tasks 工程并读取源码" },
  { id: "2", status: "in_progress", content: "补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表" },
  { id: "3", status: "pending", content: "核对认证与用户隔离的待办 API / SQLite" },
  { id: "4", status: "pending", content: "project_exec 跑 check/build/test 并修复" },
  { id: "5", status: "pending", content: "保留运行后申请 project_verify 并读取验证结果" },
];

const state = (over: Partial<V5SessionState> = {}) => over as V5SessionState;

describe("从模型自己的待办里取下一步", () => {
  it("正向：真机那份清单给出正在做的那条 + 后面待办", () => {
    const chips = deriveNextStepChips(state({ controlTodo: REAL_TODO }));
    expect(chips).toHaveLength(MAX_NEXT_STEP_CHIPS);
    // in_progress 排第一：那是它此刻正在干的下一步
    expect(chips[0]).toContain("补丁前端");
    expect(chips[1]).toContain("核对认证与用户隔离");
  });

  it("in_progress 要排到前面——哪怕它在清单里靠后", () => {
    // ⚠ 真机那份清单里 in_progress 本来就排在未完成项最前，**区分不出**
    //   有没有排序（2026-09-14 变异时逮到：把排序删掉照样绿）。
    //   这条夹具故意把它放到 pending 后面，排序坏了立刻红。
    const chips = deriveNextStepChips(state({
      controlTodo: [
        { id: "1", status: "pending", content: "后面才做的" },
        { id: "2", status: "pending", content: "也是后面做的" },
        { id: "3", status: "in_progress", content: "此刻正在干的" },
      ],
    }));
    expect(chips[0]).toBe("此刻正在干的");
  });

  it("反向：做完的不许再当建议", () => {
    const chips = deriveNextStepChips(state({ controlTodo: REAL_TODO }));
    expect(chips.join("|")).not.toContain("创建 react-vite-tasks 工程并读取源码");
  });

  it("反向：一条待办都没有就返回空，由调用方兜底——不许自己凑一条", () => {
    expect(deriveNextStepChips(state({ controlTodo: [] }))).toEqual([]);
    expect(deriveNextStepChips(state({}))).toEqual([]);
    expect(deriveNextStepChips(null)).toEqual([]);
    expect(deriveNextStepChips(undefined)).toEqual([]);
    // 全做完了也没有下一步
    expect(deriveNextStepChips(state({
      controlTodo: REAL_TODO.map(t => ({ ...t, status: "completed" })),
    }))).toEqual([]);
  });

  it("反向：状态用白名单，不用「!= completed」", () => {
    // 将来多一个 cancelled，黑名单写法会把它当待办显示出来。
    const chips = deriveNextStepChips(state({
      controlTodo: [
        { id: "a", status: "cancelled", content: "已取消的活儿" },
        { id: "b", status: "pending", content: "还要做的活儿" },
      ],
    }));
    expect(chips).toEqual(["还要做的活儿"]);
  });

  it("反向：坏数据不许崩", () => {
    expect(deriveNextStepChips(state({ controlTodo: "不是数组" as never }))).toEqual([]);
    expect(deriveNextStepChips(state({
      controlTodo: [null as never, { id: "x" }, { content: "   " }, { content: "有效" }],
    }))).toEqual(["有效"]);
  });

  it("重复的去掉；上限只防脱缰，不再为 pill 宽度截断", () => {
    // ⚠ 2026-09-14 上限从 40 放宽到 80：建议从输入条上的小 pill 改成了
    //   结果卡下面的**整行**（NextStepSuggestions），整行的意义就是把话说完。
    //   40 会把真机那条「联调 check/build/test，确保 synchronized」截掉。
    const long = "补".repeat(300);
    const chips = deriveNextStepChips(state({
      controlTodo: [
        { status: "pending", content: long },
        { status: "pending", content: "同一条" },
        { status: "pending", content: "同一条" },
      ],
    }));
    expect(chips[0].length).toBeLessThanOrEqual(80);
    expect(chips[0].endsWith("…")).toBe(true);
    expect(chips.filter(c => c === "同一条")).toHaveLength(1);
  });
});

/*
 * ⚠ 2026-09-15 这里原有一块「输入条与建议行各管各的」，三条判据都在调
 *   `deriveComposerHintChips`——输入条那排通用提示的生成器。对照 Manus，
 *   那排词跟这一轮做了什么毫无关系，整排下线了（SlideRule 传 hintChips={[]}），
 *   模块也随之删除，所以那三条一并去掉。
 *
 *   原意「两个 surface 不许互相顶替」没有丢：下面「通电」那一块正面钉着
 *   hintChips={[]} 与 `not.toContain("deriveComposerHintChips")`，
 *   把提示再接回去当场红。
 */
describe("通电：真的接在输入条上（§3）", () => {
  it("SlideRule 把 hintChips 喂给 ComposerDock，且 chip 可点", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

    expect(read("client/src/pages/SlideRule.tsx")).toContain("hintChips={[]}");
    // ⚠ 2026-09-14：输入框上方芯片整排卸了。函数还在，活路径喂空。
    //   变异：再把 deriveComposerHintChips 接回去必红。
    const page = read("client/src/pages/SlideRule.tsx");
    expect(page).not.toContain("deriveComposerHintChips");
    expect(page).toContain("statusPill={null}");
    const dock = read("client/src/pages/sliderule/ComposerDock.tsx");
    expect(dock).toContain('data-testid="sliderule-composer-hint-chip"');
    // 点了是填进输入框可再编辑（现有契约），不是直接发出去。
    expect(dock).toMatch(/onClick=\{\(\) => \{\s*setInput\(text\)/);
  });

  it("TS 侧必须有 controlTodo 字段声明，不是只在注释里出现", async () => {
    // ⚠ 盯**字段声明**：这个名字在注释里也写着，光 `includes` 在字段被删掉
    //   之后照样绿（CLAUDE.md §2，本会话已栽过一次）。
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ts = fs.readFileSync(
      path.resolve(process.cwd(), "shared/blueprint/v5-reasoning-state.ts"), "utf8");
    expect(ts).toMatch(/^\s*controlTodo\??\s*:/m);
  });
});
