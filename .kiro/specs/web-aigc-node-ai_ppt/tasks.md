# 任务清单：AI PPT 节点

- [x] 定义 PPT 生成输入输出
  - `shared/web-aigc-ai-ppt.ts` 已定义 `ai_ppt` 节点 API、输入参数、页纲结构、artifact 元数据与执行结果类型。
  - 当前最小输入支持 `topic / brief / sourceText / audience / locale / slideCount`，可满足最小演示文稿生成场景。

- [x] 设计文件生成适配器
  - `server/routes/node-adapters/ai-ppt-node-adapter.ts` 已实现最小 node adapter：
    - 校验输入
    - 调用可注入的 deck 生成器
    - 生成失败时自动回退到本地模板页纲
    - 输出统一 `context / warnings / observability`

- [x] 打通 artifact 下载
  - `server/routes/ai-ppt.ts` 已提供：
    - `POST /api/ai-ppt/nodes/execute`
    - `GET /api/ai-ppt/outputs/:outputId/:filename`
  - 当前最小 artifact 为持久化到 `tmp/ai-ppt-outputs/<outputId>/` 下的 `.ppt.json` 结构化产物，可直接下载。

- [x] 验证生成失败回退逻辑
  - `server/tests/ai-ppt-node-adapter.test.ts` 已覆盖：
    - 正常生成
    - 失败后回退到本地页纲
    - 空输入校验
  - `server/tests/ai-ppt-routes.test.ts` 已覆盖：
    - 路由执行
    - artifact 下载
    - 缺失产物返回 404
    - 生成失败但仍返回 degraded 闭环

说明：
- 当前实现的是“最小可运行闭环”：
  - 返回结构化页纲与可下载 artifact
  - 支持失败回退
  - 支持最小下载链路
- 当前未实现真实 `.pptx` 二进制文件渲染，也未接入主线 runtime/index 自动注册；这部分需要主代理按主线接线策略统一处理。
