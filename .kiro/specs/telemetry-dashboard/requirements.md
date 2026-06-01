# 需求文档：实时遥测仪表盘（Telemetry Dashboard）

## 简介

在 WhyBuddy 3D 像素办公室中新增实时监控仪表盘模块，让用户和开发者能够直观查看 LLM 调用次数、Token 消耗、费用预估、Agent 瓶颈、Mission 执行耗时等关键指标，实现可观测性闭环。支持纯前端模式（IndexedDB 缓存）和服务端模式双轨运行。

## 术语表

- **Telemetry_Store**：遥测指标存储模块，负责在内存中聚合指标并提供轻量持久化
- **Telemetry_Service**：后端遥测路由服务，提供 REST API 和 Socket.IO 实时推送
- **Telemetry_Dashboard**：前端仪表盘 React 组件，展示遥测指标卡片和图表
- **LLM_Client**：LLM API 封装模块（`server/core/llm-client.ts`），负责调用大语言模型
- **Agent**：智能体基类（`server/core/agent.ts`），封装 LLM 调用和上下文注入
- **Scene3D**：3D 办公场景主组件（`client/src/components/Scene3D.tsx`）
- **LLM_Call_Record**：单次 LLM 调用的遥测记录，包含 model、tokens_in、tokens_out、cost、duration 字段
- **Alert**：预警事件，当指标超过阈值时触发
- **Mission**：任务域中的一次完整任务执行
- **Budget**：Token 消耗预算上限

## 需求

### 需求 1：LLM 调用埋点采集

**用户故事：** 作为开发者，我希望每次 LLM 调用都被自动记录遥测数据，以便追踪 Token 消耗和费用。

#### 验收标准

1. WHEN LLM_Client 完成一次 LLM 调用, THE Telemetry_Store SHALL 记录一条 LLM_Call_Record，包含 model、tokens_in、tokens_out、cost、duration 字段
2. WHEN LLM_Client 调用失败, THE Telemetry_Store SHALL 记录该次调用的错误信息和已消耗的 duration
3. THE LLM_Call_Record SHALL 包含调用发起时的时间戳和关联的 agent_id（如有）
4. WHEN 记录 LLM_Call_Record 时, THE Telemetry_Store SHALL 在 5 毫秒内完成写入，避免阻塞 LLM 调用主流程

### 需求 2：Agent 响应时间采集

**用户故事：** 作为开发者，我希望追踪每个 Agent 的响应时间，以便识别性能瓶颈。

#### 验收标准

1. WHEN Agent 完成一次 invoke 或 invokeJson 调用, THE Telemetry_Store SHALL 记录该 Agent 的 agent_id、调用耗时和关联的 workflow_id
2. THE Telemetry_Store SHALL 维护每个 Agent 的滑动窗口平均响应时间（最近 20 次调用）

### 需求 3：遥测指标存储

**用户故事：** 作为开发者，我希望遥测数据在内存中高效聚合并支持轻量持久化，以便服务重启后不丢失最近的指标。

#### 验收标准

1. THE Telemetry_Store SHALL 在内存中维护当前 Mission 的实时聚合指标（总 Token 数、总费用、各 Agent 响应时间）
2. THE Telemetry_Store SHALL 保留最近 10 次 Mission 的历史指标摘要
3. WHEN 一次 Mission 完成, THE Telemetry_Store SHALL 将该 Mission 的指标摘要持久化到本地 JSON 文件
4. WHEN 服务启动, THE Telemetry_Store SHALL 从持久化文件加载最近 10 次 Mission 的历史指标
5. IF 持久化文件损坏或不存在, THEN THE Telemetry_Store SHALL 以空历史状态启动并记录警告日志

### 需求 4：遥测 REST API

**用户故事：** 作为前端组件，我希望通过 REST API 获取遥测指标快照和历史数据。

#### 验收标准

1. WHEN 前端请求 `GET /api/telemetry/live`, THE Telemetry_Service SHALL 返回当前 Mission 的实时指标快照，包含总 Token 数、总费用、各 Agent 响应时间排名、活跃 Agent 计数
2. WHEN 前端请求 `GET /api/telemetry/history`, THE Telemetry_Service SHALL 返回最近 10 次 Mission 的指标摘要列表
3. IF 当前没有活跃 Mission, THEN THE Telemetry_Service SHALL 返回零值快照而非错误

