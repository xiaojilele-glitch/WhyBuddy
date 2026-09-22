/**
 * page-panel-dedupe — 「同一份数据只画一次」的锁。
 *
 * 夹具直接抄真跑那次的声明（会话 sr-ms502mm2-vqxn5「练动云」首页）：
 * ActivityFeed 积木和 feeds 声明绑的是同一个实体、同一个时间字段、同一个
 * 等级字段，只有 id 和名字不同——靠 id 判重永远判不出来，这正是这份指纹
 * 判定要解决的问题。
 */

import { describe, it, expect } from "vitest";
import {
  blockPanelKey,
  dedupeBlocksByPanelKey,
  dropLegacyPanelsCoveredByBlocks,
} from "../live-runtime/page-panel-dedupe";
import type { ExperienceBlockInstance } from "../live-runtime/block-registry";

const feedBlock = {
  id: "recent_attendance",
  type: "ActivityFeed",
  binding: {
    entityRef: "attendance_record",
    timeFieldRef: "check_in_time",
    levelFieldRef: "status",
  },
} as unknown as ExperienceBlockInstance;

const rankBlock = {
  id: "expiry_members",
  type: "RankedList",
  binding: { entityRef: "membership", sortByRef: "paid_amount" },
} as unknown as ExperienceBlockInstance;

/** legacy 那份：字段引用带实体前缀，id/名字都不一样 */
const legacyFeed = {
  id: "attendance_alert_feed",
  label: "近期出勤动态",
  entityId: "attendance_record",
  timeFieldId: "attendance_record.check_in_time",
  levelFieldId: "attendance_record.status",
};
const legacyRanking = {
  id: "top_paid",
  label: "缴费排行",
  entityId: "membership",
  sortFieldId: "membership.paid_amount",
  sortLabel: "实付金额",
  limit: 10, // 条数不同也算同一张榜
};

describe("blockPanelKey · 指纹只认决定画面的那几维", () => {
  it("同实体同字段 → 同指纹（id / 名字 / 条数都不参与）", () => {
    const other = {
      ...rankBlock,
      id: "另一个 id",
      props: { limit: 3, sortOrder: "asc" },
    } as unknown as ExperienceBlockInstance;
    expect(blockPanelKey(other)).toBe(blockPanelKey(rankBlock));
  });

  it("换实体或换字段 → 不同指纹", () => {
    const k = blockPanelKey(feedBlock);
    expect(
      blockPanelKey({
        ...feedBlock,
        binding: { ...feedBlock.binding, entityRef: "booking" },
      } as ExperienceBlockInstance)
    ).not.toBe(k);
    expect(
      blockPanelKey({
        ...feedBlock,
        binding: { ...feedBlock.binding, timeFieldRef: "created_at" },
      } as ExperienceBlockInstance)
    ).not.toBe(k);
  });

  it("其余区块类型不参与去重（返回 null）", () => {
    for (const type of ["FilterBar", "MetricGrid", "DataTable", "FreeformInsight"]) {
      expect(
        blockPanelKey({ id: "x", type, binding: { entityRef: "e" } } as ExperienceBlockInstance)
      ).toBeNull();
    }
  });

  it("绑定不全的不参与去重 —— 宁可漏判也不能误删", () => {
    expect(blockPanelKey({ id: "x", type: "RankedList", binding: {} } as ExperienceBlockInstance)).toBeNull();
    expect(
      blockPanelKey({
        id: "x",
        type: "ActivityFeed",
        binding: { entityRef: "e" },
      } as ExperienceBlockInstance)
    ).toBeNull();
  });
});

describe("dropLegacyPanelsCoveredByBlocks · 撞车时保留积木那一份", () => {
  it("真跑那个案例：动态流被摘掉，积木留下", () => {
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [], feeds: [legacyFeed] },
      [feedBlock]
    );
    expect(out.feeds).toHaveLength(0);
  });

  it("字段引用带不带实体前缀都能对上（legacy 带、积木不带）", () => {
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [legacyRanking], feeds: [] },
      [rankBlock]
    );
    expect(out.rankings).toHaveLength(0);
  });

  it("没撞车的 legacy 声明照旧保留", () => {
    const other = { ...legacyFeed, entityId: "booking" };
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [], feeds: [legacyFeed, other] },
      [feedBlock]
    );
    expect(out.feeds).toEqual([other]);
  });

  it("一个积木都没有时原样返回（引用相等，调用方可跳过重渲染）", () => {
    const lists = { rankings: [legacyRanking], feeds: [legacyFeed] };
    expect(dropLegacyPanelsCoveredByBlocks(lists, [])).toBe(lists);
    expect(
      dropLegacyPanelsCoveredByBlocks(lists, [
        { id: "f", type: "FilterBar", binding: { entityRef: "x" } } as ExperienceBlockInstance,
      ])
    ).toBe(lists);
  });

  it("没有任何一条撞车时也返回原引用", () => {
    const lists = { rankings: [], feeds: [{ ...legacyFeed, entityId: "booking" }] };
    expect(dropLegacyPanelsCoveredByBlocks(lists, [feedBlock])).toBe(lists);
  });
});

describe("dedupeBlocksByPanelKey · 积木内部也可能重复", () => {
  it("同指纹只留第一个", () => {
    const dup = { ...feedBlock, id: "recent_attendance_2" } as ExperienceBlockInstance;
    const out = dedupeBlocksByPanelKey([feedBlock, dup, rankBlock]);
    expect(out.map(b => b.id)).toEqual(["recent_attendance", "expiry_members"]);
  });

  it("指纹为 null 的一律保留 —— 两个 FilterBar 是布局问题，不是重复数据", () => {
    const bar = { id: "b1", type: "FilterBar", binding: { entityRef: "e" } } as ExperienceBlockInstance;
    const bar2 = { ...bar, id: "b2" } as ExperienceBlockInstance;
    expect(dedupeBlocksByPanelKey([bar, bar2])).toHaveLength(2);
  });
});
