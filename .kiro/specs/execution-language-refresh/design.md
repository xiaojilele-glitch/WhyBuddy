# Execution Language Refresh - 设计文档

## 概述

本设计通过“术语映射 + i18n 收口 + 页面逐点替换”的方式，收敛任务相关界面的语言表达，让系统的第一感知从“会做方案”转向“会组织执行”。

## 设计原则

1. 行动导向优先于概念导向
2. 用户理解优先于内部系统术语
3. 主标题优先表达执行，解释性文案再表达组织机制

## 文案策略

### 1. 主叙事

从以下方向收口：

- 旧方向：dynamic teaming / temporary organization / org assembly
- 新方向：execution flow / team execution / delivery coordination

### 2. 次级解释

保留系统差异化能力，但下沉为说明句：

- 不是删除“动态组队”
- 而是不再让它出现在最显眼的主标题位置

## 建议映射表示例

| 旧表达 | 新表达 |
|---|---|
| Dynamic Teaming Flow | Execution Coordination Flow |
| Org Assembly | Team Setup |
| Department Summary | Team Handoff |
| Temporary Organization | Execution Team |
| Directive | Execution Brief |
| Parallel Run | Parallel Delivery |

中文示例：

| 旧表达 | 新表达 |
|---|---|
| 动态组队工作流 | 执行协同流程 |
| 组织生成 | 团队就位 |
| 部门汇总 | 团队交付汇总 |
| 临时组织 | 执行团队 |
| 指令说明 | 执行简报 |

## 作用范围

优先覆盖：

- [WorkflowPanel.tsx](c:/Users/2303670/Documents/whybuddy/client/src/components/WorkflowPanel.tsx)
- [TaskDetailView.tsx](c:/Users/2303670/Documents/whybuddy/client/src/components/tasks/TaskDetailView.tsx)
- [TasksPage.tsx](c:/Users/2303670/Documents/whybuddy/client/src/pages/tasks/TasksPage.tsx)
- [TaskDetailPage.tsx](c:/Users/2303670/Documents/whybuddy/client/src/pages/tasks/TaskDetailPage.tsx)
- [messages.ts](c:/Users/2303670/Documents/whybuddy/client/src/i18n/messages.ts)

## 实现策略

### 1. 先盘点，再替换

先整理：

- 硬编码文案
- i18n 文案
- 页面标题
- 空态 / 错误态 / 按钮文案

再统一替换。

### 2. 优先回收至 i18n

除非明显是局部技术提示，否则优先把文案收进 `messages.ts`，避免下次继续散落。

### 3. 与页面层级协同

文案不是孤立替换，需要和 `task-detail-operations-first` 配合：

- 主标题：执行导向
- 摘要卡片：owner / blocker / next step
- 次级面板：组织与机制说明

## 组件级策略

### WorkflowPanel

- 弱化“系统在做组织学演示”的感觉
- 强调“当前团队如何拆解并推进任务”

### Task 页

- 强调行动建议和当前状态
- 按钮文案不要抽象化

### Empty / Error States

- Empty: 说明“当前没有什么可以看/做”
- Error: 说明“发生了什么 + 建议下一步”

## 测试策略

- 中英文快照测试
- 关键页面文本回归检查
- 确认未出现中英文语义不一致

## 交付顺序

1. 文案盘点
2. i18n 映射表落地
3. WorkflowPanel 替换
4. Task 页替换
5. 空态 / 错误态替换
