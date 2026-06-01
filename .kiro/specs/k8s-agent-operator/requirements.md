# 需求文档：K8s Agent Operator

## 简介

AgentOperator 是一个自定义 Kubernetes Operator，用于管理 WhyBuddy 平台中 Agent Pod 的生命周期、自动扩缩容、资源分配和故障恢复。通过 CRD（Custom Resource Definition）定义 Agent 工作负载，Operator 监听 CRD 变化并自动创建、更新、删除相应的 Pod、Service、ConfigMap 等资源。使用 TypeScript 和 `@kubernetes/client-node` 库实现。

## 术语表

- **AgentOperator**: 自定义 Kubernetes Operator，监听 CRD 变化并协调资源状态的控制器程序
- **AgentDeployment**: 自定义资源定义（CRD），apiVersion 为 `agent.io/v1alpha1`，用于声明式描述 Agent 工作负载
- **AgentPool**: 自定义资源定义（CRD），apiVersion 为 `agent.io/v1alpha1`，用于定义 Agent 池的扩缩容策略
- **Controller**: Operator 的核心组件，通过 informer 监听 CRD 变化并执行协调逻辑
- **Reconciler**: Controller 中的协调函数，负责将实际状态收敛到期望状态
- **Informer**: Kubernetes client-go 模式，用于监听资源变化事件
- **Webhook**: Kubernetes Admission Webhook，用于验证和变更 CRD 对象
- **Metrics_Exporter**: 导出 Prometheus 格式指标的组件
- **Scaler**: 基于指标数据执行自动扩缩容决策的组件
- **ownerReference**: Kubernetes 资源间的所有权关系，用于级联删除
- **CooldownPeriod**: 扩缩容操作后的冷却时间，防止频繁扩缩容
- **RollingUpdate**: 滚动更新策略，逐个替换 Pod 以保持服务可用
- **Recreate**: 重建策略，先删除所有旧 Pod 再创建新 Pod
- **ResourceQuota**: Kubernetes 资源配额对象，限制 namespace 内的资源使用
- **NetworkPolicy**: Kubernetes 网络策略对象，控制 Pod 间的网络访问
- **MigrationTool**: 将 Docker Compose 配置转换为 AgentDeployment YAML 的命令行工具

## 需求

### 需求 1：定义 AgentDeployment CRD

**用户故事：** 作为平台管理员，我需要定义 AgentDeployment CRD，用于声明式地描述 Agent 工作负载，以便通过 Kubernetes 原生方式管理 Agent。

#### 验收标准

1. THE AgentDeployment CRD SHALL 包含 spec 字段，支持 replicas、image、resources、env、volumeMounts、livenessProbe、readinessProbe 子字段
2. THE AgentDeployment CRD SHALL 包含 status 字段，支持 readyReplicas、updatedReplicas、availableReplicas、conditions 子字段
3. THE AgentDeployment CRD SHALL 支持 label selector 字段，用于选择关联的 Pod
4. THE AgentDeployment CRD SHALL 支持 strategy 字段，定义更新策略（RollingUpdate 或 Recreate）
5. THE AgentDeployment CRD SHALL 支持 scaling 字段，定义自动扩缩容策略（minReplicas、maxReplicas、targetCPUUtilization、targetMemoryUtilization、targetQueueLength）

### 需求 2：Operator 监听 AgentDeployment 变化

**用户故事：** 作为 Operator，我需要监听 AgentDeployment 资源的创建、更新、删除事件，并协调相应的 Pod 状态，以便实际资源与期望状态保持一致。

#### 验收标准

