# 任务运行可视化收敛方案 v1 设计

## 现状问题

目前运行态信息分散：

- 一部分在任务详情
- 一部分在驾驶舱
- 一部分在弹层
- 一部分在 sandbox / terminal / screenshot 预览

用户看到的是“很多面板”，而不是“一个稳定运行面”。

## 目标结构

### 中间任务主线区

承接“任务阶段与进度”：

- 计划生成
- 执行中
- 审核中
- 完成 / 失败

这里指的是“墙上中心主内容”，不是中央浮层顶部摘要区。

### `antd Splitter` 折叠区

承接“只在发起或人工介入时才需要”的辅助信息：

- `blocker detail`
- `next step`
- `current owner`
- `pending launch`
- `clarification context`

约束：

- 默认折叠，避免常驻占用场景可视面积
- 只在 `waiting / clarification / pending launch` 等场景自动展开
- 不重复承接墙上中心已经表达的步骤、状态、摘要、进度

### 底部运行区

承接“运行证据”：

- Logs
- Artifacts
- Runtime

## 三段归位原则

首页运行可视化必须拆成三段，而不是继续把所有信息堆在一个浮层里：

- 墙上中心主内容：
  - 只保留当前步骤、步骤状态、一句话摘要、进度
  - `decision waiting / failed / timeout` 要直接成为主线状态的一部分
- `Splitter` 折叠区：
  - 只保留辅助判断信息，不承接主线本身
  - 主要给操作前确认、补问、人工判断使用
- 底部 runtime dock：
  - 只保留运行证据
  - `Logs / Artifacts / Runtime` 成为唯一主出口

这三段之间不能出现“同一条信息在两个区域各展示一次”的情况。

## 任务步骤模型

步骤至少包含：

- `id`
- `title`
- `kind`
  - `llm`
  - `executor`
  - `decision`
  - `review`
- `status`
  - `pending`
  - `running`
  - `waiting`
  - `done`
  - `error`
- `summary`
- `updatedAt`

这套模型不要求替换 store 真相源，但必须在首页表现层稳定映射出来。

## 数据来源映射

实现时应先明确表现层映射，不直接复制旧面板：

- 墙上步骤流 <- 现有任务计划、workflow 状态、task detail 阶段信息
- `Splitter` 折叠区 <- Clarification / Decision / blocker / next step / owner 相关状态
- `Logs` <- socket 日志流、终端输出、关键事件摘要
- `Artifacts` <- 现有 artifact 列表、截图、输出物入口
- `Runtime` <- executor 状态、socket / callback 状态、worker 最近动作
- decision waiting <- Clarification / Decision 相关状态与当前任务等待点

实现时要优先做映射和归位，不直接把旧面板整体复制到首页新位置。

## 重复项移除策略

### 从墙上中心移除

墙上中心不应再承接：

- `blocker detail`
- `next step detail`
- `current owner`
- executor / socket / callback 细项
- artifact 主入口

### 从 `Splitter` 折叠区移除

`Splitter` 折叠区不应再承接：

- 当前步骤卡
- 当前步骤状态卡
- 当前摘要卡
- 当前进度卡
- 与墙上主线等价的 `plan / execute / review` 二次展示

### 从首页其他区域移除

runtime dock 建立后，需要移除首页主视图中的重复运行主入口：

- 重复日志流入口
- 重复截图 / 产物入口
- 重复 executor / sandbox / socket 总览入口
- 重复 recent failure / recent action 摘要面板

### 从任务详情页移除

任务详情页保留深度查看能力，但不应再保留与首页 runtime dock 并列竞争的运行主入口：

- 顶部独立日志主入口
- 顶部独立 artifact 主入口
- 顶部独立 runtime 总览主入口

允许保留轻量跳转、计数、最近项提示，但主查看入口要统一回到首页 runtime dock。

## Logs 设计

- 实时追加
- 自动滚动
- 提供暂停滚动
- 错误日志高亮
- 支持按 `info / step / error` 做轻量分类

## Artifacts 设计

- 结果文件列表
- 点击查看 / 下载
- 截图、报告、产物统一归这里
- 不把 artifact 主入口继续散落在详情页顶部或各类卡片里

## Runtime 设计

展示运行时摘要：

- 当前 executor 状态
- callback / socket 状态
- 当前 worker / 最近动作
- 最近一次失败原因

## 代码落点

- 墙上中心步骤流组件
- 中央浮层 `antd Splitter` 折叠区
- `TaskDetailView` 的运行证据能力抽取
- artifact 相关组件
- executor / sandbox 状态相关组件
- Clarification / Decision 等待态组件

## 风险

- 不能一边保留旧分散面板、一边又新增 runtime dock 而不去收口
- 不能一边让墙上中心承接主线，一边又在 `Splitter` 折叠区重复做一套主线卡片
- 不能把“辅助判断信息”和“运行证据”混在同一个浮层区域里
- 本轮应该优先做“运行证据归口”，不是继续造新视图
- 如果不先定义数据来源映射，容易在首页与详情页之间重复拷贝逻辑
