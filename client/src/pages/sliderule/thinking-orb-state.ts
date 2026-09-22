/**
 * 把左栏那句「正在想…」映射到 thinking-orbs 的九态。
 *
 * ⚠ 认不出就 `working`（默认那颗转的球）。不许为了好看猜一个
 *   `solving`——那是另一种伪造进度。
 */
import type { OrbState } from "thinking-orbs";

export type { OrbState };

export function thinkingOrbState(label: unknown): OrbState {
  const text = String(label ?? "");
  if (/读|查看|搜索|检索|源码|文件/.test(text)) return "searching";
  if (/写|起草|生成|画|文案/.test(text)) return "composing";
  if (/修|错误|失败|类型错误/.test(text)) return "solving";
  if (/依赖|安装|npm|创建工程/.test(text)) return "connecting";
  return "working";
}
