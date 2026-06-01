# Implementation Plan: Cross-Framework Export

## Overview

将 WhyBuddy 的动态组织结构和十阶段工作流导出为 CrewAI / LangGraph / AutoGen 兼容格式。实现顺序：IR 类型定义 → IR 构建器 → 三个框架适配器 → ZIP 打包 → API 路由 → 前端 UI。

## Tasks

- [x] 1. 定义 IR 类型和构建函数
  - [x] 1.1 在 `shared/export-schema.ts` 中定义 ExportIR、AgentDefinition、TeamDefinition、PipelineDefinition、SkillDefinition、ToolDefinition 接口和 ExportFile 接口
    - 定义所有 IR 类型接口
    - 定义 `ExportFramework` 类型（"crewai" | "langgraph" | "autogen" | "all"）
    - 定义 `SUPPORTED_FRAMEWORKS` 常量数组
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 1.2 在 `shared/export-schema.ts` 中实现 `buildExportIR(organization, workflow, tasks)` 函数
    - 将 WorkflowOrganizationNode 映射为 AgentDefinition
    - 将 WorkflowOrganizationDepartment 映射为 TeamDefinition（通过 nodes 查找 memberAgentIds）
    - 将 WORKFLOW_STAGES 映射为 PipelineDefinition（固定 10 阶段，附带参与角色和执行策略）
    - 收集所有节点的 skills 和 mcp 绑定，去重后映射为 SkillDefinition 和 ToolDefinition
    - 缺少 skills 或 mcp 的节点生成空数组
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 1.3 在 `shared/export-schema.ts` 中实现 `serializeIR(ir)` 和 `deserializeIR(json)` 函数
    - serializeIR 将 ExportIR 转为 JSON 字符串
    - deserializeIR 从 JSON 字符串还原 ExportIR，含基本类型校验
    - _Requirements: 8.1, 8.2, 8.3_
  - [x]* 1.4 编写 IR 构建的属性测试
    - 在 `server/tests/cross-framework-export.test.ts` 中使用 fast-check
    - 实现 `arbitraryWorkflowOrganizationSnapshot` 生成器
    - **Property 1: IR 构建保持组织结构完整性**
    - **Validates: Requirements 1.1, 1.2**
  - [x]* 1.5 编写 IR 管道和绑定的属性测试
    - **Property 2: IR 构建保持管道阶段完整性**
    - **Validates: Requirements 1.3**
    - **Property 3: IR 构建保持节点绑定完整性**
    - **Validates: Requirements 1.4, 1.5**
  - [x]* 1.6 编写 IR 序列化往返属性测试
    - 实现 `arbitraryExportIR` 生成器
    - **Property 10: IR 序列化往返一致性**
    - **Validates: Requirements 8.3**

- [x] 2. Checkpoint - 确保 IR 层测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 3. 实现 CrewAI 适配器
  - [x] 3.1 在 `server/core/export-adapters/crewai.ts` 中实现 `toCrewAI(ir): ExportFile[]`
    - 生成 agents.yaml：每个 AgentDefinition 映射为 agent 条目（role/goal/backstory），skills prompt 嵌入 backstory
    - 生成 tasks.yaml：每个 StageDefinition 映射为 task 条目（description/expected_output/agent）
    - 生成 crew.py：Crew 类定义、agent 实例化、task 编排
    - 生成 requirements.txt：列出 crewai 依赖
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 3.2 编写 CrewAI 适配器属性测试
    - **Property 4: CrewAI 适配器输出完整性**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 4. 实现 LangGraph 适配器
  - [x] 4.1 在 `server/core/export-adapters/langgraph.ts` 中实现 `toLangGraph(ir): ExportFile[]`
    - 生成 graph.json：pipeline stages 映射为 StateGraph 节点和边
    - 生成 main.py：StateGraph 构建、每个 agent 对应节点处理函数、图编译运行
    - 生成 requirements.txt：列出 langgraph/langchain 依赖
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x]* 4.2 编写 LangGraph 适配器属性测试
    - **Property 5: LangGraph 适配器输出完整性**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 5. 实现 AutoGen 适配器
  - [x] 5.1 在 `server/core/export-adapters/autogen.ts` 中实现 `toAutoGen(ir): ExportFile[]`
    - 生成 agents.json：每个 AgentDefinition 映射为 AutoGen agent 配置
    - 生成 group_chat.json：每个 TeamDefinition 映射为 GroupChat 配置
    - 生成 main.py：agent 实例化、GroupChat 创建、对话启动
    - 生成 requirements.txt：列出 pyautogen 依赖
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x]* 5.2 编写 AutoGen 适配器属性测试
    - **Property 6: AutoGen 适配器输出完整性**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 6. Checkpoint - 确保所有适配器测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 7. 实现 Export Engine 和 ZIP 打包
  - [x] 7.1 在 `server/core/exporter.ts` 中实现 `exportWorkflow(workflowId, framework): Promise<{ buffer: Buffer, filename: string }>`
    - 从数据库读取 WorkflowRecord、TaskRecord 和组织结构
    - 调用 buildExportIR 构建 IR
    - 根据 framework 参数调用对应适配器（或全部适配器）
    - 生成 README.md 使用说明
    - 使用 archiver 或 JSZip 打包为 ZIP buffer
    - 单框架：文件放根目录；all：每个框架一个子目录
    - 生成文件名 `cube-export-{framework}-{timestamp}.zip`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.2_
  - [x]* 7.2 编写 ZIP 打包属性测试
    - **Property 7: ZIP 打包目录结构正确性**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - **Property 8: ZIP 文件名格式正确性**
    - **Validates: Requirements 5.5**
  - [x]* 7.3 编写框架参数验证属性测试
    - **Property 9: 框架参数验证**
    - **Validates: Requirements 6.3**

- [x] 8. 实现 Export API 路由
  - [x] 8.1 在 `server/routes/export.ts` 中实现 `POST /api/export` 端点
    - 解析 body 中的 workflowId 和 framework 参数
    - 校验 framework 参数有效性（400 错误）
    - 校验 workflowId 存在性和组织结构关联（404 错误）
    - 调用 exportWorkflow 获取 ZIP buffer
    - 设置 Content-Type: application/zip 和 Content-Disposition header
    - 内部错误返回 500（不暴露堆栈）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 8.2 在 `server/index.ts` 中注册 export 路由到 `/api/export`
    - 导入 export 路由并挂载
    - _Requirements: 6.1_
  - [x]* 8.3 编写 API 路由单元测试
    - 测试 400/404/500 错误响应
    - 测试成功导出返回 ZIP 流
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

- [x] 9. 实现前端导出界面
  - [x] 9.1 创建 `client/src/components/ExportDialog.tsx` 导出对话框组件
    - 框架选择 UI（CrewAI / LangGraph / AutoGen / All 四个选项）
    - 确认按钮触发 POST /api/export 请求
    - 加载状态指示器（禁用按钮防止重复提交）
    - 错误提示显示
    - 使用 fetch API 下载 ZIP 并触发浏览器保存
    - _Requirements: 7.2, 7.3, 7.4, 7.5_
  - [x] 9.2 在工作流面板中集成 Export 按钮
    - 在 WorkflowPanel 或相关组件中添加 "Export to Other Frameworks" 按钮
    - 仅在工作流状态为 completed 或 completed_with_errors 时显示
    - 点击打开 ExportDialog
    - _Requirements: 7.1_

- [x] 10. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- 属性测试使用 fast-check 库，每个属性对应设计文档中的一个正确性属性
- 项目已有 vitest 配置，测试文件放在 `server/tests/` 目录下
