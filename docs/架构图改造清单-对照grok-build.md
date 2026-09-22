# 架构图改造清单（对照 grok-build）

> 数字全部来自刚才 `--emit` 的三张图，不是手填。
> WhyBuddy Python：`docs/SlideRule V6.2 架构图（自动生成）.md`
> WhyBuddy TS：`docs/WhyBuddy TS 架构图（自动生成）.md`
> grok-build：`docs/grok-build 架构图（自动生成）.md`（`SOURCE_REV` `28439e8a8712`）
>
> 这是**图和闸**的改造单，不是把 WhyBuddy 收成 grok-shell。
> 不抄：Bash / MCP / 子代理 / grok-agent 提示词 / pager TUI。

## 此刻两张图并排放

| | WhyBuddy Python | WhyBuddy TS | grok-build |
|---|---|---|---|
| 强制者 | `arch_graph.py` + `architecture.toml` | `arch-graph-ts.mjs` + `architecture.ts.json` | cargo（各 crate 的 `Cargo.toml`） |
| 单位 | 11 个包 / 280 模块 | 5 个包 / 25 个 component / 1912 模块 | **94** 个 crate |
| 内部边 | 838（**57%** 藏在函数体里） | 5925（动态 307、类型 2219） | **325**（声明在 crate 上） |
| 环 | 模块 0、组间 0 | 包级 0；**组间 35、模块 94**（棘轮冻着） | **0**（编不过） |
| 叶子 | `util` 121 个模块（表有、第一张 mermaid 没有） | `shared` 是叶子包 | **38** 个出度 0 的 crate |
| 组合根 | `app` 方向对 | `server-entry` 跟 routes/core **成环** | `xai-grok-pager-bin` 入度 0 |
| 编排引擎 | `workflow_registry` 埋在 `services` 盒子里 | 图上看不见 | `xai-workflow` **出度 0**（叶子） |
| 工具词表 | `CLOSED_TOOLS` 跟控制面同一模块 | 图上看不见 | `xai-tool-types` 入度 11、出度 0 |
| 会话事件 | 前端 `RECIPE_CORE` / 推演钟查表 | 图上看不见 | `xai-grok-session-events` 是叶子 crate |
| 跨语言边 | 4 个 adapter 算孤儿 | `server/index.ts` 拼字符串 `__import__` | 无此病（一个 workspace） |

grok 自己也不是圣图：`common → codegen` 有 1 条
（`xai-tool-runtime` → `xai-grok-tools-api`）。抄纪律，别神化。

---

## P0 图的生产纪律（改生成器，不改产品）

2026-09-01 已落地：手画盖了非权威头注；Python mermaid 有 util/core/flow；
编排环从 `_handoff_factory` 活路径生成；全仓图画出四条跨语言边；
TS 红虚线改成欠账看板。权威图四份（Python / TS / 全仓 / grok-build）。

这些做完，图才配继续当权威。

1. **权威只留自动生成的三份。**
   `docs/SlideRule V5.2`～`V6.0 架构图.md`、一堆 `docs/*.svg`、`docs/系统 Mermaid 架构图.md` 全部加头注「非权威 / 历史实验室笔记」。升版不许再往 V6.0 打 ⚑。新事实只进 `--emit`。

2. **生成器不许再手写 grok 的 crate 数。**
   旧文案写 91 crate / 347 边、92 / 364，对照物此刻是 94 / 325。已改成指向 `docs/grok-build 架构图（自动生成）.md`。以后只认那份。

3. **Python 第一张 mermaid 把 `services` 208 个模块画成一个盒子。**
   分层表里已经有 `util` 121 / `core` 58 / `flow` 29，**没进图**。改造：`emit_mermaid` 在包图之外再画一张 services 三层图。不画这张，抄 grok 叶子 crate 就是一句空话。

