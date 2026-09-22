export type ComponentWallDevice = "all" | "desktop" | "phone";
export type ComponentPreviewDevice = Exclude<ComponentWallDevice, "all">;

export interface ComponentPreviewEntry<T> {
  block: T;
  device: ComponentPreviewDevice;
}

/** 组件预览较重，每页最多挂载 20 张。 */
export const COMPONENT_WALL_PAGE_SIZE = 20;

export function buildComponentPreviewEntries<T>(
  blocks: T[],
  device: ComponentWallDevice,
  hasPhoneImplementation: (block: T) => boolean
): ComponentPreviewEntry<T>[] {
  if (device === "phone") {
    return blocks
      .filter(hasPhoneImplementation)
      .map(block => ({ block, device: "phone" }));
  }
  if (device === "desktop") {
    return blocks.map(block => ({ block, device: "desktop" }));
  }
  return blocks.flatMap(block =>
    hasPhoneImplementation(block)
      ? [
          { block, device: "desktop" as const },
          { block, device: "phone" as const },
        ]
      : [{ block, device: "desktop" as const }]
  );
}

export function paginateComponentPreviews<T>(
  entries: ComponentPreviewEntry<T>[],
  requestedPage: number,
  pageSize = COMPONENT_WALL_PAGE_SIZE
): {
  items: ComponentPreviewEntry<T>[];
  page: number;
  total: number;
  totalPages: number;
} {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const start = (page - 1) * safePageSize;
  return {
    items: entries.slice(start, start + safePageSize),
    page,
    total,
    totalPages,
  };
}
