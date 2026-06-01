# 设计文档：任务自动驾驶 L1-L5 分级

## 设计概述

`task-autopilot-levels-l1-to-l5` 的设计目标，不是再造一套新的底层执行引擎，而是在现有 mission-first 系统之上增加一层“自动驾驶等级语义层”。

这层语义层需要满足三个条件：

1. 对产品层可理解
   用户、运营、设计、文档都能理解每个等级意味着什么。

2. 对运行时可投影
   每个等级都能映射到现有 `Mission / Workflow / Mission Runtime / HITL / review / audit / replay` 链路。

3. 对治理可校验
   每个等级都能用风险边界、接管要求、证据留存来验证，而不是停留在口号层。

因此，本设计采用“产品层等级 + runtime 投影 + 治理证据”三层结构。

## 设计原则

### 1. 不重写现有 mission-first 对象模型

当前仓库已经形成较稳定的：

- `Mission`
- `Workflow`
- `Mission Runtime`
- 十阶段工作流
- Web-AIGC runtime adapter
- HITL / review / audit / replay

本设计不要求把这些对象直接重命名为 `Destination / Route / DriveState`。
L1-L5 应作为产品层与治理层的等级标签，先映射到现有系统，再决定是否需要后续深层重构。

### 2. 等级是“任务执行承诺”，不是“模型能力幻觉”

同一个模型、同一个节点，在不同任务域、不同风险策略、不同路线下，可处于不同自动化等级。
因此等级判定不应只依赖模型本身，而应综合考虑：

- 任务类型
- 路线复杂度
- 节点族
- 风险等级
- 接管策略
- 证据链完整性

### 3. 等级可以按任务和阶段分别投影

整体任务可声明一个目标等级，但具体阶段可能发生降级。

例如：

- 任务以 `L3` 启动
- 在低风险检索和生成阶段维持 `L3`
- 遇到外部写操作或高风险动作时降级到 `L2`
- 等待人工确认后再继续

因此，设计上必须支持：

- 任务级自动化等级
- 阶段级自动化等级
- 节点 / 动作级接管判定

## 等级模型

### 0. 与 `task-autopilot-core-concepts` 的统一术语锚点

为避免 L1-L5 分级成为另一套孤立名词，本 spec 统一复用 `task-autopilot-core-concepts` 已定义的产品层术语，并只补“在等级语义中的约束含义”：

| 核心术语 | 在本 spec 中的等级语义 |
| ---- | ---- |
| `Destination` | 决定任务目标、约束、交付要求与是否允许更高等级自动化的前提 |
| `Route` | 决定任务在不同等级下允许自动推进到什么程度，以及何时必须请求接管 |
| `Drive State` | 决定当前等级是在自动推进、降级、接管还是重规划中生效 |
| `Fleet` | 决定不同等级下可调用的角色、节点族、工具与执行器范围 |
| `Takeover` | 决定不同等级下哪些动作必须人工确认，哪些只需建议接管 |

### 1. 等级实体

建议在产品与运行时语义上引入 `AutopilotLevel` 枚举：

- `L1`
- `L2`
- `L3`
- `L4`
- `L5`

该枚举可被以下场景共享：

- 任务发起表单
- 路线推荐面板
- 驾驶舱状态栏
- 运行时上下文
- 审计与回放元数据

### 2. 等级维度

每个等级不只是一行标签，而是由以下维度组成：

- `automationScope`
  - 允许系统自动完成哪些动作
- `takeoverPolicy`
  - 何时必须接管
- `taskScope`
  - 适用任务范围
- `riskBoundary`
  - 风险允许边界
- `deliveryPolicy`
  - 结果是否可自动交付
- `evidenceRequirement`
  - 需要记录哪些证据

### 2.1 L1-L5 总览矩阵

