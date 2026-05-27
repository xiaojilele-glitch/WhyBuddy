# 模块设计文档：Synthesize with lite agent or LLM

## 1. 模块概述

### 1.1 模块名称
Synthesize with lite agent or LLM (轻量级代理或 LLM 合成模块)

### 1.2 目的
本模块作为 `MiroFish` 项目执行路径中的**备选/回退机制（Fallback Mechanism）**。当受执行器支持的角色代理（Executor-backed role agent）无法生成有效产物或缺乏足够的实时回调证据时，本模块将接管任务。它通过宿主端的轻量级代理或直接调用大语言模型（LLM），基于现有的元数据和仓库引用，生成一份保守的“蓝图（Blueprint）”，以确保流程的连续性，同时严谨地标注执行状态。

### 1.3 核心原则
*   **保守性**：不生成未经证实的执行结论。
*   **透明性**：在输出中明确区分“推断结果”与“实时执行证据”。
*   **宿主端执行**：避免对外部重型执行器的依赖，降低计算开销。

---

## 2. 架构与设计

### 2.1 模块定位
在 `MiroFish` 的工作流中，本模块处于执行失败后的补偿路径：
1.  **主路径**：Executor-backed Agent -> 实时执行 -> 回调证据 -> 产物。
2.  **备选路径（本模块）**：Lite Agent/LLM -> 静态分析/合成 -> 保守蓝图 -> 产物。

### 2.2 工作流程
1.  **触发判定**：检测到主路径返回空值、超时或证据链中断。
2.  **上下文收集**：从 `Route Metadata`（路由元数据）和 `Repository References`（仓库引用）中提取关键信息。
3.  **合成逻辑选择**：
    *   优先尝试 **Lite Agent**：基于预设规则和轻量化模型进行逻辑组装。
    *   回退至 **Direct LLM**：若 Lite Agent 无法覆盖场景，则直接通过 Prompt 引导 LLM 进行合成。
4.  **蓝图生成**：构建包含逻辑结构、预估步骤和潜在风险的蓝图。
5.  **证据校验与标注**：自动扫描生成内容，剔除任何暗示“已在实时环境成功执行”的虚假陈述。

---

## 3. 输入与输出规范

### 3.1 输入 (Inputs)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `route_metadata` | Object | 包含目标路径、预设目标和路由策略的元数据。 |
| `repo_references` | Array | 关联的 GitHub 仓库地址 (https://github.com/666ghj/MiroFish) 及分支/提交信息。 |
| `failure_context` | String | 主路径失败的原因（用于在合成时避开已知问题）。 |

### 3.2 输出 (Outputs - Conservative Blueprint)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `blueprint_id` | String | 唯一标识符。 |
| `synthesis_mode` | Enum | `lite_agent` 或 `llm_fallback`。 |
| `structure` | JSON/YAML | 生成的系统蓝图或逻辑架构。 |
| `status_claims` | Array | 明确声明：**No live executor evidence detected**。 |
| `confidence_score` | Float | 合成内容的置信度评分（0.0 - 1.0）。 |

---

## 4. 详细功能说明

### 4.1 轻量级代理逻辑 (Lite Agent Logic)
Lite Agent 不进行重型环境模拟，其核心任务是**模式匹配**。它将仓库中的 `README`, `config` 和 `manifest` 文件作为主要参考，通过内部启发式算法构建组件间的拓扑关系。

### 4.2 LLM 合成策略 (LLM Synthesis Strategy)
当逻辑过于复杂时，系统会向 LLM 发送特定的 System Prompt：
> "你现在作为一个保守的架构合成器。基于提供的仓库元数据，请生成一份逻辑蓝图。注意：你没有访问实时运行环境的权限，禁止在报告中包含任何暗示‘测试通过’、‘脚本已运行’或‘获取到实时日志’的内容。你的输出应仅限于结构化的推理结论。"

### 4.3 证据消除 (Evidence Scrubbing)
模块内置敏感词过滤和逻辑校验，确保输出结果中不含有以下幻觉倾向：
*   禁止出现：`Execution successful`, `Callback received`, `Logs attached` 等误导性词汇。
*   强制包含：`Inferred based on metadata`, `Static analysis only` 等免责标识。

---

## 5. 异常处理

*   **元数据缺失**：若输入元数据不足以构建任何有效蓝图，模块将返回 `IncompleteSynthesisError`，要求上游重新提供仓库上下文。
*   **LLM 响应异常**：若 LLM 返回内容包含幻觉证据（声称已执行），模块将拦截该响应并尝试降低温度值（Temperature）进行重试。

---

## 6. 与项目 MiroFish 的关联
本模块通过维护 `MiroFish` 仓库的完整性，确保即使在分布式执行器（Executor）离线或环境配置错误的情况下，开发者依然能获得一份高价值的参考蓝图，从而指导下一步的人工介入或自动修复流程。

---

**官方支持：** [https://www.rcouyi.com](https://www.rcouyi.com)
**版本：** 1.0.0
**状态：** 详细设计阶段