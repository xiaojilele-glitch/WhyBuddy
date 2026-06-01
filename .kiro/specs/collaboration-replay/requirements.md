# 需求文档：协作回放系统 (Collaboration Replay)

## 简介

协作回放系统为 WhyBuddy 多智能体可视化教学平台提供完整的 Mission 执行过程录制与回放能力。系统在 Mission 执行期间异步采集所有关键事件（Agent 启动、通信、决策、代码执行、资源访问等），构建时间轴索引，并通过回放引擎在 3D 场景中以动画形式重现协作过程。同时支持事件详情查看、数据血缘追踪、权限审计、成本追踪、性能分析、快照书签、导出报告、对比分析和教学演示等高级功能。

## 术语表

- **Replay_System**：协作回放系统的总称，包含事件采集、存储、回放引擎、可视化等子系统
- **Event_Collector**：事件采集器，负责在 Mission 执行过程中异步采集各类事件
- **ExecutionEvent**：执行事件，Mission 执行过程中产生的任意一条记录
- **CommunicationEvent**：通信事件，Agent 之间消息交互的记录
- **DecisionEvent**：决策事件，Agent 做出决策的完整记录
- **CodeExecutionEvent**：代码执行事件，Agent 执行代码的记录
- **ResourceAccessEvent**：资源访问事件，Agent 访问外部资源的记录
- **ExecutionTimeline**：执行时间轴，按时间排序的事件流及其索引
- **Replay_Engine**：回放引擎，负责按时间顺序回放事件并提供播放控制
- **Replay_Renderer**：回放渲染器，负责将事件映射到 3D 场景动画
- **Snapshot**：快照，回放过程中某一时刻的完整状态
- **Data_Lineage_Tracker**：数据血缘追踪器，追踪数据的来源和流向
- **Replay_Store**：回放数据存储层，负责事件流的持久化和检索
- **Mission_Runtime**：现有的 Mission 运行时（mission-orchestrator.ts、mission-store.ts）
- **Message_Bus**：现有的消息总线（message-bus.ts）

## 需求

### 需求 1：采集 Mission 执行事件流

**用户故事：** 作为系统运维人员，我希望在 Mission 执行过程中采集所有关键事件并按时间顺序记录，以便形成完整的执行事件流供后续回放。

#### 验收标准

1. THE ExecutionEvent SHALL 包含以下字段：eventId（唯一标识）、missionId（关联 Mission）、timestamp（毫秒级时间戳）、eventType（事件类型枚举）、sourceAgent（来源 Agent ID）、targetAgent（目标 Agent ID，可选）、eventData（事件负载）、metadata（扩展元数据）
2. THE Event_Collector SHALL 支持以下事件类型：AGENT_STARTED、AGENT_STOPPED、MESSAGE_SENT、MESSAGE_RECEIVED、DECISION_MADE、CODE_EXECUTED、RESOURCE_ACCESSED、ERROR_OCCURRED、MILESTONE_REACHED
3. WHEN 采集通信事件时，THE Event_Collector SHALL 记录完整的上下文信息，包括 Agent 状态、消息内容、决策逻辑、代码片段、资源详情
4. THE Event_Collector SHALL 以异步方式采集事件，采集操作不阻塞 Mission 主业务流程
5. WHEN 采集事件时，THE Event_Collector SHALL 在 50 毫秒内完成单次事件入队操作，支持每秒 1000 条以上的事件吞吐量
6. IF 事件采集失败，THEN THE Event_Collector SHALL 将失败事件写入本地缓冲队列，并以指数退避策略定期重试上传

### 需求 2：记录 Agent 通信和消息交互

**用户故事：** 作为系统运维人员，我希望记录 Agent 之间的所有通信（消息发送、接收、转发），以便回放 Agent 的协作过程。

#### 验收标准

