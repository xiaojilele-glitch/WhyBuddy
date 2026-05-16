/**
 * `autopilot-role-container-loader` spec Task 2：角色容器 loader 的共享类型。
 *
 * 本模块只定义**纯类型**（无 runtime 副作用），由 `shared/blueprint/contracts.ts`
 * 的 `BlueprintAgentRole.capabilityPackage?` 可选字段消费，同时由 server 侧
 * `server/routes/blueprint/role-container-loader/*` 在运行期消费。
 *
 * 分离出独立文件而不是塞进 `contracts.ts` 的理由：
 * - 保持 `contracts.ts` 既有对外契约稳定（本 spec 只在 `BlueprintAgentRole`
 *   末尾追加一个可选字段，其余字段保持严格不变）。
 * - Role container 的类型体量较大（package / binding / budget 三类），
 *   放到独立子模块便于后续任务 3-9 的 server 实现复用。
 *
 * 对应 spec：
 * - 需求 1.1 / 1.2 / 1.5 / 1.6 / 1.7：角色能力包的可选性与字段最小集。
 * - 需求 9.1-9.4：资源预算字段集。
 * - 需求 10.1 / 10.2：不破坏现有 `BlueprintAgentRole` 字段集。
 */

import type { BlueprintGenerationStage } from "../contracts.js";

/**
 * 角色可以绑定的单条能力。
 *
 * 为了让类型定义稳定地覆盖 MCP / Skill / AIGC 三种能力种类，这里统一使用
 * `kind` 字段区分，避免将三者分别展开为独立字段。其中：
 * - `mcp`：引用主线 `/api/mcp` 注册的 server + tool。
 * - `skill`：引用 L12 plugin-skill-system 注册的 skill。
 * - `aigc_node`：引用 `aigc-spec-node` 桥所覆盖的节点 id。
 *
 * `optional?: true` 表示该绑定失败不影响容器进入 `ready`；默认 `false`
 * 表示绑定失败会让容器转入 `degrading` 但不会阻塞整体 provision。
 */
export interface RoleCapabilityPackageBinding {
  kind: "mcp" | "skill" | "aigc_node";
  id: string;
  optional?: boolean;
  /**
   * 可选：可见阶段子集。未设时表示该绑定对 {@link BlueprintAgentRole.defaultStages}
   * 全部阶段可见。
   */
  applicableStages?: BlueprintGenerationStage[];
  /**
   * 可选：节点专属参数摘要（例如 AIGC 节点需要的领域指令或路由权重）。
   * 不承诺 shape；消费方只读不写，并在快照到 handoff 时做 sha256 摘要。
   */
  metadata?: Record<string, unknown>;
}

/**
 * 单条角色容器的资源预算。
 *
 * 所有字段均为"上限"而非"分配量"：loader 会基于 `mergeBudget` 折算成真实
 * `dispatchPlan` 参数；Lite mode 下用于宿主进程内限制（timer / quota）。
 *
 * 越界值会被截断到合理范围并 warn（见需求 9.1-9.4 与 capability-package.ts
 * §3.3 `mergeBudget` 算法）。
 */
export interface RoleResourceBudget {
  /**
   * 容器 provision 超时（毫秒）。超时后 lifecycle-manager 会取消 dispatchPlan
   * 并回退到 lite mode；默认 30_000，合法范围 5_000 ~ 180_000。
   */
  provisionTimeoutMs?: number;
  /**
   * 角色可并发执行的 AIGC 节点数量（`onDemand.aigcNodes` 触发时生效）。
   * 默认 1（serial），合法范围 1 ~ 8。
   */
  maxConcurrentAigcNodes?: number;
  /**
   * AIGC 节点编排模式。
   * - `serial`（默认）：逐节点执行，失败继续但累计 `partialFailures`。
   * - `parallel`：并发执行，同样允许部分失败。
   */
  orchestrationMode?: "serial" | "parallel";
  /**
   * 容器 memory 上限（MiB）。默认 512，合法范围 128 ~ 8192。
   */
  memoryMiB?: number;
  /**
   * 容器 CPU 上限（核数，小数精度 0.1）。默认 1，合法范围 0.1 ~ 8。
   */
  cpuCores?: number;
  /**
   * MCP probe 超时（毫秒）。默认 5_000，合法范围 1_000 ~ 30_000。
   */
  mcpProbeTimeoutMs?: number;
}

/**
 * 角色容器能力包。
 *
 * - `alwaysBound`：容器 provision 时一定会尝试绑定的能力，失败降级为 `degrading`。
 * - `onDemand`：在角色真正 invoke 某节点时才加载；本字段在容器 provision 阶段
 *   仅登记引用，不实际执行（避免冷启动开销）。
 * - `shared`：跨角色共享的只读能力引用（例如共享的知识库 MCP）。
 *
 * `containerImage` 未设时由 `resolveContainerImage`（capability-package.ts
 * §3.4）根据 `onDemand.aigcNodes` 数量自动二选一：
 * - `lobster-executor:default`（无 aigc 节点）
 * - `lobster-executor:ai`（至少一个 aigc 节点）
 *
 * `allowlistDomains` 仅 real mode 生效，控制容器内的出站域名。
 */
export interface RoleCapabilityPackage {
  alwaysBound?: RoleCapabilityPackageBinding[];
  onDemand?: {
    mcps?: RoleCapabilityPackageBinding[];
    skills?: RoleCapabilityPackageBinding[];
    aigcNodes?: RoleCapabilityPackageBinding[];
  };
  shared?: RoleCapabilityPackageBinding[];
  resourceBudget?: RoleResourceBudget;
  containerImage?: string;
  allowlistDomains?: string[];
}
