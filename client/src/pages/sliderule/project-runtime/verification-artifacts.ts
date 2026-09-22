/**
 * 验收截图的**唯一判据与唯一取图地址**。
 *
 * ⚠ 2026-09-14：结果卡缩略图刚写完时是 `artifactRefs[0]`，不筛。
 *   而同一份 `artifactRefs` 在 `ProjectEvidenceImages` 里是筛过的
 *   （`mediaType === "image/png"` + 体积上限）。两处对同一个数组结论不同，
 *   正是 §4 那条「同一件事两份实现，改一条不报错、只有一半生效」——
 *   真机上只要第一条 ref 不是 png，证据面板正确跳过、缩略图挂一张碎图。
 *   URL 也是各拼各的（两处 `encodeURIComponent` 手写）。
 *
 *   所以把判据和拼址都收到这里，两边都从这儿拿。
 */
import type { VerificationArtifactRef } from "@shared/project-runtime.generated";

/** 端点声明 image/png；超过这个体积的不在页面上直接展示。 */
export const PNG_LIMIT = 5 * 1024 * 1024;

/** 能直接画到页面上的验收截图。 */
export function isDisplayableScreenshot(
  ref: VerificationArtifactRef | null | undefined
): ref is VerificationArtifactRef {
  return (
    !!ref?.artifactId &&
    ref.mediaType === "image/png" &&
    typeof ref.sizeBytes === "number" &&
    ref.sizeBytes > 0 &&
    ref.sizeBytes <= PNG_LIMIT
  );
}

/** 这一份验收里所有能展示的截图，保持产出顺序。 */
export function displayableScreenshots(
  refs: ReadonlyArray<VerificationArtifactRef> | null | undefined
): VerificationArtifactRef[] {
  return (refs ?? []).filter(isDisplayableScreenshot);
}

/** owner 校验过的取图端点；不要在别处再拼一遍。 */
export function verificationArtifactUrl(
  verificationId: string,
  artifactId: string
): string {
  return (
    `/api/sliderule/project-verifications/${encodeURIComponent(verificationId)}` +
    `/artifacts/${encodeURIComponent(artifactId)}`
  );
}
