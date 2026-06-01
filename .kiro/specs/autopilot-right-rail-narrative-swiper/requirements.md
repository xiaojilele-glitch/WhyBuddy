# 需求文档：Autopilot 右栏底部叙事 Swiper

## Introduction

本规格用于把 WhyBuddy Autopilot 主壳右栏底部的“流式日志输出”从“黑白控制台框”升级为“阶段化叙事卡片流”。

按第一性原理对当前体验的拆解结论是：右栏的真正核心是“输入、澄清、路线选择、SPEC 树、规格文档、效果预览”这 6 个产品对象，它们承载用户做决策所需的“主语”；而当前右栏底部的 AutopilotConsolePanel 把所有流式信号（reasoning、role status、capability、fleet activation）都堆成了同一种“黑底等宽字”控制台样式，与上方 6 个产品对象的叙事强度不匹配。

本次重构遵循以下边界：

- 已与用户对齐方案 1：左下 AutopilotConsolePanel 保留但默认折叠为 mini bar，右下新建阶段化 Swiper 叙事卡片流
- 双控制台职责不重叠：左下 = 系统流水（job/route/artifact 决策审计），右下 = 当前阶段角色协同的叙事
- 现有 4 个组件（MiroFishCardStream / RoleStatusStrip / CapabilityRail / FleetActivationLog）的数据源不动，只重组它们的呈现层
- 不重新设计后端契约 / 不破坏 3D 场景 / 不破坏现有 467 个测试 / 不扩大当前 117 的 TS 基线

### 目标

1. 让右栏底部从“日志”升级为“叙事”：流式信号像剧情卡片一样推入 / 切换 / 谢幕，每张卡片有 3-8 秒生命周期，满了自动 FIFO 替换
2. 让 6 个产品对象（输入 / 澄清 / 路线 / SPEC 树 / 规格文档 / 效果预览）继续占据右栏主区，叙事 Swiper 固定在右栏底部、不与它们竞争视野
3. 让 6 个阶段拥有不同的视觉语境（单据柜台 / 圆桌会议 / 调度台 / 图书馆 / 写作工坊 / 小剧场），把“自动驾驶控制台”体验扩展为“阶段化叙事场景”
4. 用户能手动滑动 / hover 暂停 auto-rotate，同时保留 aria-live 与 prefers-reduced-motion 降级
5. 把左下 AutopilotConsolePanel 折叠为 80-120px 的 mini bar，hover 或 click 展开为完整滚动日志，避免双控制台同屏抢戏
6. 演示者向观众展示推演过程时，叙事卡片成为吸引注意力的主线；用户接管时能快速识别“现在哪些角色在做什么”；调试者审计完整流水时仍可通过 mini bar 展开

### 非目标

1. 不重新设计 useBlueprintRealtimeStore.agentReasoning / RoleStatusStrip / CapabilityRail / FleetActivationLog 的数据来源或 store selector
2. 不修改 3D 场景层、StreamingDocRenderer 或 SPEC 树工作台
3. 不删除现有 mirofish-stream / role-status-strip / capability-rail / fleet-activation-log 组件，只重组它们的呈现层
4. 不引入新的后端事件类型 / Socket 通道 / Mission Runtime 字段
5. 不把每条 entry 都升级为可点击的“叙事卡片详情页”，叙事卡片是即来即走的轻量层
6. 不替换 mirofish-stream 已有的派生函数 derive-mirofish-stream-entries.ts
7. 不在本规格内承诺移动端或平板的完整重排，只承诺右栏 Swiper 在窄屏下的可降级行为
8. 不破坏现有 react-dom/server SSR + vi.mock 测试模式，不扩大 TS 基线（当前 117）

## Glossary

