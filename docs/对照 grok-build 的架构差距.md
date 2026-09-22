*全部数字来自四份 --emit · 无手填 · 2026-09-03*

# 对照 grok-build 的架构差距

两边的图都是现算的：grok-build 由 `scripts/arch-graph-grok.py` 读 97 个 `Cargo.toml` 生成，WhyBuddy 由 Python / TS 两个编译器扫 2205 个模块生成。 下面先列这一轮审查要修的七条，再把两边并排放。

- **grok-build** rev a549186d9d39 · 97 crate · 2961 rs

- **WhyBuddy** 286 py + 1919 ts 模块

- **待修** 7 条（1 条严重）

## 要修的清单

来自 `1715e82..86363c5` 的审查。标「已跑」的是我在 venv 里实际执行验证过的， 标「读码」的只核对了代码路径、没构造用例。

### A-1 `forcedTool` 被文本劫持：开始推演可能点了没反应
`已跑验证` `成对物`

**实测**

```
resolve_forced_tool({'forcedTool':'rehearse'}, '做一个门店客户数据结构管理台')
  → 'structure'   期望 rehearse
resolve_forced_tool({'forcedTool':'refine'},   '把权限绑定那一栏改成扫码')
  → 'bind'        期望 refine
resolve_forced_tool({'forcedTool':'rehearse'}, '做一个社区健身房预约系统')
  → 'rehearse'   ✓  （话题里没有 hop 关键词才对）
```

**机制** — `factory_hop_from_text(text)` 被移到函数最前，排在 `payload.forcedTool` 之前。 新会话 + 话题含「结构」→ 点开始推演变成 `structure` 跳 → 撞 `_factory_hop_blocker` 的「还没有页面」。**数据依赖的静默劫持**： 话题里带 hop 关键词才触发，所以不是每次都能复现。

**评价** — 改动动机是对的（注释里那条真机：确认继续把 pending 钉成 pages，随后点 Structure 仍 POST pages）， 但**修过头了**：该压过的只是「上一跳残留的 factory hop」，不是所有显式意图。

**改法** — 仅当 `payload.forcedTool` 本身落在 `FACTORY_HOPS` 里（= 残留值）时，才让文本优先； `rehearse` / `refine` / `repair` / `restore_version` 这类显式意图不许被盖。

> **判据（正 + 反）** 正：残留 `forcedTool=pages` + 文本「进入数据模型反推」→ `structure`。 反：**forcedTool=rehearse + 任意含 hop 关键词的话题 → 仍是 rehearse**。 变异：把顺序调回去，反向那条必须红。

- slide-rule-python/services/rehearsal_control.py:1067 · resolve_forced_tool

- client/src/pages/sliderule/useSlideRuleSession.ts:129 · inferForcedTool（同样的倒置）

### A-2 叙述由用户原文决定「完成」，不由真实产出决定
`读码确认` `成对物`

**现状** — hop 名分支排在 `painted` 之前：**只要用户原文提到 hop 名，就叙述成 「本轮已完成数据模型反推。」**——不管有没有真做。后端那条 `painted` 对任何非 pages hop 都不可达；前端把一条正确的「没有画出新的页面」直接改写成完成语。

**关联** — 这跟 `1715e82` 刚修的是**同一类病、换了一层**：那条修的是 「回执报 ok 但什么都没做」，这条是「叙述报完成但什么都没做」。 我加的 `factory_deliverable_fingerprint` 正好能给这里用—— 叙述该由「本轮真的产出了什么」决定。

> **判据** 反向为主：**零产出的一跳，原文提到 hop 名也不许叙述成已完成**。两侧各一条（§4）。

- slide-rule-python/services/turn_narration.py:373

- client/src/pages/sliderule/assistant-text-for-turn.ts:39

### A-3 假设卡的两个开关互相打架，卡片再也不弹
`读码确认`

**一半** — `assumptionsWereConfirmed` 扫**整个** `controlTranscript` 找「假设已确认」， 没有按轮次限定 —— 会话级闩锁，确认过一次就终身为真， 同一个 diff 里新加的 `resetSpecAssumptions` 因此成了死代码。

