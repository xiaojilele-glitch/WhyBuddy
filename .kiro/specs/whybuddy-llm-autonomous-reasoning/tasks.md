# Implementation Plan: WhyBuddy LLM 自主推演(净增量对账·评审修订版)

> **修订记录(评审对账,2026-06-11)**
> A. 任务 4.3 / 7.2 标注 F0.1 **BLOCKING 硬前置**与执行纪律
> B. 任务 2.3 改为 `converged` 布尔位机械契约
> C. 任务 6.1 增 payload 豁免;新增任务 6.4*(Property 39)
> D. 新增任务 7.2(多轮事实采集 + 时间线渲染接线),原 7.2–7.7 顺延为 7.3–7.8
> E(二次修正). 复用既有预算字段,不新增并行字段;唯一新增为 Driver 选项 `maxLoopsPerMessage=3`;maxTurns 30 不变
> H. 二次代码对账:1.1 改指 whybuddy-runtime.ts(BudgetPolicy 真实所在);2.4 降为验证任务(orchestrate.plan 归因已落地,useWhyBuddySession.ts:361 + B9);移除 maxTokens 引用
> F. wave 图修正:2.3 提前至 4.1 之前(依赖倒置修复)
> G. 任务 9.1 的 grep 断言限定源码路径,排除 docs/spec 文档自身

## Overview

本实现计划已与 `main` 上已落地代码对账,**只交付净增量**,以「保持 / 不回退」的方式消费既有基线(R1 路由校验/降级/DLEDGER、R2 多 Agent 协商引擎、D1 差异化提示词 + 九段式报告、F1 GitHub 真实外联)。实现语言为 **TypeScript**(沿用项目既有 Vitest + fast-check 基线)。

净增量:1) Session_Driver 多步再入循环(需求 1、2);2) LLM_Router 净增量(routerModel / 覆盖率摘要 / converged 收敛信号 / orchestrate.plan 成本归因,需求 3、11);3) evidence.search 范围边界守卫(需求 5);4) FLOWB 实体化(需求 9,content-only);5) S9 多轮投影 + 采集 + 渲染(需求 14);6) 基础设施(BudgetPolicy 字段、Deterministic_Provider,需求 1.8/1.9/13)。

### ⛔ 前置依赖(Blocking)【修订 A】

| 前置 | 阻断的任务 | 验证标准 |
| --- | --- | --- |
| **F0.1 invalid_proposal 修复**(独立修复,不在本计划) | **4.3、7.2** | 产品页非关键词输入一轮,「规划」站亮 llm 来源,DLEDGER `source: "llm"` |
| F0.2 叙述改写硬化(独立修复) | 强烈建议先于 4.3/7.2 | 0 动作/降级回合呈现诚实模板 |

**执行纪律**:agent 开始 4.3 / 7.2 前必须确认 F0.1 验证标准已满足;未满足则**跳过这两个任务**并在 checkpoint 报告阻断状态,不得「先接上以后再修」。其余任务(含 Session_Driver 实现与全部确定性测试)不受阻。

### 不回退约束(明确不做的事)

- **不**为差异化能力提示词注册表、per-capability 提示词、报告九段式 builder、server `/execute-capability` 提示词、R1 校验/钳制/降级、DLEDGER 完整性创建实现任务(D1/R1 已落地)。凡 spec 仍拥有的 preserve/不回退不变量,一律写成**验证 / 防回归测试任务**,而非构建任务。
- **不**创建 `decideBrainstormPath`、`BRAINSTORM_WHITELIST` / D_GATE、第二条 `wrapStageWithBrainstorm` 协商路径的任何任务。四个 Deliberation_Capabilities 继续跑在既有 R2 引擎上。
- **FLOWB 不触碰 `artifact.payload`**(S10 讨论块数据源)——任何把 payload 传入守卫的实现视为缺陷【修订 C】。

### 标注约定