- Autopilot_Right_Rail：Autopilot 主壳右栏区域，承载“输入、澄清、路线、SPEC 树、规格文档、效果预览”6 个产品对象与底部叙事 Swiper
- Narrative_Swiper：本规格新增的右栏底部容器，承担叙事卡片的容纳、自动轮播、手动滑动、容量上限与 FIFO 替换
- Narrative_Card：进入 Narrative_Swiper 的单一卡片实例，对应一条来自 reasoning / role-status / capability / fleet-activation / route-decision / artifact 的事件，生命周期约 3-8 秒
- Card_Source：Narrative_Card 的来源类型枚举，至少包含 reasoning / role-status / capability / fleet-activation / route-decision / artifact
- Stage：Autopilot 当前所处的产品阶段，枚举为 input / clarify / route / spec-tree / spec-doc / preview 6 个值
- Stage_Visual_Lane：每个 Stage 对应的视觉语境主题（单据柜台 / 圆桌会议 / 调度台 / 图书馆 / 写作工坊 / 小剧场），决定卡片的背景纹理、配色、图标语言与转场动效
- Auto_Rotation：Narrative_Swiper 自动轮播的行为，按 Dwell_Time 间隔向前推进
- Dwell_Time：单张 Narrative_Card 在 Auto_Rotation 下停留的时间，默认 3-8 秒，按 Card_Source 与 Stage 可调
- Eviction_Policy：当 Narrative_Swiper 超过容量上限时的替换策略，默认 FIFO 挤掉最旧的 Narrative_Card
- Capacity_Limit：Narrative_Swiper 同时存活的 Narrative_Card 数量上限，默认 8
- Mini_Console_Bar：左下 AutopilotConsolePanel 默认折叠后的极简形态，高度 80-120px，仅显示最新 1-2 行加上展开按钮
- Expanded_Console_Panel：Mini_Console_Bar 经 hover 或 click 展开后恢复的完整滚动日志面板
- Right_Rail_Console_Boundary：双控制台职责边界，左下承接系统流水（job / route / artifact 决策审计），右下承接当前阶段角色协同的叙事
- Reduced_Motion_Mode：操作系统或浏览器声明 prefers-reduced-motion: reduce 的环境，Narrative_Swiper 在该模式下应降级到无动效切换
- Narrative_Aria_Live_Region：Narrative_Swiper 提供的辅助文本区域，使用 aria-live="polite" 把当前卡片摘要播报给屏幕阅读器
- Narrative_Card_Stream：Narrative_Swiper 内部的卡片队列抽象，包含入队、出队、暂停、定位等行为
- Stage_Transition：用户或系统从一个 Stage 切换到另一个 Stage 的事件
- Existing_Card_Component：现有 4 个组件（MiroFishCardStream / RoleStatusStrip / CapabilityRail / FleetActivationLog）在 Narrative_Swiper 中被收编后的呈现层名称

## Requirements

### Requirement 1: 阶段化视觉语境（Stage_Visual_Lane）

**User Story:** 作为 WhyBuddy 的演示者与日常用户，我想要让右栏底部叙事卡片在不同阶段呈现不同的视觉语境，以便于一眼判断“现在系统在做哪一件事”，而不是看一堆雷同的黑白控制台框。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 在 6 个 Stage 中分别加载对应的 Stage_Visual_Lane 主题：input 对应单据柜台、clarify 对应圆桌会议、route 对应调度台或雷达室、spec-tree 对应图书馆索引、spec-doc 对应写作工坊、preview 对应小剧场或走秀
2. WHEN Stage 发生 Stage_Transition，THE Narrative_Swiper SHALL 在 600ms 内切换到新的 Stage_Visual_Lane，并保留旧 Lane 的渐隐过渡
3. THE Stage_Visual_Lane SHALL 至少差异化以下视觉维度：背景纹理、主色调、卡片边框语言、图标族、入场动效
4. THE Stage_Visual_Lane SHALL 复用现有 OKLCH 设计令牌的色板范围，差异化通过纹理、装饰元素与动效达成，而不是引入与冷灰色板冲突的新主色
5. WHILE Stage 处于 clarify，THE Narrative_Swiper SHALL 在卡片中展示说话人头像与对话气泡形态
6. WHILE Stage 处于 route，THE Narrative_Swiper SHALL 在卡片中展示候选路线 chip 与风险光圈形态
7. WHILE Stage 处于 preview，THE Narrative_Swiper SHALL 在卡片中展示灯光与谢幕形态的入场或退场过渡
8. IF Stage_Visual_Lane 资源（背景图 / 装饰）加载失败，THEN THE Narrative_Swiper SHALL 退化为基础冷灰色板的中性 Lane，并继续展示卡片内容

### Requirement 2: Swiper 容器与即来即走交互

