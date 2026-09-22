// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordFormDrawer, type RecordActionRequest } from "../RecordFormDrawer";
import type { RuntimeState } from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";

/**
 * RecordFormDrawer——HTML 页面动作的表单面（写数据闭环的后半程）。
 *
 * 钉住的都是这条线断掉时会**静默**失效的行为：
 *   ① createRecord 不再静默塞空行——空表单直接保存要被校验拦下
 *   ② 保存真的走 addRow/updateRow：onApply 收到的状态里有那行数据
 *   ③ 第一条真实数据落地前演示种子被清掉（EntityDataPanel 的既有纪律，
 *      这里不能是例外——漏了的话用户找不到自己刚写的那条）
 *   ④ openRecord 是详情不是表单；编辑入口在抽屉里，取消回详情不丢行值
 *   ⑤ 行不存在（已删）时如实报错，不渲染一张空表单装作能编辑
 *
 * 挂载器沿用 freeform-actionref.test.tsx 的十行方案（仓库里没有
 * @testing-library/react）。antd Drawer 走 portal，断言查 document.body。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// antd 的 Form/Grid 走 responsiveObserver 订阅断点，jsdom 没有 matchMedia——
// 给个恒 false 的静态桩（测试只关心行为，不关心响应式布局）。
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const MODEL = {
  datamodel: {
    entities: [
      {
        id: "pet",
        name: "宠物",
        fields: [
          { id: "name", name: "名字", type: "string" },
          { id: "age", name: "年龄", type: "number" },
        ],
      },
    ],
  },
} as unknown as FiveSystemModel;

/** 一行真实数据 + 一行演示种子（③ 要看种子被清）。 */
function makeState(): RuntimeState {
  return {
    entities: {
      pet: [
        { id: "row-1", values: { name: "旺财", age: 3 }, createdAt: "2026-08-14T00:00:00.000Z" },
        { id: "row-2", values: { name: "示例猫", age: 1 }, createdAt: "2026-08-14T00:00:00.000Z", seed: true },
      ],
    },
    instances: [],
    seq: 2,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

function mount(
  request: RecordActionRequest,
  state: RuntimeState = makeState(),
  handlers: {
    onApply?: (next: RuntimeState) => void;
    onClose?: () => void;
  } = {}
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <RecordFormDrawer
        model={MODEL}
        state={state}
        request={request}
        onClose={handlers.onClose ?? (() => undefined)}
        onApply={handlers.onApply ?? (() => undefined)}
      />
    );
  });
}

const q = <T extends HTMLElement>(selector: string): T | null =>
  document.body.querySelector<T>(selector);

const byTestId = (id: string) => q<HTMLElement>(`[data-testid="${id}"]`);

const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

/** 受控 antd Input 的写法：原生 setter + input 事件（React 监听的是 input）。 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RecordFormDrawer 新建（createRecord）", () => {
  it("空表单直接保存被校验拦下，onApply 不被调用", () => {
    const onApply = vi.fn();
    mount({ kind: "createRecord", entityId: "pet", rowId: null }, makeState(), { onApply });

    expect(byTestId("record-form-field-name")).toBeTruthy();
    click(byTestId("record-form-save")!);

    expect(onApply).not.toHaveBeenCalled();
    expect(byTestId("record-form-problem")?.textContent).toContain("至少填写一个字段");
  });

  it("填值保存走 addRow：新行入库、演示种子被清、抽屉请求关闭", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    mount({ kind: "createRecord", entityId: "pet", rowId: null }, makeState(), { onApply, onClose });

    const input = q<HTMLInputElement>('[data-testid="record-form-field-name"] input');
    expect(input).toBeTruthy();
    typeInto(input!, "小黑");
    click(byTestId("record-form-save")!);

    expect(onApply).toHaveBeenCalledTimes(1);
    const next = onApply.mock.calls[0][0] as RuntimeState;
    const rows = next.entities.pet;
    // 种子行（row-2）被清，真实行（row-1）保留，新行追加
    expect(rows.map(r => r.values.name)).toEqual(["旺财", "小黑"]);
    expect(rows.some(r => r.seed)).toBe(false);
    const created = rows.find(r => r.values.name === "小黑");
    expect(created).toBeTruthy();
    expect(next.selection?.pet).toBe(created!.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("RecordFormDrawer 详情（openRecord）", () => {
  it("开屏是只读详情：值可见、没有输入框、有编辑入口", () => {
    mount({ kind: "openRecord", entityId: "pet", rowId: "row-1" });

    const detail = byTestId("record-detail-field-name");
    expect(detail?.textContent).toContain("旺财");
    expect(q('[data-testid="record-form-field-name"] input')).toBeNull();
    expect(byTestId("record-form-edit")).toBeTruthy();
    expect(byTestId("record-form-save")).toBeNull();
  });

  it("编辑 → 取消回详情，行值不丢；编辑 → 保存走 updateRow", () => {
    const onApply = vi.fn();
    mount({ kind: "openRecord", entityId: "pet", rowId: "row-1" }, makeState(), { onApply });

    click(byTestId("record-form-edit")!);
    const input = q<HTMLInputElement>('[data-testid="record-form-field-name"] input');
    expect(input?.value).toBe("旺财");

    typeInto(input!, "旺财二世");
    click(byTestId("record-form-cancel")!);
    // 取消回详情：改的值被丢弃，显示的还是行里那份
    expect(byTestId("record-detail-field-name")?.textContent).toContain("旺财");

    click(byTestId("record-form-edit")!);
    const again = q<HTMLInputElement>('[data-testid="record-form-field-name"] input');
    typeInto(again!, "旺财二世");
    click(byTestId("record-form-save")!);

    const next = onApply.mock.calls[0][0] as RuntimeState;
    const row1 = next.entities.pet.find(r => r.id === "row-1")!;
    expect(row1.values.name).toBe("旺财二世");
    expect(row1.values.age).toBe(3); // 没动的字段不丢
  });
});

describe("RecordFormDrawer 编辑（editRecord）", () => {
  it("直接进表单且行值预填", () => {
    mount({ kind: "editRecord", entityId: "pet", rowId: "row-1" });
    const input = q<HTMLInputElement>('[data-testid="record-form-field-name"] input');
    expect(input?.value).toBe("旺财");
    expect(byTestId("record-form-save")).toBeTruthy();
  });

  it("行不存在（已删）时如实报错，不渲染表单也没有保存按钮", () => {
    mount({ kind: "editRecord", entityId: "pet", rowId: "row-gone" });
    expect(byTestId("record-form-no-row")).toBeTruthy();
    expect(q('[data-testid="record-form-field-name"]')).toBeNull();
    expect(byTestId("record-form-save")).toBeNull();
  });

  it("实体不在模型里时如实报错（绑定问题不该被表单面掩盖）", () => {
    mount({ kind: "editRecord", entityId: "ghost", rowId: "row-1" });
    expect(byTestId("record-form-no-entity")).toBeTruthy();
    expect(byTestId("record-form-save")).toBeNull();
  });
});
