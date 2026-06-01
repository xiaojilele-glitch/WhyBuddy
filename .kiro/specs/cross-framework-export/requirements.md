# 跨框架导出 需求文档

## 简介

跨框架导出功能允许用户将 WhyBuddy 中当前的动态组织结构、十阶段工作流管道配置和 Mission 配置，一键导出为 CrewAI、LangGraph、AutoGen 等主流多智能体框架的兼容格式（Python 代码 + YAML/JSON 配置）。导出产物以 ZIP 包形式下载，用户解压后可直接运行，无需手动重写 Agent 定义和流程编排。

## 术语表

- **Export_Engine**: 服务端导出引擎模块，负责读取 Cube 内部数据模型并转换为目标框架格式
- **Intermediate_Representation (IR)**: 统一中间表示，将 Cube 的组织结构、工作流和 Mission 数据抽象为框架无关的标准化数据结构
- **Target_Adapter**: 目标框架适配器，将 IR 转换为特定框架（CrewAI / LangGraph / AutoGen）的代码和配置文件
- **Export_Bundle**: 导出产物 ZIP 包，包含目标框架的完整可运行代码、配置文件和 README 使用说明
- **WorkflowOrganizationSnapshot**: Cube 现有的动态组织结构快照类型，包含部门、节点、角色、Skills、MCP 配置
- **WorkflowRecord**: Cube 现有的工作流记录类型，包含指令、状态、阶段、任务等信息
- **Ten_Stage_Pipeline**: Cube 的十阶段工作流管道（direction → planning → execution → review → meta_audit → revision → verify → summary → feedback → evolution）
- **CrewAI_Format**: CrewAI 框架的标准项目结构，包含 agents.yaml、tasks.yaml 和 crew.py 入口文件
- **LangGraph_Format**: LangGraph 框架的标准格式，包含 JSON 状态图定义和 Python 入口脚本
- **AutoGen_Format**: AutoGen 框架的标准格式，包含 JSON 配置文件（兼容 AutoGen Studio）

## 需求

### 需求 1：构建统一中间表示

**用户故事：** 作为开发者，我希望系统将 Cube 的内部数据模型转换为框架无关的中间表示，以便后续适配器可以基于统一数据源生成不同框架的输出。

#### 验收标准

1. WHEN Export_Engine 接收一个 WorkflowOrganizationSnapshot, THE Export_Engine SHALL 将每个 WorkflowOrganizationNode 转换为 IR 中的 AgentDefinition（包含 id、name、role、responsibility、goals、skills 列表和 model 配置）
2. WHEN Export_Engine 接收一个 WorkflowOrganizationSnapshot, THE Export_Engine SHALL 将 departments 数组转换为 IR 中的 TeamDefinition 列表（包含 id、label、managerAgentId、memberAgentIds、strategy）
3. WHEN Export_Engine 接收一个 WorkflowRecord 及其关联的 TaskRecord 列表, THE Export_Engine SHALL 将 Ten_Stage_Pipeline 映射为 IR 中的 PipelineDefinition（包含有序的 StageDefinition 列表，每个 stage 包含 name、label、参与角色和执行策略）
4. WHEN Export_Engine 处理 WorkflowOrganizationNode 的 skills 字段, THE Export_Engine SHALL 将每个 WorkflowSkillBinding 转换为 IR 中的 SkillDefinition（包含 id、name、summary、prompt 文本）
5. WHEN Export_Engine 处理 WorkflowOrganizationNode 的 mcp 字段, THE Export_Engine SHALL 将每个 WorkflowMcpBinding 转换为 IR 中的 ToolDefinition（包含 id、name、server、tools 列表和 connection 信息）
6. IF WorkflowOrganizationSnapshot 中某个节点缺少 skills 或 mcp 字段, THEN THE Export_Engine SHALL 为该节点生成空的 skills 和 tools 数组，不中断转换流程

### 需求 2：CrewAI 格式导出

**用户故事：** 作为用户，我希望将 Cube 的组织和工作流导出为 CrewAI 项目，以便在 CrewAI 框架中直接运行相同的多智能体协作流程。

#### 验收标准

1. WHEN Target_Adapter 接收 IR 并指定目标为 CrewAI, THE Target_Adapter SHALL 生成 agents.yaml 文件，其中每个 AgentDefinition 映射为一个 CrewAI agent 条目（包含 role、goal、backstory、tools 列表）
2. WHEN Target_Adapter 接收 IR 并指定目标为 CrewAI, THE Target_Adapter SHALL 生成 tasks.yaml 文件，其中 PipelineDefinition 的每个 StageDefinition 映射为一个 CrewAI task 条目（包含 description、expected_output、agent 引用）
3. WHEN Target_Adapter 接收 IR 并指定目标为 CrewAI, THE Target_Adapter SHALL 生成 crew.py 入口文件，包含 Crew 类定义、agent 实例化和 task 编排逻辑
4. THE Target_Adapter SHALL 在 CrewAI 导出产物中包含 requirements.txt 文件，列出 crewai 及其依赖版本
5. WHEN CrewAI 导出产物中的 agent 引用了 skills, THE Target_Adapter SHALL 将 SkillDefinition 的 prompt 文本作为 agent 的 backstory 补充内容嵌入

### 需求 3：LangGraph 格式导出

**用户故事：** 作为用户，我希望将 Cube 的组织和工作流导出为 LangGraph 项目，以便利用 LangGraph 的状态图引擎运行相同的多阶段协作流程。

#### 验收标准

