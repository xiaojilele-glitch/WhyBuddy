# 数据血缘追踪 — 设计文档

## 1. 架构概览

数据血缘追踪模块采用分层架构，嵌入到现有 WhyBuddy 的服务端和前端体系中：

```
┌─────────────────────────────────────────────────────┐
│                    前端层                             │
│  LineageDAGView · LineageTimeline · LineageHeatmap   │
│  lineage-store.ts (Zustand)                         │
├─────────────────────────────────────────────────────┤
│                    API 层                            │
│  /api/lineage/* REST 路由                            │
│  Socket lineage_event 实时推送                       │
├─────────────────────────────────────────────────────┤
│                    服务层                             │
│  LineageCollector (采集器)                            │
│  LineageQueryService (查询引擎)                      │
│  LineageAuditService (审计服务)                       │
│  ChangeDetectionService (变更检测)                    │
├─────────────────────────────────────────────────────┤
│                    存储层                             │
│  LineageStorageAdapter (接口)                         │
│  JsonLineageStorage (默认 JSON 文件)                  │
│  内存索引 (Map-based)                                │
├─────────────────────────────────────────────────────┤
│                    集成层                             │
│  RuntimeAgent lineageTracked 包装                    │
│  MissionStore 钩子                                   │
│  MissionDecision 钩子                                │
└─────────────────────────────────────────────────────┘
```

## 2. 核心数据模型

### 2.1 DataLineageNode（血缘节点）

```typescript
// shared/lineage/contracts.ts

export const LINEAGE_NODE_TYPES = ["source", "transformation", "decision"] as const;
export type LineageNodeType = (typeof LINEAGE_NODE_TYPES)[number];

export const LINEAGE_OPERATIONS = [
  "query", "filter", "aggregate", "join", "ml_inference",
  "transform", "enrich", "validate", "llm_call"
] as const;
export type LineageOperation = (typeof LINEAGE_OPERATIONS)[number] | string;

export interface LineageContext {
  sessionId?: string;
  userId?: string;
  requestId?: string;
  environment?: string;
  missionId?: string;
  workflowId?: string;
}

export interface DataLineageNode {
  lineageId: string;           // UUID v4
  type: LineageNodeType;
  timestamp: number;           // epoch ms
  context: LineageContext;

  // 源头节点字段 (type === "source")
  sourceId?: string;
  sourceName?: string;
  queryText?: string;
  resultHash?: string;         // SHA256
  resultSize?: number;

  // 变换节点字段 (type === "transformation")
  agentId?: string;
  operation?: LineageOperation;
  codeLocation?: string;       // "filename:line"
  parameters?: Record<string, unknown>;
  inputLineageIds?: string[];
  outputLineageId?: string;
  dataChanged?: boolean;
  executionTimeMs?: number;

  // 决策节点字段 (type === "decision")
  decisionId?: string;
  decisionLogic?: string;
  result?: string;
  confidence?: number;
  modelVersion?: string;

  // 通用
  metadata?: Record<string, unknown>;
  complianceTags?: string[];   // GDPR, PCI 等
  upstream?: string[];         // 上游 lineageId 列表
  downstream?: string[];       // 下游 lineageId 列表（运行时填充）
}
```

### 2.2 LineageEdge（血缘边）

```typescript
export const LINEAGE_EDGE_TYPES = [
  "derived-from", "input-to", "decided-by", "produced-by"
] as const;
export type LineageEdgeType = (typeof LINEAGE_EDGE_TYPES)[number];

export interface LineageEdge {
  fromId: string;              // 上游 lineageId
  toId: string;                // 下游 lineageId
  type: LineageEdgeType;
  weight?: number;             // 依赖权重 0-1
  timestamp: number;
}
```

### 2.3 AuditLogEntry（审计日志）

```typescript
export interface AuditLogEntry {
  id: string;
  userId: string;
  timestamp: number;
  dataId: string;
  agentId?: string;
  operation: string;
  decisionId?: string;
  result?: string;
  sourceIp?: string;
}
```

### 2.4 ChangeAlert（变更告警）

