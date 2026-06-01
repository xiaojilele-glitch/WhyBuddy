# 任务清单：车队组织与角色封装

- [x] 定义 `Fleet` 的统一产品层语义，明确其与 `Route`、`Drive State`、`Takeover` 的关系
- [x] 定义首轮稳定车队角色集合，包括 `Planner`、`Clarifier`、`Researcher`、`Operator`、`Generator`、`Reviewer`、`Auditor`、`Coordinator`
- [x] 为每个车队角色补齐职责边界、典型输入、典型输出、典型风险和典型接管点说明
- [x] 定义 `FleetComposition` 结构，用于表达某一时刻或某一路线阶段的车队编组快照
- [x] 定义 `FleetRolePackage` 结构，明确角色标识、职责、状态、阶段关联、输入输出契约和底层关联字段
- [x] 定义 `CapabilityPackage` 结构，明确 skill、tool、MCP、policy、executor preference 等能力如何组成角色能力包
- [x] 定义 `ExecutionUnitRef` 结构，明确 agent、node、executor、task 等执行单元如何被角色引用
- [x] 定义 `AttachmentRef` 结构，明确 skill、tool、MCP、policy、memory、evidence 等附着能力如何表达
- [x] 梳理 `agent -> role carrier` 的映射规则，明确 agent 在角色封装中的承载方式
- [x] 梳理 `node -> role action` 的映射规则，明确节点在用户语义中更适合作为角色动作还是阶段动作
- [x] 梳理 `executor -> role actuator` 的映射规则，明确执行器如何作为角色的执行装置而不是一级角色
- [x] 梳理 `skill / tool / MCP -> role attachment` 的映射规则，明确附着能力的统一包装方式
- [x] 定义无法稳定归类时的回退策略，包括 `Generalist`、`Composite` 或 `Custom` 等保守角色类型
- [x] 形成一版节点家族到角色家族的初步分类表，覆盖常见 Web-AIGC 节点类别
- [x] 形成一版角色能力包目录，明确研究、生成、执行、复核、治理等常见能力包模板
- [x] 定义 `Route -> Fleet` 的投影规则，明确路线模板、阶段、分支和重规划如何影响车队编组
- [x] 定义 `Drive State -> role status` 的投影规则，明确角色状态如何与高层驾驶状态联动
- [x] 定义 `Takeover` 与角色的关系，明确哪些角色更接近澄清、审批、权限、预算、结果验收和异常接管
- [x] 定义 `RoleRiskProfile` 和 `RoleTakeoverProfile` 的最小结构，用于承接风险和接管语义
- [x] 明确 `Fleet` 与现有 `mission-first / workflow / runtime / task / audit / replay` 的兼容分层关系
- [x] 输出一版从 `mission + workflow + runtime` 投影生成 `FleetComposition` 的流程说明
- [x] 明确哪些角色字段应由服务端 projection 层生成，哪些字段可由前端 view model 补充
- [x] 设计角色摘要对象在驾驶舱、车队状态视图、接管面板和回放视图中的复用口径
- [x] 明确角色卡默认展示字段与展开字段，避免节点、工具、执行器在主视图中平铺泄露
- [x] 梳理与 `dynamic-role-system` 的边界，明确上层车队角色封装与底层角色模板机制的关系
- [x] 梳理与 `fleet-status-and-live-execution-view` 的边界，明确本 spec 负责角色组织模型，对方负责执行主视图投影
- [x] 梳理与 `mission-model-to-autopilot-model-mapping` 的边界，明确本 spec 负责 `Fleet` 这一映射分支的细化
- [x] 补充单角色单线任务、多角色并行任务、接管任务、重规划任务四类示例编组
- [x] 设计角色封装层的单元测试计划，覆盖归类、回退、追溯、阶段切换和展示摘要稳定性
- [x] 设计与 runtime 兼容的集成测试计划，覆盖真实 agent、node、executor 状态投影到角色层的关键场景
- [x] 评估渐进落地顺序，明确先做角色词汇表、再做映射表、再做 projection、最后接入前端主视图的实施路径

## 审计备注（2026-04-24）

