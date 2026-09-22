import type {
  ProjectOperationView,
  VerificationRecord,
  VerificationSnapshot,
  VerificationBuildEvidence,
} from "@shared/project-runtime.generated";

export interface ProjectVerificationView {
  operationId: string | null;
  operationStatus: string | null;
  snapshot: VerificationSnapshot | null;
}

export class ProjectVerificationError extends Error {}

const BASE = "/api/sliderule";
const recordStatuses = new Set([
  "running",
  "passed",
  "failed",
  "blocked",
  "cancelled",
]);
const effectiveStatuses = new Set([...recordStatuses, "stale"]);
// ⚠ 与 shared/project-runtime.generated.ts 的 VerificationAssertion 成对。
//   not_run 是 2026-09-17 那趟加的：收据必须报满名单，没跑到的显式记一笔，
//   否则"被超时切掉"和"这套判据本来就更短"在前端也是同一个样子。
const assertionStatuses = new Set(["passed", "failed", "not_run"]);
const operationStatuses = new Set([
  "queued",
  "running",
  "waiting_user",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
]);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const tasksAssertions = [
  "setup_admin",
  "writer_login",
  "task_create",
  "task_edit",
  "task_filter",
  "task_refresh",
  "reader_create",
  "reader_login",
  "reader_ui_readonly",
  "reader_api_forbidden",
  "anonymous_api_forbidden",
  "no_page_errors",
  "no_failed_requests",
];
const sha256 = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validBuild(
  build: any,
  record: any
): build is VerificationBuildEvidence {
  return (
    build?.kind === "production" &&
    build.revision === record.revision &&
    build.treeHash === record.treeHash &&
    sha256(build.treeHash) &&
    sha256(build.lockfileHash) &&
    ["passed", "failed", "blocked", "cancelled"].includes(build.status) &&
    ["static-dist", "tasks-node"].includes(build.serverKind) &&
    [build.startedAt, build.completedAt].every(nonempty) &&
    [build.installExitCode, build.buildExitCode].every(
      code =>
        code === null || (Number.isInteger(code) && code >= 0 && code <= 255)
    ) &&
    (build.outputHash === null || sha256(build.outputHash)) &&
    Number.isInteger(build.outputFileCount) &&
    build.outputFileCount >= 0 &&
    Number.isInteger(build.outputBytes) &&
    build.outputBytes >= 0 &&
    (build.status !== "passed" ||
      (build.installExitCode === 0 &&
        build.buildExitCode === 0 &&
        sha256(build.outputHash) &&
        build.outputFileCount > 0 &&
        build.outputBytes > 0))
  );
}

async function request(
  path: string,
  signal: AbortSignal,
  method = "GET",
  body?: object
): Promise<any> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    // A provider response can contain URLs, headers or generated page text.
    // HTTP status is sufficient to explain recovery without exposing that body.
    const message =
      response.status === 401
        ? "请登录后查看工程检查。"
        : response.status === 403 || response.status === 404
          ? "工程不存在或当前账号无权检查。"
          : response.status === 409 || response.status === 410
            ? "工程版本、计划或运行状态已变化，请更新状态后重试。"
            : response.status === 503
              ? "浏览器检查服务尚未启用或暂时不可用。"
              : "暂时无法连接工程检查服务，请稍后重试。";
    throw new ProjectVerificationError(message);
  }
  return response.json();
}

function validRecord(
  record: any,
  projectId: string
): record is VerificationRecord {
  return (
    record?.projectId === projectId &&
    [
      record.verificationId,
      record.operationId,
      record.runtimeOperationId,
      record.runtimeId,
      record.revision,
      record.treeHash,
      record.planRef,
      record.suiteVersion,
      record.createdAt,
      record.startedAt,
    ].every(nonempty) &&
    (record.specRevision === null || nonempty(record.specRevision)) &&
    (record.completedAt === null || nonempty(record.completedAt)) &&
    (record.errorCode === null || nonempty(record.errorCode)) &&
    recordStatuses.has(record.status) &&
    Array.isArray(record.assertions) &&
    record.assertions.every(
      (item: any) =>
        nonempty(item?.id) && assertionStatuses.has(item.status)
    ) &&
    Array.isArray(record.artifactRefs) &&
    (record.build === undefined ||
      record.build === null ||
      validBuild(record.build, record)) &&
    (record.suiteVersion !== "react-vite-tasks@1" ||
      record.status !== "passed" ||
      (validBuild(record.build, record) &&
        record.build.status === "passed" &&
        record.build.serverKind === "tasks-node" &&
        record.assertions.length === tasksAssertions.length &&
        tasksAssertions.every(id =>
          record.assertions.some(
            (item: any) => item.id === id && item.status === "passed"
          )
        )))
  );
}

export async function getProjectVerification(
  projectId: string,
  signal: AbortSignal
): Promise<ProjectVerificationView> {
  const body = await request(
    `/projects/${encodeURIComponent(projectId)}/verification`,
    signal
  );
  const snapshot = body?.snapshot;
  const valid =
    (body?.operationId === null || nonempty(body?.operationId)) &&
    (body?.operationStatus === null ||
      operationStatuses.has(body?.operationStatus)) &&
    (snapshot === null ||
      (typeof snapshot?.deliveryEligible === "boolean" &&
        (!snapshot.deliveryEligible ||
          (snapshot.effectiveStatus === "passed" &&
            snapshot.verification?.suiteVersion === "react-vite-tasks@1" &&
            snapshot.verification?.specRevision ===
              "whybuddy-tasks-acceptance@1")) &&
        effectiveStatuses.has(snapshot.effectiveStatus) &&
        validRecord(snapshot.verification, projectId) &&
        snapshot.verification.operationId === body.operationId &&
        (snapshot.effectiveStatus !== "passed" ||
          (snapshot.verification.status === "passed" &&
            (snapshot.verification.assertions?.length ?? 0) > 0 &&
            snapshot.verification.assertions?.every(
              (item: any) => item.status === "passed"
            )))));
  if (!valid)
    throw new ProjectVerificationError(
      "工程检查状态不完整，请更新状态后重试。"
    );
  return {
    operationId: body.operationId,
    operationStatus: body.operationStatus,
    snapshot,
  };
}

export async function requestProjectVerification(
  runtimeOperationId: string,
  expectedRevision: string,
  idempotencyKey: string,
  signal: AbortSignal
): Promise<{ operationId: string; status: ProjectOperationView["status"] }> {
  const body = await request(
    `/project-operations/${encodeURIComponent(runtimeOperationId)}/verify`,
    signal,
    "POST",
    { expectedRevision, idempotencyKey }
  );
  if (!nonempty(body?.operationId) || !operationStatuses.has(body?.status))
    throw new ProjectVerificationError(
      "检查请求状态不完整，请更新状态后重试。"
    );
  return { operationId: body.operationId, status: body.status };
}

export async function cancelProjectVerification(
  operationId: string,
  signal: AbortSignal
): Promise<void> {
  await request(
    `/project-operations/${encodeURIComponent(operationId)}/cancel`,
    signal,
    "POST"
  );
}
