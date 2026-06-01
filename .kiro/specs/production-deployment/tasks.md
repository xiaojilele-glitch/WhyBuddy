# 实施计划：生产级部署方案

## 概述

将 WhyBuddy 的生产部署方案分为 5 个阶段实施：基础设施文件（Dockerfile + Compose）、后端可观测性模块（日志 + 指标 + 优雅关闭）、监控配置（Prometheus + Grafana）、部署脚本与文档、测试与验证。每个阶段增量构建，确保前一阶段的产物可立即验证。

## 任务

- [ ] 1. 创建 Dockerfile 与 .dockerignore
  - [ ] 1.1 创建 Dockerfile.frontend
    - 多阶段构建：阶段 1 使用 node:20-alpine 安装 pnpm 并执行 vite build，阶段 2 使用 nginx:1.27-alpine 仅复制 dist/public/ 和 nginx.conf
    - 配置非 root 用户（nginx）
    - 添加 HEALTHCHECK 指令
    - _Requirements: 1.1, 1.4, 1.5_

  - [ ] 1.2 创建 deploy/nginx.conf
    - 配置静态文件服务（SPA fallback）
    - 配置 /api/ 反向代理到 backend:3001
    - 配置 /socket.io/ WebSocket 代理
    - 配置 /health 端点返回 200
    - _Requirements: 2.2, 4.2_

  - [ ] 1.3 创建 Dockerfile.backend
    - 多阶段构建：阶段 1 使用 node:20-alpine 安装 pnpm 并执行 build（esbuild），阶段 2 仅复制 dist/index.js、生产依赖和 package.json
    - 创建非 root 用户 appuser，设置 USER appuser
    - 添加 HEALTHCHECK 指令（wget /api/health）
    - _Requirements: 1.2, 1.4, 1.5_

  - [ ] 1.4 创建 Dockerfile.lobster
    - 多阶段构建：阶段 1 构建 lobster-executor，阶段 2 仅复制构建产物和生产依赖
    - 创建非 root 用户 appuser
    - 添加 HEALTHCHECK 指令
    - _Requirements: 1.3, 1.4, 1.5_

  - [ ] 1.5 创建 .dockerignore
    - 排除 .env、.git、node_modules、data/、.manus-logs/、docs/、*.md（README 除外）、测试文件
    - _Requirements: 9.4_

  - [ ]* 1.6 编写 Dockerfile 非 root 用户属性测试
    - **Property 6: Dockerfile 非 root 用户**
    - 解析所有 Dockerfile，验证最终阶段包含非 root USER 指令
    - **Validates: Requirements 1.4**

- [ ] 2. 创建后端可观测性模块
  - [ ] 2.1 创建 server/core/logger.ts 结构化日志模块
    - 实现 createLogger(service) 函数，返回 Logger 接口（info/warn/error）
    - 每条日志输出为 JSON 到 stdout，包含 timestamp（ISO 8601）、level、message、service 字段
    - 实现 requestLogMiddleware(logger) Express 中间件，记录 HTTP 请求的 method、path、statusCode、durationMs
    - _Requirements: 5.1, 5.3, 5.4_

  - [ ]* 2.2 编写日志格式与级别正确性属性测试
    - **Property 1: 日志格式与级别正确性**
    - 使用 fast-check 生成随机日志级别和消息，验证输出 JSON 格式和字段正确性
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 2.3 编写 HTTP 请求日志完整性属性测试
    - **Property 2: HTTP 请求日志完整性**
    - 使用 fast-check 生成随机 HTTP method/path/statusCode，验证中间件输出包含对应字段
    - **Validates: Requirements 5.4**

  - [ ] 2.4 创建 server/core/prometheus.ts 指标模块
    - 使用 prom-client 库定义指标：http_requests_total（Counter）、http_request_duration_seconds（Histogram）、socketio_connections_active（Gauge）、nodejs_memory_usage_bytes（Gauge）
    - 实现 metricsMiddleware() 中间件自动记录请求指标
    - 实现 metricsHandler() 处理 GET /metrics 请求
    - 实现 initMetrics(app) 注册中间件和路由
    - _Requirements: 6.1, 6.2_

  - [ ] 2.5 创建 server/core/graceful-shutdown.ts 优雅关闭模块
    - 实现 setupGracefulShutdown(options) 函数
    - 监听 SIGTERM 和 SIGINT，调用 server.close()，等待超时（默认 30s），执行清理回调后退出
    - _Requirements: 4.3_

  - [ ]* 2.6 编写优雅关闭属性测试
    - **Property 5: 优雅关闭完成性**
    - 创建 HTTP 服务器，发起随机数量的并发请求，触发关闭信号，验证所有请求完成后服务器才退出
    - **Validates: Requirements 4.3**

  - [ ] 2.7 创建 server/core/env-validator.ts 环境变量验证模块
    - 实现 validateEnv() 函数，检查必需环境变量是否存在
    - 缺失时返回包含所有缺失变量名的错误对象
    - _Requirements: 3.4_

  - [ ]* 2.8 编写环境变量缺失检测属性测试
    - **Property 4: 环境变量缺失检测**
    - 使用 fast-check 生成必需变量的随机子集，验证验证函数正确报告所有缺失项
    - **Validates: Requirements 3.4**

  - [ ] 2.9 集成可观测性模块到 server/index.ts
    - 在 startServer() 中调用 initMetrics(app) 注册指标中间件和 /metrics 路由
    - 在 startServer() 中使用 createLogger('backend') 替换 console.log
    - 在 startServer() 中添加 requestLogMiddleware
    - 在 server.listen() 后调用 setupGracefulShutdown({ server })
    - 在 startServer() 开头调用 validateEnv()，失败时终止
    - _Requirements: 4.3, 5.1, 6.1, 3.4_

