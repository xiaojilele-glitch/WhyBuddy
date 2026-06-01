# 需求文档：成本可观测性系统（Cost Observability）

## 简介

在 WhyBuddy 平台中新增完整的成本可观测性系统，实时追踪 LLM Token 消耗、费用预估、预算限制，并在 3D 办公室和 /tasks 页面中以可视化看板形式呈现。系统支持预警和自动降级策略，当 Token 或费用即将超限时自动发出预警并可切换低成本模型或暂停非关键 Agent。支持纯前端模式（本地模拟数据）和服务端模式双轨运行。

## 术语表

- **Cost_Tracker**：成本追踪核心模块（`server/core/cost-tracker.ts`），负责采集、聚合、预警和降级决策
- **Cost_Service**：成本路由服务（`server/routes/cost.ts`），提供 REST API 和 Socket.IO 实时推送
- **Cost_Dashboard**：前端成本看板 React 组件（`client/src/components/CostDashboard.tsx`）
- **LLM_Client**：LLM API 封装模块（`server/core/llm-client.ts`），负责调用大语言模型
- **Scene3D**：3D 办公场景主组件（`client/src/components/Scene3D.tsx`）
- **Pricing_Table**：模型定价表（`shared/cost.ts`），包含各模型的 input/output 单价
- **Cost_Record**：单次 LLM 调用的成本记录，包含 model、tokens_in、tokens_out、unit_price、actual_cost、duration 字段
- **Budget**：预算配置，包含最大费用限额、最大 Token 限额和预警阈值百分比
- **Downgrade_Policy**：自动降级策略，定义超预算时的模型切换规则和 Agent 暂停规则
- **Mission**：任务域中的一次完整任务执行
- **Agent**：智能体基类，封装 LLM 调用和上下文注入
- **Cost_Snapshot**：实时成本快照，包含当前 Mission/会话的聚合成本指标

## 需求

### 需求 1：LLM 调用成本采集

**用户故事：** 作为开发者，我希望每次 LLM 调用的 Token 消耗和费用被自动记录，以便精确追踪成本。

#### 验收标准

1. WHEN LLM_Client 完成一次成功的 LLM 调用, THE Cost_Tracker SHALL 记录一条 Cost_Record，包含 model、tokens_in、tokens_out、unit_price_in、unit_price_out、actual_cost、duration_ms、timestamp 字段
2. WHEN LLM_Client 调用失败, THE Cost_Tracker SHALL 记录该次调用的 model、error 信息和已消耗的 duration_ms
3. THE Cost_Record SHALL 包含调用关联的 agent_id、mission_id 和 session_id（如有）
4. WHEN 记录 Cost_Record 时, THE Cost_Tracker SHALL 使用同步内存写入，在 5 毫秒内完成，避免阻塞 LLM 调用主流程

### 需求 2：模型定价表

**用户故事：** 作为开发者，我希望系统维护一份模型官方定价表，以便准确预估每次调用的费用。

#### 验收标准

1. THE Pricing_Table SHALL 在 `shared/cost.ts` 中定义所有支持模型的 input/output 单价（每千 Token 美元价格）
2. THE Pricing_Table SHALL 包含 glm-5-turbo、glm-4.6、gpt-4o-mini、gpt-4o 的定价
3. WHEN 遇到未在 Pricing_Table 中定义的模型, THE Cost_Tracker SHALL 使用默认兜底定价（input: 0.001, output: 0.002 美元/千 Token）
4. THE Pricing_Table SHALL 提供 `estimateCost(model, tokensIn, tokensOut)` 纯函数，返回预估费用

### 需求 3：多维度成本聚合

**用户故事：** 作为用户，我希望按 Mission、Agent、会话维度查看成本聚合数据，以便了解费用分布。

#### 验收标准

