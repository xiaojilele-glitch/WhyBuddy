/**
 * autopilot-image-rendering-and-visual-system · Phase 3 · Task 24.1
 *
 * `CapabilitySnapshotBadges` 在 `ProjectCockpitHome` 顶栏渲染 4 枚静态项目能力角标，
 * 让用户在打开项目驾驶舱时即建立对项目规模的整体认知：
 *
 * - `14 shared contracts`
 * - `77 specs`
 * - `5 capability bridges`
 * - `Mission/Browser/Docker runtimes`
 *
 * 角标文本完全来自静态配置（`DEFAULT_CAPABILITY_SNAPSHOT_BADGES`），
 * 不依赖任何运行时计算 / 网络 / store 派生。颜色通过 `resolveToken` 间接消费
 * Phase 2 视觉令牌系统，**禁止** 出现 `#`、`rgb(`、`hsl(`、`oklch(` 等颜色字面量。
 *
 * 软耦合策略：
 * - 颜色源严格统一从 `client/src/lib/autopilot/visual-tokens-placeholder` 导入。
 * - 组件不直接 import `./visual-tokens.ts`，确保 Phase 2 调色板替换时只需改一处。
 *
 * @see Requirements 16.1, 16.2, 16.3, 17.1, 18.3
 */

import {
  resolveToken,
  type VisualTokenKey,
} from "@/lib/autopilot/visual-tokens-placeholder";

/**
 * 项目能力角标 id 联合类型。
 *
 * 4 个 id 与 `DEFAULT_CAPABILITY_SNAPSHOT_BADGES` 中的静态配置一一对应，
 * 也与 `design.md` 中的 `CapabilitySnapshotBadge` 接口保持字段级一致。
 */
export type CapabilitySnapshotBadgeId =
  | "shared-contracts"
  | "specs"
  | "capability-bridges"
  | "runtimes";

/**
 * 单一项目能力角标。
 *
 * - `id`：稳定标识，用于 React `key` / `data-testid` / 颜色映射。
 * - `text`：角标静态文本，禁止运行时拼接。
 */
export interface CapabilitySnapshotBadge {
  readonly id: CapabilitySnapshotBadgeId | string;
  readonly text: string;
}

/**
 * `CapabilitySnapshotBadges` 组件 props。
 *
 * - `badges`：长度恒为 4 的角标数组，缺省回退到 `DEFAULT_CAPABILITY_SNAPSHOT_BADGES`。
 * - `theme`：当前主题，用于通过 `resolveToken` 解析 OKLCH 颜色。
 * - `className`：可选样式扩展点，方便挂载方控制对齐与间距。
 */
export interface CapabilitySnapshotBadgesProps {
  readonly badges?: ReadonlyArray<CapabilitySnapshotBadge>;
  readonly theme: "light" | "dark";
  readonly className?: string;
}

/**
 * Spec 钉死的 4 枚静态项目能力角标。
 *
 * 文本顺序与 Requirement 16.1 中的列举顺序严格一致：
 * `shared contracts → specs → capability bridges → runtimes`。
 */
export const DEFAULT_CAPABILITY_SNAPSHOT_BADGES: ReadonlyArray<CapabilitySnapshotBadge> =
  [
    { id: "shared-contracts", text: "14 shared contracts" },
    { id: "specs", text: "77 specs" },
    { id: "capability-bridges", text: "5 capability bridges" },
    { id: "runtimes", text: "Mission/Browser/Docker runtimes" },
  ] as const;

/**
 * 每个角标 id 对应的语义视觉令牌 key。
 *
 * 选择原则：
 * - `shared-contracts` 表达跨端契约 → `data-state`（数据状态层）。
 * - `specs` 表达产品规格说明 → `frontend`（前端 / 产品交付层）。
 * - `capability-bridges` 表达能力桥 → `ai-capability`（AI 能力层）。
 * - `runtimes` 表达运行时家族 → `backend-core`（后端核心层）。
 *
 * 任何未知 id 会回退到 `entry`，避免组件因新增静态 id 而抛错。
 */
const BADGE_TOKEN_KEY: Readonly<Record<string, VisualTokenKey>> = {
  "shared-contracts": "data-state",
  specs: "frontend",
  "capability-bridges": "ai-capability",
  runtimes: "backend-core",
};

const FALLBACK_TOKEN_KEY: VisualTokenKey = "entry";

/**
 * `CapabilitySnapshotBadges` — `ProjectCockpitHome` 顶栏 4 静态角标。
 *
 * 行为约束：
 * - 严格渲染 `badges` 数组中的每一项为 inline pill 元素。
 * - 颜色全部来自 `resolveToken`：背景取语义 key 的 `light` 变体，文字取 `dark` 变体，
 *   形成 cockpit 风格的「深底亮字」徽标；同时通过当前 `theme` 间接保留主题切换钩子。
 * - 不持有任何运行时副作用、不读取任何 store、不发起任何请求。
 */
export function CapabilitySnapshotBadges({
  badges = DEFAULT_CAPABILITY_SNAPSHOT_BADGES,
  theme,
  className,
}: CapabilitySnapshotBadgesProps) {
  return (
    <ul
      role="list"
      data-testid="capability-snapshot-badges"
      data-theme={theme}
      className={
        className ??
        "flex flex-wrap items-center gap-2"
      }
    >
      {badges.map((badge) => {
        const tokenKey: VisualTokenKey =
          BADGE_TOKEN_KEY[badge.id] ?? FALLBACK_TOKEN_KEY;
        // background 使用语义 key 的 `light` 变体（深底），text 使用 `dark` 变体（亮字）。
        // 同时调用 `resolveToken` 以保留主题切换钩子；当前 spec 仅消费 light/dark 两套字面量。
        const backgroundColor = resolveToken(tokenKey, "light");
        const textColor = resolveToken(tokenKey, "dark");
        // 调用一次 `resolveToken(tokenKey, theme)` 让 `theme` 实参在运行时生效，
        // 避免 lint 把 prop 标为未使用，也方便 Phase 2 主题动态扩展。
        const themedAccent = resolveToken(tokenKey, theme);
        return (
          <li
            key={badge.id}
            data-testid={`capability-snapshot-badge-${badge.id}`}
            data-badge-id={badge.id}
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-tight ring-1 ring-inset"
            style={{
              backgroundColor,
              color: textColor,
              // ring 颜色跟随当前主题的语义色，强化主题切换可感知度。
              boxShadow: `inset 0 0 0 1px ${themedAccent}`,
            }}
          >
            {badge.text}
          </li>
        );
      })}
    </ul>
  );
}

export default CapabilitySnapshotBadges;
