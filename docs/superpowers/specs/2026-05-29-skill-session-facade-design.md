# Skill Session Facade Design

## Goal

在 Solo Trae 沙盒内，为现有一体化系统增加一个面向 Skill 的会话式门面层，使 Skill 不再只调用单次 HTTP 接口，而是能够以“会话 + 状态流 + 决策响应”的方式消费系统能力。

第一阶段优先目标不是完整搬运 3D 运行台或全部 runtime event，而是优先将“伴随式 Agent Crew”的状态抽象成 Skill 可消费的 Agent 状态流。

## Why This Design Exists

当前系统并不是一个“输入 -> 固定结果返回”的单步生成器，而是一个全流程伴随式系统。

用户主干流程包括：

- 输入 / GitHub
- 动态澄清
- RouteSet
- SPEC Tree
- 规格文档
- 效果预演
- 实现提示词
- 工程落地 / Mission

与此同时，系统内部还长期伴随以下三层能力：

- 伴随式 Agent Crew
- 角色能力网络与沙盒推导
- 3D 运行台与观察面板

因此，Skill 与后端的关系不应该建模为“单个接口 + 最终结果”，而应该建模为“会话式门面 + 可轮询快照 + 可消费状态流 + 用户决策回传”。

## Scope

本设计仅覆盖以下内容：

- 为现有系统设计一个 Skill 专用的 session facade
- 优先暴露 Agent 状态流
- 支持 Skill 发起会话、提交决策、拉取快照、获取状态事件
- 支持在澄清与路线选择阶段回传用户答案
- 支持最终返回完整产物包

本设计不包含以下内容：

- 不直接在 Skill 中渲染 3D 面板
- 不直接暴露全部底层 runtime event
- 不在第一阶段开放所有 capability / sandbox 推导明细
- 不做公网访问或跨环境部署设计
- 不改造前端 3D UI

## Design Principles

### 1. Skill Is a Session Console, Not a Full Web App

Skill 侧应被视为“会话控制台”：

- 展示当前阶段
- 展示角色状态
- 展示等待用户决策的组件
- 展示关键摘要
- 最后展示完整产物包

Skill 不应该承担：

- 完整运行时编排
- 直接理解全部能力网络
- 直接消费原始低层 runtime events

### 2. Session First, Result Later

对于该系统，最终结果只是会话的一部分。

第一版 Skill 门面必须先支持：

- 启动会话
- 跟进会话
- 响应决策
- 查看当前状态

而不是只关注最后的产出物。

### 3. Agent Stream First

在三类伴随能力中，第一阶段优先面向 Skill 暴露：

- Agent Crew 状态

原因：

- 它最接近用户能理解的流程反馈
- 它最适合转译成文本状态卡片
- 它天然适合作为 Skill 的中间过程可视化

能力网络 / 沙盒推导、3D 观察面板则先转成摘要，不在第一阶段原样暴露。

## Proposed API Surface

第一阶段建议定义以下 4 个接口。

### 1. Start Session

`POST /api/skill/session/start`

作用：

- 创建一个新的 Skill 会话
- 接收初始用户输入
- 触发全流程运行
- 返回 `sessionId` 与当前快照

请求：

```json
{
  "input": "我想做一个 AI 剧本共创平台"
}
```

响应示例：

```json
{
  "ok": true,
  "sessionId": "skill_sess_001",
  "status": "running",
  "snapshot": {
    "stage": "clarification",
    "summary": "澄清师正在分析需求并生成问题",
    "waitingForUser": false,
    "agents": [
      {
        "id": "clarifier",
        "name": "澄清师",
        "role": "clarifier",
        "status": "working",
        "summary": "正在生成澄清问题"
      }
    ]
  },
  "decision": null,
  "result": null,
  "error": null
}
```

### 2. Respond to Decision

`POST /api/skill/session/respond`

作用：

- 向会话提交一次用户答案
- 用于澄清与路线选择等互动节点

请求：

```json
{
  "sessionId": "skill_sess_001",
  "stepId": "clarify-target-user",
  "answer": {
    "selected": "consumer"
  }
}
```

响应：

