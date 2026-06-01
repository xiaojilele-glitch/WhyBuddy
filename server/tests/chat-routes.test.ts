import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { buildMonitoringSessionDetail } from "../core/aigc-monitoring-projection.js";
import { createChatRouter } from "../routes/chat.js";
import type {
  ChatNodeMessageStore,
  ChatNodeSessionStore,
} from "../routes/node-adapters/chat-node-adapter.js";

async function withServer(
  deps: {
    messageStore?: ChatNodeMessageStore;
    sessionStore?: ChatNodeSessionStore;
  } = {},
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/chat",
    createChatRouter({
      getConfig: () => ({
        apiKey: "",
        baseUrl: "https://example.test/v1",
        model: "mock-model",
        modelReasoningEffort: "medium",
        maxContext: 128000,
        providerName: "example.test",
        wireApi: "chat_completions",
        timeoutMs: 1000,
        stream: false,
      }),
      executeLLM: async (messages, _options) => ({
        content: `mock:${messages[messages.length - 1]?.content ?? ""}`,
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
      }),
      now: (() => {
        let current = 100;
        return () => {
          current += 25;
          return current;
        };
      })(),
      ...deps,
    }),
  );

  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("POST /api/chat", () => {
  it("keeps legacy chat route working", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.content).toBe("mock:hello");
      expect(body.model).toBe("mock-model");
    });
  });
});

