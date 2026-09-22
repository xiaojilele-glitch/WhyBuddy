/**
 * 画布「换图」的取图口（2026-08-25）。
 *
 * 只有一条接口：`POST /api/sliderule/stock-images/search`，按 alt 找可换的真图。
 *
 * ⚠ 为什么必须走后端、不能在浏览器里直接 fetch Unsplash：
 *   页面的 CSP 是 `connect-src 'self' blob: <几家 LLM 网关> data:`——
 *   api.unsplash.com 不在里面，浏览器直连会被 CSP 拦下。这是"生成侧/消费侧"
 *   那条纪律的又一个形状：服务端能搜到 ≠ 浏览器能搜到。
 *
 * ⚠ 写回**不在这个文件里**。选中候选之后走的是既有的
 *   `updateAppPage`（PATCH /apps/{id}/pages/{pageId}，点选编辑器同一条），
 *   不另造一条写路径。
 */

const BASE = "/api/sliderule";

export interface StockCandidate {
  url: string;
  label: string;
  license: string;
  source: string;
  query: string;
}

export interface StockSearchResult {
  query: string;
  candidates: StockCandidate[];
  /** 逐级退让实际试过的词。搜不到时要显示它——否则用户只看到"没有"，
   *  不知道是搜过了还是根本没搜。 */
  tried: string[];
}

export async function searchStockImages(
  alt: string,
  src: string
): Promise<
  { ok: true; data: StockSearchResult } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${BASE}/stock-images/search`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ alt, src }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const msg =
        (typeof body?.detail === "string" && body.detail) ||
        (typeof body?.message === "string" && body.message) ||
        `搜图失败（HTTP ${res.status}）`;
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      data: {
        query: typeof body.query === "string" ? body.query : "",
        candidates: Array.isArray(body.candidates)
          ? (body.candidates as StockCandidate[])
          : [],
        tried: Array.isArray(body.tried) ? (body.tried as string[]) : [],
      },
    };
  } catch {
    return { ok: false, error: "网络请求失败，请检查连接后重试" };
  }
}

/**
 * 换进页面的图**必须**落在这几家主机上，否则下一轮精修会被
 * `spec_page_html.scan_foreign_references` 判成"未授权的外部链接"整页失败。
 *
 * ⚠ 这份名单是 python 侧 `_ALLOWED_HOSTS` 的**副本**，就是本仓第四条纪律
 *   （同一件事两处实现）的原型现场。所以这里只拿它做**提示**、不做拦截：
 *   用户坚持粘别的地址照样能换，只是会看到一行黄字说清后果。
 *   真正的判定权仍在 python 那一侧，前端不复制判定、只复制提醒。
 */
export const REFINE_SAFE_IMAGE_HOSTS = [
  "images.unsplash.com",
  "images.pexels.com",
  "upload.wikimedia.org",
  "staticflickr.com",
  "rawpixel.com",
  "placehold.co",
];

/** 这个地址换进去以后，下一轮精修会不会被外链闸拦？ */
export function isRefineSafeImageUrl(url: string): boolean {
  const s = String(url || "").trim();
  if (!s) return false;
  if (s.startsWith("data:")) return true;
  if (!/^https?:\/\//i.test(s)) return true; // 站内相对路径，闸不扫
  const host = (s.match(/^https?:\/\/([^/?#]+)/i)?.[1] || "")
    .toLowerCase()
    .replace(/^www\./, "");
  return REFINE_SAFE_IMAGE_HOSTS.some(
    h => host === h || host.endsWith(`.${h}`)
  );
}
