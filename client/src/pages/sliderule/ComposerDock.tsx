import React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  FileText,
  ImagePlus,
  Lightbulb,
  Loader2,
  Plus,
  ArrowUp,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { EXAMPLE_INTENT_TEXTS } from "./example-intents";
import { shouldSendOnKey } from "./user-prefs";
import { PlanApprovalPanel, type PlanApprovalOutcome } from "./PlanApprovalPanel";
import {
  QuestionnaireCard,
  type QuestionnaireOutcome,
} from "./QuestionnaireCard";
import { installKeyOf, loadInstalledSkills } from "./installed-skills";
import {
  applyRehearsalSlashPick,
  applySkillSlashPick,
  applySlashPick,
  COMPOSER_SLASH_REHEARSAL_ITEMS,
  filterSlashItems,
  installedSkillSlashItems,
  moveHighlight,
  seedSlash,
  slashQueryAt,
  type SlashItem,
} from "./composer-slash";
import {
  fetchSkillCatalog,
  type SkillPackage,
} from "@/lib/skill-store-client";
import {
  BUILTIN_PARTNERS,
  loadPartners,
  partnerCapabilities,
  type Partner,
} from "./partners";
import { CapabilityChip, ComposerSlashMenu } from "./ComposerSlashMenu";
import { listConnectors, type ConnectorSpec } from "./connectors-client";
import {
  loadTurnCapabilities,
  saveTurnCapabilities,
  takePendingOpener,
} from "./turn-capabilities";
import {
  applyChallengePrefillToComposer,
  CHALLENGE_PREFILL_EVENT,
} from "./challenge-composer";

/** E31 图片/PDF 提取结果（后端 /attachments/extract 的诚实回执）。 */
interface AttachmentExtractOutcome {
  ok: boolean;
  context?: string;
  detail?: string;
  chars?: number;
}

/** 附件预览卡的数据形态（图片带 objectURL 缩略图）。 */
interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  previewUrl: string | null;
  /** E28：保留原始 File——发送时文本类附件读内容注入指令上下文 */
  file?: File;
  /** E31：图片/PDF 服务端提取状态（上传即解析，发送时注入缓存结果） */
  extractStatus?: "pending" | "ready" | "failed";
  extractDetail?: string;
  extractChars?: number;
}

// E28 附件上下文注入（第一刀，纯浏览器）：文本类附件直接读内容并入指令。
// E31（本期）：图片走视觉 LLM、PDF 走 E2B 沙盒提取——上传即发服务端解析，
// 发送时注入缓存结果；解析失败如实只带文件名。
const TEXT_ATTACHMENT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|yaml|yml|xml|html?|css|js|jsx|ts|tsx|py|java|go|rs|rb|php|sql|sh|toml|ini|conf|log)$/i;
const EXTRACTABLE_ATTACHMENT_EXT = /\.(png|jpe?g|webp|gif|pdf)$/i;
const MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024;
const MAX_CHARS_PER_ATTACHMENT = 6000;
const MAX_TOTAL_ATTACHMENT_CHARS = 12000;

function isTextAttachment(att: ComposerAttachment): boolean {
  if (!att.file) return false;
  if (EXTRACTABLE_ATTACHMENT_EXT.test(att.name)) return false;
  if (att.file.type.startsWith("text/")) return true;
  return TEXT_ATTACHMENT_EXT.test(att.name);
}

/** E31：该附件是否走服务端提取（图片/PDF）。 */
export function isExtractableAttachment(name: string): boolean {
  return EXTRACTABLE_ATTACHMENT_EXT.test(name);
}

/**
 * 是否还有附件在「解析中」。
 *
 * 2026-08-20 真机：缩略图写着「解析中…」，发送键却是亮的。点下去
 * 旧逻辑会立刻清掉附件卡、在后台等提取再发——用户没法改口，看起来
 * 像发出去了。LobeChat（`isUploadingFiles` 同时闸 disabled 和 handleSend）
 * 与 LibreChat（`filesLoading` 闸 SendButton；#2078 专门修了「只禁按钮、
 * Enter 照样发」）都是同一条：任一文件未就绪就不许提交。
 *
 * failed 不算 pending——提取失败本来就 fail-open 只带文件名，不能把发送锁死。
 */
export function isAttachmentExtractPending(
  attachments: Array<{ extractStatus?: "pending" | "ready" | "failed" }>
): boolean {
  return attachments.some(a => a.extractStatus === "pending");
}

/**
 * 发送键该不该灰。推演中发送仍是发送（排队到下一轮），空输入仍灰。
 * 停止是另一颗方块按钮，不把发送变成停止。
 * 空输入且无附件 → 灰；任一附件解析中 → 灰。
 * 入站审查 / 优化提示词在飞 → 灰（2026-08-20：生成审查卡时发送仍亮，
 * 半成品意图会被直接推演；优化同理，改写还没回填就能把原文发出去）。
 */
/**
 * 控制面提问是否应该**挡住打字**。
 *
 * ⚠ 只有给了选项时才挡。2026-08-27 评审逮到的死胡同：`ask_user` 允许不带
 *   options（模型不给就是 `[]`，开放式提问本来就没有选项），而输入框被
 *   `Boolean(pendingAsk)` 一律禁掉、卡片上又只有一句问题——**没有任何回答
 *   入口**，只能点「稍后再说」跑掉。
 *
 * ⚠ 有选项时维持原样（挡住）：那时候 Enter 另发一条会把这次停泊冲掉，
 *   跟范围卡那条是同一个理由。这条只放开"没有选项"这一种。
 */
export function askBlocksTyping(
  ask?: { options?: string[] } | null
): boolean {
  return Boolean(ask) && (ask?.options?.length ?? 0) > 0;
}

/**
 * 控制面提问选项上脸用的短芯片文案。
 *
 * ⚠ 2026-09-03 真机：模型有时只给 hop 英文名（bind / closure / refine），
 *   芯片行跟「路线对比一下」一样短，英文工具名上脸不认。完整标签
 *   （「进入数据模型反推（structure）」）原样展示，不缩短——点选发送的
 *   仍是原始 option，这条只改显示。
 */
const ASK_CHIP_BARE_HOP: Record<string, string> = {
  spec: "起草规格",
  pages: "画页面",
  structure: "数据模型反推",
  bind: "接上数据",
  closure: "完整性检查",
  refine: "精修页面",
};

export function controlAskChipLabel(option: string): string {
  const key = option.trim().toLowerCase();
  return ASK_CHIP_BARE_HOP[key] ?? option.trim();
}

/** 顶行芯片：提示词和提问选项同一套圆角胶囊。 */
const COMPOSER_CHIP_CLASS =
  "rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[12px] text-[#3f3f46] transition hover:bg-[#f4f4f5]";

