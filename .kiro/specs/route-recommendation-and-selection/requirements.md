# 需求文档：路线推荐与路线选择

## 目标

定义 WhyBuddy 在“任务自动驾驶平台”中的路线推荐与路线选择交互，使用户在输入目标后，不是只看到一个隐式 workflow，而是能够看到候选路线、推荐原因、成本与时长预估、风险差异、切换规则，并在需要时接管路线选择。

本 spec 要直接对接当前仓库已存在的 mission-first 系统能力，包括：

- 办公室主壳与 `/tasks` 任务工作台
- 十阶段工作流引擎与 Mission Runtime
- Web-AIGC route family、runtime adapter、runtime governance
- wait / resume、review / audit / replay、human-in-the-loop
- 任务目标、任务状态、执行证据与回放链路

本 spec 的重点不是重新定义底层 graph 编排，而是把“路线”从隐式规划结果升级为可展示、可比较、可解释、可选择、可回放的产品对象。

## 当前系统边界（2026-04-23）

以下事实应作为本 spec 的现实基础：

- 当前系统已经具备 mission-first 的任务发起与执行主线，但“推荐路线”还没有成为用户可见的一等对象。
- 当前系统已经有十阶段工作流、Mission Runtime、review / audit / replay 等底座能力，可以承接路线解释、路线切换与路线证据。
- 当前 Web-AIGC 已形成 `58 / 58` specs 封板基线，多个 route family 与 runtime extra adapters 已进入主服务入口。
- 当前并不适合把所有路线选择都写成完全自动；在预算、权限、外部副作用、高风险动作场景下，仍需要明确人工接管与锁定规则。
- 当前“路线”的产品表达必须兼容现有 `Mission / Workflow / runtime` 结构，不能另起一套孤立模型。

因此，本 spec 必须支持：

- 多候选路线展示
- 路线差异解释
- 路线选择与切换
- 路线与 runtime / HITL / replay 的映射
- 路线推荐结果的治理与证据化

## 需求

### 需求 1：系统必须提供候选路线集合，而不是只给单一路线

系统必须在用户目标明确后生成一组候选路线，并至少支持以下三类路线表达：

- `最快`
- `最稳`
- `最深`

必要时允许系统扩展更多路线类型，但最少必须保证上述三类可用。

验收口径：

- 每次路线推荐至少应返回 1 条主推荐路线与 1 条以上候选路线。
- 当任务不适合生成完整三路线时，系统必须说明缺失原因，而不是静默省略。
- 路线类型必须是产品可理解的表达，而不是只暴露底层节点列表。

### 需求 2：每条路线必须给出推荐原因与差异解释

系统必须为每条候选路线提供推荐原因，使用户能够理解为什么系统会推荐这条路。

推荐原因至少应覆盖：

- 为什么适合当前任务目标
- 为什么比其他路线更快 / 更稳 / 更深
- 关键阶段差异
- 风险差异
- 是否需要更多接管

验收口径：

- 每条路线必须至少包含一段简明推荐理由。
- 路线之间必须支持差异解释，而不是只有独立描述。
- 推荐原因必须与现有任务上下文、任务类型、风险边界和自动驾驶等级保持一致。

### 需求 3：每条路线必须提供成本与时长预估

系统必须为每条候选路线提供可供比较的成本与时长预估，用于支持用户做出选择。

预估至少包括：

- 预计执行时长
- 预计成本等级或成本区间
- 预计步骤数或阶段复杂度
- 预计接管次数或确认点数量

验收口径：

- 预估必须能支持“横向比较”。
- 预估可以是区间、等级或经验值，不要求当前就做到精确计费。
- 预估逻辑必须能与 runtime、cost governance、route planner 未来对接。

### 需求 4：系统必须支持路线推荐与路线选择交互

系统必须允许用户在候选路线之间做出选择，并明确当前正在使用哪条路线。

路线选择交互至少包括：

