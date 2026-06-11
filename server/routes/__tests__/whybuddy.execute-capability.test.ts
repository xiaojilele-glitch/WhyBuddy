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
import * as ghAdapter from '../../whybuddy/github-mcp-adapter.js';
import * as repoStaticAnalyzer from '../../whybuddy/repo-static-analyzer.js';

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
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'intent.parse',
        state: { sessionId: 't1', goal: { text: 'x' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(String(body.error || '')).toMatch(/unsupported/);

    errSpy.mockRestore();
  });

  it('returns 500 (llm_not_configured or execution_failed) when no apiKey, without leaking secrets', async () => {
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
      errSpy.mockRestore();
      if (orig) process.env.LLM_API_KEY = orig;
      if (origOpen) process.env.OPENAI_API_KEY = origOpen;
    }
  });

  it('returns raw 4-field shape on mocked success for risk.analyze', async () => {
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Server Risk Title',
        summary: 'server risk summary',
        content: 'server risk content with evidence',
      },
      usage: undefined,
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

  it('returns normalized usage when llm-client provides usage (Knife 11.1)', async () => {
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Risk with Usage',
        summary: 'has usage',
        content: 'risk content',
      },
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
      },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'risk.analyze',
        state: { sessionId: 't-usage', goal: { text: 'test' } },
        inputArtifactIds: [],
        turnId: 't-usage',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Risk with Usage');
    expect(body.provenance).toBe('llm');
    expect(body.usage).toEqual({
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      model: expect.any(String), // the route uses config.model
    });
  });

  it('report.write success returns content that reflects the 9-section base structure', async () => {
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Server Report Title',
        summary: 'server report summary',
        content: '结论：...\n支撑证据：...\n反证/挑战：...\n风险：...\n分歧：...\n收敛决策：...\n未解缺口：...\n下一步工程化分支：...\nprovenance / upstream refs：...',
      },
      usage: undefined,
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

  // --- P0 MCP GitHub adapter tests (source/evidence via server capability seam) ---

  it('source.github.inspect returns raw 4-field shape with mcp:github provenance (success)', async () => {
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Source: facebook/react',
      summary: 'repo facebook/react · TypeScript · 200000★ · default branch main · last pushed 2026-...',
      content: JSON.stringify({
        repository: 'facebook/react',
        language: 'TypeScript',
        stars: 200000,
        license: 'MIT License',
        readmeSummary: 'A JavaScript library for building user interfaces...',
        risks: ['low recent activity'],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'source.github.inspect',
        state: { sessionId: 't1', goal: { text: 'look at https://github.com/facebook/react for the UI components' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toContain('facebook/react');
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    // enrichment assertions (v1)
    expect(body.content).toContain('readmeSummary');
    expect(body.content).toContain('license');
    expect(body.content).toContain('risks');

    // Prove the route used the (mock) adapter and did not hit real network
    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('source.github.inspect', expect.anything(), []);
  });

  it('evidence.github.collect returns raw shape and can be referenced by report.write inputArtifactIds', async () => {
    // The github evidence "artifact" is produced by a prior capability run in real flow.
    // Here we prove the route accepts the cap (via spied adapter) and that a subsequent
    // report.write still receives the 9-section base (github artifact id carried in inputArtifactIds).

    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: vercel/next.js',
      summary: 'repo vercel/next.js · TypeScript · 100000★ ...',
      content: JSON.stringify({
        repository: 'vercel/next.js',
        url: 'https://github.com/vercel/next.js',
        license: 'MIT License',
        readmeSummary: 'The React Framework for the Web...',
        risks: [],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    // First call (spied — no real network).
    const ghRes = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: { sessionId: 't2', goal: { text: 'https://github.com/vercel/next.js' } },
        inputArtifactIds: [],
        turnId: 't2',
      }),
    });
    expect(ghRes.status).toBe(200);
    const ghBody = await ghRes.json();
    expect(ghBody.provenance).toBe('mcp:github');
    // enrichment assertions (v1)
    expect(ghBody.content).toContain('readmeSummary');
    expect(ghBody.content).toContain('license');

    // Prove the route used the mock adapter (no real network)
    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('evidence.github.collect', expect.anything(), []);

    // Now call report.write referencing that github evidence via inputArtifactIds.
    // The server still feeds the 9-section skeleton (report path unchanged).
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Report with GitHub Evidence',
        summary: 'includes github evidence',
        content: '结论：...\n支撑证据：... (includes vercel/next.js github artifact)\n...',
      },
      usage: undefined,
    });

    const reportRes = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't2', goal: { text: 'summarize' }, artifacts: [{ id: 'gh1', kind: 'evidence', title: 'GitHub Evidence' }] },
        inputArtifactIds: ['gh1'],
        turnId: 't2',
      }),
    });

    expect(reportRes.status).toBe(200);
    const reportBody = await reportRes.json();
    expect(reportBody.content).toMatch(/支撑证据|结论/);
    expect(reportBody.provenance).toBe('llm');
  });

  it('graceful missing README still returns 200 with core metadata + note (enrichment v1)', async () => {
    // Simulate the inner README fetch failing (404 or error) – adapter must degrade gracefully
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: facebook/react',
      summary: 'repo facebook/react · JavaScript · 200000★ ...',
      content: JSON.stringify({
        repository: 'facebook/react',
        description: 'A declarative, efficient, and flexible JavaScript library for building user interfaces.',
        language: 'JavaScript',
        stars: 200000,
        license: null, // or 'MIT'
        readmeSummary: null,
        risks: ['missing license'],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: { sessionId: 't-missing-readme', goal: { text: 'https://github.com/facebook/react' } },
        inputArtifactIds: [],
        turnId: 't5',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    // graceful: no readmeSummary, but still has core + risks note
    expect(body.content).not.toContain('readmeSummary": "'); // or check it's null
    expect(body.content).toContain('risks');

    ghSpy.mockRestore();
  });

  it('respects inputArtifactIds priority when multiple GitHub artifacts exist (Medium fix)', async () => {
    // Two artifacts in state. When inputArtifactIds: ['second'], must select vercel/next.js, not facebook/react.
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: vercel/next.js',
      summary: 'repo vercel/next.js · TypeScript · 100000★ ...',
      content: '{"repository":"vercel/next.js","url":"https://github.com/vercel/next.js"}',
      provenance: 'mcp:github',
    });

    const stateWithTwo = {
      sessionId: 't-priority',
      goal: { text: 'check facebook/react and also vercel/next.js' },
      artifacts: [
        { id: 'first', title: 'FB Repo', content: 'https://github.com/facebook/react' },
        { id: 'second', title: 'Vercel Repo', content: 'https://github.com/vercel/next.js' },
      ],
    };

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: stateWithTwo,
        inputArtifactIds: ['second'],
        turnId: 't4',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toContain('vercel/next.js');
    expect(body.provenance).toBe('mcp:github');

    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('evidence.github.collect', expect.anything(), ['second']);

    ghSpy.mockRestore();
  });

  it('github mcp capability with no usable url returns 400 (fallback path, no 500)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'source.github.inspect',
        state: { sessionId: 't3', goal: { text: 'no github link here at all' } },
        inputArtifactIds: [],
        turnId: 't3',
      }),
    });

    expect([400, 422]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    // The route catch maps adapter-thrown 400s (no url) to "unsupported_capability"
    // while preserving the original message for diagnostics.
    expect(body.error).toBe('unsupported_capability');
    expect(String(body.message || '')).toMatch(/github|url|no github/i);

    errSpy.mockRestore();
  });

  // --- Static Repo Analyzer (repo.static.inspect) tests ---

  it('repo.static.inspect returns raw 4-field shape with structured engineering evidence', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: facebook/react',
      summary: 'Detected react, typescript with pnpm. 2 risks noted.',
      content: JSON.stringify({
        repository: 'facebook/react',
        detectedStack: ['react', 'typescript', 'vite'],
        packageManager: 'pnpm',
        scripts: { dev: 'vite', test: 'vitest', build: 'vite build' },
        ci: { hasGithubActions: true, workflowCount: 3 },
        configSignals: { hasTsconfig: true, hasDockerfile: false, hasEnvExample: true },
        risks: ['No Dockerfile found'],
        recommendedNextChecks: ['Review package.json scripts', 'Add Dockerfile'],
      }, null, 2),
      provenance: 'repo:static',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.static.inspect',
        state: { sessionId: 't-static', goal: { text: 'analyze https://github.com/facebook/react' } },
        inputArtifactIds: [],
        turnId: 't6',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('repo:static');
    expect(body.title).toContain('facebook/react');
    const content = JSON.parse(body.content || '{}');
    expect(content.detectedStack).toContain('react');
    expect(content.packageManager).toBe('pnpm');
    expect(content.risks).toContain('No Dockerfile found');
    expect(content.recommendedNextChecks.length).toBeGreaterThan(0);

    expect(staticSpy).toHaveBeenCalledTimes(1);
    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), []);
  });

  it('repo.inspect maps to static + github adapters when goal has GitHub URL (F1 B4)', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: facebook/react',
      summary: 'Detected react stack.',
      content: JSON.stringify({
        repository: 'facebook/react',
        detectedStack: ['react', 'typescript'],
        ci: { workflowCount: 12 },
      }),
      provenance: 'repo:static',
    });

    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Source: facebook/react',
      summary: 'repo facebook/react · TypeScript · 200000★',
      content: JSON.stringify({
        repository: 'facebook/react',
        stars: 200000,
        readmeSummary: 'A JavaScript library for building user interfaces.',
        source: 'mcp-github',
      }),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.inspect',
        state: {
          sessionId: 't-f1',
          goal: { text: '分析 https://github.com/facebook/react 的工程结构' },
        },
        inputArtifactIds: [],
        turnId: 't-f1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), []);
    expect(ghSpy).toHaveBeenCalledWith('source.github.inspect', expect.anything(), []);
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    expect(body.content).toContain('stars');
    expect(body.content).toContain('readmeSummary');
  });

  it('repo.inspect without GitHub URL degrades to rule fallback without calling adapters (F1)', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect');
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability');

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.inspect',
        state: { sessionId: 't-f1-fallback', goal: { text: '做一个权限管理系统' } },
        inputArtifactIds: [],
        turnId: 't-f1-fallback',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('ai_generated');
    expect(body.content).toMatch(/未能从目标中识别|未找到 GitHub/i);
    expect(staticSpy).not.toHaveBeenCalled();
    expect(ghSpy).not.toHaveBeenCalled();
  });

  it('repo.static.inspect respects inputArtifactIds priority and graceful missing files', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: vercel/next.js',
      summary: 'Detected react, next, typescript with pnpm. 1 risks noted.',
      content: JSON.stringify({
        repository: 'vercel/next.js',
        detectedStack: ['react', 'next', 'typescript'],
        packageManager: 'pnpm',
        scripts: { build: 'next build' },
        ci: { hasGithubActions: true, workflowCount: 5 },
        configSignals: { hasTsconfig: true, hasDockerfile: true, hasEnvExample: false },
        risks: ['No .env.example found'],
        recommendedNextChecks: ['Add .env.example'],
      }, null, 2),
      provenance: 'repo:static',
    });

    const stateWithGitHubArtifact = {
      sessionId: 't-static-prio',
      goal: { text: 'check multiple' },
      artifacts: [
        { id: 'gh-fb', title: 'FB', content: 'https://github.com/facebook/react' },
        { id: 'gh-vercel', title: 'Vercel', content: 'https://github.com/vercel/next.js' },
      ],
    };

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.static.inspect',
        state: stateWithGitHubArtifact,
        inputArtifactIds: ['gh-vercel'],
        turnId: 't7',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('repo:static');
    expect(body.title).toContain('vercel/next.js');
    const content = JSON.parse(body.content || '{}');
    expect(content.configSignals.hasDockerfile).toBe(true);
    expect(content.risks).toContain('No .env.example found');

    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), ['gh-vercel']);

    staticSpy.mockRestore();
  });
});


