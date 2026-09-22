# `pageKinds` 推导脚本首轮跑批记录（2026-08-11）

`scripts/label_block_page_kinds.py --dry-run`，模型 `gpt-5.6-luna`，6 种页型 ×
358 个通电区块，耗时约 **62 分钟**。

**结论先说：第一层（硬判据）可用并已进 CI；第二层（模型初稿）这一版不可用，
不落盘。** 下面是原始输出、为什么不可用、以及照此修了脚本哪三处。

**另有四条是这一轮我自己引入或写错的，事后被代码审查查出来，记在第六节**
（其中一条是真回归：把 `MetricGrid`/`TrendChart` 砍到只剩 workbench，让三种页型
的 KPI 通道两条路一起堵死，且没有任何测试会红）。

## 一、原始输出

```
目录 359 个区块（通电 358）
硬判据违反 0 处

第二层：按页型问模型（gpt-5.6-luna），6 种页 × 358 个区块
  workbench  问了 321 个（硬判据定死 37 个），模型答 yes 145，答上 321/321
  wizard     问了 355 个（硬判据定死 3 个），模型答 yes 113，答上 355/355
    重试 1/2：[Errno 104] Connection reset by peer
  kanban     问了 354 个（硬判据定死 4 个），模型答 yes 61，答上 354/354
  calendar   问了 356 个（硬判据定死 2 个），模型答 yes 46，答上 356/356
  monitor    问了 322 个（硬判据定死 36 个），模型答 yes 70，答上 322/322
  dashboard  问了 322 个（硬判据定死 36 个），模型答 yes 86，答上 322/322

差异（问全 6 种页的 327 个区块）：
  一致        39
  目录更宽    247  ← 现在推荐了推导认为干不了活的页
  目录更窄    119  ← 现在挡住了推导认为能用的页

没问全的 31 个（不下结论，重跑）：TagFilterRow, SearchBox, StatusTabs,
ActiveFilterSummary, AnalyticsDateScope, SavedViewTabs, AdvancedFilterBuilder,
FacetedFilterPanel, IssueEventFilter, TimelineFilterBar, BookingStatusTabs,
ValidatedFormTabs
```

各页型两侧对照：

| 页型 | 目录现在 | 模型初稿（含硬判据） |
|---|---|---|
| workbench | 311 | ~182 |
| wizard | 68 | ~116 |
| kanban | 55 | ~65 |
| calendar | 55 | ~48 |
| monitor | 154 | ~106 |
| dashboard | 126 | ~122 |

## 二、跑通了的部分

- **硬判据 0 违反**，与 `--check` 一致（此前它抓到过 4 处，`MetricGrid` /
  `TrendChart` 那两个已修——**但那次修法本身是错的，见第六节**）。
- **一条都没丢**：321/321、355/355、354/354、356/356、322/322、322/322。
  「发行号不发区块名」那条纪律有效（`label_block_generality.py` 记着的教训是
  发名字有三分之一批次会被模型"顺手规整"掉 id）。
- **退避重试用上了一次**（kanban 那轮 `Connection reset by peer`），恢复正常。
- **硬判据替模型省了该省的判断**：monitor / dashboard 各定死 36 个（32 个筛选类
  + `MetricGrid` / `TrendChart`）。这批不问模型既是省钱也是防错——2026-08-01
  实测过模型会按语义直觉认为"总览页该有个筛选条"。

## 三、为什么第二层这一版不可用

### 3.1 抽查 8 个「目录更宽」，8 个被清空

从截断的清单里取 8 个，把模型要去掉的页型跟它现有声明比：

| 区块 | 现有 | 模型要去掉 | 剩下 |
|---|---|---|---|
| `AlertGroupCommandHeader` | monitor, workbench | monitor, workbench | **空** |
| `AttachmentPanel` | dashboard, monitor, wizard, workbench | 全部 4 个 | **空** |
| `AlertGroupContextSummary` | dashboard, monitor, workbench | 全部 3 个 | **空** |
| `AlertInstanceSummary` | dashboard, monitor, workbench | 全部 3 个 | **空** |
| `AlertRuleCommandHeader` | monitor, workbench | monitor, workbench | **空** |
| `BookingContextSummary` | calendar, workbench | calendar, workbench | **空** |
| `BookingDecisionBar` | calendar, workbench | calendar, workbench | **空** |
| `BookingCommandHeader` | calendar, workbench | calendar, workbench | **空** |

