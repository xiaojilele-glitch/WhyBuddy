# 设计文档：任务自动驾驶成功度量体系

## 设计概述

本设计为 WhyBuddy 增加一层“任务自动驾驶成功度量投影层”，目标不是创造新的业务真相源，而是在现有 `mission / runtime / audit / replay` 之上，建立统一的指标定义、事件归一化、任务级样本与聚合查询能力。

核心设计原则如下：

1. 兼容优先，不推翻现有事实源
2. 原子指标优先，不以单一总分掩盖问题
3. 任务样本优先，每个聚合值都能回溯到 mission 级证据
4. 审计与回放可验证，关键指标必须能被 replay 和 audit 交叉核查
5. 投影优先于重命名，通过归一化层连接产品语义与工程事实

## 设计目标

- 定义任务自动驾驶成功度量的统一指标模型
- 为“送达率、接管率、重规划率、偏航率、完成时长、结果复核通过率、用户确认次数”建立稳定口径
- 明确 mission / runtime / audit / replay 在指标中的职责分工
- 避免产生“报表一套口径、回放另一套口径、审计再一套口径”的碎片化问题
- 为后续 cockpit、dashboard、replay、audit drill-down 提供统一输入

## 总体分层

### 第一层：事实源

现有事实源继续保留原职责：

- `mission`
  - 负责任务实体、生命周期、目标上下文、终态
- `runtime`
  - 负责路线执行、状态推进、接管请求、重试、重规划、复核阶段
- `audit`
  - 负责确认、授权、风险接受、审批、治理类动作的不可篡改证据
- `replay`
  - 负责时间线重建、路径回看、人工核查与调试消费

### 第二层：成功度量投影层

在事实源之上新增统一指标投影：

- `AutopilotMetricEvent`
- `AutopilotMissionMetrics`
- `AutopilotMetricsAggregate`

该层职责是：

- 将多源事实转换为同一套统计事件
- 计算任务级成功样本
- 聚合形成报表与看板指标
- 给 replay / audit / cockpit 提供一致口径

### 第三层：消费层

以下视图优先消费成功度量投影，而不是各自复制统计逻辑：

- 任务自动驾驶驾驶舱
- 遥测与成功度量看板
- replay 时间线侧边栏
- audit 治理视图
- 运营报表与周报导出

## 核心数据模型

### 1. 统一指标事件

```ts
type MetricSource = "mission" | "runtime" | "audit" | "replay";

type AutopilotMetricEventType =
  | "mission_accepted"
  | "autopilot_engaged"
  | "route_committed"
  | "delivery_succeeded"
  | "delivery_failed"
  | "mission_cancelled"
  | "takeover_requested"
  | "takeover_resolved"
  | "user_confirmation_submitted"
  | "replan_started"
  | "replan_completed"
  | "deviation_detected"
  | "review_started"
  | "review_passed"
  | "review_failed"
  | "review_skipped";

interface AutopilotMetricEvent {
  eventId: string;
  missionId: string;
  routeId?: string;
  workflowId?: string;
  runtimeId?: string;
  type: AutopilotMetricEventType;
  timestamp: string;
  source: MetricSource;
  sourceRef: string;
  actorType?: "user" | "agent" | "system";
  required?: boolean;
  reasonCode?: string;
  driveState?: string;
  metadata?: Record<string, unknown>;
}
```

设计说明：

- 该事件层不是新的原始事实源，而是面向统计的归一化投影
- 每个事件都必须保留 `source` 与 `sourceRef`
- 同一事件可由多个事实源支持，但应只选择一个主事件实例进入指标计算，同时保留附加证据引用

### 2. 任务级成功样本

```ts
type MetricsEvidenceState = "complete" | "partial" | "missing" | "conflicted";

interface AutopilotMissionMetrics {
  missionId: string;
  definitionVersion: string;
  missionTitle?: string;
  autopilotLevel?: "L1" | "L2" | "L3" | "L4" | "L5";
  missionType?: string;
  routeFamily?: string;
  workspaceId?: string;
  included: boolean;
  excludeReason?: "manual_only" | "test_data" | "demo_data" | "cancelled_before_route" | "backfill_only";
  lifecycle: {
    missionAcceptedAt?: string;
    autopilotEngagedAt?: string;
    routeCommittedAt?: string;
    terminalAt?: string;
    terminalState?: "delivered" | "failed" | "cancelled" | "in_progress" | "unknown";
  };
  counters: {
    requiredTakeoverCount: number;
    advisoryTakeoverCount: number;
    userConfirmationCount: number;
    replanCount: number;
    deviationCount: number;
    reviewCount: number;
    reviewPassCount: number;
    reviewFailCount: number;
  };
  booleans: {
    delivered: boolean;
    hadRequiredTakeover: boolean;
    hadReplan: boolean;
    hadDeviation: boolean;
    reviewPassed: boolean;
    firstReviewPassed?: boolean;
  };
  durations: {
    completionMs?: number;
    planningMs?: number;
    executingMs?: number;
    reviewMs?: number;
    takeoverWaitMs?: number;
  };
  evidence: {
    state: MetricsEvidenceState;
    missionRefs: string[];
    runtimeRefs: string[];
    auditRefs: string[];
    replayRefs: string[];
    notes?: string[];
  };
}
```

设计说明：

- `AutopilotMissionMetrics` 是本设计的核心任务级统计单元
- 聚合指标均由该对象派生，而不是直接从页面状态汇总
- `included` 与 `excludeReason` 用于避免分母污染
- `evidence.state` 用于显式暴露数据完整性，而不是把脏数据装作正常数据

### 3. 聚合结果

```ts
interface AutopilotMetricsAggregate {
  definitionVersion: string;
  window: {
    start: string;
    end: string;
    bucket?: "hour" | "day" | "week";
  };
  dimensions: {
    autopilotLevel?: string;
    missionType?: string;
    routeFamily?: string;
    workspaceId?: string;
    environment?: string;
  };
  counts: {
    eligibleMissions: number;
    deliveredMissions: number;
    missionsWithTakeover: number;
    missionsWithReplan: number;
    missionsWithDeviation: number;
    reviewedMissions: number;
    reviewPassedMissions: number;
    totalUserConfirmations: number;
  };
  rates: {
    deliveryRate?: number;
    takeoverRate?: number;
    replanRate?: number;
    deviationRate?: number;
    reviewPassRate?: number;
    avgUserConfirmationsPerMission?: number;
  };
  durations: {
    completionAvgMs?: number;
    completionP50Ms?: number;
    completionP90Ms?: number;
  };
  quality: {
    completeSamples: number;
    partialSamples: number;
    conflictedSamples: number;
  };
}
```

