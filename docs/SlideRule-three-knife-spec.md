# SlideRule V5.1 — 三刀 Spec:让推演图「枝繁叶茂 + 走到终点」

> **改名注记**：本产品原名 **WhyBuddy**，2026-06 全量改名为 **SlideRule**；本文档历史正文中的产品名已机械同步，git 历史保留旧名原貌。

> **修订说明 (v2)**：对照 `main` 代码库校正前提。Knife A 从「补调度入口」收窄为「扩关键词 + 健康去重 + 分 executor 集成」；Knife B/C 修正数据源与组件选型。见文末「代码基线」。
>
> 目标:把当前「节点少、停在画布卡片、没有最终交付月台」的观感,补齐为 V5.1 架构图 03/07 段应有的完整呈现与链路。
> 三刀共用一条原则:**底层信任脊柱一行不动,只补"调度可达性"和"呈现密度"。** 不改 GCOV/BUDGET/T_GATE/单写者,不破坏"够了就停"。
> 方法论:bug-condition。每刀 = 一个 C(X) + 探索测试(必败)+ 保全测试(必过)+ 修复 + 翻转。

---

## 总览:三刀分工

| 刀 | 名称 | 性质 | 改动面 | C(X) 一句话 |
|---|---|---|---|---|
| **Knife A′** | 结构拆解调度补全 | runtime 调度 | `shared/blueprint/sliderule-pick-heuristic.ts` | 关键词覆盖不全 + 无健康 spec_tree 去重 → 部分拆解意图漏排或重复排；执行器路径分裂导致「排了但链质量不一致」 |
| **Knife B** | 子步铺开为节点 | 呈现层 | `derive-reasoning-view-model` + `ReasoningFlowSurface` | 推理过程在 UI 层可见(当轮 steps / 历史 ledger),但投影层 1 capability ≈ 1 节点 + 5 行 clamp → 图稀疏、过程不可见 |
| **Knife C** | 终点交付月台 | 呈现层 | 虚拟终点节点 + `SlideRuleReportReader` + md 导出 | clear 后报告只是被裁切的小卡片,无固定终点节点、无报告全文视图、无交付导出 → 用户"摸不到最终结果" |

依赖:A′ 独立;B 独立;C 独立(`buildStructuredReport` 当前不依赖 spec_tree,有 tree 时报告可**可选增强**章节结构,无 tree 须兜底)。

---

## 代码基线(审查时快照)

实施前以仓库为准;下列为 v2 撰写时的**已存在**能力,避免重复造轮子:

| 能力 | 位置 | 状态 |
|---|---|---|
| pick 含 `structure.decompose` | `sliderule-pick-heuristic.ts` L117–119(`树/拆解/spec tree`);L145–148(`openQCount>0`);S19 `pickStructureBeforeDelivery` | ✅ 已有 |
| S13 pick 绿灯测试 | `sliderule-runtime.fullpath-structure.test.ts` | ✅ 已有 |
| 服务端 structure 全链 | `structure-exec-map.ts` + `sliderule-structure-chain.ts` | ✅ 已有 |
| pilot/demo 模拟拆解 | `sliderule-runtime.ts` `simulateCapabilityExecution` L1351+ | ✅ 模板树,非 LLM 链 |
| GCOV complex required | `authorCoverageContract` → `risk.analyze / evidence.search / report.write` | ❌ **不含** `structure.decompose` |
| 5 行卡片 clamp | `ReasoningFlowSurface.tsx` `FLOW_MAX_LINES = 5` | ✅ |
| `latestTrustedReport` / `replayCoverage` | `sliderule-delivery-chain.ts` / `sliderule-fullpath-fixtures.ts` | ✅ |
| nl-command `ReportView` | `components/nl-command/ReportView.tsx` | ⚠️ 绑定 `ExecutionReport`,**不可**直接用于 SlideRule |

---

# Knife A′ — 结构拆解调度补全(runtime)

## 背景纠正(v2)

前序审计有两处需同时纠正:

1. **「结构拆解链未接入」不准确** — 服务端 S13–S14 全链与 client commit 时 `structureGateLedger` 写入均已就绪。
2. **「pickNext 永不排 structure.decompose」已过时** — 实现已迁至 `shared/blueprint/sliderule-pick-heuristic.ts`,且 `sliderule-runtime.fullpath-structure.test.ts` 对「拆解成 SPEC Tree」已绿灯。

