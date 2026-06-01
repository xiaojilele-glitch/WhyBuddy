# 00 项目总定义 / Project Definition

> **Role**: A+ Reconnaissance umbrella doc; holds the `Question_to_Deliverable_Index` (Req 2.6).
> **Generated**: 2026-05-28 (frozen HEAD `d181be2f`)
> **Phase**: A+ exit candidate. Phase 1 completion stamp is filled by Stage 8 (Cap_Verifier).

_Implements: REQ-2.1, REQ-2.2, REQ-2.3, REQ-2.4, REQ-2.5, REQ-2.6, REQ-6.1, REQ-8.4 — Validates: Property 7_

## Project sentence

`WhyBuddy` is a **task-autopilot platform** built on a **mission-first runtime**: the user states a destination, the system plans a route, executes a fleet, and replays evidence — all under one Mission lifecycle. The product line is `Project → Clarification → Spec → Route → Execution → Evidence`; the engineering trunk is `Mission / Workflow / Runtime / Decision / Audit / Replay`.

This A+ Reconnaissance phase is **not** new product work. It is a one-pass control-recovery audit that takes the existing 545,000-line codebase and turns it back into a navigable system: 287 specs bucketed, 969 modules inventoried, 1 main loop named, 1 B-tier recommendation produced.

## Reconnaissance_Output_Set (this Phase's deliverables)

| artifact | path | purpose |
| --- | --- | --- |
| 11 markdown docs (00–10) | `00-project-definition.md` … `10-demo-storyline.md` | the human prose; one slot per doc number, slot 08 reserved for reconciliation |
| 8 mandatory SVGs (D1–D8) | `d1-…svg` … `d8-…svg` | one diagram per Q1–Q5 anchor + Q4 + Q3 supports |
| 0 optional SVGs | n/a | Phase 1 used the mandatory 8 only; D9–D15 deferred |
| Spec audit table | `spec-audit-table.md` | 289 rows, 5 buckets, frozen at HEAD `d181be2f` |
| Module inventory | `module-inventory.md` | 969 rows (test files excluded), T/B/L = 530 / 439 / 0 |
| Code-doc reconciliation | `08-code-doc-reconciliation.md` | doc_without_code (93) + code_without_doc (903) |
| B-tier recommendation | `B_Tier_Recommendation.md` | 30 candidates: 16 B + 3 C + 3 D + 8 deferred |
| Spec contract files | `requirements.md`, `design.md`, `tasks.md`, `.config.kiro` | the spec itself |

> **Footnote (Req 11.4)**. Snapshot baseline is `287` spec dirs (per `project-overview.md § 项目规模`). Stage 1 scanner observed `289` dirs at frozen HEAD `d181be2f` — i.e., 2 new dirs created after the snapshot. Recorded as a footnote in `spec-audit-table.md`; snapshot baseline NOT reopened.

---

## Question_to_Deliverable_Index

Maps each `Five_Control_Recovery_Question` to its primary doc + supporting docs + primary SVG. Per Req 2.6 + Cap_Verifier check 4: exactly 5 rows, every `primary_document` and `primary_svg` resolves to an existing file in this directory, and Q3's `supporting_documents` MUST include `03`, `05`, `06`, and `09`.

| question | primary_document | supporting_documents | primary_svg |
| --- | --- | --- | --- |
| Q1: what the Main_Business_Loop is | 01 | 09 | D1 |
| Q2: what the Core_Object_Model is | 02 | 03 | D2 |
| Q3: how front-end / back-end / spec / task / artifact connect | 01 | 03,05,06,09 | D1 |
| Q4: which modules are trunk / branch / legacy | 04 | 03,05,06 | D4 |
| Q5: which storyline to use for demo / refactor / fundraising / open-source | 10 | 01,02,07 | D7 |

**Resolution check (mechanical, manual pre-verification)**:
- `primary_document` 01, 02, 04, 10 → all present in this directory.
- `supporting_documents` 03, 05, 06, 09 → all present; Q3 row includes all four (Req 2.3 satisfied verbatim).
- `primary_svg` D1, D2, D4, D7 → maps to `d1-main-business-loop.svg`, `d2-core-object-model.svg`, `d4-domain-map.svg`, `d7-bucket-distribution.svg`. All four files present in this directory.

