/**
 * 连接器前端口。
 *
 * 重点全在**失败路径**：后端故意把取数失败做成 200 + ok:false，
 * 只看 res.ok 的写法会把"没取到"当成"取到了 0 行"，两者对用户完全不同。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchConnectorRows, listConnectors } from "../connectors-client";

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const out = impl(String(url), init);
    if (out instanceof Error) throw out;
    const { status = 200, body = {} } = out as { status?: number; body?: unknown };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("清单", () => {
  it("正常返回数组", async () => {
    mockFetch(() => ({ body: { connectors: [{ id: "weather", name: "天气" }] } }));
    expect((await listConnectors()).map(c => c.id)).toEqual(["weather"]);
  });

  it("后端抖动时当成空清单，不抛——它挂在输入框上，不能让人连字都打不了", async () => {
    mockFetch(() => new Error("boom"));
    await expect(listConnectors()).resolves.toEqual([]);
    mockFetch(() => ({ status: 500 }));
    await expect(listConnectors()).resolves.toEqual([]);
  });

  it("返回体不是数组时也回空，不把脏数据丢给渲染层", async () => {
    mockFetch(() => ({ body: { connectors: "nope" } }));
    await expect(listConnectors()).resolves.toEqual([]);
  });
});

describe("取数", () => {
  it("成功时把行、来源、取数时间原样带回", async () => {
    mockFetch(() => ({
      body: {
        ok: true,
        connectorId: "weather",
        entityId: "weather_daily",
        rows: [{ id: "r1", values: { city: "北京" } }],
        source: "Open-Meteo · 北京",
        fetchedAt: "T0",
        error: "",
      },
    }));
    const r = await fetchConnectorRows("weather", { city: "北京" });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.source).toBe("Open-Meteo · 北京");
    expect(r.fetchedAt).toBe("T0");
  });

  it("200 + ok:false 是失败，不是'取到了 0 行'", async () => {
    mockFetch(() => ({ body: { ok: false, rows: [], error: "没有找到城市「zzz」" } }));
    const r = await fetchConnectorRows("weather", { city: "zzz" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("zzz");
  });

  it("ok:false 却带着行时，行必须被清掉", async () => {
    /*
     * ⚠ 这条判据钉的是"两边都守一次"。后端已经保证 ok:false → rows:[]，
     *   但那是**另一处代码**；只要有一处破了，页面就会铺满"取失败了但还是
     *   有数"的假数据——而这正是整条链路要消灭的东西。
     */
    mockFetch(() => ({
      body: { ok: false, rows: [{ id: "x", values: { city: "编的" } }], error: "超时" },
    }));
    const r = await fetchConnectorRows("weather", {});
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it("HTTP 错误码也如实报错，并带上后端的话", async () => {
    mockFetch(() => ({ status: 403, body: { detail: "内部密钥不对" } }));
    const r = await fetchConnectorRows("weather", {});
    expect(r.ok).toBe(false);
    expect(r.error).toBe("内部密钥不对");
    expect(r.rows).toEqual([]);
  });

  it("网络直接炸也返回结构化失败，不抛给调用方", async () => {
    mockFetch(() => new Error("ECONNRESET"));
    const r = await fetchConnectorRows("stock", { symbols: "600519" });
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.error).toContain("ECONNRESET");
  });

  it("连接器 id 进 URL 时转义（别让 id 拼出别的路径）", async () => {
    const seen: string[] = [];
    mockFetch(url => {
      seen.push(url);
      return { body: { ok: true, rows: [] } };
    });
    await fetchConnectorRows("a/b", {});
    expect(seen[0]).toContain("connectors/a%2Fb/rows");
  });
});
