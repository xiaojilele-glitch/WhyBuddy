# 端云 / WhyBuddy — Rebrand · Stage 3 Unblock · MiroFish Skin · README Refresh
> Single-file spec by user request ("生成规格文档的时候，你不要生成全部")
> Snapshot: 2026-05-28 · Frozen against working tree at this commit

## 1. Why one spec, four tasks?

This iteration bundles four user-given tasks that share the same goal: **make the
visible product surface look and feel like it's converging toward the new
"端云 / WhyBuddy" brand and unblock the only piece of the autopilot pipeline that
still stalls in production.** They are bundled because:

- The rebrand (Task 3) touches the same files that the MiroFish skin (Task 1)
  and the README refresh (Task 4) need to write to. Doing them as one run
  avoids two round trips through the same files.
- The stage-3 unblock (Task 2) is independent but must ship with this run because
  the user said it is the single thing breaking the demo loop.

Out of scope for this spec:
- The full 287-spec rename of any internal symbols (`mission`, `workflow`,
  `runtime`, `whybuddy` strings inside steering files older than
  2026-05-28). Those stay until a dedicated rebrand sweep.
- A re-skin of the 3D office room or the holographic cockpit. MiroFish is
  applied to flat 2D surfaces only (loading, project hub, autopilot stage
  cards). 3D is left untouched.
- A re-architecture of the autopilot pipeline. Stage 3 unblock is a targeted
  fix at the auto-advance hook layer.

## 2. The four tasks

### Task A — Stage 2 → Stage 3 unblock (highest priority)

**Symptom (user words)**: "第一阶段、第二阶段都OK，第三阶段（效果预演）代码已经落地了，但是
第二阶段执行完，却到不了第三阶段。"

**Mapping**:
- Stage 1 = `input` + `clarification` (cockpit-perceived "第一阶段")
- Stage 2 = `route` → `spec_tree` → `spec_documents` (cockpit-perceived
  "第二阶段")
- Stage 3 = `effect_preview` (cockpit-perceived "第三阶段")

**Root-cause candidates** identified by reading
`client/src/pages/autopilot/right-rail/hooks/use-auto-advance.ts`:

1. The auto-advance effect requires `job.stage === "spec_docs" && job.status ===
   "completed"`. SPEC docs generation today fires 3 doc types in parallel
   (`requirements`, `design`, `tasks`); the job status oscillates while the
   three writes settle, increasing the race surface and the chance that the
   effect fires while `status !== "completed"` and is then suppressed by
   `advancedStagesRef`.
2. `advancedStagesRef` poisoning — when an earlier attempt fails and the user
   reloads, the in-memory ref retains `effect_preview` and silently drops the
   second attempt.
3. `initialDelayRef` (3-second guard) applies on every mount, including the
   one that re-attaches after stage 2 finishes.

**Fix surface** (this spec):
- A.1 Slim spec-docs generation to **one doc type by default**
  (`types: ["requirements"]`), per user's other instruction "你不要生成全部，
  这特别费时间，你只生成一份就好了". Wire this default through both
  auto-advance and force-advance code paths inside
  `client/src/pages/autopilot/right-rail/hooks/use-auto-advance.ts`.
- A.2 Drop `advancedStagesRef` for `effect_preview` whenever `job.stage`
  flips back to `spec_docs` from a higher stage. Ref poisoning only matters
  when the same stage triggers twice without job-stage backtracking; today
  there is no such legitimate case.
- A.3 Reduce `initialDelayRef` from 3s → 800ms, and bypass the delay entirely
  when the new job stage has already moved past `clarification`.
- A.4 Add one regression test in
  `client/src/pages/autopilot/right-rail/hooks/__tests__/use-auto-advance.spec-docs-to-effect-preview.test.ts`
  that sets `job.stage = "spec_docs"`, `job.status = "completed"`, and asserts
  `generateEffectPreview` is called within 1500ms (with the 800ms gate).

