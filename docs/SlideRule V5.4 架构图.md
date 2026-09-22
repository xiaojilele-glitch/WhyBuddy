%% ⚠ 非权威 / 历史实验室笔记。禁止再打新 ⚑。
%% 权威图只留自动生成的：SlideRule V6.2 / WhyBuddy TS / WhyBuddy 全仓 / grok-build。
%% SlideRule V5.4 架构图（推演引擎规格 · 继承 V5.3 全图 + ★ 07-24 体验层升版）
%% ★ 2026-07-24 升版：V5.3 图（07-17）之后一周，结构门下游长出一整层「体验层
%%   生成 / Experience Enrichment」——此前图上从结构门直接跳到 app 主舞台，中间
%%   这层（主题+区块+设备壳）完全缺失。它跑在结构门通过之后、闭环装配之前，
%%   全程 fail-open（任一步失败静默降级，固定骨架/8 预设兜底，绝不拦闭环）：
%%   ★1 体验区块系统   — 476e480 目录骨架 · a0c5b43 WorkflowTimeline · 4abf5bd
%%                        FreeformInsight（experience_block_catalog 安全原语白名单
%%                        四方单一真相源 + block-registry 前端安全渲染器：只
%%                        React.createElement，绝不 dangerouslySetInnerHTML）
%%   ★2 身份主题生成   — 4361569 生图驱动身份主题 token（8 套预设降级为兜底）·
%%                        ad0abd3 图表配色接主题 · f08f2ea 白底侧栏禁用态可见性
%%   ★3 FreeformInsight 内容生成 — 4abf5bd Pydantic 深校验+reask 生产化 · 7fab05e
%%                        视觉参照 · cdf868a 图表候选枚举(Metabase X-Ray) · 3d297cd
%%                        自校验闭环(生成→截图→比参考图→改) · 981752a chart→真
%%                        ECharts · 03d20de dataRef 现算真值(数字不能编) · fd1dd66
%%                        放开图标白名单(任意 Ant Design 图标名·动态解析)
%%   ★4 首页也交 FreeformInsight — c86c238 monitor/首页交给 FreeformInsight 排版
%%                        (不再固定骨架) · 641c325 内容数量随领域浮动(松开上游模板)
%%   ★5 设备壳+视觉刻度 — 手机原生壳 · 92325c8 design-token 间距/圆角/阴影(接 antd
%%                        Design Token) · grid-compact 压实(搬自 react-grid-layout 核心)
%%                        · 7f0eb24 page.layout 5 槽位 · fd86913 designRecipe
%% ▲ 以下为 V5.3（07-17）原文，逐字保留：
%% ---------------------------------------------------------------------------
%% SlideRule V5.3 架构图（推演引擎规格 · 继承 V5.2 全图 + ■ 增量 + ▲ 07-17 升版）
%% 2026-07-16 结构审查：V5.2 图（07-09 落款"零结构变化"）之后两天出现四处
%%   真结构变化 + 三处中型增量，本图升版收录。每个 ■ 都有提交与评测可溯：
%%   ■1 TOOLS 工具层     — P2a/P2b（dd5fc99 web.search · 3eb8423 code.run/E2B）
%%   ■2 证据回流环 ECTX  — E17（064d033）·A/B 签字 docs/evidence-context-ab-2026-07-16.md
%%                         （piped 2胜0负8平，默认开维持）
%%   ■3 轮内并行+屏障    — E17b（同上）·synthesis/report/appbundle 为屏障段
%%   ■4 pick 双通道 APICK — F2（044e440）·终裁 docs/content-quality-eval-2026-07-15.md
%%                         （已被 ▲1 取代：E32 转正默认开）
%%   ■5 结构化生成通道   — P3（8b0e5c6）·校验错误回喂 reask（借 Instructor 语义）
%%   ■6 直播时间线投影   — E13（b9f4500）·turnNarrations 展示投影+同轮守卫豁免
%%   ■7 IM 输出编排      — E16/E16.1（82bca0c/492c161/1fe5a56）·多流分窗+平滑泵
%% ▲ 2026-07-17 升版（E25–E37 两日增量，每条有提交/实测可溯）：
%%   ▲1 APICK 转正默认开 — E32（99acb79）·十话题+内容质量 4:0 胜出后默认 on，
%%                          60s 硬顶 fail-open（off/0/false/no 显式回规则版）
%%   ▲2 run 化断线重生   — E25·推演跑在服务端后台 run·事件日志按序号续播
%%                          （Last-Event-ID 语义）·孤儿 run 看门狗回收
%%   ▲3 缺口修复轮       — E26·mode=repair 只重跑覆盖门标红能力·非 blocked 闭环复用
%%   ▲4 五系统闭环装配层 — 新增 CLOSURE 子图（此前图上整条缺失，是 app 主舞台的数据源）：
%%                          起草(E29 精修/直供) → 确定性修复(不变式+E37 展示层) → 结构门
%%                          → E37 门裁决回喂 → 闭环证据 → app 主舞台；E35 演示域冻结夹具旁路；
%%                          E37 闭环兜底（重建异常也落 blocked 闭环，publishClosure 永不为 null）
%%   ▲5 附件提取管线     — E31·图片→视觉 LLM·PDF→E2B 沙盒提取·失败诚实只带文件名
%%   ▲6 版本史前进/回退  — E29·模型真实变化自动存档 modelVersions·回退=模型直供重闸
%% 符号: ▲ = 07-17 升版 ; ■ = V5.3 新增/修订 ; ◆ = V5.2 外环 ; ● = Ux 修订 ; 虚线 = 跨层或待补
%% 原 V5.2 图保留于 docs/SlideRule V5.2 架构图.md（本文件为其超集）

