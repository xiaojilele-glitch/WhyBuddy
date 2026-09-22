import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderCalendarWizardPhoneBlock } from "../phone-mobile/PhoneCalendarWizardBlocks";
import {
  BookingConflictPanelRenderer,
  DeadlineAgendaRenderer,
  DeploymentWizardRenderer,
  EventRsvpPanelRenderer,
  RecurrenceEditorRenderer,
  ResourceBookingCalendarRenderer,
  ScheduleCapacityHeatmapRenderer,
} from "../calendar-wizard-blocks";

const row = { id: "r1", createdAt: "2026-01-01", values: { title: "示例", start: "2026-08-10", end: "2026-08-10", resource: "资源 A", member: "成员 A", status: "pending", due: "2026-08-10", time: "09:00", capacity: 10, booked: 4, frequency: "weekly", interval: 1, endMode: "never" } };
const props = (type: string, binding: Record<string, unknown>) => ({ block: { id: type, type, props: { surface: "plain" }, binding } as any, entityRows: { jobs: [row] }, onAction: () => undefined });
const calendarBinding = (secondary: string) => ({ entityRef: "jobs", titleFieldRef: "title", startFieldRef: "start", endFieldRef: "end", [secondary]: secondary === "resourceFieldRef" ? "resource" : "member", statusFieldRef: "status" });
function PhoneProbe({ value }: { value: any }) { return <>{renderCalendarWizardPhoneBlock(value)}</>; }

describe("calendar and scheduling best-practice blocks", () => {
  it("renders independent desktop surfaces with stable test ids", () => {
    const cases: Array<[string, React.ComponentType<any>, Record<string, unknown>, string]> = [
      ["ResourceBookingCalendar", ResourceBookingCalendarRenderer, calendarBinding("resourceFieldRef"), "resource-booking-calendar"],
      ["DeadlineAgenda", DeadlineAgendaRenderer, { entityRef: "jobs", titleFieldRef: "title", dueFieldRef: "due" }, "deadline-agenda"],
      ["BookingConflictPanel", BookingConflictPanelRenderer, { entityRef: "jobs", titleFieldRef: "title", startFieldRef: "start", endFieldRef: "end", resourceFieldRef: "resource", targets: ["booking"] }, "booking-conflict-panel"],
      ["ScheduleCapacityHeatmap", ScheduleCapacityHeatmapRenderer, { entityRef: "jobs", timeFieldRef: "time", capacityFieldRef: "capacity", bookedFieldRef: "booked" }, "schedule-capacity-heatmap"],
      ["EventRsvpPanel", EventRsvpPanelRenderer, { entityRef: "jobs", titleFieldRef: "title", memberFieldRef: "member", statusFieldRef: "status", targets: ["booking"] }, "event-rsvp-panel"],
      ["RecurrenceEditor", RecurrenceEditorRenderer, { entityRef: "jobs", frequencyFieldRef: "frequency", intervalFieldRef: "interval", endModeFieldRef: "endMode", targets: ["schedule"] }, "recurrence-editor"],
      ["DeploymentWizard", DeploymentWizardRenderer, { entityRef: "jobs", titleFieldRef: "title", statusFieldRef: "status", targets: ["deployment"] }, "deployment-wizard"],
    ];
    for (const [type, Renderer, binding, testid] of cases) expect(renderToStaticMarkup(<Renderer {...props(type, binding)} />)).toContain(`data-testid="${testid}"`);
  });

  it("uses a separate phone renderer for every new type", () => {
    const types = ["ResourceBookingCalendar", "DeadlineAgenda", "BookingConflictPanel", "ScheduleCapacityHeatmap", "EventRsvpPanel", "RecurrenceEditor", "DeploymentWizard"];
    for (const type of types) {
      const binding = type.includes("Calendar") ? calendarBinding(type.includes("Team") || type.includes("Shift") || type.includes("Editorial") ? "memberFieldRef" : "resourceFieldRef") : type === "DeadlineAgenda" ? { entityRef: "jobs", titleFieldRef: "title", dueFieldRef: "due" } : { entityRef: "jobs", titleFieldRef: "title", statusFieldRef: "status", targets: [type] };
      expect(renderToStaticMarkup(<PhoneProbe value={props(type, binding)} />)).toContain(`phone-${type.replace(/[A-Z]/g, (m, i) => (i ? `-${m.toLowerCase()}` : m.toLowerCase()))}`);
    }
  });
});