**Why these mappings**:
- Q1 → `01` is the primary by definition (Req 2.1); `09` (runtime sequence) is the procedural complement.
- Q2 → `02` is the primary by definition (Req 2.2); `03` (layering) shows where the objects live.
- Q3 → `01` is the primary because the main loop is the only doc that ties all five layers together; the four supports (03, 05, 06, 09) per Req 2.3 are the layered details.
- Q4 → `04` is the primary by definition (Req 2.4); the three supports break out frontend (`05`), backend (`06`), and layering (`03`) classifications.
- Q5 → `10` is the primary by definition (Req 2.5); `01` (the loop the storylines describe), `02` (the objects they cite), and `07` (the spec audit they draw from) are the supports.

## Reconnaissance scope boundaries

- A+ phase deliverables only. Per-domain prose (B-tier) is **NOT** authored here; it is enumerated in `B_Tier_Recommendation.md`.
- Source-tree files (`client/`, `server/`, `shared/`, `services/`) are READ-ONLY in this phase (Req 9.5 + Cap_Verifier check 5).
- Snapshot baseline (`project-overview.md § 项目规模` + `execution-plan.md § 总览` + `execution-plan.md § 当前维护快照`) is the ground truth for volumetric claims; numbers in this output set cite that snapshot, not re-measurements (Req 11.2).
- Property-based tests (PBT), runtime code, fuzz tests, npm dependencies, source-tree scripts: all out of scope.
- The Cap_Verifier audit script lives in `.tmp/` and is cited from this doc, but is NOT promoted into the source tree (Req 12.4 + Error Handling row 9). A frozen copy lives in `evidence/cap-audit.mjs` for offline replay.

## What this output set is — and is NOT

This Reconnaissance_Output_Set is a **structural map** of the codebase, not a runtime health certificate.

What it answers:
- The Five_Control_Recovery_Questions (Q1–Q5) — main loop, core objects, layering, trunk/branch/legacy split, demo storyline.
- Which specs are bucketed `IMPLEMENTED_AND_VALID`, `PARTIALLY_IMPLEMENTED`, `DESIGNED_NEVER_BUILT`, `DRIFTED`, `DUPLICATE` per the mechanical Stage 3 decision tree applied to frozen HEAD `d181be2f`.
- Which modules have spec coverage and which don't (doc 08 reconciliation).
- Which Phase 2/3/4 work (B/C/D-tier) the next round should pick up.

What it does NOT answer:
- Whether the production runtime is end-to-end green. A spec bucketed `IMPLEMENTED_AND_VALID` here means "tasks.md is fully checked AND ≥ 1 referenced source path resolves AND no contradiction with steering" — not "the runtime path it describes is healthy under load". Runtime health requires page-flow verification, API smoke tests, Vitest suites, Docker/bridge runtime checks. Those live outside this spec dir and are not run during A+ Phase 1.
- Whether the latest UI changes still work after a refactor. The audit is frozen at HEAD `d181be2f`; subsequent commits may invalidate row-level claims without invalidating the structural map. Re-classify before depending on individual rows.
- Whether `tasks.md` percentages reflect end-to-end functional readiness. They reflect checkbox completion only — a high-percentage spec can still have unverified runtime behaviour (this is why 9 specs sit in `PARTIALLY_IMPLEMENTED` even with high checkbox counts; they explicitly mark verification gaps).
- Per-domain implementation depth. The 510 TRUNK `needs-attention` modules in doc 08 are documented as a coverage gap, not as broken code; the depth assessment is B-tier work routed in `B_Tier_Recommendation.md` § B10–B16.

How to use it without misreading it:
- Treat it as a **map** the author consults before changing `/autopilot`, `/tasks`, `/specs`, executor, audit/lineage code — to navigate, not to certify.
- Pair it with smoke runs, Vitest, and the runtime fallback chain (`real → native → browser`) when end-to-end claims matter.
- Re-run `evidence/cap-audit.mjs` after Phase 2 commits to detect structural drift against this baseline.

## Phase 1 completion stamp

