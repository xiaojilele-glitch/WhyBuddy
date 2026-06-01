---
inclusion: manual
---

# 任务自动驾驶 specs 路线图（2026-04-23）

## 背景

WhyBuddy 当前已经不是一个单纯的“聊天式 Agent 演示项目”，而是一个具备以下底座能力的任务操作系统：

- mission-first 的主界面与任务工作台
- 十阶段工作流引擎与 Mission Runtime
- review / audit / revision / verify 闭环
- replay / lineage / evidence / telemetry 可观察能力
- Web-AIGC `58 / 58` specs 封板基线与主服务主线接线
- A2A、Guest Agent、Swarm、真实执行器、浏览器预演运行时

在这个基础上，将产品叙事从“任务操作系统”进一步升级为“任务自动驾驶平台”是成立的。用户不再只是给出 prompt，而是输入一个“目的地”；系统不再只返回答案，而是自动规划路线、组建车队、执行、澄清、调整，并在必要时请求人工接管。

本文件用于回答一个具体问题：

> 如果沿“任务自动驾驶”方向继续推进，建议拆出多少 specs，分别是什么，先后顺序如何。

---

## 结论

结合当前仓库已有的 spec 粒度、Web-AIGC 的高颗粒拆分经验，以及这次“任务自动驾驶”涉及产品、交互、runtime、治理多层联动的特点，建议按三档规模评估：

| 规模 | 建议份数 | 适用目标 |
| ---- | -------- | -------- |
| 最小验证版 | `8 ~ 12` | 先验证产品叙事是否成立，支撑一版概念原型与 README / steering 升级 |
| 标准产品化版 | `15 ~ 22` | 形成完整产品定义、概念模型、驾驶舱 IA、runtime 映射与治理边界 |
| 平台完整版 | `28 ~ 36` | 深入到 route、状态机、风险评估、车队编组、回放驾驶时间线、证据链等平台级细拆 |

**建议第一阶段以 `18` 份 specs 为主线推进。**

原因：

- 少于 `10` 份会过粗，后面容易回退成大而空的产品文案；
- 一上来做 `30+` 份会过早进入文档膨胀；
- `18` 份刚好能覆盖“产品定位 + 概念模型 + 驾驶舱交互 + runtime 接线 + 治理边界 + Web-AIGC 节点映射”六个核心维度。

如果每份 spec 仍采用当前项目标准三件套：

- `requirements.md`
- `design.md`
- `tasks.md`

那么第一阶段文档体量约为：

- `1` 份总路线图（本文件）
- `18 × 3 = 54` 份 spec markdown
- 总计约 `55` 份核心文档

这个规模与此前 Web-AIGC `58` 份 specs 的体量接近，符合当前仓库的文档与推进习惯。

---

## 拆分原则

### 1. 先抽象产品对象，再改造底层 runtime

不建议一开始就把底层代码里的 `mission / workflow / task` 统一重命名成 `destination / route / drive-state`。更稳妥的做法是：

- 产品层引入新的用户态对象
- runtime 层先做映射与投影
- 确认概念稳定后，再判断是否需要深度改名或重构

### 2. 不直接向用户暴露 50+ 节点

对外层应抽象成：

- 目的地
- 推荐路线
- 当前车队
- 驾驶状态
- 接管点

底层节点仍然保留在内部编排与能力映射层。

### 3. 先做“产品自动驾驶”，后做“平台全自动”

第一阶段不追求开放域 L5 自动执行，而是明确：

- 哪些任务可以自动规划
- 哪些阶段必须接管
- 哪些路线只适用于限定场景

### 4. 复用现有 mission-first 底座

优先复用现有：

- `mission-runtime`
- `workflow-engine`
- `human-in-the-loop`
- `task-runtime-visibility-v1`
- `office-task-cockpit`
- `replay-and-debug-surface-v1`
- `audit-chain`
- `data-lineage-tracking`
- `web-aigc-platform-*`

避免重复造平台底座。

---

## 推荐 18 个 specs

以下是建议的第一阶段 `18` 份 specs，按产品层、对象层、交互层、runtime 层、治理层、迁移层六组组织。

## 当前执行状态（2026-04-26）

本路线图已经完成第一阶段闭环，当前状态如下：

- `P0` 六份核心 specs 已完成首轮产出，并已落入各自目录：
  - `task-autopilot-platform-positioning`
  - `task-autopilot-core-concepts`
  - `task-autopilot-levels-l1-to-l5`
  - `destination-model-and-parser`
  - `route-planner-and-route-model`
  - `mission-model-to-autopilot-model-mapping`
- `P1` 六份交互与驾驶舱 specs 已完成首轮产出，并已落入各自目录：
  - `autopilot-cockpit-information-architecture`
  - `destination-card-and-goal-summary`
  - `route-recommendation-and-selection`
  - `fleet-status-and-live-execution-view`
  - `takeover-panel-and-decision-points`
  - `drive-state-and-replan-state-machine`
