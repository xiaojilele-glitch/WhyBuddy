# SlideRule V6.2 架构图（自动生成）

> ⚠ **这个文件是生成的，不要手改。** 改了下次 `--emit` 会覆盖，而且
> `tests/test_architecture.py::Test图与代码同步` 会当场变红。
> 要改架构，改代码或改 `slide-rule-python/architecture.toml`，然后重新生成：
> 
> ```bash
> slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit
> ```

抄的是 grok-build 的做法：他们**一张架构图都没有**，边写在各 crate 的
`Cargo.toml` 里由 cargo 强制。对照物的现算数字见
`docs/grok-build 架构图（自动生成）.md`（`scripts/arch-graph-grok.py --emit`）。
我们没有那个编译器，所以自己写一个——见 `slide-rule-python/arch_graph.py` 模块头。

## 此刻的事实（由代码算出，不是手写）

- 扫描文件 **355** 个，模块 **355** 个
- 内部依赖边 **1175** 条（包含普通包初始化依赖）
- 内部 import 语句 **1086** 条，其中函数体内 **474** 条语句（基线 474，只许变少）
- 未声明的跨包依赖 **0** 条（基线 0 条）
- 未豁免的模块级成环边 **0** 条（完整 SCC，基线 0 条）
- component 级成环边 **0** 条（完整 SCC，基线 0 条）
- services 内部越层依赖 **0** 条（基线 0 条）
- 没人 import 的模块 **54** 个（基线 54 个）—— ⚠ **不是待删清单**，其中 4 个是跨语言入口（见全仓图，不是没人用）

权威图只留自动生成的：本文件、`docs/WhyBuddy TS 架构图（自动生成）.md`、
`docs/WhyBuddy 全仓架构图（自动生成）.md`、`docs/grok-build 架构图（自动生成）.md`。
V5.x～V6.0 手画是历史实验室笔记，禁止再打新 ⚑。

目标形状是**两个大块 + 一批叶子**（util 叶子多于 flow 编排），
不是把 services 切成 90 个平均文件。
产品图**不搬**：`xai-grok-pager`、`xai-grok-mcp`、`xai-grok-subagent`、`xai-grok-sandbox`、`xai-grok-agent`
（pager / MCP / 子代理 / sandbox / grok-agent 提示词）。

### services 内部分层（抄 grok 的叶子 crate）

| 层 | 模块数 | 可以依赖 | 是什么 |
|---|---|---|---|
| `util` | 155 | （谁都不依赖） | 纯工具：不依赖 services 里任何其它模块 |
| `core` | 74 | util | 核心：模型 / 闸 / 闭环 / 生成件 |
| `flow` | 43 | util、core | 编排：驱动器 / 流水线 / 控制面 / 会话 |

叶子层 `util` 不依赖 services 里任何其它模块——这是它能被所有人安全 import 的全部理由，也是 `import` 不必躲进函数体的前提。

### services 三层（从 import 算出，不是表）

表只报数。这张 mermaid 才是层间真实边。虚线 = 越层（欠账，只许变少）。

```mermaid
flowchart TB
  util["util<br/>155 个模块<br/>纯工具：不依赖 services 里任何其它模块"]
  core["core<br/>74 个模块<br/>核心：模型 / 闸 / 闭环 / 生成件"]
  flow["flow<br/>43 个模块<br/>编排：驱动器 / 流水线 / 控制面 / 会话"]
  core -->|161| util
  flow -->|132| core
  flow -->|163| util
```

虚线 = 未在 `architecture.toml` 里声明的边（欠账，只许变少）。

