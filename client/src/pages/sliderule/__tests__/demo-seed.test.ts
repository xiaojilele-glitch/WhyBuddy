/**
 * demo-seed — 演示种子数据的边界锁。
 *
 * 这个模块唯一的危险是"把假数据混进真数据里"，所以测试重点押在四条边界上：
 * 每个实体只判一次、只填空实体、每行有标记、写第一条真实数据时整批清掉。
 * 逼真度（enum 走真取值、money 落在合理区间、值不是等差数列）也一起锁——
 * 不锁的话哪天退回 `(hash + 行号*步长) % N` 也没人发现。
 */

import { describe, it, expect } from "vitest";
import {
  SEED_ROW_COUNT,
  buildSeedRows,
  dropSeedRowsFor,
  entityShowsSeed,
  isSeedRow,
  seedRowCount,
  seedRuntimeState,
} from "../live-runtime/demo-seed";
import { semanticOf } from "../live-runtime/demo-seed-semantics";
import { fieldRandom, seedFromString } from "../live-runtime/demo-seed-random";
import {
  addRow,
  deleteRow,
  initRuntimeState,
  updateRow,
} from "../live-runtime/live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

/** 固定时间基准：日期字段确定性依赖它，不钉死的话跨天跑测试会飘。 */
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "plot",
        name: "地块",
        fields: [
          { id: "name", name: "地块名", type: "string" },
          { id: "lot_code", name: "批次编号", type: "string" },
          { id: "keeper_name", name: "负责人", type: "string" },
          { id: "area", name: "面积", type: "number" },
          { id: "rent", name: "年费", type: "number", format: "money" },
          { id: "health", name: "健康度", type: "number", format: "percent" },
          { id: "rating", name: "评分", type: "number", format: "rating" },
          { id: "leased_at", name: "认领日", type: "date" },
          {
            id: "status",
            name: "状态",
            type: "enum",
            options: [
              { id: "idle", label: "空闲", tone: "default" },
              { id: "leased", label: "已认领", tone: "success" },
            ],
          },
          { id: "note", name: "备注", type: "text" },
          { id: "member_ref", name: "认领人", type: "ref" },
        ],
      },
      { id: "member", name: "成员", fields: [{ id: "name", name: "姓名", type: "string" }] },
    ],
  },
  rbac: { roles: ["admin"], permissions: [], menus: [] },
};

const seededState = () => seedRuntimeState(initRuntimeState(MODEL), MODEL, NOW);

