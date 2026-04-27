import { AlertTriangle, CheckCircle2, Clock3, Link2, ShieldAlert } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type TakeoverLane = "current" | "upcoming" | "resolved";

export type AutopilotTakeoverItemStatus =
  | "requested"
  | "pending"
  | "blocked"
  | "approved"
  | "rejected"
  | "resolved"
  | "skipped";

export type AutopilotTakeoverEvidenceRef =
  | string
  | {
      id: string;
      label?: string | null;
    };

export type AutopilotTakeoverItem = {
  id: string;
  lane?: TakeoverLane;
  type: string;
  status: AutopilotTakeoverItemStatus | string;
  reason: string;
  recommendedAction?: string | null;
  blocking?: boolean | null;
  evidenceEventId?: string | null;
  evidenceRefs?: AutopilotTakeoverEvidenceRef[] | null;
};

export type AutopilotTakeoverControlPanelProps = {
  items: AutopilotTakeoverItem[];
  className?: string;
};

const LANE_ORDER: TakeoverLane[] = ["current", "upcoming", "resolved"];

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function copy(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en;
}

function normalizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return normalizeToken(value)
    .split(" ")
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`)
    .join(" ");
}

export function localizeAutopilotTakeoverType(
  type: string,
  locale = "en-US"
): string {
  const normalized = type.trim().toLowerCase().replace(/_/g, "-");
  const labels: Record<string, { zh: string; en: string }> = {
    clarification: {
      zh: "\u6f84\u6e05",
      en: "Clarification",
    },
    "runtime-upgrade": {
      zh: "\u8fd0\u884c\u65f6\u5347\u7ea7",
      en: "Runtime upgrade",
    },
    decision: {
      zh: "\u51b3\u7b56",
      en: "Decision",
    },
    review: {
      zh: "\u590d\u6838",
      en: "Review",
    },
    "budget-approval": {
      zh: "\u9884\u7b97\u5ba1\u6279",
      en: "Budget approval",
    },
    "style-choice": {
      zh: "\u98ce\u683c\u9009\u62e9",
      en: "Style choice",
    },
  };

  const label = labels[normalized];
  if (label) return copy(locale, label.zh, label.en);
  return titleCase(normalized || type);
}

function inferLane(item: AutopilotTakeoverItem): TakeoverLane {
  if (item.lane) return item.lane;
  if (["approved", "rejected", "resolved", "skipped"].includes(item.status)) {
    return "resolved";
  }
  if (item.status === "pending") return "upcoming";
  return "current";
}

function statusTone(status: string, blocking?: boolean | null): string {
  if (blocking || status === "blocked") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (["approved", "resolved"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function LaneIcon({ lane }: { lane: TakeoverLane }) {
  if (lane === "resolved") {
    return <CheckCircle2 className="size-4 text-emerald-600" />;
  }
  if (lane === "upcoming") {
    return <Clock3 className="size-4 text-blue-600" />;
  }
  return <ShieldAlert className="size-4 text-red-600" />;
}

function laneLabel(locale: string, lane: TakeoverLane): string {
  switch (lane) {
    case "current":
      return copy(locale, "\u5f53\u524d\u63a5\u7ba1", "Current takeover");
    case "upcoming":
      return copy(locale, "\u5373\u5c06\u63a5\u7ba1", "Upcoming takeover");
    case "resolved":
      return copy(locale, "\u5df2\u5b8c\u6210\u63a5\u7ba1", "Resolved takeover");
  }
}

function laneDescription(locale: string, lane: TakeoverLane): string {
  switch (lane) {
    case "current":
      return copy(
        locale,
        "\u9700\u8981\u64cd\u4f5c\u5458\u73b0\u5728\u5904\u7406\u7684\u63a5\u7ba1\u70b9\u3002",
        "Takeover items that need operator attention now."
      );
    case "upcoming":
      return copy(
        locale,
        "\u9884\u8ba1\u540e\u7eed\u4f1a\u89e6\u53d1\u7684\u786e\u8ba4\u6216\u51b3\u7b56\u70b9\u3002",
        "Expected confirmation or decision points later in the route."
      );
    case "resolved":
      return copy(
        locale,
        "\u5df2\u7ecf\u5904\u7406\u5e76\u7559\u75d5\u7684\u63a5\u7ba1\u70b9\u3002",
        "Takeover items that have been handled and recorded."
      );
  }
}

function evidenceRefLabel(ref: AutopilotTakeoverEvidenceRef): string {
  if (typeof ref === "string") return ref;
  return ref.label?.trim() || ref.id;
}

function TakeoverEvidenceRefs({
  item,
  locale,
}: {
  item: AutopilotTakeoverItem;
  locale: string;
}) {
  const refs = [
    item.evidenceEventId,
    ...(item.evidenceRefs ?? []).map(evidenceRefLabel),
  ].filter((value): value is string => Boolean(value?.trim()));

  if (!refs.length) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-600"
      data-testid={`autopilot-takeover-evidence-${item.id}`}
    >
      <span className="inline-flex items-center gap-1 font-semibold text-stone-700">
        <Link2 className="size-3" />
        {copy(locale, "\u8bc1\u636e", "Evidence")}:
      </span>
      {refs.map(ref => (
        <span
          key={ref}
          className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700"
        >
          {ref}
        </span>
      ))}
    </div>
  );
}

function TakeoverItemCard({
  item,
  locale,
}: {
  item: AutopilotTakeoverItem;
  locale: string;
}) {
  const status = normalizeToken(item.status) || item.status;

  return (
    <article
      className={cn(
        "rounded-[14px] border bg-white/75 p-3 shadow-sm",
        item.blocking
          ? "border-red-200 ring-1 ring-red-100"
          : "border-[var(--workspace-panel-border)]"
      )}
      data-testid={`autopilot-takeover-item-${item.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
          {localizeAutopilotTakeoverType(item.type, locale)}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
            statusTone(item.status, item.blocking)
          )}
        >
          {titleCase(status)}
        </span>
        {item.blocking && (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700">
            <AlertTriangle className="size-3" />
            {copy(locale, "\u963b\u585e", "Blocking")}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm font-medium leading-5 text-stone-900">
        {item.reason}
      </p>

      {item.recommendedAction && (
        <p className="mt-2 text-xs leading-5 text-stone-600">
          <span className="font-semibold text-stone-700">
            {copy(locale, "\u5efa\u8bae\u52a8\u4f5c", "Recommended action")}:
          </span>{" "}
          {item.recommendedAction}
        </p>
      )}

      <TakeoverEvidenceRefs item={item} locale={locale} />
    </article>
  );
}

