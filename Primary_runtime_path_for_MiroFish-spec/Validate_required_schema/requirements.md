以下是针对 **Validate required schema** 模块生成的需求文档。该文档旨在明确模块的功能逻辑、验证规则以及在 MiroFish 执行器路径中的集成要求。

---

# 需求文档：Validate required schema (验证必填架构)

## 1. 模块概述
**模块名称**：Validate required schema  
**模块版本**：v1.0.0  
**所属路线**：Drive MiroFish (https://github.com/666ghj/MiroFish) 路径下的 Executor-backed role agent 路径。  
**主要功能**：对执行器（Executor）生成的产物（Artifact）进行深度结构化验证。确保数据完整性、逻辑一致性、符合路由对齐要求，并验证是否存在有效的实时回调证据。

## 2. 背景与目标
在 MiroFish 的执行流程中，该模块作为关键的质量闸门（Quality Gate）。其核心目标是：
*   确保产物结构符合业务定义的 Schema。
*   防止下游系统接收到非法、空值或逻辑错误的节点树。
*   根据验证结果决定主流程（Primary Route）继续执行还是触发回退机制（Fallback）。

## 3. 核心功能要求

### 3.1 根信息验证 (Root Metadata)
*   **Root Title**: 必须包含根标题，且不得为空字符串。
*   **Root Summary**: 必须包含根摘要，用于描述产物的总体内容。

### 3.2 节点阵列验证 (Node Array)
*   **Node Array Existence**: 产物必须包含一个名为 `nodes` (或指定字段) 的数组。
*   **Single Root Node**: 整个节点阵列中必须且只能有**一个**根节点（通常定义为 `parent_id` 为空或特定的 Root 标识）。

### 3.3 拓扑逻辑验证 (Topology)
*   **Valid Parent References**: 
    *   所有非根节点的父节点引用必须指向阵列中存在的有效节点 ID。
    *   严禁出现悬挂节点（Dangling nodes）或循环引用（Circular references）。

### 3.4 节点属性约束 (Node Attributes)
*   **Accepted Node Types**: 节点类型必须在预定义的白名单内（例如：Task, Info, Decision, Milestone 等）。
*   **Bounded Priorities**: 优先级字段必须在指定范围内（例如：1-5 或 0-100）。
*   **Field-Length Constraints**: 
    *   标题长度限制（如：1-100 字符）。
    *   描述内容长度限制（如：0-2000 字符）。

### 3.5 路径与证据验证 (Route & Evidence)
*   **Route Alignment**: 验证产物内容是否与执行器路径（Executor Path）预设的目标一致。
*   **Callback Evidence**: 必须验证产物中包含实时的回调证据（Live callback evidence），证明该产物是由 Agent 在执行路径中真实生成的，而非缓存或伪造数据。

## 4. 验证逻辑与输出

### 4.1 输入
*   **Artifact**: 执行器生成的 JSON/对象数据。
*   **Trace Context**: 包含回调日志和执行路径定义的上下文数据。

### 4.2 验证流程
1.  **静态检查**：检查必填字段是否存在。
2.  **类型检查**：检查数据类型（String, Array, Integer）是否匹配。
3.  **约束检查**：执行长度、范围和枚举值验证。
4.  **关系检查**：扫描节点树，验证父子关系和单一根节点。
5.  **证据交叉检查**：比对回调证据与当前执行路径的匹配度。

### 4.3 输出结果
模块需返回以下结构化结果：
*   **Status**: `Success` | `Failed`
*   **Error_List**: (若失败) 包含所有违反规则的详细描述（字段名、错误类型、错误原因）。
*   **Route_Decision**: 
    *   若 `Success`：继续执行后续业务逻辑。
    *   若 `Failed`：抛出异常并触发 `Fallback` 机制。

## 5. 非功能性要求
*   **性能**：验证过程应在毫秒级完成，不得成为路径执行的瓶颈。
*   **健壮性**：对于格式严重损坏的输入（如非法的 JSON），应能优雅捕获异常并记录。
*   **可观测性**：所有的验证失败案例必须详细记录到系统日志中，以便于 MiroFish 开发者调试。

---

**备注**：此模块是确保 MiroFish 项目在通过执行器支持的角色代理路径时，保持数据严谨性的核心组件。官方参考信息及代码库详见：[MiroFish GitHub](https://github.com/666ghj/MiroFish)。