1. THE Controller SHALL 通过 informer 监听 AgentDeployment 的创建、更新、删除事件
2. WHEN 一个 AgentDeployment 被创建时，THE Reconciler SHALL 自动创建 spec.replicas 指定数量的 Pod
3. WHEN 一个 AgentDeployment 被更新时，THE Reconciler SHALL 根据 spec.strategy 字段执行 Pod 更新（RollingUpdate 或 Recreate）
4. WHEN 一个 AgentDeployment 被删除时，THE Reconciler SHALL 自动删除该 AgentDeployment 关联的所有 Pod、Service 和 ConfigMap
5. WHEN 任何协调操作执行时，THE Controller SHALL 创建 Kubernetes Event 记录操作类型、原因和结果

### 需求 3：Operator 创建和管理 Pod

**用户故事：** 作为 Operator，我需要根据 AgentDeployment 的规范创建和管理 Pod，以便 Agent 容器按照声明的配置运行。

#### 验收标准

1. WHEN Reconciler 创建 Pod 时，THE Reconciler SHALL 为每个 Pod 设置 ownerReference 指向对应的 AgentDeployment
2. WHEN Reconciler 创建 Pod 时，THE Reconciler SHALL 为 Pod 设置 label：app=agent、deployment=<deployment-name>、agent-type=<type>
3. THE Reconciler SHALL 从 AgentDeployment.spec.resources 读取 resource requests 和 limits 并应用到 Pod
4. THE Reconciler SHALL 从 AgentDeployment.spec.env 读取环境变量并注入到 Pod
5. THE Reconciler SHALL 从 AgentDeployment.spec.livenessProbe 和 AgentDeployment.spec.readinessProbe 读取探针配置并应用到 Pod

### 需求 4：Operator 创建和管理 Service

**用户故事：** 作为 Operator，我需要为 AgentDeployment 创建 Service，用于负载均衡和服务发现，以便其他组件可以访问 Agent。

#### 验收标准

1. WHEN 一个 AgentDeployment 被创建时，THE Reconciler SHALL 为该 AgentDeployment 创建一个 Service
2. THE Reconciler SHALL 设置 Service 的 selector 匹配 AgentDeployment 关联的 Pod label
3. THE Reconciler SHALL 从 AgentDeployment.spec.ports 读取端口配置并应用到 Service
4. THE AgentDeployment CRD SHALL 支持 Service type 配置（ClusterIP、NodePort、LoadBalancer）
5. WHEN Reconciler 创建 Service 时，THE Reconciler SHALL 为 Service 设置 ownerReference 指向对应的 AgentDeployment

### 需求 5：Operator 创建和管理 ConfigMap

**用户故事：** 作为 Operator，我需要为 AgentDeployment 创建 ConfigMap，用于存储 Agent 的配置文件（如 SOUL.md、skills 定义），以便 Agent 可以读取运行时配置。

#### 验收标准

1. WHEN 一个 AgentDeployment 被创建时，THE Reconciler SHALL 为该 AgentDeployment 创建一个 ConfigMap
2. THE Reconciler SHALL 将 AgentDeployment.spec.config 中定义的配置数据写入 ConfigMap 的 data 字段
3. THE Reconciler SHALL 将 ConfigMap 通过 volume 挂载到 Pod 的指定路径
4. WHEN ConfigMap 的内容发生变化时，THE Reconciler SHALL 触发关联 Pod 的滚动重启
5. WHEN Reconciler 创建 ConfigMap 时，THE Reconciler SHALL 为 ConfigMap 设置 ownerReference 指向对应的 AgentDeployment

### 需求 6：基于 CPU 和内存的自动扩缩容

**用户故事：** 作为 Operator，我需要根据 Pod 的 CPU 和内存使用情况自动调整副本数，以便在负载变化时保持性能和资源效率。

#### 验收标准

