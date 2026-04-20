import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  MissionDecision,
  MissionDecisionOption,
  MissionRecord,
} from '../../shared/mission/contracts.js';
import { BUILTIN_DECISION_TEMPLATES } from '../../shared/mission/decision-templates.js';
import {
  submitMissionDecision,
  type MissionDecisionRuntime,
} from '../tasks/mission-decision.js';
import { createTaskRouter, createDecisionTemplatesRouter } from '../routes/tasks.js';
import { MissionRuntime } from '../tasks/mission-runtime.js';
import { MissionStore } from '../tasks/mission-store.js';

/* ─── Mock MissionDecisionRuntime ─── */

function createMockRuntime(initialTasks: MissionRecord[] = []): MissionDecisionRuntime & {
  tasks: Map<string, MissionRecord>;
} {
  const tasks = new Map<string, MissionRecord>();
  for (const t of initialTasks) {
    tasks.set(t.id, structuredClone(t));
  }

  return {
    tasks,
    getTask(id: string) {
      const t = tasks.get(id);
      return t ? structuredClone(t) : undefined;
    },
    resumeMissionFromDecision(id, submission) {
      const t = tasks.get(id);
      if (!t) return undefined;
      t.status = 'running';
      t.waitingFor = undefined;
      t.decision = undefined;
      t.updatedAt = Date.now();
      tasks.set(id, t);
      return structuredClone(t);
    },
  };
}

function makeWaitingTask(
  id: string,
  decision: MissionDecision,
  overrides: Partial<MissionRecord> = {},
): MissionRecord {
  return {
    id,
    kind: 'chat',
    title: 'Test task',
    status: 'waiting',
    progress: 50,
    currentStageKey: 'execute',
    stages: [{ key: 'execute', label: 'Run execution', status: 'running' }],
    waitingFor: decision.prompt,
    decision,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    ...overrides,
  };
}

/* ─── Unit Tests ─── */

describe('submitMissionDecision — requiresComment validation', () => {
  it('returns 400 when option has requiresComment=true and freeText is empty', () => {
    const decision: MissionDecision = {
      prompt: 'Approve the plan?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject', requiresComment: true },
      ],
    };
    const task = makeWaitingTask('task_1', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_1', {
      optionId: 'reject',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('comment');
    }
  });

  it('succeeds when option has requiresComment=true and freeText is provided', () => {
    const decision: MissionDecision = {
      prompt: 'Approve the plan?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject', requiresComment: true },
      ],
      allowFreeText: true,
    };
    const task = makeWaitingTask('task_2', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_2', {
      optionId: 'reject',
      freeText: 'Needs more detail on step 3',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.optionId).toBe('reject');
      expect(result.decision.freeText).toBe('Needs more detail on step 3');
    }
  });
});