## 指标定义

### 1. 任务送达率

定义：

- 分子：`delivered = true` 的合格任务数
- 分母：`included = true` 的任务数

任务级判定：

- 成功送达以 `mission / runtime` 的终态投影为主
- `delivery_succeeded` 事件存在时优先判定为 delivered
- 若 mission 显示已完成但缺少 runtime 送达证据，可标记为 `partial`

排除：

- `manual_only`
- `test_data`
- `demo_data`
- `cancelled_before_route`
- `backfill_only`

### 2. 接管率

定义：

- 分子：`hadRequiredTakeover = true` 的合格任务数
- 分母：`included = true` 的任务数

计数规则：

- 仅 `required takeover` 计入接管率主指标
- `advisory takeover` 单独记入辅指标，不混入主接管率
- 一次任务出现多次必需接管，主接管率仍按一次任务计数；次数另由 `requiredTakeoverCount` 保存

### 3. 用户确认次数

定义：

- 任务级统计：任务生命周期内所有显式确认动作次数之和
- 聚合级统计：`totalUserConfirmations / eligibleMissions`

纳入动作：

- `approve`
- `accept`
- `confirm`
- `select_route`
- `grant_permission`
- `accept_risk`
- `delivery_acceptance`

不纳入：

- 纯查看行为
- 系统自动默认动作
- 未真正提交成功的表单输入草稿

### 4. 重规划率

定义：

- 分子：`hadReplan = true` 的已承诺路线任务数
- 分母：发生过 `route_committed` 的任务数

关键边界：

- `retry` 不等于 `replan`
- 同一路线内的预期分支切换不等于 `replan`
- 正式重规划要求出现显式的 `replan_started` 或等价 runtime 事实

### 5. 偏航率

定义：

- 分子：`hadDeviation = true` 的已承诺路线任务数
- 分母：发生过 `route_committed` 的任务数

偏航判定原则：

- 实际执行脱离当前路线承诺
- 关键里程碑、依赖或执行顺序发生非预期偏离
- 偏离后触发纠偏、恢复、接管或重规划之一

不计入偏航：

- 路线内已声明的备选分支
- 纯日志顺序变化但不改变路线语义的事件

### 6. 完成时长

主定义：

- `completionMs = terminalAt - autopilotEngagedAt`

补充拆分：

- `planningMs`
- `executingMs`
- `reviewMs`
- `takeoverWaitMs`

聚合输出：

- `avg`
- `p50`
- `p90`

未终态任务：

- 不进入完成任务时长分布
- 可进入进行中任务监控，但不混入已完成聚合

### 7. 结果复核通过率

定义：

- 分子：`reviewPassed = true` 的已完成复核任务数
- 分母：已完成复核任务数，即 `reviewCount > 0` 且最终状态为 `review_passed` 或 `review_failed`

边界：

- `review_skipped` 不默认进入分母
- 同一任务多轮复核只保留最终结论用于主指标
- 首轮是否通过应保存为辅指标，以支持质量诊断

## 事实源映射

### 1. source of truth 分工

| 指标或字段 | 主事实源 | 次事实源 | 说明 |
| ---- | ---- | ---- | ---- |
| missionAcceptedAt / terminalState | mission | runtime | mission 负责任务实体终态，runtime 用于补全阶段细节 |
| autopilotEngagedAt / routeCommittedAt | runtime | mission | 自动驾驶真正进入路线推进由 runtime 更可靠 |
| requiredTakeoverCount | runtime | audit | runtime 负责“请求接管”，audit 负责“接管提交”证据 |
| userConfirmationCount | audit | runtime | 治理敏感确认以 audit 为主 |
| replanCount | runtime | replay | replay 可辅助核对重规划时间线 |
| deviationCount | runtime | replay | 偏航首先来自运行时判定，replay 用于人工核查 |
| reviewPassCount / reviewFailCount | runtime | audit | runtime 负责复核状态，audit 补充审批与验收痕迹 |
| drill-down timeline | replay | runtime | replay 是消费层主入口，但不替代事实判定 |

### 2. 冲突优先级

建议优先级如下：

1. `runtime` 与 `mission` 用于执行与终态事实判定
2. `audit` 用于用户确认、权限、预算、风险接受等治理事实判定
3. `replay` 主要用于重建时间线与排错，不应在主事实存在时反向覆盖主事实

冲突处理：

- 若 `mission` 与 `runtime` 对终态不一致，样本标记为 `conflicted`
- 若 `audit` 记录了确认提交，但 `runtime` 未恢复推进，保留确认次数，同时标记恢复链路异常
- 若仅有 replay 事件而缺少主事实源，样本标记为 `partial`

## 归一化事件映射

### 1. mission -> metric event

建议映射：

- mission 创建并进入自动驾驶模式 -> `mission_accepted`
- mission 终态为 delivered -> `delivery_succeeded`
- mission 终态为 failed -> `delivery_failed`
- mission 终态为 cancelled -> `mission_cancelled`

### 2. runtime -> metric event

建议映射：

- Drive State / route 生效 -> `autopilot_engaged`、`route_committed`
- 等待人工介入 -> `takeover_requested`
- resume / decision 已处理 -> `takeover_resolved`
- route rewrite / reroute -> `replan_started`、`replan_completed`
- deviation / blocked / reroute trigger -> `deviation_detected`
- review active -> `review_started`
- verify pass / fail -> `review_passed`、`review_failed`

### 3. audit -> metric event

建议映射：

- approve / accept / grant / confirm -> `user_confirmation_submitted`
- 风险接受、权限授权、预算确认、交付验收应保留事件分类与 reason
- 这些 audit 事件既支持计数，也支持 drill-down 证据引用

### 4. replay -> metric evidence

建议使用方式：

