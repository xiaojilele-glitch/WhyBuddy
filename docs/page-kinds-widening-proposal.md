# `pageKinds` 放宽提案（A 档 + B 档 monitor 那批**已执行**）

2026-08-11。承接 `84a6fe1` 的核实结论：`pageKinds` 里有 25 对同域同能力的严格子集
矛盾，所以页型限制现在不能上门禁。本文件给出把那个数降下去的**具体改动清单**。

进度：

| 批次 | 结论 | 矛盾对数 |
|---|---|---|
| A 档（通用工作面） | 执行 8 个（`HeaderEntitySummary` 那条被否掉） | 25 → **15** |
| B 档 · monitor 那 6 个 | **4 放宽 + 2 收窄兄弟**，并把总览页禁令改成机械判据 | 15 → **9** |
| filter 区块收口 | 23 个 filter 区块剥掉 `monitor`/`dashboard`，三处判据同源 | 9（判据外） |
| B 档 · 其余 9 对 | **一个都没放宽**：6 对是判据的假阳性，3 对写明理由 | 9 → 精判据 **3**，其中未写理由 **0** |

改这份数据会影响组件库的页型筛选与计数（`ComponentsLibraryPage.tsx` 3977 / 4132 行）。

> **原来那条解锁条件（"矛盾降到 0 就可以上门禁"）不成立。** 量出来才看清：加了
> 区域维度之后，358 个通电区块里有"可比对象"的只有 **41 个**，判据只覆盖 11%。
> 把这 11% 清成 0，对剩下 317 个手写声明对不对一个字都没说。解锁条件已换成
> **"pageKinds 得有一份能重算的推导依据"**——仓库里 `generality` 有
> `scripts/label_block_generality.py`，`pageKinds` 从来没有。
>
> **那份依据已经补上了**（`scripts/label_block_page_kinds.py` +
> `tests/test_page_kind_derivation.py`），而它给出的答案是**不该上闸**——
> 见下面「推导脚本」一节。

## 判据：只沿「通用工作面」放宽，不伸进形状专属页型

23 个区块在机械对齐下都会被放宽，但**机械对齐是错的**。分档依据：

- **workbench / dashboard 是通用工作面**：任何"摘要 / 筛选 / 表单 / 操作页头"这类
  通用形状的区块都可能出现在上面。目录里 304/359（85%）允许 workbench，
  少数被排除的没有可辩护的理由——这正是矛盾的来源。
- **calendar / kanban / wizard 是形状专属页型**：这几种页有一个**主视图**
  （日历 / 看板 / 分步表单），区块在上面是受形状约束的。往这些页型上加区块是另一
  类主张，不能靠"兄弟允许"就推过去。
- **monitor 单独看**：它是总览页，但有自己的通道纪律（stats/charts 归 page.stats /
  page.charts，版面归 freeformOverview 现场设计）。往 monitor 加区块要单独议
  ——已议，见下面「B 档 monitor 那 6 个的定调」。答案不是一句"能"或"不能"：
  **操作类能，筛选类不能**，判据是那个事件在总览页够不够得到东西。

严格子集判据本身已经足够保守：`ReleaseCalendar(calendar,monitor)` 与
`ReleaseTrainBoard(kanban,monitor)` 都**没有**进清单——它们与兄弟互不包含，判据自动
放过了这类"窄得有道理"的声明。

## A 档：已执行（8 个区块，只加 workbench / dashboard）

矛盾对数 **25 → 15**。表里前 8 行已落到
`services/data/experience_block_catalog.json`；第 9 行 `HeaderEntitySummary`
评审时被否掉（见文末"一条没解决的"）。