**v2 真缺口**:

| 缺口 | 说明 |
|---|---|
| **关键词漏排** | 现仅匹配 `树 / 拆解 / spec tree`(小写)。`结构 / 分解 / tree / SPEC Tree`(大小写)等意图可能不进 picks。 |
| **健康去重缺失** | `hasReport` 有「已有健康 report 不重复排」语义;`structure.decompose` 无对等 `hasSpecTree` 判断,可能重复排。 |
| **合约缺口驱动不成立** | `authorCoverageContract` **未**把 `structure.decompose` 列入 required;**不得**在本刀顺带改 GCOV(违反「脊柱不动」)。 |
| **执行器路径分裂** | `server-llm` 走 `structure-exec-map`(真 LLM + gateLedger);`pilot/demo` 走 `simulateCapabilityExecution` 模板树。集成测试须分模式断言。 |
| **「排了 ≠ 看得见链」** | `C_PROMPT→…→C_TREE` 六七个过程节点属于 **Knife B** 投影范畴,单做 A′ 画布仍可能只有 1 个 capability 主节点。 |

## Bug Condition C_A(X)

存在 `(state, userText)` 使:

- `userText` 含结构拆解意图,命中 v2 扩展正则 `/结构|分解|decompose|spec\s*tree|tree/i`,**且**当前 pick 关键词段**未**覆盖该子串;或
- 已有健康(非 stale 且 `gated_pass|audited`)的 `spec_tree` 产物,用户再次发拆解意图,但 picks **仍含** `structure.decompose`(应去重);

然而行为与 Expected 不符。

**明确排除(不属于 C_A)**: `userText` 仅含「拆解」且已被现有 `lower.includes("拆解")` 覆盖 — 这类场景**已绿**,探索测试不得再标为必败。

## Expected Behavior

- 关键词段扩展:在现有 `树/拆解/spec tree` 旁,增加 `结构 / 分解 / decompose / tree`(及 `spec tree` 大小写不敏感),命中 → `structure.decompose × 架构` 进 picks。
- 健康去重:新增 `hasSpecTree`(`kind === "spec_tree"` + `isHealthyArtifact`),与 `hasReport` 同构 — 已有健康 spec_tree 时,**不因**拆解关键词再排 `structure.decompose`(S19 `pickStructureBeforeDelivery` 已有类似逻辑,keyword 段须对齐)。
- 排程仍受 BUDGET / `.slice(0,5)` / 去重约束;**不**改 `authorCoverageContract`,**不**无条件刷 structure 节点。
- 执行器:仅改 picks 来源;`structure-exec-map` / `simulateCapabilityExecution` / commit 闸 **一律复用**。

## Preservation(¬C_A)

- **¬C_A 场景**(无 v2 新增关键词命中、无重复排去重触发)下:picks 与改动前 deep-equal(对 `sliderule-pick-heuristic.ts` 当前行为做 snapshot,而非虚构 `pickNextCapabilities_original`)。
- 已有健康 spec_tree + 拆解意图 → picks **不含** `structure.decompose`。
- GCOV / BUDGET / DLEDGER / 单写者 / `authorCoverageContract` 字段 **零改动**。

## Tasks

- **A′.1** Task 1(必败探索测试):
  - seed①:`userText="把目标结构化成需求树"` → 断言 picks 含 `structure.decompose`(**当前必败**,因缺「结构」关键词)。
  - seed②:`userText="decompose into spec tree"` 或 `"SPEC Tree"` → 断言含 `structure.decompose`(**当前可能必败**,大小写/英文 tree)。
  - seed③(去重):state 含健康 `spec_tree` artifact + `userText="再拆解一版"` → 断言 picks **不含** `structure.decompose`。
  - seed④(集成,分 executor):
    - `server-llm`:排程并 execute → `payload.schemaPassed && payload.invariantPassed`,`gateLedger` 进 `structureGateLedger` + conversation T_LEDGER。
    - `pilot/demo`:排程并 execute → 产物 `kind === "spec_tree"` 且 content 含 `G_SCHEMA`/`G_INV` 标记(模板路径)。
  - ~~seed(废弃)~~:~~「合约 required 含 structure.decompose」~~ — **删除**;与现 GCOV 矛盾。
