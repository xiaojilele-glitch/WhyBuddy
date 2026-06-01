# 需求文档：Mission 模型到任务自动驾驶模型映射

## 目标

为 WhyBuddy 当前已经存在的 `Mission / Workflow / Runtime State / Decision-HITL` 体系，定义一层面向“任务自动驾驶”产品叙事的上层映射模型，使系统可以在不破坏现有工程主干的前提下，对外表达为：

- 用户输入的是“目的地”而不是单次 prompt
- 系统生成的是“路线”而不是仅供工程使用的工作流定义
- 系统展示的是“驾驶状态”而不是分散的内部运行态
- 人机协同发生在“接管点”而不是若干零散的人工审批节点

本 spec 的重点不是创建一套全新底层运行时，而是建立一套稳定、可解释、可逐步落地的映射层。

## 背景

当前主仓已经具备以下真实基础：

- Mission-first 的任务入口与任务工作台
- 基于 Workflow 的编排与执行
- Runtime State、Review、Audit、Replay、Lineage 等运行与治理能力
- 人工确认、人工输入恢复、决策节点、审批链路等 HITL 机制
- Web-AIGC 侧大量节点、平台协议与运行时适配能力

这些能力已经足以支撑“任务自动驾驶”产品概念，但当前系统仍主要以工程对象组织认知：

- `Mission`
- `Workflow`
- `Runtime State`
- `Decision / HITL`

为了升级产品叙事，需要引入新的用户态概念：

- `Destination`
- `Route`
- `Drive State`
- `Takeover`

本 spec 用于规定这两套概念之间的关系和边界。

## 范围

本 spec 包含：

- 现有模型到自动驾驶模型的概念映射
- 映射后的对象职责与展示语义
- 对前端、运行时、治理层的兼容约束
- 逐步迁移原则

本 spec 不包含：

- 对底层 TypeScript 领域模型的大规模即时重命名
- 对现有 runtime engine 的推翻式重构
- 对所有 Web-AIGC 节点的一次性代码改造
- 对 UI 的完整视觉设计细节

## 需求

### 需求 1：系统必须提供稳定的概念映射层

系统必须明确规定以下核心映射关系：

- `Mission -> Destination`
- `Workflow -> Route`
- `Runtime State -> Drive State`
- `Decision / HITL -> Takeover`

该映射层必须能够被产品文档、交互设计、前端页面、运行时投影与治理文档一致复用，而不是每个模块各自解释。

### 需求 2：Mission 必须被解释为 Destination 的底层承载体

系统必须将当前 `Mission` 模型解释为自动驾驶语义中的“目的地承载对象”，但不得简单等同。

映射要求：

- `Mission` 仍然是工程主干中的事实对象
- `Destination` 是用户态和产品态的高层投影
- 一个 `Destination` 至少应包含：
  - 目标
  - 约束
  - 成功标准
  - 缺失信息
  - 预期交付物
- `Mission` 中已存在的输入、上下文、元数据、任务目标，应可被投影为 `Destination` 内容

同时系统必须允许在未来逐步增强 `Destination`，而不要求现有 `Mission` 模型一次性完全重构。

### 需求 3：Workflow 必须被解释为 Route 的底层执行骨架

系统必须将当前 `Workflow` 模型解释为自动驾驶语义中的“路线骨架”。

映射要求：

- `Workflow` 保持底层执行定义角色
- `Route` 作为用户可理解的执行路径表达
- `Route` 至少应具备以下可读信息：
  - 主路线
  - 可选路线或替代路线
  - 阶段划分
  - 并行与串行安排
  - 风险点
  - 接管点
- 一个 `Route` 可以由一个或多个 `Workflow` 片段、执行阶段、治理控制点共同组成

系统不得要求先废弃现有 `Workflow` 才能引入 `Route`。

### 需求 4：Runtime State 必须被统一投影为 Drive State

系统必须将当前分散在运行时、任务实例、节点状态、审计状态中的执行态信息，统一映射为用户可理解的 `Drive State`。

`Drive State` 至少应能表达：

- 当前处于哪个任务阶段
- 当前系统在做什么
- 当前是否阻塞
- 当前是否等待用户输入
- 当前是否发生偏航或重规划
- 当前是否已接近交付
- 当前置信度与风险级别

系统必须允许多个底层运行态共同映射到一个更高层的 `Drive State`，而不是要求一一对应。

### 需求 5：Decision / HITL 必须被提升为 Takeover 语义

系统必须把现有的人工确认、人工输入恢复、审批、分支决策等机制，统一解释为自动驾驶语义中的 `Takeover`。

`Takeover` 至少应覆盖：

- 方向确认
- 预算确认
- 权限确认
- 风格或策略选择
- 外部信息补充
- 最终结果确认
- 异常接管

系统必须保留现有 `Decision / HITL` 的执行真实性，但在产品层统一呈现为“接管点”。

### 需求 6：映射层必须强调兼容优先，而不是命名替换优先

