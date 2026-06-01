# 实现路径规划：从展示页面到多智能体编排系统

## 2026-04-26 Lane F：Task Autopilot 前端文档回补

- [x] README / README.zh-CN 已补齐“如何触发任务自动驾驶”的最小目的地输入示例，并与前端六类 chips（analysis、generation、implementation、research、attachment、advanced-execution）对齐。
- [x] steering 已回补 Destination parser / projection 与 launch preview、cockpit goal card 的字段差异，避免把审计字段误读为每张前端卡片都已展示或持久化。
- [x] steering 与 README 已补充 desktop / tablet / mobile 的 cockpit 能力边界：桌面三栏，平板双栏，移动分段导航、压缩卡片与 bottom sheet；GitHub Pages 仍是 browser-only，不包含 Node server / executor。

## 2026-04-26 增补：Task Autopilot Phase 1 闭环

- [x] 任务自动驾驶第一阶段 `18 / 18` specs 已完成并收口，覆盖产品定位、核心概念、L1-L5 分级、Destination / Route、驾驶舱 IA、接管点、Drive State、runtime 编排、可解释性、恢复治理、证据回放与成功指标。
- [x] 第一阶段文档产物已闭合为 `54 / 54` markdown，每份 spec 均包含 `requirements.md`、`design.md`、`tasks.md`。
- [x] 顶层核心任务项已重算为 `345 / 345`，raw checklist 已重算为 `602 / 602`。
- [x] 已输出进度总览 SVG：`docs/task-autopilot-18-spec-progress-overview-2026-04-24.svg`，当前文件内容刷新到 2026-04-26 口径。
- [x] 第一条 compatibility-first 代码纵切已进入主线：`shared/mission/autopilot.ts` 提供 `parseMissionDestination()` 与 autopilot summary 合同，`server/tasks/mission-projection.ts` 透传 autopilot projection / orchestration，`client/src/lib/tasks-store.ts` 完成 autopilot normalize，`TaskAutopilotPanel` 提供驾驶舱消费面。
- [x] 聚焦验证已通过：shared mission autopilot tests、server mission routes tests、client tasks-store autopilot tests、TaskAutopilotPanel tests。
- [ ] 下一阶段不再优先追加 specs 数量，而是推进真实 runtime 深水区：parser 版本化与 clarification merge、route planner 自动编队、fleet orchestration、takeover governance、evidence replay trust chain、success metrics 与 live mission facts 对齐。

## 2026-04-15 增补

- [x] `launch-operator-surface-convergence` 第一阶段已完成：`UnifiedLaunchComposer` 已接入底部任务操作 rail，统一发起区与任务操作区开始收敛为同一块首屏控制面。
- [x] `OfficeTaskCockpit.tsx` 与 `TasksPage.tsx` 已完成共享操作区接线，活动任务详情、任务操作 loading map 和提交回调都已并入统一发起组件。
- [x] `TasksCockpitDetail` 首屏独立任务操作卡已降级为“建议与依据”区，右侧栏继续保留任务摘要、信号、产物和深层详情，不再承担首屏主操作入口。
- [x] 已补齐自动化验证：底部任务操作 rail 组件测试、统一发起区 helper 测试、任务操作栏测试和 `unified-launch-coordinator` 发起回归测试均已通过。
- [ ] 当前剩余收尾项主要是桌面端与窄宽度场景手测，以及 `office-task-cockpit` 的最终兼容回归。

## 2026-03-27 增补

- [x] 工作流附件输入已从“仅文本”升级为“文本 + 附件”联合提交。
- [x] 附件解析链路已支持全文导入 workflow，不再只把局部摘要片段注入上下文。
- [x] 当前已覆盖的附件类型包括文本、PDF、Word、Excel / 表格，以及图片 OCR。
- [x] UI 层保持预览摘要展示，但 workflow、去重签名和输入上下文已改为基于附件全文内容。
- [x] `README.md` 已同步补充附件输入能力、支持格式、全文导入行为与当前边界说明。

## 2026-03-28 增补

- [x] 图片附件 OCR 已切换为独立浏览器 worker：不再走顶层 `tesseract.recognize()`，改为单例 worker 复用。
- [x] OCR 链路已补齐超时与降级回退：图片识别失败或无可读文本时，附件会自动退回 `metadata_only`，不阻塞上传。
- [x] Tesseract 初始化噪音已做过滤：已知 `Parameter not found` / `Estimating resolution` 控制台信息不再干扰排障。
- [x] 静态预览体验已补齐 favicon：减少本地开发与 GitHub Pages 下浏览器默认 `favicon.ico` 404 噪音。
- [x] 工作流页已重构为“三级信息密度”：默认总览只展示当前阶段、总体进度、活跃角色与阻塞状态，角色与任务详情改为按需展开。
- [x] 角色执行区已从“明细堆叠”改为“部门摘要 + 角色一行卡片”：完整 deliverable、反馈、附件与消息流不再默认抢占视觉中心。
- [x] 关键事件流已收敛为默认展示最近 3 条，保留“查看全部事件”入口，避免长消息流淹没执行进度。
- [x] 3D 办公室墙面已完成一轮减法优化：移除左墙背景板、多余背墙装饰，背墙壁灯与公告板同步简化，首页场景更轻。

## 当前状态

## 并行改造分工（2026-03-27）

### Worktree A：中英文切换 + 移动端适配

- 分支：`feat/i18n-mobile`（已合并到 `main`，本地分支已删除）
- 目录：`C:\Users\2303670\Documents\whybuddy-i18n-mobile`（worktree 已删除）
- 目标：支持中英文切换，默认中文，并完成核心页面的移动端适配。

可执行清单：

- [x] 梳理当前所有用户可见文案，建立 `zh-CN` / `en-US` 文案资源结构。
- [x] 接入全局语言状态管理，默认语言改为中文，并支持用户手动切换后持久化。
- [x] 将顶部导航、指令发布区、工作流面板、报告面板、配置面板全部接入文案字典。
- [x] 为 GitHub Pages 预览模式和本地模式都验证默认中文是否生效。
- [x] 重新整理主界面在 `>=1280`、`768-1279`、`<768` 三档布局。
- [x] 修复移动端下 3D 场景、侧栏、抽屉、弹窗、表单和按钮的溢出与遮挡问题。
- [x] 为移动端补充导航折叠、面板收起、滚动容器与触屏交互细节。
- [x] 完成至少一轮桌面端和移动端自测，确保 `npm run check` 通过。

完成标准：

- [x] 默认打开即为中文。
- [x] 用户可一键切换中英文，刷新后保持选择。
- [x] 手机宽度下核心流程可用，不出现关键按钮不可点、面板超出屏幕、内容重叠。

### Worktree B：动态组织架构 + Skills + MCP

- 分支：`feat/dynamic-org`（已合并到 `main`，本地分支已删除）
- 目录：`C:\Users\2303670\Documents\whybuddy-dynamic-org`（worktree 已删除）
- 目标：将固定 18 个智能体改造成按用户问题动态生成组织架构，并自动配置 skills 与 MCP。

可执行清单：

- [x] 梳理现有固定 agent 注册、seed、工作流编排、前端组织展示的耦合点。
- [x] 设计动态组织 schema：包含组织层级、角色、职责、skills、mcp、模型配置、并发策略。
- [x] 在服务端新增“根据用户问题生成组织架构”的入口，并保留调试日志便于回放。
- [x] 将当前固定 18 agent 的启动流程替换为“按任务实例动态创建组织”。
- [x] 让 manager / worker 的下发、执行、汇总逻辑改为基于动态组织节点遍历，而不是写死名单。
- [x] 建立 skills 装配机制，让节点可按角色自动挂载 prompt/skill 集。
- [x] 建立 MCP 配置装配机制，让节点可按任务类型声明所需工具与连接信息。
- [x] 更新前端组织结构和执行视图，能够展示动态生成的部门、角色与工具信息。
- [x] 设计降级路径：当动态生成失败时，系统能回退到安全默认组织或给出明确错误。
- [x] 补充最小可用测试或验证脚本，覆盖组织生成、执行链路、回退策略。

完成标准：

- [x] 用户输入不同类型问题时，系统会生成不同组织结构，而不是固定 18 个角色。
- [x] 每个动态节点都能携带 skills 与 MCP 配置进入执行链路。
- [x] 工作流主链路在动态组织下仍能跑通，并可观察组织生成结果。

### Worktree C：Pages 预览入口 + GitHub 引流

- 分支：`feat/preview-github`（已合并到 `main`，本地分支已删除）
- 目录：`C:\Users\2303670\Documents\whybuddy-preview-github`（worktree 已删除）
- 目标：在 GitHub Pages 预览页右上角展示仓库地址和可点击入口，方便用户点 Star。

可执行清单：

- [x] 确认 Pages 模式与本地模式的入口差异，找到最合适的 UI 挂载位置。
- [x] 在右上角增加 GitHub 仓库入口，至少包含可见文案、外链点击和清晰的 hover / touch 反馈。
- [x] 文案优先展示仓库地址或 `GitHub / Star` 明确信号，避免用户不知道点哪里。
- [x] 兼容桌面端与移动端，避免遮挡现有操作按钮和 3D 视图。
- [x] 在 Pages base path 下验证链接、样式和资源路径不受影响。
- [x] 评估是否需要在 README 或页面页脚增加二次入口，保持传播一致性。
- [x] 完成 `build:pages` 自测，确保静态预览构建通过。

完成标准：

- [x] Pages 页面右上角稳定显示 GitHub 仓库入口。
- [x] 用户可从预览页直接跳转仓库主页。
- [x] 入口在移动端和桌面端都不遮挡关键交互。

### 收尾状态

- [x] 3 个并行 worktree 的代码都已完成、提交、合并回 `main`。
- [x] 合并后的 `main` 已推送到 GitHub 远端。
- [x] 并行开发用的 3 个本地 worktree 和对应功能分支已删除清理。

## 2026-03-28 增补：Cube Brain + Docker 执行层合并

