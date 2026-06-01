# 设计文档：Drive State 与 Replan 状态机

## 设计概述

本设计旨在为 WhyBuddy 增加一层面向“任务自动驾驶”的高层状态机视图，用于把当前 mission-first、Mission Runtime、workflow runtime、人工接管、review / audit / replay 等底层事实，统一解释为一条用户可理解的任务驾驶过程。

核心原则如下：

1. 高层状态机是“解释层”，不是“替换层”
2. 状态投影优先于底层改名
3. 与现有 Mission Runtime 兼容优先
4. 与 replay / audit / takeover 链路一致

因此，本设计不会要求：

- 当前 runtime state 立即大规模改名
- 当前 workflow engine 立即重写
- 当前任务详情、回放、审计立即统一切换到新命名

更合理的路径是先定义高层状态机，再逐步把前端、服务端投影和治理链路接上来。

## 设计目标

- 建立统一的高层任务驾驶状态机
- 为驾驶舱主界面提供稳定的状态语义
- 为重规划提供清晰、独立的语义边界
- 与当前 mission-first / Mission Runtime / replay / audit 保持兼容
- 为后续前端 view model 和服务端 projection 提供标准输入

## 总体分层

### 第一层：底层事实状态

当前系统中已经存在大量底层状态来源，包括：

- Mission 生命周期状态
- Workflow instance 状态
- Node run 状态
- review / audit / verify / revise 状态
- retry / terminate / escalate / wait / resume 控制状态
- replay / audit 事件证据

这些状态适合驱动执行，但不适合直接成为用户界面语言。

### 当前直接锚定的底层状态来源（2026-04-25）

围绕当前仓库里已经存在的 shared -> server -> client 链路，Drive State 的直接锚点主要来自以下几类事实：

| 来源层 | 当前直接锚定字段 | 当前用途 |
| ---- | ---- | ---- |
| mission facts | `mission.status`、`mission.currentStageKey`、`mission.waitingFor`、`mission.decision`、`mission.operatorState`、`mission.blocker`、`mission.attempt`、`mission.operatorActions` | 推导 `driveState`、`takeover`、`recovery`、`route.replan` 的最小状态语义 |
| workflow runtime | `workflowRuntime.status`、`workflowRuntime.currentStage` | 补充 `explanation.currentState` 的 workflow 侧说明 |
| execution summary | `execution.currentStepKey`、`execution.currentStepLabel`、`execution.currentStepStatus`、`execution.availableActions` | 支撑 cockpit 中的 live execution、remaining steps 与 replan/retry 建议 |
| recovery summary | `recovery.state`、`recovery.deviationCategory`、`recovery.reason`、`recovery.suggestedActions` | 支撑 blocked / takeover-required / replanning 的恢复与偏航解释 |
| evidence summary | `evidence.timeline`、`evidence.correlation` | 为 replay / audit / panel 提供最小可索引证据骨架 |
| explanation summary | `explanation.currentState`、`explanation.recommendationDetails`、`explanation.remainingSteps` | 提供高层状态原因、下一步、推荐与 replan change summary |

这份来源表只覆盖当前已经被代码直接消费的信号，不等于主仓内全部 node run、review、audit、verify 底层状态已经完成系统盘点。

### 最小底层状态清单（2026-04-26）

为把“状态来源盘点”收口到当前可直接证明的范围，本 spec 先固定一份最小底层状态清单。它的定位是：

- 作为 Drive State / takeover / replan / replay / audit 的共同术语底座；
- 只覆盖当前已有直接代码锚点或直接测试锚点的状态来源；
- 不宣称 node run、review、audit、verify 的全量状态盘点已经完成。

