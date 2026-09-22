/**
 * 画布连线的曲线：照 ComfyUI 的口径算控制点（2026-08-28）。
 *
 * ## 为什么不用 React Flow 自带的 bezier
 *
 * `@xyflow/system` 的 `calculateControlOffset`：
 *
 *     if (distance >= 0) return 0.5 * distance;
 *     return curvature * 25 * Math.sqrt(-distance);
 *
 * 两个问题：
 *
 *   1. **顺向时控制点摆在半程**（0.5）。长线上就是一条又宽又平的懒弧——
 *      两点之间明明很直，线却先鼓出去一大块再绕回来。
 *   2. `curvature` 参数**只作用于逆向那一支**，顺向那半是写死的，
 *      调参数改不动我们真正想改的东西。
 *
 * ComfyUI_frontend `src/renderer/core/canvas/pathRenderer.ts` 的
 * `calculateControlPoints`（本地 clone，commit 5d24e4e）：
 *
 *     const dist = Math.sqrt((ex-sx)**2 + (ey-sy)**2)
 *     const controlDist = Math.max(30, dist * 0.25)
 *     // 偏移方向由**出入方向**给（getDirectionOffset）
 *
 * 三处不同，每一处都影响观感：
 *
 *   · **0.25 不是 0.5** —— 曲线贴着两点之间那条直线走，短、有方向感
 *   · **按欧氏距离**，不是按单轴距离 —— 斜着连的线不会因为某一轴短就塌成直角
 *   · **有下限 30** —— 很近的两点也留一点弧，不会退化成折线
 *
 * ⚠ 这个文件是**纯函数**，判据钉在这一层（画布组件在 jsdom 里跑不动，
 *   理由同 canvas-board-layout 头注）。
 */

import { Position } from "@xyflow/react";

/** 控制点偏移的下限。近距离也留一点弧，别退化成折线。 */
export const MIN_CONTROL_DIST = 30;
/** 控制点偏移占两点距离的比例。ComfyUI 是 0.25。 */
export const CONTROL_DIST_RATIO = 0.25;

/**
 * 控制点离锚点多远。
 *
 * ⚠ 用**欧氏距离**，不是 `Math.abs(x2-x1)` 那种单轴距离。斜着连的两块，
 *   单轴距离可能很小而实际很远，按单轴算出来的弧会塌成一个直角拐弯。
 */
export function controlDistance(
  sx: number,
  sy: number,
  tx: number,
  ty: number
): number {
  const dist = Math.hypot(tx - sx, ty - sy);
  return Math.max(MIN_CONTROL_DIST, dist * CONTROL_DIST_RATIO);
}

/**
 * 某条边上的把手，控制点该往哪个方向偏。
 *
 * 抄 `getDirectionOffset`：从左侧出就往左偏、从右侧出就往右偏。
 * ⚠ 方向搞反的话曲线会先往回勾一下再折出去，像打了个结。
 */
export function directionOffset(
  position: Position,
  distance: number
): { dx: number; dy: number } {
  switch (position) {
    case Position.Left:
      return { dx: -distance, dy: 0 };
    case Position.Right:
      return { dx: distance, dy: 0 };
    case Position.Top:
      return { dx: 0, dy: -distance };
    case Position.Bottom:
      return { dx: 0, dy: distance };
    default:
      return { dx: 0, dy: 0 };
  }
}

export interface CurvePathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

/**
 * 一条三次贝塞尔的 SVG path，外加它的中点（放标签用）。
 *
 * 中点用的是三次贝塞尔在 t=0.5 的**解析解**，不是两端点的平均：
 *
 *     B(0.5) = (P0 + 3·C1 + 3·C2 + P3) / 8
 *
 * ⚠ 拿两端点取平均当中点是常见的偷懒做法，在弯得厉害的线上标签会飘到
 *   线外面去——那种错不报错，只是标签跟线对不上。
 */
export function buildCurvePath(p: CurvePathParams): {
  path: string;
  labelX: number;
  labelY: number;
} {
  const { sourceX, sourceY, targetX, targetY } = p;
  const d = controlDistance(sourceX, sourceY, targetX, targetY);
  const s = directionOffset(p.sourcePosition, d);
  const t = directionOffset(p.targetPosition, d);

  const c1x = sourceX + s.dx;
  const c1y = sourceY + s.dy;
  const c2x = targetX + t.dx;
  const c2y = targetY + t.dy;

  return {
    path: `M${sourceX},${sourceY} C${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`,
    labelX: (sourceX + 3 * c1x + 3 * c2x + targetX) / 8,
    labelY: (sourceY + 3 * c1y + 3 * c2y + targetY) / 8,
  };
}
