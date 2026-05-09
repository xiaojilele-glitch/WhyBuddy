# 实施任务：Autopilot Capability Bridge — AIGC Spec Node

## 概述

本任务清单把 design 文档 §9 的 16 步实现大纲收敛为 22 个可验证的代码任务，覆盖：

- `shared/blueprint/contracts.ts` 的 provenance 可选字段扩展（6 个新增可选字段 + evidence 的 `structuredPayload?` 可选对象；复用 Docker 桥已追加的 `executionMode` / `error`，复用 MCP 桥追加的 7 个字段）
- `BlueprintServiceContext` 的 2 个可选依赖字段扩展（`aigcSpecNodeCapabilityPolicy?` + `aigcSpecNodeCapabilityBridge?`；**不改 `ctx.llm` 字段** — 这是本 spec 相对 Docker / MCP 桥最轻的改造）
- `server/routes/blueprint/aigc-spec-node/` 下 5 个新模块（schema / policy / prompt / summary-derivation / bridge）及其 co-located 单测
- `buildBlueprintServiceContext` 的默认装配
- `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 aigc-spec-node 分支（Docker 桥已改为 async），以及 input 追加 `clarificationSession?` 可选字段与调用点透传
- `buildCapabilityEvidence` 的 provenance 继承 + 针对 real 路径构造 `evidence.provenance.structuredPayload`
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E（Real LLM / Fallback）
- 最终全量回归

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：1（契约） → 2（context 字段） → 3、4（schema + 单测） → 5、6（policy + 单测） → 7、8（prompt + 单测） → 9、10（summary-derivation + 单测） → 11（纯模块 checkpoint） → 12、13（bridge 主逻辑 + 单测） → 14（完整子域 checkpoint） → 15（context 默认装配） → 16、17、18（blueprint.ts 改造：clarificationSession 透传 / 分支 / adapter + evidence） → 19（既有子域回归 checkpoint） → 20（E2E 追加） → 21（SDK 透传） → 22（全量回归 + 最终验收）。

需求 9.3 明确锁定本 spec **不引入 PBT**；所有单测均为 example-based，共 ~31 条 co-located 单测 + 2 条 E2E。design §7 给出的 10 条 Correctness Properties 以 example-based 单测等价覆盖（schema.test 8 + prompt.test 6 + policy.test 6 + summary-derivation.test 4 + bridge.test 7）。

## 任务列表

- [x] 1. 在 `shared/blueprint/contracts.ts` 扩展 provenance 可选字段
  - [x] 1.1 在 `BlueprintCapabilityInvocation.provenance` 类型中追加 6 个可选字段：`promptId?: string`、`model?: string`、`responseDigest?: string`、`tokenCount?: number`、`structuredPayloadDigest?: string`、`promptFingerprint?: string`;`executionMode` / `error` 由 Docker 桥 spec 追加，本 spec 直接复用；MCP 桥追加的 `executionPath` / `repoUrl` / `commitSha` / `fetchedAt` / `defaultBranch` / `apiResponseDigest` / `mcpToolName` 保持原样存在;不删除、不重命名、不修改任何既有字段（保留 `jobId` / `projectId` / `sourceId` / `routeSetId` / `routeId` / `specTreeId` / `nodeId` / `roleId` / `targetText` / `githubUrls` 原样）
  - [x] 1.2 在 `BlueprintCapabilityEvidence.provenance` 类型中追加同样 6 个可选字段，与 invocation 侧字段含义、命名、类型严格一致;额外追加 `structuredPayload?: { digest: string; byteSize: number; summary: string }` 可选对象（承载结构化 spec-shape JSON 的摘要引用，design §2.D8 选项 A）
  - [x] 1.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误（历史类型债不应扩大）;同时 grep 既有 `provenance:` 消费点确认没有因字段追加而断言失败
  - _Requirements: 3.5, 4.4, 4.5, 5.2, 5.4, 8.1, 8.3_

- [x] 2. 在 `server/routes/blueprint/context.ts` 扩展 `BlueprintServiceContext` 依赖字段
  - [x] 2.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 2 个可选字段：`aigcSpecNodeCapabilityPolicy?: AigcSpecNodeCapabilityPolicy`、`aigcSpecNodeCapabilityBridge?: AigcSpecNodeCapabilityBridge`;类型仅 `import type`，不 import 工厂实现避免循环依赖
  - [x] 2.2 **不改 `ctx.llm` 字段**：`ctx.llm.callJson` / `ctx.llm.getConfig` 已在 wt1 的 `buildBlueprintServiceContext` 中默认装配为 `callLLMJson` / `getAIConfig`，本 spec 只消费不扩展（需求 7.5）;bridge 内部 SHALL NOT `import { callLLMJson }` / `import { getAIConfig }`
  - [x] 2.3 保持向后兼容：`buildBlueprintServiceContext(deps)` 在 `deps` 未提供 policy / bridge 字段时仍能构造出合法 Context，既有单测与 E2E 无感知（字段默认装配在任务 15 中处理，本任务只保证"类型可选且不传也不崩"）
  - [x] 2.4 运行 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 7.1, 7.3, 7.5, 8.2_

- [x] 3. 新建 `server/routes/blueprint/aigc-spec-node/schema.ts`
  - [x] 3.1 按 design §4.4 定义并导出 `AigcSpecNodeResponseSchema`：`z.object({ subsystems: z.array(z.string().min(1).max(80)).min(1).max(10), riskNotes: z.array(z.string().min(1).max(200)).min(0).max(10), dataFlowSketch: z.string().max(500).optional(), confidence: z.number().min(0).max(1).optional() })`;**不使用 `.strict()`**（zod 默认 strip 行为静默丢弃未知字段，需求 3.3 + design §2.D9）;**禁止** 任何 `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` 之类的 coerce 链（需求 3.2）
  - [x] 3.2 导出类型别名 `export type AigcSpecNodeResponse = z.infer<typeof AigcSpecNodeResponseSchema>`
  - [x] 3.3 **禁止** 在本文件 `import` 任何运行时 / 业务模块;仅 `import { z } from "zod"`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. 新建 `server/routes/blueprint/aigc-spec-node/schema.test.ts`
  - [x] 4.1 合法 minimal payload：`{ subsystems: ["A"], riskNotes: [] }` 通过;合法 full payload：`{ subsystems: ["A","B","C"], riskNotes: ["r1","r2"], dataFlowSketch: "x→y→z", confidence: 0.78 }` 通过
  - [x] 4.2 `subsystems` 缺失 → `safeParse` 返回 `success: false`
  - [x] 4.3 `subsystems: []`（空数组）→ 失败（违反 `.min(1)`）;`subsystems: ["a".repeat(11).split("").map(...)...] ` 11 项 → 失败（违反 `.max(10)`）
  - [x] 4.4 `subsystems: ["a".repeat(81)]` → 失败（单项过长）;`subsystems: [""]` → 失败（空字符串违反 `.min(1)`）
  - [x] 4.5 `riskNotes: ["a".repeat(201)]` → 失败;`riskNotes: Array(11).fill("x")` → 失败（违反 `.max(10)`）
  - [x] 4.6 `dataFlowSketch: "a".repeat(501)` → 失败;`dataFlowSketch: 123` → 失败（类型错）
  - [x] 4.7 `confidence: -0.1` → 失败;`confidence: 1.1` → 失败;`confidence: "0.5"` → 失败（类型错）
  - [x] 4.8 未知字段 `{ subsystems: ["A"], riskNotes: [], domainOntology: { entities: ["e1"] } }` → **通过**，且 `parsed.data` 不包含 `domainOntology`（zod 默认 strip，需求 3.3）
  - _Requirements: 3.1, 3.2, 3.3, 9.2_

- [x] 5. 新建 `server/routes/blueprint/aigc-spec-node/policy.ts`
  - [x] 5.1 按 design §4.3 定义并导出 `AigcSpecNodeCapabilityPolicy` 接口（字段：`maxInvocationTimeoutMs` / `temperature` / `maxLogLines` / `maxLogBytes` / `maxStructuredPayloadSummaryBytes` / `redactionKeywords` / `redactedEmailPattern` / `redactedApiKeyPattern` / `redactedGithubPatPattern` / `callJsonRetryAttempts`）
  - [x] 5.2 导出 `createDefaultAigcSpecNodeCapabilityPolicy()`:默认 `maxInvocationTimeoutMs: 30_000`（env `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS` 覆盖；非法或 > 30000 时 clamp 回 30000）/ `temperature: 0.2` / `maxLogLines: 20` / `maxLogBytes: 4_096` / `maxStructuredPayloadSummaryBytes: 300` / `redactionKeywords: ["authorization","token","api_key","apikey","secret","password","bearer","access_token","x-github-token","openai-api-key"]` / `redactedEmailPattern: /[\w.+-]+@[\w.-]+/g` / `redactedApiKeyPattern: /\b(sk-[A-Za-z0-9]{20,}|clp_[A-Za-z0-9]{20,})\b/g` / `redactedGithubPatPattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g` / `callJsonRetryAttempts: 1`
  - [x] 5.3 导出 `applyAigcNodeCapabilityRedaction(value: string, policy): string` 纯函数:依次替换 API key → GitHub PAT → email → `redactionKeywords` 的 key:value 对（大小写不敏感，使用 `escapeRegex` 转义 keyword 避免正则注入）;返回脱敏后的字符串
  - [x] 5.4 **禁止** 在本文件 `import` 任何运行时依赖;纯数据 + 纯函数 only
  - _Requirements: 2.4, 4.6, 7.4_

- [x] 6. 新建 `server/routes/blueprint/aigc-spec-node/policy.test.ts`
  - [x] 6.1 `applyAigcNodeCapabilityRedaction` 把 `"key=sk-ABCDEFGHIJKLMNOP1234567890"` 中 token 替换为 `[redacted-api-key]`;把 `"ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"` 替换为 `[redacted-github-token]`;把 `"github_pat_abcdefghijklmnopqrstuv"` 替换为 `[redacted-github-token]`
  - [x] 6.2 `applyAigcNodeCapabilityRedaction("user@example.com")` 返回 `"[redacted-email]"`
  - [x] 6.3 `applyAigcNodeCapabilityRedaction("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")` 返回形如 `"Authorization: [redacted]"`;`applyAigcNodeCapabilityRedaction("api_key=superSecret123")` 返回 `"api_key: [redacted]"`（或等价脱敏形态）
  - [x] 6.4 断言 `createDefaultAigcSpecNodeCapabilityPolicy()` 返回值的每个字段与 design §4.3 默认值严格一致;`maxInvocationTimeoutMs === 30_000` / `temperature === 0.2` / `callJsonRetryAttempts === 1`
  - [x] 6.5 断言 `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS=15000` 环境变量覆盖生效（使用 `vi.stubEnv` 或等价机制），返回 `maxInvocationTimeoutMs === 15_000`;`BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS=99999` 被 clamp 回 `30_000`;`BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_TIMEOUT_MS=abc` 非法值 fallback 回 `30_000`
  - [x] 6.6 ReDoS 哨兵：`applyAigcNodeCapabilityRedaction` 处理 5MB 普通文本（不含敏感 marker）在 200ms 内返回（性能下限保护，不强制硬 SLA，但避免未来正则回溯爆炸）
  - _Requirements: 2.4, 4.6, 7.4, 9.2_

- [x] 7. 新建 `server/routes/blueprint/aigc-spec-node/prompt.ts`
  - [x] 7.1 按 design §4.5 定义并导出 `AIGC_SPEC_NODE_PROMPT_ID = "blueprint.aigc-spec-node.v1"` 常量（需求 2.2）
  - [x] 7.2 导出 `AigcSpecNodePromptPayload` / `BuildAigcSpecNodePromptInput` 类型与 `buildAigcSpecNodePrompt(input): AigcSpecNodePromptPayload` 纯函数
  - [x] 7.3 实现 locale-aware `systemMessage`：`locale === "zh-CN"` 时使用 design §4.5 给出的中文 prompt（以"你是 /autopilot 沙箱派生管线中的 AIGC Spec Node 领域推理器"开头、含 5 条约束）;其余使用英文版（以"You are the AIGC Spec Node domain-reasoner"开头、含 5 条 Constraints）
  - [x] 7.4 构造 `userPayload`（确定性，字段顺序固定）:顺序为 `promptId` / `route` / `intake` / `clarification` / `projectContext` / `outputSchema`;`intake.githubUrls` 保持 `request.githubUrls ?? []` 输入顺序;`clarification.answers` 按 `questionId` 字典序排序（`answers.slice().sort((a,b) => a.questionId.localeCompare(b.questionId))`）;`projectContext` 在 `request.projectId` / `request.sourceId` 均缺失时整块 `undefined`
  - [x] 7.5 `userMessage = JSON.stringify(userPayload, null, 2)`;`promptFingerprint = "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage)`（使用 `node:crypto` 的 `createHash("sha256")`）
  - [x] 7.6 **禁止** 在本文件 `import` 运行时业务模块（仅允许 `node:crypto`）;**禁止** 硬编码任何 model 名 / provider 名 / API URL
  - _Requirements: 2.2, 2.5, 2.7, 7.2_

