# WhyBuddy — Trae 沙盒 Native Executor 兼容设计

日期：2026-04-15  
目标：在不具备 Docker 的 Trae/solo 沙盒环境中，让 “real” 执行链路依然可以真实运行命令（以本机进程方式），而不是退化为 mock。

## 背景与问题

当前 Lobster Executor 的 `real` 模式强依赖 Docker daemon：

- 沙盒环境无 `docker` CLI 且无 `/var/run/docker.sock`
- `services/lobster-executor/src/index.ts` 在 `executionMode === "real"` 时会 `docker.ping()`，失败直接 `process.exit(1)`

因此在沙盒中只能使用 `mock` 模式，无法“真实执行”。

## 目标与非目标

### 目标

- 在检测不到 Docker 的环境中，自动使用“本机进程执行（native）”作为 `real` 的降级路径
- 不中断现有 API/前端协议：Server 与前端仍通过现有 Executor API 与事件流工作
- 维持现有 `ExecutionPlanJob.payload.command` / `payload.env` / `payload.workspaceRoot` 协议
- 支持：执行、日志流、超时、取消（可选支持 pause/resume）
- 最小可用：能在沙盒里真实跑命令并产出 artifacts（log / result.json），供 UI 展示

### 非目标

- 不提供容器级隔离（无 Linux namespaces/cgroup/seccomp 的容器语义）
- 不在沙盒内安装或启动 Docker daemon
- 不试图完全等价 DockerRunner 的安全策略（仅做最小可用限制：超时、并发、工作目录约束）

## 用户约束与选择

- 用户接受 native 模式下可读写 `/workspace`，隔离弱但可用
- artifacts 方案由实现自行决定：优先“兼容现有协议 + 最小改动”

## 总体方案（推荐）

引入新的 JobRunner：`NativeRunner`，并实现“自动检测并降级”：

1. 配置层扩展 `executionMode`：`"mock" | "real" | "native"`
2. 启动探测 Docker：
   - 若 `LOBSTER_EXECUTION_MODE=real` 且 Docker 可用：继续使用 DockerRunner
   - 若 `LOBSTER_EXECUTION_MODE=real` 但 Docker 不可用：降级为 NativeRunner（不退出进程）
3. Runner factory 选择：
   - mock → MockRunner
   - real 且 dockerReady → DockerRunner
   - native 或（real 且 !dockerReady）→ NativeRunner

这样用户依旧写 `LOBSTER_EXECUTION_MODE=real`，在沙盒里得到“真实执行”，在有 Docker 的机器上仍得到“容器执行”。

## 接口与数据流

### 输入（沿用现有 ExecutionPlanJob.payload）

NativeRunner 读取：

- `payload.command: string[]`（必需）
- `payload.env?: Record<string, string>`（可选）
- `payload.workspaceRoot?: string`（可选，默认使用 job-local workspace 或 `/workspace`）
- `planJob.timeoutMs?: number`（沿用）
- `payload.aiEnabled?: boolean`（沿用，若 true 注入 AI env vars）

### 输出（事件与 artifacts）

保持与 DockerRunner 同一套事件类型：

- `job.accepted`（已由 service.submit 产生）
- `job.started`
- `job.log` / `job.log_stream`（按现有批量策略）
- `job.completed` / `job.failed` / `job.cancelled`

Artifacts（最小集合）：

- `executor.log`（现有 job logFile）
- `result.json`（native 执行结果摘要）
- （可选）`artifacts/` 快照：若 `workspaceRoot/artifacts` 存在，则拷贝到 job dataDirectory 下，并作为 artifacts 列表返回

## NativeRunner 行为细节

### 进程执行

- 使用 `child_process.spawn`（非 shell）
- `cwd`：
  - 若 `payload.workspaceRoot` 是绝对路径：使用该路径
  - 否则：回退到 job-local workspace（`<jobDataDir>/workspace`）或当前工作目录
- `env`：
  - 合并 `process.env` + `payload.env`
  - 若 `aiEnabled`：复用 `credential-injector` 注入 LLM 配置（与 DockerRunner 一致）

### 超时与取消

- 超时：到时先 `SIGTERM`，短延时后 `SIGKILL`
- 取消：复用 `service.cancel` 语义；NativeRunner 提供 `cancel(record)`：
  - 若子进程存在：发送 `SIGTERM`，并标记 record 取消原因

### 日志

- stdout/stderr 流式写入现有 `record.logFile`
- 通过现有 LogBatcher 将日志批量上报 callback，避免过多事件
- 仍保留 stderr ring buffer（用于失败摘要）

### 并发

- 继续使用现有 `ConcurrencyLimiter`（service 层已具备）

## 兼容性改动点

### 1) 扩展类型

- `services/lobster-executor/src/types.ts`
  - `executionMode` 扩展为 `"real" | "mock" | "native"`

### 2) 配置读取

- `services/lobster-executor/src/config.ts`
  - `LOBSTER_EXECUTION_MODE` 解析新增 `native`
  - 仍保留默认 `real`

### 3) 启动时 Docker 探测与降级

- `services/lobster-executor/src/index.ts`
  - 现状：real 且 ping 失败直接退出
  - 目标：real 且 ping 失败则记录 warning，并将“有效模式”切换为 native（传入 service/config）

### 4) Runner 工厂

- `services/lobster-executor/src/runner.ts`
  - 增加 `NativeRunner`
  - 修改 `createJobRunner` 选择逻辑

### 5) 新增 NativeRunner 实现

- 新文件：`services/lobster-executor/src/native-runner.ts`
  - 负责 spawn、日志、超时、取消、产物收集

### 6) /health 语义

- `services/lobster-executor/src/app.ts`
  - `features.dockerLifecycle` 改为：当前 runner 是否为 DockerRunner（而不是 config.executionMode === "real"）
  - `docker.status` 在 native 模式下保持 disconnected，但服务仍 ok

## 风险与缓解

- 隔离弱：native 可读写工作区
  - 缓解：默认 `cwd` 限制在 workspaceRoot；明确文档说明；保留 `maxConcurrentJobs` 和 `timeoutMs`
- 命令注入：payload.command 来自上游计划
  - 缓解：不使用 shell；后续可选增加 allowlist（本次不做）
- artifacts 目录策略不一致
  - 缓解：本次优先“兼容现有约定”：若存在 `workspaceRoot/artifacts` 则拷贝快照；否则只返回 log/result.json

## 验收标准

- 在无 Docker 的沙盒中：
  - `LOBSTER_EXECUTION_MODE=real` 能成功启动 executor（不退出）
  - `/health` 返回 ok，且能反映 docker disconnected 与 dockerLifecycle=false
  - server 发起的执行任务在 UI 中可看到真实日志与最终状态
- 在有 Docker 的环境中：
  - `LOBSTER_EXECUTION_MODE=real` 继续使用 DockerRunner，不影响现有行为

