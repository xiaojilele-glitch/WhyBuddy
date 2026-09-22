import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import { replayCoverage } from "@shared/blueprint/sliderule-coverage-replay";
import type {
  V5SessionState,
  Artifact,
} from "@shared/blueprint/v5-reasoning-state";
import { deriveTrustSeal } from "./derive-trust-seal";
import { parseReportSections } from "./parse-report-sections";
import {
  derivePublishClosureSummaryFromPublishArtifact,
  deriveReportExportClosureSummary,
  deriveReportExportClosureSummaryFromPublishArtifact,
  formatClosureStatusAndTopBlockersForFinalReport,
  renderPublishClosureBlocker,
} from "./derive-cross-runtime-summary";
import { deriveRuntimeSnapshotMd } from "./live-runtime/runtime-snapshot";
import {
  loadRuntimeRole,
  loadRuntimeState,
} from "./live-runtime/runtime-persistence";
import { parseFiveSystemModelFromPerSkillEvidence } from "./system-screens/five-system-model";

export interface SerializeDeliveryOpts {
  /** 排练运行时快照 md（deriveRuntimeSnapshotMd 产出；null/缺省 → 不出段） */
  runtimeSnapshotMd?: string | null;
}

/** Pure md serializer for Knife C delivery export — does not mutate state. */
export function serializeSlideRuleDeliveryMd(
  state: V5SessionState,
  opts: SerializeDeliveryOpts = {}
): string {
  const report = latestTrustedReport(state);
  const seal = deriveTrustSeal(state);
  const replay = replayCoverage(state);
  const lines: string[] = [];

  lines.push("# 面团 AI 交付包");
  lines.push("");
  lines.push(`> ${seal.displayLine}`);
  lines.push("");
  lines.push(`**目标**: ${state.goal?.text || "—"}`);
  lines.push(`**结论状态**: ${state.goal?.status || "—"}`);
  lines.push(`**交付阶段**: ${state.deliveryPhase || "none"}`);
  lines.push("");

  if (report) {
    lines.push("## 推演报告（核心交付 · 人类可读版）");
    lines.push("");
    const sections = parseReportSections(report);
    for (const sec of sections) {
      lines.push(`### ${sec.label}`);
      lines.push("");
      lines.push(sec.body.trim() || "（空）");
      lines.push("");
      if (sec.evidenceRefs.length > 0) {
        lines.push("**证据 / 上游引用**：");
        sec.evidenceRefs.forEach((ref: string) => lines.push(`- ${ref}`));
        lines.push("");
      }
    }
    lines.push(
      "> 注：报告中如有外部 URL、证据 artifact，请在画布上点击对应节点或证据按钮查看完整上下文。"
    );
    lines.push("");

    const enriched = enrichReportWriteWithRuntimeClosure(report, state);
    const enrichedContent = String(enriched.report.content || "");
    const closureStart = enrichedContent.indexOf(
      APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER
    );
    if (closureStart >= 0) {
      lines.push(enrichedContent.slice(closureStart).trim());
      lines.push("");
    }
  }

  // 尽力包含其他分类交付物（与 DeliverablesPanel 分类对齐）
  const stale2 = new Set(state.staleArtifactIds || []);
  const trusted2 = (state.artifacts || []).filter(
    (a: any) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stale2.has(a.id)
  );
  const latestBy = (kindOrCap: string) =>
    [...trusted2]
      .reverse()
      .find(
        (a: any) =>
          a.kind === kindOrCap ||
          String(a.producedBy?.capabilityId || "").includes(kindOrCap) ||
          (kindOrCap === "prompt" &&
            String(a.producedBy?.capabilityId || "").includes(
              "instruction.package"
            )) ||
          (kindOrCap === "handoff" &&
            String(a.producedBy?.capabilityId || "").includes(
              "handoff.package"
            )) ||
          (kindOrCap === "arch" &&
            String(a.producedBy?.capabilityId || "").includes(
              "outcome.visualize"
            ))
      );

  const addSection = (title: string, art: any) => {
    if (!art) return;
    lines.push(`## ${title}`);
    lines.push("");
    const c = String(art.content || "").trim();
    if (title.includes("规格树")) {
      lines.push("```");
      lines.push(c);
      lines.push("```");
    } else if (title.includes("架构图")) {
      const m = c.match(/```mermaid[\s\S]*?```/i);
      lines.push(m ? m[0] : c);
    } else {
      lines.push(c || "（空）");
    }
    lines.push("");
  };

  addSection("规格树（SPEC Tree）", latestBy("spec_tree"));
  addSection("提示词包（Prompt Pack）", latestBy("prompt"));
  addSection("架构图（Arch / Mermaid）", latestBy("arch"));
  addSection("工程交接包（Handoff）", latestBy("handoff"));
  const otherDoc =
    latestBy("doc") || latestBy("document.draft") || latestBy("task.write");
  if (otherDoc && (!report || otherDoc.id !== report.id)) {
    addSection("规格 / 设计 / 任务文档", otherDoc);
  }

  if (!report) {
    const closureRender = deriveAppBundleClosureRender(state);
    lines.push(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    lines.push("");
    if (closureRender.present) {
      closureRender.summaryLines.forEach(line => lines.push(line));
    } else {
      lines.push(
        "runtime closure evidence was not found; publish should remain blocked until version pins, runtime snapshot, and per-skill runtime evidence are present."
      );
    }
    lines.push("");
  }

  // 系统不变式（总装约束层）：模型带 appbundle.invariants 才出段——
  // 成熟系统的架构文档必然沉淀这一层（见 docs/reverse-eval-ai-artist-saas.md），
  // 交付物如实透出：陈述 + 约束系统 + 落地引用（门禁已保证 refs 可解析）。
  const invariantsMd = deriveInvariantsMdForState(state);
  if (invariantsMd) {
    lines.push(invariantsMd.trim());
    lines.push("");
  }

  // 排练运行时快照（M3）：有数据才出段，交付物固定格式不变，只多一个附录
  if (opts.runtimeSnapshotMd) {
    lines.push(opts.runtimeSnapshotMd.trim());
    lines.push("");
  }

  lines.push("## 审计明细（内部 / 开发者参考，可忽略）");
  lines.push("");
  lines.push("### T_LEDGER 摘要");
  lines.push("");
  const structureRows = (state.structureGateLedger || []).slice(-12);
  if (structureRows.length === 0) {
    lines.push("（无 structure gate 记录）");
  } else {
    for (const row of structureRows) {
      lines.push(
        `- ${row.gateId} attempt=${row.attempt ?? 0} status=${row.status} turn=${row.turnId || "—"}`
      );
    }
  }
  lines.push("");
  const flowRows = (state.flowBoundaryLedger || []).slice(-12);
  if (flowRows.length > 0) {
    lines.push("### Flow boundary");
    for (const row of flowRows) {
      lines.push(
        `- ${row.id} turn=${row.turnId} passed=${row.passed} source=${row.source}`
      );
    }
    lines.push("");
  }

  lines.push("### 证据出处");
  lines.push("");
  const stale = new Set(state.staleArtifactIds || []);
  const evidenceArts = (state.artifacts || []).filter(
    a =>
      a.kind === "evidence" &&
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stale.has(a.id)
  );
  if (evidenceArts.length === 0) {
    lines.push("（无健康 evidence 产物）");
  } else {
    for (const ev of evidenceArts) {
      lines.push(
        `- **${ev.id}** (provenance=${ev.provenance || "—"}): ${(ev.summary || ev.title || "").slice(0, 120)}`
      );
    }
  }
  lines.push("");

  lines.push("### GCOV 覆盖回放");
  lines.push("");
  lines.push(`模式: ${replay.mode || "—"} · gatePassed: ${replay.gatePassed}`);
  for (const req of replay.required) {
    lines.push(
      `- ${req.capabilityId}${req.isConvergenceAction ? " (收敛)" : ""}: ${
        req.satisfied ? "✓" : "✗"
      }${req.satisfiedByArtifactId ? ` ← ${req.satisfiedByArtifactId}` : ""}`
    );
  }
  if (replay.openGapIds.length > 0) {
    lines.push("");
    lines.push(`开放缺口: ${replay.openGapIds.join(", ")}`);
  }

  const publishArtifact =
    (state as any).publishArtifact ??
    (state as any).releaseArtifactWithRuntimeClosure ??
    null;
  const reportExportClosure = (state as any).publishClosure
    ? deriveReportExportClosureSummary((state as any).publishClosure)
    : deriveReportExportClosureSummaryFromPublishArtifact(publishArtifact);
  lines.push("");
  lines.push("### Report/Export Summary (from publish artifact closure)");
  lines.push(
    `source=${reportExportClosure.source} status=${reportExportClosure.status} digest=${
      reportExportClosure.digest || "n/a"
    } evidence=${reportExportClosure.evidencePresentCount}/${reportExportClosure.skillCount} pins=${
      reportExportClosure.versionPinsChecked
    } blockers=${reportExportClosure.blockerCount}`
  );

  lines.push("");
  lines.push("---");
  lines.push(`Generated by SlideRule · session=${state.sessionId || "—"}`);

  return lines.join("\n");
}

export interface AppBundleClosureRender {
  present: boolean;
  summaryLines: string[];
}

export const APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER =
  "## AppBundle publish/runtime closure";

export const CLOSED_CLOSURE_REPORT_SECTION = "## Closed Closure Report Section";

const APPBUNDLE_CLOSURE_SKILL_ORDER = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
];

