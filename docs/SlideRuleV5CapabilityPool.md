# SlideRule V5 Capability Pool（能力池定型说明文档）

> **改名注记**：本产品原名 **WhyBuddy**，2026-06 全量改名为 **SlideRule**；本文档历史正文中的产品名已机械同步，git 历史保留旧名原貌。

**版本**：v2.0（V5）— 在 v1.0（V4 觉察版）基础上修订
**目的**：把"目标驱动的能力调用网络"从原则正式定型为可实现的运行时模型；并修掉 v1.0 的 5 处问题（内部矛盾 1 处 + 欠规格 4 处）。
**核心判断标准**：所有代码/UI/调度/文档决策，先问两句——
1. "这是业务真实依赖，还是旧 pipeline 惯性？"（防旧失效模式）
2. "出来的东西过 gate、带 provenance、进台账了吗，还是 LLM 自由发挥？"（防新失效模式）

---

## v2.0（V5）相对 v1.0（V4）改了什么

| # | 原问题 | 本版修法 | 落在 |
|---|--------|----------|------|
| 1 | §5 交互布局有常驻"活报告"面板，跟"画面临时，状态常驻"自相矛盾 | 删除常驻报告面板；屏幕唯一常驻只剩顶部状态条；报告/图/方案/预览全走内联临时黑板 + 按需 pin | §5 |
| 2 | gate/provenance 写在原则里，没进运行时 schema | Artifact 带 `provenance` + `trustLevel`；SessionState 带 `gates`；CapabilityRun 记录 gate 结果；明确 gate 分"前置闸"与"提交闸" | §3 |
| 3 | 失效/重算引擎被当成"旧物料复用"，没进主循环 | 失效引擎升为一等公民：UserIntervention + 上游变更直接触发失效级联 → 重新调度，写进 `orchestrateReasoningTurn` 主循环 | §3、§6 |
| 4 | "角色池"与"能力池"关系未定义，可能变成两套打架的调度 | 定死：调度单元是 `(capability, role)` 对；角色是能力运行时所处视角，不是独立调度 | §1、§2.1 |
| 5 | §7 checklist 只防"旧 pipeline 惯性"一个方向 | 补反向条目，防"自由编排一锅汤"（无 gate 结论、无 provenance 图当证据、LLM 替代确定性闸） | §7 |

---

## 1. 核心原则

V5 **不是** 固定阶段流水线。V5 **是** 目标驱动的能力调用网络（target-driven capability scheduling network）。

- 所有旧"阶段"都是能力池中的**能力包**，平权、无固定顺序，可按需/反复/交叉/回溯调用。
- 控制平面从 `runNextStage(currentStage)` 升级为 `orchestrateReasoningTurn(state)` / `pickNextCapabilities(...)`。
- 旧 stage 字面量保留，但**仅作为** UI grouping / artifact family / history label / compatibility layer。

**真实运行时（V5 闭环，已修正分层）**：

```
聊天框（操纵杆）/ UserIntervention
        ↓ 灌 goal · 质疑 · 关注点
推演调度核 Orchestrator  ⇄  常驻推演状态 Reasoning State（单一真相）
        ↓ 选 (capability, role) 对
能力池 Capability Pool（平权能力）
        ↓ 产物
信任层 Trust Layer：二元闸 → provenance → 台账（必经，过了才进状态）
        ↓ 可信产物
常驻推演状态（reasoning graph / artifacts / capabilityRuns）
        ↓
可行性报告 / 产品推演报告（主输出）→（可选）SPEC/工程
        ↺ 用户介入 / 上游变更 → 失效级联 → 重新调度（重入）
```

**产品原则（后续所有决策的判断基线）**：
1. 主入口是聊天框（操纵杆），不是阶段向导。
2. 聊天框是操纵杆，不是结果容器。
3. 所有输出都是 artifact：可寻址、可质疑、可追溯、带 provenance + trustLevel。
4. 旧阶段全部降级为能力池里的能力包。
5. 用户可随时要求澄清/反驳/重做/预览/出方案/出报告，或针对任意节点/段落继续。
6. 系统不推进阶段，只推进推演状态 + capabilityRuns。
7. V5 闭环图是控制平面，UI 只是它的可操作外壳。
8. **画面临时，状态常驻**：黑板（图/报告/方案）可随聊天流滚走，但 reasoning graph、capabilityRun 历史、节点/边/证据必须能被找回。
9. 自由的是"whether / when / 顺序"，不自由的是"出来的东西必须可信"（gate、provenance、台账、确定性渲染）。

