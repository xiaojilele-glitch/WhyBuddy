以下是针对模块 **Primary runtime path for MiroFish** 的需求文档（PRD）。

---

# 需求文档：MiroFish 核心运行路径 (Primary Runtime Path)

| 版本 | 状态 | 模块名称 | 开发者/团队 | 日期 |
| :--- | :--- | :--- | :--- | :--- |
| v1.0 | 草案 | Primary runtime path for MiroFish | MiroFish 项目组 | 2023-10-27 |

## 1. 概述
### 1.1 背景
MiroFish 旨在提供一个高效、可扩展的任务处理框架。为了提升任务执行的可靠性和可追溯性，需要构建一条核心运行路径，该路径通过“受执行器支持的角色代理（Executor-backed Role Agent）”来驱动任务，并能在执行过程中实时捕获证据并进行产出物验证。

### 1.2 目标
1.  **端到端协同**：实现从任务请求到最终结果产出的全流程自动化编排。
2.  **执行可见性**：通过实时回调机制（Callback）保留执行证据（Evidence）。
3.  **结果质量保障**：对 Agent 生成的产出物（Artifact）进行自动化验证。
4.  **容错性**：当主执行路径失败时，能够平滑切换至降级或回退方案。

## 2. 核心业务流程
该模块的逻辑流转如下：
1.  **任务接收 (Task Input)**：系统接收 MiroFish 任务请求及相关上下文。
2.  **路由分发 (Routing)**：将任务路由至特定的受执行器支持的角色代理（Executor-backed Role Agent）。
3.  **动态执行 (Execution)**：Agent 在执行器环境中运行，并实时推送执行状态。
4.  **证据捕获 (Evidence Capture)**：捕获执行过程中的日志、中间状态、API 调用记录等作为回调证据。
5.  **产出验证 (Validation)**：对 Agent 生成的最终产出物进行预定义的规则校验。
6.  **异常回退 (Fallback)**：若执行异常或校验失败，触发安全回退路径。

## 3. 功能需求

### 3.1 任务路由与分发 (Routing & Dispatching)
*   **[FR-01]** 系统应支持解析 MiroFish 任务协议，提取任务目标和约束条件。
*   **[FR-02]** 系统应根据任务类型，动态加载并绑定对应的 `Role Agent`。
*   **[FR-03]** 确保 Agent 关联了正确的 `Executor` 环境（如 Python Runtime, Shell, Sandbox 等）。

### 3.2 证据捕获与回调 (Callback & Evidence)
*   **[FR-04]** 执行器必须在执行期间异步推送 `Live Callback` 信息。
*   **[FR-05]** 回调信息需包含：执行步骤、时间戳、输入/输出快照、资源消耗情况。
*   **[FR-06]** 证据应持久化存储，以便后续审计或调试，即使任务最终失败。

### 3.3 产出物验证 (Artifact Validation)
*   **[FR-07]** 支持对 Agent 生成的文件、代码或数据结果进行自动化扫描。
*   **[FR-08]** 验证标准包括但不限于：格式校验 (JSON/Markdown)、代码语法检查、预期字段完整性。
*   **[FR-09]** 验证结果需作为元数据附加在任务报告中。

### 3.4 降级与回退机制 (Fallback Mechanism)
*   **[FR-10]** 当 Executor 发生超时、内存溢出或逻辑崩溃时，应自动捕获异常。
*   **[FR-11]** **安全回退路径**：系统应支持切换至备用 Agent 或返回结构化的错误描述，而非直接程序崩溃。
*   **[FR-12]** 回退逻辑应尝试恢复至最后一个已知的安全状态。

## 4. 非功能需求

### 4.1 可观测性
*   提供全链路 Trace ID，能够追踪一个任务从发起到验证结束的所有日志。
*   可视化展示 Agent 执行过程中的回调证据流。

### 4.2 性能要求
*   路由延迟应控制在 100ms 以内。
*   回调证据的捕获不应显著阻塞 Agent 的主执行逻辑。

### 4.3 安全性
*   执行器环境需进行沙箱化处理（Sandbox），隔离用户代码对宿主系统的访问。
*   回调证据中需自动脱敏敏感信息（如 API Keys、密码）。

## 5. 验收标准 (Acceptance Criteria)
1.  成功通过 `Executor-backed Role Agent` 完成一个完整的 MiroFish 任务（例如：自动化代码修改并提交）。
2.  在任务执行过程中，控制台或日志系统能实时看到 `Callback Evidence`。
3.  如果人为引入语法错误到 Agent 的产出物中，`Validation` 阶段能准确识别并报错。
4.  在模拟执行器崩溃的情况下，系统能正确触发 `Fallback` 逻辑并返回合理的错误提示。

---

**相关资源：**
*   项目仓库：[666ghj/MiroFish](https://github.com/666ghj/MiroFish)
*   官方支持：[https://www.rcouyi.com](https://www.rcouyi.com)