export function isComposerSendBlocked(opts: {
  isRunning: boolean;
  input: string;
  attachments: Array<{ extractStatus?: "pending" | "ready" | "failed" }>;
  isRefining?: boolean;
  askOpen?: boolean;
  /**
   * 中途排队里还压着几条（2026-08-28）。
   *
   * ⚠ 队列的发出时机只有「一轮结束」那一处（flushQueuedControlTurn 的五个
   *   调用点：推演 finally ×2、关范围卡、先改范围、关提问）。**没有一处对应
   *   "空闲时排进来"**——真机截图那条「本轮结束后发出（1）」就是推演跑完之后
   *   点「改成 X」排进去的，而"本轮"早已结束，它永远等不到自己的发出时机。
   *
   *   抄的标准答案：grok-build `acp_handler/interactions.rs`
   *       /// The pager does NOT respond immediately — the response is sent
   *       /// later when the user submits, cancels, or is replaced by another
   *       /// question.
   *     ——提问是张欠条，提交 / 取消 / 被顶掉三条出路**每条都得把它兑现**，
   *       没有哪条路能让它悬着。队列同理：承诺了会发出去，就必须有一条路
   *       真的走得到。空闲时那条路就是这颗发送键。
   *
   * ⚠ 只在**没在跑**的时候放行：推演中队列本来就有出口（这一轮结束），
   *   那时候空输入点发送没有意义。
   */
  queuedCount?: number;
}): boolean {
  if (opts.askOpen || opts.isRefining) return true;
  if (isAttachmentExtractPending(opts.attachments)) return true;
  if (!opts.input.trim() && opts.attachments.length === 0) {
    return opts.isRunning || (opts.queuedCount ?? 0) === 0;
  }
  return false;
}

/**
 * 排队条的抬头：**说这一刻真会发生的事**。
 *
 * ⚠ 推演中和推演完，同一句「本轮结束后发出」意思完全不同：跑完之后"本轮"
 *   已经没有了，那句话是在骗人——用户会一直等一件不会自己发生的事。
 *   真机截图上那条就那么挂着。
 */
export function queuedTurnsHeading(count: number, isRunning: boolean): string {
  return isRunning
    ? `本轮结束后发出（${count}）`
    : `待发出（${count}）· 点发送开始新一轮`;
}

/** 视觉 LLM 实测可到 100s+；超时必须 fail-open，否则发送键永远灰着。 */
export const EXTRACT_CLIENT_TIMEOUT_MS = 180_000;

/** E31：上传附件给后端提取内容（图片→视觉 LLM，PDF→E2B 沙盒）。
 *  网络/服务异常/超时一律归一成 ok:false + 人话 detail（诚实降级）。 */