**一句话**：阶段不是流程，阶段是能力。V5 的核心是围绕一个目标动态调用能力池，完成多 Agent 推演、证明与收敛，且每一步产物都被信任层按住。

### 2.1（修复 #4）角色与能力的关系

- 调度单元 = `(capability, role)` 对。例：`risk.analyze × 安全 Agent`、`route.compare × 架构 Agent`。
- 角色（产品/架构/安全/合规/工程/挑刺/接地/综合）是**能力运行时所处的视角**，决定 prompt 立场、评判标准、证据偏好。
- orchestrator 只有**一套调度**：它选的是 `(capability, role)` 对。debate 不是另一条独立控制流，而是"同一能力（如 counter.argue / critique）由不同角色多次运行 + synthesis.merge 收敛"。
- 这样避免"capability 循环"和"agent 辩论循环"互相打架。

---

## 2. 旧 Stage → 新 Capability 映射

| 旧 Stage | 新能力包（V5CapabilityId 示例） | 何时可被调用（非穷举） |
|----------|--------------------------------|------------------------|
| Input / Intake | intent.parse, context.collect, source.classify | 初始输入、补充上下文、发现歧义、报告前对齐 |
| Clarification | intent.clarify, gap.ask, assumption.validate, question.expand | 目标含糊、意图冲突、证据不足、结论需补边界、出 SPEC/Docs/Preview 前确认约束 |
| Route Planning / Selection | route.generate, route.compare, tradeoff.evaluate | 多路线、提替代方案、路线风险过高、报告需 A/B/C、落地前比成本 |
| SPEC Tree | structure.decompose, capability.map, dependency.tree | 拆能力树/风险验证树/模块树/论证树/任务依赖树（**不必只在 route 之后，也可不出**） |
| SPEC Docs | document.draft, requirement/design/task.write | 从 Tree、可行性报告、路线对比、风险分析、预览、用户决策等多源生成（**不限于由 Tree 推导**） |
| Effect Preview | scenario.simulate, ux.preview, outcome.visualize | 路线对比预览、意图不清时反向澄清、报告中展示推荐、反驳时展示失败效果（**随时可用**） |
| Prompt Pack | instruction.package, execution.prepare | 需把推演结果打包成可执行指令时 |
| Brainstorm / Debate | argument.expand, critique.generate, rebuttal.resolve, synthesis.merge | 发散/挑刺/反驳/收敛时 |
| 通用常驻 | evidence.search, repo.inspect, mcp.call, skill.invoke, risk.analyze, counter.argue, memory.recall, report.write | 证据不足、需外部信息、调工具、分析风险、反驳、记忆、生成报告时 |

注：`repo.inspect`（GitHub 深度解析）只是 `evidence.search` 家族里的一种证据源，不再是入口门槛。

---

## 3. 动态调度模型（已补 gate / provenance / 失效）

### 3.1 数据结构（修复 #2）

```ts
// 每个产物都带可信度与出处
interface Artifact {
  id: string;
  kind: "clarification" | "route_options" | "spec_tree" | "doc"
      | "preview" | "evidence" | "risk" | "decision" | "report" | "plan";
  provenance: "ai_generated" | "rendered_chart_mcp" | "rendered_screenshot"
            | "llm" | "llm_fallback" | "template";
  trustLevel: "untrusted" | "gated_pass" | "audited";  // 只有 gated_pass/audited 才能被报告引用为"已证明"
  producedBy: { capabilityRunId: string; capabilityId: string; roleId?: string };
  passedGates: string[];
  evidenceRefs?: string[];
}

interface GateState {
  gateId: "schema" | "invariant" | "confirm" | "decision" | "merge" | "previews_real";
  kind: "precondition" | "commit";   // 运行前置闸 or 产物提交闸
  status: "open" | "passed" | "failed";
  evaluatedAt?: string;
}

interface CapabilityRun {
  id: string;
  capabilityId: V5CapabilityId;
  roleId?: string;                              // (capability, role) 对
  inputs: string[];                             // 依赖的 artifactId
  outputs: string[];                            // 产出的 artifactId
  gateResults: { gateId: string; status: "passed" | "failed" }[];
  ledgerEntryId?: string;                       // 台账留痕
  turnId: string;
}

interface V5SessionState {
  goal: GoalState;
  graph: ReasoningGraph;                        // capability invocation graph
  artifacts: Artifact[];
  conversation: ChatTurn[];
  openQuestions: Question[];
  evidence: EvidenceItem[];
  decisions: Decision[];
  risks: Risk[];
  capabilityRuns: CapabilityRun[];
  gates: GateState[];                           // ← v5 新增：闸进入运行时状态
  dependencyGraph: DependencyEdge[];            // ← v5 新增：失效级联用
  staleArtifactIds: string[];                   // ← v5 新增：被失效引擎标记
  currentFocus?: FocusTarget;
  userIntervention?: UserIntervention;
}

interface UserIntervention {
  targetArtifactId?: string;
  targetNodeId?: string;
  targetReportSectionId?: string;
  intent: "challenge" | "clarify" | "expand" | "synthesize"
        | "generate_plan" | "preview" | "compare" | "revise";
  text: string;
}
```

