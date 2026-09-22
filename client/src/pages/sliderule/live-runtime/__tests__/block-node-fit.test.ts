/**
 * 刀 2 降级阶梯的判据（2026-08-27）。
 *
 * 抄 fit.rs 的形状，判据也照它的要害钉：**有序**、**只在还超时才降**、
 * **效果累加**、**记录落在哪一档**。这四条里任何一条被写坏，画布的表现都
 * 是"看着有卡片"——所以必须靠判据咬，眼睛看不出来。
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_FIT_RUNGS,
  DEFAULT_BLOCK_IFRAME_BUDGET,
  fitBlockNodes,
  rungIndex,
  type BlockNodeCandidate,
} from "../block-node-fit";

function mk(
  key: string,
  o: Partial<Omit<BlockNodeCandidate, "key">> = {}
): BlockNodeCandidate {
  return {
    key,
    inViewport: o.inViewport ?? true,
    onActivePage: o.onActivePage ?? false,
    isSelected: o.isSelected ?? false,
  };
}

/** n 个块：前 inView 个在视口内，其中前 onPage 个在当前页，第一个是选中的。 */
function many(n: number, inView = n, onPage = 0): BlockNodeCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    mk(`k${i}`, {
      inViewport: i < inView,
      onActivePage: i < onPage,
      isSelected: i === 0,
    })
  );
}

describe("阶梯本身", () => {
  it("五档，顺序写死", () => {
    // 变异：调换任意两档，这条红。fit.rs 头注写死 "do not reorder"，
    // 我们这边同理——顺序即语义。
    expect([...BLOCK_FIT_RUNGS]).toEqual([
      "verbatim",
      "offscreen_culled",
      "inactive_pages_collapsed",
      "live_only_selected",
      "all_static",
    ]);
  });

  it("rungIndex 单调：越靠后降得越狠", () => {
    for (let i = 1; i < BLOCK_FIT_RUNGS.length; i += 1) {
      expect(rungIndex(BLOCK_FIT_RUNGS[i])).toBeGreaterThan(
        rungIndex(BLOCK_FIT_RUNGS[i - 1])
      );
    }
  });
});

describe("够用就不降（后一档只在前一档仍超预算时才启用）", () => {
  it("总数不超预算 → verbatim，全都真渲染", () => {
    const plan = fitBlockNodes(many(5), 12);
    expect(plan.rung).toBe("verbatim");
    expect(plan.liveCount).toBe(5);
    expect(plan.staticCount).toBe(0);
  });

  it("正好等于预算 → 还是 verbatim（边界不许多降一档）", () => {
    // 变异：把 `total <= budget` 写成 `<`，这条红。
    const plan = fitBlockNodes(many(12), 12);
    expect(plan.rung).toBe("verbatim");
    expect(plan.liveCount).toBe(12);
  });

  it("超了但剔掉视口外就够 → 只降到第 1 档", () => {
    // 20 块，其中 8 块在视口内
    const plan = fitBlockNodes(many(20, 8), 12);
    expect(plan.rung).toBe("offscreen_culled");
    expect(plan.liveCount).toBe(8);
    expect(plan.staticCount).toBe(12);
  });

  it("视口内还是太多 → 再降到「只留当前页」", () => {
    // 30 块全在视口内，其中 5 块在当前页
    const plan = fitBlockNodes(many(30, 30, 5), 12);
    expect(plan.rung).toBe("inactive_pages_collapsed");
    expect(plan.liveCount).toBe(5);
  });

  it("当前页都放不下 → 只留选中的那一块", () => {
    // 40 块全在视口内、全在当前页，只有一块是选中的
    const plan = fitBlockNodes(many(40, 40, 40), 12);
    expect(plan.rung).toBe("live_only_selected");
    expect(plan.liveCount).toBe(1);
    expect([...plan.live]).toEqual(["k0"]);
  });

  it("连选中的都超（预算 0）→ 全静态", () => {
    const plan = fitBlockNodes(many(40, 40, 40), 0);
    expect(plan.rung).toBe("all_static");
    expect(plan.liveCount).toBe(0);
    expect(plan.staticCount).toBe(40);
  });

  it("一块都没选中且当前页仍超 → 零块真渲染，但档位如实报第 3 档", () => {
    // ⚠ 这里**不报 all_static**，是有意的（照 fit.rs 的 rung 口径：记的是
    //   "最终启用到哪一档"，不是"结果长什么样"）。第 3 档确实跑了、也确实
    //   收敛了（0 块没超预算），报 all_static 等于谎称又降了一档。
    //   真机上要区分"降到底了没有"应该读 liveCount，不是读档位名。
    const cands = Array.from({ length: 40 }, (_, i) =>
      mk(`k${i}`, { inViewport: true, onActivePage: true, isSelected: false })
    );
    const plan = fitBlockNodes(cands, 12);
    expect(plan.rung).toBe("live_only_selected");
    expect(plan.liveCount).toBe(0);
    expect(plan.staticCount).toBe(40);
  });
});

