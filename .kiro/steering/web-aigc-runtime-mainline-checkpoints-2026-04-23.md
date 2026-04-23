# Web-AIGC Runtime 主线检查点（2026-04-23，主线接线后更新）

## 范围

本文不是补 `specs`，也不是给单个节点补设计文档。

本文件只做一件事：整理当前主仓 `runtime` 主线已经真实打通的节点族谱，并按以下五个维度做中文检查点归档：

- `mainline wiring`
- `built-in`
- `extra adapters`
- `wait-resume`
- `audit-observability`

目标是明确当前 runtime 主线已经具备哪些真实能力，哪些入口已经进入主服务，哪些节点已经进入主线执行面，哪些节点已经带上等待/恢复机制，以及哪些运行时事件已经进入 replay / audit 镜像。

补充口径：

- 本次文档属于“主线接线后更新”，重点补记 `server/index` 主服务入口、`workflows` 路由面与 RAG / MCP 共用依赖接线的最新状态。
- 本次更新说明的是“主线已经接上哪些真实入口与共享依赖”，不等于“所有节点 observability / telemetry 已经全统一”。

## 一、总览结论

截至 2026-04-23，`web-aigc` runtime 主线已经不再是空骨架，而是具备了以下五层结构：

1. 一层主服务入口接线面。
   负责把 Web-AIGC route 面、runtime extra adapters 注册面、RAG 共享依赖面和 workflow runtime 治理入口接到主服务入口。

2. 一层内建 runtime adapter。
   覆盖最小流程控制、对话、结束节点、赋值节点和人工选择节点。

3. 一层 extra runtime adapter。
   负责把已经落地的 Web-AIGC 节点逐步接入主线 runtime，而不是只停留在独立 route 层。

4. 一层 wait / resume 控制面。
   已覆盖人工选择、参数采集、人工审批型 `mcp`、高风险 `transaction_flow`，以及 terminate / retry / escalate 等运行时控制入口。

5. 一层 runtime observability bridge。
   已把核心 runtime 事件镜像到 replay / audit，并形成节点成功、失败、等待输入、变量赋值、跳转、重试、升级、终止等最小可观测面。

这说明当前 runtime 主线已经从“定义阶段”进入“主服务接线 + 编排执行 + 控制恢复 + 观测治理”并行收口阶段。

## 二、主线接线检查点（主线接线后更新）

以下内容是本次“主线接线后更新”需要单独补记的事实，重点不在新增 spec，而在于确认这些能力已经被 `server/index` 与 `workflows` route 真实接到主服务主线。

### 1. `server/index` 已承担 route 面与 runtime 注册面的双重接线

当前 `server/index` 已不只是在启动 `web-aigc` 相关依赖，而是同时完成两类主线接线：

- route 面：`/api/chat`、`/api/mcp`、`/api/web-qa`、`/api/vector-update`、`/api/vector-delete`、`/api/rag/risk-actions` 等 Web-AIGC 入口已经挂到主服务入口。
- runtime 注册面：`registerWebAigcRuntimeExtraAdapters(...)` 已在同一入口被调用，extra adapters 不再只是“代码存在”，而是已经有主服务级注册动作。

这意味着当前检查点不能再把 Web-AIGC 视为“散落 route + 独立 adapter”，而应视为“已在主服务入口形成 route 面与 runtime 注册面双接线”。

### 2. `chat` / `documentSearch` 已形成同源注入链

当前 `chatDocumentSearch` 已同时进入三处主线位置：

- `createChatRouter(...)`
- `serverRuntime.documentSearch`
- `registerWebAigcRuntimeExtraAdapters(...)`

这带来的实际变化是：

- chat route 与 runtime chat 节点开始复用同一份文档检索能力。
- extra adapters 中依赖 document search 的节点注册时可以直接拿到同源注入，而不是各自重新拼装检索依赖。

这是一条“主服务入口 -> serverRuntime -> extra adapters”的真实接线链，而不只是 route 层临时透传。

### 3. RAG 初始化已暴露共享 store 依赖

`initRAG()` 当前返回值中已显式暴露 `metadataStore` 与 `vectorStore`。这使得以下接线关系成立：