- `P2` 六份 runtime 与治理增强 specs 已完成首轮产出，并已落入各自目录：
  - `fleet-organization-and-role-packaging`
  - `autopilot-runtime-orchestration`
  - `autopilot-explainability-and-telemetry`
  - `autopilot-recovery-and-human-takeover-governance`
  - `autopilot-evidence-replay-and-trust-chain`
  - `task-autopilot-success-metrics`
- 当前累计已完成 `18` 份 specs 的文档产出，共 `54` 份 markdown：
  - 每份均包含 `requirements.md`
  - 每份均包含 `design.md`
  - 每份均包含 `tasks.md`
- 当前已完成基础收口检查：
  - 目录完整
  - 文档为中文
  - 顶层任务项已重算为 `345 / 345`
  - raw checklist 已重算为 `602 / 602`
  - 进度总览 SVG 已更新：`docs/task-autopilot-18-spec-progress-overview-2026-04-24.svg`
- 第一阶段 `18` 份 task-autopilot specs 已全部完成并收口，主线 README、ROADMAP 与 steering 已进入 2026-04-26 闭环口径。
- 第一条 compatibility-first 代码纵切已经进入主线：
  - `shared/mission/autopilot.ts` 提供 `parseMissionDestination()`、Destination parser 类型与 `MissionAutopilotSummary`
  - `server/tasks/mission-projection.ts` 提供 autopilot summary / orchestration projection
  - `client/src/lib/tasks-store.ts` 提供 autopilot normalize 与 alias fallback
  - `client/src/components/tasks/TaskAutopilotPanel.tsx` 提供驾驶舱目的地、路线、接管、证据消费面

当前推进原则保持不变：

- 先稳定产品层对象与语义
- 再深化驾驶舱可视化与接管交互
- 底层继续采用 compatibility-first，不立即大规模重命名 `mission / workflow / runtime`
- 下一阶段不再优先扩 specs 数量，而是推进真实 runtime 深水区：parser 版本化、clarification merge、route planner 自动编队、fleet orchestration、takeover governance、evidence replay trust chain、success metrics 与 live mission facts 对齐。

### A. 产品定义组（4 份）

#### 1. `task-autopilot-platform-positioning`

目标：

- 定义“任务自动驾驶平台”是什么
- 对比 chat playground / workflow builder / agent platform
- 形成 README、官网、路演、项目总览可复用的统一口径

建议内容：

- 产品一句话定义
- 用户问题定义
- 差异化价值
- 与现有 mission-first 的关系

#### 2. `task-autopilot-core-concepts`

目标：

- 把新的产品对象定义成统一词汇表

必须定义的对象：

- Destination
- Route
- Drive State
- Fleet
- Takeover Point
- Replan
- Confidence
- Risk

#### 3. `task-autopilot-levels-l1-to-l5`

目标：

- 明确自动驾驶分级，防止“全自动黑盒承诺”

建议层级：

- L1：建议路线，用户手动执行
- L2：系统自动执行部分链路，关键点接管
- L3：标准任务大多数自动完成
- L4：限定任务域高自动化
- L5：开放域全自动，仅作为远期目标

#### 4. `task-autopilot-success-metrics`

目标：

- 定义这个方向如何衡量成败

建议指标：

- 任务送达率
- 接管率
- 重规划率
- 偏航率
- 用户确认次数
- 路线完成时长
- 结果复核通过率

---

### B. 任务对象与路线组（4 份）

#### 5. `destination-model-and-parser`

目标：

- 把用户输入升级为 Destination 对象

建议边界：

- 目标
- 子目标
- 约束
- 成功标准
- 缺失信息
- 任务类型识别

#### 6. `route-planner-and-route-model`

目标：

- 定义 Route 对象与路线生成机制

建议边界：

- 主路线
- 候选路线
- 快速 / 标准 / 深度路线
- 并行 / 串行安排
- 风险点
- 接管点

#### 7. `drive-state-and-replan-state-machine`

目标：

- 把任务过程抽象成驾驶状态机

建议状态：

- understanding
- clarifying
- planning
- fleet-forming
- executing
- reviewing
- blocked
- takeover-required
- replanning
- delivered

#### 8. `fleet-organization-and-role-packaging`

目标：

- 把底层节点 / agents 封装成产品可理解的车队角色

建议角色包：

- Planner
- Clarifier
- Researcher
- Generator
- Reviewer
- Auditor
- Operator

---

### C. 驾驶舱交互组（5 份）

#### 9. `autopilot-cockpit-information-architecture`

目标：

- 定义三栏驾驶舱主界面的信息架构

建议结构：