### 3.2 主循环（修复 #3：失效引擎是一等公民）

```ts
function orchestrateReasoningTurn(state: V5SessionState): TurnPlan {
  // 0. 先吃用户介入 + 上游变更 → 失效级联（这就是"回到第二步"的机制，写进主循环而非旁路）
  const stale = invalidate(state);              // 标记 staleArtifactIds，沿 dependencyGraph 级联
  // 1. 读 gate 前置条件，过滤掉当前不可运行的能力
  const runnable = capabilities.filter(c => preconditionsMet(c, state));
  // 2. 按 goal / gaps / 角色分歧 / stale，选下一组 (capability, role) 对
  const selected = pick(runnable, state.goal, gapsOf(state), votesOf(state), stale);
  return { selected, reason, expectedArtifacts };
}

// 任何能力产物入状态前，必经提交闸 + provenance 标记 + 台账留痕
function commitArtifact(a: Artifact, run: CapabilityRun, state: V5SessionState) {
  const gate = evaluateCommitGate(a, run);      // 二元、机械可执行
  ledger.record(run, gate);                     // 真跑留痕（问责中枢）
  if (gate.status !== "passed") return reject(a); // 未过 → 打回重出，不进状态
  a.trustLevel = isRendered(a.provenance) ? "audited" : "gated_pass";
  state.artifacts.push(a);
}
```

**运行时行为**：
- 不是 stage machine，而是**可重入推演图遍历**。
- 任何能力在任何时候都可被调用，受**真实数据依赖 + gate 前置**限制，而非"必须先 A 再 B"的惯性。
- 用户输入 = 给当前推演状态**追加一个控制信号**（改目标/约束/关注点/质疑/输出形式）。
- 聊天 = 操纵杆；每条消息都可能触发新一轮 `orchestrateReasoningTurn`。

---

## 4. 输出物定位

- **Reasoning Graph**：capability invocation graph；节点/边带 `capabilityId · roleId · turnId · provenance`。
- **SPEC Tree**：任意时刻可调用的树状分解结果，不是固定"第三阶段"。
- **SPEC Docs**：文档生成能力输出，可从多源触发。
- **Effect Preview**：任意时刻可调用的假设验证/可视化能力。
- **Feasibility Report / 产品推演报告**：V5 主输出物，汇总本轮调用了哪些能力、各自贡献、Agent 支持/反对、引用证据、未解决风险、如何收敛。报告引用的每个产物都必须 `trustLevel ∈ {gated_pass, audited}`。
- 所有真 artifact 必经 **gate → provenance → 台账**；黑板可临时出现，内容不能假。

---

## 5. 交互形态（修复 #1：去掉常驻报告面板）

