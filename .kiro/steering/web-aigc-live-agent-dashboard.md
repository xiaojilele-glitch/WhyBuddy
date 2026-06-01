---
inclusion: manual
---

# Web-AIGC 后台智能体实时看板

更新时间：2026-04-22
状态口径：按当前各 `worktree` 的真实落盘情况、已收到的子智能体完成通知、以及本轮并发池补位结果汇总。

## 阶段切换

当前已经从“第一段薄切片并发开发”切换到“第二阶段主仓库集成”。

这一阶段的重点不再是继续开更多分线，而是：

- 把已经完成首刀的 10 条线按顺序并回主仓库
- 先做低冲突、已成形能力的正式合流
- 再收 platform-b / platform-a / platform-c 三条平台主干
- 最后处理高风险的治理、RAG 风险动作与热路由冲突

## 为什么输入框里只看到 2 个

输入框上方的“后台智能体”区域，显示的不是“本轮所有曾经启动过的智能体”，而是当前界面里仍然保持可见、可继续 `@`、或正处于等待下一条指令状态的少数线程。

因此下面这些情况通常不会继续显示在输入框里：

- 已完成并被回收关闭的智能体
- 已完成但不再处于“等待指示”状态的线程
- 仍在后台运行、但没有进入当前输入框快捷显示列表的线程

如果要看全量状态，不要只看输入框上方那 2 个，而要看这份看板。

## 总体进度

- 功能线总数：`10`
- 已全部起刀并有代码落盘：`10 / 10`
- 已完成第一段可用薄切片：`10 / 10`
- 已并入主仓并完成定向验证的能力线：`4 / 10`
- 已并入主仓并完成定向验证的平台底座薄切片：`2 / 3`
- 已进入第二阶段主线集成：`是`
- 当前主要共性阻塞：多数 `worktree` 缺少完整本地依赖，导致很多线只能做到“代码完成 + 测试补齐”，但无法正式跑 `vitest` / `tsc`

其中当前已经在主仓完成落地并通过验证的是：

- `multimodal-output`
- `content-processing`
- `controlflow`
- `platform-a` 的低风险 runtime / graph projection 兼容底座
- `platform-b` 的 mission / session / projection links 主干

## 最新后台只读结论

### 可优先合流

- `multimodal-output`
- `content-processing`
- `controlflow`

### 平台主干建议顺序

- `platform-b`
- `platform-a`
- `platform-c`

### 需要对账式收口

- `tools-and-agents`
- `risk-actions`

说明：
- 这两条线在主仓库里已经出现了部分先行兼容改动，后续要以主仓库当前状态为准做补差，而不是整分支机械搬运。

### 后置的中高冲突能力

- `hitl-session`
- `dialogue-qa`

## 全量执行面

| 能力线 | Worktree | 分支 | 当前状态 | 验证状态 | 最近产出 |
| --- | --- | --- | --- | --- | --- |
| main-control | `whybuddy-web-aigc-0-main-control` | `chore/web-aigc-main-control` | 总控保留 | 不适用 | 不承担功能开发 |
| platform-a | `whybuddy-web-aigc-1-platform-a` | `feat/web-aigc-platform-a` | 已并入主仓底座薄切片并验证通过 | runtime / graph projection 定向测试通过，`node --run check` 已通过 | 统一 workflow domain/runtime、runtime routes、server/shared tests |
| platform-b | `whybuddy-web-aigc-2-platform-b` | `feat/web-aigc-platform-b` | 已并入主仓底座薄切片并验证通过 | `mission-store`、`mission-routes` 与相关 workflow 回归测试通过，`node --run check` 已通过 | mission/session projection links、`/api/tasks/:id/projection`、`/api/tasks/:id/session` |
| platform-c | `whybuddy-web-aigc-3-platform-c` | `feat/web-aigc-platform-c` | 已完成首刀，待后续收口 | 测试文件已补，正式运行受依赖阻塞 | governance gate、permission audit 镜像主审计链、`/api/audit` |
| dialogue-qa | `whybuddy-web-aigc-4-dialogue-qa` | `feat/web-aigc-dialogue-qa` | 已完成首刀，待后续收口 | 测试文件已补，正式运行受依赖阻塞 | `llm/dialogue` 与 `knowledge_qa` 兼容执行入口 |
| hitl-session | `whybuddy-web-aigc-5-hitl-session` | `feat/web-aigc-hitl-session` | 已完成首刀，待后续收口 | 测试文件已补，正式运行受依赖阻塞 | `DecisionPanel`、`DecisionHistory`、mission client、decision metadata |
| content-processing | `whybuddy-web-aigc-6-content-processing` | `feat/web-aigc-content-processing` | 已并入主仓并验证通过 | `4` 个路由兼容测试通过，`node --run check` 已通过 | `document_search + fragment_search` RAG adapter |
| multimodal-output | `whybuddy-web-aigc-7-multimodal-output` | `feat/web-aigc-multimodal-output` | 已并入主仓并验证通过 | `10` 个测试通过，`node --run check` 已通过 | OCR provider、vision output artifact、`POST /api/vision/ocr`、下载接口 |
| tools-and-agents | `whybuddy-web-aigc-8-tools-and-agents` | `feat/web-aigc-tools-and-agents` | 已完成首刀，待后续收口 | 测试文件已补，正式运行受依赖阻塞 | `auto_agent` adapter、`/api/a2a/auto-agent`、skills/guest-agents execute |
| controlflow | `whybuddy-web-aigc-9-controlflow` | `feat/web-aigc-controlflow` | 已并入主仓并验证通过 | 图投影定向测试通过，`node --run check` 已通过 | `start / variable_assignment / condition / end` controlflow adapter |
| risk-actions | `whybuddy-web-aigc-10-risk-actions` | `feat/web-aigc-risk-actions` | 已完成首刀，待后续收口 | 测试文件已补，正式运行受依赖阻塞 | `vector_insert` risk action route、adapter、database checker、RAG ingest 接线 |

