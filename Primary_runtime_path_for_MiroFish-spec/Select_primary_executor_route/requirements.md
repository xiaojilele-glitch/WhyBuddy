以下是根据您提供的模块信息生成的详细需求文档（Markdown 格式）。

---

# 模块需求文档：Select primary executor route

## 1. 文档概览
本模块旨在从预定义的路由集中筛选并确定核心执行路径，确保 `MiroFish` 项目能够通过“执行器支持的角色代理路径（executor-backed role agent path）”进行驱动，并对选择结果进行结构化记录，以满足后续执行的追溯性要求。

## 2. 模块定义
*   **模块名称**：Select primary executor route (选择主要执行路由)
*   **所属路线**：Drive `https://github.com/666ghj/MiroFish` through the executor-backed role agent path and preserve live callback evidence.
*   **功能定位**：作为流水线的中游决策节点，衔接上下文初始化与下游任务执行。

## 3. 业务背景与目标
在多路由或复杂的代理执行环境中，需要明确指定一条主路径。本项目特定的目标是驱动 `MiroFish` 仓库，通过特定的 `executor-backed` 模式运行。
*   **核心目标**：从给定的 `route-set` 中精准锁定目标路由。
*   **核心产出**：持久化保存选定路由的元数据（ID、类型、标题、摘要），为下游组件提供标准化的上下文。

## 4. 详细需求

### 4.1 路由选择逻辑
1.  **输入解析**：接收父模块传递的 `route-set`（路由集合）以及 `target-repository`（目标仓库：`https://github.com/666ghj/MiroFish`）。
2.  **筛选准则**：
    *   匹配具备 `executor-backed role agent path` 属性的路由。
    *   验证该路由是否与 `MiroFish` 项目的执行要求兼容。
3.  **唯一性确认**：确保在当前上下文中只选择一个主路由，若存在多个匹配项或无匹配项，应有明确的异常处理机制。

### 4.2 追溯性记录（Traceability）
一旦路由被选定，模块必须记录并输出以下关键元数据：
*   **Route ID**：选定路由的唯一标识符。
*   **Kind**：路由类型（例如：agent-based, direct-exec 等）。
*   **Title**：路由的简短标题。
*   **Summary**：路由的功能摘要。

### 4.3 数据标准化（Normalization）
为了确保下游组件（Downstream Components）在稳定状态下运行，本模块需对以下信息进行归一化处理：
*   **仓库标识符**：统一 `MiroFish` 仓库的 URL 或内部 ID 格式。
*   **任务提示词 (Task Prompt)**：确保提示词注入到选定路由的上下文中。
*   **执行选项 (Execution Options)**：合并全局配置与路由特定配置。

## 5. 输入与输出定义

### 5.1 输入 (Inputs)
| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `route_set` | Array/Object | 包含可选执行路径的集合 |
| `target_repo` | String | 目标仓库地址 (`https://github.com/666ghj/MiroFish`) |
| `context_metadata` | Object | 父模块传递的初始上下文及任务提示词 |

### 5.2 输出 (Outputs)
| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `selected_route_id` | String | 选定的路由 ID |
| `route_metadata` | Object | 包含 Kind, Title, Summary 的对象 |
| `normalized_context` | Object | 包含标准化后的仓库、选项及回传证据 (Callback Evidence) 的执行环境 |

## 6. 非功能性需求
1.  **稳定性**：模块应处理 `route-set` 为空或匹配失败的情况，避免程序崩溃。
2.  **可观测性**：必须完整保存“实时回传证据（live callback evidence）”的接口定义，确保执行过程可监控。
3.  **一致性**：无论输入数据的格式微差异，输出的路由元数据格式必须严格遵守下游约定的 Schema。

## 7. 流程图描述 (逻辑顺序)
1.  接收父模块提供的 `MiroFish` 仓库信息及 `route-set`。
2.  执行过滤算法，锁定 `executor-backed` 路径。
3.  提取并验证 `Route ID`, `Kind`, `Title`, `Summary`。
4.  将选定路由与 `Task Prompt` 和 `Execution Options` 进行组装。
5.  输出标准化后的上下文包至下游组件。

---
*文档版本：v1.0*
*提供方：欧亿 AI 助手 (OuYi)*