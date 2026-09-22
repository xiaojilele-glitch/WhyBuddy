import { factoryHopFromText } from "@/lib/factory-hops";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import {
  parseFiveSystemModelFromPerSkillEvidence,
  summarizeClosureForChat,
} from "./system-screens/five-system-model";
import { finalNarrationStep } from "./turn-route-steps";
import type { UiTurn } from "./types";

/**
 * 精修轮叙述空着时的那句实话。
 *
 * 2026-08-18 篮球馆半场预约：四轮精修 turnNarrations 全空，对话却套首轮
 * ``chatSummary``「含 2 角色、3 页面」——说明书改了，页没动。判据看页，
 * 不看产物个数；空着就空着，不许套另一轮的总结。
 */
export const REFINE_TURN_NO_PAGE_NOTE =
  "本轮没有画出新的页面，上一版保留。叙述未留下，不套用首轮总结。";

/** 跟 Python `turn_narration.HOP_NO_PRODUCE_NOTE` 同一句。 */
export const HOP_NO_PRODUCE_NOTE = "这一跳没有新的产出，上一版保留。";

/**
 * 控制面写给模型的命令，不许当对用户的收尾。
 *
 * ⚠ 导出是有原因的：模型有时会把这类操作员口吻原样复述出来，而
 * `model-speech.ts` 要用**同一份**判据过滤动手前的开口。抄第二份就是
 * §4 点名的「改一半」——过滤规则改了一处，另一处静静放行。
 */
export const OPERATOR_SPEAK =
  /下一跳请调 pages|告诉用户为什么先停|\bwrite_plan\b|\benter_plan_mode\b|\bexit_plan_mode\b|currently in ["']?planning["']? mode/i;

function textFromNarration(turn: UiTurn): string {
  const finalStepText = finalNarrationStep(turn.steps)?.text?.trim();
  return finalStepText || "";
}

export function turnDidFactoryWork(turn: UiTurn): boolean {
  const user = (turn.user || "").trim();
  if (factoryHopFromText(user)) return true;
  if (/假设已确认/.test(user)) return true;
  return (turn.steps || []).some(step => {
    const cap = String(
      (step as { capabilityId?: string }).capabilityId || ""
    );
    const label = String(
      (step as { label?: string; text?: string }).label ||
        (step as { text?: string }).text ||
        ""
    );
    if (cap.startsWith("factory.") || cap.includes("specfirst")) return true;
    return /起草规格|逐页画|界面已出|数据模型|权限绑定/.test(label);
  });
}

export function assistantTextForTurn(
  turn: UiTurn,
  publishClosure?: PublishClosureSummary | null,
  goalText?: string,
  opts?: { runtimeKind?: "html-prototype" | "project" | null }
): string {
  const user = (turn.user || "").trim();
  const assistant = turn.assistant?.trim();
  const leakedOperator = Boolean(
    (assistant && OPERATOR_SPEAK.test(assistant)) ||
      OPERATOR_SPEAK.test(textFromNarration(turn))
  );
  if (assistant && !OPERATOR_SPEAK.test(assistant)) {
    return assistant;
  }
  const narration = textFromNarration(turn);
  if (narration && !OPERATOR_SPEAK.test(narration)) {
    return narration;
  }

  const goal = (goalText || "").trim();
  const isFollowUp = Boolean(user && goal && user !== goal);

  // 工程档没有「画出页面」这回事。真机 TicketStream 计划批准后控制面
  // 没点火，HTML 那句「本轮没有画出新的页面」挂在对话里，右侧还是 C4。
  if (opts?.runtimeKind === "project") {
    return "";
  }

  // 问候 / 提问回执不是精修。goal 后来被芯片改写后，旧轮 user!==goal
  // 会把「你好」收成「本轮没有画出新的页面」（2026-09-08 真机）。
  if (!turnDidFactoryWork(turn) && (isFollowUp || leakedOperator)) {
    const paint = publishClosure?.refinePaintNote?.trim();
    if (paint) return paint;
    return "";
  }
  // 什么都没产出的轮次说什么。
  //
  // ⚠ 2026-09-13：这里原来无条件 `return ""`，把函数末尾那句诚实兜底
  //   （「本轮已完成，但还没有生成可展示的回答。」）整个挡死了。后果是
  //   **刷新回来只看见自己那句话，下面一片空白**——
  //   `SlideRule.unified-surface` 的「reload restores」判据为此长期红着，
  //   而 CI 第一步挂在 typecheck 上，没人看见它。
  //
  //   放行的口子开得很窄，只给「**已经结束的目标轮**」：
  //     · 直播中还没产出        → 留白，别抢在结果前面说话
  //     · 问候 / 追问（没 goal 或 user!==goal）→ 留白，它本来就没有交付物
  //       （2026-09-08 真机：「你好」被收成「本轮没有画出新的页面」）
  //     · 已结束的目标轮还空着  → 那不是克制，是把东西弄丢了
  const finishedGoalTurn =
    turn.status !== "streaming" && Boolean(user && goal && user === goal);
  if (!turnDidFactoryWork(turn) && !publishClosure && !finishedGoalTurn) {
    return "";
  }

  if (isFollowUp) {
    const paint = publishClosure?.refinePaintNote?.trim();
    if (paint) return paint;
    const hop = factoryHopFromText(user);
    if (hop && hop !== "pages") return HOP_NO_PRODUCE_NOTE;
    return REFINE_TURN_NO_PAGE_NOTE;
  }

  if (publishClosure) {
    if (publishClosure.chatSummary?.trim())
      return publishClosure.chatSummary.trim();
    const model = parseFiveSystemModelFromPerSkillEvidence(
      publishClosure.perSkillEvidence as Parameters<
        typeof parseFiveSystemModelFromPerSkillEvidence
      >[0]
    );
    return summarizeClosureForChat(model, {
      goalText: turn.user || goalText,
      blocked: !!publishClosure.blocked,
      evidencePresentCount: publishClosure.evidencePresentCount ?? 0,
      skillCount: publishClosure.skillCount ?? 0,
      versionPinsChecked: !!publishClosure.versionPinsChecked,
    });
  }
  return turn.status === "streaming"
    ? "正在整理推演结果..."
    : "本轮已完成，但还没有生成可展示的回答。";
}
