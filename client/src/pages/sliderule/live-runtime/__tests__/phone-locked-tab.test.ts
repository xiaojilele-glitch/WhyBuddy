/**
 * 手机档：无权限 tab 要出声，提示要落在手机框里（2026-07-28）。
 *
 * 两条都是真机查出来的：
 *
 * ① 点无权限的 tab 原本是**静默 no-op**——图标灰掉、挂一个 title。title 是
 *    鼠标悬停才出的东西，触屏上根本不存在；手机用户点一下什么都不发生，
 *    只会以为应用卡了。灰掉是"看得出不能点"，点了还得说明为什么。
 *
 * ② Toast 默认 portal 到 document.body。手机档是在一个缩放过的画布里预览的，
 *    提示会飘到整个浏览器窗口中央、压根不在手机框内。真机实测：Toast 节点
 *    存在（count=1）但画面上找不到。传 getContainer 指到画布后，实测坐标
 *    落在手机框内（x≈1105, y≈420），文案完整。
 *
 * 这一条同时是"别把 notify 的容器参数顺手删掉"的哨兵——删了不会报错、
 * 测试也不会红，只会在手机预览里再次看不到任何提示。
 */
import { describe, it, expect } from "vitest";

const tabBarSrc = await import("../phone-mobile/PhoneTabBar.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const feedbackSrc = await import("../phone-mobile/phone-feedback.ts?raw").then(
  m => (m as unknown as { default: string }).default
);
const rolePickerSrc = await import("../phone-mobile/PhoneRolePicker.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("无权限 tab", () => {
  it("点了要回调，不是静默吞掉", () => {
    expect(tabBarSrc).toContain("onLockedTap");
    expect(tabBarSrc).toContain("onLockedTap?.(item)");
    // 仍然不允许切页——出声不等于放行
    expect(tabBarSrc).toContain("if (item.locked)");
  });

  it("父层把它接到 notify 上，并带上角色和页名", () => {
    expect(screenSrc).toContain("onLockedTap={item =>");
    expect(screenSrc).toContain("无「${item.label}」权限");
  });
});

describe("手机档提示的落点", () => {
  it("notify 支持 getContainer", () => {
    expect(feedbackSrc).toContain("getContainer");
  });

  it("每一处手机档 notify 都传了画布容器", () => {
    // 漏传的那处不会报错，只会在手机预览里静默看不见——所以逐处锁
    const calls = screenSrc.match(/notify\(/g) ?? [];
    const withContainer = screenSrc.match(/\(\)\s*=>\s*canvasEl/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(withContainer.length).toBeGreaterThanOrEqual(calls.length);
  });
});

describe("手机档角色切换的自动化抓手", () => {
  it("Picker 弹层带 testid —— 缺了它手机档换角色就没法自动点", () => {
    // 触发器跟桌面档同名（app-runtime-role），但弹层内容是 antd-mobile 的
    // 内部结构。没有这个 testid，脚本只能去猜 `.adm-picker-*` 内部类名，
    // 版本一升就断。
    //
    // 真实代价（2026-07-29 巡检时踩到）：脚本照搬桌面档的 Select 选项选择器，
    // 弹层被撑开挡住整屏，截出来是一张被盖住的假图；六个页面只覆盖到两个，
    // 而日志看着一切正常——少报的覆盖率是不会自己喊疼的。
    expect(rolePickerSrc).toContain('data-testid="app-runtime-role-picker"');
  });

  it("弹层带 aria-label，读屏用户知道这是干什么的", () => {
    expect(rolePickerSrc).toContain('aria-label="切换角色"');
  });

  it("角色引用键与显示名分开，手机端不泄漏内部 id", () => {
    expect(rolePickerSrc).toContain("roleLabels: Record<string, string>");
    expect(rolePickerSrc).toContain("label: roleLabels[r] ?? r");
    expect(screenSrc).toContain("roleLabels={schema.roleLabels}");
  });
});

describe("手机档 TabBar 的行数徽标", () => {
  it("TabBar 用自带 badge 槽位，不自己叠绝对定位小圆点", () => {
    expect(tabBarSrc).toContain("badge={");
  });

  it("锁住的页不显示计数 —— 那是权限信息，不能从计数里泄出去", () => {
    // 无权限的页显示「3」等于告诉用户"这里有三条你看不到的数据"
    expect(tabBarSrc).toMatch(/!item\.locked\s*&&\s*\(item\.rowCount/);
  });

  it("父层的口径与桌面侧栏同源：锁住的页与首页不计数", () => {
    expect(screenSrc).toMatch(/locked \|\| m\.pageId === "home"[\s\S]{0,120}entityId/);
  });
});