**另一半** — 后端 `assumptionsConfirmed` **只在 forced == "spec" 时重置**， 而这次新的首轮链走的是 `forced == "rehearse"` —— 陈旧的 `True` 压住新一轮的假设卡。**跟本次头条改动直接互撞。**

> **判据** 正：确认过之后刷新不复弹。反：**SPEC 重起草后，同一张卡必须重新出现**。

- client/src/lib/spec-assumptions.ts:120

- slide-rule-python/services/rehearsal_control.py:2983

### A-4 助手自己的复述被喂回设备推断，手机覆盖第二次 park 时回退
`读码确认`

**现状** — `_scope_texts` 把助手的范围卡复述也加进推断输入。两句冲突时 `infer_device_from_text` 返回 None → 回落 `payload_device`， 正好是这次要修的那个改设备流程。

- slide-rule-python/services/rehearsal_control.py:912

### A-5 跑批中点提问 chip 没反馈、删不掉、下次冒出来
`读码确认`

**现状** — 静默中途排队跳过 `setQueuedTurns`、也不清 `pendingAsk`： 用户点了没有任何反馈，条目删不掉，下次 `pushQueuedTurn` 时才蹦进可见队列。

- client/src/pages/sliderule/useSlideRuleSession.ts:2659

### A-6 架构闸红着：函数体 import 491 vs 基线 485
`已跑验证`

**现状**

CLAUDE.md 写着基线「只许变短」。这 6 条来自更早那批提交，我的增量是 0。 逐条做过环分析，**都没有反向顶层依赖，理论上全可提到顶层**：
```
rehearsal_control:2362  _after_write_hint()   ← capability_plan
spec_first_pipeline:128 page_sink_scope()     ← sliderule_llm.scoped
spec_first_pipeline:224 _emit_assumptions()   ← run_pause
spec_first_pipeline:1358 run_spec_first()     ← capability_plan
spec_first_pipeline:1360 run_spec_first()     ← spec_page_html
v5_full_driver:1903     drive_full_...stream() ← spec_first_pipeline
workflow_validate:529   dry_run_...()          ← sys
```
连带 `test_命令行闸与判据同源` 也红（CLI 退出 1、pytest 判据干净）。

**提醒** — 提上去之后**必须重跑闸**——闸本身会告诉我们有没有隐藏的传递环， 我那次浅层分析只看了直接反向依赖。

### A-7 欠一次真机复验：`1715e82` 改完还没跑过真实精修
`未验`

**要验什么** — 正：精修真的改了页面 → `ok=true`、页面哈希变。 反：**没改 → ok=false，且控制面不许再编「已更新」那句话**。 这条是上一轮那个事故的收口。

## 两边的形状

grok 的目标形状是**两个巨石 + 一大批叶子**：巨石内部缠没关系， 叶子被 cargo 焊死、不可能反过来依赖巨石。WhyBuddy 抄的就是这个。

### grok-build

97 crate · 2961 rs · rev a549186d

- codegen 79（产品）

- common 12（跨产品叶子）

- build/prod/third_party 6

两个巨石：`xai-grok-pager` 780 rs、`xai-grok-shell` 633 rs。 **40 个叶子**（出度 0），4 个组合根。 `xai-workflow` 出度 0 —— 脚本引擎不依赖任何具体 Agent。

### WhyBuddy · services 三层

286 py 模块（services 214）+ 1919 ts 模块

- util 125（叶子）

- core 59

- flow 30（编排）

层间边：`core→util 142`、`flow→core 103`、`flow→util 107`。 叶子占比 **58%**，比 grok 的 41% 还高 —— 这一项抄到位了， 甚至比对照物更彻底。

## 并排对照

只放两边都能算出来的口径。⚠ 「模块」和「crate」不是同一粒度： grok 的 97 个 crate 装着 2961 个 rs 文件，跟 WhyBuddy 2205 个模块比才是同量级。

