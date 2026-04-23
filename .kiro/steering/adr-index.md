# 图编排迁移 ADR 索引

## 文档目的

本索引用于跟踪把 `web-aigc` 编排能力并入 Cube Pets Office 过程中需要做出的关键架构决策。

## 已规划 ADR

### ADR-001：优先做运行时迁移，而不是优先做设计器迁移

- 状态：提议中
- 原因：Cube 当前最大的优势已经在 mission / runtime / replay 一侧

### ADR-002：图执行必须投影进 mission / task 系统

- 状态：提议中
- 原因：避免出现两套彼此平行的执行宇宙

### ADR-003：节点按能力簇迁移，而不是 52 个节点各自孤立迁移

- 状态：提议中
- 原因：减少重复设计，增强后续扩展性

### ADR-004：监控应以 workflow instance + node execution record 为主模型

- 状态：提议中
- 原因：既吸收 `web-aigc` 的实例监控价值，又保留 Cube 的 replay 体系

### ADR-005：会话 transcript 必须是一等运行时资产

- 状态：提议中
- 原因：对话节点与监控节点都依赖它

### ADR-006：向量查询优先于向量写操作迁移

- 状态：提议中
- 原因：读路径风险更低，且能更快产生价值

### ADR-007：流程校验与节点 schema 注册表属于第 4 阶段问题

- 状态：提议中
- 原因：运行时契约必须先稳定，再让定义层跟上

### ADR-008：图的发布 / 版本 / 恢复生命周期必须挂接审计与回放

- 状态：提议中
- 原因：避免运行定义悄悄漂移而没有可追踪证据

## ADR 推荐格式

后续每一份正式 ADR 建议都至少包含：

- 背景
- 决策内容
- 被考虑过的替代方案
- 带来的后果
- 受影响的 API 与存储模型

## Web-AIGC 主线 Steering 索引

以下文档用于记录 Web-AIGC 从“主线入口接线完成”转入“下一批主线收敛工作”的中文 steering 口径。它们属于 steering / 批次文档，不是正式 ADR。

- `.kiro/steering/web-aigc-phase-2-integration-plan.md`：第二阶段总口径，说明已完成基线与下一阶段五条工作线
- `.kiro/steering/web-aigc-next-phase-mainline-plan-2026-04-22.md`：下一阶段主线计划与优先级
- `.kiro/steering/web-aigc-mainline-enhancement-batch-2026-04-23.md`：当前批次收口纪要与下一批执行项

## 相关 spec

- `.kiro/specs/web-aigc-platform-domain-model/design.md`
- `.kiro/specs/web-aigc-platform-runtime-engine/design.md`
- `.kiro/specs/web-aigc-platform-security-governance/design.md`
