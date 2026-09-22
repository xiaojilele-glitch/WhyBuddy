/**
 * 连接器真数据落进运行时。
 *
 * 这个文件的核心不是"行进来了"，是**"假的进不来"**：
 *   - 绑了连接器的实体永远不铺演示种子（正反两条）
 *   - 取数失败（零行）时停在诚实空态，而不是回落成种子
 *   - 真实行带来源与取数时间，跟种子行的标记互斥
 */
import { describe, expect, it } from "vitest";

import {
  applyConnectorRows,
  entityShowsLive,
  isConnectorBound,
  isLiveRow,
  liveBadgeText,
  liveMeta,
  unbindConnector,
} from "../connector-rows";
import { entityShowsSeed, seedRuntimeState } from "../demo-seed";
import { initRuntimeState } from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";

const MODEL = {
  datamodel: {
    entities: [
      {
        id: "weather_daily",
        name: "天气预报",
        fields: [
          { id: "date", name: "日期", type: "date" },
          { id: "city", name: "城市", type: "text" },
          { id: "temp_max", name: "最高温", type: "number" },
        ],
      },
      {
        id: "note",
        name: "备忘",
        fields: [{ id: "title", name: "标题", type: "text" }],
      },
    ],
  },
} as unknown as FiveSystemModel;

const META = {
  connector: "weather",
  source: "Open-Meteo · 北京",
  fetchedAt: "2026-08-25T21:26:38+0800",
};

const ROWS = [
  { id: "weather-北京-2026-08-26", values: { date: "2026-08-26", city: "北京", temp_max: 24.8 } },
  { id: "weather-北京-2026-08-27", values: { date: "2026-08-27", city: "北京", temp_max: 29.5 } },
];

describe("真数据进来", () => {
  it("行落到对的实体上，值原样保留", () => {
    const s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    expect(s.entities.weather_daily).toHaveLength(2);
    expect(s.entities.weather_daily![0]!.values.temp_max).toBe(24.8);
  });

  it("每一行都带来源与取数时间，且不是种子", () => {
    const s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    for (const row of s.entities.weather_daily!) {
      expect(isLiveRow(row)).toBe(true);
      expect(row.live!.source).toBe("Open-Meteo · 北京");
      expect(row.live!.fetchedAt).toBe(META.fetchedAt);
      // 两个标记互斥：真实行绝不能同时挂着「示例数据」
      expect(row.seed).toBeUndefined();
    }
    expect(entityShowsLive(s, "weather_daily")).toBe(true);
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
  });

  it("重复取数按 id 覆盖，不叠加", () => {
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = applyConnectorRows(s, "weather_daily", ROWS, { ...META, fetchedAt: "T2" });
    expect(s.entities.weather_daily).toHaveLength(2);
    expect(s.entities.weather_daily![0]!.live!.fetchedAt).toBe("T2");
  });

  it("用户自己写进这张表的行**保留**——他写的不是我们的取数结果", () => {
    let s = initRuntimeState(MODEL);
    s = {
      ...s,
      entities: { ...s.entities, weather_daily: [{ id: "mine", values: { city: "我写的" } }] },
    };
    s = applyConnectorRows(s, "weather_daily", ROWS, META);
    const ids = s.entities.weather_daily!.map(r => r.id);
    expect(ids).toContain("mine");
    expect(ids).toHaveLength(3);
  });
});

