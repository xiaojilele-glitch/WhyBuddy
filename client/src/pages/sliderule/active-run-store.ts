/**
 * E25 推演断线重生——活跃 run 的本地书签。
 *
 * 发起推演时把 {runId, userText} 记在 localStorage（按会话分键）；
 * 刷新/跳页回来后据此询问服务端「run 还活着吗」，活着就续播接回。
 * 轮次落定 / 出错 / 取消 / 服务端说没有 → 清书签。
 */

export interface ActiveRunRecord {
  runId: string;
  kind?: "control";
  userText: string;
  startedAt: string;
}

export function activeRunKey(sessionId: string): string {
  return `sliderule:active-run:${sessionId}`;
}

export function saveActiveRun(
  sessionId: string,
  record: ActiveRunRecord
): void {
  try {
    localStorage.setItem(activeRunKey(sessionId), JSON.stringify(record));
  } catch {
    // 隐私模式等存储不可用：续播降级为不可用，推演本身不受影响
  }
}

export function loadActiveRun(sessionId: string): ActiveRunRecord | null {
  try {
    const raw = localStorage.getItem(activeRunKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRunRecord>;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.runId) {
      return null;
    }
    return {
      runId: parsed.runId,
      ...(parsed.kind === "control" ? { kind: "control" as const } : {}),
      userText: typeof parsed.userText === "string" ? parsed.userText : "",
      startedAt:
        typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

export function clearActiveRun(sessionId: string): void {
  try {
    localStorage.removeItem(activeRunKey(sessionId));
  } catch {
    // ignore
  }
}