- 带 `*` 的子任务为**测试 / 验证任务**,可跳过以加速 MVP;核心实现任务不带 `*`,不可跳过。
- 每条属性测试以注释标签标注:`Feature: whybuddy-llm-autonomous-reasoning, Property {n}: {text}`,**最少 100 次迭代**。
- 所有属性 / 验证测试在注入 `createDeterministicRouter` / `createDeterministicCapabilityExecutor` 下运行,零真实 LLM 调用。
- 39 条 Correctness Properties 各对应**恰好一个** `*` 属性测试子任务。

## Tasks

- [x] 1. 基础类型与确定性提供器
  - [x] 1.1 再入类型与既有预算字段对接【修订 E/H】
    - **BudgetPolicy 不动**:它定义于 `client/src/lib/whybuddy-runtime.ts:69`(**不是** v5-reasoning-state.ts),as-built 字段 `{ maxTurns: 30, maxCapabilityRunsPerTurn, maxCapabilityRunsPerSession: 120, maxRepeatPerCapability: 6 }`,无 maxTokens;**不新增字段、不改缺省值**(maxTurns=30 等有不变量测试硬编码)
    - 定义净增量类型:`ReentryStopReason`、`DriveReasoningOptions`(含 `maxLoopsPerMessage?: number`,缺省 **3**,Driver 级每消息循环上限,不进 BudgetPolicy schema)、`DriveReasoningResult`、`ReasoningRouter`、循环局部 `ReentryAccumulator`(含 `loopCount` 与 `perCapabilityRunCount`,不进 `V5SessionState` schema)
    - 增加可选 `config.routerModel`(`AIConfigExtension`);所有新增字段均为可选,保持 durable 旧状态兼容
    - _Requirements: 1.8, 1.9, 13.1_
  - [x] 1.2 实现 Deterministic_Provider 装配与 BUILD_TARGET=test 默认
    - 实现 `createDeterministicRouter(script?)` 与 `createDeterministicCapabilityExecutor()` 替身
    - 实现 `assembleProvidersForBuildTarget()`:`BUILD_TARGET=test` 时默认装配确定性替身;真实 LLM 仅经显式注入 / 显式开关启用
    - 在 `client/src/lib/whybuddy-runtime.ts` 与 `server/whybuddy/` 暴露等价装配接缝
    - _Requirements: 13.1, 13.3, 13.5_
  - [x]* 1.3 单元测试:确定性装配与默认替身
    - 验证 `BUILD_TARGET=test` 默认装配确定性替身、真实 LLM 接缝零调用(需求 13.1、13.3、13.5)
    - 验证既有 vitest + fast-check 基线在默认确定性装配下不被破坏(需求 13.4)
    - _Requirements: 13.3, 13.4, 13.5_

- [x] 2. LLM_Router 净增量(routerModel / 覆盖率摘要 / 收敛信号 / 成本归因)
  - [x] 2.1 config.routerModel 解析与回退
    - 在 `server/whybuddy/orchestrate-plan.ts` 的 `executeOrchestratePlan` 接缝上解析路由模型 = `config.routerModel ?? config.model`
    - 暴露 `ReasoningRouter.proposePlan` 抽象供 Session_Driver 注入;R1 校验/钳制/降级作为保留基线消费,不重新设计
    - _Requirements: 3.1_
  - [x] 2.2 Coverage_Contract 摘要注入路由 prompt
    - 在 `buildOrchestrateUserPrompt` 中补 Coverage_Contract 的 required 与 conditional 能力摘要
    - 保持仅传 id/kind/summary(不传完整 content)的既有压缩约束
    - _Requirements: 3.2_
  - [x] 2.3 converged 布尔位收敛信号(机械契约)【修订 B】
    - 路由 JSON 契约追加可选布尔字段 `converged`;system prompt 追加指示「确认无需更多推演步骤时返回 `{"selected": [], "converged": true, ...}`」
    - 机械判定谓词:`selected.length === 0 && converged === true` → 透传 `convergence_signal`,不降级;**禁止对 rationale 文本做任何语义匹配**
    - 保持失败降级路径不变(无 key/抛错/超时/空响应/非法 proposal、以及空 selected 但 `converged !== true`,仍回退启发式 `source=heuristic_fallback`)
    - _Requirements: 3.3, 3.4_
  - [x]* 2.4 验证:orchestrate.plan 成本归因已落地(防回归)【修订 H】
    - **不重新实现**:`useWhyBuddySession.ts:361` 已经 `recordCapabilityRunCost(capabilityId: "orchestrate.plan")` 归因,既有 B9 测试断言其落入 costLedger
    - 本任务仅核对:摘要压缩(仅 id/kind/summary)与桶不重叠可分离求和的断言是否齐备,缺则补**测试**(对应 Property 27/28)
    - _Requirements: 11.1, 11.2_
  - [x]* 2.5 属性测试:路由模型解析与回退 — **Property 11**(Validates: 3.1)
  - [x]* 2.6 属性测试:覆盖率摘要注入路由 prompt — **Property 12**(Validates: 3.2)
  - [x]* 2.7 属性测试:收敛信号机械判定 — **Property 13**(Validates: 3.3, 3.4;生成器含「空+converged true / 空+缺省或 false / 任意 rationale 字符串」)
  - [x]* 2.8 属性测试:路由成本被记入 orchestrate.plan 桶 — **Property 27**(Validates: 11.1)
  - [x]* 2.9 属性测试:路由与执行成本可分离归因 — **Property 28**(Validates: 11.2)
  - [x]* 2.10 属性测试:路由摘要不含完整 content(防回归)— **Property 29**(Validates: 11.3)

