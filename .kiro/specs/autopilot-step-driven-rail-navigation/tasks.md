# 任务清单：Autopilot 右栏步骤驱动导航与响应式收口

本 spec 的任务按「独立 PR 可合入」原则拆成 12 个任务。每个任务完成后：

- `node --run check` 通过，不扩大现有 TypeScript 基线错误数
- `npm exec vitest run client/src/pages/autopilot/right-rail/hooks` 通过（本 spec 新增 unit + PBT）
- `npm exec vitest run client/src/pages/autopilot` 通过（Spec 1/3/4 已有断言不回归）
- `npm exec vitest run client/src/pages/specs` 通过（Spec 2/4 已有断言不回归）

改动文件范围（Requirement 12.9）：

- 新增 `client/src/pages/autopilot/right-rail/hooks/use-right-rail-sub-stage-state.ts`
- 新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-right-rail-sub-stage-state.test.ts`
- 新增 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-right-rail-sub-stage-state.property.test.ts`
- 可选新增 `client/src/pages/autopilot/right-rail/hooks/use-viewport-tier.ts` 与对应测试
- 可选新增 `client/src/pages/autopilot/right-rail/__tests__/rail-navigation.integration.test.tsx`
- 修改 `client/src/pages/autopilot/right-rail/index.ts`（新增 re-export）
- 修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`（scroll container、anchor、tab、sticky toggle、sr-announcer、键盘、collapse toggle）
- 修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`（接入 hook、Provider、Viewport_Tier 分支、drawer trigger）
- 按需修改相关测试文件

---

- [x] 1. 新增 `useRightRailSubStageState` hook 骨架 + Context 定义 + barrel 导出
  - 新建 `client/src/pages/autopilot/right-rail/hooks/use-right-rail-sub-stage-state.ts`
  - 导出类型 `RightRailSubStageContextValue`：`{ effectiveSubStage: AutopilotRailSubStage | undefined; pinnedSubStage: AutopilotRailSubStage | null; isPinned: boolean; setPinnedSubStage: (next: AutopilotRailSubStage | null) => void; resetPin: () => void; togglePin: () => void }`
  - 导出 `RightRailSubStageContext = createContext<RightRailSubStageContextValue | null>(null)` 与 `useRightRailSubStageContext()` helper（Context 缺失时返回 `NULL_CONTEXT_FALLBACK` 降级对象：`isPinned = false`、`toggle / reset / set` 为 no-op）
  - 实现 `useRightRailSubStageState({ jobStage, resolvedSubStage })` 骨架：先只返回 `{ effectiveSubStage: resolvedSubStage, pinnedSubStage: null, isPinned: false, setPinnedSubStage: () => {}, resetPin: () => {}, togglePin: () => {} }`（纯派生，不读写 URL、不写 state）
  - 在 `client/src/pages/autopilot/right-rail/hooks/` 下新建 `index.ts` barrel：`export * from "./use-right-rail-sub-stage-state";`（如 Spec 4 已新建 barrel 则在其基础上追加）
  - 修改 `client/src/pages/autopilot/right-rail/index.ts`：追加 `export { useRightRailSubStageState, useRightRailSubStageContext, RightRailSubStageContext, type RightRailSubStageContextValue } from "./hooks/use-right-rail-sub-stage-state";`
  - **涉及文件**：新增 `client/src/pages/autopilot/right-rail/hooks/use-right-rail-sub-stage-state.ts`；按需新增/修改 `client/src/pages/autopilot/right-rail/hooks/index.ts`；修改 `client/src/pages/autopilot/right-rail/index.ts`
  - **测试**：`node --run check` 通过；Spec 1-4 所有现有测试保持通过
  - **验收**：hook 签名与 Context 结构与 `design.md` 一字不差；其他 spec 产物无改动
  - _需求：Requirement 6.1、6.5、Requirement 12.9_