### 需求 5：Socket.IO 实时推送

**用户故事：** 作为前端仪表盘，我希望通过 Socket.IO 接收实时遥测更新，以便秒级刷新指标。

#### 验收标准

1. WHEN Telemetry_Store 中的指标发生变化, THE Telemetry_Service SHALL 通过 Socket.IO 广播 `telemetry.update` 事件，携带最新的实时指标快照
2. THE Telemetry_Service SHALL 对 `telemetry.update` 事件进行节流，广播间隔不低于 500 毫秒，避免高频推送
3. WHEN 新的 Socket.IO 客户端连接, THE Telemetry_Service SHALL 立即向该客户端发送一次当前指标快照

### 需求 6：前端仪表盘组件

**用户故事：** 作为用户，我希望在前端看到直观的遥测仪表盘，以便实时了解系统运行状态。

#### 验收标准

1. THE Telemetry_Dashboard SHALL 展示以下四个卡片：当前 Token 消耗与费用（带进度条）、Top 3 瓶颈 Agent、Mission 阶段耗时柱状图、实时活跃 Agent 计数
2. THE Telemetry_Dashboard SHALL 展示最近 5 次 Mission 的历史指标趋势折线图
3. WHEN 收到 `telemetry.update` Socket 事件, THE Telemetry_Dashboard SHALL 在 1 秒内更新所有卡片数据
4. THE Telemetry_Dashboard SHALL 支持"展开/收起"两种模式，默认收起状态，避免干扰 3D 视觉体验
5. WHEN 用户点击展开按钮, THE Telemetry_Dashboard SHALL 以侧滑动画展开完整面板

### 需求 7：3D 场景集成

**用户故事：** 作为用户，我希望在 3D 场景中通过像素风格图标快速打开遥测仪表盘。

#### 验收标准

1. THE Scene3D SHALL 在右上角显示一个像素风格的仪表盘浮窗图标
2. WHEN 用户点击该图标, THE Scene3D SHALL 触发 Telemetry_Dashboard 的展开或收起切换
3. WHEN 存在活跃预警, THE Scene3D SHALL 在仪表盘图标上显示红色圆点徽标

### 需求 8：瓶颈预警机制

**用户故事：** 作为用户，我希望在 Agent 响应过慢或 Token 超预算时收到视觉预警。

#### 验收标准

1. WHEN 某个 Agent 的滑动窗口平均响应时间超过 30 秒, THE Telemetry_Store SHALL 生成一条 Agent 响应过慢预警
2. WHEN 当前 Mission 的累计 Token 消耗超过预设 Budget 的 80%, THE Telemetry_Store SHALL 生成一条 Token 超预算预警
3. WHEN 存在活跃预警, THE Telemetry_Dashboard SHALL 在对应卡片中以醒目样式高亮显示预警信息
4. WHEN 存在 Agent 响应过慢预警, THE Scene3D SHALL 在对应 Agent 的 3D 模型头顶显示警告图标

### 需求 9：纯前端模式支持

**用户故事：** 作为纯前端模式用户，我希望仪表盘在没有服务端的情况下也能正常显示本地遥测指标。

#### 验收标准

1. WHILE 系统运行在纯前端模式, THE Telemetry_Dashboard SHALL 从浏览器端 LLM 调用中采集遥测数据
2. WHILE 系统运行在纯前端模式, THE Telemetry_Store SHALL 将指标缓存到 IndexedDB 中
3. WHEN 用户刷新页面, THE Telemetry_Store SHALL 从 IndexedDB 恢复最近的遥测指标

### 需求 10：共享类型定义

**用户故事：** 作为开发者，我希望遥测相关的类型定义在前后端之间共享，以保证数据结构一致性。

#### 验收标准

1. THE 遥测模块 SHALL 在 `shared/telemetry.ts` 中定义所有遥测相关的 TypeScript 接口（LLM_Call_Record、指标快照、历史摘要、预警事件）
2. THE 前端和后端代码 SHALL 共同引用 `shared/telemetry.ts` 中的类型定义
3. THE 遥测类型定义 SHALL 支持 JSON 序列化和反序列化，以便在 REST API 和 Socket.IO 中传输
