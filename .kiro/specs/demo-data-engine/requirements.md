# 需求文档：Demo Data Engine（预录演示数据引擎）

## 简介

为 WhyBuddy 多智能体可视化教学平台构建预录演示数据引擎。该引擎提供一套完整的预录数据包，用于驱动前端完整的 Demo 体验流程，无需任何 LLM API Key 依赖。数据包以 TypeScript 模块形式存储，符合 shared/ 目录下的契约类型，支持序列化/反序列化以便未来录制新的演示数据。

本文档覆盖 frontend-demo-mode 需求中的模块一（数据层），包含预录演示数据包结构和序列化/反序列化两大需求。

## 术语表

- **Demo_Data_Bundle**：预录演示数据包，包含一套完整 mission 执行的所有快照数据（组织结构、工作流记录、智能体、消息、任务、记忆条目、进化日志、事件序列）
- **DemoDataSchema**：演示数据包的 TypeScript 类型定义，描述 Demo_Data_Bundle 的完整结构
- **Organization_Snapshot**：动态组织快照（WorkflowOrganizationSnapshot），描述 CEO → Manager → Worker 的层级结构
- **Agent_Event**：运行时事件（AgentEvent），驱动 3D 场景中角色状态变化，携带时间戳偏移量
- **Memory_Entry**：记忆系统写入记录，覆盖短期记忆（LLM 交互日志）、中期记忆（工作流摘要）、长期记忆（SOUL.md 补丁）
- **Evolution_Log**：自进化日志，记录能力评分变化和 SOUL.md 补丁内容
- **Serializer**：序列化器，将运行时数据结构转换为 JSON 格式
- **Deserializer**：反序列化器，将 JSON 格式转换为运行时数据结构

## 需求

### 需求 1：预录演示数据包结构

**用户故事：** 作为开发者，我希望有一套完整的预录演示数据包，以便在不依赖 LLM 的情况下驱动完整的前端演示流程。

#### 验收标准

1.1. THE Demo_Data_Bundle SHALL 包含一套完整 mission 的所有执行数据，覆盖十阶段工作流的全部阶段（direction、planning、execution、review、meta_audit、revision、verify、summary、feedback、evolution）

1.2. THE Demo_Data_Bundle SHALL 包含一个有效的 Organization_Snapshot，描述至少 1 个 CEO、2 个 Manager 和 4 个 Worker 的动态组织结构

1.3. THE Demo_Data_Bundle SHALL 包含每个阶段的 Agent_Event 序列，每个事件携带时间戳偏移量（相对于演示开始时间的毫秒数）

1.4. THE Demo_Data_Bundle SHALL 包含至少 20 条 MessageRecord，覆盖 CEO→Manager、Manager→Worker、Worker→Manager 的消息流转

1.5. THE Demo_Data_Bundle SHALL 包含至少 4 条 TaskRecord，每条任务包含完整的 deliverable、评分（score_accuracy、score_completeness、score_actionability、score_format）和反馈数据

1.6. THE Demo_Data_Bundle SHALL 包含 Memory_Entry 写入记录，覆盖短期记忆（LLM 交互日志）、中期记忆（工作流摘要）和长期记忆（SOUL.md 补丁）

1.7. THE Demo_Data_Bundle SHALL 包含 Evolution_Log 记录，包含能力评分变化（old_score → new_score）和 SOUL.md 补丁内容

1.8. THE Demo_Data_Bundle SHALL 以 TypeScript 模块形式存储在 `client/src/runtime/demo-data/` 目录下，支持 tree-shaking

1.9. THE Demo_Data_Bundle SHALL 通过 TypeScript 类型检查，所有数据结构符合 shared/ 目录下定义的契约类型（WorkflowRecord、MessageRecord、TaskRecord、AgentRecord、WorkflowOrganizationSnapshot）

### 需求 2：演示数据序列化与反序列化

**用户故事：** 作为开发者，我希望演示数据包支持序列化和反序列化，以便未来可以从真实 mission 执行中录制新的演示数据。

#### 验收标准

2.1. THE DemoDataSchema SHALL 定义演示数据包的完整 TypeScript 类型，包含 organization、workflow、agents、messages、tasks、memoryEntries、evolutionLogs 和 events 字段

2.2. THE Serializer SHALL 提供 serializeDemoData 函数，将运行时数据结构序列化为 JSON 格式的 Demo_Data_Bundle

2.3. THE Deserializer SHALL 提供 deserializeDemoData 函数，将 JSON 格式的 Demo_Data_Bundle 反序列化为运行时数据结构

2.4. FOR ALL 有效的 DemoDataSchema 实例，序列化后再反序列化 SHALL 产生与原始实例等价的对象（round-trip 属性）

2.5. THE Serializer SHALL 输出格式化的 JSON 字符串，便于人工审查和版本控制差异比较

2.6. IF 反序列化输入不符合 DemoDataSchema 结构, THEN THE Deserializer SHALL 抛出包含具体字段路径的描述性错误信息
