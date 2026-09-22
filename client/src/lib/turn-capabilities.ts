/**
 * turn-capabilities — 这一轮挂了哪些能力（技能 / 连接器 / 伙伴）。
 *
 * 跟 installed-skills 同一本地层哲学：纯 localStorage、会话无关、随时可摘、
 * 不改任何服务端状态。「装了」和「这一轮要用」是两件事——技能库里装十个，
 * 这一轮可能只挂一个。
 *
 * ⚠ 读存档必须**逐条验形状**。存档被手改过、或哪天写入端出 bug 存了别的东西，
 *   不验的话不会报错，只会让推演载荷里多出一条 `{kind: undefined}`，
 *   后端按 id 找不到就静静跳过——用户勾了能力却没生效，全链路没有一处报警。
 *   画板位置存档（readBoardPositions）踩过同一个坑，那条注释里也记着。
 */

import type { SlashItem, SlashKind } from "./slash-item";

const KEY = "sliderule:turn-capabilities";

const KINDS: readonly SlashKind[] = ["skill", "connector", "partner"];

function isValid(raw: unknown): raw is SlashItem {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.key === "string" &&
    r.key.length > 0 &&
    typeof r.name === "string" &&
    typeof r.kind === "string" &&
    (KINDS as readonly string[]).includes(r.kind)
  );
}

/** 解析存档文本。给测试直接调，不用碰 localStorage。 */
export function readTurnCapabilities(raw: string | null): SlashItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: SlashItem[] = [];
    for (const item of parsed) {
      if (!isValid(item)) continue;
      const id = `${item.kind}:${item.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        key: item.key,
        kind: item.kind,
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
        ...(typeof (item as SlashItem).unavailable === "string"
          ? { unavailable: (item as SlashItem).unavailable }
          : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function writeTurnCapabilities(items: readonly SlashItem[]): string {
  return JSON.stringify(items);
}

export function loadTurnCapabilities(): SlashItem[] {
  try {
    return readTurnCapabilities(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveTurnCapabilities(items: readonly SlashItem[]): void {
  try {
    window.localStorage.setItem(KEY, writeTurnCapabilities(items));
  } catch {
    /* 存储满 / 隐私模式：勾选本身已经生效，只是刷新后回到空 */
  }
}

/**
 * 给推演载荷的形状。
 *
 * ⚠ 只带 kind + key，**不带描述文案**。带上的话它会跟着进提示词，
 *   模型会把技能库的宣传语当成用户需求的一部分去理解。
 */
export function turnCapabilitiesPayload(
  items: readonly SlashItem[]
): Array<{ kind: SlashKind; key: string }> {
  return items.map(i => ({ kind: i.kind, key: i.key }));
}

/** 这一轮挂着的连接器 id（取数那一步要用）。 */
export function pickedConnectorIds(items: readonly SlashItem[]): string[] {
  return items.filter(i => i.kind === "connector").map(i => i.key);
}


/* ───────────────────────────── 「起手意图」跨页交接（伙伴 → 输入框） */

const OPENER_KEY = "sliderule:pending-opener";

/**
 * 从「扩展中心」页点了「用这个伙伴」之后，把起手意图交给输入框。
 *
 * ⚠ **取一次就清掉**（take 语义，不是 load）。留着的话，用户下次不管从哪里
 *   进推演，输入框都会莫名其妙自己填上半个月前那句话——而且他会以为是
 *   自己没删干净。交接用的一次性信道，必须是一次性的。
 */
export function setPendingOpener(text: string): void {
  try {
    window.localStorage.setItem(OPENER_KEY, String(text || ""));
  } catch {
    /* 存储满：起手意图丢了，用户自己打字，不影响能力已经挂上 */
  }
}

export function takePendingOpener(): string {
  try {
    const raw = window.localStorage.getItem(OPENER_KEY);
    if (raw) window.localStorage.removeItem(OPENER_KEY);
    return raw || "";
  } catch {
    return "";
  }
}