- 可能返回新的 `decision`
- 可能返回 `running` 状态
- 也可能直接进入 `completed`

### 3. Get Session Snapshot

`GET /api/skill/session/:id/snapshot`

作用：

- 获取当前会话快照
- 用于 Skill 刷新当前阶段、角色状态、等待状态和阶段摘要

响应示例：

```json
{
  "ok": true,
  "sessionId": "skill_sess_001",
  "status": "running",
  "snapshot": {
    "stage": "route_selection",
    "summary": "规划师已生成候选路线，等待用户选择",
    "waitingForUser": true,
    "agents": [
      {
        "id": "planner",
        "name": "规划师",
        "role": "planner",
        "status": "blocked",
        "summary": "等待用户确认路线"
      },
      {
        "id": "researcher",
        "name": "研究员",
        "role": "researcher",
        "status": "completed",
        "summary": "已完成背景上下文收集"
      }
    ]
  },
  "decision": {
    "stepId": "route-selection",
    "type": "single_select",
    "title": "请选择推进路线",
    "description": "不同路线会影响输出粒度和优先级。",
    "required": true,
    "options": [
      {
        "id": "fast-validation",
        "label": "快速验证路线",
        "description": "优先得到可快速判断方向的产物"
      },
      {
        "id": "full-spec",
        "label": "完整规格路线",
        "description": "优先得到完整规格和结构"
      }
    ]
  },
  "result": null,
  "error": null
}
```

### 4. Get Agent Stream

`GET /api/skill/session/:id/agent-stream`

作用：

- 返回面向 Skill 的 Agent 状态流
- 这是一个高层事件流，不是底层 runtime event 直通

第一阶段可以先做轮询式事件列表，而不是立即实现真正 SSE / WebSocket。

响应示例：

```json
{
  "ok": true,
  "sessionId": "skill_sess_001",
  "cursor": 18,
  "events": [
    {
      "sequence": 16,
      "type": "agent_status",
      "timestamp": "2026-05-29T16:45:00.000Z",
      "stage": "route_selection",
      "agent": {
        "id": "planner",
        "name": "规划师",
        "role": "planner",
        "status": "working"
      },
      "summary": "正在生成候选路线",
      "waitingForUser": false
    },
    {
      "sequence": 17,
      "type": "agent_status",
      "timestamp": "2026-05-29T16:45:08.000Z",
      "stage": "route_selection",
      "agent": {
        "id": "researcher",
        "name": "研究员",
        "role": "researcher",
        "status": "completed"
      },
      "summary": "已补全市场上下文",
      "waitingForUser": false
    },
    {
      "sequence": 18,
      "type": "decision_required",
      "timestamp": "2026-05-29T16:45:18.000Z",
      "stage": "route_selection",
      "agent": {
        "id": "planner",
        "name": "规划师",
        "role": "planner",
        "status": "blocked"
      },
      "summary": "需要用户确认路线",
      "waitingForUser": true
    }
  ],
  "error": null
}
```

## Unified Envelope

所有 Skill 门面接口建议使用统一响应外壳：

```json
{
  "ok": true,
  "sessionId": "skill_sess_001",
  "status": "running",
  "snapshot": null,
  "decision": null,
  "result": null,
  "error": null
}
```

字段说明：

- `ok`: 请求是否成功
- `sessionId`: 当前 Skill 会话 ID
- `status`: 会话状态
- `snapshot`: 当前高层快照
- `decision`: 当前是否需要用户决策
- `result`: 完成时的完整产物包
- `error`: 失败时的结构化错误对象

## Session Status Model

第一阶段建议固定以下状态：

- `running`
- `waiting_for_user`
- `completed`
- `failed`

状态语义：

- `running`: 系统正在推进流程
- `waiting_for_user`: 当前停在用户决策点
- `completed`: 流程已完成
- `failed`: 流程执行失败

## Decision Schema

决策组件第一阶段继续只支持三种：

- `single_select`
- `multi_select`
- `text_input`

推荐结构：

