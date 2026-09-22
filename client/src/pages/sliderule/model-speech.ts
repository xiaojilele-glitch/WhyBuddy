/**
 * model-speech — 模型动手之前说的那段话，按段落呈现。
 *
 * ## 修的是什么（2026-09-13，对照 Manus 截图 + 真机代码）
 *
 * 用户指出「页面没跟上，逻辑是有了」。逐跳核对下来，差的不是能力是呈现：
 *
 *     Manus  「我会采用浅蓝工作台 + 白色卡片 + 橙色优先级作为视觉方向，
 *              接着初始化项目并把核心页面做成可交互的单页客服工作台。」
 *              ——每组动作前面一段第一人称的「要做什么、为什么」
 *
 *     我们    「第 1 轮 · 正在执行 planning」
 *              ——机器味的阶段标签，看不出它在想什么
 *
 * 而模型**本来就在产**那段话。`rehearsal_control` 每一轮拿到的 `content`
 * 会进喂给 LLM 的 `assistant_msg`，但原来只有「还没定产品主题 **且** 这批
 * 工具里有 ask_user_question」才 `yield control_text`——工程模式两个条件
 * 都不成立，于是那段话一个字都没到界面上。生成侧已放宽，这里是消费侧。
 *
 * ## 为什么单独一个 kind，而不是塞进 narration
 *
 * `narration` 会被 `stage-authority.linesFromTurnSteps` 收进左栏活动列表。
 * 模型散文进去就跟「指令已接收 · 启动推理」同等分量地排成一行，正是要修
 * 的那个观感。`model_speech` 不被 `textFromStep` / `linesFromTurnSteps`
 * 认领，所以只在正文里以段落出现——**不会跟活动列表双渲染**。
 *
 * ⚠ 2026-09-16 TicketStream：完成轮仍会双渲染。活路径一条 `control_text`
 *   既 `appendModelSpeech` 又写入 `turn.assistant`（`onControlHostText`）；
 *   刷新 `turnsFromControlTranscript` 把最后一句开口再抄进 `assistant`。
 *   `assistantTextForTurn` **先吃 `turn.assistant`**，不是只认 `isFinal`
 *   的 narration。故事面画完开口，下面 `Response` 再印一遍。
 *   消费侧用 `answerAlreadySpoken` 挡收尾，不许再靠这条过期注释。
 */

import { OPERATOR_SPEAK } from "./assistant-text-for-turn";
import type { TurnStep, UiTurn } from "./types";

export type ModelSpeech = Extract<TurnStep, { kind: "model_speech" }>;

/**
 * 这段话值不值得作为「开口」摆给用户。
 *
 * ⚠ 判据盯**语义**不盯字面长度：空白、纯标点、模型复述控制面命令，
 * 都不是对用户说的话。其余一律放行——替模型裁剪它想说什么，是另一种
 * 「端出成功但内容为空」。
 *
 * ⚠ 2026-09-16 文种过滤拿掉了。前一天按 TicketStream 真机加了
 *   「中文用户 + 拉丁独白 = 思考，不当开口」；次日同一产品批准执行
 *   （sr-20260916002025-Y3ZS3DZASB）墙钟停住，正文只剩英文计划和
 *   ○◐ 清单，左栏滤成「工作了 4m 40s」下面空白。用户说弊大于利。
 *   生成侧提示词仍要求跟用户同一种语言；消费侧不再按字母表藏正文。
 *   `userText` 留下给旧调用点，不再参与判定。
 */
export function isUserFacingSpeech(text: unknown, _userText?: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (OPERATOR_SPEAK.test(value)) return false;
  // 纯标点/符号（模型偶发吐出的 "..."、"—"）不是开口。
  return /[\p{L}\p{N}]/u.test(value);
}

/** 本轮模型说过的话，按发生顺序。 */
export function modelSpeechFor(turn: UiTurn | null | undefined): ModelSpeech[] {
  const steps = turn?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter(
    (step): step is ModelSpeech =>
      !!step &&
      step.kind === "model_speech" &&
      isUserFacingSpeech(step.text, turn?.user)
  );
}