- [x] 主定位从“生成 md/json 报告”升级为“真实任务编排 + Docker 实例执行 + 进度回传 + 可视化交付”。
- [x] `whybuddy` 作为唯一主控 Brain，统一承接 Cube UI 与 Feishu 两个入口。
- [x] 第一版执行载体固定为 Docker 容器，后续再评估安卓模拟器 / 完整虚机。
- [x] `openclaw-feishu-progress` 本轮只迁移任务状态机、Feishu ACK / relay、任务宇宙 API、`/tasks` 页面与执行协调思想。
- [x] scanner / pipeline / codegen / Playwright 报告链路不纳入本轮主线，避免稀释真实执行闭环。
- [x] 真实执行任务的核心交付从“默认写 md/json”改为“任务状态、实例信息、日志摘要、工件链接、最终结果”。
- 执行细则见 `docs/mission-worktree-dual-repo.md`，用于约束多 worktree + 双仓参考的读写边界。

## 2026-03-29 收口更新

- [x] `Worktree 0 / A / B / C / D / E / F` 的代码都已合并回 `main`。
- [x] `shared/mission/**`、`shared/executor/**`、任务路由、executor 参考实现、brain dispatch、Feishu bridge、任务宇宙页面和总集成入口都已进入主线。
- [x] `.env.example`、README、mission smoke 脚本与总集成入口文档已补齐。
- [x] `npm run check` 已在合并后通过。
- [x] 本地 `main` 已推送到 `origin/main`。
- [x] 已合并的本地并行 worktree（`0 / A / B / C / D / E / F`）已删除，只保留主仓继续开发。
- [ ] mission smoke 脚本已落地，但尚未在本轮文档更新时记录完整服务器实机验证结果。

## 2026-03-29 界面收口补记

- [x] `/tasks` 桌面端已收口为更适合 16:9 屏幕的单屏任务驾驶舱，页签内容改为内部滚动，不再依赖整页长滚动。
- [x] `Overview` 已重构为左侧 2D Star Map、中列 `Orbit Stages / Agent Crew`、右侧 `Source Directive / Decision Entry / Runtime Snapshot` 的平衡布局。
- [x] `Execution` 已改为高密度摘要卡：Work Package、Timeline 都采用总览优先、长文本弹窗展开的模式。
- [x] `Artifacts` 已改为资源面板式展示：工件摘要、内容预览、失败原因统一支持摘要 + 详情弹窗。
- [ ] 当前 `/tasks` 前端数据仍主要来自 workflow 投影层，尚未完全切换到 mission 原生数据源；后续需要继续完成这一步收口。

## 2026-03-30 状态对齐

- [x] 已按当前仓库实装结果同步 Worktree 0 / A / D / F 的主要完成状态，并补齐部分 C / E 的已落地项。
- [x] `npm run check` 当前通过。
- [x] mission / Feishu / executor 相关单测当前通过：`server/tests/mission-store.test.ts`、`server/tests/mission-routes.test.ts`、`server/tests/feishu-bridge.test.ts`、`server/tests/feishu-routes.test.ts`、`services/lobster-executor/src/app.test.ts`、`server/tests/dynamic-organization.test.ts`。
- [ ] `/tasks` 仍主要消费 workflow 投影数据，`/api/planets` mission 原生路由尚未补齐。
- [ ] `services/lobster-executor` 当前仍是 mock-first 参考实现，真实 Docker 生命周期、主动回调与签名链路还未完全接上。
- [ ] `MissionOrchestrator`、`ExecutionPlanBuilder`、`ExecutorClient` 已落地，但 Cube UI 创建任务尚未切到 mission 主线。

## 并行改造分工（2026-03-28：Cube Brain + Docker 执行层）

### Worktree 0：契约冻结与并行边界

分支：`chore/mission-contracts`  
目录：`C:\Users\wangchunji\Documents\whybuddy-0-mission-contracts`  
目标：先冻结新任务域模型、执行器契约、事件模型和目录边界，降低后续 worktree 冲突。  
主要写入范围：`shared/**` 新增 mission / executor 契约；`docs/**` 新增接口文档；`ROADMAP.md` 同步本轮计划。

可执行清单：

- [x] 定义 `MissionRecord`、`MissionStage`、`MissionEvent`、`MissionDecision`、`ExecutionPlan`、`ExecutorJobRequest`、`ExecutorEvent`。
- [x] 明确命名边界：旧 `workflow/task` 保留给现有编排内核，新 `mission` 专用于真实执行链路，避免和现有 `TaskRecord` 冲突。
- [x] 冻结 Cube 与远端执行器的 HTTP 契约：`/health`、`/api/executor/jobs`、`/api/executor/events`。
- [x] 冻结前端任务宇宙接口：`/api/tasks`、`/api/tasks/:id`、`/api/tasks/:id/decision`、`/api/planets`、`/api/planets/:id/interior`。
- [x] 明确 Socket 事件名和 payload 结构，统一继续走 Cube 现有 Socket.IO，不新增 raw WebSocket 技术栈。
- [x] 输出一份“目录所有权清单”，后续 worktree 不并行修改同一批 shared 契约文件。

完成标准：

- [x] 其余所有 worktree 都基于该分支 rebase / merge 开工。
- [x] 后续并行开发不再争抢共享类型文件命名权和接口字段定义权。

### Worktree A：任务域模型 + 状态机 + 持久化

分支：`feat/mission-core`  
目录：`C:\Users\wangchunji\Documents\whybuddy-A-mission-core`  
目标：把 `openclaw-feishu-progress` 的任务状态机内核迁入 Cube，并接入本地持久化。  
主要写入范围：`server/tasks/**`、`server/db/**`、`server/routes/tasks.ts`、`shared/mission/**`。

可执行清单：

- [x] 新增 `MissionStore`，支持 create / progress / waiting / decision / done / failed / recovery。
- [x] 将 mission 数据持久化进 Cube 现有 `data/database.json`，不再依赖 `.opencroc/task-snapshots.json`。
- [x] 新增任务 REST API：创建、列表、详情、决策提交、最近事件。
- [x] 加入 topic/thread 维度，支持 Feishu 线程与 Cube UI 的同主题聚合。
- [x] 为 mission 增加 `executor`、`instance`、`artifacts`、`summary` 字段，承接真实执行结果。
- [x] 任务阶段固定为 `receive -> understand -> plan -> provision -> execute -> finalize`。
- [x] 加入服务重启后的恢复逻辑，确保运行中 mission 不会静默丢失。

完成标准：

- [x] 不接执行器也能完整演示 mission 生命周期和等待确认恢复。
- [x] `GET /api/tasks` 与 `GET /api/tasks/:id` 返回稳定结构。
- [x] 重启服务后 mission 状态和事件可恢复。

#### Worktree A 当前状态

- [x] Worktree A 的后端任务域内核已完成：`MissionStore`、任务状态机、本地持久化、任务 REST API、重启恢复、topic/thread 聚合都已落地。
- [x] mission 主链阶段已固定为 `receive -> understand -> plan -> provision -> execute -> finalize`，并已承接 `executor`、`instance`、`artifacts`、`summary` 等执行结果字段。
- [x] `/tasks` 页面已经切到 `mission` 主数据源：左侧任务列表、详情头部、时间线、运行态、等待态优先读取 `GET /api/tasks`、`GET /api/tasks/:id`、`GET /api/tasks/:id/events`。
- [x] 详情页中的 `Mission Summary`、`Live Signal`、`Timeline`、`Runtime Snapshot`、`Artifacts` 已优先切到 mission 原生字段和事件流。
- [x] `Decision Entry` 已接到 `POST /api/tasks/:id/decision`，页面内可以直接提交确认并恢复当前 mission，不再默认新开后续 workflow。
- [x] 前端已接入 `MISSION_SOCKET_EVENT`，任务状态变化会按 mission 事件做局部更新，`Refresh` 退化为兜底能力。
- [x] 页面已提供原生 `POST /api/tasks` 创建入口：`/tasks` 页面支持 `New Mission`，首页支持快速创建入口。
- [ ] `Work Packages`、`Agent Crew`、`Organization`、复杂 report 下载链路当前仍保留为 `workflow` 补充层，尚未完全迁入 mission 原生投影。
- [ ] 首页 workflow 面板与 `/tasks` mission 控制台的职责边界仍可继续收口，目前属于“双轨并存、mission 主线优先”的阶段。

#### Worktree A 页面改造实施清单

当前完成情况（2026-03-30）：

- [x] 第一阶段已完成：`/tasks` 主数据源已切到 mission，`workflow` 仅作为补充层保留。
- [x] 第二阶段已完成：详情页已改成 mission-first，时间线、运行态、artifacts、等待态都以 mission 原生字段为准。
- [x] 第三阶段已完成：`Decision Entry` 已接入真实 mission 决策流，支持等待确认后的恢复执行。
- [x] 第四阶段已完成：前端已接入 mission socket，任务更新按 mission 事件做局部刷新。
- [x] 第五阶段已完成：前端已补齐 mission 创建入口，用户可以直接从页面创建 mission。
- [ ] 暂未迁移的区域继续挂在 workflow 补充层：`Work Packages`、`Agent Crew`、`Organization`、复杂 report 下载。

推荐路线：

- 先走 `mission` 主数据源 + `workflow` 补充信息的混合迁移，而不是一次性全切。
- `mission` 已经有任务状态、阶段、事件、决策、执行上下文。
- 当前页面里的 `Work Packages / Agent Crew / Organization` 这类高密度内容，很多还只能从 `workflow` 投影出来。
- 最稳的方式是先把 `/tasks` 的任务主线切到 mission，再逐步缩减 workflow 依赖。

第一阶段：把 `/tasks` 主数据源切到 mission

- 目标：左侧列表、右侧头部、时间线、决策、运行态先用 mission 原生数据。
- 主要改动文件：
- `client/src/lib/tasks-store.ts`
- 新增真正的 mission 数据加载：`GET /api/tasks`、`GET /api/tasks/:id`、`GET /api/tasks/:id/events`。
- 把当前 `buildSummaryRecord / buildDetailRecord` 里依赖 workflow 的主链字段改成优先读取 mission。
- 保留 workflow 作为补充层，只给 `work packages / organization / crew` 这些区域兜底。
- 建议新增 `client/src/lib/mission-client.ts`。
- 专门封装 mission API，请求不要再散在 store 里。
- 同时定义前端的 mission normalize 逻辑。
- 页面效果：
- 左侧 `Mission Queue` 会真正显示 mission 列表，不再是 workflow 映射结果。
- 任务状态、当前阶段、等待事项、摘要会和后端 mission 保持一致。
- 刷新后任务不会像重新算了一遍，而是直接读持久化状态。