1. THE CommunicationEvent SHALL 包含以下字段：eventId、senderId、receiverId、messageId、messageContent、messageType、timestamp、status
2. THE Event_Collector SHALL 支持以下消息类型：INSTRUCTION、RESPONSE、QUERY、RESULT、ERROR、FEEDBACK
3. WHEN 记录消息内容时，THE Event_Collector SHALL 保存完整的文本或结构化数据（JSON 格式）
4. WHERE 消息包含敏感信息，THE Event_Collector SHALL 对敏感字段进行加密存储
5. THE CommunicationEvent SHALL 记录消息的处理状态，状态值包括 SENT、RECEIVED、PROCESSED、FAILED
6. WHEN 消息被转发时，THE Event_Collector SHALL 记录完整的消息转发链路（包含每一跳的 Agent ID 和时间戳）

### 需求 3：记录决策节点和决策过程

**用户故事：** 作为数据分析师，我希望记录每个决策节点的完整信息，以便回放决策过程并分析决策质量。

#### 验收标准

1. THE DecisionEvent SHALL 包含以下字段：eventId、decisionId、agentId、timestamp、decisionInput、decisionLogic、decisionResult、confidence、metadata
2. WHEN 记录决策输入时，THE Event_Collector SHALL 包含所有相关的数据和上下文信息
3. WHEN 记录决策逻辑时，THE Event_Collector SHALL 保存决策的推理过程（包括 LLM 的 prompt 和思考链）
4. THE DecisionEvent SHALL 包含最终决策结果和备选方案列表
5. THE DecisionEvent SHALL 包含置信度字段，取值范围为 0 到 1 的浮点数
6. WHEN 决策完成后，THE Replay_System SHALL 支持对决策进行后续验证标注（标记决策是否正确、是否存在更优选择）

### 需求 4：记录代码执行和代码变更

**用户故事：** 作为开发者，我希望记录 Agent 执行的代码及其输入输出，以便回放代码执行过程并调试问题。

#### 验收标准

1. THE CodeExecutionEvent SHALL 包含以下字段：eventId、agentId、timestamp、codeSnippet、codeLanguage、executionInput、executionOutput、executionStatus、executionTime
2. WHEN 记录代码片段时，THE Event_Collector SHALL 保存完整的代码文本和代码位置（文件路径、起始行号、结束行号）
3. WHEN 记录执行输入时，THE Event_Collector SHALL 包含所有参数和环境变量
4. THE CodeExecutionEvent SHALL 包含标准输出、标准错误和返回值
5. THE CodeExecutionEvent SHALL 记录执行状态，状态值包括 SUCCESS、FAILURE、TIMEOUT、EXCEPTION
6. WHEN 代码发生变更时，THE Event_Collector SHALL 记录代码的版本标识和变更原因

### 需求 5：记录资源访问和数据操作

**用户故事：** 作为安全审计员，我希望记录 Agent 对资源的访问，以便回放资源访问过程并审计数据安全。

#### 验收标准

1. THE ResourceAccessEvent SHALL 包含以下字段：eventId、agentId、timestamp、resourceType、resourceId、accessType、accessResult、metadata
2. THE Event_Collector SHALL 支持以下资源类型：FILE、DATABASE、API、NETWORK、MCP_TOOL
3. THE Event_Collector SHALL 支持以下访问类型：READ、WRITE、DELETE、EXECUTE、QUERY
4. THE ResourceAccessEvent SHALL 包含访问结果（成功或失败）、返回数据摘要和访问耗时
5. WHERE 访问结果包含敏感数据，THE Event_Collector SHALL 对敏感数据进行脱敏处理（隐藏密码、隐藏个人信息）
6. THE ResourceAccessEvent SHALL 记录资源访问的权限检查结果

### 需求 6：构建执行事件流和时间轴

**用户故事：** 作为系统运维人员，我希望将采集的事件组织成完整的执行事件流，支持多维度查询和过滤，以便高效回放和分析。

#### 验收标准

1. THE ExecutionTimeline SHALL 包含以下字段：missionId、events（事件数组）、startTime、endTime、totalDuration、eventCount
2. THE ExecutionTimeline SHALL 支持多维度索引：按时间范围、按 Agent ID、按事件类型、按资源 ID 进行查询
3. WHERE 存储空间受限，THE Replay_Store SHALL 支持事件流的压缩存储（仅存储关键事件，非关键事件可选存储）
4. WHEN 新事件产生时，THE ExecutionTimeline SHALL 支持增量追加，无需重新生成整个事件流
5. WHEN 执行事件流查询时，THE Replay_Store SHALL 在 100 毫秒内返回结果（支持百万级事件量）
6. THE Replay_System SHALL 支持事件流的导出，导出格式包括 JSON 和 CSV

