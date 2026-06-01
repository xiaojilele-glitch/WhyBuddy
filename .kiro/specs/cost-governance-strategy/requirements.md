# 需求文档：成本治理策略（Cost Governance Strategy）

## 简介

在 WhyBuddy 平台已有的 cost-observability 模块（被动成本监控）基础上，演进为主动的成本治理系统。本模块提供多级预算管理、智能降级策略、并发/速率限制、任务暂停与人工审批、成本预测与优化建议、成本分摊与多租户管理、成本报表分析，以及与动态组织和权限模型的深度集成。目标是形成"预测 → 预算 → 监控 → 告警 → 响应 → 优化 → 审计"的完整成本治理闭环。

## 术语表

- **Governance_Engine**：成本治理引擎核心模块，负责策略编排、告警响应和审计记录
- **Mission_Budget**：Mission 级成本预算配置，包含预算类型、Token 预算、成本预算、告警阈值
- **Cost_Tracker**：已有的成本追踪核心模块（来自 cost-observability），本模块扩展其能力
- **Budget_Alert**：预算告警事件，包含告警级别、触发原因和自动响应策略
- **Model_Downgrade_Policy**：模型降级策略，定义降级链、触发条件和灰度控制规则
- **Concurrency_Limit_Policy**：并发和速率限制策略，定义限制级别和触发条件
- **Task_Pause_Policy**：任务暂停策略，定义暂停触发条件和审批流程
- **Approval_Request**：审批请求，包含审批原因、建议操作和审批链
- **Cost_Optimization_Analyzer**：成本优化分析器，分析消耗模式并生成优化建议
- **Cost_Predictor**：成本预测器，基于历史数据和任务描述预测 Mission 成本
- **Cost_Allocation**：成本分摊规则，定义多维度成本分摊方式
- **Cost_Report**：成本报表，支持多种报表类型和多维度分析
- **Cost_Permission**：基于成本的权限控制，定义用户级成本预算和模型限制
- **Audit_Trail**：审计链，记录所有成本治理操作的完整审计日志
- **Pricing_Table**：模型定价表（来自 shared/cost.ts）

## 需求

### 需求 1：Mission 成本预算定义

**用户故事：** 作为用户，我需要为每个 Mission 设置 Token 预算和成本预算，支持不同的预算类型，这样可以根据任务特性灵活控制成本。

#### 验收标准

1. THE Mission_Budget SHALL 包含 missionId、budgetType、tokenBudget、costBudget、currency、budgetPeriod、alertThresholds 字段
2. THE Governance_Engine SHALL 支持三种预算类型：FIXED（固定预算）、PERCENTAGE（按比例预算，占总成本的百分比）、DYNAMIC（动态预算，基于历史数据自动调整）
3. WHEN 用户设置 Token 预算时, THE Mission_Budget SHALL 支持按模型分配 Token 额度（如 GPT-4 最多 100K tokens、GPT-3.5 最多 500K tokens）
4. THE Mission_Budget SHALL 支持多币种成本预算（USD、CNY），并使用固定汇率进行换算
5. THE Governance_Engine SHALL 支持三种预算周期：MISSION（整个任务生命周期）、DAILY（每天重置）、HOURLY（每小时重置）
6. THE Mission_Budget SHALL 支持多级告警阈值配置（如 50%、75%、90%、100%），每个阈值关联一个响应策略标识

### 需求 2：实时成本追踪与消耗监控

**用户故事：** 作为系统，我需要实时追踪每个 Mission 的 Token 消耗和成本消耗，包括按模型、按 Agent、按操作类型的细粒度追踪，这样可以及时发现成本异常。

#### 验收标准

1. WHEN LLM 调用、API 调用或资源使用发生时, THE Cost_Tracker SHALL 记录一条包含 missionId、agentId、modelName、inputTokens、outputTokens、cost、timestamp、operationType 的成本记录
2. THE Governance_Engine SHALL 实时计算每个 Mission 的累计成本和剩余预算
3. THE Governance_Engine SHALL 支持按模型、按 Agent、按操作类型、按时间段四个维度进行成本查询
4. THE Cost_Tracker SHALL 在 100 毫秒内完成成本记录写入，不阻塞主业务流程
5. THE Cost_Predictor SHALL 基于当前消耗速率预测任务完成时的总成本

