# 需求文档：Autopilot Asset Staleness Model

## 简介

`/autopilot` blueprint 流当前是"一往无前"：用户从 STEP 1（输入 / 澄清 / 路线）推进到 STEP 2（SPEC 树 / SPEC 文档）后，STEP 1 不可再修改；后端既无 stage-locking 守卫，也无 invalidation 逻辑。结果是：如果绕过前端守卫直接修改上游（target / clarification / route）、或后续放开"原地编辑上游"能力，下游产物（spec_tree → spec_documents → effect_preview → prompt_packages → runtime → engineering_runs → artifact_ledger）会静默残留为陈旧状态，前端无任何视觉信号能告诉用户"此 SPEC 树是基于已被改写的目标生成的"。

本 spec 实现 `docs/autopilot-return-navigation-sequence-diagrams-2026-05-23.md` 中"自动使下游失效"语义中**最底层的数据模型与 invalidation 引擎**：

- 给每个 blueprint artifact 增加可选的 `staleSince` / `invalidatedBy` 字段；
- 定义 11 阶段 artifact 的有向无环依赖图（DAG），明确"上游 → 下游"的级联关系；
- 提供纯函数 `invalidateDownstream(job, fromStage)`，仅"标记"不"删除"，返回一个新的 job 对象；
- 在 `BlueprintGenerationJob` 暴露给前端的 shape 上承载这些字段，使 UI 后续可渲染"已过期"badge；
- 新增只读查询端点 `GET /api/blueprint/jobs/:jobId/stale-artifacts` 列出当前 stale 的 artifact id 与原因；
- 用 fast-check 验证 invalidation 的两条核心性质：幂等（idempotence）与单调（monotonicity）。

本 spec 是 5 个 spec 系列中的**第一个**，是后续 4 个 spec（"Replan from here" 按钮、上游编辑模式、版本历史与分支、前端原子状态协调）的数据基础。本 spec **不**实现任何 UI、不实现任何用户触发动作、不实现任何重新生成流程，也**不**修改既有 `DELETE /jobs/:jobId/route-selection`（它继续作为显式销毁式重置存在；本 spec 提供其非破坏性互补语义）。

本 spec 属于 Feature 类型，requirements-first 工作流。

## 术语表

- **Blueprint Artifact**：blueprint 流中每个 stage 产出的产物对象，对应 `BlueprintGenerationArtifact` 与下游具体类型（`BlueprintRouteSet`、`BlueprintRouteSelection`、`BlueprintSpecTree`、`BlueprintSpecDocument`、`BlueprintEffectPreview`、`BlueprintImplementationPromptPackage`、`BlueprintCapabilityInvocation`、`BlueprintEngineeringRun` 等）。
- **Upstream Artifact**：依赖图中位于变更点之前（含变更点本身）的 artifact。
- **Downstream Artifact**：依赖图中位于变更点之后的 artifact，必须随上游变更而被标记 stale。
- **Stale State**：artifact 上 `staleSince` 字段非空的状态。stale 是数据可见性属性，不是删除、不是隐藏、不是状态机状态。
- **Fresh State**：artifact 上 `staleSince` 字段为 `undefined`、`null` 或不存在的状态。这是默认状态。
- **Stale Marker**：写入到 artifact 上的两个可选字段对：`staleSince`（ISO 8601 timestamp）与 `invalidatedBy`（触发 staleness 的上游 artifact 标识符）。
- **Stage**：`BlueprintGenerationStage` 中已有的 11 个阶段值（`input` / `clarification` / `route_generation` / `spec_tree` / `spec_docs` / `preview` / `effect_preview` / `prompt_packaging` / `runtime_capability` / `engineering_handoff` / `engineering_landing`）；本 spec **不**新增 stage。
- **Asset Dependency Graph**：本 spec 定义的从 stage 到 stage 的有向无环图，描述"上游 stage 的产物变化必须级联标记下游 stage 的产物 stale"。
- **Invalidation Engine**：纯函数 `invalidateDownstream(job, fromStage, options?)`，输入 job 与起点 stage，返回新 job（artifact 上 stale 字段被填充）。
- **Cascading Invalidation**：起点 stage 之后的所有 stage 的 artifact 都必须被标记 stale，包括传递关系（A → B → C，标记 A 必须连带 B、C）。
- **Idempotent Invalidation**：对同一个 job、同一个 fromStage 调用 `invalidateDownstream` 两次，结果在结构上等价（新增的字段集合不变；已存在的 stale marker 不被覆盖为更新的 timestamp）。
- **Monotonic Staleness**：一旦某 artifact 被标记 stale，本 spec 的任何路径都不会主动清除该 marker；唯一允许清除的路径是后续 spec（regenerate 动作或显式 reset），由本 spec 的 API surface 显式不提供。
- **In-Memory Job Store**：服务端既有的 `BlueprintJobStore`（位于 `server/routes/blueprint/**`），以进程内 map 持有 `BlueprintGenerationJob`；本 spec 不引入持久化、不引入数据库迁移。
- **Stale Artifacts Endpoint**：本 spec 新增的只读路由 `GET /api/blueprint/jobs/:jobId/stale-artifacts`。
- **DELETE Route Selection Endpoint**：既有路由 `DELETE /api/blueprint/jobs/:jobId/route-selection`，作为显式破坏性重置；本 spec **不**修改其行为，仅与之共存。