describe("⚠ 效果累加（不是各档独立重算）", () => {
  it("第 2 档是在「已剔掉视口外」的基础上再筛当前页", () => {
    // 这条是抄 fit.rs 时最容易写歪的一处：把每一档写成从原始集合重新筛，
    // 于是降到第 2 档时视口外的块又回来了。
    // 构造：当前页有 20 块，但其中只有 3 块在视口内。
    const cands = Array.from({ length: 30 }, (_, i) =>
      mk(`k${i}`, {
        inViewport: i < 3 || i >= 20, // 前 3 块 + 后 10 块在视口内
        onActivePage: i < 20, // 前 20 块属于当前页
        isSelected: i === 0,
      })
    );
    const plan = fitBlockNodes(cands, 5);
    // 视口内 13 块 > 5 → 降第 2 档；当前页**且**视口内 = 前 3 块
    expect(plan.rung).toBe("inactive_pages_collapsed");
    expect([...plan.live].sort()).toEqual(["k0", "k1", "k2"]);
    // 变异：把第 2 档写成 candidates.filter(onActivePage)（丢掉累加），
    // live 会变成 20 块（>预算），这条红。
    expect(plan.liveCount).toBeLessThanOrEqual(5);
  });

  it("选中的那一块若不在视口内，第 3 档也救不回它", () => {
    // 累加的另一面：前面档剔掉的，后面档不许捡回来。
    const cands = Array.from({ length: 40 }, (_, i) =>
      mk(`k${i}`, {
        inViewport: i !== 0, // 选中的那块恰好滚出视口
        onActivePage: true,
        isSelected: i === 0,
      })
    );
    const plan = fitBlockNodes(cands, 5);
    // 档位如实报第 3 档（见上一条的口径说明）；要紧的是 k0 没被捡回来。
    expect(plan.rung).toBe("live_only_selected");
    expect(plan.live.has("k0")).toBe(false);
    expect(plan.liveCount).toBe(0);
  });
});

describe("反向判据", () => {
  it("live 里绝不会超过预算（除了 verbatim 那档本来就没超）", () => {
    // 变异：任何一档忘了 `if (kept.length <= budget)` 就直接返回，这条红。
    for (const n of [1, 5, 13, 30, 100]) {
      for (const budget of [1, 3, 12]) {
        const plan = fitBlockNodes(many(n, n, Math.floor(n / 2)), budget);
        expect(plan.liveCount).toBeLessThanOrEqual(Math.max(budget, 0));
      }
    }
  });

  it("live + static 恒等于总数——不许有块凭空消失", () => {
    // 少一块不会报错，只是画布上少一张卡片。
    for (const n of [0, 1, 7, 25]) {
      const plan = fitBlockNodes(many(n, n, 2), 4);
      expect(plan.liveCount + plan.staticCount).toBe(n);
    }
  });

  it("all_static 只在预算 <= 0 时可达——这是它唯一的入口", () => {
    // ⚠ 记下来免得下一个人以为这档是死码：预算 >= 1 时第 3 档最多留 1 块，
    //   必然收敛，所以走不到第 4 档。第 4 档服务的是"块节点整个关掉"那种配置。
    expect(fitBlockNodes(many(40, 40, 40), 0).rung).toBe("all_static");
    expect(fitBlockNodes(many(40, 40, 40), -1).rung).toBe("all_static");
    expect(fitBlockNodes(many(40, 40, 40), 1).rung).toBe("live_only_selected");
  });

  it("空输入 → verbatim、零块，不抛", () => {
    const plan = fitBlockNodes([], 12);
    expect(plan.rung).toBe("verbatim");
    expect(plan.liveCount).toBe(0);
    expect(plan.staticCount).toBe(0);
  });

  it("默认预算是个正数（漏了默认值会静默变成全静态）", () => {
    expect(DEFAULT_BLOCK_IFRAME_BUDGET).toBeGreaterThan(0);
    expect(fitBlockNodes(many(3)).rung).toBe("verbatim");
  });

  it("⚠ 默认预算装得下真机常见规模——「区块要是真实的区块」", () => {
    /*
     * 2026-08-28 用户裁决：降级卡片不算真实区块。
     * 预算 32 是量出来的（见 DEFAULT_BLOCK_IFRAME_BUDGET 头注的两档实测），
     * 覆盖 4~7 页 × 3~7 块的真实会话。
     * 变异：调回 12，真机那份 5 页 24 块的会话立刻只剩 5 块真渲染，这条红。
     */
    expect(DEFAULT_BLOCK_IFRAME_BUDGET).toBeGreaterThanOrEqual(28);
    // 真机基线：5 页 24 块，必须全量真渲染
    expect(fitBlockNodes(many(24, 24, 24)).rung).toBe("verbatim");
    expect(fitBlockNodes(many(24, 24, 24)).liveCount).toBe(24);
  });

  it("反向：阶梯没被删——病态输入仍然降级，不许把标签页拖垮", () => {
    // 几十页上百块时宁可降级，而且降级是看得见的（data-block-fit-rung）。
    const huge = many(200, 200, 200);
    expect(fitBlockNodes(huge).liveCount).toBeLessThanOrEqual(
      DEFAULT_BLOCK_IFRAME_BUDGET
    );
    expect(fitBlockNodes(huge).rung).not.toBe("verbatim");
  });

  it("不做二分：同一输入结果稳定，不随调用次数变", () => {
    const cands = many(30, 30, 5);
    const a = fitBlockNodes(cands, 12);
    const b = fitBlockNodes(cands, 12);
    expect(a.rung).toBe(b.rung);
    expect([...a.live].sort()).toEqual([...b.live].sort());
  });
});
