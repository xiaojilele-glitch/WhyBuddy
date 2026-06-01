# 需求文档：任务自动驾驶核心概念

## 目标

定义 WhyBuddy 在“任务自动驾驶”叙事下的一组统一核心对象，用于统一产品语言、界面呈现、运行时映射与后续 specs 的边界。

本 spec 不直接定义具体界面或运行时实现，而是回答三个问题：

- 用户面对的核心对象是什么
- 这些对象之间如何形成一条可解释的任务送达链路
- 它们与现有 `mission / workflow / task` 模型如何对齐

## 需求

### 需求 1：系统应定义统一的任务自动驾驶对象词汇表

系统应统一定义以下核心对象，并给出清晰语义边界：

- `Destination`：用户真正想送达的结果目标
- `Route`：系统为到达目标生成的执行路线
- `Drive State`：任务当前所处的驾驶状态
- `Fleet`：被自动组织起来执行当前路线的角色编队
- `Takeover Point`：需要用户确认、补充或接管的关键点
- `Replan`：在偏航、受阻或目标变化时的重新规划动作
- `Confidence`：系统对当前理解、路线和结果的把握程度
- `Risk`：影响任务送达质量、成本、安全和稳定性的风险项

### 需求 2：系统应说明核心对象之间的关系

系统应明确说明：

- `Destination` 驱动 `Route` 生成
- `Route` 决定 `Fleet` 的组织方式与执行顺序
- `Drive State` 描述路线执行的实时阶段
- `Takeover Point` 是路线中的人工协同入口
- `Replan` 在当前主线中由重试恢复、阻塞避让、等待中的人工门控或显式路线改写信号触发，并以 `route.replan`、`selectionStatus = replanned` 等摘要字段对外表达
- `Confidence` 与 `Risk` 在当前主线中至少要作为共享读模型信号参与路线模式推断、解释说明、接管提示与恢复动作暴露；更强的统一治理策略可在后续 specs 继续细化

### 需求 3：系统应定义核心对象与现有 mission 模型的映射关系

系统应明确任务自动驾驶对象与现有工程模型的关系，避免直接推翻现有基座：

- `Destination` 对应上层用户目标，映射到一个或一组 `mission`
- `Route` 对应上层执行路线，映射到 `workflow` 及其阶段编排
- `Drive State` 对应用户态驾驶状态，映射到 runtime state 与流程阶段状态
- `Fleet` 对应角色化执行编队，映射到 agent、skill、node、executor 组合
- `Takeover Point` 对应人工接管点，映射到 HITL、decision、approval、input request
- `task` 继续作为更细粒度的执行单元存在，由 `Route` 和 `Fleet` 共同生成与消费

### 需求 4：系统应支持“产品对象”与“工程对象”分层共存

系统应允许：

- 产品层使用“目的地、路线、车队、驾驶状态、接管点”叙事
- 工程层继续保留 `mission / workflow / task / runtime` 术语
- 通过映射与投影连接两层，而不是先做全量重命名；当前主线以 autopilot summary / mission projection 作为主要承载

### 需求 5：系统应为后续 specs 提供统一约束

本 spec 应成为后续以下方向的前置概念约束：

- 目的地解析
- 路线规划
- 驾驶状态机
- 驾驶舱界面
- 接管面板
- 运行时编排
- 可解释性与证据链
- `route / takeover / recovery / explanation` 摘要与 projection 契约