flowchart TB

subgraph V52_OUTER["V5.2 外环 ◆ (Drive + U* 表面/执行/信任) · 薄层复用内脊柱"]
  direction TB

subgraph DRIVE["00.5 驱动层 / Drive Modes（◆ 外环 · 内层零改动）"]
  direction TB
  MODE{"◆ 模式选择器 / Mode<br/>深思一轮(默认·绕过外环) · 持续推演"}:::gate
  MARATHON["◆ 马拉松编排 / MarathonDriver<br/>drive一轮 → 按stopReason分流<br/>收敛→续 · await_ready→挂起 · 终态→停"]:::core
  FRONTIER["◆ 前沿生成 / frontier.propose<br/>去重机械裁决 · 连续2空=耗尽<br/>提议+rationale进决策账"]:::core
  APOLICY["◆ 自动驾驶策略 / AutopilotPolicy<br/>显式可审计产物 · confirm代答留痕<br/>G_READY真缺口必停·零变通"]:::ledger
  SBUDGET{"◆ 会话级预算 / Session Budget<br/>开启即强制设定 · 轮间对账 · 到顶机械停<br/>与轮内BUDGET两层闸"}:::gate
  DIGEST["◆ 轮次纪要 / round.digest<br/>过G_QUALITY · 下轮种子=纪要+前沿产物<br/>明细→SUPERSEDED(≠stale)"]:::cap
end
 
subgraph SURF["00 交互面 / Surface（◆ U4 用户语言化：出问题才说话）"]
  direction TB
  CHAT["聊天框 = 操纵杆<br/>灌 goal · 提质疑 · 指定关注点<br/>◆ 运行中发送键=停止键"]:::surface
  STATUS["状态条（唯一常驻）<br/>◆ 只说人话：推演中·第N步 / 已想清楚✓<br/>还差N个关键信息 / 已停止·随时继续"]:::surface
  AUDIT["◆ 审计抽屉 / Audit Drawer<br/>gate原文·台账·封条计数·baseline·分账 (M7: policy + ledger + superseded + baseline + cost)<br/>机制信息只搬家不删除"]:::surface
  BOARD["内联临时黑板<br/>讨论 · 图 · 报告段 · 方案 · 预览<br/>● 按轮分组折叠(马拉松, via routeExpanded + superseded)"]:::surface
  IMORCH["■ IM 输出编排 / E16<br/>并行流按label分窗·平滑泵(积压/8匀速)<br/>ChainOfThought时间线·streamdown正文·收口句带真时长"]:::surface
  ATTACH["▲ 附件提取管线 / E31<br/>文本类直读注入 · 图片→视觉LLM识别<br/>PDF→E2B沙盒pypdf(超长LLM蒸馏)<br/>失败诚实：只随消息带文件名"]:::surface
end
 
subgraph CORE["01 控制平面 / Control Plane（V5.1 脊柱 · 零改动）"]
  direction TB
  INTAKE["入站消息 / Message Intake（单门）<br/>load SessionState · derive 先行<br/>STATE 稳定前缀 prompt cache<br/>分类为控制信号（续跑·不重启会话）"]:::core
  BUDGET{"预算闸 / Budget Gate（轮内）<br/>maxTurns · maxRuns/turn · maxTokens · maxRepeat<br/>预算=auditable artifact"}:::gate
  ORCH["推演调度核 / Orchestrator<br/>pickNextCapabilities(goal, state, gaps, votes)<br/>路由便宜模型/规则优先 · 歧义才升级"]:::core
  DLEDGER["调度决策账 / Decision Ledger<br/>saw · chose · skipped+reason · rationale<br/>◆ + 前沿提议(马拉松)"]:::ledger
  CONTRACT["覆盖率合约 / CoverageContract<br/>authored · 版本化 · 冻结基线"]:::ledger
  GCOV{"覆盖率闸 / Coverage Gate<br/>blocking gap 全 resolved/waived<br/>合约能力全有成功 run · 二元机械"}:::gate
  STATE[("常驻推演状态 / Reasoning State（唯一 authority）<br/>graph · artifacts · evidence · risks · decisions<br/>capabilityRuns · gates · dependencyGraph<br/>● + qualityBaseline声明 · ◆ + supersededIds")]:::state
  GOAL["目标 / 结论状态（ORCH 只读 · 写入仅经覆盖率闸）<br/>clear · needs_refinement · not_recommended"]:::core
  AWAIT["待续 / Awaiting（环上歇脚点）<br/>收敛 · 等人 · 超轮内预算<br/>◆ + 用户停止 · 等人补缺(马拉松) · 会话预算顶 · 前沿耗尽"]:::await
  ECTX["■ 证据上下文管道 / evidence_context<br/>信任门准入(只喂过门的)·优先级装箱(priompt语义)<br/>预算截止·省略留痕 · A/B 签字 2胜0负8平"]:::ledger
  PARBATCH["■ 轮内并行批 / batch parallel<br/>独立能力并行执行·屏障分段<br/>synthesis/report/appbundle=屏障(等前段commit)"]:::core
  APICK["▲ agentic pick / LLM提案+门验收<br/>词表封闭·重复守卫·台账source=llm<br/>E32 转正默认开(评测4:0)·60s硬顶fail-open<br/>停机权仍归规则·修复轮不参与"]:::core