**Acceptance**:
- `node --run test:client -- use-auto-advance.spec-docs-to-effect-preview` passes.
- Manual smoke (Playwright `.tmp/e2e-launch-mission.mjs`): after stage 2
  finishes, the cockpit advances to `effect_preview` within 5s without manual
  intervention.

### Task B — README + .env.example + docker compose

**Source (user words)**: "docker 容器一键部署 / .env.example + 必填项最小化 /
两行命令 / 参考 https://gitee.com/log4j/pig/tree/v3.9.2 docker 用法".

**Fix surface**:
- B.1 Rewrite `README.md` to lead with three steps: ① online demo link,
  ② `docker compose up`, ③ `localhost:3000`. The current README leads with
  a 2026-04 product narrative; we keep that narrative but demote it below
  the Quick Start.
- B.2 Author `docker-compose.yml` at repo root that boots the existing
  `dist/` build behind one container (frontend served by Vite preview) plus
  one backend container (`tsx server/index.ts`). Reuses the existing
  `node:22-alpine` baseline. No Lobster Executor in the compose file — that
  is documented as opt-in.
- B.3 Author `Dockerfile` at repo root (multi-stage build) that maps to
  `pnpm install --frozen-lockfile && pnpm run build`.
- B.4 Promote LLM keys to a "MUST FILL" section in `.env.example`. Group
  the rest under `# OPTIONAL — leave defaults`. The user specifically asked
  for "最大字号标出来" — we use bold + leading `# === MUST FILL ===` block.
- B.5 Document the failure mode for users who skip the LLM key (server
  starts but blueprint bridges fall back to simulated, per existing
  `BLUEPRINT_*` opt-out) so we don't repeat the gitee/pig issue of
  "无法启动".

**Acceptance**:
- `docker compose up` from a fresh checkout boots both containers.
- `.env.example` clearly separates required from optional vars.
- README first 30 lines answer "how do I run this".

### Task C — Brand alias (whybuddy → 端云 / WhyBuddy)

**Source (user words)**: "整体项目不叫 cube-pet-office 了，改成了 whybuddy，
端云… 因为我有这个域名 whybuddy.com…端侧执行，云端调度的概念".

**Strategy**: alias-first, not big-bang rename.
- C.1 Add a `shared/brand.ts` constant module that exports
  `BRAND_NAME_DISPLAY = "端云"`, `BRAND_NAME_LATIN = "WhyBuddy"`,
  `BRAND_DOMAIN = "whybuddy.com"`, `BRAND_TAGLINE_ZH = "端侧执行 · 云端调度"`,
  `BRAND_TAGLINE_EN = "Edge execution · Cloud orchestration"`,
  `BRAND_PACKAGE_LEGACY = "whybuddy"`.
- C.2 Update user-visible touchpoints to consume the new brand:
  - `package.json` `name` → `whybuddy`.
  - `client/index.html` `<title>` → `端云 WhyBuddy · 任务自动驾驶`.
  - `client/src/pages/auth/AuthPage.tsx` "WhyBuddy" header → brand
    constant.
  - `client/src/components/LoadingScreen.tsx` brand line → brand constant.
  - `README.md` H1 → `端云 / WhyBuddy`.
- C.3 Internal symbols (file names, module names, identifier prefixes,
  audit / lineage event families, the 287 spec dirs that contain
  `whybuddy` in prose, steering files older than 2026-05-28) are
  **not** renamed in this spec. They are routed to a future
  `whybuddy-internal-rename` spec.
- C.4 Project-overview steering gets a one-line addendum at the top noting
  the brand change and the alias-first stance.

**Acceptance**:
- A user landing on `localhost:3000` sees "端云 WhyBuddy" in the tab title,
  the loading screen, the login screen, and the README hero.
- `package.json` `name` is `whybuddy`.
- No legacy code path breaks (the legacy package name is still referenced
  internally where mass-rename would be high-risk).

### Task D — MiroFish skin (loading / project hub / stage cards)

**Source (user words)**: "playwright 1920x1080 / loading / 项目管理页 / 进入项目
之后的每个阶段的样式 / 参考 mirofish".

