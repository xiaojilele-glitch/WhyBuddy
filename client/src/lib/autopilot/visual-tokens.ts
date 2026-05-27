/**
 * autopilot-image-rendering-and-visual-system · Phase 2
 *
 * Visual token 调色板：8 个语义 key × `light` / `dark` 双主题 OKLCH 取值。
 *
 * 设计要点：
 * - 与 `client/src/index.css` 现有主题系统的 OKLCH 色彩空间保持一致。
 * - 每个语义 key 在 light / dark 双主题下都必须是可读的文本色。
 * - 所有取值均以 `"oklch("` 起始、`")"` 结束，禁止其他色彩字面量混入此模块。
 * - 本模块是项目颜色系统的真相源；Phase 1 + Phase 3 组件只通过
 *   `visual-tokens-placeholder.ts` 间接消费这些取值。
 *
 * @see Requirements 11.1, 11.2, 11.3, 11.4, 18.2
 */

/**
 * 8 个语义 key 的联合类型。
 *
 * 使用建议：
 * - `entry`：项目 / 任务入口（薰衣草 / 紫调）。
 * - `frontend`：前端层（深蓝调）。
 * - `backend-core`：后端核心层（绿调）。
 * - `ai-capability`：AI 能力层（青绿 / teal 调）。
 * - `governance`：治理 / 风控层（紫调）。
 * - `business-loop`：业务闭环（粉调）。
 * - `data-state`：数据状态层（浅蓝调）。
 * - `external-integration`：外部集成层（浅绿调）。
 */
export type VisualTokenKey =
  | "entry"
  | "frontend"
  | "backend-core"
  | "ai-capability"
  | "governance"
  | "business-loop"
  | "data-state"
  | "external-integration";

/**
 * 单一语义 key 的 light / dark 双主题 OKLCH 取值对。
 *
 * 不变量：
 * - `light` 与 `dark` 都必须以 `"oklch("` 起始、以 `")"` 结束。
 * - 两个分支必须都是非空字符串。
 */
export interface OklchPair {
  readonly light: string;
  readonly dark: string;
}

/**
 * 完整的视觉令牌集合：所有 `VisualTokenKey` 必须有完整覆盖。
 */
export type VisualTokenSet = { readonly [K in VisualTokenKey]: OklchPair };

/**
 * 8 个语义 key 的稳定枚举顺序。
 *
 * 使用 `as const` tuple 锁定 length === 8，便于属性测试断言完整性。
 */
export const VISUAL_TOKEN_KEYS: readonly [
  "entry",
  "frontend",
  "backend-core",
  "ai-capability",
  "governance",
  "business-loop",
  "data-state",
  "external-integration",
] = [
  "entry",
  "frontend",
  "backend-core",
  "ai-capability",
  "governance",
  "business-loop",
  "data-state",
  "external-integration",
] as const;

/**
 * 8-key OKLCH 调色板。
 *
 * light / dark 取值均落在项目既有 OKLCH 主题系统（lightness 0~1、chroma ~0-0.2、hue 0-360）
 * 的可读区间内，确保作为文本色在两套主题下都具备充足对比度。
 */
export const visualTokens: VisualTokenSet = {
  // 项目 / 任务入口：薰衣草 / 紫调
  entry: {
    light: "oklch(0.50 0.12 290)",
    dark: "oklch(0.72 0.14 290)",
  },
  // 前端层：深蓝调
  frontend: {
    light: "oklch(0.45 0.12 250)",
    dark: "oklch(0.70 0.15 250)",
  },
  // 后端核心层：绿调
  "backend-core": {
    light: "oklch(0.48 0.10 155)",
    dark: "oklch(0.70 0.14 155)",
  },
  // AI 能力层：青绿 / teal 调
  "ai-capability": {
    light: "oklch(0.50 0.10 195)",
    dark: "oklch(0.72 0.13 195)",
  },
  // 治理 / 风控层：紫调
  governance: {
    light: "oklch(0.48 0.12 310)",
    dark: "oklch(0.70 0.15 310)",
  },
  // 业务闭环：粉调
  "business-loop": {
    light: "oklch(0.55 0.14 340)",
    dark: "oklch(0.72 0.16 340)",
  },
  // 数据状态层：浅蓝调
  "data-state": {
    light: "oklch(0.55 0.10 225)",
    dark: "oklch(0.75 0.13 225)",
  },
  // 外部集成层：浅绿调
  "external-integration": {
    light: "oklch(0.55 0.10 140)",
    dark: "oklch(0.74 0.13 140)",
  },
};

/**
 * 根据语义 key 与当前主题取出对应的 OKLCH 字符串。
 *
 * 等价于 `visualTokens[key][theme]`，封装为函数以便消费方在主题切换时统一接入。
 */
export function resolveToken(
  key: VisualTokenKey,
  theme: "light" | "dark",
): string {
  return visualTokens[key][theme];
}
