/**
 * 自动推进 hook — 监听 job.stage 变化,自动触发下一阶段 API
 *
 * 编组阶段的 8 个子阶段按顺序自动推进:
 * spec_tree → spec_docs → effect_preview → prompt_packaging →
 * runtime_capability → engineering_handoff → engineering_landing
 *
 * spec_docs 与 prompt_packaging 的下游阶段会自动触发；effect_preview →
 * prompt_packaging 显式保留为用户手动推进，避免用户刚进入效果预览就被跳走。
 * 失败时停止推进,暴露 error + retry 给 UI。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiRequestError } from "@/lib/api-client";
import {
  generateBlueprintSpecDocuments,
  generateBlueprintEffectPreview,
  generateBlueprintPromptPackages,
  generateBlueprintEngineeringLanding,
} from "@/lib/blueprint-api";
import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { AutopilotRailSubStage } from "../types";

export interface UseAutoAdvanceActions {
  generateSpecDocuments?: typeof generateBlueprintSpecDocuments;
  generateEffectPreview?: typeof generateBlueprintEffectPreview;
  generatePromptPackages?: typeof generateBlueprintPromptPackages;
  generateEngineeringLanding?: typeof generateBlueprintEngineeringLanding;
}

export interface UseAutoAdvanceOptions {
  jobId: string;
  job: BlueprintGenerationJob | null;
  specTree: BlueprintSpecTree | null;
  rightRailSpecTree?: BlueprintSpecTree | null;
  generationActions?: UseAutoAdvanceActions;
  /** User's preferred locale, passed to generation requests. */
  locale?: "zh-CN" | "en-US";
  /** 当阶段推进成功后调用,让父组件刷新数据 */
  onAdvanced: (nextSubStage?: AutopilotRailSubStage) => void;
}

export interface UseAutoAdvanceResult {
  /** 当前是否正在自动推进 */
  advancing: boolean;
  /** 推进失败的错误 */
  error: ApiRequestError | null;
  /** 手动重试 */
  retry: () => void;
  /** 当前正在推进的目标阶段 */
  advancingTo: string | null;
  /** 手动强制推进到下一阶段(忽略 status 条件) */
  forceAdvance: () => void;
}

export function selectAutoAdvanceSpecTree(
  pageSpecTree: BlueprintSpecTree | null,
  rightRailSpecTree?: BlueprintSpecTree | null
): BlueprintSpecTree | null {
  return pageSpecTree ?? rightRailSpecTree ?? null;
}

export function selectAutoAdvanceSubStage(
  targetStage: string
): AutopilotRailSubStage | undefined {
  switch (targetStage) {
    case "spec_docs":
      return "spec_tree";
    case "effect_preview":
      return "effect_preview";
    case "prompt_packaging":
      return "prompt_package";
    case "engineering_landing":
      return "artifact_memory";
    default:
      return undefined;
  }
}

/**
 * 阶段推进规则:
 * - spec_tree (reviewing) → 自动生成 spec_docs
 * - spec_docs (completed) → 自动生成 effect_preview
 * - effect_preview (completed) → 仅由 forceAdvance 手动生成 prompt_packages
 * - prompt_packaging (completed) → 自动生成 engineering_landing
 *
 * 注:runtime_capability 和 engineering_handoff 目前由后端 SSE 事件驱动,
 * 前端不主动触发(它们依赖 Docker/MCP 等外部能力调用)。
 */