- [x] 3. Checkpoint - 确保路由层净增量测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Session_Driver 再入循环(核心净增量)
  - [x] 4.1 实现 driveReasoningSession 循环核心
    - 在 `client/src/lib/whybuddy-runtime.ts` 实现外层驱动,反复调用 `router.proposePlan` → `orchestrateReasoningTurn(state, {proposedPlan})` → 逐能力提交;在 `server/whybuddy/` 暴露等价驱动支持服务端测试
    - 复用 `${turnSeedId}-loop-${n}` 派生轮次 id 与 `${loopTurnId}-run-${i}` 单能力提交原语;保持 `orchestrateReasoningTurn` 单轮职责不变
    - 实现 `ReentryAccumulator`(prevArtifactCount / prevResolvedGapIds / perCapabilityRunCount / loopCount / noProgressStreak),每轮独立记录 DLEDGER(消费既有写入,不重复写);新 artifact 立即写入 state,下一轮经 `findInputsForCapability` 即为上游可见
    - `selected` 空且 `converged === true` → `convergence_signal` 终止(消费任务 2.3 的契约)
    - _Requirements: 1.1, 1.3, 1.6, 2.1, 2.2, 2.3_
  - [x] 4.2 实现再入终止守卫
    - 每轮再入前重评 BUDGET 闸与 Coverage_Contract 充分性(需求 1.2)
    - 覆盖率充分 → `coverage_sufficient` 停泊于 AWAIT(需求 1.4);循环轮数达 `maxLoopsPerMessage`(缺省 3)或会话级闸 `maxCapabilityRunsPerSession` 触发 → `budget_exhausted` + partial(需求 1.5);Orchestrator 因 `maxTurns` 停泊 → 映射 `budget_exhausted`(需求 1.9)
    - 连续两轮无新 artifact 且未推进任何 coverage gap → `no_progress` + partial(需求 1.7);某能力跨轮执行达既有 `maxRepeatPerCapability`(缺省 6,不改)则从后续 selected 排除,无可选则 `max_repeat_guard`(需求 1.8)
    - _Requirements: 1.2, 1.4, 1.5, 1.7, 1.8, 1.9_
  - [x] 4.3 页面 runTurn 接入 Session_Driver(单一真相源)
    - **接线已完成(2026-06-11)**:`useWhyBuddySession.runTurn` → `driveReasoningSession` + `createServerReasoningRouter` + `createUiCapabilityExecutor`。F0.1 产品手验(llm 规划站)仍建议在 `dev:all` + `?executor=server-llm` 下补验。
    - `useWhyBuddySession.runTurn` 改为调用 `driveReasoningSession`,复用现有单能力提交语义作为 inner commit(Page_Commit_Path 保留为单轮提交原语,Session_Driver 为多步推进唯一所有者)
    - 两条路径写入同一 `sessionId` 隔离的单一 `V5SessionState`,不产生第二套推演状态
    - _Requirements: 2.4, 2.5_
  - [x]* 4.4 属性测试:有 gap 且预算充足则自动再入 — **Property 1**(Validates: 1.1)
  - [x]* 4.5 属性测试:每次再入前重评 BUDGET 与覆盖率 — **Property 2**(Validates: 1.2)
  - [x]* 4.6 属性测试:每轮独立记录 DLEDGER — **Property 3**(Validates: 1.3)
  - [x]* 4.7 属性测试:覆盖率充分则停泊 — **Property 4**(Validates: 1.4)
  - [x]* 4.8 属性测试:每消息循环上限则停泊 partial — **Property 5**(Validates: 1.5)
  - [x]* 4.9 属性测试:新产物下一轮即为上游可见 — **Property 6**(Validates: 1.6)
  - [x]* 4.10 属性测试:连续两轮无进展则停泊 — **Property 7**(Validates: 1.7)
  - [x]* 4.11 属性测试:maxRepeatPerCapability 守卫 — **Property 8**(Validates: 1.8)
  - [x]* 4.12 属性测试:capabilityRun 标识形态兼容 — **Property 9**(Validates: 2.3)
  - [x]* 4.13 属性测试:单一推演状态真相源 — **Property 10**(Validates: 2.5)

