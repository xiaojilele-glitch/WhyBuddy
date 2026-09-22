/**
 * 曲线控制点的判据（2026-08-28）。
 *
 * 这一层最容易出的错都**不报错**：曲线鼓得太开、方向反了打个结、
 * 标签飘到线外面去——三样都还是"一条曲线 + 一个标签"，看着正常。
 */
import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";

import {
  CONTROL_DIST_RATIO,
  MIN_CONTROL_DIST,
  buildCurvePath,
  controlDistance,
  directionOffset,
} from "../canvas-curve";

describe("控制点距离", () => {
  it("按欧氏距离的四分之一（不是 React Flow 那个 0.5）", () => {
    // 变异：改回 0.5，这条红。0.5 那档在长线上是又宽又平的懒弧。
    expect(CONTROL_DIST_RATIO).toBe(0.25);
    expect(controlDistance(0, 0, 400, 0)).toBeCloseTo(100, 6);
  });

  it("⚠ 斜线按欧氏距离算，不按单轴", () => {
    // 变异：改成 Math.abs(tx-sx)，这条红。
    // 单轴距离小而实际很远的斜线，弧会塌成一个直角拐弯。
    const diag = controlDistance(0, 0, 300, 400); // 欧氏 500
    expect(diag).toBeCloseTo(125, 6);
    expect(diag).toBeGreaterThan(controlDistance(0, 0, 300, 0));
  });

  it("有下限——很近的两点也留一点弧，不退化成折线", () => {
    expect(controlDistance(0, 0, 10, 0)).toBe(MIN_CONTROL_DIST);
    expect(MIN_CONTROL_DIST).toBeGreaterThan(0);
  });

  it("反向：距离为 0 也不回 0（同一点上的边仍是合法路径）", () => {
    expect(controlDistance(5, 5, 5, 5)).toBe(MIN_CONTROL_DIST);
  });
});

describe("偏移方向", () => {
  it("四条边各偏各的方向", () => {
    expect(directionOffset(Position.Left, 10)).toEqual({ dx: -10, dy: 0 });
    expect(directionOffset(Position.Right, 10)).toEqual({ dx: 10, dy: 0 });
    expect(directionOffset(Position.Top, 10)).toEqual({ dx: 0, dy: -10 });
    expect(directionOffset(Position.Bottom, 10)).toEqual({ dx: 0, dy: 10 });
  });

  it("⚠ 左右不许弄反（反了曲线会先往回勾一下，像打了个结）", () => {
    expect(directionOffset(Position.Left, 10).dx).toBeLessThan(0);
    expect(directionOffset(Position.Right, 10).dx).toBeGreaterThan(0);
  });
});

describe("路径与标签", () => {
  const P = {
    sourceX: 0,
    sourceY: 0,
    targetX: 400,
    targetY: 200,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };

  it("是一条三次贝塞尔，起终点就是给的那两点", () => {
    const { path } = buildCurvePath(P);
    expect(path.startsWith("M0,0 C")).toBe(true);
    expect(path.endsWith("400,200")).toBe(true);
  });

  it("控制点朝各自把手的方向偏（右出 → 往右；左进 → 往左）", () => {
    const { path } = buildCurvePath(P);
    const m = path.match(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/);
    expect(m).not.toBeNull();
    const [c1x, , c2x] = [+m![1], +m![2], +m![3]];
    const d = controlDistance(0, 0, 400, 200);
    expect(c1x).toBeCloseTo(d, 6); // 从右侧出 → 往右
    expect(c2x).toBeCloseTo(400 - d, 6); // 从左侧进 → 往左
  });

  it("⚠ 标签落在曲线的**解析中点**上，不是两端点的平均", () => {
    // 变异：改成 (sx+tx)/2、(sy+ty)/2，这条红。
    // 弯得厉害的线上，端点平均会让标签飘到线外面——不报错，只是对不上。
    const up = buildCurvePath({
      ...P,
      targetX: 0,
      targetY: 400,
      sourcePosition: Position.Right,
      targetPosition: Position.Right,
    });
    // 两端都朝右鼓出去，中点必然在 x>0 那一侧，而端点平均是 x=0
    expect(up.labelX).toBeGreaterThan(1);
  });

  it("直着连时标签就在两点中间（解析解在这种情形下退化成平均）", () => {
    const flat = buildCurvePath({
      sourceX: 0,
      sourceY: 0,
      targetX: 400,
      targetY: 0,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    expect(flat.labelX).toBeCloseTo(200, 6);
    expect(flat.labelY).toBeCloseTo(0, 6);
  });

  it("确定性：同一份输入永远同一条路径", () => {
    expect(buildCurvePath(P).path).toBe(buildCurvePath(P).path);
  });
});