1. THE AgentDeployment CRD SHALL 在 spec.scaling 中包含 minReplicas、maxReplicas、targetCPUUtilization、targetMemoryUtilization 字段
2. THE Scaler SHALL 定期查询 Kubernetes Metrics Server 获取 Pod 的 CPU 和内存使用数据
3. THE Scaler SHALL 计算所有 Pod 的平均 CPU 使用率和平均内存使用率，并与 targetCPUUtilization 和 targetMemoryUtilization 比较
4. WHEN 平均使用率超过目标值时，THE Scaler SHALL 增加副本数（不超过 maxReplicas）
5. WHEN 平均使用率低于目标值时，THE Scaler SHALL 减少副本数（不低于 minReplicas）
6. WHEN 扩缩容操作执行时，THE Scaler SHALL 创建 Kubernetes Event 记录扩缩容原因、指标数据和新的副本数

### 需求 7：基于请求队列长度的自动扩缩容

**用户故事：** 作为 Operator，我需要根据 Agent 的请求队列长度自动调整副本数，以便在请求积压时及时扩容。

#### 验收标准

1. THE AgentDeployment CRD SHALL 在 spec.scaling 中包含 targetQueueLength 字段
2. THE Agent Pod SHALL 暴露 /metrics 端点，包含 agent_queue_length 指标
3. THE Scaler SHALL 定期查询每个 Pod 的 /metrics 端点获取 agent_queue_length 指标
4. THE Scaler SHALL 计算所有 Pod 的平均队列长度，并与 targetQueueLength 比较
5. WHEN 平均队列长度超过 targetQueueLength 时，THE Scaler SHALL 增加副本数（不超过 maxReplicas）
6. WHEN 平均队列长度低于 targetQueueLength 时，THE Scaler SHALL 减少副本数（不低于 minReplicas）

### 需求 8：自动扩缩容的冷却期和限制

**用户故事：** 作为 Operator，我需要实现扩缩容的冷却期和变化量限制，防止频繁的扩缩容导致系统不稳定。

#### 验收标准

1. THE AgentDeployment CRD SHALL 在 spec.scaling 中包含 scaleUpCooldown 和 scaleDownCooldown 字段（单位：秒）
2. WHILE 处于 scaleUpCooldown 期间内，THE Scaler SHALL 拒绝执行新的扩容操作
3. WHILE 处于 scaleDownCooldown 期间内，THE Scaler SHALL 拒绝执行新的缩容操作
4. WHEN 执行扩缩容时，THE Scaler SHALL 限制单次副本数变化量不超过当前副本数的 50%
5. WHEN 扩缩容决策被冷却期阻止时，THE Scaler SHALL 创建 Kubernetes Event 记录被阻止的原因和冷却剩余时间

### 需求 9：Pod 的健康检查和自动恢复

**用户故事：** 作为 Operator，我需要监控 Pod 的健康状态并自动处理异常，以便保持 Agent 服务的高可用性。

#### 验收标准

1. THE Reconciler SHALL 为每个 Pod 配置 liveness probe，定期检查 Agent 进程是否存活
2. THE Reconciler SHALL 为每个 Pod 配置 readiness probe，检查 Agent 是否就绪接收请求
3. WHEN liveness probe 失败时，THE Kubernetes 集群 SHALL 自动重启该 Pod
4. WHEN readiness probe 失败时，THE Kubernetes 集群 SHALL 将该 Pod 从 Service 的 endpoint 列表中移除
5. WHEN 一个 Pod 进入 CrashLoopBackOff 状态时，THE Controller SHALL 创建告警级别的 Kubernetes Event 记录 Pod 名称和崩溃原因

### 需求 10：滚动更新和蓝绿部署

**用户故事：** 作为 Operator，我需要支持滚动更新和蓝绿部署策略，确保更新过程中服务持续可用。

#### 验收标准

1. THE AgentDeployment CRD SHALL 在 spec.strategy 中支持 RollingUpdate 和 Recreate 两种类型
2. WHEN strategy 为 RollingUpdate 时，THE Reconciler SHALL 逐个替换 Pod，保持至少 (replicas - maxUnavailable) 个 Pod 可用
3. THE AgentDeployment CRD SHALL 在 spec.strategy.rollingUpdate 中包含 maxSurge 和 maxUnavailable 参数
4. WHEN strategy 为 RollingUpdate 时，THE Reconciler SHALL 通过 label（version=blue/green）区分蓝版本和绿版本的 Pod
5. WHEN 新版本 Pod 的 readiness probe 在指定超时时间内持续失败时，THE Reconciler SHALL 自动回滚到旧版本并创建 Event 记录回滚原因