- 展示默认推荐路线
- 支持查看其他候选路线
- 支持切换路线
- 支持恢复为系统推荐路线
- 支持确认后启动执行

验收口径：

- 未确认执行前，路线切换应被视为规划阶段操作。
- 已确认执行后，路线切换必须有明确限制，不得默默替换正在运行的执行链路。
- 当前选中路线必须在驾驶舱中持续可见。

### 需求 5：系统必须定义路线切换规则与锁定规则

系统必须明确定义什么阶段允许切换路线，什么阶段不允许切换，什么情况下需要接管确认。

至少需要覆盖：

- 任务尚未启动时的自由切换
- 任务执行前确认时的最终路线锁定
- 任务执行中的降级切换或重规划
- 命中高风险动作时的强制接管
- 已进入外部副作用阶段后的切换限制

验收口径：

- 必须区分“规划期切换”和“执行期重规划”。
- 执行期发生路线变化时，必须记录为显式事件，不能视为普通 UI 切换。
- 与预算、权限、风险动作有关的路线变化必须支持 HITL 与审计证据。

### 需求 6：路线推荐必须与 Route Planner 保持一致

系统必须说明路线推荐界面中的候选路线如何映射到 Route Planner 输出，不允许 UI 层自己虚构路线。

至少需要映射：

- 路线标识
- 路线类型
- 阶段序列
- 并行 / 串行结构
- 风险点
- 接管点
- 推荐分数或推荐优先级

验收口径：

- UI 显示的路线必须来源于 Route Planner 或其投影结果。
- 路线推荐文案可以被前端整理，但路线本体必须可回溯到 planner 输出。
- 路线选择后的结果必须能够反向写入 mission / workflow 上下文。

### 需求 7：路线选择必须与 Mission Runtime 对接

系统必须明确所选路线如何进入 Mission Runtime，并影响后续执行推进。

至少需要支持：

- 在任务启动前将已选路线绑定到任务上下文
- 在 runtime 中可读取当前选中路线
- 在需要时触发重规划或接管
- 在 replay 中回放路线选择与路线变化

验收口径：

- 路线选择结果必须能映射到 `Mission` 或 `Workflow` 级上下文。
- Runtime 必须能够知道“当前按哪条路线执行”。
- 运行中改线必须被记录为 runtime 级事件。

### 需求 8：路线推荐必须兼容 HITL、review、audit、replay

系统必须使路线推荐与路线选择天然进入接管、审计与回放链路。

至少应覆盖：

- 用户确认推荐路线
- 用户拒绝系统推荐路线
- 系统因风险触发路线降级
- 系统因结果质量问题触发重规划
- 最终交付采用了哪条路线

验收口径：

- 上述关键节点必须可被 replay / audit 消费。
- 路线选择与路线变化必须支持解释与追踪。
- 当前 spec 不要求一次性补齐所有后端字段，但必须定义清楚最小证据口径。

### 需求 4-8 的当前闭环边界（2026-04-25）

围绕“默认推荐 -> 规划期选择 -> 执行期改线 -> runtime 对接 -> `/tasks` / replay 消费”，当前仓库里已经被直接代码与直接测试证明的现实边界如下：

- 规划期当前已闭环的是“候选路线可见 + route-selection 决策可提交 + 结果可回投到 summary / projection / panel”；但“恢复系统推荐”与“确认后直接启动执行”的完整交互仍未落地。
- 执行期当前已闭环的是 `runtime_replanned` 这一条最小摘要链；“用户主动改线”与“系统降级改线”仍停留在设计语义或枚举口径，不能当成已实现能力。
- runtime 侧当前已闭环的是“路线事实可写入任务摘要、投影链路与证据关联索引”；但还没有直接证据证明 `Mission Runtime` 已正式消费 `selectedRouteId / selectionLocked / changedReason` 作为执行输入。
- `/tasks` 当前已有任务详情里的 route block 与 `TaskAutopilotPanel` 作为最小驾驶舱落点，但仍不是路线对比与确认的工作台级交互。
- replay / audit 当前已有 `route.evidence`、`decisionHistory` 与 `evidence.correlation` 的最小消费口径，但仍没有独立的路线时间线页面与交互回放。

