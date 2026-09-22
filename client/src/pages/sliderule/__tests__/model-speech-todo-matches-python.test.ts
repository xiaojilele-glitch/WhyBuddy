/**
 * 清单状态记号：TS 这份镜像必须跟 Python 那份 `_TAG` 一字不差。
 *
 * ## 防的是什么
 *
 * `services/plan_todo.py` 的 `_TAG` 自称「**唯一渲染处**」，而
 * `model-speech.ts` 为了认出「这段是整份清单」不得不再抄一份记号集——
 * 这就是 CLAUDE.md §4 那张表上的「Python 判定 / TypeScript 运行时」：
 * 同一件事两处实现，改一处不改另一处**不报错、只有一半生效**。
 *
 * 具体会怎么坏：Python 侧新加一档状态（`_TAG` 里多一个记号），TS 不认，
 * 于是带那一档的清单就不再被识别成清单——整份清单又开始一轮一份地重印，
 * 而且**没有任何东西会红**，只是页面慢慢变胖。
 *
 * 所以判据不核对注释，直接读产线那份 Python 源码比对。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TODO_STATUS_MARKERS,
  isChecklistSnapshot,
} from "../model-speech";

const PY = path.resolve(
  process.cwd(),
  "slide-rule-python/services/plan_todo.py"
);

/** 从 `_TAG: Dict[TodoStatus, str] = { ... }` 的字典体里抄出所有记号。 */
function pythonMarkers(): string[] {
  const src = fs.readFileSync(PY, "utf8");
  const start = src.indexOf("_TAG: Dict[TodoStatus, str] = {");
  expect(start, "Python 那边的 _TAG 不见了或改名了").toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("}", start));
  return [...body.matchAll(/TodoStatus\.[A-Z_]+:\s*"(\S)"/g)].map(m => m[1]);
}

describe("清单记号：TS 与 Python 不许漂", () => {
  it("夹具本身得有效——抄不到东西要红，不能静静地比对两个空集", () => {
    expect(pythonMarkers().length).toBeGreaterThanOrEqual(4);
  });

  it("Python 有的记号，TS 一个不少", () => {
    const missing = pythonMarkers().filter(
      marker => !TODO_STATUS_MARKERS.includes(marker)
    );
    expect(
      missing,
      `Python 的 _TAG 里有 TS 不认的记号 ${missing.join("")}——` +
        `带这一档的清单会重新变成一轮一份地重印，而且什么都不会红`
    ).toEqual([]);
  });

  it("TS 多出来的记号也要红：多认一个就会把散文误判成清单", () => {
    const extra = [...TODO_STATUS_MARKERS].filter(
      marker => !pythonMarkers().includes(marker)
    );
    expect(extra, `TS 认了 Python 不产的记号 ${extra.join("")}`).toEqual([]);
  });

  it("Python 每一档产出的那行，TS 都认得出是清单", () => {
    for (const marker of pythonMarkers())
      expect(isChecklistSnapshot(`${marker} 建立数据结构与权限工作流`), marker).toBe(
        true
      );
  });
});