```typescript
export const CHANGE_ALERT_TYPES = [
  "schema_change", "data_volume_anomaly", "quality_degradation", "hash_mismatch"
] as const;
export type ChangeAlertType = (typeof CHANGE_ALERT_TYPES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface ChangeAlert {
  id: string;
  type: ChangeAlertType;
  dataId: string;
  previousHash?: string;
  currentHash?: string;
  affectedAgents: string[];
  affectedDecisions: string[];
  riskLevel: RiskLevel;
  timestamp: number;
  details?: string;
}

export interface DataQualityMetrics {
  dataId: string;
  freshness: number;           // 0-1，数据新鲜度
  completeness: number;        // 0-1，字段完整度
  accuracy: number;            // 0-1，准确度估计
  measuredAt: number;
}
```

## 3. 服务端设计

### 3.1 文件结构

```
server/lineage/
├── lineage-collector.ts       # 血缘采集器（异步、非阻塞）
├── lineage-store.ts           # 存储适配器 + JSON 默认实现
├── lineage-query.ts           # 图遍历查询引擎
├── lineage-audit.ts           # 审计日志 + 合规报告
├── change-detection.ts        # 数据变更检测 + 告警
├── lineage-export.ts          # 导入导出服务
└── index.ts                   # 模块入口

server/routes/
└── lineage.ts                 # REST API 路由

shared/lineage/
├── contracts.ts               # 类型定义（前后端共享）
├── api.ts                     # REST API 路由常量 + 请求/响应类型
└── index.ts                   # 模块导出
```

### 3.2 LineageCollector（采集器）

核心设计原则：异步采集、不阻塞业务逻辑、失败降级。

```typescript
// server/lineage/lineage-collector.ts

export class LineageCollector {
  private buffer: DataLineageNode[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 1000;
  private readonly maxBufferSize = 100;

  constructor(private store: LineageStorageAdapter) {}

  /** 记录数据源血缘（AC-1.1 ~ AC-1.5） */
  recordSource(input: RecordSourceInput): string;

  /** 记录 Agent 变换血缘（AC-2.1 ~ AC-2.6） */
  recordTransformation(input: RecordTransformationInput): string;

  /** 记录决策血缘（AC-3.1 ~ AC-3.5） */
  recordDecision(input: RecordDecisionInput): string;

  /** 异步刷写缓冲区到存储 */
  private flush(): Promise<void>;

  /** 计算 SHA256 哈希 */
  static computeHash(data: unknown): string;

  /** 捕获调用位置 */
  static captureCodeLocation(stackDepth?: number): string;
}
```

采集流程：
1. 调用方调用 `recordSource/recordTransformation/recordDecision`
2. 生成 `DataLineageNode`，写入内存缓冲区，立即返回 `lineageId`
3. 缓冲区满或定时器触发时，批量写入存储
4. 任何异常被 catch 并记录日志，不影响调用方

### 3.3 LineageStorageAdapter（存储适配器）

```typescript
// server/lineage/lineage-store.ts

export interface LineageStorageAdapter {
  /** 批量写入节点 */
  batchInsertNodes(nodes: DataLineageNode[]): Promise<void>;
  /** 批量写入边 */
  batchInsertEdges(edges: LineageEdge[]): Promise<void>;
  /** 按 ID 查询节点 */
  getNode(lineageId: string): Promise<DataLineageNode | undefined>;
  /** 按条件查询节点 */
  queryNodes(filter: LineageQueryFilter): Promise<DataLineageNode[]>;
  /** 查询边 */
  queryEdges(filter: LineageEdgeFilter): Promise<LineageEdge[]>;
  /** 删除过期数据 */
  purgeExpired(beforeTimestamp: number): Promise<number>;
  /** 统计信息 */
  getStats(): Promise<LineageStoreStats>;
}

export interface LineageQueryFilter {
  type?: LineageNodeType;
  agentId?: string;
  sessionId?: string;
  missionId?: string;
  decisionId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}
```

默认实现 `JsonLineageStorage`：
- 节点存储在 `data/lineage/nodes.jsonl`（JSONL 格式，追加写入）
- 边存储在 `data/lineage/edges.jsonl`
- 启动时加载到内存 Map，建立索引
- 内存索引：`byId`、`byAgent`、`bySession`、`byDecision`、`byTimestamp`

### 3.4 LineageQueryService（查询引擎）

