# WhyBuddy 最近改动的全链路审查（对照 grok-build）

审查时间：2026-09-11。代码基线：`cb4e57c1` 及其工作区改动。对照物：`C:\Users\wangchunji\Documents\grok-build`，重点参考 `ask_user_question`、`exit_plan_mode`、hook dispatch、actor finally 和架构生成器。架构图是依赖关系的静态投影，能通过渲染不代表业务行为已经正确；下面每一项都追到了实际调用链和回归测试。

## 审查清单

| # | WhyBuddy 实际链路 | grok-build 对照 | 结论 |
|---|---|---|---|
| 1 | `routes/sliderule_full.py` 接收控制回合，`services/rehearsal_control.py` 负责模型、工具和工厂交接 | actor 主循环把工具结果送回 sampler | 已对齐。控制面是唯一入口，工具仍保留产品权限语义 |
| 2 | 问卷工具 → 持久化 session → SSE 回执 → 刷新后继续提交 | `ask_user_question` 的多题、推荐项、Other 和四类结果文案 | 已修复并通过。取消是正常分支，不伪装成错误 |
| 3 | 计划写入后进入 `control_plan_approval`，批准/修改/退出都要求匹配 revision 和 reqId | `exit_plan_mode` 的持久计划审批 | 已对齐。审批不能被普通问卷绕过 |
| 4 | `manual_pause` 先发 `run_pause_started`，再等待 gate，finally 发送结束事件 | actor 的等待状态与取消清理 | 已对齐。暂停、取消、无人值守分别处理 |
| 5 | worker 事件泵、业务事件和 `last_yield_at` 心跳分开，运行快照记录 held/hold | grok 将 heartbeat 与 stage 内容分开 | 已对齐；无 LLM 时仍只能验证模板链路 |
| 6 | `StagePairTracker` 以 pageId/device 配对，结束时补齐异常和取消 | 阶段开始/完成成对记录 | 已修复。并行页面不会串台 |
| 7 | 页面事件由 sink、session buffer 和 fallback 重放；绑定状态来自 `pageBindStatus` | 产出与通知数量分开记账 | 已修复。绑定失败/跳过/缺失不会再冒充 bound=true |
| 8 | capability ledger 写入 status、duration、provenance，顶层耗时与 timing 统一 | `ToolCallOutcome` 必填字段和旧数据兼容 | 已修复。旧记录仍按 Unknown 读取 |
| 9 | spec-first 生成需求、页面、控件，再经过 bind、repair、交付闭环 | grok 的分层交付和覆盖判据 | 已对齐。静态 deliverable parser 只做语义筛选，不宣称等价浏览器 DOM |
| 10 | Python 生成显式 `data-*` 协议，TS `html-binding-runtime.ts` 消毒、渲染和动作绑定 | grok 不从中文展示文案猜业务字段 | 已修复。购物车数量使用 `data-cart-qty`，不会猜测 qty 字段或改无关徽标；多搜索框独立工作 |
| 11 | 路由 owner/session 校验、原子认领、晚到保存和工厂调用 | grok 本机诊断口较宽松，Web 产品不能照抄 | 已对齐。跨用户访问继续 fail-closed |
| 12 | `hook_events.dispatch` → `_dispatch_tool`；model memory 与 product charter 分表持久化；doom signal 仅解析记录 | grok 的顺序 updatedInput、hook verdict、memory 工具和 doom collector | 已修复/边界明确：ASK 现在阻止工具和 handoff；后续 hook 能看到前一 hook 改写；memory/charter 改为原子 upsert；doom 暂不自动重采样 |
| 13 | `package.json` → `arch-graph-all.mjs` → Python/TS 扫描器、声明清单、生成 Markdown | grok 的 Cargo 边界强制依赖 | 已对齐能力边界。WhyBuddy 用静态扫描和反向 ratchet，不能声称拥有 Cargo 编译期约束 |
| 14 | Python/TS 单测、脚本门禁、构建、Mermaid 渲染和受控浏览器检查 | grok 的契约测试与真实运行链 | 已通过受控验收；没有调用真实付费 LLM |

## 本轮实际修复

- 控制 SSE 在发送响应头之前预留 session；重复回合得到真实 HTTP 409。所有嵌套 async generator 使用 `aclosing()`，断连时会在同一任务中释放 producer、工具 scope、ContextVar 和 reservation。
- PRE_TOOL_USE 的 `HookDecision.ASK` 现在返回 `hook_approval_required` 和上下文并结束当前回合，绝不继续写入或 handoff；顺序 hook 的 `updated_input` 会折叠传给后续 handler。
- fallback 与 live page reemit 使用每页绑定状态，不再把“页面生成成功”误报成“页面已绑定”。
- 购物车新增明确的 `data-cart-qty` 显示孔，Python 校验器与 TS allowlist 成对维护；数量更新不会覆盖普通 badge。
- `sliderule_model_memory` 和 `sliderule_product_charter` 从 DELETE+INSERT 改成单条 `ON CONFLICT ... DO UPDATE`，避免第二条 SQL 失败时丢失旧值。
- 更新主题 token 的结构判据，使其接受带有 per-page binding status 的新调用形状。
- 追修截图中的首轮问卷：用户刚提交产品目标时 `goal` 还未 stamp，旧逻辑误把模型选项清空；现在只对纯问候收窄为空，首轮产品话题保留桌面端/移动端等真实选项。

## 验证结果

- Python 全量：`6736 passed, 18 skipped, 5 xfailed`（最终日志 `%TEMP%\\whybuddy-review-full-final.log`）。
- Python 原子存储、控制生命周期、Hook 回归：10 passed；主题 token：32 passed。
- 前端绑定审查与运行时：98 passed。
- `pnpm run test:scripts`：52 passed。
- `pnpm run arch:check`：通过；`pnpm run build`：通过。构建保留既有 Rollup 跨 chunk cycle 和大 chunk warning。
- Mermaid 实际渲染：全仓图 20 节点/33 边，TS 图 26/121，Python 图 4 块，grok 对照图 5 块，全部通过 Chrome 解析。
- 受控浏览器检查已覆盖 1280px 与 390px 的 HTML binding、多搜索框、汇总和溢出；本轮数量协议的单元回归已覆盖，真实付费模型链路未验证。
- 问卷首轮产品话题回归：`test_control_ask_user_parks.py` 12 passed；前端问卷卡 12 passed。

## 尚存边界

Hook 注册目前是进程内机制，ASK 需要下一回合重新提交批准；没有公共 JSON/命令 hook 管理面。doom-loop 只解析和记录信号，不会自行向 provider 追加采样。静态 HTML parser 不能替代真实浏览器的完整 WHATWG 树构造。控制回合 reservation 是单进程集合，部署多个 uvicorn worker 时需要外部锁才能提供跨进程互斥。
