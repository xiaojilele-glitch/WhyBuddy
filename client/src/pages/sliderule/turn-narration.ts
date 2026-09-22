import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { TurnStep } from "./types";

/**
 * E13 直播时间线持久化（用户裁决 2026-07-15，方案 1）。
 *
 * 左栏推演直播（阶段步骤条 + 逐步叙述）此前只活在浏览器内存：刷新后
 * derive-persisted-turn 只能重建 steps 为空的骨架轮次，「7 阶段 25 步」
 * 缩成「1 阶段 0 步」。本模块把轮次落定时的 steps 随既有 PUT 通道写进
 * 会话状态（turnNarrations，纯展示投影、无信任语义；Python 侧封顶
 * 3 轮 × 300 步 × 1200 字符），刷新后完整回放。
 *
 * 2026-08-18：驱动器自己也写这份字段。客户端打戳必须认服务端已有的
 * turnId，不能再拿 `turn-${Date.now()}` 另起一条——两份对不上，
 * 刷新后又是一排有用户原文、0 步的骨架。
 *
 * ⚠ 2026-08-18 快递柜新话题（sr-20260818075023）：函数已经「认同原文」，
 * 刷新仍出双胞胎（5 阶段 24 步 + 6 阶段 50 步）。三件套叠在一起：
 * 1. 引擎写 `turn-1`，收尾把 lastTurnId 改成 `turn-2-drive-full`（守卫用）；
 * 2. 打戳若没吃到叙述，旧实现把 `-drive-full` 或 `turn-${Date.now()}` 当新轮；
 * 3. stamp 只按 turnId 覆盖，同原文两条并排进 blob。
 *    deriveTurnsFromState 叙述轮「永远出」→ 左栏两轮同题。
 * 打戳必须盖住引擎的 drive 编号；同原文旧条直接丢掉。
 */

export type TurnNarrationEntry = {
  turnId: string;
  user?: string;
  steps: TurnStep[];
  /** 本轮真实用时（E16 收口句回放用） */
  durationMs?: number;
};

const MAX_TURNS = 3;
const MAX_STEPS = 300;
const MAX_TEXT = 1200;
/** 与 derive-persisted-turn 同一条线：低于此的 `turn-N` 是引擎编号，
 *  高于此的是客户端 `Date.now()`。老编号差 1 是真轮次，不许当时间戳。 */
const EPOCH_MS_FLOOR = 1e12;

/**
 * 落库瘦身。
 *
 * ⚠ 2026-08-23：截 `text` 时必须把**原始长度**记进 `textChars`。
 *
 * 现象是用户指着推演步骤列表问"这些字数为啥都一样"——12 步里 9 步整整齐齐
 * 写着「1201 字」。1201 不是字数，是 `1200（上限）+ 1（省略号）`：这里把超
 * 长文本截成 `slice(0,1200) + "…"`，而回放时 UI 直接数这份**已经截断的**
 * 文本（LlmLiveOutput 的 `formatCharMeta(text.length)`）。于是所有超过 1200
 * 字的步骤显示同一个数，看着像"每步输出长度惊人地一致"。
 *
 * 这个魔数当时已经被当成正常值抄进了测试夹具（activity-rows.test.ts 里那条
 * "已产出 1201 字符"），说明写测试的人也是从界面照抄的——没人意识到它是截断
 * 标记。属于本仓第五条：判据/展示要落在真实的东西上，别让机械指标替真相说话。
 *
 * 只记 `text` 的原长：UI 只显示这一个字段的长度（见 LlmLiveOutput）。其余三
 * 个字段照截不误，但不占额外字节。没被截的步骤也不加这个键——它的
 * `text.length` 本来就是真的。
 */
function slimStep(step: TurnStep): TurnStep {
  const slim: Record<string, unknown> = { ...step };
  for (const key of ["text", "message", "label", "title"] as const) {
    const v = slim[key];
    if (typeof v === "string" && v.length > MAX_TEXT) {
      // ⚠ **必须幂等**：已经有 textChars 就别再写。这条路会被跑两遍——这里
      //   一次，PUT 上去之后 Python 的 cap_turn_narrations 再一次；那时 text
      //   已经是 1201（1200+省略号）仍然超限，不设防就会把真原长覆盖成 1201，
      //   这个字段等于白加。理由与真机翻车记录见 turn_narration.py 的同名注释。
      if (key === "text" && slim.textChars === undefined) slim.textChars = v.length;
      slim[key] = v.slice(0, MAX_TEXT) + "…";
    }
  }
  return slim as TurnStep;
}