唯一常驻的是顶部状态条；其余全部内联临时 + 按需 pin。

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部状态条（唯一常驻）：目标 · 结论状态 · 可信度 · 轮次 · 已调用能力 │
├──────────────────────────────────────────────────────────────┤
│ 聊天流（操纵杆 + 内联临时黑板）                                   │
│   · 用户输入 / 多 Agent 回复                                     │
│   · 多 Agent 讨论摘要（桌子 + 黑板：皮可玩，黑板内容必须真）        │
│   · 结构化图（节点可点击、可寻址）                                │
│   · 报告段 / 工程方案 / 预览 / 树 —— 出现在产生它的那一轮          │
│   · 任意黑板可"pin"到侧边（按需 · 非常驻）                        │
└──────────────────────────────────────────────────────────────┘
说明：没有常驻"活报告"面板。报告本身也是聊天流里的一个 artifact；
想随时看就按需 pin，不 pin 就随流滚走——但它在状态里一直存在、可被找回。
```

用户不点"下一步"，而是说："这段权限模型我不满意"／"为什么不用 ABAC"／"把这部分出个工程方案"／"让安全 Agent 再反驳一轮"／"先别出 Tree，先给我可行性报告"。系统把这些变成 `UserIntervention`，经失效级联驱动新一轮调度。

---

## 6. 实施路线（克制版：先重解释，再换控制平面）

**第一步（当前）**：本文档锁死新原则，后续工作必须引用。

**第二步（小步代码，不碰老页面）**：
1. shared 新增 `V5CapabilityId` union + `STAGE_TO_CAPABILITIES` 映射（旧字面量不变）。
2. ReasoningGraph 的 Node/Edge 加 `capabilityId · roleId`（additive）。
3. Artifact 加 `provenance · trustLevel`；SessionState 加 `gates · dependencyGraph · staleArtifactIds`（additive）。
4. 现有代码（PetWorkers、BlueprintRuntimeAgents、AutopilotRoutePage、右栏）加注释："activeStage 现在是 legacy 标签，真实调度权在 orchestrator"。
5. 报告/右栏按 capabilityRun 维度总结（而非只按 stage）。
6. 做 v5-workspace dev harness：聊天 + 动态 artifact + fixture 驱动"输入 → 多 Agent 讨论 → 报告 → 用户质疑 → 失效 → 重新调度"循环。**harness 必须跑通 gate 失败打回 + 失效级联重算两条路径**，别只验 happy path。

**第三步**：
- 引入真正的 `orchestrateReasoningTurn` / `pickNextCapabilities`（先 server/lib 薄实现），把 `invalidate()` 接进主循环。
- 把现有 stage gating 降级为"默认呈现分组"。
- 旧能力逐个挂进能力池。

**物料保守，控制激进**：底层（reasoning graph、角色池、evidence/risk/decision/gap、gates、2D map、debate 协议、三级 provenance、QA ledger、失效重算引擎）直接复用、重挂接；只有"谁决定下一步"（stage sequencer → orchestrator）这次激进换。失效重算引擎从"旁路复用"升为"主循环组件"。

---

## 7. 判断 checklist（双向）

### A. 防旧失效模式（pipeline 惯性）—— 出现即打回
- "必须先 route selection 才能 spec tree"
- "必须先 spec tree 才能 spec docs"
- "必须最后才能 effect preview"
- UI 出现"Step X / Y" + "下一步"按钮作为主节奏
- 3D 场景/wall 只按 stage 呈现，而非按当前活跃 capability set
- 报告只按阶段总结，而非按 capabilityRun 总结
- 出现常驻"活报告/活面板"作为主屏（违反"画面临时"）

### B. 防新失效模式（自由编排一锅汤）—— 出现即打回（修复 #5）
- 结论被标"已证明"，但其引用产物 `trustLevel` 仍是 `untrusted`（没过 gate）
- 拿 `ai_generated` / 无 provenance 的图当证据或当已验证产物
- 用 LLM 自然语言判断替代确定性 gate 判定（gate 必须二元、机械可执行）
- 黑板上现画一张装饰性讨论图冒充结构化 artifact（皮可假，黑板内容不可假）
- 能力产物绕过 `commitArtifact` 的提交闸直接进状态
- orchestrator 把"角色辩论"另立成第二套调度（违反 (capability, role) 单一调度）

**真实依赖 vs 惯性**：真实依赖 = 没有 route comparison 的结果就没法写基于它的 spec doc（数据依赖 + gate）；惯性 = 因为 UI 按顺序画，所以"看起来"必须先 Tree 再 Docs。

---

本文档放在 V5 架构图旁边（`docs/assets/SlideRuleArc/`）。任何实现/UI/调度改动，先读本文档并回答：
1. 这个改动强化了能力池调度，还是又在强化旧阶段流水线？
2. 它产出的东西过 gate、带 provenance、进台账了吗？

**阶段不是流程，阶段是能力。V5 的核心是围绕一个目标动态调用能力池，完成多 Agent 推演、证明与收敛，且每一步产物都被信任层按住。**
