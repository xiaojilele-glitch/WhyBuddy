# grok-build 模块总览（自动生成）

> ⚠ 这份文件由 `scripts/arch-graph-grok.py --overview` 生成。请修改源码后重新生成，不要手改。

- 对照源码：`C:\Users\wangchunji\Documents\grok-build`
- SOURCE_REV：`c4ea71cfdbcdb21e32e41bc25a0043d7d4836714`
- Cargo workspace 声明成员：**101**；实际读取 crate：**101**
- 十个大模块的内部拆解：[详细文档索引](grok-build%20模块/README.md)。
- 内部运行时依赖边：**381**；叶子：**42**；根：**4**；循环：**0**
- 行数口径：`source LOC` = 所有 `.rs` 去掉空行和注释后的非空行（保留字符串内容，包含内嵌测试）；`raw LOC` = 原始行数。`测试 LOC` 按 tests/、*_tests/、test_*.rs、*_test.rs、*_tests.rs、tests.rs 路径识别，是总数的子集；source 类文件仍可能包含内嵌测试。
- 巨型叶子口径：出度为 0 且 source LOC ≥ 10,000。它们是依赖图的底层节点，但可能承载完整产品功能。

## 先看结论

- 最大模块：`xai-grok-pager`（448,370 source LOC，520,203 raw LOC）
- 达到 10,000 source LOC 的巨型叶子：**1** 个；最大为 `xai-ratatui-textarea`（11,674 source LOC）
- 依赖关系最密集的模块见下方“入度/出度排行”；这比单看文件数量更能说明谁是公共底座、谁是产品入口。

## 叶子模块（优先阅读）

叶子没有继续依赖 grok-build 内部 crate。下面按 source LOC 列出前 12 个；达到 10,000 的标为“巨型”，小而关键的 `xai-workflow` 也保留在清单里。

| crate | 标记 | 用途 | source LOC | raw LOC | .rs 文件 | 入度 |
|---|---|---|---:|---:|---:|---:|
| `xai-ratatui-textarea` | 巨型 | 根据 crate 名称和目录推断 | 11,674 | 14,746 | 14 | 3 |
| `xai-grok-workspace-types` |  | Wire types for the xAI workspace API (request/chunk/event enums shared by client and server) | 6,851 | 9,054 | 50 | 4 |
| `xai-grok-compaction` |  | Shared, transport-agnostic compaction engine for Grok chat and Grok Build. | 5,394 | 7,804 | 34 | 3 |
| `xai-fsnotify` |  | Local-filesystem event source: single causal stream of semantic FsEvents | 4,503 | 5,650 | 19 | 2 |
| `xai-tool-types` |  | Canonical tool-description types for the xAI platform | 3,348 | 4,368 | 7 | 12 |
| `xai-workflow` | 关键叶子 | Rhai-scripted dynamic workflow engine: scripts orchestrate agents through a host channel | 3,249 | 3,501 | 8 | 1 |
| `xai-tty-utils` |  | Lightweight process-spawning utilities for TTY safety — detach from controlling terminal, suppress interactive pagers, process-group lifecycle | 3,116 | 4,195 | 12 | 19 |
| `prod-mc-cli-chat-proxy-types` |  | Lightweight request/response types for cli-chat-proxy API | 3,027 | 4,294 | 11 | 5 |
| `xai-ratatui-inline` |  | ratatui-inline | 2,543 | 3,375 | 10 | 3 |
| `xai-grok-gboom` |  | The /gboom easter-egg raycaster game for the grok CLI pager | 2,425 | 2,927 | 4 | 2 |
| `xai-grok-feedback` |  | Shared feedback taxonomy, durable local draft storage, and the session trace archive builder for Grok Build | 2,330 | 2,623 | 11 | 3 |
| `ptyctl` |  | Headless PTY controller built on alacritty_terminal | 1,797 | 2,320 | 8 | 2 |

## 巨型模块（不一定是叶子）

用户界面、会话宿主和工具实现往往是大模块，同时还会依赖很多底层 crate。它们是拆分五十多个面板时最值得对照的地方。

