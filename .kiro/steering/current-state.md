---
inclusion: auto
---

# WhyBuddy — 项目上下文总纲

> 本文件是唯一的"当前在哪"索引。AI 助手收到任何指令时，优先读本文件定位上下文。
> 最后更新：2026-05-21 | Specs: 275 | 完成率: 97.6%

---

## 1. 产品主线

```
Project-first AI 自动驾驶操作系统
  创建项目 → 项目问答与澄清 → Spec 演化 → FSD 路线规划 → 角色执行 → 证据沉淀
```

**核心原则：**
- 用户看**项目**，不看节点。用户看**路线**，不看 DAG。
- 50+ AIGC 节点是 FSD 角色内置能力，不作为独立入口。
- Workflow / Docker / Browser Runtime 是执行承载，不是产品主对象。
- 底层保留 `Mission / Workflow / Runtime / Audit / Replay`，不大规模重命名。

---

## 2. 全局数字

| 维度 | 数值 |
| ---- | ---- |
| Spec 目录总数 | 275 |
| 已完成 (done) | 241 |
| 部分完成 (partial) | 7 |
| 未开始 (todo) | 26 |
| 总 checklist 项 | 8218 |
| 已勾选 | 8018 |
| 整体完成率 | 97.6% |

---

## 3. Specs 全景索引（按功能域分组）

### 3.1 Web-AIGC 节点（52 specs）— ✅ 100% 封板

52 个图编排节点，全部 done。封板时间 2026-04-23。

<details><summary>展开完整列表</summary>

| Spec | 说明 |
| ---- | ---- |
| web-aigc-node-start | 开始节点 |
| web-aigc-node-end | 结束节点 |
| web-aigc-node-condition | 条件节点 |
| web-aigc-node-loop | 循环节点 |
| web-aigc-node-flow_jump | 流程跳转 |
| web-aigc-node-variable_assignment | 变量赋值 |
| web-aigc-node-format_output | 格式化输出 |
| web-aigc-node-dialogue | 对话节点 |
| web-aigc-node-robot_reply | 机器人回复 |
| web-aigc-node-knowledge_qa | 知识问答 |
| web-aigc-node-web_qa | 网页问答 |
| web-aigc-node-llm | LLM 节点 |
| web-aigc-node-user_input | 用户输入 |
| web-aigc-node-selection | 选择节点 |
| web-aigc-node-confirm_judge | 确认判断 |
| web-aigc-node-param_collection | 参数采集 |
| web-aigc-node-intent_recognition | 意图识别 |
| web-aigc-node-command_list | 命令列表 |
| web-aigc-node-recommended_commands | 推荐命令 |
| web-aigc-node-mcp | MCP 节点 |
| web-aigc-node-auto_agent | 自动代理 |
| web-aigc-node-internal_api | 内部接口 |
| web-aigc-node-passthrough_api | 透传接口 |
| web-aigc-node-message_notification | 消息通知 |
| web-aigc-node-document_search | 文档检索 |
| web-aigc-node-fragment_search | 片段检索 |
| web-aigc-node-graph_search | 图谱检索 |
| web-aigc-node-web_search | 网页搜索 |
| web-aigc-node-qa_search | 问答检索 |
| web-aigc-node-long_text_extraction | 长文本提取 |
| web-aigc-node-file_slicing | 文件切片 |
| web-aigc-node-file_translation | 文件翻译 |
| web-aigc-node-excel_read | Excel 读取 |
| web-aigc-node-static_webpage_read | 静态网页读取 |
| web-aigc-node-file_generation | 文件生成 |
| web-aigc-node-similarity_match | 相似匹配 |
| web-aigc-node-audio_recognition | 语音识别 |
| web-aigc-node-ocr_recognition | OCR 识别 |
| web-aigc-node-image_search | 图片检索 |
| web-aigc-node-ai_ppt | AI PPT |
| web-aigc-node-dynamic_chart | 动态图表 |
| web-aigc-node-vector_query | 向量查询 |
| web-aigc-node-vector_insert | 向量插入 |
| web-aigc-node-vector_update | 向量更新 |
| web-aigc-node-vector_delete | 向量删除 |
| web-aigc-node-open_page | 打开页面 |
| web-aigc-node-open_report | 打开报告 |
| web-aigc-node-open_dashboard | 打开看板 |
| web-aigc-node-get_device_info | 获取设备信息 |
| web-aigc-node-get_location_info | 获取位置信息 |
| web-aigc-node-transaction_flow | 事务流程 |
| web-aigc-node-orchestration_recognition_jump | 编排识别跳转 |