| 状态族群 | 当前最小直接字段 | 当前可支持的高层语义 | 当前仍未完成的盘点边界 |
| ---- | ---- | ---- | ---- |
| mission lifecycle | `mission.status` | `delivered`、`clarifying`、`takeover-required`、`blocked` 的入口事实 | 还不能替代完整 MissionStatus 语义树 |
| mission stage | `mission.currentStageKey`、`mission.stages[*].status` | `understanding / planning / fleet-forming / executing / reviewing` 的阶段归并 | 还不能证明全主链路迁移事件已统一 |
| waiting / decision | `mission.waitingFor`、`mission.decision`、`mission.decisionHistory` | `clarifying`、`takeover-required`、HITL 恢复链 | 还不能证明所有 approval / comment / request-info 分支都已统一成高层事件 |
| operator / blocker | `mission.operatorState`、`mission.blocker`、`mission.operatorActions` | `blocked`、`replanning`、`takeover-required`、恢复动作说明 | 还不能替代完整 operator orchestration 状态机 |
| attempt / recovery | `mission.attempt`、`recovery.state`、`recovery.deviationCategory`、`recovery.reason` | `replanning`、`blocked`、recovery / escalation 解释 | 还不能证明所有 retry / recover / reroute 语义已经完整区分 |
| workflow runtime | `workflowRuntime.status`、`workflowRuntime.currentStage` | `explanation.currentState` 的 workflow 侧上下文 | 还不能替代 workflow runtime 原始状态 |
| execution summary | `execution.currentStepKey`、`execution.currentStepLabel`、`execution.currentStepStatus`、`execution.availableActions` | cockpit 实时步骤、retry / replan 建议、remaining steps | 还不能代表所有 node run 明细状态 |
| evidence timeline | `evidence.timeline.{id,type,label,detail,status,source,time}` | replay / panel 的最小高层时间线片段 | 还不是统一 transition-level 事件契约 |
| evidence correlation | `evidence.correlation.{workflowId,replayId,sessionId,routeIds,runtimeEventIds,decisionIds,operatorActionIds,auditEventIds,lineageIds}` | replay / audit / panel 的索引锚点 | 还不能单独表达状态切换因果关系 |
| explanation summary | `explanation.currentState`、`explanation.remainingSteps`、`explanation.recommendationDetails` | drive state 原因、下一步、replan change summary | 仍是 projection / explanation 视图，不是原始 runtime event |

这份清单可以视为“底层状态清单”的最小文档收口版本。它足以支撑设计、projection、panel 与审计口径对齐，但不应被外推为“所有运行态来源已经盘点完成”。

### 第二层：Drive State 高层投影

Drive State 用于将底层多个信号归并为一组用户可理解的高层状态：

- `understanding`
- `clarifying`
- `planning`
- `fleet-forming`
- `executing`
- `reviewing`
- `blocked`
- `takeover-required`
- `replanning`
- `delivered`

这一层的核心价值是“统一解释任务当前行驶到了哪里”。

### 第三层：驾驶舱与回放消费层

驾驶舱、任务详情、回放、审计等视图层不再直接拼接底层多个状态来源，而是优先消费以下高层对象：

- 当前 `driveState`
- 当前状态原因
- 进入状态的触发事件
- 下一步预期动作
- 是否需要接管
- 是否发生重规划

## 状态定义

### 1. `understanding`

#### 语义

系统正在理解用户目标、整理上下文、识别约束、判断任务边界。

#### 典型底层信号

- mission 刚创建
- 目标、上下文、约束仍在抽取或归一化
- 尚未形成清晰路线建议

#### 退出条件

- 信息完整度足以进入规划
- 或发现关键信息缺失，转入澄清

### 2. `clarifying`

#### 语义

系统正在补齐关键缺失信息，可能主动发起问题，也可能等待用户补充。

#### 典型底层信号

- 用户目标存在歧义
- workflow / task 等待输入
- 成功标准、预算、风格、范围等缺失

#### 与 `takeover-required` 的关系

- `clarifying` 表示系统当前所处阶段偏向“澄清”
- `takeover-required` 表示系统当前需要外部介入
- 两者可以相互关联，但不完全相同

### 3. `planning`

#### 语义

系统正在生成执行路线、阶段安排、风险点、接管点与候选方案。

#### 典型底层信号

- 任务目标和约束已基本明确
- 正在选择路线模板、工作流骨架、执行策略
- 正在评估成本、时间、风险或能力组合

#### 退出条件

- 形成可执行方案后进入编队或执行
- 若发现关键决策待确认，则进入接管

### 4. `fleet-forming`

#### 语义

系统正在为路线组建执行车队，也就是选择角色、节点组合、Agent 编队、工具装配或执行器资源。

#### 典型底层信号

- 动态组织生成
- 节点/技能/工具绑定
- 执行器、适配器、外部服务准备

#### 退出条件

- 编组完成后进入执行
- 若编组失败或资源不足，可进入重规划或阻塞

### 5. `executing`

#### 语义

系统正在沿当前路线执行任务，产生中间结果或最终交付物。

#### 典型底层信号

- workflow instance 正在运行
- 节点在推进、分支、调用工具、写入结果
- 实时产生输出、日志、证据或中间产物

#### 退出条件

- 执行完成后进入复核
- 执行中等待关键输入则进入接管或澄清
- 执行失败且需改线则进入重规划
- 执行无法推进则进入阻塞

### 6. `reviewing`

#### 语义

系统正在执行 review、audit、verify、revise 等质量与治理动作，验证结果是否达标。

#### 典型底层信号

