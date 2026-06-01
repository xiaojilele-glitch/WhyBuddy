# 自然语言指挥中心 需求文档

## 概述

自然语言指挥中心（NL Command Center）是 WhyBuddy 的战略指令入口层。用户输入战略级自然语言指令（如"重构支付模块，要求零停机"），系统通过 LLM 理解意图、约束和目标，自动分解为多个 Mission 和 Task，生成详细的执行计划（含依赖关系、风险评估、资源分配），并支持指令澄清、计划审批、执行监控和动态调整，形成从战略指令到具体执行的完整闭环。

## 术语表

- **Strategic_Command**: 用户输入的战略级自然语言指令，包含意图、约束和目标
- **Command_Analyzer**: 调用 LLM 解析战略指令的服务组件
- **Command_Analysis**: LLM 对指令的解析结果，包含 intent、entities、constraints、objectives、risks、assumptions
- **Clarification_Dialog**: 系统与用户之间的多轮澄清对话
- **Finalized_Command**: 澄清完成后的最终确认指令
- **Mission_Decomposer**: 将战略指令分解为多个 Mission 的服务组件
- **Mission_Decomposition**: 分解结果，包含 Mission 列表、依赖关系和执行顺序
- **Task_Decomposer**: 将 Mission 分解为多个 Task 的服务组件
- **Task_Decomposition**: 分解结果，包含 Task 列表、依赖关系和执行顺序
- **Execution_Plan_Generator**: 生成完整执行计划的服务组件
- **NL_Execution_Plan**: 指挥中心级别的执行计划，包含时间表、资源分配、风险评估、成本预算和应急计划
- **Plan_Approval**: 执行计划的审批流程
- **Plan_Adjustment**: 执行过程中的计划动态调整
- **Command_Center_Dashboard**: 指挥中心实时监控仪表板
- **Alert_Engine**: 告警引擎，负责检测异常并发送通知
- **Decision_Support_Engine**: 决策支持引擎，提供风险分析和优化建议
- **Audit_Trail**: 审计链，记录所有操作的不可变日志
- **MissionRecord**: 已有的 Mission 数据模型（来自 shared/mission/contracts.ts）
- **WorkflowOrganizationSnapshot**: 已有的动态组织快照（来自 shared/organization-schema.ts）

## 需求

### 需求 1: 解析战略级自然语言指令

**用户故事:** 作为用户，我希望输入战略级自然语言指令，系统自动解析出意图、约束条件和目标，以便后续自动分解和执行。

#### 验收标准

1. THE Strategic_Command SHALL contain commandId, commandText, userId, timestamp, parsedIntent, constraints, objectives, priority, and timeframe fields
2. WHEN a Strategic_Command is submitted, THE Command_Analyzer SHALL call LLM to produce a Command_Analysis containing intent, entities, constraints, objectives, risks, and assumptions
3. WHEN the Command_Analyzer extracts constraints, THE Command_Analysis SHALL include primary objectives, constraint conditions (such as "zero downtime" or "cost under 1000 yuan"), priority level, and time requirements
4. WHEN the Command_Analyzer completes analysis, THE Audit_Trail SHALL record the original command text, the Command_Analysis result, and the clarification process

### 需求 2: 指令的多轮澄清和确认

**用户故事:** 作为用户，我希望系统在指令不够明确时主动提问澄清，以便系统准确理解我的意图。

#### 验收标准

1. THE Clarification_Dialog SHALL contain dialogId, commandId, questions, answers, and clarificationRounds fields
2. WHEN the Command_Analyzer detects ambiguity in a Strategic_Command, THE Command_Analyzer SHALL generate clarification questions automatically via LLM
3. WHEN a user responds to a clarification question, THE Clarification_Dialog SHALL accept both free-text answers and selection-based answers
4. WHEN a clarification answer is received, THE Command_Analyzer SHALL update the Command_Analysis in real time to reflect the new information
5. WHEN all clarification rounds are complete, THE Command_Analyzer SHALL produce a Finalized_Command
6. WHEN a clarification round occurs, THE Audit_Trail SHALL record the full dialog including questions and answers

