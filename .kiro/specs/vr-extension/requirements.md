# 需求文档：AR/VR 扩展模块

## 简介

AR/VR 扩展模块为 WhyBuddy 3D 协作办公室提供沉浸式虚拟现实支持。用户通过 VR 头显进入 Agent 工作空间，以手势和空间交互操作任务看板、数据流和协作界面。该模块采用分层架构设计，预留通用接口支持多种 VR 平台（Meta Quest、HTC Vive、Apple Vision Pro 等）。当前阶段实现核心数据模型和渲染管道，VR 硬件集成作为远期演进方向。

## 术语表

- **VRSceneGenerator**：VR 场景生成器，接收组织快照和任务状态，输出 VR 场景配置
- **VRSceneConfig**：VR 场景配置对象，包含场景元数据、空间分区、对象列表
- **WorkflowOrganizationSnapshot**：工作流组织快照，描述动态组织结构（已有类型）
- **TaskState**：任务状态集合，包含当前所有 TaskRecord 的聚合视图
- **GestureEvent**：手势事件，描述用户的手势输入数据
- **SpatialInteractionTarget**：空间交互目标，标识可交互的 3D 对象
- **GestureInterpreter**：手势解释器，将原始手势数据映射到高级交互命令
- **InteractionDispatcher**：交互分发器，将交互命令路由到业务逻辑处理器
- **TaskBoardRenderer**：任务看板渲染器，将任务状态转换为 3D 看板对象
- **VRBoardObject**：VR 看板对象，包含面板几何、纹理、UI 布局、交互热区
- **DataFlowRenderer**：数据流渲染器，将工作流执行轨迹转换为 3D 数据流图
- **VRDataFlowGraph**：VR 数据流图对象，包含节点、边、动画参数
- **AgentAvatarGenerator**：Agent 虚拟形象生成器，为每个 Agent 生成 3D 头像模型
- **VRSessionManager**：VR 会话管理器，管理多个并发 VR 用户会话
- **VRPlatformAdapter**：VR 平台适配器接口，抽象不同 VR 平台的差异
- **WebXRAdapter**：基于 WebXR API 的平台适配器实现
- **MockVRAdapter**：用于开发和测试的模拟平台适配器
- **SceneOptimizer**：场景优化器，动态调整渲染质量以维持目标帧率
- **LOD**：Level of Detail，多层次细节模型
- **VRSessionRecorder**：VR 会话录制器，记录场景事件为事件流
- **CRDT**：Conflict-free Replicated Data Type，无冲突复制数据类型
- **glTF/glb**：GL Transmission Format，通用 3D 模型传输格式

## 需求

### 需求 1：VR 场景初始化与空间映射

**用户故事：** 作为 VR 用户，我希望系统能将组织结构和任务状态自动映射为 VR 空间场景，以便我进入沉浸式工作环境。

#### 验收标准

1. WHEN VRSceneGenerator 接收 WorkflowOrganizationSnapshot 和 TaskState, THE VRSceneGenerator SHALL 输出包含场景元数据、空间分区和对象列表的 VRSceneConfig
2. WHEN 组织快照包含多个部门, THE VRSceneGenerator SHALL 为每个 Agent 部门映射独立的工作区块（zone），每个区块包含位置、尺寸、颜色主题和标识信息
3. THE VRSceneGenerator SHALL 将任务看板、数据流、通信面板等 UI 元素以 3D 对象形式定义，每个对象包含世界坐标、旋转、缩放和交互热区
4. THE VRSceneConfig SHALL 支持序列化为 JSON schema 格式，便于多引擎适配
5. WHEN 场景初始化执行时, THE VRSceneGenerator SHALL 记录调试日志，包含组织结构解析、空间分配算法和对象生成的详细信息

### 需求 2：手势识别与空间交互接口

**用户故事：** 作为 VR 用户，我希望通过手势与虚拟空间中的对象交互，以便自然地操作任务看板和数据流。

#### 验收标准