4. **补一张 WhyBuddy「编排环」图，对照 grok 那张 spine。**
   grok 画的是 `shell → agent → tools → tool-types`，`workflow` 是叶子。
   我们活路径是 `control-turn-stream → rehearsal_control → CLOSED_TOOLS → _handoff_factory → run_spec_first`。
   现在 component 图里有 `run_control` / `drive` / `spec_first`，但看不出「控制面在选工具、工厂把意识吞掉」。改造：从真代码的调用边生成 spine，不要手画。

5. **全仓一张图，边要含跨语言。**
   今天两套闸拼起来仍看不见：`server/index.ts` 按字符串
   `__import__("services.web_aigc_" + adapter + "_adapter")` 加载四个 adapter
   （`architecture.toml` 里标了 `cross_language_entry`，图上是孤儿）。
   改造：生成 WhyBuddy 全仓包图（Python 包 + TS 包 + 那 4 条跨语言边）。
   静态分析看不见的边，必须显式声明进图，否则「零入度 ≠ 没人用」会再删一次产线。

6. **TS 红虚线当成欠账看板，不当装饰。**
   组间环 35、模块环 94。每还一笔，从 `architecture.ts.json` 的 baseline 删掉，图上红线变短。基线只许变短。

---

## P1 图上看不见、活路径却在跑的（改完图才不会再装错插座）

2026-09-01 已落地：control 与 drive 拆成两个 crate，边上标 handoff；
`workflow_registry` / `closed_tools` / `session_events` 都是 util 叶子；
前端删了 RECIPE_CORE 与 MODULE_TO_STEP；TS `server-entry` 只剩 `server/index`，入度 0，组间环基线 35→32。

CLAUDE.md 第一条：动手前确认哪条链真的在跑。图要先把这条链画出来。

7. **控制面半魂 vs 工厂吞掉，必须是两个节点。**
   现在 Python 包图里两者都叫 `services`。component 图里 `run_control` 和 `drive` / `spec_first` 有边，但没有「点火后控制面退出」。
   改造：spine 图上 `run_control` 到 `spec_first` 标成 handoff，不是普通调用。

8. **`workflow_registry` 在图上要单独出现，而且应当是叶子。**
   grok 的 `xai-workflow` 出度 0：脚本引擎不依赖某个具体 Agent。
   我们的 `select_workflow` 永远返回 `product-rehearsal`，模块住在 flow 层。
   改造：图上先把它从 `spec_first` 37 个模块里拆出来；方向是 control → workflow 叶子，不许 workflow → driver。

9. **闭集工具词表做成叶子节点。**
   grok `xai-tool-types` 入度 11、出度 0。
   我们 `CLOSED_TOOLS` 写在 `rehearsal_control.py` 里，跟回合循环、handoff 混居。
   改造：词表下沉到 `util` / 独立 component，图上入度应升高、出度保持 0。

10. **会话事件做成叶子，删前端翻译表。**
    grok `xai-grok-session-events` 是叶子。
    我们前端 `derive-status-bar.ts` 的六步钟、`activity-rows.ts` 的 `RECIPE_CORE` 是查表翻译。
    `stage_legal.py` 自己写着：正确抄法是**删表不是改表**。
    改造：图上出现 `session_events` → client 只渲染；`RECIPE_CORE` 从架构图（和活路径）消失。

11. **组合根入度保持 0。**
    grok：`xai-grok-pager-bin` 入度 0。Python：`app` 方向已对。
    TS：`server-entry` 与 `server-core` / `server-routes` / `server-audit` 红虚线互指。
    改造：还 `server-entry` 那组环，让它真正成为组合根。

---

## P2 棘轮还债（改代码，图跟着变短）

2026-09-01 已落地：`sliderule-marathon-driver` 不再倒着 import 页面目录
（installed-skills / product-archetypes / spec-assumptions / turn-capabilities
下沉到 `client/src/lib`）。`client-lib ⇄ pages-sliderule` 的 2 环清掉。
组间环基线 32→28。`baseline.deferred = 486`，新边不许再藏进函数体。

