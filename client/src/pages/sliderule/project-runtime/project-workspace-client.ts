import type {
  ProjectOperationView,
  ProjectSourceIndex,
  ProjectSourceFile,
  ProjectSourceCommand,
  ProjectRevisionPage,
  ProjectForkResult,
} from "@shared/project-runtime.generated";
import { validSourcePath } from "./preview-selection-bridge";

export type SourceIndex = ProjectSourceIndex;
export type SourceFile = ProjectSourceFile;
export type RevisionPage = ProjectRevisionPage;
export type SourceCommand = ProjectSourceCommand;
export class ProjectWorkspaceError extends Error {
  constructor(
    message: string,
    readonly conflict = false,
    readonly code?: string
  ) {
    super(message);
  }
}
const BASE = "/api/sliderule";
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const statuses = new Set([
  "queued",
  "running",
  "waiting_user",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
]);
const malformed = () =>
  new ProjectWorkspaceError("工程数据不完整，请更新后重试。");
const WORKSPACE_REASONS: Record<string, string> = {
  project_live_patch_requires_restart:
    "这次修改包含运行配置或依赖，请先停止应用，再保存或恢复。草稿已保留。",
  project_plan_approval_required:
    "当前计划尚未批准或批准已失效。请先批准当前计划后重试，草稿已保留。",
  project_rollout_disabled:
    "工程模式当前已关闭，暂时不能执行这项操作。草稿已保留。",
};

export async function requestProjectWorkspace(
  path: string,
  signal: AbortSignal,
  body?: object
) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    // Only known machine codes are interpreted; provider detail is never shown.
    let code: string | undefined;
    try {
      const payload = await response.json();
      const detail = payload?.detail;
      // 2026-09-13 real browser: the owner could read/download the project,
      // but a save without approval was described as missing ownership. The
      // live error envelope uses message; direct Python replies use detail.
      // Accept only our known codes from either shape, never provider prose.
      if (response.status !== 401 && response.status !== 404) {
        code = [detail, detail?.code, payload?.reason, payload?.message].find(
          value =>
            typeof value === "string" && Object.hasOwn(WORKSPACE_REASONS, value)
        );
      }
    } catch {}
    throw new ProjectWorkspaceError(
      code
        ? WORKSPACE_REASONS[code]
        : response.status === 409
          ? "工程版本或批准已变化。草稿已保留，请读取最新版并核对差异。"
          : response.status === 401
            ? "请登录后操作工程。"
            : response.status === 403 || response.status === 404
              ? "工程不存在或当前账号无权操作。"
              : response.status === 503
                ? "工程服务尚未启用或暂时不可用。"
                : "工程操作未能完成，请更新状态后重试。",
      response.status === 409,
      code
    );
  }
  return response;
}
const request = requestProjectWorkspace;
function projectPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export async function getProjectSource(
  projectId: string,
  revision: string | undefined,
  signal: AbortSignal
): Promise<SourceIndex> {
  const body = await (
    await request(
      `${projectPath(projectId)}/source${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
      signal
    )
  ).json();
  if (
    body?.projectId !== projectId ||
    !text(body.revision) ||
    (revision && body.revision !== revision) ||
    !text(body.currentRevision) ||
    !Array.isArray(body.files) ||
    !body.files.every(
      (file: any) =>
        validSourcePath(file?.path) &&
        text(file.sha256) &&
        Number.isInteger(file.sizeBytes) &&
        file.sizeBytes >= 0
    )
  )
    throw malformed();
  return body;
}
export async function getProjectSourceFile(
  projectId: string,
  revision: string,
  path: string,
  signal: AbortSignal
): Promise<SourceFile> {
  const query = new URLSearchParams({ revision, path });
  const body = await (
    await request(`${projectPath(projectId)}/source/file?${query}`, signal)
  ).json();
  if (
    body?.projectId !== projectId ||
    body.revision !== revision ||
    body.path !== path ||
    !text(body.sha256) ||
    typeof body.content !== "string"
  )
    throw malformed();
  return body;
}
export async function getProjectRevisions(
  projectId: string,
  cursor: string | null,
  signal: AbortSignal
): Promise<RevisionPage> {
  const query = new URLSearchParams({
    limit: "50",
    ...(cursor ? { cursor } : {}),
  });
  const body = await (
    await request(`${projectPath(projectId)}/revisions?${query}`, signal)
  ).json();
  if (
    body?.projectId !== projectId ||
    !text(body.currentRevision) ||
    !(body.nextCursor === null || text(body.nextCursor)) ||
    !Array.isArray(body.revisions) ||
    !body.revisions.every((row: any) =>
      [
        row?.revision,
        row?.treeHash,
        row?.templateVersion,
        row?.createdAt,
      ].every(text)
    )
  )
    throw malformed();
  return body;
}
async function sourceCommand(
  projectId: string,
  action: string,
  body: object,
  signal: AbortSignal
): Promise<SourceCommand> {
  const result = await (
    await request(`${projectPath(projectId)}/${action}`, signal, body)
  ).json();
  if (
    result?.projectId !== projectId ||
    !(result.revision === null || text(result.revision)) ||
    !(result.operationId === null || text(result.operationId)) ||
    !statuses.has(result.status)
  )
    throw malformed();
  return result;
}
export function patchProjectSource(
  projectId: string,
  expectedRevision: string,
  idempotencyKey: string,
  file: SourceFile,
  content: string,
  signal: AbortSignal
) {
  return sourceCommand(
    projectId,
    "source/patch",
    {
      expectedRevision,
      idempotencyKey,
      changes: [{ path: file.path, content, expectedSha256: file.sha256 }],
    },
    signal
  );
}
export function restoreProjectRevision(
  projectId: string,
  expectedRevision: string,
  targetRevision: string,
  idempotencyKey: string,
  signal: AbortSignal
) {
  return sourceCommand(
    projectId,
    "restore",
    { expectedRevision, targetRevision, idempotencyKey },
    signal
  );
}
export async function forkProjectRevision(
  projectId: string,
  revision: string,
  idempotencyKey: string,
  signal: AbortSignal
): Promise<ProjectForkResult> {
  const result = await (
    await request(`${projectPath(projectId)}/fork`, signal, {
      revision,
      idempotencyKey,
    })
  ).json();
  if (
    ![result?.projectId, result?.sessionId, result?.revision].every(text) ||
    result.projectId === projectId
  )
    throw malformed();
  return result;
}
export async function exportProjectRevision(
  projectId: string,
  revision: string,
  signal: AbortSignal
): Promise<Blob> {
  const response = await request(
    `${projectPath(projectId)}/export?revision=${encodeURIComponent(revision)}`,
    signal
  );
  if (response.headers.get("content-type")?.split(";")[0] !== "application/zip")
    throw malformed();
  return response.blob();
}
export async function getSourceOperation(
  operationId: string,
  signal: AbortSignal
): Promise<ProjectOperationView> {
  const result = await (
    await request(
      `/project-operations/${encodeURIComponent(operationId)}`,
      signal
    )
  ).json();
  if (
    result?.operation?.operationId !== operationId ||
    !text(result.operation.projectId) ||
    !statuses.has(result.operation.status)
  )
    throw malformed();
  return result.operation;
}