- 结果评审中
- 风险复核中
- 输出对照成功标准中
- 准备决定是否交付、返工或改线

#### 退出条件

- 达标则进入交付
- 不达标但可修正则进入重规划
- 需要人工验收则进入接管

### 7. `blocked`

#### 语义

系统当前无法自动向前推进，但尚未完成有效恢复。

#### 典型底层信号

- 重试预算耗尽
- 关键依赖不可用
- 关键状态不一致
- 没有可继续执行的合法路径

#### 关键说明

`blocked` 不是“失败终态”，而是“当前受阻态”。
它后续可以转向：

- `takeover-required`
- `replanning`
- 极少数情况下回到 `executing`

### 8. `takeover-required`

#### 语义

系统需要用户或人工角色介入，才能继续推进或确认结果。

#### 典型底层信号

- decision pending
- approval pending
- wait for user input
- 预算 / 权限待确认
- 结果待验收

#### 关键说明

这是高层接管态，不限定接管原因，具体原因由 takeover 元数据补充。

### 9. `replanning`

#### 语义

系统正在调整原路线，生成新的执行路径或替代策略。

#### 典型触发场景

- 当前路线持续失败
- 结果质量不达标
- 用户修改目标、约束、优先级
- 成本、风险、时延超限
- 某类工具或执行器失效
- 人工接管后要求换路线

#### 与 `retry` 的区别

- `retry` 仍然沿原路线或原节点继续尝试
- `replanning` 是改变高层路径或策略

#### 与 `clarifying` 的区别

- `clarifying` 是补信息
- `replanning` 是改路线

### 10. `delivered`

#### 语义

系统已经完成当前任务的交付，产生了结果、摘要、工件或最终说明。

#### 典型底层信号

- 最终输出已形成
- review / verify 通过
- mission 已具备可交付状态

## 状态迁移设计

### 主链路迁移

标准主链路建议如下：

`understanding`
-> `planning`
-> `fleet-forming`
-> `executing`
-> `reviewing`
-> `delivered`

这是理想自动推进链路。

### 标准主链路迁移图（2026-04-26）

为了让“主链路迁移图”在文档层完成收口，本 spec 把标准推进路径固定为下表。该表的语义是：

- 它是高层 Drive State 的标准迁移图；
- 它可以作为产品、前端、projection、审计的统一叙述；
- 它并不自动意味着仓库里已经存在一条完整、统一、可回放的 transition event 实现链。

| 当前状态 | 下一状态 | 进入条件 | 当前最小实现锚点 | 退出条件 / 后续分支 |
| ---- | ---- | ---- | ---- | ---- |
| `understanding` | `planning` | 目标和上下文足以进入路线生成 | `currentStageKey === "receive" / "understand"` 归并为 `understanding`，`currentStageKey === "plan"` 且 `attempt <= 1` 归并为 `planning` | 若发现缺口，则转 `clarifying` |
| `planning` | `fleet-forming` | 已形成可执行路线，开始 provision / 绑定执行资源 | `currentStageKey === "provision"` 归并为 `fleet-forming` | 若等待决策，转 `takeover-required`；若改线，转 `replanning` |
| `fleet-forming` | `executing` | 角色、节点、执行器、工具装配完成 | `currentStageKey === "execute"` 归并为 `executing` | 若编组失败或资源阻塞，可转 `blocked` / `replanning` |
| `executing` | `reviewing` | 主执行链已跑到 finalize / review / verify 入口 | `currentStageKey === "finalize"` 归并为 `reviewing` | 若等待输入，转 `takeover-required` / `clarifying`；若失败，转 `blocked`；若改线，转 `replanning` |
| `reviewing` | `delivered` | 结果通过 review / verify / audit 并形成最终交付 | `mission.status === "done"` 归并为 `delivered` | 若不达标，转 `replanning`；若待人工确认，转 `takeover-required` |

补充说明：

- 当前直接实现更接近“相邻时点的状态归并”，而不是“完整 transition event 序列”；
- 但标准主链路迁移图本身已经可以在设计层独立成立，因此可作为文档收口成果存在。

### 主链路迁移的当前实现边界（2026-04-25）

当前设计中的主链路仍然成立：

`understanding`
-> `planning`
-> `fleet-forming`
-> `executing`
-> `reviewing`
-> `delivered`

但结合当前实现，需要明确以下边界：

- 当前代码中已有固定十态集合，以及 `inferMissionAutopilotDriveState()` 对 `receive / understand / plan / provision / execute / finalize / waiting / failed / done` 的时点投影。
- 这意味着“状态定义”和“单点状态归并”已经存在，但不代表 understanding 到 delivered 的整条主链路已经形成显式、统一、可回放的迁移事件序列。
- 当前更准确的说法是：
  - 已有高层状态语义
  - 已有若干核心阶段的直接映射
  - 尚未形成完整的 Drive State 主链路迁移契约
