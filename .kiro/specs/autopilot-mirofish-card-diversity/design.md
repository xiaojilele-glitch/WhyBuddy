# 设计文档：卡片形态多样性

## 设计概述

本设计为 MiroFishCardStream 中 6 类卡片（reasoning / capability_invocation / route_decision / artifact_created / node_completed / system_note）定义独立的视觉形态。改造集中在 `cards/index.tsx` 与 `cards/card-shell.tsx`，通过扩展 `MiroFishCardShell` 的 variant 系统和为每类卡片引入差异化的布局、色彩标记与 CSS 微动画，让信息流从"同质化列表"升级为"可扫视的多形态卡片流"。

## 组件架构

```
MiroFishCardStream (不变)
├── MiroFishCard (分发组件，不变)
│   ├── ReasoningCard (改造：左侧渐变竖条 + mono 字体 + 流式光标)
│   ├── CapabilityCard (改造：横向紧凑 + 类型图标 + 状态徽章 + spin)
│   ├── RouteDecisionCard (改造：发光边框 + 决策标签 + scale 进入)
│   ├── ArtifactCard (改造：文件图标 + 类型色调 + 左滑进入)
│   ├── NodeCompletedCard (改造：最小化单行 + 连续折叠)
│   └── SystemNoteCard (改造：居中 + 虚线装饰 + 无边框)
└── card-shell.tsx (改造：新增 variant prop 支持差异化外壳)
```

### 改造范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `cards/card-shell.tsx` | 扩展 | 新增 `variant` prop，支持 `default / compact / minimal / glow` 四种外壳变体 |
| `cards/index.tsx` | 重写 | 6 类卡片各自使用独立布局，不再统一走 primaryRow/secondaryRow |
| `cards/reasoning-card.tsx` | 新增 | 独立文件，承载渐变竖条 + 流式光标逻辑 |
| `cards/capability-card.tsx` | 新增 | 独立文件，承载横向紧凑布局 + spin 动画 |
| `cards/route-decision-card.tsx` | 新增 | 独立文件，承载发光边框 + scale 进入 |
| `cards/artifact-card.tsx` | 新增 | 独立文件，承载文件图标 + 类型色调 |
| `cards/node-completed-card.tsx` | 新增 | 独立文件，承载最小化布局 + 连续折叠 |
| `cards/system-note-card.tsx` | 新增 | 独立文件，承载居中无边框布局 |

## 数据流

```
MiroFishCardStream
  ↓ visibleEntries: MiroFishStreamEntry[]
  ↓
MiroFishCard (switch entry.kind)
  ↓
各类卡片组件 (entry + locale)
  ↓ 内部根据 entry 字段决定：
  ↓   - 渐变色 / 图标 / 状态徽章
  ↓   - 是否展示流式光标（streaming 状态）
  ↓   - 是否触发进入动画（首次渲染）
  ↓
DOM 渲染 (CSS transition / @keyframes)
```

### 连续 NodeCompleted 折叠逻辑

```
MiroFishCardStream
  ↓ visibleEntries
  ↓ useMemo: groupConsecutiveNodeCompleted(entries)
  ↓   → 连续 ≥3 个 node_completed → 折叠为 CollapsedNodeGroup
  ↓   → 其余保持独立渲染
  ↓
CollapsedNodeGroup (新增)
  ├── 摘要行："N 个节点已完成"
  └── 展开态：原始 NodeCompletedCard 列表
```

## 关键接口

```typescript
// 扩展后的 CardShell variant
type CardShellVariant = 'default' | 'compact' | 'minimal' | 'glow';

interface MiroFishCardShellProps {
  variant?: CardShellVariant;  // 新增，默认 'default'
  // ... 现有 props 保持不变
}

// ReasoningCard 内部状态
interface ReasoningCardProps {
  entry: MiroFishReasoningEntry;
  locale?: AppLocale;
}
// 渐变色映射
const REASONING_GRADIENT: Record<string, string> = {
  thinking: 'from-blue-500 to-purple-500',
  observing: 'from-cyan-400 to-emerald-400',
  acting: 'from-orange-400 to-yellow-400',
};

// CapabilityCard 图标映射
const CAPABILITY_ICON: Record<string, string> = {
  docker: '🐳',
  mcp: '🔌',
  aigc_node: '🧩',
  role_system: '👤',
};

// ArtifactCard 类型色调映射
const ARTIFACT_BG: Record<string, string> = {
  code: 'bg-blue-500/5',
  document: 'bg-emerald-500/5',
  image: 'bg-violet-500/5',
  data: 'bg-amber-500/5',
};

// CollapsedNodeGroup props
interface CollapsedNodeGroupProps {
  entries: MiroFishNodeCompletedEntry[];
  locale: AppLocale;
}
```

## 样式方案

### ReasoningCard

实际实现已对齐 mirofish-demo/console 视觉（白底 + #E5E5E5 边框 + 0 圆角），并在
whybuddy-3d-real-role-driven-scene-2026-05-29 reasoning-detail（2026-05-31）把
单字段 fallback 升级为「每个存在字段各自成行」，让一条同时带 think→act→observe 的
entry 完整展开，不再被压成一行。