end
 
subgraph ROLES["02 角色与协作 / Roles（V5.1 原样）"]
  direction TB
  RL["多角色 / Roles<br/>产品·架构·安全·合规·工程·挑刺·接地·综合·UI"]:::role
  D_GATE{"决策门 / Decision Gate<br/>简单 or 复杂?"}:::gate
  D_SA["单 Agent / Single-Agent"]:::role
  D_BO["头脑风暴 / Brainstorm<br/>讨论·投票·分工·审计"]:::role
  D_SYN["综合器 / Synthesizer<br/>方案·信心分·分歧意见"]:::role
  FLOWB{"流边界守卫 / Flow Boundary<br/>剥离 critique · rebuttal · debate console"}:::gate
  D_DEG["降级兜底 / Degradation → 单 Agent"]:::fallback
  PAIR["调度单元 = (capability, role) 对"]:::role
end
 
subgraph POOL["03 能力池 / Capability Pool（平权 · V5.1 原样 · 执行落 08 层）"]
  direction TB
  BUS{{"能力调度总线 / Dispatch Bus<br/>调用 ⇄ 回灌"}}:::bus
  C_PARSE["意图理解 / intent.parse"]:::cap
  C_EVID["证据检索 / evidence.search"]:::cap
  C_REPO["仓库深度解析 / repo.inspect"]:::cap
  C_REPO_FALL["仓库降级 / Fallback"]:::fallback
  C_GAP["澄清·缺失 / gap.ask"]:::cap
  C_QEXP["扩展·假设 / question.expand"]:::cap
  G_READY{"就绪度闸 / Readiness<br/>需人答=停泊点"}:::gate
  C_RTGEN["路线生成 / route.generate"]:::cap
  C_RTCMP["路线对比 / route.compare"]:::cap
  G_CONFIRM{"轻量确认闸 / Confirm<br/>需人答=停泊点 · ◆ 马拉松下由APOLICY代答留痕"}:::gate
  C_PROMPT["提示词构造 / prompt.build<br/>● 经08层PROMPTS双端同源"]:::cap
  C_REDACT["脱敏 / redaction"]:::cap
  C_LLM["LLM JSON 生成 / callJson<br/>● 实际执行经08层EXECABS"]:::cap
  G_SCHEMA{"Schema 校验闸"}:::gate
  C_SNORM["归一化 / 稳定 ID 重映射"]:::cap
  G_INV{"不变量守卫闸"}:::gate
  C_SFALL["确定性兜底"]:::fallback
  C_TREE["结构拆解 / structure.decompose<br/>● + 旧管线推导回填(K5)"]:::cap
  C_DOC["文档生成 / document.draft"]:::cap
  C_ACC["验收 / acceptance"]:::cap
  C_PREV["效果预演 / scenario.preview"]:::cap
  C_VISGEN["视觉生成"]:::cap
  C_VISREND["视觉渲染 / Mermaid 确定性"]:::cap
  C_TOOL["工具 / mcp.call · skill.invoke"]:::cap
  C_RISK["反驳与风险 / risk.analyze · counter.argue"]:::cap
  C_SYN["综合收敛 / synthesis.merge"]:::cap
  C_REP["报告生成 / report.write"]:::cap
  C_PACK["指令包 / prompt.pack"]:::cap
  C_MATRIX["可追溯矩阵 / traceability"]:::cap
  C_HAND["交付包 / handoff"]:::cap
end
 
subgraph TRUST["04 信任层 / Trust Layer（● U1 修订：commit-time 验真+验厚 · ship-time 验收）"]
  direction TB
  T_GATE{"提交闸 / Commit Gate（commit-time）<br/>schema·invariant·confirm·precondition·ground·commit<br/>● + quality（验厚） · 二元·机械"}:::gate
  QCONTRACT["● 输出契约 / OutputContract<br/>headings·childBlocks·EARS中英·embedded·minChars<br/>单一真相：喂prompt + 喂质量闸"]:::ledger
  BASELINE["● 质量基线 / QualityBaseline<br/>production / pilot-template<br/>结果级声明·禁嗅探·封条注明"]:::ledger
  T_PROV["provenance（commit-time）<br/>● + browser-llm:label:model"]:::trust
  T_AUDIT["出图审计 / check_previews_real"]:::trust
  T_TEST["测试 / Tests（ship-time·验收）"]:::trust
  T_MERGE{"合并门 / Merge Gate（ship-time）"}:::gate
  T_LEDGER["校验台账 / Checks Ledger（问责中枢）<br/>脚本·决策·边界·成本<br/>● + quality verdict+baseline<br/>◆ + 中断行 · policy代答 · 前沿提议 · key分账"]:::ledger