| crate | 用途 | source LOC | raw LOC | .rs 文件 | 入度 | 出度 |
|---|---|---:|---:|---:|---:|---:|
| `xai-grok-pager` | xai-grok-pager | 448,370 | 520,203 | 604 | 2 | 36 |
| `xai-grok-shell` | Grok | 355,492 | 400,975 | 633 | 4 | 58 |
| `xai-grok-tools` | Grok tools library | 124,959 | 149,673 | 270 | 14 | 22 |
| `xai-grok-workspace` | Core host-local workspace library (FS, VCS, execution, discovery) for xai-grok-shell and remote sampler | 97,976 | 111,136 | 113 | 6 | 34 |
| `xai-grok-pager-render` | 根据 crate 名称和目录推断 | 32,565 | 40,553 | 79 | 1 | 12 |
| `xai-fast-worktree` | High-performance git worktree creation using CoW cloning | 32,515 | 38,775 | 76 | 3 | 4 |
| `xai-grok-pager-pty-harness` | Shared PTY harness + scenario library for xai-grok-pager e2e tests and benchmarks. | 32,483 | 40,463 | 275 | 0 | 3 |
| `xai-grok-login` | Authentication subsystem for the grok shell crate family: login flows, token refresh, credential providers, and auth storage. | 23,221 | 26,653 | 45 | 4 | 13 |
| `xai-grok-telemetry` | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions | 20,481 | 24,059 | 59 | 10 | 14 |
| `xai-grok-agent` | Agent builder, definition parsing, and system prompt assembly | 19,044 | 22,093 | 31 | 5 | 8 |
| `xai-grok-markdown` | Streaming markdown renderer for terminal UIs | 17,636 | 21,379 | 27 | 2 | 2 |
| `mermaid-to-svg` | Convert Mermaid diagram source to SVG via a dagre layout port (vendored, library-only) | 17,408 | 20,425 | 35 | 1 | 2 |

## 按功能分组

| 分组 | crate 数 | source LOC | 这一组负责什么 |
|---|---:|---:|---|
| `build` | 1 | 517 | 构建期代码生成和协议类型 |
| `codegen` | 83 | 1,452,489 | 产品主干：agent、tools、shell、pager、workspace |
| `common` | 12 | 43,145 | 跨产品基础能力：协议、运行时、会话与压缩 |
| `prod` | 1 | 3,027 | 生产侧小型共享包 |
| `third_party` | 4 | 21,624 | 第三方布局/图渲染库 |

## 入度排行（谁被最多模块使用）

| crate | 入度 | 出度 | source LOC | 用途 |
|---|---:|---:|---:|---|
| `xai-grok-config` | 21 | 5 | 10,470 | Shared config loading for Grok — grok_home, effective config (requirements > user > managed), TOML merge |
| `xai-tty-utils` | 19 | 0 | 3,116 | Lightweight process-spawning utilities for TTY safety — detach from controlling terminal, suppress interactive pagers, process-group lifecycle |
| `xai-grok-version` | 18 | 0 | 68 | Lockstepped grok CLI version. |
| `xai-dirs` | 17 | 0 | 102 | Home-directory resolution generally: USERPROFILE-first home_dir, plus grok-home ($GROK_HOME or <home>/.grok) |
| `xai-grok-extra-ca` | 14 | 0 | 723 | TLS policy for the grok CLI: rustls backend pin, process crypto provider, shared root store, and opt-in GROK_EXTRA_CA_BUNDLE roots |
| `xai-grok-tools` | 14 | 22 | 124,959 | Grok tools library |
| `xai-tool-types` | 12 | 0 | 3,348 | Canonical tool-description types for the xAI platform |
| `xai-grok-auth` | 10 | 0 | 383 | Auth dependency-inversion seam: HttpAuth + AuthCredentialProvider traits |
| `xai-grok-telemetry` | 10 | 14 | 20,481 | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions |
| `xai-tool-protocol` | 10 | 1 | 7,709 | Wire-protocol types for the xAI Computer Hub |
| `xai-grok-env` | 8 | 0 | 281 | Backend environment for the Grok CLI crate family: endpoint URL presets, shared GROK_*/XAI_* readers, the credentials-path resolver, and the first-party credential list. |
| `xai-grok-sandbox` | 8 | 2 | 8,187 | OS-level sandboxing for Grok Build using kernel primitives (Landlock/Seatbelt) via nono |

## 出度排行（谁在编排最多模块）

