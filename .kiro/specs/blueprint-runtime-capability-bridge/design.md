# 设计文档：运行时能力桥

## 概述

运行时能力桥位于自动驾驶路线和真实执行能力之间。它把页面输入、路线节点、SPEC 树节点和角色上下文转换为可调度的能力调用，并将能力输出、事件和证据沉淀回项目资产。

## 架构

```text
Route / Spec Node / Crew Context
      ↓
Capability Planner
      ↓
Sandbox Derivation Job
      ↓
Runtime Bridge
      ↓
Docker / MCP / Skill / AIGC Node / Role Agent
      ↓
Capability Evidence / Runtime Events
      ↓
RouteSet / SPEC Tree / SpecDocument / Preview / PromptPackage / Artifact Memory

Runtime Events ─────────→ Autopilot Runtime Event Stream ─────────→ 3D / HUD / Logs / Browser / Replay
```

## 组件

### Capability Registry

负责登记所有可用能力，包括类型、标签、输入输出结构、安全等级和运行状态。

### Capability Planner

根据路线步骤、SPEC 节点类型和项目上下文选择能力组合。

### Sandbox Derivation Job

负责把一次或多次能力调用打包为同一条推导作业。它维护 jobId、projectId、routeId、nodeId、crewId、roleId、stage、执行模式、依赖关系和产物目标，确保能力调用不是散点，而是可回放、可审计、可聚合的作业单元。

### Runtime Adapter

把统一调用请求转换为具体运行时的调用参数。首批适配 Docker 沙盒、MCP、Skill 和本地 AIGC 节点。

### Runtime Event Stream Publisher

负责把每次能力调用的开始、进度、完成、失败、产物写入统一事件流。它会发出 `capability.invoked`、`capability.completed`、`capability.failed`、`sandbox.job.started`、`sandbox.job.completed` 等事件，供 3D、HUD、日志、浏览器和回放共同消费。

### Role and Crew Context Binder

负责把每次能力调用和具体角色、团队状态绑定起来。它要求每次调用都携带 roleId、crewId、stage 和 projectId，并把执行结果回写到 RoleTimeline 与 CrewTimeline。

### Evidence Collector

负责收集执行输出、日志、产物路径、错误和摘要，并写入项目资产层。

### Safety Gate

负责校验权限、沙盒等级、网络能力和写入范围。

## 数据流

1. 路线、SPEC 节点或角色上下文提交能力调用请求。
2. Capability Planner 选择能力组合，并判断是否需要打包为 Sandbox Derivation Job。
3. Safety Gate 判断是否允许执行。
4. Runtime Event Stream Publisher 先记录作业开始与上下文信息。
5. Runtime Adapter 调用具体运行时。
6. Evidence Collector 保存执行证据，并回写产物和错误。
7. Role and Crew Context Binder 把结果写回角色时间线和团队时间线。
8. 下游菜单消费能力证据和事件流。

## 约束

- 能力调用必须能追溯到来源节点。
- 能力调用必须能追溯到来源角色和团队状态。
- 高风险能力默认需要沙盒或审批。
- 能力失败不应阻断整个项目资产链。
- 统一事件流必须保留作业级和角色级的结构化上下文。

## 测试策略

- 能力注册与过滤测试
- 沙盒执行调度测试
- 证据沉淀测试
- 事件流发布与回放测试
- 角色与团队时间线回写测试
- 安全等级校验测试