end
 
subgraph EXEC["08 执行层 / Executor Topology（● U2 新增子图）"]
  direction TB
  EXECABS["● 执行器抽象 / CapabilityExecutor<br/>Default模板 · PilotReal · Server-LLM · browser-llm<br/>结果自声明 qualityBaseline"]:::core
  PROMPTS["● 双端同源 prompt / capability-prompts<br/>anchor+CTX供给+契约注入+report 9段BASE<br/>server与browser消费同一函数"]:::ledger
  CTX["● 分级上下文供给 / capability-context<br/>收敛全文6000/24000 · 分析800 · 轻220<br/>截断显式标注"]:::ledger
  KEYPOOL["● key池调度 / ByokDispatcher<br/>租约·least-busy·429冷却·401禁用<br/>raceMode默认false(成本诚实)<br/>◆ 待补:FIFO排队 · per-key计费"]:::core
  DEPLOY{"部署形态 / Deployment<br/>Pages纯浏览器BYOK / 自托管server"}:::gate
  KEYISO["● key零信任边界<br/>仅localStorage+闭包 · 不进STATE/台账/导出<br/>序列化隔离测试锁定"]:::trust
  SREASK["■ 结构化生成通道 / structured_llm_json<br/>校验错误回喂 reask(借Instructor语义)<br/>强制流式免CF-524 · SLIDERULE_STRUCTURED_LLM"]:::core
end
 

subgraph TOOLS["08.5 工具层 / MCP Tool Registry（■ V5.3 新增 · 信任纪律随身）"]
  direction TB
  MCPREG["■ 工具注册表 / mcp_tools<br/>MCP 对齐描述符 name·inputSchema·readOnly<br/>纪律：执行类必须声明沙盒(测试锁定)"]:::core
  WSEARCH["■ 真证据源 / web.search（只读）<br/>供应商链 Tavily→Serper→Wikipedia免key<br/>查询蒸馏·失败回落本地RAG(retrieval如实标注)"]:::cap
  CODERUN["■ 沙盒执行 / code.run（readOnly=false）<br/>E2B 一次性沙盒·宿主零执行·用完即毁<br/>fail-closed：无 key 工具不可用"]:::cap
end
 
subgraph CLOSURE["09 五系统闭环装配层 / Five-System Closure（▲ 07-17 新增子图 · app 主舞台的数据源）"]
  direction TB
  GEN5["▲ 五系统起草 / v5_llm_generate<br/>schema契约+已装技能硬注入+业界参考软引用<br/>E29 精修上下文(增量改)·模型直供(回退)两通道"]:::cap
  DREPAIR["▲ 确定性修复 / v5_model_repair（零LLM·留痕）<br/>不变式refs近邻改写(唯一命中)·修不好整条剔除<br/>E37 展示层charts/stats同款处方(枚举违规剔除·非法format清除)<br/>骨架六系统不修——仍由门硬拦"]:::core
  MGATE{"▲ 结构门 / v5_model_gate<br/>跨系统引用全解析·枚举合法域·页面范式绑定<br/>二元机械·任何悬空=拦"}:::gate
  REASK5["▲ 门裁决回喂 / gate-feedback retry (E37)<br/>findings原文喂回·有界重生成一次<br/>错哪改哪·两版都拦仍fail-closed"]:::fallback
  DOMFIX["▲ 内置演示域夹具 / builtin_domain_models (E35)<br/>采购·请假·工单·入职四域冻结过门模型<br/>运行时零LLM·门规则演进时测试哨兵报警"]:::state
  CLOSEV["▲ 闭环证据 / appbundle.runtimeClosure<br/>六段 perSkillEvidence·closureHash/stableDigest指纹<br/>modelSection纯载荷(不进指纹/信任判定)"]:::ledger
  FAILSAFE["▲ 闭环兜底 / fail-closed failsafe (E37)<br/>重建异常→确定性blocked闭环(CLOSURE_REBUILD_FAILED带因)<br/>空指令回落goal收口·publishClosure永不为null"]:::fallback
  APPSTAGE["▲ app 主舞台 / App Stage<br/>closed 6/6 → 右栏长出可操作应用<br/>切角色·录数据·走流程·桌面/手机/代码三视图"]:::done
end