### 需求 7：回放引擎和时间控制

**用户故事：** 作为教学讲师，我希望通过回放引擎按时间顺序回放事件，并使用播放控制功能灵活查看执行过程。

#### 验收标准

1. THE Replay_Engine SHALL 支持以下操作：play（播放）、pause（暂停）、resume（恢复）、stop（停止）、seek（跳转）、speedUp（加速）、slowDown（减速）
2. THE Replay_Engine SHALL 支持以下播放速度级别：0.5x、1x、2x、4x、8x
3. WHEN 回放时，THE Replay_Engine SHALL 支持按事件类型过滤回放内容
4. WHEN 回放时，THE Replay_Engine SHALL 支持按 Agent ID 过滤回放内容
5. WHEN 用户指定时间戳时，THE Replay_Engine SHALL 跳转到该时间戳对应的事件位置
6. WHILE 回放进行中，THE Replay_Engine SHALL 支持暂停并检查当前事件的详细信息

### 需求 8：3D 场景动画回放

**用户故事：** 作为学生，我希望在 3D 场景中以动画形式观看 Agent 的活动、通信和决策过程，以便获得直观的可视化回放体验。

#### 验收标准

1. WHEN 回放 Agent 活动事件时，THE Replay_Renderer SHALL 在 3D 场景中更新对应 Agent 区块的状态动画
2. WHEN 回放通信事件时，THE Replay_Renderer SHALL 在 3D 场景中通过连线和粒子动画展示 Agent 之间的消息传递
3. WHEN 回放决策事件时，THE Replay_Renderer SHALL 通过特殊视觉效果（光晕、脉冲动画）展示决策节点
4. WHEN 回放代码执行事件时，THE Replay_Renderer SHALL 通过 Agent 区块的动画效果展示代码执行状态
5. WHEN 回放资源访问事件时，THE Replay_Renderer SHALL 通过连线和图标展示资源访问过程
6. WHEN 回放错误或异常事件时，THE Replay_Renderer SHALL 通过红色高亮和警告图标展示异常状态
7. THE Replay_Renderer SHALL 支持 3D 场景的缩放、旋转和平移操作

### 需求 9：事件详情和上下文展示

**用户故事：** 作为数据分析师，我希望在回放过程中查看每个事件的详细信息和上下文，以便深入理解事件的含义和影响。

#### 验收标准

1. WHEN 用户选择某个事件时，THE Replay_System SHALL 在事件详情面板中展示该事件的完整信息
2. WHEN 展示通信事件详情时，THE Replay_System SHALL 显示消息内容、发送者名称、接收者名称、消息类型
3. WHEN 展示决策事件详情时，THE Replay_System SHALL 显示决策输入、决策逻辑、决策结果、置信度
4. WHEN 展示代码执行事件详情时，THE Replay_System SHALL 显示代码片段（语法高亮）、执行参数、执行结果、执行耗时
5. WHEN 展示资源访问事件详情时，THE Replay_System SHALL 显示资源类型、访问类型、访问结果、权限检查结果
6. WHEN 用户查看某个事件时，THE Replay_System SHALL 支持查询与该事件关联的上下游事件

### 需求 10：回放的数据血缘追踪

**用户故事：** 作为数据分析师，我希望在回放过程中追踪数据的来源和流向，以便理解数据在 Agent 之间的传递路径。

#### 验收标准

1. WHEN 用户启用数据血缘视图时，THE Data_Lineage_Tracker SHALL 在回放界面中以有向图形式展示数据血缘关系
2. WHEN 用户选择某个数据点时，THE Data_Lineage_Tracker SHALL 追溯该数据的完整血缘链路（从源头到当前位置）
3. WHEN 用户选择某个决策事件时，THE Data_Lineage_Tracker SHALL 展示该决策依赖的所有输入数据及其来源
4. THE Data_Lineage_Tracker SHALL 与 ExecutionTimeline 集成，血缘节点可关联到对应的时间轴事件
5. WHEN 数据在传递过程中发生变更时，THE Data_Lineage_Tracker SHALL 记录变更前后的差异

