/**
 * field-text — 一个字段值的**纯文本**呈现（2026-08-12）。
 *
 * ## 为什么需要"纯文本"这一档
 *
 * 读侧此前只有一个出口：`FieldValue`（返回 JSX，enum 出 antd Tag、progress 出
 * Progress 条、rate 出星星）。首页的 HTML 载体填不了 JSX——它把设计产出的 HTML
 * 挂进影子根，`data-field` 占位要填的是**一段文字**。
 *
 * 于是有两种做法：在那边另写一套 switch，或者把"这个字段该怎么读"这件事抽出来。
 * 另写一套的后果这个仓库已经吃过一次：日期在读侧掉进 default 出原始串、写侧用
 * 的是原生 `input[type=date]`，两套各判各的，谁都没发现（见 field-value-type
 * 头注）。所以这里抽出来。
 *
 * ## 判据不新发明
 *
 * 档位判定用的是同一张表 `resolveValueType`，单位写法用的是同一组
 * `formatMoney` / `formatPercent` / `maskValue`。也就是说同一个字段在表格里、
 * 在 KPI 卡上、在首页 HTML 的逐行卡片里读起来是同一个东西。
 *
 * ## 三处**有意**与 JSX 那侧不同（文本表达不了控件）
 *
 *   progress   那边画进度条 → 这边出 `${n}%`（取值域本来就是 0-100，
 *              跟 block-registry 的 withDeclaredUnit 同一个退路）
 *   rate       那边画 0-5 颗星 → 这边出 `${n} 星`
 *   switch     那边出 Tag → 这边出「是」/「否」（同一组字）
 *
 * 空值一律出「—」，跟 `FieldValue` / `renderCell` / `computeDataRefText` 一致：
 * 不拿 0 或空串冒充"有值"。
 */

import type { AppFormFieldSchema } from "./app-runtime-schema";
import {
  clampNumber,
  formatMoney,
  formatPercent,
  maskValue,
} from "./field-display";
import { resolveValueType } from "./field-value-type";

/** 值取不到时统一显这个。跟读侧其它出口逐字一致。 */
export const EMPTY_TEXT = "—";

type FieldLike = Pick<AppFormFieldSchema, "type" | "format" | "options">;

/**
 * 一个字段值 → 一段文字。
 *
 * 没有字段声明（`field` 为 undefined）时如实出原文——**不猜**它是金额还是百分比。
 * 数值格式化失败也回退原文（模型/导入的脏值不该被改写成别的东西）。
 */
export function formatFieldText(value: unknown, field?: FieldLike): string {
  if (value === undefined || value === null || value === "") return EMPTY_TEXT;
  const text = String(value);
  if (!field) return text;

  // enum 声明取值 → 显示标签而不是内部 id（`music_member` 这种漏到界面上
  // 是线上截图逮到过的）。值不在 options 里就如实出原文。
  if (field.options && field.options.length > 0) {
    return field.options.find(o => o.id === text)?.label ?? text;
  }

  switch (resolveValueType(field)) {
    case "money":
      return formatMoney(value) ?? text;
    case "percent":
      return formatPercent(value) ?? text;
    case "progress": {
      const n = clampNumber(value, 0, 100);
      return n === null ? text : `${n}%`;
    }
    case "score": {
      const n = clampNumber(value, 0, 100);
      return n === null ? text : `${n} 分`;
    }
    case "rate": {
      const n = clampNumber(value, 0, 5);
      return n === null ? text : `${n} 星`;
    }
    case "password":
      return maskValue(value);
    case "switch":
      return value ? "是" : "否";
    case "digit": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("zh-CN") : text;
    }
    // date/dateTime 不二次格式化：写侧 DatePicker 存的就是 YYYY-MM-DD，
    // 脏值原样显示（不猜它是什么格式）——跟 FieldValue 同一条。
    default:
      return text;
  }
}