function appendClosureDetailLines(
  lines: string[],
  detailLines: string[]
): string[] {
  if (detailLines.length === 0) return lines;
  return [...lines, ...detailLines];
}

function perSkillEvidenceCoverageLines(perSkillEvidence: unknown): string[] {
  if (!perSkillEvidence || typeof perSkillEvidence !== "object") return [];
  const evidence = perSkillEvidence as Record<
    string,
    { evidencePresent?: boolean } | undefined
  >;
  return [
    "evidence coverage:",
    "| skill | evidence |",
    "| --- | --- |",
    ...APPBUNDLE_CLOSURE_SKILL_ORDER.map(
      skill =>
        `| ${skill} | ${evidence[skill]?.evidencePresent === true ? "present" : "missing"} |`
    ),
  ];
}

export function renderPerSkillEvidenceCoverageTable(
  perSkillEvidence: unknown
): string {
  return perSkillEvidenceCoverageLines(perSkillEvidence).join("\n");
}

export function deriveAppBundleClosureRender(
  state: V5SessionState
): AppBundleClosureRender {
  const publishArtifact =
    (state as any).publishArtifact ??
    (state as any).releaseArtifactWithRuntimeClosure ??
    null;
  const publishClosure =
    (state as any).publishClosure ??
    derivePublishClosureSummaryFromPublishArtifact(publishArtifact);
  if (publishClosure && typeof publishClosure === "object") {
    const blocked = !!publishClosure.blocked;
    const evidencePresentCount = Number(
      publishClosure.evidencePresentCount ?? 0
    );
    const skillCount = Number(publishClosure.skillCount ?? 0);
    const tierCounts = publishClosure.tierCounts ?? {};
    const detailLines: string[] = [
      ...perSkillEvidenceCoverageLines(publishClosure.perSkillEvidence),
    ];
    const topBlockersArr = Array.isArray(publishClosure.topBlockers)
      ? publishClosure.topBlockers.slice(0, 3)
      : [];
    if (blocked && topBlockersArr.length > 0) {
      detailLines.push("### Blocked closure report section", "");
      topBlockersArr.forEach((blocker: any) => {
        const code = String(blocker?.code || "UNKNOWN_BLOCKER");
        detailLines.push(`- code: ${code}`);
        if (blocker?.path) detailLines.push(`  path: ${blocker.path}`);
        if (blocker?.affectedSkill)
          detailLines.push(`  affectedSkill: ${blocker.affectedSkill}`);
        if (blocker?.ref) detailLines.push(`  ref: ${blocker.ref}`);
      });
      detailLines.push("");
    }
    if (topBlockersArr.length > 0) {
      const legacyBlockerLines = topBlockersArr.map(
        (blocker: any) => `- ${renderPublishClosureBlocker(blocker)}`
      );
      detailLines.push("closure blockers:", ...legacyBlockerLines);
    }
    const baseLines = [
      `closure outcome: ${blocked ? "blocked" : "closed"}`,
      `version pins: ${publishClosure.versionPinsChecked ? "checked" : "missing"}`,
      `python publishClosure: ${blocked ? "blocked" : "closed"}`,
      ...formatClosureStatusAndTopBlockersForFinalReport(publishClosure).split(
        "\n"
      ),
      `${evidencePresentCount}/${skillCount} evidence · pins ${publishClosure.versionPinsChecked ? "checked" : "missing"}`,
      `digest ${publishClosure.stableDigest ?? "n/a"} · hash ${publishClosure.closureHash ?? "n/a"} · generatedAt ${publishClosure.generatedAt ?? "n/a"}`,
      `hard ${tierCounts.hard_blocker ?? 0} · warn ${tierCounts.warning ?? 0} · info ${tierCounts.info ?? 0}`,
    ];
    if (!blocked) {
      baseLines.push(
        "",
        CLOSED_CLOSURE_REPORT_SECTION,
        `versionPinsChecked: ${publishClosure.versionPinsChecked === true ? "true" : "false"}`,
        "evidence coverage and version pins verified for closed runtime closure."
      );
    }
    return {
      present: true,
      summaryLines: appendClosureDetailLines(baseLines, detailLines),
    };
  }

  const stale = new Set(state.staleArtifactIds || []);
  const trusted = (state.artifacts || []).filter(
    (artifact: Artifact) =>
      (artifact.trustLevel === "gated_pass" ||
        artifact.trustLevel === "audited") &&
      !stale.has(artifact.id)
  );
  const closureArtifact = trusted.find(artifact =>
    /appbundle|runtimeClosure|publishClosure|versionPinsChecked|perSkillEvidence|APPBUNDLE_RUNTIME/i.test(
      [
        artifact.kind,
        artifact.producedBy?.capabilityId,
        artifact.title,
        artifact.summary,
        artifact.content,
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

  if (!closureArtifact) {
    return { present: false, summaryLines: [] };
  }

  const content = String(
    closureArtifact.content || closureArtifact.summary || ""
  ).trim();
  const summary =
    content.length > 700 ? `${content.slice(0, 700)}...` : content;

  return {
    present: true,
    summaryLines: [
      `evidence artifact: ${closureArtifact.id} (trust=${closureArtifact.trustLevel})`,
      summary || "structured AppBundle runtime closure evidence present",
    ],
  };
}

export function enrichReportWriteWithRuntimeClosure(
  report: Artifact,
  state: V5SessionState
): { report: Artifact; included: boolean } {
  if (report.producedBy?.capabilityId !== "report.write") {
    return { report, included: false };
  }

  const marker = "## AppBundle publish/runtime closure";
  if (String(report.content || "").includes(marker)) {
    return { report, included: true };
  }

  const closureRender = deriveAppBundleClosureRender(state);
  const appendixLines = [marker, ""];
  if (closureRender.present) {
    appendixLines.push(...closureRender.summaryLines);
  } else {
    appendixLines.push(
      "runtime closure evidence was not found; publish should remain blocked until version pins, runtime snapshot, and per-skill runtime evidence are present."
    );
  }

  return {
    report: {
      ...report,
      content: `${String(report.content || "").trim()}\n\n${appendixLines.join("\n")}`,
    },
    included: closureRender.present,
  };
}

/**
 * 装配排练运行时快照：localStorage 里的运行时状态 + 当前角色 + 模型（字段名标注）。
 * 读不到/无数据 → null，交付物与从前逐字节一致。
 */
/**
 * 系统不变式段（改进②）：从 perSkillEvidence 重建的模型里取 appbundle.invariants。
 * 无模型/无不变式 → null，交付物与从前逐字节一致。
 */
export function deriveInvariantsMdForState(
  state: V5SessionState
): string | null {
  try {
    const model = parseFiveSystemModelFromPerSkillEvidence(
      (state as any).publishClosure?.perSkillEvidence
    );
    const invariants = model?.appbundle?.invariants ?? [];
    if (invariants.length === 0) return null;
    const lines: string[] = ["## 系统不变式（必须恒真的总装约束）", ""];
    invariants.forEach((inv, i) => {
      const systems = (inv.systems ?? []).join("/");
      const refs = (inv.refs ?? []).join(", ");
      const meta = [
        systems && `约束系统: ${systems}`,
        refs && `落地引用: \`${refs}\``,
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(
        `${i + 1}. ${inv.statement || inv.id || "（未命名）"}${meta ? ` — ${meta}` : ""}`
      );
    });
    return lines.join("\n");
  } catch {
    return null;
  }
}

export function assembleRuntimeSnapshotMdForState(
  state: V5SessionState
): string | null {
  try {
    const sessionId = state.sessionId || "";
    if (!sessionId) return null;
    const runtime = loadRuntimeState(sessionId);
    const model = parseFiveSystemModelFromPerSkillEvidence(
      (state as any).publishClosure?.perSkillEvidence
    );
    return deriveRuntimeSnapshotMd(model, runtime, loadRuntimeRole(sessionId));
  } catch {
    return null;
  }
}

export function downloadSlideRuleDeliveryMd(
  state: V5SessionState,
  filename?: string
): void {
  const md = serializeSlideRuleDeliveryMd(state, {
    runtimeSnapshotMd: assembleRuntimeSnapshotMdForState(state),
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    `sliderule-delivery-${state.sessionId || "session"}-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
