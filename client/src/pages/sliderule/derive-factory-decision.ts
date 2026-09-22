/**
 * 工厂选材决策投影（2026-09-04 阶段 2）。
 *
 * 数据早就写在 decisionLedger 里，产品面没人看——选材器通电之前
 * 全绿是靠 grep 日志才发现的。这里只投影，不发明：没有账本条目就
 * 返回 null，不许端出「按默认编排」这种假理由。
 */
import type {
  SchedulingDecision,
  V5SessionState,
} from "@shared/blueprint/v5-reasoning-state";
import { FACTORY_HOPS, hopFromFactoryCapability, type FactoryHop } from "@/lib/factory-hops";

/** 短标签。跟 Python `capability_plan.TOOL_LABELS` 同一套。 */
export const FACTORY_TOOL_SHORT_LABELS: Record<FactoryHop, string> = {
  spec: "起草 SPEC",
  pages: "页面生成",
  structure: "数据结构",
  bind: "权限工作流",
  closure: "完整性检查",
};

export type FactoryDecisionSource =
  | "llm"
  | "heuristic_fallback"
  | "local_heuristic";

export type FactoryDecisionView = {
  saw: string[];
  chose: string[];
  rationale: string;
  source: FactoryDecisionSource;
  /** 回落规则版。不许装成模型挑的。 */
  degraded: boolean;
  /** 1-based。账本 turnId=loop-0 → 1。解析不出就是 null。 */
  loopIndex: number | null;
  maxLoops: number | null;
};

export function publicFactoryName(raw: string): FactoryHop | null {
  const cap = String(raw || "").trim();
  const hop = hopFromFactoryCapability(cap);
  if (hop) return hop;
  return (FACTORY_HOPS as readonly string[]).includes(cap)
    ? (cap as FactoryHop)
    : null;
}

export function labelFactoryTools(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const hop = publicFactoryName(raw);
    if (!hop) continue;
    const label = FACTORY_TOOL_SHORT_LABELS[hop];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * 「规则给的」这一行：工厂工具翻成人话，**其余原样透出**。
 *
 * ⚠ 2026-09-04 真机 sr-…（餐饮合规那趟）：这一行在界面上是**空的**。
 *   点火那一跳账本里的 saw 是
 *   `evidence.search / risk.analyze / critique.generate / report.write /
 *   appbundle.runtimeClosure`——全是作文能力 id，不是工厂工具，
 *   被 labelFactoryTools 一个不剩地滤掉 → `saw.length === 0` → 整行不渲染。
 *
 *   后果：**最有意思的那个决策只显示一半**。模型把整套作文计划换成了工厂
 *   四件，用户只看得见「这一跳 起草 SPEC、页面生成…」，看不见它拒绝了什么，
 *   也就无从判断这次换得对不对——而"能看见模型拒绝了什么"正是阶段 2
 *   要给的东西。
 *
 * ⚠ 故意**不**为作文能力新造一张中文表：本仓有「第 12 处手抄」的前科
 *   （v5_full_driver:894 那条注释），手抄表迟早跟源头漂移，而且漂了不报错。
 *   原样透出 `evidence.search` 这种 id 已经够用户看懂被拒的是什么，
 *   且没有会漂移的第二份真相。
 */
export function labelDecisionItems(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const cap = String(raw || "").trim();
    if (!cap) continue;
    const hop = publicFactoryName(cap);
    const label = hop ? FACTORY_TOOL_SHORT_LABELS[hop] : cap;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function loopIndexFromTurnId(turnId: string | undefined): number | null {
  const m = /^loop-(\d+)$/.exec(String(turnId || "").trim());
  if (!m) return null;
  return Number(m[1]) + 1;
}

function isFactoryPickEntry(d: SchedulingDecision): boolean {
  const id = String(d.id || "");
  if (id.includes("agentic-pick")) return true;
  if (d.source === "llm" || d.source === "heuristic_fallback") {
    return Boolean(d.rationale || (d.chose && d.chose.length));
  }
  return false;
}

/**
 * 最近一条工厂选材。没有就 null——名单里有 decisionLedger 不等于埋点在。
 */
export function deriveFactoryDecisionView(
  state: Pick<V5SessionState, "decisionLedger" | "runConditions"> | null | undefined,
  opts?: { maxLoops?: number | null }
): FactoryDecisionView | null {
  const ledger = state?.decisionLedger || [];
  let entry: SchedulingDecision | undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (isFactoryPickEntry(ledger[i])) {
      entry = ledger[i];
      break;
    }
  }
  if (!entry) return null;
  const rationale = String(entry.rationale || "").trim();
  const chose = labelFactoryTools(entry.chose || []);
  if (!rationale && chose.length === 0) return null;
  const source: FactoryDecisionSource =
    entry.source === "heuristic_fallback" || entry.source === "local_heuristic"
      ? entry.source
      : "llm";
  const fallbackCondition = (state?.runConditions || []).some(
    (c: { reason?: string }) => c.reason === "AgenticPickFallback"
  );
  const degraded = source !== "llm" || fallbackCondition;
  return {
    saw: labelDecisionItems(entry.saw || []),
    chose,
    rationale,
    source: degraded && source === "llm" ? "heuristic_fallback" : source,
    degraded,
    loopIndex: loopIndexFromTurnId(entry.turnId),
    maxLoops:
      typeof opts?.maxLoops === "number" && opts.maxLoops > 0
        ? opts.maxLoops
        : null,
  };
}