第二阶段：把详情页改成 mission-first

- 目标：让右侧详情真正对应 Worktree A 的任务状态机。
- 主要改动文件：
- `client/src/components/tasks/TaskDetailView.tsx`
- `Mission Summary` 直接用 mission `summary`。
- `Live Signal` 直接用 mission 最近事件和 `waitingFor`。
- `Runtime Snapshot` 直接用 mission `executor` 和 `instance`。
- `Artifacts` 直接用 mission `artifacts`。
- `Timeline` 直接用 `/api/tasks/:id/events`。
- `client/src/components/tasks/TaskPlanetInterior.tsx`
- 阶段节点固定成六阶段。
- `Waiting` 不再是假推导，而是 mission 原生 waiting 状态。
- 中心态显示 `currentStageKey / currentStageLabel`。
- 页面效果：
- 详情页会从“workflow 任务宇宙”变成“mission 控制台”。
- 时间线会更像真正的任务事件流。
- Runtime Snapshot 会开始反映 executor / job / instance，而不是摘要拼装结果。

第三阶段：把 Decision Entry 接到真正的 mission 决策

- 目标：让页面里的“决策”不是再开一个 workflow，而是恢复当前 mission。
- 主要改动文件：
- `client/src/lib/tasks-store.ts`
- 把 `launchDecision()` 从 `submitDirective()` 改成 `POST /api/tasks/:id/decision`。
- `client/src/components/tasks/TaskDetailView.tsx`
- 把 `Decision Entry` 的文案和按钮逻辑改成“提交确认 / 恢复执行”。
- 如果 mission 当前不在 waiting，隐藏或禁用这块。
- 可能需要补一个更轻的 preset 结构。
- 现在的 preset 更像“发起后续 workflow”。
- mission 决策更像“选择 Continue / Report only / Add note”。
- 页面效果：
- 用户在详情页点击决策，当前 mission 会恢复推进。
- 不会再莫名新生成一条 workflow。
- 这一步做完，Worktree A 的“等待确认恢复”才算真正落在页面里。

第四阶段：把实时更新切到 mission socket

- 目标：让页面实时跟 mission 走，而不是主要靠 workflow refresh。
- 主要改动文件：
- `client/src/lib/tasks-store.ts`
- 接入 `shared/mission/socket.ts` 定义的 `MISSION_SOCKET_EVENT`。
- 监听 `mission.record.updated / waiting / completed / failed`。
- 收到事件后只局部更新对应任务，不全量重刷。
- 可能复用现有 `client/src/lib/workflow-store.ts` 的 socket 初始化方式。
- 页面效果：
- 任务进度、等待状态、完成失败会实时变化。
- `/tasks` 页会更像真正的控制台。
- `Refresh` 按钮会变成兜底，而不是主更新方式。

第五阶段：补“创建 mission”入口

- 目标：把后端 `POST /api/tasks` 真正暴露给用户。
- 主要改动文件：
- `client/src/pages/tasks/TasksPage.tsx`
- 增加 `New Mission` 按钮。
- `client/src/pages/Home.tsx`
- 当前只有“进入 Mission Universe”。
- 可以补一个“快速创建任务”入口。
- 建议新增一个小表单组件，例如 `client/src/components/tasks/CreateMissionDialog.tsx`。
- 页面效果：
- 用户可以直接在前端创建 mission。
- Worktree A 的创建 API 才会真正被用起来。

哪些可以暂时不动：

- `Work Packages`
- `Agent Crew`
- `Organization`
- 复杂 report 下载和部门报告下载
- 这些区域当前仍然适合继续挂在 workflow 上，避免过早强切导致页面信息密度明显下降。

建议执行顺序：

1. 先改 `client/src/lib/tasks-store.ts`，把列表和详情头部切到 mission。
2. 再改 `client/src/components/tasks/TaskDetailView.tsx`，把 timeline / runtime / artifacts 切到 mission。
3. 再把决策入口接到 `POST /api/tasks/:id/decision`。
4. 最后接 mission socket 实时更新。

### Worktree B：执行器契约 + Docker 参考执行器

分支：`feat/lobster-executor`  
目录：`C:\Users\wangchunji\Documents\whybuddy-B-lobster-executor`  
目标：在同仓内提供一个可部署到“龙虾服务器”的 Docker 参考执行器，先打通真实实例创建闭环。  
主要写入范围：`services/lobster-executor/**`、`docs/executor/**`、`scripts/**` 中的本地联调脚本。

可执行清单：

- [x] 新增 `services/lobster-executor` 轻量服务，提供 `/health`、`/api/executor/jobs`、可选 `/api/executor/jobs/:id/cancel`。
- [ ] 实现 Docker 容器创建、启动、超时、退出码判断、日志采集与工件目录挂载。
- [ ] 执行器将运行进度、完成、失败、等待确认回调到 Cube 的 `/api/executor/events`。
- [ ] 为执行器与 Cube 之间加入共享密钥签名和时间戳校验。
- [ ] 明确 Docker 镜像、命令、环境变量、挂载目录和超时参数的最小必填项。
- [ ] 提供一个本地 mock job 和一个真实 Docker smoke job。
- [ ] 不在本轮实现资源调度池、多机负载均衡、镜像仓库治理。

完成标准：

- [ ] Cube 发出一个 job 后，执行器能创建 Docker 容器并把阶段回调打回 Cube。
- [ ] 执行成功和执行失败两条链路都能稳定回调。
- [ ] 本地和服务器部署说明清晰可复现。

### Worktree C：Brain 规划 + 执行调度

分支：`feat/brain-dispatch`  
目录：`C:\Users\wangchunji\Documents\whybuddy-C-brain-dispatch`  
目标：让 Cube 现有动态组织能力真正变成“会下发真实执行计划的大脑”。  
主要写入范围：`server/core/**` 中新增 `mission-orchestrator`、`executor-client`、计划构建器；少量复用动态组织生成能力。

可执行清单：

- [x] 新增 `MissionOrchestrator`，不要直接改写现有 `WorkflowEngine` 主链。
- [ ] 复用动态组织生成能力，让 CEO / manager / worker 参与 `understand` 和 `plan` 阶段，但最终产物必须落成结构化 `ExecutionPlan`。
- [ ] `ExecutionPlan` 至少包含 `image`、`command`、`env`、`mounts`、`artifacts`、`successCriteria`、`timeoutSec`。
- [x] 新增 `ExecutorClient`，按契约把计划发往远端 Docker 执行器。
- [x] 规划失败、计划字段缺失、执行器不可达时，mission 必须进入明确失败态，而不是只生成报告文件。
- [x] 给真实执行链路增加“等待确认”节点，允许 Brain 在执行前或执行中暂停并请求人工决策。
- [x] 保留现有分析型 workflow，不把所有旧 `/api/workflows` 请求强行切到 mission 主线。

完成标准：

- [ ] 一个来自 Cube UI 的任务能走完 `understand -> plan -> dispatch`。
- [x] 规划结果是结构化 JSON，不是仅自然语言说明。
- [ ] 执行器不可达时，错误能在任务详情和事件流中可见。

### Worktree D：Feishu 入口 + ACK / Relay / Progress Bridge

分支：`feat/feishu-mission-bridge`  
目录：`C:\Users\wangchunji\Documents\whybuddy-D-feishu-mission-bridge`  
目标：把 `openclaw-feishu-progress` 的飞书桥接能力迁入 Cube，并改写为 Express 版本。  
主要写入范围：`server/feishu/**`、`server/routes/feishu.ts`、`.env.example`、`README.md` 飞书配置章节。

可执行清单：

- [x] 迁移 `FeishuProgressBridge`、relay auth、去重、task start、decision resume、done/failed 终态回传。
- [x] 将 Fastify 路由重写为 Cube 当前 Express 路由风格。
- [x] 新增 `/api/feishu/relay` 与 `/api/feishu/relay/event`，对接 mission 而不是旧 CrocOffice task。
- [x] 统一 topicId 生成规则，确保飞书线程、回复链和 Cube `/tasks` 聚合一致。
- [x] 支持复杂请求立即 ACK，随后持续发送 progress / waiting / complete / failed。
- [x] 保留 `suppressFinalSummary` 等开关，避免上游和 Cube 重复发最终答复。
- [x] 本轮先支持文本卡片 / 文本消息，不扩复杂交互卡片工作流。

完成标准：

- [x] 飞书复杂请求进入后 3 秒内能收到 ACK。
- [x] 任务推进、等待确认、完成、失败都能稳定回传飞书。
- [x] relay 鉴权、重放保护、重复事件去重都有单测覆盖。

### Worktree E：任务宇宙 UI + 3D 内部视图

分支：`feat/tasks-universe`  
目录：`C:\Users\wangchunji\Documents\whybuddy-E-tasks-universe`  
目标：把 `openclaw-feishu-progress` 的 `/tasks` 宇宙页迁入 Cube，并接到 mission 数据源。  
主要写入范围：`client/src/pages/tasks/**`、`client/src/components/tasks/**`、`client/src/lib/tasks-store.ts`、相关路由与 Socket 订阅。

可执行清单：

- [x] 迁移任务总览、planet 列表、planet interior、时间线、决策按钮、同主题聚合视图。
- [ ] 改写数据源，统一从 Cube 的 `/api/tasks`、`/api/planets` 和 Socket.IO 读取。
- [ ] 在 UI 上展示实例信息、当前镜像、执行日志摘要、工件链接、失败原因。
- [x] 让等待确认任务可以直接在详情页完成 decision 提交。
- [x] 保持移动端和桌面端都可用，不引入仅适配大屏的布局。
- [x] 与现有首页 / workflow 面板共存，不破坏当前 Home 主场景。
- [x] 优先保证“信息清晰 + 实时感”，不追求一次性迁完所有视觉细节。

完成标准：

