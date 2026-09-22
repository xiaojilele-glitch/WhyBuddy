/**
 * `SubStageStatus` 的**类型叶子**（2026-09-04）。
 *
 * ⚠ 为什么单独一个文件：这个枚举原来定义在 `index.ts` 里，而 `index.ts`
 *   同时 re-export 三个 primitive；`status-capsule` 与 `sub-stage-card`
 *   反过来又 `import type { SubStageStatus } from "./index"` —— 两个环：
 *
 *       primitives/index ↔ status-capsule
 *       primitives/index ↔ sub-stage-card
 *
 *   （`arch-graph-ts.mjs --report` 的模块级环清单里就是这两条。）
 *
 *   桶文件（barrel）最容易长出这种环：它既是「对外的门」又是「共享定义的家」。
 *   两个身份必须分开——门可以依赖家，家不许依赖门。
 *
 *   都是 `import type`，编译后擦除，所以运行时不成环；代价在边界：
 *   primitive 拆不出这个目录，而闸把它们算数。
 *
 * ⚠ 这个文件不许 import 本目录任何东西，那是它能被所有人安全引用的全部理由
 *   （同 services 的 `util` 层）。
 */

/** 右栏子阶段的三态：已完成 / 执行中 / 等待。 */
export type SubStageStatus = "completed" | "active" | "pending";