export function useAutoAdvance({
  jobId,
  job,
  specTree,
  rightRailSpecTree,
  generationActions,
  locale,
  onAdvanced,
}: UseAutoAdvanceOptions): UseAutoAdvanceResult {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [advancingTo, setAdvancingTo] = useState<string | null>(null);
  const actions = useMemo(
    () => ({
      generateSpecDocuments:
        generationActions?.generateSpecDocuments ??
        generateBlueprintSpecDocuments,
      generateEffectPreview:
        generationActions?.generateEffectPreview ??
        generateBlueprintEffectPreview,
      generatePromptPackages:
        generationActions?.generatePromptPackages ??
        generateBlueprintPromptPackages,
      generateEngineeringLanding:
        generationActions?.generateEngineeringLanding ??
        generateBlueprintEngineeringLanding,
    }),
    [generationActions]
  );

  // 防止重复触发
  const advancedStagesRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  // 首次加载延迟：页面刚进入编组时不立即推进，给用户一个观察窗口。
  // whybuddy-rebrand-and-stage3-unblock-2026-05-28 §A.3：
  //   - 默认 800ms（原 3000ms）。
  //   - 当挂载时 job.stage 已经超过 clarification（说明这次挂载不是第一次入场，
  //     而是 spec 阶段后的 re-attach），则跳过延迟，避免阻塞 spec_docs →
  //     effect_preview 的正常自动推进。
  const initialDelayRef = useRef(true);
  const lastJobStageRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const initialStage = job?.stage ?? null;
    const skipDelay =
      initialStage !== null &&
      initialStage !== "input" &&
      initialStage !== "clarification";
    if (skipDelay) {
      initialDelayRef.current = false;
    }
    const timer = setTimeout(() => {
      initialDelayRef.current = false;
    }, 800);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
    // 仅依赖 mount，job.stage 在后续 effect 中通过 lastJobStageRef 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 jobId 变化时重置
  useEffect(() => {
    advancedStagesRef.current = new Set();
    lastJobStageRef.current = null;
    setError(null);
    setAdvancing(false);
    setAdvancingTo(null);
  }, [jobId]);

  // whybuddy-rebrand-and-stage3-unblock-2026-05-28 §A.2：
  // 当 job.stage 回退（例如用户从 effect_preview 回到 spec_docs 重生成），
  // advancedStagesRef 中的旧条目会让自动推进永久哑火。这里在 stage 回退时
  // 把比新 stage 更靠后的所有条目清空，让用户的二次推进重新生效。
  useEffect(() => {
    const currentStage = job?.stage ?? null;
    const previousStage = lastJobStageRef.current;
    lastJobStageRef.current = currentStage;
    if (!currentStage || !previousStage || currentStage === previousStage) {
      return;
    }
    const order = [
      "input",
      "clarification",
      "route_generation",
      "spec_tree",
      "spec_docs",
      "effect_preview",
      "preview",
      "prompt_packaging",
      "engineering_landing",
      "runtime_capability",
      "engineering_handoff",
    ];
    const currentIdx = order.indexOf(currentStage);
    const previousIdx = order.indexOf(previousStage);
    if (currentIdx < 0 || previousIdx < 0 || currentIdx >= previousIdx) {
      return;
    }
    // Stage 回退：清掉 currentStage 之后的所有 advanced 标记。
    const next = new Set<string>();
    advancedStagesRef.current.forEach(stageKey => {
      const idx = order.indexOf(stageKey);
      if (idx >= 0 && idx <= currentIdx) {
        next.add(stageKey);
      }
    });
    advancedStagesRef.current = next;
  }, [job?.stage]);

  const advance = useCallback(
    async (targetStage: string, action: () => Promise<{ ok: boolean; error?: ApiRequestError }>) => {
      // 不再检查 advancedStagesRef(forceAdvance 场景下用户主动点击应该总是执行)
      setAdvancing(true);
      setAdvancingTo(targetStage);
      setError(null);

      // 前端超时保护：5 分钟后强制重置 advancing 状态，防止死锁
      const FRONTEND_TIMEOUT_MS = 5 * 60 * 1000;
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (mountedRef.current) {
          setAdvancing(false);
          setAdvancingTo(null);
          setError({ message: "请求超时", detail: "规格文档生成超过 5 分钟，请重试", status: 408 } as ApiRequestError);
        }
      }, FRONTEND_TIMEOUT_MS);

      try {
        const result = await action();
        clearTimeout(timeoutId);

        if (!mountedRef.current || timedOut) return;

        if (result.ok) {
          setAdvancing(false);
          setAdvancingTo(null);
          advancedStagesRef.current.add(targetStage);
          onAdvanced(selectAutoAdvanceSubStage(targetStage));
        } else {
          setAdvancing(false);
          setError(result.error ?? null);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (!mountedRef.current || timedOut) return;
        setAdvancing(false);
        setError({ message: "请求失败", detail: String(err), status: 500 } as ApiRequestError);
      }
    },
    [onAdvanced]
  );

  // 监听 job.stage 变化,自动触发下一阶段
  useEffect(() => {
    if (!jobId || !job || advancing || initialDelayRef.current) return;

    const stage = job.stage;
    const status = job.status;

    /**
     * 契约（autopilot-streaming-experience 需求 5）：spec_tree 阶段只能由用户
     * 点击 StageViewport CTA 经 forceAdvance 推进；auto-advance
     * 严禁调用 generateBlueprintSpecDocuments，无论 status 是 running /
     * reviewing / completed。若未来重新启用此处自动推进，必须同步更新
     * `hooks/__tests__/use-auto-advance.spec-tree.test.ts` 的回归断言。
     */
    // spec_tree + completed → 自动生成 spec_docs
    // 注:reviewing 状态表示"等待用户评审",不应自动推进
    // 修正：spec_tree 阶段完全禁用自动推进，必须由用户手动点击"确认 SPEC 树"按钮
    // 触发 forceAdvance()，避免用户还没查看 SPEC 树就被自动跳过。
    if (
      stage === "spec_tree" &&
      !advancedStagesRef.current.has("spec_docs")
    ) {
      // 不自动推进，等待用户手动确认
      return;
    }

    // spec_docs + completed → 自动生成 effect_preview
    if (
      stage === "spec_docs" &&
      status === "completed" &&
      !advancedStagesRef.current.has("effect_preview")
    ) {
      void advance("effect_preview", async () => {
        const result = await actions.generateEffectPreview(jobId, {
          includeDrafts: true,
        });
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
      return;
    }

    // effect_preview + completed 不再自动生成 prompt_packages。
    // autopilot-step-06-effect-preview-fix-2026-05-31：必须由用户点击
    // StageViewport CTA 触发 forceAdvance()，让用户有时间审阅效果预演。

    // prompt_packaging + completed → 自动生成 engineering_landing
    if (
      stage === "prompt_packaging" &&
      status === "completed" &&
      !advancedStagesRef.current.has("engineering_landing")
    ) {
      void advance("engineering_landing", async () => {
        const result = await actions.generateEngineeringLanding(jobId, {});
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
      return;
    }
  }, [jobId, job, specTree, advancing, advance, actions]);

  const retry = useCallback(() => {
    if (!error || !advancingTo) return;
    setError(null);
    // 重置 advancedStages 中的失败项,让 effect 重新触发
    advancedStagesRef.current.delete(advancingTo);
    setAdvancingTo(null);
  }, [error, advancingTo]);

  // 手动强制推进:用户点击"确认并继续"时调用
  const forceAdvance = useCallback(() => {
    if (!jobId || !job) return;
    // 如果 advancing 已经超过 5 分钟，强制重置（防止死锁）
    if (advancing) {
      console.warn("[forceAdvance] blocked by advancing=true, skipping");
      return;
    }

    // 先触发 W1 refetch(可能后端已经推进了但前端没感知到)
    onAdvanced();

    const stage = job.stage;

    // 直接调用 API,不检查 advancedStagesRef(用户主动点击应该总是执行)
    if (stage === "spec_tree") {
      void advance("spec_docs", async () => {
        // whybuddy-rebrand-and-stage3-unblock-2026-05-28 §A.1：
        // 用户明确要求 "你不要生成全部，这特别费时间，你只生成一份就好了"。
        // 默认只生成 requirements 文档以缩短关键路径。后端仍可一次受理 3 个
        // 文档类型；这里只是 client-side 的默认值，UI 入口（详情页或 worker）
        // 仍可显式 override 为 ["requirements","design","tasks"]。
        const result = await actions.generateSpecDocuments(jobId, {
          types: ["requirements"],
          locale,
        });
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
    } else if (stage === "spec_docs") {
      void advance("effect_preview", async () => {
        const result = await actions.generateEffectPreview(jobId, {
          includeDrafts: true,
        });
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
    } else if (stage === "effect_preview" || stage === "preview") {
      void advance("prompt_packaging", async () => {
        const result = await actions.generatePromptPackages(jobId, {
          includeDrafts: true,
          includePreviewDrafts: true,
        });
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
    } else if (stage === "prompt_packaging") {
      void advance("engineering_landing", async () => {
        const result = await actions.generateEngineeringLanding(jobId, {});
        return { ok: result.ok, error: result.ok ? undefined : result.error };
      });
    }
  }, [
    jobId,
    job,
    specTree,
    rightRailSpecTree,
    advancing,
    advance,
    onAdvanced,
    actions,
  ]);

  return { advancing, error, retry, advancingTo, forceAdvance };
}
