// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

/**
 * actionRef → onAction（2026-08-13）。
 *
 * 自由树此前只有"看"这一维：dataRef/rowsRef/fieldRef 全是读，节点上一个动作
 * 字段都没有，所以模型画出来的按钮是**会发光的 div**——线上报的"点详情没反应"
 * 就是这个形态。管道其实一直是通的（ExperienceBlockRendererProps.onAction 每个
 * 渲染器都收得到），缺的只是节点上一个能接线的地方。
 *
 * 这里钉住五件事，都是这条线断掉时会**静默**失效的：
 *   ① 点一下真的发事件，且 actionId 跟 pagePipes 的入口对得上
 *   ② openRecord/editRecord 带得出当前行的 rowId（不带就是"点了没反应"）
 *   ③ 拿不到行时不发空事件（宁可不动，也别发一个 rowId 为空的请求）
 *   ④ 键盘可达 —— 挂了 role="button" 就得配得上键盘
 *   ⑤ 没有 actionRef 的节点不许长成假按钮
 *
 * 尤其是③⑤：失败的样子都是"看起来正常"，不写判据就没人会发现。
 *
 * 仓库里没有 @testing-library/react（HoloDrawer 那条注释是明说的），所以
 * 自己拿 createRoot + act 搭一个十行的挂载器——只为了能真的派发一次点击，
 * 不引新依赖。
 */
// 不设这个标志 React 会走"环境不支持 act"的兼容分支，每次调用刷一行 stderr，
// 且更新不保证在 act 返回前冲干净——断言就变成在赛跑。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("FreeformInsight actionRef → onAction", () => {
  const ROWS: RuntimeRow[] = [
    { id: "p1", values: { prescription_no: "RX-001", patient_name: "张三" } },
    { id: "p2", values: { prescription_no: "RX-002", patient_name: "李四" } },
  ] as unknown as RuntimeRow[];

  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function mount(
    node: FreeformNode,
    onAction?: (actionId: string, eventData?: Record<string, unknown>) => void
  ): HTMLElement {
    const block: ExperienceBlockInstance = {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: node as unknown as Record<string, unknown> },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <ExperienceBlockBoundary
          block={block}
          entityRows={{ prescriptions: ROWS }}
          onAction={onAction}
        />
      );
    });
    return host;
  }

  const buttons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[role="button"]'));

  const click = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  const press = (el: HTMLElement, key: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });

  /** 列表容器 + 一行的模板，整行是点击目标——模型实测就是这么放的。 */
  const clickableRow = (kind: "openRecord" | "editRecord"): FreeformNode => ({
    tag: "div",
    rowsRef: {
      entityRef: "prescriptions",
      fieldRefs: ["prescription_no", "patient_name"],
    },
    children: [
      {
        tag: "div",
        actionRef: { kind, entityRef: "prescriptions" },
        children: [{ tag: "span", fieldRef: "prescription_no" }],
      },
    ],
  });

  it("openRecord 点一下发 viewRequest，并带上这一行的 rowId", () => {
    const onAction = vi.fn();
    const rows = buttons(mount(clickableRow("openRecord"), onAction));
    expect(rows).toHaveLength(2);

    click(rows[1]);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("viewRequest", {
      entityRef: "prescriptions",
      rowId: "p2",
    });
  });

  it("editRecord 走 editRequest，跟 openRecord 分得开", () => {
    const onAction = vi.fn();
    click(buttons(mount(clickableRow("editRecord"), onAction))[0]);
    expect(onAction).toHaveBeenCalledWith("editRequest", {
      entityRef: "prescriptions",
      rowId: "p1",
    });
  });

  it("createRecord 在列表外也能发，且不带 rowId", () => {
    const onAction = vi.fn();
    const el = mount(
      {
        tag: "div",
        children: [
          {
            tag: "span",
            text: "新建处方",
            actionRef: { kind: "createRecord", entityRef: "prescriptions" },
          },
        ],
      },
      onAction
    );
    click(buttons(el)[0]);
    expect(onAction).toHaveBeenCalledWith("createRequest", {
      entityRef: "prescriptions",
    });
  });

  it("键盘也能触发（Enter / 空格），其他键不触发", () => {
    const onAction = vi.fn();
    const row = buttons(mount(clickableRow("openRecord"), onAction))[0];
    expect(row.tabIndex).toBe(0);

    press(row, "Enter");
    press(row, " ");
    expect(onAction).toHaveBeenCalledTimes(2);

    onAction.mockClear();
    press(row, "a");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("拿不到当前行时不发空事件", () => {
    // openRecord 落在列表外 —— Python 侧的树级校验拦得住，运行时也得兜住：
    // 发一个 rowId 为空的 viewRequest，页面会打开一个空详情，比不动更糟。
    const onAction = vi.fn();
    const el = mount(
      {
        tag: "div",
        children: [
          {
            tag: "span",
            text: "查看",
            actionRef: { kind: "openRecord", entityRef: "prescriptions" },
          },
        ],
      },
      onAction
    );
    click(buttons(el)[0]);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("没有 actionRef 的节点不许长成假按钮", () => {
    const html = renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{
          id: "b1",
          type: "FreeformInsight",
          freeformContent: {
            root: {
              tag: "div",
              children: [{ tag: "span", text: "查看详情" }],
            } as unknown as Record<string, unknown>,
          },
        }}
        entityRows={{ prescriptions: ROWS }}
        onAction={() => undefined}
      />
    );
    expect(html).toContain("查看详情");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("cursor:pointer");
  });

  it("没有 onAction 时不挂 role=button —— 别把点不动的东西装成能点", () => {
    expect(buttons(mount(clickableRow("openRecord")))).toHaveLength(0);
  });
});
