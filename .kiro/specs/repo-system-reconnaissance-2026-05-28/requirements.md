# Requirements Document

## Introduction

This spec scopes the **A+ tier** of a multi-tier repo recovery effort over the `whybuddy` codebase as of the `2026-05-28` snapshot (`2,130` files / `~545,000` lines / `287` specs). It is deliberately **not** a documentation-engineering project. The goal is for the Author to recover operational control over a codebase that has outgrown a single human's working memory.

Phase 1 succeeds when the Author can answer five concrete questions about the system from a small, finite set of artifacts produced by direct scan of the repo, not from memory and not from prose drawn around an existing mental model. Documents and SVG diagrams are byproducts and are bounded from above; producing more of them is not progress.

This spec exists as a corrective to a prior proposal that framed Phase 1 as "produce ~90 documents." That framing is rejected here. The non-negotiable principle is: **补齐 + 索引 + 关系图，不重写既有 spec**. The reconnaissance process determines which existing specs are still valid before any new prose is written, and the B-tier (per-domain) scope is an *output* of the A+ tier, not an *input*.

## Glossary

- **A_Plus_Reconnaissance**: The Phase 1 reconnaissance and control-recovery process defined by this spec. Owns the 11 core documents, the spec audit, the module inventory, and the B-tier recommendation. Distinct from later tiers (B/C/D), which it scopes but does not execute.
- **Author**: The single human owner of the codebase performing A+ reconnaissance. The sole consumer whose ability to answer the Five_Control_Recovery_Questions defines success.
- **Five_Control_Recovery_Questions**: The five questions the Author must be able to answer at the end of A_Plus_Reconnaissance: (Q1) what the Main_Business_Loop is, (Q2) what the Core_Object_Model is, (Q3) how front-end / back-end / spec / task / artifact connect, (Q4) which modules are trunk / branch / legacy, (Q5) which storyline to use for demo / refactor / fundraising / open-source.
- **Main_Business_Loop**: The end-to-end runtime path from user input to final delivered artifact for the system's primary use case. A single named flow, not an enumeration of all flows.
- **Core_Object_Model**: The relationships among `goal`, `run`, `spec`, `artifact`, `task`, and `replay` as they actually exist in code, not as previously documented.
- **Domain_Map**: A single diagram and corresponding section enumerating the system's principal domains (`workflow`, `mission`, `executor`, `audit`, `lineage`, `memory`, etc.) and their boundaries.
- **Trunk_vs_Branch_vs_Legacy**: A classification of every identified module into exactly one of three labels — `trunk` (load-bearing for the Main_Business_Loop), `branch` (active but not on the main loop), or `legacy` (historical baggage, not on any current loop).
- **Spec_Audit_Five_Buckets**: The five mutually exclusive buckets into which every one of the `287` specs is classified: `IMPLEMENTED_AND_VALID` (已实现且仍有效), `PARTIALLY_IMPLEMENTED` (部分实现), `DESIGNED_NEVER_BUILT` (设计过但未实现), `DRIFTED` (实现已偏离文档 / 过时), `DUPLICATE` (重复描述同一模块).
- **B_Tier_Recommendation**: The single document produced by A_Plus_Reconnaissance that proposes the scope, ordering, and exclusion list for B-tier (per-domain) work. It is an output of A+, not an input.
- **Per_Domain_Document**: A document scoped to a single domain (e.g., a deep dive on `audit` or `executor`). Forbidden during A_Plus_Reconnaissance; deferred to B-tier.
- **Auto_Generated_Reference**: File-level or function-level reference documentation produced by automated tooling (e.g., TypeDoc, madge, dependency-cruiser). Forbidden during A_Plus_Reconnaissance; deferred to D-tier.
- **Snapshot_2026_05_28**: The repo volumetric baseline recorded in `.kiro/steering/project-overview.md` § 项目规模 and `.kiro/steering/execution-plan.md` § 总览 + § 当前维护快照, dated `2026-05-28`. Specifically: `2,130` TypeScript / TSX files, `~545,000` lines, `1,074` Markdown files, `866` test files, `287` specs (`requirements.md 285` / `design.md 286` / `tasks.md 286` / `bugfix.md 3`), tasks-checkbox `7,887 / 8,806`. Treated as ground truth and not re-measured by A_Plus_Reconnaissance.
- **Eleven_Core_Documents**: The eleven numbered documents (`00`-`10`) with fixed titles and fixed purposes that constitute the upper bound of A_Plus_Reconnaissance prose deliverables. Listed in Requirement 6.
- **Reconnaissance_Output_Set**: The complete, finite set of artifacts A_Plus_Reconnaissance is permitted to produce: at most `11` core documents, `8`-`15` SVG diagrams, exactly `1` spec audit table, exactly `1` module inventory, and exactly `1` B_Tier_Recommendation. Anything outside this set is out of scope for Phase 1.