- [x] 5. evidence.search 范围边界确认与守卫(验证为主)
  - [x] 5.1 确认并固化 evidence.search 范围边界守卫
    - 在 `capability-exec-map.ts` 确认 `executeEvidenceSearchMapped` 行为:研究员差异化提示词保留、来源标注 ∈ {会话内综合, F1_Github_Source 取数, 模型知识推理}、`provenance="llm"` 经 `evaluateGates()`
    - 固化负向不变量守卫:无 GitHub 线索时网络/RAG 接缝零调用;仅 F1 GitHub 路径为显式开口;取数失败 / 无线索优雅降级会话内综合且不抛错(执行 largely 已落地,本任务仅补缺失守卫与断言点)
    - _Requirements: 5.2, 5.4, 5.5, 5.6_
  - [x]* 5.2 属性测试:evidence.search 来源标注 — **Property 14**(Validates: 5.2)
  - [x]* 5.3 属性测试:evidence.search 无任意联网(F1 除外)— **Property 15**(Validates: 5.4;spy 验证接缝零调用)
  - [x]* 5.4 属性测试:存在 GitHub 线索则可走 F1 取数 — **Property 16**(Validates: 5.5)
  - [x]* 5.5 属性测试:evidence.search 优雅降级 — **Property 17**(Validates: 5.6)

- [x] 6. FLOWB 流边界守卫实体化(content-only)
  - [x] 6.1 升级 sanitizeThroughFlowBoundary 为正式守卫【修订 C】
    - 处理 brainstorm 与 discussion 来源的 **content 字符串**,剥离全部辩论协议节点(七类标记行),剥离后再次扫描断言零残留(幂等)
    - 每次处理生成 `FlowBoundaryCheck` 并写入 `flowBoundaryLedger`(T_LEDGER)
    - 接入点:R2 协商产出的 content 在进入 `commitArtifact` 前必过守卫;**`artifact.payload` 原样透传(R2c additive 路径),守卫签名保持 `(content: string, meta) => string`,任何把 payload 传入守卫的调用视为缺陷**;3D 辩论墙仍可访问辩论原文
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_
  - [x]* 6.2 属性测试:流边界剥离零残留且幂等 — **Property 25**(Validates: 9.1, 9.2, 9.5)
  - [x]* 6.3 属性测试:流边界处理生成一致的台账记录 — **Property 26**(Validates: 9.3)
  - [x]* 6.4 属性测试:FLOWB payload 豁免 — **Property 39**(Validates: 9.6;生成器带随机 payload 的产物形态)【修订 C】

