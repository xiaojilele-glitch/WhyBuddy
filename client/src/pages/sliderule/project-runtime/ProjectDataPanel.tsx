import React, { useEffect, useRef, useState } from "react";
import type {
  ProjectDataBackup as Backup,
  ProjectDataSnapshot as Snapshot,
} from "@shared/project-runtime.generated";
import {
  ProjectWorkspaceError,
  requestProjectWorkspace,
} from "./project-workspace-client";

const message = (error: unknown) =>
  error instanceof ProjectWorkspaceError
    ? error.message
    : "暂时无法读取工程数据备份。";
const validBackup = (backup: any, projectId: string): backup is Backup =>
  backup?.projectId === projectId &&
  typeof backup.backupId === "string" &&
  backup.backupId.length > 0 &&
  Number.isInteger(backup.version) &&
  backup.version > 0 &&
  typeof backup.sha256 === "string" &&
  typeof backup.sourceRevision === "string" &&
  typeof backup.createdAt === "string" &&
  Number.isInteger(backup.sizeBytes) &&
  backup.sizeBytes > 0 &&
  backup.dataSchemaVersion === 1;

export function ProjectDataPanel({
  projectId,
  runtimeStopped,
}: {
  projectId: string;
  runtimeStopped: boolean;
}) {
  return (
    <DataBody
      key={projectId}
      projectId={projectId}
      runtimeStopped={runtimeStopped}
    />
  );
}
function DataBody({
  projectId,
  runtimeStopped,
}: {
  projectId: string;
  runtimeStopped: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const write = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  useEffect(() => () => write.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(null);
    void requestProjectWorkspace(
      `/projects/${encodeURIComponent(projectId)}/data`,
      controller.signal
    )
      .then(response => response.json())
      .then(body => {
        if (controller.signal.aborted) return;
        if (
          !(body?.backup === null || validBackup(body?.backup, projectId)) ||
          !Array.isArray(body.backups) ||
          !body.backups.every((backup: unknown) =>
            validBackup(backup, projectId)
          ) ||
          body.recoveryPolicy !== "last-checkpoint" ||
          !Number.isInteger(body.checkpointIntervalSeconds) ||
          body.checkpointIntervalSeconds < 1
        )
          throw new ProjectWorkspaceError("数据备份记录不完整，请更新后重试。");
        setSnapshot(body);
        setError(null);
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setError(message(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refresh]);
  const restore = async () => {
    if (!selected || !snapshot?.backup || !runtimeStopped || write.current)
      return;
    const controller = new AbortController();
    write.current = controller;
    read.current?.abort();
    setLoading(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestProjectWorkspace(
        `/projects/${encodeURIComponent(projectId)}/data/restore`,
        controller.signal,
        { backupId: selected, expectedVersion: snapshot.backup.version }
      );
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (
        !validBackup(body?.backup, projectId) ||
        body.backup.version <= snapshot.backup.version
      )
        throw new ProjectWorkspaceError(
          "数据恢复结果不完整，请重新读取备份状态。"
        );
      setSelected(null);
      setNotice(
        "数据已恢复为新的备份版本。工程源码保持当前版本，下次启动应用时载入恢复后的数据。"
      );
      setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof ProjectWorkspaceError && reason.conflict
            ? "数据版本或运行状态已变化，请停止应用并更新备份列表后重试。"
            : message(reason)
        );
    } finally {
      if (write.current === controller) write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      data-testid="project-data-panel"
      aria-label="应用数据备份"
      aria-busy={loading}
      className="min-h-0 flex-1 overflow-auto bg-stone-50 p-4 text-xs"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">应用数据备份</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh(value => value + 1)}
          className="rounded border px-3 py-1.5"
        >
          更新备份列表
        </button>
      </div>
      <p className="mt-2 leading-5 text-stone-600">
        业务数据与源码版本分别保存。
        {snapshot
          ? `运行中约每 ${snapshot.checkpointIntervalSeconds} 秒生成检查点；`
          : ""}
        恢复以最近成功保存的检查点为准，检查点之后的修改可能尚未保存。
      </p>
      {!runtimeStopped ? (
        <p className="mt-2 leading-5 text-amber-800">
          恢复数据前请先停止应用，等待服务端确认停止。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-amber-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 leading-5 text-stone-600">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="mt-3 leading-5 text-stone-600">
          正在读取数据备份…
        </p>
      ) : null}
      {!loading && !error && snapshot && !snapshot.backup ? (
        <p className="mt-3">
          尚无已保存的数据备份。源码导出和复刻不会代替数据备份。
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {snapshot?.backups.map(backup => (
          <div
            key={backup.backupId}
            className="rounded border border-stone-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1">
                数据版本 {backup.version}
                {backup.backupId === snapshot.backup?.backupId
                  ? " · 当前备份"
                  : ""}
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  !runtimeStopped ||
                  backup.backupId === snapshot.backup?.backupId
                }
                onClick={() => setSelected(backup.backupId)}
                className="rounded border px-3 py-1.5 disabled:opacity-40"
              >
                恢复这份数据
              </button>
            </div>
            <p className="mt-1 break-all text-stone-500">
              {backup.createdAt} · {(backup.sizeBytes / 1024).toFixed(1)} KB ·
              来源源码 {backup.sourceRevision.slice(0, 12)}
            </p>
            {selected === backup.backupId ? (
              <div className="mt-2">
                <p className="mb-2 leading-5">
                  恢复将用这份检查点中的用户、任务和应用会话替换下次启动的数据；保留当前备份历史，源码不回退。
                </p>
                <button
                  type="button"
                  disabled={busy || !runtimeStopped}
                  onClick={() => void restore()}
                  className="mr-2 rounded border px-3 py-1.5 disabled:opacity-40"
                >
                  确认恢复数据
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  取消
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
