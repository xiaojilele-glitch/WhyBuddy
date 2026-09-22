import React, { useEffect, useRef, useState } from "react";
import type {
  ProjectRelease as Release,
  ProjectDeliveryStatus as Delivery,
} from "@shared/project-runtime.generated";
import {
  ProjectWorkspaceError,
  requestProjectWorkspace,
} from "./project-workspace-client";

const TEXT: Record<string, string> = {
  "Independent application administrator and reader login":
    "独立的应用管理员与只读用户登录",
  "Create, edit and filter tasks through a real API":
    "通过真实接口新增、编辑和筛选任务",
  "Persist application data across page refresh": "刷新页面后保留应用数据",
  "Reject writes by readers and unauthenticated users":
    "拒绝只读用户和未登录用户写入",
  "Build locked source and render without resource or page errors":
    "按锁文件构建源码，页面渲染没有资源或脚本错误",
  "Additional user requirements": "本验收范围之外的追加需求",
  "Production deployment": "生产环境部署",
  "Production account operations": "生产账号与运营工作",
};
const REASONS: Record<string, string> = {
  project_plan_approval_required: "当前计划尚未批准",
  project_acceptance_profile_not_bound: "工程尚未绑定这份任务应用验收范围",
  project_verification_required: "尚无独立浏览器检查记录",
  project_current_business_verification_required:
    "当前源码版本尚未通过任务业务检查",
  project_verification_evidence_incomplete: "构建或浏览器证据不完整",
};
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const errorMessage = (error: unknown) =>
  error instanceof ProjectWorkspaceError
    ? error.message
    : "暂时无法读取工程交付状态。";
const releasePath = (projectId: string, releaseId: string) =>
  `/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}/download`;
function validRelease(value: any, projectId: string): value is Release {
  return (
    value?.projectId === projectId &&
    value.deployed === false &&
    [
      value.releaseId,
      value.revision,
      value.treeHash,
      value.verificationId,
      value.planRef,
      value.lockfileHash,
      value.buildHash,
      value.createdAt,
    ].every(nonempty) &&
    value.profileId === "whybuddy-tasks-acceptance@1" &&
    value.downloadPath ===
      `/api/sliderule${releasePath(projectId, value.releaseId)}`
  );
}
function validDelivery(value: any, projectId: string): value is Delivery {
  return (
    value?.projectId === projectId &&
    nonempty(value.revision) &&
    typeof value.eligible === "boolean" &&
    (value.verificationId === null || nonempty(value.verificationId)) &&
    value.profile?.profileId === "whybuddy-tasks-acceptance@1" &&
    value.profile.suiteVersion === "react-vite-tasks@1" &&
    [
      value.profile.requirements,
      value.profile.outsideScope,
      value.blockedReasons,
    ].every(items => Array.isArray(items) && items.every(nonempty)) &&
    value.profile.requirements.length > 0 &&
    nonempty(value.profile.dataRecovery) &&
    Array.isArray(value.releases) &&
    value.releases.every(
      (release: unknown) =>
        validRelease(release, projectId) &&
        ["ready", "stale"].includes((release as Release).effectiveStatus!)
    ) &&
    value.deployment?.status === "not_configured" &&
    value.deployment.publicUrl === null &&
    (!value.eligible ||
      (value.blockedReasons.length === 0 && nonempty(value.verificationId)))
  );
}

