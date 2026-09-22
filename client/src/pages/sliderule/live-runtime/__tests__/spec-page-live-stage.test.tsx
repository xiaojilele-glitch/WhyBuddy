// @vitest-environment jsdom
/**
 * 推演中右侧的页面舞台。
 *
 * 这一层要挡的是三件**都不会报错**的事：
 *   ① 页面到了但右侧还在转圈（接线断在任何一环，没有一处会红）
 *   ② 换页时框里还留着上一页（React 复用同一个 iframe）
 *   ③ 手动选了一页，被新到达的页面挤走（存下标而不是 pageId）
 *
 * ⚠ 渲染走**同源** iframe（要 contentDocument 才能填数/点击/游标/切页；
 * 08-14 一度做成沙箱，把这四件事全挡死了）。jsdom 不跑 srcdoc，所以判据
 * 落在"挂了几个框、挂的是哪一页"，不落在框内渲染出来的 DOM 上。
 *
 * 仓库里没有 @testing-library/react（freeform-actionref 那条注释是明说的），
 * 所以照它的做法拿 createRoot + act 搭挂载器，不引新依赖。
 */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  SpecPageLiveStage,
  resolveActivePageId,
  type SpecPageLive,
} from "../SpecPageLiveStage";

// 不设这个标志 React 会走"环境不支持 act"的兼容分支，更新不保证在 act 返回前
// 冲干净——断言就变成在赛跑。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const page = (id: string, n: number, total = 3, bound = false): SpecPageLive => ({
  pageId: id,
  html: `<main><h1>${id}</h1></main>`,
  current: n,
  total,
  bound,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(pages: SpecPageLive[]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SpecPageLiveStage pages={pages} />));
  return host;
}

function update(pages: SpecPageLive[]): void {
  act(() => root!.render(<SpecPageLiveStage pages={pages} />));
}

// 页签条 2026-08-14 晚下架（切页归页面自己的菜单），当前页从舞台根节点的
// data-active-page 属性读——它同时也是宿主/游标跟随的依据。
const activePage = () =>
  host!
    .querySelector('[data-testid="sliderule-spec-page-stage"]')!
    .getAttribute("data-active-page");
const frames = () =>
  host!.querySelectorAll<HTMLIFrameElement>('[data-testid="html-app-surface"]');
const stageText = () =>
  host!.querySelector('[data-testid="sliderule-spec-page-stage"]')!.textContent || "";

describe("有页面就渲染，没页面就让位", () => {
  it("一页都没有时不占位 —— 交给原来的『推演中』那支", () => {
    expect(mount([]).firstChild).toBeNull();
  });

  it("有页面就挂出渲染框", () => {
    mount([page("p1", 1)]);
    expect(frames()).toHaveLength(1);
  });

  it("同时只挂一个框 —— 不是把所有页堆在一起", () => {
    mount([page("p1", 1), page("p2", 2)]);
    expect(frames()).toHaveLength(1);
  });
});

