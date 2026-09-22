import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(
  root,
  "client/src/pages/sliderule/generated/block-component-usage.json"
);

test("generated block usage matches the TypeScript renderer graph", () => {
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/generate-block-component-usage.mjs"), "--check"],
    { cwd: root, stdio: "pipe" }
  );

  const usage = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(usage.version, 2);
  assert.equal(usage.audit.method, "typescript-symbol-graph");
  assert.ok(usage.blocks.OnboardingChecklistWizard.desktop.includes("Steps"));
  assert.ok(usage.blocks.OnboardingChecklistWizard.phone.includes("M.Steps"));
  assert.ok(
    usage.blocks.ResourceBookingCalendar.phone.includes("M.CalendarPicker")
  );
  for (const type of usage.audit.phoneEnabledBlocks) {
    assert.ok(
      usage.blocks[type].phone.length > 0,
      `${type} has no phone usage`
    );
  }
});
