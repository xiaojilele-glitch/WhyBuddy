# Requirements Document

> **修订记录(评审对账,2026-06-11)**
> A. 新增「前置依赖(Blocking)」节:F0.1 为产品页接线(任务 4.3/7.2)的硬前置
> B. 需求 3.3/3.4:收敛信号改为机械判定(路由 JSON 契约新增 `converged` 布尔字段)
> C. 需求 9 新增 9.6:FLOWB 只处理 content,`artifact.payload` 豁免(S10 数据源保护)
> D. 需求 14 新增 14.7:多轮事实采集与渲染的所有权认领
> E(二次修正). BUDGET 复用既有字段 `maxRepeatPerCapability`(缺省 6)/ `maxCapabilityRunsPerSession`(缺省 120),**不新增并行字段**;每消息循环上限走 Driver 选项 `maxLoopsPerMessage`(缺省 3);maxTurns 缺省 30 **不变**(不变量测试硬编码)
> H. 二次代码对账(2026-06-11):任务 1.1 改指 `client/src/lib/whybuddy-runtime.ts`(BudgetPolicy 真实所在);需求 11 降为「保持不回退」(orchestrate.plan 归因已落地,B9 测试为证);移除不存在的 maxTokens

## Introduction

本需求文档定义 WhyBuddy V5.1 推演引擎在「LLM 自主路由 + 多步自主推演」方向上的**净增量**。

本文档曾针对一份过期快照编写,若按原样实现会**回退已落地子系统**。当前版本已与 `main` 上已落地代码对账,明确区分「已落地基线(本 spec 不重新实现、不得回退)」与「净增量(本 spec 真正交付)」:

- **R1(已落地)** —— 路由校验 / 失败降级 / DLEDGER `source` 标注(`server/whybuddy/orchestrate-plan.ts` + `shared/blueprint/whybuddy-plan-validation.ts`)。
- **R2(已落地)** —— 多 Agent 协商引擎(`server/whybuddy/deliberation-exec-map.ts` 将 `counter.argue` / `critique.generate` / `rebuttal.resolve` / `synthesis.merge` 路由进 brainstorm mini-session,含真实 adjudicator)。
- **D1(已落地)** —— 差异化能力提示词 + 九段式报告(`buildStructuredReport`)。
- **F1(已落地)** —— `evidence.search` / `repo.inspect` 经 `capability-exec-map.ts` + `repo-static-analyzer.ts` 对 `raw.githubusercontent.com` / `api.github.com` 的真实外联取数。

**本 spec 的净增量**:

1. 运行时拥有的 **Session_Driver** 多步再入循环(单条消息 → 多步推演 → 终止守卫停泊)及其所有权归属(核心增量)。
2. LLM_Router 的小增量:`config.routerModel`(低成本路由模型,缺省回退主模型)、`orchestrate.plan` 在成本台账中的独立归因、把 Coverage_Contract 的 required/conditional 摘要注入路由 prompt,以及以**机械布尔位**区分「明确收敛的空提案」与「非法 proposal」。
3. **S9 时间线投影升级**:因 Session_Driver 让单个 turn 跑 N 轮 planning+reasoning,投影须如实呈现 N 轮序列,并认领采集与渲染两端。

本 spec **不涉及**:stale-set 单调修复(独立 spec)、GCOV/BUDGET/DLEDGER 机制本身(已落地)、UI/Surface 大改、artifact-health-predicate 修复、`evidence.search` 的任意网页浏览 / RAG(F1 GitHub 路径除外,见需求 5)、`risk.analyze` 的多角色协商升级(明确推迟到独立的 S10+ 努力)、P0 诊断项**本身的修复实现**(invalid_proposal 提示修复、叙事杜撰 / S6-6、LightMarkdown S7b、GCOV 首轮收敛)——但其中 F0.1 构成本 spec 部分任务的**硬前置**,见下节。

## 前置依赖(Blocking)【修订 A】