describe("demo-seed · 造行", () => {
  const rows = buildSeedRows(MODEL.datamodel!.entities![0], NOW);

  it("每个实体铺 SEED_ROW_COUNT 行，行行带 seed 标记", () => {
    expect(rows).toHaveLength(SEED_ROW_COUNT);
    expect(rows.every(isSeedRow)).toBe(true);
    expect(new Set(rows.map(r => r.id)).size).toBe(SEED_ROW_COUNT); // id 不重
  });

  it("确定性：同样入参两次结果完全一致（没有 Math.random）", () => {
    expect(buildSeedRows(MODEL.datamodel!.entities![0], NOW)).toEqual(rows);
  });

  it("行数被夹住 —— 参数错位不该把进程跑成 OOM", () => {
    // 真栽过：签名从 (entity, allEntities, nowMs) 改成 (entity, nowMs, count)
    // 之后，漏改的调用方把时间戳传到了 count 上，Array.from 直接 OOM，
    // 等三分钟才炸且报错指不到这里
    expect(buildSeedRows(MODEL.datamodel!.entities![1], NOW, NOW).length).toBe(500);
    expect(buildSeedRows(MODEL.datamodel!.entities![1], NOW, -5)).toHaveLength(0);
  });

  it("enum 只取声明里的取值 id，且每个取值都出现过", () => {
    const legal = new Set(["idle", "leased"]);
    expect(rows.every(r => legal.has(String(r.values.status)))).toBe(true);
    // 每个取值至少铺一行：漏掉一个，看板就会有一列全空、徽标少一种颜色
    expect(new Set(rows.map(r => r.values.status)).size).toBe(2);
  });

  it("数字按 format 分档：money 四位数 / percent 0-100 / rating 1-5", () => {
    for (const r of rows) {
      expect(Number(r.values.rent)).toBeGreaterThan(999);
      expect(Number(r.values.rent)).toBeLessThan(100000);
      expect(Number(r.values.health)).toBeGreaterThanOrEqual(0);
      expect(Number(r.values.health)).toBeLessThanOrEqual(100);
      expect(Number(r.values.rating)).toBeGreaterThanOrEqual(1);
      expect(Number(r.values.rating)).toBeLessThanOrEqual(5);
    }
  });

  it("**不是等差数列** —— 第一版的核心毛病", () => {
    // 老实现是 (hash + 行号*步长) % N，产出 18,35,52,69,86,3,... 每行固定 +17，
    // 折线图画出来是直线加断崖。这里锁住"相邻差值不能只有一两种"。
    const vals = rows.map(r => Number(r.values.health));
    const diffs = new Set(vals.slice(1).map((v, i) => v - vals[i]));
    expect(diffs.size).toBeGreaterThan(3);
  });

  it("两个字段不能是同一条序列的相位平移", () => {
    // 老实现里 percent 类字段彼此只差一个起点，同一页两张 KPI 卡长得一样
    const a = buildSeedRows(
      { id: "e1", fields: [{ id: "f", name: "F", type: "number", format: "percent" }] },
      NOW
    ).map(r => r.values.f);
    const b = buildSeedRows(
      { id: "e2", fields: [{ id: "f", name: "F", type: "number", format: "percent" }] },
      NOW
    ).map(r => r.values.f);
    expect(a).not.toEqual(b);
    // 相位平移检测：把 b 各种旋转都比一遍，都不该等于 a
    for (let k = 1; k < b.length; k++)
      expect(a).not.toEqual([...b.slice(k), ...b.slice(0, k)]);
  });

  it("日期落在最近两周内，且散得开（趋势图要有形状）", () => {
    const keys = rows.map(r => String(r.values.leased_at));
    expect(keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true);
    expect(Date.parse([...keys].sort()[0])).toBeGreaterThan(NOW - 15 * 864e5);
    // 只要求"散得开"，不再要求 12 行落 12 个不同的天：强行每天一条，
    // count 型趋势图每根柱子都是 1，整条线是平的。允许扎堆才有起伏。
    expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  });

  it("认得出语义的字段走词表，不再是「字段名 N」", () => {
    // 负责人 → 中文人名
    expect(rows.every(r => /^[一-龥]{2,4}$/.test(String(r.values.keeper_name)))).toBe(true);
    expect(rows.every(r => !String(r.values.keeper_name).includes("负责人"))).toBe(true);
    // 批次编号 → 单号形态
    expect(rows.every(r => /^[A-Z]{2}-\d{4}-\d{4}$/.test(String(r.values.lot_code)))).toBe(true);
  });

  it("认不出语义的名称字段：先摘掉「名称」再修饰，别写出断掉的中文", () => {
    // 截图里逮到的：直接拼成「标准豆种名称 1」，比原来的「豆种名称 1」还难读。
    // 「名称/名」是元词，得先摘掉 → 「特级豆种」才是人话。
    const rows = buildSeedRows(
      { id: "bean", fields: [{ id: "bean_name", name: "豆种名称", type: "string" }] },
      NOW
    );
    const vals = rows.map(r => String(r.values.bean_name));
    expect(vals.every(v => !v.includes("豆种名称"))).toBe(true);
    expect(vals.every(v => v.endsWith("豆种"))).toBe(true);
    expect(new Set(vals).size).toBe(SEED_ROW_COUNT); // 12 行不重名
  });

  it("摘不出词干就老实退回「字段名 + 序号」，不硬凑", () => {
    // 原来这条用的是「摘要」。2026-08-11 起「摘要/说明/备注」这类归了 prose 档
    // （见下面那条），不再走这个兜底，所以换一个**真的**认不出语义、又摘不出
    // 词干的字段来守这条底线。这条守的是"合成不了就别装"，跟具体挑哪个词无关。
    const rows = buildSeedRows(
      { id: "x", fields: [{ id: "flavor", name: "风味", type: "string" }] },
      NOW
    );
    expect(String(rows[0].values.flavor)).toBe("风味 1");
  });

  it("摘要/说明这类字段填一句话，不把字段名当值", () => {
    // 截图里逮到的：「经营表现摘要: 经营表现摘要 1」。上面那条兜底只对
    // "名称类"字段说得过去（「豆种 1」还像个名字，「经营表现摘要 1」不像
    // 任何东西），所以这一档单独走 proseValue。
    const rows = buildSeedRows(
      { id: "x", fields: [{ id: "memo", name: "摘要", type: "string" }] },
      NOW
    );
    const vals = rows.map(r => String(r.values.memo));
    expect(vals.every(v => !/^摘要 \d+$/.test(v))).toBe(true);
    expect(vals[0]).toContain("示例");
    // 12 行全同一句话时表格看着像渲染坏了
    expect(new Set(vals).size).toBeGreaterThan(1);
  });

  it("enum 没有声明取值时留空，不瞎编枚举", () => {
    const bare = buildSeedRows({ id: "x", fields: [{ id: "s", name: "S", type: "enum" }] }, NOW);
    expect(bare.every(r => r.values.s === "")).toBe(true);
  });
});