清空等于**废掉一个已经写好渲染器、已经放开生成的区块**。脚本的落盘前置检查
（"推导出来一个页型都不允许就拒绝落盘"）会挡住它，所以没有写坏数据——但这说明
这一版初稿整体不能用。

**根因是我自己的设计缺口**：按页型分组问是对的（混着问会全答 yes），但**分组问
之后没有任何一处在看"这个区块还剩几种页"**。每一轮单独看，模型答得都有道理；
六轮一路答否，区块就没了。

### 3.2 至少两条理由的前提是错的

- `ApprovalStageBoard 多 workbench`，理由「主区应为表格，非看板布局」。
  **不成立**：2026-08-08 那次「翻转默认」之后，workbench 页只要声明了积木就
  **不渲染内置表格**，版面由积木自己画（`AppRuntimeScreen.tsx` 的
  `blocksOwnPage`）。我在 `PAGE_KIND_FACTS` 里写了这句，模型仍然按"工作台=表格页"
  的旧直觉答。
- `AlertRuleCommandHeader 多 workbench`，理由「告警规则管理属于配置页」。
  **"配置页"不是这 6 种页型里的任何一种**；告警规则管理页本身就是个工作台。这条
  跟 A 档放宽它的依据正好相反，而 A 档那次是有同族先例支撑的
  （`AlertGroupCommandHeader` 当时已允许 workbench）。

这正是脚本文档里那句「这张表要是跟运行时漂了，模型拿到的就是假前提，而那种错误
最难查」——只是这次假前提不是表写错了，是模型没采信表。

### 3.3 「没问全的 31 个」是记账 bug，不是网关抖动

那 31 个**全是筛选类**，这不是巧合。硬判据③（"筛选类至少要有一种带逐行视图的页"）
返回的 `require_any_row` 是个记账位，不是"这一格定死了"；但首轮的主循环把它当成
"有硬判据"处理——于是筛选类区块的 `workbench` 那一格**既不问模型、又不记进
`asked`**，永远凑不满 6 种页，被差异表整批跳过。

32 个筛选类里恰好漏 31 个：`FilterBar` 例外，因为它有预设 `require`
（`filter-list-create` / `board-filter-feed`）顶着那一格。

已修（见第四节第 3 条）。

### 3.4 值得单独跟进的一条

`BatchActionBar 多 kanban`，理由「看板未提供多行勾选」——这条**可能是对的**，
`KanbanBoard` 只有 `onOpenRow`，没有多选。留作待查项，不在本轮处理。

## 四、照此修了脚本三处

1. **兜底强制选择**（`force_pick`）：逐页型问完之后，凡是被判成"哪种页都不放"的
   区块，回头再问一次，**问法从"能不能"换成"最合适的是哪 1~2 种"**。判断题一路
   答否会清空，选择题答不出"都不选"。
2. **原始初稿落盘**（`--draft-out`，默认 `scripts/data/page_kinds_draft.json`）：
   首轮跑完才发现屏幕上的差异表两边各截 30 行，而**逐格判断一个字没留**，要复核
   就得再花一小时重跑全部 API 调用。一小时的产出必须落地成文件。
3. **`require_any_row` 不再当"有硬判据"**：那一格照旧交给模型问，并记进 `asked`。
   这是 3.3 那 31 个的根因。

## 五、结论与下一步

- **第一层照旧有效**：硬判据 4 条 + `--check` + `tests/test_page_kind_derivation.py`
  已经进 CI，那是"能重算的依据"这件事真正落地的部分。