- [ ] `/tasks` 能稳定展示真实 mission，而不是旧 workflow 报告。
- [x] 任务详情页可看到阶段、事件、机器人状态、决策入口。
- [x] 任务运行中页面无需手动刷新即可看到状态变化。

### Worktree F：整合收口 + 兼容路由 + 验证与部署

分支：`feat/mission-integration`  
目录：`C:\Users\wangchunji\Documents\whybuddy-F-mission-integration`  
目标：完成新老链路共存、联调、测试、部署和最终收口。  
主要写入范围：`server/index.ts`、路由注册、Socket 事件桥接、测试、脚本、文档。

可执行清单：

- [ ] 把 A/B/C/D/E 的能力统一接入主服务启动流程。
- [x] 新增 mission 相关 Socket 事件并保持旧 workflow 事件不被破坏。
- [x] 更新 `.env.example`、README、部署脚本、本地联调脚本。
- [x] 加入本地一键 smoke：Cube 创建任务 -> Docker 执行器 -> 回调 -> `/tasks` 可见。
- [x] 加入 Feishu smoke：relay -> ACK -> progress -> done / failed。
- [x] 加入服务重启恢复 smoke：运行中 mission 重启后状态可恢复或明确失败。
- [ ] 清理冲突命名、废弃临时 mock、补齐收尾文档。

完成标准：

- [x] `main` 分支上保留旧 workflow 能力，同时新增 mission 主线。
- [ ] 本地和服务器各至少跑通一轮真实 Docker 执行闭环。
- [x] 所有新接口、事件和环境变量都有文档。

### 合并顺序

- [x] 先合并 `Worktree 0`，冻结 shared 契约和接口文档。
- [x] 然后并行推进 `Worktree A / B / C / D / E`。
- [x] `Worktree F` 只在 A/B/C/D/E 主体完成后做总集成，不提前抢改共享入口文件。
- [x] 除 `Worktree 0` 外，其余分支禁止并行改同一批 `shared/mission/**` 契约文件。
- [x] `server/index.ts`、主路由注册、README 环境变量章节默认归 `Worktree F` 单独持有。

### 集成验收口径

- [ ] Cube UI 创建任务后，能生成 mission，并进入 `receive -> understand -> plan`。
- [x] Brain 产出的 `ExecutionPlan` 是结构化对象，不是单纯自然语言。
- [ ] Cube 能把计划发给远端 Docker 执行器，并收到回调。
- [ ] `/tasks`、`/planets`、`/planets/:id/interior` 能实时展示运行状态。
- [x] 飞书复杂请求能收到 ACK，并持续看到进度、等待确认、完成或失败。
- [x] 决策提交接口幂等，重复点击不会把 mission 弄乱。
- [x] 服务重启后 mission 不会无声消失。
- [ ] 真实执行任务的最终交付以状态、日志摘要、工件链接和结果摘要为主，不再默认只产出 md/json。

### 收尾状态

- [ ] `whybuddy` 已具备 Brain + Docker 执行 + Feishu 回传 + 任务宇宙可视化的首版闭环。
- [x] `openclaw-feishu-progress` 中桥接与执行层核心已迁入 Cube 主线。
- [x] scanner / pipeline / codegen / report 仍作为旧能力保留，但不再阻塞真实执行主线。
- [x] 所有并行 worktree 都已完成、合并回 `main`、删除本地 worktree 并清理分支。

## Test Plan

- 单测必须覆盖 mission 状态机、决策恢复、执行器回调签名校验、飞书 relay 去重、Express 路由入参校验。
- 集成测试必须覆盖四条主链：Cube UI 创建任务、Feishu 复杂请求、执行器成功回调、执行器失败回调。
- 至少保留两个 smoke 脚本：`local-docker-success` 和 `local-docker-failed`。
- UI 验收必须覆盖桌面端和移动端任务页，不要求视觉完全一致，但必须保证决策、进度、事件流可用。
- 兼容性验收必须确认旧 `/api/workflows`、现有首页和现有 Socket 事件不被新 mission 链路破坏。

## Assumptions

- 本轮固定以 Docker 作为唯一执行载体；安卓模拟器、完整虚机、K8s 调度不在当前 roadmap 范围内。
- 远端“龙虾”以同仓参考执行器形式先实现，部署时作为内部执行节点，不作为第二个用户侧产品入口。
- 新任务链路统一使用 `mission` 命名，旧 `workflow/task` 仅保留给历史分析链路。
- 任务页实时通信统一沿用 Cube 现有 Socket.IO，不再引入 openclaw 里的 raw WebSocket 方案。

## 当前实现状态（2026-03-27 更新）

### 本轮新增完成

- [x] **Mission 主线已收口到 `main`**：`Worktree 0 / A / B / C / D / E / F` 的共享契约、任务状态机、lobster executor、brain dispatch、Feishu bridge、`/tasks` 页面与总集成入口都已合并进主线，当前 `main` 已具备 mission 首版闭环骨架。
- [x] **中英文切换与移动端适配已收口到 `main`**：默认语言已改为中文，语言切换会持久化；顶部工具栏、工作流面板、配置/聊天/报告等核心界面已完成中英文接入与移动端布局适配。
- [x] **固定 18 智能体已升级为动态组织生成**：服务端会按用户指令自动生成组织结构、角色职责、skills 与 MCP 配置；前端组织与进度视图已能展示动态节点和组织信息。
- [x] **GitHub Pages 预览页已增加仓库入口**：预览模式右上角已展示 GitHub 仓库入口，兼容桌面端与移动端，便于用户直接跳转点 Star。
- [x] **首页场景语气已从固定部门切换到动态 Pod**：顶部模式说明、frontend banner、工作流阶段文案与 3D 场景区块命名已统一改成“动态组队 / 临时战区 / Pod”表达，弱化固定编制感。
- [x] **3D 办公室区块已改造成临时作战区视觉**：四块区域已从规则工位重排为可重组的临时 Pod 家具组合，并接入动态组织数据驱动的区块标题与角色分布。
- [x] **区域标签已完成一轮可读性优化**：去除了拥挤重复的次级标签，只保留更短、更清晰的主标签和分区导视效果。
- [x] **首页不再保留论文入口**：工具栏已移除论文按钮，首页不再挂载 PDF 面板，导航收口为配置 / 工作流 / 对话 / 帮助四个核心入口。
- [x] **加载页已升级为像素风毛玻璃进度卡**：进度页头像改为像素宠物，整体容器与进度条升级为毛玻璃卡片风格，视觉与首页氛围更统一。
- [x] **工作流面板 hooks 崩溃已修复**：已修正 `ProgressView` 中 hooks 调用顺序不稳定的问题，解决“开始执行指令”时前端报 `Rendered more hooks than during the previous render` 的崩溃。
- [x] **Three.js 场景背景已收敛为稳定天空氛围**：已移除不稳定的天空穹顶 / 云层尝试，当前改为更稳定的清透天空底色与室内光感方案。
- [x] **AI 配置统一收口到服务端**：聊天面板与多智能体 workflow 现在共用同一套服务端配置，不再出现“界面显示一个模型、实际执行另一个模型”的分叉。
- [x] **`.env` 成为唯一真源**：当前模型、Base URL、API Key、推理强度等配置只从 `.env` 读取；前端配置面板改为只读展示，并提示“修改 `.env` 后需重启服务”。
- [x] **服务端聊天代理接入完成**：前端聊天面板不再直接请求第三方 `/chat/completions`，统一改走服务端 `/api/chat`，减少前后端配置漂移。
- [x] **Agent 启动模型与 `.env` 对齐**：服务启动时，18 个 agents 的 `model` 会按 `.env` 中的当前模型刷新，保证 workflow 执行链路一致。
- [x] **运行时数据目录已从 Git 跟踪中移除**：`data/agents/*/sessions/`、`data/agents/*/memory/`、`data/agents/*/reports/`、`data/agents/*/SOUL.md`、`data/agents/*/HEARTBEAT.md` 已按 `.gitignore` 预期处理；后续新产生的 runtime 文件不应再进入版本控制。
- [x] **Phase 1 / 5 / 7 / 8 代码已收口到 `main`**：基础隔离、记忆系统、heartbeat 报告与自进化能力都已完成分支合并，当前主线已通过 `npm run check`。
- [x] **Phase PF-1 ~ PF-5 已全部完成并合并到 `main`**：浏览器 runtime、IndexedDB 存储、Worker 事件链路、Browser Direct / Server Proxy 双模式与产品化模式切换已经全部收口到主线。
- [x] **GitHub Pages 静态演示版已打通**：仓库已新增专用的 `build:pages` 构建入口与 Actions 部署工作流，Pages 版本只保留纯前端体验，不影响本地与服务端版本。
- [x] **Pages 子路径兼容问题已修复**：已补齐 GitHub Pages 下的路由 base、3D 模型资源 base 与静态演示模式开关，线上 Live Demo 已可作为公开体验入口。
- [x] **README 已同步对外信息**：仓库首页已补上 Live Demo 链接、GitHub Pages 部署说明与 Star History 展示，便于传播与开源展示。
- [x] **附件上传链路稳定性已补强**：图片 OCR 已切换为独立 worker，补齐超时、降级与日志降噪，上传附件时不再被初始化 warning 干扰。
- [x] **工作流进度面板已完成一轮信息架构重做**：默认先看总进度，再看角色摘要，完整任务明细、反馈与消息流均改为按需展开，降低大任务场景下的扫读成本。
- [x] **首页 3D 场景墙面已进一步简化**：左墙背景板、背墙装饰墙板和部分壁灯已移除，公告板尺寸与便签数量同步收敛，画面更利于聚焦角色分布。

### 当前确认结论

- [x] **`GET /api/config/ai` 为只读配置接口**：接口返回配置来源为 `.env`，并显式标记 `writable: false`。
- [x] **`PUT /api/config/ai` 已移除**：不再支持运行时改写模型配置，避免服务运行期间配置状态与仓库环境变量脱节。
- [x] **TypeScript 检查通过**：`npm run check` 已验证通过。
- [x] **Phase 2 勾选已按当前代码状态回填**：CEO 拆解、经理规划、Worker 执行、前端指令面板与消息流可视化已在现有实现中落地，先前只是 ROADMAP 未同步。

### 下一步执行计划（建议顺序）

