/**
 * 检索质量的**判定清单**（judgment list / 相关性标注）。
 *
 * ## 为什么要有这个文件
 *
 * 组件库搜索的验收此前是一串"第 N 名必须是 X"的精确名单。目录从 26 涨到 359
 * 的过程中，这些断言红了三轮，每轮都靠改名单修好：
 *
 *     26 → 111    三条红      111 → 167   两条红      236 → 359   五条红
 *
 * 每次都不是搜索坏了，是**近义条目变多了**。359 个区块里做筛选的有 15 个、
 * 做结果面板的有 6 个、名字带「预览」的有 6 个——它们互相之间的名次本来就
 * 会随语料抖动，而钉具体名字等于把"目录不许变"写进了测试。
 *
 * ## 做法来源
 *
 * 抄检索评测的标准做法（读了 SeaseLtd/rated-ranking-evaluator 与 o19s/quepid）。
 * RRE 的评分文件长这样：
 *
 *     "query_groups": [{
 *        "queries": [ {"$query": "fender"}, {"$query": "Fender bass"} ],
 *        "relevant_documents": { "1": {"gain": 3}, "2": {"gain": 3} }
 *     }]
 *
 * 三条关键约定，这里照搬：
 *
 * ① **一组同义查询共享一份相关清单** —— 判的是意图，不是字面。
 * ② **相关性分档（gain）**，不是二元 —— 「上传附件」这件事 AttachmentPanel 是
 *    正解，Image 只是沾边，两者不该同权。
 * ③ **断言的是指标不是名单** —— Recall@k 掉到阈值以下才红。相关的东西还在
 *    前 k 名，名次怎么换都不算回归；真丢了才报。
 *
 * ## 怎么维护
 *
 * 加区块**不需要**改这里。只有两种情况才动：
 *   · 新增了一个对某条查询来说是**正解**的区块 → 补进 relevant；
 *   · 发现某条标注本身标错了 → 改它，并在注释里写清为什么。
 *
 * 标注的依据是"用户搜这句话，想要的是什么"，**不是"现在搜出来的是什么"**。
 * 拿当前排序反推标注，这份文件就退化成了它要防的那种快照测试。
 */

/** 相关性档位：3 = 正解，2 = 可接受（沾边但不是用户要的那个）。 */
export type Gain = 3 | 2;

export interface Judgment {
  /** 用户会打出来的话。同一意图的不同说法放进同一条的 `aliases`。 */
  query: string;
  /** 同义查询——共享下面这份相关清单。 */
  aliases?: string[];
  /** 条目名 → 相关档位。名字取 `SearchDoc.name`（区块类型名 / 组件名）。 */
  relevant: Record<string, Gain>;
  /**
   * 第一名必须落在这几个里。**只在意图有明确"正解"时才写**——
   * 「审批记录」的第一名该是流程条这种。没有唯一正解的查询留空。
   */
  topPick?: string[];
}

export const JUDGMENTS: Judgment[] = [
  {
    // 用户四句验收之一。核心意图是"挑一条已有记录填进来"。
    query: "我要选择客户",
    aliases: ["选择供应商", "挑一个负责人"],
    relevant: {
      RecordPicker: 3,
      ProFormSelect: 3,
      Select: 3,
      "M.Picker": 3,
      ReferenceManyManager: 2, // 管理关联记录，顺带能选，但不是"选一个"
      Cascader: 2, // 多级选择，客户通常不分级
      TreeSelect: 2,
      Transfer: 2,
      "M.Selector": 2,
      AutoComplete: 2,
    },
  },
  {
    query: "做一个订单筛选",
    aliases: ["按条件过滤单据", "加个筛选栏"],
    relevant: {
      FilterBar: 3,
      SearchBox: 3,
      StatusTabs: 3,
      TagFilterRow: 3,
      QueryFilter: 2,
      LightFilter: 2,
      FacetedFilterPanel: 2, // 多维分面，通用场景用不上
      AdvancedFilterBuilder: 2,
    },
  },
  {
    query: "显示销售趋势",
    aliases: ["看营收走势", "画个金额趋势图"],
    relevant: {
      TrendChart: 3,
      MetricGrid: 3,
      ProportionPie: 2, // 占比不是趋势，但同属经营看板那一组
      StatisticCard: 2,
      Statistic: 2,
    },
    topPick: ["TrendChart", "MetricGrid"],
  },
  {
    // 这条 2026-08-10 真红过：前五一个上传件都没有。
    // 语料里能做上传的只有 5 条（AttachmentPanel + 4 个基础组件），
    // 「合同」经意图词表展开成「记录 明细 表格 详情 关联」把 entityRows
    // 整族拉了进来，把它们全挤出去了。
    query: "上传并预览合同",
    aliases: ["上传附件", "传个文件上来"],
    relevant: {
      AttachmentPanel: 3, // 359 个区块里唯一做附件的
      Upload: 3,
      ProFormUploadDragger: 3,
      ProFormUploadButton: 3,
      "M.ImageUploader": 3,
      ResumableUploadQueue: 3, // 2026-08-11 新增的断点上传队列，确实是上传件
      Image: 2, // 预览那一半
      "M.ImageViewer": 2,
    },
  },
  {
    query: "审批记录",
    aliases: ["审批流程走到哪了", "看审批历史"],
    relevant: {
      WorkflowTimeline: 3,
      ApprovalQueue: 3,
      AuditTrail: 3,
      ApprovalDecisionBar: 2,
      ActivityFeed: 2, // 动态流，能承载"记录"但不是审批专用
      Timeline: 2,
    },
    topPick: ["WorkflowTimeline", "ApprovalQueue"],
  },
  {
    query: "批量导出",
    aliases: ["把选中的导成 Excel"],
    relevant: {
      BatchActionBar: 3,
      DataExportPanel: 3,
      ExcelExportButton: 3,
      BulkSelectionBar: 2,
      ExportJobDrawer: 2,
      BulkActionTray: 2,
    },
    topPick: ["BatchActionBar", "DataExportPanel"],
  },
];

/**
 * Recall@k：**正解**（gain=3）里有多少落进了前 k 名。
 *
 * 只用 gain=3 当分母：可接受档（2）是"出现了也不错"，不该算进"必须找到"。
 */
export function recallAtK(ranked: string[], j: Judgment, k: number): number {
  const musts = Object.entries(j.relevant)
    .filter(([, gain]) => gain === 3)
    .map(([name]) => name);
  if (musts.length === 0) return 1;
  const head = new Set(ranked.slice(0, k));
  return musts.filter(n => head.has(n)).length / musts.length;
}

/** 前 k 名里有多少是标过的（不分档）——衡量"有没有掺进不相干的"。 */
export function precisionAtK(ranked: string[], j: Judgment, k: number): number {
  const head = ranked.slice(0, k);
  if (head.length === 0) return 0;
  return head.filter(n => j.relevant[n] !== undefined).length / head.length;
}
