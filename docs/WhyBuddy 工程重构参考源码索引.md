# WhyBuddy 工程重构参考源码索引

核验日期：2026-09-13。对应 [工程运行与浏览器验证整体重构方案](<WhyBuddy 工程运行与浏览器验证整体重构方案.md>)，产品基线 `f961c2956f389bce39cb3e34bef54ac56537cc10`。

本轮从 GitHub 拉取 **28 个参考仓库**，覆盖沙盒、私有预览传输、浏览器操作与断言、Agent 工具执行、工程工作台。源码统一放在 [whybuddy-runtime-references](../../whybuddy-runtime-references)，与 WhyBuddy、grok-build 并列；已经加入 [2686WhyBuddy.code-workspace](../2686WhyBuddy.code-workspace)。打开这个 workspace 即可在资源管理器看到「工程重构参考源码」。

每个仓库都固定了收录时实际读取的 commit，核验 Git 工作树和实际许可证，并标出具体函数所在文件。完整快照见 [reference-sources.lock.json](reference-sources.lock.json)。源码收录本身不代表集成；后续已经采用的能力单列如下，工程阶段的完成状态仍以原方案中的真实验收为准。

## 根基与复用顺序（2026-09-13 确认）

**以当前 WhyBuddy 架构为根基，grok-build 为首要对照；另外 28 个源码库按具体缺口补充能力。** 现有 Python 控制循环、问卷与计划批准、持久会话与操作、单写租约、React 工作台和自动生成的依赖架构继续演进。参考仓库不能另起一套 Agent 主循环，也不能替换现有权威状态。

架构仍通过 `pnpm run arch:emit` 生成，通过 `pnpm run arch:check` 检查 Python / TS / 全仓 / grok；不手改权威图，不扩大违规或循环基线。

本批“运行中的源码补丁”优先对照 grok-build `SOURCE_REV=c4ea71cfdbcdb21e32e41bc25a0043d7d4836714`：

