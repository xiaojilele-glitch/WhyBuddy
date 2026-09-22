import { describe, expect, it } from "vitest";

const sources = {
  "PhoneCalendar.tsx": await import("../phone-mobile/PhoneCalendar.tsx?raw").then(m => m.default),
  "PhoneDetailPopup.tsx": await import("../phone-mobile/PhoneDetailPopup.tsx?raw").then(m => m.default),
  "PhoneExperienceBlock.tsx": await import("../phone-mobile/PhoneExperienceBlock.tsx?raw").then(m => m.default),
  "PhoneFormPopup.tsx": await import("../phone-mobile/PhoneFormPopup.tsx?raw").then(m => m.default),
  "PhoneHome.tsx": await import("../phone-mobile/PhoneHome.tsx?raw").then(m => m.default),
  "PhoneKanban.tsx": await import("../phone-mobile/PhoneKanban.tsx?raw").then(m => m.default),
  "PhoneNavBar.tsx": await import("../phone-mobile/PhoneNavBar.tsx?raw").then(m => m.default),
  "PhonePageList.tsx": await import("../phone-mobile/PhonePageList.tsx?raw").then(m => m.default),
  "PhoneRolePicker.tsx": await import("../phone-mobile/PhoneRolePicker.tsx?raw").then(m => m.default),
  "PhoneTabBar.tsx": await import("../phone-mobile/PhoneTabBar.tsx?raw").then(m => m.default),
} as const;

const read = (name: keyof typeof sources) => sources[name];

describe("mobile surfaces use official antd-mobile interaction components", () => {
  it("uses CalendarPicker for range filters instead of two hand-built date buttons", async () => {
    const source = read("PhoneExperienceBlock.tsx");
    expect(source).toContain("CalendarPicker");
    expect(source).not.toContain('onClick={() => setActive("start")}');
    expect(source).not.toContain('onClick={() => setActive("end")}');
  });

  it("adapts enum filters between Selector and Picker", async () => {
    const source = read("PhoneExperienceBlock.tsx");
    expect(source).toContain("field.options.length <= 6");
    expect(source).toMatch(/<Selector\b/);
    expect(source).toMatch(/<Picker\b/);
  });

  it("uses CalendarPickerView for the inline calendar surface", async () => {
    const source = read("PhoneCalendar.tsx");
    expect(source).toContain("CalendarPickerView");
    expect(source).not.toMatch(/import \{ Calendar \} from "antd-mobile"/);
  });

  it("uses antd-mobile Button as the role picker trigger", async () => {
    const source = read("PhoneRolePicker.tsx");
    expect(source).toContain('import { Button, Picker } from "antd-mobile"');
    expect(source).not.toMatch(/<a\s/);
  });

  it("keeps mobile icon imports in the official antd-mobile icon package", async () => {
    for (const name of ["PhoneRolePicker.tsx", "PhonePageList.tsx", "PhoneTabBar.tsx"]) {
      const source = read(name);
      expect(source).not.toContain("@ant-design/icons");
      expect(source).toContain("antd-mobile-icons");
    }
  });

  it("uses NavBar for popup headers instead of clickable anchor text", async () => {
    for (const name of ["PhoneFormPopup.tsx", "PhoneDetailPopup.tsx"]) {
      const source = read(name);
      expect(source).toContain("NavBar");
      expect(source).not.toMatch(/<a\s+onClick=\{onClose\}/);
    }
  });

  it("uses Badge for kanban counts instead of a styled count span", () => {
    const source = read("PhoneKanban.tsx");
    expect(source).toContain("Badge");
    expect(source).toMatch(/<Badge\b/);
    expect(source).not.toContain("fontVariantNumeric");
  });

  it("uses List.Item for metric label and value layout", () => {
    const source = read("PhoneExperienceBlock.tsx");
    expect(source).toMatch(/<List\.Item\b/);
    expect(source).toContain("extra={displayValue}");
  });

  it("uses ErrorBlock for mobile empty states", () => {
    for (const name of ["PhoneFormPopup.tsx", "PhoneHome.tsx"] as const) {
      const source = read(name);
      expect(source).toContain("ErrorBlock");
      expect(source).toMatch(/<ErrorBlock\b/);
    }
  });

  it("uses NoticeBar for the selected calendar date feedback", () => {
    const source = read("PhoneCalendar.tsx");
    expect(source).toContain("NoticeBar");
    expect(source).toMatch(/<NoticeBar\b/);
  });

  it("uses the official card list mode instead of a hand-styled list shell", () => {
    const source = read("PhonePageList.tsx");
    expect(source).toContain('<List mode="card">');
    expect(source).not.toContain('borderRadius: 8');
  });

  it("keeps navigation appearance on the official component defaults", () => {
    const nav = read("PhoneNavBar.tsx");
    const tabs = read("PhoneTabBar.tsx");
    expect(nav).not.toContain("boxShadow");
    expect(tabs).not.toContain("borderTop");
    expect(tabs).not.toContain('background: "#fff"');
  });
});