**User Story:** 作为正在观察 Autopilot 推演的用户，我想要叙事卡片即来即走、满了自动切到下一张，同时保留我手动滑动与暂停的能力，以便于在关键叙事点上停留观察。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 维护一个 Capacity_Limit 默认为 8 的卡片队列
2. WHEN 新的 Narrative_Card 入队且队列长度等于 Capacity_Limit，THE Narrative_Swiper SHALL 按 Eviction_Policy（FIFO）移除最旧的卡片，再入队新卡片
3. THE Narrative_Swiper SHALL 启动 Auto_Rotation，按 Dwell_Time 默认 5 秒（可在 3-8 秒范围内按 Card_Source 与 Stage 调整）向前推进
4. WHEN 用户将光标 hover 进入 Narrative_Swiper 区域，THE Narrative_Swiper SHALL 暂停 Auto_Rotation
5. WHEN 用户的光标离开 Narrative_Swiper 区域，THE Narrative_Swiper SHALL 在 300ms 后恢复 Auto_Rotation
6. WHEN 用户使用左右箭头按钮或键盘 Left 或 Right 键，THE Narrative_Swiper SHALL 在 250ms 内切换到上一张或下一张 Narrative_Card
7. WHEN 用户在 Narrative_Swiper 区域执行水平拖拽手势且位移超过 40px，THE Narrative_Swiper SHALL 切换到对应方向的 Narrative_Card
8. WHILE 用户处于手动浏览状态（最近 3 秒内有过手动切换或拖拽），THE Narrative_Swiper SHALL 暂停 Auto_Rotation
9. THE Narrative_Swiper SHALL 在容器内固定显示当前卡片位置指示器（例如 3 / 8），位置指示器只反映可见队列
10. IF 队列为空，THEN THE Narrative_Swiper SHALL 显示 Stage_Visual_Lane 对应的空态占位（例如 clarify 阶段显示空圆桌、preview 阶段显示暗场幕布），不显示原 AutopilotConsolePanel 的“等待事件”黑底字样
11. THE Narrative_Swiper SHALL 在右栏底部固定，高度占据右栏可视高度的 22% 到 30%，桌面 1280+ 默认 26%
12. THE Narrative_Swiper SHALL 不与右栏主区的 6 个产品对象组件重叠，主区高度对应自适应

### Requirement 3: 现有 4 个组件到叙事卡片的数据源映射（Card_Source）

**User Story:** 作为前端工程师，我想要让现有 MiroFishCardStream / RoleStatusStrip / CapabilityRail / FleetActivationLog 的数据被 Narrative_Swiper 收编，而不是重新接一遍 store，以便于复用现有 selector 与测试契约。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 通过 Card_Source 区分以下 6 类来源：reasoning（来自 useBlueprintRealtimeStore.agentReasoning.entries）、role-status（来自 RoleStatusStrip selector）、capability（来自 CapabilityRail selector）、fleet-activation（来自 FleetActivationLog selector）、route-decision（来自路线规划 store）、artifact（来自 artifact 投影）
2. THE Narrative_Swiper SHALL 复用 mirofish-stream/derive-mirofish-stream-entries.ts 已有的派生逻辑，不重新实现 reasoning entry 的归一化
3. THE Narrative_Swiper SHALL 把每条来源 entry 映射成包含以下字段的 Narrative_Card：id、source、stage、headline、detail（可选）、actorAvatar（可选）、severity（可选）、occurredAt
4. WHEN 同一个底层 entry id 已经存在于队列且新版本只是细节字段变化，THE Narrative_Swiper SHALL 原地更新该 Narrative_Card，不再触发入队动效，避免视觉抖动
5. THE Narrative_Swiper SHALL 在每张 Narrative_Card 上以可识别的图标或角标标注 Card_Source，便于演示者向观众解释“这条信号来自哪里”
6. IF Card_Source 在 store 中暂时不可用（例如 selector 返回空），THEN THE Narrative_Swiper SHALL 跳过该来源的卡片入队，但不阻塞其他来源；可用性仅在入队时判定，已入队的旧卡片不会因后续来源不可用而被回收
7. THE Narrative_Swiper 的数据消费层 SHALL 通过 React hook 抽象隔离，store 层不直接感知 Narrative_Swiper 的存在
8. THE Narrative_Swiper SHALL 不修改 useBlueprintRealtimeStore / RoleStatusStrip / CapabilityRail / FleetActivationLog 的对外 API 与数据结构

### Requirement 4: 双控制台职责边界（Right_Rail_Console_Boundary）

**User Story:** 作为产品负责人，我想要左下控制台与右下叙事 Swiper 的职责互不重叠，以便于演示者讲解时不出现“同一信息在两个地方同时滚动”的尴尬。

#### Acceptance Criteria