1. THE GestureEvent schema SHALL 包含手势类型（point、grab、pinch、swipe、rotate）、手部位置、方向、强度和时间戳字段
2. THE SpatialInteractionTarget schema SHALL 标识可交互的 3D 对象（看板、数据节点、Agent 头像），包含碰撞体定义、交互类型和回调接口
3. WHEN 接收到原始手势数据, THE GestureInterpreter SHALL 将手势数据映射到高级交互命令（select、drag、scale、rotate、delete）
4. WHEN 交互命令生成后, THE InteractionDispatcher SHALL 将命令路由到对应的业务逻辑处理器（任务更新、看板刷新、数据流重排）
5. THE GestureInterpreter SHALL 支持自定义手势映射配置，允许不同 VR 平台定义各自的手势识别规则
6. WHEN 用户执行手势交互, THE InteractionDispatcher SHALL 在 50ms 内完成命令分发，确保交互体验流畅

### 需求 3：任务看板的 3D 可视化与实时同步

**用户故事：** 作为 VR 用户，我希望在虚拟空间中查看和操作 3D 任务看板，以便沉浸式地管理任务。

#### 验收标准

1. WHEN 接收到 TaskState, THE TaskBoardRenderer SHALL 将 TaskState 转换为 VRBoardObject，包含面板几何、纹理、UI 布局和交互热区
2. THE TaskBoardRenderer SHALL 支持多种视图模式（列表、看板、甘特图），用户可通过手势切换视图
3. THE TaskBoardRenderer SHALL 为每张任务卡片渲染标题、描述、优先级标签、分配 Agent、进度条和时间戳，采用 3D 文本渲染
4. WHEN 后端发送任务更新事件, THE TaskBoardRenderer SHALL 通过 WebSocket 订阅并实时刷新对应卡片的状态和位置
5. WHEN 用户在 VR 中拖拽任务卡片改变状态或分配, THE TaskBoardRenderer SHALL 通过 updateTaskAssignment() API 同步变更到后端
6. WHEN 多个用户并发编辑同一看板, THE TaskBoardRenderer SHALL 通过 CRDT 算法解决冲突，并显示其他用户的光标和操作

### 需求 4：数据流的 3D 可视化与交互

**用户故事：** 作为 VR 用户，我希望以 3D 图形方式查看 Agent 之间的数据流动，以便直观理解工作流执行过程。

#### 验收标准

1. WHEN 接收到 WorkflowExecutionTrace, THE DataFlowRenderer SHALL 将执行轨迹转换为 VRDataFlowGraph，包含节点、边和动画参数
2. THE DataFlowRenderer SHALL 将数据流节点表示为 Agent 或任务，边表示通信或依赖关系，支持有向、无向和加权边
3. THE DataFlowRenderer SHALL 以动画形式展示数据包在边上的流动，显示数据类型、大小和时间戳，用户可点击查看详细内容
4. THE DataFlowRenderer SHALL 支持多种布局算法（力导向、分层、圆形），用户可通过手势切换或调整参数
5. WHEN 用户对数据流执行钻取手势, THE DataFlowRenderer SHALL 放大显示子流程或具体数据包内容
6. WHEN 后端产生新的通信事件, THE DataFlowRenderer SHALL 通过 WebSocket 实时更新，在 3D 场景中立即显示新事件

### 需求 5：Agent 虚拟形象与状态指示

**用户故事：** 作为 VR 用户，我希望看到每个 Agent 的 3D 虚拟形象和实时状态，以便快速了解团队工作情况。

#### 验收标准

1. WHEN 接收到 AgentRecord, THE AgentAvatarGenerator SHALL 为每个 Agent 生成 3D 头像模型（支持参数化生成或预设模型库选择）
2. THE AgentAvatarGenerator SHALL 在头像周围显示 Agent 名称、角色、当前任务和状态指示灯（绿色=空闲、黄色=工作中、红色=错误、灰色=离线）
3. WHEN Agent 执行状态变化, THE AgentAvatarGenerator SHALL 通过 WebSocket 实时更新状态指示灯
4. WHEN 用户通过手势点击 Agent 头像, THE AgentAvatarGenerator SHALL 弹出详情面板，显示职责、技能、当前任务和通信历史
5. THE AgentAvatarGenerator SHALL 支持 Agent 间的虚拟通信气泡，显示最近的消息或协作事件

### 需求 6：多用户协作与视角同步

**用户故事：** 作为 VR 用户，我希望与其他用户在同一虚拟空间中协作，以便实时共享工作进展和讨论。

#### 验收标准

