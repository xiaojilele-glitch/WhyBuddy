# 回放与调试面收口方案 v1 任务拆解

## 当前状态快照（2026-04-20，已按当前路由与入口状态复核）

- 总体状态：进行中，约 88%
- 已有落地：
  - `/replay/:missionId` 路由、`ReplayPage` 主界面与 `server/routes/replay.ts` 已落地
  - 任务详情页已提供“查看回放”入口，可直接跳转 `/replay/:missionId`
  - `/debug` 隐藏壳页已落地，当前提供 `overview / config / permissions / audit / lineage / help` tabs
  - `navigation-config` 已将 `/debug`、`/lineage`、`/command-center*` 定义为低频路径，普通主导航不再直接暴露 lineage
  - `navigation-config` 本轮补齐 path segment 级匹配，`/debug/*`、`/lineage` 与 `/command-center*` 的兼容识别不再误伤 `/debugg`、`/lineage-old`、`/command-center-old` 这类假前缀路径
  - `MoreDrawer` 中的 `config / permissions / audit / help` 已改为统一导向 `/debug` 分区，不再直接从主壳弹出治理类模态
  - 旧 `/lineage` 路径已降级为兼容跳转，主承接面改为 `/debug/lineage`
- 当前剩余：
  - 还缺一轮围绕 `/debug/*` 子路径与旧深链跳转的人工验收
  - 定向自动校验已更新到覆盖 `/debug/help`、`/debug/lineage`、旧深链跳转、query 场景与低频路由误判边界，剩余主要是人工验收真实页面加载、任务详情点击流与 replay 数据承接

## Tasks

- [x] 1. 盘点低频页面与内部能力
  - [x] 1.1 记录回放页现有职责
  - [x] 1.2 记录 lineage / audit / permission / config 入口位置
  - [x] 1.3 标记哪些工作可在主壳 spec 完成前并行推进，哪些必须后置

- [x] 2. 保持回放页稳定
  - [x] 2.1 保留 `/replay/:missionId`
  - [x] 2.2 确认回放页能从任务完成后进入
  - [x] 2.3 确认回放页显示计划、步骤、结果

- [ ] 3. 建立隐藏 debug 面
  - [x] 3.1 复用或新增 `/debug` 路由壳
  - [x] 3.2 设计 debug tabs 或 debug sections
  - [x] 3.3 迁入 lineage / audit / permission / config

- [ ] 4. 从主导航移除低频能力
  - [x] 4.1 在主壳导航定稿后移除 lineage 主导航入口
  - [x] 4.2 在主壳导航定稿后减少 audit / permission / config 对主界面的打扰
  - [x] 4.3 将 help 从主壳 modal 收口到 `/debug/help`

- [ ] 5. 完成兼容与回归
  - [x] 5.1 验证旧功能仍可内部访问
  - [x] 5.2 验证普通用户主流程未受干扰
  - [x] 5.3 验证未与主壳 spec 在路由与导航层形成重复改造
  - [ ] 5.4 补一轮 `/debug/*` 子路径与旧深链跳转的人工验收
    - 收窄为真实访问 `/debug/*` 各子路径，确认页面可打开且各分区内容正常承接
    - 收窄为从任务详情页点击“查看回放”，确认进入 `/replay/:missionId` 后能看到真实 replay 加载结果，而不只是路径正确
