根据您提供的模块定义和上下文，**Conservative host-side lite agent fallback** 模块的核心目标是为系统提供一个“安全网”，在主执行路径失败时，通过宿主端的轻量化手段确保任务至少能产出一个符合结构要求的交付物。

以下是该模块的任务清单（Task List）：

---

### 📋 任务清单：Conservative host-side lite agent fallback

#### 1. 触发逻辑与状态监控 (Triggering & Monitoring)
- [ ] **定义失败判定准则**：明确主执行器（Executor-backed role agent）在何种情况下触发回退（如：Artifact 格式错误、关键回调证据 `callback evidence` 缺失、超时或执行器崩溃）。
- [ ] **实现异常捕获拦截器**：在 `MiroFish` 任务流水线中注入拦截逻辑，实时检测主路径的输出状态。
- [ ] **上下文保留机制**：确保在切换至回退路径时，原始任务请求（Task Request）和已尝试的执行上下文能完整传递给 Lite Agent。

#### 2. 轻量化代理实现 (Lite Agent Implementation)
- [ ] **设计 Lite Agent 提示词模板**：编写专门用于宿主端合成的 Prompt，侧重于“结构正确性”而非“深度模拟执行”，确保能基于现有信息推断出结果。
- [ ] **构建直接合成路径 (Direct LLM Synthesis)**：集成轻量级或快速响应的 LLM 调用接口，用于在不依赖外部执行器的情况下生成 Artifact。
- [ ] **宿主端环境约束配置**：确保回退路径严格在宿主环境运行，不调用高耗时的外部 Sandbox 或隔离容器，以降低资源开销。

#### 3. 证据补全与结构验证 (Evidence & Validation)
- [ ] **伪造/占位证据生成**：当真实回调证据缺失时，生成符合格式要求的“回退说明”或“补偿证据”，以满足下游对证据链的最小需求。
- [ ] **输出结构强制验证 (Schema Enforcement)**：对 Lite Agent 生成的 Artifact 进行严格的 Schema 校验，确保其符合 `MiroFish` 预定义的输出标准。
- [ ] **元数据标记**：在产出的 Artifact 中标记 `source=fallback_lite_agent`，以便后续审计和评估交付物质量。

#### 4. 集成与容错处理 (Integration & Fault Tolerance)
- [ ] **双路径路由整合**：将此模块接入父模块的端到端运行时流（Runtime Flow），实现主路径到回退路径的无缝切换。
- [ ] **回退失败兜底**：定义“最终兜底方案”，若 Lite Agent 仍无法产出有效结构，则返回预定义的 Error Artifact，避免流程卡死。
- [ ] **并发与超时控制**：为回退路径设置严格的 TTL（生存时间），防止因回退逻辑导致的系统级延迟。

#### 5. 可观测性与评估 (Observability)
- [ ] **回退事件日志记录**：详细记录每次触发回退的原因、原始报错以及 Lite Agent 的响应时间。
- [ ] **质量对比指标**：建立监控面板，对比“主路径产出”与“回退路径产出”的成功率和结构合规率。

---

### 关键路径说明
*   **优先级**：该模块应优先保证 **结构可用性**。
*   **核心约束**：严禁在回退路径中再次调用不稳定的外部执行环境，必须保持在 **Host-side**。
*   **交付目标**：确保即使 `MiroFish` 主逻辑执行失败，流水线末端仍能接收到一个合规的 JSON/Artifact 对象。