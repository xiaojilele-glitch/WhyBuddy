# 需求文档

## 简介

Lobster Executor 当前的 `runAcceptedJob()` 完全是 mock 实现——模拟延迟、写入假的 result.json、事件仅追加到本地 JSONL 文件。整个 Mission 执行管道（ExecutionPlan 构建、ExecutorClient 分发、HMAC 回调机制、前端实时状态展示）均已就绪，唯一缺失的环节是执行器真正运行 Docker 容器并通过 HMAC 签名回调将事件推送回 Cube Brain。

本需求定义了将 mock 执行器升级为真实 Docker 容器执行器所需的全部行为。

## 术语表

- **Executor**：Lobster Executor 服务，负责接收 Job 请求并执行容器化任务
- **Cube_Brain**：WhyBuddy 服务端，通过 `/api/executor/events` 接收执行器回调
- **Docker_Daemon**：Docker 守护进程，提供容器创建/启动/停止/删除等 API
- **Job**：一个可执行的任务单元，对应 `ExecutionPlanJob`
- **Container**：Docker 容器实例，运行 Job 指定的命令
- **Callback**：执行器向 Cube Brain 发送的 HMAC 签名 HTTP POST 请求
- **Workspace**：Job 的工作目录，挂载到容器内的 `/workspace`
- **Artifact**：Job 执行产生的输出文件，位于容器内 `/workspace/artifacts/`
- **HMAC_Signer**：使用 HMAC-SHA256 算法对回调请求进行签名的模块
- **Mock_Runner**：现有的模拟执行逻辑，不依赖 Docker

## 需求

### 需求 1：Docker 容器生命周期管理

**用户故事：** 作为系统，我需要执行器创建、启动、运行并清理真实的 Docker 容器来执行每个 Job，以便 Mission 的代码能在隔离环境中实际运行。

#### 验收标准

1. THE Executor SHALL 使用 dockerode 库与 Docker_Daemon 交互，根据 Job payload.image 字段指定的镜像创建容器（默认镜像为 "node:20-slim"）
2. THE Executor SHALL 将 Job payload.env 字段中的环境变量注入到 Container 中
3. THE Executor SHALL 将 Job 专属的 Workspace 目录挂载到 Container 的 /workspace 路径（若 payload.workspaceRoot 存在则使用该值）
4. THE Executor SHALL 在 Container 内执行 payload.command 字段指定的命令（字符串数组）
5. THE Executor SHALL 实时流式采集 Container 的 stdout 和 stderr，并写入 Job 的日志文件
6. THE Executor SHALL 等待 Container 退出或超时（超时时间为 job.timeoutMs，默认 300000 毫秒）
7. IF Container 超过 timeoutMs 仍未退出，THEN THE Executor SHALL 先发送 SIGTERM 停止 Container，等待 10 秒后若仍在运行则发送 SIGKILL 强制终止
8. THE Executor SHALL 检查 Container 的退出码：退出码 0 表示 completed，非零退出码表示 failed
9. THE Executor SHALL 在 Job 完成后（无论成功或失败）删除 Container，同时保留日志和 Artifact 文件
10. THE Executor SHALL 从 Container 的 /workspace/artifacts/ 目录收集文件作为 Job 的 Artifact

### 需求 2：HMAC 签名回调投递

**用户故事：** 作为系统，我需要执行器通过 HMAC 签名的回调端点向 Cube Brain 发送实时事件，以便 Mission 状态能被正确更新和展示。

#### 验收标准

1. THE Executor SHALL 对每个事件（job.started、job.progress、job.log、job.completed、job.failed）向 callback.eventsUrl 发送 HTTP POST 请求
2. THE HMAC_Signer SHALL 使用 HMAC-SHA256 算法，以 "timestamp.rawBody" 格式签名每个回调请求，并设置 x-cube-executor-signature、x-cube-executor-timestamp 和 x-cube-executor-id 请求头
3. THE Executor SHALL 从 EXECUTOR_CALLBACK_SECRET 环境变量读取 HMAC 签名密钥
4. IF callback 端点不可达，THEN THE Executor SHALL 最多重试 3 次，采用指数退避策略（间隔 1 秒、2 秒、4 秒）
5. IF 所有重试均失败，THEN THE Executor SHALL 记录失败日志并继续执行（回调失败不得阻塞 Job 执行）
6. THE Executor SHALL 对重要日志行发送 job.log 事件（批量发送，最大间隔 500 毫秒，每个事件最大 4KB）

### 需求 3：Job 执行流程

**用户故事：** 作为开发者，我希望执行器遵循清晰的执行流程，从 Job 接受到完成，以便系统行为可预测且可追踪。

#### 验收标准

1. WHEN Job 被提交时，THE Executor SHALL 发出 job.accepted 事件（status: queued），然后立即开始执行
2. WHEN 执行开始时，THE Executor SHALL 发出 job.started 事件（status: running），message 中包含 Container ID
3. WHILE 执行进行中，THE Executor SHALL 每 5 秒或在有重要日志输出时发出 job.progress 事件
4. WHEN 执行成功完成（退出码 0）时，THE Executor SHALL 发出 job.completed 事件（status: completed），包含 Artifact 列表和 durationMs 指标
5. WHEN 执行失败（非零退出码或超时）时，THE Executor SHALL 发出 job.failed 事件（status: failed），包含 errorCode 和 stderr 最后 50 行
6. THE Executor SHALL 在完成/失败事件中包含 metrics（durationMs）

### 需求 4：配置与健康检查

**用户故事：** 作为开发者，我希望执行器可配置且可监控，以便在不同环境中灵活部署和排查问题。

#### 验收标准

1. THE Executor SHALL 从环境变量读取 Docker 连接设置：DOCKER_HOST（Linux 默认 /var/run/docker.sock，Windows 默认 npipe:////./pipe/docker_engine）、DOCKER_TLS_VERIFY、DOCKER_CERT_PATH
2. THE Executor SHALL 在启动时验证 Docker_Daemon 连通性，若 Docker 不可用则快速失败并输出清晰的错误信息
3. THE /health 端点 SHALL 包含 Docker_Daemon 状态（connected/disconnected）和队列统计信息
4. THE Executor SHALL 支持 LOBSTER_DEFAULT_IMAGE 环境变量设置默认容器镜像（默认值 "node:20-slim"）
5. THE Executor SHALL 支持 LOBSTER_MAX_CONCURRENT_JOBS 环境变量限制并行容器执行数量（默认值 2）

### 需求 5：向后兼容

**用户故事：** 作为开发者，我希望真实执行器与现有 mock 模式向后兼容，以便在没有 Docker 的开发环境中仍能正常工作。

#### 验收标准

1. THE Executor SHALL 支持 LOBSTER_EXECUTION_MODE 环境变量，值为 "real"（默认）或 "mock"
2. WHEN LOBSTER_EXECUTION_MODE 为 "mock" 时，THE Executor SHALL 使用现有的 Mock_Runner 逻辑（无 Docker 依赖）
3. THE Executor 的 HTTP API（/api/executor/jobs、/health）SHALL 保持不变——请求和响应格式相同
4. WHILE LOBSTER_EXECUTION_MODE 为 "mock" 时，所有现有测试 SHALL 继续通过