| # | 前置项 | 阻断范围 | 验证标准 |
| --- | --- | --- | --- |
| F0.1 | **invalid_proposal 修复**(orchestrate 目录 prompt 逐字 id 清单等,独立修复) | **硬阻断**任务 4.3(runTurn 接入产品页)与任务 7.2(产品页多轮时间线渲染)。Session_Driver 的实现与确定性替身下的全部测试(任务 4.1/4.2 及属性测试)**不受阻**,可先行 | 产品页任意非关键词输入一轮,「规划」站显示 **llm 来源**(非 `invalid_proposal` 降级),DLEDGER `source: "llm"` |
| F0.2 | **叙述改写模式硬化**(S6-6 + 禁止凭空创作,独立修复) | **强烈建议**先于产品页接线完成:多步循环会放大叙述层缺陷(N 轮产物 → 一段凭空创作的危害乘 N) | 0 动作/降级回合的叙述以诚实模板呈现,无不可溯源正文 |

> 执行纪律:agent 在开始 4.3 / 7.2 前 **必须**确认 F0.1 验证标准已满足;未满足时跳过这两个任务并在 checkpoint 报告阻断状态,**不得**以「先接上以后再修」推进。

## Glossary

- **Orchestrator**:推演调度核,即 `orchestrateReasoningTurn()`,负责**单轮**选取能力、执行、提交产物
- **Session_Driver**:运行时拥有的多步执行驱动循环,反复调用 LLM_Router、执行选定能力、提交产物并判断再入或停泊;承载 `orchestrateReasoningTurn` 之外的再入循环所有权
- **Page_Commit_Path**:现有页面驱动的提交路径,页面在 `orchestrateReasoningTurn` 单次选取返回 plan 后,按 `${turnId}-run-${i}` 逐能力提交执行
- **LLM_Router**:基于 LLM 的能力路由器(`executeOrchestratePlan()`),输出经 `validateProposedPlan()` 校验的 `proposedPlan`,失败时回退 `pickNextCapabilitiesHeuristic`
- **Capability_Pool**:V5 平权能力池(`V5_CAPABILITY_POOL`)
- **CapabilityExecutor**:能力执行适配器接口
- **R2_Deliberation_Engine**:已落地的多 Agent 协商引擎,`server/whybuddy/deliberation-exec-map.ts` 将协商类能力路由进 brainstorm mini-session,经真实 adjudicator(`createAdjudicator`)裁决,产出经 synthesizer 综合
- **Deliberation_Capabilities**:经 R2_Deliberation_Engine 执行的四个能力集合 `{counter.argue, critique.generate, rebuttal.resolve, synthesis.merge}`(`deliberation-exec-map.ts` 的 `DELIBERATION_CAPABILITIES`)
- **Coverage_Contract**:覆盖率合约,声明 required/conditional 能力与最小证据要求
- **DLEDGER**:调度决策账,记录每次 `pickNextCapabilities` 的选择、跳过、原因与依据(`source: "llm" | "heuristic_fallback" | "local_heuristic"`)
- **BUDGET**:预算闸,as-built 字段为 `{ maxTurns: 30, maxCapabilityRunsPerTurn, maxCapabilityRunsPerSession: 120, maxRepeatPerCapability: 6 }`(定义于 `client/src/lib/whybuddy-runtime.ts:69`,**无 maxTokens**);每消息循环上限为 Session_Driver 选项 `maxLoopsPerMessage`(缺省 3,不进 BudgetPolicy schema)【修订 E/H】
- **FLOWB**:流边界守卫(`sanitizeThroughFlowBoundary()`),剥离辩论协议节点,确保正式产物的 **content** 不含辩论噪音;**不触碰 `artifact.payload`**【修订 C】
- **Session_State**:`V5SessionState`,推演状态的唯一真相源
- **ProposedPlan**:路由器输出的能力执行计划,`{ selected: Array<{capabilityId, roleId}>, rationale, converged?: boolean }`【修订 B】
- **Re_Entry_Loop**:再入循环,执行完选定能力后重新评估是否需要更多步骤的闭环
- **No_Progress**:连续多轮能力执行未产生新 artifact 且未推进任何 coverage gap 的停泊标记
- **Convergence_Signal**:LLM 返回 `selected: []` **且** `converged === true` 的机械信号,区别于 `invalid_proposal` 降级;判定不依赖对 rationale 的语义解读【修订 B】
- **Router_Model**:`config.routerModel`,供 LLM_Router 使用的低成本/更快模型,缺省回退主模型 `config.model`
- **F1_Github_Source**:已落地的 GitHub 取数路径,`evidence.search` / `repo.inspect` 经 `capability-exec-map.ts` + `repo-static-analyzer.ts` 对 `raw.githubusercontent.com` / `api.github.com` 取数
- **Turn_Route_Projection**:确定性的 turn 时间线投影(`shared/blueprint/whybuddy-turn-route.ts` 的 `deriveTurnRoute`),从运行时记录的事实派生站点,零 LLM、零 Session_State 写入
- **Deterministic_Provider**:确定性/Mock 提供器,可注入 LLM_Router 与 CapabilityExecutor 的替身实现
- **BUILD_TARGET**:构建目标环境变量,`BUILD_TARGET=test` 时默认装配 Deterministic_Provider

