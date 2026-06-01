# 任务清单：任务自动驾驶平台定位

- [x] 确认对外一句话定义，并同步到 README、README.zh-CN、项目概览和对外演示材料的统一口径
- [x] 输出任务自动驾驶平台与 chat playground 的对比表，明确核心对象、默认路径和用户心智差异
- [x] 输出任务自动驾驶平台与 workflow builder 的对比表，明确“系统规划”与“人工搭图”的边界
- [x] 输出任务自动驾驶平台与 agent platform 的对比表，明确“能力市场”与“任务送达”的区别
- [x] 梳理现有 `mission-first` 术语与 `destination / route / drive state / takeover` 产品术语的映射关系
- [x] 定义平台当前能力边界与禁止过度承诺的表达清单
- [x] 为后续 `L1-L5` 自动驾驶分级 spec 预留产品承诺边界，避免在定位阶段直接宣称全自动
- [x] 形成可复用的产品定位摘要，供后续驾驶舱、路线规划、接管交互等 specs 引用

## 审计说明（2026-04-24）

本轮仅依据 `README.md`、`README.zh-CN.md`、`.kiro/steering/project-overview.md`、`.kiro/steering/task-autopilot-spec-roadmap-2026-04-23.md`、`.kiro/steering/task-autopilot-platform-narrative-2026-04-23.md` 的现有口径做保守勾选。

本轮勾选项在 `design.md` 中已有直接落点：

- “与 Chat Playground 的对比表”对应 `2.1 与 Chat Playground 的差异` 下的结构化对比表。
- “与 Workflow Builder 的对比表”对应 `2.2 与 Workflow Builder 的差异` 下的结构化对比表。
- “mission-first -> destination / route / drive state / takeover 映射”对应 `3. 与 mission-first 的关系` 下的映射表。
- “平台边界与禁止过度承诺”对应 `4. 平台边界` 与 `5. 对外表达约束` 下的边界表和表达约束表。
- “可复用的产品定位摘要”对应 `6. 可复用定位摘要`。

暂不勾选的条目：

- “确认对外一句话定义，并同步到 README、README.zh-CN、项目概览和对外演示材料的统一口径”：README、README.zh-CN 与项目概览已基本对齐，但本轮未直接核对“对外演示材料”。
- “输出任务自动驾驶平台与 agent platform 的对比表，明确‘能力市场’与‘任务送达’的区别”：相关差异说明已出现在 narrative 补充文档中，但尚未确认已经成为 README / 项目概览同等级的统一主口径，因此本轮不冒进勾选。

## 补充审计说明（2026-04-25）

本轮新增核对了 `README.md`、`README.zh-CN.md` 与 `.kiro/steering/project-overview.md` 的主口径，并在 `design.md` 的 `2.3 与 Agent Platform 的差异` 下补齐结构化对比表。

因此新增保守勾选：

- “输出任务自动驾驶平台与 agent platform 的对比表，明确‘能力市场’与‘任务送达’的区别”：现在同时具备 design 直接落点，以及 README / README.zh-CN / 项目概览三处主文档的一致支撑。

仍暂不勾选：

- “确认对外一句话定义，并同步到 README、README.zh-CN、项目概览和对外演示材料的统一口径”：尽管 README、README.zh-CN 与项目概览已对齐，但“对外演示材料”仍未在本轮获得直接审计证据。

## 收口审计说明（2026-04-26，lane 6）

- 本轮重新核对了 `README.md`、`README.zh-CN.md`、`.kiro/steering/project-overview.md` 与本 spec 的现有口径，确认此前并非“完全一致”，而是存在同义但不完全同句的表述。
- 现已统一收口为同一条对外一句话定义：
  - `WhyBuddy` 是一个面向复杂任务的任务自动驾驶平台：用户输入目标、查看路线，让系统执行安全部分，并在人类判断必需时接管。
- 直接落点如下：
  - `design.md` 的 `1. 平台定义`
  - `README.md` 顶部 hero 文案
  - `README.zh-CN.md` 顶部 hero 文案
  - `.kiro/steering/project-overview.md` 的“项目定位”起始句
- 关于“对外演示材料”：
  - 当前仓库中可直接核到的对外演示入口是 `README.md` / `README.zh-CN.md` 顶部 `Live Demo / 在线演示` 链接所指向的公开演示页入口。
  - 在本轮允许修改范围内，没有单独、独立于 README 的演示主文案文件可供同步；因此以 README hero 文案作为当前仓库内最直接、最稳定的演示口径承载点。
- 基于以上对账与同步，这一项现在可以保守转为已完成。