**Strategy**: re-use the existing `client/src/styles/mirofish-tokens.css` and
the `mirofish-visual-alignment` spec — they already define the visual
language (white bg, `#FF4500` accent, `1px solid #E5E5E5`, no shadow,
2px max radius, DM Sans / Noto Sans SC / JetBrains Mono). Apply that token
set to three concrete surfaces only.

**Fix surface**:
- D.1 `client/src/components/LoadingScreen.tsx` — replace the holographic
  glow-heavy skin with a MiroFish-aligned card: white bg, large display
  font wordmark `端云 / WhyBuddy`, single accent stroke at `#FF4500`, no
  shadow, single 2px border. Keep the existing progress-state copy.
- D.2 `client/src/pages/Home.tsx` Project Hub section — apply MiroFish
  card chrome to `home-project-metric-card`, `home-project-create-button`,
  the empty-state card, and the project list rows. Keep the existing
  `data-testid`s. Keep desktop 1440 / mobile breakpoints.
- D.3 `client/src/pages/autopilot/right-rail/stage-viewport/StageHeader.tsx`
  + the Stage 1 / Stage 2 / Stage 3 cards — apply MiroFish typography
  tokens (display font for the chinese title, JetBrains Mono for the
  `STEP 0N · ENGLISH_LABEL` eyebrow). Keep existing layout, only swap
  font + border + accent color.
- D.4 Verify against 1920×1080 by re-running the existing
  `.tmp/e2e-launch-mission.mjs` Playwright smoke and checking the
  screenshots manually. Do **not** introduce new automated visual tests
  in this spec.

**Acceptance**:
- LoadingScreen, project hub cards, and the stage 1/2/3 viewport headers
  visibly use the MiroFish typography + accent + border tokens.
- No stage / phase data flow regressions: cockpit still shows the same
  badges, status colors, sub-stage tabs.
- No 3D scene changes; `Scene3D.tsx` is not touched.

## 3. Sequencing & rules

Order of execution (committed separately, smallest blast radius first):

1. **Task A (stage 3 unblock)** — pure logic fix in one hook; touches one
   file plus one test. Smallest blast radius, highest user value.
2. **Task B (README + docker compose + .env.example)** — additive only.
3. **Task C (brand alias)** — additive `shared/brand.ts` plus surgical
   string swaps in 5 user-visible files.
4. **Task D (MiroFish skin)** — visual swap on three surfaces; biggest
   review surface, last so it can land on top of the rebrand without
   conflicts.

Per-task commits use the existing convention:
- `fix(autopilot): unblock stage 3 effect_preview after spec docs ship`
- `docs(readme+docker): one-command bootstrap and required env grouping`
- `feat(brand): introduce whybuddy alias for visible touchpoints`
- `style(mirofish): apply tokens to loading, project hub, stage headers`

Hard limits per user instruction "中途不要停止":
- No interactive prompts during the run.
- No new dependencies.
- No mass renames.
- Do not break any existing test that is currently green.

## 4. Validation gates

- `node --run check` — must not regress beyond the existing 30 known
  TypeScript errors (per steering snapshot 2026-04-15).
- `node --run test:client` — at minimum, the affected files'
  `__tests__/*` must pass; full client suite is informational.
- `.tmp/e2e-launch-mission.mjs` — Playwright manual smoke produces a
  fresh `e2e-launch-mission/` artifact set, and the user can view the
  screenshots.

## 5. Carry-over (next spec)

These items are observed but explicitly deferred:

- `whybuddy` literals inside the 287 specs and inside server-side
  audit / lineage event families. Routed to a future
  `whybuddy-internal-rename-2026-XX-XX` spec.
- 3D office room re-skin under MiroFish. Routed to a future
  `office-3d-mirofish-alignment` spec.
- Lobster Executor inclusion in the compose file. Routed to a future
  `whybuddy-compose-with-executor` spec.
- A full visual-regression Playwright suite. Routed to a future
  `whybuddy-visual-regression-suite` spec.
