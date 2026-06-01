/**
 * Export Engine
 *
 * 编排 IR 构建、适配器调用和 ZIP 打包。
 *
 * exportWorkflow(workflowId, framework) 是唯一公开入口：
 * 1. 从数据库读取 WorkflowRecord、TaskRecord 和组织结构快照
 * 2. 调用 buildExportIR 构建 IR
 * 3. 根据 framework 参数调用对应适配器（或全部适配器）
 * 4. 生成 README.md 使用说明
 * 5. 使用 JSZip 打包为 ZIP buffer
 * 6. 单框架：文件放根目录；all：每个框架一个子目录
 * 7. 生成文件名 cube-export-{framework}-{timestamp}.zip
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.2
 */

import JSZip from "jszip";
import db from "../db/index.js";
import {
  buildExportIR,
  SUPPORTED_FRAMEWORKS,
  type ExportFramework,
  type ExportFile,
  type ExportIR,
} from "../../shared/export-schema.js";
import type { WorkflowOrganizationSnapshot } from "../../shared/organization-schema.js";
import { toCrewAI } from "./export-adapters/crewai.js";
import { toLangGraph } from "./export-adapters/langgraph.js";
import { toAutoGen } from "./export-adapters/autogen.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const SINGLE_FRAMEWORKS = ["crewai", "langgraph", "autogen"] as const;
type SingleFramework = (typeof SINGLE_FRAMEWORKS)[number];

const adapterMap: Record<SingleFramework, (ir: ExportIR) => ExportFile[]> = {
  crewai: toCrewAI,
  langgraph: toLangGraph,
  autogen: toAutoGen,
};

// ---------------------------------------------------------------------------
// README generation
// ---------------------------------------------------------------------------

function generateReadme(framework: ExportFramework, ir: ExportIR): string {
  const lines: string[] = [];

  lines.push(`# WhyBuddy — Export`);
  lines.push(``);
  lines.push(`> Exported from workflow \`${ir.source.workflowId}\``);
  lines.push(`> Directive: ${ir.source.directive}`);
  lines.push(`> Status: ${ir.source.status}`);
  lines.push(`> Exported at: ${ir.exportedAt}`);
  lines.push(``);

  if (framework === "all") {
    lines.push(`## Project Structure`);
    lines.push(``);
    lines.push(`This archive contains exports for **all** supported frameworks:`);
    lines.push(``);
    lines.push(`| Directory | Framework | Entry Point |`);
    lines.push(`|-----------|-----------|-------------|`);
    lines.push(`| \`crewai/\` | CrewAI | \`crew.py\` |`);
    lines.push(`| \`langgraph/\` | LangGraph | \`main.py\` |`);
    lines.push(`| \`autogen/\` | AutoGen | \`main.py\` |`);
    lines.push(``);
    lines.push(`Each subdirectory is a self-contained project. Pick the framework you prefer and follow the instructions below.`);
    lines.push(``);
  }

  // CrewAI instructions
  if (framework === "crewai" || framework === "all") {
    const prefix = framework === "all" ? "crewai/" : "";
    lines.push(`## CrewAI`);
    lines.push(``);
    lines.push("```bash");
    lines.push(`cd ${prefix || "."}`);
    lines.push(`pip install -r ${prefix}requirements.txt`);
    lines.push(`python ${prefix}crew.py`);
    lines.push("```");
    lines.push(``);
  }

  // LangGraph instructions
  if (framework === "langgraph" || framework === "all") {
    const prefix = framework === "all" ? "langgraph/" : "";
    lines.push(`## LangGraph`);
    lines.push(``);
    lines.push("```bash");
    lines.push(`cd ${prefix || "."}`);
    lines.push(`pip install -r ${prefix}requirements.txt`);
    lines.push(`python ${prefix}main.py`);
    lines.push("```");
    lines.push(``);
  }

  // AutoGen instructions
  if (framework === "autogen" || framework === "all") {
    const prefix = framework === "all" ? "autogen/" : "";
    lines.push(`## AutoGen`);
    lines.push(``);
    lines.push("```bash");
    lines.push(`cd ${prefix || "."}`);
    lines.push(`pip install -r ${prefix}requirements.txt`);
    lines.push(`python ${prefix}main.py`);
    lines.push("```");
    lines.push(``);
  }

  lines.push(`## Environment`);
  lines.push(``);
  lines.push(`- Python 3.10+`);
  lines.push(`- Set \`OPENAI_API_KEY\` (or the relevant provider key) in your environment before running.`);
  lines.push(``);
  lines.push(`## Agents (${ir.agents.length})`);
  lines.push(``);
  for (const agent of ir.agents) {
    lines.push(`- **${agent.name}** — ${agent.title} (${agent.role})`);
  }
  lines.push(``);
  lines.push(`## Pipeline (${ir.pipeline.stages.length} stages)`);
  lines.push(``);
  for (const stage of ir.pipeline.stages) {
    lines.push(`1. ${stage.label} (\`${stage.name}\`)`);
  }
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    "-",
    pad(date.getMinutes()),
    "-",
    pad(date.getSeconds()),
  ].join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function exportWorkflow(
  workflowId: string,
  framework: ExportFramework
): Promise<{ buffer: Buffer; filename: string }> {
  // --- Validate framework ---
  if (!SUPPORTED_FRAMEWORKS.includes(framework as any)) {
    throw new Error(
      `Invalid framework "${framework}". Supported: ${SUPPORTED_FRAMEWORKS.join(", ")}`
    );
  }

  // --- Read workflow from DB ---
  const workflow = db.getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  // --- Read organization snapshot from workflow results ---
  const organization = workflow.results
    ?.organization as WorkflowOrganizationSnapshot | undefined;
  if (!organization?.nodes?.length) {
    throw new Error(
      `No organization found for workflow: ${workflowId}`
    );
  }

  // --- Read tasks ---
  const tasks = db.getTasksByWorkflow(workflowId);

  // --- Build IR ---
  const ir = buildExportIR(organization, workflow, tasks);

  // --- Generate adapter files ---
  const zip = new JSZip();

  if (framework === "all") {
    // Each framework gets its own subdirectory
    for (const fw of SINGLE_FRAMEWORKS) {
      const files = adapterMap[fw](ir);
      for (const file of files) {
        zip.file(`${fw}/${file.path}`, file.content);
      }
    }
  } else {
    // Single framework: files at root
    const files = adapterMap[framework as SingleFramework](ir);
    for (const file of files) {
      zip.file(file.path, file.content);
    }
  }

  // --- Always add README.md at root ---
  const readme = generateReadme(framework, ir);
  zip.file("README.md", readme);

  // --- Generate ZIP buffer ---
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // --- Generate filename ---
  const timestamp = formatTimestamp(new Date());
  const filename = `cube-export-${framework}-${timestamp}.zip`;

  return { buffer, filename };
}