| crate | 出度 | 入度 | source LOC | 用途 |
|---|---:|---:|---:|---|
| `xai-grok-shell` | 58 | 4 | 355,492 | Grok |
| `xai-grok-pager` | 36 | 2 | 448,370 | xai-grok-pager |
| `xai-grok-workspace` | 34 | 6 | 97,976 | Core host-local workspace library (FS, VCS, execution, discovery) for xai-grok-shell and remote sampler |
| `xai-grok-tools` | 22 | 14 | 124,959 | Grok tools library |
| `xai-grok-pager-bin` | 15 | 0 | 3,573 | 根据 crate 名称和目录推断 |
| `xai-grok-telemetry` | 14 | 10 | 20,481 | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions |
| `xai-grok-login` | 13 | 4 | 23,221 | Authentication subsystem for the grok shell crate family: login flows, token refresh, credential providers, and auth storage. |
| `xai-grok-pager-render` | 12 | 1 | 32,565 | 根据 crate 名称和目录推断 |
| `xai-grok-mcp` | 11 | 3 | 11,761 | MCP integration crate. Quarantines rmcp + reqwest 0.13 (rmcp 3.x requires reqwest >= 0.13.2 while the rest of the workspace uses reqwest 0.12) and owns the MCP credential store and OAuth flow orchestrator. |
| `xai-grok-agent` | 8 | 5 | 19,044 | Agent builder, definition parsing, and system prompt assembly |
| `xai-file-utils` | 7 | 7 | 11,616 | Local data collection: upload queueing and blob storage |
| `xai-grok-memory` | 7 | 2 | 12,642 | Cross-session memory for Grok. |

## 完整 crate 清单