subgraph ENRICH["10 体验层生成 / Experience Enrichment（★ 07-24 新增子图 · 过门后·装配前·全程 fail-open）"]
  direction TB
  THEME["★ 身份主题生成 / enrich_identity_theme<br/>生图参照→视觉LLM取色·写回 appIdentity.generatedTheme<br/>8套预设降级为兜底·侧栏/顶栏/图表/区块全链路配色统一"]:::cap
  FREEFORM["★ FreeformInsight 内容生成 / enrich_freeform_blocks<br/>Pydantic深校验+reask·图表候选机械枚举(Metabase X-Ray)<br/>视觉参照自校验闭环(生成→截图→比参考图→按需改一版)<br/>chart节点→真ECharts·dataRef现算真值(数字不能编·查不到显—)"]:::cap
  MONITOROV["★ 首页设计 / enrich_monitor_page_overviews<br/>monitor/首页交给FreeformInsight排版·不再永远固定骨架<br/>内容数量随领域浮动·排行/动态流仍走真实逐行渲染(dataRef表达不了)"]:::cap
  BLOCKCAT["★ 体验区块目录 / experience_block_catalog<br/>安全原语白名单:标签·样式属性·图标(任意antd名·形状校验)·槽位·bindingSchema<br/>四方单一真相源(Gate深校验/prompt/Python Pydantic/前端渲染同源派生)"]:::ledger
  SAFEREND["★ 前端安全渲染器 / block-registry（纵深防御第二道）<br/>只React.createElement·绝不dangerouslySetInnerHTML/eval<br/>图标按名动态解析任意antd(hasOwnProperty挡原型链)·dataRef现算·白名单再校验"]:::trust
  DEVSHELL["★ 设备壳+视觉刻度 / device shell & design tokens<br/>桌面/平板/手机原生壳(preferredDevice)·design-token间距圆角阴影(接antd)<br/>grid-compact压实(搬自react-grid-layout核心算法·MIT)·layout 5槽位·designRecipe"]:::core
end

subgraph REENTRY["05 失效与重入 / Invalidation & Re-entry（单一回炉 · ◆ +superseded）"]
  direction TB
  INTERV["控制信号 / UserIntervention<br/>challenge·revise·clarify·expand…<br/>target: Artifact/Node/Section/Decision"]:::reentry
  RV{"评审 / Review<br/>● RV pass 绑定 reportId"}:::gate
  ESC["失败·中止·转人工 / Escalate"]:::fallback
  ITER["用户修改再推演 / Iterate"]:::reentry
  DEP["依赖图 / Dependency Graph"]:::reentry
  INVAL["失效引擎 / Invalidation"]:::reentry
  STALE["失效索引 / Stale Index<br/>信任失效·级联重算"]:::reentry
  SUPERSEDED["◆ 替代索引 / Superseded Index<br/>被纪要替代·信任不变·不级联<br/>语义独立于stale"]:::reentry
  RECOMP["重算 + 重新调度 / Recompute"]:::reentry
end
 
subgraph RUNTIME["06 运行时 / Runtime（P3 红利 · ● 投影层成果）"]
  direction TB
  JOB["任务仓·产物 / Job·Artifact Store"]:::runtime
  EVT["事件总线 / Event Bus"]:::runtime
  SOCK["实时推送 / Socket Relay"]:::runtime
  STORE["实时状态仓 / Realtime Store"]:::runtime
  DERIVE["状态派生 / 投影计算器<br/>只读 STATE/JOB · 永不回写"]:::runtime
  DENSITY["● 详略密度 / 简洁·完整溯源<br/>阶段子节点可溯源·证据子节点"]:::runtime
  TERMINAL["● 终端交付投影 / Terminal+TrustSeal<br/>虚拟节点·不入STATE.graph"]:::runtime
  ROW["节点行 / Node Row"]:::runtime
  REPLAY["回放 / Replay"]:::runtime
  NARR["■ 直播时间线投影 / turnNarrations<br/>轮末随PUT持久化·3轮×300步封顶<br/>展示投影：同轮守卫豁免清单成员"]:::runtime
  RUNREG["▲ 后台 run 注册表 / run_registry (E25)<br/>推演与连接解耦·无人观看也跑完落库<br/>事件日志按 seq 续播(Last-Event-ID)<br/>同会话活跃 run 附着防重复·孤儿看门狗回收"]:::runtime
end
 
subgraph OUT["07 输出 / Output"]
  direction TB
  REPORT["可行性 / 推演报告（主输出物）<br/>9段·证据可点·● 厚度有契约下限"]:::report
  READER["● 报告阅读器 / ReportReader<br/>分段·证据回跳·md导出(STATE零写)"]:::report
  DONE["交付完成 / Shipped"]:::done
end
 
