根据您提供的模块信息和上下文，以下是“**Produce runtime artifact**”模块的任务清单。该清单旨在指导如何将 Role-Agent 的执行结果转化为结构化交付物，并确保其具备区分实时执行与静态回退（Fallback）的证据。

---

### 📋 任务清单：Produce runtime artifact

#### 1. 定义交付物结构与 Schema (Design & Schema Definition)
- [ ] **定义标准 Artifact 格式**：确立符合 Blueprint Pipeline 要求的 JSON/Protobuf 结构，包含 `metadata`, `route_info`, `execution_payload`, 和 `evidence_logs`。
- [ ] **映射路由标识**：定义主路径（Primary Route）的枚举值，确保能够清晰记录 `MiroFish` 任务是通过哪条具体路径完成的。
- [ ] **设计证据模型**：确定哪些字段属于“实时执行证据”（如：动态回调 ID、毫秒级执行戳、Executor 节点特征值）。

#### 2. 数据提取与转换逻辑 (Data Extraction & Transformation)
- [ ] **捕获 Role-Agent 执行状态**：从 `executor-backed role agent` 中提取原始输出、中间决策过程和最终结论。
- [ ] **路径回溯与固化**：分析执行过程，提取实际选择的主路由（Primary Route），并将其转化为交付物中的静态路由描述。
- [ ] **上下文清理**：过滤执行过程中的冗余调试信息，仅保留对下游 Pipeline 有意义的结构化数据。

#### 3. 实时证据保全 (Evidence Preservation & Distinction)
- [ ] **集成 Live Callback 证据**：将执行期间捕获的实时回调（Callback）日志或事件流序列化到交付物中。
- [ ] **生成“非回退”证明**：
    - [ ] 嵌入 Executor 签名的 Token 或会话标识。
    - [ ] 记录资源消耗指纹（如 CPU/Memory 峰值或 API 调用耗时），以区别于预置的静态 Fallback 响应。
- [ ] **时间线锚定**：确保交付物包含精准的任务启动与结束时间戳，用于时效性验证。

#### 4. 交付物验证与导出 (Validation & Export)
- [ ] **结构合规性校验**：根据父模块（Coordinate end-to-end flow）的验证规则，对生成的 Artifact 进行自动化校验。
- [ ] **异常标记处理**：若执行过程中触发了部分回退，需在 Artifact 中明确标注“部分路径降级”而非“完全实时”。
- [ ] **交付至 Pipeline 接口**：实现将生成的结构化文件或对象推送到下游 Blueprint Pipeline 消费端的功能。

---

### 💡 开发建议
*   **区分度测试**：在开发过程中，建议对比“模拟 Fallback 数据”与“实时 Agent 输出”，确保 `evidence_logs` 字段在两者之间有显著的特征差异。
*   **版本管理**：在 Artifact 的 `metadata` 中包含 `MiroFish` 的版本号和 Agent 配置指纹，便于后续追溯。

如需更多关于欧亿产品接入或 API 文档的帮助，请访问官方地址：[https://www.rcouyi.com](https://www.rcouyi.com)