## Requirements

### Requirement 1: Phase 1 goal is control recovery, not document count

**User Story:** As the Author, I want Phase 1 success to be defined by my ability to answer five concrete questions about my own codebase, so that I stop confusing "more documents" with "more control."

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL define Phase 1 completion as the Author being able to answer all of the Five_Control_Recovery_Questions by pointing to a specific section or diagram inside the Reconnaissance_Output_Set.
2. THE A_Plus_Reconnaissance SHALL treat the count of documents produced and the count of SVG diagrams produced as upper bounds, not as success metrics.
3. WHEN the Reconnaissance_Output_Set contains fewer than the maximum permitted documents or diagrams but the Author can answer all Five_Control_Recovery_Questions, THE A_Plus_Reconnaissance SHALL be considered complete.
4. IF a proposed deliverable does not contribute to answering at least one of the Five_Control_Recovery_Questions, THEN THE A_Plus_Reconnaissance SHALL exclude that deliverable from Phase 1.

### Requirement 2: Each of the five questions is answerable from a specific section

**User Story:** As the Author, I want every one of the five control-recovery questions mapped to a specific section in the Reconnaissance_Output_Set, so that "I have control" is verifiable instead of asserted.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL map question Q1 (what is the Main_Business_Loop) to a specific section of document `01 主业务闭环` and at least one SVG diagram.
2. THE A_Plus_Reconnaissance SHALL map question Q2 (what is the Core_Object_Model) to a specific section of document `02 核心对象模型` and at least one SVG diagram.
3. THE A_Plus_Reconnaissance SHALL map question Q3 (how front-end / back-end / spec / task / artifact connect) to specific sections of documents `03 系统分层图`, `05 前端导航地图`, `06 后端能力地图`, and `09 运行时主链路`.
4. THE A_Plus_Reconnaissance SHALL map question Q4 (trunk / branch / legacy classification) to a specific section of the module inventory and to document `04 主要域地图`.
5. THE A_Plus_Reconnaissance SHALL map question Q5 (which storyline for demo / refactor / fundraising / open-source) to document `10 演示主线`.
6. THE A_Plus_Reconnaissance SHALL include a question-to-section traceability table inside document `00 项目总定义` listing, for each of the Five_Control_Recovery_Questions, the document number and section heading where the answer is located.

### Requirement 3: Order of work is fixed and diagrams follow scans

**User Story:** As the Author, I want the reconnaissance work to follow a fixed order, so that diagrams and prose are derived from observation of the actual repo rather than reconstructed from memory.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL execute work phases in this fixed sequence: (1) `scan` (raw enumeration of files, specs, modules), (2) `dedup` (collapse aliases and duplicates), (3) `classify` (assign Spec_Audit_Five_Buckets and Trunk_vs_Branch_vs_Legacy labels), (4) `main loop` (identify and document the Main_Business_Loop), (5) `domain map` (produce the Domain_Map), (6) `reconciliation` (cross-check code vs documented specs and produce document `08 代码-文档对账`), (7) `B/C/D split decision` (produce the B_Tier_Recommendation).
2. THE A_Plus_Reconnaissance SHALL produce every SVG diagram from data captured during the `scan`, `classify`, or `reconciliation` phases.
3. IF a diagram is drawn before its prerequisite scan or classification phase has been completed, THEN THE A_Plus_Reconnaissance SHALL discard that diagram and regenerate it from scan output.
4. THE A_Plus_Reconnaissance SHALL record, for each SVG diagram, the scan or classification artifact it was derived from.

### Requirement 4: Spec audit is a hard progress gate

