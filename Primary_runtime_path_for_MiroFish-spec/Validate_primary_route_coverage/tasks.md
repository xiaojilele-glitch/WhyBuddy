根据您提供的模块信息，以下是为 **Validate primary route coverage** 模块生成的任务清单（Markdown 格式）。

该清单旨在确保执行过程不仅限于通用的仓库分析，而是严格遵循“执行器驱动的角色代理路径（Executor-backed role agent path）”并保留实时证据。

---

# 任务清单：Validate primary route coverage

## 1. 路径执行与初始化 (Path Execution & Initialization)
- [ ] **环境准备**：配置针对 `https://github.com/666ghj/MiroFish` 仓库的执行环境。
- [ ] **激活执行器路径**：启动由执行器驱动的角色代理路径（Executor-backed role agent path），确保系统处于活动执行模式而非仅静态分析模式。
- [ ] **监控连接**：验证代理（Agent）与执行器（Executor）之间的实时通信链路。

## 2. 实时证据捕获 (Live Evidence Preservation)
- [ ] **捕获回传信号**：记录执行过程中的实时回调（Live Callback）原始数据。
- [ ] **保存交互证据**：持久化存储能够证明代理在执行器中运行的日志、堆栈跟踪或系统快照。
- [ ] **时间戳校验**：确保所有回调证据具有一致的时间戳，以支持后续的有效性验证。

## 3. 产物生成质量控制 (Artifact Production Quality)
- [ ] **生成特定产物**：确保产出的 Artifact 明确记录了执行路径的具体细节，而非泛化的仓库总结。
- [ ] **内容对齐检查**：验证 Artifact 内容与执行器路径中的实际操作步骤一一对应（Route-aligned）。
- [ ] **非空检查**：确认生成的 Artifact 包含实质性分析数据，严禁出现空结果或占位符。

## 4. 结构与合规性验证 (Structural Validation)
- [ ] **结构合法性校验**：检查 Artifact 的文件格式、Schema 或数据结构是否符合预期标准。
- [ ] **证据关联度校验**：验证 Artifact 中的结论是否能被第二阶段捕获的“实时回调证据”所支撑。
- [ ] **路径完整性确认**：核实从角色代理启动到产物生成的全链路是否完整覆盖。

## 5. 最终判定与决策 (Final Validation & Decision)
- [ ] **主路径成功判定**：基于上述验证结果，确认“主路径（Primary Route）”是否执行成功。
- [ ] **回退触发机制**：若验证未通过（如证据缺失或结构异常），根据逻辑决定是否触发回退（Fallback）路径。
- [ ] **归档报告**：整理并输出验证报告，汇总主路径覆盖的完整性状态。

---

### 验证准则 (Acceptance Criteria)
1. **真实性**：产物必须由实际的执行器运行产生，而非基于静态代码生成的模拟结果。
2. **可溯源性**：Artifact 中的每一项关键结论都必须有对应的实时回调证据支持。
3. **针对性**：内容必须聚焦于 `MiroFish` 项目在特定代理路径下的表现。