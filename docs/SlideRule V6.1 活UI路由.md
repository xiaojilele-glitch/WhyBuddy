# SlideRule V6.1 活 UI 路由

一张一个事实：产品主入口是 `/agent-loop/sliderule`。Autopilot 不是主线。
`/` 与 `/sliderule` 都重定向到它。侧栏第一项是「推演」。应用市场仍是活面，不要盖 legacy。

路径：`client/src/App.tsx`；`NAV_GROUPS` 在 `DashboardApp.tsx`。

```mermaid
flowchart TB
  ROOT["/ 与 /sliderule"] --> MAIN["/agent-loop/sliderule<br/>推演 · 主产品"]
  NAV[侧栏第一项 推演] --> MAIN
  MAIN --> WB[应用市场 AppsWorkbench<br/>活 · 不要标不维护]

  AUTO["/autopilot"] --> LEG[URL 保留 · 页顶 legacy]
  PRJ["/projects /tasks"] --> LEG
  LWB["workbench/legacy · settings/legacy"] --> LEG
```
