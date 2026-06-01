<p align="center">
  <img src="./docs/assets/banner.png" alt="WhyBuddy banner" width="100%" />
</p>

<h1 align="center"><img src="./docs/assets/logo.png" alt="WhyBuddy" height="44" align="absmiddle" />&nbsp;&nbsp;|&nbsp;&nbsp;WhyBuddy</h1>

<p align="center">
  <strong>输入一个想法，推演出一个完整的产品。私有部署、全程可见、证据留痕。</strong>
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/状态-早期测试-orange" />
  <img alt="license" src="https://img.shields.io/badge/协议-MIT-111827" />
  <img alt="stars" src="https://img.shields.io/github/stars/opencroc/whybuddy?style=flat" />
  <img alt="version" src="https://img.shields.io/badge/版本-v1.0.0-2563eb" />
  <img alt="frontend" src="https://img.shields.io/badge/React%2019-Vite-2563eb" />
  <img alt="3d" src="https://img.shields.io/badge/3D-Three.js-f97316" />
  <img alt="executor" src="https://img.shields.io/badge/执行器-Docker-7c3aed" />
</p>

<p align="center">
  <img alt="project files" src="https://img.shields.io/badge/项目文件-4,707-111827" />
  <img alt="typescript scale" src="https://img.shields.io/badge/TS%2FTSX-1,837%20files%20%7C%20486,932%20lines-2563eb" />
  <img alt="test scale" src="https://img.shields.io/badge/测试-723%20files%20%7C%207,771%20cases-0f766e" />
  <img alt="spec markdown scale" src="https://img.shields.io/badge/specs-273%20dirs%20%7C%20879%20md-7c3aed" />
</p>

<p align="center">
  <img alt="web aigc specs" src="https://img.shields.io/badge/Web--AIGC-58%20specs-f97316" />
  <img alt="web aigc node specs" src="https://img.shields.io/badge/节点规格-52-f97316" />
  <img alt="web aigc platform specs" src="https://img.shields.io/badge/平台族-6-f97316" />
  <img alt="autopilot specs" src="https://img.shields.io/badge/Autopilot%20family-88%20specs-0ea5e9" />
  <img alt="autopilot prefix specs" src="https://img.shields.io/badge/autopilot-61-0ea5e9" />
  <img alt="blueprint prefix specs" src="https://img.shields.io/badge/blueprint-13-0ea5e9" />
  <img alt="project prefix specs" src="https://img.shields.io/badge/project-10-0ea5e9" />
  <img alt="task autopilot prefix specs" src="https://img.shields.io/badge/task--autopilot-4-0ea5e9" />
</p>

<p align="center">
  <img alt="tasks checked" src="https://img.shields.io/badge/tasks.md-7,093%2F8,165%20checked-16a34a" />
  <img alt="unchecked tasks" src="https://img.shields.io/badge/未勾选-1,072-f97316" />
  <img alt="top level tasks" src="https://img.shields.io/badge/顶层任务-2,463%2F2,794-84cc16" />
  <img alt="complete specs" src="https://img.shields.io/badge/完成规格-204%2F273-f59e0b" />
  <img alt="missing tasks file" src="https://img.shields.io/badge/缺%20tasks.md-1-64748b" />
</p>

<p align="center">
  <a href="https://opencroc.github.io/whybuddy/">在线演示</a> •
  <a href="./docs/">文档</a> •
  <a href="./ROADMAP.md">路线图</a> •
  <a href="./CONTRIBUTING.md">贡献指南</a> •
  <a href="./CODE_OF_CONDUCT.md">行为准则</a> •
  <a href="./SECURITY.md">安全政策</a> •
  <a href="./LICENSE">MIT 协议</a>
</p>

> **早期测试版**：正在积极开发中，可能存在粗糙之处。