- 本次勾选仅按当前主仓已落地代码与测试保守确认，不代表完整 `FleetRolePackage` / `CapabilityPackage` / `ExecutionUnitRef` / `AttachmentRef` 方案已实现。
- `Drive State -> role status` 已有真实投影链路：`shared/mission/autopilot.ts` 通过 `inferFleetRoleStatus(...)` 和 `buildMissionAutopilotSummary(...)` 生成 `fleet.roles`，并在 waiting 场景投影为 `clarifier`、常规场景投影为 `operator`，同时输出 `activeRoleCount` / `blockedRoleCount`。
- `Fleet` 的最小统一产品层语义本轮可保守视为已收口：当前 shared/server/client 都围绕同一份 `autopilotSummary.fleet` 工作，并与同一 summary 内的 `route`、`driveState`、`takeover` 并列存在，足以支撑“Fleet 作为路线执行组织摘要层”的现行口径；但这仍是 summary 级闭环，不等于完整 `FleetComposition` 领域模型已实现。
- 服务端 projection 与前端 view model 的边界已形成最小闭环：共享层负责产出 `fleet.roles`、角色状态与计数；`client/src/lib/tasks-store.ts` 只做归一化、缺省计数补全，以及 projection 缺失时的保守 fallback（单个 `Mission Core` `operator` 角色）。
- `shared/__tests__/mission-autopilot.test.ts` 与 `client/src/lib/tasks-store.autopilot.test.ts` 进一步证明了这条最小链路：前者直接断言 shared builder 在活动 / waiting / blocked 场景下输出 `planner`、`clarifier / operator` 与可选 `executor`，后者断言 store 侧会稳定透传或补齐这些 `fleet.roles` / 计数 / fallback，但不会在前端自行发明新的角色家族。
- 本轮复核后，`定义无法稳定归类时的回退策略，包括 Generalist、Composite 或 Custom 等保守角色类型` 继续保留未勾选：当前代码只能证明两条窄回退链，一是 store 在收到未知 `roleType` 时归一为 `custom`，二是 projection 缺失时退化为单个 `Mission Core` `operator`；这足以说明兼容与降级稳定，但仍不足以证明已经定义了可复用的 `Generalist / Composite / Custom` 角色回退策略。
- 当前面板已形成角色优先的展示边界：`client/src/components/tasks/TaskAutopilotPanel.tsx` 主视图优先显示角色标题、活跃/阻塞计数和 `currentFocus`，`boundAgents` / `boundExecutors` 只作为次级明细出现；现有测试已覆盖 `Planner / Auditor / Reviewer` 与 `Planner / Operator / Executor` 等展示组合。
- 需要区分“前端可展示”与“共享投影会合成”：`TaskAutopilotPanel` 测试中的 `Planner / Auditor / Reviewer` 等组合证明面板可以稳定消费这些角色摘要，但当前 `shared/mission/autopilot.ts` 的 `buildMissionAutopilotSummary(...)` 真正稳定合成的仍主要是 `planner`、waiting 场景下的 `clarifier` / 常规场景下的 `operator`，以及 mission 带 executor 上下文时追加的 `executor`；因此本轮不把这些 UI fixture 视为完整角色家族或稳定 role package 系统已落地。
- `server/tasks/mission-projection.ts` 现已稳定以 shared `buildMissionAutopilotSummary(...)` 产出 `fleet.roles` 并透传到 `MissionProjectionView`；这使“mission + workflow + runtime -> fleet summary”不再只存在于前端推导或设计文档中，而具备 shared / server 一致的最小投影链。
- 但同样需要区分“mission projection 已接上线”与“mission projection 自己拥有独立角色打包逻辑”：当前 `server/tasks/mission-projection.ts` 的事实更接近透传 shared builder 产物，而不是额外生成一套新的 `FleetRolePackage` / `CapabilityPackage` / `ExecutionUnitRef` 体系；因此这条链路新增支撑的是 summary 级闭环，不足以把更多未勾选结构项一并认定完成。
- 结合 `shared/__tests__/mission-autopilot.test.ts`、`client/src/lib/tasks-store.autopilot.test.ts` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx`，本轮可保守新增勾选“角色封装层的单元测试计划”：当前仓库已经形成一套围绕 summary 层的最小测试矩阵，分别覆盖 shared 角色生成与阶段状态切换、store 归一化与 projection 缺失回退、以及 panel 侧展示摘要稳定性与追溯字段消费。
- 与 `dynamic-role-system` 的边界本轮可保守勾选：当前主仓闭环停留在 projection / summary 语义层，负责把既有 mission / workflow / runtime 事实组织成 `fleet.roles`；底层 role template、load/unload、切换约束仍归更底层动态角色机制处理，不属于本 spec 已实现范围。
- 与 `fleet-status-and-live-execution-view` 的边界本轮可保守勾选：当前实现已经把“角色组织摘要”与“执行主视图细节”分层，`fleet` 只承载角色标题、状态、计数、focus 与绑定摘要，而 route / execution / takeover 细节仍位于相邻投影分支与前端面板其它区块。
- 与 `mission-model-to-autopilot-model-mapping` 的边界本轮可保守勾选：当前 `shared/mission/autopilot.ts` 和 `server/tasks/mission-projection.ts` 已经把 mission -> autopilot summary 的主映射链收口到共享 builder，本 spec 只继续细化其中 `fleet` 分支的语义、字段边界和展示口径，而不是认领整条 mapping pipeline。
- 以下条目本次继续保留未勾选：首轮稳定角色全集、`executor -> role actuator`、`Coordinator / Generalist`、以及各类 package/ref 结构。原因是当前实现仍将 `executor` 作为一级 fleet role 暴露，shared/server 真实闭环尚未稳定产出 `researcher / generator / reviewer / auditor / coordinator / generalist` 等角色家族，且也尚未落成完整角色封装对象模型。
- 本轮 checkbox 审计预案复核 `shared/mission/autopilot.ts`、`server/tasks/mission-projection.ts`、`client/src/lib/tasks-store.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与对应测试后，没有新增安全项：当前代码真正稳定合成的角色仍主要是 `planner`、`clarifier / operator` 与可选 `executor`，而更多角色名称大多停留在 UI 可消费或 fixture 展示层，仍不足以保守认定首轮稳定角色全集、`executor -> role actuator`、通用 fallback 策略或 package/ref 结构已经落地。