- **A′.2** Task 2(必过保全):¬C_A 场景 picks snapshot equal;`拆解成 SPEC Tree` 仍含 structure(回归);PBT 多样 state。
- **A′.3** 修复:仅改 `sliderule-pick-heuristic.ts` keyword 段 + `hasSpecTree` 去重;必要时抽 `hasHealthySpecTree(state)` 到 shared 供 S19 复用。
- **A′.4** 翻转 + `verify:sliderule-v5` 全绿。

## 验收

- 发「结构化成 SPEC Tree」/「分解需求」→ ORCH 点名 `structure.decompose`,产物 `spec_tree` 入 STATE。
- 已有健康 spec_tree 时不重复排。
- **过程链六七个节点**须 **A′ + B 联调** 后验收;单 A′ 只验 STATE 产物与 T_LEDGER。

---

# Knife B — 子步铺开为节点(呈现层)

## 背景纠正(v2)

Spec v1 写「每个 capabilityRun 自带 THINKING/OBSERVING/COMPLETED」— **不准确**。

| 数据 | 位置 | 持久化 |
|---|---|---|
| `progressType: thinking/acting/observing/completed` | `UiTurn.steps[]`(chip step),由 `ui-capability-executor.ts` 写入 | ❌ 仅当轮 UI |
| 角色并行流推导 | `role-progress-log.tsx` 从 steps + `ActionTrace` 推导 | ❌ 投影 |
| 右栏架构时间线 | `ArchitectureProcessPanel` → `TurnRouteTimeline`(INTAKE/ORCH/C_*) | ❌ 投影 |
| `capabilityRuns` / `artifacts.evidenceRefs` | `V5SessionState` | ✅ 可回放 |

右栏可见的「阶段感」来自 **UI turn 流**,不是 STATE 里 per-run 的 phase 字段。投影层须按数据源优先级展开。

## Bug Condition C_B(X)

对任一已完成的能力执行,会话中**可还原**出过程信号(当轮 `UiTurn.steps` 或历史的 `capabilityRuns` + `artifacts.evidenceRefs` + `conversation` T_LEDGER 行);但 `deriveSlideRuleReasoningViewModel` 对每个能力主节点 **只产出 1 个图节点**,过程与证据被折叠进卡片正文(`ReasoningFlowSurface` **5 行** `FLOW_MAX_LINES` clamp)。结果:N 个能力 ≈ N 个节点,图稀疏。

## Expected Behavior

视图模型把「1 能力主节点」展开为「1 主节点 + K 子节点」(仅投影,不写 STATE):

- **阶段子节点**(详模式):从以下来源**按优先级**合成,边标「思考/观察/完成」:
  1. 当轮进行中:传入 `latestUiTurn?.steps`(chip `progressType`)
  2. 历史/刷新后:从 `capabilityRun` + 对应 `ActionTrace` + conversation 中 `[T_LEDGER]`/`[G-GROUND]` 行重建
- **证据子节点**:每条 `artifact.evidenceRefs` 解析到上游 artifact,挂子节点,边标「来源」;点击展开 provenance/summary。
- **结构链特例**:`kind === "spec_tree"` 的 artifact,按 tree 层级(根→requirement→task…)铺开;与 A′ 产物咬合。
- **详略开关**:STATUS 旁「简/详」,**默认简**;简模式节点集合与改动前 **deep-equal**(回归保护)。
- **详模式上限**(建议):单能力阶段子节点 ≤3,证据子节点 ≤8,SpecTree 深度 ≤4,防止 dagre 布局爆炸。

子节点 id 规范:`${parentId}::phase-${kind}` / `${parentId}::ev-${artifactId}` / `${parentId}::tree-${nodeId}`,供 Knife C 回跳复用。

## Preservation(¬C_B)

- **纯投影**: `deriveNodeStatus` 一行不动;子节点 **不进** `state.graph.nodes`,不进入 `saveSessionState` 序列化(N3)。
- 简模式:可见节点/边与改动前一致。
- 主节点 trustLevel/status 派生逻辑不变。

## Tasks

- **B.1** Task 1(必败):
  - fixture:state 含 1 个 trusted artifact(`evidenceRefs: [id1, id2]`) + 对应 capabilityRun;**不传** uiTurn。
  - 详模式:断言 `visibleNodes.length >= 3`(1 主 + 2 证据子节点)。未修必败。
  - 简模式:断言与 baseline snapshot equal。