### 需求 3: 战略指令分解为 Mission

**用户故事:** 作为用户，我希望系统将我的战略指令自动分解为多个可执行的 Mission，并识别它们之间的依赖关系。

#### 验收标准

1. THE Mission_Decomposition SHALL contain decompositionId, commandId, missions list, dependencies, and executionOrder
2. WHEN a Finalized_Command is received, THE Mission_Decomposer SHALL call LLM to generate a list of MissionRecord entries
3. WHEN generating MissionRecord entries, THE Mission_Decomposer SHALL include missionId, title, description, objectives, constraints, estimatedDuration, estimatedCost, and priority for each entry
4. WHEN generating a Mission_Decomposition, THE Mission_Decomposer SHALL identify dependency relationships between MissionRecord entries
5. WHEN generating a Mission_Decomposition, THE Mission_Decomposer SHALL produce an executionOrder that respects dependency relationships and maximizes parallelism
6. WHEN a Mission_Decomposition is complete, THE Audit_Trail SHALL record the decomposition result

### 需求 4: Mission 分解为 Task

**用户故事:** 作为用户，我希望每个 Mission 被进一步分解为具体的 Task，以便精细化执行和跟踪。

#### 验收标准

1. THE Task_Decomposition SHALL contain decompositionId, missionId, tasks list, dependencies, and executionOrder
2. WHEN a MissionRecord is created from decomposition, THE Task_Decomposer SHALL call LLM to generate a list of tasks
3. WHEN generating tasks, THE Task_Decomposer SHALL include taskId, title, description, objectives, constraints, estimatedDuration, estimatedCost, requiredSkills, and priority for each task
4. WHEN generating a Task_Decomposition, THE Task_Decomposer SHALL identify dependency relationships between tasks
5. WHEN generating a Task_Decomposition, THE Task_Decomposer SHALL produce an executionOrder that respects dependency relationships
6. WHEN a Task_Decomposition is complete, THE Audit_Trail SHALL record the decomposition result

### 需求 5: 生成详细的执行计划

**用户故事:** 作为用户，我希望系统为我的战略指令生成一份完整的执行计划，包含时间表、资源分配、风险评估和成本预算。

#### 验收标准

1. THE NL_Execution_Plan SHALL contain planId, commandId, missions, tasks, timeline, resourceAllocation, riskAssessment, costBudget, and contingencyPlan
2. WHEN generating a timeline, THE Execution_Plan_Generator SHALL compute start time, end time, and critical path for each Mission and Task
3. WHEN generating resource allocation, THE Execution_Plan_Generator SHALL specify the Agent type, quantity, and skill requirements for each Task
4. WHEN generating risk assessment, THE Execution_Plan_Generator SHALL identify risks, assign risk levels, and propose mitigation measures
5. WHEN generating cost budget, THE Execution_Plan_Generator SHALL compute expected cost per Mission and Task, total cost, and cost distribution
6. WHEN generating contingency plan, THE Execution_Plan_Generator SHALL include alternative approaches, degradation strategies, and rollback plans

### 需求 6: 执行计划的可视化展示

**用户故事:** 作为用户，我希望通过甘特图、依赖关系图等可视化方式查看执行计划，以便直观理解计划全貌。

#### 验收标准

1. WHEN an NL_Execution_Plan is displayed, THE Command_Center_Dashboard SHALL render a Gantt chart showing Mission and Task timelines, critical path, and parallelism
2. WHEN an NL_Execution_Plan is displayed, THE Command_Center_Dashboard SHALL render a dependency graph showing relationships between Missions and Tasks
3. WHEN an NL_Execution_Plan is displayed, THE Command_Center_Dashboard SHALL render a resource allocation chart showing resource usage per time period
4. WHEN an NL_Execution_Plan is displayed, THE Command_Center_Dashboard SHALL render a risk heat map showing risk distribution and severity levels
5. WHEN an NL_Execution_Plan is displayed, THE Command_Center_Dashboard SHALL render a cost distribution chart showing cost breakdown
6. WHEN a user interacts with a visualization element, THE Command_Center_Dashboard SHALL support drill-down, zoom, and filtering operations

