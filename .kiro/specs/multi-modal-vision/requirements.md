# 需求文档：多模态视觉能力（Multi-Modal Vision）

## 简介

为 WhyBuddy 平台的 Agent 增加视觉理解能力。Agent 能够接收图片（jpg/png/webp）和截图作为附件输入，通过 Vision LLM 进行视觉分析，并将分析结果注入工作流上下文，使 Agent 在回复中能够准确引用图片内容。同时在 3D 场景中展示"正在看图"状态动画，支持多图同时上传与分析，并在主模型不支持 Vision 时自动 fallback 到专用 Vision 模型。

## 术语表

- **Vision_LLM**：支持多模态输入（文本 + 图片）的大语言模型，如 GPT-4o、Claude-3.5-Sonnet、GLM-4V、Qwen-VL 等，通过 OpenAI 兼容接口调用
- **Visual_Context**：由 Vision_LLM 生成的图片描述与视觉分析结果，作为结构化文本注入工作流上下文
- **Multimodal_Message**：包含文本和图片内容的 LLM 消息格式，遵循 OpenAI 多模态消息规范（content 为数组，包含 text 和 image_url 类型条目）
- **Attachment_Pipeline**：附件处理管道，负责将用户上传的文件解析为工作流可用的结构化内容
- **Vision_Provider**：专用于视觉分析的 LLM 提供者配置，通过 VISION_LLM_* 环境变量独立配置
- **Base64_Data_URL**：将图片二进制数据编码为 base64 字符串并嵌入 data URI 的格式，用于向 Vision_LLM 传递图片内容
- **Token_Budget**：单次 Vision_LLM 调用允许消耗的最大 Token 数量上限

## 需求

### 需求 1：图片附件识别与 Base64 编码

**用户故事：** 作为用户，我希望上传图片附件后系统能自动识别并编码为 Vision LLM 可用的格式，以便后续进行视觉分析。

#### 验收标准

1. WHEN 用户上传 jpg、png 或 webp 格式的图片附件, THE Attachment_Pipeline SHALL 识别该文件为视觉分析候选，并在 WorkflowInputAttachment 中标记 visionReady 为 true
2. WHEN 图片文件被标记为 visionReady, THE Attachment_Pipeline SHALL 将图片内容编码为 Base64_Data_URL 格式并存储在 WorkflowInputAttachment 的 base64DataUrl 字段中
3. WHEN 图片文件大小超过 Token_Budget 对应的尺寸阈值（默认 4MB）, THE Attachment_Pipeline SHALL 在编码前对图片进行压缩或降采样，使其符合 Token_Budget 限制
4. IF 图片编码过程中发生错误, THEN THE Attachment_Pipeline SHALL 回退到现有 OCR 文字提取流程，并在 excerptStatus 中记录 "vision_fallback"

### 需求 2：Vision LLM 提供者配置

**用户故事：** 作为系统管理员，我希望能独立配置 Vision LLM 提供者，以便灵活选择支持视觉能力的模型。

#### 验收标准

1. THE Vision_Provider SHALL 通过 VISION_LLM_API_KEY、VISION_LLM_BASE_URL、VISION_LLM_MODEL 和 VISION_LLM_WIRE_API 环境变量进行独立配置
2. WHEN VISION_LLM_* 环境变量未配置, THE Vision_Provider SHALL 回退到使用 FALLBACK_LLM_* 配置；WHEN FALLBACK_LLM_* 也未配置, THE Vision_Provider SHALL 回退到主 LLM 配置
3. THE Vision_Provider SHALL 复用现有 llm-client.ts 中的重试、熔断和并发控制机制
4. WHEN Vision_Provider 调用失败且所有 fallback 均不可用, THE Vision_Provider SHALL 返回描述性错误信息，并将图片附件降级为 OCR 文字提取结果

### 需求 3：多模态消息格式支持

**用户故事：** 作为开发者，我希望 LLM 消息格式支持文本与图片混合内容，以便 Vision LLM 能同时接收文本指令和图片输入。

#### 验收标准

1. THE LLMMessage 接口 SHALL 扩展 content 字段，支持 string 类型（纯文本）和数组类型（包含 { type: "text", text: string } 和 { type: "image_url", image_url: { url: string, detail?: string } } 条目）
2. WHEN LLMMessage 的 content 为数组格式, THE llm-client SHALL 在构建 chat_completions 请求体时直接传递该数组作为 message.content
3. WHEN LLMMessage 的 content 为数组格式且 wireApi 为 "responses", THE llm-client SHALL 将数组中的 image_url 条目转换为 responses API 对应的 input_image 格式
4. THE Multimodal_Message 格式 SHALL 序列化为 JSON 后能反序列化回等价对象（round-trip 一致性）

