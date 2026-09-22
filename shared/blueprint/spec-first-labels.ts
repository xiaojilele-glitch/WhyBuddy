/**
 * spec-first 阶段的人话。对照 GitHub Actions 的 `name` vs `id`：
 * 机器 id 只走 SSE `stage`，左栏只许出现 name。
 *
 * ⚠ 2026-08-19 安康随访通：`specfirst.design` 已经在流增量
 * （design_language.stage=specfirst.design），前端 SPEC_FIRST_LLM_LABELS
 * 却只收了最初四步。humanLlmLabel 回落「LLM 正在执行 specfirst.design」，
 * activity-rows 再剥「LLM / 正在」→「执行 specfirst.design 1154 字」。
 *
 * 这份表必须和 Python `turn_narration._SPEC_FIRST_LABELS` /
 * `v5_full_driver._ENRICH_STAGE_LABELS` 同一套键。漏一个就是内部 id 上脸。
 */
import { CAPABILITY_PROCESS_LABELS } from "./capability-process-labels.js";

export const SPEC_FIRST_LIVE_LABELS: Record<string, string> = {
  "specfirst.spec": "起草规格：成功判据、需求节点与页面清单",
  "specfirst.design": "定这个应用的设计语言",
  "specfirst.pagescope": "判断这次要改哪几页",
  "specfirst.graphscope": "分析这次修改牵扯的范围",
  "specfirst.pages": "逐页画界面（并发）",
  "specfirst.structure": "从界面反推数据模型与关联关系",
  "specfirst.semantics": "推导权限、工作流与不变式",
  "specfirst.assemble": "汇合五系统模型并过结构闸",
  "specfirst.bind": "给界面接上数据",
};

export function humanReasoningStepLabel(idOrLabel: string): string {
  const raw = String(idOrLabel || "").trim();
  if (!raw) return "正在执行";
  // 工厂 hop 账本身份是 factory.{hop}。不许回落「正在执行 factory.structure」。
  if (raw.startsWith("factory.")) {
    const hop = raw.slice("factory.".length);
    if (hop === "closure") return "完整性检查与发布闭环";
    const hopSpec = SPEC_FIRST_LIVE_LABELS[`specfirst.${hop}`];
    if (hopSpec) return hopSpec;
  }
  const spec = SPEC_FIRST_LIVE_LABELS[raw];
  if (spec) return spec;
  const entry = (
    CAPABILITY_PROCESS_LABELS as Record<string, { liveLabel?: unknown }>
  )[raw];
  if (entry?.liveLabel) {
    return typeof entry.liveLabel === "function"
      ? (entry.liveLabel as (ctx: object) => string)({})
      : String(entry.liveLabel);
  }
  // enrich 阶段 SSE 的 label 已经是人话（_ENRICH_STAGE_LABELS），
  // 再套「正在执行」会变成「正在执行 定这个应用的设计语言」。
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  return `正在执行 ${raw}`;
}