为避免需求口径与现有实现错位，本组需求在当前阶段还应补充以下收口约束：

- “默认推荐规则”当前只能按两层理解：
  - 已实现层：`shared/mission/autopilot.ts` 输出 `candidateRoutes / recommendedRouteId / recommendationReasons` 的最小启发式闭环。
  - 设计待实现层：预算、治理、历史成功模式与自动驾驶等级共同参与的正式 planner policy。
- “规划期改线”当前只能按 `route-selection decision -> decisionHistory -> route summary -> mission projection -> panel` 这一条摘要链理解，不得外推为 `/tasks` 工作台已经具备“恢复推荐 / 确认执行”的 mutation 流。
- “执行期改线”当前只能按 `route.replan / route.evidence / explanation / orchestration.replan` 的最小摘要链理解，不得外推为 `Mission Runtime` 已支持用户主动改线、系统降级改线与系统重规划三类执行分支。
- “runtime 对接”当前应理解为路线事实已经进入 summary / projection / correlation 的共享数据面，而不是已经进入 `Mission Runtime` 的正式执行策略面。
- “工作台与回放交互”当前应理解为任务详情中的最小路线驾驶舱切片与 evidence/correlation 消费口径，而不是已经存在独立的多路线工作台与路线时间线页面。

### 需求 9：路线推荐必须兼容自动驾驶等级

路线推荐与选择必须能与 `task-autopilot-levels-l1-to-l5` 一致工作。

至少需要体现：

- 不同等级下推荐路线的默认策略不同
- 不同等级下允许的切换自由度不同
- 不同等级下允许的自动启动与自动改线边界不同

验收口径：

- `L1` 下推荐路线偏向建议与人工确认
- `L2` 下允许低风险路线自动推进，但关键点接管
- `L3` 下允许标准任务在默认路线下自动闭环
- `L4-L5` 不得被当前系统过度承诺

### 需求 10：路线模式必须有统一产品语义与过渡兼容层

系统必须为当前 route recommendation 中已经存在的路线模式建立统一产品语义，避免 `fast / standard / deep` 仅作为内部字符串存在。

最小要求包括：

- `fast` 对应“最快路线”的产品语义
- `standard` 对应“最稳路线”的当前过渡语义
- `deep` 对应“最深路线”的当前过渡语义
- 必须说明这些模式与未来 `fastest / safest / deepest` 等更明确命名之间的兼容关系

验收口径：

- 必须明确每种模式的目标、适用任务、风险边界和默认接管倾向。
- 必须明确当前为什么使用 `fast / standard / deep` 作为兼容层，而不是直接重命名 shared contract。
- 不得把“最稳”写成“最低成本”或把“最深”写成“默认无限制执行”。

### 需求 11：路线事件必须定义最小证据字段与选择历史口径

系统必须为路线推荐、路线选择、路线锁定与路线重规划定义最小证据字段，使 route lane 能被 projection、panel、audit 与 replay 共同消费。

最小事件必须覆盖：

- `route.recommended`
- `route.selected`
- `route.locked`
- `route.replanned`

最小证据字段至少包括：

- `eventType`
- `at`
- `actor`
- `reason`
- `fromRouteId`
- `toRouteId`
- `decisionId` 或可回溯的 route-selection 决策锚点
- `selectedRouteId / recommendedRouteId` 的关联口径

验收口径：

- 必须说明哪些字段已经由当前 `route.evidence`、`selection.*`、`decisionHistory` 与 `evidence.correlation` 近似承接。
- 必须明确当前还没有直接落地的字段，例如自动驾驶等级上下文与最终结果映射，不得冒充已实现。
- 必须区分“路线选择历史”与“Mission Runtime 已正式消费该路线”的语义边界。