## 需求

### 需求 1：Stale Marker 字段约定

**用户故事：** 作为前端开发者，我希望每个 blueprint artifact 上有统一、可选、向后兼容的字段表达"该 artifact 因为某个上游变更而过期"，以便我在 UI 上渲染"已过期"badge。

#### 验收标准

1.1 THE Shared_Blueprint_Contracts SHALL 在 `BlueprintGenerationArtifact` 上新增两个**可选**字段：`staleSince?: string`（ISO 8601 UTC timestamp）和 `invalidatedBy?: BlueprintStaleSource`，新增字段对既有 artifact 形态保持向后兼容。

1.2 THE Shared_Blueprint_Contracts SHALL 引入新类型 `BlueprintStaleSource`，包含字段：`stage: BlueprintGenerationStage`、`artifactId: string`、`artifactType: BlueprintGenerationArtifactType`、`reason: BlueprintStaleReason`、`triggeredAt: string`（ISO 8601 UTC）。

1.3 THE Shared_Blueprint_Contracts SHALL 引入新枚举 `BlueprintStaleReason`，初版取值为：`"upstream_target_changed"` / `"upstream_clarification_changed"` / `"upstream_route_changed"` / `"upstream_route_selection_changed"` / `"upstream_explicit_invalidation"`。

1.4 THE Shared_Blueprint_Contracts SHALL 在 `BlueprintGenerationJob` 上新增可选字段 `staleArtifactIds?: string[]`，仅作为快速索引；该字段为派生字段，权威真相源仍是各 artifact 上的 `staleSince`。

1.5 WHEN `staleSince` 字段为 `undefined` 或缺失，THE Frontend_And_Backend SHALL 将该 artifact 视为 fresh。

1.6 IF `staleSince` 非空，THEN THE Frontend_And_Backend SHALL 将该 artifact 视为 stale，且 `invalidatedBy` 字段必须同时非空。

1.7 THE Shared_Blueprint_Contracts SHALL NOT 修改任一既有字段的类型、可选性或语义；仅以**追加方式**引入上述新字段。

1.8 THE Shared_Blueprint_Contracts SHALL 在 `shared/blueprint/contracts.ts` 同一文件内导出上述新类型与枚举，与既有 blueprint 类型保持同一导出面。

### 需求 2：Asset Dependency Graph 定义

**用户故事：** 作为后端开发者，我希望有一份明确、可机器识别的依赖图，把 blueprint 11 个 stage 的产物之间的"上游 → 下游"关系表达成有向无环图，避免每个调用点重复硬编码。

#### 验收标准

2.1 THE Server_Blueprint_Module SHALL 在 `server/routes/blueprint/staleness/dependency-graph.ts` 中导出常量 `BLUEPRINT_ASSET_DEPENDENCY_GRAPH`，类型为 `Record<BlueprintGenerationStage, BlueprintGenerationStage[]>`，描述每个 stage 的**直接下游** stage 列表。

