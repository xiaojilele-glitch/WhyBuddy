/**
 * 驱动工程工作台的视图切换。
 *
 * ⚠ 2026-09-14：控件从 tab 改成 `<select>`，又改成 Cursor 风格的
 *   自定义菜单。三个判据文件原来各写各的 `click("代码")` /
 *   `querySelector('[role="tab"]')` / `select.value =`。收到这里一份，
 *   下次再换控件只改一处（§4）。
 */
export const PROJECT_MODES = {
  终端: "computer",
  预览: "preview",
  代码: "source",
  版本: "history",
  数据: "data",
  交付: "delivery",
} as const;

function hostOf(container: ParentNode): HTMLElement {
  const host = container.querySelector<HTMLElement>(
    '[data-testid="project-mode-select"]'
  );
  if (!host) throw new Error("工程工作台视图切换控件不在");
  return host;
}

export function projectModeValue(container: ParentNode): string {
  return hostOf(container).getAttribute("data-mode") || "";
}

export function projectModeLabels(container: ParentNode): string[] {
  return [...hostOf(container).querySelectorAll("[data-mode-label]")].map(
    node => node.getAttribute("data-mode-label") || ""
  );
}

/**
 * 把工作台切到某个视图。**必须包在调用方自己的 `act()` 里**——
 * 这里不 import react，免得判据文件之间共享 React 实例出岔子。
 */
export function selectProjectMode(
  container: ParentNode,
  label: keyof typeof PROJECT_MODES
): void {
  const host = hostOf(container);
  host
    .querySelector<HTMLButtonElement>('[data-testid="project-mode-trigger"]')
    ?.click();
  const option = host.querySelector<HTMLElement>(
    `[data-mode-label="${label}"]`
  );
  if (!option) throw new Error(`工程工作台没有「${label}」这一档`);
  option.click();
}
