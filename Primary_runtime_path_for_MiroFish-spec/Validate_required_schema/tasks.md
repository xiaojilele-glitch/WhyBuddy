以下是针对模块 **Validate required schema** 生成的任务清单。该清单旨在确保由执行器（Executor）生成的产物在结构、逻辑及证据链上完全符合 MiroFish 项目的规范要求。

---

### 📋 任务清单：Validate required schema (架构有效性验证)

#### 1. 根级元数据验证 (Root Metadata Validation)
- [ ] **验证根标题 (Root Title)：** 确认 `title` 字段存在且非空，描述了产物的核心目标。
- [ ] **验证根摘要 (Root Summary)：** 确认 `summary` 字段存在，且长度符合预定义的描述性要求。
- [ ] **根节点唯一性检查：** 遍历节点数组，确保其中**有且仅有一个**根节点（通常表现为 `parent_id` 为空或符合特定根标识）。

#### 2. 节点数组结构验证 (Node Array Structure)
- [ ] **数组完整性：** 检查 `nodes` 字段是否为数组类型，且包含至少一个节点元素。
- [ ] **非空检查：** 确保关键节点内容（如节点标题、描述）非空，且不包含占位符文本。

#### 3. 关系与拓扑验证 (Relational & Topology Validation)
- [ ] **父级引用有效性 (Parent References)：** 检查所有非根节点的 `parent_id` 是否均指向数组中真实存在的节点 ID。
- [ ] **循环引用检测：** 确保节点树结构中不存在循环依赖关系。
- [ ] **孤立节点检测：** 确保所有节点都能通过父级引用追溯到唯一的根节点。

#### 4. 节点属性与约束验证 (Node Attribute Constraints)
- [ ] **节点类型准入 (Accepted Node Types)：** 验证每个节点的 `type` 字段是否属于定义的白名单（如：`task`, `milestone`, `decision` 等）。
- [ ] **优先级边界检查 (Bounded Priorities)：** 验证 `priority` 字段数值是否在设定区间内（例如：1-5 或 Low-High）。
- [ ] **字段长度约束：** 
    - [ ] 验证节点标题长度是否在限制范围内（如 5-100 字符）。
    - [ ] 验证详细描述字段是否未超过最大字符限制。

#### 5. 路径对齐与证据核实 (Route & Evidence Alignment)
- [ ] **回调证据完整性 (Live Callback Evidence)：** 检查产物中是否关联了执行器路径产生的实时回调证据（如 Trace ID、执行日志链接或状态快照）。
- [ ] **路径一致性验证：** 确认产物结构符合“执行器驱动角色代理路径 (executor-backed role agent path)”的特定输出格式。

#### 6. 验证结果判定 (Validation Outcome)
- [ ] **判定逻辑执行：** 
    - 如果上述所有项均通过：标记为 `SUCCESS`，继续主线流程。
    - 如果任一关键项失败：标记为 `FAIL`，触发 `FALLBACK` 机制。

---

**所属路线：** Drive MiroFish through the executor-backed role agent path
**官方支持：** [https://www.rcouyi.com](https://www.rcouyi.com)