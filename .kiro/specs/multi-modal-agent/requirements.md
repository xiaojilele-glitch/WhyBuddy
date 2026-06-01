# 需求文档：多模态 Agent（Multi-Modal Agent）

## 简介

在 multi-modal-vision 已实现的图片理解能力基础上，为 WhyBuddy 平台的 Agent 增加语音输入（STT）和语音输出（TTS）能力，并将 Vision + Voice 统一编排为完整的多模态 Agent 体验。Agent 能够"看图、说话、听话"：用户可通过语音下达指令，Agent 可通过语音朗读回复，3D 场景实时展示"正在听""正在说话"动画。同时支持纯前端模式（浏览器 Web Speech API）和服务端模式（服务端 TTS/STT 服务），并与现有附件工作流、Mission、动态组织无缝集成。

本 Spec 依赖 `.kiro/specs/multi-modal-vision/`，不重复 Vision 相关需求。

## 术语表

- **TTS_Engine**：文字转语音引擎，负责将 Agent 的文本回复转换为语音音频输出。浏览器模式使用 Web SpeechSynthesis API，服务端模式使用外部 TTS 服务
- **STT_Engine**：语音转文字引擎，负责将用户的语音输入转换为文本。浏览器模式使用 Web SpeechRecognition API，服务端模式使用外部 STT 服务
- **Voice_Provider**：语音服务提供者配置，通过 TTS_* 和 STT_* 环境变量独立配置，包含服务端 TTS/STT 的 API 端点和密钥
- **Voice_Session**：一次语音交互会话，从用户按下语音按钮开始录音到 Agent 语音回复播放完毕的完整生命周期
- **Multimodal_Context**：统一的多模态上下文对象，聚合 Visual_Context（来自 multi-modal-vision）和 Voice_Context（语音转录文本及元数据）供 Agent invoke 层使用
- **Voice_State**：Agent 在 3D 场景中的语音相关状态，包括 "listening"（正在听用户说话）、"speaking"（正在朗读回复）
- **Browser_Speech_API**：浏览器原生 Web Speech API 的统称，包括 SpeechSynthesis（TTS）和 SpeechRecognition（STT）

## 需求

### 需求 1：TTS 语音输出

**用户故事：** 作为用户，我希望 Agent 能够将回复内容朗读出来，以便我在不方便看屏幕时也能获取信息。

#### 验收标准

1. WHEN 用户在聊天面板中开启 TTS 开关, THE TTS_Engine SHALL 将 Agent 的文本回复转换为语音并通过浏览器音频播放
2. WHEN 系统运行在纯前端模式, THE TTS_Engine SHALL 使用浏览器 SpeechSynthesis API 进行语音合成
3. WHEN 系统运行在服务端模式且 TTS_* 环境变量已配置, THE TTS_Engine SHALL 通过服务端 TTS 服务生成语音音频并返回给前端播放
4. WHEN TTS_Engine 正在播放语音, THE TTS_Engine SHALL 提供暂停和停止控制按钮
5. IF TTS 语音合成失败, THEN THE TTS_Engine SHALL 静默降级为纯文本显示，并在控制台记录错误信息
6. WHEN 服务端 TTS 服务不可用, THE TTS_Engine SHALL 自动回退到浏览器 SpeechSynthesis API

### 需求 2：STT 语音输入

**用户故事：** 作为用户，我希望通过语音输入指令，以便更快速自然地与 Agent 交互。

#### 验收标准

1. WHEN 用户在聊天面板中点击麦克风按钮, THE STT_Engine SHALL 请求麦克风权限并开始录音
2. WHEN STT_Engine 正在录音, THE STT_Engine SHALL 实时将语音转录为文本并显示在输入框中
3. WHEN 用户停止录音（点击停止按钮或静默超时 3 秒）, THE STT_Engine SHALL 将最终转录文本填入输入框供用户确认或编辑
4. WHEN 系统运行在纯前端模式, THE STT_Engine SHALL 使用浏览器 SpeechRecognition API 进行语音识别
5. WHEN 系统运行在服务端模式且 STT_* 环境变量已配置, THE STT_Engine SHALL 将音频数据发送到服务端 STT 服务进行识别
6. IF 麦克风权限被拒绝, THEN THE STT_Engine SHALL 显示权限提示信息并禁用语音输入按钮
7. IF STT 语音识别失败, THEN THE STT_Engine SHALL 显示错误提示并保留输入框当前内容不变
8. WHEN 服务端 STT 服务不可用, THE STT_Engine SHALL 自动回退到浏览器 SpeechRecognition API

### 需求 3：语音 UI 集成

**用户故事：** 作为用户，我希望在聊天面板和工作流面板中有直观的语音控制入口，以便方便地切换语音交互模式。

#### 验收标准

1. THE ChatPanel SHALL 在输入框区域显示麦克风按钮（STT 入口）和扬声器开关（TTS 开关）
2. WHEN 麦克风按钮处于录音状态, THE ChatPanel SHALL 显示录音动画指示器（脉冲动画）
3. WHEN TTS 开关处于开启状态, THE ChatPanel SHALL 在每条 Agent 回复消息旁显示播放按钮，允许用户单独播放某条回复的语音
4. WHEN 工作流面板显示 Agent 回复内容, THE WorkflowPanel SHALL 提供与 ChatPanel 一致的 TTS 播放按钮
5. WHILE TTS 正在播放某条消息的语音, THE 对应的播放按钮 SHALL 变为停止按钮，并显示播放进度指示
6. WHEN 浏览器不支持 SpeechRecognition API 且服务端 STT 未配置, THE ChatPanel SHALL 隐藏麦克风按钮
7. WHEN 浏览器不支持 SpeechSynthesis API 且服务端 TTS 未配置, THE ChatPanel SHALL 隐藏扬声器开关和播放按钮

