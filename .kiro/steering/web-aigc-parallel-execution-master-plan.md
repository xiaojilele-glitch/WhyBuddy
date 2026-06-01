---
inclusion: manual
---

# Web-AIGC 58 Spec 并行执行总计划

## 文档目标

本文用于把当前保留的 `58` 个 `web-aigc` 迁移 spec，组织成一套可以真正并行推进的执行方案。

目标不是把 `58` 个 spec 同时散开乱做，而是：

- 尽可能提高并行度
- 尽量避免共享文件冲突
- 让多 Agent / 多工作流 / 多 worktree 可以稳定推进
- 让 `whybuddy` 在迁移过程中持续保持可集成、可回归、可收口

## 范围

当前范围固定为：

- `6` 个平台级 spec
- `52` 个节点级 spec

总计 `58` 个 spec 目录，每个目录包含：

- `requirements.md`
- `design.md`
- `tasks.md`

## 一页结论

结论先说清楚：

1. 这 `58` 个 spec 可以并行做。
2. 但不能按 `58` 个单点同时编码。
3. 正确方式是“平台先收口一轮，节点按能力簇并行，最后集中联调与治理补齐”。
4. 对于一台 `20` 核、`32G` 内存的机器，推荐：
   - 文档 / 设计阶段并发：`10 - 12` 个 Agent
   - 骨架编码阶段并发：`8 - 10` 个 Agent
   - 集成联调阶段并发：`3 - 4` 个 Agent
5. 夜间自动推进时，最理想的组织方式是：
   - `1` 个主控 Agent
   - `3` 个平台 Agent
   - `6` 个节点能力簇 Agent
   - `1` 个集成 / 回归 Agent

换句话说：

- 不是 `58` 个 Agent 一起冲
- 而是 `10 - 11` 个有边界的 Agent 并行推进

## 基本判断

### 真实结构不是 58 个“节点”

当前保留集合其实是：

- `52` 个节点 spec
- `6` 个平台 spec

所以执行时必须区分：

- 平台骨架
- 节点能力
- 高风险动作
- 最终集成与治理

### 扩展性来自统一执行骨架，而不是 spec 数量

真正的扩展性来自以下 6 个统一点：

- 统一领域模型
- 统一节点输入输出契约
- 统一图运行时状态机
- 统一实例 / 会话 / 任务投影
- 统一 replay / audit / lineage
- 统一 permissions / security gate

如果这些不先收口，哪怕并行写了很多节点，也只会形成一堆局部实现。

## 当前代码层高冲突区域

以下文件或模块属于并行期的共享热点，必须严格控制 ownership：

- `shared/workflow-runtime.ts`
- `shared/workflow-kernel.ts`
- `shared/workflow-input.ts`
- `shared/mission/contracts.ts`
- `shared/audit/contracts.ts`
- `shared/permission/contracts.ts`
- `server/core/workflow-engine.ts`
- `server/core/mission-orchestrator.ts`
- `server/routes/workflows.ts`
- `server/routes/tasks.ts`
- `server/routes/replay.ts`
- `server/routes/audit.ts`
- `server/routes/permissions.ts`
- `server/routes/lineage.ts`
- `server/routes/rag.ts`
- `server/routes/knowledge.ts`
- `server/routes/voice.ts`
- `server/routes/vision.ts`
- `server/routes/a2a.ts`

执行原则：

1. 上述文件必须单写者优先，不允许多个 Agent 同时直接改同一热点文件。
2. 节点适配优先向外围新增模块扩展，尽量减少反复改内核。
3. 所有共享契约改动先经过平台主干收口，再放给节点 Agent 跟进。

## 推荐总并发度

按当前机器配置和仓库体量，推荐如下：

| 阶段 | 推荐并发 | 说明 |
| --- | --- | --- |
| 文档归一 | 10-12 Agent | CPU 压力低，可高并发 |
| 接口与契约设计 | 6-8 Agent | 开始有共享定义，需主控收口 |
| 骨架编码 | 8-10 Agent | 并发高但必须分 ownership |
| 联调集成 | 3-4 Agent | 需要顺序收敛 |
| 回归 / 收尾 | 2-3 Agent | 统一补测试和治理 |

实际夜间建议：

- 同时活跃编码 Agent 不超过 `8`
- 同时跑中大型测试进程不超过 `3`
- 保留 `1` 个主控 / 集成 Agent 不写功能，只做收口、合并、冲突排查、回归推进

## 多 Agent 总编组

建议使用 `11` 条工作流。

