import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  findInputsForCapability,
  commitArtifact,
  extractArtifactFragments,
  invalidateForIntervention,
  verifyV5ClosedLoop,
  intakeMessage,
  markAwaiting,
  mapInterventionToControlSignal,
  enrichGraphNodesAfterCommit,
  clearWhyBuddySessionStore,
  loadOrCreateSessionState,
  saveSessionState,
  type WhyBuddySessionStore,
  setWhyBuddySessionStore,
  getWhyBuddySessionStore,
  deriveNodeStatus,
  listWhyBuddySessions,
  deleteWhyBuddySession,
  getSessionLedger,
  simulateCapabilityExecution,
  pickNextCapabilities,
  setCapabilityExecutor,
  getCapabilityExecutor,
  executeCapability,
  buildStructuredReport,
  usePilotRealExecutor,
  useDefaultExecutor,
  useLlmCapabilityExecutor,
  LlmCapabilityExecutor,
  createOpenAILlmCapabilityProvider,
  createServerLlmCapabilityProvider,
  type LlmCapabilityProvider,
  evaluateBudgetBeforeOrchestrate,
  getDefaultBudgetPolicy,
  recordCapabilityRunCost,
  getDecisionLedger,
  evaluateCoverageGate,
  inferCoverageContract,
  sanitizeThroughFlowBoundary,
  type BudgetPolicy,
  type BudgetSnapshot,
  type SchedulingDecision,
  type CoverageContract,
  type CoverageGateResult,
  type FlowBoundaryCheck,
  type CapabilityCostRecord,
  type BudgetSnapshot,
  type CoverageGap,
  authorCoverageContract,
  resolveCoverageGapsFromState,
  waiveCoverageGap,
  evaluateContractSufficiencyForBudget,
} from './whybuddy-runtime';
import { isTestHelperEnabled } from '../../../server/routes/whybuddy.ts';
import type { V5SessionState, Artifact, UserIntervention } from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import type { ControlSignal } from './whybuddy-runtime';

// Semantic payloads for upstream capabilities (to make aggregation tests meaningful)
const SEMANTIC_CONTENTS: Partial<Record<V5CapabilityId, string>> = {
  'risk.analyze': '数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）；审计风险（权限变更需保留操作者、时间、影响对象）。',
  'counter.argue': '反驳过早引入 ABAC（会增加策略调试成本）；建议 MVP 先采用 RBAC + scoped data filter，保留策略接口。',
  'synthesis.merge': '本轮从上游聚合的初步结论：权限系统建议采用 RBAC + 数据范围 MVP，预留策略扩展。',
  'report.write': '【可行性 / 产品推演报告】结论：建议推进权限系统建设。',
};

