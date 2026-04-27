import { useState } from "react";
import {
  CheckCircle2,
  CircleDot,
  Clock3,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
} from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type AutopilotEvidenceTrust =
  | "verified"
  | "partial"
  | "trusted"
  | "inferred"
  | "unverified"
  | "redacted"
  | "low";

export type AutopilotEvidenceStatus =
  | "recorded"
  | "running"
  | "completed"
  | "failed"
  | "pending";

export type AutopilotEvidenceCategory =
  | "route"
  | "takeover"
  | "fleet"
  | "tool"
  | "output"
  | "audit";

export const AUTOPILOT_EVIDENCE_CATEGORIES = [
  "route",
  "takeover",
  "fleet",
  "tool",
  "output",
  "audit",
] as const satisfies readonly AutopilotEvidenceCategory[];

export const AUTOPILOT_EVIDENCE_EVENT_PREFIXES = [
  ...AUTOPILOT_EVIDENCE_CATEGORIES,
] as const;

export type AutopilotEvidenceEventPrefix =
  (typeof AUTOPILOT_EVIDENCE_EVENT_PREFIXES)[number];

export type AutopilotEvidenceDetailPayload = {
  title?: string | null;
  description?: string | null;
  attributes?: Record<string, string | number | boolean | null | undefined> | null;
  raw?: unknown;
};

export type AutopilotEvidenceEvent = {
  id: string;
  eventType: string;
  trust?: AutopilotEvidenceTrust | string | null;
  status?: AutopilotEvidenceStatus | string | null;
  actor?: string | null;
  summary: string;
  occurredAt?: number | string | Date | null;
  category?: AutopilotEvidenceCategory | string | null;
  detail?: AutopilotEvidenceDetailPayload | null;
};

export type AutopilotEvidenceRecorderProps = {
  events: AutopilotEvidenceEvent[];
  categoryFilter?: AutopilotEvidenceCategory | "all";
  initialDetailEventId?: string | null;
  className?: string;
};

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