### Agent 0：总控与收口

负责：

- 全局节奏控制
- Gate 决策
- 共享契约收口
- 冲突协调
- 最终合并顺序

只拥有以下写入权：

- `.kiro/steering/*`
- 平台共享约束文档
- 必要时协调改动热点文件

### Agent 1：平台主干 A

负责：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`

建议 ownership：

- `shared/workflow-runtime.ts`
- `shared/workflow-kernel.ts`
- `server/core/workflow-engine.ts`
- `server/routes/workflows.ts`

说明：

- 这是整个并行体系的中轴
- 所有节点适配都依赖这里的 runtime contract

### Agent 2：平台主干 B

负责：

- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`

建议 ownership：

- `shared/workflow-input.ts`
- `shared/mission/contracts.ts`
- `server/tasks/*`
- `server/memory/session-store.ts`
- `server/routes/tasks.ts`

说明：

- 专门处理 graph instance → mission / session 的投影与恢复
- 为 HITL、会话查看、实例恢复提供统一承接层

### Agent 3：平台主干 C

负责：

- `web-aigc-platform-observability-audit`
- `web-aigc-platform-security-governance`

建议 ownership：

- `shared/audit/*`
- `shared/permission/*`
- `server/audit/*`
- `server/permission/*`
- `server/routes/audit.ts`
- `server/routes/permissions.ts`
- `server/routes/lineage.ts`
- `server/routes/replay.ts`

说明：

- 所有高风险节点最终都要挂到这里
- 它是高风险动作上线前的必要门禁

### Agent 4：对话与问答能力簇

负责：

- `web-aigc-node-dialogue`
- `web-aigc-node-robot_reply`
- `web-aigc-node-knowledge_qa`
- `web-aigc-node-web_qa`
- `web-aigc-node-llm`

建议 ownership：

- `server/routes/chat.ts`
- `server/routes/knowledge.ts`
- `server/routes/rag.ts`
- 对应 node adapter 新目录

### Agent 5：人工输入与会话分支能力簇

负责：

- `web-aigc-node-user_input`
- `web-aigc-node-selection`
- `web-aigc-node-confirm_judge`
- `web-aigc-node-param_collection`
- `web-aigc-node-intent_recognition`
- `web-aigc-node-command_list`
- `web-aigc-node-recommended_commands`

建议 ownership：

- `server/routes/tasks.ts` 下的扩展子模块
- `client/src/components/tasks/*`
- `client/src/lib/tasks-store.ts`
- 对应 node adapter 新目录

说明：

- 这个 Agent 与平台主干 B 关系最紧
- 但尽量不要直接抢写 `server/routes/tasks.ts` 主文件，优先抽子模块

### Agent 6：检索与内容处理能力簇

负责：

- `web-aigc-node-document_search`
- `web-aigc-node-fragment_search`
- `web-aigc-node-graph_search`
- `web-aigc-node-web_search`
- `web-aigc-node-qa_search`
- `web-aigc-node-long_text_extraction`
- `web-aigc-node-file_slicing`
- `web-aigc-node-file_translation`
- `web-aigc-node-excel_read`
- `web-aigc-node-static_webpage_read`
- `web-aigc-node-file_generation`
- `web-aigc-node-similarity_match`

建议 ownership：

- `server/routes/rag.ts`
- `server/routes/knowledge.ts`
- 内容处理相关新模块

### Agent 7：多模态与输出能力簇

负责：

- `web-aigc-node-audio_recognition`
- `web-aigc-node-ocr_recognition`
- `web-aigc-node-image_search`
- `web-aigc-node-ai_ppt`
- `web-aigc-node-dynamic_chart`

建议 ownership：

- `server/routes/voice.ts`
- `server/routes/vision.ts`
- artifact / output adapter 新模块

### Agent 8：工具、Agent 与外部调用能力簇

负责：

- `web-aigc-node-mcp`
- `web-aigc-node-auto_agent`
- `web-aigc-node-internal_api`
- `web-aigc-node-passthrough_api`
- `web-aigc-node-message_notification`

建议 ownership：

- `server/routes/a2a.ts`
- `server/routes/skills.ts`
- `server/routes/guest-agents.ts`
- tool / api adapter 新模块

说明：

- 这一组价值高，但风险也高
- 必须在平台主干 C 的安全与审计钩子就位后再大规模推进

### Agent 9：控制流与图中台能力簇

负责：