</details>

### 3.2 Web-AIGC 平台（6 specs）— ✅ 100% 封板

| Spec | 说明 |
| ---- | ---- |
| web-aigc-platform-domain-model | 领域模型 |
| web-aigc-platform-runtime-engine | 运行时引擎 |
| web-aigc-platform-mission-projection | 任务投影 |
| web-aigc-platform-session-instance | 实例与会话 |
| web-aigc-platform-observability-audit | 可观测与审计 |
| web-aigc-platform-security-governance | 安全与治理 |

### 3.3 Blueprint（13 specs）— ✅ 100% 封板

| Spec | 说明 |
| ---- | ---- |
| blueprint-domain-and-asset-store | 领域与资产存储 |
| blueprint-generation-api-and-job-contract | 生成 API 与 Job 契约 |
| blueprint-clarification-workflow | 澄清工作流 |
| blueprint-spec-document-generator | Spec 文档生成器 |
| blueprint-spec-tree-workbench | Spec 树工作台 |
| blueprint-agent-crew-fabric | Agent Crew 编组 |
| blueprint-autopilot-route-orchestrator | 路线编排器 |
| blueprint-effect-preview-generator | 效果预览生成器 |
| blueprint-engineering-landing-bridge | 工程落地桥 |
| blueprint-implementation-prompt-packager | 实现 Prompt 打包器 |
| blueprint-input-github-ingestion | GitHub 输入摄取 |
| blueprint-runtime-capability-bridge | 运行时能力桥 |
| blueprint-artifact-memory-and-replay | 产物记忆与回放 |

### 3.4 Project-first（10 specs）— ✅ 100% 封板

| Spec | 说明 |
| ---- | ---- |
| project-first-product-architecture | 产品架构总纲 |
| project-domain-model | 项目领域模型 |
| project-cockpit-home | 项目驾驶舱首页 |
| project-scoped-composer | 项目级发起器 |
| project-clarification-conversation | 项目澄清对话 |
| project-execution-center | 项目执行中心 |
| project-spec-center | 项目 Spec 中心 |
| project-fsd-route-planner | FSD 路线规划器 |
| project-evidence-artifact-replay | 项目证据与回放 |
| project-autopilot-blueprint-master | Autopilot 蓝图总规 |

### 3.5 Autopilot 系列（63 specs）— 100% 封板

**60 done / 0 partial / 3 todo**

#### 新完成（本轮从 partial 升级为 done，10 个）：

| Spec | 进度 | 说明 |
| ---- | ---- | ---- |
| autopilot-llm-spec-generation | 66/66 | LLM spec 生成管线 |
| autopilot-right-rail-narrative-swiper | 37/37 | 右栏叙事滑块 |
| autopilot-stage-progress-indicator | 24/24 | 阶段进度指示器 |
| autopilot-streaming-doc-renderer | 22/22 | 流式文档渲染 |
| autopilot-mirofish-card-diversity | 21/21 | Mirofish 卡片多样性 |
| autopilot-workbench-stage-rhythm | 18/18 | 工作台阶段节奏 |
| autopilot-streaming-lifecycle-weave | 18/18 | 流式生命周期编织 |
| autopilot-llm-react-loop-inline | 13/13 | LLM React 循环内联 |
| autopilot-blueprint-refactor-split | 4/4 | Blueprint 重构拆分 |
| autopilot-capability-bridge-runtime-panel | 16/16 | 能力桥运行时面板 |

#### 未启动（todo）：

- `autopilot-agent-crew-stage-activation`（20 项）
- `autopilot-spec-tree-workbench`（12 项）
- `autopilot-3d-hud-workbench-sync`（无 tasks.md）

#### 已完成（50 个，略）：

包含 capability bridges、cockpit 布局、destination/route/fleet/takeover/evidence 前端体验、LLM 管线（spec-tree/spec-documents/prompt-package/effect-preview/engineering-handoff/routeset）、streaming 体验、role container loader、runtime orchestration 等。

### 3.6 UI Redesign（11 specs）— ✅ 100% 封板