1. THE Autopilot 主壳 SHALL 把信号源按职责拆分为左下系统流水（job 调度、route 决策、artifact 落地、错误兜底）与右下阶段叙事（reasoning、role-status、capability、fleet-activation 中与当前阶段相关的子集）
2. THE 左下 Mini_Console_Bar 与 Expanded_Console_Panel SHALL 不展示 Narrative_Swiper 已经渲染的当前阶段叙事卡片源（除非用户主动展开 Expanded_Console_Panel 的“全部信号”视图）
3. THE Narrative_Swiper SHALL 不展示纯粹的 job 调度日志、HTTP 错误堆栈、原始 SSE 报文这类系统流水信号
4. WHERE 同一条 entry 同时具有“系统流水”与“叙事卡片”双重价值（例如某次 route 决策），THE Narrative_Swiper SHALL 展示其叙事侧内容（决策结论与角色），同时左下控制台 SHALL 展示其流水侧内容（job id、决策时间、原始字段）；允许两侧同时展示但内容焦点不同，由 Right_Rail_Console_Boundary 共享路由模块保证两侧字段不重复
5. THE Right_Rail_Console_Boundary SHALL 在代码层以一份共享的 source-routing 模块或 enum 表达，避免左右两侧各自维护一份不一致的过滤规则

### Requirement 5: 左下 AutopilotConsolePanel 折叠（Mini_Console_Bar）

**User Story:** 作为日常用户与调试者，我想要左下控制台默认收成一根 mini bar，但仍能在我需要审计完整流水时被展开，以便于让出主屏空间给右栏的 6 个产品对象与右下叙事。

#### Acceptance Criteria

1. THE 左下 AutopilotConsolePanel SHALL 在桌面 1280+ 的初次渲染中默认呈现为 Mini_Console_Bar，高度在 80-120px 之间
2. THE Mini_Console_Bar SHALL 显示最近 1-2 条系统流水摘要、一个连接状态指示与一个展开按钮
3. WHEN 用户将光标 hover 在 Mini_Console_Bar 上停留超过 250ms，THE Mini_Console_Bar SHALL 展开为 Expanded_Console_Panel
4. WHEN 用户点击 Mini_Console_Bar 的展开按钮，THE Mini_Console_Bar SHALL 立即展开为 Expanded_Console_Panel，并保持展开直到用户再次手动折叠
5. WHEN 用户点击 Expanded_Console_Panel 的折叠按钮或在面板外区域按下 Esc 键，THE Expanded_Console_Panel SHALL 折叠回 Mini_Console_Bar
6. THE Expanded_Console_Panel SHALL 复用现有 AutopilotConsolePanel 的滚动日志、筛选与连接状态展示，不重新实现日志渲染
7. WHILE Expanded_Console_Panel 处于展开状态，THE Narrative_Swiper SHALL 不被遮挡，必要时 Expanded_Console_Panel 以左下浮层定位避开右栏区域
8. WHERE 用户在浏览器会话中显式折叠或展开过 Expanded_Console_Panel，THE Autopilot 主壳 SHALL 在同一会话内记住该偏好（sessionStorage），不在每次路由切换后重置
9. IF Mini_Console_Bar 渲染失败或样式资源缺失，THEN THE Autopilot 主壳 SHALL 退化到展示原始 AutopilotConsolePanel 完整态，保证系统流水仍可见

### Requirement 6: 阶段切换与卡片生命周期（Stage_Transition）

**User Story:** 作为演示者，我想要在阶段切换时叙事卡片有清晰的“清场”表达，以便于观众理解“上一幕已结束，新一幕开场”。

#### Acceptance Criteria

1. WHEN 发生 Stage_Transition，THE Narrative_Swiper SHALL 在 600ms 内对当前队列内属于上一 Stage 的 Narrative_Card 应用退场动效，并切换到新 Stage_Visual_Lane
2. THE Narrative_Swiper SHALL 在 Stage_Transition 后保留最近 N 张跨阶段卡片（默认 N=2）作为“上一幕回声”，N 张之外的旧阶段卡片按 Eviction_Policy 移除
3. THE Narrative_Swiper SHALL 不把跨阶段卡片纳入新 Stage 的 Auto_Rotation 主轮播，跨阶段卡片以视觉淡化方式呈现于队列起始
4. WHEN 用户在 Stage_Transition 后 5 秒内手动切回上一 Stage，THE Narrative_Swiper SHALL 优先恢复旧阶段卡片队列的最后状态，而不是立即清空重建
5. IF 同一 Stage 内卡片超过 Capacity_Limit，THEN THE Narrative_Swiper SHALL 按 Requirement 2 的 Eviction_Policy 处理，不引入“跨阶段保留”加权例外
6. THE Narrative_Swiper SHALL 不清空左下 Expanded_Console_Panel 的历史日志，左下控制台不受 Stage_Transition 影响