- [x] 8. 新建 `server/routes/blueprint/aigc-spec-node/prompt.test.ts`
  - [x] 8.1 Determinism：同输入（`request`、`clarificationSession`、`route`、`locale`）两次调用 `buildAigcSpecNodePrompt(...)` 返回的 `userMessage` 字节相同，`promptFingerprint` 字节相同（Property 2 锚点）
  - [x] 8.2 `clarificationSession.locale === "zh-CN"` → `systemMessage` 至少包含一个 CJK 字符（正则 `/[\u4e00-\u9fa5]/` 匹配）;`locale === "en-US"` → `systemMessage` 以英文字符开头且不含 CJK
  - [x] 8.3 `clarificationSession.answers = [{questionId: "q-b", answer: "B"}, {questionId: "q-a", answer: "A"}]` 输入 → `userPayload.clarification.answers` 按 `questionId` 升序排列（`[q-a, q-b]`）
  - [x] 8.4 `AIGC_SPEC_NODE_PROMPT_ID === "blueprint.aigc-spec-node.v1"`;`prompt.promptId === AIGC_SPEC_NODE_PROMPT_ID`
  - [x] 8.5 `prompt.promptFingerprint` 匹配 `/^sha256:[a-f0-9]{64}$/`;手动计算 `sha256(systemMessage + "\n\n" + userMessage)` 与 `prompt.promptFingerprint.replace("sha256:", "")` 相等
  - [x] 8.6 `request.targetText === "build a dashboard"` + `request.githubUrls: ["url1","url2"]` → `userMessage` 包含 `"build a dashboard"` 子串 + `"url1"` / `"url2"` 子串（按输入顺序出现，`url1` 在 `url2` 之前）;`clarificationSession === undefined` → `userPayload.clarification === undefined`（JSON 序列化后 key 不出现）
  - _Requirements: 2.2, 2.5, 2.7, 9.2_