describe("demo-seed · 语义识别", () => {
  it("先具体后笼统：「供应商名称」是机构不是普通名称", () => {
    expect(semanticOf("supplier_name", "供应商名称")).toBe("org");
    expect(semanticOf("cupping_lead", "主评人")).toBe("person");
    expect(semanticOf("origin", "产地")).toBe("city");
    expect(semanticOf("batch_code", "批次编号")).toBe("code");
    expect(semanticOf("contact_phone", "联系电话")).toBe("phone");
    expect(semanticOf("email", "邮箱")).toBe("email");
  });

  it("下划线命名的 code 字段也要认出来", () => {
    // 老写法 /\bcode\b/ 匹配不到 record_code：`_` 是 word 字符，与 `c` 之间
    // 没有词边界。真跑截图里「杯测记录号」整列因此还是「杯测记录号 1」，
    // 而同批的 lot_code 看着正常，只是因为它中文名里带「编码」——
    // 这种"一半对一半错"最容易蒙混过关
    expect(semanticOf("record_code", "杯测记录号")).toBe("code");
    expect(semanticOf("lot_code", "")).toBe("code");
    expect(semanticOf("batch_no", "")).toBe("code");
    // 别把 decode/encode 这类词误当编号
    expect(semanticOf("decode_flag", "解码标记")).toBeNull();
  });

  it("认不出就返回 null —— 宁可少认不可认错", () => {
    // 把「风味」当人名填上「陈思源」比填「风味 1」更糟。
    //（这条原来举的例子是「备注」，2026-08-11 起它归 prose 档了；
    //  换一个仍然认不出的词，守的纪律没变。）
    expect(semanticOf("flavor", "风味")).toBeNull();
    expect(semanticOf("bean_name", "豆种名称")).toBeNull();
    expect(semanticOf("", "")).toBeNull();
  });

  it("散文档垫在最后 —— 更具体的规则先拿走它该拿的", () => {
    expect(semanticOf("note", "备注")).toBe("prose");
    expect(semanticOf("perf_summary", "经营表现摘要")).toBe("prose");
    // 「说明书编号」里的「说明」不许抢在「编号」前面
    expect(semanticOf("manual_code", "说明书编号")).toBe("code");
    expect(semanticOf("owner_note", "负责人说明")).toBe("person");
  });
});