**User Story:** As the Author, I want the 287-spec audit table completed before any per-domain narrative is written, so that I do not pile new prose on top of unverified existing specs.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL produce the spec audit table covering all `287` specs from the Snapshot_2026_05_28 baseline before any document with a number above `06` is started.
2. WHILE the spec audit table is incomplete, THE A_Plus_Reconnaissance SHALL forbid the creation of any Per_Domain_Document.
3. WHILE Phase 1 is active, THE A_Plus_Reconnaissance SHALL forbid the creation of any Per_Domain_Document regardless of audit completion status.
4. IF a contributor proposes a Per_Domain_Document during Phase 1, THEN THE A_Plus_Reconnaissance SHALL reject it and route the proposal into the input list for the B_Tier_Recommendation.

### Requirement 5: Spec classification is exhaustive, mutually exclusive, and deterministic

**User Story:** As the Author, I want every one of the 287 specs assigned to exactly one of five buckets using deterministic criteria, so that two reviewers reach the same classification independently.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL classify every one of the `287` specs from Snapshot_2026_05_28 into exactly one of the Spec_Audit_Five_Buckets: `IMPLEMENTED_AND_VALID`, `PARTIALLY_IMPLEMENTED`, `DESIGNED_NEVER_BUILT`, `DRIFTED`, or `DUPLICATE`.
2. THE A_Plus_Reconnaissance SHALL apply classification rules in this priority order, assigning the first bucket whose criteria are met: (1) `DUPLICATE`, (2) `DRIFTED`, (3) `PARTIALLY_IMPLEMENTED`, (4) `IMPLEMENTED_AND_VALID`, (5) `DESIGNED_NEVER_BUILT`.
3. THE A_Plus_Reconnaissance SHALL define each bucket with criteria precise enough that two independent reviewers classifying the same spec produce the same bucket assignment.
4. THE A_Plus_Reconnaissance SHALL record, for each spec, the bucket assignment, the rule that triggered the assignment, and at least one observable evidence pointer (e.g., a code path, a tasks-checkbox ratio, or a sibling spec name).
5. WHEN the classification work is complete, THE A_Plus_Reconnaissance SHALL verify that the sum of specs across the five buckets equals `287` and that no spec appears in more than one bucket.
6. IF a spec appears to fit two buckets, THEN THE A_Plus_Reconnaissance SHALL apply the priority order from criterion 2 and record both the chosen bucket and the alternative considered.

### Requirement 6: Eleven core documents have fixed purposes and an upper bound of eleven

**User Story:** As the Author, I want the eleven core documents pre-defined by number and purpose, so that scope creep cannot inflate Phase 1 into a documentation project.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL produce at most `11` core documents, numbered `00` through `10`, with the following fixed titles and fixed purposes:
   - `00 项目总定义` — what this project actually is (one-paragraph definition plus the question-to-section traceability table)
   - `01 主业务闭环` — how user input flows to a final delivered artifact (the Main_Business_Loop)
   - `02 核心对象模型` — relationships among `goal` / `run` / `spec` / `artifact` / `task` / `replay`
   - `03 系统分层图` — `client` / `server` / `shared` / `executor` / `docs` layering
   - `04 主要域地图` — domains: `workflow` / `mission` / `executor` / `audit` / `lineage` / `memory` and so on (the Domain_Map)
   - `05 前端导航地图` — pages, stores, panels, routes
   - `06 后端能力地图` — routes, services, core modules
   - `07 Spec 现状审计` — the audit of `287` specs across the Spec_Audit_Five_Buckets
   - `08 代码-文档对账` — code present without documentation, and documentation present without code
   - `09 运行时主链路` — the state sequence one task passes through from start to completion
   - `10 演示主线` — the storyline to use for external demo / refactor / fundraising / open-source narratives
2. THE A_Plus_Reconnaissance SHALL NOT produce a document whose number exceeds `10`.
3. THE A_Plus_Reconnaissance SHALL NOT add new core documents to the numbered set without first updating this requirement and reducing the maximum count elsewhere.
4. WHEN a candidate piece of content does not fit the fixed purpose of any of the Eleven_Core_Documents, THE A_Plus_Reconnaissance SHALL either drop the content or route it to the B_Tier_Recommendation as a B-tier candidate, rather than create a new core document.