function trimUser(value: unknown): string {
  return String(value || "").trim();
}

/** 引擎 drive 开头那格：`turn-1` / `turn-3`。`turn-2-drive-full` 是收尾
 *  守卫改名，`turn-<Date.now()>` 是客户端直播 id，都不能当落库键。 */
export function isEngineDriveTurnId(turnId: string): boolean {
  const m = /^turn-(\d+)$/.exec(String(turnId || "").trim());
  if (!m) return false;
  return Number(m[1]) < EPOCH_MS_FLOOR;
}

function usersMatch(a: unknown, b: unknown): boolean {
  const left = trimUser(a);
  const right = trimUser(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // modelVersions.instruction 在 Python 截到 300；叙述 user 截到 600。
  return left.slice(0, 300) === right.slice(0, 300);
}

type NarrationLike = {
  turnId: string;
  user?: string;
  steps?: unknown[];
  durationMs?: number;
};

function pickSameUserNarration<T extends NarrationLike>(
  a: T,
  b: T,
  preferTurnIds: ReadonlySet<string>
): T {
  const id = preferTurnIds.has(a.turnId)
    ? a.turnId
    : preferTurnIds.has(b.turnId)
      ? b.turnId
      : isEngineDriveTurnId(a.turnId)
        ? a.turnId
        : isEngineDriveTurnId(b.turnId)
          ? b.turnId
          : a.turnId;
  const aSteps = Array.isArray(a.steps) ? a.steps.length : 0;
  const bSteps = Array.isArray(b.steps) ? b.steps.length : 0;
  const richer = bSteps > aSteps ? b : a;
  return { ...richer, turnId: id };
}

/** 同原文只留一条：id 认引擎/版本史，步骤认更细的那份（直播 50 步盖过引擎 24 步）。 */
export function dedupeTurnNarrations<T extends NarrationLike>(
  entries: T[],
  preferTurnIds: Iterable<string> = []
): T[] {
  const prefer = new Set(
    [...preferTurnIds].filter((id): id is string => typeof id === "string" && !!id)
  );
  const kept: T[] = [];
  const slotByUser = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry.turnId !== "string" || !entry.turnId) continue;
    const user = trimUser(entry.user);
    if (!user) {
      kept.push(entry);
      continue;
    }
    const slot = slotByUser.get(user);
    if (slot === undefined) {
      slotByUser.set(user, kept.length);
      kept.push(entry);
      continue;
    }
    kept[slot] = pickSameUserNarration(kept[slot], entry, prefer);
  }
  return kept;
}

function modelVersionTurnIdFor(
  state: V5SessionState | null | undefined,
  user: string
): string {
  const raw = (state as { modelVersions?: unknown } | null | undefined)?.modelVersions;
  if (!Array.isArray(raw)) return "";
  for (let i = raw.length - 1; i >= 0; i--) {
    const version = raw[i];
    if (!version || typeof version !== "object") continue;
    const turnId = String((version as { turnId?: unknown }).turnId || "");
    const instruction = (version as { instruction?: unknown }).instruction;
    if (user && usersMatch(instruction, user) && isEngineDriveTurnId(turnId)) {
      return turnId;
    }
  }
  return "";
}

/** `turn-2-drive-full` 是 drive1 收尾改名，叙述键仍是开头的 `turn-1`。 */
function driveTurnIdFromLastTurnId(lastTurnId: string): string {
  const closing = /^turn-(\d+)-drive-full$/.exec(lastTurnId);
  if (closing) {
    const seq = Number(closing[1]);
    return seq >= 2 ? `turn-${seq - 1}` : "";
  }
  return isEngineDriveTurnId(lastTurnId) ? lastTurnId : "";
}

/** 轮次落定时打戳：把本轮 steps 合并进 state.turnNarrations（同轮覆盖，
 *  同原文旧条丢掉，只留最近 MAX_TURNS 轮）。原地不动传入对象——返回带戳的浅拷贝。 */
