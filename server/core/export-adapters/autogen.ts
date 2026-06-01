/**
 * AutoGen 适配器
 *
 * 将框架无关的 ExportIR 转换为 AutoGen 项目文件：
 * - agents.json: Agent 配置（name / system_message / llm_config）
 * - group_chat.json: GroupChat 配置（agents / max_round / speaker_selection_method）
 * - main.py: agent 实例化、GroupChat 创建、对话启动
 * - requirements.txt: pyautogen 依赖
 *
 * 纯函数，无副作用。
 */

import type {
  ExportIR,
  ExportFile,
  AgentDefinition,
  SkillDefinition,
  TeamDefinition,
} from "../../../shared/export-schema.js";

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
// 生成 system_message：title + responsibility + goals + skill prompts
// ---------------------------------------------------------------------------

function buildSystemMessage(
  agent: AgentDefinition,
  skillMap: Map<string, SkillDefinition>,
): string {
  const parts: string[] = [];

  parts.push(`You are ${agent.title}.`);
  parts.push(`Responsibility: ${agent.responsibility}`);

  if (agent.goals.length > 0) {
    parts.push(`Goals: ${agent.goals.join("; ")}`);
  }

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
// agents.json
// ---------------------------------------------------------------------------

interface AutoGenAgentEntry {
  name: string;
  system_message: string;
  llm_config: {
    model: string;
    temperature: number;
  };
  human_input_mode: "NEVER";
}

function generateAgentsJson(ir: ExportIR): string {
  const skillMap = buildSkillMap(ir.skills);

  const agents: Record<string, AutoGenAgentEntry> = {};
  for (const agent of ir.agents) {
    const key = toSnakeCase(agent.name);
    agents[key] = {
      name: agent.name,
      system_message: buildSystemMessage(agent, skillMap),
      llm_config: {
        model: agent.model.name,
        temperature: agent.model.temperature,
      },
      human_input_mode: "NEVER",
    };
  }

  return JSON.stringify(agents, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// group_chat.json
// ---------------------------------------------------------------------------

interface AutoGenGroupChatEntry {
  agents: string[];
  max_round: number;
  speaker_selection_method: "auto" | "round_robin";
}

function generateGroupChatJson(ir: ExportIR): string {
  const groupChats: Record<string, AutoGenGroupChatEntry> = {};

  for (const team of ir.teams) {
    const key = toSnakeCase(team.label);
    const memberKeys = team.memberAgentIds.map((agentId) => {
      const agent = ir.agents.find((a) => a.id === agentId);
      return agent ? toSnakeCase(agent.name) : toSnakeCase(agentId);
    });

    // max_round based on pipeline stages count
    const maxRound = ir.pipeline.stages.length;

    // speaker_selection_method based on team strategy
    const selectionMethod: "auto" | "round_robin" =
      team.strategy === "sequential" ? "round_robin" : "auto";

    groupChats[key] = {
      agents: memberKeys,
      max_round: maxRound,
      speaker_selection_method: selectionMethod,
    };
  }

  return JSON.stringify(groupChats, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// 辅助：Python 字符串转义（用于三引号内的文本）
// ---------------------------------------------------------------------------

function escapePyTripleQuote(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

// ---------------------------------------------------------------------------
// main.py
// ---------------------------------------------------------------------------

function generateMainPy(ir: ExportIR): string {
  const lines: string[] = [];
  const agentKeys = ir.agents.map((a) => toSnakeCase(a.name));
  const teamKeys = ir.teams.map((t) => toSnakeCase(t.label));

  lines.push(`"""WhyBuddy — AutoGen Export"""`);
  lines.push(``);
  lines.push(`import json`);
  lines.push(``);
  lines.push(`import autogen`);
  lines.push(``);
  lines.push(``);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(`# Load configurations`);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(``);
  lines.push(`def load_json(path: str):`);
  lines.push(`    with open(path, "r", encoding="utf-8") as f:`);
  lines.push(`        return json.load(f)`);
  lines.push(``);
  lines.push(``);
  lines.push(`def main():`);
  lines.push(`    agents_cfg = load_json("agents.json")`);
  lines.push(`    group_chat_cfg = load_json("group_chat.json")`);
  lines.push(``);

  // Agent instantiation
  lines.push(`    # --- Agent instantiation ---`);
  for (const key of agentKeys) {
    lines.push(`    ${key} = autogen.AssistantAgent(`);
    lines.push(`        name=agents_cfg["${key}"]["name"],`);
    lines.push(`        system_message=agents_cfg["${key}"]["system_message"],`);
    lines.push(`        llm_config={"config_list": [agents_cfg["${key}"]["llm_config"]]},`);
    lines.push(`    )`);
    lines.push(``);
  }

  // User proxy for initiating conversation
  lines.push(`    # --- User proxy (initiates conversation) ---`);
  lines.push(`    user_proxy = autogen.UserProxyAgent(`);
  lines.push(`        name="user_proxy",`);
  lines.push(`        human_input_mode="NEVER",`);
  lines.push(`        max_consecutive_auto_reply=0,`);
  lines.push(`    )`);
  lines.push(``);

  // Agent lookup map
  lines.push(`    agent_map = {`);
  for (const key of agentKeys) {
    lines.push(`        "${key}": ${key},`);
  }
  lines.push(`    }`);
  lines.push(``);

  // GroupChat creation
  lines.push(`    # --- GroupChat creation ---`);
  for (const teamKey of teamKeys) {
    lines.push(`    gc_cfg_${teamKey} = group_chat_cfg["${teamKey}"]`);
    lines.push(`    gc_agents_${teamKey} = [user_proxy] + [`);
    lines.push(`        agent_map[a] for a in gc_cfg_${teamKey}["agents"] if a in agent_map`);
    lines.push(`    ]`);
    lines.push(`    group_chat_${teamKey} = autogen.GroupChat(`);
    lines.push(`        agents=gc_agents_${teamKey},`);
    lines.push(`        max_round=gc_cfg_${teamKey}["max_round"],`);
    lines.push(`        speaker_selection_method=gc_cfg_${teamKey}.get("speaker_selection_method", "auto"),`);
    lines.push(`    )`);
    lines.push(`    manager_${teamKey} = autogen.GroupChatManager(`);
    lines.push(`        groupchat=group_chat_${teamKey},`);
    lines.push(`    )`);
    lines.push(``);
  }

  // Initiate conversation
  lines.push(`    # --- Start conversation ---`);
  if (teamKeys.length > 0) {
    lines.push(`    user_proxy.initiate_chat(`);
    lines.push(`        manager_${teamKeys[0]},`);
    lines.push(`        message="Begin the workflow execution.",`);
    lines.push(`    )`);
  } else if (agentKeys.length > 0) {
    // Fallback: no teams, just chat with first agent
    lines.push(`    user_proxy.initiate_chat(`);
    lines.push(`        ${agentKeys[0]},`);
    lines.push(`        message="Begin the workflow execution.",`);
    lines.push(`    )`);
  }

  lines.push(``);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    main()`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// requirements.txt
// ---------------------------------------------------------------------------

function generateRequirementsTxt(): string {
  return ["pyautogen>=0.2.0", ""].join("\n");
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

export function toAutoGen(ir: ExportIR): ExportFile[] {
  return [
    {
      path: "agents.json",
      content: generateAgentsJson(ir),
      language: "json",
    },
    {
      path: "group_chat.json",
      content: generateGroupChatJson(ir),
      language: "json",
    },
    {
      path: "main.py",
      content: generateMainPy(ir),
      language: "python",
    },
    {
      path: "requirements.txt",
      content: generateRequirementsTxt(),
      language: "toml",
    },
  ];
}
