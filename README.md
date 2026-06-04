<p align="center">
  <img src="./docs/assets/banner.png" alt="WhyBuddy" width="100%" />
</p>

<h1 align="center">🏢 WhyBuddy</h1>

<p align="center">
  <strong>WhyBuddy — an AI agent team that challenges your product idea and rehearses it before you start building.</strong>
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> ·
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://github.com/xiaojilele-glitch/WhyBuddy"><img alt="repo" src="https://img.shields.io/badge/🌐_GitHub_Repo-blue?style=for-the-badge" /></a>
  <a href="./ROADMAP.md"><img alt="roadmap" src="https://img.shields.io/badge/🗺️_Roadmap-111827?style=for-the-badge" /></a>
  <a href="./CONTRIBUTING.md"><img alt="contribute" src="https://img.shields.io/badge/🤝_Contribute-16a34a?style=for-the-badge" /></a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/Status-Early_Testing-orange?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/License-MIT-111827?style=flat-square" />
  <img alt="stars" src="https://img.shields.io/github/stars/xiaojilele-glitch/WhyBuddy?style=flat-square" />
  <img alt="ts" src="https://img.shields.io/badge/TypeScript-486k_Lines-2563eb?style=flat-square" />
  <img alt="tests" src="https://img.shields.io/badge/Tests-7,771_Cases-0f766e?style=flat-square" />
  <img alt="specs" src="https://img.shields.io/badge/Specs-273_Dirs-7c3aed?style=flat-square" />
</p>

---

## ⚡ 30 Second Overview

> **You enter one sentence. The system rehearses a complete product plan for you.**
>
> Spec documents · System architecture · Route planning · Prompt pack · Effect preview
>
> Fully visible. Fully exportable. Fully backed by an evidence trail.

<br/>

<table>
<tr>
<td width="50%">

### 🎯 Pain

You spend **days** writing a PRD, **weeks** aligning the team, and **months** before you know whether the direction is right.

</td>
<td width="50%">

### 💡 Solution

Enter an idea → **5 minutes** → full rehearsal → decide whether it is worth building → if not, move to the next idea.

</td>
</tr>
</table>

---

## 🧩 The `whybuddy` Skill Package (Portable · Embeddable in Any Agent)

Besides the full app, WhyBuddy also ships a **self-contained Skill package** that can be dropped into Trae, Claude, or any host that supports Agent Skills. One sentence in → a reviewable, deliverable spec package out, with every gate **actually run by scripts** instead of merely claimed by the model.

> **Guarantee the floor, not the ceiling.** Deterministic scripts guarantee the *floor* — valid structure, success criteria covered by requirements, EARS acceptance, cited evidence, gate results logged, every artifact provenance-labeled. They do not promise the *ceiling*; real depth still needs a real repo and a human. Everything it generates is labeled with how much you can trust it.

### How to Use

The ready-to-import Skill archive is included at [`skills/whybuddy.zip`](./skills/whybuddy.zip).

```bash
# 1. Drop the skill package into your agent host's skills directory
#    (Trae: Skills · Claude: skill)
# 2. Give it a one-sentence idea — it produces the full spec package below
# 3. For image previews, provide an image endpoint key:
export IMAGE_API_KEY=sk-...           # or fill image_config.json -> api_key
# default: gpt-image-2 · 2K · 16:9 · 600s timeout (all configurable)

# Generate or regenerate images yourself at any time, one per module:
python scripts/finalize_previews.py           # module images from spec_tree
python scripts/batch_images.py prompts.txt    # batch generation against your endpoint

# Audit any image run in one command, catching fake, fallback, or duplicated images:
python scripts/check_previews_real.py
```

### Use Cases

| Category | Examples |
|:---------|:---------|
| 🆕 Build a product from zero | AI meeting minutes · income dashboard · OKR tracker · lightweight CRM · resume optimizer |
| 🤖 Build an AI agent | PRD generator · issue triage · code review · investment research · sentiment analysis |
| 🧩 Add a feature to an existing project | RBAC for React · i18n for Next.js · audit logging for a Node API · OpenAPI enhancement for FastAPI |

### Output Package Structure

```text
<project-name>/
├─ spec_tree.json            ← structure source; docs / matrix / images all derive from it
├─ clarified_brief.json      goal · constraints · numbered success criteria
├─ route_options.json · selected_route.json · decision_mode.json
├─ traceability_matrix.json  traceability matrix: requirement ↔ design ↔ task ↔ evidence ↔ test case
├─ docs/
│  ├─ requirements.md · design.md · tasks.md
│  ├─ interface_contracts.md · test_cases.md · open_items.md
│  └─ prompt_pack.md · effect_preview.md · architecture.mmd
├─ checks_ledger.json        every gate's real script + exit code + output (not hand-waved)
├─ companion_log.json        companion trace: what the critic flagged · which real sources were cited
├─ handoff_manifest.json     delivery manifest: every artifact carries source + confidence labels
├─ previews/                 per-module UI mockups ("preview · unverified") + provenance.json
└─ scripts/                  deterministic scripts — the floor itself
   ├─ gate.py                     ledger wrapper: run any check and record the result
   ├─ validate_spec_tree.py       SPEC tree validation: structure · coverage · EARS · evidence sources
   ├─ check_content_quality.py    document validation: required sections · length · EARS acceptance
   ├─ check_companion.py          companion trace must be real
   ├─ finalize_previews.py        image gate: generate real module images, judged by real success count
   ├─ check_previews_real.py      audit: catch fake / fallback / duplicate images
   ├─ batch_images.py             standalone batch image generation
   └─ fallback_tree.py            naturally valid minimal tree when the LLM is unavailable
```