export async function extractAttachmentRemote(
  file: File
): Promise<AttachmentExtractOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXTRACT_CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `/api/sliderule/attachments/extract?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as AttachmentExtractOutcome;
    if (body.ok && (body.context || "").trim()) return body;
    return { ok: false, detail: body.detail || "服务返回空内容" };
  } catch (e) {
    const aborted =
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) return { ok: false, detail: "解析超时，仅携带文件名" };
    return { ok: false, detail: `网络异常：${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 读文本类附件 + 服务端提取结果拼成注入块；失败/超限附件如实标注"仅文件名"。 */
async function buildAttachmentContext(
  attachments: ComposerAttachment[],
  extractionOf: (
    att: ComposerAttachment
  ) => Promise<AttachmentExtractOutcome> | null
): Promise<string> {
  const parts: string[] = [];
  let budget = MAX_TOTAL_ATTACHMENT_CHARS;
  for (const att of attachments) {
    if (budget <= 0) break;
    // E31：图片/PDF 用服务端提取缓存（发送时若还在解析则等它落定）
    const pending = extractionOf(att);
    if (pending) {
      const outcome = await pending;
      if (outcome.ok && outcome.context) {
        const limit = Math.min(MAX_CHARS_PER_ATTACHMENT, budget);
        const body = outcome.context.slice(0, limit).trim();
        budget -= body.length;
        parts.push(`【附件内容 · ${att.name}】\n${body}`);
      } else {
        parts.push(
          `【附件 ${att.name}】内容提取失败（${outcome.detail || "未知原因"}），仅携带文件名。`
        );
      }
      continue;
    }
    if (!isTextAttachment(att) || !att.file) continue;
    if (att.size > MAX_TEXT_ATTACHMENT_BYTES) {
      parts.push(`【附件 ${att.name}】文件过大（>200KB），未读取内容。`);
      continue;
    }
    try {
      const raw = await att.file.text();
      const limit = Math.min(MAX_CHARS_PER_ATTACHMENT, budget);
      const clipped = raw.length > limit;
      const body = raw.slice(0, limit).trim();
      budget -= body.length;
      parts.push(
        `【附件内容 · ${att.name}】\n${body}${clipped ? "\n…（内容过长已截断）" : ""}`
      );
    } catch {
      parts.push(`【附件 ${att.name}】读取失败，仅携带文件名。`);
    }
  }
  return parts.join("\n\n");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 附件缩略图点击放大（2026-08-20）。
 *
 * 缩略图只有 40×40，真机上传截图后根本看不清内容。抽成展示组件而不是
 * 内联在 ComposerDock 的 state 里，是因为仓库没有 jsdom，SSR 测不到
 * 「点开之后」那一帧；这里 props 进来就能 renderToStaticMarkup。
 *
 * ⚠ 必须 createPortal 到 document.body：首页 composer 嵌在 Studio 的
 * overflow-hidden 列里，fixed 遮罩写在输入条内部会被裁掉，点了像没反应。
 */
export function AttachmentImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      data-testid="sliderule-attachment-lightbox"
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        data-testid="sliderule-attachment-lightbox-close"
        title="关闭预览"
        aria-label="关闭预览"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow hover:bg-white"
      >
        <X className="h-4 w-4" />
      </button>
      <img
        src={src}
        alt={name}
        data-testid="sliderule-attachment-lightbox-image"
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

/** Returns true if the text looks like a URL. */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/[^\s]{4,}/.test(text.trim());
}

/** Returns true if the DataTransfer contains files. */
function hasFiles(dt: DataTransfer): boolean {
  return dt.items
    ? Array.from(dt.items).some(item => item.kind === "file")
    : dt.files.length > 0;
}

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  stop,
  placeholder,
  hero = false,
  hintChips = [],
  statusPill = null,
  pendingPlanApproval = null,
  onSubmitPlanApproval,
  pendingAsk = null,
  queuedTurns = [],
  onRemoveQueued,
  onAnswerAsk,
  onSubmitQuestionnaire,
  onDismissAsk,
}: {
  input: string;
  setInput: (v: string) => void;
  /** 无参 = 发 input；带 textOverride = 发合成文本（附件名并入时用） */
  sendMessage: (textOverride?: string) => void;
  isRunning: boolean;
  /** Reserved for session-scoped composer state. */
  sessionId: string;
  /** 会话目标。话题底行已撤（跟舞台标题重复），父组件仍传入以免调用点炸。 */
  goal: string;
  pendingPlanApproval?: import("@/lib/sliderule-marathon-driver").ControlPlanApprovalWire | null;
  onSubmitPlanApproval?: (result: PlanApprovalOutcome) => void;
  pendingAsk?: {
    reqId?: string;
    question: string;
    options?: string[];
    /** 抄 grok `AskUserQuestion`：一发几道题，每项带解释。 */
    questions?: import("@/lib/sliderule-marathon-driver").ControlQuestionWire[];
  } | null;
  /** 问答卡提交：四条路径（选完 / 你自己定 / 别再问了）。 */
  onSubmitQuestionnaire?: (result: QuestionnaireOutcome) => void;
  /** 推演中补的话（排队到下一轮）。看得见、撤得掉——见 midrun-queue 头注。 */
  queuedTurns?: { text: string; synthetic?: boolean }[];
  onRemoveQueued?: (index: number) => void;
  onAnswerAsk?: (text: string) => void;
  onDismissAsk?: () => void;

  hintChips?: string[];
  /** 闭环/缺口胶囊。主文案是已收口/未收口，分数在 title。 */
  statusPill?: { label: string; blocked?: boolean; title?: string } | null;
  stop?: () => void;
  /** 空态首页嵌入时的占位文案 */
  placeholder?: string;
  /**
   * 空态变体：只决定占位文案和提示条。
   * ⚠ 2026-09-01 用户两张截图：开聊后胶囊把质疑文案和工具条挤在一行，
   *   发送圆在胶囊外。新建会话是字在上、工具行在下的多行卡片。
   *   两种状态共用这张卡片；hero 不再切布局。
   */
  hero?: boolean;
}) {
  // 模式选择器已删（用户裁决 2026-07-10）：深思一轮就是唯一产品路径
  // （Python drive-full-stream 一条消息推到闭环），持续推演是浏览器端
  // 马拉松遗留、还会丢实时流——引擎能力保留在 Dev 面，不再出现在产品面。
  // + 菜单：文件 / 示例意图。技能勾选已撤——装了也不进控制面。
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [menuView, setMenuView] = React.useState<"actions" | "examples">(
    "actions"
  );
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [attachmentHint, setAttachmentHint] = React.useState<string | null>(
    null
  );
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const refEl = menuRef.current;
      if (refEl && !refEl.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setMenuView("actions");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const adjustTextareaHeight = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // 空态和会话内同一张多行卡片：工具行在下面，上面得留一块可点的字区。
    const minH = 72;
    const maxH = 160;
    if (!ta.value.trim()) {
      ta.style.height = `${minH}px`;
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.max(minH, Math.min(ta.scrollHeight, maxH))}px`;
  }, []);

  React.useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Listen for example prompt clicks from ClaudeChatSurface empty state.
  // E34：模板可为空串（「应用推演」模式卡）——空串也生效（清空回纯输入），
  // 都聚焦输入框让用户接着打字。
  React.useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (typeof text === "string") {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    };
    window.addEventListener("sliderule:fill-prompt", handler);
    return () => window.removeEventListener("sliderule:fill-prompt", handler);
  }, [setInput]);

  // M5/PR-1：质疑按钮预填作曲家并聚焦，不弹 window.prompt、不立刻点火。
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ text?: string; targetLabel?: string | null }>
      ).detail;
      applyChallengePrefillToComposer(setInput, detail);
      setTimeout(() => textareaRef.current?.focus(), 50);
    };
    window.addEventListener(CHALLENGE_PREFILL_EVENT, handler);
    return () => window.removeEventListener(CHALLENGE_PREFILL_EVENT, handler);
  }, [setInput]);

  // E34 快速开始「从需求文档开始」：空态卡片直接拉起附件选择器
  React.useEffect(() => {
    const handler = () => fileInputRef.current?.click();
    window.addEventListener("sliderule:open-file-picker", handler);
    return () =>
      window.removeEventListener("sliderule:open-file-picker", handler);
  }, []);

  /** Handle text paste — detect URLs and surface a hint. */
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData("text");
      if (looksLikeUrl(pasted)) {
        // Let the default paste fill the textarea, then surface a hint.
        setTimeout(() => {
          setAttachmentHint(
            `已检测到 URL — 可直接发送，面团 AI 会尝试抓取摘要`
          );
          setTimeout(() => setAttachmentHint(null), 5000);
        }, 0);
      }
    },
    []
  );

  /** Drag-and-drop: accept files, show overlay hint. */
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = React.useCallback(() => {
    setIsDragOver(false);
  }, []);

  // 附件预览卡（Claude 式）：图片出缩略图、其他文件出文件卡，可逐个移除。
  // E28：文本类附件发送时读内容注入指令；二进制仍如实只带文件名。
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>(
    []
  );
  const [lightbox, setLightbox] = React.useState<{
    src: string;
    name: string;
  } | null>(null);
  const attachmentSeq = React.useRef(0);
  // E31：附件 id → 服务端提取 promise（上传即解析；发送时 doSend 等它落定。
  // 移除附件不取消请求——结果落定后 setAttachments 找不到卡片就自然丢弃）
  const extractPromises = React.useRef(
    new Map<string, Promise<AttachmentExtractOutcome>>()
  );

  const addAttachments = React.useCallback((files: File[]) => {
    if (!files.length) return;
    const items = files.map(f => ({
      id: `att-${++attachmentSeq.current}`,
      name: f.name,
      size: f.size,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      file: f,
      extractStatus: isExtractableAttachment(f.name)
        ? ("pending" as const)
        : undefined,
    }));
    setAttachments(prev => [...prev, ...items]);
    // E31：图片/PDF 上传即解析（视觉 LLM 实测可到 100s+，藏进等待期）
    for (const item of items) {
      if (item.extractStatus !== "pending" || !item.file) continue;
      const promise = extractAttachmentRemote(item.file);
      extractPromises.current.set(item.id, promise);
      void promise.then(outcome => {
        setAttachments(prev =>
          prev.map(a =>
            a.id === item.id
              ? {
                  ...a,
                  extractStatus: outcome.ok ? "ready" : "failed",
                  extractDetail: outcome.detail,
                  extractChars: outcome.ok
                    ? (outcome.context || "").length
                    : undefined,
                }
              : a
          )
        );
      });
    }
  }, []);

  const removeAttachment = React.useCallback((id: string) => {
    extractPromises.current.delete(id);
    setAttachments(prev => {
      const hit = prev.find(a => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  // 卸载时回收全部 objectURL（防泄漏）
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;
  React.useEffect(
    () => () => {
      for (const a of attachmentsRef.current) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    },
    []
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      addAttachments(Array.from(e.dataTransfer.files));
    },
    [addAttachments]
  );

  // 优化提示词进行中：锁发送，避免改写还没回填就把原文推出去。
  const [isRefining, setIsRefining] = React.useState(false);
  /** 发送：有附件时把附件名 + 文本类附件内容并进消息，发完清预览卡。
   *  解析中直接拒绝——不清附件、不排队等提取。LobeChat handleSend 在
   *  isUploadingFiles 时 return；只靠按钮 disabled 挡不住 Enter。
   *  审查/优化在飞同样拒绝——生成卡的时候发送必须灰。 */
  const doSend = React.useCallback(() => {
    // 运行中也走 sendMessage：那边排队，这里不许改成 stop。
    if (
      isComposerSendBlocked({
        isRunning,
        input,
        attachments,
        isRefining,
        askOpen: askBlocksTyping(pendingAsk),
        queuedCount: queuedTurns.length,
      })
    )
      return;
    const text = input.trim();
    if (attachments.length > 0) {
      const snapshot = attachments;
      setAttachments(prev => {
        for (const a of prev) {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        }
        return [];
      });
      const promiseMap = extractPromises.current;
      extractPromises.current = new Map();
      void (async () => {
        const names = snapshot.map(a => a.name).join(", ");
        const context = await buildAttachmentContext(
          snapshot,
          att => promiseMap.get(att.id) ?? null
        );
        const head = text ? `${text}\n[附件: ${names}]` : `[附件: ${names}]`;
        sendMessage(context ? `${head}\n\n${context}` : head);
      })();
    } else {
      sendMessage();
    }
  }, [
    isRunning,
    input,
    attachments,
    sendMessage,
    isRefining,
    pendingAsk,
    queuedTurns.length,
  ]);

  /* ─────────────────────────── `/` 命令选择器
   *
   * 判定层在 composer-slash.ts（纯函数、逐条做过变异）；这里只接线。
   *
   * ⚠ 光标位置不能只在 onChange 里读：用方向键把光标挪进/挪出斜杠段时
   *   value 没变，onChange 不触发，面板会挂在那儿吃掉回车。所以 onSelect
   *   也重算一遍（它在光标移动时触发）。
   */
  const [connectors, setConnectors] = React.useState<ConnectorSpec[]>([]);
  /*
   * 清单取到了没有。
   *
   * ⚠ 2026-08-26 用户报"选了之后框里啥也没有"，根因就在这里：
   *   listConnectors() 失败时按设计返回空数组（它挂在输入框上，不能让一次
   *   后端抖动把打字也拦住）。可我**只在挂载时取一次**——那一次赶上后端在
   *   重启，这个页面就一辈子认为"这台机器上没有连接器"。
   *   然后伙伴全被标成「还缺: 天气」，点下去 partnerCapabilities 过滤完是空
   *   数组，什么也挂不上，**静默无反应**。
   *
   *   「没问到」和「真的没有」是两回事，把前者显示成后者就是在撒谎。
   */
  const [connectorLoad, setConnectorLoad] = React.useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [picked, setPicked] = React.useState<SlashItem[]>(() =>
    loadTurnCapabilities()
  );
  const [slash, setSlash] = React.useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [slashIndex, setSlashIndex] = React.useState(0);

  const refreshConnectors = React.useCallback(async () => {
    setConnectorLoad(prev => (prev === "ready" ? prev : "loading"));
    const list = await listConnectors();
    setConnectors(list);
    // 空清单**不算取到**：后端好好的时候至少有内置那两个，空只可能是没问到。
    setConnectorLoad(list.length > 0 ? "ready" : "failed");
    return list;
  }, []);

  React.useEffect(() => {
    void refreshConnectors();
  }, [refreshConnectors]);

  const [storeSkills, setStoreSkills] = React.useState<SkillPackage[]>([]);
  const refreshStoreSkills = React.useCallback(async () => {
    try {
      const list = await fetchSkillCatalog();
      setStoreSkills(list.filter(item => item.installed));
    } catch {
      /* 目录取不到就不进面板，斜杠命令还在 */
    }
  }, []);

  React.useEffect(() => {
    void refreshStoreSkills();
  }, [refreshStoreSkills]);

  /* 从「扩展中心」页点「用这个伙伴」过来的起手意图。
     ⚠ take 语义：取一次就清掉（见 turn-capabilities.takePendingOpener）。
       不清的话用户以后不管从哪进推演，输入框都会自己填上上次那句话。 */
  React.useEffect(() => {
    const opener = takePendingOpener();
    if (!opener) return;
    setInput(opener);
    requestAnimationFrame(() => {
      adjustTextareaHeight();
      textareaRef.current?.focus();
    });
  }, [setInput, adjustTextareaHeight]);

  /** 斜杠池：计划 + 商店已装技能。连接器/伙伴仍不进。 */
  const slashPool = React.useMemo<SlashItem[]>(
    () => [
      ...COMPOSER_SLASH_REHEARSAL_ITEMS,
      ...installedSkillSlashItems(storeSkills),
    ],
    [storeSkills]
  );

  const partnerById = React.useMemo(() => {
    const map = new Map<string, Partner>();
    for (const pt of [...BUILTIN_PARTNERS, ...loadPartners()]) map.set(pt.id, pt);
    return map;
  }, [connectors]);

  const slashItems = React.useMemo(
    () => (slash ? filterSlashItems(slashPool, slash.query) : []),
    [slash, slashPool]
  );

  const syncSlash = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = slashQueryAt(ta.value, ta.selectionStart ?? 0);
    setSlash(prev => {
      /* 面板刚被唤起、而清单上次没取到 → 顺手补一次。
         ⚠ 这是唯一一个"用户明确要看这份清单"的时刻，重试放这儿最省事也最
           准；挂载时那一次赶上后端重启就永远错过了。 */
      if (next && !prev && connectorLoad === "failed") void refreshConnectors();
      if (next && !prev) void refreshStoreSkills();
      return next;
    });
    setSlashIndex(0);
  }, [connectorLoad, refreshConnectors, refreshStoreSkills]);

  /*
   * 「/ 技能·连接器」那颗提示钮**替用户打这个斜杠**。
   *
   * 2026-08-26 用户反馈：输入框里没有任何东西告诉人可以打 `/`。斜杠唤起是
   * 学来的手势，不写出来就等于没有——这条链路（技能/连接器挂到这一轮）
   * 最主要的入口一直藏着。
   *
   * ⚠ 点它是**真的往正文插一个 `/`**，不是另开一个假面板。理由是别让同一件
   *   事有两套状态：面板的开关、筛选、回车选中全都吊在 `slashQueryAt(正文)`
   *   上（见 composer-slash.ts）。绕过正文另设一个 open 标志，等于把判定
   *   摊成两处，改一处不报错、只有一半生效——仓里第四条。
   *
   * ⚠ 插之前要看前一个字符：`slashQueryAt` 只认行首或空白后面的斜杠
   *   （`https://`、`2026/08/25` 不该弹）。紧挨着字打进去面板不会弹，
   *   用户看到的就是"点了没反应"。所以必要时先补一个空格。
   */
  const slashSeedRef = React.useRef(false);

  const openSlashPicker = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const seeded = seedSlash(ta.value, ta.selectionStart ?? ta.value.length);
    const caret = seeded.caret;
    slashSeedRef.current = true;
    setInput(seeded.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      adjustTextareaHeight();
      syncSlash();
    });
  }, [setInput, adjustTextareaHeight, syncSlash]);

  /** 挂不上时给出的人话原因（画在面板底部）。挂上了就清空。 */
  const [slashNote, setSlashNote] = React.useState("");
  /*
   * 鼠标正按在面板里。
   *
   * ⚠ 面板的按钮用的是 onMouseDown + preventDefault（本意是"别让 textarea
   *   失焦，否则面板先关、点击落空"）。真机上**兜不住**：点一个挂不上的条目
   *   时，textarea 照样 blur，onBlur 把面板和刚设好的提示一起清掉——用户看到
   *   的还是"点了没反应"，跟没修一样。
   *   所以另加一道显式守卫：面板里按下鼠标时置位，onBlur 见到它就不关。
   *   （preventDefault 那行留着——它在正常路径上确实省掉一次焦点抖动。）
   */
  const slashPointerRef = React.useRef(false);

  /**
   * 关掉面板。
   *
   * ⚠ **提示钮插进去的那个 `/` 要一起收走。** 不收的话：点了提示钮、又按 Esc
   *   或点到别处，输入框里就白白多出一个斜杠（还可能带着刚打的半个词），
   *   下一步直接发出去，那个 `/天` 会跟着进提示词被模型当成用户的措辞。
   *   用户自己手打的斜杠**不动**——那是他正在写的字。
   */
  const dismissSlash = React.useCallback(() => {
    if (slashSeedRef.current && slash) {
      const applied = applySlashPick(input, slash);
      setInput(applied.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.setSelectionRange(applied.caret, applied.caret);
        adjustTextareaHeight();
      });
    }
    slashSeedRef.current = false;
    setSlash(null);
    setSlashNote("");
  }, [slash, input, setInput, adjustTextareaHeight]);

  const pickCapability = React.useCallback(
    (item: SlashItem) => {
      /*
       * ⚠ **挂不上任何东西时不许静默关掉面板。**
       *
       *   2026-08-26 用户报的原话是"为啥选择了之后，框里面啥也没有"。
       *   当时三个伙伴的依赖全都没就位（连接器清单没取到），
       *   partnerCapabilities 过滤完返回空数组，于是：面板关了、正文空着、
       *   标签一个没有——用户完全看不出发生了什么，只知道点了没反应。
       *
       *   一个看着能选、选了没反应的条目，比这个条目干脆不存在更糟。
       */
      if (item.unavailable) {
        const preview =
          item.kind === "partner" ? partnerById.get(item.key) : null;
        const usable = preview
          ? partnerCapabilities(preview, {
              connectorIds: connectors.filter(c => c.available).map(c => c.id),
              skillKeys: loadInstalledSkills().map(installKeyOf),
            })
          : [];
        if (usable.length === 0) {
          setSlashNote(`「${item.name}」现在挂不上：${item.unavailable}`);
          if (connectorLoad === "failed") void refreshConnectors();
          return; // 面板留着，让用户看见原因
        }
      }
      setSlashNote("");
      const ta = textareaRef.current;
      if (item.kind === "rehearsal") {
        const applied =
          ta && slash
            ? applyRehearsalSlashPick(ta.value, slash, item)
            : applyRehearsalSlashPick(
                "/",
                { start: 0, end: 1, query: "" },
                item
              );
        setInput(applied.text);
        slashSeedRef.current = false;
        setSlash(null);
        setSlashIndex(0);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(applied.caret, applied.caret);
          adjustTextareaHeight();
        });
        return;
      }
      if (item.kind === "skill") {
        const applied =
          ta && slash
            ? applySkillSlashPick(ta.value, slash, item)
            : applySkillSlashPick(
                "/",
                { start: 0, end: 1, query: "" },
                item
              );
        setInput(applied.text);
        slashSeedRef.current = false;
        setSlash(null);
        setSlashIndex(0);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(applied.caret, applied.caret);
          adjustTextareaHeight();
        });
        return;
      }
      if (ta && slash) {
        const applied = applySlashPick(ta.value, slash);
        setInput(applied.text);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(applied.caret, applied.caret);
          adjustTextareaHeight();
        });
      }
      /*
       * 选中伙伴 = **把它要的能力挂上**，而不是挂一枚"伙伴"芯片。
       * 芯片要能一个个摘掉，用户才控制得住这一轮到底带了什么；挂个伙伴
       * 芯片的话，他看不见里面是哪几样，摘也只能整包摘。
       */
      const partner = item.kind === "partner" ? partnerById.get(item.key) : null;
      const incoming: SlashItem[] = partner
        ? partnerCapabilities(partner, {
            connectorIds: connectors.filter(c => c.available).map(c => c.id),
            skillKeys: loadInstalledSkills().map(installKeyOf),
          })
        : [item];
      setPicked(prev => {
        // 重复选同一个不叠加（用户连着敲两次 / 手滑）
        const next = [...prev];
        for (const one of incoming) {
          if (next.some(p => p.kind === one.kind && p.key === one.key)) continue;
          next.push(one);
        }
        if (next.length === prev.length) return prev;
        saveTurnCapabilities(next);
        return next;
      });
      /*
       * ⚠ **不往输入框灌起手意图。** 2026-08-26 用户指着 TRAE 的截图纠正：
       *   `/` 选完之后，输入框里应该只多出一枚能力标签，"然后后面再跟提示词
       *   指令"——那句指令是用户自己写的。我们原来是把伙伴那段几十字的起手
       *   意图整段灌进去，用户一进来就要先删掉别人替他写的话。
       *
       *   库页上那颗「用这个伙伴」按钮**保留**灌起手意图：那是"照这个模板
       *   开一局"的显式动作，跟"我正在打字，顺手挂个能力"是两回事。
       */
      /* ⚠ 选中成功时**不能**走 dismissSlash：applySlashPick 上面已经把
         `/查询串` 摘掉了，再摘一次会啃掉正文里紧挨着的字。这里只清标记。 */
      slashSeedRef.current = false;
      setSlash(null);
      setSlashIndex(0);
    },
    [
      slash,
      setInput,
      adjustTextareaHeight,
      partnerById,
      connectors,
      connectorLoad,
      refreshConnectors,
    ]
  );

  const removeCapability = React.useCallback((item: SlashItem) => {
    setPicked(prev => {
      const next = prev.filter(p => !(p.kind === item.kind && p.key === item.key));
      saveTurnCapabilities(next);
      return next;
    });
  }, []);

  const fillExample = React.useCallback(
    (text: string) => {
      setInput(text);
      setIsMenuOpen(false);
      setMenuView("actions");
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [setInput]
  );

  // 优化提示词：把输入框里的一句话意图送去真 LLM 通道改写成信息更全的
  // 推演提示词，回填输入框让用户过目再发（不代发）。失败人话提示、不改原文。
  const refinePrompt = React.useCallback(async () => {
    const text = textareaRef.current?.value?.trim() ?? "";
    if (!text || isRefining) return;
    setIsRefining(true);
    try {
      const res = await fetch("/api/sliderule/prompt-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        detail?: string;
      };
      if (data.ok && data.text) {
        setInput(data.text);
        setAttachmentHint("提示词已优化——确认或再编辑后发送");
        textareaRef.current?.focus();
      } else {
        setAttachmentHint(
          `优化失败：${data.detail || "服务未响应"}（原文未改动）`
        );
      }
    } catch {
      setAttachmentHint("优化失败：网络异常（原文未改动）");
    } finally {
      setIsRefining(false);
      setTimeout(() => setAttachmentHint(null), 6000);
    }
  }, [isRefining, setInput]);

  const placeholderText =
    placeholder || (hero ? "描述你想做的应用" : "畅所欲问");

  const extractPending = isAttachmentExtractPending(attachments);
  const sendBusy = extractPending || isRefining;
  const sendBlocked = isComposerSendBlocked({
    isRunning,
    input,
    attachments,
    isRefining,
    askOpen: askBlocksTyping(pendingAsk),
    // ⚠ 两个调用点必须给同一组参数：doSend 那处放行了、这处没放行的话，
    //   键是灰的但 Enter 能发——半新半旧（CLAUDE.md §4）。
    queuedCount: queuedTurns.length,
  });

  const actionHints = hintChips.slice(0, statusPill ? 1 : 2);
  /* ⚠ 能力标签**不在这一行**了（2026-08-26 挪进了输入框，见下面的
     sliderule-composer-tags）。所以这里不能再拿 picked 当显示条件——
     那会在没有附件/提示芯片时留下一条空行。
     pendingAsk 也必须出这一行——提问改成芯片后，没有附件/hint 时也得
     把这一行撑出来，否则选项没地方画。 */
  const showActionRow =
    attachments.length > 0 ||
    Boolean(pendingAsk) ||
    (!hero && (actionHints.length > 0 || !!statusPill));

  const refineButton = (
    <button
      type="button"
      className="hidden h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-[12px] text-[#5e5e5e] transition hover:bg-[#f4f4f5] disabled:opacity-45 sm:flex"
      title="优化提示词：把意图改写得更完整（实体/流程/角色/页面/AI）"
      data-testid="sliderule-prompt-refine"
      onClick={refinePrompt}
      disabled={isRunning || isRefining || !input.trim()}
    >
      {isRefining ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      <span>优化</span>
    </button>
  );

  const stopButton = isRunning ? (
    <button
      type="button"
      onClick={() => stop?.()}
      data-testid="sliderule-composer-stop"
      aria-label="停止"
      title="停止"
      className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#e5e7eb] bg-white text-[#171717] transition hover:bg-[#f4f4f5]"
    >
      <Square className="h-3.5 w-3.5 fill-current" />
    </button>
  ) : null;

  const sendButton = (
    <button
      type="button"
      onClick={doSend}
      disabled={sendBlocked}
      data-testid="sliderule-composer-send"
      aria-label={isRunning ? "排队" : "发送"}
      aria-busy={sendBusy}
      className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#ececef] disabled:text-[#b0b0b5]"
      title={
        isRunning
          ? "排队"
          : extractPending
            ? "附件解析中，请稍候"
            : isRefining
              ? "正在优化提示词"
              : "发送"
      }
    >
      {sendBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowUp className="h-4 w-4" />
      )}
    </button>
  );

  return (
    <div className="pointer-events-none flex w-full flex-col items-stretch gap-1.5">
      {/*
        输入条结构（横排，不是页面三栏）：
          1. 闭环胶囊 / 提示词芯片（会话内；空态不画）
          2. 多行卡片：字在上，底栏 + / 发送
        ⚠ 2026-09-20：技能勾选条从这里彻掉。已装技能跟闭集工具一样
          进控制面目录，人不再在输入条勾；Agent 自己用 skill 工具加载。
          3. 有附件/优化提示时才出一行提示（话题条已撤：跟舞台标题重复）
        ⚠ hintChips 从 SlideRule 传来却从未渲染（2026-08-20）——顶行就是把它接上。
        不许编 git / Commit；闭环胶囊和提示词芯片都是仓里已有的。
        ⚠ 2026-09-03 用户截图：控制面提问做成 absolute 弹出层盖住输入框。
          改成跟提示词同一排芯片（点下去仍走 onAnswerAsk，不是填入再发）。
      */}
      {showActionRow ? (
        <div
          className="pointer-events-auto flex flex-wrap items-center gap-1.5"
          data-testid="sliderule-composer-actions"
        >
          {statusPill ? (
            <span
              data-testid="sliderule-composer-status-pill"
              title={statusPill.title}
              className={`inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-[12px] ${
                statusPill.blocked
                  ? "border-[#fecaca] text-[#b91c1c]"
                  : "border-[#e5e7eb] text-[#3f3f46]"
              }`}
            >
              <span aria-hidden>{statusPill.blocked ? "✗" : "✓"}</span>
              {statusPill.label}
            </span>
          ) : null}
          {pendingAsk && !pendingAsk.questions?.length ? (
            <div
              data-testid="sliderule-control-ask"
              aria-label="控制面提问"
              className="flex min-w-0 flex-wrap items-center gap-1.5"
            >
              <span
                data-testid="sliderule-control-ask-question"
                title={pendingAsk.question}
                className="max-w-[14rem] truncate text-[12px] leading-4 text-[#71717a]"
              >
                {pendingAsk.question}
              </span>
              {(pendingAsk.options || []).length === 0 ? (
                /* 没有选项 = 开放式提问。明说怎么答，别让人对着一句问话发呆。 */
                <span
                  className="text-[12px] leading-4 text-[#a1a1aa]"
                  data-testid="sliderule-control-ask-typehint"
                >
                  直接在下面的输入框里回答
                </span>
              ) : (
                pendingAsk.options!.map(option => (
                  <button
                    key={option}
                    type="button"
                    data-testid="sliderule-control-ask-chip"
                    title={option}
                    className={COMPOSER_CHIP_CLASS}
                    onClick={() => onAnswerAsk?.(option)}
                  >
                    {controlAskChipLabel(option)}
                  </button>
                ))
              )}
              {onDismissAsk ? (
                <button
                  type="button"
                  className="rounded-full px-2 py-1 text-[12px] text-[#a1a1aa] transition hover:bg-[#f4f4f5] hover:text-[#3f3f46]"
                  onClick={onDismissAsk}
                >
                  稍后再说
                </button>
              ) : null}
            </div>
          ) : (
            actionHints.map(text => (
              <button
                key={text}
                type="button"
                data-testid="sliderule-composer-hint-chip"
                title="填入输入框，可再编辑"
                onClick={() => {
                  setInput(text);
                  requestAnimationFrame(adjustTextareaHeight);
                  textareaRef.current?.focus();
                }}
                className={COMPOSER_CHIP_CLASS}
              >
                {text}
              </button>
            ))
          )}
          {attachments.length > 0 ? (
            <div
              className="flex flex-wrap gap-2"
              data-testid="sliderule-attachments"
            >
              {attachments.map(att => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white p-1 pr-2.5"
                  data-testid="sliderule-attachment-card"
                >
                  {att.previewUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({ src: att.previewUrl!, name: att.name })
                      }
                      data-testid="sliderule-attachment-preview-open"
                      title="点击放大"
                      className="shrink-0 cursor-zoom-in rounded-full"
                    >
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    </button>
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9edf2] text-stone-500">
                      <FileText className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-[160px] truncate text-[11px] font-medium text-stone-700">
                      {att.name}
                    </span>
                    <span
                      className="block text-[10px] text-stone-400"
                      title={
                        att.extractStatus === "failed"
                          ? att.extractDetail
                          : undefined
                      }
                      data-testid={`sliderule-attachment-status-${att.extractStatus ?? "none"}`}
                    >
                      {formatFileSize(att.size)}
                      {att.extractStatus === "pending" && " · 解析中…"}
                      {att.extractStatus === "ready" &&
                        ` · 已解析 ${att.extractChars ?? 0} 字`}
                      {att.extractStatus === "failed" &&
                        " · 解析失败，仅带文件名"}
                      {!att.extractStatus &&
                        (isTextAttachment(att)
                          ? " · 发送时注入内容"
                          : " · 仅随消息带文件名")}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    data-testid="sliderule-attachment-remove"
                    title="移除附件"
                    className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-stone-400 shadow-sm transition hover:text-stone-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* 空态和会话内同一张卡片：发送在底栏里，不在卡片外另起一个圆。 */}
      <div className="w-full">
        {/*
          ⚠ **z-30 不能少。** 2026-08-26 用户报"选了之后框里啥也没有"，一半根因
            在这儿：`/` 面板是这一层的 absolute 子元素，而消息区那一层挂着
            `relative z-10`。z-index 只在同一个层叠上下文里比大小——面板自己写
            z-30 没用，它整条链被压在消息区下面。肉眼看得见（面板是不透明的、
            画在上面），**鼠标点不到**：elementFromPoint 在面板正中拿到的是
            sliderule-user-bubble。键盘选得中、鼠标选不中，正是这种形状。
        */}
        <div
          data-testid="sliderule-composer-shell"
          className="relative z-30 min-w-0 flex-1"
        >
          <div
            className={`pointer-events-auto relative z-20 w-full border bg-white transition-colors rounded-[12px] px-3 pb-2 pt-3 shadow-[0_2px_8px_rgba(31,35,40,0.06)] ${
              isDragOver
                ? "border-[#1677ff] bg-[#e6f4ff]/40"
                : "border-[#e5e7eb]"
            }`}
            data-testid="sliderule-composer-dock"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[12px] bg-[#e6f4ff]/60"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-[#0958d9]">
                  <FileText className="h-4 w-4" />
                  拖拽文件到这里
                </div>
              </div>
            )}
            {/* 字在上、工具行在下。原型/设备只在空态 hero 画，会话内沿用范围卡。 */}
            {/* 手机工具宽度会超过一行；缩窄 1fr 会让设计选择器盖住发送。 */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 sm:grid sm:grid-cols-[auto_auto_1fr_auto]">
              <div
                className="relative shrink-0 col-start-1 row-start-2"
                ref={menuRef}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(open => !open);
                    setMenuView("actions");
                  }}
                  disabled={isRunning}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f4f4f5] text-[#5e5e5e] transition hover:bg-[#ececef] disabled:opacity-45"
                  title="更多动作"
                  data-testid="sliderule-composer-plus"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {/* 隐藏文件选择器：与拖拽同一行为（addAttachments 出预览卡） */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="sliderule-composer-file-input"
                  onChange={e => {
                    addAttachments(Array.from(e.target.files ?? []));
                    e.target.value = "";
                    setIsMenuOpen(false);
                  }}
                />

                <div
                  data-testid="sliderule-actions-menu"
                  className={`absolute bottom-full left-0 z-[80] mb-2 w-[300px] origin-bottom-left rounded-[9px] border border-[#e5e7eb] bg-white p-1.5 shadow-[0_18px_48px_rgb(15_23_42/0.16)] transition-all duration-150 ${
                    isMenuOpen
                      ? "translate-y-0 scale-100 opacity-100"
                      : "pointer-events-none translate-y-2 scale-95 opacity-0"
                  }`}
                >
                  {menuView === "actions" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="sliderule-action-file"
                        className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e9edf2] text-stone-700">
                          <ImagePlus className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-stone-800">
                            添加文件或图片
                          </span>
                          <span className="block truncate text-[10px] text-stone-500">
                            预览卡进输入条，文本类附件内容随消息注入
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setMenuView("examples")}
                        data-testid="sliderule-action-example"
                        className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FDF6F1] text-[#C05621]">
                          <Lightbulb className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-stone-800">
                            填入示例意图
                          </span>
                          <span className="block truncate text-[10px] text-stone-500">
                            三条示例应用，填进输入框可再编辑
                          </span>
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setMenuView("actions")}
                        className="flex w-full items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-left text-[11px] text-stone-500 transition hover:bg-[#eef0f4]"
                      >
                        <ChevronLeft className="h-3 w-3" />
                        返回
                      </button>
                      {EXAMPLE_INTENT_TEXTS.map(text => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => fillExample(text)}
                          data-testid="sliderule-example-intent"
                          className="mt-1 block w-full rounded-[7px] px-2.5 py-2 text-left text-xs leading-5 text-stone-700 transition hover:bg-[#eef0f4]"
                        >
                          {text}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <div className="col-start-3 row-start-2 flex max-w-full min-w-0 flex-wrap items-center gap-1.5 justify-self-start sm:flex-nowrap">
                <button
                  type="button"
                  data-testid="sliderule-slash-hint"
                disabled={isRunning}
                onClick={openSlashPicker}
                title="输入 / 选择计划或已装技能"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#f4f4f5] px-2 text-[12px] text-[#5e5e5e] transition hover:bg-[#ececef] hover:text-[#171717] disabled:opacity-45"
              >
                <span className="font-mono text-[13px] leading-none">/</span>
              </button>
              </div>

              <div className="order-first w-full min-w-0 col-span-4 row-start-1 sm:order-none">
                {/*
                  挂上的能力是**输入框里的前缀标签**，不是上面另起一行的芯片。
                  用户 2026-08-26 指着 TRAE 的截图说的：选完之后能力就待在
                  输入框里，"然后后面再跟提示词指令"。
                  ⚠ 标签跟正文在同一个盒子里换行（flex-wrap），所以挂三个也不会
                    把输入框挤没；标签自己 shrink-0，被挤扁的只能是正文。
                */}
                {picked.length > 0 ? (
                  <div
                    className="mb-1 flex flex-wrap items-center gap-1"
                    data-testid="sliderule-composer-tags"
                  >
                    {picked.map(item => (
                      <CapabilityChip
                        key={`${item.kind}:${item.key}`}
                        item={item}
                        onRemove={() => removeCapability(item)}
                      />
                    ))}
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={event => {
                    setInput(event.target.value);
                    requestAnimationFrame(adjustTextareaHeight);
                    requestAnimationFrame(syncSlash);
                  }}
                  onSelect={syncSlash}
                  onBlur={() => {
                    if (slashPointerRef.current) return; // 点的是面板自己
                    dismissSlash();
                  }}
                  onKeyDown={event => {
                    /* ⚠ 能力面板开着时，方向键/回车/Tab 归它，**必须在发送
                       判定之前拦**。放到后面的话 Enter 会把消息发出去，
                       而用户以为自己只是在选一个技能。 */
                    if (slash) {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        dismissSlash();
                        return;
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setSlashIndex(cur =>
                          moveHighlight(
                            slashItems.length,
                            cur,
                            event.key === "ArrowDown" ? 1 : -1
                          )
                        );
                        return;
                      }
                      if (
                        (event.key === "Enter" || event.key === "Tab") &&
                        slashItems.length > 0 &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        pickCapability(slashItems[slashIndex] ?? slashItems[0]!);
                        return;
                      }
                    }
                    /* 正文空着时按退格摘掉最后一枚标签——标签输入框的通行
                       手势（GitHub/Linear/邮件收件人框都是这样）。
                       ⚠ 必须判 selectionStart===0 且正文为空：光标在字中间时
                         退格当然是删字，抢过来会让人删不动东西。 */
                    if (
                      event.key === "Backspace" &&
                      picked.length > 0 &&
                      event.currentTarget.value === "" &&
                      (event.currentTarget.selectionStart ?? 0) === 0
                    ) {
                      event.preventDefault();
                      removeCapability(picked[picked.length - 1]!);
                      return;
                    }
                    // Enter 行为偏好（设置页可切 Enter/Ctrl+Enter 发送）
                    if (shouldSendOnKey(event)) {
                      event.preventDefault();
                      // LibreChat #2078：只禁发送键挡不住 Enter，这里同样闸住
                      if (!sendBlocked) doSend();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    picked.length > 0 ? "输入你的任务…" : placeholderText
                  }
                  aria-label={
                    picked.length > 0 ? "输入你的任务" : placeholderText
                  }
                  rows={1}
                  disabled={
                    askBlocksTyping(pendingAsk)
                  }
                  className="block max-h-40 w-full resize-none bg-transparent py-0 text-[#171717] outline-none placeholder:text-[#9aa0a6] disabled:opacity-60 min-h-[72px] px-0.5 text-[15px] leading-6"
                  data-testid="sliderule-composer-input"
                />
              </div>

              {/* 优化贴发送左边，跟发送同一簇靠右。 */}
              <div className="col-start-4 row-start-2 ml-auto flex shrink-0 items-center gap-1 justify-self-end sm:ml-0">
                {refineButton}
                {stopButton}
                {sendButton}
              </div>
            </div>
          </div>
          {/* ⚠ 能力面板必须画在这个 relative 容器**内部**——挂 body 的话
              absolute 会一路找到 body，跑去屏幕左上角（色板那条踩过）。 */}
          {slash ? (
            <ComposerSlashMenu
              items={slashItems}
              highlight={slashIndex}
              query={slash.query}
              note={slashNote}
              onPointerDownInside={() => {
                slashPointerRef.current = true;
                // 这一拍之后焦点已经稳定，放开守卫
                window.setTimeout(() => {
                  slashPointerRef.current = false;
                }, 0);
              }}
              onPick={pickCapability}
              onHover={setSlashIndex}
            />
          ) : null}
          {pendingAsk?.questions?.length && onSubmitQuestionnaire ? (
            <div
              className="pointer-events-auto fixed inset-x-3 bottom-3 z-20 max-h-[calc(100dvh-24px)] overflow-y-auto origin-bottom sr-composer-pop sm:absolute sm:inset-x-0 sm:bottom-full sm:mb-2 sm:max-h-none sm:overflow-visible"
              data-testid="sliderule-questionnaire-overlay"
            >
              <QuestionnaireCard
                key={pendingAsk.reqId}
                questions={pendingAsk.questions}
                paused={isRunning}
                onSubmit={onSubmitQuestionnaire}
              />
            </div>
          ) : null}
          {pendingPlanApproval && onSubmitPlanApproval ? (
            <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-20 origin-bottom sr-composer-pop sm:absolute sm:inset-x-0 sm:bottom-full sm:mb-2" data-testid="sliderule-plan-overlay">
              <PlanApprovalPanel key={pendingPlanApproval.reqId} plan={pendingPlanApproval} onSubmit={onSubmitPlanApproval} />
            </div>
          ) : null}
          {!pendingAsk && !pendingPlanApproval && queuedTurns.length > 0 ? (
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-10 mb-2 origin-bottom sr-composer-pop rounded-[12px] border border-[#e5e7eb] bg-white p-1.5 shadow-[0_12px_32px_rgb(15_23_42/0.12)]"
              data-testid="sliderule-composer-overlay"
            >
              {/*
                推演中补的话：**必须看得见**。
                ⚠ 2026-08-27 真机实测的老形态：点发送 → 输入框清空、整页
                  搜不到这句话、几分钟后它自己发出去。机制通、人是懵的
                  （见 midrun-queue.ts 头注）。所以每条都能撤——用户改主意的
                  成本不该是"等它发出去再说"。
              */}
              {queuedTurns.length > 0 ? (
                <div
                  className="rounded-lg bg-[#f6f7f9] px-2 py-1.5"
                  data-testid="sliderule-queued-turns"
                >
                  <div className="mb-1 text-[11px] leading-4 text-[#71717a]">
                    {queuedTurnsHeading(queuedTurns.length, isRunning)}
                  </div>
                  {queuedTurns.map((row, i) => (
                    <div
                      key={`${i}-${row.text}`}
                      data-testid="sliderule-queued-turn"
                      className="flex items-start gap-1.5 py-0.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-[#171717]">
                        {row.text}
                      </span>
                      {onRemoveQueued ? (
                        <button
                          type="button"
                          data-testid="sliderule-queued-remove"
                          title="撤掉这条"
                          aria-label="撤掉这条"
                          onClick={() => onRemoveQueued(i)}
                          className="shrink-0 rounded p-0.5 text-[#a1a1aa] transition hover:bg-white hover:text-[#171717]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {/* ⚠ 2026-09-01 用户圈了底行「话题 · 成品」：跟舞台大标题重复，撤掉。
            这一行只在有附件/优化提示时出现，不再常驻 goal。 */}
      {!hero && attachmentHint && !isRunning && !extractPending ? (
        <div
          className="pointer-events-auto flex w-full items-center gap-3 px-0.5 text-[11px] leading-4 text-[#71717a]"
          data-testid="sliderule-composer-context"
        >
          <span
            className="min-w-0 truncate"
            data-testid="sliderule-composer-hint"
          >
            {attachmentHint}
          </span>
        </div>
      ) : null}
      {lightbox &&
        typeof document !== "undefined" &&
        createPortal(
          <AttachmentImageLightbox
            src={lightbox.src}
            name={lightbox.name}
            onClose={() => setLightbox(null)}
          />,
          document.body
        )}
    </div>
  );
}