- 因此 tasks 中“输出主链路迁移图”仍应保持未勾选，直到仓库里出现对整条主链路更完整的实现或测试闭环。

### 澄清链路

当信息不足时，状态迁移可为：

`understanding`
-> `clarifying`
-> `planning`

或：

`planning`
-> `takeover-required`
-> `clarifying`
-> `planning`

### 接管链路

当系统无法自动推进或需要人工决策时：

`executing`
-> `takeover-required`

`reviewing`
-> `takeover-required`

`blocked`
-> `takeover-required`

接管完成后，可恢复到：

- `clarifying`
- `planning`
- `executing`

### 重规划链路

当原路线无效或不优时：

`executing`
-> `replanning`

`reviewing`
-> `replanning`

`blocked`
-> `replanning`

重规划完成后，可进入：

- `fleet-forming`
- `executing`
- `takeover-required`

### 阻塞链路

当系统无法继续自动推进时：

`executing`
-> `blocked`

`planning`
-> `blocked`

`fleet-forming`
-> `blocked`

阻塞并非终态，通常需要接管或重规划。

## 映射设计

### 与 Mission Runtime 的映射

Drive State 不直接替代 Mission Runtime，而是从 Mission Runtime 投影得出。

建议映射方式：

| Mission Runtime 信号 | Drive State | 说明 |
| ---- | ---- | ---- |
| mission 创建、目标解析中 | understanding | 任务意图理解阶段 |
| mission 缺失关键上下文 | clarifying | 待补信息 |
| workflow / route 准备中 | planning | 正在计划 |
| 动态组织、执行角色配置中 | fleet-forming | 正在编队 |
| runtime 正在执行节点 | executing | 主执行阶段 |
| review / audit / verify 激活 | reviewing | 复核阶段 |
| runtime 无法前进 | blocked | 受阻 |
| decision / resume / approval 等待 | takeover-required | 需接管 |
| 发生换路、返工、重组执行方案 | replanning | 重规划 |
| 最终交付完成 | delivered | 完成送达 |

### 与 workflow / runtime state 的映射

底层 workflow / runtime state 通常更细粒度，例如：

- pending
- executing
- waiting_input
- executed
- exception
- terminated
- retry requested
- escalated

这些状态不应直接暴露为驾驶态，而应通过归并映射解释为高层 Drive State。

示意如下：

| 底层状态或事件 | 高层解释 |
| ---- | ---- |
| `WAITING_INPUT` | `clarifying` 或 `takeover-required` |
| `EXECUTING` | `executing` |
| `EXCEPTION` + 可恢复 | `blocked` 或 `replanning` |
| `instance.escalated` | `takeover-required` |
| `retry requested` 但仍沿原路线 | 保持 `executing` 或短暂 `blocked` |
| `review / verify active` | `reviewing` |

### 与 replay / audit 的映射

Drive State 变化应能够被 replay / audit 重建。

建议记录的高层状态事件字段包括：

- `previousDriveState`
- `nextDriveState`
- `triggerType`
- `triggerReason`
- `relatedMissionId`
- `relatedWorkflowId`
- `relatedDecisionId`
- `replanReason`
- `takeoverReason`

这样可以让回放真正像“驾驶时间线”，而不只是底层节点流水。

### 高层状态时间线最小事件字段建议（2026-04-26）

为让 replay / audit / cockpit 后续能够统一消费 Drive State 迁移，本 spec 建议最小 transition-level 事件结构如下：

```ts
type DriveStateTransitionEvent = {
  id: string;
  time: string;
  previousDriveState: MissionAutopilotDriveState | null;
  nextDriveState: MissionAutopilotDriveState;
  triggerType:
    | "mission-status"
    | "stage-change"
    | "waiting-input"
    | "decision-submitted"
    | "operator-action"
    | "recovery"
    | "route-replanned"
    | "review-result"
    | "delivery";
  triggerReason: string | null;
  missionId: string;
  workflowId?: string | null;
  routeId?: string | null;
  decisionId?: string | null;
  operatorActionId?: string | null;
  runtimeEventId?: string | null;
  correlationTimelineId?: string | null;
  source: "mission-runtime" | "workflow-runtime" | "takeover-state" | "recovery-engine" | "review" | "audit";
};
```

字段设计原则：

- `previousDriveState / nextDriveState`
  - 让 replay / audit 能表达“从哪到哪”；
- `triggerType / triggerReason`
  - 让 transition 具备产品与审计都能读懂的触发解释；