describe("demo-seed · 随机源", () => {
  it("同一字符串种子出同一条流，不同字符串差别很大", () => {
    expect(seedFromString("a.b")).toBe(seedFromString("a.b"));
    // 只差一个字符的字段名不能落到相邻种子（老的 h*31+c 雪崩性太差）
    const s1 = seedFromString("plot.health");
    const s2 = seedFromString("plot.healthy");
    expect(Math.abs(s1 - s2)).toBeGreaterThan(1000);
  });

  it("int 落在闭区间内", () => {
    const r = fieldRandom("e", "f");
    for (let i = 0; i < 200; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
    expect(r.int(5, 5)).toBe(5);
  });
});

describe("demo-seed · 铺进状态", () => {
  it("空实体铺满，非空实体一行不碰", () => {
    const s0 = initRuntimeState(MODEL);
    const { state: withReal } = addRow(s0, "plot", { name: "我自己写的" }, "2026-07-28T00:00:00Z");
    const seeded = seedRuntimeState(withReal, MODEL, NOW);

    expect(seeded.entities.plot).toHaveLength(1); // 有真实数据 → 不铺
    expect(seeded.entities.plot[0].values.name).toBe("我自己写的");
    expect(seeded.entities.member).toHaveLength(SEED_ROW_COUNT); // 空的 → 铺满
  });

  it("幂等：铺过之后再调不重复铺，且返回同一个引用（不白触发 re-render）", () => {
    const once = seededState();
    expect(seedRuntimeState(once, MODEL, NOW)).toBe(once);
  });

  it("模型没有实体时原样返回", () => {
    const s0 = initRuntimeState(null);
    expect(seedRuntimeState(s0, { rbac: { roles: [] } } as FiveSystemModel, NOW)).toBe(s0);
  });

  it("ref 指向目标表里**真实存在**的一行", () => {
    const s = seededState();
    const memberNames = new Set(s.entities.member.map(r => String(r.values.name)));
    expect(memberNames.size).toBeGreaterThan(0);
    for (const row of s.entities.plot)
      expect(memberNames.has(String(row.values.member_ref))).toBe(true);
  });

  it("目标实体已有真实数据时，ref 也只指向那些真实行（不悬空）", () => {
    // 老实现按字段定义**推算**目标显示名，目标表没被铺种子时推出来的名字
    // 在那张表里根本不存在，引用就悬空了
    const s0 = initRuntimeState(MODEL);
    const { state: withMember } = addRow(s0, "member", { name: "真人甲" }, "2026-07-28T00:00:00Z");
    const s = seedRuntimeState(withMember, MODEL, NOW);
    expect(s.entities.member).toHaveLength(1);
    for (const row of s.entities.plot)
      expect(String(row.values.member_ref)).toBe("真人甲");
  });
});

describe("demo-seed · 与真实数据的交界", () => {
  it("entityShowsSeed：还剩种子就为 true，零行为 false（零行是空态不是示例）", () => {
    const seeded = seededState();
    expect(entityShowsSeed(seeded, "plot")).toBe(true);
    expect(seedRowCount(seeded, "plot")).toBe(SEED_ROW_COUNT);
    expect(entityShowsSeed(initRuntimeState(MODEL), "plot")).toBe(false);
    expect(entityShowsSeed(seeded, "不存在的实体")).toBe(false);
  });

  it("混表（1 真 + N 种子）仍然算「还在展示示例」—— 用 some 不用 every", () => {
    const { state: mixed } = addRow(seededState(), "plot", { name: "真数据" }, "2026-07-28T00:00:00Z");
    expect(entityShowsSeed(mixed, "plot")).toBe(true);
  });

  it("写第一条真实数据前清种子 —— 表里只剩用户自己那条", () => {
    const cleared = dropSeedRowsFor(seededState(), "plot");
    expect(cleared.entities.plot).toHaveLength(0);
    const { state: after } = addRow(cleared, "plot", { name: "真数据" }, "2026-07-28T00:00:00Z");
    expect(after.entities.plot).toHaveLength(1);
    expect(entityShowsSeed(after, "plot")).toBe(false);
    expect(after.entities.member).toHaveLength(SEED_ROW_COUNT); // 只清这一张表
  });

  it("没有种子可清时返回原引用", () => {
    const clean = initRuntimeState(MODEL);
    expect(dropSeedRowsFor(clean, "plot")).toBe(clean);
    expect(dropSeedRowsFor(clean, null)).toBe(clean);
  });

  it("编辑过的种子行不再算种子 —— 里面已经有用户真写的值了", () => {
    const seeded = seededState();
    const rowId = seeded.entities.plot[0].id;
    const edited = updateRow(seeded, "plot", rowId, { name: "我改的" });
    expect(isSeedRow(edited.entities.plot[0])).toBe(false);
    expect(edited.entities.plot[0].values.name).toBe("我改的");
    expect(edited.entities.plot[0].values.area).toBe(seeded.entities.plot[0].values.area);
    // 这一行转真了，但同表还剩 11 行种子 —— 徽标继续挂着才诚实
    expect(seedRowCount(edited, "plot")).toBe(SEED_ROW_COUNT - 1);
  });
});

describe("demo-seed · 删空之后不复活", () => {
  it("用户写了真数据又删掉 → 示例不会自己长回来", () => {
    // 实测过的老 bug：判断只看"当前行数为 0"，分不清"还没用过"和"刚清干净"，
    // 于是用户删光自己的数据、重进页面，12 条示例自己冒出来，像是没删掉
    const { state: after } = addRow(
      dropSeedRowsFor(seededState(), "plot"),
      "plot",
      { name: "我自己写的" },
      "2026-07-28T00:00:00Z"
    );
    const emptied = deleteRow(after, "plot", after.entities.plot[0].id);
    expect(emptied.entities.plot).toHaveLength(0);

    const rehydrated = seedRuntimeState(emptied, MODEL, NOW);
    expect(rehydrated.entities.plot).toHaveLength(0);
  });

  it("把整批示例逐条删光 → 也不会长回来", () => {
    let s = seededState();
    for (const r of [...s.entities.plot]) s = deleteRow(s, "plot", r.id);
    expect(seedRuntimeState(s, MODEL, NOW).entities.plot).toHaveLength(0);
  });

  it("首次遇见就已有真实数据的实体，日后删空也不会被补上示例", () => {
    const s0 = initRuntimeState(MODEL);
    const { state: withReal } = addRow(s0, "plot", { name: "真数据" }, "2026-07-28T00:00:00Z");
    const seeded = seedRuntimeState(withReal, MODEL, NOW);
    const emptied = deleteRow(seeded, "plot", seeded.entities.plot[0].id);
    expect(seedRuntimeState(emptied, MODEL, NOW).entities.plot).toHaveLength(0);
  });

  it("老状态（没有 seededEntities 字段）仍然能铺上，向后兼容", () => {
    const legacy = { ...initRuntimeState(MODEL) };
    delete (legacy as { seededEntities?: unknown }).seededEntities;
    expect(seedRuntimeState(legacy, MODEL, NOW).entities.plot).toHaveLength(SEED_ROW_COUNT);
  });
});

describe("日期铺法：最近两天必须有数据（2026-07-29）", () => {
  it("KPI 环比要能比出来 —— 最后两个桶都不能是空的", () => {
    // 纯随机散布下"昨天"落空的概率是 (13/14)^12 ≈ 41%，而一页的 KPI 通常
    // 共用同一个日期字段，一空全空——真跑的口腔诊所那版就是三张卡全显示
    //「较前一日 —」。不是渲染坏了（除零如实给 null 是对的），是种子把演示
    // 数据铺成了没法比较的形状。
    const model = {
      entities: [
        {
          id: "e",
          name: "实体",
          fields: [
            { id: "n", name: "名称", type: "string" },
            { id: "d", name: "日期", type: "date" },
          ],
        },
      ],
    } as never;
    const now = new Date("2026-07-29T10:00:00").getTime();
    // 签名是 (entity, nowMs, count)——不是 (entity, allEntities, nowMs)。
    // demo-seed.ts 里专门为这个写了防御性夹取，因为传错会把时间戳当行数。
    const rows = buildSeedRows(
      (model as { entities: unknown[] }).entities[0] as never,
      now
    );
    const keys = new Set(rows.map(r => String(r.values.d)));
    expect(keys.has("2026-07-29")).toBe(true); // 今天
    expect(keys.has("2026-07-28")).toBe(true); // 昨天 —— 环比的另一端
  });

  it("只钉两天，其余仍随机散布（趋势图要有疏密形状，不是一条平线）", () => {
    const model = {
      entities: [
        {
          id: "e",
          name: "实体",
          fields: [
            { id: "n", name: "名称", type: "string" },
            { id: "d", name: "日期", type: "date" },
          ],
        },
      ],
    } as never;
    const now = new Date("2026-07-29T10:00:00").getTime();
    // 签名是 (entity, nowMs, count)——不是 (entity, allEntities, nowMs)。
    // demo-seed.ts 里专门为这个写了防御性夹取，因为传错会把时间戳当行数。
    const rows = buildSeedRows(
      (model as { entities: unknown[] }).entities[0] as never,
      now
    );
    const distinct = new Set(rows.map(r => String(r.values.d))).size;
    // 12 行落在 14 天里：全钉死会是 12 天，全随机通常 8-10 天。
    // 只要不是"每行各占一天"（那就退回第一版的平线）就说明随机还在。
    expect(distinct).toBeLessThan(rows.length);
    expect(distinct).toBeGreaterThan(2);
  });
});
