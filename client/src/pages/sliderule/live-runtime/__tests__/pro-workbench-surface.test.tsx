import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProWorkbenchSurface from "../ProWorkbenchSurface";
import type { AppFormFieldSchema, AppPageSurfaceSchema } from "../app-runtime-schema";
import type { RuntimeRow } from "../live-runtime";

const fields: AppFormFieldSchema[] = [
  { id: "name", label: "Name", type: "string" },
  {
    id: "status",
    label: "Status",
    type: "enum",
    options: [
      { id: "open", label: "Open", tone: "processing" },
      { id: "done", label: "Done", tone: "success" },
    ],
  },
];

const rows: RuntimeRow[] = [
  { id: "1", values: { name: "Alex", status: "open" }, createdAt: "2026-01-01" },
  { id: "2", values: { name: "Bo", status: "done" }, createdAt: "2026-01-01" },
];

function render(type: AppPageSurfaceSchema["type"]) {
  return renderToStaticMarkup(
    <ProWorkbenchSurface
      surface={{ type, density: "compact", source: "model" }}
      title="Operations"
      fields={fields}
      rows={rows}
      canCreate
      onCreate={() => undefined}
      onOpenRow={() => undefined}
      onSaveRow={() => undefined}
    />
  );
}

describe("ProWorkbenchSurface", () => {
  it.each([
    "table",
    "editable-table",
    "split-list",
    "queue",
  ] as const)("renders a distinct %s work surface", type => {
    const html = render(type);
    expect(html).toContain(`data-workbench-surface="${type}"`);
    expect(html).toContain("Operations");
  });

  it("renders queue status lanes from declared enum values", () => {
    const html = render("queue");
    expect(html).toContain("Open");
    expect(html).toContain("Done");
  });
});