| 区块 | 能力 | 当前页型 | 建议新增 | 依据（同域同能力的近亲） |
|---|---|---|---|---|
| `AlertRuleEditor` | form | dashboard,monitor | **+workbench** | `AlertSilenceForm` 已允许 workbench |
| `AlertRoutingPolicy` | entityRows | dashboard,monitor | **+workbench** | `AlertTriagePanel` 已允许 |
| `AlertMatcherFilter` | filter | monitor | **+workbench** | `AlertRuleFilterBar` 已允许 |
| `AlertRuleCommandHeader` | action | monitor | **+workbench** | `AlertGroupCommandHeader` 已允许 |
| `AlertInstanceSummary` | entityRows | monitor | **+dashboard,workbench** | 三个近亲都更宽 |
| `AlertGroupContextSummary` | entityRows | monitor,workbench | **+dashboard** | `AlertTriagePanel` 已允许 |
| `StreamSelectionSummary` | entityRows | monitor,workbench | **+dashboard** | `StreamStatusMonitor` 已允许 |
| `PermissionSummaryPanel` | entityRows | workbench | **+dashboard** | `PermissionMatrix` 已允许 |
| ~~`HeaderEntitySummary`~~ | entityRows | wizard,workbench | ~~+dashboard~~ | **评审否掉，未执行** |

**6 个来自 Alert 族**——正是最初那份线上收割里越界的那一族
（`AlertRoutingPolicy`、`MuteTimingSchedule` 被摆进 workbench 页）。也就是说这份
清单直接对准了那次事故的成因：不是模型摆错，是目录把「路由策略管理页」这种天然的
工作台排除在外了。

对组件库筛选的影响（A 档执行后实测）：允许 workbench 的 304 → **309**，允许
dashboard 的 133 → **137**。（提案初稿把 dashboard 的基数写成 132，实际是 133。）

三批全做完之后的最终计数：workbench **311**、monitor **154**、dashboard **126**、
wizard 68、kanban 55、calendar 55（dashboard/monitor 掉下来是 filter 收口剥掉的）。

## B 档 monitor 那 6 个的定调（**已执行**，矛盾 15 → 9）

评审时把这 6 个放在一起议了。结论是**不能一起放宽**——查完证据它们劈成了两半，
而且顺带照出一个比这 6 个都大的洞。

### 判据：`filterChange` 在总览页够不到任何东西（实测链路）

`AppRuntimeScreen.tsx` 里只有一份行被筛过：

| 位置 | 取数 | 吃筛选吗 |
|---|---|---|
| `:812` `rows = applyPageFilter(allRows, activePageFilter, …)` | 本页表/看板/日历 | **吃** |
| `:1922` `pageStatDisplay` → `state.entities[stat.entityId]` | 总览页 KPI | 不吃 |
| `:2913` `phoneChartNode` → `state.entities[chart.entityId]` | 页面图表 | 不吃 |
| `:1691` `sharedBlockRendererProps.entityRows = state.entities` | 所有积木 + 设计树 | 不吃（注释自己写着"未收窄"） |

总览页没有表/看板/日历，所以**任何发 `filterChange` 的区块摆上总览页都是死控件**。
这条 2026-08-01 就写在 `schema_legal.py` 里了，只是当时只按名字禁了 `FilterBar`。

### 4 个 action 的：放宽（+monitor）

| 区块 | 槽位 | 事件 | 已允许 monitor 的同形近亲 |
|---|---|---|---|
| `WorkflowCommandHeader` | header | actionTrigger,submitRequest | `IssueCommandHeader`、`ConnectionControlHeader`、`AlertGroupCommandHeader` |
| `ConnectionSchemaHeader` | header | actionTrigger,editRequest | **`ConnectionControlHeader`（同域）** |
| `SchemaRefreshBar` | footerBar | actionTrigger,editRequest | `RunningJobControlBar`、`DashboardSaveBar` |
| `WorkflowControlBar` | footerBar | itemSelect,submitRequest | 同上 |

三条证据：72 个 action 区块已有 **16 个**允许 monitor，槽位与事件形态一致；
运行时真渲染（`AppRuntimeScreen.tsx:3403` 总览页分支里 `blockScaffold` 与
`monitorFreeformOverview` **并列**，区域表含 `header`/`footerBar`；
`WorkflowControlBar` 取行用 `focus ?? rows[0]`，不依赖表格选中）；
提示词自己的立场就是"总览页要能动手"（*an overview whose ONLY content is numbers
is a report, not a workbench — the user opens it to act*）。

### 2 个 filter 的：不放宽，反而**收窄它们更宽的兄弟**

`UserDirectoryFilter` 只发 `filterChange`（摆上总览页全死）；`SavedSearchPanel`
的"运行"发 `filterChange`、"删除"发 `submitRequest`（**主动词死了**）。所以这两对
矛盾靠收窄消：`SavedViewTabs` 和 `UserEventFilter` 撤掉 `monitor`。

