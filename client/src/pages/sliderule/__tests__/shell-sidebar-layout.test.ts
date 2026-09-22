import { describe, expect, it } from "vitest";
import {
  readShellSidebarCollapsed,
  SHELL_SIDEBAR_KEY,
  SHELL_SIDEBAR_RAIL_PX,
  SHELL_SIDEBAR_WIDTH_PX,
  shellSidebarOccupiedPx,
  writeShellSidebarCollapsed,
} from "../shell-sidebar-layout";

describe("shell-sidebar-layout", () => {
  it("读写同一把 key，不是 1 以外的真值", () => {
    const mem = new Map<string, string>();
    const prev = globalThis.localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };
    try {
      expect(readShellSidebarCollapsed()).toBe(false);
      writeShellSidebarCollapsed(true);
      expect(mem.get(SHELL_SIDEBAR_KEY)).toBe("1");
      expect(readShellSidebarCollapsed()).toBe(true);
      writeShellSidebarCollapsed(false);
      expect(mem.get(SHELL_SIDEBAR_KEY)).toBe("0");
      expect(readShellSidebarCollapsed()).toBe(false);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });

  it("收起占图标轨，不是 0", () => {
    expect(SHELL_SIDEBAR_RAIL_PX).toBe(56);
    expect(shellSidebarOccupiedPx(false)).toBe(SHELL_SIDEBAR_WIDTH_PX);
    expect(shellSidebarOccupiedPx(true)).toBe(SHELL_SIDEBAR_RAIL_PX);
    expect(shellSidebarOccupiedPx(true)).not.toBe(0);
  });
});