- 为任务样本补充时间线片段引用
- 验证偏航、接管、重规划前后顺序
- 支持人工复盘为何某任务被记为失败或偏航

不建议：

- 直接把前端 replay 展示结果当作统计主分母来源

## 归一化事件生成器契约

归一化事件生成器负责把多源事实收敛为单一 `AutopilotMetricEvent[]`，但它本身不是新的事实源。

建议契约如下：

```ts
interface BuildAutopilotMetricEventsInput {
  definitionVersion: string;
  missionRef: string;
  missionFacts: Record<string, unknown>;
  runtimeFacts?: Record<string, unknown>;
  auditFacts?: Record<string, unknown>[];
  replayFacts?: Record<string, unknown>[];
  window?: {
    start: string;
    end: string;
  };
}

interface BuildAutopilotMetricEventsOutput {
  events: AutopilotMetricEvent[];
  evidenceState: MetricsEvidenceState;
  droppedFacts: Array<{
    source: MetricSource;
    sourceRef: string;
    reason: string;
  }>;
  conflicts: Array<{
    missionId: string;
    category:
      | "terminal_state_mismatch"
      | "confirmation_without_progress"
      | "replay_without_primary_fact"
      | "duplicate_primary_event";
    sources: MetricSource[];
    reason: string;
  }>;
}
```

生成规则：

- 输入侧必须显式区分 `mission / runtime / audit / replay`，不得把不同来源预混成一段不可追溯 payload。
- 输出侧必须同时给出 `events`、`evidenceState`、`droppedFacts` 与 `conflicts`，避免只返回“算完的结果”。
- 同一语义事件若由多个来源同时提供，生成器必须选择一个主事件进入统计流，并把其余来源保留为附加证据或冲突信息。
- 若关键主事实缺失但仍可形成统计事件，输出必须降级为 `partial`；若主事实互相矛盾，则输出必须带 `conflicts`。

## 派生计算规则

### 1. 样本纳入判定

任务样本满足以下条件时可计入主统计：

- 存在 `mission_accepted` 或等价 mission 进入自动驾驶信号
- 非 `manual_only`
- 非测试 / demo / 纯回灌样本

样本排除必须保留 `excludeReason`，不得仅通过查询条件隐式丢弃。

### 2. 阶段耗时计算

建议从 Drive State 或 runtime phase 投影如下：

- `planningMs`
  - `planning` 段累积时长
- `executingMs`
  - `executing` 段累积时长
- `reviewMs`
  - `reviewing` 段累积时长
- `takeoverWaitMs`
  - 从 `takeover_requested` 到 `takeover_resolved` 的等待时长累积

### 3. 重规划与偏航关联

一个偏航事件可能导致：

- 无需操作，仅记录偏差
- 触发接管
- 触发重规划

因此需要保留以下关联：

- `deviation_detected.eventId -> replan_started.eventId`
- `deviation_detected.eventId -> takeover_requested.eventId`

这样 replay 与 dashboard 才能回答“偏航后发生了什么”。

### 4. 复核通过判定

最终复核状态按最后一个复核终态事件决定：

- 最后事件为 `review_passed` -> 复核通过
- 最后事件为 `review_failed` -> 复核失败

首轮通过单独计算：

- 第一条复核终态事件为 `review_passed` -> 首轮通过

## 任务级样本构建流程

`AutopilotMissionMetrics` 的建议构建顺序如下：

1. 收集事实源
   - 读取 mission 生命周期事实、runtime 执行事实、audit 确认事实、replay 时间线引用
2. 生成归一化事件
   - 调用事件生成器产出 `AutopilotMetricEvent[]`
   - 同步产出 `evidenceState`、`droppedFacts`、`conflicts`
3. 构建生命周期锚点
   - 填充 `missionAcceptedAt`、`autopilotEngagedAt`、`routeCommittedAt`、`terminalAt`、`terminalState`
4. 派生 counters / booleans / durations
   - 依据归一化事件生成接管、确认、重规划、偏航、复核计数与布尔结论
   - 依据生命周期与阶段事件生成 `completionMs / planningMs / executingMs / reviewMs / takeoverWaitMs`
5. 应用样本纳入与排除规则
   - 设置 `included` 与 `excludeReason`
   - 不得在未记录原因的情况下隐式丢弃任务样本
6. 写入证据与质量状态
   - 填充 `missionRefs / runtimeRefs / auditRefs / replayRefs`
   - 若存在冲突或缺口，更新 `evidence.state` 并记录 `notes`
7. 输出聚合可消费样本
   - 只允许输出统一的 `AutopilotMissionMetrics`
   - dashboard / replay / audit 的聚合与钻取均应基于这一步结果派生

该流程的目标是把“事件归一化”和“任务级样本构建”分成两段稳定边界：前者解决多源事实归一化，后者解决指标样本派生与纳入控制。

## 查询与展示约束

### 1. 聚合约束

所有聚合展示必须基于 `AutopilotMissionMetrics`，而不是页面临时再算一遍。

原因：

- 避免 dashboard、replay、audit 各自重写口径
- 允许稳定缓存、导出与回溯
- 允许显式展示 `partial / conflicted` 样本比例

### 2. 钻取约束

每个聚合卡片至少应支持钻取到：

- 任务样本列表
- 单任务指标摘要
- 证据引用集合
- replay 深链
- audit 深链

### 3. 时间窗口约束

建议最小支持：

- 最近 24 小时
- 最近 7 天
- 最近 30 天
- 自定义时间范围

聚合时需按 `missionAcceptedAt` 或 `terminalAt` 明确选择时间锚点，默认建议：

- 成功与失败结果类指标使用 `terminalAt`
- 进行中规模类指标使用 `missionAcceptedAt`

## 接口与消费层契约

### 1. 聚合接口返回结构

成功度量聚合接口建议返回“查询上下文 + 聚合结果 + 卡片投影 + 数据质量提示”四段结构，而不是只返回一组裸数字。