### 需求 11：多租户隔离

**用户故事：** 作为 Operator，我需要支持多租户隔离，确保不同租户的 Agent Pod 运行在独立的环境中。

#### 验收标准

1. THE AgentDeployment CRD SHALL 使用 metadata.namespace 标识所属租户
2. WHEN 一个新租户的 AgentDeployment 被创建时，THE Reconciler SHALL 自动创建对应的 namespace（如果不存在）
3. THE Reconciler SHALL 在租户对应的 namespace 中创建 Pod、Service、ConfigMap 等资源
4. WHEN 一个租户的 namespace 被创建时，THE Reconciler SHALL 为该 namespace 创建 NetworkPolicy，限制跨 namespace 的网络访问
5. WHEN 一个租户的 namespace 被创建时，THE Reconciler SHALL 为该 namespace 创建 ResourceQuota，限制该租户的资源使用

### 需求 12：资源配额和限制

**用户故事：** 作为 Operator，我需要为每个租户设置资源配额，防止单个租户过度消耗集群资源。

#### 验收标准

1. THE Reconciler SHALL 为每个租户的 namespace 创建 ResourceQuota 对象
2. THE ResourceQuota SHALL 限制 Pod 数量上限、CPU 总量上限和内存总量上限
3. THE AgentDeployment 创建的 Pod SHALL 受所在 namespace 的 ResourceQuota 限制
4. IF 创建 Pod 时超过 ResourceQuota 限制，THEN THE Reconciler SHALL 记录告警级别的 Kubernetes Event，包含配额名称和超出的资源类型
5. THE AgentOperator SHALL 提供 REST API 端点查询指定租户的资源使用情况（已用/总配额）

### 需求 13：节点亲和性和 Pod 分布

**用户故事：** 作为 Operator，我需要支持节点亲和性和 Pod 分布策略，优化资源利用和高可用性。

#### 验收标准

1. THE AgentDeployment CRD SHALL 在 spec 中支持 nodeSelector、nodeAffinity、podAffinity、podAntiAffinity 字段
2. WHEN Reconciler 创建 Pod 时，THE Reconciler SHALL 将 AgentDeployment.spec 中的亲和性规则应用到 Pod 的调度配置
3. THE AgentDeployment CRD SHALL 支持 topologySpreadConstraints 字段，确保 Pod 分散到不同的节点和可用区
4. THE AgentDeployment CRD SHALL 支持 priorityClassName 字段，高优先级的 Pod 可以抢占低优先级的 Pod
5. WHEN 一个节点被标记为不可调度（cordon）时，THE Controller SHALL 监听节点事件并将受影响的 Pod 迁移到其他可用节点

### 需求 14：监控和告警

**用户故事：** 作为 Operator，我需要导出 Prometheus 指标，用于监控 Agent 部署的运行状态和性能。

#### 验收标准

1. THE Metrics_Exporter SHALL 导出以下部署级指标：agent_deployment_replicas、agent_pod_count、agent_scaling_events_total
2. THE Metrics_Exporter SHALL 导出以下 Pod 级指标：agent_pod_cpu_usage、agent_pod_memory_usage、agent_pod_queue_length
3. THE Metrics_Exporter SHALL 导出以下操作级指标：agent_deployment_update_duration_seconds、agent_pod_restart_count_total
4. THE Metrics_Exporter SHALL 为所有指标添加 label：deployment、namespace、agent_type、pod_name（Pod 级指标）
5. THE AgentOperator SHALL 暴露 /metrics HTTP 端点，返回 Prometheus 文本格式的指标数据

