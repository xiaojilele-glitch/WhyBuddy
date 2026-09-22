/**
 * 字段值的纯文本呈现（2026-08-12）。
 *
 * 这一档是给首页 HTML 载体的 `data-field` 用的——那边填的是文字，填不了 JSX。
 * 用例守两件事：
 *
 *   ① **单位不能丢**。真跑逮到过三次同一类事故：percent 字段渲染成裸的 `49.3`
 *      （读者只能猜是 49.3% 还是 49.3 次）、金额丢 ¥、enum 把内部 id
 *      `music_member` 漏到界面上。逐行的值走的是新代码，这三样必须一次钉住。
 *   ② **判据不新发明**。档位判定用的是 resolveValueType 那张表（跟表单、表格
 *      同一张），所以这里也顺手验"声明变了它跟着变"，而不是按字段名猜。
 */
import { describe, expect, it } from "vitest";
import { EMPTY_TEXT, formatFieldText } from "../field-text";

describe("① 单位按声明补", () => {
  it("percent：不补百分号就分不清 49.3% 和 49.3 次", () => {
    expect(formatFieldText(49.3, { type: "number", format: "percent" })).toBe("49.3%");
  });

  it("money / score / progress / rate", () => {
    expect(formatFieldText(12800, { type: "number", format: "money" })).toBe("¥12,800");
    expect(formatFieldText(76.8, { type: "number", format: "score" })).toBe("76.8 分");
    expect(formatFieldText(64, { type: "number", format: "progress" })).toBe("64%");
    expect(formatFieldText(4.5, { type: "number", format: "rating" })).toBe("4.5 星");
  });

  it("裸数字走千分位，不带任何单位", () => {
    expect(formatFieldText(10900, { type: "number" })).toBe("10,900");
  });

  it("enum 出声明的标签，不漏内部 id", () => {
    const field = {
      type: "enum",
      options: [
        { id: "music_member", label: "会员", tone: "success" as const },
        { id: "guest", label: "散客", tone: "default" as const },
      ],
    };
    expect(formatFieldText("music_member", field)).toBe("会员");
    // 取值不在声明里就如实出原文——不猜、不隐藏
    expect(formatFieldText("walk_in", field)).toBe("walk_in");
  });

  it("布尔出「是/否」，脱敏字段真的被脱敏", () => {
    expect(formatFieldText(true, { type: "boolean" })).toBe("是");
    expect(formatFieldText(false, { type: "boolean" })).toBe("否");
    expect(formatFieldText("13812345678", { type: "string", format: "masked" })).toBe(
      "138****78"
    );
  });

  it("日期不二次格式化 —— 脏值原样显示，不猜它是什么格式", () => {
    expect(formatFieldText("2026-08-12", { type: "date" })).toBe("2026-08-12");
    expect(formatFieldText("八月十二", { type: "date" })).toBe("八月十二");
  });
});

describe("② 取不到就如实说", () => {
  it("空值一律「—」，不拿 0 或空串冒充", () => {
    for (const v of [undefined, null, ""]) {
      expect(formatFieldText(v, { type: "number", format: "money" })).toBe(EMPTY_TEXT);
    }
    // 真的是 0 要显示 0 —— 跟"没有值"必须是两种东西
    expect(formatFieldText(0, { type: "number" })).toBe("0");
  });

  it("没有字段声明就出原文 —— 不猜它是金额还是百分比", () => {
    expect(formatFieldText(49.3)).toBe("49.3");
  });

  it("数值格式化不了就回退原文", () => {
    expect(formatFieldText("待补", { type: "number", format: "money" })).toBe("待补");
  });
});