两条路矛盾数都落到 9，差别在一条往总览页塞死控件、另一条把死控件撤下来。

### 顺带修的洞：`pageKinds` 对 monitor 页原本一点约束力都没有

`monitor_ok` 是 `enabled` 减掉 4 个硬编码名字算出来的，**完全不读 `pageKinds`**：

    通电区块里不允许 monitor 的：188 个
    其中仍被 monitor_ok 那句列为总览页可选项的：187 个

同一份提示词里，条目说 `WorkflowCommandHeader: pages=workbench`，下面那句又把它
列进"总览页可以声明这些"。所以放宽这 6 个对**模型说的话零影响**，只动三处：
棘轮计数、组件库筛选、修复器的越界记录。

修法取"机械判据"而不是"让 `monitor_ok` 读 `pageKinds`"：后者会把总览页可选清单从
355 收到约 171，是真的行为变更，得上度量台跑一轮再定。前者只撤死控件，风险低，
理由是已实测的机制——`capability == "filter"` 一律禁（原来只禁 `FilterBar` 一个
名字，而目录里 32 个 filter 区块有 **28** 个只发 `filterChange`；2026-08-11 两刀去重后是 **18/22**，
删掉的全是「同工厂只换文案」的那一档，例外那四个一个没变）。

> **更正与后续（2026-08-11 复核）**
>
> ① 上面那个"31 个"是错的，真数是 **28/32**。例外有四个不是一个：
> `SavedViewTabs`、`SavedSearchPanel`（多发 `submitRequest`）、
> `HierarchicalCategoryPicker`（多发 `itemSelect`）、`ValidatedFormTabs`
> （**只**发 `itemSelect`）。数字已由 `tests/test_schema_legal_source.py`
> 钉住，不要再手写。
>
> 更正数字**不改结论**：这 4 个多发的事件同样到不了岸——`eventBindings`
> （事件名→动作 id）只在 `app-runtime-schema.ts:823` 被解析，全仓库没有第二处
> 读它；`handleBlockAction`（`AppRuntimeScreen.tsx:1607`）只特判 `rowSelect` /
> `editRequest` / `createRequest`，其余去 `page.pageActions` 里找 **id 等于事件名**
> 的动作，而动作 id 是模型生成的。所以判据维持整族，别按"放过这 4 个"去改。
> 本节对 `SavedSearchPanel` 的判断（"主动词死了"）当时就是对的，这里补上机械依据。
>
> ② "让 `monitor_ok` 读 `pageKinds`"这条**已经做了**，因为它不再是可选项：
> `ffaf964` 把页型限制写成了 prompt 里的 MUST 规则，而 `monitor_ok` 不读
> `pageKinds`，于是同一份提示词里 **323 个推荐中有 134 个**是被自己的 MUST
> 规则禁止的（模型连着读到"推荐用它"和"禁止用它"）。在 MUST 规则进来之前这只是
> 两套判据各说各的、没有可见后果，本文档当时记的"零影响"是对的；MUST 一进来它
> 就变成了自相矛盾的指令，只能对齐。
>
> 实测收窄幅度：推荐清单 **323 → 189**（本文档当初估的是 355 → 171，量级对上）。
> 这仍然是一次真实的行为变更，**度量台那一轮欠着**——先修矛盾，效果待测。
禁令的**理由句跟着名单走**：窄化开着时名单常常只剩筛选类，此时不再照抄
"MetricGrid and TrendChart would…" 去解释一个没出现的名字。

### 这个修法照出来的两个废区块（已用棘轮记着，不假装能用）

`AnalyticsDateScope`（dashboard,monitor）和 `DashboardParameterBar`（dashboard,monitor）
的 `pageKinds` **只**写了总览页，禁令一上就"只允许总览页 + 总览页不许用"——哪儿都
摆不了。不是判据错了：这两个照样筛不动东西。真正的修法是**让总览页的 KPI/图表吃
`filterState`**，那是个功能不是改一行数据。在那之前由
`test_没有更多区块被总览页禁令堵死` 守着这个数只准变少。

## filter 区块收口（**已执行**）：三处判据同源

上一节留了一条不一致：filter 区块的 `pageKinds` 仍写着允许 monitor，而提示词已经
硬禁。同一条规矩当时散在**三个地方**，判据各不相同：

