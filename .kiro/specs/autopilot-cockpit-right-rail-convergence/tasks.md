# 任务清单：Autopilot 驾驶舱右栏收敛

本 spec 仅落「契约 + 类型 + 最小 scaffolding + resolver + PBT」，不进行组件搬运、折叠区删除、数据层合并。所有代码变更集中在 `client/src/pages/autopilot/right-rail/` 目录，便于未来 Spec 2/3/4/5 增量推进或整目录回滚。

- [x] 1. 冻结 `AutopilotRightRailProps` 类型契约与子阶段枚举
  - 创建 `client/src/pages/autopilot/right-rail/types.ts`
  - 导出 `AutopilotTimelineStage`、`AutopilotRailSubStage`、`RAIL_SUB_STAGE_ORDER`、`AutopilotRightRailProps`、`ResolveRailSubStageInput`
  - 类型字段与 `design.md` 中 TypeScript 接口一字不差
  - 通过 `node --run check` / `getDiagnostics` 验证无类型错误，不扩大项目基线
  - _需求：Requirement 3、Requirement 6.5、Requirement 8.4_

- [x] 2. 实现 `resolveRailSubStage` 纯函数
  - 在同目录 `resolve-rail-sub-stage.ts` 中实现 design 中的 switch 规则
  - 导出 `resolveRailSubStage(input: ResolveRailSubStageInput): AutopilotRailSubStage | undefined`
  - 实现必须为纯函数：不 import store、不 `Date.now`、不副作用
  - _需求：Requirement 2_

- [x] 2.1 **[PBT]** 属性测试 P1：resolver total function
  - 在 `client/src/pages/autopilot/right-rail/__tests__/resolve-rail-sub-stage.property.test.ts` 中使用 `fast-check`
  - 生成任意 `currentStage`（5 值枚举）、任意 `BlueprintGenerationStage`（含全部枚举值）、`job = null` 或 job 对象、`selection / specTree / agentCrew` 的 null/空值组合
  - 断言：`currentStage !== "fabric"` 时返回 `undefined`；`currentStage === "fabric"` 时返回值必须是 `RAIL_SUB_STAGE_ORDER` 的成员
  - _需求：Requirement 2.1_

- [x] 2.2 **[PBT]** 属性测试 P2：子阶段随 job.stage 单调推进
  - 使用 `fast-check` 生成一段按 `BlueprintGenerationStage` 自然推进顺序的 job.stage 序列
  - 断言：对序列中相邻 (prev, next)，`resolveRailSubStage` 返回值在 `RAIL_SUB_STAGE_ORDER` 上的 index 满足 `idx(next) >= idx(prev)`
  - _需求：Requirement 2.3_

- [x] 2.3 **[PBT]** 属性测试 P3：resolver idempotence
  - 使用 `fast-check` 生成任意 `ResolveRailSubStageInput`
  - 断言：对同一快照重复调用 `resolveRailSubStage` N 次，所有返回值严格相等（`===`）
  - _需求：Requirement 2.2、Requirement 2.5_

- [x] 3. 创建 `<AutopilotRightRail>` 最小 scaffolding 组件
  - 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 中实现一个接受 `AutopilotRightRailProps` 的组件
  - 内部调用 `resolveRailSubStage({ currentStage, job, selection, specTree, agentCrew })` 得到 `currentSubStage`
  - 渲染一个 `<aside role="complementary" aria-label={...}>` 容器 + 5 个 stage placeholder 区块 + 8 个 sub-stage placeholder 区块（当前不迁移任何实际工作台内容）
  - 不得在组件内 `useAppStore` 或调用 `@/lib/blueprint-api`
  - _需求：Requirement 3、Requirement 6.2、Requirement 6.5、Requirement 7.1、Requirement 7.2_

- [x] 4. 导出 barrel 文件
  - 创建 `client/src/pages/autopilot/right-rail/index.ts`
  - 重新导出 types、`RAIL_SUB_STAGE_ORDER`、`resolveRailSubStage`、`AutopilotRightRail`
  - 确保 `import { resolveRailSubStage, RAIL_SUB_STAGE_ORDER } from "@/pages/autopilot/right-rail"` 可用
  - _需求：Requirement 3_

- [x] 5. 在 `AutopilotRoutePage` 中引用 scaffolding（编译验证，不接管渲染）
  - 仅在 `AutopilotRoutePage.tsx` 新增一处 `type` 级引用（例如 `import type { AutopilotRightRailProps } from "./right-rail"`），证明契约可被主页面消费而不产生类型回归
  - **不得**在本 spec 中删除底部 `<details data-testid="autopilot-advanced-workbenches">`
  - **不得**在本 spec 中替换 `AutopilotWorkflowRail` 的渲染
  - 通过 `node --run check`；`AutopilotRoutePage.test.tsx` 中 `autopilot-advanced-workbenches`、`autopilot-step-input`、`autopilot-runtime-console`、`blueprint-progress-panel` 断言继续通过
  - _需求：Requirement 8.3、Requirement 8.4_

- [x] 6. 记录迁移边界与「不可做」清单
  - 在 `design.md` 的「迁移 / 兼容性记录」表格基础上，于 PR 描述中再次复述本 spec 不承担 Spec 2/3/4/5 的工作范围
  - 确认 `AutopilotSpecTreeHandoffPanel` 的 `SPECS_PATH` 链接在本 spec **不被修改**（文案降级由 Spec 5 负责）
  - 确认本 spec 不新增 `data-testid`、不删除 `data-testid`
  - _需求：Requirement 4.3、Requirement 8.1、Requirement 8.2、Requirement 8.3、Requirement 8.5_

- [x] 7. 最终验收
  - `node --run check` 通过，不扩大现有 TypeScript 基线错误数
  - `npm exec vitest run client/src/pages/autopilot/right-rail` 通过（含 3 条 PBT 属性测试）
  - `npm exec vitest run client/src/pages/autopilot/AutopilotRoutePage.test.tsx` 不产生新失败
  - `client/src/pages/autopilot/right-rail/` 目录整目录删除应能无副作用回滚
  - _需求：Requirement 8.4、Requirement 8.5_

## 任务执行边界

- 本 spec **不**负责将 `BlueprintProgressPanel` 内部的 `SpecTreeWorkbenchPanel / SpecDocumentWorkbenchPanel / EffectPreviewWorkbench / PromptPackageWorkbench / RuntimeCapabilityBridgeWorkbench / ArtifactMemoryWorkbench / EngineeringLandingWorkbench` 抽离为独立文件或搬进右栏 —— 由 Spec 2 `autopilot-right-rail-stage-panels` 承接。
- 本 spec **不**负责删除 `<details data-testid="autopilot-advanced-workbenches">` 或替换其内容 —— 由 Spec 3 `autopilot-advanced-workbench-inline` 承接。
- 本 spec **不**负责抽出 `useAutopilotRightRailData` hook 或合并双轨 fetch —— 由 Spec 4 `autopilot-right-rail-data-hook` 承接。
- 本 spec **不**负责步骤驱动的自动滚动、动画、URL 子阶段参数、快捷键 —— 由 Spec 5 `autopilot-step-driven-rail-navigation` 承接。

