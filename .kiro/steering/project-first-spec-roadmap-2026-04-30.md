# Project-First Spec Roadmap（2026-04-30）

## 2026-05-21 进度更新

Project-first 系列 `10/10` specs 已全部完成，`123/123` 任务项已封板。本路线图中描述的四个阶段开发范围仍然有效，作为后续深化实现的参考。

> 全仓体量脚注（`2026-05-28`）：上述 `10/10` 与 `123/123` 仅指 Project-first 系列；同期全仓 `.kiro/specs/` 目录共 `287` 个，Tasks checkbox 勾选率 `7,887 / 8,806`（`89.6%`）。

详见：`.kiro/steering/specs-progress-snapshot-2026-05-21.md`

## 一句话方向

`WhyBuddy` 下一阶段从“任务发起工具 / 任务自动驾驶平台”升级为“项目级 AI 自动驾驶操作系统”：

```text
创建项目 -> 项目问答与澄清 -> Spec 演化 -> FSD 路线规划 -> 角色执行 -> 证据和产物沉淀 -> 下一轮演化
```

## 本轮创建的 specs

| 顺序 | Spec | 优先级 | 目标 |
| ---- | ---- | ---- | ---- |
| 1 | `.kiro/specs/project-first-product-architecture/` | P0 | Project-first 总纲，定义产品主线和边界 |
| 2 | `.kiro/specs/project-domain-model/` | P0 | 建立 Project、Message、Spec、Route、Mission、Artifact、Evidence 领域模型 |
| 3 | `.kiro/specs/project-cockpit-home/` | P0 | 将首页收敛为当前项目驾驶舱 |
| 4 | `.kiro/specs/project-scoped-composer/` | P0 | 将统一发起器改为当前项目继续推进入口 |
| 5 | `.kiro/specs/project-clarification-conversation/` | P0 | 将补问升级为项目内澄清和上下文沉淀 |
| 6 | `.kiro/specs/project-execution-center/` | P0 | 将任务中心降级并升级为项目执行明细与接管中心 |
| 7 | `.kiro/specs/project-spec-center/` | P1 | 建立项目 spec 版本、来源、diff 和完整度 |
| 8 | `.kiro/specs/project-fsd-route-planner/` | P1 | 基于项目 spec 生成主路线、备选路线、保守路线 |
| 9 | `.kiro/specs/project-evidence-artifact-replay/` | P1 | 建立项目级证据、产物和回放闭环 |

## 第一阶段建议开发范围

第一阶段不要做完整大平台，先打通项目主线最小闭环：

```text
Project Domain
  -> Project Cockpit Home
  -> Project-scoped Composer
  -> ProjectMission 关联
  -> Project Execution Center 过滤
```

第一阶段可先完成：

- 项目创建、选择、localStorage 持久化
- 首页无项目 / 有项目状态
- 输入框带 `projectId`
- 用户输入写入 `ProjectMessage`
- 新建任务后写入 `ProjectMission`
- 任务中心按当前项目过滤
- 任务操作写入 `ProjectEvidence`

## 第二阶段建议开发范围

```text
Clarification
  -> Spec Center
  -> Spec source
  -> Spec completeness
```

第二阶段可先完成：

- 澄清问题项目化
- 澄清回答写入 project message / evidence
- 生成第一版 Markdown spec
- spec 版本历史
- spec 来源追踪
- 首页展示当前 spec 摘要

## 第三阶段建议开发范围

```text
Spec
  -> FSD Route Planner
  -> Route selection
  -> Mission plan
```

第三阶段可先完成：

- 推荐 / 快速 / 深度 / 保守路线
- 路线卡片展示
- 用户选择路线
- 选择路线后创建 mission
- mission 带 `projectId` / `specId` / `routeId`
- 任务详情展示 route 和 FSD 角色关系

## 第四阶段建议开发范围

```text
Runtime / Docker / GitHub research
  -> Artifact
  -> Evidence
  -> Replay
  -> Spec update suggestion
```

第四阶段可先完成：

- Docker / Browser / Native runtime 产物回流项目
- SVG、报告、代码、日志作为 project artifact
- replay timeline 最小版本
- 执行失败生成 replan 建议
- 执行结果生成 spec update suggestion

## 后置 specs

本轮暂不创建完整 spec，后续需要时再拆：

- Runtime / Docker Agent Execution Spec
- Key Pool / Agent Pool Spec
- Permissions / Multi-user Spec
- Data Source / Knowledge Base Projectization Spec

## 关键边界

- 不要再加入口，要开始加主线。
- 用户看项目，不看节点。
- 用户看路线，不看 DAG。
- `50+ AIGC 节点` 是 FSD 角色内置能力，不作为独立入口层。
- Workflow / Docker 是执行承载，不是产品主对象。
- 首页克制，任务中心承接执行细节。

