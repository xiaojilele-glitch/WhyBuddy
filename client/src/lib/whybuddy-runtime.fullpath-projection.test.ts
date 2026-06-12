/**
 * WhyBuddy V5.1 Full-Path Acceptance Test Plan — Batch 3a: runtime projection & persistence.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 scenarios S21, S22; §4 edges 9/113/114/115/116/117).
 *
 * Scope of THIS file:
 *  - S21 (🟡) runtime projection & replay
 *      · P3 (✅ core): assertDeriveReadOnly — DERIVE leaves authoritative STATE deep-equal, only
 *        graph.nodes[].status may change (rich session).
 *      · ✅ P3 residual: durable store must NOT carry graph.nodes[].status (strip on save).
 *      · ✅ incremental derive: projectionDirtyNodeIds + incremental:true recomputes only dirty nodes.
 *      · ✅ edge 117: sessionReplayLog + loadSessionReplayEvents (JOB→REPLAY→STORE, per sessionId).
 *      · Replay isolation by sessionId through the durable store (load/list isolate sessions).
 *  - S22 (🟡) persistence & session isolation
 *      · save a converged session, load it back by the SAME sessionId, assert
 *        goal/artifacts/staleArtifactIds/decisionLedger fully restored, then continue with a
 *        challenge (resume from breakpoint).
 *      · dual-session isolation: session A's challenge does not affect session B's stale set.
 *      · ✅ refresh persistence: shared durable backing survives a fresh store instance (models B-5).
 *
 * Every assertion is mechanical / binary, sourced ONLY from V5SessionState, the durable store
 * contract, and pure runtime helpers (deriveNodeStatus / assertDeriveReadOnly) — never human
 * judgement.
 *
 * STORE NOTE: `InMemoryWhyBuddySessionStore` is NOT exported from whybuddy-runtime.ts (only the
 * default instance is installed internally). To drive "two sessions through the InMemory store" as
 * the doc asks while staying fully isolated per-test, this file installs a local
 * `TestInMemorySessionStore` that mirrors the runtime's in-memory impl byte-for-byte (same meta /
 * createdAt / lastActive / listSessions shape), via setWhyBuddySessionStore in beforeEach and
 * restores the original store in afterEach so no state leaks across tests or files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  deriveNodeStatus,
  invalidateForIntervention,
  saveSessionState,
  loadOrCreateSessionState,
  listWhyBuddySessions,
  deleteWhyBuddySession,
  setWhyBuddySessionStore,
  getWhyBuddySessionStore,
  loadSessionReplayEvents,
  replaySessionEvents,
  type WhyBuddySessionStore,
} from './whybuddy-runtime';
import { replayEventsBelongToSession } from '@shared/blueprint/whybuddy-session-replay';
import { assertDeriveReadOnly } from './whybuddy-derive-readonly-guard';
import { buildClearStateWithTrustedReport, COMPLEX_GOAL_TEXT } from './whybuddy-fullpath-fixtures';
import { persistedStateHasNodeStatus } from '@shared/blueprint/whybuddy-projection-persist';
import type { V5SessionState, UserIntervention } from '@shared/blueprint/v5-reasoning-state';

// ---------------------------------------------------------------------------------------
// Local in-memory store mirroring the runtime's (unexported) InMemoryWhyBuddySessionStore.
// Same module-level Map + meta semantics so the durable-store contract is exercised faithfully.
// ---------------------------------------------------------------------------------------
class TestInMemorySessionStore implements WhyBuddySessionStore {
  private readonly store = new Map<string, V5SessionState>();
  private readonly meta = new Map<string, { createdAt: string; lastActive: string }>();

  async load(sessionId: string): Promise<V5SessionState | undefined> {
    const s = this.store.get(sessionId);
    if (s) {
      const m = this.meta.get(sessionId);
      if (m) return { ...s, createdAt: m.createdAt, lastActive: m.lastActive } as any;
    }
    return s;
  }

  async save(state: V5SessionState): Promise<V5SessionState> {
    const sessionId = state.sessionId || 'whybuddy-local-proto';
    const now = new Date().toISOString();
    const existingMeta = this.meta.get(sessionId);
    const createdAt = existingMeta?.createdAt || now;
    const saved = { ...state, sessionId, lastActive: now } as any;
    if (!saved.createdAt) saved.createdAt = createdAt;
    this.store.set(sessionId, saved);
    this.meta.set(sessionId, { createdAt, lastActive: now });
    return saved;
  }

  clear(): void {
    this.store.clear();
    this.meta.clear();
  }

  listSessions() {
    const out: any[] = [];
    for (const [sid, s] of this.store) {
      const m = this.meta.get(sid);
      out.push({
        sessionId: sid,
        goal: s.goal?.text || '',
        createdAt: m?.createdAt || (s as any).createdAt,
        lastActive: m?.lastActive || (s as any).lastActive,
        artifactCount: (s.artifacts || []).length,
        phase: (s as any).runtimePhase,
      });
    }
    return out;
  }

  deleteSession(sessionId: string): void {
    this.store.delete(sessionId);
    this.meta.delete(sessionId);
  }
}

/** Module-level backing shared across fresh store instances (models Http refresh / B-5). */
const sharedDurableBacking = new Map<string, V5SessionState>();
const sharedDurableMeta = new Map<string, { createdAt: string; lastActive: string }>();

