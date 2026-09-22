import React from "react";
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestion } from "lucide-react";

/**
 * G_READY 澄清问题卡片（多步分页）。
 * ⚠ 2026-08-20：必须 absolute 叠在输入框上方。进 flex 流（mb-2 占位）
 * 会把输入框顶走——空态 justify-center 时整块重新居中，跳得更明显。
 * 词汇对齐 V4 `BlueprintClarificationQuestion`（type/options:string[]/defaultAnswer/context）。
 * 数据源：sessionState.coverageGaps 的 open open_question gaps（由 SlideRule.tsx 派生传入）。
 *
 * 2026-09-15 卡面抄 Cursor 文件卡（跟计划审批同一套）：12px 圆角、`#e5e7eb`
 * 边、近黑下一步，不要蓝徽章 / 桃红阴影那张问卷。出口没变。
 */
export type ClarificationItem = {
  id: string;
  prompt: string;
  kind?: string;  // V4 alignment (e.g. "audience", blueprint question id)
  /** 事件自带的人话。有它就不查 KIND_LABELS。 */
  kindLabel?: string;
  type?: "free_text" | "single_choice" | "multi_choice";
  options?: string[];
  defaultAnswer?: string;
  context?: string;
};

export type ClarificationAnswer = { gapId: string; answer: string };

/**
 * 澄清卡数据源。从 coverageGaps 滤出「现在该画」的题。
 *
 * ⚠ 2026-09-01 真机：股票分析器三道题都选完了，「「…」答：…」已经进了
 * 会话，卡又从「待回答问题 1/3 / 已答 0/3」弹一遍。成因不是模型又问了
 * 一轮——是提交后新一轮 `isRunning=true`，`awaitReason` 还停在
 * `control_clarify`，磁盘里的缺口还是 open；`pendingClarifications` 的
 * useMemo 因 isRunning 换了数组身份，卡片 useEffect 把 picks 清零。
 *
 * 停泊那一发（还没提交）isRunning 也要画卡；提交过的这一发不许再画。
 */
export type ClarificationGapLike = {
  id: string;
  kind?: string;
  status?: string;
  label: string;
  clarifyKind?: string;
  kindLabel?: string;
  clarifyType?: ClarificationItem["type"];
  options?: string[];
  defaultAnswer?: string;
  context?: string;
};

export function pendingClarificationItems(opts: {
  gaps: ClarificationGapLike[] | undefined;
  awaitReason: string | undefined | null;
  isRunning: boolean;
  submittedGapIds?: Iterable<string>;
}): ClarificationItem[] {
  const parkedClarify = opts.awaitReason === "control_clarify";
  // 只在停泊澄清时画卡。open 缺口留下但 awaitReason 已空 = 用户已经
  // 另说一句，不许把「谁用」问卷粘在后面每一轮上（2026-09-08 真机：
  // hello 出卡后打「你好」卡还在）。
  if (!parkedClarify) return [];
  const submitted = new Set(
    Array.from(opts.submittedGapIds || []).map(id => String(id))
  );
  // 答完提交后的这一发：哪怕 awaitReason 还停在 control_clarify、缺口
  // 还是 open，也不许把同一张卡再画一遍。
  if (opts.isRunning && submitted.size > 0) return [];
  return (opts.gaps || [])
    .filter(g => g.status === "open" && g.kind === "open_question")
    .map(g => ({
      id: g.id,
      prompt: g.label,
      kind: g.clarifyKind,
      kindLabel: g.kindLabel,
      type: g.clarifyType,
      options: g.options,
      defaultAnswer: g.defaultAnswer,
      context: g.context,
    }));
}

export function clarificationQuestionKey(
  questions: Array<{ id: string }>
): string {
  return questions.map(q => q.id).join("|");
}

const OTHER = "__other__";

/**
 * 维度键 → 人话标签。
 *
 * ⚠ 2026-08-27 真机截图逮到的：卡片把 `kind` **原样**印在问题旁边，用户看到的
 *   是一个孤零零的 `users`，底下按钮还写着「批量 users」。这是内部词表，
 *   不是给人看的。认不出的键**不显示**——宁可少一个标签，也不要在用户脸上
 *   糊一串英文。
 */
const KIND_LABELS: Record<string, string> = {
  users: "谁用",
  audience: "谁用",
  platform: "在哪用",
  scenario: "核心流程",
  "success-criteria": "核心流程",
  scope: "本期边界",
  rules: "规则",
};

