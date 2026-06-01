# 需求文档：路线规划器与路线模型

## 目标

本 spec 定义“任务自动驾驶”中的 Route 对象与 Route Planner 规划机制，使用户输入的 Destination 能被系统转换为：

- 可解释：用户能理解系统为什么推荐这条路线；
- 可比较：用户能看见主路线与候选路线的差异；
- 可执行：路线能映射到现有 Mission Runtime、workflow 与控制面；
- 可接管：用户能在关键节点接管、确认、改线或放行；
- 可回放：路线规划、路线切换、重规划与证据链可进入 replay / audit / telemetry。

Route 不是替代现有 `mission / workflow / runtime` 的底层实现，而是覆盖在其上的产品层与计划层抽象。

## 范围与边界

本 spec 解决的是“Route 作为计划对象”的定义、投影与治理边界，重点包括：

- RouteSet / Route / RouteStage / RouteStep / RouteRisk / RouteTakeoverPoint 等目标模型；
- Route Planner 的输入、输出与组件拆分；
- 路线模式、候选路线、推荐逻辑、风险点、接管点与重规划语义；
- Route 与现有 Mission Runtime、workflow runtime、HITL、recovery、evidence 的映射；
- replay / audit / telemetry 的目标快照模型与测试计划。

本 spec 不直接宣称以下能力已经在主仓代码中完整落地：

- 独立持久化的 `RouteSet / Route / RouteRisk / RouteTakeoverPoint / RouteReplanRecord`；
- 结构化 `RouteStep` 拓扑在 runtime 中被直接消费执行；
- replay / audit 中的独立 Route 快照存储；
- 结构化 risk / takeover / replan 记录在 shared / server / client 全链路真实落地。

## 背景

WhyBuddy 当前已经具备以下基础：

- mission-first 的任务启动与执行语义；
- 十阶段 workflow pipeline；
- Web-AIGC 节点编排与运行时节点适配器；
- `WAITING_INPUT -> resume()` 的人工恢复链路；
- `retry / terminate / escalate / replan` 的最小控制面；
- evidence / telemetry / replay / audit 的观测底座；
- `MissionAutopilotSummary.route` 为核心的最小 route projection contract。

但在产品表达上，用户仍然更容易看到“任务、节点、执行状态”，而不是“目标、路线、风险、接管点、偏航与改线”。本 spec 要补齐的就是 Route 这一层。

## 当前主线最小 Contract

当前仓库里已被 shared / server / client / tests 共同锚定的最小 Route contract 主要是 `MissionAutopilotSummary.route` 及其关联字段，而不是独立 Route 领域模型。当前稳定可读的字段包括：

- `destination.id / goal / request / constraints / successCriteria / deliverables / missingInfo`
- `route.id / label / mode / status / progress / currentStageKey / currentStageLabel / stages`
- `route.riskPoints / route.takeoverPointIds`
- `route.recommendedRouteId / route.selectedRouteId / route.candidateRoutes`
- `route.selectionStatus / route.selectionLocked / route.selection.*`
- `route.evidence.* / route.replan.* / route.changeReason`
- `takeover.required / blocking / type / reason / prompt / options / urgency`
- `execution.currentStep* / parallelBranchCount / availableActions`
- `recovery.state / deviationCategory / suggestedActions`
- `evidence.correlation.*`
- `explanation.recommendationDetails / remainingSteps / evidenceHints`

本 spec 的设计必须兼容这套最小 contract，并明确“当前最小投影”与“目标领域模型”的分层关系。

## 核心术语

### Destination

用户输入后被系统理解出的目标对象，包含目标、约束、成功标准、缺失信息与预期交付物。

### RouteSet

一次路线规划的结果集合，包含一条推荐路线与若干候选路线，以及本次规划的上下文、版本和证据摘要。

### Route

系统为完成 Destination 生成的路线计划，包含阶段、步骤、并行/串行关系、风险点、接管点、估算、映射与治理策略。

### 主路线

系统默认推荐执行的路线。

### 候选路线

与主路线并列、可比较、可切换、可保留证据的替代路线。

### 路线阶段

面向用户和驾驶舱展示的高层阶段，例如理解、澄清、规划、编队、执行、复核、交付。

### 路线步骤

