/**
 * AppBundleScreen — 发布 Checks（GitHub Checks / Cursor Problems 那类）。
 *
 * 2026-08-18：不再是默认主舞台，也不再内嵌沙盘/运行应用。
 * 主舞台是 ArchitectureStage；这里只回答「能不能发」。
 * 缺证据必须红，不许用绿卡/进度条把 blocked 画成快成功了。
 *
 * 仍保留：证据链接、未解析标红、hash、修复/剔除留痕（fail-closed）。
 */
import React, { useMemo } from "react";
import { GateBlockedPanel } from "./GateBlockedPanel";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import {
  type FiveSystemModel,
  type RefResolution,
  evidenceSourceOf,
  resolveEntityRef,
  resolvePageRef,
  resolveRoleRef,
  resolveWorkflowRef,
} from "./five-system-model";

interface AppBundleScreenProps {
  publishClosure?: PublishClosureSummary | null;
  model?: FiveSystemModel | null;
  sessionId?: string;
  appTitle?: string;
  isActive?: boolean;
  className?: string;
  qualityNotices?: Array<{ kind: string; text: string }>;
}

const SKILL_META: Array<{
  key: string;
  label: string;
  desc: string;
}> = [
  { key: "datamodel", label: "DataModel", desc: "实体字段 · SSOT" },
  { key: "rbac", label: "RBAC", desc: "角色 · 权限 · 菜单" },
  { key: "workflow", label: "Workflow", desc: "流程 · 审批链" },
  { key: "page", label: "Page", desc: "页面 · 字段绑定" },
  { key: "aigc", label: "AIGC", desc: "Prompt · 触发条件" },
  { key: "appbundle", label: "AppBundle", desc: "发布闭环 · 版本钉扎" },
];

function BindingChip({ res }: { res: RefResolution }) {
  return (
    <span className={res.resolved ? "text-[#171717]" : "text-red-600"}>
      {res.resolved ? res.label : `✗ ${res.label}`}
    </span>
  );
}

