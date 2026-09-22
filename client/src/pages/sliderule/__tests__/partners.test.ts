// @vitest-environment jsdom
/**
 * 伙伴（小队）。
 *
 * 这个文件最重要的一条不在下面的任何一个 describe 里，而是
 * 「内置伙伴只许引用真实存在的能力」——引用一个不存在的连接器不会报错，
 * 只会让用户点了没反应。所以判据拿**真的连接器注册表**去核对。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  BUILTIN_PARTNERS,
  loadPartners,
  partnerCapabilities,
  partnerFromCurrent,
  partnerReadiness,
  readPartners,
  savePartners,
  type Partner,
} from "../partners";
import type { SlashItem } from "../composer-slash";

/** 后端 services/connectors.py 里真的注册了的那两个。 */
const REAL_CONNECTORS = ["weather", "stock"];

beforeEach(() => window.localStorage.clear());

describe("内置伙伴引用的都得是真东西", () => {
  it("每个内置伙伴的连接器依赖都在真实注册表里", () => {
    for (const p of BUILTIN_PARTNERS) {
      for (const need of p.needs) {
        if (need.kind !== "connector") continue;
        expect(
          REAL_CONNECTORS,
          `伙伴「${p.name}」引用了不存在的连接器 ${need.key}`
        ).toContain(need.key);
      }
    }
  });

  it("每个内置伙伴都有起手意图和至少一个依赖——空壳伙伴点了什么也不会发生", () => {
    for (const p of BUILTIN_PARTNERS) {
      expect(p.needs.length, p.name).toBeGreaterThan(0);
      expect(p.opener.trim().length, p.name).toBeGreaterThan(10);
    }
  });

  it("id 不重复", () => {
    const ids = BUILTIN_PARTNERS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("能不能用，只看这台机器上真的有没有", () => {
  const P: Partner = {
    id: "x",
    name: "测试伙伴",
    description: "",
    needs: [
      { kind: "connector", key: "weather", name: "天气" },
      { kind: "skill", key: "trae-market/frontend-design", name: "frontend-design" },
    ],
    opener: "做个东西",
  };

  it("都齐 → ready", () => {
    const r = partnerReadiness(P, {
      connectorIds: ["weather"],
      skillKeys: ["trae-market/frontend-design"],
    });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("缺技能 → 不 ready，并且**说出缺的是哪个**", () => {
    const r = partnerReadiness(P, { connectorIds: ["weather"], skillKeys: [] });
    expect(r.ready).toBe(false);
    expect(r.missing.map(m => m.name)).toEqual(["frontend-design"]);
  });

  it("缺连接器 → 不 ready", () => {
    const r = partnerReadiness(P, {
      connectorIds: [],
      skillKeys: ["trae-market/frontend-design"],
    });
    expect(r.ready).toBe(false);
    expect(r.missing.map(m => m.key)).toEqual(["weather"]);
  });

  it("同名但类型不同不算数（技能叫 weather 顶不了连接器 weather）", () => {
    const r = partnerReadiness(P, { connectorIds: [], skillKeys: ["weather"] });
    expect(r.missing.some(m => m.kind === "connector" && m.key === "weather")).toBe(
      true
    );
  });
});

describe("装配", () => {
  const P: Partner = {
    id: "x",
    name: "测试伙伴",
    description: "",
    needs: [
      { kind: "connector", key: "weather", name: "天气" },
      { kind: "skill", key: "没装的技能", name: "没装的技能" },
    ],
    opener: "",
  };

  it("只把**真的有的**装进这一轮，缺的不进去", () => {
    const caps = partnerCapabilities(P, { connectorIds: ["weather"], skillKeys: [] });
    expect(caps).toHaveLength(1);
    expect(caps[0]!.key).toBe("weather");
    // 反面：缺的那个绝不能混进去——混进去后端按 key 找不到会静静跳过，
    // 用户以为用上了
    expect(caps.some(c => c.key === "没装的技能")).toBe(false);
  });

  it("一个都没有时装配出空数组，不抛", () => {
    expect(partnerCapabilities(P, { connectorIds: [], skillKeys: [] })).toEqual([]);
  });
});

describe("用户自己攒的", () => {
  const picked: SlashItem[] = [
    { key: "weather", kind: "connector", name: "天气", description: "" },
    { key: "s1", kind: "skill", name: "技能一", description: "" },
  ];

  it("从当前挂着的能力存一个", () => {
    const p = partnerFromCurrent("我的小队", picked, "做个天气页")!;
    expect(p.name).toBe("我的小队");
    expect(p.needs.map(n => n.key)).toEqual(["weather", "s1"]);
    expect(p.opener).toBe("做个天气页");
  });

  it("没名字 / 一个能力都没挂 → 拒绝，不存空壳", () => {
    expect(partnerFromCurrent("", picked, "x")).toBeNull();
    expect(partnerFromCurrent("   ", picked, "x")).toBeNull();
    expect(partnerFromCurrent("有名字", [], "x")).toBeNull();
  });

  it("存档往返", () => {
    const p = partnerFromCurrent("我的小队", picked, "做个天气页")!;
    savePartners([p]);
    expect(loadPartners().map(x => x.name)).toEqual(["我的小队"]);
  });

  it("存档坏了 / 条目脏了：剔掉不抛", () => {
    expect(readPartners("{不是 json")).toEqual([]);
    const raw = JSON.stringify([
      { id: "a", name: "好的", needs: [{ kind: "connector", key: "weather", name: "天气" }] },
      { id: "", name: "没 id" },
      { name: "没 id 字段" },
      { id: "b", name: "" },
      { id: "a", name: "重复 id" },
    ]);
    expect(readPartners(raw).map(p => p.id)).toEqual(["a"]);
  });

  it("依赖里混了不认的类型：剔掉那一条，伙伴本身留着", () => {
    const raw = JSON.stringify([
      {
        id: "a",
        name: "好的",
        needs: [
          { kind: "connector", key: "weather", name: "天气" },
          { kind: "外星人", key: "x", name: "x" },
          { kind: "skill", key: "", name: "空 key" },
        ],
      },
    ]);
    expect(readPartners(raw)[0]!.needs.map(n => n.key)).toEqual(["weather"]);
  });
});
