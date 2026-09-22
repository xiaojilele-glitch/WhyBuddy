# 区块该做多细？—— Ant Design 官方怎么拆的

2026-08-08。用户定下三层链路之后的问题：基础组件有了（139 个），但**组装的时候
哪些该组装成什么**没有依据。于是去 GitHub 看用 antd 做得好的项目怎么拆。

结论先说：**Ant Design 官方自己就是按这三层拆的**，而且第二层官方就叫「区块」。

---

## 一、`ant-design/pro-blocks` —— 官方的「区块」库

29 个，`umi-block.json` 是它的清单。但**它们是整页的**：

| 分类 | 条目 |
|---|---|
| dashboard | 分析页 / 监控页 / 工作台 |
| 列表 | 标准列表 / 卡片列表 / 搜索列表（应用·文章·项目）/ 查询表格 |
| 详情 | 基础详情页 / 高级详情页 |
| 表单 | 基础表单 / 高级表单 / 分步表单 |
| 结果 | 成功页 / 失败页 |
| 异常 | 403 / 404 / 500 |
| 用户 | 注册页 / 注册结果页 |
| 账户 | 个人中心 / 个人设置 |
| 编辑器 | 流程 / 拓扑 / 脑图 |
| 其它 | 空白页 |

官方对「查询表格」的原话：**「一个标准的表格增删改查页面，可以派生出百分之
八十的后台页面。」**

**所以 antd 的「区块」= 我们的「模板」层，不是我们的「区块」层。**

### 它们是代码，不是数据

每个区块的结构：

```
ListTableList/
  src/index.tsx          ← 页面本体
  src/components/*.tsx   ← 区域级部件
  src/service.ts         ← 请求
  src/_mock.ts           ← 假数据
  src/data.d.ts          ← 类型
  snapshot.png
```

`umi block add` 做的是**把源码拷进你的项目**。是脚手架，不是运行时拼装。

这一条直接决定了我们「AI 组装区块」该产出什么：**契约，不是代码**。区块 =
schema + 逻辑 + 关联，逻辑就是代码，代码得人写。

---

## 二、真正对应我们「区块」层的，是每个页面里被抽出来的部件

这才是这次调研的正题。官方自己抽出来的（去掉三个图形编辑器）：

| 部件 | 出处 | 干什么 |
|---|---|---|
| **IntroduceRow** | DashboardAnalysis | 顶部四张指标卡那一排 |
| **ChartCard** | ↑ 的单元 | 五个槽：`title / action / total / children(迷你图) / footer` |
| **Trend** | ↑ | 环比涨跌（up/down + 文字） |
| **Field** | ↑ | 卡片脚注的 `label: value` |
| **SalesCard** | DashboardAnalysis | 带页签（销售额/访问量）+ 时间范围的图表卡 |
| **ProportionSales** | ↑ | 饼图 + 占比 |
| **TopSearch** | ↑ | 排行榜（表格式，带迷你趋势） |
| **OfflineData** | ↑ | 页签切换的多组数据 |
| **StandardFormRow** | ListSearch* | 一行筛选：左边标题，右边一堆控件 |
| **TagSelect** | ↑ | 标签式多选，超过一行可展开 |
| **ListToolBar** | pro-components | `title / subTitle / search / actions / settings / tabs / filter` |
| **Table Alert** | pro-components | 「已选择 N 项 · 清空 · 批量操作」 |
| **ColumnSetting** | pro-components | 列设置 |
| **EditableTable** | pro-components | 可编辑子表 |
| **QueryFilter** | pro-components | 查询表单，带收起/展开 |
| **LightFilter** | pro-components | 轻量筛选（药丸式下拉） |
| **StatisticCard / CheckCard** | pro-components | 指标卡 / 卡片式单选 |
| **AvatarList** | AccountCenter | 头像组 |
| **EditableLinkGroup** | DashboardWorkplace | 快捷链接组 |
| **OperationModal / CreateForm / UpdateForm** | 各列表页 | 弹层表单 |

`ChartCard` 的槽位契约值得单独看 —— 它就是一个标准的区块契约长什么样：

```ts
type ChartCardProps = {
  title: React.ReactNode;      // 指标名
  action?: React.ReactNode;    // 右上角（通常是「指标说明」的 ⓘ）
  total?: ReactNode | number | (() => ReactNode);  // 大数字
  footer?: React.ReactNode;    // 脚注（日销售额 ￥12,423）
  contentHeight?: number;      // 迷你图的高度
  children;                    // 迷你图 / 环比
}
```

---

## 三、对着我们现有的 15 个区块，缺口在哪

| antd 的部件 | 我们 | 差距 |
|---|---|---|
| IntroduceRow + ChartCard + Trend | `MetricGrid` | **缺环比、迷你图、脚注、右上角说明** |
| SalesCard | `TrendChart` | 缺页签切换、时间范围 |
| TopSearch | `RankedList` | 基本齐 |
| ProportionSales | — | **缺饼图/占比** |
| StandardFormRow + TagSelect | `FilterBar` | 我们是 Select 式；**缺标签式 + 可展开** |
| QueryFilter 的收起/展开 | `FilterBar` | 缺 |
| ListToolBar | `PageHeader` | **缺搜索框、缺状态页签** |
| Table Alert | — | **缺批量操作栏** |
| ColumnSetting | — | 缺列设置 |
| EditableTable | — | 缺可编辑子表 |
| ProDescriptions | `RecordDetail` | 基本齐 |
| ModalForm / DrawerForm | `RecordFormDialog` | 齐 |
| StepsForm | `StepsForm` | 齐 |
| EditableLinkGroup | `QuickActionPanel` | 齐 |
| Result 页 | — | **连页面范式都没有** |