describe('submitMissionDecision — decision history append', () => {
  it('appends a DecisionHistoryEntry after successful decision', () => {
    const decision: MissionDecision = {
      prompt: 'Choose direction',
      options: [
        { id: 'left', label: 'Go Left' },
        { id: 'right', label: 'Go Right' },
      ],
      type: 'multi-choice',
      decisionId: 'dec_test_001',
    };
    const task = makeWaitingTask('task_3', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_3', { optionId: 'left' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const history = result.task.decisionHistory ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].decisionId).toBe('dec_test_001');
      expect(history[0].type).toBe('multi-choice');
      expect(history[0].resolved.optionId).toBe('left');
      expect(history[0].resolved.optionLabel).toBe('Go Left');
      expect(history[0].submittedAt).toBeGreaterThan(0);
    }
  });

  it('accumulates multiple decisions in decisionHistory', () => {
    const decision1: MissionDecision = {
      prompt: 'Step 1',
      options: [{ id: 'a', label: 'A' }],
      decisionId: 'dec_1',
    };
    const task = makeWaitingTask('task_4', decision1);
    const runtime = createMockRuntime([task]);

    // First decision
    const r1 = submitMissionDecision(runtime, 'task_4', { optionId: 'a' });
    expect(r1.ok).toBe(true);

    // submitMissionDecision appends history to the returned task clone.
    // Sync that history back into the mock store so the second call sees it.
    if (r1.ok) {
      const inner = runtime.tasks.get('task_4')!;
      inner.decisionHistory = structuredClone(r1.task.decisionHistory ?? []);
      inner.status = 'waiting';
      inner.decision = {
        prompt: 'Step 2',
        options: [{ id: 'b', label: 'B' }],
        decisionId: 'dec_2',
      };
      inner.waitingFor = 'Step 2';
      runtime.tasks.set('task_4', inner);
    }

    // Second decision
    const r2 = submitMissionDecision(runtime, 'task_4', { optionId: 'b' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      const history = r2.task.decisionHistory ?? [];
      expect(history).toHaveLength(2);
      expect(history[0].decisionId).toBe('dec_1');
      expect(history[1].decisionId).toBe('dec_2');
    }
  });
});

describe('submitMissionDecision — multi-step decision chain', () => {
  it('when orchestrator puts task back into waiting, task enters waiting again with new decision', async () => {
    // Use MissionRuntime + MissionStore to simulate the multi-step chain.
    // Note: Both MissionStore.resolveWaiting and submitMissionDecision append
    // to decisionHistory, so each decision produces 2 history entries when
    // going through the real runtime. We verify the chain behavior here.
    const store = new MissionStore();
    const missionRuntime = new MissionRuntime({ store, autoRecover: false });

    const task = missionRuntime.createChatTask('Multi-step test');
    missionRuntime.markMissionRunning(task.id, 'execute', 'Running', 50);
    missionRuntime.waitOnMission(task.id, 'first decision', 'Choose path', 50, {
      prompt: 'Choose path',
      options: [
        { id: 'path-a', label: 'Path A' },
        { id: 'path-b', label: 'Path B' },
      ],
    });

    // Submit first decision — task should resume to running
    const result = submitMissionDecision(missionRuntime, task.id, { optionId: 'path-a' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe('running');
      // decisionHistory should have entries (from resolveWaiting + submitMissionDecision)
      expect(result.task.decisionHistory!.length).toBeGreaterThanOrEqual(1);
    }

    // Simulate orchestrator putting task back into waiting (nextDecision)
    missionRuntime.waitOnMission(task.id, 'confirm path A', 'Confirm?', 55, {
      prompt: 'Confirm path A?',
      options: [
        { id: 'confirm', label: 'Confirm' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    const afterWait = missionRuntime.getTask(task.id);
    expect(afterWait?.status).toBe('waiting');
    expect(afterWait?.decision?.prompt).toBe('Confirm path A?');

    // Submit second decision
    const result2 = submitMissionDecision(missionRuntime, task.id, { optionId: 'confirm' });
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.task.status).toBe('running');
      // History should have grown from both decisions
      const historyLen = result2.task.decisionHistory!.length;
      expect(historyLen).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ─── API Endpoint Tests ─── */

async function startServer(runtime: MissionRuntime) {
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRouter(runtime));
  app.use('/api/decision-templates', createDecisionTemplatesRouter());

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('API endpoints', () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express['listen']> | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      server.close(err => err ? reject(err) : resolve());
    });
    server = null;
  });

  it('GET /api/tasks/:id/decisions returns decision history', async () => {
    const task = runtime.createChatTask('Decision history test');
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'approval', 'Approve?', 50, {
      prompt: 'Approve?',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      decisionId: 'dec_api_1',
    });

    // Submit a decision
    await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'yes' }),
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decisions`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missionId).toBe(task.id);
    expect(body.decisions).toBeInstanceOf(Array);
    expect(body.decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/decision-templates returns built-in templates', async () => {
    const response = await fetch(`${baseUrl}/api/decision-templates`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.templates).toBeInstanceOf(Array);
    expect(body.templates.length).toBe(BUILTIN_DECISION_TEMPLATES.length);
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'execution-plan-approval'
    );
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'stage-gate'
    );
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'risk-confirmation'
    );

    const approvalTemplate = body.templates.find(
      (template: { templateId: string }) =>
        template.templateId === 'execution-plan-approval'
    );
    expect(approvalTemplate).toBeDefined();
    expect(
      approvalTemplate.defaultOptions.map(
        (option: { id: string; label: string }) => option.id
      )
    ).toContain('modify');
    expect(
      approvalTemplate.defaultOptions.map(
        (option: { id: string; label: string }) => option.label
      )
    ).toContain('Modify');
  });
});