### Requirement 7: SVG diagram count is bounded between 8 and 15

**User Story:** As the Author, I want the diagram count bounded both below and above, so that the deliverable is neither under-illustrated nor over-illustrated.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL produce at least `8` and at most `15` SVG diagrams in total across the Reconnaissance_Output_Set.
2. THE A_Plus_Reconnaissance SHALL designate the following diagrams as mandatory: (D1) the Main_Business_Loop end-to-end flow, (D2) the Core_Object_Model entity diagram, (D3) the layering diagram for `03 系统分层图`, (D4) the Domain_Map for `04 主要域地图`, (D5) the front-end navigation map for `05 前端导航地图`, (D6) the back-end capability map for `06 后端能力地图`, (D7) the Spec_Audit_Five_Buckets distribution diagram, (D8) the runtime state sequence for `09 运行时主链路`.
3. THE A_Plus_Reconnaissance SHALL designate any additional diagrams (between `0` and `7`) as optional and SHALL only produce them when they answer one of the Five_Control_Recovery_Questions more directly than text would.
4. IF a candidate diagram beyond the mandatory `8` does not contribute to answering one of the Five_Control_Recovery_Questions, THEN THE A_Plus_Reconnaissance SHALL exclude it from the Reconnaissance_Output_Set.

### Requirement 8: The Reconnaissance_Output_Set is bounded and Phase 1 exit is gated by a cap audit

**User Story:** As the Author, I want a final cap audit before Phase 1 exits, so that I know I did not silently expand the deliverable.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL produce exactly the following Reconnaissance_Output_Set: at most `11` core documents (Requirement 6), between `8` and `15` SVG diagrams (Requirement 7), exactly `1` spec audit table, exactly `1` module inventory, and exactly `1` B_Tier_Recommendation.
2. WHEN Phase 1 is declared complete, THE A_Plus_Reconnaissance SHALL run a cap audit verifying: (a) document count `≤ 11`, (b) SVG count between `8` and `15` inclusive, (c) exactly one spec audit table exists, (d) exactly one module inventory exists, (e) exactly one B_Tier_Recommendation exists.
3. IF the cap audit detects any value outside its permitted range, THEN THE A_Plus_Reconnaissance SHALL block Phase 1 exit until the offending artifact is removed, merged, or split.
4. THE A_Plus_Reconnaissance SHALL record the cap-audit result inside document `00 项目总定义` as a final completion stamp.

### Requirement 9: Out-of-scope work is explicitly forbidden in Phase 1

**User Story:** As the Author, I want the out-of-scope items written into the spec, so that I can refuse work without re-litigating scope.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL exclude all Per_Domain_Documents from Phase 1 and route them to B-tier.
2. THE A_Plus_Reconnaissance SHALL exclude all Auto_Generated_References (file-level and function-level) from Phase 1 and route them to D-tier.
3. THE A_Plus_Reconnaissance SHALL exclude any diagram requiring TypeDoc, madge, or dependency-cruiser from Phase 1 and route it to D-tier.
4. THE A_Plus_Reconnaissance SHALL exclude any work that rewrites existing specs from Phase 1.
5. THE A_Plus_Reconnaissance SHALL exclude any work that adds new product features from Phase 1.
6. IF a proposed task falls into any of the categories listed in criteria 1-5, THEN THE A_Plus_Reconnaissance SHALL reject the task and record it in the B_Tier_Recommendation as a candidate for a later tier.

### Requirement 10: B_Tier_Recommendation is an output, not an input

**User Story:** As the Author, I want the B-tier scope decided by what the A+ reconnaissance reveals, so that B-tier does not lock in assumptions A+ would have invalidated.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL NOT specify the B-tier scope in this requirements document or in any document numbered `00`-`10`.
2. THE A_Plus_Reconnaissance SHALL produce the B_Tier_Recommendation as the final deliverable of Phase 1, after the spec audit, the module inventory, the Main_Business_Loop document, the Domain_Map, and the code-vs-doc reconciliation are complete.
3. THE B_Tier_Recommendation SHALL itself be classified as an A+-tier deliverable.
4. THE B_Tier_Recommendation SHALL list, for each candidate B-tier scope item, the evidence from A+ that motivates it (a specific bucket assignment, a specific reconciliation gap, or a specific Trunk_vs_Branch_vs_Legacy label).
5. WHEN B-tier work later begins, THE Author SHALL treat the B_Tier_Recommendation as the input scope and SHALL NOT introduce B-tier scope items absent from it without re-running the affected portion of A_Plus_Reconnaissance.