| Spec | 进度 | 状态 |
| ---- | ---- | ---- |
| ui-redesign-color-and-tokens | 51/51 | done |
| ui-redesign-sidebar-navigation | 51/51 | done |
| ui-redesign-task-detail-cards | 50/50 | done |
| ui-redesign-launch-panel | 44/44 | done |
| ui-redesign-right-info-panel | 42/42 | done |
| ui-redesign-scene-adaptation | 42/42 | done |
| ui-redesign-responsive-regression | 32/32 | done |
| ui-redesign-status-indicators | 17/17 | done |
| ui-redesign-composer-only-center-input | 36/36 | done |
| ui-redesign-home-cockpit-shell-convergence | 24/24 | done |
| ui-redesign-task-center-workbench-tabs | 29/29 | done |

### 3.7 核心体验与办公室主线（partial 重点）

| Spec | 进度 | 说明 |
| ---- | ---- | ---- |
| task-runtime-visibility-v1 | 118/118 | done |
| nl-command-center | 104/104 | done |
| launch-panel-visual-overhaul | 65/65 | done |
| office-wall-display-redesign-v2 | 41/41 | done |
| office-home-performance-stability | 32/32 | done |
| launch-operator-surface-convergence | 31/31 | done |
| intelligent-launch-convergence | 29/29 | done |
| task-os-home-redesign-v1 | 30/30 | done |
| release-stability-guardrails-v2 | 35/35 | done |
| office-shell-convergence-v1 | 28/28 | done |
| office-task-cockpit | 21/21 | done |
| office-cockpit-first-screen-refresh | 18/18 | done |
| mission-runtime | 74/74 | done |
| state-persistence-recovery | 36/36 | done |
| mission-cancel-control | 35/35 | done |
| cross-framework-export | 30/30 | done |

### 3.8 UE (Unreal Engine)（20 specs）— 32.3%，远期

**5 done / 1 partial / 14 todo**

已完成：`ue-local-streaming-runtime`、`ue-office-scene-build`、`ue-pet-character-system`、`ue-scene-command-protocol`、`ue-video-stream-player`

未启动（14 个）：camera-system、director-prompt、event-callback、fallback-degradation、interaction-passthrough、local-resource-governance、mobile-lite-viewer、multi-user-session、performance-profiling、realtime-narration、recording-replay-export、scene-asset-pipeline、shot-list-planner、state-sync-bridge

### 3.9 平台级远期（全部 todo）

| Spec | 任务项 |
| ---- | ------ |
| production-deployment | 30 |
| multi-user-office | 54 |
| multi-tenant-architecture | 58 |
| multi-region-disaster-recovery | 59 |
| k8s-agent-operator | 63 |
| edge-brain-deployment | 87 |
| agent-marketplace-platform | 87 |
| vr-extension | 75 |
| i18n-cleanup | 30 |
| admin-audit-and-support-operations | 15 |

### 3.10 其他已完成（核心基座 + 独立能力）

<details><summary>展开完整列表（61 done）</summary>

