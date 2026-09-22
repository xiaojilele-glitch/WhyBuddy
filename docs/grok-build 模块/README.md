# grok-build：十个大模块拆解索引

[全仓模块总览](../grok-build%20%E6%A8%A1%E5%9D%97%E6%80%BB%E8%A7%88%EF%BC%88%E8%87%AA%E5%8A%A8%E7%94%9F%E6%88%90%EF%BC%89.md)

先用这页选模块，再到各自文档里找职责、入口、子系统、关键链路、测试和文件清单。所有行数与依赖由源码扫描；中文解读来自源码阅读，维护在 scripts/grok-module-notes-*.json。

生成：`pnpm run arch:grok:details`；图、总览和详解一起刷新：`pnpm run arch:grok:emit`；核对全部生成物：`pnpm run arch:grok:check`。

SOURCE_REV：`c4ea71cfdbcdb21e32e41bc25a0043d7d4836714`。源码默认 ../grok-build，可用 GROK_BUILD_ROOT 指定。源码链接指向外部 checkout；GitHub 单独浏览 WhyBuddy 仓库时不会带上 grok 源码。

## 十份详解

| 模块 | 职责 | .rs | source LOC | raw LOC |
|---|---|---|---|---|
| [xai-grok-pager](xai-grok-pager.md) | Grok Build 的全屏终端 UI。它持有欢迎页、多个会话、每会话的滚动历史和交互卡片，并把终端输入和 ACP 通知变成同步状态更新与异步 Effect。README 明确描述为 scrollback、prompt、session management 和 modal dialogs 的交互界面。 | 604 | 448,370 | 520,203 |
| [xai-grok-shell](xai-grok-shell.md) | Grok 的会话宿主和运行时编排层。README 定义其为 terminal AI coding assistant/agentic harness，并支持 TUI、headless 和 ACP；源代码承担会话 actor、采样、工具桥接、持久化、MCP、插件、配置、leader 和上传。 | 633 | 355,492 | 400,975 |
| [xai-grok-tools](xai-grok-tools.md) | 模型工具层：定义工具的输入输出、注册和实现。内置实现覆盖命令、读文件、搜索替换、任务、人工问答和本机 computer 终端；它把模型意图变为受类型约束的工具请求。 | 270 | 124,959 | 149,673 |
| [xai-grok-workspace](xai-grok-workspace.md) | 本机工作区宿主层：管理文件、VCS、worktree、项目配置、工具会话、权限、sandbox 元数据和可选 preview 服务。当前开源快照保留 BrowserService 相关注释与接口占位，但没有完整浏览器后端实现；不能据此声称浏览器闭环已经可用。 | 113 | 97,976 | 111,136 |
| [xai-grok-pager-render](xai-grok-pager-render.md) | 从 pager 抽出的终端呈现原语层：theme/appearance、键鼠正规化、terminal capability、clipboard、图片/视频 overlay、滚动条、文本折行和 frame writer。它不是业务面板库。 | 79 | 32,565 | 40,553 |
| [xai-grok-pager-pty-harness](xai-grok-pager-pty-harness.md) | pager 的真实 PTY E2E、性能和复现场景库。它启动真实 pager binary，在伪终端注入键鼠/调整尺寸，用终端模拟器读取用户实际看到的屏幕，并以 mock inference 驱动完整流。 | 275 | 32,483 | 40,463 |
| [xai-fast-worktree](xai-fast-worktree.md) | 高性能 Git worktree 创建库。它结合 git worktree 元数据、并行 CoW 文件复制、BTRFS/overlay 快照、NFS、同步、自动 GC 和可选 SQLite 元数据，优化大仓库隔离副本的创建和复用。 | 76 | 32,515 | 38,775 |
| [xai-grok-login](xai-grok-login.md) | Grok shell 家族的认证子系统：管理登录流程、设备码/OIDC、token 刷新、凭证 provider、归因和认证存储。它从 shell 的旧 auth 模块拆出，并被 shell 重新导出以维持调用路径。 | 45 | 23,221 | 26,653 |
| [xai-grok-telemetry](xai-grok-telemetry.md) | Grok Build 的遥测引擎：产品事件、Mixpanel 发射、Sentry 错误上报、OpenTelemetry tracing、结构化 unified log、启动信息和进程指标都由它提供。 | 59 | 20,481 | 24,059 |
| [xai-grok-agent](xai-grok-agent.md) | 可移植的 Agent 构建层。README 和 lib.rs 都明确：它把 tools、system prompt、system-reminder、compaction policy 与 model configuration 组装成任何 host 能消费的 Agent。 | 31 | 19,044 | 22,093 |

## 建议拆解顺序

1. **pager**：先找出 62 个视图声明、状态归属、输入和提交协议。问卷/批准/权限卡优先带着恢复链一起读。
2. **shell + agent + tools**：把用户选择怎样恢复 turn、agent 如何装配工具、工具怎样交还结果连起来。
3. **workspace + fast-worktree**：研究权限边界、文件与进程、工作树隔离、preview/browser 服务的宿主接口。
4. **pager-render + PTY harness**：分别提取显示原语与可复现验证场景；Web 端的呈现和验证需要换成浏览器实现。
5. **login + telemetry**：补足登录/凭证、事件结构、脱敏和运行诊断。

每次继续拆一个子模块时，记录它接收什么、谁拥有状态、触发什么副作用、产生什么结果，以及哪条测试覆盖取消/恢复。不能只拿一段 render 函数就认定整套能力已经搬过去。

## 当前快照的浏览器能力边界

这份 grok-build 是公开的 CLI 源码快照。workspace 里 BrowserService 的部分描述保留在注释中，但 finalize_session_setup 没有实际注入浏览器，shutdown_browser_service 是空函数，browser_tab_chrome_e2e.rs 只有注释。权限、终端、工作树和可选 preview 接口有实现；完整浏览器服务需要另外接入。详见 [workspace 的源码依据](xai-grok-workspace.md)。

## 数字如何理解

source LOC 保留字符串、排除注释和空行，仍含内嵌测试。独立测试、基准和示例按路径分桶。修正了上一版字符串被误当注释、*_tests.rs 漏分的问题，因此源码版本相同也可能与旧表不同。

图与清单覆盖的是静态声明，不是全部运行场景。本轮检查文档生成、文件/符号引用与图渲染，没有运行 grok Rust 全套测试，也没有搬迁十个模块的产品实现。
