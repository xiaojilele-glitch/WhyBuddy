import React, { useEffect, useRef, useState } from "react";
import type { VerificationRecord } from "@shared/project-runtime.generated";
import {
  PNG_LIMIT,
  displayableScreenshots,
  verificationArtifactUrl,
} from "./verification-artifacts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
class EvidenceImageError extends Error {}

/** Evidence is fetched through the owner-checked endpoint, never an upstream URL. */
export function ProjectEvidenceImages({
  record,
  stale,
}: {
  record: VerificationRecord;
  stale: boolean;
}) {
  const scope = `${record.projectId}:${record.verificationId}:${record.revision}`;
  const [state, setState] = useState<{
    scope: string;
    url?: string;
    busy?: boolean;
    error?: string;
  }>({ scope });
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const dispose = () => {
    pending.current?.abort();
    pending.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => {
    generation.current++;
    setState({ scope });
    return () => {
      generation.current++;
      dispose();
    };
  }, [scope]);
  const show = async (artifactId: string) => {
    dispose();
    const current = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setState({ scope, busy: true });
    try {
      const response = await fetch(
        verificationArtifactUrl(record.verificationId, artifactId),
        {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        }
      );
      if (!response.ok)
        throw new EvidenceImageError("截图不存在或当前账号无权查看。");
      if (response.headers.get("content-type")?.split(";")[0] !== "image/png")
        throw new EvidenceImageError("截图格式不受支持。");
      const declared = Number(response.headers.get("content-length"));
      if (declared > PNG_LIMIT)
        throw new EvidenceImageError("截图超过可查看大小。");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.length > PNG_LIMIT ||
        !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
      )
        throw new EvidenceImageError("截图内容不完整或超过可查看大小。");
      if (controller.signal.aborted || current !== generation.current) return;
      objectUrl.current = URL.createObjectURL(
        new Blob([bytes], { type: "image/png" })
      );
      setState({ scope, url: objectUrl.current });
    } catch (error) {
      if (!controller.signal.aborted && current === generation.current)
        setState({
          scope,
          error:
            error instanceof EvidenceImageError
              ? error.message
              : "暂时无法读取截图。",
        });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  const artifacts = displayableScreenshots(record.artifactRefs);
  if (!artifacts.length) return null;
  const visible = state.scope === scope ? state : { scope };
  return (
    <div className="mt-2 text-xs" data-testid="project-evidence-images">
      <div className="flex flex-wrap gap-2">
        {artifacts.map((artifact, index) => (
          <button
            key={artifact.artifactId}
            type="button"
            className="rounded border border-stone-300 px-2 py-1"
            onClick={() => void show(artifact.artifactId)}
          >
            查看{stale ? "旧版本" : ""}截图 {index + 1}
          </button>
        ))}
      </div>
      {visible.busy ? <p role="status">正在读取截图…</p> : null}
      {visible.error ? <p role="alert">{visible.error}</p> : null}
      {visible.url ? (
        <div className="mt-2 rounded border border-stone-200 bg-white p-2">
          <div className="mb-2 flex justify-between gap-2">
            <p>
              {stale ? "这是旧版本的检查截图" : "本次浏览器检查截图"}
              ，仅作为已记录步骤的证据。
            </p>
            <button
              type="button"
              onClick={() => {
                dispose();
                setState({ scope });
              }}
            >
              关闭截图
            </button>
          </div>
          <img
            src={visible.url}
            alt={stale ? "旧版本浏览器检查截图" : "浏览器检查截图"}
            className="max-h-96 max-w-full object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