1. THE Cost_Tracker SHALL 在内存中维护当前 Mission 的实时聚合指标：总 Token 数（input + output）、总费用、各 Agent 费用占比
2. THE Cost_Tracker SHALL 支持按 agent_id 维度聚合成本，返回每个 Agent 的 Token 消耗和费用
3. THE Cost_Tracker SHALL 支持按 session_id 维度聚合成本，返回每个会话的 Token 消耗和费用
4. WHEN 一次 Mission 完成, THE Cost_Tracker SHALL 将该 Mission 的成本摘要归档到历史列表
5. THE Cost_Tracker SHALL 保留最近 10 次 Mission 的历史成本摘要

### 需求 4：预算设置与实时预警

**用户故事：** 作为用户，我希望设置预算上限并在即将超限时收到预警，以便控制成本。

#### 验收标准

1. THE Cost_Tracker SHALL 支持用户配置 Budget，包含 max_cost（最大费用，美元）、max_tokens（最大 Token 数）和 warning_threshold（预警阈值百分比，默认 80%）
2. WHEN 当前 Mission 的累计费用超过 Budget.max_cost × Budget.warning_threshold, THE Cost_Tracker SHALL 生成一条费用预警
3. WHEN 当前 Mission 的累计 Token 总量超过 Budget.max_tokens × Budget.warning_threshold, THE Cost_Tracker SHALL 生成一条 Token 预警
4. WHEN 当前 Mission 的累计费用达到 Budget.max_cost, THE Cost_Tracker SHALL 生成一条费用超限事件
5. WHEN 当前 Mission 的累计 Token 总量达到 Budget.max_tokens, THE Cost_Tracker SHALL 生成一条 Token 超限事件
6. THE Cost_Tracker SHALL 计算并提供剩余预算百分比（费用维度和 Token 维度）

### 需求 5：自动降级策略

**用户故事：** 作为用户，我希望系统在超预算时自动切换低成本模型或暂停非关键 Agent，以便避免费用失控。

#### 验收标准

1. THE Downgrade_Policy SHALL 定义降级规则：当费用或 Token 达到预警阈值时触发软降级，达到上限时触发硬降级
2. WHEN 软降级触发, THE LLM_Client SHALL 将后续 LLM 调用的模型切换为 Downgrade_Policy 中指定的低成本模型
3. WHEN 硬降级触发, THE Cost_Tracker SHALL 标记非关键 Agent 为暂停状态，阻止其发起新的 LLM 调用
4. WHEN 用户手动解除降级, THE LLM_Client SHALL 恢复使用原始配置的模型
5. THE Downgrade_Policy SHALL 支持用户配置低成本替代模型名称和关键 Agent 白名单

### 需求 6：成本 REST API

**用户故事：** 作为前端组件，我希望通过 REST API 获取成本快照、历史数据和预算配置。

#### 验收标准

1. WHEN 前端请求 `GET /api/cost/live`, THE Cost_Service SHALL 返回当前 Mission 的实时成本快照，包含总 Token 数、总费用、剩余预算百分比、各 Agent 费用占比、活跃预警列表
2. WHEN 前端请求 `GET /api/cost/history`, THE Cost_Service SHALL 返回最近 10 次 Mission 的成本摘要列表
3. WHEN 前端请求 `GET /api/cost/budget`, THE Cost_Service SHALL 返回当前 Budget 配置
4. WHEN 前端请求 `PUT /api/cost/budget`, THE Cost_Service SHALL 更新 Budget 配置并立即重新评估预警状态
5. IF 当前没有活跃 Mission, THEN THE Cost_Service SHALL 返回零值快照而非错误

### 需求 7：Socket.IO 实时推送

**用户故事：** 作为前端看板，我希望通过 Socket.IO 接收实时成本更新，以便秒级刷新指标。

#### 验收标准

1. WHEN Cost_Tracker 中的成本指标发生变化, THE Cost_Service SHALL 通过 Socket.IO 广播 `cost.update` 事件，携带最新的 Cost_Snapshot
2. THE Cost_Service SHALL 对 `cost.update` 事件进行节流，广播间隔不低于 500 毫秒
3. WHEN 新的 Socket.IO 客户端连接, THE Cost_Service SHALL 立即向该客户端发送一次当前 Cost_Snapshot
4. WHEN 预警或降级状态变化, THE Cost_Service SHALL 通过 Socket.IO 广播 `cost.alert` 事件