- **第二层重跑一次再看**（带上兜底与落盘）。这一版不落盘，目录数据不动。
- 结论没变：这个字段**不该上结构闸**。理由不是"初稿不好"，而是运行时对
  workbench / wizard / kanban / calendar 四种页型无差别对待，见
  `tests/test_page_kind_consistency_ratchet.py` 的「上闸还差什么」。
- 遗留：3.4 那条 `BatchActionBar` / 看板多不多选，待查。

## 六、事后被代码审查推翻/更正的四条（`40f28e2`、`0c83714`、`d07c791`）

这份记录写完之后，另一路对 `7caf7b3..HEAD` 做了代码审查，查出六条，其中四条是
**我这一轮自己引入或写错的**。据实记在这里，前面几节不回改，以免掩盖过程。

### 6.1 把 `MetricGrid` / `TrendChart` 砍到只剩 workbench，造出了第二个洞

第三节写的"`TrendChart` 只允许总览页 = 哪儿都摆不了"是对的，**但修法砍窄了一档**：
两个区块都改成只剩 `workbench`，于是 kanban / calendar / wizard 三种页型
**两条路一起堵死**——积木这条被 `block_assembler._catalog_for_prompt` 按 pageKinds
过滤掉，自己声明那条又被 CHANNEL OWNERSHIP 明令要求留空。这三种页一个数字都显示
不出来，而且**没有任何测试会红**：目录合法、硬判据 0 违反、提示词自洽。

已由 `d07c791` 放开到四种业务页型，并补了两条测试（都验过"改回 workbench-only
会红"）。

### 6.2 我写进 `PAGE_KIND_FACTS` 的一条事实是错的——正是 6.1 的根因

那张表给 wizard / kanban / calendar 的"KPI/图表通道"写的是**「无」**。真实行为
两个端不一样：桌面 `statsBand` 没有页型闸（只判 `page.stats.length > 0`），照样
渲染；手机 `wantsMetrics` 只认 dashboard/monitor/workbench，真的没有。

正因为以为"这三种页压根没有 KPI 通道"，才会觉得砍到 workbench 无害。而这张表
**既是硬判据的依据，又被当前提喂给模型**——我自己在脚本文档里写过"前提假了最难
查"，这次就栽在这上面。已更正并补上行号出处。

### 6.3 "32 个 filter 区块有 31 个只发 filterChange" 是错的，真数 **28/32**

这个数我在 `schema_legal.py`、`AppRuntimeScreen.tsx`、提案文档三处各抄了一遍，
三处全错，且错了没有任何东西会红。例外是四个不是一个：`SavedViewTabs` 与
`SavedSearchPanel` 多发 `submitRequest`，`HierarchicalCategoryPicker` 多发
`itemSelect`，`ValidatedFormTabs` 只发 `itemSelect`（一个 `filterChange` 都没有）。

判据与结论不变（查过运行时：那 4 个多发的事件同样到不了岸），只更正数字。

⚠️ 注意区分：本文件 3.3 节那个"31"是**另一件事**（31 个筛选区块没被问全），
那个数是对的。

### 6.4 `hard_verdicts` 四条规则打架时后写的静默赢

四条规则依次往同一个 dict 里 `out[kind] = …`，硬④（预设 `require`）排在最后，
会盖掉硬①（总览页禁筛选类的 `forbid`）。一个说"必须允许"、一个说"绝对不许"，
不该有赢家；盖掉之后 `audit()` 反而会要求把那个页型**加回目录**。当时数据里恰好
没撞上（唯一重叠是 `FilterBar@workbench`，良性），所以一路绿灯。已由 `0c83714`
改成显式消解。

### 6.5 关于 `monitor_ok` 读不读 `pageKinds`

这条当初评审时选的是"先不动，等度量台"。但 `ffaf964` 把页型限制写成了 prompt 里
的 MUST 规则之后它不再是可选项——同一份提示词里 323 个推荐里有 134 个与 MUST
规则直接矛盾。`40f28e2` 先修了矛盾（推荐清单 323 → 189）。

**那次欠着的度量已经补上了，见第七节——查出一处真回归。**

