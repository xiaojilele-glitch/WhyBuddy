// @vitest-environment jsdom
/**
 * 点选编辑的**选中链路**必须真的接上——不是"selectElement 写对了"，是
 * "点一下页面里的元素，工具条真的出来"。
 *
 * ⚠ 2026-08-25 真机（健身房那趟）：整个选中功能静默失效。进得去编辑态、
 * iframe 画得出页面、控制台零报错、静态元素一个不少（量到 122 个可点元素），
 * 就是点谁都没反应。原因是挂点击监听器只发生在 iframe 的 `load` 回调里，而
 * `frame.srcdoc = doc` 之后 **load 不来**：srcdoc 写进的是那个初始 about:blank
 * 文档，浏览器按"替换初始空文档"处理，不补第二次 load；唯一那次 load 早于我们
 * 挂监听器，同步补调的 onLoad() 又因为 token 还没出现被 guard 挡掉。
 *
 * 同旁边 click-edit-stage.test.ts 的分工：那份钉纯函数（换壳、判据、量尺），
 * 这份钉**接线**。304 行纯函数测试全绿而功能整个是坏的，就是"函数写对了 ≠
 * 它被调用了"最贵的一次现场。
 *
 * 这里刻意复现真机时序：只让文档带上 token，**从不派发 load 事件**。
 * 把组件里那段轮询删掉，这条必须变红。
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClickEditStage } from "../ClickEditStage";

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>档案页</title></head><body><h1 data-field="title">原标题</h1><button data-action="save">保存</button></body></html>`;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 不设这个，act() 不会真的冲刷更新，测试可能"绿得不作数"。
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** 只把文档内容就位，**不**派发 load —— 真机上就是这个时序。 */
function landDocumentWithoutLoadEvent(frame: HTMLIFrameElement): Document {
  const token = (String(frame.getAttribute("srcdoc") || "").match(
    /data-sr-frame="([^"]+)"/
  ) || [])[1];
  expect(token, "组件应当把 token 写进 srcdoc").toBeTruthy();
  const d = frame.contentDocument as Document;
  d.documentElement.setAttribute("data-sr-frame", token as string);
  d.body.innerHTML = `<h1 data-field="title">原标题</h1><button data-action="save">保存</button>`;
  return d;
}

function mount(): HTMLIFrameElement {
  act(() => {
    root.render(
      <ClickEditStage appId="app-1" pageId="p1" html={PAGE} device="desktop" />
    );
  });
  const frame = host.querySelector("iframe") as HTMLIFrameElement;
  expect(frame, "编辑画布 iframe 应当挂出来").toBeTruthy();
  return frame;
}

describe("点选编辑：选中链路接没接上", () => {
  it("load 事件不来也要接上：点元素能选中，工具条和选中框都出现", () => {
    const frame = mount();
    const d = landDocumentWithoutLoadEvent(frame);

    // 反向判据先立住：还没点任何东西时，工具条/选中框必须不存在。
    // （别拿"保存修改"当判据——那是编辑态常驻按钮，选没选中它都在，
    //   真机第一版就是被它骗出一个假绿。）
    expect(host.querySelector('[data-testid="click-edit-toolbar"]')).toBeNull();
    expect(host.querySelector('[data-testid="click-edit-outline"]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200); // 轮询接管的窗口
    });

    act(() => {
      d.querySelector("h1")!.dispatchEvent(
        new d.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(
      host.querySelector('[data-testid="click-edit-toolbar"]'),
      "点了元素却没出工具条 —— 选中监听器没接上，功能静默失效"
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="click-edit-outline"]')).not.toBeNull();
  });

  it("点到不可编辑的地方取消选中（选中态不会赖着不走）", () => {
    const frame = mount();
    const d = landDocumentWithoutLoadEvent(frame);
    act(() => vi.advanceTimersByTime(200));

    act(() => {
      d.querySelector("h1")!.dispatchEvent(
        new d.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(host.querySelector('[data-testid="click-edit-toolbar"]')).not.toBeNull();

    act(() => {
      d.body.dispatchEvent(
        new d.defaultView!.MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(
      host.querySelector('[data-testid="click-edit-toolbar"]'),
      "点空白处应当取消选中"
    ).toBeNull();
  });

  it("卸载后不留永动定时器（增强类逻辑不许拖住页面）", () => {
    const frame = mount();
    landDocumentWithoutLoadEvent(frame);
    const clear = vi.spyOn(window, "clearInterval");
    act(() => root.unmount());
    expect(clear).toHaveBeenCalled();
    root = createRoot(host); // 给 afterEach 的 unmount 留个活的 root
  });
});
