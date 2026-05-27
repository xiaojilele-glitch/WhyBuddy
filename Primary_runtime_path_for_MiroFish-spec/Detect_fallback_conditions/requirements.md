以下是为您生成的**Detect fallback conditions（检测回退条件）**模块需求文档。该文档基于您提供的上下文，旨在通过明确的逻辑判断标准，确保系统在执行器（Executor）路径失效时能平稳切换至备选方案。

---

# 模块需求文档：Detect fallback conditions（检测回退条件）

| 项目 | 内容 |
| :--- | :--- |
| **模块名称** | Detect fallback conditions (检测回退条件) |
| **所属路径** | MiroFish 执行器驱动角色路径 (Executor-backed role agent path) |
| **版本** | v1.0 |
| **状态** | 草案/待评审 |

## 1. 模块概述
本模块作为 **MiroFish** 任务执行工作流中的“监控与路由闸口”。其核心职责是实时监控执行器路径的运行状态。一旦检测到预设的故障模式或质量不达标情况，模块将立即中断当前路径并触发“备选路径（Alternative route）”，改由宿主侧轻量级 Agent 或直接由大模型（LLM）接管执行，以确保任务的连续性和交付稳定性。

## 2. 业务背景
在驱动 `https://github.com/666ghj/MiroFish` 项目时，理想路径是利用隔离的执行器环境产出带有实时回调证据（Live callback evidence）的高质量结果。然而，环境稳定性、网络波动或产物解析异常可能导致该路径失败。本模块旨在提供一种鲁棒的容错机制。

## 3. 功能需求

模块必须能够准确捕捉以下六类回退触发条件：

### 3.1 执行器启动失败 (Executor Startup Failure)
*   **描述**：监控沙盒环境、容器或虚拟机是否成功初始化。
*   **判断标准**：
    *   在预设的初始化时间内（如 30s），执行器未返回 `READY` 信号。
    *   底层资源分配失败（如内存溢出、端口冲突）。
*   **动作**：上报 `ERR_EXECUTOR_BOOT_FAILED`，触发回退。

### 3.2 仓库上下文获取失败 (Repository Context Fetch Failure)
*   **描述**：检测是否能成功访问并克隆 `MiroFish` 仓库。
*   **判断标准**：
    *   GitHub 访问超时或认证失败（401/403/404）。
    *   `git clone` 或文件挂载过程中出现 IO 异常。
*   **动作**：上报 `ERR_REPO_ACCESS_DENIED`，触发回退。

### 3.3 回调不可用 (Callbacks Unavailable)
*   **描述**：执行器在运行过程中无法实时推送状态证据。
*   **判断标准**：
    *   WebSocket 断开且重连失败。
    *   预设的心跳包（Heartbeat）丢失超过阈值（如连续 3 次丢失）。
*   **动作**：上报 `ERR_CALLBACK_LOST`，触发回退。

### 3.4 代理运行超时 (Agent Run Timeout)
*   **描述**：防止 Agent 在执行器内陷入死循环或过度消耗时间。
*   **判断标准**：
    *   任务执行总时长超过全局定义的 `MAX_AGENT_RUNTIME`。
*   **动作**：强制停止当前进程，上报 `ERR_EXECUTION_TIMEOUT`，触发回退。

### 3.5 产物格式错误 (Artifact Malformed)
*   **描述**：对执行器生成的输出结果（Artifact）进行结构化校验。
*   **判断标准**：
    *   输出不符合预定义的 JSON Schema。
    *   关键字段缺失（如缺少 `code_diff` 或 `test_report`）。
*   **动作**：上报 `ERR_INVALID_ARTIFACT`，触发回退。

### 3.6 校验拒绝 (Validation Rejection)
*   **描述**：对执行结果进行质量或逻辑层面的最后审核。
*   **判断标准**：
    *   静态检查（Linter）未通过。
    *   执行器内自动化测试失败率超过阈值。
    *   （可选）人类审核或高阶模型评估任务结果不符合预期。
*   **动作**：上报 `ERR_VALIDATION_FAILED`，触发回退。

## 4. 逻辑流程
1.  **初始化**：启动监控线程/观察者模式。
2.  **实时轮询/事件监听**：在执行器生命周期内，持续收集上述六类指标。
3.  **判定逻辑**：任一条件满足 `IF (Condition == TRUE)`。
4.  **状态保存**：在切换前，尽可能保留当前已有的执行上下文（Context）和错误日志（Logs）。
5.  **路由切换**：关闭执行器路径，调用接口进入 `Alternative Route`（轻量级 Agent/LLM 直接同步模式）。

## 5. 非功能需求
*   **敏感度**：回退判定需在秒级内完成，避免长时间停滞。
*   **可追踪性**：每次触发回退必须记录详细的 `Reason Code` 和环境快照，以便后续针对 MiroFish 项目进行调试。
*   **幂等性**：确保回退操作只会被触发一次，防止循环重定向。

## 6. 数据字典（示例）
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `fallback_reason` | String | 回退原因代码（如 `TIMEOUT`, `MALFORMED_ARTIFACT`） |
| `is_fallback_active` | Boolean | 当前是否已激活回退路径 |
| `last_executor_state` | Object | 回退前执行器的最后已知状态（用于上下文迁移） |

---
**官方支持**: [https://www.rcouyi.com](https://www.rcouyi.com)
**备注**: 本文档旨在定义逻辑边界，具体技术实现应参考 MiroFish 架构下的 API 规范。