describe("POST /api/chat/nodes/execute", () => {
  it("executes llm nodes with normalized output", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "llm",
          input: {
            systemPrompt: "You are helpful.",
            prompt: "Summarize this",
            context: {
              source: "knowledge",
              snippets: ["A", "B"],
            },
            variables: {
              projectId: "proj-1",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.nodeType).toBe("llm");
      expect(body.output.content).toBe("mock:Summarize this");
      expect(body.output.reply.content).toBe("mock:Summarize this");
      expect(body.output.model).toBe("mock-model");
      expect(body.output.messages).toHaveLength(2);
      expect(body.output.messages[0].role).toBe("system");
      expect(body.output.messages[1].role).toBe("user");
      expect(body.output.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  it("rejects node execution when prompt and messages are missing", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dialogue",
          input: {},
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("prompt or messages");
    });
  });

  it("persists dialogue messages and session exchanges for workflow-linked execution", async () => {
    const storedMessages: Array<{
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }> = [];
    const sessionExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    await withServer(
      {
        messageStore: {
          createMessage(message) {
            storedMessages.push(message);
            return { id: storedMessages.length, created_at: "2026-04-22T00:00:00.000Z" };
          },
        },
        sessionStore: {
          appendLLMExchange(agentId, options) {
            sessionExchanges.push({ agentId, ...options });
          },
        },
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "dialogue",
            input: {
              workflowId: "wf-dialogue-1",
              sessionId: "session-1",
              missionId: "mission-1",
              agentId: "dialogue-agent-1",
              stage: "dialogue_runtime",
              prompt: "请总结今天的会话重点",
              context: {
                source: "operator",
                summary: "用户刚上传了一段工单摘要",
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.nodeType).toBe("dialogue");
        expect(body.output.content).toBe("mock:请总结今天的会话重点");
        expect(body.output.observability).toEqual({
          workflowId: "wf-dialogue-1",
          sessionId: "session-1",
          missionId: "mission-1",
          agentId: "dialogue-agent-1",
          stage: "dialogue_runtime",
          persistedToWorkflow: true,
          persistedToSession: true,
        });
      },
    );

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: "wf-dialogue-1",
      from_agent: "workflow-user",
      to_agent: "dialogue-agent-1",
      stage: "dialogue_runtime",
      content: "请总结今天的会话重点",
    });
    expect(storedMessages[1]).toMatchObject({
      workflow_id: "wf-dialogue-1",
      from_agent: "dialogue-agent-1",
      to_agent: "workflow-user",
      stage: "dialogue_runtime",
      content: "mock:请总结今天的会话重点",
    });

    expect(sessionExchanges).toHaveLength(1);
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-1",
      workflowId: "wf-dialogue-1",
      stage: "dialogue_runtime",
      prompt: "请总结今天的会话重点",
      response: "mock:请总结今天的会话重点",
    });
  });

  it("surfaces dialogue citations, tool calls, and thinking in monitoring-ready metadata", async () => {
    const storedMessages: Array<{
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }> = [];
    const sessionExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    await withServer(
      {
        messageStore: {
          createMessage(message) {
            storedMessages.push(message);
            return { id: storedMessages.length, created_at: "2026-04-22T00:00:00.000Z" };
          },
        },
        sessionStore: {
          appendLLMExchange(agentId, options) {
            sessionExchanges.push({ agentId, ...options });
          },
        },
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "dialogue",
            input: {
              workflowId: "wf-dialogue-2",
              sessionId: "session-2",
              missionId: "mission-2",
              agentId: "dialogue-agent-2",
              stage: "dialogue_enhanced",
              messages: [
                { role: "user", content: "请基于检索结果回答" },
              ],
              citations: ["知识库#A", "知识库#B"],
              toolCalls: [
                {
                  name: "document_search",
                  arguments: { query: "会话总结" },
                  result: "命中 2 条文档片段",
                },
              ],
              thinking: "优先引用最近一次检索结果，再补充执行建议。",
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.output.messages[0].content).toContain("Retrieved citations");
        expect(body.output.messages[0].content).toContain("Tool results");
        expect(body.output.observability).toMatchObject({
          persistedToWorkflow: true,
          persistedToSession: true,
          citations: ["知识库#A", "知识库#B"],
          toolCalls: [
            {
              name: "document_search",
              arguments: '{\n  "query": "会话总结"\n}',
              result: "命中 2 条文档片段",
            },
          ],
          thinking: "优先引用最近一次检索结果，再补充执行建议。",
        });
      },
    );

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages[1]?.metadata).toMatchObject({
      nodeType: "dialogue",
      sessionId: "session-2",
      missionId: "mission-2",
      agentId: "dialogue-agent-2",
      stage: "dialogue_enhanced",
      thinking: "优先引用最近一次检索结果，再补充执行建议。",
      citations: ["知识库#A", "知识库#B"],
      toolCalls: [
        {
          name: "document_search",
          arguments: '{\n  "query": "会话总结"\n}',
          result: "命中 2 条文档片段",
        },
      ],
    });
    expect(sessionExchanges[0]?.metadata).toMatchObject(storedMessages[1]?.metadata ?? {});

    const monitoringDetail = buildMonitoringSessionDetail({
      workflow: {
        id: "wf-dialogue-2",
        directive: "测试对话节点监控投影",
        status: "running",
        current_stage: "dialogue_enhanced",
        departments_involved: [],
        started_at: "2026-04-22T00:00:00.000Z",
        completed_at: null,
        results: {
          input: {
            sessionId: "session-2",
            sourceApp: "whybuddy",
          },
        },
        created_at: "2026-04-22T00:00:00.000Z",
      },
      messages: storedMessages.map((message, index) => ({
        id: index + 1,
        workflow_id: message.workflow_id,
        from_agent: message.from_agent,
        to_agent: message.to_agent,
        stage: message.stage,
        content: message.content,
        metadata: message.metadata,
        created_at: `2026-04-22T00:00:0${index}.000Z`,
      })),
    });

    expect(monitoringDetail.messages).toHaveLength(2);
    expect(monitoringDetail.messages[1]).toMatchObject({
      role: "assistant",
      content: "mock:请基于检索结果回答",
      thinking: "优先引用最近一次检索结果，再补充执行建议。",
      citations: ["知识库#A", "知识库#B"],
      toolCalls: [
        {
          name: "document_search",
          arguments: '{\n  "query": "会话总结"\n}',
          result: "命中 2 条文档片段",
        },
      ],
    });
  });
});
