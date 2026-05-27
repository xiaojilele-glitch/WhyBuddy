根据您的需求，针对 **Drive role-agent step loop** 模块，我为您生成了如下任务清单。该清单旨在指导 Role Agent 完成“观察-计划-工具交互-综合-验证”的循环，并确保每一步都具备可追溯的回调证据（Evidence）。

---

# 任务清单：Drive role-agent step loop 模块开发

## 1. 核心循环框架搭建 (Core Loop Infrastructure)
- [ ] **定义 Agent 状态机**：设计并实现 Role Agent 的状态流转逻辑，涵盖 `Observation` (观察), `Planning` (计划), `Action` (行动), `Synthesis` (综合), `Validation` (验证)。
- [ ] **Executor 接口对接**：配置后端执行器（Backend Executor），确保 Agent 能够通过执行器触发具体任务。
- [ ] **迭代终止条件设定**：定义循环退出的标准（如：目标达成、达到最大迭代次数、检测到不可恢复错误等）。

## 2. 步骤逻辑实现 (Step-by-Step Implementation)
- [ ] **观察阶段 (Observation)**：
    *   实现从 MiroFish 运行时环境获取上下文、日志和实时数据的接口。
    *   将原始观测数据转换为 Agent 可理解的结构化表示。
- [ ] **计划阶段 (Planning)**：
    *   基于当前观测结果，驱动 LLM 生成逻辑执行计划或任务拆解。
    *   支持计划的动态修正（根据前一步的结果调整后续步骤）。
- [ ] **工具交互 (Tool Interaction)**：
    *   实现 Agent 对外部工具或 MiroFish 内部 API 的调用逻辑。
    *   处理工具调用的输入参数校验与异常捕获。
- [ ] **结果综合 (Synthesis)**：
    *   整合工具返回的数据与原始计划。
    *   更新 Agent 的内部记忆（Memory）或全局状态。
- [ ] **验证阶段 (Validation)**：
    *   对当前产出物或状态进行一致性与目标达成度校验。
    *   若验证失败，触发重新计划或错误回溯机制。

## 3. 回调与证据保留机制 (Callback & Evidence Persistence)
- [ ] **实时回调钩子 (Live Callbacks)**：
    *   在每个步骤（Step）的开始与结束处埋设回调。
    *   支持流式传输（Streaming）Agent 的思考过程与动作到前端或监控日志。
- [ ] **证据收集器 (Evidence Collector)**：
    *   记录每一步的输入、输出、耗时、模型原始响应（Trace）。
    *   **关键点**：确保工具交互的原始 Payload 和回执被完整保留，作为审计证据。
- [ ] **可解释性工件生成 (Explainable Artifacts)**：
    *   将运行过程中的所有证据汇总，生成一份可读的、支持审计的最终执行报告（Audit Log）。

## 4. MiroFish 路线集成 (Path Integration)
- [ ] **执行器备份路径适配**：确保循环运行在 `executor-backed role agent path` 之上，利用执行器提供的资源保障。
- [ ] **GitHub 项目规范对齐**：参考 `666ghj/MiroFish` 的代码结构，确保模块与现有仓库的接口规范保持一致。
- [ ] **持久化存储关联**：将生成的 Evidence 数据与 MiroFish 的运行实例 ID 绑定，确保持久化存储。

## 5. 调试与验证 (Testing & Validation)
- [ ] **全链路压测**：模拟长序列任务，测试 Agent 在多轮循环中的状态保持与稳定性。
- [ ] **审计一致性检查**：对比 Agent 的实际行为与记录的回调证据，确保 100% 的动作可追溯。
- [ ] **边界情况处理**：测试工具调用超时、LLM 幻觉或返回无效格式时的循环恢复能力。

---

### 说明
*   **目标**：通过该循环，Role Agent 不仅仅是在“运行”，而是在每一个动作中都产生透明的证据，使得复杂决策过程变得可审计、可优化。
*   **优先级**：优先完成“观察-行动”的闭环，随后立即介入“回调证据”的记录功能。

如果您需要针对其中某个具体步骤（例如如何对接具体的 MiroFish API）进行深入讨论，请随时告诉我。