| crate | 分组 | 用途 | source LOC | raw LOC | 测试 LOC | .rs 文件 | 入度 | 出度 | 角色 | 路径 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `dagre_rust` | `third_party` | Dagre layout in Rust (vendored, library-only) | 3,323 | 4,179 | 0 | 24 | 1 | 2 | internal | `third_party/dagre_rust` |
| `graphlib_rust` | `third_party` | Dagre's graphlib in Rust (vendored, library-only) | 766 | 1,113 | 0 | 6 | 2 | 1 | internal | `third_party/graphlib_rust` |
| `mermaid-to-svg` | `third_party` | Convert Mermaid diagram source to SVG via a dagre layout port (vendored, library-only) | 17,408 | 20,425 | 0 | 35 | 1 | 2 | internal | `third_party/mermaid-to-svg` |
| `ordered_hashmap` | `third_party` | Ordered HashMap preserving insertion order (vendored, library-only) | 127 | 333 | 0 | 1 | 2 | 0 | leaf | `third_party/ordered_hashmap` |
| `prod-mc-cli-chat-proxy-types` | `prod` | Lightweight request/response types for cli-chat-proxy API | 3,027 | 4,294 | 0 | 11 | 5 | 0 | leaf | `prod/mc/cli-chat-proxy-types` |
| `ptyctl` | `codegen` | Headless PTY controller built on alacritty_terminal | 1,797 | 2,320 | 0 | 8 | 2 | 0 | leaf | `crates/codegen/ptyctl` |
| `ptyctl-cli` | `codegen` | CLI for ptyctl headless PTY controller | 672 | 862 | 0 | 6 | 0 | 1 | root | `crates/codegen/ptyctl-cli` |
| `xai-acp-lib` | `codegen` | 根据 crate 名称和目录推断 | 1,734 | 2,156 | 0 | 8 | 6 | 0 | leaf | `crates/codegen/xai-acp-lib` |
| `xai-agent-lifecycle` | `codegen` | Host-agnostic agent lifecycle hooks shared by multiple agent hosts (e.g. xai-grok-shell). | 623 | 794 | 0 | 15 | 1 | 0 | leaf | `crates/codegen/xai-agent-lifecycle` |
| `xai-chat-state` | `codegen` | Actor-based chat state management for xAI agents | 12,013 | 14,573 | 7,254 | 18 | 1 | 4 | internal | `crates/codegen/xai-chat-state` |
| `xai-circuit-breaker` | `common` | Shared circuit breaker. | 1,736 | 2,335 | 938 | 19 | 2 | 0 | leaf | `crates/common/xai-circuit-breaker` |
| `xai-codebase-graph` | `codegen` | High-performance code graph generation using tree-sitter queries | 6,392 | 8,823 | 142 | 27 | 2 | 1 | internal | `crates/codegen/xai-codebase-graph` |
| `xai-compaction-transcript` | `codegen` | Markdown rendering of compacted conversation segments and the on-disk segment-store naming convention | 675 | 818 | 0 | 1 | 2 | 1 | internal | `crates/codegen/xai-compaction-transcript` |
| `xai-computer-hub-core` | `common` | Transport, ToolRegistry, and resolver abstractions for the xAI Computer Hub | 3,581 | 4,492 | 2,370 | 16 | 2 | 3 | internal | `crates/common/xai-computer-hub-core` |
| `xai-computer-hub-mcp-adapter` | `common` | Bridge between MCP servers and the xAI Computer Hub, registering MCP-discovered tools as native hub tools. | 738 | 1,004 | 0 | 5 | 1 | 4 | internal | `crates/common/xai-computer-hub-mcp-adapter` |
| `xai-computer-hub-sdk` | `common` | SDK for the xAI Computer Hub: connection pool, transparent reconnect, tool harness, and tool-server runtime. | 14,765 | 18,559 | 3,168 | 23 | 6 | 5 | internal | `crates/common/xai-computer-hub-sdk` |
| `xai-crash-handler` | `codegen` | Cross-platform crash handler (Unix signals + Windows SEH) with startup crash detection | 1,495 | 2,009 | 244 | 6 | 2 | 0 | leaf | `crates/codegen/xai-crash-handler` |
| `xai-dirs` | `codegen` | Home-directory resolution generally: USERPROFILE-first home_dir, plus grok-home ($GROK_HOME or <home>/.grok) | 102 | 155 | 0 | 1 | 17 | 0 | leaf | `crates/codegen/xai-dirs` |
| `xai-fast-worktree` | `codegen` | High-performance git worktree creation using CoW cloning | 32,515 | 38,775 | 6,292 | 76 | 3 | 4 | internal | `crates/codegen/xai-fast-worktree` |
| `xai-file-utils` | `codegen` | Local data collection: upload queueing and blob storage | 11,616 | 13,777 | 4,338 | 11 | 7 | 7 | internal | `crates/codegen/xai-file-utils` |
| `xai-fsnotify` | `codegen` | Local-filesystem event source: single causal stream of semantic FsEvents | 4,503 | 5,650 | 1,504 | 19 | 2 | 0 | leaf | `crates/codegen/xai-fsnotify` |
| `xai-fuzzy-file-search` | `codegen` | Fuzzy file search over a directory tree: an ignore-aware walker feeding a nucleo matcher, plus a background daemon | 752 | 922 | 0 | 1 | 1 | 0 | leaf | `crates/codegen/xai-fuzzy-file-search` |
| `xai-gix-status` | `codegen` | Shared gix status helpers: thread budget under RLIMIT_NPROC so produce-worker spawn cannot abort under panic=abort | 475 | 578 | 0 | 1 | 2 | 0 | leaf | `crates/codegen/xai-gix-status` |
| `xai-grok-active-sessions` | `codegen` | Crash-recovery registry of open TUI sessions, stored as a lock-guarded JSON file under the grok home | 257 | 318 | 28 | 2 | 2 | 1 | internal | `crates/codegen/xai-grok-active-sessions` |
| `xai-grok-agent` | `codegen` | Agent builder, definition parsing, and system prompt assembly | 19,044 | 22,093 | 0 | 31 | 5 | 8 | internal | `crates/codegen/xai-grok-agent` |
| `xai-grok-announcements` | `codegen` | Shared announcement types, persistence, and formatting for Grok CLI apps | 331 | 431 | 0 | 1 | 3 | 1 | internal | `crates/codegen/xai-grok-announcements` |
| `xai-grok-auth` | `codegen` | Auth dependency-inversion seam: HttpAuth + AuthCredentialProvider traits | 383 | 506 | 0 | 5 | 10 | 0 | leaf | `crates/codegen/xai-grok-auth` |
| `xai-grok-bundle` | `codegen` | Checksum-tracked on-disk cache for the published subagent bundle (personas, roles, agents, skills) | 1,301 | 1,530 | 0 | 1 | 1 | 2 | internal | `crates/codegen/xai-grok-bundle` |
| `xai-grok-compaction` | `common` | Shared, transport-agnostic compaction engine for Grok chat and Grok Build. | 5,394 | 7,804 | 0 | 34 | 3 | 0 | leaf | `crates/common/xai-grok-compaction` |
| `xai-grok-config` | `codegen` | Shared config loading for Grok — grok_home, effective config (requirements > user > managed), TOML merge | 10,470 | 12,435 | 3,627 | 30 | 21 | 5 | internal | `crates/codegen/xai-grok-config` |
| `xai-grok-config-types` | `codegen` | Leaf configuration value types for the grok CLI, extracted from xai-grok-shell for dependency inversion. | 3,447 | 4,137 | 213 | 8 | 4 | 3 | internal | `crates/codegen/xai-grok-config-types` |
| `xai-grok-dashboard-store` | `codegen` | SQLite-backed persistent dashboard workspace: membership, layout ranks, grouping | 2,857 | 3,403 | 1,477 | 13 | 1 | 2 | internal | `crates/codegen/xai-grok-dashboard-store` |
| `xai-grok-diag-server` | `codegen` | In-guest diagnostics HTTP server (/ready, /statusz, /logs) for the standalone workspace-server | 845 | 1,018 | 0 | 1 | 1 | 1 | internal | `crates/codegen/xai-grok-diag-server` |
| `xai-grok-env` | `codegen` | Backend environment for the Grok CLI crate family: endpoint URL presets, shared GROK_*/XAI_* readers, the credentials-path resolver, and the first-party credential list. | 281 | 309 | 0 | 2 | 8 | 0 | leaf | `crates/codegen/xai-grok-env` |
| `xai-grok-extra-ca` | `codegen` | TLS policy for the grok CLI: rustls backend pin, process crypto provider, shared root store, and opt-in GROK_EXTRA_CA_BUNDLE roots | 723 | 845 | 397 | 9 | 14 | 0 | leaf | `crates/codegen/xai-grok-extra-ca` |
| `xai-grok-feedback` | `codegen` | Shared feedback taxonomy, durable local draft storage, and the session trace archive builder for Grok Build | 2,330 | 2,623 | 943 | 11 | 3 | 0 | leaf | `crates/codegen/xai-grok-feedback` |
| `xai-grok-foreign-sessions` | `codegen` | Bounded, metadata-only discovery of foreign coding-agent sessions | 4,771 | 5,087 | 2,092 | 15 | 2 | 2 | internal | `crates/codegen/xai-grok-foreign-sessions` |
| `xai-grok-gboom` | `codegen` | The /gboom easter-egg raycaster game for the grok CLI pager | 2,425 | 2,927 | 0 | 4 | 2 | 0 | leaf | `crates/codegen/xai-grok-gboom` |
| `xai-grok-hooks` | `codegen` | Runtime hook system for Grok — file-based discovery, command execution, and policy enforcement | 11,159 | 12,464 | 743 | 15 | 4 | 4 | internal | `crates/codegen/xai-grok-hooks` |
| `xai-grok-http` | `codegen` | Shared reqwest HTTP clients and User-Agent construction for the grok CLI. | 773 | 870 | 0 | 1 | 4 | 6 | internal | `crates/codegen/xai-grok-http` |
| `xai-grok-image` | `codegen` | Image validation and transcoding shared by Grok tools and clients | 815 | 1,037 | 539 | 2 | 2 | 0 | leaf | `crates/codegen/xai-grok-image` |
| `xai-grok-login` | `codegen` | Authentication subsystem for the grok shell crate family: login flows, token refresh, credential providers, and auth storage. | 23,221 | 26,653 | 7,788 | 45 | 4 | 13 | internal | `crates/codegen/xai-grok-login` |
| `xai-grok-markdown` | `codegen` | Streaming markdown renderer for terminal UIs | 17,636 | 21,379 | 966 | 27 | 2 | 2 | internal | `crates/codegen/xai-grok-markdown` |
| `xai-grok-markdown-core` | `codegen` | Headless markdown analysis sharing Grok Build's exact pulldown-cmark config. | 832 | 1,006 | 0 | 1 | 1 | 0 | leaf | `crates/codegen/xai-grok-markdown-core` |
| `xai-grok-mcp` | `codegen` | MCP integration crate. Quarantines rmcp + reqwest 0.13 (rmcp 3.x requires reqwest >= 0.13.2 while the rest of the workspace uses reqwest 0.12) and owns the MCP credential store and OAuth flow orchestrator. | 11,761 | 14,078 | 4,597 | 18 | 3 | 11 | internal | `crates/codegen/xai-grok-mcp` |
| `xai-grok-memory` | `codegen` | Cross-session memory for Grok. | 12,642 | 15,283 | 1,869 | 25 | 2 | 7 | internal | `crates/codegen/xai-grok-memory` |
| `xai-grok-mermaid` | `codegen` | Render Mermaid diagram source to a rasterized PNG behind a swappable engine trait | 1,445 | 1,907 | 148 | 7 | 1 | 2 | internal | `crates/codegen/xai-grok-mermaid` |
| `xai-grok-models` | `codegen` | Default model IDs for the grok CLI, loaded from the embedded default_models.json. | 43 | 68 | 0 | 1 | 2 | 0 | leaf | `crates/codegen/xai-grok-models` |
| `xai-grok-otel` | `codegen` | OpenTelemetry foundation for Grok Build: W3C trace-context propagation, the OTLP HTTP client, and the tracing->OTLP span layer/provider | 1,758 | 1,918 | 0 | 8 | 5 | 4 | internal | `crates/codegen/xai-grok-otel` |
| `xai-grok-pager` | `codegen` | xai-grok-pager | 448,370 | 520,203 | 146,901 | 604 | 2 | 36 | internal | `crates/codegen/xai-grok-pager` |
| `xai-grok-pager-bin` | `codegen` | 根据 crate 名称和目录推断 | 3,573 | 3,712 | 0 | 2 | 0 | 15 | root | `crates/codegen/xai-grok-pager-bin` |
| `xai-grok-pager-diff` | `codegen` | Diff hunk construction for the Grok Build TUI | 1,088 | 1,307 | 0 | 1 | 2 | 1 | internal | `crates/codegen/xai-grok-pager-diff` |
| `xai-grok-pager-minimal` | `codegen` | Minimal (scrollback-native) render mode: `grok --minimal`. | 5,227 | 6,279 | 954 | 12 | 1 | 6 | internal | `crates/codegen/xai-grok-pager-minimal` |
| `xai-grok-pager-pty-harness` | `codegen` | Shared PTY harness + scenario library for xai-grok-pager e2e tests and benchmarks. | 32,483 | 40,463 | 23,693 | 275 | 0 | 3 | root | `crates/codegen/xai-grok-pager-pty-harness` |
| `xai-grok-pager-render` | `codegen` | 根据 crate 名称和目录推断 | 32,565 | 40,553 | 3,490 | 79 | 1 | 12 | internal | `crates/codegen/xai-grok-pager-render` |
| `xai-grok-paths` | `codegen` | Type-safe path wrappers for absolute and relative UTF-8 paths | 439 | 549 | 0 | 1 | 5 | 0 | leaf | `crates/codegen/xai-grok-paths` |
| `xai-grok-plugin-marketplace` | `codegen` | Provides marketplace source configuration and plugin discovery, indexed with a filesystem fallback. | 5,212 | 5,872 | 0 | 11 | 2 | 5 | internal | `crates/codegen/xai-grok-plugin-marketplace` |
| `xai-grok-sampler` | `codegen` | Actor-based sampling/inference layer for xAI grok (HTTP streaming + retry, no shell coupling) | 14,750 | 17,195 | 3,712 | 40 | 4 | 4 | internal | `crates/codegen/xai-grok-sampler` |
| `xai-grok-sampling-types` | `codegen` | Pure data types for the xAI sampling / chat-completion API layer | 11,544 | 13,963 | 2,496 | 16 | 6 | 3 | internal | `crates/codegen/xai-grok-sampling-types` |
| `xai-grok-sandbox` | `codegen` | OS-level sandboxing for Grok Build using kernel primitives (Landlock/Seatbelt) via nono | 8,187 | 9,353 | 2,448 | 22 | 8 | 2 | internal | `crates/codegen/xai-grok-sandbox` |
| `xai-grok-secrets` | `codegen` | Regex sanitizer for Grok Build outbound data (Sentry / Mixpanel / product-event scrubbing) | 481 | 557 | 0 | 2 | 3 | 0 | leaf | `crates/codegen/xai-grok-secrets` |
| `xai-grok-session-events` | `codegen` | Typed per-session event log written as JSON lines | 1,025 | 1,165 | 0 | 4 | 4 | 0 | leaf | `crates/codegen/xai-grok-session-events` |
| `xai-grok-session-search` | `codegen` | SQLite FTS5 index over local grok sessions: lease-guarded bootstrap, debounced incremental upserts, and BM25 ranked query | 3,126 | 3,806 | 394 | 10 | 1 | 3 | internal | `crates/codegen/xai-grok-session-search` |
| `xai-grok-shared` | `codegen` | Shared utilities used by both `xai-grok-shell` and its downstream clients (e.g. `xai-grok-pager-render`). | 3,758 | 4,954 | 40 | 9 | 3 | 7 | internal | `crates/codegen/xai-grok-shared` |
| `xai-grok-shell` | `codegen` | Grok | 355,492 | 400,975 | 125,326 | 633 | 4 | 58 | internal | `crates/codegen/xai-grok-shell` |
| `xai-grok-shell-base` | `codegen` | Foundation modules for the grok shell crate family: environment presets, CPU profiling, and process/filesystem utilities. | 2,597 | 3,176 | 14 | 13 | 2 | 7 | internal | `crates/codegen/xai-grok-shell-base` |
| `xai-grok-shell-session-support` | `codegen` | Session-support modules for the grok shell crate family: managed MCP gateway catalog/call caching and file-access tracking. | 656 | 738 | 0 | 2 | 1 | 3 | internal | `crates/codegen/xai-grok-shell-session-support` |
| `xai-grok-shell-terminal` | `codegen` | Local, ACP, and PTY terminal runners extracted from xai-grok-shell so they compile in parallel. | 5,246 | 6,198 | 947 | 11 | 1 | 7 | internal | `crates/codegen/xai-grok-shell-terminal` |
| `xai-grok-status-line` | `codegen` | The status-line contract: the `[ui.status_line]` config a user writes and the payload the agent sends clients. | 925 | 1,107 | 423 | 6 | 3 | 0 | leaf | `crates/codegen/xai-grok-status-line` |
| `xai-grok-subagent-resolution` | `codegen` | Shared subagent definition, runtime, prompt, and resume resolution | 2,426 | 2,890 | 0 | 7 | 1 | 4 | internal | `crates/codegen/xai-grok-subagent-resolution` |
| `xai-grok-telemetry` | `codegen` | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions | 20,481 | 24,059 | 4,797 | 59 | 10 | 14 | internal | `crates/codegen/xai-grok-telemetry` |
| `xai-grok-test-support` | `codegen` | Shared test-support for grok-build crates: mock inference server, SSE generators, ACP stdio client, headless runner, env sandbox | 8,618 | 9,919 | 0 | 14 | 1 | 2 | internal | `crates/codegen/xai-grok-test-support` |
| `xai-grok-tools` | `codegen` | Grok tools library | 124,959 | 149,673 | 13,405 | 270 | 14 | 22 | internal | `crates/codegen/xai-grok-tools` |
| `xai-grok-tools-api` | `codegen` | Protobuf API definitions for Grok tools | 681 | 836 | 124 | 5 | 3 | 2 | internal | `crates/codegen/xai-grok-tools-api` |
| `xai-grok-update` | `codegen` | 根据 crate 名称和目录推断 | 8,667 | 10,929 | 5,689 | 16 | 2 | 7 | internal | `crates/codegen/xai-grok-update` |
| `xai-grok-version` | `codegen` | Lockstepped grok CLI version. | 68 | 98 | 0 | 2 | 18 | 0 | leaf | `crates/codegen/xai-grok-version` |
| `xai-grok-voice` | `codegen` | Voice dictation (streaming STT) for Grok Build CLI | 2,924 | 3,705 | 0 | 18 | 1 | 3 | internal | `crates/codegen/xai-grok-voice` |
| `xai-grok-workspace` | `codegen` | Core host-local workspace library (FS, VCS, execution, discovery) for xai-grok-shell and remote sampler | 97,976 | 111,136 | 22,374 | 113 | 6 | 34 | internal | `crates/codegen/xai-grok-workspace` |
| `xai-grok-workspace-client` | `codegen` | Lightweight typed client for hub-proxied workspace.* RPCs (shared by xai-grok-shell proxy mode and other consumers) | 825 | 856 | 0 | 1 | 1 | 4 | internal | `crates/codegen/xai-grok-workspace-client` |
| `xai-grok-workspace-daemon` | `codegen` | Process lifecycle for the workspace-server daemon: self-daemonization, single-instance pidfile locking, and preview-proxy child supervision | 2,329 | 3,006 | 0 | 3 | 1 | 2 | internal | `crates/codegen/xai-grok-workspace-daemon` |
| `xai-grok-workspace-types` | `codegen` | Wire types for the xAI workspace API (request/chunk/event enums shared by client and server) | 6,851 | 9,054 | 765 | 50 | 4 | 0 | leaf | `crates/codegen/xai-grok-workspace-types` |
| `xai-hooks-plugins-types` | `codegen` | Shared DTO types for hooks/plugins ACP extensions (wire format only) | 922 | 1,201 | 0 | 1 | 3 | 0 | leaf | `crates/codegen/xai-hooks-plugins-types` |
| `xai-hunk-tracker` | `codegen` | Track file hunks (diffs) with agent/external attribution | 8,638 | 12,027 | 4,224 | 17 | 2 | 1 | internal | `crates/codegen/xai-hunk-tracker` |
| `xai-interjection-core` | `common` | Shared mid-turn interjection buffer and formatting for the client and server agent loops | 303 | 384 | 0 | 4 | 2 | 0 | leaf | `crates/common/xai-interjection-core` |
| `xai-message-delivery-core` | `common` | Source-typed message delivery values and operation authorization. | 921 | 1,056 | 303 | 8 | 2 | 0 | leaf | `crates/common/xai-message-delivery-core` |
| `xai-mixpanel` | `codegen` | Lightweight Mixpanel HTTP tracking client (replaces mixpanel-rs to avoid pulling reqwest 0.11) | 102 | 145 | 0 | 1 | 1 | 1 | internal | `crates/codegen/xai-mixpanel` |
| `xai-prompt-queue` | `codegen` | Shared prompt-queue wire types for xai-grok-shell and xai-grok-pager | 385 | 467 | 0 | 3 | 2 | 0 | leaf | `crates/codegen/xai-prompt-queue` |
| `xai-proto-build` | `build` | Build protobuf | 517 | 672 | 0 | 3 | 1 | 0 | leaf | `crates/build/xai-proto-build` |
| `xai-ratatui-inline` | `codegen` | ratatui-inline | 2,543 | 3,375 | 614 | 10 | 3 | 0 | leaf | `crates/codegen/xai-ratatui-inline` |
| `xai-ratatui-textarea` | `codegen` | 根据 crate 名称和目录推断 | 11,674 | 14,746 | 5,807 | 14 | 3 | 0 | leaf | `crates/codegen/xai-ratatui-textarea` |
| `xai-sqlite-journal` | `codegen` | Filesystem-aware SQLite journal-mode selection: WAL on local disks, rollback journal on network mounts where WAL's mmap'd -shm is unsafe | 586 | 785 | 0 | 1 | 5 | 0 | leaf | `crates/codegen/xai-sqlite-journal` |
| `xai-system-power` | `codegen` | Cross-platform system sleep/wake (suspend) notifications — used to defer work across a suspend boundary | 517 | 808 | 0 | 4 | 1 | 0 | leaf | `crates/codegen/xai-system-power` |
| `xai-test-utils` | `common` | Shared test utilities: hermetic git, optional runfiles helpers | 269 | 427 | 0 | 6 | 0 | 0 | leaf/root | `crates/common/xai-test-utils` |
| `xai-token-estimation` | `codegen` | Pure shared token-estimation primitives. | 169 | 245 | 0 | 1 | 8 | 0 | leaf | `crates/codegen/xai-token-estimation` |
| `xai-tool-protocol` | `common` | Wire-protocol types for the xAI Computer Hub | 7,709 | 9,934 | 2,701 | 23 | 10 | 1 | internal | `crates/common/xai-tool-protocol` |
| `xai-tool-runtime` | `common` | Unified Tool trait, dispatch trait, error taxonomy, notifications, and search index for the xAI Computer Hub | 3,695 | 5,110 | 1,624 | 18 | 8 | 3 | internal | `crates/common/xai-tool-runtime` |
| `xai-tool-types` | `common` | Canonical tool-description types for the xAI platform | 3,348 | 4,368 | 0 | 7 | 12 | 0 | leaf | `crates/common/xai-tool-types` |
| `xai-tracing` | `common` | 根据 crate 名称和目录推断 | 686 | 864 | 0 | 8 | 2 | 0 | leaf | `crates/common/xai-tracing` |
| `xai-tracing-macros` | `codegen` | Tracing-based utility macros for timestamped logging and timing | 125 | 202 | 0 | 3 | 1 | 0 | leaf | `crates/codegen/xai-tracing-macros` |
| `xai-tty-utils` | `codegen` | Lightweight process-spawning utilities for TTY safety — detach from controlling terminal, suppress interactive pagers, process-group lifecycle | 3,116 | 4,195 | 702 | 12 | 19 | 0 | leaf | `crates/codegen/xai-tty-utils` |
| `xai-workflow` | `codegen` | Rhai-scripted dynamic workflow engine: scripts orchestrate agents through a host channel | 3,249 | 3,501 | 0 | 8 | 1 | 0 | leaf | `crates/codegen/xai-workflow` |