function clearSharedDurableBacking(): void {
  sharedDurableBacking.clear();
  sharedDurableMeta.clear();
}

class TestSharedDurableSessionStore implements WhyBuddySessionStore {
  async load(sessionId: string): Promise<V5SessionState | undefined> {
    const s = sharedDurableBacking.get(sessionId);
    if (s) {
      const m = sharedDurableMeta.get(sessionId);
      if (m) return { ...s, createdAt: m.createdAt, lastActive: m.lastActive } as any;
    }
    return s;
  }

  async save(state: V5SessionState): Promise<V5SessionState> {
    const sessionId = state.sessionId || 'whybuddy-local-proto';
    const now = new Date().toISOString();
    const existingMeta = sharedDurableMeta.get(sessionId);
    const createdAt = existingMeta?.createdAt || now;
    const saved = { ...state, sessionId, lastActive: now } as any;
    if (!saved.createdAt) saved.createdAt = createdAt;
    sharedDurableBacking.set(sessionId, saved);
    sharedDurableMeta.set(sessionId, { createdAt, lastActive: now });
    return saved;
  }

  listSessions() {
    const out: any[] = [];
    for (const [sid, s] of sharedDurableBacking) {
      const m = sharedDurableMeta.get(sid);
      out.push({
        sessionId: sid,
        goal: s.goal?.text || '',
        createdAt: m?.createdAt || (s as any).createdAt,
        lastActive: m?.lastActive || (s as any).lastActive,
        artifactCount: (s.artifacts || []).length,
        phase: (s as any).runtimePhase,
      });
    }
    return out;
  }

  deleteSession(sessionId: string): void {
    sharedDurableBacking.delete(sessionId);
    sharedDurableMeta.delete(sessionId);
  }
}

function createSharedDurableStore(): TestSharedDurableSessionStore {
  return new TestSharedDurableSessionStore();
}

let originalStore: WhyBuddySessionStore;

beforeEach(() => {
  originalStore = getWhyBuddySessionStore();
  clearSharedDurableBacking();
  setWhyBuddySessionStore(new TestInMemorySessionStore());
});

afterEach(() => {
  setWhyBuddySessionStore(originalStore);
});

/** A second, distinct session (one orchestrate turn) for isolation assertions. */
function buildSimpleSession(sessionId: string): V5SessionState {
  const s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
  const { newState } = orchestrateReasoningTurn(s, { turnId: `${sessionId}-t1`, userText: '分析安全风险' });
  return newState;
}

// =====================================================================================
// S21 · 运行时投影与回放（runtime projection & replay）🟡
// =====================================================================================