%% ===== ◆ 驱动外环（仅持续推演模式生效）=====
%% 薄外环复用说明 (应用审查 Issue 4): MARATHON/FRONTIER/DIGEST 是薄编排 (reuses driveReasoningSession + append-only to ledgers/STATE/supersededArtifactIds)
%% CORE/INTAKE/ORCH/BUDGET/GCOV 等内层 V5.1 脊柱零改动；外环仅通过 stopReason 分流 + 追加 ledger/STATE 字段
%% 见 marathon-driver + useSlideRuleSession 条件调用 + post-drive digest/propose
CHAT -.选模式.-> MODE
MODE -.深思一轮·直通.-> INTAKE
MODE -.持续推演.-> MARATHON
MARATHON -.驱动一轮.-> INTAKE
AWAIT -.收敛·一轮完成.-> MARATHON
MARATHON -.蒸馏.-> DIGEST
DIGEST -.明细标替代.-> SUPERSEDED
DIGEST -.纪要=下轮种子.-> FRONTIER
FRONTIER -.新前沿·合成种子(auto-seeded标注).-> MARATHON
FRONTIER -.提议落账.-> DLEDGER
MARATHON -.轮间对账.-> SBUDGET
SBUDGET -.到顶·机械停.-> AWAIT
APOLICY -.confirm代答·留痕.-> G_CONFIRM
APOLICY -.代答记录.-> T_LEDGER
G_READY -.真缺口·马拉松挂起等人.-> AWAIT
 
%% ===== 入站：单门再入（V5.1 原样）=====
CHAT -.新消息 / ◆停止信号.-> INTAKE
BOARD -.针对节点/段落.-> INTAKE
STATE -.先 load + derive.-> INTAKE
INTAKE --> INTERV
INTERV -.若 challenge/revise.-> DEP
ORCH -.刷新.-> STATUS
ORCH -.只读.-> GOAL
STATE -.渲染.-> BOARD
ROW -.驱动黑板.-> BOARD
STATUS -.较真入口.-> AUDIT
T_LEDGER -.机制原文·只搬不删.-> AUDIT
 
%% ===== 预算闸 + 覆盖率闸（V5.1 原样）=====
INTERV -->|续跑·先过预算| BUDGET
BUDGET -->|放行| ORCH
BUDGET -.超限·停泊 partial.-> AWAIT
BUDGET -.转人工.-> ESC
BUDGET -.成本遥测.-> T_LEDGER
ORCH -.落账.-> DLEDGER
DLEDGER -.汇入.-> T_LEDGER
CONTRACT -.判据.-> GCOV
ORCH -->|想写结论/停泊| GCOV
GCOV -->|达标·准许写入| GOAL
GCOV -->|达标·准许停泊| AWAIT
GCOV -.缺能力·强制排程.-> BUDGET
CONTRACT -.够了就停.-> BUDGET
STATE --- AWAIT
AWAIT -.新消息续.-> INTAKE
 
%% ===== 控制平面 ⇄ 能力池（V5.1 原样，节选）=====
ORCH <-->|调用/回灌| BUS
BUS --- C_PARSE
BUS --- C_EVID
BUS --- C_GAP
BUS --- C_RTGEN
BUS --- C_PROMPT
BUS --- C_DOC
BUS --- C_RISK
BUS --- C_SYN
BUS --- C_REP
BUS --- C_PACK
 
%% ===== 角色 + 流边界（V5.1 原样）=====
RL --> D_GATE
D_GATE -.简单.-> D_SA
D_GATE -.复杂.-> D_BO
D_BO --> D_SYN
D_GATE -.失败超时.-> D_DEG
D_DEG -.兜底.-> D_SA
ORCH -.选 capability×role.-> PAIR
D_SA -.视角.-> PAIR
D_SYN --> FLOWB
FLOWB -.净化后视角.-> PAIR
FLOWB -.断言进台账.-> T_LEDGER
D_BO -.回灌·经守卫.-> FLOWB
PAIR -.接入.-> BUS
 
%% ===== 池内链（V5.1 原样，节选）=====
C_EVID --- C_REPO
C_REPO -.降级.-> C_REPO_FALL
C_GAP --> C_QEXP
C_QEXP --> G_READY
G_READY -.未就绪·回补.-> C_GAP
G_READY -.等用户·停泊.-> AWAIT
C_RTGEN --> C_RTCMP
C_RTCMP --> G_CONFIRM
G_CONFIRM -.退回调整.-> C_RTCMP
G_CONFIRM -.等用户确认·停泊.-> AWAIT
C_PROMPT --> C_REDACT
C_REDACT --> C_LLM
C_LLM --> G_SCHEMA
G_SCHEMA -.过.-> C_SNORM
G_SCHEMA -.败.-> C_SFALL
C_SNORM --> G_INV
G_INV -.过.-> C_TREE
G_INV -.败.-> C_SFALL
C_SFALL --> C_TREE
C_TREE --> C_DOC
C_DOC --> C_ACC
C_TREE -.确定性渲染.-> C_VISREND
C_DOC -.生图提示词.-> C_VISGEN
C_ACC --> C_PACK
C_TREE -.汇总.-> C_MATRIX
 
