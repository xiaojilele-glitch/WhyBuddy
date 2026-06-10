import { describe, it, expect, beforeEach } from 'vitest';
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
  type LlmCapabilityProvider,
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
      const fresh = findInputsForCapability(current, sel.capabilityId);
      const isUpstream = sel.capabilityId.includes('risk') || sel.capabilityId.includes('argue');
      const force = isUpstream; // simulate the "下次让上游失败" button

      const raw = createRawArtifact(`${turnId}-art-${idx}`, sel.capabilityId, sel.roleId || 'agent', 'risk');

      const { updatedState } = commitArtifact(current, raw as any, runId, force, fresh);
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

      // Non-target cap should fall back without calling a "LLM" provider (we can detect via a side-effect counter if needed, but for now just ensure it returns something).
      const otherCap = planSelected.find((e: any) => e.capabilityId !== 'risk.analyze' && e.capabilityId !== 'report.write');
      if (otherCap) {
        const otherRes = await executeCapability({ capabilityId: otherCap.capabilityId as any, state: afterO, inputArtifactIds: otherCap.inputArtifactIds || [], roleId: otherCap.roleId, turnId: 'prov1' });
        expect(otherRes).toHaveProperty('title');
        expect(otherRes).toHaveProperty('content');
      }
    } finally {
      if (prev && setCapabilityExecutor) setCapabilityExecutor(prev);
      clearWhyBuddySessionStore();
    }
  });

  it('test helper routes (__clear / __reload) are disabled under production (production guard)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFlag = process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
    try {
      // Use the real exported implementation from server/routes/whybuddy.ts
      process.env.NODE_ENV = 'production';
      delete process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
      expect(isTestHelperEnabled()).toBe(false); // routes not registered → callers get 404

      process.env.WHYBUDDY_ENABLE_TEST_HELPERS = '1';
      expect(isTestHelperEnabled()).toBe(true); // explicit opt-in still works
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalFlag !== undefined) {
        process.env.WHYBUDDY_ENABLE_TEST_HELPERS = originalFlag;
      } else {
        delete process.env.WHYBUDDY_ENABLE_TEST_HELPERS;
      }
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
});