- 独立 `/api/vector-update` 与 `/api/vector-delete` route 可以直接复用 `ragDeps.metadataStore` / `ragDeps.vectorStore`。
- `/api/rag/risk-actions` 下的 `vector-update` 与 `vector-delete` 也复用同一组 store 依赖。
- `vector-insert` 虽然主要走 `ingestionPipeline`，但仍与上述高风险动作共享 `metadataStore` 以及同一条 permission / audit 接线。

因此当前更准确的口径是：

- `vector-update` / `vector-delete` 与 `risk-actions` 已经不是彼此割裂的 RAG 动作入口。
- 它们在主线入口上已经共享 store + permission / audit 基础设施，只是并不等于这些高风险动作已经全部变成统一 runtime extra adapter 节点。

### 4. MCP 检查与执行适配器已进入主服务主线

当前主线上已经同时具备以下 MCP 组成件：

- `McpChecker` 已注册进主权限检查引擎，对应 `mcp_tool` 检查类型。
- `McpToolAdapter` 已作为 `/api/mcp` 的执行适配层接入主服务。
- `InternalMcpToolInvoker` 已作为 `McpToolAdapter` 的默认 invoker 进入主链路。
- runtime `mcp` extra adapter 通过 `executeMcp: (request) => mcpToolAdapter.execute(request)` 复用同一套执行入口。

这说明 MCP 现在已经不是“只有节点 spec 或独立 adapter”，而是已经进入 route、permission、audit、runtime 共用的主线执行链。

### 5. workflow route 已开始承接 runtime 治理与开放报告入口

当前 `workflows` route 除了已有的 `/:id/runtime/run` 执行入口，还具备以下主线接线：

- 运行入口支持从请求体注入 `runtimeGovernance`，并落入 runtime definition metadata。
- `/open-report` 子路由已挂到 `/api/workflows` 下，开放报告节点已有主线 route 承载。

这说明 workflow route 面已经开始承接 runtime 治理参数与开放报告能力，而不再只是传统 workflow CRUD 入口。

## 三、Built-in 节点族谱

以下节点类型当前由 `workflow-runtime-engine` 直接内建注册，属于 runtime 主线自带能力：

- `echo`
- `llm`
- `dialogue`
- `variable_assignment`
- `param_collection`
- `flow_jump`
- `condition`
- `end`
- `root`
- `agent_task`
- `plan`
- `review`
- `audit`
- `summary`
- `selection`
- `confirm_judge`

### Built-in 分组说明

#### 1. 对话与内容最小执行面

- `llm`
- `dialogue`

说明：

- 这两类由统一 chat runtime adapter 驱动。
- `dialogue` 在主线中已经不是纯文本回包，而是带会话、消息、增强元数据的节点类型。
- `serverRuntime.documentSearch` 已由主服务入口注入，chat 节点可直接复用与 `/api/chat` 同源的 document search 能力。

#### 2. 流程控制与结果收口

- `variable_assignment`
- `flow_jump`
- `condition`
- `end`

说明：

- 这是当前 runtime 主线的最小控制流骨架。
- 其中 `variable_assignment -> condition` 的联动已经有定向测试证据。

#### 3. 人工交互与等待输入

- `selection`
- `confirm_judge`
- `param_collection`

说明：

- 这三类 built-in 节点是 runtime 主线当前 wait / resume 的基础族谱。
- `selection / confirm_judge` 走的是 HITL choice adapter。
- `param_collection` 走的是结构化表单采集 adapter。

#### 4. 投影型透传节点

- `root`
- `agent_task`
- `plan`
- `review`
- `audit`
- `summary`

说明：

- 这批节点主要承担投影与流程兼容角色，不代表它们已经具备更复杂的业务执行语义。

## 四、Extra Adapters 节点族谱

以下节点类型当前已通过 `server/index` 中的 `registerWebAigcRuntimeExtraAdapters(...)` 接入 runtime 主线：

- `web_search`
- `web_qa`
- `get_location_info`
- `get_device_info`
- `audio_recognition`
- `graph_search`
- `knowledge_qa`
- `qa_search`
- `mcp`
- `static_webpage_read`
- `intent_recognition`
- `long_text_extraction`
- `ai_ppt`
- `excel_read`
- `transaction_flow`
- `dynamic_chart`
- `image_search`
- `orchestration_recognition_jump`
- `file_slicing`
- `file_translation`
- `file_generation`
- `ocr_recognition`
- `similarity_match`