1. WHEN Target_Adapter 接收 IR 并指定目标为 LangGraph, THE Target_Adapter SHALL 生成 graph.json 文件，其中 PipelineDefinition 映射为 StateGraph 节点和边的定义（每个 StageDefinition 对应一个节点，阶段顺序对应边的连接）
2. WHEN Target_Adapter 接收 IR 并指定目标为 LangGraph, THE Target_Adapter SHALL 生成 main.py 入口文件，包含 StateGraph 构建逻辑、节点函数定义和图编译运行代码
3. WHEN Target_Adapter 接收 IR 并指定目标为 LangGraph, THE Target_Adapter SHALL 在 main.py 中为每个 AgentDefinition 生成对应的节点处理函数，函数内包含 agent 的 role 和 responsibility 作为 system prompt
4. THE Target_Adapter SHALL 在 LangGraph 导出产物中包含 requirements.txt 文件，列出 langgraph 和 langchain 及其依赖版本

### 需求 4：AutoGen 格式导出

**用户故事：** 作为用户，我希望将 Cube 的组织和工作流导出为 AutoGen 配置，以便在 AutoGen 或 AutoGen Studio 中运行相同的多智能体协作。

#### 验收标准

1. WHEN Target_Adapter 接收 IR 并指定目标为 AutoGen, THE Target_Adapter SHALL 生成 agents.json 配置文件，其中每个 AgentDefinition 映射为一个 AutoGen agent 配置（包含 name、system_message、llm_config）
2. WHEN Target_Adapter 接收 IR 并指定目标为 AutoGen, THE Target_Adapter SHALL 生成 group_chat.json 配置文件，将 TeamDefinition 映射为 GroupChat 配置（包含 agents 列表、max_round、speaker_selection_method）
3. WHEN Target_Adapter 接收 IR 并指定目标为 AutoGen, THE Target_Adapter SHALL 生成 main.py 入口文件，包含 agent 实例化、GroupChat 创建和对话启动逻辑
4. THE Target_Adapter SHALL 在 AutoGen 导出产物中包含 requirements.txt 文件，列出 pyautogen 及其依赖版本

### 需求 5：ZIP 打包与下载

**用户故事：** 作为用户，我希望点击导出按钮后获得一个 ZIP 文件下载，包含所选框架的完整可运行项目，以便解压后直接使用。

#### 验收标准

1. WHEN Export_Engine 完成目标框架的代码生成, THE Export_Engine SHALL 将所有生成文件打包为一个 ZIP 文件
2. THE Export_Bundle SHALL 在 ZIP 根目录包含一个 README.md 文件，说明项目结构、环境准备步骤、运行命令和注意事项
3. WHEN 用户选择导出所有框架（All）, THE Export_Engine SHALL 在 ZIP 中为每个框架创建独立的子目录（crewai/、langgraph/、autogen/），每个子目录包含该框架的完整导出产物
4. WHEN 用户选择导出单个框架, THE Export_Engine SHALL 在 ZIP 根目录直接放置该框架的导出文件（不创建额外子目录）
5. THE Export_Bundle 的 ZIP 文件名 SHALL 遵循格式 `cube-export-{framework}-{timestamp}.zip`，其中 framework 为目标框架名称或 "all"，timestamp 为 ISO 日期格式

### 需求 6：导出 API 端点

**用户故事：** 作为前端开发者，我希望通过 REST API 触发导出并获取 ZIP 文件流，以便在前端实现一键导出下载功能。

#### 验收标准

1. WHEN 前端发送 `POST /api/export` 请求（body 包含 workflowId 和 framework 参数）, THE Export_Engine SHALL 读取指定工作流的组织结构和任务数据，执行转换并返回 ZIP 文件流（Content-Type: application/zip）
2. WHEN framework 参数值为 "crewai"、"langgraph"、"autogen" 或 "all", THE Export_Engine SHALL 仅生成指定框架的导出产物
3. IF framework 参数值不在支持的列表中, THEN THE Export_Engine SHALL 返回 HTTP 400 错误，body 包含支持的框架列表
4. IF 指定的 workflowId 不存在或该工作流没有关联的组织结构, THEN THE Export_Engine SHALL 返回 HTTP 404 错误，body 包含描述性错误信息
5. WHEN 导出过程中发生内部错误, THE Export_Engine SHALL 返回 HTTP 500 错误，body 包含错误摘要（不暴露内部堆栈信息）

### 需求 7：前端导出界面

**用户故事：** 作为用户，我希望在工作流面板中看到一个"Export"按钮，点击后选择目标框架并下载导出文件，以便快速完成导出操作。

#### 验收标准

1. WHEN 工作流处于 completed 或 completed_with_errors 状态, THE 前端 SHALL 在工作流面板中显示 "Export to Other Frameworks" 按钮
2. WHEN 用户点击导出按钮, THE 前端 SHALL 显示框架选择对话框，提供 CrewAI、LangGraph、AutoGen 和 All 四个选项
3. WHEN 用户选择框架并确认, THE 前端 SHALL 调用 `POST /api/export` 接口并触发浏览器文件下载
4. WHILE 导出请求正在处理, THE 前端 SHALL 显示加载状态指示器，禁用导出按钮防止重复提交
5. IF 导出请求返回错误, THEN THE 前端 SHALL 显示错误提示信息，恢复按钮为可用状态

### 需求 8：IR 序列化与反序列化

**用户故事：** 作为开发者，我希望 IR 数据结构支持 JSON 序列化和反序列化，以便调试、测试和未来扩展新的目标框架适配器。

#### 验收标准

1. THE Export_Engine SHALL 支持将 IR（包含 AgentDefinition、TeamDefinition、PipelineDefinition、SkillDefinition、ToolDefinition）序列化为 JSON 字符串
2. THE Export_Engine SHALL 支持从 JSON 字符串反序列化还原为完整的 IR 数据结构
3. FOR ALL 有效的 IR 数据结构，序列化后再反序列化 SHALL 产生与原始数据结构等价的对象（往返一致性）