```typescript
// server/lineage/lineage-query.ts

export class LineageQueryService {
  constructor(private store: LineageStorageAdapter) {}

  /** AC-5.1: 上游追溯（BFS） */
  async getUpstream(dataId: string, depth?: number): Promise<LineageGraph>;

  /** AC-5.2: 下游影响（BFS） */
  async getDownstream(dataId: string, depth?: number): Promise<LineageGraph>;

  /** AC-5.3: 完整链路（双向 BFS） */
  async getFullPath(sourceId: string, decisionId: string): Promise<LineageGraph>;

  /** AC-5.4: 影响分析 */
  async getImpactAnalysis(dataId: string): Promise<ImpactAnalysisResult>;
}

export interface LineageGraph {
  nodes: DataLineageNode[];
  edges: LineageEdge[];
}

export interface ImpactAnalysisResult {
  affectedNodes: DataLineageNode[];
  affectedDecisions: DataLineageNode[];
  riskLevel: RiskLevel;
  paths: LineageGraph;
}
```

图遍历算法：
- `getUpstream`：从目标节点出发，沿 `upstream` 方向 BFS，`depth` 控制最大层数（默认无限）
- `getDownstream`：从目标节点出发，沿 `downstream` 方向 BFS
- `getFullPath`：从 `sourceId` 做 BFS 到 `decisionId`，返回路径上所有节点和边
- `getImpactAnalysis`：调用 `getDownstream`，统计受影响的决策节点，根据决策数量和置信度计算风险等级

### 3.5 审计与合规

```typescript
// server/lineage/lineage-audit.ts

export class LineageAuditService {
  /** AC-6.1: 审计追踪 */
  async getAuditTrail(userId: string, timeRange: TimeRange): Promise<AuditLogEntry[]>;

  /** AC-6.3: 导出决策血缘报告（JSON 格式） */
  async exportLineageReport(decisionId: string): Promise<LineageReport>;

  /** AC-6.4: 异常检测 */
  async detectAnomalies(timeRange: TimeRange): Promise<ChangeAlert[]>;
}
```

### 3.6 变更检测

```typescript
// server/lineage/change-detection.ts

export class ChangeDetectionService {
  /** AC-8.1: 哈希对比检测变更 */
  async detectChanges(sourceId: string): Promise<ChangeAlert | null>;

  /** AC-8.2 + AC-8.3: 变更影响分析 + 告警 */
  async analyzeChangeImpact(alert: ChangeAlert): Promise<ImpactAnalysisResult>;

  /** AC-8.4: 时间点回溯 */
  async getStateAtTime(decisionId: string, timestamp: number): Promise<LineageGraph>;

  /** AC-8.5: 数据质量指标 */
  async measureQuality(dataId: string): Promise<DataQualityMetrics>;
}
```

### 3.7 导入导出

```typescript
// server/lineage/lineage-export.ts

export class LineageExportService {
  /** AC-10.1: 导出 */
  async exportLineage(startTime: number, endTime: number, format: "json" | "csv"): Promise<Buffer>;

  /** AC-10.3: 导入 */
  async importLineage(data: Buffer, format: "json" | "csv"): Promise<ImportResult>;

  /** AC-10.5: 增量导出 */
  async exportIncremental(sinceTimestamp: number, format: "json" | "csv"): Promise<Buffer>;
}
```

## 4. REST API 设计

```typescript
// shared/lineage/api.ts

export const LINEAGE_API = {
  // 查询
  getUpstream:       "GET    /api/lineage/:id/upstream",
  getDownstream:     "GET    /api/lineage/:id/downstream",
  getFullPath:       "GET    /api/lineage/path",
  getImpactAnalysis: "GET    /api/lineage/:id/impact",
  getNode:           "GET    /api/lineage/:id",
  queryNodes:        "GET    /api/lineage",

  // 审计
  getAuditTrail:     "GET    /api/lineage/audit/trail",
  exportReport:      "GET    /api/lineage/audit/report/:decisionId",
  detectAnomalies:   "GET    /api/lineage/audit/anomalies",

  // 导入导出
  exportLineage:     "GET    /api/lineage/export",
  importLineage:     "POST   /api/lineage/import",

  // 变更检测
  detectChanges:     "POST   /api/lineage/changes/detect",
  getQualityMetrics: "GET    /api/lineage/quality/:dataId",

  // 统计
  getStats:          "GET    /api/lineage/stats",
} as const;
```

## 5. Agent 框架集成

### 5.1 lineageTracked 包装方法

由于 TypeScript 装饰器在当前项目配置中未启用，采用高阶函数包装模式：