### 需求 7: 执行计划的审批和确认

**用户故事:** 作为审批人，我希望审查执行计划并提出修改意见或批准执行，以确保计划合理可行。

#### 验收标准

1. THE Plan_Approval SHALL contain requestId, planId, requiredApprovers, approvalStatus, and comments
2. WHEN an NL_Execution_Plan requires approval, THE Plan_Approval SHALL support multi-level approval workflows
3. WHEN reviewing a Plan_Approval, THE Command_Center_Dashboard SHALL display the complete NL_Execution_Plan, risk assessment, and cost budget
4. WHEN an approver submits modification comments, THE Execution_Plan_Generator SHALL automatically adjust the NL_Execution_Plan based on the feedback
5. WHEN all required approvers approve, THE Plan_Approval SHALL mark the NL_Execution_Plan as executable by producing an ApprovedPlan
6. WHEN an approval action occurs, THE Audit_Trail SHALL record the approver, action, timestamp, and comments

### 需求 8: 执行计划的动态调整

**用户故事:** 作为用户，我希望系统在执行过程中检测偏差并自动建议调整，以确保计划按时按质完成。

#### 验收标准

1. THE Plan_Adjustment SHALL contain adjustmentId, planId, reason, changes, impact, and approvalRequired flag
2. WHILE an NL_Execution_Plan is executing, THE Command_Center_Dashboard SHALL monitor execution progress and detect deviations from the plan
3. WHEN a deviation is detected, THE Execution_Plan_Generator SHALL automatically generate adjustment suggestions
4. WHEN an adjustment suggestion requires approval, THE Plan_Approval SHALL process the adjustment through the approval workflow
5. WHEN an adjustment is approved, THE Execution_Plan_Generator SHALL update the NL_Execution_Plan and timeline automatically
6. WHEN a Plan_Adjustment occurs, THE Audit_Trail SHALL record the adjustment reason, changes, and impact

### 需求 9: 指挥中心的实时监控

**用户故事:** 作为用户，我希望在指挥中心仪表板上实时查看所有 Mission 和 Task 的状态、进度和风险。

#### 验收标准

1. THE Command_Center_Dashboard SHALL display key metrics including total Missions, completion rate, active Tasks, and overall risk level
2. WHEN displaying Mission list, THE Command_Center_Dashboard SHALL show status, progress, cost, and risk for each MissionRecord
3. WHEN displaying Task list, THE Command_Center_Dashboard SHALL show status, progress, cost, risk, and executing Agent for each Task
4. WHILE the Command_Center_Dashboard is active, THE Command_Center_Dashboard SHALL update displayed data via Socket.IO with latency under 1 second
5. WHEN a user applies filters, THE Command_Center_Dashboard SHALL support filtering and sorting by Mission, priority, and status
6. WHEN a user clicks a Mission or Task entry, THE Command_Center_Dashboard SHALL support drill-down to view detailed information

### 需求 10: 指挥中心的告警和通知

**用户故事:** 作为用户，我希望系统在出现延迟、成本超支或风险升级时及时告警，以便我快速响应。

#### 验收标准

1. THE Alert_Engine SHALL support alert types: TASK_DELAYED, COST_EXCEEDED, RISK_ESCALATED, ERROR_OCCURRED, and APPROVAL_REQUIRED
2. WHEN an alert is triggered, THE Alert_Engine SHALL deliver notifications through Socket.IO push and in-app notification center
3. WHEN generating alerts, THE Alert_Engine SHALL assign priority levels (critical, warning, info) based on severity
4. WHEN configuring alerts, THE Alert_Engine SHALL support custom alert rules with user-defined thresholds and conditions
5. WHEN an alert is triggered, THE Audit_Trail SHALL record the alert type, trigger condition, and notification result

