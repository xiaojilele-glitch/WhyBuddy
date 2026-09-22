// @vitest-environment jsdom
/**
 * 生成页抽屉的开/关。对照 Radix Dialog / Headless UI Dialog 的状态机，
 * 不拉它们的组件。
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  entityFromTrigger,
  isBackdropClick,
  isCloseControl,
  isOverlayOpen,
  isOverlayRoot,
  overlayForEntity,
  overlayPanel,
  overlayRoots,
  setOverlayOpen,
  wireOverlays,
} from "../html-overlay";

const hosts: HTMLElement[] = [];
const stops: Array<() => void> = [];

afterEach(() => {
  while (stops.length) stops.pop()?.();
  while (hosts.length) hosts.pop()?.remove();
});

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

function wire(doc: Document = document): () => void {
  const stop = wireOverlays(doc);
  stops.push(stop);
  return stop;
}

const DRAWER = `
<aside><a data-page-id="p1">巡检工作台</a></aside>
<table data-rows="work_order"><tbody>
  <tr data-action="openRecord" data-entity="work_order"><td>WO-1</td></tr>
</tbody></table>
<div class="fixed inset-0 bg-black/60 z-50 flex justify-end" data-record="work_order">
  <div class="w-[480px] h-full shadow-2xl">
    <button aria-label="关闭"><svg><path d="M6 18L18 6M6 6l12 12"></path></svg></button>
    <p>工单调度详情</p>
  </div>
</div>
`;

describe("认遮罩，不认底栏和图片蒙层", () => {
  it("fixed inset-0 z-50 是浮层", () => {
    const host = mount(`<div class="fixed inset-0 z-50 bg-black/60"></div>`);
    expect(isOverlayRoot(host.firstElementChild!)).toBe(true);
  });

  it("底栏 fixed inset-x-0 bottom-0 不是浮层", () => {
    const host = mount(`<nav class="fixed inset-x-0 bottom-0 z-20">巡检</nav>`);
    expect(overlayRoots(host)).toHaveLength(0);
  });

  it("图片 absolute inset-0 不是浮层", () => {
    const host = mount(`<div class="absolute inset-0 bg-black">预览</div>`);
    expect(overlayRoots(host)).toHaveLength(0);
  });
});

describe("开 / 关（Radix onOpenChange）", () => {
  it("不在 wire 时强行关上 —— 首屏关着是生成提示词的事", () => {
    const host = mount(DRAWER);
    wire();
    expect(isOverlayOpen(overlayRoots(host)[0])).toBe(true);
  });

  it("点行打开，点遮罩关上", () => {
    const host = mount(DRAWER);
    wire();
    const overlay = overlayRoots(host)[0];
    setOverlayOpen(overlay, false);
    host.querySelector("td")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOverlayOpen(overlay)).toBe(true);
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOverlayOpen(overlay)).toBe(false);
  });

  it("点面板不关（Headless UI Panel stopPropagation 那条）", () => {
    const host = mount(DRAWER);
    wire();
    const overlay = overlayRoots(host)[0];
    setOverlayOpen(overlay, true);
    overlay.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOverlayOpen(overlay)).toBe(true);
  });

  it("点 ✕ 关上", () => {
    const host = mount(DRAWER);
    wire();
    const overlay = overlayRoots(host)[0];
    setOverlayOpen(overlay, true);
    overlay.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOverlayOpen(overlay)).toBe(false);
  });

  it("Escape 关上最上面那层", () => {
    const host = mount(DRAWER);
    wire();
    const overlay = overlayRoots(host)[0];
    setOverlayOpen(overlay, true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isOverlayOpen(overlay)).toBe(false);
  });

  it("点行会吞掉，避免再叠宿主 RecordFormDrawer", () => {
    const host = mount(DRAWER);
    wire();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("td")!.dispatchEvent(ev);
    expect(isOverlayOpen(overlayRoots(host)[0])).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("createRecord / editRecord 不吞，留给宿主表单", () => {
    const host = mount(`
      <button data-action="createRecord" data-entity="work_order">新建</button>
      <button data-action="editRecord" data-entity="work_order">编辑</button>
      <div class="fixed inset-0 z-50 flex justify-end" data-record="work_order">
        <div class="h-full shadow-2xl">面板</div>
      </div>
    `);
    wire();
    const overlay = overlayRoots(host)[0];
    setOverlayOpen(overlay, false);
    const createEv = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("[data-action='createRecord']")!.dispatchEvent(createEv);
    expect(isOverlayOpen(overlay)).toBe(false);
    expect(createEv.defaultPrevented).toBe(false);
    const editEv = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("[data-action='editRecord']")!.dispatchEvent(editEv);
    expect(isOverlayOpen(overlay)).toBe(false);
    expect(editEv.defaultPrevented).toBe(false);
  });

  it("关上的遮罩不偷切页", () => {
    const host = mount(DRAWER);
    wire();
    setOverlayOpen(overlayRoots(host)[0], false);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("[data-page-id]")!.dispatchEvent(ev);
    expect(isOverlayOpen(overlayRoots(host)[0])).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("Trigger 对得上抽屉", () => {
  it("data-entity 对 data-record", () => {
    const host = mount(DRAWER);
    const row = host.querySelector("[data-action]")!;
    expect(entityFromTrigger(row)).toBe("work_order");
    expect(overlayForEntity(host, "work_order")).toBe(overlayRoots(host)[0]);
  });

  it("backdrop 是点到根、不是点到面板", () => {
    const host = mount(DRAWER);
    const overlay = overlayRoots(host)[0];
    const panel = overlayPanel(overlay)!;
    expect(isBackdropClick(overlay, overlay)).toBe(true);
    expect(isBackdropClick(panel, overlay)).toBe(false);
    expect(isCloseControl(overlay.querySelector("button")!, overlay)).toBe(true);
  });
});