- `missionId / workflowId / routeId / decisionId / operatorActionId / runtimeEventId`
  - 让 transition 能回链到底层事实；
- `correlationTimelineId`
  - 让 transition 与当前 evidence timeline / explanation currentState 对齐；
- `source`
  - 让消费方知道这条事件主要来自 mission runtime、workflow runtime、takeover、recovery 还是 review / audit。

这份结构当前仍属于设计建议，不代表仓库里已经存在完整实现；但它已经足够作为“最小事件字段定义”的文档收口版本。

### 最小事件字段的当前实现边界（2026-04-25）

当前仓库里已经存在一套可被 replay / audit / cockpit 共同消费的“最小证据骨架”，但它与“统一的高层状态切换事件契约”仍不是一回事。

当前已有的最小字段包括：

- `evidence.timeline`
  - `id`
  - `type`
  - `label`
  - `detail`
  - `status`
  - `source`
  - `time`
- `evidence.correlation`
  - `missionId`
  - `workflowId`
  - `replayId`
  - `sessionId`
  - `timelineId`
  - `routeIds`
  - `recommendedRouteId`
  - `selectedRouteId`
  - `routeStageKeys`
  - `currentStepKey`
  - `runtimeEventIds`
  - `decisionIds`
  - `operatorActionIds`
  - `auditEventIds`
  - `lineageIds`
- `explanation.currentState`
  - `driveState`
  - `missionStatus`
  - `currentStageKey`
  - `currentStageLabel`
  - `workflowStatus`
  - `workflowStage`
  - `routeSelectionStatus`
  - `selectedRouteId`
  - `correlationTimelineId`
  - `sources`
  - `updatedAt`
- `explanation.remainingSteps`
  - `currentStepKey`
  - `currentStepLabel`
  - `mainlineSteps`
  - `pendingSteps`
  - `parallelBranchCount`
  - `replanChangeSummary`

当前仍缺失、因此不能视为已闭环的统一字段包括：

- `previousDriveState`
- `nextDriveState`
- `triggerType`
- `triggerReason`
- 一条高层状态迁移事件内统一携带的 route / decision / takeover / recovery 关联契约

因此，本 spec 当前可声明的是“存在最小投影/证据字段骨架”，而不是“高层状态切换事件字段已经统一完成”。

补充说明（2026-04-26）：

- 上一节给出的 `DriveStateTransitionEvent` 已足以完成文档层“最小事件字段定义”；
- 但当前实现仍只到 `evidence.timeline / evidence.correlation / explanation.currentState / explanation.remainingSteps` 的骨架阶段；
- 因此可以把“定义最小事件字段”视为 spec 设计完成，但不能把它外推为 runtime / replay / audit 已经统一实现。

## Replan 设计

### Replan 定义

`Replan` 是对“当前路线不再最优或不可行”的高层反应。
它不是单次节点失败后的普通重试，而是对任务推进策略的重新组织。

### Replan 触发器

建议至少支持以下触发器分类：

- `quality_gap`
  - review 发现质量不达标
- `route_failure`
  - 当前路线关键步骤失败
- `dependency_unavailable`
  - 外部工具、服务、执行器不可用
- `constraint_changed`
  - 用户修改目标、预算、时限、风格、权限要求
- `risk_exceeded`
  - 风险、成本、时延超出当前路线承受范围
- `human_override`
  - 人工接管后要求切换路线

### Replanning 信号来源的当前分层（2026-04-25）

为了避免把设计语义误写成实现现状，这里把 `replanning` 的信号来源拆成两层：

#### 当前已有直接实现锚点的来源

- `mission.attempt > 1`
  - 当前在 `inferMissionAutopilotDriveState()` 中直接把 `plan + attempt > 1` 归并为 `replanning`
- `operator action = retry / escalate`
  - 当前在 `server/tasks/mission-projection.ts` 中直接参与 `orchestration.replan.reason / triggerAction`
- `blocked / blocker / waitingFor` 与 `route.replan`、`remainingSteps.replanChangeSummary` 的联动
  - 当前已在 autopilot summary、projection、panel 展示与测试中形成最小闭环

#### 当前仍主要停留在设计层的来源

- review / audit 检出质量缺口后强制改线
- dependency unavailable 后自动切换备用路线
- constraint changed / goal changed 后自动切换路线
- risk exceeded / budget exceeded / latency exceeded 后自动降级或重排
- human override 明确要求切换到另一条候选路线

这意味着：

- 本 spec 可以保留完整的 `replanning` 设计语义
- 但 tasks 中“梳理真实信号来源”仍不能因为设计已写出而保守勾选完成

