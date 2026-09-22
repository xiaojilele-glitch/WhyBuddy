/**
 * E31 附件提取（前端侧）：图片/PDF 分路识别 + 服务端提取回执的诚实归一。
 * 网络层 mock——管线活体验证走 e2e（verify-e31-attachments.mjs）。
 *
 * 2026-08-20 补：解析中不许发送。判据必须能被变异咬住——
 * 只禁按钮、doSend 仍等提取再发 = 假绿；failed 也当 pending = 失败就把发送锁死。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractAttachmentRemote,
  isAttachmentExtractPending,
  isComposerSendBlocked,
  isExtractableAttachment,
} from "../ComposerDock";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("isExtractableAttachment", () => {
  it("图片与 PDF 走服务端提取", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.pdf", "G.PDF"]) {
      expect(isExtractableAttachment(name)).toBe(true);
    }
  });

  it("文本类与未知类型不走服务端提取", () => {
    for (const name of ["a.txt", "b.md", "c.csv", "d.zip", "e.docx", "noext"]) {
      expect(isExtractableAttachment(name)).toBe(false);
    }
  });
});

describe("isAttachmentExtractPending / isComposerSendBlocked", () => {
  it("任一 pending 就算解析中；ready/failed/无状态都不算", () => {
    expect(isAttachmentExtractPending([{ extractStatus: "pending" }])).toBe(true);
    expect(
      isAttachmentExtractPending([
        { extractStatus: "ready" },
        { extractStatus: "pending" },
      ])
    ).toBe(true);
    expect(isAttachmentExtractPending([{ extractStatus: "ready" }])).toBe(false);
    expect(isAttachmentExtractPending([{ extractStatus: "failed" }])).toBe(false);
    expect(isAttachmentExtractPending([{}])).toBe(false);
    expect(isAttachmentExtractPending([])).toBe(false);
  });

  it("解析中锁发送；失败/已解析不锁；推演中空输入仍灰", () => {
    const pending = [{ extractStatus: "pending" as const }];
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "做个审批",
        attachments: pending,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "",
        attachments: pending,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "做个审批",
        attachments: [{ extractStatus: "failed" }],
      })
    ).toBe(false);
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "做个审批",
        attachments: [{ extractStatus: "ready" }],
      })
    ).toBe(false);
    expect(
      isComposerSendBlocked({ isRunning: false, input: "", attachments: [] })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: true,
        input: "",
        attachments: pending,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: true,
        input: "转向请假",
        attachments: [],
      })
    ).toBe(false);
  });

  it("审查/优化在飞锁发送；打完字、卡片已出不锁；推演中有字可排队", () => {
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "给社区做随访",
        attachments: [],
        isRefining: true,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "给社区做随访",
        attachments: [],
        isRefining: false,
      })
    ).toBe(false);
    expect(
      isComposerSendBlocked({
        isRunning: true,
        input: "给社区做随访",
        attachments: [],
        isRefining: true,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: true,
        input: "给社区做随访",
        attachments: [],
        isRefining: false,
      })
    ).toBe(false);
  });
});

describe("extractAttachmentRemote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeFile = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name);

  it("成功回执原样透传（ok + context）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain("/api/sliderule/attachments/extract?name=ui.png");
        expect(init?.signal).toBeDefined();
        return {
          ok: true,
          json: async () => ({ ok: true, kind: "image", context: "登录页原型", chars: 5 }),
        } as Response;
      })
    );
    const outcome = await extractAttachmentRemote(fakeFile("ui.png"));
    expect(outcome.ok).toBe(true);
    expect(outcome.context).toBe("登录页原型");
  });

  it("服务端 ok=false 如实带 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: false, detail: "PDF 无可提取文本层（可能是扫描件）" }),
      })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("scan.pdf"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("扫描件");
  });

  it("ok=true 但空 context 视为失败（不假装解析成功）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, context: "  " }),
      })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
  });

  it("HTTP 非 2xx 归一为失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 502 })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("502");
  });

  it("网络异常归一为失败（不抛出）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("网络异常");
  });

  it("超时/中止归一为失败（解开发送键，不永远 pending）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      })
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("超时");
    expect(outcome.detail).not.toContain("网络异常");
  });
});

describe("ComposerDock 解析中发送闸接在通电链上", () => {
  it("发送键、doSend、Enter 三处都闸 pending", () => {
    const src = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );

    const doSend = src.slice(
      src.indexOf("const doSend = React.useCallback"),
      src.indexOf("const slashPool")
    );
    expect(doSend).toContain("isComposerSendBlocked");
    expect(doSend).toContain("isRefining");
    // 闸在清附件之前：否则解析中一点发送，卡立刻消失、后台偷偷发
    expect(doSend.indexOf("isComposerSendBlocked")).toBeLessThan(
      doSend.indexOf("setAttachments")
    );

    const sendBtn = src.slice(
      src.indexOf("sliderule-composer-send") - 280,
      src.indexOf("sliderule-composer-send") + 900
    );
    expect(sendBtn).toContain("disabled={sendBlocked}");
    expect(sendBtn).toContain("sendBusy");
    expect(sendBtn).not.toContain(
      "disabled={!isRunning && !input.trim() && attachments.length === 0}"
    );

    const keydown = src.slice(
      src.indexOf("onKeyDown={event =>"),
      src.indexOf("onPaste={handlePaste}")
    );
    expect(keydown).toContain("if (!sendBlocked) doSend()");
    expect(keydown).not.toMatch(/preventDefault\(\);\s*doSend\(\)/);
    expect(keydown).not.toContain("if (!extractPending) doSend()");
  });
});