### How to Know It Is Not Faking It

- **`checks_ledger.json`** — what ran, exit code, and output. Written automatically by scripts.
- **`companion_log.json`** — what the critic flagged and which real sources the grounding cited.
- **Provenance labels** — `previews/*.png` are marked "preview · unverified"; `interface_contracts.md` is marked "draft · unverified".
- **`check_previews_real.py`** — one command tells you whether images are real generations or placeholders.

---

## 🔄 Workflow

```
    ╭──────────────────────────────────────────────────────────╮
    │                                                          │
    │   💬 "AI comic platform"                                │
    │       │                                                  │
    │       ▼                                                  │
    │   ① 🔍 Smart clarification                              │
    │       Goals · Constraints · Personas · Success criteria  │
    │       │                                                  │
    │       ▼                                                  │
    │   ② 🗺️ Route planning                                   │
    │       Main route + Alternatives + Risk + Cost estimate   │
    │       │                                                  │
    │       ▼                                                  │
    │   ③ 🌱 SPEC tree                                        │
    │       Decomposed into modular spec document nodes        │
    │       │                                                  │
    │       ▼                                                  │
    │   ④ 📄 Spec documents (streaming)                        │
    │       Requirements / Design / Tasks · visible in time    │
    │       │                                                  │
    │       ▼                                                  │
    │   ⑤ 🎬 Effect preview                                   │
    │       Architecture + prompt pack + actionable next steps │
    │       │                                                  │
    │       ▼                                                  │
    │   📦 Export → Markdown / ZIP / Online preview            │
    │                                                          │
    ╰──────────────────────────────────────────────────────────╯
```

> 💡 The entire process is **visible in real time**: a 3D office scene shows the agent team collaborating, while the right-side workbench streams generation progress and stage indicators.

---

## 🤖 FSD Agent Fleet

Seven specialized AI roles collaborate in every rehearsal:

| Role | Responsibility |
|:----:|:---------------|
| 🧭 **Planner** | Breaks the goal into executable routes |
| ❤️ **Clarifier** | Fills gaps and resolves ambiguity |
| 🔍 **Researcher** | Collects context and validates assumptions |
| ✍️ **Generator** | Produces spec documents and artifacts |
| ⚙️ **Executor** | Runs code in the Docker sandbox |
| 👁️ **Reviewer** | Checks quality and marks issues |
| 📊 **Auditor** | Maintains the evidence chain and compliance trail |

Each role can access **50+ AIGC capability nodes**, Docker sandbox, MCP tools, Skills, and domain knowledge injection.

---

## ✨ Core Capabilities

<table>
<tr>
<td width="33%" valign="top">

### 👁️ Full Observability
See every step: active roles, invoked capabilities, ReAct cycle stage, and produced artifacts. **No black boxes.**

</td>
<td width="33%" valign="top">

### 🗺️ Multi-Route Planning
Quick / Standard / Deep / Conservative routes, each with risk, cost, and takeover points. **Choose before it runs.**

</td>
<td width="33%" valign="top">

### 🛑 Boundary Takeover
Clarification, approval, risk, budget, and delivery are explicit pause points. **It never fails silently.**

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🔁 Evidence & Replay
Exportable artifacts, audit logs, and replay timelines. **Trace any decision at any time.**

</td>
<td width="33%" valign="top">

### 🐳 Docker Sandbox
Real code execution in isolated containers, with HMAC callbacks and real-time terminal streaming.

</td>
<td width="33%" valign="top">

### 📦 Fully Exportable
Export Markdown, ZIP, or online previews. Every rehearsal becomes a shareable document package.

</td>
</tr>
</table>

---

## 🚀 Quick Start

```bash
git clone https://github.com/xiaojilele-glitch/WhyBuddy.git && cd WhyBuddy
pnpm install
pnpm run dev:all          # full stack: frontend + server + executor
```

<details>
<summary>💻 <strong>Browser-only mode</strong> (no server, no .env)</summary>

```bash
pnpm run dev:frontend     # open localhost:5173
```