| Spec | 说明 |
| ---- | ---- |
| workflow-engine | 十阶段工作流引擎 |
| dynamic-organization | 动态组织生成 |
| memory-system | 三级记忆系统 |
| evolution-heartbeat | 自进化与心跳 |
| mission-runtime | Mission 任务域（partial，66/74） |
| feishu-bridge | 飞书集成 |
| browser-runtime | 纯前端运行时 |
| frontend-3d | 3D 场景与前端 |
| mission-native-projection | Mission 原生投影 |
| workflow-decoupling | Workflow 解耦 |
| mission-operator-actions | 任务操作动作栏 |
| human-in-the-loop | 人工审批流 |
| plugin-skill-system | Skill 热插拔 |
| dynamic-role-system | 动态角色系统 |
| agent-autonomy-upgrade | Agent 自治升级 |
| agent-reputation | Agent 信誉评分 |
| agent-permission-model | Agent 权限矩阵 |
| knowledge-graph | 知识图谱 |
| vector-db-rag-pipeline | 向量 DB + RAG |
| data-lineage-tracking | 数据血缘追踪 |
| audit-chain | 不可篡改审计链 |
| cost-observability | 成本可观测性 |
| cost-governance-strategy | 成本治理策略 |
| telemetry-dashboard | 实时遥测仪表盘 |
| lobster-executor-real | Docker 真实容器 |
| secure-sandbox | 安全沙箱 |
| sandbox-live-preview | 容器实时预览 |
| ai-enabled-sandbox | AI 容器注入 |
| executor-integration | 执行器集成 |
| a2a-protocol | A2A 互操作协议 |
| autonomous-swarm | 跨 Pod 自主协作 |
| agent-marketplace | Guest Agent 市场 |
| cross-framework-export | 跨框架导出（partial，21/30） |
| multi-modal-vision | 多模态视觉（partial，36/37） |
| multi-modal-agent | 多模态编排 |
| nl-command-center | 自然语言指挥中心（partial，103/104） |
| collaboration-replay | 协作回放 |
| demo-data-engine | 预录演示数据 |
| demo-guided-experience | 演示引导体验 |
| scene-mission-fusion | 3D Mission 融合 |
| holographic-ui | 全息 UI |
| navigation-convergence | 导航收口（partial，14/16） |
| task-hub-convergence | 任务中台收口（partial，14/16） |
| api-fallback-empty-states | API 兜底与空态 |
| workspace-visual-unification | 视觉统一 |
| office-wall-display-redesign | 墙面显示器 v1 |
| sandbox-native-executor-compat | Native 执行器兼容 |
| skill-aware-agent-sandbox | Skill 感知沙箱 |
| cube-ai-agent-sandbox-image | AI Agent 沙箱镜像 |
| docker-executor-capabilities-contract | Docker 执行器能力契约 |
| browser-artifact-preview-runtime | 浏览器产物预览 |
| lightweight-mysql-redis-persistence-strategy | 轻量持久化策略 |
| personal-project-ownership-and-isolation | 个人项目隔离 |
| admin-console-and-global-role-gate | Admin 控制台 |
| consumer-email-auth-and-account | 邮箱认证（partial，12/14） |
| task-autopilot-platform-positioning | 自动驾驶定位 |
| task-autopilot-core-concepts | 核心概念 |
| task-autopilot-levels-l1-to-l5 | L1-L5 分级 |
| task-autopilot-success-metrics | 成功度量 |
| destination-model-and-parser | Destination 模型 |
| destination-card-and-goal-summary | 目的地卡片 |
| route-planner-and-route-model | 路线规划器 |
| route-recommendation-and-selection | 路线推荐 |
| drive-state-and-replan-state-machine | 驾驶状态机 |
| fleet-organization-and-role-packaging | 车队组织 |
| fleet-status-and-live-execution-view | 车队状态 |
| takeover-panel-and-decision-points | 接管面板 |
| mission-model-to-autopilot-model-mapping | 模型映射 |

</details>

---

## 4. 系统架构（分层视图）

### 4.1 八层架构

