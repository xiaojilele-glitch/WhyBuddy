import type { SnapshotRecord } from "../../../shared/mission/contracts";

const DB_NAME = "whybuddy-browser-runtime";
const DB_VERSION = 2;

const STORE_NAMES = {
  meta: "meta",
  aiConfig: "aiConfig",
  agents: "agents",
  souls: "souls",
  heartbeats: "heartbeats",
  workflows: "workflows",
  workflowDetails: "workflowDetails",
  agentRecentMemory: "agentRecentMemory",
  agentMemorySearch: "agentMemorySearch",
  heartbeatStatuses: "heartbeatStatuses",
  heartbeatReports: "heartbeatReports",
  snapshots: "snapshots",
} as const;

type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

interface MetaRecord {
  key: "metadata";
  value: BrowserRuntimeMetadata;
}

interface AIConfigRecord {
  key: "ai_config";
  value: Record<string, unknown>;
  capturedAt: string;
}

export interface BrowserRuntimeMetadata {
  schemaVersion: number;
  source: "server-mirror" | "import";
  lastSyncedAt: string | null;
  importedAt: string | null;
  exportedAt: string | null;
}

export interface BrowserSoulSnapshot {
  agentId: string;
  soulMd: string;
  exists: boolean;
  cachedAt: string;
}

export interface BrowserHeartbeatSnapshot {
  agentId: string;
  heartbeatMd: string;
  heartbeatConfig: any;
  keywords: any[];
  capabilities: any[];
  exists: boolean;
  cachedAt: string;
}

export interface BrowserWorkflowDetailSnapshot {
  id: string;
  workflow: any;
  tasks: any[];
  messages: any[];
  report: any | null;
  cachedAt: string;
}

export interface BrowserRecentMemorySnapshot {
  id: string;
  agentId: string;
  workflowId: string | null;
  entries: any[];
  cachedAt: string;
}

export interface BrowserMemorySearchSnapshot {
  id: string;
  agentId: string;
  query: string;
  results: any[];
  cachedAt: string;
}

export interface BrowserHeartbeatReportSnapshot {
  id: string;
  agentId: string;
  reportId: string;
  summary: any;
  detail: any | null;
  cachedAt: string;
}

