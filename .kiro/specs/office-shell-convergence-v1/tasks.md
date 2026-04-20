# 办公室主壳收敛方案 v1 任务拆解

## 当前状态快照（2026-04-20，已按当前代码、路由与入口状态复核）

- 总体状态：进行中，约 97%
- 已有落地：
  - `App.tsx` 已收敛为 `/`、`/tasks`、`/tasks/:taskId`、`/replay/:missionId`、`/debug` 与兼容态 `/command-center/legacy`
  - `/command-center` 已直接 redirect 到 `/`
  - `Toolbar` 主导航已收敛为 `office / more`，`/tasks` 退居 secondary main path
  - `navigation-config` 已将 `/debug`、`/lineage`、`/command-center*` 视为低频路径
  - `/tasks` 页面文案已明确为“查看 / 跟进 / 深度处理”，不再承担发起语义
  - `/debug` 已提供隐藏路由壳，并开始承接 `config / permissions / audit / lineage` 的低频入口策略
  - `MoreDrawer` 中的 `config / permissions / audit / help` 已不再直接起主壳弹窗，而是统一导向 `/debug/config`、`/debug/permissions`、`/debug/audit`、`/debug/help`
  - `/lineage` 已从独立低频页收口为兼容跳转，主承接面改为 `/debug/lineage`
  - `/command-center/legacy` 已从兼容说明页收口为纯兼容跳转壳，不再继续承载旧版工作台心智
- 当前剩余：
  - 尚欠一轮覆盖 `/debug/*` 子路径的人工回归，确认低频入口迁移后无导航迷路
  - `/debug/*` 子路径、`/debug/help`、`/debug/lineage`、兼容跳转与 replay 深链的定向自动校验已补齐，剩余主要是人工回归确认真实页面加载与点击流

## Tasks

- [x] 1. 盘点当前所有高频入口与低频入口
  - [x] 1.1 记录 `App.tsx` 现有路由
  - [x] 1.2 记录 `Toolbar` 和 `navigation-config` 现有主导航语义
  - [x] 1.3 记录首页、任务页、命令中心页各自承担的职责

- [ ] 2. 收敛主路由结构
  - [x] 2.1 保留 `/`
  - [x] 2.2 明确 `/tasks` 为全屏工作台与跟进页，而非发起入口
  - [x] 2.3 保留 `/tasks/:taskId`
  - [x] 2.4 保留 `/replay/:missionId`
  - [x] 2.5 新增或预留 `/debug` 壳路由
  - [x] 2.6 让 `/command-center` redirect 到 `/`
  - [x] 2.7 让 `/command-center/legacy` 退场或仅保留跳转

- [ ] 3. 调整导航心智
  - [x] 3.1 `Toolbar` 不再突出 `/tasks` 为并列主入口
  - [x] 3.2 `navigation-config` 不再把 `/lineage` 视为普通入口
  - [x] 3.3 锁定 `/debug` 的隐藏入口策略与 ownership 边界
  - [x] 3.4 把低频能力迁入 debug / hidden surface
  - [x] 3.5 把 `help` 从主壳 modal 收口到 `/debug/help`

- [x] 4. 首页承担统一发起入口
  - [x] 4.1 首页保留输入、澄清、任务主线和运行信息
  - [x] 4.2 任务页明确为“查看 / 跟进 / 深度处理”而非“发起”
  - [x] 4.3 命令中心页不再继续演进为独立主页面

- [ ] 5. 完成兼容与回归
  - [x] 5.1 验证旧链接打开后不会让用户迷路
  - [x] 5.2 验证任务详情与回放深链无回归
  - [x] 5.3 验证主导航文案与页面文案已经统一
  - [x] 5.4 验证 `/tasks` 在路由、入口和页面文案上不再承担“发起”语义
  - [ ] 5.5 补一轮 `/debug/*` 子路径与兼容跳转的人工回归
    - 收窄为真实访问 `/debug`、`/debug/config`、`/debug/permissions`、`/debug/audit`、`/debug/lineage`、`/debug/help`，确认对应分区可见、More 抽屉不会把用户带回高频主流程
    - 收窄为真实访问 `/lineage`、`/command-center`、`/command-center/legacy`，确认兼容跳转生效且无明显闪烁或迷路