当前推荐的主线不是继续堆展示层，而是先把基础层和记忆层补硬，再进入自主行为：

1. **Phase 1 收尾：把“能跑”补成“够硬”**
   - [x] 启动时一次性创建 18 个 agent 工作空间，补齐缺失目录（当前启动时统一 materialize）
   - [x] 将消息总线层级校验从“告警”升级为“强制拦截”
   - [x] 收敛 agent 的工作空间访问入口，避免直接跨目录读写
   - [x] 为基础层补一轮最小验证：注册表、工作空间、层级通信

2. **Phase 5 补强：把记忆系统从摘要检索推进到论文目标版**
   - [x] 补齐当前 workflow 内完整上下文注入，而不只是最近片段
   - [x] 实现中期记忆的 embedding / 向量检索
   - [x] 将长期记忆从数据库 `soul_md` 推进到文件版 `SOUL.md`
   - [x] 明确每个 agent 只能访问自己的 sessions / memory / reports
   - [x] 已先行执行 `phase-5-memory`；若后续与 Phase 1 hardening 的 workspace / 访问接口收敛冲突，再解决冲突

3. **Phase 7 启动：把智能体从“被动执行”推进到“定时自主工作”**
   - [x] 增加 heartbeat 调度器与配置载入
   - [x] 打通自主搜索 / 总结 / 报告生成链路
   - [x] 报告落盘到各自 `reports/`，并在前端补最小可视化状态

4. **Phase 8 收口：做真正的自进化闭环**
   - [x] 关键词学习，沉淀到 `HEARTBEAT.md` 或等价配置层
   - [x] 能力注册表维护，记录 agent 已展示能力
   - [x] 将绩效反馈闭环从“追加 `soul_md`”扩展到文件版 persona 演化

### 近期里程碑建议（按 1-2 周拆分）

- [x] 里程碑 A：完成 Phase 1 未勾选项
- [x] 里程碑 B：完成 Phase 5 未勾选项中的“完整上下文 + 向量检索”
- [x] 里程碑 B+：补齐结构化报告输出链路（部门汇总、CEO 总报告、落盘与查看）
- [x] 里程碑 C：跑通首个 heartbeat 自主报告闭环
- [x] 里程碑 D：完成 Phase 8 的关键词学习与能力注册

### 纯前端模式（主线已完成首轮落地）

这个方向建议作为接下来的高优先级主线之一推进，目标不是简单“删后端”，而是把项目从“需要同时起前后端 + `.env` 配置”推进到“默认纯前端即可运行，服务端变为可选高级模式”。

推荐这个方向的原因：

- [x] **降低启动门槛**：项目已具备默认纯前端运行入口，本地体验不再强依赖同时起前后端与 `.env`。
- [x] **更贴合项目本质**：当前主线已经把重点放回 3D 可视化、多智能体协作过程展示与浏览器内可玩性。
- [x] **更利于传播与开源增长**：仓库现已提供 GitHub Pages Live Demo，更适合分享、试用、Fork 与二次改造。
- [x] **与当前实现方向一致**：浏览器本地 runtime、IndexedDB 和 Worker 路线已经落地，和此前的纯前端主线判断一致。

这条主线的目标状态：

1. **默认纯前端运行**
   - [x] 工作流编排可直接在浏览器中执行
   - [x] 不再强依赖本地 Node 服务端和 `/api` 代理
   - [x] 配置改为浏览器本地保存，并支持导出 / 导入

2. **保留可选高级模式**
   - [x] 保留当前服务端版作为 advanced mode
   - [x] 对不支持浏览器直连的模型服务，允许接入极简代理
   - [x] 纯前端模式与服务端模式尽量复用同一套 workflow 核心逻辑

3. **主线程只负责 UI，运行时迁入 Worker**
   - [x] 将 workflow engine 从服务端抽象为可复用 runtime 层
   - [x] 优先迁移到 Zustand + Web Worker，避免阻塞主线程和 3D 渲染
   - [x] 用 Worker 事件总线替代当前 Socket.IO 的本地联动职责

### 纯前端迁移分阶段计划

1. **Phase PF-1：抽 runtime 内核**
   - [x] 从当前 `workflow-engine`、`agent`、`message-bus` 中提取不依赖 Node 的核心编排逻辑
   - [x] 为 runtime 定义统一接口：workflow repository、memory repository、report repository、event emitter、llm provider
   - [x] 先做到“同一份 workflow 逻辑可被 server mode 与 browser mode 共同调用”

2. **Phase PF-2：浏览器存储替换服务端本地文件**
   - [x] 用 IndexedDB 或等价浏览器存储替代 `database.json`
   - [x] 将 `sessions / memory / reports / SOUL / HEARTBEAT` 从文件系统语义映射到浏览器本地存储
   - [x] 保留导出能力，允许用户将配置、报告、persona 和历史记录下载到本地

3. **Phase PF-3：前端事件与状态收口**
   - [x] 把当前前端对 `/api/workflows`、`/api/agents`、`/api/reports` 的依赖逐步改为本地 runtime 调用
   - [x] 把当前 Socket.IO 实时事件改为 Worker `postMessage` / 本地事件总线
   - [x] 继续复用 Zustand 作为 UI 状态层，但不让 Zustand 直接承担长链路编排执行

4. **Phase PF-4：模型调用前端化**
   - [x] 优先支持可浏览器直连的模型服务
   - [x] 设置页明确提示“默认仅适合本地使用，密钥保存在浏览器端”
   - [x] 为不适合浏览器直连的提供商保留“可选代理 URL”能力
   - [x] 当前已在前端聊天面板接入 Browser Direct / Server Proxy 双模式；workflow engine 仍暂由服务端执行

5. **Phase PF-5：产品化收口**
   - [x] 增加“纯前端模式 / 高级模式”切换说明
   - [x] 默认启动路径优先纯前端模式，减少首次体验成本
   - [x] 在确认纯前端链路稳定前，不删除现有服务端实现

### 纯前端路线的风险与折中

- [ ] **安全折中**：浏览器直连模型意味着 API Key 暴露给本地用户环境，需在设置页明确提示“仅本地使用”
- [ ] **稳定性折中**：浏览器刷新、崩溃、休眠会中断长任务，需要补持久化恢复能力
- [ ] **能力折中**：部分 provider 不支持浏览器直连或 CORS，需要保留极简代理作为兜底
- [ ] **工程折中**：短期内会并行维护 browser mode 与 server mode，但长期可显著降低新用户使用成本

### 报告输出能力（单列说明）

这条能力当前**部分存在，但没有被单列成一个独立子系统**：

- [x] 当前工作流内已存在“报告雏形”：经理 `summary` 汇总、CEO `feedback` 总结、记忆摘要 `workflow_summary`
- [x] 已有统一的“最终报告模型”：部门报告、总报告、关键评分、问题清单、后续建议已收敛成固定结构
- [x] 已有报告落盘：部门报告、最终工作流报告、heartbeat 报告都会稳定写入各自 `reports/`
- [x] 已有报告查看入口：前端工作流面板已提供最终报告概览、部门报告下载与 heartbeat 报告列表
- [x] 已支持报告导出：当前支持 Markdown / JSON 下载；PDF 尚未实现

建议将“报告输出”视为一条横跨 Phase 5 和 Phase 7 的独立主线：

1. **先补工作流结束后的结构化总报告**
   - [x] 定义 workflow final report schema
   - [x] 将部门 summary、review 分数、meta audit、verify 结果、CEO feedback 汇总成一份最终报告
   - [x] 在工作流完成时写入 `data/agents/ceo/reports/` 或 workflow 级别 `reports/`

2. **再补面向每个 agent 的报告沉淀**
   - [x] 经理报告写入各自 `reports/`
   - [x] heartbeat 趋势报告写入各自 `reports/`
   - [x] 让 `reports/` 与 `memory/` 分工明确：前者偏交付物，后者偏检索记忆

3. **最后补报告消费层**
   - [x] 增加报告查询 API
   - [x] 前端增加报告列表 / 报告详情视图
   - [ ] 视需要支持导出与分享（当前已支持下载，未单独做分享链路）

### 当前不建议优先投入的方向

- [ ] 暂不优先继续扩前端展示形态；现有 3D 场景、消息流和仪表盘已足够支撑演示
- [ ] 暂不优先引入新的推荐系统/数据平台模块；当前项目主线仍是多智能体编排，不是推荐引擎
- [ ] 暂不优先重做数据库层；在基础隔离、记忆和 heartbeat 完成前，本地 JSON 仍可支撑迭代
- [ ] 暂不优先为了“纯前端化”去重做视觉层；纯前端主线的重点应放在 runtime、存储、事件总线与配置链路，而不是新增展示特效

### 文档同步状态（2026-03-27）

- [x] `ROADMAP.md` 已补记动态组织前端收口、首页 Pod 化场景改造、标签优化、论文入口移除与加载页视觉升级。
- [x] `README.md` 已更新为当前真实产品口径：动态组织、双运行模式、GitHub Pages 预览、移动端与 3D 场景改造。

### 现阶段仍保留的行为

- [ ] **Session / Memory / SOUL / HEARTBEAT 文件仍会继续生成**：这是当前记忆、回溯与自进化机制的正常行为，不是异常；只是这些文件现在应留在本地 runtime 数据中，而不是进入 Git。
- [ ] **ROADMAP 旧段落存在历史内容与部分乱码**：本次先补充最新进度，尚未对整份文档做全文清洗或重构。

## 当前实现状态 (2026-03-25 更新)

**核心达成：**
- [x] **全栈编排系统**：实现了从展示页面到多智能体层级委派系统的完整转型。
- [x] **十阶段管道**：实现了论文描述的完整闭环（方向->规划->执行->评审->审计->修订->验证->汇总->反馈->进化）。
- [x] **3D 实时联动**：前端 3D 宠物根据后端工作流状态实时改变行为。
- [x] **本地零配置运行**：采用本地 JSON 数据库替代 MySQL，方便快速部署。

---
项目现在是论文的 **3D 可视化前端**：5 只宠物在温馨书房里"工作"，用户可以点击聊天、看 PDF、配 API。后端是一个只提供静态文件的 Express 服务器。

