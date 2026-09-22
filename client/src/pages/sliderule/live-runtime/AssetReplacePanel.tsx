/**
 * 画布「换图」面板（2026-08-25）。
 *
 * ## 为什么操作单位是"用途"而不是"这张图"
 *
 * 用户原话是「点一张图直接换掉所有引用它的页面」。动手前在生产库 24 个应用上
 * 量了一遍：被多处引用的图 18 组，其中 **10 组的 alt 互不相同**。最狠的一条是
 * `placehold.co/40x40/e2e8f0/cbd5e1` 在同一个应用里用了 5 处，alt 分别是
 * 蚂蚁集团 / 比亚迪 / 字节 / 腾讯 / 小红书的 logo——按 URL 一键全换 =
 * 五家公司挂同一个 logo，比留着灰块更糟。
 *
 * 所以：卡片仍按 URL（屏幕上它确实就是同一张灰图），**换图按 (URL, alt) 分组**。
 * alt 一致的多处会收成一组，点一次换掉全部——那正是用户要的"全换"，只是
 * 现在它是量出来安全的那部分，不是全部。
 *
 * ## 零 LLM
 *
 * 换图就是 `s/oldSrc/newSrc/`。走一轮精修要几分钟 + 真金白银的 token，还可能
 * 顺手把整页重写了。这里是纯字符串替换 + 既有的 PATCH 落库，秒级、确定、免费。
 *
 * ## 图从哪来
 *
 * 主路径是按 alt 搜 Openverse（免 key，仓里 stock_images 已经在用）。alt 本来
 * 就是画页时写好的英文检索词，正好拿来搜。次路径是粘地址——CC 图库里没有企业
 * logo 这类东西（真机实测 `Tencent tech company corporate badge` 命中 0）。
 */

import React from "react";
import {
  AlertTriangle,
  Check,
  ImageOff,
  Loader2,
  Search,
  X,
} from "lucide-react";

import type { AssetUseGroup, CanvasAsset } from "./canvas-board-graph";
import { assetUseGroups } from "./canvas-board-graph";
import {
  isRefineSafeImageUrl,
  searchStockImages,
  type StockCandidate,
} from "./stock-image-client";

export interface AssetReplacePanelProps {
  asset: CanvasAsset;
  nameOf: (pageId: string) => string;
  /** 落库并刷新画布。回 replaced 处数；抛错由面板显示。 */
  onReplace: (group: AssetUseGroup, nextUrl: string) => Promise<number>;
  onClose: () => void;
  /** 没落库成应用时不能换（推演没跑完/还没存），如实说清而不是给个点不动的按钮。 */
  disabledReason?: string | null;
}

