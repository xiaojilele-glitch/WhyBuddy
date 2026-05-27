针对模块 **“Accept and normalize runtime request”**，其核心目标是为下游组件构建一个标准化的“运行时信封（Runtime Envelope）”。

以下是为您生成的任务清单（Task List）：

### 📋 模块任务清单：接收并标准化运行时请求 (Accept and normalize runtime request)

#### 1. 输入解析与验证 (Input Ingestion & Validation)
- [ ] **解析原始请求载荷**：从父模块接收包含 `target repository` (MiroFish) 和 `route-set context` 的原始数据。
- [ ] **执行基础架构验证**：验证请求是否包含必要的字段（如：任务提示词、路由偏好、执行选项）。
- [ ] **路由合法性校验**：确认所选路由在当前 Role Agent 配置中是否可用且处于激活状态。

#### 2. 仓库标识符标准化 (Repository Identifier Normalization)
- [ ] **转换仓库引用**：将 `https://github.com/666ghj/MiroFish` 转换为标准化的内部 ID 或 URI 格式。
- [ ] **分支/版本锁定**：解析并锁定目标代码库的具体分支（如 `main`）或 Commit Hash，防止执行期间发生偏移。
- [ ] **元数据注入**：从仓库上下文中提取关键信息（如语言栈、框架类型），以便后续驱动 Executor。

#### 3. 路由元数据处理 (Route Metadata Processing)
- [ ] **选定路由提取**：从 `route-set` 中提取与 Executor-backed Role Agent 相关的特定元数据。
- [ ] **策略参数解析**：解析路由策略（如：并发限制、优先级、特定的代理角色定义）。
- [ ] **上下文依赖检查**：确保路由所需的资源（如 API Key 或特定的计算节点）已准备就绪。

#### 4. 任务提示词与选项标准化 (Prompt & Options Normalization)
- [ ] **提示词清洗 (Prompt Sanitization)**：规范化任务提示词的格式，去除冗余字符，并注入必要的角色上下文。
- [ ] **执行选项合并**：将系统默认执行选项与请求中携带的自定义选项（如 `timeout`, `retry_limit`）进行合并。
- [ ] **回调钩子初始化**：预配置实时回调证据（Live Callback Evidence）的捕获点位，确保证据流可以回传至父模块。

#### 5. 运行时信封构建 (Runtime Envelope Construction)
- [ ] **封装 Runtime Envelope**：将上述所有标准化后的数据打包成一个不可变（Immutable）的信封对象。
- [ ] **生成执行跟踪 ID**：为该信封分配全局唯一的 `Trace ID`，用于全链路跟踪。
- [ ] **状态快照导出**：在进入下游组件前，记录当前信封的初始状态快照，作为审计日志的一部分。

#### 6. 下游组件交接 (Downstream Handoff)
- [ ] **接口契约校验**：确保生成的信封对象符合下游 Executor-backed Role Agent 的输入契约（Input Schema）。
- [ ] **异常处理机制**：定义当标准化过程失败时的回退逻辑和错误响应格式。

---

**模块目标达成准则：**
> 只要下游组件能够无歧义地通过此信封获取到 `MiroFish` 仓库路径、具体的代理执行逻辑以及回调证据的收集点，即视为本模块任务完成。