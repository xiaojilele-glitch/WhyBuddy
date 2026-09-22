/**
 * 刀 3 的面板：选中一块之后，右侧变成「这一块」（2026-08-27）。
 *
 * 三段，从上到下：
 *   1. 这是哪一块（类型·名字、在这页排第几、真渲染还是降级了）
 *   2. 它绑了什么、改了它谁跟着变（刀 4 的反查，**真联动和仅同源分开列**）
 *   3. 「重写这一块」——只把这一块交给模型
 *
 * ## ⚠ 改完先预览，**不直接落库**
 *
 * 后端 `ai-edit-block` 本身没有副作用（同 ai-edit-element 那条边界）。
 * 这里拿到新页面之后只 `onPreview` 进画布，用户看过了再点「保存这一页」。
 * 没有这条边界的话，AI 改块就绕开了"未保存可以放弃"这条纪律——而这一步
 * 恰恰是最需要能反悔的（模型可能把一整块重写成另一个样子）。
 *
 * ## ⚠ 影响面这一段：孤岛块要说「无影响」，不是空着
 *
 * 真机基线 15 块里有 7 块挂不上任何绑定（纯视觉块）。它们没有线是**事实**，
 * 不是没算——面板上空着一片会让人以为算漏了（风险台账 #05）。
 */

import * as React from "react";
import { Loader2, Sparkles, X } from "lucide-react";

import { impactedBy, type ImpactEdge } from "./block-impact";
import { blockKey } from "./block-rects";

export interface CanvasBlockPanelProps {
  pageId: string;
  pageName: string;
  blockName: string;
  kindLabel: string;
  /** 在这一页里排第几（1 起）。数不出来传 null。 */
  indexInPage: number | null;
  /** 这一块现在是真渲染还是被阶梯降级了。 */
  live: boolean;
  /** 这一块用到的东西（刀 4 扫出来的）。 */
  bindings: {
    fields: readonly string[];
    actions: readonly string[];
    navTargets: readonly string[];
    assets: readonly string[];
  } | null;
  /** 全部影响线，面板自己按 blockKey 反查。 */
  impactEdges: readonly ImpactEdge[];
  /** 块 key → 给人看的名字。 */
  labelOfKey: (key: string) => string;
  /** 有没有 appId。没有就改不了，如实说原因而不是把按钮藏起来。 */
  canEdit: boolean;
  /** 调后端改这一块，回新的整页 HTML。 */
  onRewrite: (instruction: string) => Promise<string>;
  /** 把改完的整页放进画布预览（**不落库**）。 */
  onPreview: (html: string) => void;
  /** 用户点「保存这一页」。 */
  onSave: (html: string) => Promise<void>;
  onClose: () => void;
}

