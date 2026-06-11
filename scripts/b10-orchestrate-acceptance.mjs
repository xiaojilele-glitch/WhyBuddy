/**
 * R1-B10 acceptance — live executeOrchestratePlan + local heuristic baseline.
 * Usage: pnpm exec tsx scripts/b10-orchestrate-acceptance.mjs [--degrade]
 */
import dotenv from "dotenv";
dotenv.config();

import { pickNextCapabilities } from "../shared/blueprint/whybuddy-pick-heuristic.js";
import { executeOrchestratePlan } from "../server/whybuddy/orchestrate-plan.js";

const GOAL = "做一个权限管理系统（支持 RBAC + 数据范围）";

const CASES = [
  {
    id: 1,
    userText: "这个方案上线后运维要投入多少人力?",
    llmHint: "tradeoff.evaluate / scenario.simulate",
  },
  {
    id: 2,
    userText: "如果数据量翻十倍会发生什么",
    llmHint: "scenario.simulate / risk.analyze",
  },
  {
    id: 3,
    userText: "用户第一次打开会看到什么",
    llmHint: "ux.preview / outcome.visualize",
  },
  {
    id: 4,
    userText: "我担心就我一个人做不完",
    llmHint: "assumption.validate / structure.decompose",
  },
  {
    id: 5,
    userText: "竞品是怎么解决这个问题的",
    llmHint: "evidence.search",
  },
];

function freshState(suffix) {
  return {
    sessionId: `b10-${suffix}-${Date.now()}`,
    goal: { text: GOAL, status: "needs_refinement" },
    artifacts: [],
    staleArtifactIds: [],
    decisionLedger: [],
    capabilityRuns: [],
    openQuestions: [],
    conversation: [],
    gates: [],
    dependencyGraph: [],
    risks: [],
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rows = [];
  for (const c of CASES) {
    const state = freshState(`case-${c.id}`);
    const heuristic = pickNextCapabilities(state, c.userText).map((p) => p.capabilityId);
    const t0 = Date.now();
    const body = await executeOrchestratePlan({
      state,
      turnId: `b10-${c.id}`,
      userText: c.userText,
    });
    rows.push({
      ...c,
      heuristic,
      elapsedMs: Date.now() - t0,
      source: body.source,
      reason: body.reason,
      chose: body.selected.map((s) => s.capabilityId),
      rationale: body.rationale,
      usage: body.usage,
    });
    await sleep(1500);
  }

  let degrade = null;
  if (process.argv.includes("--degrade")) {
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    degrade = await executeOrchestratePlan({
      state: freshState("degrade"),
      turnId: "b10-degrade",
      userText: "随便发一句看看降级",
    });
    if (orig) process.env.LLM_API_KEY = orig;
    else delete process.env.LLM_API_KEY;
    if (origOpen) process.env.OPENAI_API_KEY = origOpen;
  }

  console.log(JSON.stringify({ goal: GOAL, hasKey: Boolean(process.env.LLM_API_KEY), rows, degrade }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});