### `replanning` 真实触发信号清单（2026-04-26）

为了把“真实信号来源”在文档层收口，本 spec 进一步固定以下清单：

#### A. 当前已有直接实现或直接测试锚点的触发信号

| 触发信号 | 当前直接锚点 | 当前可支持的 `replanning` 语义 |
| ---- | ---- | ---- |
| `mission.attempt > 1` 且仍处于 `plan` 阶段 | `inferMissionAutopilotDriveState()` | 计划阶段已从初始规划进入重规划 |
| runtime / operator 触发重试后改线 | `mission.operatorActions`、`route.selection.status = "replanned"`、`route.replan` | 运行时已触发替代路线或改写当前路线 |
| blocker 导致 route handoff crash / recovery exhausted | `mission.blocker.reason`、`recovery.state`、`remainingSteps.replanChangeSummary` | 因运行时偏航或恢复失败而重规划 |
| route selection changed by runtime | `route.selection.changedBy = "runtime"`、`route.replan.triggeredBy = "runtime"` | 当前候选路线已被运行时替换 |

#### B. 当前已有部分事实锚点、但尚不能独立闭环为真实触发器的信号

| 触发信号 | 当前锚点 | 为什么仍不能当作已闭环真实触发 |
| ---- | ---- | ---- |
| waiting / decision 之后继续规划 | `mission.waitingFor`、`mission.decisionHistory`、resume 行为 | 目前更明确地支撑 `takeover-required -> clarifying / planning`，还不能单独证明发生了真实 reroute |
| 审计 / lineage 相关上下文进入 evidence correlation | `auditEventIds`、`lineageIds` | 当前只证明索引可关联，不足以单独证明触发了高层重规划 |

#### C. 当前仍停留在目标态设计的触发器

- review / verify / audit 质量缺口直接驱动改线
- dependency unavailable 自动切换备用路线
- constraint changed / goal changed 后自动改线
- risk exceeded / budget exceeded / latency exceeded 后自动降级或重排
- human override 明确要求切换到另一条候选路线

这份三层清单的意义是：

- 文档已经把 `replanning` 的真实信号来源分层说清；
- 但只有 A 类能被视为当前主线已有直接实现锚点；
- 因而这一条目是否勾选，必须按“文档梳理完成”而不是“全部实现完成”来理解。

### Replan 输出

重规划后至少应能输出：

- 原路线摘要
- 触发原因
- 新路线摘要
- 是否需要重新编队
- 是否需要接管确认

### 实现审计（2026-04-24）

基于当前主线代码与测试，可保守确认本 spec 中“重规划链路迁移图”这一项已经具备最小落地依据：

- `shared/mission/autopilot.ts` 已将 `executing` / `reviewing` / `blocked` 到 `replanning` 的投影关系编码，并区分 `retry requested` 仍沿原路线继续尝试，与真正换路的 `replanned` / `route.replan`
- `shared/mission/autopilot.ts` 的 explanation 已输出 `currentState`、`recommendationDetails`、`remainingSteps`，其中 blocked 后重规划场景带有 `remainingSteps.replanChangeSummary`
- `client/src/lib/tasks-store.ts` 已保留 `driveState`、`selectionStatus`、`route.replan`、`takeover` 等字段，且对 `alternatives-available` / `replanned` 做了归一化
- `client/src/components/tasks/TaskAutopilotPanel.tsx` 已能展示 `blocked`、`takeover-required`、`replanning`、`replanned` 以及 `route.replan` 相关信息
- 审计依据测试为：`shared/__tests__/mission-autopilot.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`

本次勾选仍按保守口径处理：它只说明“重规划触发、恢复去向、与 retry 的区别”已在设计与实现中形成闭环，不代表 replay / audit 的最小事件字段定义已经完成。

同样可保守确认“阻塞链路迁移图”已有最小实现依据：

- `shared/mission/autopilot.ts` 已把 `mission.status === "failed"`、`mission.operatorState === "blocked"` 或存在 `mission.blocker` 统一归并为 `blocked`
- 设计文档已明确 `blocked -> takeover-required / replanning / executing` 的退出方向
- `shared/__tests__/mission-autopilot.test.ts` 已覆盖 blocked 场景下 recovery summary、route.replan 与 evidence timeline 的投影
- `server/tests/mission-operator-actions.test.ts` 已覆盖 `escalate` 把失败任务推入 blocked 人工跟进，以及 `resume` 清除 blocker、退出 blocked 的恢复路径

本次仍不把 replay / audit 的高层状态事件字段视为完成，只确认 blocked 的进入条件与退出路径已经有设计和实现上的最小闭环。