| 位置 | 原判据 | 现判据 |
|---|---|---|
| 目录 `pageKinds` | 23 个 filter 区块写着允许 monitor / dashboard | 已剥掉 |
| 提示词禁令（`schema_legal.py`） | 4 个硬编码名字 | `capability == "filter"` |
| 渲染层兜底（`AppRuntimeScreen.tsx:1769`） | `b.type === "FilterBar"` | `EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE[b.type] === "filter"` |

第三处是这次才发现的：渲染层原来也按名字挡，等于只挡了这一族里最出名的那个
——`SavedViewTabs` / `TagFilterRow` / `SearchBox` 摆上总览页照样上屏、照样按不动。
渲染层那段注释给的理由比提示词更强一层：筛选条**绑单个实体**，而总览页的
KPI/图表通常跨好几个实体（真跑那次跨了 4 个），筛一个也管不着另外三个。

顺带说清为什么**没有**走"让总览页的 KPI/图表吃 `filterState`"那条路：`activePageFilter`
的 `enumFilters` 键是**本页主实体**的字段 id，而 `page.stats[].entityId` /
`page.charts[].entityId` 各指各的实体。直接把它套上去，只有主实体那几个卡会响应、
其余静默不动——比现在的"整个控件不动"更糟。要做成 Grafana 那种"时间范围/模板变量
管全页"，需要的是一个**总览页级别的筛选构件**（按每个面板自己的实体去匹配），
那是功能，不是改一行数据。

### 那两个被堵死的区块也一起修了

`AnalyticsDateScope` 和 `DashboardParameterBar` 原来只允许 dashboard/monitor，
禁令一上就无处可去。按同一条判据修：筛选类区块的归宿是**逐行展示记录的页面**，
所以这两个的 `pageKinds` 改成 `workbench`——那里 `applyPageFilter` 真的会收窄
表格的行（含 `dateRangeField` 那条日期范围），控件是活的。
`test_没有更多区块被总览页禁令堵死` 的基线从 2 锁到 **0**。

## B 档剩下的 9 对（**已定调：一个都不放宽**）

原来的判断是"这些的兄弟往往不是真近亲"。查完之后这句话可以量化了，而且比原来
说得更硬：**判据本身缺了一维——它不看区块摆在哪个槽位。**

把 `allowedRegions` 加进去看，9 对里有 **6 对区域完全不相交**：

| 窄的 | 它的槽位 | 宽的 | 宽的槽位 |
|---|---|---|---|
| `ActivityContextDrawer` | overlay | `ActivityFeed` | aside,main,supplement |
| `BookingContextSummary` | headerContent | `BookingSlotPicker` | main,supplement,overlay |
| `ConnectionRouteSummary` | headerContent | `ConnectionMappingPanel` | main,supplement,overlay |
| `DocumentContextSummary` | headerContent | `DocumentOutlinePanel` | aside,supplement |
| `EventTypePublishBar` | footerBar | `EventRsvpPanel` | aside,main,supplement |
| `FilterPresetDrawer` | overlay | `FilterBar` | filters |

**页头说明 / 浮层抽屉 / 底部操作条**去跟**主列面板**比页型，比的不是同一样家具，
只是碰巧 `capability` 相同。而且这种"窄"有可辩护的理由：宽的那个之所以宽，往往
正因为它能当某种页型的**主视图内容**——`BookingSlotPicker` 是预约向导那一步的
主体，`ConnectionMappingPanel` 是 Airbyte 连接设置向导里的映射步骤——而页头说明
当不了主视图。

所以判据加一维：**区域相交才算可比**。9 对 → **3 对**。

### 剩下 3 对：逐条写理由，不再靠一个基线数字

这 3 对区域真相交，是真同形的比较。它们记在
`test_page_kind_consistency_ratchet.py` 的 `_JUSTIFIED_PAIRS` 里，**每条附理由**，
未写理由的对数必须是 0：

