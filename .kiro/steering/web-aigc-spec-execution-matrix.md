# Web-AIGC 迁移 Spec 执行矩阵

## 文档目标

本文用于说明当前保留下来的 `58` 个 `web-aigc` 迁移 spec，哪些可以并行执行，哪些必须先收口，哪些适合先做文档、后做实现，以及在代码阶段应如何组织并发，避免多人或多线程同时改同一层抽象导致反复返工。

## 适用范围

本文覆盖以下文档集合：

- `6` 个平台级 spec：`web-aigc-platform-*`
- `52` 个节点级 spec：`web-aigc-node-*`

总计 `58` 个 spec 目录，每个目录均包含：

- `requirements.md`
- `design.md`
- `tasks.md`

## 核心结论

这 `58` 个 spec：

- 可以并行推进
- 但不能无依赖地 `58` 个一起平铺执行
- 最合理的方式是“平台先收口一轮，节点按能力簇并行”

如果是文档推进：

- 并行度可以做到 `70% - 80%`

如果是代码推进：

- 推荐并发度控制在 `8 - 12` 条工作流
- 不建议按 `58` 个 spec 一起开工

## 2026-04-23 主线接线校准

需要明确：

- `58 / 58` 份 `web-aigc` specs 与 `238 / 238` 个顶层任务已全部完成，这是已经封板的事实。
- 本文保留的 L0-L5 分层、能力簇和波次，主要用于说明“后续主线增强如何分批并行收口”，不再表示 spec 完成度。
- 2026-04-23 主线已确认新增接线：`server/index.ts` 已挂载 `robot-reply`、`open-page`、`mcp`、`open-dashboard`、`web-search`、`web-qa`、`get-location-info`、`get-device-info`、`vector-update`、`vector-delete` 等入口；`server/routes/workflows.ts` 已挂载 `open-report` 子路由，并承载 `/api/workflows/:id/runtime/run`、`/api/workflows/:id/runtime/retry`、`/api/workflows/:id/runtime/escalate` 的 workflow runtime governance 控制链路；RAG `vectorStore` 已通过 `ragDeps` 暴露给 `/api/rag`、向量治理与风险动作路由。
- 因此，文中“优先实现”“延后”“空白项”等表述，都应理解为主线补线优先级，不等同于“未启动”或“spec 未完成”。

## 执行原则

### 原则 1：先平台，后节点

6 个平台级 spec 是 52 个节点 spec 的上位约束，必须先形成第一轮统一结论，否则节点级实现会反复返工。

### 原则 2：按能力簇并行，不按单节点乱并行

节点级 spec 看似有 52 个，但真正落地时应该按能力簇推进，而不是 52 个节点平铺推进。

### 原则 3：文档并行度高于代码并行度

文档阶段只要术语、状态、接口归一，很多组可以同时写；代码阶段则受共享文件、共享接口、共享状态机影响更大。

### 原则 4：共享写入范围必须隔离

同一批并行工作如果都要改：

- `shared` 契约
- `server/core/workflow-engine.ts`
- `server/routes/workflows.ts`
- `server/routes/tasks.ts`

那么冲突概率会急剧上升，必须分批。

## 分层执行模型

建议把 58 个 spec 的推进拆成 5 层。

### L0：术语与契约收口层

这是所有并行工作的前置层，不是大量写代码，而是先把语言统一。

包含：

- 图定义、图版本、图实例、节点执行记录、边跳转记录等术语
- 状态映射
- 输入输出契约命名
- replay / audit / session / mission 的挂接关系

主要依赖：

- `web-aigc-platform-domain-model`

并发建议：

- 低并发
- `1 - 2` 条工作流即可

### L1：平台骨架层

这是第一批可以并行但不能失控并行的层。

包含：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`
- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`
- `web-aigc-platform-observability-audit`
- `web-aigc-platform-security-governance`

并发建议：

- `3 - 4` 条工作流

推荐顺序：

1. 先收口 `web-aigc-platform-domain-model`
2. 再推进 `web-aigc-platform-runtime-engine`
3. 然后并行推进 `mission-projection` 与 `session-instance`
4. 最后补齐 `observability-audit` 与 `security-governance`

### L2：高价值运行时节点层

这是第一批最值得并行推进的节点层，优先级最高。

包含：

- `web-aigc-node-dialogue`
- `web-aigc-node-robot_reply`
- `web-aigc-node-knowledge_qa`
- `web-aigc-node-web_qa`
- `web-aigc-node-user_input`
- `web-aigc-node-selection`
- `web-aigc-node-confirm_judge`
- `web-aigc-node-param_collection`
- `web-aigc-node-mcp`
- `web-aigc-node-auto_agent`
- `web-aigc-node-vector_query`
- `web-aigc-node-audio_recognition`
- `web-aigc-node-ocr_recognition`