## 审计备注（2026-04-25，lane 4 复核补充）

- 本轮围绕 `fleet / role packaging / role status / role summary` 复核 `shared/mission/autopilot.ts`、`shared/__tests__/mission-autopilot.test.ts`、`server/tasks/mission-projection.ts`、`server/tests/mission-routes.test.ts`、`client/src/lib/tasks-store.ts`、`client/src/lib/tasks-store.autopilot.test.ts`、`client/src/components/tasks/TaskAutopilotPanel.tsx` 与 `client/src/components/tasks/__tests__/TaskAutopilotPanel.test.tsx` 后，没有新增安全勾选；现有已勾项继续成立，但证据范围仍以 summary / projection / view-model 闭环为限。
- `role packaging` 现阶段只能保守认定为“角色摘要”而不是“角色打包对象”：`shared/mission/autopilot.ts` 真正落地的是 `MissionAutopilotFleetRole`，字段只覆盖 `id / roleType / title / status / responsibility / boundAgents / boundExecutors / currentFocus`；`shared/__tests__/mission-autopilot.test.ts` 也只直接锚定这些摘要字段与计数，不足以支撑 `FleetRolePackage`、`CapabilityPackage`、`ExecutionUnitRef`、`AttachmentRef` 已落地。
- `role status` 的直接双证据主要集中在 shared builder：`inferFleetRoleStatus(...)` 与 `buildMissionAutopilotSummary(...)` 会稳定产出 `planner`、waiting 场景下的 `clarifier` / 常规场景下的 `operator`，以及可选 `executor`；对应测试覆盖 active / waiting / blocked / queued 等场景。这里能保守勾选的是“`Drive State -> role status` 投影”，不能外推为完整角色家族已经稳定。
- `role summary` 的直接双证据主要集中在 client 消费链：`client/src/lib/tasks-store.ts` 负责归一化、未知 `roleType -> custom`、projection 缺失时 `Mission Core` `operator` fallback；`client/src/components/tasks/TaskAutopilotPanel.tsx` 负责消费标题、计数、`currentFocus`、`boundAgents`、`boundExecutors`；对应测试证明读链稳定，但不足以证明驾驶舱 / 车队状态 / 接管面板 / 回放四视图已经共享统一对象口径。
- `server/tasks/mission-projection.ts` 的事实是复用 shared builder 并透传 `autopilotSummary`；`server/tests/mission-routes.test.ts` 本轮重点钉住的是 route / takeover / evidence / explanation / link alignment，而不是独立的 `fleet.roles` 服务端快照。因此服务端证据更适合支撑“projection 已接线”，不适合额外勾选 `role packaging`、`Route -> Fleet` 完整投影规则或 `Takeover -> role` 细化关系。
- 因此以下条目本轮继续保留未勾选：首轮稳定角色全集、`Route -> Fleet` 完整投影规则、`Takeover` 与角色关系、`executor -> role actuator`、保守 fallback taxonomy、以及全部 package/ref 结构项。

