// @vitest-environment jsdom
/**
 * 这一轮挂了哪些能力。
 *
 * 重点是**读存档时逐条验形状**：不验不会报错，只会让载荷里多出一条脏数据，
 * 后端找不到就静静跳过——用户勾了能力却没生效，全链路没有一处报警。
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { SlashItem } from "../composer-slash";
import {
  loadTurnCapabilities,
  pickedConnectorIds,
  readTurnCapabilities,
  saveTurnCapabilities,
  turnCapabilitiesPayload,
  writeTurnCapabilities,
} from "../turn-capabilities";

const W: SlashItem = {
  key: "weather",
  kind: "connector",
  name: "天气",
  description: "取真实天气",
};
const S: SlashItem = {
  key: "frontend-design",
  kind: "skill",
  name: "frontend-design",
  description: "界面风格",
};

beforeEach(() => window.localStorage.clear());

describe("存档", () => {
  it("存了能读回来", () => {
    saveTurnCapabilities([W, S]);
    expect(loadTurnCapabilities().map(i => i.key)).toEqual([
      "weather",
      "frontend-design",
    ]);
  });

  it("没存过返回空数组，不是 null", () => {
    expect(loadTurnCapabilities()).toEqual([]);
  });

  it("存档坏了返回空，不抛", () => {
    expect(readTurnCapabilities("{不是 json")).toEqual([]);
    expect(readTurnCapabilities("null")).toEqual([]);
    expect(readTurnCapabilities('{"a":1}')).toEqual([]);
    expect(readTurnCapabilities(null)).toEqual([]);
  });
});

describe("逐条验形状", () => {
  it("缺 key / kind 不认的条目被剔掉，好的留下", () => {
    const raw = JSON.stringify([
      W,
      { kind: "connector" }, // 缺 key
      { key: "x", kind: "connector" }, // 缺 name
      { key: "y", kind: "外星人", name: "y" }, // kind 不认
      { key: "", kind: "skill", name: "空 key" },
      S,
    ]);
    const out = readTurnCapabilities(raw);
    expect(out.map(i => i.key)).toEqual(["weather", "frontend-design"]);
  });

  it("重复的只留一条（同 kind 同 key）", () => {
    const raw = JSON.stringify([W, { ...W }, S]);
    expect(readTurnCapabilities(raw)).toHaveLength(2);
  });

  it("同名但不同类型的不算重复", () => {
    const raw = JSON.stringify([
      { key: "same", kind: "skill", name: "A" },
      { key: "same", kind: "connector", name: "B" },
    ]);
    expect(readTurnCapabilities(raw)).toHaveLength(2);
  });

  it("描述缺失补空串，不留 undefined 进载荷", () => {
    const raw = JSON.stringify([{ key: "k", kind: "skill", name: "n" }]);
    expect(readTurnCapabilities(raw)[0]!.description).toBe("");
  });
});

describe("载荷", () => {
  it("只带 kind + key，描述文案不许进推演", () => {
    const payload = turnCapabilitiesPayload([W, S]);
    expect(payload).toEqual([
      { kind: "connector", key: "weather" },
      { kind: "skill", key: "frontend-design" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("取真实天气");
  });

  it("挑得出连接器 id（取数那一步用）", () => {
    expect(pickedConnectorIds([W, S])).toEqual(["weather"]);
    expect(pickedConnectorIds([S])).toEqual([]);
  });
});

describe("往返", () => {
  it("write → read 不丢东西", () => {
    expect(readTurnCapabilities(writeTurnCapabilities([W, S]))).toEqual([W, S]);
  });
});
