# Tasks: 合并 spec-docs 进度面板到 SPEC 树节点行（⑤ → ②）

> 配套 `spec.md`。决策已锁定：Q1=A2（✓⚠ 白盒）/ Q2 左 / Q3 搜索下方 /
> Q4 一次性自动滚 / Q5 `3/3 修订` / Q6 双 bg（cool-gray > cream）。
> 全程**不 commit**，改完留工作树等审阅。一个一个来，按 wave 顺序。

## Wave 0 — store 层（A2 基础设施）

- [x] 1. `SpecDocsNodeEntry` 增加 `wasRetried?: boolean` 字段
  - 文件：`client/src/lib/blueprint-realtime-store.ts`
  - 在 `interface SpecDocsNodeEntry` 加可选字段，不破坏既有 spread
  - _验收：spec §3 store 改动_

- [x] 2. 放宽节点状态转移表：允许 `failed → processing`
  - 文件：`client/src/lib/blueprint-realtime-store.ts`
  - `VALID_TRANSITIONS.failed = ["processing"]`（原为 `[]`）
  - _验收：spec §3、§7-5_

- [x] 3. `node_started` reducer：failed→processing 时打 `wasRetried: true`
  - 文件：`client/src/lib/blueprint-realtime-store.ts`
  - 进入 processing 时若 `node.status === "failed"`，set `wasRetried: true`
  - `node_completed` 保留 `wasRetried`（靠 `...node` spread，加测试守护）
  - _验收：spec §3、§7-5_

- [x] 4. store 回归 + A2 新增断言
  - 跑 `spec-docs-progress-store.property.test.ts`（25）+ `spec-docs-progress-assembled.test.ts`（5）
  - 若有 "failed 是终态" 断言，按 A2 语义更新并注明
  - 新增/并入 2 条：`failed→processing` 合法；重试后 `wasRetried` 永久 true
  - _验收：spec §8 store 测试_

## Wave 1 — prop 通道（先通类型，不渲染）