用户那张门店订单管理参考图缺的，正好落在带 ✱ 的几条：**统计卡那一排（带环比）、
搜索框、状态页签、批量操作栏**。

---

## 四、这次调研改了什么

1. 确认了「AI 组装区块」产出**契约**而不是代码 —— 跟 antd 官方的分工一致。
   落成 `services/block_proposer.py` + `POST /components/propose-blocks`。
2. 区块粒度有了参照系：**区域大小**，带自己的绑定和逻辑。不是组件，也不是整页。
3. 上面那张缺口表就是接下来补区块的清单。

---

## 五、第二轮：区域名也得照它改

用户看完上面之后指出更根本的一条：**我们那五个/七个区域名是我编的**。
「你当时其实也不知道它是分什么区的……比如 404 页面该显示成什么样。」

对。于是把 29 页的页面骨架也扒了一遍。官方答案是 `PageContainer` 的槽
（`pro-components/src/layout/components/PageContainer`），使用统计：

| 槽 | 用了几页 | 我们有吗 |
|---|---|---|
| `PageContainer` / `GridContent` | 29 | 有（隐含） |
| `extra`（页头右上角操作） | 9 | 混在 header 里 |
| `content`（页头下的描述块） | 6 | **没有** |
| `extraContent`（页头右侧关键指标） | 4 | **没有** |
| `tabList`（页面级页签） | 3 | **没有** |
| `FooterToolbar`（底部固定操作条） | 2 | **没有** |
| `<Result>`（结果/异常主体） | 7 | **连范式都没有** |

### 最要紧的一条修正：关键数字该放哪儿

我原来假设「关键数字 = 全宽一条指标带」（`metrics` 区）。证据不支持：

- **只有仪表盘类**用全宽带 —— DashboardAnalysis 的 `IntroduceRow`，四张
  ChartCard 撑满整行。那一排就是这一页的主角。
- **列表页和详情页把最重要的两三个数放在页头右侧**（`extraContent`）：
  - ProfileAdvanced：「状态：待审批」「订单金额：¥568.08」
  - ListBasicList：「我的待办 8个任务 / 平均处理时间 32分钟 / 本周完成 24个任务」
  - DashboardWorkplace：「项目数 56 / 团队内排名 8 / 项目访问 2223」

这不是审美差异。页头里的数**不占垂直空间**，主区还是完整一张表；做成全宽带
就把用户真正来看的东西挤下去一屏。

### 落地

新增四个区域，每个在 `page_archetypes.py` 里都标了出处：

    headerExtra    页头右侧关键指标   ← extraContent
    headerContent  页头下的说明/字段  ← content
    tabs           页面级页签         ← tabList
    footerBar      底部固定操作条     ← FooterToolbar

并把「关键数字放哪儿」写成提示词里的显式规则 —— 不写的话模型不会用新区域，
optional 在模型眼里约等于"可以不管"（第一次实测正是如此：detail 页只用了
header/main/aside，把「状态」「金额」丢在主区里）。写完再测，headerExtra 用上了。

### 顺带抓到一个隐形 bug

`footerBar` 把 `QuickActionPanel` 单独放进底部那条带之后，整条带是空的。查下去：
`QuickActionPanelRenderer` 第一行就是 `if ((pageActions ?? []).length === 0)
return null`，而装配预览**从来没传过 pageActions**。也就是说此前任何被装进页面的
QuickActionPanel 都渲染成空气——不报错、不占位。一直没发现是因为它总跟别的区块
挤在同一个区里，看不出少了谁。

### result 范式（已补）

29 页里 7 页的主体是 `<Result>`（403/404/500、提交成功/失败、注册结果、分步表单
末步），是这个库里最常见的页面形状。按链路倒着建：

    Result 基础组件（已在库）→ ResultPanel 区块（新建）→ result 范式（开出来）

**区块只画外面那层。** 官方 ResultSuccess 是

    <Result status title subTitle extra={几个按钮}>
      {单据 Descriptions + 流程 Steps}
    </Result>

里面那两样是 RecordDetail 和 WorkflowTimeline 的活，摆在 `supplement` 区
（band=main，全宽——三列的 Descriptions 和横向 Steps 在 1/3 宽里会挤成一团）。
把三样焊死在一个区块里，等于回到"一个区块管一整页"。

#### 实测抓到的两条，已进 Gate

第一次真跑，模型给 ResultPanel **只填了 title**「入库单提交成功」：

- 没 `status` → 渲染器退到 info，一张**成功**的页面顶着蓝色感叹号。图标是用户扫
  一眼判断成败的东西，中性图标把成功和出错画成一样。
- 没按钮 → 用户被困住。结果屏本来就是死胡同，后面没有内容了。

pro-blocks 那 7 页无一例外都有 `status` 和 `extra`（返回列表/查看项目/打印、
返回修改、Back Home）。所以这两条是这类页面的定义，不是苛刻 —— 落成
`result-no-status` / `result-no-exit` 两条规则，同时把要求写进提示词。补完再测：
绿勾 + 「返回订单列表」「查看入库单」两个按钮，一次过检查。

## 附：仓库

- `ant-design/pro-blocks` — 官方 29 个页面级区块，`umi-block.json` 是清单
- `ant-design/pro-components` — `src/{card,table,form,list,descriptions,layout}`，
  区域级部件都在各自的 `components/` 下
