根据您提供的模块信息和上下文，该模块的核心目标是为 MiroFish 的执行器路径安装运行时监控钩子（Hooks），并确保这些执行证据被持久化。

以下是生成的任务清单：

### 📋 模块任务清单：Register live callback evidence hooks

#### 1. 定义回调钩子接口与规范
- [ ] **定义 `ILiveCallbackHooks` 接口**：明确各里程碑的回调函数签名，支持异步处理。
- [ ] **结构化证据数据模型**：设计 `CallbackEvidence` 数据结构，包含时间戳、里程碑类型、执行上下文快照、关联 Trace ID 等字段。
- [ ] **确定错误处理策略**：规定当回调函数执行失败时，是中断主流程还是仅记录错误（建议非阻塞、容错处理）。

#### 2. 实现运行时里程碑钩子 (Milestone Implementation)
- [ ] **实现 `OnRequestAccepted`**：捕获初始请求被系统接收并进入队列的瞬间。
- [ ] **实现 `OnRepositoryResolved`**：在 MiroFish 成功解析代码库上下文（Repo Context）后触发，记录解析出的元数据。
- [ ] **实现 `OnExecutorStarted`**：在执行器分配资源并正式启动 Agent 运行环境时触发。
- [ ] **实现 `OnAgentStepCompleted`**：在自主 Agent 完成每一个思维步骤或行动步骤时触发，捕获中间思考过程。
- [ ] **实现 `OnArtifactEmitted`**：当 Agent 生成产物（代码、文档、配置文件等）时触发，记录产物摘要或路径。
- [ ] **实现验证钩子 (`OnValidationPassed` / `OnValidationFailed`)**：捕获产物验证阶段的结果及其失败原因。
- [ ] **实现 `OnFallbackTriggered`**：当主路径失败切换至回退方案时触发，记录触发原因和降级策略。

#### 3. 证据持久化与状态管理 (Evidence Preservation)
- [ ] **开发证据收集器 (Evidence Collector)**：负责实时接收钩子信号并将数据汇聚。
- [ ] **集成持久化存储**：将收集到的证据写入数据库或日志系统，确保在 Agent 运行结束后仍可追溯。
- [ ] **实现实时流式输出（可选）**：如果需要 UI 实时展示，需对接 WebSocket 或流式日志接口。

#### 4. 路径集成与注入 (Integration)
- [ ] **修改执行计划构造器**：在构造 `role-agent execution plan` 时，支持将配置好的 Hooks 注入到执行上下文中。
- [ ] **适配 MiroFish 执行器路径**：确保 `executor-backed role agent` 的核心循环（Loop）在关键节点调用已注册的 Hooks。
- [ ] **验证上下文透传**：确保钩子函数能够访问到所需的仓库上下文和 Role 指令信息。

#### 5. 测试与验证
- [ ] **编写单元测试**：验证每个 Hook 在特定事件触发时能正确被调用。
- [ ] **执行全链路集成测试**：通过 MiroFish 运行一个完整的任务，检查生成的证据链是否完整（从 Accepted 到 Emitted）。
- [ ] **验证异常场景**：模拟验证失败和触发回退，检查相关钩子是否如期工作并保留了完整证据。

---

**父模块关联提醒**：
请确保本模块生成的 Hooks 列表与父模块定义的 `expected artifact schema` 和 `termination criteria` 保持逻辑一致，以便在达成终止条件或产出不符时能精确触发相应钩子。