- [x] 9. 新建 `server/routes/blueprint/aigc-spec-node/summary-derivation.ts`
  - [x] 9.1 按 design §4.7 导出 `deriveAigcOutputSummary(data: AigcSpecNodeResponse, options: { locale: "zh-CN" | "en-US" }): string` 纯函数:locale=en-US 时返回 `"Identified N subsystem(s); K risk(s) flagged."` 单复数正确（N=1 用 subsystem，其余用 subsystems；K 同理）;locale=zh-CN 时返回 `"识别 N 个关键子系统；标注 K 条风险。"`;若 `data.dataFlowSketch` 非空且 > 120 字符，截断为 117 字符 + `"..."` 再附加到末尾（en-US 用 `" Data flow: {sketch}"`；zh-CN 用 `" 数据流摘要：{sketch}"`）
  - [x] 9.2 导出 `buildStructuredPayloadSummary(data: AigcSpecNodeResponse, policy: AigcSpecNodeCapabilityPolicy): string` 纯函数:生成简短人可读摘要（例如 `"3 subsystems, 2 risks, confidence=0.78"`），截断到 `policy.maxStructuredPayloadSummaryBytes` 字节
  - [x] 9.3 导出 `sha256Hex(text: string): string` 纯函数（若 prompt.ts 已导出可复用其实现；否则独立实现）:使用 `node:crypto` 的 `createHash("sha256")`，返回 64 字符 hex lowercase
  - [x] 9.4 **禁止** 在本文件 `import` 运行时业务模块;纯函数 only
  - _Requirements: 3.5, 4.3, 4.5, 4.6_

