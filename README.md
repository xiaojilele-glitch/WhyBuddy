<p align="center">
  <img src="./docs/assets/banner.png" alt="WhyBuddy" width="100%" />
</p>

<h1 align="center">🌐 WhyBuddy</h1>

<p align="center">
  <strong>
WhyBuddy — an AI agent crew that questions your product idea and rehearses it before you build.</strong><br/>
  <em>Edge execution · Cloud orchestration · One sentence in, full spec out</em>
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> ·
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://opencroc.github.io/whybuddy/"><img alt="demo" src="https://img.shields.io/badge/🌐_Live_Demo-blue?style=for-the-badge" /></a>
  <a href="./ROADMAP.md"><img alt="roadmap" src="https://img.shields.io/badge/🗺️_Roadmap-111827?style=for-the-badge" /></a>
  <a href="./CONTRIBUTING.md"><img alt="contribute" src="https://img.shields.io/badge/🤝_Contribute-16a34a?style=for-the-badge" /></a>
</p>

---

## 🚀 Quick Start (1 minute · 2 commands)

```bash
cp .env.example .env       # then fill in LLM_API_KEY (see "MUST FILL" section)
docker compose up
```

Open <http://localhost:3000> and you're in. The WhyBuddy server (3001 internally) is published on host port **3000** so you can navigate directly without remembering port numbers.