- [x] 5. `AutopilotRightRail` 派生 `nodeStatusById` 并逐层透传
  - 文件：`client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - 从 `useBlueprintRealtimeStore().specDocsProgress.nodes` 派生
    `Record<nodeId, { status, wasRetried, errorSummary }>`
  - 透传链：RightRail → StreamingDocRenderer → AutopilotSpecDocumentsWorkbench
    → WorkbenchSpecTree → WorkbenchSpecTreeView（新 prop `nodeStatusById`）
  - 本步只加 prop + 透传，**不渲染**，确保 `getDiagnostics` 类型通
  - _验收：spec §6 无 store 依赖契约_

## Wave 2 — WorkbenchSpecTree 渲染（核心视觉）

- [x] 6. 新增 `节点 · N` header（搜索框下方，Q3）
  - 文件：`client/src/pages/autopilot/right-rail/streaming-doc/workbench/WorkbenchSpecTree.tsx`
  - testid `autopilot-workbench-spec-tree-node-count`，N = `specTree.nodes.length`
  - _验收：spec §7-12_

- [x] 7. 节点行最左注入 5 态状态图标（Q2 左侧）
  - 文件：同上
  - testid `autopilot-workbench-spec-tree-status-{nodeId}`，带 `data-status` / `data-retried`
  - pending 空心 #999 / processing 橙弧旋转 #FF8A1A / completed 绿✓ #16A34A /
    failed 红✗ #DC2626 / retried-completed 绿✓+橙⚠角标
  - 角标 hover tooltip = `errorSummary`
  - _验收：spec §2 图标表、§7-1~5、§7-11_

- [x] 8. 副标题 `3/3 修订`（Q5，仅 generated>0）
  - 文件：同上
  - testid `autopilot-workbench-spec-tree-doc-count-{nodeId}`，12px #666
  - 复用既有 `groupDocsByNodeId` 派生
  - _验收：spec §7-13_

- [x] 9. 双 background（Q6：cool-gray selection > cream processing）
  - 文件：同上
  - processing 行 `bg-[#FAF7F2]`；selected 行 `bg-[#F0F4F8]`；同时则 cool-gray 覆盖
  - _验收：spec §2 background 表、§7-2/6/7_

- [x] 10. 新晋 processing 节点一次性自动滚动（Q4）
  - 文件：同上
  - `useRef` 记上一次每节点 status，diff 出新晋 processing 才 `scrollIntoView({block:"nearest"})`
  - 不持续抢用户手动滚动
  - _验收：spec §7-14_

## Wave 3 — 删除旧浮层

- [x] 11. 删除 `SpecDocsProgressPanel` 组件 + 其测试
  - 删 `client/src/pages/autopilot/right-rail/spec-docs-progress/SpecDocsProgressPanel.tsx`
  - 删 `client/src/pages/autopilot/right-rail/spec-docs-progress/__tests__/SpecDocsProgressPanel.test.tsx`
  - 注：`formatElapsedTime` 纯工具迁出到 `format-elapsed-time.ts`，其 25-case PBT 保留
  - _验收：spec §4、§7-9/10_

- [x] 12. 移除 RightRail 里 `<SpecDocsProgressPanel/>` 挂载点
  - 文件：`client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - 保留 store 的 `dismissSpecDocsProgress` / `completeSpecDocsProgress` action（不破坏 API）
  - _验收：spec §4、§7-9_

## Wave 4 — 单测

- [x] 13. 新建 `WorkbenchSpecTree.node-status.test.tsx`（约 9 SSR/PBT case）
  - 文件：`client/src/pages/autopilot/right-rail/streaming-doc/workbench/__tests__/WorkbenchSpecTree.node-status.test.tsx`
  - 4 态图标 + data-status / retried 角标 + data-retried / cream / cool-gray /
    覆盖优先级 / 副标题 gating / node-count / 缺节点回退 pending / PBT 13 节点混合
  - _验收：spec §8 新增测试_

- [x] 14. 全量受影响单测 + 类型检查
  - `vitest run` 覆盖：spec-docs-progress 系列、WorkbenchSpecTree 系列、
    新建 node-status、AutopilotRightRail、workbench 全组
  - `getDiagnostics` 所有改动文件 0 error
  - _验收：spec §9-7_

## Wave 5 — Playwright 端到端验收（强制门槛）

- [x] 15. 写 `.tmp/spec-tree-progress-e2e.mjs`（双模式：真 job / socket 回放兜底）
  - 1920×1080，chrome channel，e2e-smoke 账号自举
  - 优先真 job；选不到停在 spec_docs 的 job 则走 `__setSocket` 事件本地回放
  - _验收：spec §8.5 脚本_

- [x] 16. 跑通 P1–P10 自动断言项
  - P2 浮层已删 / P3 节点数对账 / P5 processing 被 socket 点亮+cream /
    P6 终态收敛 / P11 每节点 status testid
  - P7 A2 白盒：retried 节点 `data-retried="true"` + ⚠ 角标 + tooltip
  - P8/P9 双 bg + cool-gray 覆盖
  - _验收：spec §8.5 门槛判定_

- [x] 17. 产出交付物（截图 + 事件流 + 快照）
  - `.tmp/spec-tree-progress-e2e/01-tree-initial.png` / `02-tree-finished.png` / `03-tree-selected.png`
  - `events.jsonl` + `node-status-snapshot.json`
  - 3 张截图随交付说明附上，人工目检 mockup 一致性（P4/P6/P10）
  - _验收：spec §8.5 产物_

## 完成判定

- [x] 18. 全绿交付（不 commit）
  - Wave 0–4 单测全绿 + `getDiagnostics` 0 error
  - Wave 5 Playwright 自动断言全过 + A2 白盒路径走到
  - 改动留工作树，附 3 张截图 + 变更摘要等用户审阅
  - 净变更预期 ≈ -100 行源码（.tmp 脚本/截图不计）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5"] },
    { "id": 5, "tasks": ["6", "7", "8", "9", "10"] },
    { "id": 6, "tasks": ["11", "12"] },
    { "id": 7, "tasks": ["13"] },
    { "id": 8, "tasks": ["14"] },
    { "id": 9, "tasks": ["15"] },
    { "id": 10, "tasks": ["16"] },
    { "id": 11, "tasks": ["17"] },
    { "id": 12, "tasks": ["18"] }
  ]
}
```