```json
{
  "stepId": "clarify-target-user",
  "type": "single_select",
  "title": "你更想优先验证哪类用户？",
  "description": "这会影响后续路线和规格结构。",
  "required": true,
  "options": [
    { "id": "consumer", "label": "C 端用户", "description": "面向普通用户" },
    { "id": "business", "label": "B 端团队", "description": "面向企业团队" }
  ]
}
```

这样 Skill 可直接映射为结构化问答组件。

## Snapshot Schema

Skill 优先消费的不是全部事件，而是一个高层快照：

```json
{
  "stage": "spec_tree",
  "summary": "架构师与规划师正在构建 SPEC Tree",
  "waitingForUser": false,
  "agents": [
    {
      "id": "architect",
      "name": "架构师",
      "role": "architect",
      "status": "working",
      "summary": "正在拆分模块边界"
    },
    {
      "id": "planner",
      "name": "规划师",
      "role": "planner",
      "status": "working",
      "summary": "正在对齐节点结构"
    }
  ]
}
```

这个快照是 Skill 展示层的核心数据源。

## Result Schema

完成时返回完整产物包：

```json
{
  "input": "我想做一个 AI 剧本共创平台",
  "clarifications": [],
  "selectedRoute": {
    "id": "full-spec",
    "label": "完整规格路线"
  },
  "specTree": {
    "title": "AI 剧本共创平台",
    "nodes": []
  },
  "specDocument": {
    "title": "AI 剧本共创平台规格草案",
    "markdown": "# 规格文档\n\n..."
  },
  "imagePrompts": [
    {
      "id": "landing-hero",
      "label": "首页主视觉",
      "prompt": "cinematic AI screenplay collaboration dashboard, ...",
      "imageSize": "landscape_16_9"
    }
  ]
}
```

## Mapping from Existing System

本次设计不是新造一套编排系统，而是给现有系统做一层门面映射。

映射关系如下：

- 现有主干流程阶段
  - 映射到 `snapshot.stage`
- 现有角色 / Agent 状态
  - 映射到 `snapshot.agents` 和 `agent-stream`
- 现有澄清与路线选择节点
  - 映射到 `decision`
- 现有产物结果
  - 映射到 `result`
- 现有能力网络与沙盒推导
  - 第一阶段只映射关键摘要，不原样暴露
- 现有 3D 面板与观察层
  - 第一阶段只映射文本摘要，不直接渲染

## Error Handling

推荐统一错误结构：

```json
{
  "code": "SESSION_NOT_FOUND",
  "message": "session does not exist or has expired"
}
```

第一阶段关注的错误：

- `INVALID_INPUT`
- `INVALID_ANSWER`
- `SESSION_NOT_FOUND`
- `SESSION_EXPIRED`
- `RUNTIME_FAILURE`

HTTP 状态建议：

- `400` 请求参数错误
- `404` 会话不存在
- `409` 状态冲突，例如在非等待状态提交答案
- `500` 服务端失败

## Testing Strategy

第一阶段测试分为三层。

### 1. Session Facade Route Tests

验证：

- `start` 能创建会话
- `snapshot` 能返回当前阶段
- `respond` 能处理决策答案
- `agent-stream` 能返回结构化事件列表

### 2. Session State Mapping Tests

验证：

- 现有运行时状态能被正确压缩成 Skill 快照
- 现有角色状态能被正确压缩成 Agent 状态流
- 用户决策点能被映射成 Skill 决策组件

### 3. Sandbox Live Verification

在 Solo Trae 沙盒内验证：

- 创建一个 Skill 会话
- 拉取快照
- 获取 Agent 状态流
- 在决策点提交答案
- 最终获得完整产物包

## Acceptance Criteria

满足以下条件即视为第一阶段完成：

- Skill 可以启动一个新会话
- Skill 可以获取当前会话快照
- Skill 可以看到 Agent 状态流
- Skill 可以在澄清 / 路线选择阶段提交答案
- Skill 可以在完成时得到完整产物包
- Skill 无需理解底层 runtime event 即可工作

## Non-Goals

以下不是第一阶段目标：

- 直接在 Skill 中复刻 3D 运行台
- 将所有能力网络细节暴露给 Skill
- 让 Skill 原样消费底层事件总线
- 重构当前主干运行时
- 在第一阶段解决所有跨环境部署问题