- 左：目的地与路线
- 中：执行主视图
- 右：接管、证据、成本、审计

#### 10. `destination-card-and-goal-summary`

目标：

- 把用户目标可视化成高层目标卡片

建议展示：

- 目标概述
- 成功标准
- 预期交付物
- 约束
- 当前置信度

#### 11. `route-recommendation-and-selection`

目标：

- 展示推荐路线与路线切换

建议展示：

- 最快
- 最稳
- 最深
- 路线差异解释
- 预估成本 / 时间

#### 12. `fleet-status-and-live-execution-view`

目标：

- 展示当前车队、角色分工、执行中间态

建议展示：

- 当前参与角色
- 每个角色状态
- 中间产物
- 并行执行状态
- 当前阻塞点

#### 13. `takeover-panel-and-decision-points`

目标：

- 统一承接澄清、确认、审批、补上下文、预算确认

建议边界：

- 用户确认点
- 风险确认点
- 风格 / 方向选择点
- 成本 / 权限接管点

---

### D. Runtime 与执行引擎组（3 份）

#### 14. `autopilot-runtime-orchestration`

目标：

- 明确 Mission Runtime 如何承接 Destination / Route / Fleet

建议边界：

- route -> mission 映射
- route step -> workflow phase 映射
- runtime 执行控制
- wait / resume / retry / escalate

#### 15. `autopilot-explainability-and-telemetry`

目标：

- 构建“驾驶仪表盘感”

建议边界：

- 当前状态解释
- 路线原因
- 风险提示
- 置信度
- 剩余步骤
- 节点证据

#### 16. `autopilot-recovery-and-human-takeover-governance`

目标：

- 把 review / audit / revise / verify 升级成自动驾驶恢复机制

建议边界：

- 偏航检测
- 结果不达标
- 自动修正
- 请求人工接管
- 接管后恢复执行

---

### E. 治理与可解释性组（1 份）

#### 17. `autopilot-evidence-replay-and-trust-chain`

目标：

- 把 audit / lineage / replay / evidence 统一为自动驾驶证据链

建议边界：

- 驾驶时间线回放
- 决策原因记录
- 工具调用证据
- 结果生成证据
- 审计与血缘串联

---

### F. 兼容与迁移组（1 份）

#### 18. `mission-model-to-autopilot-model-mapping`

目标：

- 定义旧模型与新模型之间的映射，不破坏现有工程基座

建议边界：

- Mission -> Destination
- Workflow -> Route
- Runtime state -> Drive State
- Decision / HITL -> Takeover
- Web-AIGC 节点 -> Fleet roles

---

## 建议的优先级分层

### P0：必须先做（6 份）

这组决定概念是否稳定，建议最先落地。

1. `task-autopilot-platform-positioning`
2. `task-autopilot-core-concepts`
3. `task-autopilot-levels-l1-to-l5`
4. `destination-model-and-parser`
5. `route-planner-and-route-model`
6. `mission-model-to-autopilot-model-mapping`

### P1：产品可见层（6 份）

这组决定用户能不能“看见”自动驾驶。

7. `autopilot-cockpit-information-architecture`
8. `destination-card-and-goal-summary`
9. `route-recommendation-and-selection`
10. `fleet-status-and-live-execution-view`
11. `takeover-panel-and-decision-points`
12. `drive-state-and-replan-state-machine`

### P2：runtime 与治理增强（6 份）

这组决定系统能不能稳定跑、可解释、可恢复。

13. `fleet-organization-and-role-packaging`
14. `autopilot-runtime-orchestration`
15. `autopilot-explainability-and-telemetry`
16. `autopilot-recovery-and-human-takeover-governance`
17. `autopilot-evidence-replay-and-trust-chain`
18. `task-autopilot-success-metrics`

---

## 依赖关系建议

### 第一批依赖主线

这条链路建议最先成形：

`platform-positioning`
-> `core-concepts`
-> `levels-l1-to-l5`
-> `destination-model-and-parser`
-> `route-planner-and-route-model`
-> `mission-model-to-autopilot-model-mapping`

这 6 份出来以后，你就已经有：

- 对外可讲的产品定义
- 对内可落的对象模型
- 对现有系统可兼容的迁移口径

### 第二批依赖主线

`core-concepts`
-> `drive-state-and-replan-state-machine`
-> `autopilot-cockpit-information-architecture`
-> `destination-card-and-goal-summary`
-> `route-recommendation-and-selection`
-> `takeover-panel-and-decision-points`

这批决定用户能否“感知到自动驾驶”。

### 第三批依赖主线

`route-planner-and-route-model`
-> `fleet-organization-and-role-packaging`
-> `autopilot-runtime-orchestration`
-> `autopilot-explainability-and-telemetry`
-> `autopilot-recovery-and-human-takeover-governance`
-> `autopilot-evidence-replay-and-trust-chain`

