/**
 * GateBlockedPanel — 发布闭环被闸拦截时的整面错误页（E27，用户定稿的极简风格）。
 *
 * 只有三样东西：盾牌、「发布检查未通过」、一行按拦截原因自适应的人话
 * 副标题。修复入口在对话区的「补齐缺口」（E26），不再堆按钮和卡片；
 * 工程字段压成「技术详情」折叠。fail-closed：只把拦截讲清楚，绝不粉饰成绿。
 *
 * 2026-08-18：AppBundle 改成 Checks 清单之后，拦截原因改成清单上方的
 * compact 条，不再整面盖住——缺了哪几项必须还能看见（红行）。
 */

import React from "react";
import { ShieldAlert } from "lucide-react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

type Blocker = NonNullable<PublishClosureSummary["topBlockers"]>[number];

/** 副标题按最具体的拦截原因说一句人话；默认讲证据缺口数。 */
function subtitleFor(blockers: Blocker[], missing: number): string {
  for (const b of blockers) {
    switch (b.code) {
      case "LLM_GENERATE_DISABLED":
        return "五系统模型生成开关未开启（SLIDERULE_LLM_GENERATE_ENABLED），开启后点「补齐缺口」即可继续。";
      case "LLM_GENERATE_FAILED":
        return "模型网关暂时不可用，稍后点「补齐缺口」重试即可。";
      case "MODEL_GATE_BLOCKED":
        return "生成的模型未通过结构检查，点「补齐缺口」重新生成即可。";
    }
  }
  return `当前缺少 ${missing} 项系统证据，补齐后即可继续发布。`;
}

export function GateBlockedPanel({
  publishClosure,
  compact = false,
}: {
  publishClosure: PublishClosureSummary;
  /** Checks 清单上方的条，不占满整面 */
  compact?: boolean;
}) {
  const present = publishClosure.evidencePresentCount ?? 0;
  const total = publishClosure.skillCount ?? 0;
  const missing = Math.max(0, total - present);
  const blockers = publishClosure.topBlockers ?? [];
  const details = (
    <details className={compact ? "mt-1.5" : "mt-4 max-w-md"}>
      <summary className="cursor-pointer select-none text-[10px] text-stone-300 transition hover:text-stone-500">
        技术详情
      </summary>
      <div className="mt-2 space-y-1 rounded-md bg-[#f7f8fa] p-2.5 text-left font-mono text-[9px] leading-relaxed text-stone-500">
        {blockers.map((b, i) => (
          <div key={`${b.code}-${i}`} className="break-all">
            {b.code}
            {b.affectedSkill ? ` skill=${b.affectedSkill}` : ""}
            {b.path ? ` ${b.path}` : ""}
            {b.ref ? ` ref=${b.ref}` : ""}
          </div>
        ))}
        <div className="break-all text-stone-400">
          evidence={present}/{total}{" "}
          {publishClosure.closureHash && <>closureHash={publishClosure.closureHash} </>}
          {publishClosure.stableDigest && <>digest={publishClosure.stableDigest} </>}
          {publishClosure.generatedAt && <>generatedAt={publishClosure.generatedAt} </>}
          versionPins={publishClosure.versionPinsChecked ? "checked" : "unchecked"}
        </div>
      </div>
    </details>
  );

  if (compact) {
    return (
      <div
        className="border-b border-[#fecaca] bg-[#fef2f2] px-4 py-3"
        data-testid="appbundle-gate-blocked"
      >
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={1.8} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-stone-800">发布检查未通过</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-stone-500">
              {subtitleFor(blockers, missing)}
            </div>
            {details}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-6 px-6 text-center"
      data-testid="appbundle-gate-blocked"
    >
      <ShieldAlert className="h-20 w-20 text-amber-500" strokeWidth={1.4} />
      <div>
        <div className="text-[22px] font-semibold tracking-tight text-stone-800">
          发布检查未通过
        </div>
        <div className="mt-2.5 text-[13px] leading-relaxed text-stone-500">
          {subtitleFor(blockers, missing)}
        </div>
      </div>
      {details}
    </div>
  );
}
