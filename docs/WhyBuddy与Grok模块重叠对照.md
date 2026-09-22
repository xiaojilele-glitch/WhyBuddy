# WhyBuddy × Grok-build：模块重叠对照

> 性质：crate → 本仓模块的三栏对照（对齐 / 只抄了一半 / 不该抄）。
> 不是把 WhyBuddy 收成 grok-shell。测量数字见 PR #7 的架构对照；本页只谈**逻辑该不该搬**。
> grok-build 对照物：`https://github.com/xai-org/grok-build` @ `bc7f02e`（测量用，不进本仓）。
> 日期：2026-08-30。

WhyBuddy 是产品推演编译器（封闭词表 → 过闸的五系统应用）。Grok-build 是 TUI 编码代理（开放词表工具 + git 工作区）。重叠的是**工程纪律**，不是产品形状。

---

## 一、先说结论

最近那批 group 提交已经把 grok 最值钱的几刀搬过来了：叶子层、闭集工具表、`should_list` / ToolScope、`StopCancelledReason`、组合根、澄清答案 persist-as-authority。再往下抄 Bash / Edit / MCP / 子代理 / 提示词装配，会把本仓收成另一台编码代理，北极星就断了。

真正还悬着、而且真机已经咬过的，是 **PermissionState 那一刀抄了一半**：原型写进了 goal，设备只活在线程覆盖里。本 PR 补完这一半——不是新装一道架构闸。

---

## 二、crate → 本仓模块

| Grok crate / 逻辑 | WhyBuddy 对应 | 状态 | 该怎么做 |
|---|---|---|---|
| `xai-grok-workspace` `PermissionState`（grant 落盘，内存覆盖不是权威；`persist_state` / `load_state_from_disk`） | 本 PR 的 `services.scope_authority` + 已有 `device_policy` override | **只抄了一半 → 本 PR 补完** | 范围卡的设备 / 原型跟澄清答案同一口径：写进 goal，工厂从会话读。不抄 bash/MCP grant 表。 |
| workspace session / checkpoint | `slide_rule_session.load_session`（工厂 persist-as-authority） | **对齐** | 继续。别再让 HTTP body 当第二权威。 |
| `clarifications_from_state` 同款（从持久化取，不从 POST 再传） | `v5_llm_generate.clarifications_from_state` | **对齐** | 设备现在跟它同一形状。 |
| `xai-tool-types` / 闭集工具 + `should_list` | `CLOSED_TOOLS` + `TOOL_LIST_WHEN` | **对齐** | 新工具先入闭集。不许模型发明工具。 |
| `ToolDef.requires_permission` + `ToolScope` | `TOOL_PERMISSION` + `tool_scope_scope` | **对齐** | 写权限缺省 READ。贵动词批准闸只留一处。 |
| `xai-grok-hooks` `StopCancelledReason` | `ControlStopReason` | **对齐** | 墙钟 / 额度 / 轮次分三条，别塌成一句话。 |
| 叶子 crate（一件事一个 crate，谁都能依赖，它谁都不依赖） | `services_layer.util` + `component.platform` | **对齐** | 新叶子先问「它依赖 services 里谁」。依赖账本就升 core，别硬塞 util。 |
| `xai-grok-pager-bin`（组合根，被依赖数 = 0） | `app.py` + `composition_root_state` | **对齐** | 业务层不许 `import app`。 |
| `xai-chat-state` | `models.v5_state` / `controlTranscript` | **对齐（形状不同）** | 本仓权威是五系统会话，不是 git 工作区聊天记录。 |
| `xai-grok-agent` 提示词装配 | `rehearsal_control` 系统提示 + spec-first 契约 | **不该抄** | 他们装配的是编码代理；我们装配的是推演母语。别把 grok system prompt 搬过来。 |
| `xai-grok-tools` Bash / Edit / MCP | 无对应，也不该有 | **不该抄** | 2026-08 对照清单写过：偷「先谈再烧」，不偷开放词表改仓库。 |
| `xai-grok-subagent-resolution` | 无 | **不该抄** | 子代理改五系统模型 = 第二生成器。 |
| `xai-grok-compaction` | 无 | **不该抄产品** | 我们用短清单 / bound_tool_result，不是对话压缩。 |
| `xai-grok-shell` / pager TUI | `ComposerDock` + 范围卡 | **不该抄** | 本仓前端是推演工作台，不是终端复刻。 |
| clippy `disallowed-methods` / banned-API lint | 两侧 `arch_graph` | **不是这步的优先级** | 闸已经对齐 grok 的「未声明的边红」。先把活路径上抄了一半的逻辑补完。 |

---

## 三、抄了一半的现场（本 PR 补的那条）

Grok 的授予模型：

```
NeedPermission{req_id}     →  出卡 / 提问
Permission{req_id, decision} →  写入 PermissionState（落盘）
下一轮                            只认落盘，不认「这次请求随手带的默认值」
```

本仓 2026-08-30 真机（巡店点单平板，点了「平板」再开始推演）：

| 写入点 | 当时实际 |
|---|---|
| park `scope_card.device` | 作曲家 POST 默认 `desktop`（句子里的「平板」被盖掉） |
| `_stamp_scope_choice_onto_goal` | 只写 `goal.productArchetype` |
| `scope_confirmed` | 只有 text |
| `set_preferred_device_override` | 本轮有效，工厂 `finally` 清空 |
| 刷新后 hydrate | `loadPreferredDevice()`（localStorage），不是上一张卡 |

澄清答案已经按 grok 抄完了（`clarifications_from_state`）。设备是同一类 grant，漏了。

补完之后的权威：

```
park    句子唯一设备词 > 已持久化授予 > HTTP 载荷 > unspecified
confirm 卡上点的接通档 > 上一张卡 > goal > 句子 > 账本兜底
本轮生成 句子唯一设备词 > goal.preferredDevice > HTTP 载荷 > 账本兜底
hydrate 上一张 scope_card > goal > localStorage（最后兜底）
```

未接通的 `casual_game` / `watch` 仍 fail-closed，不得点火。

---

## 四、不要做的「大重构」

把 `services/` 收成 90 个 crate、重写 `v5_full_driver`、把控制面收成 grok-agent、上 MCP 应用商店——那些是 grok 那个产品的骨架，不是本仓缺的那一层。本仓缺的是：**同一类授权只留一个权威来源，而且那个来源必须被 persist 咬住。**

下一步若还要对齐 grok，优先找「抄了一半」的成对物（同步/流式、Python/TS、生成/消费），不要找新 crate 清单往上堆。