2.2 THE Server_Blueprint_Module SHALL 定义如下直接依赖关系（`upstream → [direct downstream...]`）：
  - `input → ["clarification"]`
  - `clarification → ["route_generation"]`
  - `route_generation → ["spec_tree"]`
  - `spec_tree → ["spec_docs"]`
  - `spec_docs → ["preview", "effect_preview"]`
  - `preview → ["effect_preview"]`
  - `effect_preview → ["prompt_packaging"]`
  - `prompt_packaging → ["runtime_capability"]`
  - `runtime_capability → ["engineering_handoff"]`
  - `engineering_handoff → ["engineering_landing"]`
  - `engineering_landing → []`

2.3 THE Server_Blueprint_Module SHALL 导出纯函数 `getTransitiveDownstreamStages(fromStage: BlueprintGenerationStage): BlueprintGenerationStage[]`，返回 `fromStage` 的所有传递下游 stage（不含 `fromStage` 自身），结果按 stage 在依赖图上的拓扑顺序排序。

2.4 THE Server_Blueprint_Module SHALL 导出纯函数 `isDownstreamOf(candidate: BlueprintGenerationStage, fromStage: BlueprintGenerationStage): boolean`，当且仅当 `candidate` 是 `fromStage` 的传递下游时返回 `true`。

2.5 THE Asset_Dependency_Graph SHALL 是有向无环图（DAG）；任一从 `fromStage` 出发的传递路径必须在有限步数内终止于 `engineering_landing` 或更早的 sink stage。

2.6 THE Server_Blueprint_Module SHALL 导出纯函数 `mapArtifactTypeToStage(artifactType: BlueprintGenerationArtifactType): BlueprintGenerationStage | undefined`，将既有 `BlueprintGenerationArtifactType` 取值映射到所属 stage；映射关系覆盖既有所有取值，未明确归属的取值返回 `undefined`。

2.7 THE Asset_Dependency_Graph SHALL NOT 引入新的 stage 取值；如未来需要新增 stage，需要单独 spec 推进。

### 需求 3：Invalidation Engine 行为

**用户故事：** 作为后端开发者，我希望有一个纯函数把"标记下游 stale"的复杂逻辑隔离开来，使其易于推理、易于测试、易于在不同触发点（route-selection 改写、target 改写、未来的 replan 动作）复用。

#### 验收标准

3.1 THE Server_Blueprint_Module SHALL 在 `server/routes/blueprint/staleness/invalidate-downstream.ts` 中导出纯函数：

```text
invalidateDownstream(
  job: BlueprintGenerationJob,
  fromStage: BlueprintGenerationStage,
  options?: BlueprintInvalidateDownstreamOptions
): BlueprintGenerationJob
```

其中 `BlueprintInvalidateDownstreamOptions` 至少包含：`reason: BlueprintStaleReason`、`triggeringArtifactId: string`、`triggeringArtifactType: BlueprintGenerationArtifactType`、`now?: () => string`（默认使用 `() => new Date().toISOString()`）。

3.2 THE Invalidation_Engine SHALL 返回一个**新**的 `BlueprintGenerationJob` 对象（不可变更新），SHALL NOT 修改入参 `job` 或入参 `job` 中任一嵌套对象（深度不可变）。

3.3 WHEN 调用 `invalidateDownstream(job, fromStage, options)`，THE Invalidation_Engine SHALL 对每个 artifact 满足以下条件之一时写入 stale marker：
  - 该 artifact 的所属 stage 等于 `fromStage` 之外的 `getTransitiveDownstreamStages(fromStage)` 中的某个 stage；
  - 即：`fromStage` 自身的产物 SHALL NOT 被本次调用标记 stale（标记上游本身改由调用方语义负责）。

3.4 WHEN 某个下游 artifact 的 `staleSince` 已经非空（已是 stale），THE Invalidation_Engine SHALL NOT 覆盖既有的 `staleSince` / `invalidatedBy`；保留首次标记时的 marker。

3.5 WHEN 某个下游 artifact 的 `staleSince` 为空（fresh），THE Invalidation_Engine SHALL 写入：`staleSince = options.now()`、`invalidatedBy = { stage: fromStage, artifactId: options.triggeringArtifactId, artifactType: options.triggeringArtifactType, reason: options.reason, triggeredAt: options.now() }`。

