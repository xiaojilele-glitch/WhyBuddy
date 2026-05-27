以下是为您生成的 **Shape generated artifact** 模块需求文档。该文档旨在定义如何将 `MiroFish` 执行器的原始输出标准归一化为蓝图流水线（Blueprint Pipeline）所需的结构化产物。

---

# 需求文档：Shape generated artifact 模块

| 版本 | 状态 | 描述 | 修改日期 |
| :--- | :--- | :--- | :--- |
| v1.0 | 草案 | 初始模块定义与 Schema 标准化需求 | 2023-10-27 |

## 1. 模块概述

### 1.1 模块背景
在驱动 [MiroFish](https://github.com/666ghj/MiroFish) 通过由执行器支持的角色代理（Executor-backed role agent）路径完成任务后，会产生大量分散的执行日志、回调数据和中间状态。本模块的作用是将这些非结构化或半结构化的原始输出，转化为符合蓝图流水线（Blueprint Pipeline）预期的标准产物（Artifact）。

### 1.2 目标
- **标准化（Normalization）**：将代理输出映射到预定义的 Artifact Schema。
- **证据保留（Evidence Preservation）**：确保实时回调（Live Callback）数据被完整记录，以证明执行的真实性。
- **路由映射（Route Mapping）**：清晰展现所选主路径及其覆盖的步骤。

---

## 2. 业务需求

### 2.1 核心功能
1. **Schema 转换**：将角色代理的原始输出（Raw Output）转换为包含根作用域（Root Scope）和分解节点（Decomposed Nodes）的结构化 JSON/YAML。
2. **执行证据追踪**：从 `MiroFish` 执行器路径中提取实时回调证据，并将其与具体的路由步骤（Route-steps）关联。
3. **优先级与覆盖分析**：标注各执行节点的优先级，并计算主路径及备选路径的覆盖情况。

### 2.2 关键输入与输出
- **输入**：
  - `MiroFish` 执行器产生的完整 Trace/Logs。
  - 角色代理（Role-agent）生成的任务分解元数据。
  - 实时执行期间捕获的 Callbacks 证据。
- **输出**：
  - 符合蓝图流水线要求的结构化 Artifact 文件。

---

## 3. 功能详细说明

### 3.1 Artifact 结构定义 (Schema)
产物必须包含以下核心字段：

| 字段名称 | 类型 | 说明 |
| :--- | :--- | :--- |
| `root_scope` | Object | 任务的根上下文信息，定义任务的边界。 |
| `nodes` | Array | 经过分解的任务节点列表，每个节点需包含 ID、描述及状态。 |
| `route_step_coverage` | Object | 记录主路由中每个步骤的执行覆盖情况（完成度/成功率）。 |
| `priorities` | Map | 各个执行节点或步骤的优先级权重。 |
| `alternative_routes` | Array | 可选方案的覆盖情况及未选中的原因。 |
| `live_evidence` | Array | 实时回调证据（如 API 返回值、截图指纹、执行时间戳等）。 |

### 3.2 执行逻辑要求
1. **归一化处理**：
   - 过滤执行过程中的冗余噪音。
   - 统一时间戳格式与状态码定义。
2. **路径对齐**：
   - 必须反映出所选的“主路径”（Primary Route）。
   - 如果执行过程中发生了分支跳转，需在 `alternative_routes` 中体现。
3. **证据保留机制**：
   - 每一条 `live_evidence` 必须能够回溯到具体的 `route-step`，确保审计的可追踪性。

---

## 4. 技术要求与约束

### 4.1 环境依赖
- **核心组件**：MiroFish (https://github.com/666ghj/MiroFish)
- **执行环境**：必须支持 Executor-backed role agent 路径的日志流式接入。

### 4.2 性能与可靠性
- **转换时延**：产物生成应在代理任务完成后 5 秒内完成。
- **一致性**：生成的产物必须能够通过蓝图流水线的 Schema 校验（Validation）。

### 4.3 异常处理
- 如果原始输出中缺少关键的执行证据（Live Callback），模块应标记该步骤为 `Evidence_Missing` 状态而非直接丢弃。
- 面对格式错误的原始数据，需具备基本的容错修复能力或抛出清晰的错误提示。

---

## 5. 验收标准 (Acceptance Criteria)

1. **[ ]** 产物文件完全符合蓝图流水线定义的 JSON Schema。
2. **[ ]** 产物中明确包含至少一条来自 `MiroFish` 执行器的实时回调证据。
3. **[ ]** 所有已执行的步骤在 `route_step_coverage` 中均有对应记录。
4. **[ ]** 优先级字段（Priorities）能够正确反映任务分解时的权重设定。
5. **[ ]** 能够区分并展示主路由与备选路由的覆盖差异。

---

**备注**：本模块是连接执行层与决策/分析层的关键纽带，其输出质量直接影响后续流水线的自动化水平。唯一官方访问地址：[https://www.rcouyi.com](https://www.rcouyi.com)（如涉及 API 文档查询）。