| 轴 | grok-build | WhyBuddy | 判断 |
|---|---|---|---|
| 强制者 | cargo（编译器） | 两个自写闸 arch_graph.py / arch-graph-ts.mjs | 形态不同 |
| 规模 | 97 crate / 2961 rs | 2205 模块 （286 py + 1919 ts） | 同量级 |
| 依赖边 | 348（声明在 crate 上） | 871 py + 5943 ts | 粒度差异 |
| 循环依赖 | 0（编不过） | py 0 ts 组间 28 / 模块 94 | TS 侧欠账 |
| 叶子占比 | 40 / 97 = 41% | util 125 / 214 = 58% | 已达成 |
| 编排引擎 | xai-workflow 出度 0 | workflow_registry 出度 0 | 已达成 |
| 工具词表 | xai-tool-types 入 11 / 出 0 | closed_tools（util 叶子） | 已达成 |
| 会话事件 | xai-grok-session-events 叶子 | session_events（util 叶子） 前端翻译表已删 | 已达成 |
| 隐藏边 | 无此概念 （Rust 依赖只能声明在 Cargo.toml） | **491 / 871 = 56%** 写在函数体里 | 最大差距 |
| 跨语言边 | 无（单 workspace） | 4 条 （拼字符串 `__import__`） | 已显式声明 |
| 巨石 | pager 780 / shell 633 rs | client 1033 / server 579 模块 | 形状相似 |

## 差距在哪，以及哪些不必追

### 差距 1 56% 的依赖藏在函数体里 —— grok 结构上不可能有这个病

**数字** — WhyBuddy Python 871 条内部边，**491 条写在函数体里**。 Rust 的依赖只能声明在 `Cargo.toml`，没有「把 import 挪进函数」这条逃生口。

**为什么要紧** — 不是洁癖：函数体 import 是**一句话绕过架构闸的办法**。 56% 意味着超过一半的依赖关系，闸只能靠 `arch_graph.py` 专门去挖才看得见 —— 少挖一层就等于默认放行。CLAUDE.md 已经把它写成硬闸（只许变少）， 但棘轮本身不会让存量变短。

**建议** — 当下先还 A-6 那 6 条新增（回到基线 485）。存量 485 条是长期账， 按「新模块顶层 import、老模块碰到就顺手提」慢慢磨，不值得专门开一轮。

### 差距 2 TS 侧 28 组间环 / 94 模块环 —— Python 侧是 0

**数字** — grok 0（编不过）；WhyBuddy Python 0；**TS 组间 28、模块级 94**，都冻在基线里。

**解读** — TS 侧 1919 个模块占全仓 87%，环全在这一侧。好消息是**包级零环**—— client / server / shared 的方向今天是干净的，成环才是打包器层面的病。 组间环属于欠账，不是急症。

**建议** — 照改造清单第 12 条的顺序：先还产品主路径（`client-lib ⇄ client-pages-sliderule`、 `server-core ⇄ server-routes`），Autopilot 那串留到最后。

### 不必追 已经达成的四条，和明确不抄的五支

**已达成** — 叶子编排引擎（`workflow_registry` 出度 0）、叶子工具词表（`closed_tools`）、 自描述会话事件（`session_events`，前端翻译表已删）、叶子占比 58% > grok 的 41%。 **这四条不用再花力气。**

**不抄** — 照你自己在改造清单里划的线：Bash 工具 / `xai-grok-sandbox`、 `xai-grok-mcp`、`xai-grok-subagent-resolution`（子代理改五系统 = 第二生成器）、 `xai-grok-agent` 的提示词装配、pager TUI 那一整支。

**口径提醒** — ⚠ 别拿「97 crate vs 2205 模块」直接比 —— 那不是同一粒度。 grok 一个 crate 平均 30 个 rs 文件，`xai-grok-pager` 一个就 780 个。 可比的是**形状**（巨石 + 叶子的比例）和**纪律**（环、隐藏边），不是计数。

- docs/grok-build 架构图（自动生成）.md ← scripts/arch-graph-grok.py --emit

- docs/SlideRule V6.2 架构图（自动生成）.md ← slide-rule-python/arch_graph.py --emit

- docs/WhyBuddy 全仓架构图（自动生成）.md ← 同上

- docs/WhyBuddy TS 架构图（自动生成）.md ← node scripts/arch-graph-ts.mjs --emit

四份图这一轮全部重新生成过，本页每个数字都能在其中一份里找到出处。 ⚠ 图是**生成的，别手改**——改了 `test_architecture.py::Test图与代码同步` 会红。 新事实只进 `--emit`。