3.6 THE Invalidation_Engine SHALL 同步刷新 `job.staleArtifactIds` 为当前 job 中所有 `staleSince` 非空的 artifact id 的去重数组（顺序按 `BlueprintGenerationArtifact` 在 `job.artifacts` 中的原始顺序），用于快速索引。

3.7 THE Invalidation_Engine SHALL NOT 删除任一 artifact、SHALL NOT 修改 artifact 的 `payload` / `summary` / `title` / `createdAt`、SHALL NOT 改变 `BlueprintGenerationJob` 的 `status` / `stage` / `handoffState` / `nextAction` / `events` / `error`。

3.8 THE Invalidation_Engine SHALL 把 stale marker 同步写入 `job.artifacts` 数组中对应 artifact，以及 job 上所引用到的 stage-specific 子结构（包括但不限于 `BlueprintRouteSet`、`BlueprintRouteSelection`、`BlueprintSpecTree`、`BlueprintSpecDocument`、`BlueprintEffectPreview`、`BlueprintImplementationPromptPackage`、`BlueprintCapabilityInvocation`、`BlueprintEngineeringRun`）。具体写入位置由实现层在 design 阶段确定，但所有最终对外可见的下游 artifact 都必须能被遍历到。

3.9 IF `fromStage` 不在 `BlueprintGenerationStage` 的合法取值集合中，THEN THE Invalidation_Engine SHALL 返回与入参 `job` 在结构上等价的 job 对象（不抛错，不写入任何 stale marker）。

3.10 IF 入参 `job` 中没有任何 artifact 的 stage 属于 `getTransitiveDownstreamStages(fromStage)`，THEN THE Invalidation_Engine SHALL 返回与入参 `job` 在结构上等价的 job 对象（不抛错，不写入任何 stale marker）。

### 需求 4：幂等性（Idempotence）

**用户故事：** 作为后端开发者，我希望对同一个 job 重复调用 invalidation engine 是安全的，避免在并发或重试场景下产生不一致的 stale marker。

#### 验收标准

4.1 WHEN 对同一个 `job`、同一个 `fromStage`、同一个 `options` 连续调用 `invalidateDownstream` 两次，THE Invalidation_Engine SHALL 满足：第二次返回的 job 与第一次返回的 job 在所有 artifact 的 `staleSince` / `invalidatedBy` 字段上结构等价。

4.2 WHEN 第二次调用使用与第一次不同的 `options.now()`，THE Invalidation_Engine SHALL NOT 因 timestamp 差异覆盖第一次写入的 `staleSince`；即 timestamp 由首次标记决定。

4.3 THE Invalidation_Engine SHALL 通过 fast-check property test 验证幂等性，迭代次数 SHALL ≥ 100，覆盖随机生成的 job 形态与随机的 fromStage。

### 需求 5：单调性（Monotonicity）

**用户故事：** 作为后端开发者，我希望 stale 状态一旦写入就不会被本 spec 提供的任何 API 默默清除，避免在级联调用中"上一次调用标记 stale，下一次调用清除 stale"这种倒退。

#### 验收标准

5.1 THE Invalidation_Engine SHALL 满足：对任一 artifact `a`，若调用 `invalidateDownstream` 之前 `a.staleSince` 非空，则调用之后 `a.staleSince` 仍非空且与调用前等价。

5.2 THE Stale_Artifacts_Endpoint SHALL NOT 提供清除 stale marker 的能力。

5.3 THE Server_Blueprint_Module SHALL NOT 在本 spec 内导出"清除 stale marker"的纯函数；如未来需要，应由后续 spec（replan / regenerate）显式添加。

5.4 THE Invalidation_Engine SHALL 通过 fast-check property test 验证单调性：对随机生成的 job 序列、随机的 fromStage 序列、连续应用 `invalidateDownstream`，已被标记 stale 的 artifact 的 stale marker 在序列结束时仍非空。迭代次数 SHALL ≥ 100。

### 需求 6：Stale 状态不阻塞读取