## 审计备注（2026-04-25，lane 5 设计收口补充）

- 本轮新增勾选，语义上全部解释为“fleet spec 的 requirements / design 文档已经收口”，而不是“shared / server / client 已经按该结构全量实现”。尤其是 `FleetComposition / FleetRolePackage / CapabilityPackage / ExecutionUnitRef / AttachmentRef`，当前仍应视为目标设计结构，不应与主仓现有 `MissionAutopilotFleetRole` 摘要对象等同。
- 本轮新增勾选的文档任务包括：首轮角色集合、角色矩阵、目标对象结构、`agent -> role carrier`、`node -> role action`、`skill / tool / MCP -> role attachment`、保守回退策略、节点家族分类表、能力包目录、`Route -> Fleet` 设计矩阵、`Takeover` 与角色关系、`RoleRiskProfile / RoleTakeoverProfile`、四类示例编组，以及渐进落地顺序。
- 新增勾选之所以安全，是因为这些条目都已经在 [`design.md`](/C:/Users/wangchunji/Documents/whybuddy/.kiro/specs/fleet-organization-and-role-packaging/design.md) 中形成成体系定义，并且没有把当前主仓不存在的实现事实写成“已经落地”的代码结论；相反，设计稿显式增加了“当前主仓已落地的最小摘要对象”与“Lane 5 设计收口补充”两段边界说明，用来隔离目标模型与现有实现。
- 以下条目本轮继续保留未勾选：
  - `executor -> role actuator`
  - 角色摘要对象在驾驶舱 / 车队状态视图 / 接管面板 / 回放视图中的复用口径
  - 与 runtime 兼容的集成测试计划
- 这些条目继续未勾的原因分别是：
  - 当前 `shared/mission/autopilot.ts` 仍把 `executor` 暴露为一级 fleet role，尚未完成下沉为 role actuator 引用
  - 当前有直接代码与测试支撑的 consumer 仍主要是 `TaskAutopilotPanel`，相邻视图仍由其它 spec 继续收口
  - 当前仓库尚未形成真实 agent / node / executor 状态跨层投影到角色层的 runtime 级集成测试矩阵

## 审计备注（2026-04-25，lane 6 二次推进）

- 本轮把 fleet lane 中最后 3 个未勾项收口为“设计已定稿”状态：`executor -> role actuator`、多视图复用口径、与 runtime 兼容的集成测试计划。
- 勾选依据全部来自 [`design.md`](/C:/Users/wangchunji/Documents/whybuddy/.kiro/specs/fleet-organization-and-role-packaging/design.md) 本轮新增的明确段落，而不是对当前代码事实的额外外推：
  - `executors -> role actuators` 现在已经把 executor 如何下沉到 `executionUnits` 与 `executorTypes`、以及 browser/native/sandbox/mock executor 在不同角色中的归属规则写成统一口径。
  - `多视图复用口径` 现在已经明确同一份角色摘要对象在驾驶舱、车队状态视图、接管面板和回放视图中的主消费字段、可补充字段与禁止自行发明的内容。
  - `runtime 兼容集成测试计划` 现在已经明确集成测试目标、关键场景、测试分层建议以及与当前主仓已有测试锚点的关系。
- 这 3 项本轮可以安全勾选，但都只能解释为“spec / design 文档已收口”，不能解释为“shared/server/client 已按该设计全部实现”。
- 需要以本条最新结论为准：
  - 本文件前面的历史审计备注里若仍写着这 3 项“继续未勾”，应视为旧快照，而不是当前最新状态。
- 本轮收口后，这份 spec 在文档收口意义上已接近完成；剩余工作主要是相邻代码与相邻 spec 的渐进兑现，而不是本 spec 内部继续补定义。