```ts
interface AutopilotMetricsAggregateResponse {
  definitionVersion: string;
  generatedAt: string;
  query: {
    window: AutopilotMetricsAggregate["window"];
    dimensions: AutopilotMetricsAggregate["dimensions"];
    anchor: "terminalAt" | "missionAcceptedAt";
  };
  aggregate: AutopilotMetricsAggregate;
  cards: Array<{
    metricName:
      | "deliveryRate"
      | "takeoverRate"
      | "replanRate"
      | "deviationRate"
      | "reviewPassRate"
      | "avgUserConfirmationsPerMission"
      | "completionMs";
    title: string;
    numerator?: number;
    denominator?: number;
    value?: number;
    valueText: string;
    qualityState: MetricsEvidenceState;
    drilldownQueryRef: string;
    explanationKey: string;
  }>;
  qualityBanner: {
    completeSamples: number;
    partialSamples: number;
    conflictedSamples: number;
    warning?: string;
  };
}
```

设计约束：

- `cards` 只承载展示层摘要，不得替代 `aggregate` 成为新的事实结构。
- `drilldownQueryRef` 必须可回到任务样本列表，不允许只给前端拼接文案。
- `qualityBanner` 必须与 `aggregate.quality` 对齐，避免 dashboard 把 `partial / conflicted` 静默隐藏。

### 2. 任务级成功样本详情接口返回结构

任务级详情接口建议返回“任务样本 + 归一化事件摘要 + 深链入口 + 质量说明”。

```ts
interface AutopilotMissionMetricsDetailResponse {
  definitionVersion: string;
  mission: AutopilotMissionMetrics;
  metricEvents: AutopilotMetricEvent[];
  deepLinks: {
    replay?: string;
    audit?: string;
    mission?: string;
  };
  quality: {
    state: MetricsEvidenceState;
    notes: string[];
  };
}
```

设计约束：

- `metricEvents` 允许只返回与当前 mission 直接相关的事件切片，不要求把全部原始事实混入同一 payload。
- `quality.notes` 必须能解释为何样本是 `partial` 或 `conflicted`，不得只给状态码。

### 3. cockpit / telemetry dashboard 消费契约

cockpit 与 telemetry dashboard 虽然都消费成功度量，但侧重点不同，因此应共享口径、不共享临时拼装逻辑。

#### 3.1 cockpit 任务驾驶舱消费契约

cockpit 侧建议消费“单任务样本 + 当前路线上下文 + 对比基线摘要”。

```ts
interface CockpitSuccessMetricsPanelPayload {
  definitionVersion: string;
  missionId: string;
  missionSample: Pick<
    AutopilotMissionMetrics,
    "missionId" | "included" | "excludeReason" | "lifecycle" | "counters" | "booleans" | "durations" | "evidence"
  >;
  currentContext: {
    routeId?: string;
    autopilotLevel?: string;
    missionType?: string;
    routeFamily?: string;
  };
  comparison?: {
    windowLabel: string;
    aggregate: Pick<AutopilotMetricsAggregate, "rates" | "durations" | "quality">;
  };
  deepLinks: {
    replay?: string;
    audit?: string;
    sample?: string;
  };
}
```

cockpit 展示规则：

- 默认展示当前任务是否已送达、是否发生必需接管、是否发生重规划、是否偏航、完成时长、结果复核结论。
- 若 `included = false`，cockpit 必须优先显示“该任务未纳入主统计”的原因，而不是继续把任务强行放进成功率口径。
- cockpit 允许展示与窗口基线的轻量对比，但不得自行重算分子 / 分母；对比基线必须来自聚合接口。

#### 3.2 telemetry dashboard 消费契约

telemetry dashboard 侧建议消费“聚合结果 + 卡片列表 + 数据质量提示”。

```ts
interface TelemetryDashboardMetricsPayload {
  definitionVersion: string;
  aggregate: AutopilotMetricsAggregateResponse["aggregate"];
  cards: AutopilotMetricsAggregateResponse["cards"];
  qualityBanner: AutopilotMetricsAggregateResponse["qualityBanner"];
  defaultDrilldowns: Array<{
    metricName: string;
    drilldownQueryRef: string;
    defaultSort: "completionMs_desc" | "takeoverCount_desc" | "replanCount_desc";
  }>;
}
```

dashboard 展示规则：

- dashboard 不得直接消费 replay 事件数组或 audit 明细作为主卡片输入。
- dashboard 每张卡片都必须保留 `definitionVersion` 对应的解释入口，避免运营只看到数字看不到口径。
- dashboard 若发现 `conflictedSamples` 超过阈值，应优先展示质量告警，而不是继续强调单一 rate。

### 4. replay 侧栏消费成功度量样本契约

replay 侧栏应消费“任务级成功样本切片 + 指标锚点 + 时间线映射”，而不是自己重新推导指标。

```ts
interface ReplaySuccessMetricsSidebarPayload {
  definitionVersion: string;
  missionId: string;
  missionSample: Pick<
    AutopilotMissionMetrics,
    "lifecycle" | "counters" | "booleans" | "durations" | "evidence"
  >;
  metricAnchors: Array<{
    metricName:
      | "deliveryRate"
      | "takeoverRate"
      | "userConfirmationCount"
      | "replanRate"
      | "deviationRate"
      | "reviewPassRate";
    metricEventId?: string;
    replayRef: string;
    label: string;
    timestamp?: string;
  }>;
  deviationChain?: {
    deviationEventId?: string;
    takeoverEventId?: string;
    replanEventId?: string;
  };
  qualityNotes: string[];
}
```

replay 侧栏展示规则：

- 侧栏顶部展示该任务在成功度量口径下的样本状态，例如“已送达 / 有必需接管 / 有重规划 / 证据部分缺失”。
- `metricAnchors` 至少覆盖：送达锚点、必需接管锚点、确认提交锚点、重规划锚点、偏航锚点、复核结论锚点。
- replay 侧栏允许展示“偏航 -> 接管 -> 重规划”的链路摘要，但不得把侧栏上的时间线顺序反向写回主事实。

### 5. audit 侧消费确认次数与治理证据契约

audit 侧应聚焦“确认次数的可解释拆分”和“治理证据的结构化引用”。

```ts
interface AuditSuccessMetricsPanelPayload {
  definitionVersion: string;
  missionId: string;
  confirmationSummary: {
    totalUserConfirmations: number;
    routeSelections: number;
    budgetConfirmations: number;
    permissionGrants: number;
    riskAcceptances: number;
    deliveryAcceptances: number;
  };
  governanceEvidence: GovernanceEvidenceReference[];
  metricBindings: Array<{
    metricName: "takeoverRate" | "userConfirmationCount" | "reviewPassRate";
    counterField: string;
    evidenceRefs: string[];
  }>;
  qualityNotes: string[];
  deepLinks: {
    audit?: string;
    replay?: string;
  };
}
```

