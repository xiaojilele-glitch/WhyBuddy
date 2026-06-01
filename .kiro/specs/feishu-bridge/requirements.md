# 飞书集成 需求文档

## 概述

飞书集成模块将飞书（Feishu/Lark）作为 WhyBuddy 的第二入口，支持通过飞书消息或 OpenClaw Relay 发起复杂任务请求。系统在 3 秒内 ACK 确认，随后持续回传任务进度、等待确认、完成或失败状态到飞书对话中。

## 用户故事

### US-1: 飞书复杂请求快速 ACK
作为飞书用户，我发送一条复杂请求后希望在 3 秒内收到确认回复，这样我知道系统已经接收到请求。

#### 验收标准
- AC-1.1: `POST /api/feishu/relay` 接收 relay 请求，立即创建 Mission 并返回 ACK
- AC-1.2: ACK 消息包含任务 ID 和任务链接（如果配置了 FEISHU_BASE_TASK_URL）
- AC-1.3: ACK 在 3 秒内发送到飞书对话
- AC-1.4: relay 请求包含鉴权校验（FEISHU_RELAY_SECRET）

### US-2: 任务进度持续回传飞书
作为飞书用户，我希望在任务执行过程中持续收到进度更新，这样我不需要打开 Web 界面也能跟踪任务状态。

#### 验收标准
- AC-2.1: Mission 状态变化时，FeishuProgressBridge 自动向绑定的飞书对话发送进度消息
- AC-2.2: 进度消息包含当前阶段、进度百分比条、活跃状态描述
- AC-2.3: 支持文本消息和卡片消息两种格式（由 FEISHU_MESSAGE_FORMAT 控制）
- AC-2.4: 卡片消息包含彩色 header（根据状态：蓝色进行中、橙色等待、绿色完成、红色失败）

### US-3: 等待确认状态回传飞书
作为飞书用户，当任务需要人工确认时，我希望在飞书中收到等待提示和决策选项描述，这样我可以及时响应。

#### 验收标准
- AC-3.1: Mission 进入 waiting 状态时，向飞书发送等待消息（包含 waitingFor 描述）
- AC-3.2: 如果配置了 FEISHU_BASE_TASK_URL，消息中包含跳转到 Web 决策页面的链接
- AC-3.3: 卡片模式下 header 颜色为橙色

### US-4: 完成/失败终态回传飞书
作为飞书用户，任务完成或失败时我希望收到最终结果通知。

#### 验收标准
- AC-4.1: Mission done 时发送完成消息（包含 summary）
- AC-4.2: Mission failed 时发送失败消息（包含失败原因）
- AC-4.3: `suppressFinalSummary` 开关可控制是否发送终态摘要（避免上游重复发送）
- AC-4.4: 卡片模式下完成为绿色 header，失败为红色 header

### US-5: Relay 鉴权与重复事件去重
作为系统，我需要对 relay 请求做鉴权校验和重复事件去重，防止未授权访问和重复处理。

#### 验收标准
- AC-5.1: relay-auth.ts 校验请求中的 secret 与 FEISHU_RELAY_SECRET 环境变量匹配
- AC-5.2: webhook-dedup-store.ts 基于事件 ID 去重，相同事件 ID 的请求只处理一次
- AC-5.3: webhook-security.ts 校验飞书 webhook 签名（如果配置了 FEISHU_WEBHOOK_VERIFY_TOKEN）
- AC-5.4: 去重窗口有 TTL，过期的事件 ID 自动清理

### US-6: 任务绑定与消息投递队列
作为系统，我需要将 Mission 与飞书对话目标绑定，并按顺序投递消息避免乱序。

#### 验收标准
- AC-6.1: `bindTask(taskId, target)` 将 Mission 绑定到飞书对话（chatId/userId + 可选 replyMessageId）
- AC-6.2: 每个 taskId 的消息投递通过队列串行化，避免并发导致消息乱序
- AC-6.3: 后续消息自动携带 replyContext（回复到同一线程）
- AC-6.4: `unbindTask(taskId)` 解除绑定
