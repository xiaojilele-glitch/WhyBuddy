/**
 * 舞台预览框的外观：三处画同一个框，且余量必须真的传下去。
 *
 * ⚠ 2026-08-24：这条测试防的是两种都不会报错的失效。
 *
 *   一、只改一处。SpecPageLiveStage / AppRuntimeScreen / ClickEditStage 之前
 *       各自硬编了一份一模一样的 `0 8px 32px rgba(60,50,30,0.18)`，改一处
 *       另两处静默不变。
 *   二、引了常量但没传 pad。这个更阴——阴影常量用上了、代码看着全对，但画布
 *       是 overflow:hidden，不扣余量的话 ring 和分层阴影会被整段切掉，
 *       屏幕上跟没改一样。真机量过：改之前 gapTop / gapBottom 都是 0。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FRAMES = [
  [
    "ScaledStageFrame.tsx",
    new URL("../ScaledStageFrame.tsx", import.meta.url),
  ],
  ["AppRuntimeScreen.tsx", new URL("../AppRuntimeScreen.tsx", import.meta.url)],
  [
    "ClickEditStage.tsx",
    new URL(
      "../../../agent-loop/dashboard/ClickEditStage.tsx",
      import.meta.url
    ),
  ],
] as const;

const SCALE_CALLS = [
  [
    "SpecPageLiveStage.tsx",
    new URL("../SpecPageLiveStage.tsx", import.meta.url),
  ],
  ["AppRuntimeScreen.tsx", new URL("../AppRuntimeScreen.tsx", import.meta.url)],
  [
    "ClickEditStage.tsx",
    new URL(
      "../../../agent-loop/dashboard/ClickEditStage.tsx",
      import.meta.url
    ),
  ],
  [
    "SandboxPreviewSurface.tsx",
    new URL(
      "../../project-runtime/SandboxPreviewSurface.tsx",
      import.meta.url
    ),
  ],
] as const;

describe("舞台预览框外观（stage-frame-style）", () => {
  it.each(FRAMES)("%s 用共用常量画框，不再硬编阴影", (_name, url) => {
    const src = stripComments(readFileSync(url, "utf8"));
    expect(src).toContain("STAGE_FRAME_SHADOW");
    expect(src).toContain("stage-frame-style");
    // 反向：旧的暖棕单层阴影一处都不许留下。任一处改回去必红。
    expect(src).not.toContain("rgba(60,50,30");
    expect(src).not.toContain("0 8px 32px");
  });

  it.each(SCALE_CALLS)(
    "%s 把余量真的传给了 useScaleToFit（否则 ring 会被切掉）",
    (_name, url) => {
      const src = stripComments(readFileSync(url, "utf8"));
      expect(src).toContain("STAGE_FRAME_PAD");
      // 光 import 不算数：必须出现在 useScaleToFit 的实参里。
      const at = src.indexOf("useScaleToFit(");
      expect(at).toBeGreaterThan(-1);
      const call = src.slice(at, at + 400);
      expect(call).toContain("STAGE_FRAME_PAD");
    }
  );

  it("阴影外扩量必须装得进预留余量（第一轮就是栽在这条上）", async () => {
    /**
     * ⚠ 2026-08-24 第二轮。第一轮补了 pad 却没验证够不够，真机底边照切 14px，
     * 用户第二次反馈"被外层截断、看着很锋利"。
     *
     * 关键在 pad 是**居中均分**的：contain 模式必有一轴刚好贴满，那轴每边只拿到
     * pad/2。所以只能按 pad/2 卡，不能按容器实际剩余空间卡——后者在另一轴上很宽松，
     * 拿它当判据就会假绿。
     *
     * 把阴影调大而不同步加 pad（或反过来把 pad 调小），这条必红。
     */
    const {
      STAGE_FRAME_SHADOW,
      STAGE_FRAME_PAD,
      PHONE_FRAME_SHADOW,
      PHONE_FRAME_SHADOW_PAD,
      phoneFramePad,
      shadowExtent,
    } = await import("../stage-frame-style");

    const desktop = shadowExtent(STAGE_FRAME_SHADOW);
    expect(desktop.bottom).toBeLessThanOrEqual(STAGE_FRAME_PAD.y / 2);
    expect(desktop.top).toBeLessThanOrEqual(STAGE_FRAME_PAD.y / 2);
    expect(desktop.right).toBeLessThanOrEqual(STAGE_FRAME_PAD.x / 2);
    expect(desktop.left).toBeLessThanOrEqual(STAGE_FRAME_PAD.x / 2);

    // 手机/平板：机身那部分不归阴影用，所以只能拿 PHONE_FRAME_SHADOW_PAD 卡，
    // 不能拿 phoneFramePad() 的总数——总数里含机身，用它会宽松到失去意义。
    const phone = shadowExtent(PHONE_FRAME_SHADOW);
    // 按 /2 卡：机身之外的空隙居中均分，每边只拿一半。改动前把机身和阴影余量
    // 加在一个 48 里，等于每边只剩 8px 去装 20px 的阴影——切了很久没人发现。
    expect(phone.bottom).toBeLessThanOrEqual(PHONE_FRAME_SHADOW_PAD.y / 2);
    expect(phone.right).toBeLessThanOrEqual(PHONE_FRAME_SHADOW_PAD.x / 2);

    // 机身随机型变，余量不变：平板边框更薄、下巴更短，总 pad 自然不同
    expect(phoneFramePad({ bezel: 12, bezelBottom: 20 })).toEqual({ x: 40, y: 76 });
    expect(phoneFramePad({ bezel: 14, bezelBottom: 18 })).toEqual({ x: 44, y: 76 });

    // 底边是朝下偏的那边，必须是最吃余量的方向——否则说明阴影根本没有方向感
    expect(desktop.bottom).toBeGreaterThan(desktop.top);
  });

  it("shadowExtent 按 |offset| + blur/2 + spread 算，不是照着 blur 猜", async () => {
    const { shadowExtent } = await import("../stage-frame-style");
    // 第一轮翻车的那组值：看着像 48px，向下其实是 24 + 24 - 16 = 32
    const e = shadowExtent("0 24px 48px -16px rgba(15,23,42,0.14)");
    expect(e.bottom).toBe(32);
    expect(e.top).toBe(0); // -24 + 8 < 0，够不到顶边
    expect(e.left).toBe(8);
    expect(e.right).toBe(8);
    // ring 四边等距
    expect(shadowExtent("0 0 0 1px rgba(0,0,0,0.06)")).toEqual({
      top: 1,
      right: 1,
      bottom: 1,
      left: 1,
    });
  });

  it("桌面档是 ring + 分层，不是单层大模糊", async () => {
    const { STAGE_FRAME_SHADOW, STAGE_FRAME_PAD, PHONE_FRAME_SHADOW } =
      await import("../stage-frame-style");
    // ring：0 0 0 1px 那一层，负责把四条边（尤其顶边）定住
    expect(STAGE_FRAME_SHADOW).toContain("0 0 0 1px");
    // 分层：至少三个 rgba 停靠点，单层写法必红
    expect(
      STAGE_FRAME_SHADOW.match(/rgba\(/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
    // 色相跟着壳底色走冷中性，不许回到暖棕
    expect(STAGE_FRAME_SHADOW).toContain("rgba(15,23,42");
    expect(STAGE_FRAME_SHADOW).not.toContain("rgba(60,50,30");
    // 手机档机身自带边界，不该再加 ring
    expect(PHONE_FRAME_SHADOW).not.toContain("0 0 0 1px");
    // y 比 x 大：阴影朝下偏，底边才是吃余量的那一边
    expect(STAGE_FRAME_PAD.y).toBeGreaterThan(STAGE_FRAME_PAD.x);
  });
});