## 已落地基线(本 spec 不重新实现、不得回退)

下列子系统已在 `main` 落地。本 spec 的需求以「保持 / 不回退」为约束消费它们,**不重新设计、不引入并行实现**:

| 基线 | 落地位置 | 本 spec 约束 |
| --- | --- | --- |
| R1 路由校验 / 失败降级 / DLEDGER source | `orchestrate-plan.ts`、`whybuddy-plan-validation.ts` | 净增量挂在既有 `executeOrchestratePlan` / `validateProposedPlan` 接缝上 |
| R2 多 Agent 协商引擎 | `deliberation-exec-map.ts`、`server/routes/blueprint/brainstorm/*` | 协商类能力继续走 R2,**不新建第二条 brainstorm 路径** |
| D1 差异化提示词 + 九段式报告 | `capability-exec-map.ts`、`buildStructuredReport` | 保持差异化提示词与九段式结构不回退 |
| F1 GitHub 真实外联取数 | `capability-exec-map.ts`、`repo-static-analyzer.ts`、`github-mcp-adapter.ts` | `evidence.search` 的「无任意联网」边界须为 F1 显式开口(见需求 5) |

## Requirements

### 需求 1:多步自主推演循环(核心净增量)

**User Story:** 作为用户,我希望输入单条消息后引擎能自主执行多步推演(如 risk → counter → evidence → synthesis → report),而无需我逐步触发。

#### 验收标准