## 已完成首刀的 9 条线

### 1. platform-a

目标：先打通统一 domain/runtime 底座，让后续节点 adapter 有共享状态语义和最小执行引擎。

关键文件：

- [shared/workflow-domain.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-1-platform-a/shared/workflow-domain.ts)
- [shared/workflow-runtime-engine.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-1-platform-a/shared/workflow-runtime-engine.ts)
- [server/core/workflow-runtime-engine.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-1-platform-a/server/core/workflow-runtime-engine.ts)
- [server/routes/workflows.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-1-platform-a/server/routes/workflows.ts)

当前状态：低风险底座已经并入主仓并完成定向验证，新增 runtime-definition/runtime-state/runtime/run/runtime/resume 路由、共享状态映射与 runtime engine 测试；更高冲突的热路由收口放到后续阶段。

### 2. platform-b

目标：把 mission / workflow / session / monitoring 的链接关系从临时拼装升级为持久 projection links。

关键文件：

- [server/tasks/mission-projection.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-2-platform-b/server/tasks/mission-projection.ts)
- [shared/mission/projection.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-2-platform-b/shared/mission/projection.ts)
- [server/routes/tasks.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-2-platform-b/server/routes/tasks.ts)
- [server/memory/session-store.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-2-platform-b/server/memory/session-store.ts)

当前状态：已经并入主仓并完成定向验证，新增 mission projection 契约、projection 持久化、`GET /api/tasks/:id/projection` 与 `GET /api/tasks/:id/session` 两个只读收口接口。

### 3. platform-c

目标：补上最小治理闭环，让高风险操作真正经过 governance gate，并能进入主审计链。

关键文件：

- [server/permission/governance-policy.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-3-platform-c/server/permission/governance-policy.ts)
- [server/permission/check-engine.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-3-platform-c/server/permission/check-engine.ts)
- [server/permission/audit-logger.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-3-platform-c/server/permission/audit-logger.ts)
- [server/tests/permission-governance-audit-routes.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-3-platform-c/server/tests/permission-governance-audit-routes.test.ts)

当前状态：已完成第一段闭环，已经把 `/api/audit` 接入主 server，并新增治理审计事件。

### 4. dialogue-qa

目标：不碰平台主执行链，先把 `llm/dialogue` 和 `knowledge_qa` 接成兼容执行入口。

关键文件：

- [server/routes/node-adapters/chat-node-adapter.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-4-dialogue-qa/server/routes/node-adapters/chat-node-adapter.ts)
- [server/routes/node-adapters/knowledge-node-adapter.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-4-dialogue-qa/server/routes/node-adapters/knowledge-node-adapter.ts)
- [server/routes/chat.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-4-dialogue-qa/server/routes/chat.ts)
- [server/routes/knowledge.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-4-dialogue-qa/server/routes/knowledge.ts)

当前状态：已完成第一段闭环。

### 5. hitl-session

目标：先把 `user_input / selection` 薄切片接进现有任务详情决策链。

关键文件：

- [client/src/components/tasks/DecisionPanel.tsx](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-5-hitl-session/client/src/components/tasks/DecisionPanel.tsx)
- [client/src/components/tasks/DecisionHistory.tsx](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-5-hitl-session/client/src/components/tasks/DecisionHistory.tsx)
- [client/src/lib/mission-client.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-5-hitl-session/client/src/lib/mission-client.ts)
- [server/tasks/mission-decision.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-5-hitl-session/server/tasks/mission-decision.ts)

当前状态：已完成第一段闭环，能够保留 `sessionId / interactionId / branchKey / formData` 等 HITL metadata。

### 6. content-processing

目标：先用现有 RAG 检索做 `document_search + fragment_search` 兼容 adapter。

关键文件：

- [server/rag/web-aigc-search-adapter.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-6-content-processing/server/rag/web-aigc-search-adapter.ts)
- [shared/rag/web-aigc-search.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-6-content-processing/shared/rag/web-aigc-search.ts)
- [server/routes/rag.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-6-content-processing/server/routes/rag.ts)
- [server/tests/rag-web-aigc-routes.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-6-content-processing/server/tests/rag-web-aigc-routes.test.ts)

当前状态：已完成第一段闭环。

### 7. multimodal-output

