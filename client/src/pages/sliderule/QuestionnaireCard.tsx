/**
 * 问用户：一次几道，每项写清「选它意味着什么」。
 *
 * 抄的标准答案：grok-build `xai-grok-pager/src/views/question_view.rs`
 * 与工具侧 `ask_user_question/mod.rs` 的 `description_template`：
 *
 *     - Every question automatically gets an "Other" choice where the user
 *       can type their own answer.
 *     - Put your recommended option first and append "(Recommended)" to its label.
 *
 * ⚠ 第一句是**服务端对渲染侧的承诺**：Other 由这里补，模型不许自己往 options
 *   里塞一个「其他」（工具说明写着「你不要自己加」）。生成侧/消费侧成对，
 *   本仓 §四——两边判据各钉一条，缺一条就会出现两个「其他」或者一个都没有。
 *
 * ## 为什么不是原来那排芯片
 *
 * 上一版是作曲家顶行的一排芯片：问句截断到 14rem，选项只有标签，点一下就答。
 * 三个后果，真机上都见过：
 *
 *   · 模型想说清「选它意味着什么」无处可写，就把解释塞进问句 → 一大坨字被截断；
 *   · 一次只能问一道 → 要拿三件主意就连问三轮，用户开始不耐烦；
 *   · 点一下即答，没有"想一下再提交" —— 手滑就是一个决定。
 *
 * 分页 + 确认继续这套是照 `AssumptionStrip` 来的：那张卡在真机上跑通过，
 * 用户认得这个交互（本仓 §五：判据落在用户真正看到的东西上，交互也一样）。
 *
 * 2026-09-15 卡面抄 Cursor 文件卡（跟计划审批同一套）：12px 圆角、近黑
 * 下一步，推荐贴在选项标题旁边，不要蓝问卷把一行撑出一块空白。
 * 四个出口没变。
 */
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/** 「其他（自己写）」那一项的 label。跟 `services/user_questions.py` 同一份。 */
export const OTHER_LABEL = "其他（自己写）";
/** 推荐项的后缀。模型按工具说明加在标签末尾，这里摘掉换成角标。 */
export const RECOMMENDED_SUFFIX = "（推荐）";

export type QuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type ControlQuestion = {
  id: string;
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

export type QuestionnaireOutcome =
  | { outcome: "accepted"; answers: Record<string, string[]>; notes: Record<string, string> }
  | { outcome: "cancelled" }
  | { outcome: "skip_interview"; answers: Record<string, string[]> };

/** 标签末尾带「（推荐）」的那一项：摘掉后缀，交给角标去说。 */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
  return label.endsWith(RECOMMENDED_SUFFIX)
    ? { text: label.slice(0, -RECOMMENDED_SUFFIX.length).trim(), recommended: true }
    : { text: label, recommended: false };
}

