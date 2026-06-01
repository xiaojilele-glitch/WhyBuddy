# 纯前端运行时 需求文档

## 概述

纯前端运行时模块将工作流引擎从服务端抽离，使其可以完全在浏览器中运行。用户无需启动服务端、无需配置 `.env`，打开页面即可体验完整的 3D 场景和工作流交互。浏览器端使用 IndexedDB 持久化、Web Worker 事件总线，复用与服务端相同的 WorkflowRuntime 抽象接口。

## 用户故事

### US-1: 零配置浏览器体验
作为用户，我希望打开 Live Demo 或本地 `npm run dev:frontend` 后，无需任何配置即可看到完整的 3D 场景和交互界面。

#### 验收标准
- AC-1.1: Frontend Mode 下不依赖任何 `/api` 请求和 Socket.IO 连接
- AC-1.2: GitHub Pages 部署版本强制使用 Frontend Mode
- AC-1.3: 3D 场景、工作流面板、配置面板、聊天面板在 Frontend Mode 下均可交互
- AC-1.4: 模式切换通过配置面板的 Frontend/Advanced 开关控制

### US-2: 浏览器端工作流执行
作为用户，我希望在 Frontend Mode 下也能提交指令并看到工作流执行过程（使用浏览器直连的 LLM 或模拟数据）。

#### 验收标准
- AC-2.1: BrowserWorkflowRepository 在内存中管理工作流、任务、消息记录
- AC-2.2: BrowserAgentDirectory 提供智能体查找和 LLM 调用能力
- AC-2.3: BrowserMessageBus 实现层级消息发送（复用 shared/message-bus-rules.ts 的校验逻辑）
- AC-2.4: BrowserEventEmitter 通过回调函数（而非 Socket.IO）通知 UI 层

### US-3: IndexedDB 持久化
作为用户，我希望浏览器端的配置、工作流历史、智能体人设和报告可以持久化到 IndexedDB，刷新页面后不丢失。

#### 验收标准
- AC-3.1: IndexedDB 数据库名 `whybuddy-runtime`，包含 meta/aiConfig/agents/souls/heartbeats/workflows/workflowDetails/recentMemory/memorySearch/heartbeatStatuses/heartbeatReports 等 store
- AC-3.2: `persistAIConfig()` / `getAIConfigSnapshot()` 管理 AI 配置
- AC-3.3: `persistAgents()` / `getAgentsSnapshot()` 管理智能体列表
- AC-3.4: `persistSoul()` / `getSoulSnapshot()` 管理人设快照
- AC-3.5: `persistWorkflows()` / `getWorkflowsSnapshot()` 管理工作流历史
- AC-3.6: 支持 `canUseIndexedDb()` 检测浏览器兼容性

### US-4: 配置导入导出
作为用户，我希望可以将浏览器端的所有数据导出为 JSON 文件，也可以从文件导入恢复，这样我可以在不同设备间迁移数据。

#### 验收标准
- AC-4.1: `exportBrowserRuntimeBundle()` 导出完整的 BrowserRuntimeExportBundle（含 meta、aiConfig、agents、souls、workflows 等）
- AC-4.2: `importBrowserRuntimeBundle(bundle)` 从 JSON 导入并覆盖当前数据
- AC-4.3: 导入/导出时间戳记录在 metadata 中

### US-5: Browser Direct / Server Proxy 双模式 LLM 调用
作为用户，我希望可以选择浏览器直连 LLM 提供商或通过服务端代理调用，这样我可以根据网络环境灵活选择。

#### 验收标准
- AC-5.1: browser-llm.ts 实现浏览器端直连 OpenAI 兼容接口
- AC-5.2: 配置面板提示"浏览器直连模式下 API Key 保存在本地，仅适合本地使用"
- AC-5.3: 不支持浏览器直连的提供商可配置代理 URL
- AC-5.4: 聊天面板支持 Browser Direct 和 Server Proxy 两种模式切换