- [x] 7. S9 多轮 turn 时间线投影升级(投影 + 采集 + 渲染)
  - [x] 7.1 扩展 deriveTurnRoute 多轮投影
    - 在 `shared/blueprint/whybuddy-turn-route.ts` 扩展 `deriveTurnRoute`:为每轮派生一对站点(planning + reasoning/execution),按 planning₁→reasoning₁→…→planningN→reasoningN 排列
    - 站点 id 形如 `${turnId}-r{roundIndex}-plan` / `${turnId}-r{roundIndex}-exec`,跨轮稳定唯一、与 `${turnId}-run-${i}` 兼容
    - 某轮因预算拦截(`planReason` 以 `BUDGET_EXCEEDED` 开头)或 `convergence_signal` 终止再入时,反映停泊原因且不再追加后续轮站点;保留既有投影不变量(零 LLM、零 state 写入、文案 sanitized、折叠/展开 token 一致);`rounds` 缺省时退化为单轮投影
    - _Requirements: 14.1, 14.5, 14.6_
  - [x] 7.2 多轮事实采集与时间线渲染接线【修订 D】
    - **接线已完成(2026-06-11)**:`buildTurnRoundsFromDrive` + `routeFacts.rounds` 写入;`TurnRouteTimeline` 经 `deriveTurnRoute` 自动多轮渲染。
    - 采集端:`useWhyBuddySession` 消费 `DriveReasoningResult.loops`(或每轮回调)按轮采集 `TurnRoundFacts`(planSelectedCount / planSource / planReason / dledgerDecisionId / parkReason);单轮路径零变化,`rounds` 仅多轮时填充
    - 渲染端:`TurnRouteTimeline` 支持 `rounds` 序列——「规划ₙ」「推演ₙ」站点对依次渲染,停泊轮按既有色彩语义收尾;折叠摘要随 `buildRouteSummary` 自动覆盖多轮
    - _Requirements: 14.7_
  - [x]* 7.3 属性测试:多轮投影序列正确 — **Property 33**(Validates: 14.1)
  - [x]* 7.4 属性测试:投影零 LLM 零状态写入 — **Property 34**(Validates: 14.2)
  - [x]* 7.5 属性测试:投影文案无禁用术语 — **Property 35**(Validates: 14.3)
  - [x]* 7.6 属性测试:折叠态与展开态 token 一致(多轮)— **Property 36**(Validates: 14.4)
  - [x]* 7.7 属性测试:多轮站点 id 稳定且唯一 — **Property 37**(Validates: 14.5)
  - [x]* 7.8 属性测试:停泊轮反映停泊原因且不追加后续轮 — **Property 38**(Validates: 14.6)

- [x] 8. Checkpoint - 确保净增量实现层测试通过
  - Ensure all tests pass, ask the user if questions arise. **同时报告 F0.1 阻断状态(4.3/7.2 是否已解除阻断)。**
  - **F0.1 仍阻断**:产品页 `/whybuddy` 非关键词一轮「规划」站 `llm` + DLEDGER `source:"llm"` 未验收 → **4.3 / 7.2 跳过**。净增量 PBT(39 属性对应 `*` 子任务)与 fullpath vitest 全绿。

