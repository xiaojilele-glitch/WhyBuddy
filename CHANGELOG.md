# Changelog

这个文件记录适合放给使用者、协作者和新接手同学阅读的项目变化。

更细的任务拆分、阶段规划和未完成项请看 [ROADMAP.md](./ROADMAP.md)。

## 2026-06-13

- **产品改名：WhyBuddy → SlideRule（全量迁移）。** 173+ 个文件名、全部内部标识符（类型 / 函数 / 常量 / data-testid / env 名 / localStorage key / API 路由）一次性切换为 SlideRule 系命名。
- 三条持久化边界带兼容垫片过渡（保留一个版本周期，约 4-6 周后移除）：
  - localStorage：启动时把 `whybuddy:*` 自动迁移到 `sliderule:*`（幂等，不覆盖新值；BYOK key 池逐字段保全）。
  - 环境变量：`SLIDERULE_*` 为主，旧 `WHYBUDDY_*` 仍生效（双设时新名优先）。
  - API：`/api/sliderule` 为主挂载，`/api/whybuddy` 别名同 router；默认会话文件 `data/whybuddy-sessions.json` 启动时复制为 `data/sliderule-sessions.json`（原件保留可回滚）。
- 旧脚本名 `verify:whybuddy-v5` / `smoke:whybuddy` / `smoke:whybuddy-store` 保留为别名一个版本周期。
- GitHub 仓库改名后旧链接由 GitHub 301 自动重定向。

## 2026-04-15

- 更新 `README.md`，同步当前产品口径：办公室主壳、统一智能发起入口、底部共享操作区与最近完成的发起/任务操作收敛进展。
- 完成 `launch-operator-surface-convergence` 第一阶段：`UnifiedLaunchComposer` 接入底部任务操作 rail，`OfficeTaskCockpit.tsx` / `TasksPage.tsx` 完成接线。
- 将 `TasksCockpitDetail` 的首屏独立任务操作卡降级为建议与依据区，首屏主操作入口收口到底部共享操作区。
- 为共享操作区补充测试与回归：新增 `LaunchOperatorActionRail` 组件测试，补齐 `unified-launch-coordinator` 的升级前短路与澄清提交流程回归。
- 更新 `.kiro/specs/launch-operator-surface-convergence/tasks.md` 与 `.kiro/steering/execution-plan.md`，同步本轮实现进度与当前剩余手测项。

## 2026-03-30

- 重构 `README.md`，把内容改成更适合首次阅读的结构：30 秒了解、核心链路、快速开始、配置总览、文档入口。
- 新增 `CHANGELOG.md`，把“读者关心的变化”从 README 中拆出来。
- 在 README 中按配置组整理环境变量，降低 `.env` 的理解成本。

## 2026-03-29

- mission 主线相关能力已并入 `main`：`shared/mission/**`、`shared/executor/**`、任务路由、Feishu bridge、lobster executor、brain dispatch 和 `/tasks` 页面进入主仓。
- `/tasks` 任务页收口为更适合 16:9 屏幕的任务驾驶舱，采用 `Overview / Execution / Artifacts` 结构。
- 服务端入口接入 mission / executor / Feishu 集成路由，同时保留原有 workflow / chat / agent 主链。
- `.env.example`、README、mission smoke 脚本和集成文档补齐。

## 2026-03-28

- 项目主定位从“生成 md/json 报告”升级为“真实任务编排 + Docker 执行 + 进度回传 + 可视化交付”。
- 图片附件 OCR 切换为独立浏览器 worker，并补齐超时与降级回退。
- 工作流页改为“总览优先、摘要次之、详情按需展开”的三级信息密度。
- 3D 办公室场景继续减法优化，弱化固定部门装饰感。

## 2026-03-27

- 附件输入从“仅文本”升级为“文本 + 附件”联合提交。
- 附件解析链路支持全文导入 workflow，不再只注入局部摘要。
- 首页与核心页面完成中英文切换和移动端适配。
- 动态组织架构、Skills、MCP 主线合入，固定 18 角色开始让位于按任务生成组织。
- GitHub Pages 预览增加仓库入口，方便从演示页跳转源码仓库。