%% ===== ● U2 执行层接线 =====
C_LLM -.执行委托.-> EXECABS
PROMPTS -.同一prompt.-> EXECABS
CTX -.分级供给.-> PROMPTS
QCONTRACT -.契约注入.-> PROMPTS
EXECABS -.browser端取租约.-> KEYPOOL
DEPLOY -.Pages.-> KEYPOOL
DEPLOY -.自托管.-> EXECABS
KEYPOOL -.◆ 分账 (aggregate costLedger + 待补 per-key).-> T_LEDGER
KEYISO -.边界锁.-> KEYPOOL
EXECABS -.结果+baseline声明.-> BUS
%% 失败回退 (应用审查 Issue 3): browser-llm / KEYPOOL 异常 (CORS/429/401/timeout) → 触发内层降级到 PilotReal / Default (代码已实现 try/catch + onStep fail)
KEYPOOL -.失败回退 (browser-llm 异常 → PilotReal).-> EXECABS
 
%% ===== ● U1 信任层接线（修订）=====
BUS ==>|产物送审| T_GATE
QCONTRACT -.验厚判据.-> T_GATE
BASELINE -.显式基线.-> T_GATE
T_GATE ==>|过| T_PROV
T_PROV ==> T_LEDGER
T_GATE -.未过·打回(quality同路).-> BUS
C_VISGEN -.出图必审.-> T_AUDIT
T_AUDIT -.进台账.-> T_LEDGER
T_AUDIT -.假图打回.-> C_VISGEN
C_HAND --> T_TEST
T_TEST --> T_MERGE
T_MERGE -->|过| DONE
T_MERGE -.不过·回炉.-> INTERV
 
%% ===== 失效重入（V5.1 原样 + superseded）=====
RV -.回炉·归一控制信号.-> INTERV
ITER --> INTERV
DEP --> INVAL
INVAL --> STALE
STALE --> RECOMP
RECOMP -.重排程·经预算.-> BUDGET
DIGEST -.写入.-> SUPERSEDED
 
%% ===== 运行时投影（P3 红利）=====
STATE --> JOB
JOB --> EVT
EVT --> SOCK
SOCK --> STORE
STATE -.只读.-> DERIVE
DERIVE --> ROW
DERIVE --> DENSITY
DERIVE --> TERMINAL
DENSITY -.投影.-> BOARD
TERMINAL -.投影.-> BOARD
STORE --> REPLAY
 

%% ===== ■ V5.3 接线 =====
%% 工具层：证据能力真搜索优先，失败诚实回落；产物 provenance 全走信任层
MCPREG --- WSEARCH
MCPREG --- CODERUN
C_EVID -.■ 真搜索优先.-> WSEARCH
WSEARCH -.■ 全链失败/停用·回落本地RAG(标注keyword).-> C_EVID
WSEARCH -.■ retrieval=web:* 标注.-> T_PROV
CODERUN -.■ provenance=sandbox:e2b.-> T_PROV
C_TOOL -.■ 经注册表调用.-> MCPREG
%% 证据回流环（架构级新边）：STATE 产物受控回流进能力 prompt
STATE -.■ 已过门产物(gated_pass/audited·非stale).-> ECTX
ECTX -.■ UPSTREAM_EVIDENCE 注入.-> PROMPTS
%% 轮内并行 + 屏障
ORCH -.■ 选中批.-> PARBATCH
PARBATCH <-.■ 并行执行·屏障段串行.-> BUS
%% pick 双通道（实验位）
ORCH -.■ SLIDERULE_AGENTIC_PICK=on.-> APICK
APICK -.■ 提案·词表验收后替换.-> DLEDGER
%% 结构化生成通道
C_LLM -.■ 生成失败·错误回喂.-> SREASK
SREASK -.■ 修复后回.-> G_SCHEMA
%% 直播时间线投影 + IM 编排
STATE --> NARR
NARR -.■ 刷新完整回放.-> BOARD
SOCK -.■ llm_delta 按label分流.-> IMORCH
IMORCH -.■ 渲染.-> BOARD

%% ===== ▲ 07-17 升版接线 =====
%% run 化断线重生（E25）：驱动跑在后台 run，连接只是订阅者
INTAKE -.▲ 驱动进后台run.-> RUNREG
RUNREG -.▲ 断连续播·seq起点.-> SOCK
%% 缺口修复轮（E26）：修什么以覆盖门说了算，agentic pick 不参与
AWAIT -.▲ 补齐缺口按钮·mode=repair.-> INTAKE
GCOV -.▲ 标红能力=修复轮选材.-> ORCH
%% 附件提取（E31）：上传即解析，发送时注入推演指令
CHAT -.▲ 上传附件.-> ATTACH
ATTACH -.▲ PDF走一次性沙盒.-> CODERUN
ATTACH -.▲ 提取文本注入指令.-> INTAKE
%% 五系统闭环装配（循环收敛后由驱动器必跑闭环重建）
AWAIT -.▲ 循环落定·闭环重建必跑.-> GEN5
ECTX -.▲ 同一上下文纪律.-> GEN5
GEN5 --> DREPAIR
DREPAIR --> MGATE
MGATE -.▲ 拦截·裁决喂回.-> REASK5
REASK5 -.▲ 重生成.-> GEN5
MGATE ==>|▲ 过门| CLOSEV
DOMFIX -.▲ 确定性域旁路(零LLM).-> CLOSEV
GEN5 -.▲ 形状层回喂(缺段).-> SREASK
CLOSEV -.▲ 证据+指纹入账.-> T_LEDGER
CLOSEV ==>|▲ closed 6/6| APPSTAGE
CLOSEV -.▲ blocked·人话blocker+补齐缺口.-> AWAIT
FAILSAFE -.▲ 重建异常兜底.-> CLOSEV
%% 版本史（E29）：模型变化自动存档，回退=直供重闸
CLOSEV -.▲ 模型变化存档modelVersions.-> STATE
STATE -.▲ ◀▶回退·模型直供.-> GEN5