describe("绑了连接器的实体不许铺演示种子", () => {
  it("正面：连接器实体是真行，隔壁普通实体照常铺种子", () => {
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = seedRuntimeState(s, MODEL, Date.UTC(2026, 7, 25));
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
    expect(entityShowsLive(s, "weather_daily")).toBe(true);
    // 反面的反面：这条规则不许误伤普通实体
    expect(entityShowsSeed(s, "note")).toBe(true);
  });

  it("反面：取数失败（零行）时停在诚实空态，**不许**回落成种子", () => {
    /*
     * ⚠ 这一条是整个模块的命门。取不到数的时候页面空着是对的——页面自己会
     *   出「数据源没接上」。铺 12 行种子不报错、还更好看，只有数字是假的。
     */
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", [], META);
    s = seedRuntimeState(s, MODEL, Date.UTC(2026, 7, 25));
    expect(s.entities.weather_daily).toEqual([]);
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
  });

  it("反面：用户把连接器行删空之后也不许长出种子", () => {
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = { ...s, entities: { ...s.entities, weather_daily: [] } };
    s = seedRuntimeState(s, MODEL, Date.UTC(2026, 7, 25));
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
  });

  it("先铺过种子的实体，后来绑了连接器 → 真行进来，种子不再回头", () => {
    let s = seedRuntimeState(initRuntimeState(MODEL), MODEL, Date.UTC(2026, 7, 25));
    expect(entityShowsSeed(s, "weather_daily")).toBe(true);
    s = applyConnectorRows(s, "weather_daily", ROWS, META);
    s = seedRuntimeState(s, MODEL, Date.UTC(2026, 7, 25));
    expect(isConnectorBound(s, "weather_daily")).toBe(true);
    expect(s.entities.weather_daily!.filter(r => r.live)).toHaveLength(2);
  });
});

describe("绑定关系", () => {
  it("即使零行也记下绑定——不然下一次 seed 会把它当成没主的空表", () => {
    const s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", [], META);
    expect(isConnectorBound(s, "weather_daily")).toBe(true);
    expect(liveMeta(s, "weather_daily")?.source).toBe("Open-Meteo · 北京");
  });

  it("解绑之后行留着——已经取到的是真的，没理由删", () => {
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = unbindConnector(s, "weather_daily");
    expect(isConnectorBound(s, "weather_daily")).toBe(false);
    expect(s.entities.weather_daily).toHaveLength(2);
  });

  it("空实体 id 不改状态（引用相等）", () => {
    const s = initRuntimeState(MODEL);
    expect(applyConnectorRows(s, "", ROWS, META)).toBe(s);
    expect(unbindConnector(s, null)).toBe(s);
  });
});

describe("徽标文案", () => {
  it("说清来源和几点取的", () => {
    expect(liveBadgeText(META)).toBe("实时 · Open-Meteo · 北京 · 21:26 取");
  });

  it("没绑连接器就没有徽标——空字符串，不是「实时 · undefined」", () => {
    expect(liveBadgeText(null)).toBe("");
    expect(liveBadgeText({ connector: "x", source: "", fetchedAt: "" })).toBe("实时");
  });
});

describe("真数据来了，种子必须整批清掉", () => {
  it("先铺过种子的表绑上连接器：一行种子都不许剩", () => {
    /*
     * ⚠ 第一版漏了这条，判据也漏了：只断言"live 行有 2 条"，而那时表里
     *   是 12 行编的 + 2 行真的混在一起，判据照样全绿。demo-seed 自己的
     *   纪律写着"种子和真实数据绝不混在同一张表里"。
     */
    let s = seedRuntimeState(initRuntimeState(MODEL), MODEL, Date.UTC(2026, 7, 25));
    const seeded = s.entities.weather_daily!.length;
    expect(seeded).toBeGreaterThan(2);

    s = applyConnectorRows(s, "weather_daily", ROWS, META);
    expect(s.entities.weather_daily).toHaveLength(2);
    expect(s.entities.weather_daily!.every(r => !r.seed)).toBe(true);
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
  });

  it("取数失败时也清——空表比混着 12 行假数据诚实", () => {
    let s = seedRuntimeState(initRuntimeState(MODEL), MODEL, Date.UTC(2026, 7, 25));
    s = applyConnectorRows(s, "weather_daily", [], META);
    expect(s.entities.weather_daily).toEqual([]);
  });
});

describe("行 id 撞车", () => {
  it("用户的行和取回来的行撞了 id：只留一条，且是真实那条", () => {
    let s = initRuntimeState(MODEL);
    s = {
      ...s,
      entities: {
        ...s.entities,
        weather_daily: [{ id: ROWS[0]!.id, values: { city: "我早先写的" } }],
      },
    };
    s = applyConnectorRows(s, "weather_daily", ROWS, META);
    const hit = s.entities.weather_daily!.filter(r => r.id === ROWS[0]!.id);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.live).toBeTruthy();
    expect(hit[0]!.values.city).toBe("北京");
  });
});