### Requirement 7: 响应式行为（桌面 / 平板 / 移动）

**User Story:** 作为在不同设备上演示与查看的用户，我想要 Narrative_Swiper 在桌面、平板和移动端有合适的降级形态，以便于不挤压主区的 6 个产品对象。

#### Acceptance Criteria

1. WHILE 视口宽度大于等于 1280px，THE Narrative_Swiper SHALL 固定在右栏底部并保持需求 2 中定义的高度比例
2. WHILE 视口宽度处于 768px 到 1280px 区间，THE Narrative_Swiper SHALL 缩减为单行卡片高度（约 96-120px），并保留左右切换按钮与拖拽
3. WHILE 视口宽度小于 768px，THE Narrative_Swiper SHALL 折叠为可手动展开的浮起 chip，chip 默认收起在右下角，不强制展开覆盖主区
4. THE Narrative_Swiper 的响应式断点 SHALL 与现有 office-cockpit-splitter / office-task-cockpit 的断点策略一致，不引入新的断点系统
5. IF 视口宽度小于 768px 且当前 Stage 为 preview，THEN THE Narrative_Swiper SHALL 让出空间给效果预览主区，自身仅以 chip 形式存在

### Requirement 8: 可访问性（Accessibility）

**User Story:** 作为使用屏幕阅读器或开启了减少动效偏好的用户，我想要叙事 Swiper 不依赖纯视觉信号，以便于我也能跟上推演节奏。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 提供 Narrative_Aria_Live_Region，使用 aria-live="polite" 与 aria-atomic="false" 在卡片切换时播报当前 Narrative_Card 的 headline
2. THE Narrative_Swiper 的左右切换按钮 SHALL 提供可访问名（aria-label 中文标签），并在键盘焦点环可达
3. THE Narrative_Swiper 的容器 SHALL 暴露为 role="region" 并具备 aria-label（例如“当前阶段叙事流”）
4. WHILE 用户处于 Reduced_Motion_Mode（prefers-reduced-motion: reduce），THE Narrative_Swiper SHALL 关闭入场 / 退场 / Stage_Transition 的过渡动效，改用 50ms 内的瞬时切换
5. WHILE 用户处于 Reduced_Motion_Mode，THE Narrative_Swiper SHALL 关闭 Auto_Rotation，改为完全手动驱动
6. THE Narrative_Swiper 的卡片文案 SHALL 通过 i18n 中文/英文两份文案承载，不在动效层硬编码文本
7. IF 用户使用 Tab 键聚焦到 Narrative_Swiper 容器，THEN THE Narrative_Swiper SHALL 暂停 Auto_Rotation，并在容器失焦后恢复

### Requirement 9: 性能与稳定性

**User Story:** 作为前端工程师，我想要 Narrative_Swiper 在高频流式更新下不抖动、不丢帧，以便于不影响 3D 场景与右栏主区的交互流畅度。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 在 1 秒内最多触发 1 次 Auto_Rotation 步进，即使后端 SSE 高频推送也不放大渲染节流
2. WHEN 后端 1 秒内推送超过 20 条 entry，THE Narrative_Swiper SHALL 按 Card_Source 进行节流合并入队（例如同一 source 1 秒内仅最新 1 条入队），保证 Capacity_Limit 不被瞬时打满
3. THE Narrative_Swiper SHALL 不在每次卡片切换中触发右栏主区组件的重新渲染（通过 store selector 隔离 + memo）；本约束仅作用于卡片切换路径，新事件入队、Auto_Rotation 步进或其它 store 变更引发的右栏正常渲染不受限制
4. THE Narrative_Swiper SHALL 在测试环境（react-dom/server SSR）中输出可序列化的初始静态结构，不依赖浏览器特有的动效 API
5. THE Narrative_Swiper SHALL 在卸载时清理所有定时器与事件监听，不在 React 严格模式下产生悬挂副作用
6. IF Narrative_Swiper 内部出现渲染错误，THEN THE Autopilot 主壳 SHALL 通过 ErrorBoundary 退化为只显示 Mini_Console_Bar 与右栏主区，不影响整体页面可用性