- [x] 2. 实现 URL `?sub=xxx` 同步（读 / 写 / 非法值降级）
  - 在 `use-right-rail-sub-stage-state.ts` 中实现 `readInitialSubStageFromUrl(): AutopilotRailSubStage | null`：从 `window.location.search` 读取 `?sub`，只有在 `RAIL_SUB_STAGE_ORDER` 中时返回，否则返回 `null`
  - 实现 `writeUrlSubParam(next: AutopilotRailSubStage | null): void`：通过 `new URL(window.location.href)` 构造新 URL（保留 pathname、hash、其他 query），使用 `window.history.replaceState(null, "", nextHref)` 写入；`next === null` 时删除 `sub` 参数
  - 在 hook 内部用 lazy `useState<AutopilotRailSubStage | null>(() => readInitialSubStageFromUrl())` 初始化 `pinnedSubStage`
  - 在 hook 首次 `useEffect(() => { ... }, [])` 中检查 `window.location.search` 的 `sub` 是否合法；若非法，调用 `writeUrlSubParam(null)` 清理 URL（不触发 state 变化）
  - 实现 `setPinnedSubStage(next)`（`useCallback`）：同步更新内部 state + 写 URL
  - 实现 `resetPin()`（`useCallback`）：等价于 `setPinnedSubStage(null)`
  - 实现 `togglePin()`（`useCallback`）：根据当前 `pinnedSubStage` 状态切换；`null → resolvedSubStage`（或 `RAIL_SUB_STAGE_ORDER[0]` 兜底），`非 null → null`；同步写 URL
  - `effectiveSubStage` 通过 `useMemo` 派生：`pinnedSubStage ?? resolvedSubStage`
  - `isPinned` 通过 `pinnedSubStage !== null` 派生
  - 最终返回对象通过 `useMemo` 包裹确保引用稳定
  - **涉及文件**：修改 `client/src/pages/autopilot/right-rail/hooks/use-right-rail-sub-stage-state.ts`
  - **测试**：在 `__tests__/use-right-rail-sub-stage-state.test.ts` 中补充 unit 断言：URL 合法值初始化到 `pinnedSubStage`；URL 非法值初始化到 `null` 并清理 URL；`setPinnedSubStage(x)` 写入 URL；`setPinnedSubStage(null)` 删除 URL `sub` 参数；`togglePin()` 两次回到初始；`replaceState` 被调用而非 `pushState`；保留其他 query 参数不变
  - **验收**：URL 与 state 完全同步；幂等写不产生额外 history 条目；非法 URL 不抛错
  - _需求：Requirement 1.1、1.2、1.3、1.4、1.6、1.7、Requirement 2.6、Requirement 6.6、6.7_

