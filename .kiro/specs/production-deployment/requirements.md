# 需求文档

## 简介

为 WhyBuddy 多智能体可视化教学平台提供一套完整的生产级部署方案。通过 Docker Compose 一键编排前端静态托管、后端 Node 服务、Lobster Executor 执行器以及 Prometheus + Grafana 监控组件，支持多环境配置切换（dev / staging / prod），实现健康检查、优雅关闭、零停机更新、日志聚合和卷持久化，使系统可安全、可靠地部署到服务器、VPS 或云平台。

## 术语表

- **Compose_Stack**：由 docker-compose.yml 定义的全部容器服务集合，包括 Frontend、Backend、Lobster_Executor、Prometheus、Grafana
- **Frontend_Service**：基于 Nginx 的前端静态文件托管容器，提供 React 构建产物和 API 反向代理
- **Backend_Service**：运行 Express + Socket.IO 的 Node.js 后端容器
- **Lobster_Executor**：Docker 参考执行器服务，负责接收和执行 Mission 任务
- **Prometheus**：时序指标采集与存储系统，定期抓取各服务的 /metrics 端点
- **Grafana**：指标可视化仪表盘，读取 Prometheus 数据源展示系统运行状态
- **Health_Check**：Docker 内置的容器健康检查机制，定期探测服务可用性
- **Graceful_Shutdown**：服务收到终止信号后完成当前请求再退出的优雅关闭行为
- **Zero_Downtime_Update**：通过滚动更新策略实现服务更新期间不中断对外服务
- **Multi_Stage_Build**：Docker 多阶段构建，在构建阶段编译代码，在运行阶段仅保留最小运行时
- **Metrics_Endpoint**：后端暴露的 /metrics HTTP 端点，返回 Prometheus 格式的指标数据

## 需求

### 需求 1：Dockerfile 多阶段构建

**用户故事：** 作为运维工程师，我希望每个服务都有独立的 Dockerfile 并采用多阶段构建，以便生成最小化、安全的生产镜像。

#### 验收标准

1. THE Multi_Stage_Build SHALL 为 Frontend_Service 生成仅包含 Nginx 和静态文件的生产镜像，最终镜像不包含 Node.js 运行时和源代码
2. THE Multi_Stage_Build SHALL 为 Backend_Service 生成仅包含 Node.js 运行时和编译产物的生产镜像，最终镜像不包含 devDependencies 和源代码
3. THE Multi_Stage_Build SHALL 为 Lobster_Executor 生成仅包含 Node.js 运行时和编译产物的生产镜像
4. WHEN 构建任意 Dockerfile 时, THE Multi_Stage_Build SHALL 使用非 root 用户运行应用进程
5. WHEN 构建任意 Dockerfile 时, THE Multi_Stage_Build SHALL 在最终阶段仅复制运行所需的文件，排除 .git、node_modules（devDependencies）、测试文件和文档

### 需求 2：Docker Compose 编排

**用户故事：** 作为运维工程师，我希望通过一条 `docker compose up -d --build` 命令启动全部服务，以便快速完成部署。

#### 验收标准

1. WHEN 执行 `docker compose up -d --build` 时, THE Compose_Stack SHALL 自动构建并启动 Frontend_Service、Backend_Service、Lobster_Executor、Prometheus 和 Grafana 全部五个服务
2. THE Compose_Stack SHALL 通过 Docker 网络使各服务之间可以通过服务名互相访问
3. THE Compose_Stack SHALL 通过 depends_on 和 Health_Check 确保服务按正确顺序启动，Backend_Service 在数据卷就绪后启动，Frontend_Service 在 Backend_Service 健康后启动
4. THE Compose_Stack SHALL 为 Backend_Service 的 data/ 目录和 Prometheus、Grafana 的数据目录配置命名卷持久化
5. WHEN 使用 docker-compose.override.yml 时, THE Compose_Stack SHALL 支持开发环境覆盖配置（如源码挂载、调试端口暴露）

### 需求 3：多环境配置

**用户故事：** 作为运维工程师，我希望通过环境变量文件切换 dev / staging / prod 配置，以便在不同环境使用不同参数而无需修改代码。

#### 验收标准

1. THE Compose_Stack SHALL 提供 .env.dev、.env.staging、.env.prod 三套环境配置文件模板
2. WHEN 启动 Compose_Stack 时, THE Compose_Stack SHALL 通过 `--env-file` 参数加载指定环境的配置文件
3. THE Compose_Stack SHALL 在每套环境配置中包含所有必需的环境变量分组：基础运行、主 LLM、Fallback LLM、工作流上下文、Executor 回调、Lobster 执行器、飞书集成
4. IF 必需的环境变量缺失, THEN THE Backend_Service SHALL 在启动时输出明确的错误日志并以非零退出码终止

### 需求 4：健康检查与优雅关闭

**用户故事：** 作为运维工程师，我希望每个服务都有健康检查和优雅关闭机制，以便及时发现故障并在更新时不丢失请求。

#### 验收标准