### 需求 4：视觉分析与上下文注入

**用户故事：** 作为用户，我希望 Agent 能理解我上传的图片内容，并在回复中准确引用图片中的视觉信息。

#### 验收标准

1. WHEN 工作流包含 visionReady 的图片附件, THE Attachment_Pipeline SHALL 调用 Vision_LLM 对每张图片生成结构化的 Visual_Context（包含图片描述、关键元素列表、文字内容）
2. WHEN Visual_Context 生成完成, THE Attachment_Pipeline SHALL 将 Visual_Context 存储在 WorkflowInputAttachment 的 visualDescription 字段中，并更新 content 字段为 Visual_Context 的文本摘要
3. WHEN 构建工作流指令上下文时, THE buildWorkflowDirectiveContext 函数 SHALL 在附件区段中包含 Visual_Context 内容，格式为 "[Vision Analysis] {图片名称}\n{visualDescription}"
4. WHEN 多张图片同时上传, THE Attachment_Pipeline SHALL 并行调用 Vision_LLM 分析所有图片，总处理时间 SHALL 受单张图片超时时间（默认 30 秒）约束而非累加
5. IF Vision_LLM 分析某张图片失败, THEN THE Attachment_Pipeline SHALL 对该图片回退到 OCR 文字提取，其他图片的视觉分析 SHALL 继续正常进行

### 需求 5：Agent 视觉上下文引用

**用户故事：** 作为用户，我希望在 prompt 中引用具体图片内容时，Agent 能基于视觉分析结果进行准确回复。

#### 验收标准

1. WHEN Agent 的 invoke 方法接收到包含 Visual_Context 的上下文, THE RuntimeAgent SHALL 将 Visual_Context 作为独立的 user message 注入到 LLM 消息序列中
2. WHEN 用户 prompt 中包含对图片的引用（如"根据这张截图"、"分析这张图片"）, THE composeAgentMessages 函数 SHALL 确保对应的 Visual_Context 在消息序列中位于用户 prompt 之前
3. WHILE Agent 处理包含视觉上下文的请求, THE RuntimeAgent SHALL 在 LLM 调用选项中增加 maxTokens 上限（默认增加 1000 tokens）以容纳视觉分析内容

### 需求 6：3D 场景"看图"状态展示

**用户故事：** 作为用户，我希望在 3D 场景中看到 Agent 正在分析图片的状态，以便了解工作进度。

#### 验收标准

1. WHEN Agent 开始分析图片, THE RuntimeEventEmitter SHALL 发出 agent_active 事件，action 值为 "analyzing_image"
2. WHEN 3D 场景接收到 action 为 "analyzing_image" 的 agent_active 事件, THE PetWorkers 组件 SHALL 显示"正在看图..."状态气泡
3. WHEN Agent 完成图片分析, THE RuntimeEventEmitter SHALL 发出 agent_active 事件，action 值恢复为 "thinking" 或 "idle"
4. WHILE Agent 处于 "analyzing_image" 状态, THE AgentWorker 组件 SHALL 播放专属的"看图"动画（区别于现有的 typing/reading/discussing 动画）

### 需求 7：Token 消耗控制

**用户故事：** 作为系统管理员，我希望视觉分析的 Token 消耗可控，以避免意外的高额费用。

#### 验收标准

1. THE Vision_Provider SHALL 支持通过 VISION_LLM_MAX_TOKENS 环境变量配置单次视觉分析的最大输出 Token 数（默认 1000）
2. WHEN 多张图片同时分析时, THE Attachment_Pipeline SHALL 将 image_url 的 detail 参数设置为 "low" 以减少 Token 消耗，除非 VISION_LLM_DETAIL 环境变量显式设置为 "high" 或 "auto"
3. WHEN Vision_LLM 返回的 usage 信息可用, THE Attachment_Pipeline SHALL 在日志中记录每次视觉分析的 Token 消耗量（prompt_tokens 和 completion_tokens）

### 需求 8：主模型 Vision 能力检测与自动 Fallback

**用户故事：** 作为用户，我希望即使主模型不支持 Vision，系统也能自动使用支持 Vision 的模型完成图片分析。

#### 验收标准

1. THE Vision_Provider SHALL 维护一个 Vision 能力检测机制：首次调用时尝试使用当前配置的 Vision_Provider 发送包含图片的测试请求，根据响应判断是否支持多模态输入
2. WHEN Vision 能力检测判定当前 Vision_Provider 不支持多模态输入, THE Vision_Provider SHALL 自动回退到 fallback 链中下一个提供者
3. IF 所有配置的提供者均不支持 Vision, THEN THE Vision_Provider SHALL 将图片降级为 OCR 文字提取，并在日志中记录警告信息
