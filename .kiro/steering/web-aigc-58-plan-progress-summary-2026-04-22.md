# web-aigc 58 份 Plan / Specs 进度总结（2026-04-23）

## 统计口径

- 统计范围仅包含 `.kiro/specs` 目录下所有 `web-aigc-*` spec 的 `tasks.md`
- 仅统计 `tasks.md` 顶层 checklist，也就是行首的 `- [ ]` / `- [x]`
- 不统计缩进后的子任务，不统计 `requirements.md`、`design.md`、`status.md` 等说明文档
- 本版开始将“spec 完成度”和“主线增强进度”明确分开统计，避免两个阶段目标混在一起

## spec 完成度封板结果

- 总 spec 数：`58`
- 已完成 spec：`58`
- 部分完成 spec：`0`
- 未完成 spec：`0`
- 顶层任务完成数：`238 / 238`
- 顶层任务未完成数：`0`
- 顶层任务完成率：`100.00%`

相较于上一轮的 `55 done / 1 partial / 2 todo`，本轮最终收口完成了以下 3 份尾项：

- `web-aigc-platform-runtime-engine`
- `web-aigc-node-transaction_flow`
- `web-aigc-node-orchestration_recognition_jump`

这意味着 `web-aigc` 的 `58 / 58` 份 specs 已经全部完成，spec 维度的推进目标已经收口，不再作为下一阶段的核心进度指标。

## 分层统计

### 节点层

- spec 数：`52`
- 已完成 spec：`52`
- 部分完成 spec：`0`
- 未完成 spec：`0`
- 顶层任务完成数：`208 / 208`
- 顶层任务完成率：`100.00%`

### 平台层

- spec 数：`6`
- 已完成 spec：`6`
- 部分完成 spec：`0`
- 未完成 spec：`0`
- 顶层任务完成数：`30 / 30`
- 顶层任务完成率：`100.00%`

## 已形成的主线基线

当前不只是 `tasks.md` 已全部勾选，主仓还已经落下一批关键主线闭环，后续阶段将以这些闭环为基线继续增强。

### 已接入主服务入口的能力

- `ai-ppt`
- `dynamic-chart`
- `excel-read`
- `file-generation`
- `file-slicing`
- `file-translation`
- `mcp`
- `robot-reply`
- `open-page`
- `open-dashboard`
- `transaction-flow`
- `orchestration-recognition-jump`
- `web-search`
- `web-qa`
- `get-location-info`
- `get-device-info`
- `vector-update`
- `vector-delete`

补充校准：

- `open-report` 已通过 `server/routes/workflows.ts` 下的 `/api/workflows/open-report` 子路由接入主线，不是独立一级入口，但已经形成宿主动作可调用闭环。
- workflow runtime governance 已接入 `/api/workflows/:id/runtime/run`、`/api/workflows/:id/runtime/retry`、`/api/workflows/:id/runtime/escalate` 控制链路。
- RAG `vectorStore` 已由 `ragDeps` 暴露给 `/api/rag` 主路由、`/api/vector-update`、`/api/vector-delete` 与 `/api/rag/risk-actions`，不再只是底层依赖。

### 已接入 runtime extra adapters 的能力

- `knowledge_qa`
- `qa_search`
- `mcp`
- `web_search`
- `web_qa`
- `get_location_info`
- `get_device_info`
- `audio_recognition`
- `graph_search`
- `static_webpage_read`
- `intent_recognition`
- `long_text_extraction`
- `ai_ppt`
- `excel_read`
- `dynamic_chart`
- `image_search`
- `file_slicing`
- `file_generation`
- `file_translation`
- `ocr_recognition`
- `similarity_match`
- `transaction_flow`
- `orchestration_recognition_jump`

补充校准：

- 上述清单已覆盖主线中需要点名的 runtime extra adapters，包括知识检索、工具调用、环境信息、多模态识别、Office/content nodes 与高风险业务动作 nodes。
- 当前 runtime extra adapters 口径应理解为“已接入并可被统一注册到 `webAigcRuntimeEngine` 的节点能力集”，而不是仅限首批 Office 节点。

### 已补齐的尾项能力

- `platform-runtime-engine`
  - 运行时已形成实例级统一治理预算、统一退避与升级控制，以及 replay / audit 证据闭环
- `transaction_flow`
  - 已具备共享契约、审批闸门、审计日志、补偿说明、HTTP 路由、runtime wait / resume / advance 闭环
