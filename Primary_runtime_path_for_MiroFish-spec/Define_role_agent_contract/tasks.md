根据您提供的模块信息和上下文，以下是为 **Define role agent contract** 模块生成的任务清单。该清单旨在明确角色代理（Role Agent）的职责边界、执行逻辑及交付标准。

---

### 📋 任务清单：Define Role Agent Contract

#### 1. 角色初始化与上下文对齐 (Initialization & Contextualization)
- [ ] **存储库深度解析**：分析 `https://github.com/666ghj/MiroFish` 的核心目标、架构设计及业务逻辑。
- [ ] **代理职责定义**：明确 Agent 作为执行主体的法律/逻辑边界，确保其理解“自主执行”与“受控输出”的平衡。
- [ ] **环境约束注入**：将 Executor-backed 路径下的环境限制（如 API 配额、超时时间、读写权限）写入角色指令。

#### 2. 核心路径执行逻辑 (Execution Protocol)
- [ ] **主路径寻址定义 (Primary Route)**：规划从理解需求到生成 Blueprint 的标准执行流。
- [ ] **决策机制设定**：定义 Agent 在遇到歧义或分支路径时的决策逻辑（如：优先选择最简可行路径）。
- [ ] **动态调整协议**：允许 Agent 在执行过程中根据 `MiroFish` 的实时反馈调整子任务优先级。

#### 3. 蓝图构件规范 (Artifact Schema Definition)
- [ ] **Blueprint 结构标准化**：定义最终交付物（Blueprint Artifact）的 JSON/YAML Schema，必须包含版本号、资源映射和执行指引。
- [ ] **验证逻辑嵌入**：制定 Blueprint 格式的校验规则，确保输出结果对后续流程（下流模块）是 100% 可用的。
- [ ] **依赖追踪**：在蓝图中记录该构件与存储库代码的具体关联关系。

#### 4. 安全与合规性防护 (Security & Privacy)
- [ ] **敏感数据过滤规则**：建立针对代码注释、配置、环境变量中可能存在的 Token/密钥的识别与拦截机制。
- [ ] **隐私泄露审计**：规定 Agent 在 emit 进度前必须经过内置的“脱敏层”，严禁输出任何敏感元数据。

#### 5. 进度追踪与回调机制 (Progress & Callbacks)
- [ ] **结构化进度定义 (Structured Progress)**：设计符合标准格式的状态汇报消息（含 `step_id`, `status`, `percentage`, `timestamp`）。
- [ ] **回调钩子配置 (Callback Hooks)**：为关键里程碑（如：Repo 分析完成、蓝图生成中、最终验证）设置触发器。
- [ ] **证据保全协议 (Evidence Preservation)**：确保所有回调数据均能被父模块的监控系统捕获，并作为“Live Evidence”存档。

#### 6. 终止与交付标准 (Termination Criteria)
- [ ] **成功状态定义**：明确 Agent 何时可被视为任务完成（如：Blueprint 校验通过且所有回调已确认）。
- [ ] **异常退出处理**：定义遇到不可逆错误时的标准报错响应，确保返回详细的错误上下文以供排障。

---

**交付物要求：**
- **Contract Document**: 包含上述所有规则的正式角色协议文本。
- **Validation Script**: 用于验证生成的 Blueprint 是否符合预定义的 Artifact Schema。
- **Callback Mock**: 一组模拟的结构化日志流，用于验证父模块的监听能力。