## WhyBuddy 对照时最有价值的模块

| grok-build 模块 | 价值 | WhyBuddy 当前对应方向 |
|---|---|---|
| `xai-grok-shell` | 完整会话宿主、命令循环、生命周期；是最大的产品编排层 | WhyBuddy control plane / session / SSE |
| `xai-grok-tools` | 工具协议和实现的集中入口，决定模型能做什么 | WhyBuddy capability/tool executor |
| `xai-grok-workspace` | 文件、VCS、执行、发现和 preview 的宿主能力 | WhyBuddy workspace + generated app runtime |
| `xai-grok-pager` | 终端 UI 组合模块，包含大量面板和交互状态（出度非零） | WhyBuddy 五十多个面板的拆分参考 |
| `xai-grok-agent` | Agent 定义、提示词和工具装配 | WhyBuddy agent loop / planning |
| `xai-computer-hub-sdk` | 浏览器/电脑控制的 SDK 与连接池 | WhyBuddy sandbox + browser runtime 缺口 |
| `xai-grok-memory` | 会话记忆和持久化相关能力 | WhyBuddy memory / charter |
| `xai-codebase-graph` | 用 tree-sitter 生成代码图 | WhyBuddy architecture graph 生成器 |

## 数据来源与限制

- 依赖边来自各 crate 的 `Cargo.toml`，只保留 workspace 内部运行时依赖，忽略 `dev-dependencies`。
- 用途优先取 `Cargo.toml` 的 `description`，没有时取 crate README 或顶层模块注释；仍没有时会标记为“根据 crate 名称和目录推断”。
- 这份清单描述的是静态 crate 结构。它不能单独证明某个模块在生产启动链路上一定会被调用；运行链路仍要结合入口、feature 和真实 smoke。
