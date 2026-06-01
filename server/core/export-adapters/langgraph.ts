/**
 * LangGraph 适配器
 *
 * 将框架无关的 ExportIR 转换为 LangGraph 项目文件：
 * - graph.json: StateGraph 节点和边定义
 * - main.py: StateGraph 构建、节点处理函数、图编译运行
 * - requirements.txt: langgraph/langchain 依赖
 *
 * 纯函数，无副作用。
 */

import type { ExportIR, ExportFile, AgentDefinition } from "../../../shared/export-schema.js";

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
// graph.json
// ---------------------------------------------------------------------------

interface GraphNode {
  name: string;
  label: string;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface GraphJson {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function generateGraphJson(ir: ExportIR): string {
  const nodes: GraphNode[] = ir.pipeline.stages.map((stage) => ({
    name: toSnakeCase(stage.name),
    label: stage.label,
  }));

  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].name, to: nodes[i + 1].name });
  }

  const graph: GraphJson = { nodes, edges };
  return JSON.stringify(graph, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// 辅助：根据参与角色选择 agent
// ---------------------------------------------------------------------------

function pickAgentForStage(
  ir: ExportIR,
  participantRoles: readonly ("ceo" | "manager" | "worker")[]
): AgentDefinition | undefined {
  for (const role of participantRoles) {
    const agent = ir.agents.find((a) => a.role === role);
    if (agent) return agent;
  }
  return undefined;
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

  lines.push(`"""WhyBuddy — LangGraph Export"""`);
  lines.push(``);
  lines.push(`import json`);
  lines.push(`from typing import TypedDict, Any`);
  lines.push(``);
  lines.push(`from langgraph.graph import StateGraph, END`);
  lines.push(`from langchain_openai import ChatOpenAI`);
  lines.push(`from langchain_core.messages import SystemMessage, HumanMessage`);
  lines.push(``);
  lines.push(``);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(`# State definition`);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(``);
  lines.push(`class GraphState(TypedDict):`);
  lines.push(`    messages: list[Any]`);
  lines.push(`    current_stage: str`);
  lines.push(`    results: dict[str, Any]`);
  lines.push(``);
  lines.push(``);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(`# Node handler functions (one per agent)`);
  lines.push(`# ---------------------------------------------------------------------------`);

  // Generate a handler function for each agent
  for (const agent of ir.agents) {
    const fnName = toSnakeCase(agent.name) + "_handler";
    const systemPrompt = `Role: ${agent.title}\\nResponsibility: ${escapePyTripleQuote(agent.responsibility)}`;

    lines.push(``);
    lines.push(``);
    lines.push(`def ${fnName}(state: GraphState) -> GraphState:`);
    lines.push(`    """Handler for agent: ${agent.name}"""`);
    lines.push(`    llm = ChatOpenAI(model="${agent.model.name}", temperature=${agent.model.temperature})`);
    lines.push(`    system_prompt = "${systemPrompt}"`);
    lines.push(`    messages = [`);
    lines.push(`        SystemMessage(content=system_prompt),`);
    lines.push(`        HumanMessage(content=f"Execute stage: {state['current_stage']}"),`);
    lines.push(`    ]`);
    lines.push(`    response = llm.invoke(messages)`);
    lines.push(`    results = dict(state["results"])`);
    lines.push(`    results[state["current_stage"]] = response.content`);
    lines.push(`    return {`);
    lines.push(`        "messages": state["messages"] + [response],`);
    lines.push(`        "current_stage": state["current_stage"],`);
    lines.push(`        "results": results,`);
    lines.push(`    }`);
  }

  lines.push(``);
  lines.push(``);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(`# Stage node functions (dispatch to agent handler)`);
  lines.push(`# ---------------------------------------------------------------------------`);

  // Generate a stage node function for each pipeline stage
  for (const stage of ir.pipeline.stages) {
    const nodeFnName = `node_${toSnakeCase(stage.name)}`;
    const agent = pickAgentForStage(ir, stage.participantRoles);
    const handlerName = agent
      ? toSnakeCase(agent.name) + "_handler"
      : "lambda state: state";

    lines.push(``);
    lines.push(``);
    lines.push(`def ${nodeFnName}(state: GraphState) -> GraphState:`);
    lines.push(`    """Stage: ${stage.label}"""`);
    lines.push(`    state = dict(state)  # type: ignore[assignment]`);
    lines.push(`    state["current_stage"] = "${toSnakeCase(stage.name)}"`);
    lines.push(`    return ${handlerName}(state)`);
  }

  lines.push(``);
  lines.push(``);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(`# Graph construction`);
  lines.push(`# ---------------------------------------------------------------------------`);
  lines.push(``);
  lines.push(`def build_graph() -> StateGraph:`);
  lines.push(`    with open("graph.json", "r", encoding="utf-8") as f:`);
  lines.push(`        graph_def = json.load(f)`);
  lines.push(``);
  lines.push(`    workflow = StateGraph(GraphState)`);
  lines.push(``);

  // Map node names to their functions
  lines.push(`    node_handlers = {`);
  for (const stage of ir.pipeline.stages) {
    const key = toSnakeCase(stage.name);
    lines.push(`        "${key}": node_${key},`);
  }
  lines.push(`    }`);
  lines.push(``);

  lines.push(`    # Add nodes`);
  lines.push(`    for node in graph_def["nodes"]:`);
  lines.push(`        handler = node_handlers[node["name"]]`);
  lines.push(`        workflow.add_node(node["name"], handler)`);
  lines.push(``);

  lines.push(`    # Add edges`);
  lines.push(`    for edge in graph_def["edges"]:`);
  lines.push(`        workflow.add_edge(edge["from"], edge["to"])`);
  lines.push(``);

  // Set entry point and finish point
  if (ir.pipeline.stages.length > 0) {
    const firstStage = toSnakeCase(ir.pipeline.stages[0].name);
    const lastStage = toSnakeCase(ir.pipeline.stages[ir.pipeline.stages.length - 1].name);
    lines.push(`    # Set entry and finish`);
    lines.push(`    workflow.set_entry_point("${firstStage}")`);
    lines.push(`    workflow.add_edge("${lastStage}", END)`);
  }

  lines.push(``);
  lines.push(`    return workflow`);
  lines.push(``);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    graph = build_graph()`);
  lines.push(`    app = graph.compile()`);
  lines.push(`    initial_state: GraphState = {`);
  lines.push(`        "messages": [],`);
  lines.push(`        "current_stage": "",`);
  lines.push(`        "results": {},`);
  lines.push(`    }`);
  lines.push(`    result = app.invoke(initial_state)`);
  lines.push(`    print(result)`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// requirements.txt
// ---------------------------------------------------------------------------

function generateRequirementsTxt(): string {
  return [
    "langgraph>=0.0.26",
    "langchain>=0.1.0",
    "langchain-openai>=0.0.5",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

export function toLangGraph(ir: ExportIR): ExportFile[] {
  return [
    {
      path: "graph.json",
      content: generateGraphJson(ir),
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