- [x] 10. 新建 `server/routes/blueprint/aigc-spec-node/summary-derivation.test.ts`
  - [x] 10.1 `deriveAigcOutputSummary({ subsystems: ["A"], riskNotes: [] }, { locale: "en-US" })` 返回 `"Identified 1 subsystem; 0 risks flagged."`（subsystem 单数，risks 复数）
  - [x] 10.2 `deriveAigcOutputSummary({ subsystems: ["A","B","C"], riskNotes: ["r"] }, { locale: "en-US" })` 返回 `"Identified 3 subsystems; 1 risk flagged."`（subsystems 复数，risk 单数）
  - [x] 10.3 `data.dataFlowSketch = "short sketch"`（< 120 字符）→ `deriveAigcOutputSummary(...)` 结果以 `" Data flow: short sketch"` 结尾（en-US）或 `" 数据流摘要：short sketch"` 结尾（zh-CN）;`data.dataFlowSketch = "x".repeat(200)`（> 120 字符）→ 截断到 117 字符 + `"..."`
  - [x] 10.4 `buildStructuredPayloadSummary({ subsystems: ["A","B","C"], riskNotes: ["r1","r2"], confidence: 0.78 }, policy)` 返回包含 `"3 subsystems"` / `"2 risks"` / `"0.78"` 子串的字符串（或等价语义）且不超过 `policy.maxStructuredPayloadSummaryBytes`;`sha256Hex("hello")` 返回确定的 hex 摘要（可断言 === `"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"`）
  - _Requirements: 3.5, 4.3, 4.5, 9.2_