### 需求 11: 指挥中心的决策支持

**用户故事:** 作为用户，我希望系统提供风险分析和优化建议，帮助我做出更好的决策。

#### 验收标准

1. WHEN providing risk analysis, THE Decision_Support_Engine SHALL include identified risks, risk levels, mitigation measures, and contingency plans
2. WHEN analyzing cost, THE Decision_Support_Engine SHALL generate cost optimization suggestions based on current spending patterns
3. WHEN analyzing resources, THE Decision_Support_Engine SHALL generate resource adjustment suggestions based on utilization data
4. WHEN a user clicks "apply suggestion", THE Decision_Support_Engine SHALL create a Plan_Adjustment with the suggested changes
5. WHEN a suggestion is applied, THE Plan_Approval SHALL process the adjustment through the approval workflow

### 需求 12: 指挥中心的协作和沟通

**用户故事:** 作为团队成员，我希望在 Mission 和 Task 上添加评论和讨论，以便团队协作沟通。

#### 验收标准

1. WHEN a user adds a comment, THE Command_Center_Dashboard SHALL attach the comment to the specified Mission or Task object
2. WHEN a comment contains @mention syntax, THE Alert_Engine SHALL send a notification to the mentioned user
3. WHEN a comment is edited, THE Command_Center_Dashboard SHALL maintain version history and edit records for the comment
4. WHEN accessing comments, THE Command_Center_Dashboard SHALL enforce permission controls based on user role
5. WHEN a comment is created or edited, THE Audit_Trail SHALL record the comment action

### 需求 13: 指挥中心的报告和总结

**用户故事:** 作为管理者，我希望系统生成执行报告，包含进度分析、成本分析和风险分析，以便我了解整体情况。

#### 验收标准

1. WHEN generating an execution report, THE Command_Center_Dashboard SHALL include execution summary, progress analysis, cost analysis, and risk analysis
2. WHEN exporting a report, THE Command_Center_Dashboard SHALL support Markdown and JSON export formats
3. WHEN generating a report, THE Command_Center_Dashboard SHALL support user-defined content selection for custom reports
4. WHEN comparing reports, THE Command_Center_Dashboard SHALL support plan-vs-actual comparison analysis
5. WHEN a report is generated, THE Command_Center_Dashboard SHALL support export and sharing via download link

### 需求 14: 指挥中心与动态组织的集成

**用户故事:** 作为系统，我需要在 Mission 创建时自动生成匹配的组织结构，以确保有合适的 Agent 团队执行任务。

#### 验收标准

1. WHEN a MissionRecord is created from decomposition, THE Mission_Decomposer SHALL trigger dynamic organization generation to produce a WorkflowOrganizationSnapshot
2. WHEN generating organization structure, THE Mission_Decomposer SHALL determine scale and role configuration based on Mission complexity and scope
3. WHEN generating organization structure, THE Mission_Decomposer SHALL include required Skills and MCP tool configurations in the WorkflowOrganizationSnapshot
4. WHEN generating organization structure, THE Mission_Decomposer SHALL integrate the organization cost with the Mission cost budget
5. WHEN generating organization structure, THE Mission_Decomposer SHALL integrate the organization permissions with the Mission permission model

### 需求 15: 指挥中心与成本治理的集成

**用户故事:** 作为管理者，我希望系统自动为执行计划设置成本预算并实时监控消耗，以便控制成本。

#### 验收标准

1. WHEN an NL_Execution_Plan is generated, THE Execution_Plan_Generator SHALL set cost budgets for each Mission and Task automatically
2. WHEN estimating cost budgets, THE Execution_Plan_Generator SHALL base estimates on historical data, task complexity, and resource allocation factors
3. WHEN a cost budget is set, THE Plan_Approval SHALL allow manual adjustment and approval of the budget
4. WHILE an NL_Execution_Plan is executing, THE Command_Center_Dashboard SHALL monitor cost consumption in real time
5. WHEN generating cost analysis, THE Command_Center_Dashboard SHALL provide cost distribution by Mission, Task, Agent, and LLM model