> **Three ways to run** — pick whichever matches your environment:
> 1. **Online demo** — <https://opencroc.github.io/whybuddy/> (browser-only mode, no install).
> 2. **Docker compose** — the snippet above; one MySQL + one WhyBuddy container.
> 3. **Local dev** — `pnpm install && pnpm run dev:all` (full stack, hot reload, see [Local Dev](#-local-dev) below).

---

## 🔑 MUST FILL — without these you'll get template-only output

The server starts even when these are blank, but every autopilot bridge silently
falls back to deterministic templates and you'll see the same canned answers
regardless of input. Fill these two and you'll get real LLM-driven generation:

| Variable | What to put | Where to get one |
|:---------|:------------|:-----------------|
| **`LLM_API_KEY`** | An OpenAI-compatible API key | OpenAI · DashScope · OpenRouter · Moonshot · SiliconFlow · Zhipu · DeepSeek · any provider that speaks the OpenAI Chat / Responses API |
| **`SESSION_SECRET`** | Any 64-char hex string | `openssl rand -hex 32` |

`LLM_BASE_URL` and `LLM_MODEL` should match the provider you picked
(default values target `api.openai.com` + `gpt-5.4`). Everything else in
`.env.example` ships with safe defaults — leave them alone unless you have
a reason.

---

## 💡 What it does (in 30 seconds)

You type one sentence. The system rehearses the entire product for you:

```
    💬 "AI comic platform"
        │
        ▼
    ① 🔍 Smart Clarification    Goals · Constraints · Personas · Success criteria
        │
        ▼
    ② 🗺️ Route Planning         Main route + Alternatives + Risk + Cost
        │
        ▼
    ③ 🌳 SPEC Tree              Modular spec node decomposition
        │
        ▼
    ④ 📄 Spec Documents         Requirements / Design / Tasks (streaming)
        │
        ▼
    ⑤ 🎨 Effect Preview         Architecture + Prompts + Next steps
        │
        ▼
    📦 Export → Markdown / ZIP / Online
```

> 💡 The entire process is **observable in real time**: a 3D office scene shows
> the agent fleet collaborating, while the right-rail workbench streams
> generation progress with stage indicators.

---

## 🤖 The FSD Fleet

Seven specialized AI roles collaborate on every rehearsal:

| Role | Responsibility |
|:----:|:--------------|
| 🧠 **Planner** | Breaks the goal into executable routes |
| ❓ **Clarifier** | Fills gaps, resolves ambiguity |
| 🔬 **Researcher** | Gathers context, validates assumptions |
| ✍️ **Generator** | Produces spec documents & artifacts |
| ⚙️ **Operator** | Executes in Docker sandbox when needed |
| 👁️ **Reviewer** | Checks quality, flags issues |
| 📋 **Auditor** | Maintains evidence trail & compliance |

Each role has access to **50+ AIGC capability nodes**, Docker sandbox, MCP
tools, Skills, and domain knowledge injection.

---

## ✨ Key Features

<table>
<tr>
<td width="33%" valign="top">

### 👁️ Full Observability
See every step: active roles, invoked capabilities, ReAct cycle stage, produced artifacts. **No black boxes.**

</td>
<td width="33%" valign="top">

### 🗺️ Multi-Route Planning
Quick / Standard / Deep / Conservative routes with risk, cost, and takeover points. **Choose before anything runs.**

</td>
<td width="33%" valign="top">

### 🛑 Human Takeover
Clarification, approval, risk, budget, delivery — all explicit pause points. **Never silently fails.**

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🔁 Evidence & Replay
Exportable artifacts, audit logs, replay timeline. **Inspect any decision at any moment.**

</td>
<td width="33%" valign="top">

### 🐳 Docker Sandbox
Real code execution in isolated containers with HMAC callbacks and live terminal streaming.

</td>
<td width="33%" valign="top">

### 📦 Export Everything
Markdown, ZIP, or online preview. Every rehearsal is a shareable document package.

</td>
</tr>
</table>

---

## 🛠️ Local Dev

```bash
git clone https://github.com/opencroc/whybuddy.git && cd whybuddy
pnpm install
pnpm run dev:all          # Full stack: frontend + server + executor
```

<details>
<summary>💻 <strong>Browser-only mode</strong> (no server, no .env)</summary>

```bash
pnpm run dev:frontend     # Opens at localhost:5173
```

Or visit the [Live Demo](https://opencroc.github.io/whybuddy/) directly on GitHub Pages.

</details>

<details>
<summary>📋 <strong>Requirements</strong></summary>

- Node.js 22+
- pnpm
- Docker (optional, only required for full sandbox executor mode; WhyBuddy
  falls back to a native runner when Docker is unavailable)

</details>

<details>
<summary>🐳 <strong>Notes on the Docker setup</strong></summary>

- The compose file boots **two containers**: `whybuddy-app` (the server +
  bundled frontend) and `whybuddy-mysql` (MySQL 8 with the
  `whybuddy` schema kept for backward compat — the data shape is
  unchanged, only the project brand changed).
- The Lobster Executor sandbox is **not** in the compose file by default.
  Docker-in-Docker introduces extra surface area and isn't required for
  the spec generation loop. Opt in by setting
  `LOBSTER_EXECUTION_MODE=real` and pointing the host's Docker daemon at
  the executor service yourself.
- All `BLUEPRINT_*_ENABLED` flags default to safe values matched to a
  fresh dev environment; the **AUTOPILOT_REAL_RUNTIME** master switch is
  on by default — bridges that find their dependencies will run real,
  bridges that don't will fall back gracefully.

</details>

---

## 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/A.png" alt="3D Office + SPEC Tree" /></td>
    <td width="50%"><img src="./docs/assets/B.png" alt="Route Planning" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/C.png" alt="Streaming Spec Documents" /></td>
    <td width="50%"><img src="./docs/assets/D.png" alt="Execution Panel" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/E.png" alt="Agent Fleet Status" /></td>
    <td width="50%"><img src="./docs/assets/F.png" alt="Evidence & Replay" /></td>
  </tr>
</table>

---

## 📝 Rehearsal Examples

> Every rehearsal is a shareable piece of content. **50 rehearsals = 50
> distribution opportunities.**

| 💬 Input | 📦 Output |
|:---------|:----------|
| "AI comic platform" | 6 SPEC modules · content pipeline · monetization · architecture |
| "Permission management SaaS" | 8 SPEC modules · RBAC · multi-tenant · API contracts |
| "Sentiment analysis tool" | 5 SPEC modules · data pipeline · model selection · alerts |
| "Indie dev bookkeeping app" | 4 SPEC modules · local-first · sync · privacy compliance |
| "Enterprise knowledge base" | 7 SPEC modules · RAG pipeline · permissions · indexing |
| "Cross-border product picker" | 6 SPEC modules · data sources · scoring · competitor analysis |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  🌐 ENTRY          Browser · Feishu Relay · Destination Input   │
├─────────────────────────────────────────────────────────────────┤
│  🖥️ FRONTEND       3D Scene · Task Cockpit · Route View        │
│                    Drive State · Takeover Panel · Replay         │
├─────────────────────────────────────────────────────────────────┤
│  🧠 CUBE BRAIN     10-Stage Workflow · Mission Runtime          │
│                    Dynamic Roles · Cost Governance · Review      │
├─────────────────────────────────────────────────────────────────┤
│  🔮 PROJECTION     Mission→Destination · Workflow→Route         │
│                    State→DriveState · Decision→Takeover          │
├─────────────────────────────────────────────────────────────────┤
│  💡 INTELLIGENCE   3-Level Memory · Knowledge Graph · RAG       │
│                    Self-Evolution · LLM Multi-Provider           │
├─────────────────────────────────────────────────────────────────┤
│  🛡️ TRUST          Hash-Chain Audit · Lineage DAG · Evidence    │
├─────────────────────────────────────────────────────────────────┤
│  ⚙️ EXECUTION      Docker Containers · HMAC · Sandbox · Terminal│
├─────────────────────────────────────────────────────────────────┤
│  🔗 INTEROP        A2A Protocol · Swarm · Guest Agent Market    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| Frontend | React 19 · Vite · TypeScript · Zustand · Three.js (R3F) · Framer Motion |
| Server | Express · Socket.IO · TypeScript |
| AI | OpenAI-compatible API (any provider) |
| Execution | Docker (dockerode) · Browser Runtime · Native Runtime |
| Testing | Vitest · fast-check (PBT) |
| Storage | IndexedDB (browser) · JSON (server) |

---

## 📊 Project Scale

| Metric | Count |
|:-------|------:|
| Project files | 4,707 |
| TypeScript/TSX files | 2,130 |
| Lines of TypeScript | 545,000 |
| Test files | 866 |
| Spec directories | 287 |
| Spec markdown files | 1,074 |
| Task checkboxes | 7,887 ✅ / 919 ⬜ |

---

## ⚔️ Comparison

| Feature | Dify | n8n | CrewAI | LangGraph | **WhyBuddy** |
|:--------|:---:|:---:|:---:|:---:|:---:|
| Open Source | ✅ | ✅ | ✅ | ✅ | ✅ |
| One sentence → full product | ❌ | ❌ | ❌ | ❌ | ✅ |
| Spec generation (Req+Design+Tasks) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-route planning | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Multi-role agent fleet | ❌ | ❌ | ✅ | ✅ | ✅ |
| Real-time 3D observability | ❌ | ❌ | ❌ | ❌ | ✅ |
| Human takeover governance | ⚠️ | ⚠️ | ❌ | ❌ | ✅ |
| Replay & audit trail | ❌ | ❌ | ❌ | ❌ | ✅ |
| Docker sandbox | ❌ | ⚠️ | ❌ | ❌ | ✅ |
| Export Markdown/ZIP | ❌ | ❌ | ❌ | ❌ | ✅ |
| Browser-only demo | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🤝 Contributing

```
1. Fork & clone → pnpm install
2. pnpm run dev:frontend (UI) or pnpm run dev:all (full stack)
3. Before PR: node --run check && pnpm run test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## 🪪 About the name

**WhyBuddy** is two characters: 端 (edge / endpoint) and 云 (cloud).
Together they describe the model the project converges on — workloads execute
**at the edge** when they can (browser runtime, native sandbox, your laptop's
Docker), and **fall back to the cloud** when they need shared coordination
(LLM, MCP servers, the Lobster Executor service). The codebase still carries
the legacy package name `whybuddy` in some internal modules; that is
intentional and tracked under
[`whybuddy-internal-rename`](./.kiro/specs/) for a future sweep, not the entry
point you read first.

The domain `whybuddy.com` is reserved for the hosted edition.

---

## ⭐ Star History

> Every rehearsal is content that helps others discover possibilities. Star
> this repo to help more people find it.

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/whybuddy&type=Date)](https://star-history.com/#opencroc/whybuddy&Date)
