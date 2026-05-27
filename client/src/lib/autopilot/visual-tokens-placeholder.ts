/**
 * autopilot-image-rendering-and-visual-system · Phase 2 软耦合接口（占位单一替换点）
 *
 * ⚠️ 单一替换点说明（Phase 1 + Phase 3 组件契约）：
 * --------------------------------------------------------------------
 * 本模块是 Phase 1 与 Phase 3 客户端组件取色的 **唯一** 单一替换点。
 *
 * Phase 1 / Phase 3 组件 **必须** 从本文件 import `VisualTokenSet`、
 * `VisualTokenKey`、`OklchPair`、`visualTokens`、`VISUAL_TOKEN_KEYS`
 * 与 `resolveToken`，**禁止** 在 component 内部直接 `import`
 * `./visual-tokens` 或 `client/src/lib/autopilot/visual-tokens`。
 *
 * 这层占位有两个目的：
 * 1. 在 Phase 2 调色板真正落地（或后续替换为 CSS 变量 / 其它来源）之前，
 *    保持 Phase 1 + Phase 3 组件可独立开发与测试。
 * 2. 一旦需要切换调色板来源（例如改为读取 `client/src/index.css` 的 CSS
 *    变量、读取主题 store 或读取远端配置），只需要修改 **本文件一处**
 *    的 re-export 内容即可全局生效，所有消费方零改动。
 *
 * 因此：
 * - 严禁在 Phase 1 / Phase 3 组件源码中出现
 *   `from "./visual-tokens"` / `from "@/lib/autopilot/visual-tokens"`
 *   等直接依赖。
 * - CI / 代码审查时若发现组件直接 import `visual-tokens.ts`，应当立即拒收。
 * - 本模块自身只做纯 re-export，不引入任何运行时逻辑，避免破坏单一替换点语义。
 *
 * @see Requirements 17.2, 17.3
 */

// 类型层 re-export（type-only，避免在运行时引入额外副作用）。
export type {
  VisualTokenKey,
  OklchPair,
  VisualTokenSet,
} from "./visual-tokens";

// 运行时值 re-export（调色板常量、key 顺序与 resolver 函数）。
export { VISUAL_TOKEN_KEYS, visualTokens, resolveToken } from "./visual-tokens";
