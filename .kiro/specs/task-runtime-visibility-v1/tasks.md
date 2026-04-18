# 任务运行可视化收敛方案 v1 任务拆解

## 信息归位约束

- 墙上中心主内容：
  - 只承接任务步骤流、当前步骤高亮、waiting / failed / timeout 主状态、一句话摘要
  - 不重复承接 blocker detail、next step detail、executor 细项、artifact 入口
- `antd Splitter` 折叠区：
  - 只承接“发起或人工介入时才需要”的辅助信息
  - 包括 `blocker detail`、`next step`、`current owner`、`pending launch`、`clarification context`
  - 默认折叠；`waiting / clarification / pending launch` 时可自动展开
- 运行证据 tabs：
  - 只承接 `Logs / Artifacts / Runtime`
  - 运行证据、截图、executor / socket / callback / recent action / recent failure 一律进入这里
  - 不允许在首页其他主视图中保留同等级运行主入口
  - 当前实现已并入“辅助判断信息”折叠区，以 tab 形式和 `辅助` 信息共用一个浮层，不再额外新增第二个底部浮层

## 当前状态快照（2026-04-18）

- 总体状态：进行中，约 62%
- 已有落地：
  - 首页中央浮层已完成第一轮信息归位，顶部辅助区只保留 `blocker detail / next step / current owner / pending launch / clarification context`
  - 首页中央浮层已移除一批与墙上中心重复的焦点摘要、阶段摘要、重复状态信息
  - clarification 与辅助判断区已经做了互斥分层，避免三层叠卡
  - 中央控制区已经从左右侧栏宽度分配中抽离，改为独立居中层，避免侧栏折叠时整体横向漂移
  - `Logs / Artifacts / Runtime` 已合并进入“辅助判断信息”折叠面板，使用 tab 切换，不再保留独立 runtime dock 浮层
  - `Logs` 已接入实时滚动与错误流高亮，`Artifacts` 已接入统一预览 / 下载链路，`Runtime` 已接入 executor 摘要与 recent failure / recent action
  - 右侧 `Deep workspace` 内嵌的 `TaskDetailView` 已开始收口运行证据；在 cockpit 嵌入态下不再重复渲染 runtime snapshot / executor / terminal / timeline / artifacts / failure 面板
  - 相关代码主落点：[`OfficeTaskCockpit.tsx`](../../../client/src/components/office/OfficeTaskCockpit.tsx)
- 当前仍未完成：
  - 墙上中心“步骤流真相源”尚未完整收口，首页主墙还没有完全切成 spec 目标里的步骤流模型
  - 任务详情页、右侧控制区、artifact / executor / runtime 相关重复入口仍未系统移除
  - 运行态回归验证还未成体系执行

## 分项状态

- `1. 抽取首页任务步骤流`
  - 状态：进行中
  - 当前进展：
    - 已开始清理中央浮层顶部与墙上中心重复的信息
    - 已把 blocker / next step / owner 等辅助信息从常驻主发起区中拆出
    - 但“墙上中心 = 步骤流主真相源”还没完全落完
- `2. 建立底部运行区`
  - 状态：进行中
  - 当前说明：
    - 首页代码里已经接入第一版 `Logs / Artifacts / Runtime` 运行证据 tabs
    - 该区域已合并进“辅助判断信息”折叠区，不再作为单独底部浮层存在
    - `Deep workspace` 内嵌完整详情已开始把运行证据后置到折叠区
    - 当前还没完成右栏外层摘要、旧入口收口与重复主入口移除
- `3. 收口日志能力`
  - 状态：进行中
  - 当前说明：
    - `Logs` tab 已接入 mission 级日志流，并已具备自动滚动能力
    - stderr 已做类型高亮，但“暂停滚动”和重复日志入口移除还没开始
- `4. 收口 artifact 能力`
  - 状态：进行中
  - 当前说明：
    - `Artifacts` tab 已接入统一 artifact 列表、预览与下载入口
    - `Deep workspace` 内嵌完整详情已不再重复渲染 artifacts 面板
    - 任务详情页和相关面板里仍保留 artifact 主入口与预览链路，尚未完成重复入口收口
- `5. 收口 executor 状态`
  - 状态：进行中
  - 当前说明：
    - `Runtime` tab 已接入 executor 摘要，以及 recent failure / recent action 展示
    - 右侧 `Deep workspace` 的内嵌完整详情已不再重复渲染 runtime snapshot / executor / terminal / failure 等面板
    - 右栏外层摘要和 socket / callback 状态归口还没完成
- `6. 强化 decision 等待态`
  - 状态：进行中
  - 当前进展：
    - clarification、pending launch、waiting 场景下的中央浮层分层关系已经开始收敛
    - 但“墙上 waiting 信号 / 辅助区说明 / 右侧联动”这三块还没有完全按 spec 收口
- `7. 完成运行态回归`
  - 状态：未开始
  - 当前说明：
    - 目前只做了局部 UI 交互修正和现有测试回归，尚未做成功 / 失败 / 超时 / 取消的完整运行态回归

## Tasks

- [ ] 1. 抽取首页任务步骤流
  - [ ] 1.1 盘点 mission / workflow / task detail / socket 中现有运行证据来源
  - [ ] 1.2 定义首页步骤表现模型
  - [ ] 1.3 把现有计划与状态映射成步骤流
  - [ ] 1.4 当前步骤高亮
  - [ ] 1.5 明确“墙上中心主内容”只保留步骤、状态、摘要、进度，不再复制 blocker / next step / owner
  - [ ] 1.6 墙上中心的 decision / waiting / failed / timeout 要直接成为步骤流的一部分，而不是旁路提示
  - [x] 1.7 移除首页中央浮层顶部与墙上中心重复的步骤卡、阶段卡、摘要卡
    - [x] 移除重复的 `plan / execute / review` 二次展示
    - [x] 移除重复的 `focusTitle / focusSignal` 二次展示
    - [x] 移除重复的“当前步骤 + 当前摘要 + 当前进度”二次展示