系统必须明确以下兼容原则：

- 不建议立刻在底层代码中大规模将 `Mission / Workflow / Runtime` 重命名为 `Destination / Route / Drive`
- 优先新增映射层、投影层、展示层
- 在现有 API、测试、运行时稳定之前，不以改名代替建模
- 对外叙事可以先升级，对内工程主干保持稳定

本需求的目标是降低概念升级带来的重构风险。

### 需求 7：映射规则必须支撑前端驾驶舱表达

系统必须保证映射结果能够支撑后续驾驶舱产品形态，至少服务于以下展示对象：

- 目的地卡片
- 推荐路线
- 当前驾驶状态
- 当前车队或执行角色摘要
- 接管点面板
- 证据与回放入口

这意味着映射层不能只停留在文档定义，还必须足够稳定，可以被前端信息架构消费。

### 需求 8：映射层必须支持 Web-AIGC 节点体系的兼容吸收

系统必须允许现有 Web-AIGC 节点、平台运行时能力和治理机制继续存在，并被重新包装进自动驾驶叙事中。

具体要求：

- 节点仍作为内部编排单元存在
- 对外优先表达为路线阶段与车队角色
- 不要求把 50+ 节点直接暴露给用户
- 可以在后续 spec 中继续扩展为“节点角色分类”或“车队编组策略”

保守验收口径：

- 首版附录至少应提供一张“节点家族 -> 路线阶段 / 车队角色”的粗粒度包装矩阵，覆盖当前仓库里已经反复出现的几类节点族：
  - 目标理解 / 路线建议
  - 用户输入 / 参数收集
  - 选择 / 确认
  - 搜索 / 检索 / 问答
  - 生成 / 文件输出
  - 外部动作 / 页面控制
  - 审核 / 判断
  - 审计 / 治理 / 证据
  - 编排 / 分支同步
- 这张矩阵可以按“节点家族级”完成，不要求把 50+ 节点逐个列全，但必须说明：
  - 优先包装到哪个 `Route stage`
  - 优先包装到哪个 `Fleet role`
  - 当前事实是如何进入 `Mission / Decision / Route / Takeover` 链路的
- 文档必须同时区分：
  - 当前已能被 shared / server / test / README 直接支撑的家族级包装口径
  - 仍需在 `fleet-organization-and-role-packaging` 或更细的 route-stage / runtime-node-family specs 中继续展开的逐节点目录

### 需求 9：映射层必须可被分阶段落地

系统必须支持以下分阶段推进方式：

- 第一阶段：文档与概念层统一
- 第二阶段：前端投影与展示层接入
- 第三阶段：运行时状态投影与事件解释增强
- 第四阶段：逐步引入更细的路线、接管、风险、重规划对象

系统不应把“自动驾驶模型引入”设计成一次性大迁移项目。

## 验收标准

- 存在一份明确的中文设计文档，解释四组核心映射关系
- 文档中明确写出兼容原则，不建议立刻大规模底层改名
- 文档中明确区分“产品态对象”和“工程态对象”
- 文档中能解释为什么当前系统可以在不推翻主干的前提下升级为任务自动驾驶叙事
- 存在一份未完成 checklist，用于后续逐步实现和接入

## 当前主仓对齐备注（2026-04-25）

- 当前主仓已经形成一条稳定的最小投影闭环：`shared/mission/autopilot.ts` 负责从 `MissionRecord` 生成 `autopilotSummary`，`server/tasks/mission-projection.ts` 负责将该 summary 挂载到 `MissionProjectionView`，前端 `tasks-store` 与 `TaskAutopilotPanel` 再以消费层身份兼容读取 `destination / route / driveState / takeover`。
- 当前可以直接保守认定已落地的是“最小展示级 mapping”，而不是完整的领域迁移包；也就是说，本 spec 需要兼容“投影已存在、工程命名仍旧保留”的双层事实，而不能把文档写成底层对象已经全面改名。
- 当前 `Destination` 已能稳定承载 `goal / request / constraints / successCriteria / deliverables / missingInfo / confidence / missingInfoDetails`；但 `MissionRecord` 的更多上下文，如 `organization / workPackages / messageLog / autonomy / instance` 等仍未被统一审计进正式总映射表。
- 当前 `Route` 已能稳定承载 `id / label / mode / status / currentStageKey / currentStageLabel / stages / riskPoints / takeoverPointIds / candidateRoutes / selection / evidence / replan`；但它仍更多是基于 `mission.stages / decision / decisionHistory / blocker / operatorActions / projection.workflowId` 的高层归纳，而不是对 `Workflow` 结构体字段的完整逐项展开。
- 当前 `Drive State` 与 `Takeover` 已属于共享 builder 直接产出并有直接测试支撑的对象，因此这两支分支可以比 `Mission -> Destination`、`Workflow -> Route` 更保守地视为“规则层已经落地”。
- 当前 `Web-AIGC` 兼容链条已有直接事实，但更多体现为“节点/HITL 元数据被 Mission/Decision 吸收后，再进入 autopilot 投影”，而不是“节点层已经存在单独的 autopilot product object”。因此，本 spec 对 Web-AIGC 的要求应写成“兼容吸收与重新包装原则”，而不是“节点映射实现已全部完成”。

