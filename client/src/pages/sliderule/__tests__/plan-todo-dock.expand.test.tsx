// @vitest-environment jsdom
/**
 * 待办卡点开展开。必须 jsdom：SSR 画不出 click 之后的清单。
 *
 * 不跟 plan-todo-dock.test.tsx 混——那份要 import ClaudeChatSurface，
 * jsdom 没有 TransformStream，整文件会在收集阶段炸掉。
 *
 * 夹具跟那份同一份真机 controlTodo。自己拼干净清单测不出默认折叠。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlanTodoDock } from "../PlanTodoDock";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const REAL_TODO = [
  { id: "1", status: "completed", content: "创建 react-vite-tasks 工程并读取源码" },
  { id: "2", status: "in_progress", content: "补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表" },
  { id: "3", status: "pending", content: "核对认证与用户隔离的待办 API / SQLite" },
  { id: "4", status: "pending", content: "project_exec 跑 check/build/test 并修复" },
  { id: "5", status: "pending", content: "保留运行后申请 project_verify 并读取验证结果" },
];

describe("点开才摊清单", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("正向：点收起条才看见其余条目；反向：没点开就没有", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PlanTodoDock items={REAL_TODO} />);
    });
    const dock = container.querySelector('[data-testid="plan-todo-dock"]');
    expect(dock, "浮层必须在").not.toBeNull();
    expect(dock!.getAttribute("data-plan-todo-surface")).toBe("manus");
    expect(container.textContent).toContain("补丁前端");
    expect(container.textContent).toContain("2/5");
    expect(container.textContent).not.toContain("核对认证与用户隔离");
    expect(
      container.querySelector("button")?.getAttribute("aria-expanded")
    ).toBe("false");

    await act(async () => {
      container!.querySelector("button")!.click();
    });
    expect(
      container.querySelector("button")?.getAttribute("aria-expanded")
    ).toBe("true");
    expect(container.textContent).toContain("创建 react-vite-tasks 工程并读取源码");
    expect(container.textContent).toContain("核对认证与用户隔离");
    expect(container.textContent).toContain("待办");
    const list = container.querySelector("[data-todo-list]");
    expect(list, "清单必须自己滚，不许溢到底栏").not.toBeNull();
    expect(list!.className).toContain("overflow-y-auto");
    expect(list!.className).toContain("overscroll-contain");
    expect(container.innerHTML).toContain("break-words");
  });

  it("进行中那条挂上当前动作细节，点一下能跟档", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PlanTodoDock
          items={REAL_TODO}
          action={{
            id: "write-1",
            tool: "file_write",
            detail: "src/pages/Home.tsx",
          }}
        />
      );
    });
    await act(async () => {
      container!.querySelector("button")!.click();
    });
    expect(container!.textContent).toContain("src/pages/Home.tsx");
    expect(
      container!.querySelector('[data-testid="plan-todo-action"]')
    ).not.toBeNull();
  });
});