```
┌─ 用户访问层 ─────────────────────────────────────────────────────────┐
│  Web 浏览器 (React SPA) · 移动端(未来) · 飞书/Relay · 桌面应用(未来)  │
├─ 前端层 ── Office Shell + Project Cockpit + Mission Cockpit ─────────┤
│  Office shell · Project cockpit · Task queue · Unified launch        │
│  Detail+drive (autopilot panel) · Scene3D (主场景/HUD)               │
│  History/Reports/DAG · Overlays · Browser RT (IndexedDB)             │
├─ 项目工作区层 (Project Workspace Layer) ─────────────────────────────┤
│  Project selector · Project context · Goal intake · Clarification    │
│  Spec center · Artifact graph · Route cockpit                        │
├─ Cube Brain (服务端) ────────────────────────────────────────────────┤
│  Express API (REST+Socket.IO) · Dynamic org · 10-stage engine        │
│  Skill system · Cost governance · Mission runtime · Review system    │
│  Executor bridge · Permission (RBAC) · Project projection slice      │
├─ 智能层 (Intelligence Layer) ────────────────────────────────────────┤
│  3-tier memory · Knowledge graph · Self-evolution · Reputation       │
│  Vector DB + RAG · LLM provider (OpenAI/Anthropic/Gemini/GLM)        │
├─ Project FSD / Task Autopilot 架构 ──────────────────────────────────┤
│  Destination parser · Clarification engine · Fleet organizer         │
│  Route planner · Telemetry+explain · Review+recovery                 │
│  Evidence trust chain (audit+replay+lineage)                         │
├─ Spec Evolution Layer (规格演化层) ──────────────────────────────────┤
│  Research repo · GitHub repo · Code analyzer · Spec synthesizer      │
│  Architecture evolution · Version control                            │
├─ 信任与合规层 (Trust and Compliance) ────────────────────────────────┤
│  Data mutation log (hash-linked) · Data lineage (DAG tracking)       │
│  Anomaly detection · Approval/policy gate · Compliance map           │
├─ 执行层 (Execution Layer) ───────────────────────────────────────────┤
│  Lobster exec · HMAC callback · Secure sandbox · Live preview        │
│  Browser exec · DockerRunner / NativeRunner / MockRunner / Probe     │
├─ Agent Runtime Pool (资源池/并发调度) ───────────────────────────────┤
│  Docker container pool · Job scheduler · Skill registry              │
│  Key pool · Rate-limit/cost tracker · Role-bind/FSD loader           │
├─ 互操作层 (Interop Layer) ───────────────────────────────────────────┤
│  A2A protocol · Key pool · Swarm (cross-pod) · Guest agent (TTL)     │
├─ 双运行时 (Dual Runtime) ────────────────────────────────────────────┤
│  Frontend runtime (Browser/IndexedDB)                                │
│  Advanced runtime (Express+native+Docker)                            │
│  Socket.IO telemetry + replay evidence + presence callbacks          │
├─ 数据层 (Data Layer) ────────────────────────────────────────────────┤
│  PostgreSQL · Redis (缓存/队列/会话) · Vector DB (RAG) · Artifact Store │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 十阶段项目工作流 Pipeline

```
1.创建项目 → 2.澄清目标 → 3.调研分析 → 4.Draft Spec → 5.规划路线
→ 6.执行 → 7.Review → 8.Takeover → 9.Deliver → 10.Evolve
```

每个阶段都伴随 SPEC 机制：spec_docs 在任一步向前闭环展开。

### 4.3 Autopilot 全流程生命周期（Step 1 → Step 8）

```
Step 1: 输入/GitHub (目标/仓库/上下文)
Step 2: 动态澄清 (策略 + LLM 问题集)
Step 3: RouteSet (LLM 生成主线+回退)
Step 4: SPEC Tree (多层工作台内容)
Step 5: 规格文档 (层级展开/导出)
Step 6: 效果预演 (LLM 模拟生成)
Step 7: 实现提示词 (PromptPackage/Handoff)
Step 8: 工程落地/Mission (Engineering Landing)
```

反馈闭环：`artifactMemory → specnode_completed / evidence_artifact_created → 反馈下一轮 SPEC`

### 4.4 Autopilot 伴随式 Agent Crew（Step 2 角色层）

角色 = Docker 容器 MCP + Skills 跨角色代理，scene-fusion 设计 3D 场景建模 PetWorkers 直接绑定 FSD role。

| 角色 | 职责 |
| ---- | ---- |
| 决策者 | 目标/风险/节奏 · LLM RouteSet/SPEC |
| 规划师 | SPEC Tree/文档 |
| 架构师 | 架构师 |
| 执行者 | Docker/MCP/Skills |
| 审计员 | 一致性/证据 |
| UI 预览师 | 效果预览/原型机 |
| 记忆管理员 | Replay/Artifact Memory |
| 自主 Agent | ReAct Loop/ToolProxy/门控 |
| Stage Activation | 114/114 · FSD 直连 |

### 4.5 能力网络与沙盒推导（Step 3 能力层）

- 60+ AIGC 节点 · Docker Sandbox · MCP/Skills · GitHub/Browser/SVG
- 4 条 Bridge 100% · RouteSet LLM 生成 · Effect Preview LLM · 多角色协同闭环
- capability-bridge-role 132/132，runtime evidence 链路打通

### 4.6 统一运行时事件总线

```
12 事件家族: clarification · sandbox · driven · role · capability · runtime
             · prompt · mission · evidence · scene · hud · browser
