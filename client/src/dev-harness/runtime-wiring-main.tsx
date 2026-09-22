/**
 * Dev-only entry：真实运行时接线台，/runtime-wiring.html（vite dev 下可达）。
 *
 * 用途见 RuntimeWiringHarness.tsx。跟 block-gallery / wall-fixture 一样不进
 * 生产产物（构建入口只有 index.html）。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import { RuntimeWiringHarness } from "./RuntimeWiringHarness";

const container = document.getElementById("runtime-wiring-root");
if (!container) throw new Error("runtime-wiring-root container missing");

createRoot(container).render(
  <StrictMode>
    <RuntimeWiringHarness />
  </StrictMode>
);
