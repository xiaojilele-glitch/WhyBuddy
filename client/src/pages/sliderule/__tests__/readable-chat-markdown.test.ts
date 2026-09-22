/**
 * 收口总结挤成一行时，要能拆回列表；已经是标准 markdown 的不许改。
 *
 * 2026-08-19 妇幼站：正文停在「。- 营养」，像没写完。把 `。- ` 还原成
 * 空行+列表，变异回单行拼接下面必红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureReadableChatMarkdown } from "../readable-chat-markdown";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const MASHED =
  "医疗隐私数据泄露合规风险。- 建档分步向导无状态暂存导致数据丢失。- 营养指导记录未脱敏。";

describe("ensureReadableChatMarkdown", () => {
  it("句号后面直接跟条目 → 拆成空行列表，不该再挤成一行", () => {
    const out = ensureReadableChatMarkdown(MASHED);
    expect(out).toContain("医疗隐私数据泄露合规风险。");
    expect(out).toContain("\n\n- 建档分步向导无状态暂存导致数据丢失。");
    expect(out).toContain("\n\n- 营养指导记录未脱敏。");
    expect(out).not.toMatch(/。- /);
    expect(out.split("\n\n").length).toBeGreaterThan(1);
  });

  it("标准 markdown 列表原样返回（不该有：多余空行把一条拆成两个 ul）", () => {
    const proper = "关键风险：\n\n- 隐私泄露\n- 数据丢失";
    expect(ensureReadableChatMarkdown(proper)).toBe(proper);
  });

  it("单换行起的列表补空行，markdown 才认", () => {
    expect(ensureReadableChatMarkdown("关键风险：\n- 隐私泄露\n- 数据丢失")).toBe(
      "关键风险：\n\n- 隐私泄露\n- 数据丢失"
    );
  });

  it("数字范围 / 连字符不是列表，不该拆", () => {
    expect(ensureReadableChatMarkdown("证据 3 - 5 项已齐。")).toBe(
      "证据 3 - 5 项已齐。"
    );
  });

  it("空串原样", () => {
    expect(ensureReadableChatMarkdown("")).toBe("");
  });

  it("对话气泡走这份拆行，回答壳不许再写满高裁切", () => {
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const assistant = page.slice(
      page.indexOf("function ImAssistantMessage"),
      page.indexOf("export function ClaudeChatSurface")
    );
    expect(assistant).toContain("ensureReadableChatMarkdown");
    expect(assistant).toContain("overflow-visible");
    expect(assistant).not.toMatch(/\bsize-full\b/);
    expect(assistant).not.toMatch(/\bline-clamp/);
    expect(assistant).not.toMatch(/\boverflow-hidden\b/);

    const response = stripComments(
      readFileSync(
        new URL("../../../components/ai/response.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(response).toContain("h-auto");
    expect(response).toContain("overflow-visible");
    expect(response).not.toMatch(/\bsize-full\b/);
    expect(response).not.toMatch(/last-child\]:mb-0/);
  });
});