```

事件中心 EventBus → Socket.IO Relay → 前端 Store → Artifact Memory → Replay/Provenance → MiroFish 6 卡 + 演示图层

### 4.7 4 层统一视图

| 层 | 内容 |
| -- | ---- |
| Role 角色 | FSD 角色绑定与状态 |
| Capability 能力 | 4 bridge 100% |
| Stage 阶段 | 114/114 |
| Event 事件 | 12 家族事件流 |

### 4.8 关键代码路径

| 文件 | 职责 |
| ---- | ---- |
| `server/blueprint/blueprint-job-runner.ts` | Job 执行主循环 |
| `server/blueprint/capability-bridges/` | 5 条能力桥 |
| `server/blueprint/role-container-loader.ts` | 角色容器装配 |
| `server/tasks/mission-projection.ts` | autopilot summary 投影 |
| `shared/mission/autopilot.ts` | Destination parser / summary 合同 |
| `client/src/lib/tasks-store.ts` | autopilot normalize / alias |
| `client/src/components/tasks/TaskAutopilotPanel.tsx` | 驾驶舱消费面 |
| `server/core/workflow-runtime-engine.ts` | built-in + extra adapters |
| `server/index.ts` → `registerWebAigcRuntimeExtraAdapters` | 节点族谱注册 |
| `server/core/web-aigc-runtime-observability.ts` | replay/audit 桥接 |

### 4.9 执行模式

- Docker 可用 → `real` 模式
- Docker 不可用 → `native` 模式
- GitHub Pages → Browser Runtime only
- 主开关：`AUTOPILOT_REAL_RUNTIME`（dev:all 默认 true）
- 测试：`BUILD_TARGET=test` 硬锁 fallback

### 4.10 外部集成能力

| 类别 | 内容 |
| ---- | ---- |
| LLM/AI | OpenAI, Anthropic, Gemini, 智谱 GLM |
| 开发生态 | GitHub Actions, Webhook |
| 工具与服务 | Slack, Discord, Notion, 飞书 |
| 第三方 APIs | 按需接入 |
| 部署架构 | Vercel / Railway / Docker 容器 / Supabase+PostgreSQL+Redis |

---

## 5. 当前边界与约束

### 不做

- 不再新增 web-aigc / blueprint / project-first specs
- 不大规模重命名 mission / workflow / runtime
- 不在没有 Docker / UE 环境时启动对应 todo specs

### 优先级

1. 收尾 partial specs > 启动新 specs
2. Autopilot 流式体验闭环 > 平台级部署
3. 核心体验主线收口 > 远期规划

### TypeScript 健康

- `node --run check` 仍有历史类型债
- 新增改动要求：不扩大基线错误数

---

## 6. 节点能力差距清单（vs rbac-system-pc，2026-05-21 审计）

### 已修复

| 节点 | 差距 | 状态 |
| ---- | ---- | ---- |
| condition | 缺 6 个运算符 + AND/OR 组合 | ✅ 已补齐 14 运算符 + AND/OR |
| image_search | mock 数据，无真实搜索 | ✅ 已实现 TF-IDF 动态搜索引擎（16 条目目录） |
| file_slicing | 不支持 PDF/Word/Excel | ✅ 已支持 xlsx(直接) + docx(mammoth) + pdf(可选) |

### 待评估

| 节点 | 差距 | 严重度 | 建议 |
| ---- | ---- | ------ | ---- |
| knowledge_qa | 有真实图+向量双源检索，但无 LLM 生成步骤（retrieve+merge，非完整 RAG） | LOW | 后续可加 LLM 生成步骤，当前 mergedSummary 已可用 |
| static_webpage_read | ~~regex 剥离~~ 已升级为 html-parser（content area 优先、metadata 提取、link 提取） | ✅ 已修复 | — |
| auto_agent | ~~无 ReAct 循环~~ AgentLoopStateMachine 已实现完整 ReAct（比 rbac 更强） | ✅ 无差距 | cube 的 ReAct 比 rbac 多了 token/timeout 预算 + abort + 进度事件 |

### cube 反超 rbac 的节点

| 节点 | 说明 |
| ---- | ---- |
| audio_recognition | rbac 是 placeholder，cube 有真实 STT |
| ocr_recognition | rbac 是 placeholder，cube 有真实 OCR + 产物持久化 |
| web_qa | rbac 是 30 行空壳，cube 有 600+ 行完整实现 |
| excel_read | cube 多了 dynamic_chart 兼容性分析和验证摘要 |
| loop | cube 有 maxIterations 强制终止 + loop guard，rbac 没有 |

---

## 7. Steering 文件索引
