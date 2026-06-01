# A2A 协议 需求文档

## 简介

Agent-to-Agent (A2A) 标准化协议为 WhyBuddy 提供跨框架 Agent 互操作能力。Cube 内部 Agent 可通过统一协议无缝调用外部框架的 Agent（CrewAI、LangGraph、Claude 等），同时外部 Agent 也能通过标准端点反向调用 Cube Agent。协议基于 JSON-RPC over WebSocket/HTTP 设计，与现有 MessageBus、动态组织和 Mission 系统无缝集成，调用过程在 3D 场景中以"跨框架消息粒子流"形式可视化展示。

## 术语表

- **A2A_Protocol**: Agent-to-Agent 协议，定义 Cube Agent 与外部框架 Agent 之间的通信规范，基于 JSON-RPC 2.0 格式
- **A2A_Client**: 服务端模块，负责从 Cube 内部发起对外部 Agent 的调用请求
- **A2A_Server**: 服务端模块，暴露 HTTP/WebSocket 端点，接收外部 Agent 对 Cube Agent 的调用请求
- **ExternalAgentNode**: 组织快照中表示外部框架 Agent 的节点类型，继承自 GuestAgentNode，新增框架类型和 A2A 端点信息
- **A2A_Envelope**: 协议消息信封，包含 JSON-RPC 请求/响应、上下文传递、认证令牌和流式控制字段
- **A2A_Session**: 一次完整的跨框架调用会话，从请求发起到结果返回的全生命周期
- **FrameworkAdapter**: 框架适配器，将 A2A 协议消息转换为特定外部框架（CrewAI / LangGraph / Claude）的调用格式
- **MessageBus**: 现有 Agent 间消息总线，需扩展支持 A2A 路由
- **GuestAgentNode**: agent-marketplace 中定义的访客代理节点类型，A2A 外部 Agent 基于此扩展
- **Cross_Framework_Particles**: 3D 场景中表示跨框架 A2A 调用的粒子流可视化效果，使用与跨 Pod 粒子流不同的视觉风格

## 需求

### 需求 1：A2A 协议定义

**用户故事：** 作为开发者，我希望有一套轻量级的 A2A 协议类型定义，以便 Cube Agent 和外部框架 Agent 之间能基于统一的数据结构进行通信。

#### 验收标准

1. THE A2A_Protocol SHALL 定义 `A2AEnvelope` 类型，包含 jsonrpc 版本（固定 "2.0"）、method（"a2a.invoke" | "a2a.stream" | "a2a.cancel"）、id（请求标识）、params（调用参数）和 auth（认证令牌）字段
2. THE A2A_Protocol SHALL 定义 `A2AInvokeParams` 类型，包含 targetAgent（目标 Agent 标识）、task（任务描述）、context（上下文摘要，最大 2000 字符）、capabilities（所需能力列表）和 streamMode（布尔值，是否启用流式响应）字段
3. THE A2A_Protocol SHALL 定义 `A2AResponse` 类型，包含 jsonrpc 版本、id（对应请求标识）、result（成功结果，包含 output 文本、artifacts 产物列表和 metadata 元数据）和 error（错误信息，包含 code 数字错误码和 message 描述）字段
4. THE A2A_Protocol SHALL 定义 `A2AStreamChunk` 类型，包含 jsonrpc 版本、id、chunk（部分输出文本）和 done（布尔值，标识流是否结束）字段
5. THE A2A_Protocol SHALL 定义 `A2ASession` 类型，包含 sessionId、requestEnvelope、status（"pending" | "running" | "completed" | "failed" | "cancelled"）、startedAt、completedAt、response 和 streamChunks 字段
6. WHEN 序列化 `A2AEnvelope` 为 JSON 再反序列化, THE A2A_Protocol SHALL 产生与原始对象等价的结果

### 需求 2：Cube 调用外部 Agent（A2A Client）

**用户故事：** 作为 Cube 用户，我希望在工作流或 Mission 中通过 `@external-agent-name` 语法调用外部框架的 Agent，以便利用外部 Agent 的专业能力完成子任务。

#### 验收标准