audit 展示规则：

- `totalUserConfirmations` 必须能拆分成路线选择、预算确认、权限授权、风险接受、交付验收等子类，避免只给一个总次数。
- `governanceEvidence` 必须保留 `decisionId / auditRef / submittedAt / outcome / confirmationType`，以支持审计核查。
- audit 侧若发现确认动作已发生但 runtime 无恢复推进，必须保留“恢复链路异常”提示，而不是把确认次数默默并入正常样本。

## 一致性校验与治理证据引用

### 1. replay 一致性校验规则

dashboard 聚合指标与 replay 时间线之间，至少应满足以下一致性约束：

- 同一时间窗口和同一维度切片下，聚合卡片钻取出来的任务样本数必须等于对应样本列表的去重 `missionId` 数。
- 若任务样本声明 `hadDeviation = true`、`hadReplan = true` 或 `hadRequiredTakeover = true`，则 `replayRefs` 至少应能指向一个对应时间线片段；否则该样本降级为 `partial`。
- 若 replay 时间线只能证明“看起来发生过”，但找不到主事实源对应事件，则保持样本可见，并标记为 `partial`，不得反向覆盖主事实。

### 2. audit 一致性校验规则

dashboard 聚合指标与 audit 确认事件之间，至少应满足以下一致性约束：

- 若任务样本 `userConfirmationCount > 0`，则 `auditRefs` 中至少应存在一条确认、授权、风险接受或交付验收引用。
- 若 audit 已记录确认提交，但任务级样本中没有相应 `user_confirmation_submitted` 或 `takeover_resolved` 事实，则样本标记为 `conflicted` 或“恢复链路异常”。
- 接管率主指标默认只统计 `required takeover`，但 audit 中的 advisory 类确认仍可作为辅证据保留，不得混入主接管率。

### 3. 关键治理事件证据引用结构

关键治理事件建议统一投影为结构化引用，而不是仅保存字符串数组：

```ts
interface GovernanceEvidenceReference {
  refId: string;
  missionId: string;
  metricName:
    | "takeoverRate"
    | "userConfirmationCount"
    | "reviewPassRate";
  confirmationType:
    | "budget_confirmation"
    | "permission_grant"
    | "risk_acceptance"
    | "route_selection"
    | "delivery_acceptance";
  auditRef: string;
  relatedMetricEventId?: string;
  decisionId?: string;
  takeoverEventId?: string;
  actorId?: string;
  submittedAt: string;
  outcome: "approved" | "accepted" | "confirmed" | "rejected";
  reasonCode?: string;
}
```

展示时至少应支持：

- 从任务样本直接查看相关治理事件列表
- 从接管率、用户确认次数、结果复核通过率钻取到相应 audit 引用
- 在 replay / audit 深链中携带 `missionId`、`decisionId`、`relatedMetricEventId`

## 数据质量与回补策略

### 1. 完整性状态

样本完整性分为：

- `complete`
  - 主事实源与关键证据齐全
- `partial`
  - 主指标可算，但部分证据缺失
- `missing`
  - 关键字段缺失，无法形成有效样本
- `conflicted`
  - 多源事实互相矛盾

### 2. 回补原则

允许通过 replay 或 audit 为旧数据补充证据，但不应在未标记的情况下直接覆盖已有主事实。

建议策略：

- 允许补充 `replayRefs`、`auditRefs`
- 若补充后解除冲突，可将 `partial` 升级为 `complete`
- 若补充仍无法消除主事实矛盾，保持 `conflicted`

### 3. `conflicted` 样本处理流程

`conflicted` 样本至少应支持以下处理闭环：

1. 标记
   - 在任务级样本中显式标记 `evidence.state = conflicted`
   - 同时记录冲突类别、冲突来源与摘要原因
2. 告警
   - 在聚合结果中单独统计 `conflictedSamples`
   - 当同一窗口内 `conflictedSamples` 超过阈值时，应触发数据质量告警，而不是继续静默显示聚合值
3. 人工核查
   - 支持从样本直接钻取到 mission、runtime、audit、replay 引用
   - 允许人工判断是“主事实错误”“附加证据缺失”还是“映射规则缺陷”
4. 处置
   - 若补充证据后冲突消除，可升级为 `complete`
   - 若确认冲突属真实事实不一致，则保持 `conflicted`，并进入后续修复或口径说明

### 4. 指标口径版本化策略

成功度量口径应以显式版本管理，而不是让历史样本在无提示的情况下被新口径重算。

建议策略：

- `AutopilotMissionMetrics` 与 `AutopilotMetricsAggregate` 都携带 `definitionVersion`
- 口径变更至少区分：
  - `non-breaking`
    - 只补充说明、字段或 drill-down 引用，不改变主指标分子 / 分母
  - `breaking`
    - 改变主指标的纳入规则、时间锚点、排除条件或冲突优先级
- 聚合结果必须说明自己使用的 `definitionVersion`
- 不同版本的聚合结果不得在同一张主报表中静默混合比较
- 若历史样本依据新证据回补，应保留“样本更新时间”和“口径版本更新时间”两个维度，避免把证据回补误读为口径变化

## 指标解释文案

### 1. 解释文案契约

指标解释文案建议按受众拆成产品、运营、治理三套稳定口径，而不是让不同页面自行写提示文案。

```ts
interface MetricAudienceCopyPack {
  metricName:
    | "deliveryRate"
    | "takeoverRate"
    | "userConfirmationCount"
    | "replanRate"
    | "deviationRate"
    | "completionMs"
    | "reviewPassRate";
  productCopy: string;
  operationsCopy: string;
  governanceCopy: string;
  caution: string;
}
```

### 2. 面向产品、运营、治理的解释文案

#### 2.1 任务送达率

- 产品口径：
  - 表示系统是否真的把任务送到了可交付终态，而不是只完成了中间步骤。
