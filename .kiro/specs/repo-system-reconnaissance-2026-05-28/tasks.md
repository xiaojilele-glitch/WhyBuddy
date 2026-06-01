# Implementation Plan: A_Plus_Reconnaissance Phase 1

## Overview

This is a procedure manual the Author executes against a clock, not runtime code. "Implementation" is *running the 7-stage pipeline against the `2026-05-28` snapshot of `whybuddy`*; "tests" are the 6 mechanical checks performed by `.tmp/cap-audit.{js|mjs|py}` plus the manual reviewer checklist for Property 2, Property 4, and Property 5. Nothing in this plan introduces runtime code, property-based tests, fuzz tests, or new source-tree files. Every artifact lives under `.kiro/specs/repo-system-reconnaissance-2026-05-28/` (the deliverable) or `.tmp/` (scratch + audit script).

The work is bounded by Req 13 to **3–5 focused working days (≤ 40 hours)**. The time hints below sum to roughly `30–41` hours; the upper bound is the ceiling, not the target. If any task overruns its hint, demote optional content (Req 13.2) before extending.

The pipeline is one-shot and serial: Stages 1 → 2 → 3 → 4 → 5 → 6 → 7 → Cap_Verifier → exit. No stage may be reordered or skipped (Req 3.1). Parallelism exists only between Cap_Verifier (Task 8) and the manual reviewer checklist (Task 9), and within tasks where multiple deliverables consume the same upstream output (e.g., docs 07 + 02 in Task 3, docs 04 + 05 + 06 in Task 5).

## Tasks

- [x] 1. Stage 1 — Scanner: produce `.tmp/raw_findings.jsonl` (≈ 3–5 hours)
  - Executes design.md § Components and Interfaces § 1. Scanner. One-shot enumeration of the 6 source roots; no interpretation. Every row carries `kind`, `path`, `evidence`, `snapshot_ref`, `last_commit`.
  - _Implements: REQ-3.1, REQ-3.2, REQ-3.4, REQ-11.1, REQ-11.2, REQ-11.5, REQ-12.1, REQ-12.4_
  - _Validates: Property 2, Property 6_

  - [x] 1.1 Freeze HEAD and confirm Snapshot_2026_05_28 baseline before scanning
    - Record short SHA of `HEAD` into `.tmp/scanner-head.txt`; cite `.kiro/steering/project-overview.md § 项目规模` and `.kiro/steering/execution-plan.md § 总览 / § 当前维护快照` as the volumetric authority. Do not re-count files.
    - _Implements: REQ-11.1, REQ-11.2, REQ-11.5_
    - _Validates: Property 6_

  - [x] 1.2 Enumerate all 6 source roots into `.tmp/raw_findings.jsonl`
    - Roots: `client/src/`, `server/`, `shared/`, `services/`, `.kiro/specs/`, `.kiro/steering/`. Tools unconstrained per Req 12.1; any Node script lives only under `.tmp/`. Each row populates `kind ∈ {route, core_module, store, page, panel, component, lib, contract, executor, spec_dir, steering_doc}`, `path`, one-line `evidence`, `snapshot_ref` citation, and `last_commit` from `git log -1 --format=%h -- <path>`.
    - _Implements: REQ-3.1, REQ-3.2, REQ-12.1, REQ-12.4_
    - _Validates: Property 2_

  - [x] 1.3 Validate `raw_findings.jsonl` schema completeness before exiting Stage 1
    - Confirm: row count > 0 for each of the 6 roots; every row has all 5 required fields populated; no row is malformed JSON. Reject and rerun 1.2 if any field is empty.
    - _Implements: REQ-3.1, REQ-3.4_
    - _Validates: Property 2_