1. WHEN 一轮能力执行完成后仍有未解决的覆盖率 gap 且 BUDGET 余量充足时,THE Session_Driver SHALL 自动重新调用 LLM_Router 选取下一批能力并继续执行(再入循环)
2. THE Session_Driver SHALL 在每次再入前重新评估 BUDGET 闸和 Coverage_Contract 充分性
3. WHILE 再入循环进行中,THE Session_Driver SHALL 为每一轮独立记录 DLEDGER 条目
4. WHEN Coverage_Contract 所有 required 能力都有成功 run 且 blocking gap 全部 resolved/waived 时,THE Session_Driver SHALL 停止再入循环并停泊于 AWAIT
5. IF 本消息内的循环轮数达到 `DriveReasoningOptions.maxLoopsPerMessage`(缺省 3),OR 既有会话级闸 `maxCapabilityRunsPerSession` 在某轮触发,THEN THE Session_Driver SHALL 停泊于 AWAIT 并标记 `partial`;既有 `maxCapabilityRunsPerTurn` 语义不变,继续作为**单轮(单 loop)**上限由 Orchestrator 内既有闸执行;THE spec SHALL NOT 新增与既有预算字段语义重叠的并行字段【修订 E/H】
6. THE Re_Entry_Loop SHALL 确保每轮产出的新 artifacts 在下一轮作为上游输入可见(依赖图即时更新)
7. WHEN 连续两轮 LLM_Router 选取的能力未产生新 artifact 且未推进任何 coverage gap 时,THE Session_Driver SHALL 停止再入循环并停泊于 AWAIT(标记 `partial` / `No_Progress`)
8. WHEN 某一能力的再入执行次数达到既有 BUDGET 字段 `maxRepeatPerCapability` 的上限(as-built 缺省 6,有基线测试断言;**不改缺省值、不新增 maxRepeat 并行字段**)时,THE Session_Driver SHALL 将该能力排除出后续 selected,并将其作为再入循环的终止守卫之一【修订 H】
9. THE 每个派生 `loopTurnId` SHALL 按既有闸语义计入 `maxTurns`(+1/轮);`maxTurns` 由此升格为**会话级总循环安全阀**;其缺省值 30 SHALL **保持不变**(`whybuddy-runtime.fullpath-budget.test.ts` 等不变量测试硬编码该值,改默认即违背本 spec 的不回退承诺;后续如需扩容,SHALL 在同一提交中显式更新相关不变量测试并记录决策,不得静默改);WHEN Orchestrator 因 `maxTurns` 停泊时,THE Session_Driver SHALL 将其映射为 `budget_exhausted` 停止【修订 E/H】

### 需求 2:多步再入循环的所有权归属(核心净增量)

**User Story:** 作为推演引擎的架构维护者,我需要明确多步再入循环由运行时拥有,以便循环所有权与现有页面提交路径的关系清晰、可演进且不破坏既有调用方。

#### 验收标准

1. THE Session_Driver SHALL 由运行时拥有,负责驱动多步推演执行(反复调用 LLM_Router、执行选定能力、提交产物并判断再入或停泊),而非由页面提交循环驱动多步推进
2. WHERE 多步再入循环逻辑被实现,THE Session_Driver SHALL 作为 `orchestrateReasoningTurn` 之外的外层驱动函数承载再入循环,使 `orchestrateReasoningTurn` 保持「单轮选取 + 执行 + 提交」职责单一,由 Session_Driver 反复调用之
3. WHILE Session_Driver 驱动多步执行,THE Session_Driver SHALL 复用现有的单能力提交语义(`${turnId}-run-${i}` 形态的 capabilityRun 标识保持兼容)
4. THE 现有 Page_Commit_Path SHALL 在 Session_Driver 引入后保持可用,或被显式标记为由 Session_Driver 取代(二者择一并在设计阶段记录决策);**产品页接线受前置依赖 F0.1 硬阻断**【修订 A】
5. WHEN Session_Driver 与 Page_Commit_Path 同时存在时,THE Orchestrator SHALL 确保两条路径写入同一 Session_State 真相源,不产生第二套推演状态
6. THE Session_Driver 的再入终止条件 SHALL 与需求 1 一致(覆盖率充分、BUDGET 上限、No_Progress、maxRepeat 守卫)

### 需求 3:LLM_Router 净增量(routerModel / 收敛信号 / 覆盖率摘要)

**User Story:** 作为推演引擎,我需要在已落地 R1 路由(校验 / 失败降级 / DLEDGER source 已就绪)之上补齐三项小增量,以便路由更省成本、更准确地优先处理 required gap,并以机械方式区分收敛与非法。

> 已落地(R1,本需求不重新实现):`executeOrchestratePlan()` 已具备状态摘要入参、`validateProposedPlan()` 校验、`maxCapabilityRunsPerTurn` 钳制、无 key/超时/抛错/空响应的 `heuristicFallback` 优雅降级,以及 DLEDGER `source` 标注。下列验收标准仅覆盖净增量。

#### 验收标准

