/**
 * 意图搜索的**质量用例**（2026-08-08）。
 *
 * 用户给了四句话当验收标准：
 *
 *     「我要选择客户」「做一个订单筛选」「显示销售趋势」「上传并预览合同」
 *
 * 这几条钉的不是"函数跑不跑得通"，是**搜出来的东西对不对**。搜索这种东西，
 * 跑通和好用之间差着十万八千里——所以每条都写清楚"期望里面有谁"。
 *
 * 语料里有一条硬约束值得记住：基础组件目录明令**不许出现业务词**（「订单」
 * 「门店」出现就是滑回业务积木那一层了）。所以「客户」「合同」「销售」在
 * 语料里一次都不出现，纯全文检索永远搜不到——能搜到全靠意图词表。
 */
import { describe, expect, it } from "vitest";

import { buildIndex, expandIntent, tokenize } from "../component-search";
import { JUDGMENTS, precisionAtK, recallAtK } from "../component-search-judgments";

/**
 * **不注入 labelOf** —— 中文名现在从目录 JSON 读（scripts/sync_block_labels.py
 * 同步自渲染器注册表），页面和这里拿到的是同一份。
 *
 * 2026-08-09 之前这里是 `() => undefined`，而组件库页面注入了
 * `LABEL_BY_TYPE`（来自 block-registry 的 111 个中文名）。于是**这份测试
 * 量的排序和用户看到的排序不是同一个索引**——它一直是绿的，而真实页面上
 * 「我要选择客户」的第二名是 ReferenceManyManager。
 *
 * 下面那条 `测试索引必须和页面索引同源` 就是防它再分叉。
 */
const index = buildIndex(
  () => undefined,
  () => []
);

/** 前 N 名里有没有它。搜索只看第一名太苛刻，也不符合真实用法。 */
const topNames = (q: string, n = 12) =>
  index.search(q).slice(0, n).map(d => d.name);

describe("分词", () => {
  it("中文出单字 + 相邻二字 —— 打半个词也要能搜到", () => {
    const t = tokenize("订单筛选");
    expect(t).toContain("订单");
    expect(t).toContain("单筛"); // 真分词器会把这里切断，bigram 不会
    expect(t).toContain("筛");
  });

  it("驼峰拆得开 —— 打 form 要能命中 ProFormSelect", () => {
    expect(tokenize("ProFormSelect")).toEqual(
      expect.arrayContaining(["proformselect", "pro", "form", "select"])
    );
  });
});

describe("意图词表", () => {
  it("业务话展开成能力词，原话保留", () => {
    const out = expandIntent("我要选择客户");
    expect(out).toContain("我要选择客户");
    expect(out).toContain("关联"); // 客户 → 关联/选择/记录
    expect(out).toContain("下拉"); // 选择 → 下拉/单选/多选
  });

  it("没命中词表就原样返回 —— 不给它硬塞词", () => {
    expect(expandIntent("zzz")).toBe("zzz");
  });
});

/**
 * 检索质量：**按判定清单算指标**，不钉具体名次（2026-08-10 重写）。
 *
 * 原来这一段是六条"第 N 名必须是 X"。目录从 26 涨到 359 的过程中它们红了三轮，
 * 每轮都靠改名单修好——而每次都不是搜索坏了，是**近义条目变多了**：做筛选的
 * 15 个、做结果面板的 6 个、名字带「预览」的 6 个，它们之间的名次本来就会随
 * 语料抖动。钉名字等于把"目录不许变"写进测试。
 *
 * 改成检索评测的标准形态（判定清单 + Recall@k，做法与出处见
 * ../component-search-judgments.ts 的模块头，抄 rated-ranking-evaluator）。
 *
 * ⚠ 下面这些阈值是**回归护栏，不是质量目标**。它们取自 2026-08-10 的实测
 * 基线（平均 Recall@5 = 0.635），作用是"别更差"。真实质量还差得远，尤其：
 *
 *     上传并预览合同   R@5 = 0.00   ← 「合同」展开成「记录 明细 表格 详情 关联」
 *                                     把 entityRows 那 45 个整族拉了进来
 *     我要选择客户     R@5 = 0.25
 *     审批记录         R@5 = 0.33   ← 三个"向导"类区块占了 2~4 名
 *
 * 提这几个数是下一步的事，不是把阈值调低就算完。
 *
 * ## ⚠ 2026-08-11：目录 359 → 407 之后，这条护栏已经形同虚设（余量 0.008）
 *
 * 新增 48 个区块（独立结构族那批）之后平均掉到 **0.5961**，红了。逐条对比只有
 * **两条**掉，其余 15 条一模一样：
 *
 *     上传并预览合同      0.60 → 0.20    ResumableUploadQueue / CronOccurrenceBuilder 挤掉了
 *                                        ProFormUploadDragger 和 Upload
 *     把选中的导成 Excel   1.00 → 0.33    BankTransactionReconciliationMatcher 和 DataTable
 *                                        挤掉了 BatchActionBar 和 DataExportPanel
 *
 * 三个新来的挤进前五，原因各不相同：
 *
 *   · `ResumableUploadQueue`「断点上传队列」—— 它**真的**是上传件，是判定清单
 *     过时（写清单时它还不存在）。按本文件的维护约定补进了 relevant（gain=3，
 *     与 Upload / ProFormUploadButton 同档）。
 *   · `CronOccurrenceBuilder`「Cron 触发预览器」—— 描述里有「**预览**」，而查询
 *     是"上传并**预览**合同"。
 *   · `BankTransactionReconciliationMatcher`「银行流水勾稽台」—— 描述里有
 *     「搜索、**选择**」，而查询是"把**选中**的导成 Excel"。
 *
 * 后两个正是本文件开头记的那个老问题（"名字带「预览」的 6 个"）的新成员：
 * BM25 只看词，看不出语义。**补标注治不了它们。**
 *
 * 所以现在的状态要说清楚：补完标注平均是 **0.6078**，只比阈值高 **0.008**。
 * 那 0.008 来自 `上传附件` / `传个文件上来` 从 0.80 涨到 0.83——**平均被托过线，
 * 但上面那两条查询仍然是坏的**（各 0.33）。这条护栏现在挡不住下一次加区块。
 *
 * 下一步该做的是排序本身（意图词表的展开太粗、描述字段权重偏高），
 * **不是**继续补标注、也不是把 0.6 调低。
 */