1. THE Backend_Service SHALL 在 GET /api/health 端点返回包含服务状态和时间戳的 JSON 响应
2. THE Compose_Stack SHALL 为 Backend_Service、Frontend_Service 和 Lobster_Executor 配置 Docker Health_Check，检查间隔不超过 30 秒
3. WHEN Backend_Service 收到 SIGTERM 信号时, THE Backend_Service SHALL 停止接受新连接，等待当前请求完成（超时 30 秒），然后退出进程
4. WHEN Frontend_Service 收到 SIGTERM 信号时, THE Frontend_Service SHALL 通过 Nginx 的 graceful shutdown 机制完成当前请求后退出
5. IF Health_Check 连续失败超过 3 次, THEN THE Compose_Stack SHALL 将该容器标记为 unhealthy

### 需求 5：日志聚合

**用户故事：** 作为运维工程师，我希望所有服务的日志以结构化 JSON 格式输出到 stdout，以便统一采集和分析。

#### 验收标准

1. THE Backend_Service SHALL 以 JSON 格式输出日志到 stdout，每条日志包含 timestamp、level、message 和 service 字段
2. THE Compose_Stack SHALL 为所有服务配置 Docker 日志驱动，限制单个日志文件大小为 10MB，最多保留 3 个轮转文件
3. WHEN Backend_Service 记录日志时, THE Backend_Service SHALL 根据日志级别（info / warn / error）正确设置 level 字段
4. THE Backend_Service SHALL 在 JSON 日志中包含请求的 HTTP 方法、路径和响应状态码（对于 HTTP 请求日志）

### 需求 6：Prometheus 指标暴露

**用户故事：** 作为运维工程师，我希望后端服务暴露 Prometheus 格式的指标端点，以便监控系统性能和健康状态。

#### 验收标准

1. THE Backend_Service SHALL 在 GET /metrics 端点返回 Prometheus 文本格式的指标数据
2. THE Metrics_Endpoint SHALL 包含以下指标：HTTP 请求总数（按方法、路径、状态码分组）、HTTP 请求延迟直方图、活跃 Socket.IO 连接数、Node.js 进程内存使用量
3. THE Prometheus SHALL 通过 prometheus.yml 配置文件定期抓取 Backend_Service 和 Lobster_Executor 的 /metrics 端点，抓取间隔为 15 秒
4. WHEN Prometheus 启动时, THE Prometheus SHALL 自动发现 Compose_Stack 中配置的所有抓取目标

### 需求 7：Grafana 基础仪表盘

**用户故事：** 作为运维工程师，我希望有一个预配置的 Grafana 仪表盘，以便直观查看系统运行状态。

#### 验收标准

1. WHEN Grafana 启动时, THE Grafana SHALL 自动配置 Prometheus 作为默认数据源
2. THE Grafana SHALL 预加载一个包含以下面板的仪表盘：HTTP 请求速率、请求延迟分位数（p50/p95/p99）、活跃连接数、内存使用趋势
3. THE Compose_Stack SHALL 通过卷挂载将 Grafana 仪表盘 JSON 和数据源配置注入容器，实现开箱即用
4. WHEN 首次访问 Grafana 时, THE Grafana SHALL 使用环境变量中配置的管理员密码，默认密码不为 admin

### 需求 8：零停机更新

**用户故事：** 作为运维工程师，我希望在更新服务时不中断对外服务，以便用户无感知地完成升级。

#### 验收标准

1. THE Zero_Downtime_Update SHALL 通过部署脚本实现：先构建新镜像，再逐个重启服务，每个服务重启后等待 Health_Check 通过才继续下一个
2. WHEN 执行零停机更新时, THE Frontend_Service SHALL 在新容器健康后才停止旧容器
3. WHEN 执行零停机更新时, THE Backend_Service SHALL 利用 Graceful_Shutdown 完成当前请求后再退出
4. THE Zero_Downtime_Update SHALL 提供一个 deploy-prod.sh 脚本封装完整的更新流程

### 需求 9：基础安全配置

**用户故事：** 作为运维工程师，我希望容器遵循安全最佳实践，以便降低生产环境的安全风险。

#### 验收标准

1. THE Compose_Stack SHALL 为所有应用容器配置非 root 用户运行
2. THE Compose_Stack SHALL 为 Frontend_Service 配置只读根文件系统（read_only: true），仅允许写入 Nginx 缓存和临时目录
3. THE Compose_Stack SHALL 仅暴露必要的端口：Frontend_Service 的 80 端口对外，其余服务端口仅在 Docker 内部网络可达
4. THE Compose_Stack SHALL 通过 .dockerignore 文件排除 .env、.git、node_modules、data/ 等敏感或不必要的文件

### 需求 10：部署文档

**用户故事：** 作为运维工程师，我希望有一份完整的部署操作指南，以便按步骤完成首次部署和日常运维。

#### 验收标准

1. THE 部署文档 SHALL 包含以下章节：前置条件、首次部署步骤、环境配置说明、零停机更新流程、监控面板访问、日志查看方法、常见问题排查
2. THE 部署文档 SHALL 提供从全新服务器到系统运行的完整命令序列
3. THE 部署文档 SHALL 说明每个环境变量的用途和默认值
4. THE 部署文档 SHALL 包含 Smoke 测试验证步骤，确认部署成功
