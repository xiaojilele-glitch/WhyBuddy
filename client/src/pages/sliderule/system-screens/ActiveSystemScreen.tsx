/**
 * ActiveSystemScreen — 16:9 主视图容器
 *
 * 根据 activeSkillId 派发到对应系统渲染器（抽屉 inspector）。
 * 无激活 Skill 时默认展示 AppBundleScreen（发布 Checks）。
 *
 * skillContents 里若携带结构化五系统模型（JSON），在这里统一解析一次，
 * 传给 Workflow/AIGC/AppBundle 做交叉引用渲染；解析失败时各屏自行诚实降级。
 */

import React, { useMemo } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromContents,
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
  type SkillRuntimeGraphLike,
} from "./five-system-model";
import { DataModelScreen } from "./DataModelScreen";
import { WorkflowScreen } from "./WorkflowScreen";
import { RbacScreen } from "./RbacScreen";
import { PageScreen } from "./PageScreen";
import { AigcScreen } from "./AigcScreen";
import { AppBundleScreen } from "./AppBundleScreen";

/** 生成中覆盖层的系统名（与缩略图/步骤文案一致） */
const GENERATING_SKILL_LABELS: Record<string, string> = {
  dataModel: "数据模型",
  workflow: "工作流",
  rbac: "角色权限",
  page: "页面",
  aigc: "AI 能力",
  appBundle: "应用装配",
};

interface ActiveSystemScreenProps {
  activeSkillId: SkillId | null;
  /** 本轮推演是否进行中——运行中且当前系统内容未落地时盖"生成中"层，
   *  避免空态文案（"发送意图并推演闭环后…"）在执行期被误读成旧页面 */
  running?: boolean;
  publishClosure?: PublishClosureSummary | null;
  /** Latest mermaid source from skill_result events */
  latestMermaid?: string | null;
  /** Raw content strings by skill (populated as SSE results arrive) */
  skillContents?: Partial<Record<SkillId, string>>;
  /** Persisted cross-skill runtime graph (from python /drive-full, survives reload) */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  /** 运行应用标题（话题名） */
  appTitle?: string;
  /** 已在上层解析好的五系统模型（传入则跳过内部解析，抽屉复用） */
  model?: FiveSystemModel | null;
  /** true = 填满父容器（抽屉形态），false = 16:9 主视图（默认） */
  fill?: boolean;
  className?: string;
  qualityNotices?: Array<{ kind: string; text: string }>;
}

export function ActiveSystemScreen({
  activeSkillId,
  running = false,
  publishClosure,
  latestMermaid,
  skillContents = {},
  skillRuntimeGraph = null,
  sessionId,
  appTitle,
  model,
  fill = false,
  className = "",
  qualityNotices = [],
}: ActiveSystemScreenProps) {
  // 结构化五系统模型（一次解析，多屏共享做交叉引用）：
  //   live 路径 — SSE skill_result 累积的 skillContents（fenced JSON）；
  //   reload 路径 — 持久化 publishClosure.perSkillEvidence[*].modelSection。
  // 段级合并，live 段优先；两者皆空时各屏自行诚实降级。
  const parsedModel = useMemo(
    () =>
      model !== undefined
        ? null
        : mergeFiveSystemModels(
            parseFiveSystemModelFromContents(skillContents),
            parseFiveSystemModelFromPerSkillEvidence(publishClosure?.perSkillEvidence)
          ),
    [model, skillContents, publishClosure?.perSkillEvidence]
  );
  const fiveSystemModel = model !== undefined ? model : parsedModel;

  // 推演进行中且当前屏的证据尚未落地 → 还没有可渲染内容，用"生成中"
  // 覆盖层替代静态空态（空态口吻是闭环后的，执行期会被误读成旧页面）。
  // 无激活系统时默认屏是 AppBundle 看板，同样按其证据判断。
  const overlaySkill = activeSkillId ?? ("appBundle" as SkillId);
  const activeSkillHasContent = (() => {
    if ((skillContents[overlaySkill] || "").trim()) return true;
    const evidence = (publishClosure?.perSkillEvidence ?? {}) as Record<
      string,
      { modelSection?: unknown } | undefined
    >;
    return Boolean(evidence[overlaySkill.toLowerCase()]?.modelSection);
  })();
  const showGeneratingOverlay = running && !activeSkillHasContent;

  return (
    <div
      className={
        fill
          ? // 抽屉全幅形态：无白卡边框/圆角/投影，与页面底色统一（用户反馈去嵌套）
            `relative h-full w-full overflow-hidden ${className}`
          : `relative w-full overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-sm ${className}`
      }
      style={fill ? undefined : { aspectRatio: "16 / 9" }}
    >
      {showGeneratingOverlay && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 backdrop-blur-[1px]"
          data-testid="screen-generating-overlay"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex gap-1.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#1677ff] [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#1677ff] [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[#1677ff] [animation-delay:300ms]" />
            </span>
            <div className="text-[13px] font-medium text-stone-600">
              {activeSkillId
                ? `推演执行中 · ${GENERATING_SKILL_LABELS[activeSkillId] ?? activeSkillId} 系统画面生成中…`
                : "推演执行中 · 六系统画面将逐个生成…"}
            </div>
            <div className="text-[11px] text-stone-400">
              证据落地后此处将实时渲染
            </div>
          </div>
        </div>
      )}
      <div className="absolute inset-0">
        {/* Each screen is mounted but only the active one is fully visible.
            Keeping them all mounted avoids mermaid re-render flicker. */}

        <div className={activeSkillId === "dataModel" ? "h-full w-full" : "hidden"}>
          <DataModelScreen
            publishClosure={publishClosure}
            mermaidSource={skillContents.dataModel ?? latestMermaid}
            model={fiveSystemModel}
            sessionId={sessionId}
            isActive={activeSkillId === "dataModel"}
          />
        </div>

        <div className={activeSkillId === "workflow" ? "h-full w-full" : "hidden"}>
          <WorkflowScreen
            publishClosure={publishClosure}
            mermaidSource={skillContents.workflow ?? latestMermaid}
            model={fiveSystemModel}
            skillRuntimeGraph={skillRuntimeGraph}
            sessionId={sessionId}
            isActive={activeSkillId === "workflow"}
          />
        </div>

        <div className={activeSkillId === "rbac" ? "h-full w-full" : "hidden"}>
          <RbacScreen
            publishClosure={publishClosure}
            rawContent={skillContents.rbac}
            model={fiveSystemModel}
            sessionId={sessionId}
            isActive={activeSkillId === "rbac"}
          />
        </div>

        <div className={activeSkillId === "page" ? "h-full w-full" : "hidden"}>
          <PageScreen
            publishClosure={publishClosure}
            rawContent={skillContents.page}
            model={fiveSystemModel}
            isActive={activeSkillId === "page"}
          />
        </div>

        <div className={activeSkillId === "aigc" ? "h-full w-full" : "hidden"}>
          <AigcScreen
            publishClosure={publishClosure}
            rawContent={skillContents.aigc}
            model={fiveSystemModel}
            appTitle={appTitle}
            isActive={activeSkillId === "aigc"}
          />
        </div>

        {/* Default / appBundle — show when no skill is active */}
        <div className={!activeSkillId || activeSkillId === "appBundle" ? "h-full w-full" : "hidden"}>
          <AppBundleScreen
            publishClosure={publishClosure}
            model={fiveSystemModel}
            sessionId={sessionId}
            appTitle={appTitle}
            isActive={!activeSkillId || activeSkillId === "appBundle"}
            qualityNotices={qualityNotices}
          />
        </div>
      </div>
    </div>
  );
}