| 对 | 为什么宽的那个宽得有理 |
|---|---|
| `ConnectionTimeline` ⊂ `ConnectionMappingPanel` | MappingPanel 宽在 wizard 是因为它能当连接设置向导那一步的主体；Timeline 是历史事件流，不是设置步骤 |
| `HeaderEntitySummary` ⊂ `HeaderProgressSummary` | 同区域同能力的真同形对，但 Progress 宽在 dashboard/monitor 是**聚合语义**（"整体进度到哪了"）；EntitySummary 说的是单条记录的字段，总览页不围绕单条记录，摆上去只能显示"第一行" |
| `RecordComparePanel` ⊂ `RecordPicker` | 只在 supplement 一个槽位相交。Picker 宽在 wizard/monitor 是因为"挑一条记录"是向导标准一步；对比面板是复核工具。若要放宽，wizard 那半有先例（`MergePreviewPanel` / `RecordChangePreview` 同是对比形状且允许 wizard），monitor 那半没有 |

把数字换成理由的用意：数字降到 0 只说明没有新漂移冒出来，而"这一条例外为什么
成立"得有人能读到；新增一条就是一次评审。

### 判据放宽了，所以加了一条反向证明

加区域维度是**放宽计数**，容易顺手把检测能力一起放掉。所以
`test_精判据没有把真漂移一起放过去` 现场合成一个必然是漂移的区块（同域、同能力、
**同区域**、页型少一个），断言精判据照样抓得到。生判据那个总数（9）也留着不动，
两个数一起看才知道是真变好了还是判据变松了。

## 执行方式

1. ~~先只做 A 档~~ **已完成**：改了 `services/data/experience_block_catalog.json`
   里那 8 个区块的 `pageKinds`，`tests/test_page_kind_consistency_ratchet.py` 的
   `_CONTRADICTION_BASELINE` 从 25 锁到 15（棘轮要求变好之后必须锁住）。
   顺带修了一处**会静默失效的路标**：`test_门禁仍然不拦页型越界` 原来用
   `AlertRoutingPolicy` 摆进 workbench 页当越界样例，A 档放宽后那个摆放变合法了，
   断言会永远成立。已换成同族同能力、仍然不允许 workbench 的
   `MuteTimingSchedule`，并加了一条前置断言先证明样例真的越界。
2. ~~B 档里的 monitor 那 6 个作为第二批一起议~~ **已完成**，见上面「B 档 monitor
   那 6 个的定调」：4 放宽 + 2 收窄兄弟，基线 15 → 9；并把总览页禁令从"4 个硬编码
   名字"改成机械判据（`capability == "filter"` 一律禁）。
3. ~~剩下的 9 对是第三批~~ **已完成**，见「B 档剩下的 9 对」：判据加区域维度，
   6 对是假阳性，3 对写明理由，一个都没放宽。
4. ~~矛盾降到 0 之后才谈让结构闸硬拒页型越界~~ **这条解锁条件已作废**，
   见文首那段引文与 `test_page_kind_consistency_ratchet.py` 的「上闸还差什么」：
   判据只覆盖 41/358 个区块，清零说明不了另外 317 个。新的解锁条件是给
   `pageKinds` 一份**能重算的推导依据**（照 `scripts/label_block_generality.py`
   给 `generality` 做的那样）。届时要改的仍是 `test_门禁仍然不拦页型越界`
   那条路标，而不是悄悄让修复器开始删区块。

## 推导脚本（**已执行**）：`scripts/label_block_page_kinds.py`

前面三批都是人工判断，判据只覆盖 41/358。这个脚本补的是"能重算的依据"，照
`label_block_generality.py` 给 `generality` 做的那样。

### 最重要的一条结论：这个字段四分之三不是技术约束

写脚本时把运行时逐处 `page.view.kind` 分支查了一遍：

| 页型 | 逐行视图 | 视图形状 | KPI/图表通道 | 区块渲染路径 |
|---|---|---|---|---|
| workbench | 有 | 表 | 固定 statsBand | businessPageGrid |
| wizard | 有 | 表 + 步骤条 | 无 | businessPageGrid |
| kanban | 有 | 看板（缺 statusFieldId 回落成表） | 无 | businessPageGrid |
| calendar | 有 | 月历（缺 dateFieldId 回落成表） | 无 | businessPageGrid |
| monitor | **无** | — | freeformOverview | blockScaffold |
| dashboard | **无** | — | 同上 | blockScaffold / grid |