/**
 * 相邻重复的开口合成一条。
 *
 * ⚠ 只合**逐字相同且相邻**的。通用去重会抹掉真实信息：模型在两组动作之间
 * 说同一句「继续修正类型错误」可能真的是两次修正。这条纪律跟
 * `turn-continuation` 里「同一条路线不许说两遍、但逐页画三次要留」同源。
 */
export function dedupeAdjacentSpeech(items: ModelSpeech[]): ModelSpeech[] {
  const out: ModelSpeech[] = [];
  for (const item of items) {
    const previous = out[out.length - 1];
    if (previous && previous.text.trim() === item.text.trim()) continue;
    out.push(item);
  }
  return out;
}

/**
 * 活儿清单的状态记号。
 *
 * ⚠ **这是 §4 那种成对物**：真正定义它的是 Python 侧
 *   `services/plan_todo.py` 的 `_TAG`（"清单渲染唯一处"）。这里是消费侧的
 *   镜像，两边对不上就会出现"改了一半、只有一半生效"——加了一档状态而这里
 *   不认，那一档的清单就不再被识别成清单，于是又整份重印。
 *   `model-speech-todo-matches-python.test.ts` 两头钉着。
 */
export const TODO_STATUS_MARKERS = "○◐●✕";

/**
 * 这段话是不是「整份活儿清单」。
 *
 * 判据：非空行**全部**以状态记号开头。只有一行也算——模型确实会只重印
 * 剩下的那一条。夹了散文的段落不算（那是它在解释，不是在重印）。
 */
export function isChecklistSnapshot(text: unknown): boolean {
  const lines = String(text ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every(line =>
    TODO_STATUS_MARKERS.includes(line[0]) && line.length > 1
  );
}

/**
 * 整份清单一轮只留**最后**那一份。
 *
 * ## 为什么（2026-09-14，真机量出来的）
 *
 * 工程档一轮里，`model-speech` 437px 中有**两块 143px 是同一份清单**
 * （只差 ● / ◐ 两个记号），286px = 这块的 65%、整轮 799px 的 36%。
 * 模型每调一次 `todo_write` 就在叙述里照抄一遍——因为提示词每轮都把
 * 渲染好的清单喂给它（`rehearsal_control:2985`）。轮数越多印得越多。
 *
 * 清单是**状态**，不是事件：把状态按事件流一份份铺开，就像每改一行就把
 * 整个文件重打一遍。留最后一份 = 留当前状态。
 *
 * ⚠ 2026-09-15：清单从对话里拿掉。它是状态，该浮在输入条上头
 *   （`PlanTodoDock` 读同一份 `controlTodo`）。聊天里再印一份 ○◐●，
 *   就是用户对照 Manus 圈出来的「待办嵌在聊天里，非常不好用」。
 *   左栏 chip 和「后续建议」仍然读 `controlTodo`。§3 的「还在」落在浮层。
 * ⚠ 也不是通用去重：`dedupeAdjacentSpeech` 只合逐字相同的，这两份**不相同**
 *   （状态记号变了），所以它咬不住——这条判的是语义形状，不是字节。
 */
export function keepLatestChecklist(items: ModelSpeech[]): ModelSpeech[] {
  let last = -1;
  items.forEach((item, index) => {
    if (isChecklistSnapshot(item.text)) last = index;
  });
  if (last < 0) return items;
  return items.filter(
    (item, index) => index === last || !isChecklistSnapshot(item.text)
  );
}

/** 正文要渲染的那批：散文留下，整份清单不进聊天。 */
export function renderableModelSpeech(
  turn: UiTurn | null | undefined
): ModelSpeech[] {
  return keepLatestChecklist(dedupeAdjacentSpeech(modelSpeechFor(turn))).filter(
    item => !isChecklistSnapshot(item.text)
  );
}

/**
 * 收尾文字是不是故事面已经画过的开口。
 *
 * 只认**整段相同**（单条或按出现顺序拼起来）。半句重合可能是真的补了一句，
 * 不许当重复吞掉。
 */
export function answerAlreadySpoken(
  text: string,
  turn: UiTurn | null | undefined
): boolean {
  const answer = text.trim();
  if (!answer) return false;
  const spoken = renderableModelSpeech(turn)
    .map(item => item.text.trim())
    .filter(Boolean);
  if (spoken.includes(answer)) return true;
  return spoken.join("\n\n") === answer || spoken.join("\n") === answer;
}
