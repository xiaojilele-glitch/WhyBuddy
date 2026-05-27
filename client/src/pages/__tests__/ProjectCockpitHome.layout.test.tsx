/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 36.2
 *
 * Layout regression test for `ProjectCockpitHome`.
 *
 * 背景（Task 36 audit）：早期 cockpit 把 `<ProjectMainChainTimeline>`
 * 用 `position: fixed` + `top: 2` 钉在视口顶部，会遮挡 `<Home />` 的
 * 导航 / 头部 / 主操作区。Task 36.1 已把它改为 layout-safe wrapper band：
 * 在 `data-region="project-cockpit-layout-band"` 容器内、作为正常流的兄弟节点
 * 出现在 `<Home />` 之前，宽度 `100%`、高度 `auto`，不再使用 `position: fixed`。
 *
 * 集成方式（Task 36.1 选择记录）：**wrapper band 方案**，而不是给
 * `Home.tsx` 增加 `topbarSlot` 等 layout slot prop。原因：
 * `Home.tsx` 是 2900+ 行的核心组件，直接改动它会扩散到大量返回路径与
 * 既有测试；wrapper band 完全在 cockpit 这一薄壳内闭环，零侵入。
 *
 * 本测试在 `ProjectCockpitHome` 之上构建 SSR 字符串，验证 3 条不变量：
 *   1. timeline 容器内 inline `style` 不再包含 `position: fixed`；
 *   2. timeline 容器作为 `project-cockpit-layout-band` 的子节点（出现在该容器开标签之后）；
 *   3. timeline 容器 inline `style` 不包含 `width: 100vw` / `height: 100vh`。
 *
 * 所有断言基于 `react-dom/server` 的 `renderToStaticMarkup`，与仓库现有
 * 约定一致（不引入 `@testing-library/react`）。
 *
 * 注意：本测试 **不修改** 既有 22.2 测试。Task 22.2 测试断言「timeline 已挂载」，
 * 本测试断言「timeline 安全挂载（不遮挡 Home）」。两者互补。
 *
 * @see Requirements 14.4
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock 列表
// ---------------------------------------------------------------------------
//
// `ProjectCockpitHome` 自身仅依赖：
//   - `useProjectStore`（项目状态派生 6 步主链）
//   - `<ProjectMainChainTimeline>`（已实测覆盖，本测试只看其 wrapper）
//   - `<Home />`（巨型组件，依赖大量 store / hook）
//
// 为了把测试焦点收敛到「wrapper band 布局是否正确」，
// 本测试只 mock 必需的最小集合：
//   - mock `Home` 为一个 marker div，避免引入 Home 的全部依赖；
//   - mock `useProjectStore` 为最小 selector；
//   - 其余（visual-tokens-placeholder / ProjectMainChainTimeline）
//     使用真实模块，以便对 wrapper 包裹的真实 timeline 锚点做断言。

vi.mock("../Home", () => ({
  __esModule: true,
  default: () => <div data-testid="home-mock" />,
}));

