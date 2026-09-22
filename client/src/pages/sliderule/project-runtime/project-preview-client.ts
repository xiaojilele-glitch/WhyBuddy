import type { PreviewDescriptor } from "@shared/project-runtime.generated";

export interface ProjectPreviewReference {
  projectId?: string | null;
  projectRevision?: string | null;
  /** Current sessions follow server authority; history remains explicitly pinned. */
  revisionMode?: "current" | "pinned";
}

export interface ProjectPreviewSnapshot {
  operationId: string | null;
  descriptor: PreviewDescriptor | null;
  available: boolean;
  reason: string | null;
}

export interface ProjectPreviewTicket {
  projectId: string;
  operationId: string;
  runtimeId: string;
  revision: string;
  entryUrl: string;
  ticketExpiresAt: string;
  accessExpiresAt: string;
}

const BASE = "/api/sliderule";

export class ProjectPreviewError extends Error {}

async function request(path: string, signal: AbortSignal, method = "GET") {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    // The provider's response body is not a user-facing error or a safe log.
    const message =
      response.status === 401
        ? "请登录后查看工程预览。"
        : response.status === 403 || response.status === 404
          ? "工程不存在或当前账号无权预览。"
          : response.status === 409 || response.status === 410
            ? "运行或预览授权已变化，请重新查看状态。"
            : response.status === 503
              ? "工程预览服务尚未启用或暂时不可用。"
              : "暂时无法读取工程预览，请稍后重试。";
    throw new ProjectPreviewError(message);
  }
  return response.json();
}

const statuses = new Set([
  "provisioning",
  "syncing",
  "installing",
  "executing",
  "starting",
  "ready",
  "stopping",
  "stopped",
  "expired",
  "failed",
  "reconciling",
]);

export async function getProjectPreview(
  projectId: string,
  signal: AbortSignal
): Promise<ProjectPreviewSnapshot> {
  const body = await request(
    `/projects/${encodeURIComponent(projectId)}/preview`,
    signal
  );
  const descriptor = body?.descriptor;
  if (
    typeof body?.available !== "boolean" ||
    !(body.operationId === null || typeof body.operationId === "string") ||
    !(
      descriptor === null ||
      (descriptor?.kind === "project" &&
        descriptor.projectId === projectId &&
        typeof descriptor.runtimeId === "string" &&
        typeof descriptor.revision === "string" &&
        statuses.has(descriptor.status) &&
        (descriptor.capabilities === undefined ||
          (Array.isArray(descriptor.capabilities) &&
            descriptor.capabilities.every(
              (capability: unknown) => typeof capability === "string"
            ))))
    )
  ) {
    throw new ProjectPreviewError("工程预览状态不完整，请重新查看状态。");
  }
  return {
    operationId: body.operationId,
    descriptor,
    available: body.available,
    reason: typeof body.reason === "string" ? body.reason : null,
  };
}

const START_REASONS: Record<string, string> = {
  project_preview_not_enabled: "工程预览尚未对本账号开放。",
  project_preview_not_configured:
    "工程预览尚未配置独立预览域名、网关密钥或其他必要参数。",
  project_preview_gateway_not_configured:
    "工程预览网关尚未配置，暂时不能提供私有预览。",
  project_worker_unavailable: "工程运行服务尚未就绪，暂时不能启动预览。",
  project_plan_approval_required: "当前计划尚未批准或批准已失效，不能启动预览。",
  project_runtime_unavailable: "工程运行服务暂时不可用，请稍后重试。",
};

function throwRuntimeCommandError(response: Response, payload: unknown): never {
  const detail =
    payload && typeof payload === "object"
      ? (payload as { detail?: unknown; reason?: unknown; message?: unknown })
      : null;
  const nested =
    detail?.detail && typeof detail.detail === "object"
      ? (detail.detail as { code?: unknown })
      : null;
  const code = [detail?.detail, nested?.code, detail?.reason, detail?.message].find(
    value => typeof value === "string" && Object.hasOwn(START_REASONS, value)
  );
  throw new ProjectPreviewError(
    typeof code === "string"
      ? START_REASONS[code]
      : response.status === 409
        ? "工程版本或批准已变化，请更新状态后重试。"
        : response.status === 401
          ? "请登录后查看工程预览。"
          : response.status === 403 || response.status === 404
            ? "工程不存在或当前账号无权预览。"
            : response.status === 503
              ? "工程预览服务尚未启用或暂时不可用。"
              : "暂时无法启动工程预览，请稍后重试。"
  );
}

/**
 * 人还在看预览时续命。服务端 `touch_operation` 只认这一声；
 * GET 状态 / 日志订阅故意不续（`test_activity_is_persisted_only_on_explicit_touch`）。
 *
 * ⚠ 2026-09-19 坦克大战 `sr-20260919072444-11CSR1RSM6`：前端从没打过
 *   这个口，`lastAccessAt` 全程空，5 分钟 `runtime_idle_expired`。
 */
export async function touchProjectOperation(
  operationId: string,
  signal: AbortSignal
): Promise<void> {
  const id = String(operationId || "").trim();
  if (!id) return;
  await request(
    `/project-operations/${encodeURIComponent(id)}/touch`,
    signal,
    "POST"
  );
}

export async function wakeProjectPreview(
  projectId: string,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(
    `${BASE}/projects/${encodeURIComponent(projectId)}/preview/wake`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal,
    }
  );
  if (response.ok || response.status === 202) return;
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* keep generic */
  }
  throwRuntimeCommandError(response, payload);
}

export async function requestProjectPreviewTicket(
  operationId: string,
  signal: AbortSignal
): Promise<ProjectPreviewTicket> {
  const body = await request(
    `/project-operations/${encodeURIComponent(operationId)}/preview-ticket`,
    signal,
    "POST"
  );
  if (
    body?.operationId !== operationId ||
    ![body?.projectId, body?.runtimeId, body?.revision].every(
      value => typeof value === "string" && value.length > 0
    )
  ) {
    throw new ProjectPreviewError(
      "预览授权与当前工程版本不一致，请更新状态后重试。"
    );
  }
  if (
    typeof body?.entryUrl !== "string" ||
    typeof body.ticketExpiresAt !== "string" ||
    typeof body.accessExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.ticketExpiresAt)) ||
    !Number.isFinite(Date.parse(body.accessExpiresAt)) ||
    Date.parse(body.ticketExpiresAt) <= Date.now() ||
    Date.parse(body.accessExpiresAt) < Date.parse(body.ticketExpiresAt)
  ) {
    throw new ProjectPreviewError("预览授权已过期，请重新打开预览。");
  }
  return {
    projectId: body.projectId,
    operationId: body.operationId,
    runtimeId: body.runtimeId,
    revision: body.revision,
    entryUrl: body.entryUrl,
    ticketExpiresAt: body.ticketExpiresAt,
    accessExpiresAt: body.accessExpiresAt,
  };
}

/** Generated code must never share the workbench's cookies or origin. */
export function isolatedPreviewUrl(
  value: string,
  workbenchUrl: string
): string {
  try {
    const url = new URL(value);
    const workbench = new URL(workbenchUrl);
    const loopback = (host: string) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
      host.endsWith(".localhost");
    const localPair = loopback(url.hostname) && loopback(workbench.hostname);
    const localHttp = url.protocol === "http:" && localPair;
    if (
      url.origin === workbench.origin ||
      (url.hostname === workbench.hostname && !localPair) ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !localHttp)
    )
      throw new Error();
    return url.href;
  } catch {
    throw new ProjectPreviewError("预览地址未满足独立来源要求，暂时无法打开。");
  }
}