- [ ] 2. 建立运行证据 tab 区
  - [x] 2.1 建立 `Logs` 区
  - [x] 2.2 建立 `Artifacts` 区
  - [x] 2.3 建立 `Runtime` 区
  - [x] 2.4 默认打开 `辅助` tab（合并后的共享容器）
  - [ ] 2.5 收口首页主视图里重复的运行入口，避免与 runtime dock 并列竞争
  - [ ] 2.6 标记并移除首页里重复保留的运行证据主入口
    - [ ] 移除首页主视图中与 `Logs` 等级相同的独立日志入口
    - [ ] 移除首页主视图中与 `Artifacts` 等级相同的独立截图 / 输出物入口
    - [ ] 移除首页主视图中与 `Runtime` 等级相同的 executor / sandbox / socket 状态总览入口
    - [ ] 保留必要跳转，但不再保留平级主卡片或平级主面板

- [ ] 3. 收口日志能力
  - [x] 3.1 日志实时滚动
  - [ ] 3.2 日志暂停滚动
  - [x] 3.3 日志类型高亮
  - [ ] 3.4 移除首页其他位置重复展示的关键日志摘要卡
    - [ ] 不再在墙上中心重复显示日志流
    - [ ] 不再在中央浮层常驻区域重复显示最近日志片段
    - [ ] 不再在任务详情顶部保留与首页 runtime dock 并列竞争的日志主入口

- [ ] 4. 收口 artifact 能力
  - [x] 4.1 统一 artifact 列表
  - [x] 4.2 统一预览 / 下载入口
  - [x] 4.3 让截图与输出结果进入统一 runtime dock
  - [ ] 4.4 移除首页和详情页中重复散落的 artifact 主入口
    - [ ] 移除详情页顶部或首页主区域中的截图主卡片
    - [ ] 移除输出结果在多个摘要卡和多个面板里的重复入口
    - [ ] 保留轻量计数或最近产物提示，但点击主入口统一回到 runtime dock 的 `Artifacts`

- [ ] 5. 收口 executor 状态
  - [x] 5.1 汇总 executor 摘要
  - [ ] 5.2 汇总 socket / callback 状态
  - [x] 5.3 显示最近失败原因和最近动作
  - [ ] 5.4 移除 executor / socket 状态在首页多面板并列展示
    - [ ] 墙上中心不再承担 executor 细项
    - [ ] `Splitter` 折叠区不再承担 executor / socket / callback 细项
    - [ ] 右侧控制区不再重复放独立 runtime 总览
    - [ ] executor / socket / callback / recent action / recent failure 一律归入 runtime dock 的 `Runtime`

- [ ] 6. 强化 decision 等待态
  - [ ] 6.1 decision 步骤显式标为 waiting
  - [ ] 6.2 右侧控制区与当前 waiting 步骤联动
  - [ ] 6.3 区分“墙上 waiting 信号”和“Splitter 辅助信息”
    - [ ] 墙上中心只显示 waiting 本身
    - [ ] `Splitter` 折叠区承接 decision prompt、blocker detail、next step、clarification context
    - [ ] 不在墙上中心重复展开 decision 详细说明
    - [ ] 不在右侧控制区外再复制一套 waiting 决策摘要卡

- [ ] 7. 完成运行态回归
  - [ ] 7.1 验证成功链路
  - [ ] 7.2 验证失败链路
  - [ ] 7.3 验证超时与取消链路
  - [ ] 7.4 验证首页与任务详情之间不存在新的运行证据重复主入口
  - [ ] 7.5 验证“墙上中心 / Splitter / runtime dock”三段归位后不存在重复
    - [ ] 同一条任务步骤不会在墙上中心和中央浮层顶部各出现一次
    - [ ] 同一条 blocker / next step 不会在墙上中心和 `Splitter` 折叠区各出现一次
    - [ ] 同一组 executor / socket / recent failure 不会在右侧控制区和 runtime dock 各出现一次
    - [ ] 同一组 artifact 入口不会在详情页顶部和 runtime dock 各保留一套主入口

## 重复项移除清单

- [ ] 墙上中心已承接的内容，不再在中央浮层顶部重复
  - 状态：进行中
  - [x] 当前步骤
  - [x] 当前步骤状态
  - [x] 当前一句话摘要
  - [x] 当前进度
- [ ] `Splitter` 折叠区只保留按需信息，不再常驻重复墙上内容
  - 状态：进行中
  - [x] `blocker detail`
  - [x] `next step`
  - [x] `current owner`
  - [x] `pending launch`
  - [x] `clarification context`
- [ ] runtime dock 成为运行证据唯一主出口后，需要移除重复主入口
  - 状态：进行中
  - 进展说明：`Deep workspace` 内嵌完整详情已不再重复渲染 runtime snapshot / executor / terminal / timeline / artifacts / failure 面板，但右栏外层摘要和详情页主入口仍待继续收口
  - [ ] 重复日志流
  - [ ] 重复截图 / 产物入口
  - [ ] 重复 executor / socket / callback 状态总览
  - [ ] 重复 recent failure / recent action 摘要面板
