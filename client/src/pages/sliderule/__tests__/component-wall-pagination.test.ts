import { describe, expect, it } from "vitest";
import {
  buildComponentPreviewEntries,
  COMPONENT_WALL_PAGE_SIZE,
  paginateComponentPreviews,
} from "../component-wall-pagination";

interface BlockStub {
  type: string;
  phone: boolean;
}

const blocks = Array.from({ length: 17 }, (_, index): BlockStub => ({
  type: `Block${index + 1}`,
  phone: index % 2 === 0,
}));
const hasPhone = (block: BlockStub) => block.phone;

describe("component wall pagination", () => {
  it("keeps every entry searchable but mounts only the current 20-preview page", () => {
    const entries = buildComponentPreviewEntries(blocks, "all", hasPhone);
    const first = paginateComponentPreviews(entries, 1);

    expect(entries).toHaveLength(26);
    expect(first.total).toBe(26);
    expect(first.items).toHaveLength(COMPONENT_WALL_PAGE_SIZE);
    expect(first.items).toEqual(entries.slice(0, COMPONENT_WALL_PAGE_SIZE));
  });

  it("replaces the first page and keeps the final remainder", () => {
    const entries = buildComponentPreviewEntries(blocks, "all", hasPhone);
    const second = paginateComponentPreviews(entries, 2);

    expect(second.items).toEqual(entries.slice(20));
    expect(second.items).toHaveLength(6);
    expect(second.page).toBe(2);
  });

  it("shows only true phone implementations in the phone tier", () => {
    const entries = buildComponentPreviewEntries(blocks, "phone", hasPhone);

    expect(entries).toHaveLength(9);
    expect(entries.every(entry => entry.device === "phone" && entry.block.phone)).toBe(true);
  });

  it("clamps an obsolete page after filtering instead of rendering an empty wall", () => {
    const entries = buildComponentPreviewEntries(blocks.slice(0, 3), "desktop", hasPhone);
    const result = paginateComponentPreviews(entries, 9);

    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
  });
});
