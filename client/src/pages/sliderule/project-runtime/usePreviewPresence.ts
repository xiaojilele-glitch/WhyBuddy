import { useCallback, useEffect, useRef } from "react";
import { touchProjectOperation } from "./project-preview-client";
import {
  PREVIEW_PRESENCE_MS,
  shouldKeepPreviewAlive,
} from "./project-preview-presence";

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * 预览页签开着、票还在、标签看得见 → 立刻 /touch，之后按 PREVIEW_PRESENCE_MS 再报。
 * 切走、藏起、卸掉立刻停。报失败 fail-open，不许拖垮预览面（§7 增强类）。
 */
export function usePreviewPresence(input: {
  view: string;
  hasTicket: boolean;
  operationId?: string | null;
}) {
  const watching = shouldKeepPreviewAlive({
    ...input,
    visible: true,
  });
  const operationId = String(input.operationId || "").trim();
  const watchingRef = useRef(watching);
  watchingRef.current = watching;

  const report = useCallback(
    (signal: AbortSignal) => {
      if (!operationId || !watchingRef.current || !pageVisible()) return;
      void touchProjectOperation(operationId, signal).catch(() => {
        /* 报时失败不许把预览面打成错误态 */
      });
    },
    [operationId]
  );

  useEffect(() => {
    if (!operationId || !watching) return;
    const controllers: AbortController[] = [];
    const beat = () => {
      const controller = new AbortController();
      controllers.push(controller);
      report(controller.signal);
    };
    const onVisibility = () => {
      if (pageVisible()) beat();
    };
    if (pageVisible()) beat();
    const timer = setInterval(() => {
      if (pageVisible()) beat();
    }, PREVIEW_PRESENCE_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const controller of controllers) controller.abort();
    };
  }, [operationId, watching, report]);

  const nudge = useCallback(() => {
    if (!operationId || !watchingRef.current || !pageVisible()) return;
    report(new AbortController().signal);
  }, [operationId, report]);

  return { nudge };
}