这批决定平台是否真的具备“驾驶能力”，而不仅是概念包装。

---

## 与现有 specs 的关系

这 18 份 specs 不建议完全替代已有 specs，而应与现有能力切片形成“上层产品抽象 + 下层实现基座”的关系。

### 直接复用或强关联的现有 specs

- `mission-runtime`
- `workflow-engine`
- `human-in-the-loop`
- `task-runtime-visibility-v1`
- `navigation-convergence`
- `office-task-cockpit`
- `replay-and-debug-surface-v1`
- `audit-chain`
- `data-lineage-tracking`
- `agent-autonomy-upgrade`
- `agent-permission-model`
- `web-aigc-platform-domain-model`
- `web-aigc-platform-mission-projection`
- `web-aigc-platform-runtime-engine`
- `web-aigc-platform-observability-audit`
- `web-aigc-platform-session-instance`

### 建议额外增加一个节点角色归类附录

虽然本次第一阶段不建议直接再开 `19`、`20`、`21` 号 spec，但可以在 `mission-model-to-autopilot-model-mapping` 中先附带一份归类附录：

- 导航节点
- 执行节点
- 治理节点

后续若确定落地深水区，再独立拆出：

- `web-aigc-node-role-taxonomy`
- `autopilot-fleet-pack-library`
- `autopilot-route-risk-evaluator`

---

## 若要压缩到最小版，建议保留这 8 份

如果你希望先做一版“概念验证级” specs，而不是直接上 18 份，建议保留以下 8 份：

1. `task-autopilot-platform-positioning`
2. `task-autopilot-core-concepts`
3. `task-autopilot-levels-l1-to-l5`
4. `destination-model-and-parser`
5. `route-planner-and-route-model`
6. `autopilot-cockpit-information-architecture`
7. `takeover-panel-and-decision-points`
8. `mission-model-to-autopilot-model-mapping`

这 8 份可以支持：

- README / project-overview 叙事升级
- 一版驾驶舱信息架构原型
- 一版核心对象模型
- 一版 L1-L5 自动驾驶分级

---

## 若进入平台完整版，可继续细拆的方向

当第一阶段 18 份成熟以后，可以继续向 `28 ~ 36` 份扩展，优先沿这些方向细拆：

- `autopilot-clarification-strategy`
- `autopilot-confidence-scoring`
- `autopilot-route-risk-evaluator`
- `autopilot-branching-and-fork-merge`
- `autopilot-route-cost-estimation`
- `autopilot-drive-state-visual-language`
- `autopilot-cockpit-mobile-adaptation`
- `autopilot-replay-as-driving-timeline`
- `autopilot-evidence-panel`
- `autopilot-user-takeover-history`
- `autopilot-default-route-policies`
- `autopilot-safety-and-governance-policies`

---

## 推荐推进方式

### 阶段 1：先做总论与概念锚点

输出：

- `task-autopilot-platform-positioning`
- `task-autopilot-core-concepts`
- `task-autopilot-levels-l1-to-l5`

目标：

- 先把“任务自动驾驶”说清楚
- 确认它是项目主叙事升级，而不是一次 UI 包装

### 阶段 2：做对象模型与映射

输出：

- `destination-model-and-parser`
- `route-planner-and-route-model`
- `drive-state-and-replan-state-machine`
- `mission-model-to-autopilot-model-mapping`

目标：

- 把产品语言接到现有 mission/workflow/runtime 基座上

### 阶段 3：做驾驶舱与可视化

输出：

- `autopilot-cockpit-information-architecture`
- `destination-card-and-goal-summary`
- `route-recommendation-and-selection`
- `fleet-status-and-live-execution-view`
- `takeover-panel-and-decision-points`

目标：

- 让“自动驾驶”真正变成主界面体验

### 阶段 4：做 runtime、治理与证据闭环

输出：

- `fleet-organization-and-role-packaging`
- `autopilot-runtime-orchestration`
- `autopilot-explainability-and-telemetry`
- `autopilot-recovery-and-human-takeover-governance`
- `autopilot-evidence-replay-and-trust-chain`
- `task-autopilot-success-metrics`

目标：

- 让这个方向不只可讲，而且可跑、可控、可复盘

---

## 最终建议

如果你问的是一个实操问题：

> 这块到底值得出多少 specs？

我的最终建议是：

- **先按 `18` 份规划第一阶段**
- 每份仍保持 `requirements / design / tasks` 三件套
- 不急着再加到 `30+`
- 先把“产品定义、对象模型、驾驶舱、runtime 映射、治理闭环”这 18 个锚点立起来

一句话总结：

> “任务自动驾驶”不是一个新功能，而是 WhyBuddy 下一阶段的上位产品定义。它值得被当作一组完整 specs 来推进，而不是只写成一篇产品灵感笔记。