- **B.2** Task 2(必过):P3 — `deriveNodeStatus` 前后 artifacts/goal/decisions deep-equal;序列化 STATE 无 `::phase-` / `::ev-` 子节点 id。
- **B.3** 修复:
  - `derive-reasoning-view-model.ts`: `expandCapabilityToProjectionNodes(state, node, mode, opts?)`
  - `DeriveReasoningViewModelOptions` 增加 `density?: "compact" | "detailed"` + 可选 `latestUiTurn`
  - `SlideRule.tsx` / `SlideRuleTopHud`:详略开关;详模式时 `ReasoningFlowSurface` 对子节点可放宽 clamp(或仅主节点 5 行、子节点 3 行)
  - SpecTree:解析 `spec_tree` content / payload,层级映射
- **B.4** 翻转 + 全量绿。

## 验收

详模式「枝繁叶茂」但每个子节点可溯源到真实 run/artifact/ledger 行;简模式回归;N3 仍绿;移动端 pan/zoom 不因节点暴增不可操作(有上限)。

---

# Knife C — 终点交付月台(呈现层 + md 导出)

## Bug Condition C_C(X)

当 `goal.status === "clear"` 且 `latestTrustedReport(state)` 存在时:

- 画布**无固定终点节点** — 报告只是众多卡片之一,5 行 clamp,易被 dagre 推出视口右缘;
- **无报告全文视图** — SlideRule 产品页未接入 report 阅读器;
- **无交付导出** — `deliveryPhase` 可到 `shipped`,但不产出用户可下载物。

用户走完 V5.1 脊柱却「摸不到最终结果」。

## 组件选型(v2)

| v1 写法 | v2 修正 |
|---|---|
| 复用 `ReportView.tsx` | ❌ 该组件绑定 nl-command `ExecutionReport` |
| — | ✅ 新建 `SlideRuleReportReader`(或 `pages/sliderule/ReportReaderPanel.tsx`),输入 `Artifact`(kind=report) |

报告段落切分:复用 `extractArtifactFragments` + `buildStructuredReport` 输出中的中文段标(结论/支撑证据/反证/风险/分歧/收敛决策/未解缺口/下一步…),映射为 UI 9 段(允许空段折叠)。

## 信任封条 `deriveTrustSeal(state)`(须先定义再测)

终点节点头部文案的数据来源,**只读**聚合:

```
T_GATE {commitPassed}/{commitTotal} · GCOV {gcovLabel} · 接地 {groundedN} · 可信 {trustedM}
```

| 字段 | 算法(建议) |
|---|---|
| `commitPassed/commitTotal` | 对 `latestTrustedReport` 的 `producedBy.capabilityRunId` 关联的 `state.gates` 中 `phase==="commit"` 的 passed 数 / 总数;若无 gates 记录则回退 `evaluateCommitGates(report.capabilityId, {groundingOk})` 快照,**不写 STATE** |
| `gcovLabel` | `evaluateCoverageGate(state).passed ? "✓" : "缺口"`(只读) |
| `groundedN` | 健康 evidence 且 provenance 含 `mcp|github|web:search` 计数 |
| `trustedM` | 健康 artifacts 总数 |

「7/7」为**展示上限文案**,实现以 `commitTotal` 实际值为准(visual 能力 gates 可能为 7);测试断言**字段存在 + 数值自洽**,不断言死 7/7。

## Expected Behavior

clear + trusted report 时,产品页出现**虚拟终点节点**(view-model 层,**不写** `state.graph`):

1. **信任封条头** — `deriveTrustSeal(state)`
2. **结论摘要** — goal.text + `clear` / `not_recommended` 徽章
3. **三个动作** — 【查看报告】【研究思路】【交付导出】
   - **查看报告** → `SlideRuleReportReader` 抽屉/全屏;段尾 evidenceRef 点击 → `highlightedNodeIds` 回跳画布节点(B 的子节点 id 须稳定)
   - **研究思路** → 沿 `dependencyGraph` 高亮 report ← synthesis ← risk/counter ← evidence 链
   - **交付导出** — `deliveryPhase === "shipped"` 或 RV 通过后启用 → **md 下载**:`serializeSlideRuleDeliveryMd(state)` = 报告全文 + `structureGateLedger`/`flowBoundaryLedger` 摘要 + 证据出处 + `replayCoverage(state)`