- [x] 3. 在 `<AutopilotRightRail>` 内补 scroll container + anchor + 派生 scroll effect（尊重 prefers-reduced-motion）
  - 在 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` 中新增 `const scrollRef = useRef<HTMLDivElement>(null)` 与 `const firstMountRef = useRef<boolean>(true)`
  - 将 fabric 子阶段面板容器包装成 `<div ref={scrollRef} data-testid="autopilot-right-rail-scroll-container" className="relative h-full overflow-y-auto">`
  - 对 `RAIL_SUB_STAGE_ORDER` 的 8 个子阶段各渲染一个 `<section key={subStage} data-sub-stage-anchor={subStage} className="scroll-mt-4" aria-hidden={effectiveSubStage !== subStage}>`；只在 `effectiveSubStage === subStage` 时渲染对应 Spec 2 canonical 面板，其他 section 为空外壳（anchor 保持可 `querySelector`）
  - 添加 `useEffect([effectiveSubStage])`：查找 `scrollRef.current?.querySelector([data-sub-stage-anchor="..."])`，读取 `window.matchMedia("(prefers-reduced-motion: reduce)").matches`；若 `firstMountRef.current === true` 或 reduced motion 为 true，用 `behavior: "auto"`，否则用 `behavior: "smooth"`；调用 `scrollIntoView({ behavior, block: "start" })`；首次执行后置 `firstMountRef.current = false`
  - anchor 未找到（`<section>` 尚未挂载或渲染 null）时 no-op，不抛错
  - **涉及文件**：修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - **测试**：在 `__tests__/use-right-rail-sub-stage-state.test.ts` 或独立的 `__tests__/rail-navigation.integration.test.tsx` 中补 unit/集成断言：`effectiveSubStage` 变化触发 `scrollIntoView` 被调用一次；首次挂载 `behavior === "auto"`；`matchMedia` mock 为 `{ matches: true }` 时 `behavior === "auto"`；切换到不存在 anchor 的 subStage 不抛错
  - **验收**：子阶段切换自动滚动；首次挂载无视觉跳变；`prefers-reduced-motion` 生效；非 scroll container 的 `document.scrollingElement` 不被滚动
  - _需求：Requirement 3.1、3.2、3.3、3.4、3.5、3.7、Requirement 9.1（anchor testid）、Requirement 12.5（不改 canonical 面板）_

- [x] 4. 实现键盘快捷键 `[` / `]` / `Esc` / `Shift + P`（含 Key_Input_Focus_Guard）
  - 在 `<AutopilotRightRail>` 内（或通过 `useRightRailSubStageContext()` 读 toggle / setPinnedSubStage）新增 `useEffect` 注册 `document.addEventListener("keydown", handler)`
  - 实现 `isInputFocused(target)` helper：若 `target` 是 `<input>` / `<textarea>` / `<select>` / `contenteditable` 或其子孙，返回 `true`
  - 实现 handler 逻辑：
    - 若 `isInputFocused(event.target)` 为 `true`，早退 no-op
    - 若 `event.metaKey || event.ctrlKey || event.altKey`，早退 no-op
    - 若 `currentStage !== "fabric"`，只处理 `Escape` 关闭 drawer；其余早退
    - `event.key === "["`：`stepPrev()`
    - `event.key === "]"`：`stepNext()`
    - `event.key === "P" && event.shiftKey`：`togglePin()`
    - `event.key === "Escape" && drawerOpen`：`setDrawerOpen(false)`
  - 实现 `stepPrev` / `stepNext`（`useCallback`）：计算 `RAIL_SUB_STAGE_ORDER.indexOf(effectiveSubStage)`，Math.max(0, idx - 1) / Math.min(length - 1, idx + 1)；若 `nextIdx === idx` 为 no-op（边界不循环）；调用 `setPinnedSubStage(RAIL_SUB_STAGE_ORDER[nextIdx])`
  - unmount 时 `document.removeEventListener("keydown", handler)`
  - 添加键盘提示元素 `<div data-testid="autopilot-right-rail-keyboard-hint">`，展示 `[` / `]` / `Esc` / `Shift+P` 的作用说明（i18n 文案）；可有一个 dismiss 按钮关闭提示（session scope）
  - **涉及文件**：修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - **测试**：在 `use-right-rail-sub-stage-state.test.ts` 或独立集成测试中断言：`[` / `]` 触发 pinnedSubStage 前后切换；边界处为 no-op；`Shift + P` 触发 togglePin；`Escape` 仅在 drawerOpen 时触发 setDrawerOpen(false)；在 `<input>` focus 内按键被跳过；`Cmd + [` 被跳过；非 fabric 阶段 `[` / `]` / `Shift + P` 为 no-op
  - **验收**：键盘操作不干扰输入框；边界不越界、不循环；提示元素可见且可 dismiss
  - _需求：Requirement 4.1、4.2、4.3、4.4、4.5、4.6、4.7、4.8、Requirement 8.5、Requirement 9.1（keyboard-hint testid）_

- [x] 5. 新增 `useViewportTier` hook + Viewport_Tier 三档渲染分支
  - 新建 `client/src/pages/autopilot/right-rail/hooks/use-viewport-tier.ts`（或内联在 `AutopilotRightRail.tsx` / `AutopilotRoutePage.tsx` 视耦合度决定）
  - 导出 `ViewportTier = "drawer" | "side-collapsible" | "side-fixed"` 与 `useViewportTier(): ViewportTier` hook
  - 实现：`useState` 初始化 `resolveTier(window.innerWidth)`；`useEffect` 注册两个 `matchMedia("(min-width: 768px)")` 与 `matchMedia("(min-width: 1280px)")` 的 change listener；unmount 时 `removeEventListener`
  - `resolveTier(w)`: `w < 768 → "drawer"`, `w < 1280 → "side-collapsible"`, 否则 `"side-fixed"`
  - 在 `AutopilotRoutePage.tsx` 的 fabric 分支（或对应接线点，按 Spec 3 决策）按 `tier` 分三档渲染：
    - `"drawer"`：不渲染右列；渲染 drawer trigger button（`data-testid="autopilot-right-rail-drawer-trigger"`，i18n 「展开右栏 / Expand rail」）；渲染 `<HoloDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={...} width={400}>` 包裹 `<div data-testid="autopilot-right-rail-drawer"><AutopilotRightRail ... /></div>`；drawer 内**不**渲染 `<AutopilotWorkflowRail>` 5 阶段时间线
    - `"side-collapsible"`：保留 400px 右列；在面板顶部渲染 collapse toggle（`data-testid="autopilot-right-rail-collapse-toggle"`，`aria-expanded` 同步）；`collapsed === true` 时右列切换为 `w-0 overflow-hidden` 或等价 hidden；grid 列从 `minmax(0,1fr)_400px` 切换为单列
    - `"side-fixed"`：Spec 3 现状，无折叠开关、无 drawer 触发
  - tier 从 `"drawer"` 切换到其他 tier 时通过 `useEffect([tier])` 自动 `setDrawerOpen(false)`
  - **涉及文件**：新增 `client/src/pages/autopilot/right-rail/hooks/use-viewport-tier.ts`；修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`（接入 Viewport_Tier 渲染分支）；可能修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`（collapse toggle 若放在组件内部）
  - **测试**：在 unit 测试中 stub `window.matchMedia` 与 `window.innerWidth` 触发 tier 切换；断言三档对应的 DOM：drawer 下只见 trigger 与 drawer（当 open=true 时）；side-collapsible 下见 collapse toggle；side-fixed 下既不见 trigger 也不见 collapse toggle；tier 从 drawer 切到 side-fixed 时 drawer 被自动关闭
  - **验收**：三档响应式切换正确；`<HoloDrawer>` 现有签名未扩展；drawer 内不渲染 5 阶段时间线；非 fabric 阶段 trigger / collapse toggle 不可见
  - _需求：Requirement 5.1、5.2、5.3、5.4、5.5、5.6、5.7、Requirement 9.1（drawer-trigger / drawer / collapse-toggle testid）_

- [x] 6. 实现 Sticky_Toggle UI + sr-announcer + tab aria-current
  - 在 `<AutopilotRightRail>` header（8 子阶段 tab 栏右侧）渲染 `<button data-testid="autopilot-right-rail-sticky-toggle" aria-pressed={isPinned} aria-label={...} onClick={togglePin}>`
  - 文案 i18n：pinned 态 `"已暂停跟随" / "Pinned"`；非 pinned 态 `"跟随进度" / "Following"`；使用项目现有 `t(locale, zh, en)` helper（从 `AutopilotRightRailProps.locale` 读）
  - 图标使用 `lucide-react` 的 `Pin` / `PinOff`（或等价图标）
  - 8 个子阶段 tab（`data-testid="autopilot-right-rail-sub-stage-tab-<subStage>"`）在 `currentSubStage === subStage` 时设置 `aria-current="location"`
  - tab 点击调用 `onSubStageChange(subStage)`（本 spec 在 task 9 中把 `onSubStageChange` 接为 `setPinnedSubStage`）
  - 新增 `<div data-testid="autopilot-right-rail-sr-announcer" aria-live="polite" className="sr-only">`，通过 `useEffect([effectiveSubStage])` 写入当前子阶段的 i18n 文案（如 `"已切换到 Spec 树 / Switched to Spec tree"`）
  - 非 fabric 阶段不渲染 sticky toggle 与 sr-announcer
  - **涉及文件**：修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - **测试**：unit 断言 sticky toggle 存在、`aria-pressed` 同步 `isPinned`、点击调用 `togglePin`；tab `aria-current` 切换；sr-announcer `aria-live="polite"` 且 `sr-only` class 存在
  - **验收**：所有新 testid 存在；aria 属性正确；视觉上 sticky toggle 与当前 tab 栏对齐
  - _需求：Requirement 2.4、2.5、Requirement 8.1、8.2、8.4、8.6、Requirement 9.1（sticky-toggle / sr-announcer / sub-stage-tab testid）_

- [ ] 7. 在 `AutopilotRoutePage.tsx` fabric 分支接入 hook + Context Provider
  - 在 fabric 分支顶部新增：
    ```tsx
    const resolvedSubStage = useMemo(() => resolveRailSubStage({
      currentStage: "fabric",
      job: latestJob,
      selection,
      specTree,
      agentCrew: autopilotAgentCrew,
    }), [latestJob, selection, specTree, autopilotAgentCrew]);
    const subStageState = useRightRailSubStageState({
      jobStage: latestJob?.stage ?? null,
      resolvedSubStage,
    });
    ```
  - 把 `subStageState.effectiveSubStage` 喂给 Spec 4 hook 的 `options.currentSubStage`（原本是 `currentSubStage = resolvedSubStage`，现在换成 `subStageState.effectiveSubStage`）
  - 把 `subStageState.effectiveSubStage` 作为 `<AutopilotRightRail currentSubStage={...}>` props 下传
  - 把 `subStageState.setPinnedSubStage` 作为 `<AutopilotRightRail onSubStageChange={...}>` props 下传（替代 Spec 3/4 的 `() => {}` no-op）
  - 用 `<RightRailSubStageContext.Provider value={subStageState}>` 包裹 `<AutopilotRightRail>`，让内部消费 `isPinned / togglePin`
  - 非 fabric 阶段行为不变（仍由 `<AutopilotWorkflowRail>` 原逻辑承接）
  - **涉及文件**：修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`；按需修改 `client/src/pages/autopilot/AutopilotRoutePage.test.tsx`（若有 fabric 分支断言）
  - **测试**：`AutopilotRoutePage.test.tsx` 已有断言（fold removal、fabric 右栏存在、selection → fabric 不导航）继续通过；补充对 `currentSubStage` / `onSubStageChange` 来源切换的断言（可选）
  - **验收**：`onSubStageChange` 不再是 no-op；URL / pin / scroll / 数据 gate 共用一个 `effectiveSubStage`；非 fabric 阶段完全不受影响
  - _需求：Requirement 6.1、6.2、6.3、6.4、Requirement 7.1、7.2、7.3、7.5、Requirement 11.2、11.5_

- [ ] 8. 在 `AutopilotRoutePage.tsx` 中接入 drawer trigger + collapse toggle + Viewport_Tier 分支
  - 在 fabric 分支内，根据 Task 5 新增的 `useViewportTier()`，按 Viewport_Tier 渲染三档：
    - `"drawer"`：渲染 drawer trigger 按钮（靠近 3D 场景顶部或 `AutopilotSpecTreeHandoffPanel` 旁）+ `<HoloDrawer>` 包裹 `<AutopilotRightRail>`
    - `"side-collapsible"`：400px 右列 + collapse toggle
    - `"side-fixed"`：Spec 3 现状
  - drawer 关闭时清理 drawer 内部 scroll 位置（下次打开自然重新 scroll 到 `effectiveSubStage` anchor）
  - tier 变化时自动 `setDrawerOpen(false)`
  - 所有新增的 trigger / toggle 在 `currentStage !== "fabric"` 时不渲染
  - **涉及文件**：修改 `client/src/pages/autopilot/AutopilotRoutePage.tsx`
  - **测试**：stub `window.innerWidth` + `matchMedia` 验证三档渲染；断言 drawer trigger / collapse toggle 的 testid 与 aria 属性；tier 切换时 drawer 关闭；非 fabric 阶段触发元素不可见
  - **验收**：`<md` 断点下 3D 场景不再被挤压；`md-xl` 下可手动折叠；`≥xl` 保持 Spec 3 现状
  - _需求：Requirement 5.1-5.7、Requirement 9.1（drawer-trigger / collapse-toggle testid）_

- [ ] 9. 完整接通 `onSubStageChange` + 键盘快捷键 Context 消费
  - 确认 `<AutopilotRightRail>` 内部所有 8 个子阶段 tab 的 `onClick` 最终调用 `props.onSubStageChange(subStage)`（Spec 1 契约），而 `AutopilotRoutePage` 把它接为 `setPinnedSubStage`（task 7）
  - 在 `<AutopilotRightRail>` 内部通过 `useRightRailSubStageContext()` 读 `togglePin`、`isPinned`、`setPinnedSubStage`（用于键盘快捷键）；若 Context 缺失（`/specs` 等场景）使用 fallback no-op（不影响展示）
  - 补齐 task 4 的键盘快捷键 handler 逻辑：`[` / `]` 调 `setPinnedSubStage(neighbor)`；`Shift + P` 调 `togglePin()`；`Escape` 调 parent 的 `setDrawerOpen(false)`（通过 prop 或 Context 传入 drawer 状态）
  - 避免 Context 与 props 双路径产生不一致：`<AutopilotRightRail>` 的 `currentSubStage` props 仍是 `effectiveSubStage` 的权威源，`isPinned / togglePin` 来自 Context，不互相替代
  - **涉及文件**：修改 `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`
  - **测试**：补 unit：点击 tab 触发 `onSubStageChange`（被 `setPinnedSubStage` mock 接收）；`[` / `]` / `Shift + P` 在键盘事件下触发对应 hook API；`/specs` 场景下（无 Provider）键盘快捷键为 no-op 且不抛错
  - **验收**：tab 点击 / 键盘 / URL / `job.stage` 推进四条路径最终都更新 `effectiveSubStage`；行为一致
  - _需求：Requirement 1.1、Requirement 2.1、Requirement 4.1-4.4、Requirement 6.1、6.6、Requirement 7.1-7.3_

- [ ] 10. **[PBT]** 编写 fast-check 属性测试（3 条）+ unit 测试补全
  - 新建 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-right-rail-sub-stage-state.property.test.ts`
  - **P1 — URL ⇔ State idempotent**：
    - 生成器：`subStageSeq: fc.array(fc.constantFrom(...RAIL_SUB_STAGE_ORDER), { minLength: 2, maxLength: 6 })`
    - 策略：`beforeEach` 清理 `window.history.replaceState(null, "", "/autopilot")`；`renderHook` 挂载 `useRightRailSubStageState({ jobStage: null, resolvedSubStage: undefined })`；对 `subStageSeq` 中每个 `subStage` 调用 `act(() => result.current.setPinnedSubStage(subStage))`；每次断言 `new URLSearchParams(window.location.search).get("sub") === subStage` 且 `result.current.pinnedSubStage === subStage`；最后一轮再写入相同值验证幂等（通过 mock `history.replaceState` 计数）
    - `numRuns: 50`；失败样本最小化：fast-check 自动 shrink 到最短序列
  - **P2 — Pin semantics**：
    - 生成器：`jobStageSeq: fc.array(fc.constantFrom("input", "clarification", "route_generation", "route_selection", "agent_crew_fabric", "spec_tree", "spec_docs", "preview", "effect_preview", "prompt_packaging", "runtime_capability", "engineering_handoff", "engineering_landing"), { minLength: 2, maxLength: 8 })`；`userActions: fc.array(fc.oneof(fc.record({ type: fc.constant("click-tab"), target: fc.constantFrom(...RAIL_SUB_STAGE_ORDER) }), fc.record({ type: fc.constant("toggle-pin") })), { minLength: 0, maxLength: 10 })`
    - 策略：交错执行 jobStageSeq 与 userActions（例如前 N 个 jobStage → 全部 userActions → 后剩 jobStage）；每轮 `rerender({ jobStage, resolvedSubStage: realResolveRailSubStage({ currentStage: "fabric", job: { stage: jobStage }, ... }) })`；对每个 userAction 调用对应 hook API
    - 断言：最终 `result.current.pinnedSubStage !== null` 时 `effectiveSubStage === pinnedSubStage`；`pinnedSubStage === null` 时 `effectiveSubStage === resolveRailSubStage({ ..., job: { stage: lastJobStage } })`
    - `numRuns: 50`
  - **P3 — Keyboard shortcut boundaries**：
    - 生成器：`keySeq: fc.array(fc.constantFrom("prev", "next"), { minLength: 0, maxLength: 30 })`
    - 策略：挂载 hook（初始 `resolvedSubStage = RAIL_SUB_STAGE_ORDER[0]`）；对 keySeq 每个元素调用 `stepPrev()` / `stepNext()`（通过 hook 暴露的 helper 或 `setPinnedSubStage(neighbor)` 间接）
    - 断言：每步后 `RAIL_SUB_STAGE_ORDER.indexOf(result.current.effectiveSubStage ?? RAIL_SUB_STAGE_ORDER[0]) ∈ [0, RAIL_SUB_STAGE_ORDER.length - 1]`；起点 `prev` 连续为 no-op；终点 `next` 连续为 no-op
    - `numRuns: 100`
  - 在 `__tests__/use-right-rail-sub-stage-state.test.ts` 中补齐 unit 测试：URL 非法值初始化 `null` + 清理；URL 首次挂载 scroll 跳过 smooth（集成测试位置）；`prefers-reduced-motion: reduce` 时 `behavior === "auto"`；`[` / `]` 在 `<input>` focus 内被跳过；`Shift + P` 在非 fabric 为 no-op；drawer 模式下 `Esc` 关闭 drawer；Viewport_Tier resize 时 drawer 自动关闭；`resetPin()` 清除 URL `sub`
  - 可选新建 `__tests__/rail-navigation.integration.test.tsx`：集成测试覆盖 scroll 效果（mock `scrollIntoView`）、keyboard 事件 dispatch、drawer open/close 流
  - **涉及文件**：新增 `use-right-rail-sub-stage-state.property.test.ts`；扩充 `use-right-rail-sub-stage-state.test.ts`；可选新增 `rail-navigation.integration.test.tsx`
  - **测试**：三条 PBT 全部通过；unit 测试全部通过；`numRuns` 控制让测试耗时可接受
  - **验收**：失败时 fast-check 能输出最小化计数示例；测试不依赖真实 `window.history` 泄漏（`beforeEach` 重置）；`matchMedia` / `scrollIntoView` 通过 `vi.stubGlobal` 或等价手段 mock
  - _需求：Requirement 10.1、10.2、10.3、10.4、10.5、10.6、10.7_

- [ ] 11. 测试文件与 testid 断言扩展（确保新 testid 有测试覆盖）
  - 在 `use-right-rail-sub-stage-state.test.ts` 或集成测试中补断言：`autopilot-right-rail-sticky-toggle`、`autopilot-right-rail-keyboard-hint`、`autopilot-right-rail-drawer-trigger`、`autopilot-right-rail-drawer`、`autopilot-right-rail-collapse-toggle`、`autopilot-right-rail-scroll-container`、`autopilot-right-rail-sr-announcer`、`autopilot-right-rail-sub-stage-tab-<subStage>`（8 个）都至少被 `queryByTestId` 或等价断言一次
  - 在 `AutopilotRoutePage.test.tsx`（若适用）补一个 smoke 断言：fabric 阶段下 `autopilot-right-rail-scroll-container` 存在、`onSubStageChange` prop 非 no-op（通过 props-narrowing 或等价手段）
  - 不删除、不重命名 Spec 1-4 已有 testid；Spec 2 的 rendering-parity 测试继续通过
  - **涉及文件**：按需修改 `__tests__/use-right-rail-sub-stage-state.test.ts`、可选 `__tests__/rail-navigation.integration.test.tsx`、`AutopilotRoutePage.test.tsx`
  - **测试**：`npm exec vitest run client/src/pages/autopilot` 全部通过
  - **验收**：所有新增 testid 都有至少一条测试覆盖；旧 testid 断言不回归
  - _需求：Requirement 9.1、9.2、9.5_

- [ ] 12. 端到端回归与 parity 验证
  - `node --run check` 通过，不扩大现有 TypeScript 基线错误数
  - `npm exec vitest run client/src/pages/specs client/src/pages/autopilot` 全部通过，特别包含：
    - Spec 1 `resolve-rail-sub-stage.property.test.ts`（P1/P2/P3 三条 resolver PBT）
    - Spec 2 `props-narrowing.property.test.ts` / `shim-identity.test.ts` / `rendering-parity.test.tsx`
    - Spec 3 `fabric-dispatch.property.test.tsx` / fold removal snapshot / selection → fabric no-navigation
    - Spec 4 的 3 条 PBT + unit 测试
    - Spec 5 本 spec 的 3 条 PBT + unit + 集成测试
  - 人工桌面回归（`≥xl`，如 1440px）：打开 `/autopilot`，推进到 fabric 阶段，确认右列 400px 面板 + sticky toggle 可见；点击子阶段 tab 看到 URL `?sub` 写入；按 `[` / `]` / `Shift + P` 验证快捷键；刷新后位置恢复
  - 人工 tablet 回归（`md-xl`，如 1024px）：确认 collapse toggle 存在、折叠右列后 3D 场景扩展到单列；展开回到 400px 右列
  - 人工 mobile 回归（`<md`，如 414px）：确认右列不可见；drawer trigger 存在；点击后 `<HoloDrawer>` 打开；Esc 关闭 drawer
  - 人工浏览器前进后退回归：用户在子阶段间切换后按 browser back，确认不回到上一子阶段（`replaceState` 不污染堆栈），而是返回到进入 `/autopilot` 前的路由
  - 人工 `prefers-reduced-motion` 回归：在系统层开启 reduced motion，验证子阶段切换无 smooth scroll 动效
  - 人工 `/specs` 页面回归：确认 `SpecCenterPage` → `BlueprintProgressPanel` 行为与 Spec 4 完成后一致；URL `?sub`、sticky pin、键盘快捷键、drawer 在 `/specs` 路径下均**不**启用（本 spec 的 hook 只在 `AutopilotRoutePage` 接入，`/specs` 不受影响）
  - `git diff --name-only` 验证文件改动严格在 Requirement 12.9 限定范围内
  - **涉及文件**：无新增或修改源文件；仅验证与手测
  - **测试**：上述聚合测试命令全部通过
  - **验收**：`/autopilot` 与 `/specs` 端到端行为无 regression；三种宽度断点表现一致；browser back/forward 不被污染；回滚可通过 `git revert` 单一 commit 完成，不影响 Spec 1/2/3/4 的产物
  - _需求：Requirement 11.1、11.2、11.3、11.4、11.5、11.6、Requirement 12.9、12.10_

---

## 任务执行边界

- 本 spec **不**修改 Spec 1 冻结的 `AutopilotRightRailProps` / `AutopilotRailSubStage` / `RAIL_SUB_STAGE_ORDER` / `resolveRailSubStage()`；`<AutopilotRightRail>` 的 9 + 3 个 props 契约保持原样。
- 本 spec **不**修改 Spec 2 的 8 个 canonical 面板签名（`Pick<AutopilotRightRailProps, ...>` + 面板私有字段 `initial*` / `on*Change` / `documents`）；`data-sub-stage-anchor` 加在 scaffolding 层 `<section>` 而非面板内部。
- 本 spec **不**修改 Spec 3 的 fabric 接管结论；`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时接管右列的结论保持不变；`AutopilotSpecTreeHandoffPanel` 次级 `/specs` 链接不变。
- 本 spec **不**修改 Spec 4 `useAutopilotRightRailData(jobId, options)` 的 hook 签名；本 spec 只通过 `options.currentSubStage = effectiveSubStage` 把 state 喂回去，不扩展 options 字段。
- 本 spec **不**新增后端 REST / Socket / DTO；URL 同步只在前端 `window.history.replaceState` 层实现。
- 本 spec **不**订阅 `useAppStore` / `useProjectStore`；`useRightRailSubStageState` 是纯 React hook + `window.history` + `window.matchMedia`。
- 本 spec **不**写 `localStorage` / `sessionStorage`；pin 持久化只靠 URL `?sub=` 参数（session scope）。
- 本 spec **不**引入 feature flag；回滚通过 `git revert` 完成。
- 本 spec **不**做 `<xs`（`<360px`）专门优化、**不**做多 job 并存、**不**做 deep link 到具体 testid 粒度、**不**做 analytics 埋点。
- 本 spec **不**扩展 `client/src/components/HoloDrawer.tsx` 的 `HoloDrawerProps` 签名；drawer 复用现有 `{ open; onClose; title; width?; children }`。
