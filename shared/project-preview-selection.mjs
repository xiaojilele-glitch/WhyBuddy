/**
 * Self-contained preview-side installer. The preview gateway injects trusted identity
 * and the exact workbench origin. Generated content can suggest source locations
 * only; the workbench validates them against authorized immutable source files.
 */
export function installPreviewSelectionBridge(config) {
  if (
    window.parent === window ||
    !config ||
    !/^https?:\/\//.test(config.workbenchOrigin)
  )
    return () => {};
  let channelId = null;
  let enabled = false;
  const send = (type, extra = {}) =>
    window.parent.postMessage(
      {
        type,
        schemaVersion: 1,
        projectId: config.projectId,
        runtimeId: config.runtimeId,
        revision: config.revision,
        channelId,
        ...extra,
      },
      config.workbenchOrigin
    );
  const receive = event => {
    if (
      event.source !== window.parent ||
      event.origin !== config.workbenchOrigin
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.type !== "whybuddy:select:init" ||
      data.schemaVersion !== 1 ||
      data.projectId !== config.projectId ||
      data.runtimeId !== config.runtimeId ||
      data.revision !== config.revision ||
      typeof data.channelId !== "string" ||
      data.channelId.length > 100 ||
      typeof data.enabled !== "boolean"
    )
      return;
    channelId = data.channelId;
    enabled = data.enabled;
    send("whybuddy:select:ready");
  };
  const select = event => {
    if (!enabled || !channelId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-whybuddy-source]")
        : null;
    send("whybuddy:select:element", {
      location: target
        ? {
            path: target.getAttribute("data-whybuddy-source"),
            line: Number(target.getAttribute("data-whybuddy-line")),
            column: Number(target.getAttribute("data-whybuddy-column") || 1),
          }
        : null,
    });
  };
  window.addEventListener("message", receive);
  document.addEventListener("click", select, true);
  return () => {
    window.removeEventListener("message", receive);
    document.removeEventListener("click", select, true);
  };
}