布局:`ReasoningFlowSurface` 增加 `pinnedNodeIds` 或在 clear 时 `fitView` 锚定终点虚拟节点坐标(固定视口内,不随 pan 丢失 — 实现二选一,写入 C.3)。

## Preservation(¬C_C)

- clear 前 / 无 trusted report:**无**终点虚拟节点。
- `not_recommended`:终点出现,无【交付导出】。
- `isReviewRejectIntent` → INTERV,与卡片 challenge **state 序列 deep-equal**(N4)。
- md 导出纯函数,**不改变 STATE**;runtime 零改动。

## Tasks

- **C.1** Task 1(必败):
  - `buildClearStateWithTrustedReport` → 投影含 `terminalNode` 且封条含 `T_GATE`/`GCOV` 字段。
  - `SlideRuleReportReader` 渲染 ≥7 个命名段;点击 evidenceRef 产出 `highlightTargetNodeId`。
  - `not_recommended` goal → 无导出按钮。
- **C.2** Task 2(必过):clear 前无 terminal;RV 打回 vs challenge deep-equal;`serializeSlideRuleDeliveryMd` 前后 STATE equal。
- **C.3** 修复:
  - `derive-terminal-node.ts`(或并入 view-model):虚拟终点节点 + `deriveTrustSeal`
  - `SlideRuleReportReader` + `SlideRule.tsx` 抽屉/全屏接线
  - `serialize-sliderule-delivery-md.ts`
  - `ReasoningFlowSurface`:终点不受 5 行 clamp / 视口锚定
- **C.4** 翻转 + S2/S19/S20 场景 + `verify:sliderule-v5`。

## 验收

S2 收敛后终点必现且封条可读;报告段证据可回跳;RV 通过 → md 含 GCOV 回放;not_recommended 不可导出;N3/N4 仍绿。

---

## 执行顺序与套件门(v2)

**建议波次**(按用户感知优先):

1. **Knife C** — 终点月台;最直接解决「摸不到结果」
2. **Knife A′** — 小 diff 调度补全;为 SpecTree 主产物铺路
3. **Knife B** — 详略密度;与 A′ 联调验收过程链
4. **GitHub Pages demo seed 升级** — 见下节

每刀合并后 `verify:sliderule-v5` 须全绿。探索测试用普通 `it` + 明确「当前必败」注释,**不要**误加到 `it.fails` 债务池(当前约 20 个,在 budget/invariants/artifact-health;三刀应只减不增)。

**跨刀不变式守护**:

- N3:DERIVE/投影对 STATE 无写权限 — B 子节点、C 终点节点均虚拟
- N1:不绕过 GCOV 写 GOAL — 三刀不碰 `goal.status` 写入逻辑
- N4:评审打回仅经 INTERV — C 不得另开回炉路径
- 「够了就停」:A′ 仅关键词/去重触发 structure;B 默认简模式

---

## GitHub Pages 演示对齐

当前 `github-pages-sliderule-demo.ts` 种子仅含 RBAC goal + risk + web evidence。三刀落地后建议 demo 种子扩展为:

| 产物 | 用途 |
|---|---|
| 可选 `spec_tree` | 演示 A′ + B SpecTree 层级 |
| `goal.status: clear` + trusted `report` | 演示 C 终点月台 + 封条 |
| STATUS「详略」默认简 | 话术:「够了就停」;访客切详模式看溯源 |

demo 仍用 `pilot` executor;structure 走模板树路径,封条数值与生产 `server-llm` 可能不同 — 演示文案注明「模拟数据」即可。

---

## 与产品叙事的咬合(给文案/对外用)

- Knife A′ 补的是**主产物可达性**(SPEC Tree = 「想清楚」的具象);关键词要覆盖中英文混合表述。
- Knife C 的信任封条是**差异化护城河像素兑现**(`deriveTrustSeal`,「我比生成的敢信」)。
- Knife B 让「枝繁叶茂」与「克制收敛」一键切换 — **demo 话术**:简模式讲「够了就停」,详模式讲「每一步可溯源、可挑战」。