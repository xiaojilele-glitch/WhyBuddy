/**
 * ArchitectureStage — board 默认面：C4 L2 沙盘 / 架构图。
 *
 * 2026-08-18：默认 C4 L2（中性容器 + 捆扎边）。点组展开，点成员看线。
 *
 * AppBundle 不画成第六个平级组——它是发布检查，不是 C4 容器。
 * 缺证据的 Checks 按钮是红的，不许用绿卡假装齐了。
 */
import React, { useMemo, useState } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { MermaidDiagram } from "./MermaidDiagram";
import {
  deriveSystemLinkageGraph,
  linkageToMermaid,
  type FiveSystemModel,
} from "./system-screens/five-system-model";
import { SystemLinkageGraph } from "./system-screens/SystemLinkageGraph";

export function ArchitectureStage({
  model,
  publishClosure,
  onInspect,
  focusSkill,
  versionToolbar,
  trailing,
  className = "",
  qualityNotices = [],
  roundTools,
}: {
  model?: FiveSystemModel | null;
  publishClosure?: PublishClosureSummary | null;
  onInspect: (skill: SkillId) => void;
  /** 最近一次推演落到的系统：沙盘只描边，不编造路径 */
  focusSkill?: SkillId | null;
  versionToolbar?: React.ReactNode;
  /** 标题行最右：工作台图标簇（隐藏页面/交付物…） */
  trailing?: React.ReactNode;
  className?: string;
  /**
   * ⚠ 2026-09-13：这里原来写 `kind?`，而同一个东西在
   * `ActiveSystemScreen` / `AppBundleScreen` 都是必填、生产侧
   * （Python `spec_first_pipeline` 产的 `{"kind":…, "text":…}`、
   * marathon driver 的 `onQualityNotice`）也一直必填——三处声明对不上，
   * 往下传就报 TS2322。对齐到真实契约：kind 必有。
   */
  qualityNotices?: Array<{ kind: string; text: string }>;
  /** 本跳公开工具。没跑 closure/bind 时不许沿用上一版 6/6。 */
  roundTools?: string[] | null;
}) {
  const [graphStyle, setGraphStyle] = useState<"flow" | "mermaid">("flow");
  const [archFit, setArchFit] = useState(true);
  const canLinkage = useMemo(() => deriveSystemLinkageGraph(model) !== null, [model]);
  const archMermaid = useMemo(() => linkageToMermaid(model), [model]);

  const present = publishClosure?.evidencePresentCount ?? 0;
  const hopClosed =
    !roundTools ||
    roundTools.includes("closure") ||
    roundTools.includes("bind");
  const total = hopClosed ? (publishClosure?.skillCount ?? 0) : 0;
  const blocked = hopClosed ? (publishClosure?.blocked ?? true) : true;
  const missing = Math.max(0, total - present);
  const checksFailed = blocked || missing > 0 || total === 0;

  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col ${className}`}
      data-testid="sliderule-architecture-stage"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-1 py-1">
        {canLinkage && (
          <div
            className="flex items-center rounded-lg bg-[#f4f4f5] p-0.5"
            data-testid="architecture-graph-style"
          >
            {(
              [
                ["flow", "沙盘"],
                ["mermaid", "架构图"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`architecture-graph-${id}`}
                aria-pressed={graphStyle === id}
                onClick={() => setGraphStyle(id)}
                className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                  graphStyle === id
                    ? "bg-white font-medium text-stone-800 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {graphStyle === "mermaid" && archMermaid && (
          <button
            type="button"
            data-testid="architecture-arch-fit"
            onClick={() => setArchFit(v => !v)}
            className="text-[11px] text-stone-400 hover:text-stone-600"
            title={archFit ? "切到原始尺寸，滚动查看细节" : "缩放到容器宽度，看整体结构"}
          >
            {archFit ? "原始尺寸" : "适宽全貌"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            data-testid="architecture-checks"
            onClick={() => onInspect("appBundle")}
            title="打开发布检查"
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              checksFailed
                ? "text-red-600 hover:bg-[#fef2f2]"
                : "text-stone-500 hover:bg-[#f4f4f5]"
            }`}
          >
            {checksFailed ? "✗" : "✓"}{" "}
            {total === 0 ? "Checks 未产出" : `Checks ${present}/${total}`}
          </button>
          {versionToolbar}
          {trailing}
        </div>
      </div>
      {qualityNotices.length > 0 && (
        <ul
          className="shrink-0 space-y-0.5 border-b border-[#e5e7eb] px-2 py-1"
          data-testid="sliderule-quality-notices"
        >
          {qualityNotices.map((n, i) => (
            <li
              key={`${n.kind || "note"}-${i}`}
              data-testid="sliderule-quality-notice"
              data-kind={n.kind}
              className="text-[11px] text-amber-800"
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1">
        {canLinkage && graphStyle === "mermaid" && archMermaid ? (
          <div className="h-full w-full overflow-auto p-4" data-testid="architecture-arch-mermaid">
            <MermaidDiagram chart={archMermaid} fit={archFit} />
          </div>
        ) : canLinkage ? (
          <SystemLinkageGraph model={model} onInspect={onInspect} focusSkill={focusSkill} />
        ) : (
          <div
            className="flex h-full flex-col items-center justify-center gap-1 text-center"
            data-testid="architecture-empty"
          >
            {/* ⚠ 2026-09-15 改文案。原来是「推演完成后这里是**五系统**接线沙盘」
                / 「**六个**系统是图上的组」——两行自己就对不上（五 vs 六），
                而且「五系统」那套已经退役，现在的方向是工程模式 + 沙盒终端 + 预览。
                真机上新会话建工程之前看到的就是这一句，等于对用户宣传一个
                不再做的东西。

                只改文案，不动这一屏的职责：它仍然是 HTML 推演档跑完之后
                放架构图的地方。数量写死也一并去掉——图上有几个组是模型定的，
                写死一个数迟早又对不上。 */}
            <div className="text-[13px] text-stone-500">推演完成后这里是应用的架构图</div>
            <div className="text-[11px] text-stone-400">系统是图上的组，点开看一层</div>
          </div>
        )}
      </div>
    </div>
  );
}
