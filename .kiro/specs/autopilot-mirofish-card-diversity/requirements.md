# 需求文档

## 介绍

当前 MiroFishCardStream 中 6 类卡片（reasoning / capability_invocation / route_decision / artifact_created / node_completed / system_note）共用同一个 MiroFishCardShell 外壳，视觉形态高度同质化，用户难以通过扫视快速区分不同类型的信息。本 spec 为每类卡片定义独立的视觉形态，通过差异化的布局、图标、色彩标记和微动画让信息流更具可读性和层次感。

## 术语表

- **MiroFishCardShell**：卡片的通用外壳容器组件，提供圆角、边框、内边距等基础样式
- **CardVariant**：卡片视觉变体类型，对应 6 种 entry 类型各自的独立形态
- **ReasoningCard**：展示 Agent 思考/观察/行动过程的卡片变体
- **CapabilityCard**：展示能力调用（Docker / MCP / AIGC 节点等）状态的卡片变体
- **RouteDecisionCard**：展示路线决策结果的卡片变体
- **ArtifactCard**：展示产物创建（文件 / 代码 / 文档）的卡片变体
- **NodeCompletedCard**：展示节点完成状态的卡片变体
- **SystemNoteCard**：展示系统级消息/提示的卡片变体
- **MicroAnimation**：卡片进入或状态变化时的轻量 CSS 过渡动画

## 需求

### 需求 1：Reasoning 卡片形态

**用户故事：** 作为用户，我希望 Agent 的思考过程卡片有独特的视觉标识，这样我能快速识别哪些是 AI 正在推理的内容。

#### 验收标准

1. THE ReasoningCard SHALL 在左侧展示 2px 宽的实色竖条（thinking 为 #FF4500，observing 为 #666666，acting 为黑色）
2. THE ReasoningCard SHALL 使用 font-mono 展示推理文本内容，保持紧凑信息密度
3. WHEN ReasoningCard 首次进入视口时, THE MicroAnimation SHALL 使用 opacity 0→1 + translateY(4px→0) 的 CSS transition（duration 200ms）
4. WHILE reasoning entry 处于 streaming 状态, THE ReasoningCard SHALL 在文本末尾展示闪烁光标指示器（CSS @keyframes blink）
5. WHERE 一条 reasoning entry 同时携带多个语义字段（thought / actionToolId / observationSummary / reason / error 中的两个或以上）, THE ReasoningCard SHALL 把每个存在的字段各自渲染为独立一行（thought 为主黑字、`→ actionToolId` 为灰行、`✓/✗ observationSummary` 为成功黑 / 失败红行、reason 为浅灰次要行、error 为红行）, 而不是只 fallback 选择其中一个字段显示
6. THE ReasoningCard SHALL 在标签行右侧展示该 entry 的 HH:MM:SS 时间戳（由 formatTimestampHHMMSS 折算）
7. WHEN observationSummary 头部已含服务端塞入的 `✓ ` / `⚠ ` 前缀时, THE ReasoningCard SHALL 先剥除该前缀再追加自身的 `✓` / `✗` mark, 避免出现 `✓ ✓ ...` / `⚠ ✗ ...` 叠加

### 需求 2：Capability 调用卡片形态

**用户故事：** 作为用户，我希望能力调用卡片能清晰展示调用状态和目标，这样我能了解系统正在使用哪些工具。

#### 验收标准

1. THE CapabilityCard SHALL 使用横向紧凑布局：左侧图标（16×16）+ 能力名称 + 右侧状态徽章（invoking / success / failed）
2. THE CapabilityCard SHALL 根据能力类型使用差异化图标：Docker 容器图标、MCP 工具图标、AIGC 节点图标、角色系统图标
3. WHEN 能力调用状态为 invoking 时, THE CapabilityCard SHALL 在图标位置展示旋转加载动画（CSS @keyframes spin, duration 1s）
4. WHEN 能力调用状态为 failed 时, THE CapabilityCard SHALL 使用红色边框高亮并展示错误摘要
5. THE CapabilityCard SHALL 使用比 ReasoningCard 更小的垂直内边距（py-1.5 vs py-2），形成视觉层级差异

