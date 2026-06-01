# 纯前端运行时 设计文档

## 概述

纯前端运行时通过实现 WorkflowRuntime 抽象接口的浏览器版本，使工作流引擎可以完全在浏览器中运行。核心实现在 `client/src/runtime/browser-runtime.ts` 和 `client/src/lib/browser-runtime-storage.ts`。

## 运行时组件映射

| WorkflowRuntime 接口 | 服务端实现 | 浏览器实现 |
|---------------------|-----------|-----------|
| WorkflowRepository | server/db/index.ts | BrowserWorkflowRepository (内存) |
| MemoryRepository | server/memory/session-store.ts | BrowserMemoryRepository (内存+IndexedDB) |
| ReportRepository | server/memory/report-store.ts | BrowserReportRepository (内存) |
| RuntimeEventEmitter | server/core/socket.ts | BrowserEventEmitter (回调函数) |
| RuntimeMessageBus | server/core/message-bus.ts | BrowserMessageBus (内存+层级校验) |
| AgentDirectory | server/core/registry.ts | BrowserAgentDirectory (内存) |
| LLMProvider | server/core/llm-client.ts | browser-llm.ts (fetch 直连) |

## 创建流程

```typescript
function createBrowserRuntime(options: BrowserRuntimeOptions) {
  // 1. 创建 BrowserWorkflowRepository（内存中管理 agents/workflows/tasks/messages）
  // 2. 创建 BrowserMemoryRepository（人设缓存 + 简化的上下文构建）
  // 3. 创建 BrowserReportRepository（内存中生成报告）
  // 4. 创建 BrowserEventEmitter（通过 onEvent 回调通知 UI）
  // 5. 创建 BrowserMessageBus（复用 message-bus-rules 层级校验）
  // 6. 创建 BrowserAgentDirectory（内存中管理智能体句柄）
  // 7. 组装为 WorkflowRuntime
}

function createBrowserWorkflowEngine(options) {
  // 创建 runtime + 实例化 WorkflowEngine
  // 返回 { engine, runtime, repository }
}
```

## IndexedDB 存储层 (`client/src/lib/browser-runtime-storage.ts`)

### 数据库结构
- 数据库名：`whybuddy-runtime`
- 版本升级通过 `onupgradeneeded` 自动创建 object store

| Store 名称 | Key | 用途 |
|-----------|-----|------|
| meta | "runtime-meta" | 运行时元数据（版本、同步时间） |
| aiConfig | "current" | AI 配置快照 |
| agents | agent.id | 智能体列表 |
| souls | agentId | SOUL.md 人设快照 |
| heartbeats | agentId | HEARTBEAT.md 快照 |
| workflows | workflow.id | 工作流历史 |
| workflowDetails | workflowId | 工作流详情（含任务和消息） |
| recentMemory | agentId:workflowId | 最近记忆快照 |
| memorySearch | agentId:query | 记忆搜索缓存 |
| heartbeatStatuses | agentId | 心跳状态 |
| heartbeatReports | agentId:reportId | 心跳报告 |

### 导入导出 Bundle
```typescript
interface BrowserRuntimeExportBundle {
  version: 1;
  exportedAt: string;
  meta: BrowserRuntimeMetadata | null;
  aiConfig: Record<string, unknown> | null;
  agents: any[];
  souls: BrowserSoulSnapshot[];
  heartbeats: BrowserHeartbeatSnapshot[];
  workflows: any[];
  workflowDetails: BrowserWorkflowDetailSnapshot[];
  heartbeatStatuses: any[];
  heartbeatReports: BrowserHeartbeatReportSnapshot[];
}
```

## BrowserMessageBus 层级校验

复用 `shared/message-bus-rules.ts` 的校验逻辑：
- CEO ↔ Manager：允许
- Manager ↔ Worker（同部门）：允许
- CEO → Worker / Worker → CEO：拒绝
- 跨部门 Worker → Worker：拒绝

## 模式切换

```
deploy-target.ts
  ├── isGitHubPages() → 强制 Frontend Mode
  ├── isStaticPreview() → 强制 Frontend Mode
  └── 用户手动切换 → Zustand store 持久化

Frontend Mode:
  → createBrowserWorkflowEngine()
  → UI 直接调用 engine.startWorkflow()
  → BrowserEventEmitter 回调更新 Zustand

Advanced Mode:
  → fetch /api/workflows + Socket.IO
  → 服务端 WorkflowEngine 执行
  → Socket 事件更新 Zustand
```

## browser-llm.ts

浏览器端 LLM 直连实现：
- 使用 `fetch()` 直接调用 OpenAI 兼容的 `/chat/completions` 端点
- API Key 保存在 IndexedDB 的 aiConfig store 中
- 支持流式和非流式两种模式
- 不支持浏览器直连时可配置代理 URL（`LLM_PROXY_URL`）

## browser-runtime-sync.ts

浏览器运行时与服务端的数据同步：
- Advanced Mode 切换到 Frontend Mode 时，从服务端拉取最新数据写入 IndexedDB
- Frontend Mode 切换到 Advanced Mode 时，不主动推送（服务端为权威数据源）