1. THE VRSessionManager SHALL 管理多个并发 VR 用户会话，每个会话包含用户身份、头显位置、手部位置和视角方向
2. WHEN 用户进入 VR 场景, THE VRSessionManager SHALL 在其他用户的场景中实时显示和更新该用户的虚拟形象（头像、手部模型、视线指示）
3. WHEN 用户执行操作（拖拽任务、调整看板、指向数据流）, THE VRSessionManager SHALL 将操作以动画平滑过渡的方式同步给其他用户
4. THE VRSessionManager SHALL 支持虚拟语音通话或文本聊天，集成到 VR 场景中（语音气泡、聊天面板）
5. WHEN 用户通过手势创建虚拟指针或标注, THE VRSessionManager SHALL 将标注临时标记在场景中，其他用户可见
6. THE VRSessionManager SHALL 通过 CRDT 或事件溯源保证场景状态的最终一致性，支持用户加入和离开时的状态恢复

### 需求 7：VR 平台适配层与接口标准化

**用户故事：** 作为开发者，我希望系统提供标准化的 VR 平台适配接口，以便支持多种 VR 设备和未来扩展。

#### 验收标准

1. THE VRPlatformAdapter 接口 SHALL 定义初始化、手势识别、渲染、输入处理和会话管理方法
2. THE WebXRAdapter SHALL 基于 WebXR API 实现 VRPlatformAdapter 接口，支持浏览器 VR；THE MockVRAdapter SHALL 提供完整的模拟实现，用于开发和测试
3. THE VRPlatformAdapter SHALL 通过 JSON 序列化场景配置和交互命令，保持与平台无关
4. THE VRPlatformAdapter SHALL 提供 SDK 或插件模板，便于第三方为新平台实现适配器
5. THE VRPlatformAdapter SHALL 通过依赖注入或工厂模式集成，支持运行时动态切换平台

### 需求 8：VR 场景性能优化与流式渲染

**用户故事：** 作为 VR 用户，我希望场景渲染流畅无卡顿，以便获得舒适的沉浸式体验。

#### 验收标准

1. THE SceneOptimizer SHALL 根据用户视角和硬件性能动态调整渲染质量（分辨率、阴影、粒子效果）
2. THE SceneOptimizer SHALL 支持 LOD 模型，远距离对象使用低多边形模型，近距离使用高细节模型
3. WHEN 用户在场景中移动, THE SceneOptimizer SHALL 动态加载和卸载周围区域的对象，实现流式加载
4. THE SceneOptimizer SHALL 将数据流动画、UI 更新等计算密集操作分配到后台线程或 GPU 加速
5. THE SceneOptimizer SHALL 持续监控帧率并自适应调整渲染参数，目标维持 90+ FPS

### 需求 9：VR 场景录制与回放

**用户故事：** 作为 VR 用户，我希望录制和回放 VR 会话，以便回顾工作过程和分享给团队。

#### 验收标准

1. THE VRSessionRecorder SHALL 记录所有场景事件（用户操作、状态变化、通信、数据流更新），存储为事件流
2. WHEN 用户回放录制内容, THE VRSessionRecorder SHALL 支持按时间范围、用户和对象类型过滤回放内容
3. THE VRSessionRecorder SHALL 支持回放控制：暂停、快进、慢放、跳转，用户可从任意视角观看
4. THE VRSessionRecorder SHALL 支持将录制文件导出为视频格式（用于分享）或事件日志格式（用于分析）
5. WHEN 用户在回放过程中添加标注, THE VRSessionRecorder SHALL 将标注与时间点关联，便于讨论和文档化

### 需求 10：前端 VR 控制面板与配置管理

**用户故事：** 作为用户，我希望在 2D 前端界面中管理 VR 会话和配置，以便在进入 VR 前做好准备。

#### 验收标准

1. THE VR_Management_Panel SHALL 显示当前 VR 会话列表、在线用户和场景状态
2. THE VR_Management_Panel SHALL 支持启动和停止 VR 会话、邀请用户加入、配置场景参数（布局、配色、交互灵敏度）
3. THE VR_Management_Panel SHALL 提供 VR 场景预览（2D 投影或缩略图），用户可在加入前查看
4. WHEN 请求 VR 会话信息, THE VR_Management_Panel SHALL 通过 GET /api/vr-sessions 获取数据，并通过 WebSocket 接收实时推送
5. THE VR_Management_Panel SHALL 支持从 2D 前端向 VR 用户发送通知或指令（如"查看任务看板"、"关注数据流"）