- 运营口径：
  - 用于观察任务漏斗末端的真实完成能力，需结合 `partial / conflicted` 比例一起看。
- 治理口径：
  - 若送达率下降但治理证据缺口同时上升，优先检查事实完整性，不要直接归因给执行能力。
- 使用提醒：
  - 不要把测试、demo、纯回灌样本混入主分母。

#### 2.2 接管率

- 产品口径：
  - 表示系统在完成任务时有多大比例必须请求人工介入。
- 运营口径：
  - 用于定位哪些任务类型或路线家族最容易打断自动驾驶链路。
- 治理口径：
  - 接管率上升不一定是坏事，高风险任务中更高接管率可能代表治理守门在生效。
- 使用提醒：
  - 主接管率只统计 `required takeover`，不要把 advisory 提示混入主指标。

#### 2.3 用户确认次数

- 产品口径：
  - 表示用户在一个任务中实际提交了多少次明确确认，而不是看过多少次提示。
- 运营口径：
  - 用于观察交互负担是否持续上升，以及是否需要优化默认路线和澄清策略。
- 治理口径：
  - 用于核查预算、权限、风险接受和交付验收是否保留了足够的人类确认痕迹。
- 使用提醒：
  - 草稿输入、默认动作和纯查看行为不计入确认次数。

#### 2.4 重规划率

- 产品口径：
  - 表示任务在承诺路线后，有多少比例需要正式改线或重规划。
- 运营口径：
  - 用于识别路线稳定性和 planner 输出质量是否正在恶化。
- 治理口径：
  - 若高风险任务的重规划率上升，需要同时检查是否由风险守门、权限限制或预算限制触发。
- 使用提醒：
  - `retry` 不等于 `replan`，不要把普通失败恢复算成路线改写。

#### 2.5 偏航率

- 产品口径：
  - 表示执行是否脱离了原本承诺的路线语义，而不是只看日志顺序有没有变化。
- 运营口径：
  - 用于观察执行稳定性和异常恢复成本，尤其要看偏航后是否连带产生接管或重规划。
- 治理口径：
  - 偏航率高时，需核查是否存在未声明副作用、未记录分支或执行顺序漂移。
- 使用提醒：
  - 计划内备选分支不计入偏航。

#### 2.6 完成时长

- 产品口径：
  - 表示任务从真正进入自动驾驶到终态交付所需的总时长。
- 运营口径：
  - 应优先看 `avg / p50 / p90` 与阶段拆分，而不是只看单个平均值。
- 治理口径：
  - 若 `takeoverWaitMs` 或 `reviewMs` 异常抬高，应优先检查治理链路和人工处理瓶颈。
- 使用提醒：
  - 未终态任务不得混入完成时长分布。

#### 2.7 结果复核通过率

- 产品口径：
  - 表示任务在进入复核后，最终有多少比例拿到了通过结论。
- 运营口径：
  - 应同时关注“最终通过”和“首轮通过”，前者看最终交付质量，后者看初次命中率。
- 治理口径：
  - 复核通过率低时，不应只追究模型质量，还要查看规则是否过严或证据链是否缺失。
- 使用提醒：
  - `review_skipped` 不默认进入主分母。

## 口径变更记录与版本说明模板

### 1. 口径变更记录结构

```ts
interface AutopilotMetricsDefinitionChangeRecord {
  version: string;
  changeType: "non-breaking" | "breaking";
  effectiveAt: string;
  owner: string;
  impactedMetrics: string[];
  oldRuleSummary: string;
  newRuleSummary: string;
  expectedImpact: "none" | "recount" | "backfill" | "historically_incomparable";
  dashboardBannerCopy: string;
  runbookAction: string;
  relatedSpecRef?: string;
  relatedAuditRef?: string;
}
```

### 2. 口径变更记录模板

```md
## 成功度量口径变更记录

- 版本：`vYYYY.MM.DD-N`
- 变更类型：`non-breaking | breaking`
- 生效时间：`YYYY-MM-DD`
- 负责人：`owner`
- 影响指标：`deliveryRate / takeoverRate / ...`
- 旧口径摘要：
  - ...
- 新口径摘要：
  - ...
- 预期影响：
  - `none | recount | backfill | historically_incomparable`
- Dashboard 说明文案：
  - ...
- 运营动作：
  - ...
- 审计 / spec 引用：
  - ...
```

### 3. 报表头部版本说明文案模板

#### 3.1 non-breaking 变更模板

- 中文：
  - 当前报表使用成功度量口径 `{definitionVersion}`。本次为说明补强或证据补链，不改变主指标分子 / 分母，可与上一版连续对比。
- 英文：
  - This dashboard uses metrics definition `{definitionVersion}`. The change is non-breaking and does not alter the primary numerator / denominator rules.

#### 3.2 breaking 变更模板

- 中文：
  - 当前报表使用成功度量口径 `{definitionVersion}`。该版本调整了主指标纳入或时间锚点规则，与旧版本结果不宜直接横向比较。
- 英文：
  - This dashboard uses metrics definition `{definitionVersion}`. The change is breaking and historical results may not be directly comparable with prior versions.

## 验证与测试计划

### 1. 任务送达率口径验证用例

- 用例 1：合格任务终态为 delivered
  - 预期：`included = true`、`delivered = true`，同时进入分子与分母。
- 用例 2：合格任务终态为 failed
  - 预期：进入分母，不进入分子。
- 用例 3：`cancelled_before_route`
  - 预期：`included = false`，`excludeReason = cancelled_before_route`，不进入主分母。
- 用例 4：mission 标记完成但 runtime 送达证据缺失
  - 预期：样本可判定 delivered，但 `evidence.state = partial`。

### 2. 接管率与用户确认次数口径验证用例

- 用例 1：仅 advisory takeover
  - 预期：`advisoryTakeoverCount > 0`，但 `hadRequiredTakeover = false`，不进入接管率分子。
- 用例 2：同一任务多次 required takeover
  - 预期：`requiredTakeoverCount > 1`，但接管率主指标只按一个 mission 计数。
- 用例 3：budget / permission / risk / delivery 四类确认各发生一次
  - 预期：`userConfirmationCount = 4`，并在 audit 侧拆分到对应 confirmationType。
- 用例 4：用户只输入草稿未提交
  - 预期：不进入 `userConfirmationCount`。