### Extra Adapters 分组说明

#### 1. 搜索与问答族

- `web_search`
- `web_qa`
- `graph_search`
- `knowledge_qa`
- `qa_search`
- `similarity_match`

说明：

- 这一组已经不只在 route 层存在，而是可以进入 runtime 主线执行链。
- 其中 `web_qa`、`graph_search`、`knowledge_qa` 依赖主线下游检索或知识服务注入。
- `web_qa` 所依赖的 `documentSearch` 现在已经沿 `chat router -> serverRuntime -> extra adapter 注册面` 形成同源注入链。

#### 2. 多模态与感知族

- `audio_recognition`
- `ocr_recognition`
- `image_search`
- `static_webpage_read`
- `get_device_info`
- `get_location_info`

说明：

- 这组节点已经具备 runtime adapter 包装，不再只是独立接口。
- 其中部分节点已在 runtime 集成测试中形成最小闭环证据。

#### 3. Office / 内容生产族

- `ai_ppt`
- `excel_read`
- `dynamic_chart`
- `file_slicing`
- `file_translation`
- `file_generation`
- `long_text_extraction`

说明：

- 这组是当前主线中最接近 Office 场景的节点族谱。
- `ai_ppt / excel_read / dynamic_chart / file_slicing / file_translation / file_generation` 已有一条串联运行的 runtime 集成测试证据。

#### 4. 工具与高风险动作族

- `mcp`
- `transaction_flow`
- `orchestration_recognition_jump`

说明：

- 这组三类节点不仅有 runtime adapter，而且具备更强的 wait / resume 或治理色彩。
- 它们是 runtime 主线从“执行”走向“治理”的关键节点族。
- `mcp` 现已复用主线 `McpToolAdapter + InternalMcpToolInvoker + McpChecker` 组合，并带上 permission / audit / escalate 接线。
- `vector-update` / `vector-delete` / `risk-actions` 当前更准确地应归为“已接入主服务入口、共享 RAG store 与 permission/audit 的高风险 route 面补充”，不应误写成它们已经全部进入 extra adapter 节点族谱。

## 五、Wait-Resume 检查点

当前 runtime 主线里，已经形成明确 wait / resume 闭环的节点或控制入口如下：

### 1. Built-in 等待恢复节点

- `selection`
- `confirm_judge`
- `param_collection`

当前状态：

- `selection / confirm_judge` 会进入 `node.waiting_input`，并在 `resume(...)` 后根据选择结果推进分支。
- `param_collection` 会在 checkpoint 中保存输入 schema，并在恢复时做表单归一化与校验。

### 2. Extra Adapter 等待恢复节点

- `mcp`
- `transaction_flow`

当前状态：

- `mcp` 在审批要求命中时进入 wait 状态，恢复时走人工批准或驳回分支。
- `transaction_flow` 已有独立的 wait / resume runtime 测试，说明该类高风险动作已进入主线控制面。

### 3. Runtime 控制入口

以下控制入口已经不属于单个节点 spec，而是 runtime 主线控制能力的一部分：

- `terminate`
- `retry`
- `escalate`
- 自动重试
- 自动升级
- loop 超限强制终止

当前状态：

- 已有显式 `terminate / retry / escalate` 控制入口测试。
- 已有自动重试、自动升级、实例级治理预算阻断等测试证据。
- loop 超 `maxIterations`、超 `maxDurationMs` 的强制终止也已经进入 runtime 主线测试面。
- `/api/workflows/:id/runtime/run` 已支持 `runtimeGovernance` 注入，治理预算与策略可以沿主线运行入口进入 definition metadata。

### 4. 当前 wait-resume 口径

当前更准确的表述是：

- runtime 主线已经具备“节点等待恢复 + 运行时控制恢复”两层能力。
- 但这不等于所有高风险节点都已经统一接入同一套人工审批编排中心。

## 六、Audit-Observability 检查点

当前 `web-aigc-runtime-observability` 已经覆盖的 runtime 事件镜像如下。

### 1. 已进入 replay 的事件

- `node.started`
- `node.completed`
- `variable.assigned`
- `node.waiting_input`
- `edge.transitioned`
- `edge.loop_iterated`
- `instance.retry_requested`
- `instance.escalated`
- `node.failed`
- `instance.terminated`