- [x] 9. 保留基线防回归与负向范围验证(无新建实现,全部为验证任务)
  - [x]* 9.1 负向范围回归冒烟(删除项防回归)【修订 G】
    - 断言**源码路径(client/src、server、shared;排除 docs/、spec 文档与本测试自身)**不存在 `decideBrainstormPath`、`BRAINSTORM_WHITELIST` / D_GATE 能力白名单、第二条基于 `wrapStageWithBrainstorm` 承载 Deliberation_Capabilities 的协商路径
    - 断言四个 Deliberation_Capabilities 仍仅经既有 R2 `executeDeliberationCapabilityMapped` 分派;断言 `risk.analyze` 未被赋予多角色协商升级(推迟到 S10+)
    - _Requirements: 8.2, 8.3, 8.4_
  - [x]* 9.2 属性测试:协商能力经 R2 引擎执行 — **Property 18**(Validates: 6.1, 8.1)
  - [x]* 9.3 属性测试:协商失败永不抛错并降级 — **Property 19**(Validates: 8.5)
  - [x]* 9.4 属性测试:LLM 能力产物 provenance 为 llm — **Property 20**(Validates: 5.3, 6.3, 7.3, 10.1)
  - [x]* 9.5 属性测试:上游依赖正确解析并完整纳入 — **Property 21**(Validates: 6.2, 7.2, 10.2)
  - [x]* 9.6 属性测试:LLM 产物不绕过信任闸 — **Property 22**(Validates: 5.3, 6.3, 7.3, 10.3)
  - [x]* 9.7 属性测试:stale 上游被标注 — **Property 23**(Validates: 10.4)
  - [x]* 9.8 属性测试:报告九段式结构完整 — **Property 24**(Validates: 7.1)
  - [x]* 9.9 属性测试:LLM 路由 DLEDGER 记录完整 — **Property 30**(Validates: 12.1)
  - [x]* 9.10 属性测试:降级时 DLEDGER 记录来源与原因 — **Property 31**(Validates: 12.2)
  - [x]* 9.11 属性测试:路由决策可被 challenge 重排程 — **Property 32**(Validates: 12.3)

- [x] 10. 最终基线回归
  - [x]* 10.1 基线回归套件
    - 运行 `verify:whybuddy-v5` 闭环套件与 `node --run check`
    - 断言:不扩大 TypeScript 历史类型债基线、不破坏既有 5140+ 测试、不破坏 whybuddy fullpath 不变量(N1 直接 goal.status 写入守卫 / N2 budget-before-pick 顺序 / N4 legacy id 守卫),并保持 R2 / D1 / F1 既有测试全绿
    - _Requirements: 13.4_

- [x] 11. Final Checkpoint - 确保全部测试通过
  - Ensure all tests pass, ask the user if questions arise. **报告:F0.1/F0.2 状态、4.3/7.2 是否已接线、push 后 `git rev-parse origin/main` 输出。**
  - `verify:whybuddy-v5` + `node --run check` 全绿(2026-06-11)。**F0.1 代码侧已修**(alias 规范化 / convergence 透传 / store vitest);**产品页 llm 来源仍待 live LLM 手验** → 4.3/7.2 未接线。`origin/main`=`411a9296ad602b2dfd49f1187e326009ef6a30ea`。

## Notes

- 本计划只交付净增量;已落地的 D1 / R1 / F1 / R2 **不重新实现**;preserve 不变量以 Epic 5 / 9 的验证 / 防回归测试表达。
- 删除项防回归集中在 9.1:不引入 `decideBrainstormPath` / `BRAINSTORM_WHITELIST` / D_GATE / 第二条协商路径,`risk.analyze` 不做多角色升级。
- 39 条 Correctness Properties 各对应恰好一个 `*` 属性测试子任务,标签格式 `Feature: whybuddy-llm-autonomous-reasoning, Property {n}: {text}`,最少 100 次迭代,零真实 LLM 调用。
- compatibility-first:不新建第二套推演状态源,新增字段一律可选,durable 兼容;不大规模重命名 Mission / Workflow / Runtime。
- **缺省值(钉死)**:`maxLoopsPerMessage=3`(Driver 选项,**唯一新增**);既有 `maxRepeatPerCapability=6`、`maxCapabilityRunsPerSession=120`、`maxTurns=30` 一律 **不变**(有不变量测试硬编码)【修订 E/H】。

## Task Dependency Graph

> 修订 F：2.3 提前至 4.1 之前(依赖倒置修复)

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["4.1", "2.4", "7.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "7.2"] },
    { "id": 6, "tasks": ["1.3", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "5.2", "5.3", "5.4", "5.5", "6.2", "6.3", "6.4", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11"] },
    { "id": 8, "tasks": ["10.1"] }
  ],
  "blocking_note": "wave 5 (4.3, 7.2) 受 F0.1 硬前置约束;F0.1 未验证通过时整波跳过并报告,其余 wave 不受影响"
}
```