%% ===== ★ 07-24 体验层升版接线 =====
%% 过门后·装配前：结构门通过的模型先过三段增强（主题→区块→首页），再进闭环装配。
%% 全程 fail-open：每段各自 try/except，任一步失败静默降级（固定骨架/8 预设兜底），绝不拦闭环。
MGATE -.★ 过门后·先增强再装配.-> THEME
THEME ==>|★ 主题先行·区块读generatedTheme| FREEFORM
FREEFORM ==>|★ 再逐块逐页设计| MONITOROV
MONITOROV -.★ 增强完的模型入闭环装配.-> CLOSEV
THEME -.★ 任一步失败·静默降级(固定骨架/8预设·不拦闭环).-> CLOSEV
%% 体验区块目录=四方单一真相源：既约束生成，又驱动渲染（改一处四方同步）
BLOCKCAT -.★ 安全原语约束生成.-> FREEFORM
BLOCKCAT -.★ 同源白名单驱动渲染.-> SAFEREND
%% 增强用到的下游能力：生图参照（视觉生成）+ 候选真渲染截图自校验（E2B 一次性沙盒）
THEME -.★ 生图参照.-> C_VISGEN
FREEFORM -.★ 生图参照.-> C_VISGEN
FREEFORM -.★ 候选真渲染截图·比参考图.-> CODERUN
%% app 主舞台消费增强产物：安全渲染器把区块/首页/主题装进设备壳后接管右栏
SAFEREND -.★ 运行时安全渲染区块/首页.-> APPSTAGE
DEVSHELL -.★ 设备壳套壳+刻度对齐.-> APPSTAGE
 
%% ===== 输出 =====
C_REP ==> REPORT
REPORT --> READER
READER -.证据回跳.-> BOARD
C_HAND ==> DONE

end
%% 结束 V52_OUTER (V5.2 外环容器：DRIVE + SURF + EXEC/TRUST U* 部分)

%% ===== 改进后的图例 (应用审查 Issue 1 + 6) =====
%% V5.2 外环 (◆) 容器包裹了 DRIVE/Marathon + SURF(U4) + EXEC(U2 browser-llm/KEYPOOL) + TRUST(U1 quality) 部分
%% 内层 CORE/POOL/REENTRY/RUNTIME/OUT 为 V5.1 脊柱 (零改动)
%% 符号: ★ = 07-24 体验层升版 ; ▲ = 07-17 升版 ; ■ = V5.3 新增/修订 ; ◆ = V5.2 新增/外环 ; ● = Ux 修订 ; 虚线 = 跨层或待补
%% ★ 升版后的产品主轴：SURF 一句话/附件 → CORE 推演循环(APICK 默认开·ECTX 装箱)
%%   → CLOSURE 五系统起草→确定性修复→结构门→回喂
%%   → ENRICH 体验层生成(过门后·装配前·fail-open：身份主题→FreeformInsight区块→首页设计)
%%   → CLOSURE 闭环装配(证据 6/6) → APPSTAGE 应用接管右栏(安全渲染器×设备壳)
%%   两条纪律并存：闭环装配 fail-closed(任一环失败→blocked 闭环+人话 blocker，publishClosure 永不为 null)；
%%   体验层增强 fail-open(任一步失败→固定骨架/8 预设兜底，绝不拦闭环发布)
%% 建议: Mermaid 渲染时使用 "View as code" 或折叠外容器以减少交叉边 spaghetti；或拆分为 "核心脊柱" + "V5.2 delta" 两个图

classDef surface fill:#dbeafe,stroke:#3b82f6,color:#1e3a5f
classDef core fill:#e0e7ff,stroke:#6366f1,color:#312e81
classDef cap fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95
classDef gate fill:#fef3c7,stroke:#f59e0b,color:#78350f
classDef trust fill:#cffafe,stroke:#06b6d4,color:#164e63
classDef ledger fill:#ccfbf1,stroke:#14b8a6,color:#134e4a
classDef reentry fill:#fee2e2,stroke:#ef4444,color:#7f1d1d
classDef fallback fill:#ffedd5,stroke:#f97316,color:#7c2d12
classDef report fill:#dcfce7,stroke:#22c55e,color:#14532d
classDef done fill:#bbf7d0,stroke:#16a34a,color:#14532d
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a
classDef role fill:#fae8ff,stroke:#d946ef,color:#701a75
classDef bus fill:#fef9c3,stroke:#eab308,color:#713f12
classDef await fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e,stroke-dasharray: 5 5
classDef runtime fill:#f5f5f4,stroke:#78716c,color:#292524