describe('S21 · runtime projection & replay', () => {
  it('P3 (core): deriveNodeStatus leaves authoritative STATE deep-equal, only graph.nodes[].status may change (rich session)', () => {
    const { state } = buildClearStateWithTrustedReport('S21-p3');
    // Rich session sanity: real nodes + artifacts + decisions to project over.
    expect((state.graph?.nodes || []).length).toBeGreaterThan(0);
    expect((state.artifacts || []).length).toBeGreaterThan(0);
    expect((state.decisionLedger || []).length).toBeGreaterThan(0);

    const before = structuredClone(state);
    const after = deriveNodeStatus(state);

    // Input not mutated.
    expect(state).toEqual(before);
    // The guard throws on any authoritative-field write; only graph.nodes[].status may differ.
    assertDeriveReadOnly(before, after);
  });

  it('edge 117: JOB→REPLAY / REPLAY→STORE — replay events are session-isolated', async () => {
    const a = buildClearStateWithTrustedReport('S21-replay-A');
    const b = buildSimpleSession('S21-replay-B');

    await saveSessionState(a.state);
    await saveSessionState(b);

    const replayA = await loadSessionReplayEvents('S21-replay-A');
    const replayB = await loadSessionReplayEvents('S21-replay-B');

    expect(replayA.length).toBeGreaterThan(0);
    expect(replayB.length).toBeGreaterThan(0);
    expect(replayEventsBelongToSession(replayA, 'S21-replay-A')).toBe(true);
    expect(replayEventsBelongToSession(replayB, 'S21-replay-B')).toBe(true);

    const aRunIds = new Set(replayA.filter((e) => e.capabilityRunId).map((e) => e.capabilityRunId));
    const bRunIds = new Set(replayB.filter((e) => e.capabilityRunId).map((e) => e.capabilityRunId));
    for (const id of aRunIds) expect(bRunIds.has(id!)).toBe(false);

    const aTurnIds = replayA.map((e) => e.turnId).filter(Boolean).join('|');
    const bTurnIds = replayB.map((e) => e.turnId).filter(Boolean).join('|');
    expect(aTurnIds).not.toMatch(/S21-replay-B/);
    expect(bTurnIds).not.toMatch(/S21-replay-A/);

    const loadedA = await loadOrCreateSessionState('S21-replay-A');
    expect(replaySessionEvents(loadedA).length).toBe(replayA.length);
  });

  it('Replay isolation by sessionId: loading session A never surfaces session B events/artifacts', async () => {
    const a = buildClearStateWithTrustedReport('S21-iso-A');
    const b = buildSimpleSession('S21-iso-B');

    await saveSessionState(a.state);
    await saveSessionState(b);

    // listWhyBuddySessions surfaces both, keyed by sessionId.
    const list = await listWhyBuddySessions();
    const ids = list.map((e: any) => e.sessionId);
    expect(ids).toContain('S21-iso-A');
    expect(ids).toContain('S21-iso-B');

    // Load each back by id: STATE is isolated by sessionId.
    const loadedA = await loadOrCreateSessionState('S21-iso-A');
    const loadedB = await loadOrCreateSessionState('S21-iso-B');
    expect(loadedA.sessionId).toBe('S21-iso-A');
    expect(loadedB.sessionId).toBe('S21-iso-B');

    // Session A's artifact ids and session B's artifact ids are disjoint (no cross-session bleed).
    const aArtIds = new Set((loadedA.artifacts || []).map((x) => x.id));
    const bArtIds = new Set((loadedB.artifacts || []).map((x) => x.id));
    for (const id of aArtIds) expect(bArtIds.has(id)).toBe(false);
    // A's trusted report is present in A and absent from B.
    expect(aArtIds.has(a.reportId)).toBe(true);
    expect(bArtIds.has(a.reportId)).toBe(false);

    // Conversation streams are isolated too (B's turn id never appears in A).
    const aConvIds = (loadedA.conversation || []).map((c: any) => c.id).join('|');
    expect(aConvIds).not.toMatch(/S21-iso-B/);
  });

  it('P3 residual: the persisted (saved) state should NOT carry the node-status projection', async () => {
    const { state } = buildClearStateWithTrustedReport('S21-residual');
    const returned = await saveSessionState(state);
    // Caller still receives a derived projection for UI.
    expect(persistedStateHasNodeStatus(returned)).toBe(true);

    const persisted = await getWhyBuddySessionStore().load('S21-residual');
    expect(persisted).toBeTruthy();
    expect(persistedStateHasNodeStatus(persisted!)).toBe(false);
  });

  it('incremental derive: marking nodes dirty should recompute only the dirty node', () => {
    const { state } = buildClearStateWithTrustedReport('S21-incremental');
    const nodes = state.graph?.nodes || [];
    expect(nodes.length).toBeGreaterThan(1);
    const dirtyId = (nodes[0] as { id?: string }).id!;

    const corrupted: V5SessionState = {
      ...state,
      graph: {
        ...state.graph,
        nodes: nodes.map((n: any) => ({ ...n, status: 'pending' })),
      },
      projectionDirtyNodeIds: [dirtyId],
    };

    const after = deriveNodeStatus(corrupted, { incremental: true });
    const beforeNodes = corrupted.graph.nodes || [];
    const afterNodes = after.graph?.nodes || [];
    const changed = afterNodes.filter(
      (n: any, i: number) => n.status !== (beforeNodes[i] as any).status
    ).length;
    expect(changed).toBeLessThanOrEqual(1);
  });
});

// =====================================================================================
// S22 · 持久化与会话隔离（persistence & session isolation）🟡
// =====================================================================================