- [x] 11. Checkpoint — 跑通子域 schema / policy / prompt / summary-derivation 纯模块单测
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/aigc-spec-node/schema.test.ts server/routes/blueprint/aigc-spec-node/policy.test.ts server/routes/blueprint/aigc-spec-node/prompt.test.ts server/routes/blueprint/aigc-spec-node/summary-derivation.test.ts`，确认 ~24 条单测（8 schema + 6 policy + 6 prompt + 4 summary-derivation）全部通过;若失败必须修复对应模块后再继续。同时跑 `node --run check` 确认此时仓库无新增类型错误。
  - _Requirements: 9.2, 9.3_

- [x] 12. 新建 `server/routes/blueprint/aigc-spec-node/bridge.ts`
  - [x] 12.1 按 design §4.2 定义并导出 `AigcSpecNodeCapabilityBridgeInput`（`capability` / `route` / `jobId` / `request` / `routeSet` / `clarificationSession?` / `createdAt` / `invocationId` / `roleId`）、`AigcSpecNodeCapabilityBridgeOutput`（`invocation` / `executionMode: "real" | "simulated_fallback"` / `additionalEvents`）、`AigcSpecNodeCapabilityBridge` 类型别名
  - [x] 12.2 导出工厂 `createAigcSpecNodeCapabilityBridge(ctx: BlueprintServiceContext): AigcSpecNodeCapabilityBridge`;按 design §4.6 伪代码实现主算法 7 步：早退档位 1（`BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED !== "true"` → fallback `"bridge not enabled"` + `logger.debug`）→ 早退档位 2（`ctx.llm.getConfig().apiKey` 空 → fallback `"llm apiKey missing"` + `logger.debug`，**不调用 callJson**）→ 构造 prompt（locale-aware，locale 从 `input.clarificationSession?.locale === "zh-CN" ? "zh-CN" : "en-US"`）→ 记录 `startedAt = ctx.now()` → `await ctx.llm.callJson(messages, { model, temperature: policy.temperature, timeoutMs: policy.maxInvocationTimeoutMs, retryAttempts: policy.callJsonRetryAttempts, sessionId: ... })` → 档位 3/4/5 错误处理 → 档位 3 非 JSON / undefined → fallback `"non-json response"` + `logger.warn` → schema.safeParse → 档位 4 schema 失败 → fallback `"schema validation failed: {truncated msg}"` + `logger.warn` → 档位 5 timeout（`/abort|timeout/i.test(errMsg)`）→ fallback `"llm timeout"` + `logger.warn` → happy path → 构造 real invocation
  - [x] 12.3 按 design §4.7 实现 `buildRealOutput`：填充 `durationMs = completedAt.getTime() - startedAt.getTime()`（墙钟毫秒）/ `logs`（只记录 metadata：`promptId=...` / `promptFingerprint=...` / `model=...` / `responseDigest=...` / `structuredPayloadDigest=...` / `subsystems=N` / `riskNotes=K` / 可选 `confidence=0.78`；每条写入前经 `applyAigcNodeCapabilityRedaction` 防御性脱敏；按 `policy.maxLogLines` / `policy.maxLogBytes` 截断）/ `outputSummary`（来自 `deriveAigcOutputSummary` + `applyAigcNodeCapabilityRedaction`）/ `requestedBy: "aigc-spec-node-capability-bridge"` / `safetyGate.reason: "{label} approved for real LLM execution via ctx.llm.callJson."` / `provenance.executionMode: "real"` / `provenance.promptId / model / responseDigest / structuredPayloadDigest / promptFingerprint`;**不填** `error`（real 路径 error 必须为 undefined，需求 5.2）;**不写入原始 prompt 全文或原始 LLM 响应体**到 logs / outputSummary 的任何位置（需求 4.6）
  - [x] 12.4 按 design §4.8 实现 `buildFallbackOutput(input, { reason, promptId?, model? })`：调用既有 `buildCapabilityOutputSummary()` / `buildCapabilityInvocationLogs()` / `deterministicCapabilityDuration()` 产出模板化字段（outputSummary / logs / durationMs）;`requestedBy: "route-generation-sandbox-derivation"` 保留今日值;`provenance.executionMode: "simulated_fallback"` + `provenance.error: truncate(reason, 400)`;若 prompt 已构造则可选填充 `provenance.promptId` / `model`（档位 3/4/5），档位 1/2 不填
  - [x] 12.5 5 档错误分类严格对齐 design §5.1：档位 1 未启用（debug + `"bridge not enabled"`）/ 档位 2 apiKey 缺失（debug + `"llm apiKey missing"` + 不调用 callJson）/ 档位 3 callJson 抛错或返回 non-object（warn + `"llm callJson threw: ..."` 或 `"non-json response"`）/ 档位 4 schema 失败（warn + `"schema validation failed: ..."`）/ 档位 5 超时（warn + `"llm timeout"`，通过 `/abort|timeout/i.test(errMsg)` 判断）
  - [x] 12.6 `structuredPayloadDigest` 计算：`canonicalPayloadJson = JSON.stringify(parsed.data)`（只含 schema-declared 字段，zod 已 strip 额外字段）→ `structuredPayloadDigest = "sha256:" + sha256Hex(canonicalPayloadJson)`;`responseDigest = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`（rawPayload 是 callJson 返回的原始对象，可能含 zod 丢弃的额外字段）
  - [x] 12.7 日志级别与 meta：档位 1/2 `ctx.logger.debug(...)` 降噪;档位 3/4/5 `ctx.logger.warn(...)` 且 meta 只含 `{ promptId, error?, errorMsg? }` 三类字段，**不**含 `messages` / `rawPayload` / `systemMessage` / `userMessage` 等原始内容（design §D10 / 需求 4.6）
  - [x] 12.8 **禁止** `import { callLLMJson } from "../../../core/llm-client.js"`、**禁止** `import { getAIConfig } from "../../../core/ai-config.js"`、**禁止** `new ...LLMClient()` 自己装配、**禁止** 模块级 `fetch()`、**禁止** `import "node-fetch"` / `"got"` / `"undici"`、**禁止** 硬编码任何 model 名（如 `"gpt-4"`）或 provider 名或 temperature 默认值;所有 LLM 能力必须通过 `ctx.llm.callJson` / `ctx.llm.getConfig` 注入（design §D1 硬约束）
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.7, 7.1, 7.2, 7.3_

- [x] 13. 新建 `server/routes/blueprint/aigc-spec-node/bridge.test.ts`
  - [x] 13.1 **Happy path**（需求 9.2 happy）：注入 fake `callJson: async () => ({ subsystems: ["Ingestion","Aggregation","Rendering"], riskNotes: ["Latency spikes"], confidence: 0.8 })` + `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "sk-test-valid" })` + `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED=true`;断言 `result.executionMode === "real"` + `invocation.provenance.executionMode === "real"` + `promptId === "blueprint.aigc-spec-node.v1"` + `model === "gpt-4-turbo"` + `structuredPayloadDigest` 匹配 `/^sha256:[a-f0-9]{64}$/` + `promptFingerprint` 匹配同上 + `responseDigest` 匹配同上 + `error === undefined` + `outputSummary` 匹配 `/3\s+subsystems/` + `outputSummary` 匹配 `/1\s+risk/` + `durationMs >= 0` + `logs` 每行都不包含 `"You are"` / `"你是"` / `"system"` 等 prompt 原文子串
  - [x] 13.2 **Malformed JSON**（需求 9.2 malformed）：fake `callJson: async () => undefined`（或返回 `null` / string / number）;断言 `result.executionMode === "simulated_fallback"` + `provenance.executionMode === "simulated_fallback"` + `provenance.error` 匹配 `/non-json response/`;断言 `outputSummary` / `logs` / `durationMs` 与 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 产出完全一致（字节级等价）
  - [x] 13.3 **Schema validation fails**（需求 9.2 schema-fail）：fake `callJson: async () => ({ subsystems: [], riskNotes: ["r"] })`（合法 JSON 但 subsystems 为空，违反 `.min(1)`）;断言 `result.executionMode === "simulated_fallback"` + `provenance.error` 匹配 `/schema validation failed/`;另一条：fake 返回 `{ subsystems: ["a"], riskNotes: [], confidence: 2 }`（confidence 越界）→ 同样 fallback + error 含 `"schema"`
  - [x] 13.4 **ApiKey missing**（需求 9.2 apikey-missing）：fake `callJson` spy（`vi.fn()`） + fake `getConfig: () => ({ model: "gpt-4-turbo", apiKey: "" })`;断言 `result.executionMode === "simulated_fallback"` + `provenance.error` 匹配 `/llm apiKey missing/` + `callJson` spy **从未被调用**（`expect(callJsonSpy).not.toHaveBeenCalled()`）
  - [x] 13.5 **Not enabled**（补充档位 1）：不设 `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED`（或设为 `"false"` / `"0"`）+ fake callJson spy;断言 fallback + `provenance.error === "bridge not enabled"` + callJson 未被调用 + `ctx.logger.debug` 被调用（warn 未被调用）
  - [x] 13.6 **Timeout**（补充档位 5）：fake `callJson: async () => { throw new Error("Request aborted due to timeout") }`（或使用 `Object.assign(new Error("aborted"), { name: "AbortError" })`）;断言 fallback + `provenance.error === "llm timeout"`;或使用 vitest fake timers 模拟 30s 后 callJson 仍 pending 然后 abort
  - [x] 13.7 **Redaction E2E**（补充需求 4.6）：fake `callJson` 返回 `{ subsystems: ["Ingestion (key=sk-ABCDEFGHIJKLMNOP1234567890)"], riskNotes: ["contact user@example.com for escalation"] }`;断言 bridge 返回的 `invocation.outputSummary` / `invocation.logs.join("\n")` 均**不含** `"sk-ABCDEFGHIJKLMNOP1234567890"` 或 `"user@example.com"` 原文;`structuredPayloadDigest` / `responseDigest` / `promptFingerprint` 作为 hash 允许存在
  - [x] 13.8 所有 7 条单测均不启动真实 LLM 调用、不发真实 HTTP 请求，完全通过 fake ctx 驱动;不依赖外网，不依赖真实 apiKey
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.6, 5.1, 5.2, 5.3, 5.5, 9.2_

- [x] 14. Checkpoint — 跑通完整 aigc-spec-node 子域测试
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/aigc-spec-node/`，确认 ~31 条单测（8 schema + 6 policy + 6 prompt + 4 summary-derivation + 7 bridge）全部通过;此 checkpoint 保证 aigc capability bridge 核心实现在接入外层之前已稳定。design §7 的 10 条 Correctness Properties 通过本 checkpoint 中 7 条 bridge 单测 + 24 条纯模块单测等价覆盖。
  - _Requirements: 9.2, 9.3_