| grok-build 实际源码 | 采用的行为 | WhyBuddy 落点 |
|---|---|---|
| [WorkspaceSession](../../grok-build/crates/codegen/xai-grok-workspace/src/session/mod.rs#L104)、[build_session_context](../../grok-build/crates/codegen/xai-grok-workspace/src/session/tool_config.rs#L345) | 会话持有 workspace 与 filesystem 能力，工具共享执行上下文 | 当前 `ProjectRuntimeSupervisor` 保持唯一运行所有者，`runtime.patch` 排入它的持久队列 |
| [SessionToolHandle.execute](../../grok-build/crates/codegen/xai-grok-workspace/src/handle.rs#L4648) | 同一会话工具集执行并返回明确结果 | `ProjectTools.project_patch` 提交并返回 operationId；现有工具循环通过 `project_status` 查询完成/失败/取消 |
| [search_replace](../../grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/search_replace/mod.rs#L527)、[FileWritten](../../grok-build/crates/codegen/xai-grok-tools/src/notification/types.rs#L174) | 先读旧内容、拒绝冲突，实际写成功后才记录前后内容 | `prepare_source_patch` 校验文件 hash；不可变 revision 记录源码；同步成功并确认运行版本后才返回 `synchronized:true` |

这里复用的是职责和行为合同，按现有 Python 代码改写，未整段搬入 Rust 执行器。持久补丁队列、SQL CAS、E2B 同步与私有预览版本轮换是 WhyBuddy 针对现有存储/租约补齐的能力。grok 的 `search_replace` 在真实文件 IO 前已经释放资源锁，不提供本仓的跨进程 CAS；其多文件部分成功及仅记账的部分取消路径，也不作为 WhyBuddy 的原子性或真实停止保证。当前 grok 根许可证为 Apache-2.0，见 [LICENSE](../../grok-build/LICENSE)。

完整预览联调见重构方案第 24 节，新增独立浏览器检查见第 25 节。其他参考库继续补充传输、浏览器和 UI，不因收录数量改变底层架构。

此前沿原有结构完成实际 Python 权威、E2B worker、独立网关和完整工作台联调，补上账号撤权、提示词与工具能力一致性、空闲活动、并发停止、SQLite 并发以及 CSP 配置边界。这里没有新引入一个参考项目来替换底座；使用当前 SQLAlchemy、Vite、Playwright 等已有能力修复真实组合。成功产品样本为 `artifacts/project-product/1789240211-907ad18a/report.json`。真实模型已完成过运行中源码修改，但完整 live-edit 因上游 content_filter 仍未通过，不能与夹具选择工具的产品样本合并为自主交付成功。

## 2026-09-13 独立浏览器检查的采用清单

本批继续复用 grok-build 的会话资源所有者与工具动作/结果合同：`runtime.verify` 和已有 `runtime.patch` 由同一个 Python runtime worker 串行执行。SQL 记录、当前批准、revision 和租约仍由 WhyBuddy 决定；新增参考源码负责真实浏览器能力。

| 来源与固定版本 | 已采用的具体部分 | WhyBuddy 落点与实际边界 |
|---|---|---|
| grok-build `c4ea71cfdbcdb21e32e41bc25a0043d7d4836714`，上述 WorkspaceSession / SessionToolHandle | 同一会话持有执行上下文，工具返回可检查结果；恢复先确认所有权 | 原控制循环新增 `project_verify` / `project_verification`；运行子任务和中断恢复使用现有SQL租约。没有搬入另一套Rust主循环。 |
| Playwright `d1ead3ecca23182f2d06d761c28e3d4edafb6595`，`packages/playwright/src/matchers/matchers.ts`、`toBeTruthy.ts` | 实际执行 locator 断言、等待真实状态，而非记录一句验证描述 | `server/project-verification/browser-runner.mjs` 使用公开 `await expect`、click、reload；运行依赖和浏览器固定为已安装且实测的 **1.61.1**，参考源码快照是较新的 main，不混称同一版本。 |
| 同一 Playwright 快照的 browserContext / frames / tracing | 独立 context、资源生命周期、真实网络/控制台观察和截图 | 单独E2B验证实例；实际请求只到本次预览来源。trace/HAR可能含票据/Cookie，脱敏合同未完，因此本批只存受限结构与PNG。 |
| Playwright MCP `8a13ef8e9f7385a0f89477922127f31cbfde9761` 及主仓 `tools/backend/verify.ts` | 参考类型化验证意图，同时核实其 `addAction` 只记录动作的边界 | 没有把MCP的Done当作通过。七个固定断言全部实际执行，由Python验证完整性并保存；生成页面自行输出passed不起作用。 |

Playwright 使用已有 Apache-2.0 npm 包及其许可文件；本批按公共API组装执行器，没有复制内部浏览器引擎代码。新增的私有票据、E2B管理、PNG配额、SQL证据围栏及React恢复由本仓实现。浏览器模板构建通过官方固定镜像和锁文件完成，普通验证不在线安装依赖。

首个套件只检查模板标题、计数、刷新重置、页面错误和资源加载；它不是P5业务验收，`deliveryEligible`始终为false。源码或批准变化使旧证据stale；未配置浏览器为blocked；实际断言失败为failed。真实云、数据库并发、模型循环夹具及前端证据分别记录在重构方案第25节，不能把几组不同测试合并成模型自主交付已完成。

## 2026-09-13 已接入的第一批能力

本批先完成私有工程预览：应用沙盒主动连到独立网关，用户在共同 React 预览组件打开真实 Vite 页面。具体配置、入口与许可说明见 [私有工程预览运行说明](<WhyBuddy 私有工程预览运行说明.md>)。

| 参考来源 | 已落地位置 | 核实后的复用口径 |
|---|---|---|
| frp `server/control.go` | `server/project-preview/relay.ts` | 改写 ControlID、旧连接替换和工作连接一次消费；同时检查 WhyBuddy 持久 generation |
| chisel `client/client_connect.go`、`share/cio/pipe.go` | `agent-main.ts`、`tunnel-agent.ts`、`tunnel-stream.ts` | 改写主动连接、有限退避、独立双向 FIN、出错收尾；没有引入 SSH 执行层 |
| OpenSandbox `components/ingress/pkg/proxy/proxy.go` | `relay.ts`、`service.ts` | 改写先授权再转发和内部凭据剥离；HTTP 与 WS 都有正反判据 |
| `ws` npm 包 | 独立网关与沙盒 agent 的构建产物 | 直接使用仓库现有依赖；构建同步拷贝原 MIT LICENSE |
| grok-build 的资源/执行所有权 | Python `project_preview_runtime` 与现有 runtime worker | 延续已有主循环与持租约执行，恢复历史或刷新预览不重派副作用 |

本轮已经运行实际双 E2B、Chrome、Vite HMR 和真实 `SandboxPreviewSurface` 跨站 iframe；报告 `artifacts/project-preview-tunnel-smoke/1789234088-b83cf194/report.json`。浏览器共 21 项检查通过，另有 22 项云传输/清理检查通过。云端 authority 与工作台两条 API 使用明确的测试夹具，Python 持久授权由另一组实际 SQL/HTTP 测试覆盖。随后已接入当前 worker 的活跃版本同步，见第 23 节。独立浏览器验收服务与固定版本证据闸仍待完成，不能把预览烟测算成完整应用验收。

## 先从哪些源码开始抄

当前最紧要的是把真实工程安全地送到右侧预览，再接独立浏览器验收。按照这个依赖顺序阅读：

| 顺序 | 要解决的问题 | 优先来源 | 借用的具体能力 | WhyBuddy 的接入位置 |
|---|---|---|---|---|
| 1 | 私有流量 token 被 E2B 上游传入应用 | E2B runtime、OpenSandbox | 入站鉴权、转发前剥离内部头、HTTP/WS 的实际边界 | provider 与独立来源预览传输；先证明生成应用无法读到管理或流量凭据 |
| 2 | 沙盒主动连出，刷新、断线、重建后连接仍可管理 | frp、chisel、ws、node-http-proxy | 连接代次、替换屏障、反向通路、升级鉴权、背压和半关闭 | P2 预览网关与 runtime/generation；用户票据仍由 WhyBuddy 验证 |
| 3 | 生成源码后在工作台看到真实运行页面 | E2B fragments、bolt.diy、Sandpack | 文件/预览/终端面板、真实事件驱动、iframe 与桥接合同 | Studio 和 AppsWorkbench 共用工程描述；活跃源码同步由持租约 worker 负责 |
| 4 | 模型能改源码、跑命令并收到可靠结果 | OpenHands SDK、opencode、SWE-ReX、Aider、Cline | 工具状态、动作/观察、持续 shell、补丁冲突、恢复与批准 | 接现有 Python 控制循环和 E2B provider；继续使用现有持久操作、版本和权限 |
| 5 | 点击、提交、刷新、权限与失败修复有真实证据 | Playwright、Playwright MCP、Stagehand | 真实 DOM 操作、正式断言、console/network、trace、资源清理 | P4 独立浏览器 worker；证据绑定固定 revision，由服务端判定通过 |
| 6 | 编辑、过程展示和失败回放更好用 | assistant-ui、Monaco、rrweb、OpenHands UI | 外部状态适配、工具卡、编辑器/LSP、浏览器外壳和过程回放 | P6 工作台体验；记录和展示不能替代验收结果 |

这些来源各有强项：grok-build 继续负责参考主编排、计划批准、问答与工具面板；新增源码补充它未提供完整实现的云沙盒、Web 预览和浏览器验证。首期仍沿用 Python 权威与 React 工作台，迁移具体能力时一起处理输入、输出、取消、恢复和测试。

## 本轮发现的实际边界

| 来源 | 本次源码核验发现 | 对移植的影响 |
|---|---|---|
| E2B runtime | 私有入口验证 traffic token，但相应校验块未剥离这个请求头；与 WhyBuddy 已记录的 HTTP/WS 真机失败一致 | 修改本地参考源码不会改变 E2B 云；出站反向通路仍需真机证明 |
| OpenSandbox | Go ingress 在代理前删除内部安全访问头 | 可直接研究剥头与代理的实现；还要确认它所在的信任边界不能被生成工程绕过 |
| frp | ControlID、旧连接替换屏障和条件删除处理了旧连接影响新连接的问题 | 很适合借合同，但其进程内代次仍须接 WhyBuddy 持久租约 |
| Playwright MCP | 当前仓库主要是发布入口，核心在 Playwright 主仓；部分 verify 工具记录验证动作、返回 Done | 模型操作工具与正式 Playwright 断言分别使用，不能以工具 Done 代替业务验收 |
| OpenHands | 当前主仓的 browser 面板只展示截图；远程执行能力应看 software-agent-sdk | 可借界面和事件展示，不能把截图面板认作实时可交互工程浏览器 |
| E2B fragments | 示例直接返回 sandbox URL，多文件写入用未等待完成的 `forEach(async ...)`，handler 缺少完整清理合同 | 借最小生成/预览组成方式，文件写入和生命周期由 WhyBuddy 重做 |
| Daytona | 当前 main 的 README 说明服务端转入私有仓库；本地特意固定可读历史 `v0.190.0` | 是历史实现参考；服务端 AGPL-3.0，Python SDK Apache-2.0，须按实际子目录选择复用方式 |
| bolt.diy / Sandpack | WebContainer 商用服务有额外许可条件；桥接与浏览器存储传播不自动构成隔离边界 | 借 UI 和状态合同；WhyBuddy 的执行仍接 E2B，跨来源消息需自行校验 |
| SWE-ReX | 中断返回 0 可能只表示 shell 已回到提示符；服务端请求回执缓存不提供持久并发幂等 | 保留 WhyBuddy 的真实停止确认、操作表、重启对账和 generation |

源码复用优先挑 MIT / Apache-2.0 的具体模块，移植时保留对应版权、LICENSE 和适用 NOTICE。根许可证不覆盖所有子目录或第三方资产；Daytona、E2B Python SDK、agent-browser 的 axe-core 等具体差异记录在下方及快照中。云账号、浏览器二进制、服务许可和部署条件与源码下载分开核验。

## 本地组织与版本口径

- 新库全部位于 `../whybuddy-runtime-references/<owner>--<repo>`，保留独立 `.git`，使用浅克隆节省历史下载；未作为 WhyBuddy 源码或 submodule 提交。
- WhyBuddy 仓库提交的是 workspace、这份阅读索引和来源锁定文件。它们推送后可供其他机器按 URL/ref/commit 拉取；兄弟目录中的源码不会随 WhyBuddy 的 `git clone` 自动出现。
- 下方 LOC 是固定版本的**入口文件物理行数（含注释及空行）**，用于估计阅读量；不是整个仓库 source LOC，也不是已移植行数。跨仓实现会明确标出，不能重复相加当作规模。
- 大部分检出默认开发分支，Daytona 检出历史 tag。这里固定的是源码审查快照，生产依赖仍应单独选择稳定版本并验证。
- 本机已有 [grok-build](../../grok-build)、[会话与持久执行参考](../../2686WhyBuddy-oss-reference)、[既有产品界面参考](../../codex-references) 和 [既有业务/UI 组件库](../../whybuddy-oss-blocks)。本轮未重复拉取或全量审查这些旧集合，新增 28 仓计数不包含它们。

<!-- SOURCE_CATALOGUE -->

## 沙盒 SDK、运行时与工程预览

### e2b-dev/E2B

[GitHub](<https://github.com/e2b-dev/E2B>) · [本地源码](<../../whybuddy-runtime-references/e2b-dev--E2B>) · 版本 `refs/heads/main` / [67c2e07a2357](<https://github.com/e2b-dev/E2B/commit/67c2e07a2357ef35e52bcce0d7b8728dca38dbda>)

**用途：** 我们正在用的 E2B provider 的真实 SDK 合同来源；可直接核对创建、恢复、续租、进程结果、取消与流断开的不同含义，减少按印象封装。

**许可证：** Apache-2.0（仓库根及 spec）；MIT（packages/python-sdk）。实际文件：[LICENSE](<../../whybuddy-runtime-references/e2b-dev--E2B/LICENSE>)、[packages/python-sdk/LICENSE](<../../whybuddy-runtime-references/e2b-dev--E2B/packages/python-sdk/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/python-sdk/e2b/sandbox_sync/main.py](<../../whybuddy-runtime-references/e2b-dev--E2B/packages/python-sdk/e2b/sandbox_sync/main.py>) | 1,213 | create/connect/get_info/set_timeout/kill 生命周期；connect 明确会恢复 paused、只向上延长 timeout，不能当只读 target 查询。 |
| [packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py](<../../whybuddy-runtime-references/e2b-dev--E2B/packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py>) | 249 | stdout/stderr 增量解码、真实 end 事件与 exit code、disconnect/wait/kill；缺 end 不能报命令成功。 |
| [spec/envd/process/process.proto](<../../whybuddy-runtime-references/e2b-dev--E2B/spec/envd/process/process.proto>) | 171 | Start/Connect/List/SendSignal/CloseStdin 与 start/data/end/keepalive wire 合同；对应 WhyBuddy 进程、日志和取消事件。 |

**移植边界：**

- 根许可不能替代子包许可；复制 Python SDK 片段需保留 MIT 版权/许可。
- SDK 源码不是云隔离层，也不提供 WhyBuddy 会话归属、源码版本、项目写租约或验收权威。
- 本地源码 main 比 WhyBuddy 已安装 SDK 可能更新；按固定 HEAD 比较实际依赖版本后迁移。
- E2B 连接与命令订阅具有不同副作用；不能因 HTTP 断线就认定远端命令停止。

### e2b-dev/runtime

[GitHub](<https://github.com/e2b-dev/runtime>) · [本地源码](<../../whybuddy-runtime-references/e2b-dev--runtime>) · 版本 `refs/heads/main` / [5852a01cb755](<https://github.com/e2b-dev/runtime/commit/5852a01cb7558fd910f929ec8e5d9b826bae989e>)

**用途：** E2B 云背后的 Go runtime：能直接查看 ingress 鉴权、沙盒状态切换、envd 进程日志与终态保留，解释现用云能力的行为边界。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/e2b-dev--runtime/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/orchestrator/pkg/proxy/proxy.go](<../../whybuddy-runtime-references/e2b-dev--runtime/packages/orchestrator/pkg/proxy/proxy.go>) | 271 | 以沙盒/端口解析目标，constant-time 校验 traffic token、阻止外部访问 envd 内部路径，并构造上游连接；校验块未删除 traffic-token header。 |
| [packages/api/internal/handlers/sandbox_connect.go](<../../whybuddy-runtime-references/e2b-dev--runtime/packages/api/internal/handlers/sandbox_connect.go>) | 200 | 按服务端 team 身份续租、等待状态切换、限制重试、从快照恢复并检查归属，解释 SDK connect 的实际副作用。 |
| [packages/envd/internal/services/process/connect.go](<../../whybuddy-runtime-references/e2b-dev--runtime/packages/envd/internal/services/process/connect.go>) | 201 | 重订阅真实进程输出与 keepalive；进程已结束或订阅空窗期结束时回放保留终态，处理 PID 重用。 |
| [packages/envd/internal/services/process/handler/multiplex.go](<../../whybuddy-runtime-references/e2b-dev--runtime/packages/envd/internal/services/process/handler/multiplex.go>) | 150 | 日志多订阅者 fan-out，取消订阅先解除阻塞、清理监听器；可对照 WhyBuddy 执行与订阅分离。 |

**移植边界：**

- requestedRepo=e2b-dev/infra 现重定向为 e2b-dev/runtime；代码内部 Go import 仍有 infra 名称。
- 获得源码不等于已自托管 E2B；运行依赖 Linux/虚拟化/网络/存储与完整运维配置，本轮未安装或启动。
- WhyBuddy 已有真实云 HTTP/WS 证据表明 traffic token 会到达应用；源码仅辅助定位，不能把本地改一份 proxy 当成 E2B 云已修复。
- 进程终态保留不等于 WhyBuddy 工程 revision、业务数据库或跨实例项目租约持久化。

### opensandbox-group/OpenSandbox

[GitHub](<https://github.com/opensandbox-group/OpenSandbox>) · [本地源码](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox>) · 版本 `refs/heads/main` / [60bca638497d](<https://github.com/opensandbox-group/OpenSandbox/commit/60bca638497d9c50e948928b8b15fe22328afee3>)

**用途：** Python lifecycle API 加 Go ingress/execd 与 WhyBuddy 的 Python 权威、远端运行路线接近；尤其值得提取 HTTP/WS 凭据剥离、租户鉴权、续租工作队列与受管进程合同。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/LICENSE>)、[server/LICENSE](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/server/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [server/opensandbox_server/api/proxy.py](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/server/opensandbox_server/api/proxy.py>) | 703 | HTTP 与 WebSocket 代理、敏感头/跳间头过滤、重建 forwarded 头、redirect 路径处理；WebSocket 单独建立 tenant 身份，避免只靠 HTTP middleware。 |
| [components/ingress/pkg/proxy/proxy.go](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/components/ingress/pkg/proxy/proxy.go>) | 376 | 验证后解析 sandbox/port 目标，再删除 ingress/secure-access/fast-sandbox 凭据；HTTP、WS 分派与 SSE 已提交响应的错误处理。 |
| [server/opensandbox_server/integrations/renew_intent/consumer.py](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/server/opensandbox_server/integrations/renew_intent/consumer.py>) | 336 | Redis BRPOP 与代理访问续租合流为 asyncio 工作队列，按 sandbox 串行与节流、过期意图检查；可对照 WhyBuddy 空闲续租策略。 |
| [components/execd/pkg/runtime/bash_session.go](<../../whybuddy-runtime-references/opensandbox-group--OpenSandbox/components/execd/pkg/runtime/bash_session.go>) | 576 | 持久 Bash session 的 cwd/env、执行/关闭生命周期；从 session 环境排除 execd 自身配置与凭据，防应用读取管理环境。 |

**移植边界：**

- requestedRepo=alibaba/OpenSandbox 现重定向为 opensandbox-group/OpenSandbox，源码内部包名仍含 alibaba。
- ingress 验证和 egress 网络/凭据规则是不同边界；不能把 egress header rule 当作前端预览入口的凭据剥离。
- 这些是已读源码，不是已完成的安全部署；WhyBuddy 仍需独立预览域名、短票据、HTTP/WS、撤销、跨用户拒绝和真实 E2B 对接验收。
- 续租 pipeline 的内存 lock/队列不替代 WhyBuddy SQL 持久租约、generation fencing 与预算；不能整套替换已有权威。
- 把该 ingress 放在 E2B 前方不自动消除 E2B 自己再次注入/转发的 traffic token；需要独立可信边界或 provider 能力的实测证明。

### e2b-dev/fragments

[GitHub](<https://github.com/e2b-dev/fragments>) · [本地源码](<../../whybuddy-runtime-references/e2b-dev--fragments>) · 版本 `refs/heads/main` / [cc07f4373685](<https://github.com/e2b-dev/fragments/commit/cc07f43736855f42191de7ac011350cef6752342>)

**用途：** 体量较小的生成应用示例，明确展示结构化模型产物→E2B 模板→写文件/装依赖→预览 iframe；适合把主路径看透并提取 schema/展示。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/e2b-dev--fragments/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [lib/schema.ts](<../../whybuddy-runtime-references/e2b-dev--fragments/lib/schema.ts>) | 73 | 生成产物 Zod schema：模板、依赖、安装命令、端口、文件与源码；可对照 WhyBuddy project task/revision 输入。 |
| [app/api/chat/route.ts](<../../whybuddy-runtime-references/e2b-dev--fragments/app/api/chat/route.ts>) | 71 | streamObject 用模板提示词与 schema 约束模型输出、限流与错误回传；仅作为结构化生成合同参考。 |
| [app/api/sandbox/route.ts](<../../whybuddy-runtime-references/e2b-dev--fragments/app/api/sandbox/route.ts>) | 85 | 创建 E2B 模板、依赖安装、写源码和 interpreter/URL 分支，能清楚看见生成到真实执行的接点。 |
| [components/fragment-web.tsx](<../../whybuddy-runtime-references/e2b-dev--fragments/components/fragment-web.tsx>) | 65 | 远端 URL iframe、手动刷新、复制链接的最小消费端；可借显式工程预览结构。 |

**移植边界：**

- 这是示例，不满足 WhyBuddy P2 私有预览与持久项目要求：sandbox API 直接返回远端 URL，未建立项目归属、私有票据和持久运行租约。
- app/api/sandbox/route.ts 多文件路径使用 forEach(async ...) 且没有 await 全部写入，不能原样搬运。
- 该 handler 创建 sandbox 后没有 finally 销毁/持久接管合同，异常依赖 timeout 兜底；生产实现必须由 WhyBuddy 运行服务管理。
- HTTP 200/iframe 可见不等于浏览器行为测试、工程版本证据或交付通过。

### stackblitz-labs/bolt.diy

[GitHub](<https://github.com/stackblitz-labs/bolt.diy>) · [本地源码](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy>) · 版本 `refs/heads/main` / [2e254ac19a69](<https://github.com/stackblitz-labs/bolt.diy/commit/2e254ac19a696394030601bc602f54945b12bfc4>)

**用途：** 可直接研究聊天生成文件/命令到代码、diff、终端和实时预览的产品链路；适合拆取工作台交互与 action 状态，不另起一套模型主循环。

**许可证：** MIT（bolt.diy 源码）；WebContainer API 商业使用另有授权条款。实际文件：[LICENSE](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [app/components/workbench/Workbench.client.tsx](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy/app/components/workbench/Workbench.client.tsx>) | 528 | Code/Diff/Preview 三视图、文件修改列表、编辑器与预览组件组合；对应 WhyBuddy Studio 工作台外壳。 |
| [app/lib/runtime/action-runner.ts](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy/app/lib/runtime/action-runner.ts>) | 760 | file/shell/start/build action 的串行调度、pending/running/complete/aborted/failed 和错误回传；需改接 Python project tools。 |
| [app/lib/stores/previews.ts](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy/app/lib/stores/previews.ts>) | 313 | 监听 WebContainer server-ready/port open/close，按端口维护可预览服务并触发刷新；可参考真实 readiness 消费。 |
| [app/components/workbench/Preview.tsx](<../../whybuddy-runtime-references/stackblitz-labs--bolt.diy/app/components/workbench/Preview.tsx>) | 1,049 | 设备尺寸、页面导航、预览选择、URL 与元素选择交互；跨域能力需接自己的受控 bridge。 |

**移植边界：**

- README 明确 bolt.diy 为 MIT，但 WebContainer API 的商业生产使用需要单独许可；不能把仓库 MIT 解释为所有运行依赖免费商用。
- WebContainer 是浏览器内执行环境，不等于 E2B 的云端隔离和服务端持久工作区；保留 WhyBuddy 既有 Python 运行权威。
- previews.ts 覆写 localStorage.setItem 并广播所有 storage；不能照搬到 WhyBuddy 会话/项目隔离场景。
- action-runner.ts 的文件 mkdir/write 失败被 catch 后仅日志记录，可能让上层 action 完成；迁移时必须真实失败回填。
- 本轮没有运行 bolt.diy、安装依赖或连接其模型/部署服务。

### codesandbox/sandpack

[GitHub](<https://github.com/codesandbox/sandpack>) · [本地源码](<../../whybuddy-runtime-references/codesandbox--sandpack>) · 版本 `refs/heads/main` / [7d60a4334980](<https://github.com/codesandbox/sandpack/commit/7d60a4334980eef304d53b1c3df371ed6dbcf491>)

**用途：** 成熟的 React 文件/编辑器/预览组合、加载失败状态、客户端生命周期和 iframe 消息合同；适合把 WhyBuddy 右侧从单页 HTML 展示演进为工程工作台。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/codesandbox--sandpack/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [sandpack-react/src/components/Preview/index.tsx](<../../whybuddy-runtime-references/codesandbox--sandpack/sandpack-react/src/components/Preview/index.tsx>) | 228 | 预览 iframe、加载/错误覆盖层、地址导航、刷新/重启和独立打开；可拆成我们的 SandboxPreviewSurface 外观与状态消费。 |
| [sandpack-react/src/contexts/utils/useClient.ts](<../../whybuddy-runtime-references/codesandbox--sandpack/sandpack-react/src/contexts/utils/useClient.ts>) | 622 | 按 iframe 管理 client 注册/销毁、监听器、超时、文件状态与延迟启动，避免刷新重复创建运行实例。 |
| [sandpack-client/src/clients/runtime/iframe-protocol.ts](<../../whybuddy-runtime-references/codesandbox--sandpack/sandpack-client/src/clients/runtime/iframe-protocol.ts>) | 134 | register-frame/channel ID、定向发送、按 event.source 匹配与 cleanup；是 bridge 协议结构参考。 |
| [sandpack-client/src/clients/node/index.ts](<../../whybuddy-runtime-references/codesandbox--sandpack/sandpack-client/src/clients/node/index.ts>) | 463 | Nodebox 编译、文件同步、shell 进度/输出、preview URL 与真实运行失败消息的 UI 接合。 |

**移植边界：**

- Sandpack/Nodebox 在浏览器与其 bundler/runtime 环境运行，隔离、生命周期、持久化与 E2B 云 VM 不同；不是 E2B 的替代安全边界。
- 已读 IFrameProtocol 入站校验 source/channel，未校验 evt.origin；WhyBuddy bridge 必须额外绑定 origin、runtime/revision 和消息 schema。
- main 当前 HEAD 日期为 2025-02-14；作为固定版本参考，不宣称所有运行依赖仍持续更新。
- 复制 UI 并不会增加 Python 侧归属检查、持久源码、浏览器验证或项目验收。

### daytonaio/daytona

[GitHub](<https://github.com/daytonaio/daytona>) · [本地源码](<../../whybuddy-runtime-references/daytonaio--daytona>) · 版本 `refs/tags/v0.190.0` / [01c502bb1f1f](<https://github.com/daytonaio/daytona/commit/01c502bb1f1ff8f2885d0cd490e043736083dca8>)

**用途：** 保留官方 README 指定 v0.190.0 的公开源码，用于比较控制面、runner、preview 与进程 SDK；现 main 只剩 README 和图片，不能冒充仍维护的公开 runtime。

**许可证：** AGPL-3.0（仓库根、apps 服务端）；Apache-2.0（libs/sdk-python）。实际文件：[LICENSE](<../../whybuddy-runtime-references/daytonaio--daytona/LICENSE>)、[libs/sdk-python/LICENSE](<../../whybuddy-runtime-references/daytonaio--daytona/libs/sdk-python/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [apps/api/src/sandbox/services/sandbox.service.ts](<../../whybuddy-runtime-references/daytonaio--daytona/apps/api/src/sandbox/services/sandbox.service.ts>) | 3,465 | 沙盒创建/状态迁移、组织资源配额、runner 分配锁、自动停止/归档策略；用于比较持久控制面职责（AGPL）。 |
| [apps/proxy/pkg/proxy/proxy.go](<../../whybuddy-runtime-references/daytonaio--daytona/apps/proxy/pkg/proxy/proxy.go>) | 316 | 私有 preview token/cookie、缓存、连接关闭回收和 cookie 服务端有效期；用于 P2 网关合同对照（AGPL）。 |
| [apps/api/src/sandbox/guards/proxy-auth-context.guard.ts](<../../whybuddy-runtime-references/daytonaio--daytona/apps/api/src/sandbox/guards/proxy-auth-context.guard.ts>) | 30 | 将 proxy / region-proxy 的调用身份与普通用户身份区分，避免内部代理绕过授权（AGPL）。 |
| [libs/sdk-python/src/daytona/_sync/process.py](<../../whybuddy-runtime-references/daytonaio--daytona/libs/sdk-python/src/daytona/_sync/process.py>) | 778 | 命令退出码、session 命令、stdout/stderr WebSocket 解复用与异步回调；可读的 Python 进程工具合同（Apache-2.0）。 |

**移植边界：**

- GitHub archived=false 与维护状态不同；当前 main 已移除核心源码，已按官方 README 引用 tag 获取真实历史代码。
- AGPL 服务端源码不可按 MIT/Apache 组件无条件复制进产品；同仓 Apache SDK 与 AGPL apps 必须分别遵循对应许可。
- 不把旧 tag 的安全性、功能或兼容性认作当前 Daytona 商业云保证。
- WhyBuddy 已选 E2B，参考此历史控制面不等于新增第二个生产 sandbox provider。

## 私有预览、反向隧道与 HTTP/WebSocket

### fatedier/frp

[GitHub](<https://github.com/fatedier/frp>) · [本地源码](<../../whybuddy-runtime-references/fatedier--frp>) · 版本 `refs/heads/dev` / [d20a23299600](<https://github.com/fatedier/frp/commit/d20a232996007dfe6ab425abc0a39a3ae9a0889b>)

**用途：** 沙盒主动连接可信服务端，再由服务端通过工作连接访问沙盒应用。当前源码已经把旧连接替换、新连接激活、路由准入和清理的竞争关系写成明确合同，尤其适合 WhyBuddy 的 runtime/generation 边界。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/fatedier--frp/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [server/control.go](<../../whybuddy-runtime-references/fatedier--frp/server/control.go>) | 913 | 重点读 ControlManager.Add/Activate/Remove/RegisterWorkConn 与 markReplaced：每条控制连接有 ControlID，同一 run 的操作串行；新连接等前任收尾，旧连接不得删除新记录或登记新的工作连接。可改写为 WhyBuddy 预览隧道的代次与接管规则。 |
| [client/service.go](<../../whybuddy-runtime-references/fatedier--frp/client/service.go>) | 527 | Run、keepControllerWorking、loopLoginUntilSuccess、GracefulClose/stop 管理主动连接、断线退避、替换旧控制器和明确停止。可参考沙盒隧道 agent 的重连与退出流程。 |
| [pkg/util/vhost/http.go](<../../whybuddy-runtime-references/fatedier--frp/pkg/util/vhost/http.go>) | 287 | HTTPReverseProxy 按登记的域名和路由选择工作连接，DialContext 与传输分离，包含请求/响应改写、缓冲池、超时和路由撤销；可参考将 HTTP 网关接到已登记隧道的方式。 |
| [pkg/auth/token.go](<../../whybuddy-runtime-references/fatedier--frp/pkg/auth/token.go>) | 91 | 展示登录认证与心跳、新工作连接的附加认证范围如何分开。可复用逐类消息验权的设计，WhyBuddy 的隧道凭证仍应绑定自己的 runtime、generation 和期限。 |

**移植边界：**

- ControlID 和 ControlManager 都在进程内；它们不能代替 WhyBuddy 持久数据库中的租约 generation 或跨实例撤销。
- 隧道认证、路由 Basic Auth 不等于 WhyBuddy 用户归属和一次性浏览器票据；浏览器访问授权仍需独立网关。
- 按域名登记路由不自动解决在途 HTTP、已建立 WebSocket 和连接池的撤销，移植时需逐项覆盖。
- 这是 dev 分支的固定源码快照，未运行本地测试或与 E2B 联调；不能据此宣称直接部署即可安全预览。
- 采用 Go 进程或将合同改写到 Python/TS 需要明确部署边界；复制源码须保留适用的 Apache 许可与通知。

### jpillora/chisel

[GitHub](<https://github.com/jpillora/chisel>) · [本地源码](<../../whybuddy-runtime-references/jpillora--chisel>) · 版本 `refs/heads/master` / [3c00f04ca154](<https://github.com/jpillora/chisel/commit/3c00f04ca15472cf6e308227ec24c88c8f5d4ab3>)

**用途：** 客户端以 HTTP/WebSocket 主动连服务端，再用 SSH channel 复用双向连接。逐 channel 权限检查、取消和半关闭的实现与测试入口，对避免只在握手时验权或提前截断响应很有价值。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/jpillora--chisel/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [client/client_connect.go](<../../whybuddy-runtime-references/jpillora--chisel/client/client_connect.go>) | 144 | connectionLoop/connectionOnce 展示 WebSocket 拨号、SSH 握手、配置确认、连接复用、退避与取消；重试耗尽和用户取消返回不同结果。 |
| [server/server_handler.go](<../../whybuddy-runtime-references/jpillora--chisel/server/server_handler.go>) | 203 | handleWebsocket 在握手后重新取得已认证用户，核对远端配置和 reverse 开关，并为新 SSH channel 从实时用户索引重查 ACL；可参考授权不只检查初次连接的边界。 |
| [share/tunnel/tunnel_out_ssh.go](<../../whybuddy-runtime-references/jpillora--chisel/share/tunnel/tunnel_out_ssh.go>) | 113 | handleSSHChannel 验证实际目标地址的 ACL，并先成功拨通目标再接受 channel，避免向调用方报告虚假的连接成功。 |
| [share/cio/pipe.go](<../../whybuddy-runtime-references/jpillora--chisel/share/cio/pipe.go>) | 60 | Pipe 的两个方向独立复制；干净 EOF 只关闭对方写端，另一方向继续返回数据，复制出错则关闭两端。适合参考 HTTP 上传、长响应与隧道半关闭。 |

**移植边界：**

- 此处的 WebSocket 是隧道传输外壳，SSH channel 的目标地址 ACL 不是浏览器页面用户权限。
- 动态 ACL 复查约束新建 channel；已有流的立即撤销、runtime/generation 失效和所有连接登记仍需 WhyBuddy 实现。
- 源码允许未配置认证时 allow-all；不能把演示启动配置作为 WhyBuddy 的默认授权策略。
- 使用现成 Go 隧道会增加沙盒客户端与网关进程的版本和清理管理；本次只审源码，尚未运行 E2B WSS 场景。
- 不能把完整 SSH 认证栈零散改写为自制加密协议；可优先复用成熟进程或其生命周期合同，复制 MIT 源码保留版权和许可。

### websockets/ws

[GitHub](<https://github.com/websockets/ws>) · [本地源码](<../../whybuddy-runtime-references/websockets--ws>) · 版本 `refs/heads/master` / [73e03eb35b1a](<https://github.com/websockets/ws/commit/73e03eb35b1a84a3b28f906bab6a359231660695>)

**用途：** WhyBuddy 已有 ws 依赖，可以直接研究现有库支持的握手控制与流接口，减少自行编写帧协议。重点价值在 noServer 升级前鉴权、慢消费者背压和可追踪的关闭。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/websockets--ws/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [lib/websocket-server.js](<../../whybuddy-runtime-references/websockets--ws/lib/websocket-server.js>) | 562 | handleUpgrade/completeUpgrade 校验方法、协议、key、扩展与连接状态，再完成握手；noServer 允许 WhyBuddy 在升级前先做自己的用户与隧道授权。 |
| [lib/stream.js](<../../whybuddy-runtime-references/websockets--ws/lib/stream.js>) | 161 | createWebSocketStream 把 WS 包成 Duplex；push 返回 false 时 pause，读取时 resume，写入使用回调，错误/EOF/destroy 驱动 close 或 terminate；可用于受限隧道流与慢端回压。 |
| [examples/express-session-parse/index.js](<../../whybuddy-runtime-references/websockets--ws/examples/express-session-parse/index.js>) | 111 | 展示 HTTP 与 upgrade 共用会话解析、未登录拒绝 401、通过后 handleUpgrade，以及注销时关闭登记连接；只借调用顺序和生命周期示例。 |

**移植边界：**

- ws 只实现 WebSocket 协议，不自带 HTTP 隧道复用、项目访问授权、持久票据和 runtime/generation 撤销。
- 握手校验不会自动执行 WhyBuddy origin/host/用户检查；必须在可信 HTTP upgrade 入口提供，所有在途连接都需受撤销管理。
- 示例用临时随机用户和示例 secret，并且 Map 每用户只存一条 WS；不能直接用作多标签页或多项目生产会话管理。
- 服务端默认 maxPayload 为 100 MiB；需依据 WhyBuddy 场景另设消息大小、总字节量、连接数、空闲超时和积压上限。
- 源码快照与 WhyBuddy 安装版本不是同一概念；本次未修改依赖，也未运行 WS/HMR 真机验证。

### http-party/node-http-proxy

[GitHub](<https://github.com/http-party/node-http-proxy>) · [本地源码](<../../whybuddy-runtime-references/http-party--node-http-proxy>) · 版本 `refs/heads/master` / [9b96cd725127](<https://github.com/http-party/node-http-proxy/commit/9b96cd725127a024dabebec6c7ea8c807272223d>)

**用途：** 贴近 WhyBuddy 现有 Node 层，清楚拆开普通 HTTP 请求、响应和 WebSocket upgrade；可参考真正双向代理、错误传播、头改写以及中断后释放上游连接。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/http-party--node-http-proxy/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [lib/http-proxy/passes/web-incoming.js](<../../whybuddy-runtime-references/http-party--node-http-proxy/lib/http-proxy/passes/web-incoming.js>) | 194 | stream 将请求和响应流直接管道连接，传播 aborted/error，处理 proxyTimeout，并在发送前触发 proxyReq；可参考 HTTP 和 SSE 的传输生命周期。 |
| [lib/http-proxy/passes/ws-incoming.js](<../../whybuddy-runtime-references/http-party--node-http-proxy/lib/http-proxy/passes/ws-incoming.js>) | 162 | 检查 GET/Upgrade，保留握手后的 head 字节，处理上游拒绝 upgrade、101 返回和双向 socket pipe；可参考浏览器 HMR WebSocket 的真实代理路径。 |
| [lib/http-proxy/passes/web-outgoing.js](<../../whybuddy-runtime-references/http-party--node-http-proxy/lib/http-proxy/passes/web-outgoing.js>) | 147 | 转发响应状态及响应头，支持 Set-Cookie 域和路径改写；可研究隔离预览来源下应用 cookie 与跳转的正确处理。 |
| [lib/http-proxy/common.js](<../../whybuddy-runtime-references/http-party--node-http-proxy/lib/http-proxy/common.js>) | 248 | setupOutgoing 构造上游目标、TLS 配置、请求路径及 header；是检查 target 是否固定、是否意外转发宿主认证头的重要入口。 |

**移植边界：**

- 它是代理传输库，不供应反向隧道、E2B 生命周期、浏览器票据或项目归属判定。
- setupOutgoing 默认复制 req.headers；主站 Cookie、Authorization 和预览票据必须在可信网关明确隔离，库本身不会识别 WhyBuddy 凭据。
- HTTP 与 WS 分别走 web-incoming/ws-incoming，不能只给普通请求加鉴权或剥头。撤销已建立 WebSocket 还需登记并关闭活跃连接。
- 不能允许调用方提供任意 target，否则可能成为任意上游代理；需要服务端登记的 runtime/generation 到隧道映射。
- 当前 package.json 为 1.18.1，源码包含旧 Node API；本次没有安装依赖或跑兼容性/安全测试，生产选型仍应固定版本并验证当前 Node 行为。

### rathole-org/rathole

[GitHub](<https://github.com/rathole-org/rathole>) · [本地源码](<../../whybuddy-runtime-references/rathole-org--rathole>) · 版本 `refs/heads/main` / [a292f7ed5402](<https://github.com/rathole-org/rathole/commit/a292f7ed5402f840415fc6a53827da2f34337856>)

**用途：** 源码比完整产品宿主小，能清楚看到控制握手、按需补数据连接、心跳和传输协议适配。适合研究怎样让沙盒只主动建立出站连接，并把应用字节流与管理控制分开。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/rathole-org--rathole/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [src/server.rs](<../../whybuddy-runtime-references/rathole-org--rathole/src/server.rs>) | 714 | do_control_channel_handshake 按服务挑战认证并替换旧句柄；do_data_channel_handshake 将连接交给对应控制通道；ControlChannelHandle 用 channel 管理监听和数据连接池。 |
| [src/client.rs](<../../whybuddy-runtime-references/rathole-org--rathole/src/client.rs>) | 560 | ControlChannel.run 接收 CreateDataChannel 与心跳，run_data_channel 主动连接服务器，再连接本地应用；ControlChannelHandle 包含取消和退避重连。 |
| [src/protocol.rs](<../../whybuddy-runtime-references/rathole-org--rathole/src/protocol.rs>) | 243 | Hello/Auth/Ack、ControlChannelCmd 与 DataChannelCmd 把认证、控制指令和开始转发分成类型；可参考 WhyBuddy 隧道协议版本和消息合同。 |
| [src/transport/websocket.rs](<../../whybuddy-runtime-references/rathole-org--rathole/src/transport/websocket.rs>) | 254 | WebsocketTunnel 将二进制 WebSocket 帧适配为 AsyncRead/AsyncWrite，通过 poll_ready/flush/close 对接流的生命周期；可研究 WSS 承载隧道字节流的方式。 |

**移植边界：**

- GitHub 将原 rapiz1/rathole 地址重定向到 rathole-org/rathole，本地使用当前 canonical 仓库名。
- 公开端口转发的访问者没有 WhyBuddy 用户授权；WebSocket transport 是隧道载体，不是浏览器票据或 HMR 网关实现。
- 服务名和会话 key 的连接映射没有 WhyBuddy project/revision/持久 generation 合同，不能把重连当成项目恢复。
- 删除控制句柄会通知控制和监听任务，但已 spawn 的 copy_bidirectional 转发任务没有同一 shutdown 订阅；主动撤销已有流还需补足。
- 控制通道数据连接请求使用无界队列；生产接入需要明确队列、并发、字节量和时长上限。
- 认证失败的 debug 日志含预期及收到的 session key；不可照搬到 WhyBuddy 凭据日志。需选择并验证加密传输，不能用裸 TCP 认证代替传输保密。

### ekzhang/bore

[GitHub](<https://github.com/ekzhang/bore>) · [本地源码](<../../whybuddy-runtime-references/ekzhang--bore>) · 版本 `refs/heads/main` / [00a735a89917](<https://github.com/ekzhang/bore/commit/00a735a89917642df62d84336a90d9476fa175b5>)

**用途：** 客户端、服务端和认证核心只有几个文件，容易完整读懂从公开连接到沙盒主动接回的流程。适合建立最小隧道原型的理解和对照，不能直接当私有预览成品。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/ekzhang--bore/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [src/server.rs](<../../whybuddy-runtime-references/ekzhang--bore/src/server.rs>) | 187 | 服务端为新访问连接分配 UUID，通知客户端，再由 Accept 消费待配对连接；包含端口范围限制和 10 秒未配对连接清理。 |
| [src/client.rs](<../../whybuddy-runtime-references/ekzhang--bore/src/client.rs>) | 127 | 收到连接通知后主动拨回远端并连接本地服务，保留解帧器已读缓冲，再 copy_bidirectional；可参考握手切换到原始流时不能丢首段数据。 |
| [src/auth.rs](<../../whybuddy-runtime-references/ekzhang--bore/src/auth.rs>) | 79 | Authenticator 用 UUID challenge 和 HMAC-SHA256 完成可选共享密钥认证，握手错误明确返回；可参考挑战、响应和超时的合同。 |

**移植边界：**

- 核心实现使用裸 TcpStream；HMAC 挑战认证不加密后续业务字节流，也不提供浏览器 HTTPS/WSS 终止。
- 共享 secret 可不配置，公开转发端口默认监听所有接口；没有 WhyBuddy 用户、一次性票据或按项目访问权限。
- 待配对连接是全局 UUID 映射，没有 project/runtime/generation 绑定；停止控制连接也不等于已配对转发全部撤销。
- 没有现成 HTTP 头隔离、cookie/origin 规则、HMR 路由和完整流量预算；适合作为小型参考，不建议直接承担生产私有预览。

## 浏览器操作、独立断言与证据

### microsoft/playwright

[GitHub](<https://github.com/microsoft/playwright>) · [本地源码](<../../whybuddy-runtime-references/microsoft--playwright>) · 版本 `refs/heads/main` / [d1ead3ecca23](<https://github.com/microsoft/playwright/commit/d1ead3ecca23182f2d06d761c28e3d4edafb6595>)

**用途：** P4 受管浏览器 worker 的首选基础：直接用正式 Playwright API 执行点击、输入、刷新和断言，按测试/worker 生命周期清理，保存 trace 与网络资源。源码用于理解超时、取消、fixture teardown 和证据采集合同，不必把整套测试运行器复制到 Python 主循环。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/microsoft--playwright/LICENSE>)、[NOTICE](<../../whybuddy-runtime-references/microsoft--playwright/NOTICE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/playwright/src/worker/workerMain.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright/src/worker/workerMain.ts>) | 684 | WorkerMain.runTestGroup / _runTest：用例 ID 对账、顺序执行、超时和 afterEach/afterAll/fixture teardown；可参考独立验证 worker 的任务终态与清理。 |
| [packages/playwright-core/src/client/locator.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright-core/src/client/locator.ts>) | 528 | click/check/fill 使用 strict selector，通过 frame 执行实际 DOM 操作；可直接使用对应正式 SDK API，避免以宿主 HTML 或模型口述替代实际点击。 |
| [packages/playwright/src/matchers/matchers.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright/src/matchers/matchers.ts>) | 559 | toBeVisible、toHaveText、toHaveURL 等实际 locator/page 断言与超时/AbortSignal；P4 必须用独立断言判定结果。 |
| [packages/playwright-core/src/server/trace/recorder/tracing.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright-core/src/server/trace/recorder/tracing.ts>) | 878 | Tracing 的 startChunk/stopChunk、调用前后快照、截图、网络资源和 artifact 收口；参考固定 revision 证据包的采集与完整写入。 |

**移植边界：**

- 不强制依赖云端；仍需独立安装匹配的浏览器二进制和系统依赖，本次未安装/启动。主分支是当日源码快照，生产应固定 SDK 与浏览器版本。
- 测试通过只覆盖已运行用例；WhyBuddy 仍负责 project/runtime/revision/spec 绑定、所有权、可信用例来源和 passed/failed/blocked/stale。trace 与 screenshot 本身不能判业务验收通过。
- Apache-2.0 复制/分发需保留 LICENSE、版权和适用 NOTICE，并标注修改；NOTICE 明确包含 Puppeteer 来源。浏览器、third_party 与测试资产可能另有许可证，不应按根许可证一并复制。
- 本仓同时持有当前 Playwright MCP 的核心源码；避免将其与 playwright-mcp 分发仓的行数、实现重复计算。

### microsoft/playwright-mcp

[GitHub](<https://github.com/microsoft/playwright-mcp>) · [本地源码](<../../whybuddy-runtime-references/microsoft--playwright-mcp>) · 版本 `refs/heads/main` / [8a13ef8e9f73](<https://github.com/microsoft/playwright-mcp/commit/8a13ef8e9f7385a0f89477922127f31cbfde9761>)

**用途：** 最适合借用模型浏览器工具的 schema、工具调用生命周期、元素引用、console/network 结果和会话清理。当前仓库是薄分发入口：src/README.md 指向 Playwright 主仓 packages/playwright-core/src/tools/mcp；index.js 实际调用 playwright-core/lib/coreBundle 的 tools.createConnection。下面跨仓路径均指向已拉取的真实实现。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/microsoft--playwright-mcp/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [index.js](<../../whybuddy-runtime-references/microsoft--playwright-mcp/index.js>) | 19 | 实际 npm 导出入口，只委托 playwright-core 的 tools.createConnection，证明实现归属。 |
| [../microsoft--playwright/packages/playwright-core/src/tools/backend/browserBackend.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright-core/src/tools/backend/browserBackend.ts>) | 132 | 真实 BrowserBackend：工具调用参数、AbortSignal、BrowserContext、会话日志、断线和 dispose，适配 WhyBuddy 现有工具调度。 |
| [../microsoft--playwright/packages/playwright-core/src/tools/backend/tab.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright-core/src/tools/backend/tab.ts>) | 662 | 页面 console/pageerror/request/response/requestfailed 监听、日志文件、页面 snapshot 与 target locator；适合作为模型观察结果和失败诊断材料。 |
| [../microsoft--playwright/packages/playwright-core/src/tools/backend/verify.ts](<../../whybuddy-runtime-references/microsoft--playwright/packages/playwright-core/src/tools/backend/verify.ts>) | 150 | 浏览器 testing 工具的类型化参数和结果合同；同时是不可盲抄的例子：verifyElement 当前通过 count()>0 找到元素后记录 assertVisible 动作并返回 Done。 |

**移植边界：**

- 工具返回 Done 或生成 assertVisible 动作不等于独立验收通过；尤其当前 verifyElement 的 count 检查不能单独证明元素可见。WhyBuddy 应执行正式 Playwright expect 断言并保存结果。
- MCP 是工具传输协议，不是 E2B 供应、持久任务服务或租户权限系统。首期可改写工具合同到现有 Python 循环，不必新增第二套 Agent 循环。
- 不强制使用云浏览器；浏览器安装、私有预览票据、来源隔离和生命周期仍需 WhyBuddy 集成。本次不执行 cli.js/install-browser。
- Apache-2.0 保留许可、版权和改动说明；跨仓实现还需保留 Playwright 的适用 NOTICE。当前分发 package.json 固定一个 alpha Playwright 版本，不能假设与另行拉取的主仓 HEAD 完全同版。

### browserbase/stagehand

[GitHub](<https://github.com/browserbase/stagehand>) · [本地源码](<../../whybuddy-runtime-references/browserbase--stagehand>) · 版本 `refs/heads/main` / [b771930d2b4d](<https://github.com/browserbase/stagehand/commit/b771930d2b4d858e5bd9670203c66260b385a8fa>)

**用途：** 适合借用 local/Browserbase 资源所有权、超时后迟到资源回收、结构化 act/observe/extract 边界和跨 frame 网络聚合。当前主仓已包含多语言 SDK 与浏览器 extension runtime，应依据当前 packages 路径阅读，不能照旧文章中的 lib/v3 路径判断。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/browserbase--stagehand/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/sdk-ts/src/browser/factories.ts](<../../whybuddy-runtime-references/browserbase--stagehand/packages/sdk-ts/src/browser/factories.ts>) | 339 | localBrowser/browserbase 工厂、CDP handle 的 claim/release、初始化 deadline，以及超时后才创建成功的浏览器清理；对受管 worker 的资源责任很有价值。 |
| [packages/sdk-ts/src/stagehand.ts](<../../whybuddy-runtime-references/browserbase--stagehand/packages/sdk-ts/src/stagehand.ts>) | 392 | act/observe/extract 的 SDK 调用边界与模型输入装配；可参考语义动作与低层执行的分工。 |
| [packages/extension/handlers/handlerUtils/actHandlerUtils.ts](<../../whybuddy-runtime-references/browserbase--stagehand/packages/extension/handlers/handlerUtils/actHandlerUtils.ts>) | 582 | performUnderstudyMethod 通过 resolveLocatorWithHops 处理 iframe/XPath 定位，执行动作并关联日志与页面 URL。 |
| [packages/extension/understudy/networkManager.ts](<../../whybuddy-runtime-references/browserbase--stagehand/packages/extension/understudy/networkManager.ts>) | 341 | 将主 frame 与 OOPIF 的 CDP Network 请求汇总，按 sessionId+requestId 关联并提供 wait-for-idle；可补足跨 frame 诊断。 |

**移植边界：**

- README 首选示例使用 Browserbase 与模型 API 凭证，但源码明确存在 localBrowser 工厂；并非所有使用都强制云端。云端浏览器和模型服务授权/计费独立于 MIT。
- 自然语言 act 的成功和 network idle 不能单独证明用户业务要求满足；WhyBuddy 仍需独立用例、确定性断言、版本绑定和失败证据。
- 不把额外 SDK/extension/模型调度整体塞进 Python 主循环；首期优先读取其中明确的生命周期和定位合同，E2B provider 保持现有权威。
- MIT 复制/分发需保留 Browserbase 版权与许可；固定当前接口版本并核对第三方包及浏览器 runtime 兼容性。

### browser-use/browser-use

[GitHub](<https://github.com/browser-use/browser-use>) · [本地源码](<../../whybuddy-runtime-references/browser-use--browser-use>) · 版本 `refs/heads/main` / [50f205533fe1](<https://github.com/browser-use/browser-use/commit/50f205533fe10ba35b553d2a3689c77b87bd5d0a>)

**用途：** Python 侧可读性与 WhyBuddy 技术栈接近，适合提取浏览器会话、事件驱动 watcher、动作超时、真实 HAR 和错误回传。当前实现使用 CDPClient 与事件总线，并不是单纯的 Playwright 包装。优先取这些能力叶子，不把它的完整 Agent 循环再引入产品。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/browser-use--browser-use/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [browser_use/browser/session.py](<../../whybuddy-runtime-references/browser-use--browser-use/browser_use/browser/session.py>) | 4,153 | BrowserSession、Target/CDPSession 与 BrowserStart/Stop/Connected/Reconnecting 事件；参考浏览器资源所有者、重连与多 target 状态。 |
| [browser_use/tools/service.py](<../../whybuddy-runtime-references/browser-use--browser-use/browser_use/tools/service.py>) | 2,327 | 工具 registry 和动作执行入口、ActionResult/BrowserError、有限 action_timeout 和敏感输入处理；参考模型可见的真实操作结果。 |
| [browser_use/browser/watchdogs/har_recording_watchdog.py](<../../whybuddy-runtime-references/browser-use--browser-use/browser_use/browser/watchdogs/har_recording_watchdog.py>) | 779 | 订阅 CDP Network 事件，关联请求/响应/失败/耗时，支持 HAR content omit/embed/attach，关闭时落 HAR 1.2 证据。 |
| [browser_use/browser/watchdogs/security_watchdog.py](<../../whybuddy-runtime-references/browser-use--browser-use/browser_use/browser/watchdogs/security_watchdog.py>) | 296 | 导航前 allowed_domains 判定、重定向完成和新 tab 复查；可借用事件合同，但必须认清其保护范围。 |

**移植边界：**

- 支持本地/CDP 与 Browser Use Cloud 路径；云产品需要单独凭证和计费，克隆开源仓库不会获得云服务。模型服务也另有调用成本。
- SecurityWatchdog 的代码主要管导航/新 tab，某些重定向在完成后纠正；不能把它当网络级 SSRF、子资源和云沙盒隔离的完整防线。
- HAR 可能包含 URL、请求体、响应和认证信息，WhyBuddy 证据存储需有项目归属和脱敏规则；HAR 采集完成不代表 API 业务断言通过。
- MIT 允许改写与商业使用，复制较大部分时需保留版权和许可文本；第三方 Python/CDP/浏览器依赖仍按各自许可证处理。

### vercel-labs/agent-browser

[GitHub](<https://github.com/vercel-labs/agent-browser>) · [本地源码](<../../whybuddy-runtime-references/vercel-labs--agent-browser>) · 版本 `refs/heads/main` / [8c15ff9f71ae](<https://github.com/vercel-labs/agent-browser/commit/8c15ff9f71ae60c7e99e66afe1e2d4b9bf414fe2>)

**用途：** 当前是 Rust 原生 CLI/CDP daemon，适合借用轻量 JSON 命令、可访问性 snapshot 的稳定元素引用、浏览器生命周期和 console/network/trace 收集。与 grok 的 Rust 源码阅读路线相近，但 WhyBuddy 无需为参考这些合同改写成 Rust。

**许可证：** Apache-2.0; bundled axe-core is MPL-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/vercel-labs--agent-browser/LICENSE>)、[cli/src/native/a11y/LICENSE-axe-core.txt](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/a11y/LICENSE-axe-core.txt>)、[cli/src/native/a11y/LICENSE-axe-core-THIRD-PARTY.txt](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/a11y/LICENSE-axe-core-THIRD-PARTY.txt>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [cli/src/native/snapshot.rs](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/snapshot.rs>) | 1,621 | 可访问性树到紧凑 snapshot 与 RefMap，区分交互/内容/结构角色并规范名称；减少模型读取整页 DOM 的输入负担。 |
| [cli/src/native/actions.rs](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/actions.rs>) | 16,601 | execute_command 的真实 JSON 调度、先校验再初始化、响应 ID/错误、点击/截图/console/network/trace 命令与事件处理。 |
| [cli/src/native/browser.rs](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/browser.rs>) | 4,595 | BrowserManager 管理 launch/connect_cdp、target/tab 绑定、网络等待、退出和进程 kill/wait；适合参考验证实例回收。 |
| [cli/src/native/network.rs](<../../whybuddy-runtime-references/vercel-labs--agent-browser/cli/src/native/network.rs>) | 899 | CDP 请求头、离线注入与 DomainFilter；用于故障用例与网络约束合同，集成时需连同 actions 内实际安装路径阅读。 |

**移植边界：**

- 当前 daemon 不依赖 Node 或 Playwright；使用本地 Chrome 或远端 CDP，不是旧版 TS/Playwright 包装器。Vercel/Browserbase 等云 provider 是可选适配且另需服务权限。
- 此 CLI 能执行动作、记录事件，但不是 WhyBuddy 的受管验收权威；模型 snapshot、trace 或命令 success 仍需对应当前 revision 与确定性断言。
- 根许可 Apache-2.0，但内置 axe-core 的 LICENSE 明确是 MPL-2.0，另有第三方许可清单。若复制 a11y 实现/捆绑资产，应单独保留与履行这些文件级许可，不能统称全仓纯 Apache。
- BrowserManager 中 Chrome 与其他 engine 生命周期能力不同；选择 E2B Chromium 路径后还要验证真实进程停止、CDP 断线及多 context 隔离。

### rrweb-io/rrweb

[GitHub](<https://github.com/rrweb-io/rrweb>) · [本地源码](<../../whybuddy-runtime-references/rrweb-io--rrweb>) · 版本 `refs/heads/main` / [32ed9fe5387e](<https://github.com/rrweb-io/rrweb/commit/32ed9fe5387e088cfc023c71a39672c30c516da7>)

**用途：** 补充工作台的失败过程回放：记录初始 DOM、后续 mutation、输入和鼠标事件，在隔离播放器里重建时间线。适合作为 VerificationRecord 附带的可视诊断，不负责启动真实项目，也不负责点击验收或模型决策。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/rrweb-io--rrweb/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/rrweb/src/record/index.ts](<../../whybuddy-runtime-references/rrweb-io--rrweb/packages/rrweb/src/record/index.ts>) | 653 | record 入口、事件 emit、初始/增量快照、maskInput/maskText/block 选项以及跨来源 iframe 记录开关。 |
| [packages/rrweb/src/record/observer.ts](<../../whybuddy-runtime-references/rrweb-io--rrweb/packages/rrweb/src/record/observer.ts>) | 1,394 | DOM mutation、输入值/checkbox/radio、鼠标等事件观测和去重；输入遮蔽发生在事件生成前。 |
| [packages/rrweb/src/replay/index.ts](<../../whybuddy-runtime-references/rrweb-io--rrweb/packages/rrweb/src/replay/index.ts>) | 2,321 | Replayer 的 iframe、时间偏移播放/暂停、事件注入和 destroy 清理；可做证据详情页的时间线回放。 |
| [packages/plugins/rrweb-plugin-console-record/src/index.ts](<../../whybuddy-runtime-references/rrweb-io--rrweb/packages/plugins/rrweb-plugin-console-record/src/index.ts>) | 251 | console/error stack 捕获、日志级别、数量/序列化深度限制，可关联到一次验证过程。 |

**移植边界：**

- 重放重建的是记录的 DOM 和事件，不会重新执行真实后端事务；能看到按钮曾被点击不能证明提交成功、刷新数据持久或角色权限正确。
- 录制代码运行在被记录页面环境，生成应用可影响它；不能让该页面上传的事件或 passed 字符串成为 WhyBuddy 的可信验收结果。Playwright worker 与独立断言仍是权威。
- 当前默认 maskInputOptions 仅遮蔽 password，maskAllInputs 需主动配置；跨来源 iframe 记录默认关闭。E2B 预览的注入、来源校验、用户数据遮蔽与证据访问要单独实现。
- 核心可本地记录/重放，不强制云服务；存储、上传和证据保留需 WhyBuddy 自建。MIT 复制/分发保留版权及许可文本。

## Agent 工具、命令执行与补丁

### OpenHands/software-agent-sdk

[GitHub](<https://github.com/OpenHands/software-agent-sdk>) · [本地源码](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk>) · 版本 `refs/heads/main` / [9c3571a69454](<https://github.com/OpenHands/software-agent-sdk/commit/9c3571a694547734002518bd94b3cb41a187f9b6>)

**用途：** OpenHands 的实际执行能力在这里，Python 技术栈与 WhyBuddy 接近。终端、浏览器动作和远端会话订阅都有可读的资源生命周期，优先借工具执行器与回执合同。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [openhands-tools/openhands/tools/terminal/impl.py](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk/openhands-tools/openhands/tools/terminal/impl.py>) | 604 | TerminalExecutor 管理 terminal session 与 tmux pane pool；tmux 消失时重建资源并明确旧命令结果不可靠、不自动重放，保留完整输出位置。 |
| [openhands-tools/openhands/tools/browser_use/impl.py](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk/openhands-tools/openhands/tools/browser_use/impl.py>) | 750 | BrowserToolExecutor 根据类型分派 navigate/click/type 等真实动作，区别正常操作错误与连续超时，超时后受限清理/重建，并返回 BrowserObservation。 |
| [openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py>) | 1,740 | 远端 run 命令与 WebSocket 事件订阅分离；重连回调、fatal close 拒绝重试、409 已运行处理，以及清掉旧终态后等待本轮真实完成，避免初始快照冒充完成。 |
| [openhands-sdk/openhands/sdk/conversation/event_store.py](<../../whybuddy-runtime-references/OpenHands--software-agent-sdk/openhands-sdk/openhands/sdk/conversation/event_store.py>) | 374 | EventLog 按 ID/索引持久化会话事件，初始化重建索引，支持写入 guard 与父事件路径；可参考事件身份、历史兼容和恢复边界。 |

**移植边界：**

- 执行器可用本机 tmux/subprocess/PowerShell，不能直接在 WhyBuddy 宿主运行生成代码；应接已有 E2B provider 与受管 worker。
- 浏览器录像错误采用尽力而为，不阻塞动作；WhyBuddy 必需验收证据缺失仍应 blocked，不能因此宣称业务通过。
- BrowserObservation 是工具观察结果，不具备 WhyBuddy revision/spec/用例覆盖的权威交付判定。
- remote conversation 的重连和终态关联可参考，但 agent server、资源认证与业务数据持久化仍需另外部署和验证。
- 本次未安装浏览器、tmux 或 SDK 依赖，未运行代码；不引入第二套完整 Agent 循环。
- EventLog 的本地文件锁注释明确不适用于可靠的 NFS 协调；不能以文件锁取代 WhyBuddy 的持久 SQL 租约与 generation。

### anomalyco/opencode

[GitHub](<https://github.com/anomalyco/opencode>) · [本地源码](<../../whybuddy-runtime-references/anomalyco--opencode>) · 版本 `refs/heads/dev` / [95daf90670b7](<https://github.com/anomalyco/opencode/commit/95daf90670b7c039c436c85537da5fbfe2205b41>)

**用途：** 补充 grok 的工具、人工决策与上下文处理参考。当前仓库同时有 packages/core 新实现和 packages/opencode 会话适配层，按真实调用边界选取叶子能力，适合改写到现有 Python 控制循环。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/anomalyco--opencode/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/core/src/tool/question.ts](<../../whybuddy-runtime-references/anomalyco--opencode/packages/core/src/tool/question.ts>) | 94 | QuestionTool 类型化问题输入、回答输出、推荐项及自动自由输入约定；execute 先走权限 assert，再按 session/message/toolCall 关联异步回答。 |
| [packages/core/src/permission.ts](<../../whybuddy-runtime-references/anomalyco--opencode/packages/core/src/permission.ts>) | 310 | PermissionV2 分离规则求值、资源列表、人工请求与答复；缺 Agent 权限时 deny，pending Deferred 在生命周期结束时清理，保存规则有项目范围。 |
| [packages/opencode/src/session/compaction.ts](<../../whybuddy-runtime-references/anomalyco--opencode/packages/opencode/src/session/compaction.ts>) | 608 | 真实会话压缩适配：识别已完成摘要、保留近期回合预算、序列化工具结果与失败、裁剪旧输出；可研究减少工程工具重复输入的上下文消耗。 |
| [packages/opencode/src/tool/apply_patch.ts](<../../whybuddy-runtime-references/anomalyco--opencode/packages/opencode/src/tool/apply_patch.ts>) | 313 | ApplyPatchTool 解析 hunk、拒绝空补丁、检查外部目录，维护文件差异与格式/LSP 接口；可借补丁输入和错误结果合同。 |

**移植边界：**

- 当前 core/v1/v2 和 opencode 会话桥接并存，不能把相似文件都当成正在执行的同一链路；本次列出具体已读入口，没有验证部署路径。
- PermissionV2 的等待对象在内存 Map；持久保存允许规则不等于人工等待、模型回合和租约全部可跨进程恢复。
- 默认 ask、按规则资源匹配等产品策略需服从 WhyBuddy 已批准计划范围，不能替换服务端项目归属和 generation 判定。
- 压缩阈值是该产品策略，不应直接覆盖 WhyBuddy 已标定预算；摘要、历史裁剪和累计供应商费用仍需分别记账。
- 复制选中 MIT 源码保留版权与许可；完整 Agent 主循环不直接引入 WhyBuddy。
- 此 apply_patch 操作本机文件系统；WhyBuddy 需将解析与执行分离，补丁受 expectedRevision、项目目录与 E2B 写入权威约束。

### SWE-agent/SWE-ReX

[GitHub](<https://github.com/SWE-agent/SWE-ReX>) · [本地源码](<../../whybuddy-runtime-references/SWE-agent--SWE-ReX>) · 版本 `refs/heads/main` / [5c995c365dfb](<https://github.com/SWE-agent/SWE-ReX/commit/5c995c365dfb1fd5bc56fda688be5d8538f9931f>)

**用途：** SWE-agent 执行环境链路的运行时参考。将远端执行拆成有状态 Bash session、一次性 command、结构化 observation、文件操作和部署层。对 WhyBuddy P3 的 shell session/命令回执/异常转换很有用；采用其合同思想接现有 E2B provider，持久操作、权限与可信终态仍保留 WhyBuddy 权威。

**许可证：** MIT。实际文件：[LICENSE.txt](<../../whybuddy-runtime-references/SWE-agent--SWE-ReX/LICENSE.txt>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [src/swerex/runtime/abstract.py](<../../whybuddy-runtime-references/SWE-agent--SWE-ReX/src/swerex/runtime/abstract.py>) | 288 | Pydantic CreateBashSessionRequest/BashAction/BashInterruptAction/BashObservation/CommandResponse 与 AbstractRuntime；明确 session/action 类型、timeout、check=raise/silent/ignore、exit_code 可未知，适合工程工具 wire 合同。 |
| [src/swerex/runtime/local.py](<../../whybuddy-runtime-references/SWE-agent--SWE-ReX/src/swerex/runtime/local.py>) | 478 | 真实 BashSession.start/run/_run_normal/interrupt/close 与 LocalRuntime.execute：pexpect 持续 shell、提示符/退出码读取、SIGINT 重试与 job-control fallback、subprocess 一次性命令。重点区分命令退出码、等待超时和恢复到提示符。 |
| [src/swerex/runtime/remote.py](<../../whybuddy-runtime-references/SWE-agent--SWE-ReX/src/swerex/runtime/remote.py>) | 265 | RemoteRuntime 把会话/执行/文件调用转为 HTTP，携带 X-API-Key 和同次重试的 X-Request-ID，解码结构化结果与远端异常；可参考 provider transport 与错误分类。 |

**移植边界：**

- LocalRuntime 会直接在其运行环境执行 bash/subprocess 和文件读写；它不是隔离层。在 WhyBuddy 应只在受管 E2B 环境中部署相应执行能力，不能作为生成代码在宿主执行的 fallback。
- 当前 BashSession.interrupt 在看到提示符或自定义 expect 后返回 exit_code=0；这个 0 表示中断流程得到响应，不是原命令成功，也不能证明全部后台/子进程已停止。WhyBuddy 必须保留自己的进程归属与停止确认合同。
- run 的 pexpect timeout 主要表示等待结束条件超时，不能直接推断远端命令已取消；close session、cancel command 和 destroy workspace 需要分开处理。普通/交互路径的 exit_code 语义也不同。
- src/swerex/server.py 的 ResponseManager 只缓存内存中最后一个 request 的结果，docstring 明确多客户端并发不保证幂等。不能把 X-Request-ID 等同于跨服务重启/多 worker 的持久 exactly-once；继续使用 WhyBuddy 操作表、租约代次和回执对账。
- server 的 API key 按配置启用；runtime 文件 API 直接接受路径，并不提供 WhyBuddy project owner、目录根限制或版本 CAS。HTTP client 还会按远端异常 class_path 查找/导入模块，不能不加边界地信任任意远端响应。
- 当前 local.py 的 async 方法内部有同步 pexpect/subprocess 等待，不能直接嵌入 WhyBuddy FastAPI 事件循环；应在独立 worker/线程或适配异步执行。
- 开源运行时不强制某一云产品；仓内另有 Docker/Modal/Fargate/Daytona 等 deployment，相关平台与容器运行条件、凭证、计费独立。源码克隆不会获得这些服务。
- MIT 允许修改和商业使用，复制较大部分或分发时保留 Kilian Lieret、Carlos E. Jimenez 的版权和 LICENSE.txt；依赖与部署镜像的许可另行核对。

### cline/cline

[GitHub](<https://github.com/cline/cline>) · [本地源码](<../../whybuddy-runtime-references/cline--cline>) · 版本 `refs/heads/main` / [cfe9cadab996](<https://github.com/cline/cline/commit/cfe9cadab99617d5013bf89f07b079d105057791>)

**用途：** 当前核心入口已在 sdk/packages/core。任务版本与批准失效、检查点恢复事务和人工批准请求都能提供具体实现参考，尤其适合核对 WhyBuddy 的持久任务与恢复边界。

**许可证：** Apache-2.0。实际文件：[LICENSE](<../../whybuddy-runtime-references/cline--cline/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [sdk/packages/core/src/session/checkpoint-restore.ts](<../../whybuddy-runtime-references/cline--cline/sdk/packages/core/src/session/checkpoint-restore.ts>) | 478 | beginWorktreeRestoreTransaction 在恢复前包含未跟踪文件建立临时 stash/private ref，提供 commit/rollback；可借恢复前保留原状态、失败可回滚的合同。 |
| [sdk/packages/core/src/tasks/store/sqlite-task-store.ts](<../../whybuddy-runtime-references/cline--cline/sdk/packages/core/src/tasks/store/sqlite-task-store.ts>) | 787 | updateTask 校验 expectedRevision，修改后递增版本并撤销 approvedRevision；进入 in_progress 时批准必须匹配当前 revision，任务与运行记录分开。 |
| [sdk/packages/core/src/runtime/tools/tool-approval.ts](<../../whybuddy-runtime-references/cline--cline/sdk/packages/core/src/runtime/tools/tool-approval.ts>) | 102 | requestDesktopToolApproval 写关联 session/toolCall 的请求文件，等待决定并清理，未配置及超时均 approved=false；可借批准请求和结果的生命周期。 |

**移植边界：**

- 检查点恢复会执行真实 git stash/reset/clean，不能直接在 WhyBuddy 主仓或非隔离目录应用；工程不可变版本和业务数据库备份也不是同一件事。
- 本地 SQLite 任务合同不自动提供 WhyBuddy 多租户、持久 worker generation 或 E2B 进程对账；需要接已有服务端权威。
- 此处批准 IPC 是桌面本地文件轮询，不能充当云端身份认证或可信授权回执。
- 只参考已读 SDK 文件，未运行 Cline 或扩展；复制 Apache-2.0 源码保留许可、版权和适用通知，标注修改。

### Aider-AI/aider

[GitHub](<https://github.com/Aider-AI/aider>) · [本地源码](<../../whybuddy-runtime-references/Aider-AI--aider>) · 版本 `refs/heads/main` / [5dc9490bb35f](<https://github.com/Aider-AI/aider/commit/5dc9490bb35f9729ef2c95d00a19ccd30c26339c>)

**用途：** 最值得借的是把大工程压成模型可读上下文，以及把补丁失败变成可修正的真实反馈；与当前工程读改和预算优化直接相关。

**许可证：** Apache-2.0。实际文件：[LICENSE.txt](<../../whybuddy-runtime-references/Aider-AI--aider/LICENSE.txt>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [aider/repomap.py](<../../whybuddy-runtime-references/Aider-AI--aider/aider/repomap.py>) | 867 | RepoMap 用语法标签、引用图 PageRank、文件/标识符相关性与 token 预算挑选源码地图，缓存索引和渲染结果；可参考工程上下文选择。 |
| [aider/coders/editblock_coder.py](<../../whybuddy-runtime-references/Aider-AI--aider/aider/coders/editblock_coder.py>) | 657 | 解析 SEARCH/REPLACE，执行 dry run 和替换；未匹配时反馈实际相似行、哪些块已成功、哪些需要重发，帮助模型修正失败补丁。 |

**移植边界：**

- RepoMap 是模型上下文摘要，不是完整静态依赖图；不能替代 WhyBuddy 自动生成的 Python/TS 权威架构。
- 指定文件匹配失败后，当前 apply_edits 会尝试其他聊天文件；WhyBuddy 应保留指定路径、expectedRevision 和文件 SHA 的严格边界。
- 补丁可能部分成功后才报告失败，不是跨文件原子事务；迁移时需按 WhyBuddy 不可变 revision 合同处理。
- 文件内虽有 edit-distance fuzzy 函数，但当前 replace_most_similar_chunk 在调用它之前已 return，不能把未执行代码当现有能力。
- 复制 Apache-2.0 源码保留许可和版权；模型调用、Git 自动提交和本地执行路径无需整体引入。

### SWE-agent/SWE-agent

[GitHub](<https://github.com/SWE-agent/SWE-agent>) · [本地源码](<../../whybuddy-runtime-references/SWE-agent--SWE-agent>) · 版本 `refs/heads/main` / [3ea751c087f3](<https://github.com/SWE-agent/SWE-agent/commit/3ea751c087f32b16e039a2233dd6eefecef325d5>)

**用途：** 适合提取工具包安装/能力检查、执行环境适配和长工具历史压缩思想。当前执行环境通过 SWE-ReX 抽象调用，实际进程能力不全在本仓。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/SWE-agent--SWE-agent/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [sweagent/environment/swe_env.py](<../../whybuddy-runtime-references/SWE-agent--SWE-agent/sweagent/environment/swe_env.py>) | 276 | SWEEnv.start/close/interrupt_session/communicate 调用 deployment/runtime，传递 BashAction、真实输出和退出码检查；文件操作走 ReadFileRequest/WriteFileRequest。 |
| [sweagent/tools/tools.py](<../../whybuddy-runtime-references/SWE-agent--SWE-agent/sweagent/tools/tools.py>) | 430 | ToolHandler 安装工具 bundle、检查命令存在、重置环境和 registry 状态，展示模型菜单需要与真实可执行工具一致。 |
| [sweagent/agent/history_processors.py](<../../whybuddy-runtime-references/SWE-agent--SWE-agent/sweagent/agent/history_processors.py>) | 399 | LastNObservations 保留首个环境观察及近 N 次输出，按 tags 保留或省略，旧内容明确标注省略；可参考工具日志压缩和缓存取舍。 |

**移植边界：**

- 默认环境是 DockerDeploymentConfig，依赖外部 SWE-ReX；这不是 E2B 私有预览网关，也不是可直接复制的完整执行后端。
- communicate 最终向上只返回输出字符串，不能用它代替 WhyBuddy 含 operationId/exitCode/revision 的持久回执。
- ToolFilterConfig 是命令 blocklist，不是操作系统沙盒或多租户授权；环境变量传播和 TRACE 输入/输出日志也需改成项目 secret 与脱敏策略。
- LastNObservations 会影响 prompt caching；不能以裁剪历史为由删除累计费用、批准记录或当前验收证据。
- 本次没有执行工具 bundle 的 install.sh、启动 Docker 或运行 benchmark；MIT 源码复制保留版权和许可。

## 工作台状态、面板与源码编辑

### OpenHands/OpenHands

[GitHub](<https://github.com/OpenHands/OpenHands>) · [本地源码](<../../whybuddy-runtime-references/OpenHands--OpenHands>) · 版本 `refs/heads/main` / [d149fb5a3f0d](<https://github.com/OpenHands/OpenHands/commit/d149fb5a3f0d18e0450ebb3b3ff261dc715a91ee>)

**用途：** 当前检出是 src 下的工作台与桌面/云端适配，不是旧路径 frontend/openhands。值得提取会话切换、历史事件去重及执行后端适配；浏览器面板的真实能力应按源码理解。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/OpenHands--OpenHands/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [src/components/features/browser/browser.tsx](<../../whybuddy-runtime-references/OpenHands--OpenHands/src/components/features/browser/browser.tsx>) | 26 | BrowserPanel 从 browser-store 取 URL 和 screenshotSrc，交给 BrowserSnapshot 显示截图；这是浏览器观察面板，不是可交互网页 iframe。 |
| [src/stores/use-event-store.ts](<../../whybuddy-runtime-references/OpenHands--OpenHands/src/stores/use-event-store.ts>) | 237 | 按事件 ID 去重、合并同发送者的流式增量、历史批量插入；clearEventsForConversation 原子绑定当前会话，避免重挂载与真正换会话混淆。 |
| [src/api/conversation-service/agent-server-conversation-service.api.ts](<../../whybuddy-runtime-references/OpenHands--OpenHands/src/api/conversation-service/agent-server-conversation-service.api.ts>) | 1,145 | sendMessage 将消息发送给真实 ConversationClient 或云端代理，携带 run=true；createConversation 区分云任务和本地后端，展示 UI 与执行服务的职责分界。 |

**移植边界：**

- BrowserSnapshot 实际渲染 img。复制此面板不会获得沙盒浏览器实时操作或 Vite HMR，真实执行能力在独立 software-agent-sdk/agent server。
- 事件存储在前端按时间排序与去重；WhyBuddy 仍需后端单调 seq、快照 lastSeq 和旧 generation 拒绝，不能用时间戳代替运行事件权威。
- 该产品可以让客户端持有 session API key；WhyBuddy 的 E2B 管理凭据和预览票据采用自己的隔离设计，不能照搬凭据分发方式。
- 云端与本地 agent server 是额外服务，克隆 UI 仓库不获得云沙盒或托管能力；本次没有启动任何后端。

### assistant-ui/assistant-ui

[GitHub](<https://github.com/assistant-ui/assistant-ui>) · [本地源码](<../../whybuddy-runtime-references/assistant-ui--assistant-ui>) · 版本 `refs/heads/main` / [c41d93a84231](<https://github.com/assistant-ui/assistant-ui/commit/c41d93a84231a54256e0e1fe6f64951603a039d7>)

**用途：** 适合把现有问答、批准、工具状态和消息展示做成稳定 React 组件。源码对历史恢复时误执行工具、流式参数不完整和面板显示有具体处理，可补强 WhyBuddy 前端消费合同。

**许可证：** MIT。实际文件：[LICENSE](<../../whybuddy-runtime-references/assistant-ui--assistant-ui/LICENSE>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [packages/core/src/runtimes/tool-invocations/ToolInvocationTracker.ts](<../../whybuddy-runtime-references/assistant-ui--assistant-ui/packages/core/src/runtimes/tool-invocations/ToolInvocationTracker.ts>) | 912 | 按 toolCallId 跟踪调用及人工 interrupt；历史加载时只恢复记录，避免触发 execute；管道异常后至多重建一次，已经进入执行的调用不会因重建再次触发。 |
| [packages/assistant-stream/src/core/tool/ToolCallReader.ts](<../../whybuddy-runtime-references/assistant-ui--assistant-ui/packages/assistant-stream/src/core/tool/ToolCallReader.ts>) | 519 | 按字段读取部分 JSON 参数，区分字段未完成、完成和整流结束，提供值流/文本流并管理 dispose/error；可用于渐进显示工具参数。 |
| [packages/core/src/runtimes/external-store/external-store-thread-runtime-core.ts](<../../whybuddy-runtime-references/assistant-ui--assistant-ui/packages/core/src/runtimes/external-store/external-store-thread-runtime-core.ts>) | 994 | 外部状态 adapter 驱动会话消息、运行状态和工具调用；将消息转换、运行回调、恢复与组件订阅接在外部 store 上，适合接 Python 权威事件。 |

**移植边界：**

- ToolInvocationTracker 是前端工具执行状态，不是跨进程持久 exactly-once；WhyBuddy 的工程写入、批准和交付判定仍由 Python 权威负责。
- 不要把恢复历史时展示工具卡变成在浏览器重放 E2B 副作用；接服务端工具只消费状态和提交明确命令。
- 部分 JSON 可以用于展示，不能替代服务端完整参数 schema 验证。
- Tracker 当前标记为内部 deprecated API，整包复制内部类会增加升级负担；宜复用公共组件或改写稳定合同。
- 源码包含可选云同步组件，但本次选中能力不要求购买云服务；没有安装 UI 包或更换当前工作台。

### microsoft/monaco-editor

[GitHub](<https://github.com/microsoft/monaco-editor>) · [本地源码](<../../whybuddy-runtime-references/microsoft--monaco-editor>) · 版本 `refs/heads/main` / [d620ca0c03d2](<https://github.com/microsoft/monaco-editor/commit/d620ca0c03d24a51c05ae4dca8a9d5923a4aeb9c>)

**用途：** P6 源码查看和编辑体验参考。当前新增 LSP 适配入口位于 monaco-lsp-client/src/adapters/languageFeatures，可借诊断标记、模型映射与跨文件修改预览。

**许可证：** MIT。实际文件：[LICENSE.txt](<../../whybuddy-runtime-references/microsoft--monaco-editor/LICENSE.txt>)。

| 源码入口 | 文件 LOC | 具体阅读内容 |
|---|---:|---|
| [monaco-lsp-client/src/adapters/languageFeatures/LspDiagnosticsFeature.ts](<../../whybuddy-runtime-references/microsoft--monaco-editor/monaco-lsp-client/src/adapters/languageFeatures/LspDiagnosticsFeature.ts>) | 207 | 接收 publishDiagnostics 和按模型拉取诊断，转换为 Monaco markers，监听模型生命周期及内容变化；可用于真实语言服务报错显示。 |
| [monaco-lsp-client/src/adapters/languageFeatures/LspRenameFeature.ts](<../../whybuddy-runtime-references/microsoft--monaco-editor/monaco-lsp-client/src/adapters/languageFeatures/LspRenameFeature.ts>) | 142 | 注册 RenameProvider，将语言服务的 prepareRename/rename 和 WorkspaceEdit 映射到 Monaco 文本模型；可研究跨文件变更预览与提交。 |

**移植边界：**

- Monaco 是编辑器与语言特性适配，不执行生成工程，也不提供沙盒、预览、源码持久化或项目权限。语言服务器与传输还需部署。
- 当前 rename 转换对 CreateFile/RenameFile/DeleteFile 仍有 TODO，不能把文本重命名当完整文件操作。
- RenameProvider 收到 CancellationToken，但已读方法没有将它传入实际服务器请求；不能宣称远端请求已可取消。
- 诊断入口声明 versionSupport，但已读 push 处理只映射模型并设置 markers，未对 params.version 做拒绝检查；WhyBuddy 需另做 revision/version 防陈旧显示。
- 编辑器里的修改必须通过 expectedRevision/文件 hash 的服务端补丁保存才算工程版本；不应直接将浏览器缓冲区当持久源码。

## 如何用于下一次功能提交

1. 从本索引选择一个具体能力，同时对照 grok-build 和 WhyBuddy 的真实入口、注释与现有测试。
2. 在移植提交中记录来源仓库、固定 commit、文件及适用许可；将行为合同接入现有 Python / TS 分层。
3. 跑对应入口的正反用例与必要变异，再做 E2B / 浏览器真机验证。参考项目的测试结果不能替代 WhyBuddy 的验收。
4. 代码集成后再重新生成与检查权威架构图，更新重构方案的阶段事实。源码收藏数量不换算为重构完成率。

## 2026-09-13 本地工作台实测补充

使用真实账号、Chrome `1920×1080` 视口访问 `/agent-loop/sliderule`，登录、历史会话恢复、右侧架构沙盘和新建空会话均通过。首轮浏览器日志发现匿名/空会话会产生登录门控 401/不存在资源 404；WhyBuddy 已调整为认证后才恢复 durable run，空舞台不查询尚未生成的 app。定向前端回归 90 项通过，新建会话复测日志为 0 条错误。截图与 JSON 报告见 `artifacts/local-1920-audit/`。本地 rollout 仍是 disabled，工程创建/预览显示 blocked 属于配置事实。

`app-wall-holes.mjs` 现支持 Windows Chrome channel；在 `/agent-loop/workbench` 的 1920 宽度实测 24 张卡、6 列、空洞 0，截图见 `artifacts/local-1920-audit/wall-holes.png`。

后续真实工程入口实测已将本地开发 rollout 开到 `internal`，真实模型通过问卷和计划批准创建了任务工程，11 个源码文件可从工作台读取。工程引用通过现有 Python 持久事件→SSE driver→React hook 即时投影，修正了模型回合未结束时仍显示 HTML、失败后旧状态覆盖需求及失败被记为完成的问题。这里沿用当前以 grok 为参考的控制与展示职责，没有引入另一套 Agent 循环。源码面板和版本恢复的权威仍在 Python。

本机该模型回合实际遇到 `content_filter`，没有启动应用；本机私有预览入口仍缺配置。另一个独立 E2B 云夹具通过 18 项宿主和 55 项工作台检查，不能与真实模型样本拼接成自主交付结论。当前事实、修复和 1920×1080 实图位置见 [重构方案 §26.4](<WhyBuddy 工程运行与浏览器验证整体重构方案.md#264-2026-09-13-本地真实模型工程入口与失败恢复>)。

## 2026-09-13 第二轮实测与能力装配

继续以现有 WhyBuddy 的 Python 控制循环和 React 工作台为根基。本轮没有再搬入一套 Agent，修的是原链路中的实际断点：文件与交付请求失败后的终态/重试、服务端批准错误的前端解释、未启动工程的预览缺项提示、规划时的真实环境能力，以及运行期间标题和失败标签的准确性。

能力装配沿用 grok shell 的统一重建思想：首次规划、工具回填和持久恢复共用同一个 system prompt 装配入口。预览是否配置由原 runtime owner 提供，浏览器是否配置复用实际 provider 的本地 availability 检查；不能把配置检查称为云连通或浏览器验收。对应真实入口与变异测试已经接入，本轮未放宽任何架构基线。

真实账号、1920×1080 Chrome 已走问卷、计划修改、刷新恢复、重启后的批准与任务模板工程创建，11 个源码文件成功回读；随后上游 content_filter 中断，原源码和批准仍在。本机独立 HTTPS/WSS 网关仍缺配置。文件/交付故障注入恢复、真实 ZIP 下载与六个面板截图分别留证，不能与此前独立云夹具拼接成一次完整自主交付。

最新修复、测试和实际限制见 [重构方案 §26.5](<WhyBuddy 工程运行与浏览器验证整体重构方案.md#265-2026-09-13-第二轮真实账号与故障恢复实测>)；原始证据统一在 `artifacts/local-1920-audit-round2/`。

用户反馈当前还达不到 Manus 类连续执行体验，后续源码提取优先级调整为：同一目标的持久等待与操作完成后续跑、真实动作/文件/预览的同步展示、实际新增需求的独立浏览器验收。继续使用 grok 宿主与工具的职责划分；现有 16 轮/180 秒控制回合、两个固定浏览器套件和已接通的面板，不足以代表完整自主开发能力。当前差距和下一完整样本的验收标准见 [重构方案 §27](<WhyBuddy 工程运行与浏览器验证整体重构方案.md#27-2026-09-13-产品体验差距与下一步验收>)。不增加阶段编号来代替这些实际结果。