### 3. 重规划率与偏航率口径验证用例

- 用例 1：retry 成功恢复但未改线
  - 预期：`replanCount = 0`，不进入重规划率分子。
- 用例 2：存在显式 `replan_started / replan_completed`
  - 预期：`hadReplan = true`，进入重规划率分子。
- 用例 3：执行发生非预期偏离，但未重规划
  - 预期：`hadDeviation = true`、`hadReplan = false`。
- 用例 4：计划内声明的备选分支切换
  - 预期：不记为偏航。

### 4. 完成时长阶段拆分验证用例

- 用例 1：完整经历 planning -> executing -> review -> terminal
  - 预期：可同时得出 `completionMs / planningMs / executingMs / reviewMs`。
- 用例 2：任务等待人工确认后恢复
  - 预期：`takeoverWaitMs` 等于 `takeover_requested -> takeover_resolved` 的累计等待时长。
- 用例 3：未终态任务
  - 预期：不得进入完成时长聚合，但可保留进行中监控字段。
- 用例 4：阶段事件缺失但总终态存在
  - 预期：总时长可算，缺失阶段字段留空，并将样本降级为 `partial`。

### 5. 结果复核通过率验证用例

- 用例 1：单轮复核通过
  - 预期：`reviewPassed = true`、`firstReviewPassed = true`。
- 用例 2：首轮失败、二轮通过
  - 预期：`reviewPassed = true`、`firstReviewPassed = false`。
- 用例 3：存在 `review_skipped`
  - 预期：不自动进入复核通过率主分母。
- 用例 4：多轮复核终态冲突
  - 预期：按最后一条终态事件决定主结论，并记录冲突说明。

### 6. 多源冲突与降级处理验证用例

- 用例 1：mission 与 runtime 终态不一致
  - 预期：`evidence.state = conflicted`，并记录 `terminal_state_mismatch`。
- 用例 2：audit 已确认提交，但 runtime 未恢复推进
  - 预期：确认次数保留，样本标记“恢复链路异常”。
- 用例 3：只有 replay 证据，没有主事实源
  - 预期：样本降级为 `partial`，不得被提升为主事实。
- 用例 4：同一事件被多源重复上报
  - 预期：只保留一个主事件进入统计，其他来源写入 `droppedFacts` 或附加证据。

### 7. replay / audit / dashboard 三方对账验证用例

- 用例 1：同一时间窗口下，dashboard 卡片钻取 mission 数与样本列表去重 mission 数一致
  - 预期：计数完全一致，否则视为聚合 / 钻取口径断裂。
- 用例 2：`hadDeviation = true` 的任务
  - 预期：replay 侧栏存在偏航锚点，且样本保留 `replayRefs`。
- 用例 3：`userConfirmationCount > 0` 的任务
  - 预期：audit 侧存在对应 `GovernanceEvidenceReference`。
- 用例 4：接管率与确认次数联动
  - 预期：必需接管可追到 takeover 请求与后续确认 / 恢复链路，不允许只见 dashboard 数字不见证据引用。

### 8. 历史数据回补后的口径稳定性验证用例

- 用例 1：只补 replay / audit 引用，不改变主分子 / 分母
  - 预期：聚合 rate 不变，样本 `partial -> complete`。
- 用例 2：历史样本依据新证据解除冲突
  - 预期：样本质量状态变化可见，但需保留更新时间记录。
- 用例 3：发生 non-breaking 版本变更
  - 预期：新旧报表可连续对比，并显示版本说明。
- 用例 4：发生 breaking 版本变更
  - 预期：报表头部明确提示不可直接横比，旧口径结果不得被静默覆盖。

## 兼容策略

### 策略 1：不再造新的底层真相源

本设计明确不建议：

- 新建一套脱离 `mission / runtime / audit / replay` 的指标专用主数据模型
- 由前端页面直接定义统计口径并反向成为事实标准

### 策略 2：投影层统一，事实层保持原名

建议通过：

- `mission -> success metric sample`
- `runtime -> metric event`
- `audit -> confirmation evidence`
- `replay -> drill-down timeline`

实现统一，而不是立刻改动大量底层命名。

### 策略 3：先稳定原子指标，再考虑综合分数

当前阶段不建议直接引入“自动驾驶成功分”作为主输出。
更合理的顺序是：

1. 先稳定七个原子指标
2. 再观察哪些指标在不同任务域有可比性
3. 最后才决定是否引入受控的复合评分

## 风险与边界

### 风险 1：把 replay 当成事实源

若直接以 replay 前端展示作为统计真相，会导致：

- 页面改版影响历史口径
- 前端容错逻辑污染指标
- 无法证明与底层事实一致

### 风险 2：把 retry 当成 replan

若普通重试和正式重规划不区分，会导致：

- 路线质量被误判
- 重规划率虚高
- 偏航恢复能力无法解释

### 风险 3：忽略样本排除规则

若测试、demo、纯人工、回灌任务混入分母，会导致：

- 送达率和接管率失真
- 环境之间不可比
- 运营判断被噪音污染

### 风险 4：不显示数据完整性

若 `partial` 与 `conflicted` 样本被静默吞并，最终会造成：

- 指标看似平滑，实则不可核查
- audit 与 dashboard 数字对不上
- 团队误以为口径已经稳定

## 设计结论

本 spec 的最终设计结论是：

1. 任务自动驾驶成功度量应建立统一的任务级样本模型
2. 七个核心指标必须具备明确分子、分母、时间锚点与排除规则
3. `mission / runtime / audit / replay` 应被整合为“事实源 + 投影层 + 消费层”的关系，而不是互相争夺主真相
4. replay 负责解释和核查，audit 负责治理证据，mission/runtime 负责执行事实
5. 所有聚合展示应从统一投影层派生，避免多套口径并存

## 审计补注（2026-04-24）

本轮对 `task-autopilot-success-metrics` 的推进采用“设计收口优先、实现落地后置”的保守口径。

### 本轮可确认已收口的部分

以下内容已经在本设计文档中形成足够明确、可复用、可被后续 specs 直接引用的结构化定义，因此可以视为设计层已完成：