- [x] 15. 在 `buildBlueprintServiceContext` 中默认装配 bridge 与 policy
  - [x] 15.1 在 `server/routes/blueprint/context.ts` 的 `buildBlueprintServiceContext(deps)` 中：若 `deps.aigcSpecNodeCapabilityPolicy` 未提供，调用 `createDefaultAigcSpecNodeCapabilityPolicy()` 挂到 ctx 上;若 `deps.aigcSpecNodeCapabilityBridge` 未提供，调用 `createAigcSpecNodeCapabilityBridge(ctx)` 构造默认实例挂到 ctx 上
  - [x] 15.2 保持向后兼容：`ctx.llm` 字段保持现状（`callJson` / `getConfig` 默认已由 wt1 装配），本 spec **不**扩展 `ctx.llm`;bridge 在 `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED !== "true"` 或 `apiKey` 缺失时自动早退 fallback（不强行触发真实 LLM 调用，避免在默认装配下拖慢响应或消耗 API quota）
  - [x] 15.3 新增字段的装配顺序：先解析 `logger` / `now` / `llm`（既有顺序），再装配 `aigcSpecNodeCapabilityPolicy`（纯数据），最后装配 `aigcSpecNodeCapabilityBridge`（依赖 policy + llm + logger + now）;顺序相对 Docker 桥的 `executorCallbackDispatcher` / `dockerCapabilityPolicy` / `dockerCapabilityBridge`、MCP 桥的 `mcpToolAdapter` / `httpFetcher` / `mcpGithubCapabilityPolicy` / `mcpGithubCapabilityBridge` 之后，互不影响
  - _Requirements: 7.1, 7.3, 7.5, 8.2_

