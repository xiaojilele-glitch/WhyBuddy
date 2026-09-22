/**
 * 推演完成后的连接器取数。
 *
 * 三条反向判据最重要：
 *   - 模型里没有这张表 → 如实 skipped，**不凭空塞实体**
 *   - 取数失败 → 表照样绑上（否则种子会铺上来），并且如实 failed
 *   - 一个连接器都没挂 → 状态引用不变（不白触发一次持久化）
 */
import { describe, expect, it, vi } from "vitest";

import { hydrateConnectors, hydrateSummary } from "../hydrate-connectors";
import { isConnectorBound } from "../connector-rows";
import { entityShowsSeed, seedRuntimeState } from "../demo-seed";
import { initRuntimeState } from "../live-runtime";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import type { ConnectorSpec } from "../../connectors-client";

const SPEC: ConnectorSpec = {
  id: "weather",
  name: "天气",
  description: "",
  entityId: "weather_daily",
  entityName: "天气预报",
  source: "Open-Meteo",
  available: true,
  args: [{ id: "city", name: "城市", placeholder: "北京", default: "北京", required: true }],
  fields: [
    { id: "date", name: "日期", type: "date" },
    { id: "city", name: "城市", type: "text" },
  ],
};

const MODEL_WITH = {
  datamodel: {
    entities: [
      { id: "weather_daily", name: "天气预报", fields: [{ id: "date", name: "日期", type: "date" }] },
      { id: "note", name: "备忘", fields: [{ id: "t", name: "标题", type: "text" }] },
    ],
  },
} as unknown as FiveSystemModel;

const MODEL_WITHOUT = {
  datamodel: {
    entities: [{ id: "note", name: "备忘", fields: [{ id: "t", name: "标题", type: "text" }] }],
  },
} as unknown as FiveSystemModel;

const okRes = (rows: number) => ({
  ok: true,
  connectorId: "weather",
  entityId: "weather_daily",
  rows: Array.from({ length: rows }, (_, i) => ({
    id: `r${i}`,
    values: { date: `2026-08-2${i}`, city: "北京" },
  })),
  source: "Open-Meteo · 北京",
  fetchedAt: "2026-08-25T22:00:00+0800",
  error: "",
});

const failRes = (error: string) => ({
  ok: false,
  connectorId: "weather",
  entityId: "weather_daily",
  rows: [],
  source: "",
  fetchedAt: "",
  error,
});

describe("取到了", () => {
  it("行落进对应实体，战报说清来源和行数", async () => {
    const { state, outcome } = await hydrateConnectors({
      state: initRuntimeState(MODEL_WITH),
      model: MODEL_WITH,
      connectorIds: ["weather"],
      specs: [SPEC],
      fetchRows: async () => okRes(7),
    });
    expect(state.entities.weather_daily).toHaveLength(7);
    expect(outcome.applied).toEqual([
      { connectorId: "weather", entityId: "weather_daily", rows: 7, source: "Open-Meteo · 北京" },
    ]);
    expect(hydrateSummary(outcome)).toContain("7 行");
  });

  it("没填参数时用 spec 里的默认值", async () => {
    const seen: Array<Record<string, string>> = [];
    await hydrateConnectors({
      state: initRuntimeState(MODEL_WITH),
      model: MODEL_WITH,
      connectorIds: ["weather"],
      specs: [SPEC],
      fetchRows: async (_id, args) => {
        seen.push(args);
        return okRes(1);
      },
    });
    expect(seen[0]).toEqual({ city: "北京" });
  });

  it("用户填过参数就用他填的", async () => {
    const seen: Array<Record<string, string>> = [];
    await hydrateConnectors({
      state: initRuntimeState(MODEL_WITH),
      model: MODEL_WITH,
      connectorIds: ["weather"],
      specs: [SPEC],
      argsById: { weather: { city: "上海" } },
      fetchRows: async (_id, args) => {
        seen.push(args);
        return okRes(1);
      },
    });
    expect(seen[0]).toEqual({ city: "上海" });
  });
});

describe("取不到 / 落不了地：都要如实说，而且不许让种子补上", () => {
  it("取数失败：表照样绑上（不然种子会铺上来），并如实记 failed", async () => {
    /*
     * ⚠ 这一条是整个文件的命门。失败时跳过 applyConnectorRows 看着"很自然"
     *   （反正没数据），但那样这张表就没有"绑了连接器"的凭据，
     *   紧接着 seedRuntimeState 会把 12 行编的数字铺上去——用户挂了连接器，
     *   最后看到的是假数据，全链路没有一处报警。
     */
    const { state, outcome } = await hydrateConnectors({
      state: initRuntimeState(MODEL_WITH),
      model: MODEL_WITH,
      connectorIds: ["weather"],
      specs: [SPEC],
      fetchRows: async () => failRes("没有找到城市「zzz」"),
    });
    expect(outcome.failed[0]!.error).toContain("zzz");
    expect(isConnectorBound(state, "weather_daily")).toBe(true);

    const seeded = seedRuntimeState(state, MODEL_WITH, Date.UTC(2026, 7, 25));
    expect(seeded.entities.weather_daily).toEqual([]);
    expect(entityShowsSeed(seeded, "weather_daily")).toBe(false);
    // 反面的反面：这条规则不许误伤隔壁普通实体
    expect(entityShowsSeed(seeded, "note")).toBe(true);
  });

  it("模型里没有这张表：如实 skipped，**不凭空塞一个实体**", async () => {
    const { state, outcome } = await hydrateConnectors({
      state: initRuntimeState(MODEL_WITHOUT),
      model: MODEL_WITHOUT,
      connectorIds: ["weather"],
      specs: [SPEC],
      fetchRows: async () => okRes(7),
    });
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0]!.reason).toContain("天气预报");
    // 凭空塞进去不会报错，页面上也没人引用它——"成功但什么都没变"
    expect(state.entities.weather_daily).toBeUndefined();
    expect(isConnectorBound(state, "weather_daily")).toBe(false);
  });

  it("模型里没这张表时不该白打一次网络请求", async () => {
    const spy = vi.fn(async () => okRes(1));
    await hydrateConnectors({
      state: initRuntimeState(MODEL_WITHOUT),
      model: MODEL_WITHOUT,
      connectorIds: ["weather"],
      specs: [SPEC],
      fetchRows: spy,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("这台机器上没有这个连接器：如实 skipped", async () => {
    const { outcome } = await hydrateConnectors({
      state: initRuntimeState(MODEL_WITH),
      model: MODEL_WITH,
      connectorIds: ["不存在"],
      specs: [SPEC],
      fetchRows: async () => okRes(1),
    });
    expect(outcome.skipped[0]!.connectorId).toBe("不存在");
  });
});

describe("没挂连接器", () => {
  it("状态引用不变，也不打请求（不白触发一次持久化）", async () => {
    const s0 = initRuntimeState(MODEL_WITH);
    const spy = vi.fn(async () => okRes(1));
    const { state, outcome } = await hydrateConnectors({
      state: s0,
      model: MODEL_WITH,
      connectorIds: [],
      specs: [SPEC],
      fetchRows: spy,
    });
    expect(state).toBe(s0);
    expect(spy).not.toHaveBeenCalled();
    expect(hydrateSummary(outcome)).toBe("");
  });
});