1. THE LLM_Router SHALL 使用 `config.routerModel` 指定的低成本/更快模型进行路由决策;WHERE `config.routerModel` 未配置,THE LLM_Router SHALL 回退到主模型 `config.model`
2. WHEN LLM_Router 组装路由 prompt 时,THE LLM_Router SHALL 在 prompt 中注入 Coverage_Contract 的 required 与 conditional 能力摘要
3. THE 路由 JSON 契约 SHALL 新增可选布尔字段 `converged`;THE 路由 system prompt SHALL 指示模型「确认无需更多推演步骤时返回 `{"selected": [], "converged": true, "rationale": ...}`」;WHEN 响应满足机械谓词 `selected.length === 0 && converged === true` 时,THE LLM_Router SHALL 将其作为 Convergence_Signal 透传给 Session_Driver,而非降级为 `invalid_proposal`;THE 判定 SHALL NOT 依赖对 rationale 文本的语义解读【修订 B】
4. THE LLM_Router 区分 Convergence_Signal 与 `invalid_proposal` 的逻辑 SHALL 保持既有失败降级路径不变(无 key/超时/抛错/空响应/非法 proposal、以及 `selected: []` 但 `converged !== true` 的空提案,仍回退启发式)【修订 B】

### 需求 4(已删除 / 与 R2 as-built 对账)

> **删除说明(保留编号占位以维持后续编号稳定)**:原需求 4 要求把 `counter.argue` 作为单一「批判性思考者」提示词执行。as-built 中 `server/whybuddy/deliberation-exec-map.ts` 已把 `counter.argue`(连同 `critique.generate`、`rebuttal.resolve`、`synthesis.merge`)路由进 R2 brainstorm mini-session 协商引擎并经真实 adjudicator 裁决。若保留单提示词需求,会把真实协商回退为 LLM 角色扮演,**构成对 R2 的回退**。`counter.argue` 的行为约束统一由需求 8(R2 协商引擎复用)承载。

### 需求 5:evidence.search 提示词与范围边界(F1 GitHub 开口)

**User Story:** 作为推演引擎,我需要 evidence.search 能力使用专属 LLM 提示词综合证据,同时明确其联网边界为「不做任意网页浏览/RAG,但允许已落地的 F1 GitHub 取数」。

> 已落地(D1/F1,本需求保持不回退):`evidence.search` 已有专属证据检索提示词,产物 `provenance` 已为 `"llm"` 并经 `evaluateGates()`;`capability-exec-map.ts` + `repo-static-analyzer.ts` 已对 `raw.githubusercontent.com` / `api.github.com` 做真实取数。

#### 验收标准

1. WHEN evidence.search 能力被执行时,THE CapabilityExecutor SHALL 继续使用专属的证据检索系统提示词(角色为研究员,基于 goal 与已有 artifacts 综合相关约束、先例、技术限制)
2. THE evidence.search 执行结果 SHALL 标注证据来源(从已有 artifacts 综合、F1_Github_Source 取数,或模型知识推理)
3. THE evidence.search 产物的 provenance SHALL 保持为 `"llm"` 并通过现有 `evaluateGates()` 信任层验证
4. THE evidence.search SHALL NOT 执行任意网页浏览或向量库 RAG 检索
5. WHERE 会话上下文(goal/conversation/artifacts)中存在可识别的 `github.com/owner/repo` 线索,THE evidence.search SHALL 允许经已落地的 F1_Github_Source 路径发起对 `raw.githubusercontent.com` / `api.github.com` 的真实取数(此路径为需求 5.4 边界的显式开口)
6. IF F1_Github_Source 取数失败或无可识别 GitHub 线索,THEN THE CapabilityExecutor SHALL 优雅降级为会话内材料综合,且本轮不引入新的外部证据

### 需求 6:synthesis.merge 经 R2 协商引擎执行

**User Story:** 作为推演引擎,我需要 synthesis.merge 作为 R2 协商引擎的综合环节运行,以便将多方论点经真实裁决与综合合并为连贯结论,而非退化为单一通用提示词。

