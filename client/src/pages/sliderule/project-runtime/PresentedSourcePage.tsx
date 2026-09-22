import React, { useEffect, useState } from "react";

/**
 * 浏览器打开 Agent 点名的那一页源码。宿主不改写正文。
 *
 * ⚠ 2026-09-22 上一版按交付物类别把 pptx 画成幻灯片。没点名就没有这一页。
 */
export function PresentedSourcePage({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setHtml(null);
    setError(false);
    const query = new URLSearchParams({ path });
    void fetch(
      `/api/sliderule/projects/${encodeURIComponent(projectId)}/source/file?${query}`,
      { credentials: "include", cache: "no-store", signal: ac.signal }
    )
      .then(async response => {
        if (!response.ok) throw new Error("missing");
        const body = (await response.json()) as { path?: string; content?: unknown };
        if (body?.path !== path || typeof body.content !== "string") throw new Error("malformed");
        return body.content;
      })
      .then(content => {
        if (!ac.signal.aborted) setHtml(content);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, [projectId, path]);

  if (error) {
    return <p className="m-0 px-3 py-2 text-sm">这一页读不到。</p>;
  }
  if (html == null) {
    return <p className="m-0 px-3 py-2 text-sm opacity-70">正在打开页面…</p>;
  }
  return (
    <iframe
      title="预览页面"
      data-testid="agent-presented-page"
      sandbox="allow-scripts"
      srcDoc={html}
      className="h-full min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}