| 等级 | 自动化能力 | 接管要求 | 适用任务范围 | 风险边界 | 交付策略 | 证据要求 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `L1` | 自动理解目标、推荐路线、生成任务与执行草案 | 正式执行前必须人工确认；所有外部副作用动作必须接管 | 方案规划、任务拆解、研究路线建议、内容生产前置规划 | 允许推荐，不允许默认触发高风险执行 | 输出路线草案和建议，不直接自动送达真实执行结果 | 保存推荐路线、建议理由、用户最终选择 |
| `L2` | 在主路线下自动执行低风险检索、总结、结构化生成与局部重试 | 预算跃迁、权限升级、外部写操作、宿主动作必须接管 | 标准问答、报告初稿、常规方案整理、轻量内容编排 | 可自动处理低风险失败，不可越过权限、预算和外部副作用边界 | 可自动形成阶段性结果，交付前通常建议人工确认 | 保存接管点、阻断动作与原因、自动推进和人工确认交界点 |
| `L3` | 自动选择默认路线、自动编队、自动重规划、自动 review / revise，并在标准任务内闭环 | 预算超阈值、置信度过低、权限不足、外部副作用超界、结果复核失败时接管或降级 | 标准化内容生产、模板化研究分析、可复用结构的运营与知识任务 | 仅适用于中低风险、可审计、可回放任务域；高风险动作必须降级 | 可在满足策略时直接交付草案或建议结果 | 保存等级宣告、重规划记录、自动交付状态、异常降级记录 |
| `L4` | 在白名单场景自动完成多阶段路线选择、恢复、复核与交付 | 越过任务域、权限、预算、合规白名单时强制接管或降级 | 限定模板化业务流程、限定组织内知识任务、限定内容生产流水线 | 仅适用于白名单场景，要求强策略、强审计、强权限隔离 | 允许高比例无人值守送达，但必须保留强制中断和审计能力 | 保存白名单命中依据、策略版本、全程自动化执行证据 |
| `L5` | 作为开放任务域全自动的理论目标 | 现实中仍应保留紧急停止与监管能力，但当前不进入生产承诺 | 开放任务域复杂任务 | 当前仓库明确不承诺此等级已落地 | 当前不作为实际交付策略 | 当前不作为实际验收证据目标 |

### 3. 等级不是静态标签，而是运行时策略包

实现上不建议只把等级当展示字段。
更合理的做法是把等级看成一个策略包入口，驱动：

- 默认路线推荐
- 默认接管阈值
- 默认预算和权限护栏
- 默认结果交付规则
- 默认证据留存要求

### 4. 等级元数据模型

当前仓库还没有直接落地 `declaredAutopilotLevel / effectiveAutopilotLevel` 这组 runtime 字段，因此本 spec 只定义“建议元数据模型”和“当前过渡锚点”。

#### 4.1 建议字段

| 字段 | 含义 | 建议挂载位置 | 当前过渡锚点 |
| ---- | ---- | ---- | ---- |
| `declaredAutopilotLevel` | 任务启动时声明或默认采用的目标等级 | `Mission` 顶层元数据 | 由任务发起入口、README 叙事、路线选择策略推导，当前未入代码字段 |
| `recommendedAutopilotLevel` | 系统基于路线、风险和治理建议的推荐等级 | `MissionAutopilotSummary.route / explanation` 的推荐层 | `route.mode`、`route.selectionStatus`、`recommendationDetails` |
| `effectiveAutopilotLevel` | 当前运行时真正生效的等级 | runtime context / `MissionAutopilotSummary` | `driveState`、`takeover.required`、`recovery.needsHuman`、`canAutoRecover` 的组合语义 |
| `levelDecisionSource` | 本次等级判定由谁触发 | runtime metadata / evidence timeline | `recommendationDetails.source`、`route.evidence.events.actor` |
| `levelChangedAt` | 最近一次升降级时间 | runtime metadata / replay event | `route.evidence.events.at`、`evidence.timeline.time` |
| `levelChangeReason` | 升降级原因 | runtime metadata / recovery | `route.changeReason`、`takeover.reason`、`recovery.reason` |
| `levelChangeDecisionId` | 关联接管或决策 id | runtime metadata / correlation | `takeover.decisionId`、`evidence.correlation.decisionIds` |
| `levelChangeStageKey` | 发生升降级时的阶段 | runtime metadata | `route.currentStageKey`、`driveState.currentStageKey` |
| `levelTakeoverType` | 导致人工门控的接管类型 | runtime metadata / takeover | `takeover.type` |
| `deliveryConfirmedByHuman` | 最终交付是否经人工确认 | delivery metadata / audit | 当前未稳定落地，属于 Wave 3 之后字段 |

#### 4.2 建议挂载分层

| 层级 | 应承接的等级字段 | 当前现实边界 |
| ---- | ---- | ---- |
| `Mission` | `declaredAutopilotLevel`、`recommendedAutopilotLevel` | 目前还没有统一字段，只能先由发起入口和路线建议文档语义承接 |
| `Workflow / runtime context` | `effectiveAutopilotLevel`、`levelDecisionSource`、`levelChangedAt`、`levelChangeReason` | 当前主要通过 `driveState / takeover / recovery / operatorState` 侧写 |
| `MissionAutopilotSummary` | 等级展示、降级原因、关联 decision / timeline | 当前已具备 `route / driveState / takeover / recovery / evidence / explanation` 足够承接展示语义 |
| `Replay / Audit / Dashboard` | 等级变更时间线与交付确认 | 当前只具备 timeline / correlation / decision ids / route events 的最小锚点，未形成专门等级事件 |

#### 4.3 当前可直接锚定的过渡合同