- [x] 2. Stage 2 — Deduplicator: produce `.tmp/deduped_findings.jsonl` and `.tmp/duplicate_clusters.jsonl` (≈ 2–3 hours)
  - Executes design.md § Components and Interfaces § 2. Deduplicator. Collapses aliases so downstream classification operates on distinct subjects. Every cluster has exactly one canonical row; criteria are applied first-hit-wins.
  - _Implements: REQ-3.1, REQ-5.1, REQ-5.2_
  - _Validates: Property 1, Property 4_

  - [x] 2.1 Apply path-equality and normalized-name clustering (criteria 1 + 2)
    - Strip `-(v\d+|\d{4}-\d{2}-\d{2})$` suffixes for `kind=spec_dir`. Choose the canonical row by the latest `last_commit`. Record `criterion_triggered ∈ {path_equality, name_normalization, content_overlap, none}` per cluster.
    - _Implements: REQ-3.1, REQ-5.1_
    - _Validates: Property 1_

  - [x] 2.2 Apply ≥ 60% Jaccard line-overlap clustering for `kind ∈ {spec_dir, contract, core_module}` (criterion 3)
    - Compute Jaccard on non-blank, non-comment lines via `rg --no-heading -N`. Restrict to the three kinds listed to bound cost. Skip pairs already clustered by criterion 1 or 2.
    - _Implements: REQ-3.1, REQ-5.1_
    - _Validates: Property 1_

  - [x] 2.3 Validate canonical-row uniqueness and write both `.jsonl` outputs
    - Confirm exactly one `is_cluster_canonical=true` per cluster; every duplicate-cluster row points to ≥ 2 raw findings; deduped row count ≤ raw row count. Reject and rerun if any cluster has zero or two canonical rows.
    - _Implements: REQ-5.2, REQ-5.5_
    - _Validates: Property 1_

- [x] 3. Stage 3 — Classifier: produce `spec-audit-table.md` (287 rows), doc `07`, SVG `D7`, doc `02`, SVG `D2` (≈ 6–8 hours)
  - Executes design.md § Components and Interfaces § 3. Classifier. The hard progress gate of Req 4. No document numbered `≥ 07` may be authored from anything other than this output.
  - _Implements: REQ-4.1, REQ-4.2, REQ-5.1, REQ-5.2, REQ-5.3, REQ-5.4, REQ-5.5, REQ-5.6, REQ-6.1, REQ-7.2_
  - _Validates: Property 1, Property 4, Property 7_

  - [x] 3.1 Compute `task_completion_pct` for every spec dir
    - Parse each `tasks.md` (where present); compute `checked / total * 100` rounded to integer; record `0` when `tasks.md` is absent. Cite `.kiro/steering/execution-plan.md § 当前维护快照` (`7,887 / 8,806 = 89.6%`) as the cross-check baseline; do not re-count overall checkbox totals.
    - _Implements: REQ-5.1, REQ-5.4, REQ-11.2, REQ-11.3_
    - _Validates: Property 1, Property 6_

  - [x] 3.2 Apply the 5-bucket priority decision tree across all 287 specs and produce `spec-audit-table.md`
    - Priority: DUPLICATE > DRIFTED > PARTIALLY_IMPLEMENTED > IMPLEMENTED_AND_VALID > DESIGNED_NEVER_BUILT (Req 5.2). Use the worked examples in design.md § 3. Classifier as anchors for each bucket. Every row carries `spec_dir`, `bucket`, `evidence_path`, `evidence_note`, `duplicate_of` (when DUPLICATE), `task_completion_pct`, `last_modified_commit`. Confirm row count == 287 and `Σ buckets == 287` with no `spec_dir` appearing twice.
    - _Implements: REQ-4.1, REQ-5.1, REQ-5.2, REQ-5.3, REQ-5.4, REQ-5.5, REQ-5.6_
    - _Validates: Property 1, Property 4_

  - [x] 3.3 Author doc `07 Spec 现状审计` and SVG `D7` (bucket distribution)
    - Doc 07 narrates the audit table at the bucket level (no per-spec rewrite). SVG D7 declares a `manifest:` block citing `spec-audit-table.md` as its source. Mandatory diagram per Req 7.2.
    - _Implements: REQ-6.1, REQ-7.1, REQ-7.2, REQ-14.1_
    - _Validates: Property 2, Property 7_

  - [x] 3.4 Author doc `02 核心对象模型` and SVG `D2` (entity diagram)
    - Derive `goal` / `run` / `spec` / `artifact` / `task` / `replay` relationships **only** from rows bucketed `IMPLEMENTED_AND_VALID`. SVG D2 declares a `manifest:` block citing the audit-table rows that fed the diagram. Mandatory diagram per Req 7.2.
    - _Implements: REQ-2.2, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