**与论文系统的核心差距：没有智能体间通信、没有层级委派、没有工作流管道。**

## 目标状态

实现论文描述的核心架构：用户输入一条指令 → CEO 分解 → 经理规划 → Worker 执行 → 评审 → 修订 → 汇总，前端 3D 场景实时展示每个智能体的工作状态。

## 技术选型建议

- **后端**：复用现有 Express 服务器，扩展为 WebSocket + REST API
- **数据库**：MySQL 8.x（远程实例，mysql2 驱动 + 连接池）
- **LLM 调用**：复用现有 AI Config 中的 OpenAI 兼容 API
- **实时通信**：Socket.IO（前端已有基础设施）
- **文件系统隔离**：Node.js fs 模块，每个智能体独立目录

---

## Phase 0：基础设施准备（预计 2-3 天）

**目标：让后端从"静态文件服务器"变成"能跑逻辑的应用服务器"。**

### 0.1 后端 API 框架

当前 `server/index.ts` 只有一个 `app.get("*")` 路由。需要扩展为：

```
server/
├── index.ts              # 入口，挂载路由和 WebSocket
├── routes/
│   ├── agents.ts         # GET/POST 智能体相关 API
│   ├── workflows.ts      # 工作流执行 API
│   └── config.ts         # 系统配置 API
├── core/
│   ├── agent.ts          # Agent 基类定义
│   ├── registry.ts       # 智能体注册表
│   ├── llm-client.ts     # LLM API 调用封装
│   └── message-bus.ts    # 智能体间消息总线
├── memory/
│   ├── workspace.ts      # 文件系统工作空间管理
│   └── session-store.ts  # 会话历史存储
└── db/
    ├── schema.sql        # MySQL 表结构
    ├── seed.ts           # 18 个智能体初始数据
    └── index.ts          # MySQL 连接池
```

### 0.2 数据库 Schema

环境变量配置（`.env`）：

```dotenv
DB_HOST=your_db_host
DB_PORT=your_db_port
DB_NAME=whybuddy
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

连接池封装（`server/db/index.ts`）：

```typescript
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,       // 并发智能体调用时足够
  queueLimit: 0,
  charset: 'utf8mb4',        // 中文内容 + emoji 支持
  timezone: '+08:00',
});

export default pool;

// 便捷查询方法
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: any[]) {
  const [result] = await pool.execute(sql, params);
  return result;
}
```

MySQL 表结构（`server/db/schema.sql`）：

```sql
CREATE DATABASE IF NOT EXISTS whybuddy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE whybuddy;

-- ============================================================
-- 智能体定义（对应三文件规范中的静态配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(32) PRIMARY KEY,            -- 'blaze', 'tensor', 'pixel'...
  name VARCHAR(64) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  role ENUM('ceo','manager','worker') NOT NULL,
  manager_id VARCHAR(32) DEFAULT NULL,   -- 上级 ID（CEO 为 NULL）
  model VARCHAR(64) DEFAULT 'gpt-4o',    -- 可替换执行器
  soul_md TEXT,                           -- SOUL.md 内容
  heartbeat_config JSON,                  -- HEARTBEAT.md 配置
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department),
  INDEX idx_role (role),
  FOREIGN KEY (manager_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 工作流运行记录
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id VARCHAR(36) PRIMARY KEY,              -- UUID
  directive TEXT NOT NULL,                  -- 用户原始指令
  status ENUM('pending','running','completed','failed') DEFAULT 'pending',
  current_stage VARCHAR(32) DEFAULT NULL,
  departments_involved JSON,               -- ['game','ai','life']
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  results JSON,                            -- 最终汇总结果
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ============================================================
-- 智能体间消息（通信记录）
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  from_agent VARCHAR(32) NOT NULL,
  to_agent VARCHAR(32) NOT NULL,
  stage VARCHAR(32) NOT NULL,              -- 'direction','planning','execution'...
  content MEDIUMTEXT NOT NULL,             -- 消息内容（可能很长）
  metadata JSON,                           -- 评分、附件等结构化数据
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_to_agent (to_agent, workflow_id),
  INDEX idx_stage (workflow_id, stage),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 任务分配与评分
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  worker_id VARCHAR(32) NOT NULL,
  manager_id VARCHAR(32) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  description TEXT NOT NULL,
  deliverable MEDIUMTEXT,                  -- Worker 产出（v1）
  deliverable_v2 MEDIUMTEXT,               -- 修订后产出（v2）
  deliverable_v3 MEDIUMTEXT,               -- 二次修订（v3，如有）
  score_accuracy TINYINT UNSIGNED,          -- 0-5
  score_completeness TINYINT UNSIGNED,
  score_actionability TINYINT UNSIGNED,
  score_format TINYINT UNSIGNED,
  total_score TINYINT UNSIGNED,             -- 0-20
  manager_feedback TEXT,                    -- 经理反馈
  meta_audit_feedback TEXT,                 -- 元部门审计反馈
  verify_result JSON,                       -- 验证阶段逐条确认结果
  version TINYINT UNSIGNED DEFAULT 1,       -- 当前版本 1/2/3
  status ENUM('assigned','executing','submitted','reviewed',
              'audited','revising','verified','passed','failed') DEFAULT 'assigned',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_worker (worker_id),
  INDEX idx_status (status),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 进化日志（M7 自进化子系统）
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  workflow_id VARCHAR(36),                  -- 触发进化的工作流
  dimension VARCHAR(32),                    -- accuracy/completeness/actionability/format
  old_score DECIMAL(3,1),
  new_score DECIMAL(3,1),
  patch_content TEXT,                       -- SOUL.md 补丁内容
  applied TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agent_id),
  INDEX idx_workflow (workflow_id)
) ENGINE=InnoDB;

-- ============================================================
-- 关键词学习表（M7-2）
-- ============================================================
CREATE TABLE IF NOT EXISTS heartbeat_keywords (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  category ENUM('effective','neutral','ineffective') DEFAULT 'neutral',
  correlation DECIMAL(4,3) DEFAULT 0.000,   -- 与高分的相关系数
  occurrence_count INT UNSIGNED DEFAULT 0,
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_keyword (agent_id, keyword),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB;

-- ============================================================
-- 能力注册表（M7-3）
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  capability VARCHAR(256) NOT NULL,
  confidence DECIMAL(4,3) DEFAULT 0.500,    -- EMA 置信度
  demo_count INT UNSIGNED DEFAULT 0,         -- 成功展示次数
  last_demonstrated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_cap (agent_id, capability(191)),
  INDEX idx_agent (agent_id),
  INDEX idx_confidence (confidence DESC)
) ENGINE=InnoDB;
```

### 0.3 WebSocket 实时通道

前端需要实时看到智能体在做什么。用 Socket.IO 推送事件：

```typescript
// 事件类型
type AgentEvent =
  | { type: 'stage_change'; workflowId: string; stage: string }
  | { type: 'agent_active'; agentId: string; action: string }
  | { type: 'message_sent'; from: string; to: string; preview: string }
  | { type: 'score_assigned'; taskId: number; score: number }
  | { type: 'workflow_complete'; workflowId: string; summary: string };
```

### 0.4 交付物

- [x] Express 服务器可运行 REST API 和 WebSocket
- [x] 本地 JSON 数据库 (database.json) + 18 个智能体种子数据
- [x] LLM Client 封装 (支持 gpt-4.1-mini)
- [x] `.env` 已统一管理 AI 配置与 API 密钥（当前默认使用本地 JSON 数据库，无需数据库连接配置）
- [x] 前端 WebSocket 连接建立

---

## Phase 1：智能体基础层（预计 3-4 天）

**目标：每个智能体有独立身份、独立记忆、可被独立调用。**

### 1.1 Agent 基类

```typescript
// server/core/agent.ts
interface AgentConfig {
  id: string;
  name: string;
  department: string;
  role: 'ceo' | 'manager' | 'worker';
  managerId: string | null;
  model: string;
  soulMd: string;
}

class Agent {
  config: AgentConfig;
  workspace: AgentWorkspace;   // 独立文件系统目录

  // 核心方法
  async invoke(prompt: string, context?: string[]): Promise<string>;
  async sendMessage(toAgentId: string, content: string): void;
  async getHistory(limit?: number): Promise<Message[]>;
}
```

### 1.2 文件系统工作空间隔离

```
data/agents/
├── pixel/              # 游戏部经理
│   ├── SOUL.md
│   ├── AGENTS.md       # 共享只读
│   ├── HEARTBEAT.md
│   └── sessions/       # 会话历史 JSONL
├── blaze/              # 游戏部 Worker
│   ├── SOUL.md
│   ├── ...
├── nexus/              # AI 部经理
│   ├── ...
└── ...（18 个目录）
```

关键：每个智能体的 `invoke()` 方法只读取自己的 SOUL.md 和 sessions/，绝不访问其他目录。

当前代码状态（2026-03-26）：
- 智能体 persona 当前存储在数据库 `soul_md` 字段，而不是磁盘 `SOUL.md` 文件
- `sessions/`、`memory/`、`reports/` 目录已实现，但工作空间目录按需创建，不是 18 个目录在启动时一次性全部落盘
- 目前仍属于“约定式隔离”，还不是严格文件系统隔离

### 1.3 SOUL.md / soul_md 初始配置

为论文中的 18 个智能体编写初始 SOUL 配置。可以从论文附录 A 的模板出发，每个配置包含：

- 身份定义（名称、部门、汇报关系）
- 专业领域
- 输出格式要求
- 行为规则

### 1.4 消息总线

```typescript
// server/core/message-bus.ts
class MessageBus {
  // 发送消息（自动校验层级约束）
  async send(from: string, to: string, content: string, workflowId: string): Promise<void>;

  // 层级校验：CEO↔Manager, Manager↔Worker（同部门内），阻止越级
  private validateHierarchy(from: Agent, to: Agent): boolean;