| 元素 | 样式 |
|------|------|
| 容器 | `relative pl-3 pr-3 py-2 bg-white border border-[#E5E5E5]`，`borderRadius: 0` |
| 左侧实色竖条 | `absolute left-0 top-0 bottom-0 w-[2px] ${REASONING_BAR[phase]}`（thinking `bg-[#FF4500]` / observing `bg-[#666666]` / acting `bg-black`） |
| 标签行 | `flex items-baseline justify-between`：左 `font-mono text-[10px] text-[#999]` 显示 `phase · iterationLabel`；右 `font-mono text-[10px] text-[#BBB] tabular-nums` 显示 `formatTimestampHHMMSS(timestamp)` |
| thought 行 | `font-mono text-[12.5px] text-black leading-[1.55]` |
| action 行 | `font-mono text-[12px] text-[#555]`，文本 `→ ${actionToolId}` |
| observation 行 | `font-mono text-[12px]`，成功 `text-black` / 失败 `text-[#C0392B]`，文本 `${✓\|✗} ${已剥前缀的 observationSummary}` |
| reason 行 | `font-mono text-[11px] text-[#999]`（次要） |
| error 行 | `font-mono text-[12px] text-[#C0392B]` |
| 流式光标 | `inline-block w-[2px] h-3 bg-[#FF4500] animate-mirofish-blink ml-0.5` |

> 实现约束：`✓`/`✗`/`→` mark 必须与其后的摘要文本同处一个文本节点（不要用独立
> element 包裹 mark），否则 SSR 字符串里 mark 会被 `</span>` 截断，破坏既有
> `toContain("✓ ...")` / `toContain("→ ...")` 断言。

### CapabilityCard

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10` |
| 图标 | `w-4 h-4 flex-shrink-0` |
| 能力名称 | `text-[11px] font-medium text-white/70 truncate flex-1` |
| 状态徽章 invoking | `text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300` |
| 状态徽章 success | `text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300` |
| 状态徽章 failed | `text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300` |
| spin 动画（invoking） | `animate-spin` on icon |

### RouteDecisionCard

| 元素 | 样式 |
|------|------|
| 容器 | `rounded-md px-3 py-2.5 bg-white/5 border border-white/10 shadow-[0_0_8px_rgba(99,102,241,0.15)]` |
| 决策标签 | `text-[10px] uppercase tracking-wider text-indigo-300/80 font-bold` |
| 路线名称 | `text-xs font-medium text-white/90 mt-1` |
| 描述 | `text-[10px] text-white/50 mt-0.5` |

### ArtifactCard

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center gap-2 px-2.5 py-2 rounded-md border border-white/10 ${ARTIFACT_BG[type]}` |
| 文件图标 | `w-4 h-4 flex-shrink-0 text-white/60` |
| 文件名 | `text-[11px] font-medium text-white/80 truncate flex-1` |
| 类型标签 | `text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono` |

### NodeCompletedCard

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center gap-2 px-2 py-1 border-b border-white/5` (无独立卡片边框) |
| 完成图标 | `text-[10px] text-emerald-400` |
| 节点名称 | `text-[10px] text-white/50 truncate flex-1` |
| 耗时标签 | `text-[9px] font-mono text-white/30` |

### SystemNoteCard

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center justify-center gap-2 py-1 my-1` (无边框无背景) |
| 虚线装饰 | `flex-1 h-px border-t border-dashed border-white/10` |
| 文字 | `text-[10px] text-white/40 italic whitespace-nowrap` |

## 动画方案

所有微动画使用 CSS transition / @keyframes，不依赖 framer-motion。

### 进入动画

```css
/* ReasoningCard: fade + translateY */
@keyframes mirofish-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-mirofish-fade-in {
  animation: mirofish-fade-in 200ms ease-out both;
}

/* RouteDecisionCard: scale + fade */
@keyframes mirofish-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.animate-mirofish-scale-in {
  animation: mirofish-scale-in 250ms ease-out both;
}

/* ArtifactCard: slideX + fade */
@keyframes mirofish-slide-in {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}
.animate-mirofish-slide-in {
  animation: mirofish-slide-in 200ms ease-out both;
}

/* 流式光标闪烁 */
@keyframes mirofish-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
.animate-mirofish-blink {
  animation: mirofish-blink 1s step-end infinite;
}

/* Capability spin (复用 Tailwind animate-spin) */
```

### prefers-reduced-motion 降级

```css
@media (prefers-reduced-motion: reduce) {
  .animate-mirofish-fade-in,
  .animate-mirofish-scale-in,
  .animate-mirofish-slide-in {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .animate-mirofish-blink {
    animation: none;
    opacity: 1;
  }
}
```

## 测试策略

- **SSR 渲染测试**：`renderToString` 验证 6 类卡片在服务端渲染无报错
- **视觉差异测试**：验证每类卡片的 `data-testid` 和关键 className 存在
- **连续折叠测试**：验证 ≥3 个连续 node_completed 被折叠为摘要行
- **reduced-motion 测试**：验证 `prefers-reduced-motion` 媒体查询下动画类不生效

## Correctness Properties

### Property 1: 卡片类型与视觉形态一一对应

*For any* MiroFishStreamEntry，其 `kind` 字段 SHALL 唯一决定渲染的卡片组件类型，不同 kind 的卡片在 DOM 结构上具有不同的 `data-testid` 前缀。

**Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 6.1**

### Property 2: 微动画时长约束

*For any* 卡片进入动画，其 CSS animation-duration SHALL 在 150ms 至 300ms 之间（含边界）。

**Validates: Requirements 7.3**

### Property 3: 连续 NodeCompleted 折叠

*For any* 连续出现 3 个及以上 `node_completed` 类型的 entry 序列，MiroFishCardStream SHALL 将其折叠为单行摘要，展示总数。

**Validates: Requirements 5.4**

### Property 4: CapabilityCard 状态图标一致性

*For any* CapabilityInvocationEntry，当 `status` 为 `invoking` 时图标位置 SHALL 展示旋转动画；当 `status` 为 `failed` 时容器 SHALL 使用红色边框。

**Validates: Requirements 2.3, 2.4**