export function AutopilotTakeoverControlPanel({
  items,
  className,
}: AutopilotTakeoverControlPanelProps) {
  const { locale } = useI18n();
  const grouped = LANE_ORDER.map(lane => ({
    lane,
    items: items.filter(item => inferLane(item) === lane),
  }));
  const blockingCount = items.filter(item => item.blocking).length;

  return (
    <section
      className={cn("workspace-panel rounded-[16px] p-4", className)}
      data-testid="autopilot-takeover-control-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600">
            {copy(locale, "\u63a5\u7ba1\u63a7\u5236\u9762\u677f", "Takeover control panel")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-stone-950">
            {copy(locale, "\u4eba\u5de5\u63a5\u7ba1\u961f\u5217", "Human takeover queue")}
          </h3>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            blockingCount
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          )}
        >
          {blockingCount
            ? copy(locale, `${blockingCount} \u4e2a\u963b\u585e`, `${blockingCount} blocking`)
            : copy(locale, "\u65e0\u963b\u585e", "No blocking")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {grouped.map(group => (
          <section
            key={group.lane}
            className="rounded-[14px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.58)] p-3"
            data-testid={`autopilot-takeover-lane-${group.lane}`}
          >
            <div className="flex items-start gap-2">
              <LaneIcon lane={group.lane} />
              <div>
                <h4 className="text-sm font-semibold text-stone-900">
                  {laneLabel(locale, group.lane)}
                </h4>
                <p className="mt-0.5 text-xs leading-5 text-stone-500">
                  {laneDescription(locale, group.lane)}
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {group.items.length ? (
                group.items.map(item => (
                  <TakeoverItemCard
                    key={item.id}
                    item={item}
                    locale={locale}
                  />
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-stone-200 bg-white/50 p-3 text-xs text-stone-500">
                  {copy(locale, "\u6682\u65e0\u63a5\u7ba1\u9879\u3002", "No takeover items yet.")}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