export function ProjectDeliveryPanel({ projectId }: { projectId: string }) {
  return <DeliveryBody key={projectId} projectId={projectId} />;
}
function DeliveryBody({ projectId }: { projectId: string }) {
  const [view, setView] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  useEffect(() => () => write.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    read.current = controller;
    // A failed GET is a settled failure, not an indefinitely loading panel.
    // Refresh also invalidates earlier eligibility until the server replies.
    setLoading(true);
    setView(null);
    setError(null);
    void requestProjectWorkspace(
      `/projects/${encodeURIComponent(projectId)}/delivery`,
      controller.signal
    )
      .then(response => response.json())
      .then(body => {
        if (controller.signal.aborted) return;
        if (!validDelivery(body, projectId))
          throw new ProjectWorkspaceError(
            "交付记录与当前工程不一致或信息不完整。"
          );
        setView(body);
        setError(null);
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setView(null);
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refresh]);
  const prepare = async () => {
    if (loading || !view?.eligible || !view.verificationId || write.current)
      return;
    const identity = `${view.revision}:${view.verificationId}`;
    const key = keys.current.get(identity) ?? `release:${crypto.randomUUID()}`;
    keys.current.set(identity, key);
    const controller = new AbortController();
    write.current = controller;
    read.current?.abort();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestProjectWorkspace(
        `/projects/${encodeURIComponent(projectId)}/releases`,
        controller.signal,
        {
          expectedRevision: view.revision,
          verificationId: view.verificationId,
          idempotencyKey: key,
        }
      );
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (
        !validRelease(body?.release, projectId) ||
        body.release.revision !== view.revision ||
        body.release.verificationId !== view.verificationId
      )
        throw new ProjectWorkspaceError(
          "交付包版本与所选证据不一致，请更新状态后重试。"
        );
      keys.current.delete(identity);
      setNotice(
        "交付包已准备好，包含源码、构建与验收证据、运行部署说明。尚未部署到生产环境。"
      );
      setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (write.current === controller) write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const download = async (release: Release) => {
    if (write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await requestProjectWorkspace(
        releasePath(projectId, release.releaseId),
        controller.signal
      );
      if (
        response.headers.get("content-type")?.split(";")[0] !==
        "application/zip"
      )
        throw new ProjectWorkspaceError("交付包格式不完整，请稍后重试。");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `whybuddy-delivery-${release.revision.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (write.current === controller) write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      aria-label="工程交付"
      data-testid="project-delivery-panel"
      aria-busy={loading}
      className="min-h-0 flex-1 overflow-auto bg-stone-50 p-4 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">工程交付</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh(value => value + 1)}
          className="rounded border px-3 py-1.5 disabled:opacity-40"
        >
          更新交付状态
        </button>
        <button
          type="button"
          disabled={busy || loading || !view?.eligible}
          onClick={() => void prepare()}
          className="rounded bg-stone-800 px-3 py-1.5 text-white disabled:opacity-40"
        >
          准备交付包
        </button>
      </div>
      <p role="status" className="mt-2 leading-5">
        {loading
          ? "正在读取交付状态。"
          : view?.eligible
            ? "当前版本满足以下任务应用验收范围，可以准备交付包。"
            : view
              ? "当前版本还未满足交付条件。"
              : "交付状态暂不可用，请点击「更新交付状态」重试。"}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-amber-800">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-2 leading-5">{notice}</p> : null}
      <p className="mt-2 leading-5 text-stone-600">
        生产部署尚未配置。准备或下载交付包不会公开应用，也不表示已经上线。
      </p>
      {view ? (
        <>
          <div className="mt-3 rounded border bg-white p-3">
            <h4 className="font-semibold">本次验收范围</h4>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {view.profile.requirements.map(item => (
                <li key={item}>{TEXT[item] ?? item}</li>
              ))}
            </ul>
            <h4 className="mt-3 font-semibold">尚未包含</h4>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {view.profile.outsideScope.map(item => (
                <li key={item}>{TEXT[item] ?? item}</li>
              ))}
            </ul>
            <p className="mt-2 leading-5 text-stone-600">
              数据恢复以最近成功保存的检查点为准；正常停止时会保存停机后的检查点。追加需求需要补充验收用例。
            </p>
          </div>
          {view.blockedReasons.length ? (
            <ul className="mt-3 space-y-1 text-amber-800">
              {view.blockedReasons.map(reason => (
                <li key={reason}>
                  {REASONS[reason] ??
                    "仍有交付条件未满足，请更新运行与验收状态。"}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 space-y-2">
            {view.releases.map(release => (
              <div
                key={release.releaseId}
                className="rounded border bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 break-all">
                    {release.effectiveStatus === "stale"
                      ? "历史交付包（当前版本需重新验收）"
                      : "当前版本交付包"}{" "}
                    · {release.revision.slice(0, 12)}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void download(release)}
                    className="rounded border px-3 py-1.5 disabled:opacity-40"
                  >
                    下载交付包
                  </button>
                </div>
                <p className="mt-1 text-stone-500">
                  {release.createdAt} · 尚未部署
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
