/**
 * 固定设计分辨率的预览框：桌面 1920×1080 / 机型清单，contain 缩进容器。
 *
 * 机制在 canvas-scale，描边在 stage-frame-style。SpecPageLiveStage 和
 * 工程预览都走这一份——再抄一副框，阴影和余量会各改各的。
 *
 * ⚠ 2026-09-19：工程预览外壳是白的。台面如果不铺 --sr-shell-bg，
 *   1920×1080 白画板叠在白底上，16:9 和阴影都看不见——用户圈的
 *   「右侧一大片白、中间一个小窗」就是这个。台面用外壳灰，画板保持白。
 *
 * ⚠ 同日：台面必须 `min-w-0 w-full`。flex 子项默认 min-width:auto，
 *   初值 scale=1 时里面那块 1920 会把台面撑开，useScaleToFit 量到
 *   的是撑开后的宽，画板比可见栏还宽，左右灰边被 overflow 切没。
 *
 * 缩放有两档，不能混：
 *   transform — HTML 舞台。srcdoc 同源，祖先 scale 点得着。
 *   zoom      — 工程预览。票是跨源 iframe。祖先 `scale()` / 祖先
 *               zoom 都改不了跨源框的命中盒。这里只出 16:9 视窗，
 *               zoom 由 iframe 自己带（见 SandboxPreviewSurface）。
 */
import React from "react";
import {
  PHONE_FRAME_SHADOW,
  STAGE_FRAME_SHADOW,
} from "./stage-frame-style";
import type { DevicePresetFrame } from "./device-presets";

export function ScaledStageFrame({
  viewport,
  scale,
  canvasRef,
  framed,
  frame,
  canvasTestId,
  hitFit = "transform",
  children,
}: {
  viewport: { w: number; h: number };
  scale: number;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  framed?: boolean;
  frame?: DevicePresetFrame;
  canvasTestId?: string;
  /** 跨源 iframe 必须 zoom，同源舞台保持 transform。 */
  hitFit?: "transform" | "zoom";
  children: React.ReactNode;
}) {
  const bezel = framed && frame;
  const useZoom = hitFit === "zoom";
  return (
    <div
      ref={canvasRef}
      className="flex min-h-0 min-w-0 w-full flex-1 items-center justify-center overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)]"
      data-testid={canvasTestId}
    >
      <div
        data-testid={bezel ? "sliderule-phone-frame" : undefined}
        style={
          bezel
            ? {
                boxSizing: "border-box",
                width: viewport.w * scale + frame.bezel * 2,
                border: `${frame.bezel}px solid #1c1c1e`,
                borderBottomWidth: frame.bezelBottom,
                borderRadius: frame.radius,
                background: "#1c1c1e",
                boxShadow: PHONE_FRAME_SHADOW,
                position: "relative",
              }
            : {
                width: viewport.w * scale,
                height: viewport.h * scale,
                position: "relative",
                borderRadius: 5,
                boxShadow: STAGE_FRAME_SHADOW,
                overflow: "hidden",
                background: "#fff",
              }
        }
      >
        <div
          style={{
            width: viewport.w * scale,
            height: viewport.h * scale,
            position: "relative",
            overflow: "hidden",
            borderRadius: bezel ? frame.innerRadius : 5,
            background: "#fff",
          }}
        >
          {useZoom ? (
            <div
              data-testid="scaled-stage-fit"
              data-hit-fit="zoom"
              className="relative h-full w-full overflow-hidden"
            >
              {children}
            </div>
          ) : (
            <div
              data-testid="scaled-stage-fit"
              data-hit-fit="transform"
              style={{
                width: viewport.w,
                height: viewport.h,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                overflow: "hidden",
                background: "#fff",
                position: "relative",
              }}
            >
              {children}
            </div>
          )}
        </div>
        {bezel ? (
          <div
            aria-hidden
            className="pointer-events-none mx-auto mt-1.5 h-1 w-28 rounded-full bg-white/30"
            data-testid="sliderule-phone-home-indicator"
          />
        ) : null}
      </div>
    </div>
  );
}