### 需求 3：Route Decision 卡片形态

**用户故事：** 作为用户，我希望路线决策卡片突出展示决策结果，这样我能快速了解系统选择了哪条路线。

#### 验收标准

1. THE RouteDecisionCard SHALL 使用带有微弱发光边框的卡片样式（box-shadow: 0 0 8px rgba(主题色, 0.15)），区别于普通卡片
2. THE RouteDecisionCard SHALL 在顶部展示决策标签（如"路线选定"、"方案确认"），使用 text-[10px] uppercase tracking-wider 样式
3. THE RouteDecisionCard SHALL 展示路线名称与简要描述，使用 text-xs font-medium 样式
4. WHEN RouteDecisionCard 首次出现时, THE MicroAnimation SHALL 使用 scale(0.95→1) + opacity(0→1) 的 CSS transition（duration 250ms）

### 需求 4：Artifact 产物卡片形态

**用户故事：** 作为用户，我希望产物卡片能直观展示产出了什么类型的文件，这样我能快速定位关键交付物。

#### 验收标准

1. THE ArtifactCard SHALL 使用带有文件类型图标的紧凑横向布局：文件图标 + 文件名 + 文件类型标签
2. THE ArtifactCard SHALL 根据产物类型使用差异化背景色调：代码类（蓝色调 bg-blue-500/5）、文档类（绿色调 bg-emerald-500/5）、图片类（紫色调 bg-violet-500/5）
3. WHEN ArtifactCard 首次出现时, THE MicroAnimation SHALL 使用从左侧滑入的 translateX(-8px→0) CSS transition（duration 200ms）
4. THE ArtifactCard SHALL 支持点击展开查看产物预览摘要（前 3 行或缩略图）

### 需求 5：Node Completed 卡片形态

**用户故事：** 作为用户，我希望节点完成卡片简洁明了地标记完成状态，这样我能快速扫视哪些步骤已经完成。

#### 验收标准

1. THE NodeCompletedCard SHALL 使用最小化的单行布局：完成图标（✓）+ 节点名称 + 耗时标签
2. THE NodeCompletedCard SHALL 使用降低对比度的文字样式（text-white/50），避免在信息流中过度抢占注意力
3. THE NodeCompletedCard SHALL 不使用独立卡片边框，仅通过水平分隔线与相邻卡片区分
4. WHEN 连续多个 NodeCompletedCard 出现时, THE MiroFishCardStream SHALL 将其折叠为摘要行（如"3 个节点已完成"），可展开查看详情

### 需求 6：System Note 卡片形态

**用户故事：** 作为用户，我希望系统消息卡片有明确的系统级标识，这样我能区分系统提示与 Agent 推理内容。

#### 验收标准

1. THE SystemNoteCard SHALL 使用居中对齐的紧凑布局，文字使用 text-[10px] text-white/40 italic 样式
2. THE SystemNoteCard SHALL 不使用卡片边框和背景色，仅作为信息流中的分隔提示
3. WHEN SystemNoteCard 内容为阶段切换提示时, THE SystemNoteCard SHALL 在文字两侧展示水平虚线装饰
4. THE SystemNoteCard SHALL 使用最小垂直间距（my-1），不占用过多信息流空间

### 需求 7：卡片微动画统一约束

**用户故事：** 作为用户，我希望卡片动画流畅但不过度，这样信息流保持可读性而不会因动画分散注意力。

#### 验收标准

1. THE MicroAnimation SHALL 仅使用 CSS transition 和 @keyframes 实现，不依赖 framer-motion（阶段切场除外）
2. THE MicroAnimation SHALL 遵循 Tailwind animate 工具类优先原则，自定义 @keyframes 仅在 Tailwind 内置动画无法满足时使用
3. THE MicroAnimation SHALL 将所有进入动画时长控制在 150ms 至 300ms 之间
4. WHILE 用户启用 prefers-reduced-motion 时, THE MicroAnimation SHALL 降级为无动画的即时渲染