## 路线类型要求

### 最快路线

定义：

- 优先追求更短时间到达结果，减少分析与复核深度，优先使用较短主路径。

典型特点：

- 阶段更少
- 并行度更高
- 结果偏草案或原型
- 接管点可能更少但结果稳定性较弱

适用场景：

- 快速出初稿
- 先出方案骨架
- 低风险内部试探性任务

边界：

- 不应默认用于高风险副作用任务
- 不应被描述成“最快且最稳”

### 最稳路线

定义：

- 优先追求可靠性、解释性、治理与可控性，在关键阶段增加 review、audit、确认与证据留存。

典型特点：

- 阶段更完整
- review / verify / HITL 更明显
- 接管点更清晰
- 时长与成本可能更高

适用场景：

- 高可控要求任务
- 对结果可信度要求高的任务
- 带治理约束与审批要求的任务

边界：

- 不应被描述成最低成本路线
- 在轻量任务中可能不是默认推荐

### 最深路线

定义：

- 优先追求分析深度、信息广度和结果完整度，允许更多检索、比较、迭代与多轮修订。

典型特点：

- 检索与分析阶段更长
- 更可能调用多节点、多工具、多轮总结
- 结果更完整，但时长与成本通常更高

适用场景：

- 深度研究
- 架构分析
- 综合方案设计
- 多源信息整合任务

边界：

- 不应在用户只需要快速交付时默认强推
- 不应绕过成本和预算约束

## 与当前系统的最低映射口径

为避免写成空话，本 spec 在当前仓库中的最低映射口径如下：

- 路线推荐结果应作为任务发起后的“规划对象”，对接 mission-first 主壳和 `/tasks` 工作台。
- 所选路线应映射到当前任务或 workflow 的上下文，而不是仅停留在前端内存。
- 运行中发生的改线、降级、重规划，应进入 runtime evidence，并在 replay / audit 中可见。
- 当前版本不要求已经具备精确成本预测或完整动态路线市场，但必须定义清楚可演进接口。

## 需求审计备注（2026-04-25）

本轮基于当前主仓中的直接代码与直接测试，对本 spec 的现实边界补一层保守校准：

