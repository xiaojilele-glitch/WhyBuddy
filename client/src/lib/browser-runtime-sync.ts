import {
  exportBrowserRuntimeBundle,
  getMetadata,
  importBrowserRuntimeBundle,
  markRuntimeExported,
  markRuntimeImported,
  markRuntimeSynced,
  persistAIConfig,
  persistAgents,
  persistHeartbeatReports,
  persistHeartbeatSnapshot,
  persistHeartbeatStatuses,
  persistRecentMemory,
  persistSoul,
  persistWorkflowDetail,
  persistWorkflows,
  type BrowserRuntimeExportBundle,
  type BrowserRuntimeMetadata,
} from "./browser-runtime-storage";

interface AgentsResponse {
  agents: any[];
}

interface AIConfigResponse {
  config: Record<string, unknown>;
}

interface SoulResponse {
  soulMd: string;
  exists: boolean;
}

interface HeartbeatDocumentResponse {
  heartbeatMd: string;
  heartbeatConfig: any;
  keywords: any[];
  capabilities: any[];
  exists: boolean;
}

interface WorkflowsResponse {
  workflows: any[];
}

interface WorkflowDetailResponse {
  workflow: any;
  tasks: any[];
  messages: any[];
  report: any | null;
}

interface HeartbeatStatusesResponse {
  statuses: any[];
}

interface HeartbeatReportsResponse {
  reports: any[];
}

interface HeartbeatReportDetailResponse {
  report: any;
}

export interface BrowserRuntimeSyncSummary {
  agentCount: number;
  workflowCount: number;
  heartbeatReportCount: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function syncBrowserRuntimeFromServer(): Promise<BrowserRuntimeSyncSummary> {
  const aiConfig = await fetchJson<AIConfigResponse>("/api/config/ai");
  await persistAIConfig(aiConfig.config);

  const agentsResponse = await fetchJson<AgentsResponse>("/api/agents");
  const agents = agentsResponse.agents || [];
  await persistAgents(agents);

  await Promise.all(
    agents.map(async (agent) => {
      const soul = await fetchJson<SoulResponse>(`/api/agents/${agent.id}/soul`);
      await persistSoul({
        agentId: agent.id,
        soulMd: soul.soulMd,
        exists: soul.exists,
      });

      const heartbeat = await fetchJson<HeartbeatDocumentResponse>(
        `/api/agents/${agent.id}/heartbeat`
      );
      await persistHeartbeatSnapshot({
        agentId: agent.id,
        heartbeatMd: heartbeat.heartbeatMd,
        heartbeatConfig: heartbeat.heartbeatConfig,
        keywords: heartbeat.keywords || [],
        capabilities: heartbeat.capabilities || [],
        exists: heartbeat.exists,
      });

      const recentMemory = await fetchJson<{ entries: any[] }>(
        `/api/agents/${agent.id}/memory/recent?limit=50`
      );
      await persistRecentMemory(agent.id, null, recentMemory.entries || []);
    })
  );

  const workflowsResponse = await fetchJson<WorkflowsResponse>("/api/workflows");
  const workflows = workflowsResponse.workflows || [];
  await persistWorkflows(workflows);

  await Promise.all(
    workflows.map(async (workflow) => {
      const detail = await fetchJson<WorkflowDetailResponse>(`/api/workflows/${workflow.id}`);
      await persistWorkflowDetail({
        id: workflow.id,
        workflow: detail.workflow,
        tasks: detail.tasks || [],
        messages: detail.messages || [],
        report: detail.report || null,
      });
    })
  );

  const heartbeatStatuses = await fetchJson<HeartbeatStatusesResponse>("/api/reports/heartbeat/status");
  await persistHeartbeatStatuses(heartbeatStatuses.statuses || []);

  const heartbeatReportsResponse = await fetchJson<HeartbeatReportsResponse>(
    "/api/reports/heartbeat?limit=100"
  );
  const heartbeatReports = heartbeatReportsResponse.reports || [];

  const heartbeatSnapshots = await Promise.all(
    heartbeatReports.map(async (summary) => {
      try {
        const detail = await fetchJson<HeartbeatReportDetailResponse>(
          `/api/reports/heartbeat/${summary.agentId}/${summary.reportId}`
        );
        return {
          agentId: summary.agentId,
          reportId: summary.reportId,
          summary,
          detail: detail.report || null,
        };
      } catch {
        return {
          agentId: summary.agentId,
          reportId: summary.reportId,
          summary,
          detail: null,
        };
      }
    })
  );

  await persistHeartbeatReports(heartbeatSnapshots);
  await markRuntimeSynced();

  return {
    agentCount: agents.length,
    workflowCount: workflows.length,
    heartbeatReportCount: heartbeatReports.length,
  };
}

export async function loadBrowserRuntimeMetadata(): Promise<BrowserRuntimeMetadata | null> {
  return getMetadata();
}

export async function buildBrowserRuntimeExport(): Promise<{
  fileName: string;
  bundle: BrowserRuntimeExportBundle;
}> {
  const bundle = await exportBrowserRuntimeBundle();
  bundle.metadata = {
    ...bundle.metadata,
    exportedAt: bundle.exportedAt,
  };
  await markRuntimeExported(bundle.exportedAt);

  return {
    fileName: `whybuddy-browser-runtime-${bundle.exportedAt
      .replace(/[:.]/g, "-")
      .replace("T", "__")
      .replace("Z", "")}.json`,
    bundle,
  };
}

export async function restoreBrowserRuntimeFromBundle(
  bundle: BrowserRuntimeExportBundle
): Promise<void> {
  await importBrowserRuntimeBundle(bundle);
  await markRuntimeImported();
}