  // 获取某智能体的收件箱
  async getInbox(agentId: string, workflowId?: string): Promise<Message[]>;
}
```

### 1.5 前端：智能体状态面板

在 3D 场景中，每只宠物上方显示当前状态标签：

```
🟢 空闲 | 🟡 思考中... | 🔵 执行任务 | 🟠 等待评审 | ✅ 完成
```

### 1.6 交付物

- [x] 18 个智能体已注册进系统（数据库）
- [x] 18 个智能体的工作空间目录启动即完整落盘
- [x] 初始 persona 配置完成（数据库 `soul_md` 与文件版 `SOUL.md` 已同步）
- [x] 消息总线可发送/接收
- [x] 消息总线层级校验强制执行
- [x] 前端能实时显示智能体状态

---

## Phase 2：层级委派与 CEO 网关（预计 3-4 天）

**目标：实现"单指令动员"——用户说一句话，CEO 自动分解并下发给各部门经理。**

### 2.1 CEO 网关

```typescript
// server/core/ceo-gateway.ts
class CEOGateway {
  async processDirective(directive: string): Promise<WorkflowRun> {
    // 1. 创建工作流记录
    const workflow = await db.createWorkflow(directive);

    // 2. 调用 CEO Agent 分析指令
    //    CEO 的 system prompt 要求它：
    //    - 判断需要哪些部门参与
    //    - 为每个参与部门生成具体方向指令
    //    - 输出结构化 JSON
    const ceoResponse = await this.ceoAgent.invoke(
      `分析以下战略指令，确定需要哪些部门参与，并为每个部门生成具体方向：\n${directive}`,
    );

    // 3. 解析 CEO 输出，向各经理发送方向指令
    const departments = parseCEOResponse(ceoResponse);
    for (const dept of departments) {
      await this.messageBus.send('ceo', dept.managerId, dept.direction, workflow.id);
    }

    // 4. 触发下一阶段（规划）
    await this.startStage(workflow.id, 'planning');

    return workflow;
  }
}
```

### 2.2 经理规划逻辑

```typescript
// server/core/manager.ts
class ManagerAgent extends Agent {
  async planTasks(direction: string, workflowId: string): Promise<Task[]> {
    // 经理收到 CEO 方向后：
    // 1. 分析方向，分解为 Worker 级任务
    // 2. 根据 Worker 能力分配任务
    // 3. 通过消息总线下发给各 Worker
    const plan = await this.invoke(
      `你收到了以下部门方向：\n${direction}\n\n` +
      `你的团队成员：${this.getWorkerList()}\n\n` +
      `请为每个 Worker 分配具体任务。输出 JSON 格式。`
    );

    const tasks = parsePlan(plan);
    for (const task of tasks) {
      await this.messageBus.send(this.id, task.workerId, task.description, workflowId);
      await db.createTask(workflowId, task);
    }
    return tasks;
  }
}
```

### 2.3 前端：指令输入与组织图

替换现有的简单聊天窗口，新增一个"指令面板"：

- 顶部输入框：输入战略指令（如"本周聚焦用户增长"）
- 下方实时显示组织图（CEO → 经理 → Worker）
- 消息流动时，3D 场景中对应的宠物之间出现粒子/光线动画

### 2.4 交付物

- [x] CEO 网关可接收指令并分解
- [x] 经理可接收方向并分配任务给 Worker
- [x] Worker 可接收任务并执行（当前已进入完整工作流，而非仅单轮执行）
- [x] 前端指令输入面板 + 消息流可视化

---

## Phase 3：工作流管道 V2（预计 4-5 天）

**目标：实现七阶段工作流管道（方向→规划→执行→评审→修订→汇总→反馈）。**

### 3.1 工作流引擎

```typescript
// server/core/workflow-engine.ts
const V2_STAGES = [
  'direction',   // CEO → 经理：下发方向
  'planning',    // 经理：分解任务
  'execution',   // Worker：执行任务，提交 v1
  'review',      // 经理：评分 (0-20) 并反馈
  'revision',    // Worker：依据反馈修订为 v2
  'summary',     // 经理：为 CEO 综合汇报
  'feedback',    // CEO：评估部门绩效
] as const;

class WorkflowEngine {
  async runStage(workflowId: string, stage: Stage): Promise<void> {
    switch (stage) {
      case 'direction':
        // CEO 分解指令给各经理
        break;
      case 'planning':
        // 各经理并行规划任务
        break;
      case 'execution':
        // 各 Worker 并行执行
        break;
      case 'review':
        // 经理评审 Worker 产出
        break;
      case 'revision':
        // 评分 <16 的 Worker 修订
        break;
      case 'summary':
        // 经理汇总部门结果
        break;
      case 'feedback':
        // CEO 总评
        break;
    }

    // 自动推进到下一阶段
    const nextStage = getNextStage(stage);
    if (nextStage) {
      await this.runStage(workflowId, nextStage);
    }
  }
}
```

### 3.2 评审机制（20 分制）

```typescript
// server/core/reviewer.ts
interface ReviewScore {
  accuracy: number;      // 0-5
  completeness: number;  // 0-5
  actionability: number; // 0-5
  format: number;        // 0-5
  total: number;         // 0-20
  feedback: string;      // 具体改进建议
}

class ReviewProcess {
  async review(managerId: string, task: Task): Promise<ReviewScore> {
    const score = await this.managerAgent.invoke(
      `评审以下交付物。按四个维度评分（每项0-5分）：\n` +
      `准确性：事实正确性、引用来源\n` +
      `完整性：所有必要部分是否齐全\n` +
      `可操作性：下一步是否清晰、可实现\n` +
      `格式：是否遵循模板、结构是否规范\n\n` +
      `任务描述：${task.description}\n` +
      `Worker 交付物：${task.deliverable}\n\n` +
      `输出 JSON 格式评分和反馈。`
    );
    return parseReviewScore(score);
  }

  // 评分 ≥16 通过，10-15 退回修订，<10 拒绝
  getVerdict(score: ReviewScore): 'pass' | 'revise' | 'reject' {
    if (score.total >= 16) return 'pass';
    if (score.total >= 10) return 'revise';
    return 'reject';
  }
}
```

### 3.3 前端：工作流进度面板

新增一个可展开的工作流面板，显示：

```
📊 工作流进度
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[✅ 方向] → [✅ 规划] → [🔵 执行] → [⬜ 评审] → [⬜ 修订] → [⬜ 汇总] → [⬜ 反馈]

游戏部 (Pixel)
  ├─ Blaze: 🔵 执行中... "设计春节活动方案"
  ├─ Lyra:  🔵 执行中... "策划玩家参与机制"
  └─ Nova:  ✅ 已提交 v1

AI 部 (Nexus)
  ├─ Tensor: 🔵 执行中...
  └─ Quark:  🟡 等待任务...
```

3D 场景中，正在"执行"的宠物动画加速，"等待"的宠物 idle。

### 3.4 交付物

- [x] 十阶段工作流管道可完整运行
- [x] 20 分制评审打分功能正常
- [x] 评分 <16 触发自动修订
- [x] 前端工作流进度可视化
- [x] 所有中间消息记录到数据库

---

## Phase 4：工作流管道 V3（预计 3-4 天）

**目标：在 V2 基础上新增三个阶段，完成十阶段管道。**

### 4.1 新增阶段

```
V2:  方向 → 规划 → 执行 → 评审       → 修订 → 汇总 → 反馈
V3:  方向 → 规划 → 执行 → 评审 → [元审计] → 修订 → [验证] → 汇总 → 反馈 → [进化]
                                  ↑ 新增      ↑ 新增                  ↑ 新增
```

### 4.2 元审计阶段（阶段 5）

经理评审完成后，Warden 和 Prism 两个元部门智能体对 Worker 产出做独立审计：

```typescript
async metaAudit(workflowId: string, tasks: Task[]): Promise<AuditResult[]> {
  // Warden: SOUL.md 合规检查 — Worker 输出是否符合其角色定义
  const wardenAudit = await this.warden.invoke(
    `检查以下交付物是否符合 Worker 的 SOUL.md 规范：\n${taskSummary}`
  );

  // Prism: 质量分析 — 是否存在 AI 套话、结构问题
  const prismAudit = await this.prism.invoke(
    `分析以下交付物的质量问题，检查是否存在 AI 套话、内容空洞等问题：\n${taskSummary}`
  );

  return [wardenAudit, prismAudit];
}
```

### 4.3 验证阶段（阶段 7）

经理逐条确认修订是否回应了全部反馈点：

```typescript
async verify(task: Task): Promise<VerifyResult> {
  // 经理收到：原始反馈点列表 + 修订后的 v2
  // 逐条确认是否回应，>30% 未回应则要求 v3
  const result = await this.manager.invoke(
    `原始反馈：\n${task.feedback}\n\n` +
    `修订后交付物：\n${task.deliverable_v2}\n\n` +
    `逐条确认每个反馈点是否被回应。输出 JSON。`
  );
  return parseVerifyResult(result);
}
```

### 4.4 进化阶段（阶段 10）

纯脚本，不调用 LLM：

```typescript
async evolve(workflowId: string): Promise<void> {
  // 1. 从数据库提取本轮所有评分
  const scores = await db.getScoresForWorkflow(workflowId);

  // 2. 识别弱维度（<3/5）
  for (const agentScores of groupByAgent(scores)) {
    const weakDimensions = findWeakDimensions(agentScores);

    // 3. 生成 SOUL.md 补丁
    if (weakDimensions.length > 0) {
      const patch = generatePatch(agentScores.agentId, weakDimensions);
      await db.saveEvolutionLog(agentScores.agentId, patch);

      // 4. 自动应用到 SOUL.md
      await applyPatch(agentScores.agentId, patch);
    }
  }
}
```

### 4.5 交付物

- [x] 十阶段 V3 管道完整运行
- [x] 元审计（Warden + Prism）独立于经理评审
- [x] 验证阶段逐条确认反馈回应
- [x] 进化阶段自动生成并应用 SOUL.md / HEARTBEAT.md 更新

---

## Phase 5：记忆系统完善（预计 2-3 天）

**目标：实现三级记忆架构。**

### 5.1 短期记忆

当前会话的完整消息历史，直接作为 LLM 上下文传入。

### 5.2 中期记忆

使用向量嵌入存储历史会话，按语义相似度检索：

```typescript
// 可选方案（按复杂度递增）：
// A. 简单方案：MySQL FULLTEXT 全文搜索索引（InnoDB 原生支持）
// B. 中等方案：本地向量库（如 vectra，纯 JS 实现）
// C. 完整方案：外部向量数据库（如 Chroma）