### 需求 8：成本看板组件

**用户故事：** 作为用户，我希望在前端看到直观的成本看板，实时了解 Token 消耗、费用和预算状态。

#### 验收标准

1. THE Cost_Dashboard SHALL 展示以下卡片：当前 Token 消耗（input/output 分开显示，带进度条）、实时费用（带预算进度条）、剩余预算百分比、各 Agent 费用占比饼图
2. THE Cost_Dashboard SHALL 展示最近 10 次 Mission 的历史成本趋势折线图
3. WHEN 收到 `cost.update` Socket 事件, THE Cost_Dashboard SHALL 在 1 秒内更新所有卡片数据
4. WHEN 存在活跃预警, THE Cost_Dashboard SHALL 在看板顶部以醒目样式显示预警横幅
5. THE Cost_Dashboard SHALL 提供预算设置入口，允许用户修改 max_cost、max_tokens 和 warning_threshold
6. THE Cost_Dashboard SHALL 提供一键降级操作按钮：切换低成本模型、暂停非关键 Agent、解除降级

### 需求 9：3D 场景成本浮窗

**用户故事：** 作为用户，我希望在 3D 场景中通过浮窗快速查看成本概要和预警状态。

#### 验收标准

1. THE Scene3D SHALL 在右上角显示一个成本浮窗，展示当前费用和剩余预算百分比
2. WHEN 存在活跃预警, THE Scene3D SHALL 将成本浮窗边框变为红色并显示预警图标
3. WHEN 用户点击成本浮窗, THE Scene3D SHALL 触发 Cost_Dashboard 的展开或收起切换
4. WHEN 降级状态激活, THE Scene3D SHALL 在浮窗中显示降级状态标识

### 需求 10：/tasks 页面成本侧边栏

**用户故事：** 作为用户，我希望在 /tasks 页面查看当前 Mission 的成本详情。

#### 验收标准

1. WHEN 用户在 /tasks 页面查看某个 Mission 详情, THE Cost_Dashboard SHALL 在侧边栏中展示该 Mission 的成本明细
2. THE 成本侧边栏 SHALL 展示该 Mission 的 Token 消耗时间线和费用累计曲线
3. WHEN Mission 正在执行中, THE 成本侧边栏 SHALL 实时更新成本数据

### 需求 11：历史成本持久化

**用户故事：** 作为用户，我希望历史成本数据在服务重启后不丢失。

#### 验收标准

1. WHEN 一次 Mission 完成, THE Cost_Tracker SHALL 将该 Mission 的成本摘要持久化到本地 JSON 文件
2. WHEN 服务启动, THE Cost_Tracker SHALL 从持久化文件加载最近 10 次 Mission 的历史成本数据
3. IF 持久化文件损坏或不存在, THEN THE Cost_Tracker SHALL 以空历史状态启动并记录警告日志

### 需求 12：纯前端模式支持

**用户故事：** 作为纯前端模式用户，我希望成本看板在没有服务端的情况下也能正常显示本地成本指标。

#### 验收标准

1. WHILE 系统运行在纯前端模式, THE Cost_Dashboard SHALL 从浏览器端 LLM 调用中采集成本数据
2. WHILE 系统运行在纯前端模式, THE Cost_Tracker SHALL 将成本数据缓存到 IndexedDB 中
3. WHEN 用户刷新页面, THE Cost_Tracker SHALL 从 IndexedDB 恢复最近的成本数据

### 需求 13：共享类型定义

**用户故事：** 作为开发者，我希望成本相关的类型定义在前后端之间共享，以保证数据结构一致性。

#### 验收标准

1. THE 成本模块 SHALL 在 `shared/cost.ts` 中定义所有成本相关的 TypeScript 接口（Cost_Record、Cost_Snapshot、Budget、Downgrade_Policy、历史摘要、预警事件）
2. THE 前端和后端代码 SHALL 共同引用 `shared/cost.ts` 中的类型定义
3. THE 成本类型定义 SHALL 支持 JSON 序列化和反序列化，以便在 REST API 和 Socket.IO 中传输