### 需求 3：预算告警与阈值触发

**用户故事：** 作为系统，我需要在 Mission 成本接近或超过预算时自动触发告警，并根据告警级别采取不同的响应措施，这样确保成本不会失控。

#### 验收标准

1. THE Budget_Alert SHALL 包含 alertId、missionId、alertType、threshold、currentCost、budgetRemaining、timestamp、action 字段
2. THE Governance_Engine SHALL 支持四种告警类型：WARNING（成本达到 50%）、CAUTION（成本达到 75%）、CRITICAL（成本达到 90%）、EXCEEDED（成本超过 100%）
3. WHEN 告警触发时, THE Governance_Engine SHALL 根据告警级别执行自动响应策略：WARNING 记录日志、CAUTION 降低并发、CRITICAL 降级模型、EXCEEDED 暂停任务
4. THE Governance_Engine SHALL 支持多种告警通知方式：控制台日志、Socket.IO 实时推送、Webhook 回调
5. THE Audit_Trail SHALL 记录每条告警的内容、触发原因和响应措施
6. WHEN 用户为特定 Mission 自定义告警阈值时, THE Governance_Engine SHALL 使用自定义阈值覆盖默认阈值

### 需求 4：自动模型降级策略

**用户故事：** 作为系统，当 Mission 成本接近预算上限时，我需要自动将高成本模型降级到低成本模型，这样在保证任务完成的前提下降低成本。

#### 验收标准

1. THE Model_Downgrade_Policy SHALL 定义降级规则，包含 sourceModel、targetModel、triggerThreshold、downgradeConditions 字段
2. THE Governance_Engine SHALL 维护预定义的降级链：GPT-4 → GPT-3.5 → GLM-4.6 → GLM-5-turbo
3. WHEN 降级触发时, THE Governance_Engine SHALL 根据成本阈值、任务复杂度、Agent 类型综合判断是否执行降级
4. WHEN 降级执行时, THE Audit_Trail SHALL 记录降级原因、降级前后的模型名称和预期的成本节省金额
5. THE Governance_Engine SHALL 支持灰度降级控制：先对指定比例的 Agent 执行降级，观察效果后再决定是否全量降级
6. IF 降级后的模型调用失败, THEN THE Governance_Engine SHALL 自动回滚到原模型，并在 Audit_Trail 中记录失败原因
7. THE Audit_Trail SHALL 记录每次降级操作的决策过程、执行结果和成本影响

### 需求 5：并发和速率限制策略

**用户故事：** 作为系统，当 Mission 成本消耗过快时，我需要自动降低并发数或限制请求速率，这样可以延缓成本消耗并争取时间进行人工审批。

#### 验收标准

1. THE Concurrency_Limit_Policy SHALL 定义并发限制规则，包含 missionId、maxConcurrency、rateLimit、triggerThreshold 字段
2. THE Governance_Engine SHALL 支持四个并发限制级别：NORMAL（无限制）、LOW（降低 50%）、MINIMAL（降低 75%）、SINGLE（单线程）
3. THE Governance_Engine SHALL 支持四个速率限制级别：NORMAL（无限制）、HIGH（100 req/min）、MEDIUM（10 req/min）、LOW（1 req/min）
4. WHEN 成本消耗速率超过阈值或预算剩余不足时, THE Governance_Engine SHALL 自动提升限制级别
5. THE Concurrency_Limit_Policy SHALL 应用到 Agent 的 LLM 调用和并行任务执行
6. THE Audit_Trail SHALL 记录每次限制操作的原因、限制级别和预期的成本节省

### 需求 6：任务暂停与人工审批

**用户故事：** 作为系统，当 Mission 成本超过预算或接近上限时，我需要支持自动暂停任务并等待人工审批，这样可以防止成本失控。

#### 验收标准

