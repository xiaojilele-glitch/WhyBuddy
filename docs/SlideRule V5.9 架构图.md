%% ⚠ 非权威 / 历史实验室笔记。禁止再打新 ⚑。
%% 权威图只留自动生成的：SlideRule V6.2 / WhyBuddy TS / WhyBuddy 全仓 / grok-build。
%% 面团 AI（原 SlideRule）V5.9 架构图（推演引擎规格 · 继承 V5.8 全图 + ❖ 08-11 升版 + ⛔ 08-13 标红）
%% ⛔ 2026-08-13 标红：**没有新功能，只标红四处**。这一轮不是升版，是把「链路本身
%%   的形状问题」画到图上——它们不是 bug，每一处单独看都有合理的实现理由，合起来
%%   才是这套系统当前最贵的那个约束。用户原话：「之前使用 5 模型喂的那一个，
%%   他妈是垃圾，那根本就不行啊」。下面四条是查代码查出来的根据，不是感觉。
%% ·
%%   【⛔1 GEN5：系统真正的输入就是那一句话】
%%     `generate_five_system_model(goal: str, *, llm_json_fn, gate_feedback)`
%%     签名里**没有第二个内容参数**。_build_user_content(goal) 拼进 prompt 的全部东西：
%%       ① Business intent = 用户打的那 55~100 个字
%%       ② 已安装技能（installed_skills_for_channel）
%%       ③ 业界参考语料 / 设计菜谱（两者都只按 goal 检索命中）
%%       ④ refine_ctx（E29 增量改，只有二次精修时才有）
%%     也就是说：一个 LLM 调用要从一句话里同时发明实体 / 字段 / enum / 页面 /
%%     权限 / 工作流 / 不变式，还要从 316 个区块里选型。实测两轮全新话题
%%     （律所案件管理、设备报修）都是第一次没过结构闸、attempts=2。
%%     ⚠ 这不是说 GEN5 写得不好，是说**它上游是空的**——没有任何一层在它之前
%%     把需求变厚。后面 ⛔2 说的就是那个本该在它上游的东西。
%% ·
%%   【⛔2 C_TREE / spec_tree：f-string 拼的占位，且是死路】
%%     capability_maps.py 的 execute_structure_decompose 里：
%%       req_text   = f"Implement scoped permission checks for {goal}"
%%       risk_text  = f"Privilege escalation via inheritance in {goal}"
%%       deliv_text = f"SPEC tree + traceability for {goal} MVP"
%%     恒定 1 需求 1 风险 1 交付物——**换什么题材，那条唯一的需求都是同一句英文**。
%%     底下 G_SCHEMA / G_INV 两道闸在校验这棵树，校验的是**代码上一行刚拼出来的
%%     形状**，所以恒过。拼完存进 artifacts 给人看，不喂给任何生成。
%%     ⚠ 对照组：experiments/visual-first/materials/spec_tree.json（用户 zip 里那份，
%%     fingerprint crm-followup-spec-20260604）有 15 个节点、4 条 successCriteria、
%%     每个 requirement 带 acceptance 与 coversCriteria。**同名，但不是同一种东西。**
%%     那一轮 D 组能把字段从 25 推到 37，输入用的正是那份——生产给不出来。
%% ·
%%   【⛔3 ECTX ⇢ GEN5 这条边**在代码里不存在**】
%%     图上一直画着「▲ 同一上下文纪律」这条虚线，读图的人会以为过了信任门的
%%     产物（含 spec_tree）会回流进五系统起草的 prompt。实际：v5_llm_generate 整个
%%     文件里 evidence_context / UPSTREAM_EVIDENCE / artifacts 作为**输入**一次都没有；
%%     调用点 v5_capability_executor.py:420 也只传了 goal。
%%     ⚠ 这正是本文件历来最看重的那一类问题的又一例：**照着一个不存在的结构去
%%     理解系统，比不知道它存在更糟**。边保留在图上但改了标注，不直接删——
%%     删掉就没人知道它曾经被以为是通的。
%% ·
%%   【⛔4 SHEET：图挂在模型下游，且明令不许决定内容】
%%     出图提示词由 _monitor_overview_design_brief(page, datamodel, audience="image")
%%     反推，而那份 brief 的口径写在它自己的 docstring 里：把这个页面**自己已经
%%     声明、已经过 Gate 校验的 stats/charts** 当成必须覆盖的内容清单，
%%     「LLM 只负责这批内容的视觉设计，不负责决定该不该有」。
%%     所以图没有任何合法途径去加一个字段、加一个实体、改一次信息架构。
%%     ⚠ 而且同一段 docstring 里另一条：**故意不把 rankings/feeds 塞进这份清单**——
%%     参照图从来不被允许画列表。今天查 actionRef 时实测到的
%%     「自由树只落 monitor/dashboard 页 · rowsRef 6 轮里 4 轮要靠机械修复救回来 ·
%%     actionRef 只有 3/6 用上」，全部发生在这块图不许画的区域：**设计模型在这里
%%     是没有参照的**。图管版式，而列表全是内容。
%% ·
%%   【方向性结论（尚未实施，写在这里免得下次又从头推一遍）】
%%     实验 experiments/visual-first（分支 claude/visual-first-model-derivation）：
%%     同样 55 字意图，唯一差别是有没有 HTML 当输入，字段 25→37、区块 10→14、臆造 0。
%%     所以该改的是**边的方向**：视觉证据要在五系统模型的上游，不是下游。
%%     ⚠ 但**不能整条链倒过来**，这一条也是实测钉死的：4 份 HTML 里「角色/权限/
%%     主管/管理员」出现 0 次、「成交/流失/归档/阶段」出现 0 次，五组推出来的流程
%%     拓扑完全相同（5 节点 6 转移）——那是模型的行业常识，不是证据。
%%     **权限与工作流永远推不出来，只能从 spec 来。** 所以正确形状是分叉不是倒序：
%%       spec ├─ 视觉线：出图 → 反推 页面/字段/信息架构
%%            └─ 语义线：权限 / 工作流 / 不变式
%%                  两条线汇合 → 五系统模型 → 结构闸 → 设计（复用同一张图当参照）
%%     成本上这不是净增：生图那 60~85s 现在就在花，只是花在一张按设计不许决定
%%     内容的装饰图上。
%% ·
%%   【⛔ 一轮实测墙钟（2026-08-13 · gpt-5.6-luna · 未配生图）】
%%     model.generate 128.8s / 218.3s（两轮都 attempts=2）· theme ~11s ·
%%     monitor.design 81~168s（6 次采样中位数 ~135s）· 合计 220.6s / 370.2s。
%%     生产还要加参照板一张 60~85s，即**约 5~8 分钟一轮**。
%% ·
%% ☐ 2026-08-13 提案层（**一行代码都还没有**，见子图 00.2 / SPECFIRST）
%%   【2026-08-13 裁决后的形状 —— 八步】
%%     1  澄清需求 + 定位缺口 + 全网检索外部证据        现有前四步，保留
%%     2  起草 SPEC（**整个换掉「拆解结构」**）
%%          → requirement / design / tasks + 成功判据 + 页面清单
%%     3  按页面清单，逐页写出图提示词
%%     4  并发生图 N 张
%%     5  图 → HTML（screenshot-to-code 原生）
%%     6  HTML → 实体 / 字段 / 关联关系 / 页面结构
%%     7  （**第6步产物 + SPEC**）→ 权限 / 工作流 / 不变式    ⚠ 串行在 6 之后
%%     8  汇合 → 五系统模型 → 结构闸 → 设计（复用第4步的图当参照）
%% ·
%%   【⚠ 本图上一版把第 7 步画错了，这里记下来】
%%     上一版画的是「语义线与视觉线**并行**，spec 直接推权限/工作流」。**那是错的。**
%%     权限是「谁能对什么做什么」，那个「什么」——实体 / 字段 / 页面——全在第 6 步
%%     的产物里；不变式更是纯引用（refs 指向 entity/field/role/permission/page/
%%     workflow node）。不知道结构长什么样就写规则，只能写出悬空引用。
%%     ⚠ 现场证据（2026-08-13 act2 那轮，结构闸 findings=1）：
%%       invariants[reassignment_preserves_audit_context].refs:
%%       invariant ref 'reassign_work_order' not found in model
%%     并行画法会把这种失败变成常态。
%%     ⚠ 根因是一次**误译**：实测结论是「**光有 HTML** 推不出权限/工作流」
%%     （4 份 HTML 里角色/权限词 0 次），被错译成「那就别看 HTML」。
%%     正确的是 **相加，不是替代**：SPEC 给规则，第 6 步产物给规则挂在什么上。
%% ·
%%   用户最初给的形状（原文，保留以便对照）：
%%     一句话
%%       └─→ 真 spec：成功判据 + 需求节点 + 验收条件 + 页面清单   ← 现在是空的
%%             ├─ 视觉线：spec → 出图提示词 → 并发出图 → 反推 页面/字段/信息架构
%%             └─ 语义线：spec → 权限 / 工作流 / 不变式
%%                   两条线汇合 → 五系统模型 → 结构闸 → 设计（复用同一张图当参照）
%% ·
%%   【真正改的只有一条边】图从五模型的**下游**掉头到**上游**。
%%   其余节点都是这条边掉头之后必须跟着长出来的东西：图挪到前面，它就不能再从
%%   page.stats/charts + datamodel 反推提示词了（那两样是五模型的产物，上游拿不到），
%%   于是必须有一个 spec 给它页面清单；而 spec 一旦存在，权限/工作流就该从它来
%%   而不是继续混在那一个 LLM 调用里，于是分出第二条线。
%% ·
%%   【每条边靠什么撑着 —— 这张表比图重要】
%%     图挪到上游 → 内容更厚      **实测**：同 55 字意图，唯一差别是有没有 HTML，
%%                                字段 25→37 · 区块 10→14 · 臆造 0（A/D 这一对是干净的）
%%     第7步吃两个输入          **两侧都有实测**：少了 SPEC → 4 份 HTML 里角色/权限词
%%                                0 次、五组流程拓扑全同（5 节点 6 转移）；少了第6步产物
%%                                → act2 那轮不变式引用了不存在的 'reassign_work_order'
%%                                ⚠ 但「SPEC + 结构 一起喂就推得出」这一条，一次没测过
%%     图 → HTML 不能省          **实测**：25→37 是 HTML 喂出来的，不是图喂出来的
%%                                （run_d 的输入是 html，load_html 走 screenshot-to-code）
%%     spec → 出图提示词          **没写过**。现有 _build_overview_sheet_facts 入参是
%%                                (design_brief, datamodel)，两个都是五模型产物
%%     反推那一步                 **没在生产链上跑过**。D 组跑在实验台，用手工 HTML +
%%                                手工 spec，没面对结构闸 / 316 区块目录 / 权限工作流
%%     真 spec 从哪来             **未定**。路 A（LLM 从一句话生成）等于把「从一句话
%%                                发明」往前挪一格；路 B（人/前置流程给）要求上游有东西
%%   ⚠ 五条里只有第一条是实测撑着的。**这张图不是决议，是把代价和空洞画出来。**
%% ·
%%   【顺带关掉的一个洞】改后设计段拿到的是**每一页**的参照图，且那张图是照 spec
%%   画的——spec 里写着「今日待跟进列表」，图上就有列表。这正好补上 ⛔4 那块空白：
%%   今天实测 rowsRef 6 轮里 4 轮靠机械修复救回来、actionRef 只有 3/6，全发生在
%%   参照图被明令不许画的列表区，设计模型在那里一直是没有参照、纯靠猜的。
%% ·
%%   【代价】出图从 1 张（仅落地页）变 N 张（每页一张，并发）。墙钟仍 60~85s，
%%   但请求数 ×N，这笔是净增，得认。三段不动：结构闸 / 目录窄化 / 设计段。
%% ·
%%   【读图纪律】SPECFIRST 整个子图**没有任何一条对应代码**，所以框是**虚线**红边，
%%   跟 ⛔ 的实线粗红边刻意区分开。这份文件反复吃过同一种亏：V5.8 图八天渲染不出
%%   来没人发现、手写 uses 声明与实际渲染不符 316 个、ECTX ⇢ GEN5 那条边被以为通了
%%   很久。**接进主轴之前，这些框不许改成实线。**
%% ⛔ 符号: ⛔ = 08-13 标红（现状里真实存在、但形状有问题） ; ☐ = 08-13 提案（还不存在·虚线红框）
%% ❖ 2026-08-11 升版：V5.8 图（08-06 · 551394a1）之后 165 个动到
%%   slide-rule-python/services|scripts 或 client/src 的提交。这一轮的性质：
%%   **积木供给侧从"够用"变成了过剩，于是瓶颈整个换了位置**。
%%   V5.8 时代区块 23 个、基础组件 0 个，问题是"没得选"；五天后区块 407 个、
%%   基础组件 218 个，问题变成**"选不到"**——实测 11 个真实应用只用到 17 种区块，
%%   而且没有一个来自名单第 52 名之后。图上此前完全没有"选材"这一层。
%% ·
%%   【新结构 1】❖A 区块供给侧三层 / BLOCKSUP（全新子图 · 图上此前只有 BLOCKCAT 一个孤点）
%%     基础组件（燃料）→ 区块（技术燃料）→ 应用，这条链在 V5.8 图上只画了中间一环。
%%     2398ba17 → 386324931 → 02fb8d946 基础组件 0 → 58 → 137 → 217，四档：
%%              antd / antd-mobile / ProComponents / **自研**（CodeMirror·react-markdown·
%%              xlsx·canvas 签名板，零新依赖——都是"把装着没用的挖出来"）
%%     87d901ba + 7dd9e00b + 77f469a7 区块 26 → 359 → 407 → 350 → **316**（末一步是当天去重，见 ❖10）
%%     300cc1c34 区块声明它用哪些基础组件搭 —— impl 从散文换成真名字
%%     3cbf7c11f ⚠ **但那份手写声明整个删掉了**：316 个区块全部与实际渲染不符
%%              （84 条声称了没渲染 · 974 条渲染了没声称）。改成从**渲染器 AST 生成**
%%              （scripts/generate-block-component-usage.mjs → block-component-usage.json）。
%%              纪律：要查"这个区块用了什么"，问依赖图，不问声明。
%%     c3c099f0 区块中文名进目录真相源（此前只活在 block-registry.tsx，Python 侧读不到）
%% ·
%%   【新结构 2】❖B 目录窄化 / NARROW（全新子图 · **这一轮最重要的结构**）
%%     b1a8be03 按题意从 407 个区块挑 ~60 个注入，而不是全量倒进去
%%     12f74707 自适应：检索置信度低于阈值 → 退回全量（零覆盖域上窄化是净负面，实测 −58%）
%%     5152e786 预设按题意派生（第 2 层）——第 1 层管"谁进得了候选"，第 2 层管"进了之后
%%              会不会被 PROVEN LAYOUTS 的老配方抢位"
%%     8fe716ee 自适应 limit：同样召回，候选少 ~20%
%%     04af9b2d **翻默认为开**。依据 docs/block-narrowing-eval.md：3 个覆盖域 × 2 臂 × n=6，
%%              对题件被选中 0.67 → 3.25（Mann-Whitney 单尾精确 p=0.00004）；
%%              首轮过闸率无差异（Fisher p≈0.48）；prompt 字符 160,528 → 53,298（−67%）
%%     f1c1d5bd ⚠ **rank-bm25 曾漏在 requirements.txt 外**，而代码对它 fail-open——
%%              照当时状态建镜像部署，窄化会**一声不吭地整个失效**，本地 pytest 还照样绿
%%              （其余用例只要返回一个合法列表就满意，全量也是合法列表）。
%%              现在：依赖已声明 + 缺失打 stderr + tests/test_narrowing_dependency_declared.py
%%              两头钉（装了没有 / 声明了没有），并且 /api/health 暴露 blockNarrowing.effective。
%%              纪律：**会静默失效的功能，健康探针里必须有它的位置**。
%% ·
%%   【新结构 3】❖C 应用级模板骨架 / APPTPL（全新子图 · 已落地但**尚未接进推演**）
%%     72c998d3 + 43ad2ae7 services/app_template.py。用户定的链路方向（原话）：
%%              「基础组件是燃料，区块也是技术燃料。在会话推演的时候，先区块，
%%                整个应用搞完之后，你才有骨架」——**骨架是沉淀物，不是原料**。
%%     存：industry / name / when / pages[kind+purpose+blocks[type,region?]] /
%%         roleShape / workflowShape
%%     不存：实体 id、字段、任何 binding、契约（bindingSchema 在目录里）、
%%           区块↔基础组件关系（从 AST 生成）
%%     ⚠ 核心不变式 `_assert_no_bindings`：骨架一旦带上 entityRef 就退化成旧模板库
%%       那个形态——那些绑定指向组件库的订单夹具，丢进真实话题必被结构闸 DANGLING 拦下。
%%     extract_skeleton 从**生成好的应用**抽骨架；region 可选（真实模型多用栅格布局，
%%     x/y/w/h 里客观上没有区域名——知道该有什么，不假装知道摆哪）。
%% ·
%%   【主轴形状的变化】❖D 内置演示域夹具**从用户路径上摘掉** — ac7b9cf8
%%     ⚠ 这跟 08-04 那次是两种病，补丁挡不住：
%%       · 08-04 认**错**域（托管请假 → 企业请假）→ _domain_fixture_fits_goal 补的是那个洞
%%       · 08-10 认**对**了域，可夹具本身已经过期。实测一道真实「客服工单系统」被
%%         认成 service_ticket，相关性尺子理直气壮放行（题和夹具确实同域），
%%         整趟 model.generate **0 次**，端出 2026-07 之前冻结的那份——
%%         交付的 5 个页面里连 blocks 这个键都不存在，359 个区块一个没用上。
%%     **快路径产出的正是契约自己定义为「残次交付」的那个东西**（prompt 原文：
%%     "a page that ships with NO blocks renders as a bare table — that is an
%%     incomplete deliverable"）。
%%     所以不是再加一道判定：SLIDERULE_DEMO_FIXTURE_ENABLED **默认关**，认出演示域
%%     也不套夹具，落到 LLM 生成分支真做一个。夹具没删没坏，演示/回归显式开启即可。
%%     ⚠ 读图注意：DOMFIX 那条旁路**在默认配置下不再发生**，它现在是演示模式专用。
%% ·
%%   【描述已与代码不符，按现实修正】
%%     ❖1 GEN5 的 prompt **不再是全量目录** — 注入的是窄化后的 ~60 条（约 7.4K token），
%%          全量 5.6 万 token 那条路只在自适应退回时走。V5.8 图上"schema契约+…"
%%          那句话没错，但读的人会以为模型看得见全部 316 个区块——**看不见**。
%%     ❖2 BLOCKCAT 的 catalog 版本 v8 → **v407 → v350**（版本号跟区块数走；
%%          08-11 当天去重砍掉 57 个「同工厂只换文案」的凑数类型，见 ❖10），
%%          并新增两个字段：`generality`（同能力面内的默认首选，配额 max(1,min(4,n/4))）
%%          与 `fieldRefTypeConflicts`（同名 FieldRef 类型冲突的冻结基线，只准变小）。
%%     ❖3 prompt 里每个区块条目补了 `pages=`（页型限制）— ffaf964f。此前只有
%%          `regions=`，页型一个字没提，模型没有依据知道摆错了。
%%          ⚠ **但没有上闸**：这个字段四分之三的格子不是技术约束（567a0828 把运行时
%%          逐处 page.view.kind 分支查了一遍：workbench/wizard/kanban/calendar 四者
%%          从"区块能不能干活"看是可互换的），硬拒的前提"违反了就一定错"达不到。
%%          现在是：prompt 告知 + 修复器只观测不改 + 一致性棘轮（矛盾只准变少）。
%% ·
%%   【其余补收】
%%     ❖4 结构闸 findings 打印到日志 — 此前拦了什么只有模型知道，人查不到。
%%     ❖5 检索加相关性闸 — 维基 opensearch 是前缀补全不是检索，"黑灰产"曾返回蝴蝶。
%%     ❖6 blocked 闭环也缓存模型 + lastTurnId 单调 — 重复轮不再整份重生成。
%%     ❖7 组件库成为独立产品面：五阶段 AI 组装（意图→范式→区块→实例→Gate）、
%%          AI 组装区块（产出**契约**不是代码——照 ant-design/pro-blocks 那 29 个
%%          区块全是手写 React 源码的事实）、模板库、意图搜索、收藏/最近使用。
%%     ❖8 区域词汇整套换代 — 旧五槽退休，12 区域照 pro-blocks 的 29 个真实页面定，
%%          前端手抄那份删掉，两侧同读目录。
%%     ❖9 列表页归属翻转（三步走）— 声明了积木就归积木，骨架让位。
%%     ❖10 **区块去重 407 → 350**（docs/区块去重审查-2026-08-11.md）
%%          用户在组件库墙上一眼看出来的：「很多是糊弄出来的，是表格」。
%%          量下来根子不是"渲染了表格"（全目录只有 22 个渲染 Table），是这个形状：
%%              const QueryModeTabsRenderer = stableTabsRenderer("query-mode-tabs","查询模式","itemSelect")
%%          17 个 Tabs 的第三参**全同**，差异只剩 testid 和一句中文标题；
%%          14 个 compactSummary 渲染出的是同一张 ProDescriptions 键值**表**——
%%          用户说的"表格"就是这一族。共 57 个，每族留 1，线上 5 个应用一个都没用到。
%%          ⚠ 老防线为什么没拦住：batch8 那条棘轮叫 `..._without_alias_counting`，
%%            判据却是 **rendererKey 唯一**——而这批凑数每个都有自己的 rendererKey。
%%            **判据钉在标识上，问题出在内容上**（本仓第三次踩这个：手写 uses 声明、
%%            pageKinds 从没集中评审，都是同一类）。
%%          新闸 no-filler-blocks.test.ts 改成看**工厂签名的形参名**：同工厂多区块，
%%          参数必须有除 testid/文案之外的差异。第一版按"是不是裸字符串"剥，
%%          把 matureKanban(variant) / diagnosticDrawer(refKey) / multiSeriesChart(defs)
%%          三族真有差异的误判成了凑数——它们的差异恰好都长成字符串。
%%          纪律：**签名读不到就一律保留，宁可漏判不可误判**（误判会逼人删掉真有用的）。
%%     ❖11 **第二刀 350 → 316**：上面那道闸判的是**源码形状**，用户看完还是说
%%          「主体区、补充说明怎么还全是表格」。它漏了两类，漏得很典型：
%%            · ContextPanelRenderer 那 16 个**挤在同一行源码里**，行锚定的正则只匹到第一个；
%%            · 16 个向导根本不是调用点，是**策略表条目**（CONFIGURATION_WIZARD_POLICIES），
%%              行为标志位只有 4 种组合 —— 4 个区块穿了 16 件马甲。
%%          教训不是正则不够全，是**判据挂在源码怎么写上就永远追不完写法**。
%%          第二刀换成地基真相：**按各自 bindingSchema 合成夹具真渲染，比归一化 DOM**。
%%          ⚠ 度量自己也差点出错：头一版把 19 个图表判成同款（ECharts 在 SSR 下只吐空容器）、
%%            把一批未绑定的判成同款（都渲染 antd Empty），差点删掉 SankeyFlow 和 RadarComparison。
%%          排掉假重复后 18 组 52 个，删 34。两刀合计 407 → **316**。
%%     ❖12 **组件库墙的空卡治了**：那两屏"看着一样"里，很大一部分不是重复，是
%%          **没东西可看**——手写夹具只覆盖 229/316，其余卡片只有一行灰色组件清单。
%%          把去重那套合成器接进墙（绑定现合成、值仍取原有中文示例数据），
%%          真渲染出内容的从 72% 提到 **95.3%（301/316）**。
%%          判据取**结果**不取"有没有夹具"：合成的绑定照样可能喂不饱区块。
%% ·
%%   【❖ 08-11 已知缺口（写在图上，免得当成没人看见）】
%%     · **模板骨架尚未接进推演**：app_template.py 已落地、种子 4 条已自检，但 match/inject
%%       两端都没接线，也没有存骨架的表。app.py 里那行 import 只为触发启动自检。
%%     · **pageKinds 还剩 8 对矛盾**（同域同能力却规则相反），清零之前不上闸。
%%       ❖ 08-11 去重时白掉一格（9 → 8），**不是靠改 pageKinds 改出来的**：
%%       那一对本来就是同一份实现挂两个名字，一个允许 workbench 一个不允许。
%%       所以剩下 8 对值得按"是不是这个类型压根不该存在"再看一遍。
%%     · **第二层选材没收干净**：位置是必要条件不是充分条件——提到最前的 16 个里
%%       仍只有 4 个真被用过，PROVEN LAYOUTS 的老配方仍在抢 workbench 页的位。
%%     · **自研组件 7 个里 2 个仍无归宿**（SignaturePad / ExcelExportButton）。
%%     · **交付质量波动大**：同一道题跑三遍，专用件数量 6 / 2 / 5——这跟页型无关，
%%       是另一个还没查的问题。
%%     · **成本账是假的**：costLedger 的 estimatedTokens = len(输出)//4，只数输出不数输入，
%%       且中文按 4 字符 1 token 算（实际约 1 字 1 token）。真实一次推演 9 万+，
%%       账上约记 1 万，于是 maxTokensPerSession=500,000 那道闸**永远不会响**。
%%       Node 侧 costTracker 又因 LLM_UNLIMITED_MODELS 命中生产模型而整个跳过记账。
%%     · **没有视频生成能力**（一处都没有）；生图 fail-closed 且 .env 里未配置。
%%     · 会话创建路由收到字符串 goal 时返回 500 而不是 400（契约是 {"goal":{"text":…}}）。
%% ·
%%   【❖ 顺手照出来的一件事：V5.8 那张图从来没渲染出来过】
%%     写这一版时拿仓库里已装的 mermaid（11.16.0）把历代架构图挨个 parse 了一遍：
%%         V5.2 ~ V5.7  全过    ·    **V5.8 语法错，解析不了**
%%     也就是说 08-03 发出去之后的八天里，那张图在任何 mermaid 渲染器里都是一片红。
%%     没人发现，是因为这份文件历来只被人读源码，没人真去渲染它。
%%     两处伤都出自同一个习惯——**升版时在写完的节点尾巴上接着补话**：
%%         ① 文字落到了标签外面   FREEFORM["……"]:::cap<br/>✪08-03 …（`]` 之后不再是标签）
%%         ② 标签里嵌了裸双引号   MONITOROV["……一份"一行长什么样"的模板……"]
%%     V5.9 里这六处 + 三处已就地修好（文字挪进标签、双引号换「」），并补了
%%     scripts/architecture-diagram.test.mjs：**每一张架构图都必须 parse 得过**，
%%     V5.8 作为归档件进"已知损坏"名单（双向棘轮——哪天修好了也得回去销名）。
%%     ⚠ 纪律：这道闸守的不是"别写错语法"，是**"追加式升版必须仍然渲染得出来"**。
%%     ⚠ 这也是本文件头那句话的一次自我兑现："描述已与代码不符——照着一个不存在的
%%       结构去理解系统，比不知道它存在更糟"。一张打不开的图，是同一个病的极端形态。
%% ·
%% ✪ 2026-08-03 升版：V5.7 图（07-31 11:51 · 0d35b28）之后 45 个动到
%%   slide-rule-python/services 或 client/src 的提交。这一轮的性质跟前两轮都不同——
%%   前两轮是"补新结构 + 修描述"，这一轮**图的地基变了**：这套系统从一块谁都能写的
%%   公共黑板，变成了有账号、有归属、有可见性的系统。图上此前**一个身份节点都没有**。
%%   另有一批 V5.7 刚刚修正过的描述，三天里又被推翻了一次——参照板那条链路和配色
%%   那条链路各自被整段重写。逐条可溯到提交：
%% ·
%%   【新结构 1】✪A 身份与权限层 / IDENTITY（全新子图 · 图上此前整层缺失）
%%     这不是"加了个登录框"，是**主轴上多了一道贯穿式的归属线**：
%%     395766b7 邮箱注册登录 + 匿名可读/登录可写/超管三档
%%     d6726e4f 应用访问模型(级别阶梯 + 三档可见性 + Fork 继承私有)
%%     6e1514da 归属落库 + 路由挂访问守卫 · e1d2fbda 存量迁移脚本(默认 dry-run)
%%     cae5cf15 账号接口 + 前端登录态 · f5c6ec62 锁住 TestClient Cookie 复用陷阱
%%     7638dc7f 验证码邮件接真服务商(SMTP 通用 + Resend HTTP)
%%     d9c74807 → a95dcf14 独立登录/注册页(团队插画 + 主标语 + 「暂不登录」出口)
%%     430a78ba **旧 Node/MySQL 账号体系整套下掉**——替代守卫先写好再删，
%%              /api/admin 没有一秒钟是敞着的。图上若还留着那条线，现在是死节点。
%% ·
%%   【新结构 2】✪B 会话落库 / session persistence（RUNTIME 侧 · 图上此前缺失）
%%     94c8ed7e 会话持久化。此前应用中心 23 个应用点开 18 个是空白页——
%%     APPSTORE 存了模型，会话本身没存，点进去没有可恢复的现场。
%%     5598cb52 顺带调优：跳过无效写入 + 去掉回读，一次保存 264ms → 215/88ms
%% ·
%%   【描述已与代码不符，按现实修正——照着一个不存在的结构去理解系统，
%%     比不知道它存在更糟。这一轮有三条，都是 V5.7 刚写完就被推翻的】
%%     ✪1 THEME 整个节点**已经不存在** — 028ac8b0 全站一个颜色（用户裁决）。
%%          V5.7 的 ✧2 刚把它从"8 套预设兜底"修正成"色板由种子色算(MCU 的
%%          HCT/TonalPalette)"，三天后连种子色一起没了：enrich_identity_theme
%%          整段从 v5_capability_executor 移除，_theme_palette 恒返回 BRAND_SEED。
%%          ⚠ 这里省掉的不只是一个函数：那一步原本要**花一次生图（~74s）换一个
%%          色值**，而那张图从不展示给任何人。存量库里的 generatedTheme 读到即忽略，
%%          不需要迁移。菜单白、Header 白，首页那张生图不受色板约束、自由发挥。
%%     ✪2 SHEET 参照板换了第三家端点，且**全系统只生一张** — d81e2ddd。
%%          V5.7 的 ✧1 写的端点是 api.xiaoleai.team；当前是 api.gpt.ge
%%          （逐像素认 size，1280x720 / 720x1280 实测都精确返回）。
%%          ⚠ 端点相关行为那条规矩仍然成立：换一家必须整份重测，别拿旧端点的
%%          结论当常量——这条 V5.7 写过，这次正是它救了场。
%%          数量上从"每个 monitor/dashboard 页各一张、上限 4 张、外加主题一张"
%%          砍到**只有落地页那一张**。开关就是有没有配生图 key，不新增环境变量
%%          （少一个旋钮少一处「文档说关了其实没关干净」的机会）。
%%          那张图同时就是应用中心卡片显示的画面（OverviewPreviewSink）。
%%     ✪3 ✧6「monitor 页放开 page.blocks · 总览不再只有数字」**方向反了** —
%%          119b7e4f + c25601da。首页现在由 freeform 设计**独占**：有
%%          freeformOverview 的总览页，脚手架/固定榜/流全部让位（freeformOwnsPage）。
%%          ⚠ 只在后端关掉是不够的——积木仍写在 page.blocks 里，摆不进设计树就会
%%          掉到设计区**外面**照样渲染，固定组件一个没少、位置更差。渲染端必须同时收口。
%% ·
%%   【主轴形状的变化】✪C blockRef 通道整体删除，换成 rowsRef — c25601da
%%     ⚠ 这是两个不同的解法，别混为一谈：
%%       · blockRef（07-29 上线）：设计模型画不了逐行内容，所以让它**挑一个现成
%%         积木摆进版式**，渲染交给积木自己的真渲染器。代价是首页上永远有几块
%%         不是它设计的东西（实测：一排禁用态按钮、8 格流程网格、右栏直接甩
%%         seed-lending_record-10 这种种子 id）。
%%       · rowsRef（08-03 取代它）：**把逐行能力直接给设计模型**——版式它自由画，
%%         真实行数据由 rowsRef 绑（entityRef / fieldRefs / limit / order，
%%         limit 有上限，防一个 ref 把整张表拉平）。逐行内容展开发生在渲染期。
%%     所以目录里的 freeformEmbeddable 白名单**整个字段删除**（catalog v7 → v8），
%%     schema_legal 的派生常量、Pydantic 校验、prompt 文案、前端渲染四处同步消失。
%% ·
%%   【其余补收】
%%     ✪4 匿名点发送会撞出无关的 500 — 953a2bf3。后端第一句话就说了「请先登录
%%          后再推演」(401)，但驱动层 `if (!res.ok) return null` 把 401 和"服务挂了"
%%          返回同一个 null，调用方按约定**回落本地引擎重跑**，本地引擎去打 legacy
%%          的 /execute-capability，那条路在 python 后端下直接 500 thin_proxy_violation。
%%          ⚠ 纪律：**权限失败不是瞬时故障**——不该重试、不该降级、也不该回落
%%          （本地重跑同样绕不过登录）。401 抛 DriveAuthRequiredError，其余失败
%%          维持 return null 的老约定，降级路径本身是对的，不能顺手一起改掉。
%%     ✪5 五系统生成的输出上限改可配 — 89db59ea。写死 8000 在推理模型下**必然失败**：
%%          思考与正文共享同一个 max_tokens，思考先吃掉几千，剩下的写不完一份五系统
%%          模型，表现为 "empty content from LLM (stream)"，看着像网关抽风。
%%     ✪6 手机档渲染画布改 9:16 — c3a513a8。出图侧早就是 720x1280，渲染侧不是，
%%          两边对不上。横向空间本来就紧，所以是**加宽**(390x844 → 405x720)不是压扁。
%%     ✪7 缩略图 PNG → WebP — f687c2aa。首屏 6.3MB → 0.8MB（5Mbps 冷启动 10s → 1.2s）。
%%          服务端按内容嗅探 Content-Type，不认 WebP 的客户端现场转回 PNG。
%%     ✪8 推演跑起来时整站失联 — e199e447。drive_full 是同步耗时调用写成了
%%          async def，把事件循环整条堵死；改回 def 交给 Starlette 线程池。
%%     ✪9 App Store 切回 Neon 会把单 worker 堵死 — cc483404 三层原因逐层修 ·
%%          02df2020 加 APP_STORE_NEON_HTTP 显式指定走 HTTP 通道。
%%    ✪10 对外口径全面改「面团 AI」 — 4d8a15d8 + a4bdf8cb + d587474d + 6658b6b2 +
%%          4a520225。**内部标识刻意没改**：文件名、模块标识、事件族、API 路径
%%          (/api/sliderule)、环境变量 (SLIDERULE_*)、几百个 spec 目录仍写 sliderule。
%%          判断标准只有一条：**这个字符串会不会出现在用户眼前**。会 → 用 shared/brand.ts
%%          的常量；不会 → 保持原样。对外叫什么和对内叫什么是两件事，混为一谈才是真的乱。
%%    ✪11 话题语料库 — 5d00c1cd 抓 TRAE 大赛 300 帖 · 03583abb 扩到官方 2000 全量
%%          （1993 条入库 Neon + 分析，做正确基线的对照）。这条不在推演链路上，
%%          是给生成质量做评测基线用的，图上不出节点，记在这里备查。
%% ·
%%   【已知未修，图上标出来免得当成没人看见】
%%     · 首页设计版面**溢出画布**：实测设计内容底边落在 1440x810 画布的 1600px 处
%%       （溢出 790px，overflow:hidden 直接裁掉，两张图表的 y 在 876–1076 全被裁）。
%%       119b7e4f 之后降到 207px，但根子是**设计侧没有高度预算**——设计模型不知道
%%       自己在往一个 810px 高的盒子里画。rowsRef 上线后这个数需要重测。
%%     · 首页参照板质量下滑，三因叠加：①内容变少（blockRef 那批视觉描述随通道一起
%%       停了）②07-31 改两段式时，"占位写成看得见的文字·不许用灰条/色块/留空"和
%%       "信息层级必须画满"这两条常量**没进改写系统提示词**，只活在区块级参照图那边
%%       （freeform_block.py:1224）③写提示词的 LLM 换了网关。
%%       ⚠ V5.7 的 ✧4 原话："改写 LLM 漏掉哪一条，那一张图就会复发对应的老 bug。
%%       判断这笔交易划不划算，唯一的办法是出图看。" —— 这就是它预言的那次复发。
%% ✪ 符号: ✪ = 08-03 升版
%% ★ 以下为 V5.7（07-31）图，节点区含 ✪ 标注的修正；V5.7 未修订原文
%%   逐字保留于 docs/SlideRule V5.7 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
%% SlideRule V5.7 架构图（推演引擎规格 · 继承 V5.6 全图 + ✧ 07-31 升版）
%% ✧ 2026-07-31 升版：V5.6 图（07-30 01:12）之后 47 个提交。这一轮的性质跟上一轮
%%   不同——上一轮是"补三处新结构"，这一轮**一多半是修正**：参照板那条链路在
%%   四天里被连续改了十几刀（换端点、改尺寸策略、砍区块、prompt 换形态），图上
%%   的描述已经跟代码对不上；另有两个整块的产品面（应用中心作品墙、部署蓝图）
%%   图上一个节点都没有。逐条可溯到提交：
%% ·
%%   【描述已与代码不符，按现实修正——这类比漏收更要紧，照着一个不存在的结构
%%     去理解系统，比不知道它存在更糟】
%%     ✧1 SHEET 参照板已经不是"三区" — 86ce188 拿掉「样式风格」区(整张画布只画
%%          真实版式) · a40abc0 明说设备档时不再多画一区 · 185c427 换端点并把
%%          尺寸按档位拆开(桌面 1280x720 / 手机 720x1280·各出一张·不再挤一张图)
%%          V5.6 图上"一张图并排画三块:样式画板 + 桌面 16:9 + 手机 9:16"三条全废。
%%          ⚠ 尺寸那条尤其要看清:**是否认 size 参数是端点相关行为**。当前端点
%%          (api.xiaoleai.team)逐像素认;上一家(hello.vangularcode.asia)完全不认、
%%          十个尺寸组合全回 1672x941。所以 V5.6 图上"传1792x1024实收1672x941"
%%          不是普适结论，是上一家的行为，换端点必须整份重测(d410e6d 删过时白名单)。
%%     ✧2 THEME 8 套预设不是"降级为兜底"，是**彻底不参与配色** — 0f32989 色板改由
%%          种子色算(vendor MCU 的 HCT/TonalPalette) · 32df415 预设收尾只剩种子色
%%          +派生 · bb2e9ef 派生色板调轻。_theme_palette 函数体第一行就是
%%          `del theme_id`。实测:8 个合法主题 id 派生出的主色**只有一个值**
%%          (#5b6b7c，即 FALLBACK_SEED)。"兜底"意味着还能被选中，现在选不中。
%%     ✧3 MONITOROV "一页跑三次"现在是**两次或三次** — 6fe1c13 入站判设备档:
%%          preferredDevice 明说 desktop 就不再设计手机档(省约 67s/页)。判不出来
%%          或写 unspecified 仍两档都生成——只在明确的时候才砍。
%% ·
%%   【新结构 1】✧A 应用中心作品墙 / AppsWorkbench（OUT 侧新子图 · 图上此前整块缺失）
%%     2ec7ea9 两端对齐行布局 → bc48d35 react-photo-album masonry → 04c9165 换
%%     masonic + 图下信息区 → 60c3035 跨列 + 无限流 → 34bd238 信息条压回画面上
%%     APPSTORE 入库之后没有下文:那些应用是在**哪个界面**被看见的，图上没有节点。
%% ·
%%   【新结构 2】✧B 部署蓝图 / render.yaml（EXEC 侧 · DEPLOY 之下）
%%     072b659 补齐四个漏配开关(部上去会静默少一半功能) · f106daa UVICORN_HOST
%%     必须 0.0.0.0(健康检查走 IPv4·容器 v6only 时 :: 收不到) · ff131b6 补 Neon
%%     持久化 + E2B 沙盒 + 会话密钥
%% ·
%%   【其余补收】
%%     ✧4 参照板 prompt 改两段式 — 525f603 事实清单(_build_overview_sheet_facts)
%%          + LLM 按这一个系统现写出图提示词。**拿确定性换多样性**:原来那五段
%%          常量每条都有出图证据，但它对每个应用说同一句话(实测两个完全不同业务
%%          的出图提示词逐字相同 87%)。现在改写 LLM 漏掉哪条，那张图就复发对应老 bug。
%%     ✧5 参照板可单独指向另一家服务商 — fada224 SHEET_IMAGE_* 一组独立配置
%%     ✧6 monitor 页放开 page.blocks — ffca300 总览不再只有数字
%%     ✧7 freeform JSON 先机械修复再 reask — dc01b88 深层嵌套树偶发数错括号
%%          (真机复现:{}/[] 各差1、尾巴多个孤立句号，且**不是** token 截断)。
%%          新依赖 json-repair;手搓括号计数容易拼出语法合法但结构错位的树。
%%     ✧8 lineHeight 裸数字撑爆 KPI 卡 — cd02d96 裸数字被当倍数解释
%%     ✧9 档位切换只列真有设计的档 — 7172243 没设计过的不给入口 · dde3f3d 单档时
%%          那个按钮不能收起来(注释原本写反了)
%%    ✧10 卡片墙密度压测台 — a905908 串行驱动(并行两个浏览器抢 CPU·测出来的数
%%          偏高且偏多少不可知) · b825185 分批挂载，附一条被实测推翻的判断
%%    ✧11 演示种子换真随机源 — ecfad98 pure-rand xoroshiro128+ + 语义词表
%% ✧ 符号: ✧ = 07-31 升版
%% ★ 以下为 V5.6（07-30）图，节点区含 ✧ 标注的修正；V5.6 未修订原文
%%   逐字保留于 docs/SlideRule V5.6 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
%% SlideRule V5.6 架构图（推演引擎规格 · 继承 V5.5 全图 + ✱ 07-30 升版）
%% ✱ 2026-07-30 升版：V5.5 图（07-26）之后四天、68 个提交。这一轮的变化不是
%%   细节修补——图上多了**三处此前一个节点都没有的新结构**，另有六处旧节点
%%   的描述已经与代码不符。逐条可溯到提交：
%% ·
%%   【新结构 1】✱A 入站判定闸门 / Intake Triage（新子图 00.1，在推演之前）
%%     c668db5 四态判定+评测台 · b34c6e6 提示条 · bf6deee 输入变了撤旧提示 ·
%%     19f03d8 带应用摘要 · 30e0433 hasApp 用真有应用判定 · cdf704a 拆掉
%%     real→iteration 硬覆盖 · 0f219b6 拒绝档
%%     一轮推演约 20 分钟 + 一次完整 LLM + 最多 9 张生图，此前**任何**输入都
%%     直接进推演（"你好"照样烧）。现在入站先判六态，只提示不阻断。
%%     ⚠ 与图上原有的 INTAKE（06 消息入站单门：load SessionState/derive/prompt
%%     cache）**同名不同物**：TRIAGE 在 INTAKE 之前，判"这一轮该不该跑"；
%%     INTAKE 在 TRIAGE 之后，判"这条消息怎么接进状态机"。
%% ·
%%   【新结构 2】✱B 演示种子数据 / demo-seed（RUNTIME 新增，闭环产出的应用侧）
%%     2c44261 打开就有内容 · ecfad98 换真随机源+语义词表 · 109fcf4 钉最近两天
%%     闭环产出的应用第一次打开时每个实体都是零行，表格/图表/KPI 全线"暂无
%%     数据"。现在按字段类型与语义确定性铺一批示例行。
%% ·
%%   【新结构 3】✱C blockRef 桥（ENRICH ↔ SAFEREND 之间的新连线）
%%     f02406c
%%     此前逐行内容（排行榜/动态流）freeform 画不了（dataRef 取不到逐行记录，
%%     硬画只有表头没有行），只能被赶到设计之外单独渲染成外挂卡，首页长成
%%     "AI 设计区 + 两张外挂卡"。现在设计里可以挂 blockRef：**摆在哪、占多宽
%%     由设计者定，渲染委托给积木自己的真渲染器**。
%% ·
%%   【描述已与代码不符，按现实修正】（措辞修正不是新功能，逐条见节点内 ✱ 标注）
%%     ✱1 体验区块从占位变真渲染 — 4ac6c63 五个区块接真渲染器 · 4b55452 方案C
%%          按页面类型划分 KPI/图表归属(总览页走 page.stats/charts·业务页走
%%          MetricGrid/TrendChart·渲染层双向硬隔离) · 55422ee 绑主实体的
%%          DataTable 摘掉 · 4169c0e/4dd8d01 ActivityFeed 宽行档 variant=row
%%     ✱2 固定组件全部换 Ant Design — 0f32a57 区块换 Card/Empty/Timeline/
%%          List+Progress/Table(颜色走主题 token·不再写死十六进制) ·
%%          1972d36/d3489e2 录入层读写共用一张 valueType 表(借 pro-components
%%          valueType 机制) · e97ced8 渲染锁测试
%%     ✱3 手机档不再套 PC 组件 — 7f69b81/0dda249/8a5c3f6/fb3bab4 antd-mobile
%%          全家桶 · 746981a React 19 兼容(react-dom 不再导出 createRoot) ·
%%          7c117b9/4e8562f 按 pageKind 出骨架(dashboard/monitor/wizard/kanban/
%%          calendar) · bf187cf 中文 locale+NavBar+Calendar · 50974c0 Collapse ·
%%          c1f28af TabBar 行数徽标(走主题色·不是 antd-mobile 默认的红)
%%     ✱4 色板从"写在 prompt 里"变成机械校验 — 49544bf palette_guard：OKLCh 里
%%          判两条(色相落在色板 ±25° 内·主色用量不低于任何其他色系)，近中性色
%%          chroma<0.04 豁免；违规先带偏差重问，重试耗尽机械纠偏(只旋色相保
%%          L/C)后放行——**配色问题绝不抛错**(抛了就回落固定骨架)
%%     ✱5 KPI 卡从一层变三层 — 49544bf 大数字 + 环比 + 卡底迷你走势线(形状对标
%%          pro-components StatisticCard)；dataRef 新增 trendFieldRef/trendGrain，
%%          一个字段驱动两层；不撒谎边界：前期为 0 显"较上期 —"不编 +∞·单桶
%%          不出线·<0.5% 直说持平·口径与主数字同源·主数字算不出则整个不挂
%%     ✱6 首页版式按设备分档 + 三区参照板 — 6d69a67 手机档也渲 AI 设计的总览
%%          (固定骨架让位) · a40236d 两档各设计一版 + 一张三区板喂两档
%%          (freeformOverview={root, mobile?:{root}}，取值规则借 react-grid-layout
%%          的 layouts={{lg,md,sm}}+"本档没有就回退更大一档") · 41d8d67 技术标识
%%          不入画 · 6103b26 板子退回 1672x941 + 密度预算(降分辨率必须同步降
%%          密度·否则每个元素分到的像素不够会糊) · 21a5940 控件长相锚到
%%          antd/antd-mobile(配色明令排除品牌蓝)
%%     ✱7 结构门两处收紧 — c1f28af 实体字段 type 纳入校验(此前非法类型如 file
%%          一路无人查，前端对认不出的类型一律当 text——用户以为能传附件实际
%%          只能打字，不报错不提示测试全绿) · 61e3a74 binding 哨兵词从 "none"
%%          改祈使句(模型把 "none" 当成要填的值，QuickActionPanel 全产出
%%          entityRef:"none"，全新话题 4 条门禁不过) · c22e716 prompt 里的
%%          "with slots" 被读成键名，一轮 6 页排版全丢
%%     ✱8 App Store 存储降级从三级改四级 — 2f7b618 远端 TCP → 远端 SQL over
%%          HTTP → **本地 SQLite** → 本地 JSON。前两级是同一个远端库的两条通道
%%          (受限网络只放行 443 时自动改走 HTTP·数据不分叉)，第三级才是本地库。
%%          此前远端一挂直接掉到最弱的 JSON 兜底(整文件读写·无索引无事务)
%%     ✱9 技能库两层化 + 通道分流 — 7abacb7 128 条逐条判定能否绑成 aigc 能力 ·
%%          d2ebf0c 下架社区层(只留精选/已安装) · b34c6e6 按消费通道分流 ·
%%          ab31b28 再下架 31 条 unbound(装了不产出任何东西的不占精选位)
%%     ✱10 dev-only 巡检设施 — d0e88d8 app-shell-tour.mjs 进仓库(桌面/手机双档
%%          全页巡检·SLIDERULE_CHROMIUM_PATH 逃生口) · f9c31c4 block-gallery
%%          对照台(九个区块连空态一次铺开·可切主题·不进生产产物)
%% ✦ 以下为 V5.5（07-26）图，节点区含 ✱/07-30 标注的修正；V5.5 未修订原文
%%   逐字保留于 docs/SlideRule V5.5 架构图.md（本文件为其修正超集）：
%% ===========================================================================
%% SlideRule V5.5 架构图（推演引擎规格 · 继承 V5.4 全图 + ✦ 07-26 审查修复升版）
%% ✦ 2026-07-26 升版：对 V5.4 图（07-24）做了一轮"图码对照审查 + 九项修复 +
%%   终检对抗复核"（提交 b9a3e26 / 150c694 / aa5cc4f，决策留档 docs/adr/）。
%%   本版两类变化：其一，代码真实长出的新结构；其二，V5.4 图上与代码不符的
%%   表述按现实修正（措辞修正不是新功能，逐条见节点内 07-26 标注）：
%%   ✦1 演示域识别纪律 — 裸子串匹配误伤修复（"sla"命中 translation/island/
%%                        slack 的真实事故）：词边界+复数后缀+强弱词分级，泛词
%%                        单独不认域，认不出 fail-closed 走 LLM 生成；夹具产物
%%                        provenance 标注 builtin-domain（ADR-0002）
%%   ✦2 渲染防崩溃气囊 — AppStageErrorBoundary 兜渲染异常（诚实降级卡+
%%                        resetKeys 自动复位）· freeform 树深度/节点上限双侧
%%                        同值（micromark 纪律：超限截断降级不炸栈）
%%   ✦3 数据诚实收紧   — sum 空数据显「—」（SQL/pandas 语义，不再显 0 冒充
%%                        真值）· "数字必须挂 dataRef"生成侧真实强制（只拦
%%                        数据声明形状，不误伤 近7天/Top5 这类结构性数字）
%%   ✦4 SSOT 收编      — identity_theme_presets.json 新共享源（8 套主题+生成
%%                        主题合格契约，前后端物理同读）· 图标形状正则/legacy
%%                        别名收进 experience_block_catalog.json 双侧派生 ·
%%                        gate 槽位从账本派生 · parity 哨兵双侧锁死（ADR-0003）
%%   ✦5 体验层成本预算 — 参考图/截图自检每次 enrich 限额（env 可调·按尝试
%%                        计费·超限退纯文字有日志）· SLIDERULE_E2B_TEMPLATE
%%                        预烤沙盒模板免现装 playwright
%%   ✦6 演示域夹具预增强 — golden-file 再生成脚本离线跑主题增强、重新过门后
%%                        冻结（四域生成主题各按预设色相锚点差异化），运行时
%%                        仍零 LLM；ENRICH 子图补画 APPSTORE 入库节点（原缺失）
%% ★ 以下为 V5.4（07-24）图，节点区含 ✦/07-26 标注的修正；V5.4 未修订原文
%%   逐字保留于 docs/SlideRule V5.4 架构图.md（本文件为其修正超集）：
%% ---------------------------------------------------------------------------
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
  HINTBAR["✱ 入站提示条 / IntakeHintBar<br/>action=hint 才占视线·引导话术+可点改写按钮(点了回填输入框)<br/>发送键始终可用·提示条自己写明「这只是建议·直接发送仍会照常推演」<br/>输入一变立刻撤下旧提示(requestId 单调递增·慢响应盖不掉新判定)"]:::surface
end
 
subgraph TRIAGE["00.1 入站判定闸门 / Intake Triage（✱ 07-30 新增子图 · 在推演之前 · fail-open · 只提示不阻断）"]
  direction TB
  TJ0["✱ 第0层 确定性预判 / precheck<br/>零成本零延迟·只挡闭眼都知道的(空输入·纯标点·纯问候语·<3有效字)<br/>纪律:宁可漏也不能误伤——真需求落这里被拦就没有第二次机会<br/>阈值曾是4字，评测台抓到它把「你是谁」判成 vague"]:::gate
  TJCAP["✱ 能力面 / _capability_block（判「做不做得了」的参照物）<br/>能表达的那一半**现算自 five_system_legal.json**(字段类型/页面形态/图表类型)<br/>不手抄:账本加一种形态而这里忘了跟，会继续拒绝已经做得到的东西且不报错<br/>做不了的五类(游戏与实时互动/硬件设备/端侧原生/图形内容创作/实时信号与算法)<br/>从250条真实参赛标题聚类·**不在账本里**(账本记合法枚举·不记产品边界)"]:::ledger
  TJRULE["✱ 第1层 规则表 / _RULES（Parlant 式 condition + scope + priority）<br/>每条带适用域·每轮只把相关的拼进 prompt(规则增长时干扰面不扩大)<br/>meta 90 · off_topic 80 · new_unrelated_need 75 · real/iteration 70<br/>· **out_of_scope 60** · vague 40<br/>拒绝档刻意压在 real 之下:TriageSQL 数据说超纲最好判(F1 0.90)、真需求最难<br/>(0.53)——风险在误伤不在漏判；规则正文内写四条硬负样本教它别看关键词"]:::gate
  TJLLM["✱ 第2层 LLM 判定 / judge_turn<br/>六判词:real·iteration·vague·off_topic·meta·**out_of_scope**<br/>vague 与 out_of_scope 分开(照 TriageSQL:「说不清」与「说清了但表达不了」<br/>是两类)——对超纲说「再多说两句」是骗人，补细节也变不出游戏引擎<br/>out_of_scope 的话术三要求:直说做不了·点明做不了的是哪部分·给出周边真<br/>做得了的那个系统(rewrite 填完整说法·点一下改过去)"]:::cap
  TJACT{"✱ 判决→动作 / _resolve_action（唯一决定要不要打扰用户的地方）<br/>real/iteration → proceed · 其余 conf≥0.6 → hint · <0.6 → proceed(判不准别打扰)<br/>**第一版永不返回阻断动作**(blocking 开关留给误判率收敛之后)<br/>拒绝档共用同一个地板:调低会误伤「带技术领域词的真需求」，那是最贵的错误"}:::gate
  TJEVAL["✱ 评测台 / eval_intake_judge（升级阻断的唯一依据）<br/>104 条用例(+40 超纲按五类分组·+10 硬负样本专量误伤)·--workers 并发<br/>三档错误分开算(🔴误拦真需求=事故 · 🟠漏判超纲=交付做不出的东西 · 🟡未提示=浪费)<br/>拒绝档另按 clinc/oos-eval 口径出召回/精确(总准确率会被样本配比稀释)<br/>实测 0/40→40/40 召回·误拦恒 0·×3 稳定 120/120"]:::trust
  TJDEV["✧ 设备档判定 / _DEVICE_RUBRIC（07-31 新增·与入站判定共用同一份判据）<br/>此前 preferredDevice 生成契约**只声明合法域·没给任何判据**·模型无从选择<br/>就一路倒向 desktop(扫过真实数据:9个应用全是 desktop·不是它们真都是桌面应用)<br/>于是「两档都生成设计」实际是在为一个没人做过的判断买单(每页多花约67s)<br/>补了姿态判据之后这个字段才有意义·下游 MONITOROV 据此决定砍不砍手机档"]:::gate
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
  C_TREE["结构拆解 / structure.decompose<br/>● + 旧管线推导回填(K5)<br/>⛔08-13 标红:产出的 spec_tree 是 **f-string 拼的占位**·恒定 1 需求 1 风险 1 交付物<br/>唯一那条需求永远是 Implement scoped permission checks for 「goal」·换什么题材都一样<br/>底下 G_SCHEMA / G_INV 校验的是**代码上一行刚拼出来的形状**·所以恒过<br/>⚠ 而且是**死路**:拼完存进 artifacts 给人看·不喂给任何生成(见 ⛔3)<br/>⚠ 对照:用户 zip 里那份 spec_tree 有 15 节点 / 4 条 successCriteria / 每条带 acceptance<br/>**同名但不是同一种东西**——D 组字段 25→37 用的正是那份·生产给不出来"]:::cap
  SPECSRC["☐ 提案 · 第2步 spec 来源【已裁决】:LLM 从**澄清后的需求**生成<br/>吃第1步的产物(澄清需求 + 定位缺口 + 外部证据)·不是吃原始那一句话<br/>产出 requirement / design / tasks 三件套(spec-kit / Kiro 口径)+ 成功判据 + 页面清单<br/>⚠ 它仍然是「从文字发明」·但比 GEN5 直接发明强的地方在于:**有验收条件·有页面清单**·<br/>下游能对着它检查。这一点未测·是假设<br/>⚠ 参照形状(用户 zip 那份·promptId=whybuddy-crm-mvp-v1):15 节点 · 4 条 successCriteria ·<br/>每个 requirement 带 acceptance 与 coversCriteria。生产那份只有 1 需求 1 风险 1 交付物"]:::propose
  SPECREAL["☐ 提案 · 真 spec / 取代 ⛔2 那份 f-string 占位<br/>**存**:成功判据 · 需求节点 + 验收条件 · 页面清单<br/>⚠ 页面清单是**粗粒度**的(有哪几页 · 每页给谁用 · 要干什么)——跟五系统模型里<br/>那份细的(kind / stats / charts / blocks / 绑定)不是一回事·所以不构成循环依赖<br/>粗的这份必须在**出图之前**就有:否则不知道并发出几张图·每张画什么<br/>参照形状(用户 zip 那份):15 节点 · 4 条 successCriteria · 每个 requirement<br/>带 acceptance 与 coversCriteria。现在生产那份只有 1 需求 1 风险 1 交付物"]:::propose
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
  BLUEPRINT["✧ 部署蓝图 / render.yaml（07-31 新增·一键部署的单一真相源）<br/>漏配不会报错·只会**静默少一半功能**:补齐四个开关后才有完整链路<br/>UVICORN_HOST 必须 0.0.0.0——**不能用镜像默认的 ::**。健康检查走 IPv4·<br/>容器 v6only=1 时 :: 收不到 IPv4 连接;当时日志是铁证:端口探测从 ::1 打进来<br/>通了·中间15分钟一条 /health 都没有·最后 Timed Out·而服务其实一直是好的<br/>Neon 持久化 + E2B 沙盒 + 会话密钥随蓝图下发(内部 API 靠共享密钥挡)<br/>服务间走公网地址而不是私网:Render 跨服务是 IPv4·:: 绑定 v6only 时收不到"]:::core
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
  LEGAL["✱ 五系统合法域账本 / five_system_legal.json（✱07-30补画·此前图上一直缺失）<br/>补画理由:它已经有**四个**派生消费方，是这张图里存在感最强的隐形节点——<br/>合法域此前记在四处(结构门常量·修复器本地拷贝·生成契约手写枚举串·客户端渲染器<br/>手抄版)靠人肉对齐，E37 的根因就是漏账的代价。收成单一真相源后:<br/>结构门 import · 修复器经门 re-export 自动跟随 · 生成契约由 enum_str() 渲染<br/>· 客户端构建期直读同一 JSON(vitest parity 测试锁死)<br/>✱07-30 起第五个消费方:入站判定的能力面(TJCAP)<br/>加枚举=只改 JSON;哪一方没消费到,parity 测试当场红<br/>(思想同阿里低代码引擎《物料协议》:一份物料描述·编辑器/渲染器/校验器共同消费)"]:::ledger
  VISPROMPT["☐ 提案 · 视觉线① 出图提示词由 spec 反推<br/>⚠ 这是个**新函数**·今天不存在:现有 _build_overview_sheet_facts 的入参是<br/>(design_brief, datamodel)·两个都是**五系统模型的产物**——上游版本一个都拿不到<br/>要写的是 facts_from_spec(页面清单条目) → 出图提示词"]:::propose
  VISIMG["☐ 提案 · 视觉线② 并发出图 N 张(每页一张)<br/>**代价明确**:墙钟仍 60~85s(并发)·但请求数从 1 变 N·这笔是净增·得认<br/>今天只出 1 张(仅落地页)·且那一张在下游·只能给已定的 stats/charts 化妆"]:::propose
  VISHTML["☐ 提案 · 第5步 图 → HTML【已裁决】:screenshot-to-code 原生<br/>⚠ **这一步不能省**:D 组那个 25→37 是 **HTML** 喂出来的·不是图喂出来的——<br/>runner.py 的 run_d 原文「以下是这个产品的 N 份界面 HTML·是你唯一的依据」·<br/>load_html 的 docstring 写着「图转出来的 HTML·由 screenshot-to-code 原生跑出」<br/>跳过这一步等于把唯一有实测的那条边拆了<br/>⚠ 只让它画版式与绑定·**别让它写行为逻辑**:F 组让模型现写 JS·六项通过 12/18·<br/>三份里只有 1 份全过·且失败是静默的(能点·不报错·没反应)"]:::propose
  VISDERIVE["☐ 提案 · 第6步 HTML → 实体 / 字段 / 关联关系 / 页面结构<br/>**唯一有实测撑着的一条边**:同 55 字意图·唯一差别是有没有 HTML 当输入·<br/>字段 25→37 · 区块 10→14 · 臆造 0(A/D 两组同意图·这一对是干净的)<br/>⚠ 但 D 组跑在实验台里·用的是手工 HTML + 手工 spec——**没面对**结构闸 /<br/>316 区块目录 / 权限与工作流要求。生产链上没跑过"]:::propose
  SEMLINE["☐ 提案 · 第7步 (第6步产物 + SPEC) → 权限 / 工作流 / 不变式<br/>⚠ **两个输入都要·串行在第6步之后·不是跟它并列**(2026-08-13 用户裁决·<br/>推翻了本图上一版画的「语义线与视觉线并行」——那个画法是错的):<br/>· 第6步产物给「**挂在什么上**」:真实的 entityRef / fieldRef / pageRef<br/>· SPEC 给「**该有什么规则**」:哪几类角色 · 什么审批流 · 什么约束<br/>⚠ 少了第6步产物会怎样·今天就有现场证据(act2 那轮结构闸 findings=1):<br/>invariants[reassignment_preserves_audit_context].refs: invariant ref<br/>'reassign_work_order' not found in model——**不变式引用了一个不存在的东西**<br/>⚠ 少了 SPEC 会怎样·也是实测:4 份 HTML 里「角色/权限/主管/管理员」出现 **0 次**·<br/>「成交/流失/归档/阶段」**0 次**;五组推出来的流程拓扑完全相同(5 节点 6 转移)<br/>——那是模型的行业常识·不是从画面里读到的证据<br/>⚠ 纠正一个曾经的误译:实测说的是「**光有 HTML** 推不出权限/工作流」·<br/>不是「别看 HTML」。**是相加·不是替代**"]:::propose
  SPECGAP["☐ ⚠ 读图纪律:本子图**没有任何一条对应代码**<br/>画上来是因为「有想法没接线」被误当成已生效·是这份文件反复吃过亏的那种错<br/>(V5.8 图八天渲染不出来没人发现 · 手写 uses 声明与实际渲染不符 316 个 ·<br/>ECTX ⇢ GEN5 那条边被以为通了很久)<br/>判据:这一格里任何一个节点接进主轴之前·虚线红框都不许改成实线"]:::propose
  GEN5["▲ 五系统起草 / v5_llm_generate<br/>schema契约+已装技能硬注入+业界参考软引用<br/>E29 精修上下文(增量改)·模型直供(回退)两通道<br/>✱07-30:prompt 里的哨兵词/占位字面量长得像值就会被当成值——binding=none 让<br/>模型给 QuickActionPanel 全填了 entityRef:「none」(4条门禁不过);「with slots」被读成<br/>键名让一轮 6 页排版全丢。两处都改成祈使句<br/>❖08-11 **区块清单不再是全量**:走 NARROW 挑出的 ~60 条进 prompt(≈7.4K token·<br/>此前 5.6 万)。窄化失效时自动退回全量·所以这条边**永远有货**·只是货有多有少<br/>❖08-11 每个区块条目加 `pages=`(允许的页型)·并补一句点名反例的规则句——<br/>光有字段不够:区域限制当初也有条目字段·照样反复被违反·直到补上举反例的<br/>规则句才收住。规则句还必须**给出路**(该改页的 kind·而不是硬塞区块)·<br/>不给出路的禁令会被绕过成「干脆不用那个区块」<br/>⛔08-13 标红:**系统真正的输入就是那一句话**。签名 generate_five_system_model(goal: str)<br/>没有第二个内容参数;_build_user_content(goal) 拼进去的只有:意图那 55~100 字 +<br/>已安装技能 + 按 goal 检索命中的参考语料/设计菜谱 + refine_ctx(仅二次精修)<br/>一个 LLM 调用要从一句话里同时发明 实体/字段/enum/页面/权限/工作流/不变式·<br/>还要从 316 个区块里选型。实测两轮全新话题都是第一次没过闸·attempts=2<br/>⚠ 病不在 GEN5 写得不好·在**它上游是空的**:没有任何一层在它之前把需求变厚"]:::cap
  DREPAIR["▲ 确定性修复 / v5_model_repair（零LLM·留痕）<br/>不变式refs近邻改写(唯一命中)·修不好整条剔除<br/>E37 展示层charts/stats同款处方(枚举违规剔除·非法format清除)<br/>骨架六系统不修——仍由门硬拦<br/>❖08-11 页型越界:**只记不改**(pageKindViolations)。跟 layout 槽位违规不同——<br/>那条改模型是因为槽位摆错会把页面真搞坏(PageHeader 钉在底部操作条上是实测过的)·<br/>页型摆错不影响渲染<br/>⚠ 不上闸的真正理由是**这条约束本身经不起推敲**:控住领域族之后仍有 **15 对**<br/>同域同能力的严格子集矛盾·而 pageKinds 从来没集中评审过(随每个区块被添加时手写)。<br/>拿一条可能标错的规则去硬拒模型·是把「违规发出去」换成「合规的也发不出去」"]:::core
  MGATE{"▲ 结构门 / v5_model_gate<br/>跨系统引用全解析·枚举合法域·页面范式绑定<br/>二元机械·任何悬空=拦<br/>✱07-30补两处漏:①**实体字段 type 纳入校验**——此前 FIELD_TYPES 只在技能<br/>binding 那儿用过·实体字段的 type 一路无人查(所谓「封闭合法域」只是 prompt 里<br/>的一句约定)。代价不是「写错没人说」而是**静默降级**:前端对认不出的类型一律<br/>return text，一个 file 字段会安安静静变成普通文本框——用户以为能传附件实际<br/>只能打字·不报错不提示测试全绿。②沿用该段口径「出现即校验·缺省不罚」"}:::gate
  REASK5["▲ 门裁决回喂 / gate-feedback retry (E37)<br/>findings原文喂回·有界重生成一次<br/>错哪改哪·两版都拦仍fail-closed"]:::fallback
  DOMFIX["▲ 内置演示域夹具 / builtin_domain_models (E35)<br/>采购·请假·工单·入职四域冻结过门模型·运行时零LLM<br/>★07-26:识别改词边界+强弱词分级(泛词单独不认·认不出走LLM生成·ADR-0002)<br/>产物provenance标注builtin-domain·夹具离线预增强生成主题(golden-file再生成)<br/>❖08-11 **默认关闭·从用户路径上摘掉**(SLIDERULE_DEMO_FIXTURE_ENABLED·缺省 off)<br/>⚠ 这跟 08-04 那次是**两种病**·补丁挡不住:<br/>· 08-04 认**错**域(托管请假 → 企业请假)→ _domain_fixture_fits_goal 补的是那个洞<br/>· 08-10 认**对**了域·可夹具本身已经过期。实测一道真实「客服工单系统」被认成<br/>  service_ticket·相关性尺子理直气壮放行(题和夹具确实同域)·整趟 model.generate<br/>  **0 次**·端出 2026-07 之前冻结的那份——5 个页面里连 blocks 这个键都不存在·<br/>  407 个区块一个没用上<br/>**快路径产出的正是契约自己定义为「残次交付」的那个东西**(prompt 原文:a page that<br/>ships with NO blocks renders as a bare table — that is an incomplete deliverable)<br/>纪律:**旁路的正确性不由「认没认对域」决定·还由「那份冻结品有没有过期」决定**"]:::state
  CLOSEV["▲ 闭环证据 / appbundle.runtimeClosure<br/>六段 perSkillEvidence·closureHash/stableDigest指纹<br/>modelSection纯载荷(不进指纹/信任判定)"]:::ledger
  GREL{"▲ Goal relevance / closure_relevance<br/>直接检查最终六系统 modelSection 的受控显示字段<br/>RBAC派生角色权限·monitor/dashboard派生数据看板<br/>不再只看实体名/页面名"}:::gate
  TERMINAL{"▲ 确定性终止边 / trusted_closure_decision<br/>当前turn+goalDigest模型可复用·closure非blocked·证据6/6 → END<br/>输入变化→继续·repair→仅修复<br/>命中后只跑coverage/delivery机械检查·禁止LLM planning/agentic picker"}:::gate
  FAILSAFE["▲ 闭环兜底 / fail-closed failsafe (E37)<br/>重建异常→确定性blocked闭环(CLOSURE_REBUILD_FAILED带因)<br/>空指令回落goal收口·publishClosure永不为null"]:::fallback
  APPSTAGE["▲ app 主舞台 / App Stage<br/>closed 6/6 → 右栏长出可操作应用<br/>切角色·录数据·走流程·桌面/手机/代码三视图"]:::done
end

subgraph ENRICH["10 体验层生成 / Experience Enrichment（★ 07-24 新增子图 · 过门后·装配前·全程 fail-open）"]
  direction TB
  THEME["✪ 08-03 **本节点已整体移除**（保留在图上是为了让读到 V5.7 的人知道它去哪了）<br/>全站一个颜色(用户裁决)·enrich_identity_theme 整段从 v5_capability_executor 删除<br/>_theme_palette 恒返回 BRAND_SEED·存量库里的 generatedTheme 读到即忽略·不需迁移<br/>⚠ 省掉的不只是一个函数:那一步要**花一次生图(~74s)换一个色值**·而那张图从不展示给任何人<br/>───────── 以下为 V5.7 原文 ─────────<br/>★ 身份主题生成 / enrich_identity_theme<br/>生图参照→视觉LLM取色(条件:生图key+图片parts声明·缺则纯文本取色)<br/>写回 appIdentity.generatedTheme·合格契约两端同源(identity_theme_presets.json)<br/>✧07-31修正:8套预设**不是降级为兜底·是彻底不参与配色**——色板改由种子色<br/>算出来(vendor MCU 的 HCT/TonalPalette)·_theme_palette 函数体第一行 del theme_id<br/>实测:8个合法主题id派生出的主色**只有一个值**(#5b6b7c 即 FALLBACK_SEED)<br/>appIdentity.theme 仍是 Gate 校验的合法分类值·但不再对应任何色板<br/>颜色真正的来源只剩两个:LLM 选的种子色·或 FALLBACK_SEED"]:::cap
  FREEFORM["★ FreeformInsight 内容生成 / enrich_freeform_blocks<br/>Pydantic深校验+reask(07-26:+数字必须挂dataRef·树深度/节点上限)<br/>视觉参照自校验闭环(条件:生图+E2B key+公网地址·缺则纯文字生成)<br/>chart节点→真ECharts·dataRef现算真值(数字不能编·查不到显—)<br/>07-26成本预算:参考图/截图自检每次enrich限额(env可调·超限退纯文字有日志)<br/>✧07-31:JSON 非法时**先机械修复再 reask**(json-repair)——深层嵌套树偶发数错<br/>括号层数(真机复现:{}/[] 各差1·尾巴多个孤立句号·且**不是** token 截断·<br/>那份输出结尾收得完整)·手搓括号计数容易拼出语法合法但结构错位的树<br/>✧07-31:lineHeight 裸数字曾被当倍数解释·撑爆 KPI 卡高度<br/>✪08-03 **rowsRef 取代 blockRef**:逐行能力直接给设计模型——版式它自由画·真实行数据由 rowsRef 绑(entityRef / fieldRefs / limit / order·limit 有上限防止一个 ref 把整表拉平)<br/>展开发生在**渲染期**·不是生成期(生成时树里只有一份「一行长什么样」的模板)<br/>⚠ 与 blockRef 是两个解法不是一个:前者让它**挑现成积木摆进版式**(代价:首页永远有几块不是它设计的·实测出现过禁用态按钮/8 格流程网格/右栏直接甩 seed-lending_record-10 这种种子 id)·后者让它**自己画**"]:::cap
  MONITOROV["★ 首页设计 / enrich_monitor_page_overviews<br/>monitor/首页交给FreeformInsight排版·不再永远固定骨架<br/>内容数量随领域浮动<br/>✱07-30修正:排行/动态流**不再被赶到设计之外当外挂卡**——改由设计者用<br/>blockRef 摆进自己的版式(见✱C桥)·摆哪占多宽它定·渲染仍交积木真渲染器<br/>✱07-30:一页跑参照板→桌面设计→手机设计·每页一张板<br/>✧07-31修正:是**两次或三次**——preferredDevice 明说 desktop 就不再设计手机档<br/>(省约67s/页)·判不出来或 unspecified 仍两档都生成(只在明确的时候才砍)<br/>✧07-31:monitor 页放开 page.blocks·总览不再只有数字<br/>✪08-03**方向反转**:首页由 freeform 设计**独占**——有 freeformOverview 的总览页·<br/>脚手架/固定榜/流全部让位(freeformOwnsPage)·page.blocks 在这类页面不再渲染<br/>⚠ 只在后端关是不够的:摆不进设计树的积木会掉到设计区**外面**照样画·渲染端必须同时收口<br/>✪08-03 生图**全系统只给落地页一张**(开关=有没有配生图 key·不新增环境变量)·<br/>所以这里不再是「一页跑两次或三次」·参照板这一步整个应用只走一次"]:::cap
  MONITORDEFER["★ 08-05关键路径收口<br/>同步只设计landingPageRef（缺失时首个合格总览页）<br/>其他dashboard保留stats/charts标准骨架并标记deferred<br/>已有freeformOverview幂等复用·按需打开时再增强"]:::cap
  VISBUDGET{"★ 视觉准入预算 / SLIDERULE_RUN_BUDGET_SECONDS<br/>默认540s·为10分钟目标预留60s落库/闭环缓冲<br/>阶段启动前按长尾保守值检查剩余时间<br/>不足→deferred_budget+skippedReason=deadline<br/>仅视觉fail-open·业务模型/RBAC/workflow不降级"}:::gate
  BLOCKCAT["★ 体验区块目录 / experience_block_catalog<br/>单一真相源(同一JSON跨语言直读):类型·槽位·binding·标签·样式·图标正则/别名<br/>07-26修正:约束链=Gate浅校验(designBrief)+生成时Pydantic深校验+前端再校验<br/>(Gate不看freeform内容树·有意分工见代码注释)<br/>❖08-11 **v8 → v407 → v350 → v316**(版本号跟区块数走·末一步是去重)·条目新增:generality(通用度·窄化加成用)·<br/>label(中文名进真相源·此前只活在 block-registry.tsx·Python 侧读不到)·<br/>rendererKey/rendererStatus·regionsRationale<br/>❖ 同名 FieldRef 的类型契约统一(fieldRefTypeConflicts 自检)<br/>❖ pageKinds 现在**三方消费**:选材(block_assembler/预设派生) · 提示词条目 pages= ·<br/>修复器观测。⚠ **仍无门禁**——见 MGATE 与文末缺口<br/>✪08-03 **freeformEmbeddable 字段整个删除**(catalog v7 → v8)——那是给 blockRef 挑积木用的白名单·rowsRef 上来之后它存在的唯一理由没了<br/>schema_legal 派生常量 / Pydantic 校验 / prompt 文案 / 前端渲染·四处同步消失(改目录一处的老规矩)"]:::ledger
  SAFEREND["★ 前端安全渲染器 / block-registry（纵深防御第二道）<br/>只React.createElement·绝不dangerouslySetInnerHTML/eval<br/>图标按名动态解析任意antd(hasOwnProperty挡原型链)·dataRef现算·白名单再校验<br/>07-26:+渲染预算(深度/节点上限截断降级)·AppStageErrorBoundary兜渲染异常<br/>✱07-30:五个占位区块**接真渲染器**并放开生成(MetricGrid/TrendChart/RankedList/<br/>ActivityFeed/DataTable)·全部换 antd 现成组件(Card/Empty/Timeline/List+Progress/<br/>Table)·颜色走**主题token**不再写死十六进制(此前琥珀色应用里动态流圆点是靛蓝)<br/>表头出中文显示名·枚举列出标签(不再是 lot_code / frozen)<br/>ActivityFeed 宽行档 variant=row+detailFieldRefs(列宽靠 colgroup 对齐)<br/>✪08-03 加 rowsRef 展开:渲染期按 entityRef 取真实行·每行套设计模型给的那份模板(仍然只走 createElement 白名单·安全边界一点没放宽)"]:::trust
  OWNER["✱ KPI/图表归属划分（方案 C · 渲染层双向硬隔离）<br/>总览页(monitor/dashboard)走 page.stats/page.charts·由 ENRICH 重新设计版式<br/>业务页走 MetricGrid/TrendChart 积木<br/>同一个指标不会被画两遍·绑页面主实体的 DataTable 区块直接摘掉<br/>(那一页本来就自带一张带中文列名/彩色状态标签/排序筛选/行内操作的表)<br/>✱KPI 卡三层:大数字 + 环比 + 卡底迷你走势线(对标 pro-components StatisticCard)<br/>dataRef 加 trendFieldRef+trendGrain·一个字段驱动两层(本来就靠同一份时间分桶)<br/>不撒谎边界:前期0→「较上期 —」不编+∞ · 单桶不出线 · &lt;0.5%直说持平<br/>· 回传 series.grain 而非入参(桶太多自动变粗后配「较前一日」就是错文案)<br/>· 主数字算不出(显—)时整个不挂(用图形给不存在的数字背书更糟)"]:::cap
  APPSTORE["★ App Store 入库 / app_store.save_app（07-26补画·此前图上缺失）<br/>过门+增强完的设计模型持久化·fail-open·dedup_key去重·组建库地基<br/>✱07-30修正:降级从三级改**四级**——远端TCP → 远端SQL over HTTP →<br/>**本地SQLite** → 本地JSON。前两级是同一个远端库的两条通道(受限网络只放行<br/>443 时自动改走HTTP·数据不分叉)·第三级才是本地库<br/>此前远端一挂直接掉到最弱的JSON(整文件读写·无索引无事务·崩在写一半留半个文件)<br/>没配远端连接串时也走SQLite——没有远端不代表就该退到最弱那档<br/>✪08-03 入库时**带上归属**:owner_id 来自推演路由塞进 contextvar 的当前用户·拿不到就落无主(语义见 ✪A OWNERSHIP)·**不能为了拿归属而让闭环失败**"]:::ledger
  DEVSHELL["★ 设备壳+视觉刻度 / device shell & design tokens<br/>桌面/手机按preferredDevice切换·平板范式代码保留已下架(ADR-0001)<br/>design-token间距/圆角接antd(阴影档定义未消费)·grid-compact压实(react-grid-layout核心·MIT)<br/>layout 5槽位·designRecipe<br/>✱07-30:手机档整层换 antd-mobile(不再套PC组件)·按pageKind出骨架<br/>(dashboard/monitor/wizard/kanban/calendar)·中文locale·NavBar/Calendar/Collapse<br/>·TabBar行数徽标走主题色(默认红是「未读/紧急」的意思·这里表达的是「本页12行数据」)<br/>✪08-03 手机档渲染画布改 **9:16**(405x720)·与出图画布同比——出图侧早就是 720x1280·渲染侧不是<br/>横向空间本来就紧·所以是**加宽**不是压扁(390x844 → 405x720)"]:::core
  PALGUARD["✱ 色板合规机械校验 / palette_guard（接在 reask 环里）<br/>色板约束原本只写在 prompt 里·真跑下来模型一字不差地干它被警告过的事<br/>(橘色应用主色一次没出现·蓝占六成·还自己发明色板外的绿)<br/>两条规则都在 OKLCh 里判(HSL 色相感知不均匀·转换走 coloraide 不手搓矩阵)<br/>R1 色相落在色板某色相 ±25° 内(只比色相不比ΔE·prompt 允许深浅变体)<br/>R2 主色系用量不低于任何其他单一色相族·近中性色 chroma&lt;0.04 豁免<br/>违规先带具体偏差重问·重试耗尽机械纠偏(**只旋色相保 L/C**·明暗是设计意图)<br/>**只纠 R1·配色问题绝不抛错**(抛了调用方就回落固定骨架·那正是这条链路在治的病)"]:::trust
  SHEET["✧ 首页参照板 / _build_overview_sheet_prompt（设计 LLM 照着它排版）<br/>✧07-31修正:**不再是三区**——「样式风格」区已拿掉(整张画布只画真实版式)·<br/>明说设备档时也不再多画另一档(白画一块后面根本不用·还挤占真正要用那档的画布)<br/>✧07-31修正:两档**各出一张**·尺寸按档位拆开(桌面1280x720/手机720x1280)<br/>⚠ 认不认 size 参数是**端点相关行为**:当前端点(api.xiaoleai.team)逐像素认·<br/>上一家完全不认(十个尺寸组合全回1672x941·形状只由提示词决定)——换端点必须<br/>拿 scripts/overview_sheet_probe.py 整份重测·别拿旧端点测出的白名单当常量<br/>✧07-31:prompt 改**两段式**——事实清单(画布/档位/内容范围/色板/真实字段·<br/>一条做法都不给) + LLM 按这一个系统现写出图提示词(版式/占位写法它定)<br/>拿确定性换多样性:原来那五段常量对每个应用说同一句话(两个完全不同业务的<br/>提示词逐字相同87%)·代价是改写 LLM 漏掉哪条·那张图就复发对应老 bug<br/>降分辨率必须**同步降密度**——不是像素总数不够·是每个元素分到的像素不够<br/>画面里不许出现 JSON/字段id/blockRef 等技术标识(brief 是照抄进 prompt 的)<br/>⚠ 图上的数字与条目数是**占位假象**:实测参照板画了9个快捷操作·而模型里<br/>actions 只有2条;画了6步流程·而 workflow 只有5个节点。它是版式参照不是数据源<br/>✪08-03 端点换第三家:api.gpt.ge(逐像素认 size·1280x720 / 720x1280 实测精确返回)<br/>⚠「换端点必须整份重测」这条 V5.7 写过·这次正是它救了场——别拿旧端点的结论当常量<br/>✪08-03 blockRef 那批**视觉描述随通道一起停了**:参照板不该承诺真实渲染兑现不了的东西·<br/>代价是画面内容从 9 块降到 5 块(3 KPI + 2 图表)·实测明显变稀<br/>⚠ 07-31 改两段式时·「占位写成看得见的文字·不许用灰条/色块/留空」和「信息层级必须画满」<br/>两条常量**没进改写系统提示词**·只活在区块级参照图那边(freeform_block.py:1224)——<br/>V5.7 ✧4 预言的「改写 LLM 漏掉哪条就复发哪个老 bug」已经兑现(实测灰条复发)<br/>⛔08-13 标红:**图挂在模型下游·明令不许决定内容**。出图提示词由<br/>_monitor_overview_design_brief(page, datamodel, audience=image) 反推·<br/>那份 brief 的口径写在自己 docstring 里:拿这一页**已经声明、已经过 Gate 的**<br/>stats/charts 当必须覆盖的清单·「只负责这批内容的视觉设计·不负责决定该不该有」<br/>⚠ 所以图没有任何合法途径去加一个字段/加一个实体/改一次信息架构<br/>⚠ 同一段 docstring 另一条:**故意不把 rankings/feeds 塞进清单**——参照图从来<br/>不被允许画列表。今天实测的「自由树只落 monitor/dashboard 页 · rowsRef 6 轮里<br/>4 轮靠机械修复救回来 · actionRef 只有 3/6」全发生在这块不许画的区域:<br/>**设计模型在这里是没有参照的**。图管版式·而列表全是内容"]:::cap
  OVDEV["✱ 首页版式按设备分档 / freeformOverview = &#123;root, mobile?:&#123;root&#125;&#125;<br/>此前只有 PC 首页是 AI 规划的·手机首页仍是固定骨架把组件堆在最上方<br/>现在两档**各设计一版**(不是把桌面版式用 CSS 挤窄)·手机档固定骨架自动让位<br/>取值规则借 react-grid-layout 的 layouts=&#123;&#123;lg,md,sm&#125;&#125; +「本档没有就回退更大一档」<br/>实测:桌面出两排三列横排·手机一个三列横排都没有·通篇单列<br/>✧07-31:档位切换器**只列真有设计的档**·没设计过的不给入口(点进去是空的<br/>比没有入口更糟)·单档时那个按钮不能收起来(原注释写反了)"]:::cap
end

subgraph BLOCKSUP["10.1 区块供给侧 / Block Supply（❖ 08-11 新增子图 · 此前图上只有 BLOCKCAT 一个孤点）"]
  direction TB
  BASECOMP["❖ 基础组件库 / base-components（**218 个** · 四档）<br/>V5.8 时代这一层在图上**根本不存在**——区块的 impl 是一句散文<br/>antd(通用) / antd-mobile(手机档) / ProComponents(117 个·装着一直没用) /<br/>**自研**(CodeMirror·react-markdown·xlsx·canvas 签名板)<br/>⚠ 自研这一档**零新依赖**:先把装着没用的挖干净·是这个项目吃到过三次红利的路子<br/>查 amis-ui 那 120 个组件时逐个跟 antd 对过:88 个是重的·真缺的只有 26 个·<br/>而那 26 个本身也是别人库的封装——**照着那份清单直接接原始库·不抄它的封装**<br/>(理由不是许可证·是主题:amis 每个组件被 themeable() 包着走自己 SCSS 变量体系·<br/>拿一个就得拖 amis-core 整套构建·视觉会分裂成两套)"]:::cap
  BLOCKGROW["❖ 区块扩容 / 26 → 359 → 407 → 350 → **316**（末一步是去重·见 ❖10）<br/>V5.8 时代 23 个·问题是「没得选」;五天后 407 个·问题变成**「选不到」**<br/>手机档 385 个可渲染(PhoneExperienceBlock)<br/>❖ 补的是**交互形态的缺位**不是数量:Cascader/TreeSelect/Transfer 三类<br/>层级选择此前整个没有(一个 buildHierarchy 工厂·带成环检测·环上节点降级为根)"]:::cap
  BLOCKDEP["❖ 区块↔基础组件依赖图 / block-component-usage.json（**从 AST 生成·不写手**）<br/>⚠ 曾经是手写声明 `uses:[...]`·**整个删掉了**——316 个区块与实际渲染不符<br/>(84 条声称了没渲染 · 974 条渲染了没声称)。手写声明的问题不是「写错了」·<br/>是**没有任何一处会发现它写错**<br/>现在:scripts/generate-block-component-usage.mjs 走 typescript-symbol-graph·<br/>从 block-registry.tsx 与 PhoneExperienceBlock.tsx 的真实 import 链推<br/>纪律:**要查「这个区块用了什么」·问依赖图·不问声明**"]:::ledger
end

subgraph NARROW["10.2 目录窄化 / Catalog Narrowing（❖ 08-11 新增子图 · **本轮最重要的结构**）"]
  direction TB
  REACH["❖ 病灶:可达性 / reachability（先量了才动手）<br/>实测 11 个真实应用一共只用到 **17 / 358** 种区块·且**没有一个来自第 52 名之后**<br/>先排除了「不是它不选·是它不合法」:拿 block_placement_problem 把 15 个告警类<br/>区块逐个在真实生成页上验过·四条判据(存在/可生成/页型允许/区域允许)全过——<br/>**是选材问题·不是合法性问题**<br/>机制:全量目录进 prompt = 一句 358 个名字的逗号串(1,864 token) + 逐块细节<br/>(53,627 token)。模型只从串首那几十个里挑<br/>⚠ 措辞纪律:这是**概率随位次陡降**·不是硬截断(并发那趟量到 2/136 次选择<br/>确实来自 52 名之后)。图上此前写过「306 个区块是死的」——那句话过头了"]:::gate
  NARROWSEL["❖ 选材 / block_narrowing.select_blocks（按题意挑 ~60 个注入·而不是全量倒进去）<br/>BM25(rank_bm25) + 意图词表 + 字段加权 + 通用度加成<br/>自适应回退:检索置信度低于阈值 → **退回全量**(零覆盖域上窄化是净负面·实测 −58%)<br/>自适应 limit:同样召回·候选少 ~20%<br/>**默认开** limit=60。依据 docs/block-narrowing-eval.md:3 覆盖域 × 2 臂 × n=6·<br/>对题件被选中 0.67 → 3.25(Mann-Whitney 单尾精确 p=0.00004)·首轮过闸率无差异<br/>(Fisher p≈0.48)·prompt 字符 160,528 → 53,298(−67%)<br/>实测效果:同一题目此前 0 个专科区块·窄化后 7 个·名次 61–328(此前上限 52)"]:::cap
  NARROWPRE["❖ 第 2 层:预设按题意派生 / derived presets<br/>第 1 层管「谁进得了候选」·第 2 层管「进了之后会不会被 PROVEN LAYOUTS 的<br/>老配方抢位」——只做第 1 层的话·工作台页仍然照老配方摆<br/>⚠ 仍未收干净(见文末缺口)"]:::cap
  NARROWOBS["❖ 静默失效的防线 / requirements + stderr + /api/health.blockNarrowing<br/>⚠ **rank-bm25 曾漏在 requirements.txt 外**·而代码对它 fail-open——<br/>照当时状态建镜像部署·窄化会**一声不吭地整个失效**·本地 pytest 还照样绿<br/>(其余用例只要返回一个合法列表就满意·全量也是合法列表)<br/>现在三头钉:依赖已声明 · 缺失打 stderr(fail-open 但不再**静默**) ·<br/>test_narrowing_dependency_declared 两头钉(装了没有 / 声明了没有)<br/>health 判据是 `effective` = **开关开着不算数·依赖也在才算数**<br/>纪律:**会静默失效的功能·健康探针里必须有它的位置**"]:::trust
end

subgraph APPTPL["10.3 应用级模板骨架 / App Template（❖ 08-11 新增子图 · 已落地但**尚未接进推演**）"]
  direction TB
  TPLDIR["❖ 链路方向:骨架是**沉淀物**·不是原料<br/>用户原话:「基础组件是燃料·区块也是技术燃料。在会话推演的时候·先区块·<br/>整个应用搞完之后·你才有骨架」<br/>所以箭头是 APPSTAGE → 抽骨架 → 库·而不是库 → 生成(那是旧模板库的方向)"]:::state
  TPLSHAPE["❖ 骨架契约 / services/app_template.py<br/>**存**:industry / name / when / pages[kind + purpose + blocks[type, region?]] /<br/>roleShape / workflowShape<br/>**不存**:实体 id · 字段 · 任何 binding · 契约(bindingSchema 在目录里) ·<br/>区块↔基础组件关系(从 AST 生成)<br/>⚠ 核心不变式 `_assert_no_bindings`(键名 entityRef/*FieldRef/*FieldRefs 一律拒):<br/>骨架一旦带上绑定就退化成旧模板库那个形态——那些绑定指向组件库的订单夹具·<br/>丢进真实话题必被结构闸 DANGLING 拦下<br/>页面里的逻辑、契约、区块↔组件的关联**每次按指令现生成**·骨架只说「该有哪几页·<br/>每页大概摆什么」"]:::ledger
  TPLEXTRACT["❖ 抽骨架 / extract_skeleton（从**生成好的应用**抽）<br/>region **可选**:真实模型多用栅格布局(grid: x/y/w/h)·那里客观上没有区域名——<br/>知道该有什么·**不假装知道摆哪**<br/>选用尺子复用 closure_relevance 的 goal_coverage(CJK bigram containment)·<br/>且默认**倒过来**:判不出来就不选(宁可不给·不给错)<br/>种子 4 份·由 4 个演示域抠出来·blocks 故意留空"]:::cap
  TPLGAP["❖ ⚠ **尚未接线**:推演路径上没有任何一处读它<br/>画在图上是因为「有代码没接线」比「没有」更容易被误当成已生效<br/>接线前提见文末缺口"]:::fallback
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
  RUNREG["▲ 后台 run 注册表 / run_registry (E25)<br/>推演与连接解耦·无人观看也跑完落库<br/>事件日志按 seq 续播(Last-Event-ID)<br/>同会话活跃 run 附着防重复·孤儿看门狗回收<br/>慢阶段SSE携带pageId/device/current/total/elapsedMs<br/>活动阶段每15s progress_heartbeat·no-store·禁代理缓冲"]:::runtime
  SEED["✱ 演示种子数据 / demo-seed（闭环产出的应用打开就有内容）<br/>此前每个实体零行·表格图表KPI全线「暂无数据」·空壳<br/>随机源 pure-rand xoroshiro128+ / uniformInt 拒绝采样(避免取模偏置)·FNV-1a<br/>同一个模型每次打开看到的示例完全一致(确定性·不是每次刷新变一批)<br/>取值按**字段语义**走词表:人名/机构/编号/产地各有出法·认不出才退「字段名+序号」<br/>钉最近两天(否则 KPI 环比四成机会全是「—」·走势线也画不出)"]:::runtime
  SEEDB["✱ 种子数据的三条边界（不许跟真实数据混淆）<br/>①每个实体只在**首次遇见**时铺一次(后续删空也不会自己长回来)<br/>②每行都带标记·界面上始终挂「示例数据 N」徽标<br/>③用户写入第一条真实数据时·该表种子**整批清掉**<br/>行数硬夹 0..500(曾因调用方把时间戳当 count 传，Array.from 1.78e12 直接 OOM)"]:::trust
end
 
subgraph IDENTITY["11 身份与权限 / Identity & Access（✪ 08-03 新增子图 · 贯穿式 · fail-closed）"]
  direction TB
  ACCOUNT["✪ 账号 / identity_store（邮箱 + 验证码 + 密码）<br/>注册要过邮箱验证码·**一个邮箱同一时刻只保留一个有效码**(put_code 主键是 email·<br/>重发天然作废旧码)——并发注册同一邮箱时后来者会顶掉先来者的码，这是对的<br/>JWT HS256·密钥 SLIDERULE_AUTH_SECRET·Cookie sliderule_token(HttpOnly·SameSite=lax)<br/>✪ Node 侧**不本地验签**：superuser/is_active 不在 token 里·改成调 /account/me 求证<br/>(server/auth/sliderule-identity.ts)·三态返回 anonymous/authenticated/unavailable"]:::trust
  TIERS{"✪ 三档权限阶梯 / access tiers<br/>匿名 = 只能看(浏览应用中心无需登录)<br/>登录 = 能推演·能复刻·能改自己的<br/>超管 = 能管所有人(/account/admin/users)<br/>⚠ 401 与 503 语义必须分开:前者是权限(fail-closed·绝不降级)·<br/>后者是服务(可降级)——混同就是 ✪4 那个 500 的来源"}:::gate
  OWNERSHIP["✪ 应用归属与可见性 / app_access<br/>owner_id 落 generated_app·谁推演出来的归谁·拿不到就落**无主**<br/>无主的存量应用:谁都可读·除超管外谁都不可写(不能为了拿归属让闭环失败)<br/>三档可见性 private / link / public·Fork **继承私有**(复刻别人的东西默认不公开)<br/>✪ 后端三档已通·前端还没有切换入口(已知缺口·见文末待办)"]:::ledger
  MIGRATE["✪ 存量迁移 / migration script（默认 dry-run）<br/>归属与可见性是后加的字段·库里已有的记录必须有个说法<br/>默认只打印不写·要写得显式加参数——这类脚本的默认值本身就是一道闸"]:::ledger
  MAILER["✪ 验证码投递 / mailer（SMTP 通用 + Resend HTTP 两条路）<br/>EMAIL_DELIVERY_MODE=console 时只打印(本地/CI 不发真信)<br/>⚠ 发信地址用**根域名**·不是 send. 子域(踩过一次·见 docs/env 两条提交)"]:::cap
  AUTHPAGE["✪ 独立登录/注册页 / MianTuanAuthPage<br/>左侧团队插画 + 主标语·右侧表单带字段标签<br/>**留了「暂不登录」出口**——浏览本来就不需要账号·把门槛立在真正需要的那一步"]:::surface
  LEGACYOUT["✪ 旧 Node/MySQL 账号体系已整套下掉 / 430a78ba<br/>⚠ 拆除顺序是重点:**替代守卫先写好再删**·/api/admin 没有一秒钟是敞着的<br/>死代码留着比删掉更危险——它会误导读代码的人·也可能哪天被误接回去"]:::fallback
end

subgraph OUT["07 输出 / Output"]
  direction TB
  APPWALL["✧ 应用中心作品墙 / AppsWorkbench（07-31 新增·此前图上整块缺失）<br/>APPSTORE 入库之后没有下文:那些应用在**哪个界面**被看见·图上一个节点都没有<br/>版式是瀑布流(masonic)·但**跨列定位器是自建的**:masonic 的 useMasonry 把每格<br/>宽度写死成全局列宽·跨列卡表达不出来;它的 useResizeObserver 又靠模块私有的<br/>elementsCache 映射 element→index·那个模块不在包的导出列表里<br/>落位规则照搬 Pinterest gestalt 的 multiColumnLayout(pinterest.com 线上同款)<br/>⚠ 择列目标**故意偏离 gestalt**:他们只按窗口空白最小择·照搬会退化——跨列卡<br/>把两列设成完全相等·「最平窗口」从此永远是这一对·实测10张全堆 left=0<br/>改成先比落位后的 top·并列再比空白(真实高度分布上每档都不劣·密集档墙高矮20%)<br/>为什么非要跨列:卡片高度=列宽/设备宽高比·三档里桌面占89%·不跨列整面墙<br/>高度是**同一个数**(实测12张里11张恰好都是234px)·换任何瀑布流库都一样<br/>跨列资格来自真实信息不是随机:只有桌面档(横向内容)·按页面数降序取前1/4<br/>✪08-03 墙上能看到什么现在**受归属与可见性约束**(见 ✪A)：匿名只读·无主存量应用谁都不可写·复刻默认私有<br/>✪08-03 缩略图 PNG → WebP·首屏 6.3MB → 0.8MB(5Mbps 冷启动 10s → 1.2s)·服务端按内容嗅探 Content-Type·不认 WebP 的客户端现场转回 PNG"]:::runtime
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
%% 五系统闭环装配：首次生成后先走确定性终止边；只有输入变化或 repair 才重入。
AWAIT -.▲ 循环落定·闭环重建必跑.-> GEN5
ECTX -.⛔ 这条边在代码里不存在:GEN5 只收 goal 字符串.-x GEN5
GEN5 --> DREPAIR
DREPAIR --> MGATE
MGATE -.▲ 拦截·裁决喂回.-> REASK5
REASK5 -.▲ 重生成.-> GEN5
MGATE ==>|▲ 过门| CLOSEV
DOMFIX -.▲ 确定性域旁路(零LLM).-> CLOSEV
GEN5 -.▲ 形状层回喂(缺段).-> SREASK
CLOSEV -.▲ 证据+指纹入账.-> T_LEDGER
CLOSEV --> GREL
GREL --> TERMINAL
TERMINAL ==>|▲ 当前模型可复用·非blocked·6/6 → END| APPSTAGE
TERMINAL -.▲ 输入变化才回规划.-> ORCH
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
VISBUDGET --> MONITOROV
MONITOROV --> MONITORDEFER
MONITOROV -.★ 增强完的模型入闭环装配.-> CLOSEV
MONITOROV -.★ 07-26补画:过门+增强模型入库(fail-open·存不进不拦发布).-> APPSTORE
THEME -.★ 任一步失败·静默降级(固定骨架/8预设·不拦闭环)·fail-open保险丝在executor调用方.-> CLOSEV
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
 
%% ===== ✱ 07-30 升版接线 =====
%% ✱A 入站判定闸门：在**所有**推演之前。注意跟 INTAKE 的分工——
%%    TRIAGE 判"这一轮该不该跑"（贵：20分钟+一次完整LLM+最多9张生图）；
%%    INTAKE 判"这条消息怎么接进状态机"。TRIAGE 不通过也照样能进 INTAKE，
%%    因为第一版**只提示不阻断**：判决只驱动提示条，发送键始终可用。
CHAT -.✱ 停打字500ms后判一次(不抢跑·太短的不判).-> TJ0
TJ0 -.✱ 没命中·交给LLM层.-> TJRULE
TJ0 ==>|✱ 命中·零成本直出判定| TJACT
TJCAP -.✱ 能力面进 prompt(判「做不做得了」的参照物).-> TJLLM
TJRULE -.✱ 按会话状态挑规则·只拼相关的.-> TJLLM
TJLLM --> TJACT
TJACT -.✱ hint·出提示条+改写按钮.-> HINTBAR
TJACT ==>|✱ proceed·什么都不显示| CHAT
HINTBAR -.✱ 点改写·回填输入框(重判后多半变 real·提示条自己消失).-> CHAT
CHAT -.✱ 用户仍可直接发送(闸门不拦).-> INTAKE
TJLLM -.✱ 判定本身出任何问题一律放行(fail-open·闸门坏了不能变成产品坏了).-> INTAKE
%% 能力面的"能表达那一半"跟结构门读同一本账 —— 这是防漂移的关键
LEGAL -.✱ 同一账本派生能力面(第五个消费方·不手抄).-> TJCAP
LEGAL -.✱ 结构门/修复器/生成契约/客户端四方同源(parity 锁死).-> MGATE
LEGAL -.✱ 枚举段由 enum_str() 渲染进契约.-> GEN5
%% 评测台是升级成硬拦的唯一依据（误拦真需求必须为 0）
TJACT -.✱ 判决样本.-> TJEVAL
TJEVAL -.✱ 误拦为0才考虑开 blocking 开关.-> TJACT

%% ✱B 演示种子数据：闭环产出的应用侧，跟推演链路无关（纯前端运行时）
APPSTAGE -.✱ 首次遇见该实体·铺一批示例行.-> SEED
SEED -.✱ 三条边界约束它不跟真实数据混淆.-> SEEDB
SEEDB -.✱ 用户写入第一条真实数据·该表种子整批清掉.-> APPSTAGE
SEED -.✱ 表格/图表/KPI 有数可算(否则全线「暂无数据」).-> SAFEREND

%% ✱C blockRef 桥：freeform 设计 ↔ 区块注册表
%%    此前逐行内容画不了就被赶到设计之外当外挂卡，首页=AI设计区+两张外挂卡，
%%    主次和留白都由不得设计者。现在设计里挂 blockRef：位置和宽度归设计者，
%%    渲染归积木自己的真渲染器（ExperienceBlockBoundary）。
FREEFORM -.✱C 版式里挂 blockRef(binding 照抄·摆哪占多宽由它定).-> SAFEREND
BLOCKCAT -.✱C 可嵌积木清单进 prompt.-> FREEFORM
OWNER -.✱ 按页面类型分归属·渲染层双向硬隔离(同一指标不画两遍).-> SAFEREND

%% ✱4 色板机械校验接在 reask 环里，不是新起一段
FREEFORM -.✱ 候选色板送检.-> PALGUARD
PALGUARD -.✱ 违规·带具体偏差重问.-> FREEFORM
PALGUARD ==>|✱ 重试耗尽·机械纠偏后放行（绝不抛错）| MONITOROV
THEME -.✱ 色板判据来自身份主题.-> PALGUARD

%% ✱6 首页两档设计：先出一张参照板定调，两档照同一张图设计
MONITOROV -.✱ 每页先出一张三区参照板.-> SHEET
SHEET -.✱ 生图.-> C_VISGEN
SHEET ==>|✱ 同一张板喂两档（保证同色同调）| OVDEV
OVDEV -.✱ 桌面档 root + 手机档 mobile·root 一起写回.-> MONITOROV
OVDEV -.✱ 手机档有自己的版式·固定骨架让位.-> DEVSHELL


%% ===== ✪ 08-03 身份与权限（贯穿式：入口一道、写操作一道、看见什么一道）=====
AUTHPAGE ==> ACCOUNT
ACCOUNT ==> TIERS
MAILER -.验证码.-> ACCOUNT
LEGACYOUT -.被 ACCOUNT 整套取代.-> ACCOUNT
%% 入口闸：匿名可以看，但推演/复刻这类写操作必须先过 TIERS
CHAT -.✪ 发送前过权限闸.-> TIERS
TIERS -."✪ 401 = 权限失败·fail-closed<br/>不重试·不降级·不回落本地引擎<br/>(本地重跑同样绕不过登录)·把后端那句人话原样带回".-> BOARD
%% 归属：闭环落库时把 owner_id 一起写进去
TIERS ==> OWNERSHIP
OWNERSHIP ==> APPSTORE
MIGRATE -.给存量记录补归属/可见性.-> OWNERSHIP
%% 看见什么：墙上的可见范围由归属和可见性决定
OWNERSHIP ==> APPWALL

%% ===== ❖ 08-11 升版接线 =====
%% ❖A 供给侧三层：基础组件（燃料）→ 区块（技术燃料）→ 目录（真相源）。
%%    这条链此前图上只画了 BLOCKCAT 一个点，等于说不清「区块是拿什么搭的」。
BASECOMP ==>|❖ 218 个基础组件搭出区块| BLOCKGROW
BLOCKGROW ==>|❖ 316 条进真相源| BLOCKCAT
BLOCKGROW -.❖ 真实 import 链走 AST 反推.-> BLOCKDEP
BLOCKDEP -.❖ 要查「区块用了什么」问这里·不问声明.-> BLOCKCAT
BASECOMP -.❖ 渲染器实际渲染的就是这些组件.-> SAFEREND
%% ❖B 窄化夹在目录与起草之间：这是本轮唯一改了主轴形状的结构。
%%    ⚠ 读图要点：REACH 是**病灶**不是模块——它是一次测量，画上来是因为
%%    「为什么要窄化」比「窄化怎么实现」更容易被后人改丢。
BLOCKCAT ==>|❖ 全量 316| NARROWSEL
REACH -.❖ 病灶:只用到 17/358·无一来自 52 名之后.-> NARROWSEL
NARROWSEL ==>|"❖ 按题意挑 ~60 条注入(≈7.4K token)"| GEN5
NARROWSEL -.❖ 置信度低于阈值→退回全量(零覆盖域上窄化是净负面).-> BLOCKCAT
NARROWSEL --> NARROWPRE
NARROWPRE -.❖ 第2层:防 PROVEN LAYOUTS 老配方抢位.-> GEN5
NARROWOBS -.❖ effective=开关∧依赖·health 里看得见.-> NARROWSEL
%% ❖C 页型：先告知（提示词），再观测（修复器），暂不上闸（MGATE 无边）。
%%    这三段的分工要连起来读，缺任一段都会把「阶段性不上闸」误读成「忘了做」。
BLOCKCAT -.❖ 每条带 pages=(允许的页型)+一句举反例的规则句.-> GEN5
DREPAIR -.❖ 越界只记不改·pageKindViolations.-> CLOSEV
%% ❖D 骨架的方向是**反的**：从做好的应用里抽，不是拿它去生成。接线尚缺。
APPSTAGE -.❖ 从生成好的应用抽骨架.-> TPLEXTRACT
TPLEXTRACT --> TPLSHAPE
TPLDIR -.❖ 骨架是沉淀物不是原料.-> TPLSHAPE
TPLSHAPE -.❖ ⚠ 尚未接线:推演路径没有任何一处读它.-> TPLGAP
%% ❖E 演示域旁路默认关闭后，主轴上不再有「零 LLM 直达闭环」这条常态路径。
DOMFIX -.❖ 默认关闭(SLIDERULE_DEMO_FIXTURE_ENABLED)·常态走 GEN5.-> GEN5

%% ===== ☐ 08-13 提案接线（**全部未实施**·节点用虚线红框标着）=====
%%  ⚠ 上一版把这八步做成了一个独立子图 SPECFIRST，结果 dagre 把那个 cluster 扔到
%%  画布角落，看着像挂在系统旁边的一个附件——**而它本来就是**：一个自带边界的
%%  盒子，无论摆哪都读作「旁边那块」。现在拆开了，每个节点放进它真正所属的层：
%%      SPECSRC / SPECREAL      → POOL，紧贴 C_TREE（它就是取代 C_TREE 的那个能力）
%%      VISPROMPT…SEMLINE       → CLOSURE，排在 GEN5 之前（产物直接进 GEN5）
%%  并且新链路走**粗实线**（==>），跟主轴同级——dagre 按边定秩，细虚线排不进主流。
%%  「还没实现」这件事由**节点的虚线红框**承担，不由位置承担：位置说的是它该在哪，
%%  边框说的是它还不存在。两件事分开表达，才不会为了标清楚没实现而把它画到边上去。
%%  ⚠ 第1步（澄清需求/定位缺口/外部证据）用的是**现成能力**，图上本来就有，不新增节点。
C_GAP ==>|"☐ 第1步产物：澄清后的需求"| SPECSRC
C_EVID ==>|"☐ 第1步产物：外部证据"| SPECSRC
SPECSRC ==>|"☐ 第2步"| SPECREAL
C_TREE -.☐ 第2步**整个取代**这一步(⛔2 那份 f-string 占位·无下游消费).-x SPECREAL
SPECREAL ==>|"☐ 第3步：按页面清单逐页"| VISPROMPT
VISPROMPT ==>|"☐ 第4步"| VISIMG
VISIMG ==>|"☐ 第5步：screenshot-to-code"| VISHTML
VISHTML ==>|"☐ 第6步"| VISDERIVE
%%  第7步两个输入：结构给「挂在什么上」，SPEC 给「该有什么规则」。缺任一个都塌，
%%  两侧各有实测（见 SEMLINE 节点标签里那两条）。
VISDERIVE ==>|"☐ 第7步输入①：结构先出来才有东西可挂"| SEMLINE
SPECREAL ==>|"☐ 第7步输入②：规则从这来·HTML 上一个字都没有"| SEMLINE
%%  第8步：两股产物汇进 GEN5。GEN5 本身不动，动的是喂给它什么——
%%  今天它只收一个 goal 字符串（⛔1），改后收结构 + 规则，签名与 prompt 装配要重写。
VISDERIVE ==>|"☐ 第8步：实体/字段/关联/页面结构"| GEN5
SEMLINE ==>|"☐ 第8步：权限/工作流/不变式"| GEN5
%%  同一张图用两次：上游当证据推结构，下游当版式参照给设计段。
%%  ⚠ 这条边同时关掉 ⛔4 那个洞——上游那张图是照 spec 画的，spec 里写着
%%  「今日待跟进列表」图上就有列表，设计段第一次在列表区拿到参照。
VISIMG -.☐ 同一张图复用为版式参照·设计段不再重新生图.-> MONITOROV
SHEET -.☐ 这条下游出图路被 VISIMG 取代(⛔4).-x VISIMG
SPECREAL -.- SPECGAP

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
%% 符号: ☐ = 08-13 提案(未实施·虚线红框) ; ⛔ = 08-13 标红(现状形状问题·实线粗红) ; ❖ = 08-11 升版 ; ✪ = 08-03 升版 ; ✧ = 07-31 升版 ; ✱ = 07-30 升版 ; ✦ = 07-26 审查修复升版 ; ★ = 07-24 体验层升版 ; ▲ = 07-17 升版 ; ■ = V5.3 新增/修订 ; ◆ = V5.2 新增/外环 ; ● = Ux 修订 ; 虚线 = 跨层或待补
%% ✱ 07-30 产品主轴的变化（三处新结构改了主轴的形状，不只是加节点）：
%%   ① 主轴**多了一个前置闸门**：SURF 一句话 → TRIAGE 入站判定（六态·能力面来自
%%      合法域账本）→ 只提示不阻断 → 才进 CORE。此前任何输入都直接烧 20 分钟。
%%      ⚠ TRIAGE ≠ INTAKE：前者判「这一轮该不该跑」，后者判「这条消息怎么接进
%%      状态机」，两者同名不同物，读图时别合并。
%%   ② ENRICH 的首页那一段**从一次变三次**：参照板 → 桌面设计 → 手机设计。
%%      两档版式出自同一张三区参照板（同色同调），freeformOverview 带 mobile 分支。
%%      逐行内容不再被赶出设计当外挂卡——改由设计者用 blockRef 摆进自己的版式。
%%   ③ APPSTAGE 之后**多了一层种子数据**：闭环产出的应用打开即有内容可看，
%%      三条边界保证它不跟真实数据混淆（首次一次·带标记·真数据一到整批清）。
%%      这一层纯前端运行时，跟推演链路无关，是「拿到的东西能不能看」那一环。
%%   另有一条一直缺的节点这次补上：LEGAL（five_system_legal.json）——它已经有
%%   五个派生消费方（结构门/修复器/生成契约/客户端渲染器/入站能力面），是这张
%%   图里存在感最强的隐形节点，此前只在 ✦4「SSOT 收编」的文字里提过，没有节点。
%% ★ 升版后的产品主轴（07-26 修正：主轴有一条演示域旁路，不是所有路径都过体验层）：
%%   新颖意图：SURF 一句话/附件 → CORE 推演循环(APICK 默认开·ECTX 装箱)
%%   → CLOSURE 五系统起草→确定性修复→结构门→回喂
%%   → ENRICH 体验层生成(过门后·装配前·fail-open：身份主题→FreeformInsight区块→首页设计→App Store入库)
%%   → CLOSURE 闭环装配(证据 6/6) → APPSTAGE 应用接管右栏(安全渲染器×设备壳)
%%   演示域意图(采购/请假/工单/入职·词边界+强弱词识别·ADR-0002)：走 DOMFIX 冻结夹具旁路，
%%   零 LLM 直达闭环——运行时跳过 ENRICH 整层与 App Store 入库；夹具的生成主题由离线
%%   再生成脚本(scripts/enrich_builtin_domain_models.py)预增强后冻结进 JSON（golden-file 套路）。
%%   两条纪律并存：闭环装配 fail-closed(任一环失败→blocked 闭环+人话 blocker，publishClosure 永不为 null)；
%%   体验层增强 fail-open(任一步失败→固定骨架/8 预设兜底，绝不拦闭环发布；
%%   保险丝实现在 v5_capability_executor 调用方的 try/except，不是 ENRICH 节点自身属性)
%% 建议: Mermaid 渲染时使用 "View as code" 或折叠外容器以减少交叉边 spaghetti；或拆分为 "核心脊柱" + "V5.2 delta" 两个图

%% ✪ 08-03 产品主轴的变化（这一轮改的是地基，不只是加节点）：
%%   ① 主轴**多了一条贯穿式的归属线**，它不在某一层里，而是横穿三处：
%%      入口（写操作前过权限闸）→ 落库（闭环时写 owner_id）→ 展示（墙上看得见什么）。
%%      读图时别把 IDENTITY 当成"又一个子图"，它是一条线不是一个块。
%%   ② ENRICH 的首页那一段**从三次回到一次**：V5.7 时代是 参照板 → 桌面设计 → 手机设计，
%%      每个 monitor/dashboard 页各一张板、上限 4 张、外加主题图一张。现在整个应用
%%      只生**落地页那一张**，主题那张随 THEME 节点一起消失。
%%   ③ 首页从"AI 设计区 + 几块固定积木"变成**AI 独占**：blockRef 通道删除，
%%      逐行能力由 rowsRef 直接给设计模型。渲染端 freeformOwnsPage 同步收口。
%% ✪ 08-03 已知缺口（写在图上，免得当成没人看见）：
%%   · 可见性三档后端已通，**前端没有切换入口**——用户改不了自己应用的可见性。
%%   · 无主的存量应用没有"认领"流程（migration 只补了字段，没有把它们交还给人）。
%%   · 首页设计版面溢出画布：790px → 119b7e4f 后 207px，根子是设计侧没有高度预算，
%%     rowsRef 上线后需重测。
%%   · 首页参照板质量下滑（三因，见文件头 ✪ 已知未修）。
%%   · 线上跑的仍是 08-03 09:35 之前的版本，本轮改动尚未部署。
%% ▲ 08-05 收敛与性能修正（真实餐饮巡检轮 18m14s 后落地）：
%%   ① 可信 runtimeClosure 命中当前 turn+goalDigest 后走 TERMINAL 确定性 END；不再让
%%      planning/agentic picker 决定是否重复同一闭环。输入变化或明确 repair 才重入。
%%   ② goal relevance 直接读最终六系统 modelSection；runtimePhase=done 的必要条件包含
%%      publishClosure.blocked=false，blocked 闭环只能 awaiting/repair，两个状态不再打架。
%%   ③ 同步视觉只做落地页；额外 dashboard 标记 deferred，退出主交付链路。540 秒视觉
%%      准入预算不足时保留标准骨架并 fail-open，业务模型、RBAC、workflow 不降级。
%%   ④ SSE 慢阶段带 pageId/device/current/total/elapsedMs，并每 15 秒发活动阶段心跳。

%% ❖ 08-11 产品主轴的变化（这一轮**瓶颈换了位置**，不只是加节点）：
%%   ① 主轴在「目录 → 起草」之间**插进了选材这一层**（BLOCKCAT → NARROW → GEN5）。
%%      V5.8 时代区块 23 个，全量倒进 prompt 是对的；407 个之后它成了病灶——
%%      实测 11 个真实应用只用到 17 种，无一来自名单第 52 名之后。
%%      ⚠ 读图别把 NARROW 当成"优化"：不插它，新增的 384 个区块**在产物里等于不存在**。
%%   ② 供给侧从一个点变成**三层**：基础组件 218（V5.8 时图上没有这一层）→ 区块 407
%%      → 依赖图（AST 生成）。手写的 `uses` 声明整个删掉了——316 个区块与实际渲染不符，
%%      而**没有任何一处会发现它写错**，这是删它的理由，不是"顺手清理"。
%%   ③ 演示域旁路**从用户路径上摘掉**（默认关）。主轴上因此不再有"零 LLM 直达闭环"
%%      这条常态路径；DOMFIX 仍在图上，是因为它开关一开就回来，且它踩的两种病值得留着。
%%   ④ 多了一条**方向相反**的支线：APPSTAGE → 抽骨架 → 模板库。旧模板库是
%%      "库 → 生成"，这条是"生成 → 库"。⚠ 它**尚未接线**，画上来正是为了不让人以为已生效。
%% ❖ 08-11 已知缺口（写在图上，免得当成没人看见）：
%%   · 应用级骨架**没接进推演**：services/app_template.py 有代码、有 49 条用例、有 4 份种子，
%%     但生成链路上没有任何一处读它。接线前提是先想清楚"骨架与窄化谁先谁后"。
%%   · pageKinds **还剩 15 对**同域同能力的严格子集矛盾（棘轮见
%%     tests/test_page_kind_consistency_ratchet.py）。清零之前不上闸——现在是
%%     "提示词说 + 修复器记 + 门不拦"的阶段性状态，改这个状态前先读那个文件的头注。
%%     已按 docs/page-kinds-widening-proposal.md 的 A 档放宽 8 个（只沿 workbench/dashboard
%%     两个通用工作面），允许 workbench 的从 304 → 309/359。
%%     ⚠ 实测口径要诚实：补完提示词后跑 5 趟，违规率 3.4%，其中 3 趟干净、1 趟 2 处越界。
%%     n=1 那次得出的"三条判据全过了"是运气，不是结论。
%%   · 窄化第 2 层（预设按题意派生）**未收干净**：工作台页仍能看到 PROVEN LAYOUTS
%%     老配方抢位。
%%   · 自研组件里 SignaturePad / ExcelExportButton **还没有区块用它们**（做出来了没安家）。
%%   · 成本计量是**虚构的**：estimatedTokens = len(content)//4，只算输出、中文欠计约 4 倍；
%%     且 LLM_UNLIMITED_MODELS 会让 Node 侧整个跳过记账，maxTokensPerSession=500_000
%%     从来没有触发过。⚠ 任何拿这个数做的预算推算都不成立。
%%   · **没有视频生成能力**（一处都没有）；生图是 fail-closed 且 .env 里未配置。
%%   · 会话创建路由收到字符串 goal 时返回 500 而不是 400（要 {"goal":{"text":...}}）。

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

%% ⛔ 08-13 标红。**必须定义在所有 classDef 之后**：mermaid 的 classDef 生成的是
%%   同优先级 CSS 规则，靠书写顺序决胜负——写在 cap 前面的话粗红边会被 cap 的
%%   紫边盖掉，图上什么都看不出来。
%%   用 class 语句叠加而不是把 :::cap 改成 :::redflag：这三个节点的层色（cap=能力）
%%   是信息，不该为了标红丢掉；两个 class 同时挂在节点上，红边只覆盖描边。
classDef redflag fill:#fee2e2,stroke:#dc2626,stroke-width:4px,color:#7f1d1d
class C_TREE,GEN5,SHEET redflag

%% ☐ 08-13 提案层。**必须跟 redflag 长得不一样**：redflag 标的是「现状里真实
%%   存在、但形状有问题」的东西；propose 标的是「还不存在」的东西。两者都红，
%%   但 propose 是**虚线**边——实线会让人以为它已经在跑了，而
%%   「照着一个不存在的结构去理解系统，比不知道它存在更糟」是这份文件的头一条纪律。
%%   接进主轴之前，这些框不许改成实线。
classDef propose fill:#fff1f2,stroke:#dc2626,stroke-width:2.5px,stroke-dasharray:6 4,color:#7f1d1d