describe("没手动选过就跟最新一页", () => {
  it("页面陆续到达时，显示的是最后到的那页", () => {
    mount([page("p1", 1)]);
    expect(activePage()).toBe("p1");

    update([page("p1", 1), page("p2", 2)]);
    expect(activePage()).toBe("p2");
  });

  it("选页判定：手动选过的页不被新到达的页挤走（resolveActivePageId）", () => {
    /**
     * ⚠ 这条钉的是"存 pageId 不是存下标"。存下标时新页面一到，同一个下标
     * 指向的就是另一页了——表现是"我明明点了甲页，它自己跳到乙页去"。
     * 页签下架后手动选页的唯一入口是**框内菜单**（data-page-id → onNavigate
     * → setPicked），jsdom 跑不了 srcdoc、组件层点不到——所以判定抽成
     * 纯函数在这钉死，组件里就是原样调它。
     */
    const ps = [page("p1", 1), page("p2", 2), page("p3", 3)];
    // 选过的页还在 → 听手动的，新页到达不挤
    expect(resolveActivePageId("p1", ps)).toBe("p1");
    // 没选过 → 跟最新
    expect(resolveActivePageId(null, ps)).toBe("p3");
    // 选的页不存在（换了一轮推演）→ 回落最新，不悬空
    expect(resolveActivePageId("ghost", ps)).toBe("p3");
    expect(resolveActivePageId(null, [])).toBeNull();
  });

  it("导航缺页也能选中，默认仍落在最后一页成品上", () => {
    const ps = [
      { ...page("p1", 1), missing: true },
      page("p2", 2),
      page("p3", 3),
      { ...page("p4", 4), missing: true },
    ];
    expect(resolveActivePageId(null, ps)).toBe("p3");
    expect(resolveActivePageId("p1", ps)).toBe("p1");
    expect(resolveActivePageId("ghost", ps)).toBe("p3");
  });

  it("defaultPageId 指定开屏页（应用中心预览落导航第一页用它）", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <SpecPageLiveStage pages={[page("p1", 1), page("p2", 2)]} defaultPageId="p1" />
      )
    );
    expect(activePage()).toBe("p1");
  });

  it("跑完落落地页，不跟最后画完的那页（resolveActivePageId）", () => {
    /**
     * 2026-08-20 巡检：推演跟最新页没错，跑完还停在 p3，打开态抽屉盖住菜单。
     * 应用中心预览早已落导航第一项；舞台跑完必须同一口径。
     * 把调用点的 opts 拿掉，下面那条挂载用例必须红——本条只钉纯函数。
     */
    const ps = [page("p1", 1), page("p2", 2), page("p3", 3)];
    expect(resolveActivePageId(null, ps, { running: false, landingPageId: "p1" })).toBe("p1");
    expect(resolveActivePageId("p2", ps, { running: false, landingPageId: "p1" })).toBe("p2");
    expect(resolveActivePageId(null, ps, { running: true, landingPageId: "p1" })).toBe("p3");
    expect(resolveActivePageId(null, ps)).toBe("p3");
  });

  it("running=false 挂载落第一页成品 —— 调用点漏传 opts 本条红", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <SpecPageLiveStage
          pages={[page("p1", 1), page("p2", 2), page("p3", 3)]}
          running={false}
        />
      )
    );
    expect(activePage()).toBe("p1");
  });

  it("跑完落第一份成品，缺页 stub 不算落地", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <SpecPageLiveStage
          pages={[
            { ...page("p1", 1), missing: true },
            page("p2", 2),
            page("p3", 3),
          ]}
          running={false}
        />
      )
    );
    expect(activePage()).toBe("p2");
  });
});