**用户故事：** 作为前端开发者，我希望 stale artifact 仍然可以正常读取与展示，UI 层只决定是否加 badge、是否提醒，不需要在数据层做特殊处理。

#### 验收标准

6.1 THE Stale_State SHALL 是纯数据可见性属性；既有所有 GET 端点（`GET /api/blueprint/jobs/:jobId`、`GET /api/blueprint/jobs/:jobId/spec-tree` 等）SHALL 继续返回 stale artifact 的完整内容，与 fresh artifact 在响应形态上完全一致。

6.2 THE Backend SHALL NOT 在任一既有路由上根据 stale 状态返回 4xx / 5xx；stale 状态 SHALL NOT 导致请求被拒绝。

6.3 THE Backend SHALL NOT 因为某 artifact 是 stale 而阻塞、延迟或丢弃后续 generation 请求；本 spec 不引入任何 generation 守卫。

6.4 THE Backend SHALL NOT 因为某 artifact 是 stale 而触发自动重新生成；任何 regenerate 行为由后续 spec 显式触发。

### 需求 7：Stale Artifacts 查询端点

**用户故事：** 作为前端开发者或运维人员，我希望有一个简单的只读端点能列出某个 job 当前哪些 artifact 是 stale 的，以及为什么 stale，便于排障与 UI 总览展示。

#### 验收标准

7.1 THE Backend SHALL 新增只读路由 `GET /api/blueprint/jobs/:jobId/stale-artifacts`，使用现有 blueprint 路由的同款入参解析与错误处理形态。

7.2 WHEN `jobId` 在 In-Memory_Job_Store 中存在，THE Stale_Artifacts_Endpoint SHALL 返回 HTTP 200 + 响应体形态：
```json
{
  "jobId": "string",
  "generatedAt": "ISO-8601",
  "staleArtifacts": [
    {
      "artifactId": "string",
      "artifactType": "BlueprintGenerationArtifactType",
      "stage": "BlueprintGenerationStage",
      "staleSince": "ISO-8601",
      "invalidatedBy": {
        "stage": "BlueprintGenerationStage",
        "artifactId": "string",
        "artifactType": "BlueprintGenerationArtifactType",
        "reason": "BlueprintStaleReason",
        "triggeredAt": "ISO-8601"
      }
    }
  ]
}
```

7.3 IF `jobId` 在 In-Memory_Job_Store 中不存在，THEN THE Stale_Artifacts_Endpoint SHALL 返回 HTTP 404 + `{ "error": "job_not_found" }`，与既有 blueprint 路由 404 风格一致。

7.4 WHEN job 存在但不包含任一 stale artifact，THE Stale_Artifacts_Endpoint SHALL 返回 HTTP 200 + `staleArtifacts: []`（空数组而非 404）。

7.5 THE Stale_Artifacts_Endpoint SHALL 对响应中的 artifact 顺序按 `BlueprintGenerationArtifact` 在 `job.artifacts` 中的原始下标升序排列。

7.6 THE Stale_Artifacts_Endpoint SHALL 是只读端点，HTTP 方法仅 `GET`；SHALL NOT 接受 `POST` / `PUT` / `PATCH` / `DELETE`。

7.7 THE Stale_Artifacts_Endpoint SHALL NOT 对响应做缓存头改写、SHALL NOT 引入分页参数、SHALL NOT 引入认证字段（沿用现有 blueprint 路由的鉴权策略）。

7.8 THE Stale_Artifacts_Endpoint 的实现 SHALL 直接遍历 In-Memory_Job_Store 中的 job 对象，使用纯函数构造响应；SHALL NOT 触发 LLM 调用、Docker 调用、MCP 调用或其他外部副作用。

### 需求 8：向后兼容性与零迁移

**用户故事：** 作为依赖现有 in-memory job store 的运行实例，我希望本 spec 落地后既有 job 继续工作、既有响应结构不破坏、既有测试不修改。

#### 验收标准

8.1 THE Feature SHALL NOT 引入数据库迁移、SHALL NOT 引入磁盘持久化变更、SHALL NOT 修改 In-Memory_Job_Store 的初始化逻辑。

