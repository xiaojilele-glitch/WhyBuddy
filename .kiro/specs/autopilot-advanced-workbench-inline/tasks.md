# 任务清单：Autopilot 底部高级资产工作台折叠区删除 + 右栏内联承接

本 spec 的改动严格局限于：

- `client/src/pages/autopilot/AutopilotRoutePage.tsx`
- `client/src/pages/autopilot/AutopilotRoutePage.test.tsx`
- 新增 `client/src/pages/autopilot/right-rail/__tests__/fabric-dispatch.property.test.tsx`

所有任务完成后：

- `node --run check` 通过，不扩大现有 TypeScript 基线错误数
- `npm exec vitest run client/src/pages/autopilot` 通过（覆盖 `AutopilotRoutePage.test.tsx` 新旧断言）
- `npm exec vitest run client/src/pages/autopilot/right-rail` 通过（Spec 1/2 旧 PBT + Spec 3 新增 fabric-dispatch PBT）
- `npm exec vitest run client/src/pages/specs` 通过（`/specs` 页面不受影响）

---

- [x] 1. 删除底部 Advanced_Workbenches_Fold 及其依赖
  - 在 `AutopilotRoutePage.tsx` 中删除包含 `data-testid="autopilot-advanced-workbenches"` 的 `<details>` 节点（含 `<summary>` 与内嵌 `<BlueprintProgressPanel ... autoLoad={false} ...>`）
  - 删除 `const blueprintPanelKey = ...` 这一行（仅被 fold 使用）
  - 删除顶部 `import BlueprintProgressPanel from "../specs/BlueprintProgressPanel";`，确认删除后 `BlueprintProgressPanel` 不再被该文件引用
  - grep 确认 `Layers3` 图标（原用于 `<summary>`）是否被文件内其他处引用；未被引用则从 `lucide-react` import 中一并移除
  - grep 确认 `autopilot-advanced-workbenches` 字符串已不再出现在 `AutopilotRoutePage.tsx` 中
  - 通过 `node --run check` 验证无类型错误
  - _需求：Requirement 1.1、1.2、1.3、1.5、Requirement 8.1_

- [x] 2. 在 `AutopilotWorkflowRail` 的 fabric 分支接入 `<AutopilotRightRail>`
  - 在 `AutopilotRoutePage.tsx` 顶部添加 `import { AutopilotRightRail, resolveRailSubStage } from "./right-rail";`
  - 定位到 `AutopilotWorkflowRail` 内部 `case "fabric":` 分支
  - 保留 `AutopilotSpecTreeHandoffPanel`（作为摘要 + 次级 `/specs` 链接承载）的渲染段，保留 `selection` 为空时的「先完成路线选择，AgentCrewFabric 才会展开」提示
  - 移除该分支中对 `<AgentCrewSummary ... />` 的调用（其职责由 Spec 2 的 `<AgentCrewFabricPanel>` 承接）
  - 在 `AutopilotSpecTreeHandoffPanel` 之后新增 `<AutopilotRightRail>` 的渲染，props 精确按 design.md 中的「Props 线路图」表格传入：
    - `jobId={latestJob?.id ?? ""}`
    - `currentStage="fabric"`
    - `currentSubStage={resolveRailSubStage({ currentStage: "fabric", job: latestJob, selection, specTree, agentCrew })}`
    - `job={latestJob}`、`routeSet={routeSet}`、`selection={selection}`、`specTree={specTree}`
    - `agentCrew={agentCrew}`、`capabilities={capabilities}`、`capabilityInvocations={capabilityInvocations}`、`capabilityEvidence={capabilityEvidence}`
    - `effectPreviews={effectPreviews}`、`locale={locale}`
    - `onSubStageChange={() => {}}`
  - 不在 `AutopilotWorkflowRail` 签名中新增 props（所需字段已全部存在）
  - 确认 `AgentCrewSummary` 组件若无其他调用者，从本文件中一并删除；若有其他调用者，仅移除本分支调用
  - 通过 `node --run check` 验证
  - _需求：Requirement 2.1、2.2、2.3、2.4、2.5、2.6、2.7、2.8、Requirement 6.1、6.2、6.3_