- [x] 16. 改造 `createRouteGenerationSandboxDerivation` 的 input 类型与调用链：追加 `clarificationSession?` 可选字段
  - [x] 16.1 在 `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 input 类型追加 `clarificationSession?: BlueprintClarificationSession` 可选字段;非破坏性改造，既有 Docker / MCP 桥分支不消费此字段
  - [x] 16.2 在 `createGenerationJob` 调用 `createRouteGenerationSandboxDerivation(...)` 的位置追加 `clarificationSession` 透传:`clarificationSession` 在 `createGenerationJob` options 中已存在（由 clarification 阶段解析），直接透传
  - [x] 16.3 grep 其它 `createRouteGenerationSandboxDerivation(` 调用点（包括测试 fixture）：对未传 `clarificationSession` 的调用点保持不变（可选字段缺省为 `undefined`，bridge 内部 locale 回退到 `"en-US"`）
  - [x] 16.4 运行 `node --run check` 确认类型追加未引入新 TS 错误
  - _Requirements: 2.5, 7.1, 7.2_

- [x] 17. 改造 `createRouteGenerationSandboxDerivation` 的 capability 分支：新增 aigc-spec-node 分支
  - [x] 17.1 在 `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 capability map 循环内（Docker 桥 spec 已改为 async、MCP 桥 spec 已新增 mcp-github-source 分支）：在 `capability.id === "mcp-github-source"` 分支之后，新增 `capability.id === "aigc-spec-node" && ctx.aigcSpecNodeCapabilityBridge` 分支，调用 `await ctx.aigcSpecNodeCapabilityBridge({ capability, route, jobId, request, routeSet, clarificationSession, createdAt, invocationId, roleId: invocationRoleId })` 并返回 `{ invocation: bridgeResult.invocation, executionMode: bridgeResult.executionMode }`
  - [x] 17.2 其它 capability（`role-system-architecture` / `skill-svg-architecture`）分支**一行不改**：继续走 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 模板化组合;Docker / MCP 桥分支同样不改
  - [x] 17.3 `ctx.aigcSpecNodeCapabilityBridge` 未注入时（理论上任务 15 默认装配后不会出现）走 else 分支（与其它 capability 相同的模板化代码），保证 ctx 无 bridge 也不崩
  - [x] 17.4 `invocationId = createId("blueprint-capability-invocation")` 保持由外层生成（Docker / MCP 桥 spec 已实现），本 spec 沿用;real / fallback 两条路径共享同一 id
  - _Requirements: 1.1, 1.7, 2.1, 4.1, 4.3, 4.7_

- [x] 18. 改造 `createRouteGenerationSandboxDerivation` 的 event payload 与 `buildCapabilityEvidence` 的 provenance 继承
  - [x] 18.1 在 `createRouteGenerationSandboxDerivation` 聚合完 invocations 之后，针对 aigc-spec-node capability 提取真实 adapter：`const aigcResult = invocations.find(({invocation}) => invocation.capabilityId === "aigc-spec-node"); const aigcAdapter = aigcResult?.executionMode === "real" ? "blueprint.runtime.aigc.spec-node.llm" : routeGenerationCapabilities.find(c => c.id === "aigc-spec-node")?.adapter ?? "blueprint.runtime.aigc.spec-node.simulated";`
  - [x] 18.2 在 `sandbox.job.started` / `sandbox.job.completed` / `sandbox.job.failed` 事件 payload 中，对应 aigc-spec-node capability 的 `adapter` 字段使用 `aigcAdapter`;trace `server/routes/blueprint.ts` 第 ~2940 / 3088 / 3091 行附近 event payload 构造代码并精确补丁
  - [x] 18.3 在 `capability.invoked` / `capability.completed` / `evidence.recorded` 事件 payload 中追加可选字段：`executionMode`、`promptId?`、`model?`、`error?`、`structuredPayloadDigest?`（从对应 invocation.provenance 透传）;**所有事件 `type` 仍通过 `BlueprintEventName` 常量构造，不出现裸字符串字面量**（需求 6.6）
  - [x] 18.4 改造 `buildCapabilityEvidence({ invocation, ... })` 内部：读取 `invocation.provenance.executionMode / error / promptId / model / responseDigest / tokenCount / structuredPayloadDigest / promptFingerprint` 并原样回填到 evidence 的 `provenance` 对应字段;Docker 桥 spec 已追加 `executionMode / containerId / artifactUrl / logDigest / error` 白名单、MCP 桥 spec 已追加 7 个字段，本 spec 追加 6 个新字段到同一白名单
  - [x] 18.5 针对 aigc-spec-node real 路径（`invocation.capabilityId === "aigc-spec-node" && invocation.provenance.executionMode === "real" && invocation.provenance.structuredPayloadDigest`），在 evidence.provenance 上构造 `structuredPayload: { digest, byteSize, summary }` 可选对象:`digest` 直接取 `invocation.provenance.structuredPayloadDigest`;`byteSize` / `summary` 从 bridge 传递（方案：bridge 在 invocation.provenance 上挂一个内部字段或通过外层重新计算；具体落点见 design §4.7 末尾"两种实现等价"说明，推荐 bridge 在 `buildRealOutput` 时一并准备 summary 并附加到 provenance 的临时内部字段，由 evidence builder 消费后不对外透出原字段）
  - [x] 18.6 `getDefaultRuntimeCapabilities()` 本身**不改**（aigc-spec-node capability adapter 仍为 `"blueprint.runtime.aigc.spec-node.simulated"` 作为 fallback 基线），保证既有 50 条 E2E 继续通过（Docker 桥 +2 条到 47，MCP 桥 +3 条到 50）
  - _Requirements: 3.5, 4.4, 4.5, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 8.1, 8.2, 8.3_

- [x] 19. Checkpoint — 跑既有 50 E2E + 48 条子域单测确认未回归
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/aigc-spec-node/**" --exclude "server/routes/blueprint/mcp-github-source/**" --exclude "server/routes/blueprint/docker-analysis-sandbox/**"`，确认既有 48 条子域 co-located 单测（handoff / spec-documents / artifact-memory / agent-crew 等）继续通过;同时跑 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` 确认既有 50 条 E2E（基线 45 + Docker 桥 +2 + MCP 桥 +3 = 50）继续通过;若失败说明外层改造（任务 16-18）破坏了 invocation / evidence 字段形态等价性（需求 4.7 / 5.3），必须回到对应任务修复。
  - _Requirements: 4.7, 5.3, 8.2, 9.4_

- [x] 20. 在 `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E 用例
  - [x] 20.1 追加 **Real LLM path** 用例（需求 9.1a）：`process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED = "true"`;使用 `llmMocks.callLLMJson.mockImplementation((messages) => { ... })` 按 messages 关键词分发（routeset messages 含 `"RouteSet planner"` 或等价关键词返回 routeset payload；aigc messages 含 `"AIGC Spec Node"` / `"你是 /autopilot"` / `"domain-reasoner"` 关键词返回 `{ subsystems: ["Release event ingestion","RBAC & tenancy","Dashboard rendering","Metrics aggregation"], riskNotes: ["Event schema drift between GitHub Actions and GitLab CI","Tenant isolation on shared data warehouse"], dataFlowSketch: "CI providers push deploy events → ingestion → normaliser → time-series store → dashboard & heatmap.", confidence: 0.78 }`）;`POST /api/blueprint/jobs` 带 `targetText: "Build a release dashboard."` + `githubUrls: ["https://github.com/example/dashboard"]`;断言对应 `aigc-spec-node` invocation 的 `provenance.executionMode === "real"`、`provenance.promptId === "blueprint.aigc-spec-node.v1"`、`typeof provenance.model === "string"` 且非空、`provenance.responseDigest` 匹配 `/^sha256:[a-f0-9]{64}$/`、`provenance.structuredPayloadDigest` 匹配同上、`provenance.promptFingerprint` 匹配同上、`provenance.error === undefined`、`outputSummary` 匹配 `/4\s+subsystems/` 且匹配 `/2\s+risks?/`;断言对应 capability 的 `adapter === "blueprint.runtime.aigc.spec-node.llm"` 且不含 `.simulated` 子串;断言对应 evidence 的 `provenance.structuredPayload.digest === invocation.provenance.structuredPayloadDigest` 且 `provenance.structuredPayload.byteSize > 0`
  - [x] 20.2 追加 **Fallback path** 用例（需求 9.1b）：`process.env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED = "true"`;`llmMocks.callLLMJson.mockImplementation((messages) => { if (/AIGC Spec Node|domain-reasoner|你是 \/autopilot/.test(JSON.stringify(messages))) { throw new Error("upstream 503"); } /* else routeset mock */ })`;`POST /api/blueprint/jobs` 带相同输入;断言对应 `aigc-spec-node` invocation 的 `provenance.executionMode === "simulated_fallback"`、`provenance.error` 匹配 `/upstream 503|llm callJson threw/`、`durationMs` 等于 `deterministicCapabilityDuration` 产出、`outputSummary` 来自 `buildCapabilityOutputSummary` 模板、`logs` 来自 `buildCapabilityInvocationLogs` 模板;断言对应 capability 的 `adapter === "blueprint.runtime.aigc.spec-node.simulated"`;断言对应 evidence 的 `provenance.structuredPayload === undefined`
  - [x] 20.3 两条用例共用一个 messages 分发 helper（建议落在测试文件顶部或独立 `test-helpers/fake-aigc-llm-dispatcher.ts`），覆盖 routeset / aigc 两类 prompt 的识别关键词;helper 不依赖真实 LLM / 不依赖外网 / 不依赖真实 apiKey
  - [x] 20.4 用例 setup / teardown 正确清理 `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED` 环境变量与临时 `specsRoot` 目录，避免污染其它用例;若 mock 被全局持有，teardown 重置 `llmMocks.callLLMJson.mockReset()`
  - [x] 20.5 **不改写** `server/tests/blueprint-routes.test.ts` 中原有 50 条 E2E 用例的任一断言（需求 9.4 / 1.9）;仅以追加方式补 2 条（对应 Docker 桥 +2 条 + MCP 桥 +3 条之后，累计 50 + 2 = 52 条）
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 9.1, 9.4_

- [x] 21. 确认 SDK normalizer 支持新 provenance 字段
  - [x] 21.1 检查 `client/src/lib/blueprint-api.ts` 与 `client/src/lib/blueprint-api/` 目录下是否存在 capability invocation / evidence provenance 的显式 normalizer
  - [x] 21.2 如使用对象 spread 或透明透传：确认无需改动，仅运行 SDK smoke 验证 6 个新字段（`promptId` / `model` / `responseDigest` / `tokenCount` / `structuredPayloadDigest` / `promptFingerprint`）+ evidence 的 `structuredPayload` 可选对象能到达客户端
  - [x] 21.3 如使用显式字段映射：追加 6 行可选字段透传到 invocation provenance normalizer，同样追加 6 行到 evidence provenance normalizer 并追加 `structuredPayload?` 对象的透传;**不得** 修改任一既有字段映射行为，**不得** 为新字段默认值或类型强制（保持 `string | number | undefined` 各自原样）
  - [x] 21.4 运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` 确认既有 9 条 SDK smoke 继续通过
  - _Requirements: 5.4, 8.3_

