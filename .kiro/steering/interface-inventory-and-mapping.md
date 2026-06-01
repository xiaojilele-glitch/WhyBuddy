---
inclusion: manual
---

# 接口清单与映射：`web-aigc` -> WhyBuddy

## 范围

本文用于把已检查过的 `web-aigc` 编排接口映射到 WhyBuddy 当前或未来的承接位置。

## 已检查的来源系统

### `web-aigc`

- `src/pages/aigc/orchestration/list/services/index.ts`
- `src/pages/aigc/orchestration/designer/services/index.ts`
- `src/pages/aigc/orchestration/designer/nodes/nodeTypes.ts`
- `src/pages/aigc/agent-monitoring/services/monitorApi.ts`

### `whybuddy`

- `shared/workflow-runtime.ts`
- `server/core/workflow-engine.ts`
- `server/routes/workflows.ts`
- `server/routes/tasks.ts`
- `server/routes/replay.ts`
- `server/routes/rag.ts`
- `server/routes/knowledge.ts`
- `server/routes/voice.ts`
- `server/routes/vision.ts`
- `server/routes/a2a.ts`
- `server/routes/skills.ts`
- `server/routes/permissions.ts`

## 接口映射表

| `web-aigc` 接口 | 接口意图 | Cube 承接位置 | 迁移判断 |
| --- | --- | --- | --- |
| `categoryApi.*` | 编排分类管理 | 未来 graph definition 后台模块 | 延后 |
| `orchApi.list/detail/create/update/toggleStatus` | 编排定义 CRUD | 未来 graph definition 服务，邻接 `server/routes/workflows.ts` | 延后 |
| `orchApi.saveFlow` | 保存图结构定义 | 未来 graph draft 存储层 | 等领域模型稳定后再做 |
| `orchApi.duplicate/importData/exportData` | 定义生命周期管理 | 未来发布 / 导入 / 导出模块 | 延后 |
| `versionApi.list/detail/publish/restore` | 版本生命周期 | 未来发布子系统 + 报告 / 发布治理 | 第 3 阶段 |
| `wakeWordApi.*` | 唤醒词管理 | 可能挂到 `voice` 配置扩展 | 延后 |
| `permissionApi.*` | 编排权限控制 | `server/routes/permissions.ts` | 迁移其策略意图，不照搬页面 |
| `scheduledTaskApi.*` | 定时执行编排 | 未来运行时运营模块 | 第 3 阶段 |
| `instanceApi.list/terminate` | 实例监控与操作 | `server/routes/workflows.ts`、`server/routes/tasks.ts` | 优先迁移 |
| `relatedAppApi.*` | 关联应用绑定 | mission / operator 壳层或 app registry | 大概率延后 |
| `flowApi.listNodeTypes/getNodeType` | 节点 schema 注册 | 未来 graph node registry 服务 | 第 4 阶段 |
| `flowApi.validate` | 流程校验 | 未来 graph compiler / validator | 第 4 阶段 |
| `flowApi.execute` | 临时执行流程 | graph runtime 执行入口 | 第 2 阶段 |
| `flowApi.save` | 保存流程定义 | graph draft 存储 | 第 4 阶段 |
| `fetchInstances` | 实例列表监控 | `GET /api/workflows`、replay 看板 | 优先迁移 |
| `fetchInstanceDetail` | 节点级执行详情 | workflow 详情 + replay snapshot API | 优先迁移 |
| `fetchInstanceSession` | 关联会话内容 | task / workflow 消息流、chat / session 层 | 优先迁移 |
| `terminateInstance` | 强制终止实例 | `POST /api/tasks/:id/cancel` + workflow / operator bridge | 优先迁移 |

## 节点注册表分组建议

从 `nodeTypes.ts` 看，节点更适合按能力簇迁移，而不是逐页迁移。

### 流程控制与数据处理

- `start`
- `end`
- `condition`
- `loop`
- `flow_jump`
- `variable_assignment`
- `format_output`

### 人工输入与分支

- `user_input`
- `selection`
- `confirm_judge`
- `param_collection`
- `recommended_commands`

### 对话与问答

- `dialogue`
- `knowledge_qa`
- `web_qa`
- `robot_reply`

### 检索与内容处理

- `document_search`
- `fragment_search`
- `graph_search`
- `web_search`
- `qa_search`
- `long_text_extraction`
- `file_slicing`
- `file_translation`
- `excel_read`
- `static_webpage_read`

### 多模态

- `audio_recognition`
- `ocr_recognition`
- `image_search`
- `ai_ppt`

### 工具与集成

- `mcp`
- `auto_agent`
- `internal_api`
- `passthrough_api`
- `message_notification`
- `open_page`
- `open_report`
- `open_dashboard`
- `transaction_flow`

### 向量操作

- `vector_query`
- `vector_update`
- `vector_insert`
- `vector_delete`

### 移动端与设备

- `get_device_info`
- `get_location_info`

## 可迁移性判断

### 直接可迁移或接近可直接迁移

- 实例监控与实例 / 会话查看
- 对话运行时与消息记录
- 知识问答 / 检索能力
- 用户输入收集与审批流
- 多模态分析能力
- MCP / 外部工具 / Agent 调用
- 向量查询读路径

### 条件可迁移

- condition / loop / data transform
- 版本 publish / restore
- scheduled execution
- 向量写操作

### 不适合第一波迁移

- wake word 体系
- related app 维护接口
- device / location 壳节点
- 强依赖宿主产品上下文的页面打开型壳节点

## 推荐术语统一

建议在 Cube 中统一使用以下术语：

- graph definition：图定义
- graph draft：图草稿
- graph version：图版本
- graph execution instance：图执行实例
- node execution record：节点执行记录
- edge transition：边跳转记录
- operator action：操作员动作
- linked mission：关联 mission
- linked session：关联会话
- replay snapshot：回放快照