1. THE Task_Pause_Policy SHALL 定义任务暂停规则，包含 missionId、pauseTrigger、pauseDuration、requiresApproval 字段
2. WHEN 成本超过预算、成本达到 CRITICAL 阈值或检测到异常成本消耗时, THE Governance_Engine SHALL 暂停对应 Mission
3. WHEN Mission 暂停时, THE Governance_Engine SHALL 生成 Approval_Request，包含 requestId、missionId、reason、currentCost、budgetRemaining、suggestedActions 字段
4. THE Approval_Request SHALL 支持四种审批操作：继续执行、增加预算、降级模型后继续、取消任务
5. THE Governance_Engine SHALL 支持多级审批：成本超过低阈值由普通管理员审批，超过高阈值由高级管理员审批
6. IF 审批请求在超时时间（默认 1 小时）内未处理, THEN THE Governance_Engine SHALL 自动拒绝该请求
7. THE Audit_Trail SHALL 记录每次暂停和审批操作的完整过程

### 需求 7：成本优化建议

**用户故事：** 作为系统，我需要分析 Mission 的成本消耗模式，提供成本优化建议，这样帮助用户主动降低成本。

#### 验收标准

1. THE Cost_Optimization_Analyzer SHALL 分析 Mission 的成本消耗数据，生成优化建议列表
2. THE Cost_Optimization_Analyzer SHALL 支持四类优化建议：模型优化（使用低成本模型替代）、Prompt 优化（减少 Token 消耗）、缓存优化（复用之前的结果）、并发优化（调整并发数）
3. WHEN 生成优化建议时, THE Cost_Optimization_Analyzer SHALL 为每条建议计算预期成本节省金额、实施难度和风险评估
4. WHEN 优化建议的风险评估为低风险时, THE Governance_Engine SHALL 支持自动应用该建议
5. THE Audit_Trail SHALL 记录每条优化建议的内容、预期效果和实施状态

### 需求 8：成本预测与预算规划

**用户故事：** 作为用户，我需要在 Mission 执行前预测成本，并根据预测结果调整预算或任务范围，这样可以提前规划成本。

#### 验收标准

1. THE Cost_Predictor SHALL 基于任务描述、历史数据和模型选择预测 Mission 的成本
2. THE Cost_Predictor SHALL 支持三种预测方法：基于历史相似任务的类比、基于任务复杂度的估算、基于模型定价的计算
3. THE Cost_Predictor SHALL 返回点估计和置信区间（如预计成本 100 元，置信区间 80-150 元）
4. WHEN Mission 执行进度达到 10% 时, THE Cost_Predictor SHALL 基于实际消耗数据重新预测总成本
5. THE Cost_Predictor SHALL 支持成本模拟：用户调整模型、并发、预算等参数后查看对成本的影响
6. THE Cost_Predictor SHALL 基于预测结果生成预算规划建议（如建议预算 150 元以确保 95% 的成功率）

### 需求 9：成本分摊与多租户管理

**用户故事：** 作为系统，我需要支持成本的分摊和多租户管理，这样可以准确追踪不同部门、不同用户的成本。

#### 验收标准

1. THE Cost_Allocation SHALL 定义成本分摊规则，包含 allocationId、missionId、allocationType、allocations 字段
2. THE Governance_Engine SHALL 支持三种分摊类型：EQUAL（平均分摊）、WEIGHTED（按权重分摊）、USAGE（按使用量分摊）
3. THE Cost_Allocation SHALL 支持按部门、按用户、按项目、按成本中心四个维度进行分摊
4. THE Governance_Engine SHALL 支持多级分摊：总成本先分摊到部门，再从部门分摊到项目
5. THE Governance_Engine SHALL 支持回溯分摊：允许修改已完成 Mission 的成本分摊归属
6. THE Cost_Report SHALL 使用分摊结果生成部门成本报表和成本中心报表

### 需求 10：成本报表与分析

**用户故事：** 作为管理员，我需要查看成本报表和成本分析，包括成本趋势、成本分布、成本异常，这样可以了解系统的成本状况。

#### 验收标准