- `web-aigc-node-start`
- `web-aigc-node-end`
- `web-aigc-node-condition`
- `web-aigc-node-loop`
- `web-aigc-node-flow_jump`
- `web-aigc-node-variable_assignment`
- `web-aigc-node-format_output`
- `web-aigc-node-orchestration_recognition_jump`

建议 ownership：

- 图 runtime adapter 层
- 条件解析与 edge transition 子模块

说明：

- 这组不能早于平台主干 A
- 它会频繁碰到 runtime transition 语义，必须与 Agent 1 对齐

### Agent 10：高风险写操作与宿主动作能力簇

负责：

- `web-aigc-node-vector_query`
- `web-aigc-node-vector_insert`
- `web-aigc-node-vector_update`
- `web-aigc-node-vector_delete`
- `web-aigc-node-transaction_flow`
- `web-aigc-node-open_page`
- `web-aigc-node-open_report`
- `web-aigc-node-open_dashboard`
- `web-aigc-node-get_device_info`
- `web-aigc-node-get_location_info`

建议 ownership：

- `server/memory/vector-store.ts`
- `server/routes/rag.ts`
- 前端宿主动作适配模块
- 风险动作 / 事务动作适配模块

说明：

- 这是最不适合第一波大规模并发编码的组
- 必须等安全、审计、权限、实例态、回放链都稳定后再推

## 执行波次

建议分 `5` 波推进。

### Wave 0：契约冻结波

目标：

- 冻结最核心的命名、状态、实例、事件、审计挂接关系

包含：

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`

并发建议：

- `2 - 3` Agent

通过标准：

- graph definition / version / instance / node execution / edge transition / operator action 术语统一
- runtime 最小输入输出契约形成文档
- 节点适配器最小接口固定

### Wave 1：最小可运行闭环波

目标：

- 跑通一条真正可演示的 graph-capable runtime 闭环

包含：

- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`
- `web-aigc-node-dialogue`
- `web-aigc-node-knowledge_qa`
- `web-aigc-node-user_input`
- `web-aigc-node-selection`
- `web-aigc-node-confirm_judge`
- `web-aigc-node-mcp`
- `web-aigc-node-vector_query`
- `web-aigc-node-audio_recognition`
- `web-aigc-node-ocr_recognition`

并发建议：

- `5 - 6` Agent

通过标准：

- 能启动图实例
- 能进入等待输入
- 能恢复继续执行
- 能看到节点级执行记录
- 能把图实例投影到 mission / session

### Wave 2：高价值能力扩展波

目标：

- 扩充第一批真正有用户价值的节点家族

包含：

- `web-aigc-node-robot_reply`
- `web-aigc-node-web_qa`
- `web-aigc-node-llm`
- `web-aigc-node-param_collection`
- `web-aigc-node-intent_recognition`
- `web-aigc-node-command_list`
- `web-aigc-node-recommended_commands`
- `web-aigc-node-auto_agent`
- `web-aigc-node-document_search`
- `web-aigc-node-fragment_search`
- `web-aigc-node-graph_search`
- `web-aigc-node-web_search`
- `web-aigc-node-qa_search`
- `web-aigc-node-long_text_extraction`
- `web-aigc-node-file_slicing`
- `web-aigc-node-file_translation`
- `web-aigc-node-excel_read`
- `web-aigc-node-static_webpage_read`
- `web-aigc-node-file_generation`
- `web-aigc-node-similarity_match`
- `web-aigc-node-image_search`
- `web-aigc-node-ai_ppt`
- `web-aigc-node-dynamic_chart`

并发建议：

- `6 - 8` Agent

通过标准：

- 节点适配方式统一
- 输入输出契约可复用
- 结果可进入 replay / audit / artifact 体系

### Wave 3：控制流与平台语义增强波

目标：

- 补齐图平台真正的平台语义，而不是只停留在工具调用集合

包含：

- `web-aigc-node-start`
- `web-aigc-node-end`
- `web-aigc-node-condition`
- `web-aigc-node-loop`
- `web-aigc-node-flow_jump`
- `web-aigc-node-variable_assignment`
- `web-aigc-node-format_output`
- `web-aigc-node-orchestration_recognition_jump`
- `web-aigc-platform-observability-audit`
- `web-aigc-platform-security-governance`

并发建议：

- `4 - 5` Agent

通过标准：

- 条件跳转语义稳定
- loop 与 branch 可回放
- audit / lineage / replay 可关联到 graph instance 和 node execution

### Wave 4：高风险动作与宿主集成波

目标：

- 补齐高风险写操作和宿主动作节点

