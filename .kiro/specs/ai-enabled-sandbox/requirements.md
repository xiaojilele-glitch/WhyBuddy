# 需求文档

## 简介

WhyBuddy 的 Docker 容器执行器（Lobster Executor，L22 已完成）目前只能运行普通脚本任务，容器内无法调用 LLM API。本需求定义了为 Docker 容器注入 AI 能力所需的全部行为——包括 AI 基础镜像构建、凭证安全注入、容器内统一 AI 调用接口、多种 AI 任务类型支持、执行结果回调推送，以及凭证防泄露机制。

实现后，前端 3D 场景中的 Agent（宠物）接到 Mission 任务后，任务被分发到 Docker 容器执行，容器内代码可调用 LLM API 完成文本生成、代码生成、数据分析、图片理解等 AI 任务，处理结果通过回调推送回 Cube Brain，3D 模型实时更新状态。

## 术语表

- **AI_Image**：预装 AI SDK（openai、langchain 等）的 Docker 基础镜像，用于执行 AI 任务
- **Credential_Injector**：凭证注入模块，负责将 LLM API Key、Base URL 等敏感配置安全地传递到容器环境变量中
- **AI_Bridge**：容器内的统一 AI 调用桥接层，封装 LLM 多提供商抽象（兼容 shared/llm/contracts.ts）
- **AI_Task_Type**：AI 任务类型枚举，包括 text-generation、code-generation、data-analysis、image-understanding
- **Result_Reporter**：容器内的结果上报模块，将 AI 处理结果格式化后写入 /workspace/artifacts/ 并通过 stdout 输出结构化进度
- **Credential_Scrubber**：凭证清洗模块，从容器日志和 artifact 文件中过滤 API Key 等敏感信息
- **Executor**：Lobster Executor 服务（L22 已实现）
- **Cube_Brain**：WhyBuddy 服务端
- **Container**：Docker 容器实例

## 需求

### 需求 1：AI 基础镜像管理

**用户故事：** 作为开发者，我需要一个预装 AI SDK 的 Docker 基础镜像，以便容器启动后可以直接调用 LLM API 而无需在运行时安装依赖。

#### 验收标准

1.1 THE Executor SHALL 提供 Dockerfile 定义 AI_Image，基于 node:20-slim，预装 openai 和 langchain npm 包
1.2 THE AI_Image SHALL 包含 AI_Bridge 脚本（/opt/ai-bridge/），提供容器内统一的 AI 调用入口
1.3 THE Executor SHALL 支持 LOBSTER_AI_IMAGE 环境变量指定 AI 基础镜像名称（默认值 "cube-ai-sandbox:latest"）
1.4 WHEN Job 的 payload.aiEnabled 字段为 true 时，THE Executor SHALL 使用 AI_Image 替代默认镜像（除非 payload.image 显式指定了其他镜像）
1.5 THE AI_Image SHALL 在构建时固定 AI SDK 版本号，确保可复现构建

### 需求 2：LLM 凭证安全注入

**用户故事：** 作为系统，我需要将 LLM API 凭证安全地注入到容器环境变量中，以便容器内代码可以调用 AI API，同时凭证不会泄露到日志或 artifact 中。

#### 验收标准

2.1 WHEN Job 的 payload.aiEnabled 为 true 时，THE Credential_Injector SHALL 从宿主机环境变量读取 LLM_API_KEY、LLM_BASE_URL、LLM_MODEL 并注入到 Container 的环境变量中
2.2 THE Credential_Injector SHALL 支持 payload.llmConfig 字段覆盖默认的 LLM 配置（apiKey、baseUrl、model）
2.3 THE Credential_Injector SHALL 将凭证注入为容器环境变量 AI_API_KEY、AI_BASE_URL、AI_MODEL（使用 AI_ 前缀避免与宿主机变量冲突）
2.4 IF LLM_API_KEY 环境变量未设置且 payload.llmConfig 未提供 apiKey，THEN THE Executor SHALL 拒绝该 Job 并发出 job.failed 事件（errorCode: "AI_CREDENTIALS_MISSING"）
2.5 THE Credential_Injector SHALL 验证 API Key 格式非空且长度大于 8 个字符，拒绝明显无效的凭证

### 需求 3：容器内 AI 调用桥接层

**用户故事：** 作为容器内的任务脚本，我需要一个统一的 AI 调用接口，以便无需关心底层 LLM 提供商差异即可完成 AI 任务。

#### 验收标准