## 七、补做欠着的度量：推荐清单收窄踢掉了一个真在用的区块

`40f28e2` 把推荐清单从 323 收到 189，是生成路径上的真行为变更，而当初定的
"得上度量台跑一轮再定"一直欠着。这次用**零 LLM 成本**的办法补上了。

### 办法：拿真实生成结果当真相源，不重新跑生成

度量台早先存过 **177 份真实生成模型**（`--save-dir` 的产物）。从里面抽出
**总览页上真的被摆出来过的区块**，再跟收窄后的推荐清单比——曾经被用过、现在不
推荐了的，就是这次收窄的实际代价。

    扫了 177 份真实生成模型，其中总览页 199 个
    总览页上真的被摆出来的区块：13 种，共 466 次

### 结果：2 种被踢掉，其中 1 种是真回归

| 区块 | 总览页用过 | 现在的 pageKinds | 判断 |
|---|---|---|---|
| `QuickActionPanel` | **43 次**（第 3 多） | workbench,wizard | **真回归，已修** |
| `DataTable` | 4 次 | workbench,kanban,calendar | 本来就该禁（禁令里点名了） |

前两名 `ActivityFeed`（180 次）、`WorkflowTimeline`（157 次）都还在清单里，
所以收窄整体是安全的——**只漏了 `QuickActionPanel` 这一个**。

### 为什么判定它是"目录标错"而不是"推荐错了"

`40f28e2` 的默认假设是"目录是对的、推荐是错的"，它的注释还正好拿
`QuickActionPanel` 当矛盾的例子。四条证据指向反面：

1. **177 份真实模型里在总览页用过 43 次**，是第三多的；
2. **`freeform_block._VISUAL_SHAPE` 只有 4 个形状是总览页设计环节画得出来的**
   （RankedList / ActivityFeed / QuickActionPanel / WorkflowTimeline），
   另外三个都允许 monitor，只有它不允许——渲染端支持，声明没跟上；
3. **`monitor_ok` 那句话本身就在描述它**：*a panel of the actions this role
   starts the day with*；
4. **2026-07-31 补那句祈使语的起因**原文记的正是「QuickActionPanel /
   WorkflowTimeline 这两个通电且真渲染的区块从未被生成过」——推荐清单一收窄，
   那次修的洞就被重新打开了一半。

修法：`QuickActionPanel` 的 `pageKinds` 加 `monitor`（只加 monitor，因为实测
43 次全部发生在 monitor 页，dashboard 页 0 次）。推荐清单 189 → 196。

新增 `test_总览页设计环节画得出的形状都得允许总览页`：把 `_VISUAL_SHAPE`
当成独立于 `pageKinds` 的正面证据源钉住。它比"同族兄弟允许"硬一档——那是类比，
这是渲染端的能力声明。

### 顺带结清 3.4 那条待查

模型说「`BatchActionBar` 不该上看板页，因为看板没有多行勾选」。**观察对，结论错**：

- `KanbanBoard`（`PageViews.tsx:46`）只收 rows/statusField/cardFields/onOpenRow，
  确实没有勾选；
- 但 `DataTable` 允许上看板页，而它**就是**选择态的唯一供给方；
- 而且内置表格（`AppRuntimeScreen` 里那几处 `Table`）**一个都没有 `rowSelection`**
  ——所以 workbench 页同样只在"页面另外声明了 DataTable"时才有勾选。

也就是说这是**区块与区块之间的依赖**，不是区块与页型之间的。收窄 `pageKinds`
治不了它，只会把问题挪个地方。`BatchActionBar` 的出处注释早写明了这层依赖
（"先给 DataTable 接上 rowSelection…再建这个区块"），但目录里没有任何字段能表达
"我需要一个提供选择态的同伴"。

已在 `block-props-wiring.test.ts` 钉住那条唯一的供给链：DataTable 的
`rowSelection` 一旦被摘掉，`BatchActionBar` 就退化成一句永远的「勾选左侧的行」。
`pageKinds` 不动。