并发建议：

- `4 - 6` 条工作流

适合原因：

- 用户价值高
- 大部分能映射到 Cube 现有能力底座
- 不需要等完整设计器能力落地

### L3：流程控制与中台节点层

这一层对平台意义很大，但比 L2 更依赖图运行时骨架。

包含：

- `web-aigc-node-start`
- `web-aigc-node-end`
- `web-aigc-node-condition`
- `web-aigc-node-loop`
- `web-aigc-node-flow_jump`
- `web-aigc-node-variable_assignment`
- `web-aigc-node-format_output`
- `web-aigc-node-intent_recognition`
- `web-aigc-node-command_list`
- `web-aigc-node-recommended_commands`
- `web-aigc-node-orchestration_recognition_jump`
- `web-aigc-node-llm`

并发建议：

- `2 - 4` 条工作流

注意事项：

- 这一层不要早于 `runtime-engine`
- `condition / loop / flow_jump` 尽量同批次设计，避免边语义前后不一致

### L4：高风险写操作与业务动作层

这一层不适合第一波大规模并行编码，但可以提前并行完善文档。

包含：

- `web-aigc-node-vector_update`
- `web-aigc-node-vector_insert`
- `web-aigc-node-vector_delete`
- `web-aigc-node-transaction_flow`
- `web-aigc-node-internal_api`
- `web-aigc-node-passthrough_api`
- `web-aigc-node-message_notification`

并发建议：

- 文档阶段可并行
- 代码阶段建议低并发，`1 - 2` 条工作流

原因：

- 涉及真实写操作
- 治理与审计要求高
- 容易和权限、风险闸门、审计链耦合

### L5：宿主壳与次优先节点层

这一层可以继续保留 spec 视角作为归档，但当前更适合以主线接线补齐而不是 spec 完成度判断优先级，其中 `open_page / open_report / open_dashboard / get_*` 已有主线入口或工作流子路由接线。

包含：

- `web-aigc-node-open_page`
- `web-aigc-node-open_report`
- `web-aigc-node-open_dashboard`
- `web-aigc-node-get_device_info`
- `web-aigc-node-get_location_info`
- `web-aigc-node-ai_ppt`
- `web-aigc-node-dynamic_chart`
- `web-aigc-node-image_search`

并发建议：

- 文档阶段可并行
- 代码阶段延后

## 并行执行矩阵

| 层级 | spec 范围 | 是否可并行 | 推荐并发度 | 是否建议优先实现 |
| --- | --- | --- | --- | --- |
| L0 | 平台术语与契约归一 | 低度并行 | 1-2 | 是 |
| L1 | 6 个平台级 spec | 中度并行 | 3-4 | 是 |
| L2 | 对话 / QA / HITL / MCP / 向量查询 / 多模态读取 | 高度并行 | 4-6 | 是 |
| L3 | 条件 / 循环 / 跳转 / 变量 / 格式化 / 命令类节点 | 中度并行 | 2-4 | 是，但晚于 L1 |
| L4 | 向量写操作 / 事务 / 内外部 API / 通知 | 文档可并行，代码低并行 | 1-2 | 否，第二或第三波 |
| L5 | 页面壳 / 设备壳 / 次优先内容节点 | 文档可并行 | 1-3 | 否，延后 |

## 52 个节点的能力簇并行拆分

建议把节点实现拆成以下 8 个能力簇。

### 能力簇 A：流程控制组

- `start`
- `end`
- `condition`
- `loop`
- `flow_jump`
- `variable_assignment`
- `format_output`

依赖：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`

代码并发建议：

- `1 - 2` 条工作流

2026-04-22 主仓校准：

- `start` 已经具备入口输入归一、初始快照、mission/projection 传递闭环，后续以事件语义细化为主。
- `end` 已经具备 runtime 终点适配器、`final_report` 收敛与 `workflow_complete` 事件，不再属于首轮“从 0 到 1”节点。
- `condition` 已具备 runtime 内置适配器与异常表达式测试，后续以 replay / observability 细化为主。
- `loop` 仍缺节点级执行闭环，应继续保留为流程控制组里最优先的主线补线项；该表述仅用于控制流增强排序，不影响 `58 / 58` specs 已封板的事实。

### 能力簇 B：人工输入组

- `user_input`
- `selection`
- `confirm_judge`
- `param_collection`
- `recommended_commands`
- `command_list`
- `intent_recognition`

依赖：

- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`

代码并发建议：

- `1 - 2` 条工作流

2026-04-22 主仓校准：