### 需求 4：3D 场景语音状态动画

**用户故事：** 作为用户，我希望在 3D 场景中看到 Agent 正在听语音或正在说话的状态，以便直观了解交互进度。

#### 验收标准

1. WHEN STT_Engine 开始录音, THE RuntimeEventEmitter SHALL 发出 agent_active 事件，action 值为 "listening"
2. WHEN 3D 场景接收到 action 为 "listening" 的 agent_active 事件, THE PetWorkers 组件 SHALL 显示"正在听..."状态气泡，并播放"倾听"动画（头部微倾 + 耳朵竖起效果）
3. WHEN TTS_Engine 开始播放语音, THE RuntimeEventEmitter SHALL 发出 agent_active 事件，action 值为 "speaking"
4. WHEN 3D 场景接收到 action 为 "speaking" 的 agent_active 事件, THE PetWorkers 组件 SHALL 显示"正在说话..."状态气泡，并播放"说话"动画（嘴部开合 + 轻微点头效果）
5. WHEN STT 录音结束或 TTS 播放完毕, THE RuntimeEventEmitter SHALL 发出 agent_active 事件，action 值恢复为 "thinking" 或 "idle"

### 需求 5：Agent Invoke 层多模态上下文注入

**用户故事：** 作为开发者，我希望 Agent 的 invoke 层能统一处理视觉和语音上下文，以便 Agent 在推理时同时利用图片分析和语音转录信息。

#### 验收标准

1. THE AgentInvokeOptions 接口 SHALL 扩展 multimodalContext 可选字段，类型为 Multimodal_Context，聚合 visionContexts（来自 multi-modal-vision）和 voiceTranscript（语音转录文本）
2. WHEN Agent 的 invoke 方法接收到包含 voiceTranscript 的 Multimodal_Context, THE composeAgentMessages 函数 SHALL 将语音转录文本作为 "[Voice Input] {transcript}" 格式的 user message 注入到 LLM 消息序列中，位于用户 prompt 之前
3. WHEN Multimodal_Context 同时包含 visionContexts 和 voiceTranscript, THE composeAgentMessages 函数 SHALL 按照 visionContexts → voiceTranscript → user prompt 的顺序组织消息序列
4. THE Multimodal_Context 对象 SHALL 序列化为 JSON 后能反序列化回等价对象（round-trip 一致性）

### 需求 6：动态组织多模态能力优先

**用户故事：** 作为系统管理员，我希望动态组织在组建团队时优先选择具备多模态能力的 Agent，以便充分利用语音和视觉能力。

#### 验收标准

1. WHEN 工作流指令包含多模态相关关键词（如"语音""朗读""图片""截图""看一下"）, THE Dynamic_Organization SHALL 在 Agent 选择时优先分配具备多模态能力标签的 Agent
2. THE AgentRecord 接口 SHALL 支持 capabilities 字段，包含 "vision"、"tts"、"stt" 等能力标签
3. WHEN 动态组织生成 Planner Prompt 时, THE buildPlannerPrompt 函数 SHALL 在 Agent 目录摘要中包含每个 Agent 的多模态能力标签信息

### 需求 7：Voice Provider 配置

**用户故事：** 作为系统管理员，我希望能独立配置 TTS 和 STT 服务提供者，以便灵活选择语音服务。

#### 验收标准

1. THE Voice_Provider SHALL 通过 TTS_API_URL、TTS_API_KEY、TTS_MODEL、TTS_VOICE 环境变量配置服务端 TTS 服务
2. THE Voice_Provider SHALL 通过 STT_API_URL、STT_API_KEY、STT_MODEL 环境变量配置服务端 STT 服务
3. WHEN TTS_* 环境变量未配置, THE Voice_Provider SHALL 标记服务端 TTS 为不可用，前端自动使用浏览器 SpeechSynthesis API
4. WHEN STT_* 环境变量未配置, THE Voice_Provider SHALL 标记服务端 STT 为不可用，前端自动使用浏览器 SpeechRecognition API
5. THE Voice_Provider SHALL 提供 getVoiceConfig() 函数，返回当前 TTS 和 STT 的可用性状态和配置信息

### 需求 8：服务端语音 API 路由

**用户故事：** 作为开发者，我希望有服务端 API 路由处理 TTS 和 STT 请求，以便前端在服务端模式下调用语音服务。

#### 验收标准

1. WHEN 前端发送 POST /api/voice/tts 请求（包含 text 和可选 voice 参数）, THE 服务端 SHALL 调用配置的 TTS 服务生成音频数据并返回 audio/mpeg 格式的响应
2. WHEN 前端发送 POST /api/voice/stt 请求（包含 audio/webm 格式的音频数据）, THE 服务端 SHALL 调用配置的 STT 服务进行语音识别并返回 { transcript: string } 格式的响应
3. IF TTS 或 STT 服务调用失败, THEN THE 服务端 SHALL 返回 503 状态码和描述性错误信息
4. WHEN 对应的 TTS_* 或 STT_* 环境变量未配置, THE 服务端 SHALL 对相应路由返回 501 状态码，表示服务端语音服务未启用
