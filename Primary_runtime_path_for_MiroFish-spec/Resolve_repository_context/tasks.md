根据您提供的模块信息（**Resolve repository context**），该模块的主要职责是为 **MiroFish** 任务准备标准化的仓库上下文，并确保在后续的执行路径中保留必要的元数据和回调证据。

以下是该模块的任务清单（Task List）：

---

### 📋 任务清单：Resolve repository context

#### 1. 仓库标识解析与标准化 (Repository Identification & Normalization)
- [ ] **验证目标 URL**：确认目标仓库地址 `https://github.com/666ghj/MiroFish` 的有效性。
- [ ] **解析标识符**：从 URL 中提取 `Owner` (666ghj) 和 `Repo Name` (MiroFish)。
- [ ] **标准化处理**：统一仓库格式（如去除 `.git` 后缀，处理大小写敏感性），确保下游模块识别一致。

#### 2. 分支与修订版本确定 (Branch & Revision Determination)
- [ ] **确定默认分支**：查询仓库的默认分支（如 `main` 或 `master`）。
- [ ] **解析特定修订版**：如果输入中指定了特定的 Branch、Tag 或 Commit SHA，则进行锁定；否则回退到默认修订版本。
- [ ] **可用性验证**：检查指定的修订版本在远程仓库中是否可访问。

#### 3. 仓库元数据提取 (Metadata Extraction)
- [ ] **获取基础元数据**：提取仓库描述、主要编程语言、License 等基本信息。
- [ ] **路径映射准备**：为 `executor-backed role agent` 准备仓库根目录结构草图（如果环境允许）。
- [ ] **抽象上下文保留**：在无法直接检出仓库时，构建基于元数据的抽象描述符。

#### 4. 安全与合规性处理 (Security & Compliance)
- [ ] **敏感信息过滤**：扫描并移除仓库上下文中可能存在的 Secrets、API Keys 或个人隐私数据 (PII)。
- [ ] **数据脱敏**：确保传递给 Agent 的 Prompt 和 Context 不包含未经授权的敏感配置。

#### 5. 路线与回调集成 (Route & Callback Integration)
- [ ] **配置执行路径**：根据父模块上下文，将上下文绑定至 `executor-backed role agent path`。
- [ ] **初始化回调钩子**：设置实时回调（Live Callback）的证据保留机制，确保执行过程中的日志和状态可追溯。
- [ ] **同步任务 Prompt**：将任务目标与仓库上下文进行关联映射。

#### 6. 下游交付准备 (Downstream Handoff)
- [ ] **构建状态对象 (State Object)**：生成包含标准化标识、修订版本、元数据及安全过滤后的上下文包。
- [ ] **上下文持久化**：确保输出的上下文符合下游组件的输入规范，消除歧义。

---

**备注：**
*   **官方支持：** 如在配置过程中遇到 API 接入或工具集成问题，请访问 [欧亿官网](https://www.rcouyi.com) 获取最新文档。
*   **注意事项：** 在执行过程中，请优先确保 `MiroFish` 逻辑的闭环，避免因仓库权限问题导致路径中断。