```mermaid
flowchart TB
  arch_graph["arch_graph<br/>1 个模块<br/>架构编译器自己"]
  config["config<br/>2 个模块<br/>配置"]
  models["models<br/>4 个模块<br/>数据形状"]
  stdio_utf8["stdio_utf8<br/>1 个模块<br/>顶层叶子：Windows 管道 UTF-8 钉桩"]
  sliderule_llm["sliderule_llm<br/>16 个模块<br/>LLM 通道"]
  middlewares["middlewares<br/>2 个模块<br/>中间件"]
  services["services<br/>272 个模块<br/>业务"]
  routes["routes<br/>16 个模块<br/>HTTP 路由"]
  app["app<br/>1 个模块<br/>装配根"]
  complete_migration["complete_migration<br/>1 个模块<br/>一次性迁移记录"]
  scripts["scripts<br/>39 个模块<br/>运维脚本"]
  app -->|1| config
  app -->|1| models
  app -->|16| routes
  app -->|23 · 其中 3 条边来自函数体 import| services
  app -->|2| sliderule_llm
  app -->|1| stdio_utf8
  complete_migration -->|1| models
  complete_migration -->|3| services
  middlewares -->|1| config
  middlewares -->|2| services
  routes -->|10| config
  routes -->|9| middlewares
  routes -->|6| models
  routes -->|161 · 其中 77 条边来自函数体 import| services
  routes -->|30 · 其中 16 条边来自函数体 import| sliderule_llm
  scripts -->|3| app
  scripts -->|2 · 其中 2 条边来自函数体 import| config
  scripts -->|1 · 其中 1 条边来自函数体 import| models
  scripts -->|58 · 其中 41 条边来自函数体 import| services
  scripts -->|16 · 其中 10 条边来自函数体 import| sliderule_llm
  scripts -->|2| stdio_utf8
  services -->|19 · 其中 7 条边来自函数体 import| config
  services -->|43 · 其中 1 条边来自函数体 import| models
  services -->|126 · 其中 90 条边来自函数体 import| sliderule_llm
  sliderule_llm -->|2 · 其中 2 条边来自函数体 import| config
```

## 编排环（从活路径生成）

对照 grok-build 的 spine（shell → agent → tools，`xai-workflow` 是叶子）。
我们的活路径是 `rehearsal_control._handoff_factory` → `drive_full_factory` →
`v5_full_driver` → `v5_capability_executor` → `run_spec_first`。
⚠ `component.run_control` 是 pause/cancel 叶子，不是这张图。
handoff 标在边上，当且仅当 `_handoff_factory` 函数体里真的调用了
`start_drive_full_factory_run`（import 在不算数）。

```mermaid
flowchart LR
  services_rehearsal_control["services.rehearsal_control<br/>控制面闭集工具环"]
  services_drive_full_factory["services.drive_full_factory<br/>工厂点火信封"]
  services_v5_full_driver["services.v5_full_driver<br/>主循环驱动"]
  services_v5_capability_executor["services.v5_capability_executor<br/>能力执行器（活路径调 run_spec_first）"]
  services_spec_first_pipeline["services.spec_first_pipeline<br/>spec-first 七步"]
  services_drive_full_factory -->|1| services_v5_full_driver
  services_rehearsal_control -->|handoff 1| services_drive_full_factory
  services_rehearsal_control -->|1| services_v5_full_driver
  services_v5_capability_executor -->|5| services_spec_first_pipeline
  services_v5_full_driver -->|2| services_spec_first_pipeline
  services_v5_full_driver -->|5| services_v5_capability_executor
```

## 循环依赖

下面列出完整 SCC 中每一条成环边，扣除清单明确允许的组件内部 SCC。**只许变少。** DFS 见证路径不作为基线。

（当前没有未豁免的成环边）

## 未声明的跨包依赖

（当前没有）

## crate 级：component 依赖图

抄 grok 的 Cargo.toml——边写在 crate 上，由编译器焊死。
现算数字见 `docs/grok-build 架构图（自动生成）.md`。
我们 26 个 component、100 条边，由 `architecture.toml` 声明、判据强制。
**红色虚线 = 参与组间成环的边**（模块级已清零，组级还欠着，见下）。

