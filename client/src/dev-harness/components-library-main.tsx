/**
 * Dev-only entry：组件库直挂台，/components-library.html（vite dev 下可达）。
 *
 * 用途见 ComponentsLibraryHarness.tsx。不进生产产物（构建入口只有 index.html）。
 */
import { createRoot } from "react-dom/client";

import "../index.css";
import { ComponentsLibraryHarness } from "./ComponentsLibraryHarness";

const container = document.getElementById("components-library-root");
if (!container) throw new Error("components-library-root container missing");

createRoot(container).render(<ComponentsLibraryHarness />);