- [x] 4. Stage 4 — Main_Loop_Identifier: produce doc `01` + SVG `D1`; provisional inputs to docs `03` / `09` + SVGs `D3` / `D8` (≈ 3–4 hours)
  - Executes design.md § Components and Interfaces § 4. Main_Loop_Identifier. Picks one canonical loop using the deterministic rule "touches the most TRUNK-labeled domains"; ties broken by IMPLEMENTED_AND_VALID spec count.
  - _Implements: REQ-2.1, REQ-2.3, REQ-3.1, REQ-3.2, REQ-3.4, REQ-6.1, REQ-7.2_
  - _Validates: Property 2, Property 7_

  - [x] 4.1 Run a provisional trunk / branch / legacy pass to feed the selection rule
    - Read `.kiro/steering/project-overview.md § 系统架构 / § 核心数据流` for the predeclared candidate flows (Frontend Mode, Advanced Mode, Mission Execution, Memory & Evolution, Audit & Lineage, A2A Interop). Tag each candidate's touched modules with a provisional label; the final inventory is built in Task 5 and may revise this pass.
    - _Implements: REQ-3.1, REQ-3.2_
    - _Validates: Property 2_

  - [x] 4.2 Select the canonical Main_Business_Loop and author doc `01 主业务闭环` + SVG `D1`
    - Apply the selection rule. Record both the chosen loop and the rule application in doc 01 (so the result is reproducible regardless of outcome). SVG D1's `manifest:` block cites ≥ 1 audit-table row and ≥ 1 row from `.tmp/raw_findings.jsonl` or `.tmp/deduped_findings.jsonl`. Mandatory per Req 7.2.
    - _Implements: REQ-2.1, REQ-3.2, REQ-3.4, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

  - [x] 4.3 Author doc `03 系统分层图` and SVG `D3` from the chosen loop
    - Layers: `client` / `server` / `shared` / `executor` / `docs`. SVG D3 cites the steering source-tree summary and the audit-table rows for any spec referenced inside a layer. Mandatory per Req 7.2.
    - _Implements: REQ-2.3, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

  - [x] 4.4 Author doc `09 运行时主链路` and SVG `D8` (state sequence one task passes through)
    - Trace the chosen loop's runtime states from start to completion. SVG D8 cites scan rows describing the route handlers, store transitions, and event-emitter call sites involved. Mandatory per Req 7.2.
    - _Implements: REQ-2.3, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

- [x] 5. Stage 5 — Domain_Mapper: produce `module-inventory.md`, doc `04` + SVG `D4`, doc `05` + SVG `D5`, doc `06` + SVG `D6` (≈ 4–6 hours)
  - Executes design.md § Components and Interfaces § 5. Domain_Mapper. Every scanned non-test module receives exactly one of `trunk` / `branch` / `legacy` per the mechanical rule.
  - _Implements: REQ-2.3, REQ-2.4, REQ-3.1, REQ-3.2, REQ-6.1, REQ-7.2_
  - _Validates: Property 2, Property 7_

  - [x] 5.1 Author `module-inventory.md` with one row per non-test module
    - Schema: `module_path`, `kind`, `domain`, `trunk_branch_legacy`, `referenced_specs`. Exclude `*.test.ts`, `*.spec.ts`, and any path under `*/tests/` (per design.md § Data Models § 2). Apply the labeling rule: TRUNK iff on Main_Business_Loop and ≥ 1 IMPLEMENTED_AND_VALID referencing spec; LEGACY iff unreferenced and last-modified-commit > 90 days as of `2026-05-28`; BRANCH otherwise. LEGACY wins over BRANCH on conflict.
    - _Implements: REQ-2.4, REQ-3.1_
    - _Validates: Property 2_

  - [x] 5.2 Author doc `04 主要域地图` and SVG `D4`
    - Domains (closed enum): `workflow`, `mission`, `executor`, `audit`, `lineage`, `memory`, `frontend-cockpit`, `frontend-3d`, `feishu`, `interop`. SVG D4 `manifest:` cites `module-inventory.md` rows. Mandatory per Req 7.2.
    - _Implements: REQ-2.4, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

  - [x] 5.3 Author doc `05 前端导航地图` and SVG `D5`
    - Filter inventory to `kind ∈ {page, panel, component, store}`. Show pages → panels → stores → routes wiring. SVG D5 `manifest:` cites the filtered inventory rows. Mandatory per Req 7.2.
    - _Implements: REQ-2.3, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

  - [x] 5.4 Author doc `06 后端能力地图` and SVG `D6`
    - Filter inventory to `kind ∈ {route, core_module, executor}`. Group by domain. SVG D6 `manifest:` cites the filtered inventory rows. Mandatory per Req 7.2.
    - _Implements: REQ-2.3, REQ-6.1, REQ-7.2_
    - _Validates: Property 2, Property 7_