describe("检索质量（判定清单）", () => {
  const rankedFor = (q: string) => index.search(q).map(d => d.name);
  const allQueries = JUDGMENTS.flatMap(j =>
    [j.query, ...(j.aliases ?? [])].map(q => ({ q, j }))
  );

  it("平均 Recall@5 不低于基线", () => {
    const scores = allQueries.map(({ q, j }) => recallAtK(rankedFor(q), j, 5));
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const detail = allQueries
      .map(({ q }, i) => `${q}=${scores[i].toFixed(2)}`)
      .join("  ");
    expect(avg, `逐条：${detail}`).toBeGreaterThanOrEqual(0.6);
  });

  it("每条查询的正解都得进前十 —— 一条都不许整个丢掉", () => {
    for (const { q, j } of allQueries) {
      const r10 = recallAtK(rankedFor(q), j, 10);
      expect(r10, `「${q}」前十里一个正解都没有：${rankedFor(q).slice(0, 10).join(", ")}`)
        .toBeGreaterThan(0);
    }
  });

  it("有唯一正解的查询，头名要落在正解里", () => {
    const pinned = allQueries.filter(({ j }) => j.topPick);
    const miss = pinned.filter(({ q, j }) => !j.topPick!.includes(rankedFor(q)[0] ?? ""));
    // 允许少数落空（同义说法有时会把另一个同样合理的顶上来），但不能过半
    expect(
      miss.length,
      `落空的：${miss.map(({ q }) => `${q}→${rankedFor(q)[0]}`).join("; ")}`
    ).toBeLessThanOrEqual(Math.floor(pinned.length / 2));
  });

  it("前五里不能全是不相干的 —— 至少沾一个边", () => {
    for (const { q, j } of allQueries) {
      expect(
        precisionAtK(rankedFor(q), j, 5),
        `「${q}」前五全不相干：${rankedFor(q).slice(0, 5).join(", ")}`
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * 能力面的中文词是**内容**，不是排序参数。
 *
 * 区块目录里 capability / dataKinds 全是英文（filter、aggregate、entityRows），
 * 基础组件那边的分组却是中文。不补这一层，中文查询在区块档只能命中说明正文，
 * 标签字段（权重是说明的两倍）等于空转——实测「订单筛选」搜不到 FilterBar，
 * 而它的能力面正是 filter。
 */
describe("区块的能力面要有中文词", () => {
  it("每个真实用到的能力面都译了 —— 漏一个，那一类区块中文搜不到", () => {
    const caps = new Set(
      index.docs
        .filter(d => d.kind === "block")
        .flatMap(d => d.tags.split(" "))
        .filter(t => /^[a-zA-Z]+$/.test(t))
    );
    // 目录里真实出现的能力面（从 tags 里的英文词取），每个都得有中文伴随
    const untranslated = [...caps].filter(cap => {
      const docs = index.docs.filter(d => d.kind === "block" && d.tags.includes(cap));
      return docs.every(d => !/[一-龥]/.test(d.tags));
    });
    expect(untranslated, `这些能力面没有中文词：${untranslated.join(", ")}`).toEqual([]);
  });
});

describe("普通搜索没被意图层搞坏", () => {
  it("打组件名照样第一名", () => {
    expect(index.search("ProFormRate")[0]?.name).toBe("ProFormRate");
    expect(index.search("DataTable")[0]?.name).toBe("DataTable");
  });

  it("罕见词不被高频词淹掉 —— 这是用 BM25 而不是 includes 计数的理由", () => {
    // 「签名」全语料只有一条，「选择」有几十条。朴素计数会让含「选择」的
    // 一堆条目挤在前面。
    expect(index.search("签名")[0]?.name).toBe("SignaturePad");
  });

  it("空串不返回全部 —— 那会让搜索框一打开就铺满", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
  });

  it("区块和基础组件一起给 —— 用户要的是「能直接装进应用的东西」", () => {
    const kinds = new Set(index.search("批量").slice(0, 15).map(d => d.kind));
    expect(kinds.has("block") || kinds.has("base")).toBe(true);
    expect(index.docs.filter(d => d.kind === "block").length).toBeGreaterThan(20);
    expect(index.docs.filter(d => d.kind === "base").length).toBeGreaterThan(200);
  });
});

describe("测试索引必须和页面索引同源", () => {
  it("区块中文名从目录读得到，不靠调用方注入", () => {
    const docs = index.docs.filter(d => d.kind === "block");
    const named = docs.filter(d => d.label !== d.name);
    expect(
      named.length,
      `${docs.length} 个区块里只有 ${named.length} 个有中文名——` +
        "目录落后了，跑 slide-rule-python/scripts/sync_block_labels.py"
    ).toBeGreaterThanOrEqual(docs.length);
  });
});