目标：选 `ocr_recognition` 做第一条真正跑通的多模态闭环。

关键文件：

- [server/core/ocr-provider.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-7-multimodal-output/server/core/ocr-provider.ts)
- [server/core/vision-output.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-7-multimodal-output/server/core/vision-output.ts)
- [server/routes/vision.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-7-multimodal-output/server/routes/vision.ts)
- [server/tests/vision-routes.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-7-multimodal-output/server/tests/vision-routes.test.ts)

当前状态：已经并入主仓并完成定向验证，而且验证最完整：

- `3` 个测试文件
- `10` 个测试通过
- `node --run check` 通过

### 8. tools-and-agents

目标：选 `auto_agent` 打一条最薄的 agent/tool 调用闭环。

关键文件：

- [server/tool/api/auto-agent-adapter.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-8-tools-and-agents/server/tool/api/auto-agent-adapter.ts)
- [server/routes/a2a.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-8-tools-and-agents/server/routes/a2a.ts)
- [server/routes/skills.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-8-tools-and-agents/server/routes/skills.ts)
- [server/routes/guest-agents.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-8-tools-and-agents/server/routes/guest-agents.ts)

当前状态：主仓已存在 `auto_agent` 最小闭环及相关测试，后续重点不是整分支搬运，而是按 `mcp / internal_api / passthrough_api / message_notification` 做对账式补差收口。

### 9. controlflow

目标：选 `start / variable_assignment / condition / end` 做最小控制流 adapter。

关键文件：

- [server/core/web-aigc-controlflow.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-9-controlflow/server/core/web-aigc-controlflow.ts)
- [server/core/workflow-graph-projection.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-9-controlflow/server/core/workflow-graph-projection.ts)
- [shared/workflow-graph.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-9-controlflow/shared/workflow-graph.ts)
- [server/tests/workflow-graph-projection.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-9-controlflow/server/tests/workflow-graph-projection.test.ts)

当前状态：已经并入主仓并完成定向验证，主仓图投影现在可以直接识别 Web-AIGC `start / variable_assignment / condition / end` 控制流节点，并投影 `control_flow` 分支边。

### 10. risk-actions

目标：先从高风险动作里选 `vector_insert` 做最小闭环，复用现有 RAG ingest、permission check engine 和 permission audit。

关键文件：

- [shared/web-aigc-risk-actions.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-10-risk-actions/shared/web-aigc-risk-actions.ts)
- [server/web-aigc/vector-insert-adapter.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-10-risk-actions/server/web-aigc/vector-insert-adapter.ts)
- [server/routes/web-aigc-risk-actions.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-10-risk-actions/server/routes/web-aigc-risk-actions.ts)
- [server/tests/vector-insert-adapter.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-10-risk-actions/server/tests/vector-insert-adapter.test.ts)
- [server/tests/web-aigc-risk-actions-routes.test.ts](/C:/Users/wangchunji/Documents/whybuddy-web-aigc-10-risk-actions/server/tests/web-aigc-risk-actions-routes.test.ts)

当前状态：已完成第一段闭环，已经打通 `POST /api/rag/risk-actions/vector-insert`，并把 namespace/collection 隔离、permission resource 解析、RAG ingest 接线都串起来了。

## 当前最强与最弱

### 进度最扎实

`multimodal-output`、`content-processing`、`controlflow`、`platform-b`

原因：

- 都已经并入主仓
- 都已经完成定向自动化验证
- 都已经通过 `node --run check`

### 当前最值得继续盯

`platform-b`、`platform-a`、`platform-c` 之后的统一收口与集成验证

原因：

- 现在 10 条功能线都已经完成首刀，最大短板已经不再是“有没有开始做”
- 下一阶段价值最高的是把 runtime / mission projection / governance 三条平台主干与 7 条节点能力继续收敛起来

## 主要共性阻塞

大多数线都遇到了同一个问题：

- `worktree` 下缺本地依赖
- `vitest` / `tsc` / `pnpm` 不完整
- 所以很多线停在“代码写完 + 测试补齐 + 无法正式运行”

这意味着当前主要瓶颈已经不是“没人开发”，而是“验证环境不一致”。

## 第二阶段当前决策

本轮实际执行口径如下：

1. 先补齐中文第二阶段集成计划。
2. 先把共享语义和低冲突层收进主仓库，降低后续冲突。
3. 然后按以下顺序推进：
   - `multimodal-output`
   - `content-processing`
   - `controlflow`
   - `platform-b`
   - `platform-a`
   - `platform-c`
   - `hitl-session`
   - `dialogue-qa`
   - `tools-and-agents`
   - `risk-actions`

## 结论

当前不是“58 个 spec 还在规划”，而是已经进入真实的分线开发阶段。

截至这次更新：

- `10 / 10` 功能线已起刀
- `10 / 10` 功能线已完成第一段可用薄切片
- `4 / 10` 能力线已并入主仓并正式跑通验证
- `2 / 3` 平台底座薄切片已并入主仓并正式跑通验证
- 当前最需要盯的是后续统一收口/集成验证，以及依赖环境补齐后的批量验证
