import type { V5CapabilityId } from "./contracts.js";
import { ALL_V5_CAPABILITIES } from "./contracts.js";
import type { V5RoleId } from "./whybuddy-role-map.js";

/** One-line Chinese descriptions for LLM orchestration prompts (≤30 chars each). */
export const CAPABILITY_DESCRIPTIONS: Record<V5CapabilityId, string> = {
  "intent.parse": "解析用户目标与意图边界",
  "intent.clarify": "澄清模糊需求与开放问题",
  "context.collect": "收集会话与背景上下文",
  "source.classify": "归类信息来源与可信度",
  "gap.ask": "定位关键信息缺口并追问",
  "question.expand": "展开子问题与验证点",
  "assumption.validate": "校验隐含假设是否成立",
  "route.generate": "生成多条可行技术路线",
  "route.compare": "对比路线优劣与适用场景",
  "tradeoff.evaluate": "评估权衡与取舍结论",
  "structure.decompose": "拆解目标为结构化树",
  "document.draft": "起草规格或说明文档",
  "requirement.write": "编写可验收的需求条目",
  "design.write": "编写方案与设计说明",
  "task.write": "拆解可执行任务清单",
  "scenario.simulate": "模拟场景与关键路径",
  "ux.preview": "生成交互与体验预览",
  "outcome.visualize": "可视化预期效果与产出",
  "instruction.package": "打包可执行指令与提示",
  "execution.prepare": "准备落地执行的前置条件",
  "evidence.search": "检索外部证据与参考",
  "repo.inspect": "检查代码仓库工程结构",
  "mcp.call": "调用外部 MCP 工具",
  "skill.invoke": "调用已注册技能能力",
  "risk.analyze": "分析风险、影响与缓解",
  "counter.argue": "提出反方观点与挑刺",
  "argument.expand": "展开论证链与支撑",
  "critique.generate": "生成结构化批评意见",
  "rebuttal.resolve": "消解分歧与回应批评",
  "synthesis.merge": "综合多方结论收敛",
  "report.write": "撰写可行性/证据报告",
  "memory.recall": "回忆历史会话相关信息",
  "traceability.matrix": "构建需求追溯矩阵",
  "handoff.package": "打包工程交接材料",
};

/** Default V5 role per capability (matches heuristic picker). */
export const CAPABILITY_DEFAULT_ROLES: Record<V5CapabilityId, V5RoleId> = {
  "intent.parse": "产品",
  "intent.clarify": "产品",
  "context.collect": "产品",
  "source.classify": "产品",
  "gap.ask": "产品",
  "question.expand": "产品",
  "assumption.validate": "安全",
  "route.generate": "架构",
  "route.compare": "工程",
  "tradeoff.evaluate": "工程",
  "structure.decompose": "架构",
  "document.draft": "综合",
  "requirement.write": "产品",
  "design.write": "架构",
  "task.write": "工程",
  "scenario.simulate": "工程",
  "ux.preview": "工程",
  "outcome.visualize": "工程",
  "instruction.package": "工程",
  "execution.prepare": "工程",
  "evidence.search": "接地",
  "repo.inspect": "工程",
  "mcp.call": "工程",
  "skill.invoke": "工程",
  "risk.analyze": "安全",
  "counter.argue": "挑刺",
  "argument.expand": "挑刺",
  "critique.generate": "挑刺",
  "rebuttal.resolve": "综合",
  "synthesis.merge": "综合",
  "report.write": "综合",
  "memory.recall": "接地",
  "traceability.matrix": "工程",
  "handoff.package": "工程",
};

export function assertFullCapabilityCatalogCoverage(): void {
  for (const id of ALL_V5_CAPABILITIES) {
    if (!CAPABILITY_DESCRIPTIONS[id]) {
      throw new Error(`Missing CAPABILITY_DESCRIPTIONS entry for ${id}`);
    }
    if (!CAPABILITY_DEFAULT_ROLES[id]) {
      throw new Error(`Missing CAPABILITY_DEFAULT_ROLES entry for ${id}`);
    }
  }
}