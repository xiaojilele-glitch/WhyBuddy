import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import {
  buildActionTrace,
  buildProcessLabelContext,
  getLiveAction,
  inferProcessContextFromExec,
  isExternalProvenance,
  type LiveAction,
} from "@shared/blueprint/capability-process-labels";
import type { CapabilityExecutor } from "@/lib/whybuddy-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { buildStepNarration } from "./step-narration";
import type { TurnStep, WhyArtifact } from "./types";

export type UiCapabilityExecutorContext = {
  userText: string;
  goalText: string;
  onStep: (step: TurnStep) => void;
  onActionTrace?: (trace: ActionTrace) => void;
  setLiveAction: (action: LiveAction | null) => void;
};

/**
 * Wraps the module CapabilityExecutor with product-page UI step emissions (chips + step narration).
 * Session_Driver owns commitArtifact; this adapter only executes capabilities.
 */
export function createUiCapabilityExecutor(
  base: CapabilityExecutor,
  ctx: UiCapabilityExecutorContext
): CapabilityExecutor {
  let stepSeq = 0;
  return {
    async executeCapability(args) {
      const labelCtx = buildProcessLabelContext(args.capabilityId, ctx.userText, ctx.goalText);
      const live = getLiveAction(args.capabilityId, labelCtx);
      ctx.setLiveAction(live);
      const seq = stepSeq++;
      ctx.onStep({
        id: `${args.turnId}-chip-${seq}`,
        kind: "chip",
        capabilityId: args.capabilityId,
        roleId: args.roleId || "agent",
        label: live.label,
        realLlm: false,
      });

      let exec: Awaited<ReturnType<CapabilityExecutor["executeCapability"]>> | null = null;
      let execThrew = false;
      try {
        exec = await base.executeCapability(args);
      } catch {
        execThrew = true;
      }

      const enrichedCtx = inferProcessContextFromExec(args.capabilityId, labelCtx, exec);
      const trace = buildActionTrace(args.capabilityId, !execThrew, enrichedCtx, exec);
      if (trace) ctx.onActionTrace?.(trace);

      const realLlm =
        isExternalProvenance(exec?.provenance) ||
        exec?.provenance === "llm" ||
        exec?.provenance === "llm_fallback" ||
        String(exec?.summary || "").includes("server-llm");

      ctx.onStep({
        id: `${args.turnId}-step-${seq}`,
        kind: "step_narration",
        capabilityId: args.capabilityId,
        realLlm,
        text: buildStepNarration({
          capabilityId: args.capabilityId,
          realLlm,
          summary: exec?.summary,
        }),
      });

      if (exec) return exec;

      const roleId = args.roleId || "agent";
      const cap = args.capabilityId;
      let content = `${roleId} 通过 ${cap} 贡献了新洞察/证据/方案`;
      if (cap === "risk.analyze") {
        content = `${roleId} 通过 risk.analyze 贡献了：\n风险：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）。\n风险：审计风险（权限变更需保留操作者、时间、影响对象）。`;
      } else if (cap === "counter.argue") {
        content = `${roleId} 通过 counter.argue 贡献了：\n反驳：过早引入 ABAC 会增加策略调试成本。\n建议：MVP 先采用 RBAC + scoped data filter，保留策略接口。`;
      }
      return {
        title: content.split("\n")[0]?.slice(0, 80) || cap,
        summary: content.slice(0, 200),
        content,
        provenance: "ai_generated" as const,
      };
    },
  };
}

export function mapArtifactsToWhyArtifacts(
  state: V5SessionState,
  artifactIds: string[]
): WhyArtifact[] {
  const stale = new Set(state.staleArtifactIds || []);
  const out: WhyArtifact[] = [];
  for (const id of artifactIds) {
    const art = (state.artifacts || []).find((a) => a.id === id);
    if (!art?.producedBy?.capabilityId) continue;
    const cap = art.producedBy.capabilityId as V5CapabilityId;
    const realLlm =
      isExternalProvenance(art.provenance) ||
      art.provenance === "llm" ||
      art.provenance === "llm_fallback";
    out.push({
      id: art.id,
      kind: art.kind,
      capability: cap,
      role: art.producedBy.roleId || "agent",
      content: art.content || "",
      trustLevel: stale.has(art.id)
        ? "untrusted"
        : (art.trustLevel as WhyArtifact["trustLevel"]),
      realLlm,
    });
  }
  return out;
}