describe("画布视口按设备选（2026-08-14 竖屏）", () => {
  const badge = () =>
    host!.querySelector('[data-testid="sliderule-spec-page-scale"]')!.textContent || "";

  it("桌面页（device 缺席按桌面兜底）用 1920×1080", () => {
    mount([page("p1", 1)]);
    expect(badge()).toContain("1920×1080");
  });

  it("手机页用 390×844 —— 1080 宽会让 Tailwind lg: 着火，内容缩成机模", () => {
    mount([{ ...page("p1", 1), device: "phone" as const }]);
    expect(badge()).toContain("390×844");
    const stage = frames()[0].parentElement as HTMLElement;
    expect(stage.style.width).toBe("390px");
    expect(stage.style.height).toBe("844px");
  });

  it("平板页用 1112×834，不套手机框，也不折成 1920", () => {
    /**
     * 2026-08-30 夜：SSE 把 tablet 折成 desktop，徽标仍是 1920×1080。
     * 把 specPageViewport 的 tablet 枝删掉本条必须红。
     */
    mount([{ ...page("p1", 1), device: "tablet" as const }]);
    expect(badge()).toContain("1112×834");
    expect(badge()).not.toContain("1920×1080");
    const stage = frames()[0].parentElement as HTMLElement;
    expect(stage.style.width).toBe("1112px");
    expect(stage.style.height).toBe("834px");
    expect(host!.querySelector('[data-testid="sliderule-phone-frame"]')).toBeNull();
  });

  it("手机页套设备框，桌面页不套", () => {
    mount([page("p1", 1)]);
    expect(host!.querySelector('[data-testid="sliderule-phone-frame"]')).toBeNull();
    update([{ ...page("p1", 1), device: "phone" as const }]);
    expect(host!.querySelector('[data-testid="sliderule-phone-frame"]')).toBeTruthy();
    expect(
      host!.querySelector('[data-testid="sliderule-phone-home-indicator"]')
    ).toBeTruthy();
  });

  it("分辨率徽标在左侧，手机默认报 80%", () => {
    /**
     * ⚠ 2026-08-20：徽标曾经 ml-auto 贴在右上角，跟顶栏工具挤在一起。
     * 手机 contain 会到 110%。改回右侧或默认 100% 必须红。
     */
    mount([{ ...page("p1", 1), device: "phone" as const }]);
    const meta = host!.querySelector('[data-testid="sliderule-stage-meta"]')!;
    const scale = host!.querySelector('[data-testid="sliderule-spec-page-scale"]')!;
    const bound = host!.querySelector('[data-testid="sliderule-spec-page-bound"]')!;
    expect(meta.contains(scale)).toBe(true);
    expect(scale.className).not.toMatch(/ml-auto/);
    expect(scale.className).not.toMatch(/rounded-full/);
    expect(scale.className).not.toMatch(/bg-stone-100/);
    expect(meta.innerHTML.indexOf("sliderule-spec-page-scale")).toBeLessThan(
      meta.innerHTML.indexOf("sliderule-spec-page-bound")
    );
    expect(scale.textContent).toContain("390×844");
    expect(scale.textContent).toMatch(/80%/);
  });

  it("角色落在说明行右侧，不跟分辨率抢左边", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <SpecPageLiveStage
          pages={[{ ...page("p1", 1), device: "phone" as const }]}
          metaTrailing={<button type="button" data-testid="role-slot">项目经理</button>}
        />
      )
    );
    const meta = host.querySelector('[data-testid="sliderule-stage-meta"]')!;
    const trailing = host.querySelector('[data-testid="sliderule-stage-meta-trailing"]')!;
    expect(meta.contains(trailing)).toBe(true);
    expect(trailing.textContent).toContain("项目经理");
    expect(trailing.className).toMatch(/ml-auto/);
    expect(meta.innerHTML.indexOf("sliderule-spec-page-scale")).toBeLessThan(
      meta.innerHTML.indexOf("sliderule-stage-meta-trailing")
    );
  });

  it("接数和分辨率在机框外 —— 叠在底栏上会挡住切换", () => {
    mount([{ ...page("p1", 1), device: "phone" as const, bound: true }]);
    const frame = host!.querySelector('[data-testid="sliderule-phone-frame"]')!;
    const meta = host!.querySelector('[data-testid="sliderule-stage-meta"]')!;
    expect(meta).toBeTruthy();
    expect(meta.contains(host!.querySelector('[data-testid="sliderule-spec-page-bound"]'))).toBe(
      true
    );
    expect(meta.contains(host!.querySelector('[data-testid="sliderule-spec-page-scale"]'))).toBe(
      true
    );
    expect(frame.contains(host!.querySelector('[data-testid="sliderule-spec-page-bound"]'))).toBe(
      false
    );
    expect(frame.contains(host!.querySelector('[data-testid="sliderule-spec-page-scale"]'))).toBe(
      false
    );
  });

  it("机框用边框当边框，内屏白底 —— 不靠溢出的 box-shadow，缺页不再透黑", () => {
    mount([{ ...page("p1", 1), device: "phone" as const }]);
    const frame = host!.querySelector('[data-testid="sliderule-phone-frame"]') as HTMLElement;
    const border = `${frame.style.border} ${frame.style.borderWidth} ${frame.style.borderStyle} ${frame.style.borderColor}`;
    expect(border).toMatch(/12px/);
    expect(border.toLowerCase()).toMatch(/solid/);
    expect(frame.style.boxShadow).not.toMatch(/0px 0px 0px 12px/);
    const screen = frame.firstElementChild as HTMLElement;
    expect(screen.style.overflow).toBe("hidden");
    expect((screen.style.background || screen.style.backgroundColor).replace(/\s/g, "")).toMatch(
      /#fff|#ffffff|rgb\(255,255,255\)/
    );
  });
});

describe("进度与接数状态如实说", () => {
  it("角标报已到几页 / 共几页", () => {
    mount([page("p1", 1, 5), page("p2", 2, 5)]);
    expect(stageText()).toContain("2/5");
  });

  it("第 3 步的素颜页如实标『尚未接数据』", () => {
    // 不是渲染失败——这个阶段本来就还没有数据（孔要等第 6.5 步）。
    // 装作已经接上，等于把"还没做"说成"做完了"。
    mount([page("p1", 1, 3, false)]);
    expect(
      host!.querySelector('[data-testid="sliderule-spec-page-bound"]')!.textContent
    ).toBe("尚未接数据");
  });

  it("打过孔的页标『已接数据』", () => {
    mount([page("p1", 1, 3, true)]);
    expect(
      host!.querySelector('[data-testid="sliderule-spec-page-bound"]')!.textContent
    ).toBe("已接数据");
  });

  it("总数以实到页数兜底 —— total 缺席不显 0/0", () => {
    mount([{ ...page("p1", 1), total: 0 }]);
    expect(stageText()).toContain("1/1");
  });
});

describe("换页要重挂，不能留着上一页", () => {
  it("切页后 iframe 被整个替换（key 带 pageId）", () => {
    /**
     * 判据落在**节点身份**上：key 变了 React 会新建一个 iframe，旧的那个
     * 不再在文档里。key 不带 pageId 的话 iframe 会被复用，srcdoc 换值时
     * 浏览器的重载时机不一致，能看到上一页残留一瞬——那时这条会红。
     * 页签下架后组件层能触发的换页是"新页到达、跟随最新"，判据不变。
     */
    mount([page("p1", 1)]);
    const before = frames()[0];
    update([page("p1", 1), page("p2", 2)]);
    expect(activePage()).toBe("p2");
    expect(frames()[0]).not.toBe(before);
  });
});