> 与 R2 as-built 对齐:`synthesis.merge` 已属 `deliberation-exec-map.ts` 的 `DELIBERATION_CAPABILITIES`,经 mini-session 协商 + `BrainstormSynthesizer` + `auditSynthesis` 产出。本需求确保该路径不被回退为单提示词综合。

#### 验收标准

1. WHEN synthesis.merge 能力被执行时,THE R2_Deliberation_Engine SHALL 经 mini-session 协商与综合器(synthesizer)合并多方论点,而非以单一通用提示词执行
2. THE synthesis.merge 执行结果 SHALL 将所有相关上游产物 ID 包含在 inputArtifactIds 中(多输入合并)
3. THE synthesis.merge 产物的 provenance SHALL 设为 `"llm"` 并通过现有 `evaluateGates()` 信任层验证
4. WHEN synthesis.merge 综合多角色论点时,THE R2_Deliberation_Engine SHALL 在综合输出中标注共识与分歧
5. THE spec SHALL NOT 为 synthesis.merge 引入独立于 R2_Deliberation_Engine 的第二条综合路径

### 需求 7:report.write 九段式结构(保持不回退)

**User Story:** 作为推演引擎,我需要 report.write 继续以九段式结构输出引用全部上游产物的报告,以便交付物结构稳定且可被既有渲染消费。

> 已落地(D1,本需求保持不回退):`report.write` 已有专属报告提示词,已以 `buildStructuredReport()` 九段式骨架为权威基底,产物 `provenance` 为 `"llm"` 并经 `evaluateGates()`。

#### 验收标准

1. THE report.write 产物的内容结构 SHALL 继续与现有 `buildStructuredReport()` 的九段式格式兼容
2. THE report.write 执行结果 SHALL 继续引用所有上游 artifacts(risk、counter、evidence、synthesis)的 ID 并在报告正文中标注来源
3. THE report.write 产物的 provenance SHALL 保持为 `"llm"` 并通过现有 `evaluateGates()` 信任层验证

### 需求 8:R2 协商引擎复用与范围边界

**User Story:** 作为推演引擎,我需要协商类能力继续运行在已落地的 R2 多 Agent 协商引擎上,以便辩论是真实的(含 adjudicator 裁决),而不是用单 Agent 角色扮演复刻一套并行的 brainstorm 路径。

> 与 R2 as-built 对齐:`deliberation-exec-map.ts` 已把四个 Deliberation_Capabilities 路由进 brainstorm mini-session,经 `executeDeliberation` + `createAdjudicator` 裁决。本需求约束本 spec 不偏离该路径。

#### 验收标准

1. WHEN `counter.argue`、`critique.generate`、`rebuttal.resolve`、`synthesis.merge` 之一被分派执行时,THE 系统 SHALL 经 R2_Deliberation_Engine(`deliberation-exec-map.ts` 的 mini-session 协商 + 真实 adjudicator)执行该能力
2. THE spec SHALL NOT 引入第二条基于 `wrapStageWithBrainstorm` 的 brainstorm 路径来承载上述 Deliberation_Capabilities
3. THE spec SHALL NOT 引入复刻 R2 路由的 `decideBrainstormPath` / D_GATE 能力白名单
4. THE `risk.analyze` 的多角色协商升级 SHALL 被排除出本 spec 范围(推迟到独立的 S10+ 努力)
5. IF R2_Deliberation_Engine 执行超时或失败,THEN THE 系统 SHALL 经既有降级路径返回结果并标注 `degraded` 与 `degradedReason`(不抛错)

### 需求 9:流边界守卫实体化

**User Story:** 作为推演引擎,我需要实体化流边界守卫(FLOWB),以便协商协议内容(critique/rebuttal/debate)不进入正式 STATE/BOARD。

#### 验收标准