## 兼容策略

### 策略 1：不大规模改底层命名

本设计明确不建议当前就把底层 runtime 状态全部改名成 Drive State。

原因：

- 当前 Mission Runtime、workflow runtime、测试与事件模型已有稳定依赖
- Drive State 更适合作为高层解释对象
- 先投影、后收敛比先改名更稳妥

### 旧状态命名依赖与兼容说明（2026-04-25）

当前仓库中的兼容策略需要进一步明确成以下约束：

- `Drive State` 是 projection / explanation 层的高层命名，不替换既有事实状态。
- 以下对象仍应继续保留原有命名与语义：
  - `MissionStatus`
  - workflow / orchestration status
  - execution step status
  - recovery state
  - timeline event type
  - route selection status
- 当前可以新增的是：
  - 高层 `driveState`
  - 高层 `takeover`
  - 高层 `replanning` 摘要
  - 高层 `explanation.currentState`
- 当前不应做的是：
  - 批量把底层状态重命名成十态口径
  - 让 replay / audit / runtime 统一只暴露 Drive State
  - 在没有依赖盘点前强制替换旧字段

这段兼容说明只定义“不要怎么改”，不代表“旧状态命名依赖盘点”已经完成，因此 tasks 中对应条目仍需保持未勾选。

### 旧命名兼容风险矩阵（2026-04-26）

为把“兼容优先、不立即改名”的风险说明写得更可执行，本 spec 补一份最小风险矩阵：

| 旧命名族群 | 当前承载位置 | 为什么当前不能直接改成 Drive State | 当前兼容策略 |
| ---- | ---- | ---- | ---- |
| `MissionStatus` | mission runtime / task 主对象 | 直接驱动任务生命周期、恢复、暂停、等待、失败、完成等底层控制 | 保留原字段，Drive State 仅做 projection |
| workflow / orchestration status | workflow runtime / projection links | 面向执行引擎与实例调度，粒度与 Drive State 不同 | 继续在 `explanation.currentState.workflowStatus` 中并行展示 |
| execution step status | execution summary / cockpit step view | 描述的是步骤/节点进度，不是任务高层驾驶阶段 | 保留 `execution.currentStepStatus`，不并入十态 |
| recovery state | recovery summary | 用于偏航、恢复、升级、阻塞处理，语义比 Drive State 更偏恢复引擎内部 | 继续作为 blocked / replanning 的解释来源 |
| timeline event type | evidence.timeline | 当前是最小证据骨架，尚未统一为高层 transition 事件 | 保留现有 `type / status / source`，后续再补 transition contract |
| route selection status | route.selection.status / mode | 描述的是候选路线与选路状态，不等于 Drive State | 继续与 `driveState` 并行存在 |

主要风险说明：

- 若直接把这些旧命名替换成十态口径，会丢失执行引擎、恢复引擎、路线选择与证据链各自的原生语义；
- 若先改底层命名，再补 projection，容易导致测试、事件、运行时控制、回放解释同时失稳；
- 因此当前正确顺序仍然是“保留旧命名 -> 增加高层投影 -> 再评估是否需要收敛”。

这份风险矩阵已经足以作为文档层“旧命名兼容风险说明”的完成版；但它不代表仓库里所有旧字段依赖点已经被逐文件盘点。

### 策略 2：优先做投影层和 view model

建议优先在以下位置引入 Drive State：

- 服务端 projection
- 前端任务详情 view model
- 驾驶舱状态摘要
- replay / audit 高层时间线

### 策略 3：允许阶段性“弱一致”

初期可以接受：

- 高层 Drive State 由多个底层信号推断
- 少数状态尚未有完整服务端事件支持
- 前端先做展示映射，后续再下沉到服务端

只要状态语义和迁移规则稳定，就可以分阶段演进。

## 风险与边界

### 风险 1：把 Drive State 误当成底层执行状态

如果直接要求每个 runtime 节点都强制落到一个 Drive State，会造成：

- 粒度不匹配
- 工程实现复杂度过高
- 状态语义反而混乱

### 风险 2：把 Replan 写成 Retry

如果无法区分重试和重规划，就会导致：

- 产品层看不出系统是否真正换路
- 审计层无法解释为什么结果突然变化
- 驾驶舱无法展示偏航修正能力

### 风险 3：只做前端状态，不做可回放证据

如果 Drive State 只在前端临时计算，而没有事件或投影证据：

- 回放无法复原状态变化
- 审计无法解释关键切换
- 用户信任感不足

## 设计结论

本 spec 的最终结论是：