- [ ] 3. 检查点 - 确保所有测试通过
  - 运行 vitest 确保所有测试通过，如有问题请询问用户。

- [ ] 4. 创建 Docker Compose 编排与多环境配置
  - [ ] 4.1 创建 docker-compose.yml
    - 定义五个服务：frontend、backend、lobster-executor、prometheus、grafana
    - 配置 cube-network bridge 网络
    - 配置命名卷：backend-data、lobster-data、prometheus-data、grafana-data
    - 配置 depends_on 和 healthcheck
    - 配置日志驱动（json-file, max-size: 10m, max-file: 3）
    - Frontend 配置 read_only: true 和 tmpfs
    - 仅暴露 frontend:80 和 grafana:3000 端口
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.2, 4.5, 5.2, 9.1, 9.2, 9.3_

  - [ ] 4.2 创建 docker-compose.override.yml
    - 开发环境覆盖：源码挂载、调试端口暴露、热重载配置
    - _Requirements: 2.5_

  - [ ] 4.3 创建多环境配置文件
    - 创建 .env.dev（NODE_ENV=development，宽松配置）
    - 创建 .env.staging（NODE_ENV=staging，接近生产）
    - 创建 .env.prod（NODE_ENV=production，严格配置）
    - 每个文件包含完整环境变量分组，与 .env.example 对齐
    - 添加 GRAFANA_ADMIN_PASSWORD 和 GRAFANA_PORT 变量
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 4.4 编写环境配置完整性属性测试
    - **Property 3: 环境配置完整性**
    - 解析所有 .env 文件，验证每个文件包含所有必需环境变量键
    - **Validates: Requirements 3.3**

- [ ] 5. 创建监控配置
  - [ ] 5.1 创建 deploy/prometheus.yml
    - 配置 global scrape_interval: 15s
    - 配置 cube-backend 和 cube-lobster 两个 scrape job
    - _Requirements: 6.3, 6.4_

  - [ ] 5.2 创建 Grafana 预配置文件
    - 创建 deploy/grafana/provisioning/datasources/prometheus.yml（自动配置 Prometheus 数据源）
    - 创建 deploy/grafana/provisioning/dashboards/dashboard.yml（仪表盘提供者配置）
    - 创建 deploy/grafana/dashboards/cube-overview.json（预配置仪表盘：HTTP 请求速率、延迟分位数、连接数、内存趋势）
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 6. 创建部署脚本与文档
  - [ ] 6.1 创建 scripts/deploy-prod.sh
    - 实现零停机更新流程：构建新镜像 → 逐个滚动更新（backend → lobster-executor → frontend）→ 等待健康检查 → 清理旧镜像
    - 添加错误处理：构建失败中止、健康检查超时报错
    - 设置可执行权限
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 6.2 创建 docs/production-deployment.md 部署文档
    - 包含章节：前置条件、首次部署步骤、环境配置说明、零停机更新流程、监控面板访问、日志查看方法、常见问题排查
    - 提供从全新服务器到系统运行的完整命令序列
    - 说明每个环境变量的用途和默认值
    - 包含 Smoke 测试验证步骤
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 7. 最终检查点 - 确保所有测试通过
  - 运行 vitest 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的子任务为可选项，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务确保增量验证
- 属性测试使用 fast-check 库，每个测试至少运行 100 次迭代
- 单元测试验证具体示例和边界情况
