/**
 * CrewAI 适配器
 *
 * 将框架无关的 ExportIR 转换为 CrewAI 项目文件：
 * - agents.yaml: Agent 定义（role / goal / backstory）
 * - tasks.yaml: Task 定义（description / expected_output / agent）
 * - crew.py: Crew 类、agent 实例化、task 编排
 * - requirements.txt: crewai 依赖
 *
 * 纯函数，无副作用。
 */

import type { ExportIR, ExportFile, AgentDefinition, SkillDefinition } from "../../../shared/export-schema.js";

// ---------------------------------------------------------------------------
// 辅助：将字符串转为 snake_case 标识符
// ---------------------------------------------------------------------------

function toSnakeCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    || "unnamed";
}

// ---------------------------------------------------------------------------
// 辅助：YAML 安全转义（多行用 |，单行用引号）
// ---------------------------------------------------------------------------

function yamlScalar(value: string, indent: number): string {
  if (value.includes("\n")) {
    const pad = " ".repeat(indent);
    return `|\n${value
      .split("\n")
      .map((line) => `${pad}${line}`)
      .join("\n")}`;
  }
  // 如果包含特殊字符，用双引号包裹
  if (/[:#{}[\],&*?|>!'"%@`]/.test(value) || value.trim() !== value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 构建 skill 查找表
// ---------------------------------------------------------------------------

function buildSkillMap(skills: SkillDefinition[]): Map<string, SkillDefinition> {
  const map = new Map<string, SkillDefinition>();
  for (const skill of skills) {
    map.set(skill.id, skill);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 生成 backstory：title + goals + skill prompts
// ---------------------------------------------------------------------------

function buildBackstory(
  agent: AgentDefinition,
  skillMap: Map<string, SkillDefinition>
): string {
  const parts: string[] = [];

  parts.push(agent.title);

  if (agent.goals.length > 0) {
    parts.push(`Goals: ${agent.goals.join("; ")}`);
  }

  // 嵌入 skill prompts（Requirement 2.5）
  const skillPrompts = agent.skillIds
    .map((id) => skillMap.get(id))
    .filter((s): s is SkillDefinition => s != null)
    .map((s) => s.prompt);

  if (skillPrompts.length > 0) {
    parts.push(`Skills:\n${skillPrompts.join("\n")}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// agents.yaml
// ---------------------------------------------------------------------------

function generateAgentsYaml(ir: ExportIR): string {
  const skillMap = buildSkillMap(ir.skills);
  const lines: string[] = [];

  for (const agent of ir.agents) {
    const key = toSnakeCase(agent.name);
    const backstory = buildBackstory(agent, skillMap);

    lines.push(`${key}:`);
    lines.push(`  role: ${yamlScalar(agent.title, 4)}`);
    lines.push(`  goal: ${yamlScalar(agent.responsibility, 4)}`);
    lines.push(`  backstory: ${yamlScalar(backstory, 4)}`);
    lines.push(`  verbose: true`);
    lines.push(`  allow_delegation: ${agent.role !== "worker"}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// tasks.yaml
// ---------------------------------------------------------------------------

function generateTasksYaml(ir: ExportIR): string {
  const lines: string[] = [];
  // 选择第一个 agent 作为默认 agent 引用
  const defaultAgentKey =
    ir.agents.length > 0 ? toSnakeCase(ir.agents[0].name) : "default_agent";

  for (const stage of ir.pipeline.stages) {
    const taskKey = toSnakeCase(stage.name);

    // 根据参与角色选择最匹配的 agent
    const agentKey = pickAgentForStage(ir, stage.participantRoles) ?? defaultAgentKey;

    lines.push(`${taskKey}:`);
    lines.push(`  description: ${yamlScalar(`Execute the ${stage.label} stage: ${stage.name}`, 4)}`);
    lines.push(`  expected_output: ${yamlScalar(`Completed ${stage.label} stage output`, 4)}`);
    lines.push(`  agent: ${agentKey}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 辅助：根据参与角色选择 agent
// ---------------------------------------------------------------------------

function pickAgentForStage(
  ir: ExportIR,
  participantRoles: readonly ("ceo" | "manager" | "worker")[]
): string | undefined {
  // 优先匹配第一个角色
  for (const role of participantRoles) {
    const agent = ir.agents.find((a) => a.role === role);
    if (agent) return toSnakeCase(agent.name);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// crew.py
// ---------------------------------------------------------------------------

function generateCrewPy(ir: ExportIR): string {
  const agentKeys = ir.agents.map((a) => toSnakeCase(a.name));
  const taskKeys = ir.pipeline.stages.map((s) => toSnakeCase(s.name));

  // 判断 process 类型：如果有 team 且 strategy 包含 parallel → hierarchical
  const hasHierarchical = ir.teams.some((t) => t.strategy === "parallel");
  const process = hasHierarchical ? "hierarchical" : "sequential";

  const lines: string[] = [];

  lines.push(`"""WhyBuddy — CrewAI Export"""`);
  lines.push(``);
  lines.push(`import yaml`);
  lines.push(`from crewai import Agent, Task, Crew, Process`);
  lines.push(``);
  lines.push(``);
  lines.push(`def load_yaml(path: str):`);
  lines.push(`    with open(path, "r", encoding="utf-8") as f:`);
  lines.push(`        return yaml.safe_load(f)`);
  lines.push(``);
  lines.push(``);
  lines.push(`def build_crew() -> Crew:`);
  lines.push(`    agents_cfg = load_yaml("agents.yaml")`);
  lines.push(`    tasks_cfg = load_yaml("tasks.yaml")`);
  lines.push(``);

  // Agent 实例化
  lines.push(`    # --- Agents ---`);
  for (const key of agentKeys) {
    lines.push(`    ${key} = Agent(**agents_cfg["${key}"])`);
  }
  lines.push(``);

  // Task 实例化
  lines.push(`    # --- Tasks ---`);
  lines.push(`    agent_map = {${agentKeys.map((k) => `"${k}": ${k}`).join(", ")}}`);
  lines.push(`    tasks = []`);
  for (const key of taskKeys) {
    lines.push(`    _t_cfg = tasks_cfg["${key}"]`);
    lines.push(`    _t_cfg["agent"] = agent_map[_t_cfg["agent"]]`);
    lines.push(`    tasks.append(Task(**_t_cfg))`);
  }
  lines.push(``);

  // Crew
  lines.push(`    crew = Crew(`);
  lines.push(`        agents=[${agentKeys.join(", ")}],`);
  lines.push(`        tasks=tasks,`);
  lines.push(`        process=Process.${process},`);
  lines.push(`        verbose=True,`);
  lines.push(`    )`);
  lines.push(`    return crew`);
  lines.push(``);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    crew = build_crew()`);
  lines.push(`    result = crew.kickoff()`);
  lines.push(`    print(result)`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// requirements.txt
// ---------------------------------------------------------------------------

function generateRequirementsTxt(): string {
  return ["crewai>=0.28.0", "crewai-tools>=0.1.0", "pyyaml>=6.0", ""].join("\n");
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

export function toCrewAI(ir: ExportIR): ExportFile[] {
  return [
    {
      path: "agents.yaml",
      content: generateAgentsYaml(ir),
      language: "yaml",
    },
    {
      path: "tasks.yaml",
      content: generateTasksYaml(ir),
      language: "yaml",
    },
    {
      path: "crew.py",
      content: generateCrewPy(ir),
      language: "python",
    },
    {
      path: "requirements.txt",
      content: generateRequirementsTxt(),
      language: "toml",
    },
  ];
}