- `orchestration_recognition_jump`
  - 已具备目标编排识别、显式 jump 边校验、权限与审计校验、上下文继承、HTTP 路由、runtime 跳转闭环

### 新增主线接线事实

- `server/index.ts`
  - 已形成主服务入口挂载补全，新增并确认 `robot-reply`、`open-page`、`mcp`、`open-dashboard`、`web-search`、`web-qa`、`get-location-info`、`get-device-info`、`vector-update`、`vector-delete`
- `server/routes/workflows.ts`
  - 已挂载 `open-report` 子路由，并在 workflow 路由层承载 runtime governance 控制链路
- `RAG`
  - 已将 `vectorStore` 能力透出到健康检查、向量治理和风险动作路径，主线不再只是“可检索”，还具备向量状态可见性与写操作治理闭环

## 已完成的定向验证

### 节点与路由测试

```bash
node .\node_modules\vitest\vitest.mjs run --config vitest.config.server.ts \
  server/tests/ai-ppt-node-adapter.test.ts \
  server/tests/ai-ppt-routes.test.ts \
  server/tests/dynamic-chart-node-adapter.test.ts \
  server/tests/dynamic-chart-routes.test.ts \
  server/tests/excel-read-node-adapter.test.ts \
  server/tests/excel-read-routes.test.ts \
  server/tests/file-generation-node-adapter.test.ts \
  server/tests/file-generation-routes.test.ts \
  server/tests/file-slicing-node-adapter.test.ts \
  server/tests/file-slicing-routes.test.ts \
  server/tests/file-translation-node-adapter.test.ts \
  server/tests/file-translation-routes.test.ts \
  server/tests/transaction-flow-node-adapter.test.ts \
  server/tests/transaction-flow-routes.test.ts \
  server/tests/orchestration-recognition-jump-node-adapter.test.ts \
  server/tests/orchestration-recognition-jump-routes.test.ts
```

结果：全部通过

### runtime 定向集成测试

```bash
node .\node_modules\vitest\vitest.mjs run --config vitest.config.server.ts \
  server/tests/workflow-runtime-engine.test.ts \
  -t "executes ai_ppt, excel_read, dynamic_chart, file_slicing, file_translation, and file_generation through installed extra runtime adapters"

node .\node_modules\vitest\vitest.mjs run --config vitest.config.server.ts \
  server/tests/workflow-runtime-engine.test.ts \
  -t "waits and resumes transaction_flow nodes through installed extra runtime adapters"

node .\node_modules\vitest\vitest.mjs run --config vitest.config.server.ts \
  server/tests/workflow-runtime-engine.test.ts \
  -t "executes orchestration_recognition_jump through runtime extra adapters and inherits context"
```

结果：全部通过

### 向量治理与风险动作测试

```bash
node .\node_modules\vitest\vitest.mjs run --config vitest.config.server.ts \
  server/tests/vector-update-adapter.test.ts \
  server/tests/vector-delete-adapter.test.ts \
  server/tests/vector-update-routes.test.ts \
  server/tests/vector-delete-routes.test.ts \
  server/tests/web-aigc-risk-actions-routes.test.ts
```

结果：全部通过

## 口径切换

从本版开始，`web-aigc` 进度材料统一采用下面的阶段口径：

- `58 / 58` 份 specs 已全部完成，这是已经封板的历史结果
- 第二阶段与下一阶段不再以“再完成多少份 spec”为推进目标
- 后续推进重点改为“主线增强、主仓收口、治理补线、运行时归并、前端闭环、批次验证”

后续应重点观察的，不再是“还有多少 spec 未完成”，而是：

- `main` 主线新增了哪些可验证的闭环能力
- `server/index.ts`、`/api/workflows/*` 与 `/api/rag/*` 又新增了哪些已挂载、可验证的接线路径
- 治理、权限、审计、回放链路是否继续补齐
- 工具调用、运行时和控制流是否继续统一到同一套契约
- HITL、监控面板、Office 面板是否完成前后端联动闭环

## 当前结论

- `58 / 58` 份 web-aigc specs 已全部完成
- `238 / 238` 个顶层任务已全部勾选完成
- spec 完成度已经收口，不再作为下一阶段的主要推进指标
- 下一步推进的是主线增强与接线补全，而不是 spec 完成度