1. WHEN R2_Deliberation_Engine 的协商产出经过 FLOWB 时,THE FLOWB SHALL 剥离所有辩论协议节点(包含 critique:、rebuttal:、debate:、challengeEdges、role vote、brainstorm console、brainstorm: 标记的行)
2. THE FLOWB 处理后的产物 SHALL 不包含任何辩论协议节点(剥离后协议节点数量为零)
3. THE FLOWB SHALL 在每次处理后生成 `FlowBoundaryCheck` 记录并写入台账(T_LEDGER)
4. WHILE 辩论协议内容被从正式产物中剥离,THE 3D 辩论墙可视化 SHALL 仍可访问完整的 debate 内容(守卫只管正式路径,不管辩论自身的可视化)
5. THE 现有 `sanitizeThroughFlowBoundary()` 函数 SHALL 处理来自 brainstorm 和 discussion 来源的内容
6. THE FLOWB SHALL **仅**处理产物的 `content` 字符串;`artifact.payload`(含 R2 结构化 Critique/Rebuttal/Adjudication 数据,为 S10 折叠讨论块的数据源)SHALL NOT 被 FLOWB 剥离、修改或置空【修订 C】

### 需求 10:能力执行器统一 provenance 与依赖图(保持不回退)

**User Story:** 作为推演引擎的信任层,我需要所有 LLM 执行的能力产物正确设置 provenance 并维护准确的依赖图。

> 已落地(R1/D1,本需求保持不回退):现有 CapabilityExecutor 已对 LLM 能力产物标注 `provenance: "llm"`,经 `findInputsForCapability()` 解析依赖,并经 `commitArtifact` → `evaluateGates()`。

#### 验收标准

1. THE CapabilityExecutor 对所有 LLM 执行的能力 SHALL 将产物 provenance 设为 `"llm"`(不为 `"template"`)
2. WHEN 一个能力依赖上游产物时,THE CapabilityExecutor SHALL 通过 `findInputsForCapability()` 正确解析 inputArtifactIds 并传入执行上下文
3. THE 产物提交路径(commitArtifact)SHALL 继续经过 `evaluateGates()`,LLM 产出的真实内容不绕过信任闸
4. WHEN 上游产物处于 stale 状态时,THE CapabilityExecutor SHALL 在执行上下文中标注此信息,使 LLM 能感知过期风险

### 需求 11:orchestrate.plan 独立成本归因(已落地,保持不回退)【修订 H】

**User Story:** 作为系统运维者,我需要 LLM 路由(orchestrate.plan)的 token 消耗在成本台账中独立归因,以便分别回答「路由花了多少」与「能力执行花了多少」。

> 已落地(本需求**整体**保持不回退):`useWhyBuddySession.ts:361` 已以 `capabilityId: "orchestrate.plan"` 经 `recordCapabilityRunCost` 归因路由成本,既有 B9 测试断言其落入 costLedger;摘要压缩(仅 id/kind/summary)亦已落地。下列验收标准全部为**防回归**约束,对应任务为验证任务而非构建任务。

#### 验收标准

1. WHEN LLM_Router 完成一次带 usage 的路由调用时,THE 系统 SHALL 在 costLedger 中以独立的 `capabilityId: "orchestrate.plan"` 归因该次路由成本
2. THE costLedger SHALL 使路由成本桶(`orchestrate.plan`)与能力执行成本桶互不重叠,从而可分别求和
3. THE LLM_Router SHALL 继续将会话状态摘要压缩为精简格式传入(仅 ID/kind/summary,不传完整 artifact content)

### 需求 12:路由器 DLEDGER 审计集成(保持不回退)

**User Story:** 作为审计追溯者,我需要 LLM 路由器的每次决策完整记录在 DLEDGER 中,以便事后 challenge 路由选择。

> 已落地(R1,本需求保持不回退):`orchestrateReasoningTurn` 已写入带 `source` 的 DLEDGER 记录并支持 challenge 重排程。

#### 验收标准

1. WHEN LLM_Router 产出 proposedPlan 时,THE DLEDGER SHALL 记录 `{ saw, chose, skipped+reason, addresses[gapId], rationale, alternativesRejected, source }`
2. WHEN LLM_Router 回退到启发式时,THE DLEDGER SHALL 记录 `source: "local_heuristic"` 并在 rationale 中说明回退原因
3. THE DLEDGER 中的 LLM_Router 决策记录 SHALL 可被 `UserIntervention{ intent: "challenge", targetDecisionId }` 指向,触发 gap 重开与重排程

