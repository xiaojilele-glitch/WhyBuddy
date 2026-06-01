import { runtimeEventBus } from "./local-event-bus";
import type {
  AgentMemoryEntry,
  AgentMemorySummary,
  AgentInfo,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  RuntimeDownloadPayload,
  RuntimeEvent,
  RuntimeStateSnapshot,
  RuntimeWorkflowDetail,
  StageInfo,
  WorkflowInputAttachment,
  WorkflowInfo,
} from "./types";

const STORAGE_KEY = "whybuddy.browser-runtime.v1";

type WorkerRequestType =
  | "init"
  | "get_snapshot"
  | "get_agents"
  | "get_stages"
  | "list_workflows"
  | "get_workflow_detail"
  | "get_agent_recent_memory"
  | "search_agent_memory"
  | "get_heartbeat_statuses"
  | "get_heartbeat_reports"
  | "run_heartbeat"
  | "submit_directive"
  | "download_workflow_report"
  | "download_heartbeat_report";

interface WorkerRequest {
  requestId: string;
  type: WorkerRequestType;
  payload?: any;
}

interface WorkerResponse {
  type: "response";
  requestId: string;
  payload?: any;
  error?: string;
}

interface WorkerEventEnvelope {
  type: "runtime_event";
  event: RuntimeEvent;
}

interface WorkerPersistEnvelope {
  type: "persist_state";
  snapshot: RuntimeStateSnapshot;
}

type WorkerEnvelope =
  | WorkerResponse
  | WorkerEventEnvelope
  | WorkerPersistEnvelope;

function loadSnapshot(): RuntimeStateSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RuntimeStateSnapshot) : null;
  } catch (error) {
    console.warn("[Runtime] Failed to load local snapshot:", error);
    return null;
  }
}

function saveSnapshot(snapshot: RuntimeStateSnapshot) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[Runtime] Failed to persist local snapshot:", error);
  }
}

class LocalRuntimeClient {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private requestId = 0;

  async ensureStarted() {
    if (this.worker) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        this.worker = new Worker(
          new URL("./local-runtime-worker.ts", import.meta.url),
          { type: "module" }
        );
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = error => {
          console.error("[Runtime] Worker error:", error);
        };

        this.request("init", { snapshot: loadSnapshot() })
          .then(() => resolve())
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });

    await this.initPromise;
  }

  private handleMessage(message: WorkerEnvelope) {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.error) {
        pending.reject(new Error(message.error));
        return;
      }
      pending.resolve(message.payload);
      return;
    }

    if (message.type === "runtime_event") {
      runtimeEventBus.emit(message.event);
      return;
    }

    if (message.type === "persist_state") {
      saveSnapshot(message.snapshot);
    }
  }

  private async request<T = any>(
    type: WorkerRequestType,
    payload?: any
  ): Promise<T> {
    if (type !== "init") {
      await this.ensureStarted();
    }
    if (!this.worker) {
      throw new Error("Runtime worker is not available.");
    }

    const requestId = `req_${Date.now()}_${this.requestId++}`;
    const request: WorkerRequest = { requestId, type, payload };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage(request);
    });
  }

  getSnapshot() {
    return this.request<RuntimeStateSnapshot>("get_snapshot");
  }

  getAgents() {
    return this.request<{ agents: AgentInfo[] }>("get_agents");
  }

  getStages() {
    return this.request<{ stages: StageInfo[] }>("get_stages");
  }

  listWorkflows() {
    return this.request<{ workflows: WorkflowInfo[] }>("list_workflows");
  }

  getWorkflowDetail(id: string) {
    return this.request<RuntimeWorkflowDetail>("get_workflow_detail", { id });
  }

  getAgentRecentMemory(
    agentId: string,
    workflowId?: string | null,
    limit?: number
  ) {
    return this.request<{ entries: AgentMemoryEntry[] }>(
      "get_agent_recent_memory",
      { agentId, workflowId, limit }
    );
  }

  searchAgentMemory(agentId: string, query: string, topK?: number) {
    return this.request<{ memories: AgentMemorySummary[] }>(
      "search_agent_memory",
      { agentId, query, topK }
    );
  }

  getHeartbeatStatuses() {
    return this.request<{ statuses: HeartbeatStatusInfo[] }>(
      "get_heartbeat_statuses"
    );
  }

  getHeartbeatReports(agentId?: string | null, limit?: number) {
    return this.request<{ reports: HeartbeatReportInfo[] }>(
      "get_heartbeat_reports",
      { agentId, limit }
    );
  }

  runHeartbeat(agentId: string) {
    return this.request<{ report: HeartbeatReportInfo }>("run_heartbeat", {
      agentId,
    });
  }

  submitDirective(directive: string, attachments: WorkflowInputAttachment[] = []) {
    return this.request<{
      workflowId: string;
      missionId?: string | null;
      status: WorkflowInfo["status"];
      deduped: boolean;
    }>("submit_directive", { directive, attachments });
  }

  downloadWorkflowReport(
    workflowId: string,
    format: "json" | "md",
    managerId?: string
  ) {
    return this.request<RuntimeDownloadPayload>("download_workflow_report", {
      workflowId,
      format,
      managerId,
    });
  }

  downloadHeartbeatReport(
    agentId: string,
    reportId: string,
    format: "json" | "md"
  ) {
    return this.request<RuntimeDownloadPayload>("download_heartbeat_report", {
      agentId,
      reportId,
      format,
    });
  }
}

export const localRuntime = new LocalRuntimeClient();