export function AssetReplacePanel({
  asset,
  nameOf,
  onReplace,
  onClose,
  disabledReason,
}: AssetReplacePanelProps): React.ReactElement {
  const groups = React.useMemo(() => assetUseGroups(asset), [asset]);
  const [activeAlt, setActiveAlt] = React.useState<string>(
    groups[0]?.alt ?? ""
  );
  const group = groups.find(g => g.alt === activeAlt) ?? groups[0]!;

  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState<StockCandidate[] | null>(
    null
  );
  const [tried, setTried] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [busyUrl, setBusyUrl] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  /** 加载不出来的候选。挑一张看不见的图换进产品里比没有候选更糟。 */
  const [broken, setBroken] = React.useState<Set<string>>(new Set());

  // 换了一组之后候选要清掉——上一组的搜索结果留在屏幕上会让人以为是这一组的。
  React.useEffect(() => {
    setCandidates(null);
    setTried([]);
    setError(null);
    setDone(null);
    setBroken(new Set());
  }, [activeAlt]);

  const search = React.useCallback(async () => {
    if (!group?.alt) return;
    setLoading(true);
    setError(null);
    const res = await searchStockImages(group.alt, asset.url);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setCandidates([]);
      return;
    }
    setCandidates(res.data.candidates);
    setTried(res.data.tried);
  }, [group?.alt, asset.url]);

  const apply = React.useCallback(
    async (url: string) => {
      if (!group || disabledReason) return;
      setBusyUrl(url);
      setError(null);
      try {
        const n = await onReplace(group, url);
        setDone(`已换掉 ${n} 处`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "换图失败");
      } finally {
        setBusyUrl(null);
      }
    },
    [group, onReplace, disabledReason]
  );

  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white"
      data-testid="sliderule-asset-replace"
      data-asset-url={asset.url}
      data-use-groups={groups.length}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[#f0f1f3] px-3 py-2">
        <span className="truncate text-[12px] font-medium text-stone-700">
          换图
        </span>
        {asset.placeholder ? (
          <span className="rounded bg-amber-50 px-1 py-px text-[10px] text-amber-600">
            占位图
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-0.5 text-stone-400 transition hover:bg-stone-100"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        {disabledReason ? (
          <p
            className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-700"
            data-testid="sliderule-asset-replace-disabled"
          >
            {disabledReason}
          </p>
        ) : null}

        {/* 用途分组。只有一组时不摆选择器，省得像个假控件。 */}
        {groups.length > 1 ? (
          <div>
            <p className="mb-1 text-[11px] text-stone-500">
              这张图在 {groups.length} 个地方是
              <span className="text-stone-700">不同的东西</span>，分开换：
            </p>
            <ul className="space-y-1" data-testid="sliderule-asset-use-groups">
              {groups.map(g => (
                <li key={g.alt}>
                  <button
                    type="button"
                    onClick={() => setActiveAlt(g.alt)}
                    data-active={g.alt === activeAlt ? "1" : "0"}
                    className={`w-full truncate rounded border px-2 py-1 text-left text-[11px] transition ${
                      g.alt === activeAlt
                        ? "border-[#1677ff] bg-[#f0f6ff] text-[#1677ff]"
                        : "border-stone-200 text-stone-600 hover:border-stone-300"
                    }`}
                    title={g.alt || "（没有 alt）"}
                  >
                    {g.alt || "（没有 alt）"}
                    <span className="ml-1 text-stone-400">×{g.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {group ? (
          <p className="text-[11px] leading-4 text-stone-500">
            换掉后会改{" "}
            <span className="text-stone-700">
              {group.pageIds.map(nameOf).join("、")}
            </span>{" "}
            共 {group.count} 处。
          </p>
        ) : null}

        <button
          type="button"
          onClick={search}
          disabled={loading || !group?.alt}
          data-testid="sliderule-asset-search"
          className="flex w-full items-center justify-center gap-1.5 rounded border border-stone-200 px-2 py-1.5 text-[11px] text-stone-600 transition hover:border-[#1677ff] hover:text-[#1677ff] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
          {group?.alt ? `按「${group.alt}」搜真图` : "这张图没有 alt，没法搜"}
        </button>

        {error ? (
          <p
            className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-4 text-rose-600"
            data-testid="sliderule-asset-replace-error"
          >
            {error}
          </p>
        ) : null}

        {/* ⚠ 搜不到必须**如实说搜不到**，还要把试过的词摆出来——只显示"没有"
            的话，用户分不清是搜过了还是这个按钮坏了。 */}
        {candidates && candidates.length === 0 && !error ? (
          <div
            className="rounded border border-stone-200 bg-stone-50 px-2 py-1.5 text-[11px] leading-4 text-stone-500"
            data-testid="sliderule-asset-search-empty"
          >
            <div className="flex items-center gap-1 text-stone-600">
              <ImageOff className="h-3 w-3" />
              没搜到能用的图
            </div>
            {tried.length ? (
              <p className="mt-1 text-[10px] text-stone-400">
                试过：{tried.join(" / ")}
              </p>
            ) : null}
            <p className="mt-1 text-[10px]">
              图库里是 CC 授权的照片，企业
              logo、证件这类本来就没有——直接粘地址吧。
            </p>
          </div>
        ) : null}

        {candidates && candidates.length > 0 ? (
          <ul
            className="grid grid-cols-2 gap-1.5"
            data-testid="sliderule-asset-candidates"
          >
            {candidates.map(c => (
              <li key={c.url}>
                <button
                  type="button"
                  onClick={() => apply(c.url)}
                  disabled={!!busyUrl || !!disabledReason}
                  className="group relative block w-full overflow-hidden rounded border border-stone-200 transition hover:border-[#1677ff] disabled:opacity-60"
                  title={`${c.label}（${c.license}）`}
                >
                  {broken.has(c.url) ? (
                    /* ⚠ 加载不出来要**说出来**。摆个灰方块等于让用户挑一张
                       他根本看不见的图换进产品里——比没有候选更糟。 */
                    <span className="flex h-16 w-full items-center justify-center gap-1 bg-stone-50 text-[9px] text-stone-400">
                      <ImageOff className="h-3 w-3" />
                      加载不出来
                    </span>
                  ) : (
                    <img
                      src={c.url}
                      alt={c.label}
                      /* ⚠ 跟素材卡、html-app-surface 里那两处保持一致：
                         图床对带 referer 的请求有过防盗链行为。同一件事
                         三处实现，漏一处就是这一处的图**静静地不显示**。 */
                      referrerPolicy="no-referrer"
                      /* 不用 loading="lazy"：候选最多 6 张、全部在视口里，
                         lazy 只会换来一排空白格。 */
                      className="h-16 w-full bg-stone-50 object-cover"
                      onError={() =>
                        setBroken(prev => new Set(prev).add(c.url))
                      }
                    />
                  )}
                  <span className="block truncate px-1 py-0.5 text-left text-[9px] text-stone-500">
                    {busyUrl === c.url ? "换入中…" : c.license || "cc"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* 粘地址：CC 图库没有的东西（logo、证件、自家产品图）只能走这条 */}
        <div className="border-t border-[#f0f1f3] pt-2.5">
          <p className="mb-1 text-[11px] text-stone-500">或直接粘图片地址</p>
          <input
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="https://..."
            data-testid="sliderule-asset-paste"
            className="w-full rounded border border-stone-200 px-2 py-1 font-mono text-[10px] outline-none focus:border-[#1677ff]"
          />
          {pasted.trim() && !isRefineSafeImageUrl(pasted) ? (
            <p
              className="mt-1 flex gap-1 rounded bg-amber-50 px-1.5 py-1 text-[10px] leading-4 text-amber-700"
              data-testid="sliderule-asset-host-warning"
            >
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                这个域名不在画页的外链白名单里。图能换进去也能显示，但{" "}
                <span className="font-medium">
                  下一轮精修这一页会被判「未授权的外部链接」
                </span>
                。换成图床地址更稳。
              </span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => apply(pasted.trim())}
            disabled={!pasted.trim() || !!busyUrl || !!disabledReason}
            data-testid="sliderule-asset-paste-apply"
            className="mt-1.5 w-full rounded bg-[#1677ff] px-2 py-1 text-[11px] text-white transition hover:bg-[#0958d9] disabled:opacity-40"
          >
            换成这个地址
          </button>
        </div>

        {done ? (
          <p
            className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700"
            data-testid="sliderule-asset-replace-done"
          >
            <Check className="h-3 w-3" />
            {done}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