### 需求 13:确定性可测试性

**User Story:** 作为引擎的测试维护者,我需要所有 LLM 能力执行与 LLM_Router 都支持注入确定性替身,以便现有 vitest + fast-check 确定性测试套件无需真实 LLM 调用即可验证调度、依赖图、provenance 与信任闸行为,且引入真实 LLM 不破坏既有测试基线。

#### 验收标准

1. THE 所有 LLM 能力执行(CapabilityExecutor)与 LLM_Router SHALL 支持注入 Deterministic_Provider(mock/确定性提供器),使测试无需真实 LLM 调用
2. WHEN 注入 Deterministic_Provider 时,THE 现有 vitest + fast-check 确定性测试套件 SHALL 能验证调度(能力选取与再入)、依赖图(inputArtifactIds 解析)、provenance(`"llm"` 标注)与信任闸(`evaluateGates()`)行为
3. WHEN `BUILD_TARGET=test` 时,THE 系统 SHALL 默认装配 Deterministic_Provider 进行 LLM_Router 路由与能力执行
4. THE 引入真实 LLM 路由/执行 SHALL NOT 破坏现有确定性 executor 测试基线(既有测试在默认确定性提供器下继续通过)
5. WHERE 测试需要真实 LLM 行为,THE 测试 SHALL 通过显式注入或显式开关启用真实提供器,而非改变默认确定性装配

### 需求 14:Session_Driver 多轮 turn 时间线投影升级(S9 净增量)

**User Story:** 作为用户,我希望在 Session_Driver 让单条消息跑 N 轮 planning+reasoning 时,时间线如实呈现 N 轮序列(planning₁→reasoning₁→planning₂→reasoning₂…),而不是只显示一个规划站点,从而诚实反映每个 turn 的真实推演轮数。

> 已落地(S9,本需求扩展不回退):`shared/blueprint/whybuddy-turn-route.ts` 的 `deriveTurnRoute` 已从运行时事实派生 turn 站点,且为零 LLM、零 Session_State 写入;`assertRouteCopySanitized` 保证文案无禁用术语;`buildRouteSummary` 折叠态摘要与展开态站点 token 一致。

#### 验收标准

1. WHEN Session_Driver 在单个用户 turn 内执行 N 轮(N ≥ 1)planning+reasoning 时,THE Turn_Route_Projection SHALL 为每一轮派生一对站点(planning 站点 + reasoning/execution 站点),并按 planning₁ → reasoning₁ → planning₂ → reasoning₂ … → planningN → reasoningN 顺序排列
2. THE Turn_Route_Projection SHALL 保持既有投影不变量:不调用 LLM,且不写入 V5SessionState
3. THE Turn_Route_Projection 生成的所有站点文案 SHALL 继续通过 `assertRouteCopySanitized`(不含禁用术语)
4. THE 折叠态摘要(`buildRouteSummary`)SHALL 与展开态站点 token 保持一致(投影一致性不变量在多轮下仍成立)
5. THE 每轮派生的站点 id SHALL 形如 `${turnId}-…` 且跨轮稳定不重复(与 Session_Driver 的 `${turnId}-run-${i}` / 每轮派生标识兼容)
6. WHERE 某一轮因预算拦截或 Convergence_Signal 终止再入,THE Turn_Route_Projection SHALL 在该轮位置反映停泊原因,而非继续追加后续轮次站点
7. THE 多轮投影的**采集端与渲染端** SHALL 被本 spec 认领:`useWhyBuddySession` SHALL 按轮采集 round facts(planSelectedCount / planSource / planReason / parkReason 等);`TurnRouteTimeline` SHALL 渲染多轮序列;产品页渲染接线与任务 4.3 共用 F0.1 硬前置,dev 页可先行【修订 D】