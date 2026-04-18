# 任务运行可视化收敛方案 v1

## 目标

把任务运行证据统一收敛，让用户可以在首页稳定看到：

- 计划步骤
- 当前执行位置
- 日志流
- artifact
- executor 状态
- 人工决策等待点

## 范围

本轮覆盖：

- 墙上中心任务步骤状态流
- 中央浮层 `antd Splitter` 折叠区
- 底部运行区
- executor 状态摘要
- 日志流
- artifact 列表与入口
- decision 等待态

不覆盖：

- 回放页完整重写
- 复杂 lineage 图
- 完整的任务详情页深度信息重构

## 首页信息归位

首页运行可视化必须拆成三段：

- 墙上中心主内容
- 中央浮层 `antd Splitter` 折叠区
- 底部 runtime dock

其中：

- 墙上中心主内容只承接：
  - 当前步骤
  - 当前步骤状态
  - 一句话摘要
  - 当前进度
  - `waiting / failed / timeout` 这类主状态
- 中央浮层 `antd Splitter` 折叠区只承接：
  - `blocker detail`
  - `next step`
  - `current owner`
  - `pending launch`
  - `clarification context`
- 底部 runtime dock 只承接：
  - `Logs`
  - `Artifacts`
  - `Runtime`

中央浮层 `Splitter` 折叠区默认应折叠，避免在未发起任务或未进入人工判断阶段时长期占用场景视野。

## 必须满足

- 计划必须以步骤流方式展示，而不是整段文本
- 首页运行可视化必须基于现有 mission / workflow / task detail / socket 数据稳定映射，不能再造第二套业务真相源
- 每一步至少有：
  - 状态
  - 类型
  - 当前摘要
- 当前执行步骤必须高亮
- decision 步骤必须显式显示等待态
- 日志必须支持实时滚动
- artifact 必须可见、可点、可下载或预览
- executor 状态必须集中显示，不再散落
- 不允许把墙上中心已经展示的步骤、状态、摘要、进度，再在中央浮层顶部重复展示一遍
- 不允许把 `blocker / next step / owner` 这类辅助判断信息继续做成墙上主内容
- 不允许把 executor / socket / callback / recent action / recent failure 同时放在右侧控制区、墙上主区和 runtime dock 中重复展示
- `waiting / clarification / pending launch` 时，允许自动展开中央浮层 `Splitter` 折叠区；其余情况下应保持默认折叠
- 建立 runtime dock 后，首页和任务详情页中原有的同等级运行主入口必须同步收口或移除，不能只新增不下线

## 底部运行区要求

底部运行区至少包含：

- `Logs`
- `Artifacts`
- `Runtime`

其中：

- `Logs` 默认展开
- `Artifacts` 展示结果文件、截图、输出物
- `Runtime` 展示 executor、socket、worker、最近动作
- `Runtime` 还必须承接 callback 状态、最近失败原因
- runtime dock 建成后，它必须成为首页运行证据唯一主出口

## 重复项移除要求

本轮改造完成后，以下重复内容必须移除或降级为轻量提示：

- 中央浮层顶部重复的步骤卡、阶段卡、摘要卡、进度卡
- 首页主视图中与 `Logs` 并列竞争的独立日志入口
- 首页主视图中与 `Artifacts` 并列竞争的独立截图 / 输出物入口
- 首页主视图中与 `Runtime` 并列竞争的独立 executor / socket / sandbox 总览入口
- 任务详情页顶部与首页 runtime dock 并列竞争的日志 / artifact / runtime 主入口

允许保留：

- 轻量跳转
- 计数
- 最近项提示

但不允许继续保留同等级主入口。

## 体验要求

- 用户可以只看首页就知道系统“到底干了什么”
- 错误、超时、等待态必须可见
- 用户不需要去多个 panel 或多个页面拼接运行信息
- 不允许一边新增 runtime dock，一边继续把同等级运行入口散落在首页主视图中
- 用户不应在墙上中心和中央浮层顶部同时看到同一条主线信息
- 用户应能一眼分辨：
  - 哪些是墙上主线
  - 哪些是 `Splitter` 中的辅助判断信息
  - 哪些是底部 runtime dock 中的运行证据

## 验收标准

- 首页底部运行区成为运行证据唯一主出口
- 当前步骤、日志流、artifact、executor 状态之间形成稳定联动
- 墙上中心、`Splitter` 折叠区、runtime dock 三段职责清晰且不存在同级重复
- 新增后的首页不再保留旧的分散运行主入口
