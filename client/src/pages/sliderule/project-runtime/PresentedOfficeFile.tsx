import React, { useEffect, useState } from "react";
import {
  listOfficeArtifacts,
  officeArtifactBrowserUrl,
} from "./office-artifacts-client";

/**
 * 浏览器打开 Agent 点名的那份办公文件。没点名的文件不在这里出现。
 */
export function PresentedOfficeFile({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setSrc(null);
    setMissing(false);
    void listOfficeArtifacts(projectId, ac.signal)
      .then(items => {
        if (ac.signal.aborted) return;
        const match = items.find(item => item.path === path);
        if (!match) {
          setMissing(true);
          return;
        }
        setSrc(officeArtifactBrowserUrl(projectId, match.artifactId));
      })
      .catch(() => {
        if (!ac.signal.aborted) setMissing(true);
      });
    return () => ac.abort();
  }, [projectId, path]);

  if (missing) {
    return <p className="m-0 px-3 py-6 text-sm">点名的文件读不到。</p>;
  }
  if (!src) {
    return <p className="m-0 px-3 py-6 text-sm opacity-70">正在打开点名的文件…</p>;
  }
  return (
    <iframe
      title="文件预览"
      data-testid="presented-office-file"
      sandbox="allow-scripts"
      src={src}
      className="h-full min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}