Route 中可展示、可执行、可审计的最小计划步骤。路线步骤不是底层 DAG 节点本身，但需要能映射到底层执行对象。

### 风险点

Route 中可能导致失败、偏航、成本超限、权限不足、结果不可信或需要人工判断的位置。

### 接管点

Route 中必须或建议用户介入的位置，包括澄清、路线选择、权限确认、预算确认、风险接受、结果验收与人工接管。

### 重规划

当路线选择、上下文、风险、阻塞、runtime 恢复策略或用户接管发生变化时，对当前路线做偏航说明、改线、生成新路线或升级接管的机制。

## 需求

### 需求 1：系统必须定义 Route 领域模型与当前最小投影之间的边界

系统应同时定义目标 Route 领域模型与当前主线最小 projection contract，并明确二者的对齐关系。

验收标准：

- 文档必须明确定义 `RouteSet`、`Route`、`RouteStage`、`RouteStep`、`RouteRisk`、`RouteTakeoverPoint`、`RouteRuntimeMapping`、`RouteReplanRecord` 等目标对象。
- 文档必须明确当前主线最小 contract 以 `MissionAutopilotSummary.route` 为中心，而不是误写成独立 Route 存储已落地。
- 文档必须给出“目标模型 -> 当前最小 projection”之间的字段映射与缺口说明。
- 文档必须明确哪些能力已经有 shared / server / client / tests 锚点，哪些仍属于后续实现目标。

### 需求 2：系统必须支持 RouteSet、主路线与候选路线

系统应在规划阶段生成 RouteSet，其中至少包含一条推荐路线，并在合适场景下提供候选路线。

验收标准：

- RouteSet 必须包含唯一标识、`destinationId`、`recommendedRouteId`、路线集合、规划版本和规划上下文摘要。
- 主路线必须有明确推荐理由。
- 候选路线必须能解释与主路线的差异，包括速度、成本、质量、风险、自动化程度与接管强度。
- 未被选择的候选路线必须保留为规划证据，而不是被静默丢弃。
- 当前主线最小 contract 至少要能表达 `recommendedRouteId`、`selectedRouteId`、`candidateRoutes`、`selectionStatus` 与 `selection.*`。

### 需求 3：系统必须定义 Route Planner 的规划流程

系统应把规划流程拆成清晰、可解释、可演进的组件，而不是把推荐逻辑全部隐藏在单个 builder 中。

验收标准：

- 文档必须定义 `Destination Analyzer`、`Route Candidate Builder`、`Risk Evaluator`、`Takeover Point Generator`、`Runtime Mapping Builder`、`Recommendation Selector` 的输入、输出与职责边界。
- 文档必须说明这些组件如何消费 Destination、governance hint、runtime 绑定与历史上下文。
- 文档必须说明当前主线哪些字段由 builder 直接生成，哪些属于未来 planner 分层后的目标职责。
- 文档必须说明规划流程输出如何兼容当前 `MissionAutopilotSummary.route` 投影。

### 需求 4：系统必须支持快速 / 标准 / 深度 / 自定义路线模式

Route Planner 应至少支持四种路线模式，并明确各模式的产品语义和治理差异。

验收标准：

- `fast` 应优先减少步骤、等待与接管密度，适合低风险、快速交付类任务。
- `standard` 应作为默认模式，平衡质量、速度、成本与可控性。
- `deep` 应强化研究、复核、证据、治理与多轮修正。
- `custom` 应保留为用户、策略或模板驱动的扩展模式。
- 文档必须明确四种模式与 workflow 阶段启用策略、Fleet 规模、接管密度、风险阈值和治理强度的对应关系。

### 需求 5：系统必须支持并行 / 串行表达与运行时降级

Route 必须能表达依赖关系、并行组、汇总点以及运行时不具备真实并行能力时的降级策略。

验收标准：

- RouteStep 必须能声明 `dependencies`。
- Route 必须支持 `parallelGroups`、`join / merge` 与 `fallbackMode`。
- 文档必须定义并行降级原因、降级记录和对前端摘要的影响方式。
- 文档必须说明当前主线只有 `parallelBranchCount` 摘要，而非结构化并行图已落地。

### 需求 6：系统必须定义结构化风险模型

