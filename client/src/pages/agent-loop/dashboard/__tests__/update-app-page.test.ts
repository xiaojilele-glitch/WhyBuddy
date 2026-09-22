/**
 * updateAppPage：点选编辑器保存一页 HTML 的前端客户端函数
 * （对应后端 PATCH /apps/{id}/pages/{pageId}）。
 *
 * 跟 patchApp 不一样的地方是判据的重点：失败**必须**把后端给的话原样带出来
 * （不能只回 false/null），点选编辑器面向的是非技术用户，静默失败等于
 * 东西丢了都不知道——这条跟 CLAUDE.md 第三条"闸全绿但东西没了"是同一类坑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { updateAppPage } from "../app-store-client";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("updateAppPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("成功：返回 ok + 后端报的字节数", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "a1", pageId: "p1", bytes: 1234 }));
    const res = await updateAppPage("a1", "p1", "<html></html>");
    // warn = 后端 lossesMessage。没带就是空串——**不是 undefined**，
    // 调用方 `res.warn || "已改好"` 才走得通。
    expect(res).toEqual({ ok: true, bytes: 1234, warn: "" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sliderule/apps/a1/pages/p1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ html: "<html></html>" });
  });

  it("appId / pageId 里的特殊字符要编码进 URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { bytes: 1 }));
    await updateAppPage("a/1", "p 1", "<x/>");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sliderule/apps/a%2F1/pages/p%201");
  });

  it("反向：失败必须把后端 message 原样带回去，不能吞掉", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: "html 不能为空" }));
    const res = await updateAppPage("a1", "p1", "");
    expect(res).toEqual({ ok: false, error: "html 不能为空" });
  });

  it("失败且没有 message 时退回 detail 字段", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "页面 'p9' 不存在于这个应用里" }));
    const res = await updateAppPage("a1", "p9", "<x/>");
    expect(res).toEqual({ ok: false, error: "页面 'p9' 不存在于这个应用里" });
  });

  it("失败且响应体也解析不出话时给一个带状态码的兜底提示", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    const res = await updateAppPage("a1", "p1", "<x/>");
    expect(res).toEqual({ ok: false, error: "保存失败（HTTP 500）" });
  });

  it("网络异常（fetch 抛错）不让调用方崩，给出中文提示", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await updateAppPage("a1", "p1", "<x/>");
    expect(res).toEqual({ ok: false, error: "网络请求失败，请检查连接后重试" });
  });

  /**
   * 「存进去了，但顺手带走了东西」得原样带回来。
   *
   * ⚠ 2026-09-05：后端 page_edit_guard 数出了缺口、`PATCH` 也把它透出来了，
   *   而这一层**把字段丢在地上**，三个写回点全都只显「已保存 / 已改好」。
   *   生成侧加了字段、消费侧没接——没有报错、没有告警、判据全绿。
   */
  it("后端说带走了东西，warn 要原样带回来", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        bytes: 9,
        losses: [{ kind: "scripts", label: "页面脚本", before: 2, after: 1, lost: 1 }],
        lossesMessage: "这次保存顺手带走了：页面脚本 2→1。",
      })
    );
    const res = await updateAppPage("a1", "p1", "<x/>");
    expect(res).toEqual({
      ok: true,
      bytes: 9,
      warn: "这次保存顺手带走了：页面脚本 2→1。",
    });
  });

  it("反向配对：措辞不许前端自己拼（后端没给就是空串）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { bytes: 9, losses: [] }));
    const res = await updateAppPage("a1", "p1", "<x/>");
    expect(res).toEqual({ ok: true, bytes: 9, warn: "" });
  });
});