```typescript
// shared/runtime-agent.ts 扩展

export interface LineageTrackOptions {
  operation?: LineageOperation;
  metadata?: Record<string, unknown>;
}

// RuntimeAgent 新增方法
export class RuntimeAgent {
  /** AC-9.1 ~ AC-9.5: 血缘追踪包装 */
  lineageTracked<T>(
    fn: () => Promise<T>,
    options?: LineageTrackOptions
  ): Promise<T>;
}
```

使用方式：
```typescript
const result = await agent.lineageTracked(
  () => agent.invoke(prompt, context, opts),
  { operation: "ml_inference", metadata: { model_version: "v2" } }
);
```

### 5.2 MissionStore 钩子

在 `MissionStore` 的关键状态变更点注入血缘采集：
- `create()` → `recordSource()`
- `markDone()` → `recordDecision()`
- `resolveWaiting()` → `recordDecision()`

### 5.3 MissionDecision 钩子

在 `submitMissionDecision()` 成功后调用 `recordDecision()`，记录决策血缘。

## 6. 前端设计

### 6.1 文件结构

```
client/src/
├── components/lineage/
│   ├── LineageDAGView.tsx      # DAG 图（React Flow / 自定义 Canvas）
│   ├── LineageTimeline.tsx     # 时间轴视图
│   ├── LineageHeatmap.tsx      # 热力图
│   ├── LineageNodeDetail.tsx   # 节点详情面板
│   └── LineageExportButton.tsx # 导出按钮
├── lib/
│   └── lineage-store.ts       # Zustand store
└── pages/lineage/
    └── LineagePage.tsx         # 血缘追踪页面
```

### 6.2 Zustand Store

```typescript
// client/src/lib/lineage-store.ts

interface LineageState {
  graph: LineageGraph | null;
  selectedNodeId: string | null;
  filters: LineageFilters;
  loading: boolean;

  fetchUpstream(dataId: string, depth?: number): Promise<void>;
  fetchDownstream(dataId: string, depth?: number): Promise<void>;
  fetchFullPath(sourceId: string, decisionId: string): Promise<void>;
  fetchImpactAnalysis(dataId: string): Promise<void>;
  selectNode(nodeId: string | null): void;
  setFilters(filters: Partial<LineageFilters>): void;
}
```

### 6.3 DAG 可视化

使用 Canvas 2D 自绘 DAG（避免引入重量级依赖）：
- 节点按 type 着色：source=蓝色、transformation=绿色、decision=橙色
- 边用箭头表示方向
- 点击节点高亮完整链路
- 支持缩放和平移
- 导出为 PNG/SVG

## 7. Socket 事件

```typescript
// shared/lineage/socket.ts

export const LINEAGE_SOCKET_EVENTS = {
  nodeCreated: "lineage:node_created",
  alertTriggered: "lineage:alert_triggered",
} as const;
```

## 8. 数据保留策略

- 默认保留 90 天
- 通过环境变量 `LINEAGE_RETENTION_DAYS` 配置
- 每小时执行一次清理（通过 `setInterval`）
- 清理时调用 `store.purgeExpired()`

## 9. 性能约束

| 指标 | 目标 |
|------|------|
| 采集延迟 | < 10ms（异步缓冲） |
| 单条查询 | < 50ms |
| 完整链路查询 | < 500ms |
| 单条记录大小 | < 500 bytes |
| 内存占用（10 万节点） | < 100MB |

## 10. 测试策略

- 测试框架：Vitest
- 属性测试框架：fast-check
- 测试文件位置：`server/tests/lineage-*.test.ts`

### 正确性属性

- P1: 任何通过 `recordSource/recordTransformation/recordDecision` 创建的节点，都能通过 `getNode(lineageId)` 查询到
- P2: `getUpstream(id, depth)` 返回的所有节点都是 `id` 的直接或间接上游
- P3: `getDownstream(id, depth)` 返回的所有节点都是 `id` 的直接或间接下游
- P4: `getFullPath(sourceId, decisionId)` 返回的路径中，每条边的 `fromId` 节点在 `toId` 节点之前（拓扑序）
- P5: `computeHash(data)` 对相同输入始终返回相同结果（确定性）
- P6: 血缘采集失败不会抛出异常到调用方（降级保证）
- P7: `purgeExpired(timestamp)` 后，所有 `timestamp` 之前的节点不再可查询
- P8: 导出后再导入的数据与原始数据一致（往返一致性）
