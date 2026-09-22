/**
 * Dev-only entry：基础组件目录逐条渲染台，/base-catalog.html（vite dev 下可达）。
 *
 * 用途见 BaseCatalogHarness.tsx。跟 block-gallery / runtime-wiring 同一条规矩，
 * 不进生产产物（vite 的构建入口只有 index.html）。
 *
 * **不套 StrictMode**：这个台子要数「几条炸了」，StrictMode 在开发下把每个
 * 组件挂两遍，错误回调也会来两次，名单里全是重的。
 */
import { createRoot } from "react-dom/client";

import "../index.css";
import { BaseCatalogHarness } from "./BaseCatalogHarness";

const container = document.getElementById("base-catalog-root");
if (!container) throw new Error("base-catalog-root container missing");

createRoot(container).render(<BaseCatalogHarness />);