**workbench / wizard / kanban / calendar 四种页型，从"区块能不能在这儿干活"的角度
看是可以互换的**——四者都有逐行视图、都走同一条 `businessPageGrid`、吃同一张
区域表（`regionsToGrid` 的几何按 band 走，跟页型无关，只有 kanban/calendar 把右栏
从 4/12 收到 3/12）。

**所以这个字段不该上结构闸。** 门禁硬拒的前提是"违反了就一定错"，而这个字段
四分之三的格子达不到这个标准。这条已经写回棘轮那个文件——上闸那条路标从"临时
状态"改成了"长期有效的结论"。

### 分两层，不混在一起

- **硬判据（4 条）**：运行时真的会丢区块或画重复的，加一条来自已自检预设的正面
  证据。每条指到具体行号。`--check` 不调模型、以退出码表态，`test_page_kind_derivation.py`
  把它接进了 CI。
  1. 总览页不放 `capability == "filter"`（`filterChange` 够不到东西）
  2. 总览页不放 `MetricGrid` / `TrendChart`（同一份数字画两遍）
  3. 筛选类至少要有一种带逐行视图的页（否则无处可去）
  4. `pageKindPresets` 用过的 (区块, 页型) 必须允许（预设启动时逐条自检过）
- **设计建议（其余全部）**：模型按页型分组出初稿，`--dry-run` 打差异表给人过。
  标错了页面不会坏，只是推荐得不好，所以**不进 CI、默认不落盘**。

### 第一次 `--check` 就抓到 4 处，其中一处是真事故

    MetricGrid  monitor/dashboard  目录允许了运行时会丢掉的页型
    TrendChart  monitor/dashboard  同上——而且 TrendChart **只**允许这两种页

`TrendChart` 那条：方案 C 的分工是"总览页归 `page.stats`/`charts`，业务页归
`MetricGrid`/`TrendChart` 积木"，而它的 `pageKinds` 只写了总览页——正好是它被硬禁
的那两种。**等于这个区块哪儿都摆不了。** 跟当天早些时候
`AnalyticsDateScope` / `DashboardParameterBar` 是同一个形状的洞。两个都已改成
`workbench`。

### 第二层第一次跑就示范了"为什么必须人过"

模型把 `RecordForm` 在 wizard 页判成"否"，理由"单体表单不能替代分步流程"——听着
有道理，但目录里 `flow-form` 预设正是 `WorkflowTimeline` + `RecordForm` 摆在
wizard 页上，那个组合服务启动时逐条自检过。它不知道这件事。

所以补了两处：硬判据④把预设用过的组合钉成 `require`；提示词把该页型的预设当
"已审核通过的正面例子"发给模型。这类错就不会再犯。

### 参考过的成熟方案

- **alibaba/lowcode-engine**（`nestingRule.parentWhitelist` / `childWhitelist`）：
  **手写白名单**，引擎只校验不推导。这正是我们现在这份数据的形态，也正是它漂掉
  的原因。
- **nocobase**（`SchemaInitializer` / `DataBlockInitializer`）：能往一个容器里加
  什么，由**容器提供什么数据上下文**决定，不是每个区块自己声明一张页面清单。
  本脚本照这个方向做——先写清"每种页提供什么"（`PAGE_KIND_FACTS`，每条带出处），
  再问"这个区块需要什么"，两边对上才算能放。

## 一条没解决的

判据里"名字首词 = 领域族"是个近似。它对 `Alert*` / `Booking*` / `Release*` 这种
命名规整的族有效，但目录里也有 `HeaderEntitySummary` 这类不带领域前缀的（被归到
`Header` 族）。这类分组可能把不相关的区块凑一起，也可能漏掉真矛盾。清单里
`HeaderEntitySummary` 那条建议因此比其它八条弱——**评审已单独否掉它**。

否掉之后补一条更正：这条对矛盾对数**本来就没有影响**，提案初稿把它算进
"25 → 15" 是记错了。给它加 dashboard 之后是 `{dashboard,wizard,workbench}`，
仍然是 `HeaderProgressSummary` 的 `{dashboard,monitor,wizard,workbench}` 的严格子集
（缺 monitor），那一对不会消掉。所以做 8 个和做 9 个都是 15 对，否掉它零代价——
真要消掉这一对，得先回答"实体摘要能不能上 monitor 页"，那是 B 档那批问题。