export function CanvasBlockPanel({
  pageId,
  pageName,
  blockName,
  kindLabel,
  indexInPage,
  live,
  bindings,
  impactEdges,
  labelOfKey,
  canEdit,
  onRewrite,
  onPreview,
  onSave,
  onClose,
}: CanvasBlockPanelProps): React.ReactElement {
  const [instruction, setInstruction] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  const key = blockKey(pageId, blockName);

  /* 反查：谁跟着变。⚠ 走 impactedBy，不在面板另写一套——舞台点亮
     用的也是它（impactFocus 内部调），两处口径必须同一份。 */
  const { real, sameField } = React.useMemo(() => {
    const hit = impactedBy(impactEdges, key);
    return { real: [...hit.real], sameField: [...hit.sameField] };
  }, [impactEdges, key]);

  const hasAnyBinding =
    !!bindings &&
    (bindings.fields.length > 0 ||
      bindings.actions.length > 0 ||
      bindings.navTargets.length > 0 ||
      bindings.assets.length > 0);

  async function run() {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const html = await onRewrite(instruction.trim());
      setPending(html);
      onPreview(html);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white text-[12px]"
      data-testid="sliderule-canvas-block-panel"
      data-block-name={blockName}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-[#f0f1f3] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded-md bg-[#f1f3f5] px-1.5 py-px text-[10px] font-medium text-stone-500">
              {kindLabel}
            </span>
            <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-stone-800">
              {blockName}
            </span>
          </div>
          <div className="truncate text-[11px] text-stone-400">
            {pageName}
            {indexInPage !== null ? ` · 第 ${indexInPage} 块` : ""}
            {/* ⚠ 如实说这一块现在是不是真渲染。降级了却不说，用户会以为
                内容就是那个静态卡的样子。 */}
            {live ? "" : " · 已降级为静态卡"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition hover:bg-[#f4f4f5] hover:text-stone-700"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto [scrollbar-width:thin]">
      <section className="border-b border-[#f0f1f3] px-3 py-3" data-testid="sliderule-block-panel-bindings">
        <div className="mb-2 text-[11px] font-medium tracking-[0.02em] text-stone-400">
          这一块用到什么
        </div>
        {hasAnyBinding ? (
          <div className="space-y-2">
            {bindings!.fields.length > 0 ? (
              <div>
                <div className="mb-1 text-[10px] text-stone-400">字段</div>
                <div className="flex flex-wrap gap-1">
                  {bindings!.fields.map(f => (
                    <span
                      key={f}
                      className="rounded-md bg-[#f4f6f8] px-1.5 py-0.5 font-mono text-[10px] text-stone-600"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {bindings!.actions.length > 0 ? (
              <div>
                <div className="mb-1 text-[10px] text-stone-400">动作</div>
                <div className="flex flex-wrap gap-1">
                  {bindings!.actions.map(a => (
                    <span
                      key={a}
                      className="rounded-md bg-[#f4f6f8] px-1.5 py-0.5 font-mono text-[10px] text-stone-600"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {bindings!.navTargets.length > 0 ? (
              <div className="text-[11px] leading-4 text-stone-500">
                跳转 {bindings!.navTargets.join("、")}
              </div>
            ) : null}
            {bindings!.assets.length > 0 ? (
              <div className="text-[11px] leading-4 text-stone-500">
                素材 {bindings!.assets.length} 张
              </div>
            ) : null}
          </div>
        ) : (
          /* ⚠ 「没接数据」是结论，不是空白。见文件头注那条。 */
          <div className="text-[11px] text-stone-400">没接数据（纯视觉块）</div>
        )}
      </section>

      <section className="border-b border-[#f0f1f3] px-3 py-3" data-testid="sliderule-block-panel-impact">
        <div className="mb-2 text-[11px] font-medium tracking-[0.02em] text-stone-400">
          改了它谁跟着变
        </div>
        {real.length === 0 && sameField.length === 0 ? (
          <div className="text-[11px] text-stone-400">无影响（没有别的块跟它相关）</div>
        ) : (
          <div className="space-y-2">
            {real.length > 0 ? (
              <div className="rounded-lg border border-[#f3e6d8] bg-[#fdf8f3] px-2 py-1.5">
                <div className="text-[11px] font-medium text-[#b45309]">
                  真联动 · 运行时跟着变（{real.length}）
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-stone-600">
                  {real.map(labelOfKey).join("、")}
                </div>
              </div>
            ) : null}
            {sameField.length > 0 ? (
              <div>
                {/* ⚠ 这句话不能省：同源字段**不会**跟着这一块的文案改动而变。
                    不说清楚，用户会以为改一处自动同步了（风险台账 #03）。 */}
                <div className="text-[11px] text-stone-400">
                  同源字段 · 改数据模型才一起变（{sameField.length}）
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-stone-400">
                  {sameField.map(labelOfKey).join("、")}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
      </div>

      <section className="mt-auto shrink-0 space-y-2 border-t border-[#f0f1f3] p-3">
        <div className="text-[11px] font-medium tracking-[0.02em] text-stone-400">
          重写这一块
        </div>
        {canEdit ? null : (
          /* 如实说原因，不把按钮藏起来——藏起来用户只会觉得功能没了。 */
          <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
            这个会话还没存成应用，先跑完一轮推演再改。
          </div>
        )}
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          disabled={!canEdit || busy}
          rows={3}
          placeholder="比如：把状态列换成彩色徽标，其余不动"
          data-testid="sliderule-block-panel-instruction"
          className="w-full resize-none rounded-lg border border-[#e8eaed] bg-[#f7f8fa] p-2 text-[12px] leading-5 text-stone-700 outline-none transition focus:border-stone-300 focus:bg-white disabled:opacity-60"
        />
        <button
          type="button"
          onClick={run}
          disabled={!canEdit || busy || !instruction.trim()}
          data-testid="sliderule-block-panel-rewrite"
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-stone-900 text-[12px] font-medium text-white transition hover:bg-stone-800 disabled:bg-[#eceef1] disabled:text-stone-400"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy ? "改着…" : "重写这一块"}
        </button>

        {error ? (
          /* ⚠ 后端 422 是**闸打回**（改出来的内容会劫走块边界/标签不平衡）。
             原样把那句话给用户看——fail-closed 的意义就在于让人看见为什么被拦。 */
          <div
            className="rounded bg-red-50 p-2 text-[11px] text-red-700"
            data-testid="sliderule-block-panel-error"
          >
            {error}
          </div>
        ) : null}

        {pending ? (
          <div
            className="space-y-1 rounded bg-blue-50 p-2 text-[11px] text-blue-800"
            data-testid="sliderule-block-panel-pending"
          >
            <div>已改进画布，**还没保存**。</div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSave(pending);
                    setPending(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                data-testid="sliderule-block-panel-save"
                className="rounded-lg bg-stone-900 px-2.5 py-1 text-white disabled:bg-stone-300"
              >
                保存这一页
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-blue-200 px-2 py-1"
              >
                先放着
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