- 成功度量体系的统一术语、总体分层与兼容原则
- `AutopilotMetricEvent` 归一化事件模型
- `AutopilotMissionMetrics` 任务级样本模型
- `AutopilotMetricsAggregate` 聚合结果模型
- `complete / partial / missing / conflicted` 数据完整性状态
- 任务送达率、接管率、用户确认次数、重规划率、偏航率、完成时长、结果复核通过率七个核心指标的口径定义
- `mission / runtime / audit / replay` 四类事实源的职责分工、冲突优先级与 `partial` 降级口径
- 接管 / 确认 / 重规划 / 偏航 / 复核 / 阶段耗时的派生逻辑锚点
- 聚合、钻取、时间窗口、聚合维度与 `avg / p50 / p90` 统计口径
- replay / audit 深链关联字段的设计入口
- 测试 / demo / 回灌样本排除策略，以及 `partial -> complete` 的回补原则
- 成功度量体系作为后续 cockpit / replay / audit specs 的依赖前置

### 本轮仍保守保留未完成的部分

以下项目前仍停留在方向性设计或需要代码 / 接口 /验证协同的阶段，因此不应在本轮提前写成已完成：

- 成功度量聚合接口、样本详情接口与上述消费契约的真实服务端实现
- cockpit / telemetry dashboard / replay / audit 对新契约的真实 UI 接入与对账验证
- 成功度量归一化事件生成器与聚合层的真实代码落地
- 设计中的验证矩阵转成自动化测试、回归测试与运营验收脚本

### 与当前主仓事实的关系

当前主仓已经存在大量可被未来成功度量消费的事实锚点，但尚未形成独立成功度量实现层：

- `shared/mission/autopilot.ts` 已暴露 drive state、route、takeover、recovery、evidence、explanation、remaining steps 等 autopilot summary 读模型
- `server/tasks/mission-projection.ts` 与 `server/tests/mission-routes.test.ts` 已证明这些读模型可以从 mission / workflow / runtime 事实投影到服务端接口
- `TaskAutopilotPanel`、`tasks-store` 及其测试已证明前端可以消费这类 autopilot projection

但这些现有事实锚点还不等于：

- 已有独立 `AutopilotMetricEvent` 流
- 已有独立 `AutopilotMissionMetrics` 样本
- 已有独立的成功度量聚合接口、dashboard 或 replay drill-down

因此，本轮只把“设计已经完整收口”的部分视为已完成，而不把“未来可以实现”的部分提前勾选。

## 审计补注（2026-04-25）

本轮继续按“只在设计层收口、不给实现层抢跑”的口径推进，新增完成项如下：

- 已补齐 cockpit / telemetry dashboard 消费契约
  - 明确区分了 cockpit 的“单任务样本 + 基线对比”消费模式
  - 明确区分了 dashboard 的“聚合结果 + 卡片 + 质量横幅”消费模式
- 已补齐 replay 侧栏消费成功度量样本的契约
  - 明确 replay 侧栏只消费任务级样本切片与指标锚点，不自行重算指标
- 已补齐 audit 侧消费确认次数与治理证据的契约
  - 明确确认次数拆分、治理证据引用与恢复链路异常提示
- 已补齐面向产品、运营、治理三类受众的指标解释文案
  - 七个核心指标均已给出三套稳定解释口径与使用提醒
- 已补齐口径变更记录与版本说明模板
  - 同时覆盖结构化记录、Markdown 模板和报表头部说明文案
- 已补齐验证与测试计划矩阵
  - 覆盖送达率、接管率、确认次数、重规划率、偏航率、完成时长、复核通过率、多源冲突、三方对账与历史回补稳定性

本轮可以保守认定为“成功度量 spec 的设计层剩余任务已经全部收口”，但边界仍然必须明确：

- 当前完成的是设计契约、验证矩阵与文档模板
- 不是服务端聚合接口、dashboard、replay 侧栏、audit 面板已经在主仓实现
- 也不是自动化测试、回归脚本和数据对账面板已经落地

因此，本 spec 当前的正确结论应是：

- 设计层可以收口为完成
- 实现层仍需后续 specs / code lane 单独推进，不应把 design done 写成 runtime or UI done

## 审计补注（2026-04-26）

本轮不新增勾选项，只做一次面向相邻 autopilot 热区 spec 的口径对齐审计，重点核对以下三组关系是否已经在本 spec 中被正确约束：

- 与 `task-autopilot-platform-positioning` 的关系
  - 当前平台对外一句话定义已经稳定收口为“面向复杂任务的任务自动驾驶平台”，本 spec 应与该叙事保持一致。
  - 因此，本 spec 在产品层解释指标时，可以沿用 `destination / route / drive state / takeover` 这一组高层术语。
- 与 `drive-state-and-replan-state-machine` 的关系
  - `driveState`、`replanning`、`takeover-required` 等高层状态，已经可以作为成功度量样本的解释维度、切片维度和 drill-down 辅助上下文。
  - 但它们仍不是本 spec 的主统计事实源，不能直接替代 `mission / runtime` 对生命周期、终态、重规划、偏航和阶段耗时的主判定责任。
- 与 `autopilot-explainability-and-telemetry` 的关系
  - 当前 explainability 已形成 `builder -> projection -> store -> task detail panel` 的最小摘要闭环，可为指标样本提供“为什么会这样算”的解释入口。
  - 但 `explanation`、`riskSummary`、`evidenceHints`、`telemetrySignals` 仍应被视为解释层和证据提示层，而不是新的分子 / 分母或独立指标事件流。

基于以上对齐，本轮进一步明确本 spec 的边界：

- 成功度量体系的主真相仍然来自 `mission / runtime / audit / replay` 四类事实源。
- `driveState` 与 explainability summary 可以帮助说明指标样本的状态、风险、接管背景和重规划语义，但不应反向替代指标事实判定。
- 近期 autopilot specs 的收口进度、README 口径统一、SVG 进度图更新，表达的是“文档与设计层推进情况”，不应被误读为“成功度量聚合服务、dashboard、replay drill-down 或自动化对账已经落地”。

因此，本轮维持原判断不变：

- 不新增任何 task 勾选
- 不修改需求层口径
- 只补强设计层审计边界，确保平台定位、Drive State、Explainability 与成功度量之间的责任分层继续清晰