当前口径：

- replay 侧已经具备节点启动、节点完成、变量赋值、等待输入、边跳转、循环迭代、重试、升级、失败和终止的最小镜像能力。

### 2. 已进入 audit 的事件

- `node.failed` -> `AGENT_FAILED`
- `instance.terminated` -> `AGENT_FAILED`
- `node.completed` -> `AGENT_EXECUTED`
- `variable.assigned` -> `DECISION_MADE`
- `edge.transitioned` 且 `kind = jump` -> `DECISION_MADE`
- `node.waiting_input` -> `DECISION_MADE`
- `instance.retry_requested` -> `DECISION_MADE`
- `instance.escalated` -> `DECISION_MADE`

当前口径：

- runtime 成功、失败、等待、跳转、变量赋值和控制动作都已经进入 audit 最小镜像面。
- 这说明 runtime 主线现在已经具备“不是只会跑，还会留证据”的基础能力。

### 3. 当前观测边界

需要明确以下边界：

- 并不是所有节点输出里的 `observability` 字段都已经自动统一写进 runtime 事件。
- 当前 bridge 已经足够支撑最小 replay / audit 证据，但更完整的 lineage、全节点统一 telemetry 仍然属于后续收口范围。
- 因而这份文档应理解为“主线接线后更新”，不是“全节点 observability / telemetry 已经全统一”的完成态声明。

## 七、已有测试证据摘要

### 1. Built-in 侧证据

已有明确测试覆盖以下能力：

- `param_collection` wait / resume
- `variable_assignment` 赋值与事件
- `selection / confirm_judge / end` 路径推进
- `terminate / retry / escalate`
- 自动重试与自动升级
- loop 强制终止

### 2. Extra Adapters 侧证据

已有明确 runtime 集成测试覆盖以下节点族：

- `audio_recognition`
- `ocr_recognition`
- `static_webpage_read`
- `graph_search`
- `image_search`
- `long_text_extraction`
- `intent_recognition`
- `similarity_match`

以及：

- `ai_ppt`
- `excel_read`
- `dynamic_chart`
- `file_slicing`
- `file_translation`
- `file_generation`

并且还有单独的 wait / resume 证据：

- `transaction_flow`
- `mcp`

### 3. Observability 侧证据

已有单独桥接测试覆盖以下事件：

- `node.completed`
- `variable.assigned`
- `node.waiting_input`
- `edge.transitioned`
- `instance.retry_requested`
- `instance.escalated`
- `instance.terminated`

## 八、当前 runtime 主线的更准确表述

截至 2026-04-23，当前 runtime 主线更准确的表述不是“只有引擎骨架”，而是：

1. 主服务入口层已经把 Web-AIGC route 面、runtime extra adapters 注册面、RAG 高风险动作共享依赖以及 workflow runtime 治理入口接到主线。
2. built-in 层已经具备对话、控制流、人工选择和结果收口的最小执行骨架。
3. extra adapters 层已经把一批 Web-AIGC 节点接入主线执行面。
4. wait / resume 层已经形成节点等待恢复与运行时控制恢复两层能力。
5. audit / observability 层已经把关键 runtime 事件镜像到 replay / audit。

因此，runtime 主线当前应被视为“已打通主服务入口并形成最小平台执行主干”，而不是“仍停留在概念阶段”。

## 九、后续建议

如果继续推进，建议不是继续补 runtime specs，而是围绕以下方向继续主线收口：

1. 扩大 extra adapters 的统一 runtime 证据面。
2. 继续把高风险节点并入统一 wait / resume / approval 口径。
3. 把更多节点输出级 `observability` 字段收进统一 runtime 事件镜像。
4. 继续补 lineage 与更完整的 telemetry 主线证据。

## 结论

当前 `web-aigc` runtime 主线已经形成一条可落地的“主线接线 + 节点族谱”：

- mainline wiring 负责把入口与共享依赖接到主服务
- built-in 负责执行骨架
- extra adapters 负责能力扩展
- wait / resume 负责控制恢复
- audit / observability 负责运行留痕

这意味着后续重点不再是“runtime 有没有”，而是“runtime 主线如何继续统一、治理和扩面”。

这是一份“主线接线后更新”检查点，不表示所有节点 observability 或治理接线已经完全统一。
