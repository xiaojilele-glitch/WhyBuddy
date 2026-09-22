/**
 * 推演接口返回 401 时，驱动层必须把它抛成**权限异常**，不能吞成 null。
 *
 * ## 这条测试防的是一次真实线上事故（2026-08-03）
 *
 * 匿名用户在 miantuan.ai 点发送：
 *
 *   1. `POST /api/sliderule/drive-full-stream` → 401「请先登录后再推演」
 *   2. 驱动层 `if (!res.ok) return null` —— 401 和"服务挂了"返回同一个 null
 *   3. 调用方拿到 null，按约定回落**本地引擎重跑**
 *   4. 本地引擎去打 legacy 的 `/execute-capability`
 *   5. 那条路在 SLIDERULE_V5_BACKEND=python 下直接 500 thin_proxy_violation
 *
 * 用户看到的：转圈转到底，外加一个跟登录毫无关系的 500。而后端第一步就把话
 * 说清楚了——那句「请先登录后再推演」被 `return null` 整个吞掉。
 *
 * **后端守卫是对的，错的是前端把"没权限"当成了"服务坏了"。** 权限失败不是
 * 瞬时故障：不该重试、不该降级、也不该回落——本地重跑同样绕不过登录，后端
 * 每个写接口都会再拦一次。
 *
 * 所以这里钉两件事：
 *   ① 401 抛 DriveAuthRequiredError（且带着后端那句人话）
 *   ② 其余失败仍然维持 return null 的老约定——降级路径本身是对的，
 *      不能因为修这个 bug 把它一起改掉
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DriveAuthRequiredError,
  driveFullViaPython,
  driveFullViaPythonStream,
} from "../sliderule-marathon-driver";

const STATE = { sessionId: "s-1", goal: { text: "做一个工单系统" } } as never;

function stubFetch(res: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 后端 401 的真实回包形状（照抄线上抓到的那一份）。 */
function unauthorized(message = "请先登录后再推演") {
  const body = {
    message,
    status: "error",
    backend: "slide-rule-python",
    source: "python",
    provenance: "backend:slide-rule-python",
    degraded: true,
  };
  return {
    ok: false,
    status: 401,
    body: {},
    clone: () => ({ json: async () => body }),
    json: async () => body,
  };
}

describe("401 必须抛权限异常，不能吞成 null", () => {
  it("流式接口：抛 DriveAuthRequiredError，并带上后端那句人话", async () => {
    stubFetch(unauthorized());
    await expect(driveFullViaPythonStream(STATE, "做一个工单系统")).rejects.toThrow(
      DriveAuthRequiredError
    );
  });

  it("异常里保留后端原文——前端不要自己另编一句", async () => {
    stubFetch(unauthorized("请先登录后再推演"));
    await driveFullViaPythonStream(STATE, "x").then(
      () => {
        throw new Error("应当抛异常");
      },
      (err: Error) => {
        expect(err.message).toContain("请先登录");
        // needsLogin 是调用方用来分流的标记（它不 import 这个类）
        expect((err as DriveAuthRequiredError).needsLogin).toBe(true);
      }
    );
  });

  it("非流式接口同样抛——两条路都要挡住，否则换条路照样掉进兜底", async () => {
    stubFetch(unauthorized());
    await expect(driveFullViaPython(STATE, "x")).rejects.toThrow(DriveAuthRequiredError);
  });

  it("推演请求显式带上 Cookie（credentials include）", async () => {
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal("fetch", fetchMock);
    await driveFullViaPythonStream(STATE, "x").catch(() => undefined);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });
});

describe("其余失败维持原约定（降级路径本身是对的）", () => {
  it("500 仍然返回 null，不抛", async () => {
    stubFetch({ ok: false, status: 500, body: {}, clone: () => ({ json: async () => ({}) }), json: async () => ({}) });
    await expect(driveFullViaPythonStream(STATE, "x")).resolves.toBeNull();
  });

  it("网络异常仍然返回 null，不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );
    await expect(driveFullViaPythonStream(STATE, "x")).resolves.toBeNull();
  });

  it("200 但回包不是 python 权威：仍然返回 null（走降级）", async () => {
    const body = { backend: "node", state: null };
    stubFetch({ ok: true, status: 200, clone: () => ({ json: async () => body }), json: async () => body });
    await expect(driveFullViaPython(STATE, "x")).resolves.toBeNull();
  });
});