describe("徽标从状态自己推出来（不靠战报）", () => {
  it("取到了：说清来源、几点取的、几行", async () => {
    const { liveStatuses, liveStatusText } = await import("../connector-rows");
    const s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    const list = liveStatuses(s);
    expect(list).toHaveLength(1);
    expect(list[0]!.rows).toBe(2);
    expect(list[0]!.empty).toBe(false);
    expect(liveStatusText(list)).toBe("实时 · Open-Meteo · 北京 · 21:26 取 · 2 行");
  });

  it("绑了但一行都没有 = 没接上，**必须说出来**", async () => {
    /*
     * ⚠ 这是"取不到就空着并说明原因"在页面上的落点。只标「实时 · 0 行」
     *   用户读不出发生了什么；空着什么都不标，他会以为应用本来就没数据。
     */
    const { liveStatuses, liveStatusText } = await import("../connector-rows");
    const s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", [], META);
    expect(liveStatuses(s)[0]!.empty).toBe(true);
    expect(liveStatusText(liveStatuses(s))).toContain("没接上");
  });

  it("没绑连接器就没有徽标（不是显示一个空徽标）", async () => {
    const { liveStatuses, liveStatusText } = await import("../connector-rows");
    expect(liveStatuses(initRuntimeState(MODEL))).toEqual([]);
    expect(liveStatuses(null)).toEqual([]);
    expect(liveStatusText([])).toBe("");
  });

  it("用户手写的行不算进「实时几行」", async () => {
    const { liveStatuses } = await import("../connector-rows");
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = {
      ...s,
      entities: {
        ...s.entities,
        weather_daily: [...s.entities.weather_daily!, { id: "mine", values: {} }],
      },
    };
    expect(liveStatuses(s)[0]!.rows).toBe(2);
  });
});

describe("只读预览：标记但不取数", () => {
  it("标记过的实体不铺种子，并显示「预览不取数」而不是「没接上」", async () => {
    /*
     * ⚠ 挂了天气的应用在应用市场卡片里显示 12 行编出来的温度，是这条链路
     *   最丢人的失败形态：用户在自己机器上看是真的，分享出去别人看到的是
     *   假的，两边都不报错。
     *
     * ⚠ 同时钉住**说辞要对**：预览没取数 ≠ 数据源坏了。都写成"没接上"
     *   会让人以为线上应用挂了。
     */
    const { markConnectorEntities, liveStatuses, liveStatusText } = await import(
      "../connector-rows"
    );
    let s = markConnectorEntities(
      initRuntimeState(MODEL),
      ["weather_daily"],
      "预览里不取实时数据"
    );
    s = seedRuntimeState(s, MODEL, Date.UTC(2026, 7, 25));
    expect(s.entities.weather_daily).toEqual([]);
    expect(entityShowsSeed(s, "weather_daily")).toBe(false);
    // 反面的反面：不许误伤普通实体
    expect(entityShowsSeed(s, "note")).toBe(true);
    expect(liveStatusText(liveStatuses(s))).toBe("预览里不取实时数据");
  });

  it("已经有真数据的实体，标记不会把它清空", async () => {
    const { markConnectorEntities } = await import("../connector-rows");
    let s = applyConnectorRows(initRuntimeState(MODEL), "weather_daily", ROWS, META);
    s = markConnectorEntities(s, ["weather_daily"], "预览里不取实时数据");
    expect(s.entities.weather_daily).toHaveLength(2);
    expect(liveMeta(s, "weather_daily")?.source).toBe("Open-Meteo · 北京");
  });

  it("这个应用没有的表**不标**——不然待办应用会凭空挂上一枚天气徽标", async () => {
    /*
     * ⚠ 传进来的是"注册表里所有连接器的实体 id"，跟连接器八竿子打不着的
     *   应用也会收到这份清单。不筛的话，一个待办应用会显示
     *   「预览里不取实时数据」，指着一张它根本没有的表。
     *   第一版就是这么写的，而且判据还把这个错的行为钉住了——判据自己
     *   先要对得起题。
     */
    const { markConnectorEntities, liveStatuses } = await import("../connector-rows");
    const s = markConnectorEntities(
      initRuntimeState(MODEL),
      ["", "unknown", "weather_daily"],
      "x"
    );
    expect(liveStatuses(s).map(x => x.entityId)).toEqual(["weather_daily"]);
  });
});