- `selection / confirm_judge` 已经属于 runtime-native HITL 节点，后续重点是前端投影与治理补强，不是底座补洞。
- `user_input` 已落在通用 HITL 的 waiting / resume / cancel / timeout 链路上，但还不是 `WorkflowRuntimeEngine` 内置原生节点适配器。
- `param_collection` 已具备 waiting / resume 与专用审计摘要事件，仍缺多字段表单校验、动态表单渲染与附件型采集闭环。

### 能力簇 C：对话问答组

- `dialogue`
- `robot_reply`
- `knowledge_qa`
- `web_qa`

依赖：

- `web-aigc-platform-session-instance`
- `web-aigc-platform-runtime-engine`

代码并发建议：

- `1 - 2` 条工作流

### 能力簇 D：内容处理组

- `long_text_extraction`
- `fragment_search`
- `file_slicing`
- `document_search`
- `file_translation`
- `qa_search`
- `excel_read`
- `static_webpage_read`

依赖：

- `web-aigc-platform-runtime-engine`

代码并发建议：

- `1 - 2` 条工作流

### 能力簇 E：多模态组

- `audio_recognition`
- `ocr_recognition`
- `image_search`
- `ai_ppt`
- `dynamic_chart`

依赖：

- `web-aigc-platform-session-instance`
- artifact 与多模态适配能力

代码并发建议：

- `1 - 2` 条工作流

### 能力簇 F：工具集成组

- `mcp`
- `auto_agent`
- `internal_api`
- `passthrough_api`
- `message_notification`
- `llm`

依赖：

- `web-aigc-platform-security-governance`
- `web-aigc-platform-observability-audit`

代码并发建议：

- `1 - 2` 条工作流

### 能力簇 G：页面与业务动作组

- `open_page`
- `open_report`
- `open_dashboard`
- `transaction_flow`
- `orchestration_recognition_jump`

依赖：

- `web-aigc-platform-security-governance`
- 宿主前端动作能力

代码并发建议：

- `1` 条工作流

### 能力簇 H：向量与设备组

- `vector_query`
- `vector_update`
- `vector_insert`
- `vector_delete`
- `get_device_info`
- `get_location_info`

依赖：

- `web-aigc-platform-security-governance`
- `web-aigc-platform-observability-audit`

代码并发建议：

- `1 - 2` 条工作流

## 2026-04-23 主线接线补充

### 已接入主服务入口的能力补全

- 已补全并确认主入口挂载：`mcp`、`robot-reply`、`open-page`、`open-dashboard`
- 已补全并确认检索 / 问答入口：`web-search`、`web-qa`
- 已补全并确认环境 / 设备入口：`get-location-info`、`get-device-info`
- 已补全并确认向量治理入口：`vector-update`、`vector-delete`
- 与前序已接入入口一起，当前主服务入口已覆盖：`ai-ppt`、`audio-recognition`、`dynamic-chart`、`excel-read`、`file-generation`、`file-slicing`、`file-translation`、`format-output`、`graph-search`、`image-search`、`intent-recognition`、`long-text-extraction`、`ocr-recognition`、`similarity-match`、`static-webpage-read`、`transaction-flow`、`orchestration-recognition-jump` 等能力
- `open-report` 已由 `server/routes/workflows.ts` 以 `/api/workflows/open-report` 子路由接入主线，不经过独立一级入口，但已属于可调用的宿主动作路由
- workflow runtime governance 已通过 `/api/workflows/:id/runtime/run` 的 `runtimeGovernance` 入参与 `/api/workflows/:id/runtime/retry`、`/api/workflows/:id/runtime/escalate` 控制路由接入主线
- RAG `vectorStore` 已通过 `ragDeps` 暴露给 `/api/rag`、`/api/vector-update`、`/api/vector-delete` 与 `/api/rag/risk-actions`；`/api/rag/admin/health` 会返回 `vectorStore.connected`、`vectorStore.backend` 与 collection 视图

### 已接入 runtime extra adapters 的能力补全

- 知识 / 问答 / 检索：`knowledge_qa`、`qa_search`、`web_search`、`web_qa`
- 工具 / 环境：`mcp`、`get_location_info`、`get_device_info`
- 多模态 / 内容理解：`audio_recognition`、`graph_search`、`static_webpage_read`、`intent_recognition`、`long_text_extraction`、`ocr_recognition`、`similarity_match`
- Office / content nodes：`ai_ppt`、`excel_read`、`dynamic_chart`、`image_search`、`file_slicing`、`file_translation`、`file_generation`
- 高风险 / 业务动作 nodes：`transaction_flow`、`orchestration_recognition_jump`

## 推荐执行波次

## 第一波：平台骨架与直接价值节点

目标：

- 先跑通一条能看见效果的最小闭环