```mermaid
flowchart LR
  a2a["a2a<br/>4"]
  agent_loop["agent_loop<br/>15"]
  app_store["app_store<br/>5"]
  audit["audit<br/>3"]
  blueprint["blueprint<br/>19"]
  capability_engine["capability_engine<br/>2"]
  control["control<br/>10"]
  diagnostics["diagnostics<br/>6"]
  drive["drive<br/>9"]
  entrypoint["entrypoint<br/>1"]
  evidence["evidence<br/>11"]
  http_routes["http_routes<br/>12"]
  identity["identity<br/>9"]
  llm_gateway["llm_gateway<br/>19"]
  model_core["model_core<br/>27"]
  observability["observability<br/>7"]
  ops_scripts["ops_scripts<br/>40"]
  permission["permission<br/>8"]
  persist["persist<br/>11"]
  platform["platform<br/>42"]
  run_control["run_control<br/>4"]
  runtime["runtime<br/>11"]
  spec_first["spec_first<br/>41"]
  task_exec["task_exec<br/>19"]
  web_aigc["web_aigc<br/>16"]
  workspace["workspace<br/>4"]
  agent_loop -->|1| identity
  agent_loop -->|6| platform
  app_store -->|6| identity
  app_store -->|2| platform
  blueprint -->|2| platform
  capability_engine -->|5| evidence
  capability_engine -->|2| llm_gateway
  capability_engine -->|2| platform
  capability_engine -->|1| spec_first
  control -->|handoff 7| drive
  control -->|1| evidence
  control -->|3| identity
  control -->|9| llm_gateway
  control -->|3| model_core
  control -->|9| persist
  control -->|30| platform
  control -->|4| spec_first
  diagnostics -->|1| a2a
  diagnostics -->|1| evidence
  diagnostics -->|2| model_core
  diagnostics -->|3| platform
  diagnostics -->|1| web_aigc
  drive -->|2| capability_engine
  drive -->|1| evidence
  drive -->|2| identity
  drive -->|18| model_core
  drive -->|3| observability
  drive -->|5| persist
  drive -->|12| platform
  drive -->|2| run_control
  drive -->|2| spec_first
  entrypoint -->|2| agent_loop
  entrypoint -->|1| control
  entrypoint -->|2| drive
  entrypoint -->|11| http_routes
  entrypoint -->|2| llm_gateway
  entrypoint -->|4| model_core
  entrypoint -->|1| permission
  entrypoint -->|2| persist
  entrypoint -->|6| platform
  entrypoint -->|4| runtime
  entrypoint -->|4| spec_first
  entrypoint -->|3| task_exec
  entrypoint -->|2| workspace
  evidence -->|14| llm_gateway
  evidence -->|9| platform
  http_routes -->|25| app_store
  http_routes -->|3| audit
  http_routes -->|1| blueprint
  http_routes -->|2| capability_engine
  http_routes -->|3| control
  http_routes -->|1| diagnostics
  http_routes -->|11| drive
  http_routes -->|5| evidence
  http_routes -->|16| identity
  http_routes -->|37| llm_gateway
  http_routes -->|24| model_core
  http_routes -->|3| observability
  http_routes -->|16| persist
  http_routes -->|28| platform
  http_routes -->|4| runtime
  http_routes -->|10| spec_first
  http_routes -->|2| task_exec
  identity -->|14| platform
  llm_gateway -->|2| platform
  model_core -->|2| app_store
  model_core -->|5| evidence
  model_core -->|35| llm_gateway
  model_core -->|8| observability
  model_core -->|2| persist
  model_core -->|56| platform
  model_core -->|11| run_control
  model_core -->|22| spec_first
  observability -->|4| llm_gateway
  observability -->|1| persist
  observability -->|3| platform
  ops_scripts -->|10| app_store
  ops_scripts -->|3| entrypoint
  ops_scripts -->|3| evidence
  ops_scripts -->|1| identity
  ops_scripts -->|16| llm_gateway
  ops_scripts -->|16| model_core
  ops_scripts -->|9| platform
  ops_scripts -->|24| spec_first
  permission -->|1| identity
  permission -->|1| platform
  persist -->|36| platform
  run_control -->|1| platform
  runtime -->|2| identity
  runtime -->|11| persist
  runtime -->|11| platform
  runtime -->|9| workspace
  spec_first -->|3| app_store
  spec_first -->|62| llm_gateway
  spec_first -->|3| observability
  spec_first -->|56| platform
  spec_first -->|1| run_control
  task_exec -->|2| evidence
  task_exec -->|4| platform
  workspace -->|4| platform
```