### 需求 11：回放的权限审计

**用户故事：** 作为安全审计员，我希望在回放过程中查看权限检查结果，以便审计权限的执行情况。

#### 验收标准

1. WHEN 回放包含权限检查的事件时，THE Replay_System SHALL 在事件详情中展示权限检查结果（通过或拒绝）
2. WHEN 权限检查失败时，THE Replay_System SHALL 在时间轴和 3D 场景中高亮该事件并显示告警标识
3. WHEN 用户查看权限检查事件时，THE Replay_System SHALL 展示权限检查的详细信息（请求的权限、实际权限、检查规则）
4. WHEN 权限配置发生变更时，THE Replay_System SHALL 记录权限变更事件并支持追踪
5. THE Replay_System SHALL 支持按权限违规事件进行统计，展示违规次数、违规类型分布和违规 Agent 分布

### 需求 12：回放的成本追踪

**用户故事：** 作为项目经理，我希望在回放过程中查看成本信息，以便了解任务的成本消耗过程。

#### 验收标准

1. WHILE 回放进行中，THE Replay_System SHALL 在界面中展示截至当前回放时间点的累计成本
2. THE Replay_System SHALL 支持按 Agent、按 LLM 模型、按操作类型维度展示成本分布
3. WHEN 单次操作成本超过预设阈值时，THE Replay_System SHALL 在时间轴上高亮该成本异常事件
4. WHEN 累计成本达到预算告警线时，THE Replay_System SHALL 在回放界面中展示预算告警事件
5. THE Replay_System SHALL 在回放结束后展示成本优化建议（基于成本分布分析）

### 需求 13：回放的性能分析

**用户故事：** 作为开发者，我希望在回放过程中分析任务的性能指标，以便优化任务的执行效率。

#### 验收标准

1. WHILE 回放进行中，THE Replay_System SHALL 展示关键性能指标（总耗时、各阶段耗时、LLM 调用次数、LLM 平均响应时间）
2. WHEN 某个阶段耗时超过该阶段平均耗时的 2 倍时，THE Replay_System SHALL 标记该阶段为性能瓶颈
3. THE Replay_System SHALL 追踪资源使用情况（LLM token 消耗、API 调用次数、文件 I/O 次数）
4. THE Replay_System SHALL 分析 Agent 的并发执行度（同时活跃的 Agent 数量随时间的变化）
5. WHEN 用户选择两个 Mission 回放时，THE Replay_System SHALL 支持性能指标的并排对比

### 需求 14：回放的快照和书签

**用户故事：** 作为教学讲师，我希望在回放过程中保存快照和书签，以便快速回到关键时刻进行分析。

#### 验收标准

1. WHEN 用户在回放过程中点击"创建快照"时，THE Replay_System SHALL 保存当前回放时间点的完整状态（包括事件游标位置、过滤条件、3D 场景视角）
2. WHEN 用户创建快照时，THE Replay_System SHALL 支持为快照添加自定义标签和文字注释
3. WHEN 用户点击已保存的快照时，THE Replay_Engine SHALL 跳转到该快照对应的时间点并恢复完整状态
4. THE Replay_System SHALL 支持快照的导出（JSON 格式）和从导出文件导入
5. THE Replay_System SHALL 为每个快照记录版本号，支持同一时间点的多个快照版本

### 需求 15：回放的导出和报告

**用户故事：** 作为项目经理，我希望导出回放数据和生成回放报告，以便用于文档、演示和审计。

#### 验收标准

1. THE Replay_System SHALL 支持以下导出格式：交互式 HTML、JSON 数据
2. THE Replay_System SHALL 支持生成回放报告，报告内容包括 Mission 概要、关键事件摘要、性能指标、成本统计、异常事件列表
3. WHEN 用户生成报告时，THE Replay_System SHALL 支持自定义报告内容（选择包含的章节和指标）
4. THE Replay_System SHALL 支持报告的导出格式：HTML 和 Markdown
5. WHEN 导出交互式 HTML 时，THE Replay_System SHALL 在 HTML 中嵌入事件数据和基础回放控制功能

