/**
 * sandbox-view — C4 L2 默认投影。
 *
 * 2026-08-18：沙盘默认面不再铺成员边（那是毛线团）。账本仍是
 * deriveSandboxGraph（边契约 / 体检不动）；这里只决定「现在看见哪一层」：
 *   · 未选中：只画组间捆扎边（与 Mermaid 架构图同一套 bundleLinkageEdges）
 *   · 选中一个成员：只画挨着它的成员边
 *
 * 变异：把 data.edges 直接画回默认面，memberEdges 在 selectedKey=null
 * 时就会非空——下面的判据就是为此。
 */
import {
  bundleLinkageEdges,
  type BundledLinkageEdge,
} from "./five-system-model";
import type { SandboxEdge, SandboxGraph } from "./sandbox-graph";

export function buildSandboxView(
  data: SandboxGraph,
  opts: { selectedKey: string | null }
): {
  l2Edges: BundledLinkageEdge[];
  memberEdges: SandboxEdge[];
} {
  const l2Edges = bundleLinkageEdges(data.edges);
  if (!opts.selectedKey) {
    return { l2Edges, memberEdges: [] };
  }
  return {
    l2Edges,
    memberEdges: data.edges.filter(
      e => e.from === opts.selectedKey || e.to === opts.selectedKey
    ),
  };
}