Or open the repository at [xiaojilele-glitch/WhyBuddy](https://github.com/xiaojilele-glitch/WhyBuddy).

</details>

<details>
<summary>📋 <strong>Requirements</strong></summary>

- Node.js 22+
- pnpm
- Docker (optional, for full executor mode)

</details>

---

## 🖼️ Product Screens

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/A.png" alt="3D office + SPEC tree" /></td>
    <td width="50%"><img src="./docs/assets/B.png" alt="Route planning" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/C.png" alt="Streaming spec documents" /></td>
    <td width="50%"><img src="./docs/assets/D.png" alt="Execution panel" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/E.png" alt="Agent fleet status" /></td>
    <td width="50%"><img src="./docs/assets/F.png" alt="Evidence and replay" /></td>
  </tr>
</table>

---

## 📝 Rehearsal Examples

> Every rehearsal is a shareable piece of content. **50 rehearsals = 50 distribution opportunities.**

| 💬 Input | 📦 Output |
|:---------|:----------|
| "AI comic platform" | 6 SPEC modules · content pipeline · monetization model · system architecture |
| "Permission management SaaS" | 8 SPEC modules · RBAC · multi-tenant · API contracts |
| "Sentiment analysis tool" | 5 SPEC modules · data pipeline · model selection · alert engine |
| "Indie developer bookkeeping app" | 4 SPEC modules · local-first · sync plan · privacy compliance |
| "Enterprise knowledge base" | 7 SPEC modules · RAG pipeline · permission model · incremental indexing |
| "Cross-border product picker" | 6 SPEC modules · data sources · scoring algorithm · competitor analysis |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  🌐 Entry Layer       Browser · Feishu Relay · destination input│
├─────────────────────────────────────────────────────────────────┤
│  🖥️ Frontend Layer    3D scene · task cockpit · route view      │
│                       drive state · takeover panel · replay     │
├─────────────────────────────────────────────────────────────────┤
│  🧠 Cube Brain        10-stage workflow · Mission Runtime       │
│                       dynamic roles · cost governance · review  │
├─────────────────────────────────────────────────────────────────┤
│  🔮 Projection Layer  Mission→Destination · Workflow→Route      │
│                       State→DriveState · Decision→Takeover      │
├─────────────────────────────────────────────────────────────────┤
│  💡 Intelligence      3-level memory · knowledge graph · RAG    │
│                       self-evolution · LLM multi-provider       │
├─────────────────────────────────────────────────────────────────┤
│  🛡️ Trust Layer       hash-chain audit · lineage DAG · evidence │
├─────────────────────────────────────────────────────────────────┤
│  ⚙️ Execution Layer   Docker containers · HMAC · sandbox · TTY  │
├─────────────────────────────────────────────────────────────────┤
│  🔗 Interop Layer     A2A protocol · Swarm · Guest Agent market │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| Frontend | React 19 · Vite · TypeScript · Zustand · Three.js (R3F) · Framer Motion |
| Server | Express · Socket.IO · TypeScript |
| AI | OpenAI-compatible APIs (any provider) |
| Execution | Docker (dockerode) · browser runtime · native runtime |
| Testing | Vitest · fast-check (PBT) |
| Storage | IndexedDB (browser) · JSON (server) |

---

## 📊 Project Scale

| Metric | Count |
|:-------|------:|
| Project files | 4,707 |
| TypeScript/TSX files | 1,837 |
| TypeScript lines | 486,932 |
| Test files | 723 |
| Test cases | 7,771 |
| Spec directories | 273 |
| Spec Markdown files | 879 |
| Task checkboxes | 7,093 ✅ / 1,072 ⬜ |

---

## ⚔️ Comparison With Other Platforms

| Feature | Dify | n8n | CrewAI | LangGraph | **WhyBuddy** |
|:--------|:---:|:---:|:---:|:---:|:---:|
| Open source | ✅ | ✅ | ✅ | ✅ | ✅ |
| One sentence to a complete product | ❌ | ❌ | ❌ | ❌ | ✅ |
| Spec document generation (requirements + design + tasks) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-route planning | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Multi-role agent fleet | ❌ | ❌ | ✅ | ✅ | ✅ |
| Real-time 3D observability | ❌ | ❌ | ❌ | ❌ | ✅ |
| Human takeover governance | ⚠️ | ⚠️ | ❌ | ❌ | ✅ |
| Replay and audit | ❌ | ❌ | ❌ | ❌ | ✅ |
| Docker sandbox | ❌ | ⚠️ | ❌ | ❌ | ✅ |
| Export Markdown/ZIP | ❌ | ❌ | ❌ | ❌ | ✅ |
| Browser-only demo | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🤝 Contributing

```bash
1. Fork & clone → pnpm install
2. pnpm run dev:frontend (UI) or pnpm run dev:all (full stack)
3. Before submitting: node --run check && pnpm run test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## ⭐ Star History

> Every rehearsal generated by the engine is content that helps others discover new possibilities. Star this repository to help more people find it.

[![Star History Chart](https://api.star-history.com/svg?repos=xiaojilele-glitch/WhyBuddy&type=Date)](https://star-history.com/#xiaojilele-glitch/WhyBuddy&Date)

---

<p align="center">
  <a href="./LICENSE"><strong>MIT License</strong></a> · Hosted at <a href="https://github.com/xiaojilele-glitch/WhyBuddy">xiaojilele-glitch/WhyBuddy</a>
</p>