- [x] 22. 执行全量回归并完成最终验收
  - [x] 22.1 `node --run check` → 不应引入新增 TS 错误（若仓库已有历史类型债，新增改动不应扩大错误面）
  - [x] 22.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 50 + 2 = 52 条通过（基线 45 + Docker 桥 +2 + MCP 桥 +3 + 本 spec +2）
  - [x] 22.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/aigc-spec-node/` → ~31 条新增 co-located 单测通过（8 schema + 6 policy + 6 prompt + 4 summary-derivation + 7 bridge）
  - [x] 22.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/aigc-spec-node/**" --exclude "server/routes/blueprint/mcp-github-source/**" --exclude "server/routes/blueprint/docker-analysis-sandbox/**"` → 48 条既有子域单测继续通过
  - [x] 22.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [x] 22.6 人工核查 4 项边界：(a) Real LLM 路径下 capability event payload 的 `adapter === "blueprint.runtime.aigc.spec-node.llm"` 且不含 `.simulated` 子串;(b) Fallback 路径下 capability event payload 的 `adapter === "blueprint.runtime.aigc.spec-node.simulated"`;(c) `server/core/llm-client.ts` / `server/core/ai-config.ts` 源码**无**本 spec 引起的改动（需求 1.8 / design §2.D1 硬约束）;(d) grep `server/routes/blueprint/aigc-spec-node/**/*.ts` 确认无 `import { callLLMJson }` / `import { getAIConfig }` / 模块级 `fetch(` / 硬编码 model 名 / 裸事件字符串 `"sandbox.job.started"` 等
  - _Requirements: 1.8, 1.9, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 4、6、8、10、13 是 example-based 单测（共 ~31 条），**不**包含 PBT（符合 Requirement 9.3、design §6.1）。design §7 的 10 条 Correctness Properties 通过这些 example-based 单测等价覆盖。
- 任务 20 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 50 条（符合 Requirement 1.9、9.4）。
- 任务 11、14、19 是 3 个中间 checkpoint，分别在子域纯模块、完整子域、外层改造后验证未回归；任务 22 是全量回归 + 最终验收。
- D1（工厂 DI）在任务 12.2 / 12.8 落地；D2（`BlueprintServiceContext` 最小扩展，仅追加 2 字段，不改 `ctx.llm`）在任务 2 / 15 落地；D3（invocation 层替换，不改外层 orchestration）在任务 17 落地；D4（30s timeout + env 覆盖）在任务 5.2 / 6.5 落地；D5（promptId `blueprint.aigc-spec-node.v1`）在任务 7.1 / 8.4 落地；D6（adapter 字符串 `.llm` / `.simulated`）在任务 18.1 / 18.2 / 20.1 / 22.6 落地；D7（复用 `BlueprintEventName`）在任务 18.3 落地；D8（结构化 payload 承载选项 A）在任务 1.2 / 9.2 / 18.5 / 20.1 落地；D9（strict schema 最小锁定 + 2 optional + zod strip）在任务 3 / 4 落地；D10（独立 redaction helper）在任务 5.3 / 6.1-6.3 / 12.3 / 13.7 落地；D11（不引入 callback dispatcher，不改 `/api/executor/events` 中继链）在任务 18 范围外（本 spec 不动 server/index.ts）；D12（default test harness ≡ today's production behavior）在任务 15.2 / 20.5 / 22.4 落地。
- 任务 3.3 / 5.4 / 7.6 / 9.4 / 12.8 的"禁止 import"硬约束在 code review 阶段应直接拒绝违反者（与 routeset / Docker / MCP 桥 DI 硬约束对齐）。
- 任务 22 是强制的验证门禁，必须在所有实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 相对 Docker / MCP 桥的最大差异：(1) Context 扩展最轻（仅 2 字段 vs 4 字段），不需要 `server/index.ts` 装配主线实例（LLM 能力已在 wt1 的 `buildBlueprintServiceContext` 默认装配）；(2) 无独立 HTTP 客户端模块（LLM 调用走 `ctx.llm.callJson`）；(3) E2E 2 条（仅一条 real 路径）而非 MCP 桥的 3 条；(4) 但 Correctness Properties 10 条以更丰富的 31 条 example-based 单测覆盖（schema 8 + policy 6 + prompt 6 + summary-derivation 4 + bridge 7）。
- 本 spec 完成后，工作流结束 —— 不在此 spec 内覆盖后续 capability（`role-system-architecture` / `skill-svg-architecture`）的 bridge 化，由后续独立 spec 推进。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
