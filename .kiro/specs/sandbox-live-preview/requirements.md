# 需求文档

## 简介

Sandbox Live Preview 功能为 WhyBuddy 平台增加实时沙箱预览能力。当 Docker 容器执行任务时，用户可以在 3D 办公场景中实时查看终端输出（stdout/stderr）和浏览器截图预览。该功能分为两个阶段：Phase 1 扩展执行器回调协议以支持日志流和截图事件；Phase 2 构建前端预览组件并集成到 3D 场景中。

## 术语表

- **Executor**：Lobster Executor，基于 Docker 的远端执行器服务，负责运行容器化任务
- **Cube_Brain**：服务端核心，接收执行器回调事件并通过 Socket.IO 转发给前端
- **ExecutorCallbackEvent**：执行器通过 POST /api/executor/events 发送的回调事件
- **HMAC_Signature**：基于 HMAC-SHA256 的请求签名机制，用于验证执行器回调的真实性
- **Socket_IO**：实时双向通信协议，用于服务端向前端推送事件
- **Terminal_Component**：基于 xterm.js 的终端模拟器组件，用于显示实时日志输出
- **Screenshot_Preview**：截图预览组件，用于显示浏览器截图的最新帧
- **Sandbox_Monitor**：3D 场景中的监视器区域，承载终端和截图预览
- **Rolling_Buffer**：服务端维护的滚动日志缓冲区，为后加入的客户端提供历史日志
- **Step_Index**：执行计划中步骤的索引，用于将日志和截图关联到具体执行步骤

## 需求

### 需求 1：执行器日志流协议

**用户故事：** 作为开发者，我希望执行器能将容器 stdout/stderr 日志实时流式传输回 Cube Brain，以便前端能显示实时终端输出。

#### 验收标准

1. THE Executor 回调协议（shared/executor/contracts.ts）SHALL 在 ExecutorEventType 中定义新的事件类型 "job.log_stream"，对应的 ExecutorEvent 扩展字段包括：stepIndex（number）、stream（"stdout" | "stderr"）、data（string，单次事件最大 4KB）
2. WHEN 容器产生 stdout 或 stderr 输出时，THE Executor SHALL 通过 POST /api/executor/events（type="job.log_stream"）将日志数据发送至 Cube Brain，使用现有 HMAC 签名机制
3. THE Executor SHALL 以最大 500ms 间隔和最大 4KB 批量大小对日志行进行批处理，避免回调端点过载
4. THE Executor SHALL 在每个日志事件中包含 stepIndex 字段，使前端能将日志关联到具体执行步骤
5. IF 回调端点不可达，THEN THE Executor SHALL 缓冲最多 64KB 的日志数据，并以指数退避策略重试（最多 3 次）

### 需求 2：执行器截图协议

**用户故事：** 作为开发者，我希望执行器能定期捕获并发送无头浏览器任务的浏览器截图，以便前端能显示 Web 内容的实时预览。

#### 验收标准

1. THE Executor 回调协议 SHALL 在 ExecutorEventType 中定义新的事件类型 "job.screenshot"，对应的 ExecutorEvent 扩展字段包括：stepIndex（number）、imageData（base64 编码 PNG，最大 200KB）、width（number）、height（number）
2. WHEN 某个步骤标记为 "browser" 类型时，THE Executor SHALL 以可配置的间隔（默认 2 秒，最小 1 秒，最大 10 秒）捕获截图
3. THE Executor SHALL 在编码前将截图缩放至最大 800×600 尺寸，以控制载荷大小
4. IF 截图捕获失败（例如浏览器未就绪），THEN THE Executor SHALL 跳过该帧并继续下一个间隔，同时记录警告日志
5. WHEN 步骤完成或任务被取消时，THE Executor SHALL 停止截图捕获

### 需求 3：Cube Brain 日志/截图中继

**用户故事：** 作为开发者，我希望 Cube Brain 能接收执行器的日志和截图事件，并通过 Socket.IO 中继给前端。

#### 验收标准

1. THE 服务端 SHALL 在现有 POST /api/executor/events 端点接受 "job.log_stream" 和 "job.screenshot" 事件，使用与现有事件类型相同的 HMAC 签名验证
2. WHEN 收到 "job.log_stream" 事件时，THE 服务端 SHALL 通过新的 Socket.IO 事件 "mission_log" 将日志中继给前端，包含字段：missionId、jobId、stepIndex、stream、data、timestamp
3. WHEN 收到 "job.screenshot" 事件时，THE 服务端 SHALL 通过新的 Socket.IO 事件 "mission_screen" 将截图中继给前端，包含字段：missionId、jobId、stepIndex、imageData、width、height、timestamp
4. THE 服务端 SHALL 为每个 Mission 维护一个最近 200 条日志行的滚动缓冲区，供后加入的客户端使用
5. WHEN 前端客户端连接或请求日志历史时，THE 服务端 SHALL 将缓冲的日志行作为单个 "mission_log_history" 事件发送

### 需求 4：前端终端预览

**用户故事：** 作为用户，我希望在 3D 场景中看到执行沙箱的实时终端输出，以便观看命令的实时执行过程。

#### 验收标准

1. THE 前端 SHALL 使用 xterm.js 渲染终端模拟器组件，显示实时日志输出
2. THE 终端组件 SHALL 支持 ANSI 颜色代码、500 行回滚缓冲区，以及新输出时自动滚动到底部
3. THE 终端组件 SHALL 在视觉上区分 stdout（默认颜色）和 stderr（红色色调）
4. THE 终端组件 SHALL 可通过 @react-three/drei 的 Html 组件嵌入 3D 场景，定位在 Sandbox Monitor 的主监视器上
5. WHEN 没有活跃执行时，THE 终端 SHALL 显示空闲消息（"等待执行..."）
6. THE 终端组件 SHALL 支持"全屏"切换，将其扩展为更大的覆盖面板

### 需求 5：前端截图预览

**用户故事：** 作为用户，我希望看到执行沙箱中正在渲染的网页的实时预览。

#### 验收标准

1. THE 前端 SHALL 渲染截图预览组件，显示最新的截图图像
2. WHEN 新截图到达时，THE 截图预览 SHALL 以平滑过渡更新（交叉淡入，300ms）
3. THE 截图预览 SHALL 显示时间戳叠加层，标示截图的捕获时间
4. THE 截图预览 SHALL 可通过 Html 组件嵌入 3D 场景，定位在终端预览旁边
5. WHEN 没有可用截图时，THE 预览 SHALL 显示占位符（"暂无浏览器预览"）
6. THE 截图预览 SHALL 支持点击放大以查看细节

### 需求 6：3D 场景集成

**用户故事：** 作为用户，我希望沙箱预览感觉像 3D 办公场景的自然组成部分。

#### 验收标准

1. THE 3D 场景 SHALL 在办公室右侧包含一个新的 "Sandbox Monitor" 区域，由 1-2 个监视器/屏幕 3D 对象组成
2. THE 终端预览 SHALL 通过 Html 组件渲染在主监视器上
3. THE 截图预览 SHALL 通过 Html 组件渲染在副监视器上（或作为同一监视器上的切换标签）
4. WHEN 有内容正在显示时，THE 监视器 SHALL 具有微妙的屏幕发光效果
5. WHEN 没有活跃执行时，THE Sandbox Monitor 区域 SHALL 可见但不显眼（暗屏/关闭状态）
6. THE Sandbox Monitor SHALL 与 Mission Island（来自 scene-mission-fusion 规范）共存，无视觉冲突
