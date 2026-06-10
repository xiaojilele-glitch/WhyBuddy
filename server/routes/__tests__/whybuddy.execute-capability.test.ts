/**
 * Server route tests for POST /api/whybuddy/execute-capability.
 * These provide the dedicated server-level regression the review asked for.
 *
 * This file lives under server/routes/__tests__/ so it is picked up by
 * vitest.config.server.ts (the __tests__ pattern in its include).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import whybuddyRouter from '../whybuddy.js';
import * as llmClient from '../../core/llm-client.js';

describe('POST /api/whybuddy/execute-capability (server route)', () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/whybuddy', whybuddyRouter);

  let server: any;
  let base: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns 400 for missing required fields', async () => {
    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityId: 'risk.analyze' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json().catch(() => ({}));
    expect(body.error).toBe('bad_request');
  });

  it('returns 400/422 for unsupported capability (not 500)', async () => {
    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'synthesis.merge',
        state: { sessionId: 't1', goal: { text: 'x' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(String(body.error || '')).toMatch(/unsupported/);
  });

  it('returns 500 (llm_not_configured or execution_failed) when no apiKey, without leaking secrets', async () => {
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'risk.analyze',
          state: { sessionId: 't1', goal: { text: 'x' } },
          inputArtifactIds: [],
          turnId: 't1',
        }),
      });
      expect(res.status).toBe(500);
      const body = await res.json().catch(() => ({}));
      expect(String(body.error || '')).toMatch(/llm_not_configured|execution_failed/);
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toMatch(/sk-/i);
      expect(bodyStr).not.toMatch(/OPENAI|LLM_API_KEY/i);
    } finally {
      if (orig) process.env.LLM_API_KEY = orig;
      if (origOpen) process.env.OPENAI_API_KEY = origOpen;
    }
  });

  it('returns raw 4-field shape on mocked success for risk.analyze', async () => {
    vi.spyOn(llmClient, 'callLLMJson').mockResolvedValueOnce({
      title: 'Server Risk Title',
      summary: 'server risk summary',
      content: 'server risk content with evidence',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'risk.analyze',
        state: { sessionId: 't1', goal: { text: '权限系统' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Server Risk Title');
    expect(body.content).toContain('server risk content');
    expect(body.provenance).toBe('llm');
  });

  it('report.write success returns content that reflects the 9-section base structure', async () => {
    vi.spyOn(llmClient, 'callLLMJson').mockResolvedValueOnce({
      title: 'Server Report Title',
      summary: 'server report summary',
      content: '结论：...\n支撑证据：...\n反证/挑战：...\n风险：...\n分歧：...\n收敛决策：...\n未解缺口：...\n下一步工程化分支：...\nprovenance / upstream refs：...',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't1', goal: { text: '权限系统' }, artifacts: [] },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = body.content || '';
    expect(content).toMatch(/结论|支撑证据|反证|风险|分歧|收敛决策|未解缺口|下一步工程化|provenance/);
    expect(body.provenance).toBe('llm');
  });
});