export function kindLabel(kind?: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (!kind) return "";
  const key = kind.trim().toLowerCase();
  if (KIND_LABELS[key]) return KIND_LABELS[key];
  for (const [k, label] of Object.entries(KIND_LABELS)) {
    if (key.includes(k)) return label;
  }
  return "";
}

export function ClarificationCard({
  questions,
  onSubmit,
  onClose,
}: {
  questions: ClarificationItem[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
  onClose: () => void;
}) {
  const total = questions.length;
  const [step, setStep] = React.useState(0);
  // 每题：选中的 option（或 OTHER），以及 multi_choice 的多选集合 / free_text 与 其他 的文本
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [multi, setMulti] = React.useState<Record<string, Set<string>>>({});
  const [otherText, setOtherText] = React.useState<Record<string, string>>({});
  const questionKey = clarificationQuestionKey(questions);

  React.useEffect(() => {
    // 预选 defaultAnswer（若匹配某个选项）
    // ⚠ 钉 questionKey 不钉 questions 数组身份：提交后 isRunning 翻转会
    // 换一个同 id 的新数组，useEffect([questions]) 把 picks 清成已答 0/3。
    const seedPick: Record<string, string> = {};
    for (const q of questions) {
      if (q.type !== "multi_choice" && q.defaultAnswer && (q.options || []).includes(q.defaultAnswer)) {
        seedPick[q.id] = q.defaultAnswer;
      }
    }
    setPicked(seedPick);
    setMulti({});
    setOtherText({});
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 身份变、id 不变时不许把已答清零
  }, [questionKey]);

  if (total === 0) return null;
  const q = questions[Math.min(step, total - 1)];
  const isChoice = (q.type === "single_choice" || q.type === "multi_choice") && (q.options || []).length > 0;
  const isMulti = q.type === "multi_choice";

  const answerFor = (item: ClarificationItem): string => {
    if (isMultiType(item)) {
      const set = multi[item.id];
      const parts = set ? [...set] : [];
      if (set?.has(OTHER) && otherText[item.id]?.trim()) {
        parts.splice(parts.indexOf(OTHER), 1, otherText[item.id].trim());
      } else if (set?.has(OTHER)) {
        parts.splice(parts.indexOf(OTHER), 1);
      }
      return parts.join("、");
    }
    const p = picked[item.id];
    if (p === OTHER) return otherText[item.id]?.trim() || "";
    if (p) return p;
    // free_text 或未选：取 其他/文本 输入
    return otherText[item.id]?.trim() || "";
  };

  function isMultiType(item: ClarificationItem): boolean {
    return item.type === "multi_choice" && (item.options || []).length > 0;
  }

  const answeredCount = questions.filter((item) => answerFor(item).length > 0).length;

  const submit = () => {
    const answers: ClarificationAnswer[] = questions
      .map((item) => ({ gapId: item.id, answer: answerFor(item) }))
      .filter((a) => a.answer.length > 0);
    if (answers.length === 0) return;
    onSubmit(answers);
  };

  const toggleMulti = (value: string) => {
    setMulti((prev) => {
      const next = new Set(prev[q.id] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [q.id]: next };
    });
  };

  const currentKind = kindLabel(q.kind, q.kindLabel);
  const markClass = (selected: boolean) =>
    `flex size-4 shrink-0 items-center justify-center border ${
      isMulti ? "rounded-[3px]" : "rounded-full"
    } ${
      selected
        ? "border-[#171717] bg-[#171717] text-white"
        : "border-[#d4d4d4] text-transparent"
    }`;

  return (
    <div
      className="pointer-events-auto absolute bottom-full left-0 right-0 z-[30] mb-2 w-full origin-bottom sr-composer-pop overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white text-[#171717] shadow-[0_2px_8px_rgba(31,35,40,0.06)]"
      data-testid="sliderule-clarification-card"
      data-clarification-surface="cursor"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-3">
        <MessageCircleQuestion
          className="size-3.5 shrink-0 text-[#8b8b8b]"
          aria-hidden
        />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#333]">
          问题
        </h2>
        <span
          className="shrink-0 text-[12px] tabular-nums text-[#9a9a9a]"
          data-testid="sliderule-clarification-pager"
        >
          {step + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-[12px] text-[#8b8b8b] outline-none hover:text-[#333] focus-visible:ring-2 focus-visible:ring-[#171717]/20"
          title="跳过（也可直接在下方输入框补充）"
          data-testid="sliderule-clarification-close"
        >
          跳过
        </button>
      </header>

      <div className="px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <p className="text-[13.5px] font-medium leading-[1.55] text-[#171717]">
            {q.prompt}
          </p>
          {currentKind ? (
            <span
              data-testid="sliderule-clarification-kind"
              className="shrink-0 text-[11px] text-[#8b8b8b]"
            >
              {currentKind}
            </span>
          ) : null}
        </div>
        {q.context ? (
          <p className="mt-1 text-[12px] leading-relaxed text-[#8b8b8b]">
            {q.context}
          </p>
        ) : null}

        <div className="mt-2.5 space-y-0.5">
          {isChoice &&
            (q.options || []).map(opt => {
              const isRecommended = q.defaultAnswer === opt;
              const selected = isMulti
                ? (multi[q.id]?.has(opt) ?? false)
                : picked[q.id] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    isMulti
                      ? toggleMulti(opt)
                      : setPicked(p => ({ ...p, [q.id]: opt }))
                  }
                  className={`flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] leading-5 transition ${
                    selected
                      ? "bg-[#f3f4f6] text-[#171717]"
                      : "text-[#444] hover:bg-[#f7f7f7]"
                  }`}
                >
                  <span className={`mt-0.5 ${markClass(selected)}`}>
                    {selected ? <Check className="size-3" strokeWidth={2.6} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{opt}</span>
                  {isRecommended ? (
                    <span className="mt-0.5 shrink-0 text-[11px] text-[#8b8b8b]">
                      推荐
                    </span>
                  ) : null}
                </button>
              );
            })}

          {isChoice ? (
            <div
              className={`flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 ${
                (isMulti ? multi[q.id]?.has(OTHER) : picked[q.id] === OTHER)
                  ? "bg-[#f3f4f6]"
                  : ""
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  isMulti
                    ? toggleMulti(OTHER)
                    : setPicked(p => ({ ...p, [q.id]: OTHER }))
                }
                className={markClass(
                  Boolean(isMulti ? multi[q.id]?.has(OTHER) : picked[q.id] === OTHER)
                )}
              >
                {(isMulti ? multi[q.id]?.has(OTHER) : picked[q.id] === OTHER) ? (
                  <Check className="size-3" strokeWidth={2.6} />
                ) : null}
              </button>
              <input
                type="text"
                value={otherText[q.id] || ""}
                onChange={e => {
                  setOtherText(o => ({ ...o, [q.id]: e.target.value }));
                  if (!isMulti && e.target.value)
                    setPicked(p => ({ ...p, [q.id]: OTHER }));
                }}
                placeholder="其他（自己写）"
                className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-[#171717] outline-none placeholder:text-[#b0b0b0]"
                data-testid="sliderule-clarification-other"
              />
            </div>
          ) : (
            <textarea
              value={otherText[q.id] || ""}
              onChange={e => setOtherText(o => ({ ...o, [q.id]: e.target.value }))}
              placeholder="输入你的回答…"
              rows={2}
              className="w-full resize-none rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] text-[#171717] outline-none focus:border-[#171717]"
              data-testid="sliderule-clarification-text"
            />
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] px-3 py-2.5">
        <span className="text-[12px] tabular-nums text-[#9a9a9a]">
          已答 {answeredCount} / {total}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {currentKind && total > 1 ? (
            <button
              type="button"
              onClick={() => {
                const sameKind = questions.filter(item => item.kind === q.kind);
                const answers: ClarificationAnswer[] = sameKind
                  .map(item => ({ gapId: item.id, answer: answerFor(item) }))
                  .filter(a => a.answer.length > 0);
                if (answers.length > 0) onSubmit(answers);
              }}
              className="rounded-[8px] px-2 text-[12px] text-[#8b8b8b] hover:text-[#333]"
              title={`把这一类问题一起提交（${currentKind}）`}
            >
              提交同类
            </button>
          ) : null}
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#f3f4f6] px-3 text-[13px] text-[#333]"
            >
              <ChevronLeft className="size-3.5" /> 上一步
            </button>
          ) : null}
          {step < total - 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.min(total - 1, s + 1))}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#171717] px-3 text-[13px] text-white"
              data-testid="sliderule-clarification-next"
            >
              下一步 <ChevronRight className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={answeredCount === 0}
              className="inline-flex h-8 items-center rounded-[8px] bg-[#171717] px-3 text-[13px] text-white disabled:opacity-40"
              data-testid="sliderule-clarification-submit"
            >
              继续
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