包含：

- `web-aigc-node-internal_api`
- `web-aigc-node-passthrough_api`
- `web-aigc-node-message_notification`
- `web-aigc-node-vector_insert`
- `web-aigc-node-vector_update`
- `web-aigc-node-vector_delete`
- `web-aigc-node-transaction_flow`
- `web-aigc-node-open_page`
- `web-aigc-node-open_report`
- `web-aigc-node-open_dashboard`
- `web-aigc-node-get_device_info`
- `web-aigc-node-get_location_info`

并发建议：

- `2 - 3` Agent

通过标准：

- 所有写操作都有 permission check
- 所有高风险动作都有 audit trail
- 宿主页面动作不会破坏主壳导航与任务上下文

## 58 Spec 分配矩阵

| 工作流 | spec 列表 | 推荐阶段 |
| --- | --- | --- |
| 平台 A | `web-aigc-platform-domain-model`、`web-aigc-platform-runtime-engine` | Wave 0 |
| 平台 B | `web-aigc-platform-mission-projection`、`web-aigc-platform-session-instance` | Wave 1 |
| 平台 C | `web-aigc-platform-observability-audit`、`web-aigc-platform-security-governance` | Wave 3 |
| 对话问答 | `web-aigc-node-dialogue`、`web-aigc-node-robot_reply`、`web-aigc-node-knowledge_qa`、`web-aigc-node-web_qa`、`web-aigc-node-llm` | Wave 1-2 |
| 人工输入 | `web-aigc-node-user_input`、`web-aigc-node-selection`、`web-aigc-node-confirm_judge`、`web-aigc-node-param_collection`、`web-aigc-node-intent_recognition`、`web-aigc-node-command_list`、`web-aigc-node-recommended_commands` | Wave 1-2 |
| 检索内容 | `web-aigc-node-document_search`、`web-aigc-node-fragment_search`、`web-aigc-node-graph_search`、`web-aigc-node-web_search`、`web-aigc-node-qa_search`、`web-aigc-node-long_text_extraction`、`web-aigc-node-file_slicing`、`web-aigc-node-file_translation`、`web-aigc-node-excel_read`、`web-aigc-node-static_webpage_read`、`web-aigc-node-file_generation`、`web-aigc-node-similarity_match` | Wave 2 |
| 多模态输出 | `web-aigc-node-audio_recognition`、`web-aigc-node-ocr_recognition`、`web-aigc-node-image_search`、`web-aigc-node-ai_ppt`、`web-aigc-node-dynamic_chart` | Wave 1-2 |
| 工具集成 | `web-aigc-node-mcp`、`web-aigc-node-auto_agent`、`web-aigc-node-internal_api`、`web-aigc-node-passthrough_api`、`web-aigc-node-message_notification` | Wave 1 / 4 |
| 流程控制 | `web-aigc-node-start`、`web-aigc-node-end`、`web-aigc-node-condition`、`web-aigc-node-loop`、`web-aigc-node-flow_jump`、`web-aigc-node-variable_assignment`、`web-aigc-node-format_output`、`web-aigc-node-orchestration_recognition_jump` | Wave 3 |
| 向量与宿主动作 | `web-aigc-node-vector_query`、`web-aigc-node-vector_insert`、`web-aigc-node-vector_update`、`web-aigc-node-vector_delete`、`web-aigc-node-transaction_flow`、`web-aigc-node-open_page`、`web-aigc-node-open_report`、`web-aigc-node-open_dashboard`、`web-aigc-node-get_device_info`、`web-aigc-node-get_location_info` | Wave 1 / 4 |

## Gate 机制

必须设置 `6` 个 gate。

### Gate G0：术语与契约冻结

必须满足：

- 统一 graph / version / instance / node record / edge transition 命名
- 统一状态枚举
- 统一最小 adapter contract

### Gate G1：Runtime Kernel 可被节点调用

必须满足：

- 节点可通过统一接口被调度
- 节点执行结果有标准结果结构
- 错误与等待态有标准状态表示

### Gate G2：Mission / Session 投影打通

必须满足：

- graph instance 与 mission record 可建立双向映射
- waiting_input / resume 与 session 可挂接

### Gate G3：审计与权限门禁打通

必须满足：

- 高风险节点不允许裸奔
- replay / audit / lineage 至少形成最小关联

### Gate G4：节点批量接入稳定

必须满足：

- 能连续接入多个能力簇节点而不反复改 runtime 核心
- adapter 扩展方式被验证

### Gate G5：整体验证收口

