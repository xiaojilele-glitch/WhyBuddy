/**
 * `shared/blueprint` 统一 barrel。
 *
 * 下游代码应优先通过此入口获取类型：
 *   `import type { BlueprintGenerationJob } from "@shared/blueprint";`
 *
 * 本文件也是 8 个子域类型模块的汇聚点。如果未来把类型从 `./contracts.ts` 物理搬到
 * 各子域 `types.ts` 里，下游的 import 语句不需要改动，只有此 barrel 内部会收窄到
 * 子域来源。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.4（通过 `shared/blueprint/index.ts` 继续导出现有符号）
 * - 需求 6.3（任何路径变化必须以 barrel re-export 兜底）
 */

// 事件家族：真相源在 `./events.ts`，`contracts.ts` 同样 re-export。
// 下游可从 barrel 拿到事件枚举与家族 union，不必知道它住在哪个文件。
export type {
  BlueprintEventNameKey,
  BlueprintGenerationEventFamily,
  BlueprintGenerationEventType,
} from "./events.js";
export { BlueprintEventName, resolveBlueprintEventFamily } from "./events.js";

// 8 个子域的类型视图（当前为 re-export 视图，不阻塞后续物理搬运）。
export type * from "./intake/types.js";
export type * from "./clarification/types.js";
export type * from "./jobs/types.js";
export type * from "./agent-crew/types.js";
export type * from "./routeset/types.js";
export type * from "./spec-documents/types.js";
export type * from "./downstream/types.js";
export type * from "./artifact-memory/types.js";

// Role System Architecture 纯类型（与 server 侧 zod schema z.infer 等价）。
export type { AgentRoleEntry, RoleArchitectureResponse } from "./role-architecture.js";

// Role container loader 纯类型（`autopilot-role-container-loader` spec Task 2）。
// 下游可通过 `import type { RoleCapabilityPackage } from "@shared/blueprint";` 获取。
export type {
  RoleCapabilityPackage,
  RoleCapabilityPackageBinding,
  RoleResourceBudget,
} from "./role-container/types.js";

// Autonomous Agent 类型（`autopilot-role-autonomous-agent` spec Task 1）
export type * from "./agent-tool.js";
export type * from "./agent-budget.js";
export type * from "./agent-state.js";
export type * from "./agent-job.js";
export type * from "./agent-events.js";
export type * from "./agent-config.js";
export type * from "./agent-delegator.js";
