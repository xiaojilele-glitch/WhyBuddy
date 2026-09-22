/**
 * 弹层不许顶穿画布 —— 展会现场访客点「新建」直接能看见的那个 bug。
 *
 * 根因是 antd Modal 是桌面组件：不给 width 默认 520，而手机画布只有 405 宽。
 * 旁边的详情 Drawer 早就按 isPhone 改成底部弹起了，Modal 这块一直漏着。
 */
import { describe, it, expect } from "vitest";
import { deviceModalSizing } from "../AppRuntimeScreen";

// 与 AppRuntimeScreen 的 DEVICE_SPECS 一致（那张表不导出，这里按设计分辨率对齐）
const CANVAS = {
  desktop: { w: 1440, h: 810 },
  tablet: { w: 1112, h: 834 },
  phone: { w: 405, h: 720 },
} as const;

describe("deviceModalSizing", () => {
  it("三种设备下弹框都窄于画布（回归：手机 520 > 405 顶穿两边）", () => {
    for (const device of ["desktop", "tablet", "phone"] as const) {
      const { width } = deviceModalSizing(device);
      expect(width).toBeLessThan(CANVAS[device].w);
    }
  });

  it("手机：左右各留 16 边距 + 垂直居中", () => {
    const { width, centered } = deviceModalSizing("phone");
    expect(width).toBe(CANVAS.phone.w - 32); // 358
    expect(centered).toBe(true);
  });

  it("桌面保持 antd 默认 520，不受这次改动影响", () => {
    const { width, centered } = deviceModalSizing("desktop");
    expect(width).toBe(520);
    expect(centered).toBe(false);
  });

  it("表单再长也不顶穿画布高度：body 限高留给标题栏和按钮栏", () => {
    for (const device of ["desktop", "tablet", "phone"] as const) {
      const { bodyMaxHeight } = deviceModalSizing(device);
      expect(bodyMaxHeight).toBeGreaterThan(0);
      // 标题栏 ~55 + 按钮栏 ~53 + 上下留白，留够余量才不会撑破
      expect(bodyMaxHeight).toBeLessThan(CANVAS[device].h - 150);
    }
  });
});