- 当前已经存在一条稳定的最小路线摘要 contract：`shared/mission/autopilot.ts` 中的 `MissionAutopilotSummary.route` 已承载 `candidateRoutes`、`recommendedRouteId`、`selectedRouteId`、`selectionStatus`、`selectionLocked`、`selection.*`、`evidence.*` 与 `replan.*`。
- 当前已经存在一条稳定的 route-selection 投影链：`shared/__tests__/mission-autopilot.test.ts` 与 `server/tests/mission-routes.test.ts` 直接证明，resolved route-selection decision history 可以被提升为权威 `selectedRouteId` / `changedReason`，并在 `selectedRouteId` 缺失时从 decision payload 的 `candidateRoutes` 回填。
- 当前 task detail 层已经形成最小产品承载：`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 及其测试已稳定消费 `Selected / Recommended / Alternatives / Route Diff / Selection / Replan / Route Evidence`，因此“候选路线 + 已选路线 + 重规划摘要 + 证据关联”已经能在任务详情中被用户看见。
- 当前 route-selection 决策提交还会保留 `selectedRouteOptionId`、`selectedRouteLabel`、`selectedRouteId` 与 `changedReason`，但这些字段目前应被视为 route summary / evidence 的输入线索，而不是新的独立产品 contract。
- 当前默认推荐逻辑仍以 `shared/mission/autopilot.ts` 里的最小启发式为主，只能稳定说明 `mission.kind / waiting / risk / retry` 对 `fast / standard / deep` 的影响，尚未形成覆盖预算、治理约束与历史成功模式的正式推荐规则。
- 当前 `/tasks` 工作台的路线能力仍以任务详情中的 route summary 展示为主，还没有形成“多路线对比 -> 恢复推荐 -> 确认执行”的工作台级 mutation 流。
- 当前 replay / audit 侧已经能承接路线事件与关联索引，但还没有“初始推荐路线 -> 最终采用路线 -> 中途改线事件”的独立路线时间线 UI。
- 当前“首批试点任务计划”仍应视为设计范围，而不是已落地实现；按现有实现边界，更适合先从 `analysis / research / chat` 这类低副作用任务开始，`nl-command` 与更高风险外部副作用任务仍应后置。

本轮同时明确，以下需求边界仍未被直接代码 + 直接测试闭环支撑：

- `最快 / 最稳 / 最深` 的统一产品语义仍未跨页面、跨任务域固化。
- 与 `task-autopilot-levels-l1-to-l5` 的默认策略 / 切换边界映射尚未落地。
- 规划期“切换路线 -> 恢复推荐 -> 确认执行”的完整交互流尚未闭环。
- `Mission Runtime` 本体尚未被直接证明正式消费 `selectedRouteId`、锁定状态与改线原因作为执行输入。
- `/tasks` 工作台的路线对比确认交互与 replay 页面的路线时间线尚未落地。

## 需求审计备注（2026-04-26，按 design 闭环补记）

本轮在不新增代码事实的前提下，把 route lane 里若干长期未完成的大项补到了“需求与设计已闭环”的程度。这里的“闭环”仅指本 spec 已经把目标、边界、输入输出合同与非目标写清，不代表对应 shared / server / client 功能已经实现。

本轮新增明确的需求闭环包括：

- `最快 / 最稳 / 最深` 的统一产品语义
  - 要求现在不仅说明三条路线分别代表什么，还要求解释当前 `fast / standard / deep` 兼容层为何存在，以及与未来更明确命名的兼容边界。
- 与 `task-autopilot-levels-l1-to-l5` 的映射
  - 要求 route lane 自身就能说明不同等级下默认推荐倾向、切换自由度与自动改线边界，而不是完全依赖外部 spec 补语义。
- 默认推荐规则
  - 要求把治理前置条件、自动驾驶等级、任务类型、风险与治理强度、预算与时长约束、历史成功模式的优先级说明清楚。
- 规划期切换与执行期改线
  - 要求分别定义规划期的四步流程与执行期三类改线路径，并明确哪些动作必须走 mutation、哪些必须走 takeover。
- 高风险接管、runtime 对接、事件证据字段
  - 要求 route lane 自身定义高风险门控矩阵、Mission Runtime handoff 顺序，以及路线事件的最小字段和扩展字段。
- `/tasks` 交互、replay 时间线与试点清单
  - 要求给出工作台和回放的设计态输入约束、动作合同、展示节点，以及首批试点任务的准入/退出条件。

本轮同时继续保守保留以下现实边界：

- 当前真正已被代码证明的仍是 `route summary / projection / panel / evidence` 最小闭环；
- `Mission Runtime` 仍未被直接证明正式消费 route selection 作为执行输入；
- `/tasks` 工作台与 replay 路线时间线仍是设计态，不是现有页面；
- 默认推荐完整 policy、系统降级改线与工作台 mutation 流仍不得表述为已实现。

## 依赖关系

本 spec 依赖但不替代以下后续 specs：

- `task-autopilot-core-concepts`
- `task-autopilot-levels-l1-to-l5`
- `destination-model-and-parser`
- `route-planner-and-route-model`
- `drive-state-and-replan-state-machine`
- `takeover-panel-and-decision-points`
- `autopilot-runtime-orchestration`
- `autopilot-evidence-replay-and-trust-chain`

本 spec 的作用是：

- 把 Route Planner 的结果变成产品可见的路线卡片
- 为驾驶舱中的路线比较、路线选择、路线切换、路线解释提供统一边界
- 为 runtime、HITL、replay 与 audit 提供路线层面的对接口径