export function QuestionnaireCard({
  questions,
  paused,
  onSubmit,
}: {
  questions: ControlQuestion[];
  /** 工厂停在这儿等人。卡上要说出来，否则用户不知道是不是自己拖住了。 */
  paused?: boolean;
  onSubmit: (result: QuestionnaireOutcome) => void;
}) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const total = questions.length;
  const safeStep = Math.min(Math.max(step, 0), Math.max(total - 1, 0));
  const q = questions[safeStep];

  /* Other 永远在最后一项，永远存在——这是工具说明对模型的承诺。 */
  const options = useMemo(
    () => [...(q?.options || []), { label: OTHER_LABEL } as QuestionOption],
    [q]
  );

  // A few providers still emit a valid question with an empty options array.
  // Keep the grok-mandated Other path usable instead of showing a card with no
  // answer selected and a hidden text field.
  useEffect(() => {
    if (q && q.options.length === 0) {
      setPicked(prev => (prev[q.id]?.includes(OTHER_LABEL) ? prev : { ...prev, [q.id]: [OTHER_LABEL] }));
    }
  }, [q]);

  if (!q) return null;

  const current = picked[q.id] || [];
  const multi = Boolean(q.multiSelect);

  const toggle = (label: string) => {
    setPicked(prev => {
      const was = prev[q.id] || [];
      if (!multi) return { ...prev, [q.id]: [label] };
      return {
        ...prev,
        [q.id]: was.includes(label) ? was.filter(x => x !== label) : [...was, label],
      };
    });
  };

  const answers = () => {
    const out: Record<string, string[]> = {};
    for (const row of questions) {
      const picks = picked[row.id];
      if (picks && picks.length) out[row.id] = picks;
    }
    return out;
  };

  const markClass = (selected: boolean) =>
    `mt-0.5 flex size-4 shrink-0 items-center justify-center border ${
      multi ? "rounded-[3px]" : "rounded-full"
    } ${
      selected
        ? "border-[#171717] bg-[#171717] text-white"
        : "border-[#d4d4d4] text-transparent"
    }`;

  return (
    <div
      className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white text-[#171717] shadow-[0_2px_8px_rgba(31,35,40,0.06)]"
      data-testid="sliderule-questionnaire"
      data-questionnaire-surface="cursor"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-3">
        <MessageCircleQuestion
          className="size-3.5 shrink-0 text-[#8b8b8b]"
          aria-hidden
        />
        <h2 className="min-w-0 truncate text-[13px] font-medium text-[#333]">
          问题
        </h2>
        <span
          className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-[#9a9a9a]"
          data-testid="sliderule-questionnaire-pager"
        >
          {safeStep + 1} / {total}
          {paused ? " · 已停住，选完再继续" : " · 选完再继续"}
        </span>
        <button
          type="button"
          data-testid="sliderule-questionnaire-cancel"
          title="这些我不答，你自己定"
          onClick={() => onSubmit({ outcome: "cancelled" })}
          className="shrink-0 text-[12px] text-[#8b8b8b] outline-none hover:text-[#333] focus-visible:ring-2 focus-visible:ring-[#171717]/20"
        >
          你自己定
        </button>
      </header>

      <div className="px-3.5 py-3" data-testid="sliderule-questionnaire-question">
        <p className="text-[13.5px] font-medium leading-[1.55] text-[#171717]">
          {q.question}
        </p>
        {multi ? (
          <p className="mt-1 text-[12px] text-[#8b8b8b]">可以多选</p>
        ) : null}
        {q.options.length === 0 ? (
          <p className="mt-1 text-[12px] text-[#8b8b8b]">
            这道题没有预设选项，请直接填写你的答案。
          </p>
        ) : null}
        <div className="mt-2.5 space-y-0.5">
          {options.map(opt => {
            const { text, recommended } = splitRecommended(opt.label);
            const selected = current.includes(opt.label);
            const isOther = opt.label === OTHER_LABEL;
            return (
              <div key={opt.label}>
                <button
                  type="button"
                  data-testid="sliderule-questionnaire-option"
                  data-recommended={recommended ? "true" : "false"}
                  data-other={isOther ? "true" : "false"}
                  onClick={() => toggle(opt.label)}
                  className={`flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] leading-5 transition ${
                    selected
                      ? "bg-[#f3f4f6] text-[#171717]"
                      : "text-[#444] hover:bg-[#f7f7f7]"
                  }`}
                >
                  <span className={markClass(selected)}>
                    {selected ? (
                      <Check className="size-3" strokeWidth={2.6} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <span>{text}</span>
                      {recommended ? (
                        <span className="text-[11px] text-[#8b8b8b]">推荐</span>
                      ) : null}
                    </span>
                    {opt.description ? (
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-[#8b8b8b]">
                        {opt.description}
                      </span>
                    ) : null}
                  </span>
                </button>
                {selected && !multi && opt.preview ? (
                  <pre
                    data-testid="sliderule-questionnaire-preview"
                    className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-2.5 py-1.5 text-[12px] leading-relaxed text-[#666]"
                  >
                    {opt.preview}
                  </pre>
                ) : null}
                {selected && isOther ? (
                  <input
                    data-testid="sliderule-questionnaire-other-input"
                    autoFocus
                    value={notes[q.id] || ""}
                    placeholder="写你自己的答案"
                    onChange={e =>
                      setNotes(prev => ({ ...prev, [q.id]: e.target.value }))
                    }
                    className="mt-1 w-full rounded-[8px] border border-[#e5e7eb] px-3 py-1.5 text-[13px] text-[#171717] outline-none focus:border-[#171717]"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] px-3 py-2.5">
        <button
          type="button"
          data-testid="sliderule-questionnaire-skip"
          title="别再问了，按现在知道的直接开始"
          onClick={() => onSubmit({ outcome: "skip_interview", answers: answers() })}
          className="text-[12px] text-[#8b8b8b] hover:text-[#333]"
        >
          别再问了，直接开始
        </button>
        <div className="flex items-center gap-2">
          {safeStep > 0 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#f3f4f6] px-3 text-[13px] text-[#333]"
            >
              <ChevronLeft className="size-3.5" /> 上一题
            </button>
          ) : null}
          {safeStep < total - 1 ? (
            <button
              type="button"
              data-testid="sliderule-questionnaire-next"
              onClick={() => setStep(s => Math.min(total - 1, s + 1))}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#171717] px-3 text-[13px] text-white"
            >
              下一题 <ChevronRight className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="sliderule-questionnaire-submit"
              onClick={() =>
                onSubmit({ outcome: "accepted", answers: answers(), notes })
              }
              className="inline-flex h-8 items-center rounded-[8px] bg-[#171717] px-3 text-[13px] text-white"
            >
              确认继续
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
