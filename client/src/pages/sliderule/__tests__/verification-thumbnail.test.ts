/**
 * 结果卡缩略图：判据、取址、以及「只有一份实现」。
 *
 * ## 这条测试为什么存在（2026-09-14）
 *
 * 缩略图第一版是 `record.artifactRefs[0]`，不筛。而同一个数组在
 * `ProjectEvidenceImages` 里筛过：`mediaType === "image/png"` + 体积上限。
 * 两处对同一份数据结论不同——真机上只要第一条 ref 不是 png，
 * 证据面板正确跳过、结果卡挂一张碎图，**没有报错、没有告警**。
 * 这就是 CLAUDE.md §4「同一件事两条实现，改一条不报错、只有一半生效」。
 *
 * 所以判据分两半：
 *   前半 —— 共享模块本身筛对了（正向 + 反向）
 *   后半 —— 两个消费方**真的都在用它**，而且全仓没有第三处手拼 URL（§3 反向）
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { VerificationArtifactRef } from "@shared/project-runtime.generated";
import {
  PNG_LIMIT,
  displayableScreenshots,
  isDisplayableScreenshot,
  verificationArtifactUrl,
} from "../project-runtime/verification-artifacts";
import {
  previewSnapshotUrl,
  resolveProjectThumbnail,
  thumbnailFromVerification,
} from "../project-runtime/useProjectThumbnail";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relative: string) =>
  stripComments(readFileSync(resolve(__dirname, relative), "utf8"));

const png = (
  over: Partial<VerificationArtifactRef> = {}
): VerificationArtifactRef => ({
  artifactId: "a1",
  sha256: "f".repeat(64),
  mediaType: "image/png",
  sizeBytes: 4096,
  label: "首页",
  ...over,
});

describe("哪些验收产物能直接画到页面上", () => {
  it("正向：跑过验收、是 png、体积正常的那张，能画", () => {
    expect(isDisplayableScreenshot(png())).toBe(true);
  });

  it("反向：mediaType 缺席的不画（schema 里它是可选的，真机可以不带）", () => {
    // ⚠ 这一条就是 §4 那个碎图：旧写法取 [0] 不看 mediaType，
    //   而这种 ref 端点根本不保证返回 image/png。
    const { mediaType: _dropped, ...withoutMediaType } = png();
    expect(isDisplayableScreenshot(withoutMediaType as VerificationArtifactRef))
      .toBe(false);
  });

  it("反向：零字节的不画（截图跑炸了也会落一条 ref）", () => {
    expect(isDisplayableScreenshot(png({ sizeBytes: 0 }))).toBe(false);
  });

  it("反向：超过展示上限的不画", () => {
    expect(isDisplayableScreenshot(png({ sizeBytes: PNG_LIMIT + 1 }))).toBe(
      false
    );
    expect(isDisplayableScreenshot(png({ sizeBytes: PNG_LIMIT }))).toBe(true);
  });

  it("反向：没有 artifactId 就没法取图", () => {
    expect(isDisplayableScreenshot(png({ artifactId: "" }))).toBe(false);
    expect(isDisplayableScreenshot(null)).toBe(false);
    expect(isDisplayableScreenshot(undefined)).toBe(false);
  });

  it("筛完保持产出顺序，缩略图拿到的是第一张**能画的**，不是第一条 ref", () => {
    const refs = [
      png({ artifactId: "log", mediaType: undefined as never }),
      png({ artifactId: "shot-1" }),
      png({ artifactId: "shot-2" }),
    ];
    expect(displayableScreenshots(refs).map(r => r.artifactId)).toEqual([
      "shot-1",
      "shot-2",
    ]);
  });

  it("反向：没跑过验收（artifactRefs 缺席/为空）就是没有，不许兜底凑一张", () => {
    expect(displayableScreenshots(undefined)).toEqual([]);
    expect(displayableScreenshots([])).toEqual([]);
  });
});

/** 真机那一发的形状：/projects/{id}/verification 的响应体。 */
const view = (effectiveStatus: string, refs = [png()]) =>
  ({
    operationId: "op-1",
    operationStatus: "completed",
    snapshot: {
      effectiveStatus,
      deliveryEligible: false,
      verification: {
        verificationId: "vf-1",
        artifactRefs: refs,
      },
    },
  }) as never;

