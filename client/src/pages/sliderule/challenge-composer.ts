/**
 * 质疑进作曲家：前缀 / 预填事件 / 发送意图判定。
 *
 * ⚠ 2026-08 PR-1 review：第一版 `sendMessage` 用 `if (pending || prefix)`，
 * 点「质疑」留下的 pendingChallengeRef 把 编辑重跑 / 重新推演 / 改写后的
 * 作曲家文本 / 重置会话后的第一条都劫持成 intent: "challenge"。intent 必须
 * 只看文本；pending 只在仍是质疑时提供 targetArtifactId。
 *
 * 半角「质疑:」与全角「质疑：」同一前缀——预填只写全角，手打半角也认。
 */

export const CHALLENGE_COMPOSER_PREFIX = "质疑：";
/** 手打半角冒号与预填全角同一意图，避免 invalidate 静默 no-op。 */
export const CHALLENGE_COMPOSER_PREFIX_ASCII = "质疑:";
export const DEFAULT_CHALLENGE_BODY =
  "这个结论的依据不够充分，请重新推演。";
export const CHALLENGE_PREFILL_EVENT = "sliderule:challenge-prefill";

const CHALLENGE_PREFIXES = [
  CHALLENGE_COMPOSER_PREFIX,
  CHALLENGE_COMPOSER_PREFIX_ASCII,
] as const;

export function isChallengeComposerText(text: string): boolean {
  const t = text.trim();
  return CHALLENGE_PREFIXES.some(prefix => t.startsWith(prefix));
}

export function composeChallengePrefill(
  targetLabel?: string | null
): string {
  const body =
    (targetLabel && String(targetLabel).trim()) || DEFAULT_CHALLENGE_BODY;
  if (isChallengeComposerText(body)) return body;
  return `${CHALLENGE_COMPOSER_PREFIX}${body}`;
}

export function applyChallengePrefillToComposer(
  setInput: (text: string) => void,
  detail?: { text?: string; targetLabel?: string | null }
): string {
  const next =
    (detail?.text && detail.text.trim()) ||
    composeChallengePrefill(detail?.targetLabel);
  setInput(next);
  return next;
}

export function dispatchChallengePrefill(detail: {
  artifactId: string;
  text?: string;
  targetLabel?: string | null;
}): void {
  const text =
    (detail.text && detail.text.trim()) ||
    composeChallengePrefill(detail.targetLabel);
  window.dispatchEvent(
    new CustomEvent(CHALLENGE_PREFILL_EVENT, {
      detail: { artifactId: detail.artifactId, text },
    })
  );
}

export function latestMainArtifactIdFromTurns(
  turns: Array<{ main?: { artifactId?: string } | null } | null | undefined>
): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const id = turns[i]?.main?.artifactId?.trim();
    if (id) return id;
  }
  return undefined;
}

export type ChallengeSendResolution =
  | { intent: "challenge"; targetArtifactId?: string }
  | { intent: null };

/**
 * 发送意图只看文本。pending 只在仍是质疑时当 target；空 pending 回落到
 * 最近一轮 turn.main.artifactId，避免前缀质疑让 invalidateForIntervention
 * 因 !targetId 直接 return、被质疑结论继续当绿灯。
 */
export function resolveChallengeSend(opts: {
  text: string;
  pendingArtifactId?: string | null;
  latestMainArtifactId?: string | null;
}): ChallengeSendResolution {
  if (!isChallengeComposerText(opts.text)) {
    return { intent: null };
  }
  const fromPending = opts.pendingArtifactId?.trim() || "";
  const fromLatest = opts.latestMainArtifactId?.trim() || "";
  const targetArtifactId = fromPending || fromLatest || undefined;
  return { intent: "challenge", targetArtifactId };
}