访问 [在线演示](https://opencroc.github.io/whybuddy/) 或本地运行：

```bash
# 三条命令启动
git clone https://github.com/opencroc/whybuddy.git && cd whybuddy
pnpm install
pnpm run dev:all        # 全栈：前端 + 服务端 + 执行器
# 或者：pnpm run dev:frontend  (纯浏览器模式，无需 .env)
```

---

## 产品界面一览

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/A.png" alt="WhyBuddy 界面截图 A" /></td>
    <td width="50%"><img src="./docs/assets/B.png" alt="WhyBuddy 界面截图 B" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/C.png" alt="WhyBuddy 界面截图 C" /></td>
    <td width="50%"><img src="./docs/assets/D.png" alt="WhyBuddy 界面截图 D" /></td>
  </tr>
    <tr>
    <td width="50%"><img src="./docs/assets/E.png" alt="WhyBuddy 界面截图 E" /></td>
    <td width="50%"><img src="./docs/assets/F.png" alt="WhyBuddy 界面截图 F" /></td>
  </tr>
</table>

---

# 它是什么？

WhyBuddy 是一个开源的 **AI 产品预演引擎**。输入一句话想法，它为你推演出完整的产品方案 —— 规格文档、系统架构、路线规划、提示词包、效果预览 —— 全程可见、全部可导出、全部有证据留痕。

- **一句话输入，完整产品输出。** 不用写 PRD，不用画流程图。输入"AI 漫剧平台"，得到一份完整的产品预演：需求文档、设计文档、系统架构、任务拆解、提示词包。每份预演都是可分享的 Markdown 文档包，可直接用于立项评审、博客发布或投资人沟通。

- **[FSD 角色车队](./docs/)**：一组专业化的 AI 角色 —— 规划师、澄清师、研究员、生成器、执行者、审阅者、审计员 —— 在每次预演中协作。每个角色拥有独立的能力范围（50+ AIGC 节点、Docker 沙箱、MCP 工具、Skills）。你可以通过 3D 办公室场景和流式卡片流实时观看它们思考、讨论和产出。

- **[全流程可观测](./docs/)**：右侧工作台展示每一步：哪些角色正在活跃、哪些能力正在被调用、LLM 在 ReAct 循环的哪个阶段（思考 → 选工具 → 执行 → 观察 → 下一步）、已经产出了哪些产物。没有黑盒。

- **[多路线规划与对比](./docs/)**：系统推荐多条可执行路线（快速 / 标准 / 深度 / 保守），每条都有风险评估、成本预估和接管点。你在任何东西运行之前做出选择。

- **[边界处人工接管](./docs/)**：澄清、审批、风险确认、预算确认、交付审查都是明确的接管点。系统会暂停并询问 —— 它永远不会静默失败或失控运行。

- **[证据与回放](./docs/)**：每次预演都产出可导出的产物、审计日志和回放时间线。你可以检查为什么做了某个决策、调用了哪些工具、LLM 在任何时刻在想什么。支持导出为 Markdown、ZIP 或在线浏览。

---

## 项目现状

这份 README.new 保持和当前代码、spec 和运行能力一致。

已具备的基础：

- mission-first 的 office shell 和 `/tasks` 工作台，负责启动、监控和回看任务执行。
- Node + Express + Socket.IO 服务端，协调 mission 状态、workflow 进度、事件、回放和 API。
- Lobster executor 提供 `mock`、`native`、`real` 三种执行模式，并兼容本地 Docker 行为。
- wait/resume、decision、approval、manual recovery 等人工接管路径。
- review、audit、replay、lineage、evidence、runtime observability 等概念已经在现有 specs 和主线里出现。
- Web-AIGC 主线、Task Autopilot 基线和 Project-first 方向已经形成可追溯的基础。

不在这份 README.new 里承诺的事：

- 不是 open-domain L5 全自动操作员。
- 不是不需要人工审查的万能执行器。
- 高风险副作用、权限变更、外部写入、预算敏感动作和模糊目标仍然需要人工接管。
- 现有 `mission / workflow / runtime` 不需要马上整体重命名。

## 核心概念

任务自动驾驶围绕几个产品对象展开。

| 概念 | 产品含义 | 当前实现锚点 |
| --- | --- | --- |
| `Destination` | 用户想达到的目标，包含约束、成功标准、缺失信息和交付物预期 | mission metadata、runtime context、workflow config |
| `Route` | 可执行路径，包含阶段、候选路线、风险、接管点和可能的重规划 | workflow definition、route family、workflow phase |
| `Drive State` | 解释系统当前在做什么的高层状态机 | mission runtime state、workflow state、wait/resume、review state |
| `Fleet` | 由 Planner、Clarifier、Researcher、Operator、Generator、Reviewer、Auditor 等组成的能力编队 | agents、skills、tools、Web-AIGC nodes、executors |
| `Takeover Point` | 让用户介入的决策点，包括澄清、路线确认、权限、预算、风险和交付审查 | HITL、MissionDecision、approval、`WAITING_INPUT`、`resume()` |
| `Replan` | 因为新约束、低置信度、风险、工具失败、质量差或用户覆盖而发生的路线变化 | workflow revision、retry/escalate、reroute records |
| `Confidence` | 系统对目标理解、路线可行性、执行完成度和结果质量的把握程度 | runtime projection、review signals、evidence completeness |
| `Risk` | 对歧义、缺失信息、工具失败、权限、成本、副作用和质量的结构化观察 | governance、audit、permission checks、runtime risk actions |

主链路可以简写成：

```text
Destination -> Route -> Fleet -> Drive State -> Result
```

`Takeover`、`Replan`、`Confidence`、`Risk` 和 `Evidence` 让这条链路不是黑盒。

## 自动驾驶等级

Task Autopilot 的 L1-L5 是执行承诺模型，不是营销口号。README.new 这里不把项目写成全局 L5。

| 等级 | 含义 | 当前位置 |
| --- | --- | --- |
| `L1` | 路线建议层，帮用户理解目标并推荐路线 | 可产品化的近端基线 |
| `L2` | 部分自动执行，低风险步骤可自动前进，关键决策需要接管 | 适合当前 mission-first + HITL 基础 |
| `L3` | 标准任务自动闭环，标准化任务在受控风险、审查和恢复约束下大部分可自动完成 | 面向精选任务族的近期设计目标 |
| `L4` | 限定任务域内的高自动化，需要白名单式策略约束 | 未来限定域方向，不是当前通用承诺 |
| `L5` | 开放域全自动 | 研究与长期概念，当前不宣称已实现 |

一个 mission 可以先按某个目标等级启动，遇到风险、缺失上下文、外部副作用或治理边界时再降级。

---

## 工作流程

```
输入想法（一句话）
  ↓
① 智能澄清 — 补全目标、约束、用户画像、成功标准
  ↓
② 路线规划 — 主路线 + 备选路线 + 风险评估 + 成本预估
  ↓
③ SPEC 树 — 拆解为模块化规格文档树
  ↓
④ 规格文档 — 流式生成 requirements / design / tasks（实时可见）
  ↓
⑤ 效果预览 — 系统架构图 + 提示词包 + 可执行的下一步
  ↓
导出 → Markdown / ZIP / 在线预览
```

全程实时可见：3D 场景展示 Agent 车队协作状态，右侧工作台展示流式生成过程与阶段进度指示器。

---

## 预演示例

每一个预演都是一篇可传播的内容。50 个预演 = 50 次传播机会。

| 输入 | 预演产出 |
|------|----------|
| "AI 漫剧平台" | 6 个 SPEC 模块 · 内容生产流水线设计 · 变现模型 · 系统架构 |
| "权限管理 SaaS" | 8 个 SPEC 模块 · RBAC 架构 · 多租户设计 · API 契约 |
| "舆情分析工具" | 5 个 SPEC 模块 · 数据采集管道 · 情感分析模型选型 · 告警规则引擎 |
| "独立开发者记账 App" | 4 个 SPEC 模块 · 本地优先架构 · 同步方案 · 隐私合规 |
| "企业知识库" | 7 个 SPEC 模块 · RAG 管道设计 · 权限模型 · 增量索引策略 |
| "跨境电商选品工具" | 6 个 SPEC 模块 · 数据源集成 · 评分算法 · 竞品分析 |

每份产出都是完整的、可导出的文档包 —— 可用于项目启动、团队对齐、博客内容或视频素材。

---

## 几分钟获得上下文，而不是几周

大多数产品工具从零开始。你花几天写 PRD，花几周对齐团队，花几个月才能看到方向是否正确。

WhyBuddy 跳过等待。输入你的想法，让 FSD 车队在 5 分钟内完成预演，在投入任何工程资源之前看到全貌。

**传统做法**：想法 → 2 周写 PRD → 1 周画架构 → 3 天对齐 → 发现方向不对 → 重来。

**WhyBuddy**：想法 → 5 分钟 → 完整预演 → 判断值不值得做 → 不值得就换下一个。

---

## 与其他平台对比

| 特性 | Dify | n8n | CrewAI | LangGraph | **WhyBuddy** |
|------|:---:|:---:|:---:|:---:|:---:|
| 开源 | ✅ | ✅ | ✅ | ✅ | ✅ MIT |
| 一句话到完整产品 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| SPEC 文档生成 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ 需求 + 设计 + 任务 |
| 路线规划与备选 | 🚫 | 🚫 | 🚫 | ⚠️ | ✅ |
| 多角色 Agent 车队 | 🚫 | 🚫 | ✅ | ✅ | ✅ FSD 7 角色 |
| 实时可观测性 | ⚠️ | ⚠️ | 🚫 | 🚫 | ✅ 3D + 流式 |
| 人工接管治理 | ⚠️ | ⚠️ | 🚫 | 🚫 | ✅ |
| 执行回放与审计 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| Docker 沙箱执行 | 🚫 | ⚠️ | 🚫 | 🚫 | ✅ |
| 50+ AIGC 节点族 | ✅ | ✅ | 🚫 | 🚫 | ✅ 58 份 specs |
| 导出 Markdown/ZIP | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| 纯浏览器演示模式 | 🚫 | 🚫 | 🚫 | 🚫 | ✅ GitHub Pages |

---

## 从源码贡献

新贡献者？快速路径：

1. 安装 Node.js 22+、pnpm，可选安装 Docker 以获得完整执行器模式。
2. Fork 并克隆仓库，然后 `pnpm install`。
3. 使用 `pnpm run dev:frontend` 进行纯 UI 开发（无需 `.env`），或 `pnpm run dev:all` 启动全栈。
4. 提交 PR 前：`node --run check`（TypeScript）+ `pnpm run test`（Vitest）。

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 发布前检查

对需要发 PR 的改动，至少跑：

```bash
pnpm run lint
node --run typecheck
pnpm run test
```

如果改动影响打包、部署或端到端运行，再加：

```bash
pnpm run build
pnpm run test:release
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite + TypeScript + Zustand + Three.js (R3F) + Framer Motion |
| 服务端 | Express + Socket.IO + TypeScript |
| AI | OpenAI 兼容接口（任意提供商） |
| 执行 | Docker (dockerode) + 浏览器运行时 + 原生运行时 |
| 测试 | Vitest + fast-check (PBT) |
| 存储 | IndexedDB（浏览器端）/ JSON（服务端） |

---

## 项目规模

统计口径：按当前 Git 已跟踪文件 + 待提交的非忽略文件统计，不包含 `node_modules`、`.git`、构建缓存和本地临时目录。

- **4,707 个项目文件**，覆盖源码、规格文档、设计素材、脚本和工作流配置
- **1,837 个 TypeScript / TSX 文件**，共 **486,932 行 TypeScript**
- **723 个测试文件**，静态统计 **7,771 个 `it` / `test` 用例调用**
- **273 份 `.kiro/specs` 规格目录**，包含 **879 个规格 Markdown 文件**
- **58 份 Web-AIGC specs**（52 个节点规格 + 6 个平台族规格）
- **88 份 Autopilot / Blueprint / Project-first specs**（`autopilot-*` 61 + `blueprint-*` 13 + `project-*` 10 + `task-autopilot-*` 4）
- **8,165 个规格任务检查项**（`tasks.md` 全量复选框：**7,093** 已勾选 / **1,072** 未勾选；顶层任务 **2,463 / 2,794**）
- **204 / 273 份规格目录** 的 `tasks.md` 已全量勾选；另有 1 个规格目录暂未提供 `tasks.md`

---

## 在 GitHub 上给我们 Star

引擎产出的每一份预演都是一篇帮助他人发现可能性的内容。Star 这个仓库，帮助更多人找到它。

[![Star History Chart](https://api.star-history.com/svg?repos=opencroc/whybuddy&type=Date)](https://star-history.com/#opencroc/whybuddy&Date)

---

## 协议

[MIT](./LICENSE)
