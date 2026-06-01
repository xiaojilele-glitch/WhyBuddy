---
inclusion: manual
---

# 平台主张：在 WhyBuddy 中构建图式 Agent 运行时

## 文档目的

本文用于说明，为什么 WhyBuddy 需要吸收 `web-aigc` 中部分 AI Agent 编排能力，以及为什么迁移目标应该是“分层平台能力”，而不是一次性的页面搬运或节点复制。

## 核心判断

WhyBuddy 目前已经具备比较强的运行时底座能力：

- mission / task 运行时
- workflow 引擎
- replay 与 audit 能力
- RAG 与 knowledge 路由
- voice 与 vision 路由
- A2A 与 skill / plugin 集成

而 `web-aigc` 的优势不在于这些底座，而在于另一层能力：

- 面向图结构的编排定义
- 节点级配置 schema
- 编排实例与节点监控
- 会话关联的执行观察能力
- 覆盖对话、人工介入、检索、多模态、工具调用、向量操作等的大量节点体系

所以正确战略不是把整个 `web-aigc` 后台壳子照搬过来，而是让 WhyBuddy 变成一个“运行时优先、可承载图式编排”的 Agent Office 平台：

1. 保留 Cube 当前 mission / task / replay / audit 作为系统主记录
2. 吸收 `web-aigc` 中可迁移的编排运行时契约
3. 将完整的可视化流程定义能力延后到图运行时模型稳定之后
4. 把迁移结果沉淀为平台能力，而不是 52 个互不相关的节点克隆

## 非目标

- 第一阶段不重建完整的 `web-aigc` 编排后台 CRUD 系统
- 第一阶段不把所有节点都作为正式产品能力落地
- 不让前端节点 schema 先于服务端运行时契约失控扩张
- 不做“52 个节点，52 套孤岛 spec”的碎片化方案

## 文档与设计立场

正确的文档与实现方式应当是分层的：

- 顶层：平台主张、迁移计划、接口 inventory、ADR
- 中层：平台核心 spec
- 能力层：吸收一组节点家族的能力簇 spec
- 叶子层：只为高价值迁移对象建立节点 dossier

这样的好处是：既能保证扩展性，又不会落成“一节点一孤岛”的脆弱结构。

## 为什么 `web-aigc` 值得迁移

从已检查的源码来看，`web-aigc` 已经形成了比较清晰的三层能力分离：

- 编排定义与版本管理 API
- 设计器校验 / 执行 API
- 实例监控与会话查看 API

已检查的关键文件包括：

- `web-aigc/src/pages/aigc/orchestration/list/services/index.ts`
- `web-aigc/src/pages/aigc/orchestration/designer/services/index.ts`
- `web-aigc/src/pages/aigc/agent-monitoring/services/monitorApi.ts`
- `web-aigc/src/pages/aigc/orchestration/designer/nodes/nodeTypes.ts`

而这些能力与 Cube 现有服务端运行时接口天然存在衔接点，例如：

- `server/routes/workflows.ts`
- `server/routes/tasks.ts`
- `server/routes/replay.ts`
- `server/routes/rag.ts`
- `server/routes/voice.ts`
- `server/routes/vision.ts`
- `server/routes/knowledge.ts`
- `server/routes/a2a.ts`
- `server/routes/skills.ts`

## 产品定位

如果迁移方向正确，WhyBuddy 可以形成这样一种差异化定位：

- 不是单纯 canvas-first 的流程平台，而是 runtime-first 的 Agent 平台
- 默认具备 replay、audit、lineage、operator control
- 既能支持图式编排，又保留 mission-centric 的任务操作模型
- 对企业治理、权限、安全和运营动作更友好
- 能把底层节点流和上层 mission 执行壳连接起来

## 成功标准

- `web-aigc` 中选中的编排接口，在 Cube 中都有明确承接落点
- 平台文档优先描述可复用抽象，而不是先堆节点细节
- 后续实现可以按能力簇逐步推进，而不会频繁打碎 API
- 图式编排成为 Cube 的增强能力，而不是一套分裂出去的新产品

## 后续关联文档

- `.kiro/steering/master-migration-plan.md`
- `.kiro/steering/interface-inventory-and-mapping.md`
- `.kiro/specs/web-aigc-platform-domain-model/requirements.md`
- `.kiro/specs/web-aigc-platform-runtime-engine/requirements.md`