## services 内部越层依赖

叶子碰了上层，或 core 碰了 flow。**只许变少。**

（当前没有）

## 闸清单（谁在拦，谁看着它）

> 依赖图回答「谁 import 谁」，回答不了「这个系统有哪些判定、各自装在哪、
> 坏成一直响的时候谁会发现」。2026-09-05 补的就是后者——
> 「为什么几个月没审查出来」的答案里有一条是**没人知道这里到底有几道闸**：
> 15 个会话全被同一道闸按同一个理由拦下，而没有观察它的位置。

- 拦截理由（blocker code）共 **19** 条，其中 **8** 条进了体检（`services/gate_health.py`），**11** 条没进（欠账，只许变少）
- 新增一条 code 必须在 `architecture.toml` 的 `[gate_codes]` 里声明归属，否则 `--check` 变红

| 拦截理由 | 体检的闸 | 发它的模块 |
|---|---|---|
| `APPBUNDLE_RUNTIME_CLOSURE_BLOCKED` | `evidence` | `v5_capability_executor` |
| `CLOSURE_DEGRADED_RUN` | — | `run_degradation` |
| `CLOSURE_FACTORY_TODO_OPEN` | `factoryTodo` | `capability_plan` |
| `CLOSURE_GOAL_RELEVANCE_FAILED` | `relevance` | `v5_capability_executor` |
| `CLOSURE_NO_ENTRY_SURFACE` | `deliverableSurface` | `deliverable_surface` |
| `CLOSURE_ONE_PAGE_PER_ROLE` | `deliverableSurface` | `deliverable_surface` |
| `CLOSURE_PAGE_WITHOUT_CONTROLS` | `deliverableSurface` | `deliverable_surface` |
| `CLOSURE_REBUILD_FAILED` | — | `v5_capability_executor` |
| `CLOSURE_SUBMIT_INTENT_UNMAPPED` | `deliverableSurface` | `deliverable_surface` |
| `CLOSURE_SUBMIT_INTENT_UNSERVED` | `deliverableSurface` | `deliverable_surface` |
| `LLM_EMPTY_OUTPUT` | — | `sliderule_full` |
| `LLM_GENERATE_DISABLED` | — | `sliderule_full`、`v5_capability_executor` |
| `LLM_GENERATE_FAILED` | — | `sliderule_full`、`v5_capability_executor` |
| `LLM_TEST_ERROR` | — | `llm_channel` |
| `LLM_TEST_FAILED` | — | `llm_channel` |
| `MODEL_GATE_BLOCKED` | — | `v5_capability_executor` |
| `PACKAGE_NOT_FOUND` | — | `sliderule_full` |
| `REFINE_PAINT_FAILED` | — | `v5_capability_executor` |
| `TASK_LIFECYCLE_AUTH_DENIED` | — | `task_lifecycle_production_closure` |

「—」是明说不体检的：诊断类（只在真失败时出现，没有「一直说同一句话」的
退化形态），以及压根不是闭环闸的连通性自检。理由逐条写在 `[gate_codes]` 里。

### 体检在看的闸（按闸名，含只报不拦的）

> 上面那张表按 blocker code 排，**只报不拦的闸没有 code，会整个漏掉**。
> 这张按闸名排，`gate_health` 记了谁就有谁。

| 闸 | 记在哪 | 拦人吗 |
|---|---|---|
| `deliverableSurface` | `v5_capability_executor` | 拦，`CLOSURE_PAGE_WITHOUT_CONTROLS` |
| `evidence` | `v5_capability_executor` | 拦，`APPBUNDLE_RUNTIME_CLOSURE_BLOCKED` |
| `factoryTodo` | `v5_capability_executor` | 拦，`CLOSURE_FACTORY_TODO_OPEN` |
| `pageEdit` | `sliderule_full` | 只报不拦（§7 增强类） |
| `relevance` | `v5_capability_executor` | 拦，`CLOSURE_GOAL_RELEVANCE_FAILED` |