- [x] 6. Stage 6 — Reconciler: produce doc `08 代码-文档对账` with two reconciliation lists (≈ 3–4 hours)
  - Executes design.md § Components and Interfaces § 6. Reconciler. Closes Req 14.3: gaps are *recorded*, not patched by rewriting affected specs.
  - _Implements: REQ-3.1, REQ-6.1, REQ-14.1, REQ-14.2, REQ-14.3, REQ-14.4_
  - _Validates: Property 5_

  - [x] 6.1 Compute the `doc_without_code` list with severity tags
    - Per spec, run `rg -o '[a-zA-Z0-9._/-]+\.(ts|tsx|js|jsx|md)'` against `requirements.md`, `design.md`, `tasks.md`. A spec has matching code iff ≥ 1 mentioned path resolves in the working tree. IMPLEMENTED_AND_VALID or PARTIALLY_IMPLEMENTED specs failing this check → `broken-promise`; DESIGNED_NEVER_BUILT specs → `informational`.
    - _Implements: REQ-14.1, REQ-14.2, REQ-14.3_
    - _Validates: Property 5_

  - [x] 6.2 Compute the `code_without_doc` list with severity tags
    - Every TRUNK or BRANCH inventory row with empty `referenced_specs` enters this list. TRUNK → `needs-attention`; BRANCH → `informational`. LEGACY rows are not listed (unreferenced by definition).
    - _Implements: REQ-14.1, REQ-14.2, REQ-14.3_
    - _Validates: Property 5_

  - [x] 6.3 Author doc `08 代码-文档对账` with both lists
    - Two markdown sections per design.md § Data Models § 3. No per-spec rewrites: gaps that would require rewriting are flagged for routing in Task 7 (Req 14.4).
    - _Implements: REQ-6.1, REQ-14.3, REQ-14.4_
    - _Validates: Property 5_

- [x] 7. Stage 7 — B_Tier_Proposer: produce `B_Tier_Recommendation.md`, doc `10`, doc `00` traceability table (≈ 3–4 hours)
  - Executes design.md § Components and Interfaces § 7. B_Tier_Proposer. The B-tier scope is an *output* of A+, never an input (Req 10.1). Every candidate carries ≥ 1 evidence pointer.
  - _Implements: REQ-2.5, REQ-2.6, REQ-3.1, REQ-4.4, REQ-9.1, REQ-9.2, REQ-9.3, REQ-9.4, REQ-9.5, REQ-9.6, REQ-10.1, REQ-10.2, REQ-10.3, REQ-10.4, REQ-10.5, REQ-13.3, REQ-14.4_
  - _Validates: Property 5, Property 7_

  - [x] 7.1 Aggregate B / C / D / deferred candidates from audit table, inventory, and reconciliation
    - Sources: `spec-audit-table.md` rows in {DRIFTED, PARTIALLY_IMPLEMENTED}, `module-inventory.md` rows flagged in `code_without_doc`, doc `08` `broken-promise` entries, plus any item rejected during Phase 1 per Req 4.4 / 9.6.
    - _Implements: REQ-4.4, REQ-9.6, REQ-10.4, REQ-13.3, REQ-14.4_
    - _Validates: Property 5_

  - [x] 7.2 Author `B_Tier_Recommendation.md` applying the tier-assignment rule
    - Apply the tier table from design.md § 7. B_Tier_Proposer: per-domain prose → B; cross-domain reorg ≥ 2 domains → C; auto-reference (TypeDoc / madge / dependency-cruiser) → D; unevidenced → deferred. Rejected items are routed with the rejection note attached. Every entry cites ≥ 1 audit-row, inventory-row, or reconciliation-row.
    - _Implements: REQ-9.1, REQ-9.2, REQ-9.3, REQ-9.4, REQ-9.5, REQ-9.6, REQ-10.2, REQ-10.3, REQ-10.4, REQ-10.5_
    - _Validates: Property 5_

  - [x] 7.3 Author doc `10 演示主线`
    - Pick the storyline for demo / refactor / fundraising / open-source from B-tier candidates flagged TRUNK and IMPLEMENTED_AND_VALID. Cite the source rows.
    - _Implements: REQ-2.5, REQ-6.1_
    - _Validates: Property 7_

  - [x] 7.4 Author doc `00 项目总定义` with the Question_to_Deliverable_Index
    - Exactly 5 rows — one per Five_Control_Recovery_Question. Q3's `supporting_documents` MUST include `03`, `05`, `06`, and `09`. Each row's `primary_document` and `primary_svg` MUST resolve to an existing file in the spec dir. Leave the Phase 1 completion stamp section empty until Task 8 fills it.
    - _Implements: REQ-2.1, REQ-2.2, REQ-2.3, REQ-2.4, REQ-2.5, REQ-2.6, REQ-6.1, REQ-8.4_
    - _Validates: Property 7_

