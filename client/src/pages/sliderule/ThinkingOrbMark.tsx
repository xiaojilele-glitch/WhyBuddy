/**
 * 思考指示。2026-09-15 用户对照三点 bounce：「动效有点死，GitHub 上这块
 * 有啥开源做得好的，替换掉」。
 *
 * 上一版抄 tobiasahlin/SpinKit three-bounce（`index.css` 的 sr-dot）。
 * 换成 Jakubantalik/thinking-orbs 的画笔（MIT，九态点球）。
 *
 * ⚠ 同日用户又圈了「正在想」说没有动效。真机
 *   `prefers-reduced-motion: reduce` 为 true（Windows 把「动画效果」关掉
 *   很常见），库组件自己冻成 t=0.6 的一帧，我们再把
 *   `paused={isMotionReduced()}` 叠上去——两道闸，球永远不转。
 *   思考球是「还活着」的信号，不是装饰。只听应用内「减少动态效果」，
 *   系统减动效不许把它冻死。画笔仍用官方 engine，不用自己描点。
 */
import React from "react";
import { MODE_DRAWS, resolvePreset, type OrbSize, type OrbState } from "thinking-orbs/engine";
import { loadReduceMotionPref } from "./user-prefs";
import { thinkingOrbState } from "./thinking-orb-state";

export function ThinkingOrbMark({
  label,
  state,
  size = 20,
}: {
  label?: string;
  state?: OrbState;
  size?: OrbSize;
}) {
  const orbState = state ?? thinkingOrbState(label);
  const paused = loadReduceMotionPref();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { mode, speed, opts } = resolvePreset(orbState, size);
    const draw = MODE_DRAWS[mode];
    const paint = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      draw(ctx, size, time, false, opts);
    };
    if (paused) {
      paint(0.6);
      return;
    }
    let raf = 0;
    let running = false;
    const tick = () => {
      paint((performance.now() / 1000) * speed);
      if (running) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // ⚠ 库组件要等 IntersectionObserver 回调才 start。回调晚到或
    //   嵌进 Electron 不触发时，人看到的就是一帧静球。先转起来，
    //   离屏再停。
    start();
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            entry?.isIntersecting && document.visibilityState !== "hidden"
              ? start()
              : stop();
          });
    io?.observe(canvas);
    const onVis = () => {
      document.visibilityState === "hidden" ? stop() : start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [orbState, size, paused]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label || "正在想"}
      data-testid="sliderule-thinking-orb"
      data-orb-state={orbState}
      className="shrink-0"
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