### Requirement 10: 测试契约与工程边界

**User Story:** 作为维护当前 467 个测试与 117 TS 基线的工程团队，我想要本次重构落地时不破坏现有测试契约，以便于持续合入主线。

#### Acceptance Criteria

1. THE Narrative_Swiper 的实现 SHALL 不修改 useBlueprintRealtimeStore 的对外类型与字段
2. THE Narrative_Swiper 的实现 SHALL 不修改 mirofish-stream/derive-mirofish-stream-entries.ts 的对外签名
3. THE Narrative_Swiper 的实现 SHALL 不修改 spec-tree-workbench、streaming-doc-renderer、fabric-dispatch.property.test.tsx 等已有测试涉及的组件 API
4. THE Narrative_Swiper 的新增测试 SHALL 沿用 react-dom/server SSR + vi.mock 的现有测试模式，不引入新的浏览器 / E2E 测试框架
5. THE Narrative_Swiper 的实现 SHALL 不引入新的 npm 运行时依赖；优先复用 framer-motion 与现有 UI 工具类；在确实需要时，仅允许引入经评审的轻量工具包（gzipped 体积小于 5KB、无传递依赖、与现有冷灰色板视觉与 SSR 测试模式不冲突）
6. THE Narrative_Swiper 的实现 SHALL 不扩大当前 117 个 TypeScript 基线错误数，新增改动应在自有边界内零新增类型错误
7. THE Narrative_Swiper 与 Mini_Console_Bar 的中文 JSDoc SHALL 与项目其它模块一致，commit message 使用中文，prompt 字面量与 promptId 保持英文
8. WHERE 本次重构涉及到现有 4 个组件（MiroFishCardStream / RoleStatusStrip / CapabilityRail / FleetActivationLog）的呈现层迁移，THE 重构 SHALL 通过组合（在 Narrative_Swiper 内调用）而不是删改原组件来达成，原组件保留作为 Existing_Card_Component 的子节点

### Requirement 11: 品牌一致性与视觉差异预算

**User Story:** 作为产品负责人，我想要 6 个 Stage_Visual_Lane 在差异化的同时仍属于同一品牌语言，以便于不让“圆桌会议”和“小剧场”看起来像两个产品。

#### Acceptance Criteria

1. THE 6 个 Stage_Visual_Lane SHALL 共用同一套字体（标题 DM Sans / Noto Sans SC、数据 JetBrains Mono）与同一组冷灰色板基底
2. THE 6 个 Stage_Visual_Lane 的差异化 SHALL 集中在以下维度：背景纹理、装饰元素、入场或退场动效、状态色强度
3. THE Stage_Visual_Lane 的差异化 SHALL 不引入与现有 OKLCH 设计令牌冲突的新主题色
4. WHILE Stage 处于 preview，THE Stage_Visual_Lane 的“灯光”效果 SHALL 限制亮度峰值不超过现有 glow-button 的最大发光值；该亮度约束仅作用于 preview 阶段，其他 Stage 不强制此上限
5. IF 任一 Stage_Visual_Lane 在用户测试或视觉评审中被判定与品牌一致性冲突，THEN THE Narrative_Swiper SHALL 退化到该 Stage 的中性 Lane（与 input 阶段同款单据柜台风格）

### Requirement 12: i18n 与文案

**User Story:** 作为中英文双语用户，我想要叙事卡片在中英文环境下都能呈现自然的文案，以便于不出现“硬塞中文 prompt”的违和感。

#### Acceptance Criteria

1. THE Narrative_Swiper SHALL 通过现有 client/src/i18n 资源加载所有中英文文案
2. THE Narrative_Card 的 headline 与 detail SHALL 优先来自后端事件已有的中文 / 英文字段，前端不再二次翻译
3. WHERE 后端事件不带 i18n 文案，THE Narrative_Swiper SHALL 在前端 i18n 资源中提供回退键，并标注 fallback 来源；当后端事件已经携带 i18n 文案时，前端不再回退到 fallback 资源，而直接使用后端文案
4. THE Narrative_Swiper 的 UI 装饰文本（例如“等待澄清中”“路线候选”“谢幕”）SHALL 保持 i18n key + 中英文两份文案
5. THE prompt 字面量与 promptId SHALL 保持英文，不进入 i18n 资源
