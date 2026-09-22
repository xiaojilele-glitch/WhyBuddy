import { useEffect, useState } from "react";

const BASE = "/api/sliderule";

export type OfficeArtifactMeta = {
  artifactId: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  downloadable?: boolean;
};

export type OfficeSlideShape = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize?: number;
  color?: string;
  fill?: string;
};

export type OfficeSlide = {
  text: string;
  background?: string;
  shapes?: OfficeSlideShape[];
};

export type OfficeArtifactPreview =
  | {
      kind: "slides";
      slides: OfficeSlide[];
      slideWidth?: number;
      slideHeight?: number;
    }
  | { kind: "document"; text: string }
  | { kind: "workbook"; sheetCount: number }
  | { kind: "pdf" }
  | { kind: null };

export async function listOfficeArtifacts(
  projectId: string,
  signal?: AbortSignal
): Promise<OfficeArtifactMeta[]> {
  const response = await fetch(`${BASE}/projects/${projectId}/artifacts`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { files?: OfficeArtifactMeta[] };
  return Array.isArray(body.files) ? body.files : [];
}

/** 产物库有没有办公文件。读不到当没有（fail-closed）。 */
export function useOfficeArtifactPresent(
  projectId: string | null | undefined,
  refreshKey?: unknown
): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const id = String(projectId || "").trim();
    if (!id) {
      setPresent(false);
      return;
    }
    const ac = new AbortController();
    void listOfficeArtifacts(id, ac.signal)
      .then(items => {
        if (!ac.signal.aborted) setPresent(items.length > 0);
      })
      .catch(() => {
        if (!ac.signal.aborted) setPresent(false);
      });
    return () => ac.abort();
  }, [projectId, refreshKey]);
  return present;
}

export function officeArtifactDownloadUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}`;
}

export function officeArtifactPreviewUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}/preview`;
}

/** make_manus_page 点名之后，浏览器打开的那一份。列表本身不取这一页。 */
export function officeArtifactBrowserUrl(
  projectId: string,
  artifactId: string
): string {
  return `${officeArtifactPreviewUrl(projectId, artifactId)}?render=browser`;
}

export async function loadOfficeArtifactPreview(
  projectId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<OfficeArtifactPreview> {
  const response = await fetch(officeArtifactPreviewUrl(projectId, artifactId), {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return { kind: null };
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/pdf")) return { kind: "pdf" };
  const body = (await response.json()) as OfficeArtifactPreview;
  return body && typeof body === "object" ? body : { kind: null };
}