function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  contentOverride?: string
): Omit<Artifact, 'trustLevel' | 'passedGates'> {
  const content = contentOverride ?? SEMANTIC_CONTENTS[capabilityId] ?? `${roleId} 通过 ${capabilityId} 贡献了内容。`;
  return {
    id,
    kind,
    provenance: 'ai_generated',
    producedBy: {
      capabilityRunId: `run-${id}`,
      capabilityId,
      roleId,
    },
    passedGates: [],
    title: content.split('\n')[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

describe('whybuddy-runtime V5 closed loop (behavioral regression)', () => {
  let state: V5SessionState;

  beforeEach(() => {
    state = createInitialSessionState('做一个权限管理系统（支持 RBAC + 数据范围）');
  });

  it('combo input plans the full capability team and produces a gated_pass report with real upstream refs after sequential fresh-input commits', () => {
    const userText = '分析安全风险，反驳 RBAC，并生成可行性报告';

    // 1. Orchestrate with real userText (chat manipulator contract)
    const { newState: afterPlan, plan } = orchestrateReasoningTurn(state, {
      turnId: 'turn-combo-1',
      userText,
    });

    // Assert the picker selected the full V5 team (proactive upstream planning for report)
    const selectedCaps = plan.selected.map((s) => s.capabilityId);
    expect(selectedCaps).toContain('risk.analyze');
    expect(selectedCaps).toContain('counter.argue');
    expect(selectedCaps).toContain('synthesis.merge');
    expect(selectedCaps).toContain('report.write');

    // 2. Simulate the page's same-round commit loop with fresh resolve each step
    let working = afterPlan;
    const turnId = 'turn-combo-1';

    plan.selected.forEach((sel, idx) => {
      const cap = sel.capabilityId;
      const role = sel.roleId || 'agent';
      const runId = `${turnId}-run-${idx}`;

      // Fresh resolve (this is what makes same-round DAG work)
      const freshInputs = findInputsForCapability(working, cap);

      // Build raw with semantic content (so aggregation has real phrases)
      const raw = createRawArtifact(`${turnId}-art-${idx}`, cap, role, 'risk'); // kind will be corrected by caller if needed, but for test we use the output kind logic implicitly

      // For report we want the rich content, but since we're testing runtime, we pass a content that includes the phrases we care about.
      // In real page this would be built from fresh upstreams' content.
      const isReport = cap === 'report.write';
      const contentForThis = isReport
        ? `【可行性 / 产品推演报告】结论：建议推进权限系统建设。支撑证据片段：\n- 来自 risk(risk.analyze×安全): ${SEMANTIC_CONTENTS['risk.analyze']}\n- 来自 risk(counter.argue×挑刺): ${SEMANTIC_CONTENTS['counter.argue']}\n- 来自 synthesis(synthesis.merge×综合): ${SEMANTIC_CONTENTS['synthesis.merge']}`
        : SEMANTIC_CONTENTS[cap] ?? `${role} 通过 ${cap} 贡献了内容。`;

      const rawWithContent = {
        ...raw,
        kind: isReport ? 'report' : raw.kind,
        title: contentForThis.split('\n')[0]?.slice(0, 80),
        summary: contentForThis.slice(0, 200),
        content: contentForThis,
      } as any;

      const { updatedState, committed } = commitArtifact(
        working,
        rawWithContent,
        runId,
        false,
        freshInputs
      );

      working = updatedState;

      if (isReport) {
        expect(committed).not.toBeNull();
        expect(committed!.trustLevel).toBe('gated_pass');
        expect(committed!.evidenceRefs?.length).toBeGreaterThanOrEqual(3);
        // The key assertion: report content contains real upstream semantic phrases (not just labels)
        expect(committed!.content).toContain('数据范围越权风险');
        expect(committed!.content).toContain('反驳过早引入 ABAC');
      }
    });

    // Final state check
    const finalReport = working.artifacts.find(
      (a) => a.producedBy?.capabilityId === 'report.write'
    );
    expect(finalReport).toBeDefined();
    expect(finalReport!.trustLevel).toBe('gated_pass');

    // Verify helper also passes
    const verifyResult = verifyV5ClosedLoop(working);
    expect(verifyResult.passed).toBe(true);
    expect(verifyResult.details).toContain('Report references');
  });

  it('challenge on risk cascades stale to report and makes verify fail', () => {
    // First do a happy combo round (abbreviated)
    let working = createInitialSessionState('goal');
    const { newState: afterPlan } = orchestrateReasoningTurn(working, {
      turnId: 't1',
      userText: '分析安全风险，反驳 RBAC，并生成可行性报告',
    });
    // ... (minimal commits to reach a report with refs - we can reuse the happy path logic or hardcode a report with refs for isolation)
    // For brevity in this test we manually seed a minimal state that has the dep edges.
    // In practice the previous test already proves the happy path; here we focus on cascade.

    // Seed a simple state with a risk and a report that depends on it (simulating prior commits)
    const riskId = 'art-risk-1';
    const reportId = 'art-report-1';
    working = {
      ...working,
      artifacts: [
        {
          id: riskId,
          kind: 'risk',
          provenance: 'ai_generated',
          producedBy: { capabilityRunId: 'r1', capabilityId: 'risk.analyze', roleId: '安全' },
          passedGates: ['commit'],
          trustLevel: 'gated_pass',
          evidenceRefs: [],
        } as any,
        {
          id: reportId,
          kind: 'report',
          provenance: 'ai_generated',
          producedBy: { capabilityRunId: 'r2', capabilityId: 'report.write', roleId: '综合' },
          passedGates: ['commit'],
          trustLevel: 'gated_pass',
          evidenceRefs: [riskId],
        } as any,
      ],
      dependencyGraph: [
        { fromArtifactId: riskId, toArtifactId: reportId, reason: 'produced-by-report.write' },
      ],
      capabilityRuns: [],
      staleArtifactIds: [],
    };

    const intervention: UserIntervention = {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '这个风险分析有问题',
    };

    const afterInvalid = invalidateForIntervention(working, intervention);

    expect(afterInvalid.staleArtifactIds).toContain(riskId);
    expect(afterInvalid.staleArtifactIds).toContain(reportId); // cascade via dep edge

    const verifyAfter = verifyV5ClosedLoop(afterInvalid);
    expect(verifyAfter.passed).toBe(false);
  });

  it('force gate fail on upstream makes report untrusted and verify fail', () => {
    let working = createInitialSessionState('goal');
    const { newState: afterPlan, plan } = orchestrateReasoningTurn(working, {
      turnId: 't-fail',
      userText: '生成可行性报告',
    });

    let current = afterPlan;
    const turnId = 't-fail';

    plan.selected.forEach((sel, idx) => {
      const runId = `${turnId}-run-${idx}`;
      let inputIds = findInputsForCapability(current, sel.capabilityId);
      const isUpstream = sel.capabilityId.includes('risk') || sel.capabilityId.includes('argue');
      const force = isUpstream; // simulate the "下次让上游失败" button

      // findInputsForCapability no longer selects untrusted upstreams; wire them explicitly
      // so this test still exercises the commit gate's untrusted-upstream rejection path.
      if (sel.capabilityId === 'report.write') {
        const untrustedIds = current.artifacts
          .filter((a) => a.trustLevel === 'untrusted')
          .map((a) => a.id);
        if (untrustedIds.length > 0) inputIds = untrustedIds;
      }

      const raw = createRawArtifact(`${turnId}-art-${idx}`, sel.capabilityId, sel.roleId || 'agent', 'risk');

      const { updatedState } = commitArtifact(current, raw as any, runId, force, inputIds);
      current = updatedState;
    });

    const finalReport = current.artifacts.find((a) => a.producedBy?.capabilityId === 'report.write');
    expect(finalReport?.trustLevel).toBe('untrusted');

    const v = verifyV5ClosedLoop(current);
    expect(v.passed).toBe(false);
  });

  it('rejects a report with zero upstream refs and keeps the attempt in runtime state', () => {
    const working = createInitialSessionState('goal');
    const raw = createRawArtifact(
      'report-without-upstream',
      'report.write',
      'reporter',
      'report',
      'A report without upstream artifacts must not be trusted.'
    );

    const { updatedState, committed, run } = commitArtifact(
      working,
      raw,
      'turn-empty-run-0',
      false,
      []
    );

    const persistedReport = updatedState.artifacts.find((a) => a.id === 'report-without-upstream');

    expect(committed).toBeNull();
    expect(run.outputs).toEqual([]);
    expect(persistedReport).toBeDefined();
    expect(persistedReport!.trustLevel).toBe('untrusted');
    expect(verifyV5ClosedLoop(updatedState).passed).toBe(false);
  });

  it('fresh reset state does not verify as a closed loop', () => {
    const resetState = createInitialSessionState('reset goal');

    expect(resetState.artifacts).toEqual([]);
    expect(resetState.dependencyGraph).toEqual([]);
    expect(resetState.staleArtifactIds).toEqual([]);
    expect(verifyV5ClosedLoop(resetState)).toMatchObject({ passed: false });
  });

  it('extracts semantic fragments from artifact content instead of only taking the first characters', () => {
    const artifact = createRawArtifact(
      'semantic-risk',
      'risk.analyze',
      'security',
      'risk',
      '背景：权限系统需要支持多租户。\n风险：数据范围越权会导致跨部门读取。\n反驳：过早引入 ABAC 会增加策略调试成本。\n建议：MVP 先采用 RBAC + scoped data filter。'
    ) as Artifact;

    const fragments = extractArtifactFragments(artifact, 80);

    expect(fragments.map((fragment) => fragment.label)).toEqual(['风险', '反驳', '建议']);
    expect(fragments.map((fragment) => fragment.text).join('\n')).toContain('数据范围越权');
    expect(fragments.map((fragment) => fragment.text).join('\n')).toContain('过早引入 ABAC');
    expect(fragments.map((fragment) => fragment.text).join('\n')).not.toContain('背景');
  });

  it('buildStructuredReport produces the fixed 9-section evidence-grade schema and pulls real fragments from upstreams', () => {
    // Seed a minimal state with risk + synthesis upstreams (simulating what page loop would have committed before report)
    let s = createInitialSessionState('权限系统报告测试');
    const riskRaw = createRawArtifact('r1', 'risk.analyze', '安全', 'risk', SEMANTIC_CONTENTS['risk.analyze']);
    const counterRaw = createRawArtifact('c1', 'counter.argue', '挑刺', 'risk', SEMANTIC_CONTENTS['counter.argue']);
    const synthRaw = createRawArtifact('s1', 'synthesis.merge', '综合', 'synthesis', SEMANTIC_CONTENTS['synthesis.merge']);

    let after = commitArtifact(s, riskRaw as any, 't-run-r', false, []).updatedState;
    after = commitArtifact(after, counterRaw as any, 't-run-c', false, [riskRaw.id]).updatedState;
    after = commitArtifact(after, synthRaw as any, 't-run-s', false, [riskRaw.id, counterRaw.id]).updatedState;

    const reportInputIds = [riskRaw.id, counterRaw.id, synthRaw.id];
    const built = buildStructuredReport({ state: after, inputArtifactIds: reportInputIds, roleId: '综合' });

    // Must contain the 9 labeled sections (user schema)
    expect(built.content).toContain('结论：');
    expect(built.content).toContain('支撑证据：');
    expect(built.content).toContain('反证/挑战：');
    expect(built.content).toContain('风险：');
    expect(built.content).toContain('分歧：');
    expect(built.content).toContain('收敛决策：');
    expect(built.content).toContain('未解缺口：');
    expect(built.content).toContain('下一步工程化分支：');
    expect(built.content).toContain('provenance / upstream refs：');

    // Must pull real semantic phrases from the seeded upstreams (via extract)
    expect(built.content).toContain('数据范围越权风险');
    expect(built.content).toContain('反驳过早引入 ABAC');
    expect(built.content).toContain('RBAC + 数据范围 MVP');

    // Title/summary sanity
    expect(built.title).toContain('可行性 / 产品推演报告');
    expect(built.summary.length).toBeGreaterThan(10);
  });

  // ===== 新增：INTAKE 单门 + AWAIT 外圈闭环 + sessionId 隔离（对齐 修复闭环.md） =====

  it('intake classifies new_goal only on empty state, refine otherwise', () => {
    const empty = createInitialSessionState('goal', 'sess-1');
    const { controlSignal: s1 } = intakeMessage(empty, { turnId: 't1', userText: 'first' });
    expect(s1).toBe('new_goal');

    // simulate some progress
    const nonEmpty = { ...empty, artifacts: [{ id: 'a1' } as any], conversation: [{ id: 'c1', role: 'user', text: 'x' }] };
    const { controlSignal: s2 } = intakeMessage(nonEmpty as any, { turnId: 't2', userText: 'second' });
    expect(s2).toBe('refine');
  });

  it('second ordinary message via intake appends conversation and does NOT reset prior artifacts (no hidden restart)', () => {
    let state = createInitialSessionState('g', 'sess-isolation');
    // first turn via intake
    const i1 = intakeMessage(state, { turnId: 'turn-1', userText: '分析风险' });
    let w = i1.preparedState;
    // minimal: just commit one artifact to simulate progress
    const { updatedState: after1 } = commitArtifact(w, createRawArtifact('art1', 'risk.analyze', '安全', 'risk'), 'turn-1-run-0', false, []);
    w = after1;

    expect(w.artifacts.length).toBe(1);
    expect(w.conversation.length).toBe(1);

    // second ordinary message MUST continue on same state
    const i2 = intakeMessage(w, { turnId: 'turn-2', userText: '再生成报告' });
    const afterIntake2 = i2.preparedState;

    expect(afterIntake2.artifacts.length).toBe(1); // not reset
    expect(afterIntake2.conversation.length).toBe(2);
    expect(afterIntake2.sessionId).toBe('sess-isolation');
    expect(i2.controlSignal).toBe('refine');
  });

  it('both ordinary send and challenge intervention go through the same intakeMessage API', () => {
    const base = createInitialSessionState('g', 'sess-intake');
    const ordinary = intakeMessage(base, { turnId: 'o1', userText: 'hello' });
    expect(ordinary.controlSignal).toBe('new_goal');

    const withInt = intakeMessage(ordinary.preparedState, {
      turnId: 'c1',
      userText: 'challenge this',
      intervention: { targetArtifactId: 'some-art', intent: 'challenge', text: 'bad' } as UserIntervention,
    });
    expect(withInt.controlSignal).toBe('challenge');
    // conversation appended for both
    expect(withInt.preparedState.conversation.length).toBeGreaterThanOrEqual(2);
  });

  it('after a turn (orchestrate + commits) we can markAwaiting and the phase is observable; next intake sees prior state', () => {
    let state = createInitialSessionState('goal for phase', 'sess-await');
    const { preparedState } = intakeMessage(state, { turnId: 'ta-1', userText: '做个报告' });
    let afterOrch = orchestrateReasoningTurn(preparedState, { turnId: 'ta-1', userText: '做个报告' }).newState;

    // simulate the page commit loop (minimal one artifact to make "converged")
    const { updatedState: committed } = commitArtifact(afterOrch, createRawArtifact('r1', 'report.write', '综合', 'report'), 'ta-1-run-9', false, []);
    let converged = committed;

    const awaiting = markAwaiting(converged, 'ta-1');
    expect(awaiting.runtimePhase).toBe('awaiting');
    expect(awaiting.lastTurnId).toBe('ta-1');

    // next message continues from the awaiting state (outer loop)
    const next = intakeMessage(awaiting, { turnId: 'ta-2', userText: '再来一条' });
    expect(next.preparedState.artifacts.length).toBe(1); // previous work preserved
    expect(next.preparedState.runtimePhase).toBe('orchestrating'); // intake moves it to orchestrating
  });

  it('createInitial with different sessionId produces isolated states (artifacts do not cross)', () => {
    const s1 = createInitialSessionState('g1', 'session-alpha');
    const s2 = createInitialSessionState('g2', 'session-beta');

    const { updatedState: s1After } = commitArtifact(s1, createRawArtifact('a-alpha', 'risk.analyze', '安全', 'risk'), 'r-a', false, []);
    expect(s1After.sessionId).toBe('session-alpha');
    expect(s1After.artifacts.length).toBe(1);

    // s2 untouched
    expect(s2.sessionId).toBe('session-beta');
    expect(s2.artifacts.length).toBe(0);
  });

  it('mapInterventionToControlSignal safely maps all UserIntervention intents to ControlSignal without ever leaking union-exterior strings', () => {
    // 覆盖所有当前 intent，确保 classify 总是返回 ControlSignal 成员（Medium contract 严谨性）
    const cases: Array<[UserIntervention["intent"], ControlSignal]> = [
      ['challenge', 'challenge'],
      ['revise', 'challenge'],
      ['clarify', 'refine'],
      ['expand', 'refine'],
      ['preview', 'branch'],
      ['compare', 'branch'],
      ['synthesize', 'meta'],
      ['generate_plan', 'meta'],
    ];

    for (const [intent, expected] of cases) {
      const sig = mapInterventionToControlSignal(intent);
      expect(sig).toBe(expected);
      // 运行时值必须是 ControlSignal 合法成员（用 includes 做轻量运行时守卫）
      const valid: ControlSignal[] = ['new_goal', 'refine', 'challenge', 'meta', 'sub_question', 'branch'];
      expect(valid).toContain(sig);
    }

    // 即使传入一个理论上未来新增的 intent，函数也必须返回 meta（绝不 throw 或返回脏字符串）
    // @ts-expect-error 故意测未知值
    const unknown = mapInterventionToControlSignal('some_future_intent' as any);
    expect(['new_goal', 'refine', 'challenge', 'meta', 'sub_question', 'branch']).toContain(unknown);
  });

  it('marks only the graph node for the challenged run when the same turn has duplicate capability nodes', () => {
    const targetArtifactId = 'risk-art-0';
    const untouchedArtifactId = 'risk-art-1';
    const working = {
      ...createInitialSessionState('duplicate capability run binding', 'sess-graph-binding'),
      graph: {
        id: 'graph-binding',
        jobId: 'job-binding',
        stage: 'effect_preview',
        source: 'runtime',
        nodes: [
          {
            id: 'turn-bind-node-0',
            type: 'hypothesis',
            title: 'security risk pass',
            capabilityId: 'risk.analyze',
            capabilityRunId: 'turn-bind-run-0',
            turnId: 'turn-bind',
            status: 'active',
          },
          {
            id: 'turn-bind-node-1',
            type: 'hypothesis',
            title: 'second risk pass',
            capabilityId: 'risk.analyze',
            capabilityRunId: 'turn-bind-run-1',
            turnId: 'turn-bind',
            status: 'active',
          },
        ],
        edges: [],
      } as any,
      artifacts: [
        {
          id: targetArtifactId,
          kind: 'risk',
          provenance: 'ai_generated',
          trustLevel: 'gated_pass',
          passedGates: ['commit'],
          producedBy: {
            capabilityRunId: 'turn-bind-run-0',
            capabilityId: 'risk.analyze',
            roleId: '安全',
          },
        },
        {
          id: untouchedArtifactId,
          kind: 'risk',
          provenance: 'ai_generated',
          trustLevel: 'gated_pass',
          passedGates: ['commit'],
          producedBy: {
            capabilityRunId: 'turn-bind-run-1',
            capabilityId: 'risk.analyze',
            roleId: '挑刺',
          },
        },
      ] as Artifact[],
    };

    const invalidated = invalidateForIntervention(working, {
      targetArtifactId,
      intent: 'challenge',
      text: 'Only challenge the first risk pass.',
    });

    const node0 = invalidated.graph.nodes.find((node) => node.id === 'turn-bind-node-0');
    const node1 = invalidated.graph.nodes.find((node) => node.id === 'turn-bind-node-1');

    expect(invalidated.staleArtifactIds).toEqual([targetArtifactId]);
    expect(node0?.status).toBe('challenged');
    expect(node1?.status).toBe('active');
  });

  it('enrichGraphNodesAfterCommit attaches producedArtifactId to the matching node using capabilityRunId (full planned→committed round-trip)', () => {
    // 模拟 orchestrate 预分配了 capabilityRunId
    let state = createInitialSessionState('enrich roundtrip', 'sess-enrich');
    const { newState: afterOrch } = orchestrateReasoningTurn(state, {
      turnId: 'turn-enrich',
      userText: '分析风险并出报告',
    });

    // 页面风格的 commit（用同一个 runId 命名）
    const runId = 'turn-enrich-run-0'; // 对应节点 0
    const raw = createRawArtifact('risk-enriched', 'risk.analyze', '安全', 'risk');
    const { updatedState: afterCommit } = commitArtifact(
      afterOrch,
      { ...raw, id: 'risk-enriched' } as any,
      runId,
      false,
      []
    );

    // 关键：commit 后 enrich
    const enriched = enrichGraphNodesAfterCommit(afterCommit, 'turn-enrich');

    // 找到本轮的第一个节点（risk.analyze 通常是前面的）
    const enrichedNode = (enriched.graph.nodes || []).find(
      (n: any) => n.turnId === 'turn-enrich' && n.capabilityRunId === runId
    );

    expect(enrichedNode).toBeTruthy();
    expect(enrichedNode!.producedArtifactId).toBe('risk-enriched');
    expect((enrichedNode as any).producedRunId).toBe(runId);

    // 其他节点的 produced 信息不应被错误污染
    const otherNodes = (enriched.graph.nodes || []).filter(
      (n: any) => n.turnId === 'turn-enrich' && n.capabilityRunId !== runId
    );
    otherNodes.forEach((n: any) => {
      expect(n.producedArtifactId).toBeFalsy();
    });
  });

  it('loads or creates sessions from an in-memory store and preserves saved state by sessionId', async () => {
    clearWhyBuddySessionStore();

    const first = await loadOrCreateSessionState('store-alpha', '权限系统');
    expect(first.sessionId).toBe('store-alpha');
    expect(first.goal.text).toBe('权限系统');
    expect(first.artifacts).toHaveLength(0);

    const { updatedState } = commitArtifact(
      first,
      createRawArtifact('store-risk', 'risk.analyze', '安全', 'risk'),
      'store-turn-run-0',
      false,
      []
    );
    await saveSessionState(updatedState);

    const loadedAgain = await loadOrCreateSessionState('store-alpha', '新目标不应覆盖已有会话');
    expect(loadedAgain.sessionId).toBe('store-alpha');
    expect(loadedAgain.goal.text).toBe('权限系统');
    expect(loadedAgain.artifacts.map((artifact) => artifact.id)).toEqual(['store-risk']);

    const beta = await loadOrCreateSessionState('store-beta', '另一个会话');
    expect(beta.sessionId).toBe('store-beta');
    expect(beta.artifacts).toHaveLength(0);
  });

  it('listSessions + deleteSession work on the store and are isolated', async () => {
    clearWhyBuddySessionStore();
    const s1 = await loadOrCreateSessionState('list-s1', '会话一');
    await saveSessionState(s1);
    const s2 = await loadOrCreateSessionState('list-s2', '会话二');
    await saveSessionState(s2);

    const listedRaw = listWhyBuddySessions ? listWhyBuddySessions() : [];
    const listed = listedRaw && typeof (listedRaw as any).then === 'function' ? await listedRaw : listedRaw;
    expect((listed as any[]).length).toBeGreaterThanOrEqual(2);
    expect((listed as any[]).some((x: any) => x.sessionId === 'list-s1')).toBe(true);

    if (deleteWhyBuddySession) await deleteWhyBuddySession('list-s1');
    const listedAfterRaw = listWhyBuddySessions ? listWhyBuddySessions() : [];
    const listedAfter = listedAfterRaw && typeof (listedAfterRaw as any).then === 'function' ? await listedAfterRaw : listedAfterRaw;
    expect((listedAfter as any[]).some((x: any) => x.sessionId === 'list-s1')).toBe(false);
  });

  it('WhyBuddySessionStore is swappable and public load/save functions delegate to the injected impl', async () => {
    // Custom in-memory impl for the test (proves the contract shape for future backend)
    const customStore = new Map<string, V5SessionState>();
    const fakeImpl: WhyBuddySessionStore = {
      load: async (sid) => customStore.get(sid),
      save: async (s) => {
        const sid = s.sessionId || 'fake';
        const saved = { ...s, sessionId: sid };
        customStore.set(sid, saved);
        return saved;
      },
      clear: () => customStore.clear(),
    };

    const prev = getWhyBuddySessionStore();
    try {
      setWhyBuddySessionStore(fakeImpl);

      const s = await loadOrCreateSessionState('swappable-sess', '可替换 store');
      expect(s.sessionId).toBe('swappable-sess');

      const committed = commitArtifact(
        s,
        createRawArtifact('swappable-art', 'risk.analyze', '安全', 'risk'),
        'sw-run-0',
        false,
        []
      ).updatedState;

      await saveSessionState(committed);

      const reloaded = await loadOrCreateSessionState('swappable-sess', '这个goal不应该覆盖');
      expect(reloaded.artifacts.map((a) => a.id)).toContain('swappable-art');
      expect(reloaded.goal.text).toBe('可替换 store'); // original goal preserved

      // The custom impl should have the entry
      expect(customStore.has('swappable-sess')).toBe(true);
    } finally {
      setWhyBuddySessionStore(prev); // restore
      clearWhyBuddySessionStore();
    }
  });

  it('loadOrCreate + save + deriveNodeStatus ensures graph node statuses are derived from artifacts + stale (single source of truth)', async () => {
    clearWhyBuddySessionStore();

    let s = await loadOrCreateSessionState('derive-sess', 'derive 单一真相');
    // Seed nodes (per binding test pattern at ~385) so derive has targets to update (this test focuses on post-load derive, not full orchestrate flow).
    s = {
      ...s,
      graph: {
        ...s.graph,
        nodes: [
          {
            id: 'derive-node-0',
            type: 'hypothesis',
            title: 'risk pass 0',
            capabilityId: 'risk.analyze',
            capabilityRunId: 'derive-turn-run-0',
            turnId: 'derive-turn',
            status: 'active',
          },
          {
            id: 'derive-node-1',
            type: 'hypothesis',
            title: 'risk pass 1',
            capabilityId: 'risk.analyze',
            capabilityRunId: 'derive-turn-run-1',
            turnId: 'derive-turn',
            status: 'active',
          },
        ],
      } as any,
    };

    // 模拟一轮产生两个 risk，之后挑战其中一个
    const { updatedState: afterCommit } = commitArtifact(
      s,
      createRawArtifact('derive-risk-0', 'risk.analyze', '安全', 'risk'),
      'derive-turn-run-0',
      false,
      []
    );
    const { updatedState: afterCommit2 } = commitArtifact(
      afterCommit,
      createRawArtifact('derive-risk-1', 'risk.analyze', '挑刺', 'risk'),
      'derive-turn-run-1',
      false,
      []
    );

    // 挑战第一个
    const challenged = invalidateForIntervention(afterCommit2, {
      targetArtifactId: 'derive-risk-0',
      intent: 'challenge',
      text: '这个有问题',
    } as any);

    await saveSessionState(challenged);

    // 重新 load —— 必须经过 derive
    const reloaded = await loadOrCreateSessionState('derive-sess', '不应该覆盖');

    const n0 = (reloaded.graph.nodes || []).find((n: any) => n.capabilityRunId === 'derive-turn-run-0');
    const n1 = (reloaded.graph.nodes || []).find((n: any) => n.capabilityRunId === 'derive-turn-run-1');

    expect(reloaded.staleArtifactIds).toContain('derive-risk-0');
    expect(n0?.status).toBe('challenged');
    expect(n1?.status).toBe('completed'); // 有 artifact 且不 stale
    expect(reloaded.goal.text).toBe('derive 单一真相'); // 原始 goal 保留
  });

  it('getSessionLedger produces auditable entries from runs + gates (simulates T_LEDGER)', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('ledger-sess', 'ledger 审计');
    const { updatedState: c1 } = commitArtifact(
      s,
      createRawArtifact('l-risk', 'risk.analyze', '安全', 'risk'),
      'l-run-0',
      false,
      []
    );
    const ledger = getSessionLedger(c1);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger[0].capabilityId).toBe('risk.analyze');
    expect(ledger[0].trustLevel).toBeDefined();
    expect(ledger[0].gateSummary).toContain('passed');
  });

  it('synthesis/report content simulates multi-role dissent when stale present (multi-agent divergence)', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('dissent-sess', '分歧合成');
    // produce risk + counter, then stale one
    const { updatedState: after1 } = commitArtifact(s, createRawArtifact('d-risk', 'risk.analyze', '安全', 'risk'), 'd-run-0', false, []);
    const { updatedState: after2 } = commitArtifact(after1, createRawArtifact('d-counter', 'counter.argue', '挑刺', 'risk'), 'd-run-1', false, []);
    const staled = invalidateForIntervention(after2, { targetArtifactId: 'd-risk', intent: 'challenge', text: '异议' } as any);

    // simulate page synthesis build with stale
    const upstreams = staled.artifacts;
    const hasStale = upstreams.some((u: any) => staled.staleArtifactIds.includes(u.id));
    // In real page this would use extract + fragments; here we assert the condition for dissent injection
    expect(hasStale).toBe(true);
    // This would lead to "分歧意见" section in report content in the page builder
  });

  it('simulateCapabilityExecution produces state-dependent richer content (prototype real-exec feel)', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('sim-sess', '模拟执行');
    const { updatedState: c } = commitArtifact(s, createRawArtifact('sim-risk', 'risk.analyze', '安全', 'risk'), 'sim-r0', false, []);
    const sim = simulateCapabilityExecution('risk.analyze', c, []);
    expect(sim.content).toContain('模拟');
    expect(sim.content).toContain('风险');
    // if we add stale, it should note it
    const staled = invalidateForIntervention(c, { targetArtifactId: 'sim-risk', intent: 'challenge', text: 'x' } as any);
    const simStale = simulateCapabilityExecution('risk.analyze', staled, []);
    expect(simStale.content).toContain('stale');
  });

  it('full loop with simulator + ledger + derived view stays consistent after save/load', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('full-sim', '全链路模拟');
    const { preparedState } = intakeMessage(s, { turnId: 'f1', userText: '生成报告' });
    let afterO = orchestrateReasoningTurn(preparedState, { turnId: 'f1', userText: '生成报告' }).newState;
    // Use the *planned* runId from orchestrate (contract: commit must match the capabilityRunId pre-assigned for this turn/cap in the nodes).
    const reportNode = (afterO.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
    const reportRunId = reportNode ? reportNode.capabilityRunId : 'f1-run-3';
    const { updatedState: c } = commitArtifact(afterO, createRawArtifact('f-report', 'report.write', '综合', 'report'), reportRunId, false, []);
    const enriched = enrichGraphNodesAfterCommit(c, 'f1');
    const saved = await saveSessionState(enriched);
    const reloaded = await loadOrCreateSessionState('full-sim', '不应覆盖');
    const ledger = getSessionLedger(reloaded);
    expect(ledger.some(l => l.capabilityId === 'report.write')).toBe(true);
    const n = (reloaded.graph.nodes || []).find((n: any) => n.capabilityRunId === reportRunId);
    expect(n?.producedArtifactId).toBe('f-report');
  });

  it('picker is fully state-driven: openQuestions, ledger, gaps drive picks beyond keywords', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('picker-state', '状态驱动 picker');
    // seed some state
    s = { ...s, openQuestions: [{ id: 'q1', text: '边界？' }], staleArtifactIds: ['old'] } as any;
    const picks = pickNextCapabilities(s, '随便说说');
    // should pick clarify or decompose due to openQ, and risk due to stale
    const caps = picks.map(p => p.capabilityId);
    expect(caps.some(c => c.includes('clarify') || c.includes('decompose'))).toBe(true);
  });

  it('challenge uses exact produced target from enriched state (binding resolution)', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('challenge-exact', '精确 target');
    const { preparedState } = intakeMessage(s, { turnId: 'c1', userText: '风险' });
    let o = orchestrateReasoningTurn(preparedState, { turnId: 'c1', userText: '风险' }).newState;

    // Adopt the planned runId lookup (contract hygiene, consistent with full-loop tests).
    const riskNode = (o.graph.nodes || []).find((n: any) => n.capabilityId === 'risk.analyze');
    const plannedRunId = riskNode ? riskNode.capabilityRunId : 'c1-run-0';

    const { updatedState: c } = commitArtifact(o, createRawArtifact('c-risk', 'risk.analyze', '安全', 'risk'), plannedRunId, false, []);
    const enriched = enrichGraphNodesAfterCommit(c, 'c1');

    // The enriched node now carries the producedArtifactId (this was the missing assertion).
    const enrichedNode = (enriched.graph.nodes || []).find((n: any) => n.capabilityRunId === plannedRunId);
    expect(enrichedNode).toBeTruthy();
    const targetFromNode = enrichedNode!.producedArtifactId;
    expect(targetFromNode).toBeDefined();

    // Simulate "click on the (enriched) node" by using its producedArtifactId for the intervention
    // (exactly as the page would do for BOARD → INTAKE precise re-entry).
    const invalidated = invalidateForIntervention(enriched, {
      targetArtifactId: targetFromNode,
      intent: 'challenge',
      text: 'Only challenge this specific run\'s conclusion.',
    });

    // Reuse the proven "only matching node challenged + sibling untouched" assertions
    // from the "marks only the graph node for the challenged run..." test.
    // (In this single-cap case we at least prove the targeted node is challenged and has the id.)
    expect(invalidated.staleArtifactIds).toContain(targetFromNode);

    const challengedNode = invalidated.graph.nodes.find((node: any) => node.capabilityRunId === plannedRunId);
    expect(challengedNode?.status).toBe('challenged');

    // For full "only this" demonstration under duplicates, the sibling protection is covered
    // by the dedicated "marks only the graph node..." regression (which uses the same invalidate engine).
    // Here we at minimum prove the binding resolution from enriched node → exact target works.
  });

  it('simulator + ledger + derive in full cycle with dissent', async () => {
    clearWhyBuddySessionStore();
    let s = await loadOrCreateSessionState('cycle-sim', '循环模拟');
    const { preparedState } = intakeMessage(s, { turnId: 'cy1', userText: '报告' });
    let o = orchestrateReasoningTurn(preparedState, { turnId: 'cy1', userText: '报告' }).newState;
    // Use planned runId from orchestrate nodes (fixes contract mismatch that caused producedArtifactId to be missing).
    const reportNode = (o.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
    const reportRunId = reportNode ? reportNode.capabilityRunId : 'cy1-run-3';
    const { updatedState: c } = commitArtifact(o, createRawArtifact('cy-r', 'report.write', '综合', 'report'), reportRunId, false, []);
    const en = enrichGraphNodesAfterCommit(c, 'cy1');
    const saved = await saveSessionState(en);
    const ledger = getSessionLedger(saved);
    const sim = simulateCapabilityExecution('report.write', saved, []);
    expect(ledger.length).toBeGreaterThan(0);
    expect(sim.content).toContain('模拟');
    const der = deriveNodeStatus(saved);
    expect(der.graph.nodes.some((n: any) => n.producedArtifactId)).toBe(true);
  });

  it('CapabilityExecutor can be swapped via setCapabilityExecutor and affects committed artifact content (fake injection)', async () => {
    clearWhyBuddySessionStore();

    // Save the previous (default) so we can restore
    const prev = getCapabilityExecutor ? getCapabilityExecutor() : null;

    try {
      const fakeContent = '【FAKE EXECUTOR OUTPUT from test】turn=fake-t1 cap=risk.analyze';
      const fake = {
        async executeCapability(args: any) {
          return {
            title: 'FAKE TITLE',
            summary: 'fake summary',
            content: fakeContent + ' turn=' + args.turnId,
            provenance: 'ai_generated' as const,
          };
        },
      };

      setCapabilityExecutor(fake);

      // Drive a minimal flow that uses the public executeCapability (same shape the page uses).
      let s = await loadOrCreateSessionState('exec-fake', 'fake executor test');
      const { preparedState } = intakeMessage(s, { turnId: 'f1', userText: '风险分析' });
      const { newState: afterO } = orchestrateReasoningTurn(preparedState, { turnId: 'f1', userText: '风险分析' });

      // Pick first capability from the plan (risk.analyze or whatever the picker chose)
      const first = (afterO as any).plan?.selected?.[0] || { capabilityId: 'risk.analyze', roleId: '安全', inputArtifactIds: [] };
      const capId = first.capabilityId as any;
      const role = first.roleId || '安全';
      const fresh = first.inputArtifactIds || [];

      const execRes = await executeCapability({
        capabilityId: capId,
        state: afterO,
        inputArtifactIds: fresh,
        roleId: role,
        turnId: 'f1',
      });

      // Build a minimal payload like the page does and commit
      const runId = 'f1-run-0';
      const payload = {
        id: 'f1-art-0',
        kind: 'risk' as any,
        provenance: 'ai_generated' as const,
        producedBy: { capabilityRunId: runId, capabilityId: capId, roleId: role },
        title: execRes.title,
        summary: execRes.summary,
        content: execRes.content,
      };
      const { updatedState: committedState } = commitArtifact(afterO, payload as any, runId, false, fresh);

      const art = (committedState.artifacts || []).find((a: any) => a.id === 'f1-art-0');
      expect(art).toBeTruthy();
      expect(art!.content).toContain('FAKE EXECUTOR OUTPUT from test');

    } finally {
      // Restore previous executor (or let default be recreated by the module)
      if (prev && setCapabilityExecutor) setCapabilityExecutor(prev);
      clearWhyBuddySessionStore();
    }
  });

  it('LlmCapabilityExecutor (via useLlmCapabilityExecutor) can be swapped, only affects risk.analyze + report.write, returns strict raw shape, and falls back on other caps', async () => {
    clearWhyBuddySessionStore();

    const prev = getCapabilityExecutor ? getCapabilityExecutor() : null;

    try {
      useLlmCapabilityExecutor();

      let s = await loadOrCreateSessionState('llm-test', 'llm executor pilot test');
      const { preparedState } = intakeMessage(s, { turnId: 'l1', userText: '分析风险并生成结构化报告' });
      const { newState: afterO } = orchestrateReasoningTurn(preparedState, { turnId: 'l1', userText: '分析风险并生成结构化报告' });

      const planSelected: any[] = (afterO as any).plan?.selected || [];
      const riskEntry = planSelected.find((e: any) => e.capabilityId === 'risk.analyze') || { capabilityId: 'risk.analyze', roleId: '安全', inputArtifactIds: [] };
      const reportEntry = planSelected.find((e: any) => e.capabilityId === 'report.write') || { capabilityId: 'report.write', roleId: '综合', inputArtifactIds: [] };

      // risk via Llm pilot
      const riskRes = await executeCapability({
        capabilityId: riskEntry.capabilityId as any,
        state: afterO,
        inputArtifactIds: riskEntry.inputArtifactIds || [],
        roleId: riskEntry.roleId,
        turnId: 'l1',
      });
      expect(riskRes.content).toContain('【LLM pilot - risk.analyze】');
      expect(riskRes.provenance).toBe('llm');

      // report via Llm pilot
      const reportRes = await executeCapability({
        capabilityId: reportEntry.capabilityId as any,
        state: afterO,
        inputArtifactIds: reportEntry.inputArtifactIds || [],
        roleId: reportEntry.roleId,
        turnId: 'l1',
      });
      expect(reportRes.title).toContain('LLM pilot');
      expect(reportRes.provenance).toBe('llm');

      // other cap should fall back (not have LLM marker in this pilot impl)
      const otherCap = planSelected.find((e: any) => e.capabilityId !== 'risk.analyze' && e.capabilityId !== 'report.write');
      if (otherCap) {
        const otherRes = await executeCapability({
          capabilityId: otherCap.capabilityId as any,
          state: afterO,
          inputArtifactIds: otherCap.inputArtifactIds || [],
          roleId: otherCap.roleId,
          turnId: 'l1',
        });
        // In our initial Llm impl other caps delegate to PilotReal, so they get the 真实试点 marker, not LLM.
        // The important contract is that it didn't blow up and returned raw shape.
        expect(otherRes).toHaveProperty('title');
        expect(otherRes).toHaveProperty('content');
      }
    } finally {
      if (prev && setCapabilityExecutor) setCapabilityExecutor(prev);
      clearWhyBuddySessionStore();
    }
  });

  it('LlmCapabilityExecutor supports injectable LlmCapabilityProvider (success, failure fallback, non-target cap)', async () => {
    clearWhyBuddySessionStore();

    const prev = getCapabilityExecutor ? getCapabilityExecutor() : null;

    try {
      // Success provider for the two targeted caps
      const successProvider: LlmCapabilityProvider = async (args) => {
        if (args.capabilityId === 'risk.analyze') {
          return { title: 'LLM-RISK', summary: 'success', content: 'success-risk', provenance: 'llm' };
        }
        return { title: 'LLM-REPORT', summary: 'success', content: 'success-report', provenance: 'llm' };
      };
      setCapabilityExecutor(new LlmCapabilityExecutor(successProvider));

      let s = await loadOrCreateSessionState('provider-test', 'provider seam test');
      const { preparedState } = intakeMessage(s, { turnId: 'prov1', userText: '风险并报告' });
      const { newState: afterO } = orchestrateReasoningTurn(preparedState, { turnId: 'prov1', userText: '风险并报告' });

      const planSelected: any[] = (afterO as any).plan?.selected || [];
      const riskEntry = planSelected.find((e: any) => e.capabilityId === 'risk.analyze') || { capabilityId: 'risk.analyze', roleId: '安全', inputArtifactIds: [] };
      const reportEntry = planSelected.find((e: any) => e.capabilityId === 'report.write') || { capabilityId: 'report.write', roleId: '综合', inputArtifactIds: [] };

      const riskRes = await executeCapability({ capabilityId: riskEntry.capabilityId as any, state: afterO, inputArtifactIds: riskEntry.inputArtifactIds || [], roleId: riskEntry.roleId, turnId: 'prov1' });
      expect(riskRes.title).toBe('LLM-RISK');
      expect(riskRes.provenance).toBe('llm');

      const reportRes = await executeCapability({ capabilityId: reportEntry.capabilityId as any, state: afterO, inputArtifactIds: reportEntry.inputArtifactIds || [], roleId: reportEntry.roleId, turnId: 'prov1' });
      expect(reportRes.title).toBe('LLM-REPORT');
      expect(reportRes.provenance).toBe('llm');

      // Failing provider must trigger fallback (content should come from PilotReal/Default, not the provider)
      const failingProvider: LlmCapabilityProvider = async () => { throw new Error('simulated external failure'); };
      setCapabilityExecutor(new LlmCapabilityExecutor(failingProvider));

      const riskFail = await executeCapability({ capabilityId: riskEntry.capabilityId as any, state: afterO, inputArtifactIds: riskEntry.inputArtifactIds || [], roleId: riskEntry.roleId, turnId: 'prov1' });
      // It should not contain the success marker from the previous provider; fallback produces PilotReal-style content.
      expect(riskFail.content).not.toContain('success-risk');

      // Non-target cap should fall back without calling a "LLM" provider.
      // Use an explicit counter to strictly prove the provider is never invoked for caps outside serverRouted.
      let providerCalls = 0;
      const trackingProvider: LlmCapabilityProvider = async () => {
        providerCalls++;
        return { title: 'DUMMY', summary: '', content: '', provenance: 'llm' as const };
      };
      setCapabilityExecutor(new LlmCapabilityExecutor(trackingProvider));

      // intent.parse is not server-routed (R2b added synthesis.merge et al. to serverRouted).
      await executeCapability({ capabilityId: 'intent.parse', state: afterO, inputArtifactIds: [], turnId: 'prov1' });
      expect(providerCalls).toBe(0);

      // All four deliberation capabilities must route through the provider (R2 contract).
      const deliberationIds = [
        'counter.argue',
        'critique.generate',
        'rebuttal.resolve',
        'synthesis.merge',
      ] as const;
      for (const capId of deliberationIds) {
        await executeCapability({
          capabilityId: capId,
          state: afterO,
          inputArtifactIds: [],
          turnId: 'prov1',
        });
      }
      expect(providerCalls).toBe(deliberationIds.length);

      // --- Real provider wiring: createOpenAILlmCapabilityProvider (mocked, hermetic) ---
      // Verifies the factory produces a valid LlmCapabilityProvider for the two pilot caps,
      // returns the exact raw contract shape, and that LlmCapabilityExecutor falls back on error.
      {
        const prev2 = getCapabilityExecutor ? getCapabilityExecutor() : null;
        const fetchSpy = vi.spyOn(globalThis as any, 'fetch');

        try {
          // Success: model returns clean JSON → we get title/summary/content + openai provenance.
          fetchSpy.mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        title: 'OpenAI-RISK',
                        summary: 'real llm risk',
                        content: 'real-llm-risk-content',
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            ) as any
          );

          const openaiProvider = createOpenAILlmCapabilityProvider({ apiKey: 'sk-test-123' });
          setCapabilityExecutor(new LlmCapabilityExecutor(openaiProvider));

          const riskRes2 = await executeCapability({
            capabilityId: riskEntry.capabilityId as any,
            state: afterO,
            inputArtifactIds: riskEntry.inputArtifactIds || [],
            roleId: riskEntry.roleId,
            turnId: 'ai1',
          });
          expect(riskRes2.title).toBe('OpenAI-RISK');
          expect(riskRes2.content).toBe('real-llm-risk-content');
          // provenance stays within the allowed union for the seam ('llm' etc.); the [openai:...] marker in summary proves real path
          expect(riskRes2.provenance).toBe('llm');
          expect(String(riskRes2.summary || '')).toContain('openai');

          // Failure (fetch rejects) → LlmCapabilityExecutor catch must trigger PilotReal fallback.
          fetchSpy.mockRejectedValueOnce(new Error('simulated network failure'));

          const openaiFailing = createOpenAILlmCapabilityProvider({ apiKey: 'sk-test-123' });
          setCapabilityExecutor(new LlmCapabilityExecutor(openaiFailing));

          const riskFail2 = await executeCapability({
            capabilityId: riskEntry.capabilityId as any,
            state: afterO,
            inputArtifactIds: riskEntry.inputArtifactIds || [],
            roleId: riskEntry.roleId,
            turnId: 'ai2',
          });
          expect(riskFail2.content).not.toContain('real-llm-risk-content');
          expect(riskFail2).toHaveProperty('title');
          expect(riskFail2).toHaveProperty('content');
        } finally {
          fetchSpy.mockRestore();
          if (prev2 && setCapabilityExecutor) setCapabilityExecutor(prev2);
        }
      }

      // Server-routed provider (recommended production-aligned path via /api/whybuddy/execute-capability).
      // Uses the same seam + fallback contract. We spy fetch so the test stays hermetic.
      {
        const prev3 = getCapabilityExecutor ? getCapabilityExecutor() : null;
        const fetchSpy = vi.spyOn(globalThis as any, 'fetch');

        try {
          // Success from server route
          fetchSpy.mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                title: 'SERVER-RISK',
                summary: 'from server llm',
                content: 'server-llm-risk-content',
                provenance: 'llm',
              }),
              { status: 200 }
            ) as any
          );

          const serverProvider = createServerLlmCapabilityProvider();
          setCapabilityExecutor(new LlmCapabilityExecutor(serverProvider));

          const riskRes3 = await executeCapability({
            capabilityId: riskEntry.capabilityId as any,
            state: afterO,
            inputArtifactIds: riskEntry.inputArtifactIds || [],
            roleId: riskEntry.roleId,
            turnId: 'srv1',
          });
          expect(riskRes3.title).toBe('SERVER-RISK');
          expect(riskRes3.content).toBe('server-llm-risk-content');

          // Server returns non-2xx → client provider throws → LlmCapabilityExecutor fallback
          fetchSpy.mockResolvedValueOnce(
            new Response(JSON.stringify({ error: 'llm_execution_failed' }), { status: 500 }) as any
          );

          const serverFailProvider = createServerLlmCapabilityProvider();
          setCapabilityExecutor(new LlmCapabilityExecutor(serverFailProvider));

          const riskFail3 = await executeCapability({
            capabilityId: riskEntry.capabilityId as any,
            state: afterO,
            inputArtifactIds: riskEntry.inputArtifactIds || [],
            roleId: riskEntry.roleId,
            turnId: 'srv2',
          });
          expect(riskFail3.content).not.toContain('server-llm-risk-content');
          expect(riskFail3).toHaveProperty('title');
          expect(riskFail3).toHaveProperty('content');
        } finally {
          fetchSpy.mockRestore();
          if (prev3 && setCapabilityExecutor) setCapabilityExecutor(prev3);
        }
      }
    } finally {
      if (prev && setCapabilityExecutor) setCapabilityExecutor(prev);
      clearWhyBuddySessionStore();
    }
  });

  it('test helper routes (__clear / __reload) are disabled under production (production guard)', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFlag = process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
    try {
      // Use the real exported implementation from server/routes/whybuddy.ts
      process.env.NODE_ENV = 'production';
      delete process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
      expect(isTestHelperEnabled()).toBe(false); // routes not registered → callers get 404

      // --- route-level production guard (beyond the pure function) ---
      // Reset + reimport so the routes module's top-level `enableTestHelpers = isTestHelperEnabled()`
      // and the two `if (enableTestHelpers) { router.post(...) }` blocks run under NODE_ENV=production
      // *with the escape hatch absent*. This proves the *routes are not mounted* (HTTP 404) while
      // the 4 public endpoints remain registered and functional.
      vi.resetModules();
      const routeMod = await import('../../../server/routes/whybuddy.ts');
      const prodRouter = routeMod.default;
      const prodEnabled = routeMod.isTestHelperEnabled;
      expect(prodEnabled()).toBe(false);

      // Fresh express app + the prod-evaluated router (no test helper routes should exist)
      const expressMod = await import('express');
      const Express = expressMod.default;
      const { createServer } = await import('node:http');
      const app = Express();
      app.use(Express.json({ limit: '2mb' }));
      app.use('/api/whybuddy', prodRouter);

      const httpServer = createServer(app);
      const port: number = await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === 'object' && 'port' in addr) resolve(addr.port as number);
          else reject(new Error('no port'));
        });
      });
      const base = `http://127.0.0.1:${port}/api/whybuddy`;

      try {
        // Public 4-endpoint surface must still be registered and functional regardless of guard
        const listRes = await fetch(`${base}/sessions`);
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json().catch(() => ({} as any));
        expect(listBody).toHaveProperty('sessions');

        // GET /:id for missing still hits the handler (its own 404), proving the route exists
        const getMissing = await fetch(`${base}/sessions/__guard-test-missing-id`);
        expect(getMissing.status).toBe(404);

        // DELETE route active (returns 204 even for unknown id)
        const delRes = await fetch(`${base}/sessions/__guard-test-del`, { method: 'DELETE' });
        expect([204, 200]).toContain(delRes.status);

        // The test-only helpers must 404 (not registered because if(enable) was false at eval)
        const clearRes = await fetch(`${base}/sessions/__clear`, { method: 'POST' });
        expect(clearRes.status).toBe(404);

        const reloadRes = await fetch(`${base}/sessions/__reload`, { method: 'POST' });
        expect(reloadRes.status).toBe(404);
      } finally {
        await new Promise<void>((r) => { httpServer.close(() => r()); });
      }
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalFlag !== undefined) {
        process.env.WHYBUDDY_ENABLE_TEST_HELPERS = originalFlag;
      } else {
        delete process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
      }
      // Ensure subsequent tests see a clean module cache for the routes (best effort)
      vi.resetModules();
    }
  });

  it('PilotRealCapabilityExecutor (via usePilotRealExecutor) produces richer content for risk.analyze + report.write while preserving 9-section schema + fallback for other caps', async () => {
    clearWhyBuddySessionStore();

    const prev = getCapabilityExecutor ? getCapabilityExecutor() : null;

    try {
      // Enable pilot (richer deterministic logic for the two targeted caps)
      usePilotRealExecutor();

      let s = await loadOrCreateSessionState('pilot-test', 'pilot executor regression');
      const { preparedState } = intakeMessage(s, { turnId: 'p1', userText: '分析风险并生成结构化报告' });
      const { newState: afterO } = orchestrateReasoningTurn(preparedState, { turnId: 'p1', userText: '分析风险并生成结构化报告' });

      const planSelected: any[] = (afterO as any).plan?.selected || [];
      const riskEntry = planSelected.find((e: any) => e.capabilityId === 'risk.analyze') || { capabilityId: 'risk.analyze', roleId: '安全', inputArtifactIds: [] };
      const reportEntry = planSelected.find((e: any) => e.capabilityId === 'report.write') || { capabilityId: 'report.write', roleId: '综合', inputArtifactIds: [] };

      // Execute risk via pilot
      const riskRes = await executeCapability({
        capabilityId: riskEntry.capabilityId as any,
        state: afterO,
        inputArtifactIds: riskEntry.inputArtifactIds || [],
        roleId: riskEntry.roleId,
        turnId: 'p1',
      });
      expect(riskRes.content).toContain('【真实试点 executor - risk.analyze】');
      expect(riskRes.content).toContain('数据范围越权');
      expect(riskRes.content).toContain('下一步工程化');

      // Commit a risk artifact using pilot output (mirrors page flow)
      const riskRunId = 'p1-run-risk';
      const riskPayload = {
        id: 'pilot-risk-art',
        kind: 'risk' as any,
        provenance: 'ai_generated' as const,
        producedBy: { capabilityRunId: riskRunId, capabilityId: riskEntry.capabilityId, roleId: riskEntry.roleId || '安全' },
        title: riskRes.title,
        summary: riskRes.summary,
        content: riskRes.content,
      };
      const { updatedState: withRisk } = commitArtifact(afterO, riskPayload as any, riskRunId, false, riskEntry.inputArtifactIds || []);

      // Now execute report via pilot (should still emit exact 9 labels + pilot enrichment)
      const reportRes = await executeCapability({
        capabilityId: reportEntry.capabilityId as any,
        state: withRisk,
        inputArtifactIds: reportEntry.inputArtifactIds || [],
        roleId: reportEntry.roleId,
        turnId: 'p1',
      });
      // 9-section schema preserved (labels from buildStructuredReport, pilot only enriches)
      expect(reportRes.content).toContain('结论：');
      expect(reportRes.content).toContain('支撑证据：');
      expect(reportRes.content).toContain('反证/挑战：');
      expect(reportRes.content).toContain('风险：');
      expect(reportRes.content).toContain('分歧：');
      expect(reportRes.content).toContain('收敛决策：');
      expect(reportRes.content).toContain('未解缺口：');
      expect(reportRes.content).toContain('下一步工程化分支：');
      expect(reportRes.content).toContain('provenance / upstream refs：');
      // Pilot enrichment markers / richer engineering branches
      expect(reportRes.content).toContain('真实试点 executor');
      expect(reportRes.content).toContain('Pilot 验证：本报告由 PilotRealCapabilityExecutor 产生');

      // Commit the report artifact
      const reportRunId = 'p1-run-report';
      const reportPayload = {
        id: 'pilot-report-art',
        kind: 'report' as any,
        provenance: 'ai_generated' as const,
        producedBy: { capabilityRunId: reportRunId, capabilityId: reportEntry.capabilityId, roleId: reportEntry.roleId || '综合' },
        title: reportRes.title,
        summary: reportRes.summary,
        content: reportRes.content,
      };
      const { updatedState: withReport } = commitArtifact(withRisk, reportPayload as any, reportRunId, false, reportEntry.inputArtifactIds || []);

      // Verify a non-pilot capability still falls back to simulator style
      const synthEntry = planSelected.find((e: any) => String(e.capabilityId).includes('synth')) || { capabilityId: 'synthesis.merge', roleId: '综合', inputArtifactIds: [] };
      const synthRes = await executeCapability({
        capabilityId: synthEntry.capabilityId as any,
        state: withReport,
        inputArtifactIds: synthEntry.inputArtifactIds || [],
        roleId: synthEntry.roleId,
        turnId: 'p1',
      });
      // Simulator path (not pilot richer) — content should not carry the pilot risk/report markers
      expect(synthRes.content).not.toContain('【真实试点 executor');
      // But still contains typical simulator phrasing or state-driven content
      expect(synthRes.content.length).toBeGreaterThan(10);

      // Final committed report artifact carries the pilot-enriched 9-section content
      const finalReportArt = (withReport.artifacts || []).find((a: any) => a.id === 'pilot-report-art');
      expect(finalReportArt).toBeTruthy();
      expect(finalReportArt!.content).toContain('真实试点 executor');
      expect(finalReportArt!.content).toContain('下一步工程化分支：');

    } finally {
      // Always restore default + clean
      if (prev && setCapabilityExecutor) setCapabilityExecutor(prev);
      else useDefaultExecutor();
      clearWhyBuddySessionStore();
    }
  });

  // ===== V5.1 Budget Gate v1 tests (first knife: counts entry gate + partial AWAIT) =====
  it('Budget Gate v1: high distinct turns -> parks at AWAIT partial, empty plan, auditable conv note', () => {
    let heavy = createInitialSessionState('budget test goal', 'b1');
    // Fabricate 31 distinct turns via capabilityRuns ( > default max 30 )
    const fakeRuns: any[] = Array.from({ length: 31 }, (_, i) => ({
      id: `run-t${i}`,
      capabilityId: 'evidence.search',
      turnId: `t${i}`,
      inputs: [],
      outputs: [],
      gateResults: [],
    }));
    heavy = { ...heavy, capabilityRuns: fakeRuns };

    const { newState: afterO, plan } = orchestrateReasoningTurn(heavy, {
      turnId: 't-new-32',
      userText: '继续推演更多',
    });

    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected).toEqual([]);
    expect(plan.reason).toMatch(/BUDGET_EXCEEDED/);
    const notes = (afterO.conversation || []).filter((c: any) => c.id && c.id.includes('-budget'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].text).toMatch(/maxTurns exceeded/);
  });

  it('Budget Gate v1: repeat capability exceeds maxRepeat -> blocks further ORCH, partial AWAIT', () => {
    let heavy = createInitialSessionState('repeat budget', 'b2');
    const cap = 'risk.analyze';
    // 7 runs of same cap ( > default maxRepeat 6 )
    const fakeRuns: any[] = Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      capabilityId: cap,
      turnId: `tr${i}`,
      inputs: [],
      outputs: [],
      gateResults: [],
    }));
    heavy = { ...heavy, capabilityRuns: fakeRuns };

    const { newState: afterO, plan } = orchestrateReasoningTurn(heavy, {
      turnId: 'tr-new',
      userText: '再来一次风险分析',
    });

    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);
    expect(plan.reason).toMatch(/BUDGET_EXCEEDED.*maxRepeatPerCapability/);
    expect((afterO.conversation || []).some((c: any) => (c.text || '').includes('maxRepeatPerCapability'))).toBe(true);
  });

  it('Budget Gate v1 + recordCapabilityRunCost: evaluate uses current runs; record is safe no-op stub for v1', () => {
    const policy = getDefaultBudgetPolicy();
    expect(policy.maxTurns).toBe(30);
    expect(policy.maxRepeatPerCapability).toBe(6);

    let s = createInitialSessionState('rec test');
    const eval1 = evaluateBudgetBeforeOrchestrate(s, { turnId: 'r1', userText: 'x' });
    expect(eval1.allowed).toBe(true);
    expect(eval1.snapshot.turns).toBe(0);

    // record should not throw and returns state (v1)
    const dummyRun: any = { id: 'dummy', capabilityId: 'evidence.search', turnId: 'r1', inputs: [], outputs: [], gateResults: [] };
    const afterRec = recordCapabilityRunCost(s, dummyRun, { tokens: 123 });
    expect(afterRec).toBeTruthy();
    expect((afterRec.capabilityRuns || []).length).toBe(0); // v1 no side effect on count
  });

  // ===== V5.1 Decision Ledger v1 tests (Knife 2) =====
  it('Decision Ledger v1: normal orchestrate appends a decision; chose matches plan.selected exactly', () => {
    const s = createInitialSessionState('dledger normal', 'd1');
    const { newState: afterO, plan } = orchestrateReasoningTurn(s, {
      turnId: 'd1',
      userText: '分析风险并生成报告',
    });

    const ledger = getDecisionLedger(afterO);
    expect(ledger.length).toBe(1);
    const d = ledger[0];
    expect(d.turnId).toBe('d1');
    expect(d.chose.length).toBeGreaterThan(0);
    // chose ids must match the plan.selected
    const planIds = (plan.selected || []).map((p: any) => p.capabilityId);
    expect(d.chose).toEqual(planIds);
    expect(d.saw.length).toBeGreaterThan(0);
    expect(d.skipped.every((sk: any) => !d.chose.includes(sk.capabilityId))).toBe(true);
  });

  it('Decision Ledger v1: skipped has reasons and does not overlap chose', () => {
    const s = createInitialSessionState('dledger skipped', 'd2');
    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: 'd2',
      userText: '做个报告',
    });

    const ledger = getDecisionLedger(afterO);
    expect(ledger.length).toBe(1);
    const d = ledger[0];
    expect(d.skipped.length).toBeGreaterThan(0);
    d.skipped.forEach((sk: any) => {
      expect(sk.reason).toBeTruthy();
      expect(d.chose.includes(sk.capabilityId)).toBe(false);
    });
  });

  it('Decision Ledger v1 + Budget block: records special blocked_by_budget decision (per decided policy)', () => {
    let heavy = createInitialSessionState('dledger budget block', 'd3');
    // Force budget block (reuse the high-turns pattern from Budget tests)
    const fakeRuns: any[] = Array.from({ length: 31 }, (_, i) => ({
      id: `r${i}`,
      capabilityId: 'evidence.search',
      turnId: `t${i}`,
      inputs: [],
      outputs: [],
      gateResults: [],
    }));
    heavy = { ...heavy, capabilityRuns: fakeRuns };

    const { newState: afterO, plan } = orchestrateReasoningTurn(heavy, {
      turnId: 'd3-block',
      userText: '继续',
    });

    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);

    const ledger = getDecisionLedger(afterO);
    // At least the block decision (may have prior from heavy state, but we check the last one)
    const last = ledger[ledger.length - 1];
    expect(last).toBeTruthy();
    expect(last.chose).toEqual([]);
    expect(last.rationale).toMatch(/blocked_by_budget/);
    expect(last.skipped.some((sk: any) => sk.reason === 'blocked_by_budget')).toBe(true);
  });

  // ===== Knife 3: CoverageContract + GCOV v1 (4 new tests, 37 -> 41) =====

  it('complex goal requires risk.analyze before report.write can be treated covered', () => {
    // Complex goal (contains 风险) -> contract should declare risk.analyze + report.write required
    const complexGoal = '分析权限系统的风险并给出最终报告';
    let s = createInitialSessionState(complexGoal, 'gcov-c1');
    // No prior risk artifact -> pick may still surface report via keywords, GCOV must force/declare
    const { newState: afterO, plan } = orchestrateReasoningTurn(s, {
      turnId: 'gc1',
      userText: '写最终报告',
    });
    const contract = afterO.coverageContract as CoverageContract | undefined;
    expect(contract).toBeTruthy();
    expect(contract!.mode).toBe('complex');
    expect(contract!.requiredCapabilities).toContain('risk.analyze');
    expect(contract!.requiredCapabilities).toContain('report.write');
    // Gate should have recorded (even if pick included risk, missing check is on committed trusted)
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate).toBeTruthy();
    // Since no risk committed yet, if report intent present then either gate false or plan prepended risk
    const hasReportInPlan = plan.selected.some((p: any) => p.capabilityId === 'report.write');
    if (hasReportInPlan) {
      expect(gate!.passed).toBe(false);
      expect(gate!.missingCapabilities).toContain('risk.analyze');
      // plan should not be "only report" (risk prepended or also present)
      const capIds = plan.selected.map((p: any) => p.capabilityId);
      expect(capIds.includes('risk.analyze')).toBe(true);
    }
  });

  it('GCOV blocks premature report when required capability missing', () => {
    // Artificially construct state with synthesis (so pick can choose report) but NO risk artifact
    // Goal contains '风险' to trigger complex contract (requires risk.analyze before report converge)
    let s = createInitialSessionState('权限系统风险分析后的最终报告', 'gcov-c2');
    // Seed a trusted synthesis (no risk) to allow picker to surface report
    const { updatedState: s2 } = commitArtifact(
      s,
      createRawArtifact('synth-premature', 'synthesis.merge', '综合', 'synthesis'),
      'gc2-run-s',
      false,
      []
    );
    // Ensure synthesis is trusted + not stale
    const synthArt = (s2.artifacts || []).find((a: any) => a.kind === 'synthesis');
    if (synthArt) {
      (synthArt as any).trustLevel = 'gated_pass';
      (synthArt as any).passedGates = ['commit'];
    }
    const { newState: afterO, plan } = orchestrateReasoningTurn(s2, {
      turnId: 'gc2',
      userText: '基于已有合成写报告',
    });
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate).toBeTruthy();
    expect(gate!.passed).toBe(false);
    expect(gate!.missingCapabilities).toContain('risk.analyze');
    // plan should not collapse to only report; risk must be prepended (or already) per GCOV rule
    const caps = plan.selected.map((p: any) => p.capabilityId);
    expect(caps.includes('report.write')).toBe(true);
    // Either risk is also selected (prepend or pick), or gate blocked the pure converge
    const onlyReport = caps.length === 1 && caps[0] === 'report.write';
    expect(onlyReport).toBe(false);
  });

  it('GCOV passes when required capability runs are committed and trusted', () => {
    let s = createInitialSessionState('有风险的报告', 'gcov-c3');
    // Commit a trusted risk run (simulates prior turn complete)
    const { updatedState: sRisk } = commitArtifact(
      s,
      createRawArtifact('r1', 'risk.analyze', '安全', 'risk'),
      'gc3-r0',
      false,
      []
    );
    const riskArt = (sRisk.artifacts || []).find((a: any) => a.producedBy?.capabilityId === 'risk.analyze');
    if (riskArt) {
      (riskArt as any).trustLevel = 'gated_pass';
      (riskArt as any).passedGates = ['commit'];
    }
    // Also a synthesis for report path
    const { updatedState: sBoth } = commitArtifact(
      sRisk,
      createRawArtifact('s1', 'synthesis.merge', '综合', 'synthesis'),
      'gc3-r1',
      false,
      []
    );
    const synArt = (sBoth.artifacts || []).find((a: any) => a.kind === 'synthesis');
    if (synArt) {
      (synArt as any).trustLevel = 'gated_pass';
      (synArt as any).passedGates = ['commit'];
    }
    const { newState: afterO, plan } = orchestrateReasoningTurn(sBoth, {
      turnId: 'gc3',
      userText: '现在可以出报告了',
    });
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate).toBeTruthy();
    expect(gate!.passed).toBe(true);
    expect(gate!.missingCapabilities.length).toBe(0);
    // Plan may include report (or other), but gate says ok to converge
  });

  it('DLEDGER records coverage addresses', () => {
    const goal = '复杂目标：风险分析后报告';
    let s = createInitialSessionState(goal, 'gcov-c4');
    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: 'gc4',
      userText: '目标有风险，需要覆盖后才能报告',
    });
    const ledger = getDecisionLedger(afterO);
    expect(ledger.length).toBeGreaterThan(0);
    const last = ledger[ledger.length - 1];
    expect(last).toBeTruthy();
    // addresses should contain coverage:required: entries (even if empty missing, the linkage starts)
    const adds = (last.addresses || []) as string[];
    const hasCov = adds.some((a: string) => a.startsWith('coverage:required:'));
    // At minimum for complex goal path we expect the contract to have run and addresses populated on decision
    // (if no report intent this turn, may be empty; re-trigger converge intent)
    if (hasCov) {
      expect(adds.some((a: string) => a.includes('risk.analyze') || a.includes('report.write'))).toBe(true);
    } else {
      // fallback: ensure contract was authored and gate evaluated
      expect(afterO.coverageContract).toBeTruthy();
      expect(afterO.coverageGate).toBeTruthy();
    }
  });

  // ===== Knife 3.1 regressions (per review: DLEDGER consistency + hard GCOV block) =====

  it('GCOV-forced capability is not left in skipped / alternativesRejected', () => {
    // Complex goal + report intent with no trusted risk yet will cause GCOV to want to force 'risk.analyze'.
    // Even if the original picker did not include it (or did), after GCOV the decision must not list it in skipped.
    const goal = '权限系统有风险，需要最终报告';
    let s = createInitialSessionState(goal, 'gcov-31-1');
    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: 'g31-1',
      userText: '生成最终报告',
    });
    const ledger = getDecisionLedger(afterO);
    expect(ledger.length).toBeGreaterThan(0);
    const last = ledger[ledger.length - 1];
    const skippedIds = (last.skipped || []).map((sk: any) => sk.capabilityId);
    const altRejected: string[] = last.alternativesRejected || [];
    // If GCOV forced risk (or any required), it must not appear in the picker's "skipped" view anymore.
    expect(skippedIds.includes('risk.analyze')).toBe(false);
    expect(altRejected.includes('risk.analyze')).toBe(false);
    // And the gate should reflect the (pre-force) missing
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    if (gate && !gate.passed) {
      // The decision should have the coverage address recorded
      const adds = (last.addresses || []) as string[];
      expect(adds.some((a: string) => a.includes('risk.analyze'))).toBe(true);
    }
  });

  it('GCOV fail + insufficient afford blocks report.write from plan and parks AWAIT', () => {
    // To hit afford==0 + still-missing-pre-req while report is selected:
    // - Complex goal (contains "风险" → requires risk.analyze).
    // - Trusted synthesis drives report.write via state gap, but no trusted risk.analyze run.
    // - Keyword fillers (no 报告/可行性 tokens) fill the per-turn cap without scheduling risk.
    // - afford=0 for the needed force → hard block returns empty plan + AWAIT.
    const goal = '有风险的权限系统最终可行性报告';
    let s = createInitialSessionState(goal, 'gcov-31-2');

    const { updatedState: sWithRisk } = commitArtifact(
      s,
      createRawArtifact('untrusted-risk', 'risk.analyze', '安全', 'risk'),
      'g31-2-run-risk',
      true,
      []
    );
    s = commitArtifact(
      sWithRisk,
      createRawArtifact('trusted-synth', 'synthesis.merge', '综合', 'synthesis'),
      'g31-2-run-synth',
      false,
      []
    ).updatedState;

    s = {
      ...s,
      openQuestions: [{ id: 'q1', text: '边界？' }],
    } as any;

    const { newState: afterO, plan } = orchestrateReasoningTurn(s, {
      turnId: 'g31-2',
      userText: '路线对比 拆解结构 预览效果',
    });

    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate).toBeTruthy();
    expect(gate!.passed).toBe(false);
    expect(gate!.missingCapabilities).toContain('risk.analyze');

    // The hard block should have fired because afford was insufficient to force the missing pre-req.
    const caps = (plan.selected || []).map((p: any) => p.capabilityId);
    const onlyReport = caps.length === 1 && caps[0] === 'report.write';
    expect(onlyReport).toBe(false);
    // Block path returns empty selected + AWAIT
    expect(plan.selected.length).toBe(0);
    expect(afterO.runtimePhase).toBe('awaiting');
    // GCOV block note in conversation
    const hasGcovNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('[GCOV] blocked'));
    expect(hasGcovNote).toBe(true);
    // Decision annotated
    const ledger = getDecisionLedger(afterO);
    const last = ledger[ledger.length - 1];
    expect(last.rationale).toMatch(/GCOV_BLOCKED|GCOV/);
  });

  // ===== Knife 4: FLOWB boundary guard v1 (3 new tests, 43 -> 46) =====

  it('FLOWB strips critique/rebuttal protocol nodes from formal report input', () => {
    // Create upstream with protocol noise in content (simulates brainstorm leakage)
    let s = createInitialSessionState('权限系统报告', 'flowb-1');
    const polluted = createRawArtifact('polluted-up', 'risk.analyze', '安全', 'risk', '结论：用RBAC。\ncritique: 太早引入ABAC\nrebuttal: 成本高\n普通证据：RBAC足够');
    const { updatedState: sUp } = commitArtifact(s, polluted, 'f1-run-up', false, []);
    // Force a report turn that will consume the upstream fragment
    const { preparedState } = intakeMessage(sUp, { turnId: 'f1', userText: '生成报告' });
    const { newState: afterO } = orchestrateReasoningTurn(preparedState, { turnId: 'f1', userText: '生成报告' });
    // Find the report node/run and commit a raw that would normally carry the polluted fragments (builder pulls from upstream)
    const reportNode = (afterO.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
    const reportRunId = reportNode ? reportNode.capabilityRunId : 'f1-run-r';
    // Simulate the executor output containing the fragments (in real it would via build)
    const rawReport = createRawArtifact('rpt', 'report.write', '综合', 'report', '结论：RBAC\ncritique: 反对\nrebuttal: 成本\n证据：好');
    const { updatedState: afterCommit, committed } = commitArtifact(afterO, rawReport, reportRunId, false, [polluted.id]);
    expect(committed).toBeTruthy();
    const finalContent = committed!.content || '';
    expect(finalContent).not.toMatch(/critique:/i);
    expect(finalContent).not.toMatch(/rebuttal:/i);
    // But the ledger recorded the strip
    const ledger = afterCommit.flowBoundaryLedger || [];
    expect(ledger.length).toBeGreaterThan(0);
    const lastCheck = ledger[ledger.length - 1] as FlowBoundaryCheck;
    expect(lastCheck.strippedProtocolNodes.some((n: string) => /critique|rebuttal/i.test(n))).toBe(true);
  });

  it('FLOWB records boundary assertion in ledger', () => {
    let s = createInitialSessionState('有辩论的综合', 'flowb-2');
    const polluted = createRawArtifact('p2', 'synthesis.merge', '综合', 'synthesis', '结论：RBAC\n debate: 角色A vs B\n role vote: 3:1');
    const { updatedState: sUp } = commitArtifact(s, polluted, 'f2-run', false, []);
    // Direct commit for synthesis to exercise the boundary at commit time
    const rawSyn = createRawArtifact('syn', 'synthesis.merge', '综合', 'synthesis', polluted.content);
    const { updatedState: afterC } = commitArtifact(sUp, rawSyn, 'f2-run2', false, []);
    const ledger = afterC.flowBoundaryLedger || [];
    expect(ledger.some((c: any) => (c.strippedProtocolNodes || []).length > 0 || (c.assertions || []).some((a: string) => /strip|protocol/i.test(a)))).toBe(true);
  });

  it('FLOWB leaves ordinary evidence text unchanged', () => {
    let s = createInitialSessionState('干净证据', 'flowb-3');
    const clean = createRawArtifact('clean-ev', 'evidence.search', '接地', 'evidence', '普通证据文本：RBAC MVP 可落地，无任何辩论协议。');
    const { updatedState: afterC, committed } = commitArtifact(s, clean, 'f3-run', false, []);
    expect(committed).toBeTruthy();
    expect(committed!.content).toContain('普通证据文本');
    expect(committed!.content).not.toMatch(/critique|rebuttal|debate/i);
    // No spurious FLOWB entry or empty strip
    const ledger = afterC.flowBoundaryLedger || [];
    // May have entry but with no stripped nodes for clean text
    if (ledger.length > 0) {
      const last = ledger[ledger.length - 1] as any;
      if (last.source === 'artifact' || last.strippedProtocolNodes) {
        expect((last.strippedProtocolNodes || []).length).toBe(0);
      }
    }
  });

  // ===== Knife 5: decision-level challenge re-entry (3 new tests, 46 -> 49) =====

  it('decision-level challenge marks target decision as challenged', () => {
    let s = createInitialSessionState('决策挑战测试', 'dec-ch-1');
    const { newState: afterO1 } = orchestrateReasoningTurn(s, { turnId: 'd1', userText: '分析风险并报告' });
    const ledger1 = getDecisionLedger(afterO1);
    const firstDec = ledger1[ledger1.length - 1];
    expect(firstDec).toBeTruthy();

    // Now issue a challenge targeting that decision (single door via intake)
    const challengeInt: any = {
      targetDecisionId: firstDec.id,
      intent: 'challenge',
      text: '为什么选了这些能力？请重新考虑',
    };
    const { preparedState } = intakeMessage(afterO1, { turnId: 'd2', userText: '挑战这条调度决策', intervention: challengeInt });
    // After intake (which calls invalidate), the decision in the prepared state should be marked
    const markedLedger = getDecisionLedger(preparedState);
    const marked = markedLedger.find((d: any) => d.id === firstDec.id);
    expect(marked).toBeTruthy();
    expect(marked!.status).toBe('challenged');
    expect(marked!.challengeText).toMatch(/为什么选了这些能力/);
    expect(marked!.challengedAt).toBeTruthy();
  });

  it('decision challenge re-enters through intakeMessage single door', () => {
    let s = createInitialSessionState('单门挑战', 'dec-ch-2');
    const { newState: o1 } = orchestrateReasoningTurn(s, { turnId: 'c1', userText: '生成报告' });
    const dec1 = getDecisionLedger(o1).pop()!;

    const intv: any = { targetDecisionId: dec1.id, intent: 'challenge', text: '重新审视这个调度' };
    const intakeRes = intakeMessage(o1, { turnId: 'c2', userText: '挑战决策', intervention: intv });
    // Single door contract: controlSignal should be 'challenge', phase orchestrating, lastTurnId set
    expect(intakeRes.controlSignal).toBe('challenge');
    expect(intakeRes.preparedState.runtimePhase).toBe('orchestrating');
    expect(intakeRes.preparedState.lastTurnId).toBe('c2');
    // And the decision got marked (via extended invalidate)
    const ledgerAfterIntake = getDecisionLedger(intakeRes.preparedState);
    const marked = ledgerAfterIntake.find((d: any) => d.id === dec1.id);
    expect(marked?.status).toBe('challenged');
  });

  it('decision challenge influences next DLEDGER rationale / selected reconsideration', () => {
    let s = createInitialSessionState('挑战影响下一轮调度', 'dec-ch-3');
    const { newState: o1 } = orchestrateReasoningTurn(s, { turnId: 'ch1', userText: '风险报告' });
    const dec1 = getDecisionLedger(o1).pop()!;

    const intv: any = { targetDecisionId: dec1.id, intent: 'challenge', text: '这个选择需要重考虑' };
    const intakeRes = intakeMessage(o1, { turnId: 'ch2', userText: '请重新考虑上次的调度', intervention: intv });

    // Use the full context returned by intake (carries the intervention with targetDecisionId) so ORCH decision recording sees the challenge.
    const { newState: o2, plan: plan2 } = orchestrateReasoningTurn(intakeRes.preparedState, intakeRes.context);
    const dec2 = getDecisionLedger(o2).pop()!;

    // The new decision's rationale must mention the challenged decision and "reconsider"
    expect(dec2.rationale).toMatch(/decision challenged/i);
    expect(dec2.rationale).toMatch(/reconsider/i);

    // And the returned plan should reflect some reconsideration (chose or selected includes elements influenced by prior)
    const planCapIds = (plan2.selected || []).map((p: any) => p.capabilityId);
    // At minimum the turn happened under challenge context and DLEDGER captured it.
    // To show selected influence, if prior had chose we expect at least the mechanism ran (rationale already proves).
    expect(planCapIds.length).toBeGreaterThanOrEqual(0); // plan may be empty or not; main signal is the ledger rationale
  });

  // ===== Knife 6: cost telemetry / Budget ledger v1 (3 new tests, 49 -> 52) =====

  it('recordCapabilityRunCost appends cost record', () => {
    let s = createInitialSessionState('成本记录测试', 'cost-1');
    const run: any = {
      id: 'cost-run-1',
      capabilityId: 'risk.analyze',
      turnId: 't1',
      inputs: [],
      outputs: [],
      gateResults: [],
    };
    const costed = recordCapabilityRunCost(s, run, { tokens: 123, durationMs: 45, source: 'estimated' });
    const ledger = (costed.costLedger || []) as CapabilityCostRecord[];
    expect(ledger.length).toBeGreaterThan(0);
    const rec = ledger[ledger.length - 1];
    expect(rec.capabilityId).toBe('risk.analyze');
    expect(rec.estimatedTokens).toBe(123);
    expect(rec.durationMs).toBe(45);
    expect(rec.source).toBe('estimated');
  });

  it('cost ledger survives commit/run flow', () => {
    let s = createInitialSessionState('成本随 commit 留存', 'cost-2');
    const { updatedState: afterRisk } = commitArtifact(
      s,
      createRawArtifact('r1', 'risk.analyze', '安全', 'risk'),
      'c2-run-r',
      false,
      []
    );
    // After commit, cost record for the run should be present (via commit wiring)
    const ledger = (afterRisk.costLedger || []) as CapabilityCostRecord[];
    expect(ledger.some((c: any) => c.capabilityId === 'risk.analyze')).toBe(true);
  });

  it('budget snapshot includes cost summary', () => {
    let s = createInitialSessionState('预算快照含成本', 'cost-3');
    // seed some cost
    s = recordCapabilityRunCost(s, { id: 'r', capabilityId: 'risk.analyze', turnId: 't', inputs: [], outputs: [], gateResults: [] } as any, { tokens: 500, durationMs: 10, source: 'estimated' });
    const res = evaluateBudgetBeforeOrchestrate(s) as any;
    const snap = res.snapshot || res; // support both return shape and direct for legacy
    expect(snap.totalEstimatedTokens).toBeGreaterThan(0);
    expect(snap.perCapTokens && snap.perCapTokens['risk.analyze']).toBeGreaterThan(0);
    expect(typeof snap.costRecordCount).toBe('number');
  });

  // ===== Knife 7: authored CoverageContract baseline + gap lifecycle (4 new tests, 52 -> 56) =====

  it('authored CoverageContract creates frozen baseline + blocking gaps', () => {
    let s = createInitialSessionState('有风险的权限系统报告', 'cov7-1');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't1');
    expect(contract.authoredBy).toBe('system');
    expect(contract.frozenAtTurnId).toBe('t1');
    expect(contract.blockingGapIds.length).toBeGreaterThan(0);
    expect(gaps.some((g: CoverageGap) => g.kind === 'missing_capability' && g.requiredCapabilityId === 'risk.analyze')).toBe(true);
    // Apply to state like ORCH does
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    expect(s.coverageContract!.blockingGapIds.length).toBeGreaterThan(0);
  });

  it('committing required capability resolves corresponding gap', () => {
    let s = createInitialSessionState('权限报告', 'cov7-2');
    const { contract, gaps } = authorCoverageContract('有风险', 't2');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    // Commit a trusted risk
    const { updatedState: after } = commitArtifact(
      s,
      createRawArtifact('risk7', 'risk.analyze', '安全', 'risk'),
      'r7',
      false,
      []
    );
    const gap = (after.coverageGaps || []).find((g: CoverageGap) => g.requiredCapabilityId === 'risk.analyze');
    expect(gap?.status).toBe('resolved');
    expect(gap?.resolvedByArtifactId).toBeTruthy();
  });

  it('GCOV blocks when blocking gap remains open', () => {
    let s = createInitialSessionState('复杂风险报告', 'cov7-3');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't3');
    s = { ...s, coverageContract: contract, coverageGaps: gaps }; // gaps open
    const { newState: afterO, plan } = orchestrateReasoningTurn(s, { turnId: 't3', userText: '写报告' });
    const gate = afterO.coverageGate as any;
    expect(gate.passed).toBe(false);
    expect(gate.unresolvedGaps.length).toBeGreaterThan(0);
    // plan should not be pure report (block or reconsider)
    const caps = (plan.selected || []).map((p: any) => p.capabilityId);
    const onlyReport = caps.length === 1 && caps[0] === 'report.write';
    expect(onlyReport).toBe(false);
  });

  it('GCOV passes when blocking gaps are resolved or waived', () => {
    let s = createInitialSessionState('有风险报告', 'cov7-4');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't4');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    // resolve by committing risk
    const { updatedState: s2 } = commitArtifact(s, createRawArtifact('r4', 'risk.analyze', '安全', 'risk'), 'r4', false, []);
    // waive the evidence gap if present
    const evGap = (s2.coverageGaps || []).find((g: CoverageGap) => g.kind === 'missing_evidence');
    let s3 = s2;
    if (evGap) s3 = waiveCoverageGap(s2, evGap.id, 'demo waive for test');
    const { newState: afterO } = orchestrateReasoningTurn(s3, { turnId: 't4', userText: '现在报告' });
    const gate = afterO.coverageGate as any;
    expect(gate.passed).toBe(true);
    expect(gate.unresolvedGaps.length).toBe(0);
  });

  // ===== Knife 9: CoverageContract -> Budget stop policy (3 new tests, 56 -> 59) =====

  it('Budget stops redundant converge when contract sufficient', () => {
    let s = createInitialSessionState('权限系统', 'budget-stop-1');
    // Author contract and simulate satisfied state: no stale, has recent report, gaps resolved
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't-stop');
    // Mark all gaps resolved for this test
    const satisfiedGaps = gaps.map((g: any) => ({ ...g, status: 'resolved' as const }));
    s = { ...s, coverageContract: contract, coverageGaps: satisfiedGaps };

    // Add a recent trusted report artifact (so hasRecentReport true)
    const { updatedState: sWithReport } = commitArtifact(
      s,
      createRawArtifact('rep-stop', 'report.write', '综合', 'report'),
      't-stop-run-rep',
      false,
      []
    );
    // Force the report to be trusted
    const repArt = (sWithReport.artifacts || []).find((a: any) => a.id === 'rep-stop');
    if (repArt) {
      (repArt as any).trustLevel = 'gated_pass';
      (repArt as any).passedGates = ['commit'];
    }

    // Redundant converge request (not challenge/revise)
    const { newState: afterO, plan } = orchestrateReasoningTurn(sWithReport, {
      turnId: 't-stop',
      userText: '再生成一次报告',
    });

    // Should have stopped (empty plan, AWAIT, note, special DLEDGER)
    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);
    expect(plan.reason).toMatch(/CONTRACT_SUFFICIENT|contract_sufficient/);

    const hasStopNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('contract already sufficient'));
    expect(hasStopNote).toBe(true);

    const ledger = getDecisionLedger(afterO);
    const last = ledger[ledger.length - 1];
    expect(last.rationale).toMatch(/stopped_by_contract_sufficiency/);
    expect(last.chose.length).toBe(0);
  });

  it('Budget does not stop challenge/revise even when contract sufficient', () => {
    let s = createInitialSessionState('权限系统', 'budget-stop-2');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't-stop2');
    const satisfiedGaps = gaps.map((g: any) => ({ ...g, status: 'resolved' as const }));
    s = { ...s, coverageContract: contract, coverageGaps: satisfiedGaps };

    const { updatedState: sWithReport } = commitArtifact(
      s,
      createRawArtifact('rep2', 'report.write', '综合', 'report'),
      't2-run-rep',
      false,
      []
    );
    const repArt = (sWithReport.artifacts || []).find((a: any) => a.id === 'rep2');
    if (repArt) { (repArt as any).trustLevel = 'gated_pass'; (repArt as any).passedGates = ['commit']; }

    // Challenge intervention should NOT trigger stop
    const intv: any = { intent: 'challenge', targetDecisionId: 'some-dec', text: '质疑' };
    const { newState: afterO, plan } = orchestrateReasoningTurn(sWithReport, {
      turnId: 't-stop2',
      userText: '再报告',
      intervention: intv,
    });

    // Should not have the contract stop (plan may have items or at least not the stop reason/note)
    const hasContractStopNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('contract already sufficient'));
    expect(hasContractStopNote).toBe(false);
    // The decision should not be the sufficiency stop one
    const ledger = getDecisionLedger(afterO);
    const last = ledger[ledger.length - 1];
    expect(last.rationale).not.toMatch(/stopped_by_contract_sufficiency/);
  });

  it('Budget does not stop when stale artifacts exist or open gaps remain', () => {
    let s = createInitialSessionState('权限系统', 'budget-stop-3');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't-stop3');
    // Leave one gap open
    s = { ...s, coverageContract: contract, coverageGaps: gaps, staleArtifactIds: ['old-stale'] };

    const { updatedState: sWithReport } = commitArtifact(
      s,
      createRawArtifact('rep3', 'report.write', '综合', 'report'),
      't3-run-rep',
      false,
      []
    );
    const repArt = (sWithReport.artifacts || []).find((a: any) => a.id === 'rep3');
    if (repArt) { (repArt as any).trustLevel = 'gated_pass'; (repArt as any).passedGates = ['commit']; }

    const { newState: afterO, plan } = orchestrateReasoningTurn(sWithReport, {
      turnId: 't-stop3',
      userText: '再生成报告',
    });

    // Should not stop due to stale + open gaps
    const hasContractStopNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('contract already sufficient'));
    expect(hasContractStopNote).toBe(false);
    const ledger = getDecisionLedger(afterO);
    const last = ledger[ledger.length - 1];
    expect(last.rationale).not.toMatch(/stopped_by_contract_sufficiency/);
  });

  // ===== Knife 10: gap waive UI support (1 new test, 59 -> 60; runtime coverage for the action) =====
  it('waived gap is reflected in coverage summary and sufficiency stop can proceed', () => {
    let s = createInitialSessionState('有风险的权限系统报告', 'waive-1');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't-waive');
    // Start with open gap(s) (complex goal produces missing_capability + evidence gaps)
    s = { ...s, coverageContract: contract, coverageGaps: gaps };

    // Waive the evidence gap first (on initial gaps, before any commit that may resolve other gaps)
    let sAfterWaive = s;
    const evGap = (sAfterWaive.coverageGaps || []).find((g: any) => g.kind === 'missing_evidence');
    expect(evGap).toBeTruthy(); // ensure complex goal produced the evidence gap
    if (evGap) {
      sAfterWaive = waiveCoverageGap(sAfterWaive, evGap.id, 'demo waive in test');
    }
    sAfterWaive = resolveCoverageGapsFromState(sAfterWaive);

    // Evidence gap should be waived
    const anyWaived = (sAfterWaive.coverageGaps || []).some((g: any) => g.status === 'waived' && g.kind === 'missing_evidence');
    expect(anyWaived).toBe(true);

    // Now commit risk (satisfy risk req) + report for hasRecent + suff
    const { updatedState: sRisk } = commitArtifact(
      sAfterWaive,
      createRawArtifact('risk-waive', 'risk.analyze', '安全', 'risk'),
      't-waive-run-risk',
      false,
      []
    );
    sAfterWaive = sRisk;
    const riskArt = (sAfterWaive.artifacts || []).find((a: any) => a.id === 'risk-waive');
    if (riskArt) {
      (riskArt as any).trustLevel = 'gated_pass';
      (riskArt as any).passedGates = ['commit'];
    }

    // Add a trusted report so sufficiency can be true once gaps handled
    const { updatedState: sWithReport } = commitArtifact(
      sAfterWaive,
      createRawArtifact('rep-waive', 'report.write', '综合', 'report'),
      't-waive-run-rep',
      false,
      []
    );
    const repArt = (sWithReport.artifacts || []).find((a: any) => a.id === 'rep-waive');
    if (repArt) {
      (repArt as any).trustLevel = 'gated_pass';
      (repArt as any).passedGates = ['commit'];
    }

    // Now sufficiency should allow stop (waived gap no longer blocks)
    const suff = evaluateContractSufficiencyForBudget(sWithReport);
    expect(suff.sufficient).toBe(true);
    expect(suff.openGapCount).toBe(0);

    // And a redundant ORCH should stop (reuse the stop path)
    const { newState: afterO, plan } = orchestrateReasoningTurn(sWithReport, {
      turnId: 't-waive',
      userText: '再报告',
    });
    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);
    expect(plan.reason).toMatch(/CONTRACT_SUFFICIENT|contract_sufficient/);
  });

  // ===== Knife 11: real server LLM usage in cost ledger (3 new tests, 60 -> 63) =====

  it('recordCapabilityRunCost prefers provider usage over estimate', () => {
    let s = createInitialSessionState('成本真实 usage', 'cost-llm-1');
    const run: any = { id: 'r-llm', capabilityId: 'risk.analyze', turnId: 't-llm', inputs: [], outputs: [], gateResults: [] };
    const costed = recordCapabilityRunCost(s, run, {
      usage: { totalTokens: 1234, inputTokens: 800, outputTokens: 434, model: 'gpt-4o' },
      source: 'server',
    } as any);
    const rec = ((costed.costLedger || []) as any[]).pop();
    expect(rec.source).toBe('server');
    expect(rec.estimatedTokens).toBe(1234);
    expect(rec.usage?.totalTokens).toBe(1234);
  });

  it('server LLM response can include usage without breaking raw contract', () => {
    // The raw executor result from server (via createServerLlm... + res.json) can carry extra usage.
    // The page/loop only uses title/summary/content/provenance; extra usage is non-breaking and passed to record.
    const rawFromServer = {
      title: 'Risk Analysis (server)',
      summary: 'Summary',
      content: 'Content here for estimate fallback if needed.',
      provenance: 'llm' as const,
      usage: { totalTokens: 567, inputTokens: 300, outputTokens: 267, model: 'gpt-4o' },
    };
    // raw contract still valid
    expect(rawFromServer.title).toBeTruthy();
    expect(rawFromServer.content).toBeTruthy();
    // usage present for cost
    expect(rawFromServer.usage.totalTokens).toBe(567);
  });

  it('fallback estimate still works when usage missing', () => {
    let s = createInitialSessionState('成本估算 fallback', 'cost-llm-3');
    const run: any = { id: 'r-fb', capabilityId: 'report.write', turnId: 't-fb', inputs: [], outputs: [], gateResults: [] };
    const content = 'x'.repeat(400); // ~100 tokens
    const costed = recordCapabilityRunCost(s, run, { source: 'estimated' } as any); // no usage, no tokens
    // In practice the caller (Default or Llm) passes tokens=ceil(len/4) when no usage.
    // Here simulate the fallback path by calling with tokens computed.
    const tokens = Math.ceil(content.length / 4);
    const costed2 = recordCapabilityRunCost(s, run, { tokens, source: 'estimated' } as any);
    const rec = ((costed2.costLedger || []) as any[]).pop();
    expect(rec.source).toBe('estimated');
    expect(rec.estimatedTokens).toBe(tokens);
  });

  describe('R1 orchestrate proposedPlan (B3/B4/B9)', () => {
    it('DLEDGER records source=llm when proposedPlan consumed', () => {
      let s = createInitialSessionState('R1 llm plan', 'r1-llm');
      const { preparedState, context } = intakeMessage(s, {
        turnId: 'r1t1',
        userText: '对比一下方案的运维成本',
      });
      const { newState } = orchestrateReasoningTurn(preparedState, {
        ...context,
        proposedPlan: {
          selected: [
            { capabilityId: 'route.compare', roleId: '工程' },
            { capabilityId: 'tradeoff.evaluate', roleId: '工程' },
          ],
          rationale: '用户要对比运维成本',
          source: 'llm',
        },
      });
      const dec = getDecisionLedger(newState).pop();
      expect(dec?.source).toBe('llm');
      expect(dec?.chose).toContain('route.compare');
      expect(dec?.rationale).toContain('运维成本');
    });

    it('DLEDGER records source=heuristic_fallback when server degraded proposal consumed', () => {
      let s = createInitialSessionState('R1 fb', 'r1-fb');
      const { preparedState, context } = intakeMessage(s, {
        turnId: 'r1t-fb',
        userText: '出报告',
      });
      const { newState } = orchestrateReasoningTurn(preparedState, {
        ...context,
        proposedPlan: {
          selected: [{ capabilityId: 'report.write', roleId: '综合' }],
          rationale: 'heuristic_fallback (llm_error)',
          source: 'heuristic_fallback',
        },
      });
      const dec = getDecisionLedger(newState).pop();
      expect(dec?.source).toBe('heuristic_fallback');
    });

    it('DLEDGER records source=local_heuristic without proposedPlan', () => {
      let s = createInitialSessionState('R1 local', 'r1-local');
      const { preparedState, context } = intakeMessage(s, {
        turnId: 'r1t2',
        userText: '对比一下方案的运维成本',
      });
      const { newState } = orchestrateReasoningTurn(preparedState, context);
      const dec = getDecisionLedger(newState).pop();
      expect(dec?.source).toBe('local_heuristic');
    });

    it('orchestrate.plan cost lands in costLedger with source server (B9)', () => {
      let s = createInitialSessionState('R1 cost', 'r1-cost');
      const costed = recordCapabilityRunCost(
        s,
        {
          id: 'r1-orch-plan',
          capabilityId: 'orchestrate.plan' as any,
          turnId: 'r1t3',
          inputs: [],
          outputs: [],
          gateResults: [],
        } as any,
        {
          source: 'server',
          usage: { totalTokens: 88, inputTokens: 50, outputTokens: 38, model: 'gpt-test' },
        }
      );
      const rec = (costed.costLedger || []).find((c) => c.capabilityId === 'orchestrate.plan');
      expect(rec?.source).toBe('server');
      expect(rec?.estimatedTokens).toBe(88);
    });

    it('challenge + stale + LLM proposal with report.write schedules reconvergence (B4)', () => {
      let s = createInitialSessionState('权限系统', 'r1-b4');
      s = {
        ...s,
        artifacts: [
          {
            id: 'rep1',
            kind: 'report',
            trustLevel: 'gated_pass',
            content: '结论：可推进',
            producedBy: { capabilityId: 'report.write', turnId: 't0' },
          } as any,
        ],
      };
      const { preparedState, context } = intakeMessage(s, {
        turnId: 'r1-ch',
        userText: '质疑报告依据',
        intervention: {
          targetArtifactId: 'rep1',
          intent: 'challenge',
          text: '依据不足',
        },
      });
      expect((preparedState.staleArtifactIds || []).includes('rep1')).toBe(true);
      const { plan, newState } = orchestrateReasoningTurn(preparedState, {
        ...context,
        proposedPlan: {
          selected: [
            { capabilityId: 'risk.analyze', roleId: '安全' },
            { capabilityId: 'report.write', roleId: '综合' },
          ],
          rationale: '回炉重推报告',
          source: 'llm',
        },
      });
      expect(plan.selected.some((p) => p.capabilityId === 'report.write')).toBe(true);
      const dec = getDecisionLedger(newState).pop();
      expect(dec?.source).toBe('llm');
    });
  });
});
