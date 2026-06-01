---
inclusion: auto
---

# 2026-04-15 Runtime Addendum

保留以下旧指南不变，新增当前实现约束：

1. 不得再默认假设 Docker 必然存在。
2. 涉及执行链路的功能要同时考虑 `real`、`native`、`mock`。
3. 涉及 GitHub Pages 的功能不得写成 executor-backed 模式。
4. 如果改动了运行时边界，必须同步检查 README、ROADMAP 和 steering 补充文档。

补充文档：

- `.kiro/steering/2026-04-15-runtime-current-state.md`

# 模块实现指南

从 rbac-system-pc 的 90 个 AIGC 模块批量实现经验中提炼的方法论，适配 whybuddy 当前“主线已落地、以增量补完 spec 为主”的实现阶段。

## 一、实现前检查清单（每个模块必须执行）

实现任何模块的第一步，对照下表检查该模块需要复用哪些已有能力。
**禁止跳过此步骤，禁止重复实现已有能力。**

### 共享契约检查表

| 检查项 | 条件 | 必须使用的契约 | 路径 |
|--------|------|---------------|------|
| 是否涉及演示数据？ | 模块需要预录数据 | `DemoDataBundle` schema | `shared/demo/contracts.ts` |
| 是否涉及遥测/成本/恢复？ | 模块读写系统状态 | 事件总线格式 + IDB store key | `shared/telemetry/contracts.ts` |
| 是否涉及记忆读写？ | 模块访问记忆系统 | `MemoryReader` / `MemoryWriter` / `MemoryIndex` | `shared/memory/contracts.ts` |
| 是否涉及 Mission 丰富化？ | 模块扩展 MissionRecord | `MissionEnrichmentFields` | `shared/mission/enrichment.ts` |
| 是否涉及跨框架导出？ | 模块输出其他框架格式 | `ExportRequest` / `ExportResult` | `shared/export/contracts.ts` |

### 已有核心模块复用检查表

| 检查项 | 条件 | 必须复用的模块 | 关键文件 |
|--------|------|---------------|---------|
| 是否需要工作流执行？ | 模块触发十阶段管道 | WorkflowEngine | `server/core/workflow-engine.ts` |
| 是否需要动态组织？ | 模块生成智能体团队 | DynamicOrganization | `server/core/dynamic-organization.ts` |
| 是否需要 Mission 状态机？ | 模块管理任务生命周期 | MissionStore | `server/tasks/mission-store.ts` |
| 是否需要 LLM 调用？ | 模块调用大模型 | LLMClient | `server/core/llm-client.ts` |
| 是否需要智能体调用？ | 模块通过智能体执行 | AgentDirectory | `server/core/registry.ts` |
| 是否需要消息传递？ | 模块涉及智能体间通信 | MessageBus | `server/core/message-bus.ts` |
| 是否需要工作空间访问？ | 模块读写智能体文件 | AccessGuard | `server/core/access-guard.ts` |
| 是否需要浏览器端运行？ | 模块支持 Frontend Mode | BrowserRuntime | `client/src/runtime/browser-runtime.ts` |
| 是否需要 Socket 推送？ | 模块实时通知前端 | Socket.IO | `server/core/socket.ts` |

## 二、Autopilot 批量执行策略

在 autopilot 模式下批量推进实现时，遵循以下规则：

1. 所有 tasks.md 中标记 `*` 的可选任务（属性测试、集成测试）**跳过不执行**
2. 所有 Checkpoint 任务（如 "Checkpoint - 确保所有测试通过"）**跳过不执行**，直接标记为完成并继续下一个任务
3. 仅执行代码实现任务（类型定义、核心逻辑、API 路由、前端组件等）
4. 测试环节留待用户手动触发时再执行
5. 每个模块完成后必须运行 `npm run check`；若仓库存在历史 TypeScript 存量错误，至少保证不新增错误，并在 steering/提交说明中记录差异

> 当前基线快照（2026-04-09）：`npm run check` 仍有 30 个 TypeScript 错误，后续模块实现以“局部变更不扩大基线”为最低要求。

## 三、共享能力注册制（从 rbac-system-pc 迁移的模式）

whybuddy 中以下能力采用注册制，新模块只需注册独有配置：

### 工作流阶段注册
```typescript
// 新增阶段只需在 WORKFLOW_STAGES 数组中追加
// 并在 WorkflowEngine.runPipeline() 中添加对应的 run 方法
```

### Skill 注册（plugin-skill-system 实现后）
```typescript
// 每个 Skill 只需声明：
registerSkill({
  id: "skill-xxx",
  name: "技能名称",
  prompt: "系统提示词",
  tools: ["tool1", "tool2"],
  applicableRoles: ["worker", "manager"],
});
```

### 遥测事件注册
```typescript
// 新模块的遥测事件必须使用 shared/telemetry/contracts.ts 中定义的前缀
// telemetry: / cost: / recovery:
// 新增事件类型需要先在契约中定义，再实现
```

### Memory Index 注册
```typescript
// knowledge-graph 和 vector-db-rag-pipeline 各自实现 MemoryIndex 接口
// 通过 MemoryIndexRegistry.register() 注册
// memory-system 内核在写入时自动通知所有已注册索引
```

## 四、文件命名与目录约定

### 服务端新模块
```
server/
├── core/           # 核心引擎（workflow-engine、dynamic-organization 等）
├── memory/         # 记忆系统（session-store、vector-store、soul-store）
├── tasks/          # Mission 任务域
├── feishu/         # 飞书集成
├── routes/         # Express 路由
├── db/             # 数据库层
└── tests/          # 测试文件
```

### 前端新模块
```
client/src/
├── components/     # UI 组件
│   ├── three/      # Three.js 子组件
│   ├── tasks/      # 任务驾驶舱组件
│   └── ui/         # shadcn/ui 基础组件
├── lib/            # 状态管理、API 封装、工具函数
├── pages/          # 页面组件
├── runtime/        # 浏览器运行时
├── hooks/          # React hooks
└── i18n/           # 国际化
```

### 共享契约
```
shared/
├── demo/           # 演示数据契约
├── telemetry/      # 遥测/成本/恢复契约
├── memory/         # 记忆读写接口契约
├── mission/        # Mission 契约 + 丰富化字段
├── executor/       # 执行器契约
└── export/         # 跨框架导出契约
```

## 五、质量门禁

每个模块实现完成后必须通过（或在当前基线未绿时明确记录差值）：

1. `npm run check` — TypeScript 严格模式编译；若仍受历史错误阻塞，需确认未新增错误
2. 不引入新的 `any` 类型（除非有明确注释说明原因）
3. 不修改 `shared/` 下已冻结的契约文件（阶段 0 产出）
4. 不破坏现有 `npm run dev:frontend` 和 `npm run dev:all` 的启动流程
5. 新增的 Socket 事件必须在 `shared/` 中有类型定义
6. 新增的 IndexedDB store 必须在 `shared/telemetry/contracts.ts` 的 `OBSERVABILITY_IDB_STORES` 中注册
