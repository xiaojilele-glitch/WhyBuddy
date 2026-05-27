以下是针对 **Validate fallback artifact** 模块生成的任务清单。该清单基于您提供的上下文，重点在于确保回退路径（Fallback Path）产出的结果在合规性、安全性和可追溯性上与主路径对齐。

---

### 📋 任务清单：Validate fallback artifact 模块开发

#### 1. 数据结构与接口定义
- [ ] **定义 Fallback Artifact 数据模型**：在现有 Artifact 结构基础上，增加 `is_fallback` (bool) 和 `origin_failure_reason` (string) 字段。
- [ ] **接口对接**：确保主执行器（Executor-backed role agent）在失败时，能将错误上下文（Error Context）完整传递给校验模块。
- [ ] **标准化输入格式**：统一人机交互或轻量级 Agent（Lite Agent）产出的原始数据格式，以便进行统一校验。

#### 2. 架构与 Schema 校验逻辑
- [ ] **复用主路径校验逻辑**：引入主路径使用的 JSON Schema 或 Pydantic 模型，确保回退产物符合 MiroFish 项目的业务规范。
- [ ] **实现内容完整性检查**：验证回退产物是否包含必要的关键字段（如：Callback Evidence 占位符、执行状态等）。
- [ ] **开发差异化校验逻辑**：针对回退路径特有的属性（如 host-side 执行限制）编写特定的约束规则。

#### 3. 安全性检查（Safety Checks）
- [ ] **注入攻击扫描**：对直接由 LLM 或轻量 Agent 生成的文本/代码片段进行安全扫描，防止指令注入。
- [ ] **合规性过滤**：应用敏感词过滤或安全策略，确保回退结果不违反系统预设的安全边界。
- [ ] **权限边界确认**：验证回退产物是否包含非法的越权操作指令（由于回退路径常在宿主侧执行，需严格控制权限）。

#### 4. 元数据标记与追溯（Evidence Preservation）
- [ ] **标记来源属性**：自动在 Artifact 元数据中注入 `source: fallback-derived` 标签。
- [ ] **持久化错误原因**：将主路径（Executor Path）不可用的具体原因（如：Timeout, Auth Failure, No Callback Evidence 等）写入回退产物的日志记录中。
- [ ] **证据链关联**：若存在部分主路径证据，需将其与回退产物进行合并或关联，确保 Callback Evidence 的连续性。

#### 5. 异常处理与状态反馈
- [ ] **回退校验失败处理**：定义当回退产物亦无法通过校验时的终极容错机制（如：彻底标记任务失败或人工介入请求）。
- [ ] **日志与审计监控**：记录每次回退发生的频率及原因，为优化主执行器路径提供数据支持。

#### 6. 测试与验证
- [ ] **单元测试**：编写针对 `Validate fallback artifact` 的单元测试，模拟各种 Schema 错误和安全违规场景。
- [ ] **集成测试**：在 MiroFish 流程中模拟主路径失败，验证整个 Fallback 校验链路是否能正确保留原始失败原因并产出合规 Artifact。
- [ ] **Mock 演练**：使用 Lite Agent 模拟产出数据，验证标记位是否准确打入。

---

**模块目标说明：**
本模块的核心价值在于充当“安全网”，在主路径（Executor-backed）失效时，既保证业务流程不中断，又确保通过备选方案（Lite Agent/LLM）生成的数据不会因为缺乏校验而引入系统风险，同时为后续的调试提供清晰的失败追溯依据。