1. `Drive State` 是任务自动驾驶的高层状态机解释层
2. 高层状态采用十态模型：
   - `understanding`
   - `clarifying`
   - `planning`
   - `fleet-forming`
   - `executing`
   - `reviewing`
   - `blocked`
   - `takeover-required`
   - `replanning`
   - `delivered`
3. `replanning` 必须作为独立状态存在，不能被 `retry` 或 `clarifying` 吞并
4. 状态机必须与 mission-first、Mission Runtime、workflow runtime、replay、audit、HITL 保持兼容
5. 初期应优先通过 projection 与 view model 落地，而不是立刻大规模重构底层命名

## 补充审计（2026-04-24）

在当前主仓里，本 spec 已经不仅停留在设计层定义，至少还有以下实现级支撑：

- `shared/mission/autopilot.ts` 已导出固定十态集合：
  - `understanding`
  - `clarifying`
  - `planning`
  - `fleet-forming`
  - `executing`
  - `reviewing`
  - `blocked`
  - `takeover-required`
  - `replanning`
  - `delivered`
- `inferMissionAutopilotDriveState()` 已把 mission facts 直接归并为高层状态：
  - `status === "waiting"` 且存在 decision 时归并为 `takeover-required`
  - `status === "waiting"` 但无 decision 时归并为 `clarifying`
  - `currentStageKey === "plan"` 且 `attempt > 1` 时归并为 `replanning`
  - `currentStageKey === "provision"` 归并为 `fleet-forming`
  - `currentStageKey === "execute"` 归并为 `executing`
  - `currentStageKey === "finalize"` 归并为 `reviewing`
- client store 与 `TaskAutopilotPanel` 已把该高层状态消费到任务详情与驾驶舱摘要中，说明“view model 先落地”的路线已被代码采用。

但本轮仍按保守口径保留以下边界：

- replay / audit 的高层状态时间线字段，仍主要停留在设计建议层，尚未形成端到端统一事件契约
- “旧命名依赖盘点”仍未形成专门文档或代码注释清单
- 十态虽已存在代码常量与推导逻辑，但并不代表所有 server/runtime/replay 页面都已统一消费该命名

## 复核审计（2026-04-25）

围绕本 lane 指定的实现与测试，可再保守补充一条已经落地的结论：`Drive State` 接入 replay / audit 时间线的“最小实现方案”已经具备可审计骨架，但仍停留在 projection/evidence 层，不应扩大解释为完整事件契约已完成。

- `shared/mission/autopilot.ts` 已在 summary 中稳定产出 `evidence.timeline` 与 `evidence.correlation`；后者包含 `workflowId`、`replayId`、`sessionId`、`routeIds`、`runtimeEventIds`、`decisionIds`、`operatorActionIds` 等可供 replay / audit 复用的最小索引字段。
- `server/tasks/mission-projection.ts` 会将上述 autopilot summary 挂到 projection，并通过 `alignAutopilotSummaryWithLinks()` 把解析出的 `workflowId / replayId / sessionId` 回填到 correlation 与 bindings，说明服务端最小接入点已经存在。
- `client/src/lib/tasks-store.ts` 继续保留并归一化 `evidence.timeline`、`evidence.correlation`、`route.replan`、`driveState`、`takeover` 等字段；`client/src/components/tasks/TaskAutopilotPanel.tsx` 则已实际展示 evidence correlation、timeline 预览、replan change summary、takeover 与 blocked 相关说明，形成前端消费闭环。
- 直接证据测试来自：
  - `shared/__tests__/mission-autopilot.test.ts`：覆盖 blocked / takeover / replanning 场景下的 evidence timeline 与 correlation 字段。
  - `server/tests/mission-routes.test.ts`：覆盖 projection 中 replay-aware correlation 字段、workflow-derived link 对齐、route replan 与 explanation remainingSteps 的联动。
  - `server/tests/hitl-decision.test.ts`：覆盖 waiting decision、resume、再次 waiting 与 timeout reject，证明 HITL / decision 链路能持续为 takeover/timeline 提供可投影事实。
  - `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`：覆盖 evidence correlation identifiers、indexed counts、timeline 片段、explanation currentState 与 recommendationDetails 的展示。

本轮仍明确保留以下边界，避免过度勾选：

- 当前证据证明的是“replay / audit 可先消费 projection/evidence 骨架”，不是“高层 Drive State 切换事件已经形成统一审计契约”。
- `auditEventIds` 与 `lineageIds` 在当前 shared 测试里仍多为空数组，说明审计链条尚未完整下沉到这一层。
- `server/tests/hitl-decision.test.ts` 主要证明 HITL / decision 事实可被后续投影消费，不足以单独证明 replay / audit 页面已全面接入高层 Drive State。