- [x] 3. 将 `AutopilotSpecTreeHandoffPanel` 主 CTA 降级为次级文本链接
  - 定位到 `export function AutopilotSpecTreeHandoffPanel` 函数体内的 `<Button asChild ...>` 段落
  - 将 `<Button asChild className="... bg-slate-950 ... text-white ...">` 包裹的 `<a href={SPECS_PATH} data-testid="autopilot-open-specs-link">进入推导工作台 / Open deduction workbench <ArrowRight /></a>` 改为次级文本链接：
    ```tsx
    <a
      href={SPECS_PATH}
      data-testid="autopilot-open-specs-link"
      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 underline decoration-slate-300 decoration-dotted underline-offset-[3px] hover:text-slate-700 hover:decoration-slate-500"
    >
      {t(locale, "在独立工作台查看", "View in standalone workbench")}
      <Link2 className="size-3" aria-hidden="true" />
    </a>
    ```
  - 保留 `data-testid="autopilot-open-specs-link"` 与 `href={SPECS_PATH}`（= `/specs`）
  - 确认 `Link2` 图标已从 `lucide-react` import；若未 import，补充之；`ArrowRight` 若不再被本面板使用，视 grep 结果决定是否从本文件 imports 中移除
  - 若外层 `<div className="flex flex-wrap items-start justify-between gap-4">` 在链接宽度变小后出现布局奇怪，调整为 `<div className="flex flex-wrap items-start gap-4">` 或将链接挪到标题段落下方（不新增 testid，不改变 `autopilot-spec-tree-handoff` 外层容器）
  - 通过 `node --run check` 验证
  - _需求：Requirement 3.1、3.2、3.3、3.4、3.5_

- [x] 4. 更新 `AutopilotRoutePage.test.tsx` 断言
  - 删除以下断言（见 design.md 测试 Delta 表 T01–T05）：
    - `expect(markup).toContain('data-testid="autopilot-advanced-workbenches"')`
    - `expect(markup).toContain('data-testid="blueprint-progress-panel"')`
    - `expect(markup).toContain("Advanced asset workbenches")`
    - 中文 `"高级资产工作台"`、`"展开查看 SPEC、预演、提示词、能力桥和回放"` 相关 `toContain` 断言
    - 英文 `"Expand for SPEC, previews, prompts, capability bridge, and replay"` `toContain` 断言
  - 在 `AutopilotSpecTreeHandoffPanel` 相关测试中：
    - 保留 `expect(markup).toContain('href="/specs"')`
    - 将 `expect(markup).toContain("Open deduction workbench")` 替换为 `expect(markup).toContain("View in standalone workbench")`
    - 在中文 locale 场景下新增 `expect(markup).toContain("在独立工作台查看")`
    - 新增 `expect(markup).not.toContain("进入推导工作台")`（防回归）
  - 新增「fold removal snapshot」断言块（design.md E2）：
    ```ts
    it("no longer renders the advanced workbenches fold", () => {
      const markup = renderToStaticMarkup(<AutopilotRoutePage />);
      expect(markup).not.toContain('data-testid="autopilot-advanced-workbenches"');
      expect(markup).not.toContain('data-testid="blueprint-progress-panel"');
      expect(markup).not.toContain("高级资产工作台");
      expect(markup).not.toContain("Advanced asset workbenches");
    });
    ```
  - 新增 fabric 右栏承接断言（design.md T08）：直接以 `currentStage === "fabric"` 的 fixture 渲染 `<AutopilotRightRail>`，断言 `data-testid="autopilot-right-rail"`、`data-autopilot-stage="fabric"`、`data-autopilot-sub-stage="agent_crew_fabric"` 均出现在 markup 中
  - 通过 `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 验证
  - _需求：Requirement 8.4、Requirement 9.1、9.2、9.3、9.4、Requirement 10.3_

- [x] 5. **[Edge-case]** 新增路线选择不导航测试
  - 在 `client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 新增 `describe("selection → fabric")` 相关断言
  - 由于本仓库未集成 `@testing-library/react`（详见 `client/src/components/__tests__/*.test.ts` 注释），采用**结构性属性**而非用户交互模拟：静态读取 `AutopilotRoutePage.tsx` 源文件，断言文件中**不含**以下任一形式的导航 API 调用，从而从源头保证路线选择不会跳转：
    - `useNavigate`
    - `window.location.assign`
    - `window.location.replace`
    - `window.location.href = ...`
  - 结合 Task 4 的 `autopilot-right-rail` markup 断言，fabric 右栏挂载 + 无导航 API 两条属性共同覆盖 Requirement 4 的「选中路线后不跳转到 /specs」场景
  - 通过 `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 验证
  - _需求：Requirement 4.1、4.2、4.3、4.4、Requirement 10.2_

- [x] 6. **[PBT]** 新增 fabric dispatch consistency 属性测试
  - 新建 `client/src/pages/autopilot/right-rail/__tests__/fabric-dispatch.property.test.tsx`
  - 使用 `fast-check` 生成任意 `(job, selection, specTree, agentCrew)` 快照：
    - `job`: `null` 或 `{ id: string, stage: fc.constantFrom(...BLUEPRINT_GENERATION_STAGE_VALUES), ... }`（最小 fixture）
    - `selection`: `null` 或 `{ id, routeTitle }`
    - `specTree`: `null` 或 `{ id, nodes: [], documents: [] }`
    - `agentCrew`: `null` 或最小对象
  - 对每个生成的快照：
    - 调用 `const expected = resolveRailSubStage({ currentStage: "fabric", job, selection, specTree, agentCrew });`
    - 渲染 `<AutopilotRightRail currentStage="fabric" currentSubStage={expected} job={job} ... />`（其余 props 传入合法的空值：`routeSet={null}`, `capabilities={[]}`, `capabilityInvocations={[]}`, `capabilityEvidence={[]}`, `effectPreviews={[]}`, `locale="zh-CN"`, `onSubStageChange={() => {}}`, `jobId={job?.id ?? ""}`）
    - 断言：markup 中存在 `data-autopilot-sub-stage="${expected}"` 与 `data-sub-stage-placeholder="${expected}"`，并且激活的 sub-stage 节点带 `aria-current="step"`
  - 设置 `{ numRuns: 50 }`，控制测试耗时在 Spec 1 PBT 平均的 3x 以内
  - 通过 `npm exec vitest run client/src/pages/autopilot/right-rail` 验证
  - _需求：Requirement 10.1、Requirement 10.4、Requirement 10.5_

- [x] 7. 清理 `AutopilotRoutePage.tsx` 残留
  - grep `AgentCrewSummary`、`blueprintPanelKey`、`BlueprintProgressPanel`、`autopilot-advanced-workbenches`、`Advanced asset workbenches`、`高级资产工作台`、`Expand for SPEC`、`Open deduction workbench`、`进入推导工作台` 共 9 个关键词
  - 所有关键词在 `AutopilotRoutePage.tsx` 中的出现次数必须为 0
  - 若 `AgentCrewSummary` 组件定义仍保留在文件中但不再被使用，删除该组件定义
  - 检查文件底部 `// wt3 任务 3 注记` 等长注释段，若描述与本 spec 后的实际情况不符，同步更新或删除
  - 通过 `node --run check` 验证
  - _需求：Requirement 1.1–1.4、Requirement 8.1_