describe("跑完之后不许假装还在生成", () => {
  /**
   * ⚠ 这条是 08-14 那次交接改动带出来的：舞台在推演结束后**继续**渲染
   * 新链路的页面（原来是一收口就换回老链路区块页）。角标如果还挂着
   * 「界面生成中 5/5」，用户会一直等一个不会再变的东西。
   * 页签条下架后 running=false 不再有任何进度角标——页数菜单里数得出来，
   * 填数报告徽标留着（那是另一件事）。
   */
  it("running=false 时没有『生成中』字样，填数徽标还在", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <SpecPageLiveStage pages={[page("p1", 1, 2), page("p2", 2, 2)]} running={false} />
      )
    );
    expect(stageText()).not.toContain("生成中");
    expect(host!.querySelector('[data-testid="sliderule-spec-page-bound"]')).toBeTruthy();
  });

  it("默认仍按推演中处理 —— 老调用方不受影响", () => {
    mount([page("p1", 1, 2)]);
    expect(stageText()).toContain("生成中");
  });
});

/**
 * 缩放画布（2026-08-14）。
 *
 * 这些页面是照 1920×1080 画的——唯一的参照渲染器
 * `experiments/visual-first/render_pages.cjs` 就是拿这个视口截的图，V6.0 那次
 * 「有图 / 无图哪个好」的裁决也是照着那批 1920 宽的截图做的。
 *
 * 在此之前这里是**直接铺满容器**的：容器多宽 iframe 就多宽。那不会报错，
 * 只是让同一份 HTML 掉进 Tailwind 的低断点（`2xl:` 是 1536，1440 的容器里
 * 整档失效，多列栅格塌成少列）——**页面看着"就是长这样"，没有任何一处会说
 * 你看到的不是它被验收时的样子**。所以判据钉在"设计分辨率是不是 1920×1080"，
 * 不钉在缩放系数（那个跟容器走，jsdom 里量不出真值）。
 *
 * ⚠ 2026-08-20 晚试过 1920×1920，用户看完改回 16:9。高改成 1920 必须红。
 */
describe("页面装在 1920×1080 的画布里看", () => {
  const canvas = () =>
    host!.querySelector<HTMLElement>('[data-testid="sliderule-spec-page-canvas"]')!;

  it("有画布容器，iframe 不再直接铺满外层", () => {
    mount([page("p1", 1, 1)]);
    expect(canvas()).toBeTruthy();
    // iframe 落在画布里面，不是画布的兄弟节点
    expect(canvas().contains(frames()[0])).toBe(true);
  });

  it("设计分辨率钉死 1920×1080 —— 换了就是换了个没被验收过的版式", () => {
    mount([page("p1", 1, 1)]);
    const stage = frames()[0].parentElement as HTMLElement;
    expect(stage.style.width).toBe("1920px");
    expect(stage.style.height).toBe("1080px");
    expect(stage.style.height).not.toBe("1920px");
    // 同源舞台仍走 transform。工程预览跨源才改 zoom，这边不许跟着改。
    expect(stage.getAttribute("data-hit-fit")).toBe("transform");
    expect(stage.style.transform).toMatch(/^scale\(/);
    expect(stage.style.transformOrigin).toBe("top left");
    expect(stage.style.zoom).toBe("");
  });

  it("右下角那枚自述标识报的是设计分辨率，不是容器尺寸", () => {
    mount([page("p1", 1, 1)]);
    const badge = host!.querySelector('[data-testid="sliderule-spec-page-scale"]');
    expect(badge?.textContent).toContain("1920×1080");
    expect(badge?.textContent).not.toContain("1920×1920");
  });

  it("桌面画布垂直居中，不要顶对齐把上下留白全堆到下面", () => {
    /**
     * ⚠ 2026-08-20 午前满电青年曾禁 items-center（Header 像掉下来）。
     * 同日晚 City Walk：用户要垂直居中；正方形试过又改回 16:9，居中留下。
     * 改回 items-start 必须红。
     */
    mount([page("p1", 1, 1)]);
    const toks = canvas().className.split(/\s+/);
    expect(toks).toContain("items-center");
    expect(toks).toContain("justify-center");
    expect(toks).toContain("min-w-0");
    expect(toks).toContain("w-full");
    expect(toks).not.toContain("items-start");
    expect(toks).not.toContain("justify-start");
  });

  it("手机机模仍垂直居中", () => {
    mount([{ ...page("p1", 1, 1), device: "phone" }]);
    const toks = canvas().className.split(/\s+/);
    expect(toks).toContain("items-center");
    expect(toks).not.toContain("items-start");
  });
});
