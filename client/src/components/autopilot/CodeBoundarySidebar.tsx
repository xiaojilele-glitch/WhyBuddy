/**
 * autopilot-image-rendering-and-visual-system · Phase 2 / Task 18.1
 *
 * `CodeBoundarySidebar`：在 design.md 视图旁并排展示每个 spec 节点的真实代码目录路径，
 * 让设计与实现的代码边界一眼可对照。
 *
 * 设计要点（参见 spec design.md / requirements.md §13）：
 * - 节点 `codePaths` 存在且非空时，按目录树展示（简单 `<ul>/<li>` 层级即可）。
 * - 节点 `codePaths` 缺失或为空数组时，渲染「未声明代码边界」占位提示。
 * - 文本色取自 `visualTokens["frontend"]` / `visualTokens["backend-core"]`：
 *     - `client/...` 路径走 `frontend`
 *     - `server/...` 路径走 `backend-core`
 *     - 其它路径回退到 `frontend`（保证「至少一种语义颜色一致」的要求）。
 * - 容器走纵向列表 + 节点内并列树结构，与 design.md 视图保持双栏并排可读。
 * - 严禁硬编码 `#` / `rgb()` / `hsl()` / `oklch()` 字面量；颜色必须经过 `resolveToken(key, theme)`。
 * - 颜色取色统一从 `visual-tokens-placeholder` 单一替换点导入，禁止直接 import `visual-tokens.ts`。
 *
 * @see Requirements 13.1, 13.2, 13.3, 17.1, 18.3
 */

import { type ReactElement } from "react";

import {
  type VisualTokenKey,
  type VisualTokenSet,
  resolveToken,
} from "../../lib/autopilot/visual-tokens-placeholder";

/**
 * 单个代码边界节点描述：与 spec node 一一对应。
 *
 * 不变量：
 * - `nodeId` 全局唯一，用作 React key 与 `data-node-id`。
 * - `title` 是面向人类的展示标题。
 * - `codePaths` 缺失或为空数组时，节点会渲染「未声明代码边界」占位。
 */
export interface CodeBoundaryNode {
  readonly nodeId: string;
  readonly title: string;
  readonly codePaths?: ReadonlyArray<string>;
}

/**
 * `CodeBoundarySidebar` props。
 *
 * 注：`theme` 显式传入而非从全局 context 读取，以便：
 * - Property 8 风格的属性测试可以直接在不同主题间切换断言；
 * - design.md 视图与本侧栏并排时，由父容器统一驱动主题。
 */
export interface CodeBoundarySidebarProps {
  readonly nodes: ReadonlyArray<CodeBoundaryNode>;
  readonly visualTokens: VisualTokenSet;
  readonly theme: "light" | "dark";
}

/**
 * 占位文案：节点未声明代码边界时显示。
 *
 * 暴露为模块常量便于测试断言文本完全相等。
 */
export const CODE_BOUNDARY_PLACEHOLDER_TEXT = "未声明代码边界";

/**
 * 根据代码路径前缀决定使用哪个语义 key。
 *
 * - `client/` 开头 → `frontend`
 * - `server/` 开头 → `backend-core`
 * - 其它 → 回退到 `frontend`，保持单一一致色。
 */
function pickTokenKeyForPath(path: string): VisualTokenKey {
  if (path.startsWith("server/")) {
    return "backend-core";
  }
  return "frontend";
}

/**
 * 把一组扁平的代码路径切成简单的目录树节点（单层归并）。
 *
 * 这里使用最小可用的目录树：按第一段前缀分组，每个前缀下保留剩余 path
 * 作为叶子项。足以满足 design.md 视图旁的并排可读需求；
 * 更复杂的多级展开留给后续 spec。
 */
interface CodeBoundaryTreeGroup {
  readonly head: string;
  readonly leaves: ReadonlyArray<string>;
}

function groupPathsByHead(
  paths: ReadonlyArray<string>,
): ReadonlyArray<CodeBoundaryTreeGroup> {
  const order: string[] = [];
  const buckets = new Map<string, string[]>();
  for (const raw of paths) {
    const path = raw.trim();
    if (path.length === 0) {
      continue;
    }
    const slashIdx = path.indexOf("/");
    const head = slashIdx >= 0 ? path.slice(0, slashIdx) : path;
    const leaf = slashIdx >= 0 ? path.slice(slashIdx + 1) : "";
    if (!buckets.has(head)) {
      buckets.set(head, []);
      order.push(head);
    }
    const bucket = buckets.get(head);
    if (bucket) {
      bucket.push(leaf.length > 0 ? leaf : path);
    }
  }
  return order.map((head) => ({
    head,
    leaves: buckets.get(head) ?? [],
  }));
}

/**
 * 代码边界侧栏组件。
 */
export function CodeBoundarySidebar(
  props: CodeBoundarySidebarProps,
): ReactElement {
  const { nodes, visualTokens, theme } = props;

  // 通过 resolveToken 取色，避免在 JSX 里硬编码 oklch 字面量。
  // 注意：`visualTokens` 形参会与 `resolveToken` 内部读取的全局调色板保持一致；
  // 这里同时接受 `visualTokens` prop 是为了：
  // 1) 兼容 design.md 描述的 props 形状；
  // 2) 测试代码可注入特定调色板做隔离断言。
  const frontendColor =
    visualTokens.frontend[theme] ?? resolveToken("frontend", theme);
  const backendColor =
    visualTokens["backend-core"][theme] ?? resolveToken("backend-core", theme);

  const colorForKey = (key: VisualTokenKey): string => {
    if (key === "backend-core") {
      return backendColor;
    }
    return frontendColor;
  };

  return (
    <aside
      data-component="code-boundary-sidebar"
      data-theme={theme}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: 0,
      }}
    >
      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {nodes.map((node) => {
          const hasPaths =
            Array.isArray(node.codePaths) && node.codePaths.length > 0;
          return (
            <li
              key={node.nodeId}
              data-node-id={node.nodeId}
              data-has-code-paths={hasPaths ? "true" : "false"}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                minWidth: 0,
              }}
            >
              <div
                data-role="node-title"
                style={{
                  // 节点标题以 frontend 色作为默认入口提示色。
                  color: frontendColor,
                  fontWeight: 600,
                }}
              >
                {node.title}
              </div>

              {hasPaths ? (
                <ul
                  data-role="code-tree"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    listStyle: "none",
                    margin: 0,
                    paddingLeft: "0.75rem",
                  }}
                >
                  {groupPathsByHead(node.codePaths ?? []).map((group) => {
                    const key = pickTokenKeyForPath(`${group.head}/`);
                    return (
                      <li
                        key={`${node.nodeId}::${group.head}`}
                        data-role="code-tree-group"
                        data-token-key={key}
                        style={{ minWidth: 0 }}
                      >
                        <div
                          data-role="code-tree-head"
                          style={{ color: colorForKey(key) }}
                        >
                          {group.head}/
                        </div>
                        {group.leaves.length > 0 ? (
                          <ul
                            data-role="code-tree-leaves"
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.125rem",
                              listStyle: "none",
                              margin: 0,
                              paddingLeft: "0.75rem",
                            }}
                          >
                            {group.leaves.map((leaf, leafIndex) => (
                              <li
                                key={`${node.nodeId}::${group.head}::${leafIndex}`}
                                data-role="code-tree-leaf"
                                style={{ color: colorForKey(key) }}
                              >
                                {leaf}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div
                  data-role="code-boundary-placeholder"
                  style={{ color: frontendColor }}
                >
                  {CODE_BOUNDARY_PLACEHOLDER_TEXT}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default CodeBoundarySidebar;