### Requirement 11: Snapshot_2026_05_28 is consumed as ground truth, not re-measured

**User Story:** As the Author, I want A_Plus_Reconnaissance to consume the existing volumetric snapshot rather than re-counting files, so that effort focuses on meaning instead of measurement.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL treat the file counts, line counts, spec counts, and tasks-checkbox ratios recorded in Snapshot_2026_05_28 as authoritative.
2. THE A_Plus_Reconnaissance SHALL NOT re-measure file counts, line counts, or markdown counts during Phase 1.
3. WHEN a document or diagram requires a volumetric figure, THE A_Plus_Reconnaissance SHALL cite Snapshot_2026_05_28 as the source.
4. IF the Author observes a measurable discrepancy between Snapshot_2026_05_28 and the working tree (for example, a new spec directory appearing during Phase 1), THEN THE A_Plus_Reconnaissance SHALL record the discrepancy as a footnote and continue using the snapshot baseline rather than reopening the snapshot.
5. THE A_Plus_Reconnaissance SHALL focus scan effort on relationships, ownership, and boundaries (i.e., meaning) rather than on volumetric counts.

### Requirement 12: Tool-chain is unconstrained; the spec governs outputs not tools

**User Story:** As the Author, I want flexibility in scanning tools so that I can use whichever instrument fits a question best, while the spec still guarantees the deliverable shape.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL permit the use of `git`, `rg`, `find`, `grep_search`, `read_file`, `list_directory`, and ad-hoc Node scripts placed under `.tmp/` for scanning, classification, and reconciliation work.
2. THE A_Plus_Reconnaissance SHALL NOT mandate any specific tool for scanning, classification, or diagram generation.
3. THE A_Plus_Reconnaissance SHALL specify the shape and content of every deliverable in the Reconnaissance_Output_Set independently of the tools used to produce it.
4. WHERE an ad-hoc scanning script is used, THE A_Plus_Reconnaissance SHALL record the script under `.tmp/` and SHALL cite the script from the deliverable that consumes its output.

### Requirement 13: Phase 1 has a bounded time budget

**User Story:** As the Author, I want a time budget on Phase 1 so that reconnaissance does not silently expand into a multi-week documentation project.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL fit within a focused working budget of `3` to `5` working days for the Author.
2. WHEN the elapsed focused working time approaches `5` days and the cap audit (Requirement 8) has not yet passed, THE A_Plus_Reconnaissance SHALL reduce optional SVG diagrams down to the mandatory `8` (Requirement 7 criterion 2) and reduce optional content inside the Eleven_Core_Documents before extending the budget.
3. IF the focused working time exceeds `5` days, THEN THE A_Plus_Reconnaissance SHALL stop adding new content, exit Phase 1 with whatever subset of the Reconnaissance_Output_Set is complete, and record the unfinished items inside the B_Tier_Recommendation as carry-over candidates.

### Requirement 14: Reconnaissance complements existing specs; it does not rewrite them

**User Story:** As the Author, I want reconnaissance to *index* and *cross-reference* existing specs rather than restate them, so that the `287`-spec corpus is consolidated instead of duplicated.

#### Acceptance Criteria

1. THE A_Plus_Reconnaissance SHALL operate by adding indexing, cross-references, and relationship diagrams over the existing `287` specs, rather than by rewriting them.
2. THE A_Plus_Reconnaissance SHALL determine which specs remain valid (via the Spec_Audit_Five_Buckets in Requirement 5) before deciding what new prose to add.
3. WHEN a gap is identified between code and existing specs, THE A_Plus_Reconnaissance SHALL record the gap inside document `08 代码-文档对账` rather than rewriting the affected spec.
4. IF closing a gap would require rewriting an existing spec, THEN THE A_Plus_Reconnaissance SHALL route the rewrite to B-tier via the B_Tier_Recommendation.