export function stampTurnNarration(
  state: V5SessionState,
  entry: TurnNarrationEntry
): V5SessionState {
  if (!entry.turnId || entry.steps.length === 0) return state;
  const user = (entry.user || "").slice(0, 600);
  const prior = (state.turnNarrations || []).filter(n => {
    if (!n || n.turnId === entry.turnId) return false;
    return !usersMatch(n.user, user);
  });
  const stamped = [
    ...prior,
    {
      turnId: entry.turnId,
      user,
      steps: entry.steps.slice(0, MAX_STEPS).map(slimStep),
      ...(entry.durationMs ? { durationMs: Math.round(entry.durationMs) } : {}),
    },
  ].slice(-MAX_TURNS);
  return { ...state, turnNarrations: stamped };
}

/** 轮末打戳用的 turnId：盖住引擎 drive 编号，绝不另起时间戳或 `-drive-full`。 */
export function narrationTurnIdFor(
  state: V5SessionState | null | undefined,
  userText: string,
  fallbackTurnId: string
): string {
  const user = trimUser(userText);
  // ⚠ 这里原本写了类型谓词 `n is { turnId: string; user?: string }`，而
  // turnNarrations 的元素类型还带 steps/durationMs——谓词类型必须是参数类型的
  // 子类型，少了字段就不是，于是 TS2677。元素类型本来就保证 turnId: string，
  // 谓词一点没多给，去掉即可；运行期那两条防脏数据的检查照旧。
  const all = (state?.turnNarrations || []).filter(
    n => !!n && typeof n.turnId === "string"
  );
  if (user) {
    const hits = all.filter(n => usersMatch(n.user, user));
    if (hits.length > 0) {
      const engineHit = [...hits].reverse().find(n => isEngineDriveTurnId(n.turnId));
      return (engineHit || hits[hits.length - 1]).turnId;
    }
  }
  const fromVersion = modelVersionTurnIdFor(state, user);
  if (fromVersion) return fromVersion;
  const fromLast = driveTurnIdFromLastTurnId(String(state?.lastTurnId || "").trim());
  if (fromLast) return fromLast;
  return fallbackTurnId;
}

const KNOWN_KINDS = new Set([
  "narration",
  "chip",
  "step_narration",
  "capability_fail",
  "llm_output",
  // ⚠ 2026-09-13：漏了这个 kind，「模型动手之前的开口」就只在**直播时**
  // 看得见，刷新后整段消失——数据其实一直在（落库两侧的 slimStep /
  // _slim_step 都是整对象透传，schema 两侧也都是宽松的 unknown[] /
  // Dict[str, Any]），唯独在这道回放白名单上被丢掉。
  // 这正是本仓 §3 点名的形态：正向（实时能看见）齐全，反向（刷新后还在）
  // 缺失，而且不报错、不告警。
  "model_speech",
  // ⚠ 同理：刷新后标记丢了，折叠就退回认话，而自动续跑没有话可认——
  //   症状是刷新一下，连续的工作流又裂回一轮一张卡。
  "continuation_mark",
]);

/** 刷新回放：从持久化状态取指定轮（缺省最新一轮）的叙述步骤。
 *  持久化数据来自网络往返，形状按未知输入校验——只放行已知 kind 的
 *  dict，其余丢弃（宁缺勿崩）。 */
export function narrationStepsFor(
  state: V5SessionState | null | undefined,
  turnId?: string | null
): { turnId: string; user: string; steps: TurnStep[]; durationMs?: number } | null {
  const all = (state?.turnNarrations || []).filter(
    (n): n is { turnId: string; user?: string; steps: unknown[] } =>
      !!n && typeof n.turnId === "string" && Array.isArray(n.steps)
  );
  if (all.length === 0) return null;
  const entry = turnId ? all.find(n => n.turnId === turnId) : all[all.length - 1];
  if (!entry) return null;
  const steps = entry.steps.filter(
    (s): s is TurnStep =>
      !!s &&
      typeof s === "object" &&
      typeof (s as { id?: unknown }).id === "string" &&
      KNOWN_KINDS.has(String((s as { kind?: unknown }).kind))
  );
  if (steps.length === 0) return null;
  const durationMs = Number((entry as { durationMs?: unknown }).durationMs);
  return {
    turnId: entry.turnId,
    user: String(entry.user || ""),
    steps,
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
  };
}
