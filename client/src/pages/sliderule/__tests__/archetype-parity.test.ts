/**
 * 产品原型账本——TS 侧 parity 锁（2026-08-30）。
 *
 * ## 这道闸挡的是什么
 *
 * 「什么算闭环」这份六系统词表，2026-08-30 数下来跨两门语言手抄了 **13 处**：
 *
 *     Python 8 处   v5_capability_executor / v5_model_gate / v5_llm_generate /
 *                   v5_full_driver ×2 / turn_narration / closure_relevance …
 *     TS 5 处       appBundleSkill.ts ×3 / pageSkill.ts ×2
 *
 * Python 侧已经全部收进账本 `services/data/product_archetypes.json`。
 * **但只收一半正是 CLAUDE.md 第四条本身**——TS 侧这几份还在手抄，
 * 改一边不改另一边不会报错，只会让「生成侧产了六段、装配侧只认五段」
 * 这类静默错位重新长出来。
 *
 * 所以这里锁住：TS 的清单必须与账本一致。账本改了而 TS 没跟上 → 当场红。
 *
 * ## ⚠ 为什么不是直接从账本 import 就完事
 *
 * TS 那几处是**带类型的**（`AppBundleSkillId[]`），直接摊平 JSON 会丢掉
 * 类型收窄。所以做法照 `legal-domains-parity.test.ts`（E40.1 那套）：
 * 清单留在原处保持类型，由判据把它钉在账本上——红了就是提醒你去同步，
 * 不是让你把类型删掉。
 *
 * ## ⚠ 一处**故意的**不一致，别"修"它
 *
 * `REQUIRED_PIN_SKILLS` 是五个（不含 `aigc`）。那不是漏抄：pin 的是
 * 装配时必须钉版本的技能，而 aigc 能力不参与版本钉（它没有可钉的结构版本）。
 * 判据把它锁成「账本减去 aigc」，这样账本加一个系统时它照样会红，
 * 而 aigc 这个例外被写死在判据里、有据可查。
 */
import { describe, expect, it } from "vitest";

import archetypes from "@archetypes";

/** 账本里默认原型（今天唯一接通的那个）的六样证据。 */
const LEDGER_SIX: string[] =
  (archetypes as any).archetypes[(archetypes as any).defaultArchetype].requiredEvidence;

/** ⚠ 与 appBundleSkill.ts:1035 `surfacesChecked` 逐字一致。 */
const APPBUNDLE_SURFACES_CHECKED = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
];

/** ⚠ 与 appBundleSkill.ts:1237 `skillsToCheck` 逐字一致。 */
const APPBUNDLE_SKILLS_TO_CHECK = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
];

/** ⚠ 与 appBundleSkill.ts:261 `REQUIRED_PIN_SKILLS` 逐字一致（**故意不含 aigc**）。 */
const APPBUNDLE_REQUIRED_PIN = ["datamodel", "rbac", "workflow", "page", "appbundle"];

/** ⚠ 与 appBundleSkill.ts:916 / pageSkill.ts:950 的 targets 逐字一致
 *  （运行时投影靶：不含自己那一段）。 */
const APPBUNDLE_RUNTIME_TARGETS = ["datamodel", "rbac", "workflow", "page", "aigc"];
const PAGE_RUNTIME_TARGETS = ["datamodel", "rbac", "workflow", "aigc", "appbundle"];

describe("产品原型账本 parity（TS 侧不许再手抄一份闭环定义）", () => {
  it("账本本身是可读的，且默认原型是接通的", () => {
    const a = archetypes as any;
    expect(a.version).toBeGreaterThan(0);
    expect(a.archetypes[a.defaultArchetype]).toBeTruthy();
    expect(a.archetypes[a.defaultArchetype].wired).toBe(true);
  });

  it("装配侧 surfacesChecked = 账本", () => {
    expect(APPBUNDLE_SURFACES_CHECKED).toEqual(LEDGER_SIX);
  });

  it("装配侧 skillsToCheck = 账本", () => {
    expect(APPBUNDLE_SKILLS_TO_CHECK).toEqual(LEDGER_SIX);
  });

  it("装配侧 REQUIRED_PIN_SKILLS = 账本减去 aigc（例外写在这里，有据可查）", () => {
    expect(APPBUNDLE_REQUIRED_PIN).toEqual(LEDGER_SIX.filter((s) => s !== "aigc"));
  });

  it("运行时投影靶 = 账本减去自己那一段", () => {
    expect(APPBUNDLE_RUNTIME_TARGETS).toEqual(LEDGER_SIX.filter((s) => s !== "appbundle"));
    expect(PAGE_RUNTIME_TARGETS).toEqual(LEDGER_SIX.filter((s) => s !== "page"));
  });

  it("⚠ 反向：TS 里这些清单必须真的还长那样（判据不许守一个不存在的契约）", async () => {
    // 只锁常量 = 判据可能在守一份早就被删掉的代码。这里读源码确认它还在。
    // 剥掉注释再匹配——第二条踩过：判据 grep 标识符，而那个词同时出现在
    // 注释里，变异后照样绿。
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../../..", "..");
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const bundle = strip(
      await fs.readFile(path.join(root, "client/src/lib/skills/appbundle/appBundleSkill.ts"), "utf8"),
    );
    const page = strip(
      await fs.readFile(path.join(root, "client/src/lib/skills/page/pageSkill.ts"), "utf8"),
    );
    for (const needle of ["REQUIRED_PIN_SKILLS", "surfacesChecked", "skillsToCheck"]) {
      expect(bundle).toContain(needle);
    }
    expect(page).toContain("PageRuntimeTargetSkill");
  });

  it("⚠ 防空转：账本真的有六样，不是空数组让全部断言空过", () => {
    expect(LEDGER_SIX.length).toBe(6);
    expect(LEDGER_SIX).toContain("appbundle");
  });

  it("接通的设备档跟账本走，平板已接通，手表未接通", () => {
    const forms = (archetypes as any).deviceForms.forms;
    expect(forms.tablet.wired).toBe(true);
    expect(forms.watch.wired).toBe(false);
    expect(forms.desktop.wired).toBe(true);
    expect(forms.phone.wired).toBe(true);
  });
});
