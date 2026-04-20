import type { DecisionType, MissionDecisionOption } from "./contracts.js";

/* ─── Decision Template ─── */

export interface DecisionTemplate {
  templateId: string;
  name: string;
  description: string;
  defaultType: DecisionType;
  defaultOptions: MissionDecisionOption[];
  defaultPrompt: string;
  defaultAllowFreeText?: boolean;
  defaultPayloadSchema?: Record<string, string>;
}

/* ─── Built-in Templates ─── */

export const BUILTIN_DECISION_TEMPLATES: readonly DecisionTemplate[] = [
  {
    templateId: "execution-plan-approval",
    name: "执行计划审批",
    description: "用于审批 Mission 执行计划，支持批准、拒绝或请求修改",
    defaultType: "approve",
    defaultOptions: [
      { id: "approve", label: "Approve", action: "approve", severity: "info" },
      { id: "reject", label: "Reject", action: "reject", severity: "danger" },
      {
        id: "modify",
        label: "Modify",
        action: "request-info",
        severity: "warn",
        requiresComment: true,
      },
    ],
    defaultPrompt: "请审批以下执行计划",
    defaultAllowFreeText: true,
  },
  {
    templateId: "stage-gate",
    name: "阶段门禁",
    description: "阶段完成后的门禁检查，决定是否继续、暂停或终止",
    defaultType: "approve",
    defaultOptions: [
      { id: "proceed", label: "Proceed", action: "approve", severity: "info" },
      { id: "hold", label: "Hold", action: "escalate", severity: "warn" },
      { id: "abort", label: "Abort", action: "reject", severity: "danger" },
    ],
    defaultPrompt: "当前阶段已完成，请决定是否继续",
    defaultAllowFreeText: true,
  },
  {
    templateId: "risk-confirmation",
    name: "风险确认",
    description: "高风险操作前的确认，支持接受风险、缓解或上报",
    defaultType: "custom-action",
    defaultOptions: [
      {
        id: "accept-risk",
        label: "Accept Risk",
        action: "custom-action",
        severity: "danger",
      },
      {
        id: "mitigate",
        label: "Mitigate",
        action: "request-info",
        severity: "warn",
        requiresComment: true,
      },
      {
        id: "escalate",
        label: "Escalate",
        action: "escalate",
        severity: "info",
      },
    ],
    defaultPrompt: "检测到潜在风险，请确认处理方式",
    defaultAllowFreeText: true,
  },
] as const;