const projectState = {
  currentProjectId: null as string | null,
  projects: [] as Array<Record<string, unknown>>,
  clarificationQuestions: [] as Array<Record<string, unknown>>,
  missions: [] as Array<Record<string, unknown>>,
  evidence: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/project-store", () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// 延迟到 mock 注册之后再 import 被测组件，避免抢先解析真实 Home。
async function renderCockpitMarkup(): Promise<string> {
  const { default: ProjectCockpitHome } = await import("../ProjectCockpitHome");
  return renderToStaticMarkup(<ProjectCockpitHome />);
}

describe("ProjectCockpitHome layout — Task 36.1 wrapper band", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectState.currentProjectId = null;
    projectState.projects = [];
    projectState.clarificationQuestions = [];
    projectState.missions = [];
    projectState.evidence = [];
  });

  it("does NOT render the timeline as a position:fixed overlay", async () => {
    const markup = await renderCockpitMarkup();

    // 双向匹配：style 在 data-component 之前 / 之后两种 attribute 顺序都不允许。
    // SSR 会按 props 顺序输出 attribute；两条正则覆盖任意 attribute 排列。
    expect(markup).not.toMatch(
      /data-component=["']project-main-chain-timeline["'][^>]*position:\s*fixed/i,
    );
    expect(markup).not.toMatch(
      /position:\s*fixed[^>]*data-component=["']project-main-chain-timeline["']/i,
    );

    // 也不允许 timeline band 容器自己出现 position: fixed。
    expect(markup).not.toMatch(
      /data-region=["']project-cockpit-timeline-band["'][^>]*position:\s*fixed/i,
    );
    expect(markup).not.toMatch(
      /position:\s*fixed[^>]*data-region=["']project-cockpit-timeline-band["']/i,
    );
  });

  it("renders the timeline anchor INSIDE the project-cockpit-layout-band container", async () => {
    const markup = await renderCockpitMarkup();

    // 1. layout band 容器存在并打开了开标签。
    const layoutBandMatch = markup.match(
      /<[^>]+data-region=["']project-cockpit-layout-band["'][^>]*>/i,
    );
    expect(layoutBandMatch).not.toBeNull();

    // 2. timeline anchor（`ProjectMainChainTimeline` 的稳定 `data-component`）存在。
    const timelineMatch = markup.match(
      /<[^>]+data-component=["']project-main-chain-timeline["'][^>]*>/i,
    );
    expect(timelineMatch).not.toBeNull();

    // 3. timeline anchor 必须出现在 layout band 开标签之后（=> 是其后代）。
    const layoutBandIndex = markup.indexOf(layoutBandMatch![0]);
    const timelineIndex = markup.indexOf(timelineMatch![0]);
    expect(layoutBandIndex).toBeGreaterThanOrEqual(0);
    expect(timelineIndex).toBeGreaterThan(layoutBandIndex);

    // 4. timeline band 槽位作为中间层锚点也存在，且也在 layout band 之后。
    const timelineBandMatch = markup.match(
      /<[^>]+data-region=["']project-cockpit-timeline-band["'][^>]*>/i,
    );
    expect(timelineBandMatch).not.toBeNull();
    const timelineBandIndex = markup.indexOf(timelineBandMatch![0]);
    expect(timelineBandIndex).toBeGreaterThan(layoutBandIndex);
    expect(timelineBandIndex).toBeLessThan(timelineIndex);
  });

  it("uses bounded dimensions for the timeline band (no 100vw / 100vh)", async () => {
    const markup = await renderCockpitMarkup();

    // 提取 timeline band 容器的开标签。
    const timelineBandMatch = markup.match(
      /<[^>]+data-region=["']project-cockpit-timeline-band["'][^>]*>/i,
    );
    expect(timelineBandMatch).not.toBeNull();

    const tag = timelineBandMatch![0];

    // 解析 inline style="...".
    const styleMatch = tag.match(/style=["']([^"']*)["']/i);
    expect(styleMatch).not.toBeNull();
    const styleStr = styleMatch![1].toLowerCase();

    // 不允许霸占整个视口的尺寸。
    expect(styleStr).not.toMatch(/width:\s*100vw/);
    expect(styleStr).not.toMatch(/height:\s*100vh/);

    // 同样不允许 timeline 组件自身的 inline style 把视口霸占。
    const timelineMatch = markup.match(
      /<[^>]+data-component=["']project-main-chain-timeline["'][^>]*>/i,
    );
    expect(timelineMatch).not.toBeNull();
    const timelineStyleMatch = timelineMatch![0].match(/style=["']([^"']*)["']/i);
    if (timelineStyleMatch) {
      const timelineStyle = timelineStyleMatch[1].toLowerCase();
      expect(timelineStyle).not.toMatch(/width:\s*100vw/);
      expect(timelineStyle).not.toMatch(/height:\s*100vh/);
    }
  });
});