### 需求 15：日志和审计

**用户故事：** 作为 Operator，我需要记录详细的结构化日志和审计信息，便于问题诊断和操作追溯。

#### 验收标准

1. WHEN 任何 CRD 操作（创建、更新、删除）执行时，THE AgentOperator SHALL 记录包含操作类型、资源名称和 namespace 的日志
2. WHEN Pod 创建、更新或删除时，THE AgentOperator SHALL 记录包含操作原因和结果的日志
3. WHEN 扩缩容决策执行时，THE AgentOperator SHALL 记录包含决策原因、当前指标数据和目标副本数的日志
4. THE AgentOperator SHALL 以 JSON 格式输出结构化日志，每条日志包含 timestamp、level、component、message、context 字段
5. THE AgentOperator SHALL 将日志输出到 stdout，支持通过环境变量 LOG_LEVEL 配置日志级别（debug、info、warn、error）

### 需求 16：Webhook 验证和变更

**用户故事：** 作为 Operator，我需要实现 Admission Webhook，验证 AgentDeployment 的合法性并自动注入默认值，以便防止无效配置进入集群。

#### 验收标准

1. THE ValidatingWebhook SHALL 验证 AgentDeployment 的必填字段（spec.image、spec.replicas）存在且非空
2. THE ValidatingWebhook SHALL 验证 replicas >= 0、minReplicas >= 0、maxReplicas >= minReplicas
3. THE ValidatingWebhook SHALL 验证 spec.image 格式合法且 spec.resources 的 requests 不超过 limits
4. THE MutatingWebhook SHALL 在 AgentDeployment 缺少 livenessProbe 时自动注入默认的 HTTP GET /healthz 探针
5. THE MutatingWebhook SHALL 自动为 AgentDeployment 添加 managed-by=agent-operator label 和 creation-timestamp annotation

### 需求 17：从 Docker Compose 迁移到 K8s

**用户故事：** 作为用户，我需要将现有的 Docker Compose 配置迁移到 K8s AgentDeployment，以便平滑过渡到 Kubernetes 部署。

#### 验收标准

1. THE MigrationTool SHALL 解析 docker-compose.yml 文件并为每个 service 生成对应的 AgentDeployment YAML
2. THE MigrationTool SHALL 转换 Docker Compose 的 services、environment、volumes、ports 配置到 AgentDeployment 的对应字段
3. THE MigrationTool SHALL 为生成的 AgentDeployment 设置合理的默认值（resources.requests、livenessProbe、readinessProbe）
4. THE MigrationTool SHALL 将 Docker Compose 的 environment 映射转换为 AgentDeployment.spec.env 数组
5. THE MigrationTool SHALL 将 Docker Compose 的 ports 映射转换为 AgentDeployment.spec.ports 数组，并生成对应的 Service 配置

### 需求 18：前端展示 Agent 部署信息

**用户故事：** 作为用户，我希望在前端看到 Agent 的部署状态、副本数、资源使用情况，以便实时了解系统运行状况。

#### 验收标准

1. THE AgentOperator SHALL 提供 REST API 返回 AgentDeployment 列表，每项包含名称、副本数、就绪副本数、镜像版本
2. THE AgentOperator SHALL 提供 REST API 返回指定 AgentDeployment 的 Pod 列表，每项包含 Pod 名称、状态、CPU 使用率、内存使用率、重启次数
3. THE AgentOperator SHALL 提供 REST API 返回指定 AgentDeployment 的扩缩容历史，每项包含时间戳、原因、副本数变化（旧值和新值）
4. THE AgentOperator SHALL 提供 REST API 返回指定 AgentDeployment 的事件日志，包含所有 CRD 和 Pod 的操作事件
5. WHEN AgentDeployment 的状态发生变化时，THE AgentOperator SHALL 通过 WebSocket 向已连接的客户端推送状态更新事件
