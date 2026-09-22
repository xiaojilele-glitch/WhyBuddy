/**
 * aiEditElement：点选编辑器"✨ AI 编辑"按钮的前端客户端函数
 * （对应后端 POST /apps/{id}/pages/{pageId}/ai-edit-element）。
 *
 * 跟 updateAppPage 同一条纪律：失败必须把后端原话带回去，不能吞成 null/false。
 * 这里额外钉一条：**没有内容也算失败**——后端理论上不该回空 html，
 * 但真返回了空的话，前端把空字符串当成"改好了"直接换掉选中元素，
 * 用户会看着一个元素凭空消失，那比接口报错更难查。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { aiEditElement } from "../app-store-client";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("aiEditElement", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("成功：把改过的 html 带回去", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { html: "<h1>改好了</h1>" }));
    const res = await aiEditElement("a1", "p1", "<h1>原文</h1>", "改成更醒目的标题");
    expect(res).toEqual({ ok: true, html: "<h1>改好了</h1>" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sliderule/apps/a1/pages/p1/ai-edit-element");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      elementHtml: "<h1>原文</h1>",
      instruction: "改成更醒目的标题",
    });
  });

  it("appId / pageId 里的特殊字符要编码进 URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { html: "<p>x</p>" }));
    await aiEditElement("a/1", "p 1", "<p></p>", "改一下");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sliderule/apps/a%2F1/pages/p%201/ai-edit-element");
  });

  it("反向：失败必须把后端 message 原样带回去，不能吞掉", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { message: "AI 编辑没开（SLIDERULE_LLM_GENERATE_ENABLED 未开启）" }));
    const res = await aiEditElement("a1", "p1", "<p></p>", "改一下");
    expect(res).toEqual({ ok: false, error: "AI 编辑没开（SLIDERULE_LLM_GENERATE_ENABLED 未开启）" });
  });

  it("反向：后端回了 200 但 html 是空字符串，也算失败——不能拿空内容去换选中元素", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { html: "" }));
    const res = await aiEditElement("a1", "p1", "<p></p>", "改一下");
    expect(res.ok).toBe(false);
  });

  it("反向：后端回了 200 但没有 html 字段，同样算失败", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const res = await aiEditElement("a1", "p1", "<p></p>", "改一下");
    expect(res.ok).toBe(false);
  });

  it("失败且没有 message 时退回 detail 字段", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "app not found" }));
    const res = await aiEditElement("a1", "p1", "<p></p>", "改一下");
    expect(res).toEqual({ ok: false, error: "app not found" });
  });

  it("网络异常（fetch 抛错）不让调用方崩，给出中文提示", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await aiEditElement("a1", "p1", "<p></p>", "改一下");
    expect(res).toEqual({ ok: false, error: "网络请求失败，请检查连接后重试" });
  });
});