系统应在规划阶段识别并记录风险点，使其能影响推荐、接管、治理和解释链。

验收标准：

- 风险点必须包含风险类型、严重程度、触发条件、影响范围、处理建议、是否需要接管。
- 风险类型至少覆盖上下文不足、权限不足、成本超限、质量不确定、外部工具失败、数据可信度不足、长耗时、策略敏感。
- 文档必须明确风险点如何影响路线推荐、接管点生成和治理强度。
- 文档必须明确当前主线仅有 `route.riskPoints: string[]` 摘要，而不是结构化 `RouteRisk[]` 已落地。

### 需求 7：系统必须定义结构化接管模型

系统应在路线中标出需要用户介入的位置，并明确接管原因、动作、强度与运行时桥接方式。

验收标准：

- 接管点必须包含接管类型、触发条件、推荐动作、默认动作、是否阻塞、超时策略与运行时决策引用。
- 接管点类型至少覆盖澄清、路线选择、权限确认、预算确认、风险接受、结果验收、人工接管。
- 文档必须说明接管点如何映射到现有 `decision / WAITING_INPUT / resume() / escalate()` 机制。
- 文档必须区分“必须接管”与“建议接管”的设计语义。
- 文档必须明确当前主线已有的是 takeover summary contract，而非结构化 `RouteTakeoverPoint[]` 已落地。

### 需求 8：系统必须定义 Route 到现有 runtime 的映射

Route Planner 不应绕开现有执行系统，而应把 Route 与当前主仓已有能力对齐。

验收标准：

- RouteStage 必须能映射到现有 mission / workflow 阶段语义。
- RouteStep 必须能映射到 workflow node、runtime adapter、agent action 或人工决策点。
- Route 的失败恢复必须能映射到 `retry / terminate / escalate / replan`。
- Route 的状态变化必须能通过 runtime event 投影回 route summary、evidence 与 explanation。
- 文档必须明确当前主线“已落地的是 stage summary + control summary + evidence projection”，而不是 step 级运行时映射已完整实现。

### 需求 9：系统必须支持重规划机制

系统应在执行偏航、信息变化、工具失败、恢复策略或用户改线后支持重规划。

验收标准：

- 文档必须定义重规划触发条件、重规划输出、重规划结果类型与恢复决策边界。
- 文档必须定义 `RouteReplanRecord`、前后快照、变更摘要、保留证据索引和前端可见差异。
- 当前主线最小 contract 至少要输出 `selectionStatus = replanned`、`route.replan`、`route.evidence.events[eventType=route.replanned]` 与 `explanation.remainingSteps.replanChangeSummary`。
- 文档必须明确当前主线还没有独立持久化的 `RouteReplanRecord` 与 replan snapshot 存储。

### 需求 10：系统必须支持驾驶舱展示、审计回放与测试收口

Route 既要服务于驾驶舱，也要服务于 replay / audit / telemetry 与后续实现验证。

验收标准：

- 文档必须定义面向驾驶舱的 route 摘要字段，包括主路线、候选路线、当前阶段、当前步骤、风险数量、接管数量、剩余步骤、时间/成本摘要、推荐理由、route diff 与 route evidence。
- 文档必须定义审计 / 回放所需的输入快照、执行快照、重规划快照、事件关联键与证据来源。
- 文档必须定义测试计划，覆盖路线模式、候选路线、并行降级、风险生成、接管生成、runtime 映射、重规划记录与审计快照。
- 文档必须明确“spec 勾选完成”与“代码实现完成”不是同一层含义。

## 2026-04-25 收口说明

- 当前主仓已经稳定落地的是 `MissionAutopilotSummary.route` 周边的 route summary / projection contract，而不是独立持久化 Route 领域模型。
- 本轮 requirements 收口的原则是：继续保留完整 Route Planner 目标模型，但明确把当前主线“已直接证据锚定”的部分限定为 shared / server / client / tests 已共同覆盖的最小字段集合。
- 因此，requirements 中凡是出现 `RouteSet / Route / RouteRisk / RouteTakeoverPoint / RouteReplanRecord / RouteStep topology / replay snapshot` 的内容，默认都应被理解为“目标设计模型”；只有显式写明“当前主线最小 contract”的字段，才代表仓库已经存在可直接消费的事实来源。
