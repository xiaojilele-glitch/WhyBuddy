/**
 * V5.1 架构图节点 ID → 产品时间线展示（docs/whybuddy_v5.1.md §二）
 * IM 操纵杆只标控制平面 / 能力池节点，不输出 REPORT 结论叙述。
 * 展示名与架构图 SVG / mermaid 一致（双语短标题）。
 */

import type { V5CapabilityId } from "./contracts.js";

export type V51ControlNodeId =
  | "CHAT"
  | "STATUS"
  | "INTAKE"
  | "INTERV"
  | "DEP"
  | "INVAL"
  | "STALE"
  | "RECOMP"
  | "BUDGET"
  | "ORCH"
  | "DLEDGER"
  | "CONTRACT"
  | "GCOV"
  | "BUS"
  | "PAIR"
  | "T_GATE"
  | "T_PROV"
  | "G_READY"
  | "G_CONFIRM"
  | "AWAIT"
  | "DONE"
  | "C_HAND";

export type V51CapabilityNodeId =
  | "C_PARSE"
  | "C_EVID"
  | "C_REPO"
  | "C_GAP"
  | "C_QEXP"
  | "C_RTGEN"
  | "C_RTCMP"
  | "C_RISK"
  | "C_SYN"
  | "C_REP"
  | "C_TREE"
  | "C_PREV"
  | "C_TOOL"
  | "C_DOC"
  | "C_ACC"
  | "C_PACK";

/** 架构图节点真实展示名（与 whybuddy_v5.1.md mermaid 对齐） */
export const V51_CONTROL_LABELS: Record<V51ControlNodeId, string> = {
  CHAT: "聊天框 = 操纵杆",
  STATUS: "状态条（唯一常驻）",
  INTAKE: "入站消息 / Message Intake（单门）",
  INTERV: "控制信号 / UserIntervention",
  DEP: "依赖图 / Dependency Graph",
  INVAL: "失效引擎 / Invalidation",
  STALE: "失效索引 / Stale Index",
  RECOMP: "重算 + 重新调度 / Recompute & Re-schedule",
  BUDGET: "预算闸 / Budget Gate",
  ORCH: "推演调度核 / Orchestrator",
  DLEDGER: "调度决策账 / Decision Ledger",
  CONTRACT: "覆盖率合约 / CoverageContract",
  GCOV: "覆盖率闸 / Coverage Gate",
  BUS: "能力调度总线 / Dispatch Bus",
  PAIR: "调度单元 = (capability, role) 对",
  T_GATE: "提交闸 / Commit Gate（commit-time·验真）",
  T_PROV: "provenance（commit-time）",
  G_READY: "就绪度闸 / Readiness",
  G_CONFIRM: "轻量确认闸 / Confirm",
  AWAIT: "待续 / Awaiting（环上歇脚点）",
  DONE: "交付完成 / Shipped",
  C_HAND: "交付包 / handoff",
};

export const V51_CAPABILITY_LABELS: Record<V51CapabilityNodeId, string> = {
  C_PARSE: "意图理解 / intent.parse",
  C_EVID: "证据检索 / evidence.search",
  C_REPO: "仓库深度解析 / repo.inspect",
  C_GAP: "澄清·缺失 / gap.ask",
  C_QEXP: "扩展·假设 / question.expand · assumption.validate",
  C_RTGEN: "路线生成 / route.generate",
  C_RTCMP: "路线对比 / route.compare",
  C_RISK: "反驳与风险 / risk.analyze · counter.argue · critique",
  C_SYN: "综合收敛 / synthesis.merge",
  C_REP: "报告生成 / report.write",
  C_TREE: "结构拆解 / structure.decompose → SPEC Tree",
  C_PREV: "效果预演 / scenario.simulate",
  C_TOOL: "工具 / mcp.call · skill.invoke",
  C_DOC: "文档生成 / document.draft",
  C_ACC: "验收 / acceptance",
  C_PACK: "指令包 / prompt.pack · execution.prepare",
};

const CAPABILITY_TO_V51: Partial<Record<V5CapabilityId, V51CapabilityNodeId>> = {
  "intent.parse": "C_PARSE",
  "intent.clarify": "C_GAP",
  "context.collect": "C_PARSE",
  "source.classify": "C_PARSE",
  "gap.ask": "C_GAP",
  "question.expand": "C_QEXP",
  "assumption.validate": "C_QEXP",
  "route.generate": "C_RTGEN",
  "route.compare": "C_RTCMP",
  "tradeoff.evaluate": "C_RTCMP",
  "scenario.simulate": "C_PREV",
  "execution.prepare": "C_PACK",
  "instruction.package": "C_PACK",
  "risk.analyze": "C_RISK",
  "counter.argue": "C_RISK",
  "critique.generate": "C_RISK",
  "argument.expand": "C_RISK",
  "rebuttal.resolve": "C_RISK",
  "evidence.search": "C_EVID",
  "repo.inspect": "C_REPO",
  "mcp.call": "C_TOOL",
  "skill.invoke": "C_TOOL",
  "memory.recall": "C_TOOL",
  "synthesis.merge": "C_SYN",
  "report.write": "C_REP",
  "document.draft": "C_DOC",
  "structure.decompose": "C_TREE",
  "traceability.matrix": "C_ACC",
};

const ROLE_DISPLAY: Record<string, string> = {
  产品: "产品",
  架构: "架构师",
  安全: "安全官",
  工程: "工程师",
  挑刺: "挑刺者",
  接地: "接地者",
  综合: "综合器",
  agent: "推演者",
};

export function capabilityToV51Node(capabilityId?: string): V51CapabilityNodeId {
  if (!capabilityId) return "C_PARSE";
  return (CAPABILITY_TO_V51 as Record<string, V51CapabilityNodeId>)[capabilityId] ?? "C_PARSE";
}

export function formatV51ControlStation(nodeId: V51ControlNodeId, detail?: string): {
  v51NodeId: string;
  title: string;
  detail?: string;
} {
  const label = V51_CONTROL_LABELS[nodeId];
  return {
    v51NodeId: nodeId,
    title: `${nodeId} · ${label}`,
    detail,
  };
}

export function formatV51CapabilityStation(
  capabilityId: string,
  roleId?: string
): { v51NodeId: string; title: string; detail: string } {
  const pool = capabilityToV51Node(capabilityId);
  const poolLabel = V51_CAPABILITY_LABELS[pool];
  const role = roleId ? ROLE_DISPLAY[roleId] || roleId : "推演者";
  return {
    v51NodeId: pool,
    title: `${pool} · ${poolLabel}`,
    detail: `BUS → PAIR · ${role}`,
  };
}

export function formatV51ChoseSummary(capabilityIds: string[]): string {
  const nodes = [...new Set(capabilityIds.map((c) => capabilityToV51Node(c)))];
  return nodes.map((n) => n).join("、") || "—";
}

/** 本回合是否已机械闭环（无需用户停泊） */
export function isAutonomousClosureReason(
  reason?: string | null
): boolean {
  return reason === "coverage_sufficient" || reason === "convergence_signal";
}