1. THE Cost_Report SHALL 支持五种报表类型：成本汇总、成本明细、成本趋势、成本分布、成本对比
2. THE Cost_Report SHALL 支持按 Mission、按 Agent、按模型、按用户、按部门、按时间段六个维度进行分析
3. THE Cost_Report SHALL 提供成本趋势分析，包括日均成本、周均成本、月均成本和成本增长率
4. THE Cost_Report SHALL 提供成本分布分析，包括模型分布、Agent 分布和操作类型分布
5. WHEN 检测到成本异常的 Mission 或 Agent 时, THE Cost_Report SHALL 自动标记异常并生成告警
6. THE Cost_Report SHALL 支持导出为 JSON 和 CSV 格式

### 需求 11：预算层级管理与集成

**用户故事：** 作为系统，我需要将成本治理与预算管理集成，支持多级预算的创建、修改、审批和执行，这样形成完整的成本治理闭环。

#### 验收标准

1. THE Governance_Engine SHALL 支持四级预算层级：组织级预算 → 部门级预算 → 项目级预算 → Mission 级预算
2. THE Governance_Engine SHALL 支持预算模板（如"标准编程任务预算"、"数据分析任务预算"），用户创建预算时可选择模板
3. WHEN 预算修改幅度超过 20% 时, THE Governance_Engine SHALL 要求审批
4. THE Governance_Engine SHALL 维护预算的版本历史，支持查看预算变更记录
5. WHEN 创建 Mission 级预算时, THE Governance_Engine SHALL 自动检查该预算是否超过上级预算（项目级），超过则拒绝创建
6. THE Governance_Engine SHALL 定期对账预算和实际成本，生成差异报告

### 需求 12：成本治理前端界面

**用户故事：** 作为用户，我需要在前端看到 Mission 的成本预算、成本消耗、成本预测和优化建议，这样可以直观了解成本状况。

#### 验收标准

1. THE 成本治理面板 SHALL 在 Mission 详情页展示成本预算、已消耗成本、剩余预算和消耗进度条
2. WHEN 成本数据更新时, THE 成本治理面板 SHALL 实时刷新，并支持按模型、按 Agent、按操作类型的成本分布展示
3. THE 成本治理面板 SHALL 展示成本预测信息，包括预计总成本、置信区间和预测更新时间
4. THE 成本治理面板 SHALL 展示优化建议列表，支持一键应用低风险建议
5. THE 成本治理面板 SHALL 展示当前告警状态、告警历史和响应措施
6. THE 成本治理面板 SHALL 提供成本报表入口，支持多维度分析和数据导出

### 需求 13：成本治理与动态组织集成

**用户故事：** 作为系统，我需要在动态组织生成时考虑成本因素，为不同的 Agent 分配不同的模型和资源限制，这样确保组织的总成本在预算范围内。

#### 验收标准

1. WHEN 动态组织生成时, THE Governance_Engine SHALL 根据 Mission 的成本预算为每个 Agent 分配模型
2. THE Governance_Engine SHALL 按 Agent 角色优先级分配模型：高优先级 Agent（如 CEO）使用高性能模型，低优先级 Agent（如 Worker）使用低成本模型
3. WHEN 组织生成完成时, THE Governance_Engine SHALL 计算组织的预期成本，如果超过预算则自动调整组织结构（减少 Agent 数量或降级模型）
4. THE Governance_Engine SHALL 支持在组织生成时指定成本约束参数（如"总成本不超过 100 元"）
5. WHILE Mission 执行中, THE Governance_Engine SHALL 实时监控组织成本，如果超过预算则触发降级或暂停策略

### 需求 14：成本治理与权限模型集成

**用户故事：** 作为系统，我需要将成本治理与权限模型集成，支持基于成本的权限控制，这样防止单个用户过度消耗资源。

#### 验收标准

1. THE Cost_Permission SHALL 定义基于成本的权限，包含 userId、monthlyBudget、dailyBudget、modelRestrictions 字段
2. THE Cost_Permission SHALL 包含用户的月度预算、日度预算和可用模型列表
3. WHEN 用户创建 Mission 时, THE Governance_Engine SHALL 检查用户的剩余预算，如果不足则拒绝创建并返回明确的错误信息
4. THE Governance_Engine SHALL 支持管理员动态调整用户的成本权限
5. THE Audit_Trail SHALL 记录每次成本权限变更操作
