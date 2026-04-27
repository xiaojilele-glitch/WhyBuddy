import type { ReactNode } from "react";
import {
  AlertTriangle,
  CircleDot,
  GitBranch,
  Hand,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface AutopilotCockpitLayoutProps {
  destination?: ReactNode;
  route?: ReactNode;
  liveDrive?: ReactNode;
  decision?: ReactNode;
  takeover?: ReactNode;
  evidence?: ReactNode;
  costRisk?: ReactNode;
  className?: string;
}

const SECTION_SHELL_CLASS =
  "workspace-panel rounded-[24px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.72)] shadow-[0_24px_70px_rgba(112,84,51,0.08)]";
const SECTION_INSET_CLASS =
  "workspace-panel-inset rounded-[18px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.62)] p-3";
const MOBILE_CHIP_CLASS =
  "min-w-0 max-w-full whitespace-normal break-words text-center leading-4";

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-[var(--workspace-panel-border)] bg-white/45 px-3 py-4 text-sm leading-6 text-stone-500">
      {label} will appear here when connected to task autopilot data.
    </div>
  );
}

function CockpitColumn({
  title,
  eyebrow,
  description,
  children,
  className,
  testId,
  railSlots,
}: {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
  className?: string;
  testId: string;
  railSlots?: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={cn(SECTION_SHELL_CLASS, "min-w-0 p-4", className)}
      data-right-rail-slots={railSlots}
      data-testid={testId}
    >
      <div className="mb-4 space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">
          {eyebrow}
        </div>
        <h3
          id={`${testId}-title`}
          className="text-base font-semibold tracking-[-0.01em] text-stone-950"
        >
          {title}
        </h3>
        <p className="text-xs leading-5 text-stone-500">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function CockpitPane({
  title,
  icon,
  children,
  fallback,
  testId,
}: {
  title: string;
  icon: ReactNode;
  children?: ReactNode;
  fallback: string;
  testId: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={SECTION_INSET_CLASS}
      data-testid={testId}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-900">
        <span className="flex size-7 items-center justify-center rounded-full border border-[var(--workspace-panel-border)] bg-white/75 text-teal-700">
          {icon}
        </span>
        <h4 id={`${testId}-title`}>{title}</h4>
      </div>
      {children ?? <EmptyPanel label={fallback} />}
    </section>
  );
}

export function AutopilotCockpitLayout({
  destination,
  route,
  liveDrive,
  decision,
  takeover,
  evidence,
  costRisk,
  className,
}: AutopilotCockpitLayoutProps) {
  return (
    <section
      className={cn(
        "workspace-panel relative overflow-hidden rounded-[32px] border border-[var(--workspace-panel-border)] bg-[linear-gradient(135deg,rgba(255,252,246,0.94),rgba(237,246,241,0.9)_48%,rgba(246,242,232,0.94))] p-4 shadow-[0_30px_90px_rgba(91,75,49,0.12)]",
        className
      )}
      data-layout-mode="desktop-three-column tablet-two-column stacked-mobile segmented-mobile"
      data-testid="autopilot-cockpit-layout"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-teal-500/30 to-transparent" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-700">
            Task Autopilot
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-stone-950">
            Three-column cockpit
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
            A layout shell for reading destination intent, live drive state,
            and human takeover evidence without wiring task data yet.
          </p>
        </div>
        <div
          className="inline-flex max-w-full flex-wrap rounded-full border border-[var(--workspace-panel-border)] bg-white/65 p-1 text-[11px] font-semibold text-stone-500 shadow-sm lg:hidden"
          data-overflow-guard="mobile-status-chip-wrap"
          data-testid="autopilot-cockpit-mobile-fallback"
        >
          <span
            className={cn(
              MOBILE_CHIP_CLASS,
              "rounded-full bg-stone-900 px-3 py-1 text-white"
            )}
          >
            Stacked
          </span>
          <span className={cn(MOBILE_CHIP_CLASS, "px-3 py-1")}>
            Tabs-ready
          </span>
        </div>
      </div>

      <nav
        aria-label="Autopilot cockpit sections"
        className="mb-4 grid min-w-0 grid-cols-2 gap-2 rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/55 p-2 text-[11px] font-semibold text-stone-600 shadow-sm md:hidden"
        data-overflow-guard="mobile-segment-chip-wrap"
        data-testid="autopilot-cockpit-segment-nav"
      >
        <a
          className={cn(
            MOBILE_CHIP_CLASS,
            "rounded-[16px] bg-white/80 px-3 py-2 shadow-sm"
          )}
          href="#autopilot-cockpit-route-title"
        >
          Route
        </a>
        <a
          className={cn(
            MOBILE_CHIP_CLASS,
            "rounded-[16px] bg-teal-900 px-3 py-2 text-white shadow-sm"
          )}
          href="#autopilot-cockpit-center-title"
        >
          Drive
        </a>
        <a
          className={cn(
            MOBILE_CHIP_CLASS,
            "rounded-[16px] bg-white/80 px-3 py-2 shadow-sm"
          )}
          href="#autopilot-cockpit-takeover-title"
        >
          Takeover
        </a>
        <a
          className={cn(
            MOBILE_CHIP_CLASS,
            "rounded-[16px] bg-white/80 px-3 py-2 shadow-sm"
          )}
          href="#autopilot-cockpit-evidence-title"
        >
          Evidence
        </a>
      </nav>

      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.35fr)_minmax(0,0.95fr)]"
        data-tablet-layout="two-column-center-priority"
        data-testid="autopilot-cockpit-grid"
      >
        <CockpitColumn
          title="Destination & Route"
          eyebrow="Left rail"
          description="Goal framing, destination constraints, and route choice."
          testId="autopilot-cockpit-left"
        >
          <CockpitPane
            title="Destination"
            icon={<CircleDot className="size-4" />}
            fallback="Destination"
            testId="autopilot-cockpit-destination"
          >
            {destination}
          </CockpitPane>
          <CockpitPane
            title="Route"
            icon={<GitBranch className="size-4" />}
            fallback="Route"
            testId="autopilot-cockpit-route"
          >
            {route}
          </CockpitPane>
        </CockpitColumn>

        <CockpitColumn
          title="Live Drive"
          eyebrow="Center stage"
          description="Primary operating lane for live execution and drive state."
          className="md:order-1 lg:order-none lg:min-h-[520px]"
          testId="autopilot-cockpit-center"
        >
          <div className="min-h-[280px] rounded-[24px] border border-[rgba(48,95,85,0.18)] bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,0.18),transparent_42%),rgba(255,255,255,0.58)] p-4 shadow-inner">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-teal-700">
                  Autopilot loop
                </div>
                <h4 className="text-lg font-semibold text-stone-950">
                  Live Drive
                </h4>
              </div>
              <span className="rounded-full border border-teal-600/20 bg-teal-50 px-3 py-1 text-[11px] font-semibold text-teal-800">
                Live lane
              </span>
            </div>
            {liveDrive ?? <EmptyPanel label="Live Drive" />}
          </div>
        </CockpitColumn>

        <CockpitColumn
          title="Takeover & Evidence"
          eyebrow="Right rail"
          description="Human intervention points and traceable proof."
          className="md:order-2 md:row-span-2 lg:order-none lg:row-span-1"
          railSlots="decision takeover evidence cost-risk"
          testId="autopilot-cockpit-right"
        >
          <div
            className="mb-3 flex items-start gap-2 rounded-[18px] border border-amber-500/25 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-900"
            data-priority="blocking-takeover-first"
            data-testid="autopilot-cockpit-blocking-takeover-marker"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <span>
              Blocking takeover stays visible before evidence on tablet and
              desktop rails.
            </span>
          </div>
          {decision != null ? (
            <CockpitPane
              title="Decision"
              icon={<CircleDot className="size-4" />}
              fallback="Decision"
              testId="autopilot-cockpit-decision"
            >
              {decision}
            </CockpitPane>
          ) : null}
          <CockpitPane
            title="Takeover"
            icon={<Hand className="size-4" />}
            fallback="Takeover"
            testId="autopilot-cockpit-takeover"
          >
            {takeover}
          </CockpitPane>
          <CockpitPane
            title="Evidence"
            icon={<ShieldCheck className="size-4" />}
            fallback="Evidence"
            testId="autopilot-cockpit-evidence"
          >
            {evidence}
          </CockpitPane>
          {costRisk != null ? (
            <CockpitPane
              title="Cost / Risk"
              icon={<AlertTriangle className="size-4" />}
              fallback="Cost / Risk"
              testId="autopilot-cockpit-cost-risk"
            >
              {costRisk}
            </CockpitPane>
          ) : null}
        </CockpitColumn>
      </div>
    </section>
  );
}
