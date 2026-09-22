/**
 * 导出文件名的判据。
 *
 * 只钉 `safeFileName` 这一层：`exportBoardPng` 要真实 DOM + snapdom，
 * `exportBoardHtml` 要 Blob 下载，两者都在浏览器 smoke 里钉
 * （scripts/sliderule-canvas-browser-smoke.mjs）。jsdom 里跑它们只能验证
 * "没抛异常"，那是本仓明令禁止的那种假判据。
 */
import { describe, expect, it } from "vitest";

import { safeFileName } from "../canvas-board-export";

describe("导出文件名", () => {
  it("中文页名原样留着（下载下来要认得出是哪一页）", () => {
    expect(safeFileName("团长工作台")).toBe("团长工作台");
  });

  it("路径分隔符与 Windows 保留字符换成下划线", () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("控制字符也要清掉", () => {
    /**
     * ⚠ 2026-08-25：这条正则最初把控制字符范围写成了**裸字节**（源文件里
     *   真的躺着一个 NUL 字节），git 直接把 .ts 当成二进制
     *   （git diff --stat 里显示 "Bin 0 -> 3611 bytes"）。
     *   行为是对的、文件是坏的——判据只盯行为看不出来，是 diffstat 露的马脚。
     *   现在源码里一律用转义写法；下面这条断言也**不写裸字节**，
     *   用 String.fromCharCode 构造，免得判据自己又把坏字节带回仓里。
     */
    const withCtrl =
      "a" +
      String.fromCharCode(0) +
      "b" +
      String.fromCharCode(9) +
      "c" +
      String.fromCharCode(10) +
      "d";
    expect(safeFileName(withCtrl)).toBe("a_b_c_d");
  });

  it("空白压成单个下划线，首尾不留", () => {
    expect(safeFileName("  订单  核销  页  ")).toBe("订单_核销_页");
  });

  it("过长截断（文件系统对文件名有长度上限）", () => {
    expect(safeFileName("长".repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it("清干净之后什么都不剩就用兜底名，不产出一个叫 `.png` 的文件", () => {
    expect(safeFileName("///")).toBe("page");
    expect(safeFileName("")).toBe("page");
    expect(safeFileName("   ", "board")).toBe("board");
  });
});