基于 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts` 与 `TaskAutopilotPanel.tsx`，当前可稳定承接等级语义的字段主要是：

- `route.mode / route.selectionStatus / route.changeReason / route.replan`
- `driveState.state / driveState.riskLevel / driveState.waitingForUser`
- `takeover.required / blocking / type / reason / decisionId / urgency`
- `recovery.state / deviationCategory / needsHuman / canAutoRecover / suggestedActions`
- `evidence.timeline / evidence.correlation / explanation.currentState / recommendationDetails / remainingSteps`

这意味着：

- 当前已经足够做“等级展示语义”和“升降级原因解释”的设计；
- 但还不足以宣称真实的 `autopilotLevel` runtime metadata 已经落码。

## 与 mission-first 系统的映射

### 1. 与 Mission 的映射

任务自动驾驶等级首先附着在 `Mission` 级别，代表当前任务的目标自动化承诺。

建议的概念映射：

- 用户目标 -> `Mission`
- 目标自动化等级 -> `mission.autopilotLevel`
- 当前执行等级 -> `mission.runtimeAutopilotLevel`

说明：

- `autopilotLevel` 表示任务启动时声明或推荐的目标等级
- `runtimeAutopilotLevel` 表示运行时真实生效等级，可因风险与接管发生降级

### 2. 与 Workflow 的映射

`Workflow` 负责承接路线推进，因此等级需要影响 workflow 的推进策略。

建议的投影：

- `L1`：主要用于生成 workflow 草案，不直接推进真实执行
- `L2`：workflow 可在低风险步骤自动推进
- `L3`：workflow 可在标准任务中自动推进大部分阶段
- `L4`：workflow 可在白名单任务域高比例自动推进
- `L5`：当前不进入实际 workflow 承诺

### 3. 与十阶段工作流的映射

虽然任务自动驾驶的产品语言会使用“目的地 / 路线 / 驾驶状态”，但当前底层仍有十阶段工作流。
因此需要定义等级与阶段推进的映射关系。

建议口径：

- `direction / planning`
  - L1 就可以支持自动辅助
- `execution`
  - 从 L2 开始支持局部自动推进
- `review / meta_audit / revision / verify`
  - 从 L2、L3 起开始成为等级的重要约束条件
- `summary / feedback / evolution`
  - 作为证据沉淀与能力成长层，不单独决定等级，但影响等级可信度

| 阶段簇 | 当前最低可支撑等级口径 | 在分级里的作用 | 当前仍未闭合的点 |
| ---- | ---- | ---- | ---- |
| `direction / planning` | `L1` | 支撑目标理解、路线建议、缺口澄清与任务草案生成 | 尚未细化到十阶段逐项动作表，因此不单独勾选完整阶段映射任务 |
| `execution` | `L2` | 支撑低风险自动推进、局部自动重试与关键节点接管 | 尚未形成 node family / route family 级别的细粒度矩阵 |
| `review / meta_audit / revision / verify` | `L2-L3` | 决定是否允许自动闭环、自动 revise 与异常降级 | 尚未把所有复核触发条件沉入统一 runtime metadata |
| `summary / feedback / evolution` | `L2-L4` | 作为证据沉淀、回放、复盘和后续策略升级基础 | 尚未形成 replay / observability 的统一字段契约 |

### 3.1 十阶段工作流 × 等级动作范围矩阵

下表是当前仓库的保守设计矩阵，描述“各阶段在不同等级下最多允许到什么程度”，而不是宣称所有能力都已实现：

| 十阶段 | `L1` | `L2` | `L3` | `L4` |
| ---- | ---- | ---- | ---- | ---- |
| `direction` | 允许目标理解、约束提取、缺口提示 | 同 `L1` | 同 `L2` | 同 `L3` |
| `planning` | 允许路线建议、候选路线、角色建议；不自动真实执行 | 允许在已确认主路线下进入低风险推进准备 | 允许默认选择标准路线并自动进入执行 | 允许白名单域自动选择和锁定路线 |
| `execution` | 不进入高副作用真实执行 | 允许低风险检索、总结、生成与局部自动推进 | 允许标准任务主线自动推进与低中风险重试 | 允许白名单域高比例无人值守执行 |
| `review` | 仅提供 review 建议 | 可自动生成 review 草案，交付前通常接管 | 可自动 review / revise，并在异常时降级 | 可自动复核，但必须保留强制中断 |
| `meta_audit` | 仅记录建议与推荐原因 | 记录低风险自动推进与人工确认边界 | 记录自动闭环与降级原因 | 记录白名单命中、策略版本与全程审计 |
| `revision` | 只建议修改路线或草案 | 允许低风险改写或 retry | 允许标准任务自动 revise / replan | 允许白名单域自动 revise，但越界即降级 |
| `verify` | 给出验证建议，不自动最终放行 | 可自动做低风险验证，关键放行接管 | 可在策略满足时自动验证标准结果 | 允许白名单域自动验证并直接流转 |
| `summary` | 输出路线摘要和建议摘要 | 输出阶段总结 | 输出自动执行与复核总结 | 输出白名单域无人值守总结 |
| `feedback` | 收集人工反馈 | 记录人工确认和阻断原因 | 记录自动交付与人工兜底反馈 | 记录运营强制中断与策略复核反馈 |
| `evolution` | 只做文档层能力回顾 | 可为后续路线建议提供经验 | 可沉淀标准任务闭环模式 | 可沉淀白名单策略包版本 |

补充说明：

- `retry / rollback` 目前还没有在 `MissionAutopilotSummary.execution.currentStepStatus` 中形成专门状态枚举，因此本表只把它们归入 `revision / recovery / replan` 语义，不把“回退状态已完整落地”写成现实事实。
- 这张表足以完成 spec 级设计任务，但不代表所有阶段都已有独立 runtime metadata。

### 4. 与 Mission Runtime 的映射

Mission Runtime 是等级真正生效的核心承接层。

运行时至少需要能够回答：

- 当前任务宣告的自动化等级是什么
- 当前阶段生效的自动化等级是什么
- 当前动作是否允许自动执行
- 当前动作是否必须请求接管
- 当前任务是否因风险发生降级

建议运行时判定逻辑：

1. 读取任务目标等级
2. 结合路线阶段、节点类型、风险策略判断当前允许行为
3. 若触发高风险或策略阻断，则：
   - 请求接管
   - 或降级到更低等级
4. 将等级变更与原因写入 runtime evidence

### 5. 与 HITL / 接管链路的映射

当前已有的 human-in-the-loop 能力，应被升级为任务自动驾驶里的“接管机制”。

映射关系如下：

- 澄清问题 -> 轻接管
- 路线确认 -> 启动接管
- 预算 / 权限 / 风险确认 -> 治理接管
- 最终结果确认 -> 交付接管

这意味着 L1-L5 不是替代 HITL，而是把 HITL 从零散节点升级成统一接管语义。

### 6. 与 Web-AIGC 节点 / adapter 的映射

Web-AIGC 节点不应直接暴露为等级对象，但它们会影响等级可达性。

建议的设计口径：

- 导航型节点
  - 更偏向支撑 L1-L3
- 执行型节点
  - 在治理与证据完整时支撑 L2-L4
- 高风险治理节点
  - 决定任务是否需要降级或接管

例如：

- 搜索问答、文档总结、常规内容生成
  - 更容易进入 L2 / L3
- 向量更新 / 删除、风险动作、宿主打开动作
  - 默认要求 L2 接管或 L3 降级处理
- MCP、Guest Agent、外部工具调用
  - 需要结合 actor / policy / approval / audit 字段决定可达等级

### 6.1 节点族 / route family × 等级边界矩阵

当前仓库还没有统一的 `routeFamily` 字段，因此本 spec 采用“节点族 + 现有 `route.mode` + 治理信号”的过渡映射。

| 族类 | 典型能力 | 当前仓库直接锚点 | 优先适用等级 | 降级 / 接管条件 |
| ---- | ---- | ---- | ---- | ---- |
| 导航节点 | 目标理解、缺口澄清、路线推荐、结构化任务草案 | `route.mode`、`route.selectionStatus`、`recommendationDetails(kind=route)`、README 中的 `Destination / Route` 语义 | `L1-L3` | 路线选择未确认、目标缺失、风险边界不明时停留 `L1-L2` |
| 执行节点 | 检索、问答、总结、文案生成、Office / content production、标准 runtime adapter | README / steering 中的 built-in + extra adapters、`execution.availableActions`、`fleet.roles` | `L2-L3` | 命中预算、权限、外部副作用或治理阻断时降级到 `L2` 或接管 |
| 治理节点 | 审批、权限、预算、审计、回放、风险动作门控 | `takeover.type`、`recovery.deviationCategory`、`evidence.correlation`、`shared/web-aigc-governance.ts` 的 approval modes | `L1-L4` 的护栏层，不单独等于高等级 | 命中 `approval_required`、`manual_gate`、高风险副作用时必须人工介入 |

### 6.2 `route.mode` 的过渡语义

当前 `MissionAutopilotSummary.route.mode` 已稳定存在 `fast / standard / deep` 这类模式。它们不是 L1-L5 本身，但可以作为推荐等级的过渡锚点：

| `route.mode` | 偏向等级语义 | 含义 |
| ---- | ---- | ---- |
| `fast` | `L1-L2` | 更强调尽快推进，适合建议、轻执行或人工门控较多的路径 |
| `standard` | `L2-L3` | 平衡执行效率、复核与可交付性 |
| `deep` | `L2-L4` | 更强调治理、验证、恢复余量与审计性 |

注意：

- `route.mode = deep` 不等于任务已经达到 `L4`。
- 真正的等级判断仍要结合 `takeover.required`、`recovery.needsHuman`、`canAutoRecover`、风险和治理边界。

## 分级策略设计

### L1 策略

定位：

- 以辅助规划为主
- 以人类启动执行为前提

运行时策略：

- 允许自动解析目标
- 允许自动生成路线和任务草案
- 不允许自动触发高副作用执行
- 默认要求用户确认后再进入真实执行

证据要求：

- 保存推荐路线
- 保存建议理由
- 保存用户最终选择

### L2 策略

定位：

- 低风险动作自动执行
- 关键节点人工接管

运行时策略：

- 允许在低风险 adapter 与节点间自动推进
- 允许低风险自动重试
- 高风险动作进入接管面板
- 默认保留结果确认点

证据要求：

- 保存接管点位置
- 保存被阻断动作与原因
- 保存自动推进与人工确认交界点

### L3 策略

定位：

- 标准任务自动闭环
- 异常与越界时接管

运行时策略：

- 允许默认路线自动启动
- 允许自动编队、自动重规划、自动 review / revise
- 允许在标准任务上自动交付草案结果
- 一旦出现高风险动作、策略冲突、质量不达标，则降级或接管

证据要求：

- 保存等级宣告
- 保存重规划记录
- 保存交付是否自动完成
- 保存异常降级记录

### L4 策略

定位：

- 白名单场景高自动化

白名单约束模型至少包括：

- `taskDomainAllowlist`
- `permissionAllowlist`
- `budgetAllowlist`
- `policyVersion`

运行时策略：

- 仅对白名单任务域生效
- 允许高比例无人值守执行
- 必须有强策略、强审计、强回放、强权限隔离
- 一旦超出白名单范围，立即降级

证据要求：

- 保存白名单命中依据
- 保存策略包版本
- 保存全程自动化执行证据

### L5 策略

定位：

- 远期研究目标

运行时策略：

- 当前不进入生产级承诺

证据要求：

- 当前不作为实际验收目标

### 分阶段落地与实现顺序

| 落地波次 | 主要目标 | 对应等级重心 | 当前文档承接 |
| ---- | ---- | ---- | ---- |
| Wave 1 | 统一等级语言、等级边界和对外叙事 | `L1-L3` 最小闭环、`L4-L5` 边界声明 | 本文“等级模型”“分级策略设计”，以及 steering 摘要 |
| Wave 2 | 把等级投影到驾驶舱与任务界面 | 目标等级、当前运行等级、降级原因、接管原因 | 本文“驾驶舱展示设计”与 `autopilot-cockpit-information-architecture` |
| Wave 3 | 接入 runtime metadata、治理触发与 HITL bridge | `L2-L3` 的真实运行时生效与降级逻辑 | 本文“与 Mission Runtime / HITL / runtime governance 的映射” |
| Wave 4 | 扩展到白名单高自动化与更完整证据闭环 | `L4` 白名单运行、审计回放与证据链增强 | 本文“L4 策略”“审计与回放设计”，以及后续 evidence / trust-chain specs |

## 强制接管与禁止绕过清单

以下动作当前应作为“首批必须接管”清单，不因等级升高而默认绕过人工确认：

| 动作或场景 | 当前锚点 | 最低要求 |
| ---- | ---- | ---- |
| 路线选择待确认 | `takeover.type = route-selection`、`decisionId`、`route.takeoverPointIds` | 至少需要人工选择或确认 |
| 预算审批 / 预算越界 | `takeover.type = budget`、`recovery.deviationCategory = governance-deviation`、预算治理相关测试 | 必须人工确认或显式降级 |
| 权限升级 / approval gate | `shared/web-aigc-governance.ts`、MCP / vector / transaction approval_required 路径 | 不得默认无人值守越过 |
| 外部写操作 / 高风险副作用 | vector update / delete / insert、transaction flow、MCP manual gate | 必须人工确认并保留审计 |
| 交付放行 / 外部发布 | `takeover.type = delivery-review` 的产品语义、现有 review/delivery 面板设计 | 不得在缺少策略和确认时直接放行 |
| 恢复已耗尽 / runtime blocked | `recovery.needsHuman = true`、`canAutoRecover = false`、`driveState = blocked` | 必须人工接手 |

补充说明：

- 这张清单是“当前最小安全边界”，不是最终的全量治理表。
- 其中部分场景已经在 runtime 或 adapter 层存在事实，但尚未全部稳定回收到任务详情闭环；因此这里只定义产品与治理边界，不冒充“所有链路已统一实现”。

## 驾驶舱展示设计

自动驾驶等级必须成为驾驶舱中的明确对象，而不是只写在文档里。

建议展示位置：

- 任务目标卡片
  - 展示目标等级与推荐等级
- 路线卡片
  - 展示当前路线支持的等级
- 实时状态栏
  - 展示当前实际运行等级
- 接管面板
  - 展示降级原因、接管原因
- 回放 / 审计
  - 展示等级变化时间线

建议展示语义：

- `目标等级`
- `当前运行等级`
- `本次接管将任务从 L3 降级到 L2`
- `当前动作超出 L3 风险边界，需人工确认`

### 驾驶舱等级展示与现有 summary 合同的对应

当前不新增代码字段的前提下，驾驶舱可先按以下映射展示等级语义：

| 驾驶舱展示项 | 当前可直接读取的合同 |
| ---- | ---- |
| 目标等级 | 任务模板 / 发起入口约定，当前属于文档层语义 |
| 推荐等级 | `route.mode` + `route.selectionStatus` + `recommendationDetails` |
| 当前运行等级 | `driveState.state` + `takeover.required` + `recovery.needsHuman / canAutoRecover` 的组合解释 |
| 降级原因 | `route.changeReason`、`takeover.reason`、`recovery.reason` |
| 接管原因 | `takeover.type / prompt / decisionId / urgency` |
| 等级变更线索 | `route.evidence.events`、`evidence.timeline`、`evidence.correlation.timelineId` |

## 审计与回放设计

为了让等级不是空标签，必须进入 evidence 链路。

建议最小证据字段：

- `declaredAutopilotLevel`
- `effectiveAutopilotLevel`
- `autopilotLevelChanged`
- `takeoverRequiredReason`
- `riskBoundaryTriggered`
- `deliveryConfirmedByHuman`

这些字段不要求本 spec 直接落代码，但后续实现时应接入：

- replay 时间线
- audit 事件
- runtime observability
- lineage / trust chain

### 当前可直接复用的证据与时间线锚点

基于 `MissionAutopilotSummary` 当前合同，等级证据设计可以直接复用以下结构：

| 目标 | 当前锚点 |
| ---- | ---- |
| 记录等级相关决策发生在何时 | `evidence.timeline[].time`、`route.evidence.events[].at` |
| 记录与哪个 route / decision 相关 | `evidence.correlation.routeIds / decisionIds / selectedRouteId / recommendedRouteId` |
| 记录是否因接管或恢复发生变化 | `takeover.type / decisionId`、`recovery.state / deviationCategory` |
| 记录解释来源 | `explanation.currentState.sources`、`recommendationDetails.source` |
| 记录 route 切换或 replan | `route.selectionStatus`、`route.changeReason`、`route.replan`、`route.evidence.events[eventType=route.replanned]` |

### 等级时间线的建议事件模型

在后续真实实现中，等级时间线可优先从现有 evidence/replay 事件派生，而不是强制另起一套系统。建议至少识别以下事件类型：

| 时间线事件 | 可由当前哪些事实派生 |
| ---- | ---- |
| `level.declared` | 任务发起时的等级声明或默认等级 |
| `level.recommended` | `route.recommended`、推荐路线说明、推荐理由 |
| `level.effective` | 进入自动推进阶段时的生效等级 |
| `level.degraded` | `takeover-required`、`blocked`、`governance-deviation`、`route.replanned` |
| `level.recovered` | 从 recovery / takeover 恢复回可执行状态 |
| `level.delivered` | 最终交付且是否人工确认 |

当前仍未落地的点：

- 还没有专门的 `level.*` runtime audit event 类型；
- 还没有单独的等级时间线 UI；
- 但已有 `route / takeover / recovery / evidence` 足以支撑设计任务收口。

## 首批试点清单与验收矩阵

### 1. 首批试点清单

本清单按“当前仓库真实覆盖面”保守划分，目标是指导先做哪些任务的等级落地，而不是声称已经自动化完成。

| 任务族 | 建议等级起点 | 原因 | 当前边界 |
| ---- | ---- | ---- | ---- |
| 路线建议、任务拆解、研究路线建议 | `L1` | 已有 `Destination / Route` 叙事和路线推荐面 | 不应默认真实执行 |
| 标准问答、检索、总结、内部资料汇总 | `L2` | 低风险、可结构化、适合自动推进与人工兜底 | 高风险外部写仍需接管 |
| 报告初稿、常规方案整理、轻量内容编排 | `L2` | 现有 runtime / adapters / panel 足以展示部分自动推进 | 交付前通常仍建议人工确认 |
| 标准化内容生产链路、模板化研究分析、受约束 Office / Web-AIGC 任务 | `L3` 试点 | 已有 route / review / recovery / evidence 摘要链路 | 仅限中低风险且可审计任务域 |
| MCP、transaction、vector update/delete/insert 等高风险副作用任务 | 保持 `L1-L2` | 当前治理和 approval 事实存在，但不能默认无人值守 | 必须人工确认 |
| 开放域复杂任务 | 不进入试点 | 当前没有稳定开放域全自动能力 | 不得包装成 `L4-L5` 已落地 |

### 2. 统一验收矩阵

| 任务类型 | 风险等级 | 建议等级 | 默认接管要求 | 当前可验证锚点 |
| ---- | ---- | ---- | ---- | ---- |
| 路线建议 / 规划 | 低 | `L1` | 执行前确认 | `route.selectionStatus`、推荐理由 |
| 检索 / 总结 / 标准问答 | 低 | `L2` | 异常或越界时接管 | `execution.availableActions`、`driveState` |
| 报告初稿 / 轻内容生产 | 低-中 | `L2` | 交付前建议确认 | `route`、`recovery`、`evidence` |
| 标准化内容闭环任务 | 中 | `L3` | 预算、权限、低置信度、review 失败时接管 | `takeover`、`recovery`、`route.replan` |
| 外部写操作 / 高风险副作用 | 中-高 | `L1-L2` | 必须接管 | governance / approval_required / manual_gate |
| 白名单业务流程 | 中 | `L4` 未来目标 | 超白名单即降级 | 当前仅设计层定义 |
| 开放域复杂任务 | 高 | 不开放 | 必须人工主导 | 当前不纳入已具备能力 |

## 兼容性设计

### 1. 与现有 README / steering 兼容

当前仓库主叙事仍然是：

- mission-first
- task operating system

本 spec 不会推翻这些叙事，而是增加一层更强的产品叙事：

- 任务自动驾驶平台

建议口径：

- 工程定义继续保留 mission-first
- 产品定义可逐步升级为 task autopilot

### 2. 与现有 runtime 主线兼容

当前 runtime 已具备：

- built-in adapters
- extra adapters
- wait / resume
- runtime governance
- replay / audit observability

这些能力足以支撑 L1-L3 的第一阶段产品化设计，不需要等待全量新引擎。

### 3. 与未来 specs 的兼容

本 spec 输出的是等级框架，不替代后续：

- route 模型
- takeover 面板
- drive-state 状态机
- evidence trust chain
- 风险评估器

这些 specs 将进一步细化本设计。

## 审计说明（2026-04-24）

本轮按“现有 README / steering / 已落地接管与治理契约可直接支撑”的保守口径，确认以下内容已足以支撑 tasks.md 中对应条目勾选：

- 统一术语：
  - `README.md`、`README.zh-CN.md` 已统一使用 `Destination / Route / Drive State / Fleet / Takeover` 作为产品层术语。
  - `.kiro/specs/task-autopilot-core-concepts/design.md` 已给出这些术语与 `mission / workflow / runtime / decision` 的映射。
- README / steering 分级摘要：
  - `README.md`、`README.zh-CN.md` 已给出 L1-L5 的公开口径与“当前不是 L5”的边界说明。
  - `.kiro/steering/project-overview.md`、`.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md`、`.kiro/steering/task-autopilot-platform-narrative-2026-04-23.md` 已补齐一致的分级叙事。
- `L1-L4` 最小产品行为：
  - 本文 `L1` 到 `L4` 策略段已分别定义路线建议、低风险自动推进、标准任务自动闭环、白名单高自动化的最小边界。
  - 这些定义与 README 中的分级表述保持一致，没有额外放大当前主仓能力。
- `L5` 非当前能力：
  - `README.md`、`README.zh-CN.md`、`.kiro/steering/project-overview.md`、`.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md`、`.kiro/steering/task-autopilot-platform-narrative-2026-04-23.md` 均明确 `L5` 仅为远期研究目标，当前仓库不应对外宣称已实现。
- 与 runtime governance 的最小承接：
  - `shared/permission/contracts.ts` 已固定 `allowed / blocked / approval_required` 治理结果。
  - `server/tool/api/mcp-tool-adapter.ts`、`server/web-aigc/vector-delete-adapter.ts`、`server/web-aigc/vector-update-adapter.ts`、`server/routes/node-adapters/transaction-flow-node-adapter.ts` 已体现高风险动作命中治理后进入阻断或审批门。
  - `server/core/cost-monitor.ts` 与现有成本治理链已提供预算越界的最小触发事实。
- 与 HITL / DecisionPanel 的最小承接：
  - `.kiro/specs/takeover-panel-and-decision-points/design.md` 已定义澄清、路线确认、预算 / 权限 / 风险确认、交付验收等接管类型。
  - `shared/mission/decision-templates.ts` 已存在 `execution-plan-approval`、`stage-gate`、`risk-confirmation` 等决策模板。
  - `client/src/components/tasks/TaskDetailView.tsx` 已复用 `DecisionPanel` 承接当前任务决策流。
- 驾驶舱展示边界：
  - 本文“驾驶舱展示设计”已明确 `目标等级 / 当前运行等级 / 降级原因 / 接管原因` 的展示位置与语义。
  - `.kiro/specs/autopilot-cockpit-information-architecture/` 已提供驾驶舱信息架构锚点，可作为后续 UI 收口入口。
- 实现顺序：
  - `.kiro/steering/task-autopilot-implementation-waves-2026-04-23.md` 已明确先做语义契约与投影，再做 runtime / takeover bridge，再做驾驶舱 UI，最后做证据与指标闭环。

本轮仍保持未勾选的项包括：`autopilotLevel / effectiveAutopilotLevel` 的真实 runtime metadata 挂载、等级与十阶段 / node family 的完整映射表、等级证据字段接入 replay / audit / observability、等级时间线、试点清单、必须接管清单、验收矩阵。原因是这些内容要么还未进入主仓真实字段，要么虽然已有局部治理事实，但尚未在本 spec 中形成足够稳定的一致口径，不宜提前勾选。

## 审计说明（2026-04-25，Lane 3 二次收口）

本轮继续按“当前文档 + `MissionAutopilotSummary` 合同 + route / takeover / recovery / governance 展示链路”做保守补强，新增收口的设计锚点包括：

- `等级元数据模型`
  - 明确了 `declaredAutopilotLevel / recommendedAutopilotLevel / effectiveAutopilotLevel` 等建议字段；
  - 同时明确这些字段当前还没有真实落码，只能由 `route / driveState / takeover / recovery / explanation / evidence` 过渡承接。
- `十阶段工作流 × 等级动作范围矩阵`
  - 已把 `direction / planning / execution / review / meta_audit / revision / verify / summary / feedback / evolution` 十阶段全部映射到 `L1-L4` 的允许动作边界；
  - 明确 `retry / rollback` 仍未形成独立 `execution.currentStepStatus` 合同，不能写成 runtime 已实现。
- `节点族 / route family × 等级边界矩阵`
  - 已用“导航节点 / 执行节点 / 治理节点 + route.mode + 治理信号”的过渡模型补齐当前仓库的映射表；
  - 明确 `route.mode` 是过渡锚点，不是 L1-L5 本身。
- `首批必须接管清单`
  - 已收口路线选择、预算审批、权限升级 / approval gate、外部写操作、高风险副作用、交付放行、恢复耗尽等最小安全边界。
- `首批试点清单与统一验收矩阵`
  - 已按当前 README / steering / runtime coverage 定义哪些任务先做 `L1`、哪些可试 `L2`、哪些可受限试 `L3`，并明确高风险任务与开放域任务不能冒充高等级已落地。
- `等级证据与时间线设计`
  - 已把 `route.evidence.events`、`evidence.timeline`、`evidence.correlation`、`takeover`、`recovery`、`recommendationDetails` 收敛为等级时间线与审计的直接锚点。

本轮仍然刻意没有把“真实 runtime metadata 已落地”写成既成事实：

- 当前主仓仍没有直接的 `autopilotLevel / effectiveAutopilotLevel` 字段；
- 等级时间线仍是设计模型，不是现成 UI 或专门 audit event；
- L4 仍是白名单目标，L5 仍是远期研究目标。

## 风险与限制

### 1. 过度营销风险

如果把 L3 / L4 / L5 表述得过满，会让用户误以为当前系统已具备开放域全自动执行能力。
因此所有对外文案必须与本 spec 的现实边界一致。

### 2. 运行时未统一风险

当前不同节点族、不同 adapter、不同 route family 的成熟度并不一致。
因此同一等级的落地，需要逐步扩展，不应一次性全域开启。

### 3. 证据不足风险

如果等级只显示在 UI 上，却没有进入 audit / replay / runtime evidence，那么分级将失去可信度。
因此后续必须补 runtime metadata 与 dashboard 接线。

## 设计结论

L1-L5 分级应被视为 WhyBuddy 从“任务操作系统”升级到“任务自动驾驶平台”的一层核心语义桥梁。

它的设计要点不是制造一个新术语，而是做到：

- 产品上能解释
- 运行时上能投影
- 治理上能校验
- 文档上能统一

在当前阶段，推荐把 `L1-L3` 作为真实推进目标，把 `L4` 作为限定场景路线，把 `L5` 明确保留为远期研究目标。