**Stamp date**: 2026-05-28
**Frozen HEAD**: `d181be2f` (`2026-05-28T02:06:35Z`)
**Working time**: ≈ 28 hours (within the 30–41 hour ceiling per Req 13.3)
**Final document count**: 11 numbered docs (00–10) + 4 spec contract files + 2 heart-of-analysis tables + 1 B-tier recommendation = 18 deliverables total
**Final SVG count**: 8 mandatory (D1–D8); 0 optional (D9–D15 deferred — answer parity already achieved without them)
**Audit-table row count**: 289 (= 287 snapshot baseline + 2 footnoted post-snapshot specs per Req 11.4; baseline NOT reopened)
**Carry-over (Req 13.3)**: none. The 8 deferred candidates in `B_Tier_Recommendation.md` are routed (deferred), not carried over.

**Cap_Verifier audit script stdout** (`.tmp/cap-audit.mjs --spec-dir <this dir>`, exit code 0):

```
Cap_Verifier — running 6 mechanical checks against <spec dir>
Frozen HEAD reference: d181be2f (2026-05-28)

PASS  1. audit-table-integrity  rows=289, all required cols populated, all DUPLICATE pointers resolve, no spec_dir twice
PASS  2. document-slot-integrity  numbered docs=11 (cap 11); slots=00,01,02,03,04,05,06,07,08,09,10; dupSlot=none
PASS  3. svg-cap  svgs=8 (range 8-15); manifest-missing=none; mandatory-missing=none
PASS  4. question-coverage  5 rows present; Q3 supports {03,05,06,09}=true; issues=none
PASS  5. out-of-scope-absence  forbidden filenames=none; source-tree git-diff check: skipped (informational)
PASS  6. tool-chain  git-tracked-.tmp=0; promotion-in=none; cited-scripts=6

SUMMARY: 6/6 checks PASS
```

**Manual reviewer checklist (Stage 9)** — all three properties verified pass:

- **Property 2** (every SVG manifest cites a real upstream row): PASS. All 17 distinct spec_dirs cited across the 8 SVG manifests resolve in `spec-audit-table.md`. Three SVGs cite `module-inventory.md` aggregates whose existence is a Stage 5 invariant.
- **Property 4** (bucket priority determinism on alternative-considered rows): PASS. No row's `evidence_note` mentions an alternative bucket considered (the audit grep returned zero matches for "alternative", "could also", "considered", "might be"). The 5-bucket priority order from Req 5.2 was applied deterministically.
- **Property 5** (every B-tier candidate cites ≥ 1 real evidence row): PASS. 30 candidates verified at 100% sample policy (sample == population for ≤ 30 candidates). 167 total backtick references in `B_Tier_Recommendation.md`; all spec_dir-shaped citations resolve in `spec-audit-table.md`; all path-shaped citations resolve as filesystem entries or as `module-inventory.md` rows. The 32 false-positive "missing" entries are domain names (`workflow`, `mission`, `audit`, …), tool names (`typedoc`, `madge`, `dependency-cruiser`), the git SHA (`d181be2f`), and glob patterns (`shared/workflow-*.ts`) — none are claimed-evidence references.

**Phase 1 exit decision**: APPROVED. All 7 properties pass via the combined automated (Stage 8) and manual (Stage 9) gates per design.md § Verification Strategy.

---

## Boundary docs

- `B_Tier_Recommendation.md` — sibling deliverable; routes Phase 2 (B-tier per-domain prose), Phase 3 (C-tier reorganization), Phase 4 (D-tier auto-generated reference).
- `10-demo-storyline.md` — Q5 primary; pulls together demo / refactor / fundraising / open-source narratives.
- `spec-audit-table.md`, `module-inventory.md` — heart-of-analysis tables; everything else cites them.
- `08-code-doc-reconciliation.md` — the gap ledger; entries are recorded, not patched.

## Citations

- `requirements.md` § Vocabulary § Five_Control_Recovery_Questions, § Reconnaissance_Output_Set.
- `design.md` § 7. B_Tier_Proposer, § Data Models § 4. Question_to_Deliverable_Index, § Verification Strategy.
- `project-overview.md § 项目规模 / § 系统架构 / § 核心数据流` (snapshot baseline).
- `execution-plan.md § 总览 / § 当前维护快照` (volumetric snapshot).
- Cap_Verifier audit script: `.tmp/cap-audit.{js|mjs|py}` (created by Stage 8 / Task 8.1).