export function AppBundleScreen({
  publishClosure,
  model,
  isActive = false,
  className = "",
  qualityNotices = [],
}: AppBundleScreenProps) {
  type SkillKey = "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle";
  const perSkill = (publishClosure?.perSkillEvidence ?? {}) as NonNullable<
    PublishClosureSummary["perSkillEvidence"]
  >;
  const totalPresent = publishClosure?.evidencePresentCount ?? 0;
  const totalSkills = publishClosure?.skillCount ?? 0;
  const blocked = publishClosure?.blocked ?? true;
  const allDone = !blocked && totalPresent >= totalSkills;

  const bundle = model?.appbundle;
  const bindings = useMemo(() => {
    if (!bundle) return null;
    return {
      landing: bundle.landingPageRef
        ? resolvePageRef(bundle.landingPageRef, model)
        : null,
      pages: (bundle.pageBindings ?? []).map((b) => ({
        page: resolvePageRef(b.pageRef, model),
        workflow: resolveWorkflowRef(b.workflowRef, model),
      })),
      roles: (bundle.roleRefs ?? []).map((r) => resolveRoleRef(r, model)),
      entities: (bundle.dataModelRefs ?? []).map((e) => resolveEntityRef(e, model)),
    };
  }, [bundle, model]);
  const hasBindings =
    !!bindings &&
    (!!bindings.landing ||
      bindings.pages.length > 0 ||
      bindings.roles.length > 0 ||
      bindings.entities.length > 0);

  const boardSource = useMemo(() => {
    for (const key of Object.keys(perSkill) as SkillKey[]) {
      const source = evidenceSourceOf(perSkill[key]);
      if (source) return source;
    }
    return null;
  }, [perSkill]);

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="appBundle"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e5e7eb] px-4 py-2">
        <span className="text-[12px] font-medium text-stone-700">Checks</span>
        {boardSource && (
          <span
            data-testid={`evidence-source-${boardSource.kind}`}
            className="text-[11px] text-stone-400"
            title={
              boardSource.kind === "llm"
                ? "本话题为新颖意图，五系统模型由真实 LLM 生成并通过结构闸"
                : "本话题命中内置演示域（确定性样板，秒出、不调 LLM）"
            }
          >
            {boardSource.label}
          </span>
        )}
        <span
          className={`ml-auto text-[11px] font-medium ${
            allDone ? "text-stone-500" : "text-red-600"
          }`}
        >
          {totalSkills === 0
            ? "未产出"
            : `${allDone ? "closed" : "failed"} ${totalPresent}/${totalSkills}`}
        </span>
      </div>

      {qualityNotices.length > 0 && (
        <ul className="space-y-1 border-b border-[#e5e7eb] px-4 py-2" data-testid="sliderule-quality-notices">
          {qualityNotices.map((n, i) => (
            <li
              key={`${n.kind}-${i}`}
              data-testid="sliderule-quality-notice"
              data-kind={n.kind}
              className="text-[12px] text-amber-800"
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}
      {publishClosure && blocked && (
        <GateBlockedPanel publishClosure={publishClosure} compact />
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="flex flex-col" data-testid="appbundle-evidence-list">
          {SKILL_META.map(({ key, label, desc }) => {
            const ev = perSkill[key as SkillKey];
            const present = ev?.evidencePresent === true;
            const ref = present ? (ev?.artifactId || ev?.evidenceRef) : "";
            return (
              <div
                key={key}
                data-testid={`appbundle-check-${key}`}
                data-missing={present ? "false" : "true"}
                className={`flex items-baseline gap-2 border-b border-[#f0f0f0] py-1.5 text-[12.5px] ${
                  present ? "text-[#171717]" : "text-red-600"
                }`}
              >
                <span className={`w-3 shrink-0 text-[11px] ${present ? "text-emerald-600" : "text-red-600"}`}>
                  {present ? "✓" : "✗"}
                </span>
                <span className="w-[92px] shrink-0 font-medium">{label}</span>
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] ${
                    present ? "text-stone-500" : "text-red-500"
                  }`}
                >
                  {present ? ev?.summary || desc : ev?.summary || "证据缺失"}
                </span>
                {ref && (
                  <span
                    className="max-w-[42%] shrink-0 truncate font-mono text-[10px] text-stone-400"
                    title={ev?.evidenceRef || ev?.artifactId}
                  >
                    {ref}
                    {ev?.digest ? ` · ${ev.digest.slice(0, 8)}` : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {hasBindings && bindings && (
          <div className="mt-5" data-testid="appbundle-bindings">
            <div className="mb-1.5 text-[11px] font-medium text-stone-400">装配</div>
            <div className="flex flex-col text-[12.5px]">
              {bindings.landing && (
                <div className="flex items-baseline gap-2 border-b border-[#f0f0f0] py-1.5">
                  <span className="w-[92px] shrink-0 text-stone-400">打开后首屏</span>
                  <BindingChip res={bindings.landing} />
                </div>
              )}
              {bindings.pages.map((b, i) => (
                <div
                  key={`${b.page.ref}-${i}`}
                  className="flex items-baseline gap-2 border-b border-[#f0f0f0] py-1.5"
                >
                  <span className="w-[92px] shrink-0 text-stone-400">
                    {i === 0 ? "页面 ↔ 流程" : ""}
                  </span>
                  <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
                    <BindingChip res={b.page} />
                    <span className="text-stone-300">→</span>
                    <BindingChip res={b.workflow} />
                  </span>
                </div>
              ))}
              {bindings.roles.length > 0 && (
                <div className="flex items-baseline gap-2 border-b border-[#f0f0f0] py-1.5">
                  <span className="w-[92px] shrink-0 text-stone-400">角色（RBAC）</span>
                  <span className="flex min-w-0 flex-wrap gap-1">
                    {bindings.roles.map((r) => (
                      <BindingChip key={r.ref} res={r} />
                    ))}
                  </span>
                </div>
              )}
              {bindings.entities.length > 0 && (
                <div className="flex items-baseline gap-2 border-b border-[#f0f0f0] py-1.5">
                  <span className="w-[92px] shrink-0 text-stone-400">实体（DataModel）</span>
                  <span className="flex min-w-0 flex-wrap gap-1">
                    {bindings.entities.map((e) => (
                      <BindingChip key={e.ref} res={e} />
                    ))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {((bundle?.invariants?.length ?? 0) > 0 || bundle?.invariantNotes) && (
          <div className="mt-5" data-testid="appbundle-invariants">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-stone-400">系统不变式</span>
              <span className="text-[11px] text-stone-300">
                {bundle!.invariants?.length ?? 0} 条 · 必须恒真
              </span>
            </div>
            {bundle?.invariantNotes &&
              ((bundle.invariantNotes.repaired?.length ?? 0) > 0 ||
                (bundle.invariantNotes.dropped?.length ?? 0) > 0) && (
                <div
                  className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200"
                  data-testid="appbundle-invariant-notes"
                >
                  {(bundle.invariantNotes.repaired?.length ?? 0) > 0 && (
                    <span>
                      自动修复 {bundle.invariantNotes.repaired!.length} 处引用
                      （{bundle.invariantNotes.repaired!
                        .map((r) => `${r.from} → ${r.to}`)
                        .join("；")}）
                    </span>
                  )}
                  {(bundle.invariantNotes.dropped?.length ?? 0) > 0 && (
                    <span className="ml-1">
                      剔除 {bundle.invariantNotes.dropped!.length} 条引用无效的不变式
                      （{bundle.invariantNotes.dropped!
                        .map((d) => d.invariantId || d.statement || "")
                        .filter(Boolean)
                        .join("；")}）
                    </span>
                  )}
                </div>
              )}
            <ul className="space-y-2">
              {(bundle!.invariants ?? []).map((inv, i) => (
                <li
                  key={inv.id || i}
                  className="border-b border-[#f0f0f0] pb-2 text-[12.5px]"
                  data-testid={`appbundle-invariant-${inv.id || i}`}
                >
                  <div className="flex gap-2 text-[#171717]">
                    <span className="w-5 shrink-0 font-mono text-[11px] text-stone-300">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{inv.statement || inv.id}</span>
                  </div>
                  {((inv.systems?.length ?? 0) > 0 || (inv.refs?.length ?? 0) > 0) && (
                    <div className="ml-7 mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-stone-400">
                      {(inv.systems ?? []).map((s) => (
                        <span key={s} className="uppercase tracking-wide">
                          {s}
                        </span>
                      ))}
                      {(inv.refs ?? []).map((r) => (
                        <span key={r}>{r}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {bundle?.presentationNotes &&
          ((bundle.presentationNotes.repaired?.length ?? 0) > 0 ||
            (bundle.presentationNotes.droppedCharts?.length ?? 0) > 0 ||
            (bundle.presentationNotes.droppedStats?.length ?? 0) > 0 ||
            (bundle.presentationNotes.clearedFormats?.length ?? 0) > 0 ||
            (bundle.presentationNotes.clearedIdentity?.length ?? 0) > 0 ||
            (bundle.presentationNotes.clearedLandingPage?.length ?? 0) > 0 ||
            (bundle.presentationNotes.droppedBlocks?.length ?? 0) > 0) && (
            <div
              className="mt-3 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200"
              data-testid="appbundle-presentation-notes"
            >
              <span className="font-semibold">展示层自动修复：</span>
              {(bundle.presentationNotes.repaired?.length ?? 0) > 0 && (
                <span>
                  修复 {bundle.presentationNotes.repaired!.length} 处展示引用
                  （{bundle.presentationNotes.repaired!
                    .map((r) => `${r.from} → ${r.to}`)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.droppedCharts?.length ?? 0) > 0 && (
                <span className="ml-1">
                  剔除 {bundle.presentationNotes.droppedCharts!.length} 个无法渲染的图表
                  （{bundle.presentationNotes.droppedCharts!
                    .map((d) => d.chartId || "")
                    .filter(Boolean)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.droppedStats?.length ?? 0) > 0 && (
                <span className="ml-1">
                  剔除 {bundle.presentationNotes.droppedStats!.length} 个无法渲染的统计卡
                  （{bundle.presentationNotes.droppedStats!
                    .map((d) => d.statId || "")
                    .filter(Boolean)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.clearedFormats?.length ?? 0) > 0 && (
                <span className="ml-1">
                  清除 {bundle.presentationNotes.clearedFormats!.length} 个非法格式声明（回默认渲染）
                </span>
              )}
              {(bundle.presentationNotes.clearedIdentity?.length ?? 0) > 0 && (
                <span className="ml-1">
                  清除 {bundle.presentationNotes.clearedIdentity!.length} 个非法身份声明（回默认主题）
                </span>
              )}
              {(bundle.presentationNotes.clearedLandingPage?.length ?? 0) > 0 && (
                <span className="ml-1">
                  清除 {bundle.presentationNotes.clearedLandingPage!.length} 个无效首屏引用（回旧工作台）
                </span>
              )}
              {(bundle.presentationNotes.droppedBlocks?.length ?? 0) > 0 && (
                <span className="ml-1">
                  剔除 {bundle.presentationNotes.droppedBlocks!.length} 个目录外区块
                  （{bundle.presentationNotes.droppedBlocks!
                    .map(item => item.type || item.blockId || "未命名")
                    .join("；")}）
                </span>
              )}
            </div>
          )}

        {publishClosure && (publishClosure.closureHash || publishClosure.stableDigest || publishClosure.generatedAt) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono text-stone-400">
            {publishClosure.closureHash && <span>closureHash={publishClosure.closureHash}</span>}
            {publishClosure.stableDigest && <span>digest={publishClosure.stableDigest}</span>}
            {publishClosure.generatedAt && <span>generatedAt={publishClosure.generatedAt}</span>}
            <span>versionPins={publishClosure.versionPinsChecked ? "checked" : "unchecked"}</span>
          </div>
        )}

        {!publishClosure && (
          <div className="mt-6 text-center text-xs text-stone-300">
            发送应用意图后，面团 AI 将逐系统填充发布证据
          </div>
        )}
      </div>
    </div>
  );
}