必须满足：

- 端到端 smoke 跑通
- 至少一条图闭环可回放、可审计、可恢复
- 节点失败、等待、恢复路径都能解释

## 分支与 worktree 策略

推荐每个 Agent 独立 worktree，不共用同一工作目录。

命名建议：

- `worktrees/web-aigc-main-control`
- `worktrees/web-aigc-platform-a`
- `worktrees/web-aigc-platform-b`
- `worktrees/web-aigc-platform-c`
- `worktrees/web-aigc-dialogue`
- `worktrees/web-aigc-hitl`
- `worktrees/web-aigc-content`
- `worktrees/web-aigc-multimodal`
- `worktrees/web-aigc-tools`
- `worktrees/web-aigc-controlflow`
- `worktrees/web-aigc-risk-actions`

分支建议：

- `feat/web-aigc-platform-a`
- `feat/web-aigc-platform-b`
- `feat/web-aigc-platform-c`
- `feat/web-aigc-node-dialogue`
- `feat/web-aigc-node-hitl`
- `feat/web-aigc-node-content`
- `feat/web-aigc-node-multimodal`
- `feat/web-aigc-node-tools`
- `feat/web-aigc-node-controlflow`
- `feat/web-aigc-node-risk-actions`

## Ownership 规则

所有 Agent 统一遵守：

1. 不允许随意改别人 ownership 内的热点文件。
2. 需要改共享契约时，先提交给平台主干 Agent 收口。
3. 节点 Agent 优先新增 adapter / service / mapper，不直接重写内核。
4. UI Agent 不允许反向定义 runtime contract。
5. 高风险节点没有 permissions / audit 接口前，不允许标记为完成。

## 夜间推进顺序

如果按“你先去睡觉，我这边继续排兵布阵”的方式执行，推荐顺序如下：

### 第 1 小时

- Agent 0 固定术语与 gate
- Agent 1 收口 domain model 与 runtime kernel
- Agent 2 收口 mission / session / instance 模型
- Agent 3 收口 audit / permission / lineage 接入点

### 第 2 到 4 小时

- Agent 4 跑通 dialogue / knowledge_qa / llm
- Agent 5 跑通 user_input / selection / confirm_judge
- Agent 7 跑通 audio / ocr
- Agent 8 跑通 mcp / auto_agent 最小链路
- Agent 10 跑通 vector_query 读路径

### 第 5 到 7 小时

- Agent 6 扩展 document / fragment / graph / web / qa 检索
- Agent 5 扩展 param_collection / intent / command 系列
- Agent 7 扩展 image_search / ai_ppt / dynamic_chart
- Agent 9 进入 start / end / condition / format_output

### 第 8 小时以后

- Agent 3 开启 observability / governance 深化
- Agent 9 进入 loop / flow_jump / orchestration_recognition_jump
- Agent 10 低并发推进 vector 写路径与 transaction_flow
- Agent 8 低并发推进 internal_api / passthrough_api / notification

## 每日同步节奏

建议固定 4 个时间点同步：

- `09:30`：确认当天 gate 和 owner 不变更
- `13:30`：同步共享契约变化
- `18:30`：决定是否放行下一波节点
- `23:30`：收口合并、安排夜间 Agent 任务

每次同步必须回答 5 个问题：

1. 哪些共享契约今天变了
2. 哪些热点文件今天有冲突风险
3. 哪些 spec 已进入“可联调”状态
4. 哪些节点仍被平台 gate 卡住
5. 下一波哪些 Agent 可以无阻塞推进

## 完成标准

这 58 个 spec 的并行执行，不以“文档都写完”作为完成，而以以下结果作为完成：

1. 平台级 6 个 spec 都有明确承接实现位。
2. 至少一条从 graph instance 到 mission / session / replay / audit 的闭环跑通。
3. 至少 `20+` 个高价值节点可以用统一 adapter 方式接入。
4. 高风险节点都有权限、审计、回放解释能力。
5. 后续再加新节点时，不需要重新发明一套运行时。

## 最终建议

如果目标是“今晚开始并行推进”，最优策略不是一次开 `58` 条线程，而是：

- 先开 `3` 条平台主干线程
- 再开 `5 - 6` 条节点能力簇线程
- 留 `1` 条线程专门做集成与回归

即：

- 总活跃 Agent：`9 - 11`
- 强编码并发：`8` 左右
- 高风险并发：`2 - 3`

这是在当前仓库结构和机器资源下，最激进但仍然可控的并行方案。