3.1 THE AI_Bridge SHALL 提供 Node.js 模块（/opt/ai-bridge/index.js），导出 generate、streamGenerate、embed 三个异步函数
3.2 THE AI_Bridge 的 generate 函数 SHALL 接受 messages 数组和 options 对象（temperature、maxTokens、jsonMode），返回 { content, usage, model } 结构
3.3 THE AI_Bridge SHALL 从容器环境变量 AI_API_KEY、AI_BASE_URL、AI_MODEL 读取配置，自动初始化 LLM 客户端
3.4 IF AI_API_KEY 环境变量未设置，THEN THE AI_Bridge SHALL 在首次调用时抛出描述性错误（"AI_API_KEY environment variable is not set"）
3.5 THE AI_Bridge 的接口定义 SHALL 与 shared/llm/contracts.ts 中的 LLMMessage、LLMGenerateOptions、LLMGenerateResult 类型兼容
3.6 THE AI_Bridge SHALL 将 generate 函数的结果序列化为 JSON 并写入 /workspace/artifacts/ai-result.json

### 需求 4：AI 任务类型支持

**用户故事：** 作为 Mission 编排系统，我需要支持多种 AI 任务类型，以便不同类型的 Mission 可以利用不同的 AI 能力。

#### 验收标准

4.1 THE Executor SHALL 识别 payload.aiTaskType 字段，支持以下值：text-generation、code-generation、data-analysis、image-understanding
4.2 WHEN aiTaskType 为 "text-generation" 时，THE AI_Bridge SHALL 使用标准文本生成参数（temperature 0.7、maxTokens 2048）
4.3 WHEN aiTaskType 为 "code-generation" 时，THE AI_Bridge SHALL 使用低温度参数（temperature 0.2、maxTokens 4096）
4.4 WHEN aiTaskType 为 "data-analysis" 时，THE AI_Bridge SHALL 启用 jsonMode 并使用 temperature 0.1
4.5 WHEN aiTaskType 为 "image-understanding" 时，THE AI_Bridge SHALL 支持 LLMImageContent 类型的消息（image_url 格式）
4.6 IF payload.aiTaskType 值不在支持列表中，THEN THE Executor SHALL 回退到 text-generation 默认配置并在日志中记录警告

### 需求 5：执行结果回调与前端更新

**用户故事：** 作为前端 3D 场景，我需要实时接收 AI 任务的执行进度和结果，以便 Agent 宠物的状态可以实时更新。

#### 验收标准

5.1 WHEN AI 任务开始执行时，THE Executor SHALL 在 job.started 事件的 payload 中包含 aiTaskType 和 aiModel 字段
5.2 WHILE AI 任务执行中，THE Executor SHALL 通过 job.progress 事件报告 AI 调用阶段（preparing、calling-llm、processing-result）
5.3 WHEN AI 任务成功完成时，THE Executor SHALL 在 job.completed 事件的 payload 中包含 aiResult 摘要（tokenUsage、model、contentPreview 前 200 字符）
5.4 THE Result_Reporter SHALL 将完整 AI 结果写入 /workspace/artifacts/ai-result.json，包含 content、usage、model、taskType 字段
5.5 WHEN AI API 调用失败时，THE Executor SHALL 发出 job.failed 事件，errorCode 为 "AI_API_ERROR"，detail 中包含 API 错误信息（已脱敏）

### 需求 6：凭证防泄露

**用户故事：** 作为安全工程师，我需要确保 LLM API Key 不会出现在容器日志、artifact 文件或回调事件中，以便防止凭证泄露。

#### 验收标准

6.1 THE Credential_Scrubber SHALL 在写入日志文件前扫描每一行，将匹配 API Key 模式的字符串替换为 "[REDACTED]"
6.2 THE Credential_Scrubber SHALL 在发送回调事件前扫描 message 和 detail 字段，替换匹配的凭证字符串
6.3 THE Credential_Scrubber SHALL 支持多种 API Key 模式：以 "sk-" 开头的 OpenAI 格式、以 "clp_" 开头的自定义格式、以及任何长度超过 20 的连续字母数字字符串且与已注入的 API Key 值匹配
6.4 THE Executor SHALL 在容器销毁后扫描 /workspace/artifacts/ 目录下所有文本文件，清洗其中的凭证字符串
6.5 IF Credential_Scrubber 检测到凭证泄露，THEN THE Executor SHALL 记录安全审计事件（类型 "credential_leak_prevented"）

### 需求 7：配置与向后兼容

**用户故事：** 作为开发者，我需要 AI 能力作为可选增强，不影响现有非 AI 任务的执行，以便系统平滑升级。

#### 验收标准

7.1 WHEN Job 的 payload.aiEnabled 字段为 false 或未设置时，THE Executor SHALL 使用原有执行逻辑（无 AI 镜像、无凭证注入）
7.2 THE Executor 的 HTTP API（/api/executor/jobs、/health）SHALL 保持向后兼容——现有请求格式继续有效
7.3 THE /health 端点 SHALL 新增 aiCapability 字段，报告 AI 能力状态（enabled/disabled、配置的 AI 镜像名、LLM 提供商类型）
7.4 WHILE LOBSTER_EXECUTION_MODE 为 "mock" 时，AI 任务 SHALL 使用模拟的 AI 响应（固定文本 + 模拟 token 用量）