- [x] 8. Cap_Verifier — write `.tmp/cap-audit.{js|mjs|py}` and run it; record stdout into doc `00` (≈ 2–3 hours)
  - Executes design.md § Verification Strategy § 1. The script is the runtime form of Properties 1, 3, 6, and 7. It is read-only against the spec dir and never promoted into the source tree.
  - _Implements: REQ-8.1, REQ-8.2, REQ-8.3, REQ-8.4, REQ-12.4_
  - _Validates: Property 1, Property 3, Property 6, Property 7_

  - [x] 8.1 Write `.tmp/cap-audit.{js|mjs|py}` (~ 50–100 lines, stdlib only)
    - Implements all 6 mechanical checks from design.md § Testing Strategy: (1) audit-table integrity, (2) document-slot integrity, (3) SVG cap, (4) question coverage, (5) out-of-scope absence, (6) tool-chain. Interface: `--spec-dir <abs path>`; stdout one PASS/FAIL line per check; exit 0 iff all 6 pass.
    - _Implements: REQ-8.1, REQ-8.2, REQ-12.4_
    - _Validates: Property 1, Property 3, Property 7_

  - [x] 8.2 Run the script; capture stdout; paste it into doc `00`'s Phase 1 completion-stamp section verbatim
    - If exit code is non-zero, apply the matching remedy from design.md § Error Handling and re-run. Do **not** edit stdout to make it pass. Do **not** copy the script into `client/`, `server/`, `shared/`, `services/`, `scripts/`, or `package.json` scripts (Req 12.4 / Error Handling row 9).
    - _Implements: REQ-8.2, REQ-8.3, REQ-8.4, REQ-12.4_
    - _Validates: Property 3_

- [x] 9. Manual reviewer checklist — execute Property 2, Property 4, and Property 5 manual steps (≈ 2–3 hours, parallel with Task 8)
  - Executes design.md § Verification Strategy § 2. The audit script cannot judge SVG-manifest semantics or evidence-note priority claims; the Author does so by hand. Run in parallel with Task 8; both gates must pass before Task 10.
  - _Validates: Property 2, Property 4, Property 5_

  - [x] 9.1 Verify Property 2 — every SVG manifest cites a real upstream row
    - For every `*.svg` in the spec dir, open it and confirm its `manifest:` block names a row ID that actually exists in `.tmp/raw_findings.jsonl`, `.tmp/deduped_findings.jsonl`, or `spec-audit-table.md`. Reject any SVG that cites an upstream row not present in those files.
    - _Validates: Property 2_

  - [x] 9.2 Verify Property 4 — bucket priority determinism on alternative-considered rows
    - Read `spec-audit-table.md` end-to-end. For every row whose `evidence_note` mentions an alternative bucket considered, confirm the assigned bucket is higher in Req 5.2's priority order than the alternative. Reject any row where the lower-priority bucket was chosen.
    - _Validates: Property 4_

  - [x] 9.3 Verify Property 5 — every B-tier candidate cites a real evidence row
    - Open `B_Tier_Recommendation.md`. For each candidate, confirm the cited row exists in `spec-audit-table.md`, `module-inventory.md`, or doc `08`. Sample policy: 100% if candidates ≤ 30; otherwise 30 random rows. Reject any candidate whose citation does not resolve.
    - _Validates: Property 5_

