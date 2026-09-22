# AGENTS.md

The deepest project knowledge lives in code comments and test docstrings, not in
docs. See `CLAUDE.md` for the project's core engineering disciplines (verify which
code path actually runs before editing, mutation-test your assertions, etc.). Read
it before making changes.

## Cursor Cloud specific instructions

These notes are for agents starting in a VM where the startup update script has
already installed dependencies (Node via `pnpm install`, and the Python venv at
`slide-rule-python/.venv`). Standard commands live in `package.json`,
`CONTRIBUTING.md`, and `slide-rule-python/README.md` — prefer those; the notes
below only capture non-obvious caveats.

### Services and how to run them

This is a polyglot product ("SlideRule / 面团 AI", a product-rehearsal engine).
The four dev services and their run commands are in `package.json` scripts:

- `pnpm run dev:all` — start the full stack: Vite frontend `:3000`, Node server
  `:3001`, Lobster executor `:3031`, and Python engine `:9700`. This is the
  normal start command.
- `pnpm run dev:stop` — stop what `dev:all` started (and any leftover listeners
  on those four ports). Restart = `dev:stop` then `dev:all`.
- `pnpm run dev:sliderule` — lean core loop: Vite `:3000` + Python `:9700` only
  (frontend proxies `/api/sliderule` and `/api/agent-loop` straight to Python).
- `pnpm run dev:frontend` — UI only, no server, no `.env` (degraded/BYOK).

The authoritative rehearsal engine is the Python service (`slide-rule-python`,
FastAPI on `:9700`); the Node server is a thin proxy that delegates V5 calls to
Python. Open the workbench at `http://localhost:3000/agent-loop/sliderule`.

### Python backend requires the venv (non-obvious)

`scripts/dev-all.mjs` / `scripts/dev-sliderule.mjs` only auto-start uvicorn when
`slide-rule-python/.venv/bin/python` exists; otherwise they print a warning and
skip Python (the SlideRule/AgentLoop pages then error until Python is up). The
update script creates this venv. Run Python tests with the venv, from the repo
root, keeping the `slide-rule-python/` path prefix (per `CLAUDE.md`):

```bash
slide-rule-python/.venv/bin/python -m pytest slide-rule-python/tests/ -q
```

### Degraded/no-LLM behavior is expected, not a bug

With no LLM key configured, `/health` reports `llm.keyPresent:false` and rehearsals
run in deterministic/template mode: the pipeline executes end-to-end but the
publish-closure comes back **`blocked`** and the five-system model generation stays
gated (the UI says `SLIDERULE_LLM_GENERATE_ENABLED` is off). This is the intended
fail-closed behavior for evidence/closure. To get real (non-template) rehearsals
and full model generation, set `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` in a
root `.env` (see `.env.example`). `SLIDERULE_AUTH_SECRET` / `SESSION_SECRET` matter
only for production, not local dev.

### Docker is unavailable in the cloud VM

There is no Docker daemon. `dev:all` detects this and falls back to
`LOBSTER_EXECUTION_MODE=native` automatically (executor runs on the host with no
sandbox isolation). The MySQL `accounts` profile and Docker-based executor/sandbox
smokes are therefore not runnable here; the core rehearsal product does not need
them.

### Registration/login in dev

Running a rehearsal requires login (session creation and `drive-full` are
login-gated). Email delivery defaults to `console`, so the verification code is
printed to the server console **and** returned as `devCode` in the
`POST /api/sliderule/account/register/start` response. The first registered user
becomes a superuser. (A demo account may already exist from environment setup.)

### Pre-existing test failures (reproduce on `origin/main`, not env issues)

Don't chase these — they fail identically on a clean `origin/main` checkout and are
unrelated to environment setup (do not "fix" by editing unrelated code):

- `slide-rule-python` `tests/test_app_preview.py::test_preview_tag_changes_when_the_same_source_is_rewritten[jsonfile]`
  fails on fast machines: the preview tag uses a microsecond timestamp and two
  back-to-back writes land in the same microsecond.
- Client `client/src/pages/agent-loop/AgentLoopPage.test.tsx` (“…hydrates settings
  and surfaces unsupported semantics truthfully”) throws at teardown reassigning
  the read-only `MessageEvent` global on Node 22.
- Client `client/src/App.shell-layout.test.tsx` `home-page` assertion can fail from
  test-ordering pollution in the full `test:client` run (passes in isolation).
- Server-contract `server/routes/__tests__/sliderule.execute-capability.test.ts`
  has ~20 failures from a stale `vi.mock('../../sliderule/python-delegation.js')`
  that omits the `viewerHeadersFrom` export now used by `server/routes/sliderule.ts`.

Otherwise the suites are green: `pnpm run lint`, `pnpm run check` (tsc),
`pnpm run test:scripts`, `pnpm run test:executor`, and the Python suite
(3996 passing) all pass.