### 需求 16: 指挥中心与审计链的集成

**用户故事:** 作为管理者，我希望所有操作都记录到审计链，以便追溯和合规审查。

#### 验收标准

1. WHEN any operation occurs in the NL Command Center, THE Audit_Trail SHALL record the operation as an immutable log entry
2. WHEN recording an audit entry, THE Audit_Trail SHALL include operator, operation content, timestamp, and operation result
3. WHEN querying audit logs, THE Audit_Trail SHALL support search by time range, operator, operation type, and related entity
4. WHEN exporting audit logs, THE Audit_Trail SHALL support JSON export format for compliance reporting

### 需求 17: 指挥中心的权限控制

**用户故事:** 作为管理者，我希望不同角色有不同的操作权限，以确保系统安全和职责分离。

#### 验收标准

1. THE Command_Center_Dashboard SHALL enforce permissions including view, create, edit, approve, execute, and cancel for all operations
2. WHEN a user attempts an operation, THE Command_Center_Dashboard SHALL verify the user role has the required permission before proceeding
3. WHEN configuring permissions, THE Command_Center_Dashboard SHALL support fine-grained control at Mission, Task, and resource levels
4. WHEN a permission change occurs, THE Audit_Trail SHALL record the permission change details

### 需求 18: 指挥中心的前端界面

**用户故事:** 作为用户，我希望指挥中心提供直观的前端界面，包含指令输入、计划展示、实时监控和决策支持区域。

#### 验收标准

1. THE Command_Center_Dashboard SHALL include a command input area, plan display area, real-time monitoring area, and decision support area
2. WHEN entering a command, THE Command_Center_Dashboard SHALL support natural language text input with auto-complete suggestions
3. WHEN displaying plans, THE Command_Center_Dashboard SHALL support Gantt chart, dependency graph, and resource allocation chart views
4. WHEN displaying monitoring data, THE Command_Center_Dashboard SHALL show key metrics and active alerts
5. WHEN displaying decision support, THE Command_Center_Dashboard SHALL show suggestions and analysis results
6. WHEN toggling display mode, THE Command_Center_Dashboard SHALL support full-screen mode and multi-panel layout

### 需求 19: 指挥中心的历史和模板

**用户故事:** 作为用户，我希望查看历史指令和执行计划，并基于历史创建模板以便复用。

#### 验收标准

1. WHEN a user requests history, THE Command_Center_Dashboard SHALL display past Strategic_Commands and their associated NL_Execution_Plans
2. WHEN a user selects a historical command, THE Command_Center_Dashboard SHALL support creating a new Strategic_Command based on the historical one
3. WHEN a user saves a template, THE Command_Center_Dashboard SHALL persist the NL_Execution_Plan as a reusable template with name and description
4. WHEN managing templates, THE Command_Center_Dashboard SHALL support version management and change history for each template
5. WHEN sharing templates, THE Command_Center_Dashboard SHALL support template sharing and reuse across users

### 需求 20: 指挥中心的学习和优化

**用户故事:** 作为系统，我需要从历史执行数据中学习，持续优化估算模型和分解策略。

#### 验收标准

1. WHEN an NL_Execution_Plan completes, THE Decision_Support_Engine SHALL collect execution data including actual duration, actual cost, and deviation metrics
2. WHEN historical data is available, THE Decision_Support_Engine SHALL compare planned vs actual results and analyze deviation causes
3. WHEN sufficient historical data is accumulated, THE Decision_Support_Engine SHALL optimize the estimation model for duration and cost predictions
4. WHEN sufficient historical data is accumulated, THE Decision_Support_Engine SHALL optimize the decomposition strategy for Mission and Task generation
5. WHEN optimization analysis is complete, THE Decision_Support_Engine SHALL generate periodic optimization reports