- [x] 10. Phase 1 exit — confirm both gates pass and stamp doc `00` (≈ 1 hour)
  - Approves Phase 1 only when **all 7 properties pass**. If any property fails, apply the matching remedy in design.md § Error Handling and re-run the affected gate.
  - _Implements: REQ-1.1, REQ-1.3, REQ-8.4, REQ-13.3_
  - _Validates: Property 1, Property 2, Property 3, Property 4, Property 5, Property 6, Property 7_

  - [x] 10.1 Confirm both gates (`cap-audit` exit 0 + manual checklist pass)
    - Cross-check that the `cap-audit` stdout pasted in doc `00` reports `PASS` on all 6 lines and that Tasks 9.1–9.3 each completed without rejection. If either fails, do not proceed.
    - _Implements: REQ-1.3, REQ-8.2_
    - _Validates: Property 1, Property 3, Property 7_

  - [x] 10.2 Stamp doc `00` with the Phase 1 completion mark
    - Add the date, the working-time spent, the final document count, the final SVG count, the audit-table row count (= 287), and the carry-over list (if Task 7.2 routed any items to "deferred" or carry-over per Req 13.3). The stamp closes Phase 1.
    - _Implements: REQ-1.1, REQ-8.4, REQ-13.3_
    - _Validates: Property 7_

## Notes

- This plan produces only markdown and SVG inside the spec dir, plus throwaway scratch under `.tmp/`. No runtime code, no PBT, no fuzz tests, no new source-tree files.
- Time hints sum to roughly `30–41` hours. The 5-day budget is a **ceiling**, not a target. If a task overruns, Req 13.2 demands demoting optional content (extra SVGs beyond D1–D8, optional sections inside docs `00`–`10`) before extending.
- The 287-spec audit (Task 3) is the single largest task and the hard progress gate; nothing numbered `≥ 07` may be authored before it is complete (Req 4.1).
- The Cap_Verifier script (Task 8.1) is itself a deliverable — cited from doc `00` — but it is **not** promoted into the source tree (Req 12.4 + Error Handling row 9).
- Every SVG MUST carry a `manifest:` header citing the scan-output or audit-table row(s) it was derived from; an SVG that fails this is discarded and regenerated (Req 3.3 + Error Handling row 3).
- Every B-tier candidate MUST cite ≥ 1 concrete evidence row; uncited candidates are not eligible to appear (Req 10.4).
- If during the run a new spec dir appears beyond the snapshot's 287, record it as a footnote in `spec-audit-table.md` and continue against the snapshot baseline — do **not** reopen the snapshot (Req 11.4).
- Phase 1 exit is approved only when both the audit script and the manual checklist pass; partial passes are not Phase 1 completion (design.md § Verification Strategy).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0,  "tasks": ["1.1"] },
    { "id": 1,  "tasks": ["1.2"] },
    { "id": 2,  "tasks": ["1.3"] },
    { "id": 3,  "tasks": ["2.1"] },
    { "id": 4,  "tasks": ["2.2"] },
    { "id": 5,  "tasks": ["2.3"] },
    { "id": 6,  "tasks": ["3.1"] },
    { "id": 7,  "tasks": ["3.2"] },
    { "id": 8,  "tasks": ["3.3", "3.4"] },
    { "id": 9,  "tasks": ["4.1"] },
    { "id": 10, "tasks": ["4.2"] },
    { "id": 11, "tasks": ["4.3", "4.4"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 14, "tasks": ["6.1", "6.2"] },
    { "id": 15, "tasks": ["6.3"] },
    { "id": 16, "tasks": ["7.1"] },
    { "id": 17, "tasks": ["7.2", "7.3"] },
    { "id": 18, "tasks": ["7.4"] },
    { "id": 19, "tasks": ["8.1", "9.1", "9.2", "9.3"] },
    { "id": 20, "tasks": ["8.2"] },
    { "id": 21, "tasks": ["10.1"] },
    { "id": 22, "tasks": ["10.2"] }
  ]
}
```
