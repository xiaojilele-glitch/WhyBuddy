/**
 * 输入条上方的计划正文。三个出口没变：批准 / 改意见 / 退出。
 *
 * 2026-09-15 用户圈了「计划审批」说照 Cursor 改一版。第一版是绿批准
 * 按钮 + 粗标题栏的审批表（`#166534` / `shadow-lg`），不像 Cursor
 * 聊天里那张文件卡。卡面抄 Cursor：12px 圆角、`#e5e7eb` 边、近黑
 * Accept、文件头写「计划」。aria-label 仍是「计划审批」，别改出口。
 */
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FileText, Pencil, X } from "lucide-react";
import type { ControlPlanApprovalWire } from "@/lib/sliderule-marathon-driver";

export type PlanApprovalOutcome = {
  reqId: string;
  outcome: "approved" | "cancelled" | "abandoned";
  feedback?: string;
};

export function PlanApprovalPanel({
  plan,
  onSubmit,
}: {
  plan: ControlPlanApprovalWire;
  onSubmit: (result: PlanApprovalOutcome) => void;
}) {
  const [feedback, setFeedback] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const submittedRef = React.useRef(false);
  const submit = (outcome: PlanApprovalOutcome["outcome"]) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    onSubmit({
      reqId: plan.reqId,
      outcome,
      ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
    });
  };

  return (
    <section
      aria-label="计划审批"
      data-testid="sliderule-plan-approval"
      data-plan-approval-surface="cursor"
      className="flex max-h-[calc(100dvh-24px)] min-h-0 flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white text-[#171717] shadow-[0_2px_8px_rgba(31,35,40,0.06)] sm:max-h-[min(70dvh,640px)]"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-3">
        <FileText className="size-3.5 shrink-0 text-[#8b8b8b]" aria-hidden />
        <h2 className="min-w-0 truncate text-[13px] font-medium text-[#333]">
          计划
        </h2>
      </header>
      <div
        data-testid="sliderule-plan-content"
        className="min-h-0 flex-1 overflow-auto px-3.5 py-3 text-[13.5px] leading-[1.7] text-[#171717] [overflow-wrap:anywhere] [&_h1]:mb-2 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-[13.5px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-[13px] [&_h3]:font-semibold [&_p]:mb-2.5 [&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-[#f3f4f6] [&_pre]:p-3 [&_code]:rounded [&_code]:bg-[#f3f4f6] [&_code]:px-1 [&_table]:w-full [&_td]:border [&_td]:border-[#e5e7eb] [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-[#e5e7eb] [&_th]:px-2 [&_th]:py-1.5 [&_a]:text-[#2f6bff] [&_a]:underline"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {plan.planContent}
        </ReactMarkdown>
      </div>
      <footer className="shrink-0 border-t border-[#e5e7eb] px-3 py-2.5">
        {editing ? (
          <textarea
            autoFocus
            aria-label="计划修改意见"
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            disabled={submitted}
            rows={3}
            className="mb-2.5 block w-full resize-y rounded-[8px] border border-[#e5e7eb] px-3 py-2 text-[13px] outline-none focus:border-[#171717]"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="sliderule-plan-approve"
            disabled={submitted}
            onClick={() => submit("approved")}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#171717] px-3 text-[13px] text-white disabled:opacity-50"
          >
            <Check className="size-3.5 shrink-0" />
            批准并执行
          </button>
          <button
            type="button"
            data-testid="sliderule-plan-revise"
            disabled={submitted}
            onClick={() => (editing ? submit("cancelled") : setEditing(true))}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#f3f4f6] px-3 text-[13px] text-[#333] disabled:opacity-50"
          >
            <Pencil className="size-3.5 shrink-0" />
            {editing ? "提交修改" : "修改计划"}
          </button>
          <button
            type="button"
            data-testid="sliderule-plan-abandon"
            disabled={submitted}
            onClick={() => submit("abandoned")}
            className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-[#8b8b8b] disabled:opacity-50"
          >
            <X className="size-3.5 shrink-0" />
            退出计划
          </button>
        </div>
      </footer>
    </section>
  );
}
