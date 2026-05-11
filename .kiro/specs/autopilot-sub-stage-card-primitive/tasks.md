# 任务：autopilot 子阶段 MiroFish 风格卡片原语

- [x] 1. 新建 primitives 目录与 index 文件
  - 创建 `client/src/pages/autopilot/right-rail/primitives/` 目录
  - 创建 `index.ts` 预留 `SubStageStatus` 类型与 re-export 位

- [x] 2. 实现 `<StatusCapsule>` 组件
  - 文件：`primitives/status-capsule.tsx`
  - 按 design.md 实现三种 status 的 label + class 映射
  - 添加 `data-testid="autopilot-status-capsule"` + `data-status` 属性
  - active 胶囊内嵌 `animate-pulse` 白色小圆点

- [x] 3. 实现 `<MetricsRow>` 组件
  - 文件：`primitives/metrics-row.tsx`
  - grid 列数映射 + divide-x 分隔线
  - 使用 `<dl>/<dt>/<dd>` 语义标签
  - value 字号 32px mono + label 10px uppercase + hint 11px 可选

- [x] 4. 实现 `<SubStageCard>` 组件
  - 文件：`primitives/sub-stage-card.tsx`
  - 三种 status 边框样式映射（灰 / 橙加粗 / 淡灰+透明度）
  - Header / ApiPath+Summary / Body / Toggle 四段式
  - 序号补零、locale 文案、`onToggleExpanded` 行为
  - 根节点 `<article>` 支持 `anchorAttr` + `ariaCurrentStep` 两个 prop（Wave 2 挂接契约属性用）：
    - `anchorAttr`：spread 到根节点（如 `data-sub-stage-placeholder="{sub}"`）
    - `ariaCurrentStep`：渲染为 `aria-current="step"`
    - 属性**顺序固定**：anchorAttr 先 spread，aria-current 后直接写，保证 `data-sub-stage-placeholder` 在 `aria-current` 之前

- [x] 5. 导出接口
  - `primitives/index.ts` re-export `SubStageStatus` 类型
  - re-export `StatusCapsule` / `StatusCapsuleProps`
  - re-export `MetricsRow` / `MetricsRowProps` / `Metric`
  - re-export `SubStageCard` / `SubStageCardProps`

- [x] 6. 测试：`status-capsule.test.tsx`（至少 3 case）
  - 中文 completed 显示「构建完成」
  - 英文 active 显示「RUNNING」+ animate-pulse 节点存在
  - pending 有 `bg-[#F5F5F5]` class + `data-status="pending"`

- [x] 7. 测试：`metrics-row.test.tsx`（至少 3 case）
  - 3 列默认：`grid-cols-3` class 存在
  - 2 列 / 4 列可切换
  - 每个 metric 渲染 dd value + dt label + 可选 hint 节点

- [x] 8. 测试：`sub-stage-card.test.tsx`（至少 7 case）
  - completed 边框样式
  - active 边框样式（border-2）
  - pending 透明度
  - 序号补零 04 渲染为 05
  - `onToggleExpanded` 点击回调触发、展开/收起 label 切换
  - `headerRight` 自定义覆盖 StatusCapsule
  - `anchorAttr` + `ariaCurrentStep` 一起传入时，根节点 HTML 中 `data-sub-stage-placeholder` 必须出现在 `aria-current` 之前（用 renderToStaticMarkup + 正则断言）

- [x] 9. 执行验证
  - `npx vitest run client/src/pages/autopilot/right-rail/primitives` 所有测试通过（至少 12 个 case）
  - `node --run check` TS error 数 = 107

- [x] 10. 提交
  - commit message: `feat(autopilot): add MiroFish-style sub-stage card primitives`
  - stage 内容：`client/src/pages/autopilot/right-rail/primitives/**`
  - 禁止 stage `.kiro/blueprint-assets/jobs.json`
