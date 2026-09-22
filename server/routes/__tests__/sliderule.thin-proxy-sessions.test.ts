import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

// 只替换出网的四个函数，其余（尤其 PythonSlideRuleHttpError 这个类）保留真身：
// 路由用 `e instanceof PythonSlideRuleHttpError` 判 404 透传，假类会让 instanceof 恒假。
vi.mock('../../sliderule/python-delegation.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callPythonSlideRule: vi.fn(),
  callPythonSlideRuleGet: vi.fn(),
  delegateToPythonSlideRule: vi.fn(),
  checkPythonSlideRuleHealth: vi.fn(async () => ({ ok: true, url: 'http://localhost:9700/health', backend: 'python' })),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: 'http://localhost:9700',
    internalKey: 'dev-slide-rule-internal',
    timeoutMs: 120000,
    healthPath: '/health',
    proxyMode: 'node-fetch-env',
  })),
}));

let slideruleRouter: any;
let routerModule: any;
let delegation: any;

describe('Node sliderule routes thin proxy (sessions CRUD + execute prove no business ownership)', () => {
  let app: any;
  let server: any;
  let base: string;

  beforeAll(async () => {
    routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
    delegation = await import('../../sliderule/python-delegation.js');
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/sliderule', slideruleRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/sliderule`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('exports thin delegation helpers (sessions/execute use proxy)', () => {
    expect(typeof slideruleRouter).not.toBe('undefined');
    expect(typeof routerModule.callPythonSlideRuleGet).toBe('function');
    expect(typeof routerModule.delegateToPythonSlideRule).toBe('function');
  });

  it('GET /sessions hits real route handler and delegates via callPythonSlideRuleGet (proves no local Map/persist)', async () => {
    const mockList = { sessions: [{ sessionId: 's-list-1', goal: 'thin-test' }] };
    (delegation.callPythonSlideRuleGet as any).mockResolvedValueOnce(mockList);

    const res = await fetch(`${base}/sessions`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockList);
    expect(delegation.callPythonSlideRuleGet).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/sessions',
      expect.any(String),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('GET /sessions/:id hits real route handler and delegates via callPythonSlideRuleGet (no local lookup)', async () => {
    const mockSess = { state: { sessionId: 's-get-1' }, backend: 'python' };
    (delegation.callPythonSlideRuleGet as any).mockResolvedValueOnce(mockSess);

    const res = await fetch(`${base}/sessions/s-get-1`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockSess);
    expect(delegation.callPythonSlideRuleGet).toHaveBeenCalled();
  });

  it('GET /sessions/:id preserves Python 404 not_found contract instead of collapsing to 502', async () => {
    // 路由靠 `e instanceof PythonSlideRuleHttpError && e.status === 404` 判透传，
    // 不再解析错误文案；这里必须扔真类型，扔 Error 只会走到 502 兜底。
    (delegation.callPythonSlideRuleGet as any).mockRejectedValueOnce(
      new delegation.PythonSlideRuleHttpError(
        'python GET /api/sliderule/sessions/missing-1 failed: http 404 {"error":"not_found","sessionId":"missing-1"}',
        404,
        '{"error":"not_found","sessionId":"missing-1"}'
      )
    );

    const res = await fetch(`${base}/sessions/missing-1`, { method: 'GET' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', sessionId: 'missing-1', backend: 'python' });
  });

  it('PUT /sessions/:id + DELETE hit real route handlers and delegateToPythonSlideRule (no sanitize/replay/strip/persist in Node)', async () => {
    (delegation.delegateToPythonSlideRule as any).mockResolvedValueOnce({ ok: true, backend: 'python' });
    (delegation.delegateToPythonSlideRule as any).mockResolvedValueOnce({ ok: true, backend: 'python' });

    const putRes = await fetch(`${base}/sessions/s-put-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's-put-1', goal: { text: 'p' } }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);

    const delRes = await fetch(`${base}/sessions/s-put-1`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    expect(delegation.delegateToPythonSlideRule).toHaveBeenCalledTimes(2);
    expect(delegation.delegateToPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/sessions/s-put-1',
      'PUT',
      expect.objectContaining({ sessionId: 's-put-1' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('execute-capability for V5 cap under python hits real route + delegates via callPythonSlideRule (legacy paths unreachable)', async () => {
    const pyResp = { title: 'r', summary: 's', content: 'c', provenance: 'python-rag', backend: 'python' };
    (delegation.callPythonSlideRule as any).mockResolvedValueOnce(pyResp);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityId: 'report.write', turnId: 't1', state: { sessionId: 'sx', goal: { text: 'x' }, artifacts: [], capabilityRuns: [] } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pyResp);
    expect(delegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({ capabilityId: 'report.write' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('under python default, sessions routes return 502 on delegation failure (explicit, no local fallback)', async () => {
    (delegation.callPythonSlideRuleGet as any).mockRejectedValueOnce(new Error('conn refused'));
    const res = await fetch(`${base}/sessions`, { method: 'GET' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('python_unavailable');
    expect(body.backend).toBe('python');
  });

  // === 120 focused AppBundle closure proxy tests (addresses review findings) ===
  // Positive closed path + fail-closed negative (blocked, missing digest, partial evidence) + hash/digest + 6-skill manifest evidence + rollback degraded/passthrough.
  // Pure deterministic helpers + drive endpoint boundary checks; uses mocks only, no network/providers/DB.

  it('normalizePublishClosureForProxy positive closed path (full 6-skill evidence + digest -> passthrough, not blocked)', () => {
    const closed = {
      blocked: false,
      stableDigest: 'deadbeef120',
      closureHash: 'feedface',
      evidencePresentCount: 6,
      skillCount: 6,
      perSkillEvidence: {
        datamodel: { evidencePresent: true, evidenceRef: 'evidence:datamodel:closed-120' },
        rbac: { evidencePresent: true },
        workflow: { evidencePresent: true },
        page: { evidencePresent: true },
        aigc: { evidencePresent: true },
        appbundle: { evidencePresent: true, artifactId: 'artifact-appbundle-closed-120', digest: 'deadbeef120' },
      },
      manifest: { appId: 'app_purchase_approval', closureEvidenceDigest: 'deadbeef120' },
    };
    const norm = routerModule.normalizePublishClosureForProxy(closed);
    expect(norm).not.toBe('strip');
    expect(norm.blocked).toBe(false);
    expect(norm.stableDigest).toBe('deadbeef120');
    expect(norm.perSkillEvidence.appbundle.evidencePresent).toBe(true);
    expect(norm.perSkillEvidence.datamodel.evidencePresent).toBe(true);
  });

  it('normalizePublishClosureForProxy fail-closed blocked input (passthrough blocked + checked refs)', () => {
    const blocked = {
      blocked: true,
      blockerCount: 1,
      stableDigest: 'badc0ded120',
      perSkillEvidence: {
        aigc: { evidencePresent: false },
        appbundle: { evidencePresent: true },
      },
    };
    const norm = routerModule.normalizePublishClosureForProxy(blocked);
    expect(norm).not.toBe('strip');
    expect(norm.blocked).toBe(true);
    expect(norm.blockerCount).toBe(1);
  });

  it('normalizePublishClosureForProxy fail-closed on missing digest (forces blocked even if 6 evidence)', () => {
    const noDigest = {
      blocked: false,
      perSkillEvidence: {
        datamodel: { evidencePresent: true },
        rbac: { evidencePresent: true },
        workflow: { evidencePresent: true },
        page: { evidencePresent: true },
        aigc: { evidencePresent: true },
        appbundle: { evidencePresent: true },
      },
    };
    const norm = routerModule.normalizePublishClosureForProxy(noDigest);
    expect(norm).not.toBe('strip');
    expect(norm.blocked).toBe(true);
    expect((norm.blockerCount || 0) > 0).toBe(true);
  });

  it('normalizePublishClosureForProxy fail-closed on partial evidence (missing full 6 -> forces blocked)', () => {
    const partial = {
      blocked: false,
      stableDigest: 'd123',
      perSkillEvidence: {
        datamodel: { evidencePresent: true },
        rbac: { evidencePresent: true },
        // missing others -> not all 6
        appbundle: { evidencePresent: true },
      },
    };
    const norm = routerModule.normalizePublishClosureForProxy(partial);
    expect(norm.blocked).toBe(true);
  });

  it('normalizePublishClosureForProxy bad shape returns strip sentinel (no leak)', () => {
    expect(routerModule.normalizePublishClosureForProxy(undefined)).toBe(undefined);
    expect(routerModule.normalizePublishClosureForProxy({ foo: 'bar' })).toBe('strip');
    expect(routerModule.normalizePublishClosureForProxy(null)).toBe('strip');
    expect(routerModule.normalizePublishClosureForProxy([])).toBe('strip');
  });

  it('derivePublishClosureReportExportSummary positive closed path', () => {
    const closed = { blocked: false, stableDigest: 'deadbeef120', evidencePresentCount: 6, skillCount: 6, perSkillEvidence: { datamodel: { evidencePresent: true }, rbac: { evidencePresent: true }, workflow: { evidencePresent: true }, page: { evidencePresent: true }, aigc: { evidencePresent: true }, appbundle: { evidencePresent: true } } };
    const sum = routerModule.derivePublishClosureReportExportSummary(closed);
    expect(sum.status).toBe('closed');
    expect(sum.blocked).toBe(false);
    expect(sum.digest).toBe('deadbeef120');
    expect(sum.evidencePresentCount).toBe(6);
    expect(sum.skillCount).toBe(6);
    expect(sum.source).toBe('publish-artifact-closure');
  });

  it('derivePublishClosureReportExportSummary fail-closed blocked and degraded paths', () => {
    const blk = { blocked: true, stableDigest: 'badc0ded', evidencePresentCount: 1 };
    const sumB = routerModule.derivePublishClosureReportExportSummary(blk);
    expect(sumB.status).toBe('blocked');
    expect(sumB.blocked).toBe(true);
    expect(sumB.digest).toBe('badc0ded');

    const bad = { foo: 1 };
    const sumD = routerModule.derivePublishClosureReportExportSummary(bad);
    expect(sumD.status).toBe('degraded');
    expect(sumD.blocked).toBe(true);
    expect(sumD.digest).toBe(null);
  });

  it('drive-full positive closed publishClosure + rollback diff passthrough (normalized at Node boundary)', async () => {
    const closedPC = {
      blocked: false,
      stableDigest: 'deadbeef120',
      perSkillEvidence: { datamodel: { evidencePresent: true }, rbac: { evidencePresent: true }, workflow: { evidencePresent: true }, page: { evidencePresent: true }, aigc: { evidencePresent: true }, appbundle: { evidencePresent: true } },
    };
    const validRcd = { digestMatch: true, from: 'cur', to: 'tgt' };
    (delegation.callPythonSlideRule as any).mockResolvedValueOnce({
      ok: true,
      publishClosure: closedPC,
      rollbackClosureDiff: validRcd,
      otherEvidence: 'kept',
    });

    const res = await fetch(`${base}/drive-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { sessionId: 'drive-120', goal: { text: 'appbundle closed' }, artifacts: [], capabilityRuns: [] } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publishClosure).toBeDefined();
    expect(body.publishClosure.blocked).toBe(false);
    expect(body.publishClosure.stableDigest).toBe('deadbeef120');
    expect(body.rollbackClosureDiff).toEqual(validRcd);
    expect(body.otherEvidence).toBe('kept');
  });

  it('drive-full fail-closed: bad publishClosure stripped; missing digest forces blocked; rollback missing flag -> degraded', async () => {
    const noDigestPC = {
      blocked: false,
      perSkillEvidence: { datamodel: { evidencePresent: true }, rbac: { evidencePresent: true }, workflow: { evidencePresent: true }, page: { evidencePresent: true }, aigc: { evidencePresent: true }, appbundle: { evidencePresent: true } },
    };
    const badRcd = { diff: 'no-flag' };
    (delegation.callPythonSlideRule as any).mockResolvedValueOnce({
      ok: true,
      publishClosure: noDigestPC,
      rollbackClosureDiff: badRcd,
    });

    const res = await fetch(`${base}/drive-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { sessionId: 'drive-120b', goal: { text: 'blocked' } } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publishClosure).toBeDefined();
    expect(body.publishClosure.blocked).toBe(true);
    expect(body.rollbackClosureDiff.degraded).toBe(true);
  });

  it('drive-full strips publishClosure on bad shape (strip sentinel)', async () => {
    (delegation.callPythonSlideRule as any).mockResolvedValueOnce({
      ok: true,
      publishClosure: { foo: 'not-a-closure' }, // no boolean blocked
      rollbackClosureDiff: [],
    });

    const res = await fetch(`${base}/drive-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { sessionId: 'drive-120s' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publishClosure).toBeUndefined();
    expect(body.rollbackClosureDiff).toBeUndefined();
  });
});
