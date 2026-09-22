import React from "react";
import {
  readShellSidebarCollapsed,
  writeShellSidebarCollapsed,
} from "./shell-sidebar-layout";

export type ShellSidebarApi = {
  collapsed: boolean;
  toggle: () => void;
};

const ShellSidebarContext = React.createContext<ShellSidebarApi | null>(null);

export function ShellSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  /* ⚠ 2026-08-18 曾经 mount 时强制摊开——顶栏钮撤了，读旧 localStorage
     会把侧栏折没。2026-09-20 钮回到侧栏顶，可以再记折叠。 */
  const [collapsed, setCollapsed] = React.useState(readShellSidebarCollapsed);

  const toggle = React.useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeShellSidebarCollapsed(next);
      return next;
    });
  }, []);

  const value = React.useMemo(
    () => ({ collapsed, toggle }),
    [collapsed, toggle]
  );

  return (
    <ShellSidebarContext.Provider value={value}>
      {children}
    </ShellSidebarContext.Provider>
  );
}

export function useShellSidebar(): ShellSidebarApi | null {
  return React.useContext(ShellSidebarContext);
}
