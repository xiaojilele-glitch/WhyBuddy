import { describe, expect, it } from "vitest";
import {
  BUSINESS_MUTED_SURFACE_STYLE,
  BUSINESS_SURFACE_STYLE,
} from "../business-surface-theme";

describe("business page surface theme", () => {
  it("uses Ant Design runtime variables instead of a fixed light palette", () => {
    expect(BUSINESS_SURFACE_STYLE).toEqual({
      background: "var(--ant-color-bg-container, #ffffff)",
      borderColor: "var(--ant-color-border-secondary, #f0f0f0)",
      color: "var(--ant-color-text, #262626)",
    });
    expect(BUSINESS_MUTED_SURFACE_STYLE.background).toBe(
      "var(--ant-color-fill-quaternary, #fafafa)"
    );
    expect(BUSINESS_MUTED_SURFACE_STYLE.color).toBe(
      "var(--ant-color-text-secondary, #595959)"
    );
  });
});