1. WHEN A2A_Client 接收一个 A2AInvokeParams, THE A2A_Client SHALL 根据 targetAgent 查找已注册的外部 Agent 端点，构建 A2AEnvelope 并通过 HTTP POST 发送到目标端点
2. WHEN A2A_Client 发送请求且 streamMode 为 false, THE A2A_Client SHALL 等待完整的 A2AResponse 返回，超时时间为可配置值（默认 60 秒）
3. WHEN A2A_Client 发送请求且 streamMode 为 true, THE A2A_Client SHALL 通过 SSE 或 WebSocket 接收 A2AStreamChunk 序列，逐块转发给调用方
4. WHEN A2A_Client 收到成功的 A2AResponse, THE A2A_Client SHALL 将 result.output 注入当前工作流上下文，使后续阶段可引用该输出
5. IF A2A_Client 请求超时或收到错误响应, THEN THE A2A_Client SHALL 记录错误日志，将 A2ASession 标记为 failed，并通知调用方 Agent 的上级 Manager
6. THE A2A_Client SHALL 支持同时维护最多 10 个并发 A2A 调用会话

### 需求 3：外部 Agent 调用 Cube Agent（A2A Server）

**用户故事：** 作为外部框架开发者，我希望通过标准 HTTP 端点调用 Cube 内部的 Agent，以便在外部工作流中利用 Cube Agent 的能力。

#### 验收标准

1. WHEN A2A_Server 收到 `POST /api/a2a/invoke` 请求, THE A2A_Server SHALL 验证 auth 令牌有效性，解析 A2AEnvelope，将任务路由到目标 Cube Agent 执行
2. WHEN A2A_Server 收到合法请求且 streamMode 为 false, THE A2A_Server SHALL 等待 Cube Agent 执行完成后返回完整的 A2AResponse
3. WHEN A2A_Server 收到合法请求且 streamMode 为 true, THE A2A_Server SHALL 通过 SSE 逐块返回 A2AStreamChunk，最后发送 done=true 的终止块
4. WHEN A2A_Server 收到 `POST /api/a2a/cancel` 请求, THE A2A_Server SHALL 尝试取消指定 sessionId 的正在执行的调用
5. WHEN A2A_Server 收到 `GET /api/a2a/agents` 请求, THE A2A_Server SHALL 返回当前可被外部调用的 Cube Agent 列表（包含 id、name、capabilities 和 description）
6. IF auth 令牌无效或缺失, THEN THE A2A_Server SHALL 返回 HTTP 401 错误，body 包含 JSON-RPC 格式的错误信息
7. IF 目标 Agent 不存在或不可用, THEN THE A2A_Server SHALL 返回 HTTP 404 错误，body 包含 JSON-RPC 格式的错误信息

### 需求 4：框架适配器（CrewAI / LangGraph / Claude）

**用户故事：** 作为开发者，我希望 A2A Client 能自动适配不同外部框架的调用格式，以便无需手动处理各框架的协议差异。

#### 验收标准

1. WHEN A2A_Client 调用 CrewAI 框架的 Agent, THE FrameworkAdapter SHALL 将 A2AInvokeParams 转换为 CrewAI 的 task execution 格式（包含 agent role、task description 和 expected output）
2. WHEN A2A_Client 调用 LangGraph 框架的 Agent, THE FrameworkAdapter SHALL 将 A2AInvokeParams 转换为 LangGraph 的 graph invoke 格式（包含 input state 和 config）
3. WHEN A2A_Client 调用 Claude 框架的 Agent, THE FrameworkAdapter SHALL 将 A2AInvokeParams 转换为 Claude Messages API 格式（包含 system prompt、messages 和 tools）
4. WHEN FrameworkAdapter 收到外部框架的响应, THE FrameworkAdapter SHALL 将其统一转换为 A2AResponse 格式
5. IF FrameworkAdapter 遇到不支持的框架类型, THEN THE FrameworkAdapter SHALL 返回错误，包含支持的框架列表（"crewai" | "langgraph" | "claude"）

### 需求 5：认证与安全

**用户故事：** 作为系统管理员，我希望 A2A 调用有基本的认证机制，以防止未授权的外部访问。

#### 验收标准

1. THE A2A_Server SHALL 支持 API Key 认证方式，通过 `Authorization: Bearer <token>` 请求头传递
2. THE A2A_Server SHALL 从环境变量 `A2A_API_KEYS` 读取允许的 API Key 列表（逗号分隔）
3. WHEN A2A_Client 向外部 Agent 发送请求, THE A2A_Client SHALL 在 A2AEnvelope 的 auth 字段中包含配置的认证令牌
4. THE A2A_Server SHALL 对每个 API Key 实施速率限制，默认每分钟最多 60 次调用
5. IF 某个 API Key 超过速率限制, THEN THE A2A_Server SHALL 返回 HTTP 429 错误，body 包含 retryAfter 秒数