### 需求 16：回放的对比分析

**用户故事：** 作为数据分析师，我希望对比多个 Mission 的回放，以便分析不同执行方式的差异。

#### 验收标准

1. THE Replay_System SHALL 支持同时加载并回放两个 Mission 的事件流
2. WHEN 对比回放时，THE Replay_System SHALL 以并排视图展示两个 Mission 的事件流差异
3. WHEN 对比回放时，THE Replay_System SHALL 展示两个 Mission 的性能指标对比（耗时、成本、LLM 调用次数）
4. WHEN 事件流存在差异时，THE Replay_System SHALL 高亮展示差异事件（仅在一个 Mission 中出现的事件类型或阶段）
5. THE Replay_System SHALL 支持对比结果的导出（JSON 和 Markdown 格式）

### 需求 17：回放的教学和演示模式

**用户故事：** 作为教学讲师，我希望使用回放系统进行教学和演示，以便向学生展示 Agent 协作的过程。

#### 验收标准

1. WHEN 用户启用演示模式时，THE Replay_System SHALL 隐藏技术细节面板，放大 3D 场景，并显示简化的事件说明
2. WHILE 演示模式启用时，THE Replay_System SHALL 支持在 3D 场景和时间轴上添加文字注释和箭头标注
3. WHILE 回放进行中，THE Replay_System SHALL 支持暂停回放并在界面上显示提问标记，供讲师与学生互动
4. WHEN 用户启用交互式回放时，THE Replay_System SHALL 在每个决策节点自动暂停，等待用户确认后继续
5. THE Replay_System SHALL 支持将当前回放会话（包括注释和书签）录制为可分享的回放文件

### 需求 18：回放的前端界面

**用户故事：** 作为用户，我希望在前端看到直观的回放界面，包括时间轴、3D 场景、事件详情和控制按钮。

#### 验收标准

1. THE Replay_System SHALL 提供包含以下主要区域的回放界面：3D 场景（中心区域）、时间轴（底部区域）、事件详情面板（右侧区域）、控制面板（顶部区域）
2. WHEN 用户点击时间轴上的某个位置时，THE Replay_Engine SHALL 跳转到该时间点对应的事件
3. THE 控制面板 SHALL 包含播放、暂停、快进、快退、跳转和速度调整按钮
4. WHEN 回放到某个事件时，THE 事件详情面板 SHALL 展示当前事件的完整信息
5. THE Replay_System SHALL 支持全屏模式（隐藏其他面板，3D 场景占满屏幕）
6. THE Replay_System SHALL 在控制面板中提供搜索和过滤功能，支持按事件类型、Agent、关键词过滤

### 需求 19：回放数据的存储和管理

**用户故事：** 作为系统运维人员，我希望高效地存储和管理回放数据，支持快速查询和检索。

#### 验收标准

1. THE Replay_Store SHALL 采用分层存储策略：热数据（最近 7 天）存储在 IndexedDB，冷数据存储在服务端 JSON 文件
2. THE Replay_Store SHALL 支持事件数据的压缩存储，压缩后体积不超过原始数据的 50%
3. THE Replay_Store SHALL 支持增量存储，仅追加新事件而不重写已有数据
4. THE Replay_Store SHALL 为每个 Mission 的回放数据记录版本号，支持版本回溯
5. THE Replay_Store SHALL 支持数据清理策略：自动清理超过 30 天的冷数据，保留元数据摘要

### 需求 20：回放与审计链的集成

**用户故事：** 作为安全审计员，我希望将回放操作记录到审计链，以便追踪回放过程本身的审计信息。

#### 验收标准

1. WHEN 用户执行回放操作（播放、暂停、跳转、导出）时，THE Replay_System SHALL 将该操作记录到审计日志
2. THE Replay_System SHALL 支持查询审计日志：谁在什么时间查看了哪个 Mission 的回放
3. WHEN 加载回放数据时，THE Replay_Store SHALL 验证数据的完整性（通过校验和比对）
4. THE Replay_System SHALL 支持基于角色的回放访问控制（管理员可查看所有回放，普通用户仅可查看自己创建的 Mission 回放）