class MidTermMemory {
  async search(agentId: string, query: string, topK: number = 5): Promise<MemoryChunk[]>;
  async store(agentId: string, content: string, metadata: any): Promise<void>;
}
```

建议从方案 A 开始（零依赖），后续按需升级。

### 5.3 长期记忆

目标态是 SOUL.md 文件本身。每次智能体调用时完整读入。进化阶段自动追加 `## Learned Behaviors` 章节。

当前代码状态（2026-03-26）：
- 已实现 persona 长期记忆，但当前落在数据库 `soul_md` 字段
- `evolution` 阶段已能自动给 `soul_md` 追加 learned behaviors
- 文件版 `SOUL.md` 已落地，并与数据库 `soul_md` 保持同步

### 5.4 交付物

- [x] 短期记忆：最近会话上下文注入已实现
- [x] 短期记忆：当前工作流内的完整上下文
- [x] 中期记忆：历史工作流可检索摘要（当前为摘要 + 关键词检索）
- [x] 中期记忆：向量检索 / embedding 召回
- [x] 长期记忆：persona / `soul_md` 自动更新
- [x] 长期记忆：文件版 `SOUL.md` 自动更新
- [x] 记忆严格隔离：每个智能体只能访问自己的记忆

### 5.5 实施备注（`phase-5-memory`）

目标：完整上下文、向量检索、`SOUL.md` 文件化、记忆隔离。

主写文件：
- `server/memory/session-store.ts`
- `server/core/agent.ts`
- `server/routes/agents.ts`

可新增文件：
- `server/memory/vector-store.ts`
- `server/memory/soul-store.ts`

冲突高风险：
- `server/core/agent.ts` 会与 Phase 1 hardening 的 workspace / 访问接口收敛产生明显重叠，合并时需要特别注意

建议：
- 已先行执行 `phase-5-memory`；后续如与 Phase 1 hardening 冲突，再按接口收敛结果解决

---

## Phase 6：前端深度集成（预计 4-5 天）

**目标：3D 场景从"装饰"变成"实时监控仪表盘"。**

### 6.1 智能体数量扩展

从 5 只宠物扩展到论文的 18 个智能体。3D 场景布局重新设计：

```
布局方案：四个部门区域
┌──────────────────────────────────┐
│            CEO 桌 (顶部中央)       │
│                                    │
│  ┌─────────┐  ┌─────────┐        │
│  │ 游戏部   │  │  AI 部   │        │
│  │ Pixel    │  │ Nexus    │        │
│  │ 4 Worker │  │ 4 Worker │        │
│  └─────────┘  └─────────┘        │
│                                    │
│  ┌─────────┐  ┌─────────┐        │
│  │ 生活部   │  │ 元部门   │        │
│  │ Echo     │  │ Warden   │        │
│  │ 2 Worker │  │ 3 Worker │        │
│  └─────────┘  └─────────┘        │
└──────────────────────────────────┘
```

### 6.2 实时动画映射

| 工作流阶段 | 3D 场景表现 |
|-----------|-----------|
| 方向下发 | CEO 宠物头顶出现💬，光线射向各经理 |
| 规划 | 经理宠物面前出现📋规划板动画 |
| 执行 | Worker 快速打字/翻书/讨论动画 |
| 评审 | 经理走向 Worker，头顶出现评分数字 |
| 元审计 | 元部门宠物亮起🔍扫描光线 |
| 修订 | 被退回的 Worker 头顶出现⚠️，加速工作 |
| 汇总 | 经理向 CEO 方向走动，递交📊 |
| 进化 | 场景全体宠物短暂发光✨ |

### 6.3 消息流可视化

智能体间发送消息时，3D 场景中显示飘动的消息气泡，沿层级路径移动（CEO → 经理 → Worker 的粒子流）。

### 6.4 仪表盘面板

替换现有的简单聊天面板，新增多个可切换的视图：

- **指令视图**：输入战略指令，查看 CEO 分解结果
- **组织视图**：实时组织结构图（树状），显示每个节点的状态
- **工作流视图**：十阶段进度条 + 每个阶段的详情
- **评审视图**：所有 Worker 的评分卡片，四维度雷达图
- **历史视图**：过往工作流列表，可回放

### 6.5 交付物

- [x] 18 个智能体在 3D 场景中布局
- [x] 工作流阶段与宠物动画实时联动
- [x] 消息流粒子动画
- [x] 仪表盘多视图面板 (指令、组织、进度、评审、历史、记忆)

---

## Phase 7：心跳与自主行为（预计 2 天）

**目标：智能体能在无人触发时自主工作。**

### 7.1 心跳调度器

```typescript
// server/core/heartbeat.ts
class HeartbeatScheduler {
  // 每 6 小时触发一次（可配置）
  async tick(agentId: string): Promise<void> {
    const config = await this.loadHeartbeatConfig(agentId);

    // 1. 执行网络搜索（模拟，或调用搜索 API）
    const searchResults = await this.search(config.keywords);

    // 2. 让智能体总结搜索结果
    const report = await agent.invoke(
      `基于以下搜索结果，撰写简要趋势报告：\n${searchResults}`
    );

    // 3. 保存到工作空间
    await agent.workspace.saveReport(report);
  }
}
```

### 7.2 前端：自主活动指示

宠物定期自动执行搜索和报告时，头顶显示 🔍 图标和搜索关键词。

### 7.3 交付物

- [x] 心跳调度器按配置间隔触发
- [x] 智能体自主生成趋势报告
- [x] 报告保存到各自工作空间

---

## Phase 8：自进化子系统（预计 3 天）

**目标：实现论文 M7 的三个并行学习闭环。**

### 8.1 绩效反馈闭环（M7-1）

```typescript
// 从评审评分中识别弱维度 → 生成 SOUL.md 补丁
async analyzePerformance(agentId: string): Promise<Patch | null> {
  const recentScores = await db.getRecentScores(agentId, 5);
  const weakDimensions = recentScores
    .flatMap(s => [
      { dim: 'accuracy', score: s.accuracy },
      { dim: 'completeness', score: s.completeness },
      { dim: 'actionability', score: s.actionability },
      { dim: 'format', score: s.format },
    ])
    .filter(d => d.score < 3);

  if (weakDimensions.length === 0) return null;

  return generateSOULPatch(agentId, weakDimensions);
}
```

### 8.2 关键词学习（M7-2）

跟踪高分/低分交付物中的关键词，更新 HEARTBEAT.md。

### 8.3 能力注册（M7-3）

从执行日志中提取已展示的能力，维护动态注册表。

### 8.4 交付物

- [x] 绩效反馈 → `SOUL.md` / `soul_md` 同步演化
- [x] 关键词分析 → HEARTBEAT.md 优化
- [x] 能力注册表维护

---

## 里程碑总结

| Phase | 里程碑 | 预计工期 | 论文对应 |
|-------|--------|---------|---------|
| 0 | 后端基础设施 | 2-3 天 | 基础 |
| 1 | 18 个独立智能体 | 3-4 天 | 原则 2,3：独立记忆 |
| 2 | CEO 网关 + 层级委派 | 3-4 天 | 原则 1：层级委派 |
| 3 | V2 七阶段管道 | 4-5 天 | 原则 8：工作流映射 |
| 4 | V3 十阶段管道 | 3-4 天 | 原则 4,6：元部门+自进化 |
| 5 | 三级记忆系统 | 2-3 天 | 原则 3：分层压缩 |
| 6 | 前端深度集成 | 4-5 天 | 可视化 |
| 7 | 心跳自主行为 | 2 天 | 心跳机制 |
| 8 | 自进化子系统 | 3 天 | 原则 6：自进化 |
| **总计** | | **~26-35 天** | |

## 优先级建议

如果时间有限，**Phase 0→1→2→3 是最小可行产品（MVP）**，大约 12-16 天可以实现：

> 用户输入一条指令 → CEO 分解 → 经理规划 → Worker 执行 → 经理评审 → 修订 → 汇总

这已经能展示论文 80% 的核心主张（意图放大、层级委派、独立记忆、评审机制）。

Phase 4-8 是锦上添花：元审计、进化、心跳。这些在论文中也被标记为"初步验证"的能力，生产系统中可以后续迭代。

## 风险与注意事项

1. **LLM 调用成本**：十阶段管道每次运行需要 13-39 次 API 调用。开发阶段建议用便宜的模型（如 GPT-4o-mini），并缓存重复调用。

2. **响应时间**：完整十阶段管道可能需要 5-30 分钟。前端必须做好异步 + 实时进度推送，不能让用户干等。

3. **错误处理**：LLM 输出不可控，每次 `invoke()` 都要做 JSON 解析容错。建议定义 fallback 策略（重试 3 次、降级为简单文本输出）。

4. **Prompt Engineering**：系统质量 80% 取决于 SOUL.md 和各阶段的 system prompt 质量。建议把 prompt 全部外置为配置文件，方便快速迭代。

5. **并发控制**：多部门并行执行时要注意 API rate limit。建议实现请求队列，控制并发数。

6. **MySQL 远程连接注意事项**：
   - 确保数据库服务对部署机器开放相应访问端口
   - 确保 root 账户允许远程登录（`GRANT ALL ON whybuddy.* TO 'root'@'%'`）
   - 生产环境建议新建专用账户，避免 root 直连
   - `MEDIUMTEXT` 字段存储智能体交付物，单条最大 16MB，足够容纳长文本产出
   - 连接池 `connectionLimit: 10` 可应对 18 个智能体并行调用（因为不是所有智能体同时活跃）
   - `.env` 文件已加入 `.gitignore`，不要提交到版本控制

7. **新增依赖**：
   ```bash
   pnpm add mysql2 dotenv
   pnpm add -D @types/node
   ```
## 2026-04-15 Runtime Addendum

This roadmap keeps the historical content below unchanged and adds a current-state supplement only.

- Local Docker path now maps to `real`
- Local no-Docker path now maps to `native`
- GitHub Pages remains frontend-only and should not be described as an executor mode

Reference:

- `.kiro/steering/2026-04-15-runtime-current-state.md`
- `docs/architecture-runtime-2026-04-15.svg`