describe('S22 · persistence & session isolation', () => {
  it('round-trip: a converged session reloads by the SAME sessionId with goal/artifacts/staleArtifactIds/decisionLedger fully restored, then resumes a challenge from the breakpoint', async () => {
    const sessionId = 'S22-roundtrip';
    const { state, reportId, riskId } = buildClearStateWithTrustedReport(sessionId);
    expect(state.goal.status).toBe('clear');

    // Persist (saveSessionState derives before save), then load back by the SAME sessionId.
    await saveSessionState(state);
    const restored = await loadOrCreateSessionState(sessionId);

    // Full restoration of the authoritative fields the doc names.
    expect(restored.goal.status).toBe('clear');
    expect(restored.goal.text).toBe(state.goal.text);
    expect((restored.artifacts || []).map((a) => a.id).sort()).toEqual(
      (state.artifacts || []).map((a) => a.id).sort()
    );
    expect(restored.staleArtifactIds || []).toEqual(state.staleArtifactIds || []);
    expect((restored.decisionLedger || []).map((d) => d.id)).toEqual(
      (state.decisionLedger || []).map((d) => d.id)
    );
    // The trusted report survived the round-trip with its trust intact.
    const restoredReport = (restored.artifacts || []).find((a) => a.id === reportId);
    expect(restoredReport).toBeTruthy();
    expect(['gated_pass', 'audited']).toContain(restoredReport!.trustLevel);

    // Resume from the breakpoint: challenge the restored conclusion (continue into S4 territory).
    const challenged = invalidateForIntervention(restored, {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '刷新恢复后继续挑战这个风险结论',
    } as UserIntervention);

    // C-2 downgrade still works on the restored state, and the cascade staled the report.
    expect(challenged.goal.status).toBe('needs_refinement');
    expect(challenged.staleArtifactIds).toContain(riskId);
    expect(challenged.staleArtifactIds).toContain(reportId);

    // The resumed state persists back under the same sessionId (no session restart).
    const resaved = await saveSessionState(challenged);
    expect(resaved.sessionId).toBe(sessionId);
  });

  it('dual-session isolation: session A\'s challenge does not affect session B\'s stale set', async () => {
    const aBuilt = buildClearStateWithTrustedReport('S22-iso-A');
    const bBuilt = buildClearStateWithTrustedReport('S22-iso-B');

    await saveSessionState(aBuilt.state);
    await saveSessionState(bBuilt.state);

    // Challenge ONLY session A, then persist A.
    const aChallenged = invalidateForIntervention(aBuilt.state, {
      targetArtifactId: aBuilt.riskId,
      intent: 'challenge',
      text: '只挑战 A 会话',
    } as UserIntervention);
    expect(aChallenged.staleArtifactIds.length).toBeGreaterThan(0);
    await saveSessionState(aChallenged);

    // Reload both: A carries the new stale set; B is untouched.
    const loadedA = await loadOrCreateSessionState('S22-iso-A');
    const loadedB = await loadOrCreateSessionState('S22-iso-B');

    expect(loadedA.staleArtifactIds).toContain(aBuilt.riskId);
    expect(loadedA.goal.status).toBe('needs_refinement');

    // B's stale set is still empty and B's conclusion is still clear (no cross-session leakage).
    expect(loadedB.staleArtifactIds || []).toEqual([]);
    expect(loadedB.goal.status).toBe('clear');
  });

  it('deleteWhyBuddySession removes only the targeted session (isolation on delete)', async () => {
    await saveSessionState(buildClearStateWithTrustedReport('S22-del-A').state);
    await saveSessionState(buildClearStateWithTrustedReport('S22-del-B').state);

    await deleteWhyBuddySession('S22-del-A');

    const ids = (await listWhyBuddySessions()).map((e: any) => e.sessionId);
    expect(ids).not.toContain('S22-del-A');
    expect(ids).toContain('S22-del-B');
  });

  it('refresh persistence: a session saved before "refresh" should be recoverable after a fresh store instance', async () => {
    const sessionId = 'S22-refresh';
    const { state } = buildClearStateWithTrustedReport(sessionId);

    setWhyBuddySessionStore(createSharedDurableStore());
    await saveSessionState(state);

    // Simulate browser refresh: new store adapter, same durable backing (Http / B-5 model).
    setWhyBuddySessionStore(createSharedDurableStore());

    const afterRefresh = await loadOrCreateSessionState(sessionId);
    expect(afterRefresh.goal.status).toBe('clear');
  });
});