8.2 WHEN 一个既有 job 中的 artifact 不包含 `staleSince` 字段（即字段为 `undefined` 或缺失），THE Frontend_And_Backend SHALL 将该 artifact 视为 fresh，行为与新 job 中明确未标记的 artifact 一致。

8.3 THE Feature SHALL NOT 修改既有路由 `POST /api/blueprint/jobs`、`POST /api/blueprint/generations`、`GET /api/blueprint/jobs/:jobId`、`DELETE /api/blueprint/jobs/:jobId/route-selection` 的请求形态、响应 schema 或既有字段；只允许向响应中以**追加方式**附带新可选字段。

8.4 THE Feature SHALL NOT 修改 `shared/blueprint/contracts.ts` 中任一既有字段；既有 `BlueprintGenerationArtifact` / `BlueprintGenerationJob` 的字段集合 SHALL 是新形态的子集。

8.5 THE Feature SHALL NOT 修改、删除或调整 `server/tests/blueprint-routes.test.ts` 中任一既有 E2E 用例的断言；SHALL NOT 修改既有 bridge 或路由层单测；只允许新增测试。

8.6 WHEN 本 spec 落地后执行 `npx vitest --config vitest.config.server.ts --run`，所有既有测试 SHALL 保持通过状态；新增的 fast-check property test 与新增 example test SHALL 在同一次运行中通过。

8.7 THE Feature SHALL NOT 影响 GitHub Pages 静态预览路径（`npm run build:pages`）；纯前端预览的运行时 SHALL 在 stale 字段缺失时按 fresh 处理，不报错、不抛 schema 校验异常。

### 需求 9：与 DELETE Route Selection 的关系

**用户故事：** 作为产品维护者，我希望本 spec 引入的"非破坏性 stale 标记"与既有"破坏性 route selection 重置"清晰分离，避免互相覆盖、互相干扰。

#### 验收标准

9.1 THE Feature SHALL NOT 修改 `DELETE /api/blueprint/jobs/:jobId/route-selection` 的请求 / 响应 / 副作用；该端点继续作为显式销毁式重置存在。

9.2 THE Feature SHALL NOT 在 `DELETE /api/blueprint/jobs/:jobId/route-selection` 内自动调用 Invalidation_Engine；本 spec 仅定义并暴露引擎，触发逻辑由后续 spec（replan、上游编辑）负责。

9.3 THE Stale_Artifacts_Endpoint SHALL 与 `DELETE /api/blueprint/jobs/:jobId/route-selection` 互不依赖；调用顺序任意、各自语义不变。

9.4 WHERE 后续 spec（"Replan from here"、上游编辑模式）需要在保留 artifact 的同时表达"上游已变"，THE Invalidation_Engine SHALL 是其默认的标记途径；本 spec 仅承诺暴露能力，不承诺接线。

### 需求 10：属性测试与示例测试覆盖

**用户故事：** 作为代码评审人，我希望本 spec 有清晰的测试覆盖证据，包括 fast-check property test 与 example-based unit test，验证依赖图、引擎、端点的正确性。

#### 验收标准

10.1 THE Feature SHALL 在 `server/routes/blueprint/staleness/__tests__/` 下添加至少 3 组测试文件：
  - `dependency-graph.test.ts`：example-based，覆盖 `getTransitiveDownstreamStages` / `isDownstreamOf` / `mapArtifactTypeToStage` 的关键场景与边界（含未知 stage、单一 stage、链尾 stage、并联下游）。
  - `invalidate-downstream.test.ts`：包含 fast-check property test，覆盖幂等性（需求 4）、单调性（需求 5）；迭代次数 ≥ 100；同时包含 example-based 测试覆盖需求 3 的写入规则、深度不可变、`fromStage` 不合法时的容错。
  - `stale-artifacts-route.test.ts`：example-based，覆盖需求 7 的全部验收标准（200 / 404、空数组、顺序、只读语义、不引入副作用）。

10.2 THE Property_Tests SHALL 使用 fast-check 提供的 `fc.assert` + `fc.property` 组合；SHALL NOT 使用 `it.skip` 或 `describe.skip` 默认跳过。