export interface BrowserRuntimeExportBundle {
  kind: "whybuddy-browser-runtime";
  schemaVersion: number;
  exportedAt: string;
  metadata: BrowserRuntimeMetadata;
  aiConfig: AIConfigRecord | null;
  agents: any[];
  souls: BrowserSoulSnapshot[];
  heartbeats: BrowserHeartbeatSnapshot[];
  workflows: any[];
  workflowDetails: BrowserWorkflowDetailSnapshot[];
  agentRecentMemory: BrowserRecentMemorySnapshot[];
  agentMemorySearch: BrowserMemorySearchSnapshot[];
  heartbeatStatuses: any[];
  heartbeatReports: BrowserHeartbeatReportSnapshot[];
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function createDefaultMetadata(
  source: BrowserRuntimeMetadata["source"] = "server-mirror"
): BrowserRuntimeMetadata {
  return {
    schemaVersion: DB_VERSION,
    source,
    lastSyncedAt: null,
    importedAt: null,
    exportedAt: null,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function openDatabase(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    throw new Error("IndexedDB is not available in this browser.");
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAMES.meta)) {
          db.createObjectStore(STORE_NAMES.meta, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.aiConfig)) {
          db.createObjectStore(STORE_NAMES.aiConfig, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.agents)) {
          db.createObjectStore(STORE_NAMES.agents, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.souls)) {
          db.createObjectStore(STORE_NAMES.souls, { keyPath: "agentId" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.heartbeats)) {
          db.createObjectStore(STORE_NAMES.heartbeats, { keyPath: "agentId" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.workflows)) {
          db.createObjectStore(STORE_NAMES.workflows, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.workflowDetails)) {
          db.createObjectStore(STORE_NAMES.workflowDetails, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.agentRecentMemory)) {
          db.createObjectStore(STORE_NAMES.agentRecentMemory, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.agentMemorySearch)) {
          db.createObjectStore(STORE_NAMES.agentMemorySearch, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.heartbeatStatuses)) {
          db.createObjectStore(STORE_NAMES.heartbeatStatuses, { keyPath: "agentId" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.heartbeatReports)) {
          db.createObjectStore(STORE_NAMES.heartbeatReports, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.snapshots)) {
          const snapshotStore = db.createObjectStore(STORE_NAMES.snapshots, { keyPath: "id" });
          snapshotStore.createIndex("missionId", "missionId", { unique: false });
          snapshotStore.createIndex("createdAt", "createdAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function readAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const result = await requestToPromise(store.getAll() as IDBRequest<T[]>);
  await transactionToPromise(transaction);
  return result;
}

async function readOne<T>(storeName: StoreName, key: IDBValidKey): Promise<T | null> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const result = await requestToPromise(store.get(key) as IDBRequest<T | undefined>);
  await transactionToPromise(transaction);
  return result ?? null;
}

async function writeMany<T>(storeName: StoreName, rows: T[]): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const row of rows) {
    store.put(row);
  }
  await transactionToPromise(transaction);
}

async function writeOne<T>(storeName: StoreName, row: T): Promise<void> {
  return writeMany(storeName, [row]);
}

async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).clear();
  await transactionToPromise(transaction);
}

function recentMemoryKey(agentId: string, workflowId?: string | null): string {
  return `${agentId}::${workflowId || "_general"}`;
}

function memorySearchKey(agentId: string, query: string): string {
  return `${agentId}::${query.trim().toLowerCase()}`;
}

function heartbeatReportKey(agentId: string, reportId: string): string {
  return `${agentId}::${reportId}`;
}

async function upsertMetadata(
  patch: Partial<BrowserRuntimeMetadata>,
  source: BrowserRuntimeMetadata["source"] = "server-mirror"
): Promise<BrowserRuntimeMetadata> {
  const existing = await getMetadata();
  const next: BrowserRuntimeMetadata = {
    ...(existing || createDefaultMetadata(source)),
    ...patch,
    schemaVersion: DB_VERSION,
    source,
  };

  await writeOne<MetaRecord>(STORE_NAMES.meta, {
    key: "metadata",
    value: next,
  });

  return next;
}

export async function getMetadata(): Promise<BrowserRuntimeMetadata | null> {
  const record = await readOne<MetaRecord>(STORE_NAMES.meta, "metadata");
  return record?.value || null;
}

export async function markRuntimeSynced(at: string = new Date().toISOString()): Promise<void> {
  await upsertMetadata({ lastSyncedAt: at }, "server-mirror");
}

export async function markRuntimeImported(at: string = new Date().toISOString()): Promise<void> {
  await upsertMetadata({ importedAt: at }, "import");
}

export async function markRuntimeExported(at: string = new Date().toISOString()): Promise<void> {
  await upsertMetadata({ exportedAt: at });
}

export async function persistAIConfig(config: Record<string, unknown>): Promise<void> {
  await writeOne<AIConfigRecord>(STORE_NAMES.aiConfig, {
    key: "ai_config",
    value: config,
    capturedAt: new Date().toISOString(),
  });
}

export async function getAIConfigSnapshot(): Promise<Record<string, unknown> | null> {
  const record = await readOne<AIConfigRecord>(STORE_NAMES.aiConfig, "ai_config");
  return record?.value || null;
}

export async function persistAgents(agents: any[]): Promise<void> {
  await clearStore(STORE_NAMES.agents);
  await writeMany(
    STORE_NAMES.agents,
    agents.map((agent) => ({
      ...agent,
      cachedAt: new Date().toISOString(),
    }))
  );
}

export async function getAgentsSnapshot(): Promise<any[]> {
  return readAll<any>(STORE_NAMES.agents);
}

export async function persistSoul(snapshot: Omit<BrowserSoulSnapshot, "cachedAt">): Promise<void> {
  await writeOne<BrowserSoulSnapshot>(STORE_NAMES.souls, {
    ...snapshot,
    cachedAt: new Date().toISOString(),
  });
}

export async function getSoulSnapshot(agentId: string): Promise<BrowserSoulSnapshot | null> {
  return readOne<BrowserSoulSnapshot>(STORE_NAMES.souls, agentId);
}

export async function persistHeartbeatSnapshot(
  snapshot: Omit<BrowserHeartbeatSnapshot, "cachedAt">
): Promise<void> {
  await writeOne<BrowserHeartbeatSnapshot>(STORE_NAMES.heartbeats, {
    ...snapshot,
    cachedAt: new Date().toISOString(),
  });
}

export async function getHeartbeatSnapshot(
  agentId: string
): Promise<BrowserHeartbeatSnapshot | null> {
  return readOne<BrowserHeartbeatSnapshot>(STORE_NAMES.heartbeats, agentId);
}

export async function persistWorkflows(workflows: any[]): Promise<void> {
  await clearStore(STORE_NAMES.workflows);
  await writeMany(
    STORE_NAMES.workflows,
    workflows.map((workflow) => ({
      ...workflow,
      cachedAt: new Date().toISOString(),
    }))
  );
}

export async function getWorkflowsSnapshot(): Promise<any[]> {
  return readAll<any>(STORE_NAMES.workflows);
}

export async function persistWorkflowDetail(
  snapshot: Omit<BrowserWorkflowDetailSnapshot, "cachedAt">
): Promise<void> {
  await writeOne<BrowserWorkflowDetailSnapshot>(STORE_NAMES.workflowDetails, {
    ...snapshot,
    cachedAt: new Date().toISOString(),
  });
}

export async function getWorkflowDetailSnapshot(
  workflowId: string
): Promise<BrowserWorkflowDetailSnapshot | null> {
  return readOne<BrowserWorkflowDetailSnapshot>(STORE_NAMES.workflowDetails, workflowId);
}

export async function persistRecentMemory(
  agentId: string,
  workflowId: string | null,
  entries: any[]
): Promise<void> {
  await writeOne<BrowserRecentMemorySnapshot>(STORE_NAMES.agentRecentMemory, {
    id: recentMemoryKey(agentId, workflowId),
    agentId,
    workflowId,
    entries,
    cachedAt: new Date().toISOString(),
  });
}

export async function getRecentMemorySnapshot(
  agentId: string,
  workflowId: string | null = null
): Promise<BrowserRecentMemorySnapshot | null> {
  return readOne<BrowserRecentMemorySnapshot>(
    STORE_NAMES.agentRecentMemory,
    recentMemoryKey(agentId, workflowId)
  );
}

export async function persistMemorySearch(
  agentId: string,
  query: string,
  results: any[]
): Promise<void> {
  await writeOne<BrowserMemorySearchSnapshot>(STORE_NAMES.agentMemorySearch, {
    id: memorySearchKey(agentId, query),
    agentId,
    query,
    results,
    cachedAt: new Date().toISOString(),
  });
}

export async function getMemorySearchSnapshot(
  agentId: string,
  query: string
): Promise<BrowserMemorySearchSnapshot | null> {
  return readOne<BrowserMemorySearchSnapshot>(
    STORE_NAMES.agentMemorySearch,
    memorySearchKey(agentId, query)
  );
}

export async function persistHeartbeatStatuses(statuses: any[]): Promise<void> {
  await clearStore(STORE_NAMES.heartbeatStatuses);
  await writeMany(
    STORE_NAMES.heartbeatStatuses,
    statuses.map((status) => ({
      ...status,
      cachedAt: new Date().toISOString(),
    }))
  );
}

export async function getHeartbeatStatusesSnapshot(): Promise<any[]> {
  return readAll<any>(STORE_NAMES.heartbeatStatuses);
}

export async function persistHeartbeatReports(
  reports: Array<{
    agentId: string;
    reportId: string;
    summary: any;
    detail?: any | null;
  }>
): Promise<void> {
  const rows = reports.map((report) => ({
    id: heartbeatReportKey(report.agentId, report.reportId),
    agentId: report.agentId,
    reportId: report.reportId,
    summary: report.summary,
    detail: report.detail ?? null,
    cachedAt: new Date().toISOString(),
  }));

  await writeMany<BrowserHeartbeatReportSnapshot>(STORE_NAMES.heartbeatReports, rows);
}

export async function getHeartbeatReportsSnapshot(
  agentId?: string | null
): Promise<BrowserHeartbeatReportSnapshot[]> {
  const reports = await readAll<BrowserHeartbeatReportSnapshot>(STORE_NAMES.heartbeatReports);
  const filtered = agentId ? reports.filter((item) => item.agentId === agentId) : reports;
  return filtered.sort(
    (left, right) =>
      new Date(right.summary?.generatedAt || 0).getTime() -
      new Date(left.summary?.generatedAt || 0).getTime()
  );
}

export async function exportBrowserRuntimeBundle(): Promise<BrowserRuntimeExportBundle> {
  const metadata = (await getMetadata()) || createDefaultMetadata();

  return {
    kind: "whybuddy-browser-runtime",
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    metadata,
    aiConfig: await readOne<AIConfigRecord>(STORE_NAMES.aiConfig, "ai_config"),
    agents: await getAgentsSnapshot(),
    souls: await readAll<BrowserSoulSnapshot>(STORE_NAMES.souls),
    heartbeats: await readAll<BrowserHeartbeatSnapshot>(STORE_NAMES.heartbeats),
    workflows: await getWorkflowsSnapshot(),
    workflowDetails: await readAll<BrowserWorkflowDetailSnapshot>(STORE_NAMES.workflowDetails),
    agentRecentMemory: await readAll<BrowserRecentMemorySnapshot>(STORE_NAMES.agentRecentMemory),
    agentMemorySearch: await readAll<BrowserMemorySearchSnapshot>(STORE_NAMES.agentMemorySearch),
    heartbeatStatuses: await getHeartbeatStatusesSnapshot(),
    heartbeatReports: await readAll<BrowserHeartbeatReportSnapshot>(STORE_NAMES.heartbeatReports),
  };
}

export async function importBrowserRuntimeBundle(
  bundle: BrowserRuntimeExportBundle
): Promise<void> {
  if (bundle.kind !== "whybuddy-browser-runtime") {
    throw new Error("Unsupported runtime bundle format.");
  }

  if (bundle.schemaVersion > DB_VERSION) {
    throw new Error(
      `Runtime bundle schema ${bundle.schemaVersion} is newer than supported schema ${DB_VERSION}.`
    );
  }

  const storeNames = Object.values(STORE_NAMES);
  for (const storeName of storeNames) {
    await clearStore(storeName);
  }

  const metadata: BrowserRuntimeMetadata = {
    ...(bundle.metadata || createDefaultMetadata("import")),
    schemaVersion: DB_VERSION,
    source: "import",
    importedAt: new Date().toISOString(),
  };

  await writeOne<MetaRecord>(STORE_NAMES.meta, {
    key: "metadata",
    value: metadata,
  });

  if (bundle.aiConfig) {
    await writeOne<AIConfigRecord>(STORE_NAMES.aiConfig, bundle.aiConfig);
  }

  await writeMany(STORE_NAMES.agents, Array.isArray(bundle.agents) ? bundle.agents : []);
  await writeMany(STORE_NAMES.souls, Array.isArray(bundle.souls) ? bundle.souls : []);
  await writeMany(
    STORE_NAMES.heartbeats,
    Array.isArray(bundle.heartbeats) ? bundle.heartbeats : []
  );
  await writeMany(
    STORE_NAMES.workflows,
    Array.isArray(bundle.workflows) ? bundle.workflows : []
  );
  await writeMany(
    STORE_NAMES.workflowDetails,
    Array.isArray(bundle.workflowDetails) ? bundle.workflowDetails : []
  );
  await writeMany(
    STORE_NAMES.agentRecentMemory,
    Array.isArray(bundle.agentRecentMemory) ? bundle.agentRecentMemory : []
  );
  await writeMany(
    STORE_NAMES.agentMemorySearch,
    Array.isArray(bundle.agentMemorySearch) ? bundle.agentMemorySearch : []
  );
  await writeMany(
    STORE_NAMES.heartbeatStatuses,
    Array.isArray(bundle.heartbeatStatuses) ? bundle.heartbeatStatuses : []
  );
  await writeMany(
    STORE_NAMES.heartbeatReports,
    Array.isArray(bundle.heartbeatReports) ? bundle.heartbeatReports : []
  );
}


/* ─── Snapshot Store API ─── */

export async function saveSnapshot(record: SnapshotRecord): Promise<void> {
  await writeOne<SnapshotRecord>(STORE_NAMES.snapshots, record);
}

export async function getSnapshot(id: string): Promise<SnapshotRecord | null> {
  return readOne<SnapshotRecord>(STORE_NAMES.snapshots, id);
}

export async function getLatestSnapshot(missionId?: string): Promise<SnapshotRecord | null> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAMES.snapshots, "readonly");
  const store = transaction.objectStore(STORE_NAMES.snapshots);

  let records: SnapshotRecord[];
  if (missionId) {
    const index = store.index("missionId");
    records = await requestToPromise(index.getAll(missionId) as IDBRequest<SnapshotRecord[]>);
  } else {
    records = await requestToPromise(store.getAll() as IDBRequest<SnapshotRecord[]>);
  }
  await transactionToPromise(transaction);

  if (records.length === 0) return null;
  return records.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest));
}

export async function listSnapshots(): Promise<SnapshotRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAMES.snapshots, "readonly");
  const store = transaction.objectStore(STORE_NAMES.snapshots);
  const index = store.index("createdAt");

  const records = await requestToPromise(index.getAll() as IDBRequest<SnapshotRecord[]>);
  await transactionToPromise(transaction);

  // createdAt index returns ascending; reverse for descending
  return records.reverse();
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAMES.snapshots, "readwrite");
  const store = transaction.objectStore(STORE_NAMES.snapshots);
  store.delete(id);
  await transactionToPromise(transaction);
}

export async function pruneSnapshots(keepCount: number): Promise<void> {
  const all = await listSnapshots(); // sorted by createdAt descending
  if (all.length <= keepCount) return;

  const toDelete = all.slice(keepCount);
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAMES.snapshots, "readwrite");
  const store = transaction.objectStore(STORE_NAMES.snapshots);
  for (const record of toDelete) {
    store.delete(record.id);
  }
  await transactionToPromise(transaction);
}