- [x] 8. 最终验收
  - `node --run check` 通过，不扩大现有 TypeScript 基线错误数（基线 107 保持）
  - `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 全部通过（8 tests，含新增 fold removal snapshot + selection → fabric 无导航结构性断言）
  - `npm exec vitest run client/src/pages/autopilot/right-rail` 全部通过（Spec 1/2 旧 45 tests + Spec 3 新增 fabric-dispatch PBT，共 46 tests）
  - `npm exec vitest run client/src/pages/specs` 全部通过（10 tests，验证 `/specs` 页面未被回归）
  - 人工回归（待桌面端手测）：打开 `/autopilot`，推进到 `fabric` 阶段，确认右列 400px 直接显示当前子阶段面板内容（不需要展开折叠区）；确认 `AutopilotSpecTreeHandoffPanel` 的「在独立工作台查看」为次级文本链接而非主按钮
  - 人工回归（待桌面端手测）：打开 `/specs?jobId=<已有 job>`，确认 `BlueprintProgressPanel` 行为与之前一致
  - 人工回归（待桌面端手测）：在 `/autopilot` 上选中一条路线，确认不跳转到 `/specs`
  - 确认 `git diff` 涉及文件集合严格符合 Requirement 11.1（只修改 `AutopilotRoutePage.tsx` / `AutopilotRoutePage.test.tsx`，新增 `fabric-dispatch.property.test.tsx`）
  - _需求：Requirement 5、Requirement 6.5、Requirement 8.2、8.3、Requirement 11.1、11.3、11.5_

---

## 任务执行边界

- 本 spec **不**修改 `client/src/pages/specs/BlueprintProgressPanel.tsx` —— 该文件在 Spec 2 完成后已经稳定，继续由 `/specs` 页面调用。
- 本 spec **不**修改 `client/src/pages/specs/SpecCenterPage.tsx`。
- 本 spec **不**修改 `client/src/pages/autopilot/right-rail/panels/*`(Spec 2 产物)。
- 本 spec **不**修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`、`types.ts`、`resolve-rail-sub-stage.ts`、`index.ts`（Spec 1 产物）—— 验证发现 Spec 1 scaffolding 已暴露 `data-testid="autopilot-right-rail"`、`data-autopilot-stage`、`data-autopilot-sub-stage` 与 `data-sub-stage-placeholder`，足够支撑 Task 4 / Task 6 的断言，无需任何扩展。
- 本 spec **不**修改后端 REST、Socket、`shared/blueprint/contracts.ts`、DTO。
- 本 spec **不**新增 feature flag、analytics 埋点、URL 参数、sticky pin、键盘快捷键、自动滚动 —— 这些由 Spec 5 承接。
- 本 spec **不**抽 hook、**不**合并 fetch —— 这些由 Spec 4 承接。
- 本 spec **不**触碰 4 个非-fabric stage 面板的内容（`input / clarification / routeset / selection`）。
- 本 spec **不**重命名任何组件、**不**移动 `BlueprintProgressPanel.tsx`。