function timestampValue(value: AutopilotEvidenceEvent["occurredAt"]): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatTimestamp(
  value: AutopilotEvidenceEvent["occurredAt"],
  locale: string
): string {
  const timestamp = timestampValue(value);
  if (!timestamp) {
    return copy(locale, "\u672a\u8bb0\u5f55\u65f6\u95f4", "Time not recorded");
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function trustTone(trust?: string | null): string {
  if (trust === "verified" || trust === "trusted") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (trust === "partial" || trust === "inferred") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (trust === "redacted") {
    return "border-stone-300 bg-stone-100 text-stone-700";
  }
  if (trust === "low" || trust === "unverified") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function statusTone(status?: string | null): string {
  if (status === "completed" || status === "recorded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-stone-200 bg-stone-50 text-stone-700";
}

export function localizeAutopilotEvidenceEventType(
  eventType: string,
  locale = "en-US"
): string {
  const normalized = eventType.trim().toLowerCase();

  const labels: Record<string, { zh: string; en: string }> = {
    "route.recommended": {
      zh: "\u8def\u7ebf\u5df2\u63a8\u8350",
      en: "Route recommended",
    },
    "route.selected": {
      zh: "\u8def\u7ebf\u5df2\u9009\u62e9",
      en: "Route selected",
    },
    "route.locked": {
      zh: "\u8def\u7ebf\u5df2\u9501\u5b9a",
      en: "Route locked",
    },
    "route.replanned": {
      zh: "\u8def\u7ebf\u5df2\u91cd\u89c4\u5212",
      en: "Route replanned",
    },
    "takeover.requested": {
      zh: "\u5df2\u8bf7\u6c42\u63a5\u7ba1",
      en: "Takeover requested",
    },
    "takeover.resolved": {
      zh: "\u63a5\u7ba1\u5df2\u5b8c\u6210",
      en: "Takeover resolved",
    },
    "fleet.assigned": {
      zh: "\u8f66\u961f\u5df2\u5206\u914d",
      en: "Fleet assigned",
    },
    "fleet.updated": {
      zh: "\u8f66\u961f\u5df2\u66f4\u65b0",
      en: "Fleet updated",
    },
    "tool.called": {
      zh: "\u5de5\u5177\u5df2\u8c03\u7528",
      en: "Tool called",
    },
    "tool.completed": {
      zh: "\u5de5\u5177\u5df2\u5b8c\u6210",
      en: "Tool completed",
    },
    "output.generated": {
      zh: "\u8f93\u51fa\u5df2\u751f\u6210",
      en: "Output generated",
    },
    "audit.recorded": {
      zh: "\u5ba1\u8ba1\u5df2\u8bb0\u5f55",
      en: "Audit recorded",
    },
    "audit.warning": {
      zh: "\u5ba1\u8ba1\u544a\u8b66",
      en: "Audit warning",
    },
    "evidence.recorded": {
      zh: "\u8bc1\u636e\u5df2\u8bb0\u5f55",
      en: "Evidence recorded",
    },
  };

  const label = labels[normalized];
  if (label) {
    return copy(locale, label.zh, label.en);
  }

  return titleCase(normalized || eventType);
}

export function getAutopilotEvidenceCategory(
  event: Pick<AutopilotEvidenceEvent, "eventType" | "category">
): AutopilotEvidenceCategory | "unknown" {
  const explicit = event.category?.trim().toLowerCase();
  if (isAutopilotEvidenceCategory(explicit)) {
    return explicit;
  }

  const prefix = event.eventType.trim().toLowerCase().split(".")[0];
  if (isAutopilotEvidenceEventPrefix(prefix)) {
    return prefix;
  }

  return "unknown";
}

export function isAutopilotEvidenceCategory(
  value: string | null | undefined
): value is AutopilotEvidenceCategory {
  return AUTOPILOT_EVIDENCE_CATEGORIES.includes(
    value as AutopilotEvidenceCategory
  );
}

export function isAutopilotEvidenceEventPrefix(
  value: string | null | undefined
): value is AutopilotEvidenceEventPrefix {
  return AUTOPILOT_EVIDENCE_EVENT_PREFIXES.includes(
    value as AutopilotEvidenceEventPrefix
  );
}

export function filterAutopilotEvidenceEvents(
  events: AutopilotEvidenceEvent[],
  category: AutopilotEvidenceCategory | "all"
): AutopilotEvidenceEvent[] {
  if (category === "all") return [...events];
  return events.filter(event => getAutopilotEvidenceCategory(event) === category);
}

export function sortAutopilotEvidenceEvents(
  events: AutopilotEvidenceEvent[]
): AutopilotEvidenceEvent[] {
  return [...events].sort((a, b) => {
    const timeDelta = timestampValue(a.occurredAt) - timestampValue(b.occurredAt);
    if (timeDelta !== 0) return timeDelta;
    return a.id.localeCompare(b.id);
  });
}

function EventIcon({ status }: { status?: string | null }) {
  if (status === "completed" || status === "recorded") {
    return <CheckCircle2 className="size-4 text-emerald-600" />;
  }
  if (status === "running" || status === "pending") {
    return <Clock3 className="size-4 text-blue-600" />;
  }
  return <CircleDot className="size-4 text-stone-500" />;
}

function categoryLabel(
  locale: string,
  category: AutopilotEvidenceCategory | "unknown"
): string {
  const labels: Record<string, { zh: string; en: string }> = {
    route: { zh: "\u8def\u7ebf", en: "Route" },
    takeover: { zh: "\u63a5\u7ba1", en: "Takeover" },
    fleet: { zh: "\u8f66\u961f", en: "Fleet" },
    tool: { zh: "\u5de5\u5177", en: "Tool" },
    output: { zh: "\u8f93\u51fa", en: "Output" },
    audit: { zh: "\u5ba1\u8ba1", en: "Audit" },
    unknown: { zh: "\u672a\u5206\u7c7b", en: "Unknown" },
  };
  const label = labels[category] ?? labels.unknown;
  return copy(locale, label.zh, label.en);
}

function detailAttributes(
  detail?: AutopilotEvidenceDetailPayload | null
): Array<[string, string]> {
  if (!detail?.attributes) return [];

  return Object.entries(detail.attributes)
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return value !== null && value !== undefined && value !== "";
    })
    .map(([key, value]) => [titleCase(key), String(value)]);
}

function formatRawDetail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;

  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

export function getAutopilotEvidenceDetailTitle(
  event: AutopilotEvidenceEvent,
  locale = "en-US"
): string {
  return (
    event.detail?.title ||
    localizeAutopilotEvidenceEventType(event.eventType, locale)
  );
}

export function getAutopilotEvidenceDetailDescription(
  event: AutopilotEvidenceEvent,
  locale = "en-US"
): string {
  return (
    event.detail?.description ||
    event.summary ||
    copy(locale, "\u8be5\u4e8b\u4ef6\u6682\u65e0\u8be6\u7ec6\u8bf4\u660e\u3002", "No detail payload was recorded for this event.")
  );
}

function EvidenceDetailDrawer({
  event,
  locale,
  onClose,
}: {
  event: AutopilotEvidenceEvent;
  locale: string;
  onClose: () => void;
}) {
  const category = getAutopilotEvidenceCategory(event);
  const attributes = detailAttributes(event.detail);
  const raw = formatRawDetail(event.detail?.raw);
  const title = getAutopilotEvidenceDetailTitle(event, locale);
  const description = getAutopilotEvidenceDetailDescription(event, locale);

  return (
    <aside
      aria-label={copy(locale, "\u8bc1\u636e\u8be6\u60c5", "Evidence detail")}
      className="mt-4 rounded-[16px] border border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.94),rgba(255,255,255,0.88))] p-4 shadow-[0_18px_42px_rgba(37,99,235,0.12)]"
      data-testid="autopilot-evidence-detail-drawer"
      role="dialog"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
            {copy(locale, "\u8bc1\u636e\u8be6\u60c5", "Evidence detail")}
          </p>
          <h4 className="mt-1 text-base font-semibold text-stone-950">
            {title}
          </h4>
          <p className="mt-1 text-sm leading-5 text-stone-600">
            {description}
          </p>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700"
          onClick={onClose}
        >
          <PanelRightClose className="size-3" />
          {copy(locale, "\u5173\u95ed", "Close")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
          {localizeAutopilotEvidenceEventType(event.eventType, locale)}
        </span>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
          {categoryLabel(locale, category)}
        </span>
        {event.status ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
              statusTone(event.status)
            )}
          >
            {titleCase(event.status)}
          </span>
        ) : null}
        {event.trust ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
              trustTone(event.trust)
            )}
          >
            {titleCase(event.trust)}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-xs leading-5 text-stone-700 sm:grid-cols-2">
        <div className="rounded-[12px] border border-white/80 bg-white/70 p-2">
          <dt className="font-semibold text-stone-500">
            {copy(locale, "\u4e8b\u4ef6 ID", "Event ID")}
          </dt>
          <dd className="mt-0.5 break-all font-medium text-stone-900">
            {event.id}
          </dd>
        </div>
        <div className="rounded-[12px] border border-white/80 bg-white/70 p-2">
          <dt className="font-semibold text-stone-500">
            {copy(locale, "\u53d1\u751f\u65f6\u95f4", "Occurred at")}
          </dt>
          <dd className="mt-0.5 font-medium text-stone-900">
            {formatTimestamp(event.occurredAt, locale)}
          </dd>
        </div>
        {event.actor ? (
          <div className="rounded-[12px] border border-white/80 bg-white/70 p-2">
            <dt className="font-semibold text-stone-500">
              {copy(locale, "\u6267\u884c\u8005", "Actor")}
            </dt>
            <dd className="mt-0.5 font-medium text-stone-900">
              {event.actor}
            </dd>
          </div>
        ) : null}
      </dl>

      {attributes.length > 0 ? (
        <section className="mt-3 rounded-[12px] border border-blue-100 bg-white/70 p-3">
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            {copy(locale, "\u5c5e\u6027", "Attributes")}
          </h5>
          <dl className="mt-2 grid gap-2 text-xs leading-5 text-stone-700 sm:grid-cols-2">
            {attributes.map(([key, value]) => (
              <div key={key}>
                <dt className="font-semibold text-stone-500">{key}</dt>
                <dd className="break-words font-medium text-stone-900">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {raw ? (
        <section className="mt-3 rounded-[12px] border border-stone-200 bg-stone-950 p-3 text-xs text-stone-100">
          <h5 className="font-semibold uppercase tracking-[0.16em] text-blue-200">
            {copy(locale, "\u539f\u59cb\u8bb0\u5f55", "Raw record")}
          </h5>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">
            {raw}
          </pre>
        </section>
      ) : null}
    </aside>
  );
}

export function AutopilotEvidenceRecorder({
  events,
  categoryFilter = "all",
  initialDetailEventId = null,
  className,
}: AutopilotEvidenceRecorderProps) {
  const { locale } = useI18n();
  const filteredEvents = filterAutopilotEvidenceEvents(events, categoryFilter);
  const sortedEvents = sortAutopilotEvidenceEvents(filteredEvents);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialDetailEventId
  );
  const selectedEvent =
    sortedEvents.find(event => event.id === selectedEventId) ?? null;

  return (
    <section
      className={cn(
        "workspace-panel rounded-[16px] p-4 motion-reduce:transition-none",
        className
      )}
      data-motion="evidence-timeline"
      data-reduced-motion="evidence-timeline-static"
      data-testid="autopilot-evidence-recorder"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
            {copy(locale, "\u8bc1\u636e\u8bb0\u5f55\u4eea", "Evidence recorder")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-stone-950">
            {copy(locale, "\u81ea\u52a8\u9a7e\u9a76\u4e8b\u4ef6\u65f6\u95f4\u7ebf", "Autopilot event timeline")}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
          <ShieldCheck className="size-3" />
          {copy(locale, `${sortedEvents.length} \u6761\u8bc1\u636e`, `${sortedEvents.length} events`)}
        </span>
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-1.5"
        data-testid="autopilot-evidence-filter-summary"
      >
        {(["route", "takeover", "fleet", "tool", "output", "audit"] as const).map(
          category => (
            <span
              key={category}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                categoryFilter === category
                  ? "border-blue-300 bg-blue-100 text-blue-800"
                  : "border-stone-200 bg-white/70 text-stone-500"
              )}
            >
              {categoryLabel(locale, category)}
            </span>
          )
        )}
      </div>

      <div className="mt-4 space-y-0">
        {sortedEvents.length ? (
          sortedEvents.map((event, index) => {
            const category = getAutopilotEvidenceCategory(event);
            const attributes = detailAttributes(event.detail);

            return (
              <article
                key={event.id}
                className="relative pl-6 motion-safe:duration-300 motion-safe:ease-out motion-reduce:transform-none motion-reduce:transition-none"
                data-motion="evidence-timeline-append"
                data-motion-index={index}
                data-reduced-motion="evidence-event-static"
                data-testid={`autopilot-evidence-event-${event.id}`}
              >
                {index < sortedEvents.length - 1 && (
                  <div className="absolute bottom-0 left-[7px] top-5 w-px bg-stone-200" />
                )}
                <div className="absolute left-0 top-3">
                  <EventIcon status={event.status} />
                </div>
                <div className="pb-3">
                  <div className="rounded-[14px] border border-[var(--workspace-panel-border)] bg-white/75 p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-stone-500">
                        {formatTimestamp(event.occurredAt, locale)}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                        {localizeAutopilotEvidenceEventType(
                          event.eventType,
                          locale
                        )}
                      </span>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                        {categoryLabel(locale, category)}
                      </span>
                      {event.trust && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                            trustTone(event.trust)
                          )}
                        >
                          {titleCase(event.trust)}
                        </span>
                      )}
                      {event.status && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                            statusTone(event.status)
                          )}
                        >
                          {titleCase(event.status)}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-sm font-medium leading-5 text-stone-900">
                      {event.summary}
                    </p>

                    {event.actor && (
                      <p className="mt-2 text-xs leading-5 text-stone-600">
                        <span className="font-semibold text-stone-700">
                          {copy(locale, "\u6267\u884c\u8005", "Actor")}:
                        </span>{" "}
                        {event.actor}
                      </p>
                    )}

                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-100"
                      onClick={() => setSelectedEventId(event.id)}
                    >
                      <PanelRightOpen className="size-3" />
                      {copy(locale, "\u6253\u5f00\u8be6\u60c5", "Open detail")}
                    </button>

                    {event.detail && (
                      <div
                        className="mt-2 rounded-[12px] border border-blue-100 bg-blue-50/70 p-2 text-xs leading-5 text-blue-900"
                        data-testid={`autopilot-evidence-detail-${event.id}`}
                      >
                        <div className="flex items-center gap-1 font-semibold">
                          <PanelRightOpen className="size-3" />
                          {copy(locale, "\u8be6\u60c5\u5df2\u51c6\u5907", "Drawer detail ready")}
                        </div>
                        {event.detail.title && (
                          <div className="mt-1 font-medium">
                            {event.detail.title}
                          </div>
                        )}
                        {event.detail.description && (
                          <div className="mt-1 text-blue-800">
                            {event.detail.description}
                          </div>
                        )}
                        {attributes.length > 0 && (
                          <dl className="mt-1 grid gap-1 sm:grid-cols-2">
                            {attributes.map(([key, value]) => (
                              <div key={key}>
                                <dt className="font-semibold text-blue-700">
                                  {key}
                                </dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[14px] border border-dashed border-stone-200 bg-white/50 p-4 text-sm text-stone-500">
            {copy(locale, "\u6682\u65e0\u8bc1\u636e\u4e8b\u4ef6\u3002", "No evidence events yet.")}
          </div>
        )}
      </div>

      {selectedEvent ? (
        <EvidenceDetailDrawer
          event={selectedEvent}
          locale={locale}
          onClose={() => setSelectedEventId(null)}
        />
      ) : null}
    </section>
  );
}