建议包含：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`
- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`
- `web-aigc-node-dialogue`
- `web-aigc-node-knowledge_qa`
- `web-aigc-node-user_input`
- `web-aigc-node-selection`
- `web-aigc-node-confirm_judge`
- `web-aigc-node-mcp`
- `web-aigc-node-auto_agent`
- `web-aigc-node-vector_query`
- `web-aigc-node-audio_recognition`
- `web-aigc-node-ocr_recognition`

建议并发度：

- 文档：`6 - 8`
- 代码：`4 - 6`

## 第二波：控制流与结构化中台节点

2026-04-22 校准说明：

- 这一波里 `start / end / condition` 在主仓已具备最小闭环，更适合作为“口径收紧、测试补强、事件细化”项推进。
- `loop` 仍是控制流节点里最明显的主线补线项，应继续保留在第二波的优先实现位；这只表示补线顺序，不表示 spec 未完成。

建议包含：

- `start`
- `end`
- `condition`
- `loop`
- `flow_jump`
- `variable_assignment`
- `format_output`
- `intent_recognition`
- `command_list`
- `recommended_commands`
- `robot_reply`
- `document_search`
- `fragment_search`

建议并发度：

- 文档：`4 - 6`
- 代码：`3 - 4`

## 第三波：高风险写操作与宿主壳节点

建议包含：

- `vector_update`
- `vector_insert`
- `vector_delete`
- `transaction_flow`
- `internal_api`
- `passthrough_api`
- `message_notification`
- `open_page`
- `open_report`
- `open_dashboard`
- `get_device_info`
- `get_location_info`

建议并发度：

- 文档：`3 - 4`
- 代码：`1 - 2`

## 文档阶段与代码阶段的并发差异

| 阶段 | 推荐并发度 | 说明 |
| --- | --- | --- |
| 文档编写 | 8-12 | 只要术语归一，绝大多数 spec 可并行完善 |
| 接口设计 | 4-6 | 共享契约开始增多，需要收口 |
| 骨架编码 | 3-5 | 多个实现会开始写共享文件 |
| 集成联调 | 2-3 | replay / audit / mission 投影会产生连锁影响 |
| 回归与治理补齐 | 1-2 | 需要统一收尾，不适合大规模并发 |

## 高冲突文件与共享写入范围

以下文件或模块在代码阶段是高冲突区域：

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
- `server/routes/permissions.ts`
- `server/routes/audit.ts`

如果多个并行工作都要同时改这里，建议：

1. 先拆清楚谁拥有哪个写入范围
2. 共享契约优先集中收口
3. 节点适配器尽量向外扩展，不要反复改内核

## 推荐的团队 / 多线程组织方式

如果把这 58 个 spec 作为多线程执行任务，建议采用下面的组织方式。

### 工作流 1：平台主干

负责：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`

### 工作流 2：任务投影与实例监控

负责：

- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`

### 工作流 3：可观测与治理

负责：

- `web-aigc-platform-observability-audit`
- `web-aigc-platform-security-governance`

### 工作流 4：对话与问答

负责：

- `dialogue`
- `robot_reply`
- `knowledge_qa`
- `web_qa`

### 工作流 5：人工输入

负责：

- `user_input`
- `selection`
- `confirm_judge`
- `param_collection`
- `recommended_commands`

### 工作流 6：内容处理

负责：

- `long_text_extraction`
- `fragment_search`
- `file_slicing`
- `document_search`
- `file_translation`
- `qa_search`
- `excel_read`
- `static_webpage_read`

### 工作流 7：多模态

负责：

- `audio_recognition`
- `ocr_recognition`
- `image_search`
- `ai_ppt`
- `dynamic_chart`

### 工作流 8：工具与向量

负责：

- `mcp`
- `auto_agent`
- `llm`
- `vector_query`
- `vector_update`
- `vector_insert`
- `vector_delete`

### 工作流 9：控制流与业务动作

负责：

- `start`
- `end`
- `condition`
- `loop`
- `flow_jump`
- `variable_assignment`
- `format_output`
- `open_page`
- `open_report`
- `open_dashboard`
- `transaction_flow`
- `orchestration_recognition_jump`
- `internal_api`
- `passthrough_api`
- `message_notification`
- `command_list`
- `intent_recognition`

建议：

- 文档阶段可以开到 `8 - 9` 条
- 代码阶段建议收敛到 `5 - 6` 条

## 最终建议

最推荐的执行方式是：

1. 先用 `1 - 2` 条工作流收口平台术语和状态模型
2. 再用 `3 - 4` 条工作流推进 6 个平台 spec
3. 然后按 `8` 个能力簇并行推进 52 个节点 spec
4. 代码阶段把并发度控制在 `5 - 6`
5. 高风险写操作与业务动作类节点放到最后一波

一句话总结：

这 `58` 个 spec 完全可以并行推进，但推荐的是“分层并发、能力簇并发、共享内核收口”，而不是 `58` 个平铺同时冲。
