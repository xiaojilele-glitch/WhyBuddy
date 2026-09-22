/**
 * 停因的闭集必须跟 Python 那份 enum 一字不差。
 *
 * ## 这条判据防的是什么（2026-09-14 复审）
 *
 * `ControlStop.stopReason` 原来是 `string`，上面挂一行注释列了五个值。
 * 而服务端 2026-09-09 就加了第六个 `stationarity`（「同一件事干了 4 遍」，
 * 跟「想了 8 轮没定下来」是两码事）。注释一直停在五个——**类型是 string，
 * 编译不报错、测试不红**，就这么漂了五天。
 *
 * 这正是 CLAUDE.md §4 那张表上的「Python 判定 / TypeScript 运行时」：
 * 同一件事两处实现，改一处不改另一处不会报错，只会有一半不生效。
 *
 * 所以判据**不去核对注释**，直接读产线那份 Python 源码比对。
 * 服务端再加一个原因而这里没跟 → 当场红。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTROL_STOP_REASONS,
  asControlStopReason,
} from "@/lib/sliderule-marathon-driver";

const PY = path.resolve(
  process.cwd(),
  "slide-rule-python/services/rehearsal_control.py"
);

/** 从 `class ControlStopReason(str, Enum):` 的**类体**里抄出所有值。 */
function pythonStopReasons(): string[] {
  const src = fs.readFileSync(PY, "utf8");
  const start = src.indexOf("class ControlStopReason(str, Enum):");
  expect(start, "Python 那边的 ControlStopReason 不见了或改名了").toBeGreaterThan(-1);
  // 到下一个顶格 class 为止，免得把隔壁 StoppedBy 的值也抄进来。
  const rest = src.slice(start + 1);
  const end = rest.search(/\nclass /);
  const body = end === -1 ? rest : rest.slice(0, end);
  return [...body.matchAll(/^\s{4}[A-Z_]+\s*=\s*"([a-z_]+)"/gm)].map(m => m[1]);
}

describe("停因闭集：TS 与 Python 不许漂", () => {
  it("夹具本身得有效——抄不到东西要红，不能静静地比对两个空集", () => {
    const fromPython = pythonStopReasons();
    expect(fromPython.length).toBeGreaterThanOrEqual(6);
    // 钉住那个真实漂过的值，免得正则哪天只抄到一半也全绿。
    expect(fromPython).toContain("stationarity");
    expect(fromPython).toContain("unknown");
  });

  it("正向：两边一字不差（顺序无关）", () => {
    expect([...CONTROL_STOP_REASONS].sort()).toEqual(pythonStopReasons().sort());
  });

  it("反向：服务端新加一个原因而这里没跟 → 必须红", () => {
    // 模拟漂移：Python 多一个，TS 没有。
    const drifted = [...pythonStopReasons(), "context_overflow"];
    expect([...CONTROL_STOP_REASONS].sort()).not.toEqual(drifted.sort());
  });
});

describe("认不出来的降级成 unknown，不许漏进 UI", () => {
  it("抄服务端那句「新原因先落这儿，绝不构造成上面任何一种」", () => {
    expect(asControlStopReason("context_overflow")).toBe("unknown");
    expect(asControlStopReason("")).toBe("unknown");
    expect(asControlStopReason(null)).toBe("unknown");
    expect(asControlStopReason(undefined)).toBe("unknown");
    expect(asControlStopReason(42)).toBe("unknown");
  });

  it("反向：认得的一个都不许被顺手降级", () => {
    for (const reason of CONTROL_STOP_REASONS) {
      expect(asControlStopReason(reason)).toBe(reason);
    }
    // 尤其是这两个——塌成同一句话正是 stationarity 当初要治的病。
    expect(asControlStopReason("stationarity")).toBe("stationarity");
    expect(asControlStopReason("tool_rounds")).toBe("tool_rounds");
  });
});
