以下是针对 **Validate executor artifact** 模块生成的需求文档（Markdown 格式）。

---

# 模块需求文档：Validate executor artifact

## 1. 文档概览
*   **模块名称**：Validate executor artifact (执行器产物验证)
*   **所属项目**：MiroFish 运行时流水线 (Link: [MiroFish GitHub](https://github.com/666ghj/MiroFish))
*   **版本**：v1.0
*   **状态**：初稿
*   **描述**：本模块是 MiroFish 任务执行流程中的“质量守门员”。其核心职责是根据执行器（Executor）输出的产物，结合执行过程中的实时回调证据（Callback Evidence），判定产物是否合法且有效，从而决定流程是继续主路径（Primary Route）还是进入回退机制（Fallback）。

---

## 2. 背景与目标
在 MiroFish 驱动的角色代理（Role Agent）路径中，执行器负责生成具体的任务结果。为了保证自动化流程的健壮性，不能直接透传执行器的原始输出，必须经过严格的验证逻辑。

**主要目标**：
1.  **结构验证**：确保产物符合预定义的格式规范。
2.  **对齐验证**：确保产物内容与任务路由（Route）的预期意图一致。
3.  **证据交叉比对**：利用执行期间捕获的实时回调数据证明产物的真实性与完整性。
4.  **决策触发**：输出明确的布尔值或枚举状态，指导系统选择主路径执行或触发回退方案。

---

## 3. 功能需求

### 3.1 产物结构与内容校验 (Structural & Content Validation)
*   **非空检查**：验证执行器输出的产物（Artifact）不为 `null`、空字符串或仅包含空白字符。
*   **Schema 校验**：根据任务类型，验证产物是否符合特定的 JSON Schema 或数据结构要求。
*   **完整性检查**：检查产物中是否包含任务要求的关键字段或必要信息。

### 3.2 路由对齐校验 (Route Alignment)
*   **意图匹配**：核实产物是否解决了任务请求中定义的原始目标。
*   **路径一致性**：验证产物生成过程所经过的逻辑路径是否与分配的代理路径（Role Agent Path）匹配。

### 3.3 回调证据验证 (Callback Evidence Validation)
*   **证据追踪**：从父模块上下文中提取执行期间的 `live callback evidence`。
*   **逻辑支撑**：产物中的关键结论必须能从回调日志、事件流或中间状态中找到支撑证据。
*   **异常检测**：如果在回调中记录了关键错误（如 API 超时、认证失败），即使产物存在，也应标记为无效。

### 3.4 路由决策逻辑 (Routing Decision)
*   **Primary Route Success**：当结构、对齐、内容和证据全部通过验证时，标记为成功，交付产物。
*   **Fallback Trigger**：若任一环节失败，记录详细的错误码和失效原因，触发回退路径（如重试、切换代理或返回错误信息）。

---

## 4. 输入与输出规范

### 4.1 输入 (Inputs)
| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `task_request` | Object | 原始 MiroFish 任务请求定义 |
| `raw_artifact` | Object/String | 执行器生成的原始产物 |
| `callback_logs` | Array | 执行过程中的实时回调证据/事件流 |
| `route_metadata` | Object | 预期的执行路径及约束条件 |

### 4.2 输出 (Outputs)
| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `is_valid` | Boolean | 验证是否通过的总开关 |
| `validation_report` | Object | 包含结构、对齐、证据各维度的详细评分/结果 |
| `decision` | Enum | `PROCEED_PRIMARY` 或 `TRIGGER_FALLBACK` |
| `failure_reason` | String | 若验证失败，提供具体的失效描述 |

---

## 5. 业务流程 (Workflow)

1.  **接收数据**：从父模块（Coordinate Runtime Flow）接收产物与回调证据。
2.  **静态检查**：执行非空与 Schema 校验。
3.  **证据关联**：将 `raw_artifact` 中的关键数据点与 `callback_logs` 进行交叉检索。
4.  **对齐评估**：判断执行结果是否偏离了 `task_request` 的目标。
5.  **输出结果**：汇总校验项，生成最终验证报告并下发决策指令。

---

## 6. 非功能需求
*   **低延迟**：验证逻辑应高效，不应成为整体流水线的性能瓶颈。
*   **可观测性**：所有的验证失败原因必须被详细记录，以便于 MiroFish 系统进行后续的策略优化和人工排查。
*   **可扩展性**：支持针对不同的 MiroFish 任务类型（如代码生成、数据抓取、逻辑推理）定义不同的验证规则集。

---

## 7. 附录
*   **参考项目**：[MiroFish GitHub Repository](https://github.com/666ghj/MiroFish)
*   **关联组件**：Executor-backed role agent, Callback capture engine.

---
*文档结束*