## 补充收口说明（2026-04-25，lane）

本轮对齐的核心，不是扩大“已经实现”的声明范围，而是把当前真实落地部分和仍待补齐部分分层写清：

- 当前可以保守收口到 spec / design 层的部分
  - `Mission -> Destination` 的最小字段映射表
  - `Workflow / Runtime / Decision -> Route` 的最小映射表
  - 面向 Web-AIGC 节点体系的兼容吸收附录
  - 一版节点家族到路线阶段 / 车队角色的首版包装矩阵
- 当前仍不能外推为实现已完成的部分
  - `MissionRecord` 全字段到 `Destination` 的完整总表
  - `Workflow definition / branching / parallel groups` 到 `Route` 的完整结构总表
  - Web-AIGC 50+ 节点逐节点到路线阶段或车队角色的正式落地映射

因此，本 spec 当前可以被理解为：

- 文档层已经能够说明“当前主仓如何把 Mission-first 工程对象重新解释为任务自动驾驶产品对象”
- 实现层已经具备一条最小可消费投影链
- 但完整映射附录、完整字段审计与大规模命名迁移仍属于后续阶段

## 补充复核边界（2026-04-26）

基于当前主仓里可直接核对的 shared / server / test / README 证据，这份 mapping spec 继续收口时需要保持以下边界：

- `Mission -> Destination` 当前已经不仅有“最小展示结构”，还具备一份可直接追溯到 builder 的字段映射总表基础：
  - `mission.id`
  - `mission.title`
  - `mission.sourceText`
  - `mission.kind`
  - `mission.projection?.sourceApp`
  - `mission.securitySummary?.level`
  - `mission.artifacts`
  - `mission.workPackages`
  - `mission.waitingFor`
  - `mission.blocker`
  - `mission.decision`
  - `mission.summary`
  - `mission.events`
- 但它仍不是“MissionRecord 全字段全面落表”，因此文档可以收口为“核心字段、状态与上下文来源的首版映射总表”，不能外推为所有 Mission 扩展字段都已经进入 `Destination`。

- `Workflow -> Route` 当前已经不仅是“一个展示对象”，还能够明确拆成几类结构来源：
  - `workflowId / projection links` 提供路线身份锚点
  - `mission.stages / currentStageKey` 提供阶段骨架
  - `decision / decisionHistory / candidateRoutes / formData` 提供路线选择与替代路线语义
  - `operatorActions / blocker / attempt / evidence` 提供 route replan、risk、lock 与 route evidence
  - `GraphInstanceSnapshot.nodeRuns / edgeTransitions / telemetry.currentStage` 提供 workflow graph 侧的结构术语锚点
- 但这仍不等于“完整 workflow definition / branching / parallel groups 总表”已经完成；因此若勾选，也只能勾到“当前主仓中的定义结构、阶段语义、分支与并行能力已形成首版映射表”，不能扩大为“完整工作流建模审计已结束”。

- Web-AIGC 相关证据当前已足以支撑“兼容吸收附录”，包括：
  - `WEB_AIGC_HITL_NODE_TYPES`
  - `WebAigcHitlFieldDefinition`
  - `WebAigcHitlFormData`
  - `WebAigcHitlSubmissionMetadata`
  - `MissionDecisionSubmission.metadata`
  - `MissionDecisionResolved.metadata`
  - `DecisionHistoryEntry.nodeType / nodeId / interactionId / branchKey`
  - runtime tests 中的 `selection / confirm_judge / param_collection`
- 结合 `.kiro/specs/fleet-organization-and-role-packaging/` 已收口的“节点家族 -> 角色家族初步分类表”与“路线阶段驱动角色启停”设计，以及 README 当前对 `Fleet` 的术语定义，这些证据现在已经足以支撑“节点家族级”的首版附录：
  - 说明节点为什么不直接暴露给用户
  - 说明它们优先被包装到哪些 `Route stage`
  - 说明它们优先被包装到哪些 `Fleet role`
- 但这些证据仍不足以直接证明以下更强结论：
  - 50+ 节点已经完成逐节点正式目录
  - shared / server 已稳定产出逐节点 `Route stage / Fleet role` 投影
  - 节点级 runtime 状态已经完整进入 autopilot product objects

- README 的当前术语锚点已经与本 spec 口径一致：
  - `Destination` 是用户目标的结构化对象
  - `Route` 是带 stages / candidate routes / risks / takeover points / replans 的执行路径
  - `Drive State` 是高层状态机
  - `Takeover Point` 是统一的人机接管语义
- 因此，这份 spec 现在可以被视为 README / 架构图 / 驾驶舱 IA 的稳定术语源之一，但仍应保留“产品态对象 vs 工程态对象”的双层说明。