12. **TS 先还产品主路径上的环，不要先还 Autopilot。**
    红线上最先动手的：
    - `client-lib ⇄ client-pages-sliderule`（推演工作台）
    - `client-components ⇄ client-lib`
    - `server-core ⇄ server-routes` / `server-entry`
    Autopilot 右栏那串环（`client-pages-autopilot`）是收敛对象，别当第一刀。

13. **新边不许再藏进函数体。**
    Python 838 条边里 486 条 deferred。grok 没有这个病。
    改造：闸加一条「新增 deferred 只许变少」；存量棘轮，新模块顶层 import。

14. **54 个 Python 孤儿、211 个 TS 孤儿继续归类，不许当待删清单。**
    动之前先看 `[orphan_reasons]`。`cross_language_entry` 那四个由
    `tests/test_cross_language_entrypoints.py` 两头护着。

---

## P3 形状对齐 grok、但不抄它的巨石

2026-09-01 已落地：产品图写明「两个大块 + 一批叶子」且 util 必须明显多于 flow；
mermaid 里不许出现 pager / MCP / 子代理 / sandbox / grok-agent 节点。

15. **目标形状：几个大块 + 一大批叶子，不是 90 个平均 crate。**
    grok 体积：`xai-grok-pager` 791 rs、`xai-grok-shell` 603 rs，然后中位数很小。
    我们 `services/` 208 个模块平铺一个命名空间——这才是病。
    改造：继续把叶子留在 `util`；不要把 `v5_full_driver` 切成 20 个文件假装 crate。

16. **不要画进 WhyBuddy 产品图的 grok 节点（明确不搬）：**
    - `xai-grok-pager*`（TUI）
    - `xai-grok-mcp` / `xai-computer-hub-mcp-adapter`
    - `xai-grok-subagent-resolution`（子代理改五系统 = 第二生成器）
    - `xai-grok-sandbox` / Bash 工具
    - `xai-grok-agent` 的提示词装配（编码代理母语，不是推演母语）

17. **要画进产品图、且应对齐的 grok 节点：**
    - 叶子词表（`xai-tool-types`）→ 我们的闭集工具表
    - 叶子编排引擎（`xai-workflow`）→ `workflow_registry`，先保持单 preset
    - 叶子会话事件（`xai-grok-session-events`）→ 自描述 SSE
    - 组合根入度 0（`xai-grok-pager-bin`）→ `app` / `server-entry`
    - 授权落盘（`xai-grok-workspace` 的 PermissionState）→ 已在范围卡补过一半，图上要能看见 grant 的权威来源

---

## 验收（每条都要能被变异咬住）

| 改造 | 正向 | 反向 |
|---|---|---|
| services 三层进 mermaid | 生成的 Python 图出现 `util`/`core`/`flow` 节点 | 手改这张图，`test_architecture` 红 |
| 编排环 spine | 图上有 `run_control` → handoff → `spec_first` | 把 `_handoff_factory` 调用删掉，图上那条边消失（或闸红） |
| workflow 叶子 | `workflow_registry` 出度 0（不依赖 driver） | 它 import `v5_full_driver` 就红 |
| 工具词表叶子 | 闭集表模块出度 0 | 词表文件 import 控制面就红 |
| 跨语言边入图 | 四个 adapter 不再以「没人用」出现 | 删 `server/index.ts` 的拼字符串加载，闸仍要求声明 |
| TS 环棘轮 | baseline 只变短 | 新增组间环，`--check` 红 |
| 手画降级 | V6.0 头注写非权威 | 新 PR 往 V6.0 打 ⚑，评审拒 |

---

## 建议顺序

P0–P3 图和闸已收。自由编排（2026-09-01）：WRITE 跑完工厂后交回控制面
（`factory_complete` + `control_tool_result`）。按钮点火仍跳过 LLM，
工厂收尾必须再问一轮——否则点「开始推演」自由编排整轮零介入。
不抄 Bash / MCP / 子代理 / grok-agent 提示词。
