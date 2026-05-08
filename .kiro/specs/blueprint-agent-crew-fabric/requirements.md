# 需求文档：伴随式 Agent Crew

## 简介

本规格定义 `/autopilot` 中横向贯穿全流程的 **伴随式 Agent Crew**。它不是某个阶段的执行器，也不是 60+ AIGC 节点的工具列表，而是把角色、能力、阶段、事件和资产沉淀串起来的组织层。

核心原则是：

> AIGC 节点不直接面对用户，节点是角色的能力；角色才是用户感知到的执行主体。

因此系统应采用三层抽象：

```text
角色 Role
  ↓ 拥有
能力 Capability
  ↓ 调用
AIGC Node / Docker / MCP / Skills / Browser / GitHub / SVG / Docs
```

## 术语表

- **AgentCrew**：一次自动驾驶任务中组建的多角色团队。
- **AgentRole**：长期陪跑的角色，例如产品决策者、架构师、执行者、审计者、规格工程师、UI 预演师、记忆管理员。
- **RoleCapability**：绑定到角色身上的能力，可以由 AIGC 节点、Docker、MCP、Skills 或本地工具实现。
- **CapabilityBinding**：角色、能力、阶段、输入输出、证据和审计规则之间的绑定关系。
- **RolePresenceState**：角色在某阶段的参与状态，包括 `active`、`watching`、`reviewing`、`sleeping`。
- **StageActivationPolicy**：决定每个阶段激活哪些角色、哪些角色观察、哪些角色审计、哪些角色待命的策略。
- **RoleTimeline**：记录角色从输入到工程落地的参与轨迹。

## 需求

### 需求 1：定义伴随式角色目录

**用户故事：** 作为用户，我希望看到的是一个 AI 项目团队在陪我推进，而不是一堆无名节点在后台运行。

#### 验收标准

1.1 系统 SHALL 定义稳定的 AgentRole 目录，至少包含决策、规划、执行、审计、表现和记忆六类角色。
1.2 每个 AgentRole SHALL 包含 id、名称、职责、默认参与阶段、权限边界和可见展示名。
1.3 系统 SHALL 允许同一个角色从澄清阶段持续跟踪到工程落地阶段。
1.4 系统 SHALL 将角色展示给用户时使用产品化身份，例如“产品决策者”“架构师”“审计者”，而不是展示底层节点编号。

### 需求 2：建立角色能力矩阵

**用户故事：** 作为系统，我希望 60+ AIGC 节点都能挂到对应角色身上，由角色在合适阶段按需调用。

#### 验收标准

2.1 系统 SHALL 定义 RoleCapability，并支持绑定 AIGC Node、Docker、MCP、Skills、GitHub、Browser、SVG、文档生成和检索能力。
2.2 每个 RoleCapability SHALL 声明输入结构、输出结构、适用阶段、是否需要沙盒、是否产生资产和审计规则。
2.3 系统 SHALL 禁止前端把底层节点平铺成工具列表；前端应通过角色状态和角色产物感知能力调用。
2.4 系统 SHALL 支持一个能力被多个角色复用，但每次调用必须保留 roleId 和 capabilityId。

### 需求 3：按阶段激活角色

**用户故事：** 作为产品负责人，我希望多角色全程在场，但每一步只激活必要角色，避免成本和复杂度失控。

#### 验收标准

3.1 系统 SHALL 为每个 AutopilotStage 定义 StageActivationPolicy。
3.2 系统 SHALL 支持 `active`、`watching`、`reviewing`、`sleeping` 四种角色参与状态。
3.3 系统 SHALL 在澄清、路线、SPEC Tree、规格文档、效果预演、实现提示词、工程落地等阶段使用不同角色组合。
3.4 系统 SHALL 支持基于风险、成本、用户选择和项目复杂度调整角色激活权重。
3.5 系统 SHALL 明确“在场不等于全部执行”，避免每个阶段都真实调用全部能力。

### 需求 4：角色事件接入统一事件流

**用户故事：** 作为用户，我希望 3D、HUD、日志和浏览器显示的是同一组角色正在推进同一件事，而不是多个面板各自刷新。

#### 验收标准

4.1 系统 SHALL 为角色状态变化发出 role.* 事件，例如 `role.activated`、`role.watching`、`role.review_started`、`role.completed`。
4.2 每条 role.* 事件 SHALL 包含 jobId、projectId、stage、roleId、presenceState、capabilityId、artifactId 和 evidenceId。
4.3 系统 SHALL 允许 3D 场景、HUD、日志、浏览器和 SPEC UI 订阅同一条角色事件流。
4.4 系统 SHALL 支持从任意产物反查参与过的角色、能力和证据。

### 需求 5：支持角色审计与交接

**用户故事：** 作为用户，我希望关键节点不是自动蒙混过关，而是由合适的角色给出审计、接管和继续建议。

#### 验收标准

5.1 系统 SHALL 在 route selection、SPEC Tree reviewing、文档接受、预演接受、提示词导出和工程落地前触发角色审计。
5.2 审计角色 SHALL 输出风险、遗漏、一致性、成本、可执行性和证据完整性评估。
5.3 系统 SHALL 将审计结论绑定到 RouteSet、SpecTree、SpecDocument、EffectPreview 或 PromptPackage。
5.4 系统 SHALL 在 `reviewing` 状态展示当前审计角色、结论摘要和下一步动作。

### 需求 6：沉淀角色伴随时间线

**用户故事：** 作为项目成员，我希望回看一次自动驾驶时，能看到每个角色在什么时候做了什么判断、调用了什么能力、产出了什么资产。

#### 验收标准

6.1 系统 SHALL 保存 RoleTimeline，记录每个角色的参与阶段、状态变化、能力调用和产物。
6.2 系统 SHALL 支持按角色、阶段、节点、产物和时间线查询角色轨迹。
6.3 系统 SHALL 支持在回放中恢复当时的角色状态、HUD 摘要和日志片段。
6.4 系统 SHALL 允许下一轮推导复用上一轮角色结论和审计结果。

### 需求 7：前端展示多角色伴随状态

**用户故事：** 作为用户，我希望页面明确告诉我当前是哪几个角色在工作、谁在观察、谁在审计、谁在待命。

#### 验收标准

7.1 `/autopilot` SHALL 展示当前激活角色、观察角色、审计角色和待命角色。
7.2 系统 SHALL 展示角色当前动作，例如“产品决策者正在澄清目标”“架构师正在分析 GitHub 结构”“审计者正在检查风险”。
7.3 系统 SHALL 支持按阶段查看角色参与矩阵。
7.4 系统 SHALL 将角色状态和 3D 场景角色、HUD 状态、日志摘要保持一致。

### 需求 8：区分 crew 事件与 capability 事件

**用户故事：** 作为系统，我希望能把“团队在做什么”和“某个能力在做什么”分开记录，这样前端和回放就不会把组织层和能力层混成一团。

#### 验收标准

8.1 系统 SHALL 定义 `crew.started`、`crew.updated`、`crew.reviewing`、`crew.completed` 等 crew.* 事件。
8.2 系统 SHALL 定义 `capability.invoked`、`capability.completed`、`capability.failed` 等 capability.* 事件。
8.3 每条 crew.* 事件 SHALL 包含 crewId、stage、roleIds、presenceSummary、artifactIds 和 evidenceIds。
8.4 每条 capability.* 事件 SHALL 包含 roleId、capabilityId、nodeId、stage、inputSummary、outputSummary 和 evidenceId。
8.5 系统 SHALL 让 crew.* 事件驱动“团队状态”，让 capability.* 事件驱动“执行细节”。