### 需求 6：ExternalAgentNode 与动态组织集成

**用户故事：** 作为开发者，我希望外部 Agent 能作为 ExternalAgentNode 纳入动态组织结构，以便在工作流中像内部 Agent 一样被分配任务。

#### 验收标准

1. THE shared/organization-schema.ts SHALL 定义 ExternalAgentNode 接口，继承 GuestAgentNode，新增 frameworkType（"crewai" | "langgraph" | "claude" | "custom"）、a2aEndpoint（string，外部 Agent 的 A2A 端点 URL）和 a2aAuth（string，可选认证令牌）字段
2. WHEN 动态组织生成器识别到用户指令中包含外部 Agent 引用（如 "@external-claude-researcher"）, THE Dynamic_Organization_Generator SHALL 在组织快照中创建对应的 ExternalAgentNode
3. THE ExternalAgentNode SHALL 与现有 WorkflowOrganizationSnapshot 结构兼容，使 3D 场景渲染和 MessageBus 路由无需特殊处理
4. WHEN ExternalAgentNode 被分配工作流任务, THE Workflow_Engine SHALL 通过 A2A_Client 将任务转发到外部 Agent 端点，而非本地 LLM 调用

### 需求 7：MessageBus A2A 路由扩展

**用户故事：** 作为开发者，我希望 MessageBus 能识别并路由 A2A 消息，以便跨框架调用与现有消息流无缝集成。

#### 验收标准

1. WHEN 一个内部 Agent 向 ExternalAgentNode 发送消息, THE MessageBus SHALL 识别目标为外部 Agent，将消息转发给 A2A_Client 处理
2. WHEN A2A_Server 收到外部 Agent 的响应, THE MessageBus SHALL 将响应消息路由回发起调用的内部 Agent
3. WHEN A2A 消息通过 MessageBus 路由, THE MessageBus SHALL 在消息元数据中标记 `a2a: true`、`frameworkType` 和 `sessionId`
4. THE MessageBus SHALL 通过 Socket.IO 发射 `a2a_message` 事件，包含源 Agent、目标 Agent、框架类型和消息摘要

### 需求 8：3D 场景跨框架可视化

**用户故事：** 作为用户，我希望在 3D 办公室场景中看到跨框架 A2A 调用的粒子流动画，以便直观理解 Agent 与外部框架的交互过程。

#### 验收标准

1. WHEN A2A 调用发起时, THE Scene3D SHALL 在发起 Agent 和外部 Agent 节点之间渲染跨框架粒子流动画，使用与跨 Pod 粒子流不同的视觉风格（菱形粒子 + 渐变色轨迹）
2. WHEN A2A_Session 处于 running 状态, THE Scene3D SHALL 在外部 Agent 节点上显示框架类型标签（如 "CrewAI"、"LangGraph"、"Claude"）
3. WHEN A2A_Session 完成或失败, THE Scene3D SHALL 淡出粒子流动画，成功时显示绿色脉冲，失败时显示红色脉冲
4. WHEN 收到 `a2a_message` Socket.IO 事件, THE Scene3D SHALL 在 200ms 内开始渲染对应的粒子流动画
5. THE Scene3D SHALL 使用不同颜色区分不同框架类型的 A2A 调用（CrewAI 蓝色、LangGraph 紫色、Claude 橙色）

### 需求 9：A2A 会话管理与上下文传递

**用户故事：** 作为开发者，我希望 A2A 调用的上下文能正确传递和管理，以便外部 Agent 获得足够的任务背景信息，调用结果能正确回流到工作流。

#### 验收标准

1. WHEN A2A_Client 构建调用请求, THE A2A_Client SHALL 从当前工作流上下文中提取相关摘要（最大 2000 字符），包含任务描述、当前阶段和已有产出
2. WHEN A2A_Session 完成, THE A2A_Client SHALL 将外部 Agent 的输出和产物追加到当前 Mission 的事件列表中
3. THE A2A_Client SHALL 维护所有活跃 A2ASession 的状态，支持通过 `GET /api/a2a/sessions` 查询
4. WHEN A2A_Session 超时（超过配置的超时时间）, THE A2A_Client SHALL 自动取消该会话并标记为 failed
5. FOR ALL 合法的 A2ASession 对象，序列化为 JSON 再反序列化 SHALL 产生与原始对象等价的结果（往返一致性）