describe("挑哪一张当缩略图", () => {
  it("正向：当前这一版跑过验收，就用它那张", () => {
    expect(thumbnailFromVerification(view("passed"))).toBe(
      "/api/sliderule/project-verifications/vf-1/artifacts/a1"
    );
  });

  it("⚠ 反向：stale 的那份不算数——它拍的是上一版源码", () => {
    // 2026-09-14 真机（待办清单那趟）：面板显示「旧版本记录，需重新检查」。
    // 记录在、截图也在，但那是上一版的。挂到这一轮卡片上就是拿旧证据充新产出。
    expect(thumbnailFromVerification(view("stale"))).toBeNull();
  });

  it("检查还在跑（running）时有截图也认：那是当前这一版拍的", () => {
    expect(thumbnailFromVerification(view("running"))).not.toBeNull();
  });

  it("反向：压根没跑过验收（snapshot 为 null）", () => {
    expect(
      thumbnailFromVerification({
        operationId: null,
        operationStatus: null,
        snapshot: null,
      })
    ).toBeNull();
    expect(thumbnailFromVerification(null)).toBeNull();
    expect(thumbnailFromVerification(undefined)).toBeNull();
  });

  it("反向：跑过但一张能画的截图都没有", () => {
    expect(thumbnailFromVerification(view("passed", []))).toBeNull();
  });
});

describe("验收没有时才用预览截图", () => {
  const projectId = "prj-08364d56a44e58328983886b3736389b";

  it("正向：当前验收能画，不用预览图", () => {
    expect(
      resolveProjectThumbnail({
        verification: view("passed"),
        previewAvailable: true,
        projectId,
      })
    ).toBe("/api/sliderule/project-verifications/vf-1/artifacts/a1");
  });

  it("正向：飞机大战那种验收空、有预览图，挂预览图", () => {
    expect(
      resolveProjectThumbnail({
        verification: { operationId: null, operationStatus: null, snapshot: null },
        previewAvailable: true,
        projectId,
      })
    ).toBe(previewSnapshotUrl(projectId));
  });

  it("反向：stale 验收不算，可以退到预览图", () => {
    expect(
      resolveProjectThumbnail({
        verification: view("stale"),
        previewAvailable: true,
        projectId,
      })
    ).toBe(previewSnapshotUrl(projectId));
  });

  it("反向：预览图也没有，不许编一个地址", () => {
    expect(
      resolveProjectThumbnail({
        verification: { operationId: null, operationStatus: null, snapshot: null },
        previewAvailable: false,
        projectId,
      })
    ).toBeNull();
  });
});

describe("取图地址", () => {
  it("走 owner 校验过的那个端点，两段都编码", () => {
    expect(verificationArtifactUrl("v/1", "a b")).toBe(
      "/api/sliderule/project-verifications/v%2F1/artifacts/a%20b"
    );
  });
});

describe("只有一份实现（§4）", () => {
  const HOOK = read("../project-runtime/useProjectThumbnail.ts");
  const EVIDENCE = read("../project-runtime/ProjectEvidenceImages.tsx");

  it("缩略图走共享判据，而不是自己取 [0]", () => {
    expect(HOOK).toMatch(/displayableScreenshots\(/);
    expect(HOOK).toMatch(/verificationArtifactUrl\(/);
    expect(HOOK).toMatch(/previewSnapshotUrl\(/);
    expect(HOOK).toMatch(/resolveProjectThumbnail\(/);
    expect(HOOK).toMatch(/fetch\(\s*previewSnapshotUrl\(/);
    // 变异判据：把 displayableScreenshots(...)[0] 改回 artifactRefs[0] 就红。
    expect(HOOK).not.toMatch(/artifactRefs\s*(\?\.)?\[\s*0\s*\]/);
  });

  it("证据面板也改用了共享判据，没留下第二份筛选条件", () => {
    expect(EVIDENCE).toMatch(/displayableScreenshots\(/);
    expect(EVIDENCE).not.toMatch(/mediaType\s*===/);
  });

  it("反向：产线源码里再没有第三处手拼取图 URL", () => {
    // 判据只扫产线源码：__tests__ 里出现这个字面量是判据/桩本身（本文件就有一处），
    // 把它们算进来等于判据自己咬自己。
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__")
            walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = stripComments(readFileSync(full, "utf8"));
          if (
            source.includes("project-verifications/") &&
            !full.endsWith("verification-artifacts.ts")
          )
            hits.push(full);
        }
      }
    };
    walk(resolve(__dirname, "../../.."));
    expect(hits, "取图地址只许在 verification-artifacts.ts 里拼一次").toEqual(
      []
    );
  });
});