10.3 THE Property_Tests 的 arbitrary 生成器 SHALL 至少能覆盖：空 artifact 列表的 job、所有 stage 都有 artifact 的 job、部分 stage 已有 stale marker 的 job、随机的 fromStage（包含合法与不合法值）。

10.4 THE Feature SHALL NOT 引入新的测试运行入口；新增测试 SHALL 通过 `vitest.config.server.ts` 既有的 server-side test runner 自动发现并运行。

10.5 IF 在测试中需要构造 `BlueprintGenerationJob` 样例，THE Test_Files SHALL 优先复用既有 `server/routes/blueprint/**/__tests__/` 目录下的 fixture / factory；如必须新增 factory，SHALL 放在 `server/routes/blueprint/staleness/__tests__/__fixtures__/` 下，避免污染既有目录。

### 需求 11：日志与可观测性

**用户故事：** 作为排障人员，我希望 invalidation 行为在 server 日志中可见，便于复现"为什么这个 spec_tree 突然变成 stale 的"。

#### 验收标准

11.1 WHEN `invalidateDownstream` 写入了至少 1 个 stale marker，THE Server_Blueprint_Module SHALL 通过既有 logger（`ctx.logger.info` 或等价路径）输出一条结构化日志，至少包含：`jobId`、`fromStage`、`reason`、`triggeringArtifactId`、`markedArtifactCount`。

11.2 WHEN `invalidateDownstream` 写入了 0 个新 marker（包括幂等场景与无下游场景），THE Server_Blueprint_Module SHALL 输出一条 `debug` 级日志，至少包含：`jobId`、`fromStage`、`alreadyStaleCount`，`info` 级 SHALL NOT 输出。

11.3 THE Stale_Artifacts_Endpoint SHALL NOT 在每次请求时输出 `info` 日志（避免轮询场景污染日志）；可选输出 `debug` 级简要摘要。

11.4 THE Logging SHALL NOT 输出任何 artifact `payload` 内容、SHALL NOT 输出 LLM prompt、SHALL NOT 输出 GitHub URL / API key / token 等敏感信息；仅输出 id / type / stage 等元数据。

### 需求 12：范围边界与不在范围内事项

**用户故事：** 作为代码评审人与后续 spec 作者，我希望明确本 spec 的范围边界，以及哪些相关工作必须被排除并由系列后续 spec 推进。

#### 验收标准

12.1 THE Feature SHALL NOT 引入"Replan from here" 用户触发动作或对应路由；该动作由系列 spec 2 推进。

12.2 THE Feature SHALL NOT 引入"在浏览页面时编辑上游表单"的 UI 模式或对应数据流；该模式由系列 spec 3 推进。

12.3 THE Feature SHALL NOT 引入版本历史、版本快照、版本分支、版本切换的 API 或数据结构；该能力由系列 spec 4 推进。

12.4 THE Feature SHALL NOT 引入前端动画、stale 状态原子协调、跨组件刷新策略；该能力由系列 spec 5 推进。

12.5 THE Feature SHALL NOT 实现 UI 层的"已过期"badge、提示语、视觉态；本 spec 仅提供后端数据基础与契约字段。

12.6 THE Feature SHALL NOT 在任一现有的"修改上游"代码路径（route-selection 改写、target 改写、clarification 改写）内自动接线 Invalidation_Engine；接线由后续 spec 显式完成。本 spec 仅承诺：`invalidateDownstream` 函数被导出且可被未来调用。

12.7 THE Feature SHALL NOT 修改 mission runtime、workflow runtime、tasks-store、Office Task Cockpit、Web-AIGC runtime、autopilot 节点 11 阶段任一既有能力；本 spec 仅在 blueprint 路由层与 shared blueprint contracts 内活动。

12.8 THE Feature SHALL NOT 引入新的 socket 事件、新的 `BlueprintEventName`、新的审计通道、新的持久化存储；本 spec 是纯内存、纯函数、纯只读端点的最小增量。

12.9 IF 实现过程中发现需要联动既有"修改上游"代码路径自动调用引擎，THE Feature SHALL 把该联动延后到系列 spec 2 / spec 3 的范围内推进，并在本 spec 的 design 阶段以注释或 TODO 标记接线点位，但 SHALL NOT 在本 spec 内实施接线。
