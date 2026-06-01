---
inclusion: manual
---

# 总迁移计划：将 `web-aigc` 编排能力引入 WhyBuddy

## 目标

建立一套迁移方案，把 `web-aigc` 中可迁移的编排运行时能力引入 WhyBuddy，同时避免过早推翻 Cube 当前以 mission 为中心的运行架构。

## 迁移原则

按“能力类别”迁移，而不是按“页面逐个照搬”迁移。

这意味着：

1. 先迁移运行时契约，再迁移定义态壳层
2. 每一类节点优先映射到 Cube 现有能力底座
3. 只有当多个节点家族都依赖某个抽象时，才补新的共享层
4. 完整的图定义、版本、设计器产品化放到后续阶段

## 分阶段路线

### 阶段 0：清点与契约归一

- 盘点 `web-aigc` 的编排、设计器、节点注册表、监控接口
- 将接口逐项映射到 `whybuddy` 的 route / runtime / storage 落点
- 统一 graph、node、edge、instance、session、replay、operator action 等术语

### 阶段 1：运行时优先迁移

- 会话关联的对话运行时
- HITL 与结构化输入节点
- 检索与 QA 节点家族
- 多模态处理节点家族
- MCP 与外部工具调用
- 向量查询读路径
- 实例监控与强制终止能力

### 阶段 2：投影到 Cube 的 mission 系统

- workflow 到 mission 的投影
- graph execution snapshot 进入 replay
- 节点执行遥测
- artifact 与 session 统一

### 阶段 3：治理与运营能力

- 图执行权限模型
- 发布 / 版本 / 回滚语义
- 运行时监控看板
- 审计与 lineage 收敛

### 阶段 4：定义层产品化

- graph draft 模型
- 校验 API
- 节点 schema 注册表
- 可视化编辑器支持

## 交付结构

当前最终保留的实现文档体系是：

- 5 份 steering 文档
- 58 个 `web-aigc` 迁移 spec 目录

其中 58 个 spec 目录由两部分组成：

- 6 个平台级 spec：`web-aigc-platform-*`
- 52 个节点级 spec：`web-aigc-node-*`

每个 spec 目录都包含：

- `requirements.md`
- `design.md`
- `tasks.md`

## 文档导航

建议先从以下文档开始：

- `.kiro/steering/platform-thesis.md`
- `.kiro/steering/interface-inventory-and-mapping.md`

平台级 spec：

- `.kiro/specs/web-aigc-platform-domain-model/`
- `.kiro/specs/web-aigc-platform-runtime-engine/`
- `.kiro/specs/web-aigc-platform-mission-projection/`
- `.kiro/specs/web-aigc-platform-session-instance/`
- `.kiro/specs/web-aigc-platform-observability-audit/`
- `.kiro/specs/web-aigc-platform-security-governance/`

节点级 spec：

- `.kiro/specs/web-aigc-node-dialogue/`
- `.kiro/specs/web-aigc-node-knowledge_qa/`
- `.kiro/specs/web-aigc-node-user_input/`
- `.kiro/specs/web-aigc-node-selection/`
- `.kiro/specs/web-aigc-node-confirm_judge/`
- `.kiro/specs/web-aigc-node-mcp/`
- `.kiro/specs/web-aigc-node-auto_agent/`
- `.kiro/specs/web-aigc-node-vector_query/`

其余节点级 spec 按 `web-aigc-node-*` 目录命名统一管理。

## 迁移优先级排序

### 优先级 A：价值高、结构风险低到中等

- 对话与会话运行时
- 知识问答与检索
- 音频识别 / OCR / 图像分析类能力
- 用户输入 / 选择 / 确认判断
- 实例监控与强制终止
- MCP 与外部工具集成

### 优先级 B：价值高，但依赖新的图运行时抽象

- loop 与 condition 家族
- 节点级变量与数据变换
- vector insert / update / delete 写操作
- 图定义版本发布模型

### 优先级 C：除非产品策略变化，否则延后

- 唤醒词体系
- related app 维护壳
- 移动端 / 设备 / 地理位置壳节点
- 强依赖源系统上下文的企业内部透传 API

## 技术落点

- 图运行时状态：`shared/workflow-runtime.ts`、`server/core/workflow-engine.ts`
- workflow 入口 / 列表 / 详情 / 报告：`server/routes/workflows.ts`
- mission / operator / HITL / artifacts：`server/routes/tasks.ts`
- replay / debug / audit：`server/routes/replay.ts`
- 检索 / 向量能力：`server/routes/rag.ts`、`server/routes/knowledge.ts`
- 多模态：`server/routes/voice.ts`、`server/routes/vision.ts`
- 工具 / agent 集成：`server/routes/a2a.ts`、`server/routes/skills.ts`、`server/routes/guest-agents.ts`
- 安全 / 治理：`server/routes/permissions.ts`、`server/routes/audit.ts`、`server/routes/lineage.ts`

## 实施约束

- graph 概念必须能干净投影到 mission 记录与 replay 数据中
- 节点执行记录必须可回放、可审计
- 每个新增运行时接口都必须有 operator 可见状态模型
- UI 侧节点 schema 工作必须滞后于运行时契约，而不能反过来主导

## 退出标准

- 至少有一条端到端的 graph-capable runtime 链路能在 Cube 跑通
- 监控与回放能解释节点级发生了什么
- 至少 10 类关键 `web-aigc` 节点家族具备明确迁移路径
- 即便可视化定义层尚未落地，发